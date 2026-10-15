// ==========================================
// 用詞統一（「統一詞」工作表，2026-10-14）
// ==========================================
// 站長維護一份「統一詞」：每列一個統一寫法＋它的其他寫法＋搜尋別名。這支把它套回試算表本身。
//   統一詞    ：品牌原本的大小寫、中英不空格、臺→台（例：Uber Eats）
//   其他寫法  ：會被**改寫**成統一詞的寫法。只差大小寫／空白／全半形／臺台的不用列，程式自己認得；
//              要列的是真的不一樣的（ezTravel → ezTravel易遊網）
//   搜尋別名  ：**不改資料**，只讓用戶搜得到（寵物醫院 → 動物醫院）。匯出時跟其他寫法一起變成網站的模糊搜尋
//
// 同一份表還有兩個地方在用：
//   ・cards-export.gs 匯出 termAliases（其他寫法＋搜尋別名 → 網站模糊搜尋）
//   ・自動化檔（benefits-parser.gs 的 pmcUnifyList_）：AI 解析寫進 4-/5-待審核 前先統一商家名
//
// 用法（Apps Script 編輯器上方函數下拉選單 → 執行）：
//   （建表 seedTermDictionary 與搬模糊搜尋 importFuzzyAliases 是 2026-10-14／15 的一次性工具，用完已從檔案移除；
//     需要考古看 git 歷史）
//   1. previewTermUnify：只看不改。把「會改哪些格、改前改後」寫進「用詞統一預覽」工作表
//   2. 看過沒問題 → applyTermUnify：真的改，改完預覽表標「已套用」
//   3. 跑一次 exportToJSON
//
// 比對規則（刻意保守）：
//   ・一格裡用 , ， 、 換行 切成一項一項（括號裡的「、」不切），**整項**等於某個寫法才換——句子裡夾著品牌名不會被動到
//   ・「等於」＝忽略大小寫、空白、全半形、臺/台之後相同
//   ・公式格、第 1 列表頭不動；只掃 TERM_UNIFY_SHEETS（MerchantPages 刻意不掃：牽涉商家頁網址）
const TERM_DICT_SHEET = '統一詞';
const TERM_DICT_HEADERS = ['統一詞', '其他寫法', '搜尋別名', '備註'];
const TERM_UNIFY_SHEETS = ['Cards Data', 'QuickSearch', 'Search Hints', 'searchExclusions', 'SearchExclusions',
  'Card Benefits', 'Merchant Payments', 'ExclusionGroups'];
const TERM_UNIFY_REPORT = '用詞統一預覽';

function termUnifyKey_(s) {
  return String(s)
    .replace(/[！-～]/g, function(ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .replace(/臺/g, '台')
    .replace(/[\s　]/g, '')
    .toLowerCase();
}

// 讀「統一詞」工作表 → [{ term, variants: [], aliases: [] }]。cards-export.gs 匯出也用這支
function readTermDictionary_(ss) {
  const sheet = (ss || SpreadsheetApp.getActiveSpreadsheet()).getSheetByName(TERM_DICT_SHEET);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const h = data[0].map(function(x) { return String(x).trim(); });
  const iT = h.indexOf('統一詞'), iV = h.indexOf('其他寫法'), iA = h.indexOf('搜尋別名');
  if (iT < 0) return [];
  const split = function(v) { return String(v || '').split(/[,，\n]/).map(function(x) { return x.trim(); }).filter(Boolean); };
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const term = String(data[r][iT] || '').trim();
    if (!term) continue;
    out.push({ term: term, variants: iV >= 0 ? split(data[r][iV]) : [], aliases: iA >= 0 ? split(data[r][iA]) : [] });
  }
  return out;
}

function termUnifyMap_() {
  const dict = readTermDictionary_();
  if (dict.length === 0) throw new Error('找不到「' + TERM_DICT_SHEET + '」工作表或裡面沒有資料');
  const map = {};
  dict.forEach(function(d) {
    map[termUnifyKey_(d.term)] = d.term;
    d.variants.forEach(function(v) { map[termUnifyKey_(v)] = d.term; });
  });
  return map;
}

function termUnifyCell_(text, map) {
  const parts = [];   // [{ raw, sep }]
  let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '（') depth++;
    else if ((ch === ')' || ch === '）') && depth > 0) depth--;
    if (depth === 0 && (ch === ',' || ch === '，' || ch === '、' || ch === '\n')) {
      parts.push({ raw: cur, sep: ch }); cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push({ raw: cur, sep: '' });

  let changed = false;
  const out = parts.map(function(p) {
    const core = p.raw.trim();
    const canonical = core ? map[termUnifyKey_(core)] : null;
    if (!canonical || canonical === core) return p.raw + p.sep;
    changed = true;
    const lead = p.raw.match(/^\s*/)[0];
    const trail = p.raw.match(/\s*$/)[0];
    return lead + canonical + trail + p.sep;
  }).join('');
  return changed ? out : null;
}

// 回傳 [{ sheet, row, col, a1, before, after }]
function termUnifyCollect_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const map = termUnifyMap_();
  const changes = [];
  TERM_UNIFY_SHEETS.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const range = sheet.getDataRange();
    const values = range.getValues();
    const formulas = range.getFormulas();
    for (let r = 1; r < values.length; r++) {          // r=0 是表頭
      for (let c = 0; c < values[r].length; c++) {
        const v = values[r][c];
        if (typeof v !== 'string' || !v || formulas[r][c]) continue;
        const after = termUnifyCell_(v, map);
        if (after === null) continue;
        changes.push({ sheet: name, row: r + 1, col: c + 1,
          a1: sheet.getRange(r + 1, c + 1).getA1Notation(), before: v, after: after });
      }
    }
  });
  return changes;
}

function termUnifyWriteReport_(changes, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = ss.getSheetByName(TERM_UNIFY_REPORT) || ss.insertSheet(TERM_UNIFY_REPORT);
  report.clear();
  const rows = [['工作表', '儲存格', '原本', '改成', '狀態']];
  changes.forEach(function(ch) { rows.push([ch.sheet, ch.a1, ch.before, ch.after, status]); });
  report.getRange(1, 1, rows.length, 5).setValues(rows);
  report.setFrozenRows(1);
  report.getRange(1, 1, 1, 5).setFontWeight('bold');
  report.setColumnWidths(3, 2, 420);
  report.getRange(2, 3, Math.max(rows.length - 1, 1), 2).setWrap(true);
  return report;
}

function previewTermUnify() {
  const changes = termUnifyCollect_();
  const report = termUnifyWriteReport_(changes, '預覽（還沒改）');
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(report);
  Logger.log('用詞統一預覽：' + changes.length + ' 格會改。看過「' + TERM_UNIFY_REPORT + '」沒問題再執行 applyTermUnify');
}

function applyTermUnify() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const changes = termUnifyCollect_();   // 重算一次：預覽之後表格可能又被改過
  changes.forEach(function(ch) {
    ss.getSheetByName(ch.sheet).getRange(ch.row, ch.col).setValue(ch.after);
  });
  SpreadsheetApp.flush();
  const report = termUnifyWriteReport_(changes, '已套用');
  ss.setActiveSheet(report);
  Logger.log('用詞統一完成：改了 ' + changes.length + ' 格。記得再跑一次 exportToJSON');
}
