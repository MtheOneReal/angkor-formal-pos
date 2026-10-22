import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { tr } from './i18n.js';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);
export function useT() { const { lang } = useApp(); return (k) => tr(lang, k); }

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose?.(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={wide ? { width: 'min(860px,100%)' } : null} role="dialog" aria-modal="true">
        {title && <div className="row between" style={{ marginBottom: 12 }}><h2>{title}</h2><button className="btn" onClick={onClose} aria-label="Close">✕</button></div>}
        {children}
      </div>
    </div>
  );
}

// length > 0: the PIN signs in by itself as soon as that many digits are typed (no OK button).
// length 0 (older accounts whose PIN length is unknown): keep the OK button.
export function PinPad({ onDone, length = 0, error, busy }) {
  const [v, setV] = useState('');
  const auto = length > 0;
  const press = (d) => { if (busy) return; const n = (v + d).slice(0, auto ? length : 6); setV(n); if (auto && n.length === length) setTimeout(() => onDone(n), 120); };
  useEffect(() => {
    const h = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') setV((x) => x.slice(0, -1)); else if (e.key === 'Enter' && !auto && v.length >= 4) onDone(v); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  useEffect(() => { if (error) setV(''); }, [error]);
  return (
    <div>
      <div className="dots" aria-label="PIN">{Array.from({ length: Math.max(length || 4, v.length) }).map((_, i) => <i key={i} className={i < v.length ? 'f' : ''} />)}</div>
      {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}
      <div className="pinpad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <button key={d} onClick={() => press(String(d))}>{d}</button>)}
        {auto ? (<>
          <span />
          <button onClick={() => press('0')}>0</button>
          <button onClick={() => setV((x) => x.slice(0, -1))} aria-label="Delete">⌫</button>
        </>) : (<>
          <button onClick={() => setV((x) => x.slice(0, -1))} aria-label="Delete">⌫</button>
          <button onClick={() => press('0')}>0</button>
          <button className="btn primary" disabled={v.length < 4 || busy} onClick={() => onDone(v)} style={{ fontSize: 18 }}>OK</button>
        </>)}
      </div>
    </div>
  );
}

// Asks a manager to sign in (email and password) to approve something at the till.
// The two values travel together as "email\npassword"; the till itself stays signed in as the cashier.
export function ManagerPin({ message, onSubmit, onClose }) {
  const [err, setErr] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await onSubmit(`${email.trim()}\n${pw}`); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Manager approval" onClose={onClose}>
      <form onSubmit={go}>
        <p className="muted">{message || 'A manager must approve this. Ask a manager to sign in here.'}</p>
        <label>Manager email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="off" />
        <label>Manager password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
        {err && <div className="error">{err}</div>}
        <button className="btn primary big" style={{ width: '100%', marginTop: 16 }} disabled={busy || !email || !pw}>Approve</button>
      </form>
    </Modal>
  );
}

export function useToast() {
  const [msg, setMsg] = useState('');
  const t = useRef();
  const show = useCallback((m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 2800); }, []);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, show];
}

export const Spinner = () => <div className="muted" style={{ padding: 20 }}>Loading…</div>;

export function StoreSelect({ value, onChange, stores, all }) {
  const t = useT();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto', minWidth: 200 }} aria-label="Store">
      {all && <option value="all">{t('all_stores')}</option>}
      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

export function LevelBadge({ level }) {
  const t = useT();
  const cls = level === 'in' ? 'ok' : level === 'low' ? 'low' : 'out';
  return <span className={`badge ${cls}`}>{t(level === 'in' ? 'in_stock' : level)}</span>;
}

export function useName() {
  const { lang } = useApp();
  return (o, key = 'name') => (lang === 'km' && o[`${key}_km`]) || o[`${key}_en`] || o[key];
}
