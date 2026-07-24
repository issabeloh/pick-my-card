# 儀表板（Dashboard 分頁）——規格與交接檔

> 建檔 2026-07-24（Fable 5 session）。本檔是**規格＋交接文件**：Phase 1 已由本 session 派工實作，
> Phase 2 之後的工作照本檔規格續做（原設計給 Opus 4.8 等級模型接手）。
> 動儀表板前必讀本檔＋CLAUDE.md 鐵則；涉及寫入用戶資料另讀 `docs/project/storage-and-security.md`。

## 1. 定位與架構決策（已與站長核定，勿回退）

- **儀表板是 main 裡的一個分頁視圖，不是 modal**。同一個 `index.html`、同一網址，用 hash `#dashboard` 切換；手機版底部固定 tab bar（「回饋查詢」／「儀表板」兩鈕），桌機版在 header 區做同功能切換鈕。理由：內容量大（最終 14+ 區塊）、未來所有個人資訊編輯都要移進來（詳情頁編輯不直觀），是一級目的地。
- 現有「我的信用卡」modal（wallet stack）**保留不動**；未來去留由站長另行決定。
- 切換機制：`body` 加/移除 class `view-dashboard`，CSS 控制兩視圖顯隱；監聽 `hashchange`＋載入時檢查 `location.hash`，瀏覽器返回鍵可用。merchant/landing 頁沒有儀表板 DOM，所有 init 必須 null-check no-op。
- **不做動畫**（站長指示）。
- 長期方向：把詳情頁的個人資訊編輯（免年費、額度、結帳日、筆記、分級）逐步搬進儀表板；Phase 1 只做唯讀＋導流連結，搬遷屬 Phase 3（見第 6 節）。

## 2. 檔案與載入

- 邏輯：`js/dashboard.js`（第 13 個模組檔，載入順序最後；頂部照慣例寫區塊目錄註解）。
- `index.html` 與 `merchant/*.html` 的 script 清單**必須同步加入、順序一致**（preflight 會查）；`?v=dev` 佔位。
- 樣式：追加在 `styles.css` 末尾（index 系列不開新 css 檔的慣例），區塊註解 `/* ===== Dashboard ===== */`。
- 持有卡清單來源與 `renderOwnedCardsOverview()`（js/cards-modals.js）相同；卡片靜態資料走全域 cards 資料。

## 3. 視覺規範（參考站長提供的 fintech app 截圖）

- 背景暖淺灰 `#F4F1EC`；內容卡純白、圓角 16–20px、極淡陰影；重點區塊可用深色底 `#17171B` 反白。
- 點綴用低飽和粉彩 chip：蜜桃 `#F8DCC5`、薄荷 `#CDE9DD`、薰衣草 `#DCD3F2`；金額數字大而粗（比照截圖 balance 樣式）。
- 手機單欄直排；桌機 grid 2–3 欄卡片版（區塊高度不齊沒關係，masonry 感）。responsive 斷點沿用全站 768px。
- 視覺化優先於文字：額度用橫條、日期用時間軸列表、年費用 badge＋加總大字。條/圈等圖形一律附文字數值（無障礙）。

## 4. Phase 1 範圍（現有資料唯讀彙整；2026-07-24 實作）

頂部固定：**今日日期**（如「7月24日 · 週四」）＋沿用「N 張」計數。各區塊（block）如下，
每塊有 `id`（供顯示設定用）、資料來源、排序與空狀態規則：

| block id | 內容 | 資料來源（讀取） | 規則 |
|---|---|---|---|
| `billing` | 結帳日/繳款日時間軸 | `loadBillingDates(cardId)`（js/spending-mappings.js） | 依「日」數字小→大排序；距今日最近的下一個結帳日高亮 |
| `annualFee` | 年費狀態＋加總 | `loadFeeWaiverStatus(cardId)`＋卡片資料 `annualFeeAmount` 數字欄位（2026-07-24 新增，站長核定方案；未重匯出前欄位不存在） | 已免年費→綠 badge；未免且有 `annualFeeAmount`→顯示金額並計入加總大字；欄位不存在→顯示 `annualFee` 原文、不計入加總並註記「待補資料」 |
| `creditLimit` | 個人信用額度 | `loadCreditLimit(cardId)` | 高→低橫條圖（條長=額度/最大額度）；未填寫的卡灰字列底部 |
| `pinned` | 各卡釘選通路＋回饋率 | spendingMappings 中 pinned 項（js/spending-mappings.js） | 按卡分組、通路+% 做 chip |
| `levels` | 個人分級 | `getCardLevel(cardId)`（js/levels-payments.js） | **唯讀**。🔒 鐵則：儀表板任何路徑都不得呼叫 saveCardLevel |
| `notes` | 我的筆記 | notes 讀取（js/card-detail.js，Grep "saveUserNotes" 同區塊的 load） | 只列有筆記的卡 |

- 通用空狀態：無資料→淡灰提示＋「前往卡片介紹頁填寫 ›」（`showCardDetail(cardId)`）。
- **讀取效率**：登入者不要每卡×每欄位各打一次 getDoc——`users/{uid}` 文件**取一次 snapshot**，各欄位（billingDates、免年費、creditLimits、筆記等，欄位名以各 save 函數寫入的為準）從同一 snapshot 讀；訪客走各 local key（一律 `readLocalJSON` 系列）。級別例外：直接用 `getCardLevel()`（有正規化邏輯，勿自行重讀）。
- **顯示設定**：header 齒輪鈕→設定面板（checkbox 每 block 一個），預設全開；存 localStorage key `dashboardBlocks`（裝置級偏好，暫不同步 Firestore——升級同步屬 Phase 2 可選項）。加入/移除只在設定面板做，儀表板本體不放增刪 UI（防雜亂，站長指示）。

## 5. Phase 2 交接規格（手動輸入類；未實作）

全部寫入遵守既有三段式：訪客 `<key>_local_<cardId>` 或等效 local key／登入者 Firestore `users/{uid}.<field>`＋本機鏡像 `<key>_<uid>_<cardId>`；讀取一律 `readLocalJSON`/`readLocalJSONArray`。動工前先確認 `firestore.rules` 允許 users/{uid} 新欄位（參 FIRESTORE-RULES-README.md）。

### 5a. 資料模型（站長已核定粒度：按卡片×按月）

```
users/{uid}.monthlyRecords = { [cardId]: { "YYYY-MM": { bill: <number>, cashback: <number> } } }
users/{uid}.budgetTracking = { [cardId]: { "YYYY-MM": { spent: <number>, budget: <number> } } }
users/{uid}.paymentSetup   = { [cardId]: { method: <string>, autopay: <bool>, autopayBank: <string> } }
```

### 5b. 功能區塊

| block id | 內容 | 計算/顯示 |
|---|---|---|
| `tracker` | 當月額度追蹤 | 手動輸入當月已刷金額＋個人預算 → 剩餘可刷金額；SVG 圓環表示已用/剩餘比例；距結帳日天數（由 billingDates 算，跨月取下次結帳日） |
| `records` | 每月賬單/回饋記錄 | 手動輸入，按卡×按月；列表＋月序長條 |
| `avgBill` | 月平均卡費 | monthlyRecords 有資料的月份平均（總體＋單卡） |
| `yearlyCashback` | 當年回饋加總＋佔卡費 % | 當年 cashback 加總、÷ 當年 bill 加總；**按卡片排名**（各卡回饋率百分比排序） |
| `payment` | 付卡費方式＋自動扣款 | 手動設定；autopay=true 才顯示扣款銀行欄 |

### 5c. Phase 2 實作注意

- 輸入框比照「我的額度」慣例：NT$ 前綴、只收數字、自動千分位、失焦/Enter 即存＋`✓ 已儲存`（Grep "我的額度相關功能"）。
- 新 block 全部登記進 `dashboardBlocks` 設定清單，預設**關閉**（避免空區塊嚇跑用戶；有輸入資料後可考慮自動開）。
- 動態 innerHTML 一律 `escapeHtml()`；月份 key 用本地時區 `YYYY-MM`。
- 圓環等圖表：純 SVG/CSS 自繪，不引入圖表庫（全站無 build、無外部依賴的慣例）。

## 5d. 年費數字欄位——站長待辦（資料重匯出前儀表板走降級顯示）

2026-07-24 已在 `apps-script/cards-export.gs` 加入 `addOptionalField(card, row, headers, 'annualFeeAmount', 'number')`。站長需：
1. Google Sheets「Cards Data」加欄位 `annualFeeAmount`（純數字，如 3000；終身免年費可填 0 或留空）
2. 把 repo 的 `cards-export.gs` 改動同步到 Sheets 的 Apps Script（兩邊必同步）
3. 重跑 `exportToJSON()` → 更新 `cards.data`＋`cards.version`

## 6. Phase 3（構想，未核定細節）

- 把詳情頁的個人資訊編輯搬進儀表板各 block（詳情頁改導流或保留雙入口，需問站長）。
- 「我的信用卡」modal 與儀表板的關係重整（modal 精簡或退役，需問站長）。
- `dashboardBlocks` 偏好升級 Firestore 同步。

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
