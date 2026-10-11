/**
 * PMC 資料自動化 —— 從監控快照抽「一般消費排除項目」（basicExclusions）
 * ============================================================
 * 這支住在「PMC 資料自動化」試算表，與 benefits-parser.gs / card-benefits-parser.gs /
 * register-link-finder.gs 同一個 Apps Script 專案，共用 callGemini_() / getCardsSheet_()，
 * 本檔不重複定義。（在 Apps Script 編輯器「＋ 檔案」新增指令碼，貼上本檔全文）
 *
 * 解決的問題：Cards Data 新增了 basicExclusions 欄（2026-09-30），前端搜尋走到「基本回饋」
 * fallback 時，命中排除名單的卡改成不顯示（實際刷下去是 0）。但 30 幾張卡的排除名單沒人要
 * 一張一張去官網抄——而「1-監控清單」早就把各銀行一般消費定義頁的全文存在 last_snapshot 了。
 *
 * ── 兩階段 ──────────────────────────────────────────────────
 * 【① 抽取】extractBasicExclusionsFromSnapshots
 *   讀「1-監控清單」中 keywords 看起來是一般消費/排除頁的列（BASICEX_CONFIG.rowKeywordRe），
 *   把 last_snapshot 交給 Gemini 抽出排除項目，**一張卡一列**寫進「5-待審核（一般消費排除）」。
 *   ・候選卡片＝該列的 card_id ＋ cards 欄；AI 只能從候選裡挑（JSON Schema enum 鎖死）
 *   ・已經在待審核表出現過的網址自動跳過（一次跑不完就再按一次接著跑；要重抽某頁就把
 *     待審核表裡那個網址的列刪掉）
 *   ・正式 Cards Data 的 basicExclusions **已經有值的卡直接跳過**（站長手填的就是答案，不重抽）
 *   ・命名一致（2026-09-30 站長要求：同一個東西不同銀行要寫成同一個字）：
 *     「既有名稱表」＝正式表已填的名單＋待審核表已核准的列＋站長手寫的範例答案，送給 AI 要求同義逐字沿用，
 *     AI 回來後再用 basicExNormKey_() 機械對一次（大小寫／全半形／空白／括號不同的寫法收斂成既有寫法）
 *   ・站長手寫的三份答案（BASICEX_EXAMPLES：台新 Richart、遠銀、玉山 Unicard）當成 few-shot 範例放進 prompt——
 *     示範「照原文用字並保留限定詞、正式名稱再補常用說法、舉例拆開列、地區型要列、被例外救回的卡要拿掉、
 *     只限某支付工具的補充說明不抽、跨行同義統一寫法」這些光靠規則講不清楚的寫法
 *   ・完全不發網路請求去官網，只讀快照；**1-監控清單 只讀不寫**
 *
 * 【② 寫回】applyBasicExclusionsToCardsData
 *   在待審核表的「核准」欄打 V（可先改 basicExclusions 那格），這支把同一張卡所有打 V 的列
 *   合併去重後，寫進正式 Cards Data 的 basicExclusions 欄。
 *   ⚠️ 安全底線：
 *     - **只寫 basicExclusions 這一欄**，每一格寫入前過 basicExAssertCol_() 驗欄名
 *     - **打 V 只寫空白格**：正式表那格已經有值就跳過、列在結果裡（不會蓋掉你手改過的名單）
 *     - **核准欄打「覆蓋」才會整格換掉已有的名單**（2026-10-11；官網改版要更新時用），確認視窗會逐卡列出新增／移除的項目
 *     - 寫之前跳確認視窗；寫成功才在待審核表蓋「已寫回」章，再按一次不會重複寫
 *
 * 寫完之後：資料檔選單「🎯 卡片管理 → 匯出」，網站才會吃到新名單。
 */

/************** 設定區 **************/
const BASICEX_CONFIG = {
  watchlistSheet: '1-監控清單',
  reviewSheet: '5-待審核（一般消費排除）',
  targetHeader: 'basicExclusions',        // 正式 Cards Data 要寫的欄（唯一允許寫入的欄）
  appliedMark: '已寫回',                   // 寫回成功後把 V 換成這個＋時間戳
  // 哪些監控列算「一般消費/排除頁」：比對該列的 keywords 欄（截圖裡是「一般消費」「不回饋消費項目」
  // 「一般消費項目排除」…）。keywords 空白的列（單卡權益頁、公告頁）不處理。
  rowKeywordRe: /一般消費|排除|不回饋|不計入|不適用回饋/,
  maxSnapshotChars: 30000,                 // 單頁送給 AI 的快照上限
  // 「原文引用」欄上限。2026-10-11 前是 prompt 要求 200 字＋程式截 500 字，站長回報玉山那格只有前兩列、
  // 看起來像快照不完整（其實快照是完整的）——站長要逐項核對，原文必須整段。Sheets 一格上限 5 萬字，留餘裕
  maxEvidenceChars: 20000,
  // ⚠️ Apps Script 單次硬上限 6 分鐘，超時是直接砍掉。一頁＝一次 Gemini 呼叫，長快照＋範例 prompt
  //    實測可以跑到 1～2 分鐘，所以看錶煞車要留足餘裕：過了這個秒數就不開新的一頁。
  //    2026-10-11 第一次實跑撞到「Exceeded maximum execution time」（原本設 240 秒）
  maxRunSeconds: 150,
  // 沒跑完 → 幾分鐘後由時間觸發器自動接著跑（同監控的分段接力）；0＝關閉，改成人工再按一次
  resumeAfterMinutes: 1,
  maxResumeChunks: 10,                     // 防無限接力：連續這麼多段還沒跑完就停手、寄信說明
  // 已經抽過的頁面一律跳過，除非「上次抽取超過這麼多天」**而且**監控在那之後記錄過這個網址有變動
  // （2-變動通知或其封存分頁裡有同網址、日期在上次抽取之後的列）
  refreshAfterDays: 30,
  colorReview: '#fff3cd'                   // AI 有疑問的列標黃
};

const BASICEX_REVIEW_HEADERS = [
  '核准', '解析時間', 'card_id', 'bank', '來源網址',
  'basicExclusions', 'AI想問的問題', '原文引用'
];

// 站長親手寫的標準答案（2026-09-30），當 few-shot 範例＋既有名稱表的種子。
// source 只取台新「權益不回饋項目」頁的排除表與例外表（整頁快照含大量選單雜訊，放進來只會浪費額度）。
// 答案是 taishin-richart 的：7-11、全家（台新Pay 綁 Richart 仍有回饋）與部分歐洲國家（Richart 例外有回饋）都已拿掉。
// ⚠️ 改答案寫法＝改所有銀行的命名基準，改之前想清楚；想加範例就加進下面的 BASICEX_EXAMPLES
const BASICEX_EXAMPLE = {
  card: 'taishin-richart',
  source: '信用卡權益不回饋消費項目 不回饋消費項目 說明(使用各種支付方式皆不提供回饋) ' +
    '媒體服務 YouTube、Spotify、TikTok 抖音、Apple媒體服務(即消費明細含「APPLE.COM/BILL或APPLE COM BILL」者，例如：iTunes、iCloud、App Store..等)、' +
    'Google產品或服務(即消費明細含「Google」者，例如：Google Play、Google Drive..等)。 ' +
    '部分歐洲國家實體商店交易 包含奧地利、比利時…英國、冰島、列支敦斯登及挪威等國家實體商店之消費。 ' +
    '境外投資平台交易 eToro或相類似境外投資交易平台。 博奕類交易 博奕類交易不回饋，包含賭博、賭場消費、賭博籌碼等。 ' +
    '分期交易 特約商店分期付款交易及單筆消費分期0利率之交易。 加值服務 儲值卡(如悠遊卡/icash卡/一卡通)自動加值、Samsung Pay悠遊卡加值。 ' +
    '指定量販店、超商消費 大全聯、全聯福利中心及便利商店(7-11/全家/萊爾富/OK超商等)消費，包含線上購物和各種支付方式。 ' +
    '各項代扣繳費用 含水費/電費/瓦斯費、電信費、eTag自動儲值、學費等。 指定保費 躉繳保費、投資型保費、三商美邦保費、彈性繳保費。 ' +
    '醫藥交易 臺北醫學大學附設醫院費用。 停車費 各縣市路邊停車費。 ' +
    '各繳費平台交易 包含但不限於線上支付/臨櫃繳款，如 e-Bill 全國繳費 / i 繳費 / 醫指付 / 電子化繳費稅處理平台(含電信費、醫療院所費用、社區管理費等) / ' +
    '公務機關暨醫療院所信用卡繳費平臺 / 台新繳費中心(含台新繳費中心網頁/Richart Life APP/Richart APP/行動銀行等通路)等)繳納之各項費用。 ' +
    '聯合信用卡處理中心交易 透過「聯合信用卡處理中心」提供之信用卡小額支付特約商店之消費(如停車場/麥當勞等同性質連鎖速食店等)。 ' +
    '規費、罰鍰 政府規費、違規罰鍰。 預借現金及其手續費、代償他行卡金額 含預借現金及其手續費、預借現金分期金及其手續費、代償他行信用卡/現金卡/小額信貸等之金額。 ' +
    '稅費 個人綜合所得稅、所得稅分期付款期金及其手續費、查核定稅(房屋稅/地價稅/牌照稅等)、公路養管費(原燃料費)。 ' +
    '其他 違約金、循環利息、基金交易及其手續費、信用卡年費及一般信用卡相關手續費(如掛失手續費/調閱簽單手續費等)。 ' +
    '【例外】指定卡別消費例外回饋項目 例外回饋項目 例外回饋卡別(有回饋的卡別) ' +
    '部分歐洲國家實體交易 台新Richart卡、卓富無限卡、環球無限卡…。 ' +
    'Apple媒體服務 以街口支付綁定街口聯名卡付款屬一般消費享1%回饋無上限；其他支付方式不回饋。 ' +
    '電信代扣繳 環球無限卡、遠傳friDay聯名卡。 ' +
    '量販店、便利商店消費 1. 於街口支付APP綁定街口聯名卡之掃碼消費類型，仍享有街口幣回饋。 ' +
    '2. 於7-11及全家以台新Pay綁定台新 Richart卡消費，並切換「Pay著刷」或「天天刷」方案仍享有台新Point(信用卡)回饋，其他方式不回饋。 ' +
    '3. 於大全聯店內使用大全聯實體信用卡或全支付綁定信用卡消費，仍享有福利點回饋。 ' +
    '學費 環球無限卡、台新商務卡。 水/電/瓦斯費代扣繳、eTag自動儲值 環球無限卡',
  answer: [
    'YouTube', 'Spotify', 'TikTok 抖音', 'Apple媒體服務', 'iTunes', 'iCloud', 'App Store',
    'Google Play', 'Google Drive', 'Google產品或服務', 'eToro',
    '悠遊卡自動加值', 'icash卡自動加值', '一卡通自動加值', 'Samsung Pay悠遊卡加值',
    '大全聯', '全聯福利中心', '萊爾富', 'OK超商',
    '水費', '電費', '瓦斯費', '電信費', 'eTag自動儲值', '學費',
    '躉繳保費', '投資型保費', '三商美邦保費', '彈性繳保費',
    '臺北醫學大學附設醫院費用', '路邊停車費',
    'e-Bill全國繳費', 'i繳費', '醫指付', '電子化繳費稅處理平台', '醫療院所費用', '社區管理費',
    '公務機關暨醫療院所信用卡繳費平臺', '台新繳費中心網頁繳費', 'Richart Life APP繳費', 'Richart APP繳費', '行動銀行繳費',
    '小額支付平台', '麥當勞', '政府規費', '違規罰鍰',
    '預借現金及其手續費', '預借現金分期金及其手續費', '代償他行信用卡/現金卡/小額信貸',
    '個人綜合所得稅', '所得稅分期付款期金及其手續費', '房屋稅', '地價稅', '牌照稅', '公路養管費(原燃料費)',
    '違約金', '循環利息', '基金交易及其手續費', '信用卡年費', '一般信用卡相關手續費'
  ]
};

// 2026-10-11 站長修正的遠銀、玉山名單（原本 AI 抽錯的地方：照抄原文用字、保留限定詞、地區型要列、
// Pi 拍錢包的補充說明不該抽）。答案已依站長同日的兩個決定調整：跨行統一寫法（7-ELEVEN→7-11、
// 循環息→循環利息、醫療費→醫療費用、各類預借現金→預借現金）、正式機構名再補常用說法（台灣電力公司＋電費…）。
const BASICEX_EXAMPLE_FEBANK = {
  card: 'febank-happy',
  source: '一般消費不含悠遊加值金、eTag儲值金、代繳eTag智慧停車費、年費、公共事業費用(水、電、瓦斯、中華電信費用等)、各項稅金代繳、' +
    '學雜費（含國外學校）、預借現金、代償本金及利息、貸放本金及利息、各類稅款、各項手續費(包含但不限掛失、調閱簽單、分期付款、預借現金手續費等)、' +
    '違約金及循環息、爭議款、各類繳稅費平台【包含但不限公務機關繳費平台(包含但不限學雜費、各類費用稅款、醫療費等)、醫指付APP、便利商店等、' +
    'E政府平台等】及eToro及其他相關類似境外投資交易平臺之交易款項。',
  answer: ['悠遊卡加值', 'eTag儲值', '代繳eTag智慧停車費', '信用卡年費', '公共事業費用', '水費', '電費', '瓦斯費', '中華電信電信費',
    '各項稅金代繳', '學費', '學雜費', '預借現金', '預借現金及其手續費', '代償他行信用卡/現金卡/小額信貸', '貸放本金及利息', '各類稅款',
    '信用卡掛失手續費', '調閱簽單手續費', '分期付款手續費', '違約金', '循環利息', '爭議款', '各類繳稅費平台', '公務機關繳費平台',
    '醫療費用', '醫指付APP', '便利商店', '7-11', '全家', '萊爾富', 'OK超商', 'E政府平台', 'eToro', '境外投資交易平臺']
};

const BASICEX_EUROPE = ['英國', '奧地利', '比利時', '保加利亞', '克羅埃西亞', '賽普勒斯', '捷克', '丹麥', '愛沙尼亞', '芬蘭', '法國',
  '德國', '希臘', '匈牙利', '愛爾蘭', '義大利', '拉脫維亞', '立陶宛', '盧森堡', '馬爾他', '荷蘭', '波蘭', '葡萄牙', '羅馬尼亞',
  '斯洛伐克', '斯洛維尼亞', '西班牙', '瑞典'];

const BASICEX_EXAMPLE_ESUN = {
  card: 'yushan-unicard',
  source: '一般消費項目不包含： 不回饋消費項目 說明 (使用各種支付方式皆不提供回饋) ' +
    '部分歐洲地區國家實體商店消費 ' + BASICEX_EUROPE.join('、') + '。 ' +
    '投資相關交易 基金扣繳、證券代銷、境外投資平台交易 (如eToro、MCO等投資平台)、匯兌平台交易 (如wise等) 及旅行支票、賭博籌碼、數位 (虛擬) 貨幣。 ' +
    '指定保費 玉山銀行分行通路之躉繳保費、南山人壽躉繳保費、三商美邦人壽投資型及躉繳型保單。 ' +
    '指定費用 查核 (定) 稅款、學費 (如i繳費平台及學費通繳費平臺等)、醫療費用、政府規費。 ' +
    '指定零售業 全聯福利中心 (含PX Pay及全支付)、大全聯 (含PX Pay及全支付)、PXGo!全聯線上購、便利商店 (含7-ELEVEN、全家、萊爾富及OK超商) 之交易。 ' +
    '聯合信用卡處理中心交易 透過「聯合信用卡處理中心」提供之信用卡小額支付特約商店 (如停車場、餐飲店、連鎖速食店、販賣機等) 之消費。 ' +
    '分期交易 特約商店分期付款消費交易。 ' +
    '各項費用代扣繳 台灣電力公司、台灣自來水公司、台北自來水事業處、瓦斯費、各縣市路邊停車費、中華電信及民營電信、合康領袖廳管理費等。 ' +
    '繳費平台機制繳納之各項費用 醫指付APP、電子化繳費稅處理平台、公務機關信用卡繳費平台、E政府服務平台等繳納之各項費用。 ' +
    '加值服務 儲值卡 (原電子票證) 儲值金 (含自動儲值) 及電子支付儲值 (含自動儲值) 儲值金。 eTag eTag自動儲值、eTag智慧停車費用。 ' +
    '其他 各類預借現金、餘額代償、循環息、違約金、信用卡年費、各項手續費及代收費用、繳納各項監理資費、菸品與法定不得促銷商品。 ' +
    '補充說明：…以玉山卡綁定 Pi 拍錢包APP於指定通路 (如台電、健保費及個人交易收付款等) 之交易皆不提供消費回饋… ' +
    '特定卡片 (玉山世界卡、…ＵBear卡、Only卡、…) 於歐洲地區實體特店刷卡仍享消費回饋。 ' +
    '…公務人員國民旅遊卡，於特約商店分期付款消費交易，以及歐洲地區國家實體商店刷卡消費，列為非一般消費項目…',
  answer: BASICEX_EUROPE.map(function (c) { return c + '實體消費'; }).concat([
    '基金扣繳', '證券代銷', '境外投資平台交易', 'eToro', 'MCO投資平台', '匯兌平台交易', 'wise', '旅行支票', '賭博籌碼', '數位 (虛擬) 貨幣',
    '玉山銀行分行通路之躉繳保費', '南山人壽躉繳保費', '三商美邦人壽投資型及躉繳型保單', '查核 (定) 稅款', '學費', 'i繳費平台',
    '學費通繳費平臺', '醫療費用', '政府規費', '全聯福利中心 (含PX Pay及全支付)', '大全聯 (含PX Pay及全支付)', 'PXGo!全聯線上購',
    '便利商店', '7-11', '全家', '萊爾富', 'OK超商', '小額支付特約商店 (如停車場、餐飲店、連鎖速食店、販賣機等)',
    '特約商店分期付款消費交易', '台灣電力公司', '電費', '台灣自來水公司', '台北自來水事業處', '水費', '瓦斯費', '各縣市路邊停車費',
    '路邊停車費', '中華電信及民營電信', '電信費', '合康領袖廳管理費', '醫指付APP', '電子化繳費稅處理平台', '公務機關信用卡繳費平台',
    'E政府服務平台', '儲值卡 (原電子票證) 儲值金 (含自動儲值)', '電子支付儲值金 (含自動儲值)', 'eTag自動儲值', 'eTag智慧停車費用',
    '預借現金', '餘額代償', '循環利息', '違約金', '信用卡年費', '各項手續費及代收費用', '繳納各項監理資費', '菸品'])
};

// prompt 依序放這三份；既有名稱表也從這三份的答案取種子
const BASICEX_EXAMPLES = [BASICEX_EXAMPLE, BASICEX_EXAMPLE_FEBANK, BASICEX_EXAMPLE_ESUN];

/************** ① 抽取：1-監控清單 last_snapshot → 5-待審核 **************/
// 選單手動按，或由上一段排的時間觸發器自動接著跑（觸發器執行時沒有 UI，結果改寄信）
function extractBasicExclusionsFromSnapshots() {
  const ui = basicExUi_();
  const props = PropertiesService.getScriptProperties();
  basicExClearResumeTrigger_();
  if (ui) basicExResetResume_(props);   // 人工按＝新的一輪，接力計數與累計歸零

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const watch = ss.getSheetByName(BASICEX_CONFIG.watchlistSheet);
  if (!watch) { basicExReport_(ui, '找不到分頁', ['找不到「' + BASICEX_CONFIG.watchlistSheet + '」。']); return; }

  const data = watch.getDataRange().getValues();
  const h = data[0].map(function (x) { return String(x).trim(); });
  const c = function (name) { return h.indexOf(name); };
  const cUrl = c('url'), cSnap = c('last_snapshot'), cId = c('card_id'), cCards = c('cards');
  const cBank = c('bank'), cKw = c('keywords'), cActive = c('active');
  if (cUrl < 0 || cSnap < 0 || cKw < 0) {
    basicExReport_(ui, '表頭不對', ['「' + BASICEX_CONFIG.watchlistSheet + '」第一列要有 url、last_snapshot、keywords 表頭。']);
    return;
  }

  const validIds = getCardIds_();   // 正式 Cards Data 的合法 id（跨檔唯讀）
  const review = basicExEnsureReviewSheet_(ss);
  const doneAt = basicExReviewedUrls_(review);            // 網址 → 最近一次抽取時間
  const changedAt = basicExMonitorChangedUrls_(ss);       // 網址 → 監控最近一次記錄變動的時間
  const filled = basicExReadFilledCards_();               // 正式表已經有名單的卡 → 不重抽
  const vocab = basicExBuildVocabulary_(filled, review);  // 命名一致用的既有名稱表
  const now = new Date();
  const refreshMs = BASICEX_CONFIG.refreshAfterDays * 24 * 60 * 60 * 1000;

  const todo = [];
  const skipped = [];
  let alreadyDone = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const url = String(row[cUrl] || '').trim();
    const kw = String(row[cKw] || '').trim();
    if (!url || !BASICEX_CONFIG.rowKeywordRe.test(kw)) continue;
    if (cActive >= 0 && String(row[cActive]).trim().toUpperCase() === 'FALSE') continue;

    // 抽過的頁：除非「超過 refreshAfterDays 天」且「監控在上次抽取後記錄過變動」，否則跳過
    let refresh = false;
    if (doneAt[url]) {
      const last = doneAt[url];
      if (now - last >= refreshMs && changedAt[url] && changedAt[url] > last) refresh = true;
      else { alreadyDone++; continue; }
    }

    const bank = cBank >= 0 ? String(row[cBank] || '').trim() : '';
    const label = (bank || '第 ' + (i + 1) + ' 列');
    const snap = String(row[cSnap] || '').trim();
    if (snap.length < 100) { skipped.push(label + '：last_snapshot 是空的或太短'); continue; }

    const ids = [];
    if (cId >= 0) basicExSplit_(row[cId]).forEach(function (x) { if (ids.indexOf(x) < 0) ids.push(x); });
    if (cCards >= 0) basicExSplit_(row[cCards]).forEach(function (x) { if (ids.indexOf(x) < 0) ids.push(x); });
    const candidates = ids.filter(function (x) { return validIds.indexOf(x) >= 0; });
    const unknown = ids.filter(function (x) { return validIds.indexOf(x) < 0; });
    if (unknown.length) skipped.push(label + '：這些 id 在 Cards Data 找不到，已忽略：' + unknown.join('、'));
    if (candidates.length === 0) { skipped.push(label + '：card_id／cards 欄沒有合法的卡片 id'); continue; }

    // 首次抽取：正式表已有名單的卡不抽（站長手填的就是答案）。
    // 官網更新後重抽：全部候選卡都抽，已有名單的那幾列會註明「比對後要換就打『覆蓋』」
    const open = refresh ? candidates : candidates.filter(function (x) { return !filled.ids[x]; });
    const already = candidates.filter(function (x) { return filled.ids[x]; });
    if (!refresh && already.length) skipped.push(label + '：正式表已有名單、不重抽：' + already.join(','));
    if (open.length === 0) continue;

    todo.push({ url: url, bank: bank, label: label, text: snap, candidates: open, refresh: refresh, filledIds: filled.ids });
  }

  const started = Date.now();
  let pagesDone = 0, rowsWritten = 0;
  const errors = [];
  for (let k = 0; k < todo.length; k++) {
    if ((Date.now() - started) / 1000 > BASICEX_CONFIG.maxRunSeconds) break;
    const t = todo[k];
    try {
      const groups = basicExAskGemini_(t.bank, t.text.slice(0, BASICEX_CONFIG.maxSnapshotChars), t.candidates, vocab);
      rowsWritten += basicExWriteReview_(review, t, groups);   // 每頁寫完立刻落地：被砍也不會丟已完成的頁
    } catch (e) {
      errors.push(t.label + '：' + e.message);
    }
    pagesDone++;
  }

  const totals = basicExAddTotals_(props, pagesDone, rowsWritten, errors);
  const remaining = todo.length - pagesDone;
  const tail = [
    errors.length || totals.errors.length ? '\n失敗（沒寫入，下次會重試）：\n・' + totals.errors.join('\n・') : '',
    skipped.length ? '\n略過：\n・' + skipped.join('\n・') : '',
    alreadyDone ? '\n已經抽過、跳過 ' + alreadyDone + ' 頁（超過 ' + BASICEX_CONFIG.refreshAfterDays +
      ' 天且監控記錄過變動的頁才會重抽；要立刻重抽某頁，把待審核表裡那個網址的列刪掉）' : '',
    '\n👉 下一步：到「' + BASICEX_CONFIG.reviewSheet + '」逐列檢查 basicExclusions（可直接改那格），沒問題在「核准」打 V，',
    '   再按選單「其他工具 ▸ 一般消費排除 2」。標黃的列是 AI 有疑問的，看「AI想問的問題」欄。'
  ];

  if (remaining > 0) {
    const sched = basicExScheduleResume_(props);
    if (sched.ok) {
      // 還沒跑完：人工按的跳視窗交代；觸發器跑的不寄信（等全部跑完才寄一封總結）
      if (ui) basicExReport_(ui, '分段執行中', ['這一段處理 ' + pagesDone + ' 頁、寫入 ' + rowsWritten + ' 列。',
        '還剩 ' + remaining + ' 頁，' + BASICEX_CONFIG.resumeAfterMinutes + ' 分鐘後會自動接著跑，全部跑完會寄信給你。',
        '（不用一直開著試算表；也可以直接再按一次選單，效果一樣）'].concat(tail));
      return;
    }
    basicExResetResume_(props);
    basicExReport_(ui, '沒有跑完', ['累計處理 ' + totals.pages + ' 頁、寫入 ' + totals.rows + ' 列，還剩 ' + remaining + ' 頁。',
      sched.reason, '要繼續就再按一次選單。'].concat(tail));
    return;
  }

  basicExResetResume_(props);
  basicExReport_(ui, '全部跑完', [
    totals.pages ? '完成：共處理 ' + totals.pages + ' 頁，寫入 ' + totals.rows + ' 列到「' + BASICEX_CONFIG.reviewSheet + '」。'
      : '沒有要處理的頁面。'
  ].concat(tail));
}

/************** 分段接力（仿 watchlist-monitor 的 scheduleWatchlistResume_） **************/
const BASICEX_CHUNK_KEY = 'BASICEX_RESUME_CHUNK';     // 這一輪已經接力幾段
const BASICEX_TOTALS_KEY = 'BASICEX_RESUME_TOTALS';   // 這一輪累計（JSON：pages、rows、errors）
const BASICEX_HANDLER = 'extractBasicExclusionsFromSnapshots';

function basicExScheduleResume_(props) {
  if (!BASICEX_CONFIG.resumeAfterMinutes) return { ok: false, reason: '自動接續已關閉（resumeAfterMinutes = 0）。' };
  const chunks = (Number(props.getProperty(BASICEX_CHUNK_KEY)) || 0) + 1;
  props.setProperty(BASICEX_CHUNK_KEY, String(chunks));
  if (chunks >= BASICEX_CONFIG.maxResumeChunks) {
    return { ok: false, reason: '已連續接力 ' + BASICEX_CONFIG.maxResumeChunks + ' 段還沒跑完，先停手——' +
      '通常是某一頁每次都失敗或特別慢，看下面的失敗清單。' };
  }
  ScriptApp.newTrigger(BASICEX_HANDLER).timeBased().after(BASICEX_CONFIG.resumeAfterMinutes * 60 * 1000).create();
  return { ok: true };
}

// 刪掉之前排的接力觸發器（一次性觸發器跑完不會自己消失，留著會累積到 20 個上限）
function basicExClearResumeTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === BASICEX_HANDLER && t.getEventType() === ScriptApp.EventType.CLOCK) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function basicExResetResume_(props) {
  props.deleteProperty(BASICEX_CHUNK_KEY);
  props.deleteProperty(BASICEX_TOTALS_KEY);
}

function basicExAddTotals_(props, pages, rows, errors) {
  let t;
  try { t = JSON.parse(props.getProperty(BASICEX_TOTALS_KEY) || ''); } catch (e) { t = null; }
  t = t || { pages: 0, rows: 0, errors: [] };
  t.pages += pages;
  t.rows += rows;
  t.errors = t.errors.concat(errors).slice(-30);   // Properties 單值有大小上限，只留最近 30 筆
  props.setProperty(BASICEX_TOTALS_KEY, JSON.stringify(t));
  return t;
}

// 選單按的有 UI；觸發器跑的沒有（getUi 會丟例外）
function basicExUi_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }
}

// 有 UI 跳視窗，沒有就寄信給自己
function basicExReport_(ui, title, lines) {
  const text = lines.filter(function (x) { return x; }).join('\n');
  if (ui) { ui.alert('一般消費排除：' + title, text, ui.ButtonSet.OK); return; }
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '【一般消費排除】' + title, text);
}

// 監控記錄的變動：2-變動通知 與其封存分頁裡，每個網址最近一次的「日期時間」
function basicExMonitorChangedUrls_(ss) {
  const map = {};
  const names = [
    (typeof MONITOR_CONFIG !== 'undefined' && MONITOR_CONFIG.inboxSheet) || '2-變動通知',
    (typeof INBOX_ARCHIVE_SHEET !== 'undefined' && INBOX_ARCHIVE_SHEET) || '2-封存（變動通知）'
  ];
  names.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    const data = sheet.getDataRange().getValues();
    const head = data[0].map(function (x) { return String(x).trim(); });
    const cUrl = head.indexOf('網址'), cTime = head.indexOf('日期時間');
    if (cUrl < 0 || cTime < 0) return;
    for (let i = 1; i < data.length; i++) {
      const url = String(data[i][cUrl] || '').trim();
      const t = data[i][cTime] instanceof Date ? data[i][cTime] : new Date(data[i][cTime]);
      if (!url || isNaN(t.getTime())) continue;
      if (!map[url] || t > map[url]) map[url] = t;
    }
  });
  return map;
}

/************** 問 Gemini：這頁的一般消費排除項目 **************/
function basicExAskGemini_(bank, text, candidates, vocab) {
  const systemPrompt = [
    '你是台灣信用卡條款的閱讀助理。輸入是某銀行信用卡官網頁面的純文字（可能含選單等雜訊）。',
    '任務：找出「不列入一般消費／不給任何刷卡回饋」的項目（常見標題：一般消費定義、不回饋消費項目、',
    '一般消費不包含、排除項目），整理成比價網站用的名單：使用者在搜尋框輸入名單上的字時，網站會告訴他「刷這張卡沒有回饋」。',
    '',
    '寫法規則（2026-10-11 依站長修正的遠銀、玉山名單更新；最後有三份站長親手寫的範例，寫法以範例為準）：',
    '1. 以「使用者會在搜尋框輸入的字」來寫：商家名、服務名、繳費項目名。使用者會直接打 iTunes，不會打「Apple媒體服務」。',
    '2. 原文有舉例（如…／例如…／含…／包含但不限…／括號列舉）時，類別名保留一項，每個例子再各自獨立成一項。',
    '   例：「Apple媒體服務(例如iTunes、iCloud、App Store)」→ Apple媒體服務、iTunes、iCloud、App Store；',
    '   「各項手續費(包含但不限掛失、調閱簽單、分期付款…)」→ 信用卡掛失手續費、調閱簽單手續費、分期付款手續費；',
    '   「便利商店(7-ELEVEN、全家…)」→ 便利商店、7-11、全家、萊爾富、OK超商。',
    '3. 照原文用字、保留限定詞，絕不可去掉限定詞擴大範圍：「中華電信費用」→「中華電信電信費」（不可寫成「電信費」，',
    '   因為民營電信不在內）、「eTag儲值金」→「eTag儲值」（原文沒有「自動」就不要加）、「代繳eTag智慧停車費」保留「代繳」、',
    '   「玉山銀行分行通路之躉繳保費」不可縮成「躉繳保費」、「各縣市路邊停車費」不可寫成「停車費」。原文的括號補充可以照抄。',
    '4. 原文寫正式機構名或冗長說法時，**再補一項使用者會打的常用說法**（兩項都列）：台灣電力公司→再補「電費」、',
    '   台灣自來水公司／台北自來水事業處→再補「水費」、中華電信及民營電信→再補「電信費」、各類預借現金→再補「預借現金」、',
    '   各縣市路邊停車費→再補「路邊停車費」。只補意思完全相同、範圍沒有變大的說法。',
    '5. 地區型、分期型的排除也要列（除非這張卡有例外，見第 6 條）：國家／地區逐一列成「<國名>實體消費」',
    '   （例：英國實體消費、法國實體消費…）；分期照原文（例：特約商店分期付款消費交易）。',
    '6. 例外：頁面常有「例外回饋項目／有回饋的卡別／特定卡片仍享回饋」或「但…除外」。某項目對某張候選卡有例外回饋（任何條件下仍有回饋），',
    '   就不要放進那張卡的 items；只救回其中一部分時，只拿掉被救回的那部分（例：台新 Richart 用台新Pay 在 7-11、全家仍有回饋',
    '   → Richart 不列 7-11、全家，但大全聯、全聯福利中心、萊爾富、OK超商 照列；Richart 在部分歐洲國家有例外回饋 → 不列那些國家）。',
    '   因此不同卡可能要分成不同 group。例外內容與你的處理方式寫進 review_question。',
    '7. 只列「一般消費排除清單本身」的項目。只適用於某個支付工具或子方案的補充說明不要列（例：「以玉山卡綁定 Pi 拍錢包於台電、',
    '   健保費…不提供回饋」只限 Pi 拍錢包，不可把「健保費」列進來；國民旅遊卡的說明也不列）。',
    '   只是「不適用加碼、仍有基本回饋」的項目也不要列（寫進 review_question 讓人判斷）。',
    '8. 跨銀行統一寫法（站長決定：同一件事各銀行寫成同一個字）：使用者訊息裡有「既有名稱表」，意思**完全相同**的項目一律',
    '   改用表中寫法，不保留各家原文（例：7-ELEVEN→7-11、循環息→循環利息、醫療費→醫療費用）。範圍不同的（中華電信電信費 vs 電信費）',
    '   不算相同，照第 3 條保留原文。',
    '9. 不要輸出單一個字（如「稅」）、不要以「等」結尾、不要輸出「經本行認定之其他交易」這類對不到具體項目的概括條款。',
    '10. 頁面分卡別列不同名單就分成多個 group，每組 card_ids 只放適用的卡；同一份名單適用全部候選卡就一組。',
    '    card_ids 只能從候選清單挑。頁面找不到任何排除條款（快照只抓到選單、內容是別的活動）→ groups 回空陣列。',
    '    快照明顯不完整（表格只有前幾列就斷掉）時，抽得到的照抽，但 needs_review=true，review_question 寫「快照可能不完整」。',
    '11. evidence 原樣摘錄原文中**完整的**排除條款段落（整張不回饋表格＋例外／補充說明，不要刪節、不要只摘前幾列），',
    '    站長要拿它逐項核對你的 items。沒把握就 needs_review=true 並寫出問題。',
    ''
  ].concat(BASICEX_EXAMPLES.map(function (ex, n) {
    return '【範例 ' + (n + 1) + '】卡片：' + ex.card + '\n原文：' + ex.source + '\n答案 items：' + ex.answer.join(',');
  })).join('\n');


  const schema = {
    type: 'OBJECT',
    properties: {
      groups: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            card_ids: { type: 'ARRAY', items: { type: 'STRING', enum: candidates } },
            items: { type: 'ARRAY', items: { type: 'STRING' } },
            evidence: { type: 'STRING' },
            needs_review: { type: 'BOOLEAN' },
            review_question: { type: 'STRING' }
          },
          required: ['card_ids', 'items', 'evidence', 'needs_review']
        }
      }
    },
    required: ['groups']
  };

  const userText = '銀行：' + (bank || '（未填）') + '\n候選卡片 id：' + candidates.join(', ') +
    '\n\n既有名稱表（意思相同就逐字沿用這裡的寫法）：\n' + vocab.names.join(',') +
    '\n\n以下是官網頁面文字：\n\n' + text;
  const result = callGemini_(systemPrompt, userText, schema);
  const groups = (result && result.groups) || [];

  // 機械清洗：不在候選裡的 id 丟掉（enum 已鎖，這是第二道）、去掉結尾的「等」、
  // 對到既有名稱表的換成既有寫法、去重、丟掉少於 2 字的
  return groups.map(function (g) {
    const ids = (g.card_ids || []).filter(function (x) { return candidates.indexOf(x) >= 0; });
    const seen = {};
    const items = [];
    (g.items || []).forEach(function (s) {
      let t = String(s || '').trim().replace(/[,，、]/g, ' ').trim();
      if (t.length > 2) t = t.replace(/等$/, '');
      const key = basicExNormKey_(t);
      if (vocab.byKey[key]) t = vocab.byKey[key];
      if (t.length < 2 || seen[key]) return;
      seen[key] = true;
      items.push(t);
    });
    return { card_ids: ids, items: items, evidence: g.evidence || '',
      needs_review: !!g.needs_review, review_question: g.review_question || '' };
  }).filter(function (g) { return g.card_ids.length > 0; });
}

/************** 寫待審核表（一張卡一列） **************/
function basicExWriteReview_(sheet, page, groups) {
  const now = new Date();
  const rows = [];
  const flags = [];
  const covered = {};
  // 官網更新後重抽、而且正式表已有名單的卡：打 V 不會蓋掉，要換就在核准欄打「覆蓋」
  const refreshNote = function (id) {
    return page.refresh && page.filledIds && page.filledIds[id]
      ? '【官網更新後重抽】正式表已有名單。跟正式表比對後，要換成這次的內容就在核准欄打「覆蓋」（打 V 不會蓋掉）。' : '';
  };
  groups.forEach(function (g) {
    g.card_ids.forEach(function (id) {
      covered[id] = true;
      const note = refreshNote(id);
      rows.push(['', now, id, page.bank, page.url, g.items.join(','),
        [note, g.review_question].filter(function (x) { return x; }).join('\n'), String(g.evidence).slice(0, BASICEX_CONFIG.maxEvidenceChars)]);
      flags.push(g.needs_review || g.items.length === 0 || !!note);
    });
  });
  // 候選卡 AI 一張都沒分到（或整頁找不到排除條款）→ 仍寫一列標黃，讓這個網址算「處理過」，
  // 也讓站長看得到「這頁抽不到東西」，而不是默默消失、每次按都重跑一次燒額度
  page.candidates.forEach(function (id) {
    if (covered[id]) return;
    rows.push(['', now, id, page.bank, page.url, '',
      'AI 在這頁沒找到適用這張卡的排除條款——快照可能只抓到選單，或排除名單在別頁', '']);
    flags.push(true);
  });
  if (rows.length === 0) return 0;

  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, BASICEX_REVIEW_HEADERS.length).setValues(rows);
  flags.forEach(function (f, i) {
    if (f) sheet.getRange(start + i, 1, 1, BASICEX_REVIEW_HEADERS.length).setBackground(BASICEX_CONFIG.colorReview);
  });
  return rows.length;
}

function basicExEnsureReviewSheet_(ss) {
  let sheet = ss.getSheetByName(BASICEX_CONFIG.reviewSheet);
  if (!sheet) {
    sheet = ss.insertSheet(BASICEX_CONFIG.reviewSheet);
    sheet.getRange(1, 1, 1, BASICEX_REVIEW_HEADERS.length).setValues([BASICEX_REVIEW_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const cur = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  if (cur.join('|') !== BASICEX_REVIEW_HEADERS.join('|')) {
    throw new Error('「' + BASICEX_CONFIG.reviewSheet + '」的表頭跟程式預期不同（欄位是依位置寫入的）。' +
      '請不要增刪或搬動欄位；要重建就把整個分頁刪掉再按一次。');
  }
  return sheet;
}

// 網址 → 最近一次抽取時間（「解析時間」欄；讀不到日期的列當成很久以前）
function basicExReviewedUrls_(sheet) {
  const map = {};
  const last = sheet.getLastRow();
  if (last < 2) return map;
  const iTime = BASICEX_REVIEW_HEADERS.indexOf('解析時間');
  const iUrl = BASICEX_REVIEW_HEADERS.indexOf('來源網址');
  sheet.getRange(2, 1, last - 1, BASICEX_REVIEW_HEADERS.length).getValues().forEach(function (r) {
    const u = String(r[iUrl] || '').trim();
    if (!u) return;
    let t = r[iTime] instanceof Date ? r[iTime] : new Date(r[iTime]);
    if (isNaN(t.getTime())) t = new Date(0);
    if (!map[u] || t > map[u]) map[u] = t;
  });
  return map;
}

/************** ② 寫回：5-待審核 打 V 的列 → 正式 Cards Data 的 basicExclusions 欄 **************/
function applyBasicExclusionsToCardsData() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const review = ss.getSheetByName(BASICEX_CONFIG.reviewSheet);
  if (!review) { ui.alert('找不到「' + BASICEX_CONFIG.reviewSheet + '」——先跑「① 抽取」。'); return; }
  basicExEnsureReviewSheet_(ss);   // 表頭驗證

  const rData = review.getDataRange().getValues();
  const iApprove = BASICEX_REVIEW_HEADERS.indexOf('核准');
  const iId = BASICEX_REVIEW_HEADERS.indexOf('card_id');
  const iItems = BASICEX_REVIEW_HEADERS.indexOf('basicExclusions');

  // 同一張卡可能有多列打 V（例如兩個頁面都列了它）→ 合併去重。
  // 「覆蓋」（2026-10-11）：核准欄打「覆蓋」＝這張卡正式表已有名單、要整格換成這次的內容（官網改版時用）。
  // 同一張卡只要有一列打「覆蓋」，整張卡就走覆蓋。
  const byCard = {};      // id → { items: [], reviewRows: [], overwrite }
  for (let i = 1; i < rData.length; i++) {
    const overwrite = basicExIsOverwrite_(rData[i][iApprove]);
    if (!overwrite && !basicExIsChecked_(rData[i][iApprove])) continue;
    const id = String(rData[i][iId] || '').trim();
    if (!id) continue;
    if (!byCard[id]) byCard[id] = { items: [], reviewRows: [], overwrite: false };
    if (overwrite) byCard[id].overwrite = true;
    byCard[id].reviewRows.push(i + 1);
    basicExSplit_(rData[i][iItems]).forEach(function (t) {
      if (t.length >= 2 && byCard[id].items.indexOf(t) < 0) byCard[id].items.push(t);
    });
  }

  const cardsSheet = getCardsSheet_();
  const cData = cardsSheet.getDataRange().getValues();
  const cHead = cData[0].map(function (x) { return String(x).trim(); });
  const cId = cHead.indexOf('id');
  const cTarget = cHead.indexOf(BASICEX_CONFIG.targetHeader);
  if (cId < 0) { ui.alert('正式 Cards Data 找不到 id 欄，中止。'); return; }
  if (cTarget < 0) {
    ui.alert('正式 Cards Data 還沒有「' + BASICEX_CONFIG.targetHeader + '」欄。\n' +
      '請先在 Cards Data 第一列找一個空欄，表頭打 ' + BASICEX_CONFIG.targetHeader + '（大小寫要一樣），再按一次。');
    return;
  }
  const rowById = {};
  for (let i = 1; i < cData.length; i++) {
    const id = String(cData[i][cId] || '').trim();
    if (id && rowById[id] === undefined) rowById[id] = i;
  }

  const plan = [];
  const problems = [];
  const alreadyFilled = [];
  Object.keys(byCard).forEach(function (id) {
    const entry = byCard[id];
    if (entry.items.length === 0) { problems.push(id + '：打了 V 但 basicExclusions 是空的，跳過'); return; }
    const r = rowById[id];
    if (r === undefined) { problems.push(id + '：正式 Cards Data 找不到這個 id，跳過'); return; }
    const existing = String(cData[r][cTarget] == null ? '' : cData[r][cTarget]).trim();
    // 打 V：只寫空白格，不蓋掉已有（可能手改過）的名單。打「覆蓋」：整格換掉，確認視窗會列出增減
    if (existing && !entry.overwrite) { alreadyFilled.push(id); return; }
    const value = entry.items.join(',');
    if (existing === value) { problems.push(id + '：正式表內容已經一樣，不用寫'); return; }
    let diff = '';
    if (existing) {
      const oldItems = basicExSplit_(existing);
      const added = entry.items.filter(function (t) { return oldItems.indexOf(t) < 0; });
      const removed = oldItems.filter(function (t) { return entry.items.indexOf(t) < 0; });
      diff = '覆蓋：+' + added.length + ' 項、−' + removed.length + ' 項' +
        (added.length ? '\n      新增：' + added.slice(0, 8).join('、') + (added.length > 8 ? '…' : '') : '') +
        (removed.length ? '\n      移除：' + removed.slice(0, 8).join('、') + (removed.length > 8 ? '…' : '') : '');
    }
    plan.push({ id: id, cardRow: r + 1, value: value, count: entry.items.length,
      reviewRows: entry.reviewRows, diff: diff });
  });

  if (plan.length === 0) {
    ui.alert([
      '沒有可以寫回的資料。',
      '請在「' + BASICEX_CONFIG.reviewSheet + '」的「核准」欄對確認過的列打 V。',
      alreadyFilled.length ? '\n正式表已經有值、刻意不覆蓋的卡（要換成這次的內容，把核准欄改打「覆蓋」）：\n・' +
        alreadyFilled.join('、') : '',
      problems.length ? '\n問題：\n・' + problems.join('\n・') : ''
    ].filter(function (x) { return x; }).join('\n'));
    return;
  }

  const overwriteCount = plan.filter(function (p) { return p.diff; }).length;
  const preview = plan.slice(0, 12).map(function (p) {
    return '・' + p.id + '（' + p.count + ' 項）' + (p.diff ? '\n   ' + p.diff : '');
  }).join('\n');
  const answer = ui.alert('要寫回正式 Cards Data 嗎？',
    '將把 ' + plan.length + ' 張卡的一般消費排除項目寫進正式的「' + cardsSheet.getName() + '」。\n\n' +
    preview + (plan.length > 12 ? '\n…（其餘 ' + (plan.length - 12) + ' 張）' : '') +
    '\n\n只會寫 ' + BASICEX_CONFIG.targetHeader + ' 這一欄，其他欄位一格都不會動。' +
    (overwriteCount ? '\n⚠️ 其中 ' + overwriteCount + ' 張是「覆蓋」：正式表原本的名單會整格被換掉（版本紀錄可以救回）。' : ''),
    ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) { ui.alert('已取消，正式表沒有任何變動。'); return; }

  const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  let done = 0;
  plan.forEach(function (p) {
    basicExAssertCol_(cHead[cTarget]);   // 每一格寫入前最後一道確認
    cardsSheet.getRange(p.cardRow, cTarget + 1).setValue(p.value);
    // 寫成功才蓋章。沒蓋到＝沒寫成功，下次執行會重來
    p.reviewRows.forEach(function (rr) {
      review.getRange(rr, iApprove + 1).setValue(BASICEX_CONFIG.appliedMark + ' ' + stamp);
    });
    done++;
  });

  ui.alert([
    '完成：' + done + ' 張卡的 basicExclusions 已寫進正式 Cards Data。',
    alreadyFilled.length ? '\n正式表已有值、沒覆蓋：' + alreadyFilled.join('、') : '',
    problems.length ? '\n問題：\n・' + problems.join('\n・') : '',
    '\n👉 下一步：資料檔選單「🎯 卡片管理 → 匯出」，網站才會吃到新名單。',
    '   匯出後到網站搜「繳稅」之類的詞，確認排除的卡不再顯示基本回饋。'
  ].filter(function (x) { return x; }).join('\n'));
}

/************** 正式表已有名單的卡＋命名一致用的既有名稱表 **************/
// 跨檔唯讀正式 Cards Data 的 basicExclusions 欄。欄不存在就當作全部沒填（抽取照跑，寫回時才會要求建欄）
function basicExReadFilledCards_() {
  const out = { ids: {}, names: [] };
  const sheet = getCardsSheet_();
  const data = sheet.getDataRange().getValues();
  const head = data[0].map(function (x) { return String(x).trim(); });
  const cId = head.indexOf('id');
  const cT = head.indexOf(BASICEX_CONFIG.targetHeader);
  if (cId < 0 || cT < 0) return out;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][cId] || '').trim();
    const items = basicExSplit_(data[i][cT]);
    if (!id || items.length === 0) continue;
    out.ids[id] = true;
    items.forEach(function (t) { out.names.push(t); });
  }
  return out;
}

// 既有名稱表：正式表（站長核可過）→ 待審核表已核准的列 → 站長範例答案，先出現的寫法為準。
// byKey：正規化鑰匙 → 標準寫法，AI 回來的項目用它機械收斂
function basicExBuildVocabulary_(filled, review) {
  const vocab = { names: [], byKey: {} };
  const add = function (t) {
    const name = String(t || '').trim();
    const key = basicExNormKey_(name);
    if (name.length < 2 || !key || vocab.byKey[key]) return;
    vocab.byKey[key] = name;
    vocab.names.push(name);
  };
  filled.names.forEach(add);
  const last = review.getLastRow();
  if (last >= 2) {
    const iApprove = BASICEX_REVIEW_HEADERS.indexOf('核准');
    const iItems = BASICEX_REVIEW_HEADERS.indexOf('basicExclusions');
    review.getRange(2, 1, last - 1, BASICEX_REVIEW_HEADERS.length).getValues().forEach(function (r) {
      const mark = String(r[iApprove] == null ? '' : r[iApprove]).trim();
      if (basicExIsChecked_(r[iApprove]) || mark.indexOf(BASICEX_CONFIG.appliedMark) === 0) {
        basicExSplit_(r[iItems]).forEach(add);
      }
    });
  }
  BASICEX_EXAMPLES.forEach(function (ex) { ex.answer.forEach(add); });
  return vocab;
}

// 比對用鑰匙：全形轉半形、小寫、去空白與常見標點。只用來判斷「是不是同一個寫法」，不改變顯示
function basicExNormKey_(s) {
  return String(s || '')
    .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .toLowerCase()
    .replace(/[\s　()（）·・.\-_]/g, '');
}

/************** 小工具 **************/
function basicExSplit_(raw) {
  return String(raw == null ? '' : raw)
    .split(/[,，、\n]/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
}

// 「打勾了沒」：V／v／✓／✔／TRUE／1 都算；已經蓋過「已寫回」章的一律不算
function basicExIsChecked_(v) {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim();
  if (!s || s.indexOf(BASICEX_CONFIG.appliedMark) === 0) return false;
  return ['V', 'v', '✓', '✔', 'TRUE', 'true', '1', 'ｖ', 'Ｖ'].indexOf(s) >= 0;
}

// 核准欄打「覆蓋」＝要整格換掉正式表已有的名單
function basicExIsOverwrite_(v) {
  return String(v == null ? '' : v).trim() === '覆蓋';
}

// 寫入正式表前的最後一道鎖：目標欄名必須正好是 basicExclusions
function basicExAssertCol_(headerName) {
  if (String(headerName || '').trim() !== BASICEX_CONFIG.targetHeader) {
    throw new Error('安全檢查失敗：這支程式只允許寫入 ' + BASICEX_CONFIG.targetHeader +
      ' 欄，但拿到的欄名是「' + headerName + '」。已中止，正式表不會被改。');
  }
}
