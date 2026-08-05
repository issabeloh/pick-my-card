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
 *   1. 選單「🤖 權益自動化 → 解析新卡：3-貼上原文 → 4-待審核（基本＋組別）」，
 *      第一次執行會自動建「3-貼上原文（新卡）」分頁
 *   2. 官網權益頁文字貼 A 欄；id 提示貼 B 欄（選填）；網址貼 C 欄（選填）；
 *      一般消費/排除說明頁文字貼 D 欄（選填，但沒貼時廣告排除只能靠權益頁本身判斷）
 *      ⚠️ 一列＝一張卡，可以一次貼很多列（2026-08-05 前只會解析第 2 列，其餘被忽略）
 *   3. 再執行一次 → 每一列各產出「4-待審核（新卡-基本）」1 列與「4-待審核（新卡-組別）」數列
 *      E 欄「狀態」由程式回填：「已解析…」下次會跳過（清空該格即可重跑）、「失敗：…」下次自動重試
 *      單次執行最多 CARD_PARSER_CONFIG.maxRowsPerRun 列，沒跑完再按一次選單接著跑
 *   4. 審：黃底＝AI 沒把握或 cashbackModel 需你手填；對照 evidence 欄驗證，不必回官網
 */

/************** 設定區 **************/
const CARD_PARSER_CONFIG = {
  inputSheet: '3-貼上原文（新卡）',
  basicReviewSheet: '4-待審核（新卡-基本）',
  groupReviewSheet: '4-待審核（新卡-組別）',
  maxTextChars: 40000,
  maxRowsPerRun: 5,      // 一次最多解析幾列（Apps Script 單次執行 6 分鐘上限；剩下的再按一次選單接著跑）
  statusCol: 5           // 輸入分頁的「狀態」欄＝E 欄（程式回填「已解析…」／「失敗：…」）
};

const RESERVED_SLOTS = [14, 21, 22];  // 廣告/國內/國外固定槽位，一般組別編號要跳過

// bank 欄＝發卡行「二字簡稱」（側欄卡片膠囊、分組顯示用）。
// 這是站長給的填寫範例清單（2026-08-05），AI 擇一使用、統一用詞；
// 清單外的銀行用該行慣用二字簡稱（如 華銀、日盛），新增銀行時直接加進這個陣列。
const BANK_SHORT_NAMES = [
  '玉山', '國泰', '永豐', '遠東', '企銀', '滙豐', '台新', '富邦',
  '中信', '星展', '聯邦', '兆豐', '凱基', '陽信', '一銀', '彰銀'
];

// tags 固定清單（對齊 tags GEM）——AI 只能從這裡選
const CARD_TAG_ENUM = [
  '旅遊', '開車族', '餐飲', '交通', '網購', '百貨公司', '外送', '娛樂', '行動支付',
  'AI工具', '便利商店', '串流平台', '超市', '藥妝', '時尚品牌', '直銷品牌', '生活百貨',
  '運動', '寵物', '親子', '應用程式商店', '飲食品牌', '美妝美髮保養品牌', '保費'
];

// 4-待審核（新卡-基本）的固定欄位（＝ Cards Data 固定欄位順序；levelSettings 留空手動）
const CARD_BASIC_FIELDS = [
  'id', 'name', 'fullName', 'bank', 'basicCashback', 'basicCashbackType', 'pointsExpiry',
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

/************** 入口：解析新卡（一次可解析多列，一列＝一張卡） **************/
// ⚠️ 2026-08-05 修正：原本只讀 A2/B2/C2/D2，貼了 5 列也只會解析第一列（其餘無聲無息被忽略）。
//    現在會掃第 2 列到最後一列，每一列各解析成一張卡；E 欄「狀態」記錄結果：
//      「已解析 …」→ 下次執行自動跳過（要重跑就把該格清空）
//      「失敗：…」→ 下次執行會自動重試
//    單次執行最多 maxRowsPerRun 列（Apps Script 6 分鐘上限），沒跑完的再按一次選單接著跑。
function parseNewCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  let input = ss.getSheetByName(CARD_PARSER_CONFIG.inputSheet);
  if (!input) {
    input = ss.insertSheet(CARD_PARSER_CONFIG.inputSheet);
    input.getRange('A1').setValue('官網權益頁文字（貼在 A 欄，整段貼一格；一列＝一張卡，可一次貼多列）');
    input.getRange('B1').setValue('卡片 id 提示（選填，如 fubon-jcard；留空 AI 會擬一個）');
    input.getRange('C1').setValue('官網網址（選填）');
    input.getRange('D1').setValue('一般消費/排除說明頁文字（選填；用來判斷一般消費是否排除廣告）');
    input.getRange('E1').setValue('狀態（程式回填，清空該格可重跑該列）');
    input.setFrozenRows(1);
    ui.alert('已建立「' + CARD_PARSER_CONFIG.inputSheet + '」分頁，把官網權益頁文字貼進 A2（多張卡就一列一張）後再執行一次。');
    return;
  }
  ensureCardInputStatusHeader_(input);

  const lastRow = input.getLastRow();
  if (lastRow < 2) {
    ui.alert('「' + CARD_PARSER_CONFIG.inputSheet + '」的 A2 是空的——先把官網權益頁文字貼進去');
    return;
  }
  const rows = input.getRange(2, 1, lastRow - 1, CARD_PARSER_CONFIG.statusCol).getValues();

  let doneCount = 0, skipped = 0, remaining = 0, textRows = 0;
  const results = [], failures = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const text = String(rows[i][0] || '').slice(0, CARD_PARSER_CONFIG.maxTextChars);
    if (!text.trim()) continue;                       // 空列跳過（中間留白也不會中斷）
    textRows++;

    const status = String(rows[i][CARD_PARSER_CONFIG.statusCol - 1] || '').trim();
    if (status.indexOf('已解析') === 0) { skipped++; continue; }   // 已解析過：清空 E 欄才會重跑
    if (doneCount >= CARD_PARSER_CONFIG.maxRowsPerRun) { remaining++; continue; }

    const idHint = String(rows[i][1] || '').trim();
    const link = String(rows[i][2] || '').trim();
    const generalText = String(rows[i][3] || '').slice(0, CARD_PARSER_CONFIG.maxTextChars);

    try {
      const parsed = extractCard_(text, idHint, generalText);
      const basic = parsed.basic || {};
      const groups = parsed.groups || [];

      let idCollision = false;
      try {
        if (basic.id && getCardIds_().indexOf(basic.id) !== -1) idCollision = true;
      } catch (e) { /* 讀不到資料檔就跳過檢查 */ }

      writeBasicReview_(basic, link, idCollision);
      const cardId = basic.id || idHint || '(未定id)';
      const specialCount = writeGroupReview_(cardId, groups, basic);
      const flagged = groups.filter(function (g) { return g.needs_review; }).length;

      input.getRange(rowNum, CARD_PARSER_CONFIG.statusCol).setValue(
        '已解析 ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'MM/dd HH:mm') + '｜' + cardId);
      results.push('列' + rowNum + '　' + cardId + '：組別 ' + groups.length + ' 組、固定槽位 ' + specialCount + ' 組' +
        (flagged ? '、' + flagged + ' 組 AI 沒把握' : '') +
        (idCollision ? '　⚠️ id 已存在於 Cards Data，若是新卡請改 id' : ''));
      doneCount++;
    } catch (e) {
      input.getRange(rowNum, CARD_PARSER_CONFIG.statusCol).setValue('失敗：' + e.message);
      failures.push('列' + rowNum + '：' + e.message);
    }
  }

  if (!textRows) {
    ui.alert('「' + CARD_PARSER_CONFIG.inputSheet + '」的 A 欄沒有任何文字——先把官網權益頁文字貼進 A2');
    return;
  }

  let msg = '這次解析了 ' + doneCount + ' 列（共 ' + textRows + ' 列有文字）\n\n' +
    (results.length ? results.join('\n') + '\n\n' : '');
  if (skipped) msg += '↷ 跳過 ' + skipped + ' 列：E 欄狀態已是「已解析」。要重跑那幾列，把 E 欄清空再按一次選單。\n';
  if (remaining) msg += '⏳ 還有 ' + remaining + ' 列沒跑（單次上限 ' + CARD_PARSER_CONFIG.maxRowsPerRun +
    ' 列，避免 Apps Script 6 分鐘逾時）——再按一次選單就會接著跑。\n';
  if (failures.length) msg += '\n❌ 失敗（E 欄已記錄，下次執行會自動重試）：\n' + failures.join('\n') + '\n';
  msg += '\n黃底列＝需你確認；cashbackModel 標「需手填」的請參考同卡其他組（原文引用欄已附完整依據）。';

  ss.toast('解析 ' + doneCount + ' 列' + (remaining ? '，還剩 ' + remaining + ' 列' : ''), '新卡解析完成', 8);
  ui.alert(msg);
}

// 舊的輸入分頁沒有 E 欄「狀態」表頭：補上（只寫表頭，資料一格不動）
function ensureCardInputStatusHeader_(input) {
  const cell = input.getRange(1, CARD_PARSER_CONFIG.statusCol);
  if (!String(cell.getValue() || '').trim()) {
    cell.setValue('狀態（程式回填，清空該格可重跑該列）');
  }
}

/************** 核心：呼叫 Gemini 抽取新卡資料 **************/
function extractCard_(rawText, idHint, generalText) {
  const systemPrompt = [
    '你是台灣信用卡權益的資料分析師。從官網「卡片權益頁」文字中，抽取這張卡的基本資料與所有「一般回饋組別」，輸出結構化 JSON。',
    '',
    '【總則】',
    'A. 只抽文字中明確寫出的資訊，絕不假設或腦補；找不到的欄位省略。',
    'B. 你只負責讀懂與抽取事實。不要算 cap 消費上限、不要編 cashbackModel、不要處理「一般國內/國外消費」與「廣告」這三種固定槽位——那些程式會依基本欄位自動生成。',
    'C. 所有文字欄位不要以句號結尾——唯一例外是 feeWaiver（照 X3 的範例，結尾「即免年費。」帶句號）。',
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
    '2. name 簡稱（如「玉山 Uni 卡」）；fullName 含銀行完整名稱（如「玉山銀行 UniCard 信用卡」）；',
    '   bank 發卡行「二字簡稱」——從這個清單擇一：' + BANK_SHORT_NAMES.join('、') + '；不在清單裡的銀行用該行慣用二字簡稱（如 華銀、日盛）。',
    '3. basicCashback 基本回饋率數字；basicCashbackType 回饋類型。',
    '4. pointsExpiry 點數效期；website 官網。basicConditions／annualFee／feeWaiver 見下面【三個最常寫錯的欄位】。',
    '5. tags 從固定清單挑。',
    '6. hasLevels：只有當「卡片本身有使用者可選、或需達標的方案/等級/分級，且那個方案決定卡片全域的回饋率」時才 true（例：玉山 簡單選/任意選/UP選——使用者選一個方案，全卡回饋率跟著變）。',
    '   ⚠️【以下都不是分級，hasLevels 一律 false、絕不可寫進 levels】：單一活動的「消費滿額級距」（如滿1.5萬回100元、滿3萬回400元）；帳戶類型差異（自扣戶/一般戶、數位帳戶戶）；不同通路各自的回饋率。這些是某個活動的條件，不是卡片分級。',
    '7. 分級卡（hasLevels=true 才填 levels）：每級一物件——level_name（官網級別名稱，如 簡單選/任意選/UP選）、rate（該級回饋率「百分比數字」，2.5% → 2.5，不是 0.025）、cap_spend（消費上限，官網直接講就填）、cap_reward（回饋金額上限，官網講回饋X元就填）、period_start/period_end（YYYY/M/D）、level_note（達成條件，開頭寫「達成條件：」）。levelLabelFormat 依官網用詞（「方案: {level}」/「分級: {level}」）。levelSettings_evidence：逐字引用官網描述各級別的原文。',
    '8. 海外：overseasCashback（基本海外率數字）、overseasBonusRate（海外加碼率數字）、overseasBonusCap_reward（海外加碼「回饋金額上限」數字）、overseasBonusConditions、overseasBonusPeriod_start/overseasBonusPeriod_end（YYYY/M/D）。',
    '9. 國內加碼：domesticBonusRate、domesticBonusCap_reward（回饋金額上限數字）、domesticBonusConditions。',
    '10. general_excludes_ads：一般消費是否排除 Facebook/Meta/Google/廣告費——明確排除填「是」；明確沒排除或明說廣告可享填「否」；沒提到填「未提及」。',
    '11. parking / airport_pickup / airport_lounge：有才填。',
    '',
    '【三個最常寫錯的欄位：basicConditions／annualFee／feeWaiver】',
    'X1. basicConditions＝「要拿到基本回饋，持卡人必須先做到什麼」，通常很短、一句就夠。',
    '    正確範例：「申辦電子帳單」「綁定電子帳單 且 設定自動扣繳」「申辦帳單e化及該行臺幣帳戶自動扣繳」。',
    '    大多數卡其實沒有這種條件 →【留空】。留空是正常且正確的答案，不要硬湊。',
    '    ⛔ 絕對不要寫進來（這是最常見的錯誤）：「不列入回饋計算」「不得折抵回饋金」的排除項目清單',
    '    （全支付、預借現金、代繳稅款/學費、停車費、分期付款、eTag自動儲值、電信費、政府規費、',
    '    醫療費用、繳費平台、投資平台、年費/手續費/違約金…）；活動期間日期；一般注意事項；免責與罰則。',
    '    那些是全卡通用的排除說明，跟「基本回饋的達成條件」無關，一個字都不要抄。',
    '    自我檢查：basicConditions 若超過 30 字、或出現頓號長串通路名、或出現日期，就是抄錯了——刪掉重寫或留空。',
    'X2. annualFee＝「首年是否免年費＋正卡年費金額」，寫成一句話。',
    '    格式照這兩個例子：「首年免年費，正卡NT$2,000元」；卡別有差就寫卡別「首年免年費，御璽卡NT$3,000元」。',
    '    沒有首年免年費就只寫「正卡NT$2,000元」。金額用千分位逗號、幣別寫 NT$。',
    '    ⛔ 不要用分號列多項（不要寫成「正卡2000元;附卡每卡1000元」）、不要寫附卡年費、',
    '    不要把免年費條件寫進來（那是 feeWaiver）。',
    'X3. feeWaiver＝免年費條件，完整一句、結尾用「即免年費。」。',
    '    格式照這個例子：「申請電子帳單且取消實體帳單，或年消費不限金額1次即免年費。」',
    '    多個擇一條件用「或」連接；必須同時成立的條件用「且」連接。',
    '    ⛔ 不要寫「第一年免年費」（那屬 annualFee）、不要用分號列點。',
    '',
    '【groups 每組欄位】',
    '12. rate：回饋率「百分比數字」——5% → 5、1.5% → 1.5、0.67% → 0.67，【絕不】填小數比例（不是 0.05、不是 0.0067），也【不要】自己把「定額回饋金額÷消費額」算成率。若官網是「消費滿X回饋固定Y元」的定額回饋（不是百分比），rate 留空、needs_review=true、在 review_question 註明「定額回饋，非百分比率、非分級」。',
    '    items 適用通路陣列（實體/網購標明）；category 分類標題；period_start/period_end YYYY/M/D。',
    '13. min_spend：單筆最低消費門檻金額（如「單筆滿3,000」→3000）；max_spend：單筆消費金額上限。⚠️「單筆滿額」門檻一律放這裡，【絕不】寫進 conditions。',
    '13a. 分級門檻（同通路單筆滿額有更高回饋、未滿有較低回饋）：拆成兩組。高回饋組填 min_spend＝門檻；低回饋組填 max_spend＝同一個門檻數字（不加一減一）。但若「未滿門檻只是落回基本回饋」（沒有獨立的較低率），則【不要】建低回饋那組，只建高回饋組填 min_spend。',
    '14. conditions 達成/限定條件——用全形分號「；」分隔、逐項精簡、無句號，只寫：',
    '    付款方式限定（如「限使用實體卡、LINE Pay、Apple Pay」）；自動扣繳/電子帳單設定；登錄與限量（有日期名額就寫出來，如「需登錄(7/23,8/23 12:00起)，限量」，不要只寫詳見官網）；',
    '    MCC code 認定；排除項目（如「排除餐券」「排除分期、第三方支付」）；可疊加提示（如「可與X權益疊加」）；條件式增減（如「若非Visa卡則-10%」）。',
    '    【不要寫進 conditions】：單筆滿額門檻（放 min_spend）；一般的回饋上限（已由 cap 表達，只有「以信用額度加計NT$X萬」這種特殊上限定義才寫）；免責/罰則樣板（喪失資格、銀行保留權利）。',
    '    「認列為國內/國外通路」只在特例寫：同一通路難判國內外、且國內外回饋率不同而拆成兩組時，在國外那組註明「認列為國外通路」。',
    '15. cap_spend：官網直接講的消費上限數字；cap_reward：官網講的回饋金額上限數字（兩者擇一，沒有省略）。',
    '16. group_kind：指定通路加碼 / 國外指定加碼 / 排除型 / 其他（排除型＝該通路回饋獨立、超額不回退基本，如悠遊卡自動加值）。',
    '17. is_stacked：這組是否疊加在另一組之上才成立（如踩點任務疊在基礎通路組）。是→true。',
    '',
    readKeywordAnchors_(),   // 【關鍵字對應】——從「設定-關鍵字對應」分頁動態載入，站長可自行維護
    '',
    '【每個物件都要】evidence（見總則 D）；needs_review：不確定就 true 並把問題寫進 review_question。'
  ].join('\n');

  const groupItem = {
    type: 'OBJECT',
    properties: {
      rate: { type: 'NUMBER', description: '百分比數字，如 5 代表 5%，不要填 0.05；定額回饋（滿X回Y元）則留空' },
      items: { type: 'ARRAY', items: { type: 'STRING' } },
      category: { type: 'STRING' },
      conditions: { type: 'STRING' },
      period_start: { type: 'STRING', description: 'YYYY/M/D' },
      period_end: { type: 'STRING', description: 'YYYY/M/D' },
      group_kind: { type: 'STRING', enum: ['指定通路加碼', '國外指定加碼', '排除型', '其他'] },
      is_stacked: { type: 'BOOLEAN' },
      min_spend: { type: 'NUMBER', description: '單筆最低消費門檻金額' },
      max_spend: { type: 'NUMBER', description: '單筆消費金額上限（少見）' },
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
          bank: { type: 'STRING', description: '發卡行二字簡稱，如 玉山／國泰／永豐／中信' },
          basicCashback: { type: 'NUMBER' }, basicCashbackType: { type: 'STRING' },
          pointsExpiry: { type: 'STRING' },
          basicConditions: { type: 'STRING', description: '拿到「基本回饋」的達成條件，通常一句如「申辦電子帳單」；沒有條件就留空。絕不放排除項目清單、日期或注意事項' },
          annualFee: { type: 'STRING', description: '一句話，如「首年免年費，正卡NT$2,000元」；不寫附卡、不寫免年費條件' },
          feeWaiver: { type: 'STRING', description: '一句話，如「申請電子帳單且取消實體帳單，或年消費不限金額1次即免年費。」；擇一用「或」、並存用「且」' },
          website: { type: 'STRING' },
          tags: { type: 'ARRAY', items: { type: 'STRING', enum: CARD_TAG_ENUM } },
          hasLevels: { type: 'BOOLEAN' },
          levels: {
            type: 'ARRAY',
            description: '分級卡各級別（hasLevels=true 才填）',
            items: {
              type: 'OBJECT',
              properties: {
                level_name: { type: 'STRING' },
                rate: { type: 'NUMBER', description: '百分比數字，如 2.5 代表 2.5%，不要填 0.025' },
                cap_spend: { type: 'NUMBER' },
                cap_reward: { type: 'NUMBER' },
                period_start: { type: 'STRING' },
                period_end: { type: 'STRING' },
                level_note: { type: 'STRING', description: '達成條件，開頭寫「達成條件：」' }
              },
              required: ['level_name', 'rate']
            }
          },
          levelSettings_evidence: { type: 'STRING', description: '分級卡：官網描述各級別的原文（供人工複核）' },
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

// 由 AI 的 levels 陣列組出 levelSettings JSON：{級別名:{rate,cap,period,"level-note"}}
function buildLevelSettings_(levels) {
  if (!levels || !levels.length) return '';
  const obj = {};
  levels.forEach(function (lv) {
    if (!lv || !lv.level_name) return;
    const cap = (lv.cap_spend != null && lv.cap_spend !== '')
      ? Math.round(num_(lv.cap_spend))
      : spendCapFromReward_(lv.cap_reward, lv.rate);
    const period = (lv.period_start || lv.period_end)
      ? (lv.period_start || '') + '~' + (lv.period_end || '')
      : '';
    const entry = { rate: (lv.rate != null ? Number(lv.rate) : '') };
    if (cap !== '' && cap != null) entry.cap = Number(cap);
    if (period) entry.period = period;
    if (lv.level_note) entry['level-note'] = lv.level_note;
    obj[lv.level_name] = entry;
  });
  return Object.keys(obj).length ? JSON.stringify(obj) : '';
}

// 【關鍵字對應】種子（站長沒建分頁時用這些）
const KEYWORD_ANCHOR_SEEDS = [
  ['basicCashback', '基本回饋 n%', ''],
  ['domesticBonusRate', '國內加碼 n%', '']
];

// 從「設定-關鍵字對應」分頁讀關鍵字錨點，組成 prompt 片段；分頁不存在就自動建（含種子）讓站長維護
function readKeywordAnchors_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = '設定-關鍵字對應';
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['欄位', '看到這種字樣', '備註（選填）']);
    KEYWORD_ANCHOR_SEEDS.forEach(function (r) { sheet.appendRow(r); });
    sheet.setFrozenRows(1);
  }
  const data = sheet.getDataRange().getValues();
  const lines = ['【關鍵字對應】看到這些字樣時該欄位高度可信：'];
  for (let i = 1; i < data.length; i++) {
    const field = String(data[i][0] || '').trim();
    const pattern = String(data[i][1] || '').trim();
    if (!field || !pattern) continue;
    const note = String(data[i][2] || '').trim();
    lines.push('- ' + field + ' ← 「' + pattern + '」' + (note ? '（' + note + '）' : ''));
  }
  return lines.length > 1 ? lines.join('\n') : '';
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

// 待審核-基本表加新欄位時：舊分頁的表頭少一欄，直接 appendRow 會整列錯位一格。
// 這裡在 afterHeader 右邊插入一欄並補表頭，舊列各自多一個空格、內容不動。
function ensureBasicReviewColumn_(sheet, colName, afterHeader) {
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  if (header.indexOf(colName) !== -1) return;
  const at = header.indexOf(afterHeader);
  if (at === -1) return;                      // 連參考欄都找不到＝表頭被改過，不動它
  sheet.insertColumnAfter(at + 1);
  sheet.getRange(1, at + 2).setValue(colName);
}

/************** 寫「4-待審核（新卡-基本）」 **************/
function writeBasicReview_(basic, link, idCollision) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CARD_PARSER_CONFIG.basicReviewSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CARD_PARSER_CONFIG.basicReviewSheet);
    sheet.appendRow(['核准', '解析時間', 'needs_review', 'AI想問的問題', '原文引用']
      .concat(CARD_BASIC_FIELDS).concat(['levelSettings原文引用']));
    sheet.setFrozenRows(1);
  }
  ensureBasicReviewColumn_(sheet, 'bank', 'fullName');   // 2026-08-05 新增欄位，舊分頁自動補

  const overseasCap = spendCapFromReward_(basic.overseasBonusCap_reward, basic.overseasBonusRate);
  const domesticCap = spendCapFromReward_(basic.domesticBonusCap_reward, basic.domesticBonusRate);

  const valueByField = {
    id: basic.id || '', name: basic.name || '', fullName: basic.fullName || '', bank: basic.bank || '',
    basicCashback: (basic.basicCashback != null ? basic.basicCashback : ''),
    basicCashbackType: basic.basicCashbackType || '', pointsExpiry: basic.pointsExpiry || '',
    basicConditions: basic.basicConditions || '', annualFee: basic.annualFee || '',
    feeWaiver: basic.feeWaiver || '', website: basic.website || link || '',
    tags: (basic.tags || []).join(','), hasLevels: basic.hasLevels ? 'TRUE' : 'FALSE',
    // 新卡預填 levelSettings JSON（新卡沒有既存用戶偏好，預填安全；你可直接改）
    levelSettings: buildLevelSettings_(basic.levels),
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

/************** 寫「4-待審核（新卡-組別）」：一般組別 + 固定槽位 14/21/22。回傳固定槽位數 **************/
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
      cap: cap, minSpend: (g.min_spend != null ? g.min_spend : ''), maxSpend: (g.max_spend != null ? g.max_spend : ''),
      items: (g.items || []).join(','), category: g.category || '',
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

/************** Q1：每月批次查「一般消費是否排除廣告」（Gemini + Google 搜尋 grounding） **************/
// grounding 開了就不能同時用結構化輸出，故回純文字自行解析；結果一律 needs_review（附來源，你複核）
// 一次處理有上限（避免 Apps Script 6 分鐘上限），已查過的卡會跳過，再跑一次會接續剩下的
const AD_CHECK_CONFIG = { sheet: '報告-廣告排除', perRun: 12 };

// 廣告排除是「銀行層級」政策，以銀行為單位查（不是每張卡），銀行＝卡片 id 的連字號前綴
function checkAdExclusionsForAllCards() {
  const cardsSheet = getCardsSheet_();  // 資料檔 Cards Data
  const data = cardsSheet.getDataRange().getValues();
  const h = data[0].map(function (x) { return String(x).trim(); });
  const idc = h.indexOf('id'), fullc = h.indexOf('fullName'), webc = h.indexOf('website');
  if (idc < 0) { SpreadsheetApp.getUi().alert('資料檔 Cards Data 找不到 id 欄'); return; }

  // 依 id 前綴分組成銀行，保留首次出現順序，記一張代表卡供查詢用
  const bankOrder = [];
  const bankInfo = {};  // bankKey -> { fullName, website }
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idc] || '').trim();
    if (!id) continue;
    const bank = id.split('-')[0];
    if (!bankInfo[bank]) {
      bankInfo[bank] = {
        fullName: fullc >= 0 ? String(data[i][fullc] || '') : id,
        website: webc >= 0 ? String(data[i][webc] || '') : ''
      };
      bankOrder.push(bank);
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let out = ss.getSheetByName(AD_CHECK_CONFIG.sheet);
  if (!out) {
    out = ss.insertSheet(AD_CHECK_CONFIG.sheet);
    out.appendRow(['檢查時間', '銀行(id前綴)', '代表卡', '是否排除廣告', '依據', 'needs_review']);
    out.setFrozenRows(1);
  }
  const doneBanks = {};
  const outData = out.getDataRange().getValues();
  for (let i = 1; i < outData.length; i++) doneBanks[String(outData[i][1])] = true;

  const now = new Date();
  let processed = 0, remaining = 0;
  for (let b = 0; b < bankOrder.length; b++) {
    const bank = bankOrder[b];
    if (doneBanks[bank]) continue;
    if (processed >= AD_CHECK_CONFIG.perRun) { remaining++; continue; }

    const info = bankInfo[bank];
    let verdict = '未知', basis = '';
    try {
      const prompt = '用 Google 搜尋查台灣發行「' + info.fullName + '」的這家銀行，其信用卡「一般消費」回饋是否明確排除 Facebook/Meta、Google、廣告費 這幾類（這是銀行層級的政策，非單張卡的活動）。' +
        (info.website ? '官網參考：' + info.website + '。' : '') +
        '依據優先序：①該行官網/公告的原文最優先；②官網查不到時，可採信可靠大站（如卡優新聞、Mobile01、財經媒體、知名部落客彙整）明確寫出的資訊，如「XX銀行刷廣告費沒回饋」。都查不到再回未知。' +
        '嚴格用兩行回答：\n排除:是 或 否 或 未知\n依據:<引用你找到的關鍵句，並註明來自官網或哪個大站>\n';
      const r = callGeminiGrounded_(prompt);
      const parsed = parseAdVerdict_(r.text);
      verdict = parsed.verdict; basis = parsed.basis;
    } catch (e) {
      basis = '查詢失敗：' + e.message;
    }
    out.appendRow([now, bank, info.fullName, verdict, basis, 'TRUE']);
    if (verdict !== '否') out.getRange(out.getLastRow(), 4).setBackground('#fff3cd'); // 排除=是/未知 標黃提醒
    processed++;
    Utilities.sleep(800);
  }

  SpreadsheetApp.getUi().alert('本次查了 ' + processed + ' 家銀行，寫進「' + AD_CHECK_CONFIG.sheet + '」。' +
    (remaining ? '\n還有 ' + remaining + ' 家未查——再執行一次即可接續。' : '\n全部查完了。') +
    '\n\n判讀（該行所有卡共用）：排除=是→該行的卡 rate_14 留空；否→建 rate_14 固定模板；未知→標黃自行確認。');
}

// 呼叫 Gemini（開 Google 搜尋 grounding，回純文字 + 來源）
function callGeminiGrounded_(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('尚未設定 GEMINI_API_KEY');
  const payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini(grounded) HTTP ' + res.getResponseCode() + '：' + res.getContentText().slice(0, 200));
  }
  const body = JSON.parse(res.getContentText());
  const cand = body.candidates && body.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map(function (p) { return p.text || ''; }).join('').trim();
  const sources = [];
  const gm = cand && cand.groundingMetadata;
  if (gm && gm.groundingChunks) {
    gm.groundingChunks.forEach(function (c) { if (c.web && c.web.uri) sources.push(c.web.uri); });
  }
  return { text: text, sources: sources };
}

// 從「排除:… 依據:…」文字解析
function parseAdVerdict_(text) {
  let verdict = '未知', basis = text || '';
  const mV = String(text).match(/排除\s*[:：]\s*(是|否|未知)/);
  if (mV) verdict = mV[1];
  const mB = String(text).match(/依據\s*[:：]\s*([\s\S]*)/);
  if (mB) basis = mB[1].trim().slice(0, 500);
  return { verdict: verdict, basis: basis };
}
