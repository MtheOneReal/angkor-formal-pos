import React from 'react';
import { ICONS } from './garmentPaths.js';

// Default pictures for products that have no photo yet: menswear line icons.
// Ink colour follows the theme (--icon-ink): dark ink on light screens, cream ink on the dark theme.
export const G = ICONS;
export const GARMENT_KEYS = Object.keys(ICONS);

const BY_CODE = { S: 'suit', B: 'blazer', T: 'trousers', H: 'shirt', A: 'tie' };
const WORDS = [
  [/bow\s*tie/, 'bowtie'], [/neck\s*tie|\btie\s*clip|tie\s*bar/, 'tieclip'], [/\btie/, 'tie'], [/sock|stocking/, 'socks'], [/belt/, 'belt'], [/shoe|loafer|oxford|boot/, 'shoes'],
  [/waistcoat|vest|gilet/, 'waistcoat'], [/over\s*coat|\bcoat|trench/, 'blazer'], [/pocket/, 'pocket'], [/cuff/, 'cufflink'], [/lapel|brooch|pin\b/, 'lapel'],
  [/suspender|brace/, 'suspenders'], [/bag|briefcase|case/, 'bag'], [/tux/, 'suit'],
  [/blazer|jacket/, 'blazer'], [/trouser|pant|chino|jean|short/, 'trousers'], [/shirt|polo|tee|blouse/, 'shirt'], [/suit/, 'suit'],
  [/ខោ/, 'trousers'], [/អាវធំ/, 'blazer'], [/ឈុត/, 'suit'], [/អាវ/, 'shirt'], [/ក្រវ៉ាត់/, 'tie'], [/ស្រោមជើង/, 'socks'], [/ខ្សែក្រវ៉ាត់/, 'belt'], [/ស្បែកជើង/, 'shoes'],
];
export function garmentKey(code, nameEn, nameKm) {
  const text = `${nameEn || ''} ${nameKm || ''}`.toLowerCase();
  for (const [re, k] of WORDS) if (re.test(text)) return k;
  return BY_CODE[String(code || '').toUpperCase()] || 'suit';
}

export default function GarmentIcon({ code, name, nameKm, kind, size = 56, style }) {
  const key = kind || garmentKey(code, name, nameKm);
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true" style={style}>
      <path d={ICONS[key] || ICONS.suit} fill="var(--icon-ink, currentColor)" fillRule="evenodd" />
    </svg>
  );
}
