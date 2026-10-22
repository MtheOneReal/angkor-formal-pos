import React from 'react';

// Default pictures for products that have no photo yet. Simple line drawings that follow the text colour.
const P = {
  suit: <><path d="M22 8l10 6 10-6 10 8-4 12v26H16V28L12 16z" /><path d="M32 14v42M26 8l6 14 6-14" /><circle cx="35" cy="34" r="1.2" /><circle cx="35" cy="42" r="1.2" /><path d="M20 38h6" /></>,
  blazer: <><path d="M21 8l11 8 11-8 9 8-3 14v24H15V30L12 16z" /><path d="M32 16l-8 12 8 28M32 16l8 12-8 28" /><circle cx="30" cy="40" r="1.2" /><path d="M18 44h8" /></>,
  trousers: <><path d="M20 6h24l4 52H35L32 26l-3 32H16z" /><path d="M20 12h24M32 12v14" /></>,
  shirt: <><path d="M22 8l-12 8 6 10 5-3v33h22V23l5 3 6-10-12-8" /><path d="M22 8l10 10 10-10M32 18v38" /><circle cx="32" cy="28" r="1.1" /><circle cx="32" cy="36" r="1.1" /><circle cx="32" cy="44" r="1.1" /></>,
  tie: <><path d="M27 6h10l-2 8h-6z" /><path d="M29 14l-4 34 7 10 7-10-4-34" /><path d="M29 22h6" /></>,
  bowtie: <><path d="M32 32L12 20v24zM32 32l20-12v24z" /><rect x="28" y="27" width="8" height="10" rx="2" /></>,
  socks: <><path d="M24 6h16v24l12 10c3 3 1 10-4 10-3 0-5-1-8-3L26 38c-2-2-2-4-2-8z" /><path d="M24 14h16" /></>,
  belt: <><rect x="6" y="26" width="52" height="12" rx="3" /><rect x="24" y="23" width="14" height="18" rx="2" /><path d="M31 28v8M46 32h.01M52 32h.01" /></>,
  shoe: <><path d="M6 40V26l10 4 8-6 6 6h14c8 0 14 4 14 10v4H6z" /><path d="M6 44h52M24 24l-2-8h-6" /></>,
  vest: <><path d="M20 8l12 14 12-14 6 8-4 40H18L14 16z" /><path d="M32 22v34" /><circle cx="35" cy="32" r="1.1" /><circle cx="35" cy="40" r="1.1" /><circle cx="35" cy="48" r="1.1" /></>,
  coat: <><path d="M20 6l12 10 12-10 10 10-4 16 2 26H14l2-26-4-16z" /><path d="M32 16v42M26 6l6 14 6-14" /><circle cx="36" cy="34" r="1.2" /><circle cx="36" cy="44" r="1.2" /></>,
  pocket: <><path d="M10 50V26l8-6h28l8 6v24z" /><path d="M20 26l6 10 6-14 6 14 6-10" /></>,
  cufflink: <><circle cx="22" cy="32" r="10" /><circle cx="42" cy="32" r="6" /><path d="M32 32h4" /><circle cx="22" cy="32" r="4" /></>,
  hat: <><path d="M12 40c0-12 8-24 20-24s20 12 20 24z" /><path d="M6 44h52" /><path d="M14 40h36" /></>,
  scarf: <><path d="M14 10c10 4 26 4 36 0v12c-10 4-26 4-36 0z" /><path d="M24 24v30l5-4 5 4V24M38 22v26l5-4 5 4V22" /></>,
  wallet: <><rect x="8" y="16" width="48" height="34" rx="5" /><path d="M8 26h48" /><rect x="40" y="32" width="16" height="10" rx="3" /><circle cx="46" cy="37" r="1.2" /></>,
  hanger: <><path d="M32 22v-4a5 5 0 1 0-5-5" /><path d="M32 22L8 42c-3 2-1 6 2 6h44c3 0 5-4 2-6z" /></>,
};

// Which drawing for which product type. Matches the type code first, then the type's name.
const BY_CODE = { S: 'suit', B: 'blazer', T: 'trousers', H: 'shirt', A: 'tie' };
const WORDS = [
  [/bow\s*tie/, 'bowtie'], [/neck\s*tie|\btie/, 'tie'], [/sock|stocking/, 'socks'], [/belt/, 'belt'], [/shoe|loafer|oxford|boot/, 'shoe'],
  [/waistcoat|vest|gilet/, 'vest'], [/over\s*coat|\bcoat|trench/, 'coat'], [/pocket/, 'pocket'], [/cuff/, 'cufflink'], [/\bhat|cap\b/, 'hat'],
  [/scarf/, 'scarf'], [/wallet/, 'wallet'], [/blazer|jacket/, 'blazer'], [/trouser|pant|chino|jean|short/, 'trousers'], [/shirt|polo|tee|blouse/, 'shirt'], [/suit|tuxedo|tux/, 'suit'],
  [/ខោ/, 'trousers'], [/អាវធំ/, 'blazer'], [/ឈុត/, 'suit'], [/អាវ/, 'shirt'], [/ក្រវ៉ាត់/, 'tie'], [/ស្រោមជើង/, 'socks'], [/ខ្សែក្រវ៉ាត់/, 'belt'], [/ស្បែកជើង/, 'shoe'],
];
export function garmentKey(code, nameEn, nameKm) {
  const text = `${nameEn || ''} ${nameKm || ''}`.toLowerCase();
  for (const [re, k] of WORDS) if (re.test(text)) return k;
  return BY_CODE[String(code || '').toUpperCase()] || 'hanger';
}

export default function GarmentIcon({ code, name, nameKm, size = 56, style }) {
  const k = garmentKey(code, name, nameKm);
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.7, ...style }}>
      {P[k]}
    </svg>
  );
}
