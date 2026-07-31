/**
 * 「近期異動」資料層的機械驗收（issue #375 PR-1）。
 *
 * 用法：node tools/test-changelog.js   （退出碼 0 = 全過）
 *
 * 為什麼存在：Apps Script 的程式只有貼進 Google Sheets 才跑得起來，改完到發現寫壞
 * 中間隔著「貼回 Sheets → 手動按選單」。這支用 node 的 vm 把 SpreadsheetApp /
 * Utilities / Logger 幾個全域物件假造出來，直接在 repo 裡跑 `readChangelog()`、
 * `publishChangelog()`、`appendToInbox_()` 的真實程式碼，驗那些「看不到才最痛」的
 * 邊界：取最新 5 筆、由新到舊、active=FALSE 排除、工作表不存在時安全降級、
 * 多卡列自動拆列、重複按不重寫、驗證失敗的列不寫入。
 *
 * ⚠️ 這不是完整的 Apps Script 模擬器——stub 只做到夠這幾個函數用。改到別的函數時
 *    請照樣貼回 Sheets 實測，不要把這支的綠燈當成「線上一定會動」。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path').join(__dirname, '..', 'apps-script') + '/';

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? '✅ ' : '❌ ') + name + (cond ? '' : '  → ' + JSON.stringify(extra)));
  if (!cond) failures++;
}

// ---------- 假試算表 ----------
function makeSheet(name, rows, maxColumns) {
  return {
    name,
    rows,
    maxColumns: maxColumns || 26,
    getDataRange() {
      const width = this.rows.reduce((w, r) => Math.max(w, r.length), 0);
      return { getValues: () => this.rows.map(r => { const c = r.slice(); while (c.length < width) c.push(''); return c; }) };
    },
    getLastRow() { return this.rows.length; },
    getLastColumn() { return this.rows.reduce((w, r) => Math.max(w, r.length), 0); },
    getMaxColumns() { return this.maxColumns; },
    insertColumnsAfter(afterCol, n) { this.maxColumns += n; },
    appendRow(r) { this.rows.push(r.slice()); },
    setFrozenRows() {},
    getRange(row, col, numRows, numCols) {
      const s = this;
      return {
        setValue(v) {
          while (s.rows.length < row) s.rows.push([]);
          s.rows[row - 1][col - 1] = v;
        },
        setValues(vals) {
          vals.forEach((r, i) => {
            const idx = row - 1 + i;
            while (s.rows.length <= idx) s.rows.push([]);
            r.forEach((v, j) => { s.rows[idx][col - 1 + j] = v; });
          });
        },
        getValues() {
          const out = [];
          for (let i = 0; i < (numRows || 1); i++) {
            const src = s.rows[row - 1 + i] || [];
            const line = [];
            for (let j = 0; j < (numCols || 1); j++) {
              const v = src[col - 1 + j];
              line.push(v === undefined ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        setBackground() { return this; }
      };
    },
    getParent() { return this.parent; }
  };
}
function makeSS(sheets) {
  const ss = {
    sheets,
    getSheetByName(n) { return this.sheets[n] || null; },
    insertSheet(n) { const s = makeSheet(n, []); s.parent = this; this.sheets[n] = s; return s; },
    toast() {}
  };
  Object.values(sheets).forEach(s => { s.parent = ss; });
  return ss;
}

const alerts = [];
function baseSandbox(activeSS) {
  return {
    console,
    Logger: { log: () => {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => activeSS,
      getUi: () => ({
        alert: (...a) => { alerts.push(a.join(' | ')); },
        ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
        Button: { YES: 'YES' },
        createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; }
      }),
      flush: () => {},
      openById: (id) => sandboxState.cardsSS
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        // 測試用：固定台北 = UTC+8
        const t = new Date(d.getTime() + 8 * 3600 * 1000);
        const p = n => String(n).padStart(2, '0');
        return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => 'FAKE_ID', setProperty: () => {} })
    },
    MailApp: { sendEmail: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'x@y.z' }) },
    UrlFetchApp: {}
  };
}
const sandboxState = {};

// ============================================================
// A. readChangelog（cards-export.gs）
// ============================================================
function runExport(changelogRows) {
  const sheets = {};
  if (changelogRows) sheets['變動紀錄'] = makeSheet('變動紀錄', changelogRows);
  const ss = makeSS(sheets);
  const ctx = vm.createContext(baseSandbox(ss));
  vm.runInContext(fs.readFileSync(path + 'cards-export.gs', 'utf8'), ctx);
  return vm.runInContext('readChangelog()', ctx);
}

// A1: 工作表不存在 → 安全降級
let ok = true, res;
try { res = runExport(null); } catch (e) { ok = false; res = e.message; }
check('「變動紀錄」表不存在：不丟例外、回空物件', ok && JSON.stringify(res) === '{}', res);

// A2: 7 筆 → 取最新 5 筆、由新到舊
const header = ['id', 'date', 'summary', 'active'];
const seven = [header];
['2026-01-01', '2026-03-05', '2026-02-02', '2026-07-30', '2026-05-05', '2026-06-06', '2026-04-04']
  .forEach((d, i) => seven.push(['yushan-unicard', new Date(d + 'T00:00:00+08:00'), '異動' + i, true]));
res = runExport(seven);
const dates = res['yushan-unicard'].map(e => e.date);
check('7 筆 → 只留最新 5 筆', res['yushan-unicard'].length === 5, res);
check('由新到舊排序', JSON.stringify(dates) === JSON.stringify(['2026-07-30', '2026-06-06', '2026-05-05', '2026-04-04', '2026-03-05']), dates);

// A3: active=FALSE 不匯出（字串與布林都試）
res = runExport([header,
  ['a-card', new Date('2026-07-01T00:00:00+08:00'), '留下', true],
  ['a-card', new Date('2026-07-02T00:00:00+08:00'), '撤下字串', 'FALSE'],
  ['a-card', new Date('2026-07-03T00:00:00+08:00'), '撤下布林', false],
  ['a-card', new Date('2026-07-04T00:00:00+08:00'), '沒填 active 也留下', '']
]);
check('active=FALSE（字串/布林）都被排除，留空視為啟用',
  JSON.stringify(res['a-card'].map(e => e.summary)) === JSON.stringify(['沒填 active 也留下', '留下']), res);

// A4: Date 儲存格 → ISO 不差一天（台北 00:00 的 Date 內部是前一天 16:00 UTC）
check('Date 儲存格過 formatDateToISO 不差一天', res['a-card'][0].date === '2026-07-04', res['a-card'][0]);

// A5: 沒異動的卡不塞空陣列 / 壞日期列略過
res = runExport([header, ['b-card', 'not-a-date', '壞日期', true]]);
check('日期解析失敗的列被略過', JSON.stringify(res) === '{}', res);

// ============================================================
// B. publishChangelog（benefits-parser.gs）
// ============================================================
const INBOX_HEADER = ['日期時間', 'card_id', '銀行', '網址', '實質變動', 'AI摘要', '變動類型',
  '信心', '變動段落', '舊文字', '新文字', '狀態', '公開摘要', '公開卡片', '公開'];
function inboxRow(time, summary, cards, flag) {
  const r = new Array(15).fill('');
  r[0] = time; r[11] = '待解析'; r[12] = summary; r[13] = cards; r[14] = flag;
  return r;
}
function runPublish(inboxRows, cardsDataRows, existingChangelog) {
  alerts.length = 0;
  const autoSheets = { '2-變動通知': makeSheet('2-變動通知', inboxRows) };
  const autoSS = makeSS(autoSheets);
  const dataSheets = { 'Cards Data': makeSheet('Cards Data', cardsDataRows) };
  if (existingChangelog) dataSheets['變動紀錄'] = makeSheet('變動紀錄', existingChangelog);
  const dataSS = makeSS(dataSheets);
  sandboxState.cardsSS = dataSS;

  const ctx = vm.createContext(baseSandbox(autoSS));
  vm.runInContext(fs.readFileSync(path + 'watchlist-monitor.gs', 'utf8'), ctx);   // splitList_
  vm.runInContext(fs.readFileSync(path + 'benefits-parser.gs', 'utf8'), ctx);
  vm.runInContext('publishChangelog()', ctx);
  return { inbox: autoSheets['2-變動通知'].rows, changelog: dataSS.getSheetByName('變動紀錄'), alerts: alerts.slice() };
}

const CARDS_DATA = [['id', 'name'], ['yushan-unicard', '玉山'], ['febank-jaccard', '遠銀'], ['cathay-cube', '國泰']];
const T = new Date('2026-07-30T10:00:00+08:00');

// B1: 多卡列自動拆成多列
let r = runPublish([INBOX_HEADER, inboxRow(T, '一般消費回饋調降為 1%', 'febank-jaccard,cathay-cube', 'V')], CARDS_DATA, null);
const written = r.changelog.rows.slice(1);
check('多卡列自動拆成 2 列', written.length === 2, written);
check('拆出的兩列 id 正確、summary 相同、active=TRUE',
  written[0][0] === 'febank-jaccard' && written[1][0] === 'cathay-cube' &&
  written[0][2] === '一般消費回饋調降為 1%' && written[0][3] === true, written);
check('date 取自「日期時間」並正規化成 yyyy-MM-dd', written[0][1] === '2026-07-30', written[0]);
check('發布後「公開」欄改成「已發布」', r.inbox[1][14] === '已發布', r.inbox[1][14]);

// B2: 重複按不會重寫
const inbox2 = [INBOX_HEADER, inboxRow(T, '一般消費回饋調降為 1%', 'febank-jaccard', 'V')];
const existing = [['id', 'date', 'summary', 'active']];
let ctxRows = null;
{
  alerts.length = 0;
  const autoSS = makeSS({ '2-變動通知': makeSheet('2-變動通知', inbox2) });
  const dataSS = makeSS({ 'Cards Data': makeSheet('Cards Data', CARDS_DATA), '變動紀錄': makeSheet('變動紀錄', existing) });
  sandboxState.cardsSS = dataSS;
  const ctx = vm.createContext(baseSandbox(autoSS));
  vm.runInContext(fs.readFileSync(path + 'watchlist-monitor.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path + 'benefits-parser.gs', 'utf8'), ctx);
  vm.runInContext('publishChangelog()', ctx);
  const afterFirst = dataSS.getSheetByName('變動紀錄').rows.length;
  vm.runInContext('publishChangelog()', ctx);   // 再按一次
  const afterSecond = dataSS.getSheetByName('變動紀錄').rows.length;
  check('重複按選單不會重寫（1 筆 → 還是 1 筆）', afterFirst === 2 && afterSecond === 2, { afterFirst, afterSecond });
  check('第二次跳「沒有打勾的列」提示', alerts[alerts.length - 1].indexOf('沒有任何打勾') >= 0, alerts[alerts.length - 1]);
}

// B3: 驗證失敗的列完整列在訊息裡且未寫入
const longSummary = '這是一段沒有改寫過的內部視角摘要'.repeat(5);   // > 60 字
r = runPublish([INBOX_HEADER,
  inboxRow(T, '', 'yushan-unicard', 'V'),                     // 摘要空
  inboxRow(T, longSummary, 'yushan-unicard', 'V'),            // 摘要過長
  inboxRow(T, '正常一句話', 'no-such-card', 'V'),              // id 不存在
  inboxRow(T, '正常一句話', '', 'V'),                          // 公開卡片空
  inboxRow(T, '這筆會過', 'yushan-unicard', 'ｖ'),             // 全形小寫 v 也要吃
  inboxRow(T, '沒打勾不該發', 'yushan-unicard', '')            // 沒打勾
], CARDS_DATA, null);
const rows3 = r.changelog.rows.slice(1);
check('只有通過驗證的 1 列被寫入', rows3.length === 1 && rows3[0][2] === '這筆會過', rows3);
const msg = r.alerts.join('\n');
check('4 個失敗原因都列在訊息裡',
  msg.indexOf('列 2') >= 0 && msg.indexOf('列 3') >= 0 && msg.indexOf('列 4') >= 0 && msg.indexOf('列 5') >= 0, msg);
check('訊息點出「公開摘要」空／過長／id 不存在／卡片空',
  msg.indexOf('「公開摘要」是空的') >= 0 && msg.indexOf('超過 60 字上限') >= 0 &&
  msg.indexOf('不存在的 id：no-such-card') >= 0 && msg.indexOf('「公開卡片」是空的') >= 0, msg);
check('全形ｖ也算打勾', rows3[0][2] === '這筆會過', rows3);
check('失敗的列「公開」欄維持 V（改好可再按一次）', r.inbox[1][14] === 'V' && r.inbox[3][14] === 'V', [r.inbox[1][14], r.inbox[3][14]]);
check('沒打勾的列不動', r.inbox[6][14] === '', r.inbox[6][14]);

// B4: 「變動紀錄」表不存在時自動建立並補表頭
check('「變動紀錄」表不存在時自動建立＋表頭',
  JSON.stringify(r.changelog.rows[0]) === JSON.stringify(['id', 'date', 'summary', 'active']), r.changelog.rows[0]);

// B5: 舊的 12 欄分頁（站長既有內容還在）→ 自動補表頭、舊列一格都不動
const OLD_HEADER = ['日期時間', 'card_id', '銀行', '網址', '實質變動', 'AI摘要', '變動類型',
  '信心', '變動段落', '舊文字', '新文字', '狀態'];
const oldRow = [T, 'yushan-unicard', '玉山', 'https://x', '是', 'AI內部視角摘要', '文案', '高', 'd', 'o', 'n', '已處理'];
r = runPublish([OLD_HEADER.slice(), oldRow.slice()], CARDS_DATA, null);
check('舊 12 欄分頁：自動補上表尾三欄（不用刪分頁）',
  JSON.stringify(r.inbox[0].slice(12)) === JSON.stringify(['公開摘要', '公開卡片', '公開']), r.inbox[0]);
check('舊分頁的既有內容一格都沒動',
  JSON.stringify(r.inbox[1].slice(0, 12)) === JSON.stringify(oldRow), r.inbox[1]);
check('補完表頭當次沒有打勾的列 → 不寫入、跳「沒有打勾」提示',
  !r.changelog && r.alerts.join('').indexOf('沒有任何打勾') >= 0, r.alerts);

// B5a: 舊列的「公開摘要／公開卡片」自動從 AI摘要／card_id 回填
check('舊列「公開卡片」自動回填 card_id', r.inbox[1][13] === 'yushan-unicard', r.inbox[1].slice(12));
check('舊列「公開摘要」自動回填 AI摘要', r.inbox[1][12] === 'AI內部視角摘要', r.inbox[1].slice(12));
check('回填筆數有寫進結果視窗', r.alerts.join('').indexOf('回填了 2 格') >= 0, r.alerts);

// 回填只填空格：站長已經改寫過的摘要不能被 AI 摘要蓋掉；「已發布」的列整列不碰
r = runPublish([OLD_HEADER.concat(['公開摘要', '公開卡片', '公開']),
  oldRow.concat(['我改寫過的一句話', '', '']),
  oldRow.concat(['', '', '已發布'])], CARDS_DATA, null);
check('已改寫的「公開摘要」不被 AI 摘要覆蓋', r.inbox[1][12] === '我改寫過的一句話', r.inbox[1].slice(12));
check('空的「公開卡片」照樣補上', r.inbox[1][13] === 'yushan-unicard', r.inbox[1].slice(12));
check('「已發布」的列整列不回填', r.inbox[2][12] === '' && r.inbox[2][13] === '', r.inbox[2].slice(12));

// 回填後同一次就能用：舊列只要打 V 就發得出去（不用等下一次按選單）
r = runPublish([OLD_HEADER.concat(['公開摘要', '公開卡片', '公開']),
  oldRow.concat(['改寫好的一句話', '', 'V'])], CARDS_DATA, null);
check('舊列只打 V、公開卡片留空 → 回填後同一次就發得出去',
  !!r.changelog && r.changelog.rows.length === 2 && r.changelog.rows[1][0] === 'yushan-unicard',
  r.changelog && r.changelog.rows);

// B5b: 補完表頭後，站長自己補上舊列的兩格再打 V → 照樣發得出去
r = runPublish([OLD_HEADER.concat(['公開摘要', '公開卡片', '公開']),
  oldRow.concat(['手動補寫的一句話', 'yushan-unicard', 'V'])], CARDS_DATA, null);
check('舊列手動補兩格後可正常發布',
  !!r.changelog && r.changelog.rows.length === 2 && r.changelog.rows[1][2] === '手動補寫的一句話',
  r.changelog && r.changelog.rows);

// B5c: 表頭跟程式預期對不上 → 什麼都不寫，改給手動補表頭的指示
r = runPublish([['日期時間', 'card_id', '銀行', '網址', '狀態'], [T, 'yushan-unicard', '玉山', 'u', '待解析']], CARDS_DATA, null);
check('表頭對不上 → 不亂寫、指示手動補三格（不叫人刪分頁）',
  r.inbox[0].length === 5 && r.alerts.join('').indexOf('手動補即可') >= 0 && !r.changelog, r.alerts);

// B5d: 第 13~15 欄已被站長自己的欄位佔用 → 不覆蓋
r = runPublish([OLD_HEADER.concat(['我的備註']), oldRow.concat(['別動我'])], CARDS_DATA, null);
check('第 13 欄已有站長自己的欄位 → 不覆蓋、改指示手動補',
  r.inbox[0][12] === '我的備註' && r.inbox[1][12] === '別動我' &&
  r.alerts.join('').indexOf('手動補即可') >= 0, r.inbox[0]);

// ============================================================
// C. appendToInbox_ 預填三欄
// ============================================================
{
  const autoSS = makeSS({});
  const ctx = vm.createContext(baseSandbox(autoSS));
  vm.runInContext(fs.readFileSync(path + 'watchlist-monitor.gs', 'utf8'), ctx);
  ctx.__info = {
    time: T, cardId: 'febank-jaccard,cathay-cube', bank: '遠銀', url: 'https://x',
    cls: { material: true, summary: '純版面調整，回饋未變', change_types: ['文案'], confidence: '高' },
    diffText: 'd', oldText: 'o', newText: 'n'
  };
  vm.runInContext('appendToInbox_(SpreadsheetApp.getActiveSpreadsheet(), __info)', ctx);
  const sheet = autoSS.getSheetByName('2-變動通知');
  check('appendToInbox_ 表頭尾巴新增三欄',
    JSON.stringify(sheet.rows[0].slice(12)) === JSON.stringify(['公開摘要', '公開卡片', '公開']), sheet.rows[0]);
  check('公開摘要預填 AI 摘要、公開卡片預填 inboxCardId、公開留空',
    sheet.rows[1][12] === '純版面調整，回饋未變' &&
    sheet.rows[1][13] === 'febank-jaccard,cathay-cube' &&
    sheet.rows[1][14] === '', sheet.rows[1].slice(12));
}

// C2: 監控寫入舊的 12 欄分頁時，也會自動補表頭、舊列不動
{
  const oldSheet = makeSheet('2-變動通知', [OLD_HEADER.slice(), oldRow.slice()]);
  const autoSS = makeSS({ '2-變動通知': oldSheet });
  const ctx = vm.createContext(baseSandbox(autoSS));
  vm.runInContext(fs.readFileSync(path + 'watchlist-monitor.gs', 'utf8'), ctx);
  ctx.__info = {
    time: T, cardId: 'yushan-unicard', bank: '玉山', url: 'https://x',
    cls: { material: true, summary: '新的一筆', change_types: [], confidence: '高' },
    diffText: 'd', oldText: 'o', newText: 'n'
  };
  vm.runInContext('appendToInbox_(SpreadsheetApp.getActiveSpreadsheet(), __info)', ctx);
  check('監控寫入舊分頁時自動補表頭',
    JSON.stringify(oldSheet.rows[0].slice(12)) === JSON.stringify(['公開摘要', '公開卡片', '公開']), oldSheet.rows[0]);
  check('舊分頁的舊列不受影響',
    JSON.stringify(oldSheet.rows[1].slice(0, 12)) === JSON.stringify(oldRow), oldSheet.rows[1]);
  check('新寫入的列三欄預填正確',
    oldSheet.rows[2][12] === '新的一筆' && oldSheet.rows[2][13] === 'yushan-unicard' && oldSheet.rows[2][14] === '',
    oldSheet.rows[2].slice(12));
}

console.log(failures ? `\n${failures} 項未通過` : '\n全部通過');
process.exit(failures ? 1 : 0);
