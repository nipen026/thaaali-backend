require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');

if (!prisma) {
  console.error('❌ DATABASE_URL is not set — cannot seed.');
  process.exit(1);
}

// Mirrors the seed data that used to live in data/db.js, now targeting one demo tenant in Postgres.
const legacyUsers = [
  { id: 'u1', name: 'Rajesh Patel', email: 'owner@thaali.in', role: 'owner', avatar: 'RP' },
  { id: 'u2', name: 'Anjali Sharma', email: 'manager@thaali.in', role: 'restaurant_manager', avatar: 'AS' },
  { id: 'u3', name: 'Ramesh Bhai', email: 'waiter@thaali.in', role: 'waiter', avatar: 'RB' },
  { id: 'u4', name: 'Sunita Desai', email: 'cashier@thaali.in', role: 'cashier', avatar: 'SD' },
  { id: 'u5', name: 'Chef Kumar', email: 'kitchen@thaali.in', role: 'kitchen', avatar: 'CK' },
  { id: 'u6', name: 'Priya Shah', email: 'hotel@thaali.in', role: 'hotel_desk', avatar: 'PS' },
  { id: 'u9', name: 'Kavita Rao', email: 'hotel.manager@thaali.in', role: 'hotel_manager', avatar: 'KR' },
  // staff-only in the legacy db (no login record existed for these) — given one here so StaffProfile can be 1:1 with User.
  { id: 'u7', name: 'Vijay Singh', email: 'vijay.singh@thaali.demo', role: 'waiter', avatar: 'VS' },
  { id: 'u8', name: 'Meena Kumari', email: 'meena.kumari@thaali.demo', role: 'kitchen', avatar: 'MK' },
];

const legacyTables = [
  { id: 't1', number: 1, capacity: 2, zone: 'indoor', status: 'occupied', waiter: 'u3', guests: 2, seatedMinsAgo: 30 },
  { id: 't2', number: 2, capacity: 4, zone: 'indoor', status: 'available', waiter: null, guests: 0 },
  { id: 't3', number: 3, capacity: 4, zone: 'indoor', status: 'bill_requested', waiter: 'u3', guests: 3, seatedMinsAgo: 60 },
  { id: 't4', number: 4, capacity: 6, zone: 'indoor', status: 'occupied', waiter: 'u3', guests: 5, seatedMinsAgo: 15 },
  { id: 't5', number: 5, capacity: 2, zone: 'outdoor', status: 'reserved', waiter: null, guests: 0, reservationTime: '19:30' },
  { id: 't6', number: 6, capacity: 4, zone: 'outdoor', status: 'available', waiter: null, guests: 0 },
  { id: 't7', number: 7, capacity: 8, zone: 'outdoor', status: 'occupied', waiter: 'u3', guests: 6, seatedMinsAgo: 40 },
  { id: 't8', number: 8, capacity: 4, zone: 'private', status: 'occupied', waiter: 'u3', guests: 4, seatedMinsAgo: 10 },
  { id: 't9', number: 9, capacity: 2, zone: 'private', status: 'available', waiter: null, guests: 0 },
  { id: 't10', number: 10, capacity: 4, zone: 'indoor', status: 'available', waiter: null, guests: 0 },
  { id: 't11', number: 11, capacity: 6, zone: 'indoor', status: 'bill_requested', waiter: 'u3', guests: 4, seatedMinsAgo: 70 },
  { id: 't12', number: 12, capacity: 4, zone: 'outdoor', status: 'occupied', waiter: 'u3', guests: 3, seatedMinsAgo: 20 },
];

const legacyCategories = [
  { id: 'c1', name: 'Starters', icon: '🥗', sort: 1 },
  { id: 'c2', name: 'Main Course', icon: '🍛', sort: 2 },
  { id: 'c3', name: 'Breads', icon: '🫓', sort: 3 },
  { id: 'c4', name: 'Rice & Biryani', icon: '🍚', sort: 4 },
  { id: 'c5', name: 'Dal & Curries', icon: '🥘', sort: 5 },
  { id: 'c6', name: 'Desserts', icon: '🍮', sort: 6 },
  { id: 'c7', name: 'Beverages', icon: '🥤', sort: 7 },
];

const legacyItems = [
  { id: 'm1', name: 'Paneer Tikka', category: 'c1', price: 280, type: 'veg', spice: 'medium', dietary: ['jain_option'], available: true, calories: 320, ordersCount: 847, description: 'Tandoor-grilled cottage cheese with bell peppers', image: '🧀' },
  { id: 'm2', name: 'Veg Spring Rolls', category: 'c1', price: 180, type: 'veg', spice: 'mild', dietary: ['jain', 'vegan'], available: true, calories: 220, ordersCount: 423, description: 'Crispy rolls with mixed vegetables', image: '🥢' },
  { id: 'm3', name: 'Chicken Tikka', category: 'c1', price: 320, type: 'non_veg', spice: 'hot', dietary: [], available: true, calories: 380, ordersCount: 1203, description: 'Marinated chicken pieces in tandoor', image: '🍗' },
  { id: 'm4', name: 'Hara Bhara Kebab', category: 'c1', price: 220, type: 'veg', spice: 'mild', dietary: ['vegan', 'jain'], available: true, calories: 180, ordersCount: 312, description: 'Spinach and pea kebabs', image: '🟢' },
  { id: 'm5', name: 'Paneer Butter Masala', category: 'c2', price: 320, type: 'veg', spice: 'medium', dietary: ['jain_option'], available: true, calories: 480, ordersCount: 1567, description: 'Cottage cheese in rich tomato-cream sauce', image: '🧀' },
  { id: 'm6', name: 'Dal Makhani', category: 'c5', price: 240, type: 'veg', spice: 'mild', dietary: ['jain_option'], available: true, calories: 340, ordersCount: 934, description: 'Slow-cooked black lentils with butter and cream', image: '🫘' },
  { id: 'm7', name: 'Butter Chicken', category: 'c2', price: 360, type: 'non_veg', spice: 'mild', dietary: [], available: true, calories: 520, ordersCount: 2104, description: 'Tender chicken in velvety tomato-butter gravy', image: '🍗' },
  { id: 'm8', name: 'Veg Biryani', category: 'c4', price: 280, type: 'veg', spice: 'medium', dietary: ['jain_option'], available: true, calories: 560, ordersCount: 678, description: 'Fragrant basmati with seasonal vegetables', image: '🍚' },
  { id: 'm9', name: 'Chicken Biryani', category: 'c4', price: 380, type: 'non_veg', spice: 'hot', dietary: [], available: true, calories: 680, ordersCount: 1890, description: 'Dum-cooked chicken with aromatic spices', image: '🍚' },
  { id: 'm10', name: 'Garlic Naan', category: 'c3', price: 60, type: 'veg', spice: 'mild', dietary: [], available: true, calories: 160, ordersCount: 2341, description: 'Soft tandoor bread with garlic butter', image: '🫓' },
  { id: 'm11', name: 'Butter Roti', category: 'c3', price: 40, type: 'veg', spice: 'mild', dietary: ['jain'], available: true, calories: 120, ordersCount: 1876, description: 'Whole wheat bread with butter', image: '🫓' },
  { id: 'm12', name: 'Gulab Jamun', category: 'c6', price: 120, type: 'veg', spice: 'none', dietary: ['jain'], available: true, calories: 280, ordersCount: 543, description: 'Milk-solid dumplings in rose-flavored syrup', image: '🍮' },
  { id: 'm13', name: 'Mango Lassi', category: 'c7', price: 120, type: 'veg', spice: 'none', dietary: ['jain', 'gluten_free'], available: true, calories: 220, ordersCount: 892, description: 'Fresh mango blended with yogurt', image: '🥭' },
  { id: 'm14', name: 'Masala Chai', category: 'c7', price: 60, type: 'veg', spice: 'mild', dietary: ['jain', 'gluten_free'], available: true, calories: 80, ordersCount: 1234, description: 'Spiced Indian tea with milk', image: '🍵' },
  { id: 'm15', name: 'Palak Paneer', category: 'c2', price: 300, type: 'veg', spice: 'mild', dietary: ['jain_option', 'gluten_free'], available: false, calories: 380, ordersCount: 756, description: 'Cottage cheese in creamy spinach gravy', image: '🥬' },
  { id: 'm16', name: 'Mutton Rogan Josh', category: 'c2', price: 420, type: 'non_veg', spice: 'extra_hot', dietary: [], available: true, calories: 580, ordersCount: 623, description: 'Kashmiri slow-cooked mutton', image: '🥩' },
];

const legacyOrders = [
  { id: 'o1', table: 't1', status: 'preparing', channel: 'dine_in', waiter: 'u3', minsAgo: 15,
    items: [{ menu: 'm5', qty: 2, spice: 'medium', notes: '' }, { menu: 'm10', qty: 4, spice: 'mild', notes: '' }] },
  { id: 'o2', table: 't3', status: 'ready', channel: 'dine_in', waiter: 'u3', minsAgo: 30,
    items: [{ menu: 'm6', qty: 1, spice: 'mild', notes: 'Less butter' }, { menu: 'm8', qty: 2, spice: 'medium', notes: '' }] },
  { id: 'o3', table: 't7', status: 'preparing', channel: 'dine_in', waiter: 'u3', minsAgo: 5,
    items: [{ menu: 'm7', qty: 3, spice: 'mild', notes: 'Extra gravy' }, { menu: 'm11', qty: 6, spice: 'mild', notes: '' }] },
  { id: 'o4', table: null, status: 'preparing', channel: 'zomato', waiter: null, minsAgo: 2,
    items: [{ menu: 'm9', qty: 2, spice: 'hot', notes: '' }, { menu: 'm13', qty: 2, spice: 'none', notes: '' }] },
];

const legacyInventory = [
  { name: 'Paneer', unit: 'kg', currentStock: 4.5, reorderAt: 2, pricePerUnit: 320, supplier: 'Amul Dairy' },
  { name: 'Chicken', unit: 'kg', currentStock: 8.2, reorderAt: 5, pricePerUnit: 180, supplier: 'Fresh Farms' },
  { name: 'Basmati Rice', unit: 'kg', currentStock: 15.0, reorderAt: 8, pricePerUnit: 90, supplier: 'India Gate' },
  { name: 'Tomatoes', unit: 'kg', currentStock: 1.2, reorderAt: 3, pricePerUnit: 40, supplier: 'Local Mandi' },
  { name: 'Onions', unit: 'kg', currentStock: 6.8, reorderAt: 4, pricePerUnit: 35, supplier: 'Local Mandi' },
  { name: 'Butter', unit: 'kg', currentStock: 2.1, reorderAt: 1, pricePerUnit: 480, supplier: 'Amul Dairy' },
  { name: 'Cream', unit: 'litre', currentStock: 0.8, reorderAt: 1, pricePerUnit: 220, supplier: 'Amul Dairy' },
  { name: 'Mutton', unit: 'kg', currentStock: 3.5, reorderAt: 2, pricePerUnit: 650, supplier: 'Fresh Farms' },
  { name: 'Maida', unit: 'kg', currentStock: 9.0, reorderAt: 5, pricePerUnit: 45, supplier: 'Local Mill' },
  { name: 'Cooking Oil', unit: 'litre', currentStock: 5.5, reorderAt: 3, pricePerUnit: 130, supplier: 'Fortune' },
];

const legacyStaff = [
  { user: 'u3', shift: 'morning', employmentStatus: 'active', tablesAssigned: ['indoor'], phone: '9876543210' },
  { user: 'u5', shift: 'morning', employmentStatus: 'active', tablesAssigned: [], phone: '9876543211' },
  { user: 'u4', shift: 'morning', employmentStatus: 'active', tablesAssigned: [], phone: '9876543212' },
  { user: 'u7', shift: 'evening', employmentStatus: 'inactive', tablesAssigned: ['outdoor'], phone: '9876543213' },
  { user: 'u8', shift: 'evening', employmentStatus: 'inactive', tablesAssigned: [], phone: '9876543214' },
  { user: 'u9', shift: 'morning', employmentStatus: 'active', tablesAssigned: [], phone: '9876543215' },
];

const legacyRooms = [
  { id: 'r1', number: '101', type: 'Standard', floor: 1, status: 'occupied', guest: 'Arun Mehta', checkIn: '2026-06-27', rate: 2500 },
  { id: 'r2', number: '102', type: 'Standard', floor: 1, status: 'available', rate: 2500 },
  { id: 'r3', number: '103', type: 'Standard', floor: 1, status: 'dirty', rate: 2500 },
  { id: 'r4', number: '201', type: 'Deluxe', floor: 2, status: 'occupied', guest: 'Priya Nair', checkIn: '2026-06-28', rate: 4000 },
  { id: 'r5', number: '202', type: 'Deluxe', floor: 2, status: 'occupied', guest: 'Vikram Joshi', checkIn: '2026-06-29', rate: 4000 },
  { id: 'r6', number: '203', type: 'Deluxe', floor: 2, status: 'available', rate: 4000 },
  { id: 'r7', number: '301', type: 'Suite', floor: 3, status: 'occupied', guest: 'Deepak Shah', checkIn: '2026-06-26', rate: 7500 },
  { id: 'r8', number: '302', type: 'Suite', floor: 3, status: 'available', rate: 7500 },
  { id: 'r9', number: '303', type: 'Suite', floor: 3, status: 'inspecting', rate: 7500 },
  { id: 'r10', number: '401', type: 'Presidential', floor: 4, status: 'occupied', guest: 'Ratan Tata Jr.', checkIn: '2026-06-25', rate: 15000 },
];

const legacyReservations = [
  { guestName: 'Neha Patel', roomType: 'Deluxe', checkIn: '2026-06-30', checkOut: '2026-07-02', guests: 2, status: 'confirmed', phone: '9876543220' },
  { guestName: 'Suresh Kumar', roomType: 'Standard', checkIn: '2026-07-01', checkOut: '2026-07-03', guests: 1, status: 'confirmed', phone: '9876543221' },
];

async function wipeExistingDemoTenant() {
  const existing = await prisma.tenant.findUnique({ where: { slug: 'thaali-demo' } });
  if (!existing) return;
  const tenantId = existing.id;

  await prisma.inventoryTransaction.deleteMany({ where: { tenantId } });
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.billItem.deleteMany({ where: { bill: { tenantId } } });
  await prisma.billOrder.deleteMany({ where: { bill: { tenantId } } });
  await prisma.bill.deleteMany({ where: { tenantId } });
  await prisma.orderItem.deleteMany({ where: { order: { tenantId } } });
  await prisma.order.deleteMany({ where: { tenantId } });
  await prisma.stayRecord.deleteMany({ where: { tenantId } });
  await prisma.reservation.deleteMany({ where: { tenantId } });
  await prisma.hotelRoom.deleteMany({ where: { tenantId } });
  await prisma.inventoryItem.deleteMany({ where: { tenantId } });
  await prisma.staffProfile.deleteMany({ where: { tenantId } });
  await prisma.menuItem.deleteMany({ where: { tenantId } });
  await prisma.menuCategory.deleteMany({ where: { tenantId } });
  await prisma.restaurantTable.deleteMany({ where: { tenantId } });
  await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.dailyAggregate.deleteMany({ where: { tenantId } });
  await prisma.counter.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}

async function seed() {
  await wipeExistingDemoTenant();

  const tenant = await prisma.tenant.create({
    data: {
      slug: 'thaali-demo',
      name: 'THAALI Demo Restaurant & Hotel',
      businessType: 'both',
      planTier: 'pro',
      planStatus: 'active',
      planSeats: 10,
      planFeatures: ['restaurant', 'hotel'],
    },
  });
  const tenantId = tenant.id;

  const passwordHash = await bcrypt.hash('thaali123', 10);
  const userIdMap = {};
  for (const u of legacyUsers) {
    const doc = await prisma.user.create({
      data: { tenantId, email: u.email, passwordHash, name: u.name, avatar: u.avatar, role: u.role },
    });
    userIdMap[u.id] = doc.id;
  }

  const tableIdMap = {};
  for (const t of legacyTables) {
    const doc = await prisma.restaurantTable.create({
      data: {
        tenantId, number: t.number, capacity: t.capacity, zone: t.zone, status: t.status,
        currentWaiterId: t.waiter ? userIdMap[t.waiter] : null, guests: t.guests,
        seatedAt: t.seatedMinsAgo ? new Date(Date.now() - t.seatedMinsAgo * 60000) : null,
        reservationTime: t.reservationTime || null,
      },
    });
    tableIdMap[t.id] = doc.id;
  }

  const categoryIdMap = {};
  for (const c of legacyCategories) {
    const doc = await prisma.menuCategory.create({ data: { tenantId, name: c.name, icon: c.icon, sort: c.sort } });
    categoryIdMap[c.id] = doc.id;
  }

  const itemIdMap = {};
  const itemNamePriceMap = {};
  for (const m of legacyItems) {
    const doc = await prisma.menuItem.create({
      data: {
        tenantId, categoryId: categoryIdMap[m.category], name: m.name, price: m.price, type: m.type,
        spice: m.spice, dietary: m.dietary, available: m.available, calories: m.calories,
        description: m.description, image: m.image, ordersCount: m.ordersCount,
      },
    });
    itemIdMap[m.id] = doc.id;
    itemNamePriceMap[m.id] = { name: m.name, price: m.price };
  }

  for (const o of legacyOrders) {
    const items = o.items.map(i => ({
      menuItemId: itemIdMap[i.menu],
      nameSnapshot: itemNamePriceMap[i.menu].name,
      priceSnapshot: itemNamePriceMap[i.menu].price,
      qty: i.qty,
      spice: i.spice,
      notes: i.notes,
    }));
    const total = items.reduce((s, i) => s + i.priceSnapshot * i.qty, 0);
    await prisma.order.create({
      data: {
        tenantId, tableId: o.table ? tableIdMap[o.table] : null, channel: o.channel, status: o.status,
        waiterId: o.waiter ? userIdMap[o.waiter] : null, total,
        createdAt: new Date(Date.now() - o.minsAgo * 60000),
        items: { create: items },
      },
    });
  }

  for (const i of legacyInventory) {
    await prisma.inventoryItem.create({ data: { tenantId, ...i } });
  }

  for (const s of legacyStaff) {
    await prisma.staffProfile.create({
      data: {
        tenantId, userId: userIdMap[s.user], shift: s.shift,
        tablesAssigned: s.tablesAssigned, phone: s.phone, employmentStatus: s.employmentStatus,
      },
    });
  }

  for (const r of legacyRooms) {
    const doc = await prisma.hotelRoom.create({
      data: { tenantId, number: r.number, type: r.type, floor: r.floor, status: r.status, rate: r.rate },
    });
    if (r.status === 'occupied' && r.guest) {
      await prisma.stayRecord.create({
        data: {
          tenantId, roomId: doc.id, guestName: r.guest, checkInAt: new Date(r.checkIn),
          checkOutAt: null, rateCharged: r.rate,
        },
      });
    }
  }

  for (const r of legacyReservations) {
    await prisma.reservation.create({
      data: {
        tenantId, guestName: r.guestName, phone: r.phone, roomType: r.roomType,
        checkIn: new Date(r.checkIn), checkOut: new Date(r.checkOut), guests: r.guests, status: r.status,
      },
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  await prisma.dailyAggregate.create({
    data: {
      tenantId, date: today, revenue: 0, ordersCount: legacyOrders.length, avgOrderValue: 0, covers: 0,
      channelSplit: { dine_in: 0, delivery: 0, direct_web: 0, whatsapp: 0 },
      hourlyBuckets: Array(24).fill(0),
    },
  });

  console.log(`✅ Seeded tenant "${tenant.slug}" (${tenantId})`);
  console.log('   Demo logins (password: thaali123):');
  legacyUsers.slice(0, 7).forEach(u => console.log(`   - ${u.email} (${u.role})`));
}

seed()
  .catch(err => {
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
