import React, { useState } from 'react';
import { api } from '../api.js';
import { useApp, useToast } from '../ui.jsx';
import GarmentArt, { ART_STYLES, getArtStyle, setArtStyle } from '../GarmentArt.jsx';

export default function Account() {
  const { me, lang } = useApp(); const km = lang === 'km'; const [toast, show] = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '', again: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setErr('');
    if (f.new_password !== f.again) { setErr(km ? 'ពាក្យសម្ងាត់ថ្មីមិនដូចគ្នាទេ។' : 'The two new passwords do not match.'); return; }
    setBusy(true);
    try { await api.post('/auth/change-password', { current_password: f.current_password, new_password: f.new_password }); setF({ current_password: '', new_password: '', again: '' }); show(km ? 'បានប្តូរពាក្យសម្ងាត់' : 'Password changed'); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <h1>{km ? 'គណនីរបស់ខ្ញុំ' : 'My account'}</h1>
      <p className="muted">{me.name} · {me.role}{me.email ? ` · ${me.email}` : ''}</p>
      {me.role === 'cashier' ? <p className="muted">{km ? 'អ្នកគិតលុយប្តូរលេខ PIN តាមរយៈម្ចាស់ ឬអ្នកគ្រប់គ្រង។' : 'Cashiers change their PIN through the owner or a manager.'}</p> : (
        <form className="card" style={{ maxWidth: 420, marginTop: 14 }} onSubmit={save}>
          <h3>{km ? 'ប្តូរពាក្យសម្ងាត់' : 'Change password'}</h3>
          <label>{km ? 'ពាក្យសម្ងាត់បច្ចុប្បន្ន' : 'Current password'}</label><input type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} />
          <label>{km ? 'ពាក្យសម្ងាត់ថ្មី (យ៉ាងតិច ៨ តួ)' : 'New password (at least 8 characters)'}</label><input type="password" autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} />
          <label>{km ? 'វាយម្តងទៀត' : 'New password again'}</label><input type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" disabled={busy || !f.current_password || !f.new_password} style={{ width: '100%', marginTop: 14 }}>{km ? 'រក្សាទុក' : 'Save new password'}</button>
        </form>
      )}
      <div className="card" style={{ maxWidth: 640, marginTop: 14 }}>
        <h3>{km ? 'រូបភាពផលិតផលពេលមិនទាន់មានរូប' : 'Picture for products without a photo'}</h3>
        <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
          {[['swatch', km ? 'សំឡីក្រណាត់' : 'Fabric swatch'], ['studio', km ? 'រូបថតស្ទូឌីយោ' : 'Studio shot'], ['monogram', km ? 'ឡូហ្គោ' : 'Monogram']].map(([v, l]) => (
            <button key={v} className={`chip ${getArtStyle() === v ? 'on' : ''}`} style={{ padding: 6, width: 170, height: 'auto', display: 'block', textAlign: 'center' }} onClick={() => { setArtStyle(v); window.location.reload(); }}>
              <div style={{ position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden' }}><GarmentArt kind="blazer" variant={v} tint="#27385f" /></div>{l}
            </button>))}
        </div>
        <p className="muted small">{km ? 'ប្រើលើឧបករណ៍នេះ។' : 'Applies on this device.'}</p>
      </div>
      {toast}
    </div>
  );
}
