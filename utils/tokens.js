const crypto = require('crypto');

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// The raw token goes in the emailed link; only its hash is stored, so a leaked DB
// row (or query log) can't be replayed as a working verification link.
function generateVerificationToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

module.exports = { generateVerificationToken, hashToken };
