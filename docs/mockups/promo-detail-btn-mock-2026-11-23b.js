/* 單卡頁「看完整回饋與權益」按鈕 第二輪 mockup（2026-11-23，站長從第一輪挑了位置 A、C，選定後可刪）。
 * A1–A5＝卡片特色框框最下方的五種樣式；C1–C5＝「卡片特色」標題右邊的五種樣式。輸出手機／桌機對照表。
 * 用法同 promo-detail-btn-mock-2026-11-23.js：node promo-detail-btn-mock-2026-11-23b.js <輸出資料夾> [card id]
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const CARD = process.argv[3] || 'sinopac-dawho';
const URL = 'http://localhost:8766/promos/' + CARD + '.html';
const ARR = '<svg class="mk-arr" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CARDIC = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 9.5h18M6.5 14.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const TXT = '看完整回饋與權益';
const HINT = '指定通路、回饋上限、領券停車，都在卡片詳情頁';
const BASE = `.promos-back-to-top-btn{display:none!important}.promo-feat-head:empty{display:none}
 .mk-tag{position:absolute;z-index:50;left:6px;top:6px;background:#111827;color:#fff;font:700 12px/1 system-ui;padding:5px 8px;border-radius:6px}
 @media (min-width:769px){.mk-cap{max-width:340px;margin-left:auto!important;margin-right:auto!important}}`;
const btn = (cls, inner) => `<a class="${cls}" href="#">${inner}</a>`;
// A＝卡片特色框框最下方
const A = {
  A1: { note:'外框按鈕（上一輪）', css:`.v{margin:12px 0 4px;text-align:center}.v p{margin:0 0 8px;font-size:12.5px;color:#6b7280}
      .v a{display:flex;align-items:center;justify-content:center;gap:4px;padding:11px 14px;border:1.5px solid #1e40af;border-radius:10px;background:#fff;color:#1e40af;font-size:14.5px;font-weight:700;text-decoration:none}`,
      html:`<div class="v"><p>${HINT}</p>${btn('mk-cap',TXT+ARR)}</div>` },
  A2: { note:'淡藍底按鈕', css:`.v{margin:12px 0 4px;text-align:center}.v p{margin:8px 0 0;font-size:12px;color:#6b7280}
      .v a{display:flex;align-items:center;justify-content:center;gap:4px;padding:12px 14px;border-radius:10px;background:#e8eeff;color:#1e3a8a;font-size:14.5px;font-weight:700;text-decoration:none}`,
      html:`<div class="v">${btn('mk-cap',TXT+ARR)}<p>${HINT}</p></div>` },
  A3: { note:'整條底欄（像清單列）', css:`.pmc-cp-feat-sec .promo-card-feat{padding-bottom:0!important}
      .v{display:flex;align-items:center;gap:10px;margin:12px -14px 0;padding:12px 14px;border-top:1px solid #e5e7eb;background:#f6f8ff;border-radius:0 0 var(--pmc-radius-md) var(--pmc-radius-md);text-decoration:none;color:inherit}
      .v .ic{flex:none;width:36px;height:36px;border-radius:9px;background:#fff;color:#1e40af;display:grid;place-items:center;border:1px solid #dbe3fb}
      .v b{display:block;font-size:14.5px;color:#1e40af}.v small{display:block;font-size:12px;color:#6b7280;margin-top:1px}
      .v .go{margin-left:auto;flex:none;width:28px;height:28px;border-radius:50%;background:#1e40af;color:#fff;display:grid;place-items:center}`,
      html:`<a class="v" href="#"><span class="ic">${CARDIC}</span><span><b>${TXT}</b><small>指定通路・回饋上限・領券停車</small></span><span class="go">${ARR}</span></a>` },
  A4: { note:'分隔線＋左文右鈕', css:`.v{display:flex;align-items:center;gap:10px;margin:12px 0 4px;padding-top:12px;border-top:1px dashed #d1d9ee}
      .v p{margin:0;font-size:12.5px;line-height:1.5;color:#4b5563}.v p b{display:block;color:#111827;font-size:13.5px}
      .v a{margin-left:auto;flex:none;display:flex;align-items:center;gap:2px;padding:9px 10px 9px 14px;border-radius:999px;background:#1e40af;color:#fff;font-size:13.5px;font-weight:700;text-decoration:none;white-space:nowrap}
      @media (max-width:420px){.v{flex-direction:column;align-items:stretch;text-align:center}.v a{margin:0;justify-content:center;padding:11px}}`,
      html:`<div class="v"><p><b>新戶活動之外，平常怎麼刷？</b>${HINT}</p>${btn('',TXT+ARR)}</div>` },
  A5: { note:'圖示外框按鈕＋重點小標', css:`.v{margin:12px 0 4px}
      .v a{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid #c7d2fe;border-radius:12px;background:#fff;text-decoration:none}
      .v .ic{flex:none;color:#1e40af;display:grid;place-items:center}
      .v b{font-size:14.5px;color:#1e40af}.v .arr{margin-left:auto;color:#1e40af;display:grid}
      .v ul{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;list-style:none;margin:0 0 8px;padding:0}
      .v li{font-size:12px;color:#475569;background:#f1f5f9;border-radius:999px;padding:3px 9px}`,
      html:`<div class="v mk-cap"><ul><li>所有指定通路</li><li>回饋上限</li><li>級別條件</li><li>領券・停車</li></ul><a href="#"><span class="ic">${CARDIC}</span><b>${TXT}</b><span class="arr">${ARR}</span></a></div>` },
};
// C＝「卡片特色」標題右邊
const HEAD = `.pmc-cp-feat-sec .pmc-section-head{display:flex;align-items:center;gap:8px}.pmc-cp-feat-sec .pmc-section-head a{margin-left:auto;white-space:nowrap;text-decoration:none}`;
const C = {
  C1: { note:'外框膠囊（上一輪）', css:`.v{display:inline-flex;align-items:center;gap:2px;padding:6px 10px 6px 12px;border:1.5px solid #1e40af;border-radius:999px;background:#fff;color:#1e40af;font-size:13px;font-weight:700}`, html:btn('v',TXT+ARR) },
  C2: { note:'淡藍底膠囊', css:`.v{display:inline-flex;align-items:center;gap:2px;padding:7px 10px 7px 13px;border-radius:999px;background:#e8eeff;color:#1e3a8a;font-size:13px;font-weight:700}`, html:btn('v',TXT+ARR) },
  C3: { note:'實心膠囊', css:`.v{display:inline-flex;align-items:center;gap:2px;padding:7px 10px 7px 13px;border-radius:999px;background:#1e40af;color:#fff;font-size:13px;font-weight:700;box-shadow:0 2px 6px rgba(30,64,175,.25)}`, html:btn('v',TXT+ARR) },
  C4: { note:'文字＋圓形箭頭', css:`.v{display:inline-flex;align-items:center;gap:6px;color:#1e40af;font-size:13.5px;font-weight:700}
      .v .go{width:24px;height:24px;border-radius:50%;background:#1e40af;color:#fff;display:grid;place-items:center}.v .go svg{width:14px;height:14px}`,
      html:`<a class="v" href="#">${TXT}<span class="go">${ARR}</span></a>` },
  C5: { note:'方角小按鈕＋圖示', css:`.v{display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#1e3a8a;font-size:13px;font-weight:700;box-shadow:0 1px 2px rgba(15,23,42,.06)}.v svg{color:#1e40af}`,
      html:`<a class="v" href="#">${CARDIC.replace('width="20" height="20"','width="16" height="16"')}${TXT}${ARR}</a>` },
};
async function one(b, key, def, pos, mobile) {
  const ctx = await b.newContext(mobile ? {...devices['iPhone 13'], deviceScaleFactor:2} : {viewport:{width:1280,height:900},deviceScaleFactor:2});
  const p = await ctx.newPage(); await p.goto(URL,{waitUntil:'load'}); await p.waitForTimeout(900);
  await p.addStyleTag({content: BASE + (pos==='C'?HEAD:'') + def.css});
  const clip = await p.evaluate(({pos, html, tag}) => {
    document.querySelector('.pmc-cp-feat-sec .promo-feat-all').remove();
    const sec = document.getElementById('pmc-cp-feat-sec'), f = sec.querySelector('.promo-card-feat');
    if (pos==='A') f.insertAdjacentHTML('beforeend', html);
    else { const h = sec.querySelector('.pmc-section-head'); h.insertAdjacentHTML('beforeend', html);
      h.insertAdjacentHTML('afterend','<p style="margin:-4px 0 8px;font-size:12.5px;color:#6b7280">申辦後平常刷卡的回饋重點</p>'); }
        window.scrollTo(0, sec.getBoundingClientRect().top + scrollY - 40);
    const r = sec.getBoundingClientRect(), fr = f.getBoundingClientRect();
    const x = Math.max(0, fr.left - 12), w = Math.min(innerWidth, fr.right + 12) - x;
    if (pos==='C') return {x, y:r.top - 4, width:w, height: Math.min(300, r.height)};
    const rows = f.querySelectorAll('.promo-feat-row'); const top = rows[Math.max(0, rows.length-2)].getBoundingClientRect().top - 8;
    return {x, y: top, width:w, height: fr.bottom + 12 - top};
  }, {pos, html:def.html, tag:key+' '+def.note});
  await p.waitForTimeout(300);
  const file = `${OUT}/${key}-${mobile?'m':'d'}.png`; await p.screenshot({path:file, clip}); await ctx.close(); return {file, tag:key+'　'+def.note};
}
(async()=>{
  const b = await chromium.launch(); const shots = {A:[],C:[],Ad:[],Cd:[]};
  for (const [k,d] of Object.entries(A)) { shots.A.push(await one(b,k,d,'A',true)); shots.Ad.push(await one(b,k,d,'A',false)); }
  for (const [k,d] of Object.entries(C)) { shots.C.push(await one(b,k,d,'C',true)); shots.Cd.push(await one(b,k,d,'C',false)); }
  // 合成對照表
  const sheet = async (name, files, cols, w) => {
    const ctx = await b.newContext({viewport:{width:w,height:400},deviceScaleFactor:1}); const p = await ctx.newPage();
    const imgs = files.map(f=>`<figure><figcaption>${f.tag}</figcaption><img src="data:image/png;base64,${fs.readFileSync(f.file).toString('base64')}"></figure>`).join('');
    await p.setContent(`<style>body{margin:0;padding:16px;background:#e5e7eb;font-family:system-ui}.g{display:grid;grid-template-columns:repeat(${cols},1fr);gap:16px;align-items:start}figure{margin:0}figcaption{font:700 15px/1.3 system-ui;color:#111827;margin:0 0 6px 2px}img{display:block;width:100%;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.15);background:#fff}</style><div class="g">${imgs}</div>`);
    await p.waitForTimeout(300); await p.screenshot({path:`${OUT}/${name}.png`, fullPage:true}); await ctx.close(); console.log(`${OUT}/${name}.png`);
  };
  await sheet('sheet-A-mobile', shots.A, 3, 1200);
  await sheet('sheet-C-mobile', shots.C, 3, 1200);
  await sheet('sheet-A-desktop', shots.Ad, 1, 1100);
  await sheet('sheet-C-desktop', shots.Cd, 1, 1100);
  await b.close();
})();
