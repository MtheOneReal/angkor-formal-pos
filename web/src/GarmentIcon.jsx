import React from 'react';

// Default pictures for products that have no photo yet.
// Bold, even-weight outline icons (one line weight, rounded ends, light fill), the look used by classic menswear icon sets.
// Each drawing is a left half + mirror so garments are perfectly symmetric.
//   s = outline (mirrored)   f = inner detail lines (mirrored)   S / F = outline / detail drawn once   D = round buttons [x, y, r]
const JACKET = 'M40 10L25 15Q21 17 20 22L14 70Q14 73 17 73L26 74L30 38L31 78Q31 82 34 83.5Q38 86 40 86';
export const G = {
  blazer: {
    s: [JACKET],
    f: ['M40 10L33 24L37 27L29 30L42 50L48 54', 'M43 13L47 44', 'M47 54Q47 74 40 86', 'M32.5 63H42V69H32.5Z'],
    S: [], F: ['M54 35H63V39H54Z'], D: [[48, 58, 1.8]],
  },
  suit: {
    s: [JACKET],
    f: ['M40 10L33 24L37 27L29 30L42 50L48 54', 'M43 13L47 24', 'M47 54Q47 74 40 86', 'M32.5 63H42V69H32.5Z'],
    S: ['M45.5 26L48 23L50.5 26L49 31H47Z', 'M47 31L45.5 46L48 52L50.5 46L49 31'], F: ['M54 35H63V39H54Z'], D: [[48, 60, 1.8]],
  },
  shirt: {
    s: ['M39 12L26 18Q21 20 20 26L14 70Q14 73 17 73L27 75L31 42L31 82Q32 87 38 87Q43 88 48 88'],
    f: ['M39 12L35 25L48 33', 'M39 12Q43 10 48 10.5', 'M44 34V88', 'M14.5 64L27 66.5'],
    S: [], F: [], D: [[48, 42, 1.7], [48, 53, 1.7], [48, 64, 1.7], [48, 75, 1.7]],
  },
  trousers: {
    s: ['M48 11H27L22 88H38L48 38'],
    f: ['M27 19H48', 'M44 19V30Q44 33 48 33', 'M28 20Q32 23 35 31', 'M35 46L33.5 86'],
    S: [], F: [], D: [[44, 15, 1.4]],
  },
  tie: {
    s: ['M37 8L27 18L36 25L43 21', 'M48 17L43 21L45 30L38 70L48 87'],
    f: ['M45 30H48'],
    S: [], F: [], D: [],
  },
  bowtie: {
    s: ['M44 41Q32 31 18 31Q14 31 14 36V58Q14 63 18 63Q32 63 44 54'],
    f: ['M41 44.5L28 42.5', 'M41 48H26', 'M41 51.5L28 53.5'],
    S: ['M45 39H51Q53 39 53 41V53Q53 55 51 55H45Q43 55 43 53V41Q43 39 45 39Z'], F: [], D: [],
  },
  socks: {
    s: [], f: [], 
    S: ['M33 9H59V50Q59 56 63 60L77 71Q83 77 79 83Q75 87 68 85L44 76Q33 72 33 60Z'],
    F: ['M33 18H59', 'M38 62Q41 70 48 73'], D: [],
  },
  belt: {
    s: ['M6 40H34'], f: ['M6 56H34'],
    S: ['M34 32H62V64H34Z', 'M62 40H90V56H62Z'],
    F: ['M41 39H55V57H41Z', 'M41 48H56'], D: [[69, 48, 1.7], [76, 48, 1.7], [83, 48, 1.7]],
  },
  shoes: {
    s: [], f: [],
    S: ['M9 56L10 40Q10 36 14 36H22Q25 44 34 46L56 51Q70 54 82 60Q88 63 88 69V72Q88 75 85 75H12Q9 75 9 72Z'],
    F: ['M9 67H88', 'M26 67V75', 'M29 41L35 48', 'M35 43L41 50', 'M41 45L47 52', 'M61 52Q68 60 70 67', 'M14 38Q17 43 22 44'],
    D: [[66, 58, 1.2], [72, 61, 1.2], [69, 64, 1.2], [75, 65, 1.2]],
  },
  waistcoat: {
    s: ['M39 10L28 13Q25 27 26 42L28 74Q28 79 32 81L48 90'],
    f: ['M39 10L48 44', 'M30 62H40V66H30Z'],
    S: [], F: [], D: [[48, 52, 1.8], [48, 61, 1.8], [48, 70, 1.8], [48, 79, 1.8]],
  },
  coat: {
    s: ['M40 9L25 14Q20 16 19 22L12 78Q12 81 15 81L25 83L30 40L29 90L48 90'],
    f: ['M40 9L32 24L36 27L28 30L42 52L48 57', 'M43 12L47 46', 'M32 66H43V72H32Z'],
    S: [], F: ['M54 36H63V40H54Z'], D: [[48, 62, 1.8], [48, 74, 1.8]],
  },
  cufflink: {
    s: [], f: [], S: [], F: [], D: [], extra: true,
  },
  pocket: {
    s: [], f: [],
    S: ['M14 76V45Q14 43 16 43H80Q82 43 82 45V76Q82 78 80 78H16Q14 78 14 76Z', 'M20 43L31 27L39 43L48 24L57 43L65 27L76 43'],
    F: ['M14 54H82'], D: [],
  },
  hanger: {
    s: [], f: [],
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

const INK = 'var(--icon-ink, currentColor)';
const PAPER = 'var(--icon-paper, transparent)';
export default function GarmentIcon({ code, name, nameKm, kind, size = 56, style }) {
  const key = kind || garmentKey(code, name, nameKm); const g = G[key];
  const line = { stroke: INK, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const half = (
    <>
      {(g.s || []).map((d, i) => <path key={`s${i}`} d={d} {...line} fill={PAPER} strokeWidth="3.2" />)}
      {(g.f || []).map((d, i) => <path key={`f${i}`} d={d} {...line} fill="none" strokeWidth="2.6" />)}
    </>
  );
  const mirrored = (g.s?.length || g.f?.length);
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true" style={style}>
      {mirrored ? (<><g>{half}</g><g transform="translate(96 0) scale(-1 1)">{half}</g></>) : null}
      {(g.S || []).map((d, i) => <path key={`S${i}`} d={d} {...line} fill={PAPER} strokeWidth="3.2" />)}
      {(g.F || []).map((d, i) => <path key={`F${i}`} d={d} {...line} fill="none" strokeWidth="2.6" />)}
      {(g.D || []).map(([x, y, r], i) => <circle key={`D${i}`} cx={x} cy={y} r={r} fill={INK} />)}
      {key === 'cufflink' && (
        <g>
          <circle cx="32" cy="46" r="17" {...line} fill={PAPER} strokeWidth="3.2" />
          <circle cx="32" cy="46" r="10" {...line} fill="none" strokeWidth="2.6" />
          <circle cx="32" cy="46" r="3" fill={INK} />
          <ellipse cx="62" cy="46" rx="5" ry="14" {...line} fill={PAPER} strokeWidth="3.2" />
          <path d="M67 46H84M84 37V55" {...line} fill="none" strokeWidth="3.2" />
        </g>
      )}
    </svg>
  );
}
