// A tiny in-memory stand-in for Firestore, just enough to unit-test the app's logic without a network.
// It does NOT enforce security rules; those are tested separately against the real emulator (rules.test.js).
const INC = Symbol('inc');
export const increment = (n) => ({ [INC]: n });
const isInc = (v) => v && typeof v === 'object' && INC in v;
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !isInc(v);

function applyMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isInc(v)) out[k] = (typeof out[k] === 'number' ? out[k] : 0) + v[INC];
    else if (isPlain(v) && isPlain(out[k])) out[k] = applyMerge(out[k], v);
    else if (isPlain(v)) out[k] = applyMerge({}, v);
    else out[k] = clone(v);
  }
  return out;
}

export function createFake() {
  const data = new Map(); // "coll/id" -> obj
  let autoId = 0;
  const dbObj = { data };
  const ref = (path) => ({ __ref: true, path, id: path.split('/').pop(), coll: path.split('/')[0] });
  const doc = (d, a, b) => (d && d.__col ? ref(`${d.name}/auto${++autoId}${Math.random().toString(36).slice(2, 6)}`) : a && a.__col ? ref(`${a.name}/${b ?? `auto${++autoId}${Math.random().toString(36).slice(2, 6)}`}`) : ref(`${a}/${b}`));
  const collection = (d, name) => ({ __col: true, name });
  const snap = (path) => { const v = data.get(path); return { id: path.split('/').pop(), exists: () => v !== undefined, data: () => clone(v) }; };
  const getDoc = async (r) => snap(r.path);
  const where = (f, op, v) => ({ f, op, v });
  const query = (c, ...conds) => ({ ...c, conds });
  const match = (obj, { f, op, v }) => {
    const x = obj[f];
    if (op === '==') return x === v || (x == null && v == null);
    if (op === 'in') return v.includes(x);
    if (op === '>=') return x >= v; if (op === '<=') return x <= v; if (op === '<') return x < v; if (op === '>') return x > v;
    throw new Error(`fake: op ${op}`);
  };
  const getDocs = async (q) => {
    const docs = [];
    for (const [path, obj] of data) if (path.startsWith(`${q.name}/`) && (q.conds || []).every((c) => match(obj, c))) docs.push(snap(path));
    return { docs, size: docs.length };
  };
  const put = (path, obj) => data.set(path, obj);
  const setDoc = async (r, obj, opt) => { put(r.path, opt?.merge ? applyMerge(data.get(r.path) || {}, obj) : applyMerge({}, obj)); };
  const updateDoc = async (r, patch) => { if (!data.has(r.path)) throw Object.assign(new Error('no document to update'), { code: 'not-found' }); put(r.path, applyMerge(data.get(r.path), patch)); };
  function writer(commitFn) {
    const ops = [];
    return {
      ops,
      set: (r, obj, opt) => { ops.push(() => setDoc(r, obj, opt)); return undefined; },
      update: (r, patch) => { ops.push(() => updateDoc(r, patch)); },
      delete: (r) => { ops.push(async () => data.delete(r.path)); },
      commit: async () => { const backup = new Map(data); try { for (const o of ops) await o(); } catch (e) { data.clear(); for (const [k, v] of backup) data.set(k, v); throw e; } },
    };
  }
  const writeBatch = () => writer();
  const runTransaction = async (d, fn) => {
    const w = writer();
    const t = { get: async (r) => snap(r.path), set: w.set, update: w.update, delete: w.delete };
    const result = await fn(t);
    await w.commit();
    return result;
  };
  const fs = { doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where, writeBatch, runTransaction, increment };
  return { fs, db: dbObj, data };
}

// Fake sign-in, with a "second connection" that signs in as someone else.
export function createFakeAuth() {
  const accounts = new Map(); // email -> { uid, password }
  let current = null; let n = 0;
  const auth = {
    current: () => current,
    signOut: async () => { current = null; },
    signIn: async (e, p) => { const a = accounts.get(e); if (!a || a.password !== p) throw new Error('bad'); current = { uid: a.uid, email: e }; },
    createAndSignIn: async (e, p) => { if (accounts.has(e)) throw new Error('dup'); const uid = `u${++n}`; accounts.set(e, { uid, password: p }); current = { uid, email: e }; return uid; },
  };
  const secondary = {
    signInAs: async (e, p, db) => { const a = accounts.get(e); if (!a || a.password !== p) throw new Error('bad'); return { uid: a.uid, db: null, done: async () => {} }; },
    createUser: async (e, p) => { if (accounts.has(e)) throw new Error('dup'); const uid = `u${++n}`; accounts.set(e, { uid, password: p }); return uid; },
  };
  return { auth, secondary, accounts };
}
