import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, useT, Modal, useToast } from '../ui.jsx';
import { dt } from '../format.js';

const SWITCHES = [
  ['require_scan_to_sell', 'Require scan to sell', 'Typed items need a manager PIN.'], ['blind_counts', 'Blind cash count', 'Cashier does not see the difference at shift close.'],
  ['pin_every_discount', 'PIN for every discount', 'Even small ones.'], ['pin_every_return', 'PIN for every return', ''], ['receipt_required', 'Receipt required', ''], ['customer_required', 'Customer required on every sale', ''],
  ['cashier_see_other_stock', 'Cashiers can see other stores', ''], ['show_exact_other_qty', 'Show exact quantities of other stores', 'Off shows only In stock / Low / Out.'],
  ['owner_approval_large_transfer', 'Owner approval for large transfers', ''],
];

export default function Settings() {
  const { me } = useApp(); const [tab, setTab] = useState('stores'); const t = useT();
  const owner = me.perms.includes('settings.manage');
  return (
    <div>
      <h1>{t('settings')}</h1>
      <div className="tabs" style={{ margin: '12px 0' }}>
        {[['stores', 'Stores & rules'], ['users', 'Staff'], ['rate', 'Exchange rate'], ['audit', 'Activity log']].map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'stores' && owner && <Stores />}{tab === 'users' && <Users />}{tab === 'rate' && <Rate />}{tab === 'audit' && <Audit />}
    </div>
  );
}

function AddStore({ onAdded }) {
  const [f, setF] = useState({ name: '', code: '', brand_id: '' }); const [brands, setBrands] = useState([]); const [err, setErr] = useState(''); const [open, setOpen] = useState(false);
  useEffect(() => { api.get('/meta').then((m) => { setBrands(m.brands); setF((x) => ({ ...x, brand_id: m.brands[0]?.id })); }); }, []);
  const go = async (e) => { e.preventDefault(); setErr(''); try { await api.post('/admin/stores', f); setF({ ...f, name: '', code: '' }); setOpen(false); onAdded(); } catch (x) { setErr(x.message); } };
  if (!open) return <button className="btn" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>+ Add a store</button>;
  return (
    <form className="card" style={{ marginTop: 12 }} onSubmit={go}>
      <h3>Add a store</h3>
      <label>Store name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label>Short code (2 to 4 letters, used on receipts)</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={{ width: 120 }} />
      <label>Brand</label><select value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary">Add store</button><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

function Stores() {
  const [data, setData] = useState(null); const [sid, setSid] = useState(null); const [toast, show] = useToast();
  const load = () => api.get('/admin/stores').then((d) => { setData(d); setSid((x) => x ?? d.stores[0].id); });
  useEffect(() => { load(); }, []);
  if (!data) return null;
  const s = data.stores.find((x) => x.id === sid);
  const save = async (patch) => { await api.put(`/admin/stores/${s.id}`, patch); show('Saved'); load(); };
  return (
    <div>
      <select value={sid} onChange={(e) => setSid(Number(e.target.value))} style={{ width: 'auto', minWidth: 260 }}>{data.stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <div className="card" style={{ marginTop: 12 }}>
        <label>Store name</label><input defaultValue={s.name} key={`n${s.id}`} onBlur={(e) => e.target.value !== s.name && save({ name: e.target.value })} />
        <label>Receipt footer</label><input defaultValue={s.receipt_footer} key={`f${s.id}`} onBlur={(e) => e.target.value !== s.receipt_footer && save({ receipt_footer: e.target.value })} />
        <label>Auto-lock after (minutes, 0 = off)</label><input type="number" min="0" defaultValue={s.switches.autolock_minutes} key={`a${s.id}`} style={{ width: 120 }} onBlur={(e) => save({ switches: { autolock_minutes: Number(e.target.value) } })} />
        <label>Cashier discount limit (%) — placeholder, confirm with owners</label><input type="number" min="0" max="100" defaultValue={s.switches.cashier_discount_limit_percent} key={`d${s.id}`} style={{ width: 120 }} onBlur={(e) => save({ switches: { cashier_discount_limit_percent: Number(e.target.value) } })} />
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        {SWITCHES.map(([k, l, h]) => (
          <label key={k} style={{ display: 'flex', gap: 12, alignItems: 'center', textTransform: 'none', fontSize: 15, color: 'var(--text)', margin: '8px 0' }}>
            <input type="checkbox" checked={!!s.switches[k]} onChange={(e) => save({ switches: { [k]: e.target.checked } })} style={{ width: 22, height: 22, minHeight: 0 }} />
            <span><b>{l}</b>{h && <span className="muted small"> — {h}</span>}</span></label>))}
      </div>
      <AddStore onAdded={() => { load(); window.dispatchEvent(new Event('af-reload-me')); }} />
      <p className="muted small" style={{ marginTop: 10 }}>Approval rules (no self-approval, second approver for large amounts) are always on.</p>{toast}
    </div>
  );
}

function Users() {
  const { me } = useApp(); const [data, setData] = useState(null); const [stores, setStores] = useState([]); const [edit, setEdit] = useState(null);
  const load = () => api.get('/admin/users').then(setData);
  useEffect(() => { load(); api.get('/public/stores').then(setStores); }, []);
  if (!me.perms.includes('users.manage')) return <p className="muted">Only owners can manage staff.</p>;
  if (!data) return null;
  return (
    <div>
      <button className="btn primary" onClick={() => setEdit({ name: '', role: 'cashier', store_ids: [], email: '', password: '', pin: '' })}>＋ Add staff</button>
      <div className="card" style={{ marginTop: 12, overflow: 'auto' }}><table><thead><tr><th>Name</th><th>Role</th><th>Stores</th><th></th></tr></thead>
        <tbody>{data.users.map((u) => <tr key={u.id} className="click" onClick={() => setEdit({ ...u, password: '', pin: '' })} style={{ opacity: u.active ? 1 : .5 }}><td><b>{u.name}</b>{u.demo && <span className="badge low" style={{ marginLeft: 8 }}>demo</span>}<div className="small muted">{u.email}</div></td><td>{u.role}</td><td>{u.role === 'owner' ? 'All' : u.store_ids.map((id) => stores.find((s) => s.id === id)?.code).join(', ')}</td><td>{!u.active && 'inactive'}</td></tr>)}</tbody></table></div>
      {edit && <UserForm u={edit} stores={stores} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function UserForm({ u, stores, onClose, onSaved }) {
  const [f, setF] = useState(u); const [err, setErr] = useState(''); const isNew = !u.id;
  const save = async () => {
    try {
      const body = { name: f.name, role: f.role, store_ids: f.store_ids, email: f.email || null, lang: f.lang };
      if (f.password) body.password = f.password; if (f.pin) body.pin = f.pin;
      if (isNew) await api.post('/admin/users', body); else await api.put(`/admin/users/${u.id}`, { ...body, active: f.active });
      onSaved();
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={isNew ? 'Add staff' : u.name} onClose={onClose}>
      <label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label>Role</label><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="cashier">Cashier</option><option value="manager">Store manager</option><option value="owner">Owner</option></select>
      {f.role !== 'owner' && <><label>Stores</label><div className="row wrap">{stores.map((s) => <button key={s.id} className={`chip ${f.store_ids.includes(s.id) ? 'on' : ''}`} onClick={() => setF({ ...f, store_ids: f.store_ids.includes(s.id) ? f.store_ids.filter((x) => x !== s.id) : [...f.store_ids, s.id] })}>{s.code}</button>)}</div></>}
      {f.role !== 'cashier' && <><label>Email</label><input value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} /><label>{isNew ? 'Password (8+ characters)' : 'New password (leave empty to keep)'}</label><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></>}
      <label>{isNew ? 'PIN (4–6 digits)' : 'New PIN (leave empty to keep)'}</label><input inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
      {!isNew && <label style={{ textTransform: 'none', fontSize: 15, color: 'var(--text)' }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} style={{ width: 20, height: 20, minHeight: 0, marginRight: 8 }} />Active</label>}
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} onClick={save}>Save</button>
    </Modal>
  );
}

function Rate() {
  const { me, reload } = useApp(); const [v, setV] = useState(me.rate); const [err, setErr] = useState(''); const [toast, show] = useToast();
  return (<div className="card" style={{ maxWidth: 420 }}><label>Riel per 1 US dollar (used on new sales)</label><input type="number" value={v} onChange={(e) => setV(e.target.value)} />{err && <div className="error">{err}</div>}
    <button className="btn primary" style={{ marginTop: 12 }} disabled={!me.perms.includes('rates.set')} onClick={async () => { try { await api.post('/rates', { khr_per_usd: Number(v) }); show('Rate saved'); reload(); } catch (e) { setErr(e.message); } }}>Save rate</button>{toast}</div>);
}

function Audit() {
  const [rows, setRows] = useState(null); const { me } = useApp();
  useEffect(() => { api.get('/admin/audit?limit=200').then(setRows).catch(() => setRows([])); }, []);
  if (!me.perms.includes('audit.view')) return <p className="muted">Not available for your role.</p>;
  return (<div className="card" style={{ overflow: 'auto' }}><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>{(rows || []).map((r) => <tr key={r.id}><td>{dt(r.ts)}</td><td>{r.user_name}</td><td>{r.action}<div className="small muted">{r.detail && String(r.detail).slice(0, 120)}</div></td></tr>)}</tbody></table></div>);
}
