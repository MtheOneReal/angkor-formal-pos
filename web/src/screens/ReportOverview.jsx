import React, { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { usd, usdShort } from '../format.js';

const phnom = () => new Date(Date.now() + 7 * 3600000);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const diff = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const mStart = (s, off = 0) => { const d = new Date(`${s.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + off); return iso(d); };
const mEnd = (s, off = 0) => addDays(mStart(s, off + 1), -1);

function ranges(p) {
  const today = iso(phnom());
  if (p === 'today') return { cur: [today, today], prev: [addDays(today, -1), addDays(today, -1)] };
  if (p === 'yesterday') { const y = addDays(today, -1); return { cur: [y, y], prev: [addDays(y, -1), addDays(y, -1)] }; }
  if (p === '7d') return { cur: [addDays(today, -6), today], prev: [addDays(today, -13), addDays(today, -7)] };
  if (p === 'month') { const a = mStart(today); const n = diff(a, today); const pa = mStart(today, -1); const pe = addDays(pa, n); return { cur: [a, today], prev: [pa, pe > mEnd(today, -1) ? mEnd(today, -1) : pe] }; }
  const a = mStart(today, -1); return { cur: [a, mEnd(today, -1)], prev: [mStart(today, -2), mEnd(today, -2)] };
}
const fill = ([a, b], trend) => { const m = new Map(trend.map((t) => [t.day, t])); const o = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push({ day: d, cents: m.get(d)?.cents || 0, n: m.get(d)?.n || 0 }); return o; };

function Change({ cur, prev, L, good = 'up' }) {
  if (!prev) return <span className="small muted">{cur ? L('new – nothing before', 'ថ្មី – មុនមិនមាន') : ''}</span>;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100); if (pct === 0) return <span className="small muted">{L('same as before', 'ដូចមុន')}</span>;
  const up = pct > 0; const ok = (good === 'up') === up;
  return <span className="small" style={{ color: ok ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>{up ? '▲' : '▼'} {Math.abs(pct)}% {up ? L('more', 'ច្រើនជាង') : L('less', 'តិចជាង')}</span>;
}
const Tile = ({ l, v, cur, prev, L, good, sub }) => <div className="card kpi"><div className="l">{l}</div><div className="v num">{v}</div><Change cur={cur} prev={prev} L={L} good={good} />{sub && <div className="small muted">{sub}</div>}</div>;

function Days({ a, b, L }) {
  const w = 640; const h = 150; const cap = 46; const max = Math.max(1, ...a.map((x) => x.cents), ...b.map((x) => x.cents)); const n = Math.max(a.length, 1); const bw = Math.min(w / n, 70); const x0 = (w - bw * n) / 2;
  const lab = (d) => d.slice(5).replace('-', '/');
  return (
    <svg viewBox={`0 0 ${w} ${h + 22}`} style={{ width: '100%' }} role="img" aria-label="Sales per day">
      {a.map((x, i) => { const bh = (x.cents / max) * h; const pb = b[i] ? (b[i].cents / max) * h : 0; return (
        <g key={x.day}>
          {b[i] && <rect x={x0 + i * bw + 2} y={h - pb} width={Math.max(2, bw - 4)} height={pb} rx="3" fill="none" stroke="var(--muted)" strokeDasharray="3 2"><title>{lab(b[i].day)}: {usd(b[i].cents)}</title></rect>}
          <rect x={x0 + i * bw + 2 + (bw > 14 ? 3 : 0)} y={h - bh} width={Math.max(2, bw - 4 - (bw > 14 ? 6 : 0))} height={bh} rx="3" fill="var(--chart1)"><title>{lab(x.day)}: {usd(x.cents)} · {x.n} {L('sales', 'ការលក់')}</title></rect>
          {(n <= 10 || i % Math.ceil(n / 8) === 0) && <text x={x0 + i * bw + bw / 2} y={h + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">{lab(x.day)}</text>}
        </g>); })}
    </svg>
  );
}

function Bars({ rows, label, value, fmt, colors }) {
  const max = Math.max(1, ...rows.map(value));
  return <div className="col">{rows.map((r, i) => <div key={label(r)}><div className="row between small"><span>{label(r)}</span><b className="num">{fmt(value(r))}</b></div><div className="hbar" style={{ width: `${Math.max(2, (value(r) / max) * 100)}%`, background: colors ? colors[i % colors.length] : undefined }} /></div>)}</div>;
}
const COL = ['var(--chart1)', '#3b6ea5', '#7a9e6c', '#b9573f', '#8b6aa8'];


function Follow({ sel, L }) {
  const [days, setDays] = useState(60); const [d, setD] = useState(null); const [err, setErr] = useState(''); const [copied, setCopied] = useState('');
  useEffect(() => { setD(null); setErr(''); api.get(`/report/follow${qs({ store_id: sel, days })}`).then(setD).catch((e) => setErr(e.message)); }, [sel, days]);
  const msg = (r) => `សួស្តី ${r.customer_name || ''} ពី ${r.store_name}។ សូមរំលឹកថាអ្នកនៅសល់ប្រាក់ ${usd(r.balance_cents)} សម្រាប់វិក្កយបត្រ ${r.receipt_no}។ សូមអញ្ជើញមកយកទំនិញ និងបង់ប្រាក់ដែលនៅសល់។ សូមអរគុណ!`;
  const copy = async (r) => { try { await navigator.clipboard.writeText(msg(r)); setCopied(r.receipt_no); setTimeout(() => setCopied(''), 2000); } catch { setErr(L('Could not copy.', 'មិនអាចចម្លងបានទេ។')); } };
  const tel = (x) => String(x || '').replace(/[^\d+]/g, '');
  const rank = (r) => (r.days_late > 0 ? 0 : r.due_date === iso(phnom()) ? 1 : 2);
  const rows = d ? [...d.pickups].sort((a, b) => rank(a) - rank(b)) : [];
  return (
    <div style={{ marginTop: 22 }}>
      <h2 style={{ margin: '0 0 4px' }}>{L('Follow up', 'តាមដាន')}</h2>
      {err && <div className="error">{err}</div>}
      {!d && !err && <p className="muted">…</p>}
      {d && <div className="grid g2" style={{ marginTop: 8 }}>
        <div className="card"><h3>{L('Customers to call', 'អតិថិជនត្រូវទូរស័ព្ទ')}</h3>
          {!rows.length ? <p className="muted">{L('No open deposits. 👍', 'គ្មានការកក់ទេ។ 👍')}</p> : <div className="col">{rows.slice(0, 10).map((r) => (
            <div key={r.receipt_no} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div className="row between"><b>{r.customer_name || r.receipt_no}</b><b className="num">{usd(r.balance_cents)}</b></div>
              <div className="small" style={{ color: r.days_late > 0 ? 'var(--bad)' : 'var(--muted)', fontWeight: r.days_late > 0 ? 600 : 400 }}>
                {r.days_late > 0 ? L(`${r.days_late} days late`, `យឺត ${r.days_late} ថ្ងៃ`) : r.due_date === iso(phnom()) ? L('Pickup today', 'យកថ្ងៃនេះ') : r.due_date ? `${L('Pickup', 'យក')} ${r.due_date.slice(5)}` : L('No pickup date', 'គ្មានកាលបរិច្ឆេទ')} · {r.store_name}</div>
              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                {r.customer_phone && <a className="btn" href={`tel:${tel(r.customer_phone)}`}>📞 {L('Call', 'ទូរស័ព្ទ')} {r.customer_phone}</a>}
                <button className="btn" onClick={() => copy(r)}>{copied === r.receipt_no ? L('Copied ✓', 'បានចម្លង ✓') : L('Copy Khmer message', 'ចម្លងសារខ្មែរ')}</button>
                {r.customer_phone && <a className="btn" href={`sms:${tel(r.customer_phone)}?&body=${encodeURIComponent(msg(r))}`}>✉️ SMS</a>}</div></div>))}
            {rows.length > 10 && <p className="small muted">{L(`+ ${rows.length - 10} more`, `+ ទៀត ${rows.length - 10}`)}</p>}</div>}</div>
        <div className="card"><div className="row between wrap"><h3>{L('Not selling', 'មិនសូវលក់ដាច់')}</h3>
          <div className="row" style={{ gap: 6 }}>{[30, 60, 90].map((n) => <button key={n} className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>{n} {L('days', 'ថ្ងៃ')}</button>)}</div></div>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>{L(`In stock but nothing sold in ${days} days. Try moving them to another shop or discounting.`, `មានស្តុក តែមិនបានលក់ក្នុង ${days} ថ្ងៃ។ ព្យាយាមផ្ទេរទៅហាងផ្សេង ឬបញ្ចុះតម្លៃ។`)}</p>
          {!d.slow.length ? <p className="muted">{L('Everything has sold recently. 👍', 'ទំនិញទាំងអស់បានលក់ថ្មីៗ។ 👍')}</p> : <>
            <p style={{ margin: '0 0 6px' }}><b className="num" style={{ fontSize: 22 }}>{d.slow_pieces}</b> <span className="muted small">{L('pieces', 'ដុំ')}{d.slow_value_cents != null && <> · {L('money tied up', 'លុយជាប់')} <b>{usd(d.slow_value_cents)}</b></>}</span></p>
            <div className="col small">{d.slow.map((x, i) => <div key={i} className="row between"><span>{(L(x.name_en, x.name_km || x.name_en))}{sel === 'all' && <span className="muted"> · {x.store_name}</span>}</span><b className="num">{x.pieces} {L('pcs', 'ដុំ')}{x.value_cents != null && <span className="muted"> · {usdShort(x.value_cents)}</span>}</b></div>)}
              {d.slow_count > d.slow.length && <span className="muted">{L(`+ ${d.slow_count - d.slow.length} more designs`, `+ ម៉ូដែលទៀត ${d.slow_count - d.slow.length}`)}</span>}</div></>}</div>
      </div>}
    </div>
  );
}

export default function Overview({ sel, stores, L }) {
  const [p, setP] = useState('today'); const [d, setD] = useState(null); const [err, setErr] = useState('');
  const R = useMemo(() => ranges(p), [p]);
  useEffect(() => {
    setD(null); setErr('');
    const q = (r) => api.get(`/dashboard${qs({ store: sel, period: 'custom', from: r[0], to: r[1] })}`);
    Promise.all([q(R.cur), q(R.prev), api.get(`/report/extras${qs({ store_id: sel, from: R.cur[0], to: R.cur[1] })}`)])
      .then(([c, pv, x]) => setD({ c, pv, x })).catch((e) => setErr(e.message));
  }, [sel, p]);
  const tabs = [['today', L('Today', 'ថ្ងៃនេះ'), L('yesterday', 'ម្សិលមិញ')], ['yesterday', L('Yesterday', 'ម្សិលមិញ'), L('the day before', 'មុននេះមួយថ្ងៃ')], ['7d', L('Last 7 days', '៧ថ្ងៃចុងក្រោយ'), L('the 7 days before', '៧ថ្ងៃមុន')], ['month', L('This month', 'ខែនេះ'), L('same days last month', 'ថ្ងៃដូចគ្នាខែមុន')], ['lastmonth', L('Last month', 'ខែមុន'), L('the month before', 'ខែមុនទៀត')]];
  const vs = tabs.find((t) => t[0] === p)[2];
  let body = null;
  if (d) {
    const c = d.c.cards; const pc = d.pv.cards; const seeCost = c.gross_profit_cents != null;
    const profit = c.net_profit_cents ?? c.gross_profit_cents; const pprofit = pc.net_profit_cents ?? pc.gross_profit_cents;
    const A = fill(R.cur, d.c.trend); const B = fill(R.prev, d.pv.trend);
    const best = A.reduce((m, x) => (x.cents > m.cents ? x : m), A[0]); const single = d.c.scope.stores.length === 1;
    const sentences = [];
    if (!c.orders) sentences.push(L('No sales in this period yet.', 'មិនទាន់មានការលក់ក្នុងអំឡុងពេលនេះទេ។'));
    else {
      sentences.push(L(`You sold ${usd(c.sales_cents)} from ${c.orders} ${c.orders === 1 ? 'customer' : 'customers'}.`, `អ្នកលក់បាន ${usd(c.sales_cents)} ពីអតិថិជន ${c.orders} នាក់។`));
      if (pc.sales_cents) { const pct = Math.round(((c.sales_cents - pc.sales_cents) / pc.sales_cents) * 100); sentences.push(pct >= 0 ? L(`That is ${pct}% more than ${vs}.`, `ច្រើនជាង${vs} ${pct}%។`) : L(`That is ${-pct}% less than ${vs}.`, `តិចជាង${vs} ${-pct}%។`)); }
      if (A.length > 1 && best.cents) sentences.push(L(`Best day: ${best.day.slice(5).replace('-', '/')} (${usd(best.cents)}).`, `ថ្ងៃលក់ដាច់បំផុត៖ ${best.day.slice(5).replace('-', '/')} (${usd(best.cents)})។`));
      if (!single && d.c.by_store.length) { const t = [...d.c.by_store].sort((x, y) => y.sales_cents - x.sales_cents)[0]; if (t.sales_cents) sentences.push(L(`Top shop: ${t.name}.`, `ហាងលក់ល្អបំផុត៖ ${t.name}។`)); }
    }
    const low = d.c.alerts.filter((a) => a.kind === 'low_stock');
    const shopsName = (id) => d.c.scope.stores.find((s) => s.id === id)?.name || '';
    body = (<>
      <div className="card" style={{ margin: '12px 0' }}><b>{L('In plain words', 'និយាយងាយៗ')}</b><p style={{ margin: '6px 0 0' }}>{sentences.join(' ')}</p></div>
      <div className="grid g4">
        <Tile l={L('Money in (sales)', 'លុយចូល (ការលក់)')} v={usd(c.sales_cents)} cur={c.sales_cents} prev={pc.sales_cents} L={L} sub={`${L('vs', 'ធៀបនឹង')} ${vs}: ${usd(pc.sales_cents)}`} />
        {seeCost && <Tile l={L('Money kept (profit)', 'លុយនៅសល់ (ចំណេញ)')} v={usd(profit)} cur={profit} prev={pprofit} L={L} sub={c.net_profit_cents != null ? L('after clothes cost and expenses', 'ក្រោយដកថ្លៃទំនិញ និងចំណាយ') : L('after clothes cost', 'ក្រោយដកថ្លៃទំនិញ')} />}
        <Tile l={L('Customers', 'អតិថិជន')} v={c.orders} cur={c.orders} prev={pc.orders} L={L} sub={L('number of sales', 'ចំនួនការលក់')} />
        <Tile l={L('Average per customer', 'មធ្យមក្នុងម្នាក់')} v={usd(c.avg_basket_cents)} cur={c.avg_basket_cents} prev={pc.avg_basket_cents} L={L} />
      </div>
      {A.length > 1 && <div className="card" style={{ marginTop: 12 }}><h3>{L('Sales each day', 'ការលក់ក្នុងមួយថ្ងៃ')}</h3><Days a={A} b={B} L={L} />
        <p className="small muted" style={{ marginTop: 4 }}><span style={{ color: 'var(--chart1)' }}>■</span> {L('this period', 'អំឡុងពេលនេះ')} &nbsp; <span style={{ color: 'var(--muted)' }}>▭</span> {L(`dotted = ${vs}`, `ចំណុច = ${vs}`)}</p></div>}
      <div className="grid g2" style={{ marginTop: 12 }}>
        {!single && d.c.by_store.length > 1 && <div className="card"><h3>{L('Which shop sold most', 'ហាងណាលក់ច្រើនជាង')}</h3>
          <Bars rows={[...d.c.by_store].sort((a, b) => b.sales_cents - a.sales_cents)} label={(r) => r.name} value={(r) => r.sales_cents} fmt={usd} colors={COL} /></div>}
        <div className="card"><h3>{L('Best sellers', 'ទំនិញលក់ដាច់')}</h3>{d.c.top_items.length ? <Bars rows={d.c.top_items.slice(0, 6)} label={(r) => r.name_en || r.sku} value={(r) => r.qty} fmt={(v) => `${v} ${L('pcs', 'ដុំ')}`} colors={COL} /> : <p className="muted">{L('Nothing sold yet.', 'មិនទាន់លក់ទេ។')}</p>}</div>
        <div className="card"><h3>{L('How customers paid', 'អតិថិជនបង់ដោយរបៀបណា')}</h3>{d.c.methods.length ? <Bars rows={d.c.methods} label={(r) => ({ cash: L('Cash', 'សាច់ប្រាក់'), usd: L('Cash USD', 'សាច់ប្រាក់ USD'), khr: L('Cash Riel', 'សាច់ប្រាក់រៀល'), khqr: 'KHQR' }[r.method] || r.method.toUpperCase())} value={(r) => r.cents} fmt={usd} colors={COL} /> : <p className="muted">—</p>}</div>
        {d.x.expenses_by_category.length > 0 && <div className="card"><h3>{L('What the shop spent on', 'ចំណាយលើអ្វីខ្លះ')}</h3><Bars rows={d.x.expenses_by_category.slice(0, 6)} label={(r) => r.category} value={(r) => r.cents} fmt={usd} colors={COL} />
          <p className="small muted" style={{ marginTop: 6 }}>{L('Total', 'សរុប')}: <b>{usd(d.x.expenses_total_cents)}</b></p></div>}
        <div className="card"><h3>{L('Customers still owe you', 'អតិថិជនជំពាក់អ្នក')}</h3>
          {d.x.owed.count === 0 ? <p className="muted">{L('Nobody owes anything. 👍', 'គ្មានអ្នកជំពាក់ទេ។ 👍')}</p> : <>
            <p style={{ margin: '0 0 6px' }}><b className="num" style={{ fontSize: 22 }}>{usd(d.x.owed.total_cents)}</b> <span className="muted small">{L(`from ${d.x.owed.count} deposit sales`, `ពីការកក់ ${d.x.owed.count}`)}</span></p>
            {d.x.owed.overdue_count > 0 && <p className="small" style={{ color: 'var(--bad)', fontWeight: 600, margin: '0 0 6px' }}>⚠ {L(`${d.x.owed.overdue_count} past pickup date (${usd(d.x.owed.overdue_cents)})`, `${d.x.owed.overdue_count} លើសថ្ងៃយក (${usd(d.x.owed.overdue_cents)})`)}</p>}
            <div className="col small">{d.x.owed.rows.slice(0, 5).map((r) => <div key={r.receipt_no} className="row between"><span>{r.customer_name || r.receipt_no}{r.due_date && <span className="muted"> · {r.due_date.slice(5)}</span>}{r.overdue && ' ⚠'}</span><b className="num">{usd(r.balance_cents)}</b></div>)}</div></>}</div>
        {c.discount_cents > 0 && <div className="card kpi"><div className="l">{L('Discounts you gave', 'បញ្ចុះតម្លៃដែលបានឲ្យ')}</div><div className="v num">{usd(c.discount_cents)}</div><div className="small muted">{L('Money you gave up to win sales', 'លុយដែលអ្នកបញ្ចុះដើម្បីលក់')}</div></div>}
        <div className="card"><h3>{L('Running low on stock', 'ស្តុកជិតអស់')}</h3>{low.length ? <div className="col small">{low.slice(0, 8).map((a, i) => <div key={i} className="row between"><span>{a.text.split(':')[0]}{!single && <span className="muted"> · {shopsName(a.store_id)}</span>}</span><b className="num">{a.text.split(':')[1]} {L('left', 'នៅសល់')}</b></div>)}</div> : <p className="muted">{L('Everything is well stocked. 👍', 'ស្តុកគ្រប់គ្រាន់។ 👍')}</p>}</div>
      </div>
      {!seeCost && null}
    </>);
  }
  return (
    <div>
      <div className="row wrap" style={{ gap: 8, margin: '8px 0 0' }}>{tabs.map(([k, lab]) => <button key={k} className={`chip ${p === k ? 'on' : ''}`} onClick={() => setP(k)}>{lab}</button>)}</div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>{R.cur[0] === R.cur[1] ? R.cur[0] : `${R.cur[0]} → ${R.cur[1]}`} · {L('compared with', 'ធៀបនឹង')} {vs}</p>
      {err && <div className="error">{err}</div>}
      {!d && !err && <p className="muted">…</p>}
      {body}
      <Follow sel={sel} L={L} />
    </div>
  );
}
