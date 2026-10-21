// Stock ledger helpers. Quantities are always calculated from stock_movements.
import { db, now } from './db.js';

export function addMovement({ storeId, itemId, qty, type, bucket = 'stock', refType = null, refId = null, userId = null, reason = null }) {
  db.prepare(
    `INSERT INTO stock_movements (ts, store_id, item_id, qty, bucket, type, ref_type, ref_id, user_id, reason)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(now(), storeId, itemId, qty, bucket, type, refType, refId, userId, reason);
}

// Returns Map(itemId -> { on_hand, reserved, available }) for one store.
export function stockMap(storeId, itemIds = null) {
  const out = new Map();
  const ensure = (id) => {
    if (!out.has(id)) out.set(id, { on_hand: 0, reserved: 0, available: 0 });
    return out.get(id);
  };
  const filter = itemIds && itemIds.length ? ` AND item_id IN (${itemIds.map(() => '?').join(',')})` : '';
  const args = itemIds && itemIds.length ? itemIds : [];
  for (const r of db.prepare(
    `SELECT item_id, SUM(qty) AS q FROM stock_movements WHERE store_id = ? AND bucket = 'stock'${filter} GROUP BY item_id`
  ).all(storeId, ...args)) ensure(r.item_id).on_hand = r.q;
  for (const r of db.prepare(
    `SELECT tl.item_id AS item_id, SUM(tl.qty_requested) AS q
       FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
      WHERE t.from_store_id = ? AND t.status IN ('awaiting_owner','approved')${filter.replace('item_id', 'tl.item_id')}
      GROUP BY tl.item_id`
  ).all(storeId, ...args)) ensure(r.item_id).reserved = r.q;
  for (const v of out.values()) v.available = v.on_hand - v.reserved;
  return out;
}

export function stockOf(storeId, itemId) {
  return stockMap(storeId, [itemId]).get(itemId) || { on_hand: 0, reserved: 0, available: 0 };
}

// Pieces sent to a store that have not been received yet (In transit).
export function incomingMap(toStoreId, itemIds = null) {
  const filter = itemIds && itemIds.length ? ` AND tl.item_id IN (${itemIds.map(() => '?').join(',')})` : '';
  const args = itemIds && itemIds.length ? itemIds : [];
  const out = new Map();
  for (const r of db.prepare(
    `SELECT tl.item_id AS item_id, SUM(COALESCE(tl.qty_sent,0) - COALESCE(tl.qty_received,0)) AS q
       FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
      WHERE t.to_store_id = ? AND t.status = 'in_transit'${filter} GROUP BY tl.item_id`
  ).all(toStoreId, ...args)) out.set(r.item_id, r.q);
  return out;
}

export const level = (available, low) => (available <= 0 ? 'out' : available <= low ? 'low' : 'in');
