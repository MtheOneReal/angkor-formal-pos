export const usd = (cents) => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usdShort = (cents) => '$' + Math.round(cents / 100).toLocaleString('en-US');
export const riel = (n) => Math.round(n).toLocaleString('en-US') + ' ៛';
export const toRiel = (cents, rate) => Math.round((cents * rate) / 100 / 100) * 100;
export const dt = (ts) => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const day = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
export const todayISO = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
