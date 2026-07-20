#!/bin/bash
# 自動更新 index.html 與 merchant/*.html 中的版本號為當前時間戳。
# 涵蓋範圍：styles.css、script.js、js/*.js 的 ?v=（.png?v= 等資產引用不動）。
# 2026-07-20 起 merchant/*.html 一併 bump——模組拆分後各模組檔版本必須 lockstep，
# 避免瀏覽器混用新舊版本的不同模組檔。

# 生成時間戳版本號 (格式: YYYYMMDDHHmmss)
NEW_VERSION=$(date +%Y%m%d%H%M%S)

for page in index.html merchant/*.html; do
  [ -e "$page" ] || continue
  sed -i.bak -E "s/(styles\.css|script\.js|js\/[A-Za-z0-9_-]+\.js)\?v=[0-9]+/\1?v=$NEW_VERSION/g" "$page"
  rm -f "$page.bak"
done

echo "✅ 版本號已更新為: $NEW_VERSION（index.html + merchant/*.html）"
echo "請檢查變更並提交"
