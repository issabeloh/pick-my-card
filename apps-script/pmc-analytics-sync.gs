// ========================================
// Pick My Card — GA4 + GSC + Clarity 自動同步腳本
// ========================================

const GA4_PROPERTY_ID = '505426795';
const GSC_SITE_URL = 'sc-domain:pickmycard.app';

// Clarity（2026/07 加入）
const CLARITY_ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
const CLARITY_SHEET = 'Clarity_每日';

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

// ---------- GA4：近 30 天每日趨勢 ----------
function updateGA4Daily() {
  const sheet = getOrCreateSheet('GA4_每日趨勢');
  sheet.clear();

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
  dateRange.startDate = '30daysAgo';
  dateRange.endDate = 'yesterday';

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dimension];
  request.metrics = [metricUsers, metricSessions, metricViews, metricEngagement];
  request.dateRanges = [dateRange];

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);

  sheet.appendRow(['日期', '活躍用戶', 'Sessions', '頁面瀏覽', '互動率']);
  if (!report.rows) return;

  const sortedRows = report.rows.slice().sort((a, b) =>
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
  sheet.getRange(2, 1, values.length, 5).setValues(values);
}

// ---------- GA4：近 30 天流量來源 ----------
function updateGA4Channels() {
  const sheet = getOrCreateSheet('GA4_流量來源');
  sheet.clear();

  const dimension = AnalyticsData.newDimension();
  dimension.name = 'sessionDefaultChannelGroup';

  const metricSessions = AnalyticsData.newMetric();
  metricSessions.name = 'sessions';
  const metricUsers = AnalyticsData.newMetric();
  metricUsers.name = 'activeUsers';
  const metricEngagement = AnalyticsData.newMetric();
  metricEngagement.name = 'engagementRate';

  const dateRange = AnalyticsData.newDateRange();
  dateRange.startDate = '30daysAgo';
  dateRange.endDate = 'yesterday';

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dimension];
  request.metrics = [metricSessions, metricUsers, metricEngagement];
  request.dateRanges = [dateRange];

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);

  sheet.appendRow(['流量來源', 'Sessions', '活躍用戶', '互動率']);
  if (!report.rows) return;

  const sortedRows = report.rows.slice().sort((a, b) =>
    Number(b.metricValues[0].value) - Number(a.metricValues[0].value)
  );

  const values = sortedRows.map(row => [
    row.dimensionValues[0].value,
    row.metricValues[0].value,
    row.metricValues[1].value,
    row.metricValues[2].value,
  ]);
  sheet.getRange(2, 1, values.length, 4).setValues(values);
}

// ---------- GSC：近 28 天關鍵字表現 ----------
function updateGSCQueries() {
  const sheet = getOrCreateSheet('GSC_關鍵字');
  sheet.clear();
  sheet.appendRow(['關鍵字', '點擊數', '曝光數', 'CTR', '平均排名']);

  const data = fetchGSCData(['query'], 500);
  if (!data.rows) return;

  const values = data.rows.map(row => [
    row.keys[0],
    row.clicks,
    row.impressions,
    (row.ctr * 100).toFixed(2) + '%',
    row.position.toFixed(1),
  ]);
  sheet.getRange(2, 1, values.length, 5).setValues(values);
}

// ---------- GSC：近 28 天頁面表現 ----------
function updateGSCPages() {
  const sheet = getOrCreateSheet('GSC_頁面');
  sheet.clear();
  sheet.appendRow(['頁面', '點擊數', '曝光數', 'CTR', '平均排名']);

  const data = fetchGSCData(['page'], 100);
  if (!data.rows) return;

  const values = data.rows.map(row => [
    row.keys[0],
    row.clicks,
    row.impressions,
    (row.ctr * 100).toFixed(2) + '%',
    row.position.toFixed(1),
  ]);
  sheet.getRange(2, 1, values.length, 5).setValues(values);
}

// ---------- GSC 共用：呼叫 Search Console API ----------
function fetchGSCData(dimensions, rowLimit) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3); // GSC 資料通常有 2-3 天延遲
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 28);

  const url = 'https://www.googleapis.com/webmasters/v3/sites/' +
    encodeURIComponent(GSC_SITE_URL) + '/searchAnalytics/query';

  const payload = {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
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
  return JSON.parse(response.getContentText());
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
function writeLastUpdated(clarityMessage) {
  const sheet = getOrCreateSheet('更新紀錄');
  const base = '已更新 GA4 + GSC 資料';
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
  const data = fetchGSCData(['query'], 10);
  Logger.log(JSON.stringify(data, null, 2));
}

// ========================================
// 一次性：匯入 2025/11/07 上線至今的完整歷史資料
// 只需要手動執行一次，不會被每日排程自動觸發
// ========================================

const LAUNCH_DATE = '2025-11-07';

function importHistoricalData() {
  importGA4History();
  importGSCHistory();
  writeHistoricalImportLog();
}

// ---------- GA4：上線至今每日趨勢 ----------
function importGA4History() {
  const sheet = getOrCreateSheet('GA4_歷史每日趨勢');
  sheet.clear();

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

  sheet.appendRow(['日期', '活躍用戶', 'Sessions', '頁面瀏覽', '互動率']);
  if (!report.rows) return;

  const sortedRows = report.rows.slice().sort((a, b) =>
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
  sheet.getRange(2, 1, values.length, 5).setValues(values);
}

// ---------- GSC：上線至今每日趨勢 ----------
function importGSCHistory() {
  const sheet = getOrCreateSheet('GSC_歷史每日趨勢');
  sheet.clear();
  sheet.appendRow(['日期', '點擊數', '曝光數', 'CTR', '平均排名']);

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3); // 沿用同樣的 3 天延遲緩衝

  const url = 'https://www.googleapis.com/webmasters/v3/sites/' +
    encodeURIComponent(GSC_SITE_URL) + '/searchAnalytics/query';

  const payload = {
    startDate: LAUNCH_DATE,
    endDate: formatDate(endDate),
    dimensions: ['date'],
    rowLimit: 1000,
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
  if (!data.rows) return;

  const values = data.rows.map(row => [
    row.keys[0],
    row.clicks,
    row.impressions,
    (row.ctr * 100).toFixed(2) + '%',
    row.position.toFixed(1),
  ]);
  sheet.getRange(2, 1, values.length, 5).setValues(values);
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
  const sheet = getOrCreateSheet('GA4_頁面成效');
  sheet.clear();

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
  dateRange.startDate = '30daysAgo';
  dateRange.endDate = 'yesterday';

  const request = AnalyticsData.newRunReportRequest();
  request.dimensions = [dimension];
  request.metrics = [mSessions, mActiveUsers, mNewUsers, mTotalUsers,
                     mBounce, mEngRate, mEngDur, mViews];
  request.dateRanges = [dateRange];

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);

  sheet.appendRow(['到達頁面', 'Sessions', '活躍用戶', '新用戶', '新用戶佔比',
                   '跳出率', '互動率', '平均參與時間(秒)', '頁面瀏覽']);
  sheet.setFrozenRows(1);
  if (!report.rows) return;

  // 依 Sessions 由多到少排序（比照 updateGA4Channels 的作法，前面就是重點頁）
  const sortedRows = report.rows.slice().sort((a, b) =>
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

  sheet.getRange(2, 1, values.length, 9).setValues(values);
  // 新用戶佔比(E)、跳出率(F)、互動率(G) 三欄套百分比格式
  sheet.getRange(2, 5, values.length, 3).setNumberFormat('0.0%');
}
