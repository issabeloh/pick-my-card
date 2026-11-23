#!/usr/bin/env node
/* ============================================================
 * 單卡頁 /promos/<card id> 分享圖（og:image）生成器（2026-11-23）
 *
 * 設計＝站長選定的 B3b（docs/mockups/promo-og-mock-2026-11-22.js）：深色格線＋藍光暈＋
 * 3D 斜放真卡圖＋大字卡名＋毛玻璃「新戶活動」標籤＋底部品牌藍細條重複 pickmycard.app。
 *
 * **本機跑、結果 commit**（不在部署時跑：Cloudflare Pages 的 build 環境沒有瀏覽器）。
 * 輸出 assets/images/promo-og/<card id>.jpg（1200×630）＋ manifest.json。
 * 部署時 tools/build-promo-card-pages.js 看圖在不在：在就換成這張（?v= 帶檔案內容雜湊，
 * 換圖後 Facebook／LINE 才會重抓），不在就退回全站預設分享圖。
 *
 * 用法：
 *   node tools/build-promo-og.js            補缺的、重畫過期的（卡名或卡圖變了、版型改了）
 *   node tools/build-promo-og.js --all      全部重畫
 *   node tools/build-promo-og.js <id> ...   只畫指定的卡
 *   node tools/build-promo-og.js --check    只檢查不畫（preflight 用；不需要瀏覽器）
 *
 * 範圍＝部署時會產生「進行中」單卡頁的卡（同 generatePromoCardPages，活動已結束的頁不換圖）。
 * 沒有卡圖（assets/images/cards/<id>.png）的卡畫不出來，列為缺圖、頁面用預設圖。
 * 舊卡的圖不會自動刪（活動下架後可能再上架）；--check 會列出來，要清再手動刪。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO, readCardsData, loadGenerator, exportDataFrom } = require('./lib/promos-generator');

// 改了下面的版型（TEMPLATE）就把這個數字 +1：--check 會把所有圖列為過期，提醒重畫
const TEMPLATE_VERSION = 1;
const OUT_DIR = path.join(REPO, 'assets', 'images', 'promo-og');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const CARD_IMG_DIR = path.join(REPO, 'assets', 'images', 'cards');
const JPEG_QUALITY = 88;

const sha = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 部署時會產生進行中單卡頁的卡：[{ id, name }]
function activeCards() {
  const cardsData = readCardsData();
  const pages = loadGenerator()('generatePromoCardPages', Object.assign(exportDataFrom(cardsData), { versionTagOverride: 'dev' }));
  const byId = {};
  (cardsData.cards || []).forEach(c => { byId[c.id] = c; });
  return pages.filter(p => !p.ended).map(p => ({ id: p.cardId, name: (byId[p.cardId] && byId[p.cardId].name) || p.cardId }));
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { return {}; }
}

// 這張卡現在應該長什麼樣：卡名＋卡圖內容＋版型版本。跟 manifest 不同＝圖過期
function wantedStamp(card) {
  const imgPath = path.join(CARD_IMG_DIR, card.id + '.png');
  if (!fs.existsSync(imgPath)) return null;
  return { name: card.name, cardImage: sha(fs.readFileSync(imgPath)), template: TEMPLATE_VERSION };
}

function classify(cards, manifest) {
  const r = { ok: [], missing: [], stale: [], noCardImage: [] };
  cards.forEach(c => {
    const want = wantedStamp(c);
    if (!want) { r.noCardImage.push(c); return; }
    const have = manifest[c.id];
    if (!have || !fs.existsSync(path.join(OUT_DIR, c.id + '.jpg'))) r.missing.push(c);
    else if (have.name !== want.name || have.cardImage !== want.cardImage || have.template !== want.template) r.stale.push(c);
    else r.ok.push(c);
  });
  const active = new Set(cards.map(c => c.id));
  r.orphans = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.jpg')).map(f => f.slice(0, -4)).filter(id => !active.has(id))
    : [];
  return r;
}

// ---- 版型：B3b（照 mockup 原樣；只把卡名做了跳脫、長卡名縮字）----
// 卡圖有 7 張是直式（200×320，見 ui-display.md 卡圖規範）：B3b 只設計過橫式，直式照橫式寬度放會整張掉出畫面底部。
// 直式改成以高度定尺寸、站在光暈中央（同樣的 3D 斜度）。
function isPortrait(pngBuf) {
  return pngBuf.readUInt32BE(20) > pngBuf.readUInt32BE(16);   // PNG IHDR：寬在 16、高在 20
}

function template(name, cardImgUri, logoUri, portrait) {
  // 76px 一行約 6.8 個中文字；超過兩行（約 14 字）縮到 64px，避免三行撐爆
  const size = [...name].length > 14 ? 64 : 76;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@500;700;900&display=swap');
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;font-family:'Noto Sans TC','WenQuanYi Zen Hei',sans-serif;position:relative;overflow:hidden;background:#0b1220;color:#fff}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:48px 48px;
    -webkit-mask:radial-gradient(circle at 66% 50%,#000 0%,transparent 70%);mask:radial-gradient(circle at 66% 50%,#000 0%,transparent 70%)}
  .glow{position:absolute;left:560px;top:110px;width:560px;height:400px;border-radius:50%;background:radial-gradient(#3b82f6,transparent 65%);filter:blur(40px);opacity:.85}
  .c{position:absolute;left:560px;top:120px;perspective:1400px}
  .c img{display:block;width:580px;border-radius:28px;transform:rotateY(-18deg) rotateX(8deg) rotateZ(-3deg);box-shadow:0 40px 80px rgba(0,0,0,.6)}
  .c.portrait{left:735px;top:78px}
  .c.portrait img{width:280px;border-radius:22px}
  .t{position:absolute;left:64px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center}
  .t b{display:block;font-size:${size}px;font-weight:900;line-height:1.15;letter-spacing:-1px;text-wrap:balance}
  .glass{display:inline-flex;align-items:center;margin-top:34px;align-self:flex-start;gap:14px;padding:16px 30px 16px 18px;border-radius:999px;
    -webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);box-shadow:0 10px 30px rgba(0,0,0,.18);white-space:nowrap;
    font-size:40px;font-weight:900;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);color:#fff}
  .glass img{width:52px;height:52px;background:#fff;border-radius:12px;padding:5px}
  .ban{position:absolute;left:0;right:0;bottom:0;height:24px;background:#1e40af;color:rgba(255,255,255,.75);font-size:12px;font-weight:700;line-height:24px;letter-spacing:.5px;white-space:nowrap;overflow:hidden;padding-left:10px}
  .ban i{font-style:normal;opacity:.6;margin:0 8px}
</style></head><body><div class="grid"></div><div class="glow"></div>
<div class="c${portrait ? ' portrait' : ''}"><img src="${cardImgUri}"></div>
<div class="t"><b>${esc(name)}</b><div class="glass"><img src="${logoUri}">新戶活動</div></div>
<div class="ban">${Array(40).fill('pickmycard.app').join('<i>・</i>')}</div>
</body></html>`;
}

async function render(cards, manifest) {
  const { chromium } = require('playwright');
  const logoUri = 'data:image/png;base64,' + fs.readFileSync(path.join(REPO, 'assets', 'images', 'icon-pickmycard.png')).toString('base64');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    for (const c of cards) {
      const imgBuf = fs.readFileSync(path.join(CARD_IMG_DIR, c.id + '.png'));
      const imgUri = 'data:image/png;base64,' + imgBuf.toString('base64');
      await page.setContent(template(c.name, imgUri, logoUri, isPortrait(imgBuf)), { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      // 字型沒載到會退成文泉驛，畫出來的圖跟站長看過的不一樣——寧可失敗
      const fontOk = await page.evaluate(() => document.fonts.check('900 76px "Noto Sans TC"', '新戶活動'));
      if (!fontOk) throw new Error('Noto Sans TC 沒載到（連不到 fonts.googleapis.com？），不輸出走樣的圖');
      await page.screenshot({ path: path.join(OUT_DIR, c.id + '.jpg'), type: 'jpeg', quality: JPEG_QUALITY });
      manifest[c.id] = wantedStamp(c);
      console.log('  🖼  ' + c.id + '（' + c.name + '）');
    }
  } finally {
    await browser.close();
  }
  const sorted = {};
  Object.keys(manifest).sort().forEach(k => { sorted[k] = manifest[k]; });
  fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
}

function report(r) {
  const list = arr => arr.map(c => c.id).join('、');
  if (r.missing.length) console.log('⚠️  單卡頁分享圖缺 ' + r.missing.length + ' 張（頁面先用全站預設圖）：' + list(r.missing) + ' → node tools/build-promo-og.js');
  if (r.stale.length) console.log('⚠️  單卡頁分享圖過期 ' + r.stale.length + ' 張（卡名／卡圖／版型變了）：' + list(r.stale) + ' → node tools/build-promo-og.js');
  if (r.noCardImage.length) console.log('ℹ️  沒有卡圖、畫不出分享圖（用全站預設圖）：' + list(r.noCardImage));
  if (r.orphans.length) console.log('ℹ️  已無進行中活動的卡仍留著分享圖（不影響上線，要清再手動刪）：' + r.orphans.join('、'));
  if (!r.missing.length && !r.stale.length) console.log('✅ 單卡頁分享圖齊全（' + r.ok.length + ' 張）');
}

(async () => {
  try {
    const args = process.argv.slice(2);
    const cards = activeCards();
    const manifest = readManifest();
    const r = classify(cards, manifest);
    if (args.includes('--check')) { report(r); return; }

    let todo;
    if (args.includes('--all')) todo = r.ok.concat(r.missing, r.stale);
    else if (args.filter(a => !a.startsWith('--')).length) {
      const ids = new Set(args.filter(a => !a.startsWith('--')));
      todo = cards.filter(c => ids.has(c.id) && wantedStamp(c));
      const unknown = [...ids].filter(id => !todo.some(c => c.id === id));
      if (unknown.length) throw new Error('不是進行中單卡頁的卡、或沒有卡圖：' + unknown.join('、'));
    } else todo = r.missing.concat(r.stale);

    if (!todo.length) { report(r); return; }
    console.log('畫 ' + todo.length + ' 張分享圖…');
    await render(todo, manifest);
    report(classify(cards, readManifest()));
  } catch (err) {
    console.error('❌ 分享圖生成失敗：' + err.message);
    process.exit(1);
  }
})();
