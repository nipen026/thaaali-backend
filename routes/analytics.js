const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeMenuItem, num } = require('../utils/serialize');

function todayStr() { return new Date().toISOString().slice(0, 10); }

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

    for (const b of bills) {
      const grand = num(b.grandTotal);
      totalRevenue += grand;

      const method = b.paymentMethod || 'unknown';
      byMethod[method] = (byMethod[method] || 0) + grand;

      const dateKey = b.paidAt.toISOString().slice(0, 10);
      byDate[dateKey] = (byDate[dateKey] || 0) + grand;

      for (const it of b.items) {
        const key = it.nameSnapshot;
        if (!itemAgg[key]) itemAgg[key] = { name: key, qty: 0, revenue: 0 };
        itemAgg[key].qty += it.qty;
        itemAgg[key].revenue += num(it.priceSnapshot) * it.qty;
      }
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
    });
  } catch (err) { next(err); }
});

module.exports = router;
