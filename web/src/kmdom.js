// Shows Khmer for any on-screen English phrase that has an entry in km.js, and puts the English back when the language is switched.
import { KM } from './km.js';

const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
const textOrig = new WeakMap(); // text node -> { en, km }
const attrOrig = new WeakMap(); // element -> { attr: { en, km } }
let obs = null; let busy = false;

const lookup = (s) => {
  const k = s.replace(/\s+/g, ' ').trim(); const v = KM[k];
  return v ? s.replace(s.trim(), v) : null;
};

function doText(n) {
  const rec = textOrig.get(n); const cur = n.nodeValue;
  if (rec && rec.km === cur) return; // already translated by us
  const v = lookup(cur); if (v === null || v === cur) { if (rec) textOrig.delete(n); return; }
  textOrig.set(n, { en: cur, km: v }); n.nodeValue = v;
}
function doAttrs(el) {
  for (const a of ATTRS) {
    const cur = el.getAttribute?.(a); if (!cur) continue;
    const rec = attrOrig.get(el)?.[a]; if (rec && rec.km === cur) continue;
    const v = lookup(cur); if (v === null || v === cur) continue;
    const o = attrOrig.get(el) || {}; o[a] = { en: cur, km: v }; attrOrig.set(el, o); el.setAttribute(a, v);
  }
}
function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.tagName)) return;
  doAttrs(root);
  for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
}
function restore(root) {
  if (!root) return;
  if (root.nodeType === 3) { const r = textOrig.get(root); if (r && root.nodeValue === r.km) root.nodeValue = r.en; textOrig.delete(root); return; }
  if (root.nodeType !== 1) return;
  const o = attrOrig.get(root); if (o) { for (const [a, r] of Object.entries(o)) if (root.getAttribute(a) === r.km) root.setAttribute(a, r.en); attrOrig.delete(root); }
  for (let c = root.firstChild; c; c = c.nextSibling) restore(c);
}

export function setKhmerDom(on) {
  if (typeof document === 'undefined') return;
  if (!on) { if (obs) { obs.disconnect(); obs = null; } busy = true; restore(document.body); busy = false; return; }
  if (obs) return;
  busy = true; walk(document.body); busy = false;
  obs = new MutationObserver((list) => {
    if (busy) return; busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach((n) => walk(n));
      }
    } finally { busy = false; }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
