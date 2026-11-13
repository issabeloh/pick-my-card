#!/usr/bin/env bash
# NCCC 小額支付平台通路名單更新（2026-11-13）
#
# 做什麼：看聯卡中心來源頁寫的「截至○年○月○日」，跟 data/nccc/source.json 記的不一樣才下載新名單，
# 轉成 UTF-8 覆寫 data/nccc/merchants.csv、更新 source.json，再跑 tools/build-nccc-brands.js 重算品牌清單。
# 日期沒變就什麼都不動（每週排程多半是這個結果）。
#
# 用法（repo 根目錄）：
#   bash tools/nccc-refresh.sh            # 日期變了才更新
#   bash tools/nccc-refresh.sh --force    # 不管日期，重新下載
# 由 .github/workflows/nccc-refresh.yml 每週執行；有更新時它會開 PR，不會直接進 main。
# 本機也能跑（需要 curl、iconv、node；網路要連得到 www.nccc.com.tw）。
#
# 安全網——任何一條不過就中止、不改檔案（寧可這週沒更新，也不要把壞資料送上線）：
#   ・來源頁找不到「截至」日期（頁面改版）
#   ・名單下載失敗、表頭不對、列數不到上一版的七成（下載到一半、或對方換了檔案格式）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
BASE='https://www.nccc.com.tw/wps/wcm/connect'
PAGE_URL="$BASE/zh/home/BusinessOperations/CardBusiness/MicroPayment"
CSV_URL="$BASE/ed441cc0-d955-42ee-8e12-c85c78470993/SMALL_TICKET_PLATFORM_MERCHANTS.CSV?MOD=AJPERES"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
REPORT="${NCCC_REPORT_FILE:-$TMP/report.md}"

out() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi; }

# ---- 1) 來源頁的「截至」日期 ----
curl -sS -L --fail -m 60 --retry 3 --retry-delay 10 -A "$UA" -o "$TMP/page.html" "$PAGE_URL"
label=$(grep -o '小額支付平台通路名單下載([^)]*)' "$TMP/page.html" | head -1 || true)
roc=$(echo "$label" | sed -nE 's/.*截至([0-9]{2,3})年([0-9]{1,2})月([0-9]{1,2})日.*/\1 \2 \3/p')
if [ -z "$roc" ]; then
  echo "❌ 來源頁找不到「小額支付平台通路名單下載(截至○年○月○日)」——頁面可能改版，請人工看一下：$PAGE_URL"
  exit 1
fi
read -r ry rm rd <<< "$roc"
as_of=$(printf '%04d-%02d-%02d' $((10#$ry + 1911)) $((10#$rm)) $((10#$rd)))
as_of_label="${ry}年${rm}月${rd}日"
current=$(node -p "require('./data/nccc/source.json').asOf")
prev_rows=$(node -p "require('./data/nccc/source.json').rows || 0")
echo "來源頁：截至 $as_of_label（$as_of）；repo 目前：$current"

if [ "$as_of" = "$current" ] && [ "$FORCE" = "0" ]; then
  echo "✅ 日期沒變，不用更新"
  out "changed=false"
  exit 0
fi

# ---- 2) 下載名單、轉碼、檢查 ----
curl -sS -L --fail -m 180 --retry 3 --retry-delay 10 -A "$UA" -D "$TMP/headers.txt" -o "$TMP/list.big5.csv" "$CSV_URL"
# 原檔是 Big5（含香港增補字與少數造字）；-c 丟掉轉不出來的造字，跟第一版入庫時同一種轉法
iconv -f BIG5-HKSCS -t UTF-8 -c "$TMP/list.big5.csv" > "$TMP/merchants.csv"
if ! head -1 "$TMP/merchants.csv" | grep -q '^特店代號,登記名稱,對外名稱,'; then
  echo "❌ 下載到的檔案表頭不對（不是通路名單，或欄位改了）"; exit 1
fi
rows=$(($(grep -c . "$TMP/merchants.csv") - 1))
if [ "$rows" -lt $((prev_rows * 7 / 10)) ]; then
  echo "❌ 新名單只有 $rows 列，不到上一版（$prev_rows 列）的七成——可能沒下載完整，中止"; exit 1
fi
etag=$(grep -i '^etag:' "$TMP/headers.txt" | tail -1 | sed -E 's/^[^:]*:[[:space:]]*//; s/[^A-Za-z0-9_.-]//g' || true)

# ---- 3) 寫回 repo、重算品牌清單 ----
cp data/nccc/summary.json "$TMP/summary.old.json"
cp "$TMP/merchants.csv" data/nccc/merchants.csv
AS_OF="$as_of" AS_OF_LABEL="$as_of_label" ETAG="$etag" ROWS="$rows" node -e '
  const fs = require("fs");
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);   // 台北日期
  fs.writeFileSync("data/nccc/source.json", JSON.stringify({
    asOf: process.env.AS_OF, asOfLabel: process.env.AS_OF_LABEL, etag: process.env.ETAG,
    downloadedAt: today, rows: Number(process.env.ROWS)
  }, null, 2) + "\n");
'
node tools/build-nccc-brands.js
node tools/build-nccc-brands.js --report "$TMP/summary.old.json" > "$REPORT"
echo "---"; cat "$REPORT"

out "changed=true"
out "as_of=$as_of"
