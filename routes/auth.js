const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { auth, SECRET } = require('../middleware/auth');
const { serializeUser } = require('../utils/serialize');

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

function signToken(user) {
  return jwt.sign({ id: user.id, tenantId: user.tenantId, role: user.role, name: user.name }, SECRET, { expiresIn: '24h' });
}

// Sign-up creates a brand-new tenant (business) with its first user as its owner.
// Email is treated as unique across the whole platform (not just per-tenant) so login
// can resolve "which tenant" purely from the credential, without a subdomain/slug step.
router.post('/register', async (req, res, next) => {
  try {
    const { businessName, businessType, ownerName, email, password } = req.body;
    if (!businessName || !ownerName || !email || !password) {
      return res.status(400).json({ error: 'businessName, ownerName, email and password are required' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const slug = await uniqueSlug(slugify(businessName));
    const passwordHash = await bcrypt.hash(password, 10);

    const { tenant, user } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug, name: businessName, businessType: businessType || 'both' },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id, email, passwordHash, name: ownerName, role: 'owner',
          avatar: ownerName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
        },
      });
      return { tenant, user };
    });

    const token = signToken(user);
    res.status(201).json({ token, user: serializeUser(user), tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } });
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
  } catch (err) { next(err); }
});

router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'Invalid' });
    res.json(serializeUser(user));
  } catch (err) { next(err); }
});

module.exports = router;
