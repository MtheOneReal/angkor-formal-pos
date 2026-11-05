import React, { useState } from 'react';

// Shows one number as a call link. With several numbers, the small ▾ picks which one is shown; tapping the shown number calls it.
export const telHref = (p) => `tel:${String(p).replace(/[^\d+]/g, '')}`;
export default function PhoneDrop({ phones = [], callLabel }) {
  const list = phones.filter(Boolean);
  const [sel, setSel] = useState(0);
  if (!list.length) return <span className="muted">—</span>;
  const cur = list[Math.min(sel, list.length - 1)];
  const stop = (e) => e.stopPropagation();
  return (
    <span className="phonewrap">
      {callLabel
        ? <a className="btn" href={telHref(cur)} onClick={stop}>{callLabel}{list.length > 1 && sel > 0 ? ` ${cur}` : ''}</a>
        : <a href={telHref(cur)} onClick={stop}>{cur}</a>}
      {list.length > 1 && (
        <select className="phonemore" value="" aria-label="Choose which number to show" title={`${list.length} numbers`} onClick={stop}
          onChange={(e) => { if (e.target.value !== '') setSel(Number(e.target.value)); e.target.value = ''; }}>
          <option value="">▾</option>
          {list.map((p, i) => <option key={i} value={i}>{p}{i === 0 ? ' (main)' : ''}{i === sel ? ' ✓' : ''}</option>)}
        </select>)}
    </span>);
}
