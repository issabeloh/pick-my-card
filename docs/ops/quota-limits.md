# 外部 API、金鑰與免費額度總表

> 這份存在的理由：站長很常問「我會不會撞到上限／會不會被扣錢」。與其每次重新盤點，
> 這裡一次寫清楚**每個服務的金鑰叫什麼、住在哪、上限多少、撞到會怎樣、去哪裡看**。
> 盤點日期 2026-08-07。數字會過期，**額度數字一律以各家 dashboard 當下顯示為準**，
> 這份表的價值在「有哪些服務、風險是哪一種、去哪裡看」。

## 0. 先分清楚兩種風險（這是本檔的核心）

站長的擔心多半是「會不會被扣錢」，但這套系統裡**絕大多數服務撞到上限只會停擺、不會產生帳單**。
兩種風險的處理方式完全不同，別混在一起看：

| 風險類型 | 有哪些 | 該做的事 |
|---|---|---|
| 💸 **會產生帳單** | 只有 **Firebase**（Blaze 從量計費） | 設預算上限＋降低用量 |
| 🛑 **不會扣錢，但會突然停擺** | Cloudflare Pages builds、Jina、Clarity、Apps Script | 盯用量、留緩衝 |
| ✅ **兩者皆不會** | Gemini（免費版未綁帳單）、GA4、GSC、GitHub API | 不用管 |

**唯一需要持續注意的是 Firebase**，因為它是**唯一隨流量成長**的服務——其他全部是固定排程
（每天/每週跑幾次），用量算得出來、不會因為網站變紅而暴增。

---

## 1. 💸 Firebase（唯一有帳單風險）

- **方案**：Blaze（從量計費）。**已設 $20 USD/月 預算快訊**（2026-08-07 站長確認）
- ⚠️ **Google 的預算快訊只會寄信通知、不會自動停止服務**。要真的硬停必須另外接
  Cloud Billing budget + Pub/Sub + Cloud Function 去停用計費帳戶，目前沒做
- **金鑰**：Web `apiKey`（`AIzaSyCERYFst64lYgR07OnEk-aJPbg838R7nYA`）**公開設計、不是祕密**，
  硬編碼在 12 個 HTML 檔內（`index.html`、`faq.html`、`promos.html`、`landing.html`、
  `merchant/*.html` 6 個）＋ `apps-script/cards-export.gs` 的生成模板。安全靠 `firestore.rules`
  的 default-deny ＋ 網域限制，不是靠藏金鑰
- **兩個消耗來源**：
  - **Firestore 讀寫**：登入用戶才會打（`js/data-loader.js`、`js/auth-user-data.js`、
    `js/card-detail.js`）。`js/core-utils.js` 的 `cardLevelCache` 已在擋重複 getDoc
  - **Storage egress**：~~新戶活動宣傳圖~~ → **2026-08-07 已搬進 repo 走 Cloudflare，
    這條流量歸零**（見第 6 節）
- **去哪看**：Firebase Console → ⚙️ 專案設定 → 使用量與計費

## 2. 🛑 Cloudflare Pages — builds

- **限制**：免費方案 **500 builds/月**、同時 1 build。另有 build 分鐘數上限（數字以 dashboard 為準）
- **怎麼消耗的**：push 到 `main` 的**每個 commit 各觸發一次 build**
  - Apps Script 每日匯出：2026-07-20 起已改成**單一 commit／單一 build**（舊流程一次 4+ builds、
    每日匯出≈120+/月）
  - **日常開發 merge 也各算一次**——多個小 PR 分開 merge 比 squash 成一次更耗額度
- **撞到會怎樣**：部署停擺，**不會扣錢**（免費方案硬停）
- **去哪看**：Cloudflare Dashboard → Workers & Pages → 帳號用量
- **通知**：Cloudflare 有 Notifications（免費方案可用 email），Pages 有
  **build 成功/失敗**通知；但「build 額度快用完」這種**用量門檻通知，2026-08-07 查證時
  無法確認 Pages 免費方案有提供**（官方文件被 proxy 擋住無法直接讀）。
  → 實務做法：**每月到 dashboard 看一次**，並靠「squash merge、減少 commit 數」拉大緩衝

## 3. 🛑 Jina Reader（`r.jina.ai`）

- **金鑰**：`JINA_API_KEY`（Apps Script 指令碼屬性；`jina_` 開頭）
- **限制**：免費 **1,000 萬 tokens，一次性、不是每月重置**。每頁約 **5,000 tokens**
- **現有防護**：`1-監控清單` 的 `check_days` 欄（`watchlist-monitor.gs`，2026-07-31 加）
  —— 每天跑 7 列約 10 個月燒光；那幾列填 `7` 可拉到 5 年以上
- ⚠️ **要定期確認動態頁那幾列真的有填 `check_days`** ——這一欄決定額度撐 10 個月還是 5 年
- **撞到會怎樣**：429、監控抓不到頁，**不會扣錢**
- **去哪看**：Jina 的 API Key & Billing 頁（跑一次 `checkWatchlist` 後重整看數字掉多少）

## 4. 🛑 Microsoft Clarity

- **金鑰**：`CLARITY_API_TOKEN`（指令碼屬性）
- **限制**：**每專案每天 10 次 API 呼叫**（不分來源，**手動測試也算**）；資料只留 1–3 天
- **現有防護**：`CLARITY_LAST_SYNC_DATE` 指令碼屬性，**呼叫前擋、成功才記**
  （`pmc-analytics-sync.gs`）
- ⚠️ **撞到 429 = 整個專案當天被鎖**，只能等隔天，別再手動重跑
- **前端 project id**：`u1w7nqgag1`（公開，寫在各 HTML 的 Clarity tag）

## 5. 🛑 Apps Script（免費帳號）

- **限制**：單次執行 **6 分鐘**／觸發器總計 **90 分鐘/日**／`UrlFetchApp` **20,000 次/日**／
  MailApp 收件人 100/日
- **現況**：匯出約 10 餘次 HTTP 呼叫，遠低於上限
- ⚠️ **商家頁生成器**每頁多 2 次呼叫＋生成時間，**頁數長大時要留意 6 分鐘上限**
  （逼近時分批，或改用 git tree API 一次 commit）
- **其他指令碼屬性**：`GITHUB_TOKEN`、`GEMINI_API_KEY`、`CARDS_SPREADSHEET_ID`、
  `PROMOS_LAST_SIG`／`PROMOS_LAST_DATE`（後兩者是去重狀態，不是金鑰）

## 6. ✅ 確認安全、不用管的

| 服務 | 金鑰 | 為什麼不用擔心 |
|---|---|---|
| **Gemini** | `GEMINI_API_KEY`（指令碼屬性） | **免費版且未輸入帳單資訊 → 物理上不可能產生費用**，超額只回 429，`benefits-parser.gs` 已有退避重試。⚠️ **反面才是風險：哪天為了提高額度去綁了帳單，這把金鑰就變成沒有上限**，那時要去 Google Cloud Console 設預算 |
| **GA4 Data API** | 無（`AnalyticsData` 進階服務走指令碼 OAuth） | 沒有金鑰、沒有計費維度。property `505426795` |
| **Search Console** | 無（`ScriptApp.getOAuthToken()`） | 同上。站台 `sc-domain:pickmycard.app` |
| **GitHub API** | `GITHUB_TOKEN`（指令碼屬性） | 免費，認證後 5,000 次/小時；匯出用約 10 次 |
| **AdSense** | `ca-pub-3478658382505422`（公開，見 `ads.txt`） | 收入端，不是成本 |

---

## 7. 新戶活動宣傳圖：搬進 repo 的維護流程

2026-08-07 起，`gift_image_url` 指到的圖若**已搬進 repo**，前端會改指本地檔、
不再從 Firebase Storage 抓（省 Blaze egress）。

**白名單制**——名單在**兩個地方，改一個就要改另一個**：

| 位置 | 管什麼 | 常數名 |
|---|---|---|
| `js/core-utils.js` | 詳情頁的首刷禮圖 | `LOCAL_PROMO_IMAGES` / `localizePromoImageUrl()` |
| `apps-script/cards-export.gs` | `promos.html` 靜態頁的縮圖＋lightbox | `PMC_LOCAL_PROMO_IMAGES` / `pmcLocalizePromoImage_()` |

還有**第三個相關位置，但不需要逐張維護**：`promos.js` 的 `sanitizeImgUrl()`
（放行 `assets/images/promos/` 整個目錄，見下方教訓記錄）。

**為什麼是白名單而不是無條件改寫**：Sheets 之後新增的圖還沒搬進 repo，無條件改寫會指到
不存在的檔案，而 `<img onerror>` 會把圖**整個隱藏**——壞掉不會被發現。不在名單內的一律
原樣走 Firebase，所以「忘記搬新圖」最差只是沒省到流量，**畫面永遠不會出錯**。

**Sheets 新增一張宣傳圖後，要省流量就做這四步**：

1. 下載原圖到 `assets/images/promos/<原檔名>`（檔名**必須與 Firebase 上的完全一致**，含大小寫）
2. 檔名加進 `js/core-utils.js` 的 `LOCAL_PROMO_IMAGES`
3. 同一個檔名加進 `apps-script/cards-export.gs` 的 `PMC_LOCAL_PROMO_IMAGES`
4. ⚠️ **把整份 `cards-export.gs` 貼回 Google Sheets 的 Apps Script 專案**——否則下次匯出
   產生的 `promos.html` 會**退回 Firebase 網址**（repo 內的 `cards-export.gs` 只是備份副本）

不做也沒關係，只是那張圖繼續走 Firebase 計流量。

---

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）

- [2026-08-07] 盤點時發現 `gift_image_url` 有一筆
  `hsbc-liveplus-2026-7.jpg` **在 Firebase 上是 404**（回傳 JSON error，不是圖）→
  圖被刪掉但 Sheets 欄位沒清 → 前端靠 `onerror` 隱藏所以**沒人發現**。
  **新規則**：`onerror` 隱藏是防禦、不是正常狀態；宣傳圖換季時順手清掉 Sheets 裡的死連結
- [2026-08-07] 把宣傳圖改成站內相對路徑後，`promos.html` **點縮圖沒反應**（lightbox 開不了）→
  `promos.js` 的 `sanitizeImgUrl()` 是 `^https?://` 白名單（鐵則 3 的 XSS 防護），相對路徑
  被判定不安全回傳空字串，`openLightbox()` 就直接 return →
  **新規則**：把任何原本是外部網址的欄位改成站內相對路徑時，**先 Grep 那條路徑上所有
  `sanitizeUrl`／`sanitize*` 關卡**。修法是**窄化放行**（限定目錄＋檔名字元＋副檔名），
  不是把守衛拿掉。另外這也證明**只驗證「圖片有載入」不夠——互動行為要真的點一次**：
  縮圖 10/10 正常顯示，壞掉的是點下去之後
- [2026-08-07] 擔心的方向與實際風險不符：站長擔心 Gemini（免費未綁帳單＝不可能扣錢），
  真正有帳單風險的是 Firebase Blaze（唯一隨流量成長）→ **新規則**：判斷風險先問兩件事——
  「這個服務會不會扣錢」與「用量是隨流量長、還是固定排程」，後者才是會失控的那種
