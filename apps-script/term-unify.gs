// ==========================================
// 用詞統一（「統一詞」工作表，2026-10-14）
// ==========================================
// 站長維護一份「統一詞」：每列一個統一寫法＋它的其他寫法＋搜尋別名。這支把它套回試算表本身。
//   統一詞    ：品牌原本的大小寫、中英不空格、臺→台（例：Uber Eats）
//   其他寫法  ：會被**改寫**成統一詞的寫法。只差大小寫／空白／全半形／臺台的不用列，程式自己認得；
//              要列的是真的不一樣的（ezTravel → ezTravel易遊網）。
//              中英之間加空白的寫法（台灣 Pay）匯出時也會自動補進搜尋別名（termSpacedVariants_，見檔尾），不用列
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
//   （不用手動跑）exportToJSON 每次都會呼叫 termConsistencyIssues_：網站用到的商家名裡，同一個名字有兩種以上寫法
//     （只差空白／大小寫／全半形／臺台）就跳提醒，照提醒在統一詞表處理再跑 1、2 步。見檔尾「寫法一致性檢查」
//
// 比對規則（刻意保守）：
//   ・一格裡用 , ， 、 換行 切成一項一項（括號裡的「、」不切），**整項**等於某個寫法才換——句子裡夾著品牌名不會被動到
//   ・「等於」＝忽略大小寫、空白、全半形、臺/台之後相同
//   ・公式格、第 1 列表頭不動；只掃 TERM_UNIFY_SHEETS（MerchantPages 刻意不掃：牽涉商家頁網址）
//   ・Highlights（精選活動）2026-10-17 加入：寫法一致性檢查抓到精選活動寫「LINE Pay」、卡片寫「Line Pay」，沒掃就永遠改不到
const TERM_DICT_SHEET = '統一詞';
const TERM_DICT_HEADERS = ['統一詞', '其他寫法', '搜尋別名', '備註'];
const TERM_UNIFY_SHEETS = ['Cards Data', 'QuickSearch', 'Search Hints', 'searchExclusions', 'SearchExclusions',
  'Card Benefits', 'Merchant Payments', 'ExclusionGroups', 'Highlights'];
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
    // 試算表會把「7-11」這種格子自動變成日期（2026-10-17 實際發生：匯出成「Sat Jul 11 2026…」）。
    // 讀到日期／數字就跳過整列並寫進執行記錄，不要把亂碼匯出去；修法：格子前面加 ' 改成文字
    const cells = [data[r][iT], iV >= 0 ? data[r][iV] : '', iA >= 0 ? data[r][iA] : ''];
    if (cells.some(function(v) { return Object.prototype.toString.call(v) === '[object Date]' || typeof v === 'number'; })) {
      Logger.log('⚠️「' + TERM_DICT_SHEET + '」第 ' + (r + 1) + ' 列有格子被試算表轉成日期或數字，整列跳過。' +
        '請在那格前面加一個 \' 再重打（例：\'7-11），讓它變成文字');
      continue;
    }
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

// ==========================================
// 寫法一致性檢查（2026-10-17）：exportToJSON 每次匯出自動呼叫
// ==========================================
// 抓「同一個名字、只差空白／大小寫／全半形／臺台」的不同寫法（例：Line Pay ⇄ LINE Pay、台灣 Pay ⇄ 台灣Pay）。
// 為什麼要抓：網站每張卡是「拿名字查清單」，只忽略大小寫、**不忽略空白**。同一家店寫成兩種樣子，
// 搜尋的「匹配到」會列兩次；名字改過的話，用戶存在刷卡小抄的舊寫法也會對不上。
// 正確做法是資料源頭只有一種寫法——這支只負責每次匯出時把漏網的列出來（不擋匯出），由站長在源頭修：
//   ・統一詞表已有這個字 → 跑 previewTermUnify → applyTermUnify，所有寫法會改成表上那種
//   ・還沒有 → 在統一詞表加一列（統一詞寫你要的那種），再跑上面兩步
// 「同一個名字」的判斷跟 applyTermUnify 同一個 termUnifyKey_，所以提醒的每一組，照上面做都改得到。
// 比的是匯出後網站真的會用到的商家名（呼叫端決定範圍，見 cards-export.gs）；Search Hints／ExclusionGroups
// 刻意不比：那兩張本來就會故意列好幾種寫法讓用戶搜得到。
//
// entries：[{ name, source }]（source＝給人看的出處，例：卡名、「精選活動」）
// dict：readTermDictionary_() 的結果，用來判斷統一詞表是不是已經有這個字
// 回傳：[{ term: 統一詞表上的寫法或 null, writings: [{ name, sources: [...] }] }]，只回傳有兩種以上寫法的
function termConsistencyIssues_(entries, dict) {
  const groups = {};   // key -> { name -> { source: true } }
  entries.forEach(function(e) {
    const name = String(e.name || '').trim();
    if (!name) return;
    const key = termUnifyKey_(name);
    if (!groups[key]) groups[key] = {};
    if (!groups[key][name]) groups[key][name] = {};
    groups[key][name][e.source] = true;
  });
  const termByKey = {};
  (dict || []).forEach(function(d) { termByKey[termUnifyKey_(d.term)] = d.term; });
  const issues = [];
  Object.keys(groups).sort().forEach(function(key) {
    const names = Object.keys(groups[key]);
    if (names.length < 2) return;
    issues.push({
      term: termByKey[key] || null,
      writings: names.map(function(n) { return { name: n, sources: Object.keys(groups[key][n]) }; })
    });
  });
  return issues;
}

// termConsistencyIssues_ 的結果 → 提醒視窗的文字（max 組以後只寫「其餘 N 組見執行記錄」）
function termConsistencyMessage_(issues, max) {
  const lines = ['下面每一組是同一個名字的不同寫法（只差空白／大小寫／全半形／臺台）。請在源頭統一成一種：', ''];
  issues.slice(0, max).forEach(function(issue, i) {
    lines.push((i + 1) + '. ' + issue.writings.map(function(w) {
      const shown = w.sources.slice(0, 2).join('、') + (w.sources.length > 2 ? ' 等 ' + w.sources.length + ' 處' : '');
      return '「' + w.name + '」（' + shown + '）';
    }).join(' ⇄ '));
    lines.push(issue.term
      ? '   → 統一詞表已有「' + issue.term + '」：跑 previewTermUnify → applyTermUnify 就會改好'
      : '   → 在「' + TERM_DICT_SHEET + '」表加一列，統一詞寫你要的那種，再跑 previewTermUnify → applyTermUnify');
  });
  if (issues.length > max) lines.push('', '…其餘 ' + (issues.length - max) + ' 組見執行記錄（Apps Script 編輯器 → 執行作業）');
  lines.push('', '改好後再匯出一次，這個提醒就會消失。');
  return lines.join('\n');
}

// ==========================================
// 中英之間加空白的寫法（2026-10-18）：exportToJSON 匯出 termAliases 時自動補進搜尋別名
// ==========================================
// 網站搜尋不忽略空白：資料寫「台灣Pay」，用戶打「台灣 pay」找不到。統一詞「只差空白的不用列」只對
// applyTermUnify（改資料）成立，所以匯出時替統一詞、其他寫法、搜尋別名裡「中文緊貼英數」的地方
// 自動補上加空白的版本，站長不用一個個手打。只進匯出的搜尋別名，不寫回統一詞工作表（表保持乾淨）。
// 例：台灣Pay → 台灣 Pay；POYA寶雅 → POYA 寶雅；PChome 24h購物 → PChome 24h 購物
// 一個名字有 1～2 個中英交界：每種加法都補（2 個交界＝3 種）；3 個以上只補「全部都加」那一種，避免組合爆量
function termSpacedVariants_(name) {
  const s = String(name || '');
  const cjk = /[㐀-鿿豈-﫿]/, alnum = /[A-Za-z0-9]/;
  const cuts = [];   // 在第 i 個字元前面可以加空白
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    if ((cjk.test(a) && alnum.test(b)) || (alnum.test(a) && cjk.test(b))) cuts.push(i);
  }
  if (cuts.length === 0) return [];
  const build = function(chosen) {
    let out = '', last = 0;
    chosen.forEach(function(i) { out += s.slice(last, i) + ' '; last = i; });
    return out + s.slice(last);
  };
  if (cuts.length > 2) return [build(cuts)];
  const out = [];
  for (let mask = 1; mask < (1 << cuts.length); mask++) {
    out.push(build(cuts.filter(function(_, k) { return mask & (1 << k); })));
  }
  return out;
}
