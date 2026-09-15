const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { serializeStaff } = require('../utils/serialize');

const MANAGE_ROLES = ['owner', 'restaurant_manager', 'hotel_manager'];
const ASSIGNABLE_ROLES = ['restaurant_manager', 'hotel_manager', 'waiter', 'cashier', 'kitchen', 'hotel_desk'];

function canManageStaff(req, res) {
  if (!MANAGE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: 'Only owners and managers can manage staff' });
    return false;
  }
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const profiles = await prisma.staffProfile.findMany({
      where: { tenantId: req.tenantId },
      include: { user: true },
    });
    res.json(profiles.map(serializeStaff));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    if (!canManageStaff(req, res)) return;
    const { name, email, password, role, phone, shift, required_hours_per_day } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password and role are required' });
    }
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const avatar = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

    const profile = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { tenantId: req.tenantId, email, passwordHash, name, role, avatar },
      });
      return tx.staffProfile.create({
        data: {
          tenantId: req.tenantId, userId: user.id,
          shift: shift || 'morning', phone: phone || null, tablesAssigned: [],
          ...(required_hours_per_day !== undefined ? { requiredHoursPerDay: required_hours_per_day } : {}),
        },
        include: { user: true },
      });
    });

    res.status(201).json(serializeStaff(profile));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (!canManageStaff(req, res)) return;
    const { name, role, phone, shift, required_hours_per_day } = req.body;
    if (role && !ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const userData = {};
    if (name !== undefined) userData.name = name;
    if (role !== undefined) userData.role = role;
    const profileData = {};
    if (phone !== undefined) profileData.phone = phone;
    if (shift !== undefined) profileData.shift = shift;
    if (required_hours_per_day !== undefined) profileData.requiredHoursPerDay = required_hours_per_day;

    const [, profile] = await prisma.$transaction([
      prisma.user.update({ where: { id: req.params.id }, data: userData }),
      prisma.staffProfile.update({ where: { userId: req.params.id }, data: profileData, include: { user: true } }),
    ]);
    res.json(serializeStaff(profile));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    if (!canManageStaff(req, res)) return;
    // :id is the user id (matches the legacy shape where staff.id === users.id)
    const profile = await prisma.staffProfile.update({
      where: { userId: req.params.id },
      data: { employmentStatus: req.body.status },
      include: { user: true },
    });
    res.json(serializeStaff(profile));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

module.exports = router;
