const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'thaali_secret_2026';

// Verifies the JWT and derives tenant scope from it — every business route needs both,
// and now that sign-up can create additional tenants, req.tenantId can no longer be a
// hardcoded single-tenant shim (see the now-removed middleware/tenant.js).
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    req.tenantId = decoded.tenantId;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

module.exports = { auth, SECRET };
