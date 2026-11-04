const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializePromotion } = require('../utils/serialize');

const MANAGE_ROLES = ['owner', 'restaurant_manager'];
const TYPES = ['percent', 'flat'];
const SCOPES = ['all', 'category', 'items'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const requireManager = (req, res, next) => (
  MANAGE_ROLES.includes(req.user.role) ? next() : res.status(403).json({ error: 'Only owners and managers can manage promotions' })
);

const parseDate = (v) => (v === null || v === undefined || v === '' ? null : new Date(v));
const isBadDate = (d) => d !== null && Number.isNaN(d.getTime());

// Validates a *complete* promotion body (create, or an update already merged over the existing
// row) and returns { data } shaped for Prisma, or { error }. Category/item ids are checked
// against the tenant so a promotion can't reference another restaurant's menu.
async function buildPromotionData(body, tenantId) {
  const name = String(body.name || '').trim();
  if (!name) return { error: 'Name is required' };
  if (!TYPES.includes(body.type)) return { error: `type must be one of ${TYPES.join(', ')}` };
  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) return { error: 'value must be greater than 0' };
  if (body.type === 'percent' && value > 100) return { error: 'A percentage discount cannot exceed 100' };

  const scope = body.scope || 'all';
  if (!SCOPES.includes(scope)) return { error: `scope must be one of ${SCOPES.join(', ')}` };
  const categoryIds = scope === 'category' ? [...new Set(body.category_ids || [])] : [];
  const menuItemIds = scope === 'items' ? [...new Set(body.menu_item_ids || [])] : [];
  if (scope === 'category') {
    if (!categoryIds.length) return { error: 'Select at least one category' };
    const found = await prisma.menuCategory.count({ where: { tenantId, id: { in: categoryIds } } });
    if (found !== categoryIds.length) return { error: 'One or more categories were not found' };
  }
  if (scope === 'items') {
    if (!menuItemIds.length) return { error: 'Select at least one dish' };
    const found = await prisma.menuItem.count({ where: { tenantId, id: { in: menuItemIds } } });
    if (found !== menuItemIds.length) return { error: 'One or more dishes were not found' };
  }

  const daysOfWeek = [...new Set(body.days_of_week || [])];
  if (daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'days_of_week must contain integers 0 (Sun) to 6 (Sat)' };

  const startTime = body.start_time || null;
  const endTime = body.end_time || null;
  if (!!startTime !== !!endTime) return { error: 'Set both start and end time, or neither' };
  if (startTime && (!HHMM.test(startTime) || !HHMM.test(endTime))) return { error: 'Times must be HH:MM (24-hour)' };
  if (startTime && startTime === endTime) return { error: 'Start and end time cannot be the same' };

  const startsAt = parseDate(body.starts_at);
  const endsAt = parseDate(body.ends_at);
  if (isBadDate(startsAt) || isBadDate(endsAt)) return { error: 'Invalid date' };
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'End date must be after the start date' };

  return {
    data: {
      name, description: body.description ? String(body.description).trim() || null : null,
      type: body.type, value, scope, categoryIds, menuItemIds, daysOfWeek,
      startTime, endTime, startsAt, endsAt, active: body.active !== false,
    },
  };
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.promotion.findMany({ where: { tenantId: req.tenantId }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map(serializePromotion));
  } catch (err) { next(err); }
});

router.post('/', requireManager, async (req, res, next) => {
  try {
    const { data, error } = await buildPromotionData(req.body, req.tenantId);
    if (error) return res.status(400).json({ error });
    const promo = await prisma.promotion.create({ data: { ...data, tenantId: req.tenantId } });
    res.status(201).json(serializePromotion(promo));
  } catch (err) { next(err); }
});

// Accepts a partial body (e.g. just { active: false } for the on/off toggle) — merged over the
// stored row so validation always runs against the full resulting promotion.
router.put('/:id', requireManager, async (req, res, next) => {
  try {
    const existing = await prisma.promotion.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { data, error } = await buildPromotionData({ ...serializePromotion(existing), ...req.body }, req.tenantId);
    if (error) return res.status(400).json({ error });
    const promo = await prisma.promotion.update({ where: { id: existing.id }, data });
    res.json(serializePromotion(promo));
  } catch (err) { next(err); }
});

// Safe to hard-delete: bills keep their own promotion id/name snapshot, never a live reference.
router.delete('/:id', requireManager, async (req, res, next) => {
  try {
    const { count } = await prisma.promotion.deleteMany({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!count) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
