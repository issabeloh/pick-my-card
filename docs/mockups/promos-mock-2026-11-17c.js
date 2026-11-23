/* 2026-11-17 第三批：贈品圖 E2（行銷圖放大）套到全部 9 張首刷禮卡的範例，另含 FAQ ?category= 實測與信任列成品截圖。
 * 用法同 promos-mock-2026-11-17.js，另需建 e2/ 與 real3/ 資料夾。 */
const { chromium, devices } = require('playwright'); const fs=require('fs');
const B='http://localhost:8766/';
const E2=`
 .promo-card-main .promo-act-row:has(.promo-act-thumb--gift){display:grid!important;grid-template-columns:118px minmax(0,1fr);gap:12px;align-items:start}
 .promo-card-main .promo-act-thumb--gift{position:relative;width:118px!important;height:118px!important;aspect-ratio:1/1!important;order:-1;border-radius:10px!important}
 .promo-card-main .promo-act-thumb--gift img{width:100%;height:100%;object-fit:cover}
 .promo-card-main .promo-act-row:has(.promo-act-thumb--gift) .promo-act-reward{font-size:15px!important;line-height:1.5!important}
 .mk-zoom{position:absolute;right:5px;bottom:5px;background:rgba(17,24,39,.72);color:#fff;font-size:10.5px;border-radius:999px;padding:1px 7px}
 .promos-back-to-top-btn{display:none!important}`;
const addZoom=()=>document.querySelectorAll('.promo-card-main .promo-act-thumb--gift').forEach(t=>t.insertAdjacentHTML('beforeend','<span class="mk-zoom">點圖放大</span>'));
async function settleAll(p){ await p.evaluate(async()=>{ document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager'); await Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r; setTimeout(r,4000)}))); }); await p.waitForTimeout(500); }
(async()=>{
  const b=await chromium.launch();
  // FAQ 分類預選實測（用現有分類代替還沒建立的「安全」）
  { const c=await b.newContext({...devices['iPhone 13']}); const p=await c.newPage();
    await p.goto(B+'faq.html?category='+encodeURIComponent('網站功能')); await p.waitForTimeout(2500);
    console.log('faq ?category=網站功能 →', await p.evaluate(()=>({active:[...document.querySelectorAll('.category-btn.active')].map(e=>e.textContent), visible:[...document.querySelectorAll('.faq-item')].filter(e=>e.offsetParent).length, total:document.querySelectorAll('.faq-item').length})));
    await p.screenshot({path:'real3/3-FAQ頁已選好分類（以現有分類示範）.png'});
    await p.goto(B+'faq.html?category='+encodeURIComponent('安全')); await p.waitForTimeout(2500);
    console.log('faq ?category=安全（尚未建立）→', await p.evaluate(()=>({active:[...document.querySelectorAll('.category-btn.active')].map(e=>e.textContent), visible:[...document.querySelectorAll('.faq-item')].filter(e=>e.offsetParent).length})));
    await c.close(); }
  // 成品：信任列
  { const c=await b.newContext({...devices['iPhone 13']}); const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
    await p.goto(B+'promos.html'); await p.waitForTimeout(1300); await p.addStyleTag({content:'.promos-back-to-top-btn{display:none!important}'}); await p.screenshot({path:'real3/1-手機首屏.png'});
    console.log('trust', await p.evaluate(()=>{const t=document.querySelector('.pmc-trust'); return {tag:t.tagName, h:Math.round(t.getBoundingClientRect().height), lineH:Math.round(t.querySelector('.pmc-trust-line').getBoundingClientRect().height), href:t.getAttribute('href')}}), errs); await c.close();
    const c2=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2}); const p2=await c2.newPage(); await p2.goto(B+'promos.html'); await p2.waitForTimeout(1500); await p2.screenshot({path:'real3/2-桌機首屏.png', clip:{x:0,y:0,width:1440,height:520}}); await c2.close(); }
  // E2：手機，逐張首刷禮卡片
  { const c=await b.newContext({...devices['iPhone 13']}); const p=await c.newPage(); await p.goto(B+'promos.html'); await p.waitForTimeout(1300);
    await p.addStyleTag({content:E2}); await p.evaluate(addZoom); await settleAll(p);
    const ids=await p.evaluate(()=>[...document.querySelectorAll('.promo-card')].filter(c=>c.querySelector('.promo-card-main .promo-act-thumb--gift')).map(c=>c.id));
    console.log('gift cards', ids.length);
    const shots=[]; for (const id of ids) { const el=await p.$('#'+id+' .promo-card-main'); await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(250); const name=await p.evaluate(i=>document.getElementById(i).dataset.cardName,id); const buf=await el.screenshot(); shots.push({name,b64:buf.toString('base64')}); }
    const pg=await (await b.newContext({deviceScaleFactor:1})).newPage();
    for (const [i,grp] of [shots.slice(0,5),shots.slice(5)].entries()) {
      await pg.setContent('<body style="margin:0;background:#eef0f3;font:600 26px system-ui"><div id="w" style="display:inline-grid;grid-template-columns:repeat(3,560px);gap:26px;padding:26px;align-items:start">'+grp.map(s=>'<div><div style="padding:0 0 10px;color:#374151">'+s.name+'</div><img src="data:image/png;base64,'+s.b64+'" style="width:560px;display:block;border:1px solid #d1d5db;border-radius:10px;background:#fff"></div>').join('')+'</div></body>');
      await pg.waitForTimeout(400); await (await pg.$('#w')).screenshot({path:'e2/E2-手機-範例'+(i+1)+'.png'}); }
    await c.close(); }
  // E2：桌機清單
  { const c=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2}); const p=await c.newPage(); await p.goto(B+'promos.html'); await p.waitForTimeout(1500);
    await p.addStyleTag({content:E2}); await p.evaluate(addZoom); await p.evaluate(()=>{document.querySelector('#all-promos').scrollIntoView({block:'start'}); window.scrollBy(0,90);}); await settleAll(p);
    await p.screenshot({path:'e2/E2-桌機-清單上段.png'}); await p.evaluate(()=>window.scrollBy(0,760)); await p.waitForTimeout(600); await p.screenshot({path:'e2/E2-桌機-清單下段.png'}); await c.close(); }
  await b.close(); console.log('done');
})();
