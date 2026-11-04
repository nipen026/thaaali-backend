// Virtual wallet primitives. Every function takes a `db` that may be the global Prisma client or
// an interactive-transaction client, so billing can debit the wallet atomically with creating the
// bill. Balance changes are conditional single-statement updates (never read-modify-write) so two
// concurrent bills can't both spend the same rupees.

const { round2 } = require('./discounts');

class WalletError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Phones are matched as exact strings against Customer.phone (which orders/billing store as
// typed), so strip the formatting characters people add by hand but nothing else.
const normalizePhone = (phone) => (phone ? String(phone).replace(/[\s-]/g, '') : '');

async function getOrCreateCustomer(db, tenantId, phone, name) {
  return db.customer.upsert({
    where: { tenantId_phone: { tenantId, phone } },
    create: { tenantId, phone, name: name || 'Guest' },
    update: name ? { name } : {},
  });
}

async function getOrCreateWallet(db, tenantId, customerId) {
  return db.wallet.upsert({
    where: { customerId },
    create: { tenantId, customerId },
    update: {},
  });
}

// Read-only: the wallet for a phone, or null if that customer never had one.
async function findWalletByPhone(db, tenantId, phone) {
  if (!phone) return null;
  const customer = await db.customer.findUnique({ where: { tenantId_phone: { tenantId, phone } }, include: { wallet: true } });
  return customer?.wallet ? { wallet: customer.wallet, customer } : null;
}

async function recordTxn(db, { tenantId, walletId, type, amount, reason, method, billId, note, createdBy }) {
  const { balance } = await db.wallet.findUnique({ where: { id: walletId }, select: { balance: true } });
  return db.walletTransaction.create({
    data: {
      tenantId, walletId, type, amount, balanceAfter: balance, reason,
      method: method || null, billId: billId || null, note: note || null, createdBy: createdBy || null,
    },
  });
}

async function creditWallet(db, { tenantId, walletId, amount, reason, method, billId, note, createdBy }) {
  amount = round2(amount);
  if (!(amount > 0)) throw new WalletError('Amount must be greater than zero');
  await db.wallet.update({ where: { id: walletId }, data: { balance: { increment: amount } } });
  return recordTxn(db, { tenantId, walletId, type: 'credit', amount, reason, method, billId, note, createdBy });
}

async function debitWallet(db, { tenantId, walletId, amount, reason, method, billId, note, createdBy }) {
  amount = round2(amount);
  if (!(amount > 0)) throw new WalletError('Amount must be greater than zero');
  const { count } = await db.wallet.updateMany({
    where: { id: walletId, tenantId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (count === 0) throw new WalletError('Insufficient wallet balance', 409);
  return recordTxn(db, { tenantId, walletId, type: 'debit', amount, reason, method, billId, note, createdBy });
}

module.exports = {
  WalletError, normalizePhone, getOrCreateCustomer, getOrCreateWallet, findWalletByPhone, creditWallet, debitWallet,
};
