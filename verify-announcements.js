#!/usr/bin/env node

/**
 * Verification script to check if cards.data contains announcements
 * Usage: node verify-announcements.js
 */

const fs = require('fs');
const path = require('path');

// Read and decode cards.data
const cardsDataPath = path.join(__dirname, 'cards.data');

console.log('📂 讀取檔案:', cardsDataPath);

if (!fs.existsSync(cardsDataPath)) {
    console.error('❌ 找不到 cards.data 檔案！');
    process.exit(1);
}

const encoded = fs.readFileSync(cardsDataPath, 'utf8');
console.log('📦 檔案大小:', Math.round(encoded.length / 1024), 'KB');

try {
    // Decode Base64
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const data = JSON.parse(decoded);

    console.log('\n✅ cards.data 解碼成功！');
    console.log('\n📊 資料結構:');
    console.log('  - cards:', data.cards ? data.cards.length + ' 張' : '不存在');
    console.log('  - announcements:', data.announcements ? data.announcements.length + ' 則' : '不存在或為空');
    console.log('  - faq:', data.faq ? data.faq.length + ' 項' : '不存在');

    // Check announcements in detail
    console.log('\n📢 公告詳情:');
    if (!data.announcements) {
        console.log('  ❌ announcements 欄位不存在');
    } else if (!Array.isArray(data.announcements)) {
        console.log('  ❌ announcements 不是陣列，類型:', typeof data.announcements);
    } else if (data.announcements.length === 0) {
        console.log('  ⚠️  announcements 是空陣列');
    } else {
        console.log('  ✅ 找到', data.announcements.length, '則公告:');
        data.announcements.forEach((announcement, index) => {
            console.log(`\n  ${index + 1}. ${announcement.text || '(無文字)'}`);
            if (announcement.link) {
                console.log(`     連結: ${announcement.link}`);
            }
        });
    }

    // Show all top-level keys
    console.log('\n🔑 cards.data 包含的所有 keys:');
    console.log('  ', Object.keys(data).join(', '));

} catch (error) {
    console.error('\n❌ 解碼失敗:', error.message);
    process.exit(1);
}
