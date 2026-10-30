import { groupsFor } from '../sizeGroups.js';
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from '../ui.jsx';

const TABS = [['brands', 'Brands'], ['types', 'Types'], ['sizes', 'Sizes']];

// Owner-only editor for the lists used when creating products.
export default function ListsManager({ start = 'brands', onClose }) {
  const [tab, setTab] = useState(start); const [meta, setMeta] = useState(null); const [err, setErr] = useState('');
  const load = () => api.get('/meta').then(async (m) => { const z = await api.get('/lists/sizes'); setMeta({ ...m, size_sets: z.size_sets, type_groups: z.type_groups || {} }); });
  useEffect(() => { load(); }, []);
  const run = async (fn) => { setErr(''); try { await fn(); await load(); return true; } catch (e) { setErr(e.message); return false; } };
  if (!meta) return null;
  return (
    <Modal title="Edit lists" onClose={onClose} wide>
      <p className="muted small">Names can be changed any time. Codes cannot, because they are part of every product code and barcode. An entry can be deleted only when no product uses it.</p>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => { setTab(k); setErr(''); }}>{l}</button>)}</div>
      {err && <div className="error">{err}</div>}
      {tab === 'brands' && <Simple kind="brands" rows={meta.brands.map((b) => ({ key: b.id, code: b.code, name_en: b.name }))} fields={['name_en']} codeHint="Code (2–5 letters, e.g. AF)" run={run} done={onClose} types={meta.types} typeGroups={meta.type_groups || {}} />}
      {tab === 'types' && <Simple kind="types" rows={meta.types.map((b) => ({ key: b.code, code: b.code, name_en: b.name_en, name_km: b.name_km || '' }))} fields={['name_en', 'name_km']} codeHint="Code (1–3 letters, e.g. S)" run={run} done={onClose} types={meta.types} typeGroups={meta.type_groups || {}} />}
      {tab === 'sizes' && <Sizes sets={meta.size_sets || { Suit: meta.suit_sizes, Shirt: ['S', 'M', 'L', 'XL', 'XXL'], Waist: ['30', '32', '34', '36', '38'], 'One size': ['ONE'] }} run={run} done={onClose} />}
    </Modal>
  );
}

function Simple({ kind, rows, fields, codeHint, run, done }) {
  const [add, setAdd] = useState({ code: '', name_en: '', name_km: '', hex: '#1f2a44' }); const [edit, setEdit] = useState({});
  const label = { name_en: 'Name', name_km: 'Khmer name', hex: 'Colour' };
  const field = (f, v, on) => (f === 'hex' ? <input type="color" style={{ width: 54, padding: 2 }} value={v || '#999999'} onChange={(e) => on(e.target.value)} /> : <input style={{ minWidth: 120 }} placeholder={label[f]} value={v ?? ''} onChange={(e) => on(e.target.value)} />);
  return (
    <div className="tbl">
      <table><tbody>
        {rows.map((r) => { const v = { ...r, ...(edit[r.key] || {}) }; const dirty = !!edit[r.key];
          return (<tr key={r.key}><td style={{ width: 70 }}><b>{r.code}</b></td>
            {fields.map((f) => <td key={f}>{field(f, v[f], (x) => setEdit({ ...edit, [r.key]: { ...(edit[r.key] || {}), [f]: x } }))}</td>)}
            <td className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" disabled={!dirty} onClick={async () => { if (await run(() => api.post(`/lists/${kind}/${r.key}`, { name_en: v.name_en, name_km: v.name_km, hex: v.hex }))) done(); }}>Save</button>
              <button className="btn danger" onClick={() => { if (window.confirm(`Delete ${r.code} (${r.name_en})?`)) run(() => api.post(`/lists/${kind}/${r.key}/delete`)); }}>Delete</button></td></tr>); })}
        <tr><td><input style={{ width: 70 }} placeholder="Code" title={codeHint} value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value.toUpperCase() })} /></td>
          {fields.map((f) => <td key={f}>{field(f, add[f], (x) => setAdd({ ...add, [f]: x }))}</td>)}
          <td style={{ textAlign: 'right' }}><button className="btn primary" disabled={!add.code || !add.name_en} onClick={async () => { if (await run(() => api.post(`/lists/${kind}`, add))) done(); }}>＋ Add</button></td></tr>
      </tbody></table>
      <p className="muted small">{codeHint}</p>
    </div>
  );
}

function Sizes({ sets, run, done, types, typeGroups }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.join(', ')]))); const [newName, setNewName] = useState('');
  const [tg, setTg] = useState(() => Object.fromEntries(types.map((t) => [t.code, groupsFor(t, Object.keys(sets), typeGroups)])));
  const flip = (code, g) => setTg((x) => { const cur = x[code] || []; return { ...x, [code]: cur.includes(g) ? cur.filter((y) => y !== g) : [...cur, g] }; });
  const save = async () => { if (await run(() => api.post('/lists/sizes', { type_groups: tg, sets: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, String(v).split(',').map((x) => x.trim()).filter(Boolean)])) }))) done(); };
  return (
    <div>
      <p className="muted small">Each group is a row of size buttons when you add sizes to a design. Separate sizes with commas.</p>
      {Object.entries(draft).map(([k, v]) => <div key={k} className="row" style={{ marginBottom: 8 }}><b style={{ width: 90 }}>{k}</b><input className="grow" value={v} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /><button className="btn danger" onClick={() => setDraft((d) => { const n = { ...d }; delete n[k]; return n; })}>✕</button></div>)}
      <div className="row"><input style={{ width: 160 }} placeholder="New group (e.g. Shoes)" value={newName} onChange={(e) => setNewName(e.target.value)} /><button className="btn" disabled={!newName.trim()} onClick={() => { setDraft({ ...draft, [newName.trim()]: '' }); setNewName(''); }}>Add group</button></div>
      <h3 style={{ marginTop: 16, fontSize: 16 }}>Which sizes each type uses</h3>
      <p className="muted small">When you add sizes to a design, only the groups ticked for its type are shown, so a shirt never shows waist sizes.</p>
      {types.map((t) => <div key={t.code} className="row wrap" style={{ marginBottom: 6 }}><b style={{ width: 110 }}>{t.name_en}</b>{Object.keys(draft).map((g) => <button key={g} className={`chip ${(tg[t.code] || []).includes(g) ? 'on' : ''}`} onClick={() => flip(t.code, g)}>{g}</button>)}</div>)}
      <button className="btn primary" style={{ marginTop: 12 }} onClick={save}>Save sizes</button>
    </div>
  );
}
