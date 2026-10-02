#!/usr/bin/env node
/*
 * 註冊把關（functions/signup-guard.js）測試——Firestore 模擬器，不碰正式資料。
 * 用法（NODE_PATH 指向裝好 functions 相依套件的資料夾，同 tools/feedback-digest-test.js）：
 *   NODE_PATH=/tmp/fn/node_modules /tmp/rt/node_modules/.bin/firebase emulators:exec \
 *     --only firestore --project demo-pmc "node tools/signup-guard-test.js"
 */
const path = require('path');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-pmc';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const g = require(path.join(__dirname, '..', 'functions', 'signup-guard.js'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); } };
const attempt = (args, now) => g.checkSignup(args, now).then(r => ({ ok: true, r }), e => ({ ok: false, code: e.code, blocked: e instanceof g.SignupBlocked }));

(async () => {
  const now = Date.parse('2026-10-02T04:00:00Z');   // 台灣 10/2 中午
  const results = [];
  for (let i = 0; i < 12; i++) results.push(await attempt({ ip: '1.2.3.4', email: `u${i}@gmail.com`, providerId: 'password' }, now));
  check(`同一 IP 前 ${g.MAX_EMAIL_SIGNUPS_PER_IP} 個 email 註冊放行`, results.slice(0, 10).every(r => r.ok));
  check('第 11、12 個被擋（PMC_SIGNUP_LIMIT）', results.slice(10).every(r => !r.ok && r.code === 'PMC_SIGNUP_LIMIT'));
  check('別的 IP 不受影響', (await attempt({ ip: '5.6.7.8', email: 'x@gmail.com', providerId: 'password' }, now)).ok);
  check('同一 IP 用 Google 登入的新用戶不限', (await attempt({ ip: '1.2.3.4', email: 'g@gmail.com', providerId: 'google.com' }, now)).ok);
  check('同一 IP 隔天又能註冊', (await attempt({ ip: '1.2.3.4', email: 'next@gmail.com', providerId: 'password' }, now + 24 * 3600e3)).ok);
  const disp = await attempt({ ip: '9.9.9.9', email: 'bot@Mailinator.com', providerId: 'password' }, now);
  check('拋棄式信箱被擋（PMC_SIGNUP_DISPOSABLE，大小寫不影響）', !disp.ok && disp.code === 'PMC_SIGNUP_DISPOSABLE');
  check('沒有 IP 時放行', (await attempt({ email: 'a@gmail.com', providerId: 'password' }, now)).ok);
  // 不存原始 IP
  const docs = await getFirestore().collection('signupLimits').get();
  check('計數文件不含原始 IP', docs.size > 0 && docs.docs.every(d => !d.id.includes('1.2.3.4') && !JSON.stringify(d.data()).includes('1.2.3.4')));
  // Firestore 掛掉時放行（fail open）
  require('firebase-admin/firestore').Firestore.prototype.runTransaction = () => Promise.reject(new Error('boom'));
  const failOpen = await attempt({ ip: '7.7.7.7', email: 'y@gmail.com', providerId: 'password' }, now);
  check('計數出錯時放行（不讓真人卡在註冊）', failOpen.ok && failOpen.r.reason === 'counter-error');
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
