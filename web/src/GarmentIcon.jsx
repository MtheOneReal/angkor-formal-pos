import React from 'react';

// Default pictures for products that have no photo yet.
// "Atelier" style: fine monoline tailoring drawings in champagne gold (dark theme) or bronze ink (light theme),
// drawn as left half + mirror so every garment is perfectly symmetric. No clip-art colours, no thick strokes.
// Keys per drawing: s = outline (mirrored), f = fine detail (mirrored), t = stitching (mirrored),
// S / F = outline / detail drawn once (not mirrored), D = small round buttons [x, y, r].
const G = {
  blazer: {
    s: ['M41 11L26 17Q21 19 20 25L14 71Q14 74 17 74.5L27 76L31 42Q34 56 34 63L33 84Q33 86 36 86H48'],
    f: ['M41 11L33 25L37 28L29 31L40 46L48 52', 'M44 15L48 44', 'M34 63L30 62', 'M35 66H43V69H35Z', 'M33 76H42', 'M17.5 66.5L26 68.5'],
    t: ['M23 24L18 68', 'M33.5 70L33 82'],
    S: [], F: ['M54 53H62V56H54Z'], D: [[48, 54, 1.5], [48, 66, 1.5]],
  },
  suit: {
    s: ['M41 11L26 17Q21 19 20 25L14 71Q14 74 17 74.5L27 76L31 42Q34 56 34 63L33 84Q33 86 36 86H48'],
    f: ['M41 11L33 25L37 28L29 31L40 46L48 52', 'M44 15L48 44', 'M35 66H43V69H35Z', 'M33 76H42', 'M17.5 66.5L26 68.5', 'M41 12L44 21L48 25'],
    t: ['M23 24L18 68', 'M33.5 70L33 82'],
    S: ['M45.5 26.5L48 24L50.5 26.5L49 30H47Z', 'M47 30L45 48L48 54L51 48L49 30'], F: [], D: [[48, 62, 1.5]],
  },
  shirt: {
    s: ['M38 11L25 19Q21 21 20 27L14 72L26 75L30 45L31 85Q31 88 35 88H48'],
    f: ['M38 11L36 26L48 33', 'M38 11Q43 8 48 8.5', 'M45 34V88', 'M15.5 64.5L27.2 66.8'],
    t: ['M31 32L30 44', 'M42.5 36V86'],
    S: [], F: ['M33 49H42V59L37.5 61L33 59Z'], D: [[48, 41, 1.3], [48, 52, 1.3], [48, 63, 1.3], [48, 74, 1.3], [48, 84, 1.3]],
  },
  trousers: {
    s: ['M48 11H28L21 88H37L48 40'],
    f: ['M28 11V20H48', 'M33 10V21', 'M48 20V38', 'M29 21Q34 25 37 34', 'M40 20Q40 27 38 31', 'M34 40L29.5 86'],
    t: ['M30.5 22L29 85', 'M47 22V36'],
    S: [], F: [], D: [[44.5, 15.5, 1.2]],
  },
  tie: {
    s: ['M48 9H40.5L38 14L41 24L34 68L48 88'],
    f: ['M41 24H48', 'M48 24V88', 'M38.5 15H48', 'M39.5 38L48 43', 'M37 56L48 62'],
    t: [], S: [], F: [], D: [],
  },
  bowtie: {
    s: ['M43 38L21 28Q17 26.5 16.5 31L16 61Q17 65 21 63L43 54'],
    f: ['M27 33Q24 46 27 58', 'M33 35Q30 46 33 56', 'M43 38V54'],
    t: [], S: ['M43 39H53V53H43Z'], F: ['M44 42H52'], D: [],
  },
  socks: {
    s: [], f: [], t: [],
    S: ['M34 9H58V50Q58 56 62 60L77 71Q83 77 79 83Q75 87 68 85L44 75Q34 71 34 60Z'],
    F: ['M34 16H58', 'M34 21H58', 'M34 26H58', 'M37 62Q40 70 47 72', 'M70 77L74 72'], D: [],
  },
  belt: {
    s: ['M6 41H36'], f: ['M6 55H36', 'M36 41V55'], t: ['M6 44H34', 'M6 52H34'],
    S: ['M36 33H60Q62 33 62 35V61Q62 63 60 63H36Q34 63 34 61V35Q34 33 36 33Z', 'M42 39H56V57H42Z', 'M62 41H90V55H62'],
    F: ['M42 48H55', 'M62 44H88', 'M62 52H88'], D: [[67, 48, 1.3], [74, 48, 1.3], [81, 48, 1.3]],
  },
  shoes: {
    s: [], f: [], t: [],
    S: ['M9 52L11 40Q11 36 15 36H23Q26 44 36 46L58 52Q72 56 82 62Q89 65 88 72V74Q88 77 85 77H12Q9 77 9 74Z'],
    F: ['M9 70H88', 'M9 66V77', 'M31 42L35 48', 'M37 44L41 50', 'M43 46L47 51', 'M62 54Q68 62 70 70', 'M20 38H17'],
    D: [[66, 60, .9], [71, 63, .9], [74, 67, .9], [63, 66, .9]],
  },
  waistcoat: {
    s: ['M37 10L27 15Q24 28 25 40L27 76Q28 80 32 82L48 90'],
    f: ['M37 10L48 44', 'M29 62H38', 'M29 70H38'],
    t: ['M30 22Q29 34 30 42'], S: [], F: [], D: [[48, 52, 1.4], [48, 61, 1.4], [48, 70, 1.4], [48, 79, 1.4]],
  },
  coat: {
    s: ['M41 9L26 15Q21 17 20 23L13 77L24 80L30 46L28 91H48'],
    f: ['M41 9L35 22L28 24L34 33L42 52L48 58', 'M44 14L48 50', 'M31 68H42', 'M31 76H42', 'M14.5 70L25 72.5'],
    t: ['M23 24L17 72'], S: [], F: [], D: [[48, 62, 1.6], [48, 74, 1.6]],
  },
  cufflink: {
    s: [], f: [], t: [], S: [], F: [],
    D: [],
    extra: true,
  },
  pocket: {
    s: [], f: [], t: [],
    S: ['M14 76V45Q14 43 16 43H80Q82 43 82 45V76Q82 78 80 78H16Q14 78 14 76Z', 'M20 43L31 27L39 43L48 24L57 43L65 27L76 43'],
    F: ['M14 53H82', 'M20 70L28 60', 'M68 70L76 60'], D: [],
  },
  hanger: {
    s: [], f: [], t: [],
    S: ['M48 31L9 57Q5 60 8 63Q9 64 11 64H85Q87 64 88 63Q91 60 87 57Z'],
    F: ['M48 31V27Q48 21 54 21Q59 21 59 15Q59 9 52 9Q46 9 46 15'], D: [],
  },
};
export const GARMENT_KEYS = Object.keys(G);

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

let uid = 0;
export default function GarmentIcon({ code, name, nameKm, kind, size = 56, style }) {
  const key = kind || garmentKey(code, name, nameKm); const g = G[key]; const id = React.useRef(`gi${++uid}`).current;
  const base = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', stroke: `url(#${id})` };
  const half = (
    <>
      {(g.s || []).map((d, i) => <path key={`s${i}`} d={d} {...base} strokeWidth="1.5" fill={`url(#${id}f)`} />)}
      {(g.f || []).map((d, i) => <path key={`f${i}`} d={d} {...base} strokeWidth="1" />)}
      {(g.t || []).map((d, i) => <path key={`t${i}`} d={d} {...base} strokeWidth=".8" strokeDasharray="1.6 1.8" />)}
    </>
  );
  const mirrored = (g.s?.length || g.f?.length || g.t?.length);
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true" style={style}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="0" y2="92"><stop offset="0" stopColor="var(--icon-hi, currentColor)" /><stop offset="1" stopColor="var(--icon-lo, currentColor)" /></linearGradient>
        <linearGradient id={`${id}f`} gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="0" y2="92"><stop offset="0" stopColor="var(--icon-hi, currentColor)" stopOpacity=".16" /><stop offset="1" stopColor="var(--icon-lo, currentColor)" stopOpacity=".04" /></linearGradient>
      </defs>
      {mirrored ? (<><g>{half}</g><g transform="translate(96 0) scale(-1 1)">{half}</g></>) : null}
      {(g.S || []).map((d, i) => <path key={`S${i}`} d={d} {...base} strokeWidth="1.5" fill={`url(#${id}f)`} />)}
      {(g.F || []).map((d, i) => <path key={`F${i}`} d={d} {...base} strokeWidth="1" />)}
      {(g.D || []).map(([x, y, r], i) => <circle key={`D${i}`} cx={x} cy={y} r={r} fill={`url(#${id})`} />)}
      {g.extra && key === 'cufflink' && [[27, 48], [69, 48]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="14" {...base} strokeWidth="1.5" fill={`url(#${id}f)`} />
          <circle cx={x} cy={y} r="9.5" {...base} strokeWidth="1" />
          <circle cx={x} cy={y} r="3.2" {...base} strokeWidth="1" />
          <path d={`M${x} ${y - 9.5}V${y - 3.2}M${x} ${y + 3.2}V${y + 9.5}M${x - 9.5} ${y}H${x - 3.2}M${x + 3.2} ${y}H${x + 9.5}`} {...base} strokeWidth=".8" />
        </g>))}
    </svg>
  );
}
