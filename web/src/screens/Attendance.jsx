import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, useToast, Modal } from '../ui.jsx';
import { todayISO, usd } from '../format.js';
import { ShopQR, ClockInFlow } from './AttendanceScan.jsx';
import PhoneDrop, { telHref } from './PhoneDrop.jsx';

const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const clock = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Phnom_Penh', hour: '2-digit', minute: '2-digit' }) : '—');

function Mine() {
  const { me } = useApp(); const t = useT(); const [m, setM] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [scan, setScan] = useState(false);
  const load = () => api.get(`/attendance/me${qs({ store_id: me.store_id })}`).then(setM).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [me.store_id]);
  const act = async (what) => { setBusy(true); setErr(''); try { setM(await api.post(`/attendance/${what}`, { store_id: me.store_id })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  if (!m) return null;
  const r = m.record;
  return (
    <div className="card" style={{ maxWidth: 460 }}>
      <h3>My attendance — {m.date}</h3>
      <p className="muted">Your work starts at {hhmm(m.my_start_minutes ?? m.work_start_minutes)}{m.my_end_minutes != null ? ` and ends at ${hhmm(m.my_end_minutes)}` : ''}{m.late_grace_minutes ? ` (${m.late_grace_minutes} min allowed)` : ''}.</p>
      {!r && <button className="btn primary big" style={{ width: '100%' }} disabled={busy} onClick={() => setScan(true)}>📷 Clock in</button>}
      {r && <>
        <p>Arrived at <b>{clock(r.in_ts)}</b> {r.late_minutes > 0 && <span className={`badge ${r.excused ? 'ok' : 'out'}`}>{r.excused ? 'late (excused)' : `late ${r.late_minutes} min`}</span>}</p>
        {r.out_ts ? <p>Left at <b>{clock(r.out_ts)}</b> {r.left_early_minutes > 0 && <span className="badge low">left {r.left_early_minutes} min early</span>}</p> : <button className="btn primary big" style={{ width: '100%' }} disabled={busy} onClick={() => act('clock-out')}>Clock out</button>}
      </>}
      {err && <div className="error">{err}</div>}
      {scan && <ClockInFlow storeId={me.store_id} checks={m.checks} onClose={() => setScan(false)} onDone={() => { setScan(false); load(); }} />}
    </div>
  );
}

const mm = (n) => (n == null ? '' : hhmm(n));
function Hours({ st, onSave }) {
  const [a, setA] = useState(mm(st.start_min)); const [b, setB] = useState(mm(st.end_min)); const [o, setO] = useState(st.day_off == null ? '' : String(st.day_off));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (<tr><td><b>{st.name}</b></td>
    <td><input type="time" value={a} onChange={(e) => setA(e.target.value)} style={{ width: 150 }} /></td>
    <td><input type="time" value={b} onChange={(e) => setB(e.target.value)} style={{ width: 150 }} /></td>
    <td><select value={o} onChange={(e) => setO(e.target.value)} style={{ width: 'auto' }}><option value="">None</option>{days.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></td>
    <td><button className="btn" onClick={() => onSave({ start: a, end: b, day_off: o })}>Save</button></td></tr>);
}

function Team() {
  const { me } = useApp(); const [toast, show] = useToast();
  const [store, setStore] = useState(me.store_id); const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [d, setD] = useState(null); const [staff, setStaff] = useState([]); const [err, setErr] = useState('');
  const [f, setF] = useState({ user_id: '', date: todayISO(), in_time: '09:00', out_time: '' }); const [photo, setPhoto] = useState(null); const [fee, setFee] = useState('');
  const all = store === 'all'; const today = todayISO(); const [cs, setCs] = useState(null); const [rad, setRad] = useState('150');
  const loadCs = () => { if (store === 'all' || me.role !== 'owner') return; api.get(`/attendance/settings${qs({ store_id: store })}`).then((x) => { setCs(x); setRad(String(x.geo?.radius || 150)); }).catch(() => {}); };
  useEffect(loadCs, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveCs = (body) => run(async () => { await api.post('/attendance/settings', { store_id: store, ...body }); loadCs(); show('Saved'); });
  const here = () => { if (!navigator.geolocation) { setErr('This device cannot share its location.'); return; } navigator.geolocation.getCurrentPosition((p) => saveCs({ lat: p.coords.latitude, lng: p.coords.longitude, radius: Number(rad) }), () => setErr('Allow location for this site, then try again.'), { enableHighAccuracy: true, timeout: 20000 }); };
  const load = () => api.get(`/attendance${qs({ store_id: store, month })}`).then((x) => { setD(x); setFee(String(x.late_fee_cents / 100)); }).catch((e) => setErr(e.message));
  const loadStaff = () => { if (store !== 'all') api.get(`/attendance/staff${qs({ store_id: store })}`).then((s) => { setStaff(s); setF((x) => ({ ...x, user_id: x.user_id || s[0]?.id || '' })); }).catch(() => {}); };
  useEffect(() => { load(); loadStaff(); }, [store, month]);
  const showPhoto = async (r) => { try { const x = await api.get(`/attendance/${r.id}/selfie`); setPhoto({ name: r.user_name, date: r.date, src: x.selfie }); } catch (e) { setErr(e.message); } };
  const run = async (fn) => { setErr(''); try { await fn(); load(); } catch (e) { setErr(e.message); } };
  return (
    <div>
      <div className="row wrap" style={{ margin: '12px 0' }}>
        <select value={store} onChange={(e) => setStore(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ width: 'auto', minWidth: 200 }}>{me.perms.includes('dashboard.all_stores') && <option value="all">All shops</option>}{me.stores.filter((s) => s.kind !== 'warehouse').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />
        {!all && <ShopQR storeId={store} />}
        {me.perms.includes('payroll.view') && <><label className="small muted">Late fee per day ($)</label><input type="number" min="0" step="0.5" value={fee} onChange={(e) => setFee(e.target.value)} style={{ width: 80 }} /><button className="btn" onClick={() => run(async () => { await api.post('/payroll/settings', { late_deduction_usd: Number(fee) }); show('Saved'); })}>Save</button></>}
      </div>
      {err && <div className="error">{err}</div>}
      {d && <>
        {!all && me.role === 'owner' && cs && <div className="card" style={{ marginBottom: 12 }}><h3>Clock-in checks for this shop</h3>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>Staff always take a live selfie to clock in. These checks also confirm they are at the shop.</p>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={here}>📍 {cs.geo ? 'Update shop location (use at the shop)' : 'Set shop location (use at the shop)'}</button>
            <label className="small muted">Allowed distance (m)</label><input type="number" min="30" max="2000" value={rad} onChange={(e) => setRad(e.target.value)} style={{ width: 90 }} />
            {cs.geo && <><button className="btn" onClick={() => saveCs({ radius: Number(rad) })}>Save distance</button><button className="btn" onClick={() => saveCs({ clear_location: true })}>Turn location check off</button></>}</div>
          <p className="small" style={{ margin: '8px 0 0' }}>{cs.geo ? `✅ Staff must be within ${cs.geo.radius} m of the shop.` : 'Location check is off.'}</p>
          <label className="row" style={{ gap: 8, marginTop: 8 }}><input type="checkbox" checked={cs.qr} onChange={(e) => saveCs({ qr: e.target.checked })} style={{ width: 'auto' }} /><span className="small">Also require the shop QR (needs a spare phone or screen left at the shop showing it)</span></label></div>}
        {!all && me.role === 'owner' && <div className="card" style={{ marginBottom: 12, overflow: 'auto' }}><h3>Working hours</h3>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>Set each person’s own start and finishing time. They are late only after their own start time. Leave blank to use the shop time ({hhmm(d.work_start_minutes)}).</p>
          <table><thead><tr><th>Name</th><th>Starts</th><th>Finishes</th><th>Day off</th><th></th></tr></thead>
            <tbody>{staff.map((st) => <Hours key={st.id + String(st.start_min) + String(st.end_min) + String(st.day_off)} st={st} onSave={(v) => run(async () => { await api.post('/attendance/hours', { store_id: store, user_id: st.id, ...v }); show('Saved'); loadStaff(); })} />)}</tbody></table></div>}
        {!all && <div className="card" style={{ marginBottom: 12 }}><h3>Today</h3>
          <div className="col">{staff.map((st) => { const r = d.rows.find((x) => x.user_id === st.id && x.date === today); const pp = new Date(Date.now() + 7 * 3600000); const started = pp.getUTCHours() * 60 + pp.getUTCMinutes() > (st.start_min ?? d.work_start_minutes); const off = st.day_off != null && st.day_off === pp.getUTCDay();
            return (<div key={st.id} className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}><span><b>{st.name}</b> <span className="small muted">{hhmm(st.start_min ?? d.work_start_minutes)}{st.end_min != null ? `–${hhmm(st.end_min)}` : ''}</span></span>
              <span className="row" style={{ gap: 8 }}>{(st.phones?.length || st.phone) && !r && (st.phones?.length > 1 ? <PhoneDrop phones={st.phones} label="📞 Call" /> : <a className="btn" href={telHref(st.phones?.[0] || st.phone)}>📞 Call</a>)}{r ? <><span>{clock(r.in_ts)}</span>{r.late_minutes > 0 ? <span className={`badge ${r.excused ? 'ok' : 'out'}`}>{r.excused ? 'late (excused)' : `late ${r.late_minutes} min`}</span> : <span className="badge ok">on time</span>}{r.dist_m != null && <span className="small muted">{r.dist_m} m</span>}{r.has_selfie && <button className="btn" onClick={() => showPhoto(r)}>📷</button>}</>
                : off ? <span className="badge ok">Day off</span> : <span className={`badge ${started ? 'out' : 'low'}`}>{started ? 'Not in yet' : 'Not in yet (shift not started)'}</span>}</span></div>); })}
            {!staff.length && <p className="muted">No staff are set up for this shop yet.</p>}</div></div>}
        <div className="card" style={{ marginBottom: 12 }}><h3>Lateness this month</h3>
          {d.summary.some((x) => x.late_days > 0) ? <>
            <p style={{ margin: '4px 0' }}>Most late: <b>{d.summary[0].user_name}</b> — {d.summary[0].late_days} {d.summary[0].late_days === 1 ? 'day' : 'days'}, {d.summary[0].late_minutes} min in total</p>
            <p style={{ margin: '4px 0' }}>Late fees this month: <b className="num">{usd(d.total_fee_cents)}</b> <span className="muted small">({usd(d.late_fee_cents)} per late day, excused days not counted)</span></p></>
            : <p className="muted">Nobody was late this month. 👍</p>}</div>
        <div className="card" style={{ overflow: 'auto' }}><h3>Summary — shop time {hhmm(d.work_start_minutes)}, each person’s own time if set (most late first)</h3>
          <table><thead><tr><th>Name</th><th className="right">Days present</th><th className="right">Late days</th><th className="right">Late minutes</th><th className="right">Late fee</th><th className="right">Left early</th></tr></thead>
            <tbody>{d.summary.map((s) => <tr key={s.user_id}><td>{s.user_name}</td><td className="right">{s.days}</td><td className="right">{s.late_days}</td><td className="right">{s.late_minutes || '—'}</td><td className="right num">{s.fee_cents ? usd(s.fee_cents) : '—'}</td><td className="right">{s.early_days ? `${s.early_days} d · ${s.early_minutes} min` : '—'}</td></tr>)}{!d.summary.length && <tr><td colSpan="6" className="muted">No records yet.</td></tr>}</tbody></table></div>
        {!all && <div className="card" style={{ marginTop: 12 }}><h3>Add or correct a record</h3>
          <div className="row wrap">
            <select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })} style={{ width: 'auto' }}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={{ width: 'auto' }} />
            <label className="small muted">Arrived</label><input type="time" value={f.in_time} onChange={(e) => setF({ ...f, in_time: e.target.value })} style={{ width: 'auto' }} />
            <label className="small muted">Left</label><input type="time" value={f.out_time} onChange={(e) => setF({ ...f, out_time: e.target.value })} style={{ width: 'auto' }} />
            <button className="btn primary" onClick={() => run(async () => { await api.post('/attendance/manual', { ...f, store_id: store }); show('Saved'); })}>Save</button>
          </div><p className="muted small">Use this when someone forgot to clock in. It is marked “manual” and written to the activity log. You cannot edit your own record.</p></div>}
        <div className="card" style={{ marginTop: 12, overflow: 'auto' }}><table><thead><tr><th>Date</th><th>Name</th>{all && <th>Shop</th>}<th>In</th><th>Out</th><th>Late</th><th></th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.user_name}{r.manual && <span className="badge low" style={{ marginLeft: 6 }}>manual</span>}</td>{all && <td>{r.store_name}</td>}<td>{clock(r.in_ts)}{r.has_selfie && <button className="btn" style={{ marginLeft: 6 }} onClick={() => showPhoto(r)}>📷</button>}</td><td>{clock(r.out_ts)}{r.left_early_minutes > 0 && <span className="badge low" style={{ marginLeft: 6 }}>early {r.left_early_minutes}m</span>}</td>
            <td>{r.late_minutes > 0 ? <span className={`badge ${r.excused ? 'ok' : 'out'}`}>{r.excused ? `${r.late_minutes} min (excused)` : `${r.late_minutes} min`}</span> : '—'}</td>
            <td className="row">{r.late_minutes > 0 && <button className="btn" onClick={() => run(() => api.post(`/attendance/${r.id}/excuse`, { excused: !r.excused }))}>{r.excused ? 'Un-excuse' : 'Excuse'}</button>}
              <button className="btn" onClick={() => window.confirm('Delete this record?') && run(() => api.post(`/attendance/${r.id}/delete`))}>Delete</button></td></tr>)}</tbody></table></div>
      </>}
      {photo && <Modal title={`${photo.name} · ${photo.date}`} onClose={() => setPhoto(null)}><img src={photo.src} alt={photo.name} style={{ width: '100%', borderRadius: 12 }} /></Modal>}
      {toast}
    </div>
  );
}

export default function Attendance() {
  const { me } = useApp(); const t = useT();
  return (<div><h1>{t('attendance')}</h1><div style={{ marginTop: 12 }}><Mine />{me.perms.includes('attendance.manage') && <Team />}</div></div>);
}
