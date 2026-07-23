#!/bin/bash
# 全 repo 安全掃描（security monitoring）。與 tools/preflight.sh 互補：
#   preflight 只掃「這次 diff 新增的行」；本腳本掃「整個 repo 的現狀」。
# 用法：bash tools/security-scan.sh
# 退出碼：0 = 通過（可能有 ⚠️ 警告）；1 = 有 ❌ 新違規，不可 commit。
#
# 規則總覽（詳細說明與維護方式見 docs/ops/security-monitoring.md）：
#   SEC1 ❌ 直接 JSON.parse(localStorage...)（鐵則 2）
#   SEC2 ❌ eval / new Function / document.write
#   SEC3 ❌ 硬編碼密鑰模式（GitHub token、AWS key、私鑰…）
#   SEC4 ❌ firestore.rules 失守（缺 default-deny、或出現 allow ... if true）
#   SEC5 ❌* innerHTML 含 ${} 插值但當行沒過 escapeHtml/sanitizeUrl（鐵則 3）
#   SEC6 ❌* 動態 href 沒過 sanitizeUrl（鐵則 3）
#   SEC7 ⚠️  target="_blank" 缺 rel="noopener"
#   SEC8 ⚠️  非 TLS 的 http:// 連結
#   （❌* = 與 tools/security-baseline.txt 比對，只有「新出現的」才擋；
#     既有已人工確認安全的條目住在 baseline，內容一變就會重新被抓）
#
# 已知侷限：SEC5/SEC6 是逐行掃描，跨多行的 template literal 內部插值掃不到——
# 那部分靠 preflight 的 innerHTML diff 警告＋人工 review 補位。
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=0
warn=0

BASELINE="tools/security-baseline.txt"
JS_GLOBS=(js/*.js faq.js landing.js promos.js)
HTML_GLOBS=(index.html faq.html landing.html promos.html merchant/*.html)

# 展開實際存在的檔案（避免 glob 落空）
JS_FILES=()
for g in "${JS_GLOBS[@]}"; do for f in $g; do [ -e "$f" ] && JS_FILES+=("$f"); done; done
HTML_FILES=()
for g in "${HTML_GLOBS[@]}"; do for f in $g; do [ -e "$f" ] && HTML_FILES+=("$f"); done; done

trim() { sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

# ---- SEC1: 直接 JSON.parse(localStorage...) ----
hits=$(grep -rn 'JSON\.parse(localStorage' "${JS_FILES[@]}" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "❌ [SEC1] 直接 JSON.parse(localStorage...)——一律改用 readLocalJSON()/readLocalJSONArray()："
  echo "$hits" | sed 's/^/     /'
  fail=1
fi

# ---- SEC2: eval / new Function / document.write ----
hits=$(grep -rnE '(^|[^A-Za-z0-9_.])eval\(|new Function\(|document\.write\(' "${JS_FILES[@]}" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "❌ [SEC2] 出現 eval/new Function/document.write（可執行任意字串，禁止）："
  echo "$hits" | sed 's/^/     /'
  fail=1
fi

# ---- SEC3: 硬編碼密鑰（掃所有 git 追蹤的文字檔；排除生成資料與圖片）----
SECRET_RE='ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY'
hits=$(git ls-files --cached --others --exclude-standard | grep -vE '^(assets/|cards\.data$|tools/security-|node_modules/)' \
       | xargs grep -lnE "$SECRET_RE" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "❌ [SEC3] 疑似硬編碼密鑰（token/key/私鑰模式）——密鑰只能放 Apps Script PropertiesService 或環境變數："
  echo "$hits" | sed 's/^/     /'
  fail=1
fi

# ---- SEC4: firestore.rules 安全不變量 ----
if [ ! -f firestore.rules ]; then
  echo "❌ [SEC4] firestore.rules 不存在（repo 版是唯一正確版本，不可刪）"; fail=1
else
  if ! grep -A3 'match /{document=\*\*}' firestore.rules | grep -q 'if false'; then
    echo "❌ [SEC4] firestore.rules 缺少 default-deny 兜底（match /{document=**} → allow: if false）"; fail=1
  fi
  if grep -qE 'allow[^;]*if[[:space:]]+true' firestore.rules; then
    echo "❌ [SEC4] firestore.rules 出現 allow ... if true（無條件開放，禁止）"; fail=1
  fi
fi

# ---- SEC5 / SEC6: baseline 比對制 ----
current=$(mktemp)

# SEC5: innerHTML/outerHTML/insertAdjacentHTML 當行含 ${ 且沒轉義
grep -rnE '(\.innerHTML[[:space:]]*\+?=|\.outerHTML[[:space:]]*=|insertAdjacentHTML)' "${JS_FILES[@]}" 2>/dev/null \
  | grep -F '${' | grep -vE 'escapeHtml|sanitizeUrl' \
  | while IFS= read -r line; do
      f="${line%%:*}"; rest="${line#*:}"; content=$(echo "${rest#*:}" | trim)
      echo "SEC5|$f|$content"
    done >> "$current"

# SEC6a: template 裡的 href="${...}" 沒過 sanitizeUrl
grep -rn 'href="\${' "${JS_FILES[@]}" 2>/dev/null | grep -v 'sanitizeUrl' \
  | while IFS= read -r line; do
      f="${line%%:*}"; rest="${line#*:}"; content=$(echo "${rest#*:}" | trim)
      echo "SEC6|$f|$content"
    done >> "$current"

# SEC6b: .href = <非字面量> 沒過 sanitizeUrl（location.href 導航除外）
grep -rnE '\.href[[:space:]]*=[[:space:]]*[^=]' "${JS_FILES[@]}" 2>/dev/null \
  | grep -vE "sanitizeUrl|location\.href|\.href[[:space:]]*=[[:space:]]*['\"\`]|\.href[[:space:]]*==" \
  | while IFS= read -r line; do
      f="${line%%:*}"; rest="${line#*:}"; content=$(echo "${rest#*:}" | trim)
      echo "SEC6|$f|$content"
    done >> "$current"

sort -u "$current" -o "$current"
baseline_entries=$(mktemp)
[ -f "$BASELINE" ] && grep -v '^#' "$BASELINE" | grep -v '^[[:space:]]*$' | sort -u > "$baseline_entries" || : > "$baseline_entries"

new_findings=$(comm -13 "$baseline_entries" "$current")
stale_entries=$(comm -23 "$baseline_entries" "$current")

if [ -n "$new_findings" ]; then
  echo "❌ [SEC5/SEC6] 新增的未轉義 innerHTML 插值／未 sanitizeUrl 的動態 href（不在 baseline）："
  echo "$new_findings" | sed 's/^/     /'
  echo "     → 修法：動態內容過 escapeHtml()、動態 href 過 sanitizeUrl()（鐵則 3）。"
  echo "     → 若人工確認確實安全（如變數已在上游轉義），把上列整行加進 $BASELINE 並附註原因。"
  fail=1
fi
if [ -n "$stale_entries" ]; then
  echo "⚠️  baseline 有過期條目（程式碼已改掉，請從 $BASELINE 移除）："
  echo "$stale_entries" | sed 's/^/     /'
  warn=1
fi
n_baseline=$(grep -c . "$baseline_entries" || true)
[ "$n_baseline" -gt 0 ] && echo "ℹ️  baseline 中有 $n_baseline 條已人工確認的既有條目（目標：逐步清零）"
rm -f "$current" "$baseline_entries"

# ---- SEC7: target="_blank" 缺 rel="noopener" ----
hits=$( { grep -rn 'target="_blank"' "${HTML_FILES[@]}" "${JS_FILES[@]}" 2>/dev/null || true; } \
       | grep -v 'noopener' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)' || true)
if [ -n "$hits" ]; then
  echo "⚠️  [SEC7] target=\"_blank\" 缺 rel=\"noopener\"（reverse tabnabbing）："
  echo "$hits" | sed 's/^/     /'
  warn=1
fi

# ---- SEC8: 非 TLS 的 http:// 連結 ----
hits=$( { grep -rnE 'http://' "${HTML_FILES[@]}" "${JS_FILES[@]}" 2>/dev/null || true; } \
       | grep -vE 'w3\.org|schema\.org|localhost|127\.0\.0\.1' || true)
if [ -n "$hits" ]; then
  echo "⚠️  [SEC8] 非 TLS 的 http:// 連結（應改 https）："
  echo "$hits" | sed 's/^/     /'
  warn=1
fi

# ---- 結果 ----
echo "---"
if [ "$fail" -ne 0 ]; then
  echo "security-scan: ❌ 未通過。修正上列 ❌ 項目（或人工確認後更新 baseline）再重跑。"
  exit 1
elif [ "$warn" -ne 0 ]; then
  echo "security-scan: ⚠️  通過但有警告，請人工確認上列項目。"
  exit 0
else
  echo "security-scan: ✅ 通過。"
  exit 0
fi
