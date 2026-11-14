# Pick My Card - 信用卡回饋大師

幫助用戶比較信用卡回饋的 Web 應用（純前端靜態站＋Firebase，無 build 步驟）。

**本檔是路由版**：只放每次都要知道的「地圖、鐵則、路由表」。細節在 `docs/` 底下，**動手前先照
「任務路由表」讀對應檔案**——那些檔案裡有會讓你少踩一小時坑的具體規則。
（改本檔前必讀 `docs/ops/maintenance.md`；禁止在本檔用 `@` import 展開引用檔——那會把引用檔每次都塞進上下文，違背路由設計。）

## 專案地圖

| 檔案 | 內容 |
|---|---|
| `js/`（13 模組檔，2026-07-20 由 script.js 拆分；第 13 支 mappings-page 2026-09-28 新增） | 核心邏輯。**傳統全域 script 依 index.html 標籤順序載入（非 ES module，禁止改）**；每檔頂部有區塊目錄可 Grep。依載入順序：core-utils(工具/全域狀態)、data-loader(資料載入/快捷選項)、home-ui(Spotlight/公告/主初始化)、search-match(搜尋匹配)、cashback-engine(回饋計算)、results-display(結果顯示/placeholder/escapeHtml)、auth-user-data(登入/用戶資料)、cards-modals(側選單/卡片選擇/持有卡)、card-detail(詳情頁/CUBE/筆記)、spending-mappings(配卡表/免年費/額度/結帳日)、levels-payments(級別🔒/行動支付)、quick-options-misc(快捷管理/回報/auth modal/GA4)、mappings-page(我的配卡組合完整頁面/存成圖片，網址 /mappings) |
| `js/micropayment-brands.js` ／ `data/nccc/` | NCCC 小額支付品牌清單（2026-11-13）。前者是**生成檔、禁止手改**（不算在上面 13 支模組裡，但同樣要掛在 index.html）；改品牌、級別、別名 → 改 `data/nccc/brand-map.csv` 後跑 `node tools/build-nccc-brands.js`。每週由 `.github/workflows/nccc-refresh.yml` 檢查聯卡中心名單、有更新開 PR。全貌見 `data/nccc/README.md` |
| `index.html` / `styles.css` | 主頁面／樣式（引用處有 `?v=` 快取版本號）；`merchant/*.html` 商家落地頁**由 `tools/build-merchant-pages.js` 從 index.html 生成、禁止手改**（改版面改 index.html，改文案改 Sheets 的 MerchantPages 工作表；見 data-pipeline.md 第 11 節）。⚠️ index.html 裡的 `<nav class="mc-related">`（推薦比較工具列）**內容也是同一支生成器產的、同樣禁止手改**——index.html 因此既是模板也是輸出 |
| `cards.data` / `cards.version` | 卡片資料（base64，由 Apps Script 生成）／其版本指標，**兩者必同步更新** |
| `faq.html` `faq.js` `faq.css` | FAQ 頁（獨立載入，不共用 js/ 模組；也引用 styles.css） |
| `landing.html` `landing.js` `landing.css` | 到達頁 |
| `promos.html` `promos.js` `promos.css` | 新戶活動一覽頁（SEO／社群入口，糖果果凍風；HTML 由 Apps Script 匯出時生成，見 data-pipeline.md 第 9 節，repo 版只是初版備份，別手改卡片內容） |
| `privacy.html` `privacy.css` `terms.html` | 隱私權政策／使用須知與免責聲明（兩頁共用 `privacy.css` 的 `pp-*` 版面，都刻意零 JavaScript）。`terms.html` 是免責聲明與資料收錄原則的**唯一正本**（2026-09-02 起；首頁那份重複的折疊區同日移除）。改文案只改這裡 |
| `_redirects` | Cloudflare Pages 改寫規則：`/mappings` → 首頁（配卡組合頁；`_headers` 對它設 noindex） |
| `_headers` | Cloudflare Pages 讀的回應標頭設定（安全標頭）。⚠️ CSP 在 `-Report-Only` 觀察模式（轉正條件見檔內註解）；HSTS 已上到一年，**日後新增任何用瀏覽器開的子網域前必讀該條註解**（沒有 HTTPS 會直接連不上且無回報） |
| `firestore.rules` | Firestore 安全規則唯一正確版本（套用教學：`FIRESTORE-RULES-README.md`） |
| `apps-script/` | Apps Script 備份（`cards-export.gs`＝主匯出程式 exportToJSON 的備份副本；⚠️ 實際執行版在 Google Sheets，改匯出邏輯兩邊必同步） |
| `functions/` | Firebase Cloud Functions（`dailyFeedbackDigest` 每日回饋摘要；`sendLoginLink` 寄 Email 連結登入信；`guardSignup`／`guardEmails` 註冊與寄信把關）；需 Blaze 方案，部署與參數設定見 `functions/README.md`。前端不引用它，改前端不用動這裡 |
| `assets/images/cards/<card.id>.png` | 卡片圖（缺圖自動隱藏；橫式 800×500 規範） |
| `docs/project/` `docs/ops/` | 領域知識文件／工作制度文件（見路由表） |
| `tools/preflight.sh`、`tools/cards-query.sh`、`tools/deploy-version.sh`、`tools/build-merchant-pages.js`、`tools/build-promos-features.js`、`tools/build-promos-page.js` | 部署前機械檢查／cards.data 查詢／部署時注入 `?v=`／商家頁生成／**promos 卡片特色注入**（部署時；用 vm 載入 `js/` 跑真 `getDisplayRate()`，見 data-pipeline.md 第 9a 節）／**本機重生 promos.html**（改了 `cards-export.gs` 的生成邏輯後用它看結果）。`deploy-version.sh` 與 `build-promos-features.js` 由 CF Pages build command 執行，開發不用跑。**`build-merchant-pages.js` 在改了 `index.html` 之後要自己跑**（見「部署前必做」第 5 條）；改了 `js/` 另跑 `--verify` |

資料流：Google Sheets → Apps Script `exportToJSON()` → `cards.data`(base64) ＋ `cards.version` → 前端。

## 部署前必做（每次改動，不是選填）

1. `?v=` 一律是 `dev` 佔位、**任何情況都不要手動 bump**（2026-07-21 起版本號由 Cloudflare Pages 部署時執行 `tools/deploy-version.sh` 注入 commit hash；repo 內出現時間戳＝違規，preflight 會擋）
2. 改了 `cards.data` → 同步改 `cards.version`（任何不同短字串，建議 `YYYYMMDD-N`）
3. commit 前跑 `bash tools/preflight.sh`——上面兩條＋禁用模式它都會機械檢查，**輸出要貼進回報**
4. 改了計算/搜尋/顯示邏輯 → 跑自動化回歸：`node tools/regression/run-regression.js`（playwright 用環境預裝的，**不必 npm install**；改動**前**先跑一次確認綠燈。差異→exit 1）。**資料與時鐘都凍結**（讀 `tools/regression/fixture.data`，不讀線上 cards.data），所以改 `cards.data` 不會讓回歸變紅、也不需要重拍基準；任何差異都代表程式行為變了。語義與凍結資料的重拍時機見 `docs/ops/regression.md`。改了配卡組合頁（`js/mappings-page.js`、配卡載存）→ 另跑 `node tools/regression/mappings-page-test.js`；改了詳情頁回饋卡（`renderRateCard()`、`js/results-display.js` 的「回饋卡共用片段」）→ 另跑 `node tools/regression/card-detail-test.js`
5. 改了 `index.html` → 跑 `node tools/build-merchant-pages.js` 重新生成商家頁，生成結果一起 commit。preflight 顯示「⚠️ 卡片清單落後 cards.data」是資料匯出造成的落後，部署時會自動重生，**不用處理**；顯示「❌ 版面不一致」才要重新生成
6. 收尾串成一個指令：`bash tools/preflight.sh && git add -A && git commit … && git push -u origin <分支>`，不要拆成三、四次呼叫

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

## Session 成本規則（依據：2026-11 審計，見 docs/ops/efficiency-review.md）

每個 request 都會重讀整個對話。對話越長，每一步越貴：上下文 10 萬 token 時每個工具呼叫約 $0.09，40 萬時約 $0.33。

- **互不相依的讀取與搜尋，同一輪平行發出**；同一個檔的多個區段寫進同一個指令（`sed -n 'a,bp;c,dp'`）。一次只看一個結果再決定下一步，只用在下一步真的取決於這個結果的時候
- **一個 session 一件事**。上一件事已 commit+push、用戶提出不相關的新任務，而這個 session 已經「長」了——已跨天、已超過約 150 次工具呼叫、或已收到成本提醒 hook 的提醒（任一成立；無法判斷是否跨天就只看後兩項） → 回覆開頭用一句話建議開新 session，並附 3–5 行交接 prompt（分支、已完成、待辦、必讀檔）。只提一次；用戶說繼續就繼續
- **長 session 裡的定位工作派 `scout`**（站長常設授權，不必先問）：需要 5 次以上搜尋或讀檔才找得到位置、且本 session 已符合上一條的「長」→ 派 scout，主對話只收結論＋檔案:行號。細節見 `docs/ops/dispatch.md` 第 1 節
- **成本提醒 hook**：`.claude/settings.json` 掛了 `tools/hooks/session-cost-reminder.py`。對話變長（約 30 萬 token 起）或停超過一小時再回來時，你會在用戶訊息旁收到一段「對話成本提醒」。照它的指示做：先用一句話告訴站長金額，需要動手的新任務先問要不要開新對話

## 大檔案使用規則（防上下文塞爆，依據見 docs/ops/diagnosis.md）

- `js/*.js`（13 檔，單檔 600–1,850 行）：先照專案地圖挑對模組檔，Grep 該檔頂部區塊目錄關鍵字（如 "Placeholder 解析"、"wallet stack"、"我的額度相關功能"）拿行號，再 Read 指定 offset/limit（單段 ≤400 行；這一步需要的區段一次讀齊，不要 30 行 30 行分次讀）；不確定在哪檔就 `Grep path=js/` 全模組搜。舊文件裡的 `script.js:行號` 引用＝拆分前快照，一律用 Grep 關鍵字重新定位
- `cards.data`（488KB base64 單行）與 `tools/regression/fixture.data`（回歸測試的凍結副本，同格式）：**永遠不 Read**。查內容：`bash tools/cards-query.sh '<jq 運算式>'`（自動解碼＋截斷長輸出）。jq 寫不出來的分析：`base64 -d cards.data > <scratchpad>/cards.json` 後用 python 處理，**解碼結果不得直接印到輸出**
- `styles.css`（11,100 行）/ `index.html`（1,750 行）：同樣先 Grep 再讀區段
- 廣度未知的搜尋（不確定在哪幾個檔）→ 派 `Explore` subagent，主對話只收結論＋檔案:行號（→ `docs/ops/dispatch.md`）
- `docs/project/` 領域檔：先 `grep -n '^## ' <檔>` 看節標題＋行號，**只讀與任務相關的節**（鐵則括號裡的「第 N 節」即節編號）；教訓記錄區一律連帶讀
- 文件裡的行號都是快照、會漂移：**以 Grep 關鍵字為準**，行號只當起點

## 任務路由表（動手前先讀對應檔）

| 任務類型 | 必讀 |
|---|---|
| 改搜尋/回饋計算/匹配（calculateCashback、cashbackModel、placeholder、停車） | `docs/project/cashback-engine.md` |
| **填**（不是改邏輯）某張卡的 cashbackModel／加碼欄位／骨幹槽 | `docs/project/cashbackmodel-fill-guide.md`（官網「回饋組成」句 → 欄位的填表範本） |
| 改顯示/UI（詳情頁、Spotlight、我的信用卡、我的配卡組合頁、各 modal、卡圖） | `docs/project/ui-display.md` |
| 改資料（Google Sheets、Apps Script、cards.data、級別設定、新工作表） | `docs/project/data-pipeline.md` |
| 改用戶資料/登入登出/localStorage/Firestore/XSS 相關 | `docs/project/storage-and-security.md` |
| 要派 subagent 時（選 agent、選模型、驗收分級） | `docs/ops/dispatch.md`（派工 prompt 模板在 `docs/ops/templates.md`） |
| 拿不準「該不該升級/算不算完成/要不要問用戶/方向對不對」 | `docs/ops/judgment.md` |
| 要更新任何 docs/ 制度檔或本檔 | `docs/ops/maintenance.md` |
| 安全掃描報錯、要改掃描規則或 security-baseline | `docs/ops/security-monitoring.md` |
| 考古「為什麼當初這樣設計」 | `docs/project/history.md` |
| 審計 token 使用效率、檢討規則檔有沒有用 | `docs/ops/efficiency-review.md`（照步驟跑 `tools/audit/`） |

其他既有文件：`CARDS-DATA-CACHE-README.md`（快取教學）、`FIRESTORE-RULES-README.md`、`FAQ-README.md`、`BENEFITS-AUTOMATION-PLAN.md`＋`apps-script/README.md`（權益監控）。

## 環境事實（remote session 必知）

- 這是**短命容器**：session 結束即回收。**沒 commit+push 的工作等於沒發生**——每完成一個獨立單位就 commit+push
- 品質底線：`tools/preflight.sh` ＋ `tools/regression/` 的自動化回歸（「部署前必做」第 4 條）；兩者不涵蓋的才照 `docs/ops/regression.md` 人工驗
- Chromium/Playwright 已預裝（executablePath `/opt/pw-browsers/chromium`），本機驗證可起 `python3 -m http.server`
- `.claude/agents/` 有專案自訂 subagent（scout/builder/verifier），用法見 `docs/ops/dispatch.md`
- **預覽部署只認 `preview/*` 分支**（站長的 Cloudflare Pages 設定；`claude/*` 工作分支推了**不會**有預覽）：要給站長看效果 → 從工作分支開或更新 `preview/<主題>` 並 push。需要真實資料時，請站長把 Apps Script `cards-export.gs` 的 `GITHUB_BRANCH` 暫時改成該 preview 分支再匯出，看完改回 `main`

---
**更新日期**：2026-11-12（效率審計後修訂；改寫前版本在 `docs/archive/CLAUDE.md-2026-11-12.bak`）
