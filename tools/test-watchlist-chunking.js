// checkWatchlist 分段執行的驗證腳本（2026-09-11）
//
// 跑法：node tools/test-watchlist-chunking.js  （零依賴，不用 npm install）
// 什麼時候要跑：改了 apps-script/watchlist-monitor.gs 的 checkWatchlist 迴圈、
//              兩道煞車（maxRunSeconds / maxRowsPerRun）、進度游標、或接力觸發器邏輯。
//
// 做法：把 Apps Script 的服務（SpreadsheetApp / PropertiesService / ScriptApp /
//      UrlFetchApp / MailApp）全部換成假的，再把 watchlist-monitor.gs 整份 eval 進來實跑。
//      callGemini_ 不存在（那支在 benefits-parser.gs），所以 classifyDiff_ 會回 null、
//      走「AI 未分類」分支——這裡要驗的是分段與進度，不是 AI 判讀。
//
// 守住的不變式：
//   1. 不論怎麼分段，每一列**剛好抓一次**（重抓＝白燒 Jina 額度）
//   2. 一輪跑完後指令碼屬性要全清乾淨（留著舊游標會讓下一輪靜悄悄跳過清單前半段）
//   3. 一次性接力觸發器不留殘骸；站長手設的**每週觸發器任何情況都不能被刪掉**
//
// ⚠️ 這是模擬不是真環境：假 Sheet 只實作程式用得到的方法，所以會印一行
//    「markInboxRoundEnd_ 失敗」（缺 SpreadsheetApp.BorderStyle）——預期中的，真環境沒這問題。
//    同理，依賴 setValues 的「寫進變動通知幾列」數字不準，刻意沒拿來當斷言。

'use strict';
const fs = require('fs');
const path = require('path');


// ---- 假的 Apps Script 服務 ----
const store = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); },
  deleteProperty: k => { delete store[k]; }
})};

let triggers = [], seq = 0, scheduled = [];
global.ScriptApp = {
  getProjectTriggers: () => triggers.slice(),
  deleteTrigger: t => { triggers = triggers.filter(x => x !== t); },
  newTrigger: fn => ({ timeBased: () => ({ after: ms => ({ create: () => {
    const t = { _id: 'trig' + (++seq), fn, getUniqueId: () => t._id, getHandlerFunction: () => fn };
    triggers.push(t); scheduled.push({ id: t._id, ms }); return t;
  }})})})
};
// 站長手設的每週觸發器：全程都不該被刪掉
const weekly = { _id: 'WEEKLY', getUniqueId: () => 'WEEKLY', getHandlerFunction: () => 'checkWatchlist' };
triggers.push(weekly);

const HEADERS = ['card_id','bank','url','last_snapshot','last_checked','active'];
const ROWS = 8;
const grid = [HEADERS.slice()];
for (let i = 1; i <= ROWS; i++) grid.push(['card' + i, '銀行' + i, 'https://example.com/' + i, '舊內容 回饋 1% ' + 'x'.repeat(400), '', 'TRUE']);

const inbox = [];
const mkSheet = (name, data) => ({
  getName: () => name,
  getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
  getRange: (r, c, nr, nc) => ({
    setValue: v => { data[r-1][c-1] = v; },
    setValues: () => {}, setFontWeight: () => {}, setBackground: () => {},
    setBorder: () => {}, getValues: () => [[]], setWrap: () => {}
  }),
  getLastRow: () => data.length, getLastColumn: () => (data[0] || []).length,
  appendRow: r => data.push(r), setColumnWidth: () => {}, setFrozenRows: () => {},
  getMaxColumns: () => 30, insertColumnsAfter: () => {}
});
const sheets = { '1-監控清單': mkSheet('1-監控清單', grid), '2-變動通知': mkSheet('2-變動通知', inbox) };
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = mkSheet(n, [])),
})};

let fetches = 0;
global.UrlFetchApp = { fetch: () => { fetches++;
  const t0 = Date.now(); while (Date.now() - t0 < 300) {}          // 每列假裝花 0.3 秒
  return { getResponseCode: () => 200, getContentText: () => '舊內容 回饋 1% ' + 'x'.repeat(400) + ' 新增加碼 5% 回饋上限 300 元' };
}};
const mails = [];
global.MailApp = { sendEmail: (to, subject, body) => mails.push({ subject, body }) };
global.Session = { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) };
global.Utilities = { sleep: () => {} };


const DRIVER = "const reset = () => { for (let i = 1; i <= ROWS; i++) grid[i][3] = '舊內容 回饋 1% ' + 'x'.repeat(400);\n  fetches = 0; mails.length = 0; scheduled.length = 0; Object.keys(store).forEach(k => delete store[k]);\n  triggers = triggers.filter(t => t.getUniqueId() === 'WEEKLY'); };\nconst extraTriggers = () => triggers.filter(t => t.getUniqueId() !== 'WEEKLY').length;\nconst ok = (label, got, want) => console.log((String(got) === String(want) ? '  ✅ ' : '  ❌ ') + label + ': ' + got + ' (應為 ' + want + ')');\n\nconsole.log('=== 1. 不分段基準（等同改動前）===');\nreset(); MONITOR_CONFIG.maxRunSeconds = 9999; MONITOR_CONFIG.maxRowsPerRun = 0;\ncheckWatchlist();\nok('fetch 次數', fetches, ROWS); ok('信件數', mails.length, 1);\nok('殘留觸發器', extraTriggers(), 0); ok('殘留狀態', JSON.stringify(store), '{}');\n\nconsole.log('=== 2. 看錶煞車 → 自動接力（2 分鐘後）===');\nreset(); MONITOR_CONFIG.maxRunSeconds = 0.9; MONITOR_CONFIG.maxRowsPerRun = 0;\nlet n = 0; checkWatchlist();\nwhile (scheduled.length && n++ < 20) { scheduled.shift(); checkWatchlist(); }\nok('fetch 次數（無重抓）', fetches, ROWS); ok('有分段（>=2 段）', n + 1 >= 2, true);\nok('殘留觸發器', extraTriggers(), 0); ok('殘留狀態', JSON.stringify(store), '{}');\n\nconsole.log('=== 3. 列數節流 maxRowsPerRun=3：不排接力、等下次排程 ===');\nreset(); MONITOR_CONFIG.maxRunSeconds = 9999; MONITOR_CONFIG.maxRowsPerRun = 3;\ncheckWatchlist();\nok('第 1 次排程抓了', fetches, 3);\nok('沒有排接力觸發器', scheduled.length, 0);\nok('游標已存 (mode=cap)', store.WATCHLIST_RESUME_MODE, 'cap');\nconst f1 = fetches;\nstore.WATCHLIST_RESUME_AT = String(Date.now() - 3 * 24 * 3600 * 1000);   // 三天後（第二個排程日）\ncheckWatchlist();\nok('第 2 次排程抓了', fetches - f1, 3);\nconst f2 = fetches;\nstore.WATCHLIST_RESUME_AT = String(Date.now() - 4 * 24 * 3600 * 1000);\ncheckWatchlist();\nok('第 3 次排程抓了', fetches - f2, 2);\nok('總 fetch（零重抓）', fetches, ROWS);\nok('跑完後狀態清空', JSON.stringify(store), '{}');\nok('全程沒排過接力觸發器', extraTriggers(), 0);\n\nconsole.log('=== 4. cap 游標的存活期（10 天）===');\nreset(); MONITOR_CONFIG.maxRowsPerRun = 3; checkWatchlist();\nstore.WATCHLIST_RESUME_AT = String(Date.now() - 11 * 24 * 3600 * 1000);   // 超過 10 天＝停用太久\nconst before = fetches; checkWatchlist();\nok('過期 cap 游標 → 從頭跑', fetches - before, 3);\n\nconsole.log('=== 5. 兩道煞車同時在：列數先到 ===');\nreset(); MONITOR_CONFIG.maxRunSeconds = 9999; MONITOR_CONFIG.maxRowsPerRun = 2;\ncheckWatchlist();\nok('停止原因', store.WATCHLIST_RESUME_MODE, 'cap'); ok('抓了', fetches, 2);\n\nconsole.log('=== 6. 兩道煞車同時在：時間先到 ===');\nreset(); MONITOR_CONFIG.maxRunSeconds = 0.9; MONITOR_CONFIG.maxRowsPerRun = 99;\ncheckWatchlist();\nok('停止原因', store.WATCHLIST_RESUME_MODE, 'clock'); ok('有排接力', scheduled.length, 1);\n\nconsole.log('=== 7. 連續看錶段數上限（cap 段不該算進去）===');\nreset(); MONITOR_CONFIG.maxRunSeconds = 0.4; MONITOR_CONFIG.maxRowsPerRun = 0;\nMONITOR_CONFIG.maxResumeChunks = 2;\nlet m = 0; checkWatchlist();\nwhile (scheduled.length && m++ < 20) { scheduled.shift(); checkWatchlist(); }\nok('段數', m + 1, 2); ok('殘留觸發器', extraTriggers(), 0);\nok('殘留狀態', JSON.stringify(store), '{}');\nconsole.log('  停手說明：' + mails[mails.length - 1].body.split('\\n')[1].trim());\nconsole.log('=== 8. 每週觸發器全程沒被誤刪 ===');\nok('WEEKLY 還在', triggers.some(t => t.getUniqueId() === 'WEEKLY'), true);\n";

// ---- 載入受測檔並實跑 ----
const SRC = path.join(__dirname, '..', 'apps-script', 'watchlist-monitor.gs');
let failed = 0;
const origLog = console.log;
console.log = function () {
  if (String(arguments[0]).indexOf('\u274c') === 0 || String(arguments[0]).indexOf('  \u274c') === 0) failed++;
  origLog.apply(console, arguments);
};

eval(fs.readFileSync(SRC, 'utf8') + '\n' + DRIVER);

console.log = origLog;
console.log(failed ? '\n\u274c ' + failed + ' 項未通過' : '\n\u2705 全部通過');
process.exit(failed ? 1 : 0);
