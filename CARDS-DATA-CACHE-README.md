# cards.data 快取機制 — 資料維護者必讀

## 運作原理

以前：每位使用者**每次進站**都強制重新下載整份 `cards.data`（約 485KB）。

現在：網站會先抓一個很小的 `cards.version` 檔（幾十 bytes、永遠不快取），
用裡面的版本字串當 `cards.data` 的網址參數（`cards.data?v=20260706-1`）：

- **版本沒變** → 瀏覽器直接用快取的 cards.data，幾乎零下載、載入更快
- **版本變了** → 網址變了，瀏覽器自動重新下載新資料，**立即生效**
- **cards.version 不存在/抓不到** → 自動回退成舊行為（每次重抓），功能不受影響

## ⚠️ 你要記住的唯一一件事

**每次更新 `cards.data`，同時更新 `cards.version` 的內容。**

`cards.version` 內容就是一個短字串，格式建議 `YYYYMMDD-N`（同一天第 N 次更新）：

```
20260706-1
```

只要跟上一次**不一樣**就有效（改成什麼都可以）。

### 忘記更新會怎樣？

不會壞。使用者最多延遲約 10 分鐘（GitHub Pages 的快取時效到期後，
瀏覽器會自動向伺服器確認檔案是否有變）才看到新資料。
但為了「更新立即生效」，請養成同步更新的習慣。

## 手動流程（不改 Apps Script 的最簡做法）

如果你是用 GitHub 網頁介面上傳 `cards.data`：

1. Apps Script 匯出 → 下載/複製 `cards.data` 內容
2. GitHub 上傳新的 `cards.data`
3. 順手編輯 `cards.version`，改成新的版本字串（如 `20260713-1`）→ commit

兩個檔案在同一個 commit 或前後兩個 commit 都可以，順序不拘。

## 全自動方案：Apps Script 直接推送到 GitHub（推薦，一勞永逸）

讓 Apps Script 在匯出時**直接把 `cards.data` 和 `cards.version` 一起 commit 到
GitHub repo**，完全不用再手動上傳、也不可能忘記更新版本。

### 第一步：建立 GitHub Token（一次性，約 3 分鐘）

1. 開 GitHub → 右上頭像 → **Settings** → 左側最下面 **Developer settings**
   → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. 設定：
   - **Token name**：`apps-script-cards-data`
   - **Expiration**：建議 1 年（到期要記得換新）
   - **Repository access**：選 **Only select repositories** → 勾 `pick-my-card`
   - **Permissions** → Repository permissions → **Contents** 設為 **Read and write**（其他都不用）
3. 產生後**複製 token**（只會顯示這一次）

### 第二步：把 token 存進 Apps Script（不要貼在程式碼裡！）

1. Apps Script 編輯器 → 左側齒輪「**專案設定**」→ 最下方「**指令碼屬性**」
2. 新增屬性：名稱 `GITHUB_TOKEN`，值貼上剛才的 token → 儲存

### 第三步：貼上這段程式碼（新增到 Apps Script 專案）

```javascript
// ============ GitHub 自動發布 ============
// 在 exportToJSON() 產生 cards.data 內容（base64 字串）後呼叫：
//   publishToGitHub(encodedContent);
// 會把 cards.data 與 cards.version 一起 commit 到 repo。

const GITHUB_REPO = 'issabeloh/pick-my-card';
const GITHUB_BRANCH = 'main';

function publishToGitHub(cardsDataContent) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('請先在「專案設定 → 指令碼屬性」設定 GITHUB_TOKEN');

  const version = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');

  commitFileToGitHub('cards.data', cardsDataContent, `Update cards.data (${version})`, token);
  commitFileToGitHub('cards.version', version, `Update cards.version (${version})`, token);

  return version;
}

function commitFileToGitHub(path, textContent, message, token) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json'
  };

  // 取得現有檔案的 sha（更新既有檔案時 GitHub API 必須帶上）
  let sha = null;
  const getRes = UrlFetchApp.fetch(url + '?ref=' + GITHUB_BRANCH, {
    headers: headers,
    muteHttpExceptions: true
  });
  if (getRes.getResponseCode() === 200) {
    sha = JSON.parse(getRes.getContentText()).sha;
  }

  const body = {
    message: message,
    content: Utilities.base64Encode(textContent, Utilities.Charset.UTF_8),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  const putRes = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const code = putRes.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error(`GitHub 上傳 ${path} 失敗 (HTTP ${code}): ` + putRes.getContentText());
  }
}
```

### 第四步：在 exportToJSON() 結尾接上

找到 `exportToJSON()` 裡產生最終 base64 內容（cards.data 的內容字串）的地方，
在成功訊息附近加上：

```javascript
const version = publishToGitHub(encodedContent); // encodedContent = cards.data 的 base64 字串
// 成功訊息可以順便顯示：已發布到 GitHub，版本 ${version}
```

之後每次執行匯出，就會自動在 repo 產生兩個 commit（cards.data + cards.version），
GitHub Pages 幾分鐘內部署，使用者立即拿到新資料。

### 注意事項

- **token 絕不要**貼在程式碼、工作表或任何會被看到的地方，只放在「指令碼屬性」
- token 到期後去 GitHub 重新產生一個、更新指令碼屬性即可
- 如果想先測試不影響正式站，把 `GITHUB_BRANCH` 暫時改成測試分支
