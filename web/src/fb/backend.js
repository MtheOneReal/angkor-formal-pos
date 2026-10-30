// Firebase backend for the Angkor Formal app. It answers the same "API calls" the screens already make,
// but reads and writes Firestore directly. All dependencies are passed in so it can be tested without a network.
// Security does NOT depend on this file: Firestore security rules (fb/firestore.rules) are the real gatekeeper.

export class ApiErr extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const bad = (code, message, extra) => new ApiErr(400, code, message, extra);
const forbidden = (message = 'You do not have access to this.') => new ApiErr(403, 'FORBIDDEN', message);
const notFound = (message = 'Not found.') => new ApiErr(404, 'NOT_FOUND', message);
const approval = (message) => new ApiErr(403, 'APPROVAL_REQUIRED', message);

export const ALL_PERMS = [
  'pos.sell', 'pos.discount', 'pos.approve', 'shift.use', 'shift.review', 'catalog.view', 'catalog.edit', 'cost.view',
  'stock.view', 'stock.view_other', 'stock.in', 'stock.adjust', 'transfer.request', 'transfer.approve', 'transfer.send', 'transfer.receive', 'transfer.resolve',
  'customers.manage', 'expenses.manage', 'attendance.use', 'attendance.manage', 'payroll.view', 'sales.view', 'sales.void', 'sales.return', 'users.manage', 'settings.manage', 'rates.set', 'audit.view', 'dashboard.view', 'dashboard.all_stores', 'capital.view', 'capital.manage', 'report.view', 'rank.view',
];
export const ROLE_PERMS = {
  owner: ALL_PERMS,
  manager: ['pos.sell', 'pos.discount', 'pos.approve', 'shift.use', 'shift.review', 'catalog.view', 'cost.view', 'stock.view', 'stock.view_other', 'stock.in', 'stock.adjust',
    'transfer.request', 'transfer.approve', 'transfer.send', 'transfer.receive', 'customers.manage', 'expenses.manage', 'attendance.use', 'attendance.manage', 'sales.view', 'sales.void', 'sales.return', 'rates.set', 'audit.view', 'dashboard.view', 'rank.view'],
  shareholder: ['capital.view', 'report.view', 'rank.view'],
  cashier: ['pos.sell', 'pos.discount', 'shift.use', 'catalog.view', 'stock.view', 'stock.view_other', 'transfer.request', 'customers.manage', 'attendance.use', 'sales.view', 'rank.view'],
};
export const SWITCH_DEFAULTS = {
  require_scan_to_sell: false, blind_counts: false, registered_devices_only: false, pin_every_discount: false, pin_every_return: true, receipt_required: false,
  customer_required: false, autolock_minutes: 2, telegram_summary: false, cashier_see_other_stock: true, show_exact_other_qty: true,
  owner_approval_large_transfer: false, large_transfer_pieces: 20, cashier_discount_limit_percent: 10,
  work_start_minutes: 540, late_grace_minutes: 0,
};
const OWNER_ONLY = ['users.manage', 'settings.manage', 'transfer.resolve', 'dashboard.all_stores', 'payroll.view', 'capital.manage'];

export const khrToUsdCents = (khr, rate) => Math.round((khr * 100) / rate);
export const usdCentsToKhr = (cents, rate) => Math.round((cents * rate) / 100 / 100) * 100;
export const khrTolerance = (rate) => Math.ceil(5000 / rate) + 1;
export const level = (available, low) => (available <= 0 ? 'out' : available <= low ? 'low' : 'in');

const PHNOM_PENH_MS = 7 * 3600 * 1000;
export const dateOf = (ts) => new Date(ts + PHNOM_PENH_MS).toISOString().slice(0, 10);
const dayRange = (iso) => { const s = Date.parse(`${iso}T00:00:00Z`) - PHNOM_PENH_MS; return [s, s + 86400000]; };

export function createBackend(deps) {
  const { fs, db, auth, secondary, now = () => Date.now() } = deps;
  const { doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where, writeBatch, runTransaction, increment } = fs;

  let S = null; // session: { uid, user, perms:Set, stores:[ids], storeId }
  const C = { stores: null, catalog: null, costs: null, stock: new Map(), stockAll: null, rate: null };

  // ---------- small helpers ----------
  const ref = (name, id, d = db) => doc(d, name, String(id));
  const read = async (name, id, d = db) => { const s = await getDoc(ref(name, id, d)); return s.exists() ? { id: s.id, ...s.data() } : null; };
  const list = async (name, ...cond) => (await getDocs(cond.length ? query(collection(db, name), ...cond) : collection(db, name))).docs.map((x) => ({ id: x.id, ...x.data() }));
  const need = (perm) => { if (!S) throw new ApiErr(401, 'LOGIN_REQUIRED', 'Please sign in.'); if (!S.perms.has(perm)) throw forbidden(); };
  const can = (perm) => !!S && S.perms.has(perm);
  const assertStore = (id) => { const n = Number(id); if (!n) throw bad('STORE_REQUIRED', 'Choose a store.'); if (!S.stores.includes(n)) throw forbidden('You do not have access to this store.'); return n; };
  const isLead = () => S.user.role === 'owner' || S.user.role === 'manager';
  const wrap = (label) => (e) => { if (e instanceof ApiErr) throw e; const code = e && e.code; if (code === 'permission-denied') throw forbidden('The security rules refused this action.'); throw new ApiErr(500, 'ERROR', (e && e.message) || label); };

  function permsFor(user) {
    const base = new Set(ROLE_PERMS[user.role] || []);
    const o = user.perms || {};
    for (const p of o.grant || []) if (ALL_PERMS.includes(p)) base.add(p);
    for (const p of o.deny || []) base.delete(p);
    if (user.role !== 'owner') for (const p of OWNER_ONLY) base.delete(p);
    return base;
  }

  async function audit(storeId, action, entity, entityId, details, d = db, uid = S.uid) {
    // Fire and forget inside batches is not possible, so this is a plain write. A failure here must not block a sale.
    try { await setDoc(doc(collection(d, 'auditLog')), { ts: now(), userId: uid, storeId: storeId ?? null, action, entity: entity ?? null, entityId: entityId == null ? null : String(entityId), details: details ?? null }); } catch { /* ignore */ }
  }
  const auditIn = (batchOrTx, storeId, action, entity, entityId, details, uid = S.uid, d = db) =>
    batchOrTx.set(doc(collection(d, 'auditLog')), { ts: now(), userId: uid, storeId: storeId ?? null, action, entity: entity ?? null, entityId: entityId == null ? null : String(entityId), details: details ?? null });

  // ---------- catalogue cache ----------
  async function loadStores(force) {
    if (C.stores && !force) return C.stores;
    const rows = await list('stores');
    C.stores = rows.map((s) => ({ ...s, id: Number(s.id), switches: { ...SWITCH_DEFAULTS, ...(s.switches || {}) } })).sort((a, b) => a.id - b.id);
    return C.stores;
  }
  async function loadCatalog(force) {
    if (C.catalog && !force) return C.catalog;
    const [brands, types, colours, designs, items] = await Promise.all([list('brands'), list('types'), list('colours'), list('designs'), list('items')]);
    C.catalog = { brands, types, colours, designs: new Map(designs.map((d) => [String(d.id), d])), items: items.map((i) => ({ ...i, id: Number(i.id) })), colours: new Map(colours.map((c) => [c.code, c])), brandsList: brands, typesList: types, coloursList: colours };
    C.costs = null;
    return C.catalog;
  }
  async function loadCosts() {
    if (!can('cost.view')) return new Map();
    if (!C.costs) C.costs = new Map((await list('costs')).map((c) => [String(c.id), c.costCents || 0]));
    return C.costs;
  }
  function invalidateStock(storeId) { if (storeId) C.stock.delete(storeId); else C.stock.clear(); C.stockAll = null; }
  async function stockOfStore(storeId) {
    const hit = C.stock.get(storeId);
    if (hit && now() - hit.at < 15000) return hit.map;
    const rows = await list('stock', where('storeId', '==', storeId));
    const map = new Map(rows.map((r) => [Number(r.itemId), r]));
    C.stock.set(storeId, { at: now(), map });
    return map;
  }
  async function stockOfAll() {
    if (C.stockAll && now() - C.stockAll.at < 30000) return C.stockAll.rows;
    const rows = await list('stock');
    C.stockAll = { at: now(), rows };
    return rows;
  }
  const quant = (s) => ({ on_hand: s?.onHand || 0, reserved: s?.reserved || 0, available: (s?.onHand || 0) - (s?.reserved || 0) });

  async function itemRow(item, cat, costs) {
    const d = cat.designs.get(String(item.designId)); const c = cat.colours.get(item.colourCode);
    if (!d) return null;
    const row = {
      id: item.id, sku: item.sku, design_code: d.code || `${d.brandCode}-${d.typeCode}${String(d.number).padStart(2, '0')}`, size: item.size, colour_code: item.colourCode, low_stock: item.lowStock ?? 2, design_id: Number(d.id),
      name_en: d.nameEn, name_km: d.nameKm || null, photo: d.photo || null, price_cents: d.priceCents, type_code: d.typeCode, number: d.number, brand_code: d.brandCode,
      colour_en: c?.nameEn || item.colourCode, colour_km: c?.nameKm || null, colour_hex: c?.hex || '#999', active: item.active !== false && d.active !== false,
    };
    if (costs) row.cost_cents = costs.get(String(d.id)) ?? 0;
    return row;
  }
  const searchMatch = (row, q) => {
    const tokens = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    return tokens.every((t) => [row.sku, row.name_en, row.name_km, row.colour_en, row.colour_km].some((f) => f && String(f).toLowerCase().includes(t)) || String(row.size).toLowerCase() === t);
  };
  async function itemRows(q, limit = 300) {
    const cat = await loadCatalog(); const costs = can('cost.view') ? await loadCosts() : null;
    const out = [];
    for (const it of cat.items) {
      const r = await itemRow(it, cat, costs);
      if (r && r.active && searchMatch(r, q)) { out.push(r); if (out.length >= limit) break; }
    }
    return out;
  }
  const normaliseCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

  // ---------- session ----------
  async function startSession() {
    const cu = auth.current();
    if (!cu) { S = null; throw new ApiErr(401, 'LOGIN_REQUIRED', 'Please sign in.'); }
    let u;
    try { u = await read('users', cu.uid); } catch { u = null; }
    if (!u || u.active !== true) { await auth.signOut(); S = null; throw new ApiErr(401, 'LOGIN_REQUIRED', 'This account is not active.'); }
    const stores = await loadStores(true);
    const ids = ['owner', 'shareholder'].includes(u.role) ? stores.filter((s) => s.active !== false).map((s) => s.id) : (u.storeIds || []).map(Number).filter((id) => stores.find((s) => s.id === id)?.active !== false);
    let storeId = Number(localStorageGet('af_store')) || null;
    if (!ids.includes(storeId)) storeId = ids.find((i) => stores.find((s) => s.id === i)?.kind !== 'warehouse') ?? ids[0] ?? null;
    let superUid = null; try { superUid = (await read('setup', 'state'))?.firstOwner || null; } catch { /* ignore */ }
    S = { uid: cu.uid, user: u, perms: permsFor(u), stores: ids, storeId, superUid, isSuper: !!superUid && superUid === cu.uid };
    return S;
  }
  const localStorageGet = (k) => { try { return globalThis.localStorage?.getItem(k); } catch { return null; } };
  const localStorageSet = (k, v) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* ignore */ } };

  async function currentRate() {
    if (C.rate && now() - C.rate.at < 60000) return C.rate.v;
    const r = await read('settings', 'rate');
    C.rate = { at: now(), v: r?.khrPerUsd || 4000 };
    return C.rate.v;
  }

  async function publicUser() {
    if (!S) await startSession();
    const stores = (await loadStores()).filter((s) => S.stores.includes(s.id) && s.active !== false);
    const brands = (await loadCatalog()).brandsList;
    const dirMe = S.user.role === 'cashier' ? await read('staffDirectory', S.uid).catch(() => null) : null;
    const sw = {}; for (const s of stores) sw[s.id] = s.switches;
    return {
      id: S.uid, name: S.user.name, role: S.user.role, is_super: !!S.isSuper, lang: S.user.lang || 'en', theme: S.user.theme || null, demo: !!S.user.demo,
      perms: [...S.perms], pin_length: dirMe?.pinLength || 0, store_id: S.storeId, switches: sw, rate: await currentRate(),
      stores: stores.map((s) => { const b = brands.find((x) => String(x.id) === String(s.brandId)); return { id: s.id, code: s.code, name: s.name, kind: s.kind === 'warehouse' ? 'warehouse' : 'shop', brand_id: s.brandId, brand_code: b?.code, brand_name: b?.name }; }),
    };
  }

  // ---------- approvals by a manager who signs in at the till ----------
  // The screen passes the manager's email and password as "email\npassword". We sign in on a second, separate
  // Firebase connection, so the cashier stays signed in on the main one.
  async function withLead(credential, storeId, fn) {
    const [email, password] = String(credential || '').split('\n');
    if (!email || !password) throw approval('A manager must sign in to approve this.');
    let ctx;
    try { ctx = await secondary.signInAs(email.trim(), password); } catch { throw new ApiErr(401, 'BAD_LOGIN', 'Manager email or password is not correct.'); }
    try {
      const u = await read('users', ctx.uid, ctx.db);
      if (!u || u.active !== true || !['manager', 'owner'].includes(u.role)) throw forbidden('This person cannot approve.');
      if (u.role !== 'owner' && !(u.storeIds || []).map(Number).includes(storeId)) throw forbidden('This manager does not work in this store.');
      if (ctx.uid === S.uid) throw forbidden('You cannot approve your own action.');
      return await fn({ uid: ctx.uid, db: ctx.db, user: u });
    } finally { await ctx.done(); }
  }

  const ctxOfSelf = () => ({ uid: S.uid, db, user: S.user });
  // Runs fn in this person's own context if they may approve, otherwise asks for a manager.
  async function asLead(storeId, credential, message, fn) {
    if (can('pos.approve') && isLead()) return fn(ctxOfSelf());
    if (!credential) throw approval(message);
    return withLead(credential, storeId, fn);
  }

  return { S: () => S, db, deps, ref, read, list, need, can, assertStore, isLead, wrap, audit, auditIn, loadStores, loadCatalog, loadCosts, invalidateStock, stockOfStore, stockOfAll, quant, itemRow, itemRows,
    normaliseCode, startSession, currentRate, publicUser, withLead, asLead, ctxOfSelf, permsFor, C, setSession: (s) => { S = s; }, localStorageSet, localStorageGet, dayRange, bad, forbidden, notFound, approval, now,
    clearCaches: () => { C.stores = null; C.catalog = null; C.costs = null; C.stock.clear(); C.stockAll = null; C.rate = null; } };
}
