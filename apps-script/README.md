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

## ⚠️ 兩檔架構（2026-07-17 分檔）

自動化的工作台從「信用卡管理系統」試算表**搬到獨立的「PMC 自動化流程」試算表**，兩本各司其職：

| 試算表 | 內容 | Apps Script |
|---|---|---|
| **資料檔**「信用卡管理系統」 | 卡片正式資料各分頁（Cards Data 等） | `cards-export.gs`（匯出／QA／promos.html／每月備份） |
| **自動化檔**「PMC 自動化流程」 | `Watchlist`／`情報收件匣`／`解析輸入`／`待審核-*` | `watchlist-monitor.gs`＋`benefits-parser.gs` |

- **為什麼分**：備份乾淨度（月備份不再打包一堆快照暫存垃圾）、安全邊界（AI 機器與正式資料物理隔離）、檔案不被大快照拖鈍。
- **唯一接縫**：解析程式要讀合法卡片 ID，用 `openById(CARDS_SPREADSHEET_ID)` 跨檔**唯讀**讀資料檔的 Cards Data，**絕不寫回**。第三階段「一鍵寫回正式表」也走這條接縫。
- **監控腳本不用改**：`checkWatchlist` 只碰 Watchlist／情報收件匣，兩者都在自動化檔，`getActiveSpreadsheet()` 就對。
- **觸發器**：每週的時間驅動觸發器要建在**自動化檔**的 Apps Script（舊資料檔那邊的要刪掉）。

## 權益解析（第二階段 MVP：新戶活動，2026-07-08 建置，2026-07-17 移入自動化檔）

| 項目 | 內容 |
|---|---|
| 程式檔案 | **自動化檔**的 Apps Script 內 `權益解析.gs`（備份：`benefits-parser.gs`） |
| AI | Gemini API（`gemini-2.5-flash`，免費額度），**結構化輸出**鎖死欄位格式 |
| 讀取來源 | ① `情報收件匣` 中狀態=`待解析` 的列（監控的產出）② `解析輸入` 分頁手動貼文字 |
| 卡片 ID 來源 | 跨檔 `openById` 讀資料檔的 `Cards Data`（唯讀） |
| 產出 | `待審核-新戶活動` 分頁（自動建立）——**絕不直接寫正式表** |
| 入口 | 自動化檔工具列「🤖 權益自動化」選單（打開試算表自動出現） |

### 首次設定（只做一次，在「PMC 自動化流程」自動化檔）

1. 到 https://aistudio.google.com/apikey 免費申請 Gemini API 金鑰
2. 自動化檔 → 擴充功能 → Apps Script → 齒輪「專案設定」→ 指令碼屬性 → 新增兩筆（**絕不寫進程式碼**）：
   - `GEMINI_API_KEY` = 你的 Gemini 金鑰
   - `CARDS_SPREADSHEET_ID` = 資料檔「信用卡管理系統」網址 `/spreadsheets/d/【這段】/edit` 的 ID
3. 把 `benefits-parser.gs` 貼進新檔案「權益解析」、`watchlist-monitor.gs` 貼進「權益監控」
4. 重新整理自動化檔 → 工具列出現「🤖 權益自動化」選單（本檔自帶 onOpen，此處無匯出選單可撞）

### 分頁搬遷步驟（一次性）

1. 在**資料檔**逐一右鍵這 4 個分頁 → 「複製到」→ 現有試算表 →「PMC 自動化流程」：
   `Watchlist`、`情報收件匣`、`解析輸入`、`待審核-新戶活動`
   （其中 **Watchlist 一定要搬**——它有網址與基準快照；其餘 3 個腳本會自動重建，但搬過去可保留歷史）
2. 複製過去會變成「Watchlist 的副本」等名字 → **改回原本的名字**（腳本靠分頁名字精準比對，多「的副本」會找不到）
3. 自動化檔手動跑一次 `checkWatchlist` 確認正常、跑一次解析確認能讀到卡片 ID
4. 確認無誤後：資料檔那邊**刪掉**這 4 個分頁與監控/解析程式、**刪掉舊的每週觸發器**；自動化檔**新建**每週觸發器（函數 `checkWatchlist`、Time-driven）

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
