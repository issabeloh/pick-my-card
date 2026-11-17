# 程式碼清理稽核報告（2026-11-17）

**目的**：找出沒在用的舊程式碼、重複邏輯、會誤導接手模型的文件與註解。
**狀態**：批次 1–7 已完成（2026-11-17，分支 `claude/wonderful-babbage-0wk7gn`）；剩下的都是等站長決定的項目，見下方「處理進度」。
**行號都是當日快照**，動手前用 Grep 關鍵字重新定位。

## 處理進度（2026-11-17）

下表的狀態以 commit 為準。A／B／C 編號的內容見後文，**行號仍是稽核當日快照**。

| 項目 | 狀態 | commit／備註 |
|---|---|---|
| 第 0 節、C1 的 Firebase 替身補洞器 | ✅ 完成 | `bc52a3c`（`tools/lib/firebase-stub-guard.js`）。C1 的另一半（抽 `tools/lib/test-harness.js` 合併三份替身與伺服器）尚未做 |
| A1、A2、A9 死 CSS | ✅ 完成 | `1c7e4f8`。結帳日相關樣式刻意保留（見 B2） |
| A3–A8 死函式、未用變數、圖片、`.pyc` | ✅ 完成 | `1144891` |
| A10 過時註解與數字 | ✅ 完成 | `4fb552b`（載入順序分母、`script.js` 舊引用、12 支／12 組）、`a559c27`（檔頭目錄）。`landing.html:44` 的註解實際寫的已是 Clarity，不用改 |
| A11 文件裡確定過時的事實 | ✅ 完成 | `c7a9d79`（`.claude/agents/scout.md` 屬 🟡，改動小，請主對話派 verifier 覆核） |
| B1 `specialItems`／`generalItems` | ✅ 刪除 | `a6ee777`（站長決定刪；鐵則 4 已由主對話改寫） |
| B2 結帳日功能 | ⏸ 保留 | 站長決定：功能之後要加回來，**JS 與 CSS 都保留**，不刪 |
| B5 文件與資料夾 | ✅ 完成 | `8baf9fd`：刪 `docs/archive/` 12 個無人引用的備份（保留 4 個仍被連結的）、`docs/mockups/promos-2026-09/`、`docs/ops/script-split-plan.md`；`maintenance.md` 改成「git 歷史即備份」。`BENEFITS-AUTOMATION-PLAN.md`、`assets/brand/` 依指示保留；弱引用測試腳本不刪，已列進 `regression.md` 的對照表（`c7a9d79`） |
| B6-1 `onOpen` 的 `buildAutomationMenu_()` | ✅ 完成 | `1144891` |
| B6-2 `toContiguousBlocks_` | ✅ 完成 | `6d5e637` |
| B6-7 `TERM_DICT_HEADERS` | ✅ 完成 | `6d5e637` |
| B6-9 `apps-script/README.md` 補 `term-unify.gs` | ✅ 完成 | `c7a9d79` |
| B7 `renderCardTags` 的 `escapeHtml` | ✅ 完成 | `1144891` |
| C3 剩餘天數統一 | ✅ 完成 | `0036631`（`taiwanDaysUntil`；`promos.js` 依計畫不併） |
| S1 檔頭區塊目錄補齊並對齊順序 | ✅ 完成 | `a559c27` |
| S2 preflight 檢查「N/13」與 `<script>` 標籤數 | 不需要 | 檔頭已改成不含分母（`4fb552b`），不會再因新增模組過時 |
| S3、S4、S5 `CLAUDE.md`、`regression.md` | ✅ 完成 | `c7a9d79` |
| C2 停車折抵比對 4 份 | ✅ 完成（各呼叫端現有行為原樣保留，三個不一致待站長裁決，見 `findMatchingParkingBenefits` 上方註解） | `45bb5ab` |
| C4 上限（cap）顯示 6 種寫法 | ✅ 完成（`formatCapText`；各處對 0／空字串的差異用選項原樣保留，「上限 NT$無」待站長裁決） | `b3aadc1` |
| C6 卡片標籤清單 3 處要同步 | ✅ 完成（`CARD_TAG_DEFS` 一張表；另抽 `CHILDREN_PLAN_CATEGORY` 常數） | `74db0c1`、`71d82c1` |
| C7 額度字串解析 2 份 | ✅ 完成（`parseCreditLimit`） | `b02153d` |
| B3 舊儲存格式遷移碼 | ✅ 已裁決 | `mpMovedHintCount`（搬家提示氣泡＋頁面備註）已移除；`selectedCards` 相關**站長指示不做任何改動**；快捷選項舊格式遷移碼保留 |
| C4 的「上限 NT$無」 | ✅ 完成 | 改成「無上限」（站長同意） |
| B4 防呆用的退路分支 | ⏳ 待站長確認 | |
| B6-3 `debugGSC`、B6-4 `importHistoricalData`、B6-5 `createDailyTrigger`、B6-6 `publishChangelog`、B6-8 匯出但前端不讀的欄位 | ⏳ 待站長確認 | |
| B7 其餘三項（訪客登入帶入額度、`saveFeeWaiverStatus` 沒包 try、`pmc_ab_sent` 時機） | ⏳ 待站長確認 | 未複核 |
| C5 級別解析兩套 | ✅ 隨 B1 解決 | 內聯正規化那一套在 specialItems 分支裡，已一起刪除，現在只剩 `resolveCardLevel` |
| C8、C9、C10 | 未處理 | 不急；下次動到該檔時順手處理 |

## 怎麼查的

| 項目 | 方法 |
|---|---|
| 死函式 | 腳本抽出 `js/`、`faq.js`、`landing.js`、`promos.js` 所有函式與頂層變數，全 repo 計引用次數 |
| 未使用的區域變數 | ESLint（`no-unused-vars` 等 11 條規則）跑 13 支模組依載入順序串接的結果 |
| 死 CSS | 逐支樣式表比對「會載入它的頁面＋產生該頁 HTML 的程式」，class 名稱兩邊都找不到才算 |
| 死 id／斷掉的引用 | 靜態 HTML 的 id 對 JS／CSS；`getElementById` 對 HTML 與 JS 產生的標記 |
| 沒人用的圖片 | `assets/` 每個檔名對全 repo；卡圖對 `cards.data` 的卡片 id |
| 舊格式相容碼、重複邏輯、文件一致性、Apps Script | 四個 subagent 各自稽核，重點項目由主對話複核。原始報告在 `cleanup-audit-2026-11-17/` |

**基準**：preflight ✅、搜尋回歸 13 組 ✅、詳情頁回歸 ✅。配卡組合頁測試與刪除帳號測試 ❌（見第 0 節，稽核前就是紅的）。

## 總評

1. **JS 很乾淨。** 13 支模組、約 17,000 行，零引用的函式只有 2 個，未使用的區域變數 10 個。先前的清理做得紮實。
2. **真正的死碼集中在三處**：`styles.css` 約 660 行舊樣式、`specialItems`／`generalItems` 整條計算分支（200 行以上，資料已不產生這兩個欄位）、結帳日功能（輸入框已不存在，背後的讀寫碼還在）。
3. **對接手模型最危險的不是死碼，是「改一漏一」**。同一件事有多份實作而且已經彼此不一致：停車折抵比對 4 份、剩餘天數 5 套、上限顯示 6 種寫法、測試用的 Firebase 替身 3 份。
4. **兩支回歸測試目前是紅的**，原因就是第 3 點（替身沒跟上 `index.html`）。清理前要先修，否則沒有安全網。
5. **文件的數字與目錄有多處過時**，其中 13 個模組檔頭的「載入順序 N/12」每次開檔都會被讀到。

---

## 0. 清理前必須先修（不是清理，是修安全網）

| # | 問題 | 位置 | 處理 |
|---|---|---|---|
| 0-1 | `index.html:1329` 從 firebase-analytics 多 import 了 `setUserProperties`（#561 加的），三份測試替身都沒有這個 export。ES module 缺一個具名 export 會讓整包 Firebase 載入失敗 | `tools/regression/run-regression.js:105`、`mappings-page-test.js:40`、`delete-account-test.js:33` | 三處補上 `export function setUserProperties(){}`。主對話已暫時修改驗證過：補上後配卡組合頁測試 194/194 通過（驗證完已還原） |
| 0-2 | 搜尋回歸（`run-regression.js`）在 Firebase 載入失敗時仍然全綠，因為它走訪客模式。它擋不住這類問題 | 同上 | 見 C1：合併替身，並加一條檢查「替身的 export ⊇ `index.html` 的 import」 |

---

## A 級：已驗證零引用，建議直接刪

| # | 內容 | 規模 | 位置 | 備註 |
|---|---|---|---|---|
| A1 | **死 CSS：舊首頁介紹區**（`hero-*`、`feature-*`、`use-case-*`、`cta-*`、`product-intro-section`、`icon-box*` 等）。介紹內容已搬到 `landing.html`＋`landing.css` | 89 條規則、約 429 行 | `styles.css`，完整清單見 `cleanup-audit-2026-11-17/appendix-dead-css.md` | 刪除後要做截圖比對（見「驗證方式」） |
| A2 | **死 CSS：零散項目**（`.btn-secondary`、`.promo-help-popup`、`.site-legal-footer`、`.feedback-input`、`.level-description`、`.info-grid`、`.unsaved-indicator` 等） | 22 條規則、約 126 行 | 同上 | 另有 `.mp-seg-wrap`（`styles.css:10109`）、`.custom-option-info`（`:1473`）看起來也沒人用，刪前再 Grep 一次 |
| A3 | **死函式** `getCategoryStyle` | 5 行 | `js/cashback-engine.js:510` | 全 repo 只有定義 |
| A4 | **死函式** `isBasicExcludedForSearch`（呼叫端都已改用 `getBasicExclusionHits`） | 3 行 | `js/search-match.js:858` | `docs/project/cashback-engine.md:207` 與 `search-match.js:135` 的註解還在引用這個名字，要一併改成 `getBasicExclusionHits` |
| A5 | **沒人用的匯出** `window.closeMyPaymentsModal` | 1 行 | `js/levels-payments.js:232` | |
| A6 | **未使用的區域變數** 10 個 | 各 1 行 | `home-ui.js:1176` `announcementIndicator`、`search-match.js:295` `category`、`cashback-engine.js:1095` `matchedVariant`、`card-detail.js:614` `upcomingLevelData`、`:743` `saveIndicator`、`:827` `savedLevel`、`:985` `mergeKey`、`levels-payments.js:246` `isLoggedIn`、`landing.js:129` `skipBtn`、`auth-user-data.js:1122` 多餘的 `return` | 其中 2 個在 B1 的死分支裡，B1 若刪就不用個別處理。刪變數前確認右邊的運算式沒有副作用 |
| A7 | **沒人用的圖片**（舊首頁介紹區的配圖） | 4 檔、約 326KB | `assets/images/use-case-3-review-credit-cards.png`／`.webp`、`feature-credit-cards-customized-combination.webp`、`use-case-1-instant-check-cashback.webp` | `landing.html` 用的是別的檔名 |
| A8 | **誤進版控的編譯檔** | 3 檔 | `tools/audit/__pycache__/*.pyc` | 刪除並在 `.gitignore` 加 `__pycache__/` |
| A9 | **被後面完全蓋掉的重複 CSS 定義** | 5 組 | `.info-grid-2col`、`.info-item`、`.info-value`、`.fee-annual-section`、`min-width:1025px` 的 `.personal-fields-row` | 位置見 `appendix-duplicates.md`。和 A1、A2 同一批做 |
| A10 | **過時的註解與數字**（不影響執行，但模型每次開檔都會讀到） | 約 40 處 | ① 13 個模組檔頭「載入順序 N/12」→ 13；`core-utils.js:3`「12 個模組檔」② `index.html:1321-1323`、`faq.js`（6 處）、`promos.js`（約 8 處）引用已不存在的 `script.js` 與舊行號 ③ `tools/build-promos-features.js:12`、`tools/lib/merchant-cards.js:5`、`data-pipeline.md:772`「12 支模組」④ `tools/regression/README.md:3,53`、`templates.md:48`「12 組回歸」→ 13 ⑤ `landing.html:44` 註解寫 AdSense、實際是 Clarity | `index.html` 的註解改了要重跑 `build-merchant-pages.js` |
| A11 | **文件裡確定過時的事實** | 約 10 處 | ① `data-pipeline.md:559`「待清理 promos.css 死碼」：已在 2026-09-21 清完（`promos.css:1872` 有記錄） ② `CLAUDE.md`：「單檔 600–1,850 行」實際 665–2,228；`styles.css` 11,100 → 11,611；`index.html` 1,750 → 1,826；`cards.data` 488KB → 830KB（`templates.md:13`、`.claude/agents/scout.md:14` 同一句） ③ `judgment.md:14` 用已刪除的 `update-version.sh` 當例子 ④ `ui-display.md:440` 的 `.mp-searchrow` 已不存在 ⑤ `cashback-engine.md:187` 還寫 `script.js:365-426` | 屬 maintenance.md 的 🟢「修正確定錯誤的事實」。`.claude/agents/scout.md` 屬 🟡，要派 verifier |

**A 級合計**：CSS 約 560 行以上、圖片 326KB、JS 約 20 行、註解與文件約 50 處。

---

## B 級：看起來沒在用，但需要站長判斷

### B1. `specialItems`／`generalItems` 整條分支（最大的一筆）

- **現況**：`cards.data` 與回歸用的凍結資料裡，**0 張卡**有 `specialItems` 或 `generalItems`。`cards-export.gs` 也不再輸出這兩個欄位（只剩 `specialRate`／`generalRate` 這兩個 placeholder 名稱，那是另一回事，還在用，CUBE 的三個級別都有 `specialRate`）。
- **死掉的程式**：
  - `js/cashback-engine.js:971–~1166`，約 200 行。`calculateCardCashback` 開頭的 `if (card.hasLevels && card.specialItems && card.specialItems.length > 0)` 分支
  - `js/data-loader.js:34–70`（建索引）
  - `js/card-detail.js:462–486`（詳情頁顯示）
  - `js/search-match.js:288–299`、`1060–1061`
  - `js/results-display.js` 另有 11 處提到，未逐一判定
- **為什麼要你決定**：
  1. 這條分支裡有一個 `saveCardLevel()` 呼叫點（`cashback-engine.js:986`，大小寫正規化）。刪掉等於鐵則 1 的合法呼叫點少一個，是好事，但動到鐵則範圍。
  2. **鐵則 4**（空陣列不是 falsy）整條是為 `specialItems` 寫的。分支刪掉後這條鐵則失去對象，要改寫或移除。照 maintenance.md 這是 🔴，必須你同意。
  3. `docs/project/cashback-engine.md` 第 32–58 行的「Type A／Type B」分類、`regression.md:93` 的測試說明也要跟著改。
  4. 這條分支和現役分支有約 60 行近乎相同的迴圈，而且**已經不一致**（死分支的 cap 沒經過 `parseCashbackCap`）。留著的話，未來的模型很可能改錯邊。
- **我的建議**：刪。前提是你確認「不會再用 `specialItems` 這種資料形狀」。回歸測試的資料裡沒有這類卡，所以刪除前後回歸都會是綠的，它證明不了這條分支，只能證明現役路徑沒被碰壞。

### B2. 結帳日功能：畫面已拿掉，程式還在

- **現況**：`js/card-detail.js:775` 每次開詳情頁都呼叫 `setupBillingDates()`，但它要找的 `#billing-date`、`#statement-date` 在 `index.html` 和所有 JS 產生的標記裡都不存在，所以函式每次都在第一個檢查就返回。
- **連帶死掉的**：`spending-mappings.js:594–720` 的 `loadBillingDates`／`saveBillingDates`／`setupBillingDates`（約 125 行）、`styles.css` 的 `billing-dates-*`／`date-input-*`（19 條規則、約 106 行）。
- **還活著的**：登入時把訪客結帳日帶進雲端（`auth-user-data.js:646–667`）、登出清理、刪除帳號說明文字（`index.html:1677` 還列著「結帳日」）。
- **要你決定**：這個功能是刻意下架，還是改版時輸入框不小心掉了？
  - 刻意下架 → 刪 JS 與 CSS。雲端既有的 `billingDates` 資料不動；訪客帶入那段可以留（無害）或一起刪。
  - 不小心掉的 → 這是一個要修的 bug，不是清理。

### B3. 舊儲存格式的遷移碼（老用戶的資料可能還在）

| 項目 | 位置 | 現況 | 建議 |
|---|---|---|---|
| 快捷選項舊格式 `userQuickSearchOptions`／`userCustomQuickOptions`、Firestore `users.quickSearchOptions` | `js/data-loader.js:262–364` | 全 repo 沒有任何地方寫入，只讀取後刪除。`firestore.rules:79` 為了刪除保留白名單 | 需要知道遷移是哪天上線的。本容器是淺層 clone（最早到 2026-11-07），查不到。你若記得已超過半年，可以刪 |
| 舊 key `selectedCards_<uid>`、Firestore `users.selectedCards` | `js/auth-user-data.js:706、713、737` | 只讀不寫 | **保留**。老用戶的雲端文件可能只有這個欄位，刪了他們的比較清單會重置 |
| `mpMovedHintCount`（「配卡組合已搬家」提示的播放次數） | `js/mappings-page.js:607`、`index.html:453` | 還在運作 | 提示期過了再刪，現在不動 |

### B4. 防呆用的退路分支（資料目前不會走到）

| 項目 | 位置 | 現況 | 建議 |
|---|---|---|---|
| `CARD_BANK_BY_ID_PREFIX` 發卡行前綴對照 | `js/home-ui.js:1699–1735` | 34/34 張卡都有 `bank` 欄位，`tools/check-card-banks.js` 也在把關 | 保留。新卡漏填 `bank` 時它是唯一的保險 |
| `findRateGroupBySlot` 退回 `rates[N-1]` | `js/cashback-engine.js:567–578` | 337/337 個槽都有 `slot`，匯出端固定輸出 | 可刪，價值低 |
| `bonus_merchants` 的字串型別分支 | `js/core-utils.js:693、707、719` | 現在只有陣列或 null | 可刪，價值低 |

### B5. 文件與資料夾

| 項目 | 現況 | 建議 |
|---|---|---|
| `docs/archive/` 15 個 `.bak`＋1 個 `.md` | git 歷史裡都有。maintenance.md 規定刪除要問你。只有 4 個還被其他文件連結 | 刪掉沒被連結的 12 個。maintenance.md 第 3 節「改寫前先 cp .bak」的規定可以改成「git 歷史即備份」，否則會繼續累積 |
| `docs/mockups/promos-2026-09/` | 檔案自己寫「實作完成可整包刪除」，`/promos` 已上線 | 刪 |
| `docs/ops/script-split-plan.md` | 拆分已在 2026-07-20 完成，路由表沒有指向它 | 刪，或移到 `history.md` 留一段摘要 |
| `BENEFITS-AUTOMATION-PLAN.md`（根目錄） | MVP 已完成，裡面的函式名過時。`CLAUDE.md` 還把它列為既有文件 | 你決定：還有未完成的階段就更新，沒有就刪 |
| `docs/ops/diagnosis.md` | 全是 2026-07-11 的快照，`CLAUDE.md:62` 仍把它當「依據」引用 | 檔頭加一行「歷史快照」即可 |
| `assets/brand/` 3 個沒被引用的 SVG（`pmc-mark-reverse-dark`、`mono-blue`、`mono-ink`） | 共 3KB | 保留。品牌素材包本來就不一定被網頁引用 |
| 弱引用的測試腳本：`tools/test-basic-exclusions-changes.js`、`test-changelog.js`、`test-watchlist-chunking.js`、`tools/apps-script-tests/*`、`rate-limit-client-test.js`、`tools/regression/merchant-suggest-test.js` | 都能跑，但不在 preflight、CI 或 regression 文件裡，沒人會想到去跑 | 不刪。在 `docs/ops/regression.md` 加一張「改了哪個檔 → 跑哪支測試」的表 |

### B6. Apps Script（更正：部分檔案會自動部署）

稽核前我說「看不到線上版，只列報告」。這句話只對一半：`.github/workflows/apps-script-deploy.yml` 會在 main 的 `apps-script/*.gs` 變動時，把 `apps-script/deploy.json` 列的 8 個檔自動推到線上（「PMC 資料自動化」的 6 支 `.gs`，加上活動快寫 2 檔）。`cards-export.gs`、`card-editor.gs`、`promo-editor.gs` 等刻意不在名單上，仍是手動貼。

| # | 項目 | 位置 | 部署方式 | 建議 |
|---|---|---|---|---|
| B6-1 | **可能的 bug**：`onOpen()` 結尾直接呼叫 `buildAutomationMenu_()`，沒有 `typeof` 守衛。這個函式只定義在 `benefits-parser.gs`，而那支屬於另一個專案。前面三個選單項都有守衛，只有這行沒有 | `apps-script/cards-export.gs:53` | 手動貼 | 請你打開「PMC 管理系統」的執行記錄，看 `onOpen` 有沒有 `ReferenceError`。有的話刪掉這行 |
| B6-2 | 死函式 `toContiguousBlocks_` | `watchlist-monitor.gs:1324` | 自動 | 可刪 |
| B6-3 | 除錯殘留 `debugGSC` | `pmc-analytics-sync.gs:894` | 手動貼 | 你確認沒在用就刪 |
| B6-4 | `importHistoricalData`＋`writeHistoricalImportLog`（一次性的歷史匯入） | `pmc-analytics-sync.gs:914、1028` | 手動貼 | 歷史資料已匯完就刪 |
| B6-5 | `createDailyTrigger`：註解自己警告「不要跑」，跑了會換掉現行觸發器 | `pmc-analytics-sync.gs:880` | 手動貼 | 建議刪，留著是地雷 |
| B6-6 | `publishChangelog`：一行轉呼叫的舊名別名 | `benefits-parser.gs:500` | 自動 | 先到編輯器「觸發條件」確認沒有觸發器指向它 |
| B6-7 | 未使用的常數 `TERM_DICT_HEADERS` | `term-unify.gs:30` | 手動貼 | 可刪 |
| B6-8 | 匯出了但前端不讀的欄位：`domesticBonusPeriod`、`overseasBonusPeriod`、`levelSettings.*.cap_hide`／`rate_hide`、`benefits[].benefit_type`、`merchantPayments.*.source_url`／`last_updated`、`benefits[]` 裡一個空字串鍵 | `cards-export.gs` | 手動貼 | 空字串鍵是 Sheets 空表頭造成的雜訊，可在匯出端濾掉。其餘你判斷是否留給將來用 |
| B6-9 | `term-unify.gs` 在 `apps-script/README.md` 沒有說明 | | | 補一段用途 |

355 個頂層函式裡確定的死函式只有 B6-2 一個。14 支 `.gs` 與 3 個 `.html` 都還在用。`functions/` 沒有死碼。

### B7. 稽核中發現的疑似 bug（不是清理，未複核）

| 項目 | 位置 | 說明 |
|---|---|---|
| `renderCardTags` 的 `${tag}` 沒過 `escapeHtml()` | `js/cards-modals.js:784` | **已複核屬實**，違反鐵則 3。tag 來自 Sheets（你控制的資料），實際風險低，但該補 |
| 訪客登入時沒有帶入 `creditLimit_local_<id>` | `js/auth-user-data.js` 約 520–670 | 免年費、結帳日、級別都有帶入，額度沒有，只在登出時清掉。未複核 |
| `saveFeeWaiverStatus` 的 `localStorage.setItem` 沒包 try | `js/spending-mappings.js:408` 附近 | 未複核 |
| A/B 旗標 `pmc_ab_sent` 兩頁寫入時機不同 | `index.html`（先記後送）、`landing.html`（送達才記） | 未複核 |

---

## C 級：簡化重構（依價值排序）

「已不一致」表示多份實作現在的行為就不同，不只是冗餘。

| # | 重複的東西 | 位置 | 已不一致？ | 建議 | 風險 |
|---|---|---|---|---|---|
| C1 | 測試替身與測試工具：Firebase 替身 3 份、`freezeClockScript`、本機伺服器＋MIME 表各複製一份 | `tools/regression/run-regression.js:101`、`mappings-page-test.js:37、84、105`、`delete-account-test.js:30、75` | 是（auth 與 `getDoc` 行為不同；都缺 `setUserProperties`） | **做**。抽成 `tools/lib/test-harness.js`，preflight 加檢查「替身 export ⊇ `index.html` import」。這次兩支測試悄悄變紅就是這個原因 | 低 |
| C2 | 停車折抵比對 4 份 | `js/search-match.js:412、450、520`、`js/results-display.js:537` | 是（前三份比原始輸入，第四份會展開別名。可能出現橫幅說有停車折抵、下方區塊卻沒有） | **做**。合成一個 `findMatchingParkingBenefits()` | 中（搜尋回歸有驗停車筆數） |
| C3 | 「剩餘天數」5 套實作 | `js/core-utils.js:486、501、516`（台北時間）、`home-ui.js:54`（裝置時區）、`mappings-page.js:246`（四捨五入）、`promos.js:28–62` | 是（時區與進位方式不同，海外用戶或接近午夜時會差一天） | **做** `js/` 內的三套。`promos.js` 獨立載入，不併 | 低–中 |
| C4 | 上限（cap）顯示 6 種寫法 | `js/card-detail.js:292、1127`、`home-ui.js:536`、`results-display.js:1392、1580、1787、1865`、`mappings-page.js:393` | 是（cap 為 0 時有的顯示「無上限」、有的顯示「NT$0」；有一處寫「無」） | **做**。抽 `formatCapText()` | 低 |
| C5 | 級別解析兩套：內聯正規化 vs `resolveCardLevel` | `js/cashback-engine.js:974`、`js/levels-payments.js:203` | 是 | 併入 B1。B1 刪掉後自然只剩一套 | 高（鐵則 1） |
| C6 | 卡片標籤清單 3 處要同步：排序表、樣式對照表、CSS | `js/cards-modals.js:164、749`、`styles.css` | 否 | **做**。合成一張表，順便補上 B7 的 `escapeHtml` | 低 |
| C7 | 額度字串解析 2 份 | `js/spending-mappings.js:504`、`js/mappings-page.js:327` | 未確認 | 抽 `parseCreditLimit()`。免年費／額度／結帳日三份 Firestore 讀寫樣板先不動 | 低 |
| C8 | 獨立頁複製的工具：`escapeHtml`、`sanitizeUrl`、抽屜、回到頂部 | `js/results-display.js:1071`、`faq.js:35、257`、`promos.js:804、936`、`js/cards-modals.js:76` | 抽屜已分歧（faq／promos 版沒有捲軸補償） | **不抽共用檔**（這三頁刻意獨立載入）。在每份複製旁加註解互指 | 低 |
| C9 | 頁尾 HTML 5 份、Firebase config 4 份 | `index.html`、`faq.html`、`privacy.html`、`terms.html`、`promos.html`；`cards-export.gs` | 未確認 | 不合併（靜態頁沒有 build 步驟）。在 `docs/ops/maintenance.md` 或 `ui-display.md` 列一張「改這個要同步改哪幾處」清單 | 無 |
| C10 | 樣板冗餘：modal 關閉約 15 處、GA 守衛約 13 處、商家展開面板 2 份、行內 SVG 2 處、`「切換「童樂匯」方案」` 字串 3 處 | 見 `appendix-duplicates.md` | 否 | 不急。下次動到該檔時順手抽 | 低 |

### 讓模型不易出錯的結構性建議

| # | 建議 | 理由 |
|---|---|---|
| S1 | 模組檔頭的區塊目錄補齊並對齊實際順序 | 5 個檔順序不一致（`auth-user-data`、`card-detail`、`core-utils`、`home-ui`、`search-match`）。漏列的大區塊：`home-ui.js` 約 340 行（桌機空狀態 `:407`、calc-nudge `:702`、`compareSpotlightMerchant` `:750`）、`data-loader.js` 信任列 `:642`、`card-detail.js` 的 `renderBasicExclusionsCard`／`setupLevelHelpPopover`。CLAUDE.md 叫模型「Grep 區塊目錄拿行號」，目錄漏列就找不到 |
| S2 | preflight 加一條：檔頭的「N/13」與 `index.html` 的 `<script>` 標籤數一致 | A10 的問題會在下次新增模組時重演 |
| S3 | `CLAUDE.md` 專案地圖補上漏列的項目 | 最重要的是 `tools/apps-script-deploy`＋`apps-script-deploy.yml`：**改 `apps-script/` 併進 main 會自動部署到線上**，地圖卻寫「實際執行版在 Google Sheets，兩邊必同步」。其次：`tools/activity-writer`（生成 `ActivityWriter.html`，禁手改）、`tools/build-logo-assets.js`（logo 禁手改）、`storage.rules`、`firebase.json`、`manifest.json` |
| S4 | `CLAUDE.md` 裡會變動的數字（行數、檔案大小）改成不寫精確值，或由 preflight 檢查 | 現在 4 個數字都過時 |
| S5 | `docs/ops/regression.md` 加「改了哪個檔 → 跑哪支測試」對照表 | `tools/` 有 10 支以上的測試，只有 3 支寫在 CLAUDE.md |

---

## 建議的清理批次

每批一個 commit，各自跑 preflight 與回歸。

| 批次 | 內容 | 需要你先決定 |
|---|---|---|
| 1 | 第 0 節＋C1：修好兩支紅的測試，合併替身，加 preflight 檢查 | 不用 |
| 2 | A3–A8：死函式、未用變數、圖片、`.pyc` | 不用 |
| 3 | A1、A2、A9：死 CSS。推 `preview/cleanup-css` 分支給你看 | 不用 |
| 4 | A10、A11、S1–S5：註解、文件、目錄 | S3、S4 會改 `CLAUDE.md` 的既有段落 |
| 5 | B1：`specialItems` 分支 | **要**（動到鐵則 4） |
| 6 | B2：結帳日 | **要**（下架還是 bug） |
| 7 | C2–C4、C6、C7：合併重複邏輯 | 你挑要做哪幾項 |
| 8 | B3–B6：其餘逐項 | **要** |

### 驗證方式

- **JS 批次**：preflight、搜尋回歸、配卡組合頁測試、詳情頁回歸、刪除帳號測試（批次 1 修好後五支都要綠）。
- **CSS 批次**：回歸測試比的是文字結果，**抓不到版面跑掉**。做法是刪除前後用 Playwright 對同一組頁面與狀態截圖（首頁、搜尋結果、詳情頁、各 modal、配卡組合頁、FAQ、隱私權、使用須知，桌機與手機兩種寬度），逐張比對像素，零差異才算過。
- **B1**：回歸資料裡沒有 `specialItems` 卡，回歸綠燈只能證明現役路徑沒被碰壞。

## 沒查到的範圍

- `index.html`、`landing.html` 的 inline `<script>` 只查了 localStorage key 與 id 引用，沒查死碼。
- `spotlights`、`announcements`、`benefits`、`payments` 的子欄位退路沒有逐一對資料。
- `styles.css` 的死 CSS 是下限：名稱剛好和別處字串相同的 class 會被當成有在用。
- Cloudflare Pages 的 build command 在後台，repo 看不到。
- Apps Script 的線上版本與觸發器清單看不到，「零引用」只代表 repo 內。
- git 是淺層 clone，查不到各段遷移碼的上線日期。
