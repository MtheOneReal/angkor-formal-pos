// Logic tests for the Firebase version, run against an in-memory fake Firestore.
// Run: node --test fb/tests/backend.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../../web/src/fb/backend.js';
import { createApi } from '../../web/src/fb/routes.js';
import { createFake, createFakeAuth } from './fakefs.js';

function boot() {
  const F = createFake(); const A = createFakeAuth();
  let t = Date.parse('2026-10-21T03:00:00Z');
  const secondary = { ...A.secondary, signInAs: async (e, p) => { const r = await A.secondary.signInAs(e, p); return { ...r, db: F.db }; } };
  const B = createBackend({ fs: F.fs, db: F.db, auth: A.auth, secondary, now: () => (t += 1000) });
  const api = createApi(B);
  return { F, A, B, api };
}
const fails = async (p, code) => { try { await p; } catch (e) { assert.equal(e.code, code, `${e.code}: ${e.message}`); return; } assert.fail(`expected ${code}`); };

async function setup() {
  const s = boot();
  const { api, A } = s;
  assert.deepEqual(await api.get('/setup/status'), { needed: true });
  await api.post('/setup/create', { name: 'Vibol', email: 'vibol@x.com', password: 'Strong-pass-1' });
  assert.deepEqual(await api.get('/setup/status'), { needed: false });
  await fails(api.post('/setup/create', { name: 'Eve', email: 'e@x.com', password: 'Strong-pass-1' }), 'ALREADY_SETUP');
  // staff
  const mgr = await api.post('/admin/users', { name: 'Mgr', role: 'manager', email: 'mgr@x.com', password: 'Mgr-pass-123', store_ids: [1] });
  const cas = await api.post('/admin/users', { name: 'Cashier', role: 'cashier', pin: '123456', store_ids: [1] });
  // catalogue
  const d = await api.post('/designs', { brand_id: 1, type_code: 'S', name_en: 'Navy suit', price_usd: 200, cost_usd: 90, colours: ['NVY'], sizes: ['48', '50'] });
  assert.equal(d.skus.length, 2);
  return { ...s, mgr, cas, d };
}

test('first owner setup seeds stores and blocks a second setup', async () => {
  const { api } = await setup();
  const stores = await api.get('/public/stores');
  assert.equal(stores.length, 4);
  const me = await api.get('/me');
  assert.equal(me.role, 'owner'); assert.equal(me.stores.length, 4);
});

test('stock in, lookup and a cashier sale reduce stock and number the receipt', async () => {
  const { api, A, d } = await setup();
  const sku = d.skus[0];
  const item = await api.get(`/items/code/${sku}?store_id=1`);
  await api.post('/stock/in', { store_id: 1, lines: [{ item_id: item.id, qty: 5 }], reference: 'delivery' });
  assert.equal((await api.get(`/items/code/${sku}?store_id=1`)).on_hand, 5);
  // cashier signs in with PIN
  const staff = await api.get('/public/stores/1/staff');
  await api.post('/auth/logout');
  const who = staff.find((x) => x.name === 'Cashier');
  await api.post('/auth/pin-login', { store_id: 1, user_id: who.id, pin: '123456' });
  await fails(api.post('/auth/pin-login', { store_id: 1, user_id: who.id, pin: '000000' }), 'BAD_LOGIN');
  assert.equal((await api.get('/me')).role, 'cashier');
  await fails(api.post('/sales', { store_id: 1, lines: [{ item_id: item.id, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: 20000 }] }), 'SHIFT_REQUIRED');
  await api.post('/shifts/open', { store_id: 1, open_usd: 50, open_khr: 0 });
  const sale = await api.post('/sales', { store_id: 1, lines: [{ item_id: item.id, qty: 2, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: 40000 }] });
  assert.equal(sale.receipt_no, 'AF-000001'); assert.equal(sale.total_cents, 40000);
  assert.equal((await api.get(`/items/code/${sku}?store_id=1`)).on_hand, 3);
  await fails(api.post('/sales', { store_id: 1, lines: [{ item_id: item.id, qty: 9, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: 180000 }] }), 'OUT_OF_STOCK');
  await fails(api.post('/sales', { store_id: 1, lines: [{ item_id: item.id, qty: 1, entry: 'scan' }], payments: [{ method: 'cash', currency: 'USD', amount: 100 }] }), 'PAYMENT_MISMATCH');
  // cashiers cannot see cost
  const row = await api.get(`/items/code/${sku}?store_id=1`);
  assert.equal('cost_cents' in row, false);
  await fails(api.get('/admin/users'), 'FORBIDDEN');
});

test('big discount needs a manager sign-in; self-approval and wrong password fail', async () => {
  const { api, d } = await setup();
  const item = await api.get(`/items/code/${d.skus[0]}?store_id=1`);
  await api.post('/stock/in', { store_id: 1, lines: [{ item_id: item.id, qty: 5 }] });
  const staff = await api.get('/public/stores/1/staff'); await api.post('/auth/logout');
  await api.post('/auth/pin-login', { store_id: 1, user_id: staff.find((x) => x.name === 'Cashier').id, pin: '123456' });
  await api.post('/shifts/open', { store_id: 1, open_usd: 0, open_khr: 0 });
  const body = (pin) => ({ store_id: 1, lines: [{ item_id: item.id, qty: 1, entry: 'scan' }], discount: { type: 'percent', value: 30, reason: 'VIP' }, payments: [{ method: 'cash', currency: 'USD', amount: 14000 }], ...(pin ? { manager_pin: pin } : {}) });
  await fails(api.post('/sales', body()), 'APPROVAL_REQUIRED');
  await fails(api.post('/sales', body('mgr@x.com\nwrong')), 'BAD_LOGIN');
  const sale = await api.post('/sales', body('mgr@x.com\nMgr-pass-123'));
  assert.equal(sale.total_cents, 14000); assert.equal(sale.approved_by_name, 'Mgr');
});

test('transfer: request, approve reserves, send, receive moves stock; own request cannot be approved', async () => {
  const { api, d } = await setup();
  const item = await api.get(`/items/code/${d.skus[0]}?store_id=1`);
  await api.post('/stock/in', { store_id: 1, lines: [{ item_id: item.id, qty: 4 }] });
  const tr = await api.post('/transfers', { from_store_id: 1, to_store_id: 2, lines: [{ item_id: item.id, qty: 3 }], reason: 'customer' });
  await fails(api.post(`/transfers/${tr.id}/approve`), 'FORBIDDEN'); // owner requested it themselves
  // manager of store 1 approves
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'mgr@x.com', password: 'Mgr-pass-123' });
  const ap = await api.post(`/transfers/${tr.id}/approve`); assert.equal(ap.status, 'approved');
  let l = (await api.get(`/stock?store_id=1&q=${d.skus[0]}`))[0]; assert.equal(l.reserved, 3); assert.equal(l.on_hand, 4);
  const sent = await api.post(`/transfers/${tr.id}/send`, {}); assert.equal(sent.status, 'in_transit');
  l = (await api.get(`/stock?store_id=1&q=${d.skus[0]}`))[0]; assert.equal(l.on_hand, 1); assert.equal(l.reserved, 0);
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'vibol@x.com', password: 'Strong-pass-1' });
  const rec = await api.post(`/transfers/${tr.id}/receive`, { lines: [{ line_id: sent.lines[0].id, qty_received: 2 }] });
  assert.equal(rec.status, 'discrepancy');
  const at2 = (await api.get(`/stock?store_id=2&q=${d.skus[0]}`))[0]; assert.equal(at2.on_hand, 2);
  const res = await api.post(`/transfers/${tr.id}/resolve`, { resolution: 'found', note: 'was in the box' });
  assert.equal(res.status, 'resolved');
  assert.equal((await api.get(`/stock?store_id=2&q=${d.skus[0]}`))[0].on_hand, 3);
});

test('void restores stock and dashboard totals follow sales', async () => {
  const { api, d } = await setup();
  const item = await api.get(`/items/code/${d.skus[0]}?store_id=1`);
  await api.post('/stock/in', { store_id: 1, lines: [{ item_id: item.id, qty: 5 }] });
  await api.post('/shifts/open', { store_id: 1, open_usd: 0, open_khr: 0 });
  const sale = await api.post('/sales', { store_id: 1, lines: [{ item_id: item.id, qty: 2, entry: 'search' }], payments: [{ method: 'khqr', currency: 'USD', amount: 40000 }] });
  let dash = await api.get('/dashboard?store=1&period=today');
  assert.equal(dash.cards.sales_cents, 40000); assert.equal(dash.cards.orders, 1); assert.equal(dash.cards.gross_profit_cents, 22000);
  await fails(api.post(`/sales/${sale.id}/void`, { reason: 'x' }), 'BAD_INPUT'.length ? 'REASON_REQUIRED' : '');
  const v = await api.post(`/sales/${sale.id}/void`, { reason: 'customer left' });
  assert.equal(v.status, 'voided');
  assert.equal((await api.get(`/items/code/${d.skus[0]}?store_id=1`)).on_hand, 5);
  dash = await api.get('/dashboard?store=1&period=today'); assert.equal(dash.cards.sales_cents, 0);
});

test('cashier cannot reach another store or stock-in', async () => {
  const { api, d } = await setup();
  const staff = await api.get('/public/stores/1/staff'); await api.post('/auth/logout');
  await api.post('/auth/pin-login', { store_id: 1, user_id: staff.find((x) => x.name === 'Cashier').id, pin: '123456' });
  await fails(api.get('/stock?store_id=2'), 'FORBIDDEN');
  await fails(api.post('/stock/in', { store_id: 1, lines: [{ item_id: 1, qty: 1 }] }), 'FORBIDDEN');
  await fails(api.get('/admin/audit'), 'FORBIDDEN');
});

test('a person with no history can be deleted; one with sales cannot', async () => {
  const { api, d, cas } = await setup();
  const extra = await api.post('/admin/users', { name: 'Oops', role: 'cashier', pin: '654321', store_ids: [1] });
  await api.post(`/admin/users/${extra.id}/delete`);
  const list = await api.get('/admin/users');
  assert.equal(list.users.some((u) => u.id === extra.id), false);
  const item = await api.get(`/items/code/${d.skus[0]}?store_id=1`);
  await api.post('/stock/in', { store_id: 1, lines: [{ item_id: item.id, qty: 3 }] });
  const staff = await api.get('/public/stores/1/staff'); await api.post('/auth/logout');
  await api.post('/auth/pin-login', { store_id: 1, user_id: staff.find((x) => x.name === 'Cashier').id, pin: '123456' });
  await api.post('/shifts/open', { store_id: 1, open_usd: 0, open_khr: 0 });
  await api.post('/sales', { store_id: 1, lines: [{ item_id: item.id, qty: 1, entry: 'search' }], payments: [{ method: 'cash', currency: 'USD', amount: 20000 }] });
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'vibol@x.com', password: 'Strong-pass-1' });
  await fails(api.post(`/admin/users/${cas.id}/delete`), 'HAS_HISTORY');
});

test('expenses: add, list, categories, delete; cashier cannot', async () => {
  const { api } = await setup();
  const cats = await api.get('/expense-categories'); assert.ok(cats.some((c) => c.name === 'Electricity'));
  await api.post('/expense-categories', { name: 'Cleaning' });
  assert.ok((await api.get('/expense-categories')).some((c) => c.name === 'Cleaning'));
  const e1 = await api.post('/expenses', { store_id: 1, date: '2026-10-21', category: 'Rent', amount: 500, currency: 'USD', note: 'Oct', photo: 'data:image/jpeg;base64,AAAA' });
  await api.post('/expenses', { store_id: 1, date: '2026-10-21', category: 'Electricity', amount: 400000, currency: 'KHR', photo: 'data:image/jpeg;base64,AAAA' });
  let r = await api.get('/expenses?store_id=1&month=2026-10');
  assert.equal(r.total_cents, 50000 + 10000); assert.equal(r.rows.length, 2);
  await api.post(`/expenses/${e1.id}/delete`);
  assert.equal((await api.get('/expenses?store_id=1&month=2026-10')).total_cents, 10000);
  await api.post('/expense-categories/cleaning/delete');
  await fails(api.post('/expense-categories/salary/delete'), 'PROTECTED');
  // manager may add for own store only
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'mgr@x.com', password: 'Mgr-pass-123' });
  await api.post('/expenses', { store_id: 1, date: '2026-10-21', category: 'Water', amount: 10, currency: 'USD' });
  await fails(api.post('/expenses', { store_id: 2, date: '2026-10-21', category: 'Water', amount: 10, currency: 'USD' }), 'FORBIDDEN');
  await fails(api.post('/expense-categories', { name: 'X1' }), 'FORBIDDEN');
  await api.post('/auth/logout');
  const staff = await api.get('/public/stores/1/staff');
  await api.post('/auth/pin-login', { store_id: 1, user_id: staff.find((x) => x.name === 'Cashier').id, pin: '123456' });
  await fails(api.get('/expenses?store_id=1'), 'FORBIDDEN');
});

test('attendance and payroll: late clock-in costs $5 a day unless excused; payroll recorded as expense; net profit', async () => {
  const { api, cas, mgr } = await setup();
  await api.put(`/admin/users/${cas.id}`, { salary_usd: 300 });
  await api.put(`/admin/users/${mgr.id}`, { salary_usd: 600 });
  const staff = await api.get('/public/stores/1/staff'); await api.post('/auth/logout');
  await api.post('/auth/pin-login', { store_id: 1, user_id: staff.find((x) => x.name === 'Cashier').id, pin: '123456' });
  const me0 = await api.get('/attendance/me?store_id=1'); assert.equal(me0.record, null);
  const inn = await api.post('/attendance/clock-in', { store_id: 1 }); assert.equal(inn.record.late, true); // test clock is 10:00 local, work starts 09:00
  await fails(api.post('/attendance/clock-in', { store_id: 1 }), 'ALREADY_IN');
  await api.post('/attendance/clock-out', { store_id: 1 });
  await fails(api.get('/attendance?store_id=1'), 'FORBIDDEN');
  await fails(api.get('/payroll'), 'FORBIDDEN');
  // manager sees it and can excuse others but not self
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'mgr@x.com', password: 'Mgr-pass-123' });
  const list = await api.get('/attendance?store_id=1&month=2026-10');
  assert.equal(list.rows.length, 1); assert.equal(list.summary[0].late_days, 1);
  await api.post('/attendance/clock-in', { store_id: 1 });
  const mine = list.rows[0];
  await fails(api.post('/attendance/manual', { store_id: 1, user_id: mgr.id, date: '2026-10-20', in_time: '08:00' }), 'FORBIDDEN');
  await api.post('/attendance/manual', { store_id: 1, user_id: mine.user_id, date: '2026-10-20', in_time: '08:55', out_time: '18:00' });
  // owner payroll
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'vibol@x.com', password: 'Strong-pass-1' });
  let p = await api.get('/payroll?month=2026-10');
  let c = p.rows.find((r) => r.name === 'Cashier');
  assert.equal(c.base_cents, 30000); assert.equal(c.late_days, 1); assert.equal(c.deduction_cents, 500); assert.equal(c.net_cents, 29500);
  const m = p.rows.find((r) => r.name === 'Mgr'); assert.equal(m.late_days, 1);
  await api.post(`/attendance/${mine.id}/excuse`, { excused: true });
  p = await api.get('/payroll?month=2026-10'); c = p.rows.find((r) => r.name === 'Cashier'); assert.equal(c.late_days, 0); assert.equal(c.net_cents, 30000); assert.equal(c.excused_days, 1);
  await api.post('/payroll/settings', { late_deduction_usd: 10 });
  assert.equal((await api.get('/payroll?month=2026-10')).late_deduction_cents, 1000);
  const rec = await api.post('/payroll/record', { month: '2026-10' }); assert.equal(rec.recorded, 2);
  await fails(api.post('/payroll/record', { month: '2026-10' }), 'NOTHING_TO_RECORD');
  const ex = await api.get('/expenses?store_id=1&month=2026-10'); assert.ok(ex.total_cents >= 30000);
});

test('deleting a store, product or customer works only when there is no history', async () => {
  const { api, d } = await setup();
  // a second design with no stock can be deleted; the first, once stocked, cannot
  const d2 = await api.post('/designs', { brand_id: 1, type_code: 'T', name_en: 'Oops trousers', price_usd: 50, cost_usd: 20, colours: ['BLK'], sizes: ['32'] });
  const before = (await api.get('/designs')).length;
  const id2 = (await api.get('/designs')).find((x) => x.name_en === 'Oops trousers').id;
  await api.post(`/designs/${id2}/delete`);
  assert.equal((await api.get('/designs')).length, before - 1);
  assert.equal(d2.skus.length, 1);
  const id1 = (await api.get('/designs')).find((x) => x.name_en === 'Navy suit').id;
  const item = await api.get(`/items/code/${d.skus[0]}?store_id=1`);
  await api.post('/stock/in', { store_id: 1, lines: [{ item_id: item.id, qty: 2 }] });
  await fails(api.post(`/designs/${id1}/delete`), 'HAS_HISTORY');
  // customers
  const c = await api.post('/customers', { name: 'Test Customer', phone: '012' });
  await api.post(`/customers/${c.id}/delete`);
  assert.equal((await api.get('/customers')).some((x) => x.id === c.id), false);
  // stores: store 4 is empty and has no staff -> deletable; store 1 has stock and a staff -> blocked
  await api.post('/admin/stores/4/delete');
  assert.equal((await api.get('/public/stores')).some((s) => s.id === 4), true === false);
  await fails(api.post('/admin/stores/1/delete'), 'HAS_HISTORY');
});

test('expense receipt photo is required above the limit and can be viewed', async () => {
  const { api } = await setup();
  const photo = 'data:image/jpeg;base64,AAAA';
  await api.post('/expenses', { store_id: 1, date: '2026-10-21', category: 'Water', amount: 10, currency: 'USD' }); // under $50
  await fails(api.post('/expenses', { store_id: 1, date: '2026-10-21', category: 'Rent', amount: 500, currency: 'USD' }), 'PHOTO_REQUIRED');
  const e = await api.post('/expenses', { store_id: 1, date: '2026-10-21', category: 'Rent', amount: 500, currency: 'USD', photo });
  assert.equal((await api.get(`/expenses/${e.id}/photo`)).photo, photo);
  assert.equal((await api.get('/expenses?store_id=1&month=2026-10')).rows.find((r) => r.id === e.id).has_photo, true);
  await api.post('/expense-settings', { photo_required_usd: 1000 });
  await api.post('/expenses', { store_id: 1, date: '2026-10-21', category: 'Rent', amount: 500, currency: 'USD' });
  await api.post(`/expenses/${e.id}/delete`);
  await fails(api.get(`/expenses/${e.id}/photo`), 'NOT_FOUND');
});
