import React from 'react';
import { G, garmentKey } from './GarmentIcon.jsx';

// Three studio-style placeholder looks for products without a photo. Each fills the whole picture tile (4:3).
//   swatch   = a swatch of the real fabric (colour + weave) with the garment stamped on it in gold
//   studio   = a soft studio product shot: shaded garment silhouette on a hanger with a floor shadow
//   monogram = a deep-colour card with the shop monogram and the product type in small caps
export const ART_STYLES = ['swatch', 'studio', 'monogram'];

const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0x3a3f4a; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (h, to, t) => { const a = hex(h); const b = hex(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };
const lum = (h) => { const [r, g, b] = hex(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

const DEFAULT = { suit: '#25345a', blazer: '#454851', trousers: '#b89f72', shirt: '#eef0ec', tie: '#8a2433', bowtie: '#1f2022', socks: '#2f3f66', belt: '#6b4423', shoes: '#5b3a1f', waistcoat: '#5b606b', coat: '#a9855a', cufflink: '#c9a24a', pocket: '#f1efe8', hanger: '#8d6a43' };
const PATTERN = { suit: 'herring', blazer: 'herring', coat: 'herring', waistcoat: 'herring', trousers: 'pin', shirt: 'oxford', tie: 'repp', bowtie: 'dots', socks: 'rib', belt: 'grain', shoes: 'grain', pocket: 'oxford', cufflink: 'oxford', hanger: 'oxford' };
const NAMES = { suit: 'SUIT', blazer: 'BLAZER', trousers: 'TROUSERS', shirt: 'SHIRT', tie: 'TIE', bowtie: 'BOW TIE', socks: 'SOCKS', belt: 'BELT', shoes: 'SHOES', waistcoat: 'WAISTCOAT', coat: 'OVERCOAT', cufflink: 'CUFFLINKS', pocket: 'POCKET SQUARE', hanger: 'ACCESSORY' };

// Closed silhouette of the mirrored half drawings.
function silhouette(g) {
  const out = [];
  for (const d of g.s || []) {
    const n = d.match(/-?\d+\.?\d*/g).map(Number); const sx = n[0]; const sy = n[1]; const ex = n[n.length - 2]; const ey = n[n.length - 1];
    out.push(d + (Math.abs(ex - 48) > 0.1 ? `L48 ${ey}` : '') + `L48 ${sy}Z`);
  }
  return out;
}
const HANGABLE = new Set(['suit', 'blazer', 'shirt', 'trousers', 'waistcoat', 'coat']);
let uid = 0;

function Shapes({ g, key_, mode, fill, stroke, sw = 2, detail, dw }) {
  const sil = silhouette(g);
  const half = (
    <>
      {sil.map((d, i) => <path key={`z${i}`} d={d} fill={mode === 'line' ? 'none' : fill} stroke={mode === 'line' ? stroke : 'none'} strokeWidth={sw} strokeLinejoin="round" />)}
      {(g.f || []).map((d, i) => <path key={`f${i}`} d={d} fill="none" stroke={detail} strokeWidth={dw} strokeLinecap="round" strokeLinejoin="round" />)}
    </>
  );
  return (
    <>
      {(g.s || []).length ? (<><g>{half}</g><g transform="translate(96 0) scale(-1 1)">{half}</g></>) : null}
      {(g.S || []).map((d, i) => <path key={`S${i}`} d={d} fill={mode === 'line' ? 'none' : fill} stroke={mode === 'line' ? stroke : 'none'} strokeWidth={sw} strokeLinejoin="round" />)}
      {(g.F || []).map((d, i) => <path key={`F${i}`} d={d} fill="none" stroke={detail} strokeWidth={dw} strokeLinecap="round" strokeLinejoin="round" />)}
      {(g.D || []).map(([x, y, r], i) => <circle key={`D${i}`} cx={x} cy={y} r={r} fill={detail} />)}
      {key_ === 'cufflink' && (<g><circle cx="32" cy="46" r="17" fill={mode === 'line' ? 'none' : fill} stroke={mode === 'line' ? stroke : 'none'} strokeWidth={sw} /><circle cx="32" cy="46" r="10" fill="none" stroke={detail} strokeWidth={dw} /><ellipse cx="62" cy="46" rx="5" ry="14" fill={mode === 'line' ? 'none' : fill} stroke={mode === 'line' ? stroke : 'none'} strokeWidth={sw} /><path d="M67 46H84M84 37V55" stroke={mode === 'line' ? stroke : fill} strokeWidth={Number(sw) + 1} fill="none" strokeLinecap="round" /></g>)}
    </>
  );
}

export default function GarmentArt({ code, name, nameKm, kind, tint, variant, label, brand = 'AF', style }) {
  variant = variant || chosenArt;
  const key = kind || garmentKey(code, name, nameKm); const g = G[key]; const base = tint || DEFAULT[key];
  const id = React.useRef(`ga${++uid}`).current; const gold = '#e6c77a'; const light = lum(base) > 0.62;
  const stage = { transform: 'translate(20.5 11) scale(.72)' };
  const common = { className: 'art', viewBox: '0 0 120 90', preserveAspectRatio: 'xMidYMid slice', style: { display: 'block', width: '100%', height: '100%', ...style }, 'aria-hidden': true };

  if (variant === 'swatch') {
    const pat = PATTERN[key]; const ink = light ? '#1c1814' : gold; const wv = light ? 'rgba(0,0,0,.09)' : 'rgba(255,255,255,.10)';
    return (
      <svg {...common}>
        <defs>
          <pattern id={`${id}p`} width={pat === 'pin' ? 5 : pat === 'oxford' ? 3 : pat === 'rib' ? 3 : pat === 'grain' ? 4 : pat === 'dots' ? 6 : 6} height={pat === 'pin' ? 4 : pat === 'oxford' ? 3 : pat === 'rib' ? 3 : pat === 'grain' ? 4 : 6} patternUnits="userSpaceOnUse" patternTransform={pat === 'repp' ? 'rotate(35)' : undefined}>
            {pat === 'herring' && <path d="M0 6L3 0L6 6" fill="none" stroke={wv} strokeWidth=".9" />}
            {pat === 'pin' && <path d="M0 0V4" stroke={light ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.24)'} strokeWidth=".5" />}
            {pat === 'oxford' && <><rect width="1.5" height="1.5" fill={wv} /><rect x="1.5" y="1.5" width="1.5" height="1.5" fill={wv} /></>}
            {pat === 'repp' && <rect width="6" height="2.4" fill={wv} />}
            {pat === 'rib' && <path d="M1.5 0V3" stroke={wv} strokeWidth=".9" />}
            {pat === 'grain' && <><circle cx="1" cy="1" r=".5" fill={wv} /><circle cx="3" cy="3" r=".4" fill={wv} /></>}
            {pat === 'dots' && <circle cx="3" cy="3" r=".7" fill={wv} />}
          </pattern>
          <radialGradient id={`${id}v`} cx=".5" cy=".45" r=".75"><stop offset=".55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".38" /></radialGradient>
        </defs>
        <rect width="120" height="90" fill={base} /><rect width="120" height="90" fill={`url(#${id}p)`} /><rect width="120" height="90" fill={`url(#${id}v)`} />
        <rect x="4" y="4" width="112" height="82" fill="none" stroke={ink} strokeOpacity=".55" strokeWidth=".5" />
        <g transform="translate(20.5 11) scale(.72)"><Shapes g={g} key_={key} mode="line" stroke={ink} sw="1.9" detail={ink} dw="1.5" /></g>
      </svg>
    );
  }
  if (variant === 'studio') {
    const dark = false;
    return (
      <svg {...common}>
        <defs>
          <radialGradient id={`${id}b`} cx=".5" cy=".4" r=".85"><stop offset="0" stopColor="var(--studio-hi, #f6f2ea)" /><stop offset="1" stopColor="var(--studio-lo, #d9d0bd)" /></radialGradient>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={mix(base, '#fff', .22)} /><stop offset=".55" stopColor={base} /><stop offset="1" stopColor={mix(base, '#000', .28)} /></linearGradient>
          <radialGradient id={`${id}s`}><stop offset="0" stopColor="#000" stopOpacity=".32" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
        </defs>
        <rect width="120" height="90" fill={`url(#${id}b)`} />
        <ellipse cx="60" cy="80" rx="30" ry="3.6" fill={`url(#${id}s)`} />
        {HANGABLE.has(key) && <g stroke="#6d6252" fill="none" strokeWidth="1.1" strokeLinecap="round"><path d="M60 3.5V6.5" /><path d="M60 3.5Q60 1 62.5 1Q65 1 65 3" /></g>}
        <g transform="translate(15 5) scale(.88)"><Shapes g={g} key_={key} mode="fill" fill={`url(#${id}g)`} detail={light ? 'rgba(0,0,0,.30)' : 'rgba(0,0,0,.42)'} dw="1.1" /></g>
      </svg>
    );
  }
  const deep = mix(base, '#000', light ? .78 : .5); const deeper = mix(base, '#000', .8);
  return (
    <svg {...common}>
      <defs><radialGradient id={`${id}m`} cx=".5" cy=".4" r=".8"><stop offset="0" stopColor={deep} /><stop offset="1" stopColor={deeper} /></radialGradient></defs>
      <rect width="120" height="90" fill={`url(#${id}m)`} />
      <rect x="5" y="5" width="110" height="80" fill="none" stroke={gold} strokeOpacity=".7" strokeWidth=".6" /><rect x="8" y="8" width="104" height="74" fill="none" stroke={gold} strokeOpacity=".35" strokeWidth=".4" />
      <text x="60" y="52" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontSize="40" fontWeight="500" fill={gold} fillOpacity=".92" letterSpacing="2">{brand}</text>
      <path d="M36 60H55M65 60H84" stroke={gold} strokeOpacity=".7" strokeWidth=".5" /><path d="M60 57.6L62.4 60L60 62.4L57.6 60Z" fill={gold} fillOpacity=".9" />
      <text x="60" y="73" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontSize="6.4" letterSpacing="2.6" fill={gold} fillOpacity=".85">{label || NAMES[key]}</text>
    </svg>
  );
}

let chosenArt = 'studio';
try { const v = globalThis.localStorage?.getItem('af_art_style'); if (ART_STYLES.includes(v)) chosenArt = v; } catch { /* ignore */ }
export const getArtStyle = () => chosenArt;
export const setArtStyle = (v) => { chosenArt = ART_STYLES.includes(v) ? v : 'studio'; try { globalThis.localStorage?.setItem('af_art_style', chosenArt); } catch { /* ignore */ } };
