# 回歸驗證（改 script.js 計算/搜尋/顯示邏輯後必跑）

> 2026-07-12 起已自動化：**優先跑腳本**，人工流程只在腳本壞掉時當備援。
> 執行方法、基準過期判斷、維護規則見 `tools/regression/README.md`。

## 怎麼跑（正常情況只需要這個）

```bash
npm install playwright --no-fund --no-audit --loglevel=error   # 一次性；靜音參數必帶（省下數百行安裝雜訊）
node tools/regression/run-regression.js   # 差異 → exit 1 並列出哪一組哪張卡不同
```

改動前先跑一次確認綠燈 → 改動 → 再跑。預期內的結果改變：逐條確認差異報告後
`--update-baseline` 重拍，新基準連同改動一起 commit。基準檔在 `tools/regression/baseline.json`
（綁定 cards.version；cards.data 更新或活動到期造成的差異屬預期，見 README）。

## 12 組檢查的語義（腳本 CHECKS 陣列與此表同步維護）

金額統一 NT$30,000。「守的機制」欄是這組存在的理由——改腳本或換搜尋詞時不可以讓機制失去覆蓋。

| # | 搜尋詞 | 守的機制 |
|---|---|---|
| 1 | `日本` | waterfall 海外三層計算 ＋ levelSettings（DBS Eco 應出現） |
| 2 | `禾乃川` | DBS Eco specialItems ＋ hideInDisplay 不干擾搜尋 |
| 3 | `Apple Pay`（Sport 卡 5%） | stacking（rate+basic+domesticBonusRate）加總顯示 |
| 4 | `悠遊卡自動加值`（大戶卡） | `rate` 排除型模型：溢出算 0 不是 basic |
| 5 | `meta廣告` | rate=0 stacking 槽有被匯出＋overseasCashback 特例 |
| 6 | 快捷「所有停車」 | displayParkingBenefits 收到 searchKeywords 陣列 |
| 7 | `家樂福` | 一般回饋＋停車折抵同時出現（benefits 多筆同 ID） |
| 8 | `linepay` | Type B 分級卡（玉山 Uni Card）placeholder 解析非 0/NaN |
| 9 | `全聯福利中心` | CUBE 卡路徑 |
| 10 | `Hotels.com` | coupon 顯示＋領券溢出用 basicCashback（檔期至 2026/12/31，到期換活的） |
| 11 | 快捷「所有加油站」 | handleQuickSearch 多關鍵詞路徑 |
| 12 | `zzz測試`（不存在） | 無匹配 fallback（buildBasicCashbackResult）不噴錯 |

腳本另外全程收集 console error（pageerror + console.error），基準是 0 條。

## 人工備援流程（只在腳本壞掉時用）

```bash
python3 -m http.server 8000   # 開 http://localhost:8000/index.html?start&debug=1
```
逐組輸入上表搜尋詞＋NT$30,000，記錄前三名結果卡的「卡名／回饋率／回饋金額」與改動前比對；
另檢查：console 無紅字、任一分級卡詳情頁級別可切換且無 NaN。
（注意：無 `?start` 參數時全新瀏覽器會被轉址到 landing.html。）

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
- [2026-07-12] 快捷搜尋自動計算在測試中不觸發 → handleQuickSearch 檢查 calculateBtn.disabled 的時機早於 validateInputs()（script.js:1181 vs 1193 的時序）→ 自動化腳本比照真實用戶：點快捷按鈕後自己按計算鈕；此時序若要修屬 UX 行為變更，先問用戶
- [2026-07-12] 領券檢查用了已到期商家（台灣永生 2026/6/30 止）導致 0 券 → 檢查詞要挑檔期最長的活動並在表格註明到期日 → 到期時換商家並重拍基準
