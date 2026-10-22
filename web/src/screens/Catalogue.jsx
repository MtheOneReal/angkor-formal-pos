import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { api } from '../api.js';
import { useApp, useT, useName, Modal, useToast } from '../ui.jsx';
import { usd } from '../format.js';
import ListsManager from './ListsManager.jsx';

const photo = (p) => (p ? ((p.startsWith('/') || p.startsWith('data:')) ? p : '/uploads/' + p) : null);
const SIZE_SETS = { Suit: ['44', '46', '48', '50', '52', '54', '56'], Shirt: ['S', 'M', 'L', 'XL', 'XXL'], Waist: ['30', '32', '34', '36', '38'], 'One size': ['ONE'] };

function Barcode({ value }) {
  const r = useRef();
  useEffect(() => { if (r.current) JsBarcode(r.current, value, { format: 'CODE128', width: 1.6, height: 38, displayValue: true, fontSize: 11, margin: 0 }); }, [value]);
  return <svg ref={r} />;
}

export default function Catalogue() {
  const { me } = useApp(); const t = useT(); const nm = useName();
  const [rows, setRows] = useState([]); const [meta, setMeta] = useState(null); const [lists, setLists] = useState(null); const reloadMeta = () => api.get('/meta').then(setMeta); const [add, setAdd] = useState(false); const [labels, setLabels] = useState(null); const [toast, show] = useToast();
  const load = () => api.get('/designs').then(setRows);
  useEffect(() => { load(); api.get('/meta').then(setMeta); }, []);
  const canCost = me.perms.includes('cost.view');
  return (
    <div>
      <div className="row between wrap"><h1>{t('catalogue')}</h1><div className="row wrap">{me.role === 'owner' && <button className="btn" onClick={() => setLists('brands')}>✎ Edit lists</button>}<button className="btn primary" onClick={() => setAdd(true)}>＋ New design</button></div></div>
      <div className="results" style={{ marginTop: 14 }}>
        {rows.map((d) => (
          <div key={d.id} className="tile">
            <div className="ph">{photo(d.photo) ? <img src={photo(d.photo)} alt="" /> : d.type_code}</div>
            <div className="in"><b style={{ fontSize: 13 }}>{nm(d)}</b><div className="small muted">{d.brand_code}-{d.type_code}{String(d.number).padStart(2, '0')} · {d.items.length} variants</div>
              <div className="row between"><b className="num">{usd(d.price_cents)}</b>{canCost && <span className="small muted">cost {usd(d.cost_cents)}</span>}</div>
              <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={() => setLabels(d)}>Print labels</button>
              {me.perms.includes('catalog.edit') && <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={async () => { if (!window.confirm(`Delete “${nm(d)}” and its ${d.items.length} variants for good?`)) return; try { await api.post(`/designs/${d.id}/delete`); show('Deleted'); load(); } catch (e) { window.alert(e.message); } }}>Delete</button>}</div>
          </div>))}
      </div>
      {lists && <ListsManager start={lists} onClose={() => { setLists(null); reloadMeta(); load(); }} />}
      {add && meta && <NewDesign meta={meta} owner={me.role === 'owner'} editLists={(k) => { setAdd(false); setLists(k); }} onClose={() => setAdd(false)} onDone={() => { setAdd(false); show('Design added'); load(); }} />}
      {labels && <Labels design={labels} meta={meta} onClose={() => setLabels(null)} />}
      {toast}
    </div>
  );
}

function NewDesign({ meta, owner, editLists, onClose, onDone }) {
  const sets = meta.size_sets || SIZE_SETS; const [custom, setCustom] = useState('');
  const [f, setF] = useState({ brand_id: meta.brands[0].id, type_code: meta.types[0].code, name_en: '', name_km: '', price_usd: '', cost_usd: '', colours: [], sizes: [], photo: null });
  const [err, setErr] = useState('');
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const pickPhoto = (file) => { if (!file) return; const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 480 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); setF((x) => ({ ...x, photo: c.toDataURL('image/jpeg', 0.7) })); }; img.src = r.result; }; r.readAsDataURL(file); };
  return (
    <Modal title="New design" onClose={onClose} wide>
      <div className="grid g2">
        <div><label>Brand {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('brands'); }} style={{ textTransform: 'none' }}>✎ edit</a>}</label><select value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: Number(e.target.value) })}>{meta.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label>Type {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('types'); }} style={{ textTransform: 'none' }}>✎ edit</a>}</label><select value={f.type_code} onChange={(e) => setF({ ...f, type_code: e.target.value })}>{meta.types.map((b) => <option key={b.code} value={b.code}>{b.name_en}</option>)}</select></div>
        <div><label>Name (English)</label><input value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></div>
        <div><label>Name (Khmer)</label><input value={f.name_km} onChange={(e) => setF({ ...f, name_km: e.target.value })} /></div>
        <div><label>Selling price (USD)</label><input inputMode="decimal" value={f.price_usd} onChange={(e) => setF({ ...f, price_usd: e.target.value })} /></div>
        <div><label>Cost (USD)</label><input inputMode="decimal" value={f.cost_usd} onChange={(e) => setF({ ...f, cost_usd: e.target.value })} /></div>
      </div>
      <label>Colours {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('colours'); }} style={{ textTransform: 'none' }}>✎ add / edit</a>}</label><div className="row wrap">{meta.colours.map((c) => <button key={c.code} className={`chip ${f.colours.includes(c.code) ? 'on' : ''}`} onClick={() => toggle('colours', c.code)}><span className="swatch" style={{ background: c.hex }} />{c.name_en}</button>)}</div>
      <label>Sizes {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('sizes'); }} style={{ textTransform: 'none' }}>✎ edit groups</a>}</label>
      {Object.entries(sets).map(([k, sizes]) => <div key={k} className="row wrap" style={{ marginBottom: 6 }}><span className="small muted" style={{ width: 60 }}>{k}</span>{sizes.map((s) => <button key={k + s} className={`chip ${f.sizes.includes(s) ? 'on' : ''}`} onClick={() => toggle('sizes', s)}>{s}</button>)}</div>)}
      <div className="row" style={{ marginTop: 6 }}><input style={{ width: 160 }} placeholder="Other size (e.g. 58)" value={custom} onChange={(e) => setCustom(e.target.value)} /><button className="btn" onClick={() => { const v = custom.trim().toUpperCase(); if (v && !f.sizes.includes(v)) setF((x) => ({ ...x, sizes: [...x.sizes, v] })); setCustom(''); }}>Add size</button>{f.sizes.filter((z) => !Object.values(sets).flat().includes(z)).map((z) => <button key={z} className="chip on" onClick={() => toggle('sizes', z)}>{z} ✕</button>)}</div>
      <label>Photo</label><input type="file" accept="image/*" capture="environment" onChange={(e) => pickPhoto(e.target.files[0])} />
      {f.photo && <img src={f.photo} alt="" style={{ height: 120, borderRadius: 8, marginTop: 8 }} />}
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} onClick={async () => { try { await api.post('/designs', f); onDone(); } catch (e) { setErr(e.message); } }}>Create {f.colours.length * f.sizes.length || ''} variants</button>
    </Modal>
  );
}

function Labels({ design, meta, onClose }) {
  const [copies, setCopies] = useState(1);
  const items = design.items.filter((i) => i.active);
  const col = (c) => meta?.colours.find((x) => x.code === c)?.name_en || c;
  const all = items.flatMap((i) => Array.from({ length: copies }, () => i));
  return (
    <Modal title="Print labels" onClose={onClose} wide>
      <div className="row"><label style={{ margin: 0 }}>Copies of each</label><input type="number" min="1" max="20" value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value)))} style={{ width: 90 }} /><button className="btn primary" onClick={() => window.print()}>Print</button></div>
      <p className="muted small">Set the printer paper to the label size (default 50 × 90 mm hang tag). Each tag has a Code 128 barcode the register scanner reads.</p>
      <div id="labels" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {all.map((i, k) => (
          <div key={k} className="receipt" style={{ width: '50mm', height: '90mm', margin: 0, border: '1px solid #ccc', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pageBreakAfter: 'always' }}>
            <div><div style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: 16, fontWeight: 600 }}>{design.name_en}</div><div>{col(i.colour_code)} · {i.size}</div></div>
            <Barcode value={i.sku} />
            <div style={{ fontSize: 18, fontWeight: 600 }}>{usd(design.price_cents)}</div>
          </div>))}
      </div>
    </Modal>
  );
}
