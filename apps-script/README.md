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
| 監控清單 | 試算表分頁 `Watchlist`，第一列表頭必須是小寫：`card_id / bank / url / watch_type / css_selector / last_snapshot / last_checked / active` |
| 偵測結果 | 自動寫入分頁 `情報收件匣`（不存在會自動建立），並寄 Email 通知 |
| 通知信箱 | `MONITOR_CONFIG.notifyEmail` 留空 = 寄給試算表登入帳號 |

### 可調整的設定（都在程式最上方的 `MONITOR_CONFIG`）

- `keywords`：關鍵字閘門——變動段落須含至少一個才算事件
- `minDiffChars`：30，變動總字數低於此門檻視為雜訊
- `snapshotMaxChars`：45000，快照長度上限（Sheets 單格上限 5 萬字）

### 日常操作

- **新增監控對象**：Watchlist 加一列即可，不用改程式（last_snapshot 留空，首次執行會自動填基準快照且不通知）
- **暫停某個網址**：該列 active 改 `FALSE`
- **改執行頻率**：Apps Script → 觸發條件 → 編輯該觸發器（頻率不影響費用，全部免費）
- **手動跑一次**：編輯器上方函數選 `checkWatchlist` → Run

### 已知問題與排錯

- 錯誤「Watchlist 第一列必須有 url 與 last_snapshot」→ 表頭不在第 1 列、大小寫不對、或全形字，重打表頭即可
- 錯誤「抓到的正文太短」→ 該銀行是動態網頁（JS 載入），把該列 url 換成銀行「公告/最新消息列表頁」（規劃書 §2.4）
- 腳本執行失敗會依觸發器的 Failure notification 設定寄信通知
