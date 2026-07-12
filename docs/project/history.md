# 技術決策時間線（changelog）

> 只在需要「為什麼當初這樣設計」的考古時讀。日常任務讀 `docs/project/` 其他檔即可。
> 2026-07-11 之前的完整敘述見 `docs/archive/CLAUDE-2026-07-11-original.md`。
> 新條目往上加，格式：`## YYYY-MM-DD 標題` ＋ 3-6 行重點。

## 2026-07-12 快捷搜尋移除自動計算（產品決策）
- handleQuickSearch 只填入關鍵詞，計算一律由用戶按「計算」（原自動計算有 disabled 時序問題，本來就時好時壞）
- Spotlight「比較這個通路」是唯一保留自動計算的入口（用戶拍板）：由呼叫端補金額（1000）並代按計算
- 驗證：行為探測 3 場景 PASS＋回歸 12/12 與基準逐字一致

## 2026-07-12 回歸驗證自動化（Playwright）
- tools/regression/run-regression.js：hermetic 跑 12 組搜尋（Firebase 替身、外部請求全擋、訪客模式）與 baseline.json 逐字比對
- 基準綁定 cards.version；退出碼 0/1/2；正反向＋確定性驗證通過
- regression.md 改為「腳本優先、人工備援」；builder agent 驗收條款同步更新

## 2026-07-11 隱藏活動併入一般槽位（Sheet + Apps Script）
- Sheet 的 `_hide`/`_hide_1` 專用欄位組改名為一般編號槽位（rate_20/21 一帶）＋ `hideInDisplay_N=TRUE`
- Apps Script 刪除 `['_hide','_hide_1'].forEach` 特例迴圈——隱藏活動與一般活動走同一支匯出迴圈，隱藏與否純粹是資料欄位
- 對應前端 2026-07-09 的「隱藏活動無專屬邏輯」原則，匯出端也歸一

## 2026-07-11 Fable 5 立制 session
- CLAUDE.md 改為路由版；細節抽到 docs/project/*；制度檔進 docs/ops/*；新增 tools/preflight.sh
- 新增 .claude/agents/ 自訂 subagent（scout/builder/verifier）

## 2026-07-09 詳情頁逐筆顯示 + rate=0 匯出 guard 修正
- 詳情頁不再按 rate+cap 合併活動，逐筆顯示（renderCashbackRatesIndividually）；rate_hide 覆寫移除
- 發現並修正匯出迴圈 `if (rate && items)` 把 rate=0 stacking 槽整組丟掉的 bug（見 data-pipeline.md 第 4 節）

## 2026-07-07 「我的信用卡」modal 重造 + 我的額度
- 錢包堆疊一覽 → 原位展開 → 單卡頁（唯讀個人化面板）；視覺多輪迭代定案（見 ui-display.md 第 5 節）
- 新增 creditLimit（詳情頁編輯、Firestore users/{uid}.creditLimits 同步）；卡圖規範 800×500

## 2026-07-06 全站清理（資料穩定性/安全/速度/整併）
- localStorage 安全讀取 helpers＋自我修復；級別 key 改 uid 區分；登入合併統一「靜默補位」；登出清理
- XSS 修復＋sanitizeUrl()＋firestore.rules 進 repo；cards.version 快取；正式環境 console 靜音（?debug=1）
- 整併：mergeResultsByActivity（原 4 份）、buildBasicCashbackResult（原 2 份）、extractPlaceholderField（原 3 份）、parseCashbackRate 改同步、刪 6 個死函數
- 回歸驗證：12 組搜尋前後結果完全一致

## 2026-07-01 cashbackModel 資料驅動計算模型
- 新增 cashbackModel_N 欄位；分隔符號決定引擎（+ = stacking、> = waterfall、rate = 排除型）
- 新增 calculateStackedCashback()；移除 3 處國家關鍵字清單，海外改由 overseasBonusRate 明確指定
- 空 cashbackModel = 原行為，對現有資料零影響

## 2026-05-31 詳情頁入口 + 卡片圖片資產 + Spotlight 視覺定稿
- 選卡 modals 加 ⓘ peek button；body scroll lock 改 refcount；卡圖慣例 assets/images/cards/<id>.png
- Spotlight 改全寬橫帶、固定卡高、category 紫 chip、ⓘ modal 只留「馬上辦卡」CTA

## 2026-05-27 新增精選活動（Spotlight）
- Highlights 工作表 → spotlights；輪播每頁 3 張 6 秒；ⓘ modal 顯示卡片真實活動

## 2026-01-24 停車折抵快捷搜尋修復 + ReferralLinks
- displayParkingBenefits() 加 searchKeywords 參數（否則快捷搜尋用顯示名稱匹配必失敗）

## 2026-01-01 Placeholder 擴展支援任意欄位
- parseCashbackRate 用正則匹配任意 {欄位名}；解決永豐大戶卡 NaN% 問題

## 2025-12-22 分層回饋計算 + 三項性能優化 + bug 修復
- calculateLayeredCashback（DBS Eco 三層）；搜尋索引 O(1)、日期快取、DocumentFragment（1.2-2.5s → 0.2-0.7s）
- coupon 搜尋支援；即將開始活動排序修復

## 2024-12 早期定型
- {cap} placeholder；級別回饋率移到選擇器旁；CUBE 用 specialRate；Uni Card 可折疊條件；DBS Eco 佈局；空 specialItems 修復
