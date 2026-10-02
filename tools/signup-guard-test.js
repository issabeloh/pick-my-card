#!/usr/bin/env node
/*
 * 帳號與 Email 把關（functions/signup-guard.js）測試——Firestore 模擬器，不碰正式資料。
 * 用法（NODE_PATH 指向裝好 functions 相依套件的資料夾，同 tools/feedback-digest-test.js）：
 *   NODE_PATH=/tmp/fn/node_modules /tmp/rt/node_modules/.bin/firebase emulators:exec \
 *     --only firestore --project demo-pmc "node tools/signup-guard-test.js"
 */
const path = require('path');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-pmc';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Firestore } = require('firebase-admin/firestore');
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const g = require(path.join(__dirname, '..', 'functions', 'signup-guard.js'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); } };
const run = (p) => p.then(r => ({ ok: true, r }), e => ({ ok: false, code: e.code }));

(async () => {
  console.log('— 信箱正規化');
  check('Gmail 加點／+後綴／大小寫都算同一個', ['p.aul7322000@gmail.com', 'paul7322000+abc@GMAIL.com', 'paul.7322000@googlemail.com'].every(e => g.normalizeInbox(e) === 'paul7322000@gmail.com'));
  check('非 Gmail 只拿掉 +後綴、保留點', g.normalizeInbox('a.b+x@yahoo.com.tw') === 'a.b@yahoo.com.tw');

  console.log('— 註冊（beforeUserCreated）');
  let r = await run(g.checkSignup({ email: 'someone@gmail.com', signInMethod: 'password' }));
  check('新的 email／密碼註冊被擋（PMC_SIGNUP_PASSWORD）', !r.ok && r.code === 'PMC_SIGNUP_PASSWORD');
  r = await run(g.checkSignup({ email: 'bot@yopmail.com', signInMethod: 'emailLink' }));
  check('拋棄式信箱被擋', !r.ok && r.code === 'PMC_SIGNUP_DISPOSABLE');
  check('Email 連結註冊放行', (await run(g.checkSignup({ email: 'paul7322000@gmail.com', signInMethod: 'emailLink' }))).ok);
  r = await run(g.checkSignup({ email: 'p.a.u.l7322000+2@gmail.com', signInMethod: 'emailLink' }));
  check('同一個 Gmail 信箱的變體再註冊被擋（PMC_SIGNUP_INBOX）', !r.ok && r.code === 'PMC_SIGNUP_INBOX');
  r = await run(g.checkSignup({ email: 'paul.7322000@gmail.com', signInMethod: 'google.com' }));
  check('同一信箱改用 Google 註冊也被擋', !r.ok && r.code === 'PMC_SIGNUP_INBOX');
  check('不同信箱的 Google 註冊放行', (await run(g.checkSignup({ email: 'other.person@gmail.com', signInMethod: 'google.com' }))).ok);
  check('inboxTaken 查得到已登記信箱', await g.inboxTaken('paul7322000+zzz@gmail.com'));
  const ids = (await getFirestore().collection('signupInboxes').get()).docs.map(d => d.id).join(',');
  check('登記文件不含原始 email', !/paul|gmail|other/.test(ids));

  console.log('— 寄信（beforeEmailSent）');
  r = await run(g.checkEmailSend({ emailType: 'EMAIL_SIGN_IN', email: 'x@gmail.com' }));
  check('Firebase 內建的登入連結信一律擋', !r.ok && r.code === 'PMC_EMAIL_LINK_DISABLED');
  const now = Date.parse('2026-10-03T04:00:00Z');
  const resets = [];
  for (let i = 0; i < 4; i++) resets.push(await run(g.checkEmailSend({ emailType: 'PASSWORD_RESET', email: i % 2 ? 'v.ictim@gmail.com' : 'victim@gmail.com' }, now)));
  check(`同一信箱重設密碼信前 ${g.MAX_RESET_EMAILS_PER_DAY} 封放行、第 4 封擋（含 Gmail 變體）`, resets.slice(0, 3).every(x => x.ok) && !resets[3].ok && resets[3].code === 'PMC_EMAIL_LIMIT');
  check('隔天又能寄', (await run(g.checkEmailSend({ emailType: 'PASSWORD_RESET', email: 'victim@gmail.com' }, now + 86400e3))).ok);
  check('其他種類的信（驗證信等）不限', (await run(g.checkEmailSend({ emailType: 'VERIFY_EMAIL', email: 'victim@gmail.com' }, now))).ok);

  console.log('— 出錯時放行');
  Firestore.prototype.runTransaction = () => Promise.reject(new Error('boom'));
  check('登記失敗時註冊放行', (await run(g.checkSignup({ email: 'brand.new@gmail.com', signInMethod: 'emailLink' }))).ok);
  check('計數失敗時重設信放行', (await run(g.checkEmailSend({ emailType: 'PASSWORD_RESET', email: 'z@gmail.com' }, now))).ok);

  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
