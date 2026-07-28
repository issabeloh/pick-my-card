#!/usr/bin/env node
// 發卡行解析安全網。為什麼存在：側欄「加入比較的卡片」的膠囊是「銀行｜卡名」
// 左右分割（js/home-ui.js populateCardChips）。銀行來源依序為
//   1. cards.data 每張卡的 bank 欄位（Google Sheets 的 bank 欄，權威來源）
//   2. js/home-ui.js 的 CARD_BANK_BY_ID_PREFIX（id 前綴對照表，相容退路）
// 兩者都對不到時，該卡會退回「單一膠囊＋完整卡名」——不會壞版面，但左側那條
// 銀行欄會缺一格，視覺上不一致。新增卡片／新發卡行時最容易發生。
//
// 本檢查把「對不到銀行的卡」列出來當警告（exit 0，不擋 commit），
// 讓人在部署前就看到，而不是等用戶回報。
//
// 用法：node tools/check-card-banks.js [cards.data 路徑，預設 repo 根目錄]
'use strict';
const fs = require('fs');
const path = require('path');

const dataPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'cards.data');
const homeUiPath = path.resolve(__dirname, '..', 'js', 'home-ui.js');

let cardsData;
try {
    const raw = fs.readFileSync(dataPath, 'utf8').trim();
    cardsData = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
} catch (e) {
    console.log(`⚠️  發卡行檢查略過：讀不到／解不開 ${dataPath}（${e.message}）`);
    process.exit(0);
}

// 從 home-ui.js 取出前綴對照表的 key（只取物件字面值裡的識別字，不執行程式碼）
let prefixes = new Set();
try {
    const src = fs.readFileSync(homeUiPath, 'utf8');
    const m = /const\s+CARD_BANK_BY_ID_PREFIX\s*=\s*\{([\s\S]*?)\}/.exec(src);
    if (m) {
        const re = /(\w+)\s*:\s*'[^']*'/g;
        let hit;
        while ((hit = re.exec(m[1])) !== null) prefixes.add(hit[1]);
    }
} catch (e) {
    console.log(`⚠️  發卡行檢查略過：讀不到 ${homeUiPath}（${e.message}）`);
    process.exit(0);
}

if (prefixes.size === 0) {
    console.log('⚠️  發卡行檢查略過：在 js/home-ui.js 找不到 CARD_BANK_BY_ID_PREFIX');
    process.exit(0);
}

const cards = Array.isArray(cardsData) ? cardsData : (cardsData && cardsData.cards) || [];
const unresolved = [];
let fromData = 0;

cards.forEach(card => {
    if (!card || !card.id) return;
    const hasBankField = typeof card.bank === 'string' && card.bank.trim();
    if (hasBankField) { fromData++; return; }
    const prefix = String(card.id).split('-')[0];
    if (!prefixes.has(prefix)) {
        unresolved.push(`${card.id}（${card.name || '?'}）→ 前綴 "${prefix}" 不在對照表`);
    }
});

if (unresolved.length > 0) {
    console.log(`⚠️  有 ${unresolved.length} 張卡對不到發卡行，側欄膠囊會退回不分割顯示：`);
    unresolved.forEach(msg => console.log('   - ' + msg));
    console.log('   修法（擇一）：Google Sheets 的 Cards 工作表補 bank 欄（建議，改字樣不必動程式）');
    console.log('             或：在 js/home-ui.js 的 CARD_BANK_BY_ID_PREFIX 補上該前綴');
} else {
    console.log(`✅ 發卡行檢查通過（${cards.length} 張卡都對得到；其中 ${fromData} 張來自 cards.data 的 bank 欄）。`);
}
process.exit(0);
