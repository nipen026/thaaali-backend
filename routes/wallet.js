const router = require('express').Router();
const { prisma } = require('../config/prisma');
const { serializeWallet, serializeWalletTxn, num } = require('../utils/serialize');
const { round2 } = require('../services/discounts');
const {
  WalletError, normalizePhone, getOrCreateCustomer, getOrCreateWallet, findWalletByPhone, creditWallet, debitWallet,
} = require('../services/wallet');

// Cashiers run the counter, so they can look up balances and take top-ups; manual adjustments
// (which can remove money) stay with owners/managers.
const OPERATE_ROLES = ['owner', 'restaurant_manager', 'cashier'];
const ADJUST_ROLES = ['owner', 'restaurant_manager'];
const TOPUP_METHODS = ['cash', 'card', 'upi'];
const MAX_TOPUP = 100000;
const PHONE_RE = /^\+?\d{7,15}$/;

const requireOperator = (req, res, next) => (
  OPERATE_ROLES.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have access to wallets' })
);

router.use(requireOperator);

const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof WalletError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};

const parseAmount = (v, label = 'amount') => {
  const n = round2(Number(v));
  if (!Number.isFinite(n) || n <= 0) throw new WalletError(`${label} must be greater than zero`);
  if (n > MAX_TOPUP) throw new WalletError(`${label} cannot exceed ₹${MAX_TOPUP.toLocaleString('en-IN')}`);
  return n;
};

const parsePhone = (v) => {
  const phone = normalizePhone(v);
  if (!PHONE_RE.test(phone)) throw new WalletError('Enter a valid phone number');
  return phone;
};

router.get('/', handle(async (req, res) => {
  const wallets = await prisma.wallet.findMany({
    where: { tenantId: req.tenantId },
    include: { customer: true },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({
    wallets: wallets.map(serializeWallet),
    total_balance: round2(wallets.reduce((s, w) => s + num(w.balance), 0)),
  });
}));

// Used by the Billing screen to show "wallet balance ₹X" for the customer on the bill.
router.get('/lookup', handle(async (req, res) => {
  const phone = normalizePhone(req.query.phone);
  const found = await findWalletByPhone(prisma, req.tenantId, phone);
  res.json(found
    ? { exists: true, wallet_id: found.wallet.id, customer_name: found.customer.name, phone, balance: num(found.wallet.balance) }
    : { exists: false, phone, balance: 0 });
}));

router.get('/:id/transactions', handle(async (req, res) => {
  const wallet = await prisma.wallet.findFirst({ where: { id: req.params.id, tenantId: req.tenantId }, include: { customer: true } });
  if (!wallet) return res.status(404).json({ error: 'Not found' });
  const txns = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, take: 200,
  });
  res.json({ wallet: serializeWallet(wallet), transactions: txns.map(serializeWalletTxn) });
}));

// Customer pays at the counter (cash/card/UPI) and the balance is credited. An optional `bonus`
// (e.g. "top up ₹1000, get ₹100 extra") is credited as its own ledger row so the cash actually
// collected stays distinguishable from promotional credit.
router.post('/topup', handle(async (req, res) => {
  const phone = parsePhone(req.body.phone);
  const amount = parseAmount(req.body.amount);
  const bonus = req.body.bonus ? parseAmount(req.body.bonus, 'bonus') : 0;
  const method = req.body.method || 'cash';
  if (!TOPUP_METHODS.includes(method)) throw new WalletError(`method must be one of ${TOPUP_METHODS.join(', ')}`);
  const name = req.body.name ? String(req.body.name).trim() : null;
  const note = req.body.note ? String(req.body.note).trim() : null;

  const wallet = await prisma.$transaction(async (tx) => {
    const customer = await getOrCreateCustomer(tx, req.tenantId, phone, name);
    const w = await getOrCreateWallet(tx, req.tenantId, customer.id);
    const base = { tenantId: req.tenantId, walletId: w.id, createdBy: req.user.id };
    await creditWallet(tx, { ...base, amount, reason: 'topup', method, note });
    if (bonus) await creditWallet(tx, { ...base, amount: bonus, reason: 'bonus', note: note || 'Top-up bonus' });
    return tx.wallet.findUnique({ where: { id: w.id }, include: { customer: true } });
  }, { timeout: 15000, maxWait: 10000 });

  res.status(201).json(serializeWallet(wallet));
}));

router.post('/adjust', handle(async (req, res) => {
  if (!ADJUST_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Only owners and managers can adjust wallet balances' });
  const phone = parsePhone(req.body.phone);
  const amount = parseAmount(req.body.amount);
  const type = req.body.type;
  if (!['credit', 'debit'].includes(type)) throw new WalletError('type must be credit or debit');
  const note = req.body.note ? String(req.body.note).trim() : '';
  if (!note) throw new WalletError('A note explaining the adjustment is required');

  const found = await findWalletByPhone(prisma, req.tenantId, phone);
  if (!found) return res.status(404).json({ error: 'No wallet exists for this phone number' });

  const wallet = await prisma.$transaction(async (tx) => {
    const args = { tenantId: req.tenantId, walletId: found.wallet.id, amount, reason: 'adjustment', note, createdBy: req.user.id };
    await (type === 'credit' ? creditWallet(tx, args) : debitWallet(tx, args));
    return tx.wallet.findUnique({ where: { id: found.wallet.id }, include: { customer: true } });
  }, { timeout: 15000, maxWait: 10000 });

  res.json(serializeWallet(wallet));
}));

module.exports = router;
