// Deposits and balances, alteration jobs, shareholder report, daily summary, data export.
import { ApiErr, khrToUsdCents, khrTolerance, dateOf } from './backend.js';

export function createMore(B) {
  const { fs, db } = B.deps;
  const { doc, collection, getDoc, setDoc, writeBatch, where } = fs;
  const { bad, notFound, need, can, assertStore, read, list, auditIn, wrap, now } = B;
  const S = () => B.S();
  const ref = (n, id) => doc(db, n, String(id));
  const txt = (v, n) => String(v ?? '').slice(0, n);
  const monthOf = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')) ? m : dateOf(now()).slice(0, 7));
  const ymd = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : dateOf(now()));

  // ---------- deposits: money still owed on suits already taken or ordered ----------
  async function balancesList(q) {
    need('pos.sell'); const storeId = assertStore(q.store_id);
    return (await list('balances', where('storeId', '==', storeId))).filter((r) => !r.settled).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) || a.createdTs - b.createdTs)
      .map((r) => ({ id: r.id, sale_id: r.saleId, receipt_no: r.receiptNo, customer_name: r.customerName, customer_phone: r.customerPhone, total_cents: r.totalCents, paid_cents: r.paidCents, balance_cents: r.balanceCents, due_date: r.dueDate || null, created_ts: r.createdTs }));
  }
  async function collect(id, b) {
    need('pos.sell'); const bal = await read('balances', id); if (!bal) throw notFound('Balance not found.'); assertStore(bal.storeId);
    if (bal.settled) throw bad('SETTLED', 'This balance is already paid.');
    const method = ['cash', 'khqr', 'card'].includes(b.method) ? b.method : null; if (!method) throw bad('BAD_PAYMENT', 'Choose how the customer pays.');
    const currency = b.currency === 'KHR' ? 'KHR' : 'USD'; const amount = Math.floor(Number(b.amount)); if (!(amount > 0)) throw bad('BAD_PAYMENT', 'Enter the amount received.');
    const rate = await B.currentRate(); const usd = currency === 'USD' ? amount : khrToUsdCents(amount, rate); const tol = currency === 'KHR' ? khrTolerance(rate) : 0;
    if (usd > bal.balanceCents + tol) throw bad('TOO_MUCH', 'That is more than the balance owed.');
    const shift = (await list('shifts', where('storeId', '==', Number(bal.storeId)), where('userId', '==', S().uid))).find((s) => !s.closedTs);
    if (!shift) throw bad('NO_SHIFT', 'Open your shift first, so the cash is counted in it.');
    const left = bal.balanceCents - usd <= tol ? 0 : bal.balanceCents - usd;
    const wb = writeBatch(db);
    wb.update(ref('balances', id), { paidCents: bal.paidCents + usd, balanceCents: left, settled: left === 0, ...(left === 0 ? { settledTs: now() } : {}), lastTs: now() });
    wb.set(doc(collection(db, 'balancePayments')), { storeId: Number(bal.storeId), saleId: bal.saleId, receiptNo: bal.receiptNo, shiftId: String(shift.id), userId: S().uid, method, currency, amount, usd, ts: now() });
    const jobs = (await list('alterations', where('storeId', '==', Number(bal.storeId)), where('saleId', '==', String(bal.saleId))));
    for (const j of jobs) wb.update(ref('alterations', j.id), { balanceCents: left, updatedTs: now() });
    auditIn(wb, Number(bal.storeId), 'balance.collect', 'sale', bal.saleId, { usd, left });
    await wb.commit().catch(wrap('Could not save')); return { balance_cents: left, settled: left === 0 };
  }

  // ---------- alteration jobs ----------
  const STATUSES = ['received', 'in_progress', 'ready', 'collected'];
  async function jobsList(q) {
    need('pos.sell'); const storeId = assertStore(q.store_id); const cutoff = now() - 30 * 86400000;
    return (await list('alterations', where('storeId', '==', storeId))).filter((j) => j.status !== 'collected' || (j.updatedTs || 0) > cutoff).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) || a.createdTs - b.createdTs)
      .map((j) => ({ id: j.id, sale_id: j.saleId, receipt_no: j.receiptNo, customer_name: j.customerName, customer_phone: j.customerPhone, summary: j.summary, notes: j.notes || '', due_date: j.dueDate || null, status: j.status, balance_cents: j.balanceCents || 0, created_ts: j.createdTs }));
  }
  async function jobUpdate(id, b) {
    need('pos.sell'); const j = await read('alterations', id); if (!j) throw notFound('Job not found.'); assertStore(j.storeId);
    const status = b.status == null ? j.status : b.status; if (!STATUSES.includes(status)) throw bad('BAD_INPUT', 'Unknown status.');
    if (status === 'collected' && (j.balanceCents || 0) > 0) throw bad('BALANCE_DUE', 'The customer still owes money on this order. Collect the balance first.');
    const due = b.due_date === undefined ? (j.dueDate || null) : (/^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date)) ? b.due_date : null);
    const wb = writeBatch(db); wb.update(ref('alterations', id), { status, dueDate: due, notes: b.notes == null ? (j.notes || '') : txt(b.notes, 300), updatedTs: now() });
    auditIn(wb, Number(j.storeId), 'alteration.update', 'alteration', id, { status }); await wb.commit().catch(wrap('Could not save')); return { ok: true };
  }

  // ---------- shareholder / owner monthly report ----------
  async function report(q) {
    need('report.view');
    const stores = (await B.loadStores()).filter((x) => x.active !== false && x.kind !== 'warehouse'); const sel = String(q.store_id || 'all'); const ids = sel === 'all' ? stores.map((x) => x.id) : [Number(sel)];
    if (sel !== 'all' && !stores.find((x) => x.id === ids[0])) throw bad('BAD_INPUT', 'Unknown store.');
    const month = monthOf(q.month);
    const cat = await B.loadCatalog(); const costs = new Map((await list('costs')).map((c) => [String(c.id), c.costCents || 0]));
    const costOfItem = new Map(cat.items.map((i) => [String(i.id), costs.get(String(i.designId)) || 0]));
    const stats = await list('monthStats'); const exps = await list('expenses'); const pays = await list('capitalPayments');
    const cogsOf = (st) => Object.entries(st.byItem || {}).reduce((n, [item, v]) => n + (v.qty || 0) * (costOfItem.get(String(item)) || 0), 0);
    const mk = (sid) => {
      const mine = stats.filter((x) => Number(x.storeId) === sid); const cur = mine.find((x) => x.date === month);
      const sales = cur?.salesCents || 0; const cogs = cur ? cogsOf(cur) : 0; const exp = exps.filter((e) => Number(e.storeId) === sid && e.month === month).reduce((n, e) => n + (e.amountCents || 0), 0);
      const sAll = mine.reduce((n, x) => n + (x.salesCents || 0), 0); const cAll = mine.reduce((n, x) => n + cogsOf(x), 0); const eAll = exps.filter((e) => Number(e.storeId) === sid).reduce((n, e) => n + (e.amountCents || 0), 0);
      const cap = pays.filter((p) => Number(p.storeId) === sid).reduce((n, p) => n + p.amountCents, 0);
      return { store_id: sid, name: stores.find((x) => x.id === sid)?.name || String(sid), orders: cur?.orders || 0, sales_cents: sales, cogs_cents: cogs, gross_cents: sales - cogs, expenses_cents: exp, net_cents: sales - cogs - exp,
        total_sales_cents: sAll, total_net_cents: sAll - cAll - eAll, capital_paid_cents: cap };
    };
    const rows = ids.map(mk); const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
    const totals = { orders: sum('orders'), sales_cents: sum('sales_cents'), cogs_cents: sum('cogs_cents'), gross_cents: sum('gross_cents'), expenses_cents: sum('expenses_cents'), net_cents: sum('net_cents'), total_sales_cents: sum('total_sales_cents'), total_net_cents: sum('total_net_cents'), capital_paid_cents: sum('capital_paid_cents') };
    const months = [...new Set(stats.filter((x) => ids.includes(Number(x.storeId))).map((x) => x.date))].sort().slice(-6);
    const trend = months.map((m) => { let sl = 0; let cg = 0; let ex = 0; for (const x of stats) if (x.date === m && ids.includes(Number(x.storeId))) { sl += x.salesCents || 0; cg += cogsOf(x); } for (const e of exps) if (e.month === m && ids.includes(Number(e.storeId))) ex += e.amountCents || 0; return { month: m, sales_cents: sl, net_cents: sl - cg - ex }; });
    return { month, store_id: sel, stores: stores.map((x) => ({ id: x.id, name: x.name })), rows, totals, trend, note: 'Cost of goods uses each product’s current cost price.' };
  }

  // ---------- profit share: one statement per shop and month, closed, then paid out ----------
  const isProd = (e) => /production/i.test(e.category || '');
  async function profitData() {
    const stores = (await B.loadStores()).filter((x) => x.active !== false);
    const shops = stores.filter((x) => x.kind !== 'warehouse'); const whIds = new Set(stores.filter((x) => x.kind === 'warehouse').map((x) => Number(x.id)));
    const lead = can('capital.manage');
    const D = { shops, whIds, lead, sh: await list('shareholders'), closes: await list('profitCloses'), pays: await list('profitPayouts') };
    const rd = await getDoc(ref('settings', 'reserve')); D.pct = rd.exists() ? Math.min(100, Math.max(0, Number(rd.data().pct) || 0)) : 0;
    const md = await getDoc(ref('settings', 'profitMode')); D.pooled = md.exists() && md.data().pooled === true;
    D.exps = lead ? await list('expenses') : []; D.stats = lead ? await list('monthStats') : [];
    if (lead) { const cat = await B.loadCatalog(); const costs = new Map((await list('costs')).map((c) => [String(c.id), c.costCents || 0])); const costOfItem = new Map(cat.items.map((i) => [String(i.id), costs.get(String(i.designId)) || 0])); D.cogsOf = (st) => Object.entries(st.byItem || {}).reduce((n, [item, v]) => n + (v.qty || 0) * (costOfItem.get(String(item)) || 0), 0); }
    return D;
  }
  // key = a shop id, or 'all' when profit is pooled
  function statement(D, key, month) {
    const frozen = D.closes.find((c) => c.id === `${key}_${month}`);
    if (frozen) return { key: String(key), month, closed: true, closed_ts: frozen.closedTs, sales_cents: frozen.salesCents, cogs_cents: frozen.cogsCents, expenses_cents: frozen.expensesCents, shared_cents: frozen.sharedCents, net_cents: frozen.netCents, reserve_pct: frozen.reservePct, reserve_cents: frozen.reserveCents, share_cents: frozen.shareCents, holders: frozen.holders.map((h) => ({ id: h.id, name: h.name, pct: h.pct, share_cents: h.shareCents })) };
    if (!D.lead) return { key: String(key), month, closed: false, hidden: true, holders: [], net_cents: 0, reserve_cents: 0, share_cents: 0, sales_cents: 0, cogs_cents: 0, expenses_cents: 0, shared_cents: 0, reserve_pct: D.pct };
    const ids = key === 'all' ? D.shops.map((x) => Number(x.id)) : [Number(key)];
    const sales = (sid) => D.stats.filter((x) => Number(x.storeId) === sid && x.date === month).reduce((n, x) => n + (x.salesCents || 0), 0);
    const mine = ids.reduce((n, sid) => n + sales(sid), 0); const allSales = D.shops.reduce((n, x) => n + sales(Number(x.id)), 0);
    const cogs = D.stats.filter((x) => ids.includes(Number(x.storeId)) && x.date === month).reduce((n, x) => n + D.cogsOf(x), 0);
    const spend = (e) => e.month === month && !isProd(e);
    const own = D.exps.filter((e) => ids.includes(Number(e.storeId)) && spend(e)).reduce((n, e) => n + (e.amountCents || 0), 0);
    const sharedTotal = D.exps.filter((e) => D.whIds.has(Number(e.storeId)) && spend(e)).reduce((n, e) => n + (e.amountCents || 0), 0);
    const frac = key === 'all' ? 1 : (allSales > 0 ? mine / allSales : 1 / Math.max(1, D.shops.length));
    const shared = Math.round(sharedTotal * frac);
    const net = mine - cogs - own - shared;
    const reserve = net > 0 ? Math.round((net * D.pct) / 100) : 0; const share = net > 0 ? net - reserve : 0;
    const agreedOf = (x) => ids.reduce((a, sid) => a + ((x.agreedByStore || {})[sid] || 0), 0); const total = D.sh.reduce((a, x) => a + agreedOf(x), 0);
    const holders = D.sh.filter((x) => agreedOf(x) > 0).map((x) => { const w = total ? agreedOf(x) / total : 0; return { id: x.id, name: x.name, pct: Math.round(w * 1000) / 10, share_cents: Math.round(share * w) }; }).sort((a, b) => b.pct - a.pct);
    if (holders.length && share > 0) { const diff = share - holders.reduce((a, h) => a + h.share_cents, 0); holders[0].share_cents += diff; }
    return { key: String(key), month, closed: false, sales_cents: mine, cogs_cents: cogs, expenses_cents: own, shared_cents: shared, net_cents: net, reserve_pct: D.pct, reserve_cents: reserve, share_cents: share, holders };
  }
  // what each person has earned (closed months only), been paid and is still owed for one key
  function balances(D, key) {
    const earned = new Map(); const paid = new Map();
    for (const c of D.closes.filter((x) => String(x.key) === String(key))) for (const h of c.holders) earned.set(h.id, (earned.get(h.id) || 0) + h.shareCents);
    for (const p of D.pays.filter((x) => String(x.key) === String(key))) paid.set(p.shareholderId, (paid.get(p.shareholderId) || 0) + p.amountCents);
    return { earned, paid };
  }
  async function profit(q) {
    need('capital.view'); const D = await profitData(); const month = monthOf(q.month); const sel = String(q.store_id || 'all');
    const names = new Map(D.sh.map((x) => [x.id, x.name])); const sn = new Map(D.shops.map((x) => [Number(x.id), x.name]));
    const closedKeys = (D.pooled ? ['all'] : D.shops.map((x) => String(x.id)));
    const out = { month, pooled: D.pooled, reserve_pct: D.pct, can_edit: can('capital.manage'), is_super: !!S().isSuper, has_history: D.closes.length > 0 || D.pays.length > 0,
      fund: { set_aside_cents: D.closes.reduce((a, c) => a + (c.reserveCents || 0), 0), used_cents: D.lead ? D.exps.filter(isProd).reduce((a, e) => a + (e.amountCents || 0), 0) : 0 } };
    out.fund.balance_cents = out.fund.set_aside_cents - out.fund.used_cents;
    const people = (keys) => { const m = new Map(); for (const k of keys) { const b = balances(D, k); for (const [id, v] of b.earned) { const r = m.get(id) || { id, name: names.get(id) || id, earned_cents: 0, paid_cents: 0 }; r.earned_cents += v; m.set(id, r); } for (const [id, v] of b.paid) { const r = m.get(id) || { id, name: names.get(id) || id, earned_cents: 0, paid_cents: 0 }; r.paid_cents += v; m.set(id, r); } } return [...m.values()].map((r) => ({ ...r, owed_cents: r.earned_cents - r.paid_cents })).sort((a, b) => b.owed_cents - a.owed_cents); };
    if (!D.pooled && sel === 'all') {
      const rows = D.shops.map((s) => { const st = statement(D, s.id, month); return { store_id: Number(s.id), name: s.name, closed: st.closed, hidden: !!st.hidden, net_cents: st.net_cents, reserve_cents: st.reserve_cents, share_cents: st.share_cents }; });
      return { ...out, mode: 'combined', rows, totals: { net_cents: rows.reduce((a, r) => a + r.net_cents, 0), reserve_cents: rows.reduce((a, r) => a + r.reserve_cents, 0), share_cents: rows.reduce((a, r) => a + r.share_cents, 0) }, people: people(closedKeys) };
    }
    const key = D.pooled ? 'all' : String(Number(sel)); if (!D.pooled && !sn.has(Number(key))) throw notFound('Shop not found.');
    const st = statement(D, key, month); const b = balances(D, key);
    const holders = st.holders.map((h) => ({ ...h, earned_cents: b.earned.get(h.id) || 0, paid_cents: b.paid.get(h.id) || 0, owed_cents: (b.earned.get(h.id) || 0) - (b.paid.get(h.id) || 0) }));
    for (const id of new Set([...b.earned.keys(), ...b.paid.keys()])) if (!holders.some((h) => h.id === id)) holders.push({ id, name: names.get(id) || id, pct: 0, share_cents: 0, earned_cents: b.earned.get(id) || 0, paid_cents: b.paid.get(id) || 0, owed_cents: (b.earned.get(id) || 0) - (b.paid.get(id) || 0) });
    const payouts = D.pays.filter((x) => String(x.key) === key).sort((a, c) => (c.ts || 0) - (a.ts || 0)).slice(0, 30).map((x) => ({ id: x.id, shareholder_id: x.shareholderId, name: names.get(x.shareholderId) || x.shareholderId, amount_cents: x.amountCents, date: x.date, note: x.note || '', reverses_id: x.reversesId || null }));
    return { ...out, mode: 'statement', key, store_name: D.pooled ? null : sn.get(Number(key)), statement: st, holders, payouts };
  }
  const keyCheck = async (D, b) => { const key = String(b.store_id ?? ''); if (D.pooled ? key !== 'all' : !D.shops.some((s) => String(s.id) === key)) throw bad('BAD_INPUT', D.pooled ? 'Profit is shared from all shops together.' : 'Choose a shop.'); return key; };
  async function profitClose(b) {
    need('capital.manage'); const D = await profitData(); const key = await keyCheck(D, b); const month = monthOf(b.month);
    if (month >= dateOf(now()).slice(0, 7)) throw bad('TOO_EARLY', 'A month can be closed only after it has ended.');
    if (D.closes.some((c) => c.id === `${key}_${month}`)) throw bad('ALREADY', 'This month is already closed.');
    const st = statement(D, key, month); if (!st.holders.length && st.share_cents > 0) throw bad('NO_HOLDERS', 'Add shareholders with agreed amounts first, so the profit can be split.');
    const wb = writeBatch(db);
    wb.set(ref('profitCloses', `${key}_${month}`), { key, month, salesCents: st.sales_cents, cogsCents: st.cogs_cents, expensesCents: st.expenses_cents, sharedCents: st.shared_cents, netCents: st.net_cents, reservePct: st.reserve_pct, reserveCents: st.reserve_cents, shareCents: st.share_cents, holders: st.holders.map((h) => ({ id: h.id, name: h.name, pct: h.pct, shareCents: h.share_cents })), closedTs: now(), closedBy: S().uid });
    auditIn(wb, null, 'profit.close', 'profit', `${key}_${month}`, { net: st.net_cents, share: st.share_cents }); await wb.commit().catch(wrap('Could not close the month')); return { ok: true };
  }
  async function profitReopen(b) {
    need('capital.manage'); if (!S().isSuper) throw new ApiErr(403, 'FORBIDDEN', 'Only the super admin can reopen a closed month.');
    const D = await profitData(); const key = await keyCheck(D, b); const month = monthOf(b.month); const id = `${key}_${month}`;
    if (!D.closes.some((c) => c.id === id)) throw notFound('This month is not closed.');
    const wb = writeBatch(db); wb.delete(ref('profitCloses', id)); auditIn(wb, null, 'profit.reopen', 'profit', id, {}); await wb.commit().catch(wrap('Could not reopen')); return { ok: true };
  }
  async function profitPay(b) {
    need('capital.manage'); const D = await profitData(); const key = await keyCheck(D, b); const sid = String(b.shareholder_id || '');
    const holder = D.sh.find((x) => x.id === sid); if (!holder) throw bad('BAD_INPUT', 'Choose a shareholder.');
    const cents = Math.round(Number(b.amount_usd) * 100); if (!(cents > 0)) throw bad('BAD_INPUT', 'Enter an amount above zero.');
    const bl = balances(D, key); const owed = (bl.earned.get(sid) || 0) - (bl.paid.get(sid) || 0);
    if (cents > owed) throw bad('OVERPAY', `This is more than ${holder.name} is owed (${(Math.max(0, owed) / 100).toFixed(2)} USD).`);
    const date = ymd(b.date); const r = doc(collection(db, 'profitPayouts')); const wb = writeBatch(db);
    wb.set(r, { key, shareholderId: sid, amountCents: cents, date, note: txt(b.note, 200), ts: now(), createdBy: S().uid }); auditIn(wb, null, 'profit.payout', 'profitPayout', r.id, { shareholder: holder.name, cents, key });
    await wb.commit().catch(wrap('Could not save')); return { id: r.id };
  }
  async function profitPayReverse(id, b) {
    need('capital.manage'); const p = await read('profitPayouts', id); if (!p) throw notFound('Payment not found.');
    if (p.amountCents <= 0 || p.reversesId) throw bad('BAD_INPUT', 'This entry cannot be reversed.');
    if ((await list('profitPayouts', where('reversesId', '==', String(id)))).length) throw bad('ALREADY', 'This payment is already reversed.');
    if (!String(b.reason || '').trim()) throw bad('BAD_INPUT', 'Enter the reason.');
    const r = doc(collection(db, 'profitPayouts')); const wb = writeBatch(db);
    wb.set(r, { key: p.key, shareholderId: p.shareholderId, amountCents: -p.amountCents, date: dateOf(now()), note: `Reversal: ${txt(b.reason, 160)}`, reversesId: String(id), ts: now(), createdBy: S().uid }); auditIn(wb, null, 'profit.payout.reverse', 'profitPayout', id, { reason: b.reason });
    await wb.commit().catch(wrap('Could not save')); return { ok: true };
  }
  async function profitMode(b) {
    need('capital.manage'); if (!S().isSuper) throw new ApiErr(403, 'FORBIDDEN', 'Only the super admin can change how profit is shared.');
    const D = await profitData(); if (D.closes.length || D.pays.length) throw bad('HAS_HISTORY', 'This can be changed only before the first month is closed.');
    const wb = writeBatch(db); wb.set(ref('settings', 'profitMode'), { pooled: !!b.pooled, updatedTs: now() }); auditIn(wb, null, 'profit.mode', 'settings', 'profitMode', { pooled: !!b.pooled }); await wb.commit().catch(wrap('Could not save')); return { ok: true };
  }
  async function reserveSave(b) {
    need('capital.manage'); const pct = Number(b.pct); if (!(pct >= 0 && pct <= 100)) throw bad('BAD_INPUT', 'Enter a percentage from 0 to 100.');
    const wb = writeBatch(db); wb.set(ref('settings', 'reserve'), { pct: Math.round(pct * 10) / 10, updatedTs: now() }); auditIn(wb, null, 'capital.reserve', 'settings', 'reserve', { pct });
    await wb.commit().catch(wrap('Could not save')); return { ok: true };
  }

  // ---------- daily summary ----------
  async function dailySummary(q) {
    need('dashboard.view'); const date = ymd(q.date);
    const stores = (await B.loadStores()).filter((x) => x.active !== false && x.kind !== 'warehouse' && (can('dashboard.all_stores') || S().stores.includes(x.id)));
    const exps = can('expenses.manage') ? await list('expenses') : [];
    const lines = []; let total = 0; let orders = 0;
    for (const st of stores) {
      const d = await getDoc(ref('dailyStats', `${st.id}_${date}`)); const x = d.exists() ? d.data() : {}; const sales = x.salesCents || 0; const by = x.byMethod || {};
      const ex = exps.filter((e) => Number(e.storeId) === st.id && e.date === date).reduce((n, e) => n + (e.amountCents || 0), 0);
      total += sales; orders += x.orders || 0;
      lines.push({ store_id: st.id, name: st.name, sales_cents: sales, orders: x.orders || 0, cash_cents: by.cash || 0, khqr_cents: by.khqr || 0, expenses_cents: ex });
    }
    const f = (c) => `$${(c / 100).toFixed(2)}`;
    const text = [`Angkor Formal — ${date}`, ...lines.map((l) => `${l.name}: ${f(l.sales_cents)} (${l.orders} orders, cash ${f(l.cash_cents)}, KHQR ${f(l.khqr_cents)}${l.expenses_cents ? `, expenses ${f(l.expenses_cents)}` : ''})`), `Total: ${f(total)} · ${orders} orders`].join('\n');
    return { date, rows: lines, total_cents: total, orders, text };
  }

  // ---------- export everything (owner) ----------
  async function exportAll() {
    need('settings.manage'); if (S().user.role !== 'owner') throw bad('FORBIDDEN', 'Only the owner can export.');
    const stores = await B.loadStores(); const cat = await B.loadCatalog(); const costs = new Map((await list('costs')).map((c) => [String(c.id), c.costCents || 0]));
    const sn = new Map(stores.map((x) => [x.id, x.name])); const usd = (c) => Math.round(c || 0) / 100; const day = (t) => (t ? new Date(t + 7 * 3600000).toISOString().replace('T', ' ').slice(0, 16) : '');
    const sales = []; const lines = [];
    for (const st of stores) for (const s of await list('sales', where('storeId', '==', st.id))) {
      sales.push({ Date: day(s.ts), Receipt: s.receiptNo, Store: st.name, Cashier: s.cashierName, Customer: s.customerName || '', Phone: s.customerPhone || '', Subtotal: usd(s.subtotalCents), Discount: usd(s.discountCents), Total: usd(s.totalCents), Status: s.status, Deposit: s.deposit ? 'yes' : '', BalanceAtSale: usd(s.balanceCents), Alteration: s.alteration ? 'yes' : '' });
      for (const l of s.lines || []) lines.push({ Date: day(s.ts), Receipt: s.receiptNo, Store: st.name, SKU: l.sku, Product: l.nameEn, Size: l.size, Qty: l.qty, UnitPrice: usd(l.unitCents), LineTotal: usd(l.totalCents), Status: s.status });
    }
    const stockAll = await B.stockOfAll(); const itemBy = new Map(cat.items.map((i) => [Number(i.id), i]));
    const stock = stockAll.map((x) => { const it = itemBy.get(Number(x.itemId)); const d = it ? cat.designs.get(String(it.designId)) : null; return { Store: sn.get(Number(x.storeId)) || x.storeId, SKU: it?.sku || x.itemId, Product: d?.nameEn || '', Size: it?.size || '', OnHand: x.onHand || 0, Reserved: x.reserved || 0 }; });
    const items = cat.items.map((i) => { const d = cat.designs.get(String(i.designId)); return { SKU: i.sku, Product: d?.nameEn || '', Size: i.size, Price: usd(d?.priceCents), Cost: usd(costs.get(String(i.designId))), Active: i.active !== false ? 'yes' : '' }; });
    const expenses = (await list('expenses')).sort((a, b) => String(a.date).localeCompare(b.date)).map((e) => ({ Date: e.date, Store: sn.get(Number(e.storeId)) || e.storeId, Category: e.category, Amount: usd(e.amountCents), Note: e.note || '', By: e.createdByName || '' }));
    const attendance = (await list('attendance')).sort((a, b) => String(a.date).localeCompare(b.date)).map((a) => ({ Date: a.date, Store: sn.get(Number(a.storeId)) || a.storeId, Staff: a.userName || a.userId, In: day(a.inTs), Out: day(a.outTs), Manual: a.manual ? 'yes' : '', Excused: a.excused ? 'yes' : '' }));
    const customers = (await list('customers')).map((c) => ({ Name: c.name, Phone: c.phone || '', Note: c.note || '' }));
    const sh = await list('shareholders'); const shn = new Map(sh.map((x) => [x.id, x.name]));
    const shareholders = sh.map((x) => ({ Name: x.name, ...Object.fromEntries(stores.map((st) => [`Agreed ${st.name}`, usd((x.agreedByStore || {})[st.id] || 0)])), Active: x.active !== false ? 'yes' : '' }));
    const capital = (await list('capitalPayments')).sort((a, b) => String(a.date).localeCompare(b.date)).map((p) => ({ Date: p.date, Shareholder: shn.get(p.shareholderId) || p.shareholderId, Store: sn.get(Number(p.storeId)) || p.storeId, Amount: usd(p.amountCents), Type: p.kind, Note: p.note || '' }));
    const balances = (await list('balances')).map((r) => ({ Receipt: r.receiptNo, Store: sn.get(Number(r.storeId)) || r.storeId, Customer: r.customerName, Phone: r.customerPhone, Total: usd(r.totalCents), Paid: usd(r.paidCents), Balance: usd(r.balanceCents), Due: r.dueDate || '', Settled: r.settled ? 'yes' : '' }));
    const jobs = (await list('alterations')).map((j) => ({ Receipt: j.receiptNo, Store: sn.get(Number(j.storeId)) || j.storeId, Customer: j.customerName, Phone: j.customerPhone, Items: j.summary, Notes: j.notes, Due: j.dueDate || '', Status: j.status }));
    const counts = (await list('stocktakes')).flatMap((t) => (t.lines || []).map((l) => ({ Date: t.date, Store: sn.get(Number(t.storeId)) || t.storeId, SKU: l.sku, Expected: l.expected, Counted: l.counted, Difference: l.diff, Corrected: t.applied ? 'yes' : '' })));
    return { sheets: { Sales: sales, 'Sale lines': lines, Stock: stock, Products: items, Expenses: expenses, Attendance: attendance, Customers: customers, Shareholders: shareholders, 'Capital payments': capital, 'Profit months': (await list('profitCloses')).sort((x, y) => String(x.id).localeCompare(String(y.id))).map((c) => ({ Month: c.month, Where: c.key === 'all' ? 'All shops' : (sn.get(Number(c.key)) || c.key), Sales: usd(c.salesCents), 'Cost of goods': usd(c.cogsCents), Expenses: usd(c.expensesCents), 'Shared costs': usd(c.sharedCents), Profit: usd(c.netCents), 'Kept for production': usd(c.reserveCents), 'To share': usd(c.shareCents), Shares: c.holders.map((h) => `${h.name} ${usd(h.shareCents)}`).join('; ') })), 'Profit payouts': (await list('profitPayouts')).sort((x, y) => (x.ts || 0) - (y.ts || 0)).map((p) => ({ Date: p.date, Where: p.key === 'all' ? 'All shops' : (sn.get(Number(p.key)) || p.key), Shareholder: shn.get(p.shareholderId) || p.shareholderId, Amount: usd(p.amountCents), Note: p.note || '' })), Balances: balances, Alterations: jobs, 'Stock counts': counts } };
  }

  // ---------- owner-editable lists: brands, types (kinds), colours, size sets ----------
  const ownerOnly = () => { need('settings.manage'); if (S().user.role !== 'owner') throw bad('FORBIDDEN', 'Only the owner can change these lists.'); };
  const codeOk = (c, min, max, what) => { const v = String(c || '').trim().toUpperCase(); if (!new RegExp(`^[A-Z0-9]{${min},${max}}$`).test(v)) throw bad('BAD_INPUT', `${what} code must be ${min}–${max} letters or numbers, no spaces.`); return v; };
  async function listSave(kind, id, b) {
    ownerOnly(); const cat = await B.loadCatalog(true); const nameEn = txt(b.name_en ?? b.name, 80).trim(); if (!nameEn) throw bad('BAD_INPUT', 'Enter a name.');
    const wb = writeBatch(db);
    if (kind === 'brands') {
      if (id) { if (!cat.brandsList.find((x) => String(x.id) === String(id))) throw notFound(); wb.update(ref('brands', id), { name: nameEn }); const pub = await list('publicStores'); void pub; }
      else { const code = codeOk(b.code, 2, 5, 'Brand'); if (cat.brandsList.some((x) => x.code === code)) throw bad('DUPLICATE', 'This brand code already exists.'); const nid = Math.max(0, ...cat.brandsList.map((x) => Number(x.id))) + 1; wb.set(ref('brands', nid), { id: nid, code, name: nameEn }); }
    } else if (kind === 'types') {
      const nameKm = txt(b.name_km, 80).trim() || null;
      if (id) { if (!cat.typesList.find((x) => x.code === id)) throw notFound(); wb.update(ref('types', id), { nameEn, nameKm }); }
      else { const code = codeOk(b.code, 1, 3, 'Type'); if (cat.typesList.some((x) => x.code === code)) throw bad('DUPLICATE', 'This type code already exists.'); wb.set(ref('types', code), { code, nameEn, nameKm }); }
    } else if (kind === 'colours') {
      const nameKm = txt(b.name_km, 80).trim() || null; const hex = /^#[0-9a-fA-F]{6}$/.test(String(b.hex || '')) ? b.hex : '#999999';
      if (id) { if (!cat.coloursList.find((x) => x.code === id)) throw notFound(); wb.update(ref('colours', id), { nameEn, nameKm, hex }); }
      else { const code = codeOk(b.code, 2, 4, 'Colour'); if (cat.coloursList.some((x) => x.code === code)) throw bad('DUPLICATE', 'This colour code already exists.'); wb.set(ref('colours', code), { code, nameEn, nameKm, hex }); }
    } else throw notFound();
    auditIn(wb, null, `list.${kind}.${id ? 'rename' : 'add'}`, kind, id || b.code || '', { name: nameEn }); await wb.commit().catch(wrap('Could not save')); await B.loadCatalog(true); return { ok: true };
  }
  async function listDelete(kind, id) {
    ownerOnly(); const cat = await B.loadCatalog(true); const wb = writeBatch(db);
    if (kind === 'brands') { if ([...cat.designs.values()].some((d) => String(d.brandId) === String(id))) throw bad('IN_USE', 'Products use this brand, so it cannot be deleted.'); if ((await list('stores')).some((x) => String(x.brandId) === String(id))) throw bad('IN_USE', 'A store uses this brand.'); wb.delete(ref('brands', id)); }
    else if (kind === 'types') { if ([...cat.designs.values()].some((d) => d.typeCode === id)) throw bad('IN_USE', 'Products use this type, so it cannot be deleted.'); wb.delete(ref('types', id)); }
    else if (kind === 'colours') { if (cat.items.some((i) => i.colourCode === id)) throw bad('IN_USE', 'Products use this colour, so it cannot be deleted.'); wb.delete(ref('colours', id)); }
    else throw notFound();
    auditIn(wb, null, `list.${kind}.delete`, kind, id, {}); await wb.commit().catch(wrap('Could not delete')); await B.loadCatalog(true); return { ok: true };
  }
  async function fundersGet() { const d = await read('settings', 'funders'); return { funders: Array.isArray(d?.list) ? d.list : [] }; }
  async function fundersSave(b) {
    ownerOnly(); const seen = new Set(); const out = [];
    for (const x of Array.isArray(b.funders) ? b.funders : []) { const code = txt(x.code, 12).trim().toUpperCase().replace(/\s+/g, ''); const name = txt(x.name, 80).trim(); if (!code) continue; if (seen.has(code)) throw bad('DUPLICATE', `Funder ${code} is listed twice.`); seen.add(code); out.push({ code, name }); }
    await setDoc(ref('settings', 'funders'), { list: out, ts: now(), setBy: S().uid }); return { ok: true };
  }
  const DEFAULT_SIZE_SETS = { Suit: ['44', '46', '48', '50', '52', '54', '56'], Shirt: ['S', 'M', 'L', 'XL', 'XXL'], Waist: ['30', '32', '34', '36', '38'], 'One size': ['ONE'] };
  async function sizeSets() { const d = await read('settings', 'sizeSets'); return { size_sets: d?.sets || DEFAULT_SIZE_SETS, type_groups: d?.typeGroups || {} }; }
  async function sizeSetsSave(b) {
    ownerOnly(); const out = {};
    for (const [k, v] of Object.entries(b.sets || {})) { const name = txt(k, 30).trim(); const sizes = [...new Set((Array.isArray(v) ? v : []).map((x) => txt(x, 8).trim().toUpperCase()).filter(Boolean))].slice(0, 40); if (name && sizes.length) out[name] = sizes; }
    if (!Object.keys(out).length) throw bad('BAD_INPUT', 'Keep at least one size group.');
    const tg = {}; for (const [code, gs] of Object.entries(b.type_groups || {})) { const keep = (Array.isArray(gs) ? gs : []).filter((g) => out[g]); if (keep.length) tg[String(code).slice(0, 8)] = keep; }
    await setDoc(ref('settings', 'sizeSets'), { sets: out, typeGroups: tg, ts: now(), setBy: S().uid }); return { ok: true };
  }

  async function route(method, path, q, b) {
    let m;
    if (method === 'GET' && path === '/lists/funders') return fundersGet();
    if (method === 'POST' && path === '/lists/funders') return fundersSave(b);
    if (method === 'GET' && path === '/lists/sizes') return sizeSets();
    if (method === 'POST' && path === '/lists/sizes') return sizeSetsSave(b);
    if (method === 'POST' && (m = path.match(/^\/lists\/(brands|types|colours)$/))) return listSave(m[1], null, b);
    if (method === 'POST' && (m = path.match(/^\/lists\/(brands|types|colours)\/([^/]+)\/delete$/))) return listDelete(m[1], m[2]);
    if (method === 'POST' && (m = path.match(/^\/lists\/(brands|types|colours)\/([^/]+)$/))) return listSave(m[1], m[2], b);
    if (method === 'GET' && path === '/balances') return balancesList(q);
    if (method === 'POST' && (m = path.match(/^\/balances\/([^/]+)\/collect$/))) return collect(m[1], b);
    if (method === 'GET' && path === '/alterations') return jobsList(q);
    if (method === 'POST' && (m = path.match(/^\/alterations\/([^/]+)$/))) return jobUpdate(m[1], b);
    if (method === 'GET' && path === '/report') return report(q);
    if (method === 'GET' && path === '/capital/profit') return profit(q);
    if (method === 'POST' && path === '/capital/reserve') return reserveSave(b);
    if (method === 'POST' && path === '/capital/profit/close') return profitClose(b);
    if (method === 'POST' && path === '/capital/profit/reopen') return profitReopen(b);
    if (method === 'POST' && path === '/capital/profit/pay') return profitPay(b);
    if (method === 'POST' && path === '/capital/profit/mode') return profitMode(b);
    if (method === 'POST' && (m = path.match(/^\/capital\/profit\/pay\/([^/]+)\/reverse$/))) return profitPayReverse(m[1], b);
    if (method === 'GET' && path === '/summary/daily') return dailySummary(q);
    if (method === 'GET' && path === '/export') return exportAll();
    return undefined;
  }
  return { route };
}
export { ApiErr };
