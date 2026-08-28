# 去廣告付費牆（NT$100 一次買斷）

一句話：**登入 → 綠界付款 → 綠界通知後端 → 後端寫權益 → 前端不載入 AdSense loader。**

- 前端：`js/paywall.js`（順序 13）＋ `index.html`/`faq.html` 的 `<head>` 廣告閘門
- 後端：`functions/`（Cloudflare Pages Functions，與靜態站同一個 CF Pages 專案）；金流商可切換，見 2.9
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

## 2.1 ⚠️ `functions/` 這個目錄名屬於 Cloudflare，不可與 Firebase 共用


2026-08-23 合併 main 時發現：另一個 session 把 Firebase Cloud Functions
（意見回饋通知）也放進了 `functions/`，與付費牆的 Cloudflare Pages Functions 同居。
**兩套建置流程會互相踩到**：

- Firebase `deploy --only functions` 會把整個來源目錄上傳，連 Cloudflare 的檔案
  一起打包；而 `functions/package.json` 宣告 `"type": "commonjs"`，
  付費牆的檔案卻是 ESM
- Cloudflare Pages 會把 `functions/` 底下的每個檔案當成路由候選，
  `index.js` 卻是 Firebase 進入點，`require` 的 firebase-admin／nodemailer
  在 Workers 執行環境根本不存在

**Cloudflare 的目錄名寫死在平台約定裡、不可改；Firebase 的可以在 `firebase.json`
指定**，所以 Firebase 搬到 `firebase-functions/`。

| 目錄 | 屬於 | 部署方式 |
|---|---|---|
| `functions/` | Cloudflare Pages Functions（付費牆 API） | 隨 CF Pages 部署 |
| `firebase-functions/` | Firebase Cloud Functions（回饋通知） | `firebase deploy --only functions` |

**不要把任何 Firebase 檔案放回 `functions/`。**

搬家時連帶要改的第三個地方（由建立 Cloud Functions 的那個 session 提醒才補上）：
根目錄 `.gitignore` 全域忽略 `package.json`，靠一條 `!<目錄>/package.json` 例外
放行 Cloud Functions 的那一份。**改目錄名時這條例外必須跟著改**——因為
`git mv` 會保留追蹤狀態，改名當下一切正常，要等到有人把它移出索引再加回
（或在乾淨的 clone 重新產生）才會突然消失，屆時 `firebase deploy` 會因為
少了 `package.json` 而失敗。驗證方式：刪檔再 `git add`，加得回去才算對。

### 2.1.1 main 上的殘留：CF 建置會報紅字但不會壞（2026-08-24 實測）

搬家的改動還在功能分支上，`origin/main` 仍留著 Firebase 版的 `functions/`。
Production 的建置 log 因此出現：

```
Found Functions directory at /functions. Uploading.
✘ [ERROR] No routes found when building Functions directory
Warning: Wrangler did not find routes when building functions. Skipping.
```

**是空包彈**：那些檔案沒有 `onRequest*` 匯出 → 產不出路由 → Wrangler 跳過，
部署照樣 success，站台正常。功能分支 merge 後這行就會消失。

順帶確認了兩件對 merge 有利的事：CF 的 root directory 策略是 v2、
`functions/` 偵測路徑正確——我們真正的 Pages Functions merge 後會被抓到。

## 2.2 OEN 流程（已實作，2026-08-20）


```
前端點「前往付款」→ POST /api/checkout（帶 Firebase ID token）
  → 後端建訂單（綁 uid）→ POST payment-api/checkout（Bearer token）
  → 存 data.id（provider_txn_id）→ 回 redirectUrl
  → 瀏覽器整頁跳轉 https://pick-my-card[.testing].oen.tw/checkout/{id}
付款完成 → OEN 轉址回 /api/pay/return（成功帶 r=ok，失敗帶 payment_error）
        → 303 到 /?pmc_pay=… → 前端輪詢 /api/entitlement
同時    → OEN webhook POST /api/pay/notify（JSON）
```

**安全模型**：OEN 的 webhook 沒有簽章 → 一律當「鈴聲」。收到後拿**訂單上存的**
provider_txn_id（不是 webhook 給的 id）反查 `GET /transactions/{id}`，
狀態 charged/claimed ＋金額相符＋OEN 記錄的 orderId 就是這筆訂單，三關都過才開通。
偽造 webhook、借用他人交易 ID、金額不符、purpose=token 都拿不到權益——
這些情境在 `tools/paywall/oen-selftest.mjs` 有假 D1＋假 OEN API 的自動化證明（17 項）。

**付款方式刻意只開信用卡**（不帶 allowedPaymentMethods＝OEN 預設）：超商/ATM 是
非即時付款，會破壞「付款完成立即生效」的前提與現有輪詢/條款文案。要開放時
除了帶參數，還得先處理繳費代碼顯示、pending 數天的訂單、與條款措辭。

改了 OEN 相關邏輯 → 跑 `node tools/paywall/oen-selftest.mjs`（改動前先確認綠燈）。

## 2.25 隨喜加碼「加碼支持！」（2026-08-25）

底價之外可自願加碼，按 `+25` / `+50` 累加，按幾次都可以，設有上限。
應援不需要知道加碼這件事——**我方算完總額再呼叫他們**（業務原話：
「按鈕隨喜這段程式要由您那端計算完畢後再呼叫應援」）。

| 檔案 | 角色 |
|---|---|
| `functions/_lib/payment.js` → `resolveAdfreePricing` / `resolveChargeAmount` | 定價與**金額驗證**（唯一守門員） |
| `functions/api/pricing.js` | `GET /api/pricing`（公開，不需登入）→ `{base, max, steps}` |
| `functions/api/checkout.js` | 讀 body 的 `tip`，總額由 `resolveChargeAmount` 算 |
| `js/paywall.js` → `renderAdfreeTip` / `fetchAdfreePricing` | 前端狀態與畫面 |

### 下限是怎麼成立的（被問過，值得寫清楚）

**前端沒有辦法表達「總額」**——它只能送 `tip`，總額永遠是後端 `base + tip`，
而 `base` 來自環境變數、前端碰不到。所以「不得低於底價」是**結構上的必然**，
不是靠某一行檢查。`{"tip": -99}` 會在型別檢查那關就被 400 擋掉。

即使如此還是補了兩道明寫的防線，因為上面那個保證是「推導」出來的：
- `resolveChargeAmount` 末尾明寫 `amount < base` 即拒絕。今天多餘，但哪天有人
  把介面改成直接收 `amount`，下限會**無聲消失**——這行讓那種改法在測試裡當場失敗。
- `resolveAdfreePricing` 夾住 `PMC_ADFREE_PRICE`：誤設成負數、0、亂碼一律退回 100。
  這不是攻擊路徑（只有站長改得動），但後果跟被攻擊一樣。

測試用窮舉 `tip = -500…500` 釘死「沒有任何一個值能讓收費低於底價」。

⚠️ **這個功能唯一的資安要點：金額不能信前端。**
前端只送 `tip`，總額一律由後端用自己的底價算。`resolveChargeAmount()` 會擋掉
負數、小數、非級距倍數、超過上限——**沒有這道驗證，任何人都能直接
`POST {"tip": -99}` 用一塊錢買走權益**。前端把按鈕 disabled 只是體驗，不是防線。

⚠️ **定價只有一個來源**：底價會隨 `PMC_ADFREE_PRICE` 變動（測試環境調高過），
所以前端一律以 `GET /api/pricing` 為準。前端那份 `ADFREE_PRICING_FALLBACK`
只在 API 拿不到時保底顯示，**不是真實來源**——若在前端另寫死一份數字，
用戶看到的金額會跟實際扣款不一致，加了加碼之後這種不一致等於多扣錢。

其他刻意的行為：
- **關掉 modal 再開，加碼歸零**。留著上次的加碼會讓用戶在不知情下付更多。
- **按超過上限不報錯，直接停在上限**，同時把加碼按鈕停用（比彈錯誤訊息友善）。
- **付款按鈕永遠寫著總額**（「前往付款 NT$175」），按下去之前就知道要付多少。
- 加碼金額會寫進送給金流商的品項名稱（`去廣告權益（一次買斷）＋加碼支持 NT$75`），
  對帳時看得出來。
- 購買條款加了一段：加碼純屬自願、**不影響權益內容**、屬同一筆數位內容價金。

新增環境變數 `PMC_ADFREE_MAX`（預設 1000）。測試涵蓋在
`oen-selftest.mjs`（金額驗證 22 項）與 `ui-flow-test.mjs`（UI 流程 16 項）。

## 2.3 帳號刪除與付費資料（2026-08-21）


main 的「刪除帳號與全部資料」流程（`deleteAccountAndAllData`）會在刪除
Firebase 帳號**之前**呼叫 `POST /api/account/purge`。時機是關鍵：帳號一旦刪除
就拿不到能證明身分的 ID token。該呼叫失敗會中止整個刪除流程——寧可讓用戶重試，
也不要留下刪不乾淨的個資。

兩種資料、兩種處置：

| 資料 | 處置 | 理由 |
|---|---|---|
| `entitlements` | **刪除** | 純粹是「這個 uid 有權益」的個人資料 |
| `orders` | **去識別化**：清空 `email`、`raw`，記下 `deleted_at`；保留訂單編號、金額、時間、金流商交易編號 | 交易憑證涉及對帳與退款爭議不能刪；Firebase 帳號刪除後 uid 不再對應任何人，等同匿名代號，卻仍能與金流商後台的紀錄對起來 |

**全自動，站長不需要手動刪任何東西。** 刪除帳號 modal 會對已購買者多顯示一條
警告：權益一併消失、不予退款、重新註冊無法復原（未購買者不會看到這條）。

## 2.4 付款異常的自動通報（兩種情境）


| 情境 | 觸發點 | 用戶看到 | 管理員收到 |
|---|---|---|---|
| **明確失敗**（金流商回 `payment_error`） | `handlePaymentReturn` | 「付款失敗，已通知管理員…請稍後再嘗試！未向你收取任何費用。」**不給「重新查詢訂單」** | 含 OEN 錯誤代碼與中文說明（如 `T0004（額度不足）`） |
| **確認不到**（可能已扣款但查不到） | `recheckOrder()` 查無成功紀錄 | 「已通知管理員，請明天再確認一次」 | 訂單編號＋「請至後台比對是否已扣款」 |

明確失敗刻意**不提供「重新查詢訂單」**：那條路徑會先回答「你已經有權益了」
（若該帳號本來就買過），讓剛失敗的用戶誤以為付款成功。

兩種都寫進既有的 `feedback` 集合（含 uid、email）。刻意重用問題回報的管道而不是
另做一套通知：管理員本來就會看那份清單。送不出去時不會謊稱已通知，改回自助文案。

⚠️ 「重新查詢訂單」在**已有權益的帳號**上一律回「已確認付款」——這是正確行為
（`/api/order-status` 第一件事就是檢查權益），不是 bug。要乾淨地測失敗流程，
得先在 D1 刪掉該 uid 的 entitlements 列。

## 2.5 ⚠️ webhook 在 preview 上收不到（測試期的重要事實，2026-08-21）


站長的 CF 專案對 preview 部署開了 Cloudflare Access（要登入才進得去），而 CRM 的
webhook 位置填的是正式站 `pickmycard.app/api/pay/notify`（尚未部署付費牆 → 404）。
**兩條路都不通，所以測試期的 webhook 從來沒有真正送達過。**

後果與應對：

- **測試期所有的開通，全部來自「主動對帳」那條路**（`/api/order-status` 拿自己的
  token 問 OEN），webhook handler 只有 `oen-selftest.mjs` 的假資料測過。
  上線後 webhook 會是主要路徑，**上線後要實測一次**。
- **付款成功但訂單留在 `pending`**：webhook 沒到就不會有人把 `orders.status`
  翻成 `paid`。因此測試時只刪 `entitlements` 是不夠的——舊的 pending 訂單
  仍會被「重新查詢訂單」找到、向 OEN 確認為已付款、於是重新開通。
  **乾淨重測要連訂單一起清**：

  ```sql
  -- 測試期最省事：整張清空（⚠️ 上線後絕對不可以這樣做）
  DELETE FROM entitlements;
  DELETE FROM orders;

  -- 只想清某個帳號時，先查 uid：
  --   SELECT uid, email FROM orders ORDER BY created_at DESC;
  --   SELECT uid, source, granted_at FROM entitlements;
  -- DELETE FROM entitlements WHERE uid = '<uid>';
  -- DELETE FROM orders       WHERE uid = '<uid>';
  ```

  清完後瀏覽器可能還留著 `pmc_adfree` 本機旗標（最長 7 天），會讓你以為還是已購買。
  重新整理後 `refreshAdfreeEntitlement()` 會向後端核對並自動清掉；想立刻歸零就到
  DevTools → Application → Local Storage 刪掉 `pmc_adfree`。

- **不建議為了測 webhook 而放行 preview**：帳號層的 deny-by-default 只能
  「整個網域豁免」，而本站 `robots.txt` 是 `Allow: /`——preview 一旦公開就可能
  被索引，造成與正式站重複內容的 SEO 傷害。付出的代價和拿到的資訊不成比例。

- **改用零成本的驗證方式**：`entitlements.source` 會記錄開通是哪條路徑來的
  （`oen-notify` ＝ webhook 有送達、`oen-query` ＝ 靠主動對帳補的）。上線後
  自己買一筆，然後查：

  ```sql
  SELECT uid, source, granted_at FROM entitlements ORDER BY granted_at DESC LIMIT 5;
  ```

  `source='oen-notify'` 就代表 webhook 在正式站運作正常。就算是 `oen-query`
  也不影響用戶（權益照樣開通），只是慢一兩秒——所以這件事可以放心留到上線後驗。

**設計上這不是災難**：webhook 只是「快一點」的路徑，事實來源一直是主動對帳。
付款導回後前端第一件事就是打 `/api/order-status` 主動對帳（2026-08-21 起），
webhook 完全不通也能在 1~2 秒內開通。

## 2.6 ⚠️ 付款導回是「整頁重載」——動 API 之前要等登入狀態還原


`handlePaymentReturn()` 在 DOMContentLoaded 就執行，但那一刻
`firebaseAuth.currentUser` 幾乎一定還是 `null`（Firebase 要先跟伺服器換過 token）。
任何在那個空窗裡呼叫 `callPaywallApi()` 或 `notifyAdminPaymentIssue()` 的程式碼
都會靜默失敗。

**動手前一律先 `await waitForAuthUser()`。**

這個坑實際咬過一次（2026-08-23）：付款失敗的通報只呼叫一次、又沒等，
於是永遠通知不到管理員，畫面還顯示「請稍後再試」的備用文案，看起來像功能沒做。
成功路徑當時沒被發現，純粹是因為它會輪詢六次、拖過空窗自己補救——
**「有重試所以看起來沒事」不等於沒有 bug**。

## 2.7 成本結構


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

## 2.8 OEN 手續費（實測資料，2026-08-23）


測試交易的 `raw` 回應含 `fee` 欄位：**金額 50 → fee 2**（4%）。單筆樣本、
且是測試環境，不足以推定費率結構（可能是百分比、可能有最低收費）。
**上線前請向業務確認實際費率**——若為 4%，NT$100 的單筆成本是 4 元，
比先前依綠界估的 2.75 元高。這會影響定價是否划算的判斷。

## 2.9 金流商的選擇與切換


台灣多數金流商（綠界、藍新）的特店申請對**持永久居留證的外國人**不一定開放，這是選型的實際限制，不是技術問題。

程式碼對此的準備：`functions/_lib/payment.js` 把端點抽成 `ENDPOINTS[provider][mode]`，並提供 `PMC_PAY_CHECKOUT_URL` / `PMC_PAY_QUERY_URL` 兩個覆寫變數。

| 金流商 | 狀態 |
|---|---|
| 綠界 ECPay | 已實作，CheckMacValue 演算法有自我測試 |
| 歐付寶 O'Pay | 端點已備妥，但**網址是依同一命名慣例推得、尚未實測**。帳號下來後先跑 `mac-selftest.mjs`，再送一筆測試訂單確認不是回 CheckMacValue Error；若網址不同，設 `PMC_PAY_CHECKOUT_URL` 覆蓋即可 |
| OEN 應援科技（全跳轉） | **已選定**。API base：正式 `https://payment-api.oen.tw`／測試 `https://payment-api.testing.oen.tw`；結帳頁是另一個網域 `https://{merchantId}.oen.tw/checkout/{id}`（別混用）。`merchantId` = `pick-my-card`。認證用 `Authorization: Bearer {token}`。建立交易 `POST /checkout`。Webhook 在 CRM 後台設定，失敗重試三次（2/4/6 秒）。**仍未知：webhook 的來源驗證方式**——文件未載明是否有簽章標頭，確認前不可信任 webhook 內容 |
| 其他 | 規格未知。若同屬 CheckMacValue 家族 → 加一組 `ENDPOINTS` 即可；若是完全不同的 API（例如 JSON + HMAC header），要新寫一個 adapter，但只會動到 `payment.js` 與 `api/pay/notify.js` 兩個檔，前端與 D1 結構不受影響 |

## 2.10 串接新金流商：先抓真實樣本，不要猜驗章


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

## 2.11 OEN 串接的三個環境決定（2026-08-20，依站長的 CF 專案實況）


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

## 2.12 上線策略：分支等到 OEN 正式環境就緒再一次 merge（站長決定，2026-08-21）


付費牆的程式碼**刻意不先進 main**。理由：merge 就等於上正式站，而 OEN 正式
環境尚未就緒（IP 白名單未解，見 3.5），正式站會出現一顆點下去必然報錯的
「移除廣告」按鈕。站長已在「加總開關先 merge」與「分支繼續等」之間選擇後者。

**代價是分支漂移**，而且已經發生過一次：2026-08-21 這個分支落後 main 22 個
commit，導致 preview 看不到 main 已上線的「刪除帳號」功能，並在合併時產生
index.html 1 段、styles.css 7 段衝突。

**因此每次開工的第一件事**（不是選填）：

```bash
git fetch origin main && git rev-list --count HEAD..origin/main
# 不是 0 就先 merge origin/main 再開始改，不要累積
```

衝突解法見 `docs/ops/judgment.md` 2026-07-21 的教訓：逐段處理，禁止整檔
`--ours`/`--theirs`；`merchant/*.html` 是生成檔，直接重跑生成器並以 `--check` 驗證。

## 2.13 測試環境的端到端驗收狀態（2026-08-23）


| 情境 | 結果 |
|---|---|
| 成功付款（`4242 4242 4242 4242`、150 元） | ✅ 開通、廣告消失、`raw` 顯示 `status=charged` |
| 3D 驗證（`PMC_PAY_USE3D=1`） | ✅ 生效，`raw` 顯示 `use3d=true` |
| **失敗付款**（`4012 8888 1888 8333`） | ✅ 紅色 ✕ 畫面、**訂單留在 `pending` 未誤開通**、自動通報管理員成功，OEN 回報 `T0001（交易失敗）` |
| 付款導回後的自我修復 | ✅ 主動對帳 1~2 秒內開通，不依賴 webhook |
| 帳號刪除連帶清除權益 | ✅ |
| 去廣告實際生效（請求數為 0） | ✅ 自動化測試涵蓋三種頁面 |

**唯一未在真實環境驗過的是 webhook 送達**（preview 收不到，見 2.5），
上線後用 `SELECT source FROM entitlements` 確認即可。

## 3. 上線前要做的事（人工，程式碼幫不了）


1. **綠界特店**：申請後把 MerchantID / HashKey / HashIV 填進 CF 環境變數，並在綠界後台**開通 Apple Pay**、設定網域驗證
2. **D1**：`wrangler d1 create pick-my-card` → `wrangler d1 execute pick-my-card --remote --file=tools/paywall/schema.sql` → CF Pages → Settings → Functions → D1 bindings 綁成 `DB`
3. **環境變數**（CF Pages → Settings → Environment variables，金鑰記得選 Secret）：

   | 變數 | 值 | 說明 |
   |---|---|---|
   | `PMC_PAY_PROVIDER` | `ecpay` / `opay` / `oen` | 沒設＝ecpay。**用 OEN 必須設 `oen`**，否則 checkout 會走綠界測試流程 |
   | `PMC_PAY_ENV` | `stage` / `prod` | 沒設＝stage。**prod 缺任何一把金鑰會直接報錯**，不會靜默退回測試帳號 |
   | `PMC_PAY_MERCHANT_ID` | 特店代號 | 只有「ecpay + stage」會退回綠界公開測試帳號；歐付寶一律要自己填 |
   | `PMC_PAY_HASH_KEY` | 🔒 Secret | 同上 |
   | `PMC_PAY_HASH_IV` | 🔒 Secret | 同上 |
   | `PMC_PAY_CHECKOUT_URL` | （通常不用設） | **端點逃生門**：金流商換網址、或實際規格與 `ENDPOINTS` 的推測不符時，設這個就能覆蓋，不必改程式碼 |
   | `PMC_PAY_QUERY_URL` | （通常不用設） | 同上，對帳查詢用 |
   | `PMC_SITE_ORIGIN` | `https://pickmycard.app` | ReturnURL 的來源。不設會用當次請求的 origin（preview 部署因此可自行測試） |
   | `PMC_PAY_CHOOSE_PAYMENT` | `Credit` | Apple Pay 在金流商後台開通後會出現在信用卡頁 |
   | `PMC_PAY_TOKEN` | 🔒 Secret | OEN 專用。CRM 後台產製，只顯示一次、重產即覆蓋 |
   | `PMC_PAY_USE3D` | `1` 開啟 | OEN 信用卡 3D 驗證，預設關（同 OEN 預設）。開啟可轉移盜刷爭議責任 |
   | `PMC_PAY_PAGE_BASE` | （通常不用設） | OEN 結帳頁 base 覆寫（預設依 merchantId＋環境推得） |
   | `PMC_ADFREE_MAX` | `1000` | 隨喜加碼後的總額上限（見 2.25）。不設＝1000 |
   | `PMC_ADFREE_PRICE` | `100` | ⚠️ OEN 測試環境要求金額 >100（見 3.4），正式定價 100 剛好在邊界上——**Preview 要設 150**，Production 不設此變數 |
   | `PMC_FIREBASE_PROJECT_ID` | `pick-my-card-28f2a` | 驗 ID token 的 aud |
   | `PMC_HEALTHCHECK_TOKEN` | 🔒 Secret | 白名單健檢端點的通行碼（見 3.55）。**沒設＝該端點整支停用**，不留後門 |
   | `PMC_HEALTHCHECK_TXN_ID` | （選用） | 一筆真實舊交易 id，設了健檢判準會更嚴（要求 `code=S0000`） |

3.4 **OEN 測試卡號（2026-08-23 定案，以官方「注意事項」為準）**

   | 卡號 | 用途 |
   |---|---|
   | `4242 4242 4242 4242` | 一般成功 |
   | `4012 8888 1888 8333` | **觸發失敗情境** |
   | `4000 0000 0000 2503` | 觸發 3D 驗證 |
   | `5200 0000 0000 2151` | 觸發 3D 驗證（Master） |

   金額：成功情境 >100（Preview 用 `PMC_ADFREE_PRICE=150`）。

   ⚠️ **踩過的坑**：業務另一份「第三階段」文件把 `4242 0000 4242 0000` 標為
   「Visa 失敗測試卡號」，實測用它（金額 150 與 50 各試過）交易一律
   `status=charged`、有授權碼、`fee` 照收——那張根本不是失敗卡。
   `4000 0000 0000 2503` 也不是失敗卡，它是**3D 驗證觸發卡**，所以刷了也會成功。
   **兩份文件衝突時以「注意事項」那份為準**，它的卡號清單較完整且與實測相符。

   另外，「金額 <100 觸發失敗」實測**無效**。最乾淨的反證（2026-08-24 補測）是
   **一般成功卡 `4242 4242 4242 4242` ＋ `PMC_ADFREE_PRICE=50`（送出的 `amount` 就是 50）
   → 仍然 `charged`、廣告正常移除**；卡號這個變因也排除了。
   實測矩陣：`4242 0000 4242 0000`/150→charged、同卡/50→charged、
   `4242 4242 4242 4242`/50→charged、`4012 8888 1888 8333`/150→failed(T0001)。
   **成敗只由卡號決定。**

3.42 **判斷「是我方誤判成功，還是 OEN 真的收款了」** —— 決定性證據在自己的資料庫

   開通的唯一條件是 OEN 的 `GET /transactions/{id}` 回報 `status` 為
   `charged`／`claimed`（見 `oenVerifyCharged`），而**那次查詢的完整回應會原封
   不動存進 `orders.raw`**。所以不需要任何額外工具就能定案：

   ```sql
   SELECT trade_no, status, amount, provider_txn_id, rtn_msg, raw
   FROM orders ORDER BY created_at DESC LIMIT 5;
   ```

   看 `raw` 裡的 `"status"`：
   - `"charged"` → **OEN 真的收款了**，我方判斷正確，問題在 OEN 的測試環境
     （用失敗卡號／低金額仍然扣款成功）→ 這題只能問業務
   - 其他值卻仍開通 → 那才是我方的 bug，立刻回報

   `orders.status` 仍是 `pending` 但用戶已開通，是 webhook 沒送達的正常現象（見 2.5）。

3.45 **OEN 官方 MCP server（選用，非必要）**：業務另提供
   `oen-payment-mcp-server`，可在本機的 Claude Desktop／Claude Code 裡以對話方式
   呼叫 OEN API（建單、查交易、讀 API 文件…）。

   **本專案的串接不需要它**——`functions/_lib/payment.js` 已直接串接 REST API 並
   實測成功。它的價值在於「臨時查一筆交易」或「用 `readDocs` 撈官方文件原文」，
   要在**站長自己的機器**上跑（本開發容器的 egress 政策擋掉 oen.tw，裝不了）。
   官方註明它屬開發測試階段、不可用於 Production，也不會再更新。

3.5 **OEN 正式環境的 IP 白名單（2026-08-24 應援已同意接受 Cloudflare 區段）**：
   正式環境要設來源 IP 白名單，但我們的後端是 Cloudflare Pages Functions，
   **出口 IP 不固定**（走 Cloudflare 共用 IP 池，實務上落在 `172.64.0.0/13`）。
   測試環境不受此限。應援回覆**可接受 Cloudflare 官方公布的 outbound IP 區段**，
   但提出顧慮：他們無從得知 Cloudflare 何時變更區段，若變更會導致我方被擋。

   **風險評估**：
   - Cloudflare 的區段清單極少變動，且有機器可讀來源可訂閱：
     `https://api.cloudflare.com/client/v4/ips`（免驗證、回傳帶 `etag`）、
     `https://www.cloudflare.com/ips-v4` / `ips-v6`。變更會事先公告。
   - ⚠️ 但要誠實記著：那份清單官方定位是「Cloudflare 反向代理的 IP」，
     Cloudflare **沒有正式保證** Workers/Pages Functions 的 `fetch` 出口
     永遠落在該清單內。這是本方案的殘餘不確定性。
   - **真的被擋時的後果分兩種，不是同一件事**：
     | 被擋的呼叫 | 後果 | 嚴重度 |
     |---|---|---|
     | `POST /checkout` | 用戶連付款頁都開不了，**沒有扣款** | 可用性受損，不涉及金錢 |
     | `GET /transactions/{id}` | 用戶**已扣款但權益開不了**（我們刻意不信任 webhook，一律回查） | 這才是痛點 |
     後者已有既有安全網（見 2.4）：訂單留在 D1、自動通報管理員、事後可手動開通或退款，
     不會出現「收了錢查無此人」的黑洞——但用戶體驗仍然很差，所以要靠監控在用戶之前發現。

   **決定的作法（站長 2026-08-24 拍板）**：接受 Cloudflare 區段、不買固定 IP，
   由**我方承擔監控與通知責任**（正面回應應援「無法追蹤變動」的顧慮）。
   已實作，見下面的 3.55。

   **固定 IP 的選項全部評估過，結論是不值得**（成本／可靠度都不划算）：

   | 方案 | 成本 | 為什麼不採用 |
   |---|---|---|
   | Cloudflare Dedicated CDN Egress IP（原 Aegis） | Enterprise，年約數千美金 | 方案門檻遠超本站規模 |
   | Cloudflare One／Gateway 專屬 egress IP（含 BYOIP） | Enterprise | 那是 Zero Trust 產品線，管的是**使用者裝置**流量，不是 Workers 的 `fetch` |
   | 自架 VPS 轉發層（Hetzner／Vultr／DO 最小方案） | 約 US$4.5–6/月 | 在金流路徑中間多一個單點故障，還要自己顧 TLS 與更新 |
   | Oracle Cloud Always Free VM | US$0 | ⚠️ 看似免費實則不能用：Oracle 對閒置實例有回收政策（7 天 CPU 95 百分位 <20%），一天轉幾筆付款的機器定義上就是閒置 |
   | 搬去 Firebase／GCP Cloud Functions（已有 Blaze） | 概估 US$10+/月 | GCP 的出口 IP 預設也是浮動的，要固定得另開 VPC + Cloud NAT，收費且複雜 |
   | 商用固定 IP proxy（QuotaGuard／Fixie 類） | US$20/月起 | 貴，且金流 token 要經過第三方 |

   花錢買到的只是「被擋的那幾小時也不中斷」，但代價是多一台機器夾在金流路徑中間，
   它自己掛掉的機率恐怕比 Cloudflare 改區段還高。真的發生一次再回頭評估也不遲。

## 3.55 白名單健檢（2026-08-24 實作）

   三個檔案構成，成本 US$0：

   | 檔案 | 角色 |
   |---|---|
   | `functions/api/pay/healthcheck.js` | `GET /api/pay/healthcheck`。**必須從 Cloudflare 這端執行**——從 GitHub Actions 直接打 OEN 驗不到白名單，來源 IP 不一樣 |
   | `tools/paywall/healthcheck-client.mjs` | 排程端。判斷 ok 與 etag，有問題就 exit 1 |
   | `.github/workflows/paywall-healthcheck.yml` | 每天 09:00（台北）跑一次；**job 失敗時 GitHub 寄的信就是通知管道**，沒有另接告警服務 |

   端點做兩件事：
   1. 用現行金流設定實際打一次 OEN 的 `GET /transactions/{id}`。判準是**連得到**，
      不是查得到交易——OEN 有回帶 `code` 的 JSON（哪怕是查無此交易）就算通過；
      連線層失敗或 401/403 才是被擋。設了 `PMC_HEALTHCHECK_TXN_ID`（一筆真實舊交易）
      判準會更嚴，要求 `code=S0000`。
   2. 抓 `https://api.cloudflare.com/client/v4/ips` 的 `etag`，交給排程端比對。

   基準值存在 `tools/paywall/cf-ips.etag`（初始內容 `BOOTSTRAP`，第一次跑會**故意失敗**
   並印出該填的值——這是刻意的，強迫完成這個一次性動作）。

   ⚠️ **etag 變動時的處理順序不可顛倒**：先寄新區段給應援更新白名單 → 確認生效
   → 才更新 `cf-ips.etag`。先改基準檔會讓警報消失，但白名單其實還沒更新。

   拿不到 Cloudflare 清單時只印警告、不算失敗——那是 Cloudflare 端的暫時性問題，
   與「我們被擋了」是兩回事，混在一起會製造假警報。

   需要的設定（缺任一，workflow 會**跳過**而不是失敗，所以上線前放著也不會吵）：
   - CF Pages（Production）：`PMC_HEALTHCHECK_TOKEN`（Secret，自己產一串隨機字）；
     選用 `PMC_HEALTHCHECK_TXN_ID`
   - GitHub → Settings → Secrets and variables → Actions：
     **Repository variable**（不是 Environment variable——workflow 沒有宣告 `environment:`，
     設成 Environment 層級的話 `vars` / `secrets` 讀不到）
     `PMC_HEALTHCHECK_URL`＝`https://pickmycard.app/api/pay/healthcheck`；
     **Repository secret** `PMC_HEALTHCHECK_TOKEN`（與 CF 那把相同）

   ⚠️ **workflow 要等檔案進到預設分支（main）才會出現在 Actions 頁**——`workflow_dispatch`
   的「Run workflow」按鈕與 `schedule` 都只認預設分支（GitHub 官方限制）。
   本 workflow 目前還在功能分支上，所以**merge 之前完全跑不了，Actions 頁也看不到它**，
   這是正常的，不是設定錯誤。健檢的第一次執行排在 merge 上線之後（見 3.7 清單）。

   ⚠️ GitHub 會在 repo 連續 60 天沒活動時自動停用排程 workflow，長期沒動要回來手動啟用。

   ⚠️ **排程 workflow 的失敗通知只寄給「最後修改過 cron 那一行的人」**（GitHub 官方行為，
   見 <https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs>）。
   這個檔案是由 AI 以 `Claude <noreply@anthropic.com>` 身分建立的，那不是站長的 GitHub 帳號
   ——**站長必須自己動一次 cron 那行並用自己的帳號 commit**（例如把 `0 1 * * *` 改成
   `5 1 * * *`），通知才會寄到自己信箱。否則整套監控形同虛設：壞了也沒人知道。
   另需在 <https://github.com/settings/notifications> 的 Actions 區塊勾選 Email
   （建議一併勾「Only notify for failed workflows」，否則每天成功也會寄一封）。
   ⚠️ 這是個人帳號設定，不在 repo 的 Settings 裡。

3.6 **OEN 代開發票**：CRM 若開啟代開發票，建立交易時**必須**帶 userName＋userEmail，
   否則回 V0001 USER_NAME_AND_EMAIL_REQUIRED。目前程式碼**沒有帶**這兩欄
   （測試期請先別在 CRM 開發票功能）。要開的話：checkout.js 補 userEmail（Firebase 有）
   與 userName（可用 displayName，沒有時退回 email），並更新購買條款的個資告知。

3.65 **⚠️ CF Pages 的 Preview 與 Production 是兩組完全獨立的設定**——D1 綁定與
   環境變數都要「各設一份」。在 Production 設好不代表 Preview 有（反之亦然）。
   preview 部署上 API 報「D1 綁定 DB 未設定」或「OEN 設定不完整」時，先查這個。
   加完任何綁定或變數都要**重新部署**才生效。

   Secret 型變數（如 `PMC_PAY_TOKEN`）加密後**永久無法讀回**——這是 CF 的設計，
   不是介面問題。OEN 的 token 在 CRM 也只顯示一次。因此：**產生 token 的當下就要
   存進密碼管理器**，否則兩邊都取不回，只能到 CRM 重新產生（重產會使舊 token 失效）。

3.7 **上線前雜項清單**：
   - [ ] **`PMC_PAY_ENV=prod` 設在 Production**（漏設會被程式擋下並報錯——見
         `resolvePaymentConfig` 的防呆；沒有這道防呆的話會靜默走測試環境：
         收不到錢卻照常開通權益）
   - [ ] Production 的 `PMC_PAY_TOKEN` 換成 OEN **正式環境**產的 token（測試/正式不互通）
   - [ ] Production **不可**留著 `PMC_ADFREE_PRICE=150`（那是 OEN 測試環境
         「>100 才成功」的權宜值；正式要移除變數回到預設 100）
   - [ ] 刪除測試期的 Deploy Hook 並重建（該 hook URL 在開發對話中傳遞過；
         位置：CF Pages → Settings → Deploy Hooks → 垃圾桶圖示刪除 → Add 重建）
   - [ ] Firebase 授權網域移除測試用的 pages.dev 網域（如果加過）
   - [x] ~~IP 白名單問題已有答案~~（2026-08-24 應援同意接受 Cloudflare 區段，見 3.5）
   - [ ] 設定白名單健檢的四個變數並跑一次 `workflow_dispatch`（見 3.55）：
         CF Pages 的 `PMC_HEALTHCHECK_TOKEN`、GitHub 的 `PMC_HEALTHCHECK_URL`＋
         `PMC_HEALTHCHECK_TOKEN`，然後把印出的 etag 填進 `tools/paywall/cf-ips.etag`
   - [ ] **站長本人改一次 cron 那行並 commit**，否則失敗通知不會寄給你（見 3.55）
   - [ ] 向應援取得正式環境資料（見 3.75）
   - [ ] 確認 Production **沒有**設 `PMC_PAY_INSPECT=1`（那支端點會原樣記錄請求標頭，
         只該用在測試環境。它預設在正式分支回 404，設了這個變數才會反過來啟用）
   - [x] ~~用 `4012 8888 1888 8333` 實測過失敗路徑~~（2026-08-23 完成，見 2.13）
   - [ ] 決定要不要開 3D 驗證（`PMC_PAY_USE3D=1`）：開啟後盜刷爭議責任轉移給
         發卡行，代價是多一道驗證、轉換率略降。預設關閉（同 OEN 預設）
   - [ ] **第一筆正式測試就用「＋25 加碼」買**（見 2.25）：一次驗證加碼金額有沒有
         正確傳到金流商、實際扣款是不是 NT$125、訂單 `amount` 與 OEN 回報是否相符。
         用底價買會漏掉整條加碼路徑
   - [ ] 上線後買一筆，用 `SELECT source FROM entitlements` 確認 webhook
         在正式站真的有送達（見 2.5）
   - [ ] D1 已補上 `orders.deleted_at` 欄位（2026-08-21 新增；既有資料庫執行
         `ALTER TABLE orders ADD COLUMN deleted_at INTEGER;`）

3.75 **上線前一定要先向應援取得／確認的事**（這些程式碼給不了，只能等對方回覆）：

   | 要問的事 | 為什麼非問不可 |
   |---|---|
   | **正式環境是否已開通**（合約／審核完成） | 沒開通就沒有正式 CRM，後面全部免談 |
   | **正式環境的 API base 網址**（仍未確認） | 我們目前填的 `https://payment-api.oen.tw` 是**由測試環境的 `payment-api.testing.oen.tw` 推得的，沒有經對方確認**。⚠️ 2026-08-25 對方給的 `https://pick-my-card.oen.tw/` 是**結帳頁**網域，不是 API 網域，這一項還沒被回答。猜錯的話 checkout 會直接失敗。真的不同時不用改程式碼，設 `PMC_PAY_CHECKOUT_URL` / `PMC_PAY_QUERY_URL` 覆蓋即可 |
   | ~~**正式環境的 merchantId**~~ | ✅ 2026-08-25 確認：正式平台網域為 `https://pick-my-card.oen.tw/`，即 merchantId 仍是 `pick-my-card`。我們推導結帳頁的規則 `https://{merchantId}.oen.tw` 與之相符，`PMC_PAY_PAGE_BASE` 不用設 |
   | **正式環境的 Bearer token** | 在正式 CRM 產製，與測試互不相通。⚠️ 只顯示一次，產出當下就要存進密碼管理器 |
   | **白名單已設好 Cloudflare 區段、且已生效** | 這是我們同意的方案，但要對方實際設定完成並回報，不能假設 |
   | **正式環境的 webhook／導回網址要填 `https://pickmycard.app`** | 兩邊都要指到正式網域，不能留測試的 pages.dev |
   | **撥款週期與實際費率** | 測試期觀察到 50 元交易 `fee: 2`（約 4%），要確認正式費率與撥款頻率 |

   ⚠️ **在這些拿到之前不要 merge 上線**——不是「先上再說，之後補設定」：
   缺 token 或網址錯誤時，用戶按下購買會直接失敗，等於用真實流量在踩雷。

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

## 6. 怎麼部署 preview（測試用）

站長已關閉自動 preview 部署，改用 Deploy Hook 手動觸發。

1. **建立**（一次性）：CF Pages → Settings → Deploy Hooks → Add，
   branch 選付費牆分支，存檔後得到一串網址
2. **觸發**（每次要部署）：在自己的電腦執行

   ```powershell
   curl.exe -X POST "<deploy hook 網址>"
   ```

   ⚠️ Windows PowerShell 的 `curl` 是 `Invoke-WebRequest` 的別名，**吃不懂 `-X`／`-d`**，
   一定要寫 `curl.exe`（或改用 `Invoke-RestMethod -Method Post -Uri "..."`）。
3. 到 Deployments 等建置完成，複製**分支別名**那個網址（開頭是分支名的那個，
   每次部署都不變；開頭是亂數 hash 的那個每次都會變）
4. 首次使用該網址前，要把它加進 Firebase Console → Authentication → Settings →
   Authorized domains，否則站內登入會被擋（`auth/unauthorized-domain`）

**改了環境變數或 D1 綁定，一定要重新部署才會生效。**
hook 網址等同「任何人可觸發你的部署」的鑰匙，不進 git、不貼公開處；
測試期結束後刪掉重建（見第 3 節上線清單）。

## 教訓記錄


- **2026-08-19｜不要靠記憶寫金流的黃金值**：寫 CheckMacValue 的自我測試時，我憑記憶寫下綠界文件範例的預期字串，把分隔符寫成未編碼的 `=`/`&`，測試因此紅燈。查證後確認綠界是「整串一起 URL encode」，分隔符會變 `%3d`/`%26`——是我的預期值錯、實作對。教訓：金流這種對錯只有二元結果的地方，黃金值要嘛查官方文件、要嘛用另一個獨立實作（這裡用 Python 的 `urllib.parse.quote_plus`）算出來，不能拿自己的實作當對照組，也不能靠記憶。
- **2026-08-19｜煙霧測試紅燈先懷疑測試環境，不要急著改產品碼**：首次跑 `adfree-smoke.mjs` 時 `index.html` 量到「沒有廣告位、沒有 modal」，看起來像頁面壞了。實際是 index.html 會把 `localStorage.length === 0` 的首訪者 `location.replace` 到 landing.html，而付費情境因為寫了旗標所以不會被導走——量到的根本是兩個不同頁面。已在測試裡加上「停在受測頁」的斷言，讓這種情況直接顯示成路徑不符而不是功能異常。
