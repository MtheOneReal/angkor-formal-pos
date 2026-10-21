// Transfers between stores: request -> approve -> send -> receive -> (resolve differences).
import express from 'express';
import { db, tx, now } from './db.js';
import { bad, forbidden, notFound, need, can, audit, getSwitches } from './lib.js';
import { addMovement, stockMap } from './stock.js';

export const transferRouter = express.Router();

const OPEN_STATUSES = ['requested', 'awaiting_owner', 'approved'];

function lines(transferId) {
  return db.prepare(
    `SELECT tl.id, tl.item_id, tl.qty_requested, tl.qty_sent, tl.qty_received, i.sku, i.size, d.name_en, d.name_km, d.photo,
            c.name_en AS colour_en, c.name_km AS colour_km, c.hex AS colour_hex
       FROM transfer_lines tl JOIN items i ON i.id = tl.item_id JOIN designs d ON d.id = i.design_id JOIN colours c ON c.code = i.colour_code
      WHERE tl.transfer_id = ? ORDER BY tl.id`
  ).all(transferId);
}

function view(t) {
  const names = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name ?? null : null);
  const store = (id) => db.prepare('SELECT id, name, code FROM stores WHERE id = ?').get(id);
  const ls = lines(t.id);
  return {
    ...t,
    from_store: store(t.from_store_id), to_store: store(t.to_store_id),
    requested_by_name: names(t.requested_by), approved_by_name: names(t.approved_by), owner_approved_by_name: names(t.owner_approved_by),
    sent_by_name: names(t.sent_by), received_by_name: names(t.received_by), resolved_by_name: names(t.resolved_by),
    lines: ls, pieces: ls.reduce((a, l) => a + l.qty_requested, 0),
  };
}

function mine(req, t) {
  return req.user.role === 'owner' || req.stores.includes(t.from_store_id) || req.stores.includes(t.to_store_id);
}
const inStore = (req, storeId) => req.user.role === 'owner' || req.stores.includes(storeId);

function load(req, id) {
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(Number(id));
  if (!t) throw notFound('Transfer not found.');
  if (!mine(req, t)) throw forbidden('You do not have access to this transfer.');
  return t;
}

transferRouter.get('/transfers', (req, res) => {
  need(req, 'transfer.request');
  const storeId = Number(req.query.store_id) || null;
  const rows = db.prepare('SELECT * FROM transfers ORDER BY id DESC LIMIT 300').all()
    .filter((t) => mine(req, t))
    .filter((t) => !storeId || t.from_store_id === storeId || t.to_store_id === storeId)
    .filter((t) => !req.query.status || req.query.status.split(',').includes(t.status));
  res.json(rows.map(view));
});

transferRouter.get('/transfers/:id', (req, res) => {
  need(req, 'transfer.request');
  res.json(view(load(req, req.params.id)));
});

transferRouter.post('/transfers', (req, res) => {
  need(req, 'transfer.request');
  const b = req.body || {};
  const from = Number(b.from_store_id); const to = Number(b.to_store_id);
  if (!from || !to || from === to) throw bad('BAD_STORES', 'Choose two different stores.');
  if (!db.prepare('SELECT 1 FROM stores WHERE id = ? AND active = 1').get(from) || !db.prepare('SELECT 1 FROM stores WHERE id = ? AND active = 1').get(to)) throw bad('BAD_STORES', 'Unknown store.');
  if (!inStore(req, from) && !inStore(req, to)) throw forbidden('You can only request transfers for your own store.');
  const ls = (b.lines || []).map((l) => ({ item_id: Number(l.item_id), qty: Math.floor(Number(l.qty)) })).filter((l) => l.item_id && l.qty > 0);
  if (!ls.length) throw bad('NO_LINES', 'Add at least one item.');
  const id = tx(() => {
    const code = `tmp-${Math.random().toString(36).slice(2)}`;
    const tid = Number(db.prepare(
      `INSERT INTO transfers (code, from_store_id, to_store_id, status, reason, customer_note, requested_by, requested_ts)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(code, from, to, 'requested', String(b.reason || '').slice(0, 300), String(b.customer_note || '').slice(0, 300), req.user.id, now()).lastInsertRowid);
    db.prepare('UPDATE transfers SET code = ? WHERE id = ?').run(`TR-${String(tid).padStart(5, '0')}`, tid);
    const ins = db.prepare('INSERT INTO transfer_lines (transfer_id, item_id, qty_requested) VALUES (?,?,?)');
    for (const l of ls) {
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(l.item_id)) throw bad('BAD_ITEM', 'Unknown item.');
      ins.run(tid, l.item_id, l.qty);
    }
    audit(req.user.id, to, 'transfer.request', 'transfer', tid, { from, to, pieces: ls.reduce((a, l) => a + l.qty, 0) });
    return tid;
  });
  res.json(view(db.prepare('SELECT * FROM transfers WHERE id = ?').get(id)));
});

function checkApprover(req, t) {
  need(req, 'transfer.approve');
  if (!inStore(req, t.from_store_id)) throw forbidden('Only the sending store manager or an owner can approve.');
  if (t.requested_by === req.user.id) throw forbidden('You cannot approve your own request.');
}

transferRouter.post('/transfers/:id/approve', (req, res) => {
  const t = load(req, req.params.id);
  checkApprover(req, t);
  if (t.status !== 'requested') throw bad('BAD_STATUS', 'This request is not waiting for approval.');
  tx(() => {
    const ls = lines(t.id);
    const sm = stockMap(t.from_store_id, ls.map((l) => l.item_id));
    for (const l of ls) {
      const s = sm.get(l.item_id) || { available: 0 };
      if (s.available < l.qty_requested) throw bad('NOT_ENOUGH', `Not enough stock for ${l.sku}. Available: ${Math.max(0, s.available)}.`);
    }
    const sw = getSwitches(t.from_store_id);
    const pieces = ls.reduce((a, l) => a + l.qty_requested, 0);
    const needsOwner = sw.owner_approval_large_transfer && pieces >= sw.large_transfer_pieces && req.user.role !== 'owner';
    db.prepare('UPDATE transfers SET status = ?, approved_by = ?, approved_ts = ? WHERE id = ?')
      .run(needsOwner ? 'awaiting_owner' : 'approved', req.user.id, now(), t.id);
    audit(req.user.id, t.from_store_id, 'transfer.approve', 'transfer', t.id, { needsOwner });
  });
  res.json(view(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
});

transferRouter.post('/transfers/:id/owner-approve', (req, res) => {
  const t = load(req, req.params.id);
  if (req.user.role !== 'owner') throw forbidden('Only an owner can do this.');
  need(req, 'transfer.approve');
  if (t.requested_by === req.user.id) throw forbidden('You cannot approve your own request.');
  if (t.status !== 'awaiting_owner') throw bad('BAD_STATUS', 'This transfer is not waiting for an owner.');
  db.prepare('UPDATE transfers SET status = ?, owner_approved_by = ?, owner_approved_ts = ? WHERE id = ?').run('approved', req.user.id, now(), t.id);
  audit(req.user.id, t.from_store_id, 'transfer.owner_approve', 'transfer', t.id);
  res.json(view(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
});

transferRouter.post('/transfers/:id/reject', (req, res) => {
  const t = load(req, req.params.id);
  checkApprover(req, t);
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 3) throw bad('REASON_REQUIRED', 'Write a short reason.');
  if (!['requested', 'awaiting_owner'].includes(t.status)) throw bad('BAD_STATUS', 'This request cannot be rejected now.');
  db.prepare('UPDATE transfers SET status = ?, reject_reason = ? WHERE id = ?').run('rejected', reason, t.id);
  audit(req.user.id, t.from_store_id, 'transfer.reject', 'transfer', t.id, { reason });
  res.json(view(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
});

transferRouter.post('/transfers/:id/cancel', (req, res) => {
  const t = load(req, req.params.id);
  const allowed = t.requested_by === req.user.id || t.approved_by === req.user.id || req.user.role === 'owner' || (can(req, 'transfer.approve') && inStore(req, t.from_store_id));
  if (!allowed) throw forbidden();
  if (!OPEN_STATUSES.includes(t.status)) throw bad('BAD_STATUS', 'This transfer can no longer be cancelled.');
  db.prepare('UPDATE transfers SET status = ? WHERE id = ?').run('cancelled', t.id);
  audit(req.user.id, t.from_store_id, 'transfer.cancel', 'transfer', t.id);
  res.json(view(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
});

transferRouter.post('/transfers/:id/send', (req, res) => {
  const t = load(req, req.params.id);
  need(req, 'transfer.send');
  if (!inStore(req, t.from_store_id)) throw forbidden('Only the sending store can send.');
  if (t.status !== 'approved') throw bad('BAD_STATUS', 'This transfer is not approved.');
  const given = new Map(((req.body || {}).lines || []).map((l) => [Number(l.line_id), Math.floor(Number(l.qty_sent))]));
  tx(() => {
    const ls = lines(t.id);
    let total = 0;
    for (const l of ls) {
      const q = given.has(l.id) ? given.get(l.id) : l.qty_requested;
      if (!(q >= 0) || q > l.qty_requested) throw bad('BAD_QTY', `Quantity for ${l.sku} is not valid.`);
      const s = stockMap(t.from_store_id, [l.item_id]).get(l.item_id) || { on_hand: 0 };
      if (s.on_hand < q) throw bad('NOT_ENOUGH', `Not enough stock for ${l.sku}.`);
      db.prepare('UPDATE transfer_lines SET qty_sent = ? WHERE id = ?').run(q, l.id);
      if (q > 0) addMovement({ storeId: t.from_store_id, itemId: l.item_id, qty: -q, type: 'transfer_out', refType: 'transfer', refId: t.id, userId: req.user.id });
      total += q;
    }
    if (total === 0) throw bad('NOTHING_SENT', 'Send at least one piece.');
    db.prepare('UPDATE transfers SET status = ?, sent_by = ?, sent_ts = ? WHERE id = ?').run('in_transit', req.user.id, now(), t.id);
    audit(req.user.id, t.from_store_id, 'transfer.send', 'transfer', t.id, { pieces: total });
  });
  res.json(view(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
});

transferRouter.post('/transfers/:id/receive', (req, res) => {
  const t = load(req, req.params.id);
  need(req, 'transfer.receive');
  if (!inStore(req, t.to_store_id)) throw forbidden('Only the receiving store can receive.');
  if (t.status !== 'in_transit') throw bad('BAD_STATUS', 'This transfer is not in transit.');
  const given = new Map(((req.body || {}).lines || []).map((l) => [Number(l.line_id), Math.floor(Number(l.qty_received))]));
  tx(() => {
    let diff = false;
    for (const l of lines(t.id)) {
      const q = given.has(l.id) ? given.get(l.id) : l.qty_sent;
      if (!(q >= 0) || q > (l.qty_sent || 0)) throw bad('BAD_QTY', `Received quantity for ${l.sku} is not valid.`);
      db.prepare('UPDATE transfer_lines SET qty_received = ? WHERE id = ?').run(q, l.id);
      if (q > 0) addMovement({ storeId: t.to_store_id, itemId: l.item_id, qty: q, type: 'transfer_in', refType: 'transfer', refId: t.id, userId: req.user.id });
      if (q !== (l.qty_sent || 0)) diff = true;
    }
    db.prepare('UPDATE transfers SET status = ?, received_by = ?, received_ts = ? WHERE id = ?').run(diff ? 'discrepancy' : 'received', req.user.id, now(), t.id);
    audit(req.user.id, t.to_store_id, 'transfer.receive', 'transfer', t.id, { discrepancy: diff });
  });
  res.json(view(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
});

transferRouter.post('/transfers/:id/resolve', (req, res) => {
  const t = load(req, req.params.id);
  need(req, 'transfer.resolve');
  const { resolution, note } = req.body || {};
  if (!['found', 'lost'].includes(resolution)) throw bad('BAD_INPUT', 'Choose found or lost.');
  if (String(note || '').trim().length < 3) throw bad('REASON_REQUIRED', 'Write a short note.');
  if (t.status !== 'discrepancy') throw bad('BAD_STATUS', 'This transfer has no difference to resolve.');
  tx(() => {
    if (resolution === 'found') {
      for (const l of lines(t.id)) {
        const d = (l.qty_sent || 0) - (l.qty_received || 0);
        if (d > 0) addMovement({ storeId: t.to_store_id, itemId: l.item_id, qty: d, type: 'transfer_found', refType: 'transfer', refId: t.id, userId: req.user.id, reason: note });
      }
    }
    db.prepare('UPDATE transfers SET status = ?, resolution = ?, resolution_note = ?, resolved_by = ?, resolved_ts = ? WHERE id = ?')
      .run('resolved', resolution, note, req.user.id, now(), t.id);
    audit(req.user.id, t.to_store_id, 'transfer.resolve', 'transfer', t.id, { resolution, note });
  });
  res.json(view(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
});
