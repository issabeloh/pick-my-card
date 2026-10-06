#!/usr/bin/env node
/**
 * 卡片詳情頁回歸測試（2026-10-06 新增）：每張卡打開詳情頁，抓「一般回饋／指定通路回饋／
 * 即將開始／領券」四區的每一張回饋卡（.cashback-detail-item），與 card-detail-baseline.json 逐字比對。
 *
 * 為什麼獨立一支：run-regression.js 只看搜尋結果，詳情頁有自己的七條 render 路徑
 * （一般回饋、分級卡、非分級卡、即將開始、領券、CUBE…，統一走 renderRateCard()），
 * 改壞其中一條（例如某條路徑漏了條件）搜尋回歸完全測不到。
 *
 * 用法（repo 根目錄，先 npm install playwright）：
 *   node tools/regression/card-detail-test.js                   # 比對模式：差異 → exit 1
 *   node tools/regression/card-detail-test.js --update-baseline # 重拍基準（只在「改動前」版本跑！）
 *
 * 設計要點：
 * - 沿用 run-regression.js 的凍結資料（fixture.data）、Firebase 替身（訪客）、凍結時鐘
 * - **跑兩個日期**：fixture 的 frozenDate，加上 EXTRA_DATES。凍結日期那天沒有 30 天內即將開始、
 *   也沒有 10 天內即將結束的活動，「即將開始」區與兩種徽章會完全測不到——所以另跑一個
 *   兩者都有的日期（同一份凍結資料，只換時鐘）
 * - 抓的是畫面上的文字（innerText，逐行）＋ class，不是 HTML：標記怎麼重構都可以，
 *   只要用戶看到的內容與順序不變就是綠燈
 * - 重拍 fixture（run-regression.js --update-fixture）之後，這支的基準也要跟著重拍
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { REPO, startServer, firebaseStub, freezeClockScript, readFixtureMeta } = require('./run-regression.js');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));

// 2026-08-25：凍結資料裡有 9/1 開始（30 天內即將開始）與 8/31 結束（即將結束）的活動
const EXTRA_DATES = ['2026-08-25T12:00:00+08:00'];
const SECTIONS = ['card-basic-cashback', 'card-special-cashback', 'card-upcoming-cashback', 'card-coupon-cashback'];
const BASELINE_FILE = path.join(__dirname, 'card-detail-baseline.json');

async function captureAtDate(browser, base, frozenDate) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(freezeClockScript(frozenDate));
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)); });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('gstatic.com/firebasejs')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: firebaseStub(url) });
    }
    return route.abort();
  });
  await page.goto(`${base}/index.html?start&debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof cardsData !== 'undefined' && cardsData && cardsData.cards && cardsData.cards.length > 0,
    null, { timeout: 20000 });

  const ids = await page.evaluate(() => cardsData.cards.map(c => c.id));
  const cards = {};
  for (const id of ids) {
    const errBefore = errors.length;
    await page.evaluate(id => showCardDetail(id), id);
    cards[id] = await page.evaluate(sections => {
      const out = {};
      for (const sec of sections) {
        const el = document.getElementById(sec);
        // 區塊整個藏起來（例如沒有即將開始的活動）時不算它的內容——上一張卡留下的 DOM 不代表這張卡
        const shown = el && el.closest('.card-info-section')?.style.display !== 'none';
        out[sec] = !shown ? [] : [...el.querySelectorAll('.cashback-detail-item')].map(item => ({
          classes: [...item.classList].sort().join(' '),
          lines: item.innerText.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean),
        }));
      }
      return out;
    }, SECTIONS);
    if (errors.length > errBefore) cards[id].consoleErrors = errors.slice(errBefore);
  }
  await page.close();
  return cards;
}

async function main() {
  const updateBaseline = process.argv.includes('--update-baseline');
  const fixtureMeta = readFixtureMeta();
  const dates = [fixtureMeta.frozenDate, ...EXTRA_DATES];
  const srv = await startServer(false);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const execPath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(execPath ? { executablePath: execPath } : {});

  const runs = {};
  for (const d of dates) {
    runs[d] = await captureAtDate(browser, base, d);
    const items = Object.values(runs[d]).reduce((n, c) => n + SECTIONS.reduce((m, s) => m + c[s].length, 0), 0);
    const upcoming = Object.values(runs[d]).reduce((n, c) => n + c['card-upcoming-cashback'].length, 0);
    process.stderr.write(`  🗓️ ${d}：${Object.keys(runs[d]).length} 張卡、${items} 張回饋卡（即將開始 ${upcoming}）\n`);
  }
  await browser.close();
  srv.close();

  const out = { meta: { fixtureVersion: fixtureMeta.cardsVersion, dates, generatedAt: new Date().toISOString() }, runs };
  if (updateBaseline) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 1) + '\n');
    console.log(`✅ 詳情頁基準已更新：${path.relative(REPO, BASELINE_FILE)}`);
    return 0;
  }
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error('❌ 找不到 card-detail-baseline.json。先在「改動前」的版本跑 --update-baseline 拍基準。');
    return 2;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  if (baseline.meta.fixtureVersion !== out.meta.fixtureVersion) {
    console.error(`⚠️ 基準的凍結資料版本 ${baseline.meta.fixtureVersion} ≠ 現在 ${out.meta.fixtureVersion}——重拍過 fixture 就要跟著重拍這份基準`);
  }

  let failed = 0;
  for (const d of dates) {
    const refRun = baseline.runs[d];
    if (!refRun) { console.error(`❌ 基準裡沒有日期 ${d}`); failed++; continue; }
    for (const id of new Set([...Object.keys(refRun), ...Object.keys(runs[d])])) {
      const ref = refRun[id], cur = runs[d][id];
      if (JSON.stringify(ref) === JSON.stringify(cur)) continue;
      failed++;
      console.error(`\n❌ ${d}｜${id}`);
      if (!ref || !cur) { console.error(`   ${ref ? '現在' : '基準'}沒有這張卡`); continue; }
      for (const sec of SECTIONS.concat('consoleErrors')) {
        const a = JSON.stringify(ref[sec] || []), b = JSON.stringify(cur[sec] || []);
        if (a === b) continue;
        console.error(`   [${sec}]\n     基準: ${a.slice(0, 600)}\n     現在: ${b.slice(0, 600)}`);
      }
    }
  }
  if (failed) {
    console.error(`\n❌ 詳情頁回歸失敗：${failed} 張卡與基準不同。是預期的改動 → 逐條確認後 --update-baseline 並一起 commit`);
    return 1;
  }
  console.log(`✅ 詳情頁回歸通過：${dates.length} 個日期 × ${Object.keys(runs[dates[0]]).length} 張卡與基準逐字一致（凍結資料 ${out.meta.fixtureVersion}）`);
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(e => { console.error('❌ 測試框架本身出錯（非回歸差異）：', e.message); process.exit(2); });
