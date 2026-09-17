# /promos 資訊層級改版提案（2026-09-16 起，最新＝v3 可互動原型）

> 一次性的提案資料夾，不是制度檔。方案定案、實作完成後可整包刪除
> （刪之前把「定案內容」寫進 `docs/project/data-pipeline.md` 第 9 節與 `docs/project/history.md`）。

## 這裡有什麼

| 檔案 | 內容 |
|---|---|
| `interactive.html` | **最新（v3）：可互動原型**。22 組卡片全部渲染，可以真的點展開／收合。已發布版本 <https://claude.ai/artifact/2EmQbDavVksqHyTBKVZK1N> |
| `mockups.html` | v2 的靜態比較頁：4 個版型 ＋ 3 個「卡片特色」方案。已發布版本 <https://claude.ai/artifact/6xHgQRGMMagYVdaKXLfPGr> |
| `measure-card-names.js` | 量測卡名在「卡圖下方一行」放不放得下（要先跑 `build-data.js`） |
| `build-data.js` | **提案「方案甲」的參考實作**：算出每張卡的「卡片特色」清單與新戶活動分組。`node docs/mockups/promos-2026-09/build-data.js` |
| `probe-highlights.js` | 第一輪的取證腳本：純照回饋率排序時會挑出什麼（留著當反例） |

兩支腳本都照 `tools/lib/merchant-cards.js` 的成例把 `js/` 載進 Node 的 vm，
用主站自己的 `getDisplayRate()` 算回饋率——**不另寫一套**，否則遲早跟畫面分岔
（`docs/project/cashback-engine.md` 第 6 節「三處實作必須一致」）。

## 站長已定案（2026-09-17 第二輪）

- **版型＝卡圖前導緊湊列**；堆疊用**厚堆疊**（金額＋單位一行、summary 一行）
- **卡名放最上方獨立一行**（量測結論見下）
- **卡片特色預設收合**，點主卡右下角的「卡片特色」按鈕才展開
- **卡片特色不可以用堆疊法**——堆疊是「卡疊卡」（白底、卡片陰影、逐層內縮），
  特色是**從主卡拉出來的抽屜**（淺藍底、有邊框、無卡片陰影），兩種形狀刻意不同
- **兩者互斥**：展開特色時其他活動整疊收起，收回特色它們才回來。同一個位置只會有一種東西
- **卡片用途沒填就整行不出現**（同匯出端既有的 `addOptionalField` 慣例，舊資料相容，可以慢慢填）

### 卡名放哪：量測結論

`measure-card-names.js` 實測 Noto Sans TC 700、22 個卡名全量：

| 卡名 | 10px | 11px | 12px |
|---|---:|---:|---:|
| 中信 Uniopen 聯名卡 | 104 | 114 | 125 |
| 聯邦 LINE Bank 卡 | 94 | 104 | 113 |
| 滙豐現金回饋御璽卡 | 90 | 99 | 108 |

卡圖維持 78px 寬時，**11px 有 6/22 個卡名放不下**。要一行不截斷只有兩條路：
卡圖欄加寬到 **118px**（右欄從 217px 縮到 177px，獎勵大字被擠小），
或**把卡名移到最上方**（全寬 306px，任何卡名都放得下）。**預設取後者**——
獎勵大字是這次改版的全部重點，不該為了卡名讓位。兩種都做進互動原型的控制台了。

## 站長已定案（2026-09-17 第一輪）

**版型共同前提**

- 不編號，依「最高可拿」倒序
- 同卡多檔活動**堆疊**：上緣方角、只留下方兩個圓角，往上塞進主卡底下
- 刷卡金類**直接顯示 summary**，最多兩行、截斷不補救
- 獎品區以獎品為主：**縮圖 ＋ 完整品名不截斷**（`gift_image_url` 有圖的 7 檔走現成的
  `.promo-gift-thumb` 縮圖＋lightbox 機制，無圖的沿用 `onerror` 隱藏）
- 淘汰：長條圖、金額級距、一卡一列比較表、類型分頁

**卡片特色區塊**

- 區塊名稱：常態活動 → **「卡片特色」**
- 右上角「查看全部 ›」（原卡名旁的 ⓘ 移到這裡），點擊直接捲到詳情頁的**指定通路回饋**
- 資料來源走 **Highlights 必列 ＋ 自動補滿**
- **固定顯示國內消費／國外消費的回饋率**
- 台新 Richart 卡不用 `category`、改用 `items`
- 「全場最高」不用 chip（會擠爆版面），改用其他呈現方式

## 新的實作結論（v2 實跑）

**標籤規則（已一般化，不是台新特例）**：`category` 命中
`/方案|切換|任務|首次|綁定|登錄|滿額|滿千/` 就判定為「條件」而非「通路」→ 標籤改用
`items`、原 `category` 降級成灰色條件後綴。台新 Richart 卡因此從
「10% 切換「Chill刷」方案」變成「10% 詹記麻辣火鍋、萬客什鍋…等 34 項〔切換「Chill刷」方案〕」。

**固定兩行直接讀骨幹槽 slot 21／22**（見 `cashbackmodel-fill-guide.md` 第 4 節），
跑同一支 `getDisplayRate()`。覆蓋率實測：**slot21 = 23/23、slot22 = 15/23**；
缺的 8 張退回卡片級欄位推算（那條路沒有 `cashbackModel` 把關，數字沒有保證）。

**Highlights 反查**：`merchant` 可能是快捷搜尋 displayName（「所有計程車」），
必須走快捷展開再比對 `items` 全清單。一卡一通路可能命中多組活動，
目前取**回饋率最高**的那組。實測兩則因此與 sheet 對不上：

- 玉山 Uni 卡「支付寶」：sheet 4.5% vs 真活動 3%
- 中信 uniopen「夢時代購物中心」：sheet 7% vs 真活動 11%

⚠️ **折進固定兩行的條件**：只有「反查不到任何指定通路槽」時才把 Highlights 折進
國內／國外那兩行。一開始寫成用字串比對 merchant 名稱，結果中信 uniopen 的
「國外實體消費」（對得到 11% 的加碼槽）被折進 3% 的固定行、直接把數字講錯了。

**釘選的副作用**：釘選項不見得是回饋率最高的。滙豐 Live+ 卡會出現
「4.88%（釘選）排在 5.88% 上面」——人工策展本來就會這樣，但要先接受
「這一欄不是嚴格遞減」，否則日後會被當成排序 bug 回報。

## 待站長裁決

1. **Highlights 反查對不上時**以真活動為準（目前預設），還是同時在匯出 log 標成待修？
2. **分級卡顯示哪一級？** 目前取第一個級別（沿用 spotlight modal 慣例）並在標題旁標
   「以『○○』計」。但永豐大戶卡第一級是「大戶Plus等級」，顯示國內 5%／國外 6%，多數人拿不到。
3. **缺 slot22 的 8 張卡**要不要補？補齊是 Sheets 一張卡一格的事。
4. **同一張卡的多檔新戶活動能不能相加？** Sheets 沒有欄位表達互斥，程式推不出來。
5. **generatePromosPageHtml 需要 `getDisplayRate()`，而它在 `js/`、Apps Script 讀不到。**
   建議照 `tools/build-merchant-pages.js` 的成例在 Cloudflare Pages build 時用 Node vm 注入，
   不要把 `getDisplayRate()` 移植進 `cards-export.gs`（那會變成第四份副本）。

## 「查看全部」怎麼接（不用新做東西）

詳情頁已有 `#card-special-section` 與對應導覽鈕
（`index.html` 的 `.card-detail-nav-btn[data-section="card-special-section"]`）；
promos 頁已有常駐 iframe ＋ `postMessage({type:'pmc-open-card', cardId})`（`promos.js`）。
加一個 `section` 欄位、embed 端收到後點一下那顆導覽鈕即可——**兩邊各一行**。

## 資料問題（與改版無關，但會顯示在頁面上）

`newCardholderPromos` 有一列**中信 LINE Pay 卡**的活動：`promo_types`、獎勵欄位、
`period_end` 全空。無 `period_end` ＝不限期，所以沒被過期過濾擋掉，
現在就渲染在 `/promos` 上，是一張什麼都沒寫的空卡片。要嘛補完、要嘛刪列——
生成器不該替資料做這個決定。
