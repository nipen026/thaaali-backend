const { prisma } = require('../config/prisma');

// A tenant whose subscription is suspended/cancelled/paused/on_hold should still be able to
// log in and see *why* (routes/auth.js's /me, routes/tenant.js's GET) — this only gates the
// actual business routes (orders, billing, menu, ...), mounted in server.js after this. It's
// a live DB check (not baked into the JWT) so a platform admin's suspend/cancel/pause/hold
// action (routes/platform.js) takes effect on a tenant's very next request, not just their
// next login.
const BLOCKED_STATUSES = ['suspended', 'cancelled', 'paused', 'on_hold'];

const MESSAGES = {
  suspended: 'This account has been suspended. Please contact support to resolve this.',
  cancelled: 'This subscription has been cancelled. Contact us to reactivate your account.',
  paused: 'This account is currently paused.',
  on_hold: 'This account is on hold pending review. Contact support for details.',
};

const requireActiveAccount = async (req, res, next) => {
  try {
    const [tenant, user] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: req.tenantId }, select: { planStatus: true } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { status: true } }),
    ]);
    if (!tenant || !user) return res.status(401).json({ error: 'Invalid' });
    if (BLOCKED_STATUSES.includes(tenant.planStatus)) {
      return res.status(403).json({ error: MESSAGES[tenant.planStatus], account_status: tenant.planStatus });
    }
    // A single deactivated team member (routes/platform.js) shouldn't lock out the whole
    // tenant — this takes effect immediately even on a JWT issued before the deactivation,
    // same as the tenant-level check above, rather than waiting for the token to expire.
    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your business owner for access.', account_status: 'user_inactive' });
    }
    next();
  } catch (err) { next(err); }
};

module.exports = { requireActiveAccount, BLOCKED_STATUSES };
