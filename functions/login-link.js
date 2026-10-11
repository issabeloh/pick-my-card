/* ============================================================
 * Pick My Card — 寄送「Email 連結登入」信（sendLoginLink 的實作；index.js 只負責掛上去）
 *
 * 為什麼自己寄、不用 Firebase 內建的 sendSignInLinkToEmail：
 *   1. 內建信的寄件者／主旨在這個專案改不了（console 顯示「Email template updates are unavailable」）
 *   2. 內建的「寄登入連結」任何人都能拿公開 API 對陌生人信箱狂寄；自己寄才能加上：
 *      - App Check（只有真網站能叫這支函式；index.js 的 enforceAppCheck）
 *      - 每個信箱每小時 3 封、每天 5 封；每個 IP 每小時 30 封（Firestore loginLinkLimits/，只存雜湊）
 *   Firebase 內建的登入連結信則由 signup-guard.js 的 checkEmailSend 一律擋掉。
 *
 * 連結：用 Admin SDK generateSignInWithEmailLink 產生後，把 oobCode 等參數搬到 pickmycard.app 的網址上
 * （信裡看到的是自己的網域、少一次 firebaseapp.com 轉址）；?start=1 讓首次訪客不會被導去 landing.html。
 * 前端在 index.html 用 isSignInWithEmailLink／signInWithEmailLink 完成登入。
 * 測試：tools/login-link-test.js（Auth＋Firestore 模擬器，真的拿產生的連結登入一次）。
 * ============================================================ */
'use strict';

const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { isDisposable, normalizeInbox, hashKey, inboxTaken } = require('./signup-guard');

const SITE_URL = 'https://pickmycard.app/';
const LIMITS = { inboxPerHour: 3, inboxPerDay: 5, ipPerHour: 30 };
const SUBJECT = '登入 Pick My Card';

class LinkError extends Error {
  constructor(code, marker, message) { super(`${marker}: ${message}`); this.code = code; this.marker = marker; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 每個計數文件 +1，回傳新值（交易，避免同時多封時算錯）
async function bump(path) {
  const db = getFirestore();
  const ref = db.doc(path);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? snap.get('count') || 0 : 0) + 1;
    tx.set(ref, { count: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
}

function buildSiteLink(firebaseLink) {
  const src = new URL(firebaseLink);
  const out = new URL(SITE_URL);
  out.searchParams.set('start', '1');
  for (const k of ['mode', 'oobCode', 'apiKey']) {
    const v = src.searchParams.get(k);
    if (v) out.searchParams.set(k, v);
  }
  out.searchParams.set('lang', 'zh-TW');
  return out.toString();
}

function mailBodies(link) {
  const text = [
    '你好，',
    '',
    '請點下面的連結登入 Pick My Card（信用卡回饋大師）：',
    link,
    '',
    '連結有時效、只能用一次，過期請回網站重新索取。',
    '如果不是你本人索取的，忽略這封信即可，你的帳號不會有任何變動。',
    '',
    'Pick My Card · https://pickmycard.app'
  ].join('\n');
  const html = `
    <div style="font-family:-apple-system,'Segoe UI','PingFang TC','Microsoft JhengHei',sans-serif;font-size:15px;line-height:1.7;color:#111827;max-width:480px">
      <p>你好，</p>
      <p>請點下面的按鈕登入 <strong>Pick My Card（信用卡回饋大師）</strong>：</p>
      <p style="margin:24px 0"><a href="${link}" style="background:#1e40af;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;font-weight:600">登入 Pick My Card</a></p>
      <p style="font-size:13px;color:#6b7280">按鈕沒反應的話，複製這個網址到瀏覽器打開：<br><span style="word-break:break-all">${link}</span></p>
      <p style="font-size:13px;color:#6b7280">連結有時效、只能用一次，過期請回網站重新索取。如果不是你本人索取的，忽略這封信即可，你的帳號不會有任何變動。</p>
    </div>`;
  return { text, html };
}

// deps：{ sendMail({to, subject, text, html}) }（測試時換成假的）
async function sendLoginLink({ email, ip }, deps, nowMs = Date.now()) {
  const addr = String(email || '').trim();
  if (!EMAIL_RE.test(addr) || addr.length > 254) throw new LinkError('invalid-argument', 'PMC_LINK_INVALID', 'Email 格式不正確');
  if (isDisposable(addr)) throw new LinkError('permission-denied', 'PMC_SIGNUP_DISPOSABLE', '不接受拋棄式信箱');

  const inboxHash = hashKey(normalizeInbox(addr));
  const hour = Math.floor(nowMs / 3600e3);
  const day = Math.floor((nowMs + 8 * 3600e3) / 86400e3);
  const [perHour, perDay] = await Promise.all([
    bump(`loginLinkLimits/i_${inboxHash}_h${hour}`),
    bump(`loginLinkLimits/i_${inboxHash}_d${day}`)
  ]);
  const perIp = ip ? await bump(`loginLinkLimits/ip_${hashKey(ip)}_h${hour}`) : 0;
  if (perHour > LIMITS.inboxPerHour || perDay > LIMITS.inboxPerDay || perIp > LIMITS.ipPerHour) {
    throw new LinkError('resource-exhausted', 'PMC_LINK_TOO_MANY', '寄太多次了，請稍後再試');
  }

  // 這個實體信箱已經有帳號、但不是這個寫法（例如 Gmail 加點／+後綴）：新帳號會被 guardSignup 擋，先講清楚
  let exists = true;
  try { await getAuth().getUserByEmail(addr); } catch (e) { exists = false; }
  if (!exists && await inboxTaken(addr)) {
    throw new LinkError('already-exists', 'PMC_SIGNUP_INBOX', '這個信箱已經有帳號了');
  }

  const firebaseLink = await getAuth().generateSignInWithEmailLink(addr, { url: `${SITE_URL}?start=1`, handleCodeInApp: true });
  const link = buildSiteLink(firebaseLink);
  const { text, html } = mailBodies(link);
  await deps.sendMail({ to: addr, subject: SUBJECT, text, html });
  return { ok: true };
}

module.exports = { sendLoginLink, buildSiteLink, LinkError, LIMITS, SUBJECT };
