const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeTable } = require('../utils/serialize');

const MANAGE_ROLES = ['owner', 'restaurant_manager'];
function canManageTables(req, res) {
  if (!MANAGE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: 'Only owners and restaurant managers can configure tables' });
    return false;
  }
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const tables = await prisma.restaurantTable.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { number: 'asc' },
    });
    res.json(tables.map(serializeTable));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    if (!canManageTables(req, res)) return;
    const { number, capacity, zone } = req.body;
    if (!number || !capacity || !zone) return res.status(400).json({ error: 'number, capacity and zone are required' });

    const existing = await prisma.restaurantTable.findUnique({
      where: { tenantId_number: { tenantId: req.tenantId, number } },
    });
    if (existing) return res.status(409).json({ error: `Table ${number} already exists` });

    const t = await prisma.restaurantTable.create({
      data: { tenantId: req.tenantId, number, capacity, zone, status: 'available', guests: 0 },
    });
    res.status(201).json(serializeTable(t));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (!canManageTables(req, res)) return;
    const data = {};
    const { number, capacity, zone } = req.body;
    if (number !== undefined) data.number = number;
    if (capacity !== undefined) data.capacity = capacity;
    if (zone !== undefined) data.zone = zone;

    const t = await prisma.restaurantTable.update({ where: { id: req.params.id }, data });
    res.json(serializeTable(t));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'A table with that number already exists' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!canManageTables(req, res)) return;
    const t = await prisma.restaurantTable.findUnique({ where: { id: req.params.id } });
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.status !== 'available') return res.status(409).json({ error: 'Only available (empty) tables can be removed' });

    await prisma.restaurantTable.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const data = {};
    if (req.body.status !== undefined) data.status = req.body.status;
    if (req.body.guests !== undefined) data.guests = req.body.guests;
    if (req.body.waiter !== undefined) data.currentWaiterId = req.body.waiter;
    if (req.body.seated_at !== undefined) data.seatedAt = req.body.seated_at ? new Date(req.body.seated_at) : null;
    if (req.body.reservation_time !== undefined) data.reservationTime = req.body.reservation_time;

    const t = await prisma.restaurantTable.update({
      where: { id: req.params.id },
      data,
    });
    const out = serializeTable(t);
    req.io.emit('table_updated', out);
    res.json(out);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.post('/:id/seat', async (req, res, next) => {
  try {
    const t = await prisma.restaurantTable.update({
      where: { id: req.params.id },
      data: { status: 'occupied', guests: req.body.guests, seatedAt: new Date(), currentWaiterId: req.body.waiter || null },
    });
    const out = serializeTable(t);
    req.io.emit('table_updated', out);
    res.json(out);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

module.exports = router;
