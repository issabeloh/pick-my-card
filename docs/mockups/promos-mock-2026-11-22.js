/* 新戶活動頁「依卡片瀏覽」入口 mockup 產生器（2026-11-22，站長尚未選定，選定後可刪）。
 * 做法同 promos-mock-2026-11-17.js：開真正的 promos.html、注入 CSS／DOM 改出方案再截圖。
 * 方案：H1 銀行分組卡名目錄（攤開）／H2 銀行頁籤＋卡圖／H3 頁尾卡片索引。
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
  H1: `
   .mk-dir{display:grid;gap:0;border-top:1px solid #eef0f3}
   .mk-bank{display:grid;grid-template-columns:52px 1fr;gap:8px;padding:8px 2px;border-bottom:1px solid #eef0f3;align-items:baseline}
   .mk-bank h3{margin:0;font-size:13px;font-weight:700;color:#6b7280}
   .mk-bank h3 small{font-weight:600;color:#9ca3af;margin-left:3px}
   .mk-names{display:flex;flex-wrap:wrap;gap:6px}
   .mk-names a{display:inline-flex;align-items:center;gap:2px;padding:4px 10px;border:1px solid #dbe3f0;border-radius:999px;background:#fff;color:#1e3a8a;font-size:13px;font-weight:600;text-decoration:none;white-space:nowrap}
   .mk-names a::after{content:"›";color:#2563eb;font-weight:700;margin-left:2px}
   @media(min-width:900px){.mk-dir{grid-template-columns:1fr 1fr;column-gap:32px}.mk-bank{grid-template-columns:96px 1fr}}`,
  H2: `
   .mk-tabs{display:flex;gap:6px;overflow-x:auto;padding:2px 2px 10px;scrollbar-width:none}
   .mk-tabs button{flex:none;padding:6px 12px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;font:inherit;font-size:13px;font-weight:600;color:#374151}
   .mk-tabs button.on{background:#1e40af;border-color:#1e40af;color:#fff}
   .mk-tabs button small{opacity:.7;margin-left:3px}
   .mk-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
   .mk-cards a{display:block;padding:8px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;text-decoration:none;color:#111827}
   .mk-cards img{display:block;width:100%;aspect-ratio:8/5;object-fit:contain;border-radius:6px;background:#f5f6f8}
   .mk-cards b{display:block;margin-top:6px;font-size:13.5px;line-height:1.35}
   .mk-cards b::after{content:" ›";color:#2563eb}
   .mk-cards small{display:block;font-size:12px;color:#6b7280;margin-top:2px}
   @media(min-width:900px){.mk-cards{grid-template-columns:repeat(5,1fr)}}`,
  H3: `
   .mk-foot{columns:2;column-gap:20px;padding:14px 16px;background:#f5f6f8;border-radius:12px}
   .mk-foot div{break-inside:avoid;margin:0 0 12px}
   .mk-foot h3{margin:0 0 4px;font-size:12.5px;color:#6b7280}
   .mk-foot a{display:block;padding:3px 0;font-size:13.5px;color:#1e3a8a;text-decoration:none}
   @media(min-width:900px){.mk-foot{columns:5}}`
};
function build(kind){
  const BANKS = window.__BANKS;
  const cards = [...document.querySelectorAll('#promo-grid .promo-card[data-card-id]')].map(a=>({id:a.dataset.cardId,name:a.dataset.cardName,n:+(a.dataset.actCount||1)}));
  const groups = {};
  cards.forEach(c=>{const b=BANKS[c.id.split('-')[0]]||'其他';(groups[b]=groups[b]||[]).push(c);});
  const order = Object.keys(groups).sort((x,y)=>groups[y].length-groups[x].length);
  const total = cards.length;
  const head = (t,s)=>`<div class="pmc-section-head" id="by-card"><h2>${t}</h2><span>${s}</span></div>`;
  let html;
  if (kind==='H1') {
    html = head('依信用卡瀏覽',`${total} 張卡・點卡名看這張卡的新戶活動`) + '<div class="mk-dir">' +
      order.map(b=>`<div class="mk-bank"><h3>${b}<small>${groups[b].length}</small></h3><div class="mk-names">${groups[b].map(c=>`<a href="#">${c.name.replace(b,'').trim()||c.name}</a>`).join('')}</div></div>`).join('') + '</div>';
  } else if (kind==='H2') {
    const first = groups[order[0]];
    html = head('依信用卡瀏覽',`${total} 張卡`) + '<div class="mk-tabs">' +
      order.map((b,i)=>`<button class="${i?'':'on'}">${b}<small>${groups[b].length}</small></button>`).join('') + '</div><div class="mk-cards">' +
      first.map(c=>`<a href="#"><img src="/assets/images/cards/${c.id}.png" alt=""><b>${c.name}</b><small>${c.n} 檔活動</small></a>`).join('') + '</div>';
  } else {
    html = head('所有有新戶活動的卡',`${total} 張`) + '<div class="mk-foot">' +
      order.map(b=>`<div><h3>${b}</h3>${groups[b].map(c=>`<a href="#">${c.name}</a>`).join('')}</div>`).join('') + '</div>';
  }
  const sec = document.createElement('section'); sec.className='mk-sec mk-new'; sec.innerHTML=html;
  if (kind==='H3') document.querySelector('.promos-warning-row').before(sec);
  else document.getElementById('all-promos').before(sec);
  // 頁內導覽多一顆
  const jump = document.querySelector('.pmc-jump');
  if (jump && kind!=='H3') jump.querySelector('a[href="#all-promos"]').insertAdjacentHTML('beforebegin','<a href="#by-card" class="mk-new" style="outline-offset:1px">依卡片找</a>');
  return sec;
}
async function open(b, mobile){ const ctx=await b.newContext(mobile?{...devices['iPhone 13']}:{viewport:{width:1440,height:900},deviceScaleFactor:2}); const p=await ctx.newPage(); await p.goto(URL,{waitUntil:'load'}); await p.waitForTimeout(1200); await p.addStyleTag({content:BASECSS}); await p.evaluate(B=>{window.__BANKS=B},BANKS); return p; }
const label=(p,t)=>p.evaluate(t=>{document.body.insertAdjacentHTML('beforeend','<div class="mk-label">'+t+'</div>')},t);
(async()=>{
  const b = await chromium.launch();
  const names = {H1:'H1 銀行分組卡名目錄（建議）',H2:'H2 銀行頁籤＋卡圖',H3:'H3 頁尾卡片索引'};
  for (const k of ['H1','H2','H3']) for (const mobile of [true,false]) {
    if (!mobile && k!=='H1') continue;
    const p = await open(b, mobile);
    await p.addStyleTag({content:CSS[k]});
    await p.evaluate(build, k);
    await p.evaluate(()=>{const s=document.querySelector('.mk-sec');window.scrollTo(0,s.getBoundingClientRect().top+scrollY-80)});
    await p.waitForTimeout(600);
    await label(p, names[k]+(mobile?'・手機':'・桌機'));
    const sec = await p.$('.mk-sec');
    const box = await sec.boundingBox();
    const vp = p.viewportSize();
    const clipH = Math.min(box.height+120, mobile?1400:1100);
    await p.screenshot({path:OUT+`${k}-${mobile?'mobile':'desktop'}.png`, fullPage:true, clip:{x:0,y:Math.max(0,box.y+ (await p.evaluate(()=>scrollY)) -60),width:vp.width,height:clipH}});
    if (mobile && k!=='H3') { // 頁首：看頁內導覽多出的那顆
      await p.evaluate(()=>scrollTo(0,0)); await p.waitForTimeout(300);
      await p.screenshot({path:OUT+`${k}-mobile-top.png`});
    }
    await p.context().close();
  }
  await b.close();
})();
