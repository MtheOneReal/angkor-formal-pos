import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../api.js';
import { useApp, useT, useName, Modal, useToast } from '../ui.jsx';
import { usd } from '../format.js';
import FilterBar, { useFilterConfig, passes } from './FilterBar.jsx';

export default function StockScreen() {
  const { me, store } = useApp(); const t = useT(); const nm = useName();
  const [q, setQ] = useState(''); const [rows, setRows] = useState([]); const [modal, setModal] = useState(null); const [ret, setRet] = useState([]);
  const [toast, show] = useToast(); const [sel, setSel] = useState({}); const fcfg = useFilterConfig('stock');
  const canCost = me.perms.includes('cost.view');
  const load = useCallback(() => {
    api.get(`/stock${qs({ store_id: store.id, q, only_stocked: q ? '' : '1' })}`).then(setRows);
    if (me.perms.includes('stock.adjust')) api.get(`/stock/returned${qs({ store_id: store.id })}`).then(setRet).catch(() => {});
  }, [store.id, q, me.perms]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  const shown = rows.filter((r) => passes(r, sel, r.on_hand, fcfg.keys));
  const value = shown.reduce((a, r) => a + r.on_hand * (r.cost_cents || 0), 0);
  return (
    <div>
      <div className="row between wrap"><h1>{t('stock')} — {store.name}</h1>
        <div className="row">{me.perms.includes('stock.in') && <button className="btn primary" onClick={() => setModal({ kind: 'in' })}>＋ Receive delivery</button>}</div></div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name, colour" style={{ margin: '12px 0 0' }} />
      <FilterBar scope="stock" items={rows} sel={sel} setSel={setSel} cfg={fcfg} />
      {canCost && <p className="muted small">Stock value at cost (list shown): {usd(value)}</p>}
      {ret.length > 0 && <div className="card" style={{ marginBottom: 12 }}><b>Returned pieces waiting for a check</b>
        {ret.map((r) => <div key={r.item_id} className="row between" style={{ marginTop: 6 }}><span>{r.sku} × {r.qty}</span>
          <span className="row"><button className="btn" onClick={async () => { await api.post('/stock/returned/resolve', { store_id: store.id, item_id: r.item_id, qty: r.qty, to: 'stock' }); show('Back in stock'); load(); }}>Good → stock</button>
            <button className="btn danger" onClick={async () => { await api.post('/stock/returned/resolve', { store_id: store.id, item_id: r.item_id, qty: r.qty, to: 'damaged' }); show('Marked damaged'); load(); }}>Damaged</button></span></div>)}</div>}
      <div className="card" style={{ overflow: 'auto' }}>
        <table><thead><tr><th>Item</th><th>Colour</th><th>Size</th><th className="right">Price</th>{canCost && <th className="right">Cost</th>}<th className="right">On hand</th><th className="right">Reserved</th><th></th></tr></thead>
          <tbody>{shown.map((r) => <tr key={r.id}><td><b>{nm(r)}</b><div className="small muted">{r.sku}</div></td><td><span className="swatch" style={{ background: r.colour_hex }} />{r.colour_en}</td><td>{r.size}</td>
            <td className="right num">{usd(r.price_cents)}</td>{canCost && <td className="right num">{usd(r.cost_cents)}</td>}
            <td className="right num"><b style={{ color: r.on_hand <= 0 ? 'var(--bad)' : r.on_hand <= r.low_stock ? 'var(--warn)' : undefined }}>{r.on_hand}</b></td><td className="right num">{r.reserved || ''}</td>
            <td>{me.perms.includes('stock.adjust') && <button className="btn" onClick={() => setModal({ kind: 'adjust', item: r })}>Adjust</button>}</td></tr>)}</tbody></table>
      </div>
      {modal?.kind === 'in' && <StockIn onClose={() => setModal(null)} onDone={() => { setModal(null); show('Stock added'); load(); }} />}
      {modal?.kind === 'adjust' && <Adjust item={modal.item} onClose={() => setModal(null)} onDone={() => { setModal(null); show('Adjusted'); load(); }} />}
      {toast}
    </div>
  );
}

function Adjust({ item, onClose, onDone }) {
  const { store } = useApp(); const [d, setD] = useState(''); const [why, setWhy] = useState(''); const [err, setErr] = useState('');
  return (
    <Modal title={`Adjust ${item.sku}`} onClose={onClose}>
      <p className="muted">Now {item.on_hand}. Enter + or − pieces. A reason is always recorded.</p>
      <input type="number" value={d} onChange={(e) => setD(e.target.value)} placeholder="e.g. -1" autoFocus />
      <label>Reason</label><input value={why} onChange={(e) => setWhy(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} onClick={async () => { try { await api.post('/stock/adjust', { store_id: store.id, item_id: item.id, qty_delta: Number(d), reason: why }); onDone(); } catch (e) { setErr(e.message); } }}>Save</button>
    </Modal>
  );
}

function StockIn({ onClose, onDone }) {
  const { store } = useApp(); const [code, setCode] = useState(''); const [lines, setLines] = useState([]); const [ref, setRef] = useState(''); const [err, setErr] = useState('');
  const add = async () => {
    setErr('');
    try { const it = await api.get(`/items/code/${encodeURIComponent(code.trim())}${qs({ store_id: store.id })}`); setLines((l) => { const i = l.findIndex((x) => x.it.id === it.id); if (i >= 0) { const n = [...l]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; } return [...l, { it, qty: 1 }]; }); setCode(''); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Modal title="Receive delivery" onClose={onClose} wide>
      <div className="row"><input autoFocus className="grow scanbox" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Scan or type the code, press Enter" /><button className="btn" onClick={add}>Add</button></div>
      {err && <div className="error">{err}</div>}
      <table style={{ marginTop: 10 }}><tbody>{lines.map((l, i) => <tr key={l.it.id}><td>{l.it.sku}<div className="small muted">{l.it.name_en} · {l.it.colour_en} · {l.it.size}</div></td>
        <td style={{ width: 110 }}><input type="number" min="1" value={l.qty} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, qty: Number(e.target.value) } : y)))} /></td>
        <td><button className="btn" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table>
      <label>Note (optional)</label><input value={ref} placeholder="e.g. from Bokor, 30 Oct" onChange={(e) => setRef(e.target.value)} />
      <button className="btn primary big" disabled={!lines.length} style={{ width: '100%', marginTop: 12 }} onClick={async () => { try { await api.post('/stock/in', { store_id: store.id, reference: ref, lines: lines.map((l) => ({ item_id: l.it.id, qty: l.qty })) }); onDone(); } catch (e) { setErr(e.message); } }}>Add {lines.reduce((a, l) => a + l.qty, 0)} pieces to stock</button>
    </Modal>
  );
}
