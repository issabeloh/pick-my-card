#!/usr/bin/env node
/* ============================================================
 * cards.data 兩版比對（2026-09-09 新增）
 *
 * 為什麼存在：每次從 Google Sheets 重新匯出之後，「這次到底改到了什麼」只能靠記憶或
 * 肉眼掃試算表。尤其在「用 Apps Script 自動寫回正式表」之後——程式聲稱只動了
 * registerLink_N，但站長沒有辦法自己驗證那句話。這支就是那個驗證：解碼兩版 cards.data、
 * 逐欄位比對，把「哪張卡的哪個欄位從什麼變成什麼」全部列出來。
 *
 * 用法：
 *   node tools/cards-data-diff.js                    # 上一個 commit 的 cards.data vs 工作目錄現況
 *   node tools/cards-data-diff.js HEAD~3             # 指定基準 commit
 *   node tools/cards-data-diff.js HEAD~3 HEAD        # 指定兩個 commit
 *   node tools/cards-data-diff.js --fields           # 只列「哪些欄位有變」的統計，不列每一筆
 *
 * 判讀：
 *   ・只看到 registerLink → 這次匯出只動了登錄連結，符合預期
 *   ・看到 rate / cap / items / cashbackModel 有變而你沒改過那些 → 停下來查清楚
 * ============================================================ */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const fieldsOnly = argv.includes('--fields');
const revs = argv.filter(a => !a.startsWith('--'));
const oldRev = revs[0] || 'HEAD';
const newRev = revs[1] || null;   // null = 工作目錄現況

function load(rev) {
  const raw = rev
    ? execSync(`git show ${rev}:cards.data`, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString()
    : fs.readFileSync(path.join(REPO, 'cards.data'), 'utf8');
  return JSON.parse(Buffer.from(raw.trim(), 'base64').toString('utf8'));
}

// 把一張卡攤平成 { 路徑: 值 }，路徑用槽位編號而不是陣列索引——
// 槽位順序變動時才不會整批誤報成「全部都改了」
function flattenCard(card) {
  const out = {};
  Object.keys(card).forEach(k => {
    if (k === 'cashbackRates' || k === 'couponCashbacks' || k === 'changelog') return;
    out[k] = JSON.stringify(card[k]);
  });
  (card.cashbackRates || []).forEach(r => {
    const slot = r.slot != null ? r.slot : '?';
    Object.keys(r).forEach(k => { if (k !== 'slot') out[`rate[${slot}].${k}`] = JSON.stringify(r[k]); });
  });
  (card.couponCashbacks || []).forEach((c, i) => {
    Object.keys(c).forEach(k => { out[`coupon[${c.merchant || i}].${k}`] = JSON.stringify(c[k]); });
  });
  (card.changelog || []).forEach((e, i) => {
    out[`changelog[${i}]`] = JSON.stringify(e);
  });
  return out;
}

const a = load(oldRev);
const b = load(newRev);
const aCards = Object.fromEntries((a.cards || []).map(c => [c.id, c]));
const bCards = Object.fromEntries((b.cards || []).map(c => [c.id, c]));

const changes = [];   // { cardId, field, from, to }
const added = [], removed = [];

Object.keys(bCards).forEach(id => { if (!aCards[id]) added.push(id); });
Object.keys(aCards).forEach(id => { if (!bCards[id]) removed.push(id); });

Object.keys(bCards).forEach(id => {
  if (!aCards[id]) return;
  const fa = flattenCard(aCards[id]), fb = flattenCard(bCards[id]);
  new Set([...Object.keys(fa), ...Object.keys(fb)]).forEach(k => {
    if (fa[k] !== fb[k]) changes.push({ cardId: id, field: k, from: fa[k], to: fb[k] });
  });
});

// 頂層 key（bankColors、spotlights、faq…）
const topChanges = [];
new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => {
  if (k === 'cards' || k === 'lastUpdated') return;
  if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) topChanges.push(k);
});

const trunc = (s, n) => { s = String(s == null ? '(無)' : s); return s.length > n ? s.slice(0, n) + '…' : s; };

console.log(`比對：${oldRev}  →  ${newRev || '工作目錄現況'}`);
console.log(`  ${oldRev} 的 cards.version 對應 lastUpdated=${a.lastUpdated}，新版 lastUpdated=${b.lastUpdated}`);
console.log('');

if (added.length) console.log(`➕ 新增卡片（${added.length}）：${added.join('、')}`);
if (removed.length) console.log(`➖ 移除卡片（${removed.length}）：${removed.join('、')}`);

// 依「欄位種類」統計——這是判讀的主要依據
const byField = {};
changes.forEach(c => {
  const kind = c.field.replace(/^rate\[[^\]]*\]\./, 'rate[N].')
                      .replace(/^coupon\[[^\]]*\]\./, 'coupon[N].')
                      .replace(/^changelog\[\d+\]$/, 'changelog[N]');
  (byField[kind] = byField[kind] || []).push(c);
});
const kinds = Object.keys(byField).sort((x, y) => byField[y].length - byField[x].length);

if (kinds.length === 0 && topChanges.length === 0 && !added.length && !removed.length) {
  console.log('✅ 兩版完全相同（除了 lastUpdated）。');
  process.exit(0);
}

console.log(`📋 有變動的欄位種類（共 ${changes.length} 筆）：`);
kinds.forEach(k => console.log(`   ${String(byField[k].length).padStart(4)} 筆  ${k}`));
if (topChanges.length) console.log(`\n📋 有變動的頂層資料：${topChanges.join('、')}`);

if (!fieldsOnly) {
  console.log('\n────── 逐筆明細 ──────');
  kinds.forEach(k => {
    console.log(`\n【${k}】`);
    byField[k].forEach(c => {
      console.log(`  ${c.cardId}  ${c.field}`);
      console.log(`     舊: ${trunc(c.from, 110)}`);
      console.log(`     新: ${trunc(c.to, 110)}`);
    });
  });
}
