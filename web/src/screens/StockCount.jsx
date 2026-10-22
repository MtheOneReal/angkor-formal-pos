import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../api.js';
import { useApp, useName, useToast } from '../ui.jsx';

// Count the pieces on the shelves, compare with the system, optionally correct the system.
export default function StockCount() {
  const { store, lang } = useApp(); const nm = useName(); const km = lang === 'km'; const L = (en, kh) => (km ? kh : en);
  const [rows, setRows] = useState(null); const [counts, setCounts] = useState({}); const [code, setCode] = useState(''); const [apply, setApply] = useState(true); const [err, setErr] = useState(''); const [res, setRes] = useState(null); const [hist, setHist] = useState([]); const [toast, show] = useToast();
  const box = useRef();
  const load = () => { api.get(`/stock${qs({ store_id: store.id, only_stocked: '1' })}`).then(setRows); api.get(`/stocktake${qs({ store_id: store.id })}`).then(setHist).catch(() => {}); };
  useEffect(() => { load(); }, [store.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const scan = async () => {
    const v = code.trim(); if (!v) return; setErr('');
    try { const it = await api.get(`/items/code/${encodeURIComponent(v)}${qs({ store_id: store.id })}`); if (Array.isArray(it)) throw new Error('Type the full code.');
      setRows((r) => (r.some((x) => x.id === it.id) ? r : [...r, { ...it, on_hand: it.on_hand || 0 }])); setCounts((c) => ({ ...c, [it.id]: (c[it.id] || 0) + 1 })); setCode(''); box.current?.focus(); } catch (e) { setErr(e.message); }
  };
  const lines = useMemo(() => (rows || []).filter((r) => counts[r.id] !== undefined && counts[r.id] !== ''), [rows, counts]);
  const diffs = lines.map((r) => ({ r, d: Number(counts[r.id]) - r.on_hand })).filter((x) => x.d);
  const uncounted = (rows || []).filter((r) => r.on_hand > 0 && (counts[r.id] === undefined || counts[r.id] === ''));
  const save = async () => {
    setErr('');
    if (uncounted.length && !window.confirm(L(`${uncounted.length} products were not counted. Treat them as zero found?`, `មាន ${uncounted.length} ទំនិញមិនទាន់រាប់។ ចាត់ទុកថាគ្មាន?`))) return;
    try { const r = await api.post('/stocktake', { store_id: store.id, apply, not_counted_is_zero: uncounted.length > 0, lines: lines.map((x) => ({ item_id: x.id, counted: Number(counts[x.id]) })) }); setRes(r); setCounts({}); load(); show(L('Count saved', 'បានរក្សាទុក')); } catch (e) { setErr(e.message); }
  };
  if (!rows) return null;
  return (
    <div>
      <p className="muted small">{L('Scan or type each product code as you count (each scan adds 1), or type the number found. Then save: differences are listed and the system can be corrected.', 'ស្កែនកូដនីមួយៗពេលរាប់ (ស្កែនម្តងបន្ថែម ១) ឬវាយចំនួនដែលរកឃើញ។ បន្ទាប់មករក្សាទុក។')}</p>
      <div className="row"><input ref={box} className="grow scanbox" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan()} placeholder={L('Scan or type a code, press Enter', 'ស្កែន ឬវាយកូដ រួចចុច Enter')} autoCapitalize="characters" /><button className="btn" onClick={scan}>{L('Add', 'បន្ថែម')}</button></div>
      {err && <div className="error">{err}</div>}
      <div className="card tbl" style={{ marginTop: 12 }}>
        <table><thead><tr><th>{L('Item', 'ទំនិញ')}</th><th className="right">{L('System', 'ប្រព័ន្ធ')}</th><th style={{ width: 110 }}>{L('Counted', 'រាប់បាន')}</th><th className="right">{L('Diff', 'ខុស')}</th></tr></thead>
          <tbody>{rows.map((r) => { const c = counts[r.id]; const d = c === undefined || c === '' ? null : Number(c) - r.on_hand; return (
            <tr key={r.id}><td><b>{nm(r)}</b><div className="small muted">{r.sku} · {r.colour_en} · {r.size}</div></td><td className="right num">{r.on_hand}</td>
              <td><input type="number" min="0" value={c ?? ''} onChange={(e) => setCounts({ ...counts, [r.id]: e.target.value })} /></td>
              <td className="right num" style={{ color: d ? (d < 0 ? 'var(--bad)' : 'var(--warn)') : undefined }}>{d === null ? '' : d > 0 ? `+${d}` : d}</td></tr>); })}
            {!rows.length && <tr><td colSpan="4" className="muted">{L('No stock in this store yet.', 'មិនទាន់មានស្តុកទេ។')}</td></tr>}</tbody></table>
      </div>
      <label className="row" style={{ textTransform: 'none', fontSize: 14, color: 'var(--text)', marginTop: 12 }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={apply} onChange={(e) => setApply(e.target.checked)} />{L('Also correct the system to the counted numbers', 'កែប្រព័ន្ធតាមចំនួនដែលរាប់បាន')}</label>
      <button className="btn primary big" style={{ marginTop: 12 }} disabled={!lines.length} onClick={save}>{L('Save count', 'រក្សាទុកការរាប់')}{diffs.length ? ` (${diffs.length} ${L('differences', 'ភាពខុសគ្នា')})` : ''}</button>
      {res && <div className="card" style={{ marginTop: 12 }}><b>{L('Result', 'លទ្ធផល')}: {res.missing} {L('missing', 'ខ្វះ')}, {res.extra} {L('extra', 'លើស')}</b>{res.lines.map((l) => <div key={l.itemId} className="small">{l.sku}: {l.expected} → {l.counted} ({l.diff > 0 ? '+' : ''}{l.diff})</div>)}</div>}
      {hist.length > 0 && <div className="card" style={{ marginTop: 12 }}><h3 style={{ marginBottom: 8 }}>{L('Earlier counts', 'ការរាប់មុន')}</h3>{hist.map((h) => <div key={h.id} className="row between small" style={{ padding: '4px 0' }}><span>{h.date} · {h.by}</span><span>{h.missing} {L('missing', 'ខ្វះ')} · {h.extra} {L('extra', 'លើស')}{h.applied ? ` · ${L('corrected', 'បានកែ')}` : ''}</span></div>)}</div>}
      {toast}
    </div>
  );
}
