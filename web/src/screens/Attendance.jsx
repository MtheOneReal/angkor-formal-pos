import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, useToast } from '../ui.jsx';
import { todayISO } from '../format.js';

const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const clock = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Phnom_Penh', hour: '2-digit', minute: '2-digit' }) : '—');

function Mine() {
  const { me } = useApp(); const t = useT(); const [m, setM] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => api.get(`/attendance/me${qs({ store_id: me.store_id })}`).then(setM).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [me.store_id]);
  const act = async (what) => { setBusy(true); setErr(''); try { setM(await api.post(`/attendance/${what}`, { store_id: me.store_id })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  if (!m) return null;
  const r = m.record;
  return (
    <div className="card" style={{ maxWidth: 460 }}>
      <h3>My attendance — {m.date}</h3>
      <p className="muted">Work starts at {hhmm(m.work_start_minutes)}{m.late_grace_minutes ? ` (${m.late_grace_minutes} min allowed)` : ''}.</p>
      {!r && <button className="btn primary big" style={{ width: '100%' }} disabled={busy} onClick={() => act('clock-in')}>Clock in</button>}
      {r && <>
        <p>Arrived at <b>{clock(r.in_ts)}</b> {r.late_minutes > 0 && <span className={`badge ${r.excused ? 'ok' : 'out'}`}>{r.excused ? 'late (excused)' : `late ${r.late_minutes} min`}</span>}</p>
        {r.out_ts ? <p>Left at <b>{clock(r.out_ts)}</b></p> : <button className="btn primary big" style={{ width: '100%' }} disabled={busy} onClick={() => act('clock-out')}>Clock out</button>}
      </>}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function Team() {
  const { me } = useApp(); const [toast, show] = useToast();
  const [store, setStore] = useState(me.store_id); const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [d, setD] = useState(null); const [staff, setStaff] = useState([]); const [err, setErr] = useState('');
  const [f, setF] = useState({ user_id: '', date: todayISO(), in_time: '09:00', out_time: '' });
  const load = () => api.get(`/attendance${qs({ store_id: store, month })}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.get(`/attendance/staff${qs({ store_id: store })}`).then((s) => { setStaff(s); setF((x) => ({ ...x, user_id: s[0]?.id || '' })); }); }, [store, month]);
  const run = async (fn) => { setErr(''); try { await fn(); load(); } catch (e) { setErr(e.message); } };
  return (
    <div>
      <div className="row wrap" style={{ margin: '12px 0' }}>
        <select value={store} onChange={(e) => setStore(Number(e.target.value))} style={{ width: 'auto', minWidth: 200 }}>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />
      </div>
      {err && <div className="error">{err}</div>}
      {d && <>
        <div className="card" style={{ overflow: 'auto' }}><h3>Summary — work starts {hhmm(d.work_start_minutes)}</h3>
          <table><thead><tr><th>Name</th><th className="right">Days present</th><th className="right">Late days</th></tr></thead>
            <tbody>{d.summary.map((s) => <tr key={s.user_id}><td>{s.user_name}</td><td className="right">{s.days}</td><td className="right">{s.late_days}</td></tr>)}{!d.summary.length && <tr><td colSpan="3" className="muted">No records yet.</td></tr>}</tbody></table></div>
        <div className="card" style={{ marginTop: 12 }}><h3>Add or correct a record</h3>
          <div className="row wrap">
            <select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })} style={{ width: 'auto' }}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={{ width: 'auto' }} />
            <label className="small muted">Arrived</label><input type="time" value={f.in_time} onChange={(e) => setF({ ...f, in_time: e.target.value })} style={{ width: 'auto' }} />
            <label className="small muted">Left</label><input type="time" value={f.out_time} onChange={(e) => setF({ ...f, out_time: e.target.value })} style={{ width: 'auto' }} />
            <button className="btn primary" onClick={() => run(async () => { await api.post('/attendance/manual', { ...f, store_id: store }); show('Saved'); })}>Save</button>
          </div><p className="muted small">Use this when someone forgot to clock in. It is marked “manual” and written to the activity log. You cannot edit your own record.</p></div>
        <div className="card" style={{ marginTop: 12, overflow: 'auto' }}><table><thead><tr><th>Date</th><th>Name</th><th>In</th><th>Out</th><th>Late</th><th></th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.user_name}{r.manual && <span className="badge low" style={{ marginLeft: 6 }}>manual</span>}</td><td>{clock(r.in_ts)}</td><td>{clock(r.out_ts)}</td>
            <td>{r.late_minutes > 0 ? <span className={`badge ${r.excused ? 'ok' : 'out'}`}>{r.excused ? `${r.late_minutes} min (excused)` : `${r.late_minutes} min`}</span> : '—'}</td>
            <td className="row">{r.late_minutes > 0 && <button className="btn" onClick={() => run(() => api.post(`/attendance/${r.id}/excuse`, { excused: !r.excused }))}>{r.excused ? 'Un-excuse' : 'Excuse'}</button>}
              <button className="btn" onClick={() => window.confirm('Delete this record?') && run(() => api.post(`/attendance/${r.id}/delete`))}>Delete</button></td></tr>)}</tbody></table></div>
      </>}
      {toast}
    </div>
  );
}

export default function Attendance() {
  const { me } = useApp(); const t = useT();
  return (<div><h1>{t('attendance')}</h1><div style={{ marginTop: 12 }}><Mine />{me.perms.includes('attendance.manage') && <Team />}</div></div>);
}
