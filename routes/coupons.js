const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeCoupon } = require('../utils/serialize');
const { normalizeCouponCode } = require('../services/discounts');

const MANAGE_ROLES = ['owner', 'restaurant_manager'];
const TYPES = ['percent', 'flat'];
const CODE_RE = /^[A-Z0-9_-]{3,20}$/;

const requireManager = (req, res, next) => (
  MANAGE_ROLES.includes(req.user.role) ? next() : res.status(403).json({ error: 'Only owners and managers can manage coupons' })
);

const isBlank = (v) => v === null || v === undefined || v === '';
const parseDate = (v) => (isBlank(v) ? null : new Date(v));
const isBadDate = (d) => d !== null && Number.isNaN(d.getTime());

// Validates everything except `code` (immutable once created — bills and redemptions refer to it).
function buildCouponData(body) {
  if (!TYPES.includes(body.type)) return { error: `type must be one of ${TYPES.join(', ')}` };
  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) return { error: 'value must be greater than 0' };
  if (body.type === 'percent' && value > 100) return { error: 'A percentage discount cannot exceed 100' };

  const optionalNumber = (v, label, { integer = false } = {}) => {
    if (isBlank(v)) return { value: null };
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) return { error: `${label} must be a positive ${integer ? 'whole ' : ''}number` };
    return { value: n };
  };
  const maxDiscount = optionalNumber(body.max_discount, 'max_discount');
  const minOrderValue = optionalNumber(body.min_order_value, 'min_order_value');
  const usageLimit = optionalNumber(body.usage_limit, 'usage_limit', { integer: true });
  const perCustomerLimit = optionalNumber(body.per_customer_limit, 'per_customer_limit', { integer: true });
  for (const r of [maxDiscount, minOrderValue, usageLimit, perCustomerLimit]) if (r.error) return { error: r.error };

  const startsAt = parseDate(body.starts_at);
  const expiresAt = parseDate(body.expires_at);
  if (isBadDate(startsAt) || isBadDate(expiresAt)) return { error: 'Invalid date' };
  if (startsAt && expiresAt && expiresAt <= startsAt) return { error: 'Expiry must be after the start date' };

  return {
    data: {
      description: body.description ? String(body.description).trim() || null : null,
      type: body.type, value,
      maxDiscount: body.type === 'percent' ? maxDiscount.value : null, // a cap is meaningless on a flat coupon
      minOrderValue: minOrderValue.value, startsAt, expiresAt,
      usageLimit: usageLimit.value, perCustomerLimit: perCustomerLimit.value,
      active: body.active !== false,
    },
  };
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.coupon.findMany({ where: { tenantId: req.tenantId }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map(serializeCoupon));
  } catch (err) { next(err); }
});

router.post('/', requireManager, async (req, res, next) => {
  try {
    const code = normalizeCouponCode(req.body.code);
    if (!code || !CODE_RE.test(code)) return res.status(400).json({ error: 'Code must be 3-20 characters: letters, numbers, - or _' });
    const { data, error } = buildCouponData(req.body);
    if (error) return res.status(400).json({ error });
    const coupon = await prisma.coupon.create({ data: { ...data, code, tenantId: req.tenantId } });
    res.status(201).json(serializeCoupon(coupon));
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A coupon with this code already exists' });
    next(err);
  }
});

router.put('/:id', requireManager, async (req, res, next) => {
  try {
    const existing = await prisma.coupon.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { data, error } = buildCouponData({ ...serializeCoupon(existing), ...req.body });
    if (error) return res.status(400).json({ error });
    const coupon = await prisma.coupon.update({ where: { id: existing.id }, data });
    res.json(serializeCoupon(coupon));
  } catch (err) { next(err); }
});

// A coupon that has ever been redeemed is history — deactivate it instead of deleting.
router.delete('/:id', requireManager, async (req, res, next) => {
  try {
    const existing = await prisma.coupon.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const redeemed = await prisma.couponRedemption.count({ where: { couponId: existing.id } });
    if (redeemed) return res.status(409).json({ error: 'This coupon has been redeemed and cannot be deleted — deactivate it instead' });
    await prisma.coupon.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
