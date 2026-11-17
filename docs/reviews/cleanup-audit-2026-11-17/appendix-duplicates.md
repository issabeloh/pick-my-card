> 原始稽核報告（subagent 產出，2026-11-17）。主報告 `../cleanup-audit-2026-11-17.md` 已複核其中的重點項目；本檔其餘內容**未逐條複核**，動手前請先用 Grep 重新確認。行號是當日快照。

# 重複邏輯稽核（唯讀；2026-11-17）
方法：函式名/本體 hash（scratchpad/fn.py）、滑動視窗 N 行比對（win.py，N=5/6/8）、CSS 規則解析（css.py），再人工複核。
排序：A=已不一致 > B=高機率改一漏一 > C=純冗餘。風險＝合併風險。

## A. 已經不一致
A1. 回歸測試的 Firebase stub（三份＋共用版）全部缺 analytics.setUserProperties
  - 位置：run-regression.js:101-139(firebaseStub，被 card-detail/basic-exclusions/merchant-suggest/search-compare 共用)、mappings-page-test.js:37-76(stub)、delete-account-test.js:30-72(stub)
  - index.html:1329 import { getAnalytics, logEvent, setUserProperties }；四份 analytics stub 皆只 export getAnalytics/logEvent → ES module 具名 export 缺 → 整支 Firebase module 失敗 → window.db/firebaseAuth 不存在。
  - 為何只有登入型測試紅：run-regression 系是訪客流程，沒 Firebase 照跑（綠燈是假安心，Firebase 路徑其實沒被載入）；mappings-page-test 與 delete-account-test 要 window.firebaseAuth → 都紅。我實跑 delete-account-test：newPage waitForFunction 30s timeout（同一病因）。所以紅的是兩支，不是一支。
  - 三份差異：auth 區 mappings 版有 USER/guest 開關＋LEVELS＋cloudMappings/limits 於 getDoc；delete 版有 provider 參數＋__calls/__deleted 記錄、deleteField 回 0（mappings 版回 {__deleteField}）；run-regression 版 onAuthStateChanged 固定 cb(null)、getDoc 固定不存在。firestore/storage 的 export 清單三份目前一致。
  - 另：freezeClockScript 在 mappings-page-test.js:84 又複製一份壓縮版（run-regression.js:146 已 export 卻沒用）；startServer/MIME 在 delete-account-test.js:28/75、mappings-page-test.js:27/105 各自複製（run-regression.js:57/80 有 export startServer）；playwright require 與 chromium launch 樣板在 9 支各寫一次，delete/mappings 還寫死 executablePath（其餘有 existsSync 判斷）。
  - 建議：值得合併。抽 tools/lib/test-harness.js（firebaseStub(opts:{user,providerId,levels,docs,record})、freezeClockScript、startServer、launchBrowser）。stub 設計成「基底＋覆寫」，並用 index.html 的 import 清單機械產生 export（或加一支檢查：stub export ⊇ index.html import）。風險：低-中（只動測試，但需讓四支測試都重跑綠）。優先級最高，因為現在回歸網其實部分失明。

A2. calculateCardCashback 兩大分支對 cap 處理不一致
  - js/cashback-engine.js:971-1169(hasLevels && specialItems 分支) vs 1170-1262(其他卡分支)。cashbackRates 配對迴圈約 60 行幾乎逐行相同（1049-1085 vs 1218-1255）。
  - 差異：(1) 分支一用 `applicableCap = rateGroup.cap`，不呼叫 parseCashbackCap；分支二(1227)有 parseCashbackCap。cap 若寫成 {placeholder} 在分支一不會被解析。(2) 分支一自己內聯做級別解析＋saveCardLevel 正規化（980-986），分支二用 resolveCardLevel()（levels-payments.js:203，不做大小寫正規化）。兩種「級別找不到」處理不同。(3) 分支一 parseCashbackRate 傳 levelSettings，分支二傳 levelData（同義）。
  - 重要：目前 cards.data 有 0 張卡 specialItems 非空（cards-query 驗證），hasLevels 的 4 張卡 specialItems 皆 0 → 分支一在現行資料下是死碼（約 200 行，含 specialItem/CUBE generalItems 舊邏輯）。specialItems 另在 card-detail.js(6)、search-match.js(6)、data-loader.js(3)有殘留引用。
  - 建議：先不動「合併」，而是請站長決定「specialItems 是否正式退役」。若退役→刪分支一（連帶清 saveCardLevel 在 cashback-engine.js:986 這個鐵則 1 的第二個合法呼叫點，風險面反而縮小）；若不退役→抽 matchCashbackRateGroups(card, variants, amount, levelData) 共用。風險：高（核心計算，鐵則 1/5），必須跑 run-regression。

A3. 停車折抵「匹配」邏輯 4 份，且判斷基準不同
  - search-match.js:412-431(showMatchedItem)、450-470(showNoMatchMessage)、520-534(另一個 no-activity 訊息) 三份逐行近乎相同的 filter；results-display.js:537-575(displayParkingBenefits) 是第四份。
  - 不一致：前三份用「原始輸入 merchantValue.toLowerCase()」雙向 includes；第四份用 getAllSearchVariants() 展開別名/fuzzy 後比對，且有 searchKeywords（快捷選項）分支。結果：橫幅說「匹配到停車折抵」與下方停車區塊是否出現，可能不同步（別名/快捷搜尋時橫幅漏報）。另外 search-match 第三份用 displayName。
  - 建議：值得合併。抽 findMatchingParkingBenefits(terms, cardsToCheck) 放 results-display.js（或 search-match.js）給四處用，terms 一律 getAllSearchVariants。風險：中（會讓橫幅行為變得與區塊一致，屬行為修正；跑 run-regression 看差異）。

A4. 「剩餘天數」有 5 套實作，時區基準不同
  - core-utils.js:486 getDaysUntilStart / 501 isEndingSoon / 516 getDaysUntilEnd（台北時間、ceil）、home-ui.js:54 getSpotlightDaysLeft（new Date(deadline)＋瀏覽器本地時間＋setHours 23:59:59、ceil）、mappings-page.js:246 mpDaysLeft（台北今天、round）、promos.js:28-62 todayISO/daysBetween（自算台北、ceil；註明與 cards-export.gs pmcTodayISO_ 同算法）。
  - 不一致：Spotlight 倒數用裝置時區（海外/跨日邊界會與其他頁差 1 天）；mpDaysLeft 用 round，其他用 ceil（因兩邊皆午夜，數值上相同，但是巧合）。parseISODate 的「雙格式正規化」也在 mappings-page.js:240 mpISO 重寫一次。另生日月份判斷用裝置時區 new Date().getMonth()（auth-user-data.js:388、levels-payments.js:113），其餘用台北。
  - 建議：js/ 內值得合併 getSpotlightDaysLeft、mpDaysLeft→getDaysUntilEnd（注意 getDaysUntilEnd 對過期回 null，需另包）。promos.js 不用動（獨立載入，但要註明同源）。風險：低-中（Spotlight 倒數可能改 1 天，屬修 bug）。

A5. 上限（cap）顯示格式化 ≥6 種寫法，0/NaN/null 判斷不同
  - card-detail.js:1127 formatRateCardCap(`cap ?`→無上限)、home-ui.js:536 formatSpotlightCap(null/undefined/NaN→無上限；0 會顯示「NT$0」)、results-display.js:1392(coupon，`cap && !isNaN`)、1580-1583(結果卡，附「+」)、1865、1787；card-detail.js:292 同款但無上限寫「無」而非「無上限」(文案不一致)；mappings-page.js:393 另寫(帶 taishin-richart 的「+」特例)。
  - 差異實例：cap=0 → formatRateCardCap「無上限」、formatSpotlightCap「NT$0」。
  - 建議：值得合併一支 formatCapText(cap,{plus}) 放 core-utils.js。風險：低。

A6. 抽屜側欄/回到頂部/escapeHtml 在獨立頁各複製一份，且已有差異（見 B 區 D 組）。

## B. 高機率改一漏一
B1. escapeHtml：results-display.js:1071 與 faq.js:257 逐字相同（faq 註明「faq.js 獨立載入」）。promos.js、landing.js 沒有 escapeHtml（promos 用 DOM API/textContent，詳見 promos.js:401 註解）。sanitizeUrl：results-display.js:1091 與 promos.js:804 sanitizeImgUrl 本體相同（改名）。faq.js 沒有 sanitizeUrl（用 escapeHtml 渲染 FAQ answer，是 CLAUDE.md 鐵則 3 的例外）。readLocalJSON：只在 core-utils.js:431；promos.js:527-560 readOwnedCardIdsSafe 自寫（只讀、容錯，目前行為等價）。
  - 建議：不值得抽共用檔（三頁刻意獨立載入，加 shared script 會多一個請求並違反「各自獨立」設計）；現況三份很小、至今無分歧。做法：在三處各加一行註解「與 results-display.js:1071 同步」，並讓 tools/ 加一支 check 比對函式 hash（成本極低）。風險：—

B2. 站台抽屜／回到頂部（js/ 與 faq.js、promos.js）
  - setupSidebarDrawer：cards-modals.js:76-124(49 行) vs faq.js:35-61 vs promos.js:936-962；setupBackToTopButton：home-ui.js:371-392 vs faq.js:66-87（逐字）vs promos.js:966-987（rAF 節流寫法與 var 風格；邏輯同）。faq/promos 的 openDrawer 直接 body.style.overflow=hidden；js/ 版走 disableBodyScroll()（core-utils.js:116，有深度計數＋scrollbar padding 補償）→ 已分歧：faq/promos 版開抽屜會因捲軸消失產生版面跳動；也沒有 peek 提示、沒有 resize 關閉、沒有 window.closeSidebarDrawer。
  - 另外 faq.js/promos.js 註解還寫「比照 script.js:1409-1430」（script.js 已拆分，行號已失效）。
  - 建議：先不動（頁面刻意獨立），只修註解；若要動，faq.js 與 promos.js 兩份可互抽（都是小檔、風格相近），但只省 ~60 行。風險：低。

B3. Firebase 設定與初始化 module script：index.html:1326-、faq.html:361-、promos.html:1791-(生成檔)、cards-export.gs（生成 promos 的來源）各有一份 firebaseConfig（apiKey 等 7 欄相同）。import 清單各不相同（faq 只要 analytics/firestore）。
  - 建議：不值得合併（HTML 內 inline、無 build）；但改專案/金鑰時要同時改 index.html、faq.html、cards-export.gs 三處＋重生商家頁。建議在 maintenance 文件加一行清單。風險：—

B4. 「users/{uid} 單文件、依卡片分 key 的 map 欄位」載入/儲存樣板 ×3-4
  - spending-mappings.js:408-475 免年費（feeWaiverStatus）、503-562 額度（creditLimits）、594-670 結帳日（billingDates），結構完全平行：local key 規則(`xxx_${uid||'local'}_${cardId}`)、讀雲端→回寫本機鏡像、儲存＝先 getDoc 再 setDoc merge。另 mappings-page.js:324-345 mpLoadLimits 重寫了 loadCreditLimit 的雲端讀取＋本機鏡像讀取；credit limit 的 parse 函式兩份：spending-mappings.js:504-508 與 mappings-page.js:327（細微差：後者多判 undefined，結果等價）。
  - 不一致：saveFeeWaiverStatus（443-446）直接 localStorage.setItem 無 try/catch；其他用 try 包。
  - 建議：值得合併成 loadUserCardMapField(field, cardId, {localPrefix, parse}) / saveUserCardMapField(...)。風險：中（涉及用戶資料寫入；鐵則 2 只管讀，但此處要保持現行存取 key 不變）。若不想動資料層，至少把 creditLimit parse 抽成 parseCreditLimit 讓 mappings-page 共用（風險低）。

B5. 級別解析：calculateCardCashback 內聯版（cashback-engine.js:974-995）vs resolveCardLevel（levels-payments.js:203）vs cards-modals.js:570 直接 getCardLevel；詳見 A2。resolveCardLevel 不做大小寫正規化，內聯版會（並寫回，屬鐵則 1「正規化」合法場景）。同一用戶在不同畫面可能因「Level 1 vs level1」拿到不同級別。建議：A2 處理時把正規化進 resolveCardLevel（只顯示、不存回；存回另走明確呼叫）。風險：高（鐵則 1）。

B6. 卡片標籤兩份清單：cards-modals.js:164 sortedTags(24 個) 與 749-775 getTagClass 的 tagMap(24 個)——新增標籤要改兩處＋styles.css:5995 起的 .tag-* 樣式（三處）。另 renderCardTags(784) 的 ${tag} 沒 escapeHtml（資料來自 Sheets；鐵則 3 疑似違規，建議順手修）。建議：合併成一張表 [{name,cls}]。風險：低。

B7. 「切換「童樂匯」方案」字串硬編碼：cashback-engine.js:504(map)、1035、1206(兩處條件)；另 cashback-engine.js:931 慶生月前綴常數化了但童樂匯沒有。建議：抽 CHILDREN_PLAN_CATEGORY 常數。風險：低。

B8. showMatchedItem/handleMerchantInput 尾段重複：home-ui.js:2179-2227 handleMerchantInput 與 search-match.js:635-668 syncMatchedItemToInput 的 if/else 分支（showMatchedItem→hide→exact hint→showBasicExclusionPreview）幾乎相同；差異：home-ui 版多 console.log 與結尾 validateInputs/nudge。建議：syncMatchedItemToInput 讓 handleMerchantInput 呼叫（先確認後者是否只是前者的擴充）。風險：中（搜尋主流程；跑回歸）。

B9. 配卡/「GA 事件」：`window.logEvent && window.firebaseAnalytics` 守衛在 mappings-page.js ×6、spending-mappings.js ×2、card-detail.js、cashback-engine.js、home-ui.js(logOnboardEvent:846 已有小 helper)、quick-options-misc.js:1298。建議：core-utils.js 加 logGaEvent(name, params)，其餘改呼叫。風險：低（純機械）。

B10. A/B 分流旗標協定兩份：index.html:55-80 + 1367-1378（先 setItem pmc_ab_sent 再送）與 landing.html:78-100（送達 callback 才 setItem）。語義不同（先記 vs 送達才記），A 組從 landing 轉入首頁時有重送/漏送機率。建議：不合併（兩頁 inline、無 build），在兩處註解互指並統一「先記/後記」。風險：低。另 landing.html:44-50 的 "Google AdSense" 註解下放的是 Clarity snippet（疑似註解錯貼）；Clarity snippet 在 index/faq/landing 各 inline 一份。

## C. 純冗餘
C1. Modal 開關樣板：levels-payments.js:228/292/418/576 四個 closeModal 本體完全相同（display none＋enableBodyScroll），auth-user-data.js:895 同款，home-ui.js:1289、card-detail.js:801 類似；`modal.onclick = e => { if (e.target===modal) closeModal() }` 出現約 15 處（levels-payments×4、auth、card-detail、home-ui×3、cards-modals×2、quick-options-misc×3）。建議：抽 bindModal(modal,{closeBtn,onClose}) 到 core-utils.js。值得，但分批做；風險：低-中（每個 modal 的關閉副作用略不同，要逐一核）。
C2. 商家列「展開面板」toggle：quick-options-misc.js:150-170 與 413-430 兩份逐字（差在變數 tag/item）。建議：抽 attachMerchantsPanel(wrapper, option, triggerEl)。風險：低。
C3. 結果卡「計算明細」按鈕 SVG：results-display.js:1421、1658 兩份行內 SVG（cashback-engine.js:703 已有 CALC_BREAKDOWN_ICON_SVG 常數且同款樣式）。建議：改用常數／小函式 renderCalcBreakdownBtn(layers)。風險：低。
C4. 結果卡兩個 renderer（results-display.js:1400-1450 coupon 卡 vs 1640-1700 一般結果卡）的 detail-item 版型（回饋率/回饋金額/上限）相同；且詳情頁回饋卡 renderRateCard 也有一套。屬 ui 重構，不建議現在動（卡片差異多）。
C5. 事件委派：search-match.js:831-860/home-ui.js:1983-2050 的 ⓘ「card-detail-peek-btn」click 處理 ×3（結果、cardholder promos、coupon）。建議：一個委派處理器掛在共用祖先。風險：低。
C6. 銀行名稱表／日期格式：js/ 內沒有銀行名稱對照表重複（grep 無）；日期顯示 formatISODateForDisplay(core-utils.js:340)、formatChangelogDate(card-detail.js:1246)用途不同（後者補零）；金額 `NT$${Math.floor(x).toLocaleString()}` 散落 ~35 處（見 A5，建議 formatNTD）。
C7. 其他小重複：add/open/close/step 等是同名巧合不是重複（functions 名稱 hash 不同）；levels-payments.js:528 與 mappings-page.js:702 的 capOf 同名不同用途，不用動。
C8. debug 日誌閘門 IIFE：core-utils.js:28-36 與 faq.js:4-13 相同（promos.js、landing.js 沒有，直接 console.log 可能在正式環境出聲）。建議：不合併。

## D. 工具腳本 tools/
- cards.data base64 解碼：build-merchant-pages.js:37、build-promos-features.js:261、build-promos-page.js:27、check-card-banks.js:25、check-cross-slot-refs.js:31、check-spotlights.js:25 各一行（check-* 三支另有相同的 try/讀檔樣板：check-card-banks:13-21 vs check-cross-slot-refs:13、check-spotlights:21）。建議：tools/lib/cards-data.js loadCardsData(path)。值得；風險低。tools/lib/merchant-cards.js 已是良好範例（vm 載入 js/）。
- build-merchant-pages.js:434-453 又自帶 playwright require/MIME/http server；build-logo-assets.js:275-278 自帶 chromium launch。併入 A1 的 lib/test-harness.js。

## E. CSS（只抽查）
- styles.css（11,611 行）：同 selector＋同 media 上下文被定義 ≥2 次的有 37 組（約 1,948 規則的 2%）；其中 5 組「前者的屬性被後者完全覆蓋」（死 CSS）：.info-grid-2col、.info-item、.info-value、.fee-annual-section、@media(min-width:1025px) .personal-fields-row；1 組 body 完全相同（可直接刪一份）。規模小，價值低；建議順手清，不專案化。
- promos.css（3,462 行）與 styles.css 有 31 個相同 selector，其中 23 個 body 完全相同：社群頁尾（.social-media-footer/.social-link/.footer-legal… ，styles.css:6102 起 vs promos.css）。promos.html 不載 styles.css，所以是刻意複製；HTML 頁尾本身也在 index/faq/privacy/terms/promos 重複（index.html:1244 註解已寫「faq/privacy/terms 頁尾是同一套，改這裡記得一起改」）。建議：不合併 CSS；但頁尾 HTML＋CSS 是「改一漏一」高風險點，值得在 maintenance 文件列出清單，或抽成 footer.css/由生成器注入（promos 由 .gs 生成，需同步 gs）。
- faq.css 與 styles.css 重複 8 個 selector（identical body 2：from/to keyframes）；privacy.css 與 styles.css 重複 4 個（main、.header-content，body 不同＝刻意覆寫）；landing.css 與 styles.css 僅 *、body（1 個相同）。皆不需處理。

## 文件漂移（順帶）
- core-utils.js 頂部寫「載入順序 1/12、12 個模組檔」，現為 13 支（含 mappings-page）；faq.js/promos.js 註解引用已不存在的 script.js:行號。

## 沒查到／沒把握
- 未逐函式比對 card-detail.js 內的 HTML 模板（renderRateCard 與詳情頁各區塊）與 promos.js 生成端 cards-export.gs 之間的樣板重複（gs 不在範圍）。
- 未量化 styles.css 的「屬性層級」重複（只比 selector+media 層級）。
- auth-user-data.js 內 users 文件讀寫（11 處）、firestore 容錯樣板未逐一比較。
- 沒執行 run-regression/mappings-page-test（run-regression 會寫 last-run.json，守唯讀）；mappings-page-test 的紅燈由讀碼推論＋delete-account-test 實跑印證。
- merchant/*.html、promos.html 為生成檔，未列入。
