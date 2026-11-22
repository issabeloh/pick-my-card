# promos 頁（新戶活動一覽 /promos）

> 2026-11-22 從 `docs/project/data-pipeline.md` 第 9 節搬出成獨立檔（原文備份 `docs/archive/data-pipeline.md-2026-11-22-promos.bak`）。
> 舊編號對照（歷史 commit、.bak、外部筆記裡的舊引用用這張表換算）：
> 9 → 第 1 節｜9a → 第 2、3、4 節｜9b → 第 5 節｜9c → 第 6 節｜9d → 第 7 節｜9e → 第 8 節｜9f → 第 9 節

## 1. promos.html 靜態生成（2026-07-15 新增）

`promos.html`（＋獨立的 `promos.css` / `promos.js`）是給 SEO／社群轉貼用的「新戶活動一覽」
落地頁，內容**不是手寫、也不是前端 fetch cards.data 動態組出來**——是 Apps Script 匯出時
用純函數把 HTML 字串直接生成好，跟 cards.data 一起 commit 進 repo。

- **生成邏輯的唯一事實來源**：`apps-script/cards-export.gs` 內的 `generatePromosPageHtml(exportData)`。
  它是純函數（吃組好的 `{ cards, newCardholderPromos, cardApplyCtas }` 物件、回傳完整 HTML
  字串），內部**不呼叫任何 Sheets/Apps Script API**（連 `Utilities.formatDate` 都不用，改用
  自己的 `pmcTodayISO_()`），所以同一份程式碼可以直接被 Node 的 `vm` 載入執行——這是刻意設計，
  避免「Apps Script 版」和「repo 初版」各寫一份生成邏輯而分岔。
- **呼叫點**：`exportToJSON()` 讀完 `newCardholderPromos` / `cardApplyCtas` 後立刻呼叫
  `generatePromosPageHtml()`，產出的 HTML 字串跟著 `cards.data` / `cards.version` 一起
  丟進 `publishToGitHub(encoded, promosPageHtml)` → 同一次 commit 三個檔案。
- **repo 初版怎麼來的**：用臨時 Node harness（放 scratchpad，不留在 repo）以 `vm.runInContext`
  載入 `cards-export.gs`、餵 cards.data 解碼後的 JSON（跑過 `tools/cards-query.sh` 後快取在 `$TMPDIR/cards-decoded.json`），呼叫
  `generatePromosPageHtml()` 產生 `promos.html`。之後每次 Apps Script 端跑 `exportToJSON()`
  都會用真正的 Sheets 資料重新生成、覆蓋這份檔案——**repo 裡的版本只是初版備份，最新內容以
  GitHub 上次 commit 的為準**。
- **⚠️ 改生成邏輯務必兩邊同步**：跟其他 `apps-script/*.gs` 一樣，實際執行的版本在 Google
  Sheets 的 Apps Script 專案裡；改了 `generatePromosPageHtml` 或它的小工具函數，要把整份
  `cards-export.gs` 貼回 Sheets（見 `apps-script/README.md`），否則下次匯出還是跑舊邏輯、
  repo 的新版程式碼形同沒生效。
- **`<!-- PROMOS:START -->` / `<!-- PROMOS:END -->`**：包住 `promo-grid` 那塊卡片列表，
  方便日後對 diff／除錯（一眼看出「這次匯出改了哪些活動」，不用整份 HTML 比對）。
- **過期過濾＋排序**：生成時只保留 `period_end` 未到期（或無 `period_end`＝不限期）的活動，
  依 `period_end` 升冪排序（無截止日排最後）；日期解析走生成器自帶的 `pmcNormalizeDate_()`，
  同樣容忍 `data-pipeline.md` 第 8 節說的 ISO／台式雙格式，不假設只有一種。
- **versionTag 含台北時分**（2026-07-16 起）：promos.css/js 的 `?v=` 為 `YYYYMMDDHHmm`，同日多次匯出也能破快取。代價是重生成不再天然位元級一致——**做位元級重現驗證時，exportData 傳 `versionTagOverride: '<repo 版的 tag>'` 固定它**再比對。
- **「資料更新於」戳章只在活動內容真的變動時前進**（2026-07-23 起，`promosUpdatedIso`）：頁腳
  `<time datetime>` 戳章、`sitemap.xml` 的 promos `lastmod`、`<head>` 的 `CollectionPage`
  JSON-LD `dateModified` 三處**同源**，都用這個日期（可見戳章 `.promos-data-update` 2026-07-23 起
  放在 `.promos-controls` 下方、`.promo-grid` 上方，不再在頁尾）。它**不是每次匯出的今天**——`exportToJSON`
  先用 `pmcPromoSignature_(newCardholderPromos)`（每筆各自序列化後排序的內容指紋，djb2/`Math.imul`
  純函數，不受 sheet 列序影響）跟 Script Properties 的 `PROMOS_LAST_SIG` / `PROMOS_LAST_DATE`
  比對：指紋相同就沿用上次日期，不同（或首次）才蓋 `pmcTodayISO_()` 並寫回。**為什麼不每次蓋今天**：
  對 Google 天天喊 `lastmod` 更新但內容沒動會反被降低重爬信任（狼來了）；只在真的更新時前進才誠實。
  **注意別跟 `todayIso` 混用**：過期過濾與 versionTag 快取破壞仍必須用「實際今天」（`todayIso`），
  只有這三個對外「新鮮度信號」才用 `updatedIso`。生成器是純函數、拿 `exportData.promosUpdatedIso`
  當參數（沒傳退回今天，供 Node 初版 harness 用）；比對狀態存 Script Properties 是刻意選的——
  Apps Script 端持久化、不佔 repo 檔案、不多一個 commit、維護者流程零改動（代價：repo 看不到、
  Node harness 重現不了，但初版本來就以 GitHub 上次 commit 為準）。
- **前端 `promos.js` 只做「已經是資料」之上的互動**：剩幾天徽章即時重算（避免生成當下算好的
  天數過幾天就過時）、篩選 chips、排序切換（deadline / 依卡片）、「立即申辦」點擊送 GA4——
  不 fetch 任何東西，頁面本身就是完整資料。
- **⚠️ header／footer 是從 `index.html` 手動複製過來的**：
  `pmcPageTemplate_()` 裡的 `<header class="promos-header">`、
  `.promos-warning-row`（謹慎理財警語）、`.social-media-footer`（探索更多／追蹤我們／
  支持我們）三段，內容與樣式都是照 `index.html` 對應區塊（`header`／`.finance-warning-row`／
  `.social-media-footer`）手動抄的，**不是共用元件**。主站改這幾塊時（換連結、改文案、換
  社群帳號），這裡要記得手動同步，否則 promos 頁會悄悄跟主站不一致。`promos.css` 裡對應的
  樣式規則也在同一段加了「抄自 styles.css」的註解，方便對照。
  **2026-07-16 header 一致化改版**：header 現在不只是 logo＋站名＋深藍 bar，還含桌機導覽
  （新戶活動／常見問題，本頁帶 `aria-current="page"`）與手機漢堡抽屜（兩張卡片連回 `/`
  工具頁與 `/faq`）。互動邏輯（抽屜開合）寫在 `promos.js` 開頭「手機漢堡側選單開合」一段，
  介面與 `faq.js` 同款。**`faq.html` 的 header 也是同一份 `index.html header-top` 的
  手抄件**（見 `FAQ-README.md`）——這下有三份手抄件互相要對齊：`index.html` 改動時，
  `promos.html` 的生成器（本節）與 `faq.html`／`faq.css`／`faq.js` 都要跟著手動同步，缺一邊
  就會悄悄跟另外兩邊不一致。
  **同日二輪回饋**：header 右側原本試過頭像＋精簡 dropdown（訪客「註冊／登入」、登入者
  「前往主站管理」），站長裁定「副頁頭像做不到主站完整功能（無法登出/管理），意義不大」，
  已撤回改為「返回首頁」鈕（`promos-back-home-btn`，連回 `/`；faq.html 對應 `.back-home-btn`
  連回 `index.html`）——**header 不含任何登入/頭像狀態**，也不再 import firebase-auth。
  同一輪還加了：可見麵包屑（hero 上方一行小字，`.promos-breadcrumb`／`.faq-breadcrumb`）＋
  `<head>` 內的 BreadcrumbList JSON-LD（`pmcBuildBreadcrumbJsonLd_()`，與既有 ItemList/FAQPage
  JSON-LD 並存）、浮動「回到頂部」鈕（`.promos-back-to-top-btn`／faq 重用 styles.css 既有
  `.back-to-top-btn`，手機限定、捲動 >300px 顯示，行為同主站）、手機抽屜工具卡改色（promos
  側 `.promos-sidebar-tool-card` 改糖果薄荷色＋💳 emoji，與 FAQ 卡區隔）、FAQ 側手機抽屜的
  「新戶活動一覽」卡（`.sidebar-promos-banner`）在 `faq.css` override 壓平立體感（不改
  `styles.css`，`index.html` 自己的抽屜不受影響）。
  > 註（2026-07-17 本輪移植）：舊分支同一次改版另外文件化了 `.promo-card-info-btn`
  > 深連結（`/?start&card=<id>`）的設計，但 main 分支同期已把 ⓘ 按鈕升級成 iframe 內嵌
  > 詳情彈窗（方案 A，深連結只當攔截失敗的 fallback）——那段說明已過時，**不portover**；
  > 完整、與現狀一致的說明在 `docs/project/ui-display.md` 第 1 節「Embed 模式」。

- **新戶活動編輯器**（Sheets 端的「一張卡一頁」維護介面）見 `docs/project/data-pipeline.md` 第 13 節。

## 2. 卡片骨架與附屬列（2026-09-17 改版：一張卡一組）

站長回報「資訊層級不對：應該馬上看到獎勵，被吸引後才看到是哪張卡送的」。改版後：

**版面**（`pmcRenderCardGroup_` 取代舊的 `pmcRenderPromoCard_`）

- **一張卡一組**，不再一檔活動一張卡片（iLEO 4 檔、遠東快樂卡 4 檔、中信 uniopen 4 檔
  以前會出現 4 次）。主活動在白卡 `.promo-card-main` 裡，同卡其餘活動以「卡疊卡」
  堆在下面（`.promo-card-stack`，上緣方角、只留下方兩個圓角、逐層內縮）
- **多檔活動的卡＝「左側品牌欄」骨架**（做法 A，2026-09-21 站長定案；參考
  Booking.com「一間飯店、多種房型」與 MoneySuperMarket 商品列）。
  `pmcRenderCardGroup_` 依 `acts.length` 走兩條路：
  - `=== 1`：**同樣有身分區塊**（2026-09-21 站長：單檔卡要更像多檔卡）——
    `.promo-card-rail--solo`＝**橫向身分列**：小卡圖（84px）在左、卡名在右，
    **兩顆按鈕跟多檔卡一樣住在 rail 裡**（2026-09-21）：桌機與手機都是
    「卡片圖＋名稱 → 按鈕 → 分割線 → 活動內容」。放進 rail 才會在分割線**上方**——
    rail 的 `border-bottom` 就是那條線，按鈕留在 `.promo-card-main` 裡怎麼排都在線下。
    刻意與多檔卡**在手機上**的身分區塊長得一模一樣，零件／尺寸／間距全部共用
    （站長從三案中選定「方案 3 橫向身分列」，見 docs/mockups 的實測比較）。
    **不放「1 檔新戶活動」那一行**（站長指定）：只有一檔時它跟正下方的獎勵數字重複
  - `> 1`：`.promo-card-rail`（卡圖／卡名／「N 檔新戶活動・最多可拿 …（需分別達成）」／立即申辦／
    卡片特色）＋ `.promo-card-main`（最高那一檔的完整卡）＋ `.promo-card-stack`
    （第 2 檔起的附屬列）。桌機 `grid-template-areas` 是
    `"rail main" / "rail side" / "feat feat"`，品牌欄跨兩列；手機品牌欄橫在最上面。
    白卡表面移到 `<article>` 本身，main／stack 只是它的分區
- **左欄那句「N 檔新戶活動・最多可拿 NT$X（需分別達成）」**（`pmcRailCount_`）：
  金額是同卡多檔**相加**出來的，所以「（需分別達成）」不能省——每一檔的達成條件都不同，
  少了這句會被讀成「刷一次就拿得到」。首刷禮沒有現金價值，改成「＋N 項首刷禮」分開講。
  2026-09-21 從「最高可拿」改成現在的寫法
- **左欄那句是「N 檔活動・最多可拿 …・需分別達成」**（站長 2026-09-22 定稿）：
  不寫「新戶活動」——整頁都在講新戶活動（title／h1／description／每張卡的「新戶定義」
  都有），這句是版面標籤不是內文；「需分別達成」也不再自己佔一行，改用「・」接在後面
  （`.promo-rail-caveat` 只保留小一階字級＋`nowrap`，不再 `display: block`）。
  SEO 實測：可見文字裡「新戶活動」17 → 10 次，但 title／h1／description／canonical／
  三段 JSON-LD **逐字未變**，h1/h2/h3 數量也未變
- **首刷禮的主活動不再重複印「首刷禮」**（2026-09-22）：大字已經是獎品全名、上方又有
  類型徽章，`pmcRewardSub_` 原本再回一次「首刷禮」給 `<small>`，同一張卡上出現兩遍。
  改成回空字串，並讓 `pmcRenderPromoAct_` 在空字串時**整個 `<small>` 不輸出**——
  留一個空標籤會被 `.promo-act-reward small` 的 `margin-top` 撐出一條沒有東西的空白
- **附屬列上方沒有標題**：曾經有一行「這張卡的其他 N 檔活動」，2026-09-21 站長認為
  多餘而移除——附屬列的形狀已經說明歸屬，檔數在左欄也講過一次了
- **兩種骨架共用 `.promo-card-rail`**，差別只在修飾字：`--solo`（單檔卡，永遠是橫幅）
  與 `--side`（多檔卡，桌機時變成左邊那一直欄）。因此 2026-09-21 收掉了三組
  「單檔／多檔各一份」的 CSS：白卡表面（改掛在 `.promo-card` 本身）、卡名樣式
  （不再是自帶框線的白色橫幅）、主活動藏卡片圖（改成對所有卡生效）
  - **`.promo-card-name` 沒有任何覆寫規則**：單檔／多檔、手機／桌機四種情況同一個
    字級與零內距（白卡表面掛 `<article>`、內距由 rail 給）。2026-09-21 清掉兩條遺留——
    多檔卡專屬的「取消橫幅樣式」與桌機的 `padding: 12px 16px 9px`（後者讓卡名平白
    高了 21px、又右移 16px）
  - **主活動的卡片圖一律藏起來**（`.promo-card-main .promo-act-thumb:not(--gift)`）——
    身分區塊已經有一張，藏掉它活動摘要才用得到整列寬度。
    獎品自己的活動宣傳圖仍然顯示，那是該檔活動獨有的資訊
- **手機專屬的版面調整一律寫進 `@media (max-width: 1024px)`**（2026-09-21 立）：
  這支 CSS 是 mobile-first，base 規則會一路套到桌機，**只有寫進 max-width 才保證
  不影響桌機**。收到「只改手機」的需求時不要去動 base。
  驗收方式：改動前先用 Playwright 對桌機（1440／1280）拍一份幾何快照
  （每張卡的 x/y/w/h、附屬列各欄寬高、摘要行數），改完再比對——2026-09-21 那批
  五項手機調整就是這樣證明「桌機幾何零差異」的。
  - 目前這段裡只剩兩件事：附屬列收掉沒有圖片時的空位與金額欄寬、摘要與附屬列標題
    多顯示一行。⚠️ **手機規則會過期**：單檔卡按鈕那條 `order: -1` 在按鈕搬進
    `.promo-card-rail--solo` 之後就失效了，卻還留著一個 `margin-top: 0`，害按鈕
    貼死在卡片圖下緣（2026-09-21 站長回報）。改了標記結構，要回頭掃這一段
  - **顏色與字級是例外**：同一個東西在手機與桌機不同色／不同大小，那是 bug 不是設計
- **第 2 檔起是「附屬列」不是卡片**（取代原本的卡疊卡），2026-09-21 晚上再從「三欄一排」
  改成**一列兩排**（方案 B，站長在三案 mockup 中選定）：

  ```
  ┌ 上排：[類型 chip] 這一檔的「值」        ┐  [獎品圖] 詳情 ▾
  └ 下排：活動摘要（灰色小字）              ┘
  ```

  - **值＝這一檔能拿到什麼**，三種類型共用同一個起點，這就是「對齊」：
    首刷禮→獎品全名、回饋加碼→回饋率、定額回饋→金額
  - 🔴 **為什麼不能用「欄」對齊**：桌機一條附屬列的內容寬只有 **426px**，而現行最長的
    獎品名 43 字、17px 排一行要 **731px**——比整列還寬。用欄位對齊就一定得截斷獎品名
    或把摘要欄壓到 194px；讓值自己佔一排，寬度限制整個消失（實測三列整疊 206px、
    摘要欄 374px）。日後有人想「把值欄撐寬就好」，先回來看這段
  - **類型 chip 在上排最左**，包在固定寬度的槽 `.promo-sub-types`（`min-width: 62px`
    ＝最寬的單一 chip「定額回饋」），右邊的值才對得到同一條線。少數活動有兩個類型
    （61 檔中 5 檔、附屬列 16 條中 1 條），那幾列的槽會被撐開、值跟著右移——
    **刻意用 15/16 的對齊換「不丟掉任何一個類型」**
  - **chip 的顏色 token 與主活動的 `.promo-type-badge` 共用**（`--pmc-candy-*`）。
    2026-09-21 就是因為附屬列自己硬寫顏色，同一張卡上「首刷禮」出現兩種顏色。
    **形狀不共用**：主活動那顆是「從卡框長出來的 label」（只有右下圓角），
    放進列裡要用一般 pill
  - ⚠️ **2026-11-17 起類型徽章與篩選鈕已全部改灰（見第 6 節「顏色減量」），以下配色是歷史紀錄。**
  - 🔴 **類型徽章的選色有兩個禁區**（2026-09-21 晚上站長回報後定案）：
    **紅／粉**會跟「最後 N 天」倒數徽章（`#dc2626` 紅字紅框）混淆、**綠**會跟獎勵數值的
    文字色（`--pmc-hero-green` `#10b981`）撞在一起。現行配色＝首刷禮**紫**
    `--pmc-candy-purple-*`、回饋加碼**黃** `--pmc-candy-yellow-*`、定額回饋**棕**
    `--pmc-candy-brown-*`（站長指定；棕與黃是鄰近色，分辨靠的是**底色飽和度**——
    黃底 `#fff3c4` 是鮮明糖果黃、棕底 `#ece0d6` 是去飽和米灰，只改文字色會分不出來），
    未知類型 fallback＝灰 `--pmc-candy-slate-*`。四組的文字／底色對比都在 5.2:1 以上。
    **篩選 chip 也用同一組色**（`.promo-chip--gift/--bonus/--voucher`，站長 2026-09-21：
    「讓用戶更容易連結」）：收起＝白底＋淺框＋深字，**選取＝徽章本人的淺底＋深字**
    ＋外框加粗成 2px（`inset 0 0 0 1px` 疊第二圈，不改 `border-width` 才不會位移）。
    ⚠️ 選取態**不能**用深色實心底＋白字——那等於把徽章的顏色整個換掉，反而連不回去
    （2026-09-21 先做了深色版，站長當天回報）。
    ⚠️ 那幾條 CSS **必須排在 `.promo-chip.is-active` 之後**——
    兩者 specificity 打平，靠後定義才蓋得過主站藍。
    ⚠️ **未解**：`全部` 與 `即將結束` 的選取態仍是深色實心底＋白字，跟三顆類型 chip
    不同語言（頁面預設就停在「全部」，所以一進站看到的就是深色那顆）。等站長決定。
    ⚠️ `--pmc-candy-pink-*` 與 `--pmc-candy-mint-*` 沒有類型徽章在用，**但別刪**：
    pink 給 `.promo-feat-hype`（四種誇飾詞 2026-09-21 起統一用它，原本一種一色——
    那四個詞跟「類型」是兩套不相干的分類，共用色盤只會讓人以為有對應關係，而且
    「無腦刷」的薄荷就貼著同一列的綠色回饋率）、mint 給側欄工具卡
    （`.promos-sidebar-tool-card`，**與類型完全無關**，純粹是側欄那張卡自己的底色）。
    ⚠️ token 一律用**顏色**命名不是角色命名——原本的 `--pmc-candy-default-*` 已改名為
    `--pmc-candy-purple-*`，因為「哪個類型用哪個顏色」本來就會變
  - **獎品圖在右側、「詳情」的左邊，42px＝上下兩排文字的高度**（站長 2026-09-21 指定）。
    點了開 lightbox（沿用 `setupGiftLightbox`，`stopPropagation` 擋掉展開詳情）；
    同組只要有一列有圖，沒圖的列補 `.promo-sub-thumb.is-empty` 等寬空位，「詳情」才對齊
  - 🔴 **`.promo-sub-meta` 跨兩排、垂直置中**，所以獎品圖與「詳情」的位置**與文字行數無關**，
    展開收合都不動。改成 grid 之前這裡靠 `[aria-expanded="true"]` 切 `align-items`
    再補 `margin-top: 1px`，結果每一列點開瞬間整排跳位（通則見第 9 節「CSS」：對齊方式與展開狀態無關）。
    **別再把排版綁回互動狀態**
  - 下排摘要兩行封頂（最長一筆 79 字），展開後整段攤開；兩個寬度共用同一組規則
  - 收合那行的右側固定是「詳情 ▾」（主活動那顆維持全稱「活動詳情 ▾」）。補充說明
    只出現在展開後：回饋加碼是「最多可拿…・上限消費…」的段落，定額回饋是 `<dl>`
    第一列的「回饋類型：OPENPOINT」，**首刷禮沒有**——它的摘要就在下排，再放一次會重複。
    `pmcRenderPromoDetail_()` 因此有 `leadHtml`（段落）與 `leadRowHtml`（`<dl>` 第一列）兩個鉤子
- ⚠️ 歸屬提示改過三版，別再走回頭路：①「第 2 檔向右延伸＋第 3 檔以後向下逐層內縮」
  （太亂、越縮越小）②「等寬卡＋欄間一支淺藍箭頭」（要求拿掉箭頭）
  ③「卡名橫跨兩欄的白色橫幅」（橫幅七成是空的、底下兩根柱子長度差很多，看起來怪）。
  現在身分整個收進左欄，不需要任何額外符號
- **每檔活動各有自己的詳情**（`pmcRenderPromoDetail_`：適用通路／達成條件／活動期間／
  新戶定義／備註）。同卡多檔的條件不同，所以詳情掛在活動上、不是卡片上。
  同組內一次只開一個

## 3. 排序、大字、格線與篩選列（2026-09-17 改版續）

- **回饋加碼的大字是「回饋率」不是金額**（2026-09-21 站長）：`pmcRewardBig_` 對
  `pmcIsBonus_()` 為真的活動輸出 `pmcRateDisplay_()`（「10%」），金額退到小字
  `pmcRewardSub_`＝「最多可拿 NT$2,000・上限消費 NT$20,000」。附屬列的金額欄同理。
  - **金額放小字的前面**：它是結果、上限是條件，而附屬列的 meta 會被寬度截斷，
    截掉條件比截掉結果好
  - `pmcIsBonus_()` 抽成一支給三個呼叫端（大字／小字／附屬列）共用，判斷順序與
    `pmcPromoValue_` 一致：**voucher_amount 優先**，一列同時有兩種欄位時當定額回饋
- **排序：首刷禮優先 → 回饋率大到小 → 回饋金額大到小**（2026-09-21 站長定序；
  `pmcPromoSortKey_` 回傳 `{tier, primary}`，比較規則是 tier 升冪、primary 降冪）：
  - tier 0 首刷禮（沒有現金定價）／tier 1 回饋加碼（比 `bonus_rate`）／
    tier 2 定額回饋（比 `voucher_amount`）
  - **組內與組間同一套**：組間用「該組最前面那一檔」的鍵（`g.sortKey`）
  - 為什麼改：大字改顯示回饋率之後，舊的「一律依金額」會讓清單看起來沒有規律
    （2% 排在 10% 前面）。⚠️ 排序用的一律是**單檔**數字，不相加
  - ⚠️ `pmcRateNumber_` 是排序專用的數值版——`pmcRateDisplay_` 回傳的是給人看的
    字串（「10%」），不能拿來比大小。Sheets 可能存 0.1 也可能存 10，一律正規化
- 排序切換 UI 已移除（保留類型 chips 與「隱藏我持有的卡片」）。舊規則「一律依最高可拿倒序」與當時的警語
  已移到 `docs/project/history.md` 2026-09-21 條。
- **三種獎勵換算成同一單位「最高可拿」**（`pmcPromoValue_`，大字／小字顯示用；排序只有定額回饋那一層用到它）：
  定額回饋＝`voucher_amount`；回饋加碼＝`bonus_rate × bonus_cap`（`bonus_cap` 是消費上限，相乘即回饋天花板）；
  首刷禮沒有現金定價，大字改放贈品全名。**⚠️ 同一張卡的多檔活動各自獨立、不相加**
  （各有不同達成條件），排序只看單檔
- **同一列的卡片等高 ＋ 空白遞補**（2026-09-21 站長）：
  - `.promo-card` 不再 `align-self: start`，改成直向 flex＋`align-self: stretch`；
    單檔卡的 `.promo-card-main` `flex: 1`、按鈕列 `margin-top: auto`，所以同一列的
    「立即申辦」會對齊成一條線。多檔卡的 `grid-template-rows: auto 1fr auto` 讓
    **附屬列那一格**吸收多出來的高度（原本 `align-content: start` 會把它留在整組下方
    變成白色空帶）。混合列時多檔卡通常就是最高的那張，實務上等於「只調整單檔卡」
  - `.promo-grid` 加 `grid-auto-flow: dense`：多檔卡跨 2 欄、塞不進列尾剩下 1 欄時會整欄
    空著，dense 讓後面較窄的卡回填。代價是視覺順序不再嚴格遞減（站長同意「順序有點
    交錯 ok」）；**DOM 順序仍然是遞減的**，JSON-LD／螢幕閱讀器／SEO 不受影響
  - 實測 23 張卡：1280px 三欄 填滿率 100%、空欄 0、高度不齊的列 0、grid 高 4188 → 3555；
    1440px 四欄 填滿率 95%、grid 高 2847
- **首刷禮大字是深橘 `#c2410c`**（2026-09-21 站長選的「燒橘」，原本 `#8a5c00` 深金褐）。
  白底對比 4.9:1 過 AA。⚠️ 它跟「最後 N 天」徽章的紅 `#dc2626` 是相鄰色相，
  同一張卡上兩個都會出現，別再把任何一邊往對方推
- **寬螢幕（≥1400px）一列 4 張卡**（2026-09-21 站長）：容器 `max-width` 放寬到 1440px、
  `.promo-grid` 改 4 欄、品牌欄縮到 208px。⚠️ 這個 media block 必須排在
  `@media (min-width: 1025px)` 那段**之後**——品牌欄寬度等規則同分，後定義的才會贏。
  `.social-media-footer` 的 `max-width` 要一起改，否則頁尾比主體窄一截
- **「即將結束」篩選 chip**（2026-09-20）：篩出有「最後 N 天／今天截止！」徽章的卡片。
  ⚠️ **數量只能在前端算**——徽章是 `promos.js` 拿「今天」逐檔比 `period_end` 比出來的，
  靜態生成當下寫死的數字隔天就錯（一次匯出可能掛好幾週）。`pmcBuildFilterChips_()`
  只輸出一顆 `hidden` 的骨架 chip（`#promos-chip-ending`），數字與顯示與否由
  `refreshEndingChip()` 決定，一張都沒有時整顆不出現、並把停在該篩選的狀態退回「全部」。
  卡片上的 `data-has-ending` 也是它寫的
- **搜尋框與「資料更新於」同一列**（2026-09-20 站長：桌機搜尋框不必佔整行）。
  `.promos-search-row` 是 `flex-wrap: wrap`＋戳章 `margin-left: auto`：寬螢幕一左一右，
  窄到放不下自然換成兩列、戳章仍靠右，不需要為手機另寫一組規則

## 4. 卡片特色：modal 與部署時注入（2026-09-17 改版續）

- **卡片特色一律開 modal**（桌機 2026-09-18、手機 2026-09-20；站長：「目前要展開的
  東西太多了」）。特色有 5~7 列加國內／國外基準列，就地展開會多出一整屏高度、
  把後面的卡全部推走，手機尤其嚴重。`promos.js` 的 `openFeatModal()` 懶建立一層
  `.promo-feat-modal`（比照 `setupGiftLightbox` 的作法，**不需要動 Apps Script 模板**），
  把 `.promo-card-feat` 的 innerHTML 複製進去——那段是注入的靜態片段，沒有 id、
  沒有綁在節點上的事件（「查看全部」走 document 委派），所以複製即可，不必搬節點。
  `.promo-card-feat` 抽屜因此永遠 `hidden`，只當內容來源與退路
- **卡片特色 modal 的「查看卡片詳情」是 footer CTA**（2026-09-21 站長；原本是抬頭右邊的
  小連結「查看全部 ›」）。`tools/build-promos-features.js` 仍然把 `<a class="promo-feat-all">`
  輸出在 `.promo-feat-head` 裡，由 `promos.js` 的 `openFeatModal()` 把**節點本身**搬到
  `.promo-feat-modal-foot`（搬節點而不是複製字串，`setupCardDetailOverlay` 的 document
  委派才收得到點擊）。連結搬走後抬頭可能整列空掉，所以會 `head.hidden = true`——
  ⚠️ `.promo-feat-head` 是 `display:flex`，CSS 必須補
  `.promo-feat-head[hidden]{display:none}`（這頁第五次踩同一個坑，通則見第 9 節）
- 「查看全部 ›」取代舊的卡名旁 ⓘ 鈕，`data-section="card-special-section"`
  讓內嵌詳情開完直接捲到「指定通路回饋」（`promos.js` 的 `pmc-open-card` 多帶一個
  `section` 欄位，`js/home-ui.js` 收到後點一下對應的導覽鈕）

**卡片特色的內容是部署時注入的，不是 Apps Script 生成的**

`generatePromosPageHtml()` 只輸出空容器
`<div class="promo-card-feat" data-feat-for="<card id>"></div>`，內容由
`tools/build-promos-features.js` 在 Cloudflare Pages build 時填入（接在
`tools/deploy-version.sh` 裡，跟商家頁生成器同一段、都在注入 `?v=` 之前）。

**為什麼不在 Apps Script 算**：卡片特色的回饋率必須跟主站搜尋結果是同一個數字，
而那份邏輯住在 `js/cashback-engine.js` 的 `getDisplayRate()`（stacking 加總、跨槽引用
`rate_N`、級別 placeholder 都在裡面），Apps Script 讀不到 `js/`。抄進 `cards-export.gs`
就會變成同一段邏輯的**第四份副本**——`cashback-engine.md` 第 6 節已明文警告
「三處實作必須一致」。所以照 `tools/lib/merchant-cards.js` 的成例把 `js/` 載進 Node 的 vm 跑。

**這個分工是自癒的**：Apps Script 下次匯出會把 `promos.html` 蓋掉、容器變回空的，
部署時再注入一次。沒跑注入器時容器是空的，`promos.js` 會把「卡片特色」按鈕一起藏起來，
頁面其餘部分照常可用——所以 preflight **不檢查**這個區塊（匯出的 commit 本來就沒有它）。

🔴 **repo 一律 commit「空容器」版**（＝`tools/build-promos-page.js` 的原樣輸出），
注入只發生在部署時。本機注入過要驗畫面沒問題，但 commit 前要用
`node tools/build-promos-page.js` 還原。理由見第 9 節「生成器」。

**卡片特色的選題規則**（全部在 `tools/build-promos-features.js`，逐條有註解）

| 規則 | 內容 |
|---|---|
| 標籤 | 一律顯示商家（`items` 前 3 個），**不顯示 `category`**；`category` 只在它描述達成條件（`/方案\|切換\|任務\|首次\|綁定\|登錄\|滿額\|滿千/`）時留成灰色後綴 |
| 去重 | 同一個顯示標籤只留回饋率最高的那個（聯邦 LINE Bank 卡「萊爾富門市」有 10% 與 5% 兩槽）。**必須在挑前 5 名之前去重**，否則重複那行會佔掉名額 |
| 固定行 | 「國內一般消費」讀骨幹槽 21（23/23 張都有）；「國外消費」讀 slot22，**沒有 slot22 就是沒有國外回饋，整行不顯示**（不推算） |
| 分級卡 | 取**最高級別**。⚠️ 不能用 `levelSettings` 鍵順序——玉山 Uni／國泰 CUBE 由低到高，永豐大戶／凱基誠品由高到低。改成實算每個級別的最高回饋率再取最大 |
| Highlights | 命中的槽**保證入列**，但跟其他槽一起依回饋率倒序（固定顯示 ≠ 排最前面）。merchant 可能是快捷搜尋 displayName（「所有計程車」），要先展開再比對；一卡一通路命中多組時**取回饋率最高**的那組 |
| 卡片用途 | Sheets 的 `cardUseCase` 欄（選填）。**沒填就整行不出現**，可以慢慢填 |

**本機重生 promos.html**：`node tools/build-promos-page.js` —— 用 vm 載入
`cards-export.gs` 呼叫同一支純函數，沿用現有的 versionTag 與「資料更新於」日期，
所以差異只會是生成邏輯本身的差異。⚠️ 這不改變「實際執行版在 Sheets」：
改了 `cards-export.gs` 仍然必須把整份貼回 Sheets，否則下次匯出會用舊邏輯蓋掉。

**舊卡片版型的死碼已清完**：2026-09-21 刪掉 53 條（`.promo-card-toggle`／`-detail`／`-header`／`-mainline`／`.promo-hero*`／`.promo-quick-highlight`／`.promo-gift-thumb` 等，判準見第 9 節「CSS」）。2026-11-22 查 `promos.css` 已無以這些 class 為選擇器的規則，只剩幾行註解提到舊名。

## 5. 站長推薦＋行李箱專區（2026-09-23）

promos.html 在 hero 與搜尋列之間多了兩區，都由 `generatePromosPageHtml()` 生成
（`pmcSelectPicks_`／`pmcRenderPicks_`／`pmcSelectLuggage_`／`pmcRenderLuggage_`），
**不受篩選、搜尋、「隱藏我持有的卡片」影響**（站長指定）。按鈕沿用清單的 `.promo-apply-btn`，
GA4 事件多帶 `section`（picks／luggage／list）。倒數徽章與過期隱藏由 promos.js 的
`refreshSectionBadges()` 處理。

**New Cardholder Promos 新欄位**（依表頭名稱讀取，位置不拘，只是別插在 A 欄前）：

| 欄位 | 填法 |
|---|---|
| `min_spend` | 拿到獎勵的最低消費，純數字。多段門檻填第一段最低的。**空白＝不限金額** |
| `luggage_inch` | 行李箱吋數，純數字。有填＝這檔進行李箱專區 |
| `luggage_value` | 參考價（官網公告價值或市售估價），純數字；空白顯示「—」 |
| `pick_rank` | 1–5＝強制排在該位置；`x`＝不要自動選入；空白＝交給自動 |
| `pick_question`／`pick_reason` | 手動情境問句／推薦理由；空白＝用自動產生的 |

數字欄由 `pmcParseNumber_()` 讀，文字格式的 "3,280"、"NT$3,280" 也讀得對。

**自動選榜規則**（`pmcSelectPicks_`）：
1. `pick_rank` 1–5 先就位；同一張卡只出現一次
2. 首刷禮／定額回饋／回饋加碼三類各至少 1 名（手動已涵蓋的類型不再補）
3. 剩下的位置由定額回饋與回饋加碼比分數：定額＝`voucher_amount ÷ max(min_spend, 1000)`
   （下限 1,000 是為了不讓「不限金額送 100 元」變成無限大）；加碼＝`bonus_rate`，通路含熱門
   行動支付（`PMC_HOT_PAY`）×1.2。首刷禮沒有價值欄位（站長不做 gift_value），只比門檻低，
   第 2 檔以後的首刷禮要靠 `pick_rank`
4. 同分時截止日近的在前
5. 只送行李箱的活動不進推薦區；多選一含行李箱的，推薦區只顯示非行李箱選項並附「另有行李箱選項」

**行李箱專區**：依吋數大到小、同吋數門檻低的在前；少於 2 檔整區不出現。圖示高度＝吋數×倍率，
所以大小差異是真比例。底部固定小字說明參考價來源（站長指定文案）。

**舊資料保護**：`min_spend`／`pick_rank`／`luggage_inch` 三欄在整份資料裡都不存在時（Sheets 還沒貼
新版程式），兩區都不輸出——免得用缺欄位的資料自動上榜。

**2026-09-23 第二輪**：hero 下方加頁內索引列（`pmcJumpNav_`：站長推薦／行李箱專區／新戶活動，後者錨點是清單上方新增的「新戶活動」標題 `#all-promos`）；推薦區手機橫滑有分頁點（promos.js `setupPicksDots`）；行李箱專區附贈品圖（`gift_image_url`，點擊走同一個 lightbox）與「卡片特色」鈕（`data-feat-card` 指向清單同一張卡的 `.promo-card-feat`，開同一個 modal）；手機的「立即申辦」縮成「申辦」。**第三輪**：行李箱專區改成淡底獨立區塊、一檔一張白卡（桌機兩欄），贈品圖佔右欄，倒數徽章移到參考價／門檻那行尾，卡片特色＋申辦在卡片底部一列；`luggage_open` 欄位整個移除（站長評估開法不必獨立顯示）。

**2026-10-04**：推薦卡片在申辦鈕上方加一列「活動詳情 ↓」（同行李箱專區的 `.pmc-lg-jump`，跳到清單裡那一檔並展開）＋「卡片特色」（`data-feat-card`，原地開 modal）；刻意不做「幫用戶填搜尋框」（會篩掉其他卡、要自己清掉才回得去）。推薦有一檔過期被藏時，promos.js 把標題改成實際張數（Top 4…），下次匯出才會從未過期的活動補滿。同日：附屬列的「活動詳情 ▾」改到摘要下一行（獎品圖仍在右側），摘要用 `pmcNoOrphanHtml_()` 把最後 3 字包成不換行，最後一行不會只剩 1 個字；`bonus_merchants` 的萬用標記不再原樣印出（見下方填法）。

**`bonus_merchants` 填法**（2026-10-04 站長定義）：匯出只用**半形逗號 `,`** 切（`pmcRowToPromo_` 附近），全形「，」「、」不會切開。萬用標記要整格只填它一個，不跟通路名稱混填。
- **`*general`**＝一般消費都算（不限通路；繳稅、預借現金等排除項寫在 `promo_condition`／備註）。主站：任何搜尋都會列出這檔，「匹配項目」顯示「一般消費皆適用」；新戶活動頁顯示「一般消費皆適用」
- **`*all_items`**＝只加碼在這張卡原本的回饋通路上（省得手動列通路）。主站：展開成該卡 cashbackRates 的 items 來比對搜尋，詳情頁顯示「本卡所有指定通路」；新戶活動頁顯示「本卡所有指定通路（見卡片特色）」
- 指定通路 → 逐一列名稱、用 `,` 隔開，名稱盡量跟該卡 cashbackRates 的 items 寫法一致（主站搜尋靠子字串比對）
- 程式位置：主站 `isGeneralSpendingMarker()`／`isAllItemsMarker()`（core-utils）；生成器 `pmcIsGeneral_`／`pmcIsAllItems_`／`pmcMerchantsDisplay_`；AI 填表說明在 `benefits-parser.gs` 的 bonus_merchants description

**`apps-script/promo-picks-fill.gs`**：`fillPickSuggestions()` 把「現在會上榜的 5 檔」的自動問句／理由
寫進空白的 `pick_question`／`pick_reason`，給站長一個可改的起點。只填空格、不動 `pick_rank`。
寫進去就變手動，之後數字改了不會跟著變，清空即恢復自動。需與 cards-export.gs 同一個專案。

## 6. 安心申辦：信任區塊／按鈕去向／大師加碼說明（2026-11-16）

這頁是辦卡轉換的主要入口，但原本沒有任何一句話交代「按鈕去哪、資料給誰、本站怎麼賺錢」
（唯一的揭露在 /privacy 5.2）。全部由 `generatePromosPageHtml()` 生成，樣式在 `promos.css` 最後一段。

- **信任列**（`pmcRenderTrust_`，`<a class="pmc-trust" id="trust">`）：引言下方、頁內索引列上方。
  **定案＝一行字＋灰底＋連到 FAQ**（站長 2026-11-17）：盾牌＋`PMC_TRUST_LINE`
  （「不經手個資・全站加密・連結防竄改」）＋「｜了解更多 ›」，整列是連結，另開分頁到
  `/faq?category=安全說明`，FAQ 頁會直接選好那個分類（`faq.js` 的 `pendingUrlCategory`）。
  - **完整說明不在這頁**：由站長寫在 Sheets 的 FAQ 工作表、分類填「安全說明」（站長同日另建了「一般說明」放沒有合適分類的題目）。分類名稱要跟
    `PMC_TRUST_FAQ_CATEGORY` 一字不差；對不上（或分類還沒建立）時 FAQ 頁停在「全部」，不會壞。
  - 改過三版，別走回頭路：①三個勾勾＋藍框＋原地展開（站長：不好看）②一行字＋原地展開六題問答＋
    FAQPage JSON-LD ③現在這版——說明只維護一份，這頁也不必變長。promos 頁因此**沒有** FAQPage JSON-LD。
  - 「了解更多」**緊貼在那句話後面、細字、用 CSS `::before` 畫的「|」隔開**（站長 2026-11-17：原本
    `margin-left:auto` 靠最右，桌機上離那句話太遠很怪；粗體又跟前面那句分不開）。原本叫「防護說明」。
  - FAQ 分類（站長 2026-11-17 定）：信用卡回饋／網站功能／安全說明／一般說明 四類。「支付方式」取消
    （那題改一般說明）；`faq.html` 寫死的前三題分類**要跟 Sheets 那三題一致**——寫死的題目會蓋掉同 id
    的資料題（faq.js 跳過 prerender id），兩邊不一致時線上就會冒出 Sheets 裡沒有的分類（曾有「使用說明」）。
  - 那一行**只講資安防護**，不提分潤、也不提按鈕去向（站長指定）。16 個字是量過的：360～390px 都是一行。
  - 灰底是必要的：白底時跟上下文字連成一片、分不出這是一塊。用 `--pmc-tint`；引言同日改成沒有底色的
    一句話（`.promos-hero-lede`），所以不會兩塊灰疊在一起。
  - 🔴 **FAQ「安全說明」分類裡的資安聲明都對得到實作，改了實作要請站長改 FAQ**：固定網址、只收 http/https
    ＝`pmcSanitizeUrl_`；每次更新逐一核對網域＝`validateReferentialIntegrity_`；base-uri／frame-ancestors／
    X-Frame-Options／HSTS＝`_headers` 的**強制版**標頭（不是 `-Report-Only` 那條）；noopener noreferrer＝
    申辦連結的 `rel`。`_headers` 那幾條若被拿掉或降回只回報，FAQ 那一題就變成不實聲明。
- **按鈕去向**（`pmcApplyDest_` → `.promo-apply-dest`）：清單卡的動作列、站長推薦的申辦鈕下方各一行。
  **每次匯出都從當下的連結網址重新判斷**，Sheets 換連結它就跟著變，不必多填欄位。
  站長 2026-11-17 確認連結只有兩種，而且最後都到銀行官網申辦：
  合作平台網域（`PMC_PARTNER_HOSTS`）→「經 Money101 合作連結前往銀行官網」；
  與該卡 `website` 同一個品牌網域 →「直達銀行官網・esunbank.com.tw」；其餘 →「前往 <完整網域>」。
  比的是主網域**第一段**（esunbank），因為同一家銀行 `.com` 與 `.com.tw` 混用；連第一段都不同的
  （國泰 cathay-cube／cathaybk）列在 `PMC_BANK_DOMAIN_ALIASES`。
  **看到「前往 xxx」就是連結網域跟卡片的銀行對不上**——不是新增別名，就是 Sheets 的連結填錯了。
  新的合作平台要加進 `PMC_PARTNER_HOSTS`，否則會落到「前往 <網域>」。行李箱專區的動作列太擠，沒有放。
- **申辦連結網域把關**（`validateReferentialIntegrity_`，2026-11-17）：匯出前逐一檢查每個 `cardApplyCtas`
  連結，網域不是該卡銀行、也不是 Money101 的（＝`pmcApplyDest_` 判成 `other`）會列進匯出前的確認對話框。
  信任問答對用戶說「每次更新都會逐一核對」，指的就是這一步——**拿掉這段檢查就要連那句話一起拿掉**。
  只在本機用 `tools/build-promos-page.js` 重生時不會跑這個檢查（那支不經過 `exportToJSON`）。
- **【大師加碼】說明**（`.promo-exclusive-note`）：站長定義＝本站有分潤、且透過本站連結申辦才有的
  專屬首刷禮或活動；從本頁按鈕申辦並完成該檔全部達成條件就拿得到。摘要（`new_customer_summary`）
  含「大師加碼」四個字的活動，詳情最上面會多一句說明；Sheets 拿掉那四個字就跟著消失。
  用主站藍——黃、紅、綠都被類型徽章／倒數徽章／獎勵數字佔走了（見第 2 節的選色禁區）。
- ⚠️ **詳情底部不放第二顆申辦鈕**：2026-11-16 做過，站長隔天裁定拿掉——直向空間比少捲一次重要。
- **header 單色**（2026-11-17）：`.promos-header` 是手抄件，主站 `header` 在 2026-11-16 拿掉漸層時沒跟到。
  faq／privacy／terms／商家頁直接吃 `styles.css` 所以自動跟上；landing 沒有 header bar。
- **每檔活動有自己的 id**（`…-a1`、`…-a2`）：ItemList JSON-LD 的網址從 2026-09-17 改版起就指向這組錨點，
  但元素上一直只有 `…-a1-detail`，55 個網址全部落空。
- **搜尋涵蓋獎勵與摘要**（`promos.js` 的 `promoRewardText`）：原本只比卡名與適用通路，搜「行李箱」
  「氣炸鍋」是 0 筆。這幾段文字本來就顯示在卡片上，命中只標色、不代為展開。
- **GA4 事件**（`promos.js` 的 `track()`）：`promos_detail_open`（只記親手點的）、`promos_feat_open`、
  `promos_filter`、`promos_search`（停手 1.2 秒才送，帶 `results`，0＝找不到）、`promos_trust_open`（點了信任列）。
- **顏色減量**（2026-11-17 站長確認，**取代第 2 節的糖果色方案**）：全頁只留三個有意義的顏色——
  藍＝可以按（申辦鈕、選取中的篩選鈕）、綠＝你拿到的（獎勵）、紅＝快截止。類型徽章
  （`.promo-type-badge`／`.promo-sub-type`／`.pmc-kind`）三種一律用 `--pmc-candy-slate-*` 灰，靠文字分辨；
  三顆類型篩選鈕的專屬配色整組移除，跟「全部」同一套（灰框深字、選取＝主站藍實心）；
  「活動詳情」「卡片特色」等次要連結與按鈕改深灰。`--pmc-candy-purple/yellow/brown-*` token 目前沒有人用，先留著。
- **贈品圖放大**（2026-11-17，站長看過全部 9 張首刷禮卡的範例後確認）：主活動的活動宣傳圖從右邊 70px
  改成左邊 118px，右下角加「點圖放大」小標；同一列的獎品名稱 17 → 15px。**這推翻第 2 節「獎品圖在右側」的決定**
  ——站長拿得到的多半只有銀行的行銷圖，不是商品照，太小看不出是什麼。附屬列的小獎品圖不變。
  規則在 `promos.css` 檔尾，三個坑都寫在那段註解裡（specificity、不能用 grid、`:has()` 要分開寫）。
  「每個選項一張商品圖＋市價」的做法（E3）評估後不做：圖不好取得。
- **引言一句話**（`.promos-hero-lede`，站長 2026-11-17 定稿）：取代原本淡底卡片裡的兩段。舊的
  `.promos-hero-intro` 規則留著給舊 HTML 用。
- **向後相容**：`promos.css`／`promos.js` 這一輪只有新增的 class 與有判空的程式，Sheets 還沒貼新版生成器、
  匯出的仍是舊 HTML 時不會壞，只是看不到新區塊（搜尋範圍與 GA 事件不靠新標記，會直接生效）。
- **刻意沒動**：頁尾之後的「申辦前先確認這幾件事」（站長 2026-07-29 定的位置）、hero 引言、
  meta title。description 只改掉一句與現況不符的「依即將截止時間排序」。

## 7. 收藏＋單卡頁 /promos/<card id>（2026-11-18，站長同意 mockup F／G）

mockup 產生器：`docs/mockups/promos-mock-2026-11-17.js` 的 F、G 兩段。

**收藏（純前端，`promos.js` 的 `setupFavorites()`）**
- 卡名旁一顆愛心（清單頁插在 `.promo-rail-id` 尾端；桌機多檔卡的直式品牌欄改釘右上角）、單卡頁在頁首 `.pmc-fav-slot`。
  **生成器不輸出任何標記**，舊版 HTML 一樣有這個功能。
- 存在 localStorage `pmcPromoFavorites`（卡片 id 陣列，最多 50），清單頁與單卡頁共用。這頁沒有 `readLocalJSON()`，
  讀寫一律 try/catch、壞資料當成沒收藏（鐵則 2 的精神）。不登入、不同步——口袋名單那行「存在這台裝置，下次來還在」就是在講這件事。
- 底部口袋名單 `.pmc-fav-bar`：前 3 張卡圖＋「已收藏 N 張」＋「看我的收藏」（2026-11-19 站長從「並排比較」改名：手機上收藏的卡是上下排，名不副實）。看我的收藏＝清單只留收藏的卡
  （`filterState.favOnly`，進入時先清掉其他篩選），再按一次「看全部活動」回來。單卡頁的按鈕是連到 `/promos?fav=1`，清單頁讀到就直接進入。
  `clearAllFilters()`（站長推薦／行李箱的跳轉會用）也會退出只看收藏。
  **只看收藏時整頁只剩收藏的卡**（站長 2026-11-22）：`body.is-fav-only` 藏掉頁內索引列、站長推薦、行李箱專區、搜尋列、篩選列，
  清單標題改「我的收藏」，出口只有口袋名單的「看全部活動」。站長否決「篩選列加一顆『我的收藏』chip」——篩選列整段藏掉，就不會有選錯 chip 的誤導。
- 清單頁載入時會把「已不在清單上」的收藏清掉（活動下架），口袋名單只放比得到的卡。
- 口袋名單出現時 `body.has-fav-bar`：頁尾多留 76px、回到頂部鈕往上讓。
- 愛心只在收藏中才上玫瑰紅（實心）——這頁的紅是「快截止」，沒收藏時一律灰。
- GA4：`promos_fav`（card_id、action add/remove、page list/card）、`promos_fav_compare`。

**單卡頁**
- **生成邏輯**在 `cards-export.gs` 的 `generatePromoCardPages()`（＋`pmcCardPageHtml_`／`pmcCardPageEndedHtml_` 等），
  跟清單頁共用 `pmcPreparePromoGroups_`（過期過濾／分組／排序／錨點，從 `generatePromosPageHtml` 抽出）、
  `pmcRenderCardGroup_(group, {page:true})`（不輸出 rail 與特色容器）、`pmcPageShell_`（head／header／footer，從 `pmcPageTemplate_` 拆出）。
  ⚠️ **Apps Script 不會呼叫它**：頁面在 Cloudflare Pages 部署時由 `tools/build-promo-card-pages.js` 用 vm 載入 repo 的 `.gs` 生成到
  `promos/<id>.html`，**不進 repo**（`.gitignore` 的 `/promos/`）。理由：頁數跟著資料增減、匯出不必多 commit 30 個檔、
  不必等站長重貼 Apps Script 才有頁面。所以改單卡頁版面只要改 repo，不用重貼。
- `tools/deploy-version.sh` 的順序：商家頁 → **單卡頁** → 卡片特色注入（`build-promos-features.js` 也會填 `promos/*.html` 的容器）→ `?v=` 注入（迴圈含 `promos/*.html`）。
- **站內資源一律絕對路徑**（`/promos.css`、`/assets/…`）：單卡頁在子目錄，相對路徑會落空。清單頁跟著改，2026-11-18 用
  `build-promos-page.js` 重生比對過：除了路徑多一個 `/` 之外逐位元相同。
- **卡片 id 只收 `^[a-z0-9][a-z0-9-]*$`**（`pmcCardPagePath_`）：它同時是網址與檔名，不合規的卡沒有頁、清單上的卡名也不加連結。
- 內容：麵包屑（三層）→ h1「<卡名>新戶活動」→ 一行小灰字「YYYY 年 M 月整理」（`.pmc-cp-month`，2026-11-22 站長從 h1 移出，`<title>` 仍帶月份）。**月份＝這張卡自己的資料更新日（`promoCardUpdatedIso`），不是部署日**（站長 2026-11-22：活動沒更新、月份卻自動往前跳是錯誤資訊）
  → 一句引言（1 檔＝該檔摘要＋截止日；多檔＝逐檔獎勵（最多 3 種，`pmcRewardList_` 去重、重複的註明「（N 檔）」）＋最快截止。
  2026-11-22 起寫實際數字：AI 摘要與搜尋片段最常直接引用第一段）
  → 卡圖＋申辦鈕（去向同清單、GA 帶 `section=card_page`）→ 三格（檔數／截止（多檔「最快截止」）／收藏愛心）→ 資料更新於 → 信任列
  →「新戶活動」（同清單的活動卡；站長 2026-11-22 從「這張卡的新戶活動」改名）→ 卡片特色（直接攤開，不開 modal；沒注入就整節藏）→ 相關卡片（2026-11-22 從「也可以看看」改名；同主活動類型優先，3 張，連到各自的單卡頁）。
  JSON-LD：WebPage（dateModified）＋BreadcrumbList。canonical＝`/promos/<id>`。
  `<title>`＝「<卡名>新戶<主獎勵>[等 N 檔]｜YYYY年M月新戶活動 - Pick My Card」（月份同上）（2026-11-22：主獎勵放前面，Google 截斷前就看得到；
  主獎勵超過 20 字：首刷禮只寫「首刷禮」、金額只寫「NT$X 回饋」，`pmcCardPageTitleReward_`）；description 帶逐檔獎勵＋截止日。
  **活動結構不同時的退路**（2026-11-22 壓力測試過：抽獎類、長用途、沒摘要、沒截止日、8 檔同獎勵）：沒金額／回饋率／贈品的活動用 `promo_types[0]` 稱呼（不再一律叫「首刷禮」）；`voucher_usage` 只取括號前；1 檔卡沒摘要時引言退回獎勵本身。
  **分享圖（待做）**：站長選定的設計在 `docs/mockups/promo-og-mock-2026-11-22.js` 的 B3b，目前仍用全站預設分享圖。
- **活動全部到期、但還在 cards.data 裡的卡**：輸出一頁「目前沒有進行中的新戶活動」＋`noindex`，免得 sitemap／外部連結在下次匯出前 404。
  部署之後才到期的：`promos.js` 的 `setupCardPage()` 在整張卡被藏起來時顯示 `#pmc-cp-ended` 那一句。
- **入口**：清單卡名 `<a class="promo-card-name-link" href="/promos/<id>">`（卡名後面 CSS 加藍色「›」，站長 2026-11-22：只有滑過才出底線，手機看不出能點）（`pmcRenderCardGroup_`）＋ sitemap。這兩樣在 Apps Script 端，
  **要站長重貼 `cards-export.gs` 才會出現**；之前頁面已經存在、只是沒有連結。
- **每頁自己的更新日**：`exportToJSON` 用 `pmcPromoCardSignature_`（該卡活動＋申辦連結＋卡名）配 `pmcStampedDate_('PROMOCARD_<id hash>')`，
  寫進 `cards.data` 的 `promoCardUpdatedIso`，部署端烤進頁面（資料更新於／dateModified），sitemap 的 lastmod 同源。
  一張卡改活動不會讓其他頁的 lastmod 一起前進。貼新版之前沒有這欄，部署端退回清單頁的「資料更新於」。
- **三格的收藏格**（2026-11-22 站長：拿掉「回饋金額」——正下方活動卡就有；愛心從卡圖列搬進來）：`.pmc-cp-fact-fav` 裡的 `.pmc-fav-slot`，
  按鈕 `::after` 蓋滿整格＝整格都點得到。⚠️ 按下的縮放動畫套在 svg、**不能套在按鈕上**（見第 9 節）。
  愛心搬走後卡圖列的右欄變寬；窄手機另讓卡圖縮（`clamp(88px, 100% - 222px, 128px)`），「經 Money101 合作連結前往銀行官網」340px 以上不折行。
- **卡片特色的「卡片用途」＝大師點評引言**（2026-11-22，比照詳情頁 1q 的 `.card-use-case` 桌機版）：注入器在 `.promo-feat-usage` 後面
  一律輸出 `.promo-feat-usage-cite`「— 大師點評」，`promos.css` 預設藏起來，只有 `.pmc-cp-feat-sec` 裡顯示並改成引號樣式。清單頁 modal 仍是色條樣式。
- 樣式在 `promos.css` 檔尾（`.pmc-cp*`）。`.pmc-cp .promo-card[data-act-count]:not([hidden])` 要跟清單那條多檔 grid 規則同分、排在後面才蓋得過，別往前搬。
- ⚠️ 特色容器的 class 只能寫 `promo-card-feat` 一個字：注入器比對的是 `class="promo-card-feat"` 整串（2026-11-18 多加一個 class 就 0 組命中）。
- 本機看：`node tools/build-promo-card-pages.js && node tools/build-promos-features.js`，再開 `python3 -m http.server`
  的 `/promos/<id>.html`（本機沒有 clean URL）。看完 `git status` 應該乾淨——`promos/` 被忽略，但 promos.html 被注入過特色，記得 `node tools/build-promos-page.js` 還原。

## 8. 依卡片找（2026-11-22，站長選定 mockup J2「分欄目錄」）

給「心裡已經有想看的卡」的人：新戶活動頁**最後一區**（清單之後、`</main>` 前），依銀行分欄列卡名（完整卡名＋藍色「›」），
連到單卡頁；頁內分頁列多一顆「依卡片找」排最後。站長否決 H1 的膠囊外框（不好看）、否決放在清單前面。
- **部署時注入**：`tools/build-promos-card-index.js`（`deploy-version.sh` 裡排在單卡頁之後，因為只列 `promos/<id>.html` 存在的卡）。
  不在 Apps Script，改這區不用重貼。冪等：`<!-- CARDINDEX:START/END -->`＋分頁列那顆 `data-jump-cardindex`。
- 卡片＝清單裡的 `article.promo-card` 順序；銀行＝`cards.data` 的 `cards[].bank` 短名；銀行依卡數多到少，同數照清單先後。
- 樣式 `promos.css` 的 `.pmc-cardindex`／`.pmc-ci-*`（手機 2 欄、≥769px 4 欄、≥1100px 5 欄）；整區用活動卡同款外框框起來（站長 2026-11-22：要看得出是一個區塊）；說明文字「點擊任一卡名看單張信用卡的新戶活動」；只看收藏時跟其他區一起藏。
- `setupJumpSpy()`：最後一區比畫面矮、頂端碰不到分頁列，**捲到底就標最後一顆**（不然點了「依卡片找」會標在「新戶活動」）。
- GA4：`promos_card_index`（card_id）。
- 本機看：`node tools/build-promo-card-pages.js && node tools/build-promos-card-index.js`；看完 `node tools/build-promos-page.js` 還原 promos.html，**注入結果不 commit**。

## 9. promos 維護通則（2026-11-22 由教訓記錄歸納）

> 括號裡的日期是當初踩到的那次，完整經過見 `docs/archive/data-pipeline.md-2026-11-22.bak` 的教訓記錄。

**CSS**
- 靠 `el.hidden` 控制顯示的元素，只要 CSS 給了 `display`，就同時補 `[hidden] { display: none; }`。驗收看 `getComputedStyle(el).display`，不看 `el.hidden`。這頁已踩五次：倒數徽章、堆疊層、類型篩選、「即將結束」chip（2026-09-20）、`.promo-feat-head`
- 沿用既有 class 換一套樣式時，覆寫選擇器寫成雙 class（`.promo-act-row.promo-sub-row`）：同分時後定義的贏，單 class 覆寫可能整個沒生效。驗收讀 `getComputedStyle(el).padding`，不要只看原始碼有沒有寫（2026-09-21）
- 元素換了角色（從「卡片」變「外框」）或搬到別的容器後，`grep` 舊 class 在所有 media query 與 `.祖先 .那個 class` 組合裡的出現位置，逐條確認。2026-09-21 踩兩次：`.promo-act` 每列多出 28px 內距、單檔卡按鈕的 `margin-top: 0` 吃掉 rail 的間距
- 對齊方式要與展開狀態無關，只有「因為內容變高而不得不動」的東西可以動。根治做法是把不該動的東西放進它動不了的格子（附屬列改 grid、獎品圖與「詳情」放進跨兩排垂直置中的 `.promo-sub-meta`），不要逐條補償。驗收用 Playwright 量展開前後的 `x/y`，要逐字相同（2026-09-21）
- 會變長的 flex 欄位一定要可壓縮：用 `flex: 0 1 auto`＋`max-width` 封頂，不用 `flex: none`（2026-09-21 長 meta 把 `flex: 1 1 0` 的標題擠成 0 寬）
- 用 `::after` 擴大點擊範圍的按鈕，按壓縮放套在內層 svg，不套在按鈕上：按鈕有 `transform` 時會變成 `::after` 的定位容器，按下瞬間覆蓋層縮回按鈕大小，放開時已不在按鈕上（2026-11-22 收藏格）
- 清死 CSS 的判準：選擇器裡只要有一個 class 不會出現在生成的 HTML，整條就永遠不會命中（2026-09-21 用它掃出 53 條）。用腳本刪規則前先剝掉註解再分析選擇器，也不要用 regex 直接刪：逗號分隔的選擇器群組會被切壞（2026-09-17 刪掉過 chips 的樣式）

**生成器**
- 任何就地改寫 HTML 的生成器都要能重複執行，部署流程不保證只跑一次。找配對的結尾標籤要數巢狀深度，不能用非貪婪 regex 配第一個 `</div>`（2026-09-18 卡片特色在 preview 上每張卡都變兩份）。repo 只 commit 空容器版（見第 4 節），注入只在部署時發生
- 改 `cards-export.gs` 的生成邏輯要兩手都做：整份貼回 Sheets，**並且**用 `node tools/build-promos-page.js` 把 repo 的 `promos.html` 重生成與生成器輸出逐字一致；`sitemap.xml` 沒有本機重生腳本，要手動補成與 `cards-export.gs` 的 `generateSitemapXml_()` 輸出逐字一致（不一致會在下次匯出來回打架）。線上服務的是 repo 這份，改生成器不會讓線上立刻變；驗收是請站長觸發一次匯出後 grep 關鍵字（2026-09-02）
- 生成器標記與 `promos.css` 一起改時，兩邊上線時間不同：`promos.css` merge 就上線，新標記要等貼回 Sheets、下一次匯出才換上（期間每次匯出都會蓋回舊標記）。`promos.css` 的新規則必須同時讓舊標記排得能看，兩種標記都要實測；新標記上線後再清相容規則（2026-10-21）

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
