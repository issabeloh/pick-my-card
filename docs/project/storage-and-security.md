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

## 6. XSS 與連結安全

- **所有動態 innerHTML 內容一律 `escapeHtml()`**；多行文字用 `escapeHtmlMultiline()`
- **例外（刻意允許 HTML）僅兩處**：公告 modal 的 `fullText`、FAQ 的 `answer`——都是管理者控制的 Google Sheets 內容，程式內有註解標明；**絕不**把用戶輸入餵進這兩個欄位
- **動態 href 一律先過 `sanitizeUrl()`**（只允許 http/https，擋 `javascript:`）
- **Firestore 安全規則唯一正確版本在 repo 的 `firestore.rules`**；改規則先改 repo 再貼 console（教學見 `FIRESTORE-RULES-README.md`）

## 7. Debug 日誌慣例

- 正式環境 `console.log`/`console.warn` 被檔案頂部閘門靜音；網址加 `?debug=1` 重新開啟
- `console.error` 永遠輸出——錯誤處理用 error，不要用 log
- 熱迴圈不要為了 log 做額外計算

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
