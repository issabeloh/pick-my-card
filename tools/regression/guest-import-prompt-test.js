#!/usr/bin/env node
/**
 * 登入時「這些設定是你的嗎？」— 功能回歸測試（2026-11-23 新增）
 *
 * 為什麼存在：共用電腦上，前一位訪客留下的設定（額度、級別、持有卡、刷卡小抄…）以前會被
 * 靜默寫進下一位登入者的帳號。現在登入時只要這台裝置上有訪客資料，就先跳確認
 * （js/auth-user-data.js 的 resolveGuestDataOnLogin）。這支守的是「選不要就一筆都不能進帳號」。
 *
 * 用法（repo 根目錄；playwright 用環境預裝的即可）：
 *   node tools/regression/guest-import-prompt-test.js   # 全部通過 → exit 0，任一失敗 → exit 1
 *
 * 守的機制：
 *   A. 這台裝置沒有訪客資料 → 不跳對話框
 *   B. 有訪客資料 → 跳對話框並列出項目；選「不是，清掉」→ 訪客 key 全清、沒有任何訪客值寫進雲端
 *   C. 選「是，存進我的帳號」→ 額度、持有卡、級別照舊帶入（雲端沒值才帶，規則見 storage-and-security.md 第 4 節）
 *
 * Firebase 替身沿用 delete-account-test.js 的寫法（已登入用戶），setDoc 改成會記錄寫入內容。
 * ⚠️ index.html 的 Firebase import 清單增修時，stub() 的 export 要同步補。
 */
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { completeFirebaseStub } = require('../lib/firebase-stub-guard');
let chromium;
try { ({ chromium } = require(path.join(REPO, 'node_modules', 'playwright'))); }
catch (e) { ({ chromium } = require('playwright')); }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.data': 'text/plain', '.version': 'text/plain', '.json': 'application/json', '.txt': 'text/plain' };

function stub(url) { return completeFirebaseStub(url, stubRaw(url)); }
function stubRaw(url) {
  const R = 'Promise.resolve()';
  if (url.includes('firebase-app')) return 'export function initializeApp(){return {};}';
  if (url.includes('firebase-analytics')) return 'export function getAnalytics(){return {};} export function logEvent(){} export function setUserProperties(){}';
  if (url.includes('firebase-auth')) return `
    const USER = { uid:'testuid', email:'test@example.com', displayName:'測試用戶', photoURL:'', providerData:[{ providerId:'google.com' }] };
    const AUTH = { currentUser: USER };
    export function getAuth(){ return AUTH; }
    export function onAuthStateChanged(auth, cb){ setTimeout(()=>cb(USER),0); }
    export class GoogleAuthProvider { setCustomParameters(){} }
    export function signInWithPopup(){return ${R};}
    export function signOut(){return ${R};}
    export function createUserWithEmailAndPassword(){return ${R};}
    export function signInWithEmailAndPassword(){return ${R};}
    export function sendPasswordResetEmail(){return ${R};}
    export function deleteUser(){return ${R};}
    export function reauthenticateWithPopup(){return ${R};}
    export function reauthenticateWithCredential(){return ${R};}
    export class EmailAuthProvider { static credential(){return {};} }`;
  if (url.includes('firebase-firestore')) return `
    globalThis.__writes = [];
    export function getFirestore(){return {};}
    export function doc(db, coll, id){ return { __coll: coll, __id: id }; }
    export function getDoc(){return Promise.resolve({ exists:()=>false, data:()=>undefined });}
    export function setDoc(ref, data){ globalThis.__writes.push({ path: ref.__coll + '/' + ref.__id, data: JSON.parse(JSON.stringify(data || {})) }); return ${R}; }
    export function addDoc(){return ${R};}
    export function collection(){return {};}
    export function serverTimestamp(){return 0;}
    export function deleteField(){return 0;}
    export function deleteDoc(){return ${R};}
    export function writeBatch(){ return { set(){}, delete(){}, commit(){ return Promise.resolve(); } }; }
    export function increment(n){ return n; }`;
  if (url.includes('firebase-storage')) return `
    export function getStorage(){return {};} export function ref(){return {};}
    export function uploadBytes(){return ${R};} export function getDownloadURL(){return Promise.resolve('');}`;
  return 'export default {};';
}

// 前一位訪客留下的資料（卡片 id／級別名稱要在 cards.data 裡存在）
const GUEST = {
  'myOwnedCards_guest': JSON.stringify(['kgi-eslite']),
  'creditLimit_local_kgi-eslite': '80000',
  'cardLevel-cathay-cube': 'Level 2',
  'feeWaiver_local_kgi-eslite': 'true'
};

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log((ok ? '  ✅ ' : '  ❌ ') + name + (!ok && extra ? ' — ' + extra : '')); };

(async () => {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(REPO, p === '/' ? 'index.html' : p);
    if (!f.startsWith(REPO) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  async function openWith(seed) {
    const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
    pg.on('pageerror', e => console.log('   PAGE ERROR:', e.message));
    await pg.addInitScript(s => { if (!sessionStorage.getItem('__seeded')) { Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)); sessionStorage.setItem('__seeded', '1'); } }, seed);
    await pg.route('**/*', route => {
      const u = route.request().url();
      if (u.startsWith(base)) return route.continue();
      if (u.includes('gstatic.com/firebasejs')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: stub(u) });
      return route.abort();
    });
    await pg.goto(base + '/index.html?start&debug=1', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser, { timeout: 20000 });
    return pg;
  }
  const guestKeysLeft = pg => pg.evaluate(keys => keys.filter(k => localStorage.getItem(k) !== null), Object.keys(GUEST));
  const writes = pg => pg.evaluate(() => globalThis.__writes || []);
  const loginDone = pg => pg.waitForFunction(() => { const e = document.querySelector('.card-count'); return e && !e.classList.contains('loading'); }, { timeout: 20000 });

  // ===== A. 沒有訪客資料 → 不問 =====
  console.log('\n【A】這台裝置沒有訪客資料');
  let pg = await openWith({});
  await loginDone(pg);
  await pg.waitForTimeout(500);
  check('不跳確認對話框', !(await pg.isVisible('#guest-import-modal')));
  await pg.close();

  // ===== B. 有訪客資料，選「不要」 =====
  console.log('\n【B】有訪客資料，選「不是，清掉」');
  pg = await openWith(GUEST);
  await pg.waitForSelector('#guest-import-modal', { timeout: 15000 });
  const items = await pg.textContent('.gi-items');
  check('對話框列出項目', ['我的信用卡 1 張', '我的額度 1 張', '卡片級別 1 張', '免年費 1 張'].every(t => items.includes(t)), items);
  check('沒有關閉鈕（一定要二選一）', (await pg.$$('#guest-import-modal .close-modal')).length === 0);
  check('對話框開著時還沒寫任何東西進帳號', (await writes(pg)).length === 0, JSON.stringify(await writes(pg)));
  await pg.click('#gi-discard');
  await loginDone(pg);
  await pg.waitForTimeout(500);
  check('對話框關閉', !(await pg.isVisible('#guest-import-modal')));
  check('訪客 key 全部清掉', (await guestKeysLeft(pg)).length === 0, JSON.stringify(await guestKeysLeft(pg)));
  let w = JSON.stringify(await writes(pg));
  check('額度沒有寫進帳號', !w.includes('80000'), w.slice(0, 300));
  check('持有卡沒有寫進帳號', !/myOwnedCards[^\]]*kgi-eslite/.test(w), w.slice(0, 300));
  check('級別沒有寫進帳號', !w.includes('cardSettings/testuid_cathay-cube'), w.slice(0, 300));
  check('畫面上的持有卡不含前一位訪客的卡', !(await pg.evaluate(() => myOwnedCards.has('kgi-eslite'))));
  await pg.close();

  // ===== C. 有訪客資料，選「是，存進我的帳號」 =====
  console.log('\n【C】有訪客資料，選「是，存進我的帳號」');
  pg = await openWith(GUEST);
  await pg.waitForSelector('#guest-import-modal', { timeout: 15000 });
  await pg.click('#gi-import');
  await loginDone(pg);
  await pg.waitForTimeout(800);
  w = JSON.stringify(await writes(pg));
  check('額度寫進帳號', /creditLimits[^}]*"kgi-eslite":80000/.test(w), w.slice(0, 300));
  check('持有卡寫進帳號', /myOwnedCards[^\]]*kgi-eslite/.test(w), w.slice(0, 300));
  check('級別寫進帳號', w.includes('cardSettings/testuid_cathay-cube'), w.slice(0, 300));
  check('免年費寫進帳號', /feeWaiverStatus[^}]*"kgi-eslite":true/.test(w), w.slice(0, 300));
  check('帶入後訪客 key 清掉', (await guestKeysLeft(pg)).length === 0, JSON.stringify(await guestKeysLeft(pg)));
  await pg.close();

  await browser.close(); srv.close();
  const failed = results.filter(r => !r).length;
  console.log('\n' + '='.repeat(50));
  console.log(failed ? `❌ ${failed} 項未通過` : `✅ 全部 ${results.length} 項通過`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('❌ 測試框架本身出錯：', e); process.exit(1); });
