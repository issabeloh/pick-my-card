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
 *   ・正式 Cards Data 已有名單的卡**照樣抽**（2026-10-12 站長要求移除「已有名單就跳過」；原本是為了不重抽手填的台新兩張），
 *     抽出來的列標黃並註明「要換就在核准欄打『覆蓋』」——打 V 只寫空白格，不會蓋掉
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
  // 2026-10-12 加「不列入」「非一般消費」：彰銀那列 keywords 填「不列入現金回饋」，裡面沒有連續的「不回饋」而被跳過
  rowKeywordRe: /一般消費|排除|不回饋|不計入|不列入|不適用回饋|非一般消費/,
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

// 不進「既有名稱表」的詞（2026-10-13）：這些詞的範圍各家不同，放進名稱表會讓 AI 依「跨行統一」把別家範圍較窄的
// 原文套成它們——凱基原文「交通罰款」就這樣被改寫成台新的「違規罰鍰」（範圍被放大）。AI 照樣可以依原文輸出它們。
// 基金類（2026-10-13）各家用詞範圍不同（基金扣繳／基金申購／代扣基金…），站長決定照各自原文，也不進名稱表
const BASICEX_NO_UNIFY_ITEMS = ['違規罰鍰', '電信費', '悠遊卡自動加值', '一卡通自動加值', 'icash卡自動加值', 'eTag自動儲值',
  '基金交易', '基金交易及其手續費', '基金扣繳'];

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
    '小額支付特約商店', '政府規費', '違規罰鍰', '交通罰款', '交通罰單', '停車罰單', '交通罰鍰',
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
  // 2026-10-13 站長手寫版：便利商店、E政府在原文是「各類繳稅費平台【…】」的列舉 → 只排除在那裡繳費繳稅，
  // 不是整個便利商店消費（不列四大超商）；代償、預借現金手續費照原文；加值沒寫「自動」→ 兩種都列
  answer: ['悠遊卡加值', '悠遊卡自動加值', 'eTag儲值', '代繳eTag智慧停車費', '信用卡年費', '公共事業費用', '水費', '電費', '瓦斯費',
    '中華電信電信費', '各項稅金代繳', '學費', '學雜費', '海外學校學雜費', '海外學校學費', '預借現金', '貸放本金及利息', '代償本金及利息',
    '各類稅款', '各項手續費', '信用卡掛失手續費', '調閱簽單手續費', '分期付款手續費', '預借現金手續費', '違約金', '循環利息', '爭議款',
    '各類繳稅費平台', '公務機關繳費平台', '醫療費用', '醫指付APP', '便利商店繳費繳稅', 'E政府平台繳費繳稅', 'eToro', '境外投資交易平臺']
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
  // 2026-10-12 改用正式表上 yushan-unicard 的現行名單（站長在 main 修過：去括號的全聯／PX Pay、7-11、補常用說法…）
  answer: [
    '英國實體消費', '奧地利實體消費', '比利時實體消費', '保加利亞實體消費', '克羅埃西亞實體消費', '賽普勒斯實體消費',
    '捷克實體消費', '丹麥實體消費', '愛沙尼亞實體消費', '芬蘭實體消費', '法國實體消費', '德國實體消費',
    '希臘實體消費', '匈牙利實體消費', '愛爾蘭實體消費', '義大利實體消費', '拉脫維亞實體消費', '立陶宛實體消費',
    '盧森堡實體消費', '馬爾他實體消費', '荷蘭實體消費', '波蘭實體消費', '葡萄牙實體消費', '羅馬尼亞實體消費',
    '斯洛伐克實體消費', '斯洛維尼亞實體消費', '西班牙實體消費', '瑞典實體消費', '基金扣繳', '證券代銷',
    '境外投資平台交易', 'eToro', 'MCO投資平台', '匯兌平台交易', 'wise', '旅行支票',
    '賭博籌碼', '數位貨幣', '虛擬貨幣', '玉山銀行分行通路之躉繳保費', '南山人壽躉繳保費', '三商美邦人壽投資型及躉繳型保單', '查核 (定) 稅款',
    '學費', 'i繳費平台', '學費通繳費平臺', '醫療費用', '政府規費', '全聯福利中心',
    '大全聯', 'PXGo! 全聯線上購', 'PX Pay', '便利商店', '7-11', '全家',
    '萊爾富', 'OK超商', '小額支付特約商店', '特約商店分期付款消費交易', '台灣電力公司', '電費',
    '台灣自來水公司', '台北自來水事業處', '水費', '瓦斯費', '各縣市路邊停車費', '路邊停車費',
    '中華電信及民營電信', '電信費', '合康領袖廳管理費', '醫指付APP', '電子化繳費稅處理平台', '公務機關信用卡繳費平台',
    'E政府服務平台', '儲值卡 (原電子票證) 儲值金 (含自動儲值)', '電子支付儲值金 (含自動儲值)', 'eTag自動儲值', 'eTag智慧停車費用', '各類預借現金',
    '預借現金', '餘額代償', '循環利息', '違約金', '信用卡年費', '各項手續費及代收費用',
    '繳納各項監理資費', '菸品'
  ]
};

// 2026-10-12 站長手寫的富邦 J 卡範例（片段）：支付工具不列、只限本商家的 PX Pay 才列、
// 集團旗下品牌展開、便利商店補四大超商、Google 類補 Google廣告
const BASICEX_EXAMPLE_FUBON = {
  card: 'fubon-jcard',
  source: '…便利商店消費(含綁定該便利商店各行動支付，如 icash Pay、全盈+Pay及LINE PAY等)、' +
    '全聯實業旗下品牌通路(如全聯福利中心、大全聯消費，包含線上購物和各種支付方式，如Px pay、全支付等)、' +
    'Google產品或服務(即消費明細含「Google」者，例如：Google Play、Google Drive...等)…',
  answer: ['便利商店', '7-11', '全家', '萊爾富', 'OK超商', '全聯福利中心', '大全聯', '全聯線上購物', '全聯全電商', '全聯小時達',
    'PX Pay', 'Google產品或服務', 'Google Play', 'Google Drive', 'Google廣告']
};

// prompt 依序放這四份；既有名稱表也從這四份的答案取種子
const BASICEX_EXAMPLES = [BASICEX_EXAMPLE, BASICEX_EXAMPLE_FEBANK, BASICEX_EXAMPLE_ESUN, BASICEX_EXAMPLE_FUBON];

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
  const doneAt = basicExReviewedUrls_(review);            // 網址 → { last: 最近一次抽取時間, cards: {card_id: true} }
  const changedAt = basicExMonitorChangedUrls_(ss);       // 網址 → 監控最近一次記錄變動的時間
  const filled = basicExReadFilledCards_();               // 正式表已經有名單的卡（照樣抽，只在待審核列上註明）
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

    // 抽過的頁：除非「超過 refreshAfterDays 天」且「監控在上次抽取後記錄過變動」，否則只補抽
    // 待審核表裡**還沒有列**的卡（2026-10-11 改成「網址＋卡片」判斷：站長刪掉 yushan-ubear 那一列後，
    // 同一頁其他卡的列還在，舊寫法以網址判斷就整頁跳過、永遠補不回來）
    let refresh = false;
    const done = doneAt[url];
    if (done && now - done.last >= refreshMs && changedAt[url] && changedAt[url] > done.last) refresh = true;

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

    // 要抽的卡＝待審核表裡還沒有這張卡＋這個網址的列（官網更新後重抽則全部候選卡）。
    // 正式表已有名單的卡照樣抽（2026-10-12 站長移除「已有名單就跳過」），列上會註明要換就打「覆蓋」
    const open = refresh || !done ? candidates : candidates.filter(function (x) { return !done.cards[x]; });
    if (open.length === 0) { alreadyDone++; continue; }

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
      ' 天且監控記錄過變動的頁才會重抽；要重抽某張卡，把待審核表裡那張卡的列刪掉，下次只補抽那張）' : '',
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
// 寫法規則＋站長範例（抽取與「官網變動分析」共用，2026-10-13 抽出來：兩邊用同一套規則，名單寫法才不會分岔）
function basicExRulesText_() {
  return [
    '寫法規則（2026-10-11／10-12 依站長修正的名單更新；最後有四份站長親手寫的範例，寫法以範例為準）：',
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
    '8b. 支付工具（2026-10-12 站長規則，見富邦 J 卡範例）：原文說「在被排除的商家用 icash Pay、全盈+Pay、LINE PAY 付款也不算」時，',
    '    排除的是那個商家，不是支付工具——**不要列支付工具**（列了會讓整個支付工具被誤判成沒回饋）。',
    '    但商家本身**沒有**整個被排除、只有「在該商家用某支付工具」才排除時（2026-10-13 站長規則），寫成「<商家>綁<工具>」，',
    '    每個工具一項。例：匯豐「便利商店自有支付如 iCash pay、FAMI PAY 綁本行卡於便利商店消費不回饋」→ 便利商店綁iCash pay、便利商店綁FAMI PAY。',
    '    只有兩種才列：①只能在被排除商家內使用的工具（PX Pay 只能在全聯體系用 → 列；全支付在別處也能用 → 不列）；',
    '    ②銀行明文把整個支付工具排除（例：「全支付交易」整個不回饋 → 列「全支付」）。列的時候去掉「交易」「儲值」尾綴。',
    '8c. 集團／旗下品牌要展開成各品牌：「全聯實業旗下品牌通路」→ 全聯福利中心、大全聯、全聯線上購物、全聯全電商、全聯小時達、PX Pay。',
    '    原文只點名某幾家時就只列那幾家，不要自行擴大。',
    '    全聯品牌一律帶「全聯」前綴：寫「全聯全電商」「全聯小時達」，不可寫成「全電商」「小時達」（2026-10-12 站長統一）。',
    '    原文排除「全聯福利中心」「PX Pay」「PXGo! 全聯線上購」任一項時，**一律再補「全聯小時達」「全聯全電商」**（2026-10-12 站長規則）：',
    '    兩者都是全聯線上購／PX Pay App 裡的服務，帳單特店名稱顯示為全聯福利中心、全聯線上購或 PXPay，銀行同樣判為排除。',
    '8d. 便利商店一律列「便利商店」加四大超商「7-11、全家、萊爾富、OK超商」（原文沒逐一點名也要列）。',
    '    例外（2026-10-13 站長規則，見遠東範例）：「便利商店」只出現在繳費／繳稅平台的列舉裡（例：「各類繳稅費平台【…醫指付APP、便利商店等…】」），',
    '    表示只有在便利商店**繳費繳稅**才排除，寫「便利商店繳費繳稅」，**不要**列「便利商店」和四大超商（在便利商店買東西仍有回饋）。',
    '    同理列舉裡的其他通路也加「繳費繳稅」（例：E政府平台繳費繳稅）。',
    '8f. 罰款類（2026-10-13 站長規則）：範圍各家不同，不可套用別家銀行的寫法。所有罰款類一律列這四個交通詞：',
    '    「交通罰款」「交通罰單」「停車罰單」「交通罰鍰」，再依原文加：',
    '    ①原文**只限交通**（交通罰款、交通違規罰鍰、交通罰鍰…）：只列上面四個，**不可寫「違規罰鍰」**（會把範圍放大成所有罰款），',
    '      原文本身也不另列（例：匯豐「交通違規罰鍰」→ 交通罰款、交通罰單、停車罰單、交通罰鍰，不列「交通違規罰鍰」）。',
    '    ②原文是**不限交通的泛稱**（違規罰鍰、罰款、罰鍰…）：再加「違規罰鍰」；原文同時有規費時再加「政府規費」。',
    '      例：台新「規費、罰鍰：政府規費、違規罰鍰」→ 政府規費、違規罰鍰、交通罰款、交通罰單、停車罰單、交通罰鍰。',
    '    ③原文寫「政府機關（之違規）罰款」：再加「政府罰款」。',
    '    ④原文有上面沒涵蓋的特殊寫法（例：「裁決所違規罰款」）：照原文再列一項。',
    '    ⑤原文沒寫罰款，但排除「公務機關各項費用／公務機關費用／公務機關之相關費用」（2026-10-13 站長規則）：',
    '      交通罰款也是繳給公務機關的費用，一律補「交通罰款」「交通罰單」「停車罰單」「交通罰鍰」（只是繳費平台的不算）。',
    '8g. 電信費（2026-10-13 站長規則）：原文只寫中華電信（中華電信費用、中華電信資費、中華電信話費）時寫「中華電信電信費」，',
    '    **不可寫成「電信費」**（民營電信不在內）。只有原文泛指所有電信（電信費、各項電信資費、中華電信及民營電信）才列「電信費」。',
    '8h. 加值／儲值（2026-10-13）：原文**沒寫「自動」**（悠遊卡加值、一卡通加值金、儲值卡儲值金…）表示所有加值都排除，',
    '    要同時列「悠遊卡加值」「悠遊卡自動加值」兩種寫法（一卡通、icash卡同理），因為搜尋時兩者互不包含；',
    '    原文寫「自動加值」時只列「X自動加值」。eTag 同理：原文「eTag儲值」列「eTag儲值」「eTag自動儲值」，原文「eTag自動儲值」只列後者。',
    '8k. 廣告（2026-10-13 站長規則）：照原文列之外，再補「Meta廣告」「Google廣告」：',
    '    原文有 Facebook、Meta、Meta Ads、Facebook Ads → 補「Meta廣告」；原文有 Google產品或服務 → 補「Google廣告」（同 8e）；',
    '    原文有「廣告費」→ 列「廣告費」「Meta廣告」「Google廣告」三項；原文有「MCC 7311（廣告服務）」→ 「Meta廣告」「Google廣告」兩項都補。',
    '8i. 基金類（2026-10-13 站長規則）：**照各家原文**，不跨行統一（範圍不同）。例：玉山「基金扣繳」、聯邦「基金申購」、',
    '    「代扣基金」「基金扣款」「信用卡申購基金」照原文列；不可改寫成「基金交易」。',
    '    原文結構是「A、A及其手續費」時只寫「A及其手續費」（例：星展「基金交易、基金交易及其手續費」→ 只列「基金交易及其手續費」）。',
    '8j. 小額支付特約商店（2026-10-13 站長規則）：「透過聯合信用卡處理中心小額支付平台之特約商店（如停車場、速食店…）」',
    '    一律寫「小額支付特約商店」（不寫「小額支付平台」），**括號裡的例子不列**——只有經過該平台的交易才排除，同一商家走一般收單仍有回饋，',
    '    列了會讓搜尋停車場、麥當勞直接變灰卡。原文明說「不論付款方式，該類商家一律排除」時才照原文列商家。',
    '8e. 固定寫法（跨行統一）：Google產品或服務、Apple媒體服務（中英文之間不加空格）；Google 類再補「Google廣告」；',
    '    原文寫「學雜費」時列「學費、學雜費」兩項（用戶多半只打「學費」）；',
    '    連鎖速食店→速食店；退貨→退款；PXGo!全聯線上購一律寫「PXGo! 全聯線上購」（驚嘆號後加一個空格）。',
    '    原文是「數位（虛擬）貨幣」時拆成「數位貨幣」「虛擬貨幣」兩項（用戶只會打其中一種，括號寫法兩種都搜不到）。',
    '    其他括號一律半形加空格（例：查核 (定) 稅款）。',
    '    公路養管費一律寫「公路養管費(原燃料費)」一項（2026-10-13 站長統一）：原文寫公路養管費、燃料費、汽燃費、汽車燃料使用費、',
    '    公路使用養護安全管理費、汽機車燃料費時都寫這個，不另列「公路養管費」「燃料費」。',
    '    公路養管費屬於政府規費、公務機關費用、監理資費（2026-10-13 站長規則）：原文排除「政府規費／各項規費」、',
    '    「公務機關各項費用／公務機關費用／公務機關之相關費用」或「監理資費／監理規費資費／公路監理資費」時，',
    '    **一律再補「公路養管費(原燃料費)」**（原文沒點名也要補）。',
    '    「公務機關各項費用」「公務機關費用」照原文列，**不要**改寫成「公務機關繳費」（例：國泰原文「公務機關各項費用」）。',
    '    只是繳費管道的（公務機關信用卡繳費平台、E政府服務平台）不算，不要因此補。',
    '    項目內不可出現「、」「，」「,」（會被當成分隔符拆開），原文括號裡的列舉改用空格隔開。',
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
}

function basicExAskGemini_(bank, text, candidates, vocab) {
  const systemPrompt = [
    '你是台灣信用卡條款的閱讀助理。輸入是某銀行信用卡官網頁面的純文字（可能含選單等雜訊）。',
    '任務：找出「不列入一般消費／不給任何刷卡回饋」的項目（常見標題：一般消費定義、不回饋消費項目、',
    '一般消費不包含、排除項目），整理成比價網站用的名單：使用者在搜尋框輸入名單上的字時，網站會告訴他「刷這張卡沒有回饋」。',
    '',
  ].join('\n') + '\n' + basicExRulesText_();

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
  // 正式表已有名單的卡：打 V 不會蓋掉，要換就在核准欄打「覆蓋」
  const refreshNote = function (id) {
    if (!page.filledIds || !page.filledIds[id]) return '';
    return (page.refresh ? '【官網更新後重抽】' : '') +
      '正式表已有名單。跟正式表比對後，要換成這次的內容就在核准欄打「覆蓋」（打 V 不會蓋掉）。';
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
  // 只檢查程式會寫的前 N 欄（A～H）。2026-10-11 修：原本拿整個第一列比對，而 getLastColumn() 是
  // 「整張分頁」最右邊有內容的欄——只要任何一列在 H 欄右邊有東西（站長筆記、殘留的格子），第一列就會
  // 多出空白欄、整串比對失敗，明明 A～H 表頭完全正確也擋下來。右邊多的欄位程式不碰，不必擋
  const n = BASICEX_REVIEW_HEADERS.length;
  const cur = sheet.getRange(1, 1, 1, n).getValues()[0].map(function (x) { return String(x).trim(); });
  const bad = [];
  for (let k = 0; k < n; k++) {
    if (cur[k] !== BASICEX_REVIEW_HEADERS[k]) {
      bad.push(String.fromCharCode(65 + k) + ' 欄應為「' + BASICEX_REVIEW_HEADERS[k] + '」，現在是「' + cur[k] + '」');
    }
  }
  if (bad.length) {
    throw new Error('「' + BASICEX_CONFIG.reviewSheet + '」的表頭跟程式預期不同（欄位是依位置寫入的）：' + bad.join('；') +
      '。請把表頭改回來（A～H 不要增刪或搬動；H 欄右邊可以自由加欄），或把整個分頁刪掉讓它重建。');
  }
  return sheet;
}

// 網址 → { last: 最近一次抽取時間（「解析時間」欄；讀不到日期的列當成很久以前）, cards: 待審核表裡已有列的 card_id }
function basicExReviewedUrls_(sheet) {
  const map = {};
  const last = sheet.getLastRow();
  if (last < 2) return map;
  const iTime = BASICEX_REVIEW_HEADERS.indexOf('解析時間');
  const iUrl = BASICEX_REVIEW_HEADERS.indexOf('來源網址');
  const iId = BASICEX_REVIEW_HEADERS.indexOf('card_id');
  sheet.getRange(2, 1, last - 1, BASICEX_REVIEW_HEADERS.length).getValues().forEach(function (r) {
    const u = String(r[iUrl] || '').trim();
    if (!u) return;
    let t = r[iTime] instanceof Date ? r[iTime] : new Date(r[iTime]);
    if (isNaN(t.getTime())) t = new Date(0);
    if (!map[u]) map[u] = { last: t, cards: {} };
    if (t > map[u].last) map[u].last = t;
    const id = String(r[iId] || '').trim();
    if (id) map[u].cards[id] = true;
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
  const iQuestion = BASICEX_REVIEW_HEADERS.indexOf('AI想問的問題');

  // 同一張卡可能有多列打 V（例如兩個頁面都列了它）→ 合併去重。
  // 「覆蓋」（2026-10-11）：核准欄打「覆蓋」＝這張卡正式表已有名單、要整格換成這次的內容（官網改版時用）。
  // 同一張卡只要有一列打「覆蓋」，整張卡就走覆蓋。
  const byCard = {};      // id → { items: [], reviewRows: [], overwrite }
  for (let i = 1; i < rData.length; i++) {
    const overwrite = basicExIsOverwrite_(rData[i][iApprove]);
    if (!overwrite && !basicExIsChecked_(rData[i][iApprove])) continue;
    const id = String(rData[i][iId] || '').trim();
    if (!id) continue;
    if (!byCard[id]) byCard[id] = { items: [], reviewRows: [], overwrite: false, renames: [] };
    if (overwrite) byCard[id].overwrite = true;
    byCard[id].reviewRows.push(i + 1);
    String(rData[i][iQuestion] || '').split('\n').forEach(function (line) {
      const m = line.trim().match(/^✎\s*改寫\s*[:：]\s*(.+?)\s*(?:→|->)\s*(.+)$/);
      if (m) byCard[id].renames.push({ from: m[1].trim(), to: m[2].split(/[、,，]/).map(function (x) { return x.trim(); }).filter(function (x) { return x; }) });
    });
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
      let added = entry.items.filter(function (t) { return oldItems.indexOf(t) < 0; });
      let removed = oldItems.filter(function (t) { return entry.items.indexOf(t) < 0; });
      // 改寫（2026-10-13）：「套用修改到待審核」會在 AI想問的問題 欄記下「✎ 改寫：A → B」，
      // 這裡把對得上的一增一減合併成「A → B」，站長才看得出是改寫不是刪一項又加一項
      const renamed = [];
      entry.renames.forEach(function (rn) {
        if (removed.indexOf(rn.from) < 0) return;
        const to = rn.to.filter(function (t) { return added.indexOf(t) >= 0; });
        if (!to.length) return;
        renamed.push(rn.from + ' → ' + to.join('、'));
        removed = removed.filter(function (t) { return t !== rn.from; });
        added = added.filter(function (t) { return to.indexOf(t) < 0; });
      });
      diff = '覆蓋：+' + added.length + ' 項、−' + removed.length + ' 項' + (renamed.length ? '、改 ' + renamed.length + ' 項' : '') +
        (added.length ? '\n      新增：' + added.slice(0, 8).join('、') + (added.length > 8 ? '…' : '') : '') +
        (removed.length ? '\n      移除：' + removed.slice(0, 8).join('、') + (removed.length > 8 ? '…' : '') : '') +
        (renamed.length ? '\n      改：' + renamed.slice(0, 8).join('；') + (renamed.length > 8 ? '…' : '') : '');
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

/************** ③ 官網變動 → 逐項修改（2026-10-13 站長流程） **************/
// 流程（站長定版的流程圖「一般消費排除：官網變動 → 網站上線」）：
//   1 每週監控（watchlist-monitor.gs）抓到「一般消費／排除頁」有變動
//     → 當場呼叫 basicExAnalyzeChange_，結果寫進「2-變動通知」同一列的「一般消費排除修改」欄、信裡也附一份
//   2 站長看信判斷要不要更新
//   3 在 2-變動通知 刪掉不要的行、改用詞，「一般消費排除確認」欄填 V
//   4 選單「一般消費排除：套用修改到待審核」（applyBasicExclusionChanges）
//     → 以**正式表現有名單**為底，只做留下來的那幾行，寫進 5-待審核 的 basicExclusions、核准欄標「覆蓋」
//   5 選單「一般消費排除 2」寫回正式表（確認視窗會把改寫列成 A → B）
// 為什麼不整份重抽：重抽是照規則從頭寫，會把站長手改過的地方洗掉。這條路只改官網真的動到的那幾項。
// 沒有 30 天門檻（站長 2026-10-13 決定）：只在官網真的有變動時才分析，而且只提修改、不動任何名單。
// 「① 抽取」的整份重抽與 30 天規則保留，給新卡、新頁面、大改版用。

const BASICEX_CHANGE_COL = '一般消費排除修改';
const BASICEX_CHANGE_OK_COL = '一般消費排除確認';
const BASICEX_CHANGE_PENDING = '⏳ 待分析';      // 監控那一段時間不夠時先寫這個，之後補分析
const BASICEX_CHANGE_APPLIED = '已套用';
const BASICEX_INBOX_SHEET = '2-變動通知';

// 這一列監控是不是一般消費／排除頁（跟「① 抽取」挑頁的規則一樣，看 keywords 欄）
function basicExIsExclusionRow_(keywords) {
  return BASICEX_CONFIG.rowKeywordRe.test(String(keywords == null ? '' : keywords));
}

// 正式 Cards Data 目前的名單：id → 那一格的原文（沒有欄或沒有這張卡就沒有 key）
function basicExReadCardLists_(ids) {
  const out = {};
  const sheet = getCardsSheet_();
  const data = sheet.getDataRange().getValues();
  const head = data[0].map(function (x) { return String(x).trim(); });
  const cId = head.indexOf('id');
  const cT = head.indexOf(BASICEX_CONFIG.targetHeader);
  if (cId < 0 || cT < 0) return out;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][cId] || '').trim();
    if (!id || (ids && ids.indexOf(id) < 0) || Object.prototype.hasOwnProperty.call(out, id)) continue;
    out[id] = String(data[i][cT] == null ? '' : data[i][cT]);
  }
  return out;
}

// 問 Gemini：這次變動會讓每張卡的名單改哪幾項。回傳要寫進「一般消費排除修改」欄的文字。
// diffText＝監控的變動段落（＋ 開頭＝新版多的句子，－ 開頭＝新版沒了的句子）
function basicExAnalyzeChange_(bank, cardIdsRaw, diffText) {
  const wanted = basicExSplit_(cardIdsRaw);
  const lists = basicExReadCardLists_(wanted);
  const ids = wanted.filter(function (x) { return Object.prototype.hasOwnProperty.call(lists, x); });
  if (!ids.length) return '⚠ 這列的 card_id 在正式表找不到，無法分析（到「1-監控清單」檢查 cards 欄）';

  const systemPrompt = [
    '你是台灣信用卡條款的閱讀助理。某銀行官網的「一般消費排除／不回饋項目」頁面有變動。',
    '輸入：① 這次變動的原文段落（「＋」開頭＝新版多出來的句子，「－」開頭＝舊版有、新版沒了的句子）；',
    '② 每張候選卡**目前的正式名單**（逗號分隔，站長已審核過）。',
    '任務：判斷這次變動會讓名單**改哪幾項**。不要重寫整份名單，沒被這次變動影響的項目一律不提。',
    '・add＝新增項目；remove＝刪除項目；rename＝把名單裡某一項換成新寫法（to 可以有一或多項）。',
    '・remove 與 rename 的 item 必須**逐字照抄名單裡現有的寫法**（程式靠它找到那一項，抄錯就找不到）。',
    '・新增或改寫後的寫法，照下面的寫法規則（拆例子、補常用說法、跨行統一、罰款／電信費／加值等固定寫法）。',
    '・只是文字潤飾、段落搬移、或變動跟排除項目無關（活動、選單、注意事項）→ no_effect=true、groups 回空陣列。',
    '・整頁改版、牽涉超過名單一半的項目 → major=true（站長會改用整份重抽），groups 可以回空陣列。',
    '・不同卡受影響的方式不同就分成多個 group，card_ids 只能從候選清單挑。',
    '・每一項附 evidence：原文依據的摘錄（30 字以內）。',
    ''
  ].join('\n') + '\n' + basicExRulesText_();

  const schema = {
    type: 'OBJECT',
    properties: {
      no_effect: { type: 'BOOLEAN' },
      major: { type: 'BOOLEAN' },
      groups: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            card_ids: { type: 'ARRAY', items: { type: 'STRING', enum: ids } },
            ops: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  op: { type: 'STRING', enum: ['add', 'remove', 'rename'] },
                  item: { type: 'STRING' },
                  to: { type: 'ARRAY', items: { type: 'STRING' } },
                  evidence: { type: 'STRING' }
                },
                required: ['op', 'item']
              }
            }
          },
          required: ['card_ids', 'ops']
        }
      },
      note: { type: 'STRING' }
    },
    required: ['no_effect', 'major', 'groups']
  };

  const userText = '銀行：' + (bank || '（未填）') + '\n\n各卡目前的正式名單：\n' +
    ids.map(function (id) { return id + '：' + (lists[id] || '（空白）'); }).join('\n') +
    '\n\n這次變動的原文段落：\n' + String(diffText || '').slice(0, 8000);
  const result = callGemini_(systemPrompt, userText, schema) || {};
  return basicExRenderChange_(result, ids, lists);
}

// AI 結果 → 儲存格文字。格式也是站長要編輯的介面（刪行、改詞），所以一行一個動作：
//   ▸ card-a, card-b
//   ＋ 新增：X｜原文：…
//   － 刪除：Y｜原文：…
//   ✎ 改寫：A → B、C｜原文：…
// 「｜」後面只是給人看的依據，套用時會被忽略
function basicExRenderChange_(result, ids, lists) {
  const clean = function (t) { return String(t || '').trim().replace(/[,，｜\n]/g, ' ').trim(); };
  const lines = [];
  const groups = (result.groups || []).filter(function (g) { return g && g.ops && g.ops.length; });
  if (result.major) lines.push('⚠ 大改版，建議整份重抽：選單「一般消費排除 1」');
  groups.forEach(function (g) {
    const gIds = (g.card_ids || []).filter(function (x) { return ids.indexOf(x) >= 0; });
    if (!gIds.length) return;
    lines.push('▸ ' + gIds.join(', '));
    g.ops.forEach(function (o) {
      const item = clean(o.item);
      if (!item) return;
      const ev = o.evidence ? '｜原文：' + clean(o.evidence).slice(0, 60) : '';
      // remove／rename 的舊項目在名單裡找不到 → 先標出來，站長改字或刪行（套用時也會再擋一次）
      const missing = (o.op === 'remove' || o.op === 'rename') && gIds.some(function (id) {
        return basicExSplit_(lists[id]).indexOf(item) < 0;
      }) ? '｜⚠ 名單裡找不到這項' : '';
      if (o.op === 'add') lines.push('＋ 新增：' + item + ev);
      else if (o.op === 'remove') lines.push('－ 刪除：' + item + ev + missing);
      else if (o.op === 'rename') {
        const to = (o.to || []).map(clean).filter(function (x) { return x; });
        if (to.length) lines.push('✎ 改寫：' + item + ' → ' + to.join('、') + ev + missing);
      }
    });
  });
  if (!lines.length) return '無影響（只是文字潤飾，或跟排除項目無關）';
  if (result.note) lines.push('（AI 備註：' + clean(result.note).slice(0, 200) + '）');
  return lines.join('\n');
}

// 監控呼叫用：失敗不擋監控，改寫成「待分析」讓之後補
function basicExAnalyzeChangeSafe_(bank, cardIdsRaw, diffText) {
  try {
    return basicExAnalyzeChange_(bank, cardIdsRaw, diffText);
  } catch (e) {
    return BASICEX_CHANGE_PENDING + '（上次失敗：' + String(e.message || e).slice(0, 120) + '）';
  }
}

// 補分析「2-變動通知」裡標「⏳ 待分析」的列。監控每一段結尾有剩時間就會叫它；也可以從選單手動按。
// 回傳 { done, left }
function basicExAnalyzePendingChanges_(ss, startedAt, limitSeconds) {
  const sheet = ss.getSheetByName(BASICEX_INBOX_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { done: 0, left: 0 };
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
  const cChange = head.indexOf(BASICEX_CHANGE_COL), cCard = head.indexOf('card_id');
  const cBank = head.indexOf('銀行'), cDiff = head.indexOf('變動段落');
  if (cChange < 0 || cCard < 0 || cDiff < 0) return { done: 0, left: 0 };
  const n = sheet.getLastRow() - 1;
  const col = function (c) { return c < 0 ? null : sheet.getRange(2, c + 1, n, 1).getValues(); };
  const changes = col(cChange);
  const todo = [];
  changes.forEach(function (r, i) { if (String(r[0]).indexOf(BASICEX_CHANGE_PENDING) === 0) todo.push(i); });
  if (!todo.length) return { done: 0, left: 0 };
  const cards = col(cCard), banks = col(cBank), diffs = col(cDiff);
  let done = 0;
  for (let k = 0; k < todo.length; k++) {
    if ((Date.now() - startedAt) / 1000 > limitSeconds) break;
    const i = todo[k];
    const text = basicExAnalyzeChangeSafe_(banks ? banks[i][0] : '', cards[i][0], diffs[i][0]);
    sheet.getRange(i + 2, cChange + 1).setValue(text);
    done++;
  }
  return { done: done, left: todo.length - done };
}

// 選單：手動補分析
function analyzePendingBasicExclusionChanges() {
  const ui = SpreadsheetApp.getUi();
  const res = basicExAnalyzePendingChanges_(SpreadsheetApp.getActiveSpreadsheet(), Date.now(), BASICEX_CONFIG.maxRunSeconds);
  ui.alert(res.done || res.left
    ? '補分析完成 ' + res.done + ' 列' + (res.left ? '，還剩 ' + res.left + ' 列（時間不夠，再按一次）' : '') + '。'
    : '「' + BASICEX_INBOX_SHEET + '」沒有待分析的列。');
}

// 一格「一般消費排除修改」→ [{ ids, kind, item, to, line }]；看不懂的行放 bad
function basicExParseChangeCell_(text) {
  const ops = [], bad = [];
  let cur = [];
  String(text == null ? '' : text).split('\n').forEach(function (raw) {
    const line = raw.trim();
    if (!line) return;
    if (/^[▸>]/.test(line)) { cur = basicExSplit_(line.replace(/^[▸>]\s*/, '')); return; }
    // 說明行：大改版提醒、無影響、AI 備註
    if (/^(⚠|無影響|（AI 備註|\(AI 備註|⏳)/.test(line)) return;
    const body = line.split('｜')[0].trim();
    const m = body.match(/^([＋+－\-✎])\s*(?:新增|刪除|改寫)?\s*[:：]?\s*(.+)$/);
    if (!m || !cur.length) { bad.push(line); return; }
    const sym = m[1], rest = m[2].trim();
    if (sym === '✎') {
      const parts = rest.split(/\s*(?:→|->)\s*/);
      const to = parts.length === 2 ? parts[1].split(/[、,，]/).map(function (x) { return x.trim(); }).filter(function (x) { return x; }) : [];
      if (parts.length !== 2 || !parts[0] || !to.length) { bad.push(line); return; }
      ops.push({ ids: cur.slice(), kind: 'rename', item: parts[0].trim(), to: to, line: body });
    } else {
      if (/[,，、]/.test(rest)) { bad.push(line); return; }   // 一行只能一項（逗號會被當成分隔符）
      ops.push({ ids: cur.slice(), kind: (sym === '＋' || sym === '+') ? 'add' : 'remove', item: rest, line: body });
    }
  });
  return { ops: ops, bad: bad };
}

// 在一格名單上做一個動作。以半形逗號切開、每段原樣保留（含空白與結尾逗號），只動對到的那一段。
// 回傳 { value, ok, note }
function basicExApplyOp_(raw, op) {
  const parts = String(raw == null ? '' : raw).split(',');
  const find = function (item) {
    for (let i = 0; i < parts.length; i++) if (parts[i].trim() === item) return i;
    return -1;
  };
  // 新項目接在最後一個非空段後面（保留原本的結尾逗號）
  const insertAt = function () {
    let i = parts.length;
    while (i > 0 && !parts[i - 1].trim()) i--;
    return i;
  };
  if (op.kind === 'add') {
    if (find(op.item) >= 0) return { value: raw, ok: true, note: '已經有「' + op.item + '」' };
    if (parts.length === 1 && !parts[0].trim()) return { value: op.item, ok: true };
    parts.splice(insertAt(), 0, op.item);
    return { value: parts.join(','), ok: true };
  }
  const i = find(op.item);
  if (i < 0) return { value: raw, ok: false, note: '名單裡找不到「' + op.item + '」' };
  if (op.kind === 'remove') {
    parts.splice(i, 1);
    return { value: parts.join(','), ok: true };
  }
  const fresh = op.to.filter(function (t) { return t === op.item || find(t) < 0; });
  if (!fresh.length) { parts.splice(i, 1); return { value: parts.join(','), ok: true }; }
  parts[i] = parts[i].replace(op.item, fresh[0]);
  fresh.slice(1).forEach(function (t, k) { parts.splice(i + 1 + k, 0, t); });
  return { value: parts.join(','), ok: true };
}

// 選單「一般消費排除：套用修改到待審核」
function applyBasicExclusionChanges() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inbox = ss.getSheetByName(BASICEX_INBOX_SHEET);
  if (!inbox || inbox.getLastRow() < 2) { ui.alert('找不到「' + BASICEX_INBOX_SHEET + '」或裡面沒有資料。'); return; }
  const head = inbox.getRange(1, 1, 1, inbox.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
  const cChange = head.indexOf(BASICEX_CHANGE_COL), cOk = head.indexOf(BASICEX_CHANGE_OK_COL);
  const cUrl = head.indexOf('網址'), cBank = head.indexOf('銀行');
  if (cChange < 0 || cOk < 0) {
    ui.alert('「' + BASICEX_INBOX_SHEET + '」還沒有「' + BASICEX_CHANGE_COL + '」「' + BASICEX_CHANGE_OK_COL + '」欄。\n' +
      '下次監控偵測到一般消費頁變動時會自動補上。');
    return;
  }
  // 只讀要用的欄（這張表有「舊文字／新文字」兩根 4 萬字的欄，整張讀很慢）
  const n = inbox.getLastRow() - 1;
  const col = function (c) { return c < 0 ? null : inbox.getRange(2, c + 1, n, 1).getValues(); };
  const oks = col(cOk), changes = col(cChange), urls = col(cUrl), banks = col(cBank);

  const picked = [];
  for (let i = 0; i < n; i++) if (basicExIsChecked_(oks[i][0])) picked.push(i);
  if (!picked.length) {
    ui.alert('「' + BASICEX_INBOX_SHEET + '」沒有在「' + BASICEX_CHANGE_OK_COL + '」欄填 V 的列。');
    return;
  }

  // 以正式表現有名單為底，依列序把每一行套上去
  const allIds = [];
  const parsed = picked.map(function (i) {
    const p = basicExParseChangeCell_(changes[i][0]);
    p.ops.forEach(function (o) { o.ids.forEach(function (id) { if (allIds.indexOf(id) < 0) allIds.push(id); }); });
    return { i: i, p: p };
  });
  const lists = basicExReadCardLists_(allIds);
  const value = {}, applied = {}, meta = {};
  const problems = [];
  parsed.forEach(function (x) {
    const rowNo = x.i + 2;
    x.p.bad.forEach(function (l) { problems.push('第 ' + rowNo + ' 列看不懂：' + l); });
    x.p.ops.forEach(function (o) {
      o.ids.forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(lists, id)) { problems.push('第 ' + rowNo + ' 列：正式表找不到卡片 ' + id); return; }
        if (!Object.prototype.hasOwnProperty.call(value, id)) { value[id] = lists[id]; applied[id] = []; }
        const r = basicExApplyOp_(value[id], o);
        if (!r.ok) { problems.push('第 ' + rowNo + ' 列 ' + id + '：' + r.note + '（' + o.line + '）'); return; }
        value[id] = r.value;
        applied[id].push(o.line);
        meta[id] = { url: urls ? String(urls[x.i][0] || '') : '', bank: banks ? String(banks[x.i][0] || '') : '' };
      });
    });
  });

  const changedIds = Object.keys(value).filter(function (id) { return value[id] !== lists[id]; });
  if (problems.length) {
    const ans = ui.alert('有 ' + problems.length + ' 行沒辦法照做',
      '・' + problems.slice(0, 25).join('\n・') + (problems.length > 25 ? '\n…（其餘 ' + (problems.length - 25) + ' 行）' : '') +
      '\n\n' + (changedIds.length
        ? '其他能照做的修改（' + changedIds.length + ' 張卡）要先寫進「' + BASICEX_CONFIG.reviewSheet + '」嗎？\n按取消＝全部不動，改好再按一次。'
        : '沒有其他可以照做的修改。'),
      changedIds.length ? ui.ButtonSet.OK_CANCEL : ui.ButtonSet.OK);
    if (!changedIds.length || ans !== ui.Button.OK) return;
  }

  // 寫進 5-待審核：同一張卡優先寫回同網址那一列，沒有就寫第一列，都沒有就新增一列
  const review = basicExEnsureReviewSheet_(ss);
  const rData = review.getDataRange().getValues();
  const iApprove = BASICEX_REVIEW_HEADERS.indexOf('核准'), iTime = BASICEX_REVIEW_HEADERS.indexOf('解析時間');
  const iId = BASICEX_REVIEW_HEADERS.indexOf('card_id'), iUrl = BASICEX_REVIEW_HEADERS.indexOf('來源網址');
  const iItems = BASICEX_REVIEW_HEADERS.indexOf('basicExclusions'), iQ = BASICEX_REVIEW_HEADERS.indexOf('AI想問的問題');
  const now = new Date();
  const stamp = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  changedIds.forEach(function (id) {
    const note = '【官網變動套用 ' + stamp + '】\n' + applied[id].join('\n');
    let r = -1;
    for (let i = 1; i < rData.length; i++) {
      if (String(rData[i][iId]).trim() !== id) continue;
      if (r < 0) r = i;
      if (String(rData[i][iUrl]).trim() === meta[id].url) { r = i; break; }
    }
    if (r < 0) {
      const row = BASICEX_REVIEW_HEADERS.map(function () { return ''; });
      row[iApprove] = '覆蓋'; row[iTime] = now; row[iId] = id; row[BASICEX_REVIEW_HEADERS.indexOf('bank')] = meta[id].bank;
      row[iUrl] = meta[id].url; row[iItems] = value[id]; row[iQ] = note;
      review.appendRow(row);
      return;
    }
    const sheetRow = r + 1;
    review.getRange(sheetRow, iItems + 1).setValue(value[id]);
    review.getRange(sheetRow, iQ + 1).setValue(note);
    review.getRange(sheetRow, iTime + 1).setValue(now);
    review.getRange(sheetRow, iApprove + 1).setValue('覆蓋');
  });

  // 變動通知那邊標「已套用」，下次不會重複套
  const skippedRows = {};
  problems.forEach(function (p) { const m = p.match(/^第 (\d+) 列/); if (m) skippedRows[m[1]] = (skippedRows[m[1]] || 0) + 1; });
  picked.forEach(function (i) {
    const k = skippedRows[String(i + 2)];
    inbox.getRange(i + 2, cOk + 1).setValue(BASICEX_CHANGE_APPLIED + ' ' + stamp + (k ? '（跳過 ' + k + ' 行）' : ''));
  });

  // 全部照做時不跳視窗（站長要求），右下角小提示就好
  ss.toast(changedIds.length
    ? '已寫進「' + BASICEX_CONFIG.reviewSheet + '」' + changedIds.length + ' 張卡，核准欄標「覆蓋」。下一步：「一般消費排除 2」寫回正式表。'
    : '打 V 的修改都不用改（名單已經是這樣了）。', '一般消費排除', 8);
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
    if (name.length < 2 || !key || vocab.byKey[key] || BASICEX_NO_UNIFY_ITEMS.indexOf(name) >= 0) return;
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
