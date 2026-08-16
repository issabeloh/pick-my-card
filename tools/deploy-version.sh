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

# 商家落地頁：每次部署從 index.html ＋ cards.data 重新生成（2026-08-16 起，見
# tools/build-merchant-pages.js）。一定要在注入 ?v= 之前跑——生成出來的頁帶的是
# index.html 的 `?v=dev` 佔位，靠下面那圈迴圈一起換成 commit hash。
#
# 失敗就讓整個 build 掛掉是刻意的：商家頁的病就是「沒人發現它過期」，
# 這裡吞掉錯誤等於把病放回去。Apps Script 匯出的 commit 不跑 preflight，
# 這一步是 cards.data 更新後唯一會重算卡片清單的地方。
# 本機想跳過（例如只想還原 ?v= 佔位）：PMC_SKIP_MERCHANT_BUILD=1 bash tools/deploy-version.sh dev
if [ "${PMC_SKIP_MERCHANT_BUILD:-0}" != "1" ]; then
  if command -v node >/dev/null 2>&1; then
    node tools/build-merchant-pages.js
  else
    echo "❌ 找不到 node，無法生成商家頁（部署環境必須有 node）" >&2
    exit 1
  fi
fi

count=0
for page in *.html merchant/*.html; do
  [ -e "$page" ] || continue
  sed -i.bak -E "s/((styles|faq|landing|promos)\.css|(script|faq|landing|promos)\.js|js\/[A-Za-z0-9_-]+\.js)\?v=[A-Za-z0-9]+/\1?v=$VERSION/g" "$page"
  rm -f "$page.bak"
  count=$((count+1))
done

echo "✅ ?v= 版本已注入：$VERSION（$count 個 HTML）"
