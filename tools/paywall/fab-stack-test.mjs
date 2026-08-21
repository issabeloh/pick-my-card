/* 右下浮標疊放回歸：四顆浮標（配卡組合/去廣告/精選活動/回到頂部）16 種顯示組合
 * 的位置斷言。跑法：先起 python3 -m http.server 8000，再 node tools/paywall/fab-stack-test.mjs */
// 疊放驗證：四顆浮標 16 種顯示組合，斷言彼此位置不重疊且順序正確
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 400, height: 800 } }); // 手機寬，讓 back-to-top 生效
await page.route('**/*', r => r.request().url().startsWith('http://localhost:8000') ? r.continue() : r.abort());
await page.addInitScript(() => localStorage.setItem('pmc_seen_landing', '1'));
await page.goto('http://localhost:8000/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
let fail = 0;
for (let mask = 0; mask < 16; mask++) {
    const [map, adf, spt, btt] = [1, 2, 4, 8].map(b => !!(mask & b));
    // 切換與讀值分兩步：[style*=…] 的 :has 失效重算發生在下一幀，
    // 同一個 evaluate 裡切完就讀會拿到舊值（就是這個坑讓本測試第一版全紅）。
    await page.evaluate(([map, adf, spt, btt]) => {
        const set = (id, cls, show, useClass) => {
            const el = document.getElementById(id) || document.querySelector(cls);
            if (!el) return;
            if (useClass) { el.classList.toggle('is-visible', show); el.style.display = ''; }
            else el.style.display = show ? '' : 'none';
        };
        set('my-mappings-btn', null, map, false);
        set('adfree-fab', null, adf, false);
        set(null, '.scroll-to-spotlight-btn', spt, true);
        set('back-to-top-btn', null, btt, true);
    }, [map, adf, spt, btt]);
    await page.waitForTimeout(400); // 讓 0.2s 的 bottom transition 跑完
    const bottoms = await page.evaluate(() => {
        const pos = sel => { const el = document.querySelector(sel); if (!el) return null;
            const st = getComputedStyle(el);
            return st.display !== 'none' ? parseFloat(st.bottom) : null; };
        return { map: pos('#my-mappings-btn'), adf: pos('#adfree-fab'), spt: pos('.scroll-to-spotlight-btn'), btt: pos('#back-to-top-btn') };
    });
    // 期望：可見者由下而上依 map<adf<spt<btt 排，位置 = 16 + 56*(下方可見數)
    let expectIdx = 0; const expected = {};
    for (const k of ['map', 'adf', 'spt', 'btt']) {
        const on = { map, adf, spt, btt }[k];
        expected[k] = on ? 16 + 56 * expectIdx++ : null;
    }
    const ok = ['map','adf','spt','btt'].every(k => bottoms[k] === expected[k]);
    if (!ok) { fail = 1; console.error('❌ 組合', {map,adf,spt,btt}, '實際', bottoms, '預期', expected); }
}
console.log(fail ? '❌ 疊放有誤' : '✅ 16 種顯示組合的疊放位置全部正確（無重疊、順序正確）');
await browser.close();
process.exit(fail);
