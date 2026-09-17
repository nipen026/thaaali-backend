const crypto = require('crypto');
const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeOrder } = require('../utils/serialize');
const { ingestDeliveryOrder, IngestError } = require('../services/deliveryIngest');

// Mounted in server.js *before* the `/api` JWT gate — the caller here is Zomato/Swiggy
// (or an aggregator like Petpooja/UrbanPiper standing in front of them), not a logged-in
// THAALI user, so it authenticates via the per-tenant token+secret from routes/integrations.js
// instead of a Bearer token.
function secretsMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

router.post('/orders/:token', async (req, res, next) => {
  try {
    const integration = await prisma.deliveryIntegration.findUnique({ where: { webhookToken: req.params.token } });
    if (!integration || !integration.enabled) return res.status(404).json({ error: 'Unknown or disabled webhook' });

    const secret = req.headers['x-webhook-secret'];
    if (!secret || !secretsMatch(secret, integration.webhookSecret)) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const { order, created } = await ingestDeliveryOrder({ integration, payload: req.body, io: req.io });
    res.status(created ? 201 : 200).json(serializeOrder(order));
  } catch (err) {
    if (err instanceof IngestError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
