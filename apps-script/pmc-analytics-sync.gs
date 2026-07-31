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

// 視窗類型（決定表頭第一行怎麼描述這張表）
const WINDOW_ROLLING = 'rolling';        // 滾動視窗：只有最近 N 天，整表覆寫、不累積
const WINDOW_CUMULATIVE = 'cumulative';  // 累積期間：上線至今完整重抓，整表覆寫

// 標註佔用的列數：第 1–2 列是視窗標註，第 3 列才是欄位標題，資料從第 4 列開始
const BANNER_ROWS = 2;
const HEADER_ROW = BANNER_ROWS + 1;
const DATA_START_ROW = HEADER_ROW + 1;

// ---------- 主流程：一次更新全部 ----------
function updateAllReports() {
  updateGA4Daily();
  updateGA4Channels();
  updateGA4Pages();
  updateGSCQueries();
  updateGSCPages();
  importGA4History();
  importGSCHistory();
  const clarityResult = syncClarityData();   // Clarity 串進同一次執行
  writeLastUpdated(clarityResult.message);    // 把 Clarity 狀態併進更新紀錄那行
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

  writeSnapshotSheet_('GA4_每日趨勢', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID + '（' + win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定；逐日資料另有「GA4_歷史每日趨勢」保存上線至今全期',
  }, ['日期', '活躍用戶', 'Sessions', '頁面瀏覽', '互動率'], values);
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

  writeSnapshotSheet_('GA4_流量來源', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID + '，維度 sessionDefaultChannelGroup（' +
      win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定；本表為區間**加總**，非日均值',
  }, ['流量來源', 'Sessions', '活躍用戶', '互動率'], values);
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

  writeSnapshotSheet_('GSC_關鍵字', {
    window: WINDOW_ROLLING,
    start: result.window.start,
    end: result.window.end,
    days: result.window.days,
    source: 'Search Console ' + GSC_SITE_URL + '，維度 query',
    note: '結束日已扣掉 ' + GSC_LAG_DAYS + ' 天資料延遲緩衝｜最多取 ' + GSC_QUERY_ROW_LIMIT +
      ' 列，超過會被 API 截斷（點擊由多到少）｜CTR/平均排名為區間內加權結果，非每日平均',
  }, ['關鍵字', '點擊數', '曝光數', 'CTR', '平均排名'], values);
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

  writeSnapshotSheet_('GSC_頁面', {
    window: WINDOW_ROLLING,
    start: result.window.start,
    end: result.window.end,
    days: result.window.days,
    source: 'Search Console ' + GSC_SITE_URL + '，維度 page',
    note: '結束日已扣掉 ' + GSC_LAG_DAYS + ' 天資料延遲緩衝｜最多取 ' + GSC_PAGE_ROW_LIMIT +
      ' 列，超過會被 API 截斷（點擊由多到少）｜CTR/平均排名為區間內加權結果，非每日平均',
  }, ['頁面', '點擊數', '曝光數', 'CTR', '平均排名'], values);
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

// clarityMessage：選填，把 Clarity 同步狀態接到「已更新 GA4 + GSC 資料」那行後面
// 同時把本次兩個滾動視窗的實際日期記進 log——事後追「這份數字是哪幾天的」有據可查
function writeLastUpdated(clarityMessage) {
  const sheet = getOrCreateSheet('更新紀錄');
  const ga4 = ga4Window_();
  const gsc = gscWindow_();
  const base = '已更新 GA4 + GSC 資料（GA4 視窗 ' +
    formatSlash_(ga4.start) + '~' + formatSlash_(ga4.end) + ' 共 ' + ga4.days + ' 天；' +
    'GSC 視窗 ' + formatSlash_(gsc.start) + '~' + formatSlash_(gsc.end) + ' 共 ' + gsc.days + ' 天）';
  const line = clarityMessage ? base + '；' + clarityMessage : base;
  sheet.appendRow([new Date(), line]);
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

// ---------- 排程：每天自動執行 ----------
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
    .atHour(6)
    .create();
}

function debugGSC() {
  const result = fetchGSCData(['query'], 10);
  Logger.log('視窗：' + formatDate(result.window.start) + ' ~ ' + formatDate(result.window.end) +
    '（共 ' + result.window.days + ' 天）');
  Logger.log(JSON.stringify(result.data, null, 2));
}

// ========================================
// 一次性：匯入 2025/11/07 上線至今的完整歷史資料
// 只需要手動執行一次，不會被每日排程自動觸發
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
//   ※ 與 cards-export.gs（綁「信用卡管理系統」）是不同的 Apps Script 專案，別搞混。
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

  const sheet = writeSnapshotSheet_('GA4_頁面成效', {
    window: WINDOW_ROLLING,
    start: win.start,
    end: win.end,
    days: win.days,
    source: 'GA4 property ' + GA4_PROPERTY_ID + '，維度 landingPage（' +
      win.startSpec + ' ~ ' + win.endSpec + '）',
    note: '區間日界線由 GA4 資源時區判定｜「到達頁」＝ session 入口頁，非所有被瀏覽的頁' +
      '｜平均參與時間＝userEngagementDuration÷activeUsers（同 GA4 後台算法）',
  }, ['到達頁面', 'Sessions', '活躍用戶', '新用戶', '新用戶佔比',
      '跳出率', '互動率', '平均參與時間(秒)', '頁面瀏覽'], values);

  // 新用戶佔比(E)、跳出率(F)、互動率(G) 三欄套百分比格式
  if (values.length > 0) {
    sheet.getRange(DATA_START_ROW, 5, values.length, 3).setNumberFormat('0.0%');
  }
}
