// Demo data so the owner can try everything. Run: npm run seed   (add -- --reset to wipe and start again)
// All demo accounts are marked "demo" and the app shows a banner until their passwords and PINs are changed.
import { db, tx, now } from './db.js';
import { hashSecret } from './lib.js';
import { makeSku } from './catalog.js';

const reset = process.argv.includes('--reset');
const hasData = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
if (hasData && !reset) {
  console.log('The database already has users. Run "npm run seed -- --reset" to wipe it and load demo data again.');
  process.exit(0);
}

// Small repeatable random generator so the demo data is the same each time.
let s = 20261021;
const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const PASSWORD = 'Demo-1234';

tx(() => {
  if (reset) {
    for (const t of ['return_lines', 'returns', 'sale_payments', 'sale_lines', 'sales', 'shifts', 'transfer_lines', 'transfers', 'stock_movements',
      'items', 'designs', 'colours', 'types', 'customers', 'exchange_rates', 'store_settings', 'global_settings', 'audit_log', 'sessions',
      'user_stores', 'users', 'stores', 'brands']) db.exec(`DELETE FROM ${t}`);
  }

  // Brands. The two non-Angkor prefixes are placeholders until the owner confirms them.
  const brand = db.prepare('INSERT INTO brands (code, name) VALUES (?,?)');
  const AF = Number(brand.run('AF', 'Angkor Formal').lastInsertRowid);
  const BO = Number(brand.run('BO', 'Business Outfits').lastInsertRowid);
  const AT = Number(brand.run('AT', 'អាវធំ Cambodia').lastInsertRowid);

  const store = db.prepare('INSERT INTO stores (code, name, brand_id, receipt_footer) VALUES (?,?,?,?)');
  const storeIds = [
    Number(store.run('AF', 'Angkor Formal', AF, 'Thank you for choosing Angkor Formal.').lastInsertRowid),
    Number(store.run('BW', 'Business Outfits (Wat Koh)', BO, 'Thank you.').lastInsertRowid),
    Number(store.run('B5', 'Business Outfits (598)', BO, 'Thank you.').lastInsertRowid),
    Number(store.run('AC', 'អាវធំ Cambodia', AT, 'សូមអរគុណ។').lastInsertRowid),
    Number(store.run('S5', 'Store 5 (name to be confirmed)', AF, 'Thank you.').lastInsertRowid),
  ];

  const ty = db.prepare('INSERT INTO types (code, name_en, name_km) VALUES (?,?,?)');
  [['S', 'Suit', 'ឈុតអាវសូត'], ['B', 'Blazer', 'អាវធំ'], ['T', 'Trousers', 'ខោ'], ['H', 'Shirt', 'អាវ'], ['A', 'Accessory', 'គ្រឿងបន្ថែម']]
    .forEach((t) => ty.run(...t));
  const co = db.prepare('INSERT INTO colours (code, name_en, name_km, hex) VALUES (?,?,?,?)');
  [['BLK', 'Black', 'ខ្មៅ', '#1b1917'], ['NVY', 'Navy', 'ខៀវចាស់', '#1f2a44'], ['CHA', 'Charcoal', 'ប្រផេះចាស់', '#3b3f46'],
    ['GRY', 'Grey', 'ប្រផេះ', '#8a8d91'], ['BRN', 'Brown', 'ត្នោត', '#5b4636'], ['BEI', 'Beige', 'ក្រែម', '#d8c7a8'], ['WHT', 'White', 'ស', '#f5f3ee']]
    .forEach((c) => co.run(...c));

  // Users (demo)
  const user = db.prepare('INSERT INTO users (name, email, role, password_hash, pin_hash, lang, demo, created_at) VALUES (?,?,?,?,?,?,1,?)');
  const link = db.prepare('INSERT INTO user_stores (user_id, store_id) VALUES (?,?)');
  const t0 = now();
  const owners = [['Bunhong', 9001], ['Vibol', 9002], ['Bunheng', 9003], ['Chhovkheng', 9004], ['Sokha', 9005]];
  const ownerIds = owners.map(([n, pin]) => Number(user.run(n, `${n.toLowerCase()}@demo.local`, 'owner', hashSecret(PASSWORD), hashSecret(String(pin)), 'en', t0).lastInsertRowid));
  const cashiers = {};
  const managers = {};
  const cashierNames = [['Sophea', 'Dara'], ['Srey Neang', 'Vuthy'], ['Chanthou', 'Rithy'], ['Sreyleak', 'Piseth'], ['Kunthea', 'Veasna']];
  storeIds.forEach((sid, i) => {
    const mid = Number(user.run(`Manager ${i + 1}`, `manager${i + 1}@demo.local`, 'manager', hashSecret(PASSWORD), hashSecret(String(8001 + i)), 'en', t0).lastInsertRowid);
    link.run(mid, sid); managers[sid] = mid;
    cashiers[sid] = cashierNames[i].map((n, k) => {
      const cid = Number(user.run(n, null, 'cashier', null, hashSecret(String(1101 + i * 100 + k)), 'en', t0).lastInsertRowid);
      link.run(cid, sid);
      return cid;
    });
  });

  db.prepare('INSERT INTO exchange_rates (ts, khr_per_usd, set_by) VALUES (?,?,?)').run(t0, 4000, ownerIds[0]);

  // Catalogue
  const brandCode = { [AF]: 'AF', [BO]: 'BO', [AT]: 'AT' };
  const designDefs = [
    ['S', 'Classic Slim Suit', 'ឈុតអាវសូតស្លីម', 189, 95, ['NVY', 'CHA'], ['46', '48', '50', '52', '54']],
    ['S', 'Modern Two-Button Suit', 'ឈុតអាវសូតទំនើប', 219, 110, ['BLK', 'NVY'], ['46', '48', '50', '52', '54']],
    ['B', 'Textured Blazer', 'អាវធំសរសៃ', 129, 62, ['GRY', 'BRN'], ['46', '48', '50', '52']],
    ['T', 'Tailored Trousers', 'ខោស្លីម', 49, 22, ['BLK', 'CHA'], ['30', '32', '34', '36', '38']],
    ['H', 'Dress Shirt', 'អាវសឺមី', 35, 14, ['WHT', 'BEI'], ['38', '39', '40', '41', '42']],
    ['A', 'Silk Tie', 'ខ្សែក្រវ៉ាត់ក', 19, 6, ['NVY', 'BRN', 'BLK'], ['ONE']],
  ];
  const insD = db.prepare('INSERT INTO designs (brand_id, type_code, number, name_en, name_km, price_cents, cost_cents, created_at) VALUES (?,?,?,?,?,?,?,?)');
  const insI = db.prepare('INSERT INTO items (sku, design_id, colour_code, size, low_stock) VALUES (?,?,?,?,2)');
  const itemsByBrand = {};
  for (const b of [AF, BO, AT]) {
    itemsByBrand[b] = [];
    const counters = {};
    for (const [type, en, km, price, cost, colours, sizes] of designDefs) {
      counters[type] = (counters[type] || 0) + 1;
      const number = counters[type];
      const did = Number(insD.run(b, type, number, en, km, price * 100, cost * 100, t0).lastInsertRowid);
      for (const c of colours) for (const sz of sizes) {
        const id = Number(insI.run(makeSku(brandCode[b], type, number, c, sz), did, c, sz).lastInsertRowid);
        itemsByBrand[b].push({ id, price: price * 100, cost: cost * 100, type });
      }
    }
  }

  // Opening stock for every store (stock is a ledger: opening stock is a stock_in movement)
  const mv = db.prepare('INSERT INTO stock_movements (ts, store_id, item_id, qty, bucket, type, ref_type, ref_id, user_id, reason) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const stock = new Map(); // `${store}:${item}` -> qty
  const storeBrand = { [storeIds[0]]: AF, [storeIds[1]]: BO, [storeIds[2]]: BO, [storeIds[3]]: AT, [storeIds[4]]: AF };
  const openTs = Date.now() - 16 * 86400000;
  for (const sid of storeIds) {
    for (const it of itemsByBrand[storeBrand[sid]]) {
      const q = rnd() < 0.12 ? 0 : 3 + Math.floor(rnd() * 8);
      stock.set(`${sid}:${it.id}`, q);
      if (q > 0) mv.run(openTs, sid, it.id, q, 'stock', 'stock_in', null, null, ownerIds[0], 'opening stock (demo)');
    }
  }

  // 14 days of demo sales
  const insSale = db.prepare(
    `INSERT INTO sales (store_id, seq, receipt_no, ts, cashier_id, shift_id, status, subtotal_cents, discount_cents, total_cents, rate_khr_per_usd)
     VALUES (?,?,?,?,?,?,?,?,?,?,4000)`
  );
  const insLine = db.prepare('INSERT INTO sale_lines (sale_id, item_id, qty, unit_price_cents, cost_cents, discount_cents, line_total_cents, entry) VALUES (?,?,?,?,?,?,?,?)');
  const insPay = db.prepare('INSERT INTO sale_payments (sale_id, kind, method, currency, amount, usd_cents) VALUES (?,?,?,?,?,?)');
  const insShift = db.prepare(
    `INSERT INTO shifts (store_id, user_id, opened_ts, open_usd_cents, open_khr, closed_ts, counted_usd_cents, counted_khr, expected_usd_cents, expected_khr, diff_usd_cents, diff_khr)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const storeCodes = db.prepare('SELECT id, code FROM stores').all();
  const weight = { [storeIds[0]]: 1.3, [storeIds[1]]: 1.0, [storeIds[2]]: 0.8, [storeIds[3]]: 0.9, [storeIds[4]]: 0.5 };
  for (let dAgo = 14; dAgo >= 1; dAgo--) {
    const dayStart = new Date(Date.now() + 7 * 3600000 - dAgo * 86400000).toISOString().slice(0, 10);
    for (const sid of storeIds) {
      const code = storeCodes.find((x) => x.id === sid).code;
      const cashier = pick(cashiers[sid]);
      const openedTs = Date.parse(`${dayStart}T09:00:00+07:00`);
      const shiftId = Number(insShift.run(sid, cashier, openedTs, 10000, 400000, openedTs + 11 * 3600000, 0, 0, 0, 0, 0, 0).lastInsertRowid);
      let seq = db.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM sales WHERE store_id = ?').get(sid).m;
      let cashUsd = 10000; let cashKhr = 400000;
      const n = Math.max(2, Math.round((3 + rnd() * 7) * weight[sid]));
      for (let k = 0; k < n; k++) {
        const pieces = 1 + (rnd() < 0.35 ? 1 : 0) + (rnd() < 0.12 ? 1 : 0);
        const chosen = [];
        for (let p = 0; p < pieces; p++) {
          const pool = itemsByBrand[storeBrand[sid]].filter((i) => (stock.get(`${sid}:${i.id}`) || 0) > 0);
          if (!pool.length) break;
          const it = pick(pool);
          stock.set(`${sid}:${it.id}`, stock.get(`${sid}:${it.id}`) - 1);
          chosen.push(it);
        }
        if (!chosen.length) continue;
        const subtotal = chosen.reduce((a, c) => a + c.price, 0);
        const discount = rnd() < 0.12 ? Math.round((subtotal * 0.05) / 100) * 100 : 0;
        const total = subtotal - discount;
        const hh = 9 + Math.floor(rnd() * 11); const mm = Math.floor(rnd() * 60);
        const ts = Date.parse(`${dayStart}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`);
        seq += 1;
        const sale = Number(insSale.run(sid, seq, `${code}-${String(seq).padStart(6, '0')}`, ts, cashier, shiftId, 'completed', subtotal, discount, total).lastInsertRowid);
        let left = discount;
        chosen.forEach((c, i) => {
          const ld = i === chosen.length - 1 ? left : Math.floor((discount * c.price) / subtotal);
          left -= ld;
          insLine.run(sale, c.id, 1, c.price, c.cost, ld, c.price - ld, 'scan');
          mv.run(ts, sid, c.id, -1, 'stock', 'sale', 'sale', sale, cashier, null);
        });
        const r = rnd();
        if (r < 0.5) { insPay.run(sale, 'tender', 'cash', 'USD', total, total); cashUsd += total; }
        else if (r < 0.62) {
          const khr = Math.round((total * 4000) / 100 / 100) * 100;
          insPay.run(sale, 'tender', 'cash', 'KHR', khr, Math.round((khr * 100) / 4000)); cashKhr += khr;
        } else insPay.run(sale, 'tender', 'khqr', 'USD', total, total);
      }
      db.prepare('UPDATE shifts SET counted_usd_cents = ?, counted_khr = ?, expected_usd_cents = ?, expected_khr = ? WHERE id = ?').run(cashUsd, cashKhr, cashUsd, cashKhr, shiftId);
    }
  }

  // Current stock for the demo = opening stock minus demo sales (the movements above already record that).
  // Two demo transfers: one waiting for approval, one on its way.
  const items1 = itemsByBrand[AF].filter((i) => (stock.get(`${storeIds[0]}:${i.id}`) || 0) >= 3).slice(0, 3);
  const insT = db.prepare('INSERT INTO transfers (code, from_store_id, to_store_id, status, reason, requested_by, requested_ts) VALUES (?,?,?,?,?,?,?)');
  const insTL = db.prepare('INSERT INTO transfer_lines (transfer_id, item_id, qty_requested, qty_sent) VALUES (?,?,?,?)');
  if (items1.length >= 2) {
    const t1 = Number(insT.run('TR-00001', storeIds[0], storeIds[4], 'requested', 'Customer asked for this size', cashiers[storeIds[4]][0], now() - 3600000).lastInsertRowid);
    insTL.run(t1, items1[0].id, 1, null);
    const t2 = Number(insT.run('TR-00002', storeIds[0], storeIds[1], 'in_transit', 'Restock', managers[storeIds[1]], now() - 7200000).lastInsertRowid);
    db.prepare('UPDATE transfers SET approved_by = ?, approved_ts = ?, sent_by = ?, sent_ts = ? WHERE id = ?').run(managers[storeIds[0]], now() - 6000000, managers[storeIds[0]], now() - 5400000, t2);
    insTL.run(t2, items1[1].id, 2, 2);
    mv.run(now() - 5400000, storeIds[0], items1[1].id, -2, 'stock', 'transfer_out', 'transfer', t2, managers[storeIds[0]], null);
  }
});

console.log('Demo data loaded.');
console.log('Owners: bunhong@demo.local, vibol@demo.local, bunheng@demo.local, chhovkheng@demo.local, sokha@demo.local  (password: Demo-1234)');
console.log('Managers: manager1@demo.local ... manager5@demo.local  (password: Demo-1234)');
console.log('Cashiers sign in with a PIN at the till (for example Sophea at Angkor Formal: 1101).');
