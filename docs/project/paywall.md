# 去廣告付費牆（NT$100 一次買斷）

一句話：**登入 → 綠界付款 → 綠界通知後端 → 後端寫權益 → 前端不載入 AdSense loader。**

- 前端：`js/paywall.js`（順序 13）＋ `index.html`/`faq.html` 的 `<head>` 廣告閘門
- 後端：`functions/`（Cloudflare Pages Functions，與靜態站同一個 CF Pages 專案）
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

## 3. 上線前要做的事（人工，程式碼幫不了）

1. **綠界特店**：申請後把 MerchantID / HashKey / HashIV 填進 CF 環境變數，並在綠界後台**開通 Apple Pay**、設定網域驗證
2. **D1**：`wrangler d1 create pick-my-card` → `wrangler d1 execute pick-my-card --remote --file=tools/paywall/schema.sql` → CF Pages → Settings → Functions → D1 bindings 綁成 `DB`
3. **環境變數**（CF Pages → Settings → Environment variables，金鑰記得選 Secret）：

   | 變數 | 值 | 說明 |
   |---|---|---|
   | `PMC_ECPAY_ENV` | `stage` / `prod` | 沒設＝stage。**prod 缺任何一把金鑰會直接報錯**，不會靜默退回測試帳號 |
   | `PMC_ECPAY_MERCHANT_ID` | 你的特店代號 | stage 不設會用綠界公開測試帳號 |
   | `PMC_ECPAY_HASH_KEY` | 🔒 Secret | 同上 |
   | `PMC_ECPAY_HASH_IV` | 🔒 Secret | 同上 |
   | `PMC_SITE_ORIGIN` | `https://pickmycard.app` | ReturnURL 的來源。不設會用當次請求的 origin（preview 部署因此可自行測試） |
   | `PMC_ECPAY_CHOOSE_PAYMENT` | `Credit` | Apple Pay 在綠界後台開通後會出現在信用卡頁。若綠界確認 `ApplePay` 可當獨立值，改這裡即可 |
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
