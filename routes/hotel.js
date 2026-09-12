const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeHotelRoom, serializeReservation, num } = require('../utils/serialize');

async function openStaysByRoom(tenantId, roomIds) {
  const stays = await prisma.stayRecord.findMany({
    where: { tenantId, roomId: { in: roomIds }, checkOutAt: null },
  });
  const map = {};
  for (const s of stays) map[s.roomId] = s;
  return map;
}

router.get('/rooms', async (req, res, next) => {
  try {
    const rooms = await prisma.hotelRoom.findMany({ where: { tenantId: req.tenantId }, orderBy: { number: 'asc' } });
    const stays = await openStaysByRoom(req.tenantId, rooms.map((r) => r.id));
    res.json(rooms.map((r) => serializeHotelRoom(r, stays[r.id])));
  } catch (err) { next(err); }
});

router.put('/rooms/:id/status', async (req, res, next) => {
  try {
    const data = {};
    const { status, number, type, floor, rate } = req.body;
    if (status !== undefined) data.status = status;
    if (number !== undefined) data.number = number;
    if (type !== undefined) data.type = type;
    if (floor !== undefined) data.floor = floor;
    if (rate !== undefined) data.rate = rate;

    const r = await prisma.hotelRoom.update({ where: { id: req.params.id }, data });
    const stays = await openStaysByRoom(req.tenantId, [r.id]);
    const out = serializeHotelRoom(r, stays[r.id]);
    req.io.emit('room_updated', out);
    res.json(out);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.get('/reservations', async (req, res, next) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { checkIn: 'asc' },
    });
    res.json(reservations.map(serializeReservation));
  } catch (err) { next(err); }
});

router.post('/checkin', async (req, res, next) => {
  try {
    const { room_id, guest_name, check_in, phone } = req.body;
    const room = await prisma.hotelRoom.findUnique({ where: { id: room_id } });
    if (!room) return res.status(404).json({ error: 'Not found' });

    await prisma.stayRecord.create({
      data: {
        tenantId: req.tenantId, roomId: room_id, guestName: guest_name, phone,
        checkInAt: check_in ? new Date(check_in) : new Date(), checkOutAt: null, rateCharged: room.rate,
      },
    });
    const updated = await prisma.hotelRoom.update({ where: { id: room_id }, data: { status: 'occupied' } });
    const out = serializeHotelRoom(updated, { guestName: guest_name, checkInAt: check_in ? new Date(check_in) : new Date() });
    req.io.emit('room_updated', out);
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/checkout/:id', async (req, res, next) => {
  try {
    const openStay = await prisma.stayRecord.findFirst({
      where: { tenantId: req.tenantId, roomId: req.params.id, checkOutAt: null },
    });
    if (openStay) {
      await prisma.stayRecord.update({ where: { id: openStay.id }, data: { checkOutAt: new Date() } });
    }
    const r = await prisma.hotelRoom.update({ where: { id: req.params.id }, data: { status: 'dirty' } });
    const out = serializeHotelRoom(r, null);
    req.io.emit('room_updated', out);
    res.json(out);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const rooms = await prisma.hotelRoom.findMany({ where: { tenantId: req.tenantId } });
    const total = rooms.length;
    const occupied = rooms.filter((r) => r.status === 'occupied').length;
    const available = rooms.filter((r) => r.status === 'available').length;
    const dirty = rooms.filter((r) => r.status === 'dirty').length;
    const revenue = rooms.filter((r) => r.status === 'occupied').reduce((s, r) => s + num(r.rate), 0);
    res.json({ total, occupied, available, dirty, occupancy: total ? Math.round((occupied / total) * 100) : 0, today_revenue: revenue });
  } catch (err) { next(err); }
});

module.exports = router;
