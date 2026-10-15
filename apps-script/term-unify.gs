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
//   0. seedTermDictionary：第一次用，建「統一詞」工作表並填入 2026-10-14 定案的寫法（已存在就不動）
//   0b. importFuzzyAliases：一次性，把網站程式裡原本的模糊搜尋清單（2026-10-15 站長逐條確認）併進「統一詞」表
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
// seedTermDictionary 用的初始內容（2026-10-14 站長定案）。之後一律改工作表，不改這裡
const TERM_UNIFY_SEED = [
  'Uber Eats', 'KKday', 'Apple直營', 'Line Pay', 'PlayStation', 'PChome商店街', 'FunNow', 'Uniqlo', 'WeMo Scooter',
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
// 其他寫法（不是只差大小寫／空白／臺台的）→ 統一詞
const TERM_UNIFY_SEED_EXTRA = {
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

// 搜尋別名初始內容（統一詞 → 別名）
const TERM_UNIFY_SEED_ALIASES = { '動物醫院': ['寵物醫院'] };

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
  if (dict.length === 0) throw new Error('找不到「' + TERM_DICT_SHEET + '」工作表或裡面沒有資料——先執行 seedTermDictionary');
  const map = {};
  dict.forEach(function(d) {
    map[termUnifyKey_(d.term)] = d.term;
    d.variants.forEach(function(v) { map[termUnifyKey_(v)] = d.term; });
  });
  return map;
}

function seedTermDictionary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(TERM_DICT_SHEET)) {
    Logger.log('「' + TERM_DICT_SHEET + '」已存在，沒有動它');
    return;
  }
  const sheet = ss.insertSheet(TERM_DICT_SHEET);
  const extraByTerm = {};
  Object.keys(TERM_UNIFY_SEED_EXTRA).forEach(function(v) {
    const t = TERM_UNIFY_SEED_EXTRA[v];
    (extraByTerm[t] = extraByTerm[t] || []).push(v);
  });
  const rows = [TERM_DICT_HEADERS];
  TERM_UNIFY_SEED.forEach(function(t) {
    rows.push([t, (extraByTerm[t] || []).join(', '), (TERM_UNIFY_SEED_ALIASES[t] || []).join(', '), '']);
  });
  Object.keys(TERM_UNIFY_SEED_ALIASES).forEach(function(t) {
    if (TERM_UNIFY_SEED.indexOf(t) < 0) rows.push([t, '', TERM_UNIFY_SEED_ALIASES[t].join(', '), '']);
  });
  sheet.getRange(1, 1, rows.length, TERM_DICT_HEADERS.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, TERM_DICT_HEADERS.length).setFontWeight('bold');
  sheet.setColumnWidth(1, 220); sheet.setColumnWidth(2, 260); sheet.setColumnWidth(3, 200); sheet.setColumnWidth(4, 200);
  sheet.getRange(1, 2).setNote('會被改寫成統一詞的寫法（逗號分隔）。只差大小寫／空白／全半形／臺台的不用列');
  sheet.getRange(1, 3).setNote('不改資料，只讓網站搜得到（逗號分隔）。例：寵物醫院 → 動物醫院');
  ss.setActiveSheet(sheet);
  Logger.log('已建立「' + TERM_DICT_SHEET + '」：' + (rows.length - 1) + ' 列');
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

// ==========================================
// 一次性：模糊搜尋清單搬進「統一詞」表（2026-10-15 站長逐條確認）
// ==========================================
// importFuzzyAliases：表上已有的統一詞 → 把缺的其他寫法／搜尋別名補進那一列；沒有的 → 加新列；
// FUZZY_IMPORT_REMOVE 列的統一詞整列刪掉。重複執行不會重複加（已有的就跳過）。
// 跑完照常 previewTermUnify → applyTermUnify（「其他寫法」那幾個會改資料）→ exportToJSON
const FUZZY_IMPORT_REMOVE = ['PChome'];   // 站長：不要「PChome」，分成 PChome 24h購物／PChome商店街
const FUZZY_IMPORT = [
  // A. 已在表上的統一詞
  { term: 'PChome 24h購物', aliases: ['pchome24h'] },
  { term: 'MOMO購物網', aliases: ['momo'] },
  { term: 'Line Pay', aliases: ['linepay'] },
  { term: '台灣Pay', aliases: ['台灣支付', 'taiwan pay', 'taiwanpay'] },
  { term: 'Foodpanda', aliases: ['food panda', '熊貓'] },
  { term: 'Uber Eats', aliases: ['ubereats', 'ubereat', 'uber eat'] },
  { term: 'IKEA', aliases: ['ikea宜家家居', '宜家', '宜家家居'] },
  { term: 'H&M', aliases: ['hnm'] },
  { term: 'Meta廣告', aliases: ['fb廣告', 'facebook廣告', 'meta 廣告', 'fb ads', 'meta ads'] },
  { term: 'Google廣告', aliases: ['google 廣告', 'google ads'] },
  { term: '台北捷運', aliases: ['臺北捷運'] },
  { term: '動物醫院', aliases: ['寵物醫院'] },
  // B. 新列
  { term: 'PChome商店街' },
  { term: '7-11', aliases: ['711', '7eleven', '7 11', '7-eleven'] },
  { term: '蝦皮購物', aliases: ['shopee', '蝦皮'] },
  { term: '樂天市場', aliases: ['rakuten', '樂天'] },
  { term: 'Yahoo購物中心' },
  { term: 'Yahoo拍賣' },
  { term: '好市多', aliases: ['costco'] },
  { term: '全家', aliases: ['familymart', '全家便利商店'] },
  { term: '萊爾富', aliases: ['莱尔富', 'hi-life'] },
  { term: 'OK超商', aliases: ['ok mart', 'okmart'] },
  { term: '全聯福利中心', aliases: ['pxmart', '全聯'] },
  { term: '全聯小時達', aliases: ['小時達'] },
  { term: '家樂福', aliases: ['carrefour'] },
  { term: '大潤發', aliases: ['rt-mart'] },
  { term: '麥當勞', aliases: ['mcd', 'mcdonalds'] },
  { term: '星巴克', aliases: ['starbucks'] },
  { term: 'Apple Pay', aliases: ['applepay', 'apple wallet'] },
  { term: 'Google Pay', aliases: ['googlepay'] },
  { term: 'Samsung Pay', aliases: ['samsungpay'] },
  { term: 'Apple Store 線上商店', variants: ['Apple官網', 'Apple Store 在線商城'] },
  { term: 'Pi拍錢包', aliases: ['pi錢包', 'pi wallet'] },
  { term: '國外', aliases: ['海外', 'overseas'] },
  { term: '愛奇藝', aliases: ['iqiyi'] },
  { term: '街口支付', aliases: ['街口', 'jkopay'] },
  { term: '悠遊付', aliases: ['easy wallet', 'easywallet'] },
  { term: '長榮航空', aliases: ['長榮', 'eva air', 'evaair'] },
  { term: '中華航空', aliases: ['華航', 'china airlines'] },
  { term: '立榮航空', aliases: ['立榮', 'uni air', 'uniair'] },
  { term: '星宇航空', aliases: ['星宇', 'starlux', 'starlux airlines'] },
  { term: '日本航空', aliases: ['日航', 'japan airlines', 'jal'] },
  { term: '全日空', aliases: ['ana', 'all nippon airways'] },
  { term: '大韓航空', aliases: ['大韓', 'korean air'] },
  { term: '韓亞航空', aliases: ['韓亞', 'asiana airlines'] },
  { term: '國泰航空', aliases: ['cathay pacific'] },
  { term: '新加坡航空', aliases: ['新航', 'singapore airlines', 'sia'] },
  { term: '泰國航空', aliases: ['泰航', 'thai airways'] },
  { term: '馬來西亞航空', aliases: ['馬航', 'malaysia airlines'] },
  { term: '亞洲航空', aliases: ['airasia'] },
  { term: '越南航空', aliases: ['越航', 'vietnam airlines'] },
  { term: '菲律賓航空', aliases: ['菲航', 'philippine airlines'] },
  { term: '華信航空', aliases: ['華信', 'mandarin airlines'] },
  { term: '高鐵', aliases: ['台灣高鐵', 'taiwan high speed rail', 'high speed rail', 'thsr'] },
  { term: '迪卡儂', aliases: ['decathlon'] },
  { term: '綠藤生機', aliases: ['綠藤', 'greenvines'] },
  { term: '屈臣氏', aliases: ['watsons'] },
  { term: '康是美', aliases: ['cosmed'] },
  { term: '餐飲', aliases: ['餐廳'] },
  { term: '國內餐飲', aliases: ['國內餐廳'] },
  { term: '國外餐飲', aliases: ['國外餐廳'] },
  { term: '全台餐飲', aliases: ['全台餐廳', '全臺餐廳'] },
  { term: '國內國外餐飲', aliases: ['國內國外餐廳'] },
  { term: '好樂迪', aliases: ['holiday ktv'] },
  { term: '錢櫃', aliases: ['party world'] },
  { term: 'ABC-MART', aliases: ['abc mart'] },
  { term: '宜得利', aliases: ['nitori'] },
  { term: "Mia C'bon", aliases: ['mia cbon'] },
  { term: "Tomod's", aliases: ['tomods'] },
  { term: '遠東SOGO', aliases: ['sogo'] },
  { term: '公路養管費(原燃料費)', aliases: ['公路使用養護安全管理費', '汽車燃料使用費', '公路養管費', '燃料費', '汽燃費'] },
  { term: '小額支付特約商店', aliases: ['小額支付特約商家'] },
  { term: 'M.A.C', aliases: ['mac'] },
  // 唐吉訶德：日本／台灣分開，都要有中英；錯字「軻」改掉
  { term: '唐吉訶德', aliases: ['唐吉軻德', 'donki', 'don don donki'] },
  { term: '台灣唐吉訶德 DON DON DONKI 實體門市', variants: ['台灣唐吉軻德 DON DON DONKI 實體門市'] },
  { term: '日本唐吉訶德 DON DON DONKI 實體門市', variants: ['日本唐吉訶德實體門市'] },
  { term: '日本唐吉訶德 DON DON DONKI', variants: ['日本唐吉軻德'] },
  // 三井：OUTLET 統一中英；LaLaport 兩種寫法各自統一；誠品三井店、LaLaport 南港保留
  { term: '三井 MITSUI OUTLET PARK', variants: ['MITSUI OUTLET PARK', '三井(MITSUIOUTLETPARK)'],
    aliases: ['三井', '三井outlet', 'mitsui', 'mitsui outlet'] },
  { term: 'Mitsui Shopping Park LaLaport' },
  { term: 'Mitsui Shopping Park LaLaport(南港/台中)', variants: ['Mitsui Shopping Park LaLaport(南港、台中)'] }
];

function importFuzzyAliases() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TERM_DICT_SHEET);
  if (!sheet) throw new Error('找不到「' + TERM_DICT_SHEET + '」工作表——先執行 seedTermDictionary');
  const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(x) { return String(x).trim(); });
  const cT = h.indexOf('統一詞') + 1, cV = h.indexOf('其他寫法') + 1, cA = h.indexOf('搜尋別名') + 1;
  if (!cT || !cV || !cA) throw new Error('「' + TERM_DICT_SHEET + '」表頭要有：統一詞、其他寫法、搜尋別名');
  const split = function(v) { return String(v || '').split(/[,，\n]/).map(function(x) { return x.trim(); }).filter(Boolean); };
  const merge = function(cell, add) {
    const list = split(cell);
    const lower = list.map(function(x) { return x.toLowerCase(); });
    (add || []).forEach(function(a) { if (lower.indexOf(a.toLowerCase()) < 0) { list.push(a); lower.push(a.toLowerCase()); } });
    return list.join(', ');
  };
  let log = [];
  // 1. 刪列（由下往上刪，列號才不會跑掉）
  let data = sheet.getDataRange().getValues();
  for (let r = data.length - 1; r >= 1; r--) {
    const t = String(data[r][cT - 1] || '').trim();
    if (FUZZY_IMPORT_REMOVE.some(function(x) { return termUnifyKey_(x) === termUnifyKey_(t); })) {
      sheet.deleteRow(r + 1);
      log.push('刪除：' + t);
    }
  }
  // 2. 補進現有列／加新列
  data = sheet.getDataRange().getValues();
  const rowOf = {};
  for (let r = 1; r < data.length; r++) {
    const t = String(data[r][cT - 1] || '').trim();
    if (t) rowOf[termUnifyKey_(t)] = r;
  }
  const newRows = [];
  let updated = 0;
  FUZZY_IMPORT.forEach(function(e) {
    const r = rowOf[termUnifyKey_(e.term)];
    if (r === undefined) {
      const row = h.map(function() { return ''; });
      row[cT - 1] = e.term; row[cV - 1] = (e.variants || []).join(', '); row[cA - 1] = (e.aliases || []).join(', ');
      newRows.push(row);
      return;
    }
    const v = merge(data[r][cV - 1], e.variants), a = merge(data[r][cA - 1], e.aliases);
    if (v !== String(data[r][cV - 1] || '') || a !== String(data[r][cA - 1] || '')) {
      sheet.getRange(r + 1, cV).setValue(v);
      sheet.getRange(r + 1, cA).setValue(a);
      updated++;
    }
  });
  if (newRows.length) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, h.length).setValues(newRows);
  log.push('補進現有列：' + updated + ' 列', '新增：' + newRows.length + ' 列');
  Logger.log('模糊搜尋清單匯入完成\n' + log.join('\n') + '\n下一步：previewTermUnify → applyTermUnify → exportToJSON');
  ss.setActiveSheet(sheet);
}
