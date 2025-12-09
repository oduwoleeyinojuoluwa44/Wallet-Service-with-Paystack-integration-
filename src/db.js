const { Pool } = require('pg');
const { config } = require('./config');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_CONNECTION_STRING ||
  '';

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      google_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
      wallet_number TEXT UNIQUE NOT NULL,
      balance BIGINT NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT,
      permissions TEXT NOT NULL,
      key TEXT UNIQUE NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      reference TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),
      from_user_id TEXT REFERENCES users(id),
      to_user_id TEXT REFERENCES users(id),
      amount BIGINT,
      status TEXT,
      source TEXT,
      webhook_event TEXT,
      gateway_response TEXT,
      error TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
}

module.exports = { pool, initDb };
