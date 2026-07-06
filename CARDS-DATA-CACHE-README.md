# cards.data 快取機制 — 資料維護者必讀

## 運作原理

以前：每位使用者**每次進站**都強制重新下載整份 `cards.data`（約 485KB）。

現在：網站會先抓一個很小的 `cards.version` 檔（幾十 bytes、永遠不快取），
用裡面的版本字串當 `cards.data` 的網址參數（`cards.data?v=20260706-1`）：

- **版本沒變** → 瀏覽器直接用快取的 cards.data，幾乎零下載、載入更快
- **版本變了** → 網址變了，瀏覽器自動重新下載新資料，**立即生效**
- **cards.version 不存在/抓不到** → 自動回退成舊行為（每次重抓），功能不受影響

## ⚠️ 你要記住的唯一一件事

**每次更新 `cards.data`，同時更新 `cards.version` 的內容。**

`cards.version` 內容就是一個短字串，格式建議 `YYYYMMDD-N`（同一天第 N 次更新）：

```
20260706-1
```

只要跟上一次**不一樣**就有效（改成什麼都可以）。

### 忘記更新會怎樣？

不會壞。使用者最多延遲約 10 分鐘（GitHub Pages 的快取時效到期後，
瀏覽器會自動向伺服器確認檔案是否有變）才看到新資料。
但為了「更新立即生效」，請養成同步更新的習慣。

## 建議：讓 Apps Script 自動產生（一勞永逸）

在 Apps Script 的 `exportToJSON()` 裡，產生 `cards.data` 內容的地方，
順便產生版本字串一起顯示/輸出：

```javascript
// 在 exportToJSON() 的結尾附近加上：
const now = new Date();
const version = Utilities.formatDate(now, 'Asia/Taipei', 'yyyyMMdd-HHmmss');
// 把 version 跟 cards.data 內容一起輸出（例如寫到另一個輸出欄位或對話框），
// 上傳 cards.data 到 GitHub 時，同時把這個字串存成 cards.version 上傳
```

如果你是用 GitHub 網頁介面上傳 `cards.data`，流程變成：

1. Apps Script 匯出 → 下載/複製 `cards.data` 內容
2. GitHub 上傳新的 `cards.data`
3. 順手編輯 `cards.version`，改成新的版本字串（如 `20260713-1`）→ commit

兩個檔案在同一個 commit 或前後兩個 commit 都可以，順序不拘。
