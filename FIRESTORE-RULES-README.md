# Firestore 安全規則 — 套用教學

`firestore.rules` 是本專案 Firestore 安全規則的**唯一正確版本**（版本控管在 git）。
用戶雲端資料（信用卡選擇、級別、筆記、配卡表…）的安全**完全依靠這組規則把關**，
因為前端程式碼任何人都看得到、任何人都可以直接呼叫 Firestore API。

## 這組規則保護了什麼

| Collection | 規則 | 效果 |
|---|---|---|
| `users/{uid}` | 只有本人（登入且 uid 相符）能讀寫 | 別人拿不到你的設定，也改不了 |
| `cardSettings/{uid}_{cardId}` | 文件 ID 必須以自己的 uid 開頭 | 卡片級別只有本人能讀寫 |
| `userNotes/{uid}_{cardId}` | 同上 | 筆記只有本人能讀寫 |
| `feedback` | 需登入、只能新增、內容限 5000 字 | 回報內容不會被其他用戶讀到 |
| `reviews` | 訪客可送出、只能新增、rating 限 1–5 | 評分不會被讀取/竄改/灌爆超長內容 |
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
2. 開無痕視窗（訪客）→ 送出一個星星評分 → 成功 ✅
3. 登入後送出一筆問題回報 → 成功 ✅

如果有任何功能突然出現「權限不足」錯誤，代表 console 上原本的規則和這份有差異，
把你備份的舊規則貼給工程協助者（或 AI）比對即可。

## 日後修改規則的流程

1. **先改 repo 裡的 `firestore.rules`**（讓 git 留下紀錄）
2. 再把新內容貼到 console 發布
3. 不要只改 console 不改 repo —— 那會讓 repo 的版本失去意義

## 補充：Firebase Storage

問題回報功能會把用戶附的圖片上傳到 Firebase Storage（`feedback` 相關路徑）。
Storage 有自己獨立的一組規則（console → Storage → Rules），本檔案不涵蓋。
建議原則：只允許已登入用戶上傳、限制檔案大小（如 5MB）與 content-type 為圖片。
