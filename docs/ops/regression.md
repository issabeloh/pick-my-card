# 回歸驗證（改 script.js 計算/搜尋/顯示邏輯後必跑）

> 2026-07-12 起已自動化：**優先跑腳本**，人工流程只在腳本壞掉時當備援。
> 執行方法、基準過期判斷、維護規則見 `tools/regression/README.md`。

## 怎麼跑（正常情況只需要這個）

```bash
npm install playwright --no-fund --no-audit --loglevel=error   # 一次性；靜音參數必帶（省下數百行安裝雜訊）
node tools/regression/run-regression.js   # 差異 → exit 1 並列出哪一組哪張卡不同
```

改動前先跑一次確認綠燈 → 改動 → 再跑。預期內的結果改變：逐條確認差異報告後
`--update-baseline` 重拍，新基準連同改動一起 commit。

## 為什麼測試不讀線上 cards.data（2026-09-11 改）

**測試讀的是 `tools/regression/fixture.data`（凍結的資料副本），而且瀏覽器的時鐘被固定在
`fixture.json` 的 `frozenDate`。線上 `cards.data` 更新不會讓回歸變紅。**

改這件事的原因：基準存的是「答案」，而答案＝程式 × 資料 × 日期。線上 cards.data 一天更新
3–5 次，基準因此一天就過期——2026-09-10 那次實測 6 組紅燈，**0 組是程式問題**（4 組只是活動
條件文案改寫，2 組是兩張卡的國內加碼活動結束）。真正的程式回歸會被埋在這種噪音裡沒人看得出來。
凍結之後，紅燈＝程式行為真的變了。

⚠️ **只凍資料不凍時鐘沒有用**：`filterExpiredRates()` 與 `getRateStatus()` 都拿「今天」比對活動
期限，真實日期一天天往前走，凍結資料裡的活動照樣會到期、結果照樣漂移。所以兩個都要凍。

### 凍結資料的重拍時機

平常**不用**重拍。只有這三種情況：

1. **Apps Script 匯出格式改了**（新欄位、新的 cashbackModel 寫法）——要確認程式吃得下新格式
2. **新增了結構特殊的卡**，想讓它進入回歸覆蓋
3. **凍結資料裡的活動到期了**，那組檢查失去它守的機制（例如第 10 組的領券檔期到 2026/12/31）

```bash
node tools/regression/run-regression.js --update-fixture    # 重拍凍結資料（凍結日期設為當天）
node tools/regression/run-regression.js --update-baseline   # ⚠️ 接著一定要重拍基準
```

兩步都做完才 commit。只拍 fixture 不拍基準的話，下次比對會示警說兩者對不上。

### 想驗「線上資料有沒有把引擎弄壞」

那是**資料驗證**，不是程式回歸，用另一個模式：

```bash
node tools/regression/run-regression.js --live   # 用線上 cards.data 與真實日期跑，不比對基準
```

它只回報有沒有 console error／有沒有跑不完，不做逐字比對（線上資料天天變，逐字比對無意義）。

**基準快照**（沿革）：`20260910-140838`（2026-09-10 重拍；那一版起累積 6 組紅燈，全是資料漂移，
促成了 2026-09-11 改成凍結資料）。

**差異出現時怎麼判斷**：資料與時鐘都凍住了，所以**任何差異都是程式行為變了**——沒有「這是資料
漂移，重拍就好」這個選項。差異要嘛是你這次改動的預期結果（確認後 `--update-baseline`），
要嘛是回歸（去修）。逐條比對可以直接 diff 兩個 JSON：

```bash
python3 -c "
import json,difflib
r=json.load(open('tools/regression/last-run.json'))['checks']
b={c['id']:c for c in json.load(open('tools/regression/baseline.json'))['checks']}
for x in r:
    y=b.get(x['id'])
    if not y or json.dumps(x,sort_keys=True)==json.dumps(y,sort_keys=True): continue
    print('=== #%s %s ===' % (x['id'], x['query']))
    for l in difflib.unified_diff(json.dumps(y,ensure_ascii=False,indent=1,sort_keys=True).split(chr(10)),
                                  json.dumps(x,ensure_ascii=False,indent=1,sort_keys=True).split(chr(10)),
                                  lineterm='', n=0):
        if not l.startswith(('+++','---','@@')): print(l[:400])
"
```


## 各組檢查的語義（腳本 CHECKS 陣列與此表同步維護）

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
| 13 | `Youbike 2.0` | **只有領券型活動**：活動結果必須是 0 筆（不列基本回饋把券壓下去）＋領券 1 筆（玉山 Uni Card 的券，檔期至 2026/9/30，到期要換一張只存在於 couponCashbacks 的活商家） |

腳本另外全程收集 console error（pageerror + console.error），基準是 0 條。

**第 13 組刻意只驗「筆數」、不驗匹配狀態列的文字**：那一行的文案會被隨時調整（2026-09-11 一天內就改過兩次），把字放進基準等於每次改文案都紅一次——正是凍結資料要除掉的那種噪音。它守的是**邏輯**：「只有領券時不列基本回饋」與「領券算有結果」。這兩條壞掉時活動筆數會從 0 跳回 33，數字就抓得到。

就緒後另跑**訪客首屏斷言**（2026-07-21 加，非基準比對、失敗直接 exit 1）：
`#product-intro-section` 不得存在於 DOM（hero 已於 2026-07-20 移除）、`#merchant-input` top 必須在 0–600px。
守的機制：「HTML 與 JS 不同步」類事故（如 merge 拿錯檔案版本）——搜尋計算可能全綠但首屏已壞（PR #337 事故）。

## 刪除帳號與資料（獨立一支，2026-08-20 新增）

```bash
node tools/regression/delete-account-test.js   # 24 項，全過 → exit 0
```

`run-regression.js` 的 Firebase 替身固定回訪客（onAuthStateChanged → null），跑不到登入後的
路徑；刪除帳號是全站唯一會永久毀掉用戶資料的功能，所以另外一支自帶「已登入用戶」替身。
**改 `js/auth-user-data.js` 的「刪除帳號與全部資料」區塊後必跑。**
最重要的一組是「身分驗證失敗時一筆資料都不能刪」——刪除順序寫錯會留下沒有任何人刪得掉的
孤兒文件（Firestore 規則按 `<uid>_<cardId>` 授權，帳號一沒了就再也碰不到那些文件）。

## 人工備援流程（只在腳本壞掉時用）

```bash
python3 -m http.server 8000   # 開 http://localhost:8000/index.html?start&debug=1
```
逐組輸入上表搜尋詞＋NT$30,000，記錄前三名結果卡的「卡名／回饋率／回饋金額」與改動前比對；
另檢查：console 無紅字、任一分級卡詳情頁級別可切換且無 NaN。
（注意：無 `?start` 參數時全新瀏覽器會被轉址到 landing.html。）

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
- [2026-09-11] 基準每 1–2 天就要重拍一次，而每次紅燈幾乎都不是程式問題（9/10 那次 6 組紅燈，0 組是回歸）→ 基準存的是「答案」，答案＝程式 × 資料 × 日期；線上 cards.data 一天更新 3–5 次，基準的壽命因此只有一天，真正的程式回歸被埋在資料噪音裡 → **測試改讀凍結的 `tools/regression/fixture.data`、並把瀏覽器時鐘固定在 `fixture.json` 的 `frozenDate`**。只凍資料不凍時鐘沒有用（`filterExpiredRates()`／`getRateStatus()` 拿「今天」比期限，活動照樣會到期）。凍結後任何差異都代表程式行為變了，不再有「資料漂移、重拍就好」這個選項；要驗線上資料改用 `--live`（那是資料驗證，不做逐字比對）
- [2026-07-12] 快捷搜尋自動計算在測試中不觸發 → handleQuickSearch 檢查 calculateBtn.disabled 的時機早於 validateInputs()（script.js:1181 vs 1193 的時序）→ 自動化腳本比照真實用戶：點快捷按鈕後自己按計算鈕；此時序若要修屬 UX 行為變更，先問用戶
- [2026-09-08] 基準停在 20260902-155444 沒重拍，資料一路更新到 20260908-165106，12 組長期紅 2→4→5 組 → 每次改動都要靠「stash 後再跑一次比對」才知道差異是不是新的，等於這套機制暫時失效 → **基準過期就當天重拍**，不要累積；重拍前一定逐條看差異報告（本次 6 條差異全部只動到 `matched` 文字欄，回饋率／回饋金額／回饋消費上限／筆數／排序／threshold／parking／coupons 全部逐字相同，才敢重拍）
- [2026-07-12] 領券檢查用了已到期商家（台灣永生 2026/6/30 止）導致 0 券 → 檢查詞要挑檔期最長的活動並在表格註明到期日 → 到期時換商家並重拍基準
