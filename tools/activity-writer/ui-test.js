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
  eq('複製 26 欄', cells.length, 26);
  eq('active 欄', cells[19], 'TRUE');

  // 站長實測的保險新戶原文：欄位值，以及「新戶 26 欄不用捲很多次」（1400×1000 下整頁不超過兩個畫面高）
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

  // 試算表視窗版（生成檔 apps-script/ActivityWriter.html）：假的 google.script.run，走一遍「貼上 → 寫進試算表」
  const hp = await ctx.newPage();
  hp.on('pageerror', e => errors.push('host: ' + e)); hp.on('console', m => { if (m.type() === 'error') errors.push('host: ' + m.text()); });
  await hp.setViewportSize({ width: 1240, height: 700 });   // 同 activity-writer.gs 的視窗大小
  await hp.addInitScript(() => {
    window.__calls = [];
    const handlers = {
      activityWriterInit: () => fetch('/cards.data').then(r => r.text()).then(t => {
        const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t.trim()), c => c.charCodeAt(0))));
        d.cards.forEach(c => { c.slots = [1, 2, 3, 4, 5, 6, 14].map(n => { const r = (c.cashbackRates || []).find(x => x.slot === n);
          return { n, empty: !r && !(window.__filled || {})[c.id + n], rate: r ? String(r.rate) : '', items: r ? r.items.slice(0, 3).join('、') : '' }; }); });
        d.host = { reservedSlots: [14, 21, 22], vocabNote: '', hasAiKey: true };
        return JSON.stringify(d);
      }),
      activityWriterSaveRate: p => { const o = JSON.parse(p); (window.__filled = window.__filled || {})[o.id + o.slot] = true; return Promise.resolve(JSON.stringify({ ok: true, message: '已寫進 Cards Data 第 9 列的 rate_' + o.slot })); },
      activityWriterSavePromo: p => Promise.resolve(JSON.stringify(window.__failNext ? { ok: false, message: 'period_end：結束日早於開始日' } : { ok: true, message: '已新增到 New Cardholder Promos 第 40 列' })),
    };
    const runner = () => { let okH = () => {}, failH = () => {}; const r = { withSuccessHandler: f => { okH = f; return r; }, withFailureHandler: f => { failH = f; return r; } };
      Object.keys(handlers).forEach(k => { r[k] = arg => { window.__calls.push([k, arg]); handlers[k](arg).then(okH, failH); }; }); return r; };
    window.google = { script: {} }; Object.defineProperty(window.google.script, 'run', { get: runner });
  });
  await hp.goto(url.replace('/tools/activity-writer/', '/apps-script/ActivityWriter.html'));
  await hp.waitForSelector('#app:not([hidden])');
  eq('視窗版：讀表', (await hp.textContent('#dataMeta')).includes('讀自試算表現況'), true);
  await hp.fill('#source', S.artfunComposition.text);
  await hp.waitForSelector('#f_rate');
  eq('視窗版：有寫入鈕、沒有貼上位置欄', [await hp.isVisible('#writeBtn'), await hp.isVisible('#anchorCell')].join(), 'true,false');
  // 通路跟既有的 rate_2 重疊 → 預設選那一槽、要按兩次才覆蓋
  eq('視窗版：預設選重疊的槽', await hp.inputValue('#slotSel'), '2');
  await hp.click('#writeBtn');
  eq('視窗版：第一次按不寫', await hp.evaluate(() => window.__calls.filter(c => c[0] === 'activityWriterSaveRate').length), 0);
  eq('視窗版：按鈕變成確認', (await hp.textContent('#writeBtn')).includes('再按一次'), true);
  // 改選空槽 → 一次就寫
  const freeSlot = await hp.evaluate(() => Array.from(document.querySelectorAll('#slotSel option')).find(o => /（空）/.test(o.textContent)).value);
  await hp.selectOption('#slotSel', freeSlot);
  await hp.click('#writeBtn');
  await hp.waitForFunction(() => document.getElementById('writeBtn').textContent.includes('已寫入'));
  const sent = await hp.evaluate(() => JSON.parse(window.__calls.find(c => c[0] === 'activityWriterSaveRate')[1]));
  eq('視窗版：送出的槽位與欄位', [sent.id, String(sent.slot), sent.overwrite, sent.fields.rate, sent.fields.cashbackModel].join('|'), ['tbb-artfun', freeSlot, false, '2.5', 'rate+basic'].join('|'));
  eq('視窗版：寫完不能再按', await hp.isDisabled('#writeBtn'), true);
  eq('視窗版：寫完重新讀表', await hp.evaluate(() => window.__calls.filter(c => c[0] === 'activityWriterInit').length), 2);
  // 新戶活動：伺服器擋下時把原因顯示出來、可以再試
  await hp.click('#resetBtn');
  await hp.fill('#source', S.promoInsurance.text);
  await hp.waitForSelector('#f_bonus_rate');
  await hp.evaluate(() => { window.__failNext = true; });
  await hp.click('#writeBtn');
  await hp.waitForFunction(() => document.getElementById('issues').textContent.includes('結束日早於開始日'));
  eq('視窗版：被擋下後還能再寫', await hp.isDisabled('#writeBtn'), false);
  await hp.evaluate(() => { window.__failNext = false; });
  await hp.click('#writeBtn');
  await hp.waitForFunction(() => document.getElementById('writeBtn').textContent.includes('已寫入'));
  const pv = await hp.evaluate(() => JSON.parse(window.__calls.filter(c => c[0] === 'activityWriterSavePromo').pop()[1]));
  eq('視窗版：新戶送出依欄名', [pv.id, pv.values.bonus_rate, pv.values.bonus_merchants].join('|'), 'taishin-richart|0.06|保險,保費');
  const hd = await hp.evaluate(() => document.getElementById('f_pick_reason').getBoundingClientRect().bottom + window.scrollY);
  eq('視窗版：1240×700 的視窗裡欄位排得完（最後一欄底部 ' + Math.round(hd) + '，上限 1000）', hd < 1000, true);
  if (shotDir) await hp.screenshot({ path: path.join(shotDir, 'host-promo.png'), fullPage: true });

  eq('頁面沒有錯誤', errors.join(' | '), '');
  await browser.close(); server.close();
  console.log(fail ? `\n${fail} 項不符` : '✅ ui-test 全部通過');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
