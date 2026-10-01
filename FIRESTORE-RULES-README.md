# Firestore 安全規則 — 套用教學

`firestore.rules` 是本專案 Firestore 安全規則的**唯一正確版本**（版本控管在 git）。
用戶雲端資料（信用卡選擇、級別、筆記、配卡表…）的安全**完全依靠這組規則把關**，
因為前端程式碼任何人都看得到、任何人都可以直接呼叫 Firestore API。

## 這組規則保護了什麼

| Collection | 規則 | 效果 |
|---|---|---|
| `users/{uid}` | 只有本人能讀寫；**只接受網站實際會寫的欄位**（清單在規則裡） | 別人拿不到你的設定；腳本塞不進奇怪欄位 |
| `cardSettings/{uid}_{cardId}` | 文件 ID 必須是「自己的 uid＋_＋內容裡的 cardId」、cardId 限小寫英數與連字號、只能有 level/updatedAt/cardId | 卡片級別只有本人能讀寫，不能用亂取的 ID 無限新增文件 |
| `userNotes/{uid}_{cardId}` | 同上（欄位限 notes/updatedAt/cardId） | 筆記只有本人能讀寫 |
| `feedback` | 需登入、只能新增、內容限 5000 字 | 回報內容不會被其他用戶讀到 |
| `reviews` | **已停用**（2026-10-01；網站早已移除評分功能） | 全站不再有「不登入就能寫入」的地方 |
| 封鎖名單 | `notBlocked()` 裡的 uid 一律不能讀寫 | 2026-10-01 腳本狂寫事件的帳號（console 同時已停用，**不要刪除該帳號**） |
| 其他所有路徑 | 一律拒絕 | 未來新增 collection 必須明確加規則 |

## 套用步驟（第一次做約 5 分鐘）

1. 開啟 [Firebase console](https://console.firebase.google.com/)，選 `pick-my-card` 專案
2. 左側選單 → **Firestore Database** → 上方頁籤 **規則（Rules）**
3. **先把 console 目前的規則全選複製**，貼到記事本存檔備份（以防要還原）
4. 把本 repo `firestore.rules` 的**全部內容**複製、貼上（整份取代）
5. 按 **發布（Publish）**

## 發布前建議：用規則測試場驗證（選做但推薦）

規則頁面旁有「規則測試場（Rules Playground）」，可模擬請求：

| 測試 | 設定 | 預期結果 |
|---|---|---|
| 本人讀自己的設定 | get `/users/AAA`，驗證身分 uid=`AAA` | ✅ 允許 |
| 別人讀你的設定 | get `/users/AAA`，驗證身分 uid=`BBB` | ❌ 拒絕 |
| 未登入讀設定 | get `/users/AAA`，未驗證 | ❌ 拒絕 |
| 本人寫級別 | create `/cardSettings/AAA_cathay-cube`，uid=`AAA` | ✅ 允許 |
| 別人寫級別 | create `/cardSettings/AAA_cathay-cube`，uid=`BBB` | ❌ 拒絕 |

## 發布後驗證（實際網站）

1. 用你的帳號登入網站 → 改一張卡的級別 → 重新整理 → 級別還在 ✅
2. 登入後送出一筆問題回報 → 成功 ✅
3. 開「我的配卡組合」改標題、改一張卡的筆記 → 重新整理 → 都還在 ✅

如果有任何功能突然出現「權限不足」錯誤，代表 console 上原本的規則和這份有差異，
把你備份的舊規則貼給工程協助者（或 AI）比對即可。

## ⚠️ 前端新增寫入欄位時

`users` 文件的欄位有白名單。前端新增任何寫進 `users` 的欄位（新的 `setDoc(... { 新欄位: ... })`），
**必須同時**把欄位名加進 `firestore.rules` 的清單、在 `tools/firestore-rules-test.js` 加一條「允許」測試，
並重新發布規則；否則該欄位的儲存會被擋下（瀏覽器 console 出現 `permission-denied`）。

## 日後修改規則的流程

1. **先改 repo 裡的 `firestore.rules`**（讓 git 留下紀錄）
2. 跑模擬器測試 `tools/firestore-rules-test.js`（用法在檔頭；網站每種寫入都要允許、濫用寫法都要擋下）
3. 再把新內容貼到 console 發布
4. 不要只改 console 不改 repo —— 那會讓 repo 的版本失去意義

## App Check（2026-10-01 加入）

規則只能確認「是本人」，擋不了「本人用腳本狂寫」。App Check 讓 Firestore 只接受從真網站發出的請求。

- 提供者：Fraud Defense（舊名 reCAPTCHA Enterprise），site key 寫在 `index.html` 的 `ensureAppCheck`（公開值，不是密鑰）。
  key 的網域清單在 Google Cloud console（Pick my card 專案）→ reCAPTCHA → Keys；新增網域（如新的預覽網域）要去那裡加
- **只在登入後啟動**（訪客不碰 Firestore；省 reCAPTCHA 每月 10,000 次免費評估）；只在 `pickmycard.app` 與 `*.pages.dev` 啟動，localhost／回歸測試不會啟動
- Token 有效期設 1 天（Firebase console → App Check → Apps）
- **Enforce 流程**：部署後先觀察 1–2 天，Firebase console → App Check → APIs → Cloud Firestore 的「已驗證請求」比例接近 100% 再按 **Enforce**（只 enforce Firestore；Authentication、Storage 先不要）。
  Enforce 後：擋廣告／擋 reCAPTCHA 的登入用戶無法存設定（搜尋不受影響）；本機開發登入後也存不了（正常，正式站不受影響）

## Firebase Storage 規則（`storage.rules`）

問題回報的附圖上傳到 Firebase Storage，規則**另外一份**：repo 的 `storage.rules`，
貼到 console → **Storage** → **Rules**（不是 Firestore 那頁）→ 發布。改前一樣先把 console 舊規則複製備份。

- 只允許登入者上傳 `feedback/<時間戳>_<自己的uid>_<0-4>.jpg`、圖片、5MB 以下、不能覆蓋或刪除
- 只能讀自己的附圖（上傳後 getDownloadURL 要用）；站長在 console 看圖不受影響
- 其他路徑一律拒絕；封鎖名單與 `firestore.rules` 同步
- 模擬器測試和 Firestore 同一支：`tools/firestore-rules-test.js`
