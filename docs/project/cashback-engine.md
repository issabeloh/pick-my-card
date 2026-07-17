# 回饋計算與搜尋引擎（script.js 核心邏輯）

> 改「搜尋、回饋計算、匹配邏輯」前必讀。行號是 2026-07-11 快照，可能漂移——
> **一律先 Grep 關鍵字定位**（script.js 檔案頂部有區塊目錄），行號只當參考。

## 1. Placeholder 解析系統

**支援的 Placeholder**（支援任意欄位）：
- `{rate}` / `{specialRate}` / `{cap}`：從 `levelSettings[selectedLevel]` 對應欄位解析
- 任意欄位也支援：`{rate_1}`, `{cap_1}`, `{overseasBonusRate}` 等

**解析函數**（共用 `extractPlaceholderField()` 抽取 `{欄位名}`；檔內搜尋 "Placeholder 解析"）：
- `parseCashbackRate(rate, card, levelSettings)`：解析 rate（**同步函數**；呼叫端殘留的 `await` 不影響正確性）
- `parseCashbackRateSync(rate, levelData)`：精簡版，用於排序（不需 card 物件、不顯示警告）
- `parseCashbackCap(cap, card, levelSettings)`：解析 cap（無效值回 null = 無上限）

**鐵則**：
- 必須傳正確的 `levelSettings`，否則 placeholder 解析為 0：
  ```javascript
  // ❌ 會導致 {rate} 解析為 0
  parseCashbackRate(rate, card, null)
  // ✅ 正確
  parseCashbackRate(rate, card, levelSettings)
  ```
- Placeholder 只適用於 `hasLevels=true` 的卡片；欄位名必須存在於 levelSettings
- 新增 placeholder 時：`parseCashbackRate` / `parseCashbackCap` / 同步版三處都要改，Apps Script 也要對應修改

## 2. 卡片分級系統（hasLevels）

兩種類型：

**Type A: hasLevels + specialItems**（如 DBS Eco）
- `specialItems` 是特定通路名單；`levelSettings` 定義各級別 rate/cap
- 顯示順序：先 cashbackRates（如果有），再 specialItems

**Type B: hasLevels + cashbackRates**（如玉山 Uni Card）
- 無 specialItems（或空陣列）；`cashbackRates` 內用 `{rate}`/`{cap}` placeholder
- 每個 rate 可有自己的 items 和 conditions；`category` 欄位標記條件所屬類別

**鐵則——空陣列不是 falsy**：
```javascript
// ❌ 錯誤
if (!card.specialItems)
// ✅ 正確
if (!card.specialItems || card.specialItems.length === 0)
```

## 3. 搜尋計算流程（calculateCardCashback，約 script.js:1464-1718）

1. **有 specialItems 的 hasLevels 卡**：先查 cashbackRates（支援 placeholder）→ 無匹配再查 specialItems。CUBE 卡特殊處理：用 specialRate 和 generalItems
2. **無 specialItems 的卡（含 hasLevels）**：先取 levelData（若 hasLevels）→ 查 cashbackRates 並把 levelData 傳給解析函數
3. **一般卡（hasLevels=false）**：直接查 cashbackRates，levelData 為 null（不用 placeholder）

## 4. findMatchingItem 搜尋範圍（約 script.js:1215-1400）

搜尋涵蓋：cashbackRates items、specialItems、generalItems（CUBE）、couponCashbacks merchant（逗號分隔逐一比對）、benefits merchants（停車折抵，由 displayParkingBenefits 獨立處理）。

**誤傷防範**：
- 搜尋詞會經 `fuzzySearchMap` 雙向展開（含反向：所有映射到同值的 key）。**展開出的短英文別名可能子字串誤中無關 item**（例：「新加坡航空」→ 別名 `sia` → 誤中 a"sia"yo）。英文字界保護（Grep "word boundary"）只做在 `term.includes(item)` 方向，`item.includes(term)` 方向刻意不做——因為用戶手打部分字串（如 `eats`）要能命中連寫 item（如 `UberEats`）
- 個案誤傷用 `searchExclusionMap` 修（搜尋詞→排除 item 小寫全等清單）；規則可從 SearchExclusions 工作表維護（→ `docs/project/data-pipeline.md` 第 2 節第 12 項）

## 5. hideInDisplay 與 rate=0 語義

- `hideInDisplay`：標記不在詳情頁顯示的 cashbackRate（Sheet 一般編號槽位加 `hideInDisplay_N=TRUE`；舊 `_hide`/`_hide_1` 專用欄位已於 2026-07-11 併入一般槽位並刪除），主要用於國外消費／一般國內消費（避免與詳情頁其他區塊重複）。**仍然可被搜尋，計算邏輯與一般活動完全相同**
- **rate=0 是明確語義：「此活動沒有指定通路加碼成分」**。stacking 模型允許 rate=0（只算基準＋加碼成分，`if (rate > 0 || shouldUseStackedCalculation)`）；rate=0 配空 model 或 `rate`/waterfall 沒有意義（會算出 0）
- `rate_hide` 覆寫已於 2026-07-09 移除；levelSettings 的 `rate_hide`/`cap_hide` 欄位已退役，前端不再讀取
- **隱藏活動標準配方**（大戶卡為例，值自動跟用戶選的級別；N 為該活動所在槽位）：
  - 一般國內消費：`rate_N=0`、`cashbackModel_N=basic+domesticBonusRate`、cap 留空、`hideInDisplay_N=TRUE`
  - 國外：`rate_N=0`、`cashbackModel_N=overseasCashback+overseasBonusRate`、cap 留空、`hideInDisplay_N=TRUE`（stacking 基準層由 `resolveBaseRate` 決定，海外模型自動用 overseasCashback；卡片沒有 overseasBonusRate 也適用——成分為 0 的層自動跳過，總率＝overseasCashback）
  - 期間限定的特別總率（如兆豐 BT21 舊 4%）不適用 0+model：維持數字總率、model 留空（走簡單路徑）
- ⚠️ Apps Script 匯出端的 rate=0 陷阱見 `docs/project/data-pipeline.md`「匯出 guard 鐵則」

## 6. cashbackModel 計算模型（資料驅動，2026-07-01 起）

資料位置：Cards Data 工作表 `cashbackModel_N` 欄位（對齊 rate_N/items_N/cap_N，N=1-17，只加用到的槽位）。
**分隔符號本身決定引擎**，每個 rate_N 槽位獨立、互不影響：

| 分隔符號 | 引擎 | `rate_N` 慣例 |
|---|---|---|
| `+`（如 `basic+domesticBonusRate`） | **stacking（疊加）**：各成分同時作用於全額，各有獨立上限 | 只填指定通路本身的加碼率（**不含 basic**） |
| `>`（如 `rate>basic>domesticBonusRate`） | **waterfall（瀑布）**：cap 用完，溢出才進下一成分 | 第一成分是**已含 basic 的總率** |
| `rate`（單一字串） | 通路**完全排除**在一般消費外：cap 內用 rate_N，**溢出算 0**（不是套 basic！）例：大戶卡「悠遊卡自動加值」 | 已含 basic 的總率 |
| （空白） | 舊預設：卡有加碼欄位 → 隱性 `rate>basic>domesticBonusRate`（只支援國內）；卡無加碼欄位 → 簡單路徑：cap 內 rate_N、溢出算 basicCashback | 已含 basic 的總率 |

**國內／海外一律由字串裡有沒有 `domesticBonusRate`/`overseasBonusRate` 決定**（`+`、`>` 通用），
不看搜尋詞、不看 item 名稱、不自動偵測（原本 3 處國家關鍵字清單已於 2026-07-01 移除）。
有 `overseasBonusRate` 欄位的卡（ctbc-uniopen、ctbc-linepay-card、dbs-eco、firstbank-ileo、tbb-artfun、大戶卡）
的「國外」item 要走海外加碼**必須明確填** model（如 `rate>basic>overseasBonusRate`），留空一律當國內算。

**⚠️ 舊別名已失效，但 `rate+basic` 是合法寫法**：2026-07-05 命名規則重設計前，`rate+basic` 曾是 `rate`（排除型）的別名；現在含 `+` 一律當 stacking 解析（rate_N 與 basic 各自作用於全額，rate_N 不含 basic）。**這是合法且使用中的寫法**（2026-07-13 資料擁有者確認，全表約 37 槽），不要「清理」它。只有「2026-07-05 前以排除型意圖填寫」的舊資料才需要改成純 `rate`；判定意圖是資料擁有者的事，不是 session 可自行推斷的。

**⚠️ 填 `rate` 前必先確認**該通路真的被卡片排除在一般消費外；若只是「沒有加碼」但仍算一般消費，應留空。

**計算函數**：
- `calculateStackedCashback()`（stacking）：各成分同時作用於全額、各自上限。顯示回饋率 = rate_N＋基本＋加碼 自動加總（如 3%+1%+1%=5%）。範例 Sport 卡 Apple Pay 消費 6,000：`1%×6,000 + 1%×min(6,000,5,000) + 3%×min(6,000,10,000) = 290`，顯示 5%
  - **「寫什麼才加什麼」gate（Fix B，2026-07-16 起）**：stacking 的**基本層與加碼層都只在 `cashbackModel` 字串明確列出對應成分時才加**，不再無條件加卡片級 `basicCashback`/`domesticBonusRate`/`overseasBonusRate`：
    - 加碼層（Layer 2）：`applyBonus = model.includes('domesticBonusRate') || model.includes('overseasBonusRate')`。例：`rate+basic` 不加卡片級加碼；`basic+domesticBonusRate` 才加。
    - 基本層（Layer 1）：`applyBase = model.includes('basic') || model.includes('overseasCashback')`（海外 model 用 `basic` 寬鬆指代 overseasCashback base，故兩者任一即算有列基準）。例：`rate+basic` 加基本；`rate+domesticBonusRate`（沒寫 basic）**不加**基本。
    - 注意「單獨 `rate`」與「留空」不走 stacking、不受此 gate：單獨 `rate`＝排除型（cap 內 rate、溢出 0，不加 basic）；留空＝簡單路徑（cap 內 rate、溢出 basic）。
  - 三處實作必須一致（否則顯示與計算對不上）：`calculateStackedCashback()` 的 `applyBonus`/`applyBase` 參數（Layer 1/2 各自 `if (applyX && rate > 0)`，且 `totalRate` 顯示率同步 gate）、`getDisplayRate()`、`rateCompositionButtonHtml()` 都各自算這兩個 flag。呼叫端（約 script.js:4040 附近）算 `stackedApplyBonus`/`stackedApplyBase` 傳入。跨槽引用 `rate_N` 的獨立層（extraLayers）不受此 gate 影響，一律照加（見下方「跨槽引用」節）。
  - 背景：舊版無條件加卡片級加碼，與「model 字串列出所有適用成分」的文法矛盾；線上掃描 0 張卡受影響，直到 ctbc-uniopen 改採明確槽＋跨槽引用後才第一次觸發（slot1 `rate+basic` 被誤加 dbr）。詳見 `docs/project/cross-slot-ref-and-minspend-spec.md` 功能三。
- `calculateLayeredCashback()`（waterfall，約 script.js:1840-1904）：Layer1 指定通路(cap 內) → Layer2 基本(溢出) → Layer3 加碼(溢出，加碼 cap 內)。範例 DBS Eco 精選卡友消費 NT$30,000 到日本：基本 1.2%=360＋海外加碼 1.8%=540（上限 50000）＋指定國家 3.8%×21053=800 → 總計 1,700。**waterfall 不受 Fix B 影響**——加碼一律計算，未加 gate（waterfall 的加碼本來就是 model 字串裡固定的第三段，不會有「無條件加」的歧義）
- 簡單路徑（無加碼卡的空白預設）：cap 內 rate_N、溢出 basicCashback
- 選擇邏輯（約 script.js:3554 `const cashbackModel = matchedRateGroup?.cashbackModel`）：`'rate'` → 溢出 0；含 `+` → stacking；含 `>` → waterfall；空白 → 舊預設

**共用邏輯**（2026-07-06 整併完成，改動時不要再複製一份）：
- `getOverflowRate(card)`：簡單路徑與 findUpcomingActivity 共用的溢出率＝`basicCashback`（2026-07-12 移除 `meta廣告/google廣告 → overseasCashback` 寫死特例：全部廣告槽位已改用明確 cashbackModel、走 stacking，不再進簡單路徑；海外與否一律由 cashbackModel 決定）
- `resolveBaseRate(card, isOverseas)` / `resolveBonusComponent(...)`：waterfall/stacking 共用
- 領券活動的溢出直接用 `basicCashback`（與 getOverflowRate 現值等價；不共用只是避免依賴，程式內有註解）
- 無匹配 fallback：`buildBasicCashbackResult(card, amount)`；搜尋結果合併：`mergeResultsByActivity(resultList)`

**計算明細（計算機按鈕）**：有算出金額就至少 1 層明細（`result.calculationLayers.length > 0`），按鈕永遠顯示。明細是卡片內部抽屜（append 進 `.card-result`/`.coupon-item`），`openBreakdownBtn` 追蹤開啟狀態，`showCalcBreakdown()`（約 script.js:5249）讀 `dataset.calcLayers` 渲染。stacking/waterfall/簡單路徑都會產生 layers。

**分層計算的觸發**（約 script.js:2186-2208）：卡片有 `levelSettings` 且含 `overseasBonusRate` 或 `domesticBonusRate`。

**跨槽引用 `rate_N`**（2026-07-16 起，設計決策見 `docs/project/cross-slot-ref-and-minspend-spec.md`）：
- 只在 stacking（`+`）分支有效，寫成裸 `rate_N`（無大括號），如 `rate+rate_5+rate_1+basic`。N＝同卡 `card.cashbackRates` 陣列的 1-based 槽位編號。
- 解析為讀 `card.cashbackRates[N-1]` 的原始 rate/cap，當成獨立一層加進 stacking（自己吃自己的 cap，作用於全額）——**非遞迴**，不會執行被引用槽自己的 cashbackModel，所以不會循環引用、不會重複算 basic。
- 與 `{rate_1}`（大括號、在 rate/cap **值欄位**、hasLevels 卡讀 levelSettings）是完全不同的兩套語法，不衝突。
- `waterfall`（`>`）與裸 `rate` 分支不支援，偵測到會 `console.error` 並忽略該 token（不會靜默算錯）。
- 實作：`resolveCrossSlotLayers()`、`warnIfCrossSlotRefMisused()`（約 script.js:3317-3364）；`calculateStackedCashback()` 多一個 `extraLayers` 參數；`getDisplayRate()`/`rateCompositionButtonHtml()` 已納入加總，排序與詳情頁顯示因此跟計算一致。
- **定位方式（2026-07-16 更正）**：`rate_N` 用 Sheet 真實槽號 `.slot` 定位（`findRateGroupBySlot()`），不是陣列位置——中間跳號（如 slot 1,3,5）時陣列位置會漂移，slot 號不會。相容：若這張卡的 `cashbackRates` 都沒有 `.slot` 欄（舊 `cards.data` 尚未重匯出），退回舊的陣列位置 `[N-1]` 邏輯。匯出端見 `apps-script/cards-export.gs` 的 `rateObj.slot = j`。
- 安全網：`tools/check-cross-slot-refs.js`（`tools/preflight.sh` 會跑）掃 `cards.data` 抓引用不存在槽的 `rate_N`，擋 commit；同樣優先用 `.slot` 驗證存在，無 `.slot` 欄退回陣列長度。

**滿額/未滿門檻 `minSpend` / `maxSpend`**（同上，spec 功能二；2026-07-16 更正＋擴充）：
- `rateGroup.minSpend`：單筆消費 `< minSpend` 時該槽不符資格。`rateGroup.maxSpend`：單筆消費 `>= maxSpend` 時該槽不符資格（邊界值歸 minSpend 那槽）。
- **語義更正（2026-07-16）**：不符資格＝該槽純粹不匹配、不貢獻此活動回饋，**也不退回 `buildBasicCashbackResult`**。舊版「退回 basic」邏輯已移除——理由：用戶會用「另一個槽（填 `maxSpend`）」負責未滿門檻的回饋，退回 basic 會跟那槽打架、產生重複結果。若整張卡因此無任何槽命中，走卡片既有的 no-match 行為（不特別處理）。
- 互斥用法：高回饋槽填 `minSpend`（只在 ≥門檻匹配）、替代槽填 `maxSpend`（只在 <門檻匹配），同商家兩槽二選一命中，邊界值只有 minSpend 那槽命中。
- 實作在 `calculateCardCashback()` 命中槽後、計算前判斷（`amount < rateGroup.minSpend` 或 `amount >= rateGroup.maxSpend` → 跳過此槽，純 `continue`，不設任何 fallback 旗標）。
- 顯示：詳情頁（`renderCashbackRatesIndividually` 等）與搜尋結果卡片（`createCardResultElement`）都會標註「單筆滿 NT$X 起」/「單筆未滿 NT$X」。

## 7. 停車折抵優惠（Parking Benefits）

資料在 `cardsData.benefits` 陣列。**一張卡可有多個停車方案，ID 重複是正常的**（如 ctbc-uniopen 有家樂福、夢時代、統一時代多筆）——每筆是獨立物件，分別顯示。

欄位：`id, benefit_type:"parking", benefit_desc, merchants[], conditions, benefit_period, notes, active`。

`displayParkingBenefits(merchantValue, cardsToCheck, searchKeywords = null)`（約 script.js:3193-3269）：
- 快捷搜尋時 `searchKeywords` 是關鍵詞陣列（如 `["停車","嘟嘟房","台灣聯通","24TPS永固","VIVI PARK"]`），任一匹配即成功
- 一般搜尋時只用 merchantValue
- 匹配：`searchTerm.includes(merchantItemLower) || merchantItemLower.includes(searchTerm)`
- **鐵則**：快捷搜尋必須傳 `currentQuickSearchOption?.merchants` 進來，否則只會拿顯示名稱（如 "所有停車"）去比對，必定失敗：
  ```javascript
  displayParkingBenefits(merchantValue, cardsToCompare, currentQuickSearchOption?.merchants);
  ```

## 8. 性能機制（改邏輯時不要破壞）

- **Items Index**（約 script.js:365-426）：載入時為所有卡建 Map 索引（cashbackRates/specialItems/generalItems 的 items）。查找用 `card._itemsIndex.get(variant)`，O(1)。改搜尋邏輯時優先走索引，不要寫嵌套迴圈
- **Rate Status Cache**（約 script.js:192-202）：`rateStatusCache` Map 快取活動期間狀態，`calculateCashback()` 開始時清空，用 `getCachedRateStatus()` 不要直接叫 `getRateStatus()`
- **DocumentFragment**：displayResults / displayCouponCashbacks 批量 DOM，維持單次 reflow
- 熱迴圈（每卡片/每項目路徑）不要為了 log 做額外計算（如 `.map().join()`）

## 9. 改搜尋/計算邏輯的自檢清單

- [ ] hasLevels 卡是否正確取得 levelData 並傳給解析函數？
- [ ] placeholder 是否正確解析（不是 0、不是 NaN）？
- [ ] `specialItems = []`（空陣列）的卡是否走對分支？
- [ ] 停車折抵的快捷搜尋是否還帶著 searchKeywords？
- [ ] 跑 `docs/ops/regression.md` 的回歸清單比對前後結果
- [ ] 跑 `bash tools/preflight.sh`

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
- [2026-07-13] 差點把 37 個合法 `rate+basic` stacking 槽通報為「需清理的殘留別名」 → 第 6 節舊敘述「資料裡若還有，改成純 rate」把所有 `rate+basic` 當成 2026-07-01 前的排除型別名殘留 → `rate+basic` 是合法 stacking 寫法；別名警告只適用「當初以排除型意圖填寫」的舊資料，意圖判定屬資料擁有者，session 不得自行改資料（正文已改寫）
