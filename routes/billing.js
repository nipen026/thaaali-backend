const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeBill, serializeTable } = require('../utils/serialize');
const { priceBill, loadPricingContext, normalizeCouponCode, round2 } = require('../services/discounts');
const { WalletError, findWalletByPhone, debitWallet } = require('../services/wallet');

const GST_RATE = 0.05;
const calculateGST = (subtotal) => {
  const gst = round2(subtotal * GST_RATE);
  const cgst = round2(gst / 2);
  return { cgst, sgst: round2(gst - cgst), total_gst: gst };
};

const withBillRelations = { items: true, billOrders: true };

// `db` is the global client or a transaction client — the counter bump must commit or roll back
// together with the bill that consumes the number.
async function nextBillNumber(db, tenantId) {
  const counter = await db.counter.upsert({
    where: { id: `bill:${tenantId}` },
    update: { seq: { increment: 1 } },
    create: { id: `bill:${tenantId}`, tenantId, seq: 1 },
  });
  return counter.seq;
}

async function incrementTodayRevenue(tenantId, amount) {
  const date = new Date().toISOString().slice(0, 10);
  await prisma.dailyAggregate.upsert({
    where: { tenantId_date: { tenantId, date } },
    update: { revenue: { increment: amount } },
    create: {
      tenantId, date, revenue: amount, ordersCount: 0, avgOrderValue: 0, covers: 0,
      channelSplit: {}, hourlyBuckets: Array(24).fill(0),
    },
  });
}

// Ties realized revenue (not just cart totals) to the Customer record built up in
// routes/orders.js — a no-op if the phone was never captured or the customer row is missing.
async function incrementCustomerSpend(tenantId, phone, amount) {
  if (!phone) return;
  await prisma.customer.updateMany({
    where: { tenantId, phone },
    data: { totalSpend: { increment: amount } },
  });
}

class BillingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const sendBillingError = (err, res, next) => {
  if (err instanceof BillingError || err instanceof WalletError) return res.status(err.status).json({ error: err.message });
  return next(err);
};

async function loadOrdersForBilling(req) {
  const { table_id, order_ids } = req.body;
  const where = { tenantId: req.tenantId };
  if (order_ids) where.id = { in: order_ids };
  else { where.tableId = table_id; where.status = { not: 'billed' }; }
  return prisma.order.findMany({ where, include: { items: true } });
}

// Prices a set of orders end to end: promotions -> coupon -> manual discount -> GST -> wallet.
// Shared by /preview (what the cashier sees) and /generate (what actually gets billed) so the two
// can never disagree. `db` lets generate() run it inside its transaction.
async function priceOrders(db, req, orders) {
  const { discount = 0, coupon_code, use_wallet, payment_method } = req.body;
  // One dining party generally shares one customer — take the first order that captured one.
  const withCustomer = orders.find((o) => o.customerPhone) || orders[0];
  const customerPhone = withCustomer.customerPhone || null;
  const couponCode = normalizeCouponCode(coupon_code);

  const ctx = await loadPricingContext(db, { tenantId: req.tenantId, orders, couponCode, customerPhone });
  const pricing = priceBill({ ...ctx, couponCode, customerPhone, manualDiscount: discount });
  const gst = calculateGST(pricing.net);
  const grandTotal = round2(pricing.net + gst.total_gst);

  let walletInfo = null;
  if (use_wallet || payment_method === 'wallet') {
    const found = await findWalletByPhone(db, req.tenantId, customerPhone);
    const balance = found ? Number(found.wallet.balance) : 0;
    walletInfo = { wallet: found ? found.wallet : null, balance, applied: round2(Math.min(balance, grandTotal)) };
  }
  return { withCustomer, customerPhone, couponCode, ctx, pricing, gst, grandTotal, walletInfo };
}

router.post('/preview', async (req, res, next) => {
  try {
    const orders = await loadOrdersForBilling(req);
    if (!orders.length) return res.status(404).json({ error: 'No orders found' });
    const { pricing, gst, grandTotal, walletInfo, customerPhone } = await priceOrders(prisma, req, orders);
    // Always report the balance when there's a phone, even if the cashier hasn't toggled the
    // wallet on, so the UI can offer the toggle with the amount visible.
    const found = walletInfo ? null : await findWalletByPhone(prisma, req.tenantId, customerPhone);
    const balance = walletInfo ? walletInfo.balance : found ? Number(found.wallet.balance) : 0;
    const applied = walletInfo ? walletInfo.applied : 0;
    res.json({
      gross: pricing.gross,
      promotion_discount: pricing.promotion_discount,
      coupon_discount: pricing.coupon_discount,
      manual_discount: pricing.manual_discount,
      discount: pricing.discount,
      subtotal: pricing.net,
      cgst: gst.cgst, sgst: gst.sgst, total_gst: gst.total_gst,
      grand_total: grandTotal,
      coupon: pricing.coupon,
      coupon_error: pricing.coupon_error,
      customer_phone: customerPhone,
      wallet: { balance, applied, payable: round2(grandTotal - applied) },
      items: pricing.lines.map((l) => ({
        name: l.name, qty: l.qty, unit: l.unit, price: l.price, line_total: l.lineTotal,
        promotion_name: l.promotionName, promotion_discount: l.promotionDiscount, discount_amount: l.discountAmount,
      })),
    });
  } catch (err) { sendBillingError(err, res, next); }
});

router.post('/generate', async (req, res, next) => {
  try {
    const { table_id, payment_method, use_wallet } = req.body;
    const orders = await loadOrdersForBilling(req);
    if (!orders.length) return res.status(404).json({ error: 'No orders found' });

    // Everything that must succeed or fail together — bill, coupon redemption, wallet debit,
    // order status — runs in one transaction, so a failed wallet debit can't leave behind a
    // redeemed coupon or a half-created bill. Pricing is computed inside it too, so the coupon
    // usage count and wallet balance it reads are the ones it then writes against.
    const { bill, customerPhone, grandTotal, settled } = await prisma.$transaction(async (tx) => {
      const p = await priceOrders(tx, req, orders);
      if (p.couponCode && p.pricing.coupon_error) throw new BillingError(p.pricing.coupon_error);

      const walletApplied = p.walletInfo ? p.walletInfo.applied : 0;
      if (use_wallet && !p.customerPhone) throw new BillingError('Customer phone is required to pay from a wallet');
      if (payment_method === 'wallet' && walletApplied < p.grandTotal) throw new WalletError('Insufficient wallet balance', 409);
      const remainder = round2(p.grandTotal - walletApplied);
      if (walletApplied > 0 && remainder > 0 && !payment_method) {
        throw new BillingError(`Choose a payment method for the remaining ₹${remainder.toFixed(2)}`);
      }
      const isPaid = remainder === 0 && walletApplied > 0 ? true : !!payment_method;
      // A bill left unpaid ("generated") must not touch the wallet yet.
      const walletToCharge = isPaid ? walletApplied : 0;
      const finalMethod = !isPaid ? null : walletToCharge > 0 && remainder === 0 ? 'wallet' : payment_method;

      const billNumber = await nextBillNumber(tx, req.tenantId);
      const { pricing, gst, grandTotal: total, withCustomer } = p;

      const created = await tx.bill.create({
        data: {
          tenantId: req.tenantId,
          billNumber,
          tableId: table_id || null,
          subtotal: pricing.net, discount: pricing.discount,
          promotionDiscount: pricing.promotion_discount, couponDiscount: pricing.coupon_discount,
          couponId: pricing.coupon ? pricing.coupon.id : null, couponCode: pricing.coupon ? pricing.coupon.code : null,
          walletAmount: walletToCharge,
          cgst: gst.cgst, sgst: gst.sgst, totalGst: gst.total_gst, grandTotal: total,
          paymentMethod: finalMethod,
          status: isPaid ? 'paid' : 'generated',
          customerName: withCustomer.customerName || null,
          customerPhone: withCustomer.customerPhone || null,
          paidAt: isPaid ? new Date() : null,
          billOrders: { create: orders.map((o) => ({ orderId: o.id })) },
          items: {
            create: pricing.lines.map((l) => ({
              menuItemId: l.menuItemId, nameSnapshot: l.name, priceSnapshot: l.price, qty: l.qty, unit: l.unit,
              discountAmount: l.discountAmount, promotionDiscount: l.promotionDiscount,
              promotionId: l.promotionId, promotionName: l.promotionName,
            })),
          },
        },
        include: withBillRelations,
      });

      if (pricing.coupon) {
        const c = p.ctx.coupon;
        const { count } = await tx.coupon.updateMany({
          where: { id: c.id, ...(c.usageLimit != null ? { usedCount: { lt: c.usageLimit } } : {}) },
          data: { usedCount: { increment: 1 } },
        });
        if (count === 0) throw new BillingError('Coupon usage limit reached', 409);
        await tx.couponRedemption.create({
          data: { tenantId: req.tenantId, couponId: c.id, billId: created.id, customerPhone: p.customerPhone, amount: pricing.coupon_discount },
        });
      }

      if (walletToCharge > 0) {
        await debitWallet(tx, {
          tenantId: req.tenantId, walletId: p.walletInfo.wallet.id, amount: walletToCharge,
          reason: 'payment', billId: created.id, note: `Bill TH-${String(billNumber).padStart(6, '0')}`, createdBy: req.user.id,
        });
      }

      if (isPaid) {
        await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { status: 'billed' } });
      }
      return { bill: created, customerPhone: p.customerPhone, grandTotal: total, settled: isPaid };
    }, { timeout: 20000, maxWait: 10000 });

    if (settled) {
      if (table_id) {
        const t = await prisma.restaurantTable.update({
          where: { id: table_id },
          data: { status: 'available', guests: 0, seatedAt: null, currentWaiterId: null },
        });
        req.io.emit('table_updated', serializeTable(t));
      }
      await incrementTodayRevenue(req.tenantId, grandTotal);
      await incrementCustomerSpend(req.tenantId, bill.customerPhone, grandTotal);
    }

    const out = serializeBill(bill);
    req.io.emit('bill_generated', out);
    res.status(201).json(out);
  } catch (err) { sendBillingError(err, res, next); }
});

router.put('/:id/pay', async (req, res, next) => {
  try {
    const { payment_method, use_wallet } = req.body;
    const existing = await prisma.bill.findFirst({ where: { id: req.params.id, tenantId: req.tenantId }, include: { billOrders: true } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.status !== 'generated') return res.status(409).json({ error: `Bill is already ${existing.status}` });

    const grandTotal = Number(existing.grandTotal);
    const bill = await prisma.$transaction(async (tx) => {
      let walletToCharge = 0;
      let wallet = null;
      if (use_wallet || payment_method === 'wallet') {
        const found = await findWalletByPhone(tx, req.tenantId, existing.customerPhone);
        if (!found) throw new BillingError('No wallet found for this bill\'s customer');
        wallet = found.wallet;
        walletToCharge = round2(Math.min(Number(wallet.balance), grandTotal));
        if (payment_method === 'wallet' && walletToCharge < grandTotal) throw new WalletError('Insufficient wallet balance', 409);
        if (walletToCharge < grandTotal && !payment_method) {
          throw new BillingError(`Choose a payment method for the remaining ₹${(grandTotal - walletToCharge).toFixed(2)}`);
        }
      }
      const finalMethod = walletToCharge >= grandTotal ? 'wallet' : payment_method;

      const updated = await tx.bill.update({
        where: { id: existing.id },
        data: { status: 'paid', paymentMethod: finalMethod, walletAmount: walletToCharge, paidAt: new Date() },
        include: withBillRelations,
      });
      if (walletToCharge > 0) {
        await debitWallet(tx, {
          tenantId: req.tenantId, walletId: wallet.id, amount: walletToCharge, reason: 'payment', billId: existing.id,
          note: `Bill TH-${String(existing.billNumber).padStart(6, '0')}`, createdBy: req.user.id,
        });
      }
      await tx.order.updateMany({
        where: { id: { in: existing.billOrders.map((bo) => bo.orderId) } },
        data: { status: 'billed' },
      });
      return updated;
    }, { timeout: 20000, maxWait: 10000 });

    if (existing.tableId) {
      const t = await prisma.restaurantTable.update({
        where: { id: existing.tableId },
        data: { status: 'available', guests: 0, seatedAt: null, currentWaiterId: null },
      });
      req.io.emit('table_updated', serializeTable(t));
    }
    await incrementTodayRevenue(req.tenantId, Number(bill.grandTotal));
    await incrementCustomerSpend(req.tenantId, bill.customerPhone, Number(bill.grandTotal));

    const out = serializeBill(bill);
    req.io.emit('bill_paid', out);
    res.json(out);
  } catch (err) { sendBillingError(err, res, next); }
});

router.get('/', async (req, res, next) => {
  try {
    const bills = await prisma.bill.findMany({
      where: { tenantId: req.tenantId },
      include: withBillRelations,
      orderBy: { createdAt: 'desc' },
    });
    res.json(bills.map(serializeBill));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({ where: { id: req.params.id }, include: withBillRelations });
    if (!bill) return res.status(404).json({ error: 'Not found' });
    res.json(serializeBill(bill));
  } catch (err) { next(err); }
});

module.exports = router;
