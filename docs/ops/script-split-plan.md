# script.js 模組化拆分計畫（2026-07-20 核准，待獨立 session 執行）

> 背景：站長核准「省 token 建議 4」——把 12,200 行的 script.js 拆成多個功能模組檔。
> 動機：(a) 省 token——拆後 Grep 命中更乾淨、讀窗更小；(b) 更好管理——改動範圍與檔案對應，降低改錯地方的機率。
> 這是**一整個專門 session 的工程**，不要和其他任務混做。

## 硬約束（開工前先確認自己理解）

1. **無 build 步驟**：拆出的檔案用多個 `<script>` 標籤依序載入，**保持傳統全域 script**——
   禁止改成 ES modules（`type="module"` 會改變執行時序與作用域，全站 inline onclick 依賴全域函數）
2. **宣告順序＝載入順序**：被依賴的（工具函數、全域狀態）先載入；拆分只搬動、不改寫任何函數內容
3. **`?v=` 快取機制必須涵蓋所有新檔**：`update-version.sh` 與 `tools/preflight.sh` 都要教會認得新檔（改 preflight 屬 🟡 級，改完做正反向測試）
4. **行為必須一模一樣**：驗收標準是 `node tools/regression/run-regression.js` 12 組全綠＋console error 0 條，與拆分前基準完全一致

## 建議流程（分階段，每階段獨立可回退）

1. 開工先跑 regression 確認綠燈基準；記下 `git rev-parse HEAD`
2. 讀 script.js 頂部區塊目錄，規劃拆分邊界（按既有區塊的自然分界，如：工具函數／資料載入／
   計算引擎／搜尋／各 modal UI／停車／權益）；先派 scout 盤點跨區塊的函數呼叫關係
3. 每階段搬 1–3 個區塊到 `js/<模組名>.js`，index.html 按依賴順序插入 `<script src="js/....js?v=...">`
4. 每階段收尾：`bash tools/preflight.sh` ＋ regression 全綠 → commit+push，才進下一階段
5. 全部完成後：每個新檔開頭放各自的區塊目錄；CLAUDE.md 專案地圖與大檔案規則更新（🟡 級）；
   docs/ 裡引用 `script.js:行號` 的地方不用逐一改——行號本來就以 Grep 為準

## 已知風險

- 函數提升（hoisting）跨檔失效：同檔內「先呼叫後宣告」合法，跨檔就不合法——拆分邊界要照依賴方向切
- `?v=` 漏掛新檔 → 正式站舊快取；靠 preflight 機械檢查兜底
- 拆分途中 session 中斷：因為每階段都 commit+push，從最後一個綠燈階段續做即可
