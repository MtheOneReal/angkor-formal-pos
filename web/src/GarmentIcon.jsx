import React from 'react';

// Default pictures for products that have no photo yet.
// Each drawing has a body (the garment) and detail lines. Three looks are drawn from the same shapes:
//   colour = flat colour illustration in realistic fabric colours   sketch = fashion technical drawing with stitching
//   emblem = gold seal with the garment inside                       line   = plain thin outline
export const ICON_STYLES = ['colour', 'sketch', 'emblem', 'line'];

const G = {
  suit: { body: ['M24 6L12 11 7 46l8 2 3-22v32h28V26l3 22 8-2-5-35-12-5-8 6z'], detail: ['M32 12L25 32l7 10 7-10z', 'M32 14l-2 3 2 3 2-3z', 'M30 20l-2 20 4 4 4-4-2-20z', 'M32 44v14', 'M22 48h6M36 48h6'] },
  blazer: { body: ['M24 6L12 11 7 46l8 2 3-22v32h28V26l3 22 8-2-5-35-12-5-8 6z'], detail: ['M32 12L25 32l7 10 7-10z', 'M32 42v16', 'M32 47h.01', 'M22 48h6M36 48h6', 'M37 31h5'] },
  trousers: { body: ['M18 5h28l3 54H35l-3-30-3 30H15z'], detail: ['M18 11h28', 'M32 11v18', 'M21 13l3 9', 'M43 13l-3 9', 'M23 36l-1 21', 'M41 36l1 21'] },
  shirt: { body: ['M22 6l10 6 10-6 10 6 5 36-8 2-3-22v32H18V26l-3 22-8-2 5-34z'], detail: ['M22 6l5 10 5-4 5 4 5-10', 'M32 12v46', 'M32 22h.01M32 31h.01M32 40h.01M32 49h.01', 'M11 44l5 1M53 44l-5 1'] },
  tie: { body: ['M27 5h10l-2 9h-6z', 'M29 14l-5 36 8 9 8-9-5-36z'], detail: ['M28 9h8', 'M27 24h10', 'M26 34h12', 'M25 44h14'] },
  bowtie: { body: ['M32 32L9 19v26z', 'M32 32l23-13v26z', 'M27 26h10v12H27z'], detail: ['M16 26l7 6-7 6', 'M48 26l-7 6 7 6'] },
  socks: { body: ['M23 5h18v26l12 9c4 4 2 11-4 11-4 0-7-2-10-4L26 40c-2-2-3-5-3-9z'], detail: ['M23 13h18', 'M23 18h18', 'M45 45l5-4'] },
  belt: { body: ['M5 25h54v14H5z', 'M24 21h16v22H24z'], detail: ['M29 27h6v10h-6z', 'M45 32h.01M50 32h.01M55 32h.01', 'M8 28h12M8 36h12'] },
  shoes: { body: ['M5 36V26h13c3 6 8 9 15 9l14 3c7 2 12 5 12 10v3H5z'], detail: ['M5 46h54', 'M22 28l5 5M27 25l5 6M32 24l5 6', 'M10 31h6'] },
  waistcoat: { body: ['M20 5l12 17 12-17 7 8-3 45H16L13 13z'], detail: ['M32 22v36', 'M32 30h.01M32 38h.01M32 46h.01', 'M20 46h7', 'M44 46h-7'] },
  coat: { body: ['M24 5L11 10 6 50l8 2 4-24-2 32h32l-2-32 4 24 8-2-5-40-13-5-8 7z'], detail: ['M32 12l-8 22 8 12 8-12z', 'M32 46v14', 'M32 50h.01', 'M21 50h5M38 50h5'] },
  cufflink: { body: ['M10 22a11 11 0 1 0 22 0a11 11 0 1 0-22 0', 'M38 38a8 8 0 1 0 16 0a8 8 0 1 0-16 0'], detail: ['M21 22a4 4 0 1 0 .01 0', 'M32 28l8 6', 'M46 38h.01'] },
  pocket: { body: ['M8 52V24l8-8h32l8 8v28z'], detail: ['M8 24h48', 'M16 24l8 12 8-16 8 16 8-12'] },
  hanger: { body: ['M32 24L8 43c-3 2-1 6 2 6h44c3 0 5-4 2-6z'], detail: ['M32 24v-5a5 5 0 1 0-5-5'] },
};

const BY_CODE = { S: 'suit', B: 'blazer', T: 'trousers', H: 'shirt', A: 'tie' };
const WORDS = [
  [/bow\s*tie/, 'bowtie'], [/neck\s*tie|\btie/, 'tie'], [/sock|stocking/, 'socks'], [/belt/, 'belt'], [/shoe|loafer|oxford|boot/, 'shoes'],
  [/waistcoat|vest|gilet/, 'waistcoat'], [/over\s*coat|\bcoat|trench/, 'coat'], [/pocket/, 'pocket'], [/cuff/, 'cufflink'],
  [/blazer|jacket/, 'blazer'], [/trouser|pant|chino|jean|short/, 'trousers'], [/shirt|polo|tee|blouse/, 'shirt'], [/suit|tuxedo|tux/, 'suit'],
  [/ខោ/, 'trousers'], [/អាវធំ/, 'blazer'], [/ឈុត/, 'suit'], [/អាវ/, 'shirt'], [/ក្រវ៉ាត់/, 'tie'], [/ស្រោមជើង/, 'socks'], [/ខ្សែក្រវ៉ាត់/, 'belt'], [/ស្បែកជើង/, 'shoes'],
];
export function garmentKey(code, nameEn, nameKm) {
  const text = `${nameEn || ''} ${nameKm || ''}`.toLowerCase();
  for (const [re, k] of WORDS) if (re.test(text)) return k;
  return BY_CODE[String(code || '').toUpperCase()] || 'hanger';
}
export const GARMENT_KEYS = Object.keys(G);

// Realistic colours for the flat style: [fabric, shadow, detail]
const COL = {
  suit: ['#25345a', '#16203a', '#e8ecf5'], blazer: ['#454851', '#2b2d33', '#d9dbe0'], trousers: ['#b89f72', '#8d7650', '#6e5a38'], shirt: ['#f3f4f1', '#d3d6d0', '#8fa6c8'],
  tie: ['#8a2433', '#5e1622', '#d9b25f'], bowtie: ['#1f2022', '#0f1011', '#d9b25f'], socks: ['#2f3f66', '#1f2b48', '#e8ecf5'], belt: ['#6b4423', '#47290f', '#d9b25f'],
  shoes: ['#6b4423', '#3f2410', '#2a170a'], waistcoat: ['#5b606b', '#3c4049', '#d9dbe0'], coat: ['#b58b5a', '#8a6638', '#5e4524'], cufflink: ['#d9b25f', '#a8832f', '#fff3cf'],
  pocket: ['#f3f4f1', '#d3d6d0', '#b3303f'], hanger: ['#a9794a', '#7c5530', '#5b3d20'],
};
let chosen = 'colour';
try { chosen = globalThis.localStorage?.getItem('af_icon_style') || 'colour'; } catch { /* ignore */ }
export const setIconStyle = (s) => { chosen = ICON_STYLES.includes(s) ? s : 'colour'; try { globalThis.localStorage?.setItem('af_icon_style', chosen); } catch { /* ignore */ } };
let uid = 0;

export default function GarmentIcon({ code, name, nameKm, kind, size = 56, variant, style, tint }) {
  const key = kind || garmentKey(code, name, nameKm);
  const g = G[key]; const v = variant || chosen; const rnd = React.useRef(++uid).current;
  const c = { strokeLinecap: 'round', strokeLinejoin: 'round' };
  const lineLook = (k = 2) => (<>
    {g.body.map((d, i) => <path key={`b${i}`} d={d} fill="none" stroke="currentColor" strokeWidth={k} {...c} />)}
    {g.detail.map((d, i) => <path key={`d${i}`} d={d} fill="none" stroke="currentColor" strokeWidth="1.8" {...c} />)}
  </>);
  let inner;
  if (v === 'colour') {
    const [f, sh, dt] = COL[key]; const main = tint || f; const clip = `gi${rnd}`;
    inner = (<>
      <defs><clipPath id={clip}>{g.body.map((d, i) => <path key={i} d={d} />)}</clipPath></defs>
      {g.body.map((d, i) => <path key={`b${i}`} d={d} fill={main} stroke={sh} strokeWidth="1.2" {...c} />)}
      <g clipPath={`url(#${clip})`}><rect x="33" y="0" width="40" height="64" fill={sh} opacity=".28" /><rect x="0" y="56" width="64" height="12" fill={sh} opacity=".22" /></g>
      {g.detail.map((d, i) => <path key={`d${i}`} d={d} fill="none" stroke={key === 'shirt' || key === 'pocket' || key === 'trousers' || key === 'shoes' ? dt : dt} strokeWidth="1.6" opacity=".95" {...c} />)}
    </>);
  } else if (v === 'sketch') {
    inner = (<g stroke="#2a2723" {...c}>
      {g.body.map((d, i) => <path key={`b${i}`} d={d} fill="#fbfaf7" strokeWidth="1.8" />)}
      {g.body.map((d, i) => <path key={`s${i}`} d={d} fill="none" strokeWidth=".9" strokeDasharray="1.6 2.2" transform="translate(32 32) scale(.9) translate(-32 -32)" />)}
      {g.detail.map((d, i) => <path key={`d${i}`} d={d} fill="none" strokeWidth="1.4" />)}
    </g>);
  } else if (v === 'emblem') {
    inner = (<>
      <circle cx="32" cy="32" r="30" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth=".8" strokeDasharray="1 2.4" />
      <g transform="translate(32 33) scale(.62) translate(-32 -32)">{lineLook(2.6)}</g>
    </>);
  } else inner = lineLook(2);
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={style}>{inner}</svg>;
}
