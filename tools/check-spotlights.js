#!/usr/bin/env node
// 推薦活動（Highlights）選擇器安全網（2026-09-30）。為什麼存在：
// Highlights 工作表的 rate 是「選擇器」——前端用它在卡片真實資料裡挑出「哪個活動 ×
// 哪個級別」，再從那組推導上限（js/home-ui.js resolveSpotlightPick；cap/deadline 欄已刪）。
// 銀行改了回饋率、卡片資料跟著更新，推薦活動的 rate 卻沒改時，前端會對不到：
// 小卡仍顯示 sheet 的舊 rate（而且沒有上限）、ⓘ 退回第一個級別——而「獨家回饋！」
// 之類的說法可能已經不成立。這裡把對不到的列出來當警告（exit 0，不擋 commit）。
//
// 直接呼叫前端的 resolveSpotlightPick（用 tools/lib/merchant-cards.js 把 js/ 載進 vm），
// 不另寫一份比對邏輯。
//
// 用法：node tools/check-spotlights.js [cards.data 路徑，預設 repo 根目錄]
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./lib/merchant-cards');

const dataPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'cards.data');

let cardsData;
try {
    const raw = fs.readFileSync(dataPath, 'utf8').trim();
    cardsData = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
} catch (e) {
    console.log(`⚠️  推薦活動檢查略過：讀不到／解不開 ${dataPath}（${e.message}）`);
    process.exit(0);
}

const engine = createEngine(cardsData);
const cd = engine.__cardsData;
const active = (cd.spotlights || []).filter(s => s && s.active !== false && s.active !== 'FALSE');

const problems = [];
active.forEach(s => {
    const card = cd.cards.find(c => c.id === s.card_id);
    if (!card) return; // card_id 對不到由 Apps Script 匯出時的參照完整性檢查負責
    if (!engine.resolveSpotlightPick(s, card)) {
        const acts = engine.findSpotlightCardActivities(card, s.merchant);
        problems.push(`「${s.merchant}」(${s.card_id}) rate ${s.rate}%` +
            (acts.length ? `——這張卡在該通路有 ${acts.length} 個活動，但沒有任何活動／級別算出 ${s.rate}%` : '——這張卡在該通路找不到任何活動'));
    }
});

if (problems.length === 0) {
    console.log(`✅ 推薦活動檢查通過（${active.length} 則的 rate 都對得到卡片資料的活動／級別）。`);
} else {
    console.log(`⚠️  推薦活動有 ${problems.length} 則的 rate 對不到卡片資料（小卡會顯示舊 rate、不顯示上限）——請到 Highlights 工作表改 rate，或確認卡片資料是否漏更新：`);
    problems.forEach(p => console.log(`   - ${p}`));
}

// order 檢查（2026-10-11；2026-11-24 改為「置頂＋隨機」規則，只警告）：order 是選填的置頂，
// 填 1–3 的照號碼排最前面，空白／0 是正常寫法（隨機排）。只提醒兩種狀況：填了 1–3 以外的值
// （不會置頂、跟著隨機）、置頂號碼重複（同號依試算表列順序排）。規則與 js/home-ui.js
// orderSpotlights、apps-script/cards-export.gs 的 validateSpotlightOrder_ 一致，改一邊記得改另一邊。
const SPOTLIGHT_PIN_MAX = 3;
const orderWarnings = [];
const byOrder = {};
active.forEach(s => {
    const who = s.merchant || s.card_id || '(未命名)';
    if (s.order === undefined || s.order === null || s.order === '' || Number(s.order) === 0) return;
    const n = Number(s.order);
    if (!Number.isInteger(n) || n < 1 || n > SPOTLIGHT_PIN_MAX) {
        orderWarnings.push(`「${who}」的 order「${s.order}」不是 1–${SPOTLIGHT_PIN_MAX}，不會置頂、會跟著隨機排`);
        return;
    }
    (byOrder[n] = byOrder[n] || []).push(who);
});
Object.keys(byOrder).forEach(n => {
    if (byOrder[n].length > 1) orderWarnings.push(`置頂 order ${n} 重複：${byOrder[n].join('、')}（同號會依試算表列順序排）`);
});
if (orderWarnings.length > 0) {
    console.log(`⚠️  推薦活動置頂（order）有 ${orderWarnings.length} 項提醒（不影響功能）——order 只填 1–${SPOTLIGHT_PIN_MAX} 或留空，請到 Highlights 工作表調整：`);
    orderWarnings.forEach(p => console.log(`   - ${p}`));
}
