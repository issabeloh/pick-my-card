# UI 與顯示邏輯（詳情頁、Spotlight、我的信用卡、各 modal）

> 改「畫面顯示、modal、詳情頁、推薦活動」前必讀。行號是 2026-07-11 快照——一律先 Grep 關鍵字定位。
> 通用原則：注意 CUBE / DBS Eco / 玉山 Uni Card 的特殊處理；避免重複顯示資訊；保持 UI 簡潔。

## 1. 卡片詳情頁（#card-detail-modal，showCardDetail(cardId) 開啟）

> ⚠️ **2026-11-17 起外殼已改版（第 1m 節）**：詳情頁從浮窗改成全頁＋藍色頁首＋摘要＋頁籤＋浮動申辦膠囊。下面這節裡關於「sticky 標題列／`.card-detail-nav` 八顆錨點導覽／`#card-detail-apply-bar` 底部申辦列／`.modal-content` 捲動容器／近期異動區塊樣式／導覽鈕被借用來捲動」的描述是舊版，以第 1m 節為準；回饋卡、個人設定、級別「i」說明窗、登錄連結、官網連結的規則仍有效。

**個人設定區塊**（`#card-personal-section`）：⚠️ **2026-11-17 第三輪整個改寫，見第 1o 節**（統一自動儲存、常駐儲存狀態列、兩組一欄一列；舊的單一灰底框 `.personal-settings-box`、`.personal-field*`、`.cube-settings-grid`、💾 儲存鈕、`#save-indicator`、`#credit-limit-saved` 都已刪除，CSS 一併清掉）。下面「級別選擇器與『i』說明窗」仍有效，只是選擇器與說明窗現在掛在「計算條件」組的第一列。
- 非分級卡：`showCardDetail()` 會把 `#cube-level-section` 的 **innerHTML 一起清掉**（不只 `display:none`），整區只剩「我的紀錄」一組，免得上一張卡的級別選擇器與說明窗留在 DOM 裡

**級別選擇器與「i」說明窗**（Grep `setupLevelHelpPopover`）：
- 下拉選單選級別；「各級別回饋率」與該級別的 `level-note` **收在下拉選單旁的「i」按鈕裡**，點擊開浮動說明窗（2026-08-01 改；原本兩段小字攤在選擇器旁/下方，把個人設定區撐高又擠掉真正要操作的選單）。兩段都沒內容時不長按鈕
- 說明窗用**原生 Popover API** 進 top layer：詳情頁是 z-index 1100 的 modal、`.modal-content` 有 `overflow-y:auto`，一般絕對定位浮層會被裁掉。CSS 必須寫 `inset: auto`，否則原生 popover 會置中在畫面正中央、JS 的 fixed 座標吃不到。不支援的瀏覽器退回 `.is-open` class，並自己補「點外面關閉」
- `#level-note` 節點**一定存在**（級別切換時就地改寫它的文字），空字串時靠 `:not(:empty)` 不佔位——不能靠「有沒有渲染」來決定間距
- **鐵則：級別回饋率只在「i」說明窗顯示一次，回饋內容區（specialContent）不再重複顯示**

**回饋內容區域**（2026-07-09 起逐筆顯示，不再按 rate+cap 合併）：
- 分級卡兩條路徑共用 `renderCashbackRatesIndividually()`（2026-11-17 起回傳 `{ entries, upcoming }`，entry 交給 `planCardsHtml` 併成同方案卡；CUBE 用自己的 `generateCubeSpecialContent`，回傳 `{ html, general }`）
- `category` 顯示為回饋卡的標題列（2026-10-05 起，原為回饋率旁的藍色 chip；見 1h 節），`getCategoryDisplayName()` 做名稱轉換
- 回饋率顯示 `getDisplayRate()` 加總值（stacking = 指定+基本+加碼，與搜尋結果一致）
- stacking 模型（cashbackModel 含 `+`）的回饋率數字本身是按鈕、點了展開「回饋組成」（`rateCompositionData` + `toggleRateComposition`；2026-11-22 起不再有計算機圖示，見 1q）

**仍存在的合併只有兩處**：CUBE 專屬產生器（按 rate+category+period 合併，category 不會被吃掉）與搜尋結果的 `mergeResultsByActivity`。

**特殊處理**：~~玉山 Uni Card 條件可展開/收起（toggleConditions）~~ 2026-10-05 起改由條件列統一的「...展開」處理（`toggleConditions` 已於 2026-10-06 刪除）；CUBE 用 specialRate、顯示「無上限」；DBS Eco 有特殊 cap 說明格式。

**Header 與連結**：modal 標題就是 `card.name`（無「詳情」後綴）；header 左上有卡片圖；卡全名純文字（無「信用卡官網連結:」標籤）；新戶活動區塊無「官網連結」。

**信用卡官網連結（2026-11-15，站長從 A–E 五種 mockup 選定 A「銀行名稱底下一行」）**：`#card-official-site-link`，灰色 13px「前往信用卡官網頁面 ⧉」，hover 才變藍加底線，資料用 `card.website`。
- 擺在 `.card-full-name-bold` **外面**（同一個 `.info-item` 內）：那裡的 `a` 規則是粗體藍字 `!important`，放進去就不低調了。`.info-item` 是直向 flex，連結要 `align-self: flex-start`，否則整欄寬都可點
- `showCardDetail()` 每次都重設：`sanitizeUrl(card.website)` 不合法就 `hidden` ＋ 移除 href，避免上一張卡的連結沿用
- GA4：`button_click`，`button_type = detail_official_site`（帶 card_id/card_name）。7 月曾因少人點擊拿掉卡全名連結與新戶活動區「官網連結」，這次加追蹤就是為了能用數據判斷去留
- 沒選的方案：B 基本資訊右上角、C sticky 標題列卡名下（會把手機標題列從 57px 撐高，否決）、D 頁底附「以官網為準」、E 新增「官方網站:」欄

**Sticky 標題列（桌機 2026-09-18、手機 2026-09-23）**：`#card-detail-modal .modal-header` 是 `position: sticky; top: 0`（`z-index: 11` > nav 的 10），捲動時卡名、卡圖與右上角 ✕ 都留在畫面上。**手機是精簡版**：卡圖 56→36px、padding 20→10px/16px、卡名 1.25→1.05rem，整列 97→57px（iPhone 13 實測）。
- **為什麼手機要精簡**：手機 modal 只有 80dvh（iPhone 13 可視 531px），照桌機的 97px 釘，標題＋導覽列會吃掉 28% 可讀高度——2026-09-18 首次上線時就是為此只給桌機；收到 57px 後降到 11%，才換得回「捲到一半還看得到自己在看哪張卡、也隨時按得到 ✕」。
- **`.card-detail-nav` 的 `top` ＝ `var(--pmc-detail-header-h)`**，才會黏在標題底下而不是蓋住它。這個變數由 `setupCardDetailNav()` 的 `syncHeaderHeight()`（`js/results-display.js`）寫入，且**掛了 ResizeObserver 持續同步**：卡圖是 `height:36px; width:auto`，圖片 load 完才開始佔寬度，窄螢幕上會把卡名擠成兩行（320px ×「中信 Uniopen 聯名卡」實測 57→75px），只量開啟當下的話 nav 會蓋掉半條標題。ResizeObserver 順帶涵蓋轉向與視窗縮放。
- **捲動落點 `stickyOffset()` 用 `getComputedStyle(...).position === 'sticky'` 判斷**，不寫死斷點——CSS 改斷點不必動 JS。

**申辦 CTA（2026-07-15 新增）**：`cardsData.cardApplyCtas[card.id]` 有 `link` 時，`showCardDetail()` 同步填入兩個常駐按鈕（無 link 時兩者都明確 `hidden = true`，防止上一張卡狀態沿用）——`#card-detail-apply-header-btn`（桌機，卡名旁，`≤768px` 隱藏）與 `#card-detail-apply-bar`（手機，`.modal-content` 捲動容器內最後一個子節點、`position: sticky; bottom: 0`，`≥769px` 隱藏）；bar 的文字來自 `applyCta.text`（空字串則只留按鈕）。兩者 href 都走 `sanitizeUrl()`，click 落入 GA4 delegation（`detail_header_apply` / `detail_sticky_apply`）。

**近期異動（2026-08-01 新增，issue #375 PR-2）**：位在**「指定通路回饋」上方**（`#card-changelog-section`，nav 也多一顆「近期異動」鈕），資料來自 `card.changelog`（Apps Script「變動紀錄」表匯出，最多 5 筆、由新到舊；來源與發布流程見 `apps-script/README.md`「發布變動紀錄」）。每列「日期 ＋ 一句話」，日期由 ISO 轉斜線顯示（`formatChangelogDate`）。
- **版位理由**：權益剛變過是讀下面那些回饋數字時的前提，所以擺在回饋內容之前。但它只是補充資訊、不該搶視線——所以不用 `.cashback-detail-item` 的卡片框。
- **樣式（站長 2026-08-01 從三種 mockup 選定「連續清單」）**：`.card-changelog-list` 整區一塊淺灰底（`#f9fafb` ＋ `#edeff2` 細框），條與條之間用髮絲線分隔。讀這區的動作是「快速掃過去看最近有沒有變動」，連續底色比一條一條的獨立卡片好掃、垂直空間也最省；獨立卡片版在實際頁面會變成「個人設定的框 ＋ 一堆小框」。手機（≤480px）日期改放句子上方一行，避免句子只剩 60% 寬度而斷成三四行。
- **渲染函數** `renderCardDetailChangelog()`（`js/card-detail.js`）刻意**不走 innerHTML**，用 `createElement` + `textContent`：`summary` 是站長在 Sheets 自由輸入的文字（鐵則 3），textContent 比事後 `escapeHtml()` 少一個「哪天改成字串拼接就破功」的失誤面。
- **沒有異動的卡整塊不渲染**（鐵則 4：空陣列不是 falsy，`!card.changelog || length === 0` 兩個都要判），nav 鈕由 `setupCardDetailNav` 的 `offsetParent` 檢查自動隱藏。
- **側選單「最近異動」（2026-09-08 新增）**：`#sidebar-changelog`，標題純文字「最近異動」（原本帶 📢，站長 2026-09-08 拿掉），位在側選單卡片 chips 之下、`.sidebar-page-links` 之上，**桌機側欄與手機抽屜都顯示**（`.sidebar-page-links` 在 ≥769px 隱藏，這塊刻意不跟著隱藏——桌機側欄下半部本來就是空的）。渲染函數 `renderSidebarChangelog()`（`js/cards-modals.js`，由 `home-ui.js` 主初始化在 `populateCardChips()` 之後呼叫）**每張卡只取最新 1 筆**（`card.changelog` 匯出時已是新→舊，取第一筆有效的），再跨卡依 `date` 由新到舊取前 5 筆，每列＝卡名＋摘要單行 ellipsis 截斷（摘要最長實測 206 字，不截會把側欄撐成文字牆；全文靠 `title` hover 或點進詳情頁）。
  - **排序不需要人工維護**：`entry.date` 是 ISO 字串可直接字典序比大小，「變動紀錄」表新增一列重新匯出就會自己浮上來。**同日多筆維持 `cardsData.cards` 的順序**（`Array.prototype.sort` 穩定排序）——匯出的 changelog 只有 `date`，`readChangelog()` 的 `_seq`（試算表列序）在匯出時就丟掉了，站長 2026-09-08 定案不為此改匯出程式；要精確到同日先後才需要讓 `cards-export.gs` 把列序一起帶出來。
  - **一卡一列的理由**（站長 2026-09-08 定案）：同一張卡連續佔掉兩三列時，點哪一列都是進同一張卡的詳情頁，等於用掉名額卻沒多給一個去處；一卡一列才能讓這 5 列涵蓋到 5 張不同的卡，該卡其餘異動在詳情頁的「近期異動」區看得到。
  - **點擊行為** `openCardDetailAtChangelog()`：先 `window.closeSidebarDrawer()`（手機）→ `await showCardDetail()` → `requestAnimationFrame` 後**借用詳情頁 sticky nav 那顆「近期異動」鈕的 `onclick`**（`setupCardDetailNav` 掛的）來捲動。刻意不自己寫 `scrollIntoView`：nav 的版本會扣掉 sticky nav 高度、把標題停在 nav 下方 8px 並同步點亮該鈕，自己寫一份的下場是標題被 nav 蓋住、日後 nav 改高度兩邊各走各的。rAF 是必要的——modal 還 `display:none` 時 `getBoundingClientRect` 全是 0。

**銀行官方登錄連結（2026-09-08 新增）**：需登錄才算數的活動，其登錄頁網址存在該回饋組的 `rate.registerLink`（Cards Data 的 `registerLink_N`，見 `docs/project/data-pipeline.md` 第 2 節）。`renderRegisterLinkLine(url)`（`js/cards-modals.js`，緊鄰 `renderConditionLine`）把它渲染成該組條件下方的一行「銀行官方登錄連結 ⧉」超連結（方框箭頭 SVG ＝「會開新分頁」，站內其他連結用純文字 ↗）。
- **網址本身不顯示**：那些網址又長又醜，而且同一組的 `conditions` 早就在講「需登錄」了，這裡只是給一個可以直接點過去的去處
- **四條 render 路徑都要接**（改一條會漏掉其他）：`renderCashbackRatesIndividually()`（分級卡，`js/cashback-engine.js`）、非分級卡的 `specialContent`（`js/card-detail.js`）、CUBE 的合併路徑（`mergedRate.registerLink`，合併時留先遇到的那一個）、搜尋結果卡片（`js/results-display.js` 的 `result.matchedRateGroup`）。全部都**不依賴 `conditions` 有沒有值**（沒有條件的組別一樣要能顯示登錄連結）
- ⚠️ **搜尋結果那一條要放在三個分支「之外」**（2026-09-08 上線第一天踩到）：`additionalInfo` 是由 `if (isUpcoming) / else if (matchedRateGroup) / else if (endingSoonInlineBadge)` 三支分別組出來的，登錄連結原本只寫在中間那支，於是「即將開始的活動」與「只有即將結束徽章」兩種情況都看不到登錄連結——而那兩種恰恰最需要提醒用戶「記得先登錄」。現在改成三支跑完後，只要 `matchedRateGroup.registerLink` 有值就補上
- ⚠️⚠️ **但光是移出分支還不夠**（同日第二次修）：「即將開始」的結果**根本沒有 `matchedRateGroup`**——見下方 1d 節。要先讓 `findUpcomingActivity()` 帶上槽位原件，那個 `if (result.matchedRateGroup)` 才對即將開始的活動成立
- ⚠️ **「詳情頁看得到、搜尋結果沒有」不一定是 bug**：詳情頁列出該卡**所有**槽位，搜尋結果只顯示**引擎實際命中的那一個**槽位。例：搜「中油Pay」時玉山 Ubear 卡命中的是 3% 的行動支付槽（沒有登錄連結），而不是 3% 的中油Pay 專屬槽（有連結）——兩者是不同活動。回報這類問題前先確認「搜尋結果顯示的活動期間/條件」跟「詳情頁那個有連結的槽位」是不是同一筆
- **鐵則 3**：`renderRegisterLinkLine` 內 `sanitizeUrl()` 只放行 http/https，不合法就整行不渲染。`sanitizeUrl` 刻意在 href 那一行**再叫一次**（不用上面存好的變數）——`tools/security-scan.sh` 的 SEC6a 是逐行掃的，同一行看不到 `sanitizeUrl` 就報錯
- **App 專屬 scheme 一律擋掉**（`cathaybk://`、`linepay://`…）：沒裝 App 的手機上是一個看不懂的錯誤畫面，而且各家 scheme 沒有公開保證、改版就失效。只能在 App 內操作的活動請把步驟寫成文字放進 `conditions_N`

**進入詳情頁的入口**：搜尋結果卡片點擊；sidebar 卡片 chips；`#cards-selection`/`#owned-cards-selection` 每張卡的 ⓘ 按鈕（由 `_renderCardSelectionModal` 注入，click 呼叫 `showCardDetail(card.id)` 並 `stopPropagation()` 防誤勾 checkbox；詳情 modal 疊在原 modal 之上）。

**Embed 模式（2026-07-16 新增，方案 A：新戶活動頁 iframe 內嵌詳情彈窗）**：
- 觸發：URL 帶 `?embed=1`。index.html pre-paint script（`<head>` 內，Grep "pmc-embed"）在首屏前於 `<html>` 加 `pmc-embed` class，避免閃一下完整工具介面；styles.css 對應規則（Grep "html.pmc-embed"）只留 `#card-detail-modal` 可見，其餘全站 UI（header/sidebar/main/其他 modal/footer/回報鈕/回頂鈕/spotlight/推薦比較工具列/boot loader）一律 `display:none !important`，`body`/`.container` 背景轉透明——`#card-detail-modal` 本身是 `position:fixed` 全螢幕深色遮罩，天生蓋滿 iframe viewport，不用另外改它的樣式。
- postMessage 協定（script.js 主 `DOMContentLoaded` 尾端，Grep "pmc-embed-ready"；origin 兩端都檢查 `location.origin`，非 embed 模式完全不掛 listener、不送訊息）：
  - iframe → 父頁：`{type:'pmc-embed-ready'}`（初始化完成，可以開卡了）；`{type:'pmc-detail-closed'}`（modal 被關閉——關閉鈕與點遮罩兩條路徑共用 `showCardDetail()` 內定義的 `closeModal`，勾子加在那裡，不是複製一份關閉邏輯）
  - 父頁 → iframe：`{type:'pmc-open-card', cardId, section}`（開/換卡；`section` 選填，見下方入口鈕段，`showCardDetail()` 本身的 `wasAlreadyOpen` guard 已處理「modal 已開啟時換卡」不重複上鎖的問題，這裡不用額外處理）
  - 也支援直接開 `/?start&embed=1&card=<id>`——沿用既有的 `?card=` 深連結機制（2026-07-16 稍早新增），不需要 postMessage 往返
- 消費端：`promos.js` 的 `setupCardDetailOverlay()`。iframe（`src="/?start&embed=1"`）只建立一次、常駐重用，換卡靠 postMessage，不重新載入；首次載入 8 秒內沒收到 `pmc-embed-ready` 視為攔截失敗，改用入口鈕原本保留的 `href`（`/?start&card=<id>`，`target="_blank"`）開新分頁，之後的點擊也不再嘗試 iframe。入口鈕額外帶 `data-card-id` 供 postMessage 用，不用重新解析 href。
  - **入口鈕 2026-09-17 改版**：舊的卡名旁 ⓘ（`.promo-card-info-btn`，由已移除的 `pmcRenderPromoCard_` 生成）已不存在；現在是卡片特色區右上角的「查看全部 ›」（`.promo-feat-all`，由 `tools/build-promos-features.js` 部署時生成）。`promos.js` 的點擊選擇器寫成 `'.promo-feat-all, .promo-card-info-btn'` 兩個都收，只是為了讓尚未重新部署的舊 `promos.html` 也還能用，**不是現行標記**。
  - **`data-section`（2026-09-17 新增）**：`.promo-feat-all` 帶 `data-section="card-special-section"`，`promos.js` 把它放進 `pmc-open-card` 訊息，`js/home-ui.js` 收到後點一下詳情頁對應的導覽鈕，讓詳情開完直接捲到「指定通路回饋」。刻意重用那顆導覽鈕而不是另寫捲動——它已經處理好 sticky header 偏移與 active 狀態同步。
- ⚠️ **那份隱藏清單是黑名單不是白名單**：index.html 在 body 層級新增任何區塊，都要同步加進 `html.pmc-embed` 的選擇器清單，否則會在 promos 的詳情遮罩背景透出來（詳情 modal 自己的遮罩只有 `rgba(0,0,0,0.5)`，蓋不掉、只會壓暗）。見教訓記錄 2026-09-23。
- 不動 auth／登出流程：`onAuthStateChanged` 在 embed 模式下照常跑，iframe 與主站同網域，個人化資料（分級、筆記、額度等）自然可用。

- **銀行名稱**（2026-10-17）：詳情頁最上方 `#card-full-name-link` 顯示的是 Cards Data 的 `fullName`，站長已把它改成銀行全名（例：玉山商業銀行），前面加 info-label「銀行名稱:」

## 1b. 寬螢幕桌機版面（≥1400px，2026-09-08 新增）

站長回報「桌機一切都太大、要縮到 75% 才正常，很浪費顯示空間」。量到的現況：1920px 螢幕上 `.container` 被 `max-width: 1200px` 釘死，**720px（37%）是純背景**；側欄 280px、卡片膠囊平均寬 102px（最寬 143px），一行只排得下 2 顆。

**這一版只動「可用寬度」，完全不碰字級、也不碰膠囊排版**（`styles.css` Grep「寬螢幕（≥1400px）」）：

| 視窗寬 | `.container` | 側欄 | 主內容 | 膠囊/列 |
|---|---|---|---|---|
| ≤1399px（維持現狀） | 1200 | 280 | 920 | 2 |
| ≥1400px | 1360 | 340 | 1020 | 2–3（依卡名長度）|
| ≥1700px | 1560 | 380 | 1180 | 多數 3 |

- **斷點刻意壓在 1400px**：1280/1366 這類常見筆電維持原狀，不會因為側欄變寬反而把主內容擠窄
- **膠囊本身完全不動**：側欄變寬之後 `.card-chips` 原本的 flex 自動換行就會自己多塞一顆進去，膠囊維持「各自等於內容寬、卡名不折行、高度一致 26px」的樣子
- 🚫 **不要把膠囊改成等寬 grid**：2026-09-08 曾用 `repeat(3, minmax(0,1fr))` 去「保證一行 3 顆」，站長當天就否決——等寬格線會把長卡名（「彰銀｜My樂現金回饋卡」）折成兩行，膠囊高低不齊、不再是原本的樣子。要一行多塞幾顆就把側欄加寬，讓 flex 自己決定
- 搜尋結果卡片跟著受惠：`.results-container`（以及 `.coupon-results-container` / `.parking-benefits-container` / `.cardholder-promos-container`）都是 `repeat(auto-fit, minmax(300px, 1fr))`，主內容 1180px 時自動從一排 2 張變成一排 3 張——不用另外改
- 這幾條 CSS **必須排在本檔前段無媒體查詢的 `.container` / `.app-layout` 之後**——媒體查詢不加特異性，同特異性靠源碼順序決勝
- 「字級/密度」那一半已於 2026-10-05 補上，見第 1g 節

## 1c. 側欄卡片膠囊的銀行雙色帶（2026-09-08 建立，2026-09-09 改版）

膠囊維持「左半銀行、右半卡名」的文字結構，顏色全部集中在**左緣一條 5px 的雙色帶**：

- **膠囊本體整顆中性**：底 `#f9fafb`、框 `#e5e7eb`、文字近黑 `#111827`（銀行名 700、卡名 500）。站長要求「pill 上完全不要有藍色」，2026-09-09 起連銀行色塊也拿掉——**色帶是整顆膠囊唯一的顏色**
  - 卡名 2026-09-09 由 `#6b7280`（4.63:1）**改深**成 `#111827`（16.1:1）：站長回報灰字在 33 顆膠囊裡看不清楚。⚠️ **只准更深、不准調淺**：`#8b929c` 只有 3.00:1、`#9ca3af` 只有 2.43:1，那不是「低調」是「看不到」
- **色帶 = 上半主色、下半副色，兩色都用原色不淡化**（`applyBankChipEdge()`，`js/home-ui.js`，寫成 inline 的 `linear-gradient`）。`styles.css` 的 `.card-chip-edge` 只留「查不到色碼時」的中性灰 `#dfe3e8`，刻意不寫任何有色相的值
  - **為什麼是「左緣」而不是「銀行名與卡名中間」**：2026-09-09 先做過中間版，站長回「看起來很混亂」——色帶插在兩段文字之間，等於每顆膠囊都被切成兩半，33 顆一起看就是 33 道斷點。改放左緣後顏色貼在膠囊起點、不切斷任何文字
  - **為什麼不是整顆上色**：站長明確要求「不要大面積」。同一輪比過五種小面積做法（左緣色帶／雙色圓點／底部細線／彩色外框＋圓點／斜切小方塊），選定左緣色帶
  - ⚠️ **`.card-chip-edge` 的 `box-shadow: inset 0 0 0 1px rgba(0,0,0,.18)` 不是裝飾**：玉山／遠東／滙豐／台新／永豐 的副色是白色，沒有這圈邊，色帶下半在 `#f9fafb` 膠囊上看起來像「膠囊破了個洞」。站長 2026-09-09 裁定就這樣處理、不替那五家另指定第二色
- **色碼是資料驅動**：唯一來源是 Sheets 的 `BankColors` 工作表（`color` 主色、`accent` 副色，見 `docs/project/data-pipeline.md` 第 2 節第 13 項），匯出成 `cardsData.bankColors` 與 `cardsData.bankAccentColors`。**銀行改 CI 只要改 Sheets 一格、不必動程式**
  - 2026-09-09 當天 16 家的 `color`／`accent` 已全部填齊（星展與中信的 `color` 欄同時改成新主色），前端沒有任何硬寫的色碼
- **查不到主色 → 整條不上色**（工作表沒建、這家沒填、色碼格式錯被匯出端擋掉），退回 `.card-chip-edge` 的中性灰。**查不到副色 → 上下同色的單色帶**（那家 CI 本來就只有一支色，例如兆豐／凱基／企銀／陽信／彰銀）。沒顏色比錯顏色好，也讓這功能可以慢慢補齊

**目的是「快速定位」不是「品牌辨識」**：站長 2026-09-08 明確表示同色系撞色沒關係（綠族五家、紅族四家）——有顏色分區就已經把 33 顆膠囊的搜尋範圍縮掉一大半，不需要每家獨一無二。副色是 2026-09-09 補上的第二層，讓紅族／綠族內部再分得開一點。

⚠️ **量密度要用真實寬度**：側欄 340px、膠囊區 307px。2026-09-09 做 mockup 時先用 760px 排版，一行塞太多顆，把「亂不亂」判斷歪了——之後任何膠囊排列的 mockup 一律 307px 起跳。

## 1d. 為什麼搜尋結果的 `additionalInfo` 分成三支（2026-09-08 追查）

站長問「即將開始只是多一個徽章，為什麼要走不同分支？」——追下去發現**不是徽章的問題，是兩種結果根本由不同的產生器造出來、欄位形狀不一樣**：

| | 進行中的活動 | 即將開始的活動 |
|---|---|---|
| 產生器 | `calculateCashback()`（`js/cashback-engine.js`） | `findUpcomingActivity()`（同檔，另一支） |
| 期間怎麼拿 | `result.matchedRateGroup.period` | `result.period`（自己抄一份） |
| 條件、門檻 | `matchedRateGroup.conditions` / `.minSpend` | **沒有**，那支沒抄 |
| 槽位原件 | `matchedRateGroup`＝槽位物件本身 | ~~沒有~~ → **2026-09-08 補上** |

`findUpcomingActivity()` 是把需要的欄位**一個一個抄進新物件**（rate / cap / matchedItem / periodStart / periodEnd / period / …），沒有帶槽位本身。所以 `displayResults()` 面對兩種結果必須讀不同的欄位，才被迫分裂成三支；徽章只是表象。

**已做的修正（低風險、純新增）**：`findUpcomingActivity()` 推入結果時多帶一個 `matchedRateGroup: rateGroup`。純新增欄位、沒有任何既有讀取被影響，但需要槽位資料的顯示邏輯（目前是銀行官方登錄連結）從此兩種結果共用同一條路。

**第二步（同日，站長要求「更難出錯、更直接」）**：三支合併成一條。站長的判準很清楚——**三種活動的卡片內容應該完全相同，差別只在徽章**。徽章本來就與這段無關（「即將開始」在 `.badges-container`、「即將結束」是 `endingSoonInlineBadge`），所以合併之後：

```js
const group = result.matchedRateGroup;
// 期間：優先用槽位的 period 字串，沒有就用 periodStart/End 組
// 條件、登錄連結、滿額門檻：一律讀 group
```

- **實測三種狀態**（把玉山 Pi 卡「屈臣氏」那個槽位的期間分別改成進行中／10 天後開始／5 天後結束）：活動期間、條件、滿額門檻、登錄連結**四項全部一致出現**，只有徽章不同
- **一併修好的漏顯示**：`periodStart/End` 有值但 `period` 字串是空的槽位，搜尋結果卡片**從來不顯示活動期間**。舊碼只在 `period` 字串存在時才印那一行；看似有退路的第三支（用起訖日自己組字串）因為條件不可能成立而是死碼，所以這些槽位是「永遠沒有期間那一行」，不是「只在快結束時才有」。
  - 目前資料裡有 3 個：滙豐 Live+ 卡 slot 21、滙豐現金回饋御璽卡 slot 21（兩者 `hideInDisplay=TRUE`，只在搜尋結果出現）、iLEO 信用卡 slot 9「國外實體消費」，都是 2026-07-01~2026-12-31
  - 實測對照（搜「國外實體消費」看 iLEO 那張卡）：改動前只有「條件: …」，改動後多出「活動期間: 2026/7/1~2026/12/31」
  - ⚠️ 根因在資料端：`period_N` 空白但 `periodStart_N`/`periodEnd_N` 有值。前端補顯示只是止血，**Sheets 那三格的 `period_N` 該補上**（見 data-pipeline.md 第 8 節的日期雙格式陷阱）
- 回歸 12 組沒有新增差異（那 3 個槽位不在測試情境裡）

**通則**：兩個產生器在描述同一種東西（一檔活動）時，**要嘛共用同一個物件形狀，要嘛其中一個帶著原件**。各自抄欄位的下場就是顯示端每加一個欄位都要記得改兩個地方，而漏掉的那邊不會報錯、只會靜默少一行。

## 1f. 結果區標題照內容組（2026-09-29）

> **2026-11-14 改版（站長決定結果分區）**：`<h2>` 現在只講主結果那一類（`一般回饋`／`指定通路回饋`；空的是`搜尋結果`），
> 不再用「、」「與」串接；排除卡與即將開始改由各自的小標題交代，沒有主結果時 `<h2>` 收起來。下表「兩種以上」那列已不適用。見第 1k 節。

`#results-section` 的 `<h2>` 以前寫死兩種：`isBasicCashback ? '一般回饋' : '一般回饋與指定通路回饋'`。
後者從來就不準——有匹配時結果裡根本沒有一般回饋那幾張（實測搜「全聯福利中心」只有 2 筆指定通路），
只有即將開始的活動時也照喊。現改成看 `results` 裡真的有什麼就寫什麼（`js/results-display.js`，
Grep `titleParts`）：

| 內容 | 標題 |
|---|---|
| 只有 `isBasic` | 一般回饋 |
| 只有進行中的指定通路 | 指定通路回饋 |
| 只有 `isUpcoming` | 即將開始的活動 |
| 兩種以上 | 用「、」串、最後一個用「與」（如「指定通路回饋與即將開始的活動」） |
| 0 筆（「無符合的信用卡」那塊） | 搜尋結果 |

- **領券與停車折抵不歸這條管**：它們各有自己的 `<section>` 與 `<h2>`（`領券型活動`／`🅿️ 停車折抵優惠`），
  本來就照內容顯示／隱藏
- **只有領券時整個結果區收起來**（`results.length === 0 && suppressEmptyMessage`）——留著就是一個
  有標題的空框，標題怎麼寫都在騙人。⚠️ 連帶要改捲動目標：`scrollIntoView` 對 `display:none`
  是 no-op，不改就會停在頁面頂端、看不到券，所以這種情況改捲領券區
- ⚠️ 回歸的 `extract()` 不擷取區塊標題與顯示狀態，所以標題改動**回歸測不到**（13 組全綠只代表沒誤傷
  卡片內容）。驗證靠手動實測五種情境：只有一般回饋／只有指定通路／只有即將開始／只有領券／兩種並存

## 1e. 沒有進行中活動時的「清場」規則（2026-09-29 擴及即將開始）

`findMatchingItem` **不看期間**，所以「只存在於未開始活動裡」的商家一定匹配成功、卻算不出任何
進行中活動 → 走 `matchedButNoActivity`（`js/cashback-engine.js`，Grep `matchedButNoActivity`），
該分支會把**比較清單裡每一張卡的一般回饋**列出來。

規則：**匹配成功但沒有進行中活動時，只要下方還有別的東西可看（領券優惠／即將開始的活動），
就把一般回饋整批收起來**（`results.filter(r => !r.isBasic)` ＋ `isBasicCashback = false`）。
理由是留著會把真正有料的那幾筆推到畫面很下面，而且同一張卡會「一般回饋」與「即將開始」各出現一次。

- 領券：2026-09-11 起（`couponOnly`）
- 即將開始：2026-09-29 起（`upcomingOnly`，站長裁定）。實測搜「愛電王實體門市」（CUBE 10/1 開跑的槽）
  由 34 張卡（33 張一般回饋＋1 張即將開始墊底）變成只剩 1 張
- **狀態列必須先講「目前沒有進行中的活動」**再講有幾檔即將開始——少了這句，用戶會以為那個回饋率今天就能刷。
  兩種同時存在時兩個數字都講（`目前沒有進行中的活動，有 N 筆領券型活動、M 檔即將開始的活動符合你的選項`）。
  領券單獨成立時沿用舊句子（不加前綴），別去動它——回歸案例 #13 綁著那句
- ⚠️ 凍結資料（`tools/regression/fixture.data`，時鐘鎖 2026-09-11）裡**一個 30 天內即將開始的槽都沒有**，
  所以這條規則**回歸測不到**，13 組全綠只證明「沒誤傷既有路徑」。要驗證得用線上資料手動實測

## 1g. 桌機密度調整（≥1025px，2026-10-05）

1b 只放寬了「可用寬度」，站長仍要把瀏覽器縮到 75% 才舒服——剩下的是**字級與留白的密度**。（2026-09-08 曾在當時的 main 上做過一版，但沒合併就過期了：之後 main 改了 454 個 commit，所以在 2026-10-05 的 main 上重新盤點、重做。）

**沒有單一開關，這是前提不是偷懶**：

| 想過的做法 | 為什麼不行 |
|---|---|
| `html { font-size: 87.5% }` | `styles.css` 的 px 與 rem 字級各約一半，只拉得動 rem 那一半，比例會歪 |
| `zoom` / `transform: scale()` | 詳情頁 sticky nav 的捲動靠 `getBoundingClientRect` 與 `scrollTop` 換算（`setupCardDetailNav`），縮放會讓兩個單位對不上 |

**做法：三個 `@media (min-width: 1025px)` 區塊，放在 `styles.css` 最後（`faq.css` 另有對應區塊），逐條覆寫**（Grep「桌機密度調整」）：

| 類別 | 內容 | 比例 |
|---|---|---|
| 第 1 類 字級 | `font-size`（styles 100 條、faq 7 條） | ~0.87×（24→21 / 16→14 / 15→13 / 13→11.5 / 12→11，rem 同比例） |
| 第 2 類 內距 | `padding` / `margin` / `gap`（styles 152 條、faq 9 條） | ~0.85×，只縮 >3px、下限 3px，`auto`/`0`/`em`/`%` 不動，負值同比例 |
| 第 3 類 控制項高度 | 寫死 px 的 `width`/`height`/`min-height` | ~0.87×，手挑 |

- **清單怎麼來的**：Playwright 在 1920×1080 實跑首頁／搜尋結果「家樂福」／詳情 modal（`?card=cathay-cube`）／推薦活動／faq，掃 `document.styleSheets` 取「桌機會套用且元素真的存在」的規則，再機械套比例。要往下再縮一階就照同流程重產，不要手動維護
- **選擇器照抄原規則**（含 `.app-layout main xxx` 這種高特異性版本），靠「同特異性、源碼在後」取勝——**這三個區塊必須留在檔案最後**；之後在 styles.css 末尾新增桌機規則時，若跟這裡的選擇器重疊，要寫在密度區塊之前或把值一起改
- **faq.css 在 styles.css 之後載入**：FAQ 專屬選擇器寫進 styles.css 會被蓋掉，所以 faq.css 有自己的同名區塊
- **斷點 1025px**：手機與平板完全不受影響。也是輸入框能從 16px 降到 14px 的前提（16px 防 iOS 聚焦縮放，只在手機有意義）

**刻意不納入的兩塊**：
- **promos.css**：新戶活動頁 2026-09-18 與 PR #481 已人工調過桌機尺寸（站長實測要縮到 80% 才順眼，整組改成比手機再小一階），再疊一層會縮兩次
- **我的刷卡小抄（`#mappings-page` / `.mp-*`）**：有自己的字級設定與存圖排版。⚠️ 它**沒有自己的根字級**、會繼承縮過的 `.app-layout main`（0.9rem → 0.79rem），所以密度區塊裡另把 `#mappings-page` 釘回 `0.9rem`。驗證方式是比對 `#mappings-page` 內每個元素的計算樣式（一般＋編輯模式 250 個元素），前後只差置中用的 auto 外距 4px（main 左右 padding 30→26 造成）

**刻意不縮**（縮了就是 bug）：
1. 替絕對定位的圖示／徽章保留的空間——`#merchant-input` 的 `padding-right:44px`（清除鈕）、`.cashback-search-input` 的 `padding-left:30px`（放大鏡）、`.input-clear-wrap > input` 的 30px、`.card-result.best-card .card-header` 的 64px（最優回饋徽章）、`.personal-field-hint-indent` 的 20px
2. 18px 以下的圖示與核取方塊
3. `em` / `%` / `auto` 的值——會自己跟著縮過的字級走

**成對規則**：`width`、`height` 都寫死的圓形／方形按鈕一起改，只改一邊會從圓變橢圓。**耦合規則**：頁籤 `.home-view-switch` 的 `margin: 12px -20px -10px` 是用來吃掉 header 的 `padding: 10px 20px`，兩邊同比例縮（-17/-9 對 17/9）才接得回頁首底邊。

**不能照乘比例的特例**：`.matched-item-row` 的 `min-height` 原為 46px 並註明「與計算按鈕同高」；按鈕縮完實測 35px，所以填 35px。**凡是註解寫「與 X 同高／同寬」的值，要去量 X 的新尺寸，不能照乘比例。**

**副作用與處理**：膠囊變小後，快捷搜尋可視列（`overflow:hidden` 硬切）會多擠進「半顆」膠囊。不隱藏不截字（站長否決過為了整齊犧牲內容），改右緣 24px 漸淡（`mask-image`）——它本來就完整收在「更多」下拉裡。

## 1h. 詳情頁回饋卡比照搜尋結果卡片（2026-10-05）

> ⚠️ **2026-11-17 起「同方案一張卡」**（三輪改版第二輪，規則與函數見 1n 節）：回饋卡的產生器從 `renderRateCard(o)`（一個回饋組一張卡）換成 `planCardsHtml(entries)` ＋ `renderPlanCard`（標題、回饋消費上限、活動期間相同的併成一張、每個回饋率一列），class 從 `.rate-card*` 換成 `.cd-rc*`／`.cd-rr*`，兩欄 grid＋subgrid「同排對齊」也拿掉了。下面這節裡關於 `renderRateCard`、`.rate-card-header/-body`、subgrid、「回饋率改綠色」的描述是舊版；**「與搜尋結果共用的片段」（徽章／門檻句／登錄連結）、「條件原樣輸出不 escape」、驗證方式與自動化回歸仍有效**。`.rate-card*` 現在只剩「一般消費排除卡」（1j）在用。

站長要求：詳情頁每一筆回饋（`.cashback-detail-item`）的資料排版要跟搜尋結果卡片一樣，用戶讀過一種就會讀另一種（產品目標「省腦力」）。差別只有少了「回饋金額」。

- **唯一產生器** `renderRateCard(o)`（`js/card-detail.js`；2026-10-05 初版放在 cards-modals.js，10-06 搬回詳情頁模組）＋ `formatRateCardCap(cap)`。詳情頁七條路徑全走它：一般回饋（國內／海外／國內加碼／海外加碼）、分級卡 `renderCashbackRatesIndividually()`、分級卡 specialItems 區塊與無 cashbackRates 的級別卡、非分級卡、即將開始、領券、CUBE 四個區塊。**要加欄位改這支，不要在呼叫端拼 HTML**——之前就是七份各自拼的 HTML，順序與字樣各不相同
- **對應關係**：卡名 → 活動類別（category；一般回饋用「國內一般消費」「海外加碼」等名稱，沒有類別就不長標題列）；右上徽章 → 「即將開始」；三欄 → 兩欄「回饋率｜回饋消費上限」；`✔ 單筆滿 NT$X`（`.spend-threshold-note`，同一個 class）；「匹配項目／活動期間／條件／登錄連結」→「適用通路／活動期間／條件／登錄連結」，順序相同；「即將結束」接在活動期間後面（同搜尋結果）
- **CSS 直接沿用搜尋結果的 class**（`.card-details` `.detail-item` `.detail-label` `.detail-value` `.matched-merchant` `.spend-threshold-note`），`.rate-card*` 只補差異：2 欄、標題列、回饋率改用綠色（搜尋結果的綠色主角是回饋金額，這裡沒有那欄，由回饋率接手）、把 `.cashback-condition` 調成 `.matched-merchant` 字樣。規則放在 `.show-more-btn` 之後、檔尾密度區塊之前
- **連帶改變**：加碼沒填 cap 時以前整行不顯示，現在固定顯示「無上限」（與 `resolveBonusComponent` 計算一致）；上限一律取整（iLEO 海外加碼由 NT$33,333.333 變 NT$33,333，同搜尋結果）；條件一律用 `renderConditionLine()` 可收合列，基本回饋與即將開始區也補呼叫 `initConditionClamps()`；類別、通路、期間改經 `escapeHtml()`（鐵則 3；通路展開走 textContent，不影響顯示）
- **驗證方式**：33 張卡詳情頁每一筆的文字，前後去掉標籤後逐字比對，只有上述兩項預期差異；時鐘設 2026-08-25 實測「即將開始」「即將結束」徽章位置
- **與搜尋結果共用的片段**（2026-10-06）：徽章文字 `renderUpcomingBadge()`／`renderEndingSoonBadge()`、門檻句 `renderSpendThresholdNote()`、下方資訊區 `renderActivityInfo()`（行序固定：通路 → 活動期間＋即將結束 → 條件 → 登錄連結），都在 `js/results-display.js` 的「回饋卡共用片段」，`createCardResultElement()` 與 `renderRateCard()` 都呼叫它們；領券型卡片 `createCouponResultElement()` 的下方資訊區也走 `renderActivityInfo()`（2026-10-08 統一行序，以前是自拼的「條件 → 匹配項目 → 活動期間」），行動支付卡片見 1i 節。**兩種卡片的「一致」由這幾支函式保證，不是靠兩份模板手動同步**——改行序、改徽章字樣只改這裡。兩邊刻意不同的只有：條件在詳情頁可收合（`collapsibleConditions`）、詳情頁通路清單可展開
- **同排對齊（2026-10-06，站長要求）**：兩欄（≥541px）時，同一排只要有一張卡有標題（活動類別），另一張就在同位置留同高的空白，讓「回饋率｜回饋消費上限」對齊；同一排都沒標題就跟以前一樣。做法是 CSS subgrid（Grep「同排對齊」）：每張卡跨兩列「`.rate-card-header`｜`.rate-card-body`」，列高同排共用；`renderRateCard` 因此**一律輸出標題列**（空的單欄時 `display:none`）、其餘內容包在 `.rate-card-body`。⚠️ 卡片底下只能有這兩個子元素——回饋組成彈出表由 `toggleRateComposition` 掛在 body 裡。⚠️ 外層容器 row-gap 必須是 0（外層 gap 會落在卡片兩列之間），排距改由卡片 margin-bottom（`--rate-row-gap`：12px，≥1025px 跟著密度區塊 10px）提供；選擇器多掛 `#card-detail-modal` 是為了壓過檔尾密度區塊的 `gap: 10px`。CUBE 慶生月提示的下方間距因此從 inline 移到 `.cube-birthday-note`。驗證：手機版 143 張截圖逐像素不變；桌機只有混排的排改變
- **搜尋結果的「活動:」行（2026-10-08，站長從 4 個 mockup 選 C）**：活動類別原本是「匹配項目: X (類別: Y)」的尾巴灰字，太不顯眼；改由 `renderActivityInfo({ activityName })` 輸出成資訊區**第一行**「活動: **Y**」（`.activity-name` 黑色粗體），行序變成 活動 → 通路 → 期間 → 條件 → 登錄連結。只有搜尋結果傳 `activityName`——詳情頁回饋卡的類別已經是卡片標題，不重複。同一張卡出現兩次（如 Richart 數趣刷／Chill刷）時就靠這行分辨。同日：回饋率下的「(分級: Level 1)」以 `{level}` 為界切成兩段 `.level-label-seg`（各自 nowrap），手機回饋率欄只有約 59px，以前會折成「(分級: Level」＋孤零零的「1)」；現在只會在「分級:」後整齊斷開，「固定回饋方案」這類長級別名由 grid 自動把欄位撐寬（320/360px 實測金額與上限欄仍維持一行）
- **自動化回歸**：`node tools/regression/card-detail-test.js`（見 `docs/ops/regression.md`「卡片詳情頁」節）。改 `renderRateCard`、上述共用片段、或詳情頁任何一條 render 路徑後必跑
- **不受影響**：停車折抵區塊維持原樣（不是回饋率）。（行動支付的兩個 modal 原本也用 `.cashback-detail-item`，2026-10-08 起改成搜尋結果卡片樣式，見 1i 節）

## 1i. 行動支付清單列（單一支付詳情／比較所有行動支付回饋，2026-11-16 改版）

- 兩個 modal 的每張卡都由 `renderPaymentRow(mc, showBest)`（`js/levels-payments.js`）產生＝**一張卡一列**：卡面縮圖（`renderCardThumb()`）｜卡名（下方灰色小字＝活動名，不帶「活動:」）｜右側回饋率大字＋「上限 NT$X」小字（無上限就只寫「無上限」）。列與列之間一條細線，沒有各自的框。**要改長相改這支，不要在兩個 modal 各自拼**
- **為什麼不再是搜尋結果卡的縮小版**（2026-10-08～11-16 是）：每個支付都有一張綠底卡＋「最優回饋」角標，一個畫面四塊綠；灰底支付框裡再包白底卡片框；「回饋率／回饋消費上限」標籤每張卡重複一次。加上卡面縮圖後站長裁定太亂，改清單列。**不要改回每張卡一個框**。`.card-result` 因此又只存在於搜尋結果區與領券區
- **「最優」只出現在單一支付詳情的第一列**（`.payment-row-best`，綠色小膠囊）。比較 modal 每個支付的第一列都是最優，標了等於沒標，所以不標——排第一列就是最優
- **回饋率是墨色**，不用綠色（同結果卡，`ui-refresh-diagnosis.md` 3.5）
- 單一支付詳情的清單是單欄（原本桌機兩欄 grid）：由上到下就是回饋高到低，兩欄會看不出順序
- **名次是斜體「NO.1」** `renderPaymentRank(rank)`（`.payment-rank`）：沒有底色，第 1 名墨色、其餘灰色，**每個支付都有**（原本只有前三名有獎牌，沒獎牌的支付名稱會往左凸）。沿革：彩帶＋金銀銅獎牌 SVG（2026-10-08）→ 圓形數字（2026-11-16，站長：獎牌有 AI 感、讓畫面亂）→ 現在這個（2026-11-17，站長：圓形數字不夠像名次）。**不要再用獎牌、獎盃、emoji 表示名次**。名次與支付名稱之間留 16px（站長要求拉開才好讀），`min-width` 讓各支付名稱的起點對齊。名次**並列不跳號（1、1、1、2、3）**：依序比最優卡回饋率 → 最優卡消費上限（無上限最高）→ 第二張卡回饋率，三者全同才並列，並列之後接下一個數字。2026-10-08～11-16 是跳號的競賽排名（1、1、1、4），站長 2026-11-17 裁定那是錯的，**不要改回跳號**

- 「比較所有行動支付回饋」只比用戶選的行動支付（`userSelectedPayments`），**訪客也一樣**（2026-10-14 修：以前訪客會比全部）

## 1j. 一般消費排除卡（灰色，2026-10-11 站長要求）

規則與比對見 `docs/project/cashback-engine.md` 第 10 節。目的：用戶自己也能判斷——看得到「匹配到哪個排除項目」才排除，又不用讀一堆數字。
- **搜尋結果**：`createExcludedCardResultElement()`（`js/results-display.js`）。只有卡名＋ⓘ詳情＋右上灰色徽章「一般消費排除」＋「排除項目: **命中的項目**」＋一行小字；**不出**回饋率／回饋金額／上限／活動期間／計算明細／釘選。墊在進行中結果最後（即將開始之前）。**有指定通路結果時也會出現**（沒活動、名單命中的比較卡）；1e 節清場只收基本回饋、不收灰卡。結果標題多一段「一般消費排除項目」（1f 節的 `titleParts`）
- **可能排除**（搜尋詞只是名單項目的一部分）：同一個灰卡產生器，多 `.maybe-excluded-card`；只有標籤換成「可能屬於排除項目: **完整項目**」，徽章「一般消費排除」與說明維持原字（站長要求）
- **詳情頁**：`renderBasicExclusionsCard()`（`js/card-detail.js`）2026-11-22 起放在獨立一區「一般回饋排除項目」（`#card-basic-exclusions-section`，接在一般回饋區後面，沒有名單整區不顯示；原本是一般回饋區最後一張，桌機兩欄由上往下排時總掉到右欄）。說明文字「刷以下項目沒有任何回饋（包含基本回饋）」（同日拿掉後半句「；有指定活動的項目以活動為準」）。標題「一般消費排除項目」，超過 10 項先收合（沿用 `toggleMerchants`）。刻意不走 `renderRateCard`（那支一律輸出回饋率／上限兩欄），但外框沿用 `.rate-card` 的標題列｜body 兩段，桌機兩欄同排對齊照常
- **灰色調**：`.excluded-card`／`.rate-card-excluded`（底色 `#f3f4f6`），項目用深灰粗體 `#374151`——不用一般匹配項目的藍色（藍色是「有得刷」的語氣）；不用 `opacity`（ⓘ 要維持可點）
- **詳情頁搜尋框**（外觀：淺藍底區塊＋「搜尋這張卡的所有回饋商家」標籤、提示字「輸入通路名稱（如：全聯、水費）」，跟上方近期異動的灰色清單分開；導覽列「指定通路回饋」靠 `data-anchor="cashback-search-bar"` 捲到搜尋框，`setupCardDetailNav` 的點擊與高亮都認 anchor）（2026-10-14 站長要求改版，`filterCashbackItems()`→`filterDetailCards()`）：搜尋框 `#cashback-search-bar` 放在**所有回饋區上方**（原本在「指定通路回饋」標題下，但它也搜得到下面的區，位置會誤導），一次過濾指定通路／即將開始／一般回饋／領券四區（`DETAIL_SEARCH_SECTIONS`）；國內／海外一般消費卡、排除灰卡跟活動卡一樣照字過濾。沒命中的區整區（含標題）收起（`section._searchHidden`，本來就沒顯示的區不動），四區都沒命中才出「找不到符合的通路或項目」；換卡時 `showCardDetail` 還原。命中卡片裡的通路／排除清單（`strong.merchant-list`）只留命中項目、沒命中的段落縮成「…」（`condenseMerchantList()`；括號裡的頓號不切，見 `splitMerchantList()`），清空搜尋還原。曾試過在搜尋框下方加提示句，站長看過後拿掉
- **小額支付提示**（2026-11-13，`displayMerchantPaymentInfo()`／`renderMicropaymentNote()`，`js/cashback-engine.js`）：搜到 NCCC 小額支付名單上的品牌時，搜尋結果上方「商家付款方式」灰框多一行提示文字＋「?」鈕；按「?」才展開說明（`MICROPAYMENT_HELP_HTML`，站長指定、寫死在程式）與資料來源連結（聯卡中心頁面，附「截至」日期，隨名單更新自動變）。2026-11-14 站長要求從整段攤開改成這樣，並拿掉標題。該品牌在 Merchant Payments 沒有列時，灰框只出這一段；有付款方式時用細線隔開。文字來源順序：該商家列的 `micropayment_note` → `_default` 列的通用提示（`cardsData.micropaymentDefaultNote`）；兩者都空就不出這一段（灰卡照常）。文字裡的 `{部分}` 在部分門市品牌顯示「部分」、其餘拿掉。跟付款方式一樣不理精準搜尋。排除這類交易的卡變灰卡的規則見 cashback-engine.md 第 10 節
- 測試：`tools/regression/basic-exclusions-test.js`

## 1k. 未達門檻的活動區 ＋ 結果分類導覽（2026-11-14 站長要求）

**為什麼**：金額未滿 `minSpend` 的活動以前直接不出現。預設金額是 1000，「momo 單筆滿 5,000」「國內飯店滿 20,000」這類活動多數搜尋都看不到；
只有這種活動的商家（瓦斯通、台灣電力公司…）還會被說成「你的選項中沒有符合的活動」。

**未達門檻區**（`#threshold-results-section`，`displayUnmetSpendResults()`，`js/results-display.js`）：
- 資料來自 `calculateUnmetSpendResults()`（計算端規則見 `docs/project/cashback-engine.md` 第 6 節）。**不進排名、不會是「最優回饋」**，
  它的卡片不是 `#results-container` 的**直接子元素**——回歸、排除測試、商家頁生成器一律用 `#results-container > .card-result` 讀主結果，寫新測試時照用，不要寫成後代選擇器
- 卡片跟一般結果同一支 `createCardResultElement()`，差別：「未達門檻」徽章、`✘ 單筆滿 NT$X 才適用・還差 NT$Y`
  （`renderUnmetThresholdNote`，不沿用 `.spend-threshold-note`——那是「✔ 已符合」）。（回饋金額下方原本有一行「以單筆 NT$X 試算」，2026-11-16 站長要求移除：區塊說明與計算明細都已經寫了，不要加回來。）
  **回饋金額用門檻金額算**（計算明細的 Total 也是門檻金額），不是用戶輸入的金額
- 排序：門檻低的在前，同門檻回饋高的在前。**級距每一級都列**（站長決定，不只列最近的一級）
- 位置：平常**嵌在 `#results-container` 裡**，主結果之後、排除卡與即將開始之前（`displayResults()` 畫完卡片後搬進去；清空容器前會先搬出來，節點用 `getThresholdSectionEl()` 留著）。**沒有任何進行中活動、結果區只剩一般回饋時搬到結果區前面**
  （`data-placed-first="1"`；`displayResults()` 的捲動目標跟著改）。領券／即將開始已清場（1e 節）時不搬
- 按鈕（ⓘ、計算明細、加到小抄）跟結果區掛同一支事件處理（`js/home-ui.js`，Grep `thresholdResultsContainer`）

**結果卡上的提示行**（`↑ 單筆滿 NT$199 可享 7%（活動名）・還差 NT$99`，`renderSpendUpgradeNotes`）：同一張卡已經有符合的活動、
而且門檻接得上（進行中那槽的 `maxSpend` === 未達那槽的 `minSpend`）時，不另開卡片，掛在那張結果卡上。認定規則在 `attachSpendUpgrades()`

**狀態列**（`js/search-match.js`）：
- 有其他結果時補一行灰字「另有 N 筆活動要單筆滿額才適用（點此查看 ↓）」（`appendUnmetSpendNote`）
- 只有未達門檻時，第二行紅字改成「✘ 單筆 NT$1,000 還沒有符合的活動，有 N 筆活動要單筆滿額才適用（點此查看 ↓）」
  （`showMatchedButNoActivityMessage` 的 `unmetCount`），不再說「試看看修改信用卡選項」

**結果分類導覽**（`#results-nav`，`updateResultsNav()`／`scrollToResultsGroup()`）：
- 這次搜尋有**兩類以上**結果時，結果上方出一排標籤（含筆數）：指定通路回饋或一般回饋／一般消費排除／即將開始／未達門檻／領券型活動／停車折抵／新戶活動。
  點了捲到那一類並短暫標亮；標籤列 `position: sticky`，捲到哪都能跳去別類
- **只讀畫面上真的有的東西**（各 section 的顯示狀態＋結果卡的 `data-group`），不另外記狀態——各區塊顯示／隱藏規則改了，這裡不用跟著改
- 導覽列在時，各區塊加 `scroll-margin-top`（`.has-results-nav …`）讓出它的高度
- **結果分區**（同日站長決定）：順序固定為 主結果 → 未達門檻 → 一般消費排除項目 → 即將開始的活動 → 領券 → 停車 → 新戶。
  排除卡與即將開始仍在 `#results-container` 裡，各在第一張卡前插一列橫跨整排的小標題（`createResultsGroupHeading()`，`.results-group-heading`）；導覽標籤捲到小標題
- 同一個點擊會冒泡經過未達門檻容器與 `#results-container` 兩個監聽器，用 `e._pmcResultClickHandled` 只處理一次（不然「加到小抄」會加了又移除）
- ⚠️ 凍結資料下 13 組回歸不擷取這一區與小標題，**回歸測不到**（小標題與主標題由 `basic-exclusions-test.js` 測到一部分）；驗證靠線上資料實測：
  「水費」1000（三類並存）、「瓦斯通」1000（只有未達門檻）、「統一超商」100（提示行）、「MOMO購物網」1000（同卡多個門檻）

## 1l. 全幅版面與結果卡層級（2026-11-16，「AI 感」改善第一批）

成因、對照站觀察、分批清單與還沒做的項目都在 `docs/project/ui-refresh-diagnosis.md`，這裡只記會踩到的規則：

- **`.container` 不再有 max-width、圓角、陰影，`body` 不再有灰漸層與外圈留白**。內容寬度上限改由 `--page-w` 管（1200／1360／1560，第 1b 節那張表的 `.container` 欄現在指的是這個變數）
- **新戶活動頁（`promos.css`）2026-11-22 比照**：它不吃 `styles.css`，另有一組同義變數 `--pmc-page-w`／`--pmc-page-gutter`（值同主站 1200／1360／1560，頁首 logo 在兩頁之間切換位置不跳）。`.promos-main`、`.social-media-footer`、`.promos-faq` 讀 `--pmc-page-w` 置中；`.promos-header` 左右 padding 帶 gutter（≥1025px 是 17px，同主站密度區塊）。頁尾按鈕實心白底灰框、警語橫條直角、申辦前 FAQ 面板實心白底灰框。**改主站版面寬度時這裡要手動同步**；landing 是另一套行銷頁設計（淡藍光暈底、沒有浮起的白卡），不在這個範圍
- **新增直接掛在 `.container` 底下的區塊時要自己決定寬度**：內容型 → `max-width: var(--page-w); margin: 0 auto`；底色要滿版 → 左右 padding 加 `var(--page-gutter)`（照 `header`、`.mc-related` 的寫法）。漏了就會從視窗最左邊排到最右邊
- **頁首與「推薦比較」的左右 padding 在檔尾密度區塊有另一份值**，兩邊都帶 `var(--page-gutter)`，改一邊要改另一邊
- **桌機頁籤不撐滿**（`.home-view-switch` 在 ≥769px 是 `max-content max-content` 靠左）；手機照舊各佔一半
- **快捷選項圖示**：Sheets 的 icon 欄照舊填 emoji，前端 `renderQuickOptionIcon()`（`js/data-loader.js`）對到線條圖示；對照表沒有的 emoji 原樣顯示。Sheets 新增了新的 emoji → 在 `QUICK_ICON_PATHS` 補一列
- **結果卡縮圖** `renderCardThumb()`（`js/results-display.js`）放在 `.card-name` 裡面最前面，`alt=""`，所以 `.card-name` 的 textContent 不變（回歸基準不受影響）
- **最優卡角標**：兩欄以上是「最優回饋」、卡名右側留 64px；單欄（≤640px）用 CSS 改顯示「BEST」（DOM 文字不變）、留在原位。改 `.results-container` 的欄寬下限（現在 300px）時，這個 640px 斷點要跟著算
- **公告列在頁首外面**（2026-11-16 第二批，站長選的方案）：`#announcement-bar` 是 `.container` 的直系子節點、緊接 `</header>`，灰底單行，寬度自己管（左右各 20px、手機 16px）。兩個頁籤畫面都顯示；embed 模式靠 `html.pmc-embed .announcement-bar` 隱藏。手機單行截斷、不顯示圓點（`buildAnnouncementDots()` 與圓點樣式留著沒刪）。日期仍必須是文字的兄弟元素
- **手機結果卡三欄比例**（≤768px，2026-11-16 站長回報金額欄太靠左）：`.card-details` 是 `0.8fr 1.2fr 1fr`，<360px 才用舊的 `0.65fr 1.35fr 1fr`。改比例前量 360～768 幾種寬度，回饋率、金額＋計算機鈕、上限都要各在一行。已知代價：富邦 J 卡金額下方的小字「(現金回饋或LINE POINTS)」在 375～390px 變兩行
- **首次引導**（2026-11-16）：分流 B 組第一次來時的四步導覽（背景暗化＋打亮目標），沒有靜態標記，整組由 `js/home-ui.js`「首次引導」建立；要不要跑由 `index.html` 首屏路由 script 加的 `html.pmc-onboard` 決定。打亮的目標是 `.merchant-search-box`、`#calculate-btn`、`#results-container > .card-result`、`#supported-cards`／`#sidebar-toggle-btn`——**改這些元素的 id／class 或搬位置時要一起看導覽**。來龍去脈、被否決的第一版與「測試期間不能改」的規定見 `ui-refresh-diagnosis.md` 5.4、5.6 節
- **信任列** `#trust-line` 在 `.input-section` 最下面，`renderTrustLine()`（`js/data-loader.js`）填字，資料沒載到就維持 `hidden`
- **站長看預覽後的幾項裁定**（最優卡淺綠底保留、回饋率不另外上色、頁尾 🎁 保留等）記在 `ui-refresh-diagnosis.md` 3.5 節，改結果卡前先看

## 1m. 詳情頁全頁改版——外殼（2026-11-17，三輪改版的第一輪）

動機：CUBE 卡手機 8,790px（13 個畫面）、浮窗只佔 80% 高，第一個回饋數字在第三個畫面；手機返回鍵關不掉浮窗。第二輪＝回饋卡內部（計算條件標籤列等）、第三輪＝個人設定與新戶活動內部。本輪只做外殼，那些內容沒動。

**結構**（`index.html`「Card Detail Modal」註解有全圖；命名一律 `cd-` 前綴）：`#card-detail-modal` 全頁（100dvh、底色 #f3f4f6、無遮罩）→ 捲動容器 `#card-detail-scroll`（`.card-detail-content`）→ `.cd-top` 藍色頁首（sticky，返回箭頭 `#close-card-detail`、卡名、桌機申辦鈕）／`.cd-tabsbar` 頁籤列（sticky）／`.cd-layout` ┬ `.cd-side`（摘要 `.cd-sum`＋個人設定 `#card-personal-section`）└ `.cd-main`（三個窗格 `.cd-pan`：`#cd-pan-rates`、`#cd-pan-coupon`、`#cd-pan-promo`）；浮動膠囊 `#card-detail-apply-bar`（`.cd-fab`）在捲動容器外、modal 內。
- **同一份 DOM 兩種排法**：手機 `.cd-layout/.cd-side/.cd-main` 是 `display:contents`，摘要、頁籤列、窗格變成捲動容器的直接子項，靠 `order` 排（sticky 的作用範圍才是整頁）；≥1025px 是 grid（左欄 316px sticky＝摘要卡＋個人設定，右欄＝頁籤＋內容），**不在 JS 搬節點**。桌機不顯示「個人設定」頁籤（它常駐左欄；`.cd-pan-set[hidden]` 在桌機不生效）；769–1024px 用手機的單欄＋四頁籤
- **頁籤**（`setupCardDetailNav`／`refreshCardDetailTabs`／`selectCardDetailTab`，`js/results-display.js`）：回饋（指定通路＋即將開始＋一般回饋）／領券・停車／新戶活動／個人設定；帶筆數（個人設定不帶；「回饋」是回饋率列數，見 1n）；底下沒內容就不顯示（依各區 computed display＋textContent 判斷，**不依賴尺寸**——沒選中的窗格是 display:none，量到的尺寸是 0）。條件列「展開」鈕要等窗格顯示後才量得到，`selectCardDetailTab` 會對剛顯示的窗格重跑 `initConditionClamps`
- **「落在某區塊」一律走 `cardDetailGoToSection(sectionId)`**（找出包含該區塊的頁籤、切過去、扣掉 sticky 高度捲到位；`card-changelog-section` 會同時展開異動清單）。呼叫端：側欄「最近異動」（`openCardDetailAtChangelog`）、embed 的 `pmc-open-card` 的 `section`（`js/home-ui.js`）。舊的「用 section id 去點導覽鈕」已不存在
- **摘要三格**：最高回饋＝`#card-special-cashback` 內最大的 `.cd-rate`（2026-11-17 起另含搬到一般回饋區的特列項目列）、一般消費＝`#card-basic-cashback` 內 `data-role="basic"` 那一列的 `.cd-rate`（原為 `.rate-card-rate`，見 1n），都是**讀畫面上已畫好的回饋卡**（`updateCardDetailFacts()`，與回饋卡用同一份 `getDisplayRate` 結果，不另寫算法；CUBE 切級別後 `updateCubeSpecialCashback` 會重算）。年費（2026-11-19 改短版）＝`summarizeAnnualFee()` 把 `annualFee` 整理成大字＋一行小字：開頭「首年免年費」→「首年免」＋「次年 NT$X」（取第一個金額）；`(正卡)(年費)NT$X` →「NT$X」＋「每年」（金額大字縮成 17px、<360px 再縮成 15px，否則放不下）；整理不了 → 加 `.is-raw` 顯示原文小字三行，絕不猜。完整原文在 `title`。Sheets 的年費欄**不用改寫法**；新寫法整理不了只會退回原文。免年費條件與「我已過免年費門檻」勾選搬到個人設定最下面（id、儲存邏輯不動）
- **申辦**（`setupCardDetailApply`／`refreshCardDetailApply`，`js/card-detail.js`）：手機（≤768px）白底膠囊（亮黃禮物圖示＋文字＋「立即申辦」），捲過 150px 縮成右下角；桌機頁首亮黃鈕。文字＝第一筆新戶活動（`{promo_types[0]} NT$金額`／`{promo_types[0]} 回饋率`／`{promo_types[0]}`），沒有新戶活動用 `applyCta.text`。**持卡人（`myOwnedCards` 含這張卡）兩者都不顯示**——預設先顯示，`loadMyOwnedCards` 完成後（`js/auth-user-data.js` 兩處呼叫端）與「我的信用卡」增刪卡後（`pmc:mappings-data-changed`）重新判斷；沒有 `applyCta.link` 的卡每次 `showCardDetail` 都明確重設為隱藏。GA4 `button_type` 沿用 `detail_header_apply`／`detail_sticky_apply`，選擇器改成 `.cd-apply-header-btn`／`.cd-fab-btn`
- **返回鍵**：開啟時 `pushState`（網址不變）、`popstate` 關閉、按返回箭頭關閉時若這次 push 過就 `history.back()`（`_cdPushed`／`_cdExpectPop`，寫法照 `js/mappings-page.js`）。**embed 模式不 push**。關閉的兩條路徑共用 `showCardDetail` 內的 `closeModal`（embed 的 `pmc-detail-closed` 掛在那裡）。疊在選卡 modal／配卡組合頁上開啟時，網址沒變，返回只關詳情頁。`popstate` 監聽掛在 `DOMContentLoaded` 裡，因為 `tools/lib/merchant-cards.js` 的 vm 沙箱 `window` 沒有 `addEventListener`
- **近期異動**：「回饋」頁籤最上面一行通知（最新一筆日期＋文字＋「共 N 則」），點了展開完整清單；仍用 `textContent`。顯示用 `style.display = ''`（不是 `'block'`），桌機 CSS 對它設了 `display:contents`
- **搜尋**：`filterCashbackItems` 仍過濾四區；「回饋」頁籤（指定通路／即將開始／一般）沒命中、領券區有命中時，顯示 `#cashback-search-hint` 一行可點的提示切到「領券・停車」。注意 `filterDetailCards` 會自動展開被截斷的通路清單，所以「Expedia」這種字可能同時命中回饋頁籤（CUBE 秋日遊的完整通路清單裡有它），不會出提示
- **重繪同一張卡**（非 CUBE 切級別會重呼叫 `showCardDetail`）：`keepView` 保留目前頁籤與捲動位置；開新卡／換卡回到「回饋」頁籤最上面
- 回歸測試：`card-detail-test.js` 取樣前把所有窗格攤開（`innerText` 對不在版面上的元素退回 `textContent`，沒有換行）；比對時濾掉 `Failed to load resource` 類 console error（時序噪音，docs/ops/regression.md 2026-11-16 教訓的根治）。`mappings-page-test.js` 的 Firebase 替身補了 `setUserProperties`（#561 起 index.html 會 import 它，缺了整支 firebase 模組載入失敗）

## 1n. 詳情頁回饋卡「同方案一張卡」（2026-11-17，三輪改版的第二輪）

> ⚠️ 2026-11-22：下面提到的「計算機鈕（`rateCompositionButtonHtml`）」已改成「回饋率數字本身可點」（`rateCompositionData`＋`renderPlanRow` 畫成按鈕），見 1q。

動機：CUBE 指定通路回饋 19 張卡、平均 247px，同一個方案（秋日遊 5 張、慶生月 3 張…）被拆散、每張重寫一次上限與期間。站長逐項核定設計（示意圖 `detail-proposal/preview.html` 第七版），照做。

**併卡規則**（`planCardsHtml(entries, opts)`，`js/card-detail.js`）：各條 render 路徑只把每個回饋組整理成一筆 entry（＝卡裡的一列），**標題、回饋消費上限、活動期間三者都相同才併成同一張**（鍵再加徽章用的開始／結束日、`extraClass`、`tagText`）；三者任一不同就各自一張，絕不能把一筆的上限或期間寫成別人的。實例：台新 Richart「Pay著刷」三筆同標題同上限、期間不同 → 三張；玉山 Pi「滿額登錄加碼」上限 NT$150,000／無上限 → 兩張；玉山 Ubear「網購 - …」標題各不同 → 各自一張。
- **排序**：卡片依「卡內最高顯示回饋率」由高到低、同分維持原順序；卡內各列由高到低（`Array.sort` 穩定）。`opts.sort=false` 只排卡內列（一般回饋區用，固定順序：國內一般消費、海外一般消費、國內加碼、海外加碼）
- **領券區**每筆仍一張卡（`planCardsHtml([entry])`），標題＝商家名（只有一個商家時）＋灰小標「需領券」；一般消費排除卡（`renderBasicExclusionsCard`）不走這裡，維持灰色獨立一張（1j）
- **CUBE**：列內合併（同回饋率＋類別＋期間＋**上限**的槽串成一列，鍵多了上限）照舊；`generateCubeSpecialContent` 現在回傳 `{ html, general }`
- **一般回饋特列項目搬到「一般回饋」區**：`CD_GENERAL_LIST`（`一般回饋特列項目`／`一般消費特列項目`→國內一般消費；`國外消費特列項目`→海外一般消費）。這些組別的回饋率就是一般回饋（rate=0＋基本回饋＋加碼），以前混在指定通路區。上限無上限且沒有期間 → 併進「國內／海外一般消費」那張卡（右欄上方標原類別名 `.cd-sub`）；上限或期間不同 → 在一般回饋區自己一張。分流在 `splitGeneralListEntries`（指定通路各路徑共用 `composeSpecialArea`），一般回饋區由 `renderBasicArea(card, extra)` 重畫（CUBE 切級別時也要重畫它，因為特列項目的回饋率隨級別）。**摘要「最高回饋」仍把這些列算進去**（`data-sl`）、「一般消費」讀 `data-role="basic"` 那一列
- 指定通路區沒有任何進行中的列 → 顯示「無指定通路回饋」說明（以前只有「無 cashbackRates」的卡有）

**卡片長相**（字級顏色照搜尋結果卡）：標題「切換「X」方案」→「X」＋灰小標「需切換方案」（只轉這個固定句型，`/^切換「([^」]+)」方案$/`，「切換「慶生月」方案 - 美食」這種帶尾巴的原樣）；即將開始／即將結束徽章（與搜尋結果共用 `renderUpcomingBadge`／`renderEndingSoonBadge`）放標題旁，縮成黃色小標；標題下兩格 `.cd-meta`「回饋消費上限｜活動期間」（沒期間不顯示那格）；CUBE「※ 慶生月…」註記搬到慶生月那張卡標題下一行灰字（`noteFor` 回呼；不斜體；生日月那句粉紅）；每列 `.cd-rr`：左欄回饋率 24px/800 #111827＋計算機鈕（沿用 `rateCompositionButtonHtml`／`toggleRateComposition`，面板掛在該列下方）＋「(分級: Level 3)」，右欄「適用通路: 」藍色粗體通路／條件／銀行官方登錄連結。**「(分級: …)」只標回饋率由級別決定的列**（`rate` 寫 `{specialRate}`／`{rate}` 的槽，`cdRateUsesLevel`）——搜尋結果對 hasLevels 卡一律標，詳情頁照示意圖只標會隨級別變的列，固定數字的列標了反而誤導。條件文字照舊**原樣輸出不 escape**（與 1h 同，沿用既有行為）
- **「顯示全部N個」「展開／收起」「變更 ›」＝同一種 `.cd-pill`**：白底 #d1d5db 框、#374151 字、11px/600、帶向下箭頭（展開後轉 180°），和藍色粗體通路名分得開

**適用通路最多三行、條件一行省略——先畫完整內容、量得到寬度才收**（`cdFitChannel`／`cdFitCond`／`cdFitAll`，`setupCardDetailFit`）：
- ⚠️ 詳情頁打開前是 `display:none`、沒選中的頁籤也是 `display:none`，那時 `clientWidth` 是 0。量不到就**保留完整內容**（CSS `.cd-ch{max-height:54px;overflow:hidden}` 先夾住三行，不會畫成空白），不可以先收再說。收的時機：①`showCardDetail` 在 modal 顯示、`setupCardDetailNav` 之後呼叫 `cdFitAllContainers()`；②`selectCardDetailTab` 對剛顯示的窗格呼叫 `cdFitAll`；③`ResizeObserver` 盯四個回饋容器的**寬度**（寬度沒變就不動，免得自己改高度又觸發自己；收的動作丟 `requestAnimationFrame`，在 observer 回呼裡直接改版面會吐 "ResizeObserver loop" 錯誤）；④`document.fonts` 的 `loadingdone`／`ready`；⑤清空搜尋後（見教訓 11-17）
- 算法：全部放得下就不長鈕；否則二分搜尋最多能列幾個通路名（含「… 顯示全部N個」鈕算在三行內），至少留一個。通路完整清單記在元素的 JS 屬性 `_cdFull`（`strong._fullText` 是搜尋 `condenseMerchantList` 暫存的原文，優先取它），不放 data-* 屬性
- 「顯示全部」走委派點擊 `cdToggleChannel`（行為同 `toggleMerchants`：展開成全文、鈕變「收起」，收起時重收），不再用 inline `onclick`；`toggleMerchants` 只剩排除卡用。條件「展開」只在真的被截斷時才長出來

**計算條件列**（`#card-calc-cond`，index.html 在「指定通路回饋」`h4` 下；`updateCardCalcConditions(card)`）：分級卡才有；灰字「計算條件」＋各值灰底小標籤（級別；CUBE 另有發卡組織。「童樂匯」2026-11-20 起不顯示在這裡，站長決定）＋「變更 ›」小膠囊。值**讀個人設定欄位的目前值**（`#card-level-select`／`#cube-issuer-select`），不另存一份；`showCardDetail` 結尾、`updateCubeSpecialCashback`、發卡組織與童樂匯的 `onchange` 都會重呼叫，所以設定一改標籤即時更新。「變更」→ 手機 `selectCardDetailTab('set')`，桌機（個人設定常駐左欄）捲到左欄並聚焦級別下拉。搜尋中隱藏（`filterCashbackItems`）。⚠️ 不得為了這條新增 `saveCardLevel` 呼叫（鐵則 1）——這裡只讀不寫

**搜尋**（`filterDetailCards`）：同方案卡以「列」為單位——命中的列留、沒命中的列藏，卡內全部列都沒命中整張藏；標題列（標題／註記／上限／期間）本身命中就整張的列都留（搜「慶生月」看得到整個方案）；清空全部恢復。其他卡（排除卡、領券、停車、說明）整張比對。自動展開被截斷的通路（`syncMerchantListsForSearch` 也認 `.cd-more`）、命中字高亮、只在領券區命中的提示（`#cashback-search-hint`）都照舊

**版面容器**：`#card-*-cashback` 手機 flex 直排、≥769px 兩欄 CSS columns（由上而下再換欄，最高回饋的卡在左欄最上面；`break-inside: avoid`）。舊的 2 欄 grid＋subgrid（1h「同排對齊」）已移除——卡片高度由內容決定，不需要同排對齊。541–768px 維持單欄（兩欄會讓右欄只剩約 110px 放通路）

**摘要與頁籤筆數**：`updateCardDetailFacts` 讀 `.cd-rate`（見 1m）；**「回饋」頁籤筆數＝三區的「回饋率列數」（`.cd-rr`），不是卡片數**。CUBE（活動資料 2026-11-17、Level 3）：指定通路 18 列（10 張卡）＋一般回饋 2 列（國內一般消費 0.3%＋特列項目 0.3%）＝20；排除卡沒有回饋率列、不計。領券頁籤仍是卡片數（每筆一張）

**自動化回歸**（`card-detail-test.js`，見 docs/ops/regression.md）：同方案卡不抓逐行 innerText（收成幾個通路、有沒有「顯示全部」鈕取決於字型寬度），改抓語意欄位（標題、小標與徽章、上限、期間、註記、每列的回饋率／分級／子標／門檻／通路完整清單與總數／條件／登錄連結）；另跑 390px 的**版面不變式**（通路 ≤ 三行且非空、同區無「標題＋上限＋期間」相同的兩張卡、卡與列由高到低、回饋率 24px/#111827）與造資料驗併卡規則。

## 1o. 詳情頁個人設定與新戶活動票券（2026-11-17，三輪改版的第三輪）

> ⚠️ 2026-11-22：下面「常駐儲存狀態列」的**外觀**（整條彩色底、`.cd-sv-dot`、「只存在這台裝置。登入後會同步到帳號」等整句）已改成「個人設定」標題列右側一行小字，「我的紀錄」小標與副標拿掉、底部說明改新文字；狀態邏輯（`cdTrackSave`、save 回傳值、`volatile`、依欄位記帳）沒變。見 1q。

動機：站長說個人設定「排版有點亂，看起來資料像是會不見一樣，沒有填寫後會被存好的感覺」；新戶活動要「更有獎勵感，資料要更完整」。示意圖 `detail-proposal/preview.html`（`#p2` 個人設定、`#p3`／`#gal`／`#multi` 票券），站長逐項核定，照做。

### 個人設定：統一自動儲存＋常駐儲存狀態列＋兩組一欄一列

**結構**（`index.html` 的 `#card-personal-section` 註解有全圖；命名 `cd-` 前綴）：`h4.cd-set-h`「個人設定」（只在桌機左欄顯示，手機本身就是頁籤）→ 儲存狀態列 `#cd-save-status` → `#cube-level-section`（分級卡才有的「計算條件」組，`showCardDetail()` 注入）→「我的紀錄」組（靜態標記）→ 灰字「所有卡片的設定可以在「我的信用卡」一次看。」。每組＝`.cd-set-sec`（標題＋灰字副標）＋`.cd-set-box`（白底灰框盒子，內含多列 `.cd-st-r`）。一列＝標籤左 `.cd-st-l`／控制項右 `.cd-st-c`／說明小字 `.cd-st-s`（下一行、跨兩欄，空的不佔位）。下拉 `.cd-st-sel` 與輸入 `.cd-st-inp` 同高 36px、寬 132px、靠右、同框色；筆記是整列寬的 `textarea.cd-st-ta`。列由 `cdSettingRowHtml(labelHtml, controlHtml, subText)` 組（`js/card-detail.js`）。
- **兩組**：「計算條件」（2026-11-23 起不顯示小標，只有一行灰字說明「搜尋結果將依照以下條件顯示」）＝選擇級別（標籤後面跟「i」說明窗按鈕）、發卡組織、我的生日月份、我符合「童樂匯」權益（後三項只有 CUBE）；「我的紀錄」（副標：只有你看得到）＝我的額度、我已過免年費門檻（說明小字＝`feeWaiver` 原文，`#card-fee-waiver`）、我的筆記。非分級卡只有「我的紀錄」
- **開關**：勾選一律是 `input type="checkbox" role="switch" class="cd-sw"`（`appearance:none` 畫外觀；id 不變、Tab 可聚焦、空白鍵切換、`:focus-visible` 有 2px 外框）。舊的 `.fee-waiver-checkbox`／`.checkmark` 已刪
- **訪客的生日月份**仍是 disabled 下拉（只有「需先登入」一個選項）——一眼看出「這裡可以選，但要先登入」。文字別寫長：16px 下 132px 放不下「登入後即可設定」（會被截成「登入後即可設」）

**常駐儲存狀態列**（`cdSaveStatusRender`／`cdTrackSave`／`cdSaveStatusReset`，`js/card-detail.js`「個人設定：統一自動儲存」區塊）：一直都在，`data-state` 四態——已登入＝綠「已儲存到你的帳號」；訪客＝黃「只存在這台裝置。登入後會同步到帳號」＋「登入」連結（`openAuthModal('login')`；`#auth-modal` z-index 提到 1200，否則被 1100 的詳情頁蓋住）；任何一欄儲存中＝灰「儲存中…」；失敗＝紅「儲存失敗（欄位）：原因。已先存在這台裝置，請稍後再試。」（沒有本機備援的欄位改寫「請重試。」）。成功後回綠／黃並接上「・今天 HH:MM」。
- ⚠️ **狀態只反映真正的儲存結果，沒有假成功**：各欄既有的 save 函數都改成**回傳結果物件**（`{ok:true}`／`{ok:true, volatile:true}`／`{ok:false, reason, local}`；`describeSaveError()` 把 Firestore 錯誤碼翻成人話，在 `js/levels-payments.js`）——`saveCardLevel`／`saveCubeIssuer`／`saveBirthdayMonth`／`saveChildrenEligible`／`saveFeeWaiverStatus`／`saveCreditLimit`／`saveUserNotes`。寫入邏輯（key、文件路徑、格式）一律沒動，只是把原本吞掉的結果回傳出來；舊呼叫端不看回傳值照常運作。UI 端 `cdTrackSave(key, promise)` 立刻切「儲存中…」，等 promise 結案才記帳
- 唯一的計時器是「儲存中…」至少顯示 `CD_SAVE_MIN_BUSY_MS`（350ms）：訪客的本機儲存不到 1ms 就完成，不留一下的話永遠看不到那一格；結果仍是真正結案後才顯示
- **錯誤依「欄位」記帳**（`_cdSv.errors[key]`）：A 欄失敗後 B 欄成功，紅字不會被洗掉；同一欄之後存成功才清掉。多欄失敗顯示最近一個並註明「另有 N 項也沒存成功」。換卡清掉記帳、同一張卡重繪（級別切換）保留
- **`volatile`**：訪客且該欄沒有本機備份時回傳，狀態列照實寫「這項設定只在這次瀏覽有效，登入後才會保存」。目前只剩生日月份（訪客不能設，實際不會出現）。「童樂匯」2026-11-20 起訪客存在本機 `childrenEligible_guest`（見 storage-and-security.md 第 4、5 節），回一般的 `{ ok: true }`
- **auth 變化**：`refreshCardDetailApply()`（`js/auth-user-data.js` 的 onAuthStateChanged 兩個分支本來就會呼叫）尾端順手呼叫 `cdSaveStatusRender()`，狀態列跟著切登入／訪客，不必動 auth-user-data.js

**全部自動儲存**：級別／發卡組織／生日月份／童樂匯／免年費＝onchange；額度＝失焦或 Enter；筆記＝停止輸入約 1 秒（`CD_NOTES_DEBOUNCE_MS`），並在離開輸入框、關閉詳情頁（`closeModal`）、換卡（`showCardDetail` 開頭）、分頁轉背景（`visibilitychange`）時立刻存一次（`cdQueueNotesSave`／`cdFlushNotes`；待存內容含卡片 id 記在 `_cdNotesPending`，不從輸入框現讀——換卡時輸入框已是另一張卡）。每次輸入照舊先 `autoBackupNotes` 寫本機（所以雲端失敗時「已先存在這台裝置」是真的）。💾 儲存鈕、`#save-indicator`、`#credit-limit-saved` 已拿掉
- 🔒 鐵則 1：`saveCardLevel` 的呼叫點**沒有增加**——仍只有級別下拉的 `onchange`（那一行只是改成先拿回傳 promise 再交給 `cdTrackSave`）。「存的級別找不到」時 `resolveCardLevel` 只顯示預設、不寫回（`card-settings-promo-test.js` 有驗：本機與雲端都沒被改）

### 新戶活動：每筆活動一張「票券」

`renderCardDetailPromos`（`js/results-display.js`）收集要畫的活動（沿用舊規則：沒有首刷禮／定額回饋／回饋率任何一項的整筆略過）後交給 `renderCardDetailPromoTickets(card, items)`（`js/card-detail.js` 檔尾「新戶活動票券」區塊）。**搜尋結果的活動卡（`createCardholderPromoElement`）輸出完全不變**——只抽了兩個共用小函數 `getPromoTimeBadge(promo)`（`{kind:'upcoming'|'ending'|'', days}`）與 `formatPromoPeriod(promo)`，新舊 HTML 逐字比對過 7 個日期 × 55 筆 × 2 模式（run-regression.js **不涵蓋**活動卡，要改它時自己比，見教訓）。
- **票券**（`.cd-tk`）：左邊亮黃票根 `#ffd84a`（78px，第一個活動類型的線條圖示＋文字：首刷禮＝禮物、定額回饋＝錢幣、回饋加碼＝百分比，`promoTypeClass` 把贈品／定額抵用歸到同類；不認得的類型用禮物），中間虛線、上下兩個半圓缺口（用頁面底色 #f3f4f6 的圓＋`overflow:hidden` 切成半圓）；右邊白底**資料有什麼畫什麼**：`gift_content`（一項＝「首刷禮」小標＋17px 粗體品名；多項＝「首刷禮 N 選 1」＋編號清單，`cdParseGiftItems` 去掉 ①②③）、`voucher_amount`（「定額回饋」＋大字 NT$ 千分位＋`voucher_usage` 小字）、`bonus_rate`（兩格「回饋率」大字＋「回饋消費上限」，`bonus_cap` 取整千分位；有 `voucher_usage` 但沒有定額金額時，單位跟在回饋率旁——例：永豐大戶「6% LINE POINTS」）、`bonus_merchants`（重用同方案回饋卡的 `renderCdChannels`／`cdFitChannel` 三行收合；`*general`＝「一般消費」、`*all_items`＝「本卡所有指定通路」）、`new_customer_summary`（13px）、`gift_image_url`（`sanitizeUrl`、最大高 140px、lazy、onerror 隱藏，另掛 `.promo-gift-image` 讓 `setupGiftImageLightbox` 點擊放大）。
- **右上小標**（`.cd-pt-chips`）：快結束「剩 N 天」（14 天內、當天「今天截止」）、未開始「N 天後開始」（當天「今天開始」）；第二個以後的活動類型只有「右邊沒有對應數值」時才顯示成小標（「首刷禮＋定額回饋」右邊已有金額就不再標）
- **票券下方**：只有一筆 → 直接攤開「達成條件」（`cdParsePromoSteps`）與「活動說明」盒子（新戶資格、活動期間、備註）；多筆 → 每張票券下一顆「達成條件與備註 ⌄」灰框膠囊（`.cd-pm-t`，委派點擊 `cdTogglePromoDetail`），點開展開該筆；新戶資格若**每一筆都有且完全相同**就在最下面寫一次（`#card-promos-foot`），否則放進各筆展開內容。欄位空白（空字串、null、空陣列）整列不顯示；「謹慎理財、信用至上」（`#card-promo-disclaimer`，顯示規則不變）移到活動區最下面、改灰色小字
- **達成條件照換行拆**：`①②③`／「1.」「1、」「(1)」開頭＝一步（去符號、黃色圓圈數字）；**沒有符號的行若前面已有步驟，併進上一步當附註**（`-消費條件A`、`→`、`↓ 以下與…一樣 ↓`、`持有凱基銀行帳戶` 這類子條件，不另編號，否則會被編成獨立的一步）；整段只有一行且不是步驟＝一段文字（例：「此活動不限新戶」）。備註 `notes` 照全形「；」與半形「;」拆條列
- **頁籤筆數＝活動筆數**：`cdTabCount('promo')` 數 `#card-promos-content > *:not(.card-apply-cta)`，所以每筆活動（含單筆時下面的說明）都包在同一個 `.cd-pm` 裡，共用的新戶資格放在 `#card-promos-foot`（content 之外）。桌機右欄多筆排兩欄（`.cd-promos-multi`），單筆限寬 640px
- 圖片網址在測試環境（無外網）載不到，onerror 會隱藏；截圖時用 Playwright route 換成本地圖檔（`scratchpad/gift/`）

### 驗證
`node tools/regression/card-settings-promo-test.js`（28 項）：訪客／已登入（Firestore 替身可讓下一次 setDoc 失敗）的狀態列各態、無假成功、筆記 1 秒自動存與關閉即存、鐵則 1、auth 切換，以及對**所有**有新戶活動的卡逐欄比對詳情頁文字（summary、每一步條件、每條備註、新戶資格、期間、金額／回饋率／上限／贈品／通路／圖片）。`card-detail-test.js`（回饋卡）與 `mappings-page-test.js`（額度合計）沒變。

## 1q. 回饋率本身可點＋個人設定儲存狀態搬到標題列＋桌機側欄（2026-11-22，站長從選項頁選定）

四項小改版，一次做完。

**1. 計算機鈕 → 回饋率本身可以點**（搜尋結果卡與詳情頁一致）
- 拿掉所有計算機圖示鈕（`CALC_BREAKDOWN_ICON_SVG`、`rateCompositionButtonHtml` 已刪）。回饋率數字改成 `<button class="… calc-breakdown-btn">`：灰色虛線底線（`text-decoration: underline dashed #9ca3af`、1.5px、offset 5px），hover 變深 #374151，展開（`aria-expanded="true"`／`.active`）變實線墨色 #111827。樣式在 `styles.css` 的 `.calc-breakdown-btn`（原本綠底小方塊那條規則整個改寫）
- **class 名稱 `calc-breakdown-btn` 刻意保留**：`js/home-ui.js` 的結果區／領券區委派點擊（`closest('.calc-breakdown-btn')`）、`showCalcBreakdown` 的 click-outside 與 `card-detail-test.js` 的 `calc` 欄都用它，保留就不必動那幾處。新按鈕同時帶 `.rate-num`（搜尋結果）或 `.cd-rate`（詳情頁）
- ⚠️ **字級／字重／顏色一律繼承**：搜尋結果由 `.rate-value`（28px／手機 24px、800、#111827）決定，詳情頁由 `.cd-rate`（24px／800／#111827）決定。`.calc-breakdown-btn` 只寫 `font-size: inherit` 等逐項繼承，**不要用 `font: inherit` 簡寫**，也不要寫死數字——選項頁示意圖的「10% 變小」就是 `.mk button{font:inherit}` 蓋掉 `.rate` 造成的特異性錯誤，不是設計
- 詳情頁：`rateCompositionData()`（`js/cashback-engine.js`）回傳已 escape 的 `data-comp` JSON，成分不到兩層回 `''`；entry 欄位從 `rateBtnHtml` 改名 `rateComp`；`renderPlanRow`（`js/card-detail.js`）有 `rateComp` 才畫成按鈕、否則仍是 `<span class="cd-rate">`（沒有組成的列——例如 CUBE 秋日遊各列——沒有虛線、不可點）。`toggleRateComposition` 行為與面板內容不變
- 搜尋結果：`calcRateHtml(rateText, hasLayers)`（`js/results-display.js`，緊接在 `showCalcBreakdown` 前）；有 `calculationLayers` 才是按鈕，點了展開同一個試算抽屜（`showCalcBreakdown`）。一般結果卡與領券卡（`createCouponResultElement`）兩處；「回饋金額」旁不再有按鈕。行動支付清單列（1i）本來就沒有計算機鈕
- 無障礙：`aria-expanded`（`showCalcBreakdown`／`closeOpenBreakdown`／`toggleRateComposition` 同步維護）、`aria-label`「10%，查看回饋組成」／「2%，查看試算明細」、`:focus-visible` 2px 藍框
- ⚠️ **鍵盤 Enter**：全站 `document` 的 `keypress`「Enter＝計算」（`js/home-ui.js`，`ENTER_OWN_ACTION`）2026-11-23 起在焦點位於按鈕、連結、下拉、多行文字框、`role=button/switch/tab` 時不計算，讓那個元素自己處理 Enter（原本會重算、重畫結果區，回饋率抽屜、「加到小抄」「詳情」都像按了沒反應）。在商家、金額輸入框裡按 Enter 照舊計算。新增會被 Enter 啟動的自訂元件時，用真的 `<button>` 或加上對應 role
- GA4：原本計算機鈕就沒有送事件（`js/quick-options-misc.js` 的 GA4 選擇器沒有它），所以沒有要搬的事件
- 首次引導（`js/home-ui.js`）不引用計算機鈕：第 3 步打亮的是整張 `#results-container > .card-result`，洞跟著卡的邊框走（拿掉圖示後卡高少 1–2px，洞跟著變）。`?ab=B` 清 localStorage 實測四步照常跑完

**2. 個人設定儲存狀態 → 標題列右側小字**
- `.cd-set-hd`（flex）＝`h4.cd-set-h`「個人設定」＋右側 `#cd-save-status`（`.cd-sv`，12px #6b7280，`role="status" aria-live="polite"`）。**手機也顯示這一列**（以前手機把 h4 藏起來；現在狀態住在這裡）。整條彩色底、`.cd-sv-dot` 都拿掉
- 四態（`cdSaveStatusRender`，狀態邏輯、`cdTrackSave`、各 save 回傳值、`volatile` 都沒動）：已登入＝綠勾＋「已儲存・HH:MM」（還沒存過＝「已儲存到你的帳號」；時間不再帶「今天」）；訪客＝黃手機＋「存在這台裝置・」＋「登入」連結（`#cd-save-login`，id 保留）＋「同步」（訪客不再顯示時間）；儲存中＝轉圈＋「儲存中…」；失敗＝紅警告圖示＋紅字「{欄位}沒存成功，請重試」，**原因、「已先存在這台裝置」、「另有 N 項也沒存成功」放第二行 `.cd-sv-d`**，並完整寫進元素的 `title`。`volatile`（童樂匯）＝「這項設定只在這次瀏覽有效・登入後才會保存」。DOM：`.cd-sv-l`（圖示 `.cd-sv-ic`＋文字 `.cd-sv-t`＋登入鈕＋`.cd-sv-t2`）＋`.cd-sv-d`；文字長時換行、靠右
- 測試讀狀態一律用 `el.innerText` 去空白（`card-settings-promo-test.js` 的 `status`／`watch`），不要再讀 `.cd-sv-t`（只是整句的前半）

**3. 個人設定文字**：拿掉「我的紀錄」小標（含副標「只有你看得到」；額度／免年費／筆記三列直接接在上一組下面，`.cd-pan-set > .cd-set-box` 有 12px 上距）；「計算條件」小標保留（縮成 14px，因為上面多了 17px 的「個人設定」）。底部說明：「想一覽所有個人設定？到首頁點擊右上角的「我的信用卡」。」非分級卡因此沒有任何組標題

**4. 桌機（≥1025px）左欄＝獨立白色側欄**
- 白底＋右側 1px 細框線（#e5e7eb）＋從頁首下緣一路到底。**畫在捲動容器 `.card-detail-content` 的 `background-image`**（一條 `linear-gradient`，stop 位置用 `calc(var(--page-gutter) + 316px)`）：預設 `background-attachment: scroll`＝不隨內容捲動，所以右欄捲到哪白欄都在、也總是蓋到視窗底；頁面比 `--page-w` 寬時內容置中，用 `--page-gutter` 把左邊補滿（白欄延伸到視窗左緣）。頁首／頁籤列是不透明藍底，白欄只會在它們下面露出來。`.cd-side` 仍是 sticky、自己 `overflow-y:auto`，行為沒變
- ⚠️ **白欄寬度與 `.cd-layout` 的 `grid-template-columns: 316px` 是同一個數字**，改一邊要改另一邊（gradient 的 316／317px）。頁籤列 `padding-left: gutter+330px` 與右欄對齊沒動
- 左欄內部不再有白框：`.cd-sum` 拿掉底色／外框／圓角，只留下緣一條細線；`.cd-side .cd-set-box` 無底無框，列與列之間細線（#f0f1f3）、「計算條件」組與下一組之間 1px #e5e7eb 分隔線。`.cd-side` 內距改 `14px 12px 24px 14px`（右側多留 12px 離框線）。灰底小格（`.cd-fact`）不是「白框」，保留
- 769–1024px 與手機版面不變（只有標題列與狀態小字、計算條件小標縮字是共用的）

**自動化**：`card-detail-test.js` 的 390px 不變式多驗「有組成的回饋率是帶虛線的按鈕（aria、沒有圖示）、沒組成的是純文字、字重 800」；`card-settings-promo-test.js` 多了標題列／新文字檢查與 D 段桌機版面（1440×900、1100×800 取像素驗白欄、框線、右欄灰底、捲動右欄左欄不動、頁籤對齊）。基準（`baseline.json`／`card-detail-baseline.json`）**沒有重拍**：兩支測試抓的是文字欄位，計算機鈕與回饋率按鈕的差別不在文字裡，13 組＋33 張卡 × 2 日期逐字一致就是「回饋率、金額、上限、通路、條件文字完全沒變」的證據。

- **桌機個人設定是一個區塊**（2026-11-23 站長：只用細線分段看起來零散）：`.cd-side #card-personal-section` 是淺灰底（#f9fafb）圓角面板，兩組設定是面板裡的白色小盒子；控制項 32px 高、120px 寬、字 14px。推翻 1q 節原本「左欄內不要白框、只用細線分段」那條。手機不變

- **卡片用途 `#card-use-case` 是引言**（2026-11-23 站長從設計 4／4-A／4-B 選 4-B）：拿掉左側色條與半透明框（色條＋圓角框是範本樣式），中文引號「」用 CSS `::before/::after` 加上，下一行靠右小字署名 `#card-use-case-cite`「— 大師點評」。兩個節點由 `showCardDetail()` 一起設 `hidden`。手機白字在藍色頁首裡；桌機深灰字、引號品牌藍。/promos 的 `.promo-feat-usage` 仍是舊的色條樣式，沒有跟著改

- **回饋類型與點數效期**（2026-11-23 站長）：`basicCashbackType`／`pointsExpiry` 從摘要那行小字（原本「小樹點｜有效期限3年。」）搬到「回饋」頁籤最下面的 `<details id="card-reward-info">`，預設收合、各有小標（回饋類型／點數效期）。沒資料的那一列藏起來，兩列都沒有整塊不顯示，換卡時收回去。摘要那行（`.cd-type`）現在只剩「信用卡官網 ↗」。搜尋結果卡上的回饋類型小字（`results-display.js`）沒動

## 1p. 標籤只有兩種樣式（2026-11-16，站長選定「灰＋黃」）

- **資訊（灰底墨字）**：推薦活動的類型標籤、一般消費排除。**提醒（白底、金黃細框、字前一個黃點、墨字；站長 2026-11-17 從兩輪共六個配色裡選的，不要改回色塊底）**：即將開始、即將結束／剩 N 天、未達門檻。顏色集中在 `styles.css`「標籤的兩種樣式」一處，各標籤自己的規則只管尺寸
- **新增標籤先歸到這兩類之一，不要開第三種顏色**；紅色留給錯誤訊息。「最優回饋」綠色角標是例外（站長裁定保留）
- **即將開始的卡整張淡化，但「即將開始」標籤不淡化**（站長：它應該是淡化的卡上偏明顯的一塊）。所以 `.upcoming-activity` 本身沒有 opacity，半透明下在「標籤以外的每一塊」（`.card-header`／`.rate-card-header` 裡除了 `.badges-container` 的子元素，加上其餘直系子元素）。**在這兩種卡的 header 裡新增元素、或在卡片下新增直系子元素時，確認它有被這組選擇器涵蓋**；不要把 opacity 加回卡片本身（子元素沒辦法把父層的 opacity 加回來）

## 2. 卡片圖片資產

- 路徑慣例：`assets/images/cards/<card.id>.png`——前端直接組路徑，**不用改 Sheet/Apps Script**
- 缺圖：`<img onerror>` 隱藏整個 img，layout 自動退回沒圖版本
- 兩個位置：詳情頁 header `.card-detail-image`（56px 高、max-width 96px、contain）；選擇 modal tile `.card-checkbox-image`（70px 高、max-width 140px、margin-left 22px 對齊卡名）
- 直/橫卡都支援（object-fit: contain 自動 letterbox）
- **解析度規範**：橫式 800×500（直式 500×800）PNG，壓在 ~150KB 內。舊 320×200 在 Retina 會糊

## 2b. 品牌標誌資產（2026-10-07，《Pick My Card 品牌標誌規範 v1.0》）

- **唯一來源**：`tools/build-logo-assets.js` 的幾何／色彩常數。所有標誌檔都由它生成，**不手改輸出檔**；要改標誌改常數後重跑（需 `npm install playwright opentype.js --no-save`；字標與分享圖要網路抓字型，離線用 `--marks-only`）
- 幾何（規範單位，原點＝前卡中心）：前卡 52、圓角 7、傾 31°；晶片 13×10、圓角 2.5、距卡邊 7；後方兩卡 45°、邊長 50、圓角 7，中心 (9,12)／(13,17)；間隙 2.6 是真的鏤空（mask），任何底色都透得出來
- 色彩版本（`assets/brand/pmc-mark*.svg`）：主要（漸層前卡＋`#60A5FA`/`#BFDBFE`，淺底用）、單色藍、墨色單色（後兩卡同色 50%/22%）、反白（**藍底一律用它**）、反白深色底（晶片填 `#3B82F6`）
- 晶片孔（規範「03 晶片孔」）：13×10、圓角 2.5、距前卡上緣與左緣各 7，**尺寸、位置、色彩皆固定，小尺寸版也不放大**。反白・藍底的晶片是挖空透出背景——背景跟標誌同一個檔（App 圖示、社群頭像）就真的挖空（`cutout: true`）；透明底檔（header、`pmc-mark-reverse.svg`、反白字標組合）看不到背景，填 `#2563EB`
- **32px 以下用小尺寸版**（`pmc-mark-small*.svg`：去底層、間隙 5；晶片不變）。header 各斷點最小 32px 所以用完整版；landing 22px 的小 logo、分頁 favicon 用小尺寸版
- 網站引用：header＝`assets/images/logo-header.svg`（緊貼外框，CSS 只設高度）；`logo-header.png` 只留給舊版 Apps Script 匯出的 promos.html；favicon＝根目錄 `favicon.ico`（16/24 小尺寸、32/48 完整）＋`assets/images/favicon.svg`；apple-touch／manifest maskable＝`icon-pickmycard-ios.png`（漸層滿版，標誌落在中央 80% 安全圓內）；manifest any＝`icon-192/512.png`（圓角方塊）
- 圖片引用的 `?v=` 不歸 deploy-version.sh 管：換圖時手動改日期（og:image、favicon.svg、apple-touch、logo-header 一起改；Apps Script `cards-export.gs` 的 `PMC_OG_IMAGE` 也要同步）
- SEO：首頁 JSON-LD 有 `WebSite`（站名「信用卡回饋大師」）＋`Organization.logo`＝`assets/images/icon-pickmycard.png`（512 透明底主要版本），faq 的 publisher 同一張——**這個檔名／網址別改**，Google 是照網址抓品牌標誌；所有頁的 og:image 帶 `og:image:width/height/alt`；header／landing 的標誌 `<img>` 帶 width/height 屬性（只為寬高比，防版面跳動，實際大小仍由 CSS 高度決定）
- 禁止：改傾角、拿掉間隙、換色、拉伸、加陰影、放在低對比底上（規範第 08 節）

## 3. 選卡 modals（我的信用卡／管理加入比較的卡片）

- 共用渲染 `_renderCardSelectionModal(config)`——一份程式碼餵兩個 modal（不同 selectionId、tagFilterChipsId）
- `.card-checkbox` 是 column flex：上排 checkbox+卡名+ⓘ，下排卡圖（左對齊卡名）
- 卡名粗體只限 `#cards-selection`/`#owned-cards-selection` 的 `.card-checkbox-label`（不影響行動支付 modals 共用的同 class）
- Grid：`repeat(auto-fit, minmax(200px, 1fr))`
- **Body scroll lock 是 refcount**（`bodyScrollLockDepth`）：疊層 modal 關掉上層不會誤放開捲動鎖。改 modal 開關邏輯時必須維持 disableBodyScroll/enableBodyScroll 成對呼叫

- **「ⓘ 詳情」鈕全站只有一組樣式**（2026-11-16 站長要求一致化）：`.card-detail-peek-btn` 白底灰框膠囊、26px 高（桌機 ≥1025px 是 23px，縮小值在 styles.css 檔尾「結果卡次行按鈕」）。搜尋結果卡、領券卡、兩個選卡 modal、推薦活動 modal 的「卡片詳情」都吃同一條基底規則，**不要再依所在位置另開顏色或尺寸覆寫**（之前選卡 modal 是淺藍 22px、結果卡是白底 26px，同一顆鈕兩種長相）。推薦活動卡上的方形 ⓘ（`.spotlight-info-btn`，開的是活動詳情）站長裁定先維持現狀，不在此列
- **手機版卡片勾選列**（2026-10-14）：≤768px 時「詳情」鈕換到卡名下一行（`.card-checkbox-row` flex-wrap，鈕縮排 22px 對齊卡名）——擠在旁邊會把卡名壓成一字一行
- **「全選／全不選」鈕**（`.toggle-all-btn`）任何寬度都一行（nowrap＋不縮），由搜尋框縮（`.modal-controls` 子層 min-width:0）
- **詳情頁卡片標籤**（`.card-tags-container`）2026-10-14 起先用 CSS 藏起來（`#card-detail-modal .card-tags-container`），`renderCardTags` 程式保留
- **所有 modal 每次打開都從最上方**（2026-10-14，`setupModalScrollReset`，`js/core-utils.js`）：MutationObserver 看 `.modal` 由關變開的那一刻，把 modal 與裡面捲過的區塊歸零；新 modal 只要掛 `.modal` class 就自動適用。開啟後才捲到指定區塊的功能（`openCardDetailAtChangelog` 等）都在下一幀才捲，不受影響。測試在 `merchant-suggest-test.js`

## 4. 推薦活動（Spotlight，UI 名稱 2026-09-03 由「精選活動」改為「推薦活動」）

> ⚠️ UI 字串是「推薦活動」，**程式內部命名一律沿用 `spotlight`**（id/class/函數/資料 key），改名時刻意不動——牽動十幾個檔案卻沒有好處。

**位置（重要）**：`#spotlight-section` 不在 `<main>` 內，是 `.container` 直系子節點、緊接 `.app-layout` 之後——跨 sidebar+main 兩欄的全寬橫帶，位於所有搜尋結果之下。**例外（2026-11-16，桌機空狀態）**：≥1025px 且畫面上沒有任何搜尋結果時，`placeSpotlightSection()`（`js/home-ui.js`）把同一個節點搬進 `<main>` 的 `#spotlight-empty-slot`（搜尋框正下方，加 class `in-main`）；按下計算的當下同步搬回原位（`beginSpotlightCalc()`，由 `calculateCashback()` 呼叫——不能等結果出現才搬，會讓 `displayResults()` 的捲動捲過頭），結果收起時由 MutationObserver 搬回主欄。新增結果區塊時放在 `#view-search` 底下當直系 `<section>` 並用 inline `display` 開關，這套判斷才認得到。`box-sizing: border-box; width: 100%; padding: 24px 30px 30px`（2026-09-03 拿掉 `border-top`：站長認為 main 與推薦活動之間不需要分隔線）。

**資料**：Google Sheets `Highlights` 工作表 → `cardsData.spotlights`。欄位：merchant, rate(數字), description, card_name, card_id, order(數字), active(布林), featured(布林，2026-09-03 新增；**前端不讀**——主打卡程式 2026-10-02 已移除，見下方「版位與分頁」)。

**order 防呆（2026-10-11，只警告不擋）**：前端依 `order` 排序（`js/home-ui.js renderSpotlights`），重複時同號依試算表列順序、0／空白被當 999 排最後。匯出前（`validateSpotlightOrder_`，`cards-export.gs`）與 `tools/check-spotlights.js`（preflight 4c）都只對 active 的列提醒，規則兩邊一致；前端不改排序。

**Highlights 只存「編輯決定」（2026-09-30 起）**：`cap`／`deadline`／`category` 三欄已從工作表刪除——它們與卡片真實資料重複，實測 20 則有 2 則上限、3 則期限對不上。現在：
- **`rate` 是選擇器**：`resolveSpotlightPick(item, card)` 把「活動 × 級別」逐一試算，取回饋率等於 rate 的組合（多個相等取上限最大）。它同時表達站長選的級別（分級卡有時推中間、有時推最高）與活動（同通路多個活動時，例如夢時代 3%/7%/11%/7%）。**不能改成 level 欄**——level 表達不了「選哪個活動」。
- **上限**＝選中組合的 `resolveDisplayCap()`，顯示「上限 NT$X」、**不帶「／月」**（卡片資料沒有上限週期；站長 2026-09-30 裁定不加）。對不到組合 → 小卡照顯示 sheet rate、不顯示上限，console.error，preflight 第 4c 節（`tools/check-spotlights.js`，直接呼叫前端 resolveSpotlightPick）發 ⚠️。
- **期限**＝`resolveSpotlightDeadline()`（見下段），對不到活動就不顯示。
- **卡名**＝`getSpotlightCardName()` 取 cards 資料的 `name`；sheet 的 `card_name` 只給站長在試算表上看。

**期限自動匹配真實活動（2026-09-02 起；2026-09-30 sheet 的 deadline 欄刪除，不再有後備）**：卡片與 modal 顯示的期限不再直接讀 sheet 的 `deadline`，改由 `resolveSpotlightDeadline(item)` 用 `findSpotlightCardActivities()`（同 ⓘ modal 那支）找出這張卡涵蓋該通路的活動、取其 `periodEnd`；`renderSpotlights()` 建清單時一次算好存進 `item._resolvedDeadline`。對不到活動、或活動沒寫 `periodEnd` → **不顯示期限**（2026-09-30 前是退回 sheet 的 deadline，該欄已刪）。改的理由：sheet 的 deadline 是人工填的、會與活動脫節——2026-09-02 實測 20 則有 6 則對不上，其中 3 則顯示的是「已經過去」的日期（中信 Uniopen 國外實體消費／夢時代寫 2026/8/31，玉山 Ubear Gemini 寫 2026/8/31 但活動其實展延到 2027/2/28），陽信 JCB 晶緻卡日本 7-ELEVEN 則寫成 2026/12/31、比真實的 2026/9/30 多三個月。
**一卡一通路命中多個活動時取「最早到期」**（實測有兩則會這樣：中信 Uniopen 夢時代 4 組、玉山熊本熊卡日本松本清 4 組）——亮點宣稱的回饋率常是多組疊加出來的（松本清 8.5% ＝ 6% 指定日本商店 ＋ 滿額加碼 1.5%），最早到期的那組一過期宣稱的數字就不成立；取最晚會讓卡片顯示一個其實已經拿不到的期限。過期活動在載入時已被 `filterExpiredRates()` 濾掉、不會進 `_itemsIndex`，所以這裡拿到的活動都還在效期內。
⚠️ 亮點本身**不做過期隱藏**：顯示哪幾則仍由 Sheets 的 `active` 欄控制（見下方輪播段）。
**卡片上的期限（2026-10-02 起，站長決定；推翻 2026-09-03「期限不上卡片」）**：資訊列＝「上限 NT$X」＋短格式「至 M/D」（不補零，如 `至 2/28`）；剩 0–14 天時改顯示「剩 N 天」徽章（2026-11-16 起是「提醒」樣式，原本紅色；見第 1m 節）、**取代**「至 M/D」（同一件事，徽章較醒目，也才放得下）。完整日期仍在 ⓘ modal 的「活動期間／活動期限」。
⚠️ **資訊列單行（站長裁定：換行會讓同排卡片高度不一；<360px 例外）**：`.spotlight-info-row` 是 `nowrap`，所以 `.spotlight-card` 必須有 `min-width: 0`——少了它 grid 欄會被 nowrap 內容撐寬、兩欄不等寬（320px 實測 155/161px）。≤400px 時字級 0.66rem、間距 4px、徽章內距 5px：最寬的「上限 NT$400,000 至 12/31／剩 12 天」在 360px 剛好放得下；**<360px 一律分兩行**（上限／至 M/D 或剩 N 天；`flex-direction: column`，不看寬度個別換行，每張卡一致。站長 2026-10-02 決定：極窄手機寧可兩行也不截上限金額）；360px 以上若真機字型較寬仍放不下，只有 `.spotlight-cap` 以「…」截斷，日期與徽章 `flex-shrink: 0`。上限位數變多或改文案前，在 360px 量一次。

**卡片版式（2026-09-03 重設計，參考 LINE 購物商品卡）**：由上而下——卡圖方塊 → 大回饋率＋活動類型標籤 → 通路名 → 上限＋「至 M/D」或「剩 N 天」→ 底部兩顆按鈕。取代 2026-07-21 的 F-2 版式（左側傾斜卡圖＋淺綠回饋率貼紙＋右側說明兩行）。

- **卡圖方塊 `.spotlight-ccwrap`**：`aspect-ratio: 8/5` ＝橫式卡圖規範（800×500）的比例，橫式卡圖剛好填滿、卡片高度因此固定；少數直式卡圖靠 `object-fit: contain` 縮到框內（變小但不撐高卡片）。底色**用白＋淺灰細框、不用灰底**——卡圖 PNG 本身是白底，灰底會在卡圖外圍多出一圈白方框，變成「框中框」。`onerror` 隱藏 img 並在 wrap 加 `noimg` class。
- **卡名 `.spotlight-cardname`**：壓在卡圖左下角的半透明白膠囊（`width: fit-content`，只包住文字），省掉正文的一整行高度。深色卡面（星展 eco 綠、遠東快樂卡紅）上靠 `backdrop-filter: blur(3px)` 保持可讀。
- **活動類型標籤**：`parseSpotlightHype()` 從 description 開頭抽「XX！」對表（全場最高/壓倒性神卡/獨家回饋/無腦刷 → class hype-top/god/excl/easy；**2026-11-16 起四種同一個灰色「資訊」樣式**，原本各一色，見 `ui-refresh-diagnosis.md` 3.6）；對不到表列類型→不顯示標籤。**description 本身不再上卡片**——它的內容（如「Line Pay 刷遠東快樂卡」）與「通路名＋卡名」重複。
- 設計裁定（站長 2026-07-21，仍有效）：不用 emoji、不用浮起／轉正動畫（hover 只准陰影微調）、回饋率不上分類色。

**版位與分頁**（`spotlightLayout()` / `buildSpotlightPages()` / `renderSpotlightPage()`）：

- 欄數與每頁張數：**手機（≤768px）2 欄 4 則、平板（769–1024px）3 欄 3 則、桌機（≥1025px）4 欄 4 則**。⚠️ `js/home-ui.js` 的 `spotlightLayout()` 與 `styles.css` 的 `.spotlight-track` **斷點（768 / 1024）必須一致**，否則會出現填不滿的半排。
- 分頁不是用 index 除法算的：`buildSpotlightPages()` 先建出 `spotlightPages`（每頁一個 `spotlightItems` 切片），`renderSpotlightPage()` 只負責畫。跨斷點 resize 時 `setupSpotlightResizeReflow()` 會重建分頁並重畫圓點與箭頭。
- **主打卡（`.is-feature` 大卡／`.is-mini` 小格）已移除**：2026-09-03 停用（主打卡用完之後的頁面沒有主打位，翻頁時卡片形狀不同、看起來很亂），2026-10-02 站長確認不再使用，程式與樣式全部刪除；每頁一律是同樣的直式卡。要考古看 commit「完全移除停用中的主打卡版位程式」。
- **純手動換頁**（左右箭頭＋頁碼圓點＋手機左右滑動 `setupSpotlightSwipe`）——2026-07-27 移除自動輪播；依 order 升冪，**不限筆數**（2026-08-16 拿掉原本的 `SPOTLIGHT_MAX = 12`；筆數多寡改由 Sheets 端 `active` 控制，圓點列已 `flex-wrap` 防爆版）；`active===false` 不顯示；單頁時自動隱藏按鈕與圓點；顯示時機跟著 `showToolSections()`/`hideToolSections()`。

**兩個動作**：
- **「帶入查詢」**（`compareSpotlightMerchant(merchant, { fillOnly: true })`）：**只把商家帶進搜尋框、補上預設金額、捲回搜尋框，不自動計算**（2026-09-03 改；原本叫「比較這個通路 →」且點了就算完並捲到結果，站長依 GA4 使用情況判斷「直接跳到結果很不直觀，會迷失」）。merchant 完全等於某快捷搜尋 displayName（如 `所有加油站`）→ 走 `handleQuickSearch`（多關鍵詞；協助輸入型如 LinePay 在裡面會轉成打字，見第 7 節）；否則當一般單一商家搜尋。⚠️ merchant 一律是單一搜尋詞，不支援多商家字串。
  - 不 focus 輸入框——手機上會彈出鍵盤蓋住「計算回饋」；改成讓計算鈕閃兩下藍光暈（`.calc-nudge`，尊重 `prefers-reduced-motion`）指出下一步。
  - ⚠️ **`fillOnly` 以外的呼叫端維持自動計算**：商家落地頁的 `?merchant=` 深連結（`{ noScroll: true }`）走的是同一支函數，那個情境使用者從外部連結進來、本來就預期看到結果。要改自動計算行為前先確認是哪一條路徑。
  - 🔴 **自動計算的範圍屬產品決策，要復原或擴大一律先問用戶**（沿用 2026-07-12 起的產品決策：計算由用戶按「計算」觸發，快捷搜尋按鈕與 `handleQuickSearch` 只填入關鍵詞不自動計算）。2026-09-03 把推薦活動這條路徑從「自動計算」改成「只帶入」也是站長決定的，不是實作方自行判斷——這條規則沒有因為那次改動而失效。
  - **class 名稱刻意不改**（仍是 `.spotlight-compare-btn`），GA4 的 `button_click` / `button_type: spotlight_compare` 事件才能延續、比對得出改版前後的差異。
- **ⓘ「活動詳情」**（`openSpotlightModal`）：顯示**卡片的真實活動**（不是 sheet 編輯文字）——用 card_id 找卡，`findSpotlightCardActivities(card, merchant)` 從 `card._itemsIndex` 找涵蓋該 merchant 的 cashbackRate；關鍵字來源：merchant 對到快捷 displayName 時用該選項 merchants，否則用 merchant 本身；先精確比對再退子字串。顯示真實 rate/cap/period/conditions/items；placeholder 用 parseCashbackRateSync/parseCashbackCap 解析；**分級卡的級別（2026-09-30 起）＝`resolveSpotlightPick` 選中的級別**（所有活動都用同一個級別解析），對不到才退回第一個級別，且回饋率旁標「(級別名)」（活動 rate/cap 含 placeholder 才標）；選中的活動排第一個，與小卡數字對應。**找不到活動 → 退回 sheet 編輯文字**。⚠️ 只比對 cashbackRates，通路在 specialItems 的分級卡會退回編輯文字。modal 內唯一動作按鈕是「馬上辦卡」（來自 `cardsData.cardApplyCtas[card_id]`，無連結不顯示）。

**相關檔案**：index.html `#spotlight-section` `#spotlight-modal`（merchant/*.html 有同一組容器標記，卡片由 js 動態生成、不需同步改）；styles.css `.spotlight-*`；js/home-ui.js（`renderSpotlights` 一帶）。

## 5. 「我的信用卡」modal（摘要列＋卡片格，2026-11-17 改版；舊的錢包堆疊＋單卡頁設計見 `docs/archive/ui-display.md-2026-11-17.bak`）

**為什麼改**：站長裁定錢包堆疊「只是在展示動畫」——不顯示卡名、整頁唯一的資訊是「N 張」。這一頁的定位是**個人後台**：一覽自己有哪些卡，並從這裡進各卡的個人設定。三個設計稿（清單式／卡片格／主從式）中站長選卡片格：清單式資訊太多偏亂、主從式失去一覽。

**版面**（`renderOwnedCardsOverview()`，`js/cards-modals.js`，Grep「卡片格」）：
1. **標題列**：「我的信用卡 ・N 張」（`#owned-count-badge`，淡灰小字；`mappings-page-test.js` 會讀它）＋「管理卡片」膠囊鈕（`#manage-owned-cards-btn`，沿用原 id，開勾選清單）
2. **摘要列** `.ow-sum`：持有張數／總額度（只加總有填的卡，另註幾張未填）／免年費門檻（達成幾張；不顯示「幾張未達成」）
3. **卡片格** `.ow-grid`：手機 2 欄、≥600px 3 欄（modal 最寬 660px）。每格＝卡面＋卡名＋一行「級別 ・ 額度」；有勾「我已過免年費門檻」的卡多一行綠字「✓ 已過免年費門檻」（`.ow-ok`）；**沒勾的不標**——2026-11-17 站長裁定只顯示正面訊息，因為沒勾過的人每張卡都會被標「未達標」，本來就免年費的卡也會被誤標。最後一格是虛線框「＋ 新增信用卡」
4. **點卡片** → `openCardDetailAtPersonal(cardId)`：開詳情頁並捲到「個人設定」（借該區塊 nav 按鈕的 onclick，理由同 `openCardDetailAtChangelog`）

**規則**：
- **這一頁唯讀**（站長 2026-11-16 裁定）：編輯一律在詳情頁。級別只讀來顯示，**這裡不得呼叫 `saveCardLevel()`**（鐵則 1）
- 個人資料是非同步讀的：卡面與卡名先畫，級別／額度／免年費讀到再補。所有讀取包 `safe()` fallback（Firebase 被擋也能渲染）；重畫用 `_token` 作廢舊批次
- **詳情頁關閉時總覽會重畫**（`setupMyOwnedCardsModal()` 裡的 MutationObserver 看 `#card-detail-modal` 由開變關）——用戶改完額度回來，數字要是新的
- 直式卡圖自動偵測（naturalHeight > naturalWidth）旋轉為橫式（`.ow-portrait`）；缺圖顯示卡名（`.ow-noimg`）
- **結帳日／繳款期限還沒放**：站長要加，但資料面先不碰——`loadBillingDates()`／`saveBillingDates()` 已存在，詳情頁卻沒有輸入欄位（`#billing-date`／`#statement-date` 不在 index.html），用戶目前填不了。要做時先補詳情頁欄位，再回來在卡片格加一行
- 已否決、勿回退：錢包堆疊與堆疊動畫、不顯示卡名的一覽、皮革框／毛玻璃／漸層背景、藍膠囊卡數、標題旁只有圖示的齒輪鈕

## 6. 我的額度（creditLimit，2026-07-07 新增）

- **編輯處只有詳情頁**：`#credit-limit-section`（個人設定「我的紀錄」組的第一列）
- 輸入框（2026-11-17 起在個人設定「我的紀錄」第一列，標籤左、36px 高 132px 寬的輸入框靠右；沒有 NT$ 前綴，單位寫在說明小字）：只收數字、自動千分位（深灰 #374151，2026-11-23 起；原為墨色）、失焦或 Enter 即存；沒值顯示 placeholder「未設定」；`inputmode="numeric"`+pattern。儲存結果由儲存狀態列表達（`cdTrackSave('credit', …)`），不再有 2 秒就消失的「✓ 已儲存」
- 儲存比照免年費：訪客 `creditLimit_local_<cardId>`；登入者 `users/{uid}.creditLimits[cardId]`（Firestore map）＋本機鏡像 `creditLimit_<uid>_<cardId>`；清空＝刪除
- 函數：`loadCreditLimit()`/`saveCreditLimit()`（2026-11-17 起回傳儲存結果）/`setupCreditLimit()`（Grep "我的額度相關功能"）
- 「我的信用卡」卡片格唯讀顯示「額度 N 萬」（非整千則 `NT$x,xxx`）或「額度未填」；摘要列顯示總額度（第 5 節）

## 7. 精準搜尋核取方塊 ＆ 搜尋輸入區版面（2026-07-12 新增/重整）

- 精準搜尋與新戶活動是**淺灰方框 toggle**（桌機手機共用**同一份 DOM**，`.show-promos-toggle` 是 `.input-row-with-button` 的直接網格子元素）：兩框同一列各佔一半（flex 1 1 0），label flex:1 讓**點文字即可勾選**，「?」按鈕在框內文字右側、點擊內嵌展開說明（`promo-help-inline`，桌機也用點擊、不再用 hover popover）。checkbox id：`#exact-search-checkbox`／`#show-promos-checkbox`（單一實例；JS 保留陣列/同步邏輯以防未來再分裝置）。讀取用 `isExactSearchEnabled()`。預設關閉、不記憶狀態
- **合併框 `.merchant-search-box`**：商家輸入（上半部）與快捷 chips（下半部、淺灰背景）在同一個粗框（3px）內；「快捷搜尋」標題列已從 DOM 移除。`#exact-search-empty-hint` 與 `#search-hints-container` 在合併框下方。金額框 `.amount-input-wrap` 同款粗框：NT$ 前綴在左、無框線輸入在右（桌機手機同款，桌機另有「消費金額」標籤＋「預設 NT$1,000」提示，手機隱藏兩者）
- **狀態列與浮層鐵則**（2026-07-13）：匹配狀態列（`.matched-item-row`，含 `#matched-item` 與 `#exact-search-empty-hint`）一次只顯示一行——✘/部分匹配訊息出現時 JS 會收起橙色提示；桌機 search hint（`#search-hints-container`）與「?」說明（`.promo-help-text`）都是**浮層**（absolute，不參與版面），出現時按鈕/勾選不得跑位；「?」說明一次只開一個、點外部收合（`closeAllInlineHelp`）
- 版面順序（桌機 grid `2fr 1fr`，2026-07-12 定稿 2:1 版）：左欄合併框跨 3 列；右欄由上而下「金額(1,2)→toggles(2,2 橫排兩框)→計算按鈕(3,2 整欄寬、align-self:end)」——按鈕在表單動線收尾。手機（`1fr auto`）：合併框整列→toggles 整列（左右各半）→金額＋按鈕同列。改排版時注意 toggles 與 button-group 的 grid 定位規則（styles.css 搜 "show-promos-toggle"）；`#search-hints-container:empty` margin 歸零是桌機對位的前提
- 語義：勾選時 `handleMerchantInput` 以 `findMatchingItem(input, { exactOnly: true })` 過濾，只留 `isExactMatch`（**fuzzy 同義詞展開後全等也算**，如搜「國外」時 item「海外」視為一致）
- **快捷搜尋分兩型**（2026-10-08 站長定義，判斷集中在 `isTypingHelperQuickOption()`，`js/data-loader.js`）：
  - **一次比多家**（`merchants` 多個關鍵詞，如所有計程車）：不受精準搜尋影響（`handleQuickSearch` 不傳 exactOnly；`currentQuickSearchOption` 非 null 時切換核取方塊不重跑匹配），也不跳 Search Hints——按下時會收掉前一個詞留下的提示（`clearSearchHints()`，2026-10-08；以前會留著誤導）。理由：關鍵詞清單靠模糊比對把同一家的各種寫法收進來（「台灣大車隊」→「55688台灣大車隊」），套精準會砍掉變體；輸入框顯示的是類別名，拿它查提示或精準比對沒有意義
  - **協助輸入**（只有一個關鍵詞，如 LinePay、街口支付、ApplePay、悠遊卡、日本網購）：按下＝把 displayName 打進搜尋框再走 `handleMerchantInput()`，精準搜尋、Search Hints 全照打字規則。（導入時驗過這 5 個：打 displayName 與查關鍵詞的匹配完全相同，所以不精準時結果不變；勾精準時「悠遊卡」會變成零結果，因為資料裡的 item 是「悠遊卡自動加值」——跟自己打字一樣）。用戶自訂快捷同樣適用
  - 勾／取消精準搜尋只更新匹配狀態列，**不自動重算**結果卡片，要用戶再按「計算」（2026-10-08 站長確認，自動重算的做法被否決；理由：精準搜尋跟商家、金額、快捷搜尋同屬送出前的查詢條件，同一組條件一律按「計算」才生效）
- **條件已變更提醒**（2026-10-08，`js/home-ui.js`「計算鈕提醒」）：算過一次之後，商家、金額、精準搜尋（快捷搜尋時不算）、新戶活動、快捷搜尋任一改了，「計算回饋」鈕閃一下（`.calc-nudge`，同推薦活動「帶入查詢」那個動畫）；改回跟上次計算一樣就停。條件快照在 `calculateCashback()` 開頭由 `rememberCalcConditions()` 記下。**新增會影響結果的查詢條件時，要加進 `currentCalcConditions()`，並在它的變更處呼叫 `nudgeIfCalcConditionsChanged()`**
- **Search Hints 手機字級**（2026-11-16 站長回報太小）：文案 14px、建議鈕 13px（原本 12／11px，比桌機還小）。不要再縮
- **Search Hints**（`checkAndShowSearchHint()`，打字時依整個輸入詞查 `cardsData.searchHints`）：有文案就顯示，建議詞選填（沒有建議詞時只顯示文案，`.search-hint-message-only`，2026-10-08）。文案必填由 Apps Script 保證（見 data-pipeline.md 第 2 節 Search Hints），前端不做預設句。文案與建議詞都經 escapeHtml，建議詞走 `data-suggestion`
- 零結果提示 `#exact-search-empty-hint`（「無完全一致項目，可取消勾選看相近結果」）：只在「勾選＋放寬後有結果」時顯示；輸入清空、匹配成功、快捷搜尋都會清掉

- **輸入建議下拉選單**（2026-10-14 站長要求，`setupMerchantSuggest()`／`getMerchantSuggestions()`，`js/search-match.js`）：打第 1 個字就列出資料裡**真的存在**的名稱——快捷選項名稱、指定通路商家（cashbackRates／specialItems／generalItems／領券商家）、一般消費排除項目。目的：用戶不知道銀行怎麼命名（打「罰」→ 交通罰單、違規罰鍰…）。規則：子字串命中、開頭相符排前、同級短的在前、最多 8 筆；**不標類別**（站長決定）；命中字加粗。點選＝替用戶打好（走 `handleMerchantInput`），快捷選項走 `handleQuickSearch`，**不自動計算**（同快捷搜尋產品決策）。鍵盤 ↑↓／Enter／Esc；沒選建議直接 Enter 照常計算。**第一行固定是「搜尋「用戶打的字」」**（2026-10-17 站長要求，`.merchant-suggest-query`）：讓用戶知道直接搜自己打的也可以，點它／↓＋Enter＝照打的字計算；沒有任何建議時整個選單不出。中文輸入法選字中不更新。名稱表在 cardsData 或 quickSearchOptions 換了才重建。測試：`node tools/regression/merchant-suggest-test.js`

## 8. 「我的配卡組合」完整頁面「刷卡小抄」（2026-09-28 由 modal 改版；舊 modal 設計見 `docs/archive/ui-display.md-2026-09-28.bak`）

**程式與入口**：`js/mappings-page.js`（第 13 支模組，Grep 檔頭區塊目錄）。`#mappings-page` 放在 `<main>` 裡、頁籤正下方（2026-09-28 站長要求不要蓋住整頁）；改名／標題／回饋率面板與存圖對話框才是 fixed 覆蓋層（z-index 1060，卡片詳情 1100 疊在上面）；網址 `/mappings`（`_redirects` 改寫回首頁、`_headers` 設 `X-Robots-Tag: noindex`、不進 sitemap），`history.pushState`，返回手勢／上一頁會關頁。入口：**文件夾分頁** `#home-view-switch`（「查詢回饋｜我的刷卡小抄」；2026-09-29 全站由「我的配卡組合」改名「我的刷卡小抄」，搜尋結果按鈕「加到我的小抄」，網址 `/mappings` 與程式名稱不變，2026-09-28 第二版：放在 `<header>` 裡最底下、佔滿整列；未選中＝半透明白底白字，選中＝白底藍字、上圓角＋`::before/::after` 反向圓角，和下方白色內容接成一片；有分頁時 header 拿掉陰影；不顯示數量；**登入與否都顯示**，取代舊浮動按鈕 `#my-mappings-btn`）＋頭像選單。**畫面分區**：index.html 每個畫面的容器標 `data-view`，頁籤用 `setAppView(name)` 整組切換（不用 CSS 逐塊藏；同時設 `body.dataset.appView`）。查詢回饋＝`#view-search`（main 欄內的搜尋與結果）＋`#view-search-extras`（推薦活動、推薦比較、跳推薦活動浮標；放在 app-layout 外面是為了桌機跨整個版面寬）＋**左側「加入比較的卡片」欄 `aside.sidebar` 與手機 ☰ `#sidebar-toggle-btn`**（它們只服務查詢；側欄藏起來時 `.app-layout:has(> .sidebar[hidden])` 改單欄）；我的配卡組合＝`#mappings-page`。新增屬於某畫面的區塊，放進對應容器。
**版面（2026-09-29 第三版）**：頁面說明＝三步驟說明卡 `.mp-intro .mp-steps`。桌機＝左欄 250px 常駐（`.mp-actions`：商家數、「編輯」、「存成圖片」；按編輯後提示與設定也出現在左欄）＋右欄 460px（搜尋、小抄），說明卡與兩欄同寬 738px 一起置中；按編輯時小抄不跳位置；小抄下方不放存成圖片。手機＝`.mp-side/.mp-main` 用 `display: contents` 攤平，用 CSS `order` 排成：按鈕列 → 搜尋 → 提示 → 設定（灰底卡片）→ 小抄 → 商家數（靠右，`#mp-count-m`）。商家數有兩個元素：`#mp-count` 在按鈕卡片裡只給桌機左欄顯示、`#mp-count-m` 在小抄下方只給手機顯示，JS 同時寫兩個（2026-09-30）。

**2026-09-30 調整**（站長要求）：①小抄上方兩顆鈕 `.mp-actions`＝「存成圖片」（`.mp-act-save`，下方小字「進入存圖編輯器」）＋「編輯本頁」（下方小字「只編輯本頁顯示的小抄」），小字放在按鈕下方（`.mp-act-note`）；小抄下方的存成圖片鈕（原 `#mp-savebar`）已移除。②**商家名稱與標題只有編輯模式才能點**：非編輯時是 `<span>`、沒有鉛筆；編輯中才是 `<button>`＋鉛筆。③搜尋框 `.mp-search` 左側放大鏡＝與 `.cashback-search-input` 同一個 SVG（用 `background-image`；同一條規則的底色**必須寫 `background-color`**，寫 `background:` 簡寫會把圖示蓋掉）。④說明卡的三步驟 `#mp-steps` 預設收合，由 `#mp-intro-toggle`「使用方法」展開。
**上線告知（2026-09-30，舊「我的配卡組合」下架）**：①頁面最上方 `#mp-moved-note` 一行備註（所有人都看得到；收據小字風格：上下虛線、置中等寬字）；②一次性提示 `mpShowMovedHint()`：登入後 1.2 秒在頁籤下方冒出黑色氣泡「原『我的配卡組合』搬到這裡了」（6 秒、捲動、點畫面任何地方或 × 就關）；每個瀏覽器 2 次（`localStorage.mpMovedHintCount`，不含 uid、登出不清）。曾做過「按鈕飛進頁籤」動畫，站長 2026-09-30 決定拿掉，只留氣泡。③「新功能 Beta」標籤（頁籤角標＋說明卡底部「最後測試中，遇到問題請回報給我們」）**已於 2026-10-14 Beta 結束移除**（`.mp-beta`／`.mp-beta-note`／`#mp-feedback-btn` 與其 CSS、`MP.pendingFeedback` 全刪；回報入口只剩頭像選單）。提示氣泡會等其他 modal 關掉才出現，氣泡不擋點擊（pointer-events: none，只有 × 可按）。改版告知可在幾週後移除。回歸測試用 `?hinttest` 以外的網址都預設計數＝2，避免氣泡擋點擊。
**編輯模式**（`MP.editing`，2026-09-28 站長要求）：預設只顯示說明 → 搜尋框（含 ✕）＋右側「編輯」鈕（同一列 `.mp-searchrow`）→ 乾淨的小抄 → 存成圖片。「顯示等級／方案」勾選常駐在設定裡（`mpLabelsChk()`），雙欄時變灰不可勾（不改存的值）。按「編輯」（變「完成」）才出現：提示列（點商家名稱改名・點卡圖看詳情・自訂時拖曳）、工具列（排列／字級／版面／顯示等級；「更新活動」2026-09-30 起移到小抄右上角常駐）、⋮⋮ 拖曳把手、「刪除全部失效活動」。桌機：平常小抄單欄 460px 置中；編輯中左邊多一欄 300px 設定（`.mp-layout.editing`）。點卡圖在非編輯時也能用；點商家名稱改名、點標題改標題只在編輯中（2026-09-30 起）。
**未登入**（2026-10-14 改版，站長要求）：小抄**照常可用**——搜尋結果「加到我的小抄」直接加入、可排列／改名／改標題／存圖，清單存本機訪客 key `spendingMappings`（`saveSpendingMappings()` 未登入分支），自訂名稱／標題存 `merchantAliases_guest`／`mappingsTitle_guest`（`mpAliasesKey()`/`mpTitleKey()`）。唯一差別：版面上方一句提示 `#mp-guest-note`（「登入後，小抄內容會儲存到帳號，下次回來就可以一鍵更新小抄裡的活動！」，「登入」可點開登入視窗），且不顯示「更新活動」。登入時由 `absorbGuestPersonalData()` **合併**進帳號（見 storage-and-security.md 第 4 節）。舊的範例清單（`mpBuildDemo`）、「登入解鎖此功能」框、「範例」標籤已整套移除。
**搜尋結果的按鈕**（`.pin-btn`，程式名稱沿用 pin）：文字「加到我的配卡」／已加入「已加到我的配卡」（CSS `::after`），琥珀配色不變，圖示＝分頁上同一個收據圖示；提示「已加到我的配卡組合 ✓」／「已從我的配卡組合移除」；未登入也能直接加入（存本機）。登入／登出完成後 `refreshMappingsEntry()` 更新狀態、網址是 `/mappings` 時開頁。

**視圖**：收據風格（上下鋸齒撕邊、`PICK MY CARD ▪ 年-月` 抬頭、`=====`、欄位標題、底部 Code 128 條碼＝`PICKMYCARD.APP`，已用 python-barcode 比對模組序列）。**以商家為單位**（同一商家不分大小寫合併；同商家多張卡時回饋率高的在前、其餘半透明），順序：商家 → 卡圖 → 回饋率 → 期限。三種排列：自訂（`order` 欄位，只有這模式有 ⋮⋮ 拖曳）／A–Z（瀏覽器內建 pinyin collation＋破音字表 `MP_POLY`）／分類（`MP_CAT_RULES` 關鍵字對原名比對；行動支付橘、其他分類藍）。預設單欄＋分類＋小字；偏好存 `mappingsPrefs_<uid>`（本機）。

**規則**：
- **商家名稱絕不截斷**：放不下就換行；單欄小字時等級標籤若擠到名稱會自動移到下一行（`mpFitRows`），大字一律在下一行，且名稱與虛線靠上對齊。雙欄大字名稱下加細線分隔。
- **等級／方案標籤**（只有單欄可勾）：等級讀 `resolveCardLevel()`（只讀，🔒 鐵則 1），所有有 levelSettings 的卡都顯示；方案標籤只給要切換方案的卡 `MP_PLAN_CARDS`（CUBE、Richart），`mpPlanLabel()` 從命中活動的 category 取「」裡的名稱（切換「慶生月」方案 - 美食→慶生月、「固定回饋」方案→固定回饋），其他卡不顯示方案。⚠️ 2026-09-28 修正：原本寫死只認「全支付」「大筆刷」兩個，其他方案全部沒標籤。
- **卡片名稱**（勾「顯示卡片名稱」，`prefs.cardNames`，預設關；2026-09-30 站長從三案選 A）：卡名＝Cards Data 的 `name`（`mpCardName()`），放在第二行最前面：`[卡名][等級／方案][封頂金額]` 靠右，和封頂金額共用 `.mp-row2`（兩者任一勾選就啟用第二行）；雙欄時卡名、封頂金額各自一行（欄太窄）。存圖（`mpLayoutReceipt`）同順序。
- **活動封頂金額**（勾「顯示活動封頂金額」，`prefs.caps`，預設關，單欄雙欄都可）：值＝查詢結果「回饋消費上限」同一個 `calculateCardCashback()` 的 `cap`（`mpCapText()`：消費上限 NT$x／無消費上限；Richart 加「+」同查詢結果）。單欄時放在第二行，等級／方案標籤一起移到這行；第二行橫跨整列（`.mp-f-pick.has-row2` 用 `display: contents` 讓子元素進 `.mp-f-row` 格線），不擠壓商家名稱。這組 CSS 要放在大字規則之後，否則大字的 `order` 會打亂順序（同特異性，後者勝）。存圖時名稱換兩行且第二行夠寬，就把第二行排到名稱下方。
- **失效 `*`**：期限已過＝已結束。「已下架」只在**卡片資料裡完全找不到這個商家**時才判定（`mpProbe`：`JSON.stringify(card)` 找不到 `"商家"`，且活動不是還沒開始）——因為它會被「刪除全部失效活動」刪掉，寧可漏判不可誤判。重算時除了 1000 元，也用該卡各活動的 `minSpend` 各算一次（「單筆滿 N」活動在 1000 元時不會出現）。失效的留在原位、回饋率劃線、卡圖變灰、收據底部註腳；存圖時不能勾。
- **存的名字＝釘選當下資料裡的名字**（不是用戶打的字、也不是自訂名稱）。重查與加入鈕一律經 `resolveMappingMerchant()`／`resolveMappingItemName()`（spending-mappings.js，2026-10-18）：先把整串當一個名字查（名字本身可能含「、」），這張卡還有就原樣用；沒有才用統一詞同一套規則（忽略大小寫／空白／全半形／臺台，加上 `termAliases`）在**這張卡**裡找改名後的寫法。只用來查，不改寫存的資料（自訂名稱的鍵是原名小寫，改寫會讓它對不上）。不走搜尋的「找」：小抄已綁定卡與名字，模糊比對反而會帶到別的活動
- **寫入保護**：登入但 `mappingsLoadState !== 'ok'`（雲端這次沒讀到，手上可能是舊快取）時，更新活動／拖曳／刪除／更新回饋率一律擋下並提示（`mpCanWrite()`），避免舊快取蓋掉別台裝置新增的配對。單筆刪除要按兩次（4 秒內）。
- **更新活動**（原名「更新期限」，2026-09-30 改名並從編輯模式的工具列移到小抄右上角 `.mp-rc-head .mp-upd`，不用按編輯就看得到；未登入不顯示，由 `#mp-guest-note` 提示登入後可用）：重算後回饋率相同 → 改成最新活動期限（條件改了也算）；回饋率不同 → 不改、列出提醒；存回 `spendingMappings`。按過後變「已是最新」（資料變動時 `MP.updated` 會重設）。
- **回饋已變**：開頁重算時就標出（按鈕）；點了顯示原本回饋率與目前資料裡的候選（同卡同商家、依回饋率去重），用戶選一個才更新回饋率＋期限。
- **失效清理**：點商家名稱的面板裡每筆都有「刪除這個（失效）活動」按鈕；收據下方「刪除全部失效活動（N）」兩段式確認（不用 `confirm()`）。
- **小抄標題**：點「刷卡小抄」可改，上限 10 單位（中文字 1、英數 0.6，大字也不換行），存 `users/<uid>.mappingsTitle`＋本機 `mappingsTitle_<uid>`，存圖同步使用。
- **改名**：點商家名稱開面板，只改顯示名稱，存 Firestore `users/<uid>.merchantAliases`（鍵＝原名小寫）＋本機鏡像 `merchantAliases_<uid>`；「商家名稱重設」用 `deleteField()`。搜尋、計算、分類一律用原名。移除配對也在這個面板。點卡圖開 `showCardDetail()`。
- **收據頭尾**（2026-09-29）：抬頭只留年月；底部拿掉條碼、保留 PICKMYCARD.APP。勾「顯示卡數與額度總和」（`prefs.summary`，預設關——額度是隱私）→ 網址上方一段單據「合計」區 `mpTotalsHtml()`：`持有信用卡 ······ N 張`、`額度合計 ······ NT$230,000`、（有卡沒填時）`＊其中 k 張未填額度`，下面一條 `=====`。**N＝「我的信用卡」選取的卡**（`mpOwnedIds()`＝cardsData 裡存在且在 `myOwnedCards` 的卡，與 `#owned-count-badge` 同算法），不是小抄用到的卡；額度＝這些卡的「我的額度」（`mpLoadLimits()` 一次讀 `users/<uid>.creditLimits`，只讀）。點合計區開「我的信用卡」modal（`openMyOwnedCardsModal`）；勾選項後的「?」開說明氣泡 `mpOpenHelp()`，氣泡裡的「我的信用卡」也能點開 modal。`saveCreditLimit()`、`saveMyOwnedCards()`、釘選／取消釘選存完都呼叫 `notifyMappingsDataChanged()`（core-utils.js，發 `pmc:mappings-data-changed` 事件），刷卡小抄頁開著就由 `mpOnDataChanged()` 重讀額度並重畫——其他模組不直接呼叫 mp* 函式。`#my-owned-cards-modal` z-index 1070（壓在存圖對話框 1060 上）。
- **存圖設定獨立**（2026-09-29）：存成圖片的版面／排列／字級／三個勾選項存在 `MP.prefs.x`，不連動小抄頁面（第一次以頁面當時的樣子為起點）；`mpExportOpts()`、`mpExportPool()`、`mpExportSections()` 一律讀 `x`。
- **存成圖片對話框**：桌機左設定右預覽；手機設定在上、預覽直接接在下面同一頁捲動（2026-09-28 拿掉「預覽圖片 →」兩步驟）。設定區白底、預覽區深色／淺灰整塊＋上方大圓角，兩區要一眼分得出。「要放進圖片的商家」是一整塊卡片（標題列＝名稱＋已選數量膠囊＋手機的藍色「展開⌄」，整列可點；展開後才有「全選」與兩欄勾選）；兩欄勾選，名稱換行不截斷；手機上這區預設收合（`MP.exp.pickOpen`，每次開對話框都重設），點黑色圓形箭頭展開，讓預覽區不用捲就看得到；桌機一律展開。
- **存成圖片**：canvas 直接繪製（`mpLayoutReceipt` 排版一次，量高度與繪製共用），預覽就是實際輸出。桌布尺寸（2026-09-29 依台灣熱銷機型查證）：「本機」（只在手機上，讀 `screen × devicePixelRatio`，手機上預設）＋「通用」`MP_WALL_COMMON` 1440×3120（19.5:9：iPhone 與三星熱銷機 A56/A36、S25 Ultra 同比例；vivo／OPPO／小米／Pixel 約 20:9，用它只左右各裁約 1.3%，被左右留白吸收）；桌機沒有本機→不顯示按鈕，直接用通用；解析度與比例顯示在選項下方（`.mp-ratio-note`），按鈕上不放數字。曾試過「iPhone・三星／其他 Android」兩個通用比例，差距只有 2.5%，併成一個。都用 1440 寬＝熱銷機都是縮小顯示、字銳利。留白一體適用（指紋圖示在下方正中，單欄時落在虛線引線上）；上方 29%（`MP_WALL_TOP`）留給鎖定畫面日期時鐘、下方 15%（`MP_WALL_BOTTOM`）留給手電筒／相機鈕、左右各留 30/390（依站長 iPhone 13 實測）。**iPhone 設桌布時系統常自動放大約 1.1–1.2 倍（自動構圖／透視縮放），網頁無法控制**，預覽下方有提示請用戶兩指縮回、關透視縮放；16:9 只適合 iPhone 8／SE，全螢幕 iPhone 會被裁左右（設定裡有提示）；「全選」只選放得下的前 N 家（實際排版量出來）。桌布放不下時，提示會點名「只取消哪一個勾選（或改小字）就放得下」（`mpWallFixOptions()`，實際排版逐一試，不改設定），再退而建議少勾幾家或改存長圖（2026-09-30 站長回報：已勾到上限再勾「顯示卡數與額度總和」會超出，舊提示只叫人少勾商家）。長圖寬 1080 不限數量。只有淺色／深色。手機走 Web Share（iPhone 會有「儲存影像」），否則下載。
- **搜尋框** `#mp-search`：同時比對原名、自訂名稱、卡名；字級固定 16px 防 iOS 聚焦縮放（樣式用 `#mappings-page .mp-search` 提特異性，壓過全域 input 樣式）。搜尋中停用拖曳。
- **class 一律 `mp-` 前綴**；頁首用 `div` 不用 `header`（見教訓）。

## 9. 禁用手法：卡片頂部彩色條（2026-08-15 站長裁定）

**規則：任何卡片／區塊都不得再用「頂部一條彩色 bar」當裝飾或分類指示。** 站長的原話是「太有 AI 設計感」——
那種 4px 彩條橫在卡片上緣的做法，是 AI 生成版面的招牌手法，掛在本站會讓頁面看起來像模板產物。
新版面要表達分類，用**已經在講同一件事的元素**（徽章、標籤、文字），不要再加一條色帶重複一次。

- 已移除的實例：`promos.html` 新戶活動卡的 `.promo-type-bar`（生成端 `cards-export.gs` 的
  `pmcRenderPromoCard_`、樣式端 `promos.css`，兩邊都在 2026-08-15 拿掉）。類型仍由卡內的
  `.promo-type-badge` 表達，`primaryBucket` 保留給篩選/排序用
- **改了生成端要兩邊同步**：`promos.html` 是 Apps Script 匯出時生成的（見 `data-pipeline.md` 第 9 節），
  改 `cards-export.gs` 後要把整份貼回 Google Sheets，否則下次匯出又會長回來
- 驗證方式（同一份資料跑新舊兩版生成器比對輸出差異）記在下方教訓記錄

## 10. 問卷邀請 Modal（已下架，2026-10-12 整套移除；原設計全文見 `docs/archive/ui-display.md-2026-10-12.bak`）

- 期間 2026/9/1–10/11（台灣時間）。登入後／進站時一次性彈出，「沒問題！」直接開問卷那則公告的 modal
- 受眾＝登入用戶＋回訪訪客（沒帶 `?start` 且 localStorage 有本站痕跡）；首訪不問。原本只問登入用戶，兩天只收 1 份，9/6 擴大
- 原訂 9 月整月；9/30 刷卡小抄上線當天單日 25 份回覆，10/1 站長決定延長到 10/11 底
- 結果：共 43 份回覆、7 位願意 coffee chat。用戶瀏覽器殘留的 `pmc_survey_invite_seen_v1` 無害，刻意不清

> 仍有效：公告 modal 的 `.modal-header` 刻意比全站矮（padding 10px、h3 1.05rem、公告標題不放 emoji，2026-09-03 站長指定），
> 特異性掛在 `.announcement-modal-content` 上，沒動全站 `.modal-header`。

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
- [2026-07-13] 詳情頁改分級後關閉 modal 頁面鎖死不能捲動 → 級別 onchange 重呼叫 showCardDetail() 重繪，disableBodyScroll() 多執行一次而 closeModal 只解一次（refcount 不成對）→ 任何「modal 已開啟時重繪」的路徑都要先檢查 modal 是否已顯示、已顯示就不得再上鎖（showCardDetail 內以 wasAlreadyOpen guard 實作）
- [2026-07-17] 吸卡面主色 28 張幾乎全錯（Uni 淺黃變深金、CUBE 淺灰變黑）→ 飽和度加權投票挑到 logo 而非底色＋亮度 clamp 壓死淺色 → 「主色」＝面積最大的底色（取外圈環帶最大色簇、不調亮度）；抽色/生成類產出必附「原圖 vs 結果」對照圖給用戶驗收
- [2026-07-17] 配卡列拖到一半不再跟手、放開也不存檔 → Chromium 對 setPointerCapture 的元素在拖曳中途無故 lostpointercapture、事件斷流 → 自訂拖曳的 pointermove/up 監聽掛 document，不依賴 pointer capture
- [2026-07-17] 配卡搜尋框樣式怎麼改都沒反應 → 全域 `input[type="text"]`（特異性 0-1-1）壓過純 class（0-1-0），該 class 樣式從未生效 → 元件覆蓋全域 input 樣式時用 `#modal-id .class` 提特異性；「改了沒反應」先查特異性再查快取
- [2026-07-17] 從配卡 modal 點 ⓘ 詳情頁開在後面 → 全部 .modal 同 z-index 1000、同層疊序由 DOM 順序決定，而 #card-detail-modal 在 HTML 較早 → 詳情頁固定 z-index 1100；任何「modal 疊 modal」需求不得靠 DOM 順序
- [2026-08-15] 站長指卡片頂部彩色條「太有 AI 設計感」要求全面不用 → 那是 AI 生成版面的招牌手法，且與卡內類型徽章重複表達同一資訊 → 見第 9 節禁用規則；改 promos 生成邏輯時，用 `vm` 載入新舊兩版 `cards-export.gs` 跑同一份 exportData（固定 `versionTagOverride`／`promosUpdatedIso`）比對輸出，確認差異只有預期的那幾行
- [2026-09-02] 精選活動卡片上的「至 X」有 6/20 則與卡片真實活動期限對不上，其中 3 則顯示的是已經過去的日期 → 期限直接讀 Highlights 工作表人工填的 `deadline`，活動改期／展延時沒人回頭改 sheet → 亮點的期限改由 `resolveSpotlightDeadline()` 從真實活動的 `periodEnd` 取（多個活動取最早到期），sheet 只當後備；凡是「sheet 編輯欄位」與「卡片真實資料」都描述同一件事的地方，顯示一律以真實資料為準、編輯欄位當 fallback
- [2026-09-03] 手機版改滿版白底後，頁尾社群按鈕整組消失 → `.social-media-footer` 在 `.container` **之外**，文字是白字白框、靠 body 的灰漸層才看得見，我把 body 洗成白色就隱形了 → 改「整頁背景」前先確認 `.container` 之外還有哪些元素（頁尾、警語列）靠它撐色；手機滿版的正解是 `body { padding: 0 }` ＋ `.container` 去圓角陰影，**灰漸層要留著**
- [2026-09-03] 推薦活動改一排 2 張後，最後一排只剩 1 張落單 → 每頁筆數（SPOTLIGHT_PAGE_SIZE=3）與欄數（2 欄）沒對齊 → 每頁筆數＝欄數 × 列數，`spotlightLayout()` 與 `.spotlight-track` 的斷點（768/1024）必須成對維護
- [2026-09-08] 為了「一行 3 顆膠囊」把 `.card-chips` 改成等寬 grid，站長當天否決（長卡名折兩行、膠囊高低不齊）→ 需求講的是「一行裝得下更多」時，先想「把容器加寬讓既有的 flex 自己多塞一顆」，不要改成等寬格線——等寬格線是用「犧牲內容完整度」換「排列整齊」，而膠囊的用途是認卡
- [2026-09-30] 卡片上那格「回饋消費上限」改成取計算層的上限後（見 cashback-engine.md 教訓區），站長追問「那是哪一層的上限？」→ 一格只能放一個數字，`min()` 摘要說不出「2% 無上限 ＋ 4% 限 25,000」，多層不同上限時還會低報（hsbc-liveplus slot2 三層 20,000/29,600/20,000 → 顯示 20,000） → **卡片上那格是摘要、計算明細 popup 是正本**：popup 加欄位標題列並補上第 5 欄「上限」逐層寫出（值只放數字／`無上限`／rate=0 的剩餘額度桶留白），摘要不再解釋自己、由 popup 回答「是誰的上限」。5 欄在 360px 手機吃緊，用四招擠回來並實測：拿掉與上限欄重複的（封頂）紅字（改成上限欄轉紅）、有了欄位標題後值欄不再重複「限」字與 `NT$` 前綴、`@media (max-width: 430px)` 縮字級與欄距、把層名「超過上限(不列入回饋)」縮成「超過上限」（同列的 0%／NT$0 已經把括號那段講完，它單欄吃掉 143px）——量測結果 360px 溢出從加欄前的 11/26 組降到 3/26，430px 與 768px 皆 0 組；剩下 3 組是資料端長類別名（如「指定海外國家實體消費」126px）撐寬的，`nowrap` 保證一層永遠一行、寧可橫捲也不折行
- [2026-09-08] 「桌機 UI 全部縮小」聽起來像一行 `html { font-size: 87.5% }` → 實測 `styles.css` 有 191 條 px 字級與 170 條 rem 字級各半，rem 開關只拉動一半、比例會歪；改用 `zoom` 則會扯到 `getBoundingClientRect` 的量測（詳情頁 nav 捲動就靠它）→ 全站密度調整沒有單一開關，要當獨立任務逐條盤點；先做「放寬容器與側欄」這種只動可用寬度、不動字級的部分，風險與收益比好得多
- [2026-09-08] iPhone 13 上手機抽屜的 FAQ 卡被截斷、又捲不下去 → `.sidebar` 的 height/max-height 吃 `100vh`，而 iOS Safari 的 100vh 是「工具列收起後」的大視窗高度（844px），實際可視只有約 659px：底部近 190px 被工具列蓋住，內容（約 780px）又小於 844px 不產生捲軸 → 任何「滿版高度的固定面板」（抽屜、全螢幕 modal）一律 `100vh` 後面再補一行 `100dvh`，vh 那行只當舊瀏覽器 fallback
- [2026-09-03] 用 `s[start:end]` 整段替換 CSS 區塊時，誤刪了夾在中間的 modal 樣式與手機 media query → `end` 錨點抓成「下一個大註解」，但那之間還有別的規則 → 整段替換前先確認 start/end 之間**只有**要換掉的東西（`grep -n` 列出區間內的選擇器），或改用逐條 replace
- [2026-09-23] promos 點「查看卡片詳情」後，詳情彈窗背景上方浮出一整片灰色的「推薦比較」工具列（手機上 315px 高、連結還點得下去會把 iframe 導去商家頁）→ embed 模式的隱藏清單（`html.pmc-embed ...`，2026-07-16 寫的）是**黑名單**，而 `.mc-related` 是 2026-08-18 才加進 index.html 的，沒人回頭補清單；詳情 modal 自己的遮罩是半透明的，於是它就從背景透出來 → 在 index.html 的 body 層級新增區塊時，同步檢查 embed 清單；styles.css 與 index.html 兩邊都補了警告註解。判「這東西是誰畫的」時先確認自己看的是父頁還是 iframe——它會隨詳情關閉一起消失，正是因為它活在 iframe 裡
- [2026-09-23] 手機標題列改 sticky 後，320px 螢幕上長卡名被導覽列蓋掉半行 → `--pmc-detail-header-h` 只在 `setupCardDetailNav()` 開啟當下量一次，而卡圖 `width:auto` 要等圖片 load 完才佔寬度、進而把卡名從一行擠成兩行（57→85px），變數還停在舊值 → 凡是「量某元素高度寫進 CSS 變數」的地方，只要那元素裡有圖片或會換行的文字，就用 ResizeObserver 持續同步，不要只量一次（寫入前比對舊值，避免 observer 自己觸發自己）
- [2026-09-16] 首頁「消費金額」框在桌機 Chrome 跳出儲存的帳號/密碼下拉（站長截圖回報）→ 刪除帳號 modal 的 `#da-password` 沒有 `<form>` 擁有者，Chrome 會把全文件的無主欄位併成一個合成表單、再挑密碼欄前方最近的文字欄當帳號欄，也就是 `#amount-input`（`type="number"` 一樣會被選中，`autocomplete="off"` 擋不住密碼管理員）→ **頁面上任何 `type="password"` 欄位一律要被某個 `<form>` 擁有**，否則它會把同頁不相干的輸入框變成「帳號欄」；本專案的作法是 `<form id="da-form" style="display: contents;">`（不影響版面）＋ JS 攔 submit。新增密碼欄時照做
- [2026-09-28] mockup 選「大字」時整張收據變黑、排版亂掉 → 大字用了 class `big`，撞到既有的黑色按鈕樣式 `.big` → 新元件的 class 一律加元件前綴（配卡組合頁用 `mp-`），加之前先 grep styles.css 有沒有同名全域規則
- [2026-09-28] 配卡組合頁頂端整條變成藍色漸層、返回鈕看不見 → 用了 `<header>`，吃到全站 `header { background: 漸層 }` 元素選擇器 → 全螢幕層、modal 內部的標題列用 `div`，不要用 `header`/`nav`/`main` 這類有全站元素樣式的標籤（先 `grep -n "^header\|^nav\|^main" styles.css`）
- [2026-09-28] 同一商家在配卡組合出現兩次（「uber eats」「Uber Eats」）→ 配對存的是搜尋結果的 matchedItem，大小寫隨資料而變，分組用了原字串 → 以商家分組一律用小寫鍵（`mpKeyOf`），顯示用該組第一筆原名
- [2026-09-28] 配卡組合搬進 `<main>` 後「顯示等級／方案」字變超大 → 全站 `label {}` 與 main 內的表單樣式套上來 → 元件放進 main 時，label／input 一律用 `#mappings-page` 開頭的選擇器把字級、margin 蓋回來，搬位置後要重看所有表單元素
- [2026-09-29] 存圖對話框「要放進圖片的商家」選不到下面的選項（整欄捲不動）→ 兩個 grid 陷阱疊在一起：①桌機 `.mp-exp-box` 是 grid 且沒設列高，列高＝內容高，設定欄被框裁掉、內層 overflow 永遠不觸發；②設定欄 `.mp-exp-body` 是 grid，子區塊有 `overflow:hidden`（為了圓角）時自動最小高度變 0，auto 列把它壓成剩餘高度並裁掉清單 → `.mp-exp-box { grid-template-rows: minmax(0,1fr) }`＋`.mp-exp-body { grid-auto-rows: max-content }`；回歸測試實際捲到底檢查最後一個選項看得到。凡是「grid 容器內要捲動」都先檢查這兩點
- [2026-09-29] 上線前 code review 抓到「已下架」誤判會導致資料被刪：原本重算回傳空就判已下架，但 `calculateCardCashback` 只回傳「現在、這個金額、這位用戶條件下」有效的活動——單筆滿額（1000 元試算不到）、還沒開始、生日月等都會是空的 → 被列進「刪除全部失效活動」。改成只有卡片資料裡完全沒有這個商家才算下架。凡是「判定結果會觸發刪除」的邏輯，都要用最保守的條件
- [2026-09-30] 推薦活動玉山 Uni 卡支付寶：卡片寫 4.5%，ⓘ 活動詳情卻顯示 3%（CUBE 全球迪士尼飯店同樣 3.3%→2%）→ `buildSpotlightModalBody()` 一律拿 `Object.keys(levelSettings)[0]` 解析 placeholder，而推薦活動是編輯挑的特定級別（UP選／Level 3），第一個級別剛好是最低的 → 分級卡的級別不能預設取第一個，要用手上已知的目標值（sheet rate）反推級別；新增任何「代替用戶選級別來顯示」的地方都照此辦理，且只顯示、絕不存回（鐵則 1）
- [2026-10-04] 站長回報進首頁時「頁籤以下一片空白」→ boot loader `#pmc-boot-loader` 是 `position:fixed` 置中的小灰 spinner，疊在「推薦比較」連結上看起來像文字重疊，工具區位置則是空的 → loader 改成頁籤正下方的一般區塊（`min-height:45vh`，文字「正在載入卡片資料…」），`showToolSections()`、商家落地頁深連結、資料載入失敗三處都會收掉 `pmc-returning-user`。⚠️ 它現在會佔版面：任何「工具區先顯示、auth 還沒判定」的新路徑都要自己移除這個 class，不然 loader 會把搜尋框往下推
- [2026-10-05] 密度調整把 `.app-layout main` 的字級從 0.9rem 縮成 0.79rem 後，刷卡小抄裡沒寫死字級的元素全跟著變小（它沒有根字級，一路繼承 main）→ 「排除某區塊」不能只靠「選擇器不含它」，繼承下來的值一樣會流進去 → 排除一個區塊時，在它的根節點把被改到的可繼承屬性（font-size、line-height、color…）釘回原值，並用計算樣式逐元素比對前後，不要只看截圖
- [2026-10-07] favicon 晶片孔看起來太大 → 小尺寸版照「32px 以下放大晶片」做成 20×16，但新版規範「03 晶片孔」規定晶片尺寸固定 → 晶片一律 13×10、距邊 7，小尺寸版只去底層＋加寬間隙
- [2026-10-13] 站長回報 Safari 開首頁「loading 動畫很快消失，停在空白很久」→ `ensureGuestUIBound()` 在 Firebase SDK 一就緒（正常路徑也會跑到）就收掉 `pmc-returning-user`，但 `onAuthStateChanged` 還要等 Firebase 線上驗證帳號好幾秒才 `showToolSections()`；auth 永不回應時更是永遠空白 → 拿掉那行，改由 `showToolSections()`／`onAuthStateChanged` 收 loader，並加「auth 判定逾時」fallback（`initializeAuthListeners()`，`FIREBASE_FALLBACK_MS` 後以訪客模式顯示）→ 收 loader 的時機必須和「工具區出現」綁在一起，不能綁在「某個中間步驟完成」。站長裁定：不依 `pmc_known_logged_in` 先當登入用戶顯示工具區
- [2026-10-18] 統一詞一輪（10-14～17）把卡片活動裡 34 個名字改寫，其中 18 個（只差空白／大小寫／臺台，統一詞表照規定不列）存在刷卡小抄的舊寫法查不到 → 被判「已下架」、會被「刪除全部失效活動」刪掉；另查出名字括號裡含「、」的 10 個名字（Apple錢包指定交通卡(Suica、PASMO、ICOCA) 等）一釘選就被判已下架，因為重查前一律先用「、」拆 → 小抄重查與加入鈕改走 `resolveMappingMerchant()`（見第 8 節「存的名字」）。資料改名是正常維護動作，任何「拿存下來的名字回頭查資料」的功能都要認得改名前的寫法，且判定會觸發刪除時要用真實改名清單驗過（這次用 10-13 與 10-17 的 cards.data 對照）
- [2026-10-21] 手機版頁尾白字放在 body 灰漸層上對比只有約 1.5:1（小標 10px 幾乎看不見）、廣告沒填到時「推薦比較」下方留一塊 116px 白洞 → 白字是當初配深色背景的寫法、灰底換上來後沒人重量對比；廣告列用 `min-height:100px` 預留位子，但擋廣告外掛／沒填到時位子永遠空著 → 頁尾改深色字（`#374151` 約 5.4:1）＋手機兩欄格線（奇數顆最後一顆佔滿一列）＋法務連結縮成 `.footer-legal` 一行小字；廣告列拿掉預留高度，外框與「廣告」標籤只在 `<ins data-ad-status="filled">` 時出現，`data-full-width-responsive` 改 false（true 會讓手機廣告撐出外框）。⚠️ 頁尾是**同一套結構手抄在 4 頁**（index／faq／privacy／terms）＋商家頁由生成器從 index 產生＋promos.html 由 `cards-export.gs` 生成（用自己的 promos.css，要手動同步）；改頁尾要全部對一遍。另：站長實測確認 AdSense **錨定廣告收合後，原本預留的空間不會收回**（頂端錨定→頁頂一段空白；底部錨定→頁尾下方約 400px 空白），這不是本站版面造成的，改 CSS 前先分清楚是不是廣告插的
- [2026-11-16] 站長反映全站「很有 AI 感、不專業」→ 成因是一整組手法疊加（灰底浮卡、預設色票、emoji 圖示、尺度不一致），不是單一元件 → 動全站視覺（底色、頁首、頁籤、結果卡、色票）前先讀 `docs/project/ui-refresh-diagnosis.md`：有成因排序、分批清單與進度、示意用 CSS、實作注意事項
- [2026-11-17] 詳情頁改全頁後，`#card-personal-section` 手機窗格的左右內距消失 → 它同時是 `.card-info-section`（詳情頁內重設 `padding:0`，id 特異性 1-1-0）與窗格 `.cd-pan`（內距 0-1-0）→ 窗格的內距與 `order` 一律用 `#card-detail-modal .cd-pan…` 寫，重設通用區塊樣式時不要連 padding 一起歸零
- [2026-11-17] 「個人設定」頁籤一直不出現 → 判斷頁籤有沒有內容用 computed display，而個人設定的區塊本身就是窗格（沒被選中時有 `hidden`）→ 窗格＝區塊的頁籤不能用 display 判斷，個人設定固定視為有內容
- [2026-11-17] 詳情頁「同方案一張卡」上線前自測：搜尋後清空，13 條適用通路超過三行 → 搜尋自動展開的清單在清空時被收回（`syncMerchantListsForSearch`），那一刻整列還是 `display:none`（列的顯示由後面的迴圈才還原），`cdFitChannel` 量到寬度 0 跳過重收，留下整串完整清單 → 凡是「先藏後顯示」的流程，收通路／量寬度一定要放在**元素重新顯示之後**（`filterDetailCards` 結尾補 `cdFitAll`）；自動化的版面不變式（390px 通路 ≤ 三行）就是為了擋這類「量不到就跳過」的漏洞
- [2026-11-17] 把「量寬度」放進 `ResizeObserver` 回呼裡直接改版面 → 容器高度因此改變、再觸發自己，Chrome 會吐 "ResizeObserver loop completed with undelivered notifications"（Playwright 當成 pageerror）→ 回呼裡只比對寬度是否改變、需要重收就丟 `requestAnimationFrame`；觀察目標寬度沒變就不動
- [2026-11-17] 規格說「一般回饋區：國內一般消費＋一般回饋特列項目同卡」，但那些組別（`一般回饋特列項目`／`一般消費特列項目`／`國外消費特列項目`，共 30 筆、約 25 張卡）原本在**指定通路區**（它們在 cashbackRates 裡）→ 照站長核定的示意圖把它們搬到一般回饋區（見 1n）。「CUBE 指定通路 19 張變約 11 張」的 11 含特列項目那張，搬走後是 10 張。**驗收數字要說明口徑**；之後若有人問「特列項目怎麼不見了」，答案在這節
- [2026-11-17] `card-detail-test.js` 在這輪改完之後單獨跑會偶發紅燈：`console.error: ⏱️ Firebase 載入逾時（4000ms）` 掉進某張卡的取樣視窗 → `run-regression.js` 的 Firebase 替身缺 `setUserProperties`（#561 起 index.html import 它），整支 analytics 模組載入失敗、4 秒後吐逾時錯誤；整個測試一超過 4 秒就會落進視窗（以前剛好跑不到）→ 這支測試的路由補上 `setUserProperties`（`mappings-page-test.js` 早就補了）。替身缺符號時**症狀是計時型噪音**，先看頁面載入時有沒有 "does not provide an export named" 的 pageerror
- [2026-11-17] 個人設定「看起來資料會不見」→ 根因不是版面，是**存好了沒有任何回饋**：額度只有 2 秒就消失的「✓ 已儲存」、筆記要按 💾、級別／發卡組織／免年費改了完全沒反應，而各 save 函數把成功／失敗全吞掉（失敗只有 `console.error`）→ 要讓用戶「感覺存好了」，先讓 save 函數**回傳結果**再接常駐狀態列，狀態只反映真結果；別用計時器假裝成功，也別在 UI 層另寫一份判斷
- [2026-11-17] 訪客的「童樂匯」勾選沒有任何本機備份（只存 Firestore、訪客只在記憶體），狀態列若統一寫「只存在這台裝置」就是說謊 → 儲存結果多一個 `volatile` 旗標，狀態列照實寫「只在這次瀏覽有效」。加狀態列前先盤點**每一欄到底存在哪**，不要預設「訪客＝localStorage」
- [2026-11-17] 狀態列的「登入」連結點了沒反應 → `#auth-modal` 是 `.modal`（z-index 1000），詳情頁是全頁 z-index 1100，登入視窗開在詳情頁後面 → 從詳情頁（或任何 ≥1000 的全頁層）開登入視窗要確認疊序；本輪把 `#auth-modal` 提到 1200。配卡組合頁（1050）的「登入」按鈕理論上有同樣問題（本輪沒測、沒動）
- [2026-11-17] 錯誤用「單一 lastError」記會被別欄的成功洗掉（A 欄存失敗、B 欄隨後成功 → 紅字消失，用戶以為 A 也存好了）→ 錯誤依欄位 key 記帳，同一欄之後成功才清
- [2026-11-17] run-regression.js **不涵蓋搜尋結果的新戶活動卡**（它只抓 `#results-container`／停車／領券）；抽 `createCardholderPromoElement` 的共用函數時，「逐字一致」要自己比：載入 `git show HEAD:js/results-display.js` 的舊版，對所有活動 × 兩種模式（搜尋／詳情）比 outerHTML，並換好幾個凍結日期（徽章依日期而變）。本輪用 7 個日期 × 55 筆 × 2 模式比過全一致
- [2026-11-17] 票券頁籤筆數若把「共用新戶資格」放在 `#card-promos-content` 底下，`cdTabCount` 的 `> *:not(.card-apply-cta)` 會多算一個 → 共用的東西放在 content 之外（`#card-promos-foot`），每筆活動的所有內容包進同一個 `.cd-pm`
- [2026-11-22] 回饋率改成按鈕後，鍵盤 Enter 開不了試算抽屜 → 全站 `document` 的 keypress「Enter＝計算」在按鈕被啟動的同時重算、重畫結果區，抽屜被洗掉 → 新增「Enter 會被全站快捷鍵吃掉」的可點元素，要在 capture 階段攔 keypress（見 1q）；驗證要真的用鍵盤（Tab＋Enter＋空白鍵）走一遍，滑鼠點得開不代表鍵盤開得了
- [2026-11-22] 選項頁示意圖裡「回饋率本身可點」的 10% 看起來比較小 → 示意頁 CSS 的 `.mk button{font:inherit}` 特異性大於 `.rate`，不是設計 → 實作時回饋率字級／字重／顏色一律繼承原樣式、不用 `font` 簡寫，用瀏覽器 computed style 前後比對（搜尋結果 24／28px、詳情頁 24px，800，#111827）
- [2026-11-22] 桌機左欄要「獨立白色側欄、到底」→ 左欄是 sticky、高度只有視窗高，沒辦法靠它自己的背景一路畫到底，也畫不到視窗左緣（內容置中時）→ 白欄畫在捲動容器的 `background-image`（不隨捲動），位置用 `calc(var(--page-gutter) + 316px)`，並以像素取樣測試守住
