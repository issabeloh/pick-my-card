# Apps Script 備份與運維紀錄

此資料夾存放 Google Sheets「信用卡管理系統」Apps Script 專案中的程式備份副本。
**實際執行的版本在 Google Sheets 裡**（試算表 → 擴充功能 → Apps Script），改動時兩邊請同步。

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
4. 重新整理試算表 → 工具列出現「🤖 權益自動化」選單
   （若專案其他檔案已有 `onOpen` 函數會相衝：把 `buildAutomationMenu_();` 那一行搬進既有的 onOpen，並刪掉本檔的 onOpen）

### 分工原則（為什麼比 GEM 準）

- **AI 只做閱讀理解**：輸出被 JSON Schema 鎖死的欄位（欄位名/型別/選項都不可能跑掉），
  每個數字必須附「原文引用」（evidence），不確定就標 `needs_review` + 想問的問題
- **程式做格式與數學**：promo_id 編號（撞號自動加 -1/-2）、cap 公式（`=200/0.07`）、
  bonus_rate 加 `%`、卡片 ID 清單直接從 `Cards Data` 動態讀取（不用維護對照表）

### 審核流程

1. 收到「N 個新戶活動等你審核」的信 → 開 `待審核-新戶活動`
2. 黃底列 = AI 沒把握（看「AI想問的問題」欄），對照「原文引用」欄驗證數字
3. 確認 OK 後，把該列 **id 以後的欄位**（與正式表欄位一一對應）複製貼到正式的新戶活動表，「核准」欄打 V 做記錄
4. 之後的第三階段會做「勾核准 → 一鍵寫入」，這一步手動複製就消失
