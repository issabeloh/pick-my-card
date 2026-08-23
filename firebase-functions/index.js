/* ============================================================
 * Pick My Card — Cloud Functions
 *
 * notifyOnFeedback：使用者送出「回報問題 / 意見回饋」時（前端 addDoc 到
 * Firestore 的 feedback collection，見 js/quick-options-misc.js 的
 * "Submit Feedback" 區塊），立刻把內容推給站長：
 *   - Email（SMTP，可用 Gmail 應用程式密碼）
 *   - Webhook（Discord / Slack / Telegram — 手機上會即時跳通知，比 email 快）
 * 兩個管道各自獨立：只設定其中一個也能跑，兩個都設就兩個都送。
 *
 * ⚠️ 需要 Firebase Blaze（從量計費）方案；此函式的用量遠低於免費額度。
 * 部署與設定步驟見 functions/README.md。
 *
 * 密鑰一律走 Secret Manager（defineSecret），不寫進 repo。
 * ============================================================ */
'use strict';

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const nodemailer = require('nodemailer');

// Firestore 觸發器（2nd gen）的區域要和 Firestore 資料庫所在區域一致。
// 部署失敗且錯誤訊息指定了別的區域時，改這裡即可（例：us-central1）。
const REGION = 'asia-east1';

const PROJECT_ID = 'pick-my-card-28f2a';

// ── 設定參數（非密鑰：部署時互動輸入，存在 functions/.env.<project>）──
const NOTIFY_EMAIL_TO = defineString('NOTIFY_EMAIL_TO', { default: '' });
const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.gmail.com' });
const SMTP_PORT = defineString('SMTP_PORT', { default: '465' });
const SMTP_USER = defineString('SMTP_USER', { default: '' });

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

function buildPlainText(docId, data) {
  const lines = [
    '📮 Pick My Card 收到新的意見回饋',
    '',
    data.message || '(無內容)',
    '',
    `— 使用者：${data.userName || '未知'}（${data.userEmail || '無 email'}）`,
    `— uid：${data.userId || '未知'}`,
    `— 時間：${formatTaipeiTime(data)}`,
    `— 文件 ID：${docId}`
  ];
  const images = Array.isArray(data.imageUrls) ? data.imageUrls : [];
  if (images.length > 0) {
    lines.push(`— 附圖 ${images.length} 張：`);
    images.forEach((url) => lines.push(`   ${url}`));
  }
  if (data.imageUploadFailedCount) {
    lines.push(`— ⚠️ 有 ${data.imageUploadFailedCount} 張圖片上傳失敗：${data.imageUploadFirstError || ''}`);
  }
  lines.push('', `Firestore：${CONSOLE_URL}`);
  return lines.join('\n');
}

function buildHtml(docId, data) {
  const images = Array.isArray(data.imageUrls) ? data.imageUrls : [];
  const imageHtml = images.length
    ? `<p><strong>附圖（${images.length}）：</strong></p><ul>` +
      images.map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`).join('') +
      '</ul>'
    : '';
  const failHtml = data.imageUploadFailedCount
    ? `<p style="color:#b45309">⚠️ 有 ${escapeHtml(data.imageUploadFailedCount)} 張圖片上傳失敗：${escapeHtml(data.imageUploadFirstError || '')}</p>`
    : '';
  return `
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#111827">
      <h2 style="margin:0 0 12px">📮 新的意見回饋</h2>
      <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:4px solid #1e40af;background:#f3f4f6;white-space:pre-wrap">${escapeHtml(data.message || '(無內容)')}</blockquote>
      ${imageHtml}
      ${failHtml}
      <table style="border-collapse:collapse;font-size:14px;color:#374151">
        <tr><td style="padding:2px 12px 2px 0">使用者</td><td>${escapeHtml(data.userName || '未知')}（${escapeHtml(data.userEmail || '無 email')}）</td></tr>
        <tr><td style="padding:2px 12px 2px 0">uid</td><td><code>${escapeHtml(data.userId || '未知')}</code></td></tr>
        <tr><td style="padding:2px 12px 2px 0">時間</td><td>${escapeHtml(formatTaipeiTime(data))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0">文件 ID</td><td><code>${escapeHtml(docId)}</code></td></tr>
      </table>
      <p style="margin-top:16px"><a href="${CONSOLE_URL}">在 Firestore console 查看全部回饋 →</a></p>
    </div>`;
}

async function sendEmail(docId, data) {
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

  const subject = `[PickMyCard 回饋] ${(data.message || '').replace(/\s+/g, ' ').slice(0, 40) || '(無內容)'}`;
  await transporter.sendMail({
    from: `Pick My Card 回饋通知 <${user}>`,
    to,
    replyTo: data.userEmail || undefined, // 直接在信件裡回覆＝回給使用者
    subject,
    text: buildPlainText(docId, data),
    html: buildHtml(docId, data)
  });
  return { channel: 'email', sent: to };
}

async function sendWebhook(docId, data) {
  const url = NOTIFY_WEBHOOK_URL.value();
  if (!url || !/^https:\/\//.test(url)) {
    return { channel: 'webhook', skipped: '未設定 NOTIFY_WEBHOOK_URL' };
  }

  // Discord 讀 content、Slack 讀 text、Telegram sendMessage 讀 text
  // （chat_id 放在 webhook URL 的 query string）——三家都送，各取所需。
  const body = buildPlainText(docId, data).slice(0, 1900);
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

exports.notifyOnFeedback = onDocumentCreated(
  {
    document: 'feedback/{feedbackId}',
    region: REGION,
    secrets: [SMTP_PASSWORD, NOTIFY_WEBHOOK_URL],
    // 通知送不出去不值得重跑整串（重試會造成重複通知）；失敗留在 log 裡。
    retry: false
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.error('notifyOnFeedback: 事件沒有 snapshot，略過');
      return;
    }
    const docId = snapshot.id;
    const data = snapshot.data() || {};

    const results = await Promise.allSettled([
      sendEmail(docId, data),
      sendWebhook(docId, data)
    ]);

    let delivered = 0;
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        if (r.value.skipped) logger.warn('通知管道略過', r.value);
        else { delivered += 1; logger.info('通知已送出', r.value); }
      } else {
        logger.error('通知送出失敗', { error: String(r.reason && r.reason.message || r.reason) });
      }
    });

    if (delivered === 0) {
      logger.error('notifyOnFeedback: 沒有任何通知管道成功送出', { docId });
    }
  }
);
