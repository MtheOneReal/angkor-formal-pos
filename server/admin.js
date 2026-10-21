// Owner and manager tools: users, stores, switches, audit log, and the dashboard numbers.
import express from 'express';
import { db, tx, now } from './db.js';
import {
  bad, forbidden, notFound, need, can, audit, assertStore, getSwitches, setSwitch, SWITCH_DEFAULTS,
  hashSecret, verifySecret, ALL_PERMS, ROLE_PERMS,
} from './lib.js';
import { dayRange, todayStr } from './sales.js';

export const adminRouter = express.Router();

// ---------- stores, brands and switches ----------
adminRouter.get('/admin/stores', (req, res) => {
  need(req, 'settings.manage');
  const stores = db.prepare(
    'SELECT s.*, b.code AS brand_code, b.name AS brand_name FROM stores s JOIN brands b ON b.id = s.brand_id ORDER BY s.id'
  ).all();
  res.json({ stores: stores.map((s) => ({ ...s, switches: getSwitches(s.id) })), defaults: SWITCH_DEFAULTS });
});

adminRouter.put('/admin/stores/:id', (req, res) => {
  need(req, 'settings.manage');
  const id = Number(req.params.id);
  const s = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  if (!s) throw notFound();
  const b = req.body || {};
  tx(() => {
    db.prepare('UPDATE stores SET name = ?, receipt_footer = ?, active = ? WHERE id = ?')
      .run(String(b.name ?? s.name).slice(0, 80), String(b.receipt_footer ?? s.receipt_footer).slice(0, 200), b.active == null ? s.active : (b.active ? 1 : 0), id);
    const changed = {};
    for (const [k, v] of Object.entries(b.switches || {})) {
      const before = getSwitches(id)[k];
      setSwitch(id, k, v);
      const after = getSwitches(id)[k];
      if (before !== after) changed[k] = { from: before, to: after };
    }
    audit(req.user.id, id, 'store.update', 'store', id, { name: b.name, switches: changed });
  });
  res.json({ ok: true });
});

adminRouter.post('/admin/stores', (req, res) => {
  need(req, 'settings.manage');
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(code) || !String(b.name || '').trim()) throw bad('BAD_INPUT', 'Enter a name and a 2 to 4 letter code.');
  if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(Number(b.brand_id))) throw bad('BAD_INPUT', 'Choose a brand.');
  try {
    const id = Number(db.prepare('INSERT INTO stores (code, name, brand_id) VALUES (?,?,?)').run(code, String(b.name).trim(), Number(b.brand_id)).lastInsertRowid);
    audit(req.user.id, id, 'store.create', 'store', id, { code });
    res.json({ id });
  } catch { throw bad('DUPLICATE', 'This store code is already used.'); }
});

adminRouter.post('/admin/brands', (req, res) => {
  need(req, 'settings.manage');
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(code) || !String(b.name || '').trim()) throw bad('BAD_INPUT', 'Enter a name and a 2 or 3 letter SKU prefix.');
  try {
    const id = Number(db.prepare('INSERT INTO brands (code, name) VALUES (?,?)').run(code, String(b.name).trim()).lastInsertRowid);
    audit(req.user.id, null, 'brand.create', 'brand', id, { code });
    res.json({ id });
  } catch { throw bad('DUPLICATE', 'This prefix is already used.'); }
});

adminRouter.put('/admin/brands/:id', (req, res) => {
  need(req, 'settings.manage');
  const br = db.prepare('SELECT * FROM brands WHERE id = ?').get(Number(req.params.id));
  if (!br) throw notFound();
  const b = req.body || {};
  const code = String(b.code ?? br.code).trim().toUpperCase();
  if (code !== br.code && db.prepare('SELECT 1 FROM designs WHERE brand_id = ?').get(br.id)) throw bad('CODE_LOCKED', 'The prefix cannot change after products exist.');
  db.prepare('UPDATE brands SET name = ?, code = ? WHERE id = ?').run(String(b.name ?? br.name).slice(0, 80), code, br.id);
  audit(req.user.id, null, 'brand.update', 'brand', br.id, b);
  res.json({ ok: true });
});

// ---------- users ----------
function pinClash(userId, storeIds, pin) {
  if (!pin) return false;
  const rows = db.prepare(
    `SELECT DISTINCT u.id, u.pin_hash FROM users u LEFT JOIN user_stores us ON us.user_id = u.id
      WHERE u.id != ? AND u.active = 1 AND u.pin_hash IS NOT NULL AND (u.role = 'owner' OR us.store_id IN (${storeIds.map(() => '?').join(',') || 'NULL'}))`
  ).all(userId || 0, ...storeIds);
  return rows.some((r) => verifySecret(pin, r.pin_hash));
}

const userView = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, lang: u.lang, demo: !!u.demo, perms: JSON.parse(u.perms || '{}'),
  store_ids: db.prepare('SELECT store_id FROM user_stores WHERE user_id = ?').all(u.id).map((r) => r.store_id), has_pin: !!u.pin_hash, has_password: !!u.password_hash,
});

adminRouter.get('/admin/users', (req, res) => {
  need(req, 'users.manage');
  res.json({ users: db.prepare('SELECT * FROM users ORDER BY active DESC, role, name').all().map(userView), all_perms: ALL_PERMS, role_perms: ROLE_PERMS });
});

adminRouter.post('/admin/users', (req, res) => {
  need(req, 'users.manage');
  const b = req.body || {};
  if (!String(b.name || '').trim()) throw bad('BAD_INPUT', 'Enter a name.');
  if (!['owner', 'manager', 'cashier'].includes(b.role)) throw bad('BAD_INPUT', 'Choose a role.');
  const storeIds = (b.store_ids || []).map(Number);
  if (b.role !== 'owner' && !storeIds.length) throw bad('BAD_INPUT', 'Choose at least one store.');
  if (b.role !== 'cashier' && (!b.email || !b.password || String(b.password).length < 8)) throw bad('BAD_INPUT', 'Managers and owners need an email and a password of at least 8 characters.');
  if (b.pin && !/^\d{4,6}$/.test(String(b.pin))) throw bad('BAD_PIN', 'PIN must be 4 to 6 digits.');
  if (b.role === 'cashier' && !b.pin) throw bad('BAD_PIN', 'Cashiers need a PIN.');
  if (b.pin && pinClash(0, storeIds, b.pin)) throw bad('PIN_TAKEN', 'This PIN is already used by someone in the same store. Choose another.');
  const id = tx(() => {
    let uid;
    try {
      uid = Number(db.prepare(
        'INSERT INTO users (name, email, role, password_hash, pin_hash, lang, perms, created_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(String(b.name).trim(), b.email ? String(b.email).trim().toLowerCase() : null, b.role, b.password ? hashSecret(b.password) : null,
        b.pin ? hashSecret(b.pin) : null, b.lang === 'km' ? 'km' : 'en', JSON.stringify(b.perms || {}), now()).lastInsertRowid);
    } catch { throw bad('DUPLICATE', 'This email is already used.'); }
    for (const s of storeIds) db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id) VALUES (?,?)').run(uid, s);
    audit(req.user.id, null, 'user.create', 'user', uid, { role: b.role, name: b.name });
    return uid;
  });
  res.json({ id });
});

adminRouter.put('/admin/users/:id', (req, res) => {
  need(req, 'users.manage');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) throw notFound();
  const b = req.body || {};
  const role = b.role || u.role;
  const active = b.active == null ? u.active : (b.active ? 1 : 0);
  if ((u.role === 'owner' && (role !== 'owner' || !active)) &&
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id != ?").get(u.id).n < 1) {
    throw bad('LAST_OWNER', 'There must always be at least one active owner.');
  }
  const storeIds = b.store_ids ? b.store_ids.map(Number) : db.prepare('SELECT store_id FROM user_stores WHERE user_id = ?').all(u.id).map((r) => r.store_id);
  if (b.pin) {
    if (!/^\d{4,6}$/.test(String(b.pin))) throw bad('BAD_PIN', 'PIN must be 4 to 6 digits.');
    if (pinClash(u.id, storeIds, b.pin)) throw bad('PIN_TAKEN', 'This PIN is already used by someone in the same store. Choose another.');
  }
  if (b.password && String(b.password).length < 8) throw bad('WEAK_PASSWORD', 'Use at least 8 characters.');
  tx(() => {
    db.prepare('UPDATE users SET name = ?, role = ?, active = ?, perms = ?, lang = ?, email = ? WHERE id = ?')
      .run(String(b.name ?? u.name).trim(), role, active, JSON.stringify(b.perms ?? JSON.parse(u.perms || '{}')), b.lang ?? u.lang, b.email !== undefined ? (b.email ? String(b.email).toLowerCase() : null) : u.email, u.id);
    if (b.password) db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, demo = 0 WHERE id = ?').run(hashSecret(b.password), u.id);
    if (b.pin) db.prepare('UPDATE users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL, demo = 0 WHERE id = ?').run(hashSecret(b.pin), u.id);
    if (b.store_ids) {
      db.prepare('DELETE FROM user_stores WHERE user_id = ?').run(u.id);
      for (const s of storeIds) db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id) VALUES (?,?)').run(u.id, s);
    }
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(req.user.id, null, 'user.update', 'user', u.id, { role, active, perms: b.perms, password_reset: !!b.password, pin_reset: !!b.pin });
  });
  res.json({ ok: true });
});

// ---------- audit log ----------
adminRouter.get('/admin/audit', (req, res) => {
  need(req, 'audit.view');
  const args = []; let sql = 'SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1';
  if (req.user.role !== 'owner') { sql += ` AND (a.store_id IN (${req.stores.map(() => '?').join(',') || 'NULL'}))`; args.push(...req.stores); }
  if (req.query.store_id) { sql += ' AND a.store_id = ?'; args.push(Number(req.query.store_id)); }
  if (req.query.action) { sql += ' AND a.action LIKE ?'; args.push(`${req.query.action}%`); }
  sql += ' ORDER BY a.id DESC LIMIT ?'; args.push(Math.min(Number(req.query.limit) || 100, 500));
  res.json(db.prepare(sql).all(...args));
});

// ---------- dashboard ----------
function periodRange(q) {
  const t = todayStr();
  const d = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  let from; let to; // inclusive dates
  switch (q.period) {
    case '7d': to = t; from = d(t, -6); break;
    case 'month': from = `${t.slice(0, 7)}-01`; to = t; break;
    case 'year': from = `${t.slice(0, 4)}-01-01`; to = t; break;
    case 'custom': from = q.from || t; to = q.to || t; break;
    default: from = t; to = t;
  }
  return { from, to, fromTs: dayRange(from)[0], toTs: dayRange(to)[1] };
}

adminRouter.get('/dashboard', (req, res) => {
  need(req, 'dashboard.view');
  let ids;
  const sel = String(req.query.store || 'all');
  if (sel === 'all') ids = can(req, 'dashboard.all_stores') ? db.prepare('SELECT id FROM stores WHERE active = 1').all().map((r) => r.id) : req.stores;
  else ids = sel.split(',').map((x) => assertStore(req, x));
  if (!ids.length) throw bad('NO_STORES', 'No store selected.');
  const ph = ids.map(() => '?').join(',');
  const pr = periodRange(req.query);
  const seeCost = can(req, 'cost.view');

  const stores = db.prepare(`SELECT id, name, code FROM stores WHERE id IN (${ph}) ORDER BY id`).all(...ids);
  const base = db.prepare(
    `SELECT s.store_id, COUNT(*) AS n, COALESCE(SUM(s.total_cents),0) AS sales, COALESCE(SUM(s.discount_cents),0) AS disc
       FROM sales s WHERE s.status = 'completed' AND s.store_id IN (${ph}) AND s.ts >= ? AND s.ts < ? GROUP BY s.store_id`
  ).all(...ids, pr.fromTs, pr.toTs);
  const cogs = db.prepare(
    `SELECT s.store_id, COALESCE(SUM(l.cost_cents * l.qty),0) AS c, COALESCE(SUM(l.qty),0) AS u
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE s.status = 'completed' AND s.store_id IN (${ph}) AND s.ts >= ? AND s.ts < ? GROUP BY s.store_id`
  ).all(...ids, pr.fromTs, pr.toTs);
  const rets = db.prepare(
    `SELECT r.store_id, COALESCE(SUM(r.refund_cents),0) AS refund FROM returns r JOIN sales s ON s.id = r.sale_id
      WHERE r.store_id IN (${ph}) AND r.ts >= ? AND r.ts < ? AND s.status = 'completed' GROUP BY r.store_id`
  ).all(...ids, pr.fromTs, pr.toTs);
  const retCogs = db.prepare(
    `SELECT r.store_id, COALESCE(SUM(sl.cost_cents * rl.qty),0) AS c FROM return_lines rl JOIN returns r ON r.id = rl.return_id JOIN sale_lines sl ON sl.id = rl.sale_line_id
      WHERE r.store_id IN (${ph}) AND r.ts >= ? AND r.ts < ? GROUP BY r.store_id`
  ).all(...ids, pr.fromTs, pr.toTs);
  const stockVal = db.prepare(
    `SELECT m.store_id, COALESCE(SUM(m.qty * d.cost_cents),0) AS v, COALESCE(SUM(m.qty),0) AS pieces
       FROM stock_movements m JOIN items i ON i.id = m.item_id JOIN designs d ON d.id = i.design_id
      WHERE m.bucket = 'stock' AND m.store_id IN (${ph}) GROUP BY m.store_id`
  ).all(...ids);
  const low = db.prepare(
    `SELECT m.store_id, m.item_id, SUM(m.qty) AS q, i.low_stock, i.sku FROM stock_movements m JOIN items i ON i.id = m.item_id
      WHERE m.bucket = 'stock' AND m.store_id IN (${ph}) AND i.active = 1 GROUP BY m.store_id, m.item_id HAVING q <= i.low_stock ORDER BY q, i.sku`
  ).all(...ids);
  const pick = (rows, id, key) => rows.find((r) => r.store_id === id)?.[key] || 0;
  const by_store = stores.map((s) => {
    const sales = pick(base, s.id, 'sales') - pick(rets, s.id, 'refund');
    const o = {
      store_id: s.id, name: s.name, code: s.code, sales_cents: sales, orders: pick(base, s.id, 'n'), units: pick(cogs, s.id, 'u'), discount_cents: pick(base, s.id, 'disc'),
      low_stock: low.filter((l) => l.store_id === s.id).length, pieces: pick(stockVal, s.id, 'pieces'),
    };
    if (seeCost) {
      o.gross_profit_cents = sales - (pick(cogs, s.id, 'c') - pick(retCogs, s.id, 'c'));
      o.stock_value_cents = pick(stockVal, s.id, 'v');
    }
    return o;
  });
  const sum = (k) => by_store.reduce((a, s) => a + (s[k] || 0), 0);
  const orders = sum('orders');
  const cards = {
    sales_cents: sum('sales_cents'), orders, avg_basket_cents: orders ? Math.round(sum('sales_cents') / orders) : 0,
    units: sum('units'), discount_cents: sum('discount_cents'), low_stock: sum('low_stock'), pieces: sum('pieces'),
  };
  if (seeCost) { cards.gross_profit_cents = sum('gross_profit_cents'); cards.stock_value_cents = sum('stock_value_cents'); }

  const trend = db.prepare(
    `SELECT strftime('%Y-%m-%d', (ts / 1000) + 25200, 'unixepoch') AS day, SUM(total_cents) AS cents, COUNT(*) AS n
       FROM sales WHERE status = 'completed' AND store_id IN (${ph}) AND ts >= ? AND ts < ? GROUP BY day ORDER BY day`
  ).all(...ids, pr.fromTs, pr.toTs);
  const top = db.prepare(
    `SELECT i.sku, d.name_en, d.name_km, SUM(l.qty) AS qty, SUM(l.line_total_cents) AS cents
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN items i ON i.id = l.item_id JOIN designs d ON d.id = i.design_id
      WHERE s.status = 'completed' AND s.store_id IN (${ph}) AND s.ts >= ? AND s.ts < ? GROUP BY i.id ORDER BY qty DESC LIMIT 8`
  ).all(...ids, pr.fromTs, pr.toTs);
  const methods = db.prepare(
    `SELECT p.method, SUM(p.usd_cents) AS cents FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE p.kind = 'tender' AND s.status = 'completed' AND s.store_id IN (${ph}) AND s.ts >= ? AND s.ts < ? GROUP BY p.method`
  ).all(...ids, pr.fromTs, pr.toTs);

  const alerts = [];
  const diffShifts = db.prepare(
    `SELECT sh.id, sh.store_id, sh.diff_usd_cents, sh.diff_khr, u.name FROM shifts sh JOIN users u ON u.id = sh.user_id
      WHERE sh.store_id IN (${ph}) AND sh.closed_ts IS NOT NULL AND sh.reviewed_by IS NULL AND (sh.diff_usd_cents != 0 OR ABS(sh.diff_khr) >= 1000) ORDER BY sh.id DESC LIMIT 10`
  ).all(...ids);
  for (const s of diffShifts) alerts.push({ kind: 'cash_difference', store_id: s.store_id, text: `${s.name}: ${(s.diff_usd_cents / 100).toFixed(2)} USD, ${s.diff_khr} KHR`, ref: s.id });
  for (const t of db.prepare(`SELECT id, code, from_store_id, to_store_id FROM transfers WHERE status = 'discrepancy' AND (from_store_id IN (${ph}) OR to_store_id IN (${ph}))`).all(...ids, ...ids)) {
    alerts.push({ kind: 'transfer_discrepancy', store_id: t.to_store_id, text: t.code, ref: t.id });
  }
  const dayAgo = now() - 24 * 3600 * 1000;
  for (const t of db.prepare(`SELECT id, code, from_store_id FROM transfers WHERE status IN ('requested','awaiting_owner') AND requested_ts < ? AND (from_store_id IN (${ph}) OR to_store_id IN (${ph}))`).all(dayAgo, ...ids, ...ids)) {
    alerts.push({ kind: 'transfer_waiting', store_id: t.from_store_id, text: t.code, ref: t.id });
  }
  const voids = db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE status = 'voided' AND store_id IN (${ph}) AND ts >= ? AND ts < ?`).get(...ids, pr.fromTs, pr.toTs).n;
  if (voids) alerts.push({ kind: 'voids', text: String(voids) });
  for (const l of low.slice(0, 8)) alerts.push({ kind: 'low_stock', store_id: l.store_id, text: `${l.sku}: ${Math.max(0, l.q)}` });

  const tr = db.prepare(
    `SELECT status, COUNT(*) AS n FROM transfers WHERE status IN ('requested','awaiting_owner','approved','in_transit','discrepancy') AND (from_store_id IN (${ph}) OR to_store_id IN (${ph})) GROUP BY status`
  ).all(...ids, ...ids);

  res.json({
    scope: { store_ids: ids, all: sel === 'all', stores }, period: { from: pr.from, to: pr.to }, cards, by_store, trend, top_items: top, methods, alerts,
    transfers: Object.fromEntries(tr.map((r) => [r.status, r.n])),
    note: 'Profit shown is gross profit (sales minus cost of goods). Expenses and payroll are not built yet.',
  });
});
