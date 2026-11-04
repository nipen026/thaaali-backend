// Server-side bill pricing: promotions (per line) -> coupon (bill level) -> manual discount
// (bill level). The client never sends a final discount figure for promotions/coupons — it sends
// a coupon *code* and the server works out what that's worth, so a tampered request can't mint
// a bigger discount. `priceBill` is pure (no DB) so it can be unit-tested; `loadPricingContext`
// is the thin DB layer around it.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (d) => (d === null || d === undefined ? d : Number(d));

// Day-of-week (0 = Sunday) and minutes-since-midnight in the tenant's timezone — promotions are
// authored in the restaurant's local time ("happy hour 4-7pm"), not the server's.
function localParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { dow, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function promotionIsLive(promo, now, timeZone) {
  if (!promo.active) return false;
  if (promo.startsAt && now < new Date(promo.startsAt)) return false;
  if (promo.endsAt && now > new Date(promo.endsAt)) return false;
  const { dow, minutes } = localParts(now, timeZone);
  if (promo.daysOfWeek?.length && !promo.daysOfWeek.includes(dow)) return false;
  if (promo.startTime && promo.endTime) {
    const from = toMinutes(promo.startTime);
    const to = toMinutes(promo.endTime);
    const inWindow = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to; // wraps midnight
    if (!inWindow) return false;
  }
  return true;
}

function promotionAppliesToLine(promo, line) {
  if (promo.scope === 'all') return true;
  if (promo.scope === 'category') return !!line.categoryId && promo.categoryIds.includes(line.categoryId);
  return !!line.menuItemId && promo.menuItemIds.includes(line.menuItemId);
}

// Flat promotions are "₹ off each unit"; a gram-priced line has no meaningful unit count (qty is
// grams), so it gets the flat amount once.
function promotionDiscountForLine(promo, line) {
  const value = num(promo.value);
  const raw = promo.type === 'percent'
    ? line.lineTotal * (value / 100)
    : value * (line.unit === 'gram' ? 1 : line.qty);
  return round2(Math.min(raw, line.lineTotal));
}

// Returns { ok: true, discount } or { ok: false, error }. `now` is injected for testability.
function evaluateCoupon(coupon, { subtotal, customerPhone, customerUses, now }) {
  if (!coupon || !coupon.active) return { ok: false, error: 'Coupon is not valid' };
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return { ok: false, error: 'Coupon is not active yet' };
  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) return { ok: false, error: 'Coupon has expired' };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { ok: false, error: 'Coupon usage limit reached' };
  if (coupon.perCustomerLimit != null) {
    if (!customerPhone) return { ok: false, error: 'Customer phone is required to use this coupon' };
    if (customerUses >= coupon.perCustomerLimit) return { ok: false, error: 'Customer has already used this coupon the maximum number of times' };
  }
  const min = num(coupon.minOrderValue);
  if (min != null && subtotal < min) return { ok: false, error: `Minimum order of ₹${min} required for this coupon` };

  let discount = coupon.type === 'percent' ? subtotal * (num(coupon.value) / 100) : num(coupon.value);
  const cap = num(coupon.maxDiscount);
  if (cap != null) discount = Math.min(discount, cap);
  discount = round2(Math.min(discount, subtotal));
  if (discount <= 0) return { ok: false, error: 'Coupon gives no discount on this order' };
  return { ok: true, discount };
}

// Spreads a bill-level discount across lines proportionally to their post-promotion value, so
// every line carries its complete discount (that's what lets the Ledger report per-dish
// discounts). The last line absorbs rounding drift so the shares sum exactly to `amount`.
function allocateAcrossLines(amount, weights) {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (amount <= 0 || totalWeight <= 0) return weights.map(() => 0);
  const shares = [];
  let allocated = 0;
  weights.forEach((w, i) => {
    const share = i === weights.length - 1 ? round2(amount - allocated) : round2(amount * (w / totalWeight));
    const capped = Math.min(Math.max(share, 0), w);
    shares.push(capped);
    allocated = round2(allocated + capped);
  });
  return shares;
}

// items: [{ menuItemId, categoryId, name, price, qty, unit }]
// coupon: Coupon row or null; couponCode: what was asked for (to report "not found")
function priceBill({ items, promotions = [], coupon = null, couponCode = null, customerPhone = null, customerUses = 0, manualDiscount = 0, now = new Date(), timeZone = 'Asia/Kolkata' }) {
  const live = promotions.filter((p) => promotionIsLive(p, now, timeZone));

  const lines = items.map((it) => {
    const lineTotal = round2(it.price * it.qty);
    let best = null;
    for (const promo of live) {
      if (!promotionAppliesToLine(promo, { ...it, lineTotal })) continue;
      const amount = promotionDiscountForLine(promo, { ...it, lineTotal });
      if (amount > 0 && (!best || amount > best.amount)) best = { promo, amount };
    }
    return {
      ...it,
      lineTotal,
      promotionId: best ? best.promo.id : null,
      promotionName: best ? best.promo.name : null,
      promotionDiscount: best ? best.amount : 0,
    };
  });

  const gross = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const promotionDiscount = round2(lines.reduce((s, l) => s + l.promotionDiscount, 0));
  const afterPromotions = round2(gross - promotionDiscount);

  let couponDiscount = 0;
  let appliedCoupon = null;
  let couponError = null;
  if (couponCode) {
    if (!coupon) couponError = 'Coupon code not found';
    else {
      const result = evaluateCoupon(coupon, { subtotal: afterPromotions, customerPhone, customerUses, now });
      if (result.ok) { couponDiscount = result.discount; appliedCoupon = { id: coupon.id, code: coupon.code }; }
      else couponError = result.error;
    }
  }

  const manual = round2(Math.min(Math.max(Number(manualDiscount) || 0, 0), afterPromotions - couponDiscount));
  const billLevel = round2(couponDiscount + manual);

  const weights = lines.map((l) => round2(l.lineTotal - l.promotionDiscount));
  const shares = allocateAcrossLines(billLevel, weights);
  lines.forEach((l, i) => { l.discountAmount = round2(l.promotionDiscount + shares[i]); });

  const discount = round2(promotionDiscount + billLevel);
  return {
    lines,
    gross,
    promotion_discount: promotionDiscount,
    coupon_discount: couponDiscount,
    manual_discount: manual,
    discount,
    net: round2(gross - discount),
    coupon: appliedCoupon,
    coupon_error: couponError,
  };
}

// Loads everything priceBill needs for a set of orders. `db` may be the global client or a
// transaction client, so generate() can read the same snapshot it then writes against.
async function loadPricingContext(db, { tenantId, orders, couponCode, customerPhone }) {
  const menuIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.menuItemId)).filter(Boolean))];
  const [tenant, menuRows, promotions, coupon] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
    menuIds.length ? db.menuItem.findMany({ where: { tenantId, id: { in: menuIds } }, select: { id: true, categoryId: true } }) : [],
    db.promotion.findMany({ where: { tenantId, active: true } }),
    couponCode ? db.coupon.findUnique({ where: { tenantId_code: { tenantId, code: couponCode } } }) : null,
  ]);
  const categoryByMenu = Object.fromEntries(menuRows.map((m) => [m.id, m.categoryId]));
  const items = orders.flatMap((o) => o.items.map((i) => ({
    menuItemId: i.menuItemId,
    categoryId: i.menuItemId ? categoryByMenu[i.menuItemId] || null : null,
    name: i.nameSnapshot,
    price: Number(i.priceSnapshot),
    qty: i.qty,
    unit: i.unit,
  })));
  const customerUses = coupon && coupon.perCustomerLimit != null && customerPhone
    ? await db.couponRedemption.count({ where: { couponId: coupon.id, customerPhone } })
    : 0;
  return { items, promotions, coupon, customerUses, timeZone: tenant?.timezone || 'Asia/Kolkata' };
}

const normalizeCouponCode = (code) => (code ? String(code).trim().toUpperCase() : null);

module.exports = { allocateAcrossLines, priceBill, loadPricingContext, evaluateCoupon, promotionIsLive, normalizeCouponCode, round2 };
