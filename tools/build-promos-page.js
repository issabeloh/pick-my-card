#!/usr/bin/env node
/* ============================================================
 * 本機重生 promos.html（2026-09-17）
 *
 * promos.html 的正式生成端是 Google Sheets 上的 Apps Script（exportToJSON() 會呼叫
 * generatePromosPageHtml() 並跟 cards.data 一起 commit）。這支腳本做的是同一件事的
 * 本機版：用 Node 的 vm 載入 apps-script/cards-export.gs，餵 cards.data 解碼後的
 * JSON，呼叫同一支純函數——所以改了生成邏輯之後，不必等下一次匯出就能在 repo 裡
 * 看到結果、跑 preflight、開瀏覽器驗。
 *
 * ⚠️ 這不改變「實際執行版在 Sheets」這件事：改了 cards-export.gs 仍然必須把整份貼回
 * Sheets（見 apps-script/README.md），否則下次匯出會用舊邏輯把這裡的成果蓋掉。
 *
 * 用法：node tools/build-promos-page.js
 *   沿用 promos.html 現有的 versionTag 與「資料更新於」日期，所以重生的差異只會是
 *   生成邏輯本身的差異，不會摻進時間戳雜訊。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const PAGE = path.join(REPO, 'promos.html');

function readCardsData() {
  const raw = fs.readFileSync(path.join(REPO, 'cards.data'), 'utf8').trim();
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

// 從現有 promos.html 撈出 versionTag 與「資料更新於」，避免重生時摻進今天的時間戳
function reuseStamps() {
  if (!fs.existsSync(PAGE)) return {};
  const html = fs.readFileSync(PAGE, 'utf8');
  const ver = html.match(/promos\.css\?v=([A-Za-z0-9]+)/);
  const upd = html.match(/<time datetime="(\d{4}-\d{2}-\d{2})"[^>]*>[^<]*<\/time>\s*<\/div>/) ||
              html.match(/資料更新於\s*<time datetime="(\d{4}-\d{2}-\d{2})"/);
  return { versionTagOverride: ver ? ver[1] : undefined, promosUpdatedIso: upd ? upd[1] : undefined };
}

const cardsData = readCardsData();
const ctx = {
  console,
  JSON, Math, Date, parseFloat, parseInt, isNaN, isFinite,
  Object, Array, String, Number, Boolean, RegExp, Error,
  encodeURIComponent, decodeURIComponent
};
vm.createContext(ctx);
// cards-export.gs 頂層全是 function/const 宣告，載入本身不會碰到任何 Sheets API；
// generatePromosPageHtml() 是刻意寫成的純函數（見該檔檔頭註解）。
vm.runInContext(fs.readFileSync(path.join(REPO, 'apps-script', 'cards-export.gs'), 'utf8'),
  ctx, { filename: 'apps-script/cards-export.gs' });

const stamps = reuseStamps();
ctx.__exportData = Object.assign({
  cards: cardsData.cards || [],
  newCardholderPromos: cardsData.newCardholderPromos || [],
  cardApplyCtas: cardsData.cardApplyCtas || {}
}, stamps);

const html = vm.runInContext('generatePromosPageHtml(__exportData)', ctx);
if (typeof html !== 'string' || html.indexOf('<!DOCTYPE html>') !== 0) {
  console.error('❌ generatePromosPageHtml 沒有回傳完整 HTML');
  process.exit(1);
}
fs.writeFileSync(PAGE, html);
const groups = (html.match(/<article class="promo-card"/g) || []).length;
const acts = (html.match(/class="promo-act /g) || []).length;
console.log('✅ promos.html 已重生：' + groups + ' 組卡片、' + acts + ' 檔活動' +
  (stamps.versionTagOverride ? '（沿用 versionTag ' + stamps.versionTagOverride + '）' : ''));
