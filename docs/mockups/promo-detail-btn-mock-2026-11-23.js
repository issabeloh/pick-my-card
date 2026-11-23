/* 單卡頁「查看卡片詳情」改按鈕的 mockup 產生器（2026-11-23，站長尚未選定，選定後可刪）。
 * 做法：開真正的單卡頁，用注入的 CSS／DOM 改出各方案再截圖——不是另畫一份假頁面。
 * 方案：A 區塊底部外框按鈕／B 區塊下方導引卡／C 標題旁膠囊／D 頁首頁籤＋A。
 * 用法：把 repo 複製到暫存資料夾 → 在那裡跑 node tools/build-promo-card-pages.js && node tools/build-promos-features.js
 *       → python3 -m http.server 8766 → node promo-detail-btn-mock-2026-11-23.js <輸出資料夾> [card id]
 */
const { chromium, devices } = require('playwright');
const OUT = process.argv[2];
const CARD = process.argv[3] || 'sinopac-dawho';
const URL = 'http://localhost:8766/promos/' + CARD + '.html';
const ARROW = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BOOK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 9.5h18M6.5 14.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const BASE = `.promos-back-to-top-btn{display:none!important}
 .mk-label{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#111827;color:#fff;font:600 12px/1.5 system-ui;padding:6px 12px;text-align:center}
 .promo-feat-head:empty{display:none}`;
// 共用：把「查看卡片詳情」從抬頭拿出來（抬頭只剩級別標籤；空了就藏）
const detach = () => { const a=document.querySelector('.pmc-cp-feat-sec .promo-feat-all'); a.remove(); window.__href=a.getAttribute('href'); };

const V = {
  A: { name:'A 區塊底部・外框按鈕', css:`
    .mk-a{margin:12px 0 4px;text-align:center}
    .mk-a p{margin:0 0 8px;font-size:12.5px;line-height:1.55;color:#6b7280}
    .mk-a a{display:flex;align-items:center;justify-content:center;gap:4px;padding:11px 14px;border:1.5px solid #1e40af;border-radius:10px;background:#fff;color:#1e40af;font-size:14.5px;font-weight:700;text-decoration:none}
    @media (min-width:769px){.mk-a a,.mk-b a{max-width:340px;margin:0 auto}}`,
    run: (ARROW) => { const f=document.querySelector('.pmc-cp-feat-sec .promo-card-feat');
      f.insertAdjacentHTML('beforeend','<div class="mk-a"><p>指定通路、回饋上限、領券停車，都在卡片詳情頁</p><a href="#">看完整回饋與權益'+ARROW+'</a></div>'); } },
  B: { name:'B 區塊下方・導引卡', css:`
    .mk-b{margin:12px 0 0;padding:14px;border:1px solid #c7d2fe;border-radius:12px;background:linear-gradient(180deg,#eef2ff,#f8faff)}
    .mk-b-top{display:flex;gap:10px;align-items:flex-start;margin-bottom:12px}
    .mk-b-ic{flex:none;width:38px;height:38px;border-radius:10px;background:#fff;color:#1e40af;display:grid;place-items:center;box-shadow:0 1px 2px rgba(30,64,175,.12)}
    .mk-b b{display:block;font-size:15px;color:#1e3a8a;margin-bottom:2px}
    .mk-b span{font-size:12.5px;line-height:1.55;color:#4b5563}
    .mk-b a{display:flex;align-items:center;justify-content:center;gap:4px;padding:11px 14px;border-radius:10px;background:#1e40af;color:#fff;font-size:14.5px;font-weight:700;text-decoration:none}
    @media (min-width:769px){.mk-a a,.mk-b a{max-width:340px;margin:0 auto}}`,
    run: (ARROW, BOOK) => { const s=document.getElementById('pmc-cp-feat-sec');
      s.insertAdjacentHTML('beforeend','<div class="mk-b"><div class="mk-b-top"><span class="mk-b-ic">'+BOOK+'</span><div><b>新戶活動之外，平常怎麼刷最划算？</b><span>指定通路回饋、回饋上限、級別條件、領券停車，都整理在卡片詳情頁。</span></div></div><a href="#">看完整回饋與權益'+ARROW+'</a></div>'); } },
  C: { name:'C 標題旁・膠囊按鈕', css:`
    .pmc-cp-feat-sec .pmc-section-head{display:flex;align-items:center;gap:8px}
    .mk-c{margin-left:auto;display:inline-flex;align-items:center;gap:2px;padding:6px 10px 6px 12px;border:1.5px solid #1e40af;border-radius:999px;background:#fff;color:#1e40af;font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap}
    .mk-c-sub{margin:-4px 0 8px;font-size:12.5px;color:#6b7280}`,
    run: (ARROW) => { const h=document.querySelector('#pmc-cp-feat-sec .pmc-section-head');
      h.insertAdjacentHTML('beforeend','<a class="mk-c" href="#">完整回饋權益'+ARROW+'</a>');
      h.insertAdjacentHTML('afterend','<p class="mk-c-sub">申辦後平常刷卡的回饋重點</p>'); } },
  D: { name:'D 頁首頁籤＋區塊底部按鈕', css:`
    .mk-d{display:flex;margin:10px 0 4px;padding:3px;border-radius:11px;background:#eef1f6}
    .mk-d span,.mk-d a{flex:1;display:flex;align-items:center;justify-content:center;gap:2px;padding:8px 6px;border-radius:9px;font-size:14px;font-weight:700;text-decoration:none;white-space:nowrap}
    .mk-d span{background:#fff;color:#111827;box-shadow:0 1px 3px rgba(15,23,42,.12)}
    .mk-d a{color:#1e40af}
    .mk-a{margin:12px 0 4px;text-align:center}
    .mk-a p{margin:0 0 8px;font-size:12.5px;line-height:1.55;color:#6b7280}
    .mk-a a{display:flex;align-items:center;justify-content:center;gap:4px;padding:11px 14px;border:1.5px solid #1e40af;border-radius:10px;background:#fff;color:#1e40af;font-size:14.5px;font-weight:700;text-decoration:none}
    @media (min-width:769px){.mk-a a,.mk-b a{max-width:340px;margin:0 auto}}`,
    run: (ARROW) => { const m=document.querySelector('.pmc-cp-month');
      m.insertAdjacentHTML('afterend','<nav class="mk-d" aria-label="這張卡的資訊"><span aria-current="page">新戶活動</span><a href="#">刷卡回饋・權益'+ARROW+'</a></nav>');
      const f=document.querySelector('.pmc-cp-feat-sec .promo-card-feat');
      f.insertAdjacentHTML('beforeend','<div class="mk-a"><p>指定通路、回饋上限、領券停車，都在卡片詳情頁</p><a href="#">看完整回饋與權益'+ARROW+'</a></div>'); } },
};

async function shot(b, key, mobile, where) {
  const ctx = await b.newContext(mobile ? {...devices['iPhone 13'], deviceScaleFactor:2} : {viewport:{width:1280,height:820},deviceScaleFactor:2});
  const p = await ctx.newPage(); await p.goto(URL,{waitUntil:'load'}); await p.waitForTimeout(1000);
  await p.addStyleTag({content: BASE + (key==='now' ? '' : V[key].css)});
  if (key !== 'now') { await p.evaluate(detach); await p.evaluate(`(${V[key].run.toString()})(${JSON.stringify(ARROW)},${JSON.stringify(BOOK)})`); }
  await p.evaluate(where => { const el = where==='top' ? null : document.getElementById('pmc-cp-feat-sec');
    window.scrollTo(0, el ? el.getBoundingClientRect().top + scrollY - 70 : 0); }, where);
  await p.waitForTimeout(500);
  const f = `${OUT}/${key}-${mobile?'m':'d'}-${where}.png`;
  await p.screenshot({path:f}); await ctx.close(); console.log(f);
}
(async()=>{
  const b = await chromium.launch();
  await shot(b,'now',true,'feat');
  for (const k of ['A','B','C','D']) await shot(b,k,true,'feat');
  await shot(b,'D',true,'top');
  for (const k of ['A','B','C']) await shot(b,k,false,'feat');
  await b.close();
})();
