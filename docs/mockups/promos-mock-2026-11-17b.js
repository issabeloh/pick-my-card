/* 2026-11-17 第二批 mockup：站長推薦 D2 排行榜列／D3 兩欄磚格／D4 緊湊橫滑、贈品圖 E2 行銷圖放大／E3 逐項商品圖。
 * 前半段同時拍實際成品（real/）。用法同 promos-mock-2026-11-17.js，另需建 mock2/ 與 real/ 資料夾。 */
const { chromium, devices } = require('playwright');
const URL = 'http://localhost:8766/promos.html';
const BASECSS = `.mk-label{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#111827;color:#fff;font:600 12px/1.5 system-ui;padding:6px 12px;text-align:center}.promos-back-to-top-btn{display:none!important}`;
async function open(b, mobile=true){ const ctx=await b.newContext(mobile?{...devices['iPhone 13']}:{viewport:{width:1440,height:900},deviceScaleFactor:2}); const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p._errs=errs; await p.goto(URL,{waitUntil:'load'}); await p.waitForTimeout(1300); await p.addStyleTag({content:BASECSS}); return p; }
async function settle(p){ await p.evaluate(async()=>{ const imgs=[...document.images].filter(i=>{const r=i.getBoundingClientRect(); return r.top<innerHeight*1.5 && r.bottom>-200}); await Promise.all(imgs.map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r; setTimeout(r,2500)}))); }); await p.waitForTimeout(350); }
const label = (p,t)=>p.evaluate(t=>{document.querySelectorAll('.mk-label').forEach(e=>e.remove()); document.body.insertAdjacentHTML('beforeend','<div class="mk-label">'+t+'</div>')},t);
const toPicks = p => p.evaluate(()=>{document.querySelector('.pmc-picks').scrollIntoView({block:'start'}); window.scrollBy(0,-50);});
(async()=>{
  const b = await chromium.launch();
  // ---------- 實際成品（不是 mockup）----------
  { const p=await open(b); await p.evaluate(()=>document.querySelector('.mk-label')&&0); await settle(p);
    await p.screenshot({path:'real/1-手機首屏.png'});
    await p.click('.pmc-trust-summary'); await settle(p); await p.screenshot({path:'real/2-手機防護說明展開.png'}); await p.click('.pmc-trust-summary');
    await toPicks(p); await settle(p); await p.screenshot({path:'real/3-手機站長推薦.png'});
    await p.evaluate(()=>{document.querySelector('.promos-controls').scrollIntoView({block:'start'}); window.scrollBy(0,-56);}); await settle(p); await p.screenshot({path:'real/4-手機清單.png'});
    console.log('m', await p.evaluate(()=>{const t=document.querySelector('.pmc-trust'); const l=document.querySelector('.pmc-trust-line'); return {trustH:Math.round(t.getBoundingClientRect().height), lineH:Math.round(l.getBoundingClientRect().height), picksTop:Math.round(document.querySelector('.pmc-picks').getBoundingClientRect().top+scrollY), hscroll:document.documentElement.scrollWidth>innerWidth}}), p._errs);
    await p.context().close(); }
  for (const w of [360,375]) { const c=await b.newContext({viewport:{width:w,height:760}}); const p=await c.newPage(); await p.goto(URL); await p.waitForTimeout(500); console.log(w, await p.evaluate(()=>({lineH:Math.round(document.querySelector('.pmc-trust-line').getBoundingClientRect().height), trustH:Math.round(document.querySelector('.pmc-trust').getBoundingClientRect().height)}))); await c.close(); }
  { const p=await open(b,false); await settle(p); await p.screenshot({path:'real/5-桌機首屏.png'});
    await p.evaluate(()=>{document.querySelector('#all-promos').scrollIntoView({block:'start'}); window.scrollBy(0,-50);}); await settle(p); await p.screenshot({path:'real/6-桌機清單.png'});
    await p.evaluate(()=>scrollTo(0,0)); await p.click('.pmc-trust-summary'); await settle(p); await p.screenshot({path:'real/7-桌機防護說明展開.png'}); console.log('d', p._errs); await p.context().close(); }

  // ---------- 站長推薦：三個新方案 ----------
  const HIDE = `.pmc-dots{display:none!important}.pmc-pick-reason,.pmc-pick-note{display:none!important}`;
  const picksVariants = {
   'D2-排行榜列': HIDE+`
     .pmc-picks-row{display:block!important;overflow:visible!important;margin-right:0!important;padding-right:0!important;counter-reset:rk;border:1px solid #e5e7eb;border-radius:12px;background:#fff}
     .pmc-pick{counter-increment:rk;display:grid!important;grid-template-columns:22px 72px minmax(0,1fr) auto;grid-template-areas:"rk img name cta" "rk img head cta" "rk img thr cta";column-gap:10px!important;row-gap:1px!important;align-items:center;padding:11px 12px!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important}
     .pmc-pick+.pmc-pick{border-top:1px solid #eef0f3!important}
     .pmc-pick::before{content:counter(rk);grid-area:rk;font-size:17px;font-weight:800;color:#9ca3af;text-align:center}
     .pmc-pick:nth-child(-n+3)::before{color:#1e40af}
     .pmc-pick-q,.pmc-pick-badges,.pmc-pick-links,.pmc-pick-dest{display:none!important}
     .pmc-pick-img{grid-area:img}
     .pmc-pick-name{grid-area:name;margin:0!important;font-size:13px!important;font-weight:600!important;color:#4b5563!important}
     .pmc-pick-headline{grid-area:head;margin:0!important;font-size:16px!important;line-height:1.35!important;color:#10b981!important;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
     .pmc-pick-headline small{display:inline!important;margin-left:5px;font-size:12px!important;color:#6b7280!important}
     .pmc-pick-thr{grid-area:thr;margin:0!important;font-size:12px!important}
     .pmc-pick-cta{grid-area:cta;align-self:center!important;margin:0!important;padding:7px 14px!important;font-size:13px!important}
     .pmc-pick-cta .pmc-cta-long{display:none}
     .mk-foot{margin:8px 2px 0;font-size:12px;color:#6b7280}`,
   'D3-兩欄磚格': HIDE+`
     .pmc-picks-row{display:grid!important;grid-auto-flow:row!important;grid-template-columns:1fr 1fr!important;grid-auto-columns:auto!important;gap:10px!important;overflow:visible!important;margin-right:0!important;padding-right:0!important}
     .pmc-pick{padding:10px!important;gap:4px!important}
     .pmc-pick:first-child{grid-column:1 / -1;display:grid!important;grid-template-columns:42% 1fr;grid-template-areas:"img q" "img name" "img head" "img thr" "img cta";column-gap:12px!important;align-items:start}
     .pmc-pick:first-child .pmc-pick-img{grid-area:img;align-self:center}
     .pmc-pick:first-child .pmc-pick-q{grid-area:q}.pmc-pick:first-child .pmc-pick-name{grid-area:name}.pmc-pick:first-child .pmc-pick-headline{grid-area:head}.pmc-pick:first-child .pmc-pick-thr{grid-area:thr}.pmc-pick:first-child .pmc-pick-cta{grid-area:cta;margin-top:6px!important}
     .pmc-pick-badges,.pmc-pick-links,.pmc-pick-dest{display:none!important}
     .pmc-pick-q{font-size:12.5px!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:0}
     .pmc-pick-name{font-size:12.5px!important;font-weight:600!important;color:#4b5563!important;margin:0!important}
     .pmc-pick-headline{font-size:15.5px!important;line-height:1.35!important;color:#10b981!important;margin:0!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
     .pmc-pick-headline small{display:inline!important;margin-left:4px;font-size:11.5px!important;color:#6b7280!important}
     .pmc-pick-thr{font-size:11.5px!important;margin:0!important}.pmc-pick-rate{display:none!important}
     .pmc-pick-cta{margin-top:auto!important;padding:7px 10px!important;font-size:13px!important}`,
   'D4-緊湊橫滑': `.pmc-pick-reason,.pmc-pick-note{display:none!important}
     .pmc-picks-row{grid-auto-columns:58%!important}
     .pmc-pick{padding:10px!important;gap:4px!important}
     .pmc-pick-img{aspect-ratio:16/7!important}.pmc-pick-img img{object-fit:cover!important;width:100%;height:100%}
     .pmc-pick-badges,.pmc-pick-dest{display:none!important}
     .pmc-pick-q{font-size:12.5px!important;order:-1}
     .pmc-pick-name{font-size:12.5px!important;font-weight:600!important;color:#4b5563!important;margin:0!important}
     .pmc-pick-headline{font-size:16px!important;color:#10b981!important;margin:0!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
     .pmc-pick-headline small{display:inline!important;margin-left:4px;font-size:11.5px!important;color:#6b7280!important}
     .pmc-pick-thr{font-size:11.5px!important;margin:0!important}
     .pmc-pick-links{padding-top:6px!important;margin-top:auto!important}
     .pmc-pick-feat{display:none!important}
     .pmc-pick-cta{padding:7px 10px!important;font-size:13px!important}`
  };
  const notes = {'D2-排行榜列':'站長推薦 D2 排行榜列：5 張一屏看完，點整列看詳情','D3-兩欄磚格':'站長推薦 D3 兩欄磚格：第 1 名放大，其餘兩欄','D4-緊湊橫滑':'站長推薦 D4 緊湊橫滑：保留橫滑，卡片高度砍半'};
  for (const [name,css] of Object.entries(picksVariants)) { const p=await open(b); await p.addStyleTag({content:css});
    if (name==='D2-排行榜列') await p.evaluate(()=>document.querySelector('.pmc-picks-row').insertAdjacentHTML('afterend','<p class="mk-foot">點任一列看活動詳情與卡片特色</p>'));
    await toPicks(p); await label(p,notes[name]); await settle(p); await p.screenshot({path:'mock2/'+name+'.png'}); await p.context().close(); }

  // ---------- 贈品圖：行銷圖怎麼辦 ----------
  const giftVariants = {
   'E2-行銷圖放大': { css:`
     #promo-1-febank-lejia .promo-card-main .promo-act-row{display:grid!important;grid-template-columns:118px minmax(0,1fr);gap:12px;align-items:start}
     #promo-1-febank-lejia .promo-act-thumb--gift{width:118px!important;height:118px!important;aspect-ratio:1/1!important;order:-1;border-radius:10px!important}
     #promo-1-febank-lejia .promo-act-thumb--gift img{width:100%;height:100%;object-fit:cover}
     #promo-1-febank-lejia .promo-act-reward{font-size:15px!important;line-height:1.5!important}
     .mk-zoom{position:absolute;right:5px;bottom:5px;background:rgba(17,24,39,.72);color:#fff;font-size:10.5px;border-radius:999px;padding:1px 7px}`,
     js:()=>{const t=document.querySelector('#promo-1-febank-lejia .promo-act-thumb--gift'); t.style.position='relative'; t.insertAdjacentHTML('beforeend','<span class="mk-zoom">點圖放大</span>');},
     note:'贈品圖 E2：行銷圖從 70px 放大到 118px（不用新增資料）' },
   'E3-逐項商品圖': { css:`
     #promo-1-febank-lejia .promo-act-thumb--gift,#promo-1-febank-lejia .promo-act-reward{display:none!important}
     .mk-opts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 10px}
     .mk-opt{border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
     .mk-opt i{display:block;aspect-ratio:1/1;background:#f3f4f6 center/cover no-repeat}
     .mk-opt b{padding:6px 7px 0;font-size:12px;line-height:1.4;color:#111827;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
     .mk-opt small{padding:2px 7px 7px;font-size:11.5px;font-weight:700;color:#10b981;margin-top:auto}
     .mk-pick3{font-size:12px;font-weight:700;color:#475569}`,
     js:()=>{const body=document.querySelector('#promo-1-febank-lejia .promo-act-body'); const src=document.querySelector('#promo-1-febank-lejia .promo-act-thumb--gift img').src;
       const ph=(x,y)=>'style="background-image:url('+src+');background-size:330%;background-position:'+x+'% '+y+'%"';
       body.querySelector('.promo-act-badges').insertAdjacentHTML('afterend','<span class="mk-pick3" style="display:block;margin-top:8px">好禮 3 選 1</span><span class="mk-opts" style="display:grid"><span class="mk-opt"><i '+ph(62,86)+'></i><b>Disegno 20+28 吋行李箱 2 件組</b><small>市價約 NT$2,298</small></span><span class="mk-opt"><i style="background:#f3f4f6"></i><b>歌林 4.2L 氣炸鍋</b><small>市價約 NT$1,990</small></span><span class="mk-opt"><i style="background:#f3f4f6"></i><b>宜睿即享券</b><small>NT$1,200</small></span></span>');},
     note:'贈品圖 E3：每個選項一張商品圖＋市價（需在 Sheets 逐項補圖，灰格＝還沒有圖；市價為示意）' }
  };
  for (const [name,v] of Object.entries(giftVariants)) { const p=await open(b); await p.addStyleTag({content:v.css}); await p.evaluate(v.js);
    await p.evaluate(()=>{document.querySelector('#promo-1-febank-lejia').scrollIntoView({block:'start'}); window.scrollBy(0,-56);}); await label(p,v.note); await settle(p); await p.screenshot({path:'mock2/'+name+'.png'}); await p.context().close(); }
  await b.close(); console.log('done');
})();
