const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeAttendanceRecord, round2, num } = require('../utils/serialize');

const MANAGE_ROLES = ['owner', 'restaurant_manager', 'hotel_manager'];

function todayStr() { return new Date().toISOString().slice(0, 10); }

const withRecordRelations = { staffProfile: { include: { user: true } }, breaks: true };

function canViewReports(req, res) {
  if (!MANAGE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: 'Only owners and managers can view attendance reports' });
    return false;
  }
  return true;
}

function parseRange(req, res) {
  const { from, to } = req.query;
  if (!from || !to) { res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' }); return null; }
  return { from, to };
}

// Resolves which StaffProfile a mutating request targets: the caller's own profile by default,
// or (with an explicit staff_id that differs from the caller) a manager-initiated override on
// someone else's — gated to MANAGE_ROLES so a waiter can't clock another waiter in/out.
async function resolveTargetProfile(req, res) {
  const { staff_id } = req.body;
  let targetUserId = req.user.id;
  if (staff_id && staff_id !== req.user.id) {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: 'Only owners and managers can mark attendance for someone else' });
      return null;
    }
    targetUserId = staff_id;
  }
  const profile = await prisma.staffProfile.findFirst({ where: { userId: targetUserId, tenantId: req.tenantId } });
  if (!profile) {
    res.status(404).json({ error: 'No staff profile found for this account' });
    return null;
  }
  return { profile, markedBy: targetUserId === req.user.id ? null : req.user.id };
}

router.get('/today', async (req, res, next) => {
  try {
    const date = todayStr();
    const myProfile = await prisma.staffProfile.findFirst({ where: { userId: req.user.id, tenantId: req.tenantId } });

    let mine = null;
    if (myProfile) {
      const record = await prisma.attendanceRecord.findUnique({
        where: { staffProfileId_date: { staffProfileId: myProfile.id, date } },
        include: withRecordRelations,
      });
      mine = record ? serializeAttendanceRecord(record) : null;
    }

    let roster;
    if (MANAGE_ROLES.includes(req.user.role)) {
      const profiles = await prisma.staffProfile.findMany({
        where: { tenantId: req.tenantId, employmentStatus: 'active' },
        include: { user: true, attendanceRecords: { where: { date }, include: { breaks: true } } },
      });
      roster = profiles.map((p) => {
        const record = p.attendanceRecords[0];
        if (!record) return { staff_id: p.userId, name: p.user.name, role: p.user.role, status: 'not_checked_in' };
        return serializeAttendanceRecord({ ...record, staffProfile: p });
      });
    }

    res.json({ has_profile: !!myProfile, mine, roster });
  } catch (err) { next(err); }
});

router.post('/check-in', async (req, res, next) => {
  try {
    const resolved = await resolveTargetProfile(req, res);
    if (!resolved) return;
    const { profile, markedBy } = resolved;
    const date = todayStr();

    const existing = await prisma.attendanceRecord.findUnique({
      where: { staffProfileId_date: { staffProfileId: profile.id, date } },
    });
    if (existing) {
      return res.status(400).json({ error: existing.checkOutAt ? 'Already checked out for today' : 'Already checked in' });
    }

    const record = await prisma.attendanceRecord.create({
      data: { tenantId: req.tenantId, staffProfileId: profile.id, date, checkInAt: new Date(), status: 'checked_in', markedBy },
      include: withRecordRelations,
    });
    const out = serializeAttendanceRecord(record);
    req.io.emit('attendance_updated', out);
    res.status(201).json(out);
  } catch (err) { next(err); }
});

router.post('/check-out', async (req, res, next) => {
  try {
    const resolved = await resolveTargetProfile(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const date = todayStr();

    const existing = await prisma.attendanceRecord.findUnique({
      where: { staffProfileId_date: { staffProfileId: profile.id, date } },
      include: { breaks: true },
    });
    if (!existing || existing.checkOutAt) return res.status(400).json({ error: 'Not currently checked in' });

    const now = new Date();
    const openBreak = existing.breaks.find((b) => !b.endAt);
    if (openBreak) await prisma.attendanceBreak.update({ where: { id: openBreak.id }, data: { endAt: now } });

    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: { checkOutAt: now, status: 'checked_out' },
      include: withRecordRelations,
    });
    const out = serializeAttendanceRecord(record);
    req.io.emit('attendance_updated', out);
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/break/start', async (req, res, next) => {
  try {
    const resolved = await resolveTargetProfile(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const date = todayStr();

    const existing = await prisma.attendanceRecord.findUnique({
      where: { staffProfileId_date: { staffProfileId: profile.id, date } },
    });
    if (!existing || existing.status !== 'checked_in') {
      return res.status(400).json({ error: 'Must be checked in (and not already on break) to start a break' });
    }

    await prisma.attendanceBreak.create({ data: { attendanceRecordId: existing.id, startAt: new Date() } });
    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id }, data: { status: 'on_break' }, include: withRecordRelations,
    });
    const out = serializeAttendanceRecord(record);
    req.io.emit('attendance_updated', out);
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/break/end', async (req, res, next) => {
  try {
    const resolved = await resolveTargetProfile(req, res);
    if (!resolved) return;
    const { profile } = resolved;
    const date = todayStr();

    const existing = await prisma.attendanceRecord.findUnique({
      where: { staffProfileId_date: { staffProfileId: profile.id, date } },
      include: { breaks: true },
    });
    if (!existing || existing.status !== 'on_break') return res.status(400).json({ error: 'Not currently on a break' });

    const openBreak = existing.breaks.find((b) => !b.endAt);
    if (openBreak) await prisma.attendanceBreak.update({ where: { id: openBreak.id }, data: { endAt: new Date() } });

    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id }, data: { status: 'checked_in' }, include: withRecordRelations,
    });
    const out = serializeAttendanceRecord(record);
    req.io.emit('attendance_updated', out);
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    if (!canViewReports(req, res)) return;
    const range = parseRange(req, res);
    if (!range) return;
    const { staff_id } = req.query;

    const where = { tenantId: req.tenantId, date: { gte: range.from, lte: range.to } };
    if (staff_id) {
      const profile = await prisma.staffProfile.findFirst({ where: { userId: staff_id, tenantId: req.tenantId } });
      if (!profile) return res.json([]);
      where.staffProfileId = profile.id;
    }

    const records = await prisma.attendanceRecord.findMany({ where, include: withRecordRelations, orderBy: { date: 'desc' } });
    res.json(records.map(serializeAttendanceRecord));
  } catch (err) { next(err); }
});

// Per-staff aggregate over the range: days present, total hours worked, total break time,
// required hours (requiredHoursPerDay × days present), and the variance between the two —
// plus each day's raw record for a drill-down view.
router.get('/report', async (req, res, next) => {
  try {
    if (!canViewReports(req, res)) return;
    const range = parseRange(req, res);
    if (!range) return;
    const { staff_id } = req.query;

    const profileWhere = { tenantId: req.tenantId };
    if (staff_id) profileWhere.userId = staff_id;

    const profiles = await prisma.staffProfile.findMany({
      where: profileWhere,
      include: {
        user: true,
        attendanceRecords: {
          where: { date: { gte: range.from, lte: range.to } },
          include: { breaks: true },
          orderBy: { date: 'asc' },
        },
      },
    });

    const staffReport = profiles.map((p) => {
      const records = p.attendanceRecords.map((r) => serializeAttendanceRecord({ ...r, staffProfile: p }));
      const daysPresent = records.length;
      const totalWorkingHours = records.reduce((s, r) => s + r.working_hours, 0);
      const totalBreakHours = records.reduce((s, r) => s + r.break_hours, 0);
      const requiredHoursTotal = daysPresent * num(p.requiredHoursPerDay);
      return {
        staff_id: p.userId,
        name: p.user.name,
        role: p.user.role,
        required_hours_per_day: num(p.requiredHoursPerDay),
        days_present: daysPresent,
        total_working_hours: round2(totalWorkingHours),
        total_break_hours: round2(totalBreakHours),
        required_hours_total: round2(requiredHoursTotal),
        variance_hours: round2(totalWorkingHours - requiredHoursTotal),
        avg_hours_per_day: daysPresent ? round2(totalWorkingHours / daysPresent) : 0,
        records,
      };
    });

    res.json({ from: range.from, to: range.to, staff: staffReport });
  } catch (err) { next(err); }
});

module.exports = router;
