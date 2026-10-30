// Which size groups a product type uses. The owner's saved choice wins; otherwise a sensible default from the type's name.
export function defaultGroups(typeName, groupNames) {
  const n = String(typeName || '').toLowerCase(); const has = (g) => groupNames.find((x) => x.toLowerCase() === g);
  const pick = (...gs) => gs.map(has).filter(Boolean);
  let out = null;
  if (/suit|blazer|jacket|coat|vest|waistcoat/.test(n)) out = pick('suit', 'length');
  else if (/trouser|pant|short|jean/.test(n)) out = pick('waist', 'length');
  else if (/shirt|polo|tee|t-shirt|top/.test(n)) out = pick('shirt');
  else if (/accessor|tie|belt|sock|scarf|cufflink|shoe/.test(n)) out = pick('one size');
  return out && out.length ? out : groupNames;
}
export function groupsFor(type, groupNames, typeGroups) {
  const saved = typeGroups && typeGroups[type?.code];
  const ok = Array.isArray(saved) ? saved.filter((g) => groupNames.includes(g)) : null;
  return ok && ok.length ? ok : defaultGroups(type?.name_en, groupNames);
}
