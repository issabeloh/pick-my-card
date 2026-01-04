# Rate Limiting 設定說明

## 為什麼需要 Rate Limiting？

後端 API 需要 Rate Limiting 來防止濫用和惡意攻擊，同時不影響正常用戶使用。

### 受保護的 API 端點

1. **`/api/calculate`** - 回饋計算 API
2. **`/api/get-cards-data`** - 卡片資料 API（新增）

## 建議配置

### `/api/calculate` - 計算 API

**選項 C：平衡方案**（已選擇）
- **每分鐘 50 次** 請求
- **每小時 200 次** 請求
- **每日 500 次** 請求

這個配置：
- ✅ 不影響正常用戶（日常 80-200 人，峰值 10,000+ 人）
- ✅ 防止單一 IP 惡意濫用
- ✅ 允許正常的重複搜尋

### `/api/get-cards-data` - 資料載入 API

**限制較寬鬆**（因為每個用戶只在載入頁面時呼叫一次）
- **每分鐘 10 次** 請求
- **每小時 30 次** 請求
- **每日 100 次** 請求

這個配置：
- ✅ 正常用戶足夠（一般不會頻繁重新整理）
- ✅ 防止批量下載資料
- ✅ 允許開發和測試

---

## Cloudflare Dashboard 配置步驟

### 方法 1: Cloudflare Rate Limiting Rules（推薦）

1. 登入 Cloudflare Dashboard
2. 選擇你的網站 `pickmycard.app`
3. 前往 **Security** → **WAF** → **Rate limiting rules**
4. 點擊 **Create rule**

#### Rule 1: 每分鐘限制

```
Rule name: API Rate Limit - Per Minute
If incoming requests match:
  - Field: URI Path
  - Operator: equals
  - Value: /api/calculate

When rate exceeds:
  - Requests: 50
  - Period: 1 minute
  - With the same: IP address

Then:
  - Action: Block
  - Duration: 1 minute
```

#### Rule 2: 每小時限制

```
Rule name: API Rate Limit - Per Hour
If incoming requests match:
  - Field: URI Path
  - Operator: equals
  - Value: /api/calculate

When rate exceeds:
  - Requests: 200
  - Period: 1 hour
  - With the same: IP address

Then:
  - Action: Block
  - Duration: 1 hour
```

#### Rule 3: 每日限制

```
Rule name: API Rate Limit - Per Day
If incoming requests match:
  - Field: URI Path
  - Operator: equals
  - Value: /api/calculate

When rate exceeds:
  - Requests: 500
  - Period: 1 day
  - With the same: IP address

Then:
  - Action: Block
  - Duration: 1 day
```

---

#### Rule 4: 資料載入 API - 每分鐘限制

```
Rule name: Get Cards Data - Per Minute
If incoming requests match:
  - Field: URI Path
  - Operator: equals
  - Value: /api/get-cards-data

When rate exceeds:
  - Requests: 10
  - Period: 1 minute
  - With the same: IP address

Then:
  - Action: Block
  - Duration: 1 minute
```

#### Rule 5: 資料載入 API - 每小時限制

```
Rule name: Get Cards Data - Per Hour
If incoming requests match:
  - Field: URI Path
  - Operator: equals
  - Value: /api/get-cards-data

When rate exceeds:
  - Requests: 30
  - Period: 1 hour
  - With the same: IP address

Then:
  - Action: Block
  - Duration: 1 hour
```

#### Rule 6: 資料載入 API - 每日限制

```
Rule name: Get Cards Data - Per Day
If incoming requests match:
  - Field: URI Path
  - Operator: equals
  - Value: /api/get-cards-data

When rate exceeds:
  - Requests: 100
  - Period: 1 day
  - With the same: IP address

Then:
  - Action: Block
  - Duration: 1 day
```

---

### 方法 2: Transform Rules（進階，無額外費用）

如果你的方案沒有 Rate Limiting Rules，可以使用 Transform Rules + Workers：

1. 前往 **Rules** → **Transform Rules**
2. 使用 HTTP Request Header Modification 來追蹤請求

**注意**：這個方法需要額外的 Workers 邏輯，較複雜。

---

## 費用說明

### Free Plan
- ❌ 不包含 Rate Limiting Rules
- ✅ 可以使用基本的 Firewall Rules（有限制）

### Pro Plan ($20/月)
- ✅ 包含 10 個 Rate Limiting Rules
- ✅ 推薦用於生產環境

### 替代方案（如果不想付費）

如果使用 Free Plan，可以：
1. 依賴 Cloudflare 的自動 DDoS 保護
2. 監控 Analytics，發現異常流量時手動封鎖 IP
3. 使用更嚴格的 Origin Checking（已在 `calculate.js` 中實作）

---

## 目前已實作的安全措施

✅ **CORS 限制**
```javascript
'Access-Control-Allow-Origin': 'https://pickmycard.app'
```

✅ **Origin 驗證**
```javascript
const allowedOrigins = [
  'https://pickmycard.app',
  'https://www.pickmycard.app'
];
```

✅ **開發環境支援**
- 自動允許 `localhost`、`127.0.0.1`、`pages.dev`

✅ **只回傳搜尋結果**
- 不洩漏完整卡片資料
- 不洩漏計算邏輯

⚠️ **Rate Limiting** (需在 Cloudflare Dashboard 配置)

---

## 測試 Rate Limiting

設定完成後，可以用以下指令測試：

```bash
# 測試單次請求
curl -X POST https://pickmycard.app/api/calculate \
  -H "Content-Type: application/json" \
  -d '{"keyword": "星巴克", "amount": 1000}'

# 測試超過限制（快速連續 60 次請求）
for i in {1..60}; do
  curl -X POST https://pickmycard.app/api/calculate \
    -H "Content-Type: application/json" \
    -d '{"keyword": "星巴克", "amount": 1000}'
  echo "Request $i"
done
```

預期結果：
- 前 50 次：正常回傳結果
- 第 51 次開始：回傳 429 Too Many Requests

---

## 監控和調整

### 查看 API 使用情況

1. 前往 **Analytics** → **Traffic**
2. 篩選 `/api/calculate`
3. 查看：
   - 請求總數
   - 唯一 IP 數量
   - 錯誤率

### 調整限制

如果發現：
- **正常用戶被限制** → 提高限制（例如：每分鐘 100 次）
- **仍有異常流量** → 降低限制（例如：每分鐘 30 次）

---

## 緊急措施

如果發現大量異常請求：

1. **臨時封鎖**
   - Security → Firewall → Firewall Rules
   - 封鎖可疑 IP 或 User-Agent

2. **啟用 Bot Fight Mode**
   - Security → Bots
   - 開啟 Bot Fight Mode（Free Plan 可用）

3. **檢查 Analytics**
   - 查看異常流量來源
   - 分析攻擊模式

---

**建立日期**：2026-01-02
**適用網站**：https://pickmycard.app/
