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
