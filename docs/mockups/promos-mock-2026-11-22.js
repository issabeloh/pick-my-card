/* 新戶活動頁「依卡片瀏覽」入口 mockup 產生器（2026-11-22，站長尚未選定，選定後可刪）。
 * 做法同 promos-mock-2026-11-17.js：開真正的 promos.html、注入 CSS／DOM 改出方案再截圖。
 * 第二輪（站長選 H1 方向、放頁尾、要更簡潔）：J1 純文字一行一家／J2 分欄目錄／J3 銀行摺疊＋小卡圖。
 * 用法：repo 根目錄 python3 -m http.server 8766 → node docs/mockups/promos-mock-2026-11-22.js <輸出資料夾>
 */
const { chromium, devices } = require('playwright');
const OUT = (process.argv[2] || __dirname + '/mock') + '/';
const URL = 'http://localhost:8766/promos.html';
const BANKS = { febank:'遠東', dbs:'星展', yushan:'玉山', sinopac:'永豐', fubon:'富邦', ctbc:'中信', ubot:'聯邦',
  mega:'兆豐', kgi:'凱基', firstbank:'一銀', taishin:'台新', hsbc:'滙豐', cathay:'國泰', tbb:'企銀' };
const BASECSS = `
 .mk-label{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#111827;color:#fff;font:600 12px/1.5 system-ui;padding:6px 12px;text-align:center}
 .promos-back-to-top-btn,.pmc-fav-bar{display:none!important}
 .mk-new{outline:2px dashed #f59e0b;outline-offset:6px;border-radius:6px}
 /* 共用：卡名連結的樣子沿用清單卡名（藍色「›」） */
 .mk-sec{margin:28px 0 8px}
 .mk-note{margin:2px 2px 12px;font-size:13px;color:#6b7280}
`;
const CSS = {
  J1: `
   .mk-j1{border-top:1px solid #e5e7eb}
   .mk-j1 p{display:grid;grid-template-columns:3.4em 1fr;margin:0;padding:10px 2px;border-bottom:1px solid #f0f1f3;font-size:14px;line-height:1.9;color:#d1d5db}
   .mk-j1 b{font-size:13px;color:#6b7280;font-weight:700}
   .mk-j1 a{color:#1e3a8a;text-decoration:none;font-weight:500}
   .mk-j1 a:hover{text-decoration:underline}
   @media(min-width:900px){.mk-j1{display:grid;grid-template-columns:1fr 1fr;column-gap:40px}}`,
  J2: `
   .mk-j2{display:grid;grid-template-columns:1fr 1fr;gap:18px 20px}
   .mk-j2 h3{margin:0 0 4px;font-size:12px;font-weight:700;color:#9ca3af;letter-spacing:.04em}
   .mk-j2 a{display:block;padding:4px 0;font-size:14px;color:#1f2937;text-decoration:none}
   .mk-j2 a::after{content:" ›";color:#2563eb}
   @media(min-width:900px){.mk-j2{grid-template-columns:repeat(5,1fr)}}`,
  J3: `
   .mk-j3{border-top:1px solid #e5e7eb}
   .mk-j3 details{border-bottom:1px solid #f0f1f3}
   .mk-j3 summary{display:flex;align-items:center;gap:8px;padding:12px 2px;list-style:none;cursor:pointer;font-size:14.5px;font-weight:600;color:#111827}
   .mk-j3 summary::-webkit-details-marker{display:none}
   .mk-j3 summary small{color:#9ca3af;font-weight:500;font-size:13px}
   .mk-j3 summary::after{content:"";margin-left:auto;width:7px;height:7px;border-right:1.8px solid #9ca3af;border-bottom:1.8px solid #9ca3af;transform:rotate(45deg);margin-right:4px}
   .mk-j3 details[open] summary::after{transform:rotate(225deg)}
   .mk-j3 .mk-in{padding:0 2px 12px;display:grid;gap:2px}
   .mk-j3 .mk-in a{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:14px;color:#1e3a8a;text-decoration:none}
   .mk-j3 .mk-in img{width:40px;height:25px;object-fit:contain;border-radius:3px;background:#f5f6f8}
   @media(min-width:900px){.mk-j3{display:grid;grid-template-columns:1fr 1fr 1fr;column-gap:32px;align-items:start}}`
};
function build(kind){
  const BANKS = window.__BANKS;
  const cards = [...document.querySelectorAll('#promo-grid .promo-card[data-card-id]')].map(a=>({id:a.dataset.cardId,name:a.dataset.cardName}));
  const groups = {};
  cards.forEach(c=>{const b=BANKS[c.id.split('-')[0]]||'其他';(groups[b]=groups[b]||[]).push(c);});
  const order = Object.keys(groups).sort((x,y)=>groups[y].length-groups[x].length);
  const short=(c,b)=>c.name.replace(b,'').trim()||c.name;
  const head = `<div class="pmc-section-head" id="by-card"><h2>依卡片找</h2><span>${cards.length} 張卡・點卡名看單卡活動</span></div>`;
  let body;
  if (kind==='J1') body='<div class="mk-j1">'+order.map(b=>`<p><b>${b}</b><span>${groups[b].map(c=>`<a href="#">${short(c,b)}</a>`).join(' ・ ')}</span></p>`).join('')+'</div>';
  else if (kind==='J2') body='<div class="mk-j2">'+order.map(b=>`<div><h3>${b}</h3>${groups[b].map(c=>`<a href="#">${c.name}</a>`).join('')}</div>`).join('')+'</div>';
  else body='<div class="mk-j3">'+order.map((b,i)=>`<details${i===0?' open':''}><summary>${b}<small>${groups[b].length} 張</small></summary><div class="mk-in">${groups[b].map(c=>`<a href="#"><img src="/assets/images/cards/${c.id}.png" alt="">${c.name}</a>`).join('')}</div></details>`).join('')+'</div>';
  const sec=document.createElement('section'); sec.className='mk-sec mk-new'; sec.innerHTML=head+body;
  document.getElementById('promo-grid').after(sec);
  const jump=document.querySelector('.pmc-jump');
  if (jump) jump.insertAdjacentHTML('beforeend','<a href="#by-card" class="mk-new" style="outline-offset:1px">依卡片找</a>');
}
async function open(b, mobile){ const ctx=await b.newContext(mobile?{...devices['iPhone 13']}:{viewport:{width:1440,height:900},deviceScaleFactor:2}); const p=await ctx.newPage(); await p.goto(URL,{waitUntil:'load'}); await p.waitForTimeout(1200); await p.addStyleTag({content:BASECSS}); await p.evaluate(B=>{window.__BANKS=B},BANKS); return p; }
const label=(p,t)=>p.evaluate(t=>{document.body.insertAdjacentHTML('beforeend','<div class="mk-label">'+t+'</div>')},t);
(async()=>{
  const b = await chromium.launch();
  const names = {J1:'J1 純文字一行一家',J2:'J2 分欄目錄',J3:'J3 銀行摺疊＋小卡圖'};
  for (const k of ['J1','J2','J3']) for (const mobile of [true,false]) {
    const p = await open(b, mobile);
    await p.addStyleTag({content:CSS[k]});
    await p.evaluate(build, k);
    await label(p, names[k]+(mobile?'・手機':'・桌機'));
    const box = await (await p.$('.mk-sec')).boundingBox();
    const sy = await p.evaluate(()=>scrollY);
    const vp = p.viewportSize();
    await p.screenshot({path:OUT+`${k}-${mobile?'mobile':'desktop'}.png`, fullPage:true, clip:{x:0,y:box.y+sy-40,width:vp.width,height:box.height+80}});
    if (k==='J1' && mobile) { await p.evaluate(()=>scrollTo(0,0)); await p.waitForTimeout(300); await p.screenshot({path:OUT+'J-mobile-top.png'}); }
    await p.context().close();
  }
  await b.close();
})();
