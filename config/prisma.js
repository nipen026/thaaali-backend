const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

let prisma = null;

if (process.env.DATABASE_URL) {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  prisma = new PrismaClient({ adapter });
}

module.exports = { prisma };
