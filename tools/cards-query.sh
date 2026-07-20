#!/bin/bash
# cards.data 查詢工具：解碼到暫存檔後跑 jq，取代手工 base64 -d ＋ jq 組合，
# 並杜絕「直接 Read cards.data」（488KB base64 單行，讀入即塞爆上下文）。
#
# 用法：bash tools/cards-query.sh '<jq 運算式>' [額外 jq 參數...]
# 例：  bash tools/cards-query.sh '.cards | length'
#       bash tools/cards-query.sh '.cards[] | select(.name | contains("CUBE")) | {id, name}'
#       bash tools/cards-query.sh -r '.lastUpdated' 之類的 jq 參數放在運算式前面也可以：
#       bash tools/cards-query.sh '.lastUpdated' -r
# 頂層鍵：cards / benefits / spotlights / newCardholderPromos / faq / announcements 等，
# 全清單可跑：bash tools/cards-query.sh 'keys'
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "用法：bash tools/cards-query.sh '<jq 運算式>' [額外 jq 參數...]" >&2
  exit 2
fi

# 第一個「不是 - 開頭」的參數當運算式，其餘原樣轉給 jq（讓 -r 等參數放前放後都行）
EXPR=""
ARGS=()
for a in "$@"; do
  if [ -z "$EXPR" ] && [ "${a:0:1}" != "-" ]; then
    EXPR="$a"
  else
    ARGS+=("$a")
  fi
done
if [ -z "$EXPR" ]; then
  echo "錯誤：找不到 jq 運算式（不能全是 - 開頭的參數）" >&2
  exit 2
fi

OUT="${TMPDIR:-/tmp}/cards-decoded.json"
# cards.data 比快取新（或快取不存在）才重新解碼
if [ ! -f "$OUT" ] || [ cards.data -nt "$OUT" ]; then
  base64 -d cards.data > "$OUT"
fi

RESULT="$(jq ${ARGS[@]+"${ARGS[@]}"} "$EXPR" "$OUT")"
LINES="$(printf '%s\n' "$RESULT" | wc -l)"
if [ "$LINES" -gt 120 ]; then
  printf '%s\n' "$RESULT" | head -100
  echo "…（共 ${LINES} 行，已截斷為前 100 行——請縮小 jq 運算式；完整解碼檔在 $OUT）"
else
  printf '%s\n' "$RESULT"
fi
