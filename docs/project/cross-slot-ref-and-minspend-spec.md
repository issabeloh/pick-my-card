# 跨槽引用 `rate_N` ＋ 滿額門檻 `minSpend`：實作規格

> 2026-07-14 用戶核定。實作前必讀 `docs/project/cashback-engine.md` 第 6 節（cashbackModel 文法）。
> 動機：部分卡（如中信 uniopen 踩點任務）的回饋率由「多個活動的 rate_N 疊加」組成，
> 且卡片級 domesticBonusRate/overseasBonusRate 表達不了（不是國內/海外加碼，是特定活動疊加）。

## 功能一：cashbackModel 跨槽引用 `rate_N`

### 語法與語義（合約，前端引擎與 Sheet 必須一致）
- 在 cashbackModel 的 **stacking（`+`）** 字串裡，可寫成分 `rate_N`，N＝同卡 `cashbackRates` 陣列的 **1-based 槽位編號**（＝ Sheet 的 `rate_N`/`cap_N` 欄編號）。
- `rate_N` 解析為：讀 `card.cashbackRates[N-1]` 的 **原始 rate 值**，配 **該槽的 cap**，作為一個獨立 stacking 層（作用於全額、吃該槽自己的 cap）加進總額。
- **非遞迴**：只讀那一槽的原始 rate/cap 數字，**不執行**那一槽自己的 cashbackModel。→ 循環引用（A↔B）不可能發生。
- 若被引用槽的 rate 是 `{...}` placeholder（hasLevels 卡），用同一 `levelSettings` 經 `parseCashbackRate`/`parseCashbackCap` 解析（與現有 placeholder 系統一致）。uniopen 非 hasLevels，此分支對它是 no-op，但要支援以防未來。
- **僅在 `+`（stacking）分支有效**。`>`（waterfall）與裸 `rate` 分支不支援 `rate_N`（本次不做；若在這兩種分支偵測到 `rate_N` token，`console.error` 一筆並忽略該 token，不得靜默算錯）。

### 驗證用例（uniopen；假設 統一集團2% 在槽X、踩點4% 在槽5）
| 槽 | 自己 rate | cashbackModel | 期望總率 | 期望分層 cap |
|---|---|---|---|---|
| 踩點 category_5 | 4 | `rate+rate_X+basic` | 7% | rate自己cap_5、rate_X吃cap_X、basic無 |
| icashPay+踩點 category_2 | 4 | `rate+rate_5+rate_X+basic` | 11% | rate自己cap_2、rate_5吃cap_5、rate_X吃cap_X、basic無 |

**關鍵**：category_2 引用槽5 拿到原始 4（非槽5總額7），故 basic 與統一集團不會重複計。

### 實作點（script.js；行號為 2026-07-14 快照，以 Grep 為準）
1. **解析器**（`calculateCardCashback` 內選 model 的區塊，約 3868–3914）：偵測 model 含 `+` 且成分有 `rate_N` pattern（`/^rate_\d+$/`）時，收集所有被引用槽的 (rate, cap)，往 stacking 傳。
2. **`calculateStackedCashback`（約 3533）**：新增參數（如 `extraLayers`＝被引用槽解析出的 `{rate, cap, name}` 陣列），在 Layer 3 後逐一 push 成獨立層、各吃自己 cap、加進 totalCashback 與 totalRate。層名用被引用槽的 `category`（無則「活動N加碼」）。
3. **顯示總率 `getDisplayRate`（約 3323）** 與 **計算明細 `rateCompositionButtonHtml`（約 3336）**：加總與分層說明都要含跨槽層（明細列出被引用槽的 category＋rate＋cap）。
4. **排序路徑 `parseCashbackRateSync`（約 4450）/ getDisplayRate 在 7906/8571 等呼叫點**：確保排序用的總率也含跨槽層（否則排序與顯示不一致）。sync 版拿不到 card 時要能優雅退化（至少不報錯）。
5. **preflight 安全網**（`tools/preflight.sh`）：掃所有 `cashbackModel_N` 出現的 `rate_N` token，機械驗證該卡確實有第 N 槽（`rate_N`/`items_N` 存在）。缺槽→ exit 1 擋 commit（補位置脆弱性：用戶已在 Sheet 用框線人工標記被引用槽）。

## 功能二：滿額門檻 `minSpend`

### 語法
- Sheet 新增 per-slot 欄 `minSpend_N`（單筆最低消費，數字）。匯出已加（`cards-export.gs`：`addOptionalField(..., 'minSpend_${j}', 'number', 'minSpend')`）。空值不寫入。
- 前端：`rateGroup.minSpend`。

### 語義（要在回報向用戶再確認一次）
- 計算某槽時，若輸入金額 `amount < minSpend` → **該槽不符資格（disqualified），不貢獻此活動回饋**。
- **落地行為**：該槽被視為未命中；若該卡無其他命中槽，退回 `buildBasicCashbackResult`（基本回饋）。
  - 理由：低於門檻時用戶「仍享一般消費基本回饋」，顯示 0% 是錯的（會誤導比較）。「卡整槽」＝卡掉這槽的特別加碼，不是把卡片回饋歸零。
  - ⚠️ 這比字面「整槽歸 0」多一步 basic 退回——實作後在回報明說，讓用戶有機會否決。

### 實作點
- `calculateCardCashback` 命中槽後、計算前：`if (rateGroup.minSpend && amount < rateGroup.minSpend) { 跳過此槽 }`。
- 詳情頁顯示：該活動加註「單筆滿 NTD{minSpend} 起」（`renderCashbackRatesIndividually` / conditions 區）。可選但建議。

## 驗收
- [ ] uniopen 兩個用例總率＝7%/11%，分層 cap 正確（起 server 實測或回歸用例）
- [ ] minSpend：金額<門檻該槽不算、退回 basic；≥門檻正常
- [ ] 既有 stacking/waterfall/簡單路徑卡回饋**不變**（回歸零 diff，除了新標 model 的 uniopen 等目標卡）
- [ ] preflight 新檢查：故意寫一個指向不存在槽的 rate_N → exit 1
- [ ] `tools/preflight.sh` 通過；`node tools/regression/run-regression.js` 跑過（目標卡的預期差異重拍基準）
- [ ] `docs/project/cashback-engine.md` 第 6 節補跨槽引用與 minSpend 文法；本 spec 與它不重複（spec 記設計決策，engine.md 記使用規則）

## 命名澄清（避免未來混淆）
`{rate_1}`（大括號，在 rate/cap **值欄位**，hasLevels 卡讀 levelSettings）與 `rate_5`（無括號，在 **cashbackModel 欄位**，引用兄弟槽）是**兩套不同語法、不同欄位**，不衝突。文件要寫清楚。
