# 後端計算 API 測試說明

## 目的

測試後端計算的實際 CPU 時間，確認是否需要付費方案。

---

## API 端點

### `POST /api/calculate`

**測試用 API**：執行真實的搜尋和計算邏輯，回傳效能數據。

---

## 使用方式

### 1. 部署完成後測試

```bash
# 測試 1：搜尋「星巴克」消費 1000 元
curl -X POST https://你的網址.com/api/calculate \
  -H "Content-Type: application/json" \
  -d '{"keyword": "星巴克", "amount": 1000}'

# 測試 2：搜尋「百貨」消費 5000 元
curl -X POST https://你的網址.com/api/calculate \
  -H "Content-Type: application/json" \
  -d '{"keyword": "百貨", "amount": 5000}'

# 測試 3：搜尋「全家」消費 500 元
curl -X POST https://你的網址.com/api/calculate \
  -H "Content-Type: application/json" \
  -d '{"keyword": "全家", "amount": 500}'
```

---

## 回傳範例

```json
{
  "success": true,
  "keyword": "星巴克",
  "amount": 1000,
  "results": [
    {
      "cardId": "cathay-cube",
      "cardName": "國泰 CUBE 卡",
      "cashback": 33,
      "rate": "3.30"
    }
  ],
  "resultCount": 15,

  "performance": {
    "totalCpuTime": "8.45ms",      // ← 關鍵數據
    "totalWallTime": "12ms",
    "loadDataTime": "3.21ms",
    "searchTime": "5.24ms",
    "cardsProcessed": 120,

    "exceedsFreeLimit": false,     // ← 是否超過免費額度
    "freeLimitStatus": "✅ 在免費額度內 (剩餘 1.55ms)"
  }
}
```

---

## 判斷標準

### ✅ 免費方案可用

```json
"performance": {
  "totalCpuTime": "< 10ms",
  "exceedsFreeLimit": false
}
```

**結論**：可以使用免費方案 ✅

---

### ⚠️ 需要付費方案

```json
"performance": {
  "totalCpuTime": "> 10ms",
  "exceedsFreeLimit": true,
  "freeLimitStatus": "❌ 超過免費額度 (5.23ms over)"
}
```

**結論**：需要付費方案（$5/月）⚠️

---

## 測試項目

請測試以下關鍵字，記錄 CPU 時間：

1. **常見關鍵字**（應該最快）
   - [ ] 星巴克
   - [ ] 全家
   - [ ] 百貨

2. **熱門關鍵字**（可能較慢，匹配卡片多）
   - [ ] 餐廳
   - [ ] 外送
   - [ ] 加油

3. **冷門關鍵字**（應該快，匹配卡片少）
   - [ ] 寵物店
   - [ ] 書店

4. **極端情況**
   - [ ] 空字串（應該回傳錯誤）
   - [ ] 超長字串
   - [ ] 特殊字元

---

## 預期結果

### 樂觀預估（免費方案可用）

```
載入資料：3-5ms
搜尋計算：3-5ms
總計：6-10ms ✅
```

### 悲觀預估（需要付費）

```
載入資料：5-8ms
搜尋計算：5-15ms
總計：10-23ms ⚠️
```

---

## 下一步

### 如果在免費額度內

✅ 繼續實作完整版方案 C
✅ 不需要付費

### 如果超過免費額度

⚠️ 選擇：
1. 付費 $5/月（推薦）
2. 改用方案 A（搜尋式 API）
3. 優化程式碼（可能只省 1-2ms）

---

**建立日期**：2025-12-31
