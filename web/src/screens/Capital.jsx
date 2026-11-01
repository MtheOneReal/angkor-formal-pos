import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, useToast, Modal } from '../ui.jsx';
import { usd, todayISO } from '../format.js';
import ProfitShare from './ProfitShare.jsx';

export default function Capital() {
  const { lang } = useApp(); const km = lang === 'km'; const L = (en, kh) => (km ? kh : en);
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [toast, show] = useToast();
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('af_cap_store') || 'all'; } catch { return 'all'; } }); const [sh, setSh] = useState(null); const [pay, setPay] = useState(null); const [rev, setRev] = useState(null);
  const load = () => api.get(`/capital?store_id=${sel}`).then(setD).catch((e) => setErr(e.message));
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  useEffect(() => { load(); try { localStorage.setItem('af_cap_store', sel); } catch { /* ignore */ } }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div>{err ? <div className="error">{err}</div> : null}</div>;
  const t = d.totals; const edit = d.can_edit;
  const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const Kpi = ({ l, v, tone }) => <div className="card kpi"><div className="l">{l}</div><div className="v" style={tone ? { color: `var(--${tone})` } : undefined}>{usd(v)}</div></div>;
  return (
    <div>
      <div className="row between wrap"><h1>{L('Capital', 'ដើមទុន')}</h1><select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: 'auto', minWidth: 230 }} aria-label="Store"><option value="all">{L('All stores combined', 'គ្រប់សាខារួមគ្នា')}</option>{d.stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        {edit && <div className="row"><button className="btn" onClick={() => setSh({ name: '', agreed_by_store: {}, note: '' })}>＋ {L('Shareholder', 'អ្នកហ៊ុន')}</button><button className="btn primary" onClick={() => setPay({ shareholder_id: d.all_shareholders.find((q) => q.active)?.id || '', store_id: sel === 'all' ? d.stores[0]?.id : Number(sel), date: todayISO(), amount_usd: '', note: '' })} disabled={!d.all_shareholders.length}>＋ {L('Record payment', 'កត់ត្រាការបង់ប្រាក់')}</button></div>}
      </div>
      <p className="muted small">{L('Everything here is shown to the owners and shareholders. Payments cannot be edited; a mistake is fixed by a dated reversal with a reason.', 'ព័ត៌មាននេះបង្ហាញដល់ម្ចាស់ និងអ្នកហ៊ុនទាំងអស់។ ការបង់ប្រាក់មិនអាចកែបានទេ ត្រូវបញ្ច្រាសជាមួយមូលហេតុ។')}</p>
      <div className="grid g4" style={{ margin: '12px 0' }}>
        <Kpi l={L('Agreed capital', 'ដើមទុនព្រមព្រៀង')} v={t.agreed_cents} />
        <Kpi l={L('Paid in', 'បានបង់ចូល')} v={t.paid_cents} tone="ok" />
        <Kpi l={L('Still to be paid', 'នៅខ្វះ')} v={t.outstanding_cents} tone={t.outstanding_cents > 0 ? 'warn' : 'ok'} />
        <Kpi l={L('Spent on expenses', 'ចំណាយសរុប')} v={t.expenses_cents} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}><div className="row between wrap"><b>{L('Paid-in capital left after expenses', 'ដើមទុនដែលនៅសល់ក្រោយចំណាយ')}</b><b className="num" style={{ color: t.left_cents < 0 ? 'var(--bad)' : 'var(--ok)' }}>{usd(t.left_cents)}</b></div>
        <p className="muted small" style={{ margin: '4px 0 0' }}>{L('Paid in minus all expenses entered. Sales income is not included here.', 'ដើមទុនបង់ចូល ដកចំណាយទាំងអស់។ មិនរួមបញ្ចូលចំណូលពីការលក់ទេ។')}</p></div>
      <ProfitShare sel={sel} setSel={setSel} month={month} setMonth={setMonth} L={L} />
      {sel === 'all' && d.stores.length > 1 && (
        <div className="card tbl" style={{ marginBottom: 12 }}><h3 style={{ marginBottom: 8 }}>{L('By store', 'តាមសាខា')}</h3>
          <table><thead><tr><th>{L('Store', 'សាខា')}</th><th className="right">{L('Agreed', 'ព្រមព្រៀង')}</th><th className="right">{L('Paid in', 'បានបង់')}</th><th className="right">{L('Still to pay', 'នៅខ្វះ')}</th><th className="right">{L('Expenses', 'ចំណាយ')}</th><th className="right">{L('Left', 'នៅសល់')}</th></tr></thead>
            <tbody>{d.by_store.map((r) => <tr key={r.store_id} className="click" onClick={() => setSel(String(r.store_id))}><td><b>{r.name}</b></td><td className="right num">{usd(r.agreed_cents)}</td><td className="right num">{usd(r.paid_cents)}</td><td className="right num" style={{ color: r.outstanding_cents > 0 ? 'var(--warn)' : undefined }}>{usd(r.outstanding_cents)}</td><td className="right num">{usd(r.expenses_cents)}</td><td className="right num" style={{ color: r.left_cents < 0 ? 'var(--bad)' : undefined }}>{usd(r.left_cents)}</td></tr>)}</tbody></table></div>
      )}
      <div className="card tbl" style={{ marginBottom: 12 }}>
        <table><thead><tr><th>{L('Shareholder', 'អ្នកហ៊ុន')}</th><th className="right">{L('Agreed', 'ព្រមព្រៀង')}</th><th className="right">{L('Paid', 'បានបង់')}</th><th className="right">{L('Still to pay', 'នៅខ្វះ')}</th><th style={{ minWidth: 120 }}>%</th>{edit && <th />}</tr></thead>
          <tbody>{d.shareholders.map((r) => (
            <tr key={r.id} style={{ opacity: r.active ? 1 : .5 }}><td><b>{r.name}</b>{r.note && <div className="small muted">{r.note}</div>}</td>
              <td className="right num">{usd(r.agreed_cents)}</td><td className="right num">{usd(r.paid_cents)}</td>
              <td className="right num" style={{ color: r.outstanding_cents > 0 ? 'var(--warn)' : 'var(--ok)' }}>{r.outstanding_cents < 0 ? `+${usd(-r.outstanding_cents)}` : usd(r.outstanding_cents)}</td>
              <td><div style={{ background: 'var(--surface2)', borderRadius: 5, height: 10 }}><div className="hbar" style={{ width: `${pct(r.paid_cents, r.agreed_cents)}%` }} /></div><span className="small muted">{pct(r.paid_cents, r.agreed_cents)}%</span></td>
              {edit && <td><button className="btn" onClick={() => setSh({ ...r, agreed_by_store: Object.fromEntries(Object.entries(r.agreed_by_store || {}).map(([k, v]) => [k, v / 100])) })}>{L('Edit', 'កែ')}</button></td>}</tr>))}
            {!d.shareholders.length && <tr><td colSpan="6" className="muted">{L('No shareholders yet.', 'មិនទាន់មានអ្នកហ៊ុនទេ។')}</td></tr>}
            {d.shareholders.length > 0 && <tr><td><b>{L('Total', 'សរុប')}</b></td><td className="right num"><b>{usd(t.agreed_cents)}</b></td><td className="right num"><b>{usd(t.paid_cents)}</b></td><td className="right num"><b>{usd(t.outstanding_cents)}</b></td><td /><td /></tr>}</tbody></table>
      </div>
      <div className="grid g2">
        <div className="card tbl"><h3 style={{ marginBottom: 8 }}>{L('Payments received', 'ការបង់ប្រាក់')}</h3>
          <table><thead><tr><th>{L('Date', 'កាលបរិច្ឆេទ')}</th><th>{L('Shareholder', 'អ្នកហ៊ុន')}</th><th className="right">{L('Amount', 'ចំនួន')}</th>{edit && <th />}</tr></thead>
            <tbody>{d.payments.map((p) => (
              <tr key={p.id} style={{ opacity: p.reversed ? .55 : 1 }}><td className="num">{p.date}</td><td>{p.shareholder_name}{sel === 'all' && <span className="badge" style={{ marginLeft: 6 }}>{p.store_name}</span>}{p.note && <div className="small muted">{p.note}</div>}</td>
                <td className="right num" style={{ color: p.amount_cents < 0 ? 'var(--bad)' : undefined, textDecoration: p.reversed ? 'line-through' : undefined }}>{usd(p.amount_cents)}</td>
                {edit && <td>{p.kind === 'payment' && !p.reversed && <button className="btn" onClick={() => setRev({ id: p.id, reason: '' })}>{L('Reverse', 'បញ្ច្រាស')}</button>}</td>}</tr>))}
              {!d.payments.length && <tr><td colSpan="4" className="muted">{L('No payments recorded.', 'មិនទាន់មានការបង់ប្រាក់ទេ។')}</td></tr>}</tbody></table></div>
        <div className="card tbl"><h3 style={{ marginBottom: 8 }}>{L('Where the money went', 'ចំណាយទៅលើអ្វី')}</h3>
          <table><tbody>{d.expenses_by_category.map((c) => <tr key={c.category}><td>{c.category}</td><td className="right num">{usd(c.cents)}</td></tr>)}
            {!d.expenses_by_category.length && <tr><td className="muted">{L('No expenses yet.', 'មិនទាន់មានចំណាយទេ។')}</td></tr>}</tbody></table></div>
      </div>
      {err && <div className="error">{err}</div>}
      {sh && <ShareholderForm f={sh} d={d} L={L} onClose={() => setSh(null)} onDone={() => { setSh(null); show(L('Saved', 'បានរក្សាទុក')); load(); }} />}
      {pay && <PayForm f={pay} d={d} L={L} onClose={() => setPay(null)} onDone={() => { setPay(null); show(L('Payment recorded', 'បានកត់ត្រា')); load(); }} />}
      {rev && <Modal title={L('Reverse this payment', 'បញ្ច្រាសការបង់ប្រាក់នេះ')} onClose={() => setRev(null)}>
        <p className="muted">{L('The original stays in the list, crossed out, with a dated correction. Write the reason.', 'ការបង់ប្រាក់ដើមនៅតែមាន ហើយមានការកែតម្រូវ។ សូមសរសេរមូលហេតុ។')}</p>
        <input value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} autoFocus />
        <button className="btn danger" style={{ marginTop: 12 }} disabled={rev.reason.trim().length < 3} onClick={async () => { try { await api.post(`/capital/payments/${rev.id}/reverse`, { reason: rev.reason }); setRev(null); load(); } catch (e) { setErr(e.message); setRev(null); } }}>{L('Reverse payment', 'បញ្ច្រាស')}</button></Modal>}
      {toast}
    </div>
  );
}

function ShareholderForm({ f, d, L, onClose, onDone }) {
  const [x, setX] = useState(f); const [err, setErr] = useState('');
  const [tot, setTot] = useState(() => Object.fromEntries(d.stores.map((st) => { let v = ''; try { v = localStorage.getItem(`af_cap_total_${st.id}`) || ''; } catch { /* ignore */ } return [st.id, v]; }))); const [pc, setPc] = useState({});
  const save = async () => { try { await api.post(x.id ? `/capital/shareholders/${x.id}` : '/capital/shareholders', { name: x.name, letter: x.letter, agreed_by_store: x.agreed_by_store, note: x.note, active: x.active !== false }); onDone(); } catch (e) { setErr(e.message); } };
  const del = async () => { if (!window.confirm(L('Delete this shareholder?', 'លុបអ្នកហ៊ុននេះ?'))) return; try { await api.post(`/capital/shareholders/${x.id}/delete`); onDone(); } catch (e) { setErr(e.message); } };
  return (
    <Modal title={x.id ? L('Edit shareholder', 'កែអ្នកហ៊ុន') : L('New shareholder', 'អ្នកហ៊ុនថ្មី')} onClose={onClose}>
      <label>{L('Name', 'ឈ្មោះ')}</label><input value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} autoFocus />
      <label>{L('Letter for design codes', 'អក្សរសម្រាប់កូដម៉ូដែល')}</label><input style={{ width: 90 }} maxLength={3} placeholder={(x.name || '').trim().charAt(0).toUpperCase()} value={x.letter || ''} onChange={(e) => setX({ ...x, letter: e.target.value.toUpperCase() })} /><div className="small muted">{L('Used at the start of a design code when this person helped pay for the design. Two people can have the same letter.', 'ប្រើនៅដើមកូដម៉ូដែល នៅពេលអ្នកនេះចូលហ៊ុនផលិតម៉ូដែលនោះ។ មនុស្សពីរនាក់អាចមានអក្សរដូចគ្នា។')}</div>
      <label>{L('Share in each store: type the shop’s total once, then this person’s %. Leave empty if none.', 'ចំណែកក្នុងសាខានីមួយៗ៖ វាយដើមទុនសរុបម្តង រួចវាយ % របស់អ្នកនេះ។ ទុកទទេបើគ្មាន។')}</label>
      {d.stores.map((st) => {
        const total = tot[st.id] ?? ''; const amt = x.agreed_by_store[st.id] ?? '';
        const setTotal = (v) => { setTot({ ...tot, [st.id]: v }); try { localStorage.setItem(`af_cap_total_${st.id}`, v); } catch { /* ignore */ } };
        const setPct = (v) => { setPc({ ...pc, [st.id]: v }); if (total !== '' && v !== '') setX({ ...x, agreed_by_store: { ...x.agreed_by_store, [st.id]: String(Math.round((Number(total) * Number(v)) * 100) / 10000) } }); };
        return (
          <div key={st.id} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--line, #e4dccb)' }}>
            <b>{st.name}</b>
            <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
              <label style={{ margin: 0 }} className="small">{L('Shop total capital ($)', 'ដើមទុនសរុបរបស់សាខា ($)')}<input type="number" min="0" style={{ width: 130, display: 'block' }} value={total} onChange={(e) => setTotal(e.target.value)} /></label>
              <label style={{ margin: 0 }} className="small">{L('This person’s %', '% របស់អ្នកនេះ')}<input type="number" min="0" max="100" step="0.1" style={{ width: 90, display: 'block' }} value={pc[st.id] ?? (total !== '' && amt !== '' && Number(total) > 0 ? Math.round((Number(amt) / Number(total)) * 1000) / 10 : '')} onChange={(e) => setPct(e.target.value)} /></label>
              <label style={{ margin: 0 }} className="small">{L('Agreed amount ($)', 'ចំនួនព្រមព្រៀង ($)')}<input type="number" min="0" style={{ width: 130, display: 'block' }} value={amt} onChange={(e) => { setPc({ ...pc, [st.id]: undefined }); setX({ ...x, agreed_by_store: { ...x.agreed_by_store, [st.id]: e.target.value } }); }} /></label>
            </div>
          </div>
        );
      })}
      <label>{L('Note', 'កំណត់ចំណាំ')}</label><input value={x.note || ''} onChange={(e) => setX({ ...x, note: e.target.value })} />
      {x.id && <label className="row" style={{ textTransform: 'none', fontSize: 14, color: 'var(--text)' }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={x.active !== false} onChange={(e) => setX({ ...x, active: e.target.checked })} />{L('Active', 'សកម្ម')}</label>}
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ marginTop: 14 }}><button className="btn primary grow" disabled={!x.name.trim()} onClick={save}>{L('Save', 'រក្សាទុក')}</button>{x.id && <button className="btn danger" onClick={del}>{L('Delete', 'លុប')}</button>}</div>
    </Modal>
  );
}

function PayForm({ f, d, L, onClose, onDone }) {
  const [x, setX] = useState(f); const [err, setErr] = useState('');
  const save = async () => { try { await api.post('/capital/payments', { shareholder_id: x.shareholder_id, store_id: x.store_id, date: x.date, amount_usd: Number(x.amount_usd), note: x.note }); onDone(); } catch (e) { setErr(e.message); } };
  return (
    <Modal title={L('Record payment received', 'កត់ត្រាការបង់ប្រាក់')} onClose={onClose}>
      <label>{L('Shareholder', 'អ្នកហ៊ុន')}</label><select value={x.shareholder_id} onChange={(e) => setX({ ...x, shareholder_id: e.target.value })}>{d.all_shareholders.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <label>{L('For which store', 'សម្រាប់សាខា')}</label><select value={x.store_id} onChange={(e) => setX({ ...x, store_id: Number(e.target.value) })}>{d.stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select>
      <label>{L('Date received', 'កាលបរិច្ឆេទទទួល')}</label><input type="date" value={x.date} onChange={(e) => setX({ ...x, date: e.target.value })} />
      <label>{L('Amount ($)', 'ចំនួន ($)')}</label><input type="number" min="0" value={x.amount_usd} onChange={(e) => setX({ ...x, amount_usd: e.target.value })} />
      <label>{L('Note (bank transfer, cash…)', 'កំណត់ចំណាំ')}</label><input value={x.note} onChange={(e) => setX({ ...x, note: e.target.value })} />
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" style={{ width: '100%', marginTop: 14 }} disabled={!x.amount_usd || !x.shareholder_id} onClick={save}>{L('Save payment', 'រក្សាទុក')}</button>
    </Modal>
  );
}
