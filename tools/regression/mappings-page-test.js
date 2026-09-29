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
      if (ref.coll === 'users' && globalThis.__limits) return Promise.resolve({ exists:()=>true, data:()=>({ creditLimits: globalThis.__limits }) });
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

  const writesBefore = await pg.evaluate(() => (globalThis.__setDocs || []).length);
  await pg.click('#home-view-switch-mappings');
  await pg.waitForSelector('#mappings-page:not([hidden])');
  check('點切換鈕 → 網址變 /mappings', new URL(pg.url()).pathname === '/mappings', pg.url());
  await pg.waitForFunction(() => MP.probed, null, { timeout: 20000 });
  const inline = await pg.evaluate(() => {
    const page = document.getElementById('mappings-page'), sw = document.getElementById('home-view-switch');
    const main = page.closest('main');
    const others = [...document.querySelectorAll('[data-view="search"]')];
    return { inMain: !!main, notFixed: getComputedStyle(page).position !== 'fixed', below: page.getBoundingClientRect().top >= sw.getBoundingClientRect().bottom - 1,
      othersHidden: others.every(el => getComputedStyle(el).display === 'none'), swOn: document.getElementById('home-view-switch-mappings').classList.contains('on'), noBack: !document.querySelector('[data-mp-back]') };
  });
  const writesOnOpen = await pg.evaluate((n) => (globalThis.__setDocs || []).slice(n).filter(d => d.data && (d.data.spendingMappings || d.data.merchantAliases || d.data.mappingsTitle)).length, writesBefore);
  check('🔒 打開刷卡小抄、重算失效都不會改寫已存的配對與排序', writesOnOpen === 0, `寫入 ${writesOnOpen} 次`);
  check('配卡組合顯示在切換鈕下方（不是蓋住整頁）', inline.inMain && inline.notFixed && inline.below && inline.swOn, JSON.stringify(inline));
  check('切到配卡組合時，查詢區塊都隱藏', inline.othersHidden);
  check('沒有返回箭頭', inline.noBack);
  const tabs = await pg.evaluate(() => { const sw = document.getElementById('home-view-switch'), h = sw.closest('header');
    return { inHeader: !!h, flush: !!h && Math.abs(sw.getBoundingClientRect().bottom - h.getBoundingClientRect().bottom) <= 1,
      sidebarHidden: ['.sidebar', '#sidebar-toggle-btn'].every(s => { const el = document.querySelector(s); return !el || getComputedStyle(el).display === 'none'; }) }; });
  check('分頁在藍色頁首裡、貼齊頁首底邊（文件夾分頁）', tabs.inHeader && tabs.flush, JSON.stringify(tabs));
  check('配卡組合畫面：左側「加入比較的卡片」欄與 ☰ 都隱藏', tabs.sidebarHidden);
  const clean = await pg.evaluate(() => ({ tools: document.getElementById('mp-tools').hidden, tip: document.getElementById('mp-tip').hidden, search: !document.getElementById('mp-searchbox').hidden, edit: !!document.getElementById('mp-edit-toggle') && document.getElementById('mp-edit-toggle').textContent.trim() === '編輯', grips: document.querySelectorAll('#mp-list [data-mp-grip]').length }));
  const erow = await pg.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const s = r('mp-search'), e = r('mp-edit-toggle'), l = r('mp-list');
    return { belowSearch: e.top >= s.bottom - 1, aboveList: e.bottom <= l.top + 1, count: document.getElementById('mp-count').textContent }; });
  check('手機：「編輯」在搜尋框下方、緊貼小抄上方（旁邊顯示商家數）', erow.belowSearch && erow.aboveList && /^已加入 \d+ 家商家$/.test(erow.count), JSON.stringify(erow));
  const intro = await pg.evaluate(() => ({ steps: document.querySelectorAll('.mp-intro .mp-steps li').length, text: document.querySelector('.mp-intro').textContent }));
  check('頁面說明改成三步驟說明卡', intro.steps === 3 && intro.text.includes('在查詢回饋的結果中按「加到我的小抄」') && intro.text.includes('活動自動存入以下刷卡小抄') && intro.text.includes('結帳前看一眼'), JSON.stringify(intro.steps));
  check('預設只顯示乾淨的小抄＋搜尋框（設定、提示都收起來）', clean.tools && clean.tip && clean.search && clean.edit && clean.grips === 0, JSON.stringify(clean));
  await pg.click('#mp-edit-toggle');
  const editOn = await pg.evaluate(() => ({ tools: !document.getElementById('mp-tools').hidden, tip: !document.getElementById('mp-tip').hidden, label: document.getElementById('mp-edit-toggle').textContent.trim() }));
  check('按「編輯」→ 設定與提示出現、按鈕變「完成」', editOn.tools && editOn.tip && editOn.label === '完成', JSON.stringify(editOn));
  const extHidden = await pg.evaluate(() => ['.spotlight-section', '.mc-related', '#scroll-to-spotlight-btn'].every(sel => { const el = document.querySelector(sel); return el && el.closest('[data-view="search"]') && getComputedStyle(el.closest('[data-view="search"]')).display === 'none'; }));
  check('推薦活動、推薦比較屬於「查詢回饋」畫面（切到配卡組合時整個畫面隱藏）', extHidden);
  const order = await pg.evaluate(() => { const y = id => document.getElementById(id).getBoundingClientRect().top;
    return { intro: !!document.querySelector('.mp-intro'), searchFirst: y('mp-searchbox') < y('mp-edit-toggle'), editThenTip: y('mp-edit-toggle') < y('mp-tip'), tipThenTools: y('mp-tip') < y('mp-tools'), toolsAboveList: y('mp-tools') < y('mp-list'), saveBelow: y('mp-savebar') > y('mp-list') }; });
  check('手機編輯中順序：說明 → 搜尋框 → 編輯 → 提示 → 設定 → 小抄 → 存成圖片', Object.values(order).every(Boolean), JSON.stringify(order));
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
  const plans = await pg.evaluate(() => [mpPlanLabel('cathay-cube', '切換「慶生月」方案 - 美食'), mpPlanLabel('cathay-cube', '切換「玩數位」方案'), mpPlanLabel('taishin-richart', '切換「天天刷」方案'), mpPlanLabel('taishin-richart', '切換「Pay著刷」方案'), mpPlanLabel('esun-unicard', '切換「任意選」方案')]);
  check('方案標籤：CUBE／Richart 的所有「切換「X」方案」都顯示，其他卡不顯示', JSON.stringify(plans) === JSON.stringify(['慶生月', '玩數位', '天天刷', 'Pay著刷', null]), JSON.stringify(plans));

  // 活動封頂金額（第二行）
  await pg.check('#mp-caps-toggle');
  const caps = await pg.evaluate(async () => {
    const bad = [];
    let shown = 0;
    for (const g of mpBuildGroups()) for (const e of g.entries) {
      if (e.dead || !e.cap) continue;
      const card = cardsData.cards.find(c => c.id === e.m.cardId);
      const r = (await calculateCardCashback(card, optimizeMerchantName(e.m.merchant).split('、')[0].trim(), 1000)).filter(x => Math.abs(x.rate - e.rate) < 0.001);
      const want = r.length ? mpCapText(card.id, r.sort((a, b) => String(b.periodEnd || '9999').localeCompare(String(a.periodEnd || '9999')))[0].cap) : null;
      if (want && want !== e.cap) bad.push(`${g.key}: ${e.cap} ≠ ${want}`);
    }
    document.querySelectorAll('#mp-list .mp-f-pick.has-row2').forEach(p => { const c = p.querySelector('.mp-cap'); if (!c) return; shown++;
      if (c.getBoundingClientRect().top < p.querySelector('.mp-f-cols').getBoundingClientRect().bottom - 1) bad.push('封頂金額不在第二行'); if (!/^(消費上限 NT\$[\d,]+\+?|無消費上限)$/.test(c.textContent)) bad.push('格式 ' + c.textContent); });
    return { bad, shown, saved: MP.prefs.caps };
  });
  check('勾「顯示活動封頂金額」→ 第二行顯示消費上限，數字＝查詢結果的回饋消費上限', caps.shown > 3 && caps.bad.length === 0 && caps.saved, caps.bad.slice(0, 3).join('；') || `${caps.shown} 筆`);
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.evaluate(() => document.getElementById('mp-list').scrollIntoView()); await pg.screenshot({ path: path.join(SHOTS, 'caps-iphone13.png') });
    await pg.evaluate(() => { MP.prefs.size = 'large'; mpRender(); }); await pg.screenshot({ path: path.join(SHOTS, 'caps-large-iphone13.png') }); await pg.evaluate(() => { MP.prefs.size = 'small'; mpRender(); }); }
  await pg.uncheck('#mp-caps-toggle');
  const head = await pg.evaluate(() => ({ store: document.querySelector('#mp-list .mp-store').textContent.trim(), barcode: !!document.querySelector('#mp-list .mp-barcode, #mp-list svg[aria-label^="條碼"]'), url: !!document.querySelector('#mp-list .mp-url') }));
  check('小抄最上方只留日期、底部沒有條碼（保留網址）', /^\d{4}-\d{2}$/.test(head.store) && !head.barcode && head.url, JSON.stringify(head));
  // 持有信用卡＝「我的信用卡」選取的卡（與 #owned-count-badge 一致），不是小抄用到的卡
  const owned = await pg.evaluate(() => { const ids = cardsData.cards.slice(0, 3).map(c => c.id); myOwnedCards = new Set(ids); globalThis.__limits = { [ids[0]]: 80000, [ids[1]]: 150000 }; renderOwnedCardsOverview(); return { n: ids.length, badge: document.getElementById('owned-count-badge').textContent }; });
  await pg.check('#mp-summary-toggle');
  await pg.waitForSelector('#mp-sum-btn', { timeout: 5000 }).catch(() => {});
  const sum = await pg.evaluate(() => { const b = document.getElementById('mp-sum-btn'); const rows = b ? [...b.querySelectorAll('.mp-tot')].map(r => ({ k: r.querySelector('.mp-tot-k').textContent, v: r.querySelector('b').textContent, leader: r.querySelector('i').getBoundingClientRect().width })) : [];
    return { rows, note: (b && b.querySelector('.mp-tot-note') || {}).textContent || '', eq: !!document.querySelector('#mp-list .mp-eq-tot'), toast: !!document.querySelector('.mp-toast'), saved: MP.prefs.summary }; });
  const badgeN = (owned.badge.match(/\d+/) || [''])[0];
  check('單據合計：持有信用卡＝「我的信用卡」張數（同 owned-count-badge）、額度合計 NT$230,000、未填另註', sum.rows.length === 2 && sum.rows[0].k === '持有信用卡' && sum.rows[0].v === `${owned.n} 張` && badgeN === String(owned.n) && sum.rows[1].k === '額度合計' && sum.rows[1].v === 'NT$230,000' && sum.note === '＊其中 1 張未填額度' && sum.saved, JSON.stringify({ sum, badge: owned.badge }));
  check('合計區是單據樣式（點狀引線＋雙線），勾選時不再跳提示', sum.rows.every(r => r.leader > 10) && sum.eq && !sum.toast);
  await pg.evaluate(() => { const id = Object.keys(globalThis.__limits)[0]; globalThis.__limits[id] = 100000; notifyMappingsDataChanged(); });
  await pg.waitForFunction(() => /NT\$250,000/.test((document.getElementById('mp-sum-btn') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check('其他頁改了額度（notifyMappingsDataChanged 事件）→ 合計即時更新', await pg.evaluate(() => /NT\$250,000/.test(document.getElementById('mp-sum-btn').textContent)));
  await pg.click('#mp-sum-btn');
  const ownedOpen = await pg.evaluate(() => getComputedStyle(document.getElementById('my-owned-cards-modal')).display !== 'none');
  check('點合計區 → 打開「我的信用卡」', ownedOpen);
  const closeOwned = () => pg.evaluate(() => { document.getElementById('my-owned-cards-modal').style.display = 'none'; if (typeof enableBodyScroll === 'function') enableBodyScroll(); });
  await closeOwned();
  await pg.click('#mp-tools [data-mp-help]');
  const help = await pg.evaluate(() => { const p = document.getElementById('mp-help-pop'); return p ? p.textContent : ''; });
  check('「?」說明文字', help === '信用卡數量為「我的信用卡」中選取的卡片數量；額度為各信用卡的詳情頁中，所填寫的「我的額度」。點小抄上的信用卡圖片就能打開詳情頁。', help);
  await pg.click('#mp-help-pop [data-mp-open-owned]');
  const viaHelp = await pg.evaluate(() => ({ modal: getComputedStyle(document.getElementById('my-owned-cards-modal')).display !== 'none', popGone: !document.getElementById('mp-help-pop') }));
  check('說明裡的「我的信用卡」可以點，打開 modal', viaHelp.modal && viaHelp.popGone, JSON.stringify(viaHelp));
  await closeOwned();
  await pg.uncheck('#mp-summary-toggle');
  check('取消勾選 → 不顯示卡數與額度', await pg.evaluate(() => !document.getElementById('mp-sum-btn')));
  check('取消勾選 → 封頂金額消失', await pg.evaluate(() => !document.querySelector('#mp-list .mp-cap')));
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
    check('點「回饋已變」→ 顯示原本與新的回饋率', rs.open && rs.text.includes('原本加入時') && rs.opts > 0, rs.text.slice(0, 60));
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

  // 刪除要兩段式確認
  await pg.click(`#mp-list [data-mp-edit="${target}"]`);
  const rmBtn = await pg.$('#mp-edit-remove [data-mp-remove]');
  const rmId = await rmBtn.getAttribute('data-mp-remove');
  await rmBtn.click();
  const rm1 = await pg.evaluate((id) => ({ still: userSpendingMappings.some(m => m.id === id), text: document.querySelector(`#mp-edit-remove [data-mp-remove="${id}"]`).textContent }), rmId);
  check('刪除活動要按兩次：第一次只變成「確定刪除？」', rm1.still && rm1.text === '確定刪除？再按一次', JSON.stringify(rm1));
  await pg.click('[data-mp-sheet-close]');

  // 失效判定不能誤判（會被「刪除全部失效活動」刪掉）
  const probes = await pg.evaluate(async () => ({
    // 模擬用戶用 5,000 元搜尋後釘選：存的回饋率＝那次搜尋結果的 rate
    threshold: await (async () => { const card = cardsData.cards.find(c => c.id === 'ctbc-linepay-card'); const r = (await calculateCardCashback(card, '營養師輕食', 5000))[0];
      return mpProbe({ id: 't1', cardId: card.id, cardName: card.name, merchant: r.matchedItem, cashbackRate: r.rate, periodEnd: '2026-12-31' }); })(),
    upcoming: await mpProbe({ id: 't2', cardId: 'hsbc-liveplus', cardName: '滙豐 Live+ 卡', merchant: 'zzz還沒開始', cashbackRate: 3, periodStart: '2026-12-01', periodEnd: '2027-01-31' }),
    gone: await mpProbe({ id: 't3', cardId: 'hsbc-liveplus', cardName: '滙豐 Live+ 卡', merchant: 'zzz不存在商家', cashbackRate: 3, periodEnd: '2026-12-31' })
  }));
  check('單筆滿額（滿 5,000）的活動：不當成下架、也不當成回饋已變', probes.threshold.dead === null && probes.threshold.next && !(probes.threshold.cands || []).length, JSON.stringify({ dead: probes.threshold.dead, next: probes.threshold.next, cands: probes.threshold.cands }));
  check('還沒開始的活動：不當成下架', probes.upcoming.dead === null, JSON.stringify(probes.upcoming.dead));
  check('卡片資料裡真的沒有的商家：仍判定已下架', probes.gone.dead === 'gone');

  // 雲端沒讀到時不能寫回（避免舊快取蓋掉雲端）
  const guard = await pg.evaluate(async () => {
    const before = (globalThis.__setDocs || []).length; const alerts = []; const oa = window.alert; window.alert = m => alerts.push(m);
    mappingsLoadState = 'error';
    await mpUpdateDeadlines(); await mpDeleteAllDead();
    mappingsLoadState = 'ok'; window.alert = oa;
    return { writes: (globalThis.__setDocs || []).length - before, alerted: alerts.length > 0 };
  });
  check('雲端沒讀到（error）時：更新期限、刪除都不寫回，並提示', guard.writes === 0 && guard.alerted, JSON.stringify(guard));

  // 長圖很長時自動降寬，不超過 iOS canvas 上限
  const longImg = await pg.evaluate(async () => { const g = mpBuildGroups().filter(x => !x.dead); const items = Array.from({ length: 300 }, (_, i) => ({ ...g[i % g.length], key: 'k' + i }));
    const { canvas } = await mpRenderCanvas([{ key: null, title: null, items }], { ...mpExportOpts(), fmt: 'long' }); return { w: canvas.width, h: canvas.height, px: canvas.width * canvas.height }; });
  check('長圖 300 家：自動降寬，總像素不超過 1600 萬', longImg.px <= 16e6 && longImg.w < 1080 && longImg.w >= 540, JSON.stringify(longImg));

  // 點卡圖 → 詳情頁疊在上面
  await pg.click('#mp-list .mp-cardbtn');
  await pg.waitForSelector('#card-detail-modal', { state: 'visible', timeout: 5000 }).catch(() => {});
  const onTop = await pg.evaluate(() => { const m = document.getElementById('card-detail-modal'); if (!m || getComputedStyle(m).display === 'none') return false; const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return m.contains(el); });
  check('點卡圖 → 卡片詳情疊在配卡組合上面', onTop);
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => { const m = document.getElementById('card-detail-modal'); if (m && getComputedStyle(m).display !== 'none') { const b = m.querySelector('.close-modal, [id*=close]'); if (b) b.click(); } });

  // 顯示等級／方案：常駐；雙欄灰色不可勾
  await pg.click('#mp-tools [data-mp-layout="E"]');
  const chkE = await pg.evaluate(() => { const c = document.getElementById('mp-labels-toggle'); return c && { disabled: c.disabled, color: getComputedStyle(c.closest('label')).color }; });
  await pg.click('#mp-tools [data-mp-layout="F"]');
  const chkF = await pg.evaluate(() => { const c = document.getElementById('mp-labels-toggle'); return c && { disabled: c.disabled, checked: c.checked }; });
  check('「顯示等級／方案」常駐；雙欄變灰不可勾、切回單欄恢復', !!chkE && chkE.disabled && chkE.color === 'rgb(182, 188, 198)' && chkF && !chkF.disabled && chkF.checked, JSON.stringify({ chkE, chkF }));

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
    if (vp.name === 'desktop-1440') {
      await p2.evaluate(() => { MP.prefs.layout = 'F'; MP.prefs.size = 'small'; MP.editing = false; mpRender(); });
      const d0 = await p2.evaluate(() => { const r = el => el.getBoundingClientRect(); const side = document.querySelector('.mp-side'), list = document.getElementById('mp-list'), intro = document.querySelector('.mp-intro'), lay = document.querySelector('.mp-layout > .mp-side').parentElement;
        const vis = el => el && getComputedStyle(el).display !== 'none' && r(el).width > 0;
        const sideR = r(side), listR = r(list), introR = r(intro);
        return { editInSide: side.contains(document.getElementById('mp-edit-toggle')) && vis(document.getElementById('mp-edit-toggle')), saveInSide: vis(document.querySelector('.mp-side-save')), bottomSaveHidden: !vis(document.querySelector('#mp-savebar .mp-big')),
          sideLeft: sideR.right <= listR.left, introCentered: Math.abs((introR.left + introR.right) / 2 - innerWidth / 2) <= 2 && Math.abs(introR.left - sideR.left) <= 2 && Math.abs(introR.right - listR.right) <= 2, listTop: Math.round(listR.top) }; });
      check('桌機：編輯、存成圖片在左側欄；小抄下方不再放存成圖片', d0.editInSide && d0.saveInSide && d0.bottomSaveHidden && d0.sideLeft, JSON.stringify(d0));
      check('桌機：說明卡置中，與左欄＋小抄同寬', d0.introCentered, JSON.stringify(d0));
      await p2.click('#mp-edit-toggle');
      const d1 = await p2.evaluate(() => ({ listTop: Math.round(document.getElementById('mp-list').getBoundingClientRect().top), toolsInSide: document.querySelector('.mp-side').contains(document.getElementById('mp-tools')) && !document.getElementById('mp-tools').hidden }));
      check('桌機：按「編輯」後設定出現在左側，小抄不跳位置', d1.toolsInSide && d1.listTop === d0.listTop, `${d0.listTop} → ${d1.listTop}`);
    }
    await p2.evaluate(() => { MP.prefs.layout = 'F'; MP.prefs.size = 'small'; MP.editing = true; mpRender(); });
    const eo = await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    check(`${vp.name} 編輯中：沒有左右捲動`, eo);
    if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, `${vp.name}-editing.png`) });
    if (vp.name === 'desktop-1440') {
      await p2.evaluate(() => { MP.prefs.layout = 'E'; mpRender(); });
      if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, `${vp.name}-editing-E.png`) });
      await p2.evaluate(() => { MP.prefs.layout = 'F'; MP.prefs.fmt = 'wall'; MP.prefs.ratio = 'common'; MP.prefs.sel = null; Object.assign(MP.prefs.x, { layout: 'F', size: 'small', sort: 'cat' }); mpRender(); });
      await p2.click('.mp-side-save');
      await p2.waitForFunction(() => document.getElementById('mp-exp-img').naturalWidth > 0, null, { timeout: 15000 });
      const dr = await p2.evaluate(() => ({ buttons: document.querySelectorAll('[data-mp-ratio]').length, note: document.querySelector('.mp-ratio-note').textContent.trim() }));
      check('桌機：沒有選項按鈕，只顯示通用比例', dr.buttons === 0 && dr.note === '通用（iPhone、三星與多數 Android）：比例 19.5:9（1440×3120）', JSON.stringify(dr));
      const hint = await p2.evaluate(() => { const h = document.querySelector('.mp-pick-hint'), b = document.getElementById('mp-exp-all'); if (!h) return null; const a = h.getBoundingClientRect(), c = b.getBoundingClientRect();
        return { text: h.textContent, oneLine: a.height < parseFloat(getComputedStyle(h).lineHeight) * 1.6 + parseFloat(getComputedStyle(h).paddingTop) + parseFloat(getComputedStyle(h).paddingBottom), sameRow: Math.abs((a.top + a.bottom) / 2 - (c.top + c.bottom) / 2) <= 4 }; });
      check('桌機：提示「已選的圖片規格只放得下 N 家…」與「全選」同一排、一行放得下', !!hint && /^已選的圖片規格只放得下 \d+ 家。若想全放，請改選「長圖」。$/.test(hint.text) && hint.oneLine && hint.sameRow, JSON.stringify(hint));
      const sc = await p2.evaluate(() => { const b = document.getElementById('mp-exp-settings'); const before = b.scrollHeight > b.clientHeight + 10; b.scrollTop = b.scrollHeight; const last = [...document.querySelectorAll('.mp-picks .mp-pk')].pop(); const r = last.getBoundingClientRect(), br = b.getBoundingClientRect();
        return { overflow: before, scrolled: b.scrollTop > 0, lastVisible: r.bottom <= br.bottom + 1 && r.top >= br.top - 1 }; });
      check('桌機：設定欄可以往下捲，最後一個商家選得到', sc.overflow && sc.scrolled && sc.lastVisible, JSON.stringify(sc));
      await p2.evaluate(() => document.getElementById('mp-exp-settings').scrollTop = 0);
      await p2.click('#mp-exp-settings [data-mp-layout="E"]');
      await p2.click('#mp-exp-settings [data-mp-sort="az"]');
      await p2.check('#mp-exp-caps');
      const ind = await p2.evaluate(() => ({ xLayout: MP.prefs.x.layout, xSort: MP.prefs.x.sort, xCaps: MP.prefs.x.caps, pageLayout: MP.prefs.layout, pageSort: MP.prefs.sort, pageCaps: MP.prefs.caps, pageGrid: !!document.querySelector('#mp-list .mp-e-grid'), pageCapShown: !!document.querySelector('#mp-list .mp-cap') }));
      check('存圖設定不連動小抄：圖片改雙欄／A–Z／封頂金額，小抄維持原樣', ind.xLayout === 'E' && ind.xSort === 'az' && ind.xCaps && ind.pageLayout === 'F' && ind.pageSort === 'cat' && !ind.pageCaps && !ind.pageGrid && !ind.pageCapShown, JSON.stringify(ind));
      await p2.evaluate(() => { Object.assign(MP.prefs.x, { layout: 'F', sort: 'cat', caps: false }); mpRenderExport(); });
      await p2.waitForTimeout(600);
      if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, `${vp.name}-export.png`) });
      await p2.click('.mp-exp-settings-pane [data-mp-exp-close]');
    }
    await p2.context().close();
  }

  // ============ C. 存成圖片 ============
  console.log('\n【C】存成圖片');
  await pg.evaluate(() => { MP.prefs.layout = 'F'; MP.prefs.size = 'small'; MP.prefs.sort = 'cat'; Object.assign(MP.prefs.x, { layout: 'F', size: 'small', sort: 'cat' }); MP.prefs.fmt = 'wall'; MP.prefs.ratio = 'common'; MP.prefs.theme = 'light'; MP.prefs.sel = null; mpRender(); });
  await pg.click('#mp-savebar [data-mp-open-export]');
  await pg.waitForSelector('#mp-export:not([hidden])');
  await pg.waitForFunction(() => document.getElementById('mp-exp-img').naturalWidth > 0, null, { timeout: 15000 });
  let img = await pg.evaluate(() => { const i = document.getElementById('mp-exp-img'); return { w: i.naturalWidth, h: i.naturalHeight, cap: MP.exp.capacity, sel: mpExportSelection(mpExportPool()).length, pool: mpExportPool().length, fits: MP.exp.fits }; });
  check('手機桌布「通用」：1440×3120（19.5:9）', img.w === 1440 && img.h === 3120, `${img.w}×${img.h}`);
  const ratios = await pg.$$eval('[data-mp-ratio]', b => b.map(x => x.textContent.trim()));
  const note1 = (await pg.textContent('.mp-ratio-note')).trim();
  await pg.click('[data-mp-ratio="auto"]');
  await pg.waitForFunction(() => document.getElementById('mp-exp-img').naturalWidth === screen.width * devicePixelRatio, null, { timeout: 10000 }).catch(() => {});
  const note2 = (await pg.textContent('.mp-ratio-note')).trim();
  check('手機桌布尺寸：只有「本機｜通用」，解析度與比例顯示在下方', JSON.stringify(ratios) === '["本機","通用"]' && note1 === '通用（iPhone、三星與多數 Android）：比例 19.5:9（1440×3120）' && /^本機螢幕：比例 [\d.]+:9（\d+×\d+）$/.test(note2), JSON.stringify({ ratios, note1, note2 }));
  await pg.click('[data-mp-ratio="common"]');
  await pg.waitForFunction(() => document.getElementById('mp-exp-img').naturalHeight === 3120, null, { timeout: 10000 }).catch(() => {});
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
  const fold = await pg.evaluate(() => ({ collapsed: getComputedStyle(document.getElementById('mp-picks')).display === 'none', chev: getComputedStyle(document.querySelector('.mp-chev')).display !== 'none',
    previewTop: document.getElementById('mp-exp-preview-pane').getBoundingClientRect().top, vh: innerHeight }));
  check('手機：「要放進圖片的商家」預設收合、有箭頭；不用往下捲就看得到預覽區', fold.collapsed && fold.chev && fold.previewTop < fold.vh, JSON.stringify(fold));
  await pg.click('#mp-pick-toggle');
  check('點箭頭 → 展開商家選項', await pg.evaluate(() => getComputedStyle(document.getElementById('mp-picks')).display !== 'none' && document.getElementById('mp-pick-toggle').getAttribute('aria-expanded') === 'true'));
  const stack = await pg.evaluate(() => { const s = document.querySelector('.mp-exp-settings-pane'), v = document.getElementById('mp-exp-preview-pane');
    const picks = [...document.querySelectorAll('.mp-picks .mp-pk')].slice(0, 2).map(e => e.getBoundingClientRect());
    return { noNextBtn: !document.querySelector('[data-mp-exp-next]'), bothShown: getComputedStyle(s).display !== 'none' && getComputedStyle(v).display !== 'none', below: v.getBoundingClientRect().top >= s.getBoundingClientRect().bottom - 1,
      diffBg: getComputedStyle(v).backgroundColor !== getComputedStyle(document.querySelector('.mp-exp-box')).backgroundColor, twoCol: picks.length === 2 && Math.abs(picks[0].top - picks[1].top) <= 1 && picks[1].left > picks[0].right - 1 }; });
  check('手機：預覽直接接在設定下方（不用按按鈕），兩區背景不同', stack.noNextBtn && stack.bothShown && stack.below && stack.diffBg, JSON.stringify(stack));
  check('要放進圖片的商家用兩欄顯示', stack.twoCol);
  check('失效商家不會出現在可存的清單', await pg.evaluate(() => mpExportPool().every(g => !g.dead) && [...document.querySelectorAll('.mp-pk.off input')].every(i => i.disabled)));
  await pg.click('#mp-exp-all');
  let s1 = await pg.evaluate(() => mpExportSelection(mpExportPool()).length);
  check('按「全選」→ 變「全不選」', (await pg.textContent('#mp-exp-all')) === '全不選' || s1 === 0, `選 ${s1}`);
  if (s1 !== 0) { await pg.click('#mp-exp-all'); s1 = await pg.evaluate(() => mpExportSelection(mpExportPool()).length); }
  check('「全不選」→ 0 家、儲存鈕停用', s1 === 0 && await pg.isDisabled('#mp-exp-save'));
  await pg.click('#mp-exp-all');
  s1 = await pg.evaluate(() => ({ n: mpExportSelection(mpExportPool()).length, cap: MP.exp.capacity }));
  check('全選時自動選前面放得下的家數', s1.n === s1.cap, `${s1.n}／${s1.cap}`);
  const bgLight = await pg.evaluate(() => getComputedStyle(document.getElementById('mp-exp-preview-pane')).backgroundColor);
  await pg.click('[data-mp-theme="dark"]');
  await pg.waitForFunction(() => MP.prefs.theme === 'dark' && document.getElementById('mp-exp-img').src, null, { timeout: 10000 });
  await pg.waitForTimeout(500);
  const bgDark = await pg.evaluate(() => getComputedStyle(document.getElementById('mp-exp-preview-pane')).backgroundColor);
  check('預覽背景：淺色＝淺底、深色＝深底', bgLight === 'rgb(227, 232, 239)' && bgDark === 'rgb(27, 31, 39)', `${bgLight} / ${bgDark}`);
  const px = await pg.evaluate(async () => { const i = document.getElementById('mp-exp-img'); await i.decode(); const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.drawImage(i, 0, 0, i.naturalWidth, i.naturalHeight, 0, 0, 400, 800); return [...x.getImageData(1, 1, 1, 1).data].slice(0, 3); });
  check('深色圖片的底色是深色', px[0] < 40 && px[1] < 40 && px[2] < 40, px.join(','));
  await pg.click('[data-mp-fmt="long"]');
  await pg.waitForFunction(() => document.getElementById('mp-exp-img').naturalWidth === 1080, null, { timeout: 10000 }).catch(() => {});
  img = await pg.evaluate(() => ({ w: document.getElementById('mp-exp-img').naturalWidth, h: document.getElementById('mp-exp-img').naturalHeight, sel: mpExportSelection(mpExportPool()).length }));
  check('長圖：寬 1080、高度跟著內容', img.w === 1080 && img.h > 1080, `${img.w}×${img.h}`);
  await pg.evaluate(() => { MP.prefs.fmt = 'wall'; MP.prefs.x.size = 'large'; MP.prefs.sel = null; mpRenderExport(); });
  await pg.waitForTimeout(800);
  const capLarge = await pg.evaluate(() => MP.exp.capacity);
  check('大字的桌布上限比小字少', capLarge < s1.cap, `${capLarge} < ${s1.cap}`);
  if (SHOTS) { await pg.evaluate(() => { MP.prefs.x.size = 'small'; MP.prefs.x.caps = true; MP.prefs.x.summary = true; MP.prefs.fmt = 'long'; MP.prefs.sel = null; MP.exp.pickOpen = false; mpRenderExport(); }); await pg.waitForTimeout(1200);
    await pg.evaluate(() => { const a = document.createElement('a'); a.id = '__cap'; a.href = document.getElementById('mp-exp-img').src; document.body.appendChild(a); });
    const du = await pg.$eval('#__cap', a => a.href); fs.writeFileSync(path.join(SHOTS, 'export-long-caps.png'), Buffer.from(du.split(',')[1], 'base64'));
    await pg.click('#mp-pick-toggle'); await pg.waitForTimeout(200); await pg.screenshot({ path: path.join(SHOTS, 'export-picks-open-iphone13.png') }); await pg.click('#mp-pick-toggle');
    await pg.evaluate(() => { MP.prefs.x.caps = false; MP.prefs.x.summary = false; MP.prefs.fmt = 'wall'; MP.prefs.sel = null; document.querySelector('.mp-exp-box').scrollTop = 0; mpRenderExport(); }); await pg.waitForTimeout(800); await pg.screenshot({ path: path.join(SHOTS, 'export-settings-iphone13.png') });
    await pg.evaluate(() => document.getElementById('mp-exp-preview-pane').scrollIntoView()); await pg.screenshot({ path: path.join(SHOTS, 'export-preview-iphone13.png') }); }
  await pg.click('.mp-exp-settings-pane [data-mp-exp-close]');

  // ============ D. 返回、網址 ============
  console.log('\n【D】返回與網址');
  await pg.click('#home-view-switch-search');
  await pg.waitForFunction(() => document.getElementById('mappings-page').hidden, null, { timeout: 5000 });
  const backState = await pg.evaluate(() => ({ searchVisible: getComputedStyle(document.querySelector('.input-section')).display !== 'none', on: document.getElementById('home-view-switch-search').classList.contains('on') }));
  check('點「查詢回饋」：回到查詢畫面、網址回到首頁', new URL(pg.url()).pathname !== '/mappings' && backState.searchVisible && backState.on, pg.url());
  const viewsBack = await pg.evaluate(() => ({ search: [...document.querySelectorAll('[data-view="search"]')].every(el => !el.hidden), mappings: document.getElementById('mappings-page').hidden }));
  check('回到查詢回饋：查詢畫面兩塊都顯示、配卡組合隱藏', viewsBack.search && viewsBack.mappings, JSON.stringify(viewsBack));
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
  const gs = await gp.evaluate(() => ({ guest: !document.getElementById('mp-guest').hidden, demoRows: document.querySelectorAll('#mp-list [data-mp-row]').length, tag: !document.getElementById('mp-demo-tag').hidden, search: !document.getElementById('mp-searchbox').hidden, edit: !!document.getElementById('mp-edit-toggle'), loginBtn: !!document.getElementById('mp-guest-login') }));
  check('未登入：顯示範例小抄（標示範例）＋登入提示＋搜尋框＋編輯鈕', gs.guest && gs.demoRows >= 3 && gs.tag && gs.search && gs.edit && gs.loginBtn, JSON.stringify(gs));
  if (SHOTS) await gp.screenshot({ path: path.join(SHOTS, 'guest-iphone13.png'), fullPage: false });
  await gp.click('#mp-edit-toggle');
  await gp.click('#mp-tools [data-mp-sort="az"]');
  const gEdit = await gp.evaluate(() => ({ tools: !document.getElementById('mp-tools').hidden, sort: MP.prefs.sort, ltr: document.querySelectorAll('#mp-list .mp-ltr').length }));
  check('未登入：按「編輯」看得到全部設定、可以切換排列', gEdit.tools && gEdit.sort === 'az' && gEdit.ltr > 0, JSON.stringify(gEdit));
  const gPos = await gp.evaluate(() => document.getElementById('mp-tools').getBoundingClientRect().top >= document.getElementById('mp-guest').getBoundingClientRect().bottom - 1);
  check('未登入：設定出現在「登入解鎖此功能」框的下方', gPos);
  const gk = await gp.$eval('#mp-list [data-mp-row]', r => r.dataset.mpRow);
  await gp.click(`#mp-list [data-mp-edit="${gk}"]`);
  await gp.fill('#mp-edit-input', '範例改名');
  await gp.click('#mp-edit-save');
  const gRen = await gp.evaluate((k) => ({ shown: document.querySelector(`#mp-list [data-mp-edit="${k}"]`).textContent, noWrite: !(globalThis.__setDocs || []).length, noLocal: !Object.keys(localStorage).some(x => x.startsWith('merchantAliases_')) }), gk);
  check('未登入：範例可以改名，但不寫雲端、不存本機', gRen.shown.includes('範例改名') && gRen.noWrite && gRen.noLocal, JSON.stringify(gRen));
  if (SHOTS) await gp.screenshot({ path: path.join(SHOTS, 'guest-editing-iphone13.png'), fullPage: false });
  await gp.context().close();
  const gd = await newPage(VIEWPORTS[1], '/mappings?start', true);
  const demoOk = await gd.waitForFunction(() => document.querySelectorAll('#mp-list [data-mp-row]').length >= 3, null, { timeout: 20000 }).then(() => true).catch(() => false);
  check('未登入直接開 /mappings：範例小抄會載入（不會卡在「範例載入中…」）', demoOk);
  await gd.context().close();

  // 登出後：上一位用戶的標題／改名不能留在記憶體（共用裝置）
  const lo = await pg.evaluate(() => { userMappingsTitle = '小明的刷卡表'; userMerchantAliases = { 'line pay': '我的LP' }; const u = currentUser; currentUser = null; refreshMappingsEntry(); const r = { title: userMappingsTitle, aliases: Object.keys(userMerchantAliases).length }; currentUser = u; return r; });
  check('登出後清掉上一位用戶的小抄標題與自訂商家名', lo.title === '' && lo.aliases === 0, JSON.stringify(lo));
  check('過程中沒有 JavaScript 錯誤', pageErrors === 0, `${pageErrors} 個`);

  await browser.close();
  srv.close();
  const fail = results.filter(r => !r.ok);
  console.log(`\n${fail.length ? '❌' : '✅'} 配卡組合頁測試：${results.length - fail.length}/${results.length} 通過${SHOTS ? `（截圖：${SHOTS}）` : ''}`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
