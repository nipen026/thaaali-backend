const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeOrder, serializeTable } = require('../utils/serialize');
const { logEvent } = require('../utils/events');

const withItems = { items: true, table: true };

router.get('/', async (req, res, next) => {
  try {
    const { status, channel, table_id } = req.query;
    const where = { tenantId: req.tenantId };
    if (status) where.status = status;
    if (channel) where.channel = channel;
    if (table_id) where.tableId = table_id;
    const orders = await prisma.order.findMany({ where, include: withItems, orderBy: { createdAt: 'desc' } });
    res.json(orders.map(serializeOrder));
  } catch (err) { next(err); }
});

router.get('/active', async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId, status: { in: ['pending', 'preparing', 'ready'] } },
      include: withItems,
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders.map(serializeOrder));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { table_id, channel, waiter_id, items, customer_name, customer_phone } = req.body;
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);

    const order = await prisma.order.create({
      data: {
        tenantId: req.tenantId,
        tableId: table_id || null,
        channel,
        waiterId: waiter_id || null,
        total,
        customerName: customer_name || null,
        customerPhone: customer_phone || null,
        items: {
          create: items.map((i) => ({
            menuItemId: i.menu_id,
            nameSnapshot: i.name,
            priceSnapshot: i.price,
            qty: i.qty,
            unit: i.unit || 'item',
            spice: i.spice,
            notes: i.notes,
          })),
        },
      },
      include: withItems,
    });

    // Builds a deduplicated contact list over time (see prisma schema's Customer model) —
    // name is "latest wins" since a returning customer's name shouldn't drift across old visits.
    if (customer_phone) {
      await prisma.customer.upsert({
        where: { tenantId_phone: { tenantId: req.tenantId, phone: customer_phone } },
        create: { tenantId: req.tenantId, name: customer_name || 'Guest', phone: customer_phone, ordersCount: 1, lastOrderAt: new Date() },
        update: { name: customer_name || undefined, ordersCount: { increment: 1 }, lastOrderAt: new Date() },
      });
    }

    const out = serializeOrder(order);
    req.io.emit('new_order', out);
    logEvent({ tenantId: req.tenantId, userId: req.user?.id, name: 'order_created', metadata: { channel } });

    if (table_id) {
      const t = await prisma.restaurantTable.findUnique({ where: { id: table_id } });
      if (t && t.status === 'available') {
        const updated = await prisma.restaurantTable.update({
          where: { id: table_id },
          data: { status: 'occupied', seatedAt: new Date() },
        });
        req.io.emit('table_updated', serializeTable(updated));
      }
    }

    res.status(201).json(out);
  } catch (err) { next(err); }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
      include: withItems,
    });
    const out = serializeOrder(order);
    req.io.emit('order_updated', out);

    if (order.status === 'delivered' && order.tableId) {
      const remaining = await prisma.order.count({
        where: { tableId: order.tableId, status: { not: 'delivered' } },
      });
      if (remaining === 0) {
        const t = await prisma.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: 'bill_requested' },
        });
        req.io.emit('table_updated', serializeTable(t));
      }
    }

    res.json(out);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.post('/:id/add-items', async (req, res, next) => {
  try {
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const addTotal = req.body.items.reduce((s, i) => s + i.price * i.qty, 0);
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        status: 'preparing',
        total: Number(existing.total) + addTotal,
        items: {
          create: req.body.items.map((i) => ({
            menuItemId: i.menu_id,
            nameSnapshot: i.name,
            priceSnapshot: i.price,
            qty: i.qty,
            unit: i.unit || 'item',
            spice: i.spice,
            notes: i.notes,
          })),
        },
      },
      include: withItems,
    });
    const out = serializeOrder(order);
    req.io.emit('order_updated', out);
    res.json(out);
  } catch (err) { next(err); }
});

// Full replace: the frontend sends the complete desired item list for this order.
// Existing lines carry `item_id` (updated in place); lines without one are new (created);
// any existing line missing from the payload is removed. Used to add, remove, or adjust
// quantities on an order that's already been fired to the kitchen — even one already
// `preparing`/`ready`, which is the whole point of this endpoint over the append-only
// /add-items above.
router.put('/:id/items', async (req, res, next) => {
  try {
    const existing = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (['delivered', 'billed', 'cancelled'].includes(existing.status)) {
      return res.status(409).json({ error: `Cannot edit an order that is already ${existing.status}` });
    }

    const newItems = req.body.items || [];
    if (!newItems.length) return res.status(400).json({ error: 'An order must have at least one item' });

    const keepIds = new Set(newItems.filter((i) => i.item_id).map((i) => i.item_id));
    const toDeleteIds = existing.items.filter((i) => !keepIds.has(i.id)).map((i) => i.id);
    const total = newItems.reduce((s, i) => s + i.price * i.qty, 0);

    await prisma.$transaction([
      ...(toDeleteIds.length ? [prisma.orderItem.deleteMany({ where: { id: { in: toDeleteIds } } })] : []),
      ...newItems.filter((i) => i.item_id).map((i) => prisma.orderItem.update({
        where: { id: i.item_id },
        data: { qty: i.qty, spice: i.spice, notes: i.notes },
      })),
      prisma.order.update({
        where: { id: req.params.id },
        data: {
          status: 'preparing',
          total,
          items: {
            create: newItems.filter((i) => !i.item_id).map((i) => ({
              menuItemId: i.menu_id,
              nameSnapshot: i.name,
              priceSnapshot: i.price,
              qty: i.qty,
              unit: i.unit || 'item',
              spice: i.spice,
              notes: i.notes,
            })),
          },
        },
      }),
    ]);

    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: withItems });
    const out = serializeOrder(order);
    req.io.emit('order_updated', out);
    res.json(out);
  } catch (err) { next(err); }
});

module.exports = router;
