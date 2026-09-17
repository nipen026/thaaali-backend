const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { auth, SECRET } = require('../middleware/auth');
const { serializeUser } = require('../utils/serialize');
const { generateVerificationToken, hashToken } = require('../utils/tokens');
const { sendVerificationEmail } = require('../services/email');
const { logEvent } = require('../utils/events');
const { slugify, uniqueSlug } = require('../utils/tenantSlug');

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

async function issueVerificationEmail(user) {
  const { raw, hash } = generateVerificationToken();
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS) },
  });
  await sendVerificationEmail({ to: user.email, name: user.name, token: raw });
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

    // Signup succeeds even if the verification email fails to send (e.g. Resend
    // misconfigured) — verification is a follow-up step, not a login gate.
    try {
      await issueVerificationEmail(user);
    } catch (err) {
      console.error('Failed to send verification email:', err);
    }

    logEvent({ tenantId: tenant.id, userId: user.id, name: 'signup_completed', metadata: { businessType: tenant.businessType } });

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
    // Set by a platform/business admin deactivating one team member's account (see
    // routes/platform.js) — distinct from a whole tenant being suspended (middleware/accountStatus.js).
    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your business owner for access.' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    logEvent({ tenantId: user.tenantId, userId: user.id, name: 'login' });

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

// Public (no auth) — the link is opened from an emailed URL, not an authenticated
// session, and may be opened on a different device than the one that signed up.
router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const hash = hashToken(token);
    const record = await prisma.emailVerificationToken.findFirst({
      where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!record) return res.status(400).json({ error: 'This verification link is invalid or has expired' });

    await prisma.$transaction([
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);

    res.json({ verified: true });
  } catch (err) { next(err); }
});

router.post('/resend-verification', auth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'Invalid' });
    if (user.emailVerifiedAt) return res.status(400).json({ error: 'Email is already verified' });

    const lastToken = await prisma.emailVerificationToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (lastToken && Date.now() - lastToken.createdAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Please wait a minute before requesting another verification email' });
    }

    await issueVerificationEmail(user);
    res.json({ sent: true });
  } catch (err) { next(err); }
});

router.post('/change-password', auth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
