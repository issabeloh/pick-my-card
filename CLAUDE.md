# Pick My Card - 信用卡回饋大師

幫助用戶比較信用卡回饋的 Web 應用（純前端靜態站＋Firebase，無 build 步驟）。

**本檔是路由版**：只放每次都要知道的「地圖、鐵則、路由表」。細節在 `docs/` 底下，**動手前先照
「任務路由表」讀對應檔案**——那些檔案裡有會讓你少踩一小時坑的具體規則。
（改本檔前必讀 `docs/ops/maintenance.md`；禁止在本檔用 `@` import 展開引用檔——那會把引用檔每次都塞進上下文，違背路由設計。）

## 專案地圖

| 檔案 | 內容 |
|---|---|
| `js/`（13 模組檔，2026-07-20 由 script.js 拆分） | 核心邏輯。**傳統全域 script 依 index.html 標籤順序載入（非 ES module，禁止改）**；每檔頂部有區塊目錄可 Grep。依載入順序：core-utils(工具/全域狀態)、data-loader(資料載入/快捷選項)、home-ui(Spotlight/公告/主初始化)、search-match(搜尋匹配)、cashback-engine(回饋計算)、results-display(結果顯示/placeholder/escapeHtml)、auth-user-data(登入/用戶資料)、cards-modals(側選單/卡片選擇/持有卡)、card-detail(詳情頁/CUBE/筆記)、spending-mappings(配卡表/免年費/額度/結帳日)、levels-payments(級別🔒/行動支付)、quick-options-misc(快捷管理/回報/auth modal/GA4)、dashboard(儀表板分頁，2026-07-24 新增) |
| `index.html` / `styles.css` | 主頁面／樣式（引用處有 `?v=` 快取版本號）；`merchant/*.html` 商家落地頁與 index.html 共用 js/、載入清單順序必須一致（preflight 會查） |
| `cards.data` / `cards.version` | 卡片資料（base64，由 Apps Script 生成）／其版本指標，**兩者必同步更新** |
| `faq.html` `faq.js` `faq.css` | FAQ 頁（獨立載入，不共用 js/ 模組；也引用 styles.css） |
| `landing.html` `landing.js` `landing.css` | 到達頁 |
| `promos.html` `promos.js` `promos.css` | 新戶活動一覽頁（SEO／社群入口，糖果果凍風；HTML 由 Apps Script 匯出時生成，見 data-pipeline.md 第 9 節，repo 版只是初版備份，別手改卡片內容） |
| `firestore.rules` | Firestore 安全規則唯一正確版本（套用教學：`FIRESTORE-RULES-README.md`） |
| `apps-script/` | Apps Script 備份（`cards-export.gs`＝主匯出程式 exportToJSON 的備份副本；⚠️ 實際執行版在 Google Sheets，改匯出邏輯兩邊必同步） |
| `assets/images/cards/<card.id>.png` | 卡片圖（缺圖自動隱藏；橫式 800×500 規範） |
| `docs/project/` `docs/ops/` | 領域知識文件／工作制度文件（見路由表） |
| `tools/preflight.sh`、`tools/cards-query.sh`、`tools/deploy-version.sh` | 部署前機械檢查／cards.data 查詢／部署時注入 `?v=`（CF Pages build command 執行，開發不用跑） |

資料流：Google Sheets → Apps Script `exportToJSON()` → `cards.data`(base64) ＋ `cards.version` → 前端。

## 部署前必做（每次改動，不是選填）

1. `?v=` 一律是 `dev` 佔位、**任何情況都不要手動 bump**（2026-07-21 起版本號由 Cloudflare Pages 部署時執行 `tools/deploy-version.sh` 注入 commit hash；repo 內出現時間戳＝違規，preflight 會擋）
2. 改了 `cards.data` → 同步改 `cards.version`（任何不同短字串，建議 `YYYYMMDD-N`）
3. commit 前跑 `bash tools/preflight.sh`——上面兩條＋禁用模式它都會機械檢查，**輸出要貼進回報**
4. 改了計算/搜尋/顯示邏輯 → 跑自動化回歸：`node tools/regression/run-regression.js`（先 `npm install playwright --no-fund --no-audit --loglevel=error`；改動**前**先跑一次確認綠燈。差異→exit 1；語義與基準規則見 `docs/ops/regression.md`）

## 鐵則（違反＝bug 或資料事故；詳細說明在括號內的檔案）

1. 🔒 **絕不擅自覆寫用戶已存的級別**：`saveCardLevel()` 只有兩個合法呼叫場景——用戶親自點選、大小寫/空格正規化。「存的級別找不到」時用預設值**顯示**可以，**存回去**絕對不行（→ `docs/project/storage-and-security.md` 第 2 節，這是本專案最高等級鐵則）
2. **localStorage 一律走 `readLocalJSON()`/`readLocalJSONArray()`**，禁止直接 `JSON.parse(localStorage.getItem(...))`（→ storage-and-security.md 第 1 節）
3. **動態 innerHTML 一律 `escapeHtml()`、動態 href 一律 `sanitizeUrl()`**；唯二例外（公告 fullText、FAQ answer）有註解標明（→ storage-and-security.md 第 6 節）
4. **空陣列不是 falsy**：判斷 specialItems 要 `!card.specialItems || card.specialItems.length === 0`
5. **placeholder 解析必傳 levelSettings**，傳 null 會解析成 0（→ `docs/project/cashback-engine.md` 第 1 節）
6. **級別名稱字串＝識別碼**，改名會讓用戶偏好對不上；能不改就不改（→ `docs/project/data-pipeline.md` 第 6 節）
7. **Apps Script 匯出 guard 禁用 `if (rate && items)`**——會把 rate=0 的槽整組丟掉（→ data-pipeline.md 第 4 節）
8. 錯誤處理用 `console.error`（永遠輸出）；`console.log/warn` 正式環境被靜音（`?debug=1` 開啟）
9. 登出清理 `clearPersonalLocalDataOnSignOut()` 只能在用戶親自按登出時呼叫，不能進 onAuthStateChanged 登出分支（→ storage-and-security.md 第 5 節）

## 大檔案使用規則（防上下文塞爆，依據見 docs/ops/diagnosis.md）

- `js/*.js`（13 檔，單檔 565–1,530 行）：先照專案地圖挑對模組檔，Grep 該檔頂部區塊目錄關鍵字（如 "Placeholder 解析"、"wallet stack"、"我的額度相關功能"）拿行號，再 Read 指定 offset/limit（一次 ≤200 行）；不確定在哪檔就 `Grep path=js/` 全模組搜。舊文件裡的 `script.js:行號` 引用＝拆分前快照，一律用 Grep 關鍵字重新定位
- `cards.data`（488KB base64 單行）：**永遠不 Read**。查內容：`bash tools/cards-query.sh '<jq 運算式>'`（自動解碼＋截斷長輸出）
- `styles.css`（7,300 行）/ `index.html`（1,350 行）：同樣先 Grep 再讀區段
- 廣度未知的搜尋（不確定在哪幾個檔）→ 派 `Explore` subagent，主對話只收結論＋檔案:行號（→ `docs/ops/dispatch.md`）
- `docs/project/` 領域檔：先 `grep -n '^## ' <檔>` 看節標題＋行號，**只讀與任務相關的節**（鐵則括號裡的「第 N 節」即節編號）；教訓記錄區一律連帶讀
- 文件裡的行號都是快照、會漂移：**以 Grep 關鍵字為準**，行號只當起點

## 任務路由表（動手前先讀對應檔）

| 任務類型 | 必讀 |
|---|---|
| 改搜尋/回饋計算/匹配（calculateCashback、cashbackModel、placeholder、停車） | `docs/project/cashback-engine.md` |
| 改顯示/UI（詳情頁、Spotlight、我的信用卡、各 modal、卡圖） | `docs/project/ui-display.md` |
| 改儀表板分頁（#dashboard 視圖、個人資料彙整、Phase 2/3 續作） | `docs/project/dashboard.md` |
| 改資料（Google Sheets、Apps Script、cards.data、級別設定、新工作表） | `docs/project/data-pipeline.md` |
| 改用戶資料/登入登出/localStorage/Firestore/XSS 相關 | `docs/project/storage-and-security.md` |
| 任何多步驟任務開工前（派工、選模型、subagent） | `docs/ops/dispatch.md` |
| 拿不準「該不該升級/算不算完成/要不要問用戶/方向對不對」 | `docs/ops/judgment.md` |
| 要寫派工 prompt | `docs/ops/templates.md`（直接套模板填空） |
| 要更新任何 docs/ 制度檔或本檔 | `docs/ops/maintenance.md` |
| 安全掃描報錯、要改掃描規則或 security-baseline | `docs/ops/security-monitoring.md` |
| 考古「為什麼當初這樣設計」 | `docs/project/history.md` |
| 新 session 開工、或發現制度怪怪的 | `docs/ops/letter.md` |

其他既有文件：`CARDS-DATA-CACHE-README.md`（快取教學）、`FIRESTORE-RULES-README.md`、`FAQ-README.md`、`BENEFITS-AUTOMATION-PLAN.md`＋`apps-script/README.md`（權益監控）。

## 環境事實（remote session 必知）

- 這是**短命容器**：session 結束即回收。**沒 commit+push 的工作等於沒發生**——每完成一個獨立單位就 commit+push
- 無自動化測試：品質底線靠 `tools/preflight.sh` ＋ `docs/ops/regression.md` 人工回歸
- Chromium/Playwright 已預裝（executablePath `/opt/pw-browsers/chromium`），本機驗證可起 `python3 -m http.server`
- `.claude/agents/` 有專案自訂 subagent（scout/builder/verifier），用法見 `docs/ops/dispatch.md`

---
**更新日期**：2026-07-20（script.js 模組化拆分 session；改寫前版本在 `docs/archive/CLAUDE.md-2026-07-20.bak`）
