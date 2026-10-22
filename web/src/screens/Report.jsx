import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../ui.jsx';
import { usd, usdShort } from '../format.js';

const thisMonth = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);

export default function Report() {
  const { lang } = useApp(); const km = lang === 'km'; const L = (en, kh) => (km ? kh : en);
  const [sel, setSel] = useState('all'); const [month, setMonth] = useState(thisMonth()); const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api.get(`/report?store_id=${sel}&month=${month}`).then(setD).catch((e) => setErr(e.message)); }, [sel, month]);
  if (!d) return <div>{err && <div className="error">{err}</div>}</div>;
  const t = d.totals; const max = Math.max(1, ...d.trend.map((x) => Math.abs(x.sales_cents)));
  const Kpi = ({ l, v, tone, sub }) => <div className="card kpi"><div className="l">{l}</div><div className="v num" style={tone ? { color: `var(--${tone})` } : undefined}>{usd(v)}</div>{sub && <div className="small muted">{sub}</div>}</div>;
  const payback = t.capital_paid_cents > 0 ? Math.round((t.total_net_cents / t.capital_paid_cents) * 100) : null;
  return (
    <div>
      <div className="row between wrap"><h1>{L('Report', 'របាយការណ៍')}</h1>
        <div className="row wrap"><select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: 'auto', minWidth: 210 }}><option value="all">{L('All stores combined', 'គ្រប់សាខារួមគ្នា')}</option>{d.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 'auto' }} /></div></div>
      <div className="grid g4" style={{ margin: '12px 0' }}>
        <Kpi l={L('Sales', 'ការលក់')} v={t.sales_cents} sub={`${t.orders} ${L('orders', 'ការបញ្ជាទិញ')}`} />
        <Kpi l={L('Cost of goods', 'ថ្លៃដើមទំនិញ')} v={t.cogs_cents} />
        <Kpi l={L('Expenses', 'ចំណាយ')} v={t.expenses_cents} />
        <Kpi l={L('Net profit', 'ប្រាក់ចំណេញសុទ្ធ')} v={t.net_cents} tone={t.net_cents < 0 ? 'bad' : 'ok'} sub={t.sales_cents ? `${Math.round((t.net_cents / t.sales_cents) * 100)}% ${L('of sales', 'នៃការលក់')}` : ''} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row between wrap"><b>{L('Capital coming back (all time)', 'ដើមទុនដែលបានត្រឡប់មកវិញ (សរុប)')}</b>{payback != null && <b className="num" style={{ color: payback < 0 ? 'var(--bad)' : 'var(--ok)' }}>{payback}%</b>}</div>
        <div className="row wrap" style={{ marginTop: 6, gap: 24 }}><span className="muted small">{L('Capital paid in', 'ដើមទុនបានបង់')}: <b>{usd(t.capital_paid_cents)}</b></span><span className="muted small">{L('Total net profit to date', 'ចំណេញសុទ្ធសរុបដល់ពេលនេះ')}: <b>{usd(t.total_net_cents)}</b></span></div>
        {payback != null && <div style={{ background: 'var(--surface2)', borderRadius: 5, height: 10, marginTop: 8 }}><div className="hbar" style={{ width: `${Math.max(0, Math.min(100, payback))}%` }} /></div>}</div>
      {d.rows.length > 1 && <div className="card tbl" style={{ marginBottom: 12 }}><h3 style={{ marginBottom: 8 }}>{L('By store', 'តាមសាខា')}</h3>
        <table><thead><tr><th>{L('Store', 'សាខា')}</th><th className="right">{L('Sales', 'ការលក់')}</th><th className="right">{L('Cost', 'ថ្លៃដើម')}</th><th className="right">{L('Expenses', 'ចំណាយ')}</th><th className="right">{L('Net', 'សុទ្ធ')}</th><th className="right">{L('Capital paid', 'ដើមទុន')}</th><th className="right">{L('Net to date', 'សុទ្ធសរុប')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.store_id} className="click" onClick={() => setSel(String(r.store_id))}><td><b>{r.name}</b></td><td className="right num">{usd(r.sales_cents)}</td><td className="right num">{usd(r.cogs_cents)}</td><td className="right num">{usd(r.expenses_cents)}</td><td className="right num" style={{ color: r.net_cents < 0 ? 'var(--bad)' : undefined }}><b>{usd(r.net_cents)}</b></td><td className="right num">{usd(r.capital_paid_cents)}</td><td className="right num">{usd(r.total_net_cents)}</td></tr>)}</tbody></table></div>}
      <div className="card"><h3 style={{ marginBottom: 8 }}>{L('Last months', 'ខែចុងក្រោយ')}</h3>
        <div className="bars">{d.trend.map((x) => <div key={x.month} className="b" title={`${x.month}: ${usd(x.sales_cents)}`} style={{ height: `${(x.sales_cents / max) * 100}%`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}><span style={{ position: 'absolute', top: -18, fontSize: 10, whiteSpace: 'nowrap' }}>{usdShort(x.sales_cents)}</span></div>)}</div>
        <div className="row" style={{ gap: 4 }}>{d.trend.map((x) => <div key={x.month} className="small muted" style={{ flex: 1, textAlign: 'center' }}>{x.month.slice(2)}<div style={{ color: x.net_cents < 0 ? 'var(--bad)' : 'var(--ok)' }}>{usdShort(x.net_cents)}</div></div>)}</div>
        <p className="muted small" style={{ marginTop: 10 }}>{L('Bars are sales; the number under each month is net profit. Cost of goods uses each product’s current cost price.', 'របារគឺការលក់ លេខក្រោមគឺចំណេញសុទ្ធ។ ថ្លៃដើមប្រើតម្លៃដើមបច្ចុប្បន្ន។')}</p></div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
