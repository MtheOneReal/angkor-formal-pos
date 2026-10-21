import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, Modal, useToast } from '../ui.jsx';
import { dt } from '../format.js';

const LABEL = { requested: 'Waiting for approval', awaiting_owner: 'Waiting for an owner', approved: 'Approved, ready to send', rejected: 'Rejected', in_transit: 'On the way', received: 'Received', discrepancy: 'Count differs', resolved: 'Resolved', cancelled: 'Cancelled' };

export default function Transfers() {
  const { me, store } = useApp(); const t = useT();
  const [rows, setRows] = useState([]); const [open, setOpen] = useState(null); const [toast, show] = useToast(); const [filter, setFilter] = useState('open');
  const load = useCallback(() => api.get(`/transfers${qs({ store_id: store.id })}`).then(setRows), [store.id]);
  useEffect(() => { load(); }, [load]);
  const shown = rows.filter((r) => (filter === 'open' ? !['received', 'rejected', 'cancelled', 'resolved'].includes(r.status) : true));
  return (
    <div>
      <h1>{t('transfers')}</h1>
      <div className="tabs" style={{ marginTop: 10 }}><button className={`chip ${filter === 'open' ? 'on' : ''}`} onClick={() => setFilter('open')}>Open</button><button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button></div>
      <div className="card" style={{ overflow: 'auto' }}>
        <table><thead><tr><th>No.</th><th>From → To</th><th>Status</th><th>Requested</th></tr></thead>
          <tbody>{shown.map((r) => <tr key={r.id} className="click" onClick={() => setOpen(r.id)}><td><b>{r.code}</b></td><td>{r.from_store.name} → {r.to_store.name}</td><td><span className="badge">{LABEL[r.status]}</span></td><td>{dt(r.requested_ts)}</td></tr>)}</tbody></table>
        {!shown.length && <p className="muted">No transfers.</p>}
      </div>
      {open && <Detail id={open} onClose={() => { setOpen(null); load(); }} show={show} />}
      {toast}
    </div>
  );
}

function Detail({ id, onClose, show }) {
  const { me } = useApp(); const [tr, setTr] = useState(null); const [err, setErr] = useState(''); const [recv, setRecv] = useState({}); const [note, setNote] = useState('');
  const load = () => api.get(`/transfers/${id}`).then((x) => { setTr(x); setRecv(Object.fromEntries(x.lines.map((l) => [l.id, l.qty_requested]))); });
  useEffect(() => { load(); }, [id]);
  if (!tr) return null;
  const act = async (path, body) => { setErr(''); try { await api.post(`/transfers/${id}/${path}`, body); show('Done'); await load(); } catch (e) { setErr(e.message); } };
  const p = (x) => me.perms.includes(x);
  const inFrom = me.stores.some((s) => s.id === tr.from_store_id); const inTo = me.stores.some((s) => s.id === tr.to_store_id);
  return (
    <Modal title={`${tr.code}`} onClose={onClose} wide>
      <p><b>{tr.from_store.name}</b> → <b>{tr.to_store.name}</b> · <span className="badge">{LABEL[tr.status]}</span></p>
      {tr.reason && <p className="muted">Reason: {tr.reason}</p>}
      <table><thead><tr><th>Item</th><th className="right">Asked</th>{['in_transit', 'received', 'discrepancy', 'resolved'].includes(tr.status) && <th className="right">Received</th>}</tr></thead>
        <tbody>{tr.lines.map((l) => <tr key={l.id}><td>{l.sku}<div className="small muted">{l.name_en} · {l.size}</div></td><td className="right">{l.qty_requested}</td>
          {tr.status === 'in_transit' && inTo && p('transfer.receive') ? <td style={{ width: 110 }}><input type="number" min="0" value={recv[l.id] ?? ''} onChange={(e) => setRecv({ ...recv, [l.id]: e.target.value })} /></td> : ['in_transit', 'received', 'discrepancy', 'resolved'].includes(tr.status) && <td className="right">{l.qty_received ?? ''}</td>}</tr>)}</tbody></table>
      {err && <div className="error">{err}</div>}
      <div className="row wrap" style={{ marginTop: 14 }}>
        {['requested'].includes(tr.status) && inFrom && p('transfer.approve') && <><button className="btn primary" onClick={() => act('approve')}>Approve</button><button className="btn danger" onClick={() => act('reject', { reason: 'Not available' })}>Reject</button></>}
        {tr.status === 'awaiting_owner' && p('transfer.resolve') && <button className="btn primary" onClick={() => act('owner-approve')}>Owner approve</button>}
        {tr.status === 'approved' && inFrom && p('transfer.send') && <button className="btn primary" onClick={() => act('send', {})}>Mark as sent</button>}
        {tr.status === 'in_transit' && inTo && p('transfer.receive') && <button className="btn primary" onClick={() => act('receive', { lines: tr.lines.map((l) => ({ line_id: l.id, qty_received: Number(recv[l.id] ?? l.qty_requested) })) })}>Confirm received</button>}
        {tr.status === 'discrepancy' && p('transfer.resolve') && <><input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 200 }} /><button className="btn" onClick={() => act('resolve', { resolution: 'found', note })}>Found</button><button className="btn danger" onClick={() => act('resolve', { resolution: 'lost', note })}>Lost</button></>}
        {['requested', 'awaiting_owner', 'approved'].includes(tr.status) && <button className="btn" onClick={() => act('cancel')}>Cancel request</button>}
      </div>
    </Modal>
  );
}
