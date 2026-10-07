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

## 帳號與 Email 把關（guardSignup／guardEmails，2026-10-02 加入、10-03 改版）

實作在 `signup-guard.js`，測試 `tools/signup-guard-test.js`：
- `guardSignup`（註冊前）：拒絕新的 email／密碼註冊（新用戶改用 Email 連結或 Google）、拒絕拋棄式信箱、
  **同一個實體信箱只能有一個新帳號**（Gmail 忽略「.」與「+後綴」，正規化後雜湊存 `signupInboxes/`）
- `guardEmails`（Firebase 寄信前）：Firebase 內建的登入連結信一律擋（改由下面的 sendLoginLink 寄）；
  重設密碼信同一個信箱每天最多 3 封
- 不存原始 email／IP，只存雜湊；任何非預期錯誤一律放行
- 需要專案升級到 **Firebase Authentication with Identity Platform**（已於 2026-10-02 升級）。
  部署後到 Firebase console → Authentication → Settings → **Blocking functions** 確認
  「Before account creation」是 `guardSignup`（有「寄信前」選項的話選 `guardEmails`）

## Email 連結登入（sendLoginLink，2026-10-03）

網站「用 Email 連結登入／註冊」按鈕呼叫的函式，實作在 `login-link.js`，測試 `tools/login-link-test.js`：
- 強制 App Check（只有真網站能叫）；同一信箱每小時 3 封、每天 5 封，同一 IP 每小時 30 封
- 用 Admin SDK 產生登入連結，改成 `https://pickmycard.app/?start=1&mode=signIn&oobCode=…`，寄**中文信**
  （寄件者＝`MAIL_FROM` 參數，主旨「登入 Pick My Card」）；前端 `index.html` 完成登入
- 寄信用和每日摘要同一組 SMTP 參數

### 用 Resend 從自己的網域寄信（一次性設定）
1. Resend → Domains → Add domain：`pickmycard.app` → 照畫面把 DNS 紀錄加到 Cloudflare（Resend 有自動設定）→ 等 Verified
2. Resend → API Keys → 建立一把（權限 Sending access）並複製
3. Cloud Shell：
   ```bash
   cd ~/pick-my-card/functions
   npx firebase-tools functions:secrets:set SMTP_PASSWORD --project pick-my-card-28f2a   # 貼上 Resend API key
   grep NOTIFY_EMAIL_TO .env.pick-my-card-28f2a > /tmp/pmc-env
   printf 'SMTP_HOST=smtp.resend.com\nSMTP_PORT=465\nSMTP_USER=resend\nMAIL_FROM=noreply@pickmycard.app\n' >> /tmp/pmc-env
   mv /tmp/pmc-env .env.pick-my-card-28f2a && cat .env.pick-my-card-28f2a
   ```
4. `npx firebase-tools deploy --only functions --project pick-my-card-28f2a`
- Resend 免費方案約每天 100 封、每月 3,000 封（登入信＋每日摘要共用）
- 換寄件地址時，`js/quick-options-misc.js` 的 `LOGIN_MAIL_FROM` 要一起改（寄出後的提示會顯示它）
