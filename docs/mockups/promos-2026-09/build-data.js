/* v4 資料推導。站長 2026-09-17 第三輪回饋：
 *  - 每檔活動都要保留自己的詳情（適用通路／達成條件／活動期間／新戶定義／備註）
 *  - 同卡多檔活動各自獨立、不相加
 *  - 沒有 slot22 ＝ 沒有國外消費回饋，整行不顯示
 *  - 分級卡取「最高級別」
 *  - Highlights 固定顯示，但跟其他活動一起排序（不再釘在最前面）
 *  - 卡片特色一律顯示商家，不顯示 category
 *  - 獎品沒有活動宣傳圖時退回卡片圖
 *  - 取消獨立的「獎品類」區（獎品活動本來就在各自卡片的堆疊裡，那一區是重複的）
 */
const fs = require('fs');
const path = require('path');
const SP = __dirname;
const { createEngine } = require(path.resolve(__dirname, '..', '..', '..', 'tools', 'lib', 'merchant-cards'));
const raw = JSON.parse(Buffer.from(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'cards.data'), 'utf8').trim(), 'base64').toString('utf8'));
const engine = createEngine(raw);
const cd = engine.__cardsData;
const byId = {}; cd.cards.forEach(c => { byId[c.id] = c; });
const TODAY = '2026-09-16';

// ---------- 標籤：一律顯示商家（items），不顯示 category ----------
// category 只在它描述「達成條件」時保留成灰色後綴——那是防止誤導的資訊
// （台新五個「切換○○刷方案」互斥，拿掉會讓五行看起來可以同時拿）。
const COND_RE = /方案|切換|任務|首次|綁定|登錄|滿額|滿千|加碼活動/;
function itemsLabel(items) {
  const a = (items || []).filter(Boolean);
  if (!a.length) return '';
  const head = a.slice(0, 2).join('、');
  return a.length > 2 ? head + '…等 ' + a.length + ' 項' : head;
}
function labelOf(rg) {
  const cat = (rg.category || '').trim();
  const label = itemsLabel(rg.items) || cat || '一般消費';
  return { label, cond: (cat && COND_RE.test(cat)) ? cat : '' };
}

function calcSlot(card, rg, lvS) {
  const p = engine.parseCashbackRate(rg.rate, card, lvS);
  return { rate: engine.getDisplayRate(card, rg, p, lvS), cap: engine.parseCashbackCap(rg.cap, card, lvS) };
}
function displayable(card) {
  return (card.cashbackRates || []).filter(rg => {
    if (rg.hideInDisplay) return false;
    const st = engine.getRateStatus(rg.periodStart, rg.periodEnd);
    if (st !== 'active' && st !== 'always') return false;
    return ![14, 21, 22].includes(rg.slot);      // 骨幹槽由固定行代表
  });
}

// ---------- 分級卡取「最高級別」----------
// ⚠️ 不能用 levelSettings 的鍵順序：實測 4 張分級卡有兩種排法——
//   玉山 Uni（簡單選→UP選）與國泰 CUBE（Level 1→3）是由低到高，
//   永豐大戶（大戶Plus 在前）與凱基誠品（黑卡在前）是由高到低。
// 所以改成實算：每個級別把所有可顯示槽位算一遍，取「最高回饋率」最大的那個級別。
function highestLevel(card) {
  if (!card.hasLevels || !card.levelSettings) return null;
  const slots = displayable(card);
  let best = null;
  Object.entries(card.levelSettings).forEach(([name, s]) => {
    const top = slots.reduce((m, rg) => Math.max(m, calcSlot(card, rg, s).rate || 0), 0);
    if (!best || top > best.top) best = { name, s, top };
  });
  return best;
}

// ---------- 固定行：國內一般消費（永遠有）／國外消費（只在 slot22 存在時）----------
function baseLines(card, lvS) {
  const find = n => (card.cashbackRates || []).find(r => r.slot === n);
  const out = [];
  const s21 = find(21), s22 = find(22);
  if (s21) { const v = calcSlot(card, s21, lvS); out.push({ label: '國內一般消費', rate: v.rate, cap: v.cap, base: true }); }
  else out.push({ label: '國內一般消費', rate: card.basicCashback, cap: null, base: true });
  // 沒有 slot22 ＝ 這張卡沒有國外消費回饋 → 整行不顯示（站長 2026-09-17 裁定，
  // 取代上一版「退回卡片級欄位推算」的做法）
  if (s22) { const v = calcSlot(card, s22, lvS); out.push({ label: '國外消費', rate: v.rate, cap: v.cap, base: true }); }
  return out;
}

// ---------- Highlights 反查 ----------
const quick = cd.quickSearchOptions || [];
function merchantKeywords(m) {
  const opt = quick.find(o => o.displayName && String(o.displayName).trim().toLowerCase() === String(m).trim().toLowerCase());
  return opt ? (opt.merchants || []) : [String(m)];
}
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

// ---------- 卡片特色 ----------
// Highlights 命中的槽「保證入列」，但跟其他槽一起依回饋率倒序——不再釘在最前面
// （站長 2026-09-17：固定顯示 ≠ 排最前面）。hype 字眼掛在該槽上。
function features(card, n) {
  const lv = highestLevel(card);
  const lvS = lv ? lv.s : null;
  const slots = displayable(card).map(rg => {
    const v = calcSlot(card, rg, lvS);
    const L = labelOf(rg);
    return { slot: rg.slot, rate: v.rate, cap: v.cap, label: L.label, cond: L.cond, items: rg.items || [] };
  }).filter(s => s.rate > 0);

  const bySlot = {}; slots.forEach(s => { bySlot[s.slot] = s; });
  const must = [];          // 保證入列的槽號
  const baseHype = {};
  const unmatched = [];     // 反查不到活動的 Highlights（只能用 sheet 的值）
  (spotByCard[card.id] || []).forEach(sp => {
    const m = String(sp.merchant).trim();
    const hit = findSlotForMerchant(slots, m);
    const hy = hypeOf(sp.description);
    if (hit) {
      hit.hype = hy;
      hit.spotMerchant = m;                     // 顯示名用 Highlights 寫的商家名
      hit.drift = Math.abs(hit.rate - Number(sp.rate)) > 0.01 ? Number(sp.rate) : null;
      must.push(hit.slot);
      return;
    }
    if (/^國內(一般)?消費$/.test(m)) { baseHype['國內一般消費'] = hy; return; }
    if (/^國外(一般|實體)?消費$/.test(m)) { baseHype['國外消費'] = hy; return; }
    unmatched.push({ label: m, rate: Number(sp.rate), cap: null, hype: hy, sheetOnly: true });
  });

  const sorted = slots.slice().sort((a, b) => b.rate - a.rate);
  const picked = [];
  const seen = new Set();
  // 先放「保證入列」的，再依序補到 n —— 但最後整份一起重排，維持回饋率倒序
  sorted.forEach(s => { if (must.includes(s.slot)) { picked.push(s); seen.add(s.slot); } });
  unmatched.forEach(u => picked.push(u));
  sorted.forEach(s => { if (picked.length >= n) return; if (seen.has(s.slot)) return; seen.add(s.slot); picked.push(s); });
  picked.sort((a, b) => b.rate - a.rate);
  // 同一張卡常有「同商家清單、同回饋率」的多個槽（中信 uniopen 的統一集團 38 項就有兩個），
  // 顯示上是同一行，去重免得看起來像重複列了一次。
  const dedup = [], sig = new Set();
  picked.forEach(x => { const k = (x.spotMerchant || x.label) + '|' + x.rate; if (sig.has(k)) return; sig.add(k); dedup.push(x); });
  picked.length = 0; picked.push(...dedup);

  const base = baseLines(card, lvS).map(b => Object.assign({}, b, baseHype[b.label] ? { hype: baseHype[b.label] } : {}));
  return {
    level: lv && lv.name,
    list: picked.slice(0, Math.max(n, must.length + unmatched.length)).map(x => ({
      rate: x.rate, cap: x.cap, label: x.spotMerchant || x.label, cond: x.cond || '',
      hype: x.hype || null, must: must.includes(x.slot) || !!x.sheetOnly, sheetOnly: !!x.sheetOnly, drift: x.drift || null
    })),
    base, totalSlots: slots.length
  };
}

// ---------- 新戶活動（每檔保留完整詳情）----------
function days(end) { return end ? Math.round((new Date(end) - new Date(TODAY)) / 86400000) : null; }
function fmtDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  const m = s.includes('-') ? s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) : null;
  if (m) return +m[1] + '/' + +m[2] + '/' + +m[3];
  const p = s.split('/');
  return p.length === 3 ? +p[0] + '/' + +p[1] + '/' + +p[2] : s;
}
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
      rate, cap, voucher: v, usage: p.voucher_usage || '',
      gift: p.gift_content || '', giftImg: p.gift_image_url || '',
      value: v != null ? v : maxBonus,
      summary: p.new_customer_summary || '',
      // ↓ 每檔活動各自的詳情（就是舊卡片那一整塊 dl）
      merchants: p.bonus_merchants || [],
      cond: p.promo_condition || '',
      periodStart: fmtDate(p.period_start), periodEnd: fmtDate(p.period_end),
      def: p.new_customer_definition || '', notes: p.notes || '',
      days: days(p.period_end)
    };
  });

const groups = {};
promos.forEach(p => { (groups[p.id] = groups[p.id] || { id: p.id, card: p.card, list: [] }).list.push(p); });
const cardGroups = Object.values(groups).map(g => {
  // 同一張卡的多檔活動各自獨立、不相加——排序只看「單檔最大值」
  g.list.sort((a, b) => (b.value == null ? -1 : b.value) - (a.value == null ? -1 : a.value));
  g.bestValue = Math.max(...g.list.map(x => x.value || 0));
  g.feat = features(byId[g.id], 5);
  return g;
}).sort((a, b) => b.bestValue - a.bestValue);

fs.writeFileSync(SP + '/data3.json', JSON.stringify({ cardGroups }, null, 1));

console.log('卡片組', cardGroups.length, '／活動', promos.length);
console.log('\n分級卡取到的級別：');
cardGroups.filter(g => g.feat.level).forEach(g => console.log('  ' + g.card + ' → ' + g.feat.level));
console.log('\n沒有國外消費行的卡：' +
  cardGroups.filter(g => !g.feat.base.some(b => b.label === '國外消費')).map(g => g.card).join('、'));
console.log('\n只有獎品、沒有現金價的卡：' +
  cardGroups.filter(g => g.bestValue === 0).map(g => g.card + '(' + g.list.length + '檔)').join('、'));
['台新 Richart 卡', '聯邦 M 卡', '滙豐 Live+ 卡', '中信 Uniopen 聯名卡'].forEach(n => {
  const g = cardGroups.find(x => x.card === n); if (!g) return;
  console.log('\n## ' + n + (g.feat.level ? '（' + g.feat.level + '）' : ''));
  g.feat.list.forEach(f => console.log('   ' + f.rate + '%\t' + f.label + (f.must ? ' ★' + (f.hype ? f.hype.label : '') : '') + (f.cond ? ' 〔' + f.cond + '〕' : '') + (f.drift ? ' (sheet ' + f.drift + '%)' : '')));
  g.feat.base.forEach(f => console.log('   = ' + f.rate + '%\t' + f.label));
});
