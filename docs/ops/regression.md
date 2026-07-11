# 回歸驗證清單（改 script.js 計算/搜尋/顯示邏輯後必跑）

> 2026-07-06 全站清理時的驗證方法是「12 組搜尋前後結果完全一致」，但當時的清單沒有留下來。
> 下面這份是 2026-07-11 依文件記載的特殊行為重建的**建議清單**，每一條都對應一個已知的特殊機制。
> ⚠️ 首次使用前：先在改動前的版本跑一遍，把每條的實際結果（卡名/回饋率/金額）記錄到本檔「基準快照」區，
> 之後才有得比對。**比對的判準是：改動前後結果逐字一致**（除非改動本來就預期改變該結果）。

## 怎麼跑

本機起靜態伺服器開頁面（無 build 步驟）：
```bash
python3 -m http.server 8000   # 開 http://localhost:8000（remote 環境可用預裝 Chromium + Playwright 驅動）
```
在主搜尋輸入關鍵詞＋金額（統一用 NT$30,000，除非另註），記錄前三名結果卡的「卡名／回饋率／回饋金額」。

## 清單（每條括號內＝它在守什麼機制）

| # | 搜尋詞 | 守的機制 |
|---|---|---|
| 1 | `日本`（DBS Eco 應出現） | waterfall 海外三層計算（rate>basic>overseasBonusRate）＋ levelSettings |
| 2 | `禾乃川` | DBS Eco specialItems ＋ hideInDisplay 不干擾搜尋 |
| 3 | `Apple Pay`（Sport 卡應出現，顯示 5%） | stacking（rate+basic+domesticBonusRate）加總顯示 |
| 4 | `悠遊卡自動加值`（大戶卡） | `rate` 排除型模型：溢出算 0 不是 basic |
| 5 | `meta廣告` | rate=0 stacking 槽有被匯出＋overseasCashback 特例 |
| 6 | 快捷搜尋「所有停車」 | displayParkingBenefits 收到 searchKeywords 陣列 |
| 7 | `家樂福` | 一般回饋＋停車折抵同時出現（benefits 多筆同 ID） |
| 8 | 玉山 Uni Card 相關通路（任選其 cashbackRates 內 item） | Type B 分級卡 {rate}/{cap} placeholder 解析非 0/非 NaN |
| 9 | CUBE 卡相關通路（任選 generalItems 內 item） | CUBE specialRate＋generalItems 特殊路徑 |
| 10 | 任一 couponCashbacks 商家 | coupon 搜尋＋領券溢出用 basicCashback |
| 11 | 快捷搜尋「所有加油站」 | handleQuickSearch 多關鍵詞路徑 |
| 12 | 任意不存在的商家（如 `zzz測試`） | 無匹配 fallback（buildBasicCashbackResult）不噴錯 |

另外每次都做：
- [ ] 開 `?debug=1`，console 無紅字（console.error）
- [ ] 開任一分級卡詳情頁，級別下拉可切換、各級別回饋率無 NaN
- [ ] `bash tools/preflight.sh` 通過

## 基準快照

（首次跑完填入。格式：`#N: 卡名 / 回饋率 / 金額`＋記錄日期與 cards.version 值——基準只在同一份 cards.data 下有效，cards.data 更新後基準要重拍。）

## 教訓記錄

（格式：`- [YYYY-MM-DD] 症狀 → 根因 → 新規則`）
