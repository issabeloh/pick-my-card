# Cloud Functions — feedback 即時通知

使用者送出「回報問題 / 意見回饋」後，回饋只會靜靜出現在 Firestore 的 `feedback` collection，
沒人會主動知道。這個函式在文件建立的當下把內容推給站長：

| 管道 | 用途 | 到達速度 |
|---|---|---|
| Email（SMTP） | 完整內容、附圖連結，信件可直接「回覆」給使用者（`replyTo` 已帶使用者 email） | 幾秒～幾十秒 |
| Webhook（Discord / Slack / Telegram） | 手機推播，最即時；適合白天想馬上知道 | 1～3 秒 |

兩個管道獨立：只設定其中一個也能運作。

- 程式碼：`functions/index.js`（函式名 `notifyOnFeedback`）
- 觸發來源：前端 `js/quick-options-misc.js` 的 "Submit Feedback" → `addDoc(collection(db, 'feedback'))`
- 不需要改 `firestore.rules`：Admin SDK 不受安全規則限制（規則裡 feedback 仍是「只能新增、誰都不能讀」）

---

## 前置條件

1. **Firebase 專案要是 Blaze（從量計費）方案** — Cloud Functions 第 2 代的硬性要求。
   實際費用：這個函式一天跑幾次到幾十次，遠低於每月免費額度（2M 次呼叫），帳單基本上是 0。
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
firebase deploy --only functions:notifyOnFeedback
```

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

1. 到網站按「回報問題 / 意見回饋」送一則測試訊息（或直接在 Firestore console 的 `feedback`
   collection 手動新增一份含 `message` 欄位的文件）。
2. 幾秒內應該收到 email / 推播。
3. 沒收到就看 log：

```bash
firebase functions:log --only notifyOnFeedback
```

log 會明確寫出每個管道是「送出成功」「因未設定而略過」還是「失敗＋原因」。

## 常見狀況

- **email 進垃圾信件匣**：把寄件地址加入聯絡人，或改用自有網域的 SMTP。
- **Gmail 每日寄信上限**：一般帳號約 500 封/日，對回饋量而言不會碰到。
- **想改成一天一封摘要**：把 `onDocumentCreated` 換成 `onSchedule`（`firebase-functions/v2/scheduler`）
  並在函式內查詢當天的 feedback 文件。目前選的是「即時」路線。
