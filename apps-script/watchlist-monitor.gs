/**
 * 權益監控腳本（BENEFITS-AUTOMATION-PLAN.md 第一階段）
 *
 * 這是備份副本——實際執行的版本貼在 Google Sheets 的 Apps Script 專案裡
 * （擴充功能 → Apps Script → 新增指令碼檔案「權益監控」）。
 * 兩邊改動時請記得同步。
 *
 * 需要的工作表：
 *   Watchlist —— 第一列表頭至少要有：url、last_snapshot
 *                建議完整表頭：card_id | bank | url | watch_type | cards | css_selector
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
 * 卡片欄位語意（2026-07-29 改版；css_selector 仍只是備註欄，程式不會讀）：
 *   card_id    —— **只填 Cards Data 的正式卡片 id**（第二階段解析靠它對資料）。
 *                 多卡頁（公告頁／一般消費頁）**留空**，不要填 febank-basic 這種頁級標籤
 *   watch_type —— card＝單卡權益頁；bank＝多卡公告／一般消費頁。
 *                 留空會依 card_id 有沒有填自動推斷（有＝card、沒有＝bank），不會報錯
 *   cards      —— 選填。多卡頁涵蓋哪幾張卡的**正式 id**，逗號分隔
 *                 （半形/全形逗號、頓號都吃）。這一欄會寫進「2-變動通知」的 card_id 欄，
 *                 讓第二階段解析知道候選卡片有哪幾張
 *   bank       —— 銀行名稱，通知信與 AI 分類都會用到；多卡頁一定要填（信裡靠它認人）
 *
 * 舊表格相容：沒有 cards 欄、watch_type 全空、card_id 全填 → 行為與改版前完全相同。
 *
 * 使用方式：
 *   1. 在 Watchlist 填入要監控的網址（active 填 TRUE）
 *   2. 手動執行一次 checkWatchlist（第一次只存基準快照，不會通知）
 *   3. 設定時間驅動觸發器：函數選 checkWatchlist、事件來源選 Time-driven
 *   4. 表格改完可用選單「🤖 權益自動化 → 檢查監控清單」機械檢查有沒有填錯
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
  const cType = col('watch_type');
  const cCards = col('cards');      // 新欄位，舊表格沒有時是 -1，下面一律走安全降級
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

    // 卡片欄位：card_id 只認正式 id、多卡頁靠 cards 欄列出候選（欄位不存在就是空的，不報錯）
    const cardId = cCard >= 0 ? String(row[cCard] || '').trim() : '';
    const bank = cBank >= 0 ? String(row[cBank] || '').trim() : '';
    const cardList = cCards >= 0 ? splitList_(row[cCards]) : [];
    // watch_type=bank ＝站長明講「這是多卡頁」：即使 card_id 還留著舊的頁級標籤，
    // 也不要拿它當卡片用（信裡顯示銀行頁講法、下游 card_id 優先用 cards 清單）
    const isBankPage = resolveWatchType_(cType >= 0 ? row[cType] : '', cardId) === 'bank';
    // 通知信／錯誤訊息的顯示名稱；「2-變動通知」的 card_id 欄則要寫下游解析用得到的 id
    const label = buildRowLabel_(isBankPage ? '' : cardId, bank);
    const inboxCardId = isBankPage ? (cardList.join(',') || cardId) : (cardId || cardList.join(','));

    let text;
    try {
      text = fetchPageText_(url, fetchVia).slice(0, MONITOR_CONFIG.snapshotMaxChars);
    } catch (e) {
      errors.push(label + ' ' + url + '：' + e.message);
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
      rebaselined.push(label + ' ' + url +
        '（舊基準 ' + oldText.length + ' 字 → 本次 ' + text.length + ' 字）');
      continue;
    }

    // 反方向的落差（本次不到舊基準的 1/3）＝ 這次多半沒抓好（渲染失敗、被擋、只回骨架），
    // 不是整頁活動真的下架。這種要當成錯誤回報，而且**絕對不能覆寫 last_snapshot**——
    // 一旦覆寫，好的基準就沒了，下一次會再誤報一次「大量新增」。
    // 若確認是網頁真的整頁改版，人工把該列 last_snapshot 清空即可重建基準。
    if (oldText.length >= 300 && text.length * 3 < oldText.length) {
      errors.push(label + ' ' + url +
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
      const cls = classifyDiff_(changedText, text, inboxCardId, bank);
      appendToInbox_(ss, {
        time: now,
        cardId: inboxCardId,   // 單卡＝card_id；多卡頁＝cards 清單，下游解析靠這一欄當卡片線索
        bank: bank,
        url: url,
        diffText: changedText,
        oldText: oldText,
        newText: text,
        cls: cls
      });
      alerts.push({
        cardId: inboxCardId,
        label: label,
        bank: (!isBankPage && cardId) ? bank : '',   // 多卡頁的 label 已含銀行名，不再重複掛括號
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

/************** 欄位小工具（cards / watch_type / 顯示名稱） **************/
// 逗號分隔清單 → 陣列。半形逗號、全形逗號、頓號都吃；空值回空陣列（欄位不存在時也走這裡）
function splitList_(raw) {
  return String(raw || '')
    .split(/[,，、]/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
}

// watch_type：card＝單卡權益頁、bank＝多卡公告／一般消費頁。
// 留空或填了看不懂的值 → 依 card_id 有沒有填自動推斷，不報錯（表格還沒整理好也要能跑）
function resolveWatchType_(raw, cardId) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'card' || v === 'bank') return v;
  return cardId ? 'card' : 'bank';
}

// 通知信／錯誤訊息裡這一列叫什麼：有 card_id 就用 card_id，
// 沒有就用「<銀行> 一般消費/公告頁」——多卡頁本來就不該有 card_id，不是缺漏
function buildRowLabel_(cardId, bank) {
  if (cardId) return cardId;
  if (bank) return bank + ' 一般消費/公告頁';
  return '一般消費/公告頁';
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
  // 比對用的鍵：把空白全部拿掉。銀行改個 HTML 標籤就會讓同一句多／少一個空格
  // （實例：「中薯券一張 <活動詳情>」→「中薯券一張<活動詳情>」），內容一字未變卻被
  // 算成一增一減、觸發通知，AI 只能回「純版面調整」。fetchDirect_ 的 \s+→' ' 只能
  // 統一空白「種類」，管不到空格「有無」，所以要在比對層擋掉這一類雜訊。
  // 顯示仍用原文（Map 存 鍵→第一次出現的原文），信裡看到的還是實際句子。
  // 兩個已知取捨：① 英文單字間的空白也會被忽略（LINE Bank／LINEBank 視為同句）；
  // ② 上面 8 字門檻量的是含空白長度，所以 6~8 字的極短段落若空格數變了仍可能出現幽靈差異
  //    ——實際頁面的段落遠長於 8 字，不為這個角落改動上面那段切法。
  const indexByKey = function (segs) {
    const map = new Map();
    segs.forEach(function (s) {
      const k = s.replace(/\s+/g, '');
      if (!map.has(k)) map.set(k, s);
    });
    return map;
  };
  const oldMap = indexByKey(split(oldText));
  const newMap = indexByKey(split(newText));

  const added = [];
  newMap.forEach(function (s, k) { if (!oldMap.has(k)) added.push('＋ ' + s); });
  const removed = [];
  oldMap.forEach(function (s, k) { if (!newMap.has(k)) removed.push('－ ' + s); });

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
      // 顯示名稱走 label：單卡＝card_id，多卡頁＝「<銀行> 一般消費/公告頁」
      let s = '■ ' + (a.label || a.cardId || '一般消費/公告頁') + (a.bank ? '（' + a.bank + '）' : '');
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

/************** 選單：檢查監控清單（2026-07-29 新增） **************/
// 一鍵機械檢查表格填法，只讀不寫——不碰 last_snapshot、不寫任何分頁，結果直接跳視窗。
// 掛在 benefits-parser.gs 的 buildAutomationMenu_（選單「檢查監控清單」）。
function checkWatchlistConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MONITOR_CONFIG.watchlistSheet);
  const ui = SpreadsheetApp.getUi();
  if (!sheet) {
    ui.alert('檢查監控清單', '找不到工作表：' + MONITOR_CONFIG.watchlistSheet, ui.ButtonSet.OK);
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const col = function (name) { return headers.indexOf(name); };
  const cUrl = col('url');
  const cCard = col('card_id');
  const cType = col('watch_type');
  const cCards = col('cards');
  const cActive = col('active');
  const cBank = col('bank');

  // 問題分組收集，最後才排版——同一件事只講一次，訊息按類型聚合（47 列的清單也不會爆版）
  const notes = [];              // 提醒等級，不算問題
  const g = {
    bankKeepsCardId: [],         // watch_type=bank 但 card_id 還沒清空
    unknownCardId: [],           // card_id 不在 Cards Data（單卡列才報，多卡列併進上一組）
    bankNoBank: [],              // 多卡頁但 bank 欄空著（通知信會認不出是誰）
    bankNoCards: [],             // 多卡頁但 cards 欄空著
    badWatchType: [],
    cardNoCardId: [],
    unknownCards: [],
    dupUrl: [],
    badActive: [],
    noUrl: []
  };

  if (cUrl < 0) notes.push('⚠ 表頭缺少 url 欄——監控根本跑不起來，先補表頭');
  if (cCards < 0) notes.push('ℹ 還沒有 cards 欄：多卡頁的候選卡片傳不到解析階段。建議插一欄，第 1 列打小寫 cards');

  // Cards Data 讀不到就跳過「id 存不存在」這類檢查，其餘照驗
  let cardIds = null;
  try {
    if (typeof getCardIds_ === 'function') cardIds = getCardIds_();
  } catch (e) {
    notes.push('ℹ 讀不到 Cards Data，這次略過「id 是否存在」的檢查：' + e.message);
  }

  const seenUrl = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowNo = i + 1;
    const url = cUrl >= 0 ? String(row[cUrl] || '').trim() : '';
    const blankRow = row.every(function (v) { return !String(v == null ? '' : v).trim(); });
    if (!url && blankRow) continue;   // 整列空白＝略過

    if (!url) {
      g.noUrl.push(rowNo);
      continue;
    }
    const urlKey = url.toLowerCase();
    if (seenUrl[urlKey]) {
      g.dupUrl.push({ row: rowNo, first: seenUrl[urlKey], url: url });
    } else {
      seenUrl[urlKey] = rowNo;
    }

    const cardId = cCard >= 0 ? String(row[cCard] || '').trim() : '';
    const cardsRaw = cCards >= 0 ? splitList_(row[cCards]) : [];
    const rawType = cType >= 0 ? String(row[cType] || '').trim() : '';
    const type = rawType.toLowerCase();
    const knownType = (type === 'card' || type === 'bank');
    if (rawType && !knownType) g.badWatchType.push({ row: rowNo, raw: rawType });

    if (type === 'bank') {
      // 多卡頁：card_id 本來就該是空的。還留著＝步驟 3 只做一半，
      // 這時「card_id 不在 Cards Data」是同一件事，不要再報一次
      if (cardId) g.bankKeepsCardId.push({ row: rowNo, cardId: cardId, hasCards: cardsRaw.length > 0 });
      else if (cCards >= 0 && !cardsRaw.length) g.bankNoCards.push(rowNo);
      // 多卡頁沒有 card_id，bank 就是通知信裡唯一能認人的欄位，空著等於信裡沒署名
      if (cBank >= 0 && !String(row[cBank] || '').trim()) g.bankNoBank.push(rowNo);
    } else {
      if (type === 'card' && !cardId) g.cardNoCardId.push(rowNo);
      if (cardId && cardIds && cardIds.indexOf(cardId) < 0) g.unknownCardId.push({ row: rowNo, cardId: cardId });
    }

    if (cardIds) {
      cardsRaw.forEach(function (id) {
        if (cardIds.indexOf(id) < 0) g.unknownCards.push({ row: rowNo, id: id });
      });
    }

    if (cActive >= 0) {
      const active = String(row[cActive] || '').trim().toUpperCase();
      if (active && active !== 'TRUE' && active !== 'FALSE') {
        g.badActive.push({ row: rowNo, raw: String(row[cActive]).trim() });
      }
    }
  }

  const rows = Math.max(0, data.length - 1);
  const blocks = [];
  // 「該修的問題」與「可選提醒」分開算——bankNoCards 不擋監控也不影響通知信，
  // 混進問題總數會讓人以為有 17 件事要做，其實只有 1 件
  const total = g.bankKeepsCardId.length + g.unknownCardId.length +
    g.bankNoBank.length + g.badWatchType.length + g.cardNoCardId.length + g.unknownCards.length +
    g.dupUrl.length + g.badActive.length + g.noUrl.length;
  const optional = g.bankNoCards.length;

  const block = function (title, lines) {
    if (lines.length) blocks.push('【' + title + '】' + lines.length + ' 列\n' + lines.join('\n'));
  };

  block('watch_type=bank 但 card_id 還沒清空 → 把這幾列的 card_id 整格刪掉，改填 cards 欄',
    g.bankKeepsCardId.map(function (x) {
      return '  第 ' + x.row + ' 列：card_id=' + x.cardId + (x.hasCards ? '（cards 已填好）' : '（cards 也還沒填）');
    }));
  block('多卡頁（watch_type=bank）沒填 bank → 通知信只會顯示「一般消費/公告頁」，認不出是哪家，請補銀行名',
    g.bankNoBank.map(function (r) { return '  第 ' + r + ' 列'; }));
  block('card_id 不在 Cards Data → 單卡頁請改成正式 id；若其實是多卡頁，watch_type 填 bank 並清空 card_id',
    g.unknownCardId.map(function (x) { return '  第 ' + x.row + ' 列：' + x.cardId; }));
  block('cards 欄的 id 不在 Cards Data → 打錯字，或該卡還沒建',
    g.unknownCards.map(function (x) { return '  第 ' + x.row + ' 列：' + x.id; }));
  block('watch_type 值不合法（只能 card / bank，留空＝自動推斷）',
    g.badWatchType.map(function (x) { return '  第 ' + x.row + ' 列：' + x.raw; }));
  block('watch_type=card 卻沒填 card_id',
    g.cardNoCardId.map(function (r) { return '  第 ' + r + ' 列'; }));
  block('url 重複 → 同一頁會抓兩次、同一變動寄兩封信，刪掉其中一列',
    g.dupUrl.map(function (x) { return '  第 ' + x.row + ' 列 ＝ 第 ' + x.first + ' 列：' + x.url; }));
  block('active 不是 TRUE/FALSE（只有 FALSE 會停用，其餘一律照抓）',
    g.badActive.map(function (x) { return '  第 ' + x.row + ' 列：' + x.raw; }));
  block('沒填 url，這一列不會被監控',
    g.noUrl.map(function (r) { return '  第 ' + r + ' 列'; }));
  // 這一組不擋監控，只影響解析階段的卡片線索，放最後、也不計入問題數
  block('可選提醒：多卡頁還沒填 cards → 監控與通知都正常，只是解析階段少了卡片線索',
    g.bankNoCards.map(function (r) { return '  第 ' + r + ' 列'; }));

  if (!total && !optional && !notes.length) {
    ui.alert('檢查監控清單', '✅ ' + rows + ' 列都沒問題', ui.ButtonSet.OK);
    return;
  }

  let msg = '檢查了 ' + rows + ' 列，' +
    (total ? '找到 ' + total + ' 個要修的問題' : '沒有要修的問題 ✅') +
    (optional ? '（另有 ' + optional + ' 條可選提醒，不影響監控與通知）' : '') + '\n';
  if (notes.length) msg += '\n' + notes.join('\n') + '\n';
  if (blocks.length) msg += '\n' + blocks.join('\n\n');
  if (msg.length > 8000) msg = msg.slice(0, 8000) + '\n…（訊息過長已截斷，修完上面幾組再跑一次）';
  ui.alert('檢查監控清單', msg, ui.ButtonSet.OK);
}

