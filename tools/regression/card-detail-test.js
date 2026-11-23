#!/usr/bin/env node
/**
 * 卡片詳情頁回歸測試（2026-10-06 新增）：每張卡打開詳情頁，抓「一般回饋／指定通路回饋／
 * 即將開始／領券」四區的每一張回饋卡（.cashback-detail-item），與 card-detail-baseline.json 逐字比對。
 *
 * 為什麼獨立一支：run-regression.js 只看搜尋結果，詳情頁有自己的七條 render 路徑
 * （一般回饋、分級卡、非分級卡、即將開始、領券、CUBE…，統一走 renderRateCard()），
 * 改壞其中一條（例如某條路徑漏了條件）搜尋回歸完全測不到。
 *
 * 用法（repo 根目錄；playwright 用環境預裝的即可，本機沒有才 npm install playwright）：
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
// 先用 repo 內裝的 playwright；沒有就用環境預裝的（雲端容器已預裝，不必每個 session 再 npm install）
let chromium;
try { ({ chromium } = require(path.join(REPO, 'node_modules', 'playwright'))); }
catch (e) { ({ chromium } = require('playwright')); }

// 2026-08-25：凍結資料裡有 9/1 開始（30 天內即將開始）與 8/31 結束（即將結束）的活動
const EXTRA_DATES = ['2026-08-25T12:00:00+08:00'];
const SECTIONS = ['card-basic-cashback', 'card-basic-exclusions', 'card-special-cashback', 'card-upcoming-cashback', 'card-coupon-cashback'];
const BASELINE_FILE = path.join(__dirname, 'card-detail-baseline.json');

async function captureAtDate(browser, base, frozenDate) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(freezeClockScript(frozenDate));
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
  // 「Failed to load resource: net::ERR_FAILED」是下面 route.abort() 擋掉外部請求造成的，落在哪張卡純看時序，
  // 不是程式行為——不濾掉的話基準會記到雜訊、每次跑紅的卡都不一樣（2026-11-17 修；配卡組合頁測試同樣濾掉）
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 200)); });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('gstatic.com/firebasejs')) {
      // 替身直接用 run-regression.js 的（2026-11-17 起已含 setUserProperties）。不要在這裡再補 export：
      // 重複的 export 會讓整支模組語法錯誤，4 秒後吐「Firebase 載入逾時」console.error，詳情頁回歸隨機變紅
      return route.fulfill({ status: 200, contentType: 'text/javascript',
        body: firebaseStub(url) });
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
      // 2026-11-17 詳情頁改頁籤：一次只顯示一個頁籤，沒被選中的窗格是 display:none，innerText 對
      // 「不在版面上」的元素會退回 textContent（沒有換行），逐行比對就會對不上基準。取樣前把所有窗格
      // 攤開（只改取樣方式，回饋卡文字本身沒變；下一張卡 showCardDetail 會重設頁籤）
      document.querySelectorAll('#card-detail-modal .cd-pan').forEach(p => { p.hidden = false; });
      const out = {};
      for (const sec of sections) {
        const el = document.getElementById(sec);
        // 區塊整個藏起來（例如沒有即將開始的活動）時不算它的內容——上一張卡留下的 DOM 不代表這張卡
        const shown = el && el.closest('.card-info-section')?.style.display !== 'none';
        const norm = t => (t || '').replace(/\s+/g, ' ').trim();
        // 2026-11-17「同方案一張卡」：.cd-rc 的畫面文字有一部分取決於字型寬度（適用通路收成幾個、「顯示全部」鈕、
        // 條件是否被截斷出現「展開」），逐行 innerText 比對會因環境不同而差一行——改成抓「語意欄位」：
        // 標題／小標與徽章／上限／期間／註記／每一列（回饋率、分級、子標、門檻、通路完整清單與總數、條件、登錄連結）。
        // 通路完整清單取 cdFitChannel 記下的 _cdFull（還沒量過就是 strong 的全文）
        const planCard = item => ({
          classes: [...item.classList].sort().join(' '),
          title: norm(item.querySelector('.cd-rc-name')?.textContent),
          tags: [...item.querySelectorAll('.cd-rc-t .cd-tag, .cd-rc-t .upcoming-badge, .cd-rc-t .ending-soon-badge')].map(e => norm(e.textContent)),
          meta: [...item.querySelectorAll('.cd-meta > div')].map(d => norm(d.querySelector('.cd-lb')?.textContent) + ': ' + norm(d.querySelector('.cd-val')?.textContent)),
          note: norm(item.querySelector('.cd-rc-note')?.textContent),
          rows: [...item.querySelectorAll('.cd-rr')].map(row => {
            const ch = row.querySelector('.cd-ch');
            const strong = ch && ch.querySelector('strong.merchant-list');
            return {
              rate: norm(row.querySelector('.cd-rate')?.textContent),
              calc: !!row.querySelector('.calc-breakdown-btn'),
              level: norm(row.querySelector('.cd-lvl')?.textContent),
              sub: norm(row.querySelector('.cd-sub')?.textContent),
              threshold: norm(row.querySelector('.spend-threshold-note')?.textContent),
              merchants: ch ? norm(ch.querySelector('.cd-ch-lb')?.textContent) + ' ' + norm(ch._cdFull !== undefined ? ch._cdFull : strong.textContent) : '',
              merchantCount: ch ? Number(ch.dataset.n) : 0,
              conditions: [...row.querySelectorAll('.cd-cond')].map(c => norm(c.textContent)),
              registerLink: [...row.querySelectorAll('.cashback-register-link a')].map(a => a.getAttribute('href')),
            };
          }),
        });
        out[sec] = !shown ? [] : [...el.querySelectorAll('.cashback-detail-item')].map(item => item.classList.contains('cd-rc') ? planCard(item) : ({
          classes: [...item.classList].sort().join(' '),
          // 非同方案卡（一般消費排除卡、停車、無指定通路的說明）：逐行畫面文字。
          // 「...展開」鈕不列入：它出不出現取決於條件文字排版後是否超過兩行，而那由「機器上
          // 有哪套中文字型」決定（測試擋掉外部 Google Fonts，退回系統字型）——同一份程式在
          // 不同容器會差一行（2026-10-07 firstbank-ileo 只在換了環境後多出這行）。條件全文
          // 仍在 innerText 裡（line-clamp 不會刪字），內容差異照樣抓得到。
          lines: item.innerText.split('\n').map(s => s.replace(/\s+/g, ' ').trim())
            .filter(s => s && s !== '...展開' && s !== '收起'),
        }));
      }
      return out;
    }, SECTIONS);
    if (errors.length > errBefore) cards[id].consoleErrors = errors.slice(errBefore);
  }
  await page.close();
  return cards;
}

// 版面不變式（2026-11-17 同方案一張卡）：390px 手機寬度下逐張卡檢查——
//   1. 每個「適用通路」元素最多三行（scrollHeight ≤ 3×18px），而且不是空白（先畫完整內容、量得到寬度才收）
//   2. 同一區裡沒有兩張卡的「標題＋上限＋期間」完全相同（相同的必須併成一張；不同的不能被併）
//   3. 指定通路／即將開始區：卡片依卡內最高回饋率由高到低、卡內各列由高到低
//   4. 回饋率 24px／800／rgb(17,24,39)；有組成的是帶虛線的按鈕、沒有組成的是純文字（2026-11-22）
// 與 baseline 無關（不比對文字），所以不受「字型寬度決定收成幾個通路」影響
async function checkLayoutInvariants(browser, base, frozenDate) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(freezeClockScript(frozenDate));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('gstatic.com/firebasejs')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript',
        body: firebaseStub(url) });
    }
    return route.abort();
  });
  await page.goto(`${base}/index.html?start&debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof cardsData !== 'undefined' && cardsData && cardsData.cards && cardsData.cards.length > 0,
    null, { timeout: 20000 });
  const ids = await page.evaluate(() => cardsData.cards.map(c => c.id));
  const problems = [];
  // 造資料驗併卡規則：標題相同＋上限相同＋期間相同才併；上限或期間任一不同各自一張，且各列的上限／期間不能被別人的取代
  const synth = await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = planCardsHtml([
      { rate: 3, capText: 'NT$1,000', title: 'X', period: 'P1', merchants: { items: ['a'] } },
      { rate: 5, capText: 'NT$1,000', title: 'X', period: 'P1', merchants: { items: ['b'] } },
      { rate: 4, capText: 'NT$2,000', title: 'X', period: 'P1', merchants: { items: ['c'] } },
      { rate: 4, capText: 'NT$1,000', title: 'X', period: 'P2', merchants: { items: ['d'] } },
      { rate: 9, capText: 'NT$1,000', title: 'Y', period: 'P1', merchants: { items: ['e'] } }
    ]);
    return [...d.querySelectorAll('.cd-rc')].map(c => [c.querySelector('.cd-rc-name').textContent,
      [...c.querySelectorAll('.cd-meta .cd-val')].map(v => v.textContent).join('/'),
      [...c.querySelectorAll('.cd-rate')].map(v => v.textContent).join(',')].join('|'));
  });
  const wantSynth = ['Y|NT$1,000/P1|9%', 'X|NT$1,000/P1|5%,3%', 'X|NT$2,000/P1|4%', 'X|NT$1,000/P2|4%'];
  if (JSON.stringify(synth) !== JSON.stringify(wantSynth)) problems.push(`造資料併卡規則不符：${JSON.stringify(synth)}（應為 ${JSON.stringify(wantSynth)}）`);
  for (const id of ids) {
    await page.evaluate(id => showCardDetail(id), id);
    const found = await page.evaluate(() => {
      document.querySelectorAll('#card-detail-modal .cd-pan').forEach(p => { p.hidden = false; });
      cdFitAllContainers();
      const out = [];
      const num = t => parseFloat((t || '').replace(/[^0-9.\-]/g, ''));
      for (const cid of ['card-special-cashback', 'card-upcoming-cashback', 'card-basic-cashback', 'card-basic-exclusions', 'card-coupon-cashback']) {
        const box = document.getElementById(cid);
        if (!box || box.closest('.card-info-section')?.style.display === 'none') continue;
        const seen = new Set();
        let prevMax = Infinity;
        box.querySelectorAll('.cd-rc').forEach(card => {
          const name = card.querySelector('.cd-rc-name')?.textContent || '';
          const meta = [...card.querySelectorAll('.cd-meta .cd-val')].map(v => v.textContent).join('|');
          const badges = [...card.querySelectorAll('.upcoming-badge,.ending-soon-badge')].map(v => v.textContent).join('|');
          const key = name + '#' + meta + '#' + badges;
          if (cid !== 'card-coupon-cashback' && seen.has(key)) out.push(`${cid}：「${name}」標題＋上限＋期間相同卻沒併成一張`);
          seen.add(key);
          const rates = [...card.querySelectorAll('.cd-rr .cd-rate')].map(e => num(e.textContent));
          for (let i = 1; i < rates.length; i++) if (rates[i] > rates[i - 1]) out.push(`${cid}：「${name}」卡內列沒有由高到低 ${rates.join(',')}`);
          if (cid === 'card-special-cashback' || cid === 'card-upcoming-cashback') {
            if (rates[0] > prevMax) out.push(`${cid}：「${name}」(${rates[0]}%) 排在較低的卡後面`);
            prevMax = rates[0];
          }
        });
        box.querySelectorAll('.cd-ch').forEach(ch => {
          const strong = ch.querySelector('strong.merchant-list');
          if (!strong || !strong.textContent.trim()) out.push(`${cid}：有一筆適用通路是空的`);
          else if (ch.scrollHeight > 18 * 3 + 1) out.push(`${cid}：適用通路超過三行（${ch.scrollHeight}px）「${strong.textContent.slice(0, 20)}…」`);
        });
        box.querySelectorAll('.cd-rate').forEach(r => {
          const cs = getComputedStyle(r);
          if (cs.fontSize !== '24px' || cs.color !== 'rgb(17, 24, 39)' || cs.fontWeight !== '800') out.push(`${cid}：回饋率樣式不對 ${cs.fontSize} ${cs.fontWeight} ${cs.color}`);
          // 2026-11-22：有組成可看的回饋率本身是按鈕（灰色虛線底線、aria-expanded／aria-label、沒有計算機圖示）；
          // 沒有組成的是純文字（沒有虛線、不可點）
          if (r.tagName === 'BUTTON') {
            if (!r.classList.contains('calc-breakdown-btn') || !r.dataset.comp) out.push(`${cid}：回饋率按鈕沒有 data-comp`);
            if (r.getAttribute('aria-expanded') !== 'false' || !/^.+%，查看回饋組成$/.test(r.getAttribute('aria-label') || '')) out.push(`${cid}：回饋率按鈕缺 aria-expanded／aria-label`);
            if (r.querySelector('svg')) out.push(`${cid}：回饋率按鈕裡還有圖示`);
            if (cs.textDecorationLine !== 'underline' || cs.textDecorationStyle !== 'dashed') out.push(`${cid}：回饋率按鈕沒有虛線底線 ${cs.textDecorationLine} ${cs.textDecorationStyle}`);
          } else if (cs.textDecorationLine !== 'none') out.push(`${cid}：沒有組成的回饋率不該有底線`);
        });
        if (box.querySelector('svg.calc-icon, .cd-rr-n > .calc-breakdown-btn:not(.cd-rate)')) out.push(`${cid}：還有舊的計算機圖示鈕`);
      }
      return out;
    });
    found.forEach(f => problems.push(`${id}｜${f}`));
  }
  await page.close();
  return problems;
}

function stripLoadNoise(card) {
  if (!card || !card.consoleErrors) return card;
  const rest = card.consoleErrors.filter(e => !/Failed to load resource/.test(e));
  const out = { ...card };
  if (rest.length) out.consoleErrors = rest; else delete out.consoleErrors;
  return out;
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
  const layoutProblems = await checkLayoutInvariants(browser, base, fixtureMeta.frozenDate);
  await browser.close();
  srv.close();

  const out = { meta: { fixtureVersion: fixtureMeta.cardsVersion, dates, generatedAt: new Date().toISOString() }, runs };
  if (updateBaseline) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 1) + '\n');
    console.log(`✅ 詳情頁基準已更新：${path.relative(REPO, BASELINE_FILE)}`);
    if (layoutProblems.length) { console.error(`⚠️ 版面不變式有 ${layoutProblems.length} 項不符（--update-baseline 不擋，但比對模式會紅）`); layoutProblems.slice(0, 10).forEach(p => console.error('   ' + p)); }
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
  if (layoutProblems.length) {
    console.error(`\n❌ 版面不變式（390px 手機）有 ${layoutProblems.length} 項不符：`);
    layoutProblems.slice(0, 30).forEach(p => console.error('   ' + p));
    failed += layoutProblems.length;
  }
  for (const d of dates) {
    const refRun = baseline.runs[d];
    if (!refRun) { console.error(`❌ 基準裡沒有日期 ${d}`); failed++; continue; }
    for (const id of new Set([...Object.keys(refRun), ...Object.keys(runs[d])])) {
      // 資源載入類的 console error（外部字型／廣告被測試擋掉的 ERR_FAILED）出現在哪一張卡的取樣視窗內
      // 取決於時序，與程式無關（docs/ops/regression.md 2026-11-16 教訓）——比對時兩邊都濾掉，不動基準檔
      const ref = stripLoadNoise(refRun[id]), cur = stripLoadNoise(runs[d][id]);
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
    console.error(`\n❌ 詳情頁回歸失敗：${failed} 項不符（卡片與基準不同或版面不變式）。是預期的改動 → 逐條確認後 --update-baseline 並一起 commit`);
    return 1;
  }
  console.log(`✅ 詳情頁回歸通過：${dates.length} 個日期 × ${Object.keys(runs[dates[0]]).length} 張卡與基準逐字一致、390px 版面不變式全過（凍結資料 ${out.meta.fixtureVersion}）`);
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(e => { console.error('❌ 測試框架本身出錯（非回歸差異）：', e.message); process.exit(2); });
