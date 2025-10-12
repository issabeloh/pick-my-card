// Generate cards.data from cards.json
const fs = require('fs');

// Read cards.json
const cardsJson = fs.readFileSync('cards.json', 'utf8');

// Encode: JSON -> Base64 -> URI encode
const base64 = Buffer.from(cardsJson, 'utf8').toString('base64');

// Write to cards.data
fs.writeFileSync('cards.data', base64, 'utf8');

console.log('✅ cards.data 已生成');
console.log(`📊 原始大小: ${cardsJson.length} bytes`);
console.log(`📦 編碼後大小: ${base64.length} bytes`);
