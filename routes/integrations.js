const crypto = require('crypto');
const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeIntegration, serializeExternalMapping, serializeOrder } = require('../utils/serialize');
const { ingestDeliveryOrder, IngestError } = require('../services/deliveryIngest');

const MANAGE_ROLES = ['owner', 'restaurant_manager'];
const PLATFORMS = ['zomato', 'swiggy'];

function generateCredentials() {
  return { token: crypto.randomBytes(16).toString('hex'), secret: crypto.randomBytes(24).toString('hex') };
}

function canManage(req) {
  return MANAGE_ROLES.includes(req.user.role);
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.deliveryIntegration.findMany({ where: { tenantId: req.tenantId }, orderBy: { platform: 'asc' } });
    res.json(rows.map(serializeIntegration));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only an owner or manager can connect delivery platforms' });
    const { platform } = req.body;
    if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: `platform must be one of ${PLATFORMS.join(', ')}` });

    const { token, secret } = generateCredentials();
    const integration = await prisma.deliveryIntegration.create({
      data: { tenantId: req.tenantId, platform, webhookToken: token, webhookSecret: secret },
    });
    res.status(201).json(serializeIntegration(integration));
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'This platform is already connected' });
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only an owner or manager can manage delivery platforms' });
    const existing = await prisma.deliveryIntegration.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const data = {};
    if (req.body.enabled !== undefined) data.enabled = !!req.body.enabled;
    const integration = await prisma.deliveryIntegration.update({ where: { id: existing.id }, data });
    res.json(serializeIntegration(integration));
  } catch (err) { next(err); }
});

router.post('/:id/regenerate-secret', async (req, res, next) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only an owner or manager can manage delivery platforms' });
    const existing = await prisma.deliveryIntegration.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { secret } = generateCredentials();
    const integration = await prisma.deliveryIntegration.update({ where: { id: existing.id }, data: { webhookSecret: secret } });
    res.json(serializeIntegration(integration));
  } catch (err) { next(err); }
});

router.get('/:id/mappings', async (req, res, next) => {
  try {
    const existing = await prisma.deliveryIntegration.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const mappings = await prisma.externalMenuMapping.findMany({
      where: { integrationId: existing.id },
      include: { menuItem: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(mappings.map(serializeExternalMapping));
  } catch (err) { next(err); }
});

router.put('/mappings/:mappingId', async (req, res, next) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only an owner or manager can map delivery items' });
    const mapping = await prisma.externalMenuMapping.findFirst({
      where: { id: req.params.mappingId, integration: { tenantId: req.tenantId } },
    });
    if (!mapping) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.externalMenuMapping.update({
      where: { id: mapping.id },
      data: { menuItemId: req.body.menu_item_id || null },
      include: { menuItem: true },
    });
    res.json(serializeExternalMapping(updated));
  } catch (err) { next(err); }
});

// Dev tool: fires a fake inbound order through the exact same ingestion path a real
// Zomato/Swiggy/aggregator webhook would use, using 1-2 of the tenant's own menu items —
// lets a manager see the whole flow (including the "needs mapping" queue) before real
// platform credentials exist.
router.post('/:id/simulate', async (req, res, next) => {
  try {
    if (!canManage(req)) return res.status(403).json({ error: 'Only an owner or manager can send a test order' });
    const integration = await prisma.deliveryIntegration.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!integration) return res.status(404).json({ error: 'Not found' });

    const menuItems = await prisma.menuItem.findMany({ where: { tenantId: req.tenantId, available: true } });
    if (!menuItems.length) return res.status(400).json({ error: 'Add at least one available menu item before sending a test order' });

    const shuffled = [...menuItems].sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, Math.min(shuffled.length, 1 + Math.floor(Math.random() * 2)));
    const payload = {
      external_order_id: `sim-${Date.now()}`,
      customer_name: 'Test Customer',
      customer_phone: '9999999999',
      items: picks.map((m) => ({
        external_item_id: m.id,
        name: m.name,
        price: Number(m.price),
        qty: 1 + Math.floor(Math.random() * 2),
      })),
    };

    const { order } = await ingestDeliveryOrder({ integration, payload, io: req.io });
    res.status(201).json(serializeOrder(order));
  } catch (err) {
    if (err instanceof IngestError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
