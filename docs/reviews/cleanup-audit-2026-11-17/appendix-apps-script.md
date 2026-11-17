> 原始稽核報告（subagent 產出，2026-11-17）。主報告 `../cleanup-audit-2026-11-17.md` 已複核其中的重點項目；本檔其餘內容**未逐條複核**，動手前請先用 Grep 重新確認。行號是當日快照。

# Apps Script 死碼稽核（唯讀，未改任何 repo 檔）
方法：抽 `apps-script/*.gs` 頂層 function（355 個）→ 去註解後全 repo 計數 → 建呼叫圖，從「選單 addItem／newTrigger／onOpen／頂層程式／HTML google.script.run／tools 測試／README・data-pipeline・BENEFITS-AUTOMATION-PLAN 提及」當進入點跑可達性。腳本：scratchpad/funcs.py、f2.py。

## 重要前提：三個獨立 Apps Script 專案（不共用命名空間）
依 deploy.json＋README：
- A「PMC 資料自動化」：watchlist-monitor, benefits-parser, card-benefits-parser, register-link-finder, sheet-guide, basic-exclusions-extractor
- B「PMC 管理系統」：cards-export, card-editor, promo-editor, activity-writer(+ActivityWriter.html), CardEditor.html, PromoEditor.html, term-unify, promo-picks-fill
- C「PMC數據集中」：pmc-analytics-sync
同名衝突只在「同一專案內」才是 bug。

## 1. 疑似死函式（零呼叫、非選單／非觸發／非文件手動入口）
| 函式 | 位置 | 全 repo 引用（含定義） | 已排除的入口型態 | 判斷 |
|---|---|---|---|---|
| toContiguousBlocks_ | watchlist-monitor.gs:1324 | 1（僅定義） | 選單/觸發/字串/文件/tests 皆無 | 確定死碼，可刪 |
| debugGSC | pmc-analytics-sync.gs:894 | 1 | 選單無（C 專案無 onOpen）、README 無、tests 無 | 幾乎確定是除錯殘留；需站長確認編輯器是否還手動跑 |
| writeHistoricalImportLog | pmc-analytics-sync.gs:1028 | 2 | 只被 importHistoricalData 呼叫 | 隨 importHistoricalData 同生死 |
| importHistoricalData | pmc-analytics-sync.gs:914 | 2（含註解） | 僅檔內註解（:904「手動跑的只有 importHistoricalData」）；README/docs 無 | 刻意的手動入口但無文件；日常已由 updateAllReports 直接呼叫 importGA4History/importGSCHistory/importGA4ButtonClicksDaily，這包等於冗餘。需站長判斷 |
| createDailyTrigger | pmc-analytics-sync.gs:880 | 3 | README:249 提到；檔內註解警告「不要跑」（會刪掉現行 17:37 觸發器） | 文件有記但註解自己說別跑；建議刪（有誤跑風險）。需站長判斷 |
| runUncoveredMerchantsNow | pmc-analytics-sync.gs:2044 | 3 | README:504 教手動跑 | 刻意手動入口，保留 |
| fillPickSuggestions | promo-picks-fill.gs:18 | 4 | data-pipeline.md:610 / README:16 教手動跑 | 刻意手動入口，保留（整檔僅此一函式） |
| publishChangelog | benefits-parser.gs:500 | 多 | 檔內註解稱「舊名保留，免得觸發器/書籤指著」；tools/test-changelog.js 有呼叫；README 4 處 | 相容別名（一行轉呼叫 processInboxRows）。需站長到編輯器「觸發條件」確認沒有觸發器指向它，沒有就可刪（連同測試調整） |
其餘結尾底線函式（_）逐一驗證皆有真實呼叫點；腳本「refs≤2」清單人工複核無其他死碼。
另：未使用常數 `TERM_DICT_HEADERS`（term-unify.gs:30，全 repo 僅宣告一次）可刪。

只被文件/測試引用、不被程式碼呼叫但屬正當入口（不要刪）：activityWriter*/cardEditor*/promoEditor* 全部由 HTML google.script.run 呼叫；選單函式 30 個；pmc-analytics-sync 的 update*/import*/snapshotHistoryNow/appendMonthlyUserRow 等由 updateAllReports 或觸發器叫。

## 2. 跨 .gs 同名／重複
- 同名重複定義：全 355 個 function 與頂層 const/let/var 中只有 **onOpen**：benefits-parser.gs:70（A 專案）與 cards-export.gs:32（B 專案）。不同專案 → 目前不衝突；benefits-parser.gs:68-69 已註明「若放進同一專案要刪掉這個 onOpen」。風險點：誰把兩檔貼進同一專案就會互蓋（cards-export.gs:53 在 menu.addToUi() 之後有一行**無 typeof 守衛**的 buildAutomationMenu_();，而該函式只定義在 benefits-parser.gs（A 專案）。若線上 B 專案沒貼 benefits-parser.gs，每次開試算表 onOpen 尾端會 ReferenceError（選單已建好所以看不出來，僅執行記錄有錯）。repo 版看不出線上現況，需站長確認；若 B 確實沒有，這行是死碼/潛在錯誤）。
- 同名頂層 const/let：查無。
- 內容完全相同但不同名（跨專案各一份，文件已記載「改一邊要同步」）：pmcTermKey_（benefits-parser.gs:917，A）＝ termUnifyKey_（term-unify.gs:35，B）。
- 相近邏輯、不同名（非 bug，僅提醒）：normalizeMerchantKey_（cards-export.gs:543）、basicExNormKey_（basic-exclusions-extractor.gs:1220）、normalizeItemForMatch_（card-benefits-parser.gs:1219）各有各的規則；pmcTodayISO_/pmcTaipeiHm_ 與 pmc-analytics-sync 的日期工具各自實作。
- 註：粗掃會把 `.getValue()`、`Utilities.formatDate` 誤判成同名，已排除。

## 3. 各檔用途與是否仍在用
| 檔 | 專案 | 用途 | 結論 |
|---|---|---|---|
| cards-export.gs (3935行) | B | 匯出 cards.data/version、QA、promos.html、sitemap、每月備份、onOpen 選單 | 核心，在用 |
| card-editor.gs + CardEditor.html | B | 單卡編輯器（2026-11-11 新增）；html 由 google.script.run 呼叫 3 支 | 在用，README 有、有測試 |
| promo-editor.gs + PromoEditor.html | B | 新戶活動編輯器 | 在用，同上 |
| activity-writer.gs + ActivityWriter.html | B | 活動快寫（html 由 tools/activity-writer 生成；deploy.json 自動部署） | 在用 |
| term-unify.gs | B | 統一詞預覽/套用＋寫法一致性檢查（exportToJSON 每次呼叫 termConsistencyIssues_） | 在用 |
| promo-picks-fill.gs | B | 手動一鍵填站長推薦問句 | 手動工具，有文件，在用（低頻） |
| watchlist-monitor.gs / benefits-parser.gs / card-benefits-parser.gs / register-link-finder.gs / basic-exclusions-extractor.gs / sheet-guide.gs | A | 權益監控、AI 解析、登錄連結、一般消費排除、使用說明；皆在 benefits-parser onOpen 選單；deploy.json 自動部署 | 全在用 |
| pmc-analytics-sync.gs (2392行) | C | GA4+GSC+Clarity 每日同步（updateAllReports 由編輯器觸發器跑） | 在用；內有 debugGSC/importHistoricalData/createDailyTrigger 殘留 |
| deploy.json | — | 自動部署對照表 | 在用 |
沒有任何檔整檔停用跡象。

## 4. exportToJSON 輸出欄位 vs 前端引用
頂層 22 鍵（lastUpdated, contentUpdatedIso, cards, payments, quickSearchOptions, merchantPayments, micropaymentDefaultNote, faq, announcements, searchHints, searchExclusions, exclusionGroups, termAliases, benefits, referralLinks, cashbackSites, newCardholderPromos, cardApplyCtas, spotlights, merchantPages, bankColors, bankAccentColors）：全部有前端或 tools 引用（merchantPages 只被 tools/build-merchant-pages.js 讀；bankAccentColors 有 js/home-ui.js 讀）。
以 decode 後真實資料展開到子欄位，葉名全 repo 零引用者（需站長判斷，皆可能是 Sheets 內部/將來用）：
- cards[].domesticBonusPeriod、overseasBonusPeriod（cards-export.gs:634-635 addOptionalField 輸出；domestic/overseasBonusRate/Cap/Conditions 有被讀）
- cards[].levelSettings.*.cap_hide、rate_hide（前端零引用；cap_14/rate_14 是 rate_N/cap_N 動態拼字，視為在用）
- benefits[].benefit_type（前端零引用；但 cards-export.gs:1662 用它當有效列守門，且資料內 18 筆全是 parking）
- merchantPayments.*.source_url、last_updated（前端零引用，只供人看）
- benefits[] 資料裡有一個空字串鍵 ""（來自 Sheets 空表頭欄）——雜訊，建議在匯出略過空表頭
（其餘零引用只是資料字典鍵：商家名、航空公司名、card id 等，非欄位。）
限制：葉名比對是「字面出現」，像 `name`、`id` 這類常見字出現在別處也會被算作有引用，不會被列出；動態拼字欄位（rate_N 等）只特別處理了 cap_/rate_。

## 5. functions/（Firebase）
index.js export 4 個：dailyFeedbackDigest、guardSignup、guardEmails、sendLoginLink，皆為雲端入口。digest.js/login-link.js/signup-guard.js 內所有內部函式（escapeHtml、formatTaipeiTime、imageLines、build*、send*、bump、buildSiteLink、mailBodies、taiwanDayKey、emailDomain、isDisposable、normalizeInbox、hashKey、inboxRef、inboxTaken）皆有呼叫點。查無未使用函式。小提醒：signup-guard 的 DISPOSABLE_DOMAINS、MAX_RESET_EMAILS_PER_DAY 有 export，我未逐一查 tests 是否用到。

## 沒把握／未查
- cards-export.gs:53 的 buildAutomationMenu_() 確認無 typeof 守衛；線上 B 專案是否仍貼著 benefits-parser.gs 從 repo 看不出。
- 線上實際版本可能比 repo 備份多出函式或觸發器（觸發器清單從 repo 看不到）——「無呼叫」只代表 repo 內，站長需在編輯器「觸發條件」頁核對 publishChangelog / debugGSC / 任何以 handler 名稱建的觸發器。
- 未檢查「被呼叫但未定義」的函式（反向問題）。
- 前端欄位稽核只涵蓋 cards.data 實際出現的欄位；Sheets 有欄但目前全空的欄位不會出現在輸出。
