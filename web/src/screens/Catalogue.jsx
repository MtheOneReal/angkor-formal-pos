import GarmentArt from '../GarmentArt.jsx';
import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { api } from '../api.js';
import { useApp, useT, useName, Modal, useToast } from '../ui.jsx';
import { usd } from '../format.js';
import ListsManager from './ListsManager.jsx';
import { groupsFor } from '../sizeGroups.js';

const photo = (p) => (p ? ((p.startsWith('/') || p.startsWith('data:')) ? p : '/uploads/' + p) : null);
const SIZE_SETS = { Suit: ['44', '46', '48', '50', '52', '54', '56'], Shirt: ['S', 'M', 'L', 'XL', 'XXL'], Waist: ['30', '32', '34', '36', '38'], 'One size': ['ONE'] };

function Barcode({ value }) {
  const r = useRef();
  useEffect(() => { if (r.current) JsBarcode(r.current, value, { format: 'CODE128', width: 1.6, height: 38, displayValue: true, fontSize: 11, margin: 0 }); }, [value]);
  return <svg ref={r} />;
}

export default function Catalogue() {
  const { me, store, lang } = useApp(); const L = (en, km) => (lang === 'km' ? km : en); const t = useT(); const nm = useName(); const [stk, setStk] = useState(null); const [grid, setGrid] = useState(null);
  const [rows, setRows] = useState([]); const [meta, setMeta] = useState(null); const [lists, setLists] = useState(null); const reloadMeta = () => api.get('/meta').then(setMeta); const [add, setAdd] = useState(false); const [labels, setLabels] = useState(null); const [toast, show] = useToast();
  const loadStock = () => (me.perms.includes('stock.view') ? api.get(`/stock/by-design?store_id=${store.id}`).then(setStk).catch(() => setStk(null)) : null);
  const load = () => { api.get('/designs').then(setRows); loadStock(); };
  useEffect(() => { load(); api.get('/meta').then(setMeta); }, [store.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const canCost = me.perms.includes('cost.view');
  const [editD, setEditD] = useState(null); const [fType, setFType] = useState(''); const [fBrand, setFBrand] = useState(''); const [fText, setFText] = useState('');
  const dcode = (d) => d.code || `${d.brand_code}-${d.type_code}${String(d.number).padStart(2, '0')}`;
  const shownRows = rows.filter((d) => (!fType || d.type_code === fType) && (!fBrand || String(d.brand_id) === fBrand) && (!fText.trim() || [dcode(d), d.name_en, d.name_km || '', ...d.items.map((i) => i.sku)].join(' ').toLowerCase().includes(fText.trim().toLowerCase())));
  return (
    <div>
      <div className="row between wrap"><h1>{t('catalogue')}</h1><div className="row wrap">{me.role === 'owner' && <button className="btn" onClick={() => setLists('brands')}>✎ {L('Edit lists', 'កែបញ្ជី')}</button>}<button className="btn primary" onClick={() => setAdd(true)}>＋ {L('New design', 'ម៉ូដែលថ្មី')}</button></div></div>
      <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
        <select style={{ width: 170 }} value={fType} onChange={(e) => setFType(e.target.value)}><option value="">{L('All types', 'គ្រប់ប្រភេទ')}</option>{meta?.types.map((x) => <option key={x.code} value={x.code}>{lang === 'km' && x.name_km ? x.name_km : x.name_en}</option>)}</select>
        <select style={{ width: 170 }} value={fBrand} onChange={(e) => setFBrand(e.target.value)}><option value="">{L('All brands', 'គ្រប់ម៉ាក')}</option>{meta?.brands.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <input style={{ width: 220 }} placeholder={L('Code or name', 'កូដ ឬឈ្មោះ')} value={fText} onChange={(e) => setFText(e.target.value)} />
        <span className="muted small">{shownRows.length} / {rows.length}</span>
      </div>
      <div className="tbl" style={{ marginTop: 10, overflow: 'auto' }}>
        <table style={{ whiteSpace: 'nowrap' }}>
          <thead><tr><th></th><th>{L('Code', 'កូដ')}</th><th>{L('Name', 'ឈ្មោះ')}</th><th>{L('Type', 'ប្រភេទ')}</th><th>{L('Brand', 'ម៉ាក')}</th><th className="right">{L('Full price', 'តម្លៃដើម')}</th><th className="right">{L('Discount', 'បញ្ចុះ')}</th><th className="right">{L('Selling price', 'តម្លៃលក់')}</th>{canCost && <th className="right">{L('Cost', 'តម្លៃទិញចូល')}</th>}<th></th></tr></thead>
          <tbody>
            {shownRows.map((d) => { const sd = stk?.designs[d.id]; const ty = meta?.types.find((x) => x.code === d.type_code); const br = meta?.brands.find((x) => Number(x.id) === Number(d.brand_id)); return (
              <tr key={d.id} onClick={() => me.perms.includes('catalog.edit') && setEditD(d.id)} style={me.perms.includes('catalog.edit') ? { cursor: 'pointer' } : undefined} title={me.perms.includes('catalog.edit') ? L('Click to edit', 'ចុចដើម្បីកែ') : undefined}>
                <td style={{ width: 54 }}><div style={{ width: 44, height: 56, borderRadius: 6, overflow: 'hidden' }}>{photo(d.photo) ? <img src={photo(d.photo)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <GarmentArt code={d.type_code} name={ty?.name_en} nameKm={ty?.name_km} />}</div></td>
                <td><b>{dcode(d)}</b></td>
                <td>{nm(d)}</td>
                <td>{ty ? (lang === 'km' && ty.name_km ? ty.name_km : ty.name_en) : d.type_code}</td>
                <td>{br?.name || d.brand_code}</td>
                <td className="right num">{usd(d.full_price_cents ?? d.price_cents)}</td>
                <td className="right num">{d.discount_cents > 0 ? usd(d.discount_cents) : '—'}</td>
                <td className="right num"><b>{usd(d.price_cents)}</b></td>
                {canCost && <td className="right num">{usd(d.cost_cents)}</td>}
                <td className="row" style={{ justifyContent: 'flex-end', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  {me.perms.includes('catalog.edit') && <button className="btn" onClick={async () => { if (!window.confirm(`Delete “${nm(d)}” and its ${d.items.length} variants for good?`)) return; try { await api.post(`/designs/${d.id}/delete`); show(L('Deleted', 'បានលុប')); load(); } catch (e) { window.alert(e.message); } }}>{L('Delete', 'លុប')}</button>}
                </td>
              </tr>); })}
            {!shownRows.length && <tr><td colSpan="10" className="muted">{L('Nothing matches.', 'រកមិនឃើញទេ។')}</td></tr>}
          </tbody>
        </table>
      </div>
      {lists && <ListsManager start={lists} onClose={() => { setLists(null); reloadMeta(); load(); }} />}
      {editD && meta && rows.find((r) => r.id === editD) && <NewDesign reload={load} design={rows.find((r) => r.id === editD)} dcode={dcode} rows={rows} meta={meta} owner={me.role === 'owner'} editLists={(k) => { setEditD(null); setLists(k); }} onClose={() => setEditD(null)} onDone={() => { setEditD(null); show(L('Saved', 'បានរក្សាទុក')); load(); }} />}
      {add && meta && <NewDesign rows={rows} meta={meta} owner={me.role === 'owner'} editLists={(k) => { setAdd(false); setLists(k); }} onClose={() => setAdd(false)} onDone={(id) => { setAdd(false); show(L('Design added. Now add its sizes.', 'បានបន្ថែមម៉ូដែល។ សូមបន្ថែមទំហំ។')); load(); if (id) setEditD(id); }} />}
      {labels && <Labels design={labels} meta={meta} onClose={() => setLabels(null)} />}
      {grid && rows.find((r) => r.id === grid) && <StockGrid design={rows.find((r) => r.id === grid)} owner={me.perms.includes('catalog.edit')} editLists={(k) => { setGrid(null); setLists(k); }} reload={load} meta={meta} stk={stk} store={store} onClose={() => setGrid(null)} onDone={() => { setGrid(null); show(L('Stock added', 'បានបន្ថែមស្តុក')); loadStock(); }} />}
      {toast}
    </div>
  );
}

function NewDesign({ reload, design, dcode, rows, meta, owner, editLists, onClose, onDone }) {
  const { lang } = useApp(); const L = (en, km) => (lang === 'km' ? km : en);
  const c2 = (v) => (v == null ? '' : String(Math.round(v) / 100));
  const [f, setF] = useState(design
    ? { brand_id: design.brand_id, type_code: design.type_code, name_en: design.name_en || '', name_km: design.name_km || '', code: dcode(design), full: c2(design.full_price_cents ?? design.price_cents), disc: design.discount_cents > 0 ? c2(design.discount_cents) : '', price_usd: c2(design.price_cents), cost_usd: design.cost_cents != null ? c2(design.cost_cents) : '', photo: design.photo || null }
    : { brand_id: meta.brands[0].id, type_code: meta.types[0].code, name_en: '', name_km: '', code: '', full: '', disc: '', price_usd: '', cost_usd: '', photo: null });
  const setPrices = ({ full, disc, sell }) => setF((x) => {
    const n = { ...x }; const num = (v) => (v === '' || isNaN(Number(v)) ? null : Number(v)); const r2 = (v) => String(Math.round(v * 100) / 100);
    if (full !== undefined) n.full = full; if (disc !== undefined) n.disc = disc; if (sell !== undefined) n.price_usd = sell;
    if (sell !== undefined) { const F = num(n.full), S = num(sell); n.disc = F != null && S != null ? r2(Math.max(0, F - S)) : ''; }
    else { const F = num(n.full), D = num(n.disc) || 0; n.price_usd = F != null ? r2(Math.max(0, F - D)) : ''; }
    return n;
  });
  const [err, setErr] = useState('');
  const pickPhoto = (file) => { if (!file) return; const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 480 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); setF((x) => ({ ...x, photo: c.toDataURL('image/jpeg', 0.7) })); }; img.src = r.result; }; r.readAsDataURL(file); };
  return (
    <Modal title={design ? L('Edit design', 'កែម៉ូដែល') : L('New design', 'ម៉ូដែលថ្មី')} onClose={onClose} wide>
      <div className="grid g2">
        <div><label>{L('Type', 'ប្រភេទ')} {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('types'); }} style={{ textTransform: 'none' }}>✎ {L('edit', 'កែ')}</a>}</label><select value={f.type_code} onChange={(e) => setF({ ...f, type_code: e.target.value })}>{meta.types.map((b) => <option key={b.code} value={b.code}>{b.name_en}</option>)}</select></div>
        <div><label>{L('Brand', 'ម៉ាក')} {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('brands'); }} style={{ textTransform: 'none' }}>✎ {L('edit', 'កែ')}</a>}</label><select value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: Number(e.target.value) })}>{meta.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label>{L('Code', 'កូដ')}</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />{design && f.code.trim().toUpperCase().replace(/\s+/g, '-') !== dcode(design).toUpperCase() && <div className="small" style={{ color: 'var(--warn)' }}>{L('Changing the code also changes the code of every size of this design.', 'ការប្តូរកូដនឹងប្តូរកូដនៃគ្រប់ទំហំរបស់ម៉ូដែលនេះផងដែរ។')}</div>}</div>
        <div><label>{L('Name', 'ឈ្មោះ')}</label><input value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></div>
        <div><label>{L('Full price (USD)', 'តម្លៃដើម (USD)')}</label><input inputMode="decimal" value={f.full} onChange={(e) => setPrices({ full: e.target.value })} /></div>
        <div><label>{L('Discount (USD)', 'បញ្ចុះតម្លៃ (USD)')}</label><input inputMode="decimal" placeholder="0" value={f.disc} onChange={(e) => setPrices({ disc: e.target.value })} /></div>
        <div><label>{L('Selling price (USD)', 'តម្លៃលក់ (USD)')}</label><input inputMode="decimal" value={f.price_usd} onChange={(e) => setPrices({ sell: e.target.value })} /></div>
        {(!design || design.cost_cents != null) && <div><label>{L('Cost (USD)', 'តម្លៃទិញចូល (USD)')}</label><input inputMode="decimal" value={f.cost_usd} onChange={(e) => setF({ ...f, cost_usd: e.target.value })} /></div>}
      </div>
      <label>{L('Photo', 'រូបភាព')}</label><input type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files[0])} />
      {f.photo && <img src={f.photo} alt="" style={{ height: 120, borderRadius: 8, marginTop: 8 }} />}
      {design && <div style={{ marginTop: 12 }}><label>{L('Sizes', 'ទំហំ')}</label>
        <div className="row wrap">{design.items.filter((i) => i.active).map((i) => <span key={i.id} className="chip on">{i.size}</span>)}{!design.items.some((i) => i.active) && <span className="muted small">{L('No sizes yet.', 'មិនទាន់មានទំហំទេ។')}</span>}</div>
        <details style={{ marginTop: 8 }} open={!design.items.some((i) => i.active)}><summary className="small" style={{ cursor: 'pointer' }}>＋ {L('Add sizes', 'បន្ថែមទំហំ')}</summary><VariantPicker meta={meta} owner={owner} editLists={editLists} design={design} onAdded={reload} /></details></div>}
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} onClick={async () => { if (!f.code.trim()) { setErr(L('Enter a code.', 'សូមបំពេញកូដ។')); return; } try { if (design) await api.post(`/designs/${design.id}/update`, { ...f, full_price_usd: f.full || f.price_usd, photo: f.photo === design.photo ? undefined : (f.photo || '') }); else { const r = await api.post('/designs', { ...f, full_price_usd: f.full || f.price_usd }); onDone(r.id); return; } onDone(); } catch (e) { setErr(e.message); } }}>{design ? L('Save', 'រក្សាទុក') : L('Create design', 'បង្កើតម៉ូដែល')}</button>
    </Modal>
  );
}

function VariantPicker({ meta, owner, editLists, design, onAdded }) {
  const { lang } = useApp(); const L = (en, km) => (lang === 'km' ? km : en);
  const allSets = meta.size_sets || SIZE_SETS; const tType = meta.types.find((x) => x.code === design.type_code); const shownGroups = groupsFor(tType, Object.keys(allSets), meta.type_groups);
  const sets = Object.fromEntries(shownGroups.map((g) => [g, allSets[g]])); const [custom, setCustom] = useState(''); const [extra, setExtra] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const f = { sizes: extra };
  const toggle = (k, v) => setExtra((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]));
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
  const n = buildSizes().length;
  const save = async () => { setBusy(true); setErr(''); try { await api.post(`/designs/${design.id}/variants`, { sizes: buildSizes() }); setGs({}); setExtra([]); onAdded(); } catch (e) { setErr(e.message); } setBusy(false); };
  return (
    <div>
      <label>{L('Sizes', 'ទំហំ')} {owner && <a href="#" onClick={(e) => { e.preventDefault(); editLists('sizes'); }} style={{ textTransform: 'none' }}>✎ {L('edit groups', 'កែក្រុម')}</a>}</label>
      {Object.entries(sets).map(([k, sizes]) => <div key={k} className="row wrap" style={{ marginBottom: 6 }}><span className="small muted" style={{ width: 60 }}>{k}</span>{sizes.map((s) => <button key={k + s} className={`chip ${(gs[k] || []).includes(s) ? 'on' : ''}`} onClick={() => gtoggle(k, s)}>{s}</button>)}</div>)}
      {Object.keys(sets).some(isLen) && <p className="muted small">{L('A group named “Length” is combined with the size: size 44 + length S makes “44 S”, its own stock item.', 'ក្រុមឈ្មោះ “Length” ត្រូវបានផ្សំជាមួយទំហំ៖ ទំហំ 44 + ប្រវែង S ជា “44 S” ដែលមានស្តុកផ្ទាល់ខ្លួន។')}</p>}
      <div className="row" style={{ marginTop: 6 }}><input style={{ width: 160 }} placeholder={L('Other size (e.g. 58)', 'ទំហំផ្សេង (ឧ. 58)')} value={custom} onChange={(e) => setCustom(e.target.value)} /><button className="btn" onClick={() => { const v = custom.trim().toUpperCase(); if (v && !f.sizes.includes(v)) setExtra((x) => [...x, v]); setCustom(''); }}>{L('Add size', 'បន្ថែមទំហំ')}</button>{f.sizes.filter((z) => !Object.values(sets).flat().includes(z)).map((z) => <button key={z} className="chip on" onClick={() => toggle('sizes', z)}>{z} ✕</button>)}</div>
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={!n || busy} onClick={save}>{n ? `${L('Create', 'បង្កើត')} ${n} ${L('sizes', 'ទំហំ')}` : L('Choose sizes', 'ជ្រើសទំហំ')}</button>
    </div>
  );
}

function Labels({ design, meta, onClose }) {
  const { lang } = useApp(); const L = (en, km) => (lang === 'km' ? km : en);
  const [copies, setCopies] = useState(1);
  const items = design.items.filter((i) => i.active);
  const all = items.flatMap((i) => Array.from({ length: copies }, () => i));
  return (
    <Modal title={L('Print labels', 'បោះពុម្ពស្លាក')} onClose={onClose} wide>
      <div className="row"><label style={{ margin: 0 }}>{L('Copies of each', 'ចំនួនថតចម្លងម្ដងៗ')}</label><input type="number" min="1" max="20" value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value)))} style={{ width: 90 }} /><button className="btn primary" onClick={() => window.print()}>{L('Print', 'បោះពុម្ព')}</button></div>
      <p className="muted small">{L('Set the printer paper to the label size (default 50 × 90 mm hang tag). Each tag has a Code 128 barcode the register scanner reads.', 'កំណត់ក្រដាសម៉ាស៊ីនបោះពុម្ពទៅទំហំស្លាក (លំនាំដើម 50 × 90 ម.ម)។ ស្លាកនីមួយៗមានបារកូដដែលម៉ាស៊ីនស្កេនអាចអានបាន។')}</p>
      <div id="labels" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {all.map((i, k) => (
          <div key={k} className="receipt" style={{ width: '50mm', height: '90mm', margin: 0, border: '1px solid #ccc', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pageBreakAfter: 'always' }}>
            <div><div style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: 16, fontWeight: 600 }}>{design.name_en}</div><div>{i.size}</div></div>
            <Barcode value={i.sku} />
            <div style={{ fontSize: 18, fontWeight: 600 }}>{usd(design.price_cents)}</div>
          </div>))}
      </div>
    </Modal>
  );
}

// Type the pieces received for every size of one design in a single table.
function StockGrid({ design, owner, editLists, reload, meta, stk, store, onClose, onDone }) {
  const { lang } = useApp(); const L = (en, km) => (lang === 'km' ? km : en);
  const [qty, setQty] = useState({}); const [ref, setRef] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const its = design.items.filter((i) => i.active).sort((a, b) => (parseFloat(a.size) || 0) - (parseFloat(b.size) || 0) || String(a.size).localeCompare(String(b.size)));
  const lines = Object.entries(qty).map(([id, q]) => ({ item_id: Number(id), qty: Math.floor(Number(q)) })).filter((l) => l.qty > 0); const total = lines.reduce((a, l) => a + l.qty, 0);
  const save = async () => { setBusy(true); setErr(''); try { await api.post('/stock/in', { store_id: store.id, lines, reference: ref || 'Added from catalogue' }); onDone(); } catch (e) { setErr(e.message || 'Could not save.'); setBusy(false); } };
  return (
    <Modal title={`${L('Add stock', 'បន្ថែមស្តុក')}: ${design.name_en} (${store.name})`} onClose={onClose} wide>
      {!its.length && <><p className="muted small">{owner ? L('This design has no sizes yet. Choose them to create its stock items.', 'ម៉ូដែលនេះមិនទាន់មានទំហំទេ។ សូមជ្រើសរើសដើម្បីបង្កើតទំនិញ។') : L('This design has no sizes yet. Ask the owner to add them.', 'ម៉ូដែលនេះមិនទាន់មានទំហំទេ។ សូមស្នើម្ចាស់បន្ថែម។')}</p>{owner && <VariantPicker meta={meta} owner={owner} editLists={editLists} design={design} onAdded={reload} />}</>}
      {its.length > 0 && <><p className="muted small">{L('Type how many pieces arrived for each size. Leave the rest empty.', 'វាយចំនួនដែលទទួលបានសម្រាប់ទំហំនីមួយៗ។ ទុកទទេសម្រាប់ផ្សេងទៀត។')}</p>
      <div className="tbl" style={{ overflow: 'auto' }}><table><thead><tr><th>{L('Size', 'ទំហំ')}</th><th>{L('Code', 'កូដ')}</th><th className="right">{L('In stock here', 'ស្តុកនៅទីនេះ')}</th><th className="right">{L('Pieces received', 'ចំនួនទទួល')}</th></tr></thead>
        <tbody>{its.map((it) => <tr key={it.id}><td><b>{it.size}</b></td><td className="muted small">{it.sku}</td><td className="right num">{stk?.items?.[it.id]?.here ?? 0}</td><td className="right"><input type="number" min="0" inputMode="numeric" value={qty[it.id] ?? ''} onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })} style={{ width: 80, textAlign: 'right' }} /></td></tr>)}</tbody></table></div></>}
      {its.length > 0 && owner && <details style={{ marginTop: 10 }}><summary className="small" style={{ cursor: 'pointer' }}>＋ {L('Add more sizes', 'បន្ថែមទំហំ')}</summary><VariantPicker meta={meta} owner={owner} editLists={editLists} design={design} onAdded={reload} /></details>}
      <label>{L('Reference (optional)', 'កំណត់ចំណាំ (ជាជម្រើស)')}</label><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={L('e.g. delivery 30 Oct, opening stock', 'ឧ. ដឹកចូល ៣០ តុលា, ស្តុកដំបូង')} />
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={!total || busy} onClick={save}>{total ? `${L('Add', 'បន្ថែម')} ${total} ${L('pieces', 'ដុំ')}` : L('Type quantities above', 'វាយចំនួនខាងលើ')}</button>
    </Modal>
  );
}
