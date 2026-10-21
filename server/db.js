// Database: SQLite through Node's built-in node:sqlite (no native add-ons to install).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'angkor.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Run a function inside a transaction. Rolls back if it throws.
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

// Each migration runs once, in order. Add new ones at the end; never edit old ones.
const MIGRATIONS = [
  // 1: foundation
  `
  CREATE TABLE brands (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, logo TEXT
  );
  CREATE TABLE stores (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    brand_id INTEGER NOT NULL REFERENCES brands(id), active INTEGER NOT NULL DEFAULT 1,
    receipt_footer TEXT NOT NULL DEFAULT 'Thank you.'
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier')),
    password_hash TEXT, pin_hash TEXT, lang TEXT NOT NULL DEFAULT 'en',
    theme TEXT, perms TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER,
    demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE user_stores (
    user_id INTEGER NOT NULL REFERENCES users(id), store_id INTEGER NOT NULL REFERENCES stores(id),
    PRIMARY KEY (user_id, store_id)
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    store_id INTEGER, device_id TEXT, created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, user_id INTEGER, store_id INTEGER,
    action TEXT NOT NULL, entity TEXT, entity_id TEXT, details TEXT
  );
  CREATE INDEX audit_ts ON audit_log(ts);
  CREATE TABLE store_settings (
    store_id INTEGER NOT NULL REFERENCES stores(id), key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (store_id, key)
  );
  CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE exchange_rates (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, khr_per_usd INTEGER NOT NULL, set_by INTEGER
  );

  CREATE TABLE types (code TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_km TEXT NOT NULL);
  CREATE TABLE colours (code TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_km TEXT NOT NULL, hex TEXT NOT NULL);
  CREATE TABLE designs (
    id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id),
    type_code TEXT NOT NULL REFERENCES types(code), number INTEGER NOT NULL,
    name_en TEXT NOT NULL, name_km TEXT, photo TEXT,
    price_cents INTEGER NOT NULL, cost_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
    UNIQUE (brand_id, type_code, number)
  );
  CREATE TABLE items (
    id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, design_id INTEGER NOT NULL REFERENCES designs(id),
    colour_code TEXT NOT NULL REFERENCES colours(code), size TEXT NOT NULL,
    low_stock INTEGER NOT NULL DEFAULT 2, active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (design_id, colour_code, size)
  );
  CREATE INDEX items_design ON items(design_id);

  -- Stock is a ledger: quantities are calculated from these rows, never edited directly.
  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, store_id INTEGER NOT NULL REFERENCES stores(id),
    item_id INTEGER NOT NULL REFERENCES items(id), qty INTEGER NOT NULL,
    bucket TEXT NOT NULL DEFAULT 'stock' CHECK (bucket IN ('stock','returned','damaged','alteration')),
    type TEXT NOT NULL, ref_type TEXT, ref_id INTEGER, user_id INTEGER, reason TEXT
  );
  CREATE INDEX mv_store_item ON stock_movements(store_id, item_id, bucket);

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, note TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE shifts (
    id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id),
    user_id INTEGER NOT NULL REFERENCES users(id), opened_ts INTEGER NOT NULL,
    open_usd_cents INTEGER NOT NULL DEFAULT 0, open_khr INTEGER NOT NULL DEFAULT 0,
    closed_ts INTEGER, counted_usd_cents INTEGER, counted_khr INTEGER,
    expected_usd_cents INTEGER, expected_khr INTEGER,
    diff_usd_cents INTEGER, diff_khr INTEGER, note TEXT, reviewed_by INTEGER, reviewed_ts INTEGER
  );
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id),
    seq INTEGER NOT NULL, receipt_no TEXT NOT NULL UNIQUE, ts INTEGER NOT NULL,
    cashier_id INTEGER NOT NULL REFERENCES users(id), shift_id INTEGER REFERENCES shifts(id),
    customer_id INTEGER REFERENCES customers(id), status TEXT NOT NULL DEFAULT 'completed',
    subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL, rate_khr_per_usd INTEGER NOT NULL,
    discount_reason TEXT, approved_by INTEGER, note TEXT,
    voided_by INTEGER, void_reason TEXT, voided_ts INTEGER,
    UNIQUE (store_id, seq)
  );
  CREATE INDEX sales_store_ts ON sales(store_id, ts);
  CREATE TABLE sale_lines (
    id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
    item_id INTEGER NOT NULL REFERENCES items(id), qty INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL, cost_cents INTEGER NOT NULL,
    discount_cents INTEGER NOT NULL DEFAULT 0, line_total_cents INTEGER NOT NULL,
    entry TEXT NOT NULL DEFAULT 'scan'
  );
  CREATE TABLE sale_payments (
    id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
    kind TEXT NOT NULL CHECK (kind IN ('tender','change')),
    method TEXT NOT NULL CHECK (method IN ('cash','khqr','card')),
    currency TEXT NOT NULL CHECK (currency IN ('USD','KHR')),
    amount INTEGER NOT NULL, usd_cents INTEGER NOT NULL
  );
  CREATE TABLE returns (
    id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
    store_id INTEGER NOT NULL, ts INTEGER NOT NULL, user_id INTEGER NOT NULL,
    approved_by INTEGER, reason TEXT NOT NULL, refund_method TEXT NOT NULL,
    refund_cents INTEGER NOT NULL
  );
  CREATE TABLE return_lines (
    id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES returns(id),
    sale_line_id INTEGER NOT NULL REFERENCES sale_lines(id), item_id INTEGER NOT NULL,
    qty INTEGER NOT NULL, refund_cents INTEGER NOT NULL
  );
  CREATE TABLE transfers (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE,
    from_store_id INTEGER NOT NULL REFERENCES stores(id), to_store_id INTEGER NOT NULL REFERENCES stores(id),
    status TEXT NOT NULL, reason TEXT, customer_note TEXT,
    requested_by INTEGER NOT NULL, requested_ts INTEGER NOT NULL,
    approved_by INTEGER, approved_ts INTEGER, owner_approved_by INTEGER, owner_approved_ts INTEGER,
    reject_reason TEXT, sent_by INTEGER, sent_ts INTEGER, received_by INTEGER, received_ts INTEGER,
    resolution TEXT, resolution_note TEXT, resolved_by INTEGER, resolved_ts INTEGER
  );
  CREATE TABLE transfer_lines (
    id INTEGER PRIMARY KEY, transfer_id INTEGER NOT NULL REFERENCES transfers(id),
    item_id INTEGER NOT NULL REFERENCES items(id), qty_requested INTEGER NOT NULL,
    qty_sent INTEGER, qty_received INTEGER
  );
  `,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  let current = row && row.v ? row.v : 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
migrate();

export const now = () => Date.now();
