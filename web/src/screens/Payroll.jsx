import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useT, useToast } from '../ui.jsx';
import { usd, todayISO } from '../format.js';

export default function Payroll() {
  const t = useT(); const [toast, show] = useToast(); const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [d, setD] = useState(null); const [ded, setDed] = useState(''); const [err, setErr] = useState('');
  const load = () => api.get(`/payroll${qs({ month })}`).then((x) => { setD(x); setDed(String(x.late_deduction_cents / 100)); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [month]);
  const run = async (fn, msg) => { setErr(''); try { await fn(); if (msg) show(msg); load(); } catch (e) { setErr(e.message); } };
  return (
    <div>
      <h1>{t('payroll')}</h1>
      <div className="row wrap" style={{ margin: '12px 0' }}>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />
        <label className="small muted">Deduction per late day ($)</label>
        <input type="number" min="0" step="0.5" value={ded} onChange={(e) => setDed(e.target.value)} style={{ width: 90 }} />
        <button className="btn" onClick={() => run(() => api.post('/payroll/settings', { late_deduction_usd: Number(ded) }), 'Saved')}>Save</button>
      </div>
      {err && <div className="error">{err}</div>}
      {d && <>
        <div className="card" style={{ overflow: 'auto' }}><table><thead><tr><th>Name</th><th>Role</th><th className="right">Salary</th><th className="right">Days present</th><th className="right">Late days</th><th className="right">Deduction</th><th className="right">To pay</th><th></th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.user_id}><td><b>{r.name}</b></td><td>{r.role}</td><td className="right num">{usd(r.base_cents)}</td><td className="right">{r.days_present}</td>
            <td className="right">{r.late_days}{r.excused_days > 0 && <span className="small muted"> (+{r.excused_days} excused)</span>}</td><td className="right num">{r.deduction_cents ? `-${usd(r.deduction_cents)}` : '—'}</td><td className="right num"><b>{usd(r.net_cents)}</b></td>
            <td>{r.recorded ? <span className="badge ok">recorded</span> : r.base_cents === 0 ? <span className="small muted">no salary set</span> : ''}</td></tr>)}
            <tr><td colSpan="2"><b>Total</b></td><td className="right num"><b>{usd(d.total_base_cents)}</b></td><td colSpan="3"></td><td className="right num"><b>{usd(d.total_net_cents)}</b></td><td></td></tr></tbody></table></div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => window.confirm('Add each person’s salary for this month to Expenses (category Salary)?') && run(() => api.post('/payroll/record', { month }), 'Recorded in Expenses')}>Record salaries as expenses</button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>Salaries are set per person in Settings → Staff. A person is late when they clock in after the store’s start time. A manager can excuse a late day in Attendance. Recording adds one Salary expense per person (once per month) in their first store, so the dashboard’s net profit includes it.</p>
      </>}
      {toast}
    </div>
  );
}
