// Deposits and balances, alteration jobs, shareholder report, daily summary, data export.
import { ApiErr, khrToUsdCents, khrTolerance, dateOf } from './backend.js';

export function createMore(B) {
  const { fs, db } = B.deps;
  const { doc, collection, getDoc, writeBatch, where } = fs;
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
    const stores = (await B.loadStores()).filter((x) => x.active !== false); const sel = String(q.store_id || 'all'); const ids = sel === 'all' ? stores.map((x) => x.id) : [Number(sel)];
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

  // ---------- daily summary ----------
  async function dailySummary(q) {
    need('dashboard.view'); const date = ymd(q.date);
    const stores = (await B.loadStores()).filter((x) => x.active !== false && (can('dashboard.all_stores') || S().stores.includes(x.id)));
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
      for (const l of s.lines || []) lines.push({ Date: day(s.ts), Receipt: s.receiptNo, Store: st.name, SKU: l.sku, Product: l.nameEn, Colour: l.colourEn, Size: l.size, Qty: l.qty, UnitPrice: usd(l.unitCents), LineTotal: usd(l.totalCents), Status: s.status });
    }
    const stockAll = await B.stockOfAll(); const itemBy = new Map(cat.items.map((i) => [Number(i.id), i]));
    const stock = stockAll.map((x) => { const it = itemBy.get(Number(x.itemId)); const d = it ? cat.designs.get(String(it.designId)) : null; return { Store: sn.get(Number(x.storeId)) || x.storeId, SKU: it?.sku || x.itemId, Product: d?.nameEn || '', Size: it?.size || '', OnHand: x.onHand || 0, Reserved: x.reserved || 0 }; });
    const items = cat.items.map((i) => { const d = cat.designs.get(String(i.designId)); return { SKU: i.sku, Product: d?.nameEn || '', Size: i.size, Colour: i.colourCode, Price: usd(d?.priceCents), Cost: usd(costs.get(String(i.designId))), Active: i.active !== false ? 'yes' : '' }; });
    const expenses = (await list('expenses')).sort((a, b) => String(a.date).localeCompare(b.date)).map((e) => ({ Date: e.date, Store: sn.get(Number(e.storeId)) || e.storeId, Category: e.category, Amount: usd(e.amountCents), Note: e.note || '', By: e.createdByName || '' }));
    const attendance = (await list('attendance')).sort((a, b) => String(a.date).localeCompare(b.date)).map((a) => ({ Date: a.date, Store: sn.get(Number(a.storeId)) || a.storeId, Staff: a.userName || a.userId, In: day(a.inTs), Out: day(a.outTs), Manual: a.manual ? 'yes' : '', Excused: a.excused ? 'yes' : '' }));
    const customers = (await list('customers')).map((c) => ({ Name: c.name, Phone: c.phone || '', Note: c.note || '' }));
    const sh = await list('shareholders'); const shn = new Map(sh.map((x) => [x.id, x.name]));
    const shareholders = sh.map((x) => ({ Name: x.name, ...Object.fromEntries(stores.map((st) => [`Agreed ${st.name}`, usd((x.agreedByStore || {})[st.id] || 0)])), Active: x.active !== false ? 'yes' : '' }));
    const capital = (await list('capitalPayments')).sort((a, b) => String(a.date).localeCompare(b.date)).map((p) => ({ Date: p.date, Shareholder: shn.get(p.shareholderId) || p.shareholderId, Store: sn.get(Number(p.storeId)) || p.storeId, Amount: usd(p.amountCents), Type: p.kind, Note: p.note || '' }));
    const balances = (await list('balances')).map((r) => ({ Receipt: r.receiptNo, Store: sn.get(Number(r.storeId)) || r.storeId, Customer: r.customerName, Phone: r.customerPhone, Total: usd(r.totalCents), Paid: usd(r.paidCents), Balance: usd(r.balanceCents), Due: r.dueDate || '', Settled: r.settled ? 'yes' : '' }));
    const jobs = (await list('alterations')).map((j) => ({ Receipt: j.receiptNo, Store: sn.get(Number(j.storeId)) || j.storeId, Customer: j.customerName, Phone: j.customerPhone, Items: j.summary, Notes: j.notes, Due: j.dueDate || '', Status: j.status }));
    const counts = (await list('stocktakes')).flatMap((t) => (t.lines || []).map((l) => ({ Date: t.date, Store: sn.get(Number(t.storeId)) || t.storeId, SKU: l.sku, Expected: l.expected, Counted: l.counted, Difference: l.diff, Corrected: t.applied ? 'yes' : '' })));
    return { sheets: { Sales: sales, 'Sale lines': lines, Stock: stock, Products: items, Expenses: expenses, Attendance: attendance, Customers: customers, Shareholders: shareholders, 'Capital payments': capital, Balances: balances, Alterations: jobs, 'Stock counts': counts } };
  }

  async function route(method, path, q, b) {
    let m;
    if (method === 'GET' && path === '/balances') return balancesList(q);
    if (method === 'POST' && (m = path.match(/^\/balances\/([^/]+)\/collect$/))) return collect(m[1], b);
    if (method === 'GET' && path === '/alterations') return jobsList(q);
    if (method === 'POST' && (m = path.match(/^\/alterations\/([^/]+)$/))) return jobUpdate(m[1], b);
    if (method === 'GET' && path === '/report') return report(q);
    if (method === 'GET' && path === '/summary/daily') return dailySummary(q);
    if (method === 'GET' && path === '/export') return exportAll();
    return undefined;
  }
  return { route };
}
export { ApiErr };
