# 自動化回歸測試

把 `docs/ops/regression.md` 的 12 組檢查跑成機器比對：起本機伺服器 → headless Chromium 逐組搜尋 →
抓「卡名／回饋率／回饋金額／匹配說明／停車／領券／console error」→ 與 `baseline.json` 逐字比對。

## 用法（repo 根目錄）

```bash
npm install playwright        # 只需一次；node_modules 與 package.json 已在 .gitignore
node tools/regression/run-regression.js                   # 比對模式：差異 → exit 1
node tools/regression/run-regression.js --update-baseline # 重拍基準（只在「改動前」版本跑！）
node tools/regression/run-regression.js --update-fixture  # 重拍凍結資料（少見，時機見下）
node tools/regression/run-regression.js --live            # 用線上 cards.data 跑（資料驗證，不比對基準）
```

標準流程：**改 script.js 的計算/搜尋/顯示邏輯之前**先跑一次比對模式確認綠燈（基準有效）→ 改動 → 再跑比對模式。
改動「本來就預期改變結果」時：先確認差異報告裡的每一條都是預期內的，再 `--update-baseline` 並把新基準連同改動一起 commit。

## 退出碼

- `0` 通過；`1` 與基準有差異（報告會列出哪一組、哪張卡、基準 vs 現在）；`2` 測試框架本身出錯（環境問題，不是回歸差異）

## 環境需求與設計

- 瀏覽器：優先用預裝的 `/opt/pw-browsers/chromium`（remote session 都有）；本機沒有就退回 playwright 自帶（需 `npx playwright install chromium`）
- **完全離線（hermetic）**：Firebase SDK 被攔截替換成替身（onAuthStateChanged 回 null → 確定性訪客模式），其他外部請求（廣告/字型/analytics）全部擋掉——所以測試不需要網路、不受第三方服務影響、也不會產生真實 Firebase 流量
- 用 `?start` 跳過 landing 轉址、`?debug=1` 讓 console.error 可見；localStorage 全空 = 純訪客預設狀態

## 資料與時鐘都是凍結的（2026-09-11 改）

測試讀 `fixture.data`（凍結的 cards.data 副本），並把瀏覽器的 `Date` 固定在 `fixture.json` 的
`frozenDate`。**線上 cards.data 更新不會讓回歸變紅。**

為什麼：基準存的是「答案」，答案＝程式 × 資料 × 日期。線上資料一天更新 3–5 次，基準一天就過期
（2026-09-10 實測 6 組紅燈，0 組是程式問題），真正的回歸被埋在噪音裡。⚠️ 只凍資料不凍時鐘沒有用
——`filterExpiredRates()`／`getRateStatus()` 拿「今天」比活動期限，日期往前走活動照樣會到期。

**所以現在任何差異都代表程式行為變了**，沒有「資料漂移、重拍就好」這個選項：差異要嘛是你這次改動
的預期結果（確認後 `--update-baseline`），要嘛是回歸。

### 凍結資料什麼時候該重拍

平常不用。只有三種：① Apps Script 匯出格式改了 ② 新增了結構特殊的卡想納入覆蓋
③ 凍結資料裡的活動到期、那組檢查失去它守的機制（如 #10 的領券檔期到 2026/12/31）。

`--update-fixture` 之後**一定要接著 `--update-baseline`**；只拍其一，下次比對會示警說兩者對不上。

## 維護

- 12 組檢查的「語義」（每組在守什麼機制）定義在 `docs/ops/regression.md`；腳本裡的 `CHECKS` 陣列要與它同步
- 改這支腳本屬 maintenance.md 的 🟡 級：改完必須重做三項驗證——連跑兩次比對模式應通過（確定性）、竄改 baseline 一個數值應 exit 1（抓得到）、還原後應 exit 0
- `last-run.json` 是每次執行的完整輸出（gitignored），差異排查用
