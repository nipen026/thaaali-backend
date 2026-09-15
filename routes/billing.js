const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeBill, serializeTable } = require('../utils/serialize');

const GST_RATE = 0.05;
const calculateGST = (subtotal) => {
  const gst = subtotal * GST_RATE;
  return { cgst: gst / 2, sgst: gst / 2, total_gst: gst };
};

const withBillRelations = { items: true, billOrders: true };

async function nextBillNumber(tenantId) {
  const counter = await prisma.counter.upsert({
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

router.post('/generate', async (req, res, next) => {
  try {
    const { table_id, order_ids, discount = 0, payment_method } = req.body;
    const where = { tenantId: req.tenantId };
    if (order_ids) where.id = { in: order_ids };
    else { where.tableId = table_id; where.status = { not: 'billed' }; }

    const orders = await prisma.order.findMany({ where, include: { items: true } });
    if (!orders.length) return res.status(404).json({ error: 'No orders found' });

    const subtotal = orders.reduce((s, o) => s + Number(o.total), 0) - discount;
    const gst = calculateGST(subtotal);
    const grandTotal = subtotal + gst.total_gst;
    const billNumber = await nextBillNumber(req.tenantId);
    // One dining party generally shares one customer — take the first order that captured one.
    const withCustomer = orders.find((o) => o.customerPhone) || orders[0];

    const bill = await prisma.bill.create({
      data: {
        tenantId: req.tenantId,
        billNumber,
        tableId: table_id || null,
        subtotal, discount, cgst: gst.cgst, sgst: gst.sgst, totalGst: gst.total_gst, grandTotal,
        paymentMethod: payment_method || null,
        status: payment_method ? 'paid' : 'generated',
        customerName: withCustomer.customerName || null,
        customerPhone: withCustomer.customerPhone || null,
        paidAt: payment_method ? new Date() : null,
        billOrders: { create: orders.map((o) => ({ orderId: o.id })) },
        items: {
          create: orders.flatMap((o) => o.items.map((i) => ({
            menuItemId: i.menuItemId, nameSnapshot: i.nameSnapshot, priceSnapshot: i.priceSnapshot, qty: i.qty, unit: i.unit,
          }))),
        },
      },
      include: withBillRelations,
    });

    if (payment_method) {
      await prisma.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { status: 'billed' } });
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
  } catch (err) { next(err); }
});

router.put('/:id/pay', async (req, res, next) => {
  try {
    const existing = await prisma.bill.findUnique({ where: { id: req.params.id }, include: { billOrders: true } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const bill = await prisma.bill.update({
      where: { id: req.params.id },
      data: { status: 'paid', paymentMethod: req.body.payment_method, paidAt: new Date() },
      include: withBillRelations,
    });

    await prisma.order.updateMany({
      where: { id: { in: existing.billOrders.map((bo) => bo.orderId) } },
      data: { status: 'billed' },
    });

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
  } catch (err) { next(err); }
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
