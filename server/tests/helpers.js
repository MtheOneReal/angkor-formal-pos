// Test helpers: a fresh demo database in a temp folder and a tiny HTTP client with a cookie.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

export async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-test-'));
  process.env.DATA_DIR = dir;
  execFileSync('node', [path.join(root, 'server', 'seed.js')], { env: { ...process.env, DATA_DIR: dir }, stdio: 'ignore' });
  const { buildApp } = await import('../app.js');
  const dbm = await import('../db.js');
  const server = buildApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, db: dbm.db, close: () => server.close() };
}

export function client(base) {
  let cookie = '';
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'af', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  }
  return {
    get: (u) => call('GET', u),
    post: (u, b = {}) => call('POST', u, b),
    put: (u, b = {}) => call('PUT', u, b),
    raw: call,
    async login(email, password) { const r = await call('POST', '/api/auth/login', { email, password }); if (r.status !== 200) throw new Error('login failed ' + r.text); return this; },
    async pin(storeId, userId, pin) { const r = await call('POST', '/api/auth/pin-login', { store_id: storeId, user_id: userId, pin }); if (r.status !== 200) throw new Error('pin failed ' + r.text); return this; },
  };
}

export const PASSWORD = 'Demo-1234';
