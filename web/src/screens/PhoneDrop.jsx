import React from 'react';

// Shows the main (first) number as a call link. When there are more numbers, a small ▾ lets you pick another one to call.
export const telHref = (p) => `tel:${String(p).replace(/[^\d+]/g, '')}`;
export default function PhoneDrop({ phones = [], callLabel }) {
  const list = phones.filter(Boolean);
  if (!list.length) return <span className="muted">—</span>;
  const main = list[0];
  return (
    <span className="phonewrap">
      {callLabel
        ? <a className="btn" href={telHref(main)} onClick={(e) => e.stopPropagation()}>{callLabel}</a>
        : <a href={telHref(main)} onClick={(e) => e.stopPropagation()}>{main}</a>}
      {list.length > 1 && (
        <select className="phonemore" value="" aria-label="Other phone numbers" title={`${list.length} numbers`} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { if (e.target.value) window.location.href = telHref(e.target.value); e.target.value = ''; }}>
          <option value="">▾</option>
          {list.map((p, i) => <option key={i} value={p}>{p}{i === 0 ? ' (main)' : ''}</option>)}
        </select>)}
    </span>);
}
