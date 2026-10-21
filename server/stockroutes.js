// Stock: lists, cross-store look-up, stock in, adjustments, returned items.
import express from 'express';
import { db, tx } from './db.js';
import { bad, need, can, audit, assertStore, getSwitches, notFound } from './lib.js';
import { addMovement, stockMap, incomingMap, level } from './stock.js';
import { itemRows } from './catalog.js';

export const stockRouter = express.Router();

function searchWhere(q) {
  const tokens = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const parts = []; const args = [];
  for (const t of tokens) {
    parts.push('(i.sku LIKE ? OR d.name_en LIKE ? OR d.name_km LIKE ? OR c.name_en LIKE ? OR c.name_km LIKE ? OR i.size = ?)');
    const like = `%${t}%`;
    args.push(like, like, like, like, like, t);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1=1', args };
}

// Stock levels for one store.
stockRouter.get('/stock', (req, res) => {
  need(req, 'stock.view');
  const storeId = assertStore(req, req.query.store_id);
  const { sql, args } = searchWhere(req.query.q);
  const items = itemRows(`i.active = 1 AND d.active = 1 AND ${sql}`, args, req, 300);
  const sm = stockMap(storeId, items.map((i) => i.id));
  const out = items.map((i) => ({ ...i, ...(sm.get(i.id) || { on_hand: 0, reserved: 0, available: 0 }) }))
    .filter((i) => req.query.only_stocked !== '1' || i.on_hand !== 0 || i.reserved !== 0);
  res.json(out);
});

// Cashier-safe look-up of availability in all stores. Never contains cost.
stockRouter.get('/stock/lookup', (req, res) => {
  need(req, 'stock.view');
  const myStore = assertStore(req, req.query.store_id);
  const sw = getSwitches(myStore);
  const isCashier = req.user.role === 'cashier';
  const canOther = can(req, 'stock.view_other') && (!isCashier || sw.cashier_see_other_stock);
  const exact = !isCashier || sw.show_exact_other_qty;
  const { sql, args } = searchWhere(req.query.q);
  if (!String(req.query.q || '').trim()) return res.json({ stores: [], items: [] });
  const items = itemRows(`i.active = 1 AND d.active = 1 AND ${sql}`, args, req, 30);
  const allStores = db.prepare('SELECT id, name, code FROM stores WHERE active = 1 ORDER BY id').all();
  const stores = (canOther ? allStores : allStores.filter((s) => s.id === myStore))
    .sort((a, b) => (a.id === myStore ? -1 : b.id === myStore ? 1 : a.id - b.id));
  const ids = items.map((i) => i.id);
  const per = new Map(stores.map((s) => [s.id, stockMap(s.id, ids)]));
  const inc = incomingMap(myStore, ids);
  res.json({
    stores,
    items: items.map((i) => {
      const o = {
        id: i.id, sku: i.sku, size: i.size, colour_code: i.colour_code, colour_en: i.colour_en, colour_km: i.colour_km,
        colour_hex: i.colour_hex, name_en: i.name_en, name_km: i.name_km, photo: i.photo, price_cents: i.price_cents,
        type_code: i.type_code, brand_code: i.brand_code, incoming: inc.get(i.id) || 0,
        stores: stores.map((s) => {
          const m = per.get(s.id).get(i.id) || { available: 0, on_hand: 0, reserved: 0 };
          const row = { store_id: s.id, level: level(m.available, i.low_stock) };
          if (s.id === myStore || exact) row.qty = Math.max(0, m.available);
          return row;
        }),
      };
      return o;
    }),
  });
});

stockRouter.post('/stock/in', (req, res) => {
  need(req, 'stock.in');
  const b = req.body || {};
  const storeId = assertStore(req, b.store_id);
  const lines = (b.lines || []).map((l) => ({ item_id: Number(l.item_id), qty: Math.floor(Number(l.qty)) })).filter((l) => l.item_id && l.qty > 0);
  if (!lines.length) throw bad('NO_LINES', 'Add at least one item with a quantity.');
  const reference = String(b.reference || '').slice(0, 120);
  tx(() => {
    for (const l of lines) {
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(l.item_id)) throw bad('BAD_ITEM', 'Unknown item.');
      addMovement({ storeId, itemId: l.item_id, qty: l.qty, type: 'stock_in', userId: req.user.id, reason: reference || 'delivery' });
    }
    audit(req.user.id, storeId, 'stock.in', 'store', storeId, { pieces: lines.reduce((a, l) => a + l.qty, 0), lines: lines.length, reference });
  });
  res.json({ ok: true });
});

// Adjustments need a reason. Managers and owners only.
stockRouter.post('/stock/adjust', (req, res) => {
  need(req, 'stock.adjust');
  const b = req.body || {};
  const storeId = assertStore(req, b.store_id);
  const itemId = Number(b.item_id);
  const delta = Math.trunc(Number(b.qty_delta));
  const reason = String(b.reason || '').trim();
  if (!itemId || !delta) throw bad('BAD_INPUT', 'Choose an item and a change in pieces.');
  if (reason.length < 3) throw bad('REASON_REQUIRED', 'Write a short reason.');
  tx(() => {
    const cur = stockMap(storeId, [itemId]).get(itemId) || { available: 0, on_hand: 0 };
    if (cur.on_hand + delta < 0) throw bad('NEGATIVE_STOCK', 'This would make stock below zero.');
    addMovement({ storeId, itemId, qty: delta, type: 'adjustment', userId: req.user.id, reason });
    audit(req.user.id, storeId, 'stock.adjust', 'item', itemId, { delta, reason });
  });
  res.json({ ok: true });
});

stockRouter.get('/stock/movements', (req, res) => {
  need(req, 'stock.view');
  const storeId = assertStore(req, req.query.store_id);
  const itemId = Number(req.query.item_id);
  res.json(db.prepare(
    `SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.store_id = ? AND m.item_id = ? ORDER BY m.id DESC LIMIT 100`
  ).all(storeId, itemId));
});

// Items that came back from customers and wait for a check.
stockRouter.get('/stock/returned', (req, res) => {
  need(req, 'stock.adjust');
  const storeId = assertStore(req, req.query.store_id);
  res.json(db.prepare(
    `SELECT m.item_id, i.sku, SUM(m.qty) AS qty FROM stock_movements m JOIN items i ON i.id = m.item_id
      WHERE m.store_id = ? AND m.bucket = 'returned' GROUP BY m.item_id HAVING SUM(m.qty) > 0`
  ).all(storeId));
});

stockRouter.post('/stock/returned/resolve', (req, res) => {
  need(req, 'stock.adjust');
  const b = req.body || {};
  const storeId = assertStore(req, b.store_id);
  const itemId = Number(b.item_id);
  const qty = Math.floor(Number(b.qty));
  const to = b.to === 'damaged' ? 'damaged' : 'stock';
  tx(() => {
    const r = db.prepare(`SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements WHERE store_id = ? AND item_id = ? AND bucket = 'returned'`).get(storeId, itemId);
    if (!(qty > 0) || qty > r.q) throw bad('BAD_QTY', 'Quantity is more than the returned pieces.');
    addMovement({ storeId, itemId, qty: -qty, bucket: 'returned', type: 'return_check', userId: req.user.id, reason: to });
    addMovement({ storeId, itemId, qty, bucket: to, type: 'return_check', userId: req.user.id, reason: 'checked' });
    audit(req.user.id, storeId, 'return.check', 'item', itemId, { qty, to });
  });
  res.json({ ok: true });
});
