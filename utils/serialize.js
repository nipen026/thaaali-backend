// Maps Prisma's camelCase/Decimal/child-table rows back to the legacy snake_case JSON
// shapes the existing frontend already expects, so Phase 1 (Postgres under the hood)
// doesn't require any frontend changes.

const num = (d) => (d === null || d === undefined ? d : Number(d));
const ts = (d) => (d ? new Date(d).getTime() : null);
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

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
      spice: i.spice,
      notes: i.notes,
    })),
    created_at: ts(o.createdAt),
    waiter_id: o.waiterId,
    total: num(o.total),
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
    created_at: ts(b.createdAt),
    paid_at: ts(b.paidAt),
    items: (b.items || []).map((i) => ({
      menu_id: i.menuItemId,
      name: i.nameSnapshot,
      price: num(i.priceSnapshot),
      qty: i.qty,
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
  };
}

module.exports = {
  num, ts, dateOnly,
  serializeTable, serializeMenuCategory, serializeMenuItem, serializeOrder, serializeBill,
  serializeInventoryItem, serializeStaff, serializeHotelRoom, serializeReservation, serializeUser,
  serializeTenant,
};
