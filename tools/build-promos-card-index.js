#!/usr/bin/env node
/* ============================================================
 * 新戶活動頁「依卡片找」區塊注入器（2026-11-22，站長選定 mockup J2「分欄目錄」）
 *
 * 給「心裡已經有想看的卡」的人一個入口：依銀行分欄列出清單上每張卡，卡名直接連到
 * 單卡頁 /promos/<id>。放在新戶活動清單之後（頁面最後一區），頁內分頁列多一顆「依卡片找」
 * 排在最後。
 *
 * 為什麼是部署時注入、而不是 Apps Script 生成：
 *   - 只列「真的有單卡頁」的卡——單卡頁本身就是部署時才生成的（build-promo-card-pages.js），
 *     這裡直接看 promos/<id>.html 在不在，兩邊不會對不上
 *   - 改這一區不必等站長重貼 cards-export.gs
 *
 * 資料來源：
 *   - 卡片與順序：promos.html 清單裡的 <article class="promo-card" data-card-id data-card-name>
 *     （清單已經是生成當下「有進行中活動」的卡；舊版 HTML 也有這兩個屬性）
 *   - 銀行：cards.data 的 cards[].bank（短名，如「永豐」「中信」）；查不到歸「其他」
 *   - 銀行排序：卡數多的在前，同數照清單裡第一次出現的順序；銀行內照清單順序
 *
 * 冪等：區塊包在 <!-- CARDINDEX:START/END --> 之間、分頁列那顆帶 data-jump-cardindex，
 * 重跑會整段換掉。必須在 build-promo-card-pages.js 之後跑（tools/deploy-version.sh 已排好）。
 * 本機跑過之後 promos.html 會有注入內容，**不要 commit**：用 node tools/build-promos-page.js 還原。
 *
 * 用法：node tools/build-promos-card-index.js
 * 失敗讓 build 掛掉是刻意的（同其他部署生成器）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { REPO, readCardsData } = require('./lib/promos-generator');

const PAGE = path.join(REPO, 'promos.html');
const CARD_DIR = path.join(REPO, 'promos');
const START = '<!-- CARDINDEX:START -->';
const END = '<!-- CARDINDEX:END -->';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

try {
  let html = fs.readFileSync(PAGE, 'utf8');

  // 清掉上一次注入的內容（冪等）
  html = html.replace(new RegExp('\\n?' + START + '[\\s\\S]*?' + END), '');
  html = html.replace(/<a href="#by-card" data-jump-cardindex[^>]*>[^<]*<\/a>/, '');

  const bankOf = {};
  (readCardsData().cards || []).forEach(c => { if (c && c.id) bankOf[c.id] = String(c.bank || '').trim(); });

  // data-card-name 已經是 HTML 轉義過的屬性值，原樣放進文字節點即可（再 esc 會變成 &amp;amp;）
  const seen = new Set();
  const cards = [];
  const re = /<article class="promo-card"[^>]*?\sdata-card-id="([^"]+)"[^>]*?\sdata-card-name="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue;                       // 同 pmcCardPagePath_：不合規的卡沒有頁
    if (!fs.existsSync(path.join(CARD_DIR, id + '.html'))) continue;       // 沒有單卡頁就不列
    cards.push({ id, name: m[2], bank: bankOf[id] || '其他' });
  }
  if (!cards.length) {
    // 本機沒先跑 build-promo-card-pages.js 時會走到這裡；部署時單卡頁一定先生成
    fs.writeFileSync(PAGE, html);
    console.log('⚠️ 依卡片找：沒有任何單卡頁（先跑 node tools/build-promo-card-pages.js），本次不注入');
    process.exit(0);
  }

  const groups = new Map();
  cards.forEach(c => { if (!groups.has(c.bank)) groups.set(c.bank, []); groups.get(c.bank).push(c); });
  const banks = [...groups.keys()];
  banks.sort((a, b) => (groups.get(b).length - groups.get(a).length) || (banks.indexOf(a) - banks.indexOf(b)));

  const cols = banks.map(b =>
    '<div class="pmc-ci-bank"><h3>' + esc(b) + '</h3><ul>' +
    groups.get(b).map(c => '<li><a href="/promos/' + c.id + '" data-ci-card="' + c.id + '">' + c.name + '</a></li>').join('') +
    '</ul></div>'
  ).join('\n');
  const section = '\n' + START + '\n' +
    '<section class="pmc-cardindex" id="by-card" aria-labelledby="pmc-ci-title">\n' +
    '  <div class="pmc-section-head"><h2 id="pmc-ci-title">依卡片找</h2><span>點擊任一卡名看單張信用卡的新戶活動</span></div>\n' +
    '  <div class="pmc-ci-grid">\n' + cols + '\n  </div>\n' +
    '</section>\n' + END;

  // 位置：清單（含「沒有符合條件」那行）之後、</main> 之前＝頁面最後一區
  const endIdx = html.indexOf('<!-- PROMOS:END -->');
  const mainClose = endIdx < 0 ? -1 : html.indexOf('</main>', endIdx);
  if (mainClose < 0) throw new Error('promos.html 找不到 PROMOS:END 之後的 </main>');
  html = html.slice(0, mainClose).replace(/\s*$/, '') + section + '\n' + html.slice(mainClose);

  // 分頁列最後一顆
  const navRe = /(<nav class="pmc-jump"[^>]*>[\s\S]*?)(<\/nav>)/;
  if (!navRe.test(html)) throw new Error('promos.html 找不到頁內分頁列 .pmc-jump');
  html = html.replace(navRe, '$1<a href="#by-card" data-jump-cardindex>依卡片找</a>$2');

  fs.writeFileSync(PAGE, html);
  console.log('✅ 依卡片找已注入：' + cards.length + ' 張卡、' + banks.length + ' 家銀行');
} catch (err) {
  console.error('❌ 依卡片找注入失敗：' + err.message);
  process.exit(1);
}
