#!/usr/bin/env node
/*
 * 每帳號寫入上限：前端寫入包裝（index.html 的 rlCommit／limitedSetDoc…）實測
 * ——直接從 index.html 擷取那段程式碼原文，接上真的 Firebase SDK 與 Firestore 模擬器跑，
 * 確認「網站的寫法」能通過 firestore.rules、超過上限會被擋、錯誤會照原樣往外丟。
 *
 * 用法同 tools/firestore-rules-test.js（同一組 NODE_PATH／firebase.json）：
 *   NODE_PATH=/tmp/rt/node_modules /tmp/rt/node_modules/.bin/firebase emulators:exec \
 *     --config <firebase.json> --only firestore --project demo-pmc "node tools/rate-limit-client-test.js"
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const fsSdk = require('firebase/firestore');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('      const reportFsError = ');
const end = html.indexOf('window.addDoc = reportFsError(limitedAddDoc);');
if (start < 0 || end < 0) { console.error('❌ index.html 找不到寫入包裝那段程式碼'); process.exit(1); }
const snippet = html.slice(start, end + 'window.addDoc = reportFsError(limitedAddDoc);'.length);

(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-pmc',
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') }
  });
  await env.clearFirestore();   // 每次從空資料庫開始
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => { if (ok) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); } };

  // 把 index.html 那段程式碼放進一個「假的 window」執行，回傳它掛上的 window.setDoc 等
  function loadWrapper(uid) {
    const db = env.authenticatedContext(uid).firestore();
    const win = { notices: [] };
    win.pmcOnFirestoreError = (err) => win.notices.push(err && err.code);
    const auth = { currentUser: { uid } };
    const fn = new Function('window', 'auth', 'db', ...Object.keys(fsSdk), snippet + '\nreturn window;');
    fn(win, auth, db, ...Object.values(fsSdk));
    return { win, db };
  }
  const readCounter = async (uid) => {
    let data = null;
    await env.withSecurityRulesDisabled(async (ctx) => { data = (await fsSdk.getDoc(fsSdk.doc(ctx.firestore(), 'rateLimits', uid))).data() || null; });
    return data;
  };
  const readDoc = async (p) => {
    let data = null;
    await env.withSecurityRulesDisabled(async (ctx) => { data = (await fsSdk.getDoc(fsSdk.doc(ctx.firestore(), ...p.split('/')))).data() || null; });
    return data;
  };

  console.log('— 網站寫法（index.html 原文）');
  const { win, db } = loadWrapper('alice');
  const W = win;
  const userRef = W.doc(db, 'users', 'alice');
  try { await W.setDoc(userRef, { cardsInComparison: ['cathay-cube'], updatedAt: new Date().toISOString() }, { merge: true }); check('首次寫入 users（計數文件還不存在）', true); }
  catch (e) { check('首次寫入 users（計數文件還不存在）', false, e.code); }
  const c1 = await readCounter('alice');
  check('計數從 1 開始', c1 && c1.count === 1, JSON.stringify(c1 && c1.count));
  try { await W.setDoc(W.doc(db, 'cardSettings', 'alice_cathay-cube'), { level: 'Level 2', updatedAt: new Date(), cardId: 'cathay-cube' }); check('卡片級別（setDoc 不帶 merge）', true); }
  catch (e) { check('卡片級別（setDoc 不帶 merge）', false, e.code); }
  try { await W.setDoc(W.doc(db, 'userNotes', 'alice_cathay-cube'), { notes: 'hi', updatedAt: new Date(), cardId: 'cathay-cube' }); check('卡片筆記', true); }
  catch (e) { check('卡片筆記', false, e.code); }
  // 意見回報：先預約今天的額度（feedbackQuota，不算寫入上限），再用預約 ID 寫回報
  try {
    const t = new Date(Date.now() + 8 * 3600e3);
    const day = t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
    await fsSdk.setDoc(fsSdk.doc(db, 'feedbackQuota', 'alice'), { day, count: 1 });
    await W.setDoc(W.doc(db, 'feedback', `alice_${day}_1`), { userId: 'alice', message: '測試', timestamp: fsSdk.serverTimestamp() });
    check('意見回報（預約額度後用預約 ID 寫入）', true);
  } catch (e) { check('意見回報（預約額度後用預約 ID 寫入）', false, e.code + ' ' + String(e.message).slice(0, 300)); }
  try { await W.deleteDoc(W.doc(db, 'userNotes', 'alice_cathay-cube')); check('刪除筆記', true); }
  catch (e) { check('刪除筆記', false, e.code); }
  check('寫入都真的存進去了', (await readDoc('cardSettings/alice_cathay-cube'))?.level === 'Level 2' && (await readDoc('users/alice'))?.cardsInComparison?.[0] === 'cathay-cube');
  check('一般寫入沒有觸發錯誤提示', win.notices.length === 0, JSON.stringify(win.notices));

  console.log('— 同時送出多筆（排隊一筆一筆送）');
  const rs = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => W.setDoc(userRef, { selectedOrder: ['p' + i] }, { merge: true })));
  check('同時 10 筆全部成功', rs.every(r => r.status === 'fulfilled'), rs.filter(r => r.status === 'rejected').map(r => r.reason && r.reason.code).join(','));
  const c2 = await readCounter('alice');
  check('計數正確累加（5 + 10 = 15）', c2 && c2.count === 15, String(c2 && c2.count));

  console.log('— 超過上限');
  let ok = 0, errCode = null;
  for (let i = 0; i < 100; i++) {
    try { await W.setDoc(userRef, { selectedOrder: [String(i)] }, { merge: true }); ok++; }
    catch (e) { errCode = e.code; break; }
  }
  check(`第 100 筆之後被擋（這輪成功 ${ok} 筆，加上前面 15 筆）`, ok === 85 && errCode === 'permission-denied', `ok=${ok} err=${errCode}`);
  check('被擋時觸發錯誤提示（pmcOnFirestoreError）', win.notices.includes('permission-denied'));

  console.log('— 視窗過期後自動恢復');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fsSdk.setDoc(fsSdk.doc(ctx.firestore(), 'rateLimits', 'alice'), { windowStart: fsSdk.Timestamp.fromMillis(Date.now() - 11 * 60 * 1000) }, { merge: true });
  });
  try { await W.setDoc(userRef, { selectedOrder: ['again'] }, { merge: true }); check('10 分鐘後又能寫', true); }
  catch (e) { check('10 分鐘後又能寫', false, e.code); }
  const c3 = await readCounter('alice');
  check('新視窗計數從 1 開始', c3 && c3.count === 1, String(c3 && c3.count));

  console.log('— 規則不允許的寫入：錯誤原樣丟出');
  try { await W.setDoc(userRef, { lastThread: 1 }, { merge: true }); check('未知欄位被擋', false); }
  catch (e) { check('未知欄位被擋（permission-denied）', e.code === 'permission-denied', e.code); }

  console.log('— 刪除帳號（約 67 筆刪除）在上限內');
  const { win: W2, db: db2 } = loadWrapper('bob');
  await W2.setDoc(W2.doc(db2, 'users', 'bob'), { cardsInComparison: [] , updatedAt: 'x' }, { merge: true });
  const refs = [];
  for (let i = 0; i < 33; i++) { refs.push(W2.doc(db2, 'cardSettings', `bob_card-${i}`)); refs.push(W2.doc(db2, 'userNotes', `bob_card-${i}`)); }
  const del = [];
  for (let i = 0; i < refs.length; i += 20) del.push(...await Promise.allSettled(refs.slice(i, i + 20).map(r => W2.deleteDoc(r))));
  const delUser = await W2.deleteDoc(W2.doc(db2, 'users', 'bob')).then(() => true, () => false);
  check(`66 筆卡片文件＋users 全部刪除成功`, del.every(r => r.status === 'fulfilled') && delUser, `失敗 ${del.filter(r => r.status === 'rejected').length} 筆`);

  await env.cleanup();
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
