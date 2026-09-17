// Seeds the first platform admin(s) — there's no public signup for this role (unlike tenant
// Users), since anyone with one of these accounts can see and manage every tenant on THAALI.
// Run with: node scripts/seedPlatform.js
const bcrypt = require('bcryptjs');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

require('dotenv').config({ quiet: true });
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ADMINS = [
  { email: 'admin@thaali.io', name: 'Platform Admin', role: 'super_admin' },
];
const DEMO_PASSWORD = 'thaali123';

async function seedPlatform() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const a of ADMINS) {
    await prisma.platformAdmin.upsert({
      where: { email: a.email },
      create: { email: a.email, name: a.name, role: a.role, passwordHash },
      update: {},
    });
  }
  console.log(`✅ Seeded ${ADMINS.length} platform admin(s) (password: ${DEMO_PASSWORD}):`);
  ADMINS.forEach((a) => console.log(`   - ${a.email} (${a.role})`));
}

seedPlatform()
  .catch((err) => {
    console.error('❌ Platform admin seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
