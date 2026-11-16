# 「AI 感／不專業感」診斷與分批改善計畫（2026-11-15～16）

站長的問題：看了 HeyMax（新加坡）、AwardWallet（美國）之後，覺得本站「很有 AI 感、不專業、沒有厲害感」，
要在**不影響使用動線**的前提下改善；另外想知道 landing 該不該下架。

本檔是那一輪的診斷結論與待辦。**不會一次做完**——每做完一項就在第 3 節打勾並補日期。
動全站視覺（底色、頁首、頁籤、結果卡、色票）之前先讀這份，再讀 `docs/project/ui-display.md` 對應節。

> 本檔的數字都是 2026-11-15 當天量的快照（`styles.css` 統計、GA 數字、卡片數），動手前重新量。

## 1. AI 感從哪來（依影響排序）

| # | 來源 | 證據（2026-11-15） |
|---|---|---|
| 1 | 灰色漸層底＋浮起的白色圓角大卡 | `body` 是 `linear-gradient(135deg,#e4e5e8,#b0b2b8)`＋`padding:20px`；`.container` 是 `border-radius:16px`＋`box-shadow:0 20px 40px`。範例頁的典型框法；手機版（≤768px）本來就沒有 |
| 2 | 色票是 Tailwind 預設值 | header `#1e40af → #3b82f6` 135° 漸層；灰階 `#6b7280 / #e5e7eb / #374151 / #111827`。沒有自己的品牌色 |
| 3 | Emoji 當圖示 | 快捷膠囊 LINE Pay／街口／Apple Pay／悠遊卡都是同一個 💳，另有 📢 🏪 🛒；頁尾 🎁。來源是 Sheets 的 quickSearchOptions（資料端），不是寫死在前端 |
| 4 | 膠囊與徽章太多、顏色各自為政 | 藍「詳情」、橘「加到小抄」、黃「未達門檻」、綠「最優回饋」、紫「獨家回饋」、青「無腦刷」，加上左欄 34 顆帶色條的卡片膠囊 |
| 5 | 沒有尺度系統 | `styles.css`：183 種色碼、13 種圓角（3～24px）、25 種以上字級（12／12.5／13／13.5 並存）、32 處漸層、135 處陰影，幾乎沒有共用 CSS 變數 |
| 6 | 答案不夠大 | 結果卡的「回饋率 10%」和「回饋消費上限」同字級；推薦活動卡的大數字反而做對了 |
| 7 | 文案像資料欄位 | 「活動: / 匹配項目: / 活動期間: / 條件:」＋ ＊ ※ ✓ 開頭的註記 |
| 8 | Landing 本身 | 半透明斜放卡片、柔光漸層、「STEP 2 •」加寬字距小標、小寫「scroll」。它是 63% 新用戶的第一印象 |

## 2. 對照站的專業感來自什麼（依站長 2026-11-16 提供的首頁截圖）

先講前提：那兩張截圖都是**行銷首頁**，對應的是本站的 landing，不是工具頁。

- **HeyMax**：第一屏＝一句話講「你得到什麼」（Earn miles here. Travel anywhere.）＋一顆按鈕＋真人照片＋具體數字
  （25+ 計畫、70+ 航空、200,000+ 會員）。往下是航空公司 logo 牆、商家品牌色塊、用戶見證。全站幾乎只有深靛藍一個顏色，大量留白，幾乎沒有框線。
- **AwardWallet**：白底藍字。第一屏＝產品手機截圖＋一句話＋輸入框。**數字直接當標題**
  （Over 598 Loyalty Programs／227 Billion Points）。每個功能配一張真實產品截圖，最後有「Bank Level Encryption」。

共同點（＝專業感的來源）：

1. 內容直接鋪在頁面上，沒有外框盒子
2. 一個品牌色＋大量中性色，顏色只留給「可以按」和「有意義」的東西
3. 真實素材：產品截圖、卡面、合作方 logo
4. 具體數字當標題（厲害感主要來自「看得見的資料深度」）
5. 字級少、對比大，一個畫面一個焦點

本站其實有深度（16 家銀行 34 張卡、每日更新），但只出現在頁尾 12px 的「最後資料更新」。

## 3. 改善清單（都不動動線）

### 第一批：幾乎只改 CSS

- [ ] **去灰底**（桌機全幅，和手機一致）
- [ ] **頁首單色**（拿掉 135° 漸層）
- [ ] **頁籤改版**（站長看完去灰底示意後反映「頁籤很怪」，見 3.1；方案待站長選）
- [ ] **換掉 emoji**（先用線條圖示，見第 4 節 logo 使用權）
- [ ] **結果卡層級**：回饋率放大成主數字、加卡面縮圖（34 張卡的圖都在 `assets/images/cards/`）、「詳情／加到小抄」降成中性色、最優卡拿掉綠漸層改白底綠框

### 第二批：需要一點結構整理

- [ ] 收斂尺度：顏色收成品牌藍＋中性灰＋綠（錢）＋黃（警示）；圓角 2–3 種；字級 5–6 級。分區慢慢換，不要一次全站取代
- [ ] 信任列：搜尋框附近放「收錄 N 家銀行 N 張卡・資料更新 YYYY/MM/DD」
- [ ] 桌機空狀態：搜尋框下方的大片空白放範例查詢或推薦活動（和 landing 的決定連動，見第 5 節）
- [ ] 文案：去掉符號前綴與「欄位:」式標籤

### 3.1 頁籤為什麼怪、怎麼改

資料夾頁籤的比喻需要一個「資料夾」（原本那張浮起的白卡）。去灰底之後頁首全幅，兩個頁籤各撐半個內容寬（1440 螢幕上各約 680px），看起來像兩顆巨大的按鈕。

- **方案一（建議）**：頁籤改到白底、底線式，靠左、寬度依文字。位置與順序不變。
- **方案二**：保留資料夾頁籤，只是不撐滿、靠左。改動最小。
- 手機版兩案都不動（手機上頁籤撐滿螢幕是合理的）。

### 3.2 示意圖用的 CSS（實作的起點，不是成品）

示意圖是 Playwright 開真實頁面後 `addStyleTag` 疊上去拍的，沒有改 repo。下面是當時用的規則：

```css
/* 去灰底：頁首全幅、內容維持現有寬度上限（1200／1360／1560 三段沿用「寬螢幕（≥1400px）」區塊） */
@media (min-width: 769px) {
  :root { --pmc-w: 1200px; --hp: max(17px, calc((100vw - var(--pmc-w)) / 2 + 17px)); }
  body { background: #fff; padding: 0; }
  .container { max-width: none; border-radius: 0; box-shadow: none; }
  header { padding-left: var(--hp); padding-right: var(--hp); background: #1e40af; box-shadow: none; }
  .app-layout, #view-search-extras > *:not(.mc-related), #mappings-page { max-width: var(--pmc-w); margin-left: auto; margin-right: auto; }
  .mc-related { padding-left: max(26px, calc((100vw - var(--pmc-w)) / 2 + 26px)); padding-right: max(26px, calc((100vw - var(--pmc-w)) / 2 + 26px)); }
  main { box-shadow: none; }
  .finance-warning-row { border-radius: 0; }   /* 原本配合外框有下圓角 */
  footer { background: #f9fafb; border-top: 1px solid #e5e7eb; }
}
@media (min-width: 1400px) { :root { --pmc-w: 1360px; } }
@media (min-width: 1700px) { :root { --pmc-w: 1560px; } }

/* 頁籤方案一：白底、底線式 */
@media (min-width: 769px) {
  .home-view-switch { background: #fff; margin: 10px calc(-1 * var(--hp)) -9px; padding: 0 var(--hp);
    grid-template-columns: max-content max-content; justify-content: start; gap: 34px; border-bottom: 1px solid #e5e7eb; align-items: stretch; }
  .home-view-switch > button { background: transparent; color: #6b7280; border-radius: 0; padding: 13px 2px 11px;
    font-weight: 600; letter-spacing: 0; box-shadow: none; border-bottom: 3px solid transparent; margin-bottom: -1px; }
  .home-view-switch > button.on { color: #1e40af; font-weight: 700; border-bottom-color: #1e40af; }
  .home-view-switch > button.on::before, .home-view-switch > button.on::after { display: none; }
}
/* 頁籤方案二：.home-view-switch { grid-template-columns: max-content max-content; justify-content: start }＋按鈕左右 padding 40px */

/* 結果卡 */
.card-result .card-details .detail-item:first-child .detail-value { font-size: 30px; font-weight: 800; line-height: 1.1; color: #111827; }
.card-result.best-card { background: #fff; border: 2px solid #10b981; box-shadow: none; }
.card-result.best-card .card-details .detail-item:first-child .detail-value { color: #047857; }
.card-result .card-detail-peek-btn, .card-result .pin-btn { background: #fff; border: 1px solid #e5e7eb; color: #4b5563; }
/* 卡面縮圖：示意時是用 JS 把 <img src="assets/images/cards/<card.id>.png"> 插到 .card-name 最前面（高 34px、寬上限 54px、object-fit: contain）。
   正式做要改 js/results-display.js 的結果卡 HTML，屬於「改顯示邏輯」，要跑回歸 */

/* 快捷膠囊 */
.quick-search-btn { color: #374151; border-color: #e5e7eb; border-radius: 8px; }
```

### 3.3 正式實作時要一併處理的事

- **這些規則的斷點與順序**：`styles.css` 最後有三個「桌機密度調整」區塊（≥1025px，ui-display.md 第 1g 節），靠「同特異性、源碼在後」取勝；header／頁籤的 padding、margin 在那裡被覆寫過（頁籤 `margin: 12px -20px -10px` 與 header `padding: 10px 20px` 是耦合的）。新規則要嘛寫在密度區塊之前並同步改密度區塊的值，要嘛整組一起改，不能只蓋一邊
- **embed 模式**（`html.pmc-embed`，promos 的詳情 iframe）有自己的 body／container 覆寫，改完要開 `/promos` 點一張卡的詳情確認
- **頁尾字色**：`.data-update-footer`、`.social-media-title` 目前的顏色是配灰底調過對比的，換白底／淺灰底要重看一次
- **共用 styles.css 的頁面**：faq／privacy／terms 也吃到 body 與 header 的規則；頁尾結構手抄在 4 頁＋promos 另一套（見 ui-display.md 教訓記錄 2026-10-21）
- **改了 index.html** → 跑 `node tools/build-merchant-pages.js`
- **卡面縮圖有直式卡**（遠東樂家+、匯豐 Live+ 等），不能假設都是橫式
- **禁用手法照舊**：不要用卡片頂部彩色條（ui-display.md 第 9 節）；卡片膠囊不要改等寬 grid（第 1b 節）
- 最優卡名稱旁加了縮圖後，「最優回饋」角標會擠到長卡名換行，要調 `.card-result.best-card .card-header` 預留的寬度

## 4. 用品牌 logo 的使用權（不是法律意見）

- **文字名稱**（寫「LINE Pay」「街口支付」）：單純指稱對方的服務，屬商標法的合理使用範圍，沒問題
- **圖形 logo**：灰色地帶。風險不高（比較網站普遍這樣用，本站已經在用的卡面圖性質相同），最壞情況通常是對方來信要求下架。
  但 logo 圖案本身有著作權，部分品牌的使用規範只開放給「接受該支付的商家」
- 要用的話：用官方原檔不改色不變形、尺寸小而一致、不暗示合作關係、頁尾加「各商標屬各該權利人所有」、收到要求就下架
- **第一批的建議**：先用中性線條圖示（錢包、票卡、商店、購物車），零風險，emoji 感一樣消失。logo 之後想加再加

## 5. Landing 該不該下架

### 5.1 數字

**到達網頁報表（過去 90 天，2026-11-15 截圖）**

| 到達網頁 | 工作階段 | 活躍使用者 | 新使用者 | 平均參與時間 |
|---|---|---|---|---|
| `/` | 6,804 | 1,957 | 1,274 | 29 秒 |
| `/landing` | 4,640 | 4,339 | 4,294 | 48 秒 |
| `/promos` | 562 | 476 | 452 | 46 秒 |
| `/merchant/蝦皮` | 278 | 269 | 266 | 17 秒 |

- Landing 帶進全部新用戶的 63%
- `/` 有 1,957 位用戶、其中 1,274 位是新用戶 → 回訪者最多 683 位。全算在 landing 頭上，回訪率上限也只有約 16%
- 留下來的人是真的在用：`/` 平均每人 3.5 個工作階段
- 48 秒不能當「看懂了」的證據：那是整個工作階段的時間，包含點進工具之後

**站長既有的漏斗探索（區隔「landing進站」，日期 2026-05-30～08-19，開放式漏斗）**

| 步驟 | 使用者 | 佔步驟 1 |
|---|---|---|
| 進站 | 777 | 100% |
| 試算 | 289 | 37.2% |
| 看卡片詳情 | 79 | 10.2% |
| 點申辦 | 5 | 0.6% |

- 這就是要找的數字的雛形：**從 landing 進來的人，約 37% 試算過、63% 從來沒試算**
- 三個保留：日期是舊的（要改成近 90 天）；開著「開放式漏斗」；步驟間平均經過 6.5 小時，代表有一部分人是隔天以後才回來試算，「當場試算」的比例會比 37% 低
- **沒有乾淨的對照組**：商家頁一打開就自動試算（`build-merchant-pages.js` 的 `AMOUNT` 註解），`calculate_cashback` 幾乎人人都有，不能拿來比；
  直接落在 `/` 的新用戶是帶 `?start`／`?card` 連結進來的人，來意不同。所以 37% 本身無法判定是 landing 的問題還是流量本身的問題，**只有分流測試能回答**

### 5.2 判斷與建議

- 第一屏沒說這是什麼：標語是小灰字、畫面上沒有產品；右上角有「開始使用」，但畫面正中央的指示是「scroll」，全頁約 7,000px、7 個場景
- 這個工具打一個商家名稱、幾秒就看到答案，工具本身就是最好的 onboarding（站長 2026-11-16 同意這點）
- **不下架**：landing 保留為頁尾「Pick My Card 是什麼？」與社群連結的去處
- **待決定**：要不要取消「新訪客強制轉址」（`index.html` 首屏路由 script）。建議做 3–4 週對半分流再決定：
  新用戶約每天 48 位，每組約 650 人，看得出大差異。指標用「首次造訪 30 分鐘內 `calculate_cashback` 的比例」＋ 7 天回訪
- **Landing 第一屏的方向**（站長原本想從痛點共鳴開場，2026-11-16 表示可以往後移）：
  第一屏改成「一句話講這是什麼＋可以直接打字的搜尋框或 3 個範例＋一行數字（N 家銀行 N 張卡・每日更新）」，痛點場景移到第二屏。
  HeyMax、AwardWallet 的第一屏都是這個結構

### 5.3 埋點現況

- `landing.js` 沒有送任何自訂事件；「開始使用」（`/?start`）的點擊只能靠 `/` 的 page_view 間接看
- 工具端有 `calculate_cashback`、`view_card_detail`、`button_click`（申辦類）
- 分流測試需要新增：分組的 user property、landing CTA 點擊事件

## 教訓記錄

- [2026-11-16] 想拿商家頁當「不經 landing」的對照組比試算率 → 商家頁開頁就自動試算，`calculate_cashback` 不代表用戶主動操作 → 比較「主動試算」時排除商家頁，或改用 `view_card_detail`／回訪當指標
