import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, useToast } from '../ui.jsx';
import { usd, todayISO } from '../format.js';

export default function Expenses() {
  const { me } = useApp(); const t = useT(); const [toast, show] = useToast();
  const [store, setStore] = useState(String(me.store_id)); const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [data, setData] = useState(null); const [cats, setCats] = useState([]); const [err, setErr] = useState('');
  const [f, setF] = useState({ date: todayISO(), category: '', amount: '', currency: 'USD', note: '', photo: null }); const [view, setView] = useState(null);
  const pick = (file) => { if (!file) return; const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, 1100 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); setF((x) => ({ ...x, photo: c.toDataURL('image/jpeg', 0.6) })); }; img.src = r.result; }; r.readAsDataURL(file); };
  const showPhoto = async (r) => { try { setView((await api.get(`/expenses/${r.id}/photo`)).photo); } catch (x) { setErr(x.message); } };
  const canAll = me.perms.includes('dashboard.all_stores');
  const load = () => api.get(`/expenses${qs({ store_id: store, month })}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [store, month]);
  useEffect(() => { api.get('/expense-categories').then((c) => { setCats(c); setF((x) => ({ ...x, category: x.category || c[0]?.name || '' })); }); }, []);
  const add = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post('/expenses', { ...f, store_id: store === 'all' ? me.store_id : Number(store) }); setF({ ...f, amount: '', note: '', photo: null }); show('Saved'); load(); } catch (x) { setErr(x.message); }
  };
  const del = async (r) => { if (!window.confirm(`Delete this ${r.category} expense of ${usd(r.amount_cents)}?`)) return; try { await api.post(`/expenses/${r.id}/delete`); load(); } catch (x) { setErr(x.message); } };
  return (
    <div>
      <h1>{t('expenses')}</h1>
      <div className="row wrap" style={{ margin: '12px 0' }}>
        <select value={store} onChange={(e) => setStore(e.target.value)} style={{ width: 'auto', minWidth: 200 }}>{canAll && <option value="all">{t('all_stores')}</option>}{me.stores.filter((s) => s.kind !== 'warehouse').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />
      </div>
      <form className="card" onSubmit={add}>
        <div className="row wrap">
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={{ width: 'auto' }} />
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={{ width: 'auto' }}>{cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
          <input type="number" step="0.01" min="0" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ width: 130 }} />
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} style={{ width: 'auto' }}><option value="USD">USD</option><option value="KHR">៛ Riel</option></select>
          <input placeholder="Note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="grow" />
          <label className="btn" style={{ cursor: 'pointer' }}>📷 {f.photo ? 'Photo added' : 'Receipt photo'}<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => pick(e.target.files[0])} /></label>
          {f.photo && <img src={f.photo} alt="" style={{ height: 40, borderRadius: 6 }} />}
          <button className="btn primary">Add expense</button>
        </div>
        {data && data.photo_required_cents > 0 && <p className="muted small">A receipt photo is required for expenses of {usd(data.photo_required_cents)} or more.</p>}
        {store === 'all' && <p className="muted small">New expenses are added to your current store ({me.stores.find((s) => s.id === me.store_id)?.name}).</p>}
        {err && <div className="error">{err}</div>}
      </form>
      {data && <>
        <div className="grid g3" style={{ marginTop: 12 }}>
          <div className="card"><div className="muted small">Total this month</div><div style={{ fontSize: 26, fontWeight: 700 }}>{usd(data.total_cents)}</div></div>
          {data.by_category.slice(0, 2).map((c) => <div className="card" key={c.category}><div className="muted small">{c.category}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{usd(c.cents)}</div></div>)}
        </div>
        {data.by_category.length > 2 && <div className="card" style={{ marginTop: 12 }}><div className="row wrap">{data.by_category.map((c) => <span key={c.category} className="badge">{c.category}: {usd(c.cents)}</span>)}</div></div>}
        <div className="card" style={{ marginTop: 12, overflow: 'auto' }}><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th>By</th><th className="right">Amount</th><th></th></tr></thead>
          <tbody>{data.rows.map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.category}</td><td>{r.note}{r.input_currency === 'KHR' && <span className="small muted"> ({Math.round(r.input_amount).toLocaleString()} ៛)</span>}</td><td className="small muted">{r.created_by_name}</td><td className="right num">{usd(r.amount_cents)}</td><td className="row">{r.has_photo && <button className="btn" onClick={() => showPhoto(r)}>📷</button>}<button className="btn" onClick={() => del(r)}>Delete</button></td></tr>)}
            {!data.rows.length && <tr><td colSpan="6" className="muted">No expenses this month.</td></tr>}</tbody></table></div>
      </>}
      {view && <div className="modal-bg" onClick={() => setView(null)}><div className="modal" style={{ maxWidth: 720 }}><img src={view} alt="Receipt" style={{ width: '100%', borderRadius: 8 }} /><button className="btn" style={{ marginTop: 10 }} onClick={() => setView(null)}>Close</button></div></div>}
      {toast}
    </div>
  );
}
