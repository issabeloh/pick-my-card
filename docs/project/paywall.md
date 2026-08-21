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

## 2.7b OEN 流程（已實作，2026-08-20）

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

## 2.8 帳號刪除與付費資料（2026-08-21）

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

## 2.9 付款確認不到時的自動通報

`recheckOrder()` 走到「查不到成功紀錄」時，代表最需要人介入的情況——用戶可能
已經付錢但系統確認不到。此時自動往既有的 `feedback` 集合寫一筆記錄（含訂單編號、
uid、email），並告訴用戶「已通知管理員，請明天再確認一次」。

刻意重用問題回報的管道而不是另做一套通知：管理員本來就會看那份清單，多一個
各自獨立的通知管道只會多一個沒人看的地方。送不出去時（Firestore 不通）不會
對用戶謊稱已通知，改回原本的自助文案。

## 2.10 上線策略：分支等到 OEN 正式環境就緒再一次 merge（站長決定，2026-08-21）

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
   | `PMC_ADFREE_PRICE` | `100` | ⚠️ OEN 測試環境要求金額 >100（見 3.4），正式定價 100 剛好在邊界上——**Preview 要設 150**，Production 不設此變數 |
   | `PMC_FIREBASE_PROJECT_ID` | `pick-my-card-28f2a` | 驗 ID token 的 aud |

3.4 **OEN 測試環境的測試卡號與金額**（業務提供的第三階段文件，2026-08-21）：

   | 項目 | 值 |
   |---|---|
   | Visa 成功 | `4242 4242 4242 4242` |
   | Visa 失敗 | `4242 0000 4242 0000` |
   | Master | `5` 開頭任意卡號 |
   | 測試金額 | **一律高於 100** |

   ⚠️ **測失敗情境要換卡號，不是把金額壓到 100 以下。** API 文件另有一句
   「欲測試失敗情境金額 < 100」，但業務的串接指引明確要求「測試金額請高於 100」，
   兩者衝突時以卡號為準——用失敗卡號、金額維持 >100 最不會踩到未定義行為。

   由此衍生一個永久限制：**正式定價 NT$100 剛好落在測試環境的邊界上，
   在測試環境永遠測不到真實金額**。Preview 因此固定用 `PMC_ADFREE_PRICE=150`，
   而 Production 不設此變數（回到預設 100）。

3.45 **OEN 官方 MCP server（選用，非必要）**：業務另提供
   `oen-payment-mcp-server`，可在本機的 Claude Desktop／Claude Code 裡以對話方式
   呼叫 OEN API（建單、查交易、讀 API 文件…）。

   **本專案的串接不需要它**——`functions/_lib/payment.js` 已直接串接 REST API 並
   實測成功。它的價值在於「臨時查一筆交易」或「用 `readDocs` 撈官方文件原文」，
   要在**站長自己的機器**上跑（本開發容器的 egress 政策擋掉 oen.tw，裝不了）。
   官方註明它屬開發測試階段、不可用於 Production，也不會再更新。

3.5 **⚠️ OEN 正式環境的 IP 白名單（上線前必解的問題）**：業務告知正式環境要提供
   **固定 IP** 讓應援設白名單才能呼叫 API。但我們的後端是 Cloudflare Pages Functions，
   **出口 IP 不固定**（走 Cloudflare 共用 IP 池）。測試環境不受影響（不需綁 IP）。
   解法優先順序：① 問應援可否改用 Cloudflare 官方公布的 IP 區段（https://www.cloudflare.com/ips/）
   設白名單，或以 Bearer token 本身為準免綁 IP；② 都不行才考慮自架固定 IP 的轉發層（增加成本與故障點）。
   **在這題有答案前不要排上線。**

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
   - [ ] IP 白名單問題已有答案（見 3.5）
   - [ ] D1 已補上 `orders.deleted_at` 欄位（2026-08-21 新增；既有資料庫執行
         `ALTER TABLE orders ADD COLUMN deleted_at INTEGER;`）

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
