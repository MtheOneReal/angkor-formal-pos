import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { SOCIALS, SocialIcon } from '../socials.jsx';
import { api, qs } from '../api.js';
import GarmentArt from '../GarmentArt.jsx';
import FilterBar, { useFilterConfig, passes } from './FilterBar.jsx';
import { useApp, useT, Modal, PinPad, ManagerPin, useToast, useName, LevelBadge } from '../ui.jsx';
import { usd, riel, toRiel } from '../format.js';

const BASE = (import.meta.env?.BASE_URL || '/');
const photo = (p) => (p ? ((p.startsWith('/') || p.startsWith('data:')) ? p : '/uploads/' + p) : null);

function CameraScan({ onCode, onClose }) {
  const vid = useRef(); const [err, setErr] = useState('');
  useEffect(() => {
    let stop = false; let stream; let reader;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        vid.current.srcObject = stream; await vid.current.play();
        if ('BarcodeDetector' in window) {
          const det = new window.BarcodeDetector({ formats: ['code_128', 'ean_13', 'code_39', 'qr_code'] });
          const loop = async () => { if (stop) return; try { const r = await det.detect(vid.current); if (r[0]) { onCode(r[0].rawValue); return; } } catch { /* keep trying */ } setTimeout(loop, 250); };
          loop();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/library');
          reader = new BrowserMultiFormatReader();
          reader.decodeFromVideoElement(vid.current, (res) => { if (res && !stop) onCode(res.getText()); });
        }
      } catch (e) { setErr('Camera is not available. Check the browser permission, or type the code instead.'); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); reader?.reset?.(); };
  }, [onCode]);
  return (
    <Modal title="Camera" onClose={onClose}>
      {err ? <div className="error">{err}</div> : <video ref={vid} playsInline muted style={{ width: '100%', borderRadius: 12 }} />}
    </Modal>
  );
}

function Receipt({ sale, onDone }) {
  const { store } = useApp(); const t = useT();
  const show = { address: true, social: true, thanks: true, rate: false, ...(sale.receipt_show || {}) };
  return (
    <Modal title={t('receipt')} onClose={onDone}>
      <div className="receipt" id="receipt">
        <div style={{ textAlign: 'center' }}>
          {show.address && sale.receipt_address && <div className="small" style={{ whiteSpace: 'pre-line' }}>{sale.receipt_address}</div>}
          {sale.receipt_contact && <div className="small" style={{ whiteSpace: 'pre-line' }}>{sale.receipt_contact}</div>}
          <div>{new Date(sale.ts).toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' })}</div><div>{sale.receipt_no}</div></div>
        {sale.cashier_name && <div className="l" style={{ marginTop: 4 }}><span>Cashier / អ្នកលក់</span><b>{sale.cashier_name}</b></div>}
        <hr />
        {sale.lines.map((l) => <div key={l.id}><div>{l.name_en}{l.name_km ? ` / ${l.name_km}` : ''} · {l.size}</div><div className="l"><span>{l.qty} × {usd(l.unit_price_cents ?? l.price_cents ?? 0)}</span><span>{usd(l.line_total_cents)}</span></div></div>)}
        <hr />
        {sale.discount_cents > 0 && <div className="l"><span>Discount / បញ្ចុះតម្លៃ</span><span>-{usd(sale.discount_cents)}</span></div>}
        <div className="l"><b>Total / សរុប</b><b>{usd(sale.total_cents)}</b></div>
        <div className="l"><span></span><span>{riel(sale.total_khr)}</span></div>
        {sale.deposit && <><div className="l"><span>Deposit paid / បានកក់</span><span>{usd(sale.total_cents - sale.balance_cents)}</span></div><div className="l"><b>Balance to pay / នៅខ្វះ</b><b>{usd(sale.balance_cents)}</b></div>{sale.due_date && <div className="small">Pickup / ថ្ងៃមកយក: {sale.due_date}</div>}</>}
        {sale.customer_name && <div className="small">{sale.customer_name} {sale.customer_phone || ''}</div>}
        {show.rate && <div className="small">Rate / អត្រា: {sale.rate_khr_per_usd} ៛ / $1</div>}
        <hr />{show.thanks && <><div style={{ textAlign: 'center' }}>{sale.receipt_footer || 'Thank you'}</div><div style={{ textAlign: 'center' }}>{sale.receipt_footer_km || 'សូមអរគុណ។'}</div></>}
        {!show.social ? null : sale.receipt_social_mode === 'one'
          ? (SOCIALS.some((so) => sale.receipt_socials?.[so.key]?.on) && sale.receipt_social_one && <div className="small" style={{ textAlign: 'center', marginTop: 4 }}>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>{SOCIALS.filter((so) => sale.receipt_socials?.[so.key]?.on).map((so) => <SocialIcon key={so.key} path={so.path} size={16} />)}</div>
            <div>{sale.receipt_social_one}</div></div>)
          : SOCIALS.some((so) => sale.receipt_socials?.[so.key]?.on && sale.receipt_socials[so.key].handle) && <div className="small" style={{ display: 'grid', gap: 2, justifyContent: 'center', marginTop: 4 }}>
            {SOCIALS.filter((so) => sale.receipt_socials?.[so.key]?.on && sale.receipt_socials[so.key].handle).map((so) => <div key={so.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SocialIcon path={so.path} size={13} />{sale.receipt_socials[so.key].handle}</div>)}
          </div>}
        {show.social && sale.receipt_social && <div className="small" style={{ textAlign: 'center', whiteSpace: 'pre-line' }}>{sale.receipt_social}</div>}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => window.print()}>{t('print')}</button>
        <button className="btn primary grow" onClick={onDone}>{t('new_sale')}</button>
      </div>
    </Modal>
  );
}

function PayPanel({ cart, subtotal, rate, store, sw, canDiscount, extra, onCancel, onPaid }) {
  const t = useT();
  const [disc, setDisc] = useState({ type: 'percent', value: '', reason: '' });
  const dv = Number(disc.value) || 0;
  const discCents = Math.min(subtotal, disc.type === 'percent' ? Math.round((subtotal * dv) / 100) : disc.type === 'riel' ? Math.round((dv / rate) * 100) : Math.round(dv * 100));
  const total = Math.max(0, subtotal - discCents);
  const [method, setMethod] = useState('cash');
  const [cur, setCur] = useState('USD');
  const [tendered, setTendered] = useState('');
  const [chg, setChg] = useState('KHR');
  const [pinFor, setPinFor] = useState(null); const [dep, setDep] = useState(false); const [due, setDue] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const totalKhr = toRiel(total, rate);
  const tend = Number(tendered) || 0;
  const curE = method === 'khqr' ? 'USD' : cur;
  const tendCents = curE === 'USD' ? Math.round(tend * 100) : Math.round((tend / rate) * 100);
  const exact = method === 'khqr' && !dep;
  const hasCust = !!(extra?.customer_name || '').trim() && !!(extra?.customer_phone || '').trim();
  const paidCents = exact ? total : tendCents;
  const over = paidCents - total;

  const submit = async (pin) => {
    setBusy(true); setErr('');
    const payments = exact ? [{ method: 'khqr', currency: 'USD', amount: total }] : [{ method: method === 'khqr' ? 'khqr' : 'cash', currency: curE, amount: curE === 'USD' ? Math.round(tend * 100) : Math.round(tend) }];
    let change;
    if (!exact && !dep && over > 0) {
      change = chg === 'USD' ? [{ currency: 'USD', amount: over }] : [{ currency: 'KHR', amount: toRiel(over, rate) }];
      if (cur === 'KHR') change = [{ currency: 'KHR', amount: Math.round(tend) - totalKhr }];
    }
    const body = {
      store_id: store.id, entry_default: true, ...(extra || {}),
      lines: cart.map((l) => ({ item_id: l.item.id, qty: l.qty, entry: l.entry })),
      payments, ...(change ? { change } : {}),
      ...(discCents > 0 ? { discount: { type: disc.type === 'percent' ? 'percent' : 'amount', value: disc.type === 'percent' ? dv : discCents / 100, reason: disc.reason } } : {}),
      ...(pin ? { manager_pin: pin } : {}),
      ...(dep ? { deposit: true, due_date: due || null } : {}),
    };
    try { const sale = await api.post('/sales', body); setPinFor(null); onPaid(sale); }
    catch (e) {
      if (e.code === 'APPROVAL_REQUIRED') setPinFor(e.message);
      else { setPinFor(null); setErr(e.message); }
      throw e;
    } finally { setBusy(false); }
  };

  const ok = total > 0 && (dep ? (paidCents > 0 && paidCents < total - 100 && hasCust) : (exact || paidCents >= total - 100));
  return (
    <div className="paypanel">
      <div className="payrow">
        <select value={method === 'khqr' ? 'khqr' : cur === 'KHR' ? 'khr' : 'usd'} onChange={(e) => { const v = e.target.value; if (v === 'khqr') setMethod('khqr'); else { setMethod('cash'); setCur(v === 'khr' ? 'KHR' : 'USD'); } }} aria-label="Payment method"><option value="usd">{t('cash')} $</option><option value="khr">{t('cash')} ៛</option><option value="khqr">{t('khqr')}</option></select>
        <select value={dep ? 'dep' : 'full'} onChange={(e) => setDep(e.target.value === 'dep')} aria-label="Full or deposit"><option value="full">{t('pay_full')}</option><option value="dep">{t('deposit')}</option></select>
      </div>
      <div className="paysum">
        <div className="row between"><span className="muted">{t('subtotal')}</span><span className="num">{usd(subtotal)}</span></div>
        {canDiscount && <div className="discline"><div className="row between"><span className="muted">{t('discount')}</span>{discCents > 0 && <span className="small muted num">-{usd(discCents)}</span>}</div>
          <div className="discbox"><input inputMode="decimal" placeholder="0" value={disc.value} onChange={(e) => setDisc({ ...disc, value: e.target.value })} /><select value={disc.type} onChange={(e) => setDisc({ ...disc, type: e.target.value })} aria-label="Discount type"><option value="percent">%</option><option value="amount">$</option><option value="riel">៛</option></select></div></div>}
        {canDiscount && dv > 0 && <input placeholder="Reason (required)" value={disc.reason} onChange={(e) => setDisc({ ...disc, reason: e.target.value })} />}
        {!canDiscount && discCents > 0 && <div className="row between"><span className="muted">{t('discount')}</span><span className="num">-{usd(discCents)}</span></div>}
        <div className="row between big"><b>{t('total')} USD</b><b className="num">{usd(total)}</b></div>
        <div className="row between"><span className="muted">{t('total')} KHR</span><span className="num">{riel(totalKhr)}</span></div>
      </div>
      {dep && <div style={{ marginBottom: 10 }}>
        {!hasCust && <div className="error">{t('deposit_need_cust')}</div>}
        {paidCents > 0 && paidCents < total && <p style={{ margin: '8px 0 0' }}><b>{t('balance_due')}: {usd(total - paidCents)}</b></p>}
      </div>}
      {method === 'cash' || dep ? (
        <>
          {dep ? <div className="payrow" style={{ alignItems: 'end' }}>
            <div><label>{t('pickup_date')}</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="datebox" /></div>
            <div><label>Received</label><input className="grow" inputMode="decimal" placeholder="Received" value={tendered} onChange={(e) => setTendered(e.target.value)} /></div>
          </div> : <div className="row">
            <button className="chip" onClick={() => setTendered(cur === 'USD' ? (total / 100).toFixed(2) : String(totalKhr))}>Exact</button>
            <input className="grow" inputMode="decimal" placeholder="Received" value={tendered} onChange={(e) => setTendered(e.target.value)} />
          </div>}
          {!dep && over > 0 && cur === 'USD' && (
            <div className="row" style={{ marginTop: 10 }}>
              <b>{t('change')}: {chg === 'USD' ? usd(over) : riel(toRiel(over, rate))}</b>
              <button className={`chip ${chg === 'USD' ? 'on' : ''}`} onClick={() => setChg('USD')}>USD</button>
              <button className={`chip ${chg === 'KHR' ? 'on' : ''}`} onClick={() => setChg('KHR')}>KHR</button>
            </div>
          )}
          {!dep && cur === 'KHR' && method === 'cash' && tend > totalKhr && <b className="num" style={{ display: 'block', marginTop: 10 }}>{t('change')}: {riel(tend - totalKhr)}</b>}
        </>
      ) : <p className="muted">Show the customer the KHQR code and confirm the payment arrived in the bank app before you continue.</p>}
      {err && <div className="error">{err}</div>}
      <div className="row payactions" style={{ marginTop: 12 }}>
        <button className="btn" disabled={!cart.length || busy} onClick={onCancel}>{t('cancel')}</button>
        <button className="btn primary big grow" disabled={!ok || busy || (dv > 0 && disc.reason.trim().length < 3)} onClick={() => submit().catch(() => {})}>{t('pay')}</button>
      </div>
      {pinFor && <ManagerPin message={pinFor} onClose={() => setPinFor(null)} onSubmit={(pin) => submit(pin)} />}
    </div>
  );
}

function ShiftBar({ shift, reload, store }) {
  const t = useT(); const [open, setOpen] = useState(false); const [close, setClose] = useState(false);
  const [f, setF] = useState({ usd: '', khr: '' }); const [err, setErr] = useState(''); const [res, setRes] = useState(null);
  if (!shift) return (
    <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
      <h2>{t('open_shift')}</h2><p className="muted">Count the cash in the drawer before you start.</p>
      <label>USD in drawer</label><input inputMode="decimal" value={f.usd} onChange={(e) => setF({ ...f, usd: e.target.value })} />
      <label>Riel in drawer</label><input inputMode="numeric" value={f.khr} onChange={(e) => setF({ ...f, khr: e.target.value })} />
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 14 }} onClick={async () => { try { await api.post('/shifts/open', { store_id: store.id, open_usd: Number(f.usd || 0), open_khr: Number(f.khr || 0) }); reload(); } catch (e) { setErr(e.message); } }}>{t('open_shift')}</button>
    </div>
  );
  return (
    <>
      <button className="btn" onClick={() => { setClose(true); setRes(null); setF({ usd: '', khr: '' }); }}>{t('close_shift')}</button>
      {close && (
        <Modal title={t('close_shift')} onClose={() => { setClose(false); if (res) reload(); }}>
          {!res ? (<>
            <p className="muted">Count all the cash in the drawer, then enter it here.</p>
            <label>USD counted</label><input inputMode="decimal" value={f.usd} onChange={(e) => setF({ ...f, usd: e.target.value })} />
            <label>Riel counted</label><input inputMode="numeric" value={f.khr} onChange={(e) => setF({ ...f, khr: e.target.value })} />
            {err && <div className="error">{err}</div>}
            <button className="btn primary big" style={{ width: '100%', marginTop: 14 }} onClick={async () => { try { setRes(await api.post('/shifts/close', { shift_id: shift.id, counted_usd: Number(f.usd || 0), counted_khr: Number(f.khr || 0) })); } catch (e) { setErr(e.message); } }}>{t('confirm')}</button>
          </>) : (
            <div>
              <p>Shift closed and recorded.</p>
              {!res.blind && <p className="muted">Difference: {usd(res.diff_usd_cents)} and {riel(res.diff_khr)}</p>}
              <button className="btn primary" onClick={() => { setClose(false); reload(); }}>{t('done')}</button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

export default function Register() {
  const { me, store } = useApp(); const t = useT(); const nm = useName();
  const sw = me.switches[store.id] || {};
  const [shift, setShift] = useState(undefined);
  const [q, setQ] = useState(''); const [res, setRes] = useState([]);
  const [cart, setCart] = useState([]); const [msg, setMsg] = useState('');
  const [cam, setCam] = useState(false); const [payKey, setPayKey] = useState(0); const [done, setDone] = useState(null);
  const [kb, setKb] = useState(true);
  const [catalog, setCatalog] = useState([]); const [flt, setFlt] = useState({}); const fcfg = useFilterConfig('pos'); const [pick, setPick] = useState(null);
  const [cust, setCust] = useState({ name: '', phone: '', alteration: false }); const cartRef = useRef();
  const [toast, show] = useToast();
  const box = useRef(); const entry = useRef('typed');
  const rate = me.rate;

  const [shiftErr, setShiftErr] = useState('');
  const loadShift = useCallback(async () => { try { setShiftErr(''); setShift(await api.get(`/shifts/current${qs({ store_id: store.id })}`)); } catch (e) { setShiftErr(e.message || 'Could not load.'); } }, [store.id]);
  useEffect(() => { loadShift(); }, [loadShift]);
  const loadCat = useCallback(() => api.get(`/pos/catalog${qs({ store_id: store.id })}`).then((d) => setCatalog(d.items)).catch(() => {}), [store.id]);
  useEffect(() => { if (shift) loadCat(); }, [shift, loadCat, done]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const it of catalog) { if (!m.has(it.design_id)) m.set(it.design_id, { id: it.design_id, d: it, items: [] }); m.get(it.design_id).items.push(it); }
    const term = q.trim().toLowerCase();
    return [...m.values()].filter((g) => (!Object.values(flt).some(Boolean) || g.items.some((i) => passes(i, flt, i.available, fcfg.keys)))
      && (!term || g.items.some((i) => `${i.sku} ${i.name_en} ${i.name_km || ''}`.toLowerCase().includes(term)))).sort((a, b) => String(a.d.sku).localeCompare(b.d.sku));
  }, [catalog, flt, q, fcfg.keys]);
  const focus = () => setTimeout(() => box.current?.focus(), 50);
  useEffect(() => { if (shift) focus(); }, [shift, done]);

  const addItem = (item, how) => {
    if (item.available <= 0 && item.available !== undefined) { setMsg(`${item.sku}: none available in this store.`); return; }
    setCart((c) => {
      const i = c.findIndex((l) => l.item.id === item.id);
      if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: Math.min(n[i].qty + 1, item.available ?? 99), entry: how === 'scan' ? n[i].entry : 'typed' }; return n; }
      return [...c, { item, qty: 1, entry: how }];
    });
    setMsg(''); setQ(''); setPick(null); focus();
  };

  const search = async (text, how) => {
    const v = text.trim(); if (!v) return;
    setMsg('');
    try {
      // An exact code (scanner or typed) adds straight to the cart.
      const hit = await api.get(`/items/code/${encodeURIComponent(v)}${qs({ store_id: store.id })}`).catch(() => null);
      if (hit && !Array.isArray(hit)) { addItem(hit, how); return; }
      setMsg(groups.length ? '' : t('no_match'));
    } catch (e) { setMsg(e.message); }
  };

  const onKey = (e) => {
    if (e.key === 'Enter') { search(q, how.current); how.current = 'typed'; }
  };
  const how = useRef('typed'); const lastKey = useRef(0); const fast = useRef(0);
  const onChange = (e) => {
    const now = Date.now();
    // A scanner "types" many characters within a few milliseconds each; a person does not.
    if (now - lastKey.current < 40) fast.current += 1; else fast.current = 0;
    lastKey.current = now;
    how.current = fast.current >= 4 ? 'scan' : how.current === 'scan' ? 'scan' : 'typed';
    if (e.target.value === '') how.current = 'typed';
    setQ(e.target.value);
  };

  const subtotal = cart.reduce((a, l) => a + l.qty * l.item.price_cents, 0);
  const pieces = cart.reduce((a, l) => a + l.qty, 0);

  if (shiftErr) return <div className="card" style={{ maxWidth: 480, margin: '40px auto' }}><div className="error">{shiftErr}</div><button className="btn" style={{ marginTop: 12 }} onClick={loadShift}>Try again</button></div>;
  if (shift === undefined) return null;
  if (!shift) return <ShiftBar shift={null} reload={loadShift} store={store} />;

  return (
    <div className="pos">
      <div className="left">
        <div className="row">
          <input ref={box} className="grow scanbox" value={q} onChange={onChange} onKeyDown={onKey} placeholder={t('search')} inputMode={kb ? 'text' : 'none'} autoComplete="off" autoCapitalize="characters" aria-label="Scan or type" />
          <button className="btn" onClick={() => setKb((k) => !k)} title={t('keyboard')}>⌨</button>
          <button className="btn" onClick={() => setCam(true)}>📷 {t('camera')}</button>
          <ShiftBar shift={shift} reload={loadShift} store={store} />
        </div>
        {sw.require_scan_to_sell && <div className="small muted" style={{ marginTop: 6 }}>Scan-to-sell is on: typed items will need a manager PIN.</div>}
        {msg && <div className="error">{msg}</div>}
        <FilterBar scope="pos" items={catalog} sel={flt} setSel={setFlt} cfg={fcfg} />
        {!groups.length && <p className="muted">{t('no_match')}</p>}
        <div className="pgrid">
          {groups.map((g) => {
            const here = g.items.reduce((n, i) => n + i.available, 0); const oth = g.items.some((i) => i.others == null) ? null : g.items.reduce((n, i) => n + i.others, 0);
            return (
              <div className="pcard" key={g.id} role="button" tabIndex={0} onClick={() => setPick(g)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPick(g); } }}>
                <div className="ph">{photo(g.d.photo) ? <img src={photo(g.d.photo)} alt="" loading="lazy" /> : <GarmentArt code={g.d.type_code} name={g.d.type_name_en} nameKm={g.d.type_name_km} />}</div>
                <div className="pinfo">
                  <div className="pmeta"><span className="code2">{g.d.design_code}</span><span>{nm({ name_en: g.d.type_name_en, name_km: g.d.type_name_km })} · {g.d.brand_code}</span></div>
                  <b className="pname">{nm(g.d)}</b>
                  <div className="pstock"><span>{t('this_store')}: <b>{here}</b></span>{oth != null && <span>{t('other_stores')}: <b>{oth}</b></span>}</div>
                  <div className="pfoot"><span>{g.d.discount_cents > 0 && <s className="small muted" style={{ marginRight: 6 }}>{usd(g.d.full_price_cents)}</s>}<b className="num">{usd(g.d.price_cents)}</b></span><button className="padd" aria-label={t('select_size')} title={t('select_size')} onClick={(e) => { e.stopPropagation(); setPick(g); }}>＋</button></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="rcol">
      <div className="card cart" ref={cartRef}>
        <div className="grid g2" style={{ gap: 8 }}><input placeholder={t('cust_name')} value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} /><input inputMode="tel" placeholder={t('cust_phone')} value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} /></div>
        <label className="row" style={{ textTransform: 'none', fontSize: 14, color: 'var(--text)', margin: '10px 0' }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={cust.alteration} onChange={(e) => setCust({ ...cust, alteration: e.target.checked })} />✂️ {t('alteration')}</label>
        {cust.alteration && <input style={{ marginBottom: 8 }} placeholder={t('alteration_note')} value={cust.note || ''} onChange={(e) => setCust({ ...cust, note: e.target.value })} />}
        <h3>{t('cart')} {pieces > 0 && <span className="muted small">({pieces})</span>}</h3>
        <div className="cartlines">
          {!cart.length && <p className="muted">{t('empty_cart')}</p>}
          {cart.map((l, i) => (
            <div className="line" key={l.item.id}>
              <div className="grow"><b style={{ fontSize: 13 }}>{nm(l.item)}</b><div className="small muted">{l.item.sku} · {l.item.size}</div></div>
              <div className="qty">
                <button onClick={() => setCart((c) => c.flatMap((x, j) => (j === i ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))} aria-label="Less">−</button>
                <span className="num">{l.qty}</span>
                <button onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: Math.min(x.qty + 1, x.item.available ?? 99) } : x)))} aria-label="More">+</button>
              </div>
              <b className="num" style={{ width: 70, textAlign: 'right' }}>{usd(l.qty * l.item.price_cents)}</b>
            </div>
          ))}
        </div>
        <PayPanel key={payKey} cart={cart} subtotal={subtotal} rate={rate} store={store} sw={sw} canDiscount={me.perms.includes('pos.discount')} extra={{ customer_name: cust.name, customer_phone: cust.phone, alteration: cust.alteration, alteration_note: cust.note || '' }} onCancel={() => { setCart([]); setCust({ name: '', phone: '', alteration: false }); setPayKey((k) => k + 1); }}
          onPaid={async (s) => { setCart([]); setCust({ name: '', phone: '', alteration: false }); setPayKey((k) => k + 1); setDone(await api.get(`/sales/${s.id}`)); }} />
      </div>
      </div>
      {cart.length > 0 && <button className="cartbar" onClick={() => cartRef.current?.scrollIntoView({ behavior: 'smooth' })}><span>{t('view_cart')} ({pieces})</span><span className="num">{usd(subtotal)}</span></button>}
      {pick && (
        <Modal title={nm(pick.d)} onClose={() => setPick(null)}>
          <p className="muted small">{t('pick_size')}</p>
          <div className="row wrap" style={{ marginBottom: 12 }}>{[...pick.items].sort((a, b) => (parseFloat(a.size) || 0) - (parseFloat(b.size) || 0) || String(a.size).localeCompare(b.size)).map((i) => <button key={i.id} className="chip" disabled={i.available <= 0} style={i.available <= 0 ? { opacity: .4 } : undefined} onClick={() => addItem(i, 'typed')}>{i.size} <span className="small muted">({i.available})</span></button>)}</div>
        </Modal>
      )}
      {cam && <CameraScan onClose={() => setCam(false)} onCode={(c) => { setCam(false); search(c, 'scan'); }} />}
      {done && <Receipt sale={done} onDone={() => setDone(null)} />}
      {toast}
    </div>
  );
}
