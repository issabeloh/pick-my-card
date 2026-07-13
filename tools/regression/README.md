# 自動化回歸測試

把 `docs/ops/regression.md` 的 12 組檢查跑成機器比對：起本機伺服器 → headless Chromium 逐組搜尋 →
抓「卡名／回饋率／回饋金額／匹配說明／停車／領券／console error」→ 與 `baseline.json` 逐字比對。

## 用法（repo 根目錄）

```bash
npm install playwright        # 只需一次；node_modules 與 package.json 已在 .gitignore
node tools/regression/run-regression.js                   # 比對模式：差異 → exit 1
node tools/regression/run-regression.js --update-baseline # 重拍基準（只在「改動前」版本跑！）
```

標準流程：**改 script.js 的計算/搜尋/顯示邏輯之前**先跑一次比對模式確認綠燈（基準有效）→ 改動 → 再跑比對模式。
改動「本來就預期改變結果」時：先確認差異報告裡的每一條都是預期內的，再 `--update-baseline` 並把新基準連同改動一起 commit。

## 退出碼

- `0` 通過；`1` 與基準有差異（報告會列出哪一組、哪張卡、基準 vs 現在）；`2` 測試框架本身出錯（環境問題，不是回歸差異）

## 環境需求與設計

- 瀏覽器：優先用預裝的 `/opt/pw-browsers/chromium`（remote session 都有）；本機沒有就退回 playwright 自帶（需 `npx playwright install chromium`）
- **完全離線（hermetic）**：Firebase SDK 被攔截替換成替身（onAuthStateChanged 回 null → 確定性訪客模式），其他外部請求（廣告/字型/analytics）全部擋掉——所以測試不需要網路、不受第三方服務影響、也不會產生真實 Firebase 流量
- 用 `?start` 跳過 landing 轉址、`?debug=1` 讓 console.error 可見；localStorage 全空 = 純訪客預設狀態

## 基準（baseline.json）什麼時候會「合理地」過期

1. **cards.data 更新**：活動資料變了，結果本來就會變。比對模式會警告 cards.version 不一致。確認新資料正確後重拍基準
2. **日期前進、活動到期**：例如檢查 #10 用的領券檔期到 2026/12/31，到期後該組會少一筆券——這是產品正確行為，換一個還在檔期的商家（改 run-regression.js 的 CHECKS）再重拍
3. 上述以外的差異（尤其 cards.version 一致時）＝很可能是真的回歸，先當 bug 查

## 維護

- 12 組檢查的「語義」（每組在守什麼機制）定義在 `docs/ops/regression.md`；腳本裡的 `CHECKS` 陣列要與它同步
- 改這支腳本屬 maintenance.md 的 🟡 級：改完必須重做三項驗證——連跑兩次比對模式應通過（確定性）、竄改 baseline 一個數值應 exit 1（抓得到）、還原後應 exit 0
- `last-run.json` 是每次執行的完整輸出（gitignored），差異排查用
