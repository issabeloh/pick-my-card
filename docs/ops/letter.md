# 給未來 session 的信

寫於 2026-07-11，由 Fable 5 在唯一一次立制 session 留下。你（讀這封信的模型）大概率是 Sonnet/Opus/Haiku
等級——這不是問題：這套制度的設計前提就是你。照規則走，你的產出不會輸給更大的模型；跳過規則，多大的模型都會踩一樣的坑。

## 開工順序（新 session 第一次進來）

1. CLAUDE.md 已經是路由版（78 行）——讀完它，按任務路由表讀對應領域檔，**然後才動手**
2. 回歸驗證已自動化（2026-07-12，用戶核准後由同一個立制 session 完成）：`node tools/regression/run-regression.js`，基準已拍在 `tools/regression/baseline.json`。用法與基準過期規則見 `tools/regression/README.md`
3. 這是短命容器：**每完成一個獨立單位就 commit+push**，沒 push 的工作等於沒發生

## 三件用戶沒問、但對這個環境最重要的事

### 1. ~~沒有自動化測試是這個 repo 最大的單一風險~~（✅ 已解決 2026-07-12：見 tools/regression/）

（原文說這是最大單一風險、值得一個 session 投資——用戶已核准並於 2026-07-12 完成：
`tools/regression/run-regression.js`＋`baseline.json`，做過確定性/抓差異/退出碼三向驗證。
留給你的部分：活動到期時換檢查詞並重拍基準（見 `tools/regression/README.md`）；腳本壞掉時
regression.md 有人工備援流程。）

### 2. `exportToJSON()` 不在 repo 裡（單點故障）

主匯出程式只存在 Google Sheets 的 Apps Script 專案中。後果：(a) 文件裡的匯出規則（如 data-pipeline.md
第 4 節的 rate=0 guard）無法被 code review 驗證，只能信文件；(b) Sheets 端誤改沒有版本記錄；(c) 哪天
Sheets 專案出事，匯出邏輯就消失了。**建議找機會請用戶把 Apps Script 全文貼出來**，存進 `apps-script/`
當唯讀備份（該目錄已有先例 watchlist-monitor.gs，README 也寫了「兩邊請同步」）。之後每次改匯出邏輯，
repo 副本同步更新。

### 3. 這個站有真實用戶，儲存邏輯的爆炸半徑是「別人的個人資料」

Firestore 裡是真人資料；共用電腦是真實場景（訪客 key 洩漏、登出誤刪都真實發生過）。所以
storage-and-security.md 的規則等級高於一般工程慣例：動 localStorage/Firestore/登入登出流程時，
「看起來多餘的防護」多半不是多餘的——它擋著一個文件裡只寫了一半的歷史事故。拿不準就走
judgment.md 第 3 節：問用戶，不要猜。

## 這套制度最可能的退化方式（與預防法）

1. **CLAUDE.md 再肥大化**——每個 session 都「順手」加一段，兩個月後回到 840 行。
   預防：maintenance.md 第 4 節有行數門檻（CLAUDE.md >150 行觸發精簡）；新知識的預設去處是領域檔的正文或教訓區，CLAUDE.md 只加路由列。
2. **制度變儀式**——跑了 preflight 但沒看輸出；驗收條件寫了但 ✅ 是抄的不是驗的。
   預防：所有 ✅ 都要求證據（judgment.md 第 2 節、verifier 定義）；用戶側的訊號：回報裡看不到指令輸出原文時，就該懷疑是儀式化了。
3. **規則分岔**——同一條規則被複製到多個檔案，之後只改了一份，兩份開始打架。弱模型遇到矛盾規則會隨機選一條，等於沒有規則。
   預防：maintenance.md 第 5 節「規則只住一個家」；發現矛盾時視為 P0 文件 bug：當場修（🟡 流程），不要繞過。
4. **路由被跳過**——趕時間的 session 不讀領域檔直接動手，踩了文件裡寫明的坑。
   預防：最危險的 9 條鐵則刻意留在 CLAUDE.md 本體（不依賴路由）；如果你發現自己踩的坑「文件裡其實有寫」，把這件事寫進 judgment.md 教訓區——這比修 bug 本身更有價值。
5. **對 fable 的殘留依賴**——dispatch 表或未來的筆記假設 fable 可用。
   預防：dispatch.md 已標明 fable 不可依賴；制度檔禁止寫「需要某等級模型」的能力假設（maintenance.md 第 5 節），只寫行為判準。

## 誠實條款（這套制度補不了什麼）

拆解、模板、驗證、多樣本評審能把「執行品質」補到接近大模型水準；**「模糊題的方向感」和「品味」補不了**。
遇到品味題照 judgment.md 第 6 節：給方案讓用戶選、查歷史裁決、選可逆方案並標注低信心——
**明說「這題我不擅長」是制度行為，不是能力缺陷**。另外，文件會漂移：行號、模型名、工具行為都以
「當下實際驗證」為準，文件只是起點；發現文件錯了，照 maintenance.md 🟢 流程修正它。

## 立制 session 的完成度（交接快照）

- ✅ A 診斷（diagnosis.md）、B CLAUDE.md 路由版＋5 個領域檔、C dispatch＋3 個自訂 agent、
  D judgment、E templates、F maintenance、G 本信、tools/preflight.sh（已正反向測試）
- ✅ 自動化回歸測試已建＋基準已拍（2026-07-12 用戶核准後完成，見 tools/regression/）
- 全部產出在 branch `claude/fable5-system-design-8qds6h`，逐項 commit，原 CLAUDE.md 備份於 `docs/archive/`
