import React from 'react';

// Default pictures for products that have no photo yet. Three separately drawn sets (each has its own shapes, not just a recolour):
//   rounded = chubby, soft-cornered sticker icons in fabric colours
//   cartoon = hand-inked cartoon line icons: thick black outline, colour slightly off-register
//   fill    = bold single-colour glyphs with cut-out details
export const ICON_STYLES = ['rounded', 'cartoon', 'fill'];

// Fabric colours: [main, shadow, light detail]
const COL = {
  suit: ['#2f4272', '#1b2644', '#eef1f8'], blazer: ['#5a5e69', '#33363e', '#e6e8ec'], trousers: ['#c6aa78', '#8d7450', '#f3ead6'], shirt: ['#f4f5f2', '#a9aea8', '#7f9bc4'],
  tie: ['#a32a3c', '#661522', '#f1d58c'], bowtie: ['#2a2b2e', '#0c0c0d', '#f1d58c'], socks: ['#3a4d7d', '#1f2b48', '#eef1f8'], belt: ['#7d522b', '#47290f', '#f1d58c'],
  shoes: ['#7d522b', '#3f2410', '#e9d3b8'], waistcoat: ['#6c717d', '#3c4049', '#eceef2'], coat: ['#c29561', '#8a6638', '#f5e6cf'], cufflink: ['#e3bd68', '#a8832f', '#fff3cf'],
  pocket: ['#f4f5f2', '#a9aea8', '#c7384a'], hanger: ['#b98558', '#7c5530', '#f5e6cf'],
};

// ---------- ROUNDED ----------
const JR = 'M21 8Q32 16 43 8L52 12Q58 14 58 20L56 42Q56 46 52 46H49V54Q49 59 44 59H20Q15 59 15 54V46H12Q8 46 8 42L6 20Q6 14 12 12Z';
const R = {
  suit: [[JR], ['M32 15L24 31L32 43L40 31Z', 'M32 22V37', 'M32 49h.01', 'M24 50h4M36 50h4']],
  blazer: [[JR], ['M32 15L24 31L32 43L40 31Z', 'M32 43V59', 'M32 49h.01', 'M23 50h4M37 50h4']],
  trousers: [['M19 7H45Q49 7 49 11L51 53Q51 58 46 58H39Q35 58 34.5 54L32 32L29.5 54Q29 58 25 58H18Q13 58 13 53L15 11Q15 7 19 7Z'], ['M15 14H49', 'M32 14V30', 'M21 17L24 24', 'M43 17L40 24']],
  shirt: [['M22 8Q32 15 42 8L52 12Q58 14 57 20L55 42Q55 46 51 46H49V54Q49 59 44 59H20Q15 59 15 54V46H13Q9 46 9 42L7 20Q6 14 12 12Z'], ['M22 8L28 20L32 16L36 20L42 8', 'M32 20V58', 'M32 28h.01M32 37h.01M32 46h.01', 'M9 40H15M55 40H49']],
  tie: [['M26 6H38Q40 6 39.5 9L38 15H26L24.5 9Q24 6 26 6Z', 'M27 17H37L42 48Q42.5 51 40.5 53L33.5 59Q32 60 30.5 59L23.5 53Q21.5 51 22 48Z'], ['M27 29H37', 'M26 39H38']],
  bowtie: [['M30 32L11 21Q7 19 7 23V41Q7 45 11 43Z', 'M34 32L53 21Q57 19 57 23V41Q57 45 53 43Z', 'M26 26H38Q40 26 40 28V36Q40 38 38 38H26Q24 38 24 36V28Q24 26 26 26Z'], ['M15 27L21 32L15 37', 'M49 27L43 32L49 37']],
  socks: [['M23 6Q23 4 25 4H39Q41 4 41 6V30L53 38Q58 42 56 48Q54 54 48 53Q44 52 40 49L27 41Q23 38 23 32Z'], ['M23 12H41', 'M23 18H41']],
  belt: [['M7 24H57Q60 24 60 27V37Q60 40 57 40H7Q4 40 4 37V27Q4 24 7 24Z', 'M24 20H40Q42 20 42 22V42Q42 44 40 44H24Q22 44 22 42V22Q22 20 24 20Z'], ['M28 28H36V36H28Z', 'M48 32h.01M54 32h.01']],
  shoes: [['M5 38V27Q5 24 8 24H15Q19 33 29 34L45 37Q60 40 60 49V53Q60 55 58 55H7Q5 55 5 53Z'], ['M5 48H60', 'M21 28L25 31', 'M27 27L31 31', 'M10 30H13']],
  waistcoat: [['M20 6L32 20L44 6Q47 5 48 8L52 14Q53 16 52.5 18L49 54Q48.5 59 44 59H20Q15.5 59 15 54L11.5 18Q11 16 12 14L16 8Q17 5 20 6Z'], ['M32 20V30', 'M32 34h.01M32 42h.01M32 50h.01', 'M19 48H26M45 48H38']],
  coat: [['M21 6Q32 14 43 6L53 11Q58 13 58 19L57 48Q57 52 53 52H50L52 57Q52.5 60 49 60H15Q11.5 60 12 57L14 52H11Q7 52 7 48L6 19Q6 13 11 11Z'], ['M32 14L24 32L32 46L40 32Z', 'M32 46V60', 'M32 52h.01', 'M22 52H27M37 52H42']],
  cufflink: [['M9 24a12 12 0 1 0 24 0a12 12 0 1 0 -24 0', 'M38 42a9 9 0 1 0 18 0a9 9 0 1 0 -18 0'], ['M21 24h.01', 'M47 42h.01', 'M30 31L40 36']],
  pocket: [['M8 50V26Q8 24 10 22L16 17Q17 16 19 16H45Q47 16 48 17L54 22Q56 24 56 26V50Q56 54 52 54H12Q8 54 8 50Z'], ['M8 26H56', 'M16 26L24 38L32 25L40 38L48 26']],
  hanger: [['M32 25L9 42Q4 46 8 51Q9 52 11 52H53Q55 52 56 51Q60 46 55 42Z'], ['M32 25V21A5 5 0 1 0 27 16']],
};

// ---------- CARTOON ----------
const JC = 'M23 7L32 14L41 7L56 12L61 43L51 46L48 26V57H16V26L13 46L3 43L8 12Z';
const C = {
  suit: [[JC], ['M32 14L21 32L32 47L43 32Z', 'M32 17L29.5 22L32 41L34.5 22Z', 'M32 52a2.4 2.4 0 1 0 .01 0', 'M20 50H26M38 50H44']],
  blazer: [[JC], ['M32 14L21 32L32 47L43 32Z', 'M32 47V57', 'M32 52a2.4 2.4 0 1 0 .01 0', 'M20 50H26M38 50H44', 'M36 30L38 27L42 27L42 30']],
  trousers: [['M16 5H48L52 59H36L32 27L28 59H12Z'], ['M16 12H48', 'M32 12V27', 'M18 14L23 25', 'M46 14L41 25', 'M22 38L21 56']],
  shirt: [['M20 6L32 17L44 6L58 13L61 44L51 47L48 28V58H16V28L13 47L3 44L6 13Z'], ['M20 6L26 22L32 17L38 22L44 6', 'M32 17V58', 'M32 31a2.2 2.2 0 1 0 .01 0', 'M32 41a2.2 2.2 0 1 0 .01 0', 'M32 51a2.2 2.2 0 1 0 .01 0']],
  tie: [['M25 4H39L37 15H27Z', 'M27 15H37L45 49L32 61L19 49Z'], ['M25 28H39', 'M23 38H41', 'M30 9H34']],
  bowtie: [['M31 32L5 16L9 48Z', 'M33 32L59 16L55 48Z', 'M25 25H39V39H25Z'], ['M14 26L22 32L14 38', 'M50 26L42 32L50 38']],
  socks: [['M22 3H42V29L55 36Q60 41 57 47Q53 53 46 51L25 40Q21 36 22 29Z'], ['M22 10L26 13L30 10L34 13L38 10L42 13', 'M47 45L52 43']],
  belt: [['M3 23H61V41H3Z', 'M23 18H41V46H23Z'], ['M29 25H35V39H29Z', 'M47 32a1.8 1.8 0 1 0 .01 0', 'M54 32a1.8 1.8 0 1 0 .01 0', 'M8 28H18']],
  shoes: [['M4 36V20H17Q20 30 30 32L47 35Q61 38 61 48V54H4Z'], ['M4 47H61', 'M20 26L27 31', 'M26 22L33 28', 'M32 20L38 27', 'M9 27H13']],
  waistcoat: [['M17 3L32 22L47 3L54 12L50 59H14L10 12Z'], ['M32 22V59', 'M32 32a2.2 2.2 0 1 0 .01 0', 'M32 42a2.2 2.2 0 1 0 .01 0', 'M32 52a2.2 2.2 0 1 0 .01 0', 'M18 46H26M46 46H38']],
  coat: [['M22 4L32 13L42 4L58 10L62 52L50 55L48 30L50 61H14L16 30L14 55L2 52L6 10Z'], ['M32 13L21 34L32 50L43 34Z', 'M32 50V61', 'M32 55a2.2 2.2 0 1 0 .01 0', 'M20 52H26M38 52H44']],
  cufflink: [['M8 22a13 13 0 1 0 26 0a13 13 0 1 0 -26 0', 'M38 42a9 9 0 1 0 18 0a9 9 0 1 0 -18 0'], ['M16 22a5 5 0 1 0 10 0a5 5 0 1 0 -10 0', 'M31 31L40 37', 'M44 42a3 3 0 1 0 6 0a3 3 0 1 0 -6 0']],
  pocket: [['M5 52V22L13 14H51L59 22V52Z'], ['M5 22H59', 'M13 22L22 38L32 20L42 38L51 22']],
  hanger: [['M32 25L5 43Q2 46 5 50H59Q62 46 59 43Z'], ['M32 25V20A5 5 0 1 0 27 15']],
};

// ---------- FILL (single colour, even-odd cut-outs) ----------
const JF = 'M20 6L32 14L44 6L57 14L59 50H48L46 58H18L16 50H5L7 14Z';
const F = {
  suit: [[JF + 'M32 14L24 32L32 44L40 32Z' + 'M32 18L30 22L32 40L34 22Z'], []],
  blazer: [[JF + 'M32 14L24 32L32 44L40 32Z' + 'M33.6 50a1.6 1.6 0 1 0 -3.2 0a1.6 1.6 0 1 0 3.2 0'], []],
  trousers: [['M16 6H48L51 58H36L32 26L28 58H13Z' + 'M31 10H33V24H31Z'], []],
  shirt: [['M20 6L32 14L44 6L57 14L59 50H48V58H16V50H5L7 14Z' + 'M25 8L32 16L39 8L32 24Z' + 'M31 30H33V33H31ZM31 38H33V41H31ZM31 46H33V49H31Z'], []],
  tie: [['M26 4H38L36 14H28ZM28 16H36L42 50L32 60L22 50Z' + 'M27 30H37V32H27ZM26 38H38V40H26Z'], []],
  bowtie: [['M28 32L8 20V44ZM36 32L56 20V44ZM26 26H38V38H26Z'], []],
  socks: [['M22 4H42V30L54 38C58 42 56 50 50 52C46 53 42 51 38 48L26 40C23 38 22 35 22 30Z' + 'M22 11H42V14H22ZM22 17H42V20H22Z'], []],
  belt: [['M4 24H60V40H4Z' + 'M25 28H39V36H25Z' + 'M46 31.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0ZM52 31.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z'], []],
  shoes: [['M4 34V22H16C19 30 24 33 32 33L46 36C54 38 60 42 60 48V52H4Z' + 'M4 44H60V46H4Z'], []],
  waistcoat: [['M17 4L32 20L47 4L53 12L49 58H15L11 12Z' + 'M31 30H33V33H31ZM31 38H33V41H31ZM31 46H33V49H31Z'], []],
  coat: [['M20 5L32 13L44 5L57 13L60 52H49L50 60H14L15 52H4L7 13Z' + 'M32 13L24 34L32 46L40 34Z'], []],
  cufflink: [['M10 22a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z M18 22a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z' + 'M38 42a9 9 0 1 0 18 0a9 9 0 1 0 -18 0Z M44 42a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z'], ['M30 29L40 35']],
  pocket: [['M6 52V22L14 14H50L58 22V52Z' + 'M12 25H52L50 29L42 35L32 25L22 35L14 29Z'], []],
  hanger: [['M32 24L6 42C3 44 5 50 9 50H55C59 50 61 44 58 42Z'], ['M32 24V20A5 5 0 1 0 27 15']],
};

const SETS = { rounded: R, cartoon: C, fill: F };
export const GARMENT_KEYS = Object.keys(R);

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

let chosen = 'rounded';
try { const v = globalThis.localStorage?.getItem('af_icon_style'); if (ICON_STYLES.includes(v)) chosen = v; } catch { /* ignore */ }
export const setIconStyle = (s) => { chosen = ICON_STYLES.includes(s) ? s : 'rounded'; try { globalThis.localStorage?.setItem('af_icon_style', chosen); } catch { /* ignore */ } };

export default function GarmentIcon({ code, name, nameKm, kind, size = 56, variant, style, tint }) {
  const key = kind || garmentKey(code, name, nameKm); const v = variant || chosen;
  const [body, det] = SETS[v][key]; const [main, sh, lt] = COL[key]; const fill = tint || main;
  const rc = { strokeLinecap: 'round', strokeLinejoin: 'round' };
  let inner;
  if (v === 'rounded') {
    inner = (<>
      {body.map((d, i) => <path key={`b${i}`} d={d} fill={fill} stroke={sh} strokeWidth="3" {...rc} />)}
      {det.map((d, i) => <path key={`d${i}`} d={d} fill="none" stroke={lt} strokeWidth={/h\.01/.test(d) ? 4.4 : 2.6} {...rc} />)}
    </>);
  } else if (v === 'cartoon') {
    const ink = '#1d1b19';
    inner = (<g transform="rotate(-3 32 32)">
      {body.map((d, i) => <path key={`f${i}`} d={d} fill={fill} transform="translate(2.6 2.6)" />)}
      {body.map((d, i) => <path key={`o${i}`} d={d} fill="none" stroke={ink} strokeWidth="3" {...rc} />)}
      {det.map((d, i) => <path key={`d${i}`} d={d} fill="none" stroke={ink} strokeWidth="2.4" {...rc} />)}
    </g>);
  } else {
    inner = (<>
      {body.map((d, i) => <path key={`b${i}`} d={d} fill="currentColor" fillRule="evenodd" />)}
      {det.map((d, i) => <path key={`d${i}`} d={d} fill="none" stroke="currentColor" strokeWidth="3.6" {...rc} />)}
    </>);
  }
  return <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={style}>{inner}</svg>;
}
