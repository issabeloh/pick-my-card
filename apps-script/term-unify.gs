// ==========================================
// 用詞統一（一次性工具，2026-10-14）
// ==========================================
// 站長決定的統一寫法（品牌原本的大小寫、中英不空格、臺→台）套回試算表本身，
// 不是只改站上——之後匯出就是乾淨的。
//
// 用法（Apps Script 編輯器上方函數下拉選單 → 執行）：
//   1. previewTermUnify：只看不改。把「會改哪些格、改前改後」寫進「用詞統一預覽」工作表
//   2. 看過沒問題 → applyTermUnify：真的改（同一套規則重算一次再寫入），改完預覽表標「已套用」
//   3. 跑一次 exportToJSON
//
// 比對規則（刻意保守）：
//   ・一格裡用 , ， 、 換行 切成一項一項（括號裡的「、」不切：MITSUI OUTLET PARK(林口、台中港、台南) 是一項），
//     **整項**等於某個統一詞的變體才換——句子裡夾著品牌名不會被動到
//   ・「等於」＝忽略大小寫、空白、全半形、臺/台之後相同（uber eats／UberEats → Uber Eats）
//   ・另外幾個不是只差大小寫的（ezTravel → ezTravel易遊網 等）寫在 TERM_UNIFY_EXTRA
//   ・公式格、第 1 列表頭不動
//   ・只掃 TERM_UNIFY_SHEETS 列的工作表。MerchantPages 刻意不掃：那邊的商家名牽涉商家頁網址
const TERM_UNIFY_CANONICAL = [
  'Uber Eats', 'KKday', 'Apple直營', 'Line Pay', 'PlayStation', 'PChome', 'FunNow', 'Uniqlo', 'WeMo Scooter',
  '台灣Pay', 'LaLaport', '統一時代百貨台北店', 'Foodpanda', 'EZTABLE', 'Trip.com', 'Booking.com', 'Hotels.com',
  'AsiaYo', 'Expedia', 'Agoda', 'Klook', '台鐵', 'Uber', 'Yoxi', '全盈+Pay', 'iPASS MONEY', 'MOMO購物網',
  'Coupang酷澎', 'Meta廣告', '境外投資交易平台',
  'Google廣告', 'Dream Plaza', 'Hola', 'Wise', 'Nintendo', 'Netflix', 'Gemini', 'Steam', 'ChatGPT', '中油Pay',
  'PayPal', 'GOMAJI', 'ZARA', 'H&M', 'Pinkoi', 'KKTIX', 'ezTravel易遊網', 'Airbnb', 'Foodomo', 'KKBOX', 'iTunes',
  'Google Play', 'Spotify', 'Notion', 'Canva', 'Suica', 'PASMO', 'ICOCA', '東橫INN', '日本PayPay', '台灣中油直營站',
  'POYA寶雅', 'MyCard', '統一時代百貨高雄店', 'Claude', 'Perplexity', 'Apple媒體服務', 'Disney+', 'YouTube Premium',
  '遠東SOGO百貨', '遠東SOGO', '廣三SOGO', 'BELLAVITA', 'ATT 4 FUN', 'NOKE忠泰樂生活', 'CITYLINK', 'SKM Park Outlet',
  'MITSUI OUTLET PARK(林口、台中港、台南)', 'Apple錢包指定交通卡(Suica、PASMO、ICOCA)', 'iRent', 'Xpark',
  '台中捷運', '台北捷運', 'World Gym', 'App Store', '公務機關暨醫療院所信用卡繳費平台', 'GU', 'NET', '10/10 HOPE',
  'Amazon', 'iHerb', 'Selfridges', 'Gmarket', 'Olive Young', 'IKEA', 'GoShare', 'BEING spa', 'BEING sport',
  'OPENTIX兩廳院文化生活', 'Farfetch', 'LOPIA', 'USPACE', 'CatchPlay', 'tixCraft拓元',
  'friDay購物', 'PChome 24h購物', 'MiaCucina', 'STUDIO A', 'Line GO', '樂子the Diner'
];
// 變體 → 統一詞（不是只差大小寫／空白／臺台的）
const TERM_UNIFY_EXTRA = {
  'ezTravel': 'ezTravel易遊網',
  'SKM Park': 'SKM Park Outlet',
  '酷澎(Coupang)': 'Coupang酷澎',
  '台灣中油-直營站': '台灣中油直營站'
};
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

function termUnifyMap_() {
  const map = {};
  TERM_UNIFY_CANONICAL.forEach(function(c) { map[termUnifyKey_(c)] = c; });
  Object.keys(TERM_UNIFY_EXTRA).forEach(function(v) { map[termUnifyKey_(v)] = TERM_UNIFY_EXTRA[v]; });
  return map;
}

// 一格文字 → 換好的文字（沒變回 null）。分隔符與前後空白原樣保留
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
