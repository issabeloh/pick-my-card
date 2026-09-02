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

# ---- 1) ?v= 一律是 dev 佔位（2026-07-21 起版本號改由部署時注入，repo 不存時間戳）----
# 部署時 Cloudflare Pages build command 跑 tools/deploy-version.sh 把 dev 換成 commit hash。
# repo 裡出現非 dev 的值＝有人手動 bump（舊流程回潮）或解衝突拿錯版本，一律擋下。
# promos.html 除外：由 Apps Script 匯出生成、自帶時間戳，部署時照樣被覆寫、無害。
VER_RE='((styles|faq|landing|privacy)\.css|(script|faq|landing)\.js|js/[A-Za-z0-9_-]+\.js)\?v=[A-Za-z0-9]+'
for page in index.html faq.html landing.html privacy.html terms.html merchant/*.html; do
  [ -e "$page" ] || continue
  bad=$(grep -oE "$VER_RE" "$page" | grep -v '?v=dev$' || true)
  if [ -n "$bad" ]; then
    echo "❌ $page 的 ?v= 不是 dev 佔位（版本號由部署注入，repo 內禁寫時間戳）：$(echo $bad | head -c 200)"; fail=1
  fi
done

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

# ---- 1d) 商家頁必須與生成器輸出一致（2026-08-16 起 merchant/*.html 不再手維護）----
# 商家頁改由 tools/build-merchant-pages.js 從 index.html ＋ cards.data 生成。手改那些檔案
# 會在下次部署被覆蓋，所以這裡直接擋：改版面去改 index.html，改文案去改 MerchantPages
# 工作表（見 docs/project/data-pipeline.md 第 11 節）。
if command -v node >/dev/null 2>&1 && [ -f tools/build-merchant-pages.js ]; then
  if ! node tools/build-merchant-pages.js --check > /tmp/pmc-merchant-check.$$ 2>&1; then
    cat /tmp/pmc-merchant-check.$$
    echo "❌ merchant/*.html 與生成結果不一致——跑 node tools/build-merchant-pages.js 重新生成後再 commit"; fail=1
  fi
  rm -f /tmp/pmc-merchant-check.$$
else
  echo "⚠️  找不到 node 或生成器，略過商家頁一致性檢查"; warn=1
fi

# ---- 1e) 內部連結禁止指向 *.html（會 301 到 clean URL，GSC 報 Page with redirect）----
# Cloudflare Pages 把 /faq.html 301 到 /faq，所以站內連 faq.html 等於每次都多繞一跳：
# 浪費爬取預算、GSC「Page with redirect」報表被自家連結灌爆。一律寫 /、/faq、/promos、/landing。
# （2026-08-16 全站 66 個連結一次改完；promos.html 由 Apps Script 生成、本來就是 clean URL。）
for page in index.html faq.html landing.html privacy.html terms.html merchant/*.html; do
  [ -e "$page" ] || continue
  bad=$(grep -oE 'href="(index|faq|promos|landing)\.html[^"]*"' "$page" || true)
  if [ -n "$bad" ]; then
    echo "❌ $page 有指向 *.html 的內部連結（會 301，請改 clean URL：/ 、/faq 、/promos 、/landing）：$(echo $bad | head -c 200)"; fail=1
  fi
done

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

# ---- 4b) 發卡行解析安全網（側欄「銀行｜卡名」膠囊；對不到只警告、不擋 commit）----
if command -v node >/dev/null 2>&1 && [ -f tools/check-card-banks.js ]; then
  out=$(node tools/check-card-banks.js) || true
  echo "$out"
  case "$out" in *"⚠️"*) warn=1;; esac
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
