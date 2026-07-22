/**
 * Pick My Card — GA4 成效匯出到「PMC數據集中」Google Sheet
 * ============================================================================
 * 用 GA4 Data API v1 撈全站「分頁」成效指標，寫進試算表給行銷部門討論用。
 * 不只 /landing——維度用 pagePath，涵蓋 landing、主頁、merchant 落地頁等所有頁面。
 *
 * ⚠️ 這是備份副本，實際執行版在 Google Sheets（擴充功能 → Apps Script）。改動兩邊同步。
 *    （比照 cards-export.gs / watchlist-monitor.gs 的運維慣例，見 apps-script/README.md）
 *
 * ── 一次性設定（跑之前先做）────────────────────────────────────────────────
 * 1. Apps Script 編輯器左側「服務 (Services)」→ 加入「Google Analytics Data API」
 *    （識別碼會是 AnalyticsData；本檔就是用它）。
 * 2. 同一個 GCP 專案要在 Google Cloud Console 啟用「Google Analytics Data API」。
 * 3. 執行這支 Apps Script 的 Google 帳號，必須對該 GA4 資源有「檢視者」以上權限。
 * 4. 第一次手動跑 updatePmcMetrics() 會跳授權，同意即可。
 * 5. 要自動更新 → 跑一次 createDailyTrigger()（預設每天 08:00 更新一次）。
 *
 * ── 指標對照（使用者指定的 5 項）──────────────────────────────────────────
 *   Bounce rate            → bounceRate
 *   Engagement rate        → engagementRate
 *   Sessions               → sessions
 *   Active users           → activeUsers
 *   Average engagement time→ userEngagementDuration ÷ activeUsers（GA4 後台同算法）
 *   New users 佔比          → newUsers ÷ totalUsers
 * ============================================================================
 */

// ── 設定區 ──────────────────────────────────────────────────────────────────
var GA4_PROPERTY_ID = '505426795';       // GA4 Property ID（數字，非 Measurement ID G-...）
var SHEET_NAME      = 'PMC數據集中';       // 目標工作表名稱
var LOOKBACK_DAYS   = 28;                  // 每次撈最近幾天（含昨天，不含今天不完整資料）
var MIN_SESSIONS    = 1;                   // 過濾雜訊：session 數低於此的頁面不列（設 0 = 全列）

// 每次執行「重寫」資料區（清掉舊資料重填最近 LOOKBACK_DAYS 天），確保無重複、永遠是最新。
// 想改成「累加保留歷史」→ 見檔尾 appendMode 說明。
// ────────────────────────────────────────────────────────────────────────────

/**
 * 主函數：撈 GA4 分頁成效，寫進「PMC數據集中」。手動或由觸發器呼叫。
 */
function updatePmcMetrics() {
  var report = runGa4Report_();
  var rows   = buildRows_(report);
  writeToSheet_(rows);
  Logger.log('✅ 已更新 %s：%s 列（最近 %s 天，頁面 × 日期）',
             SHEET_NAME, rows.length, LOOKBACK_DAYS);
}

/**
 * 呼叫 GA4 Data API runReport。維度 = 日期 + 頁面路徑；指標 = 使用者指定那幾項的原始值。
 */
function runGa4Report_() {
  var request = {
    dateRanges: [{ startDate: LOOKBACK_DAYS + 'daysAgo', endDate: 'yesterday' }],
    dimensions: [
      { name: 'date' },
      { name: 'pagePath' }
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'totalUsers' },
      { name: 'bounceRate' },
      { name: 'engagementRate' },
      { name: 'userEngagementDuration' }, // 秒；平均參與時間 = 此值 ÷ activeUsers
      { name: 'screenPageViews' }
    ],
    // 只留有 session 的頁面，並排除雜訊；MIN_SESSIONS 過濾在 buildRows_ 再做一次（API 端先粗篩）
    orderBys: [
      { dimension: { dimensionName: 'date' }, desc: true },
      { metric: { metricName: 'sessions' }, desc: true }
    ],
    limit: 100000
  };

  // Advanced Service 呼叫：AnalyticsData.Properties.runReport
  return AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);
}

/**
 * 把 API 回傳整理成一列列陣列（含算出來的「平均參與時間」與「New users 佔比」）。
 */
function buildRows_(report) {
  var rows = [];
  if (!report || !report.rows) return rows;

  report.rows.forEach(function (r) {
    var dimDate  = r.dimensionValues[0].value;          // YYYYMMDD
    var pagePath = r.dimensionValues[1].value;

    var sessions       = num_(r.metricValues[0].value);
    var activeUsers    = num_(r.metricValues[1].value);
    var newUsers       = num_(r.metricValues[2].value);
    var totalUsers     = num_(r.metricValues[3].value);
    var bounceRate     = num_(r.metricValues[4].value); // 0~1
    var engagementRate = num_(r.metricValues[5].value); // 0~1
    var engDuration    = num_(r.metricValues[6].value); // 秒
    var pageViews      = num_(r.metricValues[7].value);

    if (sessions < MIN_SESSIONS) return;

    var avgEngSec      = activeUsers > 0 ? (engDuration / activeUsers) : 0;   // 平均參與時間（秒/人）
    var newUsersRatio  = totalUsers  > 0 ? (newUsers / totalUsers)     : 0;   // New users 佔比 0~1

    rows.push([
      formatDate_(dimDate),        // 日期 YYYY-MM-DD
      pagePath,                    // 頁面路徑（/landing、/、/merchant/... 等）
      sessions,                    // Sessions
      activeUsers,                 // Active users
      newUsers,                    // New users
      newUsersRatio,               // New users 佔比（格式化成 %）
      bounceRate,                  // Bounce rate（%）
      engagementRate,              // Engagement rate（%）
      Math.round(avgEngSec),       // 平均參與時間（秒）
      pageViews                    // Page views（附帶參考）
    ]);
  });

  return rows;
}

/**
 * 重寫工作表：表頭 + 資料。找不到工作表就建立。
 */
function writeToSheet_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  var header = ['日期', '頁面路徑', 'Sessions', 'Active users', 'New users',
                'New users 佔比', 'Bounce rate', 'Engagement rate',
                '平均參與時間(秒)', 'Page views'];

  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);

    // 百分比欄位（佔比 / bounce / engagement）格式化成 %
    sheet.getRange(2, 6, rows.length, 1).setNumberFormat('0.0%'); // New users 佔比
    sheet.getRange(2, 7, rows.length, 1).setNumberFormat('0.0%'); // Bounce rate
    sheet.getRange(2, 8, rows.length, 1).setNumberFormat('0.0%'); // Engagement rate
  }

  // 更新時間戳記（放在表頭右邊一格，方便行銷確認資料新鮮度）
  sheet.getRange(1, header.length + 2).setValue(
    '更新於 ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm'));

  sheet.setFrozenRows(1);
}

// ── 小工具 ──────────────────────────────────────────────────────────────────
function num_(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

function formatDate_(yyyymmdd) {
  // '20260722' → '2026-07-22'
  return yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8);
}

// ── 觸發器管理 ────────────────────────────────────────────────────────────────
/**
 * 建立每天 08:00（台北時間）自動更新的觸發器。跑一次即可；重複跑會先清掉舊的避免重複。
 */
function createDailyTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('updatePmcMetrics')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('Asia/Taipei')
    .create();
  Logger.log('✅ 已建立每天 08:00 更新觸發器');
}

/** 移除本專案所有 updatePmcMetrics 觸發器。 */
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'updatePmcMetrics') ScriptApp.deleteTrigger(t);
  });
}

/*
 * ── 想改成「累加保留歷史」而非每次重寫？──────────────────────────────────────
 * 把 writeToSheet_() 換成 append 邏輯：
 *   1. 縮短 LOOKBACK_DAYS（例如 = 1，只撈昨天）。
 *   2. 用 sheet.appendRow(row) 或 getRange(lastRow+1,...).setValues(rows) 往下加。
 *   3. 注意重複：以 (日期, 頁面路徑) 當唯一鍵，append 前先讀現有資料去重，
 *      或每天固定只在早上跑一次撈「昨天」單日資料即可天然不重複。
 *
 * ── 只想要「全站彙總單列」而非分頁？──────────────────────────────────────────
 *   拿掉 dimensions 裡的 { name: 'pagePath' }，只留 date（或連 date 都拿掉撈區間總和）。
 *
 * ── 只想追 /landing？────────────────────────────────────────────────────────
 *   在 request 加維度篩選：
 *   request.dimensionFilter = {
 *     filter: { fieldName: 'pagePath',
 *               stringFilter: { matchType: 'EXACT', value: '/landing' } }
 *   };
 */
