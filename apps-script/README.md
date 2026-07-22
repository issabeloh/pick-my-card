# Apps Script 備份與運維紀錄

此資料夾存放 Google Sheets「信用卡管理系統」Apps Script 專案中的程式備份副本。
**實際執行的版本在 Google Sheets 裡**（試算表 → 擴充功能 → Apps Script），改動時兩邊請同步。

## 匯出主程式（`cards-export.gs`）

產出 `cards.data` / `cards.version` 並自動 commit 到 GitHub 的主程式，對應 Apps Script 專案裡
`exportToJSON()` 那支。**這是備份，改動請同步回 Google Sheets。**

- 主選單／主函數：`exportToJSON`（含 `runQACheck` 資料品質檢查）
- 2026-07-11 修正（過期活動不隱藏事件）：
  - **資料流事實**：`periodStart_N` / `periodEnd_N` 是維護者**輸入**的日期源頭；`period_N`
    是由它們**公式組出**的顯示字串（`YYYY/M/D~YYYY/M/D`）。
  - **事故根因**：匯出用 `headers.indexOf(欄名)` 按「完全相同的字串」找欄，`periodStart_2`
    這欄整欄讀不到（標題拼字／空格／大小寫／全形字元對不上，或欄名重複時 indexOf 只抓最前面
    那欄）→ 23 張卡的第 2 槽全部缺 `periodStart`（儲存格其實有值，公式照樣組得出完整字串），
    前端過期判斷拿不到開始日，把已過期活動當成永久有效顯示。
  - **修正 1**：`resolvePeriodBounds()` 統一決定日期範圍——優先讀輸入欄，某一邊讀不到時從
    `period_N` 字串拆回來救援。套用於 `cashbackRates` / `_hide` 隱藏槽 / `couponCashbacks` 三處。
  - **修正 2**：`runQACheck` 新增檢查 8（`periodEnd_N` 有值但 `periodStart_N` 讀不到；`period_N`
    與輸入日期對不上）與檢查 9（`periodStart/End_N` 欄位標題必須成對存在；欄位標題重複），
    匯出時直接在 QA 報告報警（⚠️ 警告，不擋匯出）。
  - **修正 3**：rate／coupon 槽位上限改由 `maxSlotIndex()` 依表頭自動偵測（原本寫死 `<= 21`，
    但表已加到 `rate_22`——slot 22 整槽被靜默丟棄、永遠不會匯出）。之後加 `rate_23` 等新欄
    不用改程式。
  - 前端 `script.js` 另有 `backfillPeriodBounds()` 當防呆，兩層互不衝突。
  - 事後對照維護者提供的完整表頭確認：事故元凶是 slot 2 的 `periodStart` 欄標題誤植成
    `periodStart_1`（重複欄名，indexOf 只抓最前面那欄），已由維護者修正。其餘 381 欄無重複、
    無空格／大小寫／全形問題。
- 2026-07-12 與線上版合併：
  - **保留維護者的修改**：`_hide`／`_hide_1` 專用隱藏槽處理移除（隱藏活動改用一般槽位 21/22
    配 `hideInDisplay_N=TRUE`，走主迴圈）；槽位上限手動改的 22 由 `maxSlotIndex()` 自動偵測取代。
  - **修正 coupon 兩個舊 bug**：日期欄原本巢狀在 `if (couponCap)` 內——沒設 cap 的 coupon
    日期整組不匯出（過期領券活動不會被隱藏，實測 7 筆中招）；且日期未過 `formatDateToISO`，
    Date 儲存格會序列化成 `"2026-06-29T16:00:00.000Z"` UTC 字串（前端字串比較會提早一天判過期）。
    現統一走 `resolvePeriodBounds`。
  - 依維護者要求，拿掉「`period_N` 欄漏建」QA 通知（保留成對檢查與重複欄名檢查——那兩種是
    「整欄資料靜默消失」等級，非簡單補欄）。
  - **移除 Drive 下載區塊**（`createDownloadUrl` / `TARGET_FOLDER_ID` / HTML 下載視窗）：
    `publishToGitHub` 已自動 commit cards.data + cards.version，下載連結只是每次匯出在
    Drive 堆兩個永不清理的檔案。匯出結果改用簡單 alert 顯示統計。歷史版本備份由 GitHub
    commit 紀錄承擔（cards.data 可解 base64 還原任何一次匯出）、原始資料備份由 Google
    Sheets 版本記錄承擔。
- 2026-07-20 審計修正（⚠️ **需把整份新版 `cards-export.gs` 貼回 Sheets 才生效**，
  貼回後跑一次「📥 匯出 JSON」，確認 GitHub 上該次匯出只有 `cards.version` 那個 commit
  沒有 `[CI Skip]` 前綴、且 Cloudflare Pages 只跑了一次 build）：
  - **匯出改為單一 build**（省 Cloudflare 免費額度，見下方「免費額度」節）：
    `publishToGitHub` 除最後一個 commit 外全部加 `[CI Skip]` 前綴，`cards.version`
    移到最後、獨自觸發唯一一次 build。順帶保證「版本號前進時新資料必已就緒」。
  - **匯出擋門檻 off-by-one**：`exportToJSON` 的 ❌ 計數原本多減 1（誤以為標題列會被
    數進去），恰好只有 1 個 ❌ 時會照樣放行匯出——已移除 `- 1`。
  - **QA 檢查 6 盲區**：「rate 有值但 items 空」原本只掃槽 1–5，槽 6+ 中招時整槽
    靜默消失且無警告。改為依表頭自動偵測上限；槽 1–5 維持 ❌ 擋匯出、槽 6+ 用 ⚠️
    警告不擋（避免舊資料突然全面擋死）。

## GA4 成效匯出（`ga4-metrics-export.gs`，2026-07-22 新增）

把 GA4 全站「分頁」成效指標撈進「PMC數據集中」試算表，給行銷部門討論用。搭配 landing.html
新加的 GA4 tag（同一 property `G-RW8F159L52`）——補 tag 前 /landing 在 GA4 完全無資料。

- 主函數：`updatePmcMetrics`（撈最近 28 天，維度＝日期×頁面路徑，每次重寫資料區）
- 指標：Sessions、Active users、New users、New users 佔比、Bounce rate、Engagement rate、
  平均參與時間（＝`userEngagementDuration ÷ activeUsers`）、Page views
- GA4 Property ID：`505426795`（寫在檔頭設定區；非 Measurement ID）
- 依賴：Apps Script 進階服務「Google Analytics Data API」（識別碼 `AnalyticsData`）＋
  GCP 專案啟用該 API＋執行帳號有 GA4 檢視權限（設定步驟見檔頭註解）
- 自動更新：跑一次 `createDailyTrigger()`（每天 08:00 台北時間）
- 檔尾註解含變體：累加保留歷史 / 全站彙總單列 / 只追 /landing 的改法

## 免費額度（2026-07-20 盤點；匯出流程設計須顧及）

| 服務 | 免費額度 | 本專案用量與注意點 |
|---|---|---|
| Cloudflare Pages | **500 builds/月**、同時 1 build | push 到 main 的**每個 commit 各觸發一次 build**。舊匯出流程一次 4+ commits＝4+ builds（每日匯出≈120+/月，一日多次匯出會逼近上限）；2026-07-20 起改單一 build。另外**日常開發 merge 到 main 也各算一次**——多個小 PR 分開 merge 比 squash 成一次更耗額度 |
| Apps Script（免費帳號） | 單次執行 6 分鐘；觸發器總計 90 分/日；UrlFetchApp 20,000 次/日；MailApp 收件人 100/日 | 匯出目前約 10 餘次 HTTP 呼叫、遠低於上限。**商家頁生成器上線後**每頁多 2 次呼叫＋生成時間，頁數多時留意 6 分鐘上限（逼近時分批或改用 git tree API 一次 commit） |
| Google Sheets 本體 | 單一試算表 1,000 萬儲存格 | 目前規模（數十卡×數百欄）差 3 個數量級以上；Apps Script 內建 `SpreadsheetApp` 不消耗 Sheets API 配額，無 API 額度問題 |

## promos.html 靜態生成（新戶活動一覽頁，2026-07-15 新增）

`exportToJSON()` 現在除了 `cards.data` / `cards.version`，還會多 commit 一個 `promos.html`
（給 SEO／社群轉貼用的「新戶活動一覽」落地頁，糖果果凍風 UI）。生成邏輯與資料流細節見
`docs/project/data-pipeline.md` 第 9 節，這裡只記站長要做的事與程式位置。

- **函數**：`generatePromosPageHtml(exportData)`（純函數，不呼叫任何 Sheets/Apps Script API），
  在 `exportToJSON()` 內讀完 `newCardholderPromos` / `cardApplyCtas` 後呼叫，回傳的 HTML
  字串跟著 `cards.data` 一起丟進 `publishToGitHub()`。
- **⚠️ 站長需要做的一次性動作**：這次 `cards-export.gs` 新增了 `generatePromosPageHtml`
  及其小工具函數（`pmc*` 開頭，含 `PMC_SITE_URL` 等常數）、並修改了 `exportToJSON()` 與
  `publishToGitHub()` 的呼叫方式——**必須把整份新版 `cards-export.gs` 貼回 Google Sheets
  的 Apps Script 專案，否則下次匯出不會產生 / 更新 `promos.html`**（Sheets 端會繼續執行舊版
  `publishToGitHub(encoded)`，只有一個參數，不會出錯，但也不會生成新戶活動頁）。
- **同步檢查方式**：在 Sheets 的 Apps Script 編輯器貼上後，執行一次「📥 匯出 JSON」，
  完成提示的訊息框最後一行應該會多一行「promos.html 已同步更新（... 筆活動中...）」；
  GitHub repo 的 commit 紀錄裡應該看到 `promos.html` 跟 `cards.data`/`cards.version` 同一次
  commit 一起更新。
- **repo 裡的 `promos.html` 只是初版備份**：由 scratchpad 臨時 Node harness 執行
  `generatePromosPageHtml()` 餵當時的 `cards.data` 產生，之後每次 Sheets 端匯出都會覆蓋成
  最新版本——**別在 repo 手改 `promos.html` 的卡片內容**，改了下次匯出照樣會被蓋掉；要調整
  版面/樣式改 `promos.css`，要調整互動邏輯改 `promos.js`（這兩個檔案不受生成流程管，可直接
  在 repo 改動、正常走 `tools/preflight.sh` 流程即可）。

## 每月自動備份（.xlsx 寄信，2026-07-12 新增）

Google Sheet 是唯一存放「原始資料全貌」的地方（公式、欄位結構、Watchlist/QA 等工作表），
cards.data 的 git 歷史只涵蓋匯出內容——這是備份鏈上唯一的 Google 帳號單點。每月自動把
整本試算表以 .xlsx 附件寄到信箱，收到後存到 Google 以外的位置即補上此缺口。

| 項目 | 內容 |
|---|---|
| 函數 | `sendBackupEmail`（寄一份）、`setupMonthlyBackupTrigger`（建立每月觸發器） |
| 選單 | 「📦 立即寄送試算表備份」「⏰ 啟用每月自動備份」 |
| 排程 | 每月 1 日 9–10 點（由 `setupMonthlyBackupTrigger` 建立；重跑會先清舊觸發器，不會重複寄） |
| 收件人 | `BACKUP_EMAIL` 常數留空 = 寄給試算表登入帳號（比照權益監控慣例） |
| 啟用步驟 | 貼上新版程式 → 選單「⏰ 啟用每月自動備份」跑一次（會要求授權寄信/觸發器權限）→ 可用「📦 立即寄送」先測試一封 |

## 權益解析（第二階段 MVP，2026-07-16 補上備份）

規劃見 `BENEFITS-AUTOMATION-PLAN.md` 第二階段。

| 項目 | 內容 |
|---|---|
| 程式檔案 | Apps Script 專案內的指令碼檔「權益解析」（備份：`benefits-parser.gs`） |
| 職責 | 讀「情報收件匣」或「解析輸入」分頁的活動原文，呼叫 Gemini 做結構化解析，寫入「待審核-新戶活動」分頁——AI 只做閱讀理解，promo_id／cap／bonus_rate 一律程式生成，絕不直接寫正式資料表 |
| 選單 | 「🤖 權益自動化」→「解析收件匣（新戶活動）」／「解析『解析輸入』的文字」 |
| 設定 | `PARSER_CONFIG`（各分頁名稱、`GEMINI_API_KEY` 指令碼屬性、model） |

## 權益監控（第一階段，2026-07-07 上線）

整體規劃見 repo 根目錄的 `BENEFITS-AUTOMATION-PLAN.md`。

| 項目 | 內容 |
|---|---|
| 程式檔案 | Apps Script 專案內的 `權益監控.gs`（備份：`watchlist-monitor.gs`） |
| 主函數 | `checkWatchlist`（觸發器叫醒的就是它） |
| 觸發器 | 時間驅動（Time-driven）→ Week timer，每週自動執行；設定位置：Apps Script 左側鬧鐘圖示「觸發條件」 |
| 監控清單 | 試算表分頁 `Watchlist`，第一列表頭必須是小寫：`card_id / bank / url / watch_type / css_selector / last_snapshot / last_checked / active / fetch_via / keywords / min_diff_chars` |
| 偵測結果 | 自動寫入分頁 `情報收件匣`（不存在會自動建立），並寄 Email 通知 |
| 通知信箱 | `MONITOR_CONFIG.notifyEmail` 留空 = 寄給試算表登入帳號 |

### 可調整的設定（都在程式最上方的 `MONITOR_CONFIG`）

- `keywords`：全域關鍵字閘門——變動段落須含至少一個才算事件
- `minDiffChars`：30，變動總字數低於此門檻視為雜訊
- `snapshotMaxChars`：45000，快照長度上限（Sheets 單格上限 5 萬字）

### Per-row 覆蓋（2026-07-08 加入，在 Watchlist 直接維護、不用改程式）

| 欄位 | 作用 | 填法 |
|---|---|---|
| `keywords` | 這一列專用關鍵字，覆蓋全域 | 逗號分隔（半形/全形逗號、頓號皆可）。公告標題頁填該行卡名，例：`永豐SPORT卡,夢行,幣倍` |
| `min_diff_chars` | 這一列專用雜訊門檻，覆蓋全域 30 | 公告標題頁填 `10`（一條新標題常見 15~30 字，30 會漏掉短標題） |

兩欄留空 = 沿用全域設定，舊列完全不受影響。

### 欄位注意事項

- `watch_type`、`css_selector` **目前程式不會讀**，只是備註／預留欄（css_selector 屬第二階段）
- `card_id` 填法：**權益頁**（一卡一頁）必須填 Cards Data 正式 id（第二階段靠它對資料）；**公告頁**（多卡共用一頁）填頁級標籤即可（例：`sinopac-news`），該是哪張卡由公告標題判讀
- 公告頁**一頁只填一列**，不要每張卡複製一列——同 URL 多列會重複抓取、同一變動寄多封通知

### 日常操作

- **新增監控對象**：Watchlist 加一列即可，不用改程式（last_snapshot 留空，首次執行會自動填基準快照且不通知）
- **暫停某個網址**：該列 active 改 `FALSE`
- **改執行頻率**：Apps Script → 觸發條件 → 編輯該觸發器（頻率不影響費用，全部免費）
- **手動跑一次**：編輯器上方函數選 `checkWatchlist` → Run

### 動態網頁／擋機器人的備援抓法（2026-07-08 新增）

直接抓失敗（正文太短或 HTTP 403）時，腳本會**自動改走 Jina Reader**
（`https://r.jina.ai/<原網址>`，免費服務，會用真的瀏覽器把 JS 動態網頁渲染完再回傳純文字）。

- Watchlist 新增選填欄位 `fetch_via`（加在 active 右邊，表頭小寫）：
  - 留空或 `auto`：先直接抓，失敗才走 Jina
  - `jina`：**一律走 Jina**——已知是動態網頁的銀行（cathay-cube、ubot 系列）建議填這個，
    避免「偶爾直接抓成功、偶爾走 Jina」兩種抓法的文字格式不同造成假警報
  - `direct`：一律直接抓，不用備援
- 把某列改成 `jina` 時，建議**順手清空該列的 last_snapshot**（兩種抓法的文字格式不同，
  清掉讓它重存基準快照，避免第一次跑出巨大假差異）
- Jina 免申請就能用（每分鐘額度較低，每週跑一輪綽綽有餘）；若之後監控數量大增碰到 429，
  到 https://jina.ai/reader 免費申請金鑰，存進「專案設定 → 指令碼屬性」`JINA_API_KEY`
- **Jina 也救不了的情況**：整頁都是圖片的活動頁（純文字監控看不到圖片裡的變化）——
  這種改監控該銀行的「公告/最新消息列表頁」，或用 Distill 瀏覽器擴充功能做視覺監控

### 已知問題與排錯

- 錯誤「Watchlist 第一列必須有 url 與 last_snapshot」→ 表頭不在第 1 列、大小寫不對、或全形字，重打表頭即可
- 錯誤「抓到的正文太短」→ 該銀行是動態網頁（JS 載入），該列 `fetch_via` 填 `jina`；仍失敗就把 url 換成銀行「公告/最新消息列表頁」（規劃書 §2.4）
- HTTP 403 → 該銀行擋非瀏覽器的請求，同上：`fetch_via` 填 `jina`
- 腳本執行失敗會依觸發器的 Failure notification 設定寄信通知

## 權益解析（第二階段 MVP：新戶活動，2026-07-08 建置）

| 項目 | 內容 |
|---|---|
| 程式檔案 | Apps Script 專案內的 `權益解析.gs`（備份：`benefits-parser.gs`） |
| AI | Gemini API（`gemini-2.5-flash`，免費額度），**結構化輸出**鎖死欄位格式 |
| 讀取來源 | ① `情報收件匣` 中狀態=`待解析` 的列（監控的產出）② `解析輸入` 分頁手動貼文字 |
| 產出 | `待審核-新戶活動` 分頁（自動建立）——**絕不直接寫正式表** |
| 入口 | 試算表工具列「🤖 權益自動化」選單（打開試算表自動出現） |

### 首次設定（只做一次）

1. 到 https://aistudio.google.com/apikey 免費申請 Gemini API 金鑰
2. Apps Script → 齒輪「專案設定」→ 指令碼屬性 → 新增 `GEMINI_API_KEY` = 你的金鑰（**絕不寫進程式碼**）
3. 把 `benefits-parser.gs` 內容貼進 Apps Script 專案的新檔案「權益解析」
4. **把選單掛到專案既有的 onOpen**：這份檔案「不」自帶 onOpen（一個專案只能有一個 onOpen，
   否則會蓋掉 `code.gs` 的匯出選單）。到你既有的 `code.gs`（有匯出選單的那個檔）的 `onOpen`
   函數裡，在結尾 `}` 前加一行 `buildAutomationMenu_();`
5. 重新整理試算表 → 匯出選單與「🤖 權益自動化」選單會**同時**出現

### 分工原則（為什麼比 GEM 準）

- **AI 只做閱讀理解**：輸出被 JSON Schema 鎖死的欄位（欄位名/型別/選項都不可能跑掉），
  每個數字必須附「原文引用」（evidence），不確定就標 `needs_review` + 想問的問題
- **程式做格式與數學**：promo_id 編號（撞號自動加 -1/-2）、cap 公式（`=200/0.07`）、
  bonus_rate 加 `%`、卡片 ID 清單直接從 `Cards Data` 動態讀取（不用維護對照表）

### 欄位規範（2026-07-09 對齊正式表更新）

待審核表「id」之後的欄位順序與正式新戶活動表一致：
`id / promo_id / promo_types / new_customer_definition / new_customer_summary / promo_condition /
period_start / period_end / gift_content / gift_image_url / bonus_rate / bonus_merchants / bonus_cap /
voucher_amount / voucher_usage / notes / link / priority / active / apply_cta_text / apply_cta_link / apply_cta_expiry`

- **promo_condition**（AI 填）：達成獎勵的任務，兩項以上用 ①②③ 編號逐項簡述、只有一項不編號；已寫這裡的任務不會再重複進 notes
- **new_customer_summary**（AI 填）：一句話「核卡後X天內＋最關鍵門檻＋獎勵」，細節在 promo_condition，summary 只點關鍵門檻
- **promo_types**：「贈品」一律改稱 **首刷禮**（enum 只有 首刷禮／回饋加碼／定額點數）
- **所有文字欄位不以句號結尾**（已寫進 prompt）
- **需你手動補的 4 欄**（AI 不碰，程式留空或給預設）：
  - `gift_image_url`：留空 → 你貼首刷禮的圖片網址
  - `apply_cta_text`：程式預設「申辦{卡名}」；你若透過連結有專屬首刷禮，改成「透過連結申辦，再享專屬首刷禮」
  - `apply_cta_link`：留空 → 你貼推薦連結
  - `apply_cta_expiry`：留空 → 你填連結到期日

### 審核流程

1. 收到「N 個新戶活動等你審核」的信 → 開 `待審核-新戶活動`
2. 黃底列 = AI 沒把握（看「AI想問的問題」欄），對照「原文引用」欄驗證數字
3. 確認 OK 後，把該列 **id 以後的欄位**（與正式表欄位一一對應）複製貼到正式的新戶活動表，「核准」欄打 V 做記錄
4. 之後的第三階段會做「勾核准 → 一鍵寫入」，這一步手動複製就消失
