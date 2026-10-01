/* ============================================================
 * Pick My Card — Cloud Functions
 *
 * dailyFeedbackDigest：每天台北時間 09:00 寄一封意見回饋摘要（沒有新回饋就不寄）。
 * 實作在 digest.js；部署與設定步驟見 functions/README.md。
 * ⚠️ 這個檔案 export 的每個東西都會被 firebase deploy 當成一個函式，只放排程本身。
 * ============================================================ */
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { Timestamp } = require('firebase-admin/firestore');
const { runDigest, REGION, SMTP_PASSWORD, NOTIFY_WEBHOOK_URL } = require('./digest');

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
