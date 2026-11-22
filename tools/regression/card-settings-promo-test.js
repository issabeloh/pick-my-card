#!/usr/bin/env node
/**
 * 詳情頁「個人設定（統一自動儲存＋常駐儲存狀態列）」與「新戶活動票券」測試（2026-11-17，三輪改版第三輪）。
 *
 * 用法（repo 根目錄）：node tools/regression/card-settings-promo-test.js   （有 ❌ → exit 1）
 *
 * 做什麼：
 *  A. 訪客：黃色狀態列＋登入連結；改欄位 → 灰「儲存中…」→ 黃色帶時間；筆記停 1 秒自動存、打完立刻關閉也存；
 *     沒有 💾／#save-indicator／#credit-limit-saved；額度千分位與「未設定」；開關是 checkbox 可用空白鍵切換
 *  B. 已登入（Firestore 替身，可讓下一次 setDoc 失敗）：綠色狀態列；失敗 → 紅字寫明原因、不得出現成功狀態；
 *     錯誤依欄位記帳（別欄成功不洗掉）；生日月份失敗不說「已先存在這台裝置」；級別改了就存且回饋卡更新；
 *     鐵則 1：存的級別找不到時只顯示預設、不寫回；auth 變化時狀態列跟著切換
 *  C. 新戶活動票券：對所有有新戶活動的卡，比對 summary、每一步條件、每條備註、新戶資格、期間、金額／回饋率／上限／贈品／通路／圖片
 *     都出現在詳情頁文字中；頁籤筆數＝票券數
 * 沿用 run-regression.js 的凍結資料與凍結時鐘（改 cards.data 不會讓它變紅）；Firebase 替身是本檔自帶的（可登入／可失敗）。
 */
'use strict';
const path = require('path');
const { REPO, startServer, freezeClockScript, readFixtureMeta } = require('./run-regression.js');
let chromium;
try { ({ chromium } = require(path.join(REPO, 'node_modules', 'playwright'))); }
catch (e) { ({ chromium } = require('playwright')); }

function stub(url, guest) {
  const P = 'Promise.resolve()';
  if (url.includes('firebase-app')) return 'export function initializeApp(){return {};}';
  if (url.includes('firebase-analytics')) return 'export function getAnalytics(){return {};} export function logEvent(){} export function setUserProperties(){}';
  if (url.includes('firebase-auth')) return `
    const AUTH = { currentUser: ${guest ? 'null' : "{ uid:'testuid', email:'t@example.com', displayName:'測試', photoURL:'', providerData:[{providerId:'google.com'}] }"} };
    globalThis.__AUTH = AUTH; globalThis.__authCbs = [];
    export function getAuth(){ return AUTH; }
    export function onAuthStateChanged(a, cb){ globalThis.__authCbs.push(cb); setTimeout(() => cb(AUTH.currentUser), 0); }
    export class GoogleAuthProvider { setCustomParameters(){} }
    export function signInWithPopup(){return ${P};} export function signOut(){return ${P};}
    export function createUserWithEmailAndPassword(){return ${P};} export function signInWithEmailAndPassword(){return ${P};}
    export function sendPasswordResetEmail(){return ${P};} export function deleteUser(){return ${P};}
    export function reauthenticateWithPopup(){return ${P};} export function reauthenticateWithCredential(){return ${P};}
    export class EmailAuthProvider { static credential(){return {};} }`;
  if (url.includes('firebase-firestore')) return `
    globalThis.__docs = {}; globalThis.__sets = []; globalThis.__failSets = 0; globalThis.__failCode = 'unavailable';
    export function getFirestore(){return {};}
    export function doc(db, coll, id){ return { coll, id }; }
    export function getDoc(ref){ const d = globalThis.__docs[ref.coll + '/' + ref.id]; return Promise.resolve({ exists: () => !!d, data: () => d }); }
    export function setDoc(ref, data, opts){
      if (globalThis.__failSets > 0) { globalThis.__failSets--; const e = new Error('simulated'); e.code = globalThis.__failCode; return Promise.reject(e); }
      const k = ref.coll + '/' + ref.id; globalThis.__sets.push({ path: k, data: JSON.parse(JSON.stringify(data)) });
      globalThis.__docs[k] = opts && opts.merge ? Object.assign({}, globalThis.__docs[k] || {}, data) : data; return ${P}; }
    export function addDoc(){return ${P};} export function collection(){return {};} export function serverTimestamp(){return 0;}
    export function deleteField(){return 0;} export function deleteDoc(){return ${P};}
    export function writeBatch(){ return { set(){}, delete(){}, commit(){ return Promise.resolve(); } }; } export function increment(n){ return n; }`;
  if (url.includes('firebase-storage')) return `export function getStorage(){return {};} export function ref(){return {};} export function uploadBytes(){return ${P};} export function getDownloadURL(){return Promise.resolve('');}`;
  return 'export default {};';
}

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log((ok ? '  ✅ ' : '  ❌ ') + name + (extra ? ' — ' + extra : '')); };

// 給 owned-cards-panel-test.js 共用同一個 Firebase 替身（require 時不執行本檔測試）
module.exports = { stub };

if (require.main === module) (async () => {
  const srv = await startServer(false);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const frozen = readFixtureMeta().frozenDate;
  const errors = [];

  async function open(guest) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript(freezeClockScript(frozen));
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    // 失敗測試會讓 setDoc 失敗，那幾條 console.error 是預期的
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|simulated|雲端存取被拒|Failed to save|雲端儲存失敗|Firestore 保存失敗/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 200)); });
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(base)) return r.continue();
      if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: stub(u, guest) });
      return r.abort();
    });
    await page.goto(`${base}/index.html?start`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(g => typeof cardsData !== 'undefined' && cardsData && cardsData.cards && cardsData.cards.length > 0 &&
      typeof appStarted !== 'undefined' && appStarted && (g || (typeof currentUser !== 'undefined' && currentUser)), guest, { timeout: 20000 });
    await page.waitForTimeout(300);
    return page;
  }
  const status = p => p.evaluate(() => { const el = document.getElementById('cd-save-status'); return { s: el.dataset.state, t: el.querySelector('.cd-sv-t').textContent, login: !document.getElementById('cd-save-login').hidden }; });
  const watch = p => p.evaluate(() => {
    window.__seq = []; const el = document.getElementById('cd-save-status');
    const push = () => { const r = { s: el.dataset.state, t: el.querySelector('.cd-sv-t').textContent }; const l = window.__seq[window.__seq.length - 1]; if (!l || l.s !== r.s || l.t !== r.t) window.__seq.push(r); };
    new MutationObserver(push).observe(el, { attributes: true, childList: true, subtree: true, characterData: true }); push();
  });
  const seq = p => p.evaluate(() => window.__seq);
  const openCube = async p => { await p.evaluate(() => showCardDetail('cathay-cube')); await p.waitForTimeout(500); await p.evaluate(() => selectCardDetailTab('set')); await p.waitForTimeout(200); };

  console.log('A. 訪客');
  let p = await open(true);
  await openCube(p);
  let s = await status(p);
  check('黃色狀態列＋「登入」連結', s.s === 'local' && s.login && /只存在這台裝置。登入後會同步到帳號/.test(s.t), s.t);
  await watch(p);
  await p.selectOption('#cube-issuer-select', 'JCB'); await p.waitForTimeout(900);
  let q = await seq(p);
  check('改發卡組織 → 灰「儲存中…」→ 黃色帶時間', q.some(x => x.s === 'busy' && x.t === '儲存中…') && q[q.length - 1].s === 'local' && /・今天 \d\d:\d\d$/.test(q[q.length - 1].t), JSON.stringify(q.map(x => x.s)));
  check('localStorage cubeIssuer 有值', await p.evaluate(() => localStorage.getItem('cubeIssuer')) === 'JCB');
  await p.evaluate(() => document.getElementById('close-card-detail').click()); await p.waitForTimeout(200);
  await openCube(p);
  check('重開詳情頁值仍在', await p.evaluate(() => document.getElementById('cube-issuer-select').value) === 'JCB');
  await watch(p);
  await p.fill('#user-notes-input', '第一行筆記'); await p.waitForTimeout(400);
  check('筆記：打字 400ms 時狀態列沒動（不假裝已存）', (await seq(p)).length === 1);
  await p.waitForTimeout(1500);
  q = await seq(p);
  check('筆記：停 1 秒自動存（localStorage＋狀態列 busy→時間）', await p.evaluate(() => localStorage.getItem('notes_cathay-cube')) === '第一行筆記' && q.some(x => x.s === 'busy') && /・今天/.test(q[q.length - 1].t));
  check('沒有 💾／#save-indicator／#credit-limit-saved', await p.evaluate(() => !document.getElementById('save-notes-btn') && !document.getElementById('save-indicator') && !document.getElementById('credit-limit-saved') && !document.getElementById('card-detail-modal').textContent.includes('💾')));
  await p.fill('#credit-limit-input', '150000'); await p.press('#credit-limit-input', 'Enter'); await p.waitForTimeout(500);
  check('額度 150000 → 顯示 150,000、墨色、存 localStorage', await p.inputValue('#credit-limit-input') === '150,000' &&
    await p.evaluate(() => getComputedStyle(document.getElementById('credit-limit-input')).color) === 'rgb(17, 24, 39)' &&
    await p.evaluate(() => localStorage.getItem('creditLimit_local_cathay-cube')) === '150000');
  await p.fill('#credit-limit-input', ''); await p.press('#credit-limit-input', 'Enter'); await p.waitForTimeout(500);
  check('額度清空 → placeholder「未設定」', await p.getAttribute('#credit-limit-input', 'placeholder') === '未設定' && await p.inputValue('#credit-limit-input') === '');
  await watch(p);
  await p.click('label[for="children-eligible-checkbox"]'); await p.waitForTimeout(900);
  q = await seq(p);
  check('訪客改「童樂匯」：存在這台裝置（childrenEligible_guest=false）、狀態列黃色帶時間', q[q.length - 1].s === 'local' && /只存在這台裝置/.test(q[q.length - 1].t) && /・/.test(q[q.length - 1].t) &&
    await p.evaluate(() => localStorage.getItem('childrenEligible_guest')) === 'false' && await p.evaluate(() => isChildrenEligible) === false, q[q.length - 1].t);
  check('計算條件標籤不顯示「童樂匯」（站長 2026-11-20）', await p.evaluate(() => { const e = document.getElementById('card-calc-cond'); return !!e && !/童樂匯/.test(e.textContent); }));
  await p.focus('#children-eligible-checkbox');
  const b4 = await p.evaluate(() => document.getElementById('children-eligible-checkbox').checked);
  await p.keyboard.press('Space');
  check('開關：input type=checkbox、Tab 可聚焦、空白鍵切換、有 focus 樣式',
    await p.evaluate(() => { const e = document.getElementById('children-eligible-checkbox'); return e.type === 'checkbox' && document.activeElement === e && /solid/.test(getComputedStyle(e).outlineStyle); }) &&
    b4 !== await p.evaluate(() => document.getElementById('children-eligible-checkbox').checked));
  check('空白鍵切回 → childrenEligible_guest=true', await p.evaluate(() => localStorage.getItem('childrenEligible_guest')) === 'true');
  // 重開頁面：訪客關掉的選擇還在
  await p.evaluate(() => saveChildrenEligible(false)); await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof appStarted !== 'undefined' && appStarted && cardsData && cardsData.cards && cardsData.cards.length > 0, null, { timeout: 20000 });
  await p.waitForTimeout(300); await openCube(p);
  check('重開頁面：訪客的「童樂匯」關閉仍在（變數與開關都是關）', await p.evaluate(() => isChildrenEligible === false && document.getElementById('children-eligible-checkbox').checked === false));
  // 登出清理會清掉這個訪客 key
  await p.evaluate(() => clearPersonalLocalDataOnSignOut('someone'));
  check('登出清理移除 childrenEligible_guest', await p.evaluate(() => localStorage.getItem('childrenEligible_guest')) === null);
  await p.evaluate(() => localStorage.setItem('childrenEligible_guest', 'false'));
  await p.click('#cd-save-login'); await p.waitForTimeout(200);
  check('「登入」連結開登入視窗，且疊在詳情頁上面', await p.evaluate(() => { const m = document.getElementById('auth-modal'); const t = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return m.style.display === 'flex' && m.contains(t); }));
  await p.context().close();

  console.log('A2. 訪客登入：童樂匯帶進帳號');
  for (const cloud of [undefined, true]) {
    p = await open(true);
    await p.evaluate(c => { localStorage.setItem('childrenEligible_guest', 'false'); if (c !== undefined) __docs['users/testuid'] = { isChildrenEligible: c }; }, cloud);
    await p.evaluate(() => { __AUTH.currentUser = { uid: 'testuid', email: 't@example.com', displayName: '測試', photoURL: '', providerData: [{ providerId: 'google.com' }] }; __authCbs.forEach(cb => cb(__AUTH.currentUser)); });
    await p.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser, null, { timeout: 10000 }); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({ key: localStorage.getItem('childrenEligible_guest'), v: isChildrenEligible, sets: __sets.filter(x => x.path === 'users/testuid' && 'isChildrenEligible' in x.data).map(x => x.data.isChildrenEligible) }));
    if (cloud === undefined) check('雲端沒值 → 帶入訪客的「關」、寫入 Firestore、移除訪客 key', r.key === null && r.v === false && r.sets.includes(false), JSON.stringify(r));
    else check('雲端有值 → 以雲端為準、不寫入、移除訪客 key', r.key === null && r.v === true && r.sets.length === 0, JSON.stringify(r));
    await p.context().close();
  }

  console.log('B. 已登入');
  p = await open(false);
  await openCube(p);
  s = await status(p);
  check('綠色狀態列、沒有登入連結', s.s === 'ok' && !s.login && s.t === '已儲存到你的帳號', s.t);
  await watch(p);
  await p.selectOption('#cube-issuer-select', 'Mastercard'); await p.waitForTimeout(900);
  q = await seq(p);
  check('發卡組織寫入 Firestore users/<uid>，成功回綠＋時間', await p.evaluate(() => __sets.filter(x => x.path === 'users/testuid' && x.data.cubeIssuer === 'Mastercard').length) === 1 &&
    q[q.length - 1].s === 'ok' && /・今天 \d\d:\d\d$/.test(q[q.length - 1].t));
  await watch(p);
  await p.evaluate(() => { __failSets = 1; __failCode = 'unavailable'; });
  await p.selectOption('#cube-issuer-select', 'JCB'); await p.waitForTimeout(900);
  q = await seq(p); s = await status(p);
  check('setDoc 失敗 → 紅字：欄位＋原因＋「已先存在這台裝置」', s.s === 'err' && /儲存失敗（發卡組織）：網路連線不穩/.test(s.t) && /已先存在這台裝置/.test(s.t), s.t);
  check('失敗時沒有出現任何成功狀態（無假成功）', !q.slice(1).some(x => x.s === 'ok' || x.s === 'local'));
  await p.evaluate(() => { __failSets = 1; __failCode = 'permission-denied'; });
  await p.selectOption('#birthday-month-select', '3'); await p.waitForTimeout(900);
  s = await status(p);
  check('生日月份失敗（沒有本機備援）：不說「已先存在這台裝置」、說「請重試」、另有 1 項', s.s === 'err' && /（生日月份）：沒有寫入權限/.test(s.t) && /請重試。/.test(s.t) && !/已先存在這台裝置/.test(s.t) && /另有 1 項/.test(s.t), s.t);
  await p.selectOption('#cube-issuer-select', 'Visa'); await p.waitForTimeout(900);
  s = await status(p);
  check('別欄（發卡組織）重存成功，生日月份的錯誤仍在', s.s === 'err' && /（生日月份）/.test(s.t) && !/另有/.test(s.t), s.t);
  await p.selectOption('#birthday-month-select', '3'); await p.waitForTimeout(900);
  check('同一欄重存成功 → 回綠', (await status(p)).s === 'ok');
  await p.fill('#user-notes-input', '關閉前最後一行');
  await p.evaluate(() => document.getElementById('close-card-detail').click()); await p.waitForTimeout(800);
  check('打完立刻關閉詳情頁 → 筆記寫入 Firestore', await p.evaluate(() => __sets.filter(x => x.path === 'userNotes/testuid_cathay-cube' && x.data.notes === '關閉前最後一行').length) === 1);
  await openCube(p);
  await p.evaluate(() => { __failSets = 1; __failCode = 'unavailable'; });
  await p.fill('#user-notes-input', '會失敗的筆記'); await p.waitForTimeout(1700);
  s = await status(p);
  check('筆記雲端失敗 → 紅字（筆記）＋已先存在這台裝置，本機有備份', s.s === 'err' && /（筆記）/.test(s.t) && /已先存在這台裝置/.test(s.t) &&
    await p.evaluate(() => localStorage.getItem('notes_testuid_cathay-cube')) === '會失敗的筆記', s.t);
  // 級別：yushan-unicard
  await p.evaluate(() => { __failSets = 0; return showCardDetail('yushan-unicard'); }); await p.waitForTimeout(600);
  const before = await p.evaluate(() => ({ cur: document.getElementById('card-level-select').value, opts: [...document.getElementById('card-level-select').options].map(o => o.value), rates: [...document.querySelectorAll('#card-special-cashback .cd-rate')].map(e => e.textContent).join() }));
  const target = before.opts.find(x => x !== before.cur);
  await p.evaluate(() => selectCardDetailTab('set'));
  await p.selectOption('#card-level-select', target); await p.waitForTimeout(1500);
  const after = await p.evaluate(() => ({ rates: [...document.querySelectorAll('#card-special-cashback .cd-rate')].map(e => e.textContent).join(), sets: __sets.filter(x => x.path === 'cardSettings/testuid_yushan-unicard').map(x => x.data.level) }));
  s = await status(p);
  check('級別改了：回饋卡更新、寫入 Firestore、狀態列綠＋時間', before.rates !== after.rates && after.sets.includes(target) && s.s === 'ok' && /・今天/.test(s.t), s.t);
  await p.click('#level-help-btn'); await p.waitForTimeout(200);
  check('「i」說明窗仍可開', await p.evaluate(() => document.getElementById('level-help-popup').matches(':popover-open')));
  await p.keyboard.press('Escape');
  await p.evaluate(() => { localStorage.setItem('cardLevel_testuid_yushan-unicard', '不存在的級別'); __docs['cardSettings/testuid_yushan-unicard'] = { level: '不存在的級別' }; __sets.length = 0; clearCardLevelCache(); });
  await p.evaluate(() => showCardDetail('yushan-unicard')); await p.waitForTimeout(600);
  const nf = await p.evaluate(() => ({ sel: document.getElementById('card-level-select').value, writes: __sets.filter(x => x.path.startsWith('cardSettings')).length, ls: localStorage.getItem('cardLevel_testuid_yushan-unicard'), cloud: __docs['cardSettings/testuid_yushan-unicard'].level }));
  check('鐵則 1：存的級別找不到 → 只顯示預設、本機與雲端都沒被改寫', nf.writes === 0 && nf.ls === '不存在的級別' && nf.cloud === '不存在的級別' && nf.sel === before.opts[0], JSON.stringify(nf));
  const noLv = await p.evaluate(async () => { const c = cardsData.cards.find(c => !c.hasLevels); await showCardDetail(c.id); await new Promise(r => setTimeout(r, 400)); return [...document.querySelectorAll('#card-personal-section .cd-set-sec-t')].map(e => e.textContent).join(); });
  check('非分級卡只有「我的紀錄」一組', noLv === '我的紀錄', noLv);
  await p.evaluate(() => { __failSets = 0; selectCardDetailTab('set'); }); await p.fill('#user-notes-input', '成功的筆記'); await p.waitForTimeout(1700);
  await p.evaluate(() => { __AUTH.currentUser = null; __authCbs.forEach(cb => cb(null)); }); await p.waitForTimeout(600);
  s = await status(p);
  check('auth 變化（登出）→ 狀態列切成訪客黃色＋登入連結', s.s === 'local' && s.login, s.t);
  await p.context().close();

  console.log('C. 新戶活動票券（欄位對照）');
  p = await open(true);
  const ids = await p.evaluate(() => [...new Set(cardsData.newCardholderPromos.map(x => x.id))]);
  let checks = 0; const missing = []; let shownTotal = 0, dataTotal = 0;
  for (const id of ids) {
    const res = await p.evaluate(async id => {
      await showCardDetail(id);
      const card = cardsData.cards.find(c => c.id === id);
      const promos = getActiveCardholderPromos(id);
      const txt = (document.getElementById('card-promos-content').textContent + ' ' + document.getElementById('card-promos-foot').textContent).replace(/\s+/g, ' ');
      const out = { id, n: promos.length, tickets: document.querySelectorAll('#card-promos-content > .cd-pm').length, tab: document.querySelector('#cd-tab-promo .cd-tab-n').textContent, miss: [], checks: 0, skipped: 0 };
      const norm = s => String(s).replace(/\s+/g, ' ').trim();
      const need = (label, s) => { if (s == null || s === '') return; out.checks++; if (!txt.includes(norm(s))) out.miss.push(label + ': ' + norm(s).slice(0, 60)); };
      const MARK = /^\s*(?:[\u2460-\u2473\u2474-\u2487\u2776-\u277F]|[（(]\d{1,2}[）)]|\d{1,2}[.、)）](?!\d))\s*/;
      promos.forEach(pr => {
        if (buildPromoDetailRows(pr, card, 1000, !!pr.bonus_rate).length === 0) { out.skipped++; return; }
        need('summary', pr.new_customer_summary);
        need('新戶資格', pr.new_customer_definition && pr.new_customer_definition.trim());
        need('period_start', pr.period_start); need('period_end', pr.period_end);
        String(pr.promo_condition || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(l => need('條件', l.replace(MARK, '')));
        String(pr.notes || '').split(/[；;]/).map(x => x.trim()).filter(Boolean).forEach(n => need('備註', n));
        if (pr.voucher_amount) need('定額', 'NT$' + Math.round(Number(pr.voucher_amount)).toLocaleString());
        need('單位', pr.voucher_usage);
        if (pr.bonus_rate != null && pr.bonus_rate !== '') need('回饋率', formatBonusRate(pr.bonus_rate));
        if (typeof pr.bonus_cap === 'number') need('上限', 'NT$' + Math.round(pr.bonus_cap).toLocaleString());
        String(pr.gift_content || '').split(/\r?\n/).map(l => l.replace(MARK, '').trim()).filter(Boolean).forEach(g => need('贈品', g));
        if (pr.bonus_merchants) (isGeneralSpendingMarker(pr.bonus_merchants) ? ['一般消費'] : isAllItemsMarker(pr.bonus_merchants) ? ['本卡所有指定通路'] : expandPromoMerchants(pr, card)).forEach(x => need('通路', x));
        if (pr.gift_image_url) { out.checks++; if (![...document.querySelectorAll('#card-promos-content img.cd-pt-img')].some(i => i.getAttribute('src') === pr.gift_image_url)) out.miss.push('圖片'); }
      });
      return out;
    }, id);
    checks += res.checks; shownTotal += res.tickets; dataTotal += res.n;
    if (res.miss.length) missing.push(res);
    if (res.tickets + res.skipped !== res.n || (res.tickets > 0 ? String(res.tickets) : '') !== res.tab) missing.push({ id, 筆數: [res.n, res.tickets, res.tab, res.skipped] });
  }
  check(`${ids.length} 張卡／${dataTotal} 筆活動：欄位都出現、頁籤筆數＝票券數（${checks} 項）`, missing.length === 0 && checks > 0, missing.length ? JSON.stringify(missing).slice(0, 400) : '');
  check('頁面沒有 JavaScript 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  const bad = results.filter(r => !r.ok).length;
  console.log(bad === 0 ? `\n✅ 個人設定／新戶活動票券測試通過：${results.length}/${results.length}` : `\n❌ ${bad} 項失敗（共 ${results.length}）`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
