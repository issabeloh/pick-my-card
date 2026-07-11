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

## 8. Apps Script 相關的既有文件

- `apps-script/README.md`：權益監控（checkWatchlist、Watchlist 工作表、MONITOR_CONFIG）
- `BENEFITS-AUTOMATION-PLAN.md`：權益自動化整體規劃
- `CARDS-DATA-CACHE-README.md`：快取機制教學
- `FIRESTORE-RULES-README.md`：Firestore 規則套用教學（規則本體在 repo 的 `firestore.rules`，唯一正確版本）

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
