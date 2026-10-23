import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp, Modal } from '../ui.jsx';

// Filters that can sit under the search bar. The owner chooses which ones show, separately for Stock and POS.
export const FILTERS = {
  type: { en: 'Type', km: 'ប្រភេទ', kind: 'pick' },
  colour: { en: 'Colour', km: 'ពណ៌', kind: 'pick' },
  size: { en: 'Size', km: 'ទំហំ', kind: 'pick' },
  brand: { en: 'Brand', km: 'ម៉ាក', kind: 'pick' },
  price: { en: 'Price', km: 'តម្លៃ', kind: 'pick' },
  instock: { en: 'In stock only', km: 'មានក្នុងស្តុកតែប៉ុណ្ណោះ', kind: 'toggle' },
  low: { en: 'Low stock only', km: 'ជិតអស់ស្តុកតែប៉ុណ្ណោះ', kind: 'toggle', stockOnly: true },
};
const BANDS = [['u100', 0, 10000, 'Under $100', 'ក្រោម $100'], ['100', 10000, 20000, '$100 – $199', '$100 – $199'], ['200', 20000, 30000, '$200 – $299', '$200 – $299'], ['300', 30000, Infinity, '$300 and up', '$300 ឡើង']];
const sizeSort = (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || String(a).localeCompare(String(b));

// Does one item row pass the chosen filters? `qty` is how many are on hand here.
export function passes(r, sel, qty, filterKeys) {
  for (const k of filterKeys) {
    const v = sel[k]; if (!v) continue;
    if (k === 'type' && r.type_code !== v) return false;
    if (k === 'colour' && r.colour_code !== v) return false;
    if (k === 'size' && String(r.size) !== v) return false;
    if (k === 'brand' && r.brand_code !== v) return false;
    if (k === 'price') { const b = BANDS.find((x) => x[0] === v); if (b && !(r.price_cents >= b[1] && r.price_cents < b[2])) return false; }
    if (k === 'instock' && !(qty > 0)) return false;
    if (k === 'low' && !(qty <= (r.low_stock ?? 2))) return false;
  }
  return true;
}

function optionsFor(key, items, km) {
  if (key === 'type') return [...new Map(items.map((i) => [i.type_code, i])).values()].map((i) => ({ v: i.type_code, l: (km && i.type_name_km) || i.type_name_en || i.type_code }));
  if (key === 'colour') return [...new Map(items.map((i) => [i.colour_code, i])).values()].map((i) => ({ v: i.colour_code, l: (km && i.colour_km) || i.colour_en || i.colour_code }));
  if (key === 'size') return [...new Set(items.map((i) => String(i.size)))].sort(sizeSort).map((v) => ({ v, l: v }));
  if (key === 'brand') return [...new Set(items.map((i) => i.brand_code))].filter(Boolean).sort().map((v) => ({ v, l: v }));
  if (key === 'price') return BANDS.map((b) => ({ v: b[0], l: km ? b[4] : b[3] }));
  return [];
}

// Which filters to show for a screen ('stock' or 'pos'), and whether this person may change them.
export function useFilterConfig(scope) {
  const [cfg, setCfg] = useState(null);
  const load = () => api.get('/filters').then(setCfg).catch(() => setCfg({ stock: [], pos: [], can_edit: false }));
  useEffect(() => { load(); }, []);
  return { keys: cfg ? (cfg[scope] || []).filter((k) => FILTERS[k] && !(scope === 'pos' && FILTERS[k].stockOnly)) : [], canEdit: !!cfg?.can_edit, reload: load };
}

export default function FilterBar({ scope, items, sel, setSel, cfg }) {
  const { lang } = useApp(); const km = lang === 'km'; const [edit, setEdit] = useState(false);
  const opts = useMemo(() => Object.fromEntries(cfg.keys.filter((k) => FILTERS[k].kind === 'pick').map((k) => [k, optionsFor(k, items, km)])), [cfg.keys, items, km]);
  if (!cfg.keys.length && !cfg.canEdit) return null;
  return (
    <div className="fbar">
      {cfg.keys.map((k) => FILTERS[k].kind === 'toggle'
        ? <button key={k} className={`chip ${sel[k] ? 'on' : ''}`} onClick={() => setSel({ ...sel, [k]: sel[k] ? '' : '1' })}>{km ? FILTERS[k].km : FILTERS[k].en}</button>
        : <select key={k} className={`fsel ${sel[k] ? 'on' : ''}`} value={sel[k] || ''} onChange={(e) => setSel({ ...sel, [k]: e.target.value })} aria-label={km ? FILTERS[k].km : FILTERS[k].en}>
          <option value="">{km ? FILTERS[k].km : FILTERS[k].en}: {km ? 'ទាំងអស់' : 'All'}</option>
          {(opts[k] || []).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>)}
      {Object.values(sel).some(Boolean) && <button className="chip" onClick={() => setSel({})}>✕ {km ? 'សម្អាត' : 'Clear'}</button>}
      {cfg.canEdit && <button className="chip add" onClick={() => setEdit(true)}>＋ {km ? 'តម្រង' : 'Filter'}</button>}
      {edit && <EditFilters scope={scope} cfg={cfg} onClose={() => setEdit(false)} />}
    </div>
  );
}

function EditFilters({ scope, cfg, onClose }) {
  const { lang } = useApp(); const km = lang === 'km'; const L = (e, k) => (km ? k : e);
  const all = Object.keys(FILTERS).filter((k) => !(scope === 'pos' && FILTERS[k].stockOnly));
  const [on, setOn] = useState(cfg.keys); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const toggle = (k) => setOn(on.includes(k) ? on.filter((x) => x !== k) : [...on, k]);
  const move = (k, d) => { const i = on.indexOf(k); const j = i + d; if (i < 0 || j < 0 || j >= on.length) return; const n = [...on]; [n[i], n[j]] = [n[j], n[i]]; setOn(n); };
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('/filters', { scope, keys: on }); cfg.reload(); onClose(); } catch (e) { setErr(e.message || 'Could not save.'); setBusy(false); }
  };
  return (
    <Modal title={L(`Filters under the search bar (${scope === 'pos' ? 'POS' : 'Stock'})`, `តម្រងក្រោមប្រអប់ស្វែងរក (${scope === 'pos' ? 'POS' : 'ស្តុក'})`)} onClose={onClose}>
      <p className="muted small">{L('Tick the filters everyone should see. Use ▲ ▼ to change the order. This changes the screen for all shops and all staff.', 'ធីកតម្រងដែលអ្នកគ្រប់គ្នាត្រូវឃើញ។ ប្រើ ▲ ▼ ដើម្បីប្តូរលំដាប់។ នេះផ្លាស់ប្តូរសម្រាប់គ្រប់ហាង និងបុគ្គលិកទាំងអស់។')}</p>
      {[...on, ...all.filter((k) => !on.includes(k))].map((k) => (
        <div key={k} className="row between" style={{ padding: '6px 0' }}>
          <label style={{ textTransform: 'none', fontSize: 15, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={on.includes(k)} onChange={() => toggle(k)} style={{ width: 20, height: 20, minHeight: 0 }} />{km ? FILTERS[k].km : FILTERS[k].en}</label>
          {on.includes(k) && <span className="row"><button className="btn" onClick={() => move(k, -1)} aria-label="Up">▲</button><button className="btn" onClick={() => move(k, 1)} aria-label="Down">▼</button></span>}
        </div>))}
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={save}>{L('Save', 'រក្សាទុក')}</button>
    </Modal>
  );
}
