const { v4: uuidv4 } = require('uuid');

const users = [];
const wallets = [];
const apiKeys = [];
const transactions = [];

const permittedPermissions = ['deposit', 'transfer', 'read'];

function nowIso() {
  return new Date().toISOString();
}

function findUserByEmail(email) {
  return users.find((u) => u.email === email);
}

function getUserById(id) {
  return users.find((u) => u.id === id);
}

function generateWalletNumber() {
  let candidate = '';
  do {
    candidate = '';
    for (let i = 0; i < 12; i += 1) {
      candidate += Math.floor(Math.random() * 10);
    }
  } while (wallets.find((w) => w.walletNumber === candidate));
  return candidate;
}

function ensureWallet(userId) {
  const existing = wallets.find((w) => w.userId === userId);
  if (existing) return existing;
  const wallet = {
    id: uuidv4(),
    userId,
    walletNumber: generateWalletNumber(),
    balance: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  wallets.push(wallet);
  return wallet;
}

function findWalletByNumber(walletNumber) {
  return wallets.find((w) => w.walletNumber === walletNumber);
}

function createUser({ email, name, googleId }) {
  const existing = findUserByEmail(email);
  if (existing) return existing;
  const user = {
    id: uuidv4(),
    email,
    name: name || email,
    googleId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  users.push(user);
  ensureWallet(user.id);
  return user;
}

function listUsers() {
  return users;
}

function listActiveApiKeysForUser(userId) {
  const now = new Date();
  return apiKeys.filter(
    (k) => k.userId === userId && !k.revoked && new Date(k.expiresAt) > now,
  );
}

function createApiKey(userId, { name, permissions, expiresAt }) {
  const id = uuidv4().replace(/-/g, '');
  const keyValue = `sk_live_${uuidv4().replace(/-/g, '')}`;
  const record = {
    id,
    userId,
    name,
    permissions: permissions.filter((p) => permittedPermissions.includes(p)),
    key: keyValue,
    revoked: false,
    expiresAt: new Date(expiresAt).toISOString(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  apiKeys.push(record);
  return record;
}

function findApiKey(keyValue) {
  return apiKeys.find((k) => k.key === keyValue);
}

function findApiKeyById(id) {
  return apiKeys.find((k) => k.id === id);
}

function updateApiKey(id, updates) {
  const record = findApiKeyById(id);
  if (!record) return null;
  Object.assign(record, updates, { updatedAt: nowIso() });
  return record;
}

function createTransaction(tx) {
  const reference = tx.reference || `tx_${uuidv4().replace(/-/g, '')}`;
  const record = {
    id: uuidv4(),
    ...tx,
    reference,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  transactions.push(record);
  return record;
}

function findTransactionByReference(reference) {
  return transactions.find((t) => t.reference === reference);
}

function updateTransaction(reference, updates) {
  const tx = findTransactionByReference(reference);
  if (!tx) return null;
  Object.assign(tx, updates, { updatedAt: nowIso() });
  return tx;
}

function listTransactionsForUser(userId) {
  return transactions.filter(
    (t) => t.userId === userId || t.fromUserId === userId || t.toUserId === userId,
  );
}

function adjustWalletBalance(userId, delta) {
  const wallet = ensureWallet(userId);
  const newBalance = wallet.balance + delta;
  wallet.balance = newBalance;
  wallet.updatedAt = nowIso();
  return wallet.balance;
}

module.exports = {
  createUser,
  listUsers,
  findUserByEmail,
  getUserById,
  ensureWallet,
  findWalletByNumber,
  createApiKey,
  findApiKey,
  findApiKeyById,
  updateApiKey,
  listActiveApiKeysForUser,
  createTransaction,
  findTransactionByReference,
  updateTransaction,
  listTransactionsForUser,
  adjustWalletBalance,
  permittedPermissions,
};
