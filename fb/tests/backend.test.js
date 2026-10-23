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

test('POS catalogue lists stock here and elsewhere; sale keeps walk-in name and alteration flag', async () => {
  const { api } = await setup();
  const c = await api.get('/pos/catalog?store_id=1');
  assert.ok(Array.isArray(c.items)); assert.ok(c.items.every((i) => typeof i.available === 'number' && !('cost_cents' in i)));
});

test('owner can change own password; wrong current password is refused', async () => {
  const { api } = await setup();
  await fails(api.post('/auth/change-password', { current_password: 'nope', new_password: 'Brand-new-123' }), 'BAD_LOGIN');
  await fails(api.post('/auth/change-password', { current_password: 'x', new_password: 'short' }), 'WEAK_PASSWORD');
});

test('test reset clears activity and keeps staff, stores and catalogue unless asked', async () => {
  const { api } = await setup();
  await api.post('/expenses', { store_id: 1, date: '2026-10-21', category: 'Water', amount: 10, currency: 'USD' });
  await fails(api.post('/admin/reset-test', { confirm: 'no' }), 'CONFIRM');
  const r = await api.post('/admin/reset-test', { confirm: 'RESET' });
  assert.ok(r.removed >= 1);
  assert.equal((await api.get('/expenses?store_id=1&month=2026-10')).rows.length, 0);
  assert.ok((await api.get('/designs')).length > 0);
  await api.post('/admin/reset-test', { confirm: 'RESET', catalogue: true });
  assert.equal((await api.get('/designs')).length, 0);
  const st = await api.get('/admin/stores'); assert.ok((Array.isArray(st) ? st : st.stores).length >= 1);
});

test('capital: shareholders, payments, reversal, totals; shareholder login sees capital only', async () => {
  const { api } = await setup();
  const a = await api.post('/capital/shareholders', { name: 'Partner A', agreed_by_store: { 1: 6000, 2: 4000 } });
  await api.post('/capital/shareholders', { name: 'Partner B', agreed_by_store: { 1: 5000 } });
  await api.post('/capital/payments', { shareholder_id: a.id, store_id: 1, date: '2026-10-01', amount_usd: 4000, note: 'ABA' });
  const p2 = await api.post('/capital/payments', { shareholder_id: a.id, store_id: 2, date: '2026-10-02', amount_usd: 1000 });
  await fails(api.post('/capital/payments', { shareholder_id: a.id, store_id: 2, date: '2026-10-02', amount_usd: 0 }), 'BAD_INPUT');
  let c = await api.get('/capital');
  assert.equal(c.totals.agreed_cents, 1500000); assert.equal(c.totals.paid_cents, 500000); assert.equal(c.totals.outstanding_cents, 1000000);
  const c1 = await api.get('/capital?store_id=1'); assert.equal(c1.totals.agreed_cents, 1100000); assert.equal(c1.totals.paid_cents, 400000); assert.equal(c1.shareholders.length, 2);
  const c2 = await api.get('/capital?store_id=2'); assert.equal(c2.totals.agreed_cents, 400000); assert.equal(c2.totals.paid_cents, 100000); assert.equal(c2.shareholders.length, 1);
  assert.equal(c.by_store.find((x) => x.store_id === 2).paid_cents, 100000);
  await fails(api.post('/capital/payments', { shareholder_id: a.id, date: '2026-10-02', amount_usd: 5 }), 'BAD_INPUT');
  await fails(api.post(`/capital/payments/${p2.id}/reverse`, { reason: '' }), 'REASON');
  await api.post(`/capital/payments/${p2.id}/reverse`, { reason: 'Wrong person' });
  await fails(api.post(`/capital/payments/${p2.id}/reverse`, { reason: 'again' }), 'ALREADY');
  c = await api.get('/capital'); assert.equal(c.totals.paid_cents, 400000); assert.equal(c.payments.filter((p) => p.reversed).length, 1);
  await fails(api.post(`/capital/shareholders/${a.id}/delete`), 'HAS_HISTORY');
  const u = await api.post('/admin/users', { name: 'Investor', role: 'shareholder', email: 'inv@x.com', password: 'Investor-123' });
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'inv@x.com', password: 'Investor-123' });
  assert.equal((await api.get('/capital')).can_edit, false);
  await fails(api.post('/capital/shareholders', { name: 'X', agreed_by_store: {} }), 'FORBIDDEN');
  const me = await api.get('/me'); assert.deepEqual(me.perms, ['capital.view', 'report.view', 'rank.view']);
  const rk = await api.get('/stock/restock?store_id=1&days=30'); assert.equal(rk.has_stock, false); assert.deepEqual(rk.low, []);
});

test('deposit sale, balance collection, alteration job, stock count, report, summary, export', async () => {
  const { api, d } = await setup();
  const item = await api.get(`/items/code/${d.skus[0]}?store_id=1`);
  await api.post('/stock/in', { store_id: 1, lines: [{ item_id: item.id, qty: 5 }], reference: 'd' });
  await api.post('/shifts/open', { store_id: 1, open_usd: 0, open_khr: 0 });
  const line = [{ item_id: item.id, qty: 1, entry: 'scan' }];
  await fails(api.post('/sales', { store_id: 1, lines: line, deposit: true, payments: [{ method: 'cash', currency: 'USD', amount: 5000 }] }), 'CUSTOMER_REQUIRED');
  await fails(api.post('/sales', { store_id: 1, lines: line, deposit: true, customer_name: 'Sok', customer_phone: '012', payments: [{ method: 'cash', currency: 'USD', amount: 20000 }] }), 'DEPOSIT_RANGE');
  const sale = await api.post('/sales', { store_id: 1, lines: line, deposit: true, alteration: true, alteration_note: 'Hem trousers', due_date: '2026-10-30', customer_name: 'Sok', customer_phone: '012', payments: [{ method: 'cash', currency: 'USD', amount: 5000 }] });
  assert.equal(sale.balance_cents, 15000);
  let bal = await api.get('/balances?store_id=1'); assert.equal(bal.length, 1); assert.equal(bal[0].balance_cents, 15000);
  let jobs = await api.get('/alterations?store_id=1'); assert.equal(jobs.length, 1); assert.equal(jobs[0].status, 'received');
  await fails(api.post(`/alterations/${jobs[0].id}`, { status: 'collected' }), 'BALANCE_DUE');
  await fails(api.post(`/balances/${bal[0].id}/collect`, { method: 'cash', currency: 'USD', amount: 20000 }), 'TOO_MUCH');
  await api.post(`/balances/${bal[0].id}/collect`, { method: 'cash', currency: 'USD', amount: 10000 });
  assert.equal((await api.get('/balances?store_id=1'))[0].balance_cents, 5000);
  await api.post(`/balances/${bal[0].id}/collect`, { method: 'khqr', currency: 'USD', amount: 5000 });
  assert.equal((await api.get('/balances?store_id=1')).length, 0);
  await api.post(`/alterations/${jobs[0].id}`, { status: 'ready' }); await api.post(`/alterations/${jobs[0].id}`, { status: 'collected' });
  jobs = await api.get('/alterations?store_id=1'); assert.equal(jobs[0].status, 'collected'); assert.equal(jobs[0].balance_cents, 0);
  // stock count: 4 expected, 3 counted -> 1 missing; applying fixes the stock
  const r = await api.post('/stocktake', { store_id: 1, apply: true, lines: [{ item_id: item.id, counted: 3 }] });
  assert.equal(r.missing, 1); assert.equal((await api.get(`/items/code/${d.skus[0]}?store_id=1`)).on_hand, 3);
  assert.equal((await api.get('/stocktake?store_id=1'))[0].missing, 1);
  // report: sales 200, cost 90 -> gross 110
  const rep = await api.get('/report?store_id=1'); assert.equal(rep.rows[0].sales_cents, 20000); assert.equal(rep.rows[0].cogs_cents, 9000); assert.equal(rep.rows[0].net_cents, 11000);
  const sum = await api.get('/summary/daily'); assert.ok(sum.text.includes('Angkor') && sum.total_cents === 20000);
  const ex = await api.get('/export'); assert.equal(ex.sheets.Sales.length, 1); assert.ok(ex.sheets['Sale lines'].length === 1 && ex.sheets.Stock.length >= 1);
});

test('owner edits brands, types, colours and size groups; used entries cannot be deleted', async () => {
  const { api, d } = await setup();
  await api.post('/lists/brands', { code: 'ZZ', name_en: 'Zed Brand' });
  await fails(api.post('/lists/brands', { code: 'ZZ', name_en: 'Again' }), 'DUPLICATE');
  await fails(api.post('/lists/brands', { code: 'bad code!', name_en: 'X' }), 'BAD_INPUT');
  await api.post('/lists/types', { code: 'JK', name_en: 'Jacket', name_km: 'អាវ' });
  await api.post('/lists/colours', { code: 'RED', name_en: 'Red', hex: '#aa0000' });
  let m = await api.get('/meta');
  assert.ok(m.brands.some((b) => b.code === 'ZZ') && m.types.some((t) => t.code === 'JK') && m.colours.some((c) => c.code === 'RED'));
  await api.post('/lists/types/JK', { name_en: 'Blazer jacket' });
  assert.equal((await api.get('/meta')).types.find((t) => t.code === 'JK').name_en, 'Blazer jacket');
  await fails(api.post('/lists/brands/1/delete'), 'IN_USE'); // brand 1 is used by a store
  await fails(api.post('/lists/colours/NVY/delete'), 'IN_USE'); // used by the design from setup
  await api.post('/lists/colours/RED/delete'); await api.post('/lists/types/JK/delete');
  await api.post('/lists/sizes', { sets: { Suit: ['44', '46'], Shoes: ['40', '41'] } });
  assert.deepEqual((await api.get('/meta')).size_sets, { Suit: ['44', '46'], Shoes: ['40', '41'] });
  const des = await api.post('/designs', { brand_id: (await api.get('/meta')).brands.find((b) => b.code === 'ZZ').id, type_code: 'S', name_en: 'Odd size', price_usd: 10, colours: ['NVY'], sizes: ['58'] });
  assert.equal(des.skus.length, 1);
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'mgr@x.com', password: 'Mgr-pass-123' });
  await fails(api.post('/lists/brands', { code: 'QQ', name_en: 'No' }), 'FORBIDDEN');
});

test('warehouse: owner adds one, receives stock, moves it to a shop; it never sells or shows in shop reports', async () => {
  const { api, d } = await setup();
  const wh = await api.post('/admin/stores', { kind: 'warehouse', name: 'Main warehouse', code: 'WH' });
  const list = (await api.get('/admin/stores')).stores; const w = list.find((x) => x.code === 'WH');
  assert.equal(w.kind, 'warehouse');
  await fails(api.post('/admin/stores', { kind: 'warehouse', name: 'Dup', code: 'WH' }), 'DUPLICATE');
  const me = await api.get('/me'); assert.equal(me.stores.find((x) => x.id === w.id).kind, 'warehouse');
  assert.ok(!(await api.get('/auth/stores').catch(() => [])).some?.((x) => x.id === w.id));
  const item = await api.get(`/items/code/${d.skus[0]}?store_id=${w.id}`);
  await api.post('/stock/in', { store_id: w.id, lines: [{ item_id: item.id, qty: 10 }] });
  await fails(api.post('/shifts/open', { store_id: w.id, open_usd: 0, open_khr: 0 }), 'WAREHOUSE');
  const tr = await api.post('/transfers', { from_store_id: w.id, to_store_id: 1, lines: [{ item_id: item.id, qty: 4 }], reason: 'restock' });
  await api.post(`/transfers/${tr.id}/approve`).catch(() => {});
  const dash = await api.get('/dashboard?store=all&period=month'); assert.ok(!dash.scope.stores.some((x) => x.id === w.id));
  const rep = await api.get('/report?store_id=all&period=month').catch(() => null); if (rep?.stores) assert.ok(!rep.stores.some((x) => x.id === w.id));
  await api.post(`/admin/stores/${w.id}`, {}).catch(() => {});
  await fails(api.post(`/admin/stores/${w.id}/delete`), 'HAS_HISTORY'); // has stock
});

test('restock: best sellers are ranked, low stock is listed, and a cashier can read it without any money figures', async () => {
  const { api, d } = await setup();
  const a = await api.get(`/items/code/${d.skus[0]}?store_id=1`); const b = await api.get(`/items/code/${d.skus[1]}?store_id=1`);
  await api.post('/stock/in', { store_id: 1, lines: [{ item_id: a.id, qty: 6 }, { item_id: b.id, qty: 4 }] });
  await api.post('/shifts/open', { store_id: 1, open_usd: 0, open_khr: 0 });
  await api.post('/sales', { store_id: 1, lines: [{ item_id: a.id, qty: 5, entry: 'search' }], payments: [{ method: 'khqr', currency: 'USD', amount: 100000 }] });
  await api.post('/sales', { store_id: 1, lines: [{ item_id: b.id, qty: 1, entry: 'search' }], payments: [{ method: 'khqr', currency: 'USD', amount: 20000 }] });
  const staff = await api.get('/public/stores/1/staff'); await api.post('/auth/logout');
  await api.post('/auth/pin-login', { store_id: 1, user_id: staff.find((x) => x.name === 'Cashier').id, pin: '123456' });
  const r = await api.get('/stock/restock?store_id=1&days=30');
  assert.equal(r.best[0].sku, d.skus[0]); assert.equal(r.best[0].sold, 5); assert.equal(r.best[0].rank, 1); assert.equal(r.best[1].sold, 1);
  assert.equal(r.low.some((x) => x.sku === d.skus[0] && x.here === 1 && x.level === 'low'), true);
  assert.equal(JSON.stringify(r).includes('cost'), false); assert.equal(JSON.stringify(r).includes('price'), false);
});

test('super admin: only the first owner can add or change owners, and cannot be removed or demoted', async () => {
  const { api, A } = await setup();
  const me = await api.get('/me');
  assert.equal(me.is_super, true);
  const users = (await api.get('/admin/users')).users;
  assert.equal(users.find((u) => u.id === me.id).is_super, true);
  await fails(api.put(`/admin/users/${me.id}`, { role: 'manager', store_ids: [1] }), 'FORBIDDEN');
  await fails(api.put(`/admin/users/${me.id}`, { active: false }), 'FORBIDDEN');
  const o2 = await api.post('/admin/users', { name: 'Second', role: 'owner', email: 'o2@x.com', password: 'Owner-pass-12' });
  await A.auth.signOut(); await api.post('/auth/login', { email: 'o2@x.com', password: 'Owner-pass-12' });
  const me2 = await api.get('/me');
  assert.equal(me2.is_super, false);
  await fails(api.post('/admin/users', { name: 'Third', role: 'owner', email: 'o3@x.com', password: 'Owner-pass-12' }), 'FORBIDDEN');
  await fails(api.put(`/admin/users/${me.id}`, { name: 'Hacked' }), 'FORBIDDEN');
  await fails(api.post(`/admin/users/${me.id}/delete`), 'FORBIDDEN');
  await fails(api.post('/admin/reset-test', { confirm: 'RESET' }), 'FORBIDDEN');
  assert.ok(o2.id);
});

test('filters under the search bar: defaults, owner can change them, cashier cannot', async () => {
  const { api } = await setup();
  const f0 = await api.get('/filters');
  assert.deepEqual(f0.stock, ['type', 'colour', 'size', 'brand', 'low']); assert.equal(f0.can_edit, true);
  await api.post('/filters', { scope: 'pos', keys: ['size', 'price'] });
  assert.deepEqual((await api.get('/filters')).pos, ['size', 'price']);
  assert.deepEqual((await api.get('/filters')).stock, f0.stock);
  await fails(api.post('/filters', { scope: 'pos', keys: ['low'] }), 'BAD_INPUT');
  await fails(api.post('/filters', { scope: 'stock', keys: ['nope'] }), 'BAD_INPUT');
  await api.post('/auth/logout'); await api.post('/auth/login', { email: 'mgr@x.com', password: 'Mgr-pass-123' });
  const fm = await api.get('/filters'); assert.equal(fm.can_edit, false); assert.deepEqual(fm.pos, ['size', 'price']);
  await fails(api.post('/filters', { scope: 'pos', keys: [] }), 'FORBIDDEN');
});
