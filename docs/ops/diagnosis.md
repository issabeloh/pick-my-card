# Harness 快速診斷（2026-07-11，Fable 5 立制 session）

> 本檔是後面所有制度檔的依據。三個問題按「每 session 浪費的 token × 出錯機率」排序。
> 所有數字都是 2026-07-11 實測，不是估計的形容詞。

## 第 1 名：CLAUDE.md 肥大 —— 每個 session 的固定稅

**證據**：改寫前的 CLAUDE.md 有 840 行、50KB（原檔備份在 `docs/archive/CLAUDE-2026-07-11-original.md`）。
每個 session 開場就要載入約 1.5–2 萬 tokens，其中大半是：

- 按日期排列的 changelog（「近期修改模式」11 條，多數與當下任務無關）
- 同一件事寫兩遍（Spotlight 在「關鍵技術概念 10」和「最近的技術決策」各一份；卡片圖片、詳情頁同樣重複）
- 敘事型歷史（「歷經多輪迭代定案」「曾因層級太低被卡蓋住」）——對理解現狀有幫助，但不需要每次載入

**為什麼對弱模型更致命**：20 條真正的鐵則（🔒 級別規則、?v= 更新、escapeHtml）被稀釋在 800 行敘事裡。
上下文被壓縮（summarization）後，弱模型記得的是「這專案有很多規則」而不是規則本身。

**修法**（本 session 已執行）：
1. CLAUDE.md 改為「路由版」：只放專案地圖、鐵則、任務路由表（詳見改寫後的 CLAUDE.md）
2. 細節抽到 `docs/project/` 四個領域檔，按任務類型「用到才讀」
3. changelog 整體搬到 `docs/project/history.md`
4. 行數預算寫進 `docs/ops/maintenance.md`：CLAUDE.md 超過 250 行就觸發精簡

## 第 2 名：直接讀大檔 —— 單次數萬到十幾萬 token 的地雷

**證據**（實測行數／大小）：

| 檔案 | 大小 | 全檔讀入約略成本 |
|---|---|---|
| `script.js` | 11,891 行 / 502KB | ~12 萬 tokens（直接爆掉可用視窗） |
| `cards.data` | 488KB base64 單行 blob | ~16 萬 tokens，且讀了也看不懂 |
| `styles.css` | 7,288 行 / 152KB | ~4 萬 tokens |
| `index.html` | 1,349 行 / 86KB | ~2 萬 tokens |

**典型出事路徑**：弱模型想「先了解 script.js 再改」→ Read 整檔或連續分段讀 → 上下文塞爆 →
harness 觸發壓縮 → 早期讀到的鐵則被壓掉 → 後半段開始犯 CLAUDE.md 明文禁止的錯。

**修法**（規則已寫進改寫後的 CLAUDE.md「大檔案使用規則」）：
1. `script.js` 永遠不整檔 Read。檔案頂部有區塊目錄：先 `Grep` 關鍵字（如 "Placeholder 解析"、"wallet stack"）拿到行號，再 `Read` 指定 offset/limit（一次 ≤200 行）
2. `cards.data` 永遠不 Read。要查資料內容：`base64 -d cards.data > <scratchpad>/cards.json` 之後用 `jq`/`grep` 查
3. 「廣度未知」的搜尋（不知道在哪幾個檔）一律派 `Explore` subagent，主對話只收結論＋檔案:行號——詳見 `docs/ops/dispatch.md`

## 第 3 名：部署鐵則靠散文記憶 —— 沒有機械驗證的必做步驟

**證據**：這個 repo 有三條「忘了做就會讓正式站出毛胚畫面／舊資料」的規則，全部只以文字存在：

1. 改 `script.js`/`styles.css` → `index.html` 的兩個 `?v=` 必須同步更新（改到 styles.css/faq.js 時 `faq.html` 也要）
2. 改 `cards.data` → `cards.version` 必須同步更新
3. 禁用模式：新程式碼直接寫 `JSON.parse(localStorage.getItem(...))`、動態 innerHTML 不過 `escapeHtml()`、非法呼叫 `saveCardLevel()`

既有的 `update-version.sh` 只會「執行」第 1 條的 index.html 部分（不檢查、不管 faq.html、不管 cards.version）。
長 session 尾端＋上下文壓縮後，弱模型忘記機率極高——這正是最不能靠記憶的環節。

**修法**（本 session 已執行）：
1. 新增 `tools/preflight.sh`：commit 前跑一次，機械檢查上述 1、2 與禁用模式，違規直接非零退出
2. 檢查規則寫在腳本裡而不是文件裡——文件會被壓縮遺忘，腳本每次跑都是全新的
3. CLAUDE.md 第一節就是「部署前必做」三行，並要求把 preflight 輸出貼進回報（防「跑了但沒看」）

## 次要問題（不到前三名，但制度檔已涵蓋）

- **自我驗證**：沒有自動化測試，歷史上靠人肉 12 組搜尋回歸。修法：`docs/ops/regression.md` 固化清單；驗收一律派 fresh-context agent（`docs/ops/dispatch.md`「驗證不自驗」）
- **短命容器**：這是 remote ephemeral 環境，**沒 commit+push 的東西 session 結束即消失**。修法：維護協議規定「教訓寫回檔案＝必須 commit+push 才算存在」
- **Apps Script 主匯出程式不在 repo**：`apps-script/` 只備份了 watchlist-monitor.gs，`exportToJSON()` 本體只存在 Google Sheets 裡。詳見 `docs/ops/letter.md` 第 2 件事

## 教訓記錄

（維護協議規定的追加區。格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
