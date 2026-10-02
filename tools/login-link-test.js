#!/usr/bin/env node
/*
 * 「Email 連結登入」寄信函式（functions/login-link.js）測試——Auth＋Firestore 模擬器，不寄真信。
 * 重點：拿函式產生、要寄出去的那條 pickmycard.app 連結，用前端同一套 SDK 真的登入一次。
 * 用法（NODE_PATH 要同時找得到 functions 相依套件與前端 firebase 套件，用 : 串兩個資料夾）：
 *   NODE_PATH=/tmp/fn/node_modules:/tmp/rt/node_modules /tmp/rt/node_modules/.bin/firebase emulators:exec \
 *     --only auth,firestore --project demo-pmc "node tools/login-link-test.js"
 */
const path = require('path');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-pmc';
const { initializeApp: adminInit } = require('firebase-admin/app');
adminInit({ projectId: process.env.GCLOUD_PROJECT });
const L = require(path.join(__dirname, '..', 'functions', 'login-link.js'));
const G = require(path.join(__dirname, '..', 'functions', 'signup-guard.js'));
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, isSignInWithEmailLink, signInWithEmailLink, signOut } = require('firebase/auth');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); } };
const sent = [];
const deps = { sendMail: async (m) => { sent.push(m); } };
const run = (p) => p.then(r => ({ ok: true, r }), e => ({ ok: false, code: e.code, marker: e.marker, msg: e.message }));

(async () => {
  const app = initializeApp({ apiKey: 'fake-api-key', projectId: process.env.GCLOUD_PROJECT });
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`, { disableWarnings: true });

  console.log('— 寄信');
  let r = await run(L.sendLoginLink({ email: 'new.user@gmail.com', ip: '1.1.1.1' }, deps));
  check('寄出登入連結', r.ok && sent.length === 1, r.msg);
  const mail = sent[0] || {};
  check('主旨固定', mail.subject === L.SUBJECT);
  const link = ((mail.text || '').match(/https:\/\/pickmycard\.app\/\S+/) || [])[0] || '';
  check('連結在自己的網域、帶 start（首次訪客不會被導去 landing）', link.startsWith('https://pickmycard.app/?start=1&'), link);
  check('前端判斷得出這是登入連結', isSignInWithEmailLink(auth, link));
  check('HTML 版本有按鈕與同一條連結', (mail.html || '').includes(link.replace(/&/g, '&')) && (mail.html || '').includes('登入 Pick My Card'));

  console.log('— 用信裡的連結登入（前端 SDK）');
  try {
    const cred = await signInWithEmailLink(auth, 'new.user@gmail.com', link);
    check('登入成功、email 已驗證', cred.user.email === 'new.user@gmail.com' && cred.user.emailVerified === true);
  } catch (e) { check('登入成功、email 已驗證', false, e.code); }
  const reuse = await run(signOut(auth).then(() => signInWithEmailLink(auth, 'new.user@gmail.com', link)));
  check('同一條連結不能用第二次', !reuse.ok, reuse.code);

  console.log('— 擋濫用');
  r = await run(L.sendLoginLink({ email: 'not-an-email', ip: '1.1.1.1' }, deps));
  check('格式錯誤', !r.ok && r.code === 'invalid-argument');
  r = await run(L.sendLoginLink({ email: 'x@mailinator.com', ip: '1.1.1.1' }, deps));
  check('拋棄式信箱', !r.ok && r.marker === 'PMC_SIGNUP_DISPOSABLE');
  sent.length = 0;
  const now = Date.parse('2026-10-03T04:10:00Z');
  const burst = [];
  for (let i = 0; i < 4; i++) burst.push(await run(L.sendLoginLink({ email: i % 2 ? 'v.ictim@gmail.com' : 'victim@gmail.com', ip: '2.2.2.2' }, deps, now)));
  check(`同一信箱一小時最多 ${L.LIMITS.inboxPerHour} 封（Gmail 變體合併計算）`, burst.slice(0, 3).every(x => x.ok) && !burst[3].ok && burst[3].code === 'resource-exhausted');
  check('被擋的那次沒有寄信', sent.length === 3);
  const later = [];
  for (let h = 1; h <= 3; h++) later.push(await run(L.sendLoginLink({ email: 'victim@gmail.com', ip: '2.2.2.2' }, deps, now + h * 3600e3)));
  // 被擋的嘗試也算進當天次數（狂按也會用掉額度）：上面 4 次＋這裡第 1 次＝5，第 2 次起擋
  check(`同一信箱一天最多 ${L.LIMITS.inboxPerDay} 次（被擋的嘗試也算）`, later[0].ok && !later[1].ok && !later[2].ok);
  let ipOk = 0;
  for (let i = 0; i < 32; i++) { const x = await run(L.sendLoginLink({ email: `person${i}@example.com`, ip: '3.3.3.3' }, deps, now)); if (x.ok) ipOk++; }
  check(`同一 IP 一小時最多 ${L.LIMITS.ipPerHour} 封`, ipOk === L.LIMITS.ipPerHour, String(ipOk));

  console.log('— 同一實體信箱已有帳號');
  await G.checkSignup({ email: 'owner@gmail.com', signInMethod: 'emailLink' });   // 登記信箱（模擬 guardSignup）
  r = await run(L.sendLoginLink({ email: 'o.w.n.e.r+2@gmail.com', ip: '4.4.4.4' }, deps));
  check('Gmail 變體（新帳號會被擋）→ 不寄信、直接說明', !r.ok && r.marker === 'PMC_SIGNUP_INBOX');

  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
