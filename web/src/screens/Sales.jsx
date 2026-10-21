import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, Modal, ManagerPin, useToast } from '../ui.jsx';
import { usd, riel, dt, todayISO } from '../format.js';

export default function Sales() {
  const { me, store } = useApp(); const t = useT();
  const [date, setDate] = useState(todayISO()); const [q, setQ] = useState(''); const [rows, setRows] = useState([]); const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get(`/sales${qs({ store_id: store.id, date, q })}`).then(setRows), [store.id, date, q]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  const total = rows.filter((r) => r.status === 'completed').reduce((a, r) => a + r.total_cents, 0);
  return (
    <div>
      <h1>{t('sales')}</h1>
      <div className="row wrap" style={{ margin: '12px 0' }}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /><input placeholder="Receipt number" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        {me.role !== 'cashier' && <b className="num">Day total {usd(total)}</b>}</div>
      <div className="card" style={{ overflow: 'auto' }}>
        <table><thead><tr><th>Receipt</th><th>Time</th><th>Cashier</th><th>Pieces</th><th>Paid by</th><th className="right">Total</th><th></th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="click" onClick={() => setOpen(r.id)}><td><b>{r.receipt_no}</b></td><td>{dt(r.ts)}</td><td>{r.cashier_name}</td><td>{r.pieces}</td><td>{r.methods.join(', ')}</td><td className="right num">{usd(r.total_cents)}</td><td>{r.status !== 'completed' && <span className="badge out">{r.status}</span>}</td></tr>)}</tbody></table>
        {!rows.length && <p className="muted">No receipts for this day.</p>}
      </div>
      {open && <SaleDetail id={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function SaleDetail({ id, onClose }) {
  const { me } = useApp(); const [s, setS] = useState(null); const [mode, setMode] = useState(null); const [reason, setReason] = useState(''); const [pick, setPick] = useState({}); const [err, setErr] = useState(''); const [pin, setPin] = useState(false); const [toast, show] = useToast();
  const load = () => api.get(`/sales/${id}`).then(setS);
  useEffect(() => { load(); }, [id]);
  if (!s) return null;
  const run = async (pinVal) => {
    setErr('');
    try {
      if (mode === 'void') await api.post(`/sales/${id}/void`, { reason, manager_pin: pinVal });
      else await api.post(`/sales/${id}/return`, { reason, manager_pin: pinVal, lines: Object.entries(pick).filter(([, q]) => Number(q) > 0).map(([k, q]) => ({ sale_line_id: Number(k), qty: Number(q) })) });
      setPin(false); setMode(null); show('Done'); await load();
    } catch (e) { if (e.code === 'APPROVAL_REQUIRED') setPin(true); else { setPin(false); setErr(e.message); } if (pinVal) throw e; }
  };
  return (
    <Modal title={s.receipt_no} onClose={onClose} wide>
      <p className="muted">{dt(s.ts)} · {s.cashier_name} {s.status !== 'completed' && <span className="badge out">{s.status}</span>}</p>
      <table><tbody>{s.lines.map((l) => <tr key={l.id}><td>{l.name_en}<div className="small muted">{l.sku} · {l.colour_en} · {l.size}</div></td><td>{l.qty}{l.returned_qty ? ` (returned ${l.returned_qty})` : ''}</td><td className="right num">{usd(l.line_total_cents)}</td>
        {mode === 'return' && <td style={{ width: 90 }}><input type="number" min="0" max={l.qty - l.returned_qty} value={pick[l.id] || ''} onChange={(e) => setPick({ ...pick, [l.id]: e.target.value })} placeholder="0" /></td>}</tr>)}</tbody></table>
      {s.discount_cents > 0 && <p className="muted">Discount {usd(s.discount_cents)}{s.discount_reason ? ` — ${s.discount_reason}` : ''}</p>}
      <p><b>Total {usd(s.total_cents)}</b> <span className="muted">({riel(s.total_khr)})</span></p>
      {mode && <><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></>}
      {err && <div className="error">{err}</div>}
      <div className="row wrap" style={{ marginTop: 12 }}>
        {s.status === 'completed' && !mode && <button className="btn" onClick={() => setMode('return')}>Return items</button>}
        {s.status === 'completed' && !mode && (me.perms.includes('sales.void') || me.role === 'cashier') && <button className="btn danger" onClick={() => setMode('void')}>Void receipt</button>}
        {mode && <><button className="btn primary" disabled={reason.trim().length < 3} onClick={() => run().catch(() => {})}>Continue</button><button className="btn" onClick={() => setMode(null)}>Cancel</button></>}
      </div>
      {pin && <ManagerPin onClose={() => setPin(false)} onSubmit={(p) => run(p)} />}
      {toast}
    </Modal>
  );
}
