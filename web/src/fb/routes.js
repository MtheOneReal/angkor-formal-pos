// Maps the screens' API calls (same URLs as the Node server) onto Firestore.
import { createExtras } from './extras.js';
import { createMore } from './more.js';
import { ApiErr, SWITCH_DEFAULTS, ROLE_PERMS, khrToUsdCents, usdCentsToKhr, khrTolerance, level, dateOf } from './backend.js';

export function createApi(B, extra = {}) {
  const { fs, db, auth, secondary } = B.deps;
  const { doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where, writeBatch, runTransaction, increment } = fs;
  const { bad, forbidden, notFound, approval, need, can, assertStore, read, list, audit, auditIn, wrap, now } = B;
  const S = () => B.S();
  const X = createExtras(B);
  const M = createMore(B);
  const sid = (n) => String(n);
  const txt = (v, n) => String(v ?? '').slice(0, n);
  const ts = () => now();

  const storeById = async (id) => (await B.loadStores()).find((s) => s.id === Number(id));
  const switchesOf = async (id) => (await storeById(id))?.switches || { ...SWITCH_DEFAULTS };

  // ---------- public + login ----------
  async function publicStores() {
    const rows = await list('publicStores');
    return rows.filter((s) => s.active !== false).map((s) => ({ id: Number(s.id), code: s.code, name: s.name, brand_code: s.brandCode })).sort((a, b) => a.id - b.id);
  }
  async function publicStaff(storeId) {
    const rows = await list('staffDirectory');
    return rows.filter((r) => r.active !== false && (r.storeIds || []).map(Number).includes(Number(storeId)) && r.authEmail)
      .map((r) => ({ id: r.id, name: r.name, role: r.role, pin_length: r.pinLength || 0 })).sort((a, b) => (a.role < b.role ? 1 : -1) || a.name.localeCompare(b.name));
  }
  const tillPassword = (pin, code) => `${pin}-${code}-af`;
  async function pinLogin(b) {
    const dir = await read('staffDirectory', b.user_id);
    const st = await read('publicStores', b.store_id);
    if (!dir || !st || !dir.authEmail) throw new ApiErr(401, 'BAD_LOGIN', 'PIN is not correct.');
    try { await auth.signIn(dir.authEmail, tillPassword(String(b.pin), st.code)); } catch { throw new ApiErr(401, 'BAD_LOGIN', 'PIN is not correct.'); }
    B.localStorageSet('af_store', String(b.store_id));
    await B.startSession();
    await audit(Number(b.store_id), 'login', 'user', S().uid, { via: 'pin' });
    return { ok: true };
  }
  async function changePassword(b) {
    if (S().user.role === 'cashier') throw forbidden('Cashiers change their PIN with the owner or a manager.');
    const next = String(b.new_password || '');
    if (next.length < 8) throw bad('WEAK_PASSWORD', 'The new password needs at least 8 characters.');
    if (next === b.current_password) throw bad('SAME_PASSWORD', 'The new password must be different.');
    try { await auth.changePassword(String(b.current_password || ''), next); } catch { throw new ApiErr(401, 'BAD_LOGIN', 'Your current password is not correct.'); }
    await audit(S().storeId, 'password.change', 'user', S().uid, {}); return { ok: true };
  }
  // TESTING ONLY. Remove this, its route, the Settings button and the testReset() rule when the app goes live.
  async function resetTest(b) {
    need('settings.manage'); if (!S().isSuper) throw forbidden('Only the super admin can reset.');
    if (b.confirm !== 'RESET') throw bad('CONFIRM', 'Type RESET to confirm.');
    await setDoc(ref('settings', 'testMode'), { enabled: true, ts: ts(), by: S().uid });
    const cols = ['sales', 'returns', 'shifts', 'dailyStats', 'itemStats', 'monthStats', 'approvals', 'transfers', 'movements', 'stock', 'counters', 'expenses', 'expensePhotos', 'attendance', 'customers', ...(b.catalogue ? ['items', 'designs', 'costs'] : []), ...(b.capital ? ['capitalPayments', 'shareholders'] : []), 'balances', 'balancePayments', 'alterations', 'stocktakes', 'auditLog'];
    let n = 0;
    for (const c of cols) {
      let docs; try { docs = (await getDocs(collection(db, c))).docs; } catch { throw bad('RESET_FAILED', `Could not read ${c}.`); }
      for (let i = 0; i < docs.length; i += 400) {
        const wb = writeBatch(db); docs.slice(i, i + 400).forEach((d) => wb.delete(ref(c, d.id)));
        try { await wb.commit(); } catch { throw bad('RESET_FAILED', `Could not clear ${c}. Some data may already be cleared; try again.`); }
      }
      n += docs.length;
    }
    if (b.catalogue) await setDoc(ref('meta', 'ids'), { design: 0, item: 0, transfer: 0 });
    else { const m = (await read('meta', 'ids')) || {}; await setDoc(ref('meta', 'ids'), { ...m, transfer: 0 }); }
    B.clearCaches(); await B.startSession();
    await audit(null, 'test.reset', 'system', 'all', { removed: n, catalogue: !!b.catalogue }); return { ok: true, removed: n };
  }
  async function emailLogin(b) {
    if (!b.email || !b.password) throw bad('MISSING', 'Enter email and password.');
    try { await auth.signIn(String(b.email).trim().toLowerCase(), b.password); } catch { throw new ApiErr(401, 'BAD_LOGIN', 'Email or password is not correct.'); }
    await B.startSession();
    await audit(S().storeId, 'login', 'user', S().uid, { via: 'email' });
    return { ok: true };
  }

  // ---------- catalogue ----------
  async function itemByCode(q) {
    const storeId = assertStore(q.store_id);
    const code = B.normaliseCode(q.code);
    const cat = await B.loadCatalog(); const costs = B.can('cost.view') ? await B.loadCosts() : null;
    const it = cat.items.find((i) => i.sku === code);
    const row = it && (await B.itemRow(it, cat, costs));
    if (!row || !row.active) throw notFound('This code is not in the catalogue.');
    const s = B.quant((await B.stockOfStore(storeId)).get(row.id));
    return { ...row, ...s, incoming: await incomingFor(storeId, row.id) };
  }
  async function incomingFor(storeId, itemId) {
    const trs = await list('transfers', where('toStoreId', '==', Number(storeId)));
    let n = 0;
    for (const t of trs) if (t.status === 'in_transit') for (const l of t.lines || []) if (Number(l.itemId) === Number(itemId)) n += l.qtySent || 0;
    return n;
  }
  async function itemsList(q) {
    need('catalog.view');
    const storeId = assertStore(q.store_id);
    const rows = await B.itemRows(q.q, 60);
    const sm = await B.stockOfStore(storeId);
    return rows.map((r) => ({ ...r, ...B.quant(sm.get(r.id)), incoming: 0 }));
  }
  async function posCatalog(q) {
    need('catalog.view'); const my = assertStore(q.store_id);
    const sw = await switchesOf(my); const cashier = S().user.role === 'cashier';
    const canOther = can('stock.view_other') && (!cashier || sw.cashier_see_other_stock);
    const rows = (await B.itemRows('', 3000)); const mine = await B.stockOfStore(my);
    const all = canOther ? await B.stockOfAll() : [];
    const other = new Map(); for (const x of all) if (Number(x.storeId) !== my) other.set(Number(x.itemId), (other.get(Number(x.itemId)) || 0) + Math.max(0, B.quant(x).available));
    const types = new Map((await B.loadCatalog()).typesList.map((t) => [t.code, t]));
    return { items: rows.map(({ cost_cents, ...r }) => ({ ...r, available: Math.max(0, B.quant(mine.get(r.id)).available), others: canOther ? (other.get(r.id) || 0) : null, type_name_en: types.get(r.type_code)?.nameEn || r.type_code, type_name_km: types.get(r.type_code)?.nameKm || null })) };
  }
  async function designsList() {
    need('catalog.view');
    const cat = await B.loadCatalog(); const costs = B.can('cost.view') ? await B.loadCosts() : null;
    return [...cat.designs.values()].sort((a, b) => String(a.brandCode).localeCompare(b.brandCode) || String(a.typeCode).localeCompare(b.typeCode) || a.number - b.number).map((d) => {
      const o = { id: Number(d.id), brand_id: d.brandId, type_code: d.typeCode, number: d.number, name_en: d.nameEn, name_km: d.nameKm || null, photo: d.photo || null, price_cents: d.priceCents, active: d.active !== false ? 1 : 0, brand_code: d.brandCode,
        items: cat.items.filter((i) => Number(i.designId) === Number(d.id)).map((i) => ({ id: i.id, design_id: Number(d.id), sku: i.sku, colour_code: i.colourCode, size: i.size, low_stock: i.lowStock ?? 2, active: i.active !== false ? 1 : 0 })) };
      if (costs) o.cost_cents = costs.get(String(d.id)) ?? 0;
      return o;
    });
  }
  async function meta() {
    const c = await B.loadCatalog();
    return { brands: c.brandsList.map((b) => ({ id: Number(b.id), code: b.code, name: b.name })), types: c.typesList.map((t) => ({ code: t.code, name_en: t.nameEn, name_km: t.nameKm })),
      colours: c.coloursList.map((x) => ({ code: x.code, name_en: x.nameEn, name_km: x.nameKm, hex: x.hex })), suit_sizes: ['44', '46', '48', '50', '52', '54', '56'], size_sets: (await read('settings', 'sizeSets'))?.sets || null };
  }
  async function nextIds(kind, n) {
    const r = ref('meta', 'ids');
    return runTransaction(db, async (t) => {
      const s = await t.get(r); const cur = s.exists() ? s.data()[kind] || 0 : 0;
      t.set(r, { [kind]: cur + n }, { merge: true });
      return cur + 1;
    });
  }
  const ref = (name, id) => doc(db, name, String(id));
  async function createDesign(b) {
    need('catalog.edit');
    const cat = await B.loadCatalog();
    const brand = cat.brandsList.find((x) => Number(x.id) === Number(b.brand_id)); const type = cat.typesList.find((x) => x.code === b.type_code);
    if (!brand || !type) throw bad('BAD_INPUT', 'Choose a brand and a type.');
    if (!b.name_en) throw bad('BAD_INPUT', 'Enter a name.');
    const price = Math.round(Number(b.price_usd) * 100); const cost = Math.round(Number(b.cost_usd || 0) * 100);
    if (!(price > 0)) throw bad('BAD_INPUT', 'Enter a selling price.');
    const colours = (b.colours || []).filter(Boolean); const sizes = (b.sizes || []).map(String).filter(Boolean);
    if (!colours.length || !sizes.length) throw bad('BAD_INPUT', 'Choose at least one colour and one size.');
    let number = Number(b.number);
    if (!number) number = Math.max(0, ...[...cat.designs.values()].filter((d) => Number(d.brandId) === Number(brand.id) && d.typeCode === type.code).map((d) => d.number)) + 1;
    if ([...cat.designs.values()].some((d) => Number(d.brandId) === Number(brand.id) && d.typeCode === type.code && d.number === number)) throw bad('DUPLICATE', 'This brand, type and number already exist.');
    const dId = await nextIds('design', 1);
    const first = await nextIds('item', colours.length * sizes.length);
    const batch = writeBatch(db);
    batch.set(ref('designs', dId), { id: dId, brandId: Number(brand.id), brandCode: brand.code, typeCode: type.code, number, nameEn: txt(b.name_en, 100), nameKm: txt(b.name_km, 100) || null, photo: b.photo || null, priceCents: price, active: true, createdAt: ts() });
    batch.set(ref('costs', dId), { costCents: cost });
    let k = 0; const skus = [];
    for (const c of colours) for (const s of sizes) {
      const id = first + k++; const sku = `${brand.code}-${type.code}${String(number).padStart(2, '0')}-${c}-${String(s).toUpperCase()}`;
      batch.set(ref('items', id), { id, sku, designId: dId, colourCode: c, size: String(s).toUpperCase(), lowStock: 2, active: true }); skus.push(sku);
    }
    auditIn(batch, null, 'design.create', 'design', dId, { name: b.name_en, variants: skus.length });
    await batch.commit();
    await B.loadCatalog(true);
    return { id: dId, skus };
  }

  // ---------- stock ----------
  async function stockList(q) {
    need('stock.view');
    const storeId = assertStore(q.store_id);
    const rows = await B.itemRows(q.q, 300); const sm = await B.stockOfStore(storeId);
    return rows.map((r) => ({ ...r, ...B.quant(sm.get(r.id)) })).filter((r) => q.only_stocked !== '1' || r.on_hand !== 0 || r.reserved !== 0);
  }
  async function lookup(q) {
    need('stock.view');
    const my = assertStore(q.store_id);
    const sw = await switchesOf(my); const cashier = S().user.role === 'cashier';
    const canOther = can('stock.view_other') && (!cashier || sw.cashier_see_other_stock);
    const exact = !cashier || sw.show_exact_other_qty;
    const stores = (await B.loadStores()).filter((s) => s.active !== false);
    const show = canOther ? stores : stores.filter((s) => s.id === my);
    const rows = (await B.itemRows(q.q, 40));
    const all = canOther ? await B.stockOfAll() : [...(await B.stockOfStore(my)).values()];
    const trs = (await list('transfers', where('toStoreId', '==', my))).filter((t) => t.status === 'in_transit');
    const items = rows.map((r) => {
      const per = show.slice().sort((a, b) => (a.id === my ? -1 : b.id === my ? 1 : a.id - b.id)).map((s) => {
        const st = all.find((x) => Number(x.storeId) === s.id && Number(x.itemId) === r.id); const a = B.quant(st).available;
        const o = { store_id: s.id, level: level(a, r.low_stock) };
        if (s.id === my || exact) o.qty = Math.max(0, a);
        return o;
      });
      const inc = trs.reduce((n, t) => n + (t.lines || []).filter((l) => Number(l.itemId) === r.id).reduce((m, l) => m + (l.qtySent || 0), 0), 0);
      const { cost_cents, ...safe } = r;
      return { ...safe, incoming: inc, stores: per };
    });
    return { stores: show.map((s) => ({ id: s.id, name: s.name, code: s.code })), items };
  }
  // Best sellers (ranked) and low stock for one branch, safe for cashiers: quantities only, never cost.
  async function restock(q) {
    need('rank.view');
    const my = assertStore(q.store_id); const days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
    const sw = await switchesOf(my); const cashier = S().user.role === 'cashier';
    const canOther = can('stock.view_other') && (!cashier || sw.cashier_see_other_stock);
    const today = dateOf(ts()); const sold = new Map();
    const docs = (await Promise.all(Array.from({ length: days }, (_, i) => read(can('dashboard.view') ? 'dailyStats' : 'itemStats', `${my}_${dstr(today, -i)}`).catch(() => null)))).filter(Boolean);
    for (const d of docs) for (const [iid, v] of Object.entries(d.byItem || {})) sold.set(Number(iid), (sold.get(Number(iid)) || 0) + (v.qty || 0));
    const seeStock = can('stock.view'); const rows = await B.itemRows('', 3000); const mine = seeStock ? await B.stockOfStore(my) : new Map(); const all = canOther && seeStock ? await B.stockOfAll() : [];
    const list_ = rows.map((r) => {
      const a = B.quant(mine.get(r.id)).available; const others = canOther ? all.filter((x) => Number(x.itemId) === r.id && Number(x.storeId) !== my).reduce((n, x) => n + Math.max(0, B.quant(x).available), 0) : 0;
      return { id: r.id, sku: r.sku, name_en: r.name_en, name_km: r.name_km, colour_en: r.colour_en, colour_km: r.colour_km, size: r.size, sold: sold.get(r.id) || 0, ...(seeStock ? { here: Math.max(0, a), level: level(a, r.low_stock), others, can_other: canOther } : {}) };
    });
    const best = list_.filter((r) => r.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 20).map((r, i) => ({ ...r, rank: i + 1 }));
    const low = !seeStock ? [] : list_.filter((r) => r.level !== 'in' && (r.sold > 0 || r.here > 0)).sort((a, b) => (a.here === 0 ? 0 : 1) - (b.here === 0 ? 0 : 1) || b.sold - a.sold).slice(0, 40);
    return { days, store_id: my, can_other: canOther && seeStock, has_stock: seeStock, best, low };
  }
  async function stockIn(b) {
    need('stock.in');
    const storeId = assertStore(b.store_id);
    const lines = (b.lines || []).map((l) => ({ item_id: Number(l.item_id), qty: Math.floor(Number(l.qty)) })).filter((l) => l.item_id && l.qty > 0);
    if (!lines.length) throw bad('NO_LINES', 'Add at least one item with a quantity.');
    const reference = txt(b.reference, 120);
    await runTransaction(db, async (t) => {
      const snaps = []; for (const l of lines) snaps.push(await t.get(ref('stock', `${storeId}_${l.item_id}`)));
      lines.forEach((l, i) => {
        const cur = snaps[i].exists() ? snaps[i].data() : { storeId, itemId: l.item_id, onHand: 0, reserved: 0, returned: 0, damaged: 0 };
        t.set(ref('stock', `${storeId}_${l.item_id}`), { ...cur, onHand: (cur.onHand || 0) + l.qty });
        t.set(doc(collection(db, 'movements')), { storeId, itemId: l.item_id, qty: l.qty, bucket: 'stock', type: 'stock_in', userId: S().uid, reason: reference || 'delivery', ts: ts() });
      });
      auditIn(t, storeId, 'stock.in', 'store', storeId, { pieces: lines.reduce((a, l) => a + l.qty, 0), lines: lines.length, reference });
    });
    B.invalidateStock();
    return { ok: true };
  }
  async function stockAdjust(b) {
    need('stock.adjust');
    const storeId = assertStore(b.store_id); const itemId = Number(b.item_id); const d = Math.trunc(Number(b.qty_delta)); const reason = txt(b.reason, 200).trim();
    if (!d) throw bad('BAD_QTY', 'Enter how many pieces to add or remove.');
    if (reason.length < 3) throw bad('REASON_REQUIRED', 'Write a reason.');
    await runTransaction(db, async (t) => {
      const s = await t.get(ref('stock', `${storeId}_${itemId}`)); const cur = s.exists() ? s.data() : { storeId, itemId, onHand: 0, reserved: 0, returned: 0, damaged: 0 };
      if ((cur.onHand || 0) + d < 0) throw bad('NEGATIVE_STOCK', 'Stock cannot go below zero.');
      t.set(ref('stock', `${storeId}_${itemId}`), { ...cur, onHand: (cur.onHand || 0) + d });
      t.set(doc(collection(db, 'movements')), { storeId, itemId, qty: d, bucket: 'stock', type: 'adjustment', userId: S().uid, reason, ts: ts() });
      auditIn(t, storeId, 'stock.adjust', 'item', itemId, { delta: d, reason });
    });
    B.invalidateStock();
    return { ok: true };
  }
  async function returnedList(q) {
    need('stock.adjust');
    const storeId = assertStore(q.store_id);
    const sm = await B.stockOfStore(storeId); const cat = await B.loadCatalog();
    return [...sm.values()].filter((r) => (r.returned || 0) > 0).map((r) => ({ item_id: Number(r.itemId), sku: cat.items.find((i) => i.id === Number(r.itemId))?.sku, qty: r.returned }));
  }
  async function returnedResolve(b) {
    need('stock.adjust');
    const storeId = assertStore(b.store_id); const itemId = Number(b.item_id); const qty = Math.floor(Number(b.qty)); const to = b.to === 'damaged' ? 'damaged' : 'stock';
    await runTransaction(db, async (t) => {
      const s = await t.get(ref('stock', `${storeId}_${itemId}`)); const cur = s.exists() ? s.data() : {};
      if (!(qty > 0) || (cur.returned || 0) < qty) throw bad('NOT_ENOUGH', 'Not that many returned pieces are waiting.');
      const next = { ...cur, returned: cur.returned - qty };
      if (to === 'stock') next.onHand = (cur.onHand || 0) + qty; else next.damaged = (cur.damaged || 0) + qty;
      t.set(ref('stock', `${storeId}_${itemId}`), next);
      t.set(doc(collection(db, 'movements')), { storeId, itemId, qty, bucket: to === 'stock' ? 'stock' : 'damaged', type: 'return_check', userId: S().uid, reason: to, ts: ts() });
      auditIn(t, storeId, 'stock.return_check', 'item', itemId, { qty, to });
    });
    B.invalidateStock();
    return { ok: true };
  }

  // ---------- shifts ----------
  const salesQ = (storeId, ...c) => query(collection(db, 'sales'), where('storeId', '==', Number(storeId)), ...c, ...(S().user.role === 'cashier' ? [where('cashierId', '==', S().uid)] : []));
  async function openShift(uid, storeId) {
    const rows = await list('shifts', where('storeId', '==', Number(storeId)), where('userId', '==', uid), where('closedTs', '==', null));
    return rows.find((r) => Number(r.storeId) === Number(storeId)) || null;
  }
  const shiftView = (s) => s && ({ id: s.id, store_id: s.storeId, user_id: s.userId, opened_ts: s.openedTs, open_usd_cents: s.openUsdCents, open_khr: s.openKhr, closed_ts: s.closedTs ?? null, counted_usd_cents: s.countedUsdCents ?? null, counted_khr: s.countedKhr ?? null, expected_usd_cents: s.expectedUsdCents ?? null, expected_khr: s.expectedKhr ?? null, diff_usd_cents: s.diffUsdCents ?? null, diff_khr: s.diffKhr ?? null, reviewed_by: s.reviewedBy ?? null, user_name: s.userName });
  async function shiftTotals(sh) {
    const sales = (await getDocs(salesQ(sh.storeId, where('shiftId', '==', String(sh.id))))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.status === 'completed');
    let cashUsd = 0; let cashKhr = 0;
    for (const s of sales) for (const p of s.payments || []) if (p.method === 'cash') { const sign = p.kind === 'change' ? -1 : 1; if (p.currency === 'USD') cashUsd += sign * p.amount; else cashKhr += sign * p.amount; }
    const bp = await list('balancePayments', where('storeId', '==', Number(sh.storeId)), where('shiftId', '==', String(sh.id)), where('userId', '==', String(sh.userId))).catch(() => []);
    for (const p of bp) if (p.method === 'cash') { if (p.currency === 'USD') cashUsd += p.amount; else cashKhr += p.amount; }
    const rets = S().user.role === 'cashier' ? [] : (await list('returns', where('storeId', '==', Number(sh.storeId)), where('shiftId', '==', String(sh.id)))).filter((r) => r.refundMethod === 'cash');
    const refunds = rets.reduce((a, r) => a + r.refundCents, 0);
    return { sales_count: sales.length, sales_total_cents: sales.reduce((a, s) => a + s.totalCents, 0), expected_usd_cents: (sh.openUsdCents || 0) + cashUsd - refunds, expected_khr: (sh.openKhr || 0) + cashKhr };
  }
  async function shiftCurrent(q) {
    need('shift.use'); const storeId = assertStore(q.store_id);
    const sh = await openShift(S().uid, storeId); if (!sh) return null;
    const t = await shiftTotals(sh); const v = shiftView(sh);
    delete v.expected_usd_cents; delete v.expected_khr; delete v.diff_usd_cents; delete v.diff_khr;
    return { ...v, sales_count: t.sales_count, sales_total_cents: t.sales_total_cents };
  }
  async function shiftOpen(b) {
    need('shift.use'); const storeId = assertStore(b.store_id);
    if ((await storeById(storeId))?.kind === 'warehouse') throw bad('WAREHOUSE', 'A warehouse does not sell. Choose a shop.');
    if (await openShift(S().uid, storeId)) throw bad('ALREADY_OPEN', 'You already have an open shift.');
    const usd = Math.round(Number(b.open_usd || 0) * 100); const khr = Math.round(Number(b.open_khr || 0));
    if (usd < 0 || khr < 0) throw bad('BAD_INPUT', 'Amounts cannot be negative.');
    const r = doc(collection(db, 'shifts'));
    await setDoc(r, { storeId, userId: S().uid, userName: S().user.name, openedTs: ts(), openUsdCents: usd, openKhr: khr, closedTs: null });
    await audit(storeId, 'shift.open', 'shift', r.id, { usd, khr });
    return shiftView({ id: r.id, storeId, userId: S().uid, openedTs: ts(), openUsdCents: usd, openKhr: khr, closedTs: null });
  }
  async function shiftClose(b) {
    need('shift.use');
    const sh = await read('shifts', b.shift_id);
    if (!sh || sh.closedTs) throw notFound('Shift not found or already closed.');
    if (sh.userId !== S().uid) throw forbidden();
    assertStore(sh.storeId);
    const cu = Math.round(Number(b.counted_usd) * 100); const ck = Math.round(Number(b.counted_khr || 0));
    if (!(cu >= 0) || !(ck >= 0)) throw bad('BAD_INPUT', 'Enter the cash you counted in USD and riel.');
    const t = await shiftTotals(sh);
    const upd = { closedTs: ts(), countedUsdCents: cu, countedKhr: ck, expectedUsdCents: t.expected_usd_cents, expectedKhr: t.expected_khr, diffUsdCents: cu - t.expected_usd_cents, diffKhr: ck - t.expected_khr, note: b.note ? txt(b.note, 300) : null };
    await updateDoc(ref('shifts', sh.id), upd);
    await audit(sh.storeId, 'shift.close', 'shift', sh.id, { diff_usd_cents: upd.diffUsdCents, diff_khr: upd.diffKhr });
    const sw = await switchesOf(sh.storeId);
    if (sw.blind_counts && !can('shift.review')) return { id: sh.id, closed_ts: upd.closedTs, blind: true };
    return { ...shiftView({ ...sh, ...upd }), ...t };
  }
  async function shiftsList(q) {
    need('shift.review'); const storeId = assertStore(q.store_id);
    const rows = (await list('shifts', where('storeId', '==', storeId))).sort((a, b) => b.openedTs - a.openedTs).slice(0, 60);
    return Promise.all(rows.map(async (r) => ({ ...shiftView(r), ...(r.closedTs ? {} : await shiftTotals(r)) })));
  }
  async function shiftReview(id) {
    need('shift.review'); const sh = await read('shifts', id); if (!sh) throw notFound(); assertStore(sh.storeId);
    if (sh.userId === S().uid) throw forbidden('You cannot review your own shift.');
    await updateDoc(ref('shifts', id), { reviewedBy: S().uid, reviewedTs: ts() });
    await audit(sh.storeId, 'shift.review', 'shift', id); return { ok: true };
  }

  // ---------- sales ----------
  const saleView = (s, returns = []) => {
    const lines = (s.lines || []).map((l, i) => { const r = returns.filter((x) => x.saleId === s.id).flatMap((x) => x.lines).filter((x) => x.lineIndex === i); return { id: i, item_id: l.itemId, qty: l.qty, unit_price_cents: l.unitCents, discount_cents: l.discountCents, line_total_cents: l.totalCents, entry: l.entry, sku: l.sku, size: l.size, name_en: l.nameEn, name_km: l.nameKm, colour_en: l.colourEn, colour_km: l.colourKm, returned_qty: r.reduce((a, x) => a + x.qty, 0), returned_cents: r.reduce((a, x) => a + x.refundCents, 0) }; });
    return { id: s.id, store_id: s.storeId, seq: s.seq, receipt_no: s.receiptNo, ts: s.ts, cashier_id: s.cashierId, cashier_name: s.cashierName, status: s.status, subtotal_cents: s.subtotalCents, discount_cents: s.discountCents, total_cents: s.totalCents, rate_khr_per_usd: s.rate, discount_reason: s.discountReason || null, approved_by_name: s.approvedByName || null, customer_name: s.customerName || null, customer_phone: s.customerPhone || null, alteration: !!s.alteration, deposit: !!s.deposit, balance_cents: s.balanceCents || 0, due_date: s.dueDate || null, store_name: s.storeName, store_code: s.storeCode, receipt_footer: s.receiptFooter, lines, payments: (s.payments || []).map((p) => ({ kind: p.kind, method: p.method, currency: p.currency, amount: p.amount, usd_cents: p.usd })), total_khr: usdCentsToKhr(s.totalCents, s.rate) };
  };
  async function getSale(id) {
    const s = await read('sales', id); if (!s) throw notFound('Receipt not found.');
    assertStore(s.storeId);
    if (S().user.role === 'cashier' && s.cashierId !== S().uid) throw forbidden('You can only see your own sales.');
    const rets = isLeadRole() ? await list('returns', where('storeId', '==', Number(s.storeId)), where('saleId', '==', String(id))) : [];
    return saleView(s, rets);
  }
  const isLeadRole = () => S().user.role !== 'cashier';

  async function makeApproval(storeId, kind, credential, message, reasonText) {
    // A manager (or owner) signs in on the second connection and approves a request created by this person.
    return B.asLead(storeId, credential, message, async (lead) => {
      let approvalId = null;
      if (lead.uid !== S().uid) {
        const r = doc(collection(db, 'approvals'));
        await setDoc(r, { storeId, kind, requestedBy: S().uid, requestedTs: ts(), status: 'pending', reason: reasonText || null });
        await updateDoc(doc(lead.db, 'approvals', r.id), { status: 'approved', decidedBy: lead.uid, decidedTs: ts() });
        approvalId = r.id;
      }
      return { approvalId, name: lead.user.name, uid: lead.uid };
    });
  }

  async function createSale(b) {
    need('pos.sell');
    const storeId = assertStore(b.store_id);
    const store = await storeById(storeId); const sw = store.switches;
    const shift = await openShift(S().uid, storeId);
    if (!shift) throw new ApiErr(409, 'SHIFT_REQUIRED', 'Open your shift before selling.');
    const lines = (b.lines || []).map((l) => ({ item_id: Number(l.item_id), qty: Math.floor(Number(l.qty)), entry: ['scan', 'typed', 'search'].includes(l.entry) ? l.entry : 'search' })).filter((l) => l.item_id && l.qty > 0);
    if (!lines.length) throw bad('EMPTY_CART', 'Add at least one item.');

    const cat = await B.loadCatalog();
    const ids = [...new Set(lines.map((l) => l.item_id))];
    const items = new Map();
    for (const id of ids) {
      const it = cat.items.find((i) => i.id === id); const d = it && cat.designs.get(String(it.designId));
      if (!it || !d || it.active === false || d.active === false) throw bad('BAD_ITEM', 'An item in the cart cannot be sold.');
      items.set(id, { it, d, c: cat.colours.get(it.colourCode) });
    }
    let approver = null; let approvalId = null;
    if (sw.require_scan_to_sell && lines.some((l) => l.entry !== 'scan') && !can('pos.approve')) {
      approver = await makeApproval(storeId, 'typed_entry', b.manager_pin, 'Scanning is required. A manager can unlock typed entry.');
    }
    let subtotal = 0;
    const calc = lines.map((l) => { const { d } = items.get(l.item_id); const gross = d.priceCents * l.qty; subtotal += gross; return { ...l, unit: d.priceCents, gross, disc: 0 }; });
    let discount = 0; const dsc = b.discount || null;
    if (dsc && Number(dsc.value) > 0) {
      discount = dsc.type === 'percent' ? Math.round((subtotal * Number(dsc.value)) / 100) : Math.round(Number(dsc.value) * 100);
      if (discount > subtotal) discount = subtotal;
      if (String(dsc.reason || '').trim().length < 3) throw bad('REASON_REQUIRED', 'Write a reason for the discount.');
    }
    if (discount > 0) {
      const pct = (discount * 100) / subtotal;
      if (!can('pos.approve') && (sw.pin_every_discount || pct > sw.cashier_discount_limit_percent)) {
        approver = await makeApproval(storeId, 'discount', b.manager_pin, `A discount above ${sw.cashier_discount_limit_percent}% needs a manager to approve.`, dsc.reason);
        approvalId = approver.approvalId;
      }
      let left = discount;
      calc.forEach((c, i) => { c.disc = i === calc.length - 1 ? left : Math.floor((discount * c.gross) / subtotal); left -= c.disc; });
    }
    const total = subtotal - discount;
    if (total <= 0) throw bad('ZERO_TOTAL', 'The total must be more than zero.');
    let customer = null;
    if (sw.customer_required && !b.customer_id) throw bad('CUSTOMER_REQUIRED', 'Attach a customer to this sale.');
    if (b.customer_id) { customer = await read('customers', b.customer_id); if (!customer) throw bad('BAD_CUSTOMER', 'Unknown customer.'); }

    const rate = await B.currentRate();
    const mk = (kind) => (p) => {
      const method = kind === 'change' ? 'cash' : p.method;
      if (!['cash', 'khqr', 'card'].includes(method)) throw bad('BAD_PAYMENT', 'Unknown payment method.');
      if (!['USD', 'KHR'].includes(p.currency)) throw bad('BAD_PAYMENT', 'Unknown currency.');
      const amount = Math.floor(Number(p.amount));
      if (!(amount > 0)) throw bad('BAD_PAYMENT', 'Payment amounts must be more than zero.');
      return { kind, method, currency: p.currency, amount, usd: p.currency === 'USD' ? amount : khrToUsdCents(amount, rate) };
    };
    const tender = (b.payments || []).map(mk('tender')); const change = (b.change || []).map(mk('change'));
    if (!tender.length) throw bad('NO_PAYMENT', 'Choose how the customer pays.');
    const paid = tender.reduce((a, p) => a + p.usd, 0); const given = change.reduce((a, p) => a + p.usd, 0);
    const cashIn = tender.filter((p) => p.method === 'cash').reduce((a, p) => a + p.usd, 0);
    if (given > cashIn) throw bad('BAD_CHANGE', 'Change cannot be more than the cash received.');
    const tol = [...tender, ...change].some((p) => p.currency === 'KHR') ? khrTolerance(rate) : 0;
    const deposit = !!b.deposit; const net = paid - given;
    const custName = customer?.name || (b.customer_name ? txt(b.customer_name, 100).trim() : null) || null; const custPhone = customer?.phone || (b.customer_phone ? txt(b.customer_phone, 30).trim() : null) || null;
    if (deposit) {
      if (!(net > 0 && net < total - tol)) throw bad('DEPOSIT_RANGE', 'A deposit must be more than zero and less than the total.');
      if (!custName || !custPhone) throw bad('CUSTOMER_REQUIRED', 'A deposit needs the customer name and phone number.');
    } else if (Math.abs(net - total) > tol) throw bad('PAYMENT_MISMATCH', 'Payment minus change does not match the total.', { total_cents: total, paid_cents: paid, change_cents: given });
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || '')) ? b.due_date : null;
    const balance = deposit ? total - net : 0;

    const saleRef = doc(collection(db, 'sales')); let late = null;
    const date = dateOf(ts());
    const want = new Map(); for (const l of lines) want.set(l.item_id, (want.get(l.item_id) || 0) + l.qty);
    let seq;
    await runTransaction(db, async (t) => {
      const cs = await t.get(ref('counters', storeId));
      const stockSnaps = new Map(); for (const id of want.keys()) stockSnaps.set(id, await t.get(ref('stock', `${storeId}_${id}`)));
      for (const [id, q] of want) {
        const have = Math.max(0, B.quant(stockSnaps.get(id).exists() ? stockSnaps.get(id).data() : null).available);
        if (q > have) throw new ApiErr(409, 'OUT_OF_STOCK', `${items.get(id).it.sku}: only ${have} available in this store.`, { item_id: id, available: have });
      }
      seq = (cs.exists() ? cs.data().seq : 0) + 1;
      t.set(ref('counters', storeId), { seq });
      const saleLines = calc.map((c) => { const x = items.get(c.item_id); return { itemId: c.item_id, sku: x.it.sku, size: x.it.size, nameEn: x.d.nameEn, nameKm: x.d.nameKm || null, colourEn: x.c?.nameEn || x.it.colourCode, colourKm: x.c?.nameKm || null, qty: c.qty, unitCents: c.unit, discountCents: c.disc, totalCents: c.gross - c.disc, entry: c.entry }; });
      t.set(saleRef, {
        storeId, seq, receiptNo: `${store.code}-${String(seq).padStart(6, '0')}`, ts: ts(), dayKey: `${storeId}_${date}`, cashierId: S().uid, cashierName: S().user.name, shiftId: String(shift.id),
        customerId: customer ? customer.id : null, customerName: custName, customerPhone: custPhone, alteration: !!b.alteration, deposit, balanceCents: balance, dueDate, subtotalCents: subtotal, discountCents: discount,
        totalCents: total, rate, discountReason: dsc?.reason ? txt(dsc.reason, 200) : null, approvalId, approvedByName: approver?.name || null, status: 'completed',
        storeName: store.name, storeCode: store.code, receiptFooter: store.receiptFooter || '', lines: saleLines,
        payments: [...tender, ...change], note: b.note ? txt(b.note, 200) : null,
      });
      const receiptNo = `${store.code}-${String(seq).padStart(6, '0')}`;
      if (deposit) t.set(ref('balances', saleRef.id), { storeId, saleId: saleRef.id, receiptNo, customerName: custName, customerPhone: custPhone, totalCents: total, paidCents: net, balanceCents: balance, dueDate, settled: false, createdBy: S().uid, createdByName: S().user.name, createdTs: ts() });
      if (b.alteration) t.set(doc(collection(db, 'alterations')), { storeId, saleId: saleRef.id, receiptNo, customerName: custName, customerPhone: custPhone, summary: saleLines.map((l) => `${l.qty}× ${l.nameEn} ${l.colourEn} ${l.size}`).join(', ').slice(0, 300), notes: txt(b.alteration_note, 300), dueDate, status: 'received', balanceCents: balance, createdBy: S().uid, createdByName: S().user.name, createdTs: ts(), updatedTs: ts() });
      for (const [id, q] of want) {
        const cur = stockSnaps.get(id).data();
        t.update(ref('stock', `${storeId}_${id}`), { storeId, itemId: id, onHand: cur.onHand - q, reserved: cur.reserved || 0, returned: cur.returned || 0, damaged: cur.damaged || 0, lastSaleId: saleRef.id });
        t.set(doc(collection(db, 'movements')), { storeId, itemId: id, qty: -q, bucket: 'stock', type: 'sale', refType: 'sale', refId: saleRef.id, userId: S().uid, ts: ts() });
      }
      const units = lines.reduce((a, l) => a + l.qty, 0);
      const byItem = {}; for (const c of calc) byItem[c.item_id] = { qty: increment(c.qty), cents: increment(c.gross - c.disc) };
      const byMethod = {}; for (const p of tender) byMethod[p.method] = increment(p.usd);
      const bump = { storeId, salesCents: increment(total), orders: increment(1), units: increment(units), discountCents: increment(discount), byItem, byMethod };
      t.set(ref('dailyStats', `${storeId}_${date}`), { ...bump, date }, { merge: true });
      late = qtyStats(bump, date);
      t.set(ref('monthStats', `${storeId}_${date.slice(0, 7)}`), { ...bump, date: date.slice(0, 7) }, { merge: true });
      auditIn(t, storeId, 'sale.create', 'sale', saleRef.id, { receipt: `${store.code}-${String(seq).padStart(6, '0')}`, total, discount, approver: approver?.uid ?? null });
    }).catch(wrap('Sale failed'));
    B.invalidateStock(storeId);
    // Best-seller counts are written after the sale is safe, so they can never block or undo a sale.
    if (late) await setDoc(ref('itemStats', `${storeId}_${date}`), late, { merge: true }).catch(() => {});
    return getSale(saleRef.id);
  }
  async function salesList(q) {
    need('sales.view'); const storeId = assertStore(q.store_id);
    const date = q.date || dateOf(ts());
    const snap = await getDocs(salesQ(storeId, where('dayKey', '==', `${storeId}_${date}`)));
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (q.q) rows = rows.filter((r) => String(r.receiptNo).toLowerCase().includes(String(q.q).trim().toLowerCase()));
    return rows.sort((a, b) => b.seq - a.seq).slice(0, 200).map((s) => ({ id: s.id, receipt_no: s.receiptNo, ts: s.ts, status: s.status, total_cents: s.totalCents, cashier_name: s.cashierName, pieces: (s.lines || []).reduce((a, l) => a + l.qty, 0), methods: [...new Set((s.payments || []).filter((p) => p.kind === 'tender').map((p) => p.method))] }));
  }
  // Quantities only (no money), so every cashier in the branch can read what is selling.
  const qtyStats = (st, date) => ({ storeId: st.storeId, date, byItem: Object.fromEntries(Object.entries(st.byItem || {}).map(([k, v]) => [k, { qty: v.qty }])) });
  const statDocs = (s, date, sign) => {
    const lines = s.lines || []; const byItem = {}; for (const l of lines) byItem[l.itemId] = { qty: increment(sign * l.qty), cents: increment(sign * l.totalCents) };
    const byMethod = {}; for (const p of s.payments || []) if (p.kind === 'tender') byMethod[p.method] = increment(sign * p.usd);
    return { storeId: s.storeId, salesCents: increment(sign * s.totalCents), orders: increment(sign), units: increment(sign * lines.reduce((a, l) => a + l.qty, 0)), discountCents: increment(sign * s.discountCents), byItem, byMethod };
  };
  async function voidSale(id, b) {
    const s = await read('sales', id); if (!s) throw notFound('Receipt not found.'); assertStore(s.storeId);
    const reason = txt(b.reason, 200).trim();
    if (reason.length < 3) throw bad('REASON_REQUIRED', 'Write a reason for voiding.');
    if (s.status !== 'completed') throw bad('BAD_STATUS', 'This receipt is already voided.');
    await B.asLead(s.storeId, b.manager_pin, 'A manager must approve voiding a receipt.', async (lead) => {
      const d = lead.db; const date = dateOf(s.ts); let late = null;
      await runTransaction(d, async (t) => {
        const snaps = []; for (const l of s.lines) snaps.push(await t.get(doc(d, 'stock', `${s.storeId}_${l.itemId}`)));
        s.lines.forEach((l, i) => {
          const cur = snaps[i].exists() ? snaps[i].data() : { storeId: s.storeId, itemId: l.itemId, onHand: 0 };
          t.set(doc(d, 'stock', `${s.storeId}_${l.itemId}`), { ...cur, onHand: (cur.onHand || 0) + l.qty });
          t.set(doc(collection(d, 'movements')), { storeId: s.storeId, itemId: l.itemId, qty: l.qty, bucket: 'stock', type: 'void', refType: 'sale', refId: id, userId: lead.uid, reason, ts: ts() });
        });
        t.update(doc(d, 'sales', id), { status: 'voided', voidedBy: lead.uid, voidReason: reason, voidedTs: ts() });
        t.set(doc(d, 'dailyStats', `${s.storeId}_${date}`), { ...statDocs(s, date, -1), date }, { merge: true });
        late = qtyStats(statDocs(s, date, -1), date);
        t.set(doc(d, 'monthStats', `${s.storeId}_${date.slice(0, 7)}`), { ...statDocs(s, date, -1), date: date.slice(0, 7) }, { merge: true });
        auditIn(t, s.storeId, 'sale.void', 'sale', id, { reason, approver: lead.uid }, lead.uid, d);
      });
      if (late) await setDoc(doc(d, 'itemStats', `${s.storeId}_${date}`), late, { merge: true }).catch(() => {});
    }).catch(wrap('Void failed'));
    B.invalidateStock(s.storeId);
    return getSale(id);
  }
  async function returnSale(id, b) {
    const s = await read('sales', id); if (!s) throw notFound('Receipt not found.'); assertStore(s.storeId);
    const sw = await switchesOf(s.storeId);
    const reason = txt(b.reason, 200).trim();
    if (reason.length < 3) throw bad('REASON_REQUIRED', 'Write a reason for the return.');
    if (s.status !== 'completed') throw bad('BAD_STATUS', 'This receipt cannot take returns.');
    const shift = await openShift(S().uid, s.storeId);
    if (!shift) throw new ApiErr(409, 'SHIFT_REQUIRED', 'Open your shift before taking a return.');
    const want = (b.lines || []).map((l) => ({ id: Number(l.sale_line_id), qty: Math.floor(Number(l.qty)) })).filter((l) => l.qty > 0);
    if (!want.length) throw bad('NO_LINES', 'Choose the items to return.');
    const done = await list('returns', where('storeId', '==', Number(s.storeId)), where('saleId', '==', String(id))).catch(() => []);
    // Returns are written in a manager's context, so a cashier always asks a manager to sign in.
    const needsLead = !(can('sales.return') && isLeadRole() && !sw.pin_every_return);
    const run = async (lead) => {
      const d = lead.db; const date = dateOf(s.ts); let refund = 0; const plan = []; let late = null;
      for (const w of want) {
        const l = s.lines[w.id]; if (!l) throw bad('BAD_LINE', 'This item is not on the receipt.');
        const prior = done.flatMap((r) => r.lines).filter((x) => x.lineIndex === w.id);
        const q0 = prior.reduce((a, x) => a + x.qty, 0); const r0 = prior.reduce((a, x) => a + x.refundCents, 0);
        if (w.qty > l.qty - q0) throw bad('TOO_MANY', 'More pieces than were sold.');
        const amount = w.qty === l.qty - q0 ? l.totalCents - r0 : Math.round((l.totalCents * w.qty) / l.qty);
        plan.push({ lineIndex: w.id, itemId: l.itemId, qty: w.qty, refundCents: amount }); refund += amount;
      }
      const rr = doc(collection(d, 'returns'));
      await runTransaction(d, async (t) => {
        const snaps = []; for (const p of plan) snaps.push(await t.get(doc(d, 'stock', `${s.storeId}_${p.itemId}`)));
        t.set(rr, { saleId: String(id), storeId: s.storeId, shiftId: String(shift.id), ts: ts(), requestedBy: S().uid, approvedBy: lead.uid, reason, refundMethod: b.refund_method === 'khqr' ? 'khqr' : 'cash', refundCents: refund, lines: plan });
        plan.forEach((p, i) => {
          const cur = snaps[i].exists() ? snaps[i].data() : { storeId: s.storeId, itemId: p.itemId, onHand: 0 };
          t.set(doc(d, 'stock', `${s.storeId}_${p.itemId}`), { ...cur, returned: (cur.returned || 0) + p.qty });
          t.set(doc(collection(d, 'movements')), { storeId: s.storeId, itemId: p.itemId, qty: p.qty, bucket: 'returned', type: 'return', refType: 'return', refId: rr.id, userId: lead.uid, reason, ts: ts() });
        });
        const byItem = {}; for (const p of plan) byItem[p.itemId] = { qty: increment(-p.qty), cents: increment(-p.refundCents) };
        const m = { storeId: s.storeId, salesCents: increment(-refund), units: increment(-plan.reduce((a, p) => a + p.qty, 0)), byItem };
        t.set(doc(d, 'dailyStats', `${s.storeId}_${dateOf(ts())}`), { ...m, date: dateOf(ts()) }, { merge: true });
        late = qtyStats(m, dateOf(ts()));
        t.set(doc(d, 'monthStats', `${s.storeId}_${dateOf(ts()).slice(0, 7)}`), { ...m, date: dateOf(ts()).slice(0, 7) }, { merge: true });
        auditIn(t, s.storeId, 'sale.return', 'sale', id, { refund, reason, approver: lead.uid }, lead.uid, d);
      });
      if (late) await setDoc(doc(d, 'itemStats', `${s.storeId}_${dateOf(ts())}`), late, { merge: true }).catch(() => {});
      return rr.id;
    };
    const rid = await (needsLead ? B.asLead(s.storeId, b.manager_pin, 'A manager must approve returns.', run) : run(B.ctxOfSelf())).catch(wrap('Return failed'));
    B.invalidateStock(s.storeId);
    return { ok: true, return_id: rid, sale: await getSale(id) };
  }

  // ---------- customers, rates ----------
  async function customersList(q) {
    need('customers.manage'); const t = String(q.q || '').trim().toLowerCase();
    return (await list('customers')).filter((c) => !t || String(c.name).toLowerCase().includes(t) || String(c.phone || '').includes(t)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  }
  async function customerAdd(b) {
    need('customers.manage'); if (!String(b.name || '').trim()) throw bad('BAD_INPUT', 'Enter a name.');
    const r = doc(collection(db, 'customers')); const row = { name: txt(b.name, 100).trim(), phone: b.phone ? txt(b.phone, 30) : null, note: b.note ? txt(b.note, 300) : null, createdAt: ts() };
    await setDoc(r, row); return { id: r.id, ...row };
  }
  async function rateSet(b) {
    need('rates.set'); const r = Math.floor(Number(b.khr_per_usd));
    if (!(r >= 3000 && r <= 6000)) throw bad('BAD_RATE', 'Enter riel per US dollar between 3,000 and 6,000.');
    await setDoc(ref('settings', 'rate'), { khrPerUsd: r, ts: ts(), setBy: S().uid }); B.C.rate = null;
    await audit(null, 'rate.set', 'rate', null, { khr_per_usd: r }); return { khr_per_usd: r };
  }

  // ---------- transfers ----------
  const trView = async (t) => {
    const stores = await B.loadStores(); const cat = await B.loadCatalog();
    const sv = (id) => { const s = stores.find((x) => x.id === Number(id)); return s && { id: s.id, name: s.name, code: s.code }; };
    const lines = (t.lines || []).map((l) => { const it = cat.items.find((i) => i.id === Number(l.itemId)); const d = it && cat.designs.get(String(it.designId)); const c = it && cat.colours.get(it.colourCode); return { id: l.id, item_id: l.itemId, qty_requested: l.qtyRequested, qty_sent: l.qtySent ?? null, qty_received: l.qtyReceived ?? null, sku: it?.sku, size: it?.size, name_en: d?.nameEn, name_km: d?.nameKm, photo: d?.photo, colour_en: c?.nameEn, colour_km: c?.nameKm, colour_hex: c?.hex }; });
    return { id: t.id, code: t.code, from_store_id: Number(t.fromStoreId), to_store_id: Number(t.toStoreId), status: t.status, reason: t.reason, customer_note: t.customerNote, requested_by: t.requestedBy, requested_ts: t.requestedTs, approved_by: t.approvedBy ?? null, from_store: sv(t.fromStoreId), to_store: sv(t.toStoreId), lines, pieces: lines.reduce((a, l) => a + l.qty_requested, 0), resolution: t.resolution ?? null };
  };
  const mineT = (t) => S().user.role === 'owner' || S().stores.includes(Number(t.fromStoreId)) || S().stores.includes(Number(t.toStoreId));
  const inStoreT = (id) => S().user.role === 'owner' || S().stores.includes(Number(id));
  async function loadT(id) { const t = await read('transfers', id); if (!t) throw notFound('Transfer not found.'); if (!mineT(t)) throw forbidden('You do not have access to this transfer.'); return t; }
  async function transfersList(q) {
    need('transfer.request'); const storeId = Number(q.store_id) || null;
    let rows = S().user.role === 'owner' ? await list('transfers') : (await Promise.all(S().stores.flatMap((id) => [list('transfers', where('fromStoreId', '==', id)), list('transfers', where('toStoreId', '==', id))]))).flat();
    const seen = new Set(); rows = rows.filter((r) => (seen.has(r.id) ? false : seen.add(r.id))).filter((t) => !storeId || Number(t.fromStoreId) === storeId || Number(t.toStoreId) === storeId);
    if (q.status) rows = rows.filter((t) => String(q.status).split(',').includes(t.status));
    rows.sort((a, b) => b.requestedTs - a.requestedTs);
    return Promise.all(rows.slice(0, 300).map(trView));
  }
  async function transferCreate(b) {
    need('transfer.request'); const from = Number(b.from_store_id); const to = Number(b.to_store_id);
    if (!from || !to || from === to) throw bad('BAD_STORES', 'Choose two different stores.');
    const stores = await B.loadStores();
    if (!stores.some((s) => s.id === from && s.active !== false) || !stores.some((s) => s.id === to && s.active !== false)) throw bad('BAD_STORES', 'Unknown store.');
    if (!inStoreT(from) && !inStoreT(to)) throw forbidden('You can only request transfers for your own store.');
    const cat = await B.loadCatalog();
    const ls = (b.lines || []).map((l) => ({ itemId: Number(l.item_id), qtyRequested: Math.floor(Number(l.qty)) })).filter((l) => l.itemId && l.qtyRequested > 0);
    if (!ls.length) throw bad('NO_LINES', 'Add at least one item.');
    for (const l of ls) if (!cat.items.some((i) => i.id === l.itemId)) throw bad('BAD_ITEM', 'Unknown item.');
    const n = await nextIds('transfer', 1);
    const r = ref('transfers', n);
    await setDoc(r, { id: n, code: `TR-${String(n).padStart(5, '0')}`, fromStoreId: from, toStoreId: to, status: 'requested', reason: txt(b.reason, 300), customerNote: txt(b.customer_note, 300), requestedBy: S().uid, requestedTs: ts(), lines: ls.map((l, i) => ({ id: i + 1, ...l, qtySent: null, qtyReceived: null })) });
    await audit(to, 'transfer.request', 'transfer', n, { from, to, pieces: ls.reduce((a, l) => a + l.qtyRequested, 0) });
    return trView(await read('transfers', n));
  }
  async function transferApprove(id) {
    const t = await loadT(id); need('transfer.approve');
    if (!inStoreT(t.fromStoreId)) throw forbidden('Only the sending store manager or an owner can approve.');
    if (t.requestedBy === S().uid) throw forbidden('You cannot approve your own request.');
    if (t.status !== 'requested') throw bad('BAD_STATUS', 'This request is not waiting for approval.');
    const sw = await switchesOf(t.fromStoreId); const pieces = t.lines.reduce((a, l) => a + l.qtyRequested, 0);
    const needsOwner = sw.owner_approval_large_transfer && pieces >= sw.large_transfer_pieces && S().user.role !== 'owner';
    await runTransaction(db, async (x) => {
      const snaps = []; for (const l of t.lines) snaps.push(await x.get(ref('stock', `${t.fromStoreId}_${l.itemId}`)));
      t.lines.forEach((l, i) => {
        const cur = snaps[i].exists() ? snaps[i].data() : { storeId: Number(t.fromStoreId), itemId: l.itemId, onHand: 0, reserved: 0 };
        const q = B.quant(cur);
        if (q.available < l.qtyRequested) { const sku = ''; throw bad('NOT_ENOUGH', `Not enough stock. Available: ${Math.max(0, q.available)}.${sku}`); }
        x.set(ref('stock', `${t.fromStoreId}_${l.itemId}`), { ...cur, reserved: (cur.reserved || 0) + l.qtyRequested });
      });
      x.update(ref('transfers', id), { status: needsOwner ? 'awaiting_owner' : 'approved', approvedBy: S().uid, approvedTs: ts() });
      auditIn(x, t.fromStoreId, 'transfer.approve', 'transfer', id, { needsOwner });
    }).catch(wrap('Approve failed'));
    B.invalidateStock();
    return trView(await read('transfers', id));
  }
  async function transferOwnerApprove(id) {
    const t = await loadT(id);
    if (S().user.role !== 'owner') throw forbidden('Only an owner can do this.'); need('transfer.approve');
    if (t.requestedBy === S().uid) throw forbidden('You cannot approve your own request.');
    if (t.status !== 'awaiting_owner') throw bad('BAD_STATUS', 'This transfer is not waiting for an owner.');
    await updateDoc(ref('transfers', id), { status: 'approved', ownerApprovedBy: S().uid, ownerApprovedTs: ts() });
    await audit(Number(t.fromStoreId), 'transfer.owner_approve', 'transfer', id); return trView(await read('transfers', id));
  }
  async function releaseReserved(x, t) {
    const snaps = []; for (const l of t.lines) snaps.push(await x.get(ref('stock', `${t.fromStoreId}_${l.itemId}`)));
    t.lines.forEach((l, i) => { if (snaps[i].exists()) { const cur = snaps[i].data(); x.set(ref('stock', `${t.fromStoreId}_${l.itemId}`), { ...cur, reserved: Math.max(0, (cur.reserved || 0) - l.qtyRequested) }); } });
  }
  async function transferReject(id, b) {
    const t = await loadT(id); need('transfer.approve');
    if (!inStoreT(t.fromStoreId)) throw forbidden('Only the sending store manager or an owner can approve.');
    if (t.requestedBy === S().uid) throw forbidden('You cannot approve your own request.');
    const reason = txt(b.reason, 200).trim(); if (reason.length < 3) throw bad('REASON_REQUIRED', 'Write a short reason.');
    if (!['requested', 'awaiting_owner'].includes(t.status)) throw bad('BAD_STATUS', 'This request cannot be rejected now.');
    await runTransaction(db, async (x) => { if (t.status === 'awaiting_owner') await releaseReserved(x, t); x.update(ref('transfers', id), { status: 'rejected', rejectReason: reason }); auditIn(x, t.fromStoreId, 'transfer.reject', 'transfer', id, { reason }); });
    B.invalidateStock(); return trView(await read('transfers', id));
  }
  async function transferCancel(id) {
    const t = await loadT(id);
    const allowed = t.requestedBy === S().uid || t.approvedBy === S().uid || S().user.role === 'owner' || (can('transfer.approve') && inStoreT(t.fromStoreId));
    if (!allowed) throw forbidden();
    if (!['requested', 'awaiting_owner', 'approved'].includes(t.status)) throw bad('BAD_STATUS', 'This transfer can no longer be cancelled.');
    await runTransaction(db, async (x) => { if (t.status !== 'requested') await releaseReserved(x, t); x.update(ref('transfers', id), { status: 'cancelled' }); auditIn(x, t.fromStoreId, 'transfer.cancel', 'transfer', id); }).catch(wrap('Cancel failed'));
    B.invalidateStock(); return trView(await read('transfers', id));
  }
  async function transferSend(id, b) {
    const t = await loadT(id); need('transfer.send');
    if (!inStoreT(t.fromStoreId)) throw forbidden('Only the sending store can send.');
    if (t.status !== 'approved') throw bad('BAD_STATUS', 'This transfer is not approved.');
    const given = new Map(((b || {}).lines || []).map((l) => [Number(l.line_id), Math.floor(Number(l.qty_sent))]));
    let total = 0;
    await runTransaction(db, async (x) => {
      const snaps = []; for (const l of t.lines) snaps.push(await x.get(ref('stock', `${t.fromStoreId}_${l.itemId}`)));
      const lines = t.lines.map((l, i) => {
        const q = given.has(l.id) ? given.get(l.id) : l.qtyRequested;
        if (!(q >= 0) || q > l.qtyRequested) throw bad('BAD_QTY', 'A quantity is not valid.');
        const cur = snaps[i].exists() ? snaps[i].data() : { onHand: 0 };
        if ((cur.onHand || 0) < q) throw bad('NOT_ENOUGH', 'Not enough stock to send.');
        x.set(ref('stock', `${t.fromStoreId}_${l.itemId}`), { ...cur, storeId: Number(t.fromStoreId), itemId: l.itemId, onHand: cur.onHand - q, reserved: Math.max(0, (cur.reserved || 0) - l.qtyRequested) });
        if (q > 0) x.set(doc(collection(db, 'movements')), { storeId: Number(t.fromStoreId), itemId: l.itemId, qty: -q, bucket: 'stock', type: 'transfer_out', refType: 'transfer', refId: String(id), userId: S().uid, ts: ts() });
        total += q; return { ...l, qtySent: q };
      });
      if (total === 0) throw bad('NOTHING_SENT', 'Send at least one piece.');
      x.update(ref('transfers', id), { status: 'in_transit', sentBy: S().uid, sentTs: ts(), lines });
      auditIn(x, t.fromStoreId, 'transfer.send', 'transfer', id, { pieces: total });
    }).catch(wrap('Send failed'));
    B.invalidateStock(); return trView(await read('transfers', id));
  }
  async function transferReceive(id, b) {
    const t = await loadT(id); need('transfer.receive');
    if (!inStoreT(t.toStoreId)) throw forbidden('Only the receiving store can receive.');
    if (t.status !== 'in_transit') throw bad('BAD_STATUS', 'This transfer is not in transit.');
    const given = new Map(((b || {}).lines || []).map((l) => [Number(l.line_id), Math.floor(Number(l.qty_received))]));
    let diff = false;
    await runTransaction(db, async (x) => {
      const snaps = []; for (const l of t.lines) snaps.push(await x.get(ref('stock', `${t.toStoreId}_${l.itemId}`)));
      const lines = t.lines.map((l, i) => {
        const q = given.has(l.id) ? given.get(l.id) : l.qtySent;
        if (!(q >= 0) || q > (l.qtySent || 0)) throw bad('BAD_QTY', 'Received quantity is not valid.');
        const cur = snaps[i].exists() ? snaps[i].data() : { storeId: Number(t.toStoreId), itemId: l.itemId, onHand: 0, reserved: 0, returned: 0, damaged: 0 };
        if (q > 0) { x.set(ref('stock', `${t.toStoreId}_${l.itemId}`), { ...cur, onHand: (cur.onHand || 0) + q }); x.set(doc(collection(db, 'movements')), { storeId: Number(t.toStoreId), itemId: l.itemId, qty: q, bucket: 'stock', type: 'transfer_in', refType: 'transfer', refId: String(id), userId: S().uid, ts: ts() }); }
        if (q !== (l.qtySent || 0)) diff = true; return { ...l, qtyReceived: q };
      });
      x.update(ref('transfers', id), { status: diff ? 'discrepancy' : 'received', receivedBy: S().uid, receivedTs: ts(), lines });
      auditIn(x, t.toStoreId, 'transfer.receive', 'transfer', id, { discrepancy: diff });
    }).catch(wrap('Receive failed'));
    B.invalidateStock(); return trView(await read('transfers', id));
  }
  async function transferResolve(id, b) {
    const t = await loadT(id); need('transfer.resolve');
    if (!['found', 'lost'].includes(b.resolution)) throw bad('BAD_INPUT', 'Choose found or lost.');
    if (String(b.note || '').trim().length < 3) throw bad('REASON_REQUIRED', 'Write a short note.');
    if (t.status !== 'discrepancy') throw bad('BAD_STATUS', 'This transfer has no difference to resolve.');
    await runTransaction(db, async (x) => {
      if (b.resolution === 'found') {
        const snaps = []; for (const l of t.lines) snaps.push(await x.get(ref('stock', `${t.toStoreId}_${l.itemId}`)));
        t.lines.forEach((l, i) => { const d = (l.qtySent || 0) - (l.qtyReceived || 0); if (d > 0) { const cur = snaps[i].exists() ? snaps[i].data() : { storeId: Number(t.toStoreId), itemId: l.itemId, onHand: 0 }; x.set(ref('stock', `${t.toStoreId}_${l.itemId}`), { ...cur, onHand: (cur.onHand || 0) + d }); x.set(doc(collection(db, 'movements')), { storeId: Number(t.toStoreId), itemId: l.itemId, qty: d, bucket: 'stock', type: 'transfer_found', refType: 'transfer', refId: String(id), userId: S().uid, reason: b.note, ts: ts() }); } });
      }
      x.update(ref('transfers', id), { status: 'resolved', resolution: b.resolution, resolutionNote: b.note, resolvedBy: S().uid, resolvedTs: ts() });
      auditIn(x, t.toStoreId, 'transfer.resolve', 'transfer', id, { resolution: b.resolution, note: b.note });
    }).catch(wrap('Resolve failed'));
    B.invalidateStock(); return trView(await read('transfers', id));
  }

  // ---------- owner / admin ----------
  async function adminStores() {
    need('settings.manage'); const stores = await B.loadStores(true); const brands = (await B.loadCatalog()).brandsList;
    return { stores: stores.map((s) => ({ id: s.id, code: s.code, name: s.name, kind: s.kind === 'warehouse' ? 'warehouse' : 'shop', brand_id: s.brandId, receipt_footer: s.receiptFooter || '', active: s.active === false ? 0 : 1, brand_code: brands.find((b) => String(b.id) === String(s.brandId))?.code, brand_name: brands.find((b) => String(b.id) === String(s.brandId))?.name, switches: s.switches })), defaults: SWITCH_DEFAULTS };
  }
  async function adminStoreCreate(b) {
    need('settings.manage');
    const warehouse = b.kind === 'warehouse';
    const name = txt(b.name, 80).trim(); const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (!name || code.length < 2) throw bad('BAD_INPUT', `Enter a ${warehouse ? 'warehouse' : 'store'} name and a short code (2 to 4 letters or numbers).`);
    const stores = await B.loadStores(true); const cat = await B.loadCatalog();
    const brand = warehouse ? null : cat.brandsList.find((x) => Number(x.id) === Number(b.brand_id));
    if (!warehouse && !brand) throw bad('BAD_INPUT', 'Choose a brand.');
    if (stores.some((x) => x.code === code)) throw bad('DUPLICATE', 'This code is already used by another store or warehouse.');
    const id = Math.max(0, ...stores.map((x) => x.id)) + 1;
    const wb = writeBatch(db);
    if (warehouse) wb.set(ref('stores', id), { id, code, name, kind: 'warehouse', brandId: null, receiptFooter: '', active: true, switches: { ...SWITCH_DEFAULTS } });
    else { wb.set(ref('stores', id), { id, code, name, brandId: Number(brand.id), receiptFooter: 'Thank you.', active: true, switches: { ...SWITCH_DEFAULTS } }); wb.set(ref('publicStores', id), { id, code, name, active: true, brandCode: brand.code }); }
    auditIn(wb, id, warehouse ? 'warehouse.create' : 'store.create', 'store', id, { name, code });
    await wb.commit().catch(wrap(`Could not add the ${warehouse ? 'warehouse' : 'store'}`));
    await B.loadStores(true); await B.startSession();
    return { id };
  }
  // ---------- safe deletes: only when there is no history ----------
  const noHistory = (what) => bad('HAS_HISTORY', `${what} Turn it off instead, so old receipts and reports stay correct.`);
  async function adminStoreDelete(id) {
    need('settings.manage'); const st = await storeById(id); if (!st) throw notFound();
    const n = Number(id); const stores = await B.loadStores();
    if (st.kind !== 'warehouse' && stores.filter((x) => x.kind !== 'warehouse').length <= 1) throw bad('LAST_STORE', 'You cannot delete your only store.');
    const used = [await list('sales', where('storeId', '==', n)), await list('shifts', where('storeId', '==', n)), await list('movements', where('storeId', '==', n)), await list('stock', where('storeId', '==', n)),
      await list('transfers', where('fromStoreId', '==', n)), await list('transfers', where('toStoreId', '==', n)), await list('expenses', where('storeId', '==', n)), await list('attendance', where('storeId', '==', n))];
    const staff = (await list('users')).filter((u) => (u.storeIds || []).map(Number).includes(n));
    if (used.some((x) => x.length) || staff.length) throw noHistory(staff.length && !used.some((x) => x.length) ? 'People are still assigned to this store (remove them from it first).' : 'This store already has sales, stock, transfers, shifts or other records.');
    const wb = writeBatch(db); wb.delete(ref('stores', n)); wb.delete(ref('publicStores', n)); auditIn(wb, null, 'store.delete', 'store', n, { name: st.name, code: st.code });
    await wb.commit().catch(wrap('Could not delete the store')); await B.loadStores(true); await B.startSession(); return { ok: true };
  }
  async function designDelete(id) {
    need('catalog.edit'); const cat = await B.loadCatalog(true); const d = cat.designs.get(String(id)); if (!d) throw notFound('Design not found.');
    const items = cat.items.filter((i) => Number(i.designId) === Number(id)); const itemIds = new Set(items.map((i) => i.id));
    const stockRows = await list('stock'); if (stockRows.some((r) => itemIds.has(Number(r.itemId)))) throw noHistory('This design has stock records.');
    for (let i = 0; i < items.length; i += 10) { if ((await list('movements', where('itemId', 'in', items.slice(i, i + 10).map((x) => x.id)))).length) throw noHistory('This design has sales or stock movements.'); }
    if ((await list('transfers')).some((t) => (t.lines || []).some((l) => itemIds.has(Number(l.itemId))))) throw noHistory('This design is used in a transfer.');
    const wb = writeBatch(db); items.forEach((i) => wb.delete(ref('items', i.id))); wb.delete(ref('costs', id)); wb.delete(ref('designs', id));
    auditIn(wb, null, 'design.delete', 'design', id, { name: d.nameEn, variants: items.length }); await wb.commit().catch(wrap('Could not delete the design')); await B.loadCatalog(true); return { ok: true };
  }
  async function customerDelete(id) {
    need('settings.manage'); const c = await read('customers', id); if (!c) throw notFound();
    if ((await list('sales', where('customerId', '==', String(id)))).length) throw noHistory('This customer has purchases.');
    const wb = writeBatch(db); wb.delete(ref('customers', id)); auditIn(wb, null, 'customer.delete', 'customer', id, { name: c.name }); await wb.commit().catch(wrap('Could not delete')); return { ok: true };
  }
  async function adminStoreUpdate(id, b) {
    need('settings.manage'); const s = await storeById(id); if (!s) throw notFound();
    const sw = { ...s.switches }; const changed = {};
    for (const [k, v] of Object.entries(b.switches || {})) {
      if (!(k in SWITCH_DEFAULTS)) throw bad('UNKNOWN_SWITCH', 'Unknown setting.');
      const nv = typeof SWITCH_DEFAULTS[k] === 'boolean' ? !!v : Math.max(0, Math.floor(Number(v) || 0));
      if (sw[k] !== nv) changed[k] = { from: sw[k], to: nv }; sw[k] = nv;
    }
    const nm = txt(b.name ?? s.name, 80); const act = b.active == null ? s.active !== false : !!b.active;
    const wb = writeBatch(db);
    wb.update(ref('stores', id), { name: nm, receiptFooter: txt(b.receipt_footer ?? s.receiptFooter ?? '', 200), active: act, switches: sw });
    if (s.kind !== 'warehouse') wb.set(ref('publicStores', id), { id: Number(id), code: s.code, name: nm, active: act, brandCode: (await B.loadCatalog()).brandsList.find((x) => String(x.id) === String(s.brandId))?.code || null });
    await wb.commit();
    await audit(Number(id), 'store.update', 'store', id, { name: b.name, switches: changed }); await B.loadStores(true); await B.startSession(); return { ok: true };
  }
  const userView = (u) => ({ is_super: !!S().superUid && u.id === S().superUid, id: u.id, name: u.name, email: u.email || null, role: u.role, active: u.active === true, lang: u.lang || 'en', demo: !!u.demo, perms: u.perms || {}, store_ids: (u.storeIds || []).map(Number), has_pin: !!u.hasPin, has_password: !!u.email, salary_usd: (u.salaryCents || 0) / 100 });
  async function adminUsers() { need('users.manage'); const rows = await list('users'); return { users: rows.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name)).map(userView), all_perms: Object.keys(ROLE_PERMS).length ? [...new Set(Object.values(ROLE_PERMS).flat())] : [], role_perms: ROLE_PERMS }; }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'staff';
  async function adminUserCreate(b) {
    need('users.manage');
    if (b.role === 'owner' && !S().isSuper) throw forbidden('Only the super admin can add an owner.');
    if (!String(b.name || '').trim()) throw bad('BAD_INPUT', 'Enter a name.');
    if (!['owner', 'manager', 'cashier', 'shareholder'].includes(b.role)) throw bad('BAD_INPUT', 'Choose a role.');
    const storeIds = (b.store_ids || []).map(Number);
    if (!['owner', 'shareholder'].includes(b.role) && !storeIds.length) throw bad('BAD_INPUT', 'Choose at least one store.');
    if (b.role !== 'cashier' && (!b.email || !b.password || String(b.password).length < 8)) throw bad('BAD_INPUT', 'Managers and owners need an email and a password of at least 8 characters.');
    if (b.pin && !/^\d{4,6}$/.test(String(b.pin))) throw bad('BAD_PIN', 'PIN must be 4 to 6 digits.');
    if (b.role === 'cashier' && !b.pin) throw bad('BAD_PIN', 'Cashiers need a PIN.');
    const stores = await B.loadStores();
    let email; let password;
    if (b.role === 'cashier') { const first = stores.find((s) => s.id === storeIds[0]); email = `${slug(b.name)}.${Math.random().toString(36).slice(2, 8)}@till.angkor.app`; password = tillPassword(String(b.pin), first.code); }
    else { email = String(b.email).trim().toLowerCase(); password = b.password; }
    let uid;
    try { uid = await secondary.createUser(email, password); } catch (e) { throw bad('DUPLICATE', 'This email is already used.'); }
    const row = { name: txt(b.name, 80).trim(), email: b.role === 'cashier' ? null : email, role: b.role, storeIds: ['owner', 'shareholder'].includes(b.role) ? [] : storeIds, active: true, lang: b.lang === 'km' ? 'km' : 'en', perms: b.perms || {}, createdAt: ts(), hasPin: !!b.pin, salaryCents: Math.max(0, Math.round(Number(b.salary_usd || 0) * 100)) };
    const batch = writeBatch(db);
    batch.set(ref('users', uid), row);
    batch.set(ref('staffDirectory', uid), { name: row.name, role: row.role, storeIds: row.storeIds, active: true, authEmail: b.role === 'cashier' ? email : null, ...(b.role === 'cashier' ? { pinLength: String(b.pin).length } : {}) });
    auditIn(batch, null, 'user.create', 'user', uid, { role: b.role, name: b.name });
    await batch.commit(); return { id: uid };
  }
  async function adminUserUpdate(id, b) {
    need('users.manage'); const u = await read('users', id); if (!u) throw notFound();
    const role = b.role || u.role; const active = b.active == null ? u.active : !!b.active;
    if (id === S().superUid && (role !== 'owner' || !active)) throw forbidden('The super admin cannot be switched off or changed to another role.');
    if (id === S().superUid && !S().isSuper) throw forbidden('Only the super admin can change the super admin.');
    if (!S().isSuper && id !== S().uid && u.role === 'owner') throw forbidden('Only the super admin can change an owner.');
    if (!S().isSuper && role === 'owner' && u.role !== 'owner') throw forbidden('Only the super admin can make someone an owner.');
    if (!S().isSuper && id === S().uid && (role !== u.role || active !== u.active)) throw forbidden('You cannot change your own role.');
    if (u.role === 'owner' && (role !== 'owner' || !active)) { const others = (await list('users')).filter((x) => x.role === 'owner' && x.active === true && x.id !== id); if (others.length < 1) throw bad('LAST_OWNER', 'There must always be at least one active owner.'); }
    if (b.password || b.pin) throw bad('USE_RESET', 'Changing a password or PIN is done by the person under My account, or by deleting and re-adding the account.');
    const storeIds = b.store_ids ? b.store_ids.map(Number) : (u.storeIds || []);
    const batch = writeBatch(db);
    batch.update(ref('users', id), { name: txt(b.name ?? u.name, 80).trim(), role, active, perms: b.perms ?? u.perms ?? {}, lang: b.lang ?? u.lang ?? 'en', storeIds: ['owner', 'shareholder'].includes(role) ? [] : storeIds, salaryCents: b.salary_usd == null ? (u.salaryCents || 0) : Math.max(0, Math.round(Number(b.salary_usd) * 100)) });
    const dir = await read('staffDirectory', id);
    const pl = Math.floor(Number(b.pin_length)); const plOk = role === 'cashier' && pl >= 4 && pl <= 6;
    if (dir) batch.update(ref('staffDirectory', id), { name: txt(b.name ?? u.name, 80).trim(), role, active, storeIds: ['owner', 'shareholder'].includes(role) ? [] : storeIds, ...(plOk ? { pinLength: pl } : {}) });
    auditIn(batch, null, 'user.update', 'user', id, { role, active }); await batch.commit(); return { ok: true };
  }
  async function adminUserDelete(id) {
    need('users.manage'); const u = await read('users', id); if (!u) throw notFound();
    if (id === S().uid) throw bad('SELF', 'You cannot delete your own account.');
    if (id === S().superUid) throw forbidden('The super admin cannot be deleted.');
    if (u.role === 'owner' && !S().isSuper) throw forbidden('Only the super admin can delete an owner.');
    if (u.role === 'owner') { const others = (await list('users')).filter((x) => x.role === 'owner' && x.active === true && x.id !== id); if (others.length < 1) throw bad('LAST_OWNER', 'There must always be at least one active owner.'); }
    const stores = await B.loadStores(); let used = false;
    for (const st of stores) {
      if ((await list('sales', where('storeId', '==', st.id), where('cashierId', '==', id))).length) used = true;
      if ((await list('shifts', where('storeId', '==', st.id), where('userId', '==', id))).length) used = true;
    }
    if (!used && (await list('movements', where('userId', '==', id))).length) used = true;
    if (used) throw bad('HAS_HISTORY', 'This person has sales, shifts or stock records. Turn them off (untick Active) instead of deleting, so the history stays correct.');
    const wb = writeBatch(db);
    wb.delete(ref('users', id)); wb.delete(ref('staffDirectory', id));
    auditIn(wb, null, 'user.delete', 'user', id, { name: u.name, role: u.role });
    await wb.commit().catch(wrap('Delete failed'));
    return { ok: true };
  }
  async function auditList(q) {
    need('audit.view'); const rows = (await list('auditLog')).sort((a, b) => b.ts - a.ts).slice(0, Math.min(Number(q.limit) || 100, 300));
    const users = new Map((S().user.role === 'owner' ? await list('users') : []).map((u) => [u.id, u.name]));
    return rows.map((r) => ({ id: r.id, ts: r.ts, user_id: r.userId, user_name: users.get(r.userId) || (r.userId === S().uid ? S().user.name : String(r.userId).slice(0, 6)), store_id: r.storeId, action: r.action, entity: r.entity, entity_id: r.entityId, detail: r.details ? JSON.stringify(r.details) : null }));
  }

  // ---------- dashboard ----------
  const dstr = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  function periodRange(q) {
    const t = dateOf(ts()); let from; let to;
    switch (q.period) { case '7d': to = t; from = dstr(t, -6); break; case 'month': from = `${t.slice(0, 7)}-01`; to = t; break; case 'year': from = `${t.slice(0, 4)}-01-01`; to = t; break; case 'custom': from = q.from || t; to = q.to || t; break; default: from = t; to = t; }
    return { from, to };
  }
  async function dashboard(q) {
    need('dashboard.view');
    const stores = await B.loadStores(); let ids;
    const sel = String(q.store || 'all');
    if (sel === 'all') ids = (can('dashboard.all_stores') ? stores.filter((s) => s.active !== false).map((s) => s.id) : S().stores).filter((i) => stores.find((s) => s.id === i)?.kind !== 'warehouse'); else ids = sel.split(',').map((x) => assertStore(x));
    if (!ids.length) throw bad('NO_STORES', 'No store selected.');
    const pr = periodRange(q); const seeCost = can('cost.view'); const costs = seeCost ? await B.loadCosts() : new Map(); const cat = await B.loadCatalog();
    const useMonths = q.period === 'year';
    const keys = [];
    if (useMonths) { for (let m = Number(pr.from.slice(5, 7)); m <= Number(pr.to.slice(5, 7)); m++) for (const id of ids) keys.push(['monthStats', `${id}_${pr.from.slice(0, 4)}-${String(m).padStart(2, '0')}`]); }
    else { for (let d = pr.from; d <= pr.to; d = dstr(d, 1)) for (const id of ids) keys.push(['dailyStats', `${id}_${d}`]); }
    const docs = (await Promise.all(keys.map(([c, k]) => read(c, k).catch(() => null)))).filter(Boolean);
    const expRows = can('expenses.manage') ? await X.expensesFor(ids, pr.from, pr.to) : null;
    const stockRows = await B.stockOfAll();
    const by = ids.map((id) => {
      const st = stores.find((s) => s.id === id); const mine = docs.filter((d) => Number(d.storeId) === id);
      const sum = (k) => mine.reduce((a, d) => a + (d[k] || 0), 0);
      const items = {}; for (const d of mine) for (const [iid, v] of Object.entries(d.byItem || {})) { items[iid] = items[iid] || { qty: 0, cents: 0 }; items[iid].qty += v.qty || 0; items[iid].cents += v.cents || 0; }
      const cogs = Object.entries(items).reduce((a, [iid, v]) => { const it = cat.items.find((i) => i.id === Number(iid)); return a + v.qty * (costs.get(String(it?.designId)) ?? 0); }, 0);
      const stk = stockRows.filter((r) => Number(r.storeId) === id);
      const pieces = stk.reduce((a, r) => a + (r.onHand || 0), 0);
      const val = stk.reduce((a, r) => { const it = cat.items.find((i) => i.id === Number(r.itemId)); return a + (r.onHand || 0) * (costs.get(String(it?.designId)) ?? 0); }, 0);
      const low = stk.filter((r) => { const it = cat.items.find((i) => i.id === Number(r.itemId)); return it && it.active !== false && (r.onHand || 0) <= (it.lowStock ?? 2); });
      const o = { store_id: id, name: st.name, code: st.code, sales_cents: sum('salesCents'), orders: sum('orders'), units: sum('units'), discount_cents: sum('discountCents'), low_stock: low.length, pieces, _items: items, _low: low };
      if (expRows) o.expenses_cents = expRows.filter((e) => Number(e.storeId) === id).reduce((a, e) => a + e.amountCents, 0);
      if (seeCost) { o.gross_profit_cents = o.sales_cents - cogs; o.stock_value_cents = val; if (expRows) o.net_profit_cents = o.gross_profit_cents - o.expenses_cents; }
      return o;
    });
    const total = (k) => by.reduce((a, s) => a + (s[k] || 0), 0); const orders = total('orders');
    const cards = { sales_cents: total('sales_cents'), orders, avg_basket_cents: orders ? Math.round(total('sales_cents') / orders) : 0, units: total('units'), discount_cents: total('discount_cents'), low_stock: total('low_stock'), pieces: total('pieces') };
    if (expRows) cards.expenses_cents = total('expenses_cents');
    if (seeCost) { cards.gross_profit_cents = total('gross_profit_cents'); cards.stock_value_cents = total('stock_value_cents'); if (expRows) cards.net_profit_cents = total('net_profit_cents'); }
    const trendMap = new Map(); for (const d of docs) { const k = d.date; const v = trendMap.get(k) || { day: k, cents: 0, n: 0 }; v.cents += d.salesCents || 0; v.n += d.orders || 0; trendMap.set(k, v); }
    const trend = [...trendMap.values()].sort((a, b) => a.day.localeCompare(b.day)).map((t) => ({ ...t, day: t.day.length === 7 ? `${t.day}-01` : t.day }));
    const topMap = new Map(); for (const s of by) for (const [iid, v] of Object.entries(s._items)) { const x = topMap.get(iid) || { qty: 0, cents: 0 }; x.qty += v.qty; x.cents += v.cents; topMap.set(iid, x); }
    const top_items = [...topMap.entries()].filter(([, v]) => v.qty > 0).sort((a, b) => b[1].qty - a[1].qty).slice(0, 8).map(([iid, v]) => { const it = cat.items.find((i) => i.id === Number(iid)); const d = it && cat.designs.get(String(it.designId)); return { sku: it?.sku, name_en: d?.nameEn, name_km: d?.nameKm, qty: v.qty, cents: v.cents }; });
    const mm = new Map(); for (const d of docs) for (const [m, c] of Object.entries(d.byMethod || {})) mm.set(m, (mm.get(m) || 0) + c);
    const methods = [...mm.entries()].map(([method, cents]) => ({ method, cents }));
    const alerts = [];
    const trs = S().user.role === 'owner' ? (await list('transfers')).filter((t) => ids.includes(Number(t.fromStoreId)) || ids.includes(Number(t.toStoreId))) : [...new Map((await Promise.all(ids.flatMap((id) => [list('transfers', where('fromStoreId', '==', id)), list('transfers', where('toStoreId', '==', id))]))).flat().map((t) => [t.id, t])).values()];
    for (const t of trs) { if (t.status === 'discrepancy') alerts.push({ kind: 'transfer_discrepancy', store_id: Number(t.toStoreId), text: t.code, ref: t.id }); if (['requested', 'awaiting_owner'].includes(t.status) && t.requestedTs < ts() - 86400000) alerts.push({ kind: 'transfer_waiting', store_id: Number(t.fromStoreId), text: t.code, ref: t.id }); }
    for (const s of by) for (const r of s._low.slice(0, 8)) { const it = cat.items.find((i) => i.id === Number(r.itemId)); alerts.push({ kind: 'low_stock', store_id: s.store_id, text: `${it?.sku}: ${Math.max(0, r.onHand || 0)}` }); }
    const trc = {}; for (const t of trs) if (['requested', 'awaiting_owner', 'approved', 'in_transit', 'discrepancy'].includes(t.status)) trc[t.status] = (trc[t.status] || 0) + 1;
    return { scope: { store_ids: ids, all: sel === 'all', stores: ids.map((id) => { const s = stores.find((x) => x.id === id); return { id, name: s.name, code: s.code }; }) }, period: pr, cards, by_store: by.map(({ _items, _low, ...o }) => o), trend, top_items, methods, alerts, transfers: trc, note: 'Gross profit is sales minus cost of goods at today\'s cost. Net profit also subtracts the expenses you recorded (including salaries once you press Record in Payroll).' };
  }

  // ---------- first-time setup ----------
  const BRANDS = [['AF', 'Angkor Formal'], ['BO', 'Business Outfits'], ['AT', 'អាវធំ Cambodia']];
  const STORES = [['AF', 'Angkor Formal', 'AF', 'Thank you for choosing Angkor Formal.'], ['BW', 'Business Outfits (Wat Koh)', 'BO', 'Thank you.'], ['B5', 'Business Outfits (598)', 'BO', 'Thank you.'], ['AC', 'អាវធំ Cambodia', 'AT', 'សូមអរគុណ។']];
  const TYPES = [['S', 'Suit', 'ឈុតអាវសូត'], ['B', 'Blazer', 'អាវធំ'], ['T', 'Trousers', 'ខោ'], ['H', 'Shirt', 'អាវ'], ['A', 'Accessory', 'គ្រឿងបន្ថែម']];
  const COLOURS = [['BLK', 'Black', 'ខ្មៅ', '#1b1917'], ['NVY', 'Navy', 'ខៀវចាស់', '#1f2a44'], ['CHA', 'Charcoal', 'ប្រផេះចាស់', '#3b3f46'], ['GRY', 'Grey', 'ប្រផេះ', '#8a8d91'], ['BRN', 'Brown', 'ត្នោត', '#5b4636'], ['BEI', 'Beige', 'ក្រែម', '#d8c7a8'], ['WHT', 'White', 'ស', '#f5f3ee']];
  async function seedData(uid) {
    const w = writeBatch(db);
    BRANDS.forEach(([code, nm], i) => w.set(ref('brands', i + 1), { id: i + 1, code, name: nm }));
    TYPES.forEach(([code, en, km]) => w.set(ref('types', code), { code, nameEn: en, nameKm: km }));
    COLOURS.forEach(([code, en, km, hex]) => w.set(ref('colours', code), { code, nameEn: en, nameKm: km, hex }));
    STORES.forEach(([code, nm, bc, foot], i) => {
      const id = i + 1; const brandId = BRANDS.findIndex((x) => x[0] === bc) + 1;
      w.set(ref('stores', id), { id, code, name: nm, brandId, receiptFooter: foot, active: true, switches: { ...SWITCH_DEFAULTS } });
      w.set(ref('publicStores', id), { id, code, name: nm, active: true, brandCode: bc });
    });
    w.set(ref('settings', 'rate'), { khrPerUsd: 4000, ts: ts(), setBy: uid });
    w.set(ref('meta', 'ids'), { design: 0, item: 0, transfer: 0 });
    auditIn(w, null, 'setup.create', 'user', uid, null, uid);
    await w.commit();
  }
  async function setupSeed() {
    need('settings.manage');
    if ((await list('stores')).length) throw bad('ALREADY_SETUP', 'Stores already exist.');
    await seedData(S().uid).catch(wrap('Setup failed'));
    B.clearCaches(); await B.startSession(); return { ok: true };
  }
  async function setupCreate(b) {
    if ((await getDoc(ref('setup', 'state'))).exists()) throw bad('ALREADY_SETUP', 'This system is already set up. Sign in instead.');
    const name = String(b.name || '').trim(); const email = String(b.email || '').trim().toLowerCase();
    if (!name || !email || String(b.password || '').length < 8) throw bad('BAD_INPUT', 'Enter your name, email and a password of at least 8 characters.');
    let uid;
    try { uid = await auth.createAndSignIn(email, b.password); } catch { throw bad('BAD_INPUT', 'Could not create this account. The email may already be used.'); }
    const first = writeBatch(db);
    first.set(ref('setup', 'state'), { firstOwner: uid, ts: ts() });
    first.set(ref('users', uid), { name, email, role: 'owner', storeIds: [], active: true, lang: 'en', perms: {}, createdAt: ts(), hasPin: false });
    await first.commit().catch(wrap('Setup failed'));
    await seedData(uid).catch(wrap('Setup failed'));
    B.clearCaches();
    await B.startSession();
    return { ok: true };
  }

  // ---------- monthly stock count ----------
  async function stocktakeSave(b) {
    need('stock.adjust'); const storeId = assertStore(b.store_id);
    const lines = (b.lines || []).map((l) => ({ itemId: Number(l.item_id), counted: Math.floor(Number(l.counted)) })).filter((l) => l.itemId && l.counted >= 0);
    if (!lines.length) throw bad('NO_LINES', 'Enter at least one counted item.');
    const sm = await B.stockOfStore(storeId); const rows = new Map((await B.itemRows('', 3000)).map((r) => [r.id, r]));
    const done = new Set(lines.map((l) => l.itemId));
    // Anything the system expects in the shop but was not counted counts as zero found.
    for (const [id, st] of sm) if (!done.has(Number(id)) && (st.onHand || 0) > 0 && b.not_counted_is_zero) lines.push({ itemId: Number(id), counted: 0 });
    let missing = 0; let extra = 0;
    const out = lines.map((l) => { const exp = Math.max(0, B.quant(sm.get(l.itemId)).on_hand); const diff = l.counted - exp; if (diff < 0) missing -= diff; else extra += diff; return { itemId: l.itemId, sku: rows.get(l.itemId)?.sku || String(l.itemId), expected: exp, counted: l.counted, diff }; });
    const ref2 = doc(collection(db, 'stocktakes')); const applied = !!b.apply;
    await setDoc(ref2, { storeId, ts: ts(), date: dateOf(ts()), by: S().uid, byName: S().user.name, lines: out, missing, extra, applied, createdBy: S().uid, note: txt(b.note, 200) });
    await audit(storeId, 'stocktake', 'stocktake', ref2.id, { missing, extra, applied });
    if (applied) for (const l of out) if (l.diff) await stockAdjust({ store_id: storeId, item_id: l.itemId, qty_delta: l.diff, reason: 'Stock count' });
    return { id: ref2.id, missing, extra, lines: out.filter((l) => l.diff) };
  }
  async function stocktakeList(q) {
    need('stock.adjust'); const storeId = assertStore(q.store_id);
    return (await list('stocktakes', where('storeId', '==', storeId))).sort((a, b) => b.ts - a.ts).slice(0, 30).map((r) => ({ id: r.id, ts: r.ts, date: r.date, by: r.byName, missing: r.missing, extra: r.extra, applied: !!r.applied, lines: (r.lines || []).filter((l) => l.diff) }));
  }

  // ---------- router ----------
  const parse = (url) => { const [path, qs] = url.split('?'); const q = {}; for (const [k, v] of new URLSearchParams(qs || '')) q[k] = v; return { path, q }; };
  async function route(method, url, body) {
    const { path, q } = parse(url); let m; const b = body || {};
    try {
      // login and public
      if (method === 'GET' && path === '/public/stores') return await publicStores();
      if (method === 'GET' && (m = path.match(/^\/public\/stores\/(\d+)\/staff$/))) return await publicStaff(m[1]);
      if (method === 'POST' && path === '/auth/login') return await emailLogin(b);
      if (method === 'POST' && path === '/admin/reset-test') return await resetTest(b);
      if (method === 'POST' && path === '/auth/forgot') { const e = String(b.email || '').trim().toLowerCase(); if (!e.includes('@') || e.endsWith('@till.angkor.app')) throw bad('BAD_INPUT', 'Enter your email address.'); try { await (auth.resetEmail ? auth.resetEmail(e) : Promise.resolve()); } catch { /* never reveal whether the address exists */ } return { ok: true }; }
      if (method === 'POST' && path === '/auth/change-password') return await changePassword(b);
      if (method === 'POST' && path === '/auth/pin-login') return await pinLogin(b);
      if (method === 'POST' && path === '/auth/logout') { await auth.signOut(); B.setSession(null); B.clearCaches(); return { ok: true }; }
      if (method === 'GET' && path === '/setup/status') return { needed: !(await getDoc(ref('setup', 'state'))).exists() };
      if (method === 'POST' && path === '/setup/create') return await setupCreate(b);
      if (method === 'GET' && path === '/me') return await B.publicUser();
      if (!S()) await B.startSession();
      if (method === 'POST' && path === '/auth/unlock') { const dir = await read('staffDirectory', S().uid); const st = await storeById(S().storeId); try { await secondary.signInAs(dir.authEmail, tillPassword(String(b.pin), st.code)).then((c) => c.done()); } catch { throw new ApiErr(401, 'BAD_LOGIN', 'PIN is not correct.'); } return { ok: true }; }
      if (method === 'POST' && path === '/setup/seed') return await setupSeed();
      if (method === 'POST' && path === '/me/store') { const id = assertStore(b.store_id); S().storeId = id; B.localStorageSet('af_store', String(id)); return { ok: true }; }
      if (method === 'POST' && path === '/me/prefs') { const upd = {}; if (['en', 'km'].includes(b.lang)) upd.lang = b.lang; if (['light', 'dark'].includes(b.theme)) upd.theme = b.theme; if (Object.keys(upd).length) { await updateDoc(ref('users', S().uid), upd).catch(() => {}); Object.assign(S().user, upd); } return { ok: true }; }
      // catalogue and stock
      if (method === 'GET' && path === '/meta') return await meta();
      if (method === 'GET' && path === '/items') return await itemsList(q);
      if (method === 'GET' && path === '/pos/catalog') return await posCatalog(q);
      if (method === 'GET' && (m = path.match(/^\/items\/code\/(.+)$/))) { need('catalog.view'); return await itemByCode({ ...q, code: decodeURIComponent(m[1]) }); }
      if (method === 'GET' && path === '/designs') return await designsList();
      if (method === 'POST' && path === '/designs') return await createDesign(b);
      if (method === 'GET' && path === '/stock') return await stockList(q);
      if (method === 'GET' && path === '/stock/lookup') return await lookup(q);
      if (method === 'GET' && path === '/stock/restock') return await restock(q);
      if (method === 'POST' && path === '/stock/in') return await stockIn(b);
      if (method === 'POST' && path === '/stock/adjust') return await stockAdjust(b);
      if (method === 'GET' && path === '/stock/returned') return await returnedList(q);
      if (method === 'POST' && path === '/stock/returned/resolve') return await returnedResolve(b);
      // shifts, sales
      if (method === 'GET' && path === '/shifts/current') return await shiftCurrent(q);
      if (method === 'POST' && path === '/shifts/open') return await shiftOpen(b);
      if (method === 'POST' && path === '/shifts/close') return await shiftClose(b);
      if (method === 'GET' && path === '/shifts') return await shiftsList(q);
      if (method === 'POST' && (m = path.match(/^\/shifts\/([^/]+)\/review$/))) return await shiftReview(m[1]);
      if (method === 'POST' && path === '/sales') return await createSale(b);
      if (method === 'GET' && path === '/sales') return await salesList(q);
      if (method === 'GET' && (m = path.match(/^\/sales\/([^/]+)$/))) { need('sales.view'); return await getSale(m[1]); }
      if (method === 'POST' && (m = path.match(/^\/sales\/([^/]+)\/void$/))) return await voidSale(m[1], b);
      if (method === 'POST' && (m = path.match(/^\/sales\/([^/]+)\/return$/))) return await returnSale(m[1], b);
      if (method === 'GET' && path === '/customers') return await customersList(q);
      if (method === 'POST' && path === '/customers') return await customerAdd(b);
      if (method === 'GET' && path === '/rates/current') return { khr_per_usd: await B.currentRate() };
      if (method === 'POST' && path === '/rates') return await rateSet(b);
      // transfers
      if (method === 'GET' && path === '/transfers') return await transfersList(q);
      if (method === 'POST' && path === '/transfers') return await transferCreate(b);
      if (method === 'GET' && (m = path.match(/^\/transfers\/([^/]+)$/))) { need('transfer.request'); return await trView(await loadT(m[1])); }
      if (method === 'POST' && (m = path.match(/^\/transfers\/([^/]+)\/(approve|owner-approve|reject|cancel|send|receive|resolve)$/))) {
        const fn = { approve: transferApprove, 'owner-approve': transferOwnerApprove, reject: transferReject, cancel: transferCancel, send: transferSend, receive: transferReceive, resolve: transferResolve }[m[2]];
        return await fn(m[1], b);
      }
      // admin and dashboard
      if (method === 'GET' && path === '/dashboard') return await dashboard(q);
      if (method === 'GET' && path === '/admin/stores') return await adminStores();
      if (method === 'POST' && (m = path.match(/^\/admin\/stores\/(\d+)\/delete$/))) return await adminStoreDelete(m[1]);
      if (method === 'POST' && (m = path.match(/^\/designs\/([^/]+)\/delete$/))) return await designDelete(m[1]);
      if (method === 'POST' && (m = path.match(/^\/customers\/([^/]+)\/delete$/))) return await customerDelete(m[1]);
      if (method === 'POST' && path === '/admin/stores') return await adminStoreCreate(b);
      if (method === 'PUT' && (m = path.match(/^\/admin\/stores\/(\d+)$/))) return await adminStoreUpdate(m[1], b);
      if (method === 'GET' && path === '/telegram') { need('settings.manage'); const d = await getDoc(ref('settings', 'telegram')); const x = d.exists() ? d.data() : {}; return { enabled: !!x.enabled, chat_id: x.chatId || '' }; }
      if (method === 'POST' && path === '/telegram') { need('settings.manage'); const chat = String(b.chat_id || '').trim(); if (b.enabled && !/^-?\d{5,20}$/.test(chat)) throw bad('BAD_INPUT', 'The chat ID is a number, like 123456789 or -1001234567890.'); await setDoc(ref('settings', 'telegram'), { enabled: !!b.enabled, chatId: chat }); await audit(null, 'telegram.update', 'settings', 'telegram', { enabled: !!b.enabled }); return { ok: true }; }
      if (method === 'POST' && path === '/telegram/test') { need('settings.manage'); if (!auth.call) throw bad('NOT_AVAILABLE', 'Not available in this mode.'); return await auth.call('telegramTest', {}); }
      if (method === 'POST' && (m = path.match(/^\/admin\/users\/([^/]+)\/reset$/))) { need('users.manage'); { const tu = await read('users', m[1]); if (tu && (m[1] === S().superUid || tu.role === 'owner') && !S().isSuper) throw forbidden('Only the super admin can reset an owner’s password.'); } if (!auth.call) throw bad('NOT_AVAILABLE', 'Not available in this mode.'); return await auth.call('staffReset', { user_id: m[1], pin: b.pin, password: b.password }); }
      if (method === 'GET' && path === '/admin/users') return await adminUsers();
      if (method === 'POST' && path === '/admin/users') return await adminUserCreate(b);
      if (method === 'PUT' && (m = path.match(/^\/admin\/users\/([^/]+)$/))) return await adminUserUpdate(m[1], b);
      if (method === 'POST' && (m = path.match(/^\/admin\/users\/([^/]+)\/delete$/))) return await adminUserDelete(m[1]);
      if (method === 'GET' && path === '/admin/audit') return await auditList(q);
      { const r = await X.route(method, path, q, b); if (r !== undefined) return r; }
      { const r = await M.route(method, path, q, b); if (r !== undefined) return r; }
      if (method === 'POST' && path === '/stocktake') return await stocktakeSave(b);
      if (method === 'GET' && path === '/stocktake') return await stocktakeList(q);
      if (extra.route) { const r = await extra.route(method, path, q, b); if (r !== undefined) return r; }
      throw notFound('Not found.');
    } catch (e) { return wrap('Something went wrong')(e); }
  }
  return { get: (u) => route('GET', u), post: (u, b) => route('POST', u, b), put: (u, b) => route('PUT', u, b), route };
}
