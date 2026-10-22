import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { buildSummary, phnomPenhDate, tillPassword, validPin } from './logic.js';

initializeApp();
const db = getFirestore();
const REGION = 'asia-southeast1';
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');

async function sendTelegram(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!r.ok) throw new Error(`Telegram said ${r.status}: ${await r.text()}`);
}

async function summaryText(date) {
  const stores = (await db.collection('stores').get()).docs.map((d) => ({ ...d.data(), id: Number(d.data().id) }));
  const stats = new Map(); for (const s of stores) { const d = await db.doc(`dailyStats/${s.id}_${date}`).get(); if (d.exists) stats.set(d.id, d.data()); }
  const expenses = (await db.collection('expenses').where('date', '==', date).get()).docs.map((d) => d.data());
  return buildSummary({ date, stores, stats, expenses });
}

// Every night at 21:30 Phnom Penh time: send the day's sales to the owners' Telegram chat.
export const telegramDaily = onSchedule({ schedule: '30 21 * * *', timeZone: 'Asia/Phnom_Penh', region: REGION, secrets: [TELEGRAM_BOT_TOKEN] }, async () => {
  const cfg = (await db.doc('settings/telegram').get()).data() || {};
  if (!cfg.enabled || !cfg.chatId) return;
  await sendTelegram(TELEGRAM_BOT_TOKEN.value(), cfg.chatId, await summaryText(phnomPenhDate()));
});

async function requireOwner(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const u = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (!u || u.active !== true || u.role !== 'owner') throw new HttpsError('permission-denied', 'Only an owner can do this.');
  return u;
}

// Owner presses "Send test message" in Settings.
export const telegramTest = onCall({ region: REGION, secrets: [TELEGRAM_BOT_TOKEN] }, async (req) => {
  await requireOwner(req);
  const cfg = (await db.doc('settings/telegram').get()).data() || {};
  if (!cfg.chatId) throw new HttpsError('failed-precondition', 'Enter the Telegram chat ID first.');
  try { await sendTelegram(TELEGRAM_BOT_TOKEN.value(), cfg.chatId, `Test from Angkor Formal ✔\n\n${await summaryText(phnomPenhDate())}`); } catch (e) { throw new HttpsError('internal', String(e.message || e)); }
  return { ok: true };
});

// Owner sets a new PIN (cashier) or a new password (manager / owner) for someone else.
export const staffReset = onCall({ region: REGION }, async (req) => {
  await requireOwner(req);
  const { user_id: uid, pin, password } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'Choose a person.');
  const dir = (await db.doc(`staffDirectory/${uid}`).get()).data(); const u = (await db.doc(`users/${uid}`).get()).data();
  if (!u) throw new HttpsError('not-found', 'Person not found.');
  const auth = getAuth();
  if (u.role === 'cashier') {
    if (!validPin(pin)) throw new HttpsError('invalid-argument', 'PIN must be 4 to 6 digits.');
    const first = Number((u.storeIds || [])[0]); const st = (await db.doc(`stores/${first}`).get()).data();
    if (!st) throw new HttpsError('failed-precondition', 'This person is not assigned to a store.');
    await auth.updateUser(uid, { password: tillPassword(String(pin), st.code) });
    await db.doc(`staffDirectory/${uid}`).set({ pinLength: String(pin).length }, { merge: true });
  } else {
    if (String(password || '').length < 8) throw new HttpsError('invalid-argument', 'Password must be at least 8 characters.');
    await auth.updateUser(uid, { password: String(password) });
  }
  await db.collection('auditLog').add({ ts: Date.now(), userId: req.auth.uid, storeId: null, action: 'staff.reset', entity: 'user', entityId: uid, detail: { role: u.role } });
  return { ok: true };
});
