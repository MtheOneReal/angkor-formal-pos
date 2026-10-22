import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, useToast } from '../ui.jsx';
import { usd, todayISO } from '../format.js';

export default function Payroll() {
  const t = useT(); const { lang } = useApp(); const km = lang === 'km'; const L = (en, kh) => (km ? kh : en); const [toast, show] = useToast(); const [sel, setSel] = useState('all'); const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [d, setD] = useState(null); const [ded, setDed] = useState(''); const [err, setErr] = useState('');
  const load = () => api.get(`/payroll${qs({ month, store_id: sel })}`).then((x) => { setD(x); setDed(String(x.late_deduction_cents / 100)); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [month, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn, msg) => { setErr(''); try { await fn(); if (msg) show(msg); load(); } catch (e) { setErr(e.message); } };
  return (
    <div>
      <h1>{t('payroll')}</h1>
      <div className="row wrap" style={{ margin: '12px 0' }}>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: 'auto', minWidth: 200 }} aria-label="Shop"><option value="all">{L('All shops', 'ហាងទាំងអស់')}</option>{(d?.stores || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />
        <label className="small muted">Deduction per late day ($)</label>
        <input type="number" min="0" step="0.5" value={ded} onChange={(e) => setDed(e.target.value)} style={{ width: 90 }} />
        <button className="btn" onClick={() => run(() => api.post('/payroll/settings', { late_deduction_usd: Number(ded) }), 'Saved')}>Save</button>
      </div>
      {err && <div className="error">{err}</div>}
      {d && <>
        <div className="card" style={{ overflow: 'auto' }}><table><thead><tr><th>Name</th><th>{L('Shop', 'ហាង')}</th><th>Role</th><th className="right">Salary</th><th className="right">Days present</th><th className="right">Late days</th><th className="right">Deduction</th><th className="right">To pay</th><th></th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.user_id}><td><b>{r.name}</b></td><td>{r.store_name}{r.multi_store && <span className="small muted"> +</span>}</td><td>{r.role}</td><td className="right num">{usd(r.base_cents)}</td><td className="right">{r.days_present}</td>
            <td className="right">{r.late_days}{r.excused_days > 0 && <span className="small muted"> (+{r.excused_days} excused)</span>}</td><td className="right num">{r.deduction_cents ? `-${usd(r.deduction_cents)}` : '—'}</td><td className="right num"><b>{usd(r.net_cents)}</b></td>
            <td>{r.recorded ? <span className="badge ok">recorded</span> : r.base_cents === 0 ? <span className="small muted">no salary set</span> : ''}</td></tr>)}
            <tr><td colSpan="3"><b>Total</b></td><td className="right num"><b>{usd(d.total_base_cents)}</b></td><td colSpan="3"></td><td className="right num"><b>{usd(d.total_net_cents)}</b></td><td></td></tr></tbody></table></div>
        {sel === 'all' && d.stores.length > 1 && <div className="card" style={{ marginTop: 12 }}><b>{L('To pay by shop', 'ត្រូវបង់តាមហាង')}</b>{d.stores.map((s) => <div className="row between" key={s.id}><span>{s.name}</span><b className="num">{usd(d.rows.filter((r) => r.store_id === s.id).reduce((a, r) => a + r.net_cents, 0))}</b></div>)}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => window.confirm('Add each person’s salary for this month to Expenses (category Salary)?') && run(() => api.post('/payroll/record', { month, store_id: sel }), 'Recorded in Expenses')}>Record salaries as expenses</button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>Salaries are set per person in Settings → Staff. A person is late when they clock in after the store’s start time. A manager can excuse a late day in Attendance. Recording adds one Salary expense per person (once per month) in their first store, so the dashboard’s net profit includes it. A “+” after the shop name means the person works in more than one shop; their salary is counted under the first one.</p>
      </>}
      {toast}
    </div>
  );
}
