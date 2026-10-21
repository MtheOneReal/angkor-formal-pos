// The register: sales, payments (USD, KHR, KHQR), discounts, voids, returns, shifts, rates, customers.
import express from 'express';
import { db, tx, now } from './db.js';
import {
  bad, forbidden, notFound, need, can, audit, assertStore, getSwitches, currentRate, findApprover,
  khrToUsdCents, usdCentsToKhr, khrTolerance, HttpError,
} from './lib.js';
import { addMovement, stockMap } from './stock.js';

export const salesRouter = express.Router();

const PNH = '+07:00';
export const dayRange = (dateStr) => {
  const start = Date.parse(`${dateStr}T00:00:00${PNH}`);
  return [start, start + 24 * 3600 * 1000];
};
export const todayStr = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// ---------- helpers ----------
function openShift(userId, storeId) {
  return db.prepare('SELECT * FROM shifts WHERE user_id = ? AND store_id = ? AND closed_ts IS NULL').get(userId, storeId);
}

function approvalOr(req, storeId, pin, why) {
  const a = findApprover(storeId, pin);
  if (!a) throw new HttpError(403, 'APPROVAL_REQUIRED', why || 'A manager PIN is needed for this.');
  return a;
}

export function getSale(id) {
  const s = db.prepare(
    `SELECT s.*, st.name AS store_name, st.code AS store_code, st.receipt_footer, u.name AS cashier_name, c.name AS customer_name, c.phone AS customer_phone
       FROM sales s JOIN stores st ON st.id = s.store_id JOIN users u ON u.id = s.cashier_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = ?`
  ).get(id);
  if (!s) return null;
  s.lines = db.prepare(
    `SELECT l.*, i.sku, i.size, d.name_en, d.name_km, c.name_en AS colour_en, c.name_km AS colour_km
       FROM sale_lines l JOIN items i ON i.id = l.item_id JOIN designs d ON d.id = i.design_id JOIN colours c ON c.code = i.colour_code
      WHERE l.sale_id = ? ORDER BY l.id`
  ).all(id);
  const returned = db.prepare(
    'SELECT sale_line_id, SUM(qty) AS q, SUM(refund_cents) AS r FROM return_lines WHERE return_id IN (SELECT id FROM returns WHERE sale_id = ?) GROUP BY sale_line_id'
  ).all(id);
  const rm = new Map(returned.map((r) => [r.sale_line_id, r]));
  for (const l of s.lines) { l.returned_qty = rm.get(l.id)?.q || 0; l.returned_cents = rm.get(l.id)?.r || 0; }
  s.payments = db.prepare('SELECT kind, method, currency, amount, usd_cents FROM sale_payments WHERE sale_id = ? ORDER BY id').all(id);
  s.total_khr = usdCentsToKhr(s.total_cents, s.rate_khr_per_usd);
  s.approved_by_name = s.approved_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(s.approved_by)?.name : null;
  return s;
}

function accessSale(req, id) {
  const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id));
  if (!s) throw notFound('Receipt not found.');
  if (!req.stores.includes(s.store_id)) throw forbidden('You do not have access to this store.');
  if (req.user.role === 'cashier' && s.cashier_id !== req.user.id) throw forbidden('You can only see your own sales.');
  return s;
}

// ---------- create a sale ----------
salesRouter.post('/sales', (req, res) => {
  need(req, 'pos.sell');
  const b = req.body || {};
  const storeId = assertStore(req, b.store_id);
  const sw = getSwitches(storeId);
  const shift = openShift(req.user.id, storeId);
  if (!shift) throw new HttpError(409, 'SHIFT_REQUIRED', 'Open your shift before selling.');

  const lines = (b.lines || []).map((l) => ({
    item_id: Number(l.item_id), qty: Math.floor(Number(l.qty)), entry: ['scan', 'typed', 'search'].includes(l.entry) ? l.entry : 'search',
  })).filter((l) => l.item_id && l.qty > 0);
  if (!lines.length) throw bad('EMPTY_CART', 'Add at least one item.');

  const saleId = tx(() => {
    // Which stock can be sold here
    const ids = [...new Set(lines.map((l) => l.item_id))];
    const sm = stockMap(storeId, ids);
    const items = new Map();
    for (const id of ids) {
      const it = db.prepare(
        `SELECT i.id, i.sku, i.active AS ia, d.active AS da, d.price_cents, d.cost_cents FROM items i JOIN designs d ON d.id = i.design_id WHERE i.id = ?`
      ).get(id);
      if (!it || !it.ia || !it.da) throw bad('BAD_ITEM', 'An item in the cart cannot be sold.');
      items.set(id, it);
    }
    const want = new Map();
    for (const l of lines) want.set(l.item_id, (want.get(l.item_id) || 0) + l.qty);
    for (const [id, q] of want) {
      const have = Math.max(0, (sm.get(id) || { available: 0 }).available);
      if (q > have) throw new HttpError(409, 'OUT_OF_STOCK', `${items.get(id).sku}: only ${have} available in this store.`, { item_id: id, available: have });
    }

    let approver = null;
    // Optional control switch: scan only
    if (sw.require_scan_to_sell && lines.some((l) => l.entry !== 'scan') && !can(req, 'pos.approve')) {
      approver = approvalOr(req, storeId, b.manager_pin, 'Scanning is required. A manager PIN unlocks typed entry.');
    }

    // Totals
    let subtotal = 0;
    const calc = lines.map((l) => {
      const it = items.get(l.item_id);
      const gross = it.price_cents * l.qty;
      subtotal += gross;
      return { ...l, unit: it.price_cents, cost: it.cost_cents, gross, disc: 0 };
    });
    let discount = 0;
    const d = b.discount || null;
    if (d && Number(d.value) > 0) {
      discount = d.type === 'percent' ? Math.round((subtotal * Number(d.value)) / 100) : Math.round(Number(d.value) * 100);
      if (discount > subtotal) discount = subtotal;
      if (String(d.reason || '').trim().length < 3) throw bad('REASON_REQUIRED', 'Write a reason for the discount.');
    }
    if (discount > 0) {
      const pct = (discount * 100) / subtotal;
      const needs = !can(req, 'pos.approve') && (sw.pin_every_discount || pct > sw.cashier_discount_limit_percent);
      if (needs) approver = approvalOr(req, storeId, b.manager_pin, `A discount above ${sw.cashier_discount_limit_percent}% needs a manager PIN.`);
      // spread the discount over lines in proportion to their value (remainder to the last line)
      let left = discount;
      calc.forEach((c, i) => {
        c.disc = i === calc.length - 1 ? left : Math.floor((discount * c.gross) / subtotal);
        left -= c.disc;
      });
    }
    const total = subtotal - discount;
    if (total <= 0) throw bad('ZERO_TOTAL', 'The total must be more than zero.');

    if (sw.customer_required && !b.customer_id) throw bad('CUSTOMER_REQUIRED', 'Attach a customer to this sale.');
    if (b.customer_id && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(Number(b.customer_id))) throw bad('BAD_CUSTOMER', 'Unknown customer.');

    // Payments
    const rate = currentRate();
    const mk = (kind) => (p) => {
      const method = kind === 'change' ? 'cash' : p.method;
      if (!['cash', 'khqr', 'card'].includes(method)) throw bad('BAD_PAYMENT', 'Unknown payment method.');
      if (!['USD', 'KHR'].includes(p.currency)) throw bad('BAD_PAYMENT', 'Unknown currency.');
      const amount = Math.floor(Number(p.amount));
      if (!(amount > 0)) throw bad('BAD_PAYMENT', 'Payment amounts must be more than zero.');
      return { kind, method, currency: p.currency, amount, usd: p.currency === 'USD' ? amount : khrToUsdCents(amount, rate) };
    };
    const tender = (b.payments || []).map(mk('tender'));
    const change = (b.change || []).map(mk('change'));
    if (!tender.length) throw bad('NO_PAYMENT', 'Choose how the customer pays.');
    const paid = tender.reduce((a, p) => a + p.usd, 0);
    const given = change.reduce((a, p) => a + p.usd, 0);
    const cashIn = tender.filter((p) => p.method === 'cash').reduce((a, p) => a + p.usd, 0);
    if (given > cashIn) throw bad('BAD_CHANGE', 'Change cannot be more than the cash received.');
    const tol = [...tender, ...change].some((p) => p.currency === 'KHR') ? khrTolerance(rate) : 0;
    if (Math.abs(paid - given - total) > tol) {
      throw bad('PAYMENT_MISMATCH', 'Payment minus change does not match the total.', { total_cents: total, paid_cents: paid, change_cents: given });
    }

    const seq = (db.prepare('SELECT MAX(seq) AS m FROM sales WHERE store_id = ?').get(storeId).m || 0) + 1;
    const store = db.prepare('SELECT code FROM stores WHERE id = ?').get(storeId);
    const receipt = `${store.code}-${String(seq).padStart(6, '0')}`;
    const sid = Number(db.prepare(
      `INSERT INTO sales (store_id, seq, receipt_no, ts, cashier_id, shift_id, customer_id, subtotal_cents, discount_cents, total_cents,
                          rate_khr_per_usd, discount_reason, approved_by, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(storeId, seq, receipt, now(), req.user.id, shift.id, b.customer_id ? Number(b.customer_id) : null, subtotal, discount, total, rate,
      d?.reason ? String(d.reason).slice(0, 200) : null, approver ? approver.id : null, b.note ? String(b.note).slice(0, 200) : null).lastInsertRowid);

    const insL = db.prepare(
      `INSERT INTO sale_lines (sale_id, item_id, qty, unit_price_cents, cost_cents, discount_cents, line_total_cents, entry) VALUES (?,?,?,?,?,?,?,?)`
    );
    for (const c of calc) {
      insL.run(sid, c.item_id, c.qty, c.unit, c.cost, c.disc, c.gross - c.disc, c.entry);
      addMovement({ storeId, itemId: c.item_id, qty: -c.qty, type: 'sale', refType: 'sale', refId: sid, userId: req.user.id });
    }
    const insP = db.prepare('INSERT INTO sale_payments (sale_id, kind, method, currency, amount, usd_cents) VALUES (?,?,?,?,?,?)');
    for (const p of [...tender, ...change]) insP.run(sid, p.kind, p.method, p.currency, p.amount, p.usd);
    audit(req.user.id, storeId, 'sale.create', 'sale', sid, { receipt, total, discount, approver: approver?.id ?? null });
    return sid;
  });
  res.json(getSale(saleId));
});

salesRouter.get('/sales', (req, res) => {
  need(req, 'sales.view');
  const storeId = assertStore(req, req.query.store_id);
  const [from, to] = dayRange(req.query.date || todayStr());
  let sql = 'SELECT id FROM sales WHERE store_id = ? AND ts >= ? AND ts < ?';
  const args = [storeId, from, to];
  if (req.user.role === 'cashier') { sql += ' AND cashier_id = ?'; args.push(req.user.id); }
  if (req.query.q) { sql += ' AND receipt_no LIKE ?'; args.push(`%${String(req.query.q).trim()}%`); }
  sql += ' ORDER BY id DESC LIMIT 200';
  res.json(db.prepare(sql).all(...args).map((r) => {
    const s = getSale(r.id);
    return { id: s.id, receipt_no: s.receipt_no, ts: s.ts, status: s.status, total_cents: s.total_cents, cashier_name: s.cashier_name, pieces: s.lines.reduce((a, l) => a + l.qty, 0), methods: [...new Set(s.payments.filter((p) => p.kind === 'tender').map((p) => p.method))] };
  }));
});

salesRouter.get('/sales/by-receipt/:no', (req, res) => {
  need(req, 'sales.view');
  const s = db.prepare('SELECT id FROM sales WHERE receipt_no = ?').get(String(req.params.no).toUpperCase());
  if (!s) throw notFound('Receipt not found.');
  accessSale(req, s.id);
  const full = getSale(s.id);
  if (req.user.role === 'cashier') for (const l of full.lines) delete l.cost_cents;
  res.json(full);
});

salesRouter.get('/sales/:id', (req, res) => {
  need(req, 'sales.view');
  accessSale(req, req.params.id);
  const full = getSale(Number(req.params.id));
  if (!can(req, 'cost.view')) for (const l of full.lines) delete l.cost_cents;
  res.json(full);
});

salesRouter.post('/sales/:id/void', (req, res) => {
  const s = accessSale(req, req.params.id);
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 3) throw bad('REASON_REQUIRED', 'Write a reason for the void.');
  if (s.status !== 'completed') throw bad('BAD_STATUS', 'This receipt is already voided.');
  if (db.prepare('SELECT 1 FROM returns WHERE sale_id = ?').get(s.id)) throw bad('HAS_RETURNS', 'This receipt has returns and cannot be voided.');
  let approver = null;
  if (!can(req, 'sales.void')) {
    need(req, 'sales.view');
    approver = approvalOr(req, s.store_id, (req.body || {}).manager_pin, 'A manager PIN is needed to void a sale.');
    const sh = openShift(req.user.id, s.store_id);
    if (!sh || sh.id !== s.shift_id) throw forbidden('A cashier can only void a sale from their own open shift.');
  }
  tx(() => {
    for (const l of db.prepare('SELECT * FROM sale_lines WHERE sale_id = ?').all(s.id)) {
      addMovement({ storeId: s.store_id, itemId: l.item_id, qty: l.qty, type: 'void', refType: 'sale', refId: s.id, userId: req.user.id, reason });
    }
    db.prepare('UPDATE sales SET status = ?, voided_by = ?, void_reason = ?, voided_ts = ? WHERE id = ?').run('voided', (approver || req.user).id, reason, now(), s.id);
    audit(req.user.id, s.store_id, 'sale.void', 'sale', s.id, { reason, approver: approver?.id ?? null });
  });
  res.json(getSale(s.id));
});

salesRouter.post('/sales/:id/return', (req, res) => {
  const s = accessSale(req, req.params.id);
  const b = req.body || {};
  const sw = getSwitches(s.store_id);
  const reason = String(b.reason || '').trim();
  if (reason.length < 3) throw bad('REASON_REQUIRED', 'Write a reason for the return.');
  if (s.status !== 'completed') throw bad('BAD_STATUS', 'This receipt cannot take returns.');
  let approver = null;
  const needsPin = !can(req, 'pos.approve') && (sw.pin_every_return || !can(req, 'sales.return'));
  if (needsPin) approver = approvalOr(req, s.store_id, b.manager_pin, 'A manager PIN is needed for returns.');
  const sh = openShift(req.user.id, s.store_id);
  if (!sh) throw new HttpError(409, 'SHIFT_REQUIRED', 'Open your shift before taking a return.');
  const want = (b.lines || []).map((l) => ({ id: Number(l.sale_line_id), qty: Math.floor(Number(l.qty)) })).filter((l) => l.id && l.qty > 0);
  if (!want.length) throw bad('NO_LINES', 'Choose the items to return.');
  const rid = tx(() => {
    let refund = 0;
    const plan = [];
    for (const w of want) {
      const l = db.prepare('SELECT * FROM sale_lines WHERE id = ? AND sale_id = ?').get(w.id, s.id);
      if (!l) throw bad('BAD_LINE', 'This item is not on the receipt.');
      const done = db.prepare('SELECT COALESCE(SUM(qty),0) AS q, COALESCE(SUM(refund_cents),0) AS r FROM return_lines WHERE sale_line_id = ?').get(l.id);
      if (w.qty > l.qty - done.q) throw bad('TOO_MANY', 'More pieces than were sold.');
      const amount = w.qty === l.qty - done.q ? l.line_total_cents - done.r : Math.round((l.line_total_cents * w.qty) / l.qty);
      plan.push({ l, qty: w.qty, amount });
      refund += amount;
    }
    const method = b.refund_method === 'khqr' ? 'khqr' : 'cash';
    const rid2 = Number(db.prepare(
      'INSERT INTO returns (sale_id, store_id, ts, user_id, approved_by, reason, refund_method, refund_cents) VALUES (?,?,?,?,?,?,?,?)'
    ).run(s.id, s.store_id, now(), req.user.id, approver ? approver.id : null, reason, method, refund).lastInsertRowid);
    for (const p of plan) {
      db.prepare('INSERT INTO return_lines (return_id, sale_line_id, item_id, qty, refund_cents) VALUES (?,?,?,?,?)').run(rid2, p.l.id, p.l.item_id, p.qty, p.amount);
      addMovement({ storeId: s.store_id, itemId: p.l.item_id, qty: p.qty, bucket: 'returned', type: 'return', refType: 'return', refId: rid2, userId: req.user.id, reason });
    }
    audit(req.user.id, s.store_id, 'sale.return', 'sale', s.id, { refund, reason, approver: approver?.id ?? null });
    return rid2;
  });
  res.json({ ok: true, return_id: rid, sale: getSale(s.id) });
});

// ---------- shifts ----------
export function shiftTotals(sh) {
  const end = sh.closed_ts || now();
  const sums = db.prepare(
    `SELECT p.kind, p.method, p.currency, SUM(p.amount) AS amt, SUM(p.usd_cents) AS usd
       FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.shift_id = ? AND s.status = 'completed' GROUP BY p.kind, p.method, p.currency`
  ).all(sh.id);
  const get = (kind, method, cur) => sums.find((x) => x.kind === kind && x.method === method && x.currency === cur)?.amt || 0;
  const refunds = db.prepare(
    `SELECT COALESCE(SUM(refund_cents),0) AS r FROM returns WHERE user_id = ? AND store_id = ? AND refund_method = 'cash' AND ts >= ? AND ts <= ?`
  ).get(sh.user_id, sh.store_id, sh.opened_ts, end).r;
  const sales = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS t FROM sales WHERE shift_id = ? AND status = 'completed'`).get(sh.id);
  const expected_usd = sh.open_usd_cents + get('tender', 'cash', 'USD') - get('change', 'cash', 'USD') - refunds;
  const expected_khr = sh.open_khr + get('tender', 'cash', 'KHR') - get('change', 'cash', 'KHR');
  return {
    sales_count: sales.n, sales_total_cents: sales.t, expected_usd_cents: expected_usd, expected_khr,
    by_method: {
      cash_usd: get('tender', 'cash', 'USD') - get('change', 'cash', 'USD'), cash_khr: get('tender', 'cash', 'KHR') - get('change', 'cash', 'KHR'),
      khqr_usd_cents: sums.filter((x) => x.kind === 'tender' && x.method === 'khqr').reduce((a, x) => a + x.usd, 0),
      card_usd_cents: sums.filter((x) => x.kind === 'tender' && x.method === 'card').reduce((a, x) => a + x.usd, 0),
    },
    refunds_cents: refunds,
  };
}

salesRouter.get('/shifts/current', (req, res) => {
  need(req, 'shift.use');
  const storeId = assertStore(req, req.query.store_id);
  const sh = openShift(req.user.id, storeId);
  if (!sh) return res.json(null);
  const t = shiftTotals(sh);
  // The cashier should count the drawer without seeing the expected amount.
  const { expected_usd_cents, expected_khr, diff_usd_cents, diff_khr, ...safe } = sh;
  res.json({ ...safe, sales_count: t.sales_count, sales_total_cents: t.sales_total_cents });
});

salesRouter.post('/shifts/open', (req, res) => {
  need(req, 'shift.use');
  const b = req.body || {};
  const storeId = assertStore(req, b.store_id);
  if (openShift(req.user.id, storeId)) throw bad('ALREADY_OPEN', 'You already have an open shift.');
  const usd = Math.round(Number(b.open_usd || 0) * 100);
  const khr = Math.round(Number(b.open_khr || 0));
  if (usd < 0 || khr < 0) throw bad('BAD_INPUT', 'Amounts cannot be negative.');
  const id = Number(db.prepare('INSERT INTO shifts (store_id, user_id, opened_ts, open_usd_cents, open_khr) VALUES (?,?,?,?,?)').run(storeId, req.user.id, now(), usd, khr).lastInsertRowid);
  audit(req.user.id, storeId, 'shift.open', 'shift', id, { usd, khr });
  res.json(db.prepare('SELECT * FROM shifts WHERE id = ?').get(id));
});

salesRouter.post('/shifts/close', (req, res) => {
  need(req, 'shift.use');
  const b = req.body || {};
  const sh = db.prepare('SELECT * FROM shifts WHERE id = ?').get(Number(b.shift_id));
  if (!sh || sh.closed_ts) throw notFound('Shift not found or already closed.');
  if (sh.user_id !== req.user.id && !can(req, 'shift.review')) throw forbidden();
  assertStore(req, sh.store_id);
  const cu = Math.round(Number(b.counted_usd) * 100); const ck = Math.round(Number(b.counted_khr || 0));
  if (!(cu >= 0) || !(ck >= 0)) throw bad('BAD_INPUT', 'Enter the cash you counted in USD and riel.');
  const t = shiftTotals(sh);
  db.prepare(
    `UPDATE shifts SET closed_ts = ?, counted_usd_cents = ?, counted_khr = ?, expected_usd_cents = ?, expected_khr = ?, diff_usd_cents = ?, diff_khr = ?, note = ? WHERE id = ?`
  ).run(now(), cu, ck, t.expected_usd_cents, t.expected_khr, cu - t.expected_usd_cents, ck - t.expected_khr, b.note ? String(b.note).slice(0, 300) : null, sh.id);
  audit(req.user.id, sh.store_id, 'shift.close', 'shift', sh.id, { diff_usd_cents: cu - t.expected_usd_cents, diff_khr: ck - t.expected_khr });
  const full = { ...db.prepare('SELECT * FROM shifts WHERE id = ?').get(sh.id), ...t };
  if (getSwitches(sh.store_id).blind_counts && !can(req, 'shift.review')) {
    // Blind close: the cashier is told it was recorded, not how far off the count was.
    return res.json({ id: sh.id, closed_ts: full.closed_ts, blind: true });
  }
  res.json(full);
});

salesRouter.get('/shifts', (req, res) => {
  need(req, 'shift.review');
  const storeId = assertStore(req, req.query.store_id);
  const rows = db.prepare(
    `SELECT sh.*, u.name AS user_name FROM shifts sh JOIN users u ON u.id = sh.user_id WHERE sh.store_id = ? ORDER BY sh.id DESC LIMIT 60`
  ).all(storeId);
  res.json(rows.map((r) => ({ ...r, ...(r.closed_ts ? {} : shiftTotals(r)) })));
});

salesRouter.post('/shifts/:id/review', (req, res) => {
  need(req, 'shift.review');
  const sh = db.prepare('SELECT * FROM shifts WHERE id = ?').get(Number(req.params.id));
  if (!sh) throw notFound();
  assertStore(req, sh.store_id);
  if (sh.user_id === req.user.id) throw forbidden('You cannot review your own shift.');
  db.prepare('UPDATE shifts SET reviewed_by = ?, reviewed_ts = ? WHERE id = ?').run(req.user.id, now(), sh.id);
  audit(req.user.id, sh.store_id, 'shift.review', 'shift', sh.id);
  res.json({ ok: true });
});

// ---------- exchange rate ----------
salesRouter.get('/rates/current', (_req, res) => res.json({ khr_per_usd: currentRate() }));
salesRouter.post('/rates', (req, res) => {
  need(req, 'rates.set');
  const r = Math.floor(Number((req.body || {}).khr_per_usd));
  if (!(r >= 3000 && r <= 6000)) throw bad('BAD_RATE', 'Enter riel per US dollar between 3,000 and 6,000.');
  db.prepare('INSERT INTO exchange_rates (ts, khr_per_usd, set_by) VALUES (?,?,?)').run(now(), r, req.user.id);
  audit(req.user.id, null, 'rate.set', 'rate', null, { khr_per_usd: r });
  res.json({ khr_per_usd: r });
});

// ---------- customers ----------
salesRouter.get('/customers', (req, res) => {
  need(req, 'customers.manage');
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json(db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 30').all(q, q));
});
salesRouter.post('/customers', (req, res) => {
  need(req, 'customers.manage');
  const b = req.body || {};
  if (!String(b.name || '').trim()) throw bad('BAD_INPUT', 'Enter a name.');
  const id = Number(db.prepare('INSERT INTO customers (name, phone, note, created_at) VALUES (?,?,?,?)')
    .run(String(b.name).trim().slice(0, 100), b.phone ? String(b.phone).slice(0, 30) : null, b.note ? String(b.note).slice(0, 300) : null, now()).lastInsertRowid);
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
});
