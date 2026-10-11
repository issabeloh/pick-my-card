#!/usr/bin/env node
/*
 * 意見回饋每日摘要（functions/digest.js 的 runDigest）測試——用 Firestore 模擬器，不寄真信。
 *
 * 用法（在 repo 根目錄；FN 是裝好 functions 相依套件的資料夾，RT 同 tools/firestore-rules-test.js）：
 *   mkdir -p /tmp/fn && cp functions/package.json /tmp/fn/ && (cd /tmp/fn && npm install)
 *   NODE_PATH=/tmp/fn/node_modules /tmp/rt/node_modules/.bin/firebase emulators:exec \
 *     --config <含 firestore 規則路徑的 firebase.json> --only firestore --project demo-pmc \
 *     "node tools/feedback-digest-test.js"
 */
const path = require('path');
const Module = require('module');

// 假的 nodemailer：記錄寄出的信，可切換成「寄送失敗」
const sent = [];
let failMail = false;
const fakeMailer = { createTransport: () => ({ sendMail: async (m) => { if (failMail) throw new Error('smtp down'); sent.push(m); } }) };
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'nodemailer' ? fakeMailer : origLoad.call(this, req, ...rest); };

process.env.GCLOUD_PROJECT = 'demo-pmc';
process.env.NOTIFY_EMAIL_TO = 'owner@example.com';
process.env.SMTP_USER = 'sender@example.com';
process.env.SMTP_PASSWORD = 'app-password';
process.env.NOTIFY_WEBHOOK_URL = '-';   // 未設定 → webhook 管道略過

const { runDigest } = require(path.join(__dirname, '..', 'functions', 'digest.js'));
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
}

(async () => {
  const db = getFirestore();
  const H = 3600 * 1000;
  const t0 = Date.parse('2026-10-02T01:00:00Z');   // 台北 10/2 09:00
  const at = (ms) => Timestamp.fromMillis(ms);
  const add = (ms, extra = {}) => db.collection('feedback').add({
    message: '測試回饋', userName: '小明', userId: 'u1', userEmail: 'u1@example.com', imageUrls: [],
    timestamp: at(ms), createdAt: new Date(ms).toISOString(), ...extra
  });

  // 1. 沒有回饋 → 不寄信，但進度前進
  let r = await runDigest(at(t0));
  check('沒有回饋：不寄信', sent.length === 0 && r.total === 0);
  check('沒有回饋：進度記到這次時間', (await db.doc('_meta/feedbackDigest').get()).get('sentUntil').toMillis() === t0);

  // 2. 隔天有 2 則 → 寄一封、列 2 則，內容有跳脫
  await add(t0 + 2 * H, { message: '<script>alert(1)</script>', imageUrls: ['https://example.com/a.jpg'] });
  await add(t0 + 5 * H);
  r = await runDigest(at(t0 + 24 * H));
  check('2 則：寄出 1 封', sent.length === 1, `sent=${sent.length}`);
  check('2 則：主旨寫 2 則', sent[0] && sent[0].subject.includes('2 則'), sent[0] && sent[0].subject);
  check('2 則：HTML 有跳脫使用者內容', sent[0] && sent[0].html.includes('&lt;script&gt;') && !sent[0].html.includes('<script>'));
  check('2 則：附圖連結在信裡', sent[0] && sent[0].html.includes('https://example.com/a.jpg'));
  check('多則時不設 replyTo', sent[0] && sent[0].replyTo === undefined);

  // 3. 再跑一次、沒有新回饋 → 不重複寄
  r = await runDigest(at(t0 + 48 * H));
  check('已寄過的不會重複寄', sent.length === 1 && r.total === 0);

  // 4. 寄送失敗 → 進度不前進，下次補寄
  await add(t0 + 50 * H, { message: '失敗那天的回饋' });
  failMail = true;
  r = await runDigest(at(t0 + 72 * H));
  check('寄送失敗：沒寄出', sent.length === 1 && r.delivered === 0);
  failMail = false;
  r = await runDigest(at(t0 + 96 * H));
  check('隔天補寄失敗那天的回饋', sent.length === 2 && sent[1].text.includes('失敗那天的回饋'));
  check('只有一則時 replyTo＝使用者', sent[1].replyTo === 'u1@example.com');

  // 5. 一天 60 則 → 一封信只列 50 則＋「另外還有 10 則」
  for (let i = 0; i < 60; i++) await add(t0 + 100 * H + i * 1000, { message: `第${i + 1}則` });
  r = await runDigest(at(t0 + 120 * H));
  check('60 則：只寄 1 封', sent.length === 3);
  check('60 則：列出 50 則並註明另外 10 則', sent[2].text.includes('第50則') && !sent[2].text.includes('第51則') && sent[2].text.includes('另外還有 10 則'));

  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
