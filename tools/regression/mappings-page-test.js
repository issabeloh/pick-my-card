#!/usr/bin/env node
/**
 * 「我的配卡組合」頁面（刷卡小抄）— 功能＋版面回歸測試（2026-09-28 新增）
 *
 * 為什麼獨立一支：run-regression.js 的 Firebase 替身固定是訪客，而配卡只有登入者能用。
 * 這裡自帶「已登入用戶」替身（仿 delete-account-test.js），並沿用凍結資料＋凍結時鐘
 * （tools/regression/fixture.data／fixture.json），所以結果不會隨線上資料或日期漂移。
 *
 * 用法（repo 根目錄，需先 npm install playwright）：
 *   node tools/regression/mappings-page-test.js            # 全部通過 → exit 0，任一失敗 → exit 1
 *   node tools/regression/mappings-page-test.js --shots D  # 另外把各尺寸截圖存到資料夾 D（人工目視用）
 *
 * 配對資料怎麼來：登入後在頁面裡用站上同一支 calculateCardCashback() 算出回饋率與期限，
 * 再存成配對——等於模擬「用戶在搜尋結果按釘選」。另外刻意造三筆特殊資料：
 *   - 期限已過、但同回饋率的活動還在 → 「更新期限」要把期限延長
 *   - 回饋率對不上現在的活動        → 「更新期限」不能改，要標「回饋已變」
 *   - 卡片已經沒有這個商家          → 要顯示 * 失效
 *
 * ⚠️ index.html 的 Firebase import 清單增修時，下面 stub() 的 export 要同步補。
 */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.data': 'text/plain', '.version': 'text/plain', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml' };
const argv = process.argv.slice(2);
const SHOTS = argv.includes('--shots') ? path.resolve(argv[argv.indexOf('--shots') + 1] || path.join(os.tmpdir(), 'mappings-page-shots')) : null;

const FIXTURE_DATA = path.join(__dirname, 'fixture.data');
const META = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));

// 已登入用戶；級別存在 cardSettings/<uid>_<cardId>（同正式站）
const LEVELS = { 'cathay-cube': 'Level 3', 'yushan-unicard': 'UP選', 'sinopac-dawho': '大戶Plus等級', 'kgi-eslite': '黑卡' };

function stub(url, guest) {
  const R = 'Promise.resolve()';
  if (url.includes('firebase-app')) return 'export function initializeApp(){return {};}';
  if (url.includes('firebase-analytics')) return 'export function getAnalytics(){return {};} export function logEvent(){}';
  if (url.includes('firebase-auth')) return `
    const USER = { uid:'testuid', email:'test@example.com', displayName:'測試用戶', photoURL:'', providerData:[{ providerId:'google.com' }] };
    const AUTH = { currentUser: USER };
    export function getAuth(){ return AUTH; }
    export function onAuthStateChanged(auth, cb){ setTimeout(()=>cb(${guest ? 'null' : 'USER'}),0); }
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
    globalThis.__setDocs = [];
    const LEVELS = ${JSON.stringify(LEVELS)};
    export function getFirestore(){return {};}
    export function doc(db, coll, id){ return { coll, id }; }
    export function getDoc(ref){
      if (ref.coll === 'cardSettings') {
        const cardId = String(ref.id).replace(/^testuid_/, '');
        if (LEVELS[cardId]) return Promise.resolve({ exists:()=>true, data:()=>({ level: LEVELS[cardId] }) });
      }
      return Promise.resolve({ exists:()=>false, data:()=>undefined });
    }
    export function setDoc(ref, data){ globalThis.__setDocs.push({ path: ref.coll + '/' + ref.id, data: JSON.parse(JSON.stringify(data, (k, v) => v && v.__deleteField ? '__DELETE__' : v)) }); return ${R}; }
    export function addDoc(){return ${R};}
    export function collection(){return {};}
    export function serverTimestamp(){return 0;}
    export function deleteField(){return { __deleteField: true };}
    export function deleteDoc(){return ${R};}`;
  if (url.includes('firebase-storage')) return `
    export function getStorage(){return {};} export function ref(){return {};}
    export function uploadBytes(){return ${R};} export function getDownloadURL(){return Promise.resolve('');}`;
  return 'export default {};';
}

function freezeClockScript(iso) {
  return `(() => {
    const RealDate = Date, fixedMs = new RealDate(${JSON.stringify(iso)}).getTime();
    function FrozenDate(...a) { if (!(this instanceof FrozenDate)) return new RealDate(fixedMs).toString(); return a.length === 0 ? new RealDate(fixedMs) : new RealDate(...a); }
    FrozenDate.prototype = RealDate.prototype; FrozenDate.now = () => fixedMs; FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate); window.Date = FrozenDate;
  })();`;
}

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log((ok ? '  ✅ ' : '  ❌ ') + name + (extra ? ' — ' + extra : '')); };

// 模擬用戶釘選的配對（卡片 id, 搜尋詞）；在頁面裡用 calculateCardCashback 算出真正的回饋率與期限
const PAIRS = [
  ['cathay-cube', '全聯'], ['taishin-richart', 'Line Pay'], ['yushan-unicard', 'Uber Eats'], ['cathay-cube', 'Uber Eats'],
  ['hsbc-liveplus', '麥當勞'], ['hsbc-liveplus', '星巴克'], ['yushan-unicard', '中華航空'], ['yushan-unicard', '長榮航空'],
  ['sinopac-dawho', '國外'], ['taishin-richart', 'momo'], ['kgi-eslite', '誠品線上'], ['taishin-richart', '新光三越'],
  ['yushan-unicard', '高鐵'], ['cathay-cube', '全支付國內合作通路']
];

(async () => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '/mappings') p = '/index.html';     // 同 _redirects 的改寫
    if (p === '/cards.data') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return fs.createReadStream(FIXTURE_DATA).pipe(res); }
    if (p === '/cards.version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(META.cardsVersion); }
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let pageErrors = 0;

  async function newPage(vp, urlPath = '/index.html?start', guest = false) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr || 1, hasTouch: !!vp.touch, isMobile: !!vp.touch });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => { pageErrors++; console.log('   PAGE ERROR:', e.message); });
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) console.log('   CONSOLE ERROR:', m.text()); });
    await pg.addInitScript(freezeClockScript(META.frozenDate));
    // 問卷邀請彈窗會擋住點擊，測試裡當作已經看過
    await pg.addInitScript(() => { try { localStorage.setItem('pmc_survey_invite_seen_v1', 'dismissed'); } catch (e) {} });
    await pg.route('**/*', route => {
      const u = route.request().url();
      if (u.startsWith(base)) return route.continue();
      if (u.includes('gstatic.com/firebasejs')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: stub(u, guest) });
      return route.abort();
    });
    await pg.goto(base + urlPath, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction((g) => typeof currentUser !== 'undefined' && (g || currentUser) && typeof cardsData !== 'undefined' && cardsData && cardsData.cards && typeof appStarted !== 'undefined' && appStarted, guest, { timeout: 20000 });
    await pg.waitForFunction(() => !document.getElementById('home-view-switch').hidden, null, { timeout: 10000 });
    return pg;
  }

  // 在頁面裡建立配對（模擬釘選）
  async function seed(pg) {
    return pg.evaluate(async (PAIRS) => {
      const list = [], skipped = [];
      let i = 0;
      for (const [cardId, term] of PAIRS) {
        const card = cardsData.cards.find(c => c.id === cardId);
        const r = card ? await calculateCardCashback(card, term, 1000) : [];
        const m = Array.isArray(r) && r[0];
        if (!m) { skipped.push(cardId + ':' + term); continue; }
        list.push({ id: 'seed_' + (i++), cardId, cardName: card.name, merchant: m.matchedItem, cashbackRate: m.rate,
          periodEnd: (m.matchedRateGroup && m.matchedRateGroup.periodEnd) || null, periodStart: (m.matchedRateGroup && m.matchedRateGroup.periodStart) || null,
          createdAt: 0, order: i });
      }
      // 特殊資料：過期但可延長、回饋率已變、卡片已無此商家
      const ext = list.find(x => x.cardId === 'hsbc-liveplus' && x.merchant.includes('麥當勞'));
      if (ext) { ext.id = 'seed_extend'; ext.periodEnd = '2026-09-01'; }
      const air = list.find(x => x.merchant.includes('中華航空'));
      if (air) { air.cashbackRate = Number(air.cashbackRate) + 1; air.periodEnd = '2026-09-05'; }
      list.push({ id: 'seed_gone', cardId: 'hsbc-liveplus', cardName: '滙豐 Live+ 卡', merchant: 'zzz不存在商家', cashbackRate: 3, periodEnd: '2026-12-31', periodStart: null, createdAt: 0, order: 99 });
      await saveSpendingMappings(list);
      refreshMappingsEntry();
      return { count: list.length, skipped, extendMerchant: ext && ext.merchant, airRate: air && air.cashbackRate };
    }, PAIRS);
  }

  const VIEWPORTS = [
    { name: 'phone-320', w: 320, h: 640, dpr: 2, touch: true },
    { name: 'iphone13', w: 390, h: 844, dpr: 3, touch: true },
    { name: 'tablet-768', w: 768, h: 1024, dpr: 2, touch: true },
    { name: 'tablet-1024-landscape', w: 1024, h: 768, dpr: 2, touch: true },
    { name: 'desktop-1440', w: 1440, h: 900, dpr: 1 }
  ];

  // ============ A. 入口、資料、功能（iPhone 13 尺寸） ============
  console.log('\n【A】入口與資料（iPhone 13 390×844）');
  let pg = await newPage(VIEWPORTS[1]);
  const seeded = await seed(pg);
  check('模擬釘選建立配對', seeded.count >= 10, `共 ${seeded.count} 筆${seeded.skipped.length ? '；跳過 ' + seeded.skipped.join('、') : ''}`);
  check('舊的浮動按鈕已移除', await pg.$('#my-mappings-btn') === null);
  check('切換鈕不顯示數量', await pg.$('#home-view-switch-count') === null && !(await pg.textContent('#home-view-switch-mappings')).match(/\d/));

  await pg.click('#home-view-switch-mappings');
  await pg.waitForSelector('#mappings-page:not([hidden])');
  check('點切換鈕 → 網址變 /mappings', new URL(pg.url()).pathname === '/mappings', pg.url());
  await pg.waitForFunction(() => MP.probed, null, { timeout: 20000 });
  const inline = await pg.evaluate(() => {
    const page = document.getElementById('mappings-page'), sw = document.getElementById('home-view-switch');
    const main = page.closest('main');
    const others = main ? [...main.children].filter(el => el !== page && el !== sw) : [];
    return { inMain: !!main, notFixed: getComputedStyle(page).position !== 'fixed', below: page.getBoundingClientRect().top >= sw.getBoundingClientRect().bottom - 1,
      othersHidden: others.every(el => getComputedStyle(el).display === 'none'), swOn: document.getElementById('home-view-switch-mappings').classList.contains('on'), noBack: !document.querySelector('[data-mp-back]') };
  });
  check('配卡組合顯示在切換鈕下方（不是蓋住整頁）', inline.inMain && inline.notFixed && inline.below && inline.swOn, JSON.stringify(inline));
  check('切到配卡組合時，查詢區塊都隱藏', inline.othersHidden);
  check('沒有返回箭頭', inline.noBack);
  const extHidden = await pg.evaluate(() => ['.spotlight-section', '.mc-related'].every(sel => [...document.querySelectorAll(sel)].every(el => getComputedStyle(el).display === 'none')));
  check('切到配卡組合時，推薦活動與推薦比較也隱藏', extHidden);
  const order = await pg.evaluate(() => { const y = id => document.getElementById(id).getBoundingClientRect().top;
    return { intro: !!document.querySelector('.mp-intro'), searchAboveTip: y('mp-searchbox') < y('mp-tip'), tipAboveList: y('mp-tip') < y('mp-list'), saveBelow: y('mp-savebar') > y('mp-list') }; });
  check('順序：說明 → 搜尋框 → 提示 → 小抄 → 存成圖片', order.intro && order.searchAboveTip && order.tipAboveList && order.saveBelow, JSON.stringify(order));
  await pg.fill('#mp-search', '麥當勞');
  await pg.dispatchEvent('#mp-search', 'input');
  const clr = await pg.isVisible('#mp-search-clear');
  await pg.click('#mp-search-clear');
  check('搜尋框有 ✕，一鍵清除', clr && (await pg.inputValue('#mp-search')) === '' && !(await pg.isVisible('#mp-search-clear')));

  // 預設：單欄＋分類
  const defaults = await pg.evaluate(() => ({ sort: MP.prefs.sort, layout: MP.prefs.layout, size: MP.prefs.size }));
  check('預設排列＝分類、單欄、小字', defaults.sort === 'cat' && defaults.layout === 'F' && defaults.size === 'small', JSON.stringify(defaults));

  // 資料正確：每一列的回饋率、期限都等於配對存的值
  const dataCheck = await pg.evaluate(() => {
    const bad = [];
    const groups = mpBuildGroups();
    document.querySelectorAll('#mp-list [data-mp-row]').forEach(row => {
      const g = groups.find(x => x.key === row.dataset.mpRow);
      if (!g) { bad.push('找不到組 ' + row.dataset.mpRow); return; }
      const rates = [...row.querySelectorAll('.mp-rate')].map(e => e.textContent);
      const want = g.entries.map(e => `${e.rate}%`);
      if (JSON.stringify(rates) !== JSON.stringify(want)) bad.push(`${g.key} 回饋率 ${rates} ≠ ${want}`);
      const dues = [...row.querySelectorAll('.mp-due')].map(e => e.textContent);
      const wantDue = g.entries.map(e => mpDueText(e));
      if (JSON.stringify(dues) !== JSON.stringify(wantDue)) bad.push(`${g.key} 期限 ${dues} ≠ ${wantDue}`);
      g.entries.forEach(e => { if (Number(e.m.cashbackRate) !== e.rate) bad.push(`${g.key} 回饋率被改寫`); });
    });
    return { bad, rows: document.querySelectorAll('#mp-list [data-mp-row]').length, groups: groups.length };
  });
  check('每一列的回饋率、期限＝配對存的值', dataCheck.bad.length === 0 && dataCheck.rows === dataCheck.groups, dataCheck.bad.slice(0, 3).join('；') || `${dataCheck.rows} 列`);

  const sections = await pg.$$eval('#mp-list .mp-sec', els => els.map(e => e.textContent.trim()));
  const catOrder = ['行動支付', '餐飲', '網購', '超市超商', '交通', '旅遊', '娛樂', '其他'];
  check('分類依固定順序、行動支付在最前', sections.length > 0 && sections.every((s, i) => i === 0 || catOrder.indexOf(s) > catOrder.indexOf(sections[i - 1])) && (sections[0] === '行動支付' || !sections.includes('行動支付')), sections.join(' → '));
  const payColor = await pg.$eval('#mp-list .mp-sec.pay', e => getComputedStyle(e).color).catch(() => null);
  const catColor = await pg.$eval('#mp-list .mp-sec:not(.pay)', e => getComputedStyle(e).color).catch(() => null);
  check('行動支付標題橘色、其他分類藍色', payColor === 'rgb(234, 88, 12)' && catColor === 'rgb(29, 78, 216)', `${payColor} / ${catColor}`);

  // 等級／方案標籤
  const labs = await pg.evaluate(() => [...document.querySelectorAll('#mp-list [data-mp-row]')].map(r => ({ k: r.dataset.mpRow, l: [...r.querySelectorAll('.mp-lab')].map(e => e.textContent) })));
  const cubeLabs = labs.find(x => x.k.includes('全聯'));
  check('CUBE 全聯同時有「Lv3」與「全支付」', !!cubeLabs && cubeLabs.l.includes('Lv3') && cubeLabs.l.includes('全支付'), JSON.stringify(cubeLabs));
  const rich = labs.find(x => x.k.includes('新光三越'));
  check('Richart 新光三越有「大筆刷」', !!rich && rich.l.includes('大筆刷'), JSON.stringify(rich));
  const levelCalls = await pg.evaluate(() => (globalThis.__setDocs || []).filter(d => d.path.startsWith('cardSettings/')).length);
  check('🔒 開頁、重算都沒有寫入任何級別', levelCalls === 0, `cardSettings 寫入 ${levelCalls} 次`);

  // 失效
  const stars = await pg.$$eval('#mp-list [data-mp-row]', rows => rows.filter(r => r.querySelector('.mp-star')).map(r => r.dataset.mpRow));
  check('過期與已下架的商家有 *', stars.some(s => s.includes('zzz不存在商家')) && stars.some(s => s.includes('麥當勞')), stars.join('、'));
  check('有失效商家時顯示註腳', (await pg.textContent('#mp-list .mp-note') || '').includes('記得回網站更新最新活動'));

  // 更新期限
  await pg.click('#mp-update-btn');
  await pg.waitForFunction(() => MP.updated, null, { timeout: 20000 });
  const upd = await pg.evaluate(() => ({ u: MP.updated, ext: userSpendingMappings.find(m => m.id === 'seed_extend'), air: userSpendingMappings.find(m => (m.merchant || '').includes('中華航空')) }));
  check('更新期限：同回饋率的過期配對被延長', upd.ext && upd.ext.periodEnd > '2026-09-11', upd.ext && upd.ext.periodEnd);
  check('更新期限：回饋率不同的不自動改、列入提醒', upd.air && upd.air.periodEnd === '2026-09-05' && upd.u.changed.some(c => c.includes('中華航空')), upd.u.changed.join('；'));
  check('按鈕文字「更新期限」→「期限已是最新」', (await pg.textContent('#mp-update-btn')).includes('期限已是最新'));

  // 回饋已變 → 點了顯示新舊回饋率，確認後更新
  const airKey = await pg.evaluate(() => mpKeyOf(userSpendingMappings.find(m => (m.merchant || '').includes('中華航空'))));
  const flagBtn = await pg.$(`#mp-list [data-mp-row="${airKey}"] [data-mp-changed]`);
  check('回饋率不同的活動顯示「回饋已變」按鈕', !!flagBtn);
  if (flagBtn) {
    await flagBtn.click();
    const rs = await pg.evaluate(() => ({ open: !document.getElementById('mp-rate-sheet').hidden, text: document.getElementById('mp-rate-body').textContent, opts: document.querySelectorAll('[data-mp-rate-pick]').length }));
    check('點「回饋已變」→ 顯示原本與新的回饋率', rs.open && rs.text.includes('原本釘選') && rs.opts > 0, rs.text.slice(0, 60));
    const want = await pg.evaluate(() => { const m = userSpendingMappings.find(x => (x.merchant || '').includes('中華航空')); return MP.status.get(m.id).cands[0]; });
    await pg.click('[data-mp-rate-pick="0"]');
    await pg.waitForTimeout(300);
    const after = await pg.evaluate((k) => { const m = userSpendingMappings.find(x => mpKeyOf(x) === k); return { rate: m.cashbackRate, end: m.periodEnd, flag: !!document.querySelector(`#mp-list [data-mp-row="${k}"] [data-mp-changed]`), shown: document.querySelector(`#mp-list [data-mp-row="${k}"] .mp-rate`).textContent,
      saved: (globalThis.__setDocs || []).some(d => Array.isArray(d.data.spendingMappings) && d.data.spendingMappings.some(x => x.id === m.id && x.cashbackRate === m.cashbackRate)) }; }, airKey);
    check('確認後更新成新回饋率與期限、存回雲端、不再顯示「回饋已變」', after.rate === want.rate && after.end === want.end && !after.flag && after.shown === `${want.rate}%` && after.saved, JSON.stringify(after));
  }

  // 小抄標題
  await pg.click('#mp-title-btn');
  check('點「刷卡小抄」→ 開標題面板', await pg.isVisible('#mp-title-sheet'));
  await pg.fill('#mp-title-input', '我的超級無敵好用刷卡小抄表格');
  await pg.dispatchEvent('#mp-title-input', 'input');
  const tv = await pg.inputValue('#mp-title-input');
  check('標題超過 10 個中文字會被截掉', [...tv].length === 10, tv);
  await pg.fill('#mp-title-input', '小明的刷卡表');
  await pg.dispatchEvent('#mp-title-input', 'input');
  await pg.click('#mp-title-save');
  const tt = await pg.evaluate(() => ({ shown: document.getElementById('mp-title-btn').textContent, saved: (globalThis.__setDocs || []).some(d => d.data.mappingsTitle === '小明的刷卡表'), oneLine: document.getElementById('mp-title-btn').getBoundingClientRect().height < 40 }));
  check('標題更新、存雲端、維持一行', tt.shown === '小明的刷卡表' && tt.saved && tt.oneLine, JSON.stringify(tt));

  // 刪除失效
  await pg.click(`#mp-list [data-mp-edit="zzz不存在商家"]`);
  const delTxt = await pg.$$eval('#mp-edit-remove button', b => b.map(x => x.textContent));
  check('失效商家的面板有「刪除這個失效活動」按鈕', delTxt.includes('刪除這個失效活動'), delTxt.join('／'));
  await pg.click('[data-mp-sheet-close]');
  const deadN = await pg.evaluate(() => mpDeadIds().length);
  check('有失效活動時顯示「刪除全部失效活動」', deadN > 0 && await pg.isVisible('#mp-delete-dead'), `${deadN} 筆`);
  await pg.click('#mp-delete-dead');
  check('第一次按只會變成確認', (await pg.textContent('#mp-delete-dead')).includes('確定') && await pg.evaluate(() => mpDeadIds().length) === deadN);
  await pg.click('#mp-delete-dead');
  await pg.waitForTimeout(300);
  const afterDel = await pg.evaluate(() => ({ dead: mpDeadIds().length, bar: document.getElementById('mp-deadbar').hidden, gone: !userSpendingMappings.some(m => m.id === 'seed_gone') }));
  check('再按一次 → 失效活動全部刪除、按鈕消失', afterDel.dead === 0 && afterDel.bar && afterDel.gone, JSON.stringify(afterDel));
  const savedAfterUpd = await pg.evaluate(() => (globalThis.__setDocs || []).some(d => d.path === 'users/testuid' && Array.isArray(d.data.spendingMappings) && d.data.spendingMappings.some(m => m.id === 'seed_extend' && m.periodEnd > '2026-09-11')));
  check('延長後的期限已存回雲端', savedAfterUpd);

  // 改名
  const target = await pg.$eval('#mp-list [data-mp-row]', r => r.dataset.mpRow);
  await pg.click(`#mp-list [data-mp-edit="${target}"]`);
  check('點商家名稱 → 開改名面板', await pg.isVisible('#mp-edit-sheet'));
  check('面板顯示「名稱原為」', (await pg.textContent('.mp-orig')).includes('名稱原為'));
  await pg.fill('#mp-edit-input', '我的測試名');
  await pg.click('#mp-edit-save');
  const renamed = await pg.evaluate((k) => ({ shown: document.querySelector(`#mp-list [data-mp-edit="${k}"]`).textContent, saved: (globalThis.__setDocs || []).some(d => d.data.merchantAliases && d.data.merchantAliases[k] === '我的測試名'), local: localStorage.getItem('merchantAliases_testuid') }), target);
  check('改名後清單顯示新名字', renamed.shown.includes('我的測試名'), renamed.shown);
  check('改名存到帳號（merchantAliases）與本機鏡像', renamed.saved && (renamed.local || '').includes('我的測試名'));
  await pg.click(`#mp-list [data-mp-edit="${target}"]`);
  await pg.click('#mp-edit-reset');
  const reset = await pg.evaluate((k) => ({ shown: document.querySelector(`#mp-list [data-mp-edit="${k}"]`).textContent, del: (globalThis.__setDocs || []).some(d => d.data.merchantAliases && d.data.merchantAliases[k] === '__DELETE__') }), target);
  check('商家名稱重設 → 回到原名並刪除雲端欄位', reset.shown.toLowerCase().startsWith(target) && reset.del, reset.shown);

  // 點卡圖 → 詳情頁疊在上面
  await pg.click('#mp-list .mp-cardbtn');
  await pg.waitForSelector('#card-detail-modal', { state: 'visible', timeout: 5000 }).catch(() => {});
  const onTop = await pg.evaluate(() => { const m = document.getElementById('card-detail-modal'); if (!m || getComputedStyle(m).display === 'none') return false; const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return m.contains(el); });
  check('點卡圖 → 卡片詳情疊在配卡組合上面', onTop);
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => { const m = document.getElementById('card-detail-modal'); if (m && getComputedStyle(m).display !== 'none') { const b = m.querySelector('.close-modal, [id*=close]'); if (b) b.click(); } });

  // A–Z
  await pg.click('#mp-tools [data-mp-sort="az"]');
  const letters = await pg.$$eval('#mp-list .mp-ltr', els => els.map(e => e.textContent));
  check('A–Z：字首依字母排序', letters.length > 1 && letters.every((l, i) => i === 0 || l === '#' || (letters[i - 1] !== '#' && l > letters[i - 1])), letters.join(' '));

  // 自訂＋拖曳
  await pg.click('#mp-tools [data-mp-sort="custom"]');
  check('自訂排列才出現拖曳把手', (await pg.$$('#mp-list [data-mp-grip]')).length > 0 && await pg.isVisible('.mp-tip-drag:not(.mp-dot)'));
  const before = await pg.$$eval('#mp-list [data-mp-row]', r => r.map(e => e.dataset.mpRow));
  const grips = await pg.$$('#mp-list [data-mp-grip]');
  await grips[2].scrollIntoViewIfNeeded();
  const g2 = await grips[2].boundingBox(), g0 = await grips[0].boundingBox();
  if (g0.y < 0) await grips[0].scrollIntoViewIfNeeded();
  const b2 = await grips[2].boundingBox(), b0 = await grips[0].boundingBox();
  await pg.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(b0.x + b0.width / 2, b0.y + 2, { steps: 10 });
  await pg.mouse.up();
  await pg.waitForTimeout(300);
  const after = await pg.$$eval('#mp-list [data-mp-row]', r => r.map(e => e.dataset.mpRow));
  const orderSaved = await pg.evaluate(k => { const m = userSpendingMappings.filter(x => mpKeyOf(x) === k); const min = Math.min(...userSpendingMappings.map(x => x.order)); return m.length && m.every(x => x.order === min || x.order <= min + m.length - 1); }, before[2]);
  check('拖曳第 3 家到最上面，順序存檔', after[0] === before[2] && orderSaved, `${before.slice(0, 3).join(',')} → ${after.slice(0, 3).join(',')}`);

  // ============ B. 各尺寸 × 版面 × 字級 ============
  console.log('\n【B】版面（手機／平板／桌機 × 單欄／雙欄 × 小字／大字）');
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  for (const vp of VIEWPORTS) {
    const p2 = await newPage(vp, '/mappings?start');
    await seed(p2);
    await p2.waitForSelector('#mappings-page:not([hidden])');
    await p2.waitForFunction(() => MP.probed, null, { timeout: 20000 });
    for (const layout of ['F', 'E']) for (const size of ['small', 'large']) {
      await p2.evaluate(([l, s]) => { MP.prefs.layout = l; MP.prefs.size = s; MP.prefs.sort = 'cat'; mpRender(); }, [layout, size]);
      const r = await p2.evaluate(([l, s]) => {
        const out = {};
        const pg = document.getElementById('mappings-page');
        out.hOverflow = document.documentElement.scrollWidth > innerWidth + 1 || pg.scrollWidth > pg.clientWidth + 1 || pg.getBoundingClientRect().right > innerWidth + 1;
        const names = [...document.querySelectorAll('#mp-list .mp-nm')];
        out.cut = names.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent);
        if (l === 'F' && s === 'large') {
          out.labBelow = [...document.querySelectorAll('#mp-list .mp-f-pick')].filter(p => p.querySelector('.mp-labs')).every(p => p.querySelector('.mp-labs').getBoundingClientRect().top >= p.querySelector('.mp-f-cols').getBoundingClientRect().bottom - 1);
          out.nameTop = [...document.querySelectorAll('#mp-list .mp-f-row')].every(row => Math.abs(row.querySelector('.mp-nm').getBoundingClientRect().top - row.querySelector('.mp-f-cols').getBoundingClientRect().top) <= 6);
        }
        if (l === 'E') {
          const cells = [...document.querySelectorAll('#mp-list .mp-e-cell')];
          const byTop = new Map();
          cells.forEach(c => { const t = Math.round(c.getBoundingClientRect().top); if (!byTop.has(t)) byTop.set(t, []); byTop.get(t).push(c); });
          out.eAligned = [...byTop.values()].every(row => row.length < 2 || Math.abs(row[0].querySelector('.mp-nm').getBoundingClientRect().top - row[1].querySelector('.mp-nm').getBoundingClientRect().top) <= 1);
        }
        return out;
      }, [layout, size]);
      const tag = `${vp.name} ${layout === 'F' ? '單欄' : '雙欄'}${size === 'large' ? '大字' : '小字'}`;
      check(`${tag}：沒有左右捲動`, !r.hOverflow);
      check(`${tag}：商家名稱沒有被截斷`, r.cut.length === 0, r.cut.join('、'));
      if (r.labBelow !== undefined) check(`${tag}：等級／方案標籤在回饋率下一行`, r.labBelow);
      if (r.nameTop !== undefined) check(`${tag}：商家名稱與回饋率靠上對齊`, r.nameTop);
      if (r.eAligned !== undefined) check(`${tag}：同一排左右兩格商家名稱對齊`, r.eAligned);
      if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, `${vp.name}-${layout}-${size}.png`) });
    }
    await p2.context().close();
  }

  // ============ C. 存成圖片 ============
  console.log('\n【C】存成圖片');
  await pg.evaluate(() => { MP.prefs.layout = 'F'; MP.prefs.size = 'small'; MP.prefs.sort = 'cat'; MP.prefs.fmt = 'wall'; MP.prefs.ratio = 'iphone'; MP.prefs.theme = 'light'; MP.prefs.sel = null; mpRender(); });
  await pg.click('#mp-savebar [data-mp-open-export]');
  await pg.waitForSelector('#mp-export:not([hidden])');
  await pg.waitForFunction(() => document.getElementById('mp-exp-img').naturalWidth > 0, null, { timeout: 15000 });
  let img = await pg.evaluate(() => { const i = document.getElementById('mp-exp-img'); return { w: i.naturalWidth, h: i.naturalHeight, cap: MP.exp.capacity, sel: mpExportSelection(mpExportPool()).length, pool: mpExportPool().length, fits: MP.exp.fits }; });
  check('手機桌布 iPhone：1179×2556', img.w === 1179 && img.h === 2556, `${img.w}×${img.h}`);
  // 桌布留白：收據不能蓋到鎖定畫面的時鐘（上方約 25%）與手電筒／相機鈕（下方約 86% 起）
  const band = await pg.evaluate(async () => {
    const i = document.getElementById('mp-exp-img'); await i.decode();
    const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const col = x.getImageData(Math.round(c.width / 2), 0, 1, c.height).data, bg = [col[0], col[1], col[2]];
    let top = -1, bottom = -1;
    for (let y = 0; y < c.height; y++) { const d = Math.abs(col[y * 4] - bg[0]) + Math.abs(col[y * 4 + 1] - bg[1]) + Math.abs(col[y * 4 + 2] - bg[2]); if (d > 12) { if (top < 0) top = y; bottom = y; } }
    return { top: top / c.height, bottom: bottom / c.height };
  });
  check('桌布：收據在時鐘下方、手電筒／相機鈕上方', band.top >= 0.27 && band.bottom <= 0.86, `上緣 ${(band.top * 100).toFixed(1)}%／下緣 ${(band.bottom * 100).toFixed(1)}%`);
  check('桌布預設勾選「放得下的前 N 家」且放得下', img.sel === Math.min(img.cap, img.pool) && img.fits, `選 ${img.sel}／上限 ${img.cap}／可選 ${img.pool}`);
  check('按鈕是「預覽圖片 →」', (await pg.textContent('[data-mp-exp-next]')).includes('預覽圖片'));
  check('失效商家不會出現在可存的清單', await pg.evaluate(() => mpExportPool().every(g => !g.dead) && [...document.querySelectorAll('.mp-pk.off input')].every(i => i.disabled)));
  await pg.click('#mp-exp-all');
  let s1 = await pg.evaluate(() => mpExportSelection(mpExportPool()).length);
  check('按「全選」→ 變「全不選」', (await pg.textContent('#mp-exp-all')) === '全不選' || s1 === 0, `選 ${s1}`);
  if (s1 !== 0) { await pg.click('#mp-exp-all'); s1 = await pg.evaluate(() => mpExportSelection(mpExportPool()).length); }
  check('「全不選」→ 0 家、儲存鈕停用', s1 === 0 && await pg.isDisabled('#mp-exp-save'));
  await pg.click('#mp-exp-all');
  s1 = await pg.evaluate(() => ({ n: mpExportSelection(mpExportPool()).length, cap: MP.exp.capacity }));
  check('全選時自動選前面放得下的家數', s1.n === s1.cap, `${s1.n}／${s1.cap}`);
  await pg.click('[data-mp-exp-next]');
  const pvVisible = await pg.isVisible('#mp-exp-preview-pane');
  check('手機：按「預覽圖片 →」切到預覽', pvVisible);
  const bgLight = await pg.evaluate(() => getComputedStyle(document.getElementById('mp-exp-preview-pane')).backgroundColor);
  await pg.click('[data-mp-theme="dark"]');
  await pg.waitForFunction(() => MP.prefs.theme === 'dark' && document.getElementById('mp-exp-img').src, null, { timeout: 10000 });
  await pg.waitForTimeout(500);
  const bgDark = await pg.evaluate(() => getComputedStyle(document.getElementById('mp-exp-preview-pane')).backgroundColor);
  check('預覽背景：淺色＝淺底、深色＝深底', bgLight === 'rgb(238, 241, 245)' && bgDark === 'rgb(27, 31, 39)', `${bgLight} / ${bgDark}`);
  const px = await pg.evaluate(async () => { const i = document.getElementById('mp-exp-img'); await i.decode(); const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.drawImage(i, 0, 0, i.naturalWidth, i.naturalHeight, 0, 0, 400, 800); return [...x.getImageData(1, 1, 1, 1).data].slice(0, 3); });
  check('深色圖片的底色是深色', px[0] < 40 && px[1] < 40 && px[2] < 40, px.join(','));
  await pg.click('[data-mp-exp-prev]');
  await pg.click('[data-mp-fmt="long"]');
  await pg.waitForFunction(() => document.getElementById('mp-exp-img').naturalWidth === 1080, null, { timeout: 10000 }).catch(() => {});
  img = await pg.evaluate(() => ({ w: document.getElementById('mp-exp-img').naturalWidth, h: document.getElementById('mp-exp-img').naturalHeight, sel: mpExportSelection(mpExportPool()).length }));
  check('長圖：寬 1080、高度跟著內容', img.w === 1080 && img.h > 1080, `${img.w}×${img.h}`);
  await pg.evaluate(() => { MP.prefs.fmt = 'wall'; MP.prefs.size = 'large'; MP.prefs.sel = null; mpRenderExport(); });
  await pg.waitForTimeout(800);
  const capLarge = await pg.evaluate(() => MP.exp.capacity);
  check('大字的桌布上限比小字少', capLarge < s1.cap, `${capLarge} < ${s1.cap}`);
  if (SHOTS) { await pg.click('[data-mp-exp-next]'); await pg.screenshot({ path: path.join(SHOTS, 'export-preview-iphone13.png') }); await pg.click('[data-mp-exp-prev]'); }
  await pg.click('.mp-exp-settings-pane [data-mp-exp-close]');

  // ============ D. 返回、網址 ============
  console.log('\n【D】返回與網址');
  await pg.click('#home-view-switch-search');
  await pg.waitForFunction(() => document.getElementById('mappings-page').hidden, null, { timeout: 5000 });
  const backState = await pg.evaluate(() => ({ searchVisible: getComputedStyle(document.querySelector('.input-section')).display !== 'none', on: document.getElementById('home-view-switch-search').classList.contains('on') }));
  check('點「查詢回饋」：回到查詢畫面、網址回到首頁', new URL(pg.url()).pathname !== '/mappings' && backState.searchVisible && backState.on, pg.url());
  await pg.click('#home-view-switch-mappings');
  await pg.waitForSelector('#mappings-page:not([hidden])');
  await pg.goBack();
  await pg.waitForFunction(() => document.getElementById('mappings-page').hidden, null, { timeout: 5000 }).catch(() => {});
  check('瀏覽器「上一頁」也會關閉頁面', await pg.evaluate(() => document.getElementById('mappings-page').hidden));
  const lock = await pg.evaluate(() => document.body.style.overflow);
  check('頁面沒有被鎖住捲動', lock === '', `overflow=${lock}`);

  if (SHOTS) {
    await pg.evaluate(() => { MP.prefs.layout = 'F'; MP.prefs.size = 'small'; MP.prefs.sort = 'cat'; });
    await pg.screenshot({ path: path.join(SHOTS, 'home-switch-iphone13.png') });
  }
  // ============ E. 未登入 ============
  console.log('\n【E】未登入');
  const gp = await newPage(VIEWPORTS[1], '/index.html?start', true);
  check('未登入也看得到切換鈕', await gp.isVisible('#home-view-switch-mappings'));
  await gp.click('#home-view-switch-mappings');
  await gp.waitForSelector('#mappings-page:not([hidden])');
  await gp.waitForFunction(() => document.querySelector('#mp-list .mp-rc'), null, { timeout: 15000 });
  const gs = await gp.evaluate(() => ({ guest: !document.getElementById('mp-guest').hidden, demoRows: document.querySelectorAll('#mp-list [data-mp-row]').length, tag: !!document.querySelector('.mp-demo-tag'), noPointer: getComputedStyle(document.getElementById('mp-list')).pointerEvents === 'none', searchHidden: document.getElementById('mp-searchbox').hidden, loginBtn: !!document.getElementById('mp-guest-login') }));
  check('未登入：顯示範例小抄（標示範例、不能點）＋登入提示', gs.guest && gs.demoRows >= 3 && gs.tag && gs.noPointer && gs.searchHidden && gs.loginBtn, JSON.stringify(gs));
  if (SHOTS) await gp.screenshot({ path: path.join(SHOTS, 'guest-iphone13.png'), fullPage: false });
  await gp.context().close();

  check('過程中沒有 JavaScript 錯誤', pageErrors === 0, `${pageErrors} 個`);

  await browser.close();
  srv.close();
  const fail = results.filter(r => !r.ok);
  console.log(`\n${fail.length ? '❌' : '✅'} 配卡組合頁測試：${results.length - fail.length}/${results.length} 通過${SHOTS ? `（截圖：${SHOTS}）` : ''}`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
