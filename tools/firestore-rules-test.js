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
const { doc, setDoc, getDoc, deleteDoc, addDoc, collection, deleteField, serverTimestamp } = require('firebase/firestore');

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
    try {
      await (expectOk ? assertSucceeds(fn()) : assertFails(fn()));
      pass++; console.log(`  ✅ ${expectOk ? '允許' : '擋下'}：${name}`);
    } catch (e) {
      fail++; console.error(`  ❌ 預期${expectOk ? '允許' : '擋下'}但結果相反：${name}\n     ${e.message}`);
    }
  }

  const me = env.authenticatedContext(ME).firestore();
  const blocked = env.authenticatedContext(BLOCKED).firestore();
  const guest = env.unauthenticatedContext().firestore();
  const iso = () => new Date().toISOString();
  const merge = { merge: true };
  const userRef = (db, uid = ME) => doc(db, 'users', uid);

  // 舊用戶文件：帶著前端已不再寫的歷史欄位，確認不影響之後的寫入
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'users', 'legacyUid'), { selectedCards: ['a'], quickSearchOptions: [{ id: 'x' }], someOldThing: 1 });
  });
  const legacy = env.authenticatedContext('legacyUid').firestore();

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
  await check('意見回報 feedback', true, () => addDoc(collection(me, 'feedback'), { userId: ME, message: '有問題', timestamp: serverTimestamp(), createdAt: iso() }));
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

  console.log('— Storage（意見回報附圖）');
  const jpg = new Uint8Array(2048);
  const up = (ctx, p, data = jpg, contentType = 'image/jpeg') => ctx.storage().ref(p).put(data, { contentType }).then(() => {});
  const meSt = env.authenticatedContext(ME);
  const ts = Date.now();
  await check('上傳自己的回報附圖', true, () => up(meSt, `feedback/${ts}_${ME}_0.jpg`));
  await check('上傳 png 原檔（canvas 用原始格式編碼）', true, () => up(meSt, `feedback/${ts}_${ME}_1.jpg`, jpg, 'image/png'));
  await check('上傳後取網址（getDownloadURL 需要 read）', true, () => meSt.storage().ref(`feedback/${ts}_${ME}_0.jpg`).getDownloadURL());
  await check('覆蓋已上傳的檔案', false, () => up(meSt, `feedback/${ts}_${ME}_0.jpg`));
  await check('刪除檔案', false, () => meSt.storage().ref(`feedback/${ts}_${ME}_0.jpg`).delete());
  await check('未登入上傳', false, () => up(env.unauthenticatedContext(), `feedback/${ts}_anonymous_0.jpg`));
  await check('用別人的 uid 當檔名', false, () => up(meSt, `feedback/${ts}_${OTHER}_0.jpg`));
  await check('第 6 張以上（編號 5）', false, () => up(meSt, `feedback/${ts}_${ME}_5.jpg`));
  await check('非圖片檔', false, () => up(meSt, `feedback/${ts}_${ME}_2.jpg`, jpg, 'application/zip'));
  await check('超過 5MB', false, () => up(meSt, `feedback/${ts}_${ME}_3.jpg`, new Uint8Array(5 * 1024 * 1024 + 1)));
  await check('上傳到其他路徑', false, () => up(meSt, `anything/${ME}.jpg`));
  await check('封鎖帳號上傳', false, () => up(env.authenticatedContext(BLOCKED), `feedback/${ts}_${BLOCKED}_0.jpg`));
  await check('讀別人的附圖', false, () => env.authenticatedContext(OTHER).storage().ref(`feedback/${ts}_${ME}_0.jpg`).getDownloadURL());

  await env.cleanup();
  console.log(`\n結果：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
