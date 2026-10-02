# 用戶資料儲存與安全慣例

> 改「localStorage、Firestore、登入登出、個人化設定、任何 innerHTML/href」前必讀。
> 這個檔案裡的規則多數是「違反＝洩漏或抹掉用戶資料」等級，不是風格建議。

## 1. localStorage 讀取一律走安全 helpers

- `readLocalJSON(key, fallback)` / `readLocalJSONArray(key, fallback)`（script.js 開頭「localStorage 安全讀取 helpers」區）
- 壞資料（污染的 JSON）→ 回傳 fallback **並移除該 key**（自我修復），絕不讓 JSON.parse 拋錯中斷流程
- **禁止**在任何新程式碼直接寫 `JSON.parse(localStorage.getItem(...))`（`tools/preflight.sh` 會擋）
- 載入的卡片 ID 用 `filterKnownCardIds()` 過濾已下架卡片——**只在記憶體過濾，絕不回寫**

## 2. 🔒 絕對不可以擅自改寫用戶已儲存的級別（最高等級鐵則）

用戶選過的級別（如國泰 CUBE Level 1/2/3）存在 localStorage（訪客）或 Firestore（登入者），是**用戶個人資料**。

**唯二允許呼叫 `saveCardLevel()` 覆寫的情況**：
1. 用戶「親自」在下拉選單點選新級別（level 選擇器的 `onchange` handler）
2. 大小寫／空格不同的**同一個**級別正規化（如 `level1` → `Level 1`）

**嚴禁的反模式**：「用戶存的級別在目前 levelSettings 找不到」時，用預設值**顯示**是對的（防詳情頁當機），
但**絕不可以順手把預設值 saveCardLevel() 存回去**——「找不到」常是暫時的（剛更新 cards.data 的瞬間、
匯出短暫不完整），存回去會**永久抹掉**用戶真正的選擇且無法還原。levelSettings 之後含回該級別時會自己恢復。
參考實作：`resolveCardLevel()`（script.js 尾段）——它**刻意不**呼叫 saveCardLevel。

**「防當機」與「改寫記憶」是兩件事**：防當機靠「顯示時退回預設值」，不是「把記憶改寫成預設值」。修 bug 時不要把這兩件事重新綁在一起。

## 3. 卡片級別的本機 key 有 uid 區分

- 登入者：`cardLevel_<uid>_<cardId>`；訪客：`cardLevel-<cardId>`（沿用舊 key）
- 一律透過 `cardLevelLocalKey(cardId)` 取 key
- **登入狀態下絕不讀寫訪客 key**——那可能是共用電腦上「別人」的選擇（過去曾因此跨用戶洩漏級別）

## 4. 訪客資料在登入時的處理原則（統一，無彈窗）

- **雲端有值 → 雲端為準**；**雲端沒值 → 靜默帶入訪客值並上傳**
- 訪客 key 兩種情況都會被「消化移除」（避免留在共用電腦洩漏給下一位使用者）
- 信用卡/行動支付/我的信用卡：在各自的 load 函數內處理
- 配卡表/級別/筆記/免年費/結帳日/CUBE 發卡組織：統一在 `absorbGuestPersonalData(userData)`
- 高價值資料（級別、筆記）上傳失敗時**保留 key 下次重試**；低價值資料 best-effort

## 5. 登出清理

- `clearPersonalLocalDataOnSignOut(uid)`：清所有帶 uid 的鏡像＋非 uid 區分的個人 key
- **只能在「用戶親自按登出」時呼叫**，不能放進 onAuthStateChanged 的登出分支（訪客每次開頁都會觸發該分支，會誤刪訪客資料）
- 新增帶 uid 的本機 key 時要同步加進清理清單。2026-09-28 加了配卡組合頁的 `merchantAliases_<uid>`（自訂商家名稱鏡像，正本在 Firestore `users/<uid>.merchantAliases`）、`mappingsPrefs_<uid>`（排列／字級／存圖偏好，只存本機）與 `mappingsTitle_<uid>`（小抄標題鏡像，正本在 `users/<uid>.mappingsTitle`）

## 6. XSS 與連結安全

- **所有動態 innerHTML 內容一律 `escapeHtml()`**；多行文字用 `escapeHtmlMultiline()`
- **例外（刻意允許 HTML）僅兩處**：公告 modal 的 `fullText`、FAQ 的 `answer`——都是管理者控制的 Google Sheets 內容，程式內有註解標明；**絕不**把用戶輸入餵進這兩個欄位
- **動態 href 一律先過 `sanitizeUrl()`**（只允許 http/https，擋 `javascript:`）
- **Firestore 安全規則唯一正確版本在 repo 的 `firestore.rules`**；改規則先改 repo 再貼 console（教學見 `FIRESTORE-RULES-README.md`）

## 7. Debug 日誌慣例

- 正式環境 `console.log`/`console.warn` 被檔案頂部閘門靜音；網址加 `?debug=1` 重新開啟
- `console.error` 永遠輸出——錯誤處理用 error，不要用 log
- 熱迴圈不要為了 log 做額外計算

## 8. Firebase 方案與用量現況（別再問用戶）

- **方案：Blaze（按量計費）**，因 `functions/` 的 Cloud Function（2026-10-01 起為 dailyFeedbackDigest）需要。Blaze 仍保有每日免費額度，超出才計費
- **用量快照（2026-09-22，用戶提供 Firebase Console 截圖）**：Firestore 讀取約 **63 次/日**（近一週峰值約 200），寫入約 **6 次/日**，Cloud Storage 佔用 **12.5MB**（用途只有意見回饋的截圖上傳，見 `js/quick-options-misc.js` 的 `uploadBytes`）
- **對照免費額度**：讀取 50,000/日、寫入 20,000/日、Storage 5GB → 目前用掉約 **0.1%**，實際帳單趨近 $0
- **因此：禁止以「省成本」為由提案 Firestore 讀寫優化**（例如把 `cardSettings` 的一卡一筆合併成一包）。要動那塊必須有「效能/使用者體驗」的實測理由，且受第 2 節🔒鐵則約束
- **重新評估的觸發條件**：Firestore 日讀取持續 > 25,000（免費額度一半）時才值得重看；在那之前用量不是議題
- **旁證：登入用戶極少**。Firestore 只有登入用戶會觸發讀寫（`getCardLevelUncached()` 未登入直接走 localStorage 返回）。日讀取僅兩位數 ⇒ 實際使用雲端同步的人與累計用戶數不成比例
- **站長定位（2026-09-22 決策）**：本站需求本質上是**一次性查詢**（「這筆刷哪張」答完就走），**不刻意翻轉成高回訪／高登入率**。因此：不主動提案以提高登入率、回訪率、綁定用戶為目標的功能（推播、簽到、會員牆等）；「免登入、打開就用」是刻意保留的特性，不是待修的缺口。登入功能維持現狀服務少數重度用戶即可

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）

- [2026-08-23] iPhone「加到主畫面」的 App 登入後配卡是空的 → 該 webview 的 localStorage／登入狀態與 Safari 完全隔離，雲端讀不到時就只剩空的本地快取，而空清單的文案（「還沒有配卡記錄」）和「沒登入」「讀取失敗」長得一模一樣 → 個人資料的空狀態一律分流顯示（未登入／讀取失敗＋重試／真的沒資料），不可讓失敗偽裝成沒資料
- [2026-10-01] 9/30 Threads 爆量當天出現 US$7.41 的 Firestore 寫入費（單日 36 萬次寫入、讀取不到 1 千）→ 不是網站程式：一個 9/29 用 email 註冊的帳號用 Python 腳本每秒十幾次改寫自己的 `users` 文件（欄位 `lastThread`、時間戳 `+08:00` 微秒格式都不是前端產生的）；舊規則只檢查「本人」，不限欄位與頻率 → 規則改成 `users` 欄位白名單、`cardSettings`/`userNotes` 文件 ID 必須等於 uid＋cardId 且限定欄位、關閉訪客可寫的 `reviews`、封鎖該 uid（帳號在 console 停用、不刪）；**前端新增 users 欄位必須同步改規則白名單**，規則改動一律先跑 `tools/firestore-rules-test.js`（模擬器）。第 8 節「用量不是議題」只適用正常用量，不代表可以不防濫用。查兇手的方法：Firestore Data 頁對各 collection 依 `updatedAt` 由新到舊排序，持續跳動的那筆就是
- [2026-10-02] 同一人用 Gmail 加點的新帳號（paul732200.0@gmail.com）再跑同一支腳本，這次只寫允許的欄位（欄位白名單擋不到頻率），凌晨被新設的「每小時寫入 > 5000」警報抓到 → 規則只管「誰、寫什麼」，不管「多常寫」；App Check 當時還沒 Enforce → 每帳號寫入上限（`rateLimits`，每 10 分鐘 100 次，前端 `index.html` 的 `rlCommit` 自動帶計數）＋ App Check Enforce。比對 Gmail 變體的封鎖試過後拿掉（換新 Gmail 就繞過）。**改到這套機制：先上線網站程式、再貼規則**（前端有過渡用的不帶計數最後一試）
- [2026-10-03] 回報功能加每日額度（每帳號每天 5 則、每則 3 張、圖一律壓成 JPEG ≤2MB）：`feedbackQuota/{uid}` 預約制，回報文件 ID 與圖檔名都帶「台灣日期＋第幾則」，規則只認今天 → 不需要 Storage 跨服務讀 Firestore（`firestore.get` 在本機模擬器測不到，所以刻意不用）。踩到的坑：`setDoc` 不帶 merge 時 `increment()` 從 0 起算，計數 +1 一定要 merge
- [2026-10-02] 註冊把關：攻擊者用 email/密碼表單註冊（隨便填 Gmail 地址、不驗證），帳號免費無限開＝每個新帳號多一份寫入額度 → `functions/guardSignup`（beforeUserCreated 阻擋函式）：email 註冊同 IP 每天 10 個、拒拋棄式信箱、Google 登入不限、出錯放行。需 Identity Platform 升級。沒選用「只准驗證過 email 才能存雲端」：站上從沒寄驗證信，大量既有 email 用戶會失去雲端同步
- [2026-10-03] 改成「Email 連結登入」：新用戶不能再用 email／密碼註冊（`guardSignup` 擋 `signInMethod === 'password'`），既有密碼帳號照常登入、也可直接用連結登入同一個帳號。登入信由 `functions/sendLoginLink` 自己寄（強制 App Check＋每信箱／每 IP 限量），Firebase 內建登入連結信由 `guardEmails` 一律擋——否則任何人都能拿公開 API 對陌生人信箱狂寄。同一個實體信箱（Gmail 正規化）只能開一個新帳號（`signupInboxes/`）。前端 sendLoginLink 用動態 import 載入 functions SDK（回歸測試的替身模組才不會壞）
