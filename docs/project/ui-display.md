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

**Embed 模式（2026-07-16 新增，方案 A：新戶活動頁 iframe 內嵌詳情彈窗）**：
- 觸發：URL 帶 `?embed=1`。index.html pre-paint script（`<head>` 內，Grep "pmc-embed"）在首屏前於 `<html>` 加 `pmc-embed` class，避免閃一下完整工具介面；styles.css 對應規則（Grep "html.pmc-embed"）只留 `#card-detail-modal` 可見，其餘全站 UI（header/sidebar/main/其他 modal/footer/回報鈕/回頂鈕/spotlight/boot loader）一律 `display:none !important`，`body`/`.container` 背景轉透明——`#card-detail-modal` 本身是 `position:fixed` 全螢幕深色遮罩，天生蓋滿 iframe viewport，不用另外改它的樣式。
- postMessage 協定（script.js 主 `DOMContentLoaded` 尾端，Grep "pmc-embed-ready"；origin 兩端都檢查 `location.origin`，非 embed 模式完全不掛 listener、不送訊息）：
  - iframe → 父頁：`{type:'pmc-embed-ready'}`（初始化完成，可以開卡了）；`{type:'pmc-detail-closed'}`（modal 被關閉——關閉鈕與點遮罩兩條路徑共用 `showCardDetail()` 內定義的 `closeModal`，勾子加在那裡，不是複製一份關閉邏輯）
  - 父頁 → iframe：`{type:'pmc-open-card', cardId}`（開/換卡，`showCardDetail()` 本身的 `wasAlreadyOpen` guard 已處理「modal 已開啟時換卡」不重複上鎖的問題，這裡不用額外處理）
  - 也支援直接開 `/?start&embed=1&card=<id>`——沿用既有的 `?card=` 深連結機制（2026-07-16 稍早新增），不需要 postMessage 往返
- 消費端：`promos.js` 的 `setupCardDetailOverlay()`（新戶活動頁點 ⓘ）。iframe（`src="/?start&embed=1"`）只建立一次、常駐重用，換卡靠 postMessage，不重新載入；首次載入 8 秒內沒收到 `pmc-embed-ready` 視為攔截失敗，改用 `.promo-card-info-btn` 原本保留的 `href`（`/?start&card=<id>`，`target="_blank"`）開新分頁，之後的點擊也不再嘗試 iframe。`.promo-card-info-btn` 額外帶 `data-card-id`（由 `apps-script/cards-export.gs` 的 `pmcRenderPromoCard_` 生成，Grep "data-card-id"）供 postMessage 用，不用重新解析 href。
- 不動 auth／登出流程：`onAuthStateChanged` 在 embed 模式下照常跑，iframe 與主站同網域，個人化資料（分級、筆記、額度等）自然可用。

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

**資料**：Google Sheets `Highlights` 工作表 → `cardsData.spotlights`。欄位：merchant, rate(數字), description, card_name, card_id, cap, deadline(YYYY/MM/DD), order(數字), active(布林), category(選填；2026-07-21 起卡片上不再顯示，欄位保留)。

**卡片版式（2026-07-21 F-2 重設計）**：左側傾斜卡圖（`assets/images/cards/<card_id>.png`，object-fit contain＋drop-shadow；`onerror` 隱藏 img 並在 `.spotlight-ccwrap` 加 `noimg` class 讓貼紙退回靜態）＋淺綠回饋率貼紙（#15803d on #bbf7d0、白邊、微旋轉）；右側＝活動類型標籤＋通路名（粗體）＋描述。**活動類型標籤**：`parseSpotlightHype()` 從 description 開頭抽「XX！」對表（全場最高/壓倒性神卡/獨家回饋/無腦刷 → hype-top/god/excl/easy 四色），是全卡唯一帶分類色的元素；對不到表列類型→不顯示標籤、description 全文照常顯示（資料端不需配合）。下方虛線分隔的資訊列放上限＋期限（含「剩 N 天」徽章）。設計裁定（站長 2026-07-21）：不用 emoji、不用浮起／轉正動畫（hover 只准陰影微調）、回饋率不上分類色。

**輪播**（`renderSpotlights` 一帶）：每頁 3 張（SPOTLIGHT_PAGE_SIZE）、6 秒自動換頁（SPOTLIGHT_INTERVAL）、循環；「看下一組」手動換頁＋頁碼圓點；hover 卡片或開 modal 暫停；最多 12 則（SPOTLIGHT_MAX）依 order 升冪；`active===false` 不顯示；≤3 則自動隱藏按鈕與圓點；顯示時機跟著 `showToolSections()`/`hideToolSections()`。

**固定高度（防跳動）**：`.spotlight-card { min-height: 200px }`；`.spotlight-top-row` min-height 92px（有無類型標籤高度都以卡圖列為準）；`.spotlight-desc` 用 `-webkit-line-clamp: 2` + `height: 3em`；`.spotlight-info-row` min-height 28px、nowrap。

**兩個動作**：
- 「比較這個通路 →」（`compareSpotlightMerchant`）：merchant 完全等於某快捷搜尋 displayName（如 `所有加油站`）→ 走 `handleQuickSearch`（多關鍵詞）；否則當一般單一商家搜尋。⚠️ merchant 一律是單一搜尋詞，不支援多商家字串。**這是全站唯一自動觸發計算的入口**（兩條路徑都代按計算、金額空白補 1000）——快捷搜尋按鈕與 `handleQuickSearch` 本身自 2026-07-12 起只填入關鍵詞、不自動計算（產品決策：計算由用戶按「計算」觸發），要復原或擴大自動計算屬產品行為變更，先問用戶
- ⓘ（`openSpotlightModal`）：顯示**卡片的真實活動**（不是 sheet 編輯文字）——用 card_id 找卡，`findSpotlightCardActivities(card, merchant)` 從 `card._itemsIndex` 找涵蓋該 merchant 的 cashbackRate；關鍵字來源：merchant 對到快捷 displayName 時用該選項 merchants，否則用 merchant 本身；先精確比對再退子字串。顯示真實 rate/cap/period/conditions/items；placeholder 用 parseCashbackRateSync/parseCashbackCap＋卡片第一個級別解析。**找不到活動 → 退回 sheet 編輯文字**。⚠️ 只比對 cashbackRates，通路在 specialItems 的分級卡會退回編輯文字。modal 內唯一動作按鈕是「馬上辦卡」（來自 `cardsData.cardApplyCtas[card_id]`，無連結不顯示）

**相關檔案**：index.html `#spotlight-section` `#spotlight-modal`（merchant/momo.html、merchant/蝦皮.html 有同一組容器標記，卡片由 js 動態生成、不需同步改）；styles.css `.spotlight-*`（「剩 N 天」徽章 0–14 天顯示）。

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

## 8. 「我的配卡組合」modal（分組卡片式，2026-07-17 重造；UI 名稱原為「我的配卡」，2026-07-21 改為「我的配卡組合」，id/函數仍沿用 mappings）

**視圖**（`renderMappingsList()`，Grep "分組卡片式視圖"）：一張信用卡＝一個 `.mapping-group`——卡名色塊（統一淺灰 `#f1eff0`，卡名 14px）＋卡圖小圖＋ⓘ 貼卡名旁（開 showCardDetail，`#card-detail-modal` z-index 1100 疊在所有 modal 之上）。組內一列＝一個**活動**：同卡＋同回饋率＋同截止日的配對合併，商家各自成白底 pill（仿快速搜尋 `.tag-item`；刪除 × 在 pill 內、紅色）；列左活動期限、右綠色回饋率。活動列**不開放拖曳**，固定回饋率高→低（同率截止日近→遠）。舊表格視圖已移除。手機無橫向捲動。

**卡面主色（已退役）**：色塊 2026-07-17 起統一淺灰、不吸卡面色（用戶決定）；原 `CARD_ACCENT_COLORS` 抽色表與 `isLightAccentColor` 已從 script.js 移除，抽色方法與 28 卡 hex 見 git 歷史（commit 訊息搜 accent）與下方教訓記錄。

**過期沉底**：過期配對離開群組、收進底部「已過期（N）」收合區（顯示商家＋卡名，仍是舊式單筆列＋`.mapping-delete-btn` 紅 ×），內有「清除全部過期配對」一鍵清理；卡名色塊上**不得**出現過期資訊。14 天內到期顯示黃色「即將到期」章。

**拖曳排序**（`setupMappingsDrag`）：兩種拖曳——卡片組從把手整組拖（`.mapping-group` 之間換位）、商家 pill 整顆拖（限同一活動列的 pills 容器內；跨列＝不同率/日期，語義不允許）。拖曳元素 `touch-action: none` 供觸控。**move/up 監聽掛 document，禁用 setPointerCapture**（Chromium 會在拖曳中途無故 lostpointercapture 斷流，教訓見下）。順序由 `persistMappingsDomOrder()` 依 DOM 序走 `.mapping-pill` 重寫回既有 `order` 欄位（localStorage＋Firestore，資料結構不變；`order` 同時決定組序與 pill 序，活動列排序則與 order 無關）。搜尋過濾時把手不渲染、pill 拖曳不綁定＝停用拖曳（過濾後順序無全域意義）。

**其他**：搜尋框同時比對商家與卡名；樣式必須用 `#my-mappings-modal .mappings-search-input`（特異性，見教訓）；輸入字級固定 16px 防 iOS 聚焦縮放，矮身靠 padding、預覽字靠 `::placeholder`。進場浮標 `#my-mappings-btn`（琥珀底 `#fef3c7`/`#f59e0b` 系，與結果卡釘選態同色系）用釘選 SVG icon；modal 標題為純文字（標題 icon 2026-07-17 移除）。

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
- [2026-07-13] 詳情頁改分級後關閉 modal 頁面鎖死不能捲動 → 級別 onchange 重呼叫 showCardDetail() 重繪，disableBodyScroll() 多執行一次而 closeModal 只解一次（refcount 不成對）→ 任何「modal 已開啟時重繪」的路徑都要先檢查 modal 是否已顯示、已顯示就不得再上鎖（showCardDetail 內以 wasAlreadyOpen guard 實作）
- [2026-07-17] 吸卡面主色 28 張幾乎全錯（Uni 淺黃變深金、CUBE 淺灰變黑）→ 飽和度加權投票挑到 logo 而非底色＋亮度 clamp 壓死淺色 → 「主色」＝面積最大的底色（取外圈環帶最大色簇、不調亮度）；抽色/生成類產出必附「原圖 vs 結果」對照圖給用戶驗收
- [2026-07-17] 配卡列拖到一半不再跟手、放開也不存檔 → Chromium 對 setPointerCapture 的元素在拖曳中途無故 lostpointercapture、事件斷流 → 自訂拖曳的 pointermove/up 監聽掛 document，不依賴 pointer capture
- [2026-07-17] 配卡搜尋框樣式怎麼改都沒反應 → 全域 `input[type="text"]`（特異性 0-1-1）壓過純 class（0-1-0），該 class 樣式從未生效 → 元件覆蓋全域 input 樣式時用 `#modal-id .class` 提特異性；「改了沒反應」先查特異性再查快取
- [2026-07-17] 從配卡 modal 點 ⓘ 詳情頁開在後面 → 全部 .modal 同 z-index 1000、同層疊序由 DOM 順序決定，而 #card-detail-modal 在 HTML 較早 → 詳情頁固定 z-index 1100；任何「modal 疊 modal」需求不得靠 DOM 順序
