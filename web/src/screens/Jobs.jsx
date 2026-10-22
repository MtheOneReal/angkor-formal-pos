import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, Modal, useToast } from '../ui.jsx';
import { usd, riel, toRiel, todayISO } from '../format.js';

const COLS = [['received', 'Received', 'ទទួលហើយ'], ['in_progress', 'Being altered', 'កំពុងកែ'], ['ready', 'Ready to collect', 'រួចរាល់'], ['collected', 'Collected', 'បានយក']];

export default function Jobs() {
  const { me, store, lang } = useApp(); const t = useT(); const km = lang === 'km';
  const [tab, setTab] = useState('jobs'); const [jobs, setJobs] = useState([]); const [bal, setBal] = useState([]); const [pay, setPay] = useState(null); const [err, setErr] = useState(''); const [toast, show] = useToast();
  const load = useCallback(() => { api.get(`/alterations${qs({ store_id: store.id })}`).then(setJobs).catch((e) => setErr(e.message)); api.get(`/balances${qs({ store_id: store.id })}`).then(setBal).catch((e) => setErr(e.message)); }, [store.id]);
  useEffect(() => { load(); }, [load]);
  const move = async (j, status) => { setErr(''); try { await api.post(`/alterations/${j.id}`, { status }); load(); } catch (e) { setErr(e.message); } };
  const total = bal.reduce((a, r) => a + r.balance_cents, 0);
  const late = (d) => d && d < todayISO();
  return (
    <div>
      <h1>{t('jobs')}</h1>
      <div className="tabs" style={{ marginTop: 12 }}>
        <button className={`chip ${tab === 'jobs' ? 'on' : ''}`} onClick={() => setTab('jobs')}>✂️ {km ? 'ការកែទំហំ' : 'Alterations'} ({jobs.filter((j) => j.status !== 'collected').length})</button>
        <button className={`chip ${tab === 'bal' ? 'on' : ''}`} onClick={() => setTab('bal')}>💵 {km ? 'ប្រាក់នៅខ្វះ' : 'Balances to collect'} ({bal.length})</button>
      </div>
      {err && <div className="error">{err}</div>}
      {tab === 'jobs' && (
        <div className="kan">
          {COLS.map(([k, en, kh], ci) => (
            <div key={k} className="kcol"><h3 style={{ fontSize: 16, marginBottom: 8 }}>{km ? kh : en} <span className="muted small">({jobs.filter((j) => j.status === k).length})</span></h3>
              {jobs.filter((j) => j.status === k).map((j) => (
                <div key={j.id} className="card" style={{ marginBottom: 8, padding: 12, borderColor: late(j.due_date) && k !== 'collected' ? 'var(--bad)' : undefined }}>
                  <div className="row between"><b>{j.customer_name || '—'}</b><span className="small muted">{j.receipt_no}</span></div>
                  {j.customer_phone && <a className="small" href={`tel:${j.customer_phone}`}>{j.customer_phone}</a>}
                  <div className="small muted" style={{ marginTop: 4 }}>{j.summary}</div>
                  {j.notes && <div className="small" style={{ marginTop: 4 }}>✂️ {j.notes}</div>}
                  <div className="row between wrap small" style={{ marginTop: 6 }}>
                    <span style={{ color: late(j.due_date) && k !== 'collected' ? 'var(--bad)' : undefined }}>{j.due_date ? `${km ? 'ថ្ងៃយក' : 'Pickup'} ${j.due_date}` : ''}</span>
                    {j.balance_cents > 0 && <span className="badge low">{km ? 'ខ្វះ' : 'Owes'} {usd(j.balance_cents)}</span>}
                  </div>
                  {k !== 'collected' && <div className="row" style={{ marginTop: 8 }}>
                    {ci > 0 && k !== 'collected' && <button className="btn" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => move(j, COLS[ci - 1][0])}>←</button>}
                    <button className="btn primary grow" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => move(j, COLS[ci + 1][0])}>{km ? COLS[ci + 1][2] : COLS[ci + 1][1]} →</button>
                  </div>}
                </div>
              ))}
              {!jobs.some((j) => j.status === k) && <p className="muted small">—</p>}
            </div>
          ))}
        </div>
      )}
      {tab === 'bal' && (
        <div className="card tbl">
          <p className="muted small">{km ? 'សរុបនៅខ្វះ' : 'Total still owed'}: <b>{usd(total)}</b></p>
          <table><thead><tr><th>{km ? 'អតិថិជន' : 'Customer'}</th><th>{km ? 'វិក្កយបត្រ' : 'Receipt'}</th><th className="right">{km ? 'សរុប' : 'Total'}</th><th className="right">{km ? 'បានបង់' : 'Paid'}</th><th className="right">{km ? 'នៅខ្វះ' : 'Owes'}</th><th>{km ? 'ថ្ងៃយក' : 'Pickup'}</th><th /></tr></thead>
            <tbody>{bal.map((r) => <tr key={r.id}><td><b>{r.customer_name}</b><div className="small muted">{r.customer_phone}</div></td><td>{r.receipt_no}</td><td className="right num">{usd(r.total_cents)}</td><td className="right num">{usd(r.paid_cents)}</td>
              <td className="right num"><b style={{ color: 'var(--warn)' }}>{usd(r.balance_cents)}</b></td><td style={{ color: late(r.due_date) ? 'var(--bad)' : undefined }}>{r.due_date || ''}</td>
              <td><button className="btn primary" style={{ minHeight: 36, padding: '4px 12px' }} onClick={() => setPay(r)}>{km ? 'ទទួលប្រាក់' : 'Collect'}</button></td></tr>)}
              {!bal.length && <tr><td colSpan="7" className="muted">{km ? 'គ្មានប្រាក់នៅខ្វះទេ។' : 'Nothing owed.'}</td></tr>}</tbody></table>
        </div>
      )}
      {pay && <Collect r={pay} rate={me.rate} km={km} onClose={() => setPay(null)} onDone={() => { setPay(null); show(km ? 'បានទទួលប្រាក់' : 'Payment received'); load(); }} />}
      {toast}
    </div>
  );
}

function Collect({ r, rate, km, onClose, onDone }) {
  const [method, setMethod] = useState('cash'); const [cur, setCur] = useState('USD'); const [amt, setAmt] = useState((r.balance_cents / 100).toFixed(2)); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const c = method === 'khqr' ? 'USD' : cur;
  const go = async () => { setBusy(true); setErr(''); try { await api.post(`/balances/${r.id}/collect`, { method, currency: c, amount: c === 'USD' ? Math.round(Number(amt) * 100) : Math.round(Number(amt)) }); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Modal title={`${r.customer_name} · ${r.receipt_no}`} onClose={onClose}>
      <p>{km ? 'នៅខ្វះ' : 'Balance owed'}: <b>{usd(r.balance_cents)}</b> <span className="muted">({riel(toRiel(r.balance_cents, rate))})</span></p>
      <div className="tabs"><button className={`chip ${method === 'cash' ? 'on' : ''}`} onClick={() => { setMethod('cash'); setAmt((r.balance_cents / 100).toFixed(2)); setCur('USD'); }}>Cash USD</button>
        <button className={`chip ${method === 'cash' && cur === 'KHR' ? 'on' : ''}`} onClick={() => { setMethod('cash'); setCur('KHR'); setAmt(String(toRiel(r.balance_cents, rate))); }}>Cash ៛</button>
        <button className={`chip ${method === 'khqr' ? 'on' : ''}`} onClick={() => { setMethod('khqr'); setAmt((r.balance_cents / 100).toFixed(2)); }}>KHQR</button></div>
      <label>{km ? 'ចំនួនទទួល' : 'Amount received'} ({c === 'USD' ? '$' : '៛'})</label><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus />
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 14 }} disabled={busy || !(Number(amt) > 0)} onClick={go}>{km ? 'បញ្ជាក់' : 'Confirm'}</button>
    </Modal>
  );
}
