import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, phnomPenhDate, tillPassword, validPin } from '../logic.js';

test('summary lists shops only, with totals and expenses', () => {
  const stores = [{ id: 1, name: 'A', active: true }, { id: 2, name: 'B', active: true }, { id: 3, name: 'WH', active: true, kind: 'warehouse' }, { id: 4, name: 'Off', active: false }];
  const stats = new Map([['1_2026-10-22', { salesCents: 10000, orders: 2, byMethod: { cash: 4000, khqr: 6000 } }], ['2_2026-10-22', { salesCents: 500, orders: 1, byMethod: { cash: 500 } }], ['3_2026-10-22', { salesCents: 999999, orders: 9 }]]);
  const t = buildSummary({ date: '2026-10-22', stores, stats, expenses: [{ storeId: 1, date: '2026-10-22', amountCents: 1250 }, { storeId: 1, date: '2026-10-21', amountCents: 9999 }] });
  assert.match(t, /A: \$100.00 \(2 orders, cash \$40.00, KHQR \$60.00, expenses \$12.50\)/);
  assert.match(t, /B: \$5.00 \(1 orders/);
  assert.match(t, /Total: \$105.00 · 3 orders/);
  assert.ok(!t.includes('WH') && !t.includes('Off'));
});
test('Phnom Penh date rolls over at 17:00 UTC', () => {
  assert.equal(phnomPenhDate(Date.parse('2026-10-22T16:59:00Z')), '2026-10-22');
  assert.equal(phnomPenhDate(Date.parse('2026-10-22T17:00:00Z')), '2026-10-23');
});
test('PIN rules and till password format', () => {
  assert.ok(validPin('1234') && validPin('123456') && !validPin('123') && !validPin('12345a'));
  assert.equal(tillPassword('1234', 'AF'), '1234-AF-af');
});
