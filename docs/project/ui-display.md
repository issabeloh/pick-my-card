# UI 與顯示邏輯（詳情頁、Spotlight、我的信用卡、各 modal）

> 改「畫面顯示、modal、詳情頁、精選活動」前必讀。行號是 2026-07-11 快照——一律先 Grep 關鍵字定位。
> 通用原則：注意 CUBE / DBS Eco / 玉山 Uni Card 的特殊處理；避免重複顯示資訊；保持 UI 簡潔。

## 1. 卡片詳情頁（#card-detail-modal，showCardDetail(cardId) 開啟）

**級別選擇器區域**（約 script.js:2932-2998）：
- 下拉選單選級別；「各級別回饋率」顯示在選擇器旁（同一行 flexbox，flex-wrap: wrap 支援換行）
- DBS Eco 的 level-note 顯示在下拉選單下方
- **鐵則：級別回饋率只在選擇器旁顯示一次，回饋內容區（specialContent）不再重複顯示**

**回饋內容區域**（2026-07-09 起逐筆顯示，不再按 rate+cap 合併）：
- 分級卡兩條路徑共用 `renderCashbackRatesIndividually()`（CUBE 用自己的 `generateCubeSpecialContent`，不受影響）
- `category` 一律以藍色 chip 顯示在回饋率旁，條件直接顯示；`getCategoryDisplayName()` 做 chip 名稱轉換
- 回饋率顯示 `getDisplayRate()` 加總值（stacking = 指定+基本+加碼，與搜尋結果一致）
- stacking 模型（cashbackModel 含 `+`）回饋率旁有「回饋組成」計算機按鈕（`rateCompositionButtonHtml` + `toggleRateComposition`）

**仍存在的合併只有兩處**：CUBE 專屬產生器（按 rate+category+period 合併，category 不會被吃掉）與搜尋結果的 `mergeResultsByActivity`。

**特殊處理**：玉山 Uni Card 條件可展開/收起（toggleConditions，只有 Uni Card 用）；CUBE 用 specialRate、顯示「無上限」；DBS Eco 有特殊 cap 說明格式。

**Header 與連結**：modal 標題就是 `card.name`（無「詳情」後綴）；header 左上有卡片圖；卡全名純文字（無「信用卡官網連結:」標籤）；新戶活動區塊無「官網連結」。

**申辦 CTA（2026-07-15 新增）**：`cardsData.cardApplyCtas[card.id]` 有 `link` 時，`showCardDetail()` 同步填入兩個常駐按鈕（無 link 時兩者都明確 `hidden = true`，防止上一張卡狀態沿用）——`#card-detail-apply-header-btn`（桌機，卡名旁，`≤768px` 隱藏）與 `#card-detail-apply-bar`（手機，`.modal-content` 捲動容器內最後一個子節點、`position: sticky; bottom: 0`，`≥769px` 隱藏）；bar 的文字來自 `applyCta.text`（空字串則只留按鈕）。兩者 href 都走 `sanitizeUrl()`，click 落入 GA4 delegation（`detail_header_apply` / `detail_sticky_apply`）。

**進入詳情頁的入口**：搜尋結果卡片點擊；sidebar 卡片 chips；`#cards-selection`/`#owned-cards-selection` 每張卡的 ⓘ 按鈕（由 `_renderCardSelectionModal` 注入，click 呼叫 `showCardDetail(card.id)` 並 `stopPropagation()` 防誤勾 checkbox；詳情 modal 疊在原 modal 之上）。

## 2. 卡片圖片資產

- 路徑慣例：`assets/images/cards/<card.id>.png`——前端直接組路徑，**不用改 Sheet/Apps Script**
- 缺圖：`<img onerror>` 隱藏整個 img，layout 自動退回沒圖版本
- 兩個位置：詳情頁 header `.card-detail-image`（56px 高、max-width 96px、contain）；選擇 modal tile `.card-checkbox-image`（70px 高、max-width 140px、margin-left 22px 對齊卡名）
- 直/橫卡都支援（object-fit: contain 自動 letterbox）
- **解析度規範**：橫式 800×500（直式 500×800）PNG，壓在 ~150KB 內。舊 320×200 在 Retina 會糊

## 3. 選卡 modals（我的信用卡／管理加入比較的卡片）

- 共用渲染 `_renderCardSelectionModal(config)`——一份程式碼餵兩個 modal（不同 selectionId、tagFilterChipsId）
- `.card-checkbox` 是 column flex：上排 checkbox+卡名+ⓘ，下排卡圖（左對齊卡名）
- 卡名粗體只限 `#cards-selection`/`#owned-cards-selection` 的 `.card-checkbox-label`（不影響行動支付 modals 共用的同 class）
- Grid：`repeat(auto-fit, minmax(200px, 1fr))`
- **Body scroll lock 是 refcount**（`bodyScrollLockDepth`）：疊層 modal 關掉上層不會誤放開捲動鎖。改 modal 開關邏輯時必須維持 disableBodyScroll/enableBodyScroll 成對呼叫

## 4. 精選活動（Spotlight）

**位置（重要）**：`#spotlight-section` 不在 `<main>` 內，是 `.container` 直系子節點、緊接 `.app-layout` 之後——跨 sidebar+main 兩欄的全寬橫帶，位於所有搜尋結果之下。`box-sizing: border-box; width: 100%; padding: 24px 30px 30px; border-top: 1px solid #e5e7eb`。

**資料**：Google Sheets `Highlights` 工作表 → `cardsData.spotlights`。欄位：merchant, rate(數字), description, card_name, card_id, cap, deadline(YYYY/MM/DD), order(數字), active(布林), category(選填，有值才顯示紫色分類 chip)。

**輪播**（`renderSpotlights` 一帶）：每頁 3 張（SPOTLIGHT_PAGE_SIZE）、6 秒自動換頁（SPOTLIGHT_INTERVAL）、循環；「看下一組」手動換頁＋頁碼圓點；hover 卡片或開 modal 暫停；最多 12 則（SPOTLIGHT_MAX）依 order 升冪；`active===false` 不顯示；≤3 則自動隱藏按鈕與圓點；顯示時機跟著 `showToolSections()`/`hideToolSections()`。

**固定高度（防跳動）**：`.spotlight-card { min-height: 260px }`；`.spotlight-desc` 用 `-webkit-line-clamp: 2` + `height: 2.8em`；`.spotlight-meta` min-height 76px、nowrap+ellipsis；卡名列粗體；分類 chip 紫色（#6d28d9 on #ede9fe，刻意避開 sidebar 藍色系）。

**兩個動作**：
- 「比較這個通路 →」（`compareSpotlightMerchant`）：merchant 完全等於某快捷搜尋 displayName（如 `所有加油站`）→ 走 `handleQuickSearch`（多關鍵詞）；否則當一般單一商家搜尋。⚠️ merchant 一律是單一搜尋詞，不支援多商家字串。**這是全站唯一自動觸發計算的入口**（兩條路徑都代按計算、金額空白補 1000）——快捷搜尋按鈕與 `handleQuickSearch` 本身自 2026-07-12 起只填入關鍵詞、不自動計算（產品決策：計算由用戶按「計算」觸發），要復原或擴大自動計算屬產品行為變更，先問用戶
- ⓘ（`openSpotlightModal`）：顯示**卡片的真實活動**（不是 sheet 編輯文字）——用 card_id 找卡，`findSpotlightCardActivities(card, merchant)` 從 `card._itemsIndex` 找涵蓋該 merchant 的 cashbackRate；關鍵字來源：merchant 對到快捷 displayName 時用該選項 merchants，否則用 merchant 本身；先精確比對再退子字串。顯示真實 rate/cap/period/conditions/items；placeholder 用 parseCashbackRateSync/parseCashbackCap＋卡片第一個級別解析。**找不到活動 → 退回 sheet 編輯文字**。⚠️ 只比對 cashbackRates，通路在 specialItems 的分級卡會退回編輯文字。modal 內唯一動作按鈕是「馬上辦卡」（來自 `cardsData.cardApplyCtas[card_id]`，無連結不顯示）

**相關檔案**：index.html `#spotlight-section` `#spotlight-modal`；styles.css `.spotlight-*`（白底、回饋率粗體綠字、「剩 N 天」徽章 0–14 天顯示）。

## 5. 「我的信用卡」modal（錢包堆疊＋單卡頁，2026-07-07 重造）

**兩層視圖**（`renderOwnedCardsOverview()`，Grep "wallet stack"）：
1. **一覽（錢包堆疊）**：所有卡直向疊放、只露上緣色條、不顯示卡名。總高固定 ~320px，卡越多每條越窄（peek 12~40px 自動算）。點被蓋住的卡 → 原位展開（下方卡滑開 40px）＋「查看個人資訊 ›」pill。點全貌卡 → 進單卡頁。有卡展開時「收合」pill `position: sticky; bottom`（z-index 2000 > 卡片的 1..N——**曾因層級太低被卡蓋住**）
2. **單卡頁（solo）**：大卡置中、左右箭頭＋滑動換卡（循環）、頁點、卡名。下方「個人化設定」**唯讀面板**（分級、CUBE 專屬、免年費門檻、我的額度、我的筆記；空值顯示「未填寫」）。**這裡不給編輯**，「前往卡片介紹頁編輯 ›」開 showCardDetail()。所有讀取包 `safe()` fallback（Firebase 被擋也能渲染）

**視覺定案（歷經多輪迭代，勿隨意回退）**：純白背景（皮革框/毛玻璃/漸層已否決）；卡片邊緣＝白色髮絲邊＋貼緣暗縫（`0 -1px` + `-3px` 短陰影，大範圍模糊陰影在細條上會疊成死黑）；卡數＝標題列淡灰小字「我的信用卡 ・N 張」（`#owned-count-badge`，藍膠囊已否決）；「管理我的信用卡」＝標題旁齒輪鈕（`#manage-owned-cards-btn`，沿用原 id）；`#my-owned-cards-modal .modal-content` 有 `scrollbar-gutter: stable`；直式卡圖自動偵測（naturalHeight > naturalWidth）旋轉為橫式（`.ow-portrait`）。

## 6. 我的額度（creditLimit，2026-07-07 新增）

- **編輯處只有詳情頁**：`#credit-limit-section`（我的筆記左側，`.personal-fields-row` 桌機並排/手機直排）
- NT$ 前綴輸入框：只收數字、自動千分位、失焦或 Enter 即存（`✓ 已儲存` 2 秒）；`inputmode="numeric"`+pattern
- 儲存比照免年費：訪客 `creditLimit_local_<cardId>`；登入者 `users/{uid}.creditLimits[cardId]`（Firestore map）＋本機鏡像 `creditLimit_<uid>_<cardId>`；清空＝刪除
- 函數：`loadCreditLimit()`/`saveCreditLimit()`/`setupCreditLimit()`（Grep "我的額度相關功能"）
- 單卡頁唯讀顯示 `NT$ x,xxx` 或「未填寫」

## 7. 精準搜尋核取方塊 ＆ 搜尋輸入區版面（2026-07-12 新增/重整）

- 精準搜尋與新戶活動是**淺灰方框 toggle**（桌機手機共用**同一份 DOM**，`.show-promos-toggle` 是 `.input-row-with-button` 的直接網格子元素）：兩框同一列各佔一半（flex 1 1 0），label flex:1 讓**點文字即可勾選**，「?」按鈕在框內文字右側、點擊內嵌展開說明（`promo-help-inline`，桌機也用點擊、不再用 hover popover）。checkbox id：`#exact-search-checkbox`／`#show-promos-checkbox`（單一實例；JS 保留陣列/同步邏輯以防未來再分裝置）。讀取用 `isExactSearchEnabled()`。預設關閉、不記憶狀態
- **合併框 `.merchant-search-box`**：商家輸入（上半部）與快捷 chips（下半部、淺灰背景）在同一個粗框（3px）內；「快捷搜尋」標題列已從 DOM 移除。`#exact-search-empty-hint` 與 `#search-hints-container` 在合併框下方。金額框 `.amount-input-wrap` 同款粗框：NT$ 前綴在左、無框線輸入在右（桌機手機同款，桌機另有「消費金額」標籤＋「預設 NT$1,000」提示，手機隱藏兩者）
- **狀態列與浮層鐵則**（2026-07-13）：匹配狀態列（`.matched-item-row`，含 `#matched-item` 與 `#exact-search-empty-hint`）一次只顯示一行——✘/部分匹配訊息出現時 JS 會收起橙色提示；桌機 search hint（`#search-hints-container`）與「?」說明（`.promo-help-text`）都是**浮層**（absolute，不參與版面），出現時按鈕/勾選不得跑位；「?」說明一次只開一個、點外部收合（`closeAllInlineHelp`）
- 版面順序（桌機 grid `2fr 1fr`，2026-07-12 定稿 2:1 版）：左欄合併框跨 3 列；右欄由上而下「金額(1,2)→toggles(2,2 橫排兩框)→計算按鈕(3,2 整欄寬、align-self:end)」——按鈕在表單動線收尾。手機（`1fr auto`）：合併框整列→toggles 整列（左右各半）→金額＋按鈕同列。改排版時注意 toggles 與 button-group 的 grid 定位規則（styles.css 搜 "show-promos-toggle"）；`#search-hints-container:empty` margin 歸零是桌機對位的前提
- 語義：勾選時 `handleMerchantInput` 以 `findMatchingItem(input, { exactOnly: true })` 過濾，只留 `isExactMatch`（**fuzzy 同義詞展開後全等也算**，如搜「國外」時 item「海外」視為一致）
- **快捷搜尋不受影響**：`handleQuickSearch` 不傳 exactOnly；快捷結果存在（`currentQuickSearchOption` 非 null）時切換核取方塊不重跑匹配
- 零結果提示 `#exact-search-empty-hint`（「無完全一致項目，可取消勾選看相近結果」）：只在「勾選＋放寬後有結果」時顯示；輸入清空、匹配成功、快捷搜尋都會清掉

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
- [2026-07-13] 詳情頁改分級後關閉 modal 頁面鎖死不能捲動 → 級別 onchange 重呼叫 showCardDetail() 重繪，disableBodyScroll() 多執行一次而 closeModal 只解一次（refcount 不成對）→ 任何「modal 已開啟時重繪」的路徑都要先檢查 modal 是否已顯示、已顯示就不得再上鎖（showCardDetail 內以 wasAlreadyOpen guard 實作）
