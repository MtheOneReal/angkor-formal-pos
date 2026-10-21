// Catalogue: types, colours, designs and SKUs, search and barcode lookup, photos.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, tx, now, DATA_DIR } from './db.js';
import { bad, notFound, need, can, audit, assertStore } from './lib.js';
import { stockMap, incomingMap } from './stock.js';

export const catalogRouter = express.Router();

export const SIZES_SUIT = ['44', '46', '48', '50', '52', '54', '56'];

export function makeSku(brandCode, typeCode, number, colour, size) {
  return `${brandCode}-${typeCode}${String(number).padStart(2, '0')}-${colour}-${size}`.toUpperCase();
}

// What a user may see of an item. Cost is only sent to users who may view it.
export function itemRows(whereSql, args, req, limit = 60) {
  const rows = db.prepare(
    `SELECT i.id, i.sku, i.size, i.colour_code, i.low_stock, i.active AS item_active,
            d.id AS design_id, d.name_en, d.name_km, d.photo, d.price_cents, d.cost_cents, d.type_code, d.number, d.active AS design_active,
            b.code AS brand_code, c.name_en AS colour_en, c.name_km AS colour_km, c.hex AS colour_hex
       FROM items i JOIN designs d ON d.id = i.design_id JOIN brands b ON b.id = d.brand_id JOIN colours c ON c.code = i.colour_code
      WHERE ${whereSql} ORDER BY d.type_code, d.number, i.colour_code, CAST(i.size AS INTEGER), i.size LIMIT ${limit}`
  ).all(...args);
  const seeCost = can(req, 'cost.view');
  return rows.map((r) => {
    const o = { ...r, active: !!(r.item_active && r.design_active) };
    delete o.item_active; delete o.design_active;
    if (!seeCost) delete o.cost_cents;
    return o;
  });
}

function tokensWhere(q) {
  const tokens = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const parts = []; const args = [];
  for (const t of tokens) {
    parts.push('(i.sku LIKE ? OR d.name_en LIKE ? OR d.name_km LIKE ? OR c.name_en LIKE ? OR c.name_km LIKE ? OR i.size = ?)');
    const like = `%${t}%`;
    args.push(like, like, like, like, like, t);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1=1', args };
}

catalogRouter.get('/meta', (req, res) => {
  res.json({
    brands: db.prepare('SELECT id, code, name FROM brands ORDER BY id').all(),
    types: db.prepare('SELECT * FROM types ORDER BY code').all(),
    colours: db.prepare('SELECT * FROM colours ORDER BY code').all(),
    suit_sizes: SIZES_SUIT,
  });
});

// Search items, with stock for one store. q can be a SKU, a name, a colour or a size.
catalogRouter.get('/items', (req, res) => {
  need(req, 'catalog.view');
  const storeId = assertStore(req, req.query.store_id);
  const { sql, args } = tokensWhere(req.query.q);
  const active = req.query.all === '1' && can(req, 'catalog.edit') ? '1=1' : 'i.active = 1 AND d.active = 1';
  const items = itemRows(`${active} AND ${sql}`, args, req, Math.min(Number(req.query.limit) || 40, 200));
  const ids = items.map((i) => i.id);
  const sm = stockMap(storeId, ids);
  const inc = incomingMap(storeId, ids);
  res.json(items.map((i) => ({ ...i, ...(sm.get(i.id) || { on_hand: 0, reserved: 0, available: 0 }), incoming: inc.get(i.id) || 0 })));
});

// Exact scan / typed-code lookup. Case-insensitive, tolerant of spaces and different dash characters.
export function normaliseCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, '');
}
catalogRouter.get('/items/code/:code', (req, res) => {
  need(req, 'catalog.view');
  const storeId = assertStore(req, req.query.store_id);
  const code = normaliseCode(req.params.code);
  const rows = itemRows('i.sku = ? AND i.active = 1 AND d.active = 1', [code], req, 1);
  if (!rows.length) throw notFound('This code is not in the catalogue.');
  const s = stockMap(storeId, [rows[0].id]).get(rows[0].id) || { on_hand: 0, reserved: 0, available: 0 };
  res.json({ ...rows[0], ...s, incoming: incomingMap(storeId, [rows[0].id]).get(rows[0].id) || 0 });
});

catalogRouter.get('/designs', (req, res) => {
  need(req, 'catalog.view');
  const rows = db.prepare(
    `SELECT d.*, b.code AS brand_code FROM designs d JOIN brands b ON b.id = d.brand_id ORDER BY d.brand_id, d.type_code, d.number`
  ).all();
  const seeCost = can(req, 'cost.view');
  const items = db.prepare('SELECT id, design_id, sku, colour_code, size, low_stock, active FROM items').all();
  const by = new Map();
  for (const i of items) { if (!by.has(i.design_id)) by.set(i.design_id, []); by.get(i.design_id).push(i); }
  res.json(rows.map((d) => {
    const o = { ...d, items: by.get(d.id) || [] };
    if (!seeCost) delete o.cost_cents;
    return o;
  }));
});

function savePhoto(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) throw bad('BAD_PHOTO', 'Photo must be a PNG, JPG or WEBP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) throw bad('PHOTO_TOO_BIG', 'Photo is too large (max 4 MB).');
  const name = `${crypto.randomBytes(8).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), buf);
  return `/uploads/${name}`;
}

// Create a design with many sizes and colours at once.
catalogRouter.post('/designs', (req, res) => {
  need(req, 'catalog.edit');
  const b = req.body || {};
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(Number(b.brand_id));
  const type = db.prepare('SELECT * FROM types WHERE code = ?').get(b.type_code);
  if (!brand || !type) throw bad('BAD_INPUT', 'Choose a brand and a type.');
  if (!b.name_en) throw bad('BAD_INPUT', 'Enter a name.');
  const price = Math.round(Number(b.price_usd) * 100);
  const cost = Math.round(Number(b.cost_usd || 0) * 100);
  if (!(price > 0)) throw bad('BAD_INPUT', 'Enter a selling price.');
  const colours = (b.colours || []).filter(Boolean);
  const sizes = (b.sizes || []).map(String).filter(Boolean);
  if (!colours.length || !sizes.length) throw bad('BAD_INPUT', 'Choose at least one colour and one size.');
  const result = tx(() => {
    let number = Number(b.number);
    if (!number) {
      const r = db.prepare('SELECT MAX(number) AS n FROM designs WHERE brand_id = ? AND type_code = ?').get(brand.id, type.code);
      number = (r.n || 0) + 1;
    }
    const photo = savePhoto(b.photo);
    let designId;
    try {
      designId = db.prepare(
        `INSERT INTO designs (brand_id, type_code, number, name_en, name_km, photo, price_cents, cost_cents, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(brand.id, type.code, number, b.name_en, b.name_km || null, photo, price, cost, now()).lastInsertRowid;
    } catch {
      throw bad('DUPLICATE', 'This brand, type and number already exist.');
    }
    const ins = db.prepare('INSERT INTO items (sku, design_id, colour_code, size, low_stock) VALUES (?,?,?,?,?)');
    const skus = [];
    for (const colour of colours) {
      if (!db.prepare('SELECT 1 FROM colours WHERE code = ?').get(colour)) throw bad('BAD_INPUT', `Unknown colour ${colour}.`);
      for (const size of sizes) {
        const sku = makeSku(brand.code, type.code, number, colour, size);
        ins.run(sku, designId, colour, size, Number(b.low_stock ?? 2));
        skus.push(sku);
      }
    }
    audit(req.user.id, null, 'design.create', 'design', designId, { skus: skus.length, number });
    return { id: Number(designId), number, skus };
  });
  res.json(result);
});

catalogRouter.put('/designs/:id', (req, res) => {
  need(req, 'catalog.edit');
  const d = db.prepare('SELECT * FROM designs WHERE id = ?').get(Number(req.params.id));
  if (!d) throw notFound();
  const b = req.body || {};
  const photo = b.photo ? savePhoto(b.photo) : d.photo;
  const price = b.price_usd != null ? Math.round(Number(b.price_usd) * 100) : d.price_cents;
  const cost = b.cost_usd != null ? Math.round(Number(b.cost_usd) * 100) : d.cost_cents;
  db.prepare('UPDATE designs SET name_en = ?, name_km = ?, photo = ?, price_cents = ?, cost_cents = ?, active = ? WHERE id = ?')
    .run(b.name_en ?? d.name_en, b.name_km ?? d.name_km, photo, price, cost, b.active == null ? d.active : (b.active ? 1 : 0), d.id);
  audit(req.user.id, null, 'design.update', 'design', d.id, { price_from: d.price_cents, price_to: price });
  res.json({ ok: true });
});

catalogRouter.put('/items/:id', (req, res) => {
  need(req, 'catalog.edit');
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(req.params.id));
  if (!it) throw notFound();
  const b = req.body || {};
  db.prepare('UPDATE items SET low_stock = ?, active = ? WHERE id = ?')
    .run(b.low_stock != null ? Math.max(0, Number(b.low_stock)) : it.low_stock, b.active == null ? it.active : (b.active ? 1 : 0), it.id);
  audit(req.user.id, null, 'item.update', 'item', it.id, b);
  res.json({ ok: true });
});
