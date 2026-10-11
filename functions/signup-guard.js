/* ============================================================
 * Pick My Card — 帳號與 Email 把關（阻擋函式的實作；index.js 只負責掛上去）
 *
 * 背景：2026-10-01／02 同一人用「email／密碼註冊」（隨便填 Gmail 地址、不驗證）反覆開新帳號跑腳本。
 * 2026-10-03 起改成「Email 連結登入」（點信裡的連結＝證明真的收得到信），並在註冊這關：
 *   - 拒絕新的「email／密碼」註冊（擋腳本直接打 Firebase 註冊 API；既有密碼帳號照常登入）
 *   - 拒絕拋棄式信箱網域
 *   - 同一個實體信箱只能有一個新帳號：Gmail 忽略「.」與「+後綴」，p.aul+1@gmail.com 和
 *     paul@gmail.com 是同一個信箱 → 正規化後雜湊存 signupInboxes/{雜湊}，已存在就擋
 *     （只對這套上線後建立的帳號有效；既有帳號沒有登記）
 * 另外 checkEmailSend（beforeEmailSent）：Firebase 自己寄的「登入連結信」一律擋（登入信改由
 * sendLoginLink 寄，見 login-link.js）；「重設密碼信」同一個信箱每天最多 3 封，避免有人
 * 拿忘記密碼功能對別人狂寄信。
 *
 * 不存原始 email／IP，只存雜湊。任何非預期錯誤一律放行（fail open）——寧可漏擋，不讓真人卡住。
 * 前端（js/quick-options-misc.js、index.html）認錯誤訊息裡的 PMC_* 代號顯示中文提示。
 * 測試：tools/signup-guard-test.js（Firestore 模擬器）。
 * ============================================================ */
'use strict';

const crypto = require('crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

const MAX_RESET_EMAILS_PER_DAY = 3;

// 常見拋棄式信箱（不求完整，擋掉最常被腳本拿來用的）
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com',
  'grr.la', '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'tempmail.com', 'tempmail.net',
  'yopmail.com', 'yopmail.net', 'trashmail.com', 'getnada.com', 'nada.email', 'dispostable.com',
  'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'throwawaymail.com', 'fakeinbox.com',
  'moakt.com', 'emailondeck.com', 'tempail.com', 'mohmal.com', 'burnermail.io', 'mail.tm',
  'tmpmail.org', 'tmpmail.net', 'spamgourmet.com', 'mytemp.email', 'temp-mail.io', 'minuteinbox.com'
]);

class Blocked extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

function taiwanDayKey(ms) {
  const t = new Date(ms + 8 * 3600 * 1000);
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

function emailDomain(email) {
  return String(email || '').trim().toLowerCase().split('@')[1] || '';
}

function isDisposable(email) {
  return DISPOSABLE_DOMAINS.has(emailDomain(email));
}

// 把「同一個實體信箱」的各種寫法統一：全部小寫、拿掉 +後綴；Gmail 另外拿掉 local 部分的「.」
function normalizeInbox(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

function hashKey(value) {
  const salt = process.env.GCLOUD_PROJECT || 'pick-my-card';
  return crypto.createHash('sha256').update(`${salt}|${value}`).digest('hex').slice(0, 32);
}

const inboxRef = (email) => getFirestore().doc(`signupInboxes/${hashKey(normalizeInbox(email))}`);

// 這個實體信箱是否已經登記過帳號（給 sendLoginLink 提前判斷用）
async function inboxTaken(email) {
  try { return (await inboxRef(email).get()).exists; } catch (e) { return false; }
}

// beforeUserCreated。signInMethod：'password'（密碼註冊）、'emailLink'、'google.com'…
async function checkSignup({ email, signInMethod }) {
  if (signInMethod === 'password') {
    throw new Blocked('PMC_SIGNUP_PASSWORD', '請改用 Email 連結或 Google 登入');
  }
  if (email && isDisposable(email)) {
    throw new Blocked('PMC_SIGNUP_DISPOSABLE', '不接受拋棄式信箱');
  }
  if (!email) return { allowed: true, reason: 'no-email' };
  try {
    const ref = inboxRef(email);
    const created = await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, { createdAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!created) throw new Blocked('PMC_SIGNUP_INBOX', '這個信箱已經有帳號了');
  } catch (err) {
    if (err instanceof Blocked) throw err;
    logger.error('signup-guard：信箱登記失敗，放行', { error: String(err && err.message || err) });
    return { allowed: true, reason: 'index-error' };
  }
  return { allowed: true, reason: 'ok' };
}

// beforeEmailSent。emailType：'EMAIL_SIGN_IN'、'PASSWORD_RESET'…；email：收件人
async function checkEmailSend({ emailType, email }, nowMs = Date.now()) {
  if (emailType === 'EMAIL_SIGN_IN') {
    throw new Blocked('PMC_EMAIL_LINK_DISABLED', '請從網站索取登入連結');
  }
  if (emailType !== 'PASSWORD_RESET' || !email) return { allowed: true, reason: 'not-limited' };
  try {
    const ref = getFirestore().doc(`emailSendLimits/reset_${hashKey(normalizeInbox(email))}_${taiwanDayKey(nowMs)}`);
    const count = await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = (snap.exists ? snap.get('count') || 0 : 0) + 1;
      tx.set(ref, { count: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return next;
    });
    if (count > MAX_RESET_EMAILS_PER_DAY) throw new Blocked('PMC_EMAIL_LIMIT', '這個信箱今天的重設信已達上限');
    return { allowed: true, reason: 'ok', count };
  } catch (err) {
    if (err instanceof Blocked) throw err;
    logger.error('email-guard：計數失敗，放行', { error: String(err && err.message || err) });
    return { allowed: true, reason: 'counter-error' };
  }
}

module.exports = {
  checkSignup, checkEmailSend, inboxTaken, isDisposable, normalizeInbox, hashKey, taiwanDayKey,
  Blocked, DISPOSABLE_DOMAINS, MAX_RESET_EMAILS_PER_DAY
};
