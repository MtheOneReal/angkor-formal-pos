// Expenses, attendance and payroll. Same pattern as routes.js: talks to Firestore, rules are the real gatekeeper.
import { ApiErr, khrToUsdCents, dateOf } from './backend.js';

export const DEFAULT_CATEGORIES = ['Rent', 'Electricity', 'Water', 'Internet', 'Salary', 'Supplies', 'Transport', 'Marketing', 'Other'];
const PP = 7 * 3600 * 1000;
export const localMinutes = (ts) => Math.floor((((ts + PP) % 86400000) + 86400000) % 86400000 / 60000);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const monthsBetween = (from, to) => { const out = []; let y = Number(from.slice(0, 4)); let m = Number(from.slice(5, 7)); const ey = Number(to.slice(0, 4)); const em = Number(to.slice(5, 7)); while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } } return out; };

export function createExtras(B) {
  const { fs, db } = B.deps;
  const { doc, collection, getDoc, setDoc, updateDoc, writeBatch, where } = fs;
  const { bad, forbidden, notFound, need, can, assertStore, read, list, audit, auditIn, wrap, now } = B;
  const S = () => B.S();
  const ref = (n, id) => doc(db, n, String(id));
  const txt = (v, n) => String(v ?? '').slice(0, n);
  const monthOk = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')) ? m : dateOf(now()).slice(0, 7);
  const dateOk = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : null);

  // ---------- expense categories ----------
  async function categories() {
    const rows = await list('expenseCategories');
    if (!rows.length) return DEFAULT_CATEGORIES.map((name) => ({ id: slug(name), name, builtin: true }));
    return rows.sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ id: r.id, name: r.name }));
  }
  async function seedIfEmpty() {
    if ((await list('expenseCategories')).length) return;
    const wb = writeBatch(db); DEFAULT_CATEGORIES.forEach((name) => wb.set(ref('expenseCategories', slug(name)), { name })); await wb.commit();
  }
  async function addCategory(b) {
    need('settings.manage'); const name = txt(b.name, 40).trim(); if (name.length < 2) throw bad('BAD_INPUT', 'Enter a category name.');
    await seedIfEmpty(); const id = slug(name);
    if ((await read('expenseCategories', id))) throw bad('DUPLICATE', 'This category already exists.');
    await setDoc(ref('expenseCategories', id), { name }); await audit(null, 'expense_category.add', 'expense_category', id, { name }); return { id };
  }
  async function deleteCategory(id) {
    need('settings.manage'); await seedIfEmpty();
    const c = await read('expenseCategories', id); if (!c) throw notFound('Category not found.');
    if (c.name === 'Salary') throw bad('PROTECTED', 'The Salary category is used by payroll and cannot be deleted.');
    await fs.deleteDoc(ref('expenseCategories', id)); await audit(null, 'expense_category.delete', 'expense_category', id, { name: c.name }); return { ok: true };
  }

  // ---------- expenses ----------
  const expView = (e) => ({ id: e.id, store_id: e.storeId, date: e.date, category: e.category, amount_cents: e.amountCents, input_currency: e.inputCurrency, input_amount: e.inputAmount, note: e.note || '', has_photo: !!e.hasPhoto, created_by_name: e.createdByName, created_ts: e.createdTs });
  async function storesInScope(sel) {
    if (String(sel) === 'all') { if (!can('dashboard.all_stores')) return S().stores; return (await B.loadStores()).filter((s) => s.active !== false).map((s) => s.id); }
    return [assertStore(sel)];
  }
  async function expensesFor(ids, from, to) {
    const out = [];
    for (const id of ids) for (const m of monthsBetween(from.slice(0, 7), to.slice(0, 7))) {
      const rows = await list('expenses', where('storeId', '==', id), where('month', '==', m));
      for (const r of rows) if (r.date >= from && r.date <= to) out.push(r);
    }
    return out;
  }
  const photoThreshold = async () => (await read('settings', 'expenses'))?.photoRequiredCents ?? 5000;
  async function expenseSettings(b) {
    need('settings.manage'); const c = Math.round(Number(b.photo_required_usd) * 100); if (!(c >= 0 && c <= 10000000)) throw bad('BAD_INPUT', 'Enter an amount in dollars (0 means never required).');
    await setDoc(ref('settings', 'expenses'), { photoRequiredCents: c, ts: now(), setBy: S().uid }); await audit(null, 'expense.settings', 'settings', 'expenses', { cents: c }); return { ok: true };
  }
  async function expensePhoto(id) {
    need('expenses.manage'); const e = await read('expenses', id); if (!e) throw notFound('Expense not found.'); assertStore(e.storeId);
    const p = await read('expensePhotos', id); if (!p) throw notFound('No photo for this expense.'); return { photo: p.photo };
  }
  async function expensesList(q) {
    need('expenses.manage'); const ids = await storesInScope(q.store_id || S().storeId); const month = monthOk(q.month);
    const rows = (await expensesFor(ids, `${month}-01`, `${month}-31`)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdTs - a.createdTs));
    const byCat = {}; let total = 0; for (const r of rows) { byCat[r.category] = (byCat[r.category] || 0) + r.amountCents; total += r.amountCents; }
    return { month, photo_required_cents: await photoThreshold(), total_cents: total, by_category: Object.entries(byCat).map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents), rows: rows.map(expView) };
  }
  async function expenseAdd(b) {
    need('expenses.manage'); const storeId = assertStore(b.store_id); const date = dateOk(b.date); if (!date) throw bad('BAD_INPUT', 'Choose a date.');
    const category = txt(b.category, 40).trim(); if (!category) throw bad('BAD_INPUT', 'Choose a category.');
    const currency = b.currency === 'KHR' ? 'KHR' : 'USD'; const amount = Number(b.amount);
    if (!(amount > 0)) throw bad('BAD_INPUT', 'Enter an amount more than zero.');
    const rate = await B.currentRate(); const cents = currency === 'USD' ? Math.round(amount * 100) : khrToUsdCents(Math.round(amount), rate);
    if (!(cents > 0)) throw bad('BAD_INPUT', 'That amount is too small.');
    const photo = typeof b.photo === 'string' && b.photo.startsWith('data:image/') ? b.photo : null;
    if (photo && photo.length > 260000) throw bad('PHOTO_TOO_BIG', 'The photo is too large. Try a smaller picture.');
    const need$ = await photoThreshold(); if (need$ > 0 && cents >= need$ && !photo) throw bad('PHOTO_REQUIRED', `Expenses of $${(need$ / 100).toFixed(2)} or more need a photo of the receipt or invoice.`);
    const wb = writeBatch(db); const r = doc(collection(db, 'expenses'));
    if (photo) wb.set(ref('expensePhotos', r.id), { storeId, photo });
    wb.set(r, { hasPhoto: !!photo, storeId, date, month: date.slice(0, 7), category, amountCents: cents, inputCurrency: currency, inputAmount: currency === 'USD' ? Math.round(amount * 100) / 100 : Math.round(amount), rate, note: txt(b.note, 200), createdBy: S().uid, createdByName: S().user.name, createdTs: now() });
    auditIn(wb, storeId, 'expense.add', 'expense', r.id, { category, cents, date }); await wb.commit().catch(wrap('Could not save the expense'));
    return { id: r.id };
  }
  async function expenseDelete(id) {
    need('expenses.manage'); const e = await read('expenses', id); if (!e) throw notFound('Expense not found.'); assertStore(e.storeId);
    const wb = writeBatch(db); wb.delete(ref('expenses', id)); if (e.hasPhoto) wb.delete(ref('expensePhotos', id)); auditIn(wb, e.storeId, 'expense.delete', 'expense', id, { category: e.category, cents: e.amountCents, date: e.date, note: e.note });
    await wb.commit().catch(wrap('Could not delete')); return { ok: true };
  }

  // ---------- attendance ----------
  const swOf = async (storeId) => (await B.loadStores()).find((s) => s.id === Number(storeId))?.switches;
  const lateInfo = (a, sw) => { const start = sw?.work_start_minutes ?? 540; const grace = sw?.late_grace_minutes ?? 0; const mins = localMinutes(a.inTs) - start; return { late_minutes: mins > grace ? mins : 0, late: mins > grace && !a.excused }; };
  const attView = (a, sw) => ({ id: a.id, store_id: a.storeId, user_id: a.userId, user_name: a.userName, date: a.date, in_ts: a.inTs, out_ts: a.outTs ?? null, manual: !!a.manual, excused: !!a.excused, ...lateInfo(a, sw) });
  const attId = (storeId, uid, date) => `${storeId}_${uid}_${date}`;
  async function attMine(q) {
    need('attendance.use'); const storeId = assertStore(q.store_id || S().storeId); const date = dateOf(now());
    const a = await read('attendance', attId(storeId, S().uid, date)); const sw = await swOf(storeId);
    return { date, record: a ? attView(a, sw) : null, work_start_minutes: sw.work_start_minutes, late_grace_minutes: sw.late_grace_minutes };
  }
  async function clockIn(b) {
    need('attendance.use'); const storeId = assertStore(b.store_id); const t = now(); const date = dateOf(t); const id = attId(storeId, S().uid, date);
    if (await read('attendance', id)) throw bad('ALREADY_IN', 'You have already clocked in today.');
    await setDoc(ref('attendance', id), { storeId, userId: S().uid, userName: S().user.name, date, month: date.slice(0, 7), inTs: t, outTs: null, manual: false, excused: false }).catch(wrap('Could not clock in'));
    return attMine({ store_id: storeId });
  }
  async function clockOut(b) {
    need('attendance.use'); const storeId = assertStore(b.store_id); const date = dateOf(now()); const id = attId(storeId, S().uid, date);
    const a = await read('attendance', id); if (!a) throw bad('NOT_IN', 'You have not clocked in today.'); if (a.outTs) throw bad('ALREADY_OUT', 'You have already clocked out.');
    await updateDoc(ref('attendance', id), { outTs: now() }).catch(wrap('Could not clock out')); return attMine({ store_id: storeId });
  }
  async function attList(q) {
    need('attendance.manage'); const storeId = assertStore(q.store_id || S().storeId); const month = monthOk(q.month); const sw = await swOf(storeId);
    const rows = (await list('attendance', where('storeId', '==', storeId), where('month', '==', month))).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.userName.localeCompare(b.userName)));
    const views = rows.map((r) => attView(r, sw)); const per = {};
    for (const v of views) { const p = per[v.user_id] || (per[v.user_id] = { user_id: v.user_id, user_name: v.user_name, days: 0, late_days: 0 }); p.days += 1; if (v.late) p.late_days += 1; }
    return { month, store_id: storeId, work_start_minutes: sw.work_start_minutes, late_grace_minutes: sw.late_grace_minutes, summary: Object.values(per).sort((a, b) => a.user_name.localeCompare(b.user_name)), rows: views };
  }
  async function attStaff(q) {
    need('attendance.manage'); const storeId = assertStore(q.store_id || S().storeId);
    const rows = await list('staffDirectory'); return rows.filter((r) => r.active !== false && (r.storeIds || []).map(Number).includes(storeId)).map((r) => ({ id: r.id, name: r.name, role: r.role }));
  }
  const parseTime = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null; return Number(m[1]) * 60 + Number(m[2]); };
  const atLocal = (date, minutes) => Date.parse(`${date}T00:00:00Z`) - PP + minutes * 60000;
  async function attManual(b) {
    need('attendance.manage'); const storeId = assertStore(b.store_id); const date = dateOk(b.date); const inM = parseTime(b.in_time); const outM = b.out_time ? parseTime(b.out_time) : null;
    if (!date || inM == null) throw bad('BAD_INPUT', 'Choose a date and a valid arrival time (like 08:45).');
    if (b.out_time && outM == null) throw bad('BAD_INPUT', 'The leaving time is not valid.');
    if (b.user_id === S().uid && S().user.role !== 'owner') throw forbidden('You cannot edit your own attendance.');
    const dir = await read('staffDirectory', b.user_id); if (!dir || !(dir.storeIds || []).map(Number).includes(storeId)) throw bad('BAD_INPUT', 'Choose someone who works in this store.');
    const id = attId(storeId, b.user_id, date); const old = await read('attendance', id);
    await setDoc(ref('attendance', id), { storeId, userId: b.user_id, userName: dir.name, date, month: date.slice(0, 7), inTs: atLocal(date, inM), outTs: outM == null ? null : atLocal(date, outM), manual: true, excused: old?.excused || false }).catch(wrap('Could not save'));
    await audit(storeId, 'attendance.manual', 'attendance', id, { by: S().uid, in: b.in_time, out: b.out_time || null }); return { id };
  }
  async function attExcuse(id, b) {
    need('attendance.manage'); const a = await read('attendance', id); if (!a) throw notFound(); assertStore(a.storeId);
    if (a.userId === S().uid && S().user.role !== 'owner') throw forbidden('You cannot excuse your own late arrival.');
    await updateDoc(ref('attendance', id), { excused: !!b.excused }).catch(wrap('Could not save')); await audit(a.storeId, 'attendance.excuse', 'attendance', id, { excused: !!b.excused }); return { ok: true };
  }
  async function attDelete(id) {
    need('attendance.manage'); const a = await read('attendance', id); if (!a) throw notFound(); assertStore(a.storeId);
    if (a.userId === S().uid && S().user.role !== 'owner') throw forbidden('You cannot delete your own attendance.');
    const wb = writeBatch(db); wb.delete(ref('attendance', id)); auditIn(wb, a.storeId, 'attendance.delete', 'attendance', id, { user: a.userName, date: a.date }); await wb.commit().catch(wrap('Could not delete')); return { ok: true };
  }

  // ---------- payroll (owner only) ----------
  const deductionCents = async () => (await read('settings', 'payroll'))?.lateDeductionCents ?? 500;
  async function payroll(q) {
    need('payroll.view'); const month = monthOk(q.month); const ded = await deductionCents(); const only = q.store_id && q.store_id !== 'all' ? Number(q.store_id) : null;
    const users = (await list('users')).filter((u) => u.active === true && ((u.salaryCents || 0) > 0 || u.role !== 'owner'));
    const stores = (await B.loadStores()).filter((s) => s.active !== false && s.kind !== 'warehouse');
    const att = []; for (const st of stores) for (const a of await list('attendance', where('storeId', '==', st.id), where('month', '==', month))) att.push({ a, sw: st.switches });
    const rows = []; const homeOf = (u) => Number((u.storeIds || [])[0]) || stores[0]?.id;
    for (const u of users) {
      if (only && homeOf(u) !== only) continue;
      const mine = att.filter((x) => x.a.userId === u.id); const lateDays = mine.filter((x) => lateInfo(x.a, x.sw).late).length; const excused = mine.filter((x) => x.a.excused && lateInfo({ ...x.a, excused: false }, x.sw).late).length;
      const base = u.salaryCents || 0; const deduction = Math.min(base, lateDays * ded);
      const paid = !!(await read('expenses', `salary_${u.id}_${month}`));
      rows.push({ user_id: u.id, name: u.name, role: u.role, store_ids: u.storeIds || [], store_id: homeOf(u), store_name: stores.find((s) => s.id === homeOf(u))?.name || '', multi_store: (u.storeIds || []).length > 1, base_cents: base, days_present: mine.length, late_days: lateDays, excused_days: excused, deduction_cents: deduction, net_cents: base - deduction, recorded: paid });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { month, store_id: only ? String(only) : 'all', stores: stores.map((s) => ({ id: s.id, name: s.name })), late_deduction_cents: ded, rows, total_net_cents: rows.reduce((n, r) => n + r.net_cents, 0), total_base_cents: rows.reduce((n, r) => n + r.base_cents, 0) };
  }
  async function payrollSettings(b) {
    need('payroll.view'); const c = Math.round(Number(b.late_deduction_usd) * 100); if (!(c >= 0 && c <= 100000)) throw bad('BAD_INPUT', 'Enter a deduction between $0 and $1000.');
    await setDoc(ref('settings', 'payroll'), { lateDeductionCents: c, ts: now(), setBy: S().uid }); await audit(null, 'payroll.settings', 'settings', 'payroll', { cents: c }); return { ok: true };
  }
  async function payrollRecord(b) {
    need('payroll.view'); const month = monthOk(b.month); const p = await payroll({ month, store_id: b.store_id }); const stores = (await B.loadStores()).filter((s) => s.active !== false && s.kind !== 'warehouse');
    const date = `${month}-28`; const wb = writeBatch(db); let n = 0; const rate = await B.currentRate();
    for (const r of p.rows) {
      if (r.recorded || r.net_cents <= 0) continue;
      const storeId = Number((r.store_ids || [])[0]) || stores[0]?.id; if (!storeId) continue;
      wb.set(ref('expenses', `salary_${r.user_id}_${month}`), { storeId, date, month, category: 'Salary', amountCents: r.net_cents, inputCurrency: 'USD', inputAmount: Math.round(r.net_cents) / 100, rate, note: `Salary ${month} (${r.name})${r.deduction_cents ? `, late deduction ${r.deduction_cents / 100}` : ''}`, createdBy: S().uid, createdByName: S().user.name, createdTs: now() }); n += 1;
    }
    if (!n) throw bad('NOTHING_TO_RECORD', 'Everything for this month is already recorded, or there is no salary set.');
    auditIn(wb, null, 'payroll.record', 'payroll', month, { people: n }); await wb.commit().catch(wrap('Could not record')); return { recorded: n };
  }

  // ---------- shareholder capital (each store has its own investment) ----------
  const cents = (usdv) => Math.round(Number(usdv) * 100);
  async function capitalView(q) {
    need('capital.view');
    const stores = (await B.loadStores()).filter((x) => x.active !== false && x.kind !== 'warehouse');
    const sel = String(q.store_id || 'all'); const ids = sel === 'all' ? stores.map((x) => x.id) : [Number(sel)];
    if (sel !== 'all' && !stores.find((x) => x.id === ids[0])) throw bad('BAD_INPUT', 'Unknown store.');
    const sh = await list('shareholders'); const allPays = await list('capitalPayments'); const exps = await list('expenses');
    const pays = allPays.filter((p) => ids.includes(Number(p.storeId))); const ex = exps.filter((e) => ids.includes(Number(e.storeId)));
    const agreedOf = (x, sid) => (x.agreedByStore || {})[sid] || 0;
    const paidBy = new Map(); for (const p of pays) paidBy.set(p.shareholderId, (paidBy.get(p.shareholderId) || 0) + p.amountCents);
    const reversed = new Set(allPays.filter((p) => p.kind === 'reversal').map((p) => p.reversesId));
    const rows = sh.map((x) => { const agreed = ids.reduce((n, sid) => n + agreedOf(x, sid), 0); const paid = paidBy.get(x.id) || 0; return { id: x.id, name: x.name, letter: x.letter || String(x.name || '').trim().charAt(0).toUpperCase(), note: x.note || '', active: x.active !== false, agreed_cents: agreed, paid_cents: paid, outstanding_cents: agreed - paid, agreed_by_store: x.agreedByStore || {} }; })
      .filter((r) => sel === 'all' || r.agreed_cents || r.paid_cents).sort((a2, b2) => String(a2.name).localeCompare(b2.name));
    const names = new Map(sh.map((x) => [x.id, x.name])); const snames = new Map(stores.map((x) => [x.id, x.name]));
    const payments = pays.sort((a2, b2) => (b2.date || '').localeCompare(a2.date || '') || (b2.createdTs || 0) - (a2.createdTs || 0)).map((p) => ({ id: p.id, shareholder_id: p.shareholderId, shareholder_name: names.get(p.shareholderId) || '—', store_id: Number(p.storeId), store_name: snames.get(Number(p.storeId)) || '', date: p.date, amount_cents: p.amountCents, note: p.note || '', kind: p.kind || 'payment', reversed: reversed.has(p.id), by: p.createdByName || '' }));
    const byCat = new Map(); let spent = 0; for (const e of ex) { spent += e.amountCents || 0; byCat.set(e.category, (byCat.get(e.category) || 0) + (e.amountCents || 0)); }
    const by_store = stores.map((st) => { const ag = sh.reduce((n, x) => n + agreedOf(x, st.id), 0); const pd = allPays.filter((p) => Number(p.storeId) === st.id).reduce((n, p) => n + p.amountCents, 0); const sp = exps.filter((e) => Number(e.storeId) === st.id).reduce((n, e) => n + (e.amountCents || 0), 0); return { store_id: st.id, name: st.name, agreed_cents: ag, paid_cents: pd, outstanding_cents: ag - pd, expenses_cents: sp, left_cents: pd - sp }; });
    const agreed = rows.reduce((n, r) => n + r.agreed_cents, 0); const paid = rows.reduce((n, r) => n + r.paid_cents, 0);
    return { store_id: sel, stores: stores.map((x) => ({ id: x.id, name: x.name })), shareholders: rows, all_shareholders: sh.slice().sort((p, q2) => (p.createdTs || 0) - (q2.createdTs || 0)).map((x) => ({ id: x.id, name: x.name, letter: x.letter || String(x.name || '').trim().charAt(0).toUpperCase(), active: x.active !== false })), payments, by_store, totals: { agreed_cents: agreed, paid_cents: paid, outstanding_cents: agreed - paid, expenses_cents: spent, left_cents: paid - spent }, expenses_by_category: [...byCat.entries()].map(([category, c]) => ({ category, cents: c })).sort((a2, b2) => b2.cents - a2.cents), can_edit: can('capital.manage') };
  }
  async function shareholderSave(b, id) {
    need('capital.manage'); const name = txt(b.name, 80).trim(); if (!name) throw bad('BAD_INPUT', 'Enter the shareholder name.');
    const stores = (await B.loadStores()).filter((x) => x.kind !== 'warehouse'); const agreedByStore = {};
    for (const st of stores) { const v = cents((b.agreed_by_store || {})[st.id] || 0); if (!(v >= 0 && v <= 100000000000)) throw bad('BAD_INPUT', 'Enter amounts in dollars.'); if (v) agreedByStore[st.id] = v; }
    const r = id ? ref('shareholders', id) : doc(collection(db, 'shareholders'));
    if (id && !(await read('shareholders', id))) throw notFound('Shareholder not found.');
    const wb = writeBatch(db); wb.set(r, { name, letter: (txt(b.letter, 3).trim() || name.trim().charAt(0)).toUpperCase(), agreedByStore, note: txt(b.note, 200), active: b.active !== false, ...(id ? {} : { createdTs: now() }) }, { merge: true });
    auditIn(wb, null, id ? 'capital.shareholder.update' : 'capital.shareholder.add', 'shareholder', r.id, { name, agreedByStore }); await wb.commit().catch(wrap('Could not save')); return { id: r.id };
  }
  async function shareholderDelete(id) {
    need('capital.manage'); if (!(await read('shareholders', id))) throw notFound('Shareholder not found.');
    if ((await list('capitalPayments', where('shareholderId', '==', String(id)))).length) throw bad('HAS_HISTORY', 'This person has recorded payments, so they cannot be deleted. Untick Active instead.');
    const wb = writeBatch(db); wb.delete(ref('shareholders', id)); auditIn(wb, null, 'capital.shareholder.delete', 'shareholder', id, {}); await wb.commit().catch(wrap('Could not delete')); return { ok: true };
  }
  async function paymentAdd(b) {
    need('capital.manage'); const sh = await read('shareholders', b.shareholder_id); if (!sh) throw notFound('Choose a shareholder.');
    const store = (await B.loadStores()).find((x) => x.id === Number(b.store_id)); if (!store) throw bad('BAD_INPUT', 'Choose which store this money is for.');
    const date = dateOk(b.date); if (!date) throw bad('BAD_INPUT', 'Choose the date the money was received.');
    const amt = cents(b.amount_usd); if (!(amt > 0 && amt <= 100000000000)) throw bad('BAD_INPUT', 'Enter the amount received in dollars.');
    const r = doc(collection(db, 'capitalPayments')); const wb = writeBatch(db);
    wb.set(r, { shareholderId: String(b.shareholder_id), storeId: store.id, amountCents: amt, date, note: txt(b.note, 200), kind: 'payment', createdBy: S().uid, createdByName: S().user.name, createdTs: now() });
    auditIn(wb, store.id, 'capital.payment', 'shareholder', b.shareholder_id, { amt, date }); await wb.commit().catch(wrap('Could not save')); return { id: r.id };
  }
  async function paymentReverse(id, b) {
    need('capital.manage'); const p = await read('capitalPayments', id); if (!p) throw notFound('Payment not found.');
    if (p.kind === 'reversal') throw bad('BAD_INPUT', 'This entry is already a correction.');
    const reason = txt(b.reason, 200).trim(); if (reason.length < 3) throw bad('REASON', 'Write the reason for reversing this payment.');
    if ((await list('capitalPayments', where('reversesId', '==', String(id)))).length) throw bad('ALREADY', 'This payment is already reversed.');
    const r = doc(collection(db, 'capitalPayments')); const wb = writeBatch(db);
    wb.set(r, { shareholderId: p.shareholderId, storeId: p.storeId, amountCents: -p.amountCents, date: dateOf(now()), note: `Reversal: ${reason}`, kind: 'reversal', reversesId: String(id), createdBy: S().uid, createdByName: S().user.name, createdTs: now() });
    auditIn(wb, p.storeId, 'capital.reverse', 'shareholder', p.shareholderId, { id, reason }); await wb.commit().catch(wrap('Could not save')); return { id: r.id };
  }

  async function route(method, path, q, b) {
    let m;
    if (method === 'GET' && path === '/capital') return capitalView(q);
    if (method === 'POST' && path === '/capital/shareholders') return shareholderSave(b, null);
    if (method === 'POST' && (m = path.match(/^\/capital\/shareholders\/([^/]+)\/delete$/))) return shareholderDelete(m[1]);
    if (method === 'POST' && (m = path.match(/^\/capital\/shareholders\/([^/]+)$/))) return shareholderSave(b, m[1]);
    if (method === 'POST' && path === '/capital/payments') return paymentAdd(b);
    if (method === 'POST' && (m = path.match(/^\/capital\/payments\/([^/]+)\/reverse$/))) return paymentReverse(m[1], b);
    if (method === 'GET' && path === '/expense-categories') { need('expenses.manage'); return categories(); }
    if (method === 'POST' && path === '/expense-categories') return addCategory(b);
    if (method === 'POST' && (m = path.match(/^\/expense-categories\/([^/]+)\/delete$/))) return deleteCategory(m[1]);
    if (method === 'GET' && path === '/expenses') return expensesList(q);
    if (method === 'GET' && path === '/expense-settings') { need('expenses.manage'); return { photo_required_cents: await photoThreshold() }; }
    if (method === 'POST' && path === '/expense-settings') return expenseSettings(b);
    if (method === 'GET' && (m = path.match(/^\/expenses\/([^/]+)\/photo$/))) return expensePhoto(m[1]);
    if (method === 'POST' && path === '/expenses') return expenseAdd(b);
    if (method === 'POST' && (m = path.match(/^\/expenses\/([^/]+)\/delete$/))) return expenseDelete(m[1]);
    if (method === 'GET' && path === '/attendance/me') return attMine(q);
    if (method === 'POST' && path === '/attendance/clock-in') return clockIn(b);
    if (method === 'POST' && path === '/attendance/clock-out') return clockOut(b);
    if (method === 'GET' && path === '/attendance/staff') return attStaff(q);
    if (method === 'GET' && path === '/attendance') return attList(q);
    if (method === 'POST' && path === '/attendance/manual') return attManual(b);
    if (method === 'POST' && (m = path.match(/^\/attendance\/([^/]+)\/excuse$/))) return attExcuse(m[1], b);
    if (method === 'POST' && (m = path.match(/^\/attendance\/([^/]+)\/delete$/))) return attDelete(m[1]);
    if (method === 'GET' && path === '/payroll') return payroll(q);
    if (method === 'POST' && path === '/payroll/settings') return payrollSettings(b);
    if (method === 'POST' && path === '/payroll/record') return payrollRecord(b);
    return undefined;
  }
  return { route, expensesFor };
}
