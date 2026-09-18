#!/usr/bin/env node
/* ============================================================
 * 「卡片特色」區塊注入器（2026-09-17）
 *
 * 為什麼是部署時注入、而不是 Apps Script 直接生成：
 * 卡片特色要顯示的回饋率，必須跟主站搜尋結果算出來的是同一個數字。那份邏輯住在
 * js/cashback-engine.js 的 getDisplayRate()（stacking 加總、跨槽引用 rate_N、
 * 級別 placeholder 都在裡面），Apps Script 讀不到 js/。若把它抄進 cards-export.gs，
 * 同一段邏輯就會變成第四份副本——docs/project/cashback-engine.md 第 6 節已經明文
 * 警告「三處實作必須一致」，再多一份遲早分岔。
 *
 * 所以這裡照 tools/lib/merchant-cards.js 的成例：把 js/ 那 12 支模組原封不動載進
 * Node 的 vm 跑，只補一個極簡 DOM 替身。cards-export.gs 只負責產出空的
 * <div class="promo-card-feat" data-feat-for="<card id>"> 容器，這支腳本在部署時填進去。
 *
 * 用法：
 *   node tools/build-promos-features.js          # 注入（Cloudflare Pages build 會跑）
 *   node tools/build-promos-features.js --check  # 只檢查是否已是最新，不寫入
 *
 * ⚠️ preflight 刻意**不**跑 --check：Apps Script 匯出的 commit 產出的是空容器，
 *    那才是正常狀態（內容部署時才注入），拿它當違規會讓每次匯出都擋住 commit。
 *
 * 沒跑過這支腳本時容器是空的，promos.js 會把「卡片特色」按鈕一起藏起來，
 * 頁面其餘部分照常可用——不會壞掉，只是少一個區塊。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./lib/merchant-cards');

const REPO = path.resolve(__dirname, '..');
const PAGE = path.join(REPO, 'promos.html');
const TOP_N = 5;                       // 卡片特色最多列幾條指定通路（固定兩行「國內/國外」另計）
const CHECK_ONLY = process.argv.slice(2).includes('--check');

// ---------- 資料推導（規則全部是站長 2026-09-16~17 裁定的，逐條註明）----------

// 標籤一律顯示商家（items），不顯示 category（站長 2026-09-17）。
// category 只在它描述「達成條件」時保留成灰色後綴——那是防止誤導的資訊：
// 台新 Richart 卡的五個「切換○○刷方案」互斥，一個月只能選一個，
// 拿掉之後五行看起來像可以同時拿 10%+5%+3.8%+3.8%。
const COND_RE = /方案|切換|任務|首次|綁定|登錄|滿額|滿千|加碼活動/;
// 骨幹槽（見 docs/project/cashbackmodel-fill-guide.md 第 4 節）：21=國內一般、
// 22=國外一般、14=網路廣告。它們由固定兩行代表，不進「指定通路」清單。
const BACKBONE_SLOTS = [14, 21, 22];

function itemsLabel(items) {
  const a = (items || []).filter(Boolean);
  if (!a.length) return '';
  const head = a.slice(0, 3).join('、');
  return a.length > 3 ? head + '…等 ' + a.length + ' 項' : head;
}
function labelOf(rg) {
  const cat = String(rg.category || '').trim();
  return {
    label: itemsLabel(rg.items) || cat || '一般消費',
    cond: (cat && COND_RE.test(cat)) ? cat : ''
  };
}

function makeCalc(engine) {
  return function calcSlot(card, rg, lvS) {
    const parsed = engine.parseCashbackRate(rg.rate, card, lvS);
    return {
      rate: engine.getDisplayRate(card, rg, parsed, lvS),   // ← 主站同一支
      cap: engine.parseCashbackCap(rg.cap, card, lvS)
    };
  };
}

function displayableSlots(engine, card) {
  return (card.cashbackRates || []).filter(rg => {
    if (rg.hideInDisplay) return false;
    const st = engine.getRateStatus(rg.periodStart, rg.periodEnd);
    if (st !== 'active' && st !== 'always') return false;
    return BACKBONE_SLOTS.indexOf(rg.slot) === -1;
  });
}

// 分級卡取「最高級別」（站長 2026-09-17）。
// ⚠️ 不能用 levelSettings 的鍵順序：實測 4 張分級卡有兩種排法——玉山 Uni
// （簡單選→UP選）與國泰 CUBE（Level 1→3）由低到高，永豐大戶（大戶Plus 在前）
// 與凱基誠品（黑卡在前）由高到低。改成實算：每個級別把所有可顯示槽位算一遍，
// 取「最高回饋率」最大的那個。
function highestLevel(engine, calcSlot, card) {
  if (!card.hasLevels || !card.levelSettings) return null;
  const slots = displayableSlots(engine, card);
  let best = null;
  Object.keys(card.levelSettings).forEach(name => {
    const s = card.levelSettings[name];
    const top = slots.reduce((m, rg) => Math.max(m, calcSlot(card, rg, s).rate || 0), 0);
    if (!best || top > best.top) best = { name, settings: s, top };
  });
  return best;
}

// 固定行：國內一般消費（永遠有）／國外消費（只在 slot22 存在時）。
// 沒有 slot22 ＝ 這張卡沒有國外消費回饋，整行不顯示（站長 2026-09-17，取代
// 更早那版「退回卡片級欄位推算」——那條路沒有 cashbackModel 把關，數字沒保證）。
function baseLines(engine, calcSlot, card, lvS) {
  const find = n => (card.cashbackRates || []).find(r => r.slot === n);
  const out = [];
  const s21 = find(21), s22 = find(22);
  if (s21) {
    const v = calcSlot(card, s21, lvS);
    out.push({ label: '國內一般消費', rate: v.rate, cap: v.cap, base: true });
  } else {
    out.push({ label: '國內一般消費', rate: card.basicCashback, cap: null, base: true });
  }
  if (s22) {
    const v = calcSlot(card, s22, lvS);
    out.push({ label: '國外消費', rate: v.rate, cap: v.cap, base: true });
  }
  return out.filter(x => typeof x.rate === 'number' && x.rate > 0);
}

// Highlights（推薦活動）的 merchant 可能是快捷搜尋的 displayName（如「所有計程車」
// ＝台灣大車隊/yoxi/uber/…），比對前要先展開，不能只做字串比對。
function merchantKeywords(cardsData, m) {
  const options = cardsData.quickSearchOptions || [];
  const norm = String(m).trim().toLowerCase();
  const opt = options.find(o => o.displayName && String(o.displayName).trim().toLowerCase() === norm);
  return opt ? (opt.merchants || []) : [String(m)];
}
// 一卡一通路可能命中多組活動（中信 uniopen 的夢時代實測 4 組）。
// 取「回饋率最高」的那組（站長 2026-09-17 裁定；宣稱本來就是「最高」）。
function findSlotForMerchant(cardsData, slots, merchant) {
  const kws = merchantKeywords(cardsData, merchant).map(s => String(s).toLowerCase());
  let hits = slots.filter(s => s.items.some(i => kws.indexOf(String(i).toLowerCase()) !== -1));
  if (!hits.length) {
    hits = slots.filter(s => s.items.some(i => kws.some(k =>
      String(i).toLowerCase().indexOf(k) !== -1 || k.indexOf(String(i).toLowerCase()) !== -1)));
  }
  if (!hits.length) return null;
  return hits.slice().sort((a, b) => b.rate - a.rate)[0];
}

const HYPE = { '全場最高': 'top', '壓倒性神卡': 'god', '獨家回饋': 'excl', '無腦刷': 'easy' };
function hypeOf(description) {
  const m = /^(.+?)[！!]/.exec(description || '');
  return (m && HYPE[m[1]]) ? { label: m[1], cls: HYPE[m[1]] } : null;
}

function featuresFor(engine, cardsData, spotByCard, card) {
  const calcSlot = makeCalc(engine);
  const lv = highestLevel(engine, calcSlot, card);
  const lvS = lv ? lv.settings : null;

  const slots = displayableSlots(engine, card).map(rg => {
    const v = calcSlot(card, rg, lvS);
    const L = labelOf(rg);
    return { slot: rg.slot, rate: v.rate, cap: v.cap, label: L.label, cond: L.cond, items: rg.items || [] };
  }).filter(s => typeof s.rate === 'number' && s.rate > 0);

  // Highlights 保證入列，但跟其他活動一起依回饋率倒序（站長：固定顯示 ≠ 排最前面）
  const must = [];
  const baseHype = {};
  const sheetOnly = [];
  (spotByCard[card.id] || []).forEach(sp => {
    const m = String(sp.merchant).trim();
    const hit = findSlotForMerchant(cardsData, slots, m);
    const hy = hypeOf(sp.description);
    if (hit) {
      hit.hype = hy;
      hit.spotMerchant = m;          // 顯示名用 Highlights 寫的商家名（人寫的，比 items 好讀）
      must.push(hit.slot);
      return;
    }
    // 反查不到指定通路槽、而且講的就是一般消費 → 把 hype 掛到固定行上，不另開一列
    if (/^國內(一般)?消費$/.test(m)) { baseHype['國內一般消費'] = hy; return; }
    if (/^國外(一般|實體)?消費$/.test(m)) { baseHype['國外消費'] = hy; return; }
    sheetOnly.push({ label: m, rate: Number(sp.rate), cap: null, hype: hy, sheetOnly: true });
  });

  // 同一個顯示標籤只留回饋率最高的那一個（站長 2026-09-17：聯邦 LINE Bank 卡的
  // 「萊爾富門市」同時有 10% 與 5% 兩槽，並列會被當成資料出錯）。
  // ⚠️ 必須在挑前 N 名之前去重，否則重複那行會佔掉名額、把真正的第 N 名擠掉。
  const byLabel = new Map();
  slots.forEach(s => {
    const key = s.spotMerchant || s.label;
    const prev = byLabel.get(key);
    if (!prev) { byLabel.set(key, s); return; }
    const keep = s.rate > prev.rate ? s : prev;
    const drop = s.rate > prev.rate ? prev : s;
    if (!keep.hype && drop.hype) keep.hype = drop.hype;              // hype 移轉給留下來的
    if (!keep.spotMerchant && drop.spotMerchant) keep.spotMerchant = drop.spotMerchant;
    if (must.indexOf(drop.slot) !== -1 && must.indexOf(keep.slot) === -1) must.push(keep.slot);
    byLabel.set(key, keep);
  });
  const sorted = Array.from(byLabel.values()).sort((a, b) => b.rate - a.rate);

  const picked = [];
  const seen = new Set();
  sorted.forEach(s => { if (must.indexOf(s.slot) !== -1) { picked.push(s); seen.add(s.slot); } });
  sheetOnly.forEach(u => picked.push(u));
  sorted.forEach(s => {
    if (picked.length >= TOP_N) return;
    if (seen.has(s.slot)) return;
    seen.add(s.slot);
    picked.push(s);
  });
  picked.sort((a, b) => b.rate - a.rate);

  const base = baseLines(engine, calcSlot, card, lvS).map(b =>
    baseHype[b.label] ? Object.assign({}, b, { hype: baseHype[b.label] }) : b);

  return {
    level: lv ? lv.name : '',
    rows: picked.slice(0, Math.max(TOP_N, must.length + sheetOnly.length)).map(x => ({
      rate: x.rate, cap: x.cap, label: x.spotMerchant || x.label, cond: x.cond || '', hype: x.hype || null
    })),
    base
  };
}

// ---------- HTML ----------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function capText(cap) {
  return (cap == null || !(cap > 0)) ? '無上限' : '上限 NT$' + Math.round(cap).toLocaleString('en-US');
}
function rowHtml(r) {
  const hype = r.hype
    ? '<span class="promo-feat-hype promo-feat-hype--' + r.hype.cls + '">' + escapeHtml(r.hype.label) + '！</span>'
    : '';
  const cond = r.cond ? '<span class="promo-feat-cond">' + escapeHtml(r.cond) + '</span>' : '';
  return '<li class="promo-feat-row' + (r.base ? ' is-base' : '') + '">' +
    '<span class="promo-feat-rate">' + r.rate + '%</span>' +
    '<span class="promo-feat-name">' + hype + escapeHtml(r.label) + cond + '</span>' +
    '<span class="promo-feat-cap">' + escapeHtml(capText(r.cap)) + '</span></li>';
}

function blockHtml(cardId, feat, usage) {
  if (!feat.rows.length && !feat.base.length) return '';
  const lv = feat.level
    ? '<span class="promo-feat-level">以「' + escapeHtml(feat.level) + '」計</span>' : '';
  // 「查看全部 ›」＝原本卡名旁那顆 ⓘ，改成文字並移到這裡（站長 2026-09-17）。
  // href 保留深連結當 fallback；promos.js 攔截後開內嵌詳情並捲到「指定通路回饋」。
  const all = '<a class="promo-feat-all" href="' + escapeHtml('/?start&card=' + cardId) +
    '" data-card-id="' + escapeHtml(cardId) + '" data-section="card-special-section"' +
    ' target="_blank" rel="noopener noreferrer">查看全部 ›</a>';
  // 卡片用途：Sheets 的 cardUsage 欄，沒填就整行不出現（站長 2026-09-17，可以慢慢填）
  const usageHtml = usage
    ? '<p class="promo-feat-usage">' + escapeHtml(usage) + '</p>' : '';
  return '<div class="promo-feat-head"><b>卡片特色</b>' + lv + all + '</div>' + usageHtml +
    '<ul class="promo-feat-list">' +
    feat.rows.map(rowHtml).join('') +
    feat.base.map(b => rowHtml(Object.assign({}, b, { base: true }))).join('') +
    '</ul>';
}

// ---------- 注入 ----------
function readCardsData() {
  const raw = fs.readFileSync(path.join(REPO, 'cards.data'), 'utf8').trim();
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

function build() {
  if (!fs.existsSync(PAGE)) {
    throw new Error('找不到 promos.html —— 它由 Apps Script 匯出生成，應該跟 cards.data 一起進 repo');
  }
  const cardsData = readCardsData();
  const engine = createEngine(cardsData);
  const cd = engine.__cardsData;
  const byId = {};
  cd.cards.forEach(c => { byId[c.id] = c; });

  const spotByCard = {};
  (cd.spotlights || []).forEach(s => {
    if (s.active === false) return;
    (spotByCard[s.card_id] = spotByCard[s.card_id] || []).push(s);
  });

  let html = fs.readFileSync(PAGE, 'utf8');
  let filled = 0, empty = 0, missing = [];

  // 只換容器內容，容器本身（id / class / data-feat-for）維持生成器輸出的樣子。
  //
  // ⚠️ 2026-09-18 修：這裡原本用 /<div ...>([\s\S]*?)<\/div>/ 這種「非貪婪配到第一個
  // </div>」的寫法，**不具冪等性**——容器一旦裝進帶巢狀 <div> 的內容（.promo-feat-head
  // 就是一個），第二次執行時「第一個 </div>」變成 head 的結尾，於是只換掉前半段、
  // 後半段的 <ul> 原地留下 → 卡片特色整份變成兩份。實際上線踩到：repo 裡 commit 的是
  // 已注入版，Cloudflare build 又跑一次，preview 上每張卡的特色都出現兩次。
  //
  // 現在改成從開頭標籤往後**數 <div> 巢狀深度**找出真正配對的 </div>，重跑幾次都一樣。
  // 另外 repo 現在一律 commit「空容器」版（Apps Script 匯出本來就是空的），
  // 注入只發生在部署時——即使冪等，也不該讓 repo 與匯出端的內容分岔。
  const OPEN_RE = /<div class="promo-card-feat"[^>]*data-feat-for="([^"]*)"[^>]*>/g;
  const TAG_RE = /<\/?div\b[^>]*>/g;
  const out = [];
  let cursor = 0, m;
  OPEN_RE.lastIndex = 0;
  while ((m = OPEN_RE.exec(html)) !== null) {
    const cardId = m[1];
    const innerStart = m.index + m[0].length;
    // 從內容開頭掃，深度歸零時那個 </div> 就是配對的結尾
    TAG_RE.lastIndex = innerStart;
    let depth = 1, innerEnd = -1, closeEnd = -1, t;
    while ((t = TAG_RE.exec(html)) !== null) {
      if (t[0][1] === '/') {
        depth--;
        if (depth === 0) { innerEnd = t.index; closeEnd = t.index + t[0].length; break; }
      } else {
        depth++;
      }
    }
    if (innerEnd === -1) {
      throw new Error('卡片特色容器沒有配對的 </div>（card id: ' + cardId + '）——生成器的標記可能改了');
    }
    const card = byId[cardId];
    let inner = '';
    if (!card) {
      missing.push(cardId);
    } else {
      const feat = featuresFor(engine, cd, spotByCard, card);
      const usage = (card.cardUsage || '').trim();   // 欄位不存在時自然是空字串
      inner = blockHtml(cardId, feat, usage);
      if (inner) filled++; else empty++;
    }
    out.push(html.slice(cursor, innerStart), inner, '</div>');
    cursor = closeEnd;
    OPEN_RE.lastIndex = closeEnd;
  }
  out.push(html.slice(cursor));
  html = out.join('');

  if (missing.length) {
    throw new Error('promos.html 有對不到 cards.data 的卡片 id：' + missing.join('、'));
  }
  if (filled === 0) {
    throw new Error('一個卡片特色容器都沒填到——生成器的標記可能改了，這支腳本要跟著更新');
  }
  return { html, filled, empty };
}

try {
  const { html, filled, empty } = build();
  const current = fs.readFileSync(PAGE, 'utf8');
  if (CHECK_ONLY) {
    if (html !== current) {
      console.error('❌ promos.html 的卡片特色區塊與生成結果不一致');
      process.exit(1);
    }
    console.log('✅ promos.html 卡片特色已是最新（' + filled + ' 組）');
  } else {
    if (html === current) {
      console.log('✅ promos.html 卡片特色無變化（' + filled + ' 組）');
    } else {
      fs.writeFileSync(PAGE, html);
      console.log('✅ promos.html 卡片特色已注入：' + filled + ' 組' + (empty ? '（' + empty + ' 組無資料、留空）' : ''));
    }
  }
} catch (err) {
  console.error('❌ ' + err.message);
  process.exit(1);
}
