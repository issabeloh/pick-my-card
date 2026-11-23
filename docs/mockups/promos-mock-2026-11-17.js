/* 新戶活動頁 2026-11-17 這一輪的 mockup 產生器（站長尚未選定，選定後可刪）。
 * 做法：開真正的 promos.html，用注入的 CSS／DOM 改出各方案再截圖——不是另畫一份假頁面。
 * 內容：A 信任區塊三案／B 顏色減量／C 引言縮短／D 站長推薦橫卡／E 贈品商品圖／F 收藏／G 單卡頁。
 * 用法：把 repo 複製到暫存資料夾 → 在那裡跑 node tools/build-promos-features.js（注入卡片特色）
 *       → python3 -m http.server 8766 → 在本檔旁建 mock/ 資料夾 → node promos-mock-2026-11-17.js
 */
const { chromium, devices } = require('playwright');
const OUT = __dirname + '/mock/';
const URL = 'http://localhost:8766/promos.html';
const SHIELD = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2l6 2.2v4.6c0 3.9-2.5 7.2-6 8.7-3.5-1.5-6-4.8-6-8.7V4.2L10 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.2 10.1l2 2 3.6-3.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const IC = {
  bank: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 9.5L12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3.5 19.5h17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M10 6H6.5A1.5 1.5 0 005 7.5v10A1.5 1.5 0 006.5 19h10a1.5 1.5 0 001.5-1.5V14M13.5 5H19v5.5M19 5l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rank: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 19V11M12 19V5M19 19v-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
};
const BASECSS = `
 .mk-label{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#111827;color:#fff;font:600 12px/1.5 system-ui;padding:6px 12px;text-align:center}
 .promos-back-to-top-btn{display:none!important}
`;
const HERO_SHORT_CSS = `
 .promos-hero{padding:14px 4px 4px!important}
 .promos-hero-intro{display:none!important}
 .mk-sub{margin:2px 0 0;font-size:13.5px;color:#4b5563;line-height:1.6}
 .mk-stats{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 2px}
 .mk-stats span{font-size:12.5px;font-weight:600;color:#374151;background:#f3f4f6;border-radius:999px;padding:3px 10px}
 .mk-stats b{color:#1e40af}
`;
const heroShort = () => { const h=document.querySelector('.promos-hero'); h.insertAdjacentHTML('beforeend','<p class="mk-sub">各家銀行首刷禮、加碼回饋、刷卡金，條件與截止日一頁比完。</p><div class="mk-stats"><span><b>30</b> 張卡</span><span><b>55</b> 檔活動</span><span>更新於 11/13</span></div>'); };
async function open(b, mobile=true){ const ctx=await b.newContext(mobile?{...devices['iPhone 13']}:{viewport:{width:1440,height:900},deviceScaleFactor:2}); const p=await ctx.newPage(); await p.goto(URL,{waitUntil:'load'}); await p.waitForTimeout(1300); await p.addStyleTag({content:BASECSS}); return p; }
async function settle(p){ await p.evaluate(async()=>{ const imgs=[...document.images].filter(i=>{const r=i.getBoundingClientRect(); return r.top<innerHeight*1.5 && r.bottom>-200}); await Promise.all(imgs.map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r; setTimeout(r,2500)}))); }); await p.waitForTimeout(350); }
const label = (p,t)=>p.evaluate(t=>{document.querySelectorAll('.mk-label').forEach(e=>e.remove()); document.body.insertAdjacentHTML('beforeend','<div class="mk-label">'+t+'</div>')},t);

(async()=>{
  const b = await chromium.launch();

  // ===== A：信任區塊三案（都搭配縮短後的引言）=====
  const trustVariants = {
    'A1-一行字': { css:`
      .mk-t1{display:flex;align-items:center;gap:8px;margin:12px 0 2px;padding:10px 2px;border-top:1px solid #eef0f3;border-bottom:1px solid #eef0f3;color:#374151;font-size:13.5px;text-decoration:none}
      .mk-t1 svg{color:#1e40af;flex:none}.mk-t1 b{color:#111827}.mk-t1 .go{margin-left:auto;color:#1e40af;font-weight:700;white-space:nowrap}`,
      html:`<a class="mk-t1" href="#">${SHIELD}<span>申辦都在<b>銀行官網</b>完成，本站不經手個資</span><span class="go">了解 ›</span></a>` },
    'A2-三格承諾列': { css:`
      .mk-t2{display:grid;grid-template-columns:repeat(3,1fr);margin:12px 0 2px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;overflow:hidden}
      .mk-t2 div{display:flex;flex-direction:column;align-items:center;gap:3px;padding:11px 4px 10px;text-align:center}
      .mk-t2 div+div{border-left:1px solid #eef0f3}
      .mk-t2 svg{color:#1e40af}.mk-t2 b{font-size:13px;color:#111827}.mk-t2 small{font-size:11.5px;color:#6b7280}
      .mk-t2more{display:block;text-align:right;margin:5px 2px 0;font-size:12.5px;font-weight:700;color:#1e40af;text-decoration:none}`,
      html:`<div class="mk-t2"><div>${IC.bank}<b>銀行官網申辦</b><small>本站不經手個資</small></div><div>${IC.link}<b>按鈕標示去向</b><small>連結逐一核對</small></div><div>${IC.rank}<b>依回饋率排行</b><small>排序不看分潤</small></div></div><a class="mk-t2more" href="#">申辦前想知道的事 ›</a>` },
    'A3-併入引言卡': { css:`
      .mk-t3{margin:12px 0 2px;padding:12px 14px;background:#f5f6f8;border-radius:10px}
      .mk-t3 p{margin:0 0 8px;font-size:13.5px;color:#374151;line-height:1.6}
      .mk-t3 ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 12px}
      .mk-t3 li{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:600;color:#374151}
      .mk-t3 li svg{width:14px;height:14px}
      .mk-t3 a{margin-left:auto;font-size:12.5px;font-weight:700;color:#1e40af;text-decoration:none}`,
      html:`<div class="mk-t3"><p>各家銀行首刷禮、加碼回饋、刷卡金，條件與截止日一頁比完。</p><ul><li>CHK銀行官網申辦</li><li>CHK按鈕標示去向</li><li>CHK依回饋率排行</li><a href="#">了解 ›</a></ul></div>`, noSub:true }
  };
  const CHK='<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#d1fae5"/><path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="#059669" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  for (const [name,v] of Object.entries(trustVariants)) {
    const p = await open(b);
    await p.addStyleTag({content:HERO_SHORT_CSS+v.css+'.pmc-trust{display:none!important}'});
    await p.evaluate(heroShort);
    if (v.noSub) await p.evaluate(()=>{document.querySelector('.mk-sub').remove();});
    await p.evaluate(h=>document.querySelector('.promos-hero').insertAdjacentHTML('afterend',h), v.html.replace(/CHK/g,CHK));
    if (v.noSub) await p.evaluate(()=>{const s=document.querySelector('.mk-stats'); document.querySelector('.mk-t3').after(s); s.style.margin='10px 4px 0';});
    await label(p,'信任區塊 '+name+'（引言已縮短）'); await settle(p);
    await p.screenshot({path:OUT+name+'.png'}); await p.context().close();
  }

  // ===== B：顏色減量（改前／改後）=====
  const COLOR_CSS = `
   .promo-type-badge,.promo-sub-type,.pmc-kind{background:#eef1f6!important;color:#475569!important}
   .promo-chip{border-color:#d1d5db!important;color:#374151!important;background:#fff!important;box-shadow:none!important}
   .promo-chip.is-active{background:#1e40af!important;border-color:#1e40af!important;color:#fff!important}
   .promo-chip--ending{color:#b91c1c!important}
   .pmc-trust{background:#fff!important;border-color:#e5e7eb!important}
   .pmc-pick-q{color:#111827!important}
   .promo-feat-btn{background:#fff!important;border-color:#d1d5db!important;color:#374151!important}
   .pmc-lg-jump,.pmc-pick-jump,.promo-act-more,.promo-sub-more{color:#374151!important}
   .promo-act-more .promo-chevron,.promo-sub-meta .promo-chevron{color:#6b7280}
  `;
  for (const tag of ['改前','改後']) {
    const p = await open(b);
    if (tag==='改後') await p.addStyleTag({content:COLOR_CSS});
    await p.evaluate(()=>{document.querySelector('.promos-controls').scrollIntoView({block:'start'}); window.scrollBy(0,-56);});
    await label(p,'顏色 '+tag+(tag==='改後'?'：藍＝可以按、綠＝你拿到的、紅＝快截止，其餘灰':'')); await settle(p);
    await p.screenshot({path:OUT+'B-顏色-清單-'+tag+'.png'});
    await p.evaluate(()=>{document.querySelector('.pmc-picks').scrollIntoView({block:'start'}); window.scrollBy(0,-50);}); await settle(p);
    await p.screenshot({path:OUT+'B-顏色-推薦-'+tag+'.png'});
    await p.context().close();
  }
  // 桌機也拍一張改前改後
  for (const tag of ['改前','改後']) {
    const p = await open(b,false);
    if (tag==='改後') await p.addStyleTag({content:COLOR_CSS});
    await p.evaluate(()=>{document.querySelector('#all-promos').scrollIntoView({block:'start'}); window.scrollBy(0,-50);}); await settle(p);
    await label(p,'顏色 '+tag+'（桌機）');
    await p.screenshot({path:OUT+'B-顏色-桌機-'+tag+'.png'}); await p.context().close();
  }

  // ===== C＋D：首屏（引言縮短＋信任 A2＋站長推薦橫卡）=====
  {
    const p = await open(b);
    const v = trustVariants['A2-三格承諾列'];
    await p.addStyleTag({content:HERO_SHORT_CSS+v.css+`.pmc-trust{display:none!important}
     .pmc-picks-row{display:flex!important;flex-direction:column;gap:10px!important;overflow:visible!important;margin-right:0!important;padding-right:0!important}
     .pmc-dots{display:none!important}
     .pmc-pick{display:grid!important;grid-template-columns:92px minmax(0,1fr);grid-template-areas:"q q" "img name" "img badges" "img head" "img thr" "links cta" "dest dest";gap:2px 12px!important;padding:11px 12px 10px!important;align-items:start}
     .pmc-pick-q{grid-area:q;margin:0 0 6px!important;font-size:13.5px!important}
     .pmc-pick-img{grid-area:img;align-self:start}
     .pmc-pick-name{grid-area:name;margin:0!important;font-size:14.5px!important}
     .pmc-pick-badges{grid-area:badges}
     .pmc-pick-headline{grid-area:head;margin:2px 0 0!important;font-size:17px!important;line-height:1.35!important}
     .pmc-pick-headline small{display:inline!important;margin-left:6px;font-size:12px!important}
     .pmc-pick-thr{grid-area:thr;margin:0!important;font-size:12.5px!important}
     .pmc-pick-reason,.pmc-pick-note{display:none!important}
     .pmc-pick-links{grid-area:links;margin-top:8px!important;padding-top:8px!important;border-top:0!important}
     .pmc-pick-cta{margin-top:0!important;align-self:center!important;padding:8px 20px!important}
     .pmc-pick-dest{grid-area:dest;justify-content:flex-end!important;margin-top:4px!important}
     .pmc-pick{grid-template-areas:"q q" "img name" "img badges" "img head" "img thr" "links links" "dest dest"}
     .pmc-pick-links{display:flex!important;align-items:center;gap:8px}
    `});
    await p.evaluate(heroShort);
    await p.evaluate(h=>document.querySelector('.promos-hero').insertAdjacentHTML('afterend',h), v.html);
    // 把申辦鈕搬進 links 列的右邊
    await p.evaluate(()=>document.querySelectorAll('.pmc-pick').forEach(c=>{const l=c.querySelector('.pmc-pick-links'); const cta=c.querySelector('.pmc-pick-cta'); cta.style.marginLeft='auto'; l.appendChild(cta); l.style.gridColumn='1 / -1';}));
    await label(p,'首屏：引言縮短＋信任 A2＋站長推薦橫卡'); await settle(p);
    await p.screenshot({path:OUT+'CD-首屏-引言縮短＋推薦橫卡.png'});
    await p.evaluate(()=>{document.querySelector('.pmc-picks').scrollIntoView({block:'start'}); window.scrollBy(0,-50);}); await settle(p);
    await label(p,'站長推薦橫卡：一屏 2 張多、不必橫滑（現在一屏 1 張）');
    await p.screenshot({path:OUT+'D-站長推薦橫卡.png'}); await p.context().close();
  }

  // ===== E：贈品商品圖 =====
  {
    const p = await open(b);
    await p.addStyleTag({content:`
     .mk-gift{position:relative;margin:0 0 10px;border-radius:10px;overflow:hidden;background:#f3f4f6;aspect-ratio:16/10}
     .mk-gift img{width:100%;height:100%;object-fit:contain;display:block}
     .mk-price{position:absolute;left:10px;bottom:10px;background:#111827;color:#fff;font-size:12.5px;font-weight:700;border-radius:999px;padding:4px 11px}
     .mk-price b{font-size:15px;margin-left:3px}
     .mk-cp{position:absolute;right:10px;bottom:10px;background:#fff;color:#059669;font-size:12.5px;font-weight:700;border-radius:999px;padding:4px 11px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
     #promo-4-yushan-kumamon .promo-act-thumb{display:none!important}
     #promo-4-yushan-kumamon .promo-act-row{display:block!important}
    `});
    await p.evaluate(()=>{ const c=document.querySelector('#promo-4-yushan-kumamon'); const src=c.querySelector('.promo-act-thumb--gift img').src; const body=c.querySelector('.promo-act-body');
      body.insertAdjacentHTML('afterbegin','<span class="mk-gift" style="display:block"><img src="'+src+'"><span class="mk-price">市價約<b>NT$1,680</b></span><span class="mk-cp">刷 NT$2,500 就拿到</span></span>');
      c.scrollIntoView({block:'start'}); window.scrollBy(0,-56); });
    await label(p,'贈品商品圖：大圖＋市價標（金額為示意，需 Sheets 新增商品圖與市價欄）'); await settle(p);
    await p.screenshot({path:OUT+'E-贈品商品圖.png'}); await p.context().close();
  }

  // ===== F：收藏 =====
  {
    const p = await open(b);
    await p.addStyleTag({content:`
     .mk-heart{margin-left:auto;flex:none;width:36px;height:36px;border-radius:50%;border:1px solid #e5e7eb;background:#fff;display:inline-flex;align-items:center;justify-content:center;color:#9ca3af}
     .mk-heart.on{color:#e11d48;border-color:#fecdd3;background:#fff1f2}
     .promo-rail-id{display:flex!important;align-items:center}
     .mk-bar{position:fixed;left:12px;right:12px;bottom:40px;z-index:9998;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px 12px}
     .mk-bar .imgs{display:flex}.mk-bar .imgs img{width:44px;height:28px;object-fit:cover;border-radius:4px;border:2px solid #fff;box-shadow:0 0 0 1px #e5e7eb;margin-right:-10px}
     .mk-bar .t{margin-left:14px;font-size:13.5px;font-weight:700;color:#111827}.mk-bar .t small{display:block;font-size:11.5px;font-weight:500;color:#6b7280}
     .mk-bar .go{margin-left:auto;background:#1e40af;color:#fff;font-size:13px;font-weight:700;border-radius:10px;padding:8px 14px}
    `});
    await p.evaluate(()=>{ const H=on=>'<button class="mk-heart'+(on?' on':'')+'"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 20s-7-4.4-7-9.6A4 4 0 0112 8a4 4 0 017 2.4C19 15.6 12 20 12 20z" fill="'+(on?'currentColor':'none')+'" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>';
      document.querySelectorAll('.promo-card').forEach((c,i)=>c.querySelector('.promo-rail-id').insertAdjacentHTML('beforeend',H(i===2||i===3)));
      document.body.insertAdjacentHTML('beforeend','<div class="mk-bar"><span class="imgs"><img src="assets/images/cards/dbs-eco.png"><img src="assets/images/cards/yushan-kumamon.png"></span><span class="t">已收藏 2 張<small>存在這台裝置，下次來還在</small></span><span class="go">並排比較</span></div>');
      document.querySelector('#promo-3-dbs-eco').scrollIntoView({block:'start'}); window.scrollBy(0,-56); });
    await label(p,'收藏：卡名旁愛心＋底部口袋名單'); await settle(p);
    await p.screenshot({path:OUT+'F-收藏.png'}); await p.context().close();
  }

  // ===== G：單卡頁 =====
  {
    const p = await open(b);
    await p.addStyleTag({content:`
     .mk-h1{margin:6px 0 4px;font-size:1.35rem;font-weight:800;color:#333}
     .mk-lede{margin:0 0 12px;font-size:13.5px;line-height:1.7;color:#4b5563}
     .mk-topcard{display:flex;gap:12px;align-items:center;margin:0 0 10px}
     .mk-topcard img{width:auto;max-width:128px;max-height:104px;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,.18)}
     .mk-facts{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #e5e7eb;border-radius:12px;margin:0 0 12px;overflow:hidden}
     .mk-facts div{padding:9px 6px;text-align:center}.mk-facts div+div{border-left:1px solid #eef0f3}
     .mk-facts small{display:block;font-size:11.5px;color:#6b7280}.mk-facts b{font-size:14px;color:#111827}
     .mk-h2{margin:18px 0 8px;font-size:1.05rem;font-weight:800;color:#333}
     .mk-feat{border:1px solid #e5e7eb;border-radius:12px;padding:6px 12px;background:#fff}
     .mk-rel{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
     .mk-rel a{border:1px solid #e5e7eb;border-radius:10px;padding:8px;text-decoration:none;color:#111827;font-size:12.5px;font-weight:700;background:#fff}
     .mk-rel img{width:100%;border-radius:5px;margin-bottom:6px;display:block}.mk-rel small{display:block;font-weight:600;color:#10b981}
     .mk-cta{display:block;text-align:center;background:#1e40af;color:#fff;font-weight:700;border-radius:10px;padding:11px;text-decoration:none;font-size:15px}
     .promo-card-rail{display:none!important}
    `});
    await p.evaluate(()=>{ const main=document.querySelector('.promos-main'); const card=document.querySelector('#promo-20-taishin-richart'); const feat=card.querySelector('.promo-card-feat').innerHTML; const dest=card.querySelector('.promo-apply-dest').outerHTML;
      card.querySelector('.promo-act-row').click();
      const bc=document.querySelector('.promos-breadcrumb'); bc.innerHTML='<a href="/">首頁</a><span class="promos-breadcrumb-sep">›</span><a href="/promos">新戶活動</a><span class="promos-breadcrumb-sep">›</span><span>台新 Richart 卡</span>';
      [...main.children].forEach(el=>{ if(el!==bc) el.style.display='none'; });
      const wrap=document.createElement('div'); main.appendChild(wrap);
      wrap.innerHTML='<h1 class="mk-h1">台新 Richart 卡新戶活動（2026 年 11 月）</h1><p class="mk-lede">台新 Richart 卡目前有 1 檔新戶活動：首筆保費享 6% 回饋加碼，活動到 2026/12/31。</p>'+
       '<div class="mk-topcard"><img src="assets/images/cards/taishin-richart.png"><div style="flex:1"><a class="mk-cta" href="#">立即申辦</a><div style="margin-top:6px">'+dest+'</div></div></div>'+
       '<div class="mk-facts"><div><small>新戶活動</small><b>1 檔</b></div><div><small>最高加碼</small><b style="color:#10b981">6%</b></div><div><small>截止</small><b>12/31</b></div></div>'+
       '<h2 class="mk-h2">這張卡的新戶活動</h2><div id="mk-card"></div>'+
       '<h2 class="mk-h2">卡片特色</h2><div class="mk-feat">'+feat+'</div>'+
       '<h2 class="mk-h2">也可以看看</h2><div class="mk-rel"><a><img src="assets/images/cards/hsbc-liveplus.png">滙豐 Live+ 卡<small>NT$1,000 刷卡金</small></a><a><img src="assets/images/cards/yushan-unicard.png">玉山 UniCard<small>10% 回饋</small></a><a><img src="assets/images/cards/ctbc-linepay-card.png">中信 LINE Pay 卡<small>NT$300</small></a></div>';
      card.style.display=''; wrap.querySelector('#mk-card').appendChild(card); scrollTo(0,0); });
    await p.evaluate(()=>{document.querySelectorAll('.mk-feat .promo-feat-all').forEach(e=>e.remove());});
    await label(p,'單卡頁 /promos/taishin-richart（每張卡一頁，吃「台新 Richart 新戶」這類搜尋）'); await settle(p);
    await p.screenshot({path:OUT+'G-單卡頁-上.png'});
    await p.evaluate(()=>window.scrollBy(0, innerHeight-90)); await settle(p);
    await p.screenshot({path:OUT+'G-單卡頁-下.png'}); await p.context().close();
  }
  await b.close(); console.log('done');
})();
