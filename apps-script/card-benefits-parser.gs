/**
 * 主要信用卡活動解析（BENEFITS-AUTOMATION-PLAN.md 第二階段，新卡權益）
 *
 * 這是備份副本——實際執行版貼在「PMC 資料自動化」試算表的 Apps Script 專案裡
 * （新增檔案「權益解析-新卡」）。與 benefits-parser.gs 同一個專案，共用它的
 * callGemini_() / getCardsSheet_() / getCardIds_()，本檔不重複定義那些。
 *
 * 用途：解析一張「全新卡片」的官網權益頁 → 產出可貼進 Cards Data 的資料。
 *   AI 只抽事實欄位＋語意旗標；程式算 cap、產出安全 cashbackModel、生成固定槽位、鋪版面。
 *
 * ⚠️ cashbackModel 的分界：
 *   - 單層安全模型（純指定通路→留空、排除型→'rate'、國外指定→海外模型）：程式產出
 *   - 跨槽疊加（rate+rate_1+basic 這類）：程式無法從文字推導，標黃留空、附完整原文引用，人工手填
 *   - 固定槽位 14/21/22（廣告/國內/國外）：程式依卡片基本欄位「自動生成固定模板」
 *
 * 使用方式：
 *   1. 選單「🤖 權益自動化 → 解析新卡（主要活動）」，第一次會建「新卡解析輸入」分頁
 *   2. 官網權益頁文字貼 A2；id 提示貼 B2（選填）；網址貼 C2（選填）；
 *      一般消費/排除說明頁文字貼 D2（選填，但沒貼時廣告排除只能靠權益頁本身判斷）
 *   3. 再執行一次 → 產出「待審核-新卡基本」與「待審核-新卡組別」
 *   4. 審：黃底＝AI 沒把握或 cashbackModel 需你手填；對照 evidence 欄驗證，不必回官網
 */

/************** 設定區 **************/
const CARD_PARSER_CONFIG = {
  inputSheet: '新卡解析輸入',
  basicReviewSheet: '待審核-新卡基本',
  groupReviewSheet: '待審核-新卡組別',
  maxTextChars: 40000
};

const RESERVED_SLOTS = [14, 21, 22];  // 廣告/國內/國外固定槽位，一般組別編號要跳過

// tags 固定清單（對齊 tags GEM）——AI 只能從這裡選
const CARD_TAG_ENUM = [
  '旅遊', '開車族', '餐飲', '交通', '網購', '百貨公司', '外送', '娛樂', '行動支付',
  'AI工具', '便利商店', '串流平台', '超市', '藥妝', '時尚品牌', '直銷品牌', '生活百貨',
  '運動', '寵物', '親子', '應用程式商店', '飲食品牌', '美妝美髮保養品牌', '保費'
];

// 待審核-新卡基本 的固定欄位（＝ Cards Data 固定欄位順序；levelSettings 留空手動）
const CARD_BASIC_FIELDS = [
  'id', 'name', 'fullName', 'basicCashback', 'basicCashbackType', 'pointsExpiry',
  'basicConditions', 'annualFee', 'feeWaiver', 'website', 'tags', 'hasLevels',
  'levelSettings', 'levelLabelFormat', 'overseasCashback', 'overseasBonusRate',
  'overseasBonusCap', 'overseasBonusConditions', 'domesticBonusRate',
  'domesticBonusCap', 'domesticBonusConditions', 'parking', 'airport_pickup', 'airport_lounge'
];

// 組別待審核表欄位（順序貼近 Cards Data 槽位，方便你橫向填回去）
const GROUP_REVIEW_HEADER = [
  '核准', '解析時間', 'card_id', '建議槽位N', 'group_kind',
  'rate', 'cashbackModel', 'cashbackModel需手填?', 'cap(消費上限)', 'minSpend', 'maxSpend',
  'items', 'category', 'conditions', 'period_start', 'period_end', 'hideInDisplay',
  '程式備註', 'needs_review', 'AI想問的問題', '原文引用'
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
    input.getRange('D1').setValue('一般消費/排除說明頁文字（選填，貼 D2；用來判斷一般消費是否排除廣告）');
    input.setFrozenRows(1);
    SpreadsheetApp.getUi().alert('已建立「' + CARD_PARSER_CONFIG.inputSheet + '」分頁，把官網權益頁文字貼進 A2 後再執行一次。');
    return;
  }

  const text = String(input.getRange('A2').getValue() || '').slice(0, CARD_PARSER_CONFIG.maxTextChars);
  const idHint = String(input.getRange('B2').getValue() || '').trim();
  const link = String(input.getRange('C2').getValue() || '').trim();
  const generalText = String(input.getRange('D2').getValue() || '').slice(0, CARD_PARSER_CONFIG.maxTextChars);
  if (!text.trim()) {
    SpreadsheetApp.getUi().alert('「' + CARD_PARSER_CONFIG.inputSheet + '」的 A2 是空的——先把官網權益頁文字貼進去');
    return;
  }

  const parsed = extractCard_(text, idHint, generalText);
  const basic = parsed.basic || {};
  const groups = parsed.groups || [];

  let idCollision = false;
  try {
    if (basic.id && getCardIds_().indexOf(basic.id) !== -1) idCollision = true;
  } catch (e) { /* 讀不到資料檔就跳過檢查 */ }

  writeBasicReview_(basic, link, idCollision);
  const specialCount = writeGroupReview_(basic.id || idHint || '(未定id)', groups, basic);

  const flagged = groups.filter(function (g) { return g.needs_review; }).length;
  const msg = '解析完成：基本資料 1 列、一般回饋組別 ' + groups.length + ' 組、固定槽位 ' + specialCount + ' 組（14/21/22）' +
    (flagged ? '\n其中 ' + flagged + ' 組 AI 沒把握' : '') +
    (idCollision ? '\n⚠️ 這個 id 已存在於 Cards Data，若是新卡請改 id' : '') +
    '\n\n黃底列＝需你確認；cashbackModel 標「需手填」的請參考同卡其他組（原文引用欄已附完整依據）。';
  SpreadsheetApp.getActiveSpreadsheet().toast('基本 1 列 + 組別 ' + groups.length + ' + 固定 ' + specialCount, '新卡解析完成', 8);
  SpreadsheetApp.getUi().alert(msg);
}

/************** 核心：呼叫 Gemini 抽取新卡資料 **************/
function extractCard_(rawText, idHint, generalText) {
  const systemPrompt = [
    '你是台灣信用卡權益的資料分析師。從官網「卡片權益頁」文字中，抽取這張卡的基本資料與所有「一般回饋組別」，輸出結構化 JSON。',
    '',
    '【總則】',
    'A. 只抽文字中明確寫出的資訊，絕不假設或腦補；找不到的欄位省略。',
    'B. 你只負責讀懂與抽取事實。不要算 cap 消費上限、不要編 cashbackModel、不要處理「一般國內/國外消費」與「廣告」這三種固定槽位——那些程式會依基本欄位自動生成。',
    'C. 所有文字欄位不要以句號結尾。',
    'D. evidence 要「完整到我不必回官網」：把支撐該筆數字/條件的官網原句整句引用；疊加型組別（is_stacked）務必把描述疊加關係的每一句都引用進來。',
    '',
    '【groups 要放什麼、不放什麼】',
    'E. groups 只放「特定通路/特定分類」的加碼組別（如統一集團、日韓消費、指定餐廳）。',
    'F. 「一般國內消費」「一般國外消費」「廣告平台(Meta/Google)」這三種【不要】放進 groups——它們由程式從基本欄位生成固定槽位。',
    'G. 【排除領券型】需到 App/官網「領取優惠券、領券」才享的活動，不是回饋組別，不要放進 groups（注意：只需「登錄」的活動仍算，要放）。',
    'H. 【排除新戶型】僅新戶/核卡限定的活動不要放進 groups（那是新戶活動，另有解析器）。',
    '',
    '【basic 基本資料】',
    '1. id：小寫英文加連字號；' + (idHint ? '優先用提示「' + idHint + '」。' : '依銀行簡稱與卡名自擬。'),
    '2. name 簡稱；fullName 含銀行完整名稱。',
    '3. basicCashback 基本回饋率數字；basicCashbackType 回饋類型。',
    '4. pointsExpiry 點數效期；basicConditions 基本回饋條件；annualFee 年費；feeWaiver 免年費條件；website 官網。',
    '5. tags 從固定清單挑。',
    '6. hasLevels 是否分級（true/false）。',
    '7. 分級卡：levelSettings_evidence 逐字引用官網描述各級別 rate/cap/期間的原文（JSON 由我人工建，你只給原文）；levelLabelFormat 依官網用詞填，如「方案: {level}」或「分級: {level}」。',
    '8. 海外：overseasCashback（基本海外率數字）、overseasBonusRate（海外加碼率數字）、overseasBonusCap_reward（海外加碼「回饋金額上限」數字）、overseasBonusConditions、overseasBonusPeriod_start/overseasBonusPeriod_end（YYYY/M/D）。',
    '9. 國內加碼：domesticBonusRate、domesticBonusCap_reward（回饋金額上限數字）、domesticBonusConditions。',
    '10. general_excludes_ads：一般消費是否排除 Facebook/Meta/Google/廣告費——明確排除填「是」；明確沒排除或明說廣告可享填「否」；沒提到填「未提及」。',
    '11. parking / airport_pickup / airport_lounge：有才填。',
    '',
    '【groups 每組欄位】',
    '12. rate 回饋率數字；items 適用通路陣列（實體/網購標明）；category 分類標題；conditions 達成條件（登錄類寫「需登錄且限量，詳見官網」）；period_start/period_end YYYY/M/D。',
    '13. cap_spend：官網直接講的消費上限數字；cap_reward：官網講的回饋金額上限數字（兩者擇一，沒有省略）。',
    '14. group_kind：指定通路加碼 / 國外指定加碼 / 排除型 / 其他（排除型＝該通路回饋獨立、超額不回退基本，如悠遊卡自動加值）。',
    '15. is_stacked：這組是否疊加在另一組之上才成立（如踩點任務疊在基礎通路組）。是→true。',
    '',
    '【關鍵字對應】看到這些字樣時該欄位高度可信（此表會持續增補）：',
    '- basicCashback ← 「基本回饋 n%」',
    '- domesticBonusRate ← 「國內加碼 n%」',
    '',
    '【每個物件都要】evidence（見總則 D）；needs_review：不確定就 true 並把問題寫進 review_question。'
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
      group_kind: { type: 'STRING', enum: ['指定通路加碼', '國外指定加碼', '排除型', '其他'] },
      is_stacked: { type: 'BOOLEAN' },
      cap_spend: { type: 'NUMBER' },
      cap_reward: { type: 'NUMBER' },
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
          id: { type: 'STRING' }, name: { type: 'STRING' }, fullName: { type: 'STRING' },
          basicCashback: { type: 'NUMBER' }, basicCashbackType: { type: 'STRING' },
          pointsExpiry: { type: 'STRING' }, basicConditions: { type: 'STRING' },
          annualFee: { type: 'STRING' }, feeWaiver: { type: 'STRING' }, website: { type: 'STRING' },
          tags: { type: 'ARRAY', items: { type: 'STRING', enum: CARD_TAG_ENUM } },
          hasLevels: { type: 'BOOLEAN' },
          levelSettings_evidence: { type: 'STRING', description: '分級卡：官網描述各級別的原文' },
          levelLabelFormat: { type: 'STRING', description: '依官網用詞，如 方案: {level}' },
          overseasCashback: { type: 'NUMBER' }, overseasBonusRate: { type: 'NUMBER' },
          overseasBonusCap_reward: { type: 'NUMBER' }, overseasBonusConditions: { type: 'STRING' },
          overseasBonusPeriod_start: { type: 'STRING' }, overseasBonusPeriod_end: { type: 'STRING' },
          domesticBonusRate: { type: 'NUMBER' }, domesticBonusCap_reward: { type: 'NUMBER' },
          domesticBonusConditions: { type: 'STRING' },
          general_excludes_ads: { type: 'STRING', enum: ['是', '否', '未提及'] },
          parking: { type: 'STRING' }, airport_pickup: { type: 'STRING' }, airport_lounge: { type: 'STRING' },
          evidence: { type: 'STRING' }, needs_review: { type: 'BOOLEAN' }, review_question: { type: 'STRING' }
        },
        required: ['name', 'basicCashback', 'needs_review']
      },
      groups: { type: 'ARRAY', items: groupItem }
    },
    required: ['basic', 'groups']
  };

  let userText = '以下是信用卡權益頁文字：\n\n' + rawText;
  if (generalText && generalText.trim()) {
    userText += '\n\n【一般消費/排除說明頁補充（判斷 general_excludes_ads 用）】\n' + generalText;
  }
  // callGemini_ 定義在 benefits-parser.gs（同專案）
  const result = callGemini_(systemPrompt, userText, schema);
  return result || { basic: {}, groups: [] };
}

/************** 小工具 **************/
function num_(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// cap 消費上限 = 回饋金額上限 ÷ 加碼率%
function spendCapFromReward_(rewardAmount, ratePercent) {
  if (!rewardAmount) return '';
  if (!ratePercent) return String(rewardAmount);
  return Math.round(num_(rewardAmount) / (num_(ratePercent) / 100));
}

/************** 程式：依 group_kind / is_stacked 決定 cashbackModel **************/
function deriveGroupModel_(g) {
  if (g.is_stacked) {
    return { model: '', hide: '', modelNeedsHuman: true,
      note: '疑似疊加組，cashbackModel 請參考同卡其他組手填（如 rate+rate_1+basic）' };
  }
  switch (g.group_kind) {
    case '排除型':
      return { model: 'rate', hide: '', modelNeedsHuman: false, note: '排除型：cap 內用本組 rate、溢出算 0' };
    case '國外指定加碼':
      return { model: 'rate>basic>overseasBonusRate', hide: '', modelNeedsHuman: true,
        note: '國外指定加碼，請確認基準/加碼成分正確' };
    case '指定通路加碼':
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
    sheet.appendRow(['核准', '解析時間', 'needs_review', 'AI想問的問題', '原文引用']
      .concat(CARD_BASIC_FIELDS).concat(['levelSettings原文引用']));
    sheet.setFrozenRows(1);
  }

  const overseasCap = spendCapFromReward_(basic.overseasBonusCap_reward, basic.overseasBonusRate);
  const domesticCap = spendCapFromReward_(basic.domesticBonusCap_reward, basic.domesticBonusRate);

  const valueByField = {
    id: basic.id || '', name: basic.name || '', fullName: basic.fullName || '',
    basicCashback: (basic.basicCashback != null ? basic.basicCashback : ''),
    basicCashbackType: basic.basicCashbackType || '', pointsExpiry: basic.pointsExpiry || '',
    basicConditions: basic.basicConditions || '', annualFee: basic.annualFee || '',
    feeWaiver: basic.feeWaiver || '', website: basic.website || link || '',
    tags: (basic.tags || []).join(','), hasLevels: basic.hasLevels ? 'TRUE' : 'FALSE',
    levelSettings: '',                                   // 手動（級別名稱=識別碼）
    levelLabelFormat: basic.levelLabelFormat || '',      // AI 依官網用詞
    overseasCashback: (basic.overseasCashback != null ? basic.overseasCashback : ''),
    overseasBonusRate: (basic.overseasBonusRate != null ? basic.overseasBonusRate : ''),
    overseasBonusCap: overseasCap, overseasBonusConditions: basic.overseasBonusConditions || '',
    domesticBonusRate: (basic.domesticBonusRate != null ? basic.domesticBonusRate : ''),
    domesticBonusCap: domesticCap, domesticBonusConditions: basic.domesticBonusConditions || '',
    parking: basic.parking || '', airport_pickup: basic.airport_pickup || '', airport_lounge: basic.airport_lounge || ''
  };
  const fixedCells = CARD_BASIC_FIELDS.map(function (f) { return valueByField[f]; });
  const reviewQ = (basic.review_question || '') + (idCollision ? '（id 已存在，若為新卡請改 id）' : '');
  const row = ['', new Date(), basic.needs_review ? 'TRUE' : '', reviewQ, basic.evidence || '']
    .concat(fixedCells).concat([basic.levelSettings_evidence || '']);
  sheet.appendRow(row);
  if (basic.needs_review || idCollision) {
    sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBackground('#fff3cd');
  }
}

/************** 寫「待審核-新卡組別」：一般組別 + 固定槽位 14/21/22。回傳固定槽位數 **************/
function writeGroupReview_(cardId, groups, basic) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CARD_PARSER_CONFIG.groupReviewSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CARD_PARSER_CONFIG.groupReviewSheet);
    sheet.appendRow(GROUP_REVIEW_HEADER);
    sheet.setFrozenRows(1);
  }
  const now = new Date();

  // 一般組別：編號 1 起、跳過保留槽 14/21/22
  let slot = 1;
  const nextSlot = function () { while (RESERVED_SLOTS.indexOf(slot) !== -1) slot++; return slot++; };
  (groups || []).forEach(function (g) {
    const cap = (g.cap_spend != null && g.cap_spend !== '') ? Math.round(num_(g.cap_spend))
      : spendCapFromReward_(g.cap_reward, g.rate);
    const d = deriveGroupModel_(g);
    appendGroupRow_(sheet, now, cardId, nextSlot(), g.group_kind || '', {
      rate: (g.rate != null ? g.rate : ''), model: d.model, modelNeedsHuman: d.modelNeedsHuman,
      cap: cap, minSpend: '', maxSpend: '', items: (g.items || []).join(','), category: g.category || '',
      conditions: g.conditions || '', ps: g.period_start || '', pe: g.period_end || '', hide: d.hide,
      note: d.note, needsReview: g.needs_review, reviewQ: g.review_question || '', evidence: g.evidence || ''
    });
  });

  // 固定槽位（依基本欄位生成）
  return appendSpecialSlots_(sheet, now, cardId, basic || {});
}

// 依卡片基本欄位生成 14(廣告)/21(國內)/22(國外) 固定模板，回傳生成數量
function appendSpecialSlots_(sheet, now, cardId, basic) {
  const overseasCap = spendCapFromReward_(basic.overseasBonusCap_reward, basic.overseasBonusRate);
  const domesticCap = spendCapFromReward_(basic.domesticBonusCap_reward, basic.domesticBonusRate);
  const hasOverseas = num_(basic.overseasCashback) > 0 || num_(basic.overseasBonusRate) > 0;
  const hasDomesticBonus = num_(basic.domesticBonusRate) > 0;
  let count = 0;

  // 14 廣告：一般消費未明確排除廣告時才建（'是'＝有排除→不建，slot 14 留空）
  if (basic.general_excludes_ads !== '是') {
    const unknown = (basic.general_excludes_ads !== '否');  // 未提及或空 → 需你確認
    appendGroupRow_(sheet, now, cardId, 14, '（固定模板·廣告）', {
      rate: 0, model: 'overseasCashback+overseasBonusRate', modelNeedsHuman: false,
      cap: overseasCap, minSpend: '', maxSpend: '', items: 'meta廣告,google廣告',
      category: hasOverseas ? '國外消費特列項目' : '一般回饋特列項目',
      conditions: '', ps: basic.overseasBonusPeriod_start || '', pe: basic.overseasBonusPeriod_end || '', hide: '',
      note: '程式生成固定模板；' + (unknown ? '⚠️ 無法確認一般消費是否排除廣告——請補一般消費頁(D2)或自行確認；若有排除請刪掉本列(slot 14 留空)' : '一般消費未排除廣告，保留本列'),
      needsReview: unknown, reviewQ: unknown ? '一般消費是否排除 Facebook/Google/廣告費？' : '',
      evidence: '（程式依基本欄位與 general_excludes_ads 生成）'
    });
    count++;
  }
  // 21 國內消費（有國內加碼才建）
  if (hasDomesticBonus) {
    appendGroupRow_(sheet, now, cardId, 21, '（固定模板·國內）', {
      rate: 0, model: 'basic+domesticBonusRate', modelNeedsHuman: false,
      cap: domesticCap, minSpend: '', maxSpend: '', items: '國內消費', category: '',
      conditions: basic.domesticBonusConditions || '', ps: '', pe: '', hide: 'TRUE',
      note: '程式生成固定模板（國內消費隱藏槽）', needsReview: false, reviewQ: '',
      evidence: '（程式依 domesticBonus* 生成）'
    });
    count++;
  }
  // 22 國外消費（有國外回饋才建）
  if (hasOverseas) {
    appendGroupRow_(sheet, now, cardId, 22, '（固定模板·國外）', {
      rate: 0, model: 'overseasCashback+overseasBonusRate', modelNeedsHuman: false,
      cap: overseasCap, minSpend: '', maxSpend: '', items: '國外消費', category: '',
      conditions: basic.overseasBonusConditions || '',
      ps: basic.overseasBonusPeriod_start || '', pe: basic.overseasBonusPeriod_end || '', hide: 'TRUE',
      note: '程式生成固定模板（國外消費隱藏槽）', needsReview: false, reviewQ: '',
      evidence: '（程式依 overseas* 生成）'
    });
    count++;
  }
  return count;
}

// 依 GROUP_REVIEW_HEADER 順序寫一列，黃底條件：needs_review 或 cashbackModel 需手填
function appendGroupRow_(sheet, now, cardId, slotN, kind, f) {
  const row = ['', now, cardId, slotN, kind,
    f.rate, f.model, f.modelNeedsHuman ? 'TRUE' : '', f.cap, f.minSpend, f.maxSpend,
    f.items, f.category, f.conditions, f.ps, f.pe, f.hide,
    f.note || '', f.needsReview ? 'TRUE' : '', f.reviewQ || '', f.evidence || ''];
  sheet.appendRow(row);
  if (f.needsReview || f.modelNeedsHuman) {
    sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBackground('#fff3cd');
  }
}
