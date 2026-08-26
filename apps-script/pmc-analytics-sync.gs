// ========================================
// Pick My Card — GA4 + GSC + Clarity 自動同步腳本
// ========================================

const GA4_PROPERTY_ID = '505426795';
const GSC_SITE_URL = 'sc-domain:pickmycard.app';

// Clarity（2026/07 加入）
const CLARITY_ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
const CLARITY_SHEET = 'Clarity_每日';

// ========================================
// 統計視窗定義（2026/07/31 加入）
// ----------------------------------------
// 為什麼要把這些數字抽成常數：GA4_頁面成效／GA4_流量來源／GSC_頁面／GSC_關鍵字 這四張表
// 都是**滾動視窗快照**——每次執行 sheet.clear() 整表覆寫，內容永遠只是「最近 N 天」的彙總，
// 不保留任何歷史。表上如果沒寫清楚是哪 N 天，讀表的人（或 AI）看到的就只是一堆沒有時間座標
// 的數字：跨月比較會比錯、拿舊截圖對照會對錯。所以視窗參數只有這裡一處定義，
// 送 API 的請求和寫進表頭的標註都從同一個來源取值，兩者不可能漂移。
// ========================================

const GA4_WINDOW_DAYS = 30;  // GA4 滾動視窗：today-30 ~ today-1（yesterday），含頭尾共 30 個完整日
const GSC_WINDOW_DAYS = 28;  // GSC 滾動視窗：含頭尾共 28 天＝正好 4 個完整週
const GSC_LAG_DAYS = 3;      // GSC 資料通常延遲 2–3 天，視窗結束日往前推 3 天留緩衝

const GSC_QUERY_ROW_LIMIT = 500;  // GSC_關鍵字 取回列數上限（超過會被 API 截斷，標註在表頭）
const GSC_PAGE_ROW_LIMIT = 100;   // GSC_頁面 取回列數上限
const GA4_CLICK_ROW_LIMIT = 500;  // GA4_申辦點擊 取回列數上限（卡片 × 按鈕類型的組合數）
const GA4_SEARCH_ROW_LIMIT = 500; // GA4_熱門搜尋 取回列數上限（不重複的搜尋字串數）

// 歷史快照（把滾動視窗表每週存一份，才有趨勢可比較——見「歷史快照累積」區塊）
const HISTORY_SNAPSHOT_WEEKDAY = 1;   // 每週幾存一次：0=週日、1=週一 …… 6=週六
const HISTORY_SNAPSHOT_MAX_GAP_DAYS = 7;  // 距上次快照超過這天數就補存（不必等到快照日）
const HISTORY_KEYWORD_TOP_N = 200;    // 關鍵字歷史只存前 N 名（500 全存會很快把列數撐爆）
const HISTORY_TOP_N = 100;            // 其餘歷史表的每次存檔上限

// 視窗類型（決定表頭第一行怎麼描述這張表）
const WINDOW_ROLLING = 'rolling';        // 滾動視窗：只有最近 N 天，整表覆寫、不累積
const WINDOW_CUMULATIVE = 'cumulative';  // 累積期間：上線至今完整重抓，整表覆寫

// 標註佔用的列數：第 1–2 列是視窗標註，第 3 列才是欄位標題，資料從第 4 列開始
const BANNER_ROWS = 2;
const HEADER_ROW = BANNER_ROWS + 1;
const DATA_START_ROW = HEADER_ROW + 1;

// ========================================
// 主流程：一次更新全部
// ----------------------------------------
// 執行韌性設計（2026/07/31 改寫）——舊版是一條直線的呼叫串，有兩個會靜默吃掉資料的問題：
//   (1) 任一步 throw（GA4 暫時性錯誤、GSC 401、配額）整個執行就中止；而 syncClarityData()
//       排在**最後**，前面隨便哪一步掛掉，當天的 Clarity 資料就永久消失——Clarity API 只留
//       1–3 天，過了就再也拿不回來。
//   (2) writeLastUpdated() 也在最後，所以失敗時「更新紀錄」連一行都不會寫，你完全不會發現。
// 現在改成：Clarity 排第一（最脆弱、最不可補）→ 每個步驟各自 try/catch 不互相拖累 →
// 無論結果如何最後一定寫一行含各步驟成敗的更新紀錄。
//
// 另外注意一個刻意保留的性質：每個 update 函數都是「先打完 API 拿到資料，才呼叫
// writeSnapshotSheet_ 清空重寫」。所以某步失敗時，那張表**維持上一次成功的內容**（不會被清空
// 留下空表），而表頭的「本次更新」時間戳會停在上次，一眼看得出資料過期。
// ========================================

function updateAllReports() {
  const results = [];

  // ── Clarity 排第一 ──
  // 唯一「今天沒抓到就永遠沒有」的資料源，必須在任何可能 throw 的步驟之前跑完。
  // syncClarityData() 內部已把預期錯誤轉成回傳值，這裡再包一層擋未預期例外。
  let clarityMessage;
  try {
    clarityMessage = syncClarityData().message;
  } catch (e) {
    clarityMessage = 'Clarity 失敗：未預期例外——' + errText_(e);
    Logger.log(clarityMessage);
  }

  // 各報表獨立跑；collected 收下每步的資料，稍後給歷史快照用（避免為了存歷史再打一次 API）
  const collected = {};
  collected.ga4Daily    = runStep_(results, 'GA4_每日趨勢',  updateGA4Daily);
  collected.ga4Channels = runStep_(results, 'GA4_流量來源',  updateGA4Channels);
  collected.ga4Pages    = runStep_(results, 'GA4_頁面成效',  updateGA4Pages);
  collected.ga4Events   = runStep_(results, 'GA4_事件成效',  updateGA4Events);
  collected.cardClicks  = runStep_(results, 'GA4_申辦點擊',  updateGA4CardClicks);
  collected.searches    = runStep_(results, 'GA4_熱門搜尋',  updateGA4MerchantSearches);
  collected.gscQueries  = runStep_(results, 'GSC_關鍵字',    updateGSCQueries);
  collected.gscPages    = runStep_(results, 'GSC_頁面',      updateGSCPages);
  runStep_(results, 'GA4_歷史每日趨勢', importGA4History);
  runStep_(results, 'GSC_歷史每日趨勢', importGSCHistory);

  const historyMessage = runStep_(results, '歷史快照累積', () => appendHistorySnapshots_(collected, false));

  // 這行一定要寫得出來，否則「執行過但全掛」跟「根本沒執行」在紀錄上長得一樣
  try {
    writeLastUpdated(clarityMessage, results, historyMessage);
  } catch (e) {
    Logger.log('連更新紀錄都寫不進去：' + errText_(e));
  }
}

// 跑一個步驟：成功回傳該函數的回傳值，失敗記一筆並回 null（不讓它中斷其他步驟）
function runStep_(results, name, fn) {
  try {
    const out = fn();
    results.push({ name: name, ok: true });
    return out;
  } catch (e) {
    const msg = errText_(e);
    results.push({ name: name, ok: false, error: msg });
    Logger.log('步驟失敗：' + name + '——' + msg);
    return null;
  }
}

function errText_(e) {
  const raw = (e && e.message) ? e.message : String(e);
  return raw.replace(/\s+/g, ' ').slice(0, 200); // 壓成一行，免得塞爆更新紀錄那格
}

// ========================================
// 視窗標註共用工具
// ========================================

// GA4 滾動視窗。
// ⚠️ 送給 API 的仍然是相對字串 '30daysAgo' / 'yesterday'——這樣 GA4 會**用資源本身的時區**
// 解析日界線，保證拿到的是完整日；若改成在這裡算好日期送過去，指令碼時區與 GA4 資源時區
// 只要差一小時，endDate 就可能落在 GA4 眼中的「今天」而抓到半天的殘缺資料。
// 下面的 start/end 只用來「顯示」，因此表頭會註明區間由 GA4 資源時區判定。
function ga4Window_() {
  const end = new Date();
  end.setDate(end.getDate() - 1);                    // yesterday
  const start = new Date();
  start.setDate(start.getDate() - GA4_WINDOW_DAYS);  // 30daysAgo
  return {
    startSpec: GA4_WINDOW_DAYS + 'daysAgo',
    endSpec: 'yesterday',
    start: start,
    end: end,
    days: GA4_WINDOW_DAYS,
  };
}

// GSC 滾動視窗：結束日＝today-3（延遲緩衝），往前推到含頭尾正好 GSC_WINDOW_DAYS 天。
// ⚠️ 這裡刻意是 -(GSC_WINDOW_DAYS - 1)：Search Console API 的 startDate/endDate 都是**含**的，
// 舊版寫 -28 實際拿到的是 29 天（多算一個星期幾，週間季節性會被灌水）。
function gscWindow_() {
  const end = new Date();
  end.setDate(end.getDate() - GSC_LAG_DAYS);
  const start = new Date(end);
  start.setDate(start.getDate() - (GSC_WINDOW_DAYS - 1));
  return { start: start, end: end, days: GSC_WINDOW_DAYS };
}

function formatSlash_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
}

function formatStamp_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
}

function daysInclusive_(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

// 第 1 列：這張表「是什麼」——一眼看出是滾動快照還是累積期間
function bannerTitle_(sheetName, meta) {
  const kind = meta.window === WINDOW_ROLLING
    ? '滾動視窗快照（rolling ' + meta.days + ' 天）'
    : '累積期間快照（' + LAUNCH_DATE + ' 上線至今）';
  return '📊 ' + sheetName + '｜' + kind;
}

// 第 2 列：這張表「涵蓋哪幾天、怎麼寫入、何時更新」——跨月比較前必看的三件事
function bannerDetail_(meta) {
  const parts = [
    '統計區間：' + formatSlash_(meta.start) + ' ~ ' + formatSlash_(meta.end) +
      '（含頭尾共 ' + daysInclusive_(meta.start, meta.end) + ' 天）',
    '寫入方式：每次執行整表覆寫，不保留歷史快照（要比較趨勢請自行另存）',
    '資料來源：' + meta.source,
    '本次更新：' + formatStamp_(new Date()),
  ];
  if (meta.note) parts.push(meta.note);
  return parts.join('｜');
}

// 統一的「清空 → 寫視窗標註 → 寫欄位標題 → 寫資料」寫入器。
// 所有覆寫式報表都走這裡，標註格式才不會各表長不一樣。
function writeSnapshotSheet_(sheetName, meta, headers, values) {
  const sheet = getOrCreateSheet(sheetName);
  sheet.clear();

  sheet.getRange(1, 1).setValue(bannerTitle_(sheetName, meta))
    .setFontWeight('bold').setFontSize(11);
  sheet.getRange(2, 1).setValue(bannerDetail_(meta))
    .setFontSize(9).setFontColor('#666666');

  sheet.getRange(HEADER_ROW, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(HEADER_ROW);

  if (values.length > 0) {
    sheet.getRange(DATA_START_ROW, 1, values.length, headers.length).setValues(values);
  } else {
    // 明講「沒資料」而不是留白——留白分不出「視窗內真的零流量」和「API 回傳異常」
    sheet.getRange(DATA_START_ROW, 1)
      .setValue('（本次同步取回 0 列。可能是視窗內確實沒有資料，也可能是 API 異常——請對照「更新紀錄」分頁）')
      .setFontColor('#999999');
  }
  return sheet;
}

// ---------- GA4：近 30 天每日趨勢 ----------
function updateGA4Daily() {
  const win = ga4Window_();

  const dimension = AnalyticsData.newDimension();
  dimension.name = 'date';

  const metricUsers = AnalyticsData.newMetric();
  metricUsers.name = 'activeUsers';
  const metricSessions = AnalyticsData.newMetric();
  metricSessions.name = 'sessions';
  const metricViews = AnalyticsData.newMetric();
  metricViews.name = 'screenPageViews';
  const metricEngagement = AnalyticsData.newMetric();
  metricEngagement.name = 'engagementRate';

  const dateRange = AnalyticsData.newDateRange();
  dateRange.startDate = win.startSpec;
  dateRange.endDate = win.endSpec;

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dimension];
  request.metrics = [metricUsers, metricSessions, metricViews, metricEngagement];
  request.dateRanges = [dateRange];

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);

  const rows = report.rows || [];
  const sortedRows = rows.slice().sort((a, b) =>
    a.dimensionValues[0].value.localeCompare(b.dimensionValues[0].value)
  );

  const values = sortedRows.map(row => {
    const d = row.dimensionValues[0].value;
    const formattedDate = d.slice(0, 4) + '/' + d.slice(4, 6) + '/' + d.slice(6, 8);
    return [
      formattedDate,
      row.metricValues[0].value,
      row.metricValues[1].value,
      row.metricValues[2].value,
      row.metricValues[3].value,
    ];
  });

  const headers = ['日期', '活躍用戶', 'Sessions', '頁面瀏覽', '互動率'];
  writeSnapshotSheet_('GA4_每日趨勢', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID + '（' + win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定；逐日資料另有「GA4_歷史每日趨勢」保存上線至今全期',
  }, headers, values);

  return { headers: headers, values: values, window: win };
}

// ---------- GA4：近 30 天流量來源 ----------
function updateGA4Channels() {
  const win = ga4Window_();

  const dimension = AnalyticsData.newDimension();
  dimension.name = 'sessionDefaultChannelGroup';

  const metricSessions = AnalyticsData.newMetric();
  metricSessions.name = 'sessions';
  const metricUsers = AnalyticsData.newMetric();
  metricUsers.name = 'activeUsers';
  const metricEngagement = AnalyticsData.newMetric();
  metricEngagement.name = 'engagementRate';

  const dateRange = AnalyticsData.newDateRange();
  dateRange.startDate = win.startSpec;
  dateRange.endDate = win.endSpec;

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dimension];
  request.metrics = [metricSessions, metricUsers, metricEngagement];
  request.dateRanges = [dateRange];

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);

  const rows = report.rows || [];
  const sortedRows = rows.slice().sort((a, b) =>
    Number(b.metricValues[0].value) - Number(a.metricValues[0].value)
  );

  const values = sortedRows.map(row => [
    row.dimensionValues[0].value,
    row.metricValues[0].value,
    row.metricValues[1].value,
    row.metricValues[2].value,
  ]);

  const headers = ['流量來源', 'Sessions', '活躍用戶', '互動率'];
  writeSnapshotSheet_('GA4_流量來源', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID + '，維度 sessionDefaultChannelGroup（' +
      win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定；本表為區間**加總**，非日均值',
  }, headers, values);

  return { headers: headers, values: values, window: win };
}

// ---------- GSC：近 28 天關鍵字表現 ----------
function updateGSCQueries() {
  const result = fetchGSCData(['query'], GSC_QUERY_ROW_LIMIT);
  const rows = (result.data && result.data.rows) || [];

  const values = rows.map(row => [
    row.keys[0],
    row.clicks,
    row.impressions,
    (row.ctr * 100).toFixed(2) + '%',
    row.position.toFixed(1),
  ]);

  const headers = ['關鍵字', '點擊數', '曝光數', 'CTR', '平均排名'];
  writeSnapshotSheet_('GSC_關鍵字', {
    window: WINDOW_ROLLING,
    start: result.window.start,
    end: result.window.end,
    days: result.window.days,
    source: 'Search Console ' + GSC_SITE_URL + '，維度 query',
    note: '結束日已扣掉 ' + GSC_LAG_DAYS + ' 天資料延遲緩衝｜最多取 ' + GSC_QUERY_ROW_LIMIT +
      ' 列，超過會被 API 截斷（點擊由多到少）｜CTR/平均排名為區間內加權結果，非每日平均' +
      '｜每週快照存進「GSC_關鍵字_歷史」，排名趨勢看那張',
  }, headers, values);

  return { headers: headers, values: values, window: result.window };
}

// ---------- GSC：近 28 天頁面表現 ----------
function updateGSCPages() {
  const result = fetchGSCData(['page'], GSC_PAGE_ROW_LIMIT);
  const rows = (result.data && result.data.rows) || [];

  const values = rows.map(row => [
    row.keys[0],
    row.clicks,
    row.impressions,
    (row.ctr * 100).toFixed(2) + '%',
    row.position.toFixed(1),
  ]);

  const headers = ['頁面', '點擊數', '曝光數', 'CTR', '平均排名'];
  writeSnapshotSheet_('GSC_頁面', {
    window: WINDOW_ROLLING,
    start: result.window.start,
    end: result.window.end,
    days: result.window.days,
    source: 'Search Console ' + GSC_SITE_URL + '，維度 page',
    note: '結束日已扣掉 ' + GSC_LAG_DAYS + ' 天資料延遲緩衝｜最多取 ' + GSC_PAGE_ROW_LIMIT +
      ' 列，超過會被 API 截斷（點擊由多到少）｜CTR/平均排名為區間內加權結果，非每日平均' +
      '｜每週快照存進「GSC_頁面_歷史」',
  }, headers, values);

  return { headers: headers, values: values, window: result.window };
}

// ---------- GSC 共用：呼叫 Search Console API ----------
// 回傳 { data, window }：window 就是這次實際送出去的區間，讓表頭標註不可能跟請求對不上
function fetchGSCData(dimensions, rowLimit) {
  const win = gscWindow_();

  const url = 'https://www.googleapis.com/webmasters/v3/sites/' +
    encodeURIComponent(GSC_SITE_URL) + '/searchAnalytics/query';

  const payload = {
    startDate: formatDate(win.start),
    endDate: formatDate(win.end),
    dimensions: dimensions,
    rowLimit: rowLimit,
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  return { data: JSON.parse(response.getContentText()), window: win };
}

function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ---------- 共用工具 ----------
function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

// 寫「更新紀錄」一行。三個參數都是選填，但正常流程都會帶：
//   clarityMessage：Clarity 同步狀態；results：各步驟成敗；historyMessage：歷史快照結果
// 開頭用 ✅／⚠️ 標整體狀態（失敗的步驟連錯誤訊息一起寫出來，不用去翻執行紀錄），
// 後面接本次兩個滾動視窗的實際日期——事後追「這份數字是哪幾天的」有據可查。
function writeLastUpdated(clarityMessage, results, historyMessage) {
  const sheet = getOrCreateSheet('更新紀錄');
  const ga4 = ga4Window_();
  const gsc = gscWindow_();

  const steps = results || [];
  const failed = steps.filter(r => !r.ok);
  const status = steps.length === 0
    ? '已更新 GA4 + GSC 資料'
    : (failed.length === 0
        ? '✅ ' + steps.length + ' 個報表全部更新成功'
        : '⚠️ ' + steps.length + ' 個報表中 ' + failed.length + ' 個失敗：' +
          failed.map(r => r.name + '（' + r.error + '）').join('、') +
          '——這些表維持上次成功的內容，數字已過期');

  const parts = [
    status,
    'GA4 視窗 ' + formatSlash_(ga4.start) + '~' + formatSlash_(ga4.end) + ' 共 ' + ga4.days + ' 天',
    'GSC 視窗 ' + formatSlash_(gsc.start) + '~' + formatSlash_(gsc.end) + ' 共 ' + gsc.days + ' 天',
  ];
  if (clarityMessage) parts.push(clarityMessage);
  if (historyMessage) parts.push(historyMessage);

  sheet.appendRow([new Date(), parts.join('；')]);
}

// ========================================
// Microsoft Clarity — 每日資料同步（2026/07 加入）
// ========================================
//
// 硬限制（超過會整個 Clarity 專案當天被鎖）：
//   - 每專案每天最多 10 次 API 呼叫（不分來源，手動測試也算）
//   - 只能拿過去 1–3 天資料，超過永久遺失 → 每天累加寫入、不覆蓋
//   - 單次最多 3 個 dimension／回傳最多 1000 筆／不能分頁
//
// 由 updateAllReports() 呼叫；回傳 { ok, skipped, message }，message 交給
// writeLastUpdated() 併進「更新紀錄」那行（本函數自己不寫更新紀錄，格式才一致）。
//
// ※ Clarity_每日 是**逐日累加**表（每列自帶「日期」欄），不是滾動快照，因此沒有套用上面的
//   視窗標註：它唯一的歷史就在那些列裡，在既有資料上方插入標註列有搬錯資料的風險，
//   而每列已有日期、時間座標本來就不缺。

function syncClarityData() {
  const props = PropertiesService.getScriptProperties();
  const today = formatDate(new Date()); // 沿用既有 formatDate（Session 時區、yyyy-MM-dd）

  // ── 防重複呼叫保護 ──
  // 今天已成功同步過就跳過，避免手動重跑把當日 10 次額度用完（用完整專案當天被鎖）
  if (props.getProperty('CLARITY_LAST_SYNC_DATE') === today) {
    const msg = 'Clarity 跳過（今日 ' + today + ' 已同步過，保護每日 10 次額度）';
    Logger.log(msg);
    return { ok: false, skipped: true, message: msg };
  }

  const token = props.getProperty('CLARITY_API_TOKEN');
  if (!token) {
    const msg = 'Clarity 失敗：找不到指令碼屬性 CLARITY_API_TOKEN';
    Logger.log(msg);
    return { ok: false, skipped: false, message: msg };
  }

  const url = CLARITY_ENDPOINT + '?numOfDays=1&dimension1=URL'; // 只抓最近 24hr、按頁面拆
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true, // 自己判 code 才能對 401 / 429 給明確訊息
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    let reason;
    if (code === 401) {
      reason = 'token 失效或錯誤（401 Unauthorized）——請確認 CLARITY_API_TOKEN 或到 Clarity 重新產生';
    } else if (code === 429) {
      reason = '超過每日 10 次 API 額度（429）——當日已用完，需等隔天恢復，勿再手動重跑';
    } else {
      reason = 'HTTP ' + code + '：' + response.getContentText().slice(0, 300);
    }
    const msg = 'Clarity 失敗：' + reason;
    Logger.log(msg);
    return { ok: false, skipped: false, message: msg };
  }

  let payload;
  try {
    payload = JSON.parse(response.getContentText());
  } catch (e) {
    const msg = 'Clarity 失敗：回傳非合法 JSON';
    Logger.log(msg);
    return { ok: false, skipped: false, message: msg };
  }
  if (!Array.isArray(payload)) {
    const msg = 'Clarity 失敗：回傳格式非預期（不是 JSON array）';
    Logger.log(msg);
    return { ok: false, skipped: false, message: msg };
  }

  const rows = buildClarityRows_(payload, today);

  // 成功但今日無資料：仍記已同步，避免反覆重打空資料燒額度
  if (rows.length === 0) {
    props.setProperty('CLARITY_LAST_SYNC_DATE', today);
    const msg = 'Clarity 完成：今日無頁面資料，未新增列';
    Logger.log(msg);
    return { ok: true, skipped: false, message: msg };
  }

  appendClarityRows_(rows);

  // 只有真的寫入成功才記已同步（放最後——中途失敗當天仍可重試，不會把自己鎖死一天）
  props.setProperty('CLARITY_LAST_SYNC_DATE', today);
  const msg = 'Clarity 完成：新增 ' + rows.length + ' 列（' + today + '）';
  Logger.log(msg);
  return { ok: true, skipped: false, message: msg };
}

// 把 Clarity 回傳（依 metricName 分組）轉成「一頁一列」。寫入前會：
//   (1) 濾掉 URL 含 .pages.dev 的列（Cloudflare Pages preview 部署流量，非真實用戶）
//   (2) URL 正規化（砍掉 ? 之後的 query 與 # 之後的 hash，只留路徑）後同路徑聚合：
//       次數類（Rage / Dead / Excessive Scroll / Traffic）加總；
//       平均類（Scroll Depth / Engagement Time）依各原始列的工作階段數做加權平均
// metricName 用正規化（去空白轉小寫）比對，避免 Clarity 端字串空白/大小寫變動就對不上
function buildClarityRows_(payload, dateStr) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  // 取數字：找到第一個可轉數字的欄就回傳，找不到回 null（用 null 才能跟真正的 0 區分）
  const pick = (item, keys) => {
    for (const k of keys) {
      const v = item[k];
      if (v !== undefined && v !== null && v !== '') {
        const n = Number(v);
        if (!isNaN(n)) return n;
      }
    }
    return null;
  };
  // URL 正規化：砍掉第一個 ? 或 # 之後的所有內容，只留路徑
  const stripUrl = u => {
    const s = String(u || '');
    const cut = s.search(/[?#]/);
    return cut === -1 ? s : s.slice(0, cut);
  };

  // ── 先照「原始 URL」收各指標（一個原始 URL 一筆）──
  const byRaw = {};
  const ensureRaw = u => {
    if (!byRaw[u]) {
      byRaw[u] = { url: u, rage: null, dead: null, excessiveScroll: null, scrollDepth: null, engagementTime: null, traffic: null };
    }
    return byRaw[u];
  };
  payload.forEach(metric => {
    const name = norm(metric && metric.metricName);
    const info = (metric && Array.isArray(metric.information)) ? metric.information : [];
    info.forEach(item => {
      const u = item.Url || item.URL || item.url || item.pageUrl || '(未分類)';
      const row = ensureRaw(u);
      if (name === 'rageclickcount' || name === 'rageclicks') {
        row.rage = pick(item, ['subTotal', 'rageClickCount', 'sessionsCount', 'pagesViews']);
      } else if (name === 'deadclickcount' || name === 'deadclicks') {
        row.dead = pick(item, ['subTotal', 'deadClickCount', 'sessionsCount', 'pagesViews']);
      } else if (name === 'excessivescroll' || name === 'excessivescrolling') {
        row.excessiveScroll = pick(item, ['subTotal', 'sessionsCount', 'pagesViews']);
      } else if (name === 'scrolldepth' || name === 'averagescrolldepth') {
        row.scrollDepth = pick(item, ['averageScrollDepth', 'subTotal']);
      } else if (name === 'engagementtime' || name === 'averageengagementtime') {
        row.engagementTime = pick(item, ['totalTime', 'activeTime', 'averageEngagementTime', 'subTotal']);
      } else if (name === 'traffic') {
        row.traffic = pick(item, ['totalSessionCount', 'distinctUserCount', 'sessionsCount', 'subTotal']);
      }
      // 其餘 metric（Popular Pages 等）暫不入表，需要時再加分支
    });
  });

  // ── (1) 濾 .pages.dev ＋ (2) 正規化路徑後聚合 ──
  const agg = {};
  const ensureAgg = p => {
    if (!agg[p]) {
      agg[p] = {
        path: p,
        // 次數類：加總（hasX 記錄該指標是否真的出現過，沒出現就留空、不寫 0）
        rage: 0, dead: 0, excessiveScroll: 0, traffic: 0,
        hasRage: false, hasDead: false, hasExcessive: false, hasTraffic: false,
        // 平均類：加權平均（wSum=Σ值×權重、wTot=Σ權重；權重全 0 時退回算術平均 aSum/aCount）
        sdWSum: 0, sdWTot: 0, sdASum: 0, sdACount: 0,
        etWSum: 0, etWTot: 0, etASum: 0, etACount: 0,
      };
    }
    return agg[p];
  };

  Object.keys(byRaw).forEach(rawUrl => {
    if (rawUrl.indexOf('.pages.dev') !== -1) return; // (1) 濾掉 Cloudflare Pages preview 流量
    const r = byRaw[rawUrl];
    const a = ensureAgg(stripUrl(rawUrl));            // (2) 正規化路徑後聚合
    const weight = (r.traffic != null) ? r.traffic : 0; // 加權平均權重 = 該原始列工作階段數

    if (r.rage != null) { a.rage += r.rage; a.hasRage = true; }
    if (r.dead != null) { a.dead += r.dead; a.hasDead = true; }
    if (r.excessiveScroll != null) { a.excessiveScroll += r.excessiveScroll; a.hasExcessive = true; }
    if (r.traffic != null) { a.traffic += r.traffic; a.hasTraffic = true; }

    if (r.scrollDepth != null) {
      a.sdWSum += r.scrollDepth * weight; a.sdWTot += weight;
      a.sdASum += r.scrollDepth; a.sdACount += 1;
    }
    if (r.engagementTime != null) {
      a.etWSum += r.engagementTime * weight; a.etWTot += weight;
      a.etASum += r.engagementTime; a.etACount += 1;
    }
  });

  const round2 = n => Math.round(n * 100) / 100;
  const avg = (wSum, wTot, aSum, aCount) => {
    if (wTot > 0) return round2(wSum / wTot);   // 正常：依工作階段數加權
    if (aCount > 0) return round2(aSum / aCount); // 權重全 0（無 Traffic）時退回算術平均
    return '';
  };

  return Object.keys(agg).map(p => {
    const a = agg[p];
    return [
      dateStr,
      a.path,
      a.hasRage ? a.rage : '',
      a.hasDead ? a.dead : '',
      a.hasExcessive ? a.excessiveScroll : '',
      avg(a.sdWSum, a.sdWTot, a.sdASum, a.sdACount),
      avg(a.etWSum, a.etWTot, a.etASum, a.etACount),
      a.hasTraffic ? a.traffic : '',
    ];
  });
}

// append 到 Clarity_每日（只加列、不覆蓋——API 留不住超過 3 天，靠這裡累積歷史）
function appendClarityRows_(rows) {
  const sheet = getOrCreateSheet(CLARITY_SHEET);
  const headers = ['日期', '頁面(URL)', 'Rage Click Count', 'Dead Click Count',
    'Excessive Scroll', 'Scroll Depth', 'Engagement Time', 'Traffic(工作階段數)'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

// ============================================================================
// 歷史快照累積（2026/07/31 新增）
// ----------------------------------------------------------------------------
// 解決的問題：四張滾動視窗表每次執行都 clear() 重寫，今天的快照蓋掉昨天的。於是
// 「某關鍵字排名從 15 爬到 8」「/promos 改版前後跳出率差多少」這類問題**永遠查不到**，
// 因為比較基準已經不存在。GA4 事後還能重抓，但 GSC 只保留 16 個月，而且事後重抓拿到的是
// 不同視窗，跟當初那份對不起來。
//
// 作法：每週存一份帶「快照日期＋視窗起訖」的副本到 *_歷史 表（append，永不覆蓋）。
//
// 為什麼是每週而不是每天：底下的視窗本來就是 28/30 天滾動，相鄰兩天的內容有 96% 重疊，
// 天天存只是把幾乎一樣的東西抄 365 遍、還會很快撐爆列數。每週一份剛好在一個視窗內取到
// 4 個資訊量不同的點。
//
// 列數估算（關鍵字表最大）：200 列 × 8 欄 × 52 週 ≈ 83,000 儲存格/年，離單一試算表
// 1,000 萬儲存格上限還很遠。
//
// 歷史表刻意**不加視窗標註列**：它是 append 表，每一列自己就帶著快照日期與視窗起訖，
// 時間座標比標註更精確；而且在既有資料上方插列有搬錯資料的風險（同 Clarity_每日 的理由）。
// ============================================================================

function appendHistorySnapshots_(collected, force) {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const today = formatDate(now);

  // 快照時機（2026-08-26 改）：快照日照常存；不是快照日、但距上次已滿
  // HISTORY_SNAPSHOT_MAX_GAP_DAYS 天，也存一份補回來。
  //
  // 為什麼要補跑：舊版只認「今天是不是快照日」。那天只要沒跑完——排程沒觸發、或跑到一半
  // 中斷都算——整週就沒有資料點，之後幾天再跑幾次都會被這道檢查擋掉，永遠補不回來。
  // 實際發生過兩次：2026-07-27 與 2026-08-24 兩個週一在「更新紀錄」裡連一行都沒有，
  // 歷史表就直接從 08-17 跳到下一次，那兩週的趨勢點永久消失。
  //
  // 補跑不會讓節奏愈飄愈後面：補完之後距下個快照日只剩幾天，「今天是快照日」那條會接手，
  // 自己回到原本的星期。重複寫入由每張表的快照日期去重擋掉（見 appendHistoryRows_）。
  let catchUp = false;
  if (!force) {
    // 同一天手動重跑 updateAllReports 不該存出兩份一模一樣的快照
    const last = props.getProperty('HISTORY_LAST_SNAPSHOT_DATE');
    if (last === today) {
      return '歷史快照：今日（' + today + '）已存過，略過';
    }

    const isSnapshotDay = now.getDay() === HISTORY_SNAPSHOT_WEEKDAY;
    // gap 為 null＝沒有可用的上次日期（第一次跑，或屬性被清掉）→ 當成該存
    const gap = daysBetweenDateStrings_(last, today);
    catchUp = !isSnapshotDay && (gap === null || gap >= HISTORY_SNAPSHOT_MAX_GAP_DAYS);

    if (!isSnapshotDay && !catchUp) {
      return '歷史快照：今天非快照日（每週' + WEEKDAY_LABELS[HISTORY_SNAPSHOT_WEEKDAY] +
        '存一次），距上次快照 ' + gap + ' 天未滿 ' + HISTORY_SNAPSHOT_MAX_GAP_DAYS + ' 天，略過';
    }
  }

  const jobs = [
    { key: 'gscQueries',  sheet: 'GSC_關鍵字_歷史',     topN: HISTORY_KEYWORD_TOP_N },
    { key: 'gscPages',    sheet: 'GSC_頁面_歷史',       topN: HISTORY_TOP_N },
    { key: 'ga4Pages',    sheet: 'GA4_頁面成效_歷史',   topN: HISTORY_TOP_N },
    { key: 'ga4Channels', sheet: 'GA4_流量來源_歷史',   topN: HISTORY_TOP_N },
    { key: 'ga4Events',   sheet: 'GA4_事件成效_歷史',   topN: HISTORY_TOP_N },
    { key: 'cardClicks',  sheet: 'GA4_申辦點擊_歷史',   topN: HISTORY_TOP_N },
    { key: 'searches',    sheet: 'GA4_熱門搜尋_歷史',   topN: HISTORY_TOP_N },
  ];

  const done = [];
  const skipped = [];
  const duplicated = [];
  const failed = [];
  jobs.forEach(job => {
    const src = collected[job.key];
    // 該步驟失敗時 collected[key] 是 null——寧可這週沒存，也不要存一份空的假快照
    if (!src || !src.values || src.values.length === 0) {
      skipped.push(job.sheet);
      return;
    }
    const headers = ['快照日期', '視窗起', '視窗迄'].concat(src.headers);
    const rows = src.values.slice(0, job.topN).map(r =>
      [today, formatDate(src.window.start), formatDate(src.window.end)].concat(r)
    );
    // 每張表各自 try/catch：一張表的表頭對不上不該讓其他表這週也存不成
    try {
      const written = appendHistoryRows_(job.sheet, headers, rows, today);
      if (written === null) {
        duplicated.push(job.sheet);   // 這張表今天已經有一份，沒有再寫
      } else {
        done.push(job.sheet + '(' + written + ')');
      }
    } catch (e) {
      failed.push(job.sheet + '：' + errText_(e));
      Logger.log('歷史快照失敗 ' + job.sheet + '——' + errText_(e));
    }
  });

  // 「今天存過了」只在**真的有動到東西**時才記（同 syncClarityData 的成功才記狀態）。
  // 舊版無條件寫入：週一若上游步驟全失敗、七張表一張都沒存成，仍會記下今天，
  // 當天重跑 updateAllReports() 會被上面的防重複擋掉 → 那週快照永久消失、且無補跑邏輯。
  // duplicated 也算「動到了」：那代表今天確實已有快照，只是被每表去重擋下，不需要再重試。
  // 全部落在 skipped/failed（＝上游沒資料或寫入失敗）時才不記，留著讓當天可以重跑。
  if (done.length > 0 || duplicated.length > 0) {
    props.setProperty('HISTORY_LAST_SNAPSHOT_DATE', today);
  }

  let msg = '歷史快照：' + (catchUp ? '⚠️ 補跑（上一個快照日沒存成）——' : '') +
    '已存 ' + (done.length ? done.join('、') : '0 張表');
  if (skipped.length) msg += '；無資料略過 ' + skipped.join('、');
  if (duplicated.length) msg += '；今日已有快照略過 ' + duplicated.join('、');
  if (failed.length) msg += '；⚠️ 寫入失敗 ' + failed.join('｜');
  return msg;
}

// append 到歷史表（只加列、不覆蓋）。表頭只在第一次建立時寫。
//
// ⚠️ 表頭一致性檢查是必要的，不是防禦性冗餘：往報表加一個維度（例如 2026-07-31 給申辦點擊
// 加了「卡片ID」）就會讓欄數變多，而舊列是照舊表頭排的。少了這個檢查，新列會從 A 欄開始塞、
// 每一欄都往右錯開一格，**而且不會報錯**——整張歷史表就這樣靜默壞掉，等到有人拿它做趨勢
// 分析才發現，那時已經分不出哪些列是對的。
// 對不上時直接 throw，由呼叫端記進「更新紀錄」；處理方式是把該張歷史表刪掉讓它用新表頭重建
// （歷史表是週快照，重建只損失尚未累積的那幾份，比留著一張錯位的表好）。
//
// ⚠️ snapshotDate 去重（2026-08-03 加）：同一個快照日期在同一張表只能存在一份。
// 沒有這道檢查時，只要 appendHistorySnapshots_(collected, true)（＝snapshotHistoryNow()）
// 在同一天被跑第二次，整份快照就會原封不動再 append 一遍——**而且完全不會報錯**。
// 2026-07-31 導入歷史快照那天就是這樣：當天為了補欄位改了三版、每改一版就手動種一次資料點，
// 於是 GA4_頁面成效_歷史／GA4_流量來源_歷史（那天表頭沒變動、三次都寫得進去）各多出兩份
// 完全相同的 2026-07-31 快照。重複列在「某頁 sessions 趨勢」這種圖上會被加總三倍，
// 而且因為每一欄都一模一樣，事後很難分辨是重複還是真的有三筆。
// 回傳 null＝這張表今天已有快照、本次沒寫（呼叫端據此報告，不算成功也不算失敗）。
function appendHistoryRows_(sheetName, headers, rows, snapshotDate) {
  const sheet = getOrCreateSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  } else {
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(v => String(v)).filter(v => v !== '');
    if (existing.join('\u0000') !== headers.join('\u0000')) {
      throw new Error('表頭與現有資料不符（欄位定義變了）。現有：[' + existing.join(', ') +
        ']；預期：[' + headers.join(', ') + ']。請把「' + sheetName +
        '」分頁刪掉讓它以新表頭重建，再跑一次 snapshotHistoryNow()');
    }
    // 表頭沒問題才檢查重複——表頭對不上要優先讓它 throw 出來
    if (snapshotDate && lastSnapshotDateOf_(sheet) === snapshotDate) return null;
  }

  if (rows.length === 0) return 0;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  return rows.length;
}

// 兩個 yyyy-MM-dd 字串相差幾天（b - a）。任一格式不合就回 null，由呼叫端當成「無法判斷」。
// 用數字拆解＋Date.UTC，不走字串解析也不碰本地時區，夏令時間或時區設定都不會讓結果差一天。
function daysBetweenDateStrings_(a, b) {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const ma = re.exec(String(a || ''));
  const mb = re.exec(String(b || ''));
  if (!ma || !mb) return null;
  const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((tb - ta) / 86400000);
}

// 歷史表最後一列的快照日期（yyyy-MM-dd 字串；只有表頭或全空時回 ''）。
// 快照永遠是整批 append 在最尾端，所以看最後一列就夠，不必掃全表。
// ⚠️ 不能直接 String(值) 比對：A 欄寫進去的雖然是 'yyyy-MM-dd' 字串，Sheets 會把它自動
// 解析成日期，讀回來是 Date 物件，String() 出來長得像 'Fri Jul 31 2026 ...' 而永遠對不上。
function lastSnapshotDateOf_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  const v = sheet.getRange(lastRow, 1).getValue();
  if (v && typeof v.getTime === 'function') return formatDate(v); // Date 物件 → 轉回 yyyy-MM-dd
  return String(v).trim();
}

// 手動存一份歷史快照（不管今天星期幾、不管全域的「今日已存過」記號）。
// 用途：剛上線時先種下第一個資料點，不用等到下個快照日；或想在改版前後各留一份對照。
// 會重新抓一次各報表資料（＝多打幾次 API），一般日常不需要跑。
//
// ⚠️ force 只跳過「星期幾」和 HISTORY_LAST_SNAPSHOT_DATE 兩道全域檢查；每張表仍有
// 「同一個快照日期只留一份」的去重（見 appendHistoryRows_），所以同一天重跑不會再寫一次。
// 想在同一天留下第二個對照點，要嘛等隔天，要嘛先把那幾列手動刪掉——重複列會讓趨勢圖加總翻倍。
function snapshotHistoryNow() {
  const collected = {
    ga4Pages:    updateGA4Pages(),
    ga4Channels: updateGA4Channels(),
    ga4Events:   updateGA4Events(),
    cardClicks:  updateGA4CardClicks(),
    searches:    updateGA4MerchantSearches(),
    gscQueries:  updateGSCQueries(),
    gscPages:    updateGSCPages(),
  };
  const msg = appendHistorySnapshots_(collected, true);
  Logger.log(msg);
  return msg;
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

// ---------- 排程：每天自動執行 ----------
// ⚠️ 現行那條 trigger 不是這個函式建的，是在「觸發條件」畫面手動建的，每天約 17:37 跑。
//    這個函式會**先刪掉所有 updateAllReports 的觸發條件再重建一條**——
//    為了「設定排程」隨手跑一次，就會把現行的 17:37 靜默換成下面 atHour 指定的時間。
//    要改執行時間請去「觸發條件」畫面改，不要跑這個函式。
//    （atHour 已從原本的 6 改成 17，與現況一致，避免真的被跑到時把排程整個挪走。）
function createDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'updateAllReports') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('updateAllReports')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .create();
}

function debugGSC() {
  const result = fetchGSCData(['query'], 10);
  Logger.log('視窗：' + formatDate(result.window.start) + ' ~ ' + formatDate(result.window.end) +
    '（共 ' + result.window.days + ' 天）');
  Logger.log(JSON.stringify(result.data, null, 2));
}

// ========================================
// 匯入 2025/11/07 上線至今的完整歷史資料（整表覆寫、每次重抓全區間）
// ⚠️ 不是一次性：importGA4History() / importGSCHistory() 由 updateAllReports() 每天呼叫。
//    手動跑的只有 importHistoricalData()（三步包在一起、含寫匯入紀錄）。
// ========================================

const LAUNCH_DATE = '2025-11-07';

function launchDate_() {
  const parts = LAUNCH_DATE.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function importHistoricalData() {
  importGA4History();
  importGSCHistory();
  writeHistoricalImportLog();
}

// ---------- GA4：上線至今每日趨勢 ----------
function importGA4History() {
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday

  const dimension = AnalyticsData.newDimension();
  dimension.name = 'date';

  const metricUsers = AnalyticsData.newMetric();
  metricUsers.name = 'activeUsers';
  const metricSessions = AnalyticsData.newMetric();
  metricSessions.name = 'sessions';
  const metricViews = AnalyticsData.newMetric();
  metricViews.name = 'screenPageViews';
  const metricEngagement = AnalyticsData.newMetric();
  metricEngagement.name = 'engagementRate';

  const dateRange = AnalyticsData.newDateRange();
  dateRange.startDate = LAUNCH_DATE;
  dateRange.endDate = 'yesterday';

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dimension];
  request.metrics = [metricUsers, metricSessions, metricViews, metricEngagement];
  request.dateRanges = [dateRange];

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);

  const rows = report.rows || [];
  const sortedRows = rows.slice().sort((a, b) =>
    a.dimensionValues[0].value.localeCompare(b.dimensionValues[0].value)
  );

  const values = sortedRows.map(row => {
    const d = row.dimensionValues[0].value;
    const formattedDate = d.slice(0, 4) + '/' + d.slice(4, 6) + '/' + d.slice(6, 8);
    return [
      formattedDate,
      row.metricValues[0].value,
      row.metricValues[1].value,
      row.metricValues[2].value,
      row.metricValues[3].value,
    ];
  });

  writeSnapshotSheet_('GA4_歷史每日趨勢', {
    window: WINDOW_CUMULATIVE,
    start: launchDate_(),
    end: end,
    days: daysInclusive_(launchDate_(), end),
    source: 'GA4 property ' + GA4_PROPERTY_ID + '（' + LAUNCH_DATE + ' ~ yesterday）',
    note: '每次執行重抓全期並覆寫；區間日界線由 GA4 資源時區判定',
  }, ['日期', '活躍用戶', 'Sessions', '頁面瀏覽', '互動率'], values);
}

// ---------- GSC：上線至今每日趨勢 ----------
function importGSCHistory() {
  const end = new Date();
  end.setDate(end.getDate() - GSC_LAG_DAYS); // 沿用同樣的 3 天延遲緩衝

  const url = 'https://www.googleapis.com/webmasters/v3/sites/' +
    encodeURIComponent(GSC_SITE_URL) + '/searchAnalytics/query';

  const rowLimit = 1000;
  const payload = {
    startDate: LAUNCH_DATE,
    endDate: formatDate(end),
    dimensions: ['date'],
    rowLimit: rowLimit,
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(response.getContentText());
  const rows = data.rows || [];

  const values = rows.map(row => [
    row.keys[0],
    row.clicks,
    row.impressions,
    (row.ctr * 100).toFixed(2) + '%',
    row.position.toFixed(1),
  ]);

  // 一天一列，rowLimit 1000＝約 2.7 年份。逼近上限時會被靜默截斷（沒做分頁），先在表頭示警
  const truncated = rows.length >= rowLimit;

  writeSnapshotSheet_('GSC_歷史每日趨勢', {
    window: WINDOW_CUMULATIVE,
    start: launchDate_(),
    end: end,
    days: daysInclusive_(launchDate_(), end),
    source: 'Search Console ' + GSC_SITE_URL + '，維度 date',
    note: '每次執行重抓全期並覆寫｜結束日已扣掉 ' + GSC_LAG_DAYS + ' 天資料延遲緩衝' +
      (truncated ? '｜⚠️ 已達 ' + rowLimit + ' 列上限，更早的日期被截斷，需改為分頁抓取'
                 : '｜列數上限 ' + rowLimit + '（一天一列，尚未逼近）'),
  }, ['日期', '點擊數', '曝光數', 'CTR', '平均排名'], values);
}

// ---------- 歷史匯入的更新紀錄 ----------
function writeHistoricalImportLog() {
  const sheet = getOrCreateSheet('更新紀錄');
  sheet.appendRow([new Date(), '已匯入歷史資料（' + LAUNCH_DATE + ' 至今）']);
}

// ============================================================================
// Pick My Card — GA4 到達頁成效（updateGA4Pages）
// ----------------------------------------------------------------------------
// 這是「PMC數據集中」試算表綁定 Apps Script 專案（Code.gs：GA4+GSC+Clarity 同步）的
// 一段【drop-in 函數】備份，不是獨立可跑的檔。實際執行版在該試算表的 Code.gs 裡，改動兩邊同步。
//   ※ 與 cards-export.gs（綁「PMC 管理系統」）是不同的 Apps Script 專案，別搞混。
//
// 安裝：把下面 updateGA4Pages() 貼進 Code.gs（或新增一個 .gs 檔）。
//   - updateAllReports() 裡已經有 updateGA4Pages();（先前加的），補上本定義即可運作。
//   - 沿用 Code.gs 既有的全域 const GA4_PROPERTY_ID 與 getOrCreateSheet()，不重複宣告
//     （重複宣告 const 會讓整個專案語法錯誤停擺）。
//   - 不自帶 trigger：跟著現有 updateAllReports 的每日排程一起跑即可。
//
// 為什麼用 landingPage 維度而非 pagePath：
//   跳出率/互動率/新用戶是「到達頁（session 入口）」概念，跟 pagePath 併用 GA4 Data API 可能
//   回「維度與指標不相容」。用 landingPage 相容性有保證，也正好對應「評估 /landing、/promos
//   當行銷落地頁的表現」這個目的。想改看「任一被瀏覽頁」→ 把 dimension.name 換成 'pagePath'
//   並自行確認相容性（跳出率/互動率可能要拿掉）。
//
// 指標對照（使用者指定）：
//   Sessions→sessions／Active users→activeUsers／New users 佔比→newUsers÷totalUsers／
//   Bounce rate→bounceRate／Engagement rate→engagementRate／
//   Average engagement time→userEngagementDuration÷activeUsers（GA4 後台同算法）
// ============================================================================

// ---------- GA4：近 30 天各到達頁成效（含 /landing、/promos 等）----------
function updateGA4Pages() {
  const win = ga4Window_();

  const dimension = AnalyticsData.newDimension();
  dimension.name = 'landingPage'; // 到達頁路徑（無 query），如 /landing、/promos、/

  const mSessions    = AnalyticsData.newMetric(); mSessions.name    = 'sessions';
  const mActiveUsers = AnalyticsData.newMetric(); mActiveUsers.name = 'activeUsers';
  const mNewUsers    = AnalyticsData.newMetric(); mNewUsers.name    = 'newUsers';
  const mTotalUsers  = AnalyticsData.newMetric(); mTotalUsers.name  = 'totalUsers';
  const mBounce      = AnalyticsData.newMetric(); mBounce.name      = 'bounceRate';
  const mEngRate     = AnalyticsData.newMetric(); mEngRate.name     = 'engagementRate';
  const mEngDur      = AnalyticsData.newMetric(); mEngDur.name      = 'userEngagementDuration';
  const mViews       = AnalyticsData.newMetric(); mViews.name       = 'screenPageViews';

  const dateRange = AnalyticsData.newDateRange();
  dateRange.startDate = win.startSpec;
  dateRange.endDate = win.endSpec;

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dimension];
  request.metrics = [mSessions, mActiveUsers, mNewUsers, mTotalUsers,
                     mBounce, mEngRate, mEngDur, mViews];
  request.dateRanges = [dateRange];

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);

  const rows = report.rows || [];
  // 依 Sessions 由多到少排序（比照 updateGA4Channels 的作法，前面就是重點頁）
  const sortedRows = rows.slice().sort((a, b) =>
    Number(b.metricValues[0].value) - Number(a.metricValues[0].value)
  );

  const values = sortedRows.map(row => {
    const sessions    = Number(row.metricValues[0].value);
    const activeUsers = Number(row.metricValues[1].value);
    const newUsers    = Number(row.metricValues[2].value);
    const totalUsers  = Number(row.metricValues[3].value);
    const bounceRate  = Number(row.metricValues[4].value); // 0~1
    const engRate     = Number(row.metricValues[5].value); // 0~1
    const engDur      = Number(row.metricValues[6].value); // 秒（總參與時間）
    const views       = Number(row.metricValues[7].value);

    const newRatio = totalUsers  > 0 ? newUsers / totalUsers      : 0; // 新用戶佔比 0~1
    const avgEng   = activeUsers > 0 ? Math.round(engDur / activeUsers) : 0; // 平均參與時間(秒/人)

    return [
      row.dimensionValues[0].value, // 到達頁面
      sessions,
      activeUsers,
      newUsers,
      newRatio,   // E：% 格式
      bounceRate, // F：% 格式
      engRate,    // G：% 格式
      avgEng,     // 秒
      views,
    ];
  });

  const headers = ['到達頁面', 'Sessions', '活躍用戶', '新用戶', '新用戶佔比',
                   '跳出率', '互動率', '平均參與時間(秒)', '頁面瀏覽'];
  const sheet = writeSnapshotSheet_('GA4_頁面成效', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID + '，維度 landingPage（' +
      win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定｜「到達頁」＝ session 入口頁，非所有被瀏覽的頁' +
      '｜平均參與時間＝userEngagementDuration÷activeUsers（同 GA4 後台算法）' +
      '｜每週快照存進「GA4_頁面成效_歷史」',
  }, headers, values);

  // 新用戶佔比(E)、跳出率(F)、互動率(G) 三欄套百分比格式
  if (values.length > 0) {
    sheet.getRange(DATA_START_ROW, 5, values.length, 3).setNumberFormat('0.0%');
  }

  return { headers: headers, values: values, window: win };
}

// ============================================================================
// GA4 事件 / 申辦點擊（2026/07/31 新增）
// ----------------------------------------------------------------------------
// 補上資料中心原本最大的盲區：舊版所有表只回答「有多少人來、從哪來、跳出多少」，
// 完全沒有站內行為與轉換——而申辦 CTA 點擊是本站最接近轉換的訊號。
//
// 前端早就在送這些事件（Firebase Analytics → GA4）：
//   button_click            js/quick-options-misc.js「GA4 Button Click Tracking」＋ promos.js
//                           參數：button_type / card_id / card_name / merchant
//     button_type 取值：spotlight_compare｜spotlight_info｜spotlight_apply｜
//                       detail_header_apply｜detail_sticky_apply｜card_apply｜
//                       search_result_apply｜promos_page_apply（promos.js）
//   view_card_detail        js/card-detail.js
//   calculate_cashback      js/cashback-engine.js（＝核心功能使用量）
//   pin_card / unpin_card / remove_mapping / clear_expired_mappings
//                           js/spending-mappings.js
//
// ⚠️ 自訂參數要能用 Data API 查，必須先在 GA4 後台註冊成「自訂維度」。
//   已註冊：card_id、card_name、merchant（2025/11/23）、button_type（2026/06/07）、
//   has_match（2026/07/31）、surface（2026/08/20）——本檔多支查詢正在用這些維度。
//   要加新的自訂參數，得先去 GA4「管理 → 自訂定義」註冊，
//   且**註冊前的資料補不回來**（GA4 不回填），越早加越好。
//   ⚠️ 用剛註冊的維度下判斷前先確認資料滿了沒：註冊日以前一律是 (not set)。
//   若某維度沒註冊就查，Data API 會回錯誤；此步驟失敗不會影響其他報表（見 runStep_）。
// ============================================================================

// 事件名稱 EXACT 比對用的 dimensionFilter
function eventNameFilter_(eventName) {
  const stringFilter = AnalyticsData.newStringFilter();
  stringFilter.matchType = 'EXACT';
  stringFilter.value = eventName;

  const filter = AnalyticsData.newFilter();
  filter.fieldName = 'eventName';
  filter.stringFilter = stringFilter;

  const expression = AnalyticsData.newFilterExpression();
  expression.filter = filter;
  return expression;
}

// ---------- GA4：近 30 天各事件觸發量 ----------
// 一眼看出「用戶在站內到底做了什麼」：算回饋幾次、看了幾張卡詳情、釘了幾張卡、點了幾次申辦
function updateGA4Events() {
  const win = ga4Window_();

  const dimension = AnalyticsData.newDimension();
  dimension.name = 'eventName';

  const mCount = AnalyticsData.newMetric(); mCount.name = 'eventCount';
  const mUsers = AnalyticsData.newMetric(); mUsers.name = 'totalUsers';

  const dateRange = AnalyticsData.newDateRange();
  dateRange.startDate = win.startSpec;
  dateRange.endDate = win.endSpec;

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dimension];
  request.metrics = [mCount, mUsers];
  request.dateRanges = [dateRange];

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);

  const rows = report.rows || [];
  const sortedRows = rows.slice().sort((a, b) =>
    Number(b.metricValues[0].value) - Number(a.metricValues[0].value)
  );

  const values = sortedRows.map(row => {
    const name = row.dimensionValues[0].value;
    const count = Number(row.metricValues[0].value);
    const users = Number(row.metricValues[1].value);
    return [
      name,
      EVENT_LABELS[name] || '',          // 中文說明，讓不熟事件命名的人也讀得懂
      count,
      users,
      users > 0 ? Math.round((count / users) * 100) / 100 : 0, // 人均次數
    ];
  });

  const headers = ['事件名稱', '說明', '觸發次數', '觸發用戶數', '人均次數'];
  writeSnapshotSheet_('GA4_事件成效', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID + '，維度 eventName（' +
      win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定｜含 GA4 自動蒐集事件（page_view、session_start 等）' +
      '與本站自訂事件｜申辦點擊的卡片/按鈕拆解看「GA4_申辦點擊」與「GA4_各卡點擊」' +
      '｜每週快照存進「GA4_事件成效_歷史」',
  }, headers, values);

  return { headers: headers, values: values, window: win };
}

// 自訂事件的中文說明（GA4 自動蒐集事件不列，留空即可）
const EVENT_LABELS = {
  button_click: '按鈕點擊（申辦 CTA／比較／詳情，細分見 GA4_申辦點擊）',
  view_card_detail: '開啟卡片詳情頁',
  calculate_cashback: '執行回饋試算（核心功能使用量）',
  pin_card: '釘選卡片到我的信用卡',
  unpin_card: '取消釘選卡片',
  remove_mapping: '移除配卡表項目',
  clear_expired_mappings: '清除過期配卡',
};

// ---------- GA4：近 30 天申辦／按鈕點擊（依卡片 × 按鈕類型）----------
// 一次 API 呼叫產出兩張表：
//   GA4_申辦點擊 → 卡片 × 按鈕類型明細（對應站長既有探索「辦卡連結點擊」）
//   GA4_各卡點擊 → 一卡一列、按鈕類型攤成欄（對應站長既有探索「各卡點擊數」，並多了分佈）
function updateGA4CardClicks() {
  const win = ga4Window_();

  const dCardId = AnalyticsData.newDimension(); dCardId.name = 'customEvent:card_id';
  const dCard   = AnalyticsData.newDimension(); dCard.name   = 'customEvent:card_name';
  const dType   = AnalyticsData.newDimension(); dType.name   = 'customEvent:button_type';

  const mCount = AnalyticsData.newMetric(); mCount.name = 'eventCount';

  const dateRange = AnalyticsData.newDateRange();
  dateRange.startDate = win.startSpec;
  dateRange.endDate = win.endSpec;

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dCardId, dCard, dType];
  request.metrics = [mCount];
  request.dateRanges = [dateRange];
  request.dimensionFilter = eventNameFilter_('button_click'); // 只算按鈕點擊
  request.limit = GA4_CLICK_ROW_LIMIT;

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);
  const rows = report.rows || [];

  // ── 明細表：卡片 × 按鈕類型，點擊多的在前 ──
  const detail = rows.map(row => ({
    cardId: row.dimensionValues[0].value,
    card: row.dimensionValues[1].value,
    type: row.dimensionValues[2].value,
    count: Number(row.metricValues[0].value),
  })).sort((a, b) => b.count - a.count);

  const detailHeaders = ['卡片ID', '卡片名稱', '按鈕類型', '按鈕位置說明', '點擊數'];
  const detailValues = detail.map(d =>
    [d.cardId, d.card, d.type, BUTTON_TYPE_LABELS[d.type] || '', d.count]);

  writeSnapshotSheet_('GA4_申辦點擊', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID +
      '，事件 button_click，維度 customEvent:card_id × customEvent:card_name × customEvent:button_type（' +
      win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定｜最多取 ' + GA4_CLICK_ROW_LIMIT + ' 列' +
      '｜卡片ID＝cards.data 的 card.id，可直接跟卡片資料對照（卡片名稱只是顯示字串、會變動）' +
      '｜「(not set)」＝該次點擊沒帶到卡片（多半是非卡片類按鈕，如 spotlight_compare）' +
      '｜每週快照存進「GA4_申辦點擊_歷史」',
  }, detailHeaders, detailValues);

  // ── 樞紐表：一卡一列，按鈕類型攤成欄 ──
  // 同一張卡的點擊分佈（詳情頁浮動列 vs 搜尋結果 vs 活動頁）就是 CTA 版位效益，
  // 攤成欄才看得出來——明細表一卡多列，人眼很難橫向比較。
  // 以 card_id 分組而非 card_name：卡片名稱是會變動的顯示字串（改名／全形空格），
  // card_id 才是能跟 cards.data 對得起來的穩定識別碼。視窗中途改過名的卡，用 id 分組
  // 才會合成一列而不是裂成兩列（顯示名取該 id 底下點擊最多的那個）。
  const typeTotals = {};
  const byCard = {};
  detail.forEach(d => {
    typeTotals[d.type] = (typeTotals[d.type] || 0) + d.count;
    if (!byCard[d.cardId]) byCard[d.cardId] = { cardId: d.cardId, names: {}, total: 0, types: {} };
    const c = byCard[d.cardId];
    c.names[d.card] = (c.names[d.card] || 0) + d.count;
    c.total += d.count;
    c.types[d.type] = (c.types[d.type] || 0) + d.count;
  });

  // 欄順序＝該按鈕類型的總點擊由多到少（欄位會隨資料變動，所以每次重算）
  const typeCols = Object.keys(typeTotals).sort((a, b) => typeTotals[b] - typeTotals[a]);

  const pivotHeaders = ['卡片ID', '卡片名稱', '總點擊數'].concat(typeCols);
  const pivotValues = Object.keys(byCard)
    .map(k => byCard[k])
    .sort((a, b) => b.total - a.total)
    .map(c => {
      const name = Object.keys(c.names).sort((a, b) => c.names[b] - c.names[a])[0] || '';
      return [c.cardId, name, c.total].concat(typeCols.map(t => c.types[t] || 0));
    });

  writeSnapshotSheet_('GA4_各卡點擊', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: '同「GA4_申辦點擊」（同一次 API 回傳，於指令碼內彙總）',
    note: '一卡一列、按鈕類型攤成欄，看的是同一張卡的 CTA 版位分佈' +
      '｜依 card_id 分組（穩定識別碼），卡片名稱取該 id 底下點擊最多的寫法' +
      '｜欄位順序依各按鈕類型總點擊排列，會隨資料變動' +
      '｜按鈕類型意義：' + typeCols.map(t => t + '＝' + (BUTTON_TYPE_LABELS[t] || '未知')).join('、'),
  }, pivotHeaders, pivotValues);

  return {
    headers: detailHeaders, values: detailValues, window: win,
    pivotHeaders: pivotHeaders, pivotValues: pivotValues,
  };
}

// ---------- GA4：近 30 天站內搜尋的商家／消費項目 ----------
// 這是整個資料中心**唯一的第一方需求訊號**：用戶在回饋試算框裡實際打了什麼字。
// GSC 只告訴你「他們在 Google 搜什麼才找到你」，這張表告訴你「他們進來之後想問什麼」——
// 兩者常常完全不同，而後者才是內容與卡片資料該補哪裡的依據。
// 資料來源：js/cashback-engine.js 的 calculate_cashback 事件
//   merchant   ＝ 輸入框內容
//   has_match  ＝ 這次試算有沒有對到資料（true/false）
//
// 一次呼叫產出兩張：
//   GA4_熱門搜尋 → 依試算次數排，看「大家最常查什麼」
//   GA4_搜尋落空 → 只留沒對到的、依沒對到次數排，看「他們想查但我們答不出來的」
//                  ——這張基本上就是 cards.data 的資料補齊優先順序清單
//
// ⚠️ has_match 是 2026-07-31 才註冊的自訂維度，**GA4 對註冊前的資料不回填**，
//   所以剛上線那陣子多數列會落在「未知(註冊前)」欄，有對到/沒對到的拆分要等新資料累積。
function updateGA4MerchantSearches() {
  const win = ga4Window_();

  const dMerchant = AnalyticsData.newDimension(); dMerchant.name = 'customEvent:merchant';
  const dMatch    = AnalyticsData.newDimension(); dMatch.name    = 'customEvent:has_match';

  const mCount = AnalyticsData.newMetric(); mCount.name = 'eventCount';

  const dateRange = AnalyticsData.newDateRange();
  dateRange.startDate = win.startSpec;
  dateRange.endDate = win.endSpec;

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dMerchant, dMatch];
  request.metrics = [mCount];
  request.dateRanges = [dateRange];
  request.dimensionFilter = eventNameFilter_('calculate_cashback'); // 只算回饋試算，不含按鈕點擊帶的 merchant
  request.limit = GA4_SEARCH_ROW_LIMIT;

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);
  const rows = report.rows || [];

  // 依商家聚合，把 has_match 攤成「有對到 / 沒對到 / 未知」三欄。
  // 刻意不放「搜尋用戶數」：totalUsers 在 has_match 拆開後不能相加（同一人既有對到又有沒對到
  // 會被算兩次），與其給一個會被誤用的數字，不如只留可加總的次數。
  const byMerchant = {};
  rows.forEach(row => {
    const name = row.dimensionValues[0].value;
    const flag = String(row.dimensionValues[1].value).toLowerCase();
    const count = Number(row.metricValues[0].value);
    if (!byMerchant[name]) byMerchant[name] = { name: name, matched: 0, unmatched: 0, unknown: 0, total: 0 };
    const m = byMerchant[name];
    if (flag === 'true') m.matched += count;
    else if (flag === 'false') m.unmatched += count;
    else m.unknown += count;   // (not set)＝註冊 has_match 之前送出的事件
    m.total += count;
  });

  const list = Object.keys(byMerchant).map(k => byMerchant[k]);
  const missRate = m => {
    const known = m.matched + m.unmatched;
    return known > 0 ? m.unmatched / known : '';   // 全是註冊前的舊資料就留空，不要硬算成 0
  };

  // ── 表一：熱門搜尋（依試算次數）──
  const headers = ['搜尋的商家／消費項目', '試算次數', '有對到', '沒對到', '未對到率', '未知(註冊前)'];
  const values = list.slice().sort((a, b) => b.total - a.total)
    .map(m => [m.name, m.total, m.matched, m.unmatched, missRate(m), m.unknown]);

  const sheet = writeSnapshotSheet_('GA4_熱門搜尋', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID +
      '，事件 calculate_cashback，維度 customEvent:merchant × customEvent:has_match（' +
      win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定｜最多取 ' + GA4_SEARCH_ROW_LIMIT + ' 列' +
      '｜這是用戶在站內回饋試算框「實際打進去的字」，與 GSC_關鍵字（Google 上搜什麼找到本站）' +
      '是兩件事，兩張要分開看｜「(not set)」＝送出試算時輸入框是空的' +
      '｜「未知(註冊前)」＝ has_match 自訂維度註冊前送出的事件，GA4 不回填，會隨時間歸零' +
      '｜未對到率＝沒對到÷(有對到+沒對到)，不含未知' +
      '｜每週快照存進「GA4_熱門搜尋_歷史」',
  }, headers, values);
  if (values.length > 0) sheet.getRange(DATA_START_ROW, 5, values.length, 1).setNumberFormat('0.0%');

  // ── 表二：搜尋落空（依沒對到次數）＝資料補齊優先順序 ──
  const missHeaders = ['搜尋的商家／消費項目', '沒對到次數', '試算次數', '未對到率'];
  const missValues = list.filter(m => m.unmatched > 0)
    .sort((a, b) => b.unmatched - a.unmatched)
    .map(m => [m.name, m.unmatched, m.total, missRate(m)]);

  const missSheet = writeSnapshotSheet_('GA4_搜尋落空', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: '同「GA4_熱門搜尋」（同一次 API 回傳，於指令碼內篩選重排）',
    note: '只列出 has_match=false 的搜尋，依沒對到次數由多到少' +
      '＝**用戶想查、但站上答不出來的東西**，可直接當 cards.data 的資料補齊優先順序' +
      '｜空表有兩種可能：真的每筆都有對到，或 has_match 剛註冊、還沒累積到新資料',
  }, missHeaders, missValues);
  if (missValues.length > 0) missSheet.getRange(DATA_START_ROW, 4, missValues.length, 1).setNumberFormat('0.0%');

  return { headers: headers, values: values, window: win };
}

// button_type 取值 → 按鈕實際位置（對照 js/quick-options-misc.js 與 promos.js）
const BUTTON_TYPE_LABELS = {
  spotlight_compare: '首頁 Spotlight「比較」',
  spotlight_info: '首頁 Spotlight「詳情」',
  spotlight_apply: '首頁 Spotlight「申辦」',
  detail_header_apply: '卡片詳情頁頂部申辦',
  detail_sticky_apply: '卡片詳情頁浮動列申辦',
  card_apply: '卡片列表申辦',
  search_result_apply: '搜尋結果申辦',
  promos_page_apply: '新戶活動頁（promos）申辦',
};
