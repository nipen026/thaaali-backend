const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeTenant } = require('../utils/serialize');

const MANAGE_ROLES = ['owner'];

router.get('/', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Not found' });
    res.json(serializeTenant(tenant));
  } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Only the owner can edit business settings' });
    }
    const data = {};
    const { name, business_type, currency, gst_rate, timezone } = req.body;
    if (name !== undefined) data.name = name;
    if (business_type !== undefined) data.businessType = business_type;
    if (currency !== undefined) data.currency = currency;
    if (gst_rate !== undefined) data.gstRate = gst_rate;
    if (timezone !== undefined) data.timezone = timezone;

    const tenant = await prisma.tenant.update({ where: { id: req.tenantId }, data });
    res.json(serializeTenant(tenant));
  } catch (err) { next(err); }
});

module.exports = router;
