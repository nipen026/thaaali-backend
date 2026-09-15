// Maps Prisma's camelCase/Decimal/child-table rows back to the legacy snake_case JSON
// shapes the existing frontend already expects, so Phase 1 (Postgres under the hood)
// doesn't require any frontend changes.

const num = (d) => (d === null || d === undefined ? d : Number(d));
const ts = (d) => (d ? new Date(d).getTime() : null);
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const round2 = (n) => Math.round(n * 100) / 100;

function serializeTable(t) {
  return {
    id: t.id,
    number: t.number,
    capacity: t.capacity,
    zone: t.zone,
    status: t.status,
    waiter: t.currentWaiterId,
    guests: t.guests,
    seated_at: ts(t.seatedAt),
    reservation_time: t.reservationTime,
  };
}

function serializeMenuCategory(c) {
  return { id: c.id, name: c.name, icon: c.icon, sort: c.sort };
}

function serializeMenuItem(m) {
  return {
    id: m.id,
    name: m.name,
    category: m.categoryId,
    price: num(m.price),
    pricing_unit: m.pricingUnit,
    type: m.type,
    spice: m.spice,
    dietary: m.dietary,
    available: m.available,
    calories: m.calories,
    orders_count: m.ordersCount,
    description: m.description,
    image: m.image,
  };
}

function serializeOrder(o) {
  return {
    id: o.id,
    table_id: o.tableId,
    table_number: o.table ? o.table.number : null,
    status: o.status,
    channel: o.channel,
    items: (o.items || []).map((i) => ({
      item_id: i.id,
      menu_id: i.menuItemId,
      name: i.nameSnapshot,
      price: num(i.priceSnapshot),
      qty: i.qty,
      unit: i.unit,
      spice: i.spice,
      notes: i.notes,
    })),
    created_at: ts(o.createdAt),
    waiter_id: o.waiterId,
    total: num(o.total),
    customer_name: o.customerName,
    customer_phone: o.customerPhone,
  };
}

function serializeBill(b) {
  return {
    id: b.id,
    bill_number: `TH-${String(b.billNumber).padStart(6, '0')}`,
    table_id: b.tableId,
    orders: (b.billOrders || []).map((bo) => bo.orderId),
    subtotal: num(b.subtotal),
    discount: num(b.discount),
    cgst: num(b.cgst),
    sgst: num(b.sgst),
    total_gst: num(b.totalGst),
    grand_total: num(b.grandTotal),
    payment_method: b.paymentMethod,
    status: b.status,
    customer_name: b.customerName,
    customer_phone: b.customerPhone,
    created_at: ts(b.createdAt),
    paid_at: ts(b.paidAt),
    items: (b.items || []).map((i) => ({
      menu_id: i.menuItemId,
      name: i.nameSnapshot,
      price: num(i.priceSnapshot),
      qty: i.qty,
      unit: i.unit,
    })),
  };
}

function serializeInventoryItem(i) {
  return {
    id: i.id,
    name: i.name,
    unit: i.unit,
    stock: num(i.currentStock),
    reorder_at: num(i.reorderAt),
    price_per_unit: num(i.pricePerUnit),
    supplier: i.supplier,
  };
}

function serializeStaff(profile) {
  return {
    id: profile.userId,
    name: profile.user.name,
    role: profile.user.role,
    shift: profile.shift,
    status: profile.employmentStatus,
    tables_assigned: profile.tablesAssigned,
    phone: profile.phone,
    required_hours_per_day: num(profile.requiredHoursPerDay),
  };
}

// Working hours = gross clocked time minus break time; an open (still-clocked-in) record or
// break counts up to "now" so live in-progress totals make sense, not just closed-out ones.
function computeAttendanceHours(record) {
  const end = record.checkOutAt ? new Date(record.checkOutAt) : new Date();
  const breakMs = (record.breaks || []).reduce((s, b) => {
    const bEnd = b.endAt ? new Date(b.endAt) : new Date();
    return s + (bEnd - new Date(b.startAt));
  }, 0);
  const grossMs = end - new Date(record.checkInAt);
  const workingMs = Math.max(0, grossMs - breakMs);
  return { workingHours: workingMs / 3600000, breakHours: breakMs / 3600000 };
}

function serializeAttendanceRecord(r) {
  const { workingHours, breakHours } = computeAttendanceHours(r);
  const requiredHours = num(r.staffProfile.requiredHoursPerDay);
  return {
    id: r.id,
    staff_id: r.staffProfile.userId,
    name: r.staffProfile.user.name,
    role: r.staffProfile.user.role,
    date: r.date,
    status: r.status,
    check_in: ts(r.checkInAt),
    check_out: ts(r.checkOutAt),
    working_hours: round2(workingHours),
    break_hours: round2(breakHours),
    required_hours: requiredHours,
    variance_hours: round2(workingHours - requiredHours),
    marked_by_manager: !!r.markedBy,
    breaks: (r.breaks || []).map((b) => ({ start: ts(b.startAt), end: ts(b.endAt) })),
  };
}

// `openStay` is the stay_records row with checkOutAt still null, if any (i.e. current occupant).
function serializeHotelRoom(r, openStay) {
  return {
    id: r.id,
    number: r.number,
    type: r.type,
    floor: r.floor,
    status: r.status,
    guest: openStay ? openStay.guestName : null,
    check_in: openStay ? dateOnly(openStay.checkInAt) : null,
    check_out: null,
    rate: num(r.rate),
  };
}

function serializeReservation(r) {
  return {
    id: r.id,
    guest_name: r.guestName,
    room_type: r.roomType,
    check_in: dateOnly(r.checkIn),
    check_out: dateOnly(r.checkOut),
    guests: r.guests,
    status: r.status,
    phone: r.phone,
  };
}

function serializeUser(u) {
  return { id: u.id, name: u.name, role: u.role, avatar: u.avatar, email: u.email };
}

function serializeTenant(t) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    business_type: t.businessType,
    currency: t.currency,
    gst_rate: num(t.gstRate),
    timezone: t.timezone,
    address: t.address,
    phone: t.phone,
    gstin: t.gstin,
  };
}

function serializeCustomer(c) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    orders_count: c.ordersCount,
    total_spend: num(c.totalSpend),
    last_order_at: ts(c.lastOrderAt),
  };
}

module.exports = {
  num, ts, dateOnly, round2,
  serializeTable, serializeMenuCategory, serializeMenuItem, serializeOrder, serializeBill,
  serializeInventoryItem, serializeStaff, serializeHotelRoom, serializeReservation, serializeUser,
  serializeTenant, computeAttendanceHours, serializeAttendanceRecord, serializeCustomer,
};
