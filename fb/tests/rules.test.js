// Run with:  npm run test:rules   (needs Java and an internet connection the first time)
import test, { before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

const here = path.dirname(fileURLToPath(import.meta.url));
let env;

const USERS = {
  owner: { name: 'Owner', role: 'owner', storeIds: [], active: true },
  mgr1: { name: 'Manager 1', role: 'manager', storeIds: [1], active: true },
  mgr2: { name: 'Manager 2', role: 'manager', storeIds: [2], active: true },
  cash1: { name: 'Cashier 1', role: 'cashier', storeIds: [1], active: true },
  cash2: { name: 'Cashier 2', role: 'cashier', storeIds: [2], active: true },
  gone: { name: 'Ex staff', role: 'cashier', storeIds: [1], active: false },
};

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-angkor', firestore: { rules: fs.readFileSync(path.join(here, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, u] of Object.entries(USERS)) await setDoc(doc(db, 'users', uid), u);
    await setDoc(doc(db, 'stores', '1'), { id: 1, name: 'S1', switches: { cashier_discount_limit_percent: 10, pin_every_discount: false } });
    await setDoc(doc(db, 'costs', 'd1'), { costCents: 600 });
    await setDoc(doc(db, 'designs', 'd1'), { name: 'Suit', priceCents: 18900 });
    await setDoc(doc(db, 'stock', '1_10'), { storeId: 1, itemId: 10, onHand: 5, reserved: 0 });
    await setDoc(doc(db, 'transfers', 't1'), { fromStoreId: 1, toStoreId: 2, requestedBy: 'cash2', status: 'requested' });
    await setDoc(doc(db, 'transfers', 't2'), { fromStoreId: 1, toStoreId: 2, requestedBy: 'mgr1', status: 'requested' });
    await setDoc(doc(db, 'approvals', 'a1'), { storeId: 1, requestedBy: 'cash1', status: 'pending' });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();

test('nobody signed out can read anything private', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'designs', 'd1')));
  await assertFails(getDoc(doc(db, 'users', 'owner')));
});
test('deactivated staff are locked out', async () => { await assertFails(getDoc(doc(as('gone'), 'designs', 'd1'))); });
test('cashier reads catalogue but never cost', async () => {
  await assertSucceeds(getDoc(doc(as('cash1'), 'designs', 'd1')));
  await assertFails(getDoc(doc(as('cash1'), 'costs', 'd1')));
  await assertSucceeds(getDoc(doc(as('mgr1'), 'costs', 'd1')));
});
test('only owners create or change people; nobody deletes', async () => {
  await assertFails(setDoc(doc(as('mgr1'), 'users', 'x'), { name: 'X', role: 'owner', storeIds: [], active: true }));
  await assertFails(updateDoc(doc(as('cash1'), 'users', 'cash1'), { role: 'owner' }));
  await assertSucceeds(setDoc(doc(as('owner'), 'users', 'new1'), { name: 'N', role: 'cashier', storeIds: [1], active: true }));
  await assertFails(deleteDoc(doc(as('owner'), 'users', 'new1')));
});
test('staff cannot read other people', async () => {
  await assertFails(getDoc(doc(as('cash1'), 'users', 'mgr1')));
  await assertSucceeds(getDoc(doc(as('cash1'), 'users', 'cash1')));
});
test('catalogue changes are owner only', async () => {
  await assertFails(setDoc(doc(as('mgr1'), 'designs', 'd2'), { name: 'X' }));
  await assertSucceeds(setDoc(doc(as('owner'), 'designs', 'd2'), { name: 'X' }));
});
test('cashier cannot raise or adjust stock, only lower it together with a sale', async () => {
  const db = as('cash1');
  await assertFails(updateDoc(doc(db, 'stock', '1_10'), { onHand: 50 }));
  await assertFails(updateDoc(doc(db, 'stock', '1_10'), { onHand: 4, lastSaleId: 's-missing' }));
  const b = writeBatch(db);
  b.set(doc(db, 'sales', 's1'), { storeId: 1, cashierId: 'cash1', status: 'completed', subtotalCents: 18900, discountCents: 0, totalCents: 18900 });
  b.update(doc(db, 'stock', '1_10'), { onHand: 4, lastSaleId: 's1' });
  await assertSucceeds(b.commit());
});
test('cashier cannot take stock below zero', async () => {
  const db = as('cash1');
  const b = writeBatch(db);
  b.set(doc(db, 'sales', 's1'), { storeId: 1, cashierId: 'cash1', status: 'completed', subtotalCents: 18900, discountCents: 0 });
  b.update(doc(db, 'stock', '1_10'), { onHand: -1, lastSaleId: 's1' });
  await assertFails(b.commit());
});
test('manager adjusts only their own store stock', async () => {
  await assertSucceeds(updateDoc(doc(as('mgr1'), 'stock', '1_10'), { onHand: 9 }));
  await assertFails(updateDoc(doc(as('mgr2'), 'stock', '1_10'), { onHand: 9 }));
});
test('a sale cannot be written for another cashier or another store', async () => {
  const db = as('cash1');
  await assertFails(setDoc(doc(db, 'sales', 's9'), { storeId: 1, cashierId: 'mgr1', status: 'completed', subtotalCents: 18900, discountCents: 0 }));
  await assertFails(setDoc(doc(db, 'sales', 's9'), { storeId: 2, cashierId: 'cash1', status: 'completed', subtotalCents: 18900, discountCents: 0 }));
});
test('a big discount needs an approved approval from a manager', async () => {
  const db = as('cash1');
  const sale = { storeId: 1, cashierId: 'cash1', status: 'completed', subtotalCents: 20000, discountCents: 6000 };
  await assertFails(setDoc(doc(db, 'sales', 's5'), sale));
  await assertFails(setDoc(doc(db, 'sales', 's5'), { ...sale, approvalId: 'a1' })); // still pending
  await assertFails(updateDoc(doc(db, 'approvals', 'a1'), { status: 'approved', decidedBy: 'cash1' })); // self-approval
  await assertSucceeds(updateDoc(doc(as('mgr1'), 'approvals', 'a1'), { status: 'approved', decidedBy: 'mgr1', decidedTs: 1 }));
  await assertSucceeds(setDoc(doc(db, 'sales', 's5'), { ...sale, approvalId: 'a1' }));
});
test('a manager of another store cannot approve', async () => {
  await assertFails(updateDoc(doc(as('mgr2'), 'approvals', 'a1'), { status: 'approved', decidedBy: 'mgr2', decidedTs: 1 }));
});
test('only a manager or owner can void, and only the void fields change', async () => {
  await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'sales', 's1'), { storeId: 1, cashierId: 'cash1', status: 'completed', totalCents: 100 }));
  await assertFails(updateDoc(doc(as('cash1'), 'sales', 's1'), { status: 'voided', voidedBy: 'cash1', voidReason: 'x', voidedTs: 1 }));
  await assertFails(updateDoc(doc(as('mgr1'), 'sales', 's1'), { status: 'voided', totalCents: 0 }));
  await assertSucceeds(updateDoc(doc(as('mgr1'), 'sales', 's1'), { status: 'voided', voidedBy: 'mgr1', voidReason: 'wrong item', voidedTs: 1 }));
  await assertFails(deleteDoc(doc(as('owner'), 'sales', 's1')));
});
test('movements and audit log can be added but never changed or deleted', async () => {
  await assertSucceeds(setDoc(doc(as('cash1'), 'movements', 'm1'), { storeId: 1, userId: 'cash1', qty: -1 }));
  await assertFails(updateDoc(doc(as('cash1'), 'movements', 'm1'), { qty: 5 }));
  await assertFails(deleteDoc(doc(as('owner'), 'movements', 'm1')));
  await assertFails(setDoc(doc(as('cash1'), 'movements', 'm2'), { storeId: 1, userId: 'mgr1', qty: -1 }));
  await assertSucceeds(setDoc(doc(as('cash1'), 'auditLog', 'l1'), { userId: 'cash1', action: 'x' }));
  await assertFails(getDoc(doc(as('cash1'), 'auditLog', 'l1')));
});
test('transfers: requester cannot approve their own, sending store manager can', async () => {
  await assertFails(updateDoc(doc(as('cash2'), 'transfers', 't1'), { status: 'approved' }));
  await assertFails(updateDoc(doc(as('mgr2'), 'transfers', 't1'), { status: 'approved' })); // receiving store cannot approve
  await assertSucceeds(updateDoc(doc(as('mgr1'), 'transfers', 't1'), { status: 'approved' }));
  await assertFails(updateDoc(doc(as('mgr1'), 'transfers', 't2'), { status: 'approved' })); // own request
  await assertSucceeds(updateDoc(doc(as('owner'), 'transfers', 't2'), { status: 'approved' }));
});
test('transfers: only the sender sends, only the receiver receives, only the owner settles', async () => {
  await env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), 'transfers', 't1'), { status: 'approved' }));
  await assertFails(updateDoc(doc(as('mgr2'), 'transfers', 't1'), { status: 'in_transit' }));
  await assertSucceeds(updateDoc(doc(as('mgr1'), 'transfers', 't1'), { status: 'in_transit' }));
  await assertFails(updateDoc(doc(as('mgr1'), 'transfers', 't1'), { status: 'received' }));
  await assertSucceeds(updateDoc(doc(as('mgr2'), 'transfers', 't1'), { status: 'discrepancy' }));
  await assertFails(updateDoc(doc(as('mgr2'), 'transfers', 't1'), { status: 'resolved' }));
  await assertSucceeds(updateDoc(doc(as('owner'), 'transfers', 't1'), { status: 'resolved' }));
});
test('cashiers cannot read daily totals', async () => {
  await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'dailyStats', '1_2026-10-21'), { storeId: 1, salesCents: 1000 }));
  await assertFails(getDoc(doc(as('cash1'), 'dailyStats', '1_2026-10-21')));
  await assertSucceeds(getDoc(doc(as('mgr1'), 'dailyStats', '1_2026-10-21')));
  await assertFails(getDoc(doc(as('mgr2'), 'dailyStats', '1_2026-10-21')));
});

test('first owner can be created once, only together with the setup marker', async () => {
  await env.clearFirestore();
  const db = env.authenticatedContext('first').firestore();
  await assertFails(setDoc(doc(db, 'users', 'first'), { name: 'A', role: 'owner', storeIds: [], active: true })); // no marker
  const b = writeBatch(db);
  b.set(doc(db, 'setup', 'state'), { firstOwner: 'first' });
  b.set(doc(db, 'users', 'first'), { name: 'A', role: 'owner', storeIds: [], active: true });
  await assertSucceeds(b.commit());
  const db2 = env.authenticatedContext('second').firestore();
  const b2 = writeBatch(db2);
  b2.set(doc(db2, 'setup', 'state'), { firstOwner: 'second' });
  b2.set(doc(db2, 'users', 'second'), { name: 'B', role: 'owner', storeIds: [], active: true });
  await assertFails(b2.commit());
});
test('sign-in screen can list store names and staff names without signing in', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'publicStores', '1'), { id: 1, name: 'S1' }); });
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'publicStores', '1')));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'publicStores', '2'), { id: 2 }));
});
