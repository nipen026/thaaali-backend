const router = require('express').Router();
const { logEvent } = require('../utils/events');

// Generic product-analytics sink for the tenant-facing frontend (see frontend's api/index.js
// eventsAPI) — e.g. onboarding step views/completion. Mounted behind the normal tenant `auth`
// gate like every other /api/* route, so tenantId/userId come from the verified token, not
// the request body.
router.post('/', (req, res) => {
  const { name, metadata } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  logEvent({ tenantId: req.tenantId, userId: req.user.id, name, metadata });
  res.status(202).json({ logged: true });
});

module.exports = router;
