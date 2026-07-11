# Apps Script 備份與運維紀錄

此資料夾存放 Google Sheets「信用卡管理系統」Apps Script 專案中的程式備份副本。
**實際執行的版本在 Google Sheets 裡**（試算表 → 擴充功能 → Apps Script），改動時兩邊請同步。

## 匯出主程式（`cards-export.gs`）

產出 `cards.data` / `cards.version` 並自動 commit 到 GitHub 的主程式，對應 Apps Script 專案裡
`exportToJSON()` 那支。**這是備份，改動請同步回 Google Sheets。**

- 主選單／主函數：`exportToJSON`（含 `runQACheck` 資料品質檢查）
- 2026-07-11 修正：日期範圍改以 **`period_N` 合併字串（`YYYY/M/D~YYYY/M/D`）為單一真實來源**。
  試算表的 `periodStart_N` / `periodEnd_N` 是 `period_N` 的**公式衍生欄**，但開始日的公式在
  某些列算不出值（整欄空）；匯出若以公式欄為主，`periodStart` 就會缺席，前端過期判斷
  （`getRateStatus`）拿不到開始日，把已過期活動當成永久有效顯示。新增 `resolvePeriodBounds()`：
  優先從 `period` 字串拆出 `periodStart` / `periodEnd`，只有 `period` 沒填時（少數只填日期欄的
  活動，如 yushan 家樂福、cathay-cube 國內餐廳、firstbank 國外實體消費）才退回讀公式欄。
  套用於 `cashbackRates` / `_hide` 隱藏槽 / `couponCashbacks` 三處。**試算表不用改任何欄位或公式。**
  前端 `script.js` 另有 `backfillPeriodBounds()` 當防呆，兩層互不衝突。

## 權益監控（第一階段，2026-07-07 上線）

整體規劃見 repo 根目錄的 `BENEFITS-AUTOMATION-PLAN.md`。

| 項目 | 內容 |
|---|---|
| 程式檔案 | Apps Script 專案內的 `權益監控.gs`（備份：`watchlist-monitor.gs`） |
| 主函數 | `checkWatchlist`（觸發器叫醒的就是它） |
| 觸發器 | 時間驅動（Time-driven）→ Week timer，每週自動執行；設定位置：Apps Script 左側鬧鐘圖示「觸發條件」 |
| 監控清單 | 試算表分頁 `Watchlist`，第一列表頭必須是小寫：`card_id / bank / url / watch_type / css_selector / last_snapshot / last_checked / active / keywords / min_diff_chars` |
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

### 已知問題與排錯

- 錯誤「Watchlist 第一列必須有 url 與 last_snapshot」→ 表頭不在第 1 列、大小寫不對、或全形字，重打表頭即可
- 錯誤「抓到的正文太短」→ 該銀行是動態網頁（JS 載入），把該列 url 換成銀行「公告/最新消息列表頁」（規劃書 §2.4）
- 腳本執行失敗會依觸發器的 Failure notification 設定寄信通知
