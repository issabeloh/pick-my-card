/**
 * pmc-analytics-sync —— Microsoft Clarity 每日資料同步
 * ------------------------------------------------------------
 * 這支跟現有的 GA4 / GSC 同步共用同一個 Google Sheet「PMC數據集中」與同一次排程執行。
 * ⚠️ 本檔是「Clarity 新增段」的備份，實際執行版本在 Google Sheets 的 Apps Script 專案裡，
 *    改動請兩邊同步（比照 apps-script/README.md 的慣例）。
 *
 * 【硬限制——超過會整個 Clarity 專案當天被鎖】
 *   - 每個 Clarity 專案每天最多 10 次 API 呼叫（不分來源，手動測試也算）
 *   - 只能拿到過去 1–3 天的資料，超過就永久拿不到 → 必須「每天累加寫入」，不能覆蓋
 *   - 單次請求最多 3 個 dimension、回傳最多 1000 筆、不能分頁
 *
 * 【接線位置——請自行接進現有排程主函數】
 *   1) 在跟 GA4 / GSC 同一支排程主函數的結尾（寫 updateLog 那行之前）加一行呼叫：
 *          var clarityResult = syncClarityData();
 *   2) 把原本那行「已更新 GA4 + GSC 資料」的 updateLog 內容，改成把 Clarity 狀態接上去，例如：
 *          logMsg = '已更新 GA4 + GSC 資料；' + clarityResult.message;
 *      （skipped=true 時 message 會說明「今日已同步過，跳過」；失敗時會說明 401 / 429 等原因）
 *   —— 上面兩處用你現有排程/紀錄函數的實際名稱替換即可，本檔不去猜它們的名字。
 */

var CLARITY_CONFIG = {
  endpoint: 'https://www.clarity.ms/export-data/api/v1/project-live-insights',
  tokenProperty: 'CLARITY_API_TOKEN',      // 指令碼屬性：Bearer token
  lastSyncProperty: 'CLARITY_LAST_SYNC_DATE', // 指令碼屬性：防重複呼叫用（記錄最後成功同步日期 yyyy-MM-dd）
  sheetName: 'Clarity_每日',
  numOfDays: 1,                            // 只抓最近 24hr
  timeZone: 'Asia/Taipei'
};

/**
 * Clarity 每日同步主函數。回傳 { ok, skipped, message, rowCount }，
 * 由排程主函數用來組 updateLog 訊息。本函數自己不寫 updateLog（交給呼叫端統一寫，格式才能一致）。
 */
function syncClarityData() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), CLARITY_CONFIG.timeZone, 'yyyy-MM-dd');

  // ── 防重複呼叫保護 ──────────────────────────────────────────
  // 今天已經成功同步過就直接跳過，避免手動重跑多次把當日 10 次額度用完（用完整個專案當天被鎖）。
  var lastSync = props.getProperty(CLARITY_CONFIG.lastSyncProperty);
  if (lastSync === today) {
    var skipMsg = 'Clarity：今日（' + today + '）已同步過，跳過以保護每日 10 次 API 額度';
    console.log(skipMsg);
    return { ok: false, skipped: true, message: skipMsg, rowCount: 0 };
  }

  var token = props.getProperty(CLARITY_CONFIG.tokenProperty);
  if (!token) {
    var noTokenMsg = 'Clarity 同步失敗：找不到指令碼屬性 ' + CLARITY_CONFIG.tokenProperty +
      '（請到 專案設定 → 指令碼屬性 新增 Clarity API token）';
    console.error(noTokenMsg);
    return { ok: false, skipped: false, message: noTokenMsg, rowCount: 0 };
  }

  // ── 呼叫 API ────────────────────────────────────────────────
  // numOfDays=1 只抓最近 24hr；dimension1=URL 依頁面拆分（本站只有 3 頁，遠低於 1000 筆上限）
  var url = CLARITY_CONFIG.endpoint +
    '?numOfDays=' + encodeURIComponent(CLARITY_CONFIG.numOfDays) +
    '&dimension1=URL';

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true // 自己判 code，才能針對 401 / 429 給明確訊息
    });
  } catch (e) {
    var fetchErrMsg = 'Clarity 同步失敗：呼叫 API 發生例外——' + e;
    console.error(fetchErrMsg);
    return { ok: false, skipped: false, message: fetchErrMsg, rowCount: 0 };
  }

  var code = response.getResponseCode();
  if (code !== 200) {
    var reason;
    if (code === 401) {
      reason = 'token 失效或錯誤（401 Unauthorized）——請確認指令碼屬性 ' +
        CLARITY_CONFIG.tokenProperty + ' 的值，或到 Clarity 專案設定重新產生 API token';
    } else if (code === 429) {
      reason = '超過每日 10 次 API 額度（429 Too Many Requests）——當日呼叫已用完，需等隔天恢復；' +
        '請勿再手動重跑（本函數的 CLARITY_LAST_SYNC_DATE 防呆就是為了避免這種情況）';
    } else {
      reason = 'HTTP ' + code + '：' + String(response.getContentText()).slice(0, 300);
    }
    var httpErrMsg = 'Clarity 同步失敗：' + reason;
    console.error(httpErrMsg);
    return { ok: false, skipped: false, message: httpErrMsg, rowCount: 0 };
  }

  // ── 解析回傳（JSON array，每元素 { metricName, information: [...] }）──
  var payload;
  try {
    payload = JSON.parse(response.getContentText());
  } catch (e) {
    var parseErrMsg = 'Clarity 同步失敗：回傳非合法 JSON——' +
      String(response.getContentText()).slice(0, 300);
    console.error(parseErrMsg);
    return { ok: false, skipped: false, message: parseErrMsg, rowCount: 0 };
  }
  if (!Array.isArray(payload)) {
    var shapeMsg = 'Clarity 同步失敗：回傳格式非預期（不是 JSON array）';
    console.error(shapeMsg);
    return { ok: false, skipped: false, message: shapeMsg, rowCount: 0 };
  }

  var rows = buildClarityRows_(payload, today);

  if (rows.length === 0) {
    // 呼叫成功但今日無流量資料：仍標記已同步，避免反覆重打空資料把額度耗掉
    props.setProperty(CLARITY_CONFIG.lastSyncProperty, today);
    var emptyMsg = 'Clarity：API 回傳成功但今日無頁面資料（可能尚無流量），未新增列';
    console.log(emptyMsg);
    return { ok: true, skipped: false, message: emptyMsg, rowCount: 0 };
  }

  try {
    appendClarityRows_(rows);
  } catch (e) {
    var writeErrMsg = 'Clarity 同步失敗：寫入「' + CLARITY_CONFIG.sheetName + '」分頁發生例外——' + e;
    console.error(writeErrMsg);
    return { ok: false, skipped: false, message: writeErrMsg, rowCount: 0 };
  }

  // 只有真的寫入成功才記錄「今日已同步」（防重複）——放最後才設，避免中途失敗卻擋掉當天重試
  props.setProperty(CLARITY_CONFIG.lastSyncProperty, today);

  var okMsg = 'Clarity：已寫入 ' + rows.length + ' 列（' + today + '）';
  console.log(okMsg);
  return { ok: true, skipped: false, message: okMsg, rowCount: rows.length };
}

/**
 * 把 Clarity 回傳（依 metricName 分組）轉成「一頁一列」的表格資料。
 * 回傳每列：[日期, 頁面(URL), Rage, Dead, ExcessiveScroll, ScrollDepth, EngagementTime, Traffic]
 * metricName 用正規化（去空白、轉小寫）比對，避免 Clarity 端字串空白/大小寫變動就對不上。
 */
function buildClarityRows_(payload, dateStr) {
  var byUrl = {}; // url -> 各指標值

  function ensure(u) {
    if (!byUrl[u]) {
      byUrl[u] = {
        url: u, rage: '', dead: '', excessiveScroll: '',
        scrollDepth: '', engagementTime: '', traffic: ''
      };
    }
    return byUrl[u];
  }

  payload.forEach(function (metric) {
    var name = normalizeMetricName_(metric && metric.metricName);
    var info = (metric && Array.isArray(metric.information)) ? metric.information : [];

    info.forEach(function (item) {
      // dimension1=URL 時每筆帶 URL 欄；欄名大小寫不保證，一律容錯
      var u = item.Url || item.URL || item.url || item.pageUrl || '(未分類)';
      var row = ensure(u);

      if (name === 'rageclickcount' || name === 'rageclicks') {
        row.rage = pickNum_(item, ['subTotal', 'rageClickCount', 'sessionsCount', 'pagesViews']);
      } else if (name === 'deadclickcount' || name === 'deadclicks') {
        row.dead = pickNum_(item, ['subTotal', 'deadClickCount', 'sessionsCount', 'pagesViews']);
      } else if (name === 'excessivescroll' || name === 'excessivescrolling') {
        row.excessiveScroll = pickNum_(item, ['subTotal', 'sessionsCount', 'pagesViews']);
      } else if (name === 'scrolldepth' || name === 'averagescrolldepth') {
        row.scrollDepth = pickNum_(item, ['averageScrollDepth', 'subTotal']);
      } else if (name === 'engagementtime' || name === 'averageengagementtime') {
        row.engagementTime = pickNum_(item, ['totalTime', 'activeTime', 'averageEngagementTime', 'subTotal']);
      } else if (name === 'traffic') {
        row.traffic = pickNum_(item, ['totalSessionCount', 'distinctUserCount', 'sessionsCount', 'subTotal']);
      }
      // 其餘 metric（Popular Pages 等）目前不入表，需要時再加分支
    });
  });

  return Object.keys(byUrl).map(function (u) {
    var r = byUrl[u];
    return [dateStr, r.url, r.rage, r.dead, r.excessiveScroll, r.scrollDepth, r.engagementTime, r.traffic];
  });
}

/** metricName 正規化：去掉所有非英文字母、轉小寫（"Rage Click Count" → "rageclickcount"） */
function normalizeMetricName_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

/** 依候選欄名依序取第一個有值的數字；能轉數字就轉，否則原樣回傳；都沒有回空字串 */
function pickNum_(item, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = item[keys[i]];
    if (v !== undefined && v !== null && v !== '') {
      var n = Number(v);
      return isNaN(n) ? v : n;
    }
  }
  return '';
}

/**
 * 把資料列 append 到「Clarity_每日」分頁（不覆蓋舊資料——API 留不住超過 3 天，靠這裡累積歷史）。
 * 分頁或表頭不存在時自動建立。
 */
function appendClarityRows_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CLARITY_CONFIG.sheetName);
  var headers = [
    '日期', '頁面(URL)', 'Rage Click Count', 'Dead Click Count',
    'Excessive Scroll', 'Scroll Depth', 'Engagement Time', 'Traffic(工作階段數)'
  ];

  if (!sheet) {
    sheet = ss.insertSheet(CLARITY_CONFIG.sheetName);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }

  // 一次批次寫入所有列（append 在最後一列之後，不動舊資料）
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}
