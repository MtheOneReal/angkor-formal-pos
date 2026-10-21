import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useT, useToast } from '../ui.jsx';

export default function Customers() {
  const t = useT(); const [q, setQ] = useState(''); const [rows, setRows] = useState([]); const [f, setF] = useState({ name: '', phone: '' }); const [err, setErr] = useState(''); const [toast, show] = useToast();
  const load = () => api.get(`/customers${qs({ q })}`).then(setRows);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [q]);
  return (
    <div>
      <h1>{t('customers')}</h1>
      <div className="card" style={{ margin: '12px 0' }}>
        <div className="row wrap"><input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="grow" /><input placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="grow" />
          <button className="btn primary" onClick={async () => { try { await api.post('/customers', f); setF({ name: '', phone: '' }); setErr(''); show('Saved'); load(); } catch (e) { setErr(e.message); } }}>Add customer</button></div>
        {err && <div className="error">{err}</div>}
      </div>
      <input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 12 }}><table><thead><tr><th>Name</th><th>Phone</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.phone}</td></tr>)}</tbody></table></div>
      {toast}
    </div>
  );
}
