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

**支援的 Placeholder**：
- `{rate}`: 從 levelSettings[selectedLevel].rate 解析
- `{specialRate}`: 從 levelSettings[selectedLevel].specialRate 解析
- `{cap}`: 從 levelSettings[selectedLevel].cap 解析

**解析函數**：
- `parseCashbackRate(rate, card, levelSettings)`: 非同步解析 rate（script.js:1917-1950）
- `parseCashbackRateSync(rate, levelData)`: 同步版本，用於排序（script.js:1953-1964）
- `parseCashbackCap(cap, card, levelSettings)`: 解析 cap（script.js:1967-1997）

**重要**：必須傳遞正確的 `levelSettings` 參數，否則 placeholder 會被解析為 0

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

## 近期修改模式

### 最近的技術決策

1. **2024-12: 支援 {cap} placeholder + 移動級別回饋率顯示**
   - 在 cap_N 欄位支援 {cap}
   - "各級別回饋率"移到級別選擇器旁邊

2. **2024-12: 合併顯示 + 條件分組**
   - 相同 rate/cap 的活動合併顯示
   - 條件按 category 分組，不列出個別通路

3. **2024-12: CUBE 卡修正**
   - 包含在級別回饋率顯示中
   - 使用 specialRate 而非 rate

4. **2024-12: 玉山 Uni Card 可折疊條件**
   - 只有 Uni Card 使用可展開按鈕
   - 其他卡片直接顯示條件

5. **2024-12: DBS Eco 佈局修正**
   - level-note 移到下拉選單下方
   - 級別回饋率支援換行

6. **2024-12: 修復空 specialItems 問題**
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

### 🎯 開發指引

**修改搜尋邏輯時**：
- 確保 hasLevels 卡片正確取得 levelData
- 測試 placeholder 是否正確解析
- 檢查空 specialItems 的情況

**修改顯示邏輯時**：
- 注意 CUBE, DBS Eco, Uni Card 的特殊處理
- 避免重複顯示資訊
- 保持 UI 簡潔

**新增 placeholder 時**：
- 在 parseCashbackRate/parseCashbackCap 中處理
- 同時更新同步版本（用於排序）
- Apps Script 也需要相應修改

## Git 工作流程

**目前分支**：`claude/special-rate-lookup-01Mh9Bqp2AkD3YsbJkDQbVNf`

**最近的 commits**：
- Fix search and display issues for cards with hasLevels but no/empty specialItems
- Fix DBS Eco card detail page layout
- Add support for {cap} placeholder and move level rates display

---

**更新日期**：2024-12-12
