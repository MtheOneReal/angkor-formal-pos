import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, useName, LevelBadge, useToast } from '../ui.jsx';
import { RequestModal } from './Lookup.jsx';

// For cashiers and managers: what is selling best (ranked) and what is running low in this branch, with a one-tap request.
export default function Restock() {
  const { me, store, lang } = useApp(); const t = useT(); const nm = useName(); const km = lang === 'km'; const L = (en, kh) => (km ? kh : en);
  const [days, setDays] = useState(30); const [d, setD] = useState(null); const [err, setErr] = useState(''); const [req, setReq] = useState(null); const [toast, show] = useToast();
  useEffect(() => { setD(null); api.get(`/stock/restock${qs({ store_id: store.id, days })}`).then(setD).catch((e) => setErr(e.message)); }, [store.id, days]);
  const canReq = me.perms.includes('transfer.request');
  const ask = async (r) => {
    try { const x = await api.get(`/stock/lookup${qs({ store_id: store.id, q: r.sku })}`); const it = x.items.find((i) => i.id === r.id); if (it) setReq({ item: it, stores: x.stores }); } catch (e) { setErr(e.message); }
  };
  const Name = ({ r }) => <div><b>{nm(r)}</b> <span className="muted">· {r.colour_en} · {r.size}</span><div className="small muted">{r.sku}</div></div>;
  const Btn = ({ r }) => (canReq && r.can_other && r.others > 0 && r.level !== 'in') ? <button className="btn" onClick={() => ask(r)}>{t('request')}</button> : (r.level !== 'in' && r.can_other ? <span className="small muted">{L('Not in other branches', 'គ្មានក្នុងសាខាផ្សេង')}</span> : null);
  return (
    <div>
      <div className="row between wrap"><h1>{L('Best sellers and low stock', 'លក់ដាច់ និងស្តុកជិតអស់')} — {store.name}</h1>
        <div className="row">{[7, 30, 90].map((n) => <button key={n} className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>{n} {L('days', 'ថ្ងៃ')}</button>)}</div></div>
      {err && <div className="error">{err}</div>}
      {!d && !err && <p className="muted">{L('Loading…', 'កំពុងផ្ទុក…')}</p>}
      {d && (
        <>
          <div className="card tbl" style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 8 }}>🏆 {L('Best sellers, ranked', 'លក់ដាច់ តាមលំដាប់')}</h3>
            <table><thead><tr><th>#</th><th>{L('Product', 'ទំនិញ')}</th><th className="right">{L('Sold', 'បានលក់')}</th><th>{L('In this branch', 'ក្នុងសាខានេះ')}</th>{d.can_other && <th className="right">{L('Other branches', 'សាខាផ្សេង')}</th>}<th /></tr></thead>
              <tbody>{d.best.map((r) => (
                <tr key={r.id}><td><b>{r.rank}</b></td><td><Name r={r} /></td><td className="right num"><b>{r.sold}</b></td>
                  <td><LevelBadge level={r.level} /> <b className="num">{r.here}</b></td>{d.can_other && <td className="right num">{r.others}</td>}<td className="right"><Btn r={r} /></td></tr>))}
                {!d.best.length && <tr><td colSpan="6" className="muted">{L('No sales in this period yet.', 'មិនទាន់មានការលក់ក្នុងរយៈពេលនេះទេ។')}</td></tr>}</tbody></table>
          </div>
          <div className="card tbl" style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 8 }}>⚠️ {L('Running low or out', 'ជិតអស់ ឬអស់ស្តុក')}</h3>
            <table><thead><tr><th>{L('Product', 'ទំនិញ')}</th><th>{L('In this branch', 'ក្នុងសាខានេះ')}</th><th className="right">{L('Sold', 'បានលក់')}</th>{d.can_other && <th className="right">{L('Other branches', 'សាខាផ្សេង')}</th>}<th /></tr></thead>
              <tbody>{d.low.map((r) => (
                <tr key={r.id}><td><Name r={r} /></td><td><LevelBadge level={r.level} /> <b className="num">{r.here}</b></td><td className="right num">{r.sold}</td>{d.can_other && <td className="right num">{r.others}</td>}<td className="right"><Btn r={r} /></td></tr>))}
                {!d.low.length && <tr><td colSpan="5" className="muted">{L('Nothing is running low.', 'គ្មានអ្វីជិតអស់ទេ។')}</td></tr>}</tbody></table>
          </div>
        </>
      )}
      {req && <RequestModal item={req.item} stores={req.stores} onClose={() => setReq(null)} onDone={() => { setReq(null); show(L('Request sent for approval.', 'បានផ្ញើសំណើសុំការអនុម័ត។')); }} />}
      {toast}
    </div>
  );
}
