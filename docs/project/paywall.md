# 去廣告付費牆（NT$100 一次買斷）

一句話：**登入 → 綠界付款 → 綠界通知後端 → 後端寫權益 → 前端不載入 AdSense loader。**

- 前端：`js/paywall.js`（順序 13）＋ `index.html`/`faq.html` 的 `<head>` 廣告閘門
- 後端：`functions/`（Cloudflare Pages Functions，與靜態站同一個 CF Pages 專案）；金流商可切換，見第 3 節
- 資料：Cloudflare D1（`orders`、`entitlements`），schema 在 `tools/paywall/schema.sql`

## 1. 為什麼是這個架構

| 決定 | 理由 |
|---|---|
| 後端用 Cloudflare Pages Functions | 站本來就部署在 CF Pages，加 `functions/` 就有 API，不必另一套部署或 Firebase Blaze 方案。綠界的 `CheckMacValue` 要用 HashKey/HashIV 計算，那兩把金鑰**絕不能出現在前端** |
| 權益放 D1，不放 Firestore | `firestore.rules` 允許用戶讀寫自己的 `users/{uid}`。付費旗標放那等於**用戶可以自行開通**。權益必須放在用戶碰不到、只有伺服器寫得動的地方 |
| 開通只認 server 對 server 通知 | 瀏覽器導回頁（`OrderResultURL`）的參數使用者改得動，拿它開通等於改網址就能白嫖 |
| 永久買斷、不自動續扣 | NT$100 的金額做定期定額不划算（授權管理、取消、扣款失敗處理的複雜度遠超收益） |

## 2. 三個保證怎麼成立的

**登入**：`/api/checkout` 只接受 `Authorization: Bearer <Firebase ID token>`，後端用 Google 的 JWK 端點＋Web Crypto 自驗 RS256（Worker 上沒有 firebase-admin）。前端傳來的 uid 一律不信，uid 只從驗過的 token 的 `sub` 取。未登入點購買 → 先開登入 modal，登入後自動接回購買流程。

**綁定身分**：建單當下就把 `MerchantTradeNo ↔ uid` 寫進 D1，**沒有「先付款、事後才知道是誰」的空窗**。`/api/ecpay/notify` 要過四道關卡才開通：CheckMacValue 正確 → MerchantID 相符 → 訂單存在 → 金額相符且 `RtnCode=1`。測試環境的 `SimulatePaid=1` 不開通。

冪等：綠界收不到 `1|OK` 會重送，`markOrderPaid()` 用 `WHERE status != 'paid'` 所以只有第一次真的改到列，`grantAdfree()` 是 `INSERT OR IGNORE`。

三層保險（通知遲到或漏送時）：① 付款導回後前端輪詢 `/api/entitlement` 六次 ② modal 裡的「重新查詢訂單」打 `/api/order-status`，後端主動向綠界 `QueryTradeInfo` 對帳補開通 ③ 都失敗才請用戶回報。

**完全去廣告**：付費用戶的頁面**根本不注入 AdSense loader**。這點是刻意的——loader 一旦載入，Auto ads 仍會自行插入廣告，而且 `display:none` 的版位照樣計曝光，兩者都讓「已付費卻還有廣告」成立。`tools/paywall/adfree-smoke.mjs` 用 Playwright 攔截網路請求，驗證的是「對 googlesyndication 的請求數 = 0」，不是「畫面上看不到」。

判斷用 localStorage 的 `pmc_adfree` 旗標（格式 `<uid>|<到期毫秒>`）：
- 存純字串不存 JSON：閘門跑在 `<head>`，比 `defer` 的 `js/core-utils.js` 早，`readLocalJSON()`（鐵則 2）此時還不存在
- 帶 uid → 換帳號登入時立刻發現對不上並作廢
- 帶到期時間（7 天）→ 退款或撤銷後最多 7 天一定回頭問一次後端
- 這是前端旗標，改 devtools 的人擋不住——但那等同裝擋廣告外掛，**不構成金流風險**，因為訂單與開通全在後端

## 2.5 成本結構

**這套架構不會新增任何月費**：

- **Firebase 不需要升 Blaze**——後端完全沒用 Cloud Functions 或 Admin SDK，Firebase 的用量與加付費牆前一模一樣（這是當初選 CF Pages Functions 而非 Firebase Functions 的主因之一）。可用 `grep -rn "firebase-admin\|firestore" functions/` 自我驗證
- **Cloudflare** 用量（可據此自行估算是否會超出免費額度）：

  | 情境 | 請求數 |
  |---|---|
  | 未登入訪客瀏覽 | **0**（`refreshAdfreeEntitlement()` 在 user 為 null 時直接 return，不打 API） |
  | 已登入用戶開一次頁 | 1 次 `/api/entitlement` ＋ 1 row read |
  | 完成一筆購買 | 約 10 次（建單＋通知＋導回＋輪詢） |

- 唯一的實質成本是**金流手續費**（NT$100 約 2.75%，≈2.75 元/筆）

若哪天登入用戶的瀏覽量真的逼近 Workers 免費額度，最省的優化是幫「查到未付費」的結果也加上幾小時的本機快取（目前只快取「已付費」），代價是換裝置購買後生效變慢。

## 2.6 金流商的選擇與切換

台灣多數金流商（綠界、藍新）的特店申請對**持永久居留證的外國人**不一定開放，這是選型的實際限制，不是技術問題。

程式碼對此的準備：`functions/_lib/payment.js` 把端點抽成 `ENDPOINTS[provider][mode]`，並提供 `PMC_PAY_CHECKOUT_URL` / `PMC_PAY_QUERY_URL` 兩個覆寫變數。

| 金流商 | 狀態 |
|---|---|
| 綠界 ECPay | 已實作，CheckMacValue 演算法有自我測試 |
| 歐付寶 O'Pay | 端點已備妥，但**網址是依同一命名慣例推得、尚未實測**。帳號下來後先跑 `mac-selftest.mjs`，再送一筆測試訂單確認不是回 CheckMacValue Error；若網址不同，設 `PMC_PAY_CHECKOUT_URL` 覆蓋即可 |
| OEN 應援科技（全跳轉） | **已選定**。API base：正式 `https://payment-api.oen.tw`／測試 `https://payment-api.testing.oen.tw`；結帳頁是另一個網域 `https://{merchantId}.oen.tw/checkout/{id}`（別混用）。`merchantId` = `pick-my-card`。認證用 `Authorization: Bearer {token}`。建立交易 `POST /checkout`。Webhook 在 CRM 後台設定，失敗重試三次（2/4/6 秒）。**仍未知：webhook 的來源驗證方式**——文件未載明是否有簽章標頭，確認前不可信任 webhook 內容 |
| 其他 | 規格未知。若同屬 CheckMacValue 家族 → 加一組 `ENDPOINTS` 即可；若是完全不同的 API（例如 JSON + HMAC header），要新寫一個 adapter，但只會動到 `payment.js` 與 `api/pay/notify.js` 兩個檔，前端與 D1 結構不受影響 |

## 2.7a OEN 串接的三個環境決定（2026-08-20，依站長的 CF 專案實況）

1. **CRM 的「交易資料回傳位置」直接填正式網址** `https://pickmycard.app/api/pay/notify`，
   一次填好、不再改。測試期它會 404（付費牆分支還沒合併）→ OEN 重試三次後放棄，無害；
   我們的測試流程**不依賴 webhook**（見下條）。上線合併後同一個網址自動生效。
2. **webhook 只當通知鈴，不當事實來源**：站長的 CF 專案對 preview 部署開了
   Cloudflare Access（要登入才看得到）→ OEN 的 server 對 server webhook 打 preview
   一定被擋。與其去改 Access 政策，不如順著本來就更安全的設計——付款導回後
   前端輪詢 `/api/order-status`，由後端拿自己的 token 呼叫 OEN 查詢 API 覆核。
   webhook 收不到，流程照樣走得通。因此 `/api/pay/inspect` 在 OEN 串接中**不再需要**。
3. **preview 部署用 Deploy Hook 觸發**（站長已關自動 preview）：CF 後台
   Settings → Deploy Hooks → 建一個指向付費牆分支的 hook，要部署時對該 URL 發 POST。
   注意 hook URL 等同「任何人可觸發 build」的鑰匙，不進 git、不貼公開處。
   本開發環境連不到 api.cloudflare.com（egress 擋），觸發要在站長自己的終端機執行。

## 2.7 串接新金流商：先抓真實樣本，不要猜驗章

新金流商（如 OEN 應援科技）的回呼格式與驗證機制若沒有可靠文件，**不要憑推測寫驗章邏輯**。
猜錯只有兩種結果：全部擋掉（不能用），或放寬驗證——後者等於任何人都能 POST 一筆
偽造的「已付款」通知白拿權益，是真的資安漏洞。

正確流程：

1. CF Pages 設 `PMC_PAY_INSPECT=1`（**只在 Preview 環境**），部署分支
2. 金流商後台的「交易資料回傳網址」先填 `https://<preview 網址>/api/pay/inspect`
3. 跑一筆測試交易 → 到 Cloudflare Pages → Deployment → Real-time Logs
   看 `[pay-inspect]` 那筆 JSON，裡面有對方實際送出的 method、headers、原始 body
4. 依真實樣本寫 `payment.js` 的驗章與 `pay/notify.js` 的解析
5. 回傳網址改指 `/api/pay/notify`，**移除 `PMC_PAY_INSPECT`**

`/api/pay/inspect` 預設 404（要顯式設 `PMC_PAY_INSPECT=1` 才啟用），永遠不碰 D1、
不開通任何權益——它只是一台錄音機。標頭原樣記錄（驗證機制常藏在標頭裡），
所以只在測試環境用。

⚠️ Cloudflare Pages 的 **Preview 與 Production 是兩組獨立的環境變數與 D1 綁定**。
在 Production 設好不代表 Preview 有——preview 部署上 API 回 500 時，先查這個。

## 3. 上線前要做的事（人工，程式碼幫不了）

1. **綠界特店**：申請後把 MerchantID / HashKey / HashIV 填進 CF 環境變數，並在綠界後台**開通 Apple Pay**、設定網域驗證
2. **D1**：`wrangler d1 create pick-my-card` → `wrangler d1 execute pick-my-card --remote --file=tools/paywall/schema.sql` → CF Pages → Settings → Functions → D1 bindings 綁成 `DB`
3. **環境變數**（CF Pages → Settings → Environment variables，金鑰記得選 Secret）：

   | 變數 | 值 | 說明 |
   |---|---|---|
   | `PMC_PAY_PROVIDER` | `ecpay` / `opay` | 沒設＝ecpay。綠界與歐付寶同源、規格同家族，共用 `functions/_lib/payment.js` |
   | `PMC_PAY_ENV` | `stage` / `prod` | 沒設＝stage。**prod 缺任何一把金鑰會直接報錯**，不會靜默退回測試帳號 |
   | `PMC_PAY_MERCHANT_ID` | 特店代號 | 只有「ecpay + stage」會退回綠界公開測試帳號；歐付寶一律要自己填 |
   | `PMC_PAY_HASH_KEY` | 🔒 Secret | 同上 |
   | `PMC_PAY_HASH_IV` | 🔒 Secret | 同上 |
   | `PMC_PAY_CHECKOUT_URL` | （通常不用設） | **端點逃生門**：金流商換網址、或實際規格與 `ENDPOINTS` 的推測不符時，設這個就能覆蓋，不必改程式碼 |
   | `PMC_PAY_QUERY_URL` | （通常不用設） | 同上，對帳查詢用 |
   | `PMC_SITE_ORIGIN` | `https://pickmycard.app` | ReturnURL 的來源。不設會用當次請求的 origin（preview 部署因此可自行測試） |
   | `PMC_PAY_CHOOSE_PAYMENT` | `Credit` | Apple Pay 在金流商後台開通後會出現在信用卡頁 |
   | `PMC_ADFREE_PRICE` | `100` | |
   | `PMC_FIREBASE_PROJECT_ID` | `pick-my-card-28f2a` | 驗 ID token 的 aud |

4. **發票**：綠界電子發票要另外申請，涉及你的稅務身分，本專案沒有整合
5. **端到端實測**（環境限制：本 session 的網路政策擋掉 `ecpay.com.tw`，這步只能由你在真實部署上跑）：
   用 stage 設定部署 preview → 登入 → 購買 → 用綠界測試卡號 `4311-9522-2222-2222`（有效期填未來、安全碼任意、3D 驗證碼 `1234`）付款 → 確認導回後廣告消失 → 到 D1 檢查 `orders.status='paid'` 且 `entitlements` 有那筆 uid

## 4. 對帳與客訴

```bash
# 某人說付了錢沒開通
wrangler d1 execute pick-my-card --remote --command \
  "SELECT trade_no, status, amount, created_at, rtn_msg FROM orders WHERE email='xxx@example.com' ORDER BY created_at DESC"

# 手動補開通（確認綠界後台真的收到錢之後才做）
wrangler d1 execute pick-my-card --remote --command \
  "INSERT OR IGNORE INTO entitlements (uid, product, granted_at, trade_no, source) VALUES ('<uid>','adfree',$(date +%s000),'<訂單編號>','manual')"
```

`orders.raw` 存了綠界回呼的原始內容，是爭議時的證據。

## 5. 改這塊之前要知道的

- 改 `functions/_lib/ecpay.js` 的編碼邏輯 → **一定要跑 `node tools/paywall/mac-selftest.mjs`**。CheckMacValue 的 bug 幾乎全出在 URL encode 那一步，症狀是綠界回 `10200073 CheckMacValue Error`
- 改廣告閘門或 `js/paywall.js` → 跑 `tools/paywall/adfree-smoke.mjs`（需先起 `python3 -m http.server 8000`）
- `<head>` 的閘門在 `index.html` 與 `faq.html` **各有一份、內容必須一致**；`merchant/*.html` 由 `tools/build-merchant-pages.js` 從 index.html 生成，改完記得重新生成
- 綠界 CheckMacValue 用的是 **.NET `HttpUtility.UrlEncode` 語意**（安全字元只有 `A-Za-z0-9-_.!*()`、空白→`+`、`~`→`%7e`、`'`→`%27`），跟 JS 的 `encodeURIComponent` 有三處差異，全部在 `dotNetUrlEncode()` 補齊。**整串字串（含 `=` 與 `&` 分隔符）一起編碼**，所以分隔符會變成 `%3d`/`%26`——這是最多人踩錯的一點

## 教訓記錄

- **2026-08-19｜不要靠記憶寫金流的黃金值**：寫 CheckMacValue 的自我測試時，我憑記憶寫下綠界文件範例的預期字串，把分隔符寫成未編碼的 `=`/`&`，測試因此紅燈。查證後確認綠界是「整串一起 URL encode」，分隔符會變 `%3d`/`%26`——是我的預期值錯、實作對。教訓：金流這種對錯只有二元結果的地方，黃金值要嘛查官方文件、要嘛用另一個獨立實作（這裡用 Python 的 `urllib.parse.quote_plus`）算出來，不能拿自己的實作當對照組，也不能靠記憶。
- **2026-08-19｜煙霧測試紅燈先懷疑測試環境，不要急著改產品碼**：首次跑 `adfree-smoke.mjs` 時 `index.html` 量到「沒有廣告位、沒有 modal」，看起來像頁面壞了。實際是 index.html 會把 `localStorage.length === 0` 的首訪者 `location.replace` 到 landing.html，而付費情境因為寫了旗標所以不會被導走——量到的根本是兩個不同頁面。已在測試裡加上「停在受測頁」的斷言，讓這種情況直接顯示成路徑不符而不是功能異常。
