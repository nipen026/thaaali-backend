const { prisma } = require('./prisma');

// Non-blocking startup check: routes in this phase still run on the in-memory store
// (data/db.js), so the server must keep working even if Postgres isn't reachable yet.
async function connectDB() {
  if (!prisma) {
    console.warn('⚠️  DATABASE_URL not set — skipping Postgres connection.');
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('🗄️  Postgres connected');
  } catch (err) {
    console.warn('⚠️  Postgres connection failed — continuing without it:', err.message);
  }
}

module.exports = { connectDB };
