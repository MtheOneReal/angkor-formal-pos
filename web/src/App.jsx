import React, { useEffect, useState, useCallback, useRef } from 'react';
import { setKhmerDom } from './kmdom.js';
import { api } from './api.js';
import { Ctx, useApp, useT, PinPad, Modal, Spinner } from './ui.jsx';
import { tr } from './i18n.js';
import Register from './screens/Register.jsx';
import Capital from './screens/Capital.jsx';
import Jobs from './screens/Jobs.jsx';
import Report from './screens/Report.jsx';
import Account from './screens/Account.jsx';
import Inventory from './screens/Inventory.jsx';
import Transfers from './screens/Transfers.jsx';
import Sales from './screens/Sales.jsx';
import Customers from './screens/Customers.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Settings from './screens/Settings.jsx';
import Expenses from './screens/Expenses.jsx';
import Attendance from './screens/Attendance.jsx';
import Payroll from './screens/Payroll.jsx';

const NAV = [
  ['register', 'pos.sell', '🧾'], ['inventory', 'stock.view', '📦'], ['jobs', 'pos.sell', '✂️'], ['transfers', 'transfer.request', '🔁'],
  ['sales', 'sales.view', '📄'], ['customers', 'customers.manage', '👥'], ['expenses', 'expenses.manage', '💸'], ['attendance', 'attendance.use', '🕘'], ['payroll', 'payroll.view', '💰'], ['report', 'report.view', '📈'], ['capital', 'capital.view', '🤝'], ['dashboard', 'dashboard.view', '📊'], ['settings', 'users.manage', '⚙️'],
];
const SCREENS = { register: Register, inventory: Inventory, account: Account, jobs: Jobs, report: Report, capital: Capital, transfers: Transfers, sales: Sales, customers: Customers, dashboard: Dashboard, settings: Settings, expenses: Expenses, attendance: Attendance, payroll: Payroll };

function Login({ onDone }) {
  const [mode, setMode] = useState('till');
  const [stores, setStores] = useState([]);
  const [store, setStore] = useState(null);
  const [staff, setStaff] = useState([]);
  const [who, setWho] = useState(null);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false);
  const lang = localStorage.getItem('af_lang') || 'en';
  const t = (k) => tr(lang, k);
  const [needSetup, setNeedSetup] = useState(null);
  useEffect(() => { api.get('/setup/status').then((r) => setNeedSetup(r.needed)).catch(() => setNeedSetup(false)); }, []);
  useEffect(() => { api.get('/public/stores').then(setStores).catch(() => {}); }, [needSetup]);
  useEffect(() => { if (store) api.get(`/public/stores/${store.id}/staff`).then(setStaff); }, [store]);
  const pinLogin = async (pin) => {
    setBusy(true); setErr('');
    try { await api.post('/auth/pin-login', { store_id: store.id, user_id: who.id, pin }); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const ownerLogin = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/auth/login', { email, password: pw }); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (needSetup === null) return <Spinner />;
  if (needSetup) return <FirstSetup onDone={() => { setNeedSetup(false); onDone(); }} />;
  return (
    <div className="login theme-ivory" style={{ background: '#F2EBDD' }}>
      <div className="box">
        <img src={`./brand/angkor-formal-logo-espresso.svg`} alt="Angkor Formal" style={{ width: 220, display: 'block', margin: '0 auto 24px' }} />
        <div className="tabs" style={{ justifyContent: 'center' }}>
          <button className={`chip ${mode === 'till' ? 'on' : ''}`} onClick={() => { setMode('till'); setErr(''); }}>{t('till_login')}</button>
          <button className={`chip ${mode === 'owner' ? 'on' : ''}`} onClick={() => { setMode('owner'); setErr(''); }}>{t('owner_login')}</button>
        </div>
        <div className="card">
          {mode === 'owner' ? (
            <form onSubmit={ownerLogin}>
              <label>{t('email')}</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" />
              <label>{t('password')}</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
              {err && <div className="error">{err}</div>}
              {sent && <div className="muted small" style={{ marginTop: 8 }}>If that email has an account, a reset link is on its way. Check your inbox and spam.</div>}
              <button className="btn primary big" style={{ width: '100%', marginTop: 16 }} disabled={busy}>{t('sign_in')}</button>
              <button type="button" className="btn" style={{ width: '100%', marginTop: 8 }} onClick={async () => { setErr(''); try { await api.post('/auth/forgot', { email }); setSent(true); } catch (x) { setErr(x.message); } }}>Forgot password?</button>
            </form>
          ) : !store ? (
            <div><h3 style={{ marginBottom: 10 }}>{t('choose_store')}</h3>
              <div className="col">{stores.map((s) => <button key={s.id} className="stafftile" onClick={() => setStore(s)}>{s.name}</button>)}</div></div>
          ) : !who ? (
            <div><div className="row between"><h3>{t('who_are_you')}</h3><button className="btn" onClick={() => setStore(null)}>{t('back')}</button></div>
              <div className="grid g2" style={{ marginTop: 10 }}>{staff.map((u) => <button key={u.id} className="stafftile" onClick={() => setWho(u)}>{u.name}</button>)}</div></div>
          ) : (
            <div><div className="row between"><h3>{who.name}</h3>{who.pin_length ? null : <button className="btn" onClick={() => { setWho(null); setErr(''); }}>{t('back')}</button>}</div>
              <p className="muted" style={{ textAlign: 'center' }}>{t('enter_pin')}</p>
              <PinPad key={who.id} length={who.pin_length || 0} corner={who.pin_length ? <button className="btn primary" onClick={() => { setWho(null); setErr(''); }} style={{ fontSize: 13, lineHeight: 1.1, padding: 4 }}>←<br />{t('back')}</button> : null} onDone={pinLogin} error={err} busy={busy} /></div>
          )}
        </div>
      </div>
    </div>
  );
}

function FirstSetup({ onDone }) {
  const [f, setF] = useState({ name: '', email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api.post('/setup/create', f); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <div className="login theme-ivory" style={{ background: '#F2EBDD' }}>
      <div className="box"><div className="card">
        <h2>Welcome. Create the first owner.</h2>
        <p className="muted">This is a one-time step. The account you create here can manage everything. Use a strong password you do not use anywhere else.</p>
        <form onSubmit={go}>
          <label>Your name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
          <label>Email</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" />
          <label>Password (8 or more characters)</label><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" style={{ width: '100%', marginTop: 16 }} disabled={busy}>Create owner and set up</button>
        </form>
      </div></div>
    </div>
  );
}

function FinishSetup({ onDone }) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(''); try { await api.post('/setup/seed'); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <div className="login theme-ivory" style={{ background: '#F2EBDD' }}><div className="box"><div className="card">
      <h2>One more step</h2><p className="muted">Your owner account exists, but the stores and lists have not been created yet. Press the button to create your 4 stores, brands, types and colours.</p>
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 16 }} disabled={busy} onClick={go}>Create stores now</button>
    </div></div></div>
  );
}

function LockScreen({ onUnlock, onLogout }) {
  const { me } = useApp(); const [err, setErr] = useState('');
  const t = useT();
  return (
    <div className="modal-bg" style={{ background: 'rgba(12,10,8,.92)' }}>
      <div className="modal" style={{ textAlign: 'center' }}>
        <h2>{t('locked')}</h2><p className="muted">{t('enter_pin')}</p>
        <PinPad length={me.pin_length || 0} corner={me.pin_length ? <button className="btn primary" onClick={onLogout} style={{ fontSize: 13, lineHeight: 1.1, padding: 4 }}>⎋<br />{t('logout')}</button> : null} error={err} onDone={async (pin) => { try { await api.post('/auth/unlock', { pin }); onUnlock(); } catch (e) { setErr(e.message); } }} />
        {!me.pin_length && <button className="btn primary" style={{ marginTop: 12 }} onClick={onLogout}>⎋ {t('logout')}</button>}
      </div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(undefined);
  const [lang, setLang] = useState(localStorage.getItem('af_lang') || 'en');
  const [theme, setTheme] = useState(null);
  const [route, setRoute] = useState(location.hash.slice(2) || '');
  const [locked, setLocked] = useState(false);
  const idle = useRef(Date.now());

  const load = useCallback(async () => {
    try { const u = await api.get('/me'); setMe(u); setLang(u.lang || 'en'); setTheme(u.theme || null); } catch { setMe(null); }
  }, []);
  useEffect(() => { const r = () => load(); window.addEventListener('af-reload-me', r); return () => window.removeEventListener('af-reload-me', r); }, [load]);
  useEffect(() => { load(); const h = () => setMe(null); window.addEventListener('af-logged-out', h); return () => window.removeEventListener('af-logged-out', h); }, [load]);
  useEffect(() => { const h = () => setRoute(location.hash.slice(2)); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.className = lang === 'km' ? 'km' : ''; localStorage.setItem('af_lang', lang); setKhmerDom(lang === 'km'); }, [lang]);

  // Auto-lock the till after a few quiet minutes (the setting is per store).
  useEffect(() => {
    if (!me) return undefined;
    const bump = () => { idle.current = Date.now(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, bump));
    const iv = setInterval(() => {
      const mins = me.switches?.[me.store_id]?.autolock_minutes ?? 2;
      if (me.role === 'cashier' && mins > 0 && Date.now() - idle.current > mins * 60000) setLocked(true);
    }, 5000);
    return () => { ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.removeEventListener(e, bump)); clearInterval(iv); };
  }, [me]);

  if (me === undefined) return <Spinner />;
  if (me === null) return <Login onDone={load} />;

  if (me.role === 'owner' && me.stores.length === 0) return <FinishSetup onDone={load} />;
  const inWh = me.stores.find((s) => s.id === me.store_id)?.kind === 'warehouse';
  const SHOP_ONLY = ['register', 'jobs', 'sales', 'customers', 'expenses', 'attendance'];
  const allowed = NAV.filter(([k, p]) => me.perms.includes(p) && !(inWh && SHOP_ONLY.includes(k)) && !(k === 'settings' && !me.perms.includes('settings.manage') && !me.perms.includes('users.manage')));
  const first = allowed[0]?.[0] || 'register';
  const cur = (allowed.find(([k]) => k === route) || route === 'account') ? route : first;
  const Screen = SCREENS[cur];
  const effTheme = theme === 'dark' ? 'dark' : theme === 'light' ? 'ivory' : (me.role === 'cashier' ? 'ivory' : 'dark');
  const go = (k) => { location.hash = '/' + k; };
  const logout = async () => { await api.post('/auth/logout'); setMe(null); setLocked(false); };
  const setStore = async (id) => { await api.post('/me/store', { store_id: Number(id) }); await load(); };
  const prefs = async (p) => { await api.post('/me/prefs', p); if (p.lang) setLang(p.lang); if (p.theme) setTheme(p.theme); };
  const store = me.stores.find((s) => s.id === me.store_id);
  const t = (k) => tr(lang, k);

  return (
    <Ctx.Provider value={{ me, lang, store, go, reload: load, setStore }}>
      <div className={`theme-${effTheme}`} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {me.demo && <div className="banner">{t('demo_banner')}</div>}
        <div className="shell" style={{ flex: 1, minHeight: 0 }}>
          <aside className="side">
            <img className="logo" src={`./brand/angkor-formal-logo-${effTheme === 'dark' ? 'gold' : 'bronze'}.svg`} alt="Angkor Formal" />
            {allowed.map(([k, , ic]) => <button key={k} className={`nav ${cur === k ? 'on' : ''}`} onClick={() => go(k)}><span>{ic}</span>{t(k)}</button>)}
            <div style={{ flex: 1 }} />
            <button className={`nav ${cur === 'account' ? 'on' : ''}`} onClick={() => go('account')} style={{ fontSize: 13 }}>👤 {me.name} · {me.role}</button>
            <div className="row" style={{ padding: 8 }}>
              <button className="chip" onClick={() => prefs({ lang: lang === 'en' ? 'km' : 'en' })}>{lang === 'en' ? 'ខ្មែរ' : 'EN'}</button>
              <button className="chip" onClick={() => prefs({ theme: effTheme === 'dark' ? 'light' : 'dark' })} aria-label={t('theme')}>{effTheme === 'dark' ? '☀' : '☾'}</button>
            </div>
            <button className="nav" onClick={logout}>⎋ {t('logout')}</button>
          </aside>
          <main className="main">
            {me.stores.length > 1 && !['dashboard', 'capital', 'report', 'account', 'expenses', 'payroll', 'attendance'].includes(cur) && (
              <div className="topbar"><select value={me.store_id} onChange={(e) => setStore(e.target.value)} style={{ width: 'auto', minWidth: 220 }} aria-label="Store">
                {me.stores.map((s) => <option key={s.id} value={s.id}>{s.kind === 'warehouse' ? '🏬 ' : ''}{s.name}</option>)}</select></div>
            )}
            {store && <Screen key={`${cur}-${me.store_id}`} />}
          </main>
        </div>
        <nav className="bottomnav">
          {allowed.map(([k, , ic]) => <button key={k} className={cur === k ? 'on' : ''} onClick={() => go(k)}><div style={{ fontSize: 20 }}>{ic}</div>{t(k)}</button>)}
          <button className={cur === 'account' ? 'on' : ''} onClick={() => go('account')}><div style={{ fontSize: 20 }}>👤</div>{lang === 'km' ? 'គណនី' : 'Account'}</button>
          <button onClick={logout}><div style={{ fontSize: 20 }}>⎋</div>{t('logout')}</button>
        </nav>
        {locked && <LockScreen onUnlock={() => { idle.current = Date.now(); setLocked(false); }} onLogout={logout} />}
      </div>
    </Ctx.Provider>
  );
}
