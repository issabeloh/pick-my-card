/* ============================================================
 * Pick My Card — Cloud Functions
 *
 * dailyFeedbackDigest：每天台北時間 09:00 寄一封意見回饋摘要（沒有新回饋就不寄）。實作在 digest.js。
 * guardSignup：每次有人註冊新帳號時先檢查（阻擋函式 beforeUserCreated），實作在 signup-guard.js。
 * guardEmails：Firebase 要寄信前先檢查（阻擋函式 beforeEmailSent）：擋內建登入連結信、限制重設密碼信。
 *   ⚠️ 上面兩個需要專案升級到「Firebase Authentication with Identity Platform」才能部署。
 * sendLoginLink：網站「用 Email 連結登入」按鈕呼叫的函式（強制 App Check），實作在 login-link.js。
 * 部署與設定步驟見 functions/README.md。
 * ⚠️ 這個檔案 export 的每個東西都會被 firebase deploy 當成一個函式，只放排程本身。
 * ============================================================ */
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { Timestamp } = require('firebase-admin/firestore');
const { beforeUserCreated, beforeEmailSent, HttpsError } = require('firebase-functions/v2/identity');
const { onCall, HttpsError: CallableError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { runDigest, REGION, SMTP_PASSWORD, NOTIFY_WEBHOOK_URL, SMTP_USER, smtpTransport, mailFromAddress } = require('./digest');
const { checkSignup, checkEmailSend, Blocked } = require('./signup-guard');
const { sendLoginLink, LinkError } = require('./login-link');

exports.dailyFeedbackDigest = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Taipei',
    region: REGION,
    secrets: [SMTP_PASSWORD, NOTIFY_WEBHOOK_URL],
    // 失敗不自動重試（重試可能重複寄信）；進度沒前進，隔天會補寄
    retryCount: 0
  },
  async () => {
    await runDigest(Timestamp.now());
  }
);

exports.guardSignup = beforeUserCreated({ region: REGION }, async (event) => {
  try {
    await checkSignup({
      email: event.data && event.data.email,
      // eventType 形如 'providers/cloud.auth/eventTypes/user.beforeCreate:password'，冒號後是登入方式
      signInMethod: (event.credential && event.credential.signInMethod)
        || String(event.eventType || '').split(':').pop()
    });
  } catch (err) {
    if (err instanceof Blocked) throw new HttpsError('permission-denied', err.message);
    logger.error('guardSignup：未預期的錯誤，放行', { error: String(err && err.message || err) });
  }
});

exports.guardEmails = beforeEmailSent({ region: REGION }, async (event) => {
  try {
    await checkEmailSend({
      emailType: event.emailType,
      email: event.additionalUserInfo && event.additionalUserInfo.email
    });
  } catch (err) {
    if (err instanceof Blocked) throw new HttpsError('permission-denied', err.message);
    logger.error('guardEmails：未預期的錯誤，放行', { error: String(err && err.message || err) });
  }
});

exports.sendLoginLink = onCall({ region: REGION, enforceAppCheck: true, secrets: [SMTP_PASSWORD] }, async (req) => {
  const headers = (req.rawRequest && req.rawRequest.headers) || {};
  const ip = String(headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.rawRequest && req.rawRequest.ip) || '';
  const sendMail = async ({ to, subject, text, html }) => {
    const pass = SMTP_PASSWORD.value();
    if (!SMTP_USER.value() || !pass || pass.trim().length < 2) throw new Error('SMTP 未設定');
    await smtpTransport(pass).sendMail({ from: `Pick My Card <${mailFromAddress()}>`, to, subject, text, html });
  };
  try {
    return await sendLoginLink({ email: req.data && req.data.email, ip }, { sendMail });
  } catch (err) {
    if (err instanceof LinkError) throw new CallableError(err.code, err.message);
    logger.error('sendLoginLink 失敗', { error: String(err && err.message || err) });
    throw new CallableError('internal', 'PMC_LINK_FAILED: 寄信失敗，請稍後再試');
  }
});
