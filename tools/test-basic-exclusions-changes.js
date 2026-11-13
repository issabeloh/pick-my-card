// 一般消費排除「官網變動 → 逐項修改」流程測試（2026-10-13）
//
// 跑法：node tools/test-basic-exclusions-changes.js  （零依賴）
// 什麼時候要跑：改了 basic-exclusions-extractor.gs 第 ③ 段（分析／套用到待審核）、寫回視窗的改寫顯示，
//              或 watchlist-monitor.gs 裡呼叫一般消費排除分析的地方。
// 做法：把 benefits-parser.gs、watchlist-monitor.gs、basic-exclusions-extractor.gs 整份載進來，
//      Sheets／Gemini／Mail 全換成假的。會印一行「markInboxRoundEnd_ 失敗」（假環境缺 BorderStyle），預期中的。
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..', 'apps-script') + '/';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✘', m); } };

function makeSheet(name, rows) {
  const sh = { name, rows, maxCols: 30, getName: () => name,
    getDataRange() { return { getValues: () => sh.rows.map(r => r.slice()) }; },
    getLastRow() { return sh.rows.length; },
    getLastColumn() { return Math.max(...sh.rows.map(r => r.length), 1); },
    getMaxColumns() { return sh.maxCols; }, insertColumnsAfter(a, n) { sh.maxCols += n; },
    getRange(r, c, nr, nc) { nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues(v) { v.forEach((row, i) => { sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []; row.forEach((x, j) => sh.rows[r - 1 + i][c - 1 + j] = x); }); return this; },
        setValue(x) { sh.rows[r - 1] = sh.rows[r - 1] || []; sh.rows[r - 1][c - 1] = x; return this; },
        setBackground() { return this; }, setBorder() { return this; } }; },
    appendRow(row) { sh.rows.push(row.slice()); }, setFrozenRows() {}, setColumnWidth() {} };
  return sh;
}

function load(env) {
  const src = ['benefits-parser.gs', 'watchlist-monitor.gs', 'basic-exclusions-extractor.gs'].map(f => fs.readFileSync(R + f, 'utf8')).join('\n');
  const fn = new Function('env', `
    const { SpreadsheetApp, PropertiesService, MailApp, Utilities, Session, ScriptApp, UrlFetchApp } = env;
    // Logger：2026-10-14 benefits-parser 加了「統一詞」(pmcTermMap_)，假環境讀不到那張表時會 Logger.log，
    // 沒有這個假的就整支測試當掉（2026-11-03 發現：那之後這支測試一直是壞的）
    const Logger = env.Logger || { log: function () {} };
    ${src}
    return { getCardsSheet_: () => env.cards,
      run: (name, ...a) => eval(name)(...a), set: (k, v) => { eval(k + ' = v'); } };
  `);
  return fn(env);
}

function env(opts) {
  const alerts = [], toasts = [], mails = [];
  const ui = { alert: (t, m, b) => { alerts.push([t, m]); return opts.answer || 'OK'; }, ButtonSet: { OK: 'ok', OK_CANCEL: 'okc' }, Button: { OK: 'OK' } };
  const ss = { sheets: opts.sheets, getSheetByName: n => opts.sheets[n] || null,
    insertSheet: n => (opts.sheets[n] = makeSheet(n, [])), toast: (m) => toasts.push(m) };
  return { alerts, toasts, mails,
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ss, openById: () => ({ getSheetByName: () => opts.cards }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ GEMINI_API_KEY: 'x', CARDS_SPREADSHEET_ID: 'y' })[k] || null, setProperty() {}, deleteProperty() {} }) },
    MailApp: { sendEmail: (to, s, b) => mails.push({ s, b }) },
    Utilities: { formatDate: () => '2026/10/13 12:00', sleep() {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'me@x' }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => ({ getUniqueId: () => 't' }) }) }) }), deleteTrigger() {} },
    UrlFetchApp: {}, cards: opts.cards };
}

const REVIEW_H = ['核准', '解析時間', 'card_id', 'bank', '來源網址', 'basicExclusions', 'AI想問的問題', '原文引用'];
const cardsSheet = () => makeSheet('Cards Data', [
  ['id', 'name', 'basicExclusions'],
  ['ubot-green', '聯邦綠卡', '信用卡年費,學費, 小額支付特約商店,E政府服務平台,'],
  ['ubot-jiho', '聯邦吉鶴', '信用卡年費,學費, 小額支付特約商店,E政府服務平台,'],
  ['tbb-chaotian', '企銀', '學費,政府規費']
]);

// ── 1. 解析：刪行、改詞、看不懂的行
{
  const e = env({ sheets: {}, cards: cardsSheet() }); const G = load(e);
  const p = G.run('basicExParseChangeCell_', '⚠ 大改版，建議整份重抽\n▸ ubot-green, ubot-jiho\n＋ 新增：手搖飲料店｜原文：…\n－ 刪除：E政府服務平台\n✎ 改寫：學費 → 學費、學雜費｜原文：學雜費\n亂打一行\n（AI 備註：x）');
  ok(p.ops.length === 3, '解析出 3 個動作');
  ok(p.ops[0].kind === 'add' && p.ops[0].item === '手搖飲料店' && p.ops[0].ids.join() === 'ubot-green,ubot-jiho', '新增行＋卡片');
  ok(p.ops[2].kind === 'rename' && p.ops[2].to.join() === '學費,學雜費', '改寫成兩項');
  ok(p.bad.length === 1 && p.bad[0] === '亂打一行', '看不懂的行');
}

// ── 2. 逐項套用保留原格式
{
  const e = env({ sheets: {}, cards: cardsSheet() }); const G = load(e);
  const raw = '信用卡年費,學費, 小額支付特約商店,E政府服務平台,';
  let r = G.run('basicExApplyOp_', raw, { kind: 'add', item: '手搖飲料店' });
  ok(r.value === '信用卡年費,學費, 小額支付特約商店,E政府服務平台,手搖飲料店,', '新增接在最後、保留結尾逗號：' + r.value);
  r = G.run('basicExApplyOp_', raw, { kind: 'remove', item: '小額支付特約商店' });
  ok(r.value === '信用卡年費,學費,E政府服務平台,', '刪除只拿掉那一段：' + r.value);
  r = G.run('basicExApplyOp_', raw, { kind: 'rename', item: '學費', to: ['學費', '學雜費'] });
  ok(r.value === '信用卡年費,學費,學雜費, 小額支付特約商店,E政府服務平台,', '改寫插在原位：' + r.value);
  r = G.run('basicExApplyOp_', raw, { kind: 'remove', item: '不存在' });
  ok(!r.ok, '找不到要回報');
  r = G.run('basicExApplyOp_', raw, { kind: 'add', item: '學費' });
  ok(r.ok && r.value === raw, '已存在不重複加');
}

// ── 3. 套用到待審核：全部照做 → 不跳視窗、寫覆蓋
{
  const inboxH = ['日期時間', 'card_id', '銀行', '狀態', '網址', '一般消費排除修改', '一般消費排除確認', '變動段落'];
  const inbox = makeSheet('2-變動通知', [inboxH,
    ['t', 'ubot-green,ubot-jiho', '聯邦', '待解析', 'https://ubot', '▸ ubot-green, ubot-jiho\n＋ 新增：手搖飲料店｜原文：…\n✎ 改寫：學費 → 學費、學雜費', 'V', '＋ x'],
    ['t', 'tbb-chaotian', '企銀', '待解析', 'https://tbb', '▸ tbb-chaotian\n－ 刪除：政府規費', '', '－ y']]);
  const review = makeSheet('5-待審核（一般消費排除）', [REVIEW_H,
    ['已寫回 2026/10/12', 'd', 'ubot-green', '聯邦', 'https://ubot', '舊內容', '', 'ev']]);
  const e = env({ sheets: { '2-變動通知': inbox, '5-待審核（一般消費排除）': review }, cards: cardsSheet() }); const G = load(e);
  G.run('applyBasicExclusionChanges');
  ok(e.alerts.length === 0, '全部照做不跳視窗（跳了：' + JSON.stringify(e.alerts) + '）');
  ok(e.toasts.length === 1 && /2 張卡/.test(e.toasts[0]), 'toast 提示 2 張卡：' + e.toasts[0]);
  const g = review.rows.find(r => r[2] === 'ubot-green');
  ok(g[0] === '覆蓋', '既有列核准改成覆蓋');
  ok(g[5] === '信用卡年費,學費,學雜費, 小額支付特約商店,E政府服務平台,手搖飲料店,', '以正式表為底套用（不是舊內容）：' + g[5]);
  ok(/✎ 改寫：學費 → 學費、學雜費/.test(g[6]), '改寫記在 AI想問的問題');
  const j = review.rows.find(r => r[2] === 'ubot-jiho');
  ok(j && j[0] === '覆蓋' && j[4] === 'https://ubot', '沒有列的卡新增一列');
  ok(!review.rows.find(r => r[2] === 'tbb-chaotian'), '沒填 V 的列不套用');
  ok(/^已套用/.test(inbox.rows[1][6]) && inbox.rows[2][6] === '', '確認欄改成已套用');

  // 再按一次：沒有 V → 提示
  G.run('applyBasicExclusionChanges');
  ok(e.alerts.length === 1 && /沒有在/.test(e.alerts[0][0]), '已套用的不再套用');
}

// ── 4. 有找不到／看不懂的行 → 跳視窗；按取消什麼都不動
{
  const inboxH = ['網址', '銀行', '一般消費排除修改', '一般消費排除確認'];
  const mk = () => makeSheet('2-變動通知', [inboxH,
    ['https://ubot', '聯邦', '▸ ubot-green\n－ 刪除：E政府服務平臺\n＋ 新增：手搖飲料店\n隨便寫', 'v']]);
  for (const answer of ['CANCEL', 'OK']) {
    const inbox = mk(); const review = makeSheet('5-待審核（一般消費排除）', [REVIEW_H]);
    const e = env({ sheets: { '2-變動通知': inbox, '5-待審核（一般消費排除）': review }, cards: cardsSheet(), answer }); const G = load(e);
    G.run('applyBasicExclusionChanges');
    ok(e.alerts.length === 1 && /2 行沒辦法照做/.test(e.alerts[0][0]) && /E政府服務平臺/.test(e.alerts[0][1]) && /隨便寫/.test(e.alerts[0][1]), answer + '：視窗列出找不到與看不懂的行');
    if (answer === 'CANCEL') ok(review.rows.length === 1 && inbox.rows[1][3] === 'v', '取消＝全部不動');
    else ok(review.rows.length === 2 && /手搖飲料店,$/.test(review.rows[1][5]) && /跳過 2 行/.test(inbox.rows[1][3]), '確定＝能做的照做、標跳過幾行：' + inbox.rows[1][3]);
  }
}

// ── 5. 寫回視窗把改寫列成 A → B
{
  const review = makeSheet('5-待審核（一般消費排除）', [REVIEW_H,
    ['覆蓋', 'd', 'ubot-green', '聯邦', 'u', '信用卡年費,學費,學雜費, 小額支付特約商店,E政府服務平台,手搖飲料店,', '【官網變動套用】\n✎ 改寫：學費 → 學費、學雜費\n＋ 新增：手搖飲料店', '']]);
  const cards = makeSheet('Cards Data', [['id', 'basicExclusions'], ['ubot-green', '信用卡年費,學費, 小額支付特約商店,E政府服務平台,']]);
  const e = env({ sheets: { '5-待審核（一般消費排除）': review }, cards, answer: 'CANCEL' }); const G = load(e);
  G.run('applyBasicExclusionsToCardsData');
  const msg = e.alerts[0] && e.alerts[0][1] || '';
  ok(/新增：學雜費、手搖飲料店|新增：手搖飲料店/.test(msg), '寫回視窗有新增：' + msg);
  // 學費 → 學費、學雜費：學費沒被移除（還在），所以不算改寫，學雜費算新增——這是正確的
  const review2 = makeSheet('5-待審核（一般消費排除）', [REVIEW_H,
    ['覆蓋', 'd', 'ubot-green', '聯邦', 'u', '信用卡年費,學雜費,E政府服務平台', '✎ 改寫：學費 → 學雜費', '']]);
  const e2 = env({ sheets: { '5-待審核（一般消費排除）': review2 }, cards, answer: 'CANCEL' }); const G2 = load(e2);
  G2.run('applyBasicExclusionsToCardsData');
  const m2 = e2.alerts[0][1];
  ok(/改：學費 → 學雜費/.test(m2) && !/新增：學雜費/.test(m2), '一增一減合併成改寫：' + m2);
}

// ── 6. 監控：一般消費頁沒含關鍵字也算變動、當場分析、寫進修改欄、信裡附上
{
  const watchH = ['card_id', 'bank', 'url', 'watch_type', 'cards', 'last_snapshot', 'last_checked', 'active', 'keywords'];
  const oldText = '一般消費定義 排除項目如下：信用卡年費、學費、小額支付特約商店、E政府服務平台。'.repeat(3) + '其他說明文字很多很多很多很多。';
  const newText = oldText + '新增排除：手搖飲料店之各型態付款消費，含實體刷卡機與行動支付等方式皆不回饋。';
  const watch = makeSheet('1-監控清單', [watchH, ['', '聯邦', 'https://ubot', 'bank', 'ubot-green,ubot-jiho', oldText, '', 'TRUE', '不回饋消費項目']]);
  const inbox = makeSheet('2-變動通知', [['日期時間', 'card_id', '銀行', '實質變動', '所屬活動', 'AI摘要', '變動類型', '信心', '狀態', '公開摘要', '公開卡片', '公開／封存／刪除', '網址', '變動段落', '舊文字', '新文字']]);
  const e = env({ sheets: { '1-監控清單': watch, '2-變動通知': inbox }, cards: cardsSheet() }); const G = load(e);
  let calls = [];
  G.set('fetchPageText_', () => newText);
  G.set('callGemini_', (sys, user, schema) => {
    if (schema.properties.no_effect) { calls.push(user); return { no_effect: false, major: false, groups: [{ card_ids: ['ubot-green', 'ubot-jiho'], ops: [{ op: 'add', item: '手搖飲料店', evidence: '手搖飲料店之各型態付款消費' }, { op: 'remove', item: '不存在項目' }] }] }; }
    return { material: false, confidence: '高', change_types: ['改寫搬移'], summary: '文字調整', scope: '' };
  });
  G.run('checkWatchlist');
  ok(calls.length === 1 && /ubot-green：信用卡年費/.test(calls[0]), '分析時附上正式表名單');
  const h = inbox.rows[0];
  const ci = h.indexOf('一般消費排除修改'), co = h.indexOf('一般消費排除確認');
  ok(ci >= 0 && co >= 0, '自動補上兩欄');
  ok(inbox.rows.length === 2, '雖然 AI 判純文案，排除有影響仍寫進分頁');
  ok(/＋ 新增：手搖飲料店/.test(inbox.rows[1][ci]) && /不存在項目｜⚠ 名單裡找不到這項/.test(inbox.rows[1][ci]), '修改欄內容：' + inbox.rows[1][ci]);
  ok(e.mails.length === 1 && /【一般消費排除修改】/.test(e.mails[0].b) && /手搖飲料店/.test(e.mails[0].b), '信裡附上修改');
}

// ── 7. 監控：無影響＋純文案 → 不寫分頁
{
  const watchH = ['card_id', 'bank', 'url', 'cards', 'last_snapshot', 'active', 'keywords'];
  const oldText = '一般消費定義 排除項目如下：信用卡年費、學費。'.repeat(5);
  const watch = makeSheet('1-監控清單', [watchH, ['', '聯邦', 'https://ubot', 'ubot-green', oldText, 'TRUE', '一般消費']]);
  const inbox = makeSheet('2-變動通知', [['日期時間', 'card_id', '銀行', '實質變動', '狀態', '網址', '變動段落', '舊文字', '新文字']]);
  const e = env({ sheets: { '1-監控清單': watch, '2-變動通知': inbox }, cards: cardsSheet() }); const G = load(e);
  G.set('fetchPageText_', () => oldText + '本頁面最後更新時間調整說明文字，依本行官網公告為準並保留修改權利。');
  G.set('callGemini_', (sys, user, schema) => schema.properties.no_effect ? { no_effect: true, major: false, groups: [] }
    : { material: false, confidence: '高', change_types: ['改寫搬移'], summary: '更新時間', scope: '' });
  G.run('checkWatchlist');
  ok(inbox.rows.length === 1, '無影響的純文案不寫分頁');
}

// ── 8. 補分析待分析的列
{
  const inbox = makeSheet('2-變動通知', [['card_id', '銀行', '變動段落', '一般消費排除修改', '一般消費排除確認'],
    ['tbb-chaotian', '企銀', '－ 政府規費', '⏳ 待分析', ''], ['x', 'y', 'z', '＋ 新增：A', '']]);
  const e = env({ sheets: { '2-變動通知': inbox }, cards: cardsSheet() }); const G = load(e);
  G.set('callGemini_', () => ({ no_effect: false, major: false, groups: [{ card_ids: ['tbb-chaotian'], ops: [{ op: 'remove', item: '政府規費' }] }] }));
  G.run('analyzePendingBasicExclusionChanges');
  ok(inbox.rows[1][3] === '▸ tbb-chaotian\n－ 刪除：政府規費', '待分析補好：' + inbox.rows[1][3]);
  ok(inbox.rows[2][3] === '＋ 新增：A', '其他列不動');
}

// ── 9. 監控：長清單裡只加一個 5 字的項目也抓得到（舊做法：<8 字片段被丟、30 字門檻擋掉）
{
  const list = ['信用卡年費', '學費', '小額支付特約商店', 'E政府服務平台', '醫療費用', '各類稅款', '政府規費', '交通罰款', '停車費', '路邊停車費',
    '公用事業費用', '水費', '電費', '瓦斯費', '電信費', '預借現金', '餘額代償', '循環利息', '違約金', '各項手續費', '保費', '基金申購', '證券代銷', '虛擬資產'];
  const oldText = '本行一般消費定義排除項目如下：' + list.join('、') + '。其他說明。';
  const newText = '本行一般消費定義排除項目如下：' + list.slice(0, 12).concat(['手搖飲料店']).concat(list.slice(12)).join('、') + '。其他說明。';
  const watch = makeSheet('1-監控清單', [['bank', 'url', 'cards', 'last_snapshot', 'active', 'keywords'], ['聯邦', 'https://ubot', 'ubot-green', oldText, 'TRUE', '不回饋消費項目']]);
  const inbox = makeSheet('2-變動通知', [['日期時間', 'card_id', '銀行', '實質變動', '狀態', '網址', '變動段落', '舊文字', '新文字']]);
  const e = env({ sheets: { '1-監控清單': watch, '2-變動通知': inbox }, cards: cardsSheet() }); const G = load(e);
  let sent = '';
  G.set('fetchPageText_', () => newText);
  G.set('callGemini_', (sys, user, schema) => {
    if (schema.properties.no_effect) { sent = user; return { no_effect: false, major: false, groups: [{ card_ids: ['ubot-green'], ops: [{ op: 'add', item: '手搖飲料店' }] }] }; }
    return { material: true, confidence: '高', change_types: ['新增'], summary: 'x', scope: '' };
  });
  G.run('checkWatchlist');
  ok(/＋ 詞：手搖飲料店/.test(sent), '逐詞比對抓到 5 字的新項目並交給 AI');
  ok(inbox.rows.length === 2, '寫進變動通知');
  const t = G.run('exclusionTermDiff_', '更新日期：2026/10/06、瀏覽 1234 次。排除：學費、水費', '更新日期：2026/10/13、瀏覽 1301 次。排除：水費、學費');
  ok(t.lines.length === 0, '日期／數字變動、項目換順序都不算：' + t.lines.join(' '));
  const t2 = G.run('exclusionTermDiff_', '排除：學費、水費、停車場', '排除：學費、水費');
  ok(t2.removed.join() === '停車場', '刪掉 3 字項目抓得到');
}

// ── 10. 多模型備援（callGemini_，benefits-parser.gs）
{
  const e = env({ sheets: {}, cards: cardsSheet() });
  const calls = [];
  let behavior = {};
  e.UrlFetchApp = { fetch: (url) => {
    const m = url.match(/models\/([^:]+):/)[1]; calls.push(m);
    const code = behavior[m] || 200;
    return { getResponseCode: () => code,
      getContentText: () => code === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":"' + m + '"}' }] } }] }) : '{"error":"x"}' };
  } };
  const G = load(e);
  behavior = { 'gemini-3.8-flash': 404, 'gemini-3.6-flash': 429 };
  let r = G.run('callGemini_', 'sys', 'u', {});
  ok(r.ok === 'gemini-2.5-flash', '404、429 自動換到第三個：' + r.ok);
  calls.length = 0;
  r = G.run('callGemini_', 'sys', 'u', {});
  ok(r.ok === 'gemini-2.5-flash' && calls.join() === 'gemini-2.5-flash', '同一次執行不再試已知不存在／冷卻中的模型：' + calls.join());
  ok(/gemini-2\.5-flash ×2/.test(G.run('geminiUsageSummary_')) && /3\.8-flash 不存在/.test(G.run('geminiUsageSummary_')), '用量摘要：' + G.run('geminiUsageSummary_'));
  const G2 = load(e);
  behavior = Object.fromEntries(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].map(m => [m, 429]));
  let err = '';
  try { G2.run('callGemini_', 'sys', 'u', {}); } catch (x) { err = x.message; }
  ok(/所有 AI 模型都暫時不能用/.test(err), '全部用完時報錯：' + err.slice(0, 40));
  const G3 = load(e);
  behavior = { 'gemini-3.8-flash': 403 };
  err = '';
  try { G3.run('callGemini_', 'sys', 'u', {}); } catch (x) { err = x.message; }
  ok(/HTTP 403/.test(err), '金鑰錯這類錯誤不換模型、直接報錯');
  // 指令碼屬性 GEMINI_MODELS 蓋過內建清單
  const e4 = env({ sheets: {}, cards: cardsSheet() });
  e4.PropertiesService = { getScriptProperties: () => ({ getProperty: k => ({ GEMINI_API_KEY: 'x', GEMINI_MODELS: 'my-model, other-model' })[k] || null }) };
  e4.UrlFetchApp = e.UrlFetchApp; behavior = {};
  const G4 = load(e4); calls.length = 0;
  r = G4.run('callGemini_', 'sys', 'u', {});
  ok(r.ok === 'my-model', '指令碼屬性的模型清單優先');
}

// ── 11. 廣告排除改依 basicExclusions 判斷（card-benefits-parser.gs）
{
  const src = fs.readFileSync(R + 'card-benefits-parser.gs', 'utf8');
  const f = new Function(src + ';return adExclusionFromList_;')();
  let r = f('信用卡年費,Google產品或服務,Google Play');
  ok(r.known && r.google && !r.meta, 'Google產品或服務＝只排除 Google 廣告');
  r = f('學費,Facebook Ads');
  ok(r.meta && !r.google, 'Facebook Ads＝排除 Meta 廣告');
  r = f('學費,廣告費');
  ok(r.meta && r.google, '廣告費＝兩個都排除');
  r = f('學費,MCC 7311廣告服務');
  ok(r.meta && r.google, 'MCC 7311＝兩個都排除');
  r = f('學費,Google Play');
  ok(!r.meta && !r.google, 'Google Play 不算排除廣告');
  r = f('');
  ok(!r.known, '沒有名單＝無法判斷');
}

// ── 超商收單限制（規則 8m，2026-11-13）：非合作銀行的卡補 7-11、全家；AI 想刪／改寫這兩項一律不採用
{
  const e = env({ sheets: {}, cards: cardsSheet() }); const G = load(e);
  ok(G.run('basicExStoreNoAcceptItems_', 'hsbc-liveplus').join() === '7-11,全家', '滙豐卡該補 7-11、全家');
  ok(G.run('basicExStoreNoAcceptItems_', 'ubot-green').length === 0, '合作銀行不補');
  // 通則：表裡是合作銀行，不在表內一律補。拿 cards.data 每張卡的 bank 欄對一次，
  // 防「新建了合作銀行的卡、id 開頭沒加進表」（會被誤補超商）
  {
    const cards = JSON.parse(Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'cards.data'), 'utf8'), 'base64').toString('utf8')).cards;
    const PARTNER = { '7-11': ['國泰', '中信', '玉山', '台新', '富邦', '永豐', '聯邦', '新光', '華南'],
      '全家': ['國泰', '中信', '玉山', '台新', '富邦', '永豐', '聯邦', '新光'] };
    const wrong = [];
    cards.forEach(c => {
      const got = G.run('basicExStoreNoAcceptItems_', c.id);
      Object.keys(PARTNER).forEach(store => {
        const isPartner = PARTNER[store].some(b => String(c.bank || '').indexOf(b) >= 0);
        if (isPartner === (got.indexOf(store) >= 0)) wrong.push(c.id + '@' + store);
      });
    });
    ok(cards.length > 0 && wrong.length === 0, 'cards.data 每張卡的補法與 bank 欄一致（' + cards.length + ' 張）' + (wrong.length ? '：' + wrong.join(',') : ''));
    const add = cards.filter(c => G.run('basicExStoreNoAcceptItems_', c.id).length).map(c => c.id);
    ok(add.length === 14, '非合作銀行共 14 張：' + add.join(','));
  }
  const src = ['信用卡年費', '學費'];
  ok(G.run('basicExStoreAcceptFix_', src, 'hsbc-titanium').join() === '信用卡年費,學費,7-11,全家', '接在名單最後');
  ok(src.length === 2, '不改傳入的陣列（同一組 items 多張卡共用）');
  ok(G.run('basicExStoreAcceptFix_', ['全家', '學費'], 'HSBC-Titanium').join() === '全家,學費,7-11', '已有的不重複、id 大小寫不影響');
  ok(G.run('basicExStoreAcceptFix_', [], 'hsbc-titanium').length === 0, '空名單（這頁沒抽到）不補');
  ok(G.run('basicExStoreAcceptFix_', src, 'ubot-green').join() === '信用卡年費,學費', '合作銀行原樣');

  // 抽取寫待審核：滙豐列補上、同頁別家卡不補
  const review = makeSheet('5-待審核（一般消費排除）', [REVIEW_H]);
  G.run('basicExWriteReview_', review, { bank: '滙豐', url: 'u', candidates: ['hsbc-liveplus', 'ubot-green'] },
    [{ card_ids: ['hsbc-liveplus', 'ubot-green'], items: ['信用卡年費', '學費'], evidence: 'ev', needs_review: false, review_question: '' }]);
  const h = review.rows.find(r => r[2] === 'hsbc-liveplus'), u = review.rows.find(r => r[2] === 'ubot-green');
  ok(h && /7-11,全家$/.test(h[5]), '待審核的滙豐列有 7-11、全家：' + (h && h[5]));
  ok(u && !/7-11|全家/.test(u[5]), '同頁別家卡不補：' + (u && u[5]));

  // 變動分析：刪／改寫 7-11、全家被擋，其他動作照留
  const lists = { 'hsbc-liveplus': '學費,7-11,全家', 'ubot-green': '學費,7-11' };
  let t = G.run('basicExRenderChange_', { groups: [{ card_ids: ['hsbc-liveplus'], ops: [
    { op: 'remove', item: '7-11' }, { op: 'rename', item: '全家', to: ['全家便利商店'] }, { op: 'add', item: '保費' }] }] },
    ['hsbc-liveplus'], lists);
  ok(!/刪除：7-11|改寫：全家/.test(t) && /＋ 新增：保費/.test(t), '滙豐：刪 7-11／改寫全家被擋、新增照留：' + t);
  t = G.run('basicExRenderChange_', { groups: [{ card_ids: ['hsbc-liveplus'], ops: [{ op: 'remove', item: '7-11' }] }] }, ['hsbc-liveplus'], lists);
  ok(/^無影響/.test(t), '動作全被擋 → 無影響：' + t);
  t = G.run('basicExRenderChange_', { groups: [{ card_ids: ['ubot-green'], ops: [{ op: 'remove', item: '7-11' }] }] }, ['ubot-green'], lists);
  ok(/－ 刪除：7-11/.test(t), '合作銀行刪 7-11 不擋：' + t);
  t = G.run('basicExRenderChange_', { groups: [{ card_ids: ['dbs-eco'], ops: [{ op: 'remove', item: '全家' }] }] }, ['dbs-eco'], { 'dbs-eco': '學費,全家' });
  ok(/^無影響/.test(t), '通則：星展（非合作）刪全家也擋：' + t);
  ok(/8m\./.test(G.run('basicExRulesText_')), 'prompt 有規則 8m');
}

console.log(`\n${fail ? '❌' : '✅'} 一般消費排除變動流程：${pass} 通過、${fail} 失敗`);
process.exit(fail ? 1 : 0);
