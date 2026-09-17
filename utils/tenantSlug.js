const { prisma } = require('../config/prisma');

// Shared by the public sign-up flow (routes/auth.js) and platform-admin-created tenants
// (routes/platform.js) — both need the same "business name -> unique URL slug" behavior.
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'business';
}

async function uniqueSlug(base) {
  let slug = base;
  let n = 1;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

module.exports = { slugify, uniqueSlug };
