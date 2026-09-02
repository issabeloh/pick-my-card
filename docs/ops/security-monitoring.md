# 安全監測制度（security monitoring）

> 2026-07-20 建立。三層防線：preflight（diff 級）→ security-scan（repo 級）→ GitHub Actions（持續監測）。
> 規則本體在 `docs/project/storage-and-security.md`；本檔只講「怎麼機械化監測那些規則」。

## 1. 三層防線分工

| 層 | 工具 | 掃描範圍 | 時機 |
|---|---|---|---|
| diff 級 | `tools/preflight.sh` 第 3 節 | 這次改動新增的行 | 每次 commit 前（會順帶呼叫第 2 層） |
| repo 級 | `tools/security-scan.sh` | 整個 repo 現狀 | preflight 內建＋可單獨跑 |
| 持續監測 | `.github/workflows/security-scan.yml` | 整個 repo 現狀 | 每次 push／PR＋每週一 09:00（台北）排程 |

## 2. security-scan 規則一覽

| 規則 | 級別 | 內容 | 依據 |
|---|---|---|---|
| SEC1 | ❌ | 直接 `JSON.parse(localStorage...)` | CLAUDE.md 鐵則 2 |
| SEC2 | ❌ | `eval` / `new Function` / `document.write` | 任意字串執行 |
| SEC3 | ❌ | 硬編碼密鑰模式（GitHub/Slack token、AWS key、私鑰檔頭） | 密鑰只住 PropertiesService／環境變數 |
| SEC4 | ❌ | `firestore.rules` 缺 default-deny 兜底、或出現 `allow ... if true` | storage-and-security.md 第 6 節 |
| SEC5 | ❌* | innerHTML 系（innerHTML/outerHTML/insertAdjacentHTML）當行含 `${}` 插值但沒 `escapeHtml`/`sanitizeUrl` | 鐵則 3 |
| SEC6 | ❌* | 動態 href（`href="${...}"` 或 `.href = 變數`）當行沒 `sanitizeUrl` | 鐵則 3 |
| SEC7 | ⚠️ | `target="_blank"` 缺 `rel="noopener"`（reverse tabnabbing） | 慣例 |
| SEC8 | ⚠️ | 非 TLS 的 `http://` 連結 | 慣例 |

❌* = baseline 比對制，見下節。

## 3. baseline 機制（`tools/security-baseline.txt`）

- SEC5/SEC6 是逐行啟發式，會抓到「上游已淨化、當行看不出來」的安全用法 → 這些條目經人工確認後住進 baseline，**每條必附「為什麼安全」的註解**
- 條目格式 `規則|檔案|該行 trim 後內容`：**行內容一變，條目自動失效**，改動處會重新被抓、逼一次重新確認——這是刻意設計，不是 bug
- 掃描會回報「過期條目」（程式碼已改掉但 baseline 還留著）→ 順手從 baseline 移除
- **目標是逐步清零**：修掉一處就刪一條；不允許「先塞 baseline 再說」——新增條目 = 人工確認過安全 + 寫了原因
- 已知侷限：跨多行 template literal 內部的插值掃不到（逐行掃描），靠 preflight 的 innerHTML diff ⚠️ ＋人工 review 補位

## 4. 2026-07-20 初次全 repo 稽核結論

**確認安全的面向**：無直接 `JSON.parse(localStorage)`；無 eval 系；無硬編碼密鑰（Apps Script 正確使用 PropertiesService；前端 Firebase apiKey 屬公開設計，安全靠 firestore.rules）；`firestore.rules` 為 default-deny、個人資料按 uid 隔離、feedback/reviews 只能 create 且有長度/型別驗證；HTML 檔內 `target="_blank"` 均有 noopener；無非 TLS 連結。

**發現並已於同日修復（severity 低，皆需管理者資料源或用戶自身輸入才可觸發）**：
1. 自訂快捷選項 `option.displayName`／`option.icon`（用戶輸入）未 `escapeHtml` 進 innerHTML —— `js/data-loader.js` createButton、`js/quick-options-misc.js` 三處 tag-name 模板（self-XSS 等級：僅存於該用戶自己的 localStorage/Firestore）
2. `applyCta.link`／`payment.website`（cards.data 管理者資料）只 `escapeHtml` 或直接賦值 `.href`，未過 `sanitizeUrl`——擋不住 `javascript:` scheme；防的是 Google Sheets 資料源被污染的供應鏈路徑 —— `js/results-display.js`、`js/home-ui.js` Spotlight、`js/levels-payments.js`
3. 回饋明細 popup 的 `layer.name`（cards.data）未轉義 —— `js/results-display.js`
4. `showErrorMessage()` 用 innerHTML 顯示 message（目前唯一呼叫端是靜態字串）—— `js/home-ui.js`

以上 4 項已全數修復（escapeHtml／sanitizeUrl／textContent），對應 baseline 條目已刪除；現存 baseline 皆為「上游已淨化」型安全條目。修復驗證：回歸 12/12 綠燈＋Playwright 冒煙測試（快捷按鈕渲染、行動支付官網連結）。

**未來可再加強（非本次範圍）**：（2026-09-02 更新——這兩項都已有結論，不必再重新評估）

- **CSP：已做，但不是 meta tag。**改用回應標頭（repo 根目錄 `_headers`，Cloudflare Pages 讀），因為 meta tag 表達不了 `frame-ancestors`。大量 inline script/style 的問題沒有消失，所以 `'unsafe-inline'` 保留——沒有 build 步驟就沒有 nonce；但把「可以載入程式的網域」鎖進白名單才是主要價值。**目前仍是 `-Report-Only` 觀察模式**，轉正條件與白名單來源寫在 `_headers` 檔內註解。
- **SRI：評估後判定做不到，不要再嘗試。**第三方是 GA、Clarity、Google Fonts、AdSense、Firebase SDK——全是供應商會自行更新的檔案，釘 hash 等於他們一改版本站就壞。唯一能做的是給 Google Fonts 那行補 `crossorigin`。
- **回應標頭是第四層防線**，不在上面那張三層分工表裡：它不進 security-scan（掃的是 repo 內容），驗證方式是部署後看 DevTools → Network → Doc → Response Headers。

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
- [2026-07-20] 初次稽核發現 `href` 只過 escapeHtml 就當安全 → escapeHtml 擋屬性逃逸但擋不住 `javascript:` scheme → 動態 href 一律 `sanitizeUrl()`，escapeHtml 不能替代（鐵則 3 的兩個函數各管各的）
