# Pick My Card 介紹頁（Landing Page）

這個資料夾是 `pickmycard.app`（apex）的介紹頁，與工具本身完全分開部署。

## 架構

| 網址 | 內容 | Cloudflare Pages Project |
|------|------|--------------------------|
| `pickmycard.app` | 介紹頁（本資料夾） | 新 project，Root directory 設為 `landing` |
| `compare.pickmycard.app` | 工具（repo 根目錄） | 現有 project |

## Cloudflare 設定步驟（一次性）

### 第 1 步：先讓工具上 compare 子網域（這步完全不影響現有網站）

1. 進 Cloudflare Dashboard → Workers & Pages → 選現有的 pick-my-card project
2. Custom domains → Add a custom domain → 輸入 `compare.pickmycard.app`
3. Cloudflare 會自動加 DNS 紀錄，等狀態變 Active
4. 驗證：打開 `compare.pickmycard.app`，應該看到跟 `pickmycard.app` 一樣的工具

> 這時 `pickmycard.app` 和 `compare.pickmycard.app` 同時都是工具，老網址完全沒變。

### 第 2 步：建立介紹頁的新 project

1. Workers & Pages → Create → Pages → Connect to Git → 選同一個 repo（pick-my-card）
2. Project name 取名如 `pickmycard-landing`
3. Build settings：
   - Framework preset: **None**
   - Build command: 留空
   - Build output directory: **`landing`**
4. Deploy 後會得到一個 `*.pages.dev` 預覽網址
5. **先用預覽網址檢查介紹頁**，確認滿意

### 第 3 步：切換 apex（唯一會影響用戶的一步，可隨時切回）

1. 到現有工具 project → Custom domains → **移除** `pickmycard.app`
2. 到新的 landing project → Custom domains → Add → `pickmycard.app`
3. 驗證：
   - `pickmycard.app` → 介紹頁
   - `compare.pickmycard.app` → 工具
   - `pickmycard.app/faq` → 自動轉到 `compare.pickmycard.app/faq`（_redirects 處理）

> 反悔的話，把兩個 custom domain 換回來即可，幾分鐘內恢復原狀。

### 第 4 步：SEO 收尾

1. Google Search Console 新增 `compare.pickmycard.app` 資源
2. 等幾週讓 Google 重新索引；介紹頁會逐漸承接 apex 的搜尋排名

## 老用戶自動跳轉

- 工具（script.js）載入時會寫 `localStorage.pmc_visited = '1'`
- 介紹頁偵測到這個旗標就自動跳到 `compare.pickmycard.app`
- 想看介紹頁本身：用 `pickmycard.app/?home`（header logo 也連到這裡）

## 注意

- 本資料夾自給自足（圖片在 `landing/assets/`），不依賴 repo 根目錄的檔案
- 改介紹頁不會影響工具；改工具也不會影響介紹頁
