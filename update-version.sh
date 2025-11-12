#!/bin/bash
# 自動更新 index.html 中的版本號為當前時間戳

# 生成時間戳版本號 (格式: YYYYMMDDHHmmss)
NEW_VERSION=$(date +%Y%m%d%H%M%S)

# 使用 sed 更新 index.html 中的版本號
sed -i.bak "s/styles\.css?v=[0-9]\+/styles.css?v=$NEW_VERSION/g" index.html
sed -i.bak "s/script\.js?v=[0-9]\+/script.js?v=$NEW_VERSION/g" index.html

# 刪除備份文件
rm -f index.html.bak

echo "✅ 版本號已更新為: $NEW_VERSION"
echo "請檢查 index.html 並提交變更"
