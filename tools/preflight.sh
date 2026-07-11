#!/bin/bash
# 部署前機械檢查。為什麼存在：見 docs/ops/diagnosis.md「第 3 名」。
# 用法：bash tools/preflight.sh   （比較 工作目錄+索引 vs HEAD，改完、commit 前跑）
# 退出碼：0 = 通過（可能有 ⚠️ 警告，需人工確認）；1 = 有 ❌ 違規，不可 commit。
set -u
fail=0
warn=0

cd "$(git rev-parse --show-toplevel)" || exit 1
changed=$(git diff HEAD --name-only)

has() { echo "$changed" | grep -qx "$1"; }

# ---- 1) script.js / styles.css 改動 → index.html 的 ?v= 必須 bump 且兩行一致 ----
if has script.js || has styles.css; then
  v_css=$(grep -o 'styles\.css?v=[0-9]*' index.html | head -1 | grep -o '[0-9]*$')
  v_js=$(grep -o 'script\.js?v=[0-9]*' index.html | head -1 | grep -o '[0-9]*$')
  old_js=$(git show HEAD:index.html | grep -o 'script\.js?v=[0-9]*' | head -1 | grep -o '[0-9]*$')
  if [ -z "$v_css" ] || [ -z "$v_js" ]; then
    echo "❌ index.html 找不到 styles.css?v= 或 script.js?v= 引用行"; fail=1
  elif [ "$v_css" != "$v_js" ]; then
    echo "❌ index.html 的 styles.css?v=$v_css 與 script.js?v=$v_js 不一致（必須同值）"; fail=1
  elif [ "$v_js" = "$old_js" ]; then
    echo "❌ script.js/styles.css 有改動，但 index.html 的 ?v= 仍是 $v_js（沒 bump）。跑 ./update-version.sh 後重試"; fail=1
  fi
fi

# ---- 1b) styles.css / faq.js 改動 → faq.html 的 ?v= 也要 bump ----
if has styles.css || has faq.js; then
  new_faq=$(grep -o 'faq\.js?v=[0-9]*' faq.html | head -1 | grep -o '[0-9]*$')
  old_faq=$(git show HEAD:faq.html | grep -o 'faq\.js?v=[0-9]*' | head -1 | grep -o '[0-9]*$')
  new_fcss=$(grep -o 'styles\.css?v=[0-9]*' faq.html | head -1 | grep -o '[0-9]*$')
  old_fcss=$(git show HEAD:faq.html | grep -o 'styles\.css?v=[0-9]*' | head -1 | grep -o '[0-9]*$')
  if has faq.js && [ "$new_faq" = "$old_faq" ]; then
    echo "❌ faq.js 有改動，但 faq.html 的 faq.js?v= 沒 bump（faq.html 不歸 update-version.sh 管，要手動改）"; fail=1
  fi
  if has styles.css && [ "$new_fcss" = "$old_fcss" ]; then
    echo "❌ styles.css 有改動，但 faq.html 的 styles.css?v= 沒 bump（要手動改）"; fail=1
  fi
fi

# ---- 2) cards.data 改動 → cards.version 必須同步更新 ----
if has cards.data && ! has cards.version; then
  echo "❌ cards.data 有改動但 cards.version 沒更新（改成任何不同短字串，建議 YYYYMMDD-N；見 CARDS-DATA-CACHE-README.md）"; fail=1
fi

# ---- 3) 禁用/危險模式（只掃「新增」的行） ----
added=$(git diff HEAD -- script.js faq.js landing.js | grep '^+' | grep -v '^+++')
if echo "$added" | grep -q 'JSON\.parse(localStorage'; then
  echo "❌ 新增程式碼直接 JSON.parse(localStorage...)——一律改用 readLocalJSON()/readLocalJSONArray()（CLAUDE.md 鐵則）"; fail=1
fi
if echo "$added" | grep -q 'saveCardLevel('; then
  echo "⚠️  新增了 saveCardLevel() 呼叫——唯二合法場景（用戶親自點選／大小寫空格正規化）見 CLAUDE.md 鐵則，請逐一人工確認"; warn=1
fi
if echo "$added" | grep -q '\.innerHTML'; then
  echo "⚠️  新增了 innerHTML 寫入——動態內容必須先過 escapeHtml()/escapeHtmlMultiline()，href 過 sanitizeUrl()，請人工確認"; warn=1
fi
if echo "$added" | grep -qE 'console\.(log|warn)'; then
  echo "⚠️  新增了 console.log/warn——正式環境會被靜音；錯誤處理應改用 console.error"; warn=1
fi

# ---- 結果 ----
echo "---"
if [ "$fail" -ne 0 ]; then
  echo "preflight: ❌ 未通過。修正上列項目後重跑。"
  exit 1
elif [ "$warn" -ne 0 ]; then
  echo "preflight: ⚠️  通過但有警告。回報時必須附上本輸出並逐條說明已人工確認。"
  exit 0
else
  echo "preflight: ✅ 通過。"
  exit 0
fi
