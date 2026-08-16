# cashbackModel 填表範本（從「猜」變「抄」）

> **先讀 `docs/project/cashback-engine.md` 第 6 節**——那是文法的唯一權威（`+` 疊加／`>` 瀑布／
> 單獨 `rate` 排除／留空簡單路徑、跨槽引用 `rate_N`、`minSpend`/`maxSpend`）。
> 本檔不重述文法，只提供**填表流程**：官網那句「回饋組成」句 → 欄位值的確定性映射。

## 0. 適用範圍（先確認你的卡在範圍內，否則本檔幫不上忙）

**✅ 適用**：官網／DM 有一句把回饋**拆解成分**的句子，例如
> 指定通路最高享 3% 現金回饋（即原卡片國內一般消費回饋 0.5%，國外刷卡回饋 2%，國內一般消費加碼
> 2.5%，國外消費加碼 1%，加碼回饋每戶每月上限 500 元，需登錄）

有這句，整張卡的**骨幹**（卡片級四欄）＋**一般國內／國外槽**就是抄的，不是猜的。

**❌ 不適用（仍需人工判斷，本檔不涵蓋）**：
- 官網只寫「最高 X%」、不拆解成分 → 成分要自己查條款、拆錯就算錯
- **`>` 瀑布模型的卡**（如 dbs-eco 的部分槽）：組成句是「各成分同時作用」的疊加語意，瀑布是
  「cap 用完才溢出下一層」，兩者算出來的數字不同——組成句**不能**直接翻成 `>`
- **`hasLevels` 分級卡**（kgi-eslite、sinopac-dawho、cathay-cube…）：骨幹四欄照填，但指定通路槽的
  `{rate}`/`{cap}` placeholder 要對**每個級別**各驗一次（→ cashback-engine.md 第 1、2 節）
- 需要 `minSpend`/`maxSpend` 互斥槽、或跨槽引用 `rate_N` 的活動（→ `cross-slot-ref-and-minspend-spec.md`）
- 「上限 N 元」的**週期**（每月／每年／整檔期）：cap 換算公式照用，但引擎不做週期重置，週期只寫進
  `conditions` 給人看

---

## 1. 規則對照表：組成句片語 → 欄位

| 組成句裡的片語 | 填進哪個欄位 | 層級 | 備註 |
|---|---|---|---|
| 「（原卡片）**國內**一般消費回饋 X%」／「一般消費回饋 X%」 | `basicCashback` | 卡片級 | 必填 |
| 「**國外**刷卡回饋 X%」／「海外一般消費 X%」 | `overseasCashback` | 卡片級 | 留空→引擎退回 `basicCashback` |
| 「**國內**（一般消費）**加碼** X%」 | `domesticBonusRate` | 卡片級 | |
| 「**國外／海外**（消費）**加碼** X%」 | `overseasBonusRate` | 卡片級 | |
| 「加碼回饋每戶每月**上限 N 元**」 | `domesticBonusCap` / `overseasBonusCap` | 卡片級 | **cap = N ÷ 加碼率**，見第 2 節 |
| 「指定通路**最高享 Y%**」 | 該通路一個 `rate_N` 槽 ＋ `cashbackModel_N` | 槽位級 | **Y 不是 `rate_N` 的值**，見第 3 節 |
| 「需登錄」「需辦電子帳單」「排除繳稅」 | `conditions_N` | 槽位級 | 純文字，不參與計算 |

⚠️ **上限是「回饋金額」，欄位是「消費金額」**——這是最常填錯的一格。

---

## 2. cap 換算：上限金額 ÷ 加碼率

```
cap = 回饋上限金額(元) ÷ (加碼率% ÷ 100)
```

以開頭那句為例（上限 500 元）：

| 成分 | 率 | 換算 | 填入 |
|---|---|---|---|
| 國內加碼 | 2.5% | 500 ÷ 0.025 | `domesticBonusCap = 20000` |
| 國外加碼 | 1% | 500 ÷ 0.01 | `overseasBonusCap = 50000` |

**反向自檢（填完必做）**：`cap × 率` 應該回到一個整數的上限金額。現行 cards.data 全部通過：

| 卡 | cap × 率 | ＝上限 |
|---|---|---|
| tbb-artfun | 20000×2.5% ／ 50000×1% | 500 ／ 500 |
| ctbc-uniopen | 3750×4% | 150 |
| dbs-eco | 12000×2.5%（國內外同） | 300 |
| sinopac-sport | 5000×1% | 50 |
| hsbc-liveplus | 20000×1% | 200 |
| firstbank-ileo | 33333.33×1.5% | 500 |
| kgi-eslite | 20000×2% | 400 |

算出來不是整數（如 33333.33）**是正常的**——上限才是整數，cap 是它除出來的結果。

---

## 3. 指定通路槽：`rate_N` 填多少、`cashbackModel_N` 寫什麼

引擎在 Fix B 之後是**「寫什麼算什麼」**：model 字串沒列的成分一律不加。所以：

```
rate_N ＝ 組成句的「最高 Y%」 −（cashbackModel 裡列出的成分之和）
```

**先選 model，再回推 rate_N**：

| 組成句怎麼說這個通路 | `cashbackModel_N`（國內／國外） |
|---|---|
| 原卡回饋 **＋** 一般加碼 **都照給**，通路再加碼 | `rate+basic+domesticBonusRate` ／ `rate+overseasCashback+overseasBonusRate` |
| 只提「原一般消費回饋」、**沒提加碼** | `rate+basic` ／ `rate+overseasCashback` |
| Y 完全由骨幹組成、通路本身沒有額外加碼 | `basic+domesticBonusRate` ／ `overseasCashback+overseasBonusRate`（**`rate_N` 填 0**） |
| 該通路**完全排除**在一般消費外（cap 內固定率、溢出算 0） | 單獨 `rate`（填前必須確認真的排除，→ 第 6 節 ⚠️） |

**國內／海外只看字串**：有 `overseasBonusRate` 或 `overseasCashback` 任一 token 就走海外基準，
不看搜尋詞、不看 item 名稱（→ cashback-engine.md 第 6 節）。

四個實例（都經第 6 節實測）：

| 卡／槽 | 「最高 Y%」 | model | 成分和 | ⇒ `rate_N` |
|---|---|---|---|---|
| tbb-artfun slot2（國內指定通路） | 3% | `basic+domesticBonusRate` | 0.5+2.5=3 | **0** |
| tbb-artfun slot3（台灣Pay） | 2% | `rate+basic` | 0.5 | **1.5** |
| sinopac-sport slot1（Apple Pay…） | 5% | `rate+basic+domesticBonusRate` | 1+1=2 | **3** |
| ctbc-uniopen slot5（國外實體） | 11% | `rate+overseasCashback+overseasBonusRate` | 2+1=3 | **8** |

---

## 4. 骨幹槽位慣例（slot 14／21／22）

卡片級四欄只是「數字」，**要讓搜尋算得出來，還得有槽位承載它們**。現行資料已有穩定慣例
（28 張卡一致，`slot` 是 Sheet 真實槽號，不是陣列位置）：

| slot | `items` | `rate` | `cashbackModel` | 用途 |
|---|---|---|---|---|
| **21** | `國內消費` | `0` | `basic+domesticBonusRate` | 一般國內消費 |
| **22** | `國外` | `0` | `overseasCashback+overseasBonusRate` | 一般國外消費 |
| **14** | `meta廣告`,`google廣告` | `0` | 依該卡把網路廣告算國內或國外 | 國外消費特列項目 |

`cap` 填卡片級對應的 bonus cap（沒有上限就留空）。**卡沒有 `overseasBonusRate` 欄位時 slot22 照填**
——`overseasCashback+overseasBonusRate` 的加碼層會自然算 0（sinopac-sport 實測 1%，見第 6 節）。

---

## 5. 空白填表範本（複製這段去填）

```
【卡片級骨幹】── 抄組成句
basicCashback      = ____ %      ← 「國內一般消費回饋 X%」
overseasCashback   = ____ %      ← 「國外刷卡回饋 X%」（沒有就留空）
domesticBonusRate  = ____ %      ← 「國內…加碼 X%」
domesticBonusCap   = ____        ← 上限____元 ÷ (dbr/100)；無上限留空
overseasBonusRate  = ____ %      ← 「國外…加碼 X%」
overseasBonusCap   = ____        ← 上限____元 ÷ (obr/100)；無上限留空

【骨幹槽位】── 照第 4 節慣例，不用想
slot 21  items=國內消費        rate=0  cap=<domesticBonusCap>  model=basic+domesticBonusRate
slot 22  items=國外            rate=0  cap=<overseasBonusCap>  model=overseasCashback+overseasBonusRate
slot 14  items=meta廣告,google廣告  rate=0  cap=____            model=____（國內或國外，看該卡條款）

【指定通路槽】── 每個活動一槽，重複填
slot ___  category = ______________
          items    = ______________
          最高 Y%  = ____ %
          model    = ____________________  ← 第 3 節決策表
          rate     = Y − (model 列出的成分和) = ____ %
          cap      = 該通路上限____元 ÷ (rate/100)；無上限留空
          period / periodStart / periodEnd = ______________
          conditions = 需登錄？電子帳單？排除項目？（純文字）
          minSpend / maxSpend = 只有互斥門檻活動才填（→ spec 檔）

【填完自檢】
□ 每個 cap × 對應率 = 整數上限金額
□ 每個指定通路槽：rate + model 列出的成分和 = 組成句的 Y%
□ 海外槽的 model 含 overseasCashback 或 overseasBonusRate（否則會用國內基準算）
□ model 沒列的成分不會被加（Fix B）——別以為卡片級加碼會自動疊上去
□ 跑一次引擎實測（第 7 節腳本），確認算出來的率＝組成句的率
```

---

## 6. 實測驗證（2026-08-16，cards.data 當時版本，16/16 通過）

從 cards.data 挑 3 張卡，照本範本從組成句反推欄位，再用 Playwright 載入 `index.html` 直接呼叫
`calculateCardCashback(card, term, amount)` 比對。**「率」欄全部命中組成句宣稱的率**。

### 藝FUN悠遊御璽卡（tbb-artfun）— 開頭那句組成句的本尊
組成句：國內一般 0.5%、國外刷卡 2%、國內加碼 2.5%、國外加碼 1%、加碼上限每月 500 元。
⇒ `basicCashback=0.5`、`overseasCashback=2`、`domesticBonusRate=2.5`/`Cap=20000`、
`overseasBonusRate=1`/`Cap=50000`。

| 搜尋 | 金額 | 命中 | 實測率 | 實測金額 | 分層 |
|---|---|---|---|---|---|
| 國內消費 | 10,000 | slot21 `basic+domesticBonusRate` | **3%** | 300 | 0.5%×10000=50 ＋ 2.5%×10000=250 |
| 國內消費 | 30,000 | slot21 | **3%** | 650 | 0.5%×30000=150 ＋ 2.5%×**20000**=**500**（撞上限 500 元 ✓） |
| 國外 | 10,000 | slot22 `overseasCashback+overseasBonusRate` | **3%** | 300 | 2%×10000=200 ＋ 1%×10000=100 |
| 國外 | 60,000 | slot22 | **3%** | 1,700 | 2%×60000=1200 ＋ 1%×**50000**=**500**（撞上限 500 元 ✓） |
| OPENTIX兩廳院文化生活 | 10,000 | slot2 `basic+domesticBonusRate` | **3%** | 300 | 50 ＋ 250（＝組成句「指定通路最高 3%」✓） |
| agoda | 10,000 | slot1 `overseasCashback+overseasBonusRate` | **3%** | 300 | 200 ＋ 100 |
| 台灣Pay | 5,000 | slot3 `rate+basic` | **2%** | 100 | 0.5%×5000=25 ＋ 1.5%×5000=75（**不含加碼**，因 model 沒列 ✓） |

兩筆撞上限的案例是 **cap 換算公式的直接驗證**：加碼層金額剛好停在 500 元。

### 中信 Uniopen 聯名卡（ctbc-uniopen）— 加碼上限 150 元、國外加碼無上限
`basicCashback=1`、`overseasCashback=2`、`domesticBonusRate=4`/`Cap=3750`、`overseasBonusRate=1`/無上限。

| 搜尋 | 金額 | 命中 | 實測率 | 實測金額 | 分層 |
|---|---|---|---|---|---|
| 國內消費 | 10,000 | slot21 | **5%** | 250 | 1%×10000=100 ＋ 4%×**3750**=**150**（上限 150 元 ✓） |
| 國外 | 10,000 | slot22 | **3%** | 300 | 2%×10000=200 ＋ 1%×10000=100（無上限 ✓） |
| 統一超商 | 2,000 | slot3 `rate+rate_1+rate_2+basic` | **11%** | 220 | 1%+4%+2%+4%，全部未撞 cap ⇒ 實得率＝顯示率 |
| 統一超商 | 10,000 | slot3 | 顯示 **11%** | 850 | 指定 4% 只吃 cap 3750 ⇒ **實得 8.5%** |
| 統一超商 | 100 | slot4 `rate+rate_1+basic` | **7%** | 7 | 4%+2%+1%；model 沒列 `domesticBonusRate` ⇒ 卡片級 dbr=4 **不加**（Fix B ✓，若加會是 11%） |
| 國外實體消費 | 5,000 | slot5 `rate+overseasCashback+overseasBonusRate` | **11%** | 550 | 8%×5000=400 ＋ 2%×5000=100 ＋ 1%×5000=50 |

⚠️ 「統一超商 10,000」那列是**顯示率與實得率的正常分歧**：顯示率是「最高可得」的加總，
cap 一撞就低於它。填表時別把實得率當成組成句的 Y。

### 永豐 Sport 卡（sinopac-sport）— 沒有 overseasBonusRate 欄位
`basicCashback=1`、`overseasCashback=1`、`domesticBonusRate=1`/`Cap=5000`、無 `overseasBonusRate`。

| 搜尋 | 金額 | 命中 | 實測率 | 實測金額 | 分層 |
|---|---|---|---|---|---|
| Apple Pay | 6,000 | slot1 `rate+basic+domesticBonusRate` | **5%** | 290 | 3%×6000=180 ＋ 1%×6000=60 ＋ 1%×**5000**=**50**（上限 50 元 ✓） |
| 國內消費 | 10,000 | slot21 | **2%** | 150 | 1%×10000=100 ＋ 1%×5000=50 |
| 國外 | 10,000 | slot22 `overseasCashback+overseasBonusRate` | **1%** | 100 | 1%×10000=100；**無 obr 欄位 ⇒ 加碼層自然為 0**，model 照填不會出錯 ✓ |

## 7. 重跑這份驗證

驗證腳本不進 repo（一次性），手法直接沿用 `tools/regression/run-regression.js`：複製它的
`startServer()` / `firebaseStub()` / `page.route()` 三段（自帶靜態站 ＋ Firebase 替身 ⇒ 確定性訪客模式），
把它的搜尋 UI 操作換成直接呼叫引擎：

```js
await page.goto(`${base}/index.html?start&debug=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.card-count')?.textContent?.trim() || ''));
const got = await page.evaluate(async ({ id, term, amount }) => {
  const card = cardsData.cards.find(x => x.id === id);
  const list = await calculateCardCashback(card, term, amount);   // 回傳陣列（一卡可命中多槽）
  const best = list.slice().sort((a, b) => b.cashbackAmount - a.cashbackAmount)[0];
  return { rate: best.rate, amount: best.cashbackAmount, slot: best.matchedRateGroup?.slot,
           model: best.matchedRateGroup?.cashbackModel,
           layers: best.calculationLayers.map(l => `${l.name} ${l.rate}%×${l.applicableAmount}=${l.cashback}`) };
}, { id: 'tbb-artfun', term: '國內消費', amount: 30000 });
```

`calculationLayers` 是對帳關鍵：逐層列出率、適用金額、該層回饋，**cap 有沒有咬到一眼可見**。
（外部資源被 `route.abort()` 擋掉會留 3 筆 `net::ERR_FAILED` console error，屬預期。）

## 教訓記錄

- [2026-08-16] 手算指定通路槽期望值時漏算該槽自己的 `cap`（uniopen 統一超商 10,000 算成 1,100、實際 850）→ 顯示率是各層率加總、實得率會被任一層的 cap 拉低 → 對帳一律讀 `calculationLayers` 的 `applicableAmount`，不要用「金額 × 顯示率」反推
