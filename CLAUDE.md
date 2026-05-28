# Pick My Card - 信用卡回饋大師

這是一個幫助用戶比較信用卡回饋的 Web 應用程式。

## 專案架構

### 主要檔案
- `script.js`: 核心邏輯（搜尋、計算回饋、顯示卡片詳情）
- `index.html`: 主頁面
- `cards.data`: 卡片資料（由 Google Sheets Apps Script 生成）
- `styles.css`: 樣式

### 資料來源
- 資料來自 Google Sheets，透過 Apps Script 轉換成 JSON
- Apps Script 已支援 `{specialRate}`, `{rate}`, `{cap}` placeholder

## 關鍵技術概念

### 1. Placeholder 解析系統

**支援的 Placeholder**（2026-01-01 更新：支援任意欄位）：
- `{rate}`: 從 levelSettings[selectedLevel].rate 解析
- `{specialRate}`: 從 levelSettings[selectedLevel].specialRate 解析
- `{cap}`: 從 levelSettings[selectedLevel].cap 解析
- **✨ 任意欄位**：`{rate_1}`, `{cap_1}`, `{overseasBonusRate}` 等都支援！

**解析函數**：
- `parseCashbackRate(rate, card, levelSettings)`: 非同步解析 rate（script.js:2793-2819）
  - 使用正則表達式 `/^\{(.+)\}$/` 匹配任意 placeholder
  - 從 levelSettings 中動態讀取對應欄位值
- `parseCashbackRateSync(rate, levelData)`: 同步版本，用於排序（script.js:2822-2837）
- `parseCashbackCap(cap, card, levelSettings)`: 解析 cap（script.js:2840-2873）
  - 同樣支援任意欄位的 placeholder

**重要**：
- 必須傳遞正確的 `levelSettings` 參數，否則 placeholder 會被解析為 0
- Placeholder 只適用於 `hasLevels=true` 的卡片
- 欄位名稱必須在 levelSettings 中存在

### 2. 卡片分級系統

**hasLevels 卡片的兩種類型**：

#### Type A: hasLevels + specialItems（如 DBS Eco）
- `specialItems` 包含特定通路名單
- `levelSettings` 定義各級別的 rate/cap
- 顯示邏輯：先顯示 cashbackRates（如果有），再顯示 specialItems

#### Type B: hasLevels + cashbackRates（如玉山 Uni Card）
- **無 specialItems**（或空陣列）
- `cashbackRates` 中使用 `{rate}`, `{cap}` placeholder
- 每個 rate 可以有自己的 items 和 conditions
- 使用 `category` 欄位標記條件所屬類別

**關鍵條件判斷**：
```javascript
// 檢查是否無 specialItems
if (!card.specialItems || card.specialItems.length === 0)
```

### 3. 搜尋邏輯（calculateCardCashback）

**流程** (script.js:1464-1718)：

1. **有 specialItems 的 hasLevels 卡片**：
   - 優先檢查 cashbackRates（支援 placeholder）
   - 如無匹配，檢查 specialItems
   - CUBE 卡特殊處理：用 specialRate 和 generalItems

2. **無 specialItems 的卡片**（包括 hasLevels）：
   - 先取得 levelData（如果 hasLevels）
   - 檢查 cashbackRates，傳遞 levelData 給解析函數
   - 支援 {rate} 和 {cap} placeholder

3. **一般卡片**（hasLevels=false）：
   - 直接檢查 cashbackRates
   - levelData 為 null（不使用 placeholder）

### 4. 卡片詳情頁顯示

**級別選擇器區域** (script.js:2932-2998)：
- 下拉選單選擇級別
- "各級別回饋率"顯示在選擇器旁邊（同一行，flexbox 排版）
- DBS Eco: level-note 顯示在下拉選單下方
- 支援文字換行（flex-wrap: wrap）

**回饋內容區域** (script.js:3031-3500+)：
- **不再重複顯示"各級別回饋率"**（已在選擇器旁顯示）
- 合併相同 rate/cap 的活動（使用 Map 分組）
- 按 category 顯示條件（不是按通路）

**特殊處理**：
- 玉山 Uni Card: 條件可展開/收起（toggleConditions 函數）
- CUBE 卡: 使用 specialRate，顯示"無上限"
- DBS Eco: 特殊的 cap 說明格式

### 5. 資料合併與分組

**cashbackRates 合併邏輯** (script.js:3047-3077, 3194-3223)：
```javascript
// 按 rate+cap 分組
const groupKey = `${parsedRate}-${parsedCap || 'nocap'}`;
// 合併 items 和 conditions
group.items.push(...rate.items);
group.conditions.push({category, conditions});
```

**條件顯示**：
- 按 category 分組（如："行動支付：xxxxx"）
- 使用 `getCategoryDisplayName()` 轉換顯示名稱

### 6. 搜尋功能（findMatchingItem）

**搜尋範圍** (script.js:1215-1400)：
- ✅ cashbackRates items（信用卡回饋項目）
- ✅ specialItems（特殊通路項目）
- ✅ generalItems（CUBE 卡一般項目）
- ✅ couponCashbacks merchant（領券型活動商家）
- ✅ **benefits merchants（停車折抵優惠地點）**（新增於 2026-01-24）

**Coupon 搜尋邏輯**：
- 解析 merchant 欄位（逗號分隔的字符串）
- 每個 merchant 項目都會被檢查匹配
- 使 quick search 也能找到 coupon 活動

**停車折抵搜尋邏輯**（詳見 section 9）：
- 由 displayParkingBenefits() 獨立處理
- 支援快捷搜尋傳遞多個關鍵詞

### 7. hideInDisplay 和 rate_hide 機制

**hideInDisplay**：
- 用途：標記不在卡片詳情頁顯示的 cashbackRate
- 主要用於：國外消費（避免跟 overseasCashback 重複顯示）
- 這些項目仍然可以被搜尋

**rate_hide**：
- 用途：提供不顯示在前台的固定回饋率
- 只有 DBS Eco 卡使用
- 避免跟 overseasCashback 重複顯示
- 只對 `hideInDisplay=true` 的項目生效

**使用邏輯** (script.js:1910)：
```javascript
if (levelSettings && levelSettings.rate_hide !== undefined
    && rateGroup.hideInDisplay === true) {
    finalRate = levelSettings.rate_hide;
}
```

### 8. 分層回饋計算系統

**用途**：處理多層獎勵結構的卡片（如 DBS Eco），每層有獨立的回饋率和消費上限。

**觸發條件** (script.js:2186-2208)：
- 卡片有 `levelSettings` 且包含 `overseasBonusRate` 或 `domesticBonusRate`
- 自動檢測是否為海外交易（根據項目名稱）

**計算函數** (script.js:1840-1904 `calculateLayeredCashback`)：
- Layer 1: 基本回饋（無上限，適用全額）
- Layer 2: 加碼回饋（國內/海外，有消費上限）
- Layer 3: 指定項目加碼（額外回饋率，有消費上限）

**範例**：DBS Eco 精選卡友消費 NT$30,000 到日本
- 基本 1.2%: 30000 × 1.2% = 360
- 海外加碼 1.8%: 30000 × 1.8% = 540（上限 50000）
- 指定國家 3.8%: 21053 × 3.8% = 800（上限 21053）
- **總計: 1,700**

### 9. 停車折抵優惠系統（Parking Benefits）

**資料結構**：
- 儲存在 `cardsData.benefits` 陣列中
- **一張卡可以有多個停車方案，ID 重複是正常的**
  - 範例：ctbc-uniopen 卡有家樂福、夢時代、統一時代等多個停車方案
  - 每個方案是獨立的物件，分別顯示
  - 不同地點、不同優惠內容、不同條件都需要獨立記錄

**資料欄位**：
```javascript
{
  id: "ctbc-uniopen",  // 卡片 ID（會重複）
  benefit_type: "parking",
  benefit_desc: "購物當日 2 小時（每日限1次）",
  merchants: ["夢時代購物中心停車場", "統一時代百貨高雄店"],
  conditions: "刷卡消費滿 500 元(含)以上",
  benefit_period: "2026/06/30",
  notes: "需使用實體卡刷卡",
  active: true
}
```

**搜尋與顯示邏輯** (script.js:3193-3269 `displayParkingBenefits`)：

**函數簽名**：
```javascript
function displayParkingBenefits(merchantValue, cardsToCheck, searchKeywords = null)
```

**參數說明**：
- `merchantValue`: 輸入框的值（如 "所有停車"）
- `cardsToCheck`: 要檢查的卡片陣列（用戶選擇的卡或全部卡）
- `searchKeywords`: 快捷搜尋的關鍵詞陣列（可選）

**搜尋邏輯**：
1. **快捷搜尋時**（searchKeywords 不為 null）：
   - 使用所有關鍵詞陣列匹配
   - 範例：`["停車", "嘟嘟房", "台灣聯通", "24TPS永固", "VIVI PARK"]`
   - 任一關鍵詞匹配 benefit.merchants 即成功

2. **一般搜尋時**（searchKeywords 為 null）：
   - 只用 merchantValue 匹配
   - 範例：`"家樂福"`

3. **匹配邏輯**：
   ```javascript
   searchTerm.includes(merchantItemLower) || merchantItemLower.includes(searchTerm)
   ```

**重要**：
- 快捷搜尋時必須傳遞 `searchKeywords` 參數
- 否則只會用顯示名稱（如 "所有停車"）匹配，會失敗
- 調用範例：
  ```javascript
  displayParkingBenefits(
      merchantValue,
      cardsToCompare,
      currentQuickSearchOption?.merchants  // 快捷搜尋關鍵詞
  );
  ```

### 10. 本週亮點活動（Spotlight）

**用途**：在搜尋框下方常駐顯示一區編輯精選活動（「🔥 本週亮點活動」），與使用者的搜尋無關。

**資料來源**：
- Google Sheets 的 `Highlights` 工作表，由 Apps Script 匯出成 `cardsData.spotlights` 陣列
- 欄位：`merchant`, `rate`, `description`, `card_name`, `card_id`, `cap`, `deadline`, `order`, `active`
- `rate`/`order` 為數字，`active` 為布林，`deadline` 為 `YYYY/MM/DD` 字串

**顯示方式（輪播）** (script.js `renderSpotlights` 一帶)：
- 每頁 3 張卡片（`SPOTLIGHT_PAGE_SIZE`），每 6 秒（`SPOTLIGHT_INTERVAL`）自動跳下一組，會循環
- 「看下一組」按鈕可手動換頁、下方有頁碼圓點；滑鼠移入卡片或開啟 modal 時暫停輪播
- 最多顯示 12 則（`SPOTLIGHT_MAX`），依 `order` 升冪排序，`active === false` 不顯示
- 只有 1 頁（≤3 則）時自動隱藏「看下一組」與圓點
- 區塊顯示時機跟著 `showToolSections()`／`hideToolSections()`（登入或「開始使用」後才出現）

**卡片上的兩個動作**：
- **「比較這個通路 →」** (`compareSpotlightMerchant`)：把 `merchant` 帶入主搜尋並計算
  - 若 `merchant` 完全等於某個快捷搜尋的 `displayName`（如 `所有加油站`）→ 觸發 `handleQuickSearch`（多關鍵詞）
  - 否則 → 當一般單一商家搜尋
  - ⚠️ `merchant` 一律是「單一搜尋詞」：要嘛一個商家、要嘛剛好等於某個快捷搜尋的 displayName（不支援多商家字串）
- **ⓘ 按鈕** (`openSpotlightModal`)：開啟獨立活動 modal

**ⓘ 活動 modal 顯示「卡片的真實活動」**（不是 sheet 的編輯文字）：
- 用 `card_id` 找到卡片，再用 `findSpotlightCardActivities(card, merchant)` 從 `card._itemsIndex` 找出涵蓋該 merchant 的 `cashbackRate`
- 關鍵字來源：merchant 對到快捷搜尋 displayName 時用該選項的 `merchants`，否則用 merchant 本身；先精確比對 items，無結果再退而做子字串比對
- 顯示該活動的真實 `rate`／`cap`／`period`／`conditions`／`items`（適用通路）；placeholder 用 `parseCashbackRateSync`／`parseCashbackCap` + 卡片第一個級別解析
- **找不到對應活動時，退回顯示 sheet 的編輯文字**（rate/description/cap/deadline）
- ⚠️ 目前只比對 `cashbackRates`；若卡片把通路放在 `specialItems`（分級卡特殊通路）會退回編輯文字
- **modal 內唯一的動作按鈕是「馬上辦卡」**（卡名旁，來自 `cardsData.cardApplyCtas[card_id]`，無連結則不顯示）；modal 內不放「查看完整卡片詳情」或「比較這個通路」

**相關檔案**：
- `index.html`: `#spotlight-section`（搜尋框下方）與 `#spotlight-modal`
- `script.js`: `renderSpotlights` 一系列函數 + `compareSpotlightMerchant` + `openSpotlightModal` / `buildSpotlightModalBody` / `findSpotlightCardActivities`
- `styles.css`: `.spotlight-*`（白底、回饋率粗體綠字、「剩 N 天」徽章於 0–14 天顯示）

## 性能優化 (2025-12-22)

### 1. 搜尋索引 (Items Index)

**建立索引** (script.js:365-426)：
- 頁面載入時為所有卡片建立 Map 索引
- 索引 cashbackRates/specialItems/generalItems 中的所有 items
- 成本：約 +50ms 頁面載入時間
- 效益：搜尋從 O(n³) 降到 O(1)

**使用索引** (script.js:1860-1920, 2038-2078)：
- 直接用 `card._itemsIndex.get(variant)` 查找
- 避免嵌套循環
- 搜尋速度提升 **500-800ms**

### 2. 日期狀態緩存 (Rate Status Cache)

**緩存機制** (script.js:192-202)：
- `rateStatusCache` Map 儲存活動期間的狀態
- 在 `calculateCashback()` 開始時清空
- 使用 `getCachedRateStatus()` 取代 `getRateStatus()`
- 效益：減少 **150-250ms** 重複計算

### 3. 批量 DOM 操作 (DocumentFragment)

**使用位置**：
- displayResults() (script.js:2260-2266)
- displayCouponCashbacks() (script.js:2462-2468)

**效益**：
- 從 20 次 reflow 減少到 1 次
- 減少 **100-200ms**

**總效能提升**：從 1.2-2.5 秒 → **0.2-0.7 秒**

## 近期修改模式

### 最近的技術決策

1. **2026-05-27: 新增本週亮點活動（Spotlight）**
   - 搜尋框下方常駐的編輯精選活動區，資料來自 `Highlights` 工作表（JSON key `spotlights`）
   - 自動輪播：每頁 3 張、6 秒換頁、可手動「看下一組」、頁碼圓點，最多 12 則
   - 「比較這個通路」帶入主搜尋（merchant 對到快捷 displayName 則走快捷搜尋）
   - ⓘ 開啟獨立 modal，顯示卡片 `cashbackRates` 中涵蓋該 merchant 的真實活動，找不到則退回編輯文字
   - 詳見「關鍵技術概念 → 10. 本週亮點活動（Spotlight）」

2. **2026-01-24: 修復停車折抵優惠快捷搜尋**
   - 快捷搜尋時，停車折抵優惠需要使用所有關鍵詞匹配
   - displayParkingBenefits() 新增 searchKeywords 參數
   - 避免只用顯示名稱（如 "所有停車"）匹配導致找不到結果
   - 在 calculateCashback() 調用時傳遞 `currentQuickSearchOption?.merchants`

2. **2026-01-01: 擴展 Placeholder 支援任意欄位**
   - 修改 parseCashbackRate 函數，使用正則表達式匹配任意 placeholder
   - 支援 `{rate_1}`, `{cap_1}`, `{overseasBonusRate}`, `{domesticBonusRate}` 等
   - 從 levelSettings 中動態讀取對應欄位值
   - 同步更新 parseCashbackRateSync 和 parseCashbackCap 函數
   - 解決永豐大戶卡等卡片顯示 NaN% 的問題

3. **2025-12-22: 分層回饋計算系統**
   - 實作 calculateLayeredCashback 函數處理多層獎勵結構
   - 支援 DBS Eco 等複雜卡片的三層計算（基本+加碼+指定項目）
   - 自動檢測海外/國內交易並套用對應加碼率
   - 每層獨立計算消費上限

4. **2025-12-22: 性能優化三項**
   - 建立搜尋索引：O(n³) → O(1)，提升 500-800ms
   - 日期狀態緩存：減少重複計算，提升 150-250ms
   - DocumentFragment 批量 DOM：減少 reflow，提升 100-200ms
   - 總提升：從 1.2-2.5 秒 → 0.2-0.7 秒

5. **2025-12-22: Bug 修復**
   - 修復即將開始活動排序（按回饋金額排序）
   - 修復 DBS Eco「禾乃川」搜尋錯誤（rate_hide 只對 hideInDisplay=true 生效）
   - 加入 coupon 搜尋支援（findMatchingItem 也搜尋 couponCashbacks）

6. **2024-12: 支援 {cap} placeholder + 移動級別回饋率顯示**
   - 在 cap_N 欄位支援 {cap}
   - "各級別回饋率"移到級別選擇器旁邊

7. **2024-12: 合併顯示 + 條件分組**
   - 相同 rate/cap 的活動合併顯示
   - 條件按 category 分組，不列出個別通路

8. **2024-12: CUBE 卡修正**
   - 包含在級別回饋率顯示中
   - 使用 specialRate 而非 rate

9. **2024-12: 玉山 Uni Card 可折疊條件**
   - 只有 Uni Card 使用可展開按鈕
   - 其他卡片直接顯示條件

10. **2024-12: DBS Eco 佈局修正**
   - level-note 移到下拉選單下方
   - 級別回饋率支援換行

11. **2024-12: 修復空 specialItems 問題**
   - 正確處理 specialItems = [] 的情況
   - 搜尋邏輯傳遞正確的 levelData 給解析函數
   - 移除 specialContent 中重複的級別回饋率顯示

## 重要注意事項

### ⚠️ 常見陷阱

1. **空陣列不是 falsy**：
   ```javascript
   // ❌ 錯誤
   if (!card.specialItems)

   // ✅ 正確
   if (!card.specialItems || card.specialItems.length === 0)
   ```

2. **levelData 必須正確傳遞**：
   ```javascript
   // ❌ 會導致 {rate} 解析為 0
   parseCashbackRate(rate, card, null)

   // ✅ 正確
   parseCashbackRate(rate, card, levelSettings)
   ```

3. **不要重複顯示級別回饋率**：
   - 只在級別選擇器旁邊顯示一次
   - specialContent 中不再顯示

4. **停車折抵優惠的重複 ID 是正常的**：
   - 一張卡可以有多種停車方案（不同地點、不同優惠內容）
   - 每個方案是獨立的物件，ID 會重複
   - 程式會正確遍歷並分別顯示所有方案
   - 範例：ctbc-uniopen 有家樂福、夢時代、統一時代等多個方案

5. **快捷搜尋時必須傳遞關鍵詞給停車折抵**：
   - displayParkingBenefits() 需要接收 searchKeywords 參數
   - 否則只會用顯示名稱（如 "所有停車"）匹配，會失敗
   - 正確調用：`displayParkingBenefits(merchantValue, cardsToCompare, currentQuickSearchOption?.merchants)`

### 🎯 開發指引

**修改搜尋邏輯時**：
- 確保 hasLevels 卡片正確取得 levelData
- 測試 placeholder 是否正確解析
- 檢查空 specialItems 的情況
- 確認停車折抵優惠的快捷搜尋整合

**修改顯示邏輯時**：
- 注意 CUBE, DBS Eco, Uni Card 的特殊處理
- 避免重複顯示資訊
- 保持 UI 簡潔

**新增 placeholder 時**：
- 在 parseCashbackRate/parseCashbackCap 中處理
- 同時更新同步版本（用於排序）
- Apps Script 也需要相應修改

## Google Sheets 與 Apps Script 資料架構

### 資料表結構

系統使用 Google Sheets 作為資料來源，透過 Apps Script 匯出成 `cards.data` (Base64 編碼的 JSON)。

**主要工作表**：

1. **Cards Data** - 信用卡基本資料和回饋規則
   - 必填欄位：`id`, `name`, `fullName`, `basicCashback`, `annualFee`, `feeWaiver`, `website`, `tags`
   - 回饋欄位：`rate_N`, `items_N`, `cap_N`, `category_N`, `conditions_N`, `periodStart_N`, `periodEnd_N` (N=1-17)
   - 領券活動：`couponMerchant_N`, `couponRate_N`, `couponConditions_N`, `couponPeriod_N`, `couponCap_N` (N=1-10)
   - 分級卡片：`hasLevels`, `levelSettings` (JSON 格式)

2. **Payments** - 行動支付資料
   - 欄位：`id`, `name`, `website`
   - 自動生成 `searchTerms` (別名對照表)

3. **QuickSearch** - 快捷搜尋選項
   - 欄位：`id`, `displayName`, `icon`, `merchants`, `order`
   - `merchants` 為逗號分隔的關鍵詞字串

4. **Merchant Payments** - 商家付款方式資訊
   - 欄位：`merchant`, `online_payment`, `offline_payment`, `source_url`, `last_updated`

5. **Search Hints** - 搜尋提示建議
   - 欄位：`keywords`, `suggestions`, `display_message`, `active`
   - `keywords` 為逗號分隔字串，會展開成多個 key

6. **FAQ** - 常見問題
   - 欄位：`id`, `category`, `question`, `answer`, `order`, `isActive`
   - 依 `order` 排序

7. **announcements** - 公告資訊
   - 欄位：`text`, `fullText`, `link`, `active`, `priority`, `date`
   - 依 `priority` 排序，限制最多 5 則

8. **Card Benefits** - 卡片優惠（停車折抵等）
   - 欄位：`id`, `benefit_type`, `benefit_desc`, `merchants`, `conditions`, `benefit_period`, `notes`, `active`
   - `merchants` 為陣列格式（逗號分隔會自動轉換）
   - **同一張卡可有多筆記錄**（不同地點、不同優惠）

9. **ReferralLinks** - 推薦連結（2026-01-24 新增）
   - 欄位：`merchant`, `url`, `description`, `active`
   - 用於顯示商家推薦註冊連結和優惠說明

10. **Highlights** - 本週亮點活動（2026-05-27 新增）
    - 欄位：`merchant`, `rate`, `description`, `card_name`, `card_id`, `cap`, `deadline`, `order`, `active`
    - 匯出 JSON key 為 `spotlights`
    - `merchant` 為單一搜尋詞（一個商家，或剛好等於某個快捷搜尋的 displayName）
    - 詳見「關鍵技術概念 → 10. 本週亮點活動（Spotlight）」

### Apps Script 匯出流程

**主要函數**：`exportToJSON()`

**執行順序**：
1. 執行 QA 檢查 (`runQACheck()`)
2. 讀取 Cards Data → 轉換成 `cards` 陣列
3. 讀取 Payments → 轉換成 `payments` 陣列
4. 讀取 QuickSearch → 轉換成 `quickSearchOptions` 陣列
5. 讀取 Merchant Payments → 轉換成 `merchantPayments` 物件
6. 讀取 Search Hints → 轉換成 `searchHints` 物件
7. 讀取 FAQ → 轉換成 `faq` 陣列
8. 讀取 announcements → 轉換成 `announcements` 陣列
9. 讀取 Card Benefits (`readCardBenefits()`) → 轉換成 `benefits` 陣列
10. 讀取 ReferralLinks (`readReferralLinks()`) → 轉換成 `referralLinks` 陣列
11. 組合所有資料成 JSON
12. Base64 編碼輸出為 `cards.data`

**匯出的 JSON 結構**：
```javascript
{
  lastUpdated: "...",
  cards: [...],
  payments: [...],
  quickSearchOptions: [...],
  merchantPayments: {...},
  faq: [...],
  announcements: [...],
  searchHints: {...},
  benefits: [...],
  referralLinks: [...],
  cashbackSites: [...],        // 領券/回饋網站
  newCardholderPromos: [...],  // 新戶活動
  cardApplyCtas: [...],        // 辦卡 CTA
  spotlights: [...]            // 本週亮點活動（Highlights 工作表）
}
```
> 註：`cashbackSites` / `newCardholderPromos` / `cardApplyCtas` 為現有結構（先前文件未列出），此處一併補上。

### 新增資料表的標準流程

當需要新增資料類型時（如推薦連結）：

1. **在 Google Sheets 新增工作表**
   - 定義欄位結構（第一行為 headers）
   - 通常包含 `active` 欄位控制啟用狀態

2. **撰寫讀取函數**（參考 `readCardBenefits()` 或 `getAnnouncements()`）
   ```javascript
   function readXxxData() {
     const sheet = ss.getSheetByName('SheetName');
     if (!sheet) return [];

     const data = sheet.getDataRange().getValues();
     const headers = data[0];
     const results = [];

     for (let i = 1; i < data.length; i++) {
       // 讀取並轉換資料
     }

     return results;
   }
   ```

3. **在 `exportToJSON()` 中調用**
   - 在 `const benefits = readCardBenefits();` 附近新增讀取
   - 在 `jsonContent` 物件中新增對應欄位
   - 在成功訊息中顯示匯出數量

4. **前端使用**
   - `cardsData.xxxData` 即可存取
   - 依需求實作搜尋/顯示邏輯

### 重要輔助函數

- `getValue(row, headers, fieldName)` - 安全讀取欄位值
- `addOptionalField(obj, row, headers, fieldName, type, targetName)` - 新增選填欄位
- `formatDateToSlash(dateValue)` - 日期格式轉換 (YYYY/M/D)
- `generateSearchTerms(id, name)` - 生成搜尋別名

## Git 工作流程

**目前分支**：`claude/add-points-expiry-info-AssTF`

**最近的 commits**（2026-01-24）：
- Refactor: use function parameter instead of global state lookup
- Fix parking benefits matching for quick search options
- Revert parking benefits fix - incorrect solution
- Remove BETA badge from page header

**停車折抵優惠修復**：
- 修復快捷搜尋不顯示停車折抵的問題
- 重構為使用函數參數而非全局變量查找
- 提升代碼可測試性和可維護性

---

**更新日期**：2026-05-27
