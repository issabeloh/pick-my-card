#!/usr/bin/env node
/* ============================================================
 * 單卡頁 /promos/<card id> 生成器（2026-11-18）
 *
 * 每張有新戶活動的卡一頁（promos/<id>.html，Cloudflare Pages 以 clean URL 提供
 * /promos/<id>）。生成邏輯是 apps-script/cards-export.gs 的 generatePromoCardPages()——
 * 跟清單頁共用分組、活動卡與 header／footer，這裡只負責餵資料、寫檔。
 *
 * **只在部署時跑、不進 repo**（tools/deploy-version.sh 呼叫，在卡片特色注入與 ?v= 注入之前）：
 *   - 頁數跟著 cards.data 走，每次匯出都可能增減，進 repo 只會每次匯出多一堆 diff
 *   - Apps Script 不必多 commit 30 個檔，也不必等站長重貼 Apps Script 才有頁面
 *   - promos/ 在 .gitignore 裡；本機想看就自己跑這支（再跑 build-promos-features.js 補卡片特色）
 *
 * 用法：node tools/build-promo-card-pages.js
 *   會先清掉 promos/ 底下舊的 *.html 再重寫，活動下架的卡不會殘留舊頁。
 *   活動全部到期但還在 cards.data 裡的卡，輸出一頁「已結束」（noindex），
 *   免得 sitemap 在下次匯出前指到 404。
 * 失敗讓 build 掛掉是刻意的（同商家頁）：寧可部署失敗，也不要上線一半的頁面。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { REPO, readCardsData, loadGenerator, reusePromosStamps, exportDataFrom } = require('./lib/promos-generator');

const OUT_DIR = path.join(REPO, 'promos');

try {
  const cardsData = readCardsData();
  const stamps = reusePromosStamps();
  const exportData = Object.assign(exportDataFrom(cardsData), {
    promoCardUpdatedIso: cardsData.promoCardUpdatedIso || {},   // Apps Script 貼新版之前沒有這欄
    promosUpdatedIso: stamps.promosUpdatedIso,                  // 沒有個別日期時退回清單頁的日期
    versionTagOverride: 'dev'                                   // deploy-version.sh 之後換成 commit hash
  });
  const pages = loadGenerator()('generatePromoCardPages', exportData);
  if (!Array.isArray(pages) || !pages.length) throw new Error('generatePromoCardPages 一頁都沒有產生');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.html')).forEach(f => fs.unlinkSync(path.join(OUT_DIR, f)));
  let ended = 0;
  pages.forEach(p => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.cardId)) throw new Error('不合法的卡片 id：' + p.cardId);
    if (typeof p.html !== 'string' || p.html.indexOf('<!DOCTYPE html>') !== 0) {
      throw new Error(p.cardId + ' 沒有產生完整 HTML');
    }
    fs.writeFileSync(path.join(OUT_DIR, p.cardId + '.html'), p.html);
    if (p.ended) ended++;
  });
  console.log('✅ 單卡頁已生成：' + (pages.length - ended) + ' 頁' + (ended ? '（另有 ' + ended + ' 頁活動已結束、noindex）' : ''));
} catch (err) {
  console.error('❌ 單卡頁生成失敗：' + err.message);
  process.exit(1);
}
