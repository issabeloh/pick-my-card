/* ============================================================
 * Pick My Card — Cloud Functions：意見回饋每日摘要的實作（index.js 只負責排程）
 *
 * dailyFeedbackDigest：每天台北時間 09:00 把「上次寄出之後」新增的意見回饋
 * （前端 addDoc 到 Firestore 的 feedback collection，見 js/quick-options-misc.js 的
 * "Submit Feedback" 區塊）整理成一封摘要推給站長；沒有新回饋就什麼都不寄。
 *   - Email（SMTP，可用 Gmail 應用程式密碼）
 *   - Webhook（Discord / Slack / Telegram）
 * 兩個管道各自獨立：只設定其中一個也能跑，兩個都設就兩個都送。
 *
 * 2026-10-01 前是 notifyOnFeedback（每則即時通知）；改成每日摘要是站長的選擇，
 * 也避免有人狂送回饋時信箱被灌爆。進度記在 Firestore 的 _meta/feedbackDigest
 * （sentUntil＝已寄到哪個時間點）：某天寄送失敗不前進，隔天會一起補寄。
 *
 * ⚠️ 需要 Firebase Blaze（從量計費）方案；此函式的用量遠低於免費額度。
 * 部署與設定步驟見 functions/README.md。
 *
 * 密鑰一律走 Secret Manager（defineSecret），不寫進 repo。
 * ============================================================ */
'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const nodemailer = require('nodemailer');

// 和 Firestore 資料庫同區域（排程函式本身不限區域，放一起延遲最低）。
const REGION = 'asia-east1';

// 一封摘要最多列出幾則（超過的只顯示數量，請到 console 看）；查詢上限防止被灌爆時讀太多。
const MAX_LISTED = 50;
const MAX_FETCH = 500;

initializeApp();

const PROJECT_ID = 'pick-my-card-28f2a';

// ── 設定參數（非密鑰：部署時互動輸入，存在 functions/.env.<project>）──
const NOTIFY_EMAIL_TO = defineString('NOTIFY_EMAIL_TO', { default: '' });
const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.gmail.com' });
const SMTP_PORT = defineString('SMTP_PORT', { default: '465' });
const SMTP_USER = defineString('SMTP_USER', { default: '' });
// 寄件地址（例：noreply@pickmycard.app）。留空＝用 SMTP_USER。用寄信服務（Brevo、Resend…）時
// SMTP_USER 常常不是信箱地址，一定要填這個。每日摘要與登入連結信（login-link.js）共用。
const MAIL_FROM = defineString('MAIL_FROM', { default: '' });

// 共用的 SMTP 連線（每日摘要、登入連結信）
function smtpTransport(pass) {
  // defineString 的 default 只用來預填部署時的提問，執行期 .value() 讀不到它
  const port = Number(SMTP_PORT.value()) || 465;
  return nodemailer.createTransport({
    host: SMTP_HOST.value() || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: SMTP_USER.value(), pass }
  });
}
const mailFromAddress = () => MAIL_FROM.value() || SMTP_USER.value();

// ── 密鑰（Secret Manager）──
// 只想用其中一個管道時，另一個也要建立（隨便填一個字元即可），
// 否則部署會卡在「找不到 secret」。
const SMTP_PASSWORD = defineSecret('SMTP_PASSWORD');
const NOTIFY_WEBHOOK_URL = defineSecret('NOTIFY_WEBHOOK_URL');

const CONSOLE_URL =
  `https://console.firebase.google.com/project/${PROJECT_ID}/firestore/databases/-default-/data/~2Ffeedback`;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTaipeiTime(data) {
  // timestamp 是 serverTimestamp()，createdAt 是前端的 ISO 字串（備援）
  let date = null;
  if (data.timestamp && typeof data.timestamp.toDate === 'function') {
    date = data.timestamp.toDate();
  } else if (data.createdAt) {
    const parsed = new Date(data.createdAt);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date) return '(無時間戳)';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date) + ' (台北)';
}

function imageLines(data) {
  const lines = [];
  const images = Array.isArray(data.imageUrls) ? data.imageUrls : [];
  if (images.length > 0) {
    lines.push(`   附圖 ${images.length} 張：`);
    images.forEach((url) => lines.push(`     ${url}`));
  }
  if (data.imageUploadFailedCount) {
    lines.push(`   ⚠️ 有 ${data.imageUploadFailedCount} 張圖片上傳失敗：${data.imageUploadFirstError || ''}`);
  }
  return lines;
}

// items: [{ id, data }]，依時間由舊到新；total 可能大於 items.length（超過 MAX_LISTED）
function buildPlainText(items, total) {
  const lines = [`📮 Pick My Card：${total} 則新的意見回饋`, ''];
  items.forEach(({ id, data }, i) => {
    lines.push(`#${i + 1}　${formatTaipeiTime(data)}`);
    lines.push(`   ${String(data.message || '(無內容)').replace(/\n/g, '\n   ')}`);
    lines.push(`   — ${data.userName || '未知'}（${data.userEmail || '無 email'}）uid ${data.userId || '未知'}　文件 ${id}`);
    lines.push(...imageLines(data), '');
  });
  if (total > items.length) lines.push(`…另外還有 ${total - items.length} 則，請到 console 查看。`, '');
  lines.push(`Firestore：${CONSOLE_URL}`);
  return lines.join('\n');
}

function buildHtml(items, total) {
  const blocks = items.map(({ id, data }, i) => {
    const images = Array.isArray(data.imageUrls) ? data.imageUrls : [];
    const imageHtml = images.length
      ? `<p style="margin:6px 0 0"><strong>附圖（${images.length}）：</strong>` +
        images.map((url, n) => ` <a href="${escapeHtml(url)}">圖${n + 1}</a>`).join('') + '</p>'
      : '';
    const failHtml = data.imageUploadFailedCount
      ? `<p style="margin:6px 0 0;color:#b45309">⚠️ 有 ${escapeHtml(data.imageUploadFailedCount)} 張圖片上傳失敗：${escapeHtml(data.imageUploadFirstError || '')}</p>`
      : '';
    const email = data.userEmail
      ? `<a href="mailto:${escapeHtml(data.userEmail)}">${escapeHtml(data.userEmail)}</a>`
      : '無 email';
    return `
      <div style="margin:0 0 20px">
        <div style="font-size:13px;color:#6b7280">#${i + 1}　${escapeHtml(formatTaipeiTime(data))}</div>
        <blockquote style="margin:6px 0;padding:10px 14px;border-left:4px solid #1e40af;background:#f3f4f6;white-space:pre-wrap">${escapeHtml(data.message || '(無內容)')}</blockquote>
        <div style="font-size:13px;color:#374151">${escapeHtml(data.userName || '未知')}（${email}）　uid <code>${escapeHtml(data.userId || '未知')}</code>　文件 <code>${escapeHtml(id)}</code></div>
        ${imageHtml}${failHtml}
      </div>`;
  }).join('');
  const more = total > items.length
    ? `<p style="color:#b45309">…另外還有 ${total - items.length} 則，請到 console 查看。</p>` : '';
  return `
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#111827">
      <h2 style="margin:0 0 16px">📮 ${total} 則新的意見回饋</h2>
      ${blocks}${more}
      <p style="margin-top:16px"><a href="${CONSOLE_URL}">在 Firestore console 查看全部回饋 →</a></p>
    </div>`;
}

async function sendEmail(items, total) {
  const to = NOTIFY_EMAIL_TO.value();
  const user = SMTP_USER.value();
  const pass = SMTP_PASSWORD.value();
  if (!to || !user || !pass || pass.trim().length < 2) {
    return { channel: 'email', skipped: '未設定 NOTIFY_EMAIL_TO / SMTP_USER / SMTP_PASSWORD' };
  }

  // defineString 的 default 只用來預填部署時的提問，執行期 .value() 讀不到它
  // （firebase-functions 的 StringParam.runtimeValue() 是 process.env[name] || ''），
  // 所以這裡自己兜底，避免參數沒設時 host 變成空字串、寄信直接失敗。
  const port = Number(SMTP_PORT.value()) || 465;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST.value() || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  // 只有一則時保留「直接回覆＝回給使用者」；多則時信裡每則都有 mailto 連結
  const only = items.length === 1 && total === 1 ? items[0].data : null;
  await transporter.sendMail({
    from: `Pick My Card 回饋通知 <${mailFromAddress()}>`,
    to,
    replyTo: (only && only.userEmail) || undefined,
    subject: `[PickMyCard 回饋] ${total} 則新回饋`,
    text: buildPlainText(items, total),
    html: buildHtml(items, total)
  });
  return { channel: 'email', sent: to };
}

async function sendWebhook(items, total) {
  const url = NOTIFY_WEBHOOK_URL.value();
  if (!url || !/^https:\/\//.test(url)) {
    return { channel: 'webhook', skipped: '未設定 NOTIFY_WEBHOOK_URL' };
  }

  // Discord 讀 content、Slack 讀 text、Telegram sendMessage 讀 text
  // （chat_id 放在 webhook URL 的 query string）——三家都送，各取所需。
  const body = buildPlainText(items, total).slice(0, 1900);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: body, text: body })
  });
  if (!res.ok) {
    throw new Error(`webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return { channel: 'webhook', status: res.status };
}

// 查出「上次寄到的時間點之後、到這次排程時間為止」的回饋，寄一封摘要。
// 抽成獨立檔方便測試：tools/feedback-digest-test.js 用 Firestore 模擬器直接呼叫它。
async function runDigest(now) {
  const db = getFirestore();
  const metaRef = db.doc('_meta/feedbackDigest');
  const meta = await metaRef.get();
  // 第一次跑：從 24 小時前開始
  const since = (meta.exists && meta.get('sentUntil')) || Timestamp.fromMillis(now.toMillis() - 24 * 3600 * 1000);

  const snap = await db.collection('feedback')
    .where('timestamp', '>', since)
    .where('timestamp', '<=', now)
    .orderBy('timestamp')
    .limit(MAX_FETCH)
    .get();

  if (snap.empty) {
    await metaRef.set({ sentUntil: now, lastRunAt: now, lastCount: 0 }, { merge: true });
    logger.info('沒有新回饋，不寄送', { since: since.toDate().toISOString() });
    return { total: 0, delivered: 0 };
  }

  const all = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
  const total = all.length;
  const items = all.slice(0, MAX_LISTED);

  const results = await Promise.allSettled([sendEmail(items, total), sendWebhook(items, total)]);
  let delivered = 0;
  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      if (r.value.skipped) logger.warn('通知管道略過', r.value);
      else { delivered += 1; logger.info('摘要已送出', r.value); }
    } else {
      logger.error('摘要送出失敗', { error: String(r.reason && r.reason.message || r.reason) });
    }
  });

  if (delivered > 0) {
    // 查詢有上限（MAX_FETCH）：被灌爆時進度只前進到這批最後一則，剩下的下次再寄
    const until = total >= MAX_FETCH ? all[all.length - 1].data.timestamp : now;
    await metaRef.set({ sentUntil: until, lastRunAt: now, lastCount: total }, { merge: true });
  } else {
    logger.error('dailyFeedbackDigest：沒有任何管道成功送出，進度不前進，明天補寄', { total });
  }
  return { total, delivered };
}

module.exports = { runDigest, REGION, SMTP_PASSWORD, NOTIFY_WEBHOOK_URL, SMTP_USER, smtpTransport, mailFromAddress };
