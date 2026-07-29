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
 *                             | last_snapshot | last_checked | active | fetch_via
 *                             | keywords | min_diff_chars
 *   情報收件匣 —— 不用自己建，腳本會自動建立
 *
 * fetch_via 欄（選填，2026-07-08 新增，處理動態網頁/擋機器人）：
 *   留空或 auto —— 先直接抓，失敗才走 Jina Reader 備援
 *   jina        —— 一律走 Jina Reader（已知是動態網頁的銀行填這個，避免直接抓
 *                  「偶爾成功、偶爾失敗」造成新舊快照格式不同的假警報）
 *   direct      —— 一律直接抓，不用備援
 *
 * keywords / min_diff_chars 欄（選填，2026-07-08 新增，留空 = 用全域 MONITOR_CONFIG）：
 *   keywords       —— 這一列專用關鍵字，逗號分隔（半形/全形逗號、頓號都可）。
 *                     公告標題頁建議填該行的卡片名稱，例：永豐SPORT卡,夢行,幣倍
 *   min_diff_chars —— 這一列專用雜訊門檻。公告標題頁建議填 10
 *                     （一條新標題常見 15~30 字，全域預設 30 會漏掉短標題）
 *
 * 注意：watch_type、css_selector 目前只是備註欄，程式不會讀。
 *   card_id 填法：權益頁（一卡一頁）必須填 Cards Data 的正式 id；
 *               公告頁（多卡共用）填頁級標籤即可，例：sinopac-news
 *
 * 使用方式：
 *   1. 在 Watchlist 填入要監控的網址（active 填 TRUE）
 *   2. 手動執行一次 checkWatchlist（第一次只存基準快照，不會通知）
 *   3. 設定時間驅動觸發器：函數選 checkWatchlist、事件來源選 Time-driven
 */

/************** 設定區（可自行調整） **************/
const MONITOR_CONFIG = {
  watchlistSheet: '1-監控清單',
  inboxSheet: '2-變動通知',
  notifyEmail: '',   // 留空 = 寄給你自己（試算表登入帳號）
  // 關鍵字閘門：變動段落至少要含一個才算事件
  keywords: ['回饋', '加碼', '%', '％', '權益', '活動', '調整', '終止', '停止', '新戶', '上限', '登錄', '延長', '生效'],
  minDiffChars: 30,        // 變動總字數少於這個門檻視為雜訊
  snapshotMaxChars: 45000, // 快照長度上限（Sheets 一格上限 5 萬字，留餘裕）
  // 動態網頁/擋機器人的備援：直接抓失敗時改走 Jina Reader（免費的「網頁轉純文字」服務，
  // 會用真的瀏覽器幫你渲染 JS 動態網頁）。不需申請就能用（每分鐘額度較低）；
  // 用量大再到 https://jina.ai/reader 免費申請金鑰，存進「專案設定 → 指令碼屬性」JINA_API_KEY
  jinaFallback: true
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
  const cVia = col('fetch_via');
  const cKeywords = col('keywords');
  const cMinDiff = col('min_diff_chars');
  if (cUrl < 0 || cSnap < 0) {
    throw new Error('Watchlist 第一列必須有 url 與 last_snapshot 這兩個表頭（小寫）');
  }

  const alerts = [];
  const errors = [];
  const rebaselined = [];   // 基準快照落差懸殊、本次只重建不通知的列
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const url = String(row[cUrl] || '').trim();
    if (!url) continue;
    if (cActive >= 0 && String(row[cActive]).toUpperCase() === 'FALSE') continue;

    const fetchVia = cVia >= 0 ? String(row[cVia] || '').trim().toLowerCase() : '';

    let text;
    try {
      text = fetchPageText_(url, fetchVia).slice(0, MONITOR_CONFIG.snapshotMaxChars);
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

    // 基準快照與本次落差懸殊（舊的不到新的 1/3）＝ 基準本身有問題，不是網頁真的改了。
    // 常見成因：last_snapshot 是人工貼的片段、或該列從直接抓改走 Jina。
    // 這種情況整頁都會被算成「新增」，AI 一定誤判成大量新活動 → 只重建基準、不通知。
    if (oldText.length * 3 < text.length) {
      sheet.getRange(i + 1, cSnap + 1).setValue(text);
      if (cChecked >= 0) sheet.getRange(i + 1, cChecked + 1).setValue(now);
      rebaselined.push((row[cCard] || '(未填card_id)') + ' ' + url +
        '（舊基準 ' + oldText.length + ' 字 → 本次 ' + text.length + ' 字）');
      continue;
    }

    // 反方向的落差（本次不到舊基準的 1/3）＝ 這次多半沒抓好（渲染失敗、被擋、只回骨架），
    // 不是整頁活動真的下架。這種要當成錯誤回報，而且**絕對不能覆寫 last_snapshot**——
    // 一旦覆寫，好的基準就沒了，下一次會再誤報一次「大量新增」。
    // 若確認是網頁真的整頁改版，人工把該列 last_snapshot 清空即可重建基準。
    if (oldText.length >= 300 && text.length * 3 < oldText.length) {
      errors.push((row[cCard] || '(未填card_id)') + ' ' + url +
        '：這次只抓到 ' + text.length + ' 字（舊基準 ' + oldText.length +
        ' 字），疑似抓取失敗，已略過並保留原基準。請人工開網頁確認；' +
        '若確實整頁改版，請把該列 last_snapshot 清空後重跑');
      if (cChecked >= 0) sheet.getRange(i + 1, cChecked + 1).setValue(now);
      continue;
    }

    // 這一列專用的關鍵字與雜訊門檻：欄位有填就覆蓋全域設定，留空用 MONITOR_CONFIG
    let rowKeywords = MONITOR_CONFIG.keywords;
    if (cKeywords >= 0) {
      const own = String(row[cKeywords] || '')
        .split(/[,，、]/)
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s; });
      if (own.length) rowKeywords = own;
    }
    let rowMinDiff = MONITOR_CONFIG.minDiffChars;
    if (cMinDiff >= 0) {
      const n = Number(row[cMinDiff]);
      if (n > 0) rowMinDiff = n;
    }

    const changedText = diffSegments_(oldText, text).join('\n');
    const hasKeyword = rowKeywords.some(function (k) {
      return changedText.indexOf(k) !== -1;
    });

    if (changedText.length >= rowMinDiff && hasKeyword) {
      // ① AI 判斷是否實質回饋變動 + 產一句人話摘要（失敗回 null，不擋監控）
      const cls = classifyDiff_(changedText, text, row[cCard] || '', row[cBank] || '');
      appendToInbox_(ss, {
        time: now,
        cardId: row[cCard] || '',
        bank: row[cBank] || '',
        url: url,
        diffText: changedText,
        oldText: oldText,
        newText: text,
        cls: cls
      });
      alerts.push({
        cardId: row[cCard] || '',
        bank: row[cBank] || '',
        url: url,
        diffText: changedText.slice(0, 300),
        cls: cls
      });
    }

    // 不論是不是事件，都把快照更新成最新版
    sheet.getRange(i + 1, cSnap + 1).setValue(text);
    if (cChecked >= 0) sheet.getRange(i + 1, cChecked + 1).setValue(now);
  }

  if (alerts.length || errors.length || rebaselined.length) sendDigest_(alerts, errors, rebaselined);
}

/************** 抓網頁 → 只留人看得到的正文 **************/
// fetchVia：''/'auto' = 先直接抓、失敗走 Jina 備援；'jina' = 一律走 Jina；'direct' = 只直接抓
function fetchPageText_(url, fetchVia) {
  if (fetchVia === 'jina') return fetchViaJina_(url);
  try {
    return fetchDirect_(url);
  } catch (e) {
    if (fetchVia === 'direct' || !MONITOR_CONFIG.jinaFallback) throw e;
    try {
      return fetchViaJina_(url);
    } catch (e2) {
      throw new Error('直接抓失敗（' + e.message + '），Jina 備援也失敗（' + e2.message +
        '）。若持續失敗，建議改監控該銀行的公告列表頁');
    }
  }
}

function fetchDirect_(url) {
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
    throw new Error('抓到的正文太短（' + html.length + ' 字），可能是動態網頁或被擋');
  }
  return html;
}

/************** 備援：透過 Jina Reader 抓（處理 JS 動態網頁與部分擋機器人的站） **************/
// 原理：把網址接在 https://r.jina.ai/ 後面，Jina 會用真的瀏覽器開這一頁、等 JS 跑完，
// 回傳純文字。免申請可直接用；有金鑰（指令碼屬性 JINA_API_KEY）額度更高。
function fetchViaJina_(url) {
  const headers = { 'X-Return-Format': 'text' };  // 只要純文字，不要 markdown 連結雜訊
  const key = PropertiesService.getScriptProperties().getProperty('JINA_API_KEY');
  if (key) headers['Authorization'] = 'Bearer ' + key;

  const res = UrlFetchApp.fetch('https://r.jina.ai/' + url, {
    muteHttpExceptions: true,
    headers: headers
  });
  const code = res.getResponseCode();
  if (code >= 400) throw new Error('Jina HTTP ' + code);

  const text = res.getContentText().replace(/\s+/g, ' ').trim();

  // Jina 有一種「假成功」：HTTP 200，但正文渲染失敗，只回一段標頭
  //   Title: … URL Source: … Published Time: … Markdown Content: undefined
  // 這串超過 100 字，會騙過長度檢查、被當成「整頁活動都消失」寫回 last_snapshot，
  // 下一次再變成「大量新增」。所以要先剝掉標頭、只看真正的內文長度。
  const body = jinaBodyOnly_(text);
  if (body === 'undefined' || body.length < 100) {
    throw new Error('Jina 回傳空殼（內文只有 ' + body.length + ' 字：「' +
      body.slice(0, 40) + '」），這一頁渲染失敗。請稍後重跑，或把該列 fetch_via 改回 direct');
  }
  return text;
}

// 剝掉 Jina Reader 的固定標頭（Title / URL Source / Published Time / Markdown Content:），只留內文
function jinaBodyOnly_(text) {
  const m = text.match(/Markdown Content:\s*([\s\S]*)$/);
  if (m) return m[1].trim();
  return text.replace(/^Title:\s*[\s\S]*?URL Source:\s*\S+\s*/, '').trim();
}

/************** 比對新舊：回傳「新增的句子」與「消失的句子」 **************/
function diffSegments_(oldText, newText) {
  const MAX_SEG = 160;
  const split = function (t) {
    const out = [];
    t.split(/(?<=[。！？!?；;])|\n/).forEach(function (s) {
      s = s.trim();
      if (!s) return;
      if (s.length <= MAX_SEG) {
        if (s.length >= 8) out.push(s);
        return;
      }
      // 標點稀疏的頁面（表格、Notion 匯出的活動列表）整頁只有寥寥幾個句號，
      // 不再切的話全頁會變成一個大段落 → 動一個字就整頁算「換掉」，AI 只能回「整頁改版」。
      // 先用次級標點切，還是太長就沿空白切成小塊，讓變動能定位到局部。
      s.split(/(?<=[，,、：:）)】」])/).forEach(function (p) {
        p = p.trim();
        while (p.length > MAX_SEG) {
          let cut = p.lastIndexOf(' ', MAX_SEG);
          if (cut < 40) cut = MAX_SEG;
          const head = p.slice(0, cut).trim();
          if (head.length >= 8) out.push(head);
          p = p.slice(cut).trim();
        }
        if (p.length >= 8) out.push(p);
      });
    });
    return out;
  };
  const oldSet = new Set(split(oldText));
  const newSet = new Set(split(newText));

  const added = [];
  newSet.forEach(function (s) { if (!oldSet.has(s)) added.push('＋ ' + s); });
  const removed = [];
  oldSet.forEach(function (s) { if (!newSet.has(s)) removed.push('－ ' + s); });

  return added.concat(removed);
}

/************** ① AI 分類：這次變動是不是「實質回饋變動」＋一句人話摘要 **************/
// 依賴同專案 benefits-parser.gs 的 callGemini_；沒貼或 API 失敗都回 null（不擋監控，照樣寄信）
function classifyDiff_(changedText, newFullText, cardId, bank) {
  if (typeof callGemini_ !== 'function') return null;
  try {
    const sys = [
      '你是台灣信用卡權益監控助手。我給你某張卡官網頁面「這次偵測到的新增(＋)與消失(－)段落」以及「新版全文」，你判斷是否為「實質回饋變動」並用一句人話摘要。',
      '【實質回饋變動 material=true】會改變持卡人實際能拿多少：回饋率、回饋上限、加碼通路增減、達成條件(登錄/自動扣繳/門檻金額)、活動新增或到期下架、新戶首刷禮、續期/延期/縮期。',
      '【非實質 material=false】純版面/文案/錯字/免責法律樣板/導覽列/日期格式/同段落改寫或搬移，不影響回饋。',
      '⚠️ 判斷「活動下架」要非常謹慎：－(消失)的段落常常只是「改寫、搬移、重新排版」，不代表活動取消。判「下架/改版」前，先在下方【新版全文】搜尋該回饋是否還在——若還找得到（只是換句話說或移到別處），就【不是下架】，可能只是改寫(material 依實際回饋數字有無變化而定)。',
      '⚠️ 反過來也要抓「真的新增」：若＋段落裡有「舊版完全沒有的全新卡片/銀行/活動/回饋率」（不是把舊內容換句話說），那就是實質新增 material=true、change_types 含「新增活動」——不要因為頁面同時有大量改版雜訊，就把夾在裡面的真新增一起當成改寫漏掉。整頁重排的聚合頁（如多家卡片列表）尤其要留意有沒有多出新的一批。',
      'summary：一句話講重點，有數字寫「X→Y」(如 上限300→500)；material=false 就寫「純版面/文案調整或改寫，回饋未變」。結尾不加句號。',
      '不確定 → material=true、confidence=低（寧可誤報不漏報）。',
      cardId ? ('卡片：' + cardId + (bank ? '（' + bank + '）' : '')) : ''
    ].join('\n');
    const schema = {
      type: 'OBJECT',
      properties: {
        material: { type: 'BOOLEAN' },
        summary: { type: 'STRING' },
        change_types: { type: 'ARRAY', items: { type: 'STRING', enum: ['回饋率', '上限', '通路', '條件', '期間', '新增活動', '活動下架', '新戶禮', '改寫搬移', '其他'] } },
        confidence: { type: 'STRING', enum: ['高', '中', '低'] }
      },
      required: ['material', 'summary', 'confidence']
    };
    const userText = '【這次的變動段落（＋新增／－消失）】\n' + changedText.slice(0, 12000) +
      '\n\n【新版全文（用來核對「消失」的內容是否真的不見了）】\n' + String(newFullText || '').slice(0, 22000);
    return callGemini_(sys, userText, schema);
  } catch (e) {
    return null;
  }
}

/************** 寫進情報收件匣（沒有就自動建） **************/
// ⚠️ 2026-07 加了 AI 分類欄位，欄位順序變了：舊的「情報收件匣」請刪掉讓它自動重建新表頭
function appendToInbox_(ss, info) {
  let sheet = ss.getSheetByName(MONITOR_CONFIG.inboxSheet);
  if (!sheet) {
    sheet = ss.insertSheet(MONITOR_CONFIG.inboxSheet);
    sheet.appendRow(['日期時間', 'card_id', '銀行', '網址',
      '實質變動', 'AI摘要', '變動類型', '信心', '變動段落', '舊文字', '新文字', '狀態']);
    sheet.setFrozenRows(1);
  }
  const c = info.cls;
  const row = sheet.appendRow([
    info.time,
    info.cardId,
    info.bank,
    info.url,
    c ? (c.material ? '是' : '否') : '',
    c ? (c.summary || '') : '',
    c && c.change_types ? c.change_types.join(',') : '',
    c ? (c.confidence || '') : '',
    (info.diffText || '').slice(0, 8000),
    info.oldText.slice(0, 40000),
    info.newText.slice(0, 40000),
    '待解析'
  ]);
  // 實質變動標紅、其餘標灰，一眼可分
  if (c) {
    sheet.getRange(sheet.getLastRow(), 5).setBackground(c.material ? '#f8d7da' : '#e9ecef');
  }
}

/************** 寄彙總通知信 **************/
function sendDigest_(alerts, errors, rebaselined) {
  const to = MONITOR_CONFIG.notifyEmail || Session.getActiveUser().getEmail();
  let body = '';

  if (alerts.length) {
    const material = alerts.filter(function (a) { return a.cls && a.cls.material; });
    const minor = alerts.filter(function (a) { return !(a.cls && a.cls.material); });
    const anyClassified = alerts.some(function (a) { return a.cls; });

    body += '偵測到 ' + alerts.length + ' 個網頁變動' +
            (anyClassified ? '（🔴 實質 ' + material.length + '、⚪ 其餘 ' + minor.length + '）' : '') + '：\n\n';

    const render = function (a) {
      let s = '■ ' + a.cardId + (a.bank ? '（' + a.bank + '）' : '');
      if (a.cls) {
        s += ' ｜信心' + (a.cls.confidence || '') +
             (a.cls.change_types && a.cls.change_types.length ? ' ｜' + a.cls.change_types.join('、') : '') + '\n';
        s += '   ' + (a.cls.summary || '') + '\n';
      } else {
        s += '\n   （AI 未分類，原始變動段落）\n   ' + (a.diffText || '') + '\n';
      }
      s += '   ' + a.url + '\n\n';
      return s;
    };

    if (material.length) { body += '─── 🔴 實質回饋變動（優先看）───\n'; material.forEach(function (a) { body += render(a); }); }
    if (minor.length) { body += '─── ⚪ 其餘變動（版面/文案等，通常可略）───\n'; minor.forEach(function (a) { body += render(a); }); }
    body += '完整新舊內容請看試算表的「' + MONITOR_CONFIG.inboxSheet + '」分頁。\n\n';
  }
  if (rebaselined && rebaselined.length) {
    body += '─── 🔧 已重建基準快照（本次不判讀變動）───\n' +
            '這些列的舊基準與本次抓到的長度落差懸殊，代表舊基準本身有問題\n' +
            '（常見：last_snapshot 是人工貼的片段，或該列從直接抓改走 Jina），\n' +
            '整頁會被誤算成「大量新增」。本次已重建基準，下次起即可正常比對：\n' +
            rebaselined.join('\n') + '\n\n';
  }
  if (errors.length) {
    body += '⚠ 以下網址抓取失敗（可能是動態網頁或擋機器人，見規劃書 §2.4）：\n' +
            errors.join('\n') + '\n\n' +
            '提示：在 Watchlist 該列的 fetch_via 欄填 jina 可強制走備援抓法；' +
            '若備援也失敗，把 url 換成該銀行的公告/最新消息列表頁。\n';
  }

  const materialCount = alerts.filter(function (a) { return a.cls && a.cls.material; }).length;
  const subject = '【信用卡權益監控】' +
    (alerts.length
      ? (materialCount + ' 筆實質變動 / 共 ' + alerts.length + ' 筆')
      : '抓取異常通知');
  MailApp.sendEmail(to, subject, body);
}

