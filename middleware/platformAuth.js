const jwt = require('jsonwebtoken');
const { SECRET } = require('./auth');

// Separate auth realm from the tenant `auth` middleware — a platform admin is not a tenant
// User, so its JWT carries `isPlatform: true` and a platformAdminId instead of a tenantId,
// and neither token type can be replayed as the other even though they share SECRET (the
// tenant `auth` middleware never checks `isPlatform`, and this one requires it).
const platformAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (!decoded.isPlatform) return res.status(401).json({ error: 'Invalid token' });
    req.platformAdmin = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

module.exports = { platformAuth };
