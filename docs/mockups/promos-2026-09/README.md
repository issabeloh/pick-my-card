# /promos 資訊層級改版提案（2026-09-16）

> 一次性的提案資料夾，不是制度檔。方案定案、實作完成後可整包刪除
> （刪之前把「定案內容」寫進 `docs/project/data-pipeline.md` 第 9 節與 `docs/project/history.md`）。

## 這裡有什麼

| 檔案 | 內容 |
|---|---|
| `mockups.html` | 提案頁本體：問題 1 的 6 個版型 ＋ 問題 2 的 4 種取得方式，全部用 `cards.data` 真實資料渲染。可直接用瀏覽器開，或看已發布版本 <https://claude.ai/artifact/6xHgQRGMMagYVdaKXLfPGr> |
| `probe-highlights.js` | 取證腳本：`node docs/mockups/promos-2026-09/probe-highlights.js`。把 `js/` 載進 vm，用主站自己的 `getDisplayRate()` 算出每張卡的常態活動並排序，用來判斷「自動選 Top N」做不做得到 |

## 起因（站長 2026-09-16）

1. `/promos` 的資訊層級不對：應該先看到獎勵，被吸引後才看到是哪張卡送的。
2. 想在 `promo-card-body` 直接列出該卡最高回饋的 5 個常態活動，且要「可靠、不漂移、又不用全部手寫」。

## 現況診斷（`pmcRenderPromoCard_()`，`apps-script/cards-export.gs`）

- **獎勵被收合藏起來**：`.promo-hero`（`pmcBuildPromoHero_()` 產的大字：贈品／NT$ 金額／加碼率）
  放在 `.promo-card-detail` 內，手機收合態看不到。收合態第一眼是卡名 ＋ `new_customer_summary` 一長句。
- **預設排序是「即將截止」**（`period_end` 升冪），不是卡片名稱；「依卡片」是 `promos.js` 的切換鈕。
  兩者都與「獎勵多大」無關。
- **三種獎勵沒有共同單位**，混排時眼睛沒有可以往下掃的固定欄位。
- **一張卡的多檔活動被拆成多張卡片**：39 列其實只有 23 張卡（iLEO 4 檔、遠東快樂卡 4 檔、
  幣倍卡 3 檔、uniopen 4 檔）。

## 可換算的共同單位（提案 A/C/D/E 的基礎）

- 定額回饋 → `voucher_amount`（票面金額）
- 回饋加碼 → `bonus_rate × bonus_cap`。`bonus_cap` 是**消費上限**，相乘即這檔活動的回饋天花板
  （實測：永豐 Sport 卡 20% × 2,500 = NT$500；iLEO 國外 10% × 20,000 = NT$2,000）
- 首刷禮 → **沒有現金定價**，8 檔算不出來，只能另立一區

39 檔未過期活動中 31 檔算得出金額。

## 問題 2 的實跑結論（`probe-highlights.js` 2026-09-16 輸出）

**四種方法的「算數字」完全一樣**——都用主站的 `getDisplayRate()`，所以 stacking 加總、
跨槽引用 `rate_N`、級別 placeholder 全部與畫面一致，數字不會漂移。差別只在「挑哪 5 個」：

| | 數字 | 選題 | 標籤 | 人工成本 |
|---|---|---|---|---|
| ① 全自動 Top 5（純照回饋率） | 高 | **低** | 中 | 零 |
| ② Sheets 加 `highlightSlots` 欄，人工挑槽號 | 高 | **高** | 高 | 一卡一格（23 張約 30 分） |
| ③ Highlights 必列 ＋ 自動補 | 高（須反查） | 必列項高、其餘同① | 必列項高 | 零新增 |
| ④ 加權自動選 | 高 | 不穩定 | 中 | 零（換成無限調參） |

**選題為什麼是自動化的死角（真實輸出）**：

- 中信 LINE Pay 卡純照回饋率排序，第一名是「**10% 撥撥貓砂官網**」——20 個槽裡最窄的那個，
  而它真正該講的 LINE Pay 支付排不進前 5。加權（方法④）只把它推到第 3 名，沒有解決。
- 台新 Richart 卡 18 個槽全是「切換○○刷方案」，五個方案**互斥**，並排列出等於暗示可以同時拿。
- 標籤取 `category` 欄，但**會出現在畫面上的 146 個槽位只有 59% 有填**；沒填就退回前兩個 item 名。
  聯邦 M 卡 4 槽全空，那個 34 項的旅遊槽會顯示成「國內航空、國外航空」，
  而網站自己的 Highlights 說它的賣點是**計程車**（`items` 裡確實有台灣大車隊／Uber／yoxi）。
- Highlights 只覆蓋 **12/23** 張有新戶活動的卡；`merchant` 可能是快捷搜尋 displayName
  （「所有計程車」），反查真活動時必須走 `findSpotlightCardActivities()` 的快捷展開分支，
  不能只做字串比對。Highlights 的 `rate`/`cap` 是手打的、已證實會漂移（同 2026-09-02 期限那次教訓），
  所以回饋率也要反查真活動、不可直接採用。

## 待站長裁決（實作前必須先有答案）

1. **同一張卡的多檔新戶活動能不能相加？** Sheets 沒有欄位表達「互斥」，程式推不出來。
2. **分級卡顯示哪一級？** 現行 spotlight modal 慣例取第一個級別，但永豐大戶卡第一級
   （大戶Plus）會顯示 6%，對大多數人拿不到。
3. **promos 頁的生成位置**：方法①～④ 都需要 `getDisplayRate()`，而它在 `js/`、Apps Script 讀不到。
   - (a) 照 `tools/build-merchant-pages.js` 的成例，**在 Cloudflare Pages build 時**用 Node vm
     載入真引擎，把常態活動注入已生成的 `promos.html`。不動 Apps Script，也不多一份計算邏輯。
   - (b) 把 `getDisplayRate()` 移植進 `cards-export.gs`——會變成同一段邏輯的**第四份副本**，
     `docs/project/cashback-engine.md` 第 6 節已明文警告「三處實作必須一致」。

   建議 (a)。

## 順手發現的資料問題（與本次改版無關）

`newCardholderPromos` 有一列**中信 LINE Pay 卡**的活動：`promo_types`、獎勵欄位、`period_end` 全空。
無 `period_end` ＝不限期，所以沒被過期過濾擋掉，現在就渲染在 `/promos` 上，是一張什麼都沒寫的空卡片。
