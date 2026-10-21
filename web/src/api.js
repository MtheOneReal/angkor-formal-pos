// Small fetch wrapper. Every call carries the header the server requires.
export class ApiError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
async function call(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'af' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || 'ERROR', data?.message || 'Something went wrong.', data?.extra);
    if (res.status === 401 && url !== '/me' && !url.startsWith('/auth/')) window.dispatchEvent(new Event('af-logged-out'));
    throw err;
  }
  return data;
}
// Two modes: 'firebase' (the app talks to Google Firebase straight from the browser) and 'server' (the Node server).
const MODE = import.meta.env.VITE_BACKEND || 'firebase';
let fbPromise = null;
const viaFirebase = (method) => async (u, b = {}) => {
  fbPromise = fbPromise || import('./fb/real.js');
  const { fbApi } = await fbPromise;
  try { return await fbApi[method](u, b); } catch (e) {
    const err = new ApiError(e.status || 500, e.code || 'ERROR', e.message || 'Something went wrong.', e.extra);
    if (err.status === 401 && u !== '/me' && !u.startsWith('/auth/')) window.dispatchEvent(new Event('af-logged-out'));
    throw err;
  }
};
export const api = MODE === 'firebase'
  ? { get: (u) => viaFirebase('get')(u), post: viaFirebase('post'), put: viaFirebase('put') }
  : { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b) };
export const qs = (o) => '?' + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
