#!/usr/bin/env node
/**
 * 一般消費排除項目（card.basicExclusions）行為測試（2026-09-30 新增）
 *
 * 為什麼獨立一支：凍結的 fixture.data 拍攝時還沒有 basicExclusions 欄，run-regression.js 因此
 * 完全碰不到這條路徑（那也正是它應有的樣子——沒填名單時行為必須逐字不變）。這支載入同一份
 * 凍結資料＋凍結時鐘，再在頁面裡對 cardsData.cards 臨時塞排除名單，逐情境驗證。
 *
 * 用法（repo 根目錄，需先 npm install playwright）：
 *   node tools/regression/basic-exclusions-test.js     # 全部通過 → exit 0，任一失敗 → exit 1
 *
 * 規則的正本在 js/search-match.js「一般消費排除項目」區塊。
 */
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const META = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));

function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/cards.data' || urlPath === '/cards.version') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(urlPath === '/cards.data' ? fs.readFileSync(path.join(__dirname, 'fixture.data')) : META.cardsVersion);
        return;
      }
      const file = path.join(REPO, urlPath === '/' ? 'index.html' : urlPath);
      if (!file.startsWith(REPO) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// 訪客模式的 Firebase 替身（同 run-regression.js）
function stub(url) {
  const R = 'Promise.resolve()';
  if (url.includes('firebase-app')) return 'export function initializeApp(){return {};}';
  if (url.includes('firebase-analytics')) return 'export function getAnalytics(){return {};} export function logEvent(){}';
  if (url.includes('firebase-auth')) return `
    export function getAuth(){return {};}
    export function onAuthStateChanged(a, cb){ setTimeout(() => cb(null), 0); }
    export class GoogleAuthProvider { setCustomParameters(){} }
    export function signInWithPopup(){return ${R};} export function signOut(){return ${R};}
    export function createUserWithEmailAndPassword(){return ${R};} export function signInWithEmailAndPassword(){return ${R};}
    export function sendPasswordResetEmail(){return ${R};} export function deleteUser(){return ${R};}
    export function reauthenticateWithPopup(){return ${R};} export function reauthenticateWithCredential(){return ${R};}
    export class EmailAuthProvider { static credential(){return {};} }`;
  if (url.includes('firebase-firestore')) return `
    export function getFirestore(){return {};} export function doc(){return {};}
    export function getDoc(){return Promise.resolve({ exists: () => false, data: () => undefined });}
    export function setDoc(){return ${R};} export function addDoc(){return ${R};} export function collection(){return {};}
    export function serverTimestamp(){return 0;} export function deleteField(){return 0;} export function deleteDoc(){return ${R};}`;
  if (url.includes('firebase-storage')) return `
    export function getStorage(){return {};} export function ref(){return {};}
    export function uploadBytes(){return ${R};} export function getDownloadURL(){return Promise.resolve('');}`;
  return 'export default {};';
}

function freezeClock(iso) {
  return `(() => { const R = Date, ms = new R(${JSON.stringify(iso)}).getTime();
    function F(...a){ if (!(this instanceof F)) return new R(ms).toString(); return a.length ? new R(...a) : new R(ms); }
    F.prototype = R.prototype; F.now = () => ms; F.parse = R.parse; F.UTC = R.UTC;
    Object.setPrototypeOf(F, R); window.Date = F; })();`;
}

(async () => {
  const srv = await startServer();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const execPath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(execPath ? { executablePath: execPath } : {});
  const page = await browser.newPage();
  await page.addInitScript(freezeClock(META.frozenDate));
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // 外部資源（廣告/字型）被 route.abort() 擋掉會噴 Failed to load resource，那是測試環境刻意的，不算
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text());
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('gstatic.com/firebasejs')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: stub(url) });
    return route.abort();
  });
  await page.goto(`${base}/index.html?start&debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.card-count')?.textContent?.trim() || ''), null, { timeout: 20000 });
  await page.waitForSelector('#merchant-input', { state: 'visible', timeout: 20000 });
  const total = await page.evaluate(() => cardsData.cards.length);

  // setup：{ all: [...] } 全部卡塞同一份名單；{ first: n, items: [...] } 只塞前 n 張
  async function search(query, setup) {
    await page.evaluate(s => {
      cardsData.cards.forEach((c, i) => {
        delete c.basicExclusions;
        if (s && s.all) c.basicExclusions = s.all.slice();
        if (s && s.first && i < s.first) c.basicExclusions = s.items.slice();
      });
      for (const id of ['results-container', 'coupon-results-container', 'parking-benefits-container']) {
        const el = document.getElementById(id); if (el) el.innerHTML = '';
      }
      const m = document.getElementById('matched-item'); m.innerHTML = ''; m.style.display = 'none';
    }, setup || null);
    await page.fill('#amount-input', '1000');
    await page.fill('#merchant-input', query);
    await page.click('#calculate-btn');
    await page.waitForFunction(() => document.getElementById('matched-item').innerText.trim().length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    return page.evaluate(() => ({
      cards: [...document.querySelectorAll('#results-container .card-result')].map(el =>
        el.querySelector('.card-name')?.innerText.trim()),
      status: document.getElementById('matched-item').innerText.replace(/\s+/g, ' ').trim(),
      noResultsBox: !!document.querySelector('#results-container .no-results'),
      firstNames: cardsData.cards.slice(0, 5).map(c => c.name),
    }));
  }

  const failures = [];
  const check = (name, cond, detail) => {
    console.log(`${cond ? '✅' : '❌'} ${name}`);
    if (!cond) failures.push(`${name}：${detail}`);
  };

  // 0. 沒填名單＝行為不變（基本回饋全列）
  let r = await search('zzz繳稅');
  check('無名單：全部卡顯示基本回饋、沒有排除字樣', r.cards.length === total && !/排除項目/.test(r.status),
    `cards=${r.cards.length}/${total} status=${r.status}`);

  // 1. 全部排除 → 不顯示任何卡、講清楚沒有回饋、也不出「無符合的信用卡」框
  r = await search('繳稅', { all: ['繳稅', '學費'] });
  check('全部排除：沒有結果卡片', r.cards.length === 0, `cards=${r.cards.length}`);
  check('全部排除：狀態列說明是一般消費排除項目、沒有任何回饋',
    r.status.includes(`你比較的 ${total} 張卡都沒有「繳稅」的活動`) && r.status.includes('一般消費排除項目') &&
    r.status.includes('包含基本回饋'), r.status);
  check('全部排除：不出現「無符合的信用卡」框', !r.noResultsBox, 'no-results 框出現了');

  // 2. 部分排除 → 其餘照常顯示基本回饋，狀態列補一行
  r = await search('繳稅', { first: 5, items: ['繳稅'] });
  check('部分排除：剩下的卡照常顯示', r.cards.length === total - 5, `cards=${r.cards.length}，預期 ${total - 5}`);
  check('部分排除：被排除的卡不在結果裡', r.firstNames.every(n => !r.cards.includes(n)), `cards=${r.cards.join('、')}`);
  check('部分排除：狀態列補「另有 5 張卡…刷卡無回饋」',
    r.status.includes('另有 5 張卡把「繳稅」列為一般消費排除項目，刷卡無回饋'), r.status);

  // 3. 搜尋詞「包含」排除詞也算（用造的詞：真實詞如「人壽保費」會先匹配到保費活動，走活動路徑）
  r = await search('zzz國泰qq代繳費', { all: ['qq代繳'] });
  check('包含規則：搜尋詞含排除詞 → 排除', r.cards.length === 0 && r.status.includes('一般消費排除項目'),
    `cards=${r.cards.length} status=${r.status}`);

  // 4. 反方向不算：排除詞含搜尋詞 → 不排除
  r = await search('zzz代', { all: ['zzz代收'] });
  check('反方向不算：排除詞「zzz代收」不影響搜尋「zzz代」', r.cards.length === total && !/排除項目/.test(r.status),
    `cards=${r.cards.length} status=${r.status}`);

  // 5. 單字排除詞一律忽略（「稅」會誤殺「免稅店」）
  r = await search('zzz免稅', { all: ['稅'] });
  check('單字排除詞忽略', r.cards.length === total, `cards=${r.cards.length}`);

  // 6. 有指定活動的卡：活動優先，名單不影響
  const baseline = await search('家樂福');
  r = await search('家樂福', { all: ['家樂福'] });
  check('活動優先：有活動的卡照常顯示、不出排除字樣',
    baseline.cards.length > 0 && JSON.stringify(r.cards) === JSON.stringify(baseline.cards) && !/排除項目/.test(r.status),
    `baseline=${baseline.cards.length} now=${r.cards.length} status=${r.status}`);

  check('沒有 console error', errors.length === 0, errors.join(' | '));

  await browser.close();
  srv.close();
  if (failures.length) {
    console.error(`\n❌ ${failures.length} 項失敗：\n- ` + failures.join('\n- '));
    process.exit(1);
  }
  console.log('\n✅ 一般消費排除項目：全部通過');
})().catch(e => { console.error(e); process.exit(1); });
