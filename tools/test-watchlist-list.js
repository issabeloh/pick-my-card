// 名單頁（watch_type=list ＋ scope 欄）的驗證腳本（2026-11-13）
//
// 跑法：node tools/test-watchlist-list.js  （零依賴，不用 npm install）
// 什麼時候要跑：改了 apps-script/watchlist-monitor.gs 的名單頁分支、scopeText_、exclusionTermDiff_。
//
// 做法同 test-watchlist-chunking.js：Apps Script 服務全換成假的，整份 eval 進來實跑。
// 頁面文字取自 2026-11-13 的 7-11／全家真實快照（活動表只留一小段代表「會變的雜訊」）。
'use strict';
const fs = require('fs');
const path = require('path');

const store = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); },
  deleteProperty: k => { delete store[k]; }
})};
global.ScriptApp = { getProjectTriggers: () => [], deleteTrigger: () => {} };

const SEVEN = (list, promo) => '7-ELEVEN 支付工具 7-ELEVEN支援不同支付工具，提供您更多元便利的支付管道！ ' +
  '於7-ELEVEN門市可使用以下支付工具綁定銀行信用卡、帳戶支付： 信用卡 : ' + list + '、銀聯卡/國外卡。 ' +
  'OPEN錢包 : 國泰世華、中國信託、滙豐銀行、LINE Bank 簽帳金融卡。 icashPay : 台新銀行、中國信託。 ' +
  '--> 支付工具優惠活動 全部活動 信用卡 OPEN錢包綁 中信銀行 2026/10/1-2026/12/31 單筆消費滿$300，' +
  '享OPENPOINT10%回饋，每人每月回饋上限80點。' + promo + ' 活動網址> ' + '其他活動文字 '.repeat(60);
const FAMILY = (list, ver) => '更多全家 網站導覽 交通票卡 小額加值 服務範圍 悠遊卡 一卡通/服務 全部店鋪皆可使用 ' +
  '信用卡 皮包裡總是太多零錢好麻煩? 讓你輕鬆消費好便利 服務範圍 ' + list + ' 可代收項目 可支付代收項目 ' +
  '• 公共代收：路邊停車費、水費、電費 全盈+PAY 台新/中信 國泰/玉山 滙豐 全家 APP IOS：' + ver + ' 掃瞄立即下載 ' +
  '頁尾文字 '.repeat(40);
const L7 = '國泰世華、中國信託、玉山銀行、台新銀行、台北富邦銀行、永豐銀行、聯邦銀行、新光銀行、華南銀行';
const LF = '台新信用卡 中信信用卡 國泰世華信用卡 玉山信用卡 富邦信用卡 聯邦信用卡 永豐信用卡 新光信用卡';

const HEADERS = ['card_id','bank','url','watch_type','last_snapshot','last_checked','active','scope'];
const grid = [HEADERS.slice(),
  ['', '7-11', 'https://example.com/711', 'list', '', '', 'TRUE', '帳戶支付|支付工具優惠活動'],
  ['', '全家', 'https://example.com/family', 'list', '', '', 'TRUE', '讓你輕鬆消費好便利 服務範圍|可代收項目']];
const inbox = [];
const mkSheet = (name, data) => ({
  getName: () => name,
  getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
  getRange: (r, c) => ({ setValue: v => { data[r-1][c-1] = v; }, setValues: () => {}, setBackground: () => {},
    setBorder: () => {}, getValues: () => [[]], setFontWeight: () => {}, setWrap: () => {} }),
  getLastRow: () => data.length, getLastColumn: () => (data[0] || []).length,
  appendRow: r => data.push(r), setColumnWidth: () => {}, setFrozenRows: () => {},
  getMaxColumns: () => 30, insertColumnsAfter: () => {}
});
const sheets = { '1-監控清單': mkSheet('1-監控清單', grid), '2-變動通知': mkSheet('2-變動通知', inbox) };
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }) };

const pages = {};
global.UrlFetchApp = { fetch: url => ({ getResponseCode: () => 200, getContentText: () => pages[url] }) };
const mails = [];
global.MailApp = { sendEmail: (to, subject, body) => mails.push({ subject, body }) };
global.Session = { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) };
global.Utilities = { sleep: () => {} };

const DRIVER = `
const ok = (label, got, want) => console.log((String(got) === String(want) ? '  ✅ ' : '  ❌ ') + label + ': ' + got + ' (應為 ' + want + ')');
const U7 = 'https://example.com/711', UF = 'https://example.com/family';
const run = () => { mails.length = 0; checkWatchlist(); };
MONITOR_CONFIG.jinaFallback = false;

console.log('=== 1. 第一次：只存 scope 那一段當基準，不通知 ===');
pages[U7] = SEVEN(L7, ''); pages[UF] = FAMILY(LF, '8.21.0'); run();
ok('信件數', mails.length, 0);
ok('7-11 基準只含名單段', grid[1][4].indexOf('支付工具優惠活動') < 0 && grid[1][4].indexOf('華南銀行') > 0, true);
ok('全家基準', grid[2][4], LF);

console.log('=== 2. 名單沒變、活動表與 APP 版號變了：不通知 ===');
pages[U7] = SEVEN(L7, '(12月名額已額滿) 新活動 元大信用卡 單筆消費滿150元享10% 回饋');
pages[UF] = FAMILY(LF, '8.22.1'); run();
ok('信件數', mails.length, 0);

console.log('=== 3. 7-11 少一家（華南）、全家多一家（滙豐）：各報一筆 ===');
pages[U7] = SEVEN(L7.replace('、華南銀行', ''), '');
pages[UF] = FAMILY(LF + ' 滙豐信用卡', '8.22.1'); run();
ok('信件數', mails.length, 1);
const body = mails[0] ? mails[0].body : '';
ok('信裡有「消失：華南銀行」', body.indexOf('消失：華南銀行') >= 0, true);
ok('信裡有「新增：滙豐信用卡」', body.indexOf('新增：滙豐信用卡') >= 0, true);
ok('列名是名單頁', body.indexOf('7-11 名單頁') >= 0 && body.indexOf('全家 名單頁') >= 0, true);
ok('不寫進 2-變動通知', inbox.length, 0);
ok('基準已更新', grid[1][4].indexOf('華南') < 0, true);

console.log('=== 4. 同樣內容再跑一次：不重複通知 ===');
run(); ok('信件數', mails.length, 0);

console.log('=== 5. 網頁改版、找不到起訖：回報錯誤、基準不動 ===');
const keep = grid[1][4];
pages[U7] = '全新版面 '.repeat(50) + '沒有原本的標題'; run();
ok('有寄信', mails.length, 1);
ok('信裡說明找不到 scope', mails[0].body.indexOf('找不到 scope 欄指定的起點或終點') >= 0, true);
ok('基準沒被覆寫', grid[1][4], keep);

console.log('=== 6. 舊基準是整頁（填 scope 之前存的）：自動切同一段再比，不誤報 ===');
grid[1][4] = SEVEN(L7, '舊的活動文字'); pages[U7] = SEVEN(L7, '新的活動文字'); run();
ok('信件數', mails.length, 0);
ok('基準縮成名單段', grid[1][4].indexOf('支付工具優惠活動') < 0, true);
grid[1][4] = SEVEN(L7, ''); pages[U7] = SEVEN(L7 + '、兆豐銀行', ''); run();
ok('整頁舊基準也抓得到新增', mails.length === 1 && mails[0].body.indexOf('新增：兆豐銀行') >= 0, true);

console.log('=== 7. scopeText_ 細節 ===');
ok('空白多寡不影響', scopeText_('A  讓你輕鬆消費好便利服務範圍 X Y 可代收項目', '讓你輕鬆消費好便利 服務範圍|可代收項目'), 'X Y');
ok('留空＝整頁', scopeText_('abc', ''), 'abc');
ok('只有起點', scopeText_('abc def', 'abc|'), 'def');
ok('終點要在起點之後找', scopeText_('終 起 中間 終', '起|終'), '中間');
ok('找不到起點', scopeText_('abc', 'zzz|c'), null);
ok('找不到終點', scopeText_('abc', 'a|zzz'), null);
ok('特殊字元照字面', scopeText_('a (1+1) b [x] c', '(1+1)|[x]'), 'b');

console.log('=== 8. watch_type 解析 ===');
ok('list', resolveWatchType_('List', ''), 'list');
ok('亂填仍自動推斷', resolveWatchType_('foo', ''), 'bank');
`;

const SRC = path.join(__dirname, '..', 'apps-script', 'watchlist-monitor.gs');
let failed = 0;
const origLog = console.log;
console.log = function () {
  if (String(arguments[0]).indexOf('  ❌') === 0) failed++;
  origLog.apply(console, arguments);
};
eval(fs.readFileSync(SRC, 'utf8') + '\n' + DRIVER);
console.log = origLog;
console.log(failed ? '\n❌ ' + failed + ' 項未通過' : '\n✅ 全部通過');
process.exit(failed ? 1 : 0);
