const { prisma } = require('../config/prisma');
const { sendPlatformAlertEmail } = require('./email');

const ERROR_SPIKE_WINDOW_MS = 15 * 60 * 1000;
const ERROR_SPIKE_THRESHOLD = 5;
const ONBOARDING_STUCK_AFTER_MS = 24 * 60 * 60 * 1000;
const INACTIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const PERSISTENT_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Only creates a new alert if there isn't already an open/acknowledged one of the same type
// for the same tenant. `cooldownMs` additionally suppresses re-firing right after a resolve —
// needed for persistent-state checks (a tenant still stuck onboarding, still inactive) where
// "resolved" means "admin is aware," not "the underlying condition changed," so re-checking a
// few minutes later shouldn't immediately re-raise it. Transient checks (error spikes) pass no
// cooldown, since a genuinely new spike minutes after the last was resolved should re-alert.
async function raiseAlert({ tenantId, type, severity, message, metadata, cooldownMs = 0 }) {
  const openOrAcked = await prisma.platformAlert.findFirst({
    where: { tenantId: tenantId || null, type, status: { in: ['open', 'acknowledged'] } },
  });
  if (openOrAcked) return null;

  if (cooldownMs > 0) {
    const recentlyResolved = await prisma.platformAlert.findFirst({
      where: { tenantId: tenantId || null, type, status: 'resolved', resolvedAt: { gt: new Date(Date.now() - cooldownMs) } },
    });
    if (recentlyResolved) return null;
  }

  const alert = await prisma.platformAlert.create({
    data: { tenantId: tenantId || null, type, severity, message, metadata },
  });

  try {
    const admins = await prisma.platformAdmin.findMany({ select: { email: true } });
    const tenant = tenantId ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }) : null;
    await Promise.all(admins.map((a) => sendPlatformAlertEmail({ to: a.email, alert, tenantName: tenant?.name })));
  } catch (err) {
    console.error('[platformAlerts] failed to email admins:', err.message);
  }

  return alert;
}

async function checkPaymentOverdue() {
  const overdue = await prisma.tenant.findMany({
    where: { planStatus: 'active', planRenewsAt: { lt: new Date() } },
    select: { id: true, name: true, planRenewsAt: true },
  });
  for (const t of overdue) {
    await prisma.tenant.update({ where: { id: t.id }, data: { planStatus: 'past_due' } });
    await raiseAlert({
      tenantId: t.id,
      type: 'payment_overdue',
      severity: 'critical',
      message: `${t.name}'s subscription renewal (due ${t.planRenewsAt.toISOString().slice(0, 10)}) is overdue`,
      metadata: { planRenewsAt: t.planRenewsAt },
      cooldownMs: PERSISTENT_ALERT_COOLDOWN_MS,
    });
  }
}

async function checkOnboardingStuck() {
  const cutoff = new Date(Date.now() - ONBOARDING_STUCK_AFTER_MS);
  const candidates = await prisma.tenant.findMany({
    where: { createdAt: { lt: cutoff } },
    select: {
      id: true, name: true, createdAt: true,
      _count: { select: { menuItems: true, tables: true } },
    },
  });
  for (const t of candidates) {
    if (t._count.menuItems > 0 || t._count.tables > 0) continue;
    await raiseAlert({
      tenantId: t.id,
      type: 'onboarding_stuck',
      severity: 'warning',
      message: `${t.name} signed up but hasn't added any menu items or tables yet`,
      metadata: { signedUpAt: t.createdAt },
      cooldownMs: PERSISTENT_ALERT_COOLDOWN_MS,
    });
  }
}

async function checkErrorSpike() {
  const since = new Date(Date.now() - ERROR_SPIKE_WINDOW_MS);
  const count = await prisma.systemErrorLog.count({ where: { createdAt: { gt: since } } });
  if (count < ERROR_SPIKE_THRESHOLD) return;

  // Type includes the window boundary so an alert an hour from now (once this one is
  // resolved) reads as a new incident rather than reusing stale metadata.
  await raiseAlert({
    tenantId: null,
    type: 'error_spike',
    severity: 'critical',
    message: `${count} server errors in the last 15 minutes`,
    metadata: { count, sinceMinutes: 15 },
  });
}

async function checkInactiveTenants() {
  const cutoff = new Date(Date.now() - INACTIVE_AFTER_MS);
  const tenants = await prisma.tenant.findMany({
    where: { planStatus: 'active', createdAt: { lt: cutoff } },
    select: { id: true, name: true },
  });
  for (const t of tenants) {
    const recentEvent = await prisma.productEvent.findFirst({
      where: { tenantId: t.id, createdAt: { gt: cutoff } },
      select: { id: true },
    });
    if (recentEvent) continue;
    await raiseAlert({
      tenantId: t.id,
      type: 'inactive_tenant',
      severity: 'warning',
      message: `${t.name} has had no product activity in the last 14 days`,
      metadata: {},
      cooldownMs: PERSISTENT_ALERT_COOLDOWN_MS,
    });
  }
}

async function runAlertChecks() {
  try {
    await Promise.all([checkPaymentOverdue(), checkOnboardingStuck(), checkErrorSpike(), checkInactiveTenants()]);
  } catch (err) {
    console.error('[platformAlerts] check run failed:', err);
  }
}

module.exports = { runAlertChecks, raiseAlert };
