// 介面冒煙測試：node tools/activity-writer/ui-test.js [截圖資料夾]
// 起一個本機靜態伺服器、用預裝的 Playwright 開工具頁，走一遍「貼上 → 確認 → 複製」，AI 用假回應。
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const S = require('./samples.js');
const ROOT = path.join(__dirname, '../..');
const shotDir = process.argv[2];
let fail = 0;
const eq = (label, got, want) => { if (String(got) !== String(want)) { fail++; console.error('❌ ' + label + '\n   得到：' + got + '\n   應為：' + want); } };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/cards.data') p = '/tools/regression/fixture.data';     // 凍結資料，結果不隨線上資料變
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.js') ? 'text/javascript' : 'text/plain' });
    res.end(buf);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://127.0.0.1:' + server.address().port + '/tools/activity-writer/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('#app:not([hidden])');
  const shot = async (name) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: true }); };

  // 一般活動：貼上 → 自動認卡 → 欄位
  await page.fill('#source', S.artfunComposition.text);
  await page.waitForSelector('#f_rate');
  eq('自動認卡', await page.inputValue('#cardSel'), 'tbb-artfun');
  eq('rate', await page.inputValue('#f_rate'), '2.5');
  eq('model', await page.inputValue('#f_cashbackModel'), 'rate+basic');
  eq('cap', await page.inputValue('#f_cap'), '20000');
  await shot('rate');
  // 改選結構「完整率」→ rate 變 3、cap 重算
  await page.locator('.struct label', { hasText: 'rate=3｜rate' }).first().click();
  eq('換結構後 rate', await page.inputValue('#f_rate'), '3');
  eq('換結構後 cap 重算', await page.inputValue('#f_cap'), '16666.67');
  // 點掉一個通路
  await page.locator('.chip', { hasText: '好樂迪KTV' }).click();
  eq('點掉通路', (await page.inputValue('#f_items')).includes('好樂迪'), false);
  // 手動改過的格子，原文再變動也不被蓋掉
  await page.fill('#f_category', '我改的分類');
  await page.fill('#source', S.artfunComposition.text + '\n補一行');
  await page.waitForTimeout(400);
  eq('手動修改保留', await page.inputValue('#f_category'), '我改的分類');
  await page.fill('#anchorCell', 'CB15');
  await page.click('#copyBtn');
  let tsv = await page.evaluate(() => window.__lastCopied);
  eq('剪貼簿內容＝輸出', await page.evaluate(() => navigator.clipboard.readText()), tsv);
  eq('複製 13 欄', tsv.split('\t').length, 13);
  eq('第一欄是 rate', tsv.split('\t')[0], '3');
  eq('單列不換行', tsv.includes('\n'), false);
  eq('用站長的公式', tsv.split('\t')[11], '=IF(ISBLANK(CL15),"",CL15-TODAY())');

  // 新戶活動
  await page.click('#resetBtn');
  await page.fill('#source', S.promoGift.text);
  await page.waitForSelector('#f_promo_types');
  eq('自動切到新戶', await page.locator('#kindSeg button.on').getAttribute('data-kind'), 'promo');
  eq('新戶 id', await page.inputValue('#f_id'), 'fubon-jcard');
  await shot('promo');
  await page.click('#copyBtn');
  tsv = await page.evaluate(() => window.__lastCopied);
  // 多行格子有引號包住：拆欄要照 TSV 規則
  const cells = []; let curCell = '', q = false;
  for (let i = 0; i < tsv.length; i++) { const ch = tsv[i];
    if (q) { if (ch === '"' && tsv[i + 1] === '"') { curCell += '"'; i++; } else if (ch === '"') q = false; else curCell += ch; }
    else if (ch === '"' && curCell === '') q = true; else if (ch === '\t') { cells.push(curCell); curCell = ''; } else curCell += ch; }
  cells.push(curCell);
  eq('複製 25 欄', cells.length, 25);
  eq('active 欄', cells[20], 'TRUE');

  // 站長實測的保險新戶原文：欄位值，以及「新戶 25 欄不用捲很多次」（1400×1000 下整頁不超過兩個畫面高）
  await page.click('#resetBtn');
  await page.fill('#source', S.promoInsurance.text);
  await page.waitForSelector('#f_bonus_rate');
  eq('保險新戶 bonus_rate', await page.inputValue('#f_bonus_rate'), '0.06');
  eq('保險新戶 bonus_merchants', await page.inputValue('#f_bonus_merchants'), '保險,保費');
  const dims = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, last: document.getElementById('f_pick_reason').getBoundingClientRect().bottom + window.scrollY }));
  eq('新戶欄位在一個畫面內排完（最後一欄底部 < 920px，實際 ' + Math.round(dims.last) + '）', dims.last < 920, true);
  await shot('promo-insurance');

  // AI（假回應）
  await page.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ groups: [
      { headline_rate: 3, includes_basic: '是', group_kind: '指定通路加碼', items: ['威秀影城'], cap_reward: 500, conditions: '需登錄', period_start: '2027/1/1', period_end: '2027/6/30', evidence: '最高享3%', needs_review: false },
      { headline_rate: 5, includes_basic: '否', group_kind: '排除型', items: ['誠品書店'], evidence: '5%', needs_review: true, review_question: '是否限實體？' }
    ] }) }] } }] }) }));
  await page.click('#resetBtn');
  await page.evaluate(() => localStorage.setItem('pmcw.geminiKey', 'test-key'));
  await page.fill('#source', S.artfunComposition.text);
  await page.waitForSelector('#f_rate');
  await page.click('#aiBtn');
  await page.waitForSelector('.tabs button:nth-child(2)');
  eq('AI 兩列', await page.locator('.tabs button').count(), 2);
  eq('AI rate', await page.inputValue('#f_rate'), '2.5');
  await page.locator('.tabs button').nth(1).click();
  eq('AI 第二列 model', await page.inputValue('#f_cashbackModel'), 'rate');
  await shot('ai');

  eq('頁面沒有錯誤', errors.join(' | '), '');
  await browser.close(); server.close();
  console.log(fail ? `\n${fail} 項不符` : '✅ ui-test 全部通過');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
