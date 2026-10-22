import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, useName, LevelBadge, Modal, useToast } from '../ui.jsx';
import { usd } from '../format.js';

export default function Lookup() {
  const { me, store } = useApp(); const t = useT(); const nm = useName();
  const [q, setQ] = useState(''); const [data, setData] = useState(null); const [req, setReq] = useState(null);
  const [toast, show] = useToast();
  useEffect(() => { const h = setTimeout(() => { if (q.trim().length >= 2) api.get(`/stock/lookup${qs({ store_id: store.id, q })}`).then(setData).catch(() => setData(null)); else setData(null); }, 250); return () => clearTimeout(h); }, [q, store.id]);
  const stores = data?.stores || [];
  return (
    <div>
      <h1>{t('lookup')}</h1>
      <p className="muted small" style={{ margin: '4px 0 0' }}>Search every branch and warehouse. You can only look here; to receive or adjust stock, use “Stock in this branch”.</p>
      <input className="scanbox" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a code, name or colour" style={{ marginTop: 12 }} />
      {data && !data.items.length && <p className="muted">Nothing found.</p>}
      <div className="col" style={{ marginTop: 14 }}>
        {data?.items.map((it) => (
          <div key={it.id} className="card">
            <div className="row between wrap"><div><b>{nm(it)}</b> <span className="muted">· {it.colour_en} · {it.size}</span><div className="small muted">{it.sku}</div></div><b>{usd(it.price_cents)}</b></div>
            <div className="row wrap" style={{ marginTop: 10 }}>
              {it.stores.map((s) => {
                const info = stores.find((x) => x.id === s.store_id);
                return <div key={s.store_id} className="card" style={{ padding: 10, minWidth: 140, borderColor: s.store_id === store.id ? 'var(--accent)' : undefined }}>
                  <div className="small muted">{info?.name || s.store_id}{s.store_id === store.id && <> · <span>you are here</span></>}</div>
                  <div className="row"><LevelBadge level={s.level} />{s.qty !== undefined && <b className="num">{s.qty}</b>}</div></div>;
              })}
              {it.incoming > 0 && <span className="small muted">+{it.incoming} on the way</span>}
            </div>
            {me.perms.includes('transfer.request') && it.stores.some((s) => s.store_id !== store.id && s.level !== 'out') && <button className="btn" style={{ marginTop: 10 }} onClick={() => setReq(it)}>{t('request')}</button>}
          </div>
        ))}
      </div>
      {req && <RequestModal item={req} stores={stores} onClose={() => setReq(null)} onDone={() => { setReq(null); show('Request sent for approval.'); }} />}
      {toast}
    </div>
  );
}

function RequestModal({ item, stores, onClose, onDone }) {
  const { store } = useApp(); const [from, setFrom] = useState(item.stores.find((s) => s.store_id !== store.id && s.level !== 'out')?.store_id); const [qty, setQty] = useState(1); const [why, setWhy] = useState(''); const [err, setErr] = useState('');
  return (
    <Modal title="Request transfer" onClose={onClose}>
      <p>{item.sku} → {store.name}</p>
      <label>From store</label>
      <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>{item.stores.filter((s) => s.store_id !== store.id && s.level !== 'out').map((s) => <option key={s.store_id} value={s.store_id}>{stores.find((x) => x.id === s.store_id)?.name}</option>)}</select>
      <label>Pieces</label><input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
      <label>Reason (customer waiting, restock…)</label><input value={why} onChange={(e) => setWhy(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 14 }} onClick={async () => { try { await api.post('/transfers', { from_store_id: from, to_store_id: store.id, reason: why, lines: [{ item_id: item.id, qty: Number(qty) }] }); onDone(); } catch (e) { setErr(e.message); } }}>Send request</button>
    </Modal>
  );
}
