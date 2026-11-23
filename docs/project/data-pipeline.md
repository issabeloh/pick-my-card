# 資料管線（Google Sheets → Apps Script → cards.data）

> 改「資料結構、匯出邏輯、cards.data、級別設定」前必讀。
> ⚠️ 主匯出程式 `exportToJSON()` 目前**只存在 Google Sheets 的 Apps Script 專案裡**，repo 的
> `apps-script/` 只備份了權益監控（watchlist-monitor.gs）。改匯出邏輯＝到 Sheets 裡改，改完建議把副本補進 `apps-script/`。

## 1. 資料流

Google Sheets（多工作表）→ Apps Script `exportToJSON()` → Base64 JSON → repo 的 `cards.data` ＋ 同步更新 `cards.version` → 前端載入。

**查 cards.data 內容的唯一正確姿勢**（488KB base64 單行，絕不 Read）：
```bash
bash tools/cards-query.sh '.cards[] | select(.id=="dbs-eco")'   # 自動解碼＋截斷長輸出
```

## 2. 工作表結構

1. **Cards Data** —— 信用卡基本資料和回饋規則
   - 必填：`id, name, fullName, basicCashback, annualFee, feeWaiver, website, tags`
   - 回饋欄位：`rate_N, items_N, cap_N, category_N, conditions_N, periodStart_N, periodEnd_N, hideInDisplay_N, registerLink_N`（**N 沒有固定上限**——匯出迴圈用 `maxSlotIndex()` 依表頭自動偵測，加新欄不用改程式；2026-09-29 站長已加到 26。`register-link-finder.gs` 同理用 `regLinkMaxSlot_()`：凡是照 `欄名_N` 橫向展開的迴圈，上限一律依表頭偵測、禁止寫死數字；加槽位時順手 `grep -rn 'maxSlots\|<= 2[0-9]' apps-script/` 確認沒有漏網的寫死上限（2026-09-29 slot 23–26 的「需登錄」活動靜默漏抓登錄連結）。骨幹槽 14/21/22 的慣例見 `docs/project/cashbackmodel-fill-guide.md` 第 4 節）
   - 計算模型：`cashbackModel_N`（選填，只加用到的槽位；語義見 `docs/project/cashback-engine.md` 第 6 節）
   - 領券活動：`couponMerchant_N, couponRate_N, couponConditions_N, couponPeriod_N, couponCap_N`（N=1-10）
   - 分級卡：`hasLevels`, `levelSettings`（JSON 格式）
   - 發卡行：`bank`（選填，2026-07-28 新增）——側欄「加入比較的卡片」膠囊左半顯示的銀行字樣。
     **沒建這欄也不會壞**：前端會退回用卡片 id 前綴推導（`js/home-ui.js` 的 `CARD_BANK_BY_ID_PREFIX`）；
     兩者都對不到才退回「單一膠囊＋完整卡名」。想改銀行字樣（如「第一銀行」→「一銀」）或新增發卡行，
     **建這欄後只改 Sheets 即可、不必動程式**。`tools/check-card-banks.js`（preflight 內）會列出對不到銀行的卡。
     卡名開頭若重複銀行字樣會自動去掉（`一銀 iLEO 信用卡` → 膠囊顯示 `一銀｜iLEO 信用卡`）
   - 登錄連結：`registerLink_N`（選填，2026-09-08 新增）——需登錄才算數的活動，其**銀行官方登錄頁網址**。
     前端 `renderRegisterLinkLine()`（`js/cards-modals.js`）在該組的條件下方渲染成「銀行官方登錄連結 ⧉」超連結
     （詳情頁與搜尋結果兩條路徑都有），**網址本身不顯示**。
     - **只收 `https://` 開頭的網址**：顯示端一律過 `sanitizeUrl()`（鐵則 3），填文字進去會被靜默丟掉、畫面上什麼都不會出現
     - **不要填 App 專屬 scheme**（`cathaybk://`、`linepay://`…）：同樣被 `sanitizeUrl()` 擋掉。
       那種連結在沒裝 App 的手機上是一個看不懂的錯誤畫面，而且各家 App 的 scheme 沒有公開保證、改版就失效
     - **只能在 App 內操作的活動**（「打開 App → 我的優惠 → 登錄」）→ 把步驟寫成文字放進 `conditions_N`，這一欄留空
     - 這欄不存在時匯出直接跳過（`addOptionalField`），舊表完全相容；不必 22 個槽位一次補齊，用到哪個補哪個
   - 一般消費排除項目：`basicExclusions`（選填，2026-09-30 新增）——這張卡「一般消費定義」明文排除、**完全沒有回饋**
     的交易（繳稅、學費、保費、儲值…），一格多項、**半形逗號分隔**（頓號／全形逗號／換行也吃，但請統一用 `,`），同一個東西各銀行要寫成同一個字，匯出成 `card.basicExclusions` 字串陣列
     ⚠️ 名單裡不全是官網原文：滙豐卡的「7-11」「全家」是程式依「超商只收合作銀行的卡」補的（2026-11-13，`basic-exclusions-extractor.gs` 的 `BASICEX_STORE_NO_ACCEPT`，細節見 `apps-script/README.md` 規則 8m），對照原文找不到是正常的，別刪
     （空白格不輸出）。前端只在「退回基本回饋」時使用，命中的卡不顯示基本回饋（規則見 cashback-engine.md 第 10 節）。
     初次建立用自動化檔選單「其他工具 ▸ 一般消費排除 1／2」；官網變動後由監控自動分析、站長在 `2-變動通知` 刪行填 V 再「一般消費排除（官網改版）：確認填 V 的套用到待審核」（2026-10-13，`apps-script/basic-exclusions-extractor.gs` 第 ③ 段，操作見 `apps-script/README.md`）。
     ⚠️ 項目要寫成**使用者會搜尋的詞**且保留限定詞：前端是「搜尋詞包含排除詞就算」，寫「超商」會誤殺所有超商搜尋，要寫「超商代收」；單一個字的項目一律被忽略
   - 隱藏活動：一般槽位加 `hideInDisplay_N=TRUE`（詳情頁不顯示但可搜尋；配方見 cashback-engine.md 第 5 節。舊 `_hide`/`_hide_1` 專用欄位與其 Apps Script 特例迴圈已於 2026-07-11 移除）
2. **Payments** —— 行動支付（id, name, website；自動生成 searchTerms 別名）
3. **QuickSearch** —— 快捷搜尋（id, displayName, icon, merchants 逗號分隔, order）
4. **Merchant Payments** —— 商家付款方式（merchant, online_payment, offline_payment, source_url, last_updated, micropayment_note）。`micropayment_note`（2026-11-13）＝小額支付提示文字，留空就不匯出該欄位。**`merchant` 填 `_default` 的那一列不是商家**，它的 `micropayment_note` 是通用提示，另外匯出成 `cardsData.micropaymentDefaultNote`（不進 `merchantPayments`）；文字裡可寫 `{部分}`（部分門市品牌才顯示這兩個字）。哪些品牌算小額支付商家不在 Sheets，在 repo 的 `data/nccc/`（見該目錄 README）
5. **Search Hints** —— 搜尋提示（keywords 逗號分隔會展開成多 key, suggestions, display_message, active）。**active 為 TRUE 的列 keywords、display_message 必填**，缺一整列不匯出、`runQACheck()` 檢查 11 列出來（⚠️ 不擋匯出）；suggestions 選填，留空時前端只顯示文案。2026-10-08 以前 display_message 留空會補預設句「💡 建議也搜尋：」，已拿掉（前端分不出那句是不是系統補的）。display_message 可寫簡單 HTML（2026-10-13）：粗體 `<b>`、換行 `<br>`、連結 `<a href="https://…">`（只收 http/https、自動開新分頁）等，沒寫標籤就當純文字；其他標籤會被拆掉只留文字（見 storage-and-security.md 第 6 節）
6. **FAQ** —— id, category, question, answer, order, isActive（依 order 排序）
7. **announcements** —— text, fullText, link, active, priority, date（依 priority，最多 5 則）
8. **Card Benefits** —— 停車折抵等（id, benefit_type, benefit_desc, merchants, conditions, benefit_period, notes, active）。**同一張卡可有多筆**（不同地點/優惠），ID 重複是正常的
9. **ReferralLinks** —— merchant, url, description, active
10. **Highlights** —— 推薦活動（merchant, rate, description, card_name, card_id, order, active, **featured 選填**）。匯出 JSON key 是 `spotlights`；merchant 必須是單一搜尋詞（一個商家，或剛好等於某快捷搜尋 displayName）
    - **2026-09-30 起只存編輯決定**：cap／deadline／category 三欄已刪，上限與期限由前端從卡片真實活動推導；`rate` 是「選哪個活動 × 哪個級別」的選擇器，`card_name` 只給人看。規則見 `ui-display.md` 第 4 節
    - **`featured`（2026-09-03 新增，TRUE/FALSE）—— 前端已不讀**。原本把勾選的活動排進「主打卡」版位；主打卡 2026-09-03 停用、2026-10-02 前端程式全部移除（見 `ui-display.md` 第 4 節）。Apps Script 仍照常匯出這欄、無害；要清掉得同時改 Sheets 上的執行版與 `apps-script/cards-export.gs` 備份。
    - 目前每頁張數：手機 4（2 欄 x 2 列）、平板 3、桌機 4（4 欄 x 1 列）。版位配置寫在 `spotlightLayout()`，欄數在 `styles.css` 的 `.spotlight-track`，**兩邊的斷點（768 / 1024）必須一致**，否則會出現填不滿的半排。
    - **2026-09-17 起這張表同時餵 /promos 的「卡片特色」**：命中的通路保證入列並帶
      hype 字眼（見 `docs/project/promos.md` 第 4 節）。因此往 Highlights 加一列會同時改善首頁推薦活動與新戶活動頁。
11. ~~**Watchlist**~~ —— 已於 2026-07-17 搬到「PMC 資料自動化」自動化檔並改名 `1-監控清單`（見 `apps-script/README.md` 的「選單 ↔ 分頁對照表」，與 cards.data 匯出無關）
12. **searchExclusions** —— 搜尋排除規則（term, excludedItems 逗號分隔, active）。前端載入時由
    `mergeDataSearchExclusions()`（`js/search-match.js`）併入 `searchExclusionMap`（程式內只留兜底預設）。
    語義：搜尋詞（含 fuzzy 展開後的別名）＝term 時，item 名與 excludedItems **小寫全等**者不匹配。
    例：`term=sia, excludedItems=AsiaYo`（新加坡航空的別名 sia 子字串誤中 a"sia"yo）。
    ⚠️ **教訓（2026-08-04）**：工作表建好了、前端接收端也早就寫好了，但**匯出這一側漏掉沒寫**，
    造成「工作表填了規則卻完全沒效果」（`cards.data` 的 `.searchExclusions` 是 `null`，只有寫死在
    `searchExclusionMap` 的 sia 生效）。查這類「資料填了沒反應」先用
    `bash tools/cards-query.sh '.<key>'` 確認 key 有沒有真的出現在 cards.data，別從前端開始查。
    匯出端讀取函數在 `apps-script/cards-export.gs`（分頁名大小寫兩種都收），JSON key 為
    `searchExclusions`，格式 `[{ term, excludedItems: [...] }]`。
12b. **Cards Data 的 `cardUseCase` 欄**（選填，2026-09-17 新增；2026-09-21 由 `cardUsage` 更名，
    匯出端 `addOptionalField(card, row, headers, 'cardUseCase')`）—— 一句話描述這張卡的性格，
    顯示在**卡片詳情頁「基本資訊」最上方**與 **/promos 的卡片特色 modal 最上方**。
    **沒填就整行不出現**（同 `addOptionalField` 慣例，舊表完全相容，可以慢慢填）。
    - **為什麼在 Cards Data 不在 New Cardholder Promos**（2026-09-21 站長問）：它是**卡片**屬性
      不是活動屬性。Promos 分頁是一列一檔活動（61 列對 28 張卡，iLEO 一張佔 4 列），放進去
      同一句話要寫 4 遍、遲早分岔；而且有 5 張卡沒有新戶活動、在那邊根本沒有列可以寫；
      活動每月換、卡片性格不會。若要的是**活動層級**的手寫註記（「這檔跟第 3 檔不能併用」），
      那是另一個欄位，才該放 Promos 分頁
    - **欄名為什麼不是 `cardUsage`**：usage 讀起來像「用量」；也不叫 `cardSummary`——
      這份 codebase 裡 summary 已經是 `new_customer_summary`／`.promo-act-summary`（活動摘要），
      再加一個 summary 會讀不出差別
    - **只寫性格、不寫數字**：句子裡一旦出現「6%」，它就變成第二份會漂移的回饋率——
      回饋率會跟著 `cards.data` 走，這句話不會
    - 用途是講自動規則講不出來的事，例如台新 Richart 卡的「每月選一個方案綁生活場景」
      （那五行都掛著〔切換○○刷方案〕，但「只能選一個」這件事沒有任何一行講得出來）
12c. **ExclusionGroups** —— 一般消費排除項目的同義詞群組（2026-10-14；name, variants 逗號或換行分隔, type＝分類／同義詞（空白＝分類）, active）。
    **分類**（如「醫療費用」⊃ 醫指付、長庚醫療體系…）：打 name 才展開成整組；**同義詞**（如交通罰單＝罰款＝罰鍰）：打 name 或任一寫法都展開。
    只影響排除判斷、詳情頁搜尋、下拉選單（只列 name），不進活動匹配。前端 `expandExclusionGroupTerms()`（`js/search-match.js`）；規則見 cashback-engine.md 第 10 節
12d. **統一詞**（2026-10-14，資料檔「PMC 管理系統」）—— 統一詞, 其他寫法, 搜尋別名, 備註。站長維護的商家統一寫法（品牌原大小寫、中英不空格、臺→台）。三個地方讀它：
    ①`apps-script/term-unify.gs`：`previewTermUnify`／`applyTermUnify` 把試算表既有資料改成統一寫法（只換整項；忽略大小寫／空白／臺台比對；不掃 MerchantPages；2026-10-17 起掃 Highlights）；
    同檔的 `termConsistencyIssues_` 是**寫法一致性檢查**（2026-10-17）：`exportToJSON` 每次匯出自動跑，網站用到的商家名（各卡 items、領券、一般消費排除、快捷選項、Merchant Payments、精選活動）裡同一個名字有兩種以上寫法（同一個 `termUnifyKey_`）就跳提醒、不擋匯出。
    為什麼要有：前端「算」是拿名字查每張卡的清單，只忽略大小寫、不忽略空白；寫法不一，「匹配到」會重複列，名字改過的話用戶刷卡小抄存的舊寫法也對不上。修法一律在源頭（統一詞表加列 → applyTermUnify），不在程式裡做空白合併；
    ②`cards-export.gs` 匯出 `termAliases`（其他寫法＋搜尋別名＋自動補的「中英之間加空白」寫法，`termSpacedVariants_`，2026-10-18：網站搜尋不忽略空白，「台灣 pay」原本找不到「台灣Pay」；只進匯出、不寫回工作表；表上已有的寫法不重複補）→ 前端 `mergeDataTermAliases` 併入模糊搜尋；
    ③自動化檔 `benefits-parser.gs` 的 `pmcUnifyList_`：新戶 bonus_merchants、新卡／活動更新 items、一般消費排除 basicExclusions 寫進待審核前先統一（跟 term-unify 的 `termUnifyCell_` 同規則，兩專案各一份，改一邊要同步）。
    「其他寫法」＝會被改寫的；「搜尋別名」＝不改資料、只讓用戶搜得到（寵物醫院 → 動物醫院）
13. **BankColors** —— 側欄膠囊左緣雙色帶的銀行 CI 色（bank, color, accent, active），
    2026-09-08 新增，2026-09-09 加 `accent` 欄。
    - `bank` 必須與 Cards Data 的 `bank` 欄**字串完全一致**（前端就是拿 bank 欄的字去查這張表）
    - `color`＝色帶**上半**的主色，`accent`＝**下半**的副色。兩者都只收 `#RRGGBB` / `#RGB`，
      畫面上直接用原色、**不做任何淡化**（2026-09-08 那版的「50% 疊底」已隨左半色塊一起移除）
    - **`accent` 整欄是選填的**：沒這欄、或某家沒填 → 前端畫成上下同色的單色帶。
      ⚠️ 格式錯的 `accent` **只丟掉那一格、主色照常匯出**（副色是加分項，不該把整家拖下水）；
      格式錯的 `color` 則整列跳過。兩種都會留 log
    - `active` 留空視為啟用（同「變動紀錄」慣例）
    - 匯出 JSON key 是 `bankColors` 與 `bankAccentColors`，格式都是 `{ "玉山": "#019c96", ... }`；
      `readBankColors()` 回傳 `{ colors, accents }` 兩張表
    - ⚠️ **工作表不存在或某家沒填 → 安全降級**：該銀行的色帶退回中性灰 `#dfe3e8`，不會壞掉。
      所以可以先貼程式、之後慢慢補齊
    - **銀行改 CI 只要改這張表一格、不必動程式**，新增發卡行也一樣（與 `bank` 欄同一個設計）
    - 2026-09-09 已由站長填齊 16 家的 `color`／`accent`（星展 `#ec1d25`／`#000000`、
      中信 `#e92429`／`#007166` 兩家連 `color` 欄一起換過），前端沒有任何硬寫的色碼
14. **變動紀錄** —— 卡片近期異動（id, date, summary, active），2026-07-31 新增。
    詳情頁「近期異動」的資料來源。**不是手打的**：由自動化檔的選單「發布變動紀錄」
    跨檔 append 進來（流程見 `apps-script/README.md`「發布變動紀錄」一節）。
    - 匯出時由 `readChangelog()` 依 `id` 分組、濾掉 `active=FALSE`、依 `date` 由新到舊
      取前 5 筆，掛成 `card.changelog`（**沒有異動的卡不塞空陣列**，省 cards.data 體積）
    - `active` 留空視為啟用（append-only 的 log，忘了打 TRUE 不該整批消失）；
      要撤下就把該列改 `FALSE`，**不用刪列**——表裡保留全部歷史，「最多 5 筆」是匯出時截的
    - ⚠️ **工作表不存在時安全降級**：整段跳過、不丟例外（可以先貼程式、之後再建表）
    - `runQACheck` 檢查 10 會列出對不到 `Cards Data` 的 `id`（⚠️ 警告，不擋匯出）

（單卡編輯器、新戶活動編輯器、活動快寫不是工作表，2026-11-22 移到第 13 節。）

## 3. exportToJSON() 匯出流程

順序：`runQACheck()` → Cards Data → Payments → QuickSearch → Merchant Payments → Search Hints → FAQ → announcements → `readCardBenefits()` → `readReferralLinks()` → `readChangelog()`（掛進 `card.changelog`） → 組 JSON → Base64 輸出。

匯出的 JSON 結構：
```javascript
{
  lastUpdated, cards, payments, quickSearchOptions, merchantPayments,
  faq, announcements, searchHints, benefits, referralLinks,
  cashbackSites,        // 領券/回饋網站
  newCardholderPromos,  // 新戶活動
  cardApplyCtas,        // 辦卡 CTA
  spotlights            // 推薦活動（Highlights 工作表；UI 名稱 2026-09-03 改，資料 key 不動）
}
```

「變動紀錄」沒有頂層 key——它掛在每張卡身上：`card.changelog = [{ date, summary }, ...]`（最多 5 筆、由新到舊；**沒有異動的卡沒有這個欄位**，前端判斷要 `!card.changelog || card.changelog.length === 0`，鐵則 4）。

**手機匯出**（2026-11-18）：`getUi()` 只有從試算表選單執行才拿得到，手機只能在 Apps Script 編輯器按「執行」，
以前會在第一行丟 `Cannot call SpreadsheetApp.getUi() from this context`。現在 `exportToJSON`／`runQACheck`
改用 `pmcUi_()`：拿不到真 UI 時換成 `PMC_HEADLESS_UI_`，對話框改寫進執行記錄、是／否一律當「否」——
❌ 照樣擋、參照問題（card_id／申辦連結網域）**一律取消**、只提醒的照常匯出。從選單執行時行為不變。
**新增會在匯出途中被呼叫、又直接用 `SpreadsheetApp.getUi()` 的函式，手機匯出就會再壞一次**——一律改用 `pmcUi_()`。

**重要輔助函數**：`getValue(row, headers, fieldName)` 安全讀欄位；`addOptionalField(obj, row, headers, fieldName, type, targetName)`；`formatDateToSlash(dateValue)`（YYYY/M/D）；`generateSearchTerms(id, name)`。

## 4. 匯出 guard 鐵則（rate=0 陷阱，2026-07-09 血淚教訓）

**匯出迴圈（`rate_N` 槽位，隱藏活動也走同一支）不可以用 `if (rate && items)` 當 guard**——
`0 && items` 是 falsy，會把 `rate_N=0` 的 stacking 槽整組丟掉（如 `meta廣告`/`google廣告`，
`cashbackModel=…+overseasBonusRate`、指定加碼成分為 0）。症狀：搜尋零結果、cards.data 裡根本沒有該 item。

**正確做法**：只有 `items` 沒填才跳過；`rate` 用 `parseFloat` 解析，`0` 放行、非數字才整組不匯出
（placeholder 如 `{specialRate}` 是 truthy 字串，不受影響）。

**匯出後快速自檢**：解 base64，「非 hideInDisplay 的 `rate===0` 槽數量」不該是 0：
```bash
bash tools/cards-query.sh '[.cards[].cashbackRates[]? | select(.rate==0 and (.hideInDisplay|not))] | length'
```

## 5. cards.data 快取機制

- 前端先抓 `cards.version`（不快取）→ 用版本號抓 `cards.data?v=<版本>`（可快取）
- **更新 cards.data 必同步更新 cards.version**（任何不同短字串即可，建議 `YYYYMMDD-N`）——`tools/preflight.sh` 會機械檢查
- 忘了更新不會壞，使用者最多延遲約 10 分鐘看到新資料
- 詳見 `CARDS-DATA-CACHE-README.md`

## 6. ⚠️ 更改「級別名稱」須知（資料維護者）

級別的**名稱字串本身就是識別碼**（用戶存的、選單顯示的都是這串字）：
- **改級別名稱＝所有存舊名稱的用戶「對不上」**→ 看到預設級別、要手動重選（不當機、不壞資料，但個人偏好被遺忘）
- **能不改就不改**：把級別名稱當永久編號；要改給用戶看的說明文字，改 `level-note`
- **非改不可**：先準備「舊名稱→新名稱」對照，在程式裡加一次性「級別改名遷移對照」（`getCardLevel` 讀到舊名稱自動翻譯後再存回）。目前程式**只**支援大小寫/空格差異的自動比對（約 script.js:3300），**不**支援真正改名——真改名一定要另外加對照表
- 相關鐵則（前端絕不擅自覆寫用戶級別）見 `docs/project/storage-and-security.md`

## 7. 新增資料表的標準流程

1. Sheets 新增工作表（第一列 headers，通常含 `active` 欄）
2. 寫讀取函數（參考 `readCardBenefits()`/`getAnnouncements()`）：
   ```javascript
   function readXxxData() {
     const sheet = ss.getSheetByName('SheetName');
     if (!sheet) return [];
     const data = sheet.getDataRange().getValues();
     const headers = data[0];
     const results = [];
     for (let i = 1; i < data.length; i++) { /* 讀取並轉換 */ }
     return results;
   }
   ```
3. 在 `exportToJSON()` 調用：`readCardBenefits()` 附近新增讀取、`jsonContent` 加欄位、成功訊息顯示匯出數量
4. 前端以 `cardsData.xxx` 存取，依需求實作搜尋/顯示

## 8. 日期欄位雙格式陷阱（periodStart / periodEnd）

**匯出的日期格式不保證一致**：`cashbackRates` 通常是 ISO `"2026-01-01"`（`-`），但 `couponCashbacks` 等區塊可能是台式 `"2026/7/1"`（`/`，不一定補零）。**兩種都會實際出現在 cards.data，前端不能假設只有一種。**

混用時不會報錯，活動會**被靜默濾掉**（看起來像「根本沒這活動」）：ASCII `-` < `/`，原始字串比較會把任何日期誤判成「即將開始」；`.split('-')` 遇 `/` 格式解析成 `Invalid Date`，最後被 `filterExpiredRates()` 整個濾掉（2026-07-03 教訓）。

**規則**：前端任何日期比較/解析，一律走 `taiwanDaysUntil()`（天數差）／ `getRateStatus()`（是否進行中）（內部已用 `slashDateToISO()` 正規化），禁止對這兩欄位手刻字串比較或 `.split('-')`；新增帶日期的區塊也要沿用這套函數。

## 9. promos.html 靜態生成 → 已搬到 `docs/project/promos.md`

2026-11-22 整節（含 9a–9f）搬成獨立檔，舊編號對照在該檔開頭。這裡保留節號，讓第 10 節以後的編號不位移。

## 10. sitemap.xml 生成與 lastmod 原則（2026-08-16 補完）

`sitemap.xml` 由 `generateSitemapXml_(merchantPages, promosUpdatedIso, homeUpdatedIso)` 在**每次匯出時整份重生**
（`publishToGitHub` 內，帶 `[CI Skip]`）。repo 裡那份跟 `promos.html` 一樣只是快照，
**改生成邏輯要把整份 `cards-export.gs` 貼回 Google Sheets**，否則下次匯出照樣蓋回舊格式。
`robots.txt` 指向它，不需另外維護。

**收錄的頁**：`/`（首頁）、`/landing`、`/faq`、`/promos`、`/promos/<card id>`（2026-11-18）、`/merchant/<slug>`（URL 用 `encodeURIComponent`，中文 slug 是百分比編碼）。
首頁 2026-08-16 才補進去——它是全站最重要的頁、`index.html` 本來就 self-canonical 到 `https://pickmycard.app/`，
先前漏收純粹是疏忽（漏收不會讓 Google 不索引首頁，但少一個明確信號）。

**鐵則：`lastmod` 只在「該頁內容真的變動」時前進，絕不每次匯出蓋今天。**
每次蓋今天＝對 Google 天天喊「我更新了」而內容沒動，久了 Google 直接不信任你的 `lastmod`、降低重爬效率（狼來了）。
各頁的日期來源：

| 頁 | lastmod 來源 |
|---|---|
| `/` | `homeUpdatedIso`＝`cards.data` 內容指紋（首頁內容整份由 cards.data 前端渲染）。**指紋刻意排除 `lastUpdated` 欄位**——那是匯出當下的時間戳，每次必變，含進去指紋就永遠不相等 |
| `/landing` `/faq` | 寫死的常數（不隨匯出變動；改版時手動更新 `generateSitemapXml_` 裡的日期） |
| `/promos` | `promosUpdatedIso`（見 `docs/project/promos.md` 第 1 節，與可見戳章／JSON-LD `dateModified` 同源） |
| `/merchant/<slug>` | 同 `homeUpdatedIso`——商家頁＝index.html 版面 ＋ cards.data 算出的卡片清單，會變的來源就是 cards.data，與首頁同一個訊號 |
| `/promos/<card id>` | `promoCardUpdatedIso[id]`＝該卡自己的指紋（2026-11-18，見 `docs/project/promos.md` 第 7 節）。只收今天還有進行中活動的卡 |

**`homeUpdatedIso` 也寫進 `cards.data`（欄位 `contentUpdatedIso`，2026-10-30）**：商家頁生成器把它烤進 HTML
（頁尾可見日期＋JSON-LD `dateModified`），前端頁尾也優先顯示它——頁面上看到的日期、`dateModified`、
sitemap `lastmod` 三處同源。它由指紋算出、本身不在指紋裡，所以不會造成「每次匯出都變」。
⚠️ 這欄要等 `cards-export.gs` 貼回 Google Sheets 後的下一次匯出才會出現；之前生成器與前端都退回 `lastUpdated`。

收哪些商家頁由 `MerchantPages` 工作表的 `active` 欄決定（見第 11 節）；工作表不存在時退回
`MERCHANT_FALLBACK_SLUGS`，避免 sitemap 把現有 6 頁整組移除。

**已知限制**：首頁的指紋只看 `cards.data`，看不到 `index.html` 本身。純 HTML 改動（例如改連結、改版面）
不會讓 `/` 的 lastmod 前進——Apps Script 端根本讀不到 repo 的 HTML。實務上影響很小（資料幾乎每次匯出都會變、
`/` 的日期本來就常前進），真的在意就在改 HTML 那次順手改 repo 的 `sitemap.xml`（下次匯出會重生，但至少即時）。
`/landing`、`/faq` 同理，日期是 `generateSitemapXml_` 裡的寫死常數，**改了那兩頁要手動更新**。

### 內部連結一律用 clean URL（2026-08-16）

Cloudflare Pages 會把 `/faq.html` 301 到 `/faq`，所以站內寫 `href="faq.html"` 等於每次都多繞一跳：
浪費爬取預算，GSC「Page with redirect」報表被自家連結灌爆。**一律寫 `/`、`/?start`、`/faq`、`/faq#faq-10`、
`/promos`、`/landing`**；`tools/preflight.sh` 第 1e 項會擋回頭路。
2026-08-16 全站 66 個連結一次改完（index 8、faq 7、landing 3、商家頁各 8）——`promos.html` 因為是
Apps Script 生成的，模板本來就寫 clean URL，是唯一沒中的頁。
**代價**：`python3 -m http.server` 之類的本機靜態伺服器不做 clean URL 對應，本機點這些連結會 404
（clean URL 是 Cloudflare Pages 的行為）。回歸腳本直接開 `index.html`，不受影響。

**共用機制 `pmcStampedDate_(key, signature)`**：指紋與日期成對存在 Script Properties
（`<KEY>_LAST_SIG` / `<KEY>_LAST_DATE`）；指紋相同就回上次那天，不同或首次才蓋 `pmcTodayISO_()` 並寫回。
promos（key `PROMOS`）、首頁（`HOME`）、生成的商家頁（`MERCHANT_<slug hash>`）共用同一支。
純函數 `pmcHashString_`（djb2 + `Math.imul`，Node/Apps Script 結果一致）負責算指紋。

## 11. 商家落地頁生成器（2026-08-16）

`merchant/<slug>.html` **不是手維護的檔案**，每次 Cloudflare Pages 部署時由
`tools/build-merchant-pages.js` 從 `index.html` ＋ `cards.data` 現場組出來。
手改那些檔案會在下次部署被蓋掉——`tools/preflight.sh` 第 1d 項會先擋下來。

`--check` 刻意把「不一致」分成兩類（用 `stripDataRegions()` 挖掉 JSON-LD 與 SEO 說明區後比對版面）：
**版面不一致 → ❌ 擋 commit**（手改過，或 index.html 改了沒重生）；
**只有卡片清單落後 → ⚠️ 放行**（Apps Script 每次匯出都會動 cards.data，部署時自己會重生，不影響線上）。
不分這兩類的話，每次匯出後所有不相干的 commit 都會被擋，結果只會是大家習慣性忽略 preflight——比沒有檢查更糟。

**為什麼要有這支**：那 6 頁本來是 `index.html` 的手抄副本，抄一份就多一份會歪的東西。
動手當天量到的實際傷害：

- 6 頁裡有 4 頁還停在舊版介面（少「個人設定」「近期異動」兩個區塊，還留著早已從
  `index.html` 移除的 `cube-level-selector` 等死碼）
- 頁面裡寫死的 JSON-LD 卡片清單與 SEO 文案早就過期：momo 頁畫面上第一名是遠東快樂卡，
  但兩份清單裡都沒有它——**對使用者講一套、對 Google 講另一套，而且沒有任何機制會發現**

**要改什麼去改哪裡**：

| 想改的東西 | 去哪改 |
|---|---|
| 版面、區塊、共用元件 | `index.html`（商家頁自動跟著變） |
| 開哪些商家頁、標題、描述、每頁的手寫正文 | Google Sheets 的 `MerchantPages` 工作表 |
| 卡片清單、JSON-LD、SEO 文案、推薦比較的回饋數字 | 都不用改，跟著 `cards.data` 自動更新 |
| 每頁專屬的結構（注入點、警語） | `tools/build-merchant-pages.js` 的 `buildPage()` |

**每頁尾端依序有三塊**（都由 `buildPage()` 第 5 步插在推薦活動區之後、廣告列之前）：

1. **推薦比較工具列**（`<nav class="mc-related">`，2026-08-18 加）——連到其他每一個商家頁，
   每條帶「最高 X%（某某卡）」。數字取**該頁自己排第一名那列**的 `rate` 與卡名，與點進去看到的
   第一張卡一致；不用金額回推，否則兩邊會對不上。因為要列出其他頁的數字，`main()` 拆成兩輪：
   先把所有頁的卡片算完，再組頁面寫檔。
   ⚠️ 它的數字跟著 `cards.data` 走，所以**必須列進 `stripDataRegions()`**——沒挖掉的話每次
   Apps Script 匯出都會被判成「版面不一致」而擋住所有不相干的 commit。
   UI 刻意做成灰底出血的**工具列**（小字、藍字底線＋箭頭），不是卡片、不是內容區
   ——站長 2026-08-18 定調：「它是一個工具欄，有空才會看看的地方，UI 要區隔開來」。
   樣式在 `styles.css`（首頁與商家頁共用），**不在**生成器注入的那個 `<style>` 裡。
2. **SEO 說明區**（`<section class="mc-seo-footer">`）——H1 ＋ 說明文，卡片清單跟著資料走。
3. **`bodyHtml`**（`<section class="mc-body">`）——站長在工作表手寫的正文，留空就不輸出。

**日期直接寫進 HTML（2026-10-30）**：讓 Google 不執行 JS 也讀得到「這頁哪天更新」。兩處都由
`resolveUpdatedIso()` 取 `cards.data` 的 `contentUpdatedIso`（沒有就退回 `lastUpdated`，都沒有就不輸出）：

- 頁尾 `<span id="last-update-date">` 烤成 `最後資料更新：<time datetime="2026-10-18">2026/10/18</time>`；
  `js/data-loader.js` 載入資料後用同樣結構重寫一次（兩邊格式要一起改）
- JSON-LD 從 `ItemList` 改成外層 `CollectionPage`（帶 `dateModified`、`url`、`isPartOf` → 首頁的 `#website`），
  卡片清單放進 `mainEntity`。⚠️ 別把 `dateModified` 直接掛回 `ItemList`：ItemList 是 Intangible、不是
  CreativeWork，schema.org 沒有這個屬性，Google 會當無效欄位
- 日期 span 跟 JSON-LD 一樣列進 `stripDataRegions()`——日期隨匯出變動，沒挖掉就會被判成「版面不一致」擋 commit
- 首頁（index.html）也烤頁尾日期（同一個值），所以 index.html 的生成區＝工具列＋日期 span 兩塊；
  但首頁**不**注入 `dateModified`——首頁 JSON-LD 是手寫的，工具首頁靠 sitemap lastmod 就夠，
  不值得在手寫 `<head>` 裡再開一塊生成區

### index.html 既是模板、也是輸出（2026-08-18 起）

首頁也要有推薦比較工具列（站長要求：首頁是權重最高的頁，從這裡發出的內鏈最有價值，
所以要靜態 HTML、不要 JS 現算）。做法是 index.html 放一個**空的佔位**：

```html
<nav class="mc-related" aria-label="推薦比較"></nav>
```

生成器每次跑都會：**先 `stripRelatedBar()` 把它清回空佔位**當模板 → 生 7 個商家頁
（各自排除自己）→ 最後把「列出全部商家頁」的版本寫回 index.html。

- 先清空再當模板這步不能省：index.html 自己帶著上一次的結果，不清就會拿舊工具列去生商家頁
- 生成器**冪等**：同樣的 cards.data 連跑兩次，第二次應該 0 頁有變動（改壞了先驗這個）
- 三塊（工具列／SEO 說明區／bodyHtml）都掛在這同一個錨點上，順序才保證正確
- `tools/deploy-version.sh` 是**先跑生成器、再注入 `?v=`**，所以生成器寫回的 index.html
  帶的是 `?v=dev` 佔位，之後被同一支腳本換掉——順序不能對調
- 資料落後時 index.html 走的是 **dataDrift（⚠️ 提醒、exit 0）而不是 shellDrift（❌ 擋）**：
  首頁只有工具列與頁尾日期是生成的，其餘全手寫，所以差異一律當資料面看待——理由同商家頁，
  每次 Apps Script 匯出都擋住不相干的 commit 只會讓人習慣性忽略 preflight

**`MerchantPages` 工作表**（`readMerchantPages()` 讀取，匯出成 `cards.data` 的 `merchantPages`）：
`slug`（URL）、`merchant`（**搜尋詞**，要跟站上搜得到的商家一致）、`displayName`（顯示名稱，
留空＝同 merchant）、`title`、`description`、`bodyHtml`（選填，見下）、
`active`（留空＝啟用，填 FALSE 關掉）、`order`。
⚠️ `bodyHtml` 是站長手寫的正文 HTML，**信任層級同 promos：直接烤進頁面、不 escape**
（escape 掉這欄就沒用了）。所以它只能由站長自己填，任何外部來源的內容都不准進這欄。
留空就整段不輸出。位置在 SEO 說明區之後。
⚠️ `merchant` 與 `displayName` 是兩件事：linepay 頁的搜尋詞是 `LinePay`，顯示是 `LINE Pay`。
⚠️ 改 `slug` ＝換網址，舊網址變 404，非必要別動。
工作表還沒建立時退回 `tools/merchant-pages.fallback.json`（與 `.gs` 的 `MERCHANT_FALLBACK_SLUGS` 同一份清單）。

**title／description／bodyHtml 代換字（2026-11-10）**：工作表裡可以寫下列代換字，生成器部署時換成當下的值
（`resolveTokens()`），烤進 `<title>`、meta description、og／twitter、JSON-LD、正文——Google 只看得到成品：

| 代換字 | 換成 | 例 |
|---|---|---|
| `{年}` | 台灣時間的年份 | 2026 |
| `{半年}` | 1–6 月「上半年」、7–12 月「下半年」 | 下半年 |
| `{第一名卡}` `{第二名卡}` `{第三名卡}` | 這頁第 1／2／3 名的卡名 | 永豐 Sport 卡 |
| `{第一名回饋}` `{第二名回饋}` `{第三名回饋}` | 那張卡的回饋率 | 5% |

- 名次＝頁面上**不同卡片**的順序（`computeMerchantCards()` 的 `ranked`；同一張卡因多個活動出現多列時只算第一列），
  回饋率取那一列的 `rate`，與點進頁面看到的一致。第一名與推薦比較工具列同一列
- 封頂金額、達成條件等**沒有**代換字，仍是手寫——名次換人時那些句子要人工對一下
- 只在**部署時**更新：跨年後第一次匯出（＝部署）之前，頁面還是舊年份（站長確認可接受）
- 日期用台灣時間算（CF build 跑在 UTC），1/1 00:00–08:00 部署也會是新年份
- ⚠️ **打錯字會讓 build 掛掉**（如 `{年份}`、全形 `｛年｝`、落單的 `{`，或該頁卡片不到那個名次，例如只有 1 張卡的頁寫 `{第二名卡}`）：
  這是刻意的，否則那串字會原封不動出現在 Google 搜尋結果或頁面上。build 掛掉時線上維持舊版，錯誤訊息會寫出哪一頁、
  哪個欄位、支援哪些字；到工作表改好再匯出一次。⚠️ 所以 `bodyHtml` 裡**不能出現任何大括號**（例如 `<style>` 區塊）
- `bodyHtml` 換進去的卡名會先 `escapeHtml`（卡名可能含 `&`）；title／description 不先 escape，因為 `buildPage()` 會整串 escape
- 標題、描述、`mc-body` 正文因此都列進 `stripDataRegions()`——會隨日期與 cards.data 變，不挖掉就會被判成「版面不一致」擋 commit

**卡片清單怎麼算出來的**：`tools/lib/merchant-cards.js` 用 Node 的 `vm` 把 `js/` 那些模組
**原封不動載進來跑**，不另寫一套比對規則——另寫一套就是「頁面講一套、JSON-LD 講另一套」的病根。
它照抄 `loadCardsData()` 與 `calculateCashback()` 的完整流程，四個步驟一個都不能少：

1. `filterExpiredRates` —— 濾過期活動
2. `mergeDataSearchExclusions` —— 併入 SearchExclusions 排除規則
3. `buildCardItemsIndex` —— 建搜尋索引
4. 商家名若等於某個「一次比多家」型快捷搜尋的 `displayName`（如「所有計程車」）→ 走 `handleQuickSearch` 的多關鍵詞路徑；「協助輸入」型（`merchants` 只有一個關鍵詞，如 LinePay）在頁面上等同用戶打字，這裡也當一般搜尋。分界由前端 `isTypingHelperQuickOption()`（`js/data-loader.js`）決定，這支工具直接呼叫它、不另寫一份（2026-10-08；之前 LinePay 頁走快捷路徑，因而不受精準搜尋影響、也不顯示 Search Hints，跟首頁打字不一致）

**踩過的坑（都會讓清單與畫面對不上，且不會報錯）**：

- `js/core-utils.js` 會把 `console.log/warn` 靜音。傳給 vm 的 `console` 必須是獨立物件，
  否則它連 Node 這邊的 console 一起關掉，除錯時畫面全黑
- 模組頂層的 `let cardsData` 是 vm context 的**語彙綁定**，不是 global 屬性——
  從外面 `ctx.cardsData = x` 只會多一個沒人看的變數，必須用 `runInContext` 從裡面指派
- 漏掉 `mergeDataSearchExclusions` → linepay 頁多出「LINE Pay 找體驗 APP」，排名整個變了
- `calculateCashback` 每處理完一個匹配項就先排序才累加，最後才總排一次。JS 的 sort 是穩定
  排序，少了那個先排，同分的卡片順序就會不一樣

**驗證方式（改了 `js/` 或這支工具就要重跑）**：

```bash
node tools/build-merchant-pages.js --verify   # 用 Playwright 開真頁，逐筆比對畫面 vs 烤進去的清單
```

這是「Node 版引擎 == 前端引擎」的唯一證明。不一致就是兩邊分岔了，先修再部署。

**接在哪**：`tools/deploy-version.sh`（CF Pages build command）在注入 `?v=` **之前**先跑生成器
——生成出來的頁帶 `?v=dev` 佔位，靠後面那圈迴圈一起換成 commit hash。生成失敗直接讓 build 掛掉
是刻意的：商家頁的病就是「沒人發現它過期」，吞掉錯誤等於把病放回去。

## 12. Apps Script 相關的既有文件

- `apps-script/README.md`：權益監控（checkWatchlist、Watchlist 工作表、MONITOR_CONFIG）。2026-08-16 監控摘要「假新增」的修法（`refineDiff_` 比詞、prompt 規則 D1–D4：要說新增，該詞必須在程式算出的新詞清單裡）與 6 分鐘執行上限的接力設計都在那裡
- **凡是「每列都打外部 API」的 Apps Script 迴圈**，一律照 `checkWatchlist` 加「開跑前看錶」煞車（`maxRunSeconds`）＋指令碼屬性進度游標（要設過期時間）＋一次性觸發器接續。Apps Script 單次 6 分鐘硬上限是直接砍掉，收尾的寄信會無聲消失；清接力觸發器只能比對 `uniqueId`，掃著刪會把週期觸發器一起刪掉（2026-09-11）
- `BENEFITS-AUTOMATION-PLAN.md`：權益自動化整體規劃
- `CARDS-DATA-CACHE-README.md`：快取機制教學
- `FIRESTORE-RULES-README.md`：Firestore 規則套用教學（規則本體在 repo 的 `firestore.rules`，唯一正確版本）

## 13. Sheets 內的編輯工具（不是工作表）

（2026-11-22 從第 2 節第 15–17 項搬來，那一節只放工作表本身。）

1. **單卡編輯器**（2026-11-11）—— 不是工作表，是 Cards Data 的直式操作介面（大視窗）（`apps-script/card-editor.gs` ＋
    `CardEditor.html`，選單「🎯 卡片管理 ▸ 📝 單卡編輯器」）。依標題名稱動態對應欄位、只寫改過的格子、公式欄唯讀、
    存檔前跑 `pmcValidateCardRow_`（`cards-export.gs`，與 `runQACheck` 檢查 12 共用）、級別改名／刪除／預設級別換人要確認。
    **改 Cards Data 的欄位命名規則（如新增 `xxx_N` 槽位欄）時**：編輯器自動吃新欄，但若新欄是數字／日期／勾選框，
    要把它加進 `card-editor.gs` 頂部的 `CE_NUMERIC_*`／`CE_DATE_RE_`／`CE_BOOL_RE_`，否則會被當成文字寫入。
    2026-11-15 加槽位工具列：複製到空槽位／清空／還原這個槽位（純畫面操作，存檔路徑不變）。**刻意不做槽位搬移**——
    槽位編號被 `cashbackModel` 的 `rate_N` 與 `levelSettings` 的 `onlySlots`／`keepSlots` 引用，搬了會悄悄錯位。
    改 `CardEditor.html` 後跑 `node tools/apps-script-tests/card-editor-ui-test.js`。
    安裝與保護機制見 `apps-script/README.md`「單卡編輯器」
2. **新戶活動編輯器**（2026-11-11）—— New Cardholder Promos 的「一張卡一頁」介面（`apps-script/promo-editor.gs` ＋
    `PromoEditor.html`，選單「🎁 新戶活動編輯器」）。申辦按鈕視為卡片層級（改了寫到原本有填的每一列）、新增活動插在同卡最後一列下、
    不提供刪除（下架＝取消 active）、存檔前跑 `pmcValidatePromoRow_`（與 `runQACheck` 檢查 13 共用，一律 ⚠️）。
    改這張表的欄位時：數字欄要加進 `promo-editor.gs` 的 `PE_NUMERIC_FIELDS_`、日期欄加進 `PE_DATE_FIELDS_`，
    想在畫面上分到某組就加進 `PE_GROUPS_`（沒加的欄位自動出現在「其他欄位」）。說明見 `apps-script/README.md`「新戶活動編輯器」
3. **活動快寫**（2026-11-12；11-13 搬進試算表）—— 不是工作表，是「貼一段活動原文 → 解析 → 寫進表」的工具，
    選單「🎯 卡片管理 ▸ ✍️ 活動快寫」（少量活動用，批量仍走自動化檔的 3-貼上原文 → 4-待審核）。
    - **三層檔案**：來源在 `tools/activity-writer/`（`index.html`＋`parser.js`＋`app.js`）→ `build-apps-script.js` 併成
      **生成檔 `apps-script/ActivityWriter.html`（禁止手改，preflight 會擋不一致）**；試算表端是 `apps-script/activity-writer.gs`
    - **改了 `tools/activity-writer/` 任何一支 → 跑 `node tools/activity-writer/build-apps-script.js`、生成檔一起 commit**；
      合併進 main 後 GitHub 自動部署到「PMC 管理系統」（`deploy.json` 第二個專案，**只列這兩支**；`cards-export.gs` 等仍手動貼）
    - **三種活動**：一般活動（`rate_N` 那組）、領券活動（`couponMerchant_N` 那組，2026-11-13 加入，只有規則解析、沒有 AI）、新戶活動。
      自動判斷順序：有新戶字樣 → 新戶；否則有領券／優惠券 → 領券；其餘一般
    - 寫入不自己做，交給兩個編輯器：一般／領券活動 → `cardEditorSave`（寫進選定的 `rate_N` 或 `couponMerchant_N`，有內容的槽要按兩次才覆蓋，
      空的 `daysRemaining_N`／`period_N` 補公式）；新戶活動 → `promoEditorSave`（插在同卡最後一列下面）。
      **依欄名寫入**，所以欄位順序變動不影響寫入（只影響「複製一列」→ 那個要改 `parser.js` 的 `RATE_COLS`／`PROMO_COLS`）
    - 資料讀**表上現況**（`activityWriterInit`）；只有快捷搜尋／統一詞表／行動支付別名沿用線上 `cards.data`，讀不到照樣能用
    - **規則解析為主、不需要 AI**；「用 AI 重新解析」是選用的（Gemini，金鑰＝該專案的指令碼屬性 `GEMINI_API_KEY`）
    - `tools/activity-writer/index.html` 直接開是**本機開發／測試版**（讀 `cards.data`、只能複製、不能寫入）。
      **正式網址 `/tools/activity-writer/` 已於 2026-11-14 下架**：`tools/deploy-version.sh` 在 Cloudflare Pages 部署時（`CF_PAGES=1`）
      把整個 `tools/activity-writer/` 從部署內容刪掉；repo 裡的檔照留（生成檔的來源＋測試）
    - **審核區**（2026-11-14）：黃色（`notes[欄].level === 'check'`）的格子集中在「需要你審核」，每格一個勾選框；
      `conditions`／`promo_condition`／`couponConditions` 不論信心一律進審核區。**寫入與複製只出綠色＋有勾的，沒勾的那格送空值**
      （`app.js` 的 `outFields()`；覆蓋既有槽時空值會把那格清掉）。親手改過的格子自動打勾；原文變了重新解析，勾選重來。
      率、通路與新戶必填（`MUST_CONFIRM`：rate／items／couponRate／couponMerchant／bonus_rate／bonus_merchants／promo_types／new_customer_summary）
      在審核區沒勾 → 擋下不寫。要讓某欄「預設就要審核」→ 在 `parser.js` 把它的 note 設成 `check`，或加進 `app.js` 的 `ALWAYS_REVIEW`
    - **一次貼進多個活動**（2026-11-14，`parser.js` 的 `splitActivities()`）：只有**行首、【】、帶編號**的標題（【活動1】【活動2：…】，
      也收「優惠／方案」＋數字）出現兩個以上才提供「拆成 N 個分頁」——一頁一個活動、各自判斷類型、各自寫入，不同畫面顯示；
      標題前的共用段（活動期間）與最後的注意事項每頁都帶，內文點名「活動N」的句子只給被點名的那幾頁。
      其餘情況（只在內文提到活動2、幾個【】段落的回饋率不同）**只提示不拆**——拆錯比不拆糟，別放寬成自動拆
    - 解析規則在 `parser.js`（與 `card-benefits-parser.gs`／`benefits-parser.gs` 的 prompt 規則同調，**改一邊的欄位寫法規則要看另一邊**）
    - 新戶活動的幾條判讀規則（2026-11-13 依站長實測調整，樣本是 `samples.js` 的 `promoInsurance`）：
      **特定族群新戶**（原文有「保險新戶定義：」這種帶族群名的定義）用原文的定義、不沿用同卡現有的全行新戶定義；
      **`bonus_rate` 只填這檔活動自己加碼的部分**（最高 8% ＝ 加碼 6% ＋ 原權益 2% → 0.06，合計數字只放摘要）；
      **`bonus_merchants`** 有具體商家用商家、沒有就用類別詞（保費），付款方式／被排除的支付工具／時段（假日）不算通路；
      **`promo_condition`** 本文有條列用條列，沒有就從本文挑句子拼草稿，「注意事項」之後的 (1)(2)(3) 是細則、最後才用；
      **領券≠登錄**，且只抄原文寫出來的限制（不自己補「與其他新戶活動擇一」）；`priority` 欄 2026-11-13 已刪（全表都是 99；匯出找不到這欄一樣當 99，前端排序不受影響）
    - 一般／領券共用的判讀規則（2026-11-13 第二個實測樣本 `cubeCoupon`）：**`category` 只在原文整個出現既有分類名、或有短的【】標題時才填，
      其餘留空**（不取第一行、不猜）；排除條款只取到逗號、去重、最多 3 條，不收「等排除商品」這種形容詞用法、括號內補充、分期利率樣板；
      「本活動限…」整句照抄成條件；有具體商家時支付工具與時段（假日）不進通路；認卡看別名出現次數與後面有沒有接「卡」
    - 版面是 12 欄格線（`app.js` 的 `RATE_FIELDS`／`PROMO_FIELDS` 第 4 個值＝佔幾格），說明文字預設收成一行、點一下展開；
      `ui-test.js` 會擋「新戶 26 欄排不進一個畫面」
    - 測試：`node tools/activity-writer/parser-test.js`（解析）、`node tools/activity-writer/ui-test.js`（介面：本機版＋試算表視窗版，伺服器與 AI 用假回應）、
      `node tools/apps-script-tests/activity-writer-test.js`（試算表端寫入＋自動部署，假試算表）

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）

> 2026-11-22 精簡：原有 13 條已全數歸入正文（promos 的 CSS 與生成器坑進 9f（現 `promos.md` 第 9 節），其餘進第 2、8、12 節；監控兩條的細節本來就在 `apps-script/README.md`），原文見 `docs/archive/data-pipeline.md-2026-11-22.bak`。新教訓照常追加在這行下面。
