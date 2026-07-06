# Pick My Card - 信用卡回饋大師

這是一個幫助用戶比較信用卡回饋的 Web 應用程式。

## 專案架構

### 主要檔案
- `script.js`: 核心邏輯（搜尋、計算回饋、顯示卡片詳情）——檔案頂部有**區塊目錄**（用關鍵字搜尋跳區）
- `index.html`: 主頁面
- `cards.data`: 卡片資料（由 Google Sheets Apps Script 生成）
- `cards.version`: cards.data 的版本指標（快取用；**更新 cards.data 必同步更新**，見 `CARDS-DATA-CACHE-README.md`）
- `styles.css`: 樣式
- `faq.html` / `faq.js` / `faq.css`: FAQ 頁（獨立載入，不共用 script.js）
- `firestore.rules`: Firestore 安全規則的唯一正確版本（套用教學見 `FIRESTORE-RULES-README.md`）

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

**解析函數**（2026-07-06 起共用 `extractPlaceholderField()` 抽取 `{欄位名}`；檔內搜尋 "Placeholder 解析" 跳到該區）：
- `parseCashbackRate(rate, card, levelSettings)`: 解析 rate（**同步函數**，2026-07-06 去掉了多餘的 async；呼叫端的 `await` 不受影響）
  - 從 levelSettings 中動態讀取對應欄位值
- `parseCashbackRateSync(rate, levelData)`: 精簡版，用於排序（不需要 card 物件、不顯示警告）
- `parseCashbackCap(cap, card, levelSettings)`: 解析 cap（無效值回 null = 無上限）

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

### 10. 精選活動（Spotlight）

**用途**：常駐顯示一區編輯精選活動（「🔥 精選活動」），與使用者的搜尋無關。

**位置（重要）**：`#spotlight-section` 不在 `<main>` 內，而是 `.container` 直系子節點、緊接在 `.app-layout` 之後 —— 視覺上是一條跨越 sidebar+main 兩欄的全寬橫帶，位於所有搜尋結果（含 results / coupon / parking / cardholder promo）下方。`box-sizing: border-box; width: 100%; padding: 24px 30px 30px; border-top: 1px solid #e5e7eb`。

**資料來源**：
- Google Sheets 的 `Highlights` 工作表，由 Apps Script 匯出成 `cardsData.spotlights` 陣列
- 欄位：`merchant`, `rate`, `description`, `card_name`, `card_id`, `cap`, `deadline`, `order`, `active`, `category`（選填）
- `rate`/`order` 為數字，`active` 為布林，`deadline` 為 `YYYY/MM/DD` 字串
- `category` 為選填字串（如「外送平台」「加油站」「計程車」），有值才顯示紫色分類 chip

**顯示方式（輪播）** (script.js `renderSpotlights` 一帶)：
- 每頁 3 張卡片（`SPOTLIGHT_PAGE_SIZE`），每 6 秒（`SPOTLIGHT_INTERVAL`）自動跳下一組，會循環
- 「看下一組」按鈕可手動換頁、下方有頁碼圓點；滑鼠移入卡片或開啟 modal 時暫停輪播
- 最多顯示 12 則（`SPOTLIGHT_MAX`），依 `order` 升冪排序，`active === false` 不顯示
- 只有 1 頁（≤3 則）時自動隱藏「看下一組」與圓點
- 區塊顯示時機跟著 `showToolSections()`／`hideToolSections()`（登入或「開始使用」後才出現）

**卡片視覺（固定高度）**：
- `.spotlight-card { min-height: 260px }` —— 跨頁切換不會跳動
- `.spotlight-desc` 用 `-webkit-line-clamp: 2` + `height: 2.8em` 永遠保留 2 行高度
- `.spotlight-meta` `min-height: 76px`（3 列容量），meta-row 用 nowrap + ellipsis 避免長卡名換行
- 卡名（💳 那一列）為粗體（`.spotlight-meta-card > span:last-child`）
- 分類 chip 用紫色（`#6d28d9` on `#ede9fe`），刻意避開 sidebar `.card-chip` 的藍色系

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
- `index.html`: `#spotlight-section`（`.app-layout` 之後的全寬橫帶）與 `#spotlight-modal`
- `script.js`: `renderSpotlights` 一系列函數 + `compareSpotlightMerchant` + `openSpotlightModal` / `buildSpotlightModalBody` / `findSpotlightCardActivities`
- `styles.css`: `.spotlight-*`（白底、回饋率粗體綠字、「剩 N 天」徽章於 0–14 天顯示）

### 11. 卡片詳情頁與卡片圖片資產

**卡片詳情頁** (`#card-detail-modal`)，由 `showCardDetail(cardId)` 開啟：
- Modal 標題就是 `card.name`（不再有「詳情」後綴）
- Header 左上角有一張卡片圖（見下），右邊接卡名
- 不再顯示「信用卡官網連結:」標籤（卡全名以純文字呈現）
- 新戶活動區塊也不再有「官網連結」連結（之前少人點擊）

**進入詳情頁的入口**：
1. 搜尋結果卡片點擊
2. Sidebar 卡片 chips（如果啟用）
3. **`#cards-selection` / `#owned-cards-selection` 的每張卡 ⓘ 小按鈕**（管理加入比較的卡片 / 我的信用卡 modals）
   - 由 `_renderCardSelectionModal` 注入；click handler 呼叫 `showCardDetail(card.id)` 並 `stopPropagation()`，不會誤勾選 checkbox
   - 詳情 modal 開在原 modal 之上，關掉後回到原 modal

**卡片圖片資產**（選填，2026-05-31 新增）：
- 路徑慣例：`assets/images/cards/<card.id>.png`
- **不用改 Google Sheet / Apps Script** —— 前端依 `card.id` 直接組路徑
- 缺圖時用 `<img onerror>` 隱藏整個 `<img>` 元素，layout 自動退回沒圖版本
- 兩個顯示位置：
  - **詳情頁 header**：`.card-detail-image`，`height: 56px; max-width: 96px; object-fit: contain`
  - **選擇 modal tile**：`.card-checkbox-image`，`height: 70px; max-width: 140px; object-fit: contain`，`margin-left: 22px`（= checkbox 14px + row gap 8px，讓圖片左緣對齊卡名而非 checkbox）
- 直/橫卡都支援：`object-fit: contain` 自動 letterbox；透明背景 PNG 沒邊框問題

**「我的信用卡」/「管理加入比較的卡片」modal tile 排版**：
- 共用渲染：`_renderCardSelectionModal(config)` —— 一份程式碼餵兩個 modal（不同 `selectionId`、`tagFilterChipsId` 等）
- `.card-checkbox` 為 column flex（`align-items: flex-start`）：
  - 上：`.card-checkbox-row`（checkbox + 卡名 label + ⓘ 詳情按鈕）
  - 下：`.card-checkbox-image`（左對齊卡名）
- 卡名粗體（限定於 `#cards-selection` / `#owned-cards-selection` `.card-checkbox-label`，不影響行動支付 modals 共用的同 class）
- Grid 維持 `repeat(auto-fit, minmax(200px, 1fr))`：桌機 2 欄、窄螢幕 1 欄

**Body scroll lock refcount**（疊層 modals 需要）：
- `disableBodyScroll()` / `enableBodyScroll()` 改為 depth-counter（`bodyScrollLockDepth`）
- 上層 modal 關掉時不會誤放開捲動鎖（外層 modal 還在）
- 完全相容單一 modal 用法

### 12. cashbackModel 計算模型（2026-07-01 新增）

**用途**：以資料驅動的方式,決定每個 `cashbackRate` 項目要用哪種算法,取代散在程式裡的寫死判斷。

**資料位置**：Cards Data 工作表新增 `cashbackModel_N` 欄位（對齊 `rate_N`/`items_N`/`cap_N`,N=1-17）。
- **不必一次加滿 17 欄**：只加到實際會用到的槽位即可（`getValue()` 讀不到會回空字串）
- Apps Script 匯出時,把非空值掛到該 rateGroup 的 `cashbackModel` 屬性
- **絕大多數項目留空** = 走預設行為（見下）

**命名規則（2026-07-05 重新設計）**：**分隔符號本身決定 stacking 還是 waterfall**,不再靠固定字串表去查——每個 rate_N 槽位獨立決定,同一張卡不同活動可以一個 stacking、一個 waterfall,互不影響：

| 分隔符號 | 引擎 | `rate_N` 慣例 |
|---|---|---|
| `+`（如 `basic+domesticBonusRate`） | **stacking(疊加)**：各成分**同時**作用於全額,各有獨立上限 | `rate_N` 只填**指定通路本身的加碼率**（不含 basic） |
| `>`（如 `rate>basic>domesticBonusRate`） | **waterfall(瀑布)**：cap 用完,**溢出**才進下一個成分 | `rate_N`（第一個成分）是**已含 basic 的總率** |
| `rate`（單一字串,無分隔符） | **通路完全排除在卡片一般消費之外**：cap 內用 rate_N,**溢出算 0(不列入任何回饋)**——不是套用 basic！用於「這個通路本來就不算一般消費」的情境（如大戶卡「悠遊卡自動加值」） | `rate_N` 是已含 basic 的總率 |
| （空白） | **舊預設**:卡有加碼欄位 → 視同隱性 `rate>basic>domesticBonusRate`（只支援國內,無法標記海外）；卡沒有加碼欄位 → 簡單路徑,cap 內用 rate_N、**溢出算 basicCashback**（一般卡片的正常行為,如玉山 Ubear 卡） | 已含 basic 的總率 |

**國內／海外一律由字串裡有沒有 `domesticBonusRate` / `overseasBonusRate` 決定**（`+`、`>` 兩種語法通用),不看其他判斷、不看搜尋詞、不看 item 名稱：
- `basic+domesticBonusRate`、`rate+basic+domesticBonusRate` → stacking,國內（Sport 卡 Apple Pay、大戶卡一般國內消費）
- `basic+overseasBonusRate`、`rate+basic+overseasBonusRate` → stacking,海外
- `rate>basic>domesticBonusRate` → waterfall,國內（DBS Eco 國內項目、凱基誠品,也可以留空繼續吃舊預設）
- `rate>basic>overseasBonusRate` → waterfall,海外（DBS Eco「日本/韓國/…實體消費」等海外指定通路項目,**必須明確填,不能留空**）

**⚠️ 已停用**：`rate+basic` 這個舊名稱**不再是** `rate` 的別名——因為含 `+`,現在會被當成 stacking 解析,含義完全改變。若資料裡還有 `rate+basic`,請改成純 `rate`。

**三種計算函數**：
- `calculateStackedCashback()`（**stacking / 疊加**）：各成分**同時**作用於全額,各有獨立上限。
  引擎會自動加總 `顯示回饋率 = rate_N(指定通路) + 基本 + 加碼` 顯示給用戶看（如 3%+1%+1%=5%）。
  範例 Sport 卡 Apple Pay：`rate_N` 填 `3`,`cashbackModel` 填 `rate+basic+domesticBonusRate`,消費 6,000 算式為
  `1%×6,000 + 1%×min(6,000,5,000) + 3%×min(6,000,10,000) = 290`,畫面顯示回饋率 **5%**。
- `calculateLayeredCashback()`（**waterfall / 瀑布**）：一層用完上限,**溢出**才進下一層（各層不重疊）。
  Layer1 指定通路(cap 內) → Layer2 基本(溢出) → Layer3 加碼(溢出,加碼 cap 內)。
  盲填空白時仍是這個引擎的舊預設行為(僅支援國內)；要明確標記海外,填 `rate>basic>overseasBonusRate`。**`rate_N` 是已含基本的總率**（與 stacking 相反）。
- **簡單路徑**（無加碼卡的空白預設）：cap 內用 `rate_N`（已含基本）、溢出用 `basicCashback`。
- **`rate` 專用路徑**：cap 內用 `rate_N`,**溢出算 0**——跟簡單路徑的差異只在溢出：這個通路的錢完全不算進卡片的一般消費/基本回饋（如大戶卡悠遊卡加值,消費超過 cap 的部分不會退回去算 1% 基本回饋,而是 0）。**填 `rate` 前務必先確認這個通路是否真的被卡片排除在一般消費外**,如果只是「沒有加碼」但仍算一般消費,應該留空,不要填 `rate`。

**選擇邏輯** (script.js:3554 一帶 `const cashbackModel = matchedRateGroup?.cashbackModel`)：
`cashbackModel === 'rate'` → 專用路徑(溢出 0)；含 `+` → stacking；含 `>` → waterfall；空白 → 落回舊預設(依卡片是否有加碼欄位判斷,溢出算 basicCashback)。

**⚠️ 海外判斷是明確化的（2026-07-01 起）**：
- **移除**原本散在 3 處的國家關鍵字清單（`overseasKeywords`,自動偵測 item 名稱含「日本/海外…」）
- 不論 stacking 或 waterfall,海外一律由字串裡的 `overseasBonusRate` 關鍵字明確指定,絕不自動偵測
- 影響:有 `overseasBonusRate` 的卡（ctbc-uniopen、ctbc-linepay-card、dbs-eco、firstbank-ileo、tbb-artfun、大戶卡）的「國外」item,若要走海外加碼**必須**明確填對應 model,留空一律當國內算

**溢出/共用邏輯的整併現況（2026-07-06 已完成）**：
- `getOverflowRate(card, items)`：簡單路徑與 findUpcomingActivity 的溢出共用；內含 `meta廣告/google廣告 → overseasCashback` 特例（台新 Richart 除外）
- `resolveBaseRate(card, isOverseas)` / `resolveBonusComponent(...)`：waterfall/stacking 共用的基本率與加碼成分
- **領券活動的溢出「刻意」直接用 `basicCashback`**（不走 getOverflowRate）——廣告平台特例不適用於領券商家，程式內有註解說明
- 無匹配時的基本回饋 fallback 統一在 `buildBasicCashbackResult(card, amount)`（原本複製 2 份）
- 搜尋結果合併統一在 `mergeResultsByActivity(resultList)`（原本在 calculateCashback 內複製 4 份）
- Placeholder 解析共用 `extractPlaceholderField()`；`parseCashbackRate` 已改為**同步**函數（呼叫端的 `await` 不受影響）

**計算明細（計算機圖示按鈕）**：
- 只要有算出回饋金額,一律至少產生 1 層明細,按鈕永遠顯示（`result.calculationLayers.length > 0`）
- 明細以「卡片內部抽屜」形式呈現（append 進 `.card-result`/`.coupon-item` 內部,不是網格兄弟節點），不會打亂其他卡片排版
- 用 `openBreakdownBtn` 追蹤目前開啟的按鈕：點同一顆關閉,點不同顆關閉舊的並開新的
- stacking / waterfall / **簡單路徑（cap+溢出,2 層）** 都會產生 layers
- `showCalcBreakdown()` (script.js:5249 一帶) 讀 `dataset.calcLayers` 渲染

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

## 用戶資料儲存鐵則（2026-07-06 全面清理後）

### localStorage 讀取一律走安全 helpers
- `readLocalJSON(key, fallback)` / `readLocalJSONArray(key, fallback)`（script.js 開頭「localStorage 安全讀取 helpers」區）
- 壞資料（污染的 JSON）→ 回傳 fallback **並移除該 key**（自我修復），絕不讓 JSON.parse 拋錯中斷流程
- **禁止**在任何新程式碼直接寫 `JSON.parse(localStorage.getItem(...))`
- 載入的卡片 ID 用 `filterKnownCardIds()` 過濾已下架卡片——**只在記憶體過濾，絕不回寫**

### 訪客資料在登入時的處理原則（統一，無彈窗）
- **雲端有值 → 雲端為準**；**雲端沒值 → 靜默帶入訪客值並上傳**
- 訪客 key 兩種情況都會被「消化移除」，避免留在共用電腦洩漏給下一位使用者
- 信用卡/行動支付/我的信用卡：在各自的 load 函數內處理
- 配卡表/級別/筆記/免年費/結帳日/CUBE 發卡組織：統一在 `absorbGuestPersonalData(userData)`
- 高價值資料（級別、筆記）上傳失敗時**保留 key 下次重試**，低價值資料 best-effort

### 卡片級別的本機 key 有 uid 區分
- 登入者：`cardLevel_<uid>_<cardId>`；訪客：`cardLevel-<cardId>`（沿用舊 key）
- 一律透過 `cardLevelLocalKey(cardId)` 取 key
- **登入狀態下絕不讀寫訪客 key**——那可能是共用電腦上「別人」的選擇（過去曾因此跨用戶洩漏級別）

### 登出清理
- `clearPersonalLocalDataOnSignOut(uid)`：清所有帶 uid 的鏡像 + 非 uid 區分的個人 key
- **只能在「用戶親自按登出」時呼叫**，不能放進 onAuthStateChanged 的登出分支（訪客每次開頁都會觸發該分支，會誤刪訪客資料）

## 安全慣例（2026-07-06 起）

- **所有動態 innerHTML 內容一律 `escapeHtml()`**；多行文字用 `escapeHtmlMultiline()`
- **例外（刻意允許 HTML）僅兩處**：公告 modal 的 `fullText`、FAQ 的 `answer`——都是管理者控制的 Google Sheets 內容，程式內有註解標明；**絕不**把用戶輸入餵進這兩個欄位
- **動態 href 一律先過 `sanitizeUrl()`**（只允許 http/https，擋 `javascript:`）
- **Firestore 安全規則在 repo 的 `firestore.rules`**（唯一正確版本）；改規則先改 repo 再貼 console，教學見 `FIRESTORE-RULES-README.md`

## cards.data 快取（2026-07-06 起）

- 前端先抓 `cards.version`（不快取）→ 用版本號抓 `cards.data?v=<版本>`（可快取）
- **更新 cards.data 時務必同步更新 cards.version**（改成任何不同的短字串即可，建議 `YYYYMMDD-N`）
- 忘了更新不會壞：使用者最多延遲約 10 分鐘看到新資料
- 詳見 `CARDS-DATA-CACHE-README.md`

## Debug 日誌

- 正式環境 `console.log`/`console.warn` 被檔案頂部的閘門靜音；**網址加 `?debug=1` 重新開啟**
- `console.error` 永遠輸出——錯誤處理請用 error，不要用 log
- 熱迴圈（每卡片/每項目執行的路徑）不要為了 log 做額外計算（如 `.map().join()`）

## 近期修改模式

### 最近的技術決策

0. **2026-07-06: 全站清理（資料穩定性/安全/速度/整併）**
   - localStorage 安全讀取 helpers + 自我修復（解決詳情頁被污染資料弄掛的整類問題）
   - 卡片級別本機 key 改 uid 區分；登入合併統一為「靜默補位」；登出清理個人資料
   - XSS 修復（搜尋詞轉義）+ `sanitizeUrl()` + `firestore.rules` 進 repo
   - cards.data 版本指標快取（cards.version）；正式環境 console 靜音（?debug=1 開啟）
   - 整併：mergeResultsByActivity（原 4 份）、buildBasicCashbackResult（原 2 份）、
     extractPlaceholderField（原 3 份正則）、刪 6 個死函數、刪未引用 webp/測試頁
   - 回歸驗證：12 組搜尋、前後所有結果卡（卡名/回饋率/金額）完全一致
   - 詳見上方「用戶資料儲存鐵則」「安全慣例」「cards.data 快取」章節

1. **2026-07-01: cashbackModel 資料驅動計算模型**
   - 新增 `cashbackModel_N` 欄位,以資料決定每個 rate 項目走哪種算法（stacking / rate-only / 預設）
   - 新增 `calculateStackedCashback()`（疊加,各成分不同上限,如 Sport 卡）
   - 移除散在 3 處的國家關鍵字清單,海外改由 `...+overseasBonusRate` 明確指定
   - 簡單路徑（cap+溢出）也產生 `calculationLayers`,讓 ⓘ 計算明細按鈕顯示
   - 空 cashbackModel = 維持原本行為,對現有資料零影響
   - 詳見「關鍵技術概念 → 12. cashbackModel 計算模型」

2. **2026-05-31: 詳情頁入口 + 卡片圖片資產 + 連結瘦身**
   - 「我的信用卡」/「管理加入比較的卡片」modals 的每張卡 row 旁加 ⓘ peek button，呼叫 `showCardDetail()`；觸發時 `stopPropagation()` 不會誤勾 checkbox
   - `disableBodyScroll`/`enableBodyScroll` 改為 refcount，疊層 modals 不會誤放開捲動鎖
   - 卡片圖片慣例 `assets/images/cards/<card.id>.png`，缺圖用 `<img onerror>` 隱藏，不用改 Apps Script
   - 兩處使用：詳情頁 header 左上、選擇 modal tile（卡名下方、左對齊卡名）
   - 詳情頁標題去掉「詳情」後綴；移除「信用卡官網連結:」標籤；新戶活動 card 拿掉「官網連結」
   - 詳見「關鍵技術概念 → 11. 卡片詳情頁與卡片圖片資產」

2. **2026-05-31: 精選活動視覺定稿**
   - 標題改為「🔥 精選活動」（原「本週亮點活動」），拿掉「共 N 則」徽章
   - 區塊改為 `.container` 直系子節點、跨越 sidebar+main 兩欄的全寬橫帶（不在 `<main>` 內），位於所有搜尋結果之下
   - 固定卡片高度（`min-height: 260px`）+ desc 強制 2 行（`-webkit-line-clamp: 2` + `height: 2.8em`），輪播時不會跳動
   - 新增選填 `category` 欄位 → 紫色分類 chip（與藍色系 sidebar `.card-chip` 區隔）
   - 卡名（💳 那一列）改粗體
   - ⓘ modal 只保留「馬上辦卡」CTA（之前還有「查看完整卡片詳情」「比較這個通路」已移除），CTA 顯示在卡名旁

3. **2026-05-27: 新增精選活動（Spotlight）**
   - 編輯精選活動區，資料來自 `Highlights` 工作表（JSON key `spotlights`）
   - 自動輪播：每頁 3 張、6 秒換頁、可手動「看下一組」、頁碼圓點，最多 12 則
   - 「比較這個通路」帶入主搜尋（merchant 對到快捷 displayName 則走快捷搜尋）
   - ⓘ 開啟獨立 modal，顯示卡片 `cashbackRates` 中涵蓋該 merchant 的真實活動，找不到則退回編輯文字
   - 詳見「關鍵技術概念 → 10. 精選活動（Spotlight）」

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

6. **🔒 絕對不可以擅自改寫用戶已儲存的級別（saved card level）**：
   - 用戶選過的級別（如國泰 CUBE 卡 Level 1/2/3）存在 localStorage（訪客）或 Firestore（登入者），是**用戶個人資料**，等同他的設定偏好
   - **唯一允許呼叫 `saveCardLevel()` 覆寫的情況只有兩種**：
     1. 用戶「親自」在下拉選單點選新級別（level 選擇器的 `onchange` handler）
     2. 大小寫／空格不同的**同一個**級別正規化（如 `level1` → `Level 1`，仍是同一格，只是格式）
   - **嚴禁的反模式**：當「用戶存的級別在目前 `levelSettings` 中找不到」時，退回預設值來**顯示**是對的（避免詳情頁當機），但**絕對不可以順手把預設值 `saveCardLevel()` 存回去**。因為「找不到」常常是**暫時的**（剛更新 cards.data 的瞬間、匯出短暫不完整），存回去會**永久抹掉**用戶真正的選擇（且無法還原）。正確做法：只用預設值 render 這一次，`levelSettings` 之後含回該級別時會自己恢復。詳見 `resolveCardLevel()`（script.js 尾段）——它刻意**不**呼叫 saveCardLevel。
   - **「防詳情頁當機」與「改寫記憶」是兩件事**：防當機靠的是「顯示時退回預設值」，不是「把記憶改寫成預設值」。修 bug 時不要把這兩件事重新綁在一起。

### ⚠️ 更改 Google Sheet 的「級別名稱」時（資料維護者須知）

級別的**名稱字串本身就是它的識別碼**（用戶存的就是這串字，選單顯示的也是這串字，沒有另外的顯示欄位）。因此：

- **改級別名稱 = 讓所有存舊名稱的用戶「對不上」** → 他們會看到預設級別，要手動重選才恢復（不會當機、不會壞資料，但個人偏好等於被遺忘）。
- **能不改就不要改**：把級別名稱當「永久編號」。想改給用戶看的說明文字，改 `level-note`，不要動級別名稱。
- **非改不可時的安全做法**：先準備好「舊名稱 → 新名稱」對照，請工程/AI 在程式裡加一段一次性「級別改名遷移對照」（讓 `getCardLevel` 讀到舊名稱時自動翻譯成新名稱後再存回），這樣既有用戶的選擇才不會遺失。目前程式**只**支援大小寫／空格差異的自動比對（script.js:3300 一帶），**不**支援真正的改名，所以真改名一定要另外加對照表。

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

**⚠️ 每次修改 `script.js` 或 `styles.css` 後，必做**：
- 更新 `index.html` 中這兩行的 `?v=` 版本號（目前格式：`YYYYMMDDHHMMSS`，UTC 時間）：
  ```html
  <link rel="stylesheet" href="styles.css?v=...">
  <script src="script.js?v=..." defer></script>
  ```
- **原因**：瀏覽器/CDN 用網址（含 `?v=`）快取檔案。版本號沒變 → 使用者可能吃到舊的 CSS/JS，但 HTML 結構已經是新的，會出現「毛胚」（無樣式、跑版）畫面
- 兩個檔案的版本號**同步更新為同一個值**即可，不需分開管理
- `faq.html` 也引用 `styles.css` 與 `faq.js`——改到這兩個檔案時 faq.html 的 `?v=` 也要更新
- 這一步不是選填的優化，而是每次部署前的必要動作

**⚠️ 每次更新 `cards.data` 後，必做**：同步更新 `cards.version`（詳見 `CARDS-DATA-CACHE-README.md`）

## Google Sheets 與 Apps Script 資料架構

### 資料表結構

系統使用 Google Sheets 作為資料來源，透過 Apps Script 匯出成 `cards.data` (Base64 編碼的 JSON)。

**主要工作表**：

1. **Cards Data** - 信用卡基本資料和回饋規則
   - 必填欄位：`id`, `name`, `fullName`, `basicCashback`, `annualFee`, `feeWaiver`, `website`, `tags`
   - 回饋欄位：`rate_N`, `items_N`, `cap_N`, `category_N`, `conditions_N`, `periodStart_N`, `periodEnd_N` (N=1-17)
   - **計算模型**：`cashbackModel_N`（選填,只需加到實際用到的槽位;見「關鍵技術概念 → 12」）
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

10. **Highlights** - 精選活動（2026-05-27 新增；2026-05-31 加 `category`）
    - 欄位：`merchant`, `rate`, `description`, `card_name`, `card_id`, `cap`, `deadline`, `order`, `active`, `category`（選填）
    - 匯出 JSON key 為 `spotlights`
    - `merchant` 為單一搜尋詞（一個商家，或剛好等於某個快捷搜尋的 displayName）
    - `category` 為選填字串（如「外送平台」「加油站」），有值才在卡上顯示紫色分類 chip
    - 詳見「關鍵技術概念 → 10. 精選活動（Spotlight）」

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
  spotlights: [...]            // 精選活動（Highlights 工作表）
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

**最近的大型變更**（2026-07-06，branch `claude/website-cleanup-architecture-d7ambz`）：
- 全站清理：資料穩定性（安全讀取/uid 級別/登出清理/靜默補位）、安全（XSS/sanitizeUrl/firestore.rules）、速度（cards.version 快取/console 靜音/刪未用檔案）、整併（合併重複邏輯/刪死碼）
- 回歸驗證：12 組搜尋前後結果完全一致

---

**更新日期**：2026-07-06
