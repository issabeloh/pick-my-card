#!/usr/bin/env node
/* ============================================================
 * /promos 改版提案的取證腳本（2026-09-16，一次性，非正式工具）
 *
 * 用途：回答「把每張卡最高回饋的 N 個常態活動自動列出來，做得到嗎？容易出錯嗎？」
 * 做法：照 tools/lib/merchant-cards.js 的成例，把 js/ 那 12 支模組載進 Node 的 vm，
 *       直接呼叫主站自己的 getDisplayRate() / parseCashbackRate() / parseCashbackCap()，
 *       不另寫一套回饋率邏輯（另寫一套遲早跟畫面分岔——見 cashback-engine.md 第 6 節
 *       「三處實作必須一致」那段警告）。
 *
 * 用法：node docs/mockups/promos-2026-09/probe-highlights.js
 *
 * 2026-09-16 實跑結論（提案頁的數字都出自這裡）：
 *  - 數字可靠：跟主站搜尋結果同一支函數，stacking 加總／跨槽引用／級別 placeholder 都一致
 *  - 選題不可靠：純照回饋率排序，中信 LINE Pay 卡第一名是「10% 撥撥貓砂官網」；
 *    台新 Richart 卡 18 個槽全是互斥的「切換○○刷方案」，並排列出會誤導
 *  - 標籤不可靠：23 張促銷卡的 158 個可顯示槽位只有 61% 填了 category，
 *    沒填就退回前兩個 item 名（聯邦 M 卡 4 槽全空）
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const { createEngine } = require(path.join(REPO, 'tools', 'lib', 'merchant-cards'));

const raw = JSON.parse(Buffer.from(fs.readFileSync(path.join(REPO, 'cards.data'), 'utf8').trim(), 'base64').toString('utf8'));
const engine = createEngine(raw);
const cd = engine.__cardsData;
const byId = {};
cd.cards.forEach(c => { byId[c.id] = c; });

// 骨幹槽（slot 14/21/22，見 cashbackmodel-fill-guide.md 第 4 節）：category 是內部字樣
// （「一般回饋特列項目」「國外消費特列項目」），不該直接當賣點標籤上畫面。
const BACKBONE = { 14: true, 21: true, 22: true };

// hasLevels 卡取第一個級別——沿用 spotlight modal 的既有慣例。
// ⚠️ 這是提案裡列出的待裁決事項之一：永豐大戶卡第一級是「大戶Plus等級」，
// 顯示 6% 對大多數人是拿不到的數字。
function firstLevel(card) {
  if (!card.hasLevels || !card.levelSettings) return null;
  const k = Object.keys(card.levelSettings)[0];
  return { name: k, settings: card.levelSettings[k] };
}

function displayableSlots(card) {
  const lv = firstLevel(card);
  const lvS = lv ? lv.settings : null;
  const out = [];
  (card.cashbackRates || []).forEach(rg => {
    if (rg.hideInDisplay) return;
    const status = engine.getRateStatus(rg.periodStart, rg.periodEnd);
    if (status !== 'active' && status !== 'always') return;
    const parsed = engine.parseCashbackRate(rg.rate, card, lvS);
    const rate = engine.getDisplayRate(card, rg, parsed, lvS);   // ← 主站同一支
    const cap = engine.parseCashbackCap(rg.cap, card, lvS);
    if (!(rate > 0)) return;
    out.push({
      slot: rg.slot,
      rate,
      cap,
      label: rg.category || (rg.items || []).slice(0, 2).join('、') || '一般消費',
      hasCategory: !!(rg.category && String(rg.category).trim()),
      itemCount: (rg.items || []).length,
      backbone: !!BACKBONE[rg.slot],
      model: rg.cashbackModel || ''
    });
  });
  return { level: lv && lv.name, slots: out };
}

const TODAY = engine.getTaiwanToday ? engine.getTaiwanToday() : new Date().toISOString().slice(0, 10);
const promoCardIds = [...new Set(
  (cd.newCardholderPromos || [])
    .filter(p => !p.period_end || String(p.period_end) >= TODAY)
    .map(p => p.id)
)];

const spotByCard = {};
(cd.spotlights || []).forEach(s => {
  if (s.active === false) return;
  (spotByCard[s.card_id] = spotByCard[s.card_id] || []).push(s);
});

let totalSlots = 0, withCategory = 0;
console.log('今天（台北）：' + TODAY + '／有未過期新戶活動的卡片：' + promoCardIds.length + ' 張\n');

promoCardIds.forEach(id => {
  const card = byId[id];
  if (!card) { console.log('⚠️ ' + id + '：newCardholderPromos 有這個 id，cards 裡找不到'); return; }
  const { level, slots } = displayableSlots(card);
  totalSlots += slots.length;
  withCategory += slots.filter(s => s.hasCategory).length;

  const top = slots.slice().sort((a, b) => b.rate - a.rate).slice(0, 5);
  const spots = spotByCard[id] || [];
  console.log('== ' + card.name + ' [' + id + ']' + (level ? '（以「' + level + '」計）' : '') +
    '　基本 ' + card.basicCashback + '%　可顯示槽位 ' + slots.length);
  top.forEach(s => {
    console.log('   ' + String(s.rate + '%').padEnd(7) +
      (s.cap == null ? '無上限' : '上限消費 NT$' + Math.round(s.cap).toLocaleString('en-US')).padEnd(22) +
      s.label + '　(' + s.itemCount + ' 項, slot' + s.slot + (s.hasCategory ? '' : ', category 空') + (s.backbone ? ', 骨幹槽' : '') + ')');
  });
  spots.forEach(s => console.log('   ★ Highlights 人工策展：' + s.rate + '% ' + s.merchant + '　' + String(s.description || '').slice(0, 24)));
  console.log('');
});

console.log('--- category 填寫率：' + withCategory + '/' + totalSlots +
  ' = ' + (withCategory / totalSlots * 100).toFixed(0) + '%（沒填就會退回 item 名當標籤）');
console.log('--- Highlights 覆蓋率：' +
  promoCardIds.filter(id => spotByCard[id]).length + '/' + promoCardIds.length + ' 張促銷卡');
