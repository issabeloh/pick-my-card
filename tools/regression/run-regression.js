#!/usr/bin/env node
/**
 * 自動化回歸測試：把 docs/ops/regression.md 的 12 組檢查跑成機器比對。
 *
 * 用法（repo 根目錄，需先 npm install playwright；瀏覽器用預裝的 /opt/pw-browsers/chromium，
 * 沒有預裝時退回 playwright 自帶的 chromium——本機要先 npx playwright install chromium）：
 *   node tools/regression/run-regression.js                  # 跑並與 baseline.json 比對（差異→exit 1）
 *   node tools/regression/run-regression.js --update-baseline # 重拍基準（改動「前」的版本跑！）
 *
 * 設計要點：
 * - 自帶靜態伺服器（隨機 port），不依賴 python
 * - 攔截 gstatic 的 Firebase SDK 回傳替身模組：onAuthStateChanged 立刻回 null → 確定性進訪客模式
 * - 其餘外部請求全部 abort（廣告/字型/analytics 不影響測試也不外洩流量）
 * - localStorage 全空的訪客 + ?start（跳過 landing 轉址）+ ?debug=1（console.error 可見）
 * - 基準與 cards.version 綁定；活動有期限，日期前進造成的差異屬預期，重拍基準即可
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));

const AMOUNT = '30000'; // 全清單統一金額（docs/ops/regression.md）
const CHECKS = [
  { id: 1,  type: 'search', query: '日本',          guards: 'waterfall 海外三層 + levelSettings（DBS Eco 應出現）' },
  { id: 2,  type: 'search', query: '禾乃川',        guards: 'DBS Eco specialItems + hideInDisplay 不干擾搜尋' },
  { id: 3,  type: 'search', query: 'Apple Pay',     guards: 'stacking 加總顯示（Sport 卡應為 5%）' },
  { id: 4,  type: 'search', query: '悠遊卡自動加值', guards: 'rate 排除型模型：溢出算 0（大戶卡）' },
  { id: 5,  type: 'search', query: 'meta廣告',      guards: 'rate=0 stacking 槽有匯出 + overseasCashback 特例' },
  { id: 6,  type: 'quick',  displayName: '所有停車', guards: 'displayParkingBenefits 收到 searchKeywords 陣列' },
  { id: 7,  type: 'search', query: '家樂福',        guards: '一般回饋 + 停車折抵同時出現' },
  { id: 8,  type: 'search', query: 'linepay',       guards: 'Type B 分級卡 {rate}/{cap} placeholder（玉山 Uni Card）' },
  { id: 9,  type: 'search', query: '全聯福利中心',  guards: 'CUBE 卡路徑' },
  { id: 10, type: 'search', query: 'Hotels.com',    guards: 'coupon 搜尋 + 領券溢出用 basicCashback（CUBE 領券，檔期至 2026/12/31，到期要換活的）' },
  { id: 11, type: 'quick',  displayName: '所有加油站', guards: 'handleQuickSearch 多關鍵詞路徑' },
  { id: 12, type: 'search', query: 'zzz測試',       guards: '無匹配 fallback 不噴錯' },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.data': 'text/plain', '.version': 'text/plain',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(REPO, urlPath === '/' ? 'index.html' : urlPath);
      if (!file.startsWith(REPO) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Firebase SDK 替身（依 index.html 實際 import 的符號提供；訪客模式只會用到 onAuthStateChanged）
function firebaseStub(url) {
  const resolveP = 'Promise.resolve()';
  if (url.includes('firebase-app')) return 'export function initializeApp(){return {};}';
  if (url.includes('firebase-analytics')) return 'export function getAnalytics(){return {};} export function logEvent(){}';
  if (url.includes('firebase-auth')) return `
    export function getAuth(){return {};}
    export function onAuthStateChanged(auth, cb){ setTimeout(() => cb(null), 0); }
    export class GoogleAuthProvider { setCustomParameters(){} }
    export function signInWithPopup(){return ${resolveP};}
    export function signOut(){return ${resolveP};}
    export function createUserWithEmailAndPassword(){return ${resolveP};}
    export function signInWithEmailAndPassword(){return ${resolveP};}
    export function sendPasswordResetEmail(){return ${resolveP};}`;
  if (url.includes('firebase-firestore')) return `
    export function getFirestore(){return {};}
    export function doc(){return {};}
    export function getDoc(){return Promise.resolve({ exists: () => false, data: () => undefined });}
    export function setDoc(){return ${resolveP};}
    export function addDoc(){return ${resolveP};}
    export function collection(){return {};}
    export function serverTimestamp(){return 0;}
    export function deleteField(){return 0;}`;
  if (url.includes('firebase-storage')) return `
    export function getStorage(){return {};}
    export function ref(){return {};}
    export function uploadBytes(){return ${resolveP};}
    export function getDownloadURL(){return Promise.resolve('');}`;
  return 'export default {};';
}

const norm = s => (s || '').replace(/\s+/g, ' ').trim();

async function extract(page) {
  const results = await page.$$eval('#results-container .card-result', els => els.map(el => {
    const fields = {};
    el.querySelectorAll('.detail-item').forEach(d => {
      const label = d.querySelector('.detail-label')?.innerText?.replace(/\s+/g, ' ').trim();
      const value = d.querySelector('.detail-value')?.innerText?.replace(/\s+/g, ' ').trim();
      if (label) fields[label] = value;
    });
    return {
      card: el.querySelector('.card-name')?.innerText?.replace(/\s+/g, ' ').trim(),
      best: el.classList.contains('best-card'),
      fields,
      matched: el.querySelector('.matched-merchant')?.innerText?.replace(/\s+/g, ' ').trim() || null,
      // 滿額/未滿門檻列（2026-07-17 起獨立於 .matched-merchant 之外），
      // 單獨抓取以維持 minSpend/maxSpend 標註的回歸覆蓋
      threshold: Array.from(el.querySelectorAll('.spend-threshold-note'))
        .map(n => n.innerText.replace(/\s+/g, ' ').trim()).join(' / ') || null,
    };
  }));
  const parking = await page.$$eval('#parking-benefits-container .parking-benefit-item', els => els.map(el => ({
    card: el.querySelector('.parking-card-name')?.innerText?.replace(/\s+/g, ' ').trim(),
    text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 250),
  }))).catch(() => []);
  const coupons = await page.$$eval('#coupon-results-container .coupon-item', els => els.map(el => {
    const fields = {};
    el.querySelectorAll('.detail-item').forEach(d => {
      const label = d.querySelector('.detail-label')?.innerText?.replace(/\s+/g, ' ').trim();
      const value = d.querySelector('.detail-value')?.innerText?.replace(/\s+/g, ' ').trim();
      if (label) fields[label] = value;
    });
    return {
      card: el.querySelector('.coupon-merchant')?.innerText?.replace(/\s+/g, ' ').trim(),
      fields,
      matched: el.querySelector('.matched-merchant')?.innerText?.replace(/\s+/g, ' ').trim() || null,
    };
  })).catch(() => []);
  return { results, parking, coupons };
}

async function run(updateBaseline) {
  const srv = await startServer();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const execPath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(execPath ? { executablePath: execPath } : {});
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + norm(e.message).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console.error: ' + norm(m.text()).slice(0, 200)); });

  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('gstatic.com/firebasejs')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: firebaseStub(url) });
    }
    return route.abort(); // 其餘外部資源（廣告/字型/analytics）一律擋掉，保持 hermetic
  });

  await page.goto(`${base}/index.html?start&debug=1`, { waitUntil: 'domcontentloaded' });
  // 就緒 = 卡片數字出現（cards.data 解析完成）+ 訪客流程把輸入區打開
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.card-count')?.textContent?.trim() || ''), null, { timeout: 20000 });
  await page.waitForSelector('#merchant-input', { state: 'visible', timeout: 20000 });

  const checks = [];
  for (const c of CHECKS) {
    const errBefore = consoleErrors.length;
    // 清掉上一輪結果，避免把舊結果誤讀成新結果
    await page.evaluate(() => {
      for (const id of ['results-container', 'coupon-results-container', 'parking-benefits-container']) {
        const el = document.getElementById(id); if (el) el.innerHTML = '';
      }
    });
    await page.fill('#amount-input', AMOUNT);
    if (c.type === 'search') {
      await page.fill('#merchant-input', c.query);
      await page.click('#calculate-btn');
    } else { // quick：按鈕可能收在下拉面板（隱藏），用 DOM click 直接觸發 handler
      await page.fill('#merchant-input', '');
      const clicked = await page.evaluate(name => {
        const btn = [...document.querySelectorAll('.quick-search-btn')]
          .find(b => b.textContent.replace(/\s+/g, ' ').trim().includes(name));
        if (btn) { btn.click(); return true; }
        return false;
      }, c.displayName);
      if (!clicked) throw new Error(`快捷搜尋按鈕找不到：${c.displayName}`);
      // 快捷搜尋只填入、不自動計算（2026-07-12 產品決策）——比照真實用戶：
      // 點完快捷按鈕後自己按計算
      await page.waitForTimeout(100);
      await page.click('#calculate-btn');
    }
    await page.waitForFunction(() =>
      document.querySelector('#results-container .card-result') ||
      document.querySelector('#coupon-results-container .coupon-item') ||
      document.querySelector('#parking-benefits-container .parking-benefit-item'),
      null, { timeout: 10000 });
    await page.waitForTimeout(400); // 渲染沉澱
    const data = await extract(page);
    checks.push({
      id: c.id, type: c.type, query: c.query || c.displayName, guards: c.guards, amount: AMOUNT,
      ...data, consoleErrors: consoleErrors.slice(errBefore),
    });
    process.stderr.write(`  #${c.id} ${c.query || c.displayName}: ${data.results.length} 卡 / ${data.parking.length} 停車 / ${data.coupons.length} 券${consoleErrors.length > errBefore ? ' ⚠️ console error' : ''}\n`);
  }
  await browser.close();
  srv.close();

  const meta = {
    generatedAt: new Date().toISOString(),
    cardsVersion: fs.readFileSync(path.join(REPO, 'cards.version'), 'utf8').trim(),
    note: '基準綁定 cards.version；活動期限日期敏感——cards.data 更新或活動到期造成的差異屬預期，確認後重拍基準',
  };
  const out = { meta, checks };
  const baselineFile = path.join(__dirname, 'baseline.json');
  const lastRunFile = path.join(__dirname, 'last-run.json');
  fs.writeFileSync(lastRunFile, JSON.stringify(out, null, 2));

  if (updateBaseline) {
    fs.writeFileSync(baselineFile, JSON.stringify(out, null, 2));
    console.log(`✅ 基準已更新：${path.relative(REPO, baselineFile)}（cards.version=${meta.cardsVersion}，12 組全跑完）`);
    return 0;
  }
  if (!fs.existsSync(baselineFile)) {
    console.error('❌ 找不到 baseline.json。先在「改動前」的版本跑 --update-baseline 拍基準。');
    return 2;
  }
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  if (baseline.meta.cardsVersion !== meta.cardsVersion) {
    console.error(`⚠️ cards.version 不一致（基準 ${baseline.meta.cardsVersion} vs 現在 ${meta.cardsVersion}）——基準已過期，比對結果僅供參考`);
  }
  let failed = 0;
  for (const cur of out.checks) {
    const ref = baseline.checks.find(b => b.id === cur.id);
    const strip = ch => ({ results: ch.results, parking: ch.parking, coupons: ch.coupons, consoleErrors: ch.consoleErrors });
    if (!ref) { console.error(`❌ #${cur.id} ${cur.query}：基準裡沒有這條`); failed++; continue; }
    if (JSON.stringify(strip(ref)) !== JSON.stringify(strip(cur))) {
      failed++;
      console.error(`\n❌ #${cur.id}「${cur.query}」結果與基準不同（守的機制：${cur.guards}）`);
      for (const key of ['results', 'parking', 'coupons', 'consoleErrors']) {
        const a = JSON.stringify(ref[key]); const b = JSON.stringify(cur[key]);
        if (a !== b) {
          console.error(`  [${key}] 基準 ${ref[key].length} 筆 → 現在 ${cur[key].length} 筆`);
          const max = Math.max(ref[key].length, cur[key].length);
          for (let i = 0; i < max; i++) {
            const ra = JSON.stringify(ref[key][i]); const rb = JSON.stringify(cur[key][i]);
            if (ra !== rb) {
              console.error(`    [${i}] 基準: ${(ra || '(無)').slice(0, 220)}`);
              console.error(`    [${i}] 現在: ${(rb || '(無)').slice(0, 220)}`);
            }
          }
        }
      }
    }
  }
  if (failed) {
    console.error(`\n❌ 回歸未通過：${failed}/12 組有差異。完整結果見 tools/regression/last-run.json`);
    return 1;
  }
  console.log(`✅ 回歸通過：12 組結果與基準逐字一致（cards.version=${meta.cardsVersion}）`);
  return 0;
}

run(process.argv.includes('--update-baseline'))
  .then(code => process.exit(code))
  .catch(e => { console.error('❌ 測試框架本身出錯（非回歸差異）：', e.message); process.exit(2); });
