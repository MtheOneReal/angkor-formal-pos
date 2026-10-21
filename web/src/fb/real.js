// Connects the backend to the real Firebase project (Auth + Firestore). Used in the browser only.
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import * as fs from 'firebase/firestore';
import { createBackend } from './backend.js';
import { createApi } from './routes.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyD8ASUfL6ByW94H9qAwV2_cXdgVoJUkkIg', // public web identifier, not a secret
  authDomain: 'angkor-formal-pos.firebaseapp.com',
  projectId: 'angkor-formal-pos',
  storageBucket: 'angkor-formal-pos.firebasestorage.app',
  appId: '1:1019427141672:web:0197d6b1c20ae5e7a5dd1d',
};

const app = initializeApp(firebaseConfig);
const mainAuth = getAuth(app);
const db = fs.getFirestore(app);

// A second, separate connection: used when a manager signs in at the till to approve something,
// and when an owner creates a staff account. The person at the till stays signed in on the main one.
let n = 0;
async function openSecond() {
  const second = initializeApp(firebaseConfig, `second-${Date.now()}-${n++}`);
  return { second, a: getAuth(second), d: fs.getFirestore(second) };
}
const secondary = {
  async signInAs(email, password) {
    const { second, a, d } = await openSecond();
    try {
      const cred = await signInWithEmailAndPassword(a, email, password);
      return { uid: cred.user.uid, db: d, done: async () => { try { await signOut(a); } finally { await deleteApp(second); } } };
    } catch (e) { await deleteApp(second); throw e; }
  },
  async createUser(email, password) {
    const { second, a } = await openSecond();
    try { const cred = await createUserWithEmailAndPassword(a, email, password); await signOut(a); return cred.user.uid; } finally { await deleteApp(second); }
  },
};

const ready = new Promise((resolve) => { const off = onAuthStateChanged(mainAuth, () => { off(); resolve(); }); });
const auth = {
  current: () => mainAuth.currentUser,
  signOut: () => signOut(mainAuth),
  signIn: async (e, p) => { await ready; return signInWithEmailAndPassword(mainAuth, e, p); },
  createAndSignIn: async (e, p) => { const c = await createUserWithEmailAndPassword(mainAuth, e, p); return c.user.uid; },
  ready: () => ready,
};

const B = createBackend({ fs, db, auth, secondary });
const raw = createApi(B);
export const fbApi = {
  get: async (u) => { await ready; return raw.get(u); },
  post: async (u, b) => { await ready; return raw.post(u, b); },
  put: async (u, b) => { await ready; return raw.put(u, b); },
};
