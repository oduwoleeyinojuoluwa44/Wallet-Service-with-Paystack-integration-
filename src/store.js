const { randomUUID } = require('crypto');
const { pool } = require('./db');

const permittedPermissions = ['deposit', 'transfer', 'read'];

function nowIso() {
  return new Date().toISOString();
}

function camelize(row) {
  if (!row || typeof row !== 'object') return row;
  const map = {
    user_id: 'userId',
    google_id: 'googleId',
    wallet_number: 'walletNumber',
    from_user_id: 'fromUserId',
    to_user_id: 'toUserId',
    expires_at: 'expiresAt',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
    webhook_event: 'webhookEvent',
    gateway_response: 'gatewayResponse',
  };
  const out = {};
  Object.keys(row).forEach((k) => {
    const nk = map[k] || k;
    out[nk] = row[k];
  });
  if (out.permissions && typeof out.permissions === 'string') {
    try {
      out.permissions = JSON.parse(out.permissions);
    } catch {
      out.permissions = [];
    }
  }
  return out;
}

async function generateWalletNumber() {
  let candidate = '';
  while (true) {
    candidate = '';
    for (let i = 0; i < 12; i += 1) {
      candidate += Math.floor(Math.random() * 10);
    }
    const exists = await pool.query('SELECT 1 FROM wallets WHERE wallet_number = $1', [
      candidate,
    ]);
    if (exists.rowCount === 0) break;
  }
  return candidate;
}

async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return camelize(rows[0]);
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return camelize(rows[0]);
}

async function createUser({ email, name, googleId }) {
  const existing = await findUserByEmail(email);
  if (existing) return existing;
  const user = {
    id: randomUUID(),
    email,
    name: name || email,
    google_id: googleId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await pool.query(
    `INSERT INTO users (id, email, name, google_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, user.email, user.name, user.google_id, user.created_at, user.updated_at],
  );
  await ensureWallet(user.id);
  return user;
}

async function listUsers() {
  const { rows } = await pool.query('SELECT * FROM users');
  return rows.map(camelize);
}

async function ensureWallet(userId) {
  const existing = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
  if (existing.rowCount > 0) return camelize(existing.rows[0]);
  const walletNumber = await generateWalletNumber();
  const wallet = {
    id: randomUUID(),
    user_id: userId,
    wallet_number: walletNumber,
    balance: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await pool.query(
    `INSERT INTO wallets (id, user_id, wallet_number, balance, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      wallet.id,
      wallet.user_id,
      wallet.wallet_number,
      wallet.balance,
      wallet.created_at,
      wallet.updated_at,
    ],
  );
  return {
    id: wallet.id,
    userId: wallet.user_id,
    walletNumber: wallet.wallet_number,
    balance: wallet.balance,
    createdAt: wallet.created_at,
    updatedAt: wallet.updated_at,
  };
}

async function findWalletByNumber(walletNumber) {
  const { rows } = await pool.query('SELECT * FROM wallets WHERE wallet_number = $1', [
    walletNumber,
  ]);
  return camelize(rows[0]);
}

async function listActiveApiKeysForUser(userId) {
  const now = nowIso();
  const { rows } = await pool.query(
    `SELECT * FROM api_keys
     WHERE user_id = $1
       AND revoked = FALSE
       AND expires_at > $2`,
    [userId, now],
  );
  return rows.map(camelize);
}

async function createApiKey(userId, { name, permissions, expiresAt }) {
  const record = {
    id: randomUUID().replace(/-/g, ''),
    user_id: userId,
    name,
    permissions: permissions.slice(),
    key: `sk_live_${randomUUID().replace(/-/g, '')}`,
    revoked: false,
    expires_at: new Date(expiresAt).toISOString(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await pool.query(
    `INSERT INTO api_keys (id, user_id, name, permissions, key, revoked, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      record.id,
      record.user_id,
      record.name,
      JSON.stringify(record.permissions),
      record.key,
      record.revoked,
      record.expires_at,
      record.created_at,
      record.updated_at,
    ],
  );
  return {
    id: record.id,
    userId: record.user_id,
    name: record.name,
    permissions: record.permissions,
    key: record.key,
    revoked: record.revoked,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function findApiKey(keyValue) {
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE key = $1', [keyValue]);
  if (!rows[0]) return undefined;
  return camelize(rows[0]);
}

async function findApiKeyById(id) {
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE id = $1', [id]);
  if (!rows[0]) return undefined;
  return camelize(rows[0]);
}

async function updateApiKey(id, updates) {
  const current = await findApiKeyById(id);
  if (!current) return null;
  const merged = {
    ...current,
    ...updates,
    updated_at: nowIso(),
  };
  const permissionsToStore = JSON.stringify(
    Array.isArray(merged.permissions) ? merged.permissions : current.permissions,
  );
  await pool.query(
    `UPDATE api_keys
     SET name = $1,
         permissions = $2,
         key = $3,
         revoked = $4,
         expires_at = $5,
         updated_at = $6
     WHERE id = $7`,
    [
      merged.name,
      permissionsToStore,
      merged.key,
      merged.revoked,
      merged.expires_at,
      merged.updated_at,
      id,
    ],
  );
  return camelize({ ...merged, permissions: permissionsToStore });
}

async function createTransaction(tx) {
  const reference = tx.reference || `tx_${randomUUID().replace(/-/g, '')}`;
  const record = {
    id: randomUUID(),
    reference,
    type: tx.type,
    user_id: tx.userId,
    from_user_id: tx.fromUserId,
    to_user_id: tx.toUserId,
    amount: tx.amount,
    status: tx.status,
    source: tx.source,
    webhook_event: tx.webhookEvent,
    gateway_response: tx.gatewayResponse,
    error: tx.error,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await pool.query(
    `INSERT INTO transactions
     (id, reference, type, user_id, from_user_id, to_user_id, amount, status, source, webhook_event, gateway_response, error, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      record.id,
      record.reference,
      record.type,
      record.user_id,
      record.from_user_id,
      record.to_user_id,
      record.amount,
      record.status,
      record.source,
      record.webhook_event,
      record.gateway_response,
      record.error,
      record.created_at,
      record.updated_at,
    ],
  );
  return camelize({
    reference: record.reference,
    type: record.type,
    userId: record.user_id,
    fromUserId: record.from_user_id,
    toUserId: record.to_user_id,
    amount: record.amount,
    status: record.status,
    source: record.source,
    webhookEvent: record.webhook_event,
    gatewayResponse: record.gateway_response,
    error: record.error,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

async function findTransactionByReference(reference) {
  const { rows } = await pool.query('SELECT * FROM transactions WHERE reference = $1', [
    reference,
  ]);
  return camelize(rows[0]);
}

async function updateTransaction(reference, updates) {
  const current = await findTransactionByReference(reference);
  if (!current) return null;
  const merged = { ...current, ...updates, updated_at: nowIso() };
  await pool.query(
    `UPDATE transactions
     SET type = $1,
         user_id = $2,
         from_user_id = $3,
         to_user_id = $4,
         amount = $5,
         status = $6,
         source = $7,
         webhook_event = $8,
         gateway_response = $9,
         error = $10,
         updated_at = $11
     WHERE reference = $12`,
    [
      merged.type,
      merged.user_id,
      merged.from_user_id,
      merged.to_user_id,
      merged.amount,
      merged.status,
      merged.source,
      merged.webhook_event,
      merged.gateway_response,
      merged.error,
      merged.updated_at,
      merged.reference,
    ],
  );
  return camelize(merged);
}

async function listTransactionsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM transactions
     WHERE user_id = $1
        OR from_user_id = $1
        OR to_user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(camelize);
}

async function adjustWalletBalance(userId, delta) {
  const wallet = await ensureWallet(userId);
  await pool.query(
    'UPDATE wallets SET balance = balance + $1, updated_at = $2 WHERE id = $3',
    [delta, nowIso(), wallet.id],
  );
  const { rows } = await pool.query('SELECT balance FROM wallets WHERE id = $1', [wallet.id]);
  return Number(rows[0].balance);
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
