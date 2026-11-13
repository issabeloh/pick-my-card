#!/usr/bin/env node
// 活動快寫的試算表端（apps-script/activity-writer.gs）＋自動部署對 HTML／空檔的處理，離線測試。
// 用假的 SpreadsheetApp 在 Node vm 裡載入 cards-export.gs、card-editor.gs、promo-editor.gs、activity-writer.gs；不連 Google。
// 用法：node tools/apps-script-tests/activity-writer-test.js   （全過 exit 0）
// ⚠️ 假試算表不模擬日期自動轉型、插列繼承格式；那部分要在真的表上確認。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..');
let failed = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + '\n      期望 ' + JSON.stringify(b) + '\n      實際 ' + JSON.stringify(a)); }

const colName = n => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
function makeSheet(grid, formulas) {
  formulas = formulas || {};
  const log = [];
  const width = () => Math.max(...grid.map(r => r.length));
  const sheet = {
    grid, formulas, log,
    getLastRow: () => grid.length, getLastColumn: width,
    getDataRange: () => sheet.getRange(1, 1, grid.length, width()),
    insertRowAfter: (r) => { grid.splice(r, 0, new Array(width()).fill('')); log.push('insertAfter ' + r); },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        r, c,
        getA1Notation: () => colName(c) + r,
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (grid[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })),
        getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => formulas[(r + i) + ',' + (c + j)] || '')),
        setValue: (v) => { log.push(`set ${r},${c}=${JSON.stringify(v)}`); grid[r - 1][c - 1] = v; return rng; },
        setFormula: (f) => { log.push(`formula ${r},${c}=${f}`); formulas[r + ',' + c] = f; return rng; },
        copyTo: (dst, type) => { if (!type) grid[dst.r - 1][dst.c - 1] = grid[r - 1][c - 1]; },
      };
      return rng;
    },
  };
  return sheet;
}

function load(sheets, opts) {
  opts = opts || {};
  const ss = { getSheetByName: n => sheets[n] || null, getSpreadsheetTimeZone: () => 'Asia/Taipei' };
  const menus = [];
  const menu = () => { const m = { items: [], addItem: (a, b) => { m.items.push(b); return m; }, addSeparator: () => m, addToUi: () => { menus.push(m); } }; return m; };
  const fetched = [];
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {}, CopyPasteType: { PASTE_FORMAT: 'FMT', PASTE_DATA_VALIDATION: 'DV' },
      getUi: () => ({ alert() {}, createMenu: menu, ButtonSet: { OK: 1 } }) },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d).map(x => [x.type, x.value]));
        return f === 'yyyy/M/d' ? `${p.year}/${+p.month}/${+p.day}` : `${p.year}-${String(+p.month).padStart(2, '0')}-${String(+p.day).padStart(2, '0')}`; },
      base64Decode: s => Buffer.from(s, 'base64'), newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString('utf8') }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (opts.props || {})[k] || null }) },
    UrlFetchApp: { fetch: (url, o) => { fetched.push({ url, o }); const r = (opts.fetch || (() => ({ code: 500, text: '' })))(url, o); return { getResponseCode: () => r.code, getContentText: () => r.text }; } },
    Logger: { log() {} }, console,
  };
  vm.createContext(ctx);
  vm.runInContext(['cards-export.gs', 'card-editor.gs', 'promo-editor.gs', 'activity-writer.gs'].map(f => fs.readFileSync(path.join(root, 'apps-script', f), 'utf8')).join('\n') +
    ';this.X={onOpen,activityWriterInit,activityWriterSaveRate,activityWriterSavePromo,activityWriterAi};', ctx);
  return Object.assign(ctx.X, { menus, fetched });
}

const SLOT = ['rate', 'items', 'cap', 'category', 'conditions', 'periodStart', 'periodEnd', 'daysRemaining', 'period', 'cashbackModel', 'minSpend', 'maxSpend', 'registerLink'];
const CH = ['id', 'name', 'fullName', 'basicCashback', 'annualFee', 'feeWaiver', 'website', 'tags', 'bank', 'hasLevels', 'overseasCashback']
  .concat(SLOT.map(f => f + '_1'), SLOT.map(f => f + '_2'), SLOT.filter(f => f !== 'registerLink').map(f => f + '_3'));
const crow = o => CH.map(h => (h in o ? o[h] : ''));
const PH = ['id', 'promo_types', 'new_customer_definition', 'new_customer_summary', 'promo_condition', 'period_start', 'period_end', 'min_spend', 'gift_content', 'gift_image_url', 'luggage_inch', 'luggage_value', 'bonus_rate', 'bonus_merchants', 'bonus_cap', 'voucher_amount', 'voucher_usage', 'notes', 'link', 'active', 'apply_cta_text', 'apply_cta_link', 'apply_cta_expiry', 'pick_rank', 'pick_question', 'pick_reason'];
const prow = o => PH.map(h => (h in o ? o[h] : ''));
function fresh() {
  const cards = [CH,
    crow({ id: 'card-a', name: 'A卡', fullName: 'A', basicCashback: 0.5, annualFee: '免', feeWaiver: '免', website: 'https://a', tags: 't', bank: '甲銀',
      rate_1: 2.5, items_1: '威秀影城,誠品書店', cashbackModel_1: 'rate+basic', category_1: '藝文', period_1: '2026/1/1~2026/12/31', periodStart_1: '2026/1/1', periodEnd_1: '2026/12/31' }),
    crow({ id: 'card-b', name: 'B卡', fullName: 'B', basicCashback: 1, annualFee: '免', feeWaiver: '免', website: 'https://b', tags: 't', bank: '乙銀' })];
  const cf = {};
  cf['2,' + (CH.indexOf('period_1') + 1)] = '=IF(…)';        // 既有槽位的公式
  const promos = [PH,
    prow({ id: 'card-a', promo_types: '回饋加碼', new_customer_definition: '六個月內未持卡', new_customer_summary: '加碼 10%', period_start: '2026/10/1', period_end: '2026/12/31', bonus_rate: 0.1, active: true, apply_cta_text: '申辦 A', apply_cta_link: 'https://apply/a' }),
    prow({ id: 'card-b', promo_types: '定額回饋', new_customer_summary: 'B', period_start: '2026/1/1', period_end: '2026/2/1', active: true, voucher_amount: 100 })];
  return { 'Cards Data': makeSheet(cards, cf), 'New Cardholder Promos': makeSheet(promos), 'QA Check': makeSheet([[]]) };
}
const call = (fn, o) => JSON.parse(fn(JSON.stringify(o)));
const NEW = { rate: '3', cashbackModel: 'rate+basic', cap: '20000', minSpend: '', maxSpend: '', items: '好樂迪KTV,KKTIX', category: '娛樂', conditions: '需登錄', registerLink: 'https://bank/reg', periodStart: '2027/1/1', periodEnd: '2027/6/30' };

console.log('1. 選單與讀表');
{
  const site = Buffer.from(JSON.stringify({ quickSearchOptions: [{ merchants: ['蝦皮購物'] }], termAliases: [{ term: 'LINE Pay', aliases: ['linepay'] }], payments: [{ name: 'LINE Pay' }], cards: [{ id: 'old' }] })).toString('base64');
  const s = load(fresh(), { fetch: () => ({ code: 200, text: site }), props: { GEMINI_API_KEY: 'k' } });
  try { s.onOpen(); } catch (e) { /* buildAutomationMenu_ 不在這個專案 */ }
  ok(s.menus[0].items.indexOf('openActivityWriter') >= 0, '選單出現活動快寫');
  const d = JSON.parse(s.activityWriterInit());
  eq(d.cards.map(c => c.id), ['card-a', 'card-b'], '卡片讀自表上（不是線上 cards.data 的 cards）');
  eq(d.cards[0].slots.map(x => x.n + ':' + x.empty), ['1:false', '2:true', '3:true'], '槽位空不空');
  eq(d.cards[0].cashbackRates[0], { slot: 1, rate: 2.5, items: ['威秀影城', '誠品書店'], cashbackModel: 'rate+basic', category: '藝文', period: '2026/1/1~2026/12/31' }, '既有活動');
  eq([d.newCardholderPromos.length, d.cardApplyCtas['card-a'].link, d.payments[0].name, d.host.hasAiKey], [2, 'https://apply/a', 'LINE Pay', true], '新戶活動、申辦連結、線上詞庫、金鑰狀態');
  const s2 = load(fresh());
  const d2 = JSON.parse(s2.activityWriterInit());
  ok(d2.cards.length === 2 && d2.payments.length === 0 && /讀不到線上/.test(d2.host.vocabNote), '線上 cards.data 讀不到也能用，只是詞庫少一塊');
}

console.log('2. 一般活動寫進槽位');
{
  const sh = fresh(), s = load(sh), g = sh['Cards Data'];
  let r = call(s.activityWriterSaveRate, { id: 'card-a', slot: 2, fields: NEW, overwrite: false });
  ok(r.ok, '寫進空槽 ' + JSON.stringify(r).slice(0, 200));
  const at = f => g.grid[1][CH.indexOf(f + '_2')];
  eq([at('rate'), at('cap'), at('items'), at('cashbackModel'), at('periodEnd'), at('registerLink')], [3, 20000, '好樂迪KTV,KKTIX', 'rate+basic', '2027/6/30', 'https://bank/reg'], '依欄名寫入、數字欄是數字');
  eq(g.grid[1][CH.indexOf('rate_1')], 2.5, '沒碰到別的槽');
  const pe = colName(CH.indexOf('periodEnd_2') + 1) + '2', ps = colName(CH.indexOf('periodStart_2') + 1) + '2';
  eq(g.formulas['2,' + (CH.indexOf('daysRemaining_2') + 1)], '=IF(ISBLANK(' + pe + '),"",' + pe + '-TODAY())', '補 daysRemaining 公式（指到同槽的 periodEnd）');
  eq(g.formulas['2,' + (CH.indexOf('period_2') + 1)], '=IF(OR(ISBLANK(' + ps + '),ISBLANK(' + pe + ')),"",TEXT(' + ps + ',"yyyy/m/d")&"~"&TEXT(' + pe + ',"yyyy/m/d"))', '補 period 公式');

  // 有內容的槽：沒說要覆蓋就擋
  r = call(s.activityWriterSaveRate, { id: 'card-a', slot: 1, fields: NEW, overwrite: false });
  ok(!r.ok && r.needConfirm && g.grid[1][CH.indexOf('rate_1')] === 2.5, '有內容的槽、沒確認 → 不寫');
  r = call(s.activityWriterSaveRate, { id: 'card-a', slot: 1, fields: NEW, overwrite: true });
  ok(r.ok && g.grid[1][CH.indexOf('rate_1')] === 3 && g.grid[1][CH.indexOf('category_1')] === '娛樂', '確認後覆蓋');
  eq(g.formulas['2,' + (CH.indexOf('period_1') + 1)], '=IF(…)', '既有的 period 公式不動');

  // 驗證與缺欄
  r = call(s.activityWriterSaveRate, { id: 'card-b', slot: 1, fields: Object.assign({}, NEW, { periodEnd: '2026/1/1' }), overwrite: false });
  ok(!r.ok && /periodEnd|結束/.test(r.message) && sh['Cards Data'].grid[2][CH.indexOf('rate_1')] === '', '結束早於開始 → 整筆擋下、什麼都沒寫：' + r.message);
  r = call(s.activityWriterSaveRate, { id: 'card-b', slot: 3, fields: NEW, overwrite: false });
  ok(!r.ok && /registerLink_3/.test(r.message), '表上沒有的欄位 → 講清楚缺哪一欄');
  r = call(s.activityWriterSaveRate, { id: 'card-b', slot: 9, fields: NEW, overwrite: false });
  ok(!r.ok && /rate_9/.test(r.message), '不存在的槽');
}

console.log('3. 新戶活動新增一列');
{
  const sh = fresh(), s = load(sh), g = sh['New Cardholder Promos'];
  const V = { id: 'card-a', promo_types: '回饋加碼', new_customer_definition: '保險新戶', new_customer_summary: '保險新戶刷首筆保費，符合條件享最高8%', promo_condition: '①a\n②b',
    period_start: '2026/11/1', period_end: '2026/12/31', bonus_rate: '0.06', bonus_merchants: '保險,保費', bonus_cap: '8333.33', active: 'TRUE',
    apply_cta_text: '申辦 A', apply_cta_link: 'https://apply/a', notes: '', link: '' };
  let r = call(s.activityWriterSavePromo, { id: 'card-a', values: V });
  ok(r.ok && r.rowNumber === 3, '新增成功，插在同卡最後一列下面 ' + JSON.stringify(r).slice(0, 200));
  const n = g.grid[2], at = f => n[PH.indexOf(f)];
  eq([at('id'), at('bonus_rate'), at('bonus_cap'), at('bonus_merchants'), at('active'), at('period_end')], ['card-a', 0.06, 8333.33, '保險,保費', true, '2026/12/31'], '新列內容（bonus_rate 是數字不是文字）');
  eq([at('apply_cta_text'), at('apply_cta_link')], ['', ''], '這張卡已有申辦按鈕 → 新列不重複寫');
  eq(g.grid[3][0], 'card-b', '別張卡被往下推、內容不變');
  eq(g.grid.length, 4, '只多一列');

  r = call(s.activityWriterSavePromo, { id: 'card-a', values: Object.assign({}, V, { period_end: '2026/1/1' }) });
  ok(!r.ok && g.grid.length === 4, '驗證不過 → 不插列：' + r.message);
  r = call(s.activityWriterSavePromo, { id: 'card-a', values: Object.assign({}, V, { apply_cta_link: 'https://other' }) });
  ok(r.ok && /apply_cta_link 沒有寫入/.test(r.message), '改了申辦連結 → 寫入活動、但提醒連結要到編輯器改');

  const sh2 = fresh(), s3 = load(sh2);
  sh2['New Cardholder Promos'].grid.splice(1, 1);   // card-a 沒有任何列
  r = call(s3.activityWriterSavePromo, { id: 'card-a', values: V });
  ok(r.ok && sh2['New Cardholder Promos'].grid[2][PH.indexOf('apply_cta_link')] === 'https://apply/a', '這張卡還沒有列 → 申辦按鈕跟著寫進去');
}

console.log('4. AI（假回應）');
{
  let s = load(fresh());
  ok(/GEMINI_API_KEY/.test(call(s.activityWriterAi, { system: 's', user: 'u', schema: {} }).message), '沒金鑰 → 說明去哪設');
  let n = 0;
  s = load(fresh(), { props: { GEMINI_API_KEY: 'k', ACTIVITY_WRITER_MODELS: 'm1,m2' },
    fetch: (url) => (++n === 1 ? { code: 429, text: '' } : { code: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"promos":[]}' }] } }] }) }) });
  const r = call(s.activityWriterAi, { system: 's', user: 'u', schema: {} });
  eq([r.ok, r.model, r.data], [true, 'm2', { promos: [] }], '第一個模型 429 → 換下一個');
  ok(s.fetched.every(f => f.url.indexOf('k') < 0) && s.fetched[0].o.headers['x-goog-api-key'] === 'k', '金鑰放標頭、不放網址');
}

console.log('5. 自動部署：HTML 檔與剛建立的空檔');
{
  const D = require('../apps-script-deploy/deploy.js');
  const files = ['activity-writer.gs', 'ActivityWriter.html'];
  const online = [{ name: 'activity-writer', type: 'SERVER_JS', source: 'function myFunction() {\n\n}\n' }, { name: 'ActivityWriter', type: 'HTML', source: '' },
    { name: 'cards-export', type: 'SERVER_JS', source: 'KEEP' }, { name: 'appsscript', type: 'JSON', source: '{}' }];
  const plan = D.buildPlan(online, files, f => 'NEW ' + f, () => new Set());
  eq([plan.errors, plan.items.map(i => i.online + ':' + i.status)], [[], ['activity-writer:update', 'ActivityWriter:update']], '空檔當成可更新（不算被手改）、HTML 對得到');
  const out = D.applyPlan(online, plan);
  eq(out.map(f => f.name + '|' + f.type + '|' + f.source), ['activity-writer|SERVER_JS|NEW activity-writer.gs', 'ActivityWriter|HTML|NEW ActivityWriter.html', 'cards-export|SERVER_JS|KEEP', 'appsscript|JSON|{}'], '只動清單裡的兩支');
  const drift = D.buildPlan([{ name: 'activity-writer', type: 'SERVER_JS', source: 'function hand() {}' }, online[1]], files, f => 'NEW', () => new Set());
  eq(drift.items[0].status, 'drift', '線上有別的內容 → 照舊擋下');
  const miss = D.buildPlan([online[0]], files, f => 'NEW', () => new Set());
  ok(miss.errors.length === 1 && /HTML/.test(miss.errors[0]), '線上沒有 HTML 檔 → 報錯、不自動新建');
  eq(D.buildPlan([{ name: '權益解析-新戶-benefits-parser', type: 'SERVER_JS', source: 'x' }, { name: '權益解析-新卡-card-benefits-parser', type: 'SERVER_JS', source: 'y' }],
    ['benefits-parser.gs', 'card-benefits-parser.gs'], f => f, f => new Set(['x', 'y'])).items.map(i => i.file + '←' + i.online),
    ['benefits-parser.gs←權益解析-新戶-benefits-parser', 'card-benefits-parser.gs←權益解析-新卡-card-benefits-parser'], '原本的檔名對照規則沒變');
}

console.log('6. 生成檔');
{
  const html = fs.readFileSync(path.join(root, 'apps-script', 'ActivityWriter.html'), 'utf8');
  ok(!/<script src=/.test(html) && /PMCWriter/.test(html) && /activityWriterSaveRate/.test(html), '解析器與介面都併進同一個檔、沒有外部 script');
}

console.log(failed ? `\n❌ ${passed} 通過、${failed} 失敗` : `\n✅ ${passed} 通過、0 失敗`);
process.exit(failed ? 1 : 0);
