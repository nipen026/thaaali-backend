const crypto = require('crypto');
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { SECRET } = require('../middleware/auth');
const { platformAuth } = require('../middleware/platformAuth');
const { runAlertChecks } = require('../services/platformAlerts');
const { slugify, uniqueSlug } = require('../utils/tenantSlug');
const {
  ts, num, serializeUser,
  serializePlatformAdmin, serializePlatformTenant, serializeSubscriptionPayment,
  serializeProductEvent, serializePlatformAlert, serializeSystemError,
} = require('../utils/serialize');

const BILLING_ROLES = ['super_admin', 'billing_admin'];
const IMPERSONATE_ROLES = ['super_admin', 'support_agent'];
// Same set middleware/accountStatus.js blocks tenant-side access for — subscription lifecycle
// actions below only move a tenant into/out of these statuses (plus active/past_due, which
// aren't reachable through these actions — past_due is set automatically, see platformAlerts.js).
const LIFECYCLE_STATUS = { suspend: 'suspended', cancel: 'cancelled', pause: 'paused', hold: 'on_hold' };

function randomPassword() {
  return crypto.randomBytes(9).toString('base64url'); // 12 chars, URL-safe
}

function signPlatformToken(admin) {
  return jwt.sign({ platformAdminId: admin.id, role: admin.role, name: admin.name, isPlatform: true }, SECRET, { expiresIn: '12h' });
}

// AuditLog has no dedicated "acting platform admin" column (actorUserId is typed for a tenant
// User) — `impersonatedBy` is the closest fit and is reused here for every platform-admin action,
// not just literal impersonation, so every platform-originated row is traceable to who did it.
async function writeAuditLog({ platformAdminId, action, targetType, targetId, tenantId, before, after, ip }) {
  try {
    await prisma.auditLog.create({
      data: { tenantId: tenantId || null, actorType: 'platform_admin', impersonatedBy: platformAdminId, action, targetType, targetId, before, after, ip },
    });
  } catch (err) { console.error('[platform] audit log write failed:', err.message); }
}

// ── Auth (no platformAuth applied yet) ─────────────────────────────────
router.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const admin = await prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ token: signPlatformToken(admin), admin: serializePlatformAdmin(admin) });
  } catch (err) { next(err); }
});

router.use(platformAuth);

router.get('/auth/me', async (req, res, next) => {
  try {
    const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin.platformAdminId } });
    if (!admin) return res.status(401).json({ error: 'Invalid' });
    res.json(serializePlatformAdmin(admin));
  } catch (err) { next(err); }
});

router.put('/auth/me', async (req, res, next) => {
  try {
    const { name, current_password, new_password } = req.body;
    const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin.platformAdminId } });
    if (!admin) return res.status(401).json({ error: 'Invalid' });

    const data = {};
    if (name !== undefined) data.name = name;
    if (new_password) {
      if (!current_password || !(await bcrypt.compare(current_password, admin.passwordHash))) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
      data.passwordHash = await bcrypt.hash(new_password, 10);
    }

    const updated = await prisma.platformAdmin.update({ where: { id: admin.id }, data });
    res.json(serializePlatformAdmin(updated));
  } catch (err) { next(err); }
});

// ── Platform admin team (Settings → Team) ───────────────────────────────
const MANAGE_ADMINS_ROLES = ['super_admin'];

router.get('/admins', async (req, res, next) => {
  try {
    const admins = await prisma.platformAdmin.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(admins.map(serializePlatformAdmin));
  } catch (err) { next(err); }
});

router.post('/admins', async (req, res, next) => {
  try {
    if (!MANAGE_ADMINS_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin can add platform admins' });
    }
    const { name, email, role } = req.body;
    if (!name || !email || !role) return res.status(400).json({ error: 'name, email and role are required' });

    const existing = await prisma.platformAdmin.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An admin with this email already exists' });

    const password = randomPassword();
    const admin = await prisma.platformAdmin.create({
      data: { name, email, role, passwordHash: await bcrypt.hash(password, 10) },
    });
    res.status(201).json({ ...serializePlatformAdmin(admin), temp_password: password });
  } catch (err) { next(err); }
});

router.put('/admins/:id', async (req, res, next) => {
  try {
    if (!MANAGE_ADMINS_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin can edit platform admins' });
    }
    const { role } = req.body;
    const admin = await prisma.platformAdmin.update({ where: { id: req.params.id }, data: { role } });
    res.json(serializePlatformAdmin(admin));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.delete('/admins/:id', async (req, res, next) => {
  try {
    if (!MANAGE_ADMINS_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin can remove platform admins' });
    }
    if (req.params.id === req.platformAdmin.platformAdminId) {
      return res.status(400).json({ error: "You can't remove your own admin account" });
    }
    await prisma.platformAdmin.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

// ── Tenants ─────────────────────────────────────────────────────────────
router.get('/tenants', async (req, res, next) => {
  try {
    const { q, plan_status } = req.query;
    const where = {};
    if (plan_status) where.planStatus = plan_status;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }
    const tenants = await prisma.tenant.findMany({
      where,
      include: { _count: { select: { users: true, orders: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const ids = tenants.map((t) => t.id);
    const lastEvents = ids.length
      ? await prisma.productEvent.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _max: { createdAt: true } })
      : [];
    const lastActiveMap = new Map(lastEvents.map((e) => [e.tenantId, e._max.createdAt]));

    res.json(tenants.map((t) => ({ ...serializePlatformTenant(t), last_active_at: ts(lastActiveMap.get(t.id) || null) })));
  } catch (err) { next(err); }
});

// Sales-assisted / manual onboarding — an admin creates the tenant and its owner account
// directly (as opposed to the public self-serve flow in routes/auth.js's /register), setting
// the plan immediately instead of leaving it at the schema's trial default.
router.post('/tenants', async (req, res, next) => {
  try {
    if (!BILLING_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin or billing admin can create tenants' });
    }
    const { business_name, business_type, owner_name, owner_email, plan_tier, plan_amount, plan_seats } = req.body;
    if (!business_name || !owner_name || !owner_email) {
      return res.status(400).json({ error: 'business_name, owner_name and owner_email are required' });
    }
    const existingUser = await prisma.user.findFirst({ where: { email: owner_email } });
    if (existingUser) return res.status(409).json({ error: 'An account with this email already exists' });

    const slug = await uniqueSlug(slugify(business_name));
    const password = randomPassword();
    const passwordHash = await bcrypt.hash(password, 10);

    const { tenant, user } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: business_name,
          businessType: business_type || 'both',
          planTier: plan_tier || 'trial',
          planSeats: plan_seats ? Number(plan_seats) : undefined,
          planAmount: plan_amount ? Number(plan_amount) : undefined,
        },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id, email: owner_email, passwordHash, name: owner_name, role: 'owner',
          avatar: owner_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
          emailVerifiedAt: new Date(), // admin-created — skip the email verification gate
        },
      });
      return { tenant, user };
    });

    await writeAuditLog({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'tenant.created',
      targetType: 'tenant',
      targetId: tenant.id,
      tenantId: tenant.id,
      after: { name: business_name, ownerEmail: owner_email, planTier: tenant.planTier },
      ip: req.ip,
    });

    res.status(201).json({ ...serializePlatformTenant(tenant), owner: { ...serializeUser(user), temp_password: password } });
  } catch (err) { next(err); }
});

router.get('/tenants/:id', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true, orders: true, menuItems: true, tables: true } } },
    });
    if (!tenant) return res.status(404).json({ error: 'Not found' });

    const [users, payments, recentEvents, alerts] = await Promise.all([
      prisma.user.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } }),
      prisma.tenantSubscriptionPayment.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' } }),
      prisma.productEvent.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' }, take: 25 }),
      prisma.platformAlert.findMany({ where: { tenantId: tenant.id, status: { in: ['open', 'acknowledged'] } }, orderBy: { createdAt: 'desc' } }),
    ]);

    res.json({
      ...serializePlatformTenant(tenant),
      users: users.map((u) => ({ ...serializeUser(u), account_id: u.id, status: u.status, permissions: u.permissions, last_login_at: ts(u.lastLoginAt), created_at: ts(u.createdAt) })),
      payments: payments.map(serializeSubscriptionPayment),
      recent_activity: recentEvents.map(serializeProductEvent),
      open_alerts: alerts.map(serializePlatformAlert),
      usage: {
        orders_count: tenant._count.orders,
        menu_items_count: tenant._count.menuItems,
        tables_count: tenant._count.tables,
        users_count: tenant._count.users,
      },
    });
  } catch (err) { next(err); }
});

router.put('/tenants/:id/plan', async (req, res, next) => {
  try {
    if (!BILLING_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin or billing admin can change a tenant\'s plan' });
    }
    const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { plan_tier, plan_status, plan_renews_at, plan_seats, plan_amount } = req.body;
    const data = {};
    if (plan_tier !== undefined) data.planTier = plan_tier;
    if (plan_status !== undefined) data.planStatus = plan_status;
    if (plan_renews_at !== undefined) data.planRenewsAt = plan_renews_at ? new Date(plan_renews_at) : null;
    if (plan_seats !== undefined) data.planSeats = Number(plan_seats);
    if (plan_amount !== undefined) data.planAmount = plan_amount === null ? null : Number(plan_amount);

    const tenant = await prisma.tenant.update({ where: { id: existing.id }, data });

    await writeAuditLog({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'tenant.plan_updated',
      targetType: 'tenant',
      targetId: tenant.id,
      tenantId: tenant.id,
      before: { planTier: existing.planTier, planStatus: existing.planStatus, planRenewsAt: existing.planRenewsAt, planSeats: existing.planSeats, planAmount: num(existing.planAmount) },
      after: data,
      ip: req.ip,
    });

    res.json(serializePlatformTenant(tenant));
  } catch (err) { next(err); }
});

// ── Subscription lifecycle: suspend / cancel / pause / hold / reactivate ────
// Each of these takes effect on the tenant's *next request*, not next login — see
// middleware/accountStatus.js, which checks planStatus live rather than trusting the JWT.
for (const [action, status] of Object.entries(LIFECYCLE_STATUS)) {
  router.post(`/tenants/:id/${action}`, async (req, res, next) => {
    try {
      if (!BILLING_ROLES.includes(req.platformAdmin.role)) {
        return res.status(403).json({ error: `Only a super admin or billing admin can ${action} a tenant` });
      }
      const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Not found' });

      const tenant = await prisma.tenant.update({ where: { id: existing.id }, data: { planStatus: status } });

      await writeAuditLog({
        platformAdminId: req.platformAdmin.platformAdminId,
        action: `tenant.${action}`,
        targetType: 'tenant',
        targetId: tenant.id,
        tenantId: tenant.id,
        before: { planStatus: existing.planStatus },
        after: { planStatus: status, reason: req.body?.reason || null },
        ip: req.ip,
      });

      res.json(serializePlatformTenant(tenant));
    } catch (err) { next(err); }
  });
}

router.post('/tenants/:id/reactivate', async (req, res, next) => {
  try {
    if (!BILLING_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin or billing admin can reactivate a tenant' });
    }
    const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const tenant = await prisma.tenant.update({ where: { id: existing.id }, data: { planStatus: 'active' } });

    await writeAuditLog({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'tenant.reactivate',
      targetType: 'tenant',
      targetId: tenant.id,
      tenantId: tenant.id,
      before: { planStatus: existing.planStatus },
      after: { planStatus: 'active' },
      ip: req.ip,
    });

    res.json(serializePlatformTenant(tenant));
  } catch (err) { next(err); }
});

router.get('/tenants/:id/payments', async (req, res, next) => {
  try {
    const payments = await prisma.tenantSubscriptionPayment.findMany({ where: { tenantId: req.params.id }, orderBy: { createdAt: 'desc' } });
    res.json(payments.map(serializeSubscriptionPayment));
  } catch (err) { next(err); }
});

router.post('/tenants/:id/payments', async (req, res, next) => {
  try {
    if (!BILLING_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin or billing admin can record payments' });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) return res.status(404).json({ error: 'Not found' });

    const { amount, currency, status, period_start, period_end, method, notes } = req.body;
    if (!amount || !period_start || !period_end) {
      return res.status(400).json({ error: 'amount, period_start and period_end are required' });
    }

    const payment = await prisma.tenantSubscriptionPayment.create({
      data: {
        tenantId: tenant.id,
        amount: Number(amount),
        currency: currency || 'INR',
        status: status || 'success',
        periodStart: new Date(period_start),
        periodEnd: new Date(period_end),
        method: method || 'manual',
        notes: notes || null,
        recordedBy: req.platformAdmin.platformAdminId,
      },
    });

    await writeAuditLog({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'tenant.payment_recorded',
      targetType: 'tenant_subscription_payment',
      targetId: payment.id,
      tenantId: tenant.id,
      after: { amount: Number(amount), status: status || 'success' },
      ip: req.ip,
    });

    res.status(201).json(serializeSubscriptionPayment(payment));
  } catch (err) { next(err); }
});

router.post('/tenants/:id/impersonate', async (req, res, next) => {
  try {
    if (!IMPERSONATE_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin or support agent can impersonate a tenant' });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) return res.status(404).json({ error: 'Not found' });

    const userId = req.body?.user_id;
    const targetUser = userId
      ? await prisma.user.findFirst({ where: { id: userId, tenantId: tenant.id } })
      : await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'owner' }, orderBy: { createdAt: 'asc' } });
    if (!targetUser) return res.status(404).json({ error: 'No user found to impersonate for this tenant' });

    const token = jwt.sign({ id: targetUser.id, tenantId: targetUser.tenantId, role: targetUser.role, name: targetUser.name }, SECRET, { expiresIn: '30m' });

    await writeAuditLog({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'tenant.impersonated',
      targetType: 'user',
      targetId: targetUser.id,
      tenantId: tenant.id,
      after: { impersonatedUserId: targetUser.id, impersonatedUserName: targetUser.name },
      ip: req.ip,
    });

    res.json({ token, tenant_app_url: process.env.APP_URL || 'http://localhost:5173', user: serializeUser(targetUser) });
  } catch (err) { next(err); }
});

// ── Tenant accounts (team members) ──────────────────────────────────────
// `permissions` is a free-form string array already on the User model — these are the keys
// the Admin Panel's UI offers; nothing in the tenant-facing app reads them yet (role still
// drives nav/access there), so this is forward-looking scaffolding for finer-grained access,
// tracked per account rather than enforced yet.
const PERMISSION_KEYS = ['orders', 'menu', 'billing', 'inventory', 'staff', 'analytics', 'hotel'];

router.post('/tenants/:id/users', async (req, res, next) => {
  try {
    if (!BILLING_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin or billing admin can add tenant accounts' });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) return res.status(404).json({ error: 'Not found' });

    const { name, email, role, permissions } = req.body;
    if (!name || !email || !role) return res.status(400).json({ error: 'name, email and role are required' });

    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const password = randomPassword();
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id, email, name, role,
        passwordHash: await bcrypt.hash(password, 10),
        avatar: name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
        permissions: (permissions || []).filter((p) => PERMISSION_KEYS.includes(p)),
        emailVerifiedAt: new Date(),
      },
    });

    await writeAuditLog({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'tenant.user_added',
      targetType: 'user',
      targetId: user.id,
      tenantId: tenant.id,
      after: { name, email, role },
      ip: req.ip,
    });

    res.status(201).json({ ...serializeUser(user), account_id: user.id, status: user.status, permissions: user.permissions, temp_password: password });
  } catch (err) { next(err); }
});

router.put('/tenants/:id/users/:userId', async (req, res, next) => {
  try {
    if (!BILLING_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin or billing admin can edit tenant accounts' });
    }
    const existing = await prisma.user.findFirst({ where: { id: req.params.userId, tenantId: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { role, permissions, status } = req.body;
    const data = {};
    if (role !== undefined) data.role = role;
    if (permissions !== undefined) data.permissions = permissions.filter((p) => PERMISSION_KEYS.includes(p));
    if (status !== undefined) data.status = status;

    const user = await prisma.user.update({ where: { id: existing.id }, data });

    await writeAuditLog({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'tenant.user_updated',
      targetType: 'user',
      targetId: user.id,
      tenantId: req.params.id,
      before: { role: existing.role, permissions: existing.permissions, status: existing.status },
      after: data,
      ip: req.ip,
    });

    res.json({ ...serializeUser(user), account_id: user.id, status: user.status, permissions: user.permissions });
  } catch (err) { next(err); }
});

// ── Payments (platform-wide) ─────────────────────────────────────────────
router.get('/payments', async (req, res, next) => {
  try {
    const { status, tenant_id } = req.query;
    const where = {};
    if (status) where.status = status;
    if (tenant_id) where.tenantId = tenant_id;
    const payments = await prisma.tenantSubscriptionPayment.findMany({
      where, include: { tenant: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200,
    });
    res.json(payments.map(serializeSubscriptionPayment));
  } catch (err) { next(err); }
});

router.put('/payments/:id', async (req, res, next) => {
  try {
    if (!BILLING_ROLES.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Only a super admin or billing admin can update a payment' });
    }
    const { status, notes } = req.body;
    const data = {};
    if (status !== undefined) data.status = status;
    if (notes !== undefined) data.notes = notes;

    const payment = await prisma.tenantSubscriptionPayment.update({
      where: { id: req.params.id }, data, include: { tenant: { select: { name: true } } },
    });

    await writeAuditLog({
      platformAdminId: req.platformAdmin.platformAdminId,
      action: 'payment.updated',
      targetType: 'tenant_subscription_payment',
      targetId: payment.id,
      tenantId: payment.tenantId,
      after: data,
      ip: req.ip,
    });

    res.json(serializeSubscriptionPayment(payment));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

// ── Platform analytics ───────────────────────────────────────────────────
router.get('/analytics/overview', async (req, res, next) => {
  try {
    const [totalTenants, activeTenants, trialTenants, pastDueTenants, activeAmounts, signups7d, signups30d, totalOrders, openAlerts] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { planStatus: 'active' } }),
      prisma.tenant.count({ where: { planTier: 'trial' } }),
      prisma.tenant.count({ where: { planStatus: 'past_due' } }),
      prisma.tenant.aggregate({ where: { planStatus: 'active' }, _sum: { planAmount: true } }),
      prisma.tenant.count({ where: { createdAt: { gt: new Date(Date.now() - 7 * 86400000) } } }),
      prisma.tenant.count({ where: { createdAt: { gt: new Date(Date.now() - 30 * 86400000) } } }),
      prisma.order.count(),
      prisma.platformAlert.count({ where: { status: { in: ['open', 'acknowledged'] } } }),
    ]);

    res.json({
      total_tenants: totalTenants,
      active_tenants: activeTenants,
      trial_tenants: trialTenants,
      past_due_tenants: pastDueTenants,
      mrr: num(activeAmounts._sum.planAmount) || 0,
      signups_last_7d: signups7d,
      signups_last_30d: signups30d,
      total_orders_platform_wide: totalOrders,
      open_alerts_count: openAlerts,
    });
  } catch (err) { next(err); }
});

router.get('/analytics/growth', async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 90, 365);
    const since = new Date(Date.now() - days * 86400000);
    const tenants = await prisma.tenant.findMany({ where: { createdAt: { gt: since } }, select: { createdAt: true } });

    const byDay = new Map();
    for (const t of tenants) {
      const day = t.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    const series = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, signups: count }));
    res.json(series);
  } catch (err) { next(err); }
});

router.get('/analytics/revenue', async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 90, 365);
    const since = new Date(Date.now() - days * 86400000);
    const payments = await prisma.tenantSubscriptionPayment.findMany({
      where: { createdAt: { gt: since }, status: 'success' },
      select: { createdAt: true, amount: true },
    });

    const byDay = new Map();
    for (const p of payments) {
      const day = p.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + Number(p.amount));
    }
    const series = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, revenue]) => ({ date, revenue }));
    res.json(series);
  } catch (err) { next(err); }
});

// ── Activity / usage ─────────────────────────────────────────────────────
router.get('/activity', async (req, res, next) => {
  try {
    const { tenant_id, name } = req.query;
    const where = {};
    if (tenant_id) where.tenantId = tenant_id;
    if (name) where.name = name;
    const events = await prisma.productEvent.findMany({
      where, include: { tenant: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    res.json(events.map(serializeProductEvent));
  } catch (err) { next(err); }
});

const ONBOARDING_STEPS = ['info', 'tables', 'menu', 'done'];

router.get('/activity/onboarding-funnel', async (req, res, next) => {
  try {
    const [stepEvents, completed, skipped] = await Promise.all([
      prisma.productEvent.findMany({ where: { name: 'onboarding_step_viewed' }, select: { tenantId: true, metadata: true } }),
      prisma.productEvent.findMany({ where: { name: 'onboarding_completed' }, select: { tenantId: true }, distinct: ['tenantId'] }),
      prisma.productEvent.findMany({ where: { name: 'onboarding_skipped' }, select: { tenantId: true }, distinct: ['tenantId'] }),
    ]);

    const reachedByStep = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s, new Set()]));
    for (const e of stepEvents) {
      const step = e.metadata?.step;
      if (step && reachedByStep[step]) reachedByStep[step].add(e.tenantId);
    }

    res.json({
      steps: ONBOARDING_STEPS.map((step) => ({ step, tenants_reached: reachedByStep[step].size })),
      completed_count: completed.length,
      skipped_count: skipped.length,
    });
  } catch (err) { next(err); }
});

// ── Alerts ────────────────────────────────────────────────────────────────
router.get('/alerts', async (req, res, next) => {
  try {
    const status = req.query.status;
    const where = status ? { status } : { status: { in: ['open', 'acknowledged'] } };
    const alerts = await prisma.platformAlert.findMany({
      where, include: { tenant: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200,
    });
    res.json(alerts.map(serializePlatformAlert));
  } catch (err) { next(err); }
});

router.put('/alerts/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['acknowledged', 'resolved'].includes(status)) return res.status(400).json({ error: 'status must be acknowledged or resolved' });

    const data = { status };
    if (status === 'resolved') {
      data.resolvedBy = req.platformAdmin.platformAdminId;
      data.resolvedAt = new Date();
    }
    const alert = await prisma.platformAlert.update({ where: { id: req.params.id }, data, include: { tenant: { select: { name: true } } } });
    res.json(serializePlatformAlert(alert));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

// Runs the alert-check rules immediately (they also run on a timer — see server.js) —
// lets the panel offer a manual "Refresh" instead of waiting for the next tick.
router.post('/alerts/check-now', async (req, res, next) => {
  try {
    await runAlertChecks();
    const alerts = await prisma.platformAlert.findMany({ where: { status: { in: ['open', 'acknowledged'] } }, include: { tenant: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
    res.json(alerts.map(serializePlatformAlert));
  } catch (err) { next(err); }
});

// ── System monitoring ─────────────────────────────────────────────────────
router.get('/system/errors', async (req, res, next) => {
  try {
    const errors = await prisma.systemErrorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(errors.map(serializeSystemError));
  } catch (err) { next(err); }
});

module.exports = router;
