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

# ---- 1) script.js / styles.css / js/*.js 改動 → index.html 的 ?v= 必須 bump 且全部一致 ----
# ?v= 引用的抓取範圍：styles.css、script.js、js/*.js（.png?v= 等資產不管）
VER_RE='(styles\.css|script\.js|js/[A-Za-z0-9_-]+\.js)\?v=[0-9]+'
core_changed=$(echo "$changed" | grep -E '^(script\.js|styles\.css|js/[A-Za-z0-9_-]+\.js)$' || true)
if [ -n "$core_changed" ]; then
  vers=$(grep -oE "$VER_RE" index.html | grep -oE '[0-9]+$' | sort -u)
  n_vers=$(echo "$vers" | grep -c . || true)
  old_vers=$(git show HEAD:index.html | grep -oE "$VER_RE" | grep -oE '[0-9]+$' | sort -u | tail -1)
  if [ "$n_vers" -eq 0 ]; then
    echo "❌ index.html 找不到任何 styles.css/script.js/js/*.js 的 ?v= 引用行"; fail=1
  elif [ "$n_vers" -gt 1 ]; then
    echo "❌ index.html 的 ?v= 版本號不一致（必須全部同值）：$(echo $vers)"; fail=1
  elif [ "$vers" = "$old_vers" ]; then
    echo "❌ js/css 有改動，但 index.html 的 ?v= 仍是 $vers（沒 bump）。跑 ./update-version.sh 後重試"; fail=1
  fi
fi

# ---- 1c) 模組檔覆蓋與載入順序（?v= 快取機制必須涵蓋所有 js/ 模組檔）----
# a. repo 裡每個 js/*.js 都要被 index.html 以 <script src="js/xxx.js?v=..."> 引用
# b. merchant/*.html 的模組載入清單與「順序」必須和 index.html 完全一致
#    （傳統全域 script 靠載入順序滿足依賴，順序錯＝載入期 ReferenceError）
if compgen -G "js/*.js" > /dev/null; then
  for f in js/*.js; do
    if ! grep -q "src=\"$f?v=" index.html; then
      echo "❌ index.html 缺少 <script src=\"$f?v=...\">（新模組檔沒掛進 ?v= 快取機制）"; fail=1
    fi
  done
fi
seq_index=$(grep -oE 'src="(js/[A-Za-z0-9_-]+\.js|script\.js)\?v=' index.html | sed 's/^src="//;s/?v=$//')
for page in merchant/*.html; do
  [ -e "$page" ] || continue
  seq_page=$(grep -oE 'src="(js/[A-Za-z0-9_-]+\.js|script\.js)\?v=' "$page" | sed 's/^src="//;s/?v=$//')
  if [ "$seq_page" != "$seq_index" ]; then
    echo "❌ $page 的 script 載入清單/順序與 index.html 不一致（必須完全相同）"; fail=1
  fi
done

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
added=$(git diff HEAD -- script.js 'js/*.js' faq.js landing.js | grep '^+' | grep -v '^+++')
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

# ---- 4) 跨槽引用 rate_N 安全網（cashbackModel 引用不存在的槽 → 擋 commit）----
# 見 docs/project/cross-slot-ref-and-minspend-spec.md 功能一、驗收清單第 4 條。
if command -v node >/dev/null 2>&1; then
  if ! node tools/check-cross-slot-refs.js; then
    fail=1
  fi
else
  echo "⚠️  找不到 node，略過跨槽引用 rate_N 檢查（cards.data 若改了 cashbackModel 請自行確認 rate_N 沒指到不存在的槽）"; warn=1
fi

# ---- 5) 全 repo 安全掃描（規則見 docs/ops/security-monitoring.md）----
# preflight 第 3 節只掃 diff 新增行；這裡補掃整個 repo 現狀（XSS/密鑰/firestore.rules）。
if [ -f tools/security-scan.sh ]; then
  if ! bash tools/security-scan.sh; then
    fail=1
  fi
else
  echo "⚠️  找不到 tools/security-scan.sh，略過全 repo 安全掃描"; warn=1
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
