import React from 'react';
// One number = a call link. Several numbers = a small dropdown; pick a number to call it.
export const telHref = (p) => `tel:${String(p).replace(/[^\d+]/g, '')}`;
export default function PhoneDrop({ phones = [], label = '📞' }) {
  const list = phones.filter(Boolean);
  if (!list.length) return <span className="muted">—</span>;
  if (list.length === 1) return <a href={telHref(list[0])} onClick={(e) => e.stopPropagation()}>{list[0]}</a>;
  return (
    <select className="phonedrop" value="" aria-label="Phone numbers" onClick={(e) => e.stopPropagation()} onChange={(e) => { if (e.target.value) window.location.href = telHref(e.target.value); e.target.value = ''; }}>
      <option value="">{label} {list.length} numbers</option>
      {list.map((p, i) => <option key={i} value={p}>{p}</option>)}
    </select>);
}
