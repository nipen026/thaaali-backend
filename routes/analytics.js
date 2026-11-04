const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeMenuItem, num } = require('../utils/serialize');
const { allocateAcrossLines, round2 } = require('../services/discounts');

function todayStr() { return new Date().toISOString().slice(0, 10); }

// "Dishes" sold: a gram-priced line (qty is grams) is one dish, not N.
const dishCount = (it) => (it.unit === 'gram' ? 1 : it.qty);

router.get('/overview', async (req, res, next) => {
  try {
    const [occupied, tablesTotal, activeOrders, items, today] = await Promise.all([
      prisma.restaurantTable.count({ where: { tenantId: req.tenantId, status: 'occupied' } }),
      prisma.restaurantTable.count({ where: { tenantId: req.tenantId } }),
      prisma.order.count({ where: { tenantId: req.tenantId, status: { in: ['pending', 'preparing'] } } }),
      prisma.inventoryItem.findMany({ where: { tenantId: req.tenantId } }),
      prisma.dailyAggregate.findUnique({ where: { tenantId_date: { tenantId: req.tenantId, date: todayStr() } } }),
    ]);
    const lowStock = items.filter((i) => num(i.currentStock) <= num(i.reorderAt)).length;
    res.json({
      revenue: today ? num(today.revenue) : 0,
      orders: today ? today.ordersCount : 0,
      avg_order: today ? num(today.avgOrderValue) : 0,
      covers: today ? today.covers : 0,
      tables_occupied: occupied,
      tables_total: tablesTotal,
      active_orders: activeOrders,
      low_stock_alerts: lowStock,
    });
  } catch (err) { next(err); }
});

router.get('/weekly', async (req, res, next) => {
  try {
    const days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    const rows = await prisma.dailyAggregate.findMany({
      where: { tenantId: req.tenantId, date: { in: days } },
    });
    const byDate = Object.fromEntries(rows.map((r) => [r.date, num(r.revenue)]));
    res.json(days.map((d) => byDate[d] || 0));
  } catch (err) { next(err); }
});

router.get('/hourly', async (req, res, next) => {
  try {
    const today = await prisma.dailyAggregate.findUnique({ where: { tenantId_date: { tenantId: req.tenantId, date: todayStr() } } });
    res.json(today ? today.hourlyBuckets : Array(24).fill(0));
  } catch (err) { next(err); }
});

router.get('/channels', async (req, res, next) => {
  try {
    const today = await prisma.dailyAggregate.findUnique({ where: { tenantId_date: { tenantId: req.tenantId, date: todayStr() } } });
    res.json(today ? today.channelSplit : {});
  } catch (err) { next(err); }
});

router.get('/top-items', async (req, res, next) => {
  try {
    const items = await prisma.menuItem.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { ordersCount: 'desc' },
      take: 5,
    });
    res.json(items.map(serializeMenuItem));
  } catch (err) { next(err); }
});

// Real ledger/reporting numbers over an arbitrary date range — no AI narrative layer,
// just aggregation over actually-paid bills. Aggregated in JS (not raw SQL GROUP BY) to
// match the pragmatic style already used throughout this file; comfortably fast at a
// single tenant's realistic bill volume even over a full year.
router.get('/ledger', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    const bills = await prisma.bill.findMany({
      where: { tenantId: req.tenantId, status: 'paid', paidAt: { gte: fromDate, lte: toDate } },
      include: { items: true },
    });

    let totalRevenue = 0;
    const byMethod = {};
    const itemAgg = {};
    const byDate = {};

    // Discount reporting (see Bill/BillItem discount fields). Per-line discountAmount already
    // includes each line's share of any coupon/manual discount; bills from before those columns
    // existed have discount > 0 but all-zero lines, so their discount is spread across lines here.
    const disc = {
      totalDishesSold: 0, discountedDishes: 0, discountedLines: 0, discountedBills: 0,
      grossSales: 0, total: 0, bySource: { promotion: 0, coupon: 0, manual: 0 },
      dishes: {}, byPromotion: {}, byCoupon: {},
    };

    for (const b of bills) {
      const grand = num(b.grandTotal);
      totalRevenue += grand;

      // A wallet-assisted bill is settled partly from the wallet and partly via paymentMethod.
      const walletPart = num(b.walletAmount) || 0;
      const method = b.paymentMethod || 'unknown';
      if (walletPart > 0) byMethod.wallet = (byMethod.wallet || 0) + walletPart;
      if (grand - walletPart > 0.004) byMethod[method] = (byMethod[method] || 0) + (grand - walletPart);

      const dateKey = b.paidAt.toISOString().slice(0, 10);
      byDate[dateKey] = (byDate[dateKey] || 0) + grand;

      for (const it of b.items) {
        const key = it.nameSnapshot;
        if (!itemAgg[key]) itemAgg[key] = { name: key, qty: 0, revenue: 0 };
        itemAgg[key].qty += it.qty;
        itemAgg[key].revenue += num(it.priceSnapshot) * it.qty;
      }

      const billDiscount = num(b.discount) || 0;
      const lineValues = b.items.map((it) => num(it.priceSnapshot) * it.qty);
      let lineDiscounts = b.items.map((it) => num(it.discountAmount) || 0);
      if (billDiscount > 0 && lineDiscounts.every((d) => d === 0)) lineDiscounts = allocateAcrossLines(billDiscount, lineValues);

      const promo = num(b.promotionDiscount) || 0;
      const coupon = num(b.couponDiscount) || 0;
      disc.total += billDiscount;
      disc.bySource.promotion += promo;
      disc.bySource.coupon += coupon;
      disc.bySource.manual += Math.max(0, billDiscount - promo - coupon);
      if (billDiscount > 0) disc.discountedBills += 1;
      if (b.couponCode && coupon > 0) {
        const c = disc.byCoupon[b.couponCode] || (disc.byCoupon[b.couponCode] = { code: b.couponCode, bills: 0, discount: 0 });
        c.bills += 1;
        c.discount += coupon;
      }

      b.items.forEach((it, i) => {
        const count = dishCount(it);
        disc.totalDishesSold += count;
        disc.grossSales += lineValues[i];
        if (lineDiscounts[i] <= 0) return;
        disc.discountedDishes += count;
        disc.discountedLines += 1;
        const d = disc.dishes[it.nameSnapshot] || (disc.dishes[it.nameSnapshot] = { name: it.nameSnapshot, qty: 0, gross: 0, discount: 0 });
        d.qty += count;
        d.gross += lineValues[i];
        d.discount += lineDiscounts[i];
        if (it.promotionName) {
          const p = disc.byPromotion[it.promotionName] || (disc.byPromotion[it.promotionName] = { name: it.promotionName, qty: 0, discount: 0 });
          p.qty += count;
          p.discount += num(it.promotionDiscount) || 0;
        }
      });
    }

    const topItems = Object.values(itemAgg).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const dailyBreakdown = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue }));

    res.json({
      from, to,
      total_revenue: totalRevenue,
      bills_count: bills.length,
      avg_bill_value: bills.length ? totalRevenue / bills.length : 0,
      by_payment_method: byMethod,
      top_items: topItems,
      daily_breakdown: dailyBreakdown,
      discounts: {
        total_discount: round2(disc.total),
        discounted_dishes: disc.discountedDishes,
        total_dishes_sold: disc.totalDishesSold,
        discounted_bills: disc.discountedBills,
        gross_sales: round2(disc.grossSales),
        discount_rate: disc.grossSales ? round2((disc.total / disc.grossSales) * 100) : 0,
        by_source: {
          promotion: round2(disc.bySource.promotion),
          coupon: round2(disc.bySource.coupon),
          manual: round2(disc.bySource.manual),
        },
        dishes: Object.values(disc.dishes)
          .map((d) => ({ name: d.name, qty: d.qty, gross: round2(d.gross), discount: round2(d.discount), net: round2(d.gross - d.discount) }))
          .sort((a, b) => b.discount - a.discount),
        by_promotion: Object.values(disc.byPromotion).map((p) => ({ ...p, discount: round2(p.discount) })).sort((a, b) => b.discount - a.discount),
        by_coupon: Object.values(disc.byCoupon).map((c) => ({ ...c, discount: round2(c.discount) })).sort((a, b) => b.discount - a.discount),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
