const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeInventoryItem } = require('../utils/serialize');

router.get('/', async (req, res, next) => {
  try {
    const items = await prisma.inventoryItem.findMany({ where: { tenantId: req.tenantId }, orderBy: { name: 'asc' } });
    res.json(items.map(serializeInventoryItem));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = {};
    const { name, unit, stock, reorder_at, price_per_unit, supplier } = req.body;
    if (name !== undefined) data.name = name;
    if (unit !== undefined) data.unit = unit;
    if (stock !== undefined) data.currentStock = stock;
    if (reorder_at !== undefined) data.reorderAt = reorder_at;
    if (price_per_unit !== undefined) data.pricePerUnit = price_per_unit;
    if (supplier !== undefined) data.supplier = supplier;

    const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data });
    res.json(serializeInventoryItem(item));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.get('/alerts', async (req, res, next) => {
  try {
    const items = await prisma.inventoryItem.findMany({ where: { tenantId: req.tenantId } });
    const alerts = items.filter((i) => Number(i.currentStock) <= Number(i.reorderAt));
    res.json(alerts.map(serializeInventoryItem));
  } catch (err) { next(err); }
});

// Restocks every currently-low item (or a specific subset via `ids`) up to 3x its reorder
// point, logging each restock as a 'purchase' row in the inventory ledger.
router.post('/reorder', async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    const items = await prisma.inventoryItem.findMany({ where: { tenantId: req.tenantId } });
    const targets = items.filter((i) => (!ids || ids.includes(i.id)) && Number(i.currentStock) <= Number(i.reorderAt));
    if (!targets.length) return res.json([]);

    const updated = [];
    for (const item of targets) {
      const restockTo = Number(item.reorderAt) * 3;
      const qtyDelta = restockTo - Number(item.currentStock);
      const [, updatedItem] = await prisma.$transaction([
        prisma.inventoryTransaction.create({
          data: {
            tenantId: req.tenantId, itemId: item.id, type: 'purchase',
            qtyDelta, resultingStock: restockTo, reason: 'Manual reorder', actorUserId: req.user.id,
          },
        }),
        prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: restockTo } }),
      ]);
      updated.push(updatedItem);
    }
    res.json(updated.map(serializeInventoryItem));
  } catch (err) { next(err); }
});

module.exports = router;
