import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, PASSWORD } from './helpers.js';

let app; let db;
const S = { AF: 1, BW: 2, B5: 3, AC: 4, S5: 5 };
before(async () => { app = await startApp(); db = app.db; });
after(() => app.close());

const userId = (name) => db.prepare('SELECT id FROM users WHERE name = ?').get(name).id;
async function owner(name = 'Vibol') { return client(app.base).login(`${name.toLowerCase()}@demo.local`, PASSWORD); }
async function manager(n) { return client(app.base).login(`manager${n}@demo.local`, PASSWORD); }
async function cashier(storeId, name, pin) { return client(app.base).pin(storeId, userId(name), pin); }
const onHand = (store, item) => db.prepare("SELECT COALESCE(SUM(qty),0) q FROM stock_movements WHERE store_id=? AND item_id=? AND bucket='stock'").get(store, item).q;
function itemWithStock(store, min = 3) {
  const rows = db.prepare("SELECT item_id, SUM(qty) q FROM stock_movements WHERE store_id=? AND bucket='stock' GROUP BY item_id HAVING q >= ? ORDER BY item_id").all(store, min);
  return rows[0].item_id;
}
const skuOf = (id) => db.prepare('SELECT sku FROM items WHERE id=?').get(id).sku;
const priceOf = (id) => db.prepare('SELECT d.price_cents p FROM items i JOIN designs d ON d.id=i.design_id WHERE i.id=?').get(id).p;

test('security: changes without the request header are refused', async () => {
  const c = client(app.base);
  const r = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  assert.equal((await c.get('/api/me')).status, 401);
});

test('roles: a cashier cannot reach owner, manager or money areas', async () => {
  const c = await cashier(S.AF, 'Sophea', '1101');
  for (const url of ['/api/admin/users', '/api/admin/audit', '/api/admin/stores', '/api/dashboard', '/api/shifts?store_id=1', '/api/stock/returned?store_id=1']) {
    assert.equal((await c.get(url)).status, 403, url);
  }
  assert.equal((await c.post('/api/stock/in', { store_id: 1, lines: [{ item_id: 1, qty: 1 }] })).status, 403);
  assert.equal((await c.post('/api/stock/adjust', { store_id: 1, item_id: 1, qty_delta: 1, reason: 'test' })).status, 403);
  assert.equal((await c.post('/api/designs', {})).status, 403);
});

test('roles: cashier data never contains cost price', async () => {
  const c = await cashier(S.AF, 'Sophea', '1101');
  const items = await c.get('/api/items?store_id=1&q=S01');
  assert.equal(items.status, 200);
  assert.ok(items.body.length > 0);
  assert.ok(!items.text.includes('cost_cents'));
  const lookup = await c.get('/api/stock/lookup?store_id=1&q=S01');
  assert.ok(!lookup.text.includes('cost'));
  const designs = await c.get('/api/designs');
  assert.ok(!designs.text.includes('cost_cents'));
  const m = await manager(1);
  assert.ok((await m.get('/api/items?store_id=1&q=S01')).text.includes('cost_cents'));
});

test('roles: staff only reach their own store', async () => {
  const c = await cashier(S.AF, 'Sophea', '1101');
  assert.equal((await c.get('/api/items?store_id=2&q=S01')).status, 403);
  assert.equal((await c.get('/api/sales?store_id=2')).status, 403);
  const m = await manager(1);
  assert.equal((await m.get('/api/stock?store_id=2')).status, 403);
  assert.equal((await m.get('/api/dashboard?store=2')).status, 403);
  const o = await owner();
  assert.equal((await o.get('/api/stock?store_id=2')).status, 200);
});

test('login: five wrong PINs lock the account for a while', async () => {
  const id = userId('Dara');
  const c = client(app.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/pin-login', { store_id: 1, user_id: id, pin: '0000' })).status, 401);
  const r = await c.post('/api/auth/pin-login', { store_id: 1, user_id: id, pin: '1102' });
  assert.equal(r.status, 429);
  db.prepare('UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?').run(id);
});

test('sale: shift needed, stock goes down, receipt numbers run in order', async () => {
  const c = await cashier(S.AF, 'Sophea', '1101');
  const item = itemWithStock(1, 4);
  const price = priceOf(item);
  const before = onHand(1, item);
  let r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price }] });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'SHIFT_REQUIRED');
  r = await c.post('/api/shifts/open', { store_id: 1, open_usd: 100, open_khr: 400000 });
  assert.equal(r.status, 200);
  r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.total_cents, price);
  const n1 = r.body.seq;
  assert.equal(onHand(1, item), before - 1);
  r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'khqr', currency: 'USD', amount: price }] });
  assert.equal(r.body.seq, n1 + 1);
  assert.match(r.body.receipt_no, /^AF-\d{6}$/);
});

test('sale: cannot sell more than is available, and wrong payments are refused', async () => {
  const c = await cashier(S.AF, 'Sophea', '1101');
  const item = itemWithStock(1, 1);
  const have = onHand(1, item);
  const price = priceOf(item);
  let r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: have + 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price * (have + 1) }] });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'OUT_OF_STOCK');
  assert.equal(onHand(1, item), have);
  r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price - 100 }] });
  assert.equal(r.body.error, 'PAYMENT_MISMATCH');
  r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price + 1000 }] });
  assert.equal(r.body.error, 'PAYMENT_MISMATCH', 'overpaying without change is refused');
});

test('money: riel payment, change in riel, and the cash count work together', async () => {
  const c = await cashier(S.AF, 'Sophea', '1101');
  const item = itemWithStock(1, 2);
  const price = priceOf(item); // cents
  const rate = 4000;
  const khr = Math.round((price * rate) / 100 / 100) * 100; // nearest 100 riel
  let r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'KHR', amount: khr }] });
  assert.equal(r.status, 200, r.text);
  // pay with a bigger KHR note and get riel change
  const pay = Math.ceil(khr / 100000) * 100000 + 100000;
  r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'KHR', amount: pay }], change: [{ currency: 'KHR', amount: pay - khr }] });
  assert.equal(r.status, 200, r.text);
  // USD paid, riel change
  r = await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price + 1000 }], change: [{ currency: 'KHR', amount: 40000 }] });
  assert.equal(r.status, 200, r.text);
});

test('discount: above the cashier limit needs a manager PIN', async () => {
  const c = await cashier(S.AF, 'Sophea', '1101');
  const item = itemWithStock(1, 2);
  const price = priceOf(item);
  const big = { type: 'percent', value: 30, reason: 'Wedding group' };
  const total = price - Math.round((price * 30) / 100);
  const body = { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], discount: big, payments: [{ method: 'cash', currency: 'USD', amount: total }] };
  let r = await c.post('/api/sales', body);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'APPROVAL_REQUIRED');
  r = await c.post('/api/sales', { ...body, manager_pin: '1234' });
  assert.equal(r.body.error, 'APPROVAL_REQUIRED');
  r = await c.post('/api/sales', { ...body, manager_pin: '8001' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.approved_by_name, 'Manager 1');
  assert.equal(r.body.discount_cents, price - total);
  // small discount needs no PIN, but needs a reason
  const small = { store_id: 1, lines: [{ item_id: item, qty: 1, entry: 'scan' }], discount: { type: 'percent', value: 5 }, payments: [{ method: 'cash', currency: 'USD', amount: price - Math.round(price * 0.05) }] };
  assert.equal((await c.post('/api/sales', small)).body.error, 'REASON_REQUIRED');
  small.discount.reason = 'Loyal customer';
  assert.equal((await c.post('/api/sales', small)).status, 200);
});

test('switch: require scan to sell blocks typed entry until a manager PIN is given', async () => {
  const o = await owner();
  await o.put('/api/admin/stores/1', { switches: { require_scan_to_sell: true } });
  const c = await cashier(S.AF, 'Sophea', '1101');
  const item = itemWithStock(1, 2);
  const price = priceOf(item);
  const mk = (entry, extra = {}) => ({ store_id: 1, lines: [{ item_id: item, qty: 1, entry }], payments: [{ method: 'cash', currency: 'USD', amount: price }], ...extra });
  let r = await c.post('/api/sales', mk('typed'));
  assert.equal(r.body.error, 'APPROVAL_REQUIRED');
  assert.equal((await c.post('/api/sales', mk('scan'))).status, 200);
  assert.equal((await c.post('/api/sales', mk('typed', { manager_pin: '8001' }))).status, 200);
  await o.put('/api/admin/stores/1', { switches: { require_scan_to_sell: false } });
  assert.equal((await c.post('/api/sales', mk('typed'))).status, 200);
});

test('void and return: stock comes back correctly and approvals are enforced', async () => {
  const c = await cashier(S.AF, 'Sophea', '1101');
  const item = itemWithStock(1, 3);
  const price = priceOf(item);
  const start = onHand(1, item);
  let sale = (await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 2, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price * 2 }] })).body;
  assert.equal(onHand(1, item), start - 2);
  let r = await c.post(`/api/sales/${sale.id}/void`, { reason: 'Wrong item' });
  assert.equal(r.body.error, 'APPROVAL_REQUIRED');
  r = await c.post(`/api/sales/${sale.id}/void`, { reason: 'Wrong item', manager_pin: '8001' });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'voided');
  assert.equal(onHand(1, item), start);
  // return
  sale = (await c.post('/api/sales', { store_id: 1, lines: [{ item_id: item, qty: 2, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price * 2 }] })).body;
  const line = sale.lines[0];
  r = await c.post(`/api/sales/${sale.id}/return`, { lines: [{ sale_line_id: line.id, qty: 1 }], reason: 'Does not fit' });
  assert.equal(r.body.error, 'APPROVAL_REQUIRED');
  r = await c.post(`/api/sales/${sale.id}/return`, { lines: [{ sale_line_id: line.id, qty: 1 }], reason: 'Does not fit', manager_pin: '8001' });
  assert.equal(r.status, 200, r.text);
  assert.equal(onHand(1, item), start - 2, 'returned piece waits for a check, so it is not sellable yet');
  r = await c.post(`/api/sales/${sale.id}/return`, { lines: [{ sale_line_id: line.id, qty: 2 }], reason: 'Too many', manager_pin: '8001' });
  assert.equal(r.body.error, 'TOO_MANY');
  const m = await manager(1);
  assert.equal((await m.post('/api/stock/returned/resolve', { store_id: 1, item_id: item, qty: 1, to: 'stock' })).status, 200);
  assert.equal(onHand(1, item), start - 1);
});

test('shift: counted cash is compared with what the system expects', async () => {
  const c = await cashier(S.BW, 'Srey Neang', '1201');
  const sh = (await c.post('/api/shifts/open', { store_id: 2, open_usd: 50, open_khr: 100000 })).body;
  const item = itemWithStock(2, 2);
  const price = priceOf(item);
  await c.post('/api/sales', { store_id: 2, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: price }] });
  await c.post('/api/sales', { store_id: 2, lines: [{ item_id: item, qty: 1, entry: 'scan' }], payments: [{ method: 'khqr', currency: 'USD', amount: price }] });
  const cur = (await c.get('/api/shifts/current?store_id=2')).body;
  assert.ok(!('expected_usd_cents' in cur), 'cashier does not see the expected amount before counting');
  const r = await c.post('/api/shifts/close', { shift_id: sh.id, counted_usd: (5000 + price) / 100 - 1, counted_khr: 100000 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.expected_usd_cents, 5000 + price);
  assert.equal(r.body.diff_usd_cents, -100);
  assert.equal(r.body.diff_khr, 0);
});

test('transfers: request, approval rules, reservation, send, receive, difference', async () => {
  const item = itemWithStock(1, 6);
  const req = await cashier(S.S5, 'Kunthea', '1501');
  let r = await req.post('/api/transfers', { from_store_id: 1, to_store_id: 5, reason: 'Customer waiting', lines: [{ item_id: item, qty: 3 }] });
  assert.equal(r.status, 200, r.text);
  const id = r.body.id;
  // a cashier cannot approve; the receiving store's manager cannot approve; the requester cannot approve their own
  assert.equal((await req.post(`/api/transfers/${id}/approve`)).status, 403);
  const recvMgr = await manager(5);
  assert.equal((await recvMgr.post(`/api/transfers/${id}/approve`)).status, 403);
  const sendMgr = await manager(1);
  // a manager's own request cannot be approved by that same manager
  const own = (await sendMgr.post('/api/transfers', { from_store_id: 1, to_store_id: 2, lines: [{ item_id: item, qty: 1 }] })).body;
  assert.equal((await sendMgr.post(`/api/transfers/${own.id}/approve`)).status, 403);
  assert.equal((await (await owner()).post(`/api/transfers/${own.id}/approve`)).status, 200, 'an owner can approve a manager request');
  // approve reserves stock
  const before = (await sendMgr.get(`/api/stock?store_id=1&q=${skuOf(item)}`)).body.find((x) => x.id === item);
  r = await sendMgr.post(`/api/transfers/${id}/approve`);
  assert.equal(r.status, 200, r.text); assert.equal(r.body.status, 'approved');
  const after = (await sendMgr.get(`/api/stock?store_id=1&q=${skuOf(item)}`)).body.find((x) => x.id === item);
  assert.equal(after.available, before.available - 3);
  assert.equal(after.on_hand, before.on_hand);
  // only the sending store sends, only the receiving store receives
  assert.equal((await recvMgr.post(`/api/transfers/${id}/send`)).status, 403);
  r = await sendMgr.post(`/api/transfers/${id}/send`, {});
  assert.equal(r.body.status, 'in_transit');
  assert.equal(onHand(1, item), before.on_hand - 3);
  assert.equal((await sendMgr.post(`/api/transfers/${id}/receive`, {})).status, 403);
  const line = r.body.lines[0];
  const dest = onHand(5, item);
  r = await recvMgr.post(`/api/transfers/${id}/receive`, { lines: [{ line_id: line.id, qty_received: 2 }] });
  assert.equal(r.body.status, 'discrepancy');
  assert.equal(onHand(5, item), dest + 2);
  assert.equal((await recvMgr.post(`/api/transfers/${id}/resolve`, { resolution: 'lost', note: 'Not in box' })).status, 403);
  const o = await owner();
  r = await o.post(`/api/transfers/${id}/resolve`, { resolution: 'found', note: 'Found in the back room' });
  assert.equal(r.body.status, 'resolved');
  assert.equal(onHand(5, item), dest + 3);
  // reserved pieces cannot be sold
  const item2 = itemWithStock(1, 3);
  const have = onHand(1, item2);
  const t2 = (await req.post('/api/transfers', { from_store_id: 1, to_store_id: 5, lines: [{ item_id: item2, qty: have }] })).body;
  assert.equal((await sendMgr.post(`/api/transfers/${t2.id}/approve`)).status, 200);
  const cash = await cashier(S.AF, 'Sophea', '1101');
  const s = await cash.post('/api/sales', { store_id: 1, lines: [{ item_id: item2, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: priceOf(item2) }] });
  assert.equal(s.body.error, 'OUT_OF_STOCK');
  assert.equal((await sendMgr.post(`/api/transfers/${t2.id}/cancel`)).status, 200);
  assert.equal((await cash.post('/api/sales', { store_id: 1, lines: [{ item_id: item2, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: priceOf(item2) }] })).status, 200);
});

test('look-up: cashiers see other stores only when the switches allow it', async () => {
  const item = itemWithStock(2, 3);
  const q = skuOf(item);
  const c = await cashier(S.AF, 'Sophea', '1101');
  let r = (await c.get(`/api/stock/lookup?store_id=1&q=${q.replace('BO', 'AF')}`)).body;
  assert.equal(r.stores.length, 5);
  assert.equal(r.stores[0].id, 1, 'own store listed first');
  const o = await owner();
  await o.put('/api/admin/stores/1', { switches: { show_exact_other_qty: false } });
  r = (await c.get(`/api/stock/lookup?store_id=1&q=S01`)).body;
  const other = r.items[0].stores.find((s) => s.store_id !== 1);
  assert.ok(!('qty' in other)); assert.ok(['in', 'low', 'out'].includes(other.level));
  assert.ok('qty' in r.items[0].stores.find((s) => s.store_id === 1));
  await o.put('/api/admin/stores/1', { switches: { show_exact_other_qty: true, cashier_see_other_stock: false } });
  r = (await c.get(`/api/stock/lookup?store_id=1&q=S01`)).body;
  assert.equal(r.stores.length, 1);
  await o.put('/api/admin/stores/1', { switches: { cashier_see_other_stock: true } });
  const m = await manager(1);
  assert.equal((await m.get(`/api/stock/lookup?store_id=1&q=S01`)).body.stores.length, 5);
});

test('stock ledger: every store and item balance equals the sum of its movements and is never negative', async () => {
  const bad = db.prepare("SELECT store_id, item_id, SUM(qty) q FROM stock_movements WHERE bucket='stock' GROUP BY store_id, item_id HAVING q < 0").all();
  assert.equal(bad.length, 0);
});

test('dashboard: stores add up to All stores, and one store shows only that store', async () => {
  const o = await owner();
  const all = (await o.get('/api/dashboard?store=all&period=year')).body;
  const sum = all.by_store.reduce((a, s) => a + s.sales_cents, 0);
  assert.equal(all.cards.sales_cents, sum);
  assert.equal(all.scope.stores.length, 5);
  for (const s of all.by_store) {
    const one = (await o.get(`/api/dashboard?store=${s.store_id}&period=year`)).body;
    assert.equal(one.cards.sales_cents, s.sales_cents);
    assert.equal(one.scope.stores.length, 1);
    assert.deepEqual(one.by_store.map((x) => x.store_id), [s.store_id]);
    assert.ok(one.alerts.every((a) => a.store_id === undefined || a.store_id === s.store_id), 'alerts belong to the selected store');
    const real = db.prepare("SELECT COALESCE(SUM(total_cents),0) t FROM sales WHERE status='completed' AND store_id=? AND ts >= ? AND ts < ?").get(s.store_id, Date.parse(`${all.period.from}T00:00:00+07:00`), Date.parse(`${all.period.to}T00:00:00+07:00`) + 86400000).t;
    const rets = db.prepare('SELECT COALESCE(SUM(refund_cents),0) r FROM returns WHERE store_id=?').get(s.store_id).r;
    assert.equal(s.sales_cents, real - rets);
  }
  const m = await manager(2);
  const md = (await m.get('/api/dashboard?store=all&period=year')).body;
  assert.deepEqual(md.scope.stores.map((s) => s.id), [2], 'a manager always sees only their own store');
  const c = await cashier(S.AF, 'Sophea', '1101');
  assert.equal((await c.get('/api/dashboard')).status, 403);
});

test('audit: important actions are written to the log', async () => {
  const o = await owner();
  const a = (await o.get('/api/admin/audit?limit=300')).body;
  const actions = new Set(a.map((x) => x.action));
  for (const need of ['sale.create', 'sale.void', 'sale.return', 'shift.open', 'shift.close', 'transfer.approve', 'transfer.send', 'transfer.receive', 'transfer.resolve', 'store.update', 'login']) {
    assert.ok(actions.has(need), `missing ${need}`);
  }
});

test('users: owners are protected, PINs are unique within a store, and the last owner stays', async () => {
  const o = await owner();
  const users = (await o.get('/api/admin/users')).body.users;
  const me = (await o.get('/api/me')).body.id;
  const owners = users.filter((u) => u.role === 'owner');
  owners.sort((a, b) => (b.id === me) - (a.id === me));
  for (const u of owners.slice(1)) assert.equal((await o.put(`/api/admin/users/${u.id}`, { active: false })).status, 200);
  assert.equal((await o.put(`/api/admin/users/${owners[0].id}`, { active: false })).body.error, 'LAST_OWNER');
  const r = await o.post('/api/admin/users', { name: 'Test', role: 'cashier', store_ids: [1], pin: '1102' });
  assert.equal(r.body.error, 'PIN_TAKEN');
  const m = await manager(1);
  assert.equal((await m.post('/api/admin/users', { name: 'X', role: 'cashier', store_ids: [1], pin: '5555' })).status, 403);
});
