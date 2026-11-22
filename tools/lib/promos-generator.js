/* ============================================================
 * 新戶活動頁生成器的 Node 載入器（2026-11-18 從 tools/build-promos-page.js 抽出）
 *
 * promos.html 與單卡頁 /promos/<id> 的生成邏輯都住在 apps-script/cards-export.gs
 * （純函數，見 docs/project/promos.md 第 1 節）。這裡用 Node 的 vm 把整份
 * .gs 原封不動載進來，讓 tools/ 底下的腳本呼叫同一支函數——不另抄一份邏輯。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

function readCardsData() {
  const raw = fs.readFileSync(path.join(REPO, 'cards.data'), 'utf8').trim();
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

// 回傳 call(name, arg)：在載入 cards-export.gs 的 context 裡呼叫一支頂層函數
function loadGenerator() {
  const ctx = {
    console,
    JSON, Math, Date, parseFloat, parseInt, isNaN, isFinite,
    Object, Array, String, Number, Boolean, RegExp, Error,
    encodeURIComponent, decodeURIComponent
  };
  vm.createContext(ctx);
  // cards-export.gs 頂層全是 function/const 宣告，載入本身不會碰到任何 Sheets API
  vm.runInContext(fs.readFileSync(path.join(REPO, 'apps-script', 'cards-export.gs'), 'utf8'),
    ctx, { filename: 'apps-script/cards-export.gs' });
  return function call(name, arg) {
    ctx.__arg = arg;
    return vm.runInContext(name + '(__arg)', ctx);
  };
}

// 從現有 promos.html 撈出 versionTag 與「資料更新於」，避免重生時摻進今天的時間戳
function reusePromosStamps() {
  const page = path.join(REPO, 'promos.html');
  if (!fs.existsSync(page)) return {};
  const html = fs.readFileSync(page, 'utf8');
  const ver = html.match(/promos\.css\?v=([A-Za-z0-9]+)/);
  const upd = html.match(/<time datetime="(\d{4}-\d{2}-\d{2})"[^>]*>[^<]*<\/time>\s*<\/div>/) ||
              html.match(/資料更新於\s*<time datetime="(\d{4}-\d{2}-\d{2})"/);
  return { versionTagOverride: ver ? ver[1] : undefined, promosUpdatedIso: upd ? upd[1] : undefined };
}

function exportDataFrom(cardsData) {
  return {
    cards: cardsData.cards || [],
    newCardholderPromos: cardsData.newCardholderPromos || [],
    cardApplyCtas: cardsData.cardApplyCtas || {}
  };
}

module.exports = { REPO, readCardsData, loadGenerator, reusePromosStamps, exportDataFrom };
