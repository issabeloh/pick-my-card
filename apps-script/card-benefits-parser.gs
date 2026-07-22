/**
 * 主要信用卡活動解析（BENEFITS-AUTOMATION-PLAN.md 第二階段，新卡權益）
 *
 * 這是備份副本——實際執行版貼在「PMC 資料自動化」試算表的 Apps Script 專案裡
 * （新增檔案「權益解析-新卡」）。與 benefits-parser.gs 同一個專案，共用它的
 * callGemini_() / getCardsSheet_() / getCardIds_()，本檔不重複定義那些。
 *
 * 用途：解析一張「全新卡片」的官網權益頁 → 產出可貼進 Cards Data 的資料。
 *   AI 只抽事實欄位（rate/items/category/條件/期間/cap 金額/語意分類）；
 *   程式算 cap 消費上限、產出安全的 cashbackModel、鋪版面。
 *
 * ⚠️ cashbackModel 的分界（最重要）：
 *   - 單層安全模型（純指定通路→留空、排除型→'rate'、一般海外→海外配方）：程式產出
 *   - 跨槽疊加模型（rate+rate_1+basic 這類）：程式「無法」從文字推導，會把該組標黃、
 *     cashbackModel 留空、附提示，請你參考同卡其他組手填（這是資料建模決策，不是抽取）
 *
 * 使用方式：
 *   1. 選單「🤖 權益自動化 → 解析新卡（主要活動）」，第一次會建「新卡解析輸入」分頁
 *   2. 官網權益頁文字貼進該分頁 A2（卡片提示貼 B2 可留空、網址貼 C2）
 *   3. 再執行一次 → 產出「待審核-新卡基本」與「待審核-新卡組別」兩張表
 *   4. 審：黃底＝AI 沒把握或 cashbackModel 需你手填；對照 evidence 欄驗證數字
 *   5. 基本表那一列貼進 Cards Data 對應固定欄位；組別逐組填進 rate_N/items_N/... 槽位
 */

/************** 設定區 **************/
const CARD_PARSER_CONFIG = {
  inputSheet: '新卡解析輸入',
  basicReviewSheet: '待審核-新卡基本',
  groupReviewSheet: '待審核-新卡組別',
  maxTextChars: 40000
};

// tags 固定清單（對齊 tags GEM）——AI 只能從這裡選
const CARD_TAG_ENUM = [
  '旅遊', '開車族', '餐飲', '交通', '網購', '百貨公司', '外送', '娛樂', '行動支付',
  'AI工具', '便利商店', '串流平台', '超市', '藥妝', '時尚品牌', '直銷品牌', '生活百貨',
  '運動', '寵物', '親子', '應用程式商店', '飲食品牌', '美妝美髮保養品牌', '保費'
];

// 待審核-新卡基本 的固定欄位（＝ Cards Data 固定欄位順序；levelSettings/levelLabelFormat 留空手動）
const CARD_BASIC_FIELDS = [
  'id', 'name', 'fullName', 'basicCashback', 'basicCashbackType', 'pointsExpiry',
  'basicConditions', 'annualFee', 'feeWaiver', 'website', 'tags', 'hasLevels',
  'levelSettings', 'levelLabelFormat', 'overseasCashback', 'overseasBonusRate',
  'overseasBonusCap', 'overseasBonusConditions', 'domesticBonusRate',
  'domesticBonusCap', 'domesticBonusConditions', 'parking', 'airport_pickup', 'airport_lounge'
];

/************** 入口：解析新卡 **************/
function parseNewCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let input = ss.getSheetByName(CARD_PARSER_CONFIG.inputSheet);
  if (!input) {
    input = ss.insertSheet(CARD_PARSER_CONFIG.inputSheet);
    input.getRange('A1').setValue('官網權益頁文字（貼在 A2，整段貼一格）');
    input.getRange('B1').setValue('卡片 id 提示（選填，貼 B2，如 fubon-jcard；留空 AI 會擬一個）');
    input.getRange('C1').setValue('官網網址（選填，貼 C2）');
    input.setFrozenRows(1);
    SpreadsheetApp.getUi().alert('已建立「' + CARD_PARSER_CONFIG.inputSheet + '」分頁，把官網權益頁文字貼進 A2 後再執行一次。');
    return;
  }

  const text = String(input.getRange('A2').getValue() || '').slice(0, CARD_PARSER_CONFIG.maxTextChars);
  const idHint = String(input.getRange('B2').getValue() || '').trim();
  const link = String(input.getRange('C2').getValue() || '').trim();
  if (!text.trim()) {
    SpreadsheetApp.getUi().alert('「' + CARD_PARSER_CONFIG.inputSheet + '」的 A2 是空的——先把官網權益頁文字貼進去');
    return;
  }

  const parsed = extractCard_(text, idHint);
  const basic = parsed.basic || {};
  const groups = parsed.groups || [];

  // 新卡的 id 不該撞既有卡；撞了就標記提醒
  let idCollision = false;
  try {
    if (basic.id && getCardIds_().indexOf(basic.id) !== -1) idCollision = true;
  } catch (e) { /* 讀不到資料檔就跳過檢查，不擋流程 */ }

  writeBasicReview_(basic, link, idCollision);
  writeGroupReview_(basic.id || idHint || '(未定id)', groups);

  const flagged = groups.filter(function (g) { return g.needs_review; }).length;
  const msg = '解析完成：基本資料 1 列、回饋組別 ' + groups.length + ' 組' +
    (flagged ? '（其中 ' + flagged + ' 組 AI 沒把握）' : '') +
    (idCollision ? '\n⚠️ 這個 id 已存在於 Cards Data，若是新卡請改 id' : '') +
    '\n\n黃底列＝需你確認；cashbackModel 標「需手填」的請參考同卡其他組。';
  SpreadsheetApp.getActiveSpreadsheet().toast('基本 1 列 + 組別 ' + groups.length + ' 組', '新卡解析完成', 8);
  SpreadsheetApp.getUi().alert(msg);
}

/************** 核心：呼叫 Gemini 抽取新卡資料 **************/
function extractCard_(rawText, idHint) {
  const systemPrompt = [
    '你是台灣信用卡權益的資料分析師。從我提供的官網「卡片權益頁」文字中，抽取這張卡的基本資料與所有回饋組別，輸出結構化 JSON。',
    '',
    '【總則】',
    'A. 只抽文字中明確寫出的資訊，絕不自行假設或腦補；找不到的欄位一律省略。',
    'B. 你只負責「讀懂並抽取事實」。不要算 cap 消費上限、不要編 cashbackModel 計算模型字串——那些程式會做。',
    'C. 所有文字欄位不要以句號結尾。',
    '',
    '【basic 基本資料】',
    '1. id：小寫英文加連字號（例 fubon-jcard）；' + (idHint ? '優先用提示「' + idHint + '」。' : '依銀行簡稱與卡名自擬一個。'),
    '2. name：卡片簡稱；fullName：含銀行的完整名稱。',
    '3. basicCashback：基本回饋率數字（如 1）；basicCashbackType：回饋類型（現金回饋 / LINE POINTS 等）。',
    '4. pointsExpiry：點數效期規則；basicConditions：基本回饋的條件；annualFee：年費說明；feeWaiver：免年費條件；website：官網連結。',
    '5. tags：從固定清單挑通路標籤（只能挑清單內的）。',
    '6. hasLevels：是否有分級制度（true/false）。分級的 levelSettings 由人工填，你不用管。',
    '7. 海外：overseasCashback（基本海外回饋率數字）、overseasBonusRate（海外加碼率，只填加碼部分數字）、overseasBonusCap_reward（海外加碼的「回饋金額上限」原始數字）、overseasBonusConditions。',
    '8. 國內加碼：domesticBonusRate、domesticBonusCap_reward（回饋金額上限原始數字）、domesticBonusConditions。',
    '9. parking / airport_pickup / airport_lounge：停車、接送機、機場貴賓室等權益描述（有才填）。',
    '',
    '【groups 回饋組別，每個指定通路/活動一組】',
    '10. rate：這組的回饋率數字；items：適用通路陣列（實體/網購要標明，如「日本網購」「statement全聯實體」）；category：這組的分類標題；conditions：達成條件（登錄類寫「需登錄且限量，詳見官網」）；period_start/period_end：YYYY/M/D。',
    '11. cap_spend：官網直接講的「消費上限」金額數字（如「每月上限NT$25,000消費」→25000）；cap_reward：官網講的「回饋金額上限」數字（如「回饋上限500元」→500）。兩者擇一有填即可，沒有就都省略。',
    '12. group_kind：這組屬於哪類，只能選：指定通路加碼 / 國外一般消費 / 國外指定加碼 / 廣告 / 排除型 / 其他。（廣告＝Meta/Facebook/Google 等廣告平台；排除型＝這通路的回饋完全獨立、超額不回退到基本，如悠遊卡自動加值）',
    '13. is_stacked：這組的回饋是否「疊加在另一組之上」才成立（例如「踩點任務再加碼」是疊在基礎通路組上）。是的話填 true——程式會把它標記為需人工設定疊加模型。',
    '',
    '【每個物件都要】evidence：逐字引用支撐 rate/cap/期間的官網原句；needs_review：不確定就 true 並把問題寫進 review_question。'
  ].join('\n');

  const groupItem = {
    type: 'OBJECT',
    properties: {
      rate: { type: 'NUMBER' },
      items: { type: 'ARRAY', items: { type: 'STRING' } },
      category: { type: 'STRING' },
      conditions: { type: 'STRING' },
      period_start: { type: 'STRING', description: 'YYYY/M/D' },
      period_end: { type: 'STRING', description: 'YYYY/M/D' },
      group_kind: { type: 'STRING', enum: ['指定通路加碼', '國外一般消費', '國外指定加碼', '廣告', '排除型', '其他'] },
      is_stacked: { type: 'BOOLEAN', description: '是否疊加在另一組之上才成立' },
      cap_spend: { type: 'NUMBER', description: '消費上限金額（官網直接講）' },
      cap_reward: { type: 'NUMBER', description: '回饋金額上限（官網講回饋X元）' },
      evidence: { type: 'STRING' },
      needs_review: { type: 'BOOLEAN' },
      review_question: { type: 'STRING' }
    },
    required: ['rate', 'group_kind', 'evidence', 'needs_review']
  };

  const schema = {
    type: 'OBJECT',
    properties: {
      basic: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          name: { type: 'STRING' },
          fullName: { type: 'STRING' },
          basicCashback: { type: 'NUMBER' },
          basicCashbackType: { type: 'STRING' },
          pointsExpiry: { type: 'STRING' },
          basicConditions: { type: 'STRING' },
          annualFee: { type: 'STRING' },
          feeWaiver: { type: 'STRING' },
          website: { type: 'STRING' },
          tags: { type: 'ARRAY', items: { type: 'STRING', enum: CARD_TAG_ENUM } },
          hasLevels: { type: 'BOOLEAN' },
          overseasCashback: { type: 'NUMBER' },
          overseasBonusRate: { type: 'NUMBER' },
          overseasBonusCap_reward: { type: 'NUMBER' },
          overseasBonusConditions: { type: 'STRING' },
          domesticBonusRate: { type: 'NUMBER' },
          domesticBonusCap_reward: { type: 'NUMBER' },
          domesticBonusConditions: { type: 'STRING' },
          parking: { type: 'STRING' },
          airport_pickup: { type: 'STRING' },
          airport_lounge: { type: 'STRING' },
          evidence: { type: 'STRING' },
          needs_review: { type: 'BOOLEAN' },
          review_question: { type: 'STRING' }
        },
        required: ['name', 'basicCashback', 'needs_review']
      },
      groups: { type: 'ARRAY', items: groupItem }
    },
    required: ['basic', 'groups']
  };

  // callGemini_ 定義在 benefits-parser.gs（同專案）
  const result = callGemini_(systemPrompt, '以下是信用卡權益頁文字：\n\n' + rawText, schema);
  return result || { basic: {}, groups: [] };
}

/************** 程式：算 cap 消費上限 = 回饋金額上限 ÷ 加碼率% **************/
function spendCapFromReward_(rewardAmount, ratePercent) {
  if (!rewardAmount) return '';
  if (!ratePercent) return String(rewardAmount);
  return Math.round(rewardAmount / (ratePercent / 100));
}

/************** 程式：依 group_kind 決定 cashbackModel / hideInDisplay / 是否需人工 **************/
// 回傳 { model, hide, modelNeedsHuman, note }
function deriveGroupModel_(g) {
  // 疊加型：程式無法從文字推導跨槽模型，一律留空 + 標需人工
  if (g.is_stacked) {
    return { model: '', hide: '', modelNeedsHuman: true,
      note: '疑似疊加組，cashbackModel 請參考同卡其他組手填（如 rate+rate_1+basic）' };
  }
  switch (g.group_kind) {
    case '排除型':
      // cap 內用本組 rate、溢出算 0（不回退 basic）
      return { model: 'rate', hide: '', modelNeedsHuman: false,
        note: '排除型：cap 內用本組 rate、溢出算 0' };
    case '國外一般消費':
      // 標準隱藏配方：一般海外全額，海外基準 + 海外加碼，詳情頁隱藏
      return { model: 'overseasCashback+overseasBonusRate', hide: 'TRUE', modelNeedsHuman: true,
        note: '一般海外隱藏槽，請確認卡片有 overseasBonusRate 欄位' };
    case '國外指定加碼':
      return { model: 'rate>basic>overseasBonusRate', hide: '', modelNeedsHuman: true,
        note: '國外指定加碼，請確認基準/加碼成分是否正確' };
    case '廣告':
      // 廣告組通常疊加且以海外為基準，模型因卡而異，交人工
      return { model: '', hide: '', modelNeedsHuman: true,
        note: '廣告組模型因卡而異（常疊加、海外基準），請參考同卡其他組手填' };
    case '指定通路加碼':
      // 安全單層：留空 = cap 內 rate_N、溢出 basicCashback
      return { model: '', hide: '', modelNeedsHuman: false, note: '' };
    default:
      return { model: '', hide: '', modelNeedsHuman: false, note: '' };
  }
}

/************** 寫「待審核-新卡基本」 **************/
function writeBasicReview_(basic, link, idCollision) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CARD_PARSER_CONFIG.basicReviewSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CARD_PARSER_CONFIG.basicReviewSheet);
    sheet.appendRow(['核准', '解析時間', 'needs_review', 'AI想問的問題', '原文引用'].concat(CARD_BASIC_FIELDS));
    sheet.setFrozenRows(1);
  }

  // 海外/國內加碼的消費上限：由回饋金額上限換算
  const overseasCap = spendCapFromReward_(basic.overseasBonusCap_reward, basic.overseasBonusRate);
  const domesticCap = spendCapFromReward_(basic.domesticBonusCap_reward, basic.domesticBonusRate);

  const valueByField = {
    id: basic.id || '',
    name: basic.name || '',
    fullName: basic.fullName || '',
    basicCashback: (basic.basicCashback != null ? basic.basicCashback : ''),
    basicCashbackType: basic.basicCashbackType || '',
    pointsExpiry: basic.pointsExpiry || '',
    basicConditions: basic.basicConditions || '',
    annualFee: basic.annualFee || '',
    feeWaiver: basic.feeWaiver || '',
    website: basic.website || link || '',
    tags: (basic.tags || []).join(','),
    hasLevels: basic.hasLevels ? 'TRUE' : 'FALSE',
    levelSettings: '',        // 手動（級別名稱=識別碼，太脆弱）
    levelLabelFormat: '',     // 手動
    overseasCashback: (basic.overseasCashback != null ? basic.overseasCashback : ''),
    overseasBonusRate: (basic.overseasBonusRate != null ? basic.overseasBonusRate : ''),
    overseasBonusCap: overseasCap,
    overseasBonusConditions: basic.overseasBonusConditions || '',
    domesticBonusRate: (basic.domesticBonusRate != null ? basic.domesticBonusRate : ''),
    domesticBonusCap: domesticCap,
    domesticBonusConditions: basic.domesticBonusConditions || '',
    parking: basic.parking || '',
    airport_pickup: basic.airport_pickup || '',
    airport_lounge: basic.airport_lounge || ''
  };

  const fixedCells = CARD_BASIC_FIELDS.map(function (f) { return valueByField[f]; });
  const reviewQ = (basic.review_question || '') + (idCollision ? '（id 已存在，若為新卡請改 id）' : '');
  const row = ['', new Date(), basic.needs_review ? 'TRUE' : '', reviewQ, basic.evidence || ''].concat(fixedCells);
  sheet.appendRow(row);
  if (basic.needs_review || idCollision) {
    sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBackground('#fff3cd');
  }
}

/************** 寫「待審核-新卡組別」（垂直，一組一列） **************/
function writeGroupReview_(cardId, groups) {
  if (!groups.length) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CARD_PARSER_CONFIG.groupReviewSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CARD_PARSER_CONFIG.groupReviewSheet);
    sheet.appendRow([
      '核准', '解析時間', 'card_id', '建議槽位N', 'group_kind',
      'rate', 'items', 'cap(消費上限)', 'cashbackModel', 'cashbackModel需手填?',
      'category', 'conditions', 'period_start', 'period_end', 'hideInDisplay',
      '程式備註', 'needs_review', 'AI想問的問題', '原文引用'
    ]);
    sheet.setFrozenRows(1);
  }

  // 建議槽位 N：從這張卡目前在本表已出現的最大 N 接續（同一次解析內遞增）
  let startN = 1;
  const existing = sheet.getDataRange().getValues();
  for (let i = 1; i < existing.length; i++) {
    if (String(existing[i][2]) === cardId) {
      const n = parseInt(existing[i][3], 10);
      if (!isNaN(n) && n >= startN) startN = n + 1;
    }
  }

  const now = new Date();
  groups.forEach(function (g, idx) {
    const cap = (g.cap_spend != null && g.cap_spend !== '')
      ? Math.round(g.cap_spend)
      : spendCapFromReward_(g.cap_reward, g.rate);
    const d = deriveGroupModel_(g);
    const row = [
      '',                                        // 核准
      now,
      cardId,
      startN + idx,                              // 建議槽位 N
      g.group_kind || '',
      (g.rate != null ? g.rate : ''),
      (g.items || []).join(','),
      cap,
      d.model,
      d.modelNeedsHuman ? 'TRUE' : '',
      g.category || '',
      g.conditions || '',
      g.period_start || '',
      g.period_end || '',
      d.hide,
      d.note || '',
      g.needs_review ? 'TRUE' : '',
      g.review_question || '',
      g.evidence || ''
    ];
    sheet.appendRow(row);
    if (g.needs_review || d.modelNeedsHuman) {
      sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBackground('#fff3cd');
    }
  });
}
