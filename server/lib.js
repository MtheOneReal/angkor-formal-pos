// Shared helpers: errors, money, permissions, settings switches, audit log, passwords.
import crypto from 'node:crypto';
import { db, now } from './db.js';

// ---------- errors ----------
export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const bad = (code, message, extra) => new HttpError(400, code, message, extra);
export const forbidden = (message = 'You do not have access to this.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message);

// ---------- money (USD in cents, KHR in whole riel; never floating point) ----------
export const khrToUsdCents = (khr, rate) => Math.round((khr * 100) / rate);
// Riel amounts are rounded to the nearest 100 riel (placeholder rule, confirm with owner).
export const usdCentsToKhr = (cents, rate) => Math.round((cents * rate) / 100 / 100) * 100;
// Allowed difference (in cents) caused by rounding riel to the nearest 100.
export const khrTolerance = (rate) => Math.ceil(5000 / rate) + 1;

// ---------- permissions ----------
export const ALL_PERMS = [
  'pos.sell', 'pos.discount', 'pos.approve', 'shift.use', 'shift.review',
  'catalog.view', 'catalog.edit', 'cost.view',
  'stock.view', 'stock.view_other', 'stock.in', 'stock.adjust',
  'transfer.request', 'transfer.approve', 'transfer.send', 'transfer.receive', 'transfer.resolve',
  'customers.manage', 'sales.view', 'sales.void', 'sales.return',
  'users.manage', 'settings.manage', 'rates.set', 'audit.view', 'dashboard.view', 'dashboard.all_stores',
];

export const ROLE_PERMS = {
  owner: ALL_PERMS,
  manager: [
    'pos.sell', 'pos.discount', 'pos.approve', 'shift.use', 'shift.review',
    'catalog.view', 'cost.view', 'stock.view', 'stock.view_other', 'stock.in', 'stock.adjust',
    'transfer.request', 'transfer.approve', 'transfer.send', 'transfer.receive',
    'customers.manage', 'sales.view', 'sales.void', 'sales.return',
    'rates.set', 'audit.view', 'dashboard.view',
  ],
  cashier: [
    'pos.sell', 'pos.discount', 'shift.use', 'catalog.view', 'stock.view', 'stock.view_other',
    'transfer.request', 'customers.manage', 'sales.view',
  ],
};

export function permsFor(user) {
  const base = new Set(ROLE_PERMS[user.role] || []);
  let over = {};
  try { over = JSON.parse(user.perms || '{}'); } catch { /* ignore bad data */ }
  for (const p of over.grant || []) if (ALL_PERMS.includes(p)) base.add(p);
  for (const p of over.deny || []) base.delete(p);
  // Server-side rule: only an owner may ever hold these.
  if (user.role !== 'owner') {
    for (const p of ['users.manage', 'settings.manage', 'transfer.resolve', 'dashboard.all_stores']) base.delete(p);
  }
  return base;
}

export function userStoreIds(user) {
  if (user.role === 'owner') return db.prepare('SELECT id FROM stores WHERE active = 1').all().map((r) => r.id);
  return db.prepare('SELECT store_id FROM user_stores WHERE user_id = ?').all(user.id).map((r) => r.store_id);
}

export function assertStore(req, storeId) {
  const id = Number(storeId);
  if (!id) throw bad('STORE_REQUIRED', 'Choose a store.');
  if (!req.stores.includes(id)) throw forbidden('You do not have access to this store.');
  return id;
}

export const can = (req, perm) => req.perms.has(perm);
export function need(req, perm) {
  if (!can(req, perm)) throw forbidden();
}

// ---------- settings switches (section 21 of the brief) ----------
export const SWITCH_DEFAULTS = {
  require_scan_to_sell: false,
  blind_counts: false,
  registered_devices_only: false,
  pin_every_discount: false,
  pin_every_return: true,
  receipt_required: false,
  customer_required: false,
  autolock_minutes: 2, // 0 = off
  telegram_summary: false,
  cashier_see_other_stock: true,
  show_exact_other_qty: true,
  owner_approval_large_transfer: false,
  large_transfer_pieces: 20,
  cashier_discount_limit_percent: 10, // placeholder: confirm with owner
};

export function getSwitches(storeId) {
  const out = { ...SWITCH_DEFAULTS };
  const rows = db.prepare('SELECT key, value FROM store_settings WHERE store_id = ?').all(storeId);
  for (const r of rows) {
    if (r.key in SWITCH_DEFAULTS) {
      const t = typeof SWITCH_DEFAULTS[r.key];
      out[r.key] = t === 'boolean' ? r.value === '1' : Number(r.value);
    }
  }
  return out;
}

export function setSwitch(storeId, key, value) {
  if (!(key in SWITCH_DEFAULTS)) throw bad('UNKNOWN_SWITCH', 'Unknown setting.');
  const t = typeof SWITCH_DEFAULTS[key];
  const stored = t === 'boolean' ? (value ? '1' : '0') : String(Math.max(0, Math.floor(Number(value) || 0)));
  db.prepare(
    'INSERT INTO store_settings (store_id, key, value) VALUES (?,?,?) ON CONFLICT(store_id,key) DO UPDATE SET value = excluded.value'
  ).run(storeId, key, stored);
}

export function currentRate() {
  const r = db.prepare('SELECT khr_per_usd FROM exchange_rates ORDER BY ts DESC, id DESC LIMIT 1').get();
  return r ? r.khr_per_usd : 4000;
}

// ---------- audit log ----------
export function audit(userId, storeId, action, entity, entityId, details) {
  db.prepare(
    'INSERT INTO audit_log (ts, user_id, store_id, action, entity, entity_id, details) VALUES (?,?,?,?,?,?,?)'
  ).run(now(), userId ?? null, storeId ?? null, action, entity ?? null, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null);
}

// ---------- passwords and PINs (scrypt) ----------
export function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(secret), salt, 32);
  return `s1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export function verifySecret(secret, stored) {
  if (!stored) return false;
  const [v, saltHex, keyHex] = stored.split('$');
  if (v !== 's1') return false;
  const key = crypto.scryptSync(String(secret), Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(keyHex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Find a manager or owner of this store whose PIN matches (used for approvals at the register).
export function findApprover(storeId, pin) {
  if (!pin) return null;
  const rows = db.prepare(
    `SELECT u.* FROM users u
     WHERE u.active = 1 AND u.pin_hash IS NOT NULL AND u.role IN ('manager','owner')
       AND (u.role = 'owner' OR u.id IN (SELECT user_id FROM user_stores WHERE store_id = ?))`
  ).all(storeId);
  for (const u of rows) {
    if (verifySecret(pin, u.pin_hash)) {
      if (permsFor(u).has('pos.approve')) return u;
    }
  }
  return null;
}

export const money = {
  usd: (cents) => (cents / 100).toFixed(2),
};
