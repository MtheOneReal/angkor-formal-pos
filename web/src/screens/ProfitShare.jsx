import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast, Modal } from '../ui.jsx';
import { usd, todayISO } from '../format.js';

const Kpi = ({ l, v, tone }) => <div className="card kpi"><div className="l">{l}</div><div className="v" style={tone ? { color: `var(--${tone})` } : undefined}>{usd(v)}</div></div>;

// Profit share: one plain statement per shop and month. Close the month, then record what each person is paid.
export default function ProfitShare({ sel, setSel, month, setMonth, L }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [toast, show] = useToast(); const [rp, setRp] = useState(''); const [pay, setPay] = useState(null); const [rev, setRev] = useState(null);
  const load = () => api.get(`/capital/profit?store_id=${sel}&month=${month}`).then((x) => { setD(x); setRp(String(x.reserve_pct)); setErr(''); }).catch((e) => { setD(null); setErr(e.message); });
  useEffect(() => { load(); }, [sel, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn, ok) => { setErr(''); try { await fn(); if (ok) show(ok); load(); } catch (e) { setErr(e.message || 'Something went wrong.'); } };
  if (!d) return err ? <div className="card" style={{ marginBottom: 12 }}><div className="error">{err}</div></div> : null;
  const key = d.mode === 'statement' ? d.key : null; const st = d.statement; const thisMonth = todayISO().slice(0, 7); const ended = month < thisMonth;
  const where = d.mode === 'statement' ? (d.pooled ? L('All shops together', 'គ្រប់សាខារួមគ្នា') : d.store_name) : L('All shops', 'គ្រប់សាខា');
  const Row = ({ l, v, sub, strong }) => <div className="row between" style={{ padding: '5px 0', borderBottom: '1px solid var(--line, #0001)' }}><span style={strong ? { fontWeight: 700 } : undefined}>{l}</span><span className="num" style={strong ? { fontWeight: 700 } : undefined}>{sub}{usd(v)}</span></div>;
  return (
    <div className="card printable" style={{ marginBottom: 12 }}>
      <div className="row between wrap"><h3 style={{ margin: 0 }}>{L('Profit share', 'ចែកចំណេញ')} — {where}</h3>
        <span className="row noprint"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} /><button className="btn" onClick={() => window.print()}>🖨 {L('Print / PDF', 'បោះពុម្ព / PDF')}</button></span></div>
      {err && <div className="error">{err}</div>}
      <div className="grid g3" style={{ margin: '10px 0' }}>
        <Kpi l={L('Production fund (kept from closed months)', 'ទុនផលិត (ទុកពីខែបិទរួច)')} v={d.fund.balance_cents} tone={d.fund.balance_cents > 0 ? 'ok' : undefined} />
        <Kpi l={L('Set aside so far', 'ទុកសរុបរហូតដល់ឥឡូវ')} v={d.fund.set_aside_cents} />
        <Kpi l={L('Spent on production', 'ចំណាយលើផលិត')} v={d.fund.used_cents} />
      </div>

      {d.mode === 'combined' && <>
        <p className="muted small">{L('All shops added up for this month. Payouts are made shop by shop: tap a shop to open its statement.', 'សរុបគ្រប់សាខាសម្រាប់ខែនេះ។ ការបើកប្រាក់ធ្វើតាមសាខា៖ ចុចលើសាខាដើម្បីបើកតារាងរបស់វា។')}</p>
        <div className="tbl"><table><thead><tr><th>{L('Shop', 'សាខា')}</th><th className="right">{L('Profit', 'ចំណេញ')}</th><th className="right">{L('Kept for production', 'ទុកសម្រាប់ផលិត')}</th><th className="right">{L('To share', 'ចែកគ្នា')}</th><th>{L('Status', 'ស្ថានភាព')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.store_id} className="click" onClick={() => setSel(String(r.store_id))}><td><b>{r.name}</b></td><td className="right num">{r.hidden ? '—' : usd(r.net_cents)}</td><td className="right num">{r.hidden ? '—' : usd(r.reserve_cents)}</td><td className="right num">{r.hidden ? '—' : usd(r.share_cents)}</td><td>{r.closed ? `🔒 ${L('Closed', 'បិទរួច')}` : L('Draft', 'ព្រាង')}</td></tr>)}
            <tr><td><b>{L('Total', 'សរុប')}</b></td><td className="right num"><b>{usd(d.totals.net_cents)}</b></td><td className="right num"><b>{usd(d.totals.reserve_cents)}</b></td><td className="right num"><b>{usd(d.totals.share_cents)}</b></td><td /></tr></tbody></table></div>
        <h4 style={{ margin: '14px 0 6px' }}>{L('Each person across all shops (closed months)', 'អ្នកហ៊ុននីមួយៗគ្រប់សាខា (ខែបិទរួច)')}</h4>
        <div className="tbl"><table><thead><tr><th>{L('Shareholder', 'អ្នកហ៊ុន')}</th><th className="right">{L('Earned', 'ទទួលបាន')}</th><th className="right">{L('Paid', 'បានបើក')}</th><th className="right">{L('Still owed', 'នៅជំពាក់')}</th></tr></thead>
          <tbody>{d.people.map((p) => <tr key={p.id}><td><b>{p.name}</b></td><td className="right num">{usd(p.earned_cents)}</td><td className="right num">{usd(p.paid_cents)}</td><td className="right num" style={{ color: p.owed_cents > 0 ? 'var(--warn)' : undefined }}>{usd(p.owed_cents)}</td></tr>)}{!d.people.length && <tr><td colSpan="4" className="muted">{L('Nothing closed yet. Close a month in a shop’s statement to start.', 'មិនទាន់មានខែបិទនៅឡើយ។ បិទខែក្នុងតារាងរបស់សាខាដើម្បីចាប់ផ្តើម។')}</td></tr>}</tbody></table></div>
      </>}

      {d.mode === 'statement' && <>
        <div className="row between wrap" style={{ margin: '4px 0 8px' }}>
          <b>{month} · {st.closed ? `🔒 ${L('Closed', 'បិទរួច')}` : st.hidden ? L('Not closed yet', 'មិនទាន់បិទ') : L('Draft: numbers can still change', 'ព្រាង៖ លេខនៅអាចប្តូរ')}</b>
          <span className="row noprint">
            {d.can_edit && !st.closed && !st.hidden && <button className="btn primary" disabled={!ended} title={ended ? '' : L('A month can be closed after it ends', 'អាចបិទខែបាន បន្ទាប់ពីខែចប់')} onClick={() => window.confirm(L('Close this month? The numbers are locked and the shares become payable.', 'បិទខែនេះ? លេខនឹងត្រូវចាក់សោ ហើយចំណែកអាចបើកបាន។')) && run(() => api.post('/capital/profit/close', { store_id: d.pooled ? 'all' : key, month }), L('Month closed', 'បានបិទខែ'))}>🔒 {L('Close month', 'បិទខែ')}</button>}
            {d.is_super && st.closed && <button className="btn" onClick={() => window.confirm(L('Reopen this month? Use only to fix a mistake.', 'បើកខែនេះឡើងវិញ? ប្រើតែដើម្បីកែកំហុស។')) && run(() => api.post('/capital/profit/reopen', { store_id: d.pooled ? 'all' : key, month }), L('Reopened', 'បានបើកឡើងវិញ'))}>{L('Reopen', 'បើកឡើងវិញ')}</button>}
          </span>
        </div>
        {st.hidden ? <p className="muted small">{L('This month is not closed yet, so there is nothing to show.', 'ខែនេះមិនទាន់បិទ ដូច្នេះមិនមានអ្វីបង្ហាញទេ។')}</p> : <div style={{ margin: '4px 0 10px' }}>
          <Row l={L('Sales', 'ការលក់')} v={st.sales_cents} />
          <Row l={L('minus cost of the goods sold', 'ដកថ្លៃដើមទំនិញដែលបានលក់')} v={-st.cogs_cents} />
          <Row l={L('minus shop expenses', 'ដកចំណាយរបស់សាខា')} v={-st.expenses_cents} />
          {st.shared_cents > 0 && <Row l={L('minus its share of shared costs (warehouse, etc.)', 'ដកចំណែកចំណាយរួម (ឃ្លាំង ។ល។)')} v={-st.shared_cents} />}
          <Row strong l={L('= Profit', '= ចំណេញ')} v={st.net_cents} />
          <Row l={`${L('Kept for production', 'ទុកសម្រាប់ផលិត')} (${st.reserve_pct}%)`} v={-st.reserve_cents} />
          <Row strong l={L('= To share out', '= ចែកគ្នា')} v={st.share_cents} />
          {st.net_cents < 0 && <p className="muted small">{L('This month was a loss, so there is nothing to share.', 'ខែនេះខាត ដូច្នេះគ្មានអ្វីត្រូវចែកទេ។')}</p>}
        </div>}
        {d.can_edit && <div className="row wrap noprint" style={{ gap: 8, margin: '4px 0 10px' }}><span className="small">{L('Keep this % of each month’s profit for production', 'ទុក % នៃចំណេញប្រចាំខែសម្រាប់ផលិត')}</span><input type="number" min="0" max="100" value={rp} onChange={(e) => setRp(e.target.value)} style={{ width: 80 }} /><button className="btn" onClick={() => run(() => api.post('/capital/reserve', { pct: Number(rp) }), L('Saved', 'បានរក្សាទុក'))}>{L('Save', 'រក្សាទុក')}</button><span className="muted small">{L('(applies to months not yet closed)', '(ប្រើសម្រាប់ខែដែលមិនទាន់បិទ)')}</span></div>}
        <div className="tbl"><table><thead><tr><th>{L('Shareholder', 'អ្នកហ៊ុន')}</th><th className="right">{L('Ownership', 'ភាគរយ')}</th><th className="right">{L('This month', 'ខែនេះ')}</th><th className="right">{L('Earned (closed)', 'ទទួលបាន (បិទរួច)')}</th><th className="right">{L('Paid', 'បានបើក')}</th><th className="right">{L('Still owed', 'នៅជំពាក់')}</th>{d.can_edit && <th className="noprint" />}</tr></thead>
          <tbody>{d.holders.map((h) => <tr key={h.id}><td><b>{h.name}</b></td><td className="right num">{h.pct}%</td><td className="right num">{usd(h.share_cents)}</td><td className="right num">{usd(h.earned_cents)}</td><td className="right num">{usd(h.paid_cents)}</td><td className="right num" style={{ color: h.owed_cents > 0 ? 'var(--warn)' : undefined }}><b>{usd(h.owed_cents)}</b></td>
            {d.can_edit && <td className="noprint"><button className="btn" disabled={h.owed_cents <= 0} onClick={() => setPay({ shareholder_id: h.id, name: h.name, owed: h.owed_cents, amount_usd: (h.owed_cents / 100).toFixed(2), date: todayISO(), note: '' })}>{L('Record payment', 'កត់ត្រាបើកប្រាក់')}</button></td>}</tr>)}
            {!d.holders.length && <tr><td colSpan="7" className="muted">{L('Add shareholders with agreed amounts in this shop to split the profit.', 'បន្ថែមអ្នកហ៊ុន និងចំនួនព្រមព្រៀងក្នុងសាខានេះ ដើម្បីចែកចំណេញ។')}</td></tr>}</tbody></table></div>
        <p className="muted small">{L('A person is owed only for closed months. Payments cannot be edited; a mistake is fixed with a reversal and a reason.', 'អ្នកហ៊ុនទទួលបានតែខែដែលបិទរួច។ ការបើកប្រាក់មិនអាចកែបានទេ ត្រូវបញ្ច្រាសជាមួយមូលហេតុ។')}</p>
        {d.payouts.length > 0 && <><h4 style={{ margin: '10px 0 6px' }}>{L('Recent payments', 'ការបើកប្រាក់ថ្មីៗ')}</h4>
          <div className="tbl"><table><tbody>{d.payouts.map((p) => <tr key={p.id}><td>{p.date}</td><td><b>{p.name}</b>{p.note && <div className="small muted">{p.note}</div>}</td><td className="right num" style={{ color: p.amount_cents < 0 ? 'var(--bad)' : undefined }}>{usd(p.amount_cents)}</td>{d.can_edit && <td className="noprint">{p.amount_cents > 0 && !p.reverses_id && !d.payouts.some((x) => x.reverses_id === p.id) && <button className="btn" onClick={() => setRev({ id: p.id, name: p.name, reason: '' })}>{L('Reverse', 'បញ្ច្រាស')}</button>}</td>}</tr>)}</tbody></table></div></>}
        {d.is_super && <label className="noprint" style={{ textTransform: 'none', fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}><input type="checkbox" checked={d.pooled} disabled={d.has_history} onChange={(e) => run(() => api.post('/capital/profit/mode', { pooled: e.target.checked }), L('Saved', 'បានរក្សាទុក'))} style={{ width: 20, height: 20, minHeight: 0 }} />{L('Share profit from all shops together (instead of each shop on its own)', 'ចែកចំណេញពីគ្រប់សាខារួមគ្នា (ជំនួសឲ្យតាមសាខានីមួយៗ)')}{d.has_history && <span className="muted small"> — {L('can be changed only before the first month is closed', 'ប្តូរបានតែមុនបិទខែដំបូង')}</span>}</label>}
      </>}
      {d.mode === 'combined' && d.is_super && <label className="noprint" style={{ textTransform: 'none', fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}><input type="checkbox" checked={d.pooled} disabled={d.has_history} onChange={(e) => run(() => api.post('/capital/profit/mode', { pooled: e.target.checked }), L('Saved', 'បានរក្សាទុក'))} style={{ width: 20, height: 20, minHeight: 0 }} />{L('Share profit from all shops together (instead of each shop on its own)', 'ចែកចំណេញពីគ្រប់សាខារួមគ្នា (ជំនួសឲ្យតាមសាខានីមួយៗ)')}{d.has_history && <span className="muted small"> — {L('can be changed only before the first month is closed', 'ប្តូរបានតែមុនបិទខែដំបូង')}</span>}</label>}
      <p className="muted small noprint" style={{ marginBottom: 0 }}>{L('Production fund = the part kept from closed months, minus expenses in a category containing “Production” (add that category in Settings). Those expenses are not counted against the month’s profit, because they are paid from the fund.', 'ទុនផលិត = ផ្នែកដែលទុកពីខែបិទរួច ដកចំណាយក្នុងប្រភេទដែលមានពាក្យ “Production” (បន្ថែមប្រភេទនេះក្នុងការកំណត់)។ ចំណាយទាំងនោះមិនរាប់ជាកងចំណេញប្រចាំខែទេ ព្រោះបង់ពីទុននេះ។')}</p>
      {pay && <Modal title={`${L('Pay', 'បើកប្រាក់ឲ្យ')} ${pay.name}`} onClose={() => setPay(null)}>
        <p className="muted small">{L('Still owed', 'នៅជំពាក់')}: {usd(pay.owed)}</p>
        <label>{L('Amount (USD)', 'ចំនួន (USD)')}</label><input type="number" min="0" step="0.01" value={pay.amount_usd} onChange={(e) => setPay({ ...pay, amount_usd: e.target.value })} />
        <label>{L('Date', 'កាលបរិច្ឆេទ')}</label><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
        <label>{L('Note', 'កំណត់ចំណាំ')}</label><input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
        <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} onClick={() => run(async () => { await api.post('/capital/profit/pay', { store_id: d.pooled ? 'all' : key, shareholder_id: pay.shareholder_id, amount_usd: pay.amount_usd, date: pay.date, note: pay.note }); setPay(null); }, L('Payment recorded', 'បានកត់ត្រា'))}>{L('Save', 'រក្សាទុក')}</button></Modal>}
      {rev && <Modal title={`${L('Reverse payment to', 'បញ្ច្រាសការបើកប្រាក់ទៅ')} ${rev.name}`} onClose={() => setRev(null)}>
        <label>{L('Reason', 'មូលហេតុ')}</label><input value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} />
        <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={!rev.reason.trim()} onClick={() => run(async () => { await api.post(`/capital/profit/pay/${rev.id}/reverse`, { reason: rev.reason }); setRev(null); }, L('Reversed', 'បានបញ្ច្រាស'))}>{L('Reverse', 'បញ្ច្រាស')}</button></Modal>}
      {toast}
    </div>
  );
}
