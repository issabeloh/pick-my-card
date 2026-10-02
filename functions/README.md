# Cloud Functions — feedback 每日摘要＋註冊把關

本資料夾有兩個函式：
- `dailyFeedbackDigest`：意見回饋每日摘要（下面大部分章節在講它）
- `guardSignup`：註冊把關（見最後一節「註冊把關」）


使用者送出「回報問題 / 意見回饋」後，回饋只會靜靜出現在 Firestore 的 `feedback` collection。
這個函式**每天台北時間 09:00** 把上次寄出之後的新回饋整理成**一封**摘要推給站長；
**沒有新回饋就什麼都不寄**。

| 管道 | 內容 |
|---|---|
| Email（SMTP） | 每則的內容、時間、使用者（email 可點）、附圖連結；只有一則時可直接「回覆」給使用者 |
| Webhook（Discord / Slack / Telegram） | 同一份摘要的純文字版（超過約 1900 字會截斷） |

兩個管道獨立：只設定其中一個也能運作。

- 程式碼：`functions/index.js`（排程，函式名 `dailyFeedbackDigest`）＋ `functions/digest.js`（實作）
- 進度記在 Firestore `_meta/feedbackDigest`（`sentUntil`）：某天寄送失敗不前進，隔天會補寄；一封最多列 50 則
- 不需要改 `firestore.rules`：Admin SDK 不受安全規則限制（前端讀不到 `_meta`、`feedback`）
- 2026-10-01 前是 `notifyOnFeedback`（每則即時寄信），站長改成每日摘要；也避免被狂送回饋時信箱被灌爆
- 測試：`tools/feedback-digest-test.js`（Firestore 模擬器＋假寄信，用法見檔頭）

---

## 前置條件

1. **Firebase 專案要是 Blaze（從量計費）方案** — Cloud Functions 第 2 代的硬性要求。
   實際費用：一天跑一次；排程用 Cloud Scheduler（每個帳單帳戶每月 3 個排程免費），帳單基本上是 0。
   仍建議在 Google Cloud console 設一個預算警示（例如 US$1）當保險。
2. 本機安裝 Firebase CLI：`npm install -g firebase-tools`，然後 `firebase login`。

## 設定步驟

```bash
cd functions
npm install
```

### 1. 建立密鑰（Secret Manager）

**兩個密鑰都要建立**，即使只打算用其中一個管道（沒用到的填一個字元即可，
程式會判定為未設定而略過該管道）：

```bash
# Email 用：Gmail 的「應用程式密碼」（不是 Google 帳號密碼）
firebase functions:secrets:set SMTP_PASSWORD

# Webhook 用：Discord/Slack/Telegram 的推送網址
firebase functions:secrets:set NOTIFY_WEBHOOK_URL
```

- Gmail 應用程式密碼：Google 帳戶 → 安全性 → 兩步驟驗證 → 應用程式密碼，產生 16 碼。
- Discord：伺服器設定 → 整合 → Webhook → 複製 Webhook 網址。
- Slack：Incoming Webhook 網址。
- Telegram：`https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>`
  （chat_id 放在網址的 query string，訊息內容由函式以 `text` 送出）。

### 2. 部署

```bash
firebase deploy --only functions
```

> 從舊的 `notifyOnFeedback` 改版時，CLI 會說專案裡有個函式在程式碼中找不到、問要不要刪除
> （"Would you like to proceed with deletion?"）→ 回答 **y**。刪掉它才不會繼續每則即時寄信。

第一次部署會互動詢問三個非密鑰參數（之後存在 `functions/.env.pick-my-card-28f2a`，該檔已被 gitignore）：

| 參數 | 說明 | 範例 |
|---|---|---|
| `NOTIFY_EMAIL_TO` | 收通知的信箱（留空＝關閉 email 管道） | `you@example.com` |
| `SMTP_HOST` | SMTP 主機 | `smtp.gmail.com`（預設） |
| `SMTP_PORT` | SMTP 埠（465 走 SSL） | `465`（預設） |
| `SMTP_USER` | 寄件帳號 | `you@gmail.com` |

> 部署若因區域不符失敗（錯誤訊息會指出 Firestore 資料庫所在區域），
> 改 `functions/index.js` 最上面的 `REGION` 常數再部署一次。

### 3. 驗證

不用等到隔天 09:00：
1. 到網站登入 → 頭像選單「回報問題」送一則測試訊息
2. Google Cloud console（Pick my card 專案）→ 搜尋 **Cloud Scheduler** →
   找到 `firebase-schedule-dailyFeedbackDigest-asia-east1` → 右邊 ⋮ → **強制執行（Force run）**
3. 一分鐘內應該收到一封「1 則新回饋」的信；再強制執行一次則不會再寄（已寄過）
4. 沒收到就看 log：

```bash
firebase functions:log --only dailyFeedbackDigest
```

log 會寫出每個管道是「送出成功」「因未設定而略過」還是「失敗＋原因」，以及「沒有新回饋，不寄送」。

## 常見狀況

- **email 進垃圾信件匣**：把寄件地址加入聯絡人，或改用自有網域的 SMTP。
- **Gmail 每日寄信上限**：一般帳號約 500 封/日，對回饋量而言不會碰到。
- **想改寄送時間**：改 `functions/index.js` 的 `schedule`（cron 格式，台北時區），再部署一次。

## 註冊把關（guardSignup，2026-10-02 加入）

每次有人註冊新帳號，Firebase 會先問這個函式（阻擋函式 `beforeUserCreated`），實作在 `signup-guard.js`：
- Email／密碼註冊：同一個 IP 每天（台灣時間）最多 10 個；拋棄式信箱網域一律拒絕
- 「用 Google 登入」的新用戶不限
- IP 只存雜湊（`signupLimits/{雜湊}_{日期}`），不存原始 IP；出錯一律放行
- 前端（`js/quick-options-misc.js`）看到 `PMC_SIGNUP_LIMIT`／`PMC_SIGNUP_DISPOSABLE` 會顯示對應中文提示
- 測試：`tools/signup-guard-test.js`

**部署前一次性設定**：Firebase console → Authentication → Settings → 升級到
**Firebase Authentication with Identity Platform**（阻擋函式的前提；每月 50,000 個活躍用戶內免費；
升級後無法降回）。之後照常 `firebase deploy --only functions`。

**確認有生效**：Firebase console → Authentication → Settings → **Blocking functions**，
「Before account creation (beforeCreate)」那格應該選著 `guardSignup`；沒選就手動選並儲存。
