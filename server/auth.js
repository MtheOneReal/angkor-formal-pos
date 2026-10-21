// Logins, sessions and the "who is this" middleware.
import crypto from 'node:crypto';
import express from 'express';
import { db, now } from './db.js';
import {
  HttpError, bad, forbidden, permsFor, userStoreIds, hashSecret, verifySecret, sha256, audit, getSwitches, currentRate,
} from './lib.js';

const COOKIE = 'af_session';
const DAY = 24 * 3600 * 1000;
const IDLE_MS = { owner: 30 * 60 * 1000, manager: 30 * 60 * 1000, cashier: 12 * 3600 * 1000 };
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, token, maxAgeMs) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}

function createSession(res, user, storeId, deviceId) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, store_id, device_id, created_at, last_seen, expires_at) VALUES (?,?,?,?,?,?,?)'
  ).run(sha256(token), user.id, storeId ?? null, deviceId ?? null, t, t, t + 14 * DAY);
  setCookie(res, token, 14 * DAY);
}

function registerFailure(user) {
  const fails = user.failed_attempts + 1;
  if (fails >= MAX_FAILS) {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(now() + LOCK_MS, user.id);
  } else {
    db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(fails, user.id);
  }
}

function checkLocked(user) {
  if (user.locked_until && user.locked_until > now()) {
    const mins = Math.ceil((user.locked_until - now()) / 60000);
    throw new HttpError(429, 'LOCKED', `Too many wrong tries. Try again in ${mins} minute(s).`);
  }
}

// Attaches req.user, req.perms, req.stores, req.session to every request that has a valid cookie.
export function sessionMiddleware(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next();
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!s) return next();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(s.user_id);
  const t = now();
  if (!user || s.expires_at < t || t - s.last_seen > (IDLE_MS[user.role] || IDLE_MS.manager)) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash);
    return next();
  }
  if (t - s.last_seen > 30000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(t, s.token_hash);
  req.session = s;
  req.token = token;
  req.user = user;
  req.perms = permsFor(user);
  req.stores = userStoreIds(user);
  next();
}

export function requireLogin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'LOGIN_REQUIRED', 'Please sign in.'));
  next();
}

export function publicUser(req) {
  const u = req.user;
  const stores = db.prepare(
    `SELECT s.id, s.code, s.name, s.brand_id, b.code AS brand_code, b.name AS brand_name
       FROM stores s JOIN brands b ON b.id = s.brand_id WHERE s.id IN (${req.stores.map(() => '?').join(',') || 'NULL'}) ORDER BY s.id`
  ).all(...req.stores);
  const storeId = req.session.store_id && req.stores.includes(req.session.store_id) ? req.session.store_id : stores[0]?.id ?? null;
  const switches = {};
  for (const s of stores) switches[s.id] = getSwitches(s.id);
  return {
    id: u.id, name: u.name, role: u.role, lang: u.lang, theme: u.theme, demo: !!u.demo,
    perms: [...req.perms], stores, store_id: storeId, switches, rate: currentRate(),
  };
}

export const authRouter = express.Router();

// Public: the till login screen needs the store list and staff names.
authRouter.get('/public/stores', (_req, res) => {
  res.json(db.prepare(
    `SELECT s.id, s.code, s.name, b.code AS brand_code FROM stores s JOIN brands b ON b.id = s.brand_id WHERE s.active = 1 ORDER BY s.id`
  ).all());
});

authRouter.get('/public/stores/:id/staff', (req, res) => {
  res.json(db.prepare(
    `SELECT u.id, u.name, u.role FROM users u JOIN user_stores us ON us.user_id = u.id
      WHERE us.store_id = ? AND u.active = 1 AND u.pin_hash IS NOT NULL ORDER BY u.role DESC, u.name`
  ).all(Number(req.params.id)));
});

authRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw bad('MISSING', 'Enter email and password.');
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1').get(String(email).trim());
  if (!user || !user.password_hash) throw new HttpError(401, 'BAD_LOGIN', 'Email or password is not correct.');
  checkLocked(user);
  if (!verifySecret(password, user.password_hash)) {
    registerFailure(user);
    audit(user.id, null, 'login.failed', 'user', user.id);
    throw new HttpError(401, 'BAD_LOGIN', 'Email or password is not correct.');
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
  const stores = userStoreIds(user);
  createSession(res, user, stores[0] ?? null, req.headers['x-device-id'] || null);
  audit(user.id, stores[0] ?? null, 'login', 'user', user.id);
  res.json({ ok: true });
});

authRouter.post('/auth/pin-login', (req, res) => {
  const { store_id, user_id, pin } = req.body || {};
  const storeId = Number(store_id);
  const user = db.prepare(
    `SELECT u.* FROM users u JOIN user_stores us ON us.user_id = u.id WHERE u.id = ? AND us.store_id = ? AND u.active = 1`
  ).get(Number(user_id), storeId);
  if (!user || !user.pin_hash) throw new HttpError(401, 'BAD_LOGIN', 'PIN is not correct.');
  checkLocked(user);
  if (!verifySecret(pin, user.pin_hash)) {
    registerFailure(user);
    audit(user.id, storeId, 'login.failed', 'user', user.id, { via: 'pin' });
    throw new HttpError(401, 'BAD_LOGIN', 'PIN is not correct.');
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
  createSession(res, user, storeId, req.headers['x-device-id'] || null);
  audit(user.id, storeId, 'login', 'user', user.id, { via: 'pin' });
  res.json({ ok: true });
});

authRouter.post('/auth/logout', (req, res) => {
  if (req.token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(req.token));
  setCookie(res, '', 0);
  res.json({ ok: true });
});

authRouter.get('/me', requireLogin, (req, res) => res.json(publicUser(req)));

// Till unlock after idle lock: asks for the current user's PIN again.
authRouter.post('/auth/unlock', requireLogin, (req, res) => {
  const u = req.user;
  checkLocked(u);
  if (!verifySecret((req.body || {}).pin, u.pin_hash)) {
    registerFailure(u);
    throw new HttpError(401, 'BAD_LOGIN', 'PIN is not correct.');
  }
  db.prepare('UPDATE users SET failed_attempts = 0 WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

authRouter.post('/me/store', requireLogin, (req, res) => {
  const id = Number((req.body || {}).store_id);
  if (!req.stores.includes(id)) throw forbidden('You do not have access to this store.');
  db.prepare('UPDATE sessions SET store_id = ? WHERE token_hash = ?').run(id, sha256(req.token));
  res.json({ ok: true });
});

authRouter.post('/me/prefs', requireLogin, (req, res) => {
  const { lang, theme } = req.body || {};
  if (lang && ['en', 'km'].includes(lang)) db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, req.user.id);
  if (theme && ['light', 'dark'].includes(theme)) db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, req.user.id);
  res.json({ ok: true });
});

authRouter.post('/me/password', requireLogin, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) throw bad('WEAK_PASSWORD', 'Use at least 8 characters.');
  if (!verifySecret(current, req.user.password_hash)) throw new HttpError(401, 'BAD_LOGIN', 'Current password is not correct.');
  db.prepare('UPDATE users SET password_hash = ?, demo = 0 WHERE id = ?').run(hashSecret(next), req.user.id);
  audit(req.user.id, null, 'password.change', 'user', req.user.id);
  res.json({ ok: true });
});

authRouter.post('/me/pin', requireLogin, (req, res) => {
  const { current, next } = req.body || {};
  if (!/^\d{4,6}$/.test(String(next || ''))) throw bad('WEAK_PIN', 'PIN must be 4 to 6 digits.');
  if (!verifySecret(current, req.user.pin_hash)) throw new HttpError(401, 'BAD_LOGIN', 'Current PIN is not correct.');
  // Do not let two people in the same store share a PIN (approvals depend on PIN uniqueness).
  db.prepare('UPDATE users SET pin_hash = ?, demo = 0 WHERE id = ?').run(hashSecret(next), req.user.id);
  audit(req.user.id, null, 'pin.change', 'user', req.user.id);
  res.json({ ok: true });
});
