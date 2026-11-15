#!/usr/bin/env node
// 單卡編輯器畫面（apps-script/CardEditor.html）的離線測試：槽位「📋 複製到空槽位」「🗑 清空這個槽位」
// 「↩ 還原這個槽位」（2026-11-15 新增）。
// 用環境預裝的 Playwright 打開 CardEditor.html，google.script.run 接到 Node 端用假試算表跑的
// 真 card-editor.gs（fake-sheet.js），所以「畫面操作 → 存檔 → 寫進表格」整條路都有走到。
// 用法：node tools/apps-script-tests/card-editor-ui-test.js   （全過 exit 0，有失敗 exit 1）
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { makeSheet, loadScripts } = require('./fake-sheet');

const root = path.join(__dirname, '..', '..');
let failed = 0, passed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '\n      期望 ' + JSON.stringify(b) + '\n      實際 ' + JSON.stringify(a)); }

// 槽位 2 刻意少了 hideInDisplay_2（測「表上沒有這欄 → 沒複製」）；槽位 3 的 cashbackModel 引用 rate_1；
// 級別 L1 的 onlySlots 列了 1（測複製／清空的提醒）
const H = ['id', 'name', 'basicCashback',
  'rate_1', 'items_1', 'cap_1', 'periodStart_1', 'periodEnd_1', 'period_1', 'cashbackModel_1', 'hideInDisplay_1',
  'rate_2', 'items_2', 'cap_2', 'periodStart_2', 'periodEnd_2', 'period_2', 'cashbackModel_2',
  'rate_3', 'items_3', 'cashbackModel_3',
  'couponMerchant_1', 'couponRate_1', 'couponMerchant_2', 'couponRate_2',
  'hasLevels', 'levelSettings'];
const LS = JSON.stringify({ L1: { specialRate: 2, onlySlots: [1] }, L2: { specialRate: 3 } });
const tw = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - 8 * 3600e3); // 台北午夜
function freshSheets() {
  const o = { id: 'card-a', name: 'A', basicCashback: 1,
    rate_1: 3, items_1: '街口,全支付', cap_1: 500, periodStart_1: tw(2026, 7, 1), periodEnd_1: tw(2026, 12, 31),
    period_1: '2026/7/1~2026/12/31', hideInDisplay_1: true,
    rate_3: 1, items_3: 'x', cashbackModel_3: 'rate+rate_1',
    couponMerchant_1: 'momo', couponRate_1: 5, hasLevels: true, levelSettings: LS };
  const grid = [H, H.map(h => (h in o ? o[h] : ''))];
  return { 'Cards Data': makeSheet('Cards Data', grid, { '2,9': '=TEXT(G2)&"~"&TEXT(H2)', '2,17': '=TEXT(O2)&"~"&TEXT(P2)' }) };
}
const cell = (sheets, name) => sheets['Cards Data'].grid[1][H.indexOf(name)];

const STUB = `
window.google = { script: { get run() {
  var ok = null, fail = null;
  var p = new Proxy({}, { get: function(_, k) {
    if (k === 'withSuccessHandler') return function(h) { ok = h; return p; };
    if (k === 'withFailureHandler') return function(h) { fail = h; return p; };
    return function() {
      window.__backend(k, JSON.stringify(Array.prototype.slice.call(arguments)))
        .then(function(r) { var v = JSON.parse(r); if (v && v.__err) { fail && fail(new Error(v.__err)); } else { ok && ok(v); } });
    };
  } });
  return p;
} } };`;

(async () => {
  let sheets = freshSheets();
  let backend = loadScripts(sheets, ['cardEditorListCards', 'cardEditorLoad', 'cardEditorSave']);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1060, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.exposeFunction('__backend', (fn, argsJson) => {
    try { return JSON.stringify(backend[fn].apply(null, JSON.parse(argsJson))); }
    catch (e) { return JSON.stringify({ __err: String(e.message || e) }); }
  });
  // setContent 不會跑 addInitScript，所以把假的 google.script.run 直接插在編輯器自己的 <script> 前面
  const html = fs.readFileSync(path.join(root, 'apps-script/CardEditor.html'), 'utf8')
    .replace('<script>', '<script>' + STUB + '</script>\n<script>');

  const slot = label => page.locator('details.slot', { has: page.locator('.sum-n', { hasText: new RegExp('^' + label + '$') }) });
  const val = name => page.evaluate(n => {
    const i = document.querySelector('.field[data-field="' + n + '"] textarea, .field[data-field="' + n + '"] input');
    return i ? (i.type === 'checkbox' ? (i.checked ? 'TRUE' : '') : i.value) : null;
  }, name);
  const saveText = () => page.textContent('#saveBtn');
  async function open() {
    await page.setContent(html);
    await page.waitForFunction(() => document.querySelectorAll('#cardSelect option').length > 1);
    await page.selectOption('#cardSelect', 'card-a');
    await page.waitForSelector('details.slot');
  }

  // ---------- 1. 複製 ----------
  console.log('1. 📋 複製到空槽位');
  await open();
  ok(await slot('槽位 2').locator('text=📋 複製到空槽位').isHidden(), '空槽位不顯示複製鈕');
  await slot('槽位 1').locator('text=📋 複製到空槽位').click();
  eq([await val('rate_2'), await val('items_2'), await val('cap_2'), await val('periodStart_2'), await val('periodEnd_2')],
    ['3', '街口,全支付', '500', '2026/7/1', '2026/12/31'], '整組內容複製到編號最小的空槽位（槽位 2）');
  ok(await slot('槽位 2').evaluate(d => d.open && d.classList.contains('dirty')), '目標槽位自動展開、標成已修改');
  const note2 = await slot('槽位 2').locator('.slot-note').textContent();
  ok(/hideInDisplay_2（表上沒有這欄）/.test(note2), '表上沒有的欄位列為沒複製：' + note2);
  ok(/級別「L1」的 onlySlots/.test(note2) && /把 2 加進去/.test(note2), '原槽位是級別專屬 → 提醒新槽位沒有：' + note2);
  eq(await saveText(), '💾 儲存（5 格）', '只算真的有改的 5 格（公式欄 period_2 不算）');
  ok(/已把回饋槽位 1 複製到 回饋槽位 2/.test(await page.textContent('#status')), '狀態列說明複製到哪裡');
  ok(await page.locator('#nav .nav-item', { hasText: '街口' }).count() === 2, '左側索引出現新槽位');

  await page.click('#saveBtn');
  await page.waitForFunction(() => /已存檔/.test(document.getElementById('status').textContent));
  eq([cell(sheets, 'rate_2'), cell(sheets, 'items_2'), cell(sheets, 'cap_2'), cell(sheets, 'periodStart_2')],
    [3, '街口,全支付', 500, '2026/7/1'], '存檔後寫進表上（數字欄是數字）');
  eq(sheets['Cards Data'].writes.map(w => H[w.c - 1]).sort(), ['cap_2', 'items_2', 'periodEnd_2', 'periodStart_2', 'rate_2'], '只寫槽位 2 改到的格子');

  // 複製 cashbackModel 有 rate_N 的槽位：提醒仍指向原槽位；槽位 3 之後沒有空的回饋槽位
  await slot('槽位 3').locator('text=📋 複製到空槽位').click();
  ok(/表上新增下一組欄位/.test(await page.textContent('#status')), '回饋槽位都滿了 → 請先在表上加欄位');
  await slot('領券 1').locator('text=📋 複製到空槽位').click();
  eq([await val('couponMerchant_2'), await val('couponRate_2')], ['momo', '5'], '領券槽位也能複製');
  ok(!/onlySlots|rate_N/.test(await slot('領券 2').locator('.slot-note').textContent()), '領券槽位沒有級別／rate_N 提醒');
  await slot('領券 2').locator('text=↩ 還原這個槽位').click();
  eq([await val('couponMerchant_2'), await saveText()], ['', '沒有修改'], '↩ 還原這個槽位 → 回到空的');

  // ---------- 2. 清空 ----------
  console.log('2. 🗑 清空這個槽位');
  sheets = freshSheets();
  backend = loadScripts(sheets, ['cardEditorListCards', 'cardEditorLoad', 'cardEditorSave']);
  await open();
  await slot('槽位 1').locator('text=🗑 清空這個槽位').click();
  ok(await page.isVisible('#modal.show'), '先跳確認視窗');
  const body = await page.textContent('#modalBody');
  ok(/回饋槽位 3 的 cashbackModel「rate\+rate_1」/.test(body), '列出 cashbackModel 引用：' + body);
  ok(/級別「L1」的 onlySlots/.test(body), '列出 onlySlots 引用');
  ok(!/period_1/.test(body), '公式欄不在清空名單');
  await page.click('#modalCancel');
  eq(await val('rate_1'), '3', '按取消什麼都沒動');

  await slot('槽位 1').locator('text=🗑 清空這個槽位').click();
  await page.click('#modalOk');
  eq([await val('rate_1'), await val('items_1'), await val('hideInDisplay_1')], ['', '', ''], '整個槽位清空（含勾選框）');
  eq(await saveText(), '💾 儲存（6 格）', '有值的 6 格待存（cashbackModel_1 原本就空、公式欄不算）');
  ok(/已清空，存檔後生效/.test(await slot('槽位 1').locator('.sum-txt').textContent()), '標題顯示「已清空，存檔後生效」');
  ok(/別忘了改掉引用它的地方/.test(await slot('槽位 1').locator('.slot-note').textContent()), '槽位裡留著引用提醒');

  await slot('槽位 1').locator('text=↩ 還原這個槽位').click();
  eq([await val('rate_1'), await val('hideInDisplay_1'), await saveText()], ['3', 'TRUE', '沒有修改'], '還原這個槽位 → 全部回來');
  ok(await slot('槽位 1').locator('.slot-note').isHidden(), '還原後提醒消失');

  // 沒有引用的槽位：一般確認，存檔寫空
  await slot('領券 1').locator('text=🗑 清空這個槽位').click();
  ok(!/⚠️/.test(await page.textContent('#modalTitle')) && !/引用/.test(await page.textContent('#modalBody')), '沒被引用的槽位不顯示引用警告');
  await page.click('#modalOk');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已存檔/.test(document.getElementById('status').textContent));
  eq([cell(sheets, 'couponMerchant_1'), cell(sheets, 'couponRate_1')], ['', ''], '存檔後表上清空');
  ok(await slot('領券 1').evaluate(d => d.classList.contains('empty')), '存檔重新載入後變成空槽位');

  // 清空後再存：hideInDisplay 原本 TRUE → 寫 FALSE；其他照常
  await slot('槽位 1').locator('text=🗑 清空這個槽位').click();
  await page.click('#modalOk');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已存檔/.test(document.getElementById('status').textContent));
  eq([cell(sheets, 'rate_1'), cell(sheets, 'items_1'), cell(sheets, 'hideInDisplay_1'), cell(sheets, 'period_1')],
    ['', '', false, '2026/7/1~2026/12/31'], '清空存檔：勾選框寫 FALSE、公式欄不動');

  eq(pageErrors, [], '畫面沒有 JS 錯誤');
  await browser.close();
  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} 通過、${failed} 失敗`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
