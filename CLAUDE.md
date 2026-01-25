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

**hasLevels 卡片統一架構**（2026-01-25 更新）：

所有 hasLevels 卡片（包括 CUBE 卡）現在都使用**統一的資料結構**：
- `hasLevels: true` - 標記為分級卡片
- `levelSettings` - JSON 格式，定義各級別的 rate/specialRate/cap 等參數
- `cashbackRates` - 陣列格式，所有回饋項目都在這裡
- `category` 欄位 - 用於標記項目所屬類別（如「切換『玩數位』方案」）

#### **舊架構（已廢棄）**：
- ❌ `specialItems` - 不再使用（CUBE 卡）
- ❌ `specialItemsWithCategory` - 不再使用（CUBE 卡）
- ❌ `generalItems` - 不再使用（CUBE 卡）

#### **新架構範例（CUBE 卡）**：
```javascript
{
  "hasLevels": true,
  "levelSettings": {
    "level1": { "specialRate": 2.0 },
    "level2": { "specialRate": 3.0 },
    "level3": { "specialRate": 3.3 }
  },
  "cashbackRates": [
    {
      "rate": 2,
      "items": ["Line Pay"],
      "cap": 5882
    },
    {
      "rate": "{specialRate}",  // 使用 placeholder
      "items": ["ChatGPT", "Notion"],
      "cap": 500000,
      "category": "切換「玩數位」方案"  // 類別標記
    }
  ]
}
```

**關鍵特性**：
- 使用 `category` 欄位識別類別（如「玩數位」、「樂饗購」、「趣旅行」）
- 支援 `{specialRate}` 等 placeholder，從 levelSettings 動態解析
- 所有項目統一放在 `cashbackRates`，簡化前端邏輯

### 3. 搜尋邏輯（calculateCardCashback）

**統一流程**（2026-01-25 簡化）：

所有卡片（包括 CUBE 卡）都使用相同的搜尋邏輯：

1. **取得級別設定**（如果有 hasLevels）：
   - 從 Firestore 讀取用戶選擇的級別
   - 取得對應的 levelSettings

2. **檢查 cashbackRates**：
   - 使用索引 `card._itemsIndex` 快速查找
   - 解析 placeholder（如 `{specialRate}`, `{rate}`, `{cap}`）
   - 從 levelSettings 動態讀取對應值

3. **返回匹配結果**：
   - 包含 rate, cap, matchedItem, category 等資訊
   - 支援多個匹配項目（陣列格式）

**重要**：
- 不再有 specialItems/generalItems 的特殊處理
- 所有卡片統一使用 cashbackRates + category 架構
- CUBE 卡透過 category 欄位（如「切換『玩數位』方案」）識別類別

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
- CUBE 卡: 從 cashbackRates 按 category 分組顯示（generateCubeSpecialContent 函數）
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

**搜尋範圍**：
- ✅ cashbackRates items（信用卡回饋項目）
- ✅ couponCashbacks merchant（領券型活動商家）
- ✅ **benefits merchants（停車折抵優惠地點）**（新增於 2026-01-24）

**向後兼容**（保留但不使用）：
- ⚠️ specialItems（舊架構，CUBE 卡已不使用）
- ⚠️ generalItems（舊架構，CUBE 卡已不使用）

**Coupon 搜尋邏輯**：
- 解析 merchant 欄位（逗號分隔的字符串）
- 每個 merchant 項目都會被檢查匹配
- 使 quick search 也能找到 coupon 活動

**停車折抵搜尋邏輯**（詳見 section 9）：
- 由 displayParkingBenefits() 獨立處理
- 支援快捷搜尋傳遞多個關鍵詞

**推薦連結搜尋邏輯**（2026-01-25 新增）：
- 由 displayReferralLink() 處理
- 從 cardsData.referralLinks 匹配商家名稱
- 顯示在搜尋結果下方、免責聲明上方

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

## Loading 指示器與性能監控 (2026-01-25)

### 全局 Loading Overlay

**組件位置**：
- HTML: `#global-loading-overlay`（fixed 定位，z-index: 10000）
- CSS: `.global-loading-overlay`, `.loading-spinner-large`, `.loading-text`
- JS: `loadingOverlay` 工具物件

**loadingOverlay 工具物件**：
```javascript
loadingOverlay = {
  show(message)        // 顯示 loading，傳入自訂訊息
  hide()               // 隱藏 loading，記錄執行時間
  wrap(asyncFn, msg)   // 包裝異步函數，自動處理 show/hide
}
```

**使用範例**：
```javascript
// 方法 1: 手動控制
loadingOverlay.show('正在計算回饋...');
await doSomething();
loadingOverlay.hide();

// 方法 2: 自動包裝
await loadingOverlay.wrap(async () => {
  await doSomething();
}, '處理中...');
```

### 應用場景

**1. 行動支付比較**（必定顯示）：
- 觸發：點擊「📊 比較所有行動支付回饋」
- Loading 位置：Modal 內嵌 spinner + "正在計算所有行動支付回饋..."
- 原因：需遍歷所有支付 × 所有卡片，計算量大

**2. 主搜尋功能**（智能顯示）：
- 觸發條件（滿足任一）：
  - 比較超過 5 張卡片
  - 搜尋結果有超過 3 個匹配項目
- Loading: 全螢幕 overlay
- 原因：複雜搜尋可能耗時 >500ms

**設計理念**：
- 避免 loading 閃爍（<300ms 的操作不顯示）
- 只在預期耗時 >500ms 時才顯示
- 用戶體驗優先

### 性能監控機制

**Console 日誌格式**：
```
⏱️ Loading started: 正在計算回饋...
⏱️ Loading finished in 1234.56ms (1.23s)
📊 比較了 15 個行動支付，找到 12 個有回饋
```

**實作方式**：
- 使用 `performance.now()` 測量時間
- 自動記錄執行時間（精確到 0.01ms）
- 包含操作摘要（如比較了幾張卡、找到幾個結果）

**查看方式**：
- 開啟瀏覽器開發者工具（F12）
- 切換到 Console 分頁
- 執行操作後查看時間日誌

## 近期修改模式

### 最近的技術決策

1. **2026-01-25: CUBE 卡資料結構重構** ⭐ 重大變更
   - 移除 specialItems/specialItemsWithCategory/generalItems 欄位
   - 改為統一使用 cashbackRates + category 欄位
   - category 欄位包含「切換『玩數位』方案」等字樣來識別類別
   - 前端 generateCubeSpecialContent() 完全重寫，從 cashbackRates 讀取並按類別分組
   - Apps Script hasLevels 處理邏輯大幅簡化（只保留 levelSettings 處理）
   - 影響：所有未來的分級卡片都應遵循此架構

2. **2026-01-25: 全局 Loading 指示器系統**
   - 新增 loadingOverlay 工具物件（show/hide/wrap 方法）
   - 實作全局 loading overlay UI（半透明背景 + 白色卡片 + spinner）
   - 新增性能監控機制（console.log 記錄執行時間）
   - 智能顯示邏輯：
     - 行動支付比較：一定顯示（Modal 內嵌 spinner）
     - 主搜尋：5+ 卡片或 3+ 匹配項目時顯示（全螢幕 overlay）
   - 避免 loading 閃爍（<300ms 不顯示）

3. **2026-01-25: 推薦連結功能**
   - 新增 displayReferralLink() 函數
   - 黃色漸層 UI 設計（background: linear-gradient）
   - 支援從 cardsData.referralLinks 讀取資料
   - 顯示位置：搜尋結果下方、免責聲明上方
   - 點擊按鈕在新視窗開啟推薦連結
   - Google Sheets 新增 ReferralLinks 工作表

4. **2026-01-24: 修復停車折抵優惠快捷搜尋**
   - 快捷搜尋時，停車折抵優惠需要使用所有關鍵詞匹配
   - displayParkingBenefits() 新增 searchKeywords 參數
   - 避免只用顯示名稱（如 "所有停車"）匹配導致找不到結果
   - 在 calculateCashback() 調用時傳遞 `currentQuickSearchOption?.merchants`

5. **2026-01-01: 擴展 Placeholder 支援任意欄位**
   - 修改 parseCashbackRate 函數，使用正則表達式匹配任意 placeholder
   - 支援 `{rate_1}`, `{cap_1}`, `{overseasBonusRate}`, `{domesticBonusRate}` 等
   - 從 levelSettings 中動態讀取對應欄位值
   - 同步更新 parseCashbackRateSync 和 parseCashbackCap 函數
   - 解決永豐大戶卡等卡片顯示 NaN% 的問題

6. **2025-12-22: 分層回饋計算系統**
   - 實作 calculateLayeredCashback 函數處理多層獎勵結構
   - 支援 DBS Eco 等複雜卡片的三層計算（基本+加碼+指定項目）
   - 自動檢測海外/國內交易並套用對應加碼率
   - 每層獨立計算消費上限

7. **2025-12-22: 性能優化三項**
   - 建立搜尋索引：O(n³) → O(1)，提升 500-800ms
   - 日期狀態緩存：減少重複計算，提升 150-250ms
   - DocumentFragment 批量 DOM：減少 reflow，提升 100-200ms
   - 總提升：從 1.2-2.5 秒 → 0.2-0.7 秒

8. **2025-12-22: Bug 修復**
   - 修復即將開始活動排序（按回饋金額排序）
   - 修復 DBS Eco「禾乃川」搜尋錯誤（rate_hide 只對 hideInDisplay=true 生效）
   - 加入 coupon 搜尋支援（findMatchingItem 也搜尋 couponCashbacks）

## 重要注意事項

### ⚠️ 常見陷阱

1. **CUBE 卡已不使用 specialItems/generalItems**（2026-01-25 更新）：
   ```javascript
   // ❌ 錯誤（舊架構）
   if (card.specialItems) {
     // CUBE 卡現在沒有這個欄位，會永遠是 false
   }

   // ✅ 正確（新架構）
   if (card.cashbackRates) {
     // 從 category 欄位識別類別
     const categoryRates = card.cashbackRates.filter(rate =>
       rate.category && rate.category.includes('玩數位')
     );
   }
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
- **不要依賴 specialItems/generalItems**（CUBE 卡已廢棄）
- 確認停車折抵優惠的快捷搜尋整合

**修改顯示邏輯時**：
- 注意 CUBE, DBS Eco, Uni Card 的特殊處理
- CUBE 卡使用 generateCubeSpecialContent()，從 cashbackRates 按 category 分組
- 避免重複顯示資訊
- 保持 UI 簡潔

**新增分級卡片時**（2026-01-25 更新）：
- 遵循 CUBE 卡的新架構：cashbackRates + category 欄位
- 不要使用 specialItems/generalItems（已廢棄）
- 在 category 欄位使用清楚的類別名稱（如「切換『XXX』方案」）
- Apps Script 只需處理 hasLevels + levelSettings，不需特殊邏輯

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
  cards: [...],
  payments: [...],
  quickSearchOptions: [...],
  merchantPayments: {...},
  faq: [...],
  announcements: [...],
  searchHints: {...},
  benefits: [...],
  referralLinks: [...]
}
```

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

### hasLevels 卡片處理邏輯（2026-01-25 簡化）

**舊架構**（已廢棄）：
```javascript
// ❌ 複雜的特殊處理（已移除）
if (card.hasLevels) {
  // 處理 specialItems_玩數位, specialItems_樂饗購, specialItems_趣旅行
  // 處理 generalItems_集精選, generalItems_來支付
  // 處理 specialItemsWithCategory
  // ... 大量特殊邏輯
}
```

**新架構**（簡化後）：
```javascript
// ✅ 統一處理
if (card.hasLevels) {
  // 只處理 levelSettings 和 levelLabelFormat
  const levelSettingsStr = getValue(row, headers, 'levelSettings');
  if (levelSettingsStr) {
    card.levelSettings = JSON.parse(levelSettingsStr);
  }
  addOptionalField(card, row, headers, 'levelLabelFormat');
}

// cashbackRates 在 hasLevels 區塊外處理（所有卡片統一）
card.cashbackRates = [];
for (let j = 1; j <= 17; j++) {
  const rate = getValue(row, headers, `rate_${j}`);
  const items = getValue(row, headers, `items_${j}`);

  if (rate && items) {
    const rateObj = {
      items: items.split(',').map(s => s.trim()),
      rate: /* 支援 placeholder */
    };

    // 讀取 category 欄位（用於 CUBE 卡等分類顯示）
    addOptionalField(rateObj, row, headers, `category_${j}`, 'string', 'category');

    card.cashbackRates.push(rateObj);
  }
}
```

**關鍵改進**：
- 不再有 specialItems/generalItems 的複雜分支邏輯
- hasLevels 區塊只處理級別設定，不處理項目
- 所有項目統一放在 cashbackRates，用 category 欄位區分
- Apps Script 代碼減少約 100 行

### 重要輔助函數

- `getValue(row, headers, fieldName)` - 安全讀取欄位值
- `addOptionalField(obj, row, headers, fieldName, type, targetName)` - 新增選填欄位
- `formatDateToSlash(dateValue)` - 日期格式轉換 (YYYY/M/D)
- `generateSearchTerms(id, name)` - 生成搜尋別名

## Git 工作流程

**目前分支**：`claude/add-referral-link-popup-lnYZi`

**最近的 commits**（2026-01-25）：
- Fix CUBE card display by removing dependency on deprecated fields
- Add global loading indicators and performance monitoring
- Update CLAUDE.md: add Apps Script and data architecture documentation
- Add referral link display feature for merchant promotions
- Refactor: use function parameter instead of global state lookup (2026-01-24)

**重大變更摘要**：
- **CUBE 卡重構**：移除 specialItems/generalItems，改用 cashbackRates + category
- **Loading 系統**：新增全局 loading overlay 和性能監控
- **推薦連結**：新增商家推薦連結顯示功能
- **Apps Script 簡化**：hasLevels 處理邏輯減少約 100 行

---

**更新日期**：2026-01-25
