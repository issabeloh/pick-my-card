#!/bin/bash
# 部署時注入 ?v= 快取版本號（取代 2026-07-21 前的 ./update-version.sh 手動 bump 流程）。
#
# repo 裡所有本站 .css/.js 引用一律寫 `?v=dev` 佔位；Cloudflare Pages 的
# build command 設為 `bash tools/deploy-version.sh`，部署時把佔位換成 commit hash。
# 這讓 ?v= 徹底離開版控——多分支併行時不再產生版本號 merge 衝突。
#
# 用法：bash tools/deploy-version.sh [版本字串]
#   無參數（部署）：CF_PAGES_COMMIT_SHA（CF Pages 內建環境變數）→ git short sha → 時間戳
#   有參數（本機）：注入指定字串；`bash tools/deploy-version.sh dev` 可還原佔位
#
# 涵蓋：根目錄與 merchant/ 的所有 *.html 裡本站 .css/.js 的 ?v=；
# 圖片等資產引用（.png?v= 等）刻意不動。promos.html 由 Apps Script 匯出生成、
# 自帶時間戳版本——本腳本照樣覆寫，部署後以 commit 版本為準，匯出端不需配合。
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [ -z "$VERSION" ] && [ -n "${CF_PAGES_COMMIT_SHA:-}" ]; then
  VERSION="${CF_PAGES_COMMIT_SHA:0:12}"
fi
if [ -z "$VERSION" ]; then
  VERSION=$(git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M%S)
fi

count=0
for page in *.html merchant/*.html; do
  [ -e "$page" ] || continue
  sed -i.bak -E "s/((styles|faq|landing|promos)\.css|(script|faq|landing|promos)\.js|js\/[A-Za-z0-9_-]+\.js)\?v=[A-Za-z0-9]+/\1?v=$VERSION/g" "$page"
  rm -f "$page.bak"
  count=$((count+1))
done

echo "✅ ?v= 版本已注入：$VERSION（$count 個 HTML）"
