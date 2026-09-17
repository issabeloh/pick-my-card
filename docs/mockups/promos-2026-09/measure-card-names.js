#!/usr/bin/env node
/* 量測卡名在「卡圖下方一行」放不放得下（2026-09-17）。
 * 先跑 build-data.js 產生 data2.json，再跑這支。
 * 實測結論：卡圖維持 78px 寬時，11px 有 6/22 個卡名放不下，
 * 最長的「中信 Uniopen 聯名卡」要 114px —— 所以卡名預設放最上方獨立一行。
 * 用法：node docs/mockups/promos-2026-09/build-data.js && node docs/mockups/promos-2026-09/measure-card-names.js
 */
const { chromium } = require('/home/user/pick-my-card/node_modules/playwright');
const path = require('path');
const d = JSON.parse(require('fs').readFileSync(path.join(__dirname,'data2.json'),'utf8'));
const names = [...new Set(d.cardGroups.map(g=>g.card).concat(d.giftPromos.map(p=>p.card)))];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  await p.setContent(`<html><head><meta charset="utf-8">
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap">
   <style>span{font-family:"Noto Sans TC","PingFang TC",system-ui;font-weight:700;white-space:nowrap;display:inline-block}</style>
   </head><body><div id="r"></div></body></html>`, { waitUntil:'networkidle' });
  await p.evaluate(()=>document.fonts.ready);
  for (const size of [10,10.5,11,11.5,12,12.5]) {
    const w = await p.evaluate(({names,size})=>{
      const r=document.getElementById('r'); r.innerHTML='';
      return names.map(n=>{ const s=document.createElement('span'); s.style.fontSize=size+'px'; s.textContent=n; r.appendChild(s);
        return {n, w: Math.ceil(s.getBoundingClientRect().width)}; }).sort((a,b)=>b.w-a.w);
    }, {names,size});
    console.log(`\n=== ${size}px  最寬 ${w[0].w}px（${w[0].n}）  第2 ${w[1].w}px（${w[1].n}）  中位 ${w[Math.floor(w.length/2)].w}px`);
    console.log('   >78px 的有 ' + w.filter(x=>x.w>78).length + '/' + w.length +
                '，>90px 的有 ' + w.filter(x=>x.w>90).length +
                '，>100px 的有 ' + w.filter(x=>x.w>100).length);
  }
  await b.close();
})();
