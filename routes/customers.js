const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeCustomer } = require('../utils/serialize');

const MANAGE_ROLES = ['owner', 'restaurant_manager', 'hotel_manager'];

// Read-only for now — the write path lives in routes/orders.js (captured at order time) and
// routes/billing.js (spend tallied at payment time). No campaign-sending UI consumes this yet;
// it's the contact list a future WhatsApp marketing feature would read from.
router.get('/', async (req, res, next) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Only owners and managers can view customers' });
    }
    const customers = await prisma.customer.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { lastOrderAt: 'desc' },
    });
    res.json(customers.map(serializeCustomer));
  } catch (err) { next(err); }
});

module.exports = router;
