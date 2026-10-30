#!/usr/bin/env node
/**
 * 搜尋行為前後比對（2026-10-17 新增，搜尋「找、算、顯示分三步」架構調整時建立）
 *
 * 改搜尋／計算邏輯時，用「同一份線上資料」分別跑「基準版程式（預設 origin/main）」與「目前工作目錄的程式」，
 * 列出每個搜尋詞的差異。用途是改動前後的影響評估——跟 run-regression.js（凍結資料、逐字比對基準）互補：
 * 這支覆蓋的詞多得多（常用詞＋統一詞表所有詞＋資料裡所有活動商家名，約 1,900 個），但不存基準、只比兩版程式。
 *
 * 用法（repo 根目錄，先 npm install playwright）：
 *   node tools/regression/search-compare.js                 # 函數層：所有搜尋詞＋多關鍵詞快捷搜尋
 *   node tools/regression/search-compare.js --ui            # 另外實際操作畫面跑 search-terms.txt 與快捷搜尋（較慢）
 *   node tools/regression/search-compare.js --base <git ref>  # 換基準版（預設 origin/main）
 * 結果：終端機摘要＋ tools/regression/search-compare-last.json（完整差異，不進版控）
 *
 * 比的東西：
 *   函數層：「✓ 匹配到」名單、進行中結果（卡｜回饋率｜金額｜類別｜期間）、即將開始、結果卡的「匹配項目」文字
 *   畫面層（--ui）：狀態列、結果標題、每張結果卡全文、領券、停車、新戶活動
 * 「進行中／即將開始有差異」才是結果變了；只有名單或匹配項目文字不同＝顯示變了
 * 函數層呼叫的是 findSearchHits／calculateHitResults；基準版沒有這兩支時退回舊流程（findMatchingItem＋逐名計算），
 * 所以可以拿來比架構調整前的版本
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const UI = args.includes('--ui');
const baseIdx = args.indexOf('--base');
const BASE_REF = baseIdx >= 0 ? args[baseIdx + 1] : 'origin/main';
const TERMS = fs.readFileSync(path.join(__dirname, 'search-terms.txt'), 'utf8')
  .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const EXEC = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

async function openPage(root) {
  const { startServer, firebaseStub } = require(path.join(root, 'tools', 'regression', 'run-regression.js'));
  const srv = await startServer(true);   // 線上 cards.data（工作目錄那份）
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (u.includes('gstatic.com/firebasejs')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: firebaseStub(u) });
    return route.abort();
  });
  await page.goto(`${base}/index.html?start`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.card-count')?.textContent?.trim() || ''), null, { timeout: 20000 });
  return { page, errors, close: async () => { await browser.close(); srv.close(); } };
}

// 函數層：每個詞的名單、結果、即將開始
async function functionLevel(root) {
  const { page, errors, close } = await openPage(root);
  const out = await page.evaluate(async terms => {
    console.log = () => {}; console.warn = () => {};
    const queries = new Set(terms.map(s => s.toLowerCase()));
    (cardsData.termAliases || []).forEach(t => { queries.add(String(t.term).toLowerCase()); (t.aliases || []).forEach(a => queries.add(String(a).toLowerCase())); });
    cardsData.cards.forEach(c => (c.cashbackRates || []).forEach(g => (g.items || []).forEach(i => queries.add(String(i).toLowerCase().trim()))));
    const cards = getCardsForComparison();
    const fmt = r => [r.card.id, r.rate, Math.round(r.cashbackAmount * 100) / 100, r.matchedCategory || '',
      (r.matchedRateGroup && r.matchedRateGroup.periodEnd) || '', (r.matchedItems || [r.matchedItemName || r.matchedItem]).join('、')].join('|');
    const flow = async hits => {
      if (typeof calculateHitResults === 'function') {
        const r = await calculateHitResults(hits, cards, 1000);
        return { res: r.results.map(fmt), up: r.upcoming.map(fmt) };
      }
      // 架構調整前的流程（基準版沒有 calculateHitResults 時）
      const all = [];
      for (const m of hits) {
        const t = m.originalItem.toLowerCase();
        const ir = (await Promise.all(cards.map(async card => (await calculateCardCashback(card, t, 1000))
          .map(r => ({ ...r, card, matchedItemName: r.matchedItem }))))).flat().filter(r => r.cashbackAmount > 0);
        if (ir.length) { ir.sort((a, b) => b.cashbackAmount - a.cashbackAmount); all.push(...ir); }
      }
      const ups = [];
      for (const m of hits) {
        const t = m.originalItem.toLowerCase();
        const ua = await Promise.all(cards.map(async card => (await findUpcomingActivity(card, t, 1000))
          .map(a => ({ card, ...a, isUpcoming: true, matchedItemName: a.matchedItem }))));
        ups.push(...ua.flat());
      }
      return { res: mergeResultsByActivity(all).map(fmt), up: mergeResultsByActivity(ups).map(fmt) };
    };
    const hitsOf = (q, opt) => {
      if (typeof findSearchHits === 'function') return findSearchHits(q, opt || {}) || [];
      if (opt && opt.quickOption) {
        const seen = new Set(); const hits = [];
        opt.quickOption.merchants.forEach(k => (findMatchingItem(k.trim()) || []).forEach(m => {
          const key = m.originalItem.toLowerCase(); if (!seen.has(key)) { seen.add(key); hits.push(m); } }));
        return hits;
      }
      return findMatchingItem(q) || [];
    };
    const result = { terms: {}, quick: {} };
    for (const q of queries) {
      const hits = hitsOf(q);
      result.terms[q] = { names: hits.map(m => m.originalItem), ...(hits.length ? await flow(hits) : { res: [], up: [] }) };
    }
    for (const o of (cardsData.quickSearchOptions || [])) {
      if (!Array.isArray(o.merchants) || o.merchants.length <= 1) continue;
      const hits = hitsOf(o.displayName, { quickOption: o });
      result.quick[o.id] = { names: hits.map(m => m.originalItem), ...(hits.length ? await flow(hits) : { res: [], up: [] }) };
    }
    return result;
  }, TERMS);
  out.errors = errors;
  await close();
  return out;
}

// 畫面層：實際操作輸入框＋計算，抓整個結果區
async function uiLevel(root) {
  const { page, errors, close } = await openPage(root);
  const snap = () => page.evaluate(() => {
    const t = el => el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
    return {
      status: t(document.getElementById('matched-item')),
      title: t(document.querySelector('#results-section h2')),
      cards: [...document.querySelectorAll('#results-container .card-result')].map(t),
      coupons: [...document.querySelectorAll('#coupon-results-container .coupon-item')].map(t),
      parking: t(document.getElementById('parking-benefits-container')),
      promos: t(document.querySelector('.cardholder-promos-container'))
    };
  });
  const calc = async () => {
    await page.evaluate(() => ['results-container', 'coupon-results-container', 'parking-benefits-container']
      .forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; }));
    await page.evaluate(() => calculateCashback());
    await page.waitForTimeout(150);
    return snap();
  };
  await page.fill('#amount-input', '1000');
  const out = { terms: {}, quick: {} };
  for (const q of TERMS) {
    await page.evaluate(q => {
      const i = document.getElementById('merchant-input'); i.value = q; handleMerchantInput();
      if (typeof closeMerchantSuggest === 'function') closeMerchantSuggest();
    }, q);
    out.terms[q] = await calc();
  }
  const ids = await page.evaluate(() => (cardsData.quickSearchOptions || [])
    .filter(o => Array.isArray(o.merchants) && o.merchants.length > 1).map(o => o.id));
  for (const id of ids) {
    await page.evaluate(id => handleQuickSearch(cardsData.quickSearchOptions.find(o => o.id === id)), id);
    out.quick[id] = await calc();
  }
  out.errors = errors;
  await close();
  return out;
}

function compareFunction(A, B) {
  const key = s => s.split('|').slice(0, 5).join('|');
  const items = s => s.split('|').slice(5).join('|');
  const sorted = list => [...list].sort((x, y) => Number(y.split('|')[2]) - Number(x.split('|')[2]));   // 畫面依金額排序（穩定）
  const report = { results: [], upcoming: [], order: [], itemText: [], names: [] };
  const one = (label, a, b) => {
    const ka = a.res.map(key), kb = b.res.map(key);
    const lost = ka.filter(k => !kb.includes(k)), gained = kb.filter(k => !ka.includes(k));
    if (lost.length || gained.length) report.results.push({ label, lost, gained });
    else if (JSON.stringify(sorted(a.res).map(key)) !== JSON.stringify(sorted(b.res).map(key))) report.order.push(label);
    const ua = a.up.map(key), ub = b.up.map(key);
    const ul = ua.filter(k => !ub.includes(k)), ug = ub.filter(k => !ua.includes(k));
    if (ul.length || ug.length) report.upcoming.push({ label, lost: ul, gained: ug });
    a.res.forEach(s => { const t = b.res.find(x => key(x) === key(s)); if (t && items(t) !== items(s)) report.itemText.push({ label, card: s.split('|')[0], before: items(s), after: items(t) }); });
    if (JSON.stringify(a.names) !== JSON.stringify(b.names)) report.names.push({ label, before: a.names, after: b.names });
  };
  const empty = { names: [], res: [], up: [] };
  new Set([...Object.keys(A.terms), ...Object.keys(B.terms)]).forEach(q => one(q, A.terms[q] || empty, B.terms[q] || empty));
  new Set([...Object.keys(A.quick), ...Object.keys(B.quick)]).forEach(id => one('快捷:' + id, A.quick[id] || empty, B.quick[id] || empty));
  return report;
}

function compareUi(A, B) {
  const fields = ['status', 'title', 'cards', 'coupons', 'parking', 'promos'];
  const diffs = [];
  let same = 0;
  const one = (label, a, b) => {
    const d = fields.filter(f => JSON.stringify(a && a[f]) !== JSON.stringify(b && b[f]));
    if (!d.length) { same++; return; }
    diffs.push({ label, fields: d, before: a, after: b });
  };
  Object.keys(A.terms).forEach(q => one(q, A.terms[q], B.terms[q]));
  Object.keys(A.quick).forEach(id => one('快捷:' + id, A.quick[id], B.quick[id]));
  return { same, diffs };
}

(async () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'pmc-search-base-'));
  execFileSync('git', ['-C', REPO, 'worktree', 'add', '-q', '--detach', wt, BASE_REF]);
  try {
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(wt, 'node_modules'));
    // 兩版用同一份資料：把工作目錄的 cards.data／cards.version 放進基準版
    for (const f of ['cards.data', 'cards.version']) fs.copyFileSync(path.join(REPO, f), path.join(wt, f));
    console.log(`基準版：${BASE_REF}　目前：工作目錄　資料：${fs.readFileSync(path.join(REPO, 'cards.version'), 'utf8').trim()}`);

    const [A, B] = await Promise.all([functionLevel(wt), functionLevel(REPO)]);
    const fr = compareFunction(A, B);
    const out = { base: BASE_REF, function: fr, errors: { base: A.errors, current: B.errors } };
    console.log(`\n【函數層】${Object.keys(B.terms).length} 個搜尋詞＋${Object.keys(B.quick).length} 個多關鍵詞快捷搜尋`);
    console.log(`  進行中結果變了：${fr.results.length}　即將開始變了：${fr.upcoming.length}　畫面排序變了：${fr.order.length}`);
    console.log(`  結果卡「匹配項目」文字變了：${fr.itemText.length}　「✓ 匹配到」名單變了：${fr.names.length}`);
    fr.results.forEach(d => console.log(`  ⚠️ ${d.label}：少了 ${d.lost.length}、多了 ${d.gained.length}`));
    fr.upcoming.forEach(d => console.log(`  ⚠️ ${d.label}（即將開始）：少了 ${d.lost.length}、多了 ${d.gained.length}`));

    if (UI) {
      const [UA, UB] = await Promise.all([uiLevel(wt), uiLevel(REPO)]);
      const ur = compareUi(UA, UB);
      out.ui = ur;
      out.errors.uiBase = UA.errors; out.errors.uiCurrent = UB.errors;
      console.log(`\n【畫面層】畫面完全相同 ${ur.same}　不同 ${ur.diffs.length}`);
      ur.diffs.forEach(d => console.log(`  ${d.label}：${d.fields.join('、')}`));
    }
    const errCount = Object.values(out.errors).reduce((n, e) => n + (e ? e.length : 0), 0);
    if (errCount) console.log(`\n⚠️ 頁面錯誤 ${errCount} 個（見 JSON 的 errors）`);
    fs.writeFileSync(path.join(__dirname, 'search-compare-last.json'), JSON.stringify(out, null, 1));
    console.log('\n完整差異：tools/regression/search-compare-last.json');
  } finally {
    execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', wt]);
  }
})().catch(e => { console.error(e); process.exit(1); });
