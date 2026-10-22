// Pure helpers (no Firebase imports) so they can be tested on their own.

// Same rule the app uses to turn a cashier's PIN into their sign-in password.
export const tillPassword = (pin, storeCode) => `${pin}-${storeCode}-af`;

// Today's date in Phnom Penh (UTC+7), as YYYY-MM-DD.
export const phnomPenhDate = (now = Date.now()) => new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);

const usd = (c) => `$${((c || 0) / 100).toFixed(2)}`;

// stores: [{id,name,active,kind}], stats: Map "storeId_date" -> dailyStats doc, expenses: [{storeId,date,amountCents}]
export function buildSummary({ date, stores, stats, expenses = [] }) {
  const shops = stores.filter((s) => s.active !== false && s.kind !== 'warehouse').sort((a, b) => a.id - b.id);
  let total = 0; let orders = 0; const lines = [];
  for (const st of shops) {
    const x = stats.get(`${st.id}_${date}`) || {}; const by = x.byMethod || {};
    const ex = expenses.filter((e) => Number(e.storeId) === st.id && e.date === date).reduce((n, e) => n + (e.amountCents || 0), 0);
    total += x.salesCents || 0; orders += x.orders || 0;
    lines.push(`${st.name}: ${usd(x.salesCents)} (${x.orders || 0} orders, cash ${usd(by.cash)}, KHQR ${usd(by.khqr)}${ex ? `, expenses ${usd(ex)}` : ''})`);
  }
  return [`Angkor Formal — ${date}`, ...lines, `Total: ${usd(total)} · ${orders} orders`].join('\n');
}

export function validPin(pin) { return /^\d{4,6}$/.test(String(pin || '')); }
