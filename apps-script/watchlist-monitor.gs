/**
 * 權益監控腳本（BENEFITS-AUTOMATION-PLAN.md 第一階段）
 *
 * 這是備份副本——實際執行的版本貼在 Google Sheets 的 Apps Script 專案裡
 * （擴充功能 → Apps Script → 新增指令碼檔案「權益監控」）。
 * 兩邊改動時請記得同步。
 *
 * 需要的工作表：
 *   Watchlist —— 第一列表頭至少要有：url、last_snapshot
 *                建議完整表頭：card_id | bank | url | watch_type | css_selector
 *                             | last_snapshot | last_checked | active
 *   情報收件匣 —— 不用自己建，腳本會自動建立
 *
 * 使用方式：
 *   1. 在 Watchlist 填入要監控的網址（active 填 TRUE）
 *   2. 手動執行一次 checkWatchlist（第一次只存基準快照，不會通知）
 *   3. 設定時間驅動觸發器：函數選 checkWatchlist、事件來源選 Time-driven
 */

/************** 設定區（可自行調整） **************/
const MONITOR_CONFIG = {
  watchlistSheet: 'Watchlist',
  inboxSheet: '情報收件匣',
  notifyEmail: '',   // 留空 = 寄給你自己（試算表登入帳號）
  // 關鍵字閘門：變動段落至少要含一個才算事件
  keywords: ['回饋', '加碼', '%', '％', '權益', '活動', '調整', '終止', '停止', '新戶', '上限', '登錄', '延長', '生效'],
  minDiffChars: 30,        // 變動總字數少於這個門檻視為雜訊
  snapshotMaxChars: 45000  // 快照長度上限（Sheets 一格上限 5 萬字，留餘裕）
};

/************** 主函數：觸發器要叫醒的就是它 **************/
function checkWatchlist() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MONITOR_CONFIG.watchlistSheet);
  if (!sheet) throw new Error('找不到工作表：' + MONITOR_CONFIG.watchlistSheet);

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const col = function (name) { return headers.indexOf(name); };

  const cUrl = col('url');
  const cSnap = col('last_snapshot');
  const cChecked = col('last_checked');
  const cActive = col('active');
  const cCard = col('card_id');
  const cBank = col('bank');
  if (cUrl < 0 || cSnap < 0) {
    throw new Error('Watchlist 第一列必須有 url 與 last_snapshot 這兩個表頭（小寫）');
  }

  const alerts = [];
  const errors = [];
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const url = String(row[cUrl] || '').trim();
    if (!url) continue;
    if (cActive >= 0 && String(row[cActive]).toUpperCase() === 'FALSE') continue;

    let text;
    try {
      text = fetchPageText_(url).slice(0, MONITOR_CONFIG.snapshotMaxChars);
    } catch (e) {
      errors.push((row[cCard] || '') + ' ' + url + '：' + e.message);
      continue;
    }

    const oldText = String(row[cSnap] || '');

    if (!oldText) {
      // 第一次抓這個網址：只存基準快照，不通知
      sheet.getRange(i + 1, cSnap + 1).setValue(text);
      if (cChecked >= 0) sheet.getRange(i + 1, cChecked + 1).setValue(now);
      continue;
    }

    const changedText = diffSegments_(oldText, text).join('\n');
    const hasKeyword = MONITOR_CONFIG.keywords.some(function (k) {
      return changedText.indexOf(k) !== -1;
    });

    if (changedText.length >= MONITOR_CONFIG.minDiffChars && hasKeyword) {
      appendToInbox_(ss, {
        time: now,
        cardId: row[cCard] || '',
        bank: row[cBank] || '',
        url: url,
        summary: changedText.slice(0, 200),
        oldText: oldText,
        newText: text
      });
      alerts.push({
        cardId: row[cCard] || '',
        bank: row[cBank] || '',
        url: url,
        summary: changedText.slice(0, 300)
      });
    }

    // 不論是不是事件，都把快照更新成最新版
    sheet.getRange(i + 1, cSnap + 1).setValue(text);
    if (cChecked >= 0) sheet.getRange(i + 1, cChecked + 1).setValue(now);
  }

  if (alerts.length || errors.length) sendDigest_(alerts, errors);
}

/************** 抓網頁 → 只留人看得到的正文 **************/
function fetchPageText_(url) {
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
    }
  });
  const code = res.getResponseCode();
  if (code >= 400) throw new Error('HTTP ' + code);

  let html = res.getContentText();
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (html.length < 100) {
    throw new Error('抓到的正文太短（' + html.length + ' 字），可能是動態網頁或被擋，建議改監控該行的公告列表頁');
  }
  return html;
}

/************** 比對新舊：回傳「新增的句子」與「消失的句子」 **************/
function diffSegments_(oldText, newText) {
  const split = function (t) {
    return t
      .split(/(?<=[。！？!?；;])|\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length >= 8; });
  };
  const oldSet = new Set(split(oldText));
  const newSet = new Set(split(newText));

  const added = [];
  newSet.forEach(function (s) { if (!oldSet.has(s)) added.push('＋ ' + s); });
  const removed = [];
  oldSet.forEach(function (s) { if (!newSet.has(s)) removed.push('－ ' + s); });

  return added.concat(removed);
}

/************** 寫進情報收件匣（沒有就自動建） **************/
function appendToInbox_(ss, info) {
  let sheet = ss.getSheetByName(MONITOR_CONFIG.inboxSheet);
  if (!sheet) {
    sheet = ss.insertSheet(MONITOR_CONFIG.inboxSheet);
    sheet.appendRow(['日期時間', 'card_id', '銀行', '網址', '變化摘要', '舊文字', '新文字', '狀態']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    info.time,
    info.cardId,
    info.bank,
    info.url,
    info.summary,
    info.oldText.slice(0, 40000),
    info.newText.slice(0, 40000),
    '待解析'
  ]);
}

/************** 寄彙總通知信 **************/
function sendDigest_(alerts, errors) {
  const to = MONITOR_CONFIG.notifyEmail || Session.getActiveUser().getEmail();
  let body = '';

  if (alerts.length) {
    body += '偵測到 ' + alerts.length + ' 個網頁有權益相關變動：\n\n';
    alerts.forEach(function (a) {
      body += '■ ' + a.cardId + (a.bank ? '（' + a.bank + '）' : '') + '\n' +
              a.url + '\n變動摘要：\n' + a.summary + '\n\n';
    });
    body += '完整新舊內容請看試算表的「' + MONITOR_CONFIG.inboxSheet + '」分頁。\n\n';
  }
  if (errors.length) {
    body += '⚠ 以下網址抓取失敗（可能是動態網頁或擋機器人，見規劃書 §2.4）：\n' +
            errors.join('\n') + '\n';
  }

  const subject = '【信用卡權益監控】' +
    (alerts.length ? alerts.length + ' 筆變動待處理' : '抓取異常通知');
  MailApp.sendEmail(to, subject, body);
}
