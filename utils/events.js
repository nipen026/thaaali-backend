const { prisma } = require('../config/prisma');

// Fire-and-forget product-analytics event (see ProductEvent in schema.prisma) — called from
// tenant-facing routes (auth register/login, routes/events.js for frontend-driven events like
// onboarding steps). Never awaited by its caller and never throws, so a logging hiccup can't
// break the actual user-facing action it's attached to.
function logEvent({ tenantId, userId, name, metadata }) {
  prisma.productEvent.create({
    data: { tenantId: tenantId || null, userId: userId || null, name, metadata: metadata || undefined },
  }).catch((err) => console.error(`[events] failed to log "${name}":`, err.message));
}

module.exports = { logEvent };
