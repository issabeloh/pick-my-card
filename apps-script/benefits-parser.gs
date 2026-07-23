/**
 * 權益解析腳本（BENEFITS-AUTOMATION-PLAN.md 第二階段，MVP：新戶活動）
 *
 * 這是備份副本——實際執行的版本貼在「PMC 自動化流程」試算表的 Apps Script 專案裡
 * （擴充功能 → Apps Script → 新增指令碼檔案「權益解析」）。兩邊改動時請記得同步。
 *
 * ⚠️ 架構（2026-07 分檔後）：本腳本住在「PMC 自動化流程」試算表（＝自動化檔），
 *   Watchlist / 情報收件匣 / 解析輸入 / 待審核-* 都在這本；
 *   卡片正式資料（Cards Data）在另一本「信用卡管理系統」試算表（＝資料檔），
 *   本腳本用 openById 跨檔唯讀讀取卡片 ID 清單，絕不寫回資料檔。
 *
 * 核心原則（規劃書三鐵則）：
 *   1. AI 只做閱讀理解，輸出被 JSON Schema 鎖死的結構化資料
 *   2. promo_id 編號、cap 公式、bonus_rate 加 % ——全部由程式生成，AI 不做算術
 *   3. 結果一律寫進「待審核-新戶活動」工作表，絕不直接碰正式資料表
 *
 * 首次設定（只做一次）：
 *   1. 到 https://aistudio.google.com/apikey 免費申請 Gemini API 金鑰
 *   2. Apps Script → 左側齒輪「專案設定」→ 指令碼屬性 → 新增兩筆（⚠️ 值不要直接寫在程式碼裡）：
 *        GEMINI_API_KEY        = 你的 Gemini 金鑰
 *        CARDS_SPREADSHEET_ID  = 資料檔「信用卡管理系統」試算表的 ID
 *                                （從它網址 /spreadsheets/d/【這一段】/edit 複製）
 *   3. 重新整理試算表，工具列會出現「🤖 權益自動化」選單
 *
 * 使用方式（兩個入口）：
 *   A. 解析收件匣：監控偵測到變動後，選單 → 「解析收件匣（新戶活動）」
 *      會處理「情報收件匣」中狀態=待解析 的每一列
 *   B. 解析貼上的文字：把官網活動文字貼進「解析輸入」分頁 A2（卡片提示貼 B2），
 *      選單 → 「解析『解析輸入』的文字」——取代原本貼給 GEM 的流程
 *
 * 審核流程：
 *   到「待審核-新戶活動」分頁逐列檢查（AI 沒把握的列 needs_review=TRUE、附上它想問的問題），
 *   確認沒問題後，把該列「id 之後的欄位」整段複製貼到正式的新戶活動工作表，
 *   再把「核准」欄改 V。之後做「一鍵套用」時就不用手動複製了。
 */

/************** 設定區 **************/
const PARSER_CONFIG = {
  inboxSheet: '情報收件匣',          // 第一階段監控的產出（讀取來源）
  reviewSheet: '待審核-新戶活動',    // 解析結果（自動建立）
  inputSheet: '解析輸入',            // 手動貼文字用（自動建立）
  cardsSheet: 'Cards Data',          // 用來動態讀取合法的 card_id 清單（在「資料檔」，跨檔讀）
  notifyEmail: '',                   // 留空 = 寄給你自己
  model: 'gemini-2.5-flash',         // 免費額度夠用；要更省可改 gemini-2.5-flash-lite
  maxTextChars: 30000                // 送給 AI 的原文長度上限
};

/************** 自訂選單 **************/
// 本腳本住在專用的「PMC 自動化流程」試算表，這裡沒有匯出選單，onOpen 不會相衝，可安心自帶。
// （若日後又把它和匯出程式放進同一個專案，改回：刪掉這個 onOpen、由匯出檔的 onOpen 呼叫 buildAutomationMenu_()）
function onOpen() {
  buildAutomationMenu_();
}

function buildAutomationMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 權益自動化')
    .addItem('立即檢查監控（checkWatchlist）', 'checkWatchlist')
    .addSeparator()
    .addItem('解析收件匣（新戶活動）', 'parseInboxNewPromos')
    .addItem('解析「解析輸入」的文字（新戶活動）', 'parsePastedText')
    .addSeparator()
    .addItem('解析新卡（主要活動）', 'parseNewCard')                    // card-benefits-parser.gs
    .addItem('檢查廣告排除（全卡·每月）', 'checkAdExclusionsForAllCards') // card-benefits-parser.gs
    .addToUi();
}

/************** 入口 A：解析情報收件匣中「待解析」的列 **************/
function parseInboxNewPromos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inbox = ss.getSheetByName(PARSER_CONFIG.inboxSheet);
  if (!inbox) {
    SpreadsheetApp.getUi().alert('找不到「' + PARSER_CONFIG.inboxSheet + '」——先讓監控跑出結果再來解析');
    return;
  }

  const data = inbox.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const cStatus = headers.indexOf('狀態');
  const cCard = headers.indexOf('card_id');
  const cUrl = headers.indexOf('網址');
  const cNew = headers.indexOf('新文字');
  if (cStatus < 0 || cNew < 0) throw new Error('情報收件匣缺少「狀態」或「新文字」欄');

  let parsed = 0, promoCount = 0, reviewCount = 0;
  const failures = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cStatus]).trim() !== '待解析') continue;

    const cardHint = cCard >= 0 ? String(data[i][cCard] || '') : '';
    const url = cUrl >= 0 ? String(data[i][cUrl] || '') : '';
    const text = String(data[i][cNew] || '').slice(0, PARSER_CONFIG.maxTextChars);

    try {
      const promos = extractNewPromos_(text, cardHint);
      writePromosToReview_(promos, '收件匣列 ' + (i + 1) + (url ? '｜' + url : ''), url);
      promoCount += promos.length;
      reviewCount += promos.filter(function (p) { return p.needs_review; }).length;
      inbox.getRange(i + 1, cStatus + 1).setValue(
        promos.length ? '已解析' : '已解析-無新戶活動');
      parsed++;
    } catch (e) {
      failures.push('列 ' + (i + 1) + '：' + e.message);
    }
  }

  const msg = '處理了 ' + parsed + ' 列收件匣，解析出 ' + promoCount + ' 個新戶活動' +
    (reviewCount ? '（其中 ' + reviewCount + ' 個 AI 沒把握，標了 needs_review）' : '') +
    (failures.length ? '\n失敗：\n' + failures.join('\n') : '');
  notifyParseResult_(msg, promoCount);
  SpreadsheetApp.getActiveSpreadsheet().toast(msg.split('\n')[0], '解析完成', 8);
}

/************** 入口 B：解析「解析輸入」分頁貼上的文字 **************/
function parsePastedText() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PARSER_CONFIG.inputSheet);
  if (!sheet) {
    sheet = ss.insertSheet(PARSER_CONFIG.inputSheet);
    sheet.getRange('A1').setValue('活動原文（貼在 A2，整段貼一格）');
    sheet.getRange('B1').setValue('卡片提示（選填，貼 B2，如 yushan-unicard 或「玉山Uni卡」）');
    sheet.getRange('C1').setValue('來源網址（選填，貼 C2）');
    sheet.setFrozenRows(1);
    SpreadsheetApp.getUi().alert('已建立「' + PARSER_CONFIG.inputSheet + '」分頁。把活動文字貼進 A2 後再執行一次。');
    return;
  }

  const text = String(sheet.getRange('A2').getValue() || '').slice(0, PARSER_CONFIG.maxTextChars);
  const cardHint = String(sheet.getRange('B2').getValue() || '');
  const link = String(sheet.getRange('C2').getValue() || '');
  if (!text.trim()) {
    SpreadsheetApp.getUi().alert('「' + PARSER_CONFIG.inputSheet + '」的 A2 是空的——先把活動原文貼進去');
    return;
  }

  const promos = extractNewPromos_(text, cardHint);
  writePromosToReview_(promos, '手動貼上', link);

  const msg = promos.length
    ? '解析出 ' + promos.length + ' 個活動，已寫進「' + PARSER_CONFIG.reviewSheet + '」'
    : 'AI 判斷這段文字裡沒有新戶活動（若不對，補上卡片提示再試一次）';
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, '解析完成', 8);
}

/************** 核心：呼叫 Gemini，回傳結構化的活動陣列 **************/
function extractNewPromos_(rawText, cardHint) {
  const cardIds = getCardIds_();

  const systemPrompt = [
    '你是台灣信用卡「新戶活動」的資料分析師。從我提供的官網文字中，找出所有與新戶/核卡相關的活動，輸出結構化 JSON。',
    '',
    '【總則】',
    'A. 只提取文字中明確寫出的資訊，絕不自行假設或腦補；找不到的欄位一律省略。',
    'B. 每個「獨立活動」（不同條件、不同期限）輸出一個物件；同一活動包含多種回饋類型時，放在同一物件的 promo_types 陣列。',
    'C. 所有文字欄位（summary、condition、notes、definition…）一律不要以句號結尾。',
    'D. 「贈品／禮品／好禮」等字樣，在我們的欄位一律稱「首刷禮」（promo_types 用「首刷禮」）；但 gift_content 照官網寫贈品的實際品名即可。',
    '',
    '【各欄位規則】',
    '1. promo_types 只能選：首刷禮（實體或虛擬禮品，如行李箱、商品卡）、回饋加碼（特定消費有額外百分比回饋）、定額點數（固定金額的點數或刷卡金）。',
    '2. new_customer_definition：官網對「新戶」的定義，照實摘錄成一句話；未明確說明則省略。',
    '3. promo_condition：把「持卡人為了拿到獎勵必須完成的任務」逐項拆解。若有兩項以上，用①②③④⑤依序編號、每項簡要說明（約25字內）；只有一項時直接寫一句、不必編號。這些任務不要再重複寫進 notes。',
    '3a. promo_condition 寫法要「精簡、把修飾語放進名詞」：把官網「新增N筆一般消費且每筆金額均滿NT$X(含)以上」濃縮成「新增N筆NT$X元(含)以上的一般消費」；不要保留「且每筆金額均滿」這種贅字。同理其他任務也用最短、資訊不漏的講法。',
    '4. new_customer_summary：一句話帶出「核卡後X天內＋（可選）最關鍵門檻＋獎勵」，詳細條件已在 promo_condition，summary 只挑最關鍵的門檻（如單筆滿多少、累積滿多少）點出即可，不要把每個條件都塞進來。結尾不加句號。',
    '4a. 原文出現「Money 101專屬連結」「Money101專屬」「M101獨家」這類字樣時：m101_exclusive 填 true，且 new_customer_summary 的最前面加上「【大師加碼】」。若該活動必須透過該連結申辦才享有，summary 用「透過本站連結申辦」的講法。範例：「【大師加碼】核卡後30天內，符合條件即享刷卡金200元」、「【大師加碼】透過本站連結申辦並刷滿NT$3,000元，享首刷禮3選1」。沒有這類字樣則 m101_exclusive 填 false、summary 不加前綴。',
    '5. 日期格式 YYYY/M/D；官網寫「即日起」則 period_start 省略。',
    '6. gift_content：僅 promo_types 含首刷禮時填，寫官網的實際品名（如「TRAVEL FOX 25吋上掀式行李箱」）。',
    '7. bonus_rate_percent、bonus_cap_amount、voucher_amount 只填官網寫的原始數字（如 7、200、500），不做任何計算或換算。',
    '8. notes 放「非任務」的重要限制，依序涵蓋：回饋結構拆解（官網標榜「最高X%」時列出所有組成）、核卡期限、不可與其他活動並行、消費排除條款（哪些交易不算一般消費）、發放規則與名額限制；不同類別之間用全形分號「；」分隔。已寫進 promo_condition 的任務不要重複。',
    '8a. notes「不要」收錄這類通用罰則／免責樣板（幾乎每張卡都一樣、對用戶無資訊量）：未完成任務即喪失資格、取消交易/退貨致不符資格、卡片非有效狀態、延滯繳款、違反約定條款、於贈禮前取消自動扣繳將喪失資格、銀行保留修改/終止活動權利等。這些一律略過，不要寫進任何欄位。',
    '9. evidence：逐字引用支撐回饋率/上限/期間的官網原文句子。',
    '10. 任何不確定之處（官網未列排除清單、文字看起來不完整、卡片對應不確定）→ needs_review 填 true，並把你想問的問題寫進 review_question。',
    '11. 文字中若沒有新戶活動，promos 回傳空陣列。',
    '',
    '【完整示範】原文：富邦 J 卡，活動期間 2026/7/1～2026/9/30，新戶核卡後30天內完成「新增3筆一般消費且每筆滿NT$1,000、設定本行帳戶自動扣繳或申請電子帳單並取消紙本、完成登錄」即贈 TRAVEL FOX 25吋上掀式行李箱；限2026/10/15前核卡；新戶定義為申辦日前6個月未持有任何富邦信用卡正卡；不可與本行其他新戶刷卡禮或其他通路辦卡平台活動並行。應輸出：',
    '  promo_types=["首刷禮"]',
    '  new_customer_definition="自申辦日起前6個月，未曾持有任何一張富邦信用卡正卡者"',
    '  new_customer_summary="核卡後30天內，符合條件即贈行李箱"',
    '  promo_condition="①新增3筆NT$1,000元(含)以上的一般消費\\n②30天內設定本行本人帳戶自動扣繳本行信用卡款 (或) 申請電子帳單，同時取消實體帳單\\n③登錄活動"',
    '  period_start="2026/7/1" period_end="2026/9/30"',
    '  gift_content="TRAVEL FOX 25吋上掀式行李箱(最新雙開款)"',
    '  notes="限於2026/10/15前核卡始符合活動資格；無法與本行其他新戶刷卡禮活動同時參與，亦不適用其他通路、辦卡平台之新戶首刷禮活動"',
    '（注意：①用精簡寫法「N筆X元(含)以上的一般消費」而非「N筆一般消費且每筆滿X」；三個任務在 promo_condition 逐點列出、notes 不再重複；notes 沒有收「喪失資格/銀行保留權利」那類樣板；所有欄位無句號；編號連續①②③）',
    cardHint ? '\n卡片提示：這段文字很可能屬於「' + cardHint + '」。' : ''
  ].join('\n');

  const schema = {
    type: 'OBJECT',
    properties: {
      promos: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            card_id: { type: 'STRING', enum: cardIds, description: '對應的卡片 ID' },
            promo_types: { type: 'ARRAY', items: { type: 'STRING', enum: ['首刷禮', '回饋加碼', '定額點數'] } },
            new_customer_definition: { type: 'STRING' },
            new_customer_summary: { type: 'STRING' },
            promo_condition: { type: 'STRING', description: '達成獎勵的任務；兩項以上用①②③編號、每項簡述，只有一項不編號' },
            period_start: { type: 'STRING', description: 'YYYY/M/D；即日起則省略' },
            period_end: { type: 'STRING', description: 'YYYY/M/D' },
            gift_content: { type: 'STRING', description: '僅 promo_types 含首刷禮時填，寫官網實際品名' },
            bonus_rate_percent: { type: 'NUMBER', description: '加碼回饋率的原始數字，如 5' },
            bonus_merchants: { type: 'ARRAY', items: { type: 'STRING' }, description: '加碼適用通路；所有消費填 *all_items' },
            bonus_cap_amount: { type: 'NUMBER', description: '加碼「回饋金額」上限的原始數字，如 200。不要換算' },
            voucher_amount: { type: 'NUMBER', description: '定額點數數量，如 500' },
            voucher_usage: { type: 'STRING', description: '點數名稱，如 玉山e point' },
            notes: { type: 'STRING' },
            m101_exclusive: { type: 'BOOLEAN', description: '原文出現 Money 101專屬連結／M101獨家 等字樣時為 true' },
            evidence: { type: 'STRING' },
            confidence: { type: 'STRING', enum: ['高', '中', '低'] },
            needs_review: { type: 'BOOLEAN' },
            review_question: { type: 'STRING' }
          },
          required: ['card_id', 'promo_types', 'new_customer_summary', 'evidence', 'needs_review']
        }
      }
    },
    required: ['promos']
  };

  const result = callGemini_(systemPrompt, '以下是信用卡官網文字：\n\n' + rawText, schema);
  return (result && result.promos) || [];
}

/************** 呼叫 Gemini API（結構化輸出） **************/
function callGemini_(systemPrompt, userText, responseSchema) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('尚未設定 GEMINI_API_KEY——到「專案設定 → 指令碼屬性」新增（金鑰到 https://aistudio.google.com/apikey 免費申請）');
  }

  const payload = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: responseSchema
    }
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    PARSER_CONFIG.model + ':generateContent?key=' + apiKey;

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) break;
    if (code === 429 || code >= 500) { Utilities.sleep(3000 * (attempt + 1)); continue; }
    throw new Error('Gemini API HTTP ' + code + '：' + res.getContentText().slice(0, 300));
  }
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini API 重試後仍失敗（HTTP ' + res.getResponseCode() + '）');
  }

  const body = JSON.parse(res.getContentText());
  const part = body.candidates && body.candidates[0] &&
    body.candidates[0].content && body.candidates[0].content.parts &&
    body.candidates[0].content.parts[0];
  if (!part || !part.text) throw new Error('Gemini 回應裡沒有內容：' + res.getContentText().slice(0, 300));
  return JSON.parse(part.text);
}

/************** 程式負責的部分：編號、公式、格式，然後寫進待審核表 **************/
function writePromosToReview_(promos, source, link) {
  if (!promos.length) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PARSER_CONFIG.reviewSheet);
  if (!sheet) {
    sheet = ss.insertSheet(PARSER_CONFIG.reviewSheet);
    sheet.appendRow([
      '核准', '解析時間', '來源', 'AI信心', 'needs_review', 'AI想問的問題', '原文引用',
      // ↓ 從這裡開始與正式「新戶活動」表的欄位一一對應，審核後整段複製即可
      'id', 'promo_id', 'promo_types', 'new_customer_definition', 'new_customer_summary',
      'promo_condition', 'period_start', 'period_end', 'gift_content', 'gift_image_url',
      'bonus_rate', 'bonus_merchants', 'bonus_cap', 'voucher_amount', 'voucher_usage',
      'notes', 'link', 'priority', 'active', 'apply_cta_text', 'apply_cta_link', 'apply_cta_expiry'
    ]);
    sheet.setFrozenRows(1);
  }

  const existingIds = sheet.getDataRange().getValues()
    .map(function (r) { return String(r[8] || ''); });  // promo_id 欄（第 9 欄，index 8）
  const nameMap = getCardNameMap_();

  const now = new Date();
  promos.forEach(function (p) {
    const promoId = buildPromoId_(p.card_id, p.period_start, existingIds);
    existingIds.push(promoId);

    const bonusRate = (p.bonus_rate_percent !== undefined && p.bonus_rate_percent !== null && p.bonus_rate_percent !== 0)
      ? p.bonus_rate_percent + '%' : '';
    const bonusCap = buildCapFormula_(p.bonus_cap_amount, p.bonus_rate_percent);
    // apply_cta_text：M101 專屬活動 → 「透過連結申辦，再享專屬首刷禮」；一般活動 → 「申辦{卡名}」
    const applyCtaText = p.m101_exclusive
      ? '透過連結申辦，再享專屬首刷禮'
      : (nameMap[p.card_id] ? '申辦' + nameMap[p.card_id] : '');

    const row = [
      '',                                        // 核准（你打 V）
      now,
      source,
      p.confidence || '',
      p.needs_review ? 'TRUE' : '',
      p.review_question || '',
      p.evidence || '',
      // ↓ 與正式表一一對應
      p.card_id,                                 // id
      promoId,                                   // promo_id
      (p.promo_types || []).join(','),           // promo_types
      p.new_customer_definition || '',           // new_customer_definition
      p.new_customer_summary || '',              // new_customer_summary
      p.promo_condition || '',                   // promo_condition
      p.period_start || '',                      // period_start
      p.period_end || '',                        // period_end
      p.gift_content || '',                      // gift_content
      '',                                        // gift_image_url（你手動貼圖片網址）
      bonusRate,                                 // bonus_rate
      (p.bonus_merchants || []).join(','),       // bonus_merchants
      bonusCap,                                  // bonus_cap
      p.voucher_amount || '',                    // voucher_amount
      p.voucher_usage || '',                     // voucher_usage
      p.notes || '',                             // notes
      p.link || link || '',                      // link
      '',                                        // priority 固定留空
      'TRUE',                                    // active
      applyCtaText,                              // apply_cta_text（預設值，可改）
      '',                                        // apply_cta_link（你手動貼推薦連結）
      ''                                         // apply_cta_expiry（你手動填連結到期日）
    ];
    sheet.appendRow(row);
    if (p.needs_review) {
      sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBackground('#fff3cd'); // 標黃
    }
  });
}

// promo_id：{card_id}-{年}-{月縮寫}，撞號自動加 -1、-2…（規則寫死在程式，AI 不編號）
function buildPromoId_(cardId, periodStart, existingIds) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let year, month;
  const m = String(periodStart || '').match(/^(\d{4})\/(\d{1,2})/);
  if (m) { year = m[1]; month = months[parseInt(m[2], 10) - 1]; }
  else {
    const today = new Date();
    year = String(today.getFullYear());
    month = months[today.getMonth()];
  }
  const base = cardId + '-' + year + '-' + month;
  if (existingIds.indexOf(base) === -1) return base;
  for (let n = 1; ; n++) {
    if (existingIds.indexOf(base + '-' + n) === -1) return base + '-' + n;
  }
}

// cap 公式：=回饋上限金額/加碼率小數（如 =200/0.07）。AI 只給兩個原始數字，公式由程式組
function buildCapFormula_(capAmount, ratePercent) {
  if (!capAmount) return '';
  if (!ratePercent) return String(capAmount);
  return '=' + capAmount + '/' + (ratePercent / 100);
}

/************** 跨檔開啟「資料檔」試算表（唯讀讀 Cards Data 用） **************/
function getCardsSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('CARDS_SPREADSHEET_ID');
  if (!id) {
    throw new Error('尚未設定 CARDS_SPREADSHEET_ID——到「專案設定 → 指令碼屬性」新增，值 = 資料檔「信用卡管理系統」試算表網址裡 /d/ 後面那段 ID');
  }
  let ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('用 CARDS_SPREADSHEET_ID 開資料檔失敗（ID 可能貼錯，或此帳號沒有該試算表存取權）：' + e.message);
  }
  const sheet = ss.getSheetByName(PARSER_CONFIG.cardsSheet);
  if (!sheet) throw new Error('資料檔裡找不到「' + PARSER_CONFIG.cardsSheet + '」工作表');
  return sheet;
}

/************** 從 Cards Data 動態讀取合法卡片 ID（不用再手動維護對照表） **************/
function getCardIds_() {
  const sheet = getCardsSheet_();
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].map(function (h) { return String(h).trim(); }).indexOf('id');
  if (idCol < 0) throw new Error(PARSER_CONFIG.cardsSheet + ' 第一列找不到 id 欄');
  const ids = [];
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idCol] || '').trim();
    if (id) ids.push(id);
  }
  return ids;
}

// id → 卡片簡稱（name 欄），用來給 apply_cta_text 產生「申辦{卡名}」預設值
function getCardNameMap_() {
  const map = {};
  let sheet;
  try {
    sheet = getCardsSheet_();
  } catch (e) {
    return map;  // 讀不到資料檔就退回空 map（apply_cta_text 留空，不擋解析）
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const idCol = headers.indexOf('id');
  const nameCol = headers.indexOf('name');
  if (idCol < 0 || nameCol < 0) return map;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idCol] || '').trim();
    const name = String(data[i][nameCol] || '').trim();
    if (id && name) map[id] = name;
  }
  return map;
}

/************** 通知 **************/
function notifyParseResult_(message, promoCount) {
  if (!promoCount) return;
  const to = PARSER_CONFIG.notifyEmail || Session.getActiveUser().getEmail();
  MailApp.sendEmail(to,
    '【權益解析】' + promoCount + ' 個新戶活動等你審核',
    message + '\n\n請到試算表的「' + PARSER_CONFIG.reviewSheet + '」分頁審核。');
}
