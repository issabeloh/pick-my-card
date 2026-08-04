# 部署與 build 配額（Cloudflare Pages）

> 站台由 Cloudflare Pages 部署，專案名 `pick-my-card`，production 分支 `main`。
> 免費方案 **500 builds/月**（production 與 preview 共用同一個額度）。
> 設定位置一律在 dashboard：Workers & Pages → pick-my-card → Settings → Build。

## 1. 什麼會觸發 build

| 動作 | 是否 build |
|---|---|
| push 到 `main` | ✅ production |
| push 到 `preview/*` | ✅ preview（其他分支不會，見第 3 節）|
| commit message 帶 `[CI Skip]` | ❌ Cloudflare 認得的跳過標記 |
| 只動到 Build watch paths 排除清單內的檔案 | ❌（見第 2 節）|
| Deployments 頁按 Retry deployment | ✅ 重跑既有部署（production 的重跑就是 production）|
| Deploy hook（目前未建立）| ✅ |

**Apps Script 匯出＝剛好 1 個 build**：cards.data / promos.html / sitemap.xml / merchant 頁全部帶
`[CI Skip]`，最後一個不帶標記的 `cards.version` commit 觸發唯一一次 build，此時樹上已有本次全部檔案。
⚠️ 因此 **`cards.version` 與 `cards.data` 永遠不可進入任何排除清單**，否則匯出永遠不會上線。
商家頁數量不影響 build 數——它們是手動 commit 的靜態檔，匯出程式不碰。

## 2. Build watch paths

Include 維持 `*`（黑名單制：**未來新增的目錄預設都會觸發 build**，不會靜默漏掉）。
Exclude 放純粹不會被部署的路徑：

```
docs/*  apps-script/*  tools/*  .claude/*  .github/*
CLAUDE.md  CARDS-DATA-CACHE-README.md  FIRESTORE-RULES-README.md
FAQ-README.md  BENEFITS-AUTOMATION-PLAN.md  firestore.rules
```

- **絕不可排除**：`cards.version` `cards.data` `index.html` `js/*` `styles.css` `merchant/*`
  `sitemap.xml` `promos.*` `faq.*` `landing.*` `assets/*` `manifest.json` `robots.txt` `ads.txt`
- 跳過條件是「這次 push 動到的檔案**全部**落在排除清單」，混合 commit 照樣 build
- `tools/*` 的副作用：build command `tools/deploy-version.sh` 就在裡面，只改它不會立刻重建，
  下次 build 才生效（要立刻生效就 Retry deployment）
- 語法（dashboard 內建範例）：前綴 `apps/*`、後綴 `*/apps`、指定路徑 `blog`。`*.md` 不在官方範例內，別用

**跳過不會遺失任何東西**：Cloudflare 每次都從該 commit 的完整 repo 樹重新部署，不是增量。
被跳過的 commit 會在下一次任何 build 時一起上線。

## 3. Preview 分支策略

Branch control（Settings → Build → Branch control，**用最上方 Choose Environment 下拉切到 Preview**）：

- 2026-08-04 起：**Custom branches = `preview/*`**（先前是 All non-Production branches，
  等於每條分支的每次 push 都燒一個 build，很可能是配額的最大宗）
- 要預覽網址就把改動推成 `preview/<名字>`，網址是 `https://preview-<名字>.pick-my-card.pages.dev`
  （斜線轉 `-`）。多條分支各自用不同名字，不會互蓋
- Preview access 鎖在 Cloudflare Access 政策後面，自己看與分享給別人都要先登入
- **不需要預覽網址時，改用 session 內截圖驗證**（起本機 server + Playwright），零配額

## 4. 怎麼確認線上是哪個版本

站台的 `?v=` 就是部署當下的 commit SHA 前 12 碼（`tools/deploy-version.sh` 取 `CF_PAGES_COMMIT_SHA`）。
檢視原始碼看 `styles.css?v=xxxxxxxxxxxx`，對 `git rev-parse --short=12 origin/main`：
一致＝線上與 main 同步；不一致＝差的那幾個 commit 應該都只動到排除路徑。

## 5. 用量觀測（2026-08-04 實測）

- 匯出頻率 1–3 次/天；7 月匯出 17 次、PR merge 35 次
- production build 合理區間 52–133/月；preview 未知（dashboard 才看得到）
- 其他免費額度都不是瓶頸：Apps Script UrlFetch（每次匯出約 10–12 次呼叫 / 日配額 20,000）、
  GitHub API 5,000/hr、Pages 檔案數 123/20,000、單檔最大 1.3MB/25MB
- Firestore（Spark：50,000 讀/日）：**訪客完全不讀**，所有存取都 gate 在 `currentUser`
  （`js/auth-user-data.js:451` 等），SEO 流量不吃配額

## 教訓記錄

- [2026-08-04] 商家頁從 2 頁加到 6 頁前先問「會不會多吃 build」→ build 按部署算不按檔案算，
  且試水溫商家頁不進匯出流程 → 頁數與 build 配額無關；真正的變數是預覽分支策略與程式部署節奏
- [2026-08-04] 建議用 Retry deployment「產生預覽」被用戶糾正 → 它只是重跑既有部署，
  production 的重跑就是 production → 要預覽只能靠 preview 分支或本機/截圖，別把兩者混為一談
