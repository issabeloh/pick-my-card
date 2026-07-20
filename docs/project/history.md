# 技術決策時間線（changelog）

> 只在需要「為什麼當初這樣設計」的考古時讀。日常任務讀 `docs/project/` 其他檔即可。
> 2026-07-11 之前的完整敘述見 `docs/archive/CLAUDE-2026-07-11-original.md`。
> 新條目往上加，格式：`## YYYY-MM-DD 標題` ＋ 3-6 行重點。

## 2026-07-20 方向裁決三題（站長委託「品味/方向裁決清倉」；判例，站長可否決）
- **商家 SEO 落地頁**：不再手動加頁。蝦皮/momo 兩頁在 Search Console 蹲滿 4–6 週後，任一頁有自然流量訊號（如週曝光 >100，或任何非品牌關鍵字點擊）才值得移植 generateMerchantPageHtml_ 生成器擴大到 top-N；兩頁皆無訊號則從 sitemap 移除、收掉此方向。理由：每頁都是手抄件、加重三邊同步負擔，值不值得該由數據裁決而非猜
- **權益自動化非 MVP 項**（BENEFITS-AUTOMATION-PLAN 第 3–5 項）：比對引擎＋「一鍵套用」**預設不做**——自動寫入 Cards Data 的爆炸半徑是全站資料事故，換到的只是每週幾分鐘的搬運。重啟條件：待審核表→正式表的人工搬運連續一個月每週實測 >30 分鐘；屆時也必須先有寫入前逐格 diff 預覽。權益/領券 GEM 遷移等新戶活動這條線跑穩一個月再議
- **header 三邊手抄件**（index/faq/promos）：維持手抄，不引入 build/組件系統——「無 build 步驟」是本專案的結構性選擇，不用全局複雜度換局部方便。可接受的緩解：未來讓 preflight 機械比對三邊 header 結構
- 通則：每條判例都附**可驗證的重啟條件**——條件成立時回來重審不算「重開已裁決的品味題」（judgment.md 第 6 節），是照判準執行

## 2026-07-20 script.js 拆分為 js/ 12 模組檔（省 token＋可管理性，站長核准）
- 純前綴切割搬移、內容零改寫：12 檔依載入順序 concat 的 sha256 與原 script.js 逐位一致（8e2b2583…）後才加各檔頭註解
- 保持傳統全域 script 多標籤依序載入（defer），**禁止改 ES module**——inline onclick 依賴全域函數、type="module" 會變更時序與作用域
- 載入順序＝依賴順序：載入期跨檔依賴只有 window.toggleMerchants/toggleConditions 賦值（與定義同檔）；其餘跨檔呼叫都在事件/DOMContentLoaded 之後，DOM ready 時 12 檔已全數載入
- 消費者三頁：index.html＋merchant/*.html（`<base href="/">` 共用根目錄 js/）；update-version.sh 從此連 merchant 頁一起 bump（模組版本必須 lockstep），preflight 新增規則 1c 查覆蓋與順序一致
- 每階段（P1–P5）獨立 commit＋preflight＋regression 12/12 綠；分支 claude/script-js-modularization-czrvtu

## 2026-07-12 getOverflowRate 移除 meta/google 廣告寫死特例
- 舊特例：簡單路徑溢出遇 meta/google 廣告通路改用 overseasCashback（台新 Richart 除外）——用通路名稱判斷海外的 cashbackModel 前遺物
- 全部 21 個廣告槽位已改明確 stacking model（rate=0），不再進簡單路徑，特例成死碼 → 刪除，溢出一律 basicCashback
- 自此海外與否唯一由 cashbackModel 決定，前端不認任何通路名稱

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
