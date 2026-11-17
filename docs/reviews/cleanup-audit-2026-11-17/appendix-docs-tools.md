> 原始稽核報告（subagent 產出，2026-11-17）。主報告 `../cleanup-audit-2026-11-17.md` 已複核其中的重點項目；本檔其餘內容**未逐條複核**，動手前請先用 Grep 重新確認。行號是當日快照。

# 文件／註解／工具稽核（唯讀，2026-11-17）
腳本：scratchpad 下 toc.py / toc2.py（區塊目錄）、refs.py（反引號識別字）、usage.py（tools/ apps-script/ 被引用統計）。

## A. 會誤導模型（高）
1. 檔頭「載入順序 N/12」全 13 檔過時：core-utils.js:2 … quick-options-misc.js:2（"12/12"）、mappings-page.js:2（"13/13"）。實際 index.html:1303-1316 載入 14 支（含 micropayment-brands 第 2 支，模組檔 13 支）。quick-options-misc 標 12/12 但其後還有 mappings-page。core-utils.js:3 還寫「12 個模組檔」。
2. 「12 支／12 個模組」殘留：tools/build-promos-features.js:12、tools/lib/merchant-cards.js:5、docs/project/data-pipeline.md:772、docs/mockups/promos-2026-09/probe-highlights.js:6（實際 js/ 13 支，且 vm 載入還含 micropayment-brands）。
3. 行數範圍過時：CLAUDE.md:64、docs/ops/templates.md:13、.claude/agents/scout.md:14 都寫「單檔 600–1,850 行」；實際 665–2,228（home-ui 2228、results-display 1890、cashback-engine 1834、mappings-page 1813）。CLAUDE.md 另寫 styles.css 11,100 行（實 11,611）、index.html 1,750 行（實 1,826）、cards.data 488KB（實 830,340 bytes）。（wc -l / ls -l）
4. index.html:1321-1323 的註解（內聯 module script 說明）仍寫「script.js 的 DOMContentLoaded handler」「script.js 原本就用輪詢」——script.js 已不存在；此註解被複製進 merchant/*.html 全部商家頁（grep 命中 merchant/ 約 9 檔）。另 promos.js:932-933,964-965,994-997 引用 `script.js:6727-6772`、`script.js:1409-1430`（舊行號）。
5. 「12 組回歸」過時：tools/regression/README.md:3,53、docs/ops/templates.md:48、docs/ops/diagnosis.md:62；run-regression.js CHECKS（:40-55）現為 13 組。regression.md 標題寫「與腳本同步維護」。
6. ui-display.md:440 引用 `.mp-searchrow` 在 styles.css/js/index.html 查無（grep 0 命中）——「編輯模式」描述的 DOM 類名可能已改；同節 mpBuildDemo 是描述「已移除」，無害。
7. 區塊目錄「順序」與檔內實際順序不一致（內容都找得到，無 MISSING）：
   - auth-user-data.js：目錄把「刪除帳號」(實際 :998) 排在「Firebase 認證訂閱」(:49) 之前；
   - card-detail.js：目錄「近期異動」(:1206) 排在「CUBE」(:824) 前、「onclick 轉義」(:1252) 排在「詳情頁回饋卡 renderRateCard」(:1037) 前；
   - core-utils.js：「Modal 每次打開」(:99)排在「Body scroll lock」(:116)後、「過期活動過濾」(:558)排在「權益期限解析」(:537)前（輕微）；
   - home-ui.js：「亮點期限自動匹配」(:76) 在目錄排在 Spotlight(:95) 後；「主初始化 DOMContentLoaded」(:1118) 排在「公告列」(:1173) 後；
   - search-match.js：「排除項目同義詞群組」(:782) 排在「輸入建議下拉」(:1071) 後。
   順序錯不影響 Grep，但目錄不能當檔案結構地圖用。

## B. 區塊目錄逐檔結論（13 檔，Grep 關鍵字全部存在、無 MISSING）
- core-utils：一致（順序小差，見 A7）。目錄漏列但存在：Embed 模式 (:60 起)。
- data-loader：目錄 7 項皆在；漏列「信任列（2026-11-16）」(:642 banner)。
- home-ui：項目皆在；漏列「桌機空狀態：推薦活動放在搜尋框正下方」(:407, placeSpotlightSection/setupSpotlightPlacement)、「計算鈕提醒 calc-nudge」(:702, nudgeCalculateBtn)、compareSpotlightMerchant(:750)——合計約 340 行未入目錄；順序差見 A7。
- search-match：皆在；順序差見 A7。
- cashback-engine：一致（皆在、順序正確）。大區塊 calculateCardCashback (:963–1450，約 490 行) 目錄只有一行。
- results-display：皆在、順序一致。「新戶活動頁/詳情頁新戶區 renderCardDetailPromos(:1242)、createParkingBenefitElement(:1343)、createCouponResultElement(:1386)」未列於目錄細項（屬「停車/領券」附近）。
- auth-user-data：皆在；順序差 A7。
- cards-modals：一致。
- card-detail：皆在；順序差 A7；漏列 renderBasicExclusionsCard(:1103)、setupLevelHelpPopover(:1141)。
- spending-mappings：一致。
- levels-payments：一致。
- quick-options-misc：一致（皆在）。
- mappings-page：一致（9 項皆在）。
共通：所有檔頭序號分母過時（A1）。

## C. 文件引用識別字（refs.py，排除 archive 與 history.md；66 個「找不到」）
絕大多數是「描述已移除物」或非檔案（日期 2026/1/1、`x/y`、Firestore 路徑、環境路徑、gitignored 產物 last-run.json/search-compare-last.json 等）——不處理。真正過時／可能誤導：
- docs/ops/diagnosis.md:30,39,47,51（script.js 11,891 行、update-version.sh）、docs/ops/judgment.md:14（反例叫 builder「忘了跑 update-version.sh」——該腳本已刪，history.md:61）、docs/ops/script-split-plan.md:16（要求 update-version.sh 認得新檔）。diagnosis 標頭是「2026-07-11 快照」，但 judgment.md:14 是活規則裡的過時例子。
- docs/project/ui-display.md:440 `.mp-searchrow`（A6）。
- BENEFITS-AUTOMATION-PLAN.md:172-173 `parseCardBenefits()`/`parseNewPromo()`：實際函式為 apps-script/card-benefits-parser.gs 的 parseNewCard()(:114) 等；該檔是實施規劃書（程式碼範例 :316），非現況。
- apps-script/README.md:245 `ga4-metrics-export.gs`、:243 `projects/pmc-analytics-sync.md`（外部 vault）、:977 `appsscript.json`：前兩個明說已併入／在外部，無害。
- docs/project/storage-and-security.md:81-82 寫 `functions/guardSignup`／`functions/sendLoginLink`：實為 functions/index.js 匯出名（exports.guardSignup :37、sendLoginLink :63），無對應同名檔，可接受。
- docs/ops/letter.md:61 提到分支 claude/fable5-system-design-8qds6h（歷史，無害）。
- data/nccc/README.md:13 `../../js/micropayment-brands.js` 相對路徑，存在。
- CLAUDE.md 所有路徑（路由表、專案地圖）皆存在。

## D. CLAUDE.md 專案地圖 vs 實際
漏列（CLAUDE.md grep 0）：storage.rules（只在 FIRESTORE-RULES-README.md:86 與 storage-and-security 提）、firebase.json、.firebaserc、manifest.json、ads.txt、robots.txt、sitemap.xml、assets/brand/、assets/videos/、docs/mockups/、docs/reviews/、docs/ops/letter.md（路由表也沒有）、tools/activity-writer/、tools/apps-script-deploy/、tools/apps-script-tests/、tools/lib/、tools/check-card-banks.js／check-spotlights.js／check-cross-slot-refs.js（preflight 會跑）、tools/security-scan.sh、tools/build-logo-assets.js、tools/*-test.js（firestore-rules/feedback-digest/login-link/signup-guard/rate-limit-client）、tools/test-*.js（3 支）、.github/workflows 的 apps-script-deploy.yml 與 security-scan.yml（只提 nccc-refresh.yml 一處）、.claude/settings.json 的 hook（有提）。
其中最可能讓人改錯的：build-logo-assets.js（index.html:146、ui-display.md:330 說 logo 檔由它生成、不手改，CLAUDE.md 不提）；activity-writer/build-apps-script.js 生成 apps-script/ActivityWriter.html（preflight.sh:73 會檢查，CLAUDE.md 不提，手改會被擋）；apps-script-deploy 自動部署（改 apps-script/ 檔會推到線上 Apps Script，deploy.json 列的 8 檔；CLAUDE.md 只寫「兩邊必同步」，沒提 push 後會自動部署）。
CLAUDE.md:13 「js/（13 模組檔…）」正確；數字過時見 A3。CLAUDE.md:98 更新日期 2026-11-12，但內文提到 2026-11-13 的 NCCC（:14）→日期標記自相矛盾。

## E. tools/ 引用狀況（usage.py）
有 preflight/workflow/文件引用，正常：preflight.sh、deploy-version.sh、cards-query.sh、build-merchant-pages.js、build-promos-features.js、build-promos-page.js(CLAUDE.md+data-pipeline)、build-nccc-brands.js、nccc-refresh.sh(workflow)、security-scan.sh(workflow+preflight)、security-baseline.txt、check-card-banks/check-spotlights/check-cross-slot-refs（preflight）、lib/merchant-cards.js、hooks/session-cost-reminder.py(.claude/settings.json)、audit/*（efficiency-review.md）、regression/*、apps-script-deploy/deploy.js（workflow）、activity-writer/*（preflight + data-pipeline）。
弱引用（只被單一文件提，沒進 preflight/CI，疑似「手動才跑」的測試）：
- tools/test-basic-exclusions-changes.js、tools/test-changelog.js、tools/test-watchlist-chunking.js：僅 apps-script/README.md 提到；命名風格與其他 *-test.js 不一致（放 tools/ 根）。
- tools/apps-script-tests/{activity-writer,card-editor,card-editor-ui,promo-editor}-test.js、fake-sheet.js：僅 data-pipeline.md / apps-script/README.md 提；不在 preflight、CI。
- tools/rate-limit-client-test.js：僅 FIRESTORE-RULES-README.md。tools/feedback-digest-test.js / login-link-test.js / signup-guard-test.js：僅 functions/README.md。tools/firestore-rules-test.js：storage-and-security.md + rules README。
- tools/build-logo-assets.js：只被 index.html 註解、ui-display.md、history.md 提；無 CI。
- tools/regression/merchant-suggest-test.js：只被 ui-display.md 提，不在 tools/regression/README.md 也不在 docs/ops/regression.md 的獨立測試清單（README.md:19 只列 card-detail、mappings-page）；basic-exclusions-test.js、delete-account-test.js 在 docs/ops/regression.md 有節但 README 未列。
零引用：無完全零引用檔，唯一異常——**tools/audit/__pycache__/*.pyc 三個被 git 追蹤**（git ls-files），.gitignore 無 __pycache__ 規則，應移除（純垃圾檔）。
tools/regression/last-run.json 在工作目錄但 gitignored（正常）。

## F. apps-script/ 每檔
- cards-export.gs（CLAUDE.md、README、workflow 提；實際版在 Sheets）；card-editor.gs+CardEditor.html、promo-editor.gs+PromoEditor.html、activity-writer.gs+ActivityWriter.html（README 有節；ActivityWriter.html 是生成檔，由 tools/activity-writer/build-apps-script.js 產）。
- watchlist-monitor、benefits-parser、card-benefits-parser、register-link-finder、sheet-guide、basic-exclusions-extractor：README + deploy.json 列管。
- pmc-analytics-sync.gs：README 有提（:243-245）。promo-picks-fill.gs：README + data-pipeline.md。
- **term-unify.gs：apps-script/README.md 完全沒提（0 命中）**；只有 data-pipeline.md:89 說明 previewTermUnify/applyTermUnify，且不在 deploy.json 清單（手動貼）。是唯一在 README 沒說明的檔。
- deploy.json：列 8 檔；cards-export/card-editor/promo-editor/term-unify/pmc-analytics-sync/promo-picks-fill 刻意不自動部署（_刻意不列只解釋前三者）。

## G. 文件冗餘／計畫文件
- docs/archive/ 實有 16 檔：5 個 CLAUDE.md-*.bak、CLAUDE-2026-07-11-original.md、ui-display×5（含 ui-display-2026-07-17.bak）、data-pipeline、dispatch、regression、storage-and-security 各 1、preflight.sh-2026-07-21.bak。任務稱「16 個 .bak」不準：.bak 15 個 + 1 個 .md。
  留存理由：docs/ops/maintenance.md:25 把「刪除 docs/archive/ 內任何備份」列為🔴必問用戶；:47 規定整段改寫前必須 cp 成 .bak；:59 「移動不是刪除」。另有活連結：CLAUDE.md:98（CLAUDE.md-2026-11-12.bak）、diagnosis.md:8（CLAUDE-2026-07-11-original.md）、ui-display.md:433,479（ui-display 2 個 .bak）。其餘 .bak 無任何引用——要刪須先問站長。
- docs/ops/script-split-plan.md：標頭已寫「✅ 已完成，不要重跑，僅考古」；內容「12 模組」過時；已被 history.md 取代 → 純冗餘，但 CLAUDE.md 路由表未列它（孤兒）。
- docs/ops/diagnosis.md：2026-07-11 快照；CLAUDE.md:62 的「依據見 docs/ops/diagnosis.md」仍引用它，但其中大檔數字（script.js 11,891 行等）全過時；judgment.md 的活規則還引用 update-version.sh。
- docs/ops/letter.md：2026-07-11 給未來 session 的信，不在路由表，也無標示是否仍有效。
- docs/project/ui-refresh-diagnosis.md（2026-11-15~16）：「待辦、做完打勾」進行中文件；有被 ui-display/home-ui.js:795 引用；未完成，保留。
- docs/project/cross-slot-ref-and-minspend-spec.md：規格，已實作（cashback-engine.js:549 有「跨槽引用」區塊、tools/check-cross-slot-refs.js 在 preflight）；cashback-engine.md 也有文法；可視為已被取代但仍被 js 註解引用，保留較安全。
- BENEFITS-AUTOMATION-PLAN.md：MVP 第 1/2 優先已 ✅（:245,252），apps-script/*parser.gs 已實作；函式名（parseNewPromo 等）已與現實不符；僅 CLAUDE.md:92 與 apps-script/README 提及。多半是已完成計畫書。
- docs/mockups/promos-2026-09/README.md:3 自己寫「方案定案、實作完成後可整包刪除」——/promos 已上線（data-pipeline.md 第 9 節），屬可清除候選（刪前需把定案寫進 data-pipeline/history，README 要求的）。docs/reviews/ui-review-2026-07-20.md 同為一次性報告，未被路由表引用。
- 矛盾：(a) 12 vs 13 模組／13 組回歸（A1,A2,A5）；(b) CLAUDE.md 更新日期 2026-11-12 vs 內文 2026-11-13；(c) judgment.md:14 的 update-version.sh 反例 vs history.md:61「已刪除」。

## 沒把握／未查
- 區塊目錄「大區塊未列」只靠 banner 與函式清單抽查（home-ui、card-detail、results-display、data-loader），其餘檔未逐函式盤點。
- refs.py 只抓反引號內的 路徑／camelCase／snake_case／大寫常數／少數 CSS 前綴，不含一般英文詞、npm 套件、HTML id、Firestore collection 名；非 camelCase 的函式名（如 `togglePin` 屬 camelCase 有抓，單字小寫函式沒抓）。
- 未驗證 .github/workflows 實際 Cloudflare build command 內容（它在 Cloudflare 後台，repo 只有文件描述）。
- merchant/*.html 為生成檔，未逐檔檢查，只以 grep 確認含舊 script.js 註解。
