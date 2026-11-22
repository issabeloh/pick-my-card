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
const { REPO, readCardsData, loadGenerator, reusePromosStamps, exportDataFrom } = require('./lib/promos-generator');

const PAGE = path.join(REPO, 'promos.html');
const stamps = reusePromosStamps();
const exportData = Object.assign(exportDataFrom(readCardsData()), stamps);

const html = loadGenerator()('generatePromosPageHtml', exportData);
if (typeof html !== 'string' || html.indexOf('<!DOCTYPE html>') !== 0) {
  console.error('❌ generatePromosPageHtml 沒有回傳完整 HTML');
  process.exit(1);
}
fs.writeFileSync(PAGE, html);
const groups = (html.match(/<article class="promo-card"/g) || []).length;
const acts = (html.match(/class="promo-act /g) || []).length;
console.log('✅ promos.html 已重生：' + groups + ' 組卡片、' + acts + ' 檔活動' +
  (stamps.versionTagOverride ? '（沿用 versionTag ' + stamps.versionTagOverride + '）' : ''));
