#!/usr/bin/env node
// 跨槽引用 rate_N 安全網。為什麼存在：見
// docs/project/cross-slot-ref-and-minspend-spec.md 功能一、驗收清單第 4 條。
//
// 掃 cards.data 裡每張卡 cashbackRates 的 cashbackModel 欄位，找出所有 `rate_N`
// token（N 為 1-based，對應 Sheet 的 rate_N/items_N 欄編號，見 spec「語法與語義」），
// 驗證該卡確實有第 N 槽。
// 定位方式：優先用 rateObj.slot（Sheet 真實槽號，2026-07-16 起匯出）比對存在性；
// 該卡所有槽都沒有 slot 欄（舊 cards.data）才退回陣列長度驗證。
// 引用不存在的槽（typo、槽被刪掉但 model 沒跟著改）→ exit 1 擋 commit。
//
// 用法：node tools/check-cross-slot-refs.js [cards.data 路徑，預設 repo 根目錄]
'use strict';
const fs = require('fs');
const path = require('path');

const dataPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'cards.data');

let raw;
try {
    raw = fs.readFileSync(dataPath, 'utf8').trim();
} catch (e) {
    console.error(`❌ 讀不到 ${dataPath}: ${e.message}`);
    process.exit(1);
}

let cardsData;
try {
    cardsData = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
} catch (e) {
    console.error(`❌ ${dataPath} base64/JSON 解析失敗: ${e.message}`);
    process.exit(1);
}

const cards = Array.isArray(cardsData) ? cardsData : (cardsData && cardsData.cards) || [];
const RATE_N_RE = /rate_(\d+)/g;
const problems = [];

for (const card of cards) {
    if (!card || !Array.isArray(card.cashbackRates)) continue;
    const slotCount = card.cashbackRates.length;
    // slot 定位：匯出端已加 rateObj.slot（Sheet 真實槽號，見 apps-script/cards-export.gs）。
    // 有 slot 欄就按 slot 集合驗證存在，跟引擎 resolveCrossSlotLayers/findRateGroupBySlot
    // 用同一套定位邏輯；沒有 slot 欄（舊 cards.data）就退回陣列長度驗證，行為不變。
    const hasSlotField = card.cashbackRates.some(rg => rg && rg.slot != null);
    const validSlots = hasSlotField
        ? new Set(card.cashbackRates.filter(rg => rg && rg.slot != null).map(rg => rg.slot))
        : null;
    card.cashbackRates.forEach((rateGroup, idx) => {
        const model = rateGroup && rateGroup.cashbackModel;
        if (!model || typeof model !== 'string') return;
        let m;
        RATE_N_RE.lastIndex = 0;
        while ((m = RATE_N_RE.exec(model)) !== null) {
            const n = parseInt(m[1], 10);
            const exists = hasSlotField ? validSlots.has(n) : (n >= 1 && n <= slotCount);
            if (!exists) {
                const where = hasSlotField ? `該卡 slot 只有 [${Array.from(validSlots).join(',')}]` : `該卡 cashbackRates 只有 ${slotCount} 槽`;
                problems.push(
                    `${card.id || '(no id)'} 第${idx + 1}槽（category: ${rateGroup.category || '(無)'}）` +
                    ` cashbackModel="${model}" 引用 rate_${n}，但${where}`
                );
            }
        }
    });
}

if (problems.length > 0) {
    console.error('❌ 跨槽引用 rate_N 檢查失敗（引用不存在的槽）：');
    problems.forEach(msg => console.error('   - ' + msg));
    process.exit(1);
} else {
    console.log(`✅ 跨槽引用 rate_N 檢查通過（掃了 ${cards.length} 張卡）。`);
    process.exit(0);
}
