#!/usr/bin/env node
// 單卡編輯器（apps-script/card-editor.gs）＋ 共用驗證 pmcValidateCardRow_ ＋ runQACheck 檢查 12 的離線測試。
// 用假的 SpreadsheetApp 在 Node vm 裡載入 cards-export.gs 與 card-editor.gs 跑；不連 Google。
// 用法：node tools/apps-script-tests/card-editor-test.js   （全過 exit 0，有失敗 exit 1）
// ⚠️ 假試算表不會做「真試算表的自動轉型」（例如字串 "2026/7/1" 變日期、開頭 ' 強制文字），
//    那部分只能在真的試算表上確認（見 apps-script/README.md「單卡編輯器」的上線檢查）。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
let failed = 0, passed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '\n      期望 ' + JSON.stringify(b) + '\n      實際 ' + JSON.stringify(a)); }

// ---------- 假試算表 ----------
function makeSheet(name, grid, formulas) {
  formulas = formulas || {};
  const writes = [];
  const sheet = {
    name, grid, formulas, writes,
    getLastRow: () => grid.length,
    getLastColumn: () => Math.max(...grid.map(r => r.length)),
    getDataRange: () => sheet.getRange(1, 1, grid.length, sheet.getLastColumn()),
    clear: () => { grid.length = 0; },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const row = grid[r - 1 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; })),
        getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) =>
          formulas[(r + i) + ',' + (c + j)] || '')),
        setValue: (v) => { writes.push({ r, c, v }); (grid[r - 1] = grid[r - 1] || [])[c - 1] = v; return rng; },
        setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => { (grid[r - 1 + i] = grid[r - 1 + i] || [])[c - 1 + j] = v; })); return rng; },
        setFontWeight: () => rng, setBackground: () => rng, setFontColor: () => rng,
      };
      return rng;
    },
  };
  return sheet;
}

function loadScripts(sheets) {
  const alerts = [], menus = [];
  const menu = () => { const m = { items: [], addItem: (a, b) => { m.items.push(b); return m; }, addSeparator: () => m, addSubMenu: () => m, addToUi: () => { menus.push(m); return m; } }; return m; };
  const ss = { getSheetByName: n => sheets[n] || null, getSpreadsheetTimeZone: () => 'Asia/Taipei' };
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, flush: () => {},
      getUi: () => ({ alert: (...a) => alerts.push(a), createMenu: menu, ButtonSet: { OK: 'OK' }, showSidebar: () => {} }),
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
          .formatToParts(d).map(x => [x.type, x.value]));
        const y = p.year, M = String(+p.month), D = String(+p.day);
        if (fmt === 'yyyy-MM-dd') return `${y}-${M.padStart(2, '0')}-${D.padStart(2, '0')}`;
        if (fmt === 'yyyy/M/d') return `${y}/${M}/${D}`;
        throw new Error('fmt ' + fmt);
      },
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle: function() { return this; } }) },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(root, 'apps-script/cards-export.gs'), 'utf8') + '\n' +
              fs.readFileSync(path.join(root, 'apps-script/card-editor.gs'), 'utf8') +
              '\n;this.__x = { pmcValidateCardRow_, runQACheck, onOpen, cardEditorListCards, cardEditorLoad, cardEditorSave, ceToCell_ };';
  vm.runInContext(src, ctx, { filename: 'apps-script' });
  return Object.assign(ctx.__x, { alerts, menus });
}

// 一般卡＋分級卡的最小寬表（注意 period_1 是公式欄；欄序故意打亂、槽位不連續滿）
const H = ['id', 'name', 'fullName', 'basicCashback', 'annualFee', 'feeWaiver', 'website', 'tags',
  'rate_1', 'items_1', 'cap_1', 'periodStart_1', 'periodEnd_1', 'period_1', 'cashbackModel_1',
  'rate_2', 'items_2', 'cap_2', 'periodStart_2', 'periodEnd_2', 'hideInDisplay_2',
  'couponMerchant_1', 'couponRate_1', 'couponCap_1', 'couponPeriodStart_1', 'couponPeriodEnd_1',
  'hasLevels', 'levelSettings', 'extraNew'];
function row(o) { return H.map(h => (h in o ? o[h] : '')); }
const tw = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - 8 * 3600e3); // 台北午夜
const LS = JSON.stringify({ 'Level 1': { specialRate: 2, cap: 1000 }, 'Level 2': { specialRate: 3, cap: 2000 } });
const base = { name: 'A', fullName: 'A卡', basicCashback: 1, annualFee: '免年費', feeWaiver: '免', website: 'https://x', tags: 't' };
function freshSheets() {
  const grid = [H,
    row(Object.assign({ id: 'card-a', rate_1: 3, items_1: '街口,全支付', cap_1: 500, periodStart_1: tw(2026, 7, 1), periodEnd_1: tw(2026, 12, 31), period_1: '2026/7/1~2026/12/31' }, base)),
    row(Object.assign({ id: 'card-lv', hasLevels: true, levelSettings: LS, rate_1: '{specialRate}', items_1: 'momo' }, base)),
  ];
  return { 'Cards Data': makeSheet('Cards Data', grid, { '2,14': '=TEXT(L2)&"~"&TEXT(M2)' }), 'QA Check': makeSheet('QA Check', [[]]) };
}
const codes = issues => issues.map(i => i.code + '@' + i.field).sort();

// ---------- 1. 共用驗證 ----------
console.log('1. pmcValidateCardRow_');
{
  const s = loadScripts(freshSheets());
  const g = freshSheets()['Cards Data'].grid;
  eq(codes(s.pmcValidateCardRow_(H, g[1])), [], '正常一般卡沒有問題');
  eq(codes(s.pmcValidateCardRow_(H, g[2])), [], '正常分級卡（{specialRate} 在級別裡）沒有問題');

  const bad = row(Object.assign({ id: 'x', rate_2: 2, periodStart_2: '2026/2/30', periodEnd_2: '2026/1/1',
    couponRate_1: 5, couponPeriodEnd_1: '2026/3/1', rate_1: '3%', items_1: 'a', cap_1: '1,000' }, base));
  eq(codes(s.pmcValidateCardRow_(H, bad)), ['CAP_NOT_NUMBER@cap_1', 'COUPON_NO_MERCHANT@couponMerchant_1', 'DATE_INVALID@periodStart_2',
    'END_NO_START@couponPeriodStart_1', 'RATE_NOT_NUMBER@rate_1', 'RATE_NO_ITEMS@items_2'], '各種槽位錯誤都抓到');
  const cap = s.pmcValidateCardRow_(H, bad).find(i => i.code === 'CAP_NOT_NUMBER');
  ok(/讀成 1/.test(cap.message), 'cap "1,000" 說明會被讀成 1：' + cap.message);
  ok(s.pmcValidateCardRow_(H, bad).find(i => i.code === 'RATE_NO_ITEMS').slotLabel === '回饋槽位 2', '指出是哪個槽位');

  const order = row(Object.assign({ id: 'x', rate_1: 1, items_1: 'a', periodStart_1: '2026/7/1', periodEnd_1: tw(2026, 6, 30) }, base));
  eq(codes(s.pmcValidateCardRow_(H, order)), ['END_BEFORE_START@periodEnd_1'], '結束早於開始（字串 vs 日期型混用）');
  const same = row(Object.assign({ id: 'x', rate_1: 1, items_1: 'a', periodStart_1: '2026-07-01', periodEnd_1: '2026/7/1' }, base));
  eq(codes(s.pmcValidateCardRow_(H, same)), [], '同一天開始結束不算錯、兩種日期格式都吃');
  const zero = row(Object.assign({ id: 'x', rate_1: 0, items_1: 'meta廣告' }, base));
  eq(codes(s.pmcValidateCardRow_(H, zero)), [], 'rate=0 合法（rate=0 陷阱）');
  const zeroNoItems = s.pmcValidateCardRow_(H, row(Object.assign({ id: 'x', rate_1: 0 }, base)));
  eq(zeroNoItems.map(i => i.qa), ['⚠️'], 'rate=0 沒 items：既有檢查 6 抓不到，新檢查補 ⚠️');

  const lv = (o) => s.pmcValidateCardRow_(H, row(Object.assign({ id: 'x' }, base, o)));
  eq(lv({ hasLevels: true, levelSettings: '{"a":{rate:1}}' }).map(i => i.code + i.qa), ['LEVELS_BAD_JSON❌'], '壞 JSON → ❌');
  eq(lv({ hasLevels: 'TRUE', levelSettings: '' }).map(i => i.code + i.qa), ['LEVELS_EMPTY❌'], '勾了 hasLevels 卻空白 → ❌');
  eq(lv({ hasLevels: true, levelSettings: '{}' }).map(i => i.code + i.qa), ['LEVELS_EMPTY❌'], '空物件 → ❌');
  eq(lv({ hasLevels: true, levelSettings: '{"a":3}' }).map(i => i.code + i.qa), ['LEVEL_NOT_OBJECT❌'], '級別內容不是物件 → ❌');
  eq(lv({ hasLevels: false, levelSettings: LS }).map(i => i.code + i.qa), ['LEVELS_UNUSED⚠️'], '沒勾 hasLevels 但有 levelSettings → ⚠️');
  eq(lv({ hasLevels: true, levelSettings: LS, rate_1: '{rate}', items_1: 'a' }).map(i => i.code), ['PLACEHOLDER_NOT_IN_LEVELS'], '{rate} 沒有任何級別有');
  eq(lv({ rate_1: '{rate}', items_1: 'a' }).map(i => i.code), ['PLACEHOLDER_NO_LEVELS'], '非分級卡用 {變數}');
  const partial = JSON.stringify({ L1: { specialRate: 2 }, 固定: { rate: 1 } });
  eq(lv({ hasLevels: true, levelSettings: partial, rate_1: '{specialRate}', items_1: 'a' }), [], '只有部分級別有該欄位不報（CUBE 慣例）');
  eq(lv({ couponMerchant_1: 'x', couponRate_1: 'specialRate+1' }), [], 'couponRate 的 specialRate+ 字串合法');
}

// ---------- 2. runQACheck 檢查 12 ----------
console.log('2. runQACheck');
{
  const sh = freshSheets();
  sh['Cards Data'].grid.push(row(Object.assign({ id: 'card-bad', hasLevels: true, levelSettings: '{oops', rate_2: 5, items_2: 'x', periodStart_2: '2026/9/1', periodEnd_2: '2026/8/1', rate_1: 3 }, base)));
  const s = loadScripts(sh);
  s.runQACheck();
  const qa = sh['QA Check'].grid.slice(1).filter(r => r[0] === 'card-bad');
  const has = (field, sev) => qa.some(r => r[3] === field && r[5] === sev);
  ok(has('levelSettings', '❌'), 'levelSettings 壞 → QA ❌（擋匯出）');
  ok(has('periodEnd_2', '⚠️'), '結束早於開始 → QA ⚠️');
  eq(qa.filter(r => r[3] === 'rate_1' || r[3] === 'items_1').length, 1, 'rate 沒 items 只列一次（既有檢查 6，不重複）');
  ok(qa.find(r => r[3] === 'periodEnd_2')[2] === '回饋槽位 2', 'QA 的「問題類型」欄寫出槽位');
  const normal = sh['QA Check'].grid.slice(1).filter(r => r[0] === 'card-a' || r[0] === 'card-lv'); eq(normal, [], '正常卡沒有新問題');
}

// ---------- 3. onOpen 選單 ----------
console.log('3. onOpen');
{
  const s = loadScripts(freshSheets());
  try { s.onOpen(); } catch (e) { /* buildAutomationMenu_ 不在此專案時會丟錯，選單已先 addToUi */ }
  ok(s.menus[0] && s.menus[0].items.indexOf('openCardEditor') >= 0, '有貼 card-editor.gs → 選單出現單卡編輯器');
}

// ---------- 4. 載入 ----------
console.log('4. cardEditorLoad');
{
  const s = loadScripts(freshSheets());
  eq(s.cardEditorListCards().map(c => c.id), ['card-a', 'card-lv'], '卡片清單');
  const c = s.cardEditorLoad('card-a');
  eq(c.rowNumber, 2, '列號');
  eq(c.fields.periodStart_1.value, '2026/7/1', '日期顯示成 2026/7/1');
  ok(c.fields.period_1.readonly && c.fields.period_1.formula, 'period_1 公式欄唯讀');
  ok(c.fields.id.readonly, 'id 唯讀');
  eq(c.rateSlots.map(x => [x.n, x.empty]), [[1, false], [2, true]], '回饋槽位與空槽判斷');
  eq(c.rateSlots[0].fields.slice(0, 3), ['rate_1', 'items_1', 'cap_1'], '槽內欄位依慣用順序');
  eq(c.couponSlots.map(x => x.n), [1], '領券槽位');
  eq(c.levels, ['hasLevels', 'levelSettings'], '級別欄位');
  ok(c.base.indexOf('extraNew') >= 0, '表上新加的欄位自動出現在基本資料');
  eq(c.fields.hideInDisplay_2.kind, 'bool', 'hideInDisplay 是勾選框');
}

// ---------- 5. 存檔 ----------
console.log('5. cardEditorSave');
{
  let sh = freshSheets(); let s = loadScripts(sh);
  let r = s.cardEditorSave({ id: 'card-a', changes: { rate_2: { original: '', value: '2' }, items_2: { original: '', value: '7-11' }, periodStart_2: { original: '', value: '2026/8/1' }, periodEnd_2: { original: '', value: '2026/8/31' } } });
  ok(r.ok, '合法修改存檔成功 ' + JSON.stringify(r).slice(0, 200));
  eq(sh['Cards Data'].writes.map(w => H[w.c - 1] + '=' + JSON.stringify(w.v)).sort(),
    ['items_2="\'7-11"', 'periodEnd_2="2026/8/31"', 'periodStart_2="2026/8/1"', 'rate_2=2'], '只寫改的格子；rate 寫數字、7-11 加 \' 強制文字');
  ok(!sh['Cards Data'].writes.some(w => w.r !== 2), '只寫在 card-a 那一列');

  sh = freshSheets(); s = loadScripts(sh);
  r = s.cardEditorSave({ id: 'card-a', changes: { rate_2: { original: '', value: '2' }, periodStart_2: { original: '', value: '2026/9/1' }, periodEnd_2: { original: '', value: '2026/8/1' } } });
  ok(!r.ok && r.errors, '驗證不過 → 擋下');
  eq(codes(r.errors), ['END_BEFORE_START@periodEnd_2', 'RATE_NO_ITEMS@items_2'], '錯誤指出欄位');
  eq(sh['Cards Data'].writes.length, 0, '被擋下時一格都沒寫');

  sh = freshSheets(); s = loadScripts(sh);
  sh['Cards Data'].grid[1][H.indexOf('cap_1')] = 800; // 別人在表上改了
  r = s.cardEditorSave({ id: 'card-a', changes: { cap_1: { original: '500', value: '600' } } });
  ok(!r.ok && r.conflicts && r.conflicts[0].sheetValue === '800', '別人改過同一格 → 衝突擋下');
  eq(sh['Cards Data'].writes.length, 0, '衝突時一格都沒寫');

  r = s.cardEditorSave({ id: 'card-a', changes: { period_1: { original: '2026/7/1~2026/12/31', value: 'x' } } });
  ok(!r.ok && /公式/.test(r.message), '公式欄不能寫');

  // 級別改名
  sh = freshSheets(); s = loadScripts(sh);
  const renamed = JSON.stringify({ 'Level 1': { specialRate: 2, cap: 1000 }, 'Lv2': { specialRate: 3, cap: 2000 } });
  r = s.cardEditorSave({ id: 'card-lv', changes: { levelSettings: { original: LS, value: renamed } } });
  ok(!r.ok && r.levelWarning, '級別改名 → 要求確認');
  eq([r.levelWarning.removed, r.levelWarning.added, r.levelWarning.defaultChanged], [['Level 2'], ['Lv2'], false], '指出消失與新增的名稱');
  eq(sh['Cards Data'].writes.length, 0, '未確認前不寫');
  r = s.cardEditorSave({ id: 'card-lv', changes: { levelSettings: { original: LS, value: renamed } }, confirmLevelChange: true });
  ok(r.ok && sh['Cards Data'].writes.length === 1, '確認後才寫');

  sh = freshSheets(); s = loadScripts(sh);
  const reordered = JSON.stringify({ 'Level 2': { specialRate: 3, cap: 2000 }, 'Level 1': { specialRate: 2, cap: 1000 } });
  r = s.cardEditorSave({ id: 'card-lv', changes: { levelSettings: { original: LS, value: reordered } } });
  ok(!r.ok && r.levelWarning && r.levelWarning.defaultChanged, '預設級別（第一個）換人 → 要求確認');
  const valueOnly = JSON.stringify({ 'Level 1': { specialRate: 2.5, cap: 1000 }, 'Level 2': { specialRate: 3, cap: 2000 } });
  r = s.cardEditorSave({ id: 'card-lv', changes: { levelSettings: { original: LS, value: valueOnly } } });
  ok(r.ok, '只改數值、名稱不動 → 不用確認直接存');
  r = s.cardEditorSave({ id: 'card-lv', changes: { levelSettings: { original: valueOnly, value: '{bad' } }, confirmLevelChange: true });
  ok(!r.ok && r.errors && r.errors[0].code === 'LEVELS_BAD_JSON', '壞 JSON 就算確認也擋');

  // 型別
  eq(s.ceToCell_('items_1', 'text', '85', ''), "'85", 'items 填純數字仍存文字（匯出會 split）');
  eq(s.ceToCell_('conditions_1', 'text', '- 需登錄', ''), "'- 需登錄", '開頭 - 不被當公式');
  eq(s.ceToCell_('conditions_1', 'text', '需登錄', ''), '需登錄', '一般文字不加 \'');
  eq(s.ceToCell_('cap_1', 'text', '{cap}', ''), '{cap}', 'placeholder 原樣');
  eq(s.ceToCell_('hideInDisplay_2', 'bool', '', ''), '', '勾選框：原本空白取消勾選留空白');
  eq(s.ceToCell_('hasLevels', 'bool', '', true), false, '勾選框：原本 TRUE 取消勾選寫 FALSE');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} 通過、${failed} 失敗`);
process.exit(failed === 0 ? 0 : 1);
