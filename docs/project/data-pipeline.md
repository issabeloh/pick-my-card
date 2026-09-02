# 資料管線（Google Sheets → Apps Script → cards.data）

> 改「資料結構、匯出邏輯、cards.data、級別設定」前必讀。
> ⚠️ 主匯出程式 `exportToJSON()` 目前**只存在 Google Sheets 的 Apps Script 專案裡**，repo 的
> `apps-script/` 只備份了權益監控（watchlist-monitor.gs）。改匯出邏輯＝到 Sheets 裡改，改完建議把副本補進 `apps-script/`。

## 1. 資料流

Google Sheets（多工作表）→ Apps Script `exportToJSON()` → Base64 JSON → repo 的 `cards.data` ＋ 同步更新 `cards.version` → 前端載入。

**查 cards.data 內容的唯一正確姿勢**（488KB base64 單行，絕不 Read）：
```bash
bash tools/cards-query.sh '.cards[] | select(.id=="dbs-eco")'   # 自動解碼＋截斷長輸出
```

## 2. 工作表結構

1. **Cards Data** —— 信用卡基本資料和回饋規則
   - 必填：`id, name, fullName, basicCashback, annualFee, feeWaiver, website, tags`
   - 回饋欄位：`rate_N, items_N, cap_N, category_N, conditions_N, periodStart_N, periodEnd_N, hideInDisplay_N`（N=1-21，匯出迴圈上限 21）
   - 計算模型：`cashbackModel_N`（選填，只加用到的槽位；語義見 `docs/project/cashback-engine.md` 第 6 節）
   - 領券活動：`couponMerchant_N, couponRate_N, couponConditions_N, couponPeriod_N, couponCap_N`（N=1-10）
   - 分級卡：`hasLevels`, `levelSettings`（JSON 格式）
   - 發卡行：`bank`（選填，2026-07-28 新增）——側欄「加入比較的卡片」膠囊左半顯示的銀行字樣。
     **沒建這欄也不會壞**：前端會退回用卡片 id 前綴推導（`js/home-ui.js` 的 `CARD_BANK_BY_ID_PREFIX`）；
     兩者都對不到才退回「單一膠囊＋完整卡名」。想改銀行字樣（如「第一銀行」→「一銀」）或新增發卡行，
     **建這欄後只改 Sheets 即可、不必動程式**。`tools/check-card-banks.js`（preflight 內）會列出對不到銀行的卡。
     卡名開頭若重複銀行字樣會自動去掉（`一銀 iLEO 信用卡` → 膠囊顯示 `一銀｜iLEO 信用卡`）
   - 隱藏活動：一般槽位加 `hideInDisplay_N=TRUE`（詳情頁不顯示但可搜尋；配方見 cashback-engine.md 第 5 節。舊 `_hide`/`_hide_1` 專用欄位與其 Apps Script 特例迴圈已於 2026-07-11 移除）
2. **Payments** —— 行動支付（id, name, website；自動生成 searchTerms 別名）
3. **QuickSearch** —— 快捷搜尋（id, displayName, icon, merchants 逗號分隔, order）
4. **Merchant Payments** —— 商家付款方式（merchant, online_payment, offline_payment, source_url, last_updated）
5. **Search Hints** —— 搜尋提示（keywords 逗號分隔會展開成多 key, suggestions, display_message, active）
6. **FAQ** —— id, category, question, answer, order, isActive（依 order 排序）
7. **announcements** —— text, fullText, link, active, priority, date（依 priority，最多 5 則）
8. **Card Benefits** —— 停車折抵等（id, benefit_type, benefit_desc, merchants, conditions, benefit_period, notes, active）。**同一張卡可有多筆**（不同地點/優惠），ID 重複是正常的
9. **ReferralLinks** —— merchant, url, description, active
10. **Highlights** —— 精選活動（merchant, rate, description, card_name, card_id, cap, deadline, order, active, category 選填）。匯出 JSON key 是 `spotlights`；merchant 必須是單一搜尋詞（一個商家，或剛好等於某快捷搜尋 displayName）
11. ~~**Watchlist**~~ —— 已於 2026-07-17 搬到「PMC 資料自動化」自動化檔並改名 `1-監控清單`（見 `apps-script/README.md` 的「選單 ↔ 分頁對照表」，與 cards.data 匯出無關）
12. **searchExclusions** —— 搜尋排除規則（term, excludedItems 逗號分隔, active）。前端載入時由
    `mergeDataSearchExclusions()`（`js/search-match.js`）併入 `searchExclusionMap`（程式內只留兜底預設）。
    語義：搜尋詞（含 fuzzy 展開後的別名）＝term 時，item 名與 excludedItems **小寫全等**者不匹配。
    例：`term=sia, excludedItems=AsiaYo`（新加坡航空的別名 sia 子字串誤中 a"sia"yo）。
    ⚠️ **教訓（2026-08-04）**：工作表建好了、前端接收端也早就寫好了，但**匯出這一側漏掉沒寫**，
    造成「工作表填了規則卻完全沒效果」（`cards.data` 的 `.searchExclusions` 是 `null`，只有寫死在
    `searchExclusionMap` 的 sia 生效）。查這類「資料填了沒反應」先用
    `bash tools/cards-query.sh '.<key>'` 確認 key 有沒有真的出現在 cards.data，別從前端開始查。
    匯出端讀取函數在 `apps-script/cards-export.gs`（分頁名大小寫兩種都收），JSON key 為
    `searchExclusions`，格式 `[{ term, excludedItems: [...] }]`。
13. **變動紀錄** —— 卡片近期異動（id, date, summary, active），2026-07-31 新增。
    詳情頁「近期異動」的資料來源。**不是手打的**：由自動化檔的選單「發布變動紀錄」
    跨檔 append 進來（流程見 `apps-script/README.md`「發布變動紀錄」一節）。
    - 匯出時由 `readChangelog()` 依 `id` 分組、濾掉 `active=FALSE`、依 `date` 由新到舊
      取前 5 筆，掛成 `card.changelog`（**沒有異動的卡不塞空陣列**，省 cards.data 體積）
    - `active` 留空視為啟用（append-only 的 log，忘了打 TRUE 不該整批消失）；
      要撤下就把該列改 `FALSE`，**不用刪列**——表裡保留全部歷史，「最多 5 筆」是匯出時截的
    - ⚠️ **工作表不存在時安全降級**：整段跳過、不丟例外（可以先貼程式、之後再建表）
    - `runQACheck` 檢查 10 會列出對不到 `Cards Data` 的 `id`（⚠️ 警告，不擋匯出）

## 3. exportToJSON() 匯出流程

順序：`runQACheck()` → Cards Data → Payments → QuickSearch → Merchant Payments → Search Hints → FAQ → announcements → `readCardBenefits()` → `readReferralLinks()` → `readChangelog()`（掛進 `card.changelog`） → 組 JSON → Base64 輸出。

匯出的 JSON 結構：
```javascript
{
  lastUpdated, cards, payments, quickSearchOptions, merchantPayments,
  faq, announcements, searchHints, benefits, referralLinks,
  cashbackSites,        // 領券/回饋網站
  newCardholderPromos,  // 新戶活動
  cardApplyCtas,        // 辦卡 CTA
  spotlights            // 精選活動（Highlights 工作表）
}
```

「變動紀錄」沒有頂層 key——它掛在每張卡身上：`card.changelog = [{ date, summary }, ...]`（最多 5 筆、由新到舊；**沒有異動的卡沒有這個欄位**，前端判斷要 `!card.changelog || card.changelog.length === 0`，鐵則 4）。

**重要輔助函數**：`getValue(row, headers, fieldName)` 安全讀欄位；`addOptionalField(obj, row, headers, fieldName, type, targetName)`；`formatDateToSlash(dateValue)`（YYYY/M/D）；`generateSearchTerms(id, name)`。

## 4. 匯出 guard 鐵則（rate=0 陷阱，2026-07-09 血淚教訓）

**匯出迴圈（`rate_N` 槽位，隱藏活動也走同一支）不可以用 `if (rate && items)` 當 guard**——
`0 && items` 是 falsy，會把 `rate_N=0` 的 stacking 槽整組丟掉（如 `meta廣告`/`google廣告`，
`cashbackModel=…+overseasBonusRate`、指定加碼成分為 0）。症狀：搜尋零結果、cards.data 裡根本沒有該 item。

**正確做法**：只有 `items` 沒填才跳過；`rate` 用 `parseFloat` 解析，`0` 放行、非數字才整組不匯出
（placeholder 如 `{specialRate}` 是 truthy 字串，不受影響）。

**匯出後快速自檢**：解 base64，「非 hideInDisplay 的 `rate===0` 槽數量」不該是 0：
```bash
bash tools/cards-query.sh '[.cards[].cashbackRates[]? | select(.rate==0 and (.hideInDisplay|not))] | length'
```

## 5. cards.data 快取機制

- 前端先抓 `cards.version`（不快取）→ 用版本號抓 `cards.data?v=<版本>`（可快取）
- **更新 cards.data 必同步更新 cards.version**（任何不同短字串即可，建議 `YYYYMMDD-N`）——`tools/preflight.sh` 會機械檢查
- 忘了更新不會壞，使用者最多延遲約 10 分鐘看到新資料
- 詳見 `CARDS-DATA-CACHE-README.md`

## 6. ⚠️ 更改「級別名稱」須知（資料維護者）

級別的**名稱字串本身就是識別碼**（用戶存的、選單顯示的都是這串字）：
- **改級別名稱＝所有存舊名稱的用戶「對不上」**→ 看到預設級別、要手動重選（不當機、不壞資料，但個人偏好被遺忘）
- **能不改就不改**：把級別名稱當永久編號；要改給用戶看的說明文字，改 `level-note`
- **非改不可**：先準備「舊名稱→新名稱」對照，在程式裡加一次性「級別改名遷移對照」（`getCardLevel` 讀到舊名稱自動翻譯後再存回）。目前程式**只**支援大小寫/空格差異的自動比對（約 script.js:3300），**不**支援真正改名——真改名一定要另外加對照表
- 相關鐵則（前端絕不擅自覆寫用戶級別）見 `docs/project/storage-and-security.md`

## 7. 新增資料表的標準流程

1. Sheets 新增工作表（第一列 headers，通常含 `active` 欄）
2. 寫讀取函數（參考 `readCardBenefits()`/`getAnnouncements()`）：
   ```javascript
   function readXxxData() {
     const sheet = ss.getSheetByName('SheetName');
     if (!sheet) return [];
     const data = sheet.getDataRange().getValues();
     const headers = data[0];
     const results = [];
     for (let i = 1; i < data.length; i++) { /* 讀取並轉換 */ }
     return results;
   }
   ```
3. 在 `exportToJSON()` 調用：`readCardBenefits()` 附近新增讀取、`jsonContent` 加欄位、成功訊息顯示匯出數量
4. 前端以 `cardsData.xxx` 存取，依需求實作搜尋/顯示

## 8. 日期欄位雙格式陷阱（periodStart / periodEnd）

**匯出的日期格式不保證一致**：`cashbackRates` 通常是 ISO `"2026-01-01"`（`-`），但 `couponCashbacks` 等區塊可能是台式 `"2026/7/1"`（`/`，不一定補零）。**兩種都會實際出現在 cards.data，前端不能假設只有一種。**

混用時不會報錯，活動會**被靜默濾掉**（看起來像「根本沒這活動」）：ASCII `-` < `/`，原始字串比較會把任何日期誤判成「即將開始」；`.split('-')` 遇 `/` 格式解析成 `Invalid Date`，最後被 `filterExpiredRates()` 整個濾掉（2026-07-03 教訓）。

**規則**：前端任何日期比較/解析，一律走 `parseISODate()` / `getRateStatus()`（內部已用 `slashDateToISO()` 正規化），禁止對這兩欄位手刻字串比較或 `.split('-')`；新增帶日期的區塊也要沿用這套函數。

## 9. promos.html 靜態生成（新戶活動一覽頁，2026-07-15 新增）

`promos.html`（＋獨立的 `promos.css` / `promos.js`）是給 SEO／社群轉貼用的「新戶活動一覽」
落地頁，內容**不是手寫、也不是前端 fetch cards.data 動態組出來**——是 Apps Script 匯出時
用純函數把 HTML 字串直接生成好，跟 cards.data 一起 commit 進 repo。

- **生成邏輯的唯一事實來源**：`apps-script/cards-export.gs` 內的 `generatePromosPageHtml(exportData)`。
  它是純函數（吃組好的 `{ cards, newCardholderPromos, cardApplyCtas }` 物件、回傳完整 HTML
  字串），內部**不呼叫任何 Sheets/Apps Script API**（連 `Utilities.formatDate` 都不用，改用
  自己的 `pmcTodayISO_()`），所以同一份程式碼可以直接被 Node 的 `vm` 載入執行——這是刻意設計，
  避免「Apps Script 版」和「repo 初版」各寫一份生成邏輯而分岔。
- **呼叫點**：`exportToJSON()` 讀完 `newCardholderPromos` / `cardApplyCtas` 後立刻呼叫
  `generatePromosPageHtml()`，產出的 HTML 字串跟著 `cards.data` / `cards.version` 一起
  丟進 `publishToGitHub(encoded, promosPageHtml)` → 同一次 commit 三個檔案。
- **repo 初版怎麼來的**：用臨時 Node harness（放 scratchpad，不留在 repo）以 `vm.runInContext`
  載入 `cards-export.gs`、餵 cards.data 解碼後的 JSON（跑過 `tools/cards-query.sh` 後快取在 `$TMPDIR/cards-decoded.json`），呼叫
  `generatePromosPageHtml()` 產生 `promos.html`。之後每次 Apps Script 端跑 `exportToJSON()`
  都會用真正的 Sheets 資料重新生成、覆蓋這份檔案——**repo 裡的版本只是初版備份，最新內容以
  GitHub 上次 commit 的為準**。
- **⚠️ 改生成邏輯務必兩邊同步**：跟其他 `apps-script/*.gs` 一樣，實際執行的版本在 Google
  Sheets 的 Apps Script 專案裡；改了 `generatePromosPageHtml` 或它的小工具函數，要把整份
  `cards-export.gs` 貼回 Sheets（見 `apps-script/README.md`），否則下次匯出還是跑舊邏輯、
  repo 的新版程式碼形同沒生效。
- **`<!-- PROMOS:START -->` / `<!-- PROMOS:END -->`**：包住 `promo-grid` 那塊卡片列表，
  方便日後對 diff／除錯（一眼看出「這次匯出改了哪些活動」，不用整份 HTML 比對）。
- **過期過濾＋排序**：生成時只保留 `period_end` 未到期（或無 `period_end`＝不限期）的活動，
  依 `period_end` 升冪排序（無截止日排最後）；日期解析走生成器自帶的 `pmcNormalizeDate_()`，
  同樣容忍第 8 節說的 ISO／台式雙格式，不假設只有一種。
- **versionTag 含台北時分**（2026-07-16 起）：promos.css/js 的 `?v=` 為 `YYYYMMDDHHmm`，同日多次匯出也能破快取。代價是重生成不再天然位元級一致——**做位元級重現驗證時，exportData 傳 `versionTagOverride: '<repo 版的 tag>'` 固定它**再比對。
- **「資料更新於」戳章只在活動內容真的變動時前進**（2026-07-23 起，`promosUpdatedIso`）：頁腳
  `<time datetime>` 戳章、`sitemap.xml` 的 promos `lastmod`、`<head>` 的 `CollectionPage`
  JSON-LD `dateModified` 三處**同源**，都用這個日期（可見戳章 `.promos-data-update` 2026-07-23 起
  放在 `.promos-controls` 下方、`.promo-grid` 上方，不再在頁尾）。它**不是每次匯出的今天**——`exportToJSON`
  先用 `pmcPromoSignature_(newCardholderPromos)`（每筆各自序列化後排序的內容指紋，djb2/`Math.imul`
  純函數，不受 sheet 列序影響）跟 Script Properties 的 `PROMOS_LAST_SIG` / `PROMOS_LAST_DATE`
  比對：指紋相同就沿用上次日期，不同（或首次）才蓋 `pmcTodayISO_()` 並寫回。**為什麼不每次蓋今天**：
  對 Google 天天喊 `lastmod` 更新但內容沒動會反被降低重爬信任（狼來了）；只在真的更新時前進才誠實。
  **注意別跟 `todayIso` 混用**：過期過濾與 versionTag 快取破壞仍必須用「實際今天」（`todayIso`），
  只有這三個對外「新鮮度信號」才用 `updatedIso`。生成器是純函數、拿 `exportData.promosUpdatedIso`
  當參數（沒傳退回今天，供 Node 初版 harness 用）；比對狀態存 Script Properties 是刻意選的——
  Apps Script 端持久化、不佔 repo 檔案、不多一個 commit、維護者流程零改動（代價：repo 看不到、
  Node harness 重現不了，但初版本來就以 GitHub 上次 commit 為準）。
- **前端 `promos.js` 只做「已經是資料」之上的互動**：剩幾天徽章即時重算（避免生成當下算好的
  天數過幾天就過時）、篩選 chips、排序切換（deadline / 依卡片）、「立即申辦」點擊送 GA4——
  不 fetch 任何東西，頁面本身就是完整資料。
- **⚠️ header／footer 是從 `index.html` 手動複製過來的**：
  `pmcPageTemplate_()` 裡的 `<header class="promos-header">`、
  `.promos-warning-row`（謹慎理財警語）、`.social-media-footer`（探索更多／追蹤我們／
  支持我們）三段，內容與樣式都是照 `index.html` 對應區塊（`header`／`.finance-warning-row`／
  `.social-media-footer`）手動抄的，**不是共用元件**。主站改這幾塊時（換連結、改文案、換
  社群帳號），這裡要記得手動同步，否則 promos 頁會悄悄跟主站不一致。`promos.css` 裡對應的
  樣式規則也在同一段加了「抄自 styles.css」的註解，方便對照。
  **2026-07-16 header 一致化改版**：header 現在不只是 logo＋站名＋深藍 bar，還含桌機導覽
  （新戶活動／常見問題，本頁帶 `aria-current="page"`）與手機漢堡抽屜（兩張卡片連回 `/`
  工具頁與 `/faq`）。互動邏輯（抽屜開合）寫在 `promos.js` 開頭「手機漢堡側選單開合」一段，
  介面與 `faq.js` 同款。**`faq.html` 的 header 也是同一份 `index.html header-top` 的
  手抄件**（見 `FAQ-README.md`）——這下有三份手抄件互相要對齊：`index.html` 改動時，
  `promos.html` 的生成器（本節）與 `faq.html`／`faq.css`／`faq.js` 都要跟著手動同步，缺一邊
  就會悄悄跟另外兩邊不一致。
  **同日二輪回饋**：header 右側原本試過頭像＋精簡 dropdown（訪客「註冊／登入」、登入者
  「前往主站管理」），站長裁定「副頁頭像做不到主站完整功能（無法登出/管理），意義不大」，
  已撤回改為「返回首頁」鈕（`promos-back-home-btn`，連回 `/`；faq.html 對應 `.back-home-btn`
  連回 `index.html`）——**header 不含任何登入/頭像狀態**，也不再 import firebase-auth。
  同一輪還加了：可見麵包屑（hero 上方一行小字，`.promos-breadcrumb`／`.faq-breadcrumb`）＋
  `<head>` 內的 BreadcrumbList JSON-LD（`pmcBuildBreadcrumbJsonLd_()`，與既有 ItemList/FAQPage
  JSON-LD 並存）、浮動「回到頂部」鈕（`.promos-back-to-top-btn`／faq 重用 styles.css 既有
  `.back-to-top-btn`，手機限定、捲動 >300px 顯示，行為同主站）、手機抽屜工具卡改色（promos
  側 `.promos-sidebar-tool-card` 改糖果薄荷色＋💳 emoji，與 FAQ 卡區隔）、FAQ 側手機抽屜的
  「新戶活動一覽」卡（`.sidebar-promos-banner`）在 `faq.css` override 壓平立體感（不改
  `styles.css`，`index.html` 自己的抽屜不受影響）。
  > 註（2026-07-17 本輪移植）：舊分支同一次改版另外文件化了 `.promo-card-info-btn`
  > 深連結（`/?start&card=<id>`）的設計，但 main 分支同期已把 ⓘ 按鈕升級成 iframe 內嵌
  > 詳情彈窗（方案 A，深連結只當攔截失敗的 fallback）——那段說明已過時，**不portover**；
  > 完整、與現狀一致的說明在 `docs/project/ui-display.md` 第 1 節「Embed 模式」。

## 10. sitemap.xml 生成與 lastmod 原則（2026-08-16 補完）

`sitemap.xml` 由 `generateSitemapXml_(merchantPages, promosUpdatedIso, homeUpdatedIso)` 在**每次匯出時整份重生**
（`publishToGitHub` 內，帶 `[CI Skip]`）。repo 裡那份跟 `promos.html` 一樣只是快照，
**改生成邏輯要把整份 `cards-export.gs` 貼回 Google Sheets**，否則下次匯出照樣蓋回舊格式。
`robots.txt` 指向它，不需另外維護。

**收錄的頁**：`/`（首頁）、`/landing`、`/faq`、`/promos`、`/merchant/<slug>`（URL 用 `encodeURIComponent`，中文 slug 是百分比編碼）。
首頁 2026-08-16 才補進去——它是全站最重要的頁、`index.html` 本來就 self-canonical 到 `https://pickmycard.app/`，
先前漏收純粹是疏忽（漏收不會讓 Google 不索引首頁，但少一個明確信號）。

**鐵則：`lastmod` 只在「該頁內容真的變動」時前進，絕不每次匯出蓋今天。**
每次蓋今天＝對 Google 天天喊「我更新了」而內容沒動，久了 Google 直接不信任你的 `lastmod`、降低重爬效率（狼來了）。
各頁的日期來源：

| 頁 | lastmod 來源 |
|---|---|
| `/` | `homeUpdatedIso`＝`cards.data` 內容指紋（首頁內容整份由 cards.data 前端渲染）。**指紋刻意排除 `lastUpdated` 欄位**——那是匯出當下的時間戳，每次必變，含進去指紋就永遠不相等 |
| `/landing` `/faq` | 寫死的常數（不隨匯出變動；改版時手動更新 `generateSitemapXml_` 裡的日期） |
| `/promos` | `promosUpdatedIso`（見第 9 節，與可見戳章／JSON-LD `dateModified` 同源） |
| `/merchant/<slug>` | 同 `homeUpdatedIso`——商家頁＝index.html 版面 ＋ cards.data 算出的卡片清單，會變的來源就是 cards.data，與首頁同一個訊號 |

收哪些商家頁由 `MerchantPages` 工作表的 `active` 欄決定（見第 11 節）；工作表不存在時退回
`MERCHANT_FALLBACK_SLUGS`，避免 sitemap 把現有 6 頁整組移除。

**已知限制**：首頁的指紋只看 `cards.data`，看不到 `index.html` 本身。純 HTML 改動（例如改連結、改版面）
不會讓 `/` 的 lastmod 前進——Apps Script 端根本讀不到 repo 的 HTML。實務上影響很小（資料幾乎每次匯出都會變、
`/` 的日期本來就常前進），真的在意就在改 HTML 那次順手改 repo 的 `sitemap.xml`（下次匯出會重生，但至少即時）。
`/landing`、`/faq` 同理，日期是 `generateSitemapXml_` 裡的寫死常數，**改了那兩頁要手動更新**。

### 內部連結一律用 clean URL（2026-08-16）

Cloudflare Pages 會把 `/faq.html` 301 到 `/faq`，所以站內寫 `href="faq.html"` 等於每次都多繞一跳：
浪費爬取預算，GSC「Page with redirect」報表被自家連結灌爆。**一律寫 `/`、`/?start`、`/faq`、`/faq#faq-10`、
`/promos`、`/landing`**；`tools/preflight.sh` 第 1e 項會擋回頭路。
2026-08-16 全站 66 個連結一次改完（index 8、faq 7、landing 3、商家頁各 8）——`promos.html` 因為是
Apps Script 生成的，模板本來就寫 clean URL，是唯一沒中的頁。
**代價**：`python3 -m http.server` 之類的本機靜態伺服器不做 clean URL 對應，本機點這些連結會 404
（clean URL 是 Cloudflare Pages 的行為）。回歸腳本直接開 `index.html`，不受影響。

**共用機制 `pmcStampedDate_(key, signature)`**：指紋與日期成對存在 Script Properties
（`<KEY>_LAST_SIG` / `<KEY>_LAST_DATE`）；指紋相同就回上次那天，不同或首次才蓋 `pmcTodayISO_()` 並寫回。
promos（key `PROMOS`）、首頁（`HOME`）、生成的商家頁（`MERCHANT_<slug hash>`）共用同一支。
純函數 `pmcHashString_`（djb2 + `Math.imul`，Node/Apps Script 結果一致）負責算指紋。

## 11. 商家落地頁生成器（2026-08-16）

`merchant/<slug>.html` **不是手維護的檔案**，每次 Cloudflare Pages 部署時由
`tools/build-merchant-pages.js` 從 `index.html` ＋ `cards.data` 現場組出來。
手改那些檔案會在下次部署被蓋掉——`tools/preflight.sh` 第 1d 項會先擋下來。

`--check` 刻意把「不一致」分成兩類（用 `stripDataRegions()` 挖掉 JSON-LD 與 SEO 說明區後比對版面）：
**版面不一致 → ❌ 擋 commit**（手改過，或 index.html 改了沒重生）；
**只有卡片清單落後 → ⚠️ 放行**（Apps Script 每次匯出都會動 cards.data，部署時自己會重生，不影響線上）。
不分這兩類的話，每次匯出後所有不相干的 commit 都會被擋，結果只會是大家習慣性忽略 preflight——比沒有檢查更糟。

**為什麼要有這支**：那 6 頁本來是 `index.html` 的手抄副本，抄一份就多一份會歪的東西。
動手當天量到的實際傷害：

- 6 頁裡有 4 頁還停在舊版介面（少「個人設定」「近期異動」兩個區塊，還留著早已從
  `index.html` 移除的 `cube-level-selector` 等死碼）
- 頁面裡寫死的 JSON-LD 卡片清單與 SEO 文案早就過期：momo 頁畫面上第一名是遠東快樂卡，
  但兩份清單裡都沒有它——**對使用者講一套、對 Google 講另一套，而且沒有任何機制會發現**

**要改什麼去改哪裡**：

| 想改的東西 | 去哪改 |
|---|---|
| 版面、區塊、共用元件 | `index.html`（商家頁自動跟著變） |
| 開哪些商家頁、標題、描述、每頁的手寫正文 | Google Sheets 的 `MerchantPages` 工作表 |
| 卡片清單、JSON-LD、SEO 文案、推薦比較的回饋數字 | 都不用改，跟著 `cards.data` 自動更新 |
| 每頁專屬的結構（注入點、警語） | `tools/build-merchant-pages.js` 的 `buildPage()` |

**每頁尾端依序有三塊**（都由 `buildPage()` 第 5 步插在精選活動區之後、廣告列之前）：

1. **推薦比較工具列**（`<nav class="mc-related">`，2026-08-18 加）——連到其他每一個商家頁，
   每條帶「最高 X%（某某卡）」。數字取**該頁自己排第一名那列**的 `rate` 與卡名，與點進去看到的
   第一張卡一致；不用金額回推，否則兩邊會對不上。因為要列出其他頁的數字，`main()` 拆成兩輪：
   先把所有頁的卡片算完，再組頁面寫檔。
   ⚠️ 它的數字跟著 `cards.data` 走，所以**必須列進 `stripDataRegions()`**——沒挖掉的話每次
   Apps Script 匯出都會被判成「版面不一致」而擋住所有不相干的 commit。
   UI 刻意做成灰底出血的**工具列**（小字、藍字底線＋箭頭），不是卡片、不是內容區
   ——站長 2026-08-18 定調：「它是一個工具欄，有空才會看看的地方，UI 要區隔開來」。
   樣式在 `styles.css`（首頁與商家頁共用），**不在**生成器注入的那個 `<style>` 裡。
2. **SEO 說明區**（`<section class="mc-seo-footer">`）——H1 ＋ 說明文，卡片清單跟著資料走。
3. **`bodyHtml`**（`<section class="mc-body">`）——站長在工作表手寫的正文，留空就不輸出。

### index.html 既是模板、也是輸出（2026-08-18 起）

首頁也要有推薦比較工具列（站長要求：首頁是權重最高的頁，從這裡發出的內鏈最有價值，
所以要靜態 HTML、不要 JS 現算）。做法是 index.html 放一個**空的佔位**：

```html
<nav class="mc-related" aria-label="推薦比較"></nav>
```

生成器每次跑都會：**先 `stripRelatedBar()` 把它清回空佔位**當模板 → 生 7 個商家頁
（各自排除自己）→ 最後把「列出全部商家頁」的版本寫回 index.html。

- 先清空再當模板這步不能省：index.html 自己帶著上一次的結果，不清就會拿舊工具列去生商家頁
- 生成器**冪等**：同樣的 cards.data 連跑兩次，第二次應該 0 頁有變動（改壞了先驗這個）
- 三塊（工具列／SEO 說明區／bodyHtml）都掛在這同一個錨點上，順序才保證正確
- `tools/deploy-version.sh` 是**先跑生成器、再注入 `?v=`**，所以生成器寫回的 index.html
  帶的是 `?v=dev` 佔位，之後被同一支腳本換掉——順序不能對調
- 資料落後時 index.html 走的是 **dataDrift（⚠️ 提醒、exit 0）而不是 shellDrift（❌ 擋）**：
  首頁只有工具列這一塊是生成的，其餘全手寫，所以差異一律當資料面看待——理由同商家頁，
  每次 Apps Script 匯出都擋住不相干的 commit 只會讓人習慣性忽略 preflight

**`MerchantPages` 工作表**（`readMerchantPages()` 讀取，匯出成 `cards.data` 的 `merchantPages`）：
`slug`（URL）、`merchant`（**搜尋詞**，要跟站上搜得到的商家一致）、`displayName`（顯示名稱，
留空＝同 merchant）、`title`、`description`、`bodyHtml`（選填，見下）、
`active`（留空＝啟用，填 FALSE 關掉）、`order`。
⚠️ `bodyHtml` 是站長手寫的正文 HTML，**信任層級同 promos：直接烤進頁面、不 escape**
（escape 掉這欄就沒用了）。所以它只能由站長自己填，任何外部來源的內容都不准進這欄。
留空就整段不輸出。位置在 SEO 說明區之後。
⚠️ `merchant` 與 `displayName` 是兩件事：linepay 頁的搜尋詞是 `LinePay`，顯示是 `LINE Pay`。
⚠️ 改 `slug` ＝換網址，舊網址變 404，非必要別動。
工作表還沒建立時退回 `tools/merchant-pages.fallback.json`（與 `.gs` 的 `MERCHANT_FALLBACK_SLUGS` 同一份清單）。

**卡片清單怎麼算出來的**：`tools/lib/merchant-cards.js` 用 Node 的 `vm` 把 `js/` 那 12 個模組
**原封不動載進來跑**，不另寫一套比對規則——另寫一套就是「頁面講一套、JSON-LD 講另一套」的病根。
它照抄 `loadCardsData()` 與 `calculateCashback()` 的完整流程，四個步驟一個都不能少：

1. `filterExpiredRates` —— 濾過期活動
2. `mergeDataSearchExclusions` —— 併入 SearchExclusions 排除規則
3. `buildCardItemsIndex` —— 建搜尋索引
4. 商家名若等於某快捷搜尋的 `displayName` → 走 `handleQuickSearch` 的多關鍵詞路徑

**踩過的坑（都會讓清單與畫面對不上，且不會報錯）**：

- `js/core-utils.js` 會把 `console.log/warn` 靜音。傳給 vm 的 `console` 必須是獨立物件，
  否則它連 Node 這邊的 console 一起關掉，除錯時畫面全黑
- 模組頂層的 `let cardsData` 是 vm context 的**語彙綁定**，不是 global 屬性——
  從外面 `ctx.cardsData = x` 只會多一個沒人看的變數，必須用 `runInContext` 從裡面指派
- 漏掉 `mergeDataSearchExclusions` → linepay 頁多出「LINE Pay 找體驗 APP」，排名整個變了
- `calculateCashback` 每處理完一個匹配項就先排序才累加，最後才總排一次。JS 的 sort 是穩定
  排序，少了那個先排，同分的卡片順序就會不一樣

**驗證方式（改了 `js/` 或這支工具就要重跑）**：

```bash
node tools/build-merchant-pages.js --verify   # 用 Playwright 開真頁，逐筆比對畫面 vs 烤進去的清單
```

這是「Node 版引擎 == 前端引擎」的唯一證明。不一致就是兩邊分岔了，先修再部署。

**接在哪**：`tools/deploy-version.sh`（CF Pages build command）在注入 `?v=` **之前**先跑生成器
——生成出來的頁帶 `?v=dev` 佔位，靠後面那圈迴圈一起換成 commit hash。生成失敗直接讓 build 掛掉
是刻意的：商家頁的病就是「沒人發現它過期」，吞掉錯誤等於把病放回去。

## 12. Apps Script 相關的既有文件

- `apps-script/README.md`：權益監控（checkWatchlist、Watchlist 工作表、MONITOR_CONFIG）
- `BENEFITS-AUTOMATION-PLAN.md`：權益自動化整體規劃
- `CARDS-DATA-CACHE-README.md`：快取機制教學
- `FIRESTORE-RULES-README.md`：Firestore 規則套用教學（規則本體在 repo 的 `firestore.rules`，唯一正確版本）

## 教訓記錄

- [2026-07-15] 搜尋結果出現 6/30 已過期的新戶活動 → script.js 載入時的過期過濾用了只認「/」格式的舊 `parseDateString()`，ISO `period_end` 解析成 null 被當「無截止日」永久保留（正是第 8 節陷阱，該函數早於規則存在）→ 已改用 `parseISODate()` 並刪除 `parseDateString`；日後看到「過期活動還在顯示」先查日期解析格式，並 Grep 手刻 `.split('/')`/`.split('-')` 的日期比較
- [2026-08-16] 監控摘要連寫三件不實變動（新增通路/活動下架/新增海外加碼，全部沒發生） → diffSegments_ 是「切段比字串」，商店清單重排會讓每一刀位置全變、產生 8 行假新增；且 classifyDiff_ 從來沒拿到舊版全文，等於逼 AI 猜「這是不是新的」 → 加 refineDiff_ 改比「詞」（零新詞才丟整行）＋把舊全文與程式算出的新詞清單一起餵給 AI；規則 D2：要說新增，該詞必須出現在新詞清單裡
- [2026-09-02] 改好生成器、站長也貼進 Sheets 了，線上 promos 頁尾仍缺新連結，連兩輪以為沒貼 → `promos.html`／`sitemap.xml` 是**匯出時**才重生的，改生成器不會讓線上立刻變；而線上服務的就是 repo 這份 → 生成檔的改動要「兩手都做」：改 `apps-script/cards-export.gs`（＋貼進 Sheets）**並且**把 repo 那份手動補成與生成器輸出**逐字一致**（不一致會在下次匯出來回打架）；驗收方式是請站長觸發一次匯出後 grep 該關鍵字
（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
