> 原始稽核報告（subagent 產出，2026-11-17）。主報告 `../cleanup-audit-2026-11-17.md` 已複核其中的重點項目；本檔其餘內容**未逐條複核**，動手前請先用 Grep 重新確認。行號是當日快照。

# 舊格式相容碼稽核（唯讀）— 2026-11-17

證據環境：`bash tools/cards-query.sh` 與解碼到 scratchpad 的 `cards.json`、`fixture.json`（jq，不印原文）。34 張卡、337 個 cashbackRates 槽。
**git 是 shallow clone（99 commits，最早 2026-11-07）**，`git log -S` 只會回到 2026-11-07 的 sitemap 提交，查不出各遷移碼的實際加入日；下表「加入日」欄一律為「無法判定（shallow）」。要查需站長 `git fetch --unshallow`。

## A. 卡片資料舊欄位相容碼

card 頂層實際 key（cards.data 與 fixture 皆同）：annualFee, bank, basicCashback, basicCashbackType, basicConditions, basicExclusions(fixture 無), cardUseCase, cashbackRates, changelog, couponCashbacks, domesticBonus{Cap,Conditions,Period,Rate}, feeWaiver, fullName, hasLevels, id, levelLabelFormat, levelSettings, name, overseasBonus{Cap,Conditions,Period,Rate}, overseasCashback, pointsExpiry, tags, website。
`grep -c "specialItems\|generalItems" apps-script/cards-export.gs` = 0（匯出程式根本不產這兩欄）。

| # | 位置 | 判定 | 證據 |
|---|---|---|---|
| A1 | js/cashback-engine.js:970–~1166（`card.hasLevels && card.specialItems && ...length>0` 整個 if 分支，含 1080 specialItems 比對、1135–1160 `card.id==='cathay-cube'` generalItems 比對，`levelSettings.generalRate`）。約 200 行 | **確定死碼**（對現行資料） | `jq '[.cards[]|select(has("specialItems") or has("generalItems"))]|length'` cards.json=0、fixture=0；所有 levelSettings 子物件 key 清單無 generalRate（`jq` 結果：cap cap_1 cap_14 cap_hide domesticBonusCap domesticBonusRate keepSlots level-note onlySlots overseasBonusCap overseasBonusRate period rate rate_1 rate_14 rate_hide specialRate）。hasLevels 卡僅 4 張（yushan-unicard cathay-cube sinopac-dawho kgi-eslite），皆走 else 分支。注意：該分支的 else（1166 起「Handle cards without specialItems」）才是現役路徑，刪時要保留 |
| A2 | js/data-loader.js:34–49（索引 specialItems）、51–70（索引 generalItems） | 確定死碼 | 同 A1；`card._itemsIndex` 的 type 'specialItem'/'generalItem' 只有 A1 區塊消費（cashback-engine.js:1090,1143） |
| A3 | js/card-detail.js:462–486（`card.hasLevels && card.specialItems`）與 487 起的 `(!card.specialItems \|\| length===0)` 條件 | 確定死碼（462 分支）；487 條件永遠為真（可簡化） | 同 A1。⚠️ 鐵則 4 提到 specialItems，刪時一併改 CLAUDE.md 鐵則 4 與 cashback-engine.md |
| A4 | js/search-match.js:288–299（掃 card.specialItems/generalItems）、1060–1061（建議清單） | 確定死碼 | 同 A1 |
| A5 | js/cashback-engine.js:321 註解「先看 cashbackRates、沒有才看方案 specialItems、再沒有才看 generalItems」、search-match.js:549,1011 註解 | 隨 A1 一起清（註解提到已不存在欄位） | 同 A1 |
| A6 | js/cashback-engine.js:567–578 `findRateGroupBySlot` 的「沒有 .slot 欄就退回 rates[N-1]」 | 確定死碼（對現行資料） | 337/337 槽有 slot；`jq '[.cards[]|.cashbackRates[]?|select(has("slot")|not)]|length'` cards=0、fixture=0；cards-export.gs:679 `rateObj.slot = j` 永遠輸出 |
| A7 | js/home-ui.js:1699–1735 `CARD_BANK_BY_ID_PREFIX` 與 getCardBankName 的 id 前綴退路 | 確定死碼（對現行資料）；但註解寫「Sheets 尚未建 bank 欄時」，且有 tools/check-card-banks.js 守門 → 需站長判斷是否保留當保險 | `.cards[].bank` 34/34 有值；fixture 也 0 張缺 bank |
| A8 | js/core-utils.js:719–722 `expandPromoMerchants` 的 `typeof bonus_merchants==='string'` 分支；693、707 `isAllItemsMarker/isGeneralSpendingMarker` 的 string 分支 | 確定死碼（資料層）；成本低、保留也無妨 | newCardholderPromos.bonus_merchants 型別統計：array:21 null:48，string:0；cards-export.gs:1729 固定 `split(',').map(trim)` 輸出陣列 |
| A9 | js/results-display.js:1527 `Array.isArray(conditions)?conditions:[conditions]` 的陣列分支 | 需站長判斷（呼叫端未逐一查） | cashbackRates[].conditions 型別 null:93 string:244，無 array。其他呼叫端（couponCashbacks 等）未逐一確認 |
| A10 | js/data-loader.js:154–165 `contentUpdatedIso` 缺失時退回 lastUpdated | 其實還在用（防呆）；cards.data 現有 contentUpdatedIso | `keys` 含 contentUpdatedIso；註解自稱「舊版 cards.data 沒有這欄」，實際已無舊版 |
| A11 | js/cashback-engine.js:1340「cashbackModel 空白 → legacy default」 | **其實還在用** | 有 bonus 欄的卡中 ctbc-linepay-card 2 槽、kgi-eslite 1 槽、firstbank-ileo 9 槽 cashbackModel 為空 |
| A12 | js/cashback-engine.js:1311「retired name rate+basic」註解 | 其實還在用（字串 `rate+basic...` 是現行 model 前綴）；僅註解措辭過時 | cashbackModel 含子字串 rate+basic 共 104 槽 |

死碼函式：`getCategoryStyle`（js/cashback-engine.js:510）全 repo（js/、html、tools/）僅定義 1 次、無呼叫 → 確定死碼。其他頂層 function/const/let 以名稱計全 repo 出現次數，其餘皆 ≥2（腳本：python 掃 `^function|const|let|var` 在 js/*.js、faq/landing/promos.js 對 js、html、tools 計次）。

## B. localStorage key 完整清單

| key | 讀 | 寫 | 備註/判定 |
|---|---|---|---|
| `cardLevel-<cardId>`（訪客） | levels-payments.js:79,95,106 | levels-payments.js:91,165 | 訪客現役；登入時 auth-user-data.js:575–600 吸收 |
| `cardLevel_<uid>_<cardId>` | levels-payments.js(同 cardLevelLocalKey) | 同 | 現役 |
| `cubeIssuer` | core-utils.js:58, auth-user-data.js:433,673 | levels-payments.js:129 | 現役（登入吸收見 auth:668） |
| `userQuickSearchPrefs` | data-loader.js:289 | data-loader.js:304,358,377 | 現役 |
| `userQuickSearchOptions` | data-loader.js:299 | **無（全 repo 無寫入）**；data-loader.js:305,359 只 removeItem | 只讀不寫、遷移專用 → **需站長判斷** |
| `userCustomQuickOptions` | data-loader.js:302（僅遷移函式內） | **無** | 只讀不寫 → **需站長判斷**（與上同一組遷移，且不在 clearPersonalLocalDataOnSignOut 清單） |
| `cardsInComparison_guest` | auth-user-data.js:688,727 | :852 | 現役 |
| `cardsInComparison_<uid>` | :737 | :721,863 | 現役 |
| `selectedCards_<uid>` | auth-user-data.js:737（legacyKey）；登出清單 :140 | **無** | 只讀不寫的舊 key → **需站長判斷**；Firestore `users.selectedCards` 同樣只讀（:706,713） |
| `myOwnedCards_guest` / `myOwnedCards_<uid>` | auth:760,789,803；promos.js:536（直接 JSON.parse，見 C2） | :783,799,821,831 | 現役 |
| `selectedPayments_guest` / `_<uid>` | levels-payments.js:593,623,633 | :617,655,666 | 現役 |
| `spendingMappings`（訪客）/ `spendingMappings_<uid>` | spending-mappings.js:27,59,68；auth:528 | :45,80,87 | 現役 |
| `merchantAliases_guest/_uid`、`mappingsTitle_guest/_uid` | mappings-page.js:121–140；auth:552–554 | mappings-page.js:130,138,148,174 | 現役 |
| `mappingsPrefs_guest/_uid` | mappings-page.js:62 | :93 | 現役 |
| `feeWaiver_local_<id>` / `feeWaiver_<uid>_<id>` | spending-mappings.js:411,432,438；auth:631 | :424,445 | 現役 |
| `creditLimit_local_<id>` / `creditLimit_<uid>_<id>` | spending-mappings.js:510,524,527；mappings-page.js:331 | :520,534 | 現役；auth 吸收流程**沒有**吸收 creditLimit_local_（只在登出清單 :155） → 需站長判斷是否刻意 |
| `billingDates_local_<id>` / `_<uid>_<id>` | spending-mappings.js:606,626,629；auth:651 | :619,641 | 現役 |
| `notes_<cardId>` / `notes_<uid>_<cardId>` | card-detail.js:1474,1492 | :1486,1501 | 現役 |
| `pmc_known_logged_in` | index.html:1548 | auth:360 | 現役（開頁預判） |
| `pmc_sidebar_peek_count` | cards-modals.js:35 | :60 | 現役 |
| `pmc_onboard_done` | index.html:63,73 | home-ui.js:852；index.html:73 removeItem | 現役 |
| `pmc_seen_landing` / `pmc_ab_landing` / `pmc_ab_forced` / `pmc_ab_sent` | index.html:63–78,1373；landing.html:83–92 | landing.js:10；index.html:70–72,1373；landing.html | 現役（A/B 分組；實驗結束後才可清 → 需站長判斷何時結束，非本稽核範圍） |
| `pmcEmailForSignIn` | index.html:1528 | quick-options-misc.js:1116；index.html:1532 removeItem | 現役 |
| `pmc_diag_last` | quick-options-misc.js:1359,1369 | :1361 | 現役（診斷） |
| `mpMovedHintCount` | mappings-page.js:614 | :622 | 現役；名稱含「Moved」→ 推測是「配卡表搬家提示」，若該提示期已過可評估（**拿不準**） |

## C. Firestore 欄位

users/<uid>：
| 欄位 | 讀 | 寫 | 備註 |
|---|---|---|---|
| cardsInComparison | auth:706,713 | auth:865 附近 setDoc | 現役 |
| selectedCards | auth:706,713（`\|\| userData.selectedCards`） | **無** | 只讀不寫的舊欄位 → 需站長判斷（老用戶的雲端文件可能仍只有此欄；刪了這個退路會讓他們的比較卡片清單重置成預設）。firestore.rules:65 註解說明歷史欄位 |
| quickSearchOptions | data-loader.js:276,343 | 只有 deleteField（data-loader.js:353） | 只刪不寫；firestore.rules:79 白名單為此保留。需站長判斷 |
| hiddenDefaultIds/customQuickOptions/selectedOrder | data-loader.js:281–283 | data-loader.js:350–352,375 | 現役 |
| myOwnedCards, selectedPayments, spendingMappings, merchantAliases, mappingsTitle, feeWaiverStatus, billingDates, creditLimits, birthdayMonth, cubeIssuer, isChildrenEligible | 各檔 | 各檔 | 現役，皆在 firestore.rules:73–79 白名單 |
cardSettings/<uid>_<cardId>（level）、userNotes/<uid>_<cardId>（notes）、feedback、feedbackQuota：現役。

## D. 其他

| # | 位置 | 判定 | 證據 |
|---|---|---|---|
| D1 | data-loader.js:262–364 整套快捷選項舊格式遷移（`migrateLegacyQuickSearchOptions`、`computeMigratedPrefs`、localStorage 舊 key 分支 :298–307） | **需站長判斷**（老用戶可能還有舊資料）；加入日無法判定（shallow） | B/C 表：舊 key/欄位全 repo 無寫入 |
| D2 | auth-user-data.js:737 `readLocalJSON(legacyKey)` 與 :706,713 | 需站長判斷，同 C | 同上 |
| D3 | 註解掉的大段程式碼（≥5 行） | **未發現** | python 掃連續 `//` 且像程式碼的行，≥2 連續行 0 筆；`if(true)/(false)/&& false/|| true` grep 0 筆 |
| D4 | 檔頭「載入順序 N/12」：auth-user-data.js:2、card-detail.js:2、cards-modals.js:2、cashback-engine.js:2、core-utils.js:2、data-loader.js:2、home-ui.js:2、levels-payments.js:2、quick-options-misc.js:2、results-display.js:2、search-match.js:2、spending-mappings.js:2 | 過時註解（mappings-page.js 已是 13/13） | grep "載入順序" |
| D5 | faq.js:3,32,33,63,133,256；promos.js:65,525,932–933,964–965,994,997 註解引用已不存在的 `script.js`（含 `script.js:6727-6772` 這類行號） | 過時註解（誤導模型） | `ls script.js` 不存在；js/ 為拆分後模組 |
| D6 | promos.js:540 直接 `JSON.parse(localStorage.getItem)` | 非死碼，補記：promos.js 不載入 js/，自有 try/catch，註解 :525 已說明；僅提醒鐵則 2 例外 | 讀碼 |
| D7 | cards.data 與 fixture 的差異：fixture 缺 `basicExclusions`（cards.data 34/34 有） | 非死碼；回歸固定資料落後正式資料的事實 | jq keys 比對 |

## 沒查到／沒把握
- 各遷移碼加入日（shallow clone）。
- 未逐一檢視 home-ui.js spotlight/announcement、results-display 其餘欄位（benefits、spotlights、payments 子欄位）的舊欄位退路，只比對了 cardsData 頂層 key（全部存在）與 card/rateGroup 欄位。
- A9 其他呼叫端、A7 是否要保留當保險屬判斷。
- index.html / landing.html 內聯 script 只查了 localStorage key，未稽核其死碼。
