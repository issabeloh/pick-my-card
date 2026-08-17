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
 *   - 跨槽疊加（rate+rate_1+basic 這類）與「國外指定加碼」：程式無法從文字推導，標黃留空、
 *     在「程式備註」列出候選與選用時機，人工手填（2026-08-16 起不再瞎猜一個 model 填進去）
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
 *   4. 審：黃底＝AI 沒把握或 cashbackModel 需你手填；先看「回饋組成原文」快速理解結構，
 *      要驗證再對照最右邊的 evidence 欄，都不必回官網
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
// ⚠️ 2026-08-16 補上 overseasBonusPeriod／domesticBonusPeriod（站長回報這兩欄從來是空的）：
//    前者 AI 早就有抽（schema 的 overseasBonusPeriod_start/end），但這裡沒有欄位可放，
//    抽到的值只被拿去填廣告槽的期間就丟了；後者連 schema 都沒有，從沒被抽過。
//    兩欄在 Cards Data 都是單一欄位、格式「2026/1/1~2026/12/31」（cards-export.gs:514-515）。
//    ⚠️ 這裡的欄序要跟 Cards Data 一致（審核完是整段複製過去的）——放在各自的
//       Conditions 右邊；若你的 Cards Data 欄序不同，改這個陣列即可。
const CARD_BASIC_FIELDS = [
  'id', 'name', 'fullName', 'bank', 'basicCashback', 'basicCashbackType', 'pointsExpiry',
  'basicConditions', 'annualFee', 'feeWaiver', 'website', 'tags', 'hasLevels',
  'levelSettings', 'levelLabelFormat', 'overseasCashback', 'overseasBonusRate',
  'overseasBonusCap', 'overseasBonusConditions', 'overseasBonusPeriod', 'domesticBonusRate',
  'domesticBonusCap', 'domesticBonusConditions', 'domesticBonusPeriod',
  'parking', 'airport_pickup', 'airport_lounge'
];

// 組別待審核表欄位（順序貼近 Cards Data 槽位，方便你橫向填回去）
//
// ⚠️ 2026-08-16 改版（站長要求）：
//   ・刪掉「cashbackModel需手填?」——它卡在 rate…hideInDisplay 這段「要複製到正式表」的
//     欄位正中間，每次複製都會被一起帶過去。它的訊號改寫進「程式備註」（在複製區右邊）。
//   ・新增「回饋組成原文」，**刻意放在 group_kind 之後、rate 之前**——同樣是為了讓
//     複製區（rate → hideInDisplay）保持連續乾淨。內容是 AI 一句話講清楚這組的率怎麼來的，
//     省得每次都要翻最右邊那一大段 evidence 才看得懂回饋結構。
//   改了欄位＝舊分頁表頭對不上（本表是照位置 appendRow），writeGroupReview_ 有擋。
const GROUP_REVIEW_HEADER = [
  '核准', '解析時間', 'card_id', '建議槽位N', 'group_kind', '回饋組成原文',
  'rate', 'cashbackModel', 'cap(消費上限)', 'minSpend', 'maxSpend',
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
      const droppedZeroRate = writeGroupReview_.lastSkipped || 0;   // 非百分比回饋（定額/折扣/券）
      const flagged = groups.filter(function (g) { return g.needs_review; }).length;

      input.getRange(rowNum, CARD_PARSER_CONFIG.statusCol).setValue(
        '已解析 ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'MM/dd HH:mm') + '｜' + cardId);
      results.push('列' + rowNum + '　' + cardId + '：組別 ' + (groups.length - droppedZeroRate) + ' 組、固定槽位 ' + specialCount + ' 組' +
        (droppedZeroRate ? '、略過 ' + droppedZeroRate + ' 組非百分比回饋（定額/折扣/折價券）' : '') +
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
  msg += '\n黃底列＝需你確認；「程式備註」寫著需手填 cashbackModel 的，看同一列的「回饋組成原文」就知道該填什麼。';

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
    'I. 【排除非百分比回饋】以下三種一律【不要】放進 groups——本站的計算模型是「率×金額」，表達不了它們：',
    '   ① 定額型：消費滿 X 元送固定 Y 元/Y 點（如「滿3萬送500點」「滿1,500送50點」）；',
    '   ② 折扣型：打折、現折、OFF（如「享10%OFF」「單筆現折200元」「95折」）；',
    '   ③ 券類：折價券、優惠券、好禮即享券、抽獎、贈品、貴賓室/接送等權益。',
    '   判準很簡單：算不出一個「每消費 100 元回饋幾元」的固定百分比，就不是回饋組別。',
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
    '7a. ⚠️【分級太複雜就舉手，不要硬填 levels】程式只能把 levels 組成最單純的一種 levelSettings：',
    '    每一級＝一個「全卡回饋率＋上限」（如玉山 Uni 的 簡單選/任意選/UP選）。碰到下面兩種請把',
    '    levels_beyond_simple 設成 true、**levels 留空**，並把描述各級別的官網原文完整放進 levelSettings_evidence：',
    '    ① 分級改變的是「某個指定通路的率」而不是全卡的率（國泰 CUBE 那種 specialRate）；',
    '    ② 分級會分別覆寫多個通路槽位的率與上限（永豐大戶卡那種，一級裡有 rate_1/cap_1/rate_14… 一整組）。',
    '    這兩種硬套簡單格式會產生「看起來對、算出來錯」的資料，寧可留空讓人手填。',
    '8. 海外：overseasCashback（基本海外率數字）、overseasBonusRate（海外加碼率數字）、overseasBonusCap_reward（海外加碼「回饋金額上限」數字）、overseasBonusConditions、overseasBonusPeriod_start/overseasBonusPeriod_end（YYYY/M/D）。',
    '9. 國內加碼：domesticBonusRate、domesticBonusCap_reward（回饋金額上限數字）、domesticBonusConditions、',
    '   domesticBonusPeriod_start/domesticBonusPeriod_end（YYYY/M/D，國內加碼的活動期間；官網常寫在加碼段落開頭，別漏）。',
    '10. general_excludes_ads：一般消費是否排除 Facebook/Meta/Google/廣告費——明確排除填「是」；明確沒排除或明說廣告可享填「否」；沒提到填「未提及」。',
    '11. parking / airport_pickup / airport_lounge：有才填。',
    '',
    '【items 只放實際商家名，不放分類標題】',
    'Y1. items 是「使用者會搜尋的通路/品牌名稱」，所以一律填【官網列舉的每一家實際商家】，一家一個元素。',
    '    官網常寫成「【分類】商家A、商家B、商家C。」這種格式：分類名（蔬食餐廳、電動車充/換電、共享交通、生機選品、綠色捐贈、指定超商…）',
    '    是標題不是通路，⛔【絕不】把分類名填進 items——那樣使用者搜「小小樹食」永遠找不到這張卡。分類名要寫進 category。',
    '    ❌ 錯誤示範：items=["蔬食餐廳","電動車充/換電","共享交通","生機選品","綠色捐贈"]',
    '    ✅ 正確示範：items=["仙桃素","鈺善閣．素．養生懷石","祥和蔬食料理",…,"iRent","GoShare",…,"主婦聯盟環境保護基金會"]（把每個分類底下的商家全部展開）',
    'Y2. 商家名去掉贅字後綴，只留品牌本身：「EVALUE(華城電能)官方APP之充電費用」→「EVALUE」；',
    '    「台灣特斯拉官方網站,官方APP之充電費用」→「特斯拉」；「Gogoro官方APP之資費方案」→「Gogoro」。',
    '    括號裡的公司全名、「官方APP」「官方網站」「之充電費用」「之資費方案」都不要留。',
    'Y3. 商家名裡本身就有的標點（如「鈺善閣．素．養生懷石」的間隔號）保持原樣，不要當成分隔符拆成多家。',
    'Y4. 官網用「※」「*」補的但書（如「位於百貨公司/商場內或透過第三方串接之商店交易…恕不適用」「排除百貨店、店中店」）',
    '    不是商家，不要進 items——精簡後寫進該組的 conditions。',
    'Y5. 【國家前綴】這一組限定在某個國家消費才享（日本/韓國…），而該品牌【台灣也有據點】時，',
    '    items 要加國家前綴，否則使用者在台灣搜「UNIQLO」會誤中這張只在日本適用的卡。',
    '    ✅ 要加：日本UNIQLO、日本松屋、日本壽司郎、日本牛角、日本松本清、日本無印良品、日本TOYOTA Rent a Car、日本樂天旅遊',
    '    ✅ 不用加（台灣沒有據點，名稱本身已無歧義）：東橫INN、勝烈亭、六歌仙燒肉、吉伊卡哇樂園、BicCamera、Yodobashi',
    '    ✅ 不用加（名稱本身已含國名或只在該國通用）：日本航空、JR鐵路公司、SUICA、PASMO、ICOCA、NIPPON RENT-A-CAR',
    '    判準：「台灣人在台灣也可能刷到同名商店嗎？」會 → 加前綴；不會 → 不加。拿不準就加，寧可多加也不要漏。',
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
    '12. rate：回饋率「百分比數字」——5% → 5、1.5% → 1.5、0.67% → 0.67，【絕不】填小數比例（不是 0.05、不是 0.0067），也【不要】自己把「定額回饋金額÷消費額」算成率。算不出百分比率的活動見總則 I，整組不要輸出。',
    '12a. ⚠️【免收國外交易服務費不是回饋，不可算進 rate】官網常把「免收/回饋 1.5% 國外交易服務費」加進「最高享 X%」的標題數字裡。',
    '     那 1.5% 是「少付一筆費用」，不是回到持卡人手上的回饋——而本站對其他卡也從來不扣這筆費用，把它算進來這張卡就會被高估。',
    '     ✅ 正確：官網「最高享5%優惠／含日本PayPay消費3.5%+免收1.5%國外交易服務費」→ rate 填 **3.5**（不是 5），',
    '        「免收1.5%國外交易服務費」寫進 conditions，完整的官網拆解句放 structure_note。',
    '     同理，官網若說「需收取1.5%國外交易服務費」，也【不要】從 rate 裡扣掉——一樣只寫進 conditions。',
    '     一句話：rate 只放「回饋率本身」，所有跟國外交易服務費有關的加減一律不動 rate。',
    '    items 適用通路陣列（實體/網購標明）——填法見下面【items 只放實際商家名】；category 分類標題；period_start/period_end YYYY/M/D。',
    '13. min_spend：單筆最低消費門檻金額（如「單筆滿3,000」→3000）；max_spend：單筆消費金額上限。⚠️「單筆滿額」門檻一律放這裡，【絕不】寫進 conditions。',
    '13a. 分級門檻（同通路單筆滿額有更高回饋、未滿有較低回饋）：拆成兩組。高回饋組填 min_spend＝門檻；低回饋組填 max_spend＝同一個門檻數字（不加一減一）。但若「未滿門檻只是落回基本回饋」（沒有獨立的較低率），則【不要】建低回饋那組，只建高回饋組填 min_spend。',
    '13b. 累積消費級距（同一活動依累積金額分多段不同回饋率，如「4萬~7.9萬 0.5%／8萬~15.9萬 0.8%／16萬以上 1.5%」）：',
    '     【每一段各自成一組】，min_spend＝該段下界、max_spend＝【下一段的下界】（排他，不要填 79,999 這種減一的數字；最高一段的 max_spend 留空）。',
    '     ✅ 正確：三組——(0.5, min 40000, max 80000)、(0.8, min 80000, max 160000)、(1.5, min 160000, max 空)。',
    '     ⛔ 級距的金額範圍【絕不】寫進 conditions（那是 min_spend/max_spend 的工作），conditions 只留登錄之類的真條件。',
    '14. conditions 達成/限定條件——用全形分號「；」分隔、逐項精簡、無句號，只寫：',
    '    付款方式限定（如「限使用實體卡、LINE Pay、Apple Pay」）；自動扣繳/電子帳單設定；登錄與限量（有日期名額就寫出來，如「需登錄(7/23,8/23 12:00起)，限量」，不要只寫詳見官網）；',
    '    MCC code 認定；排除項目（如「排除餐券」「排除分期、第三方支付」）；可疊加提示（如「可與X權益疊加」）；條件式增減（如「若非Visa卡則-10%」）；',
    '    國外交易服務費的有無（「需收取1.5%國外交易服務費」會吃掉回饋、「免收1.5%國外交易服務費」是額外好處，兩種都要寫）。',
    '    【不要寫進 conditions】：單筆滿額門檻（放 min_spend）；一般的回饋上限（已由 cap 表達，只有「以信用額度加計NT$X萬」這種特殊上限定義才寫）；免責/罰則樣板（喪失資格、銀行保留權利）。',
    '    「認列為國內/國外通路」只在特例寫：同一通路難判國內外、且國內外回饋率不同而拆成兩組時，在國外那組註明「認列為國外通路」。',
    '14a. conditions 每一項都要「精簡到剩下動作本身」：拿掉主詞（「◯◯卡持卡人」「本行持卡人」）、',
    '    拿掉「成功」「並」「且需」這類贅字、拿掉官網的客套與重複描述，用最短的動詞短語。',
    '    ❌「聯邦綠卡持卡人成功申辦電子化帳單並成功申辦自動代扣繳」 → ✅「申辦電子化帳單及自動扣繳」',
    '    ❌「需事先於本行官方網站完成活動登錄始得享有」 → ✅「需登錄」',
    '    一項條件一句、用全形分號「；」分隔；寧可短，不要照抄官網整句。',
    '15. cap_spend：官網直接講的消費上限數字；cap_reward：官網講的回饋金額上限數字（兩者擇一，沒有省略）。',
    '16. group_kind：指定通路加碼 / 國外指定加碼 / 排除型 / 其他（排除型＝該通路回饋獨立、超額不回退基本，如悠遊卡自動加值）。',
    '17. is_stacked：這組是否疊加在另一組之上才成立（如踩點任務疊在基礎通路組）。是→true。',
    '18. structure_note【回饋組成原文】：欄名的重點是「原文」——',
    '    ⭐【第一優先】官網通常會有一句把「最高 X%」拆解成各成分的話，**逐字照抄那一句**（可去掉「※」開頭符號，其餘一字不改）。',
    '       這種句子長這樣：「最高回饋含：日本一般消費2.5%＋指定日本商店加碼6%＋日本實體滿額1.5%玉山e point（上限3,000點）」',
    '       「含日本PayPay消費3.5%+免收1.5%國外交易服務費」「20% = 指定五大通路加碼10% +新戶網路消費加碼7%+…」。',
    '       看到「最高…含：」「X% = A% + B%」「含…＋…」這類拆解式，一律照抄，【不要】自己改寫、精簡或換算。',
    '    ・找不到那種拆解句時，才自己寫一句：這個率是合計還是單一成分、疊在誰之上、各成分上限、有無額外費用。',
    '    ⛔ 不要複製整段注意事項（那是 evidence 的工作），也不要寫「詳見官網」。',
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
      structure_note: { type: 'STRING', description: '一句話說明這組的率怎麼組成／疊在誰之上／各成分上限／有無額外費用' },
      min_spend: { type: 'NUMBER', description: '單筆最低消費門檻金額' },
      max_spend: { type: 'NUMBER', description: '單筆消費金額上限（少見）' },
      cap_spend: { type: 'NUMBER' },
      cap_reward: { type: 'NUMBER' },
      evidence: { type: 'STRING' },
      needs_review: { type: 'BOOLEAN' },
      review_question: { type: 'STRING' }
    },
    required: ['rate', 'group_kind', 'structure_note', 'evidence', 'needs_review']
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
          levels_beyond_simple: { type: 'BOOLEAN', description: '這張卡的分級無法用「每級一個全卡回饋率＋上限」表達時填 true（見 prompt 規則 7a）' },
          levelSettings_evidence: { type: 'STRING', description: '分級卡：官網描述各級別的原文（供人工複核）' },
          levelLabelFormat: { type: 'STRING', description: '依官網用詞，如 方案: {level}' },
          overseasCashback: { type: 'NUMBER' }, overseasBonusRate: { type: 'NUMBER' },
          overseasBonusCap_reward: { type: 'NUMBER' }, overseasBonusConditions: { type: 'STRING' },
          overseasBonusPeriod_start: { type: 'STRING' }, overseasBonusPeriod_end: { type: 'STRING' },
          domesticBonusRate: { type: 'NUMBER' }, domesticBonusCap_reward: { type: 'NUMBER' },
          domesticBonusConditions: { type: 'STRING' },
          domesticBonusPeriod_start: { type: 'STRING', description: 'YYYY/M/D' },
          domesticBonusPeriod_end: { type: 'STRING', description: 'YYYY/M/D' },
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

// 起訖日 → Cards Data 的單欄期間字串「2026/1/1~2026/12/31」；兩邊都空就回空字串
function joinPeriod_(start, end) {
  const s = String(start || '').trim(), e = String(end || '').trim();
  return (s || e) ? (s + '~' + e) : '';
}

// 由 AI 的 levels 陣列組出 levelSettings JSON：{級別名:{rate,cap,period,"level-note"}}
//
// ⚠️ 它只做得出**最單純的那一種**形狀。實際資料裡三種形狀只有一種吃得下（2026-08-16 盤點）：
//     ✅ 玉山 Uni／凱基誠品：{rate, cap, period, level-note}
//     ❌ 國泰 CUBE：{specialRate, level-note}（分級改的是指定通路的率）
//     ❌ 永豐大戶卡：{rate_1, cap_1, rate_14, cap_hide, overseasBonusRate…} 共 11 個 key（逐槽覆寫）
//   後兩種硬套簡單格式會產出「看起來對、算出來錯」的 levelSettings，而站長未必看得出來——
//   所以由 AI 舉手（levels_beyond_simple）、這裡直接留空讓人手填（站長 2026-08-16 裁定：
//   分級卡數量少（全站 4 張）、形狀又雜，自動化的投報率遠低於產錯的代價）。
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
// ⚠️ 2026-08-16：「國外指定加碼」原本無條件回 'rate>basic>overseasBonusRate'。那個字串本身
//    是合法的（cashback-engine.md 有記載的 waterfall 寫法），但**只有卡片自己填了
//    overseasBonusRate 欄位時才成立**，套在沒有那個欄位的卡上是錯的。實例：玉山熊本熊卡的
//    「日本一般消費 2.5%」被判成國外指定加碼，套了那個 model，站長改成 `rate`——因為那 2.5%
//    是「日本這個通路的完整率、無上限、不跟別的疊」（該卡真正的一般消費只有 0.5%），
//    正是 `rate`（排除型）的語意。
//    一個 group_kind 對應不到唯一的 model，所以**不再猜**：留空，改在備註列出候選與選用時機。
function deriveGroupModel_(g, basic) {
  if (g.is_stacked) {
    return { model: '', hide: '', modelNeedsHuman: true,
      note: '疊加組：cashbackModel 請手填。同卡疊在第 N 槽之上就寫 rate+rate_N（如 rate+rate_1）；若還要疊基本回饋再加 +basic' };
  }
  switch (g.group_kind) {
    case '排除型':
      return { model: 'rate', hide: '', modelNeedsHuman: false, note: '排除型：cap 內用本組 rate、溢出算 0' };
    case '國外指定加碼': {
      // 候選清單依這張卡實際有哪些海外欄位給，避免建議一個卡片根本沒有的成分
      const hasBonus = num_(basic && basic.overseasBonusRate) > 0;
      const hasBase = num_(basic && basic.overseasCashback) > 0;
      const cands = ['rate＝這個通路的完整率、無上限也不跟別的疊（最常見）'];
      if (hasBase) cands.push('rate+overseasCashback＝本組加碼疊在海外基準率上');
      if (hasBonus) cands.push('rate>basic>overseasBonusRate＝瀑布式，cap 用完才落到下一層');
      return { model: '', hide: '', modelNeedsHuman: true,
        note: '國外指定加碼：cashbackModel 請手填，候選——' + cands.join('｜') +
          (hasBase || hasBonus ? '' : '（這張卡沒填 overseasCashback／overseasBonusRate，通常就是 rate）') };
    }
    case '指定通路加碼':
      return { model: '', hide: '', modelNeedsHuman: false, note: '' };
    default:
      return { model: '', hide: '', modelNeedsHuman: false, note: '' };
  }
}

// 級距組的 max_spend 補齊（2026-08-16 第二輪：prompt 教了，AI 三級距還是只填中間那級）。
// 級距的定義本來就是「這一級的上界＝下一級的下界」，所以這是**算得出來的**，不必靠 AI 聽話。
//
// 分組依據：category ＋ 活動期間都一樣、且都有 min_spend ＝ 同一個活動的不同級距。
// 排好序後，每一級的 max_spend ← 下一級的 min_spend；最高一級維持空白（無上界）。
// ⚠️ 三道保險，避免把「剛好同分類但不是級距」的組別亂接起來：
//    1. 只補**空的** max_spend，AI 有填就尊重它
//    2. category 空白的不分組（沒有可靠的分組依據就不要猜）
//    3. 同一組 key 底下少於 2 級的不處理（單一組沒有「下一級」可言）
function fillTierMaxSpend_(groups) {
  const buckets = {};
  (groups || []).forEach(function (g) {
    if (!g || num_(g.min_spend) <= 0) return;
    const cat = String(g.category || '').trim();
    if (!cat) return;
    const key = cat + '｜' + (g.period_start || '') + '｜' + (g.period_end || '');
    (buckets[key] = buckets[key] || []).push(g);
  });
  Object.keys(buckets).forEach(function (key) {
    const tiers = buckets[key];
    if (tiers.length < 2) return;
    tiers.sort(function (a, b) { return num_(a.min_spend) - num_(b.min_spend); });
    for (let i = 0; i < tiers.length - 1; i++) {
      const next = num_(tiers[i + 1].min_spend);
      if (num_(tiers[i].max_spend) <= 0 && next > num_(tiers[i].min_spend)) {
        tiers[i].max_spend = next;   // 排他上界：引擎判 amount >= maxSpend 就不匹配
      }
    }
  });
}

// conditions 正規化：AI 常常無視 prompt 用半形「; 」當分隔（實測 2026-08-16 熊本熊卡兩處都是）。
// 這種格式問題不該靠 prompt 拜託，程式統一收尾：分隔符一律全形「；」、去掉結尾句號與多餘空白。
function normalizeConditions_(s) {
  return String(s == null ? '' : s)
    .replace(/\s*[;；]\s*/g, '；')   // 半形/全形分號 + 前後空白 → 全形分號
    .replace(/；+/g, '；')            // 連續分號收成一個
    .replace(/^；|[；。\s]+$/g, '')   // 去掉頭尾的分號、句號、空白
    .trim();
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
  // 2026-08-16 新增兩個期間欄，同樣自動補在各自的 Conditions 右邊——
  // 舊分頁不用刪重建（這張表是照位置寫的，少一欄整列就會左移錯位，所以一定要補）
  ensureBasicReviewColumn_(sheet, 'overseasBonusPeriod', 'overseasBonusConditions');
  ensureBasicReviewColumn_(sheet, 'domesticBonusPeriod', 'domesticBonusConditions');

  const overseasCap = spendCapFromReward_(basic.overseasBonusCap_reward, basic.overseasBonusRate);
  const domesticCap = spendCapFromReward_(basic.domesticBonusCap_reward, basic.domesticBonusRate);

  const valueByField = {
    id: basic.id || '', name: basic.name || '', fullName: basic.fullName || '', bank: basic.bank || '',
    basicCashback: (basic.basicCashback != null ? basic.basicCashback : ''),
    basicCashbackType: basic.basicCashbackType || '', pointsExpiry: basic.pointsExpiry || '',
    basicConditions: basic.basicConditions || '', annualFee: basic.annualFee || '',
    feeWaiver: basic.feeWaiver || '', website: basic.website || link || '',
    tags: (basic.tags || []).join(','), hasLevels: basic.hasLevels ? 'TRUE' : 'FALSE',
    // 新卡預填 levelSettings JSON（新卡沒有既存用戶偏好，預填安全；你可直接改）。
    // AI 舉手說這張卡的分級超出簡單形狀（CUBE 的 specialRate、大戶卡的逐槽覆寫）→ 留空給人手填
    levelSettings: basic.levels_beyond_simple ? '' : buildLevelSettings_(basic.levels),
    levelLabelFormat: basic.levelLabelFormat || '',      // AI 依官網用詞
    overseasCashback: (basic.overseasCashback != null ? basic.overseasCashback : ''),
    overseasBonusRate: (basic.overseasBonusRate != null ? basic.overseasBonusRate : ''),
    overseasBonusCap: overseasCap, overseasBonusConditions: basic.overseasBonusConditions || '',
    overseasBonusPeriod: joinPeriod_(basic.overseasBonusPeriod_start, basic.overseasBonusPeriod_end),
    domesticBonusRate: (basic.domesticBonusRate != null ? basic.domesticBonusRate : ''),
    domesticBonusCap: domesticCap, domesticBonusConditions: basic.domesticBonusConditions || '',
    domesticBonusPeriod: joinPeriod_(basic.domesticBonusPeriod_start, basic.domesticBonusPeriod_end),
    parking: basic.parking || '', airport_pickup: basic.airport_pickup || '', airport_lounge: basic.airport_lounge || ''
  };
  const fixedCells = CARD_BASIC_FIELDS.map(function (f) { return valueByField[f]; });
  const levelWarn = basic.levels_beyond_simple
    ? '【levelSettings 需手填】這張卡的分級超出程式能產的簡單格式（每級一個全卡率＋上限）——' +
      '可能是分級改的是指定通路的率（參考國泰 CUBE 的 specialRate 寫法），' +
      '或一級要覆寫多個槽位（參考永豐大戶卡的 rate_1/cap_1/rate_14… 寫法）。' +
      '各級別的官網原文已放在最右邊的「levelSettings原文引用」欄。'
    : '';
  const reviewQ = [basic.review_question || '', levelWarn,
    idCollision ? '（id 已存在，若為新卡請改 id）' : '']
    .filter(function (x) { return x; }).join('　');
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
  } else {
    // 2026-08-16 欄位改版（刪「cashbackModel需手填?」、加「回饋組成原文」）。本表是照位置
    // appendRow，舊表頭直接寫下去會整列錯位——而這張表的用途就是整段複製到 Cards Data，
    // 錯位的資料看起來完全正常、貼過去才會發現。寧可停下來講清楚。
    const cur = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    if (cur.indexOf('cashbackModel需手填?') >= 0 || cur.indexOf('回饋組成原文') < 0) {
      throw new Error('「' + CARD_PARSER_CONFIG.groupReviewSheet + '」的表頭是舊版（2026-08-16 前）。' +
        '這張表是照欄位位置寫入的，硬寫下去整列會錯位。' +
        '請把該分頁整個刪掉讓它自動重建（那是暫存審核表，刪掉不影響任何正式資料），再跑一次解析。');
    }
  }
  const now = new Date();
  fillTierMaxSpend_(groups);   // 級距組的 max_spend 由下一級的 min_spend 補齊（AI 常漏填）

  // 一般組別：編號 1 起、跳過保留槽 14/21/22
  let slot = 1;
  let skipped = 0;   // 非百分比回饋（定額/折扣/折價券）被略過的組數
  const nextSlot = function () { while (RESERVED_SLOTS.indexOf(slot) !== -1) slot++; return slot++; };
  (groups || []).forEach(function (g) {
    // 站長 2026-08-16 定案：rate 是 0/空的組別不要列出來——那是「滿額送固定金額」「打折」
    // 「折價券」這類非百分比回饋，本站的計算模型表達不了，列出來只是佔位子讓人一列一列刪。
    // ⚠️ 這條**只管 AI 解析出來的組別**；固定模板 14/21/22 的 rate 本來就刻意是 0
    //    （率由 cashbackModel 的成分決定），那是 appendSpecialSlots_ 另外走的路徑，不受影響。
    if (num_(g.rate) <= 0) { skipped++; return; }

    // cap 消費上限：官網直接講就用；否則由「回饋金額上限 ÷ 率」換算。
    // ⚠️ 級距組（有 max_spend）要再取小值：max_spend 是排他的（引擎判 amount >= maxSpend
    //    就不匹配，見 js/cashback-engine.js「滿額門檻」一段），所以這一級最大的合格消費額
    //    是 max_spend - 1。例：0.5% 級距 4萬~未滿8萬、回饋上限 3,000 點
    //    → 換算 600,000 但實際刷不到，cap 應為 79,999。
    let cap = (g.cap_spend != null && g.cap_spend !== '') ? Math.round(num_(g.cap_spend))
      : spendCapFromReward_(g.cap_reward, g.rate);
    const tierMax = num_(g.max_spend);
    if (tierMax > 0) {
      const ceiling = tierMax - 1;
      cap = (cap === '' || cap == null) ? ceiling : Math.min(num_(cap), ceiling);
    }

    const d = deriveGroupModel_(g, basic);
    appendGroupRow_(sheet, now, cardId, nextSlot(), g.group_kind || '', {
      structure: g.structure_note || '',
      rate: (g.rate != null ? g.rate : ''), model: d.model, modelNeedsHuman: d.modelNeedsHuman,
      cap: cap, minSpend: (g.min_spend != null ? g.min_spend : ''), maxSpend: (g.max_spend != null ? g.max_spend : ''),
      items: (g.items || []).join(','), category: g.category || '',
      conditions: normalizeConditions_(g.conditions), ps: g.period_start || '', pe: g.period_end || '', hide: d.hide,
      note: d.note, needsReview: g.needs_review, reviewQ: g.review_question || '', evidence: g.evidence || ''
    });
  });
  writeGroupReview_.lastSkipped = skipped;   // 呼叫端拿去回報「略過了幾組」

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
  // ⚠️ 2026-08-16 修正（站長回報）：model 原本**寫死**成 overseasCashback+overseasBonusRate，
  //    但 category 早就會依 hasOverseas 切換。卡片根本沒有海外回饋設定時，廣告消費就是一般
  //    國內消費，model 硬填海外模型是錯的。現在 model／category／cap／期間四者**一起**切換：
  //      有海外設定 → overseasCashback+overseasBonusRate ＋「國外消費特列項目」＋海外 cap/期間
  //      沒有       → basic+domesticBonusRate         ＋「一般回饋特列項目」＋國內 cap、期間留空
  if (basic.general_excludes_ads !== '是') {
    const unknown = (basic.general_excludes_ads !== '否');  // 未提及或空 → 需你確認
    appendGroupRow_(sheet, now, cardId, 14, '（固定模板·廣告）', {
      rate: 0,
      model: hasOverseas ? 'overseasCashback+overseasBonusRate' : 'basic+domesticBonusRate',
      modelNeedsHuman: false,
      cap: hasOverseas ? overseasCap : domesticCap, minSpend: '', maxSpend: '', items: 'meta廣告,google廣告',
      category: hasOverseas ? '國外消費特列項目' : '一般回饋特列項目',
      conditions: '',
      ps: hasOverseas ? (basic.overseasBonusPeriod_start || '') : '',
      pe: hasOverseas ? (basic.overseasBonusPeriod_end || '') : '', hide: '',
      note: '程式生成固定模板（' + (hasOverseas ? '卡片有海外回饋設定→用海外模型' : '卡片無海外回饋設定→當一般國內消費') + '）；' +
        (unknown ? '⚠️ 無法確認一般消費是否排除廣告——請補一般消費頁(D2)或自行確認；若有排除請刪掉本列(slot 14 留空)' : '一般消費未排除廣告，保留本列'),
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
// （「需手填」不再有自己的欄位，改成併進「程式備註」的一句話＋整列標黃）
function appendGroupRow_(sheet, now, cardId, slotN, kind, f) {
  const note = [f.modelNeedsHuman ? '⚠️ cashbackModel 需手填' : '', f.note || '']
    .filter(function (s) { return s; }).join('；');
  const row = ['', now, cardId, slotN, kind, f.structure || '',
    f.rate, f.model, f.cap, f.minSpend, f.maxSpend,
    f.items, f.category, f.conditions, f.ps, f.pe, f.hide,
    note, f.needsReview ? 'TRUE' : '', f.reviewQ || '', f.evidence || ''];
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
