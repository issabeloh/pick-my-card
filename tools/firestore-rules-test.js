#!/usr/bin/env node
/*
 * Firestore ＋ Storage 安全規則測試（用本機模擬器，不碰正式資料庫、不產生費用）
 *
 * 驗證兩件事：
 *   1. 網站實際會做的每一種寫入（欄位形狀照抄 js/ 裡的 setDoc/addDoc/deleteDoc）都還能過
 *   2. 濫用寫法（亂加欄位、亂取文件 ID、未登入寫入、封鎖帳號）都會被擋
 * 改了 firestore.rules、或前端新增寫入 Firestore 的欄位時都要跑。
 *
 * 需要 Java（模擬器是 Java 程式）。用法（在 repo 根目錄）：
 *   mkdir -p /tmp/rt && (cd /tmp/rt && npm init -y >/dev/null && \
 *     npm install firebase-tools @firebase/rules-unit-testing firebase --no-fund --no-audit --loglevel=error)
 *   NODE_PATH=/tmp/rt/node_modules /tmp/rt/node_modules/.bin/firebase emulators:exec \
 *     --only firestore,storage --project demo-pmc "node tools/firestore-rules-test.js"
 * 全部通過 exit 0；任何一條不符預期 exit 1。
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, collection, deleteField, serverTimestamp, writeBatch, increment, Timestamp,
  setDoc: rawSetDoc, deleteDoc: rawDeleteDoc, addDoc: rawAddDoc
} = require('firebase/firestore');

// ── 用和網站一樣的方式寫入（照抄 index.html 的 rlCommit）：登入者每筆寫入都和
//    rateLimits/{uid} 計數同一批送出；先試「延續視窗 +1」，被拒再試「開新視窗」。
//    哪個 Firestore 實例屬於哪個 uid 記在 uidOf；訪客（沒有 uid）照舊直接寫。
const uidOf = new WeakMap();
const RL_COLLECTIONS = ['users', 'cardSettings', 'userNotes', 'feedback'];
async function rlCommit(db, ref, addOp) {
  const counter = doc(db, 'rateLimits', uidOf.get(db));   // db 是底層實例（ref.firestore）
  const attempt = (fresh) => {
    const b = writeBatch(db);
    addOp(b);
    b.set(counter, fresh
      ? { windowStart: serverTimestamp(), count: 1, lastAt: serverTimestamp(), lastPath: ref.path }
      : { count: increment(1), lastAt: serverTimestamp(), lastPath: ref.path }, { merge: true });
    return b.commit();
  };
  try { await attempt(false); } catch (e) {
    if (!e || e.code !== 'permission-denied') throw e;
    await attempt(true);
  }
}
const limited = (ref) => uidOf.has(ref.firestore) && RL_COLLECTIONS.includes(ref.parent.id);
const setDoc = (ref, data, o) => limited(ref)
  ? rlCommit(ref.firestore, ref, (b) => (o ? b.set(ref, data, o) : b.set(ref, data)))
  : rawSetDoc(ref, data, o);
const deleteDoc = (ref) => limited(ref) ? rlCommit(ref.firestore, ref, (b) => b.delete(ref)) : rawDeleteDoc(ref);
const addDoc = (coll, data) => {
  const ref = doc(coll);
  return limited(ref) ? rlCommit(coll.firestore, ref, (b) => b.set(ref, data)).then(() => ref) : rawAddDoc(coll, data);
};

// 照抄 js/quick-options-misc.js 的 reserveFeedbackSlot：預約一則回報額度，回傳 key（額度用完回傳 null）
const taiwanDayKey = (ms = Date.now()) => { const t = new Date(ms + 8 * 3600e3); return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate(); };
async function reserveFeedback(db, uid) {
  const ref = doc(db, 'feedbackQuota', uid);
  const snap = await getDoc(ref);
  const q = snap.exists() ? snap.data() : null;
  const day = taiwanDayKey();
  const sameDay = !!(q && q.day === day);
  if (sameDay && q.count >= 5) return null;
  try { await (sameDay ? rawSetDoc(ref, { day, count: increment(1) }, { merge: true }) : rawSetDoc(ref, { day, count: 1 })); }
  catch (e) { if (e && e.code === 'permission-denied') return null; throw e; }
  const after = (await getDoc(ref)).data();
  return `${uid}_${after.day}_${after.count}`;
}

const BLOCKED = 'GNEzbVzqwGh9UkMfvo4fPwXAmZy2';
const ME = 'aliceUid123';
const OTHER = 'bobUid456';

(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  const [sHost, sPort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199').split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-pmc',
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
    storage: { host: sHost, port: Number(sPort), rules: fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8') }
  });

  let pass = 0, fail = 0;
  async function check(name, expectOk, fn) {
    if (typeof expectOk === 'boolean' && fn === undefined) {   // check(name, 條件成立與否)
      if (expectOk) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name}`); }
      return;
    }
    try {
      await (expectOk ? assertSucceeds(fn()) : assertFails(fn()));
      pass++; console.log(`  ✅ ${expectOk ? '允許' : '擋下'}：${name}`);
    } catch (e) {
      fail++; console.error(`  ❌ 預期${expectOk ? '允許' : '擋下'}但結果相反：${name}\n     ${e.message}`);
    }
  }

  // rules-unit-testing 回傳的是相容層包裝；ref.firestore 拿到的是底層實例，兩個都記
  const authed = (uid, opts) => {
    const db = env.authenticatedContext(uid, opts).firestore();
    uidOf.set(db, uid); uidOf.set(doc(db, 'x', 'y').firestore, uid);
    return db;
  };
  const me = authed(ME);
  const blocked = authed(BLOCKED);
  const guest = env.unauthenticatedContext().firestore();
  const iso = () => new Date().toISOString();
  const merge = { merge: true };
  const userRef = (db, uid = ME) => doc(db, 'users', uid);

  // 舊用戶文件：帶著前端已不再寫的歷史欄位，確認不影響之後的寫入
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'users', 'legacyUid'), { selectedCards: ['a'], quickSearchOptions: [{ id: 'x' }], someOldThing: 1 });
  });
  const legacy = authed('legacyUid');

  console.log('— 網站實際寫入（全部應允許）');
  await check('首次登入建立 users（cardsInComparison）', true, () => setDoc(userRef(me), { cardsInComparison: ['cathay-cube'], updatedAt: iso() }, merge));
  await check('myOwnedCards', true, () => setDoc(userRef(me), { myOwnedCards: ['cathay-cube'], updatedAt: iso() }, merge));
  await check('selectedPayments', true, () => setDoc(userRef(me), { selectedPayments: ['LINE_PAY'], updatedAt: iso() }, merge));
  await check('spendingMappings', true, () => setDoc(userRef(me), { spendingMappings: [{ id: 'm1', merchant: '蝦皮', cardId: 'cathay-cube', cashbackRate: 3 }], updatedAt: iso() }, merge));
  await check('feeWaiverStatus', true, () => setDoc(userRef(me), { feeWaiverStatus: { 'cathay-cube': true }, updatedAt: iso() }, merge));
  await check('creditLimits', true, () => setDoc(userRef(me), { creditLimits: { 'cathay-cube': 50000 }, updatedAt: iso() }, merge));
  await check('billingDates', true, () => setDoc(userRef(me), { billingDates: { 'cathay-cube': { billingDate: '5', statementDate: '20' } }, updatedAt: iso() }, merge));
  await check('birthdayMonth', true, () => setDoc(userRef(me), { birthdayMonth: 5, updatedAt: iso() }, merge));
  await check('cubeIssuer', true, () => setDoc(userRef(me), { cubeIssuer: 'Mastercard', updatedAt: iso() }, merge));
  await check('isChildrenEligible', true, () => setDoc(userRef(me), { isChildrenEligible: false, updatedAt: iso() }, merge));
  await check('快捷選項偏好', true, () => setDoc(userRef(me), { hiddenDefaultIds: ['a'], customQuickOptions: [], selectedOrder: ['b'] }, merge));
  await check('配卡自訂商家名稱 merchantAliases', true, () => setDoc(userRef(me), { merchantAliases: { shopee: '蝦皮' }, updatedAt: iso() }, merge));
  await check('配卡標題 mappingsTitle 設定', true, () => setDoc(userRef(me), { mappingsTitle: '我的刷卡表', updatedAt: iso() }, merge));
  await check('配卡標題 mappingsTitle 清除（deleteField）', true, () => setDoc(userRef(me), { mappingsTitle: deleteField(), updatedAt: iso() }, merge));
  await check('舊格式快捷選項遷移（刪 quickSearchOptions）', true, () => setDoc(userRef(legacy, 'legacyUid'), { hiddenDefaultIds: [], customQuickOptions: [], selectedOrder: [], quickSearchOptions: deleteField() }, merge));
  await check('有歷史欄位的舊文件照常更新', true, () => setDoc(userRef(legacy, 'legacyUid'), { selectedPayments: ['JKOPAY'], updatedAt: iso() }, merge));
  await check('讀自己的 users', true, () => getDoc(userRef(me)));
  await check('卡片級別 saveCardLevel', true, () => setDoc(doc(me, 'cardSettings', `${ME}_cathay-cube`), { level: 'Level 2', updatedAt: new Date(), cardId: 'cathay-cube' }));
  await check('讀卡片級別', true, () => getDoc(doc(me, 'cardSettings', `${ME}_cathay-cube`)));
  await check('卡片筆記 saveUserNotes', true, () => setDoc(doc(me, 'userNotes', `${ME}_cathay-cube`), { notes: '記得綁定', updatedAt: new Date(), cardId: 'cathay-cube' }));
  await check('讀卡片筆記', true, () => getDoc(doc(me, 'userNotes', `${ME}_cathay-cube`)));
  await check('意見回報 feedback（先預約額度、ID 綁預約）', true, async () => {
    const key = await reserveFeedback(me, ME);
    return setDoc(doc(me, 'feedback', key), { userId: ME, message: '有問題', timestamp: serverTimestamp(), createdAt: iso() });
  });
  await check('刪除帳號：刪級別', true, () => deleteDoc(doc(me, 'cardSettings', `${ME}_cathay-cube`)));
  await check('刪除帳號：刪筆記', true, () => deleteDoc(doc(me, 'userNotes', `${ME}_cathay-cube`)));
  await check('刪除帳號：刪不存在的文件（他卡）', true, () => deleteDoc(doc(me, 'userNotes', `${ME}_dbs-eco`)));
  await check('刪除帳號：刪 users', true, () => deleteDoc(userRef(me)));

  console.log('— 濫用寫法（全部應擋下）');
  await check('users 寫入未知欄位（如 lastThread）', false, () => setDoc(userRef(me), { lastThread: 22, updatedAt: iso() }, merge));
  await check('users 寫別人的文件', false, () => setDoc(userRef(me, OTHER), { selectedPayments: [] }, merge));
  await check('未登入寫 users', false, () => setDoc(userRef(guest, ME), { selectedPayments: [] }, merge));
  await check('封鎖帳號寫自己的 users', false, () => setDoc(userRef(blocked, BLOCKED), { selectedPayments: ['LINE_PAY'] }, merge));
  await check('封鎖帳號寫卡片級別', false, () => setDoc(doc(blocked, 'cardSettings', `${BLOCKED}_cathay-cube`), { level: 'x', updatedAt: new Date(), cardId: 'cathay-cube' }));
  await check('封鎖帳號送 feedback', false, () => addDoc(collection(blocked, 'feedback'), { userId: BLOCKED, message: 'spam' }));
  await check('卡片級別：文件 ID 與 cardId 不一致', false, () => setDoc(doc(me, 'cardSettings', `${ME}_spam1`), { level: 'x', updatedAt: new Date(), cardId: 'cathay-cube' }));
  await check('卡片級別：cardId 格式不像卡片', false, () => setDoc(doc(me, 'cardSettings', `${ME}_SPAM_${'x'.repeat(50)}`), { level: 'x', updatedAt: new Date(), cardId: `SPAM_${'x'.repeat(50)}` }));
  await check('卡片級別：多塞欄位', false, () => setDoc(doc(me, 'cardSettings', `${ME}_cathay-cube`), { level: 'x', updatedAt: new Date(), cardId: 'cathay-cube', junk: 'a' }));
  await check('卡片級別：寫別人的', false, () => setDoc(doc(me, 'cardSettings', `${OTHER}_cathay-cube`), { level: 'x', updatedAt: new Date(), cardId: 'cathay-cube' }));
  await check('卡片筆記：多塞欄位', false, () => setDoc(doc(me, 'userNotes', `${ME}_cathay-cube`), { notes: 'a', updatedAt: new Date(), cardId: 'cathay-cube', junk: 1 }));
  await check('未登入送 reviews（已停用）', false, () => addDoc(collection(guest, 'reviews'), { rating: 5, comment: null }));
  await check('登入者送 reviews（已停用）', false, () => addDoc(collection(me, 'reviews'), { rating: 5 }));
  await check('未登入送 feedback', false, () => addDoc(collection(guest, 'feedback'), { userId: 'x', message: 'hi' }));
  await check('寫入未定義的 collection', false, () => setDoc(doc(me, 'anything', 'x'), { a: 1 }));

  console.log('— 封鎖：第二個帳號');
  await check('第二個封鎖 uid 寫 users', false, () => setDoc(doc(authed('bQzrQFDmyCQrZ3AapnG10Ff8avh2'), 'users', 'bQzrQFDmyCQrZ3AapnG10Ff8avh2'), { selectedPayments: [] }, merge));

  console.log('— 每帳號寫入上限（rateLimits）');
  const rl = authed('rlUser');
  const rlRef = doc(rl, 'users', 'rlUser');
  await check('沒有一起更新計數的直接寫入', false, () => rawSetDoc(rlRef, { selectedPayments: [] }, merge));
  await check('一次計數塞兩筆寫入（批次作弊）', false, () => {
    const b = writeBatch(rl);
    b.set(rlRef, { selectedPayments: [] }, merge);
    b.set(doc(rl, 'cardSettings', 'rlUser_cathay-cube'), { level: 'L1', updatedAt: new Date(), cardId: 'cathay-cube' });
    b.set(doc(rl, 'rateLimits', 'rlUser'), { windowStart: serverTimestamp(), count: 1, lastAt: serverTimestamp(), lastPath: 'users/rlUser' }, merge);
    return b.commit();
  });
  let okCount = 0;
  for (let i = 0; i < 100; i++) { try { await setDoc(rlRef, { selectedOrder: [String(i)] }, merge); okCount++; } catch (e) { break; } }
  await check(`10 分鐘內前 100 筆都成功（實際 ${okCount}）`, okCount === 100);
  await check('第 101 筆被擋', false, () => setDoc(rlRef, { selectedOrder: ['x'] }, merge));
  await check('超過上限後刪除也被擋', false, () => deleteDoc(doc(rl, 'cardSettings', 'rlUser_dbs-eco')));
  await check('自己把計數改小', false, () => rawSetDoc(doc(rl, 'rateLimits', 'rlUser'), { count: 1, lastAt: serverTimestamp(), lastPath: 'users/rlUser' }, merge));
  await check('視窗沒過期就開新視窗', false, () => rawSetDoc(doc(rl, 'rateLimits', 'rlUser'), { windowStart: serverTimestamp(), count: 1, lastAt: serverTimestamp(), lastPath: 'users/rlUser' }, merge));
  await check('刪除計數文件（歸零）', false, () => rawDeleteDoc(doc(rl, 'rateLimits', 'rlUser')));
  await check('寫別人的計數', false, () => rawSetDoc(doc(me, 'rateLimits', 'rlUser'), { windowStart: serverTimestamp(), count: 1, lastAt: serverTimestamp(), lastPath: 'users/rlUser' }));
  await check('讀自己的計數', true, () => getDoc(doc(rl, 'rateLimits', 'rlUser')));
  // 模擬 10 分鐘過去：把視窗起點改到 11 分鐘前
  await env.withSecurityRulesDisabled(async (ctx) => {
    await rawSetDoc(doc(ctx.firestore(), 'rateLimits', 'rlUser'), { windowStart: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000) }, merge);
  });
  await check('視窗過期後又能寫（自動開新視窗）', true, () => setDoc(rlRef, { selectedOrder: ['after'] }, merge));
  let c = {};
  await env.withSecurityRulesDisabled(async (ctx) => { c = (await getDoc(doc(ctx.firestore(), 'rateLimits', 'rlUser'))).data() || {}; });
  await check(`新視窗計數從 1 開始（實際 ${c.count}）`, c.count === 1);

  console.log('— 回報額度（每天 5 則）');
  const fq = authed('fqUser');
  await check('沒預約就送回報（自動 ID）', false, () => addDoc(collection(fq, 'feedback'), { userId: 'fqUser', message: 'x' }));
  const keys = [];
  for (let i = 0; i < 5; i++) keys.push(await reserveFeedback(fq, 'fqUser'));
  await check('同一天預約 5 次都成功', keys.every(Boolean));
  await check('第 6 次預約被擋（前端預先擋）', (await reserveFeedback(fq, 'fqUser')) === null);
  await check('繞過前端直接把計數加到 6', false, () => rawSetDoc(doc(fq, 'feedbackQuota', 'fqUser'), { day: taiwanDayKey(), count: increment(1) }, merge));
  await check('用最新預約送出回報', true, () => setDoc(doc(fq, 'feedback', keys[4]), { userId: 'fqUser', message: '第五則' }));
  await check('同一個預約送第二則（覆蓋）', false, () => setDoc(doc(fq, 'feedback', keys[4]), { userId: 'fqUser', message: '再一則' }));
  await check('用舊的預約 ID 送回報', false, () => setDoc(doc(fq, 'feedback', keys[0]), { userId: 'fqUser', message: '舊的' }));
  await check('自己把計數改小', false, () => rawSetDoc(doc(fq, 'feedbackQuota', 'fqUser'), { day: taiwanDayKey(), count: 1 }));
  await check('偽造成別天來歸零', false, () => rawSetDoc(doc(fq, 'feedbackQuota', 'fqUser'), { day: taiwanDayKey() + 1, count: 1 }));
  await check('刪除額度文件', false, () => rawDeleteDoc(doc(fq, 'feedbackQuota', 'fqUser')));
  await check('改別人的額度', false, () => rawSetDoc(doc(me, 'feedbackQuota', 'fqUser'), { day: taiwanDayKey(), count: 1 }));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await rawSetDoc(doc(ctx.firestore(), 'feedbackQuota', 'fqUser'), { day: taiwanDayKey(Date.now() - 24 * 3600e3), count: 5 });
  });
  const keyAfter = await reserveFeedback(fq, 'fqUser');
  await check('換日後又能預約（從第 1 則開始）', !!keyAfter && keyAfter.endsWith('_1'));

  console.log('— Storage（意見回報附圖）');
  const jpg = new Uint8Array(2048);
  const up = (ctx, p, data = jpg, contentType = 'image/jpeg') => ctx.storage().ref(p).put(data, { contentType }).then(() => {});
  const stCtx = env.authenticatedContext('stUser');
  const stDb = authed('stUser');
  await check('檔名用昨天的日期', false, () => up(stCtx, `feedback/stUser_${taiwanDayKey(Date.now() - 24 * 3600e3)}_1_0.jpg`));
  await check('今天第 6 則（編號 6）', false, () => up(stCtx, `feedback/stUser_${taiwanDayKey()}_6_0.jpg`));
  const k1 = await reserveFeedback(stDb, 'stUser');
  await check('上傳這次預約的第 1 張', true, () => up(stCtx, `feedback/${k1}_0.jpg`));
  await check('第 2 張', true, () => up(stCtx, `feedback/${k1}_1.jpg`));
  await check('第 3 張', true, () => up(stCtx, `feedback/${k1}_2.jpg`));
  await check('第 4 張（超過 3 張）', false, () => up(stCtx, `feedback/${k1}_3.jpg`));
  await check('上傳後取網址（getDownloadURL 需要 read）', true, () => stCtx.storage().ref(`feedback/${k1}_0.jpg`).getDownloadURL());
  await check('覆蓋已上傳的檔案', false, () => up(stCtx, `feedback/${k1}_0.jpg`));
  await check('刪除檔案', false, () => stCtx.storage().ref(`feedback/${k1}_0.jpg`).delete());
  const k2 = await reserveFeedback(stDb, 'stUser');
  await check('檔名格式不對', false, () => up(stCtx, `feedback/${k1}_2b.jpg`));
  await check('新預約的第 1 張', true, () => up(stCtx, `feedback/${k2}_0.jpg`));
  await check('非 JPEG（png）', false, () => up(stCtx, `feedback/${k2}_1.jpg`, jpg, 'image/png'));
  await check('超過 2MB', false, () => up(stCtx, `feedback/${k2}_1.jpg`, new Uint8Array(2 * 1024 * 1024 + 1)));
  await check('未登入上傳', false, () => up(env.unauthenticatedContext(), `feedback/${k2}_1.jpg`));
  await check('用別人的預約檔名上傳', false, () => up(env.authenticatedContext(OTHER), `feedback/${k2}_1.jpg`));
  await check('上傳到其他路徑', false, () => up(stCtx, `anything/stUser.jpg`));
  await check('封鎖帳號上傳', false, () => up(env.authenticatedContext(BLOCKED), `feedback/${BLOCKED}_${taiwanDayKey()}_1_0.jpg`));
  await check('讀別人的附圖', false, () => env.authenticatedContext(OTHER).storage().ref(`feedback/${k1}_0.jpg`).getDownloadURL());

  await env.cleanup();
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
