import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, StoreSelect, Spinner, Modal } from '../ui.jsx';
import { usd, usdShort, day } from '../format.js';

const PERIODS = [['today', 'today'], ['7d', 'week'], ['month', 'month'], ['year', 'year']];
const COLORS = ['var(--chart1)', '#3b6ea5', '#7a9e6c', '#b9573f', '#8b6aa8'];

function Kpi({ l, v, sub }) { return <div className="card kpi"><div className="l">{l}</div><div className="v num">{v}</div>{sub && <div className="small muted">{sub}</div>}</div>; }

function Trend({ data }) {
  const w = 640; const h = 180; const max = Math.max(1, ...data.map((d) => d.cents));
  const bw = w / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${w} ${h + 24}`} style={{ width: '100%' }} role="img" aria-label="Sales per day">
      {data.map((d, i) => { const bh = (d.cents / max) * h; return (
        <g key={d.day}><rect x={i * bw + 3} y={h - bh} width={Math.max(2, bw - 6)} height={bh} rx="3" fill="var(--chart1)"><title>{day(d.day)}: {usd(d.cents)} ({d.n} sales)</title></rect>
          {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && <text x={i * bw + bw / 2} y={h + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">{day(d.day)}</text>}</g>); })}
    </svg>
  );
}

function HBars({ rows, label, value, fmt }) {
  const max = Math.max(1, ...rows.map(value));
  return <div className="col">{rows.map((r, i) => (
    <div key={label(r)}><div className="row between small"><span>{label(r)}</span><b className="num">{fmt(value(r))}</b></div><div className="hbar" style={{ width: `${(value(r) / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div>))}</div>;
}

function DailySummary() {
  const [open, setOpen] = useState(false); const [s, setS] = useState(null); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false);
  const show = async () => { setOpen(true); setErr(''); try { setS(await api.get('/summary/daily')); } catch (e) { setErr(e.message); } };
  const link = () => `https://t.me/share/url?url=${encodeURIComponent(location.origin + location.pathname)}&text=${encodeURIComponent(s.text)}`;
  return (<>
    <button className="btn" onClick={show}>✈️ Telegram summary</button>
    {open && <Modal title="Today's summary" onClose={() => setOpen(false)}>
      {err && <div className="error">{err}</div>}
      {s && <><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--surface2)', padding: 12, borderRadius: 10 }}>{s.text}</pre>
        <div className="row wrap"><a className="btn primary" href={link()} target="_blank" rel="noreferrer">Send in Telegram</a>
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(s.text); setCopied(true); } catch { setErr('Could not copy.'); } }}>{copied ? 'Copied' : 'Copy text'}</button></div>
        <p className="muted small">Telegram opens so you can pick the group or person. Today’s figures update as sales are made.</p></>}
    </Modal>}
  </>);
}

export default function Dashboard() {
  const { me } = useApp(); const t = useT();
  const [sel, setSel] = useState(me.perms.includes('dashboard.all_stores') ? 'all' : String(me.store_id));
  const [period, setPeriod] = useState('7d'); const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setD(null); api.get(`/dashboard${qs({ store: sel, period })}`).then(setD).catch((e) => setErr(e.message)); }, [sel, period]);
  const single = d && d.scope.stores.length === 1;
  return (
    <div>
      <div className="topbar"><h1 className="grow">{t('dashboard')}</h1>
        <StoreSelect value={sel} onChange={setSel} stores={me.stores.filter((s) => s.kind !== 'warehouse')} all={me.perms.includes('dashboard.all_stores')} />
        {me.perms.includes('dashboard.view') && <DailySummary />}
        <div className="row">{PERIODS.map(([k, lab]) => <button key={k} className={`chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{t(lab)}</button>)}</div></div>
      {err && <div className="error">{err}</div>}
      {!d ? <Spinner /> : (<>
        <p className="muted small">{single ? d.scope.stores[0].name : `${d.scope.stores.length} stores`} · {day(d.period.from)} – {day(d.period.to)}</p>
        <div className="grid g4">
          <Kpi l={t('sales_total')} v={usd(d.cards.sales_cents)} /><Kpi l={t('orders')} v={d.cards.orders} /><Kpi l={t('avg_basket')} v={usd(d.cards.avg_basket_cents)} />
          <Kpi l={t('profit')} v={usd(d.cards.gross_profit_cents)} sub="Sales minus cost of goods" />
          {d.cards.expenses_cents != null && <Kpi l="Expenses" v={usd(d.cards.expenses_cents)} sub="Rent, utilities, salaries…" />}
          {d.cards.net_profit_cents != null && <Kpi l="Net profit" v={usd(d.cards.net_profit_cents)} sub="Gross profit minus expenses" />}
          <Kpi l="Units sold" v={d.cards.units} /><Kpi l={t('pieces')} v={d.cards.pieces} sub={me.perms.includes('cost.view') ? `At cost ${usdShort(d.cards.stock_value_cents)}` : ''} />
          <Kpi l="Discounts given" v={usd(d.cards.discount_cents)} /><Kpi l={t('low_stock')} v={d.cards.low_stock} />
        </div>
        <div className="grid g2" style={{ marginTop: 12 }}>
          <div className="card"><h3>Sales per day</h3><Trend data={d.trend} /></div>
          <div className="card"><h3>{single ? 'Payment methods' : 'Sales by store'}</h3>
            {single ? <HBars rows={d.methods} label={(r) => r.method.toUpperCase()} value={(r) => r.cents} fmt={usd} /> : <HBars rows={d.by_store} label={(r) => r.name} value={(r) => r.sales_cents} fmt={usd} />}</div>
        </div>
        <div className="grid g2" style={{ marginTop: 12 }}>
          <div className="card"><h3>Top sellers</h3><HBars rows={d.top_items} label={(r) => `${r.name_en} (${r.sku})`} value={(r) => r.qty} fmt={(v) => `${v} pcs`} /></div>
          <div className="card"><h3>Alerts</h3>{!d.alerts.length && <p className="muted">All clear.</p>}<div className="col">{d.alerts.slice(0, 12).map((a, i) => <div key={i} className="row"><span className="badge low">{a.kind.replace('_', ' ')}</span><span className="small">{a.text}</span></div>)}</div></div>
        </div>
        {!single && <div className="card" style={{ marginTop: 12, overflow: 'auto' }}><h3>Store comparison</h3>
          <table><thead><tr><th>Store</th><th className="right">Sales</th><th className="right">Orders</th><th className="right">Profit</th><th className="right">Pieces</th><th className="right">Low stock</th></tr></thead>
            <tbody>{d.by_store.map((s) => <tr key={s.store_id} className="click" onClick={() => setSel(String(s.store_id))}><td><b>{s.name}</b></td><td className="right num">{usd(s.sales_cents)}</td><td className="right">{s.orders}</td><td className="right num">{usd(s.gross_profit_cents)}</td><td className="right">{s.pieces}</td><td className="right">{s.low_stock}</td></tr>)}</tbody></table></div>}
        <p className="muted small" style={{ marginTop: 10 }}>{d.note}</p>
      </>)}
    </div>
  );
}
