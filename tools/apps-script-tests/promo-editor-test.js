#!/usr/bin/env node
// 新戶活動編輯器（apps-script/promo-editor.gs）＋ pmcValidatePromoRow_ ＋ runQACheck 檢查 13 的離線測試。
// 用假的 SpreadsheetApp 在 Node vm 裡載入 cards-export.gs、card-editor.gs、promo-editor.gs 跑；不連 Google。
// 用法：node tools/apps-script-tests/promo-editor-test.js   （全過 exit 0）
// ⚠️ 假試算表不模擬「插列繼承格式／勾選框」與自動轉型，那部分要在真的表上確認（README 上線檢查）。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..');
let failed = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + '\n      期望 ' + JSON.stringify(b) + '\n      實際 ' + JSON.stringify(a)); }

function makeSheet(grid, formulas) {
  formulas = formulas || {};
  const log = [];
  const width = () => Math.max(...grid.map(r => r.length));
  const sheet = {
    grid, formulas, log,
    getLastRow: () => grid.length, getLastColumn: width,
    getDataRange: () => sheet.getRange(1, 1, grid.length, width()),
    clear: () => { grid.length = 0; },
    insertRowAfter: (r) => {
      grid.splice(r, 0, new Array(width()).fill(''));
      const nf = {};
      Object.keys(formulas).forEach(k => { const [rr, cc] = k.split(',').map(Number); nf[(rr > r ? rr + 1 : rr) + ',' + cc] = formulas[k]; });
      Object.keys(formulas).forEach(k => delete formulas[k]); Object.assign(formulas, nf);
      log.push('insertAfter ' + r);
    },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        r, c, nr, nc,
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (grid[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })),
        getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => formulas[(r + i) + ',' + (c + j)] || '')),
        setValue: (v) => { log.push(`set ${r},${c}=${JSON.stringify(v)}`); grid[r - 1][c - 1] = v; return rng; },
        setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => { (grid[r - 1 + i] = grid[r - 1 + i] || [])[c - 1 + j] = v; })); return rng; },
        copyTo: (dst, type) => {
          if (type) { log.push(`copy ${type} ${r}->${dst.r}`); return; }
          const f = formulas[r + ',' + c]; if (f) formulas[dst.r + ',' + dst.c] = f;
          grid[dst.r - 1][dst.c - 1] = grid[r - 1][c - 1]; log.push(`copyCell ${r},${c}->${dst.r},${dst.c}`);
        },
        setFontWeight: () => rng, setBackground: () => rng, setFontColor: () => rng,
      };
      return rng;
    },
  };
  return sheet;
}

function load(sheets) {
  const ss = { getSheetByName: n => sheets[n] || null, getSpreadsheetTimeZone: () => 'Asia/Taipei' };
  const menus = [];
  const menu = () => { const m = { items: [], addItem: (a, b) => { m.items.push(b); return m; }, addSeparator: () => m, addToUi: () => { menus.push(m); } }; return m; };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {}, CopyPasteType: { PASTE_FORMAT: 'FMT', PASTE_DATA_VALIDATION: 'DV' },
      getUi: () => ({ alert() {}, createMenu: menu, ButtonSet: { OK: 1 } }) },
    Utilities: { formatDate: (d, tz, f) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d).map(x => [x.type, x.value]));
      return f === 'yyyy/M/d' ? `${p.year}/${+p.month}/${+p.day}` : `${p.year}-${String(+p.month).padStart(2, '0')}-${String(+p.day).padStart(2, '0')}`; } },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Logger: { log() {} }, console,
  };
  vm.createContext(ctx);
  vm.runInContext(['cards-export.gs', 'card-editor.gs', 'promo-editor.gs'].map(f => fs.readFileSync(path.join(root, 'apps-script', f), 'utf8')).join('\n') +
    ';this.X={pmcValidatePromoRow_,runQACheck,onOpen,promoEditorListCards,promoEditorLoad,promoEditorSave};', ctx);
  return Object.assign(ctx.X, { menus });
}

// 真實表頭（2026-11-11 讀自試算表；2026-11-13 刪 priority 欄）
const PH = ['id', 'promo_types', 'new_customer_definition', 'new_customer_summary', 'promo_condition', 'period_start', 'period_end', 'min_spend', 'gift_content', 'gift_image_url', 'luggage_inch', 'luggage_value', 'bonus_rate', 'bonus_merchants', 'bonus_cap', 'voucher_amount', 'voucher_usage', 'notes', 'link', 'active', 'apply_cta_text', 'apply_cta_link', 'apply_cta_expiry', 'pick_rank', 'pick_question', 'pick_reason'];
const prow = o => PH.map(h => (h in o ? o[h] : ''));
const tw = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - 8 * 3600e3);
const A = { id: 'card-a', promo_types: '回饋加碼', new_customer_definition: '六個月內未持卡', new_customer_summary: '加碼 10%', promo_condition: '①開戶', period_start: tw(2026, 10, 1), period_end: tw(2026, 12, 31), bonus_rate: '10%', bonus_cap: 5000, link: 'https://a', active: true, apply_cta_text: '申辦 A', apply_cta_link: 'https://apply/a' };
function fresh() {
  const grid = [PH,
    prow(A),
    prow(Object.assign({}, A, { promo_types: '首刷禮', new_customer_summary: '送行李箱', gift_content: '行李箱', apply_cta_text: '申辦 A 卡', bonus_rate: '', bonus_cap: '' })),
    prow({ id: 'card-b', promo_types: '定額回饋', new_customer_summary: 'B', period_start: '2026/1/1', period_end: '2026/2/1', active: true, voucher_amount: 100 }),
    prow({ id: 'card-a', apply_cta_text: '申辦 A', apply_cta_link: 'https://apply/a', active: true }),  // 只放 CTA 的列
  ];
  const cards = [['id', 'name', 'fullName', 'basicCashback', 'annualFee', 'feeWaiver', 'website', 'tags'],
    ['card-a', 'A卡', 'A', 1, '免', '免', 'https://a', 't'], ['card-b', 'B卡', 'B', 1, '免', '免', 'https://b', 't'], ['card-c', 'C卡', 'C', 1, '免', '免', 'https://c', 't']];
  return { 'New Cardholder Promos': makeSheet(grid), 'Cards Data': makeSheet(cards), 'QA Check': makeSheet([[]]) };
}

console.log('1. pmcValidatePromoRow_');
{
  const s = load(fresh());
  const g = fresh()['New Cardholder Promos'].grid;
  eq(s.pmcValidatePromoRow_(PH, g[1], 'x'), [], '正常活動沒問題');
  eq(s.pmcValidatePromoRow_(PH, g[4], 'x'), [], '只放 CTA 的列不檢查活動欄位');
  const bad = prow({ id: 'x', promo_types: '回饋加碼,神秘', new_customer_summary: 's', period_start: '2026/9/1', period_end: '2026/8/1', bonus_cap: '12,000', min_spend: 'NT$10,000', pick_rank: '6', link: 'www.x.com', active: true });
  eq(s.pmcValidatePromoRow_(PH, bad, 'x').map(i => i.code + '@' + i.field).sort(),
    ['END_BEFORE_START@period_end', 'NOT_NUMBER@bonus_cap', 'PICK_RANK_BAD@pick_rank', 'TYPE_UNKNOWN@promo_types', 'URL_BAD@link'], '各種錯誤；min_spend「NT$10,000」合法');
  eq(s.pmcValidatePromoRow_(PH, prow({ id: 'x', promo_types: '首刷禮', active: true }), 'x').map(i => i.code), ['NO_SUMMARY'], '啟用但沒摘要');
  eq(s.pmcValidatePromoRow_(PH, prow({ id: 'x', new_customer_summary: 's', pick_rank: 'X' }), 'x').map(i => i.code), ['NO_TYPE'], 'pick_rank 大寫 X 合法、沒類型要報');
}

console.log('2. runQACheck 檢查 13');
{
  const sh = fresh(); const s = load(sh);
  sh['New Cardholder Promos'].grid.push(prow({ id: 'card-b', promo_types: '首刷禮', new_customer_summary: 'b2', pick_rank: 1, active: true }));
  sh['New Cardholder Promos'].grid[3][PH.indexOf('pick_rank')] = 1;
  s.runQACheck();
  const qa = sh['QA Check'].grid.slice(1);
  ok(qa.some(r => r[0] === 'card-a' && r[3] === 'apply_cta_text' && /各列填的不一樣/.test(r[4])), 'CTA 各列不一致 → ⚠️');
  ok(!qa.some(r => r[3] === 'apply_cta_link'), 'CTA 連結一致不報');
  ok(qa.some(r => r[3] === 'pick_rank' && /有 2 檔/.test(r[4])), 'pick_rank 重複 → ⚠️');
  ok(qa.every(r => r[5] === '⚠️'), '新戶活動一律 ⚠️ 不擋匯出');
}

console.log('3. 選單');
{
  const s = load(fresh());
  try { s.onOpen(); } catch (e) {}
  ok(s.menus[0].items.indexOf('openPromoEditor') >= 0 && s.menus[0].items.indexOf('openCardEditor') >= 0, '兩個編輯器都在選單');
}

console.log('4. 載入');
{
  const s = load(fresh());
  eq(s.promoEditorListCards().map(c => c.id + ':' + c.count), ['card-a:2', 'card-b:1', 'card-c:0'], '卡片清單含沒活動的卡、活動數不算 CTA 列');
  const d = s.promoEditorLoad('card-a');
  eq(d.rows.map(r => [r.rowNumber, r.isPromo]), [[2, true], [3, true], [5, false]], '這張卡的三列');
  eq(d.rows[0].fields.period_start.value, '2026/10/1', '日期顯示');
  eq(d.ctaFields, ['apply_cta_text', 'apply_cta_link', 'apply_cta_expiry'], 'CTA 欄位');
  eq(d.groups.map(g => g.title), ['活動內容', '回饋／獎勵', '備註與連結', '站長推薦'], '分組（沒有多出的欄位）');
}

console.log('5. 存檔');
{
  let sh = fresh(), s = load(sh), d = s.promoEditorLoad('card-a');
  const base = () => d.rows.map(r => ({ rowNumber: r.rowNumber, fingerprint: r.fingerprint, changes: {} }));
  let rows = base(); rows[0].changes.bonus_cap = { original: '5000', value: '6000' };
  let r = s.promoEditorSave({ id: 'card-a', rows, cta: { apply_cta_text: '立即申辦' }, newRows: [] });
  ok(r.ok, '改一格＋CTA 存檔成功 ' + JSON.stringify(r).slice(0, 200));
  const sets = sh['New Cardholder Promos'].log.filter(x => x.startsWith('set'));
  eq(sets.sort(), ['set 2,15=6000', 'set 2,21="立即申辦"', 'set 3,21="立即申辦"', 'set 5,21="立即申辦"'], 'bonus_cap 寫數字；CTA 寫到所有原本有填的列');

  // 被插列擠下去：用指紋找回來
  sh = fresh(); s = load(sh); d = s.promoEditorLoad('card-a');
  sh['New Cardholder Promos'].insertRowAfter(1); sh['New Cardholder Promos'].log.length = 0;
  rows = base(); rows[1].changes.notes = { original: '', value: '限量' };
  r = s.promoEditorSave({ id: 'card-a', rows, cta: {}, newRows: [] });
  ok(r.ok && sh['New Cardholder Promos'].log[0] === 'set 4,18="限量"', '別處插列後仍寫到正確的列（原第 3 列→第 4 列）');

  // 同一列被別人改過 → 擋
  sh = fresh(); s = load(sh); d = s.promoEditorLoad('card-a');
  sh['New Cardholder Promos'].grid[1][PH.indexOf('notes')] = '別人寫的';
  rows = base(); rows[0].changes.bonus_cap = { original: '5000', value: '6000' };
  r = s.promoEditorSave({ id: 'card-a', rows, cta: {}, newRows: [] });
  ok(!r.ok && r.conflict, '同列被改過 → 衝突');
  eq(sh['New Cardholder Promos'].log.filter(x => x.startsWith('set')).length, 0, '衝突時一格都沒寫');

  // 這張卡多了一列 → 擋
  sh = fresh(); s = load(sh); d = s.promoEditorLoad('card-a');
  sh['New Cardholder Promos'].grid.push(prow({ id: 'card-a', promo_types: '首刷禮', new_customer_summary: 'AI 剛寫的' }));
  r = s.promoEditorSave({ id: 'card-a', rows: base(), cta: { apply_cta_text: 'x' }, newRows: [] });
  ok(!r.ok && /4 列/.test(r.conflict), '這張卡多了一列 → 衝突');

  // 驗證擋下
  sh = fresh(); s = load(sh); d = s.promoEditorLoad('card-a');
  rows = base(); rows[0].changes.period_end = { original: '2026/12/31', value: '2026/9/1' };
  r = s.promoEditorSave({ id: 'card-a', rows, cta: {}, newRows: [{ values: { link: 'https://x' } }] });
  ok(!r.ok && r.errors, '驗證不過');
  eq(r.errors.map(e => e.rowKey + ':' + e.code).sort(), ['n0:NEW_EMPTY', 'r2:END_BEFORE_START'], '指出哪一列／哪一檔新活動（空白新活動只報一條）');

  // 新增活動：插在這張卡最後一列下面、複製格式與勾選框
  sh = fresh(); s = load(sh); d = s.promoEditorLoad('card-a');
  sh['New Cardholder Promos'].formulas['5,24'] = '=TODAY()+30';
  d = s.promoEditorLoad('card-a');
  r = s.promoEditorSave({ id: 'card-a', rows: base(), cta: {}, newRows: [{ values: { promo_types: '首刷禮', new_customer_summary: '新活動', period_start: '2026/12/1', active: 'TRUE', bonus_cap: '300', new_customer_definition: '六個月內未持卡' } }] });
  ok(r.ok, '新增活動成功 ' + JSON.stringify(r).slice(0, 300));
  const L = sh['New Cardholder Promos'].log;
  ok(L.indexOf('insertAfter 5') >= 0, '插在這張卡最後一列（第 5 列）下面');
  ok(L.indexOf('copy FMT 5->6') >= 0 && L.indexOf('copy DV 5->6') >= 0, '複製格式與勾選框');
  ok(L.indexOf('copyCell 5,24->6,24') >= 0, '公式欄從上一列複製');
  const g6 = sh['New Cardholder Promos'].grid[5];
  eq([g6[0], g6[1], g6[5], g6[14], g6[19]], ['card-a', '首刷禮', '2026/12/1', 300, true], '新列內容（id 自動帶、數字、勾選框）');
  eq(r.card.rows.length, 4, '回傳重新載入的資料');

  // 還沒有任何列的卡：CTA 跟著第一檔新活動寫
  sh = fresh(); s = load(sh);
  r = s.promoEditorSave({ id: 'card-c', rows: [], cta: { apply_cta_text: '申辦 C' }, newRows: [] });
  ok(!r.ok && /先「＋ 新增一檔活動」/.test(r.message), '沒列又沒新活動：提示先新增');
  r = s.promoEditorSave({ id: 'card-c', rows: [], cta: { apply_cta_text: '申辦 C' }, newRows: [{ values: { promo_types: '首刷禮', new_customer_summary: 'C', active: 'TRUE' } }] });
  ok(r.ok && sh['New Cardholder Promos'].grid[5][PH.indexOf('apply_cta_text')] === '申辦 C', 'CTA 寫進新活動那列（接在表尾）');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} 通過、${failed} 失敗`);
process.exit(failed === 0 ? 0 : 1);
