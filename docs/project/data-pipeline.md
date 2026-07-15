# 資料管線（Google Sheets → Apps Script → cards.data）

> 改「資料結構、匯出邏輯、cards.data、級別設定」前必讀。
> ⚠️ 主匯出程式 `exportToJSON()` 目前**只存在 Google Sheets 的 Apps Script 專案裡**，repo 的
> `apps-script/` 只備份了權益監控（watchlist-monitor.gs）。改匯出邏輯＝到 Sheets 裡改，改完建議把副本補進 `apps-script/`。

## 1. 資料流

Google Sheets（多工作表）→ Apps Script `exportToJSON()` → Base64 JSON → repo 的 `cards.data` ＋ 同步更新 `cards.version` → 前端載入。

**查 cards.data 內容的唯一正確姿勢**（488KB base64 單行，絕不 Read）：
```bash
base64 -d cards.data > <scratchpad>/cards.json
jq '.cards[] | select(.id=="dbs-eco")' <scratchpad>/cards.json
```

## 2. 工作表結構

1. **Cards Data** —— 信用卡基本資料和回饋規則
   - 必填：`id, name, fullName, basicCashback, annualFee, feeWaiver, website, tags`
   - 回饋欄位：`rate_N, items_N, cap_N, category_N, conditions_N, periodStart_N, periodEnd_N, hideInDisplay_N`（N=1-21，匯出迴圈上限 21）
   - 計算模型：`cashbackModel_N`（選填，只加用到的槽位；語義見 `docs/project/cashback-engine.md` 第 6 節）
   - 領券活動：`couponMerchant_N, couponRate_N, couponConditions_N, couponPeriod_N, couponCap_N`（N=1-10）
   - 分級卡：`hasLevels`, `levelSettings`（JSON 格式）
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
11. **Watchlist** —— 權益監控清單（見 `apps-script/README.md`，與 cards.data 匯出無關）
12. **SearchExclusions** —— 搜尋排除規則（term, excludedItems 逗號分隔, active）。前端載入時由
    `mergeDataSearchExclusions()` 併入 script.js 的 `searchExclusionMap`（程式內只留兜底預設）。
    語義：搜尋詞（含 fuzzy 展開後的別名）＝term 時，item 名與 excludedItems **小寫全等**者不匹配。
    例：`term=sia, excludedItems=AsiaYo`（新加坡航空的別名 sia 子字串誤中 a"sia"yo）。
    ⚠️ 此工作表尚未建立；建立時 Apps Script 讀取函數照第 7 節標準流程，匯出 JSON key 為
    `searchExclusions`，格式 `[{ term, excludedItems: [...] }]`。工作表建好前，規則暫時直接加在
    script.js 的 `searchExclusionMap`。

## 3. exportToJSON() 匯出流程

順序：`runQACheck()` → Cards Data → Payments → QuickSearch → Merchant Payments → Search Hints → FAQ → announcements → `readCardBenefits()` → `readReferralLinks()` → 組 JSON → Base64 輸出。

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

**重要輔助函數**：`getValue(row, headers, fieldName)` 安全讀欄位；`addOptionalField(obj, row, headers, fieldName, type, targetName)`；`formatDateToSlash(dateValue)`（YYYY/M/D）；`generateSearchTerms(id, name)`。

## 4. 匯出 guard 鐵則（rate=0 陷阱，2026-07-09 血淚教訓）

**匯出迴圈（`rate_N` 槽位，隱藏活動也走同一支）不可以用 `if (rate && items)` 當 guard**——
`0 && items` 是 falsy，會把 `rate_N=0` 的 stacking 槽整組丟掉（如 `meta廣告`/`google廣告`，
`cashbackModel=…+overseasBonusRate`、指定加碼成分為 0）。症狀：搜尋零結果、cards.data 裡根本沒有該 item。

**正確做法**：只有 `items` 沒填才跳過；`rate` 用 `parseFloat` 解析，`0` 放行、非數字才整組不匯出
（placeholder 如 `{specialRate}` 是 truthy 字串，不受影響）。

**匯出後快速自檢**：解 base64，「非 hideInDisplay 的 `rate===0` 槽數量」不該是 0：
```bash
base64 -d cards.data | jq '[.cards[].cashbackRates[]? | select(.rate==0 and (.hideInDisplay|not))] | length'
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
  載入 `cards-export.gs`、餵 `base64 -d cards.data` 解出來的 JSON，呼叫
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
- **前端 `promos.js` 只做「已經是資料」之上的互動**：剩幾天徽章即時重算（避免生成當下算好的
  天數過幾天就過時）、篩選 chips、排序切換（deadline / 依卡片）、「立即申辦」點擊送 GA4——
  不 fetch 任何東西，頁面本身就是完整資料。

## 10. Apps Script 相關的既有文件

- `apps-script/README.md`：權益監控（checkWatchlist、Watchlist 工作表、MONITOR_CONFIG）
- `BENEFITS-AUTOMATION-PLAN.md`：權益自動化整體規劃
- `CARDS-DATA-CACHE-README.md`：快取機制教學
- `FIRESTORE-RULES-README.md`：Firestore 規則套用教學（規則本體在 repo 的 `firestore.rules`，唯一正確版本）

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
