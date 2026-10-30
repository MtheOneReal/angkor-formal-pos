import GarmentArt from '../GarmentArt.jsx';
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
  const { me, store } = useApp(); const t = useT(); const nm = useName(); const [stk, setStk] = useState(null); const [grid, setGrid] = useState(null);
  const [rows, setRows] = useState([]); const [meta, setMeta] = useState(null); const [lists, setLists] = useState(null); const reloadMeta = () => api.get('/meta').then(setMeta); const [add, setAdd] = useState(false); const [labels, setLabels] = useState(null); const [toast, show] = useToast();
  const loadStock = () => (me.perms.includes('stock.view') ? api.get(`/stock/by-design?store_id=${store.id}`).then(setStk).catch(() => setStk(null)) : null);
  const load = () => { api.get('/designs').then(setRows); loadStock(); };
  useEffect(() => { load(); api.get('/meta').then(setMeta); }, [store.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const canCost = me.perms.includes('cost.view');
  return (
    <div>
      <div className="row between wrap"><h1>{t('catalogue')}</h1><div className="row wrap">{me.role === 'owner' && <button className="btn" onClick={() => setLists('brands')}>✎ Edit lists</button>}<button className="btn primary" onClick={() => setAdd(true)}>＋ New design</button></div></div>
      <div className="results" style={{ marginTop: 14 }}>
        {rows.map((d) => (
          <div key={d.id} className="tile">
            <div className="ph">{photo(d.photo) ? <img src={photo(d.photo)} alt="" /> : <GarmentArt code={d.type_code} name={meta?.types?.find((x) => x.code === d.type_code)?.name_en} nameKm={meta?.types?.find((x) => x.code === d.type_code)?.name_km} />}</div>
            <div className="in"><b style={{ fontSize: 13 }}>{nm(d)}</b><div className="small muted">{d.brand_code}-{d.type_code}{String(d.number).padStart(2, '0')} · {d.items.length} variants</div>
              <div className="row between"><span>{d.discount_cents > 0 && <s className="small muted" style={{ marginRight: 6 }}>{usd(d.full_price_cents)}</s>}<b className="num">{usd(d.price_cents)}</b></span>{canCost && <span className="small muted">cost {usd(d.cost_cents)}</span>}</div>
              {stk?.designs[d.id] && (() => { const s = stk.designs[d.id]; return <div style={{ marginTop: 4 }}><div className="row between"><span className="small">In stock here</span><b className="num" style={{ color: s.here <= 0 ? 'var(--bad)' : s.low || s.out ? 'var(--warn)' : 'var(--ok)' }}>{s.here}</b></div>{s.others != null && <div className="row between"><span className="small muted">Other shops</span><span className="small muted num">{s.others}</span></div>}{(s.out > 0 || s.low > 0) && s.here > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{s.out ? `${s.out} sold out` : ''}{s.out && s.low ? ' · ' : ''}{s.low ? `${s.low} running low` : ''}</div>}</div>; })()}
              {me.perms.includes('stock.in') && <button className="btn primary" style={{ marginTop: 6, width: '100%' }} onClick={() => setGrid(d)}>＋ Add stock</button>}
              <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={() => setLabels(d)}>Print labels</button>
              {me.perms.includes('catalog.edit') && <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={async () => { if (!window.confirm(`Delete “${nm(d)}” and its ${d.items.length} variants for good?`)) return; try { await api.post(`/designs/${d.id}/delete`); show('Deleted'); load(); } catch (e) { window.alert(e.message); } }}>Delete</button>}</div>
          </div>))}
      </div>
      {lists && <ListsManager start={lists} onClose={() => { setLists(null); reloadMeta(); load(); }} />}
      {add && meta && <NewDesign rows={rows} meta={meta} owner={me.role === 'owner'} editLists={(k) => { setAdd(false); setLists(k); }} onClose={() => setAdd(false)} onDone={() => { setAdd(false); show('Design added'); load(); }} />}
      {labels && <Labels design={labels} meta={meta} onClose={() => setLabels(null)} />}
      {grid && <StockGrid design={grid} meta={meta} stk={stk} store={store} onClose={() => setGrid(null)} onDone={() => { setGrid(null); show('Stock added'); loadStock(); }} />}
      {toast}
    </div>
  );
}

function NewDesign({ rows, meta, owner, editLists, onClose, onDone }) {
  const sets = meta.size_sets || SIZE_SETS; const [custom, setCustom] = useState('');
  const [f, setF] = useState({ brand_id: meta.brands[0].id, type_code: meta.types[0].code, name_en: '', name_km: '', number: '', full: '', disc: '', price_usd: '', cost_usd: '', colours: [], sizes: [], photo: null });
  const brandO = meta.brands.find((b) => b.id === f.brand_id); const prefix = `${brandO?.code || ''}-${f.type_code}`;
  const nextNo = Math.max(0, ...rows.filter((d) => Number(d.brand_id) === Number(f.brand_id) && d.type_code === f.type_code).map((d) => d.number)) + 1;
  const setPrices = ({ full, disc, sell }) => setF((x) => {
    const n = { ...x }; const num = (v) => (v === '' || isNaN(Number(v)) ? null : Number(v)); const r2 = (v) => String(Math.round(v * 100) / 100);
    if (full !== undefined) n.full = full; if (disc !== undefined) n.disc = disc; if (sell !== undefined) n.price_usd = sell;
    if (sell !== undefined) { const F = num(n.full), S = num(sell); n.disc = F != null && S != null ? r2(Math.max(0, F - S)) : ''; }
    else { const F = num(n.full), D = num(n.disc) || 0; n.price_usd = F != null ? r2(Math.max(0, F - D)) : ''; }
    return n;
  });
  const [err, setErr] = useState('');
  const isLen = (k) => /length|long|inseam|ប្រវែង/i.test(k);
  const [gs, setGs] = useState({});
  const gtoggle = (g, v) => setGs((x) => ({ ...x, [g]: (x[g] || []).includes(v) ? x[g].filter((y) => y !== v) : [...(x[g] || []), v] }));
  const buildSizes = () => {
    const base = [...new Set(Object.entries(gs).filter(([g]) => !isLen(g)).flatMap(([, v]) => v))];
    const lens = [...new Set(Object.entries(gs).filter(([g]) => isLen(g)).flatMap(([, v]) => v))];
    const own = base.length ? base : (lens.length ? [''] : []);
    const combo = lens.length ? own.flatMap((b) => lens.map((l) => `${b} ${l}`.trim())) : own;
    return [...new Set([...combo, ...f.sizes])];
  };
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const pickPhoto = (file) => { if (!file) return; const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 480 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); setF((x) => ({ ...x, photo: c.toDataURL('image/jpeg', 0.7) })); }; img.src = r.result; }; r.readAsDataURL(file); };
  return (
    <Modal title="New design" onClose={onClose} wide>
      <div className="grid g2">
        <div><label>Type {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('types'); }} style={{ textTransform: 'none' }}>✎ edit</a>}</label><select value={f.type_code} onChange={(e) => setF({ ...f, type_code: e.target.value })}>{meta.types.map((b) => <option key={b.code} value={b.code}>{b.name_en}</option>)}</select></div>
        <div><label>Brand {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('brands'); }} style={{ textTransform: 'none' }}>✎ edit</a>}</label><select value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: Number(e.target.value) })}>{meta.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label>Code</label><div className="row" style={{ gap: 6 }}><span className="num" style={{ whiteSpace: 'nowrap' }}>{prefix}</span><input inputMode="numeric" style={{ width: 80 }} placeholder={String(nextNo)} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, '') })} /></div><div className="small muted">Next free number is filled in if you leave it empty.</div></div>
        <div><label>Name</label><input value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></div>
        <div><label>Full price (USD)</label><input inputMode="decimal" value={f.full} onChange={(e) => setPrices({ full: e.target.value })} /></div>
        <div><label>Discount (USD)</label><input inputMode="decimal" placeholder="0" value={f.disc} onChange={(e) => setPrices({ disc: e.target.value })} /></div>
        <div><label>Selling price (USD)</label><input inputMode="decimal" value={f.price_usd} onChange={(e) => setPrices({ sell: e.target.value })} /></div>
        <div><label>Cost (USD)</label><input inputMode="decimal" value={f.cost_usd} onChange={(e) => setF({ ...f, cost_usd: e.target.value })} /></div>
      </div>
      <label>Photo</label><input type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files[0])} />
      {f.photo && <img src={f.photo} alt="" style={{ height: 120, borderRadius: 8, marginTop: 8 }} />}
      <label>Colours {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('colours'); }} style={{ textTransform: 'none' }}>✎ add / edit</a>}</label><div className="row wrap">{meta.colours.map((c) => <button key={c.code} className={`chip ${f.colours.includes(c.code) ? 'on' : ''}`} onClick={() => toggle('colours', c.code)}><span className="swatch" style={{ background: c.hex }} />{c.name_en}</button>)}</div>
      <label>Sizes {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('sizes'); }} style={{ textTransform: 'none' }}>✎ edit groups</a>}</label>
      {Object.entries(sets).map(([k, sizes]) => <div key={k} className="row wrap" style={{ marginBottom: 6 }}><span className="small muted" style={{ width: 60 }}>{k}</span>{sizes.map((s) => <button key={k + s} className={`chip ${(gs[k] || []).includes(s) ? 'on' : ''}`} onClick={() => gtoggle(k, s)}>{s}</button>)}</div>)}
      {Object.keys(sets).some(isLen) && <p className="muted small">A group named “Length” is combined with the size: size 44 + length S makes “44 S”, its own stock item.</p>}
      <div className="row" style={{ marginTop: 6 }}><input style={{ width: 160 }} placeholder="Other size (e.g. 58)" value={custom} onChange={(e) => setCustom(e.target.value)} /><button className="btn" onClick={() => { const v = custom.trim().toUpperCase(); if (v && !f.sizes.includes(v)) setF((x) => ({ ...x, sizes: [...x.sizes, v] })); setCustom(''); }}>Add size</button>{f.sizes.filter((z) => !Object.values(sets).flat().includes(z)).map((z) => <button key={z} className="chip on" onClick={() => toggle('sizes', z)}>{z} ✕</button>)}</div>
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} onClick={async () => { try { await api.post('/designs', { ...f, full_price_usd: f.full || f.price_usd, number: f.number || undefined, sizes: buildSizes() }); onDone(); } catch (e) { setErr(e.message); } }}>Create {f.colours.length * buildSizes().length || ''} variants</button>
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

// Type the pieces received for every colour and size of one design in a single table.
function StockGrid({ design, meta, stk, store, onClose, onDone }) {
  const [qty, setQty] = useState({}); const [ref, setRef] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const colours = [...new Set(design.items.filter((i) => i.active).map((i) => i.colour_code))]; const sizes = [...new Set(design.items.filter((i) => i.active).map((i) => i.size))].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || String(a).localeCompare(String(b)));
  const cname = (c) => meta?.colours.find((x) => x.code === c)?.name_en || c; const item = (c, s) => design.items.find((i) => i.active && i.colour_code === c && i.size === s);
  const lines = Object.entries(qty).map(([id, q]) => ({ item_id: Number(id), qty: Math.floor(Number(q)) })).filter((l) => l.qty > 0); const total = lines.reduce((a, l) => a + l.qty, 0);
  const save = async () => { setBusy(true); setErr(''); try { await api.post('/stock/in', { store_id: store.id, lines, reference: ref || 'Added from catalogue' }); onDone(); } catch (e) { setErr(e.message || 'Could not save.'); setBusy(false); } };
  return (
    <Modal title={`Add stock: ${design.name_en} (${store.name})`} onClose={onClose} wide>
      <p className="muted small">Type how many pieces arrived for each colour and size. Leave the rest empty. The small number under each box is what the shop has now.</p>
      <div className="tbl" style={{ overflow: 'auto' }}><table><thead><tr><th>Colour</th>{sizes.map((s) => <th key={s} className="right">{s}</th>)}</tr></thead>
        <tbody>{colours.map((c) => <tr key={c}><td><b>{cname(c)}</b></td>{sizes.map((s) => { const it = item(c, s); return <td key={s} className="right">{it ? <><input type="number" min="0" inputMode="numeric" value={qty[it.id] ?? ''} onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })} style={{ width: 64, textAlign: 'right' }} /><div className="small muted">have {stk?.items?.[it.id]?.here ?? 0}</div></> : <span className="muted">—</span>}</td>; })}</tr>)}</tbody></table></div>
      <label>Reference (optional)</label><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. delivery 30 Oct, opening stock" />
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={!total || busy} onClick={save}>{total ? `Add ${total} pieces` : 'Type quantities above'}</button>
    </Modal>
  );
}
