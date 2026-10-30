import React, { useEffect, useState } from 'react';
import { useApp } from '../ui.jsx';

// Small clock for the till. Always Phnom Penh time, whatever the device's timezone is set to.
// It also compares the device clock with the web server's clock and warns when they disagree.
export default function Clock() {
  const { lang } = useApp(); const km = lang === 'km';
  const [now, setNow] = useState(Date.now()); const [skew, setSkew] = useState(0);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(h); }, []);
  useEffect(() => {
    let dead = false;
    const check = async () => {
      try {
        const t0 = Date.now(); const r = await fetch(`${window.location.pathname}?_=${t0}`, { method: 'HEAD', cache: 'no-store' }); const t1 = Date.now();
        const d = Date.parse(r.headers.get('date') || ''); if (!dead && d) setSkew(d + (t1 - t0) / 2 - t1);
      } catch { /* offline: no warning */ }
    };
    check(); const h = setInterval(check, 10 * 60 * 1000);
    return () => { dead = true; clearInterval(h); };
  }, []);
  const loc = km ? 'km-KH-u-nu-latn' : 'en-GB';
  const day = new Intl.DateTimeFormat(loc, { timeZone: 'Asia/Phnom_Penh', weekday: 'short', day: 'numeric', month: 'short' }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const off = Math.abs(skew) > 2 * 60 * 1000;
  return (
    <span className="posclock" title="Phnom Penh time">
      <span>{day} · <b>{time}</b></span>
      {off && <span className="clockwarn">⚠ {km ? 'ពិនិត្យនាឡិកាឧបករណ៍នេះ' : 'Check this device’s clock'}</span>}
    </span>
  );
}
