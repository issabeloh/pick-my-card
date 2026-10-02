/* ============================================================
 * Pick My Card — 註冊把關（beforeUserCreated 阻擋函式的實作；index.js 只負責掛上去）
 *
 * 2026-10-02 起：同一人兩度用新註冊的 email 帳號跑腳本灌 Firestore。帳號本身免費、可無限註冊，
 * 每個新帳號都能拿到一份「每帳號寫入上限」，所以在註冊這關擋大量開帳號：
 *   - Email／密碼註冊：同一個 IP 每天（台灣時間）最多 MAX_EMAIL_SIGNUPS_PER_IP 個
 *   - 拋棄式信箱網域一律拒絕
 *   - 「用 Google 登入」的新用戶不限（Google 帳號難以大量建立，留給真人一條暢通的路）
 * IP 只存單向雜湊（SHA-256＋鹽），不存原始 IP；計數文件 signupLimits/{雜湊}_{日期}，
 * 前端讀寫不到（firestore.rules 的「其他一律拒絕」），Admin SDK 不受規則限制。
 * 任何意外錯誤一律放行（fail open）——寧可漏擋，也不能因為 bug 讓真人註冊不了。
 *
 * 前端顯示：js/quick-options-misc.js 認錯誤訊息裡的 PMC_SIGNUP_LIMIT／PMC_SIGNUP_DISPOSABLE。
 * 測試：tools/signup-guard-test.js（Firestore 模擬器）。
 * ============================================================ */
'use strict';

const crypto = require('crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

const MAX_EMAIL_SIGNUPS_PER_IP = 10;

// 常見拋棄式信箱（不求完整，擋掉最常被腳本拿來用的）
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com',
  'grr.la', '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'tempmail.com', 'tempmail.net',
  'yopmail.com', 'yopmail.net', 'trashmail.com', 'getnada.com', 'nada.email', 'dispostable.com',
  'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'throwawaymail.com', 'fakeinbox.com',
  'moakt.com', 'emailondeck.com', 'tempail.com', 'mohmal.com', 'burnermail.io', 'mail.tm',
  'tmpmail.org', 'tmpmail.net', 'spamgourmet.com', 'mytemp.email', 'temp-mail.io', 'minuteinbox.com'
]);

class SignupBlocked extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function taiwanDayKey(ms) {
  const t = new Date(ms + 8 * 3600 * 1000);
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

// ip: 註冊請求的來源 IP；email: 新帳號 email；providerId: 'password'、'google.com'…
// 擋下時丟 SignupBlocked；放行時回傳 { allowed: true, reason }
async function checkSignup({ ip, email, providerId }, nowMs = Date.now()) {
  if (providerId && providerId !== 'password') return { allowed: true, reason: 'not-email-signup' };

  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  if (DISPOSABLE_DOMAINS.has(domain)) {
    throw new SignupBlocked('PMC_SIGNUP_DISPOSABLE', 'PMC_SIGNUP_DISPOSABLE: 不接受拋棄式信箱');
  }
  if (!ip) return { allowed: true, reason: 'no-ip' };

  let count;
  try {
    const salt = process.env.GCLOUD_PROJECT || 'pick-my-card';
    const ipHash = crypto.createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);
    const ref = getFirestore().doc(`signupLimits/${ipHash}_${taiwanDayKey(nowMs)}`);
    count = await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = (snap.exists ? snap.get('count') || 0 : 0) + 1;
      tx.set(ref, { count: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return next;
    });
  } catch (err) {
    logger.error('signup-guard：計數失敗，放行', { error: String(err && err.message || err) });
    return { allowed: true, reason: 'counter-error' };
  }
  if (count > MAX_EMAIL_SIGNUPS_PER_IP) {
    logger.warn('signup-guard：同一 IP 今日 email 註冊過多，擋下', { count, domain });
    throw new SignupBlocked('PMC_SIGNUP_LIMIT', 'PMC_SIGNUP_LIMIT: 這個網路今天註冊的帳號太多了');
  }
  return { allowed: true, reason: 'ok', count };
}

module.exports = { checkSignup, SignupBlocked, MAX_EMAIL_SIGNUPS_PER_IP, DISPOSABLE_DOMAINS, taiwanDayKey };
