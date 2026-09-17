#!/usr/bin/env node
/* ============================================================
 * 「卡片特色」區塊的資料推導（2026-09-17 提案 v2 的參考實作，非正式工具）
 *
 * 這支就是提案「方案甲」的演算法本體，mockups.html 裡看到的每一行都由它算出來：
 *   1. 回饋率一律走主站自己的 getDisplayRate()（照 tools/lib/merchant-cards.js
 *      的成例把 js/ 載進 vm），不另寫一套，數字不會跟畫面分岔
 *   2. 標籤規則：category 命中條件詞（方案/切換/任務/首次/綁定/登錄/滿額/滿千）
 *      → 改用 items 當標籤、category 降級成條件後綴。台新 Richart 卡就是靠這條救回來的
 *   3. 固定兩行「國內一般消費／國外消費」直接讀骨幹槽 slot 21／22
 *      （slot21 覆蓋 23/23、slot22 只有 15/23，缺的退回卡片級欄位推算）
 *   4. Highlights（推薦活動）命中的通路釘選在最前面並帶 hype 字眼；
 *      回饋率一律反查真活動，不採用 sheet 手打的值
 *
 * 用法：node docs/mockups/promos-2026-09/build-data.js
 *       （會在同目錄寫出 data2.json，那是衍生檔、不進版控）
 * ============================================================ */
const fs = require('fs');
const SP = __dirname;
const { createEngine } = require(require('path').resolve(__dirname, '..', '..', '..', 'tools', 'lib', 'merchant-cards'));
const raw = JSON.parse(Buffer.from(fs.readFileSync(require('path').resolve(__dirname, '..', '..', '..', 'cards.data'), 'utf8').trim(), 'base64').toString('utf8'));
const engine = createEngine(raw);
const cd = engine.__cardsData;
const byId = {}; cd.cards.forEach(c => { byId[c.id] = c; });
const TODAY = '2026-09-16';

// ---------- 標籤規則：category 是「條件」而不是「通路」時改用 items ----------
const COND_RE = /方案|切換|任務|首次|綁定|登錄|滿額|滿千|加碼活動|特列項目/;
function itemsLabel(items) {
  const a = (items || []).filter(Boolean);
  if (!a.length) return '';
  const head = a.slice(0, 2).join('、');
  return a.length > 2 ? head + '…等 ' + a.length + ' 項' : head;
}
function labelOf(rg) {
  const cat = (rg.category || '').trim();
  const items = itemsLabel(rg.items);
  if (cat && !COND_RE.test(cat)) return { label: cat, cond: '' };
  if (items) return { label: items, cond: cat && COND_RE.test(cat) ? cat : '' };
  return { label: cat || '一般消費', cond: '' };
}

function firstLevel(c) {
  if (!c.hasLevels || !c.levelSettings) return null;
  const k = Object.keys(c.levelSettings)[0];
  return { name: k, s: c.levelSettings[k] };
}
function calcSlot(card, rg, lvS) {
  const p = engine.parseCashbackRate(rg.rate, card, lvS);
  return { rate: engine.getDisplayRate(card, rg, p, lvS), cap: engine.parseCashbackCap(rg.cap, card, lvS) };
}

// ---------- 固定兩行：國內一般消費 / 國外消費（讀骨幹槽 21/22）----------
function baseLines(card) {
  const lv = firstLevel(card), lvS = lv ? lv.s : null;
  const find = n => (card.cashbackRates || []).find(r => r.slot === n);
  const out = [];
  const s21 = find(21), s22 = find(22);
  if (s21) { const v = calcSlot(card, s21, lvS); out.push({ label: '國內一般消費', rate: v.rate, cap: v.cap, base: true, src: 'slot21' }); }
  else out.push({ label: '國內一般消費', rate: card.basicCashback, cap: null, base: true, src: '卡片級欄位' });
  if (s22) { const v = calcSlot(card, s22, lvS); out.push({ label: '國外消費', rate: v.rate, cap: v.cap, base: true, src: 'slot22' }); }
  else {
    const r = (card.overseasCashback || card.basicCashback) + (card.overseasBonusRate || 0);
    out.push({ label: '國外消費', rate: Math.round(r * 100) / 100, cap: card.overseasBonusCap || null, base: true, src: '卡片級欄位（缺 slot22）', fallback: true });
  }
  return out;
}

// ---------- 可顯示槽位 ----------
function slotsOf(card) {
  const lv = firstLevel(card), lvS = lv ? lv.s : null;
  const out = [];
  (card.cashbackRates || []).forEach(rg => {
    if (rg.hideInDisplay) return;
    const st = engine.getRateStatus(rg.periodStart, rg.periodEnd);
    if (st !== 'active' && st !== 'always') return;
    if ([14, 21, 22].includes(rg.slot)) return;          // 骨幹槽已由固定兩行代表
    const v = calcSlot(card, rg, lvS);
    if (!(v.rate > 0)) return;
    const L = labelOf(rg);
    out.push({ slot: rg.slot, rate: v.rate, cap: v.cap, label: L.label, cond: L.cond, items: rg.items || [], rawCategory: rg.category || '' });
  });
  return { level: lv && lv.name, slots: out };
}

// ---------- Highlights 反查真活動（含快捷搜尋 displayName 展開）----------
const quick = cd.quickSearchOptions || [];
function merchantKeywords(m) {
  const opt = quick.find(o => o.displayName && String(o.displayName).trim().toLowerCase() === String(m).trim().toLowerCase());
  return opt ? (opt.merchants || []) : [String(m)];
}
// ⚠️ 一卡一通路可能命中多組活動（uniopen 夢時代實測 4 組）。期限那條既有規則取「最早到期」，
// 但回饋率的宣稱本來就是「最高」，所以這裡取命中組裡回饋率最高的那一組。
function findSlotForMerchant(slots, merchant) {
  const kws = merchantKeywords(merchant).map(s => String(s).toLowerCase());
  let hits = slots.filter(s => s.items.some(i => kws.includes(String(i).toLowerCase())));
  if (!hits.length) hits = slots.filter(s => s.items.some(i => kws.some(k => String(i).toLowerCase().includes(k) || k.includes(String(i).toLowerCase()))));
  if (!hits.length) return null;
  return hits.slice().sort((a, b) => b.rate - a.rate)[0];
}
const HYPE = { '全場最高': 'top', '壓倒性神卡': 'god', '獨家回饋': 'excl', '無腦刷': 'easy' };
function hypeOf(desc) { const m = /^(.+?)[！!]/.exec(desc || ''); return (m && HYPE[m[1]]) ? { label: m[1], cls: HYPE[m[1]] } : null; }
const spotByCard = {};
(cd.spotlights || []).forEach(s => { if (s.active === false) return; (spotByCard[s.card_id] = spotByCard[s.card_id] || []).push(s); });

// ---------- 卡片特色（Highlights 必列 ＋ 自動補；固定兩行永遠在最後）----------
function features(card, n) {
  const { level, slots } = slotsOf(card);
  const spots = spotByCard[card.id] || [];
  const out = [], usedSlots = new Set(), usedLabels = new Set();
  const baseHype = {};
  spots.forEach(sp => {
    // Highlights 的 merchant 就是「國內消費／國外消費」時，不另開一列——那跟固定兩行是同一件事，
    // 只把 hype 字眼掛到對應的固定行上（永豐大戶卡「無腦刷！國內5%」實測會撞）。
    const m = String(sp.merchant).trim();
    const hit = findSlotForMerchant(slots, m);
    // 只有「反查不到任何指定通路槽」時才折進固定兩行——有對到槽就照常釘選。
    // （中信 uniopen 的「國外實體消費」對得到 11% 的加碼槽，折進 3% 的固定行會直接講錯數字。）
    if (!hit && /^國內(一般)?消費$/.test(m)) { baseHype['國內一般消費'] = hypeOf(sp.description); usedLabels.add(m); return; }
    if (!hit && /^國外(一般|實體)?消費$/.test(m)) { baseHype['國外消費'] = hypeOf(sp.description); usedLabels.add(m); return; }
    out.push({
      label: m, rate: hit ? hit.rate : Number(sp.rate), cap: hit ? hit.cap : null,
      cond: hit ? hit.cond : '', hype: hypeOf(sp.description), pinned: true,
      matched: !!hit, sheetRate: Number(sp.rate),
      drift: hit ? (Math.abs(hit.rate - Number(sp.rate)) > 0.01) : null
    });
    if (hit) { usedSlots.add(hit.slot); usedLabels.add(hit.label); }
    usedLabels.add(m);
  });
  slots.slice().sort((a, b) => b.rate - a.rate).forEach(s => {
    if (out.length >= n) return;
    if (usedSlots.has(s.slot) || usedLabels.has(s.label)) return;
    usedLabels.add(s.label);
    out.push(Object.assign({}, s, { pinned: false }));
  });
  const base = baseLines(card).map(b => Object.assign({}, b, baseHype[b.label] ? { hype: baseHype[b.label] } : {}));
  return { level, list: out.slice(0, n), base, totalSlots: slots.length };
}

// ---------- 新戶活動（依卡片分組）----------
function days(end) { return end ? Math.round((new Date(end) - new Date(TODAY)) / 86400000) : null; }
const promos = (cd.newCardholderPromos || [])
  .filter(p => !p.period_end || String(p.period_end) >= TODAY)
  .filter(p => (p.promo_types || []).length || p.voucher_amount != null || p.bonus_rate != null || p.gift_content)
  .map(p => {
    const rate = (typeof p.bonus_rate === 'number') ? (p.bonus_rate <= 1 ? p.bonus_rate * 100 : p.bonus_rate) : null;
    const cap = (typeof p.bonus_cap === 'number') ? Math.round(p.bonus_cap) : null;
    const maxBonus = (rate != null && cap != null) ? Math.round(rate / 100 * cap) : null;
    const v = (typeof p.voucher_amount === 'number') ? p.voucher_amount : null;
    return {
      id: p.id, card: (byId[p.id] || {}).name || p.id, types: p.promo_types || [],
      rate, cap, maxBonus, voucher: v, usage: p.voucher_usage || '',
      gift: p.gift_content || '', giftImg: p.gift_image_url || '',
      merchants: p.bonus_merchants || [], end: p.period_end || '', days: days(p.period_end),
      value: v != null ? v : maxBonus, summary: p.new_customer_summary || '', cond: p.promo_condition || ''
    };
  });

const groups = {};
promos.forEach(p => { (groups[p.id] = groups[p.id] || { id: p.id, card: p.card, list: [] }).list.push(p); });
const cardGroups = Object.values(groups).map(g => {
  g.list.sort((a, b) => (b.value == null ? -1 : b.value) - (a.value == null ? -1 : a.value));
  g.best = g.list[0];
  g.bestValue = Math.max(...g.list.map(x => x.value || 0));
  g.feat = features(byId[g.id], 5);
  return g;
}).sort((a, b) => b.bestValue - a.bestValue);

// 純獎品組（沒有任何現金價的活動）
const giftPromos = promos.filter(p => p.value == null && p.gift);

fs.writeFileSync(SP + '/data2.json', JSON.stringify({ cardGroups, giftPromos }, null, 1));

console.log('卡片組', cardGroups.length);
cardGroups.slice(0, 6).forEach(g => {
  console.log('\n## ' + g.card + '  最高 NT$' + g.bestValue + '  ' + g.list.length + ' 檔');
  g.list.forEach(p => console.log('   ' + (p.value == null ? '獎品' : 'NT$' + p.value) + '\t' + p.types.join('+') + '\t' + (p.summary || p.gift.split('\n')[0]).slice(0, 34)));
  console.log('   -- 卡片特色（' + (g.feat.level ? '以「' + g.feat.level + '」計，' : '') + g.feat.totalSlots + ' 槽）');
  g.feat.list.forEach(f => console.log('      ' + f.rate + '%\t' + f.label + (f.pinned ? ' ★' + (f.hype ? f.hype.label : '') + (f.matched ? '' : '(未對到活動,用sheet值)') : '') + (f.cond ? '  〔' + f.cond + '〕' : '')));
  g.feat.base.forEach(f => console.log('      ' + f.rate + '%\t' + f.label + '  (' + f.src + ')'));
});
