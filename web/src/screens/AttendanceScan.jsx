import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { api, qs } from '../api.js';
import { useApp, Modal } from '../ui.jsx';

// Shop screen: a QR code that changes every 30 seconds. Staff scan it with their phone to clock in.
export function ShopQR({ storeId, label }) {
  const { lang } = useApp(); const L = (en, km) => (lang === 'km' ? km : en);
  const [open, setOpen] = useState(false);
  return (<>
    <button className="btn" onClick={() => setOpen(true)}>📱 {label || L('Staff QR', 'QR បុគ្គលិក')}</button>
    {open && <QRModal storeId={storeId} onClose={() => setOpen(false)} L={L} />}
  </>);
}
function QRModal({ storeId, onClose, L }) {
  const [q, setQ] = useState(null); const [err, setErr] = useState(''); const [left, setLeft] = useState(0);
  useEffect(() => {
    let dead = false; let h;
    const load = async () => { try { const r = await api.get(`/attendance/code${qs({ store_id: storeId })}`); if (dead) return; setQ(r); setLeft(r.seconds_left); setErr(''); h = setTimeout(load, r.seconds_left * 1000); } catch (e) { if (!dead) setErr(e.message); } };
    load(); return () => { dead = true; clearTimeout(h); };
  }, [storeId]);
  useEffect(() => { if (!q) return undefined; const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000); return () => clearInterval(t); }, [q]);
  let svg = ''; if (q) { const c = qrcode(0, 'M'); c.addData(q.payload); c.make(); svg = c.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); }
  return (
    <Modal title={L('Staff clock-in QR', 'QR ចូលធ្វើការ')} onClose={onClose}>
      {err && <div className="error">{err}</div>}
      {q && <div style={{ textAlign: 'center' }}>
        <div style={{ background: '#fff', padding: 8, borderRadius: 12, width: 'min(360px,100%)', margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="muted" style={{ marginTop: 10 }}>{L('Staff: open the app on your phone, tap Clock in, and point the camera here.', 'បុគ្គលិក៖ បើកកម្មវិធីលើទូរស័ព្ទ ចុច ចូលធ្វើការ ហើយចង្អុលកាមេរ៉ាមកទីនេះ។')}</p>
        <p className="small muted">{L('The code changes in', 'កូដប្តូរក្នុង')} {left}s</p>
      </div>}
    </Modal>
  );
}

// Staff phone: scan the shop QR, then take a live selfie. Nothing can be picked from the gallery.
export function ClockInFlow({ storeId, checks, onDone, onClose }) {
  const { lang } = useApp(); const L = (en, km) => (lang === 'km' ? km : en);
  const qrOn = !!checks?.qr; const geoOn = !!checks?.geo; const [step, setStep] = useState(qrOn ? 'scan' : 'selfie'); const [pos, setPos] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!geoOn) return undefined;
    if (!navigator.geolocation) { setErr(L('This phone cannot share its location.', 'ទូរស័ព្ទនេះមិនអាចចែករំលែកទីតាំងបានទេ។')); return undefined; }
    const id = navigator.geolocation.watchPosition((p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setErr((e) => (/location/i.test(e) ? '' : e)); },
      () => setErr(L('Allow location for this site in your phone settings, so the app can see you are at the shop.', 'សូមអនុញ្ញាតទីតាំងសម្រាប់គេហទំព័រនេះក្នុងការកំណត់ទូរស័ព្ទ ដើម្បីបញ្ជាក់ថាអ្នកនៅហាង។')), { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [geoOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const video = useRef(null); const stream = useRef(null); const code = useRef('');
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  const start = async (facing) => {
    stop(); setErr('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 960 } }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play(); }
    } catch { setErr(L('The camera is blocked. Allow the camera for this site in your phone settings, then try again.', 'កាមេរ៉ាត្រូវបានបិទ។ សូមអនុញ្ញាតកាមេរ៉ាសម្រាប់គេហទំព័រនេះក្នុងការកំណត់ទូរស័ព្ទ រួចព្យាយាមម្តងទៀត។')); }
  };
  useEffect(() => { start(step === 'scan' ? 'environment' : 'user'); return stop; }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (step !== 'scan') return undefined;
    const cv = document.createElement('canvas'); const cx = cv.getContext('2d', { willReadFrequently: true }); let dead = false;
    const tick = () => {
      if (dead) return; const v = video.current;
      if (v && v.videoWidth) {
        cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0); const img = cx.getImageData(0, 0, cv.width, cv.height); const r = jsQR(img.data, img.width, img.height);
        const m = r && /^AFQR:(\d+):(\d{6})$/.exec(r.data);
        if (m) { if (Number(m[1]) !== Number(storeId)) setErr(L('This QR belongs to another shop.', 'QR នេះជារបស់ហាងផ្សេង។')); else { code.current = m[2]; setStep('selfie'); return; } }
      }
      setTimeout(tick, 200);
    };
    tick(); return () => { dead = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const snap = async () => {
    const v = video.current; if (!v?.videoWidth) return; if (geoOn && !pos) { setErr(L('Still finding your location… wait a moment and try again.', 'កំពុងរកទីតាំង… សូមរង់ចាំបន្តិច រួចព្យាយាមម្តងទៀត។')); return; } setBusy(true); setErr('');
    const w = 320; const h = Math.round((v.videoHeight / v.videoWidth) * w); const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(v, 0, 0, w, h);
    try { await api.post('/attendance/clock-in', { store_id: storeId, code: code.current, selfie: cv.toDataURL('image/jpeg', 0.6), ...(pos ? { lat: pos.lat, lng: pos.lng, acc: pos.acc } : {}) }); stop(); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); if (/QR/.test(e.message)) setStep('scan'); }
  };
  return (
    <Modal title={step === 'scan' ? L('Step 1 of 2 — scan the shop QR', 'ជំហាន ១/២ — ស្កេន QR ហាង') : qrOn ? L('Step 2 of 2 — take a selfie', 'ជំហាន ២/២ — ថតរូបខ្លួនឯង') : L('Take a selfie to clock in', 'ថតរូបខ្លួនឯងដើម្បីចូលធ្វើការ')} onClose={() => { stop(); onClose(); }}>
      <div style={{ position: 'relative', background: '#000', borderRadius: 12, overflow: 'hidden', aspectRatio: '3 / 4', maxHeight: '60vh', margin: '0 auto', width: 'min(100%, 360px)' }}>
        <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: step === 'selfie' ? 'scaleX(-1)' : 'none' }} />
      </div>
      {step === 'scan' && <p className="muted" style={{ textAlign: 'center' }}>{L('Point the camera at the QR on the shop screen.', 'ចង្អុលកាមេរ៉ាទៅ QR លើអេក្រង់ហាង។')}</p>}
      {step === 'selfie' && geoOn && <p className="small muted" style={{ textAlign: 'center', margin: '8px 0 0' }}>📍 {pos ? L('Location found', 'បានរកឃើញទីតាំង') : L('Finding your location…', 'កំពុងរកទីតាំង…')}</p>}
      {step === 'selfie' && <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={snap}>{busy ? '…' : `📸 ${L('Take photo and clock in', 'ថតរូប និងចូលធ្វើការ')}`}</button>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}
