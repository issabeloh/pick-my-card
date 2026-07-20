# pmc-analytics-sync —— PMC 數據集中同步

Google Sheet「PMC數據集中」的 Apps Script 資料同步專案（跟 cards.data 那個「信用卡管理系統」
專案是**不同**的 Sheet／不同的 Apps Script 專案）。負責把外部分析平台的每日數據抓進同一本試算表，
由同一支排程主函數在一次執行裡依序呼叫 GA4 → GSC →（本次新增）Clarity，並在 `updateLog` 分頁記一行。

> 本檔的 GA4 / GSC 段落請以 Sheet 端實際專案為準（那部分程式不在此 repo）；以下 **Clarity** 段落
> 為本次新增，備份程式在同目錄 `pmc-analytics-sync.gs`。

---

## Microsoft Clarity 每日同步（2026-07-20 新增）

把 Microsoft Clarity 的頁面體驗指標（Rage/Dead click、Excessive Scroll、Scroll Depth、
Engagement Time、Traffic）每天抓一次、**累加**寫進「Clarity_每日」分頁。

### 為什麼要「每天累加、不覆蓋」

Clarity Data Export API **只給得到過去 1–3 天的資料，超過就永久拿不到**。所以同步策略是每天新增一列
（一頁一列），把歷史留在試算表裡；程式**只 append、不覆蓋**舊資料。

### ⚠️ 硬限制（超過會整個 Clarity 專案當天被鎖）

- **每個 Clarity 專案每天最多 10 次 API 呼叫**（不分來源，手動測試也算）
- 只能拿過去 1–3 天的資料，超過永久遺失 → 靠每天累加補齊歷史
- 單次請求最多 3 個 dimension、回傳最多 1000 筆、**不能分頁**（本站只有 3 頁，遠低於上限）

### 首次設定（只做一次）

1. 到 Clarity 專案 → **Settings → Data Export** 產生 API token
2. Apps Script → 齒輪「專案設定」→ **指令碼屬性** → 新增：

   | 指令碼屬性 | 值 | 說明 |
   |---|---|---|
   | `CLARITY_API_TOKEN` | 你的 Clarity API token | **絕不寫進程式碼**；程式用 `PropertiesService.getScriptProperties().getProperty('CLARITY_API_TOKEN')` 讀 |
   | `CLARITY_LAST_SYNC_DATE` | （不用手動建） | 程式自動維護：記錄最後一次「成功同步」的日期，供防重複呼叫判斷 |

3. 把 `pmc-analytics-sync.gs` 的內容貼進 Apps Script 專案，並**接進現有排程主函數**（見下）。

### 接進現有排程（跟 GA4 / GSC 同一次執行）

在跟 GA4 / GSC 同一支排程主函數的結尾、寫 `updateLog` 那行之前：

```js
var clarityResult = syncClarityData();
// 把原本「已更新 GA4 + GSC 資料」那行改成把 Clarity 狀態接上：
//   logMsg = '已更新 GA4 + GSC 資料；' + clarityResult.message;
```

`syncClarityData()` 自己不寫 `updateLog`（交給排程主函數統一寫，格式才一致），回傳
`{ ok, skipped, message, rowCount }`；`message` 已針對各情況寫好人話（見下）。

### 防重複呼叫保護（重點）

**呼叫 API 前**先比對指令碼屬性 `CLARITY_LAST_SYNC_DATE` 是否已經是今天（`Asia/Taipei`）：

- 是今天 → **直接跳過**、不打 API，log 記「今日已同步過，跳過以保護每日 10 次 API 額度」
- 只有在**成功寫入資料後**（或成功但今日無資料時）才把 `CLARITY_LAST_SYNC_DATE` 設成今天；
  中途失敗（token 缺、401、429、寫入例外）**不會**設，當天可再重試

這樣手動重跑排程／手動測試都不會重複扣當日 10 次額度。

### 寫入分頁「Clarity_每日」

分頁不存在時自動建立、自動補表頭並凍結首列。欄位順序：

| 日期 | 頁面(URL) | Rage Click Count | Dead Click Count | Excessive Scroll | Scroll Depth | Engagement Time | Traffic(工作階段數) |
|---|---|---|---|---|---|---|---|

每天每頁一列，只 append、不覆蓋。

### 錯誤處理（log 會講清楚原因，不是籠統「失敗」）

| 情況 | log 訊息重點 |
|---|---|
| 今日已同步 | 「今日（日期）已同步過，跳過以保護每日 10 次 API 額度」（`skipped=true`） |
| 缺 token | 「找不到指令碼屬性 CLARITY_API_TOKEN…」 |
| **401** | 「token 失效或錯誤（401 Unauthorized）——請確認指令碼屬性或重新產生 API token」 |
| **429** | 「超過每日 10 次 API 額度（429 Too Many Requests）——當日已用完，需等隔天恢復」 |
| 其他 HTTP | 「HTTP <code>：<回傳前 300 字>」 |
| 回傳非 JSON / 非 array | 明確標示格式問題 |
| 寫入分頁例外 | 明確標示是寫入「Clarity_每日」失敗 |

錯誤一律走 `console.error`（永遠輸出）；成功／跳過走 `console.log`。

### 手動測試提醒

手動跑 `syncClarityData()` **也會扣當日 10 次額度**。因為有 `CLARITY_LAST_SYNC_DATE` 防呆，
今天跑過一次成功後，同一天再手動跑會被跳過（不扣額度）；若要強制重測，先到指令碼屬性把
`CLARITY_LAST_SYNC_DATE` 刪掉或改成昨天——但請注意這會真的再打一次 API。
