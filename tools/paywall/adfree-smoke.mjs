/* 去廣告付費牆的瀏覽器煙霧測試。
 * 驗的是「完全去除廣告」這句話能不能兌現——用網路攔截確認付費狀態下
 * 對 googlesyndication 的請求數是 0，而不是只看畫面有沒有東西。
 * 跑法：先 python3 -m http.server 8000，再 node tools/paywall/adfree-smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.PMC_BASE || 'http://localhost:8000';
const PAGES = ['/index.html', '/faq.html', '/merchant/momo.html'];

let fail = 0;
function check(name, ok, detail) {
    if (ok) { console.log('✅ ' + name); return; }
    fail = 1;
    console.error('❌ ' + name + (detail ? ' → ' + detail : ''));
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function visit(path, { adfree }) {
    const context = await browser.newContext();
    const adRequests = [];
    await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.includes('googlesyndication.com') || url.includes('googleads.g.doubleclick.net')) {
            adRequests.push(url);
            return route.abort();       // 不真的出去，只記錄有沒有發生
        }
        if (!url.startsWith(BASE)) return route.abort();  // 擋掉 firebase/clarity 等外部資源
        return route.continue();
    });
    const page = await context.newPage();
    // index.html 會把「localStorage 全空」的首訪者導去 landing.html，
    // 所以兩種情境都要先假裝是回訪者，否則量到的是 landing.html。
    await page.addInitScript((isAdfree) => {
        localStorage.setItem('pmc_seen_landing', '1');
        if (isAdfree) localStorage.setItem('pmc_adfree', 'testuid123|' + (Date.now() + 86400000));
    }, adfree);
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const landedOn = new URL(page.url()).pathname;
    const state = await page.evaluate(() => ({
        adRow: !!document.getElementById('ad-row'),
        insCount: document.querySelectorAll('ins.adsbygoogle').length,
        loaderTags: document.querySelectorAll('script[src*="googlesyndication"]').length,
        htmlClass: document.documentElement.className,
        ctaVisible: (() => {
            const el = document.getElementById('adfree-fab');
            return !!el && el.style.display !== 'none';
        })(),
        modalExists: !!document.getElementById('adfree-modal'),
    }));
    await context.close();
    return { adRequests, landedOn, ...state };
}

for (const path of PAGES) {
    console.log('\n— ' + path + ' —');

    const free = await visit(path, { adfree: false });
    check(path + ' 未付費：停在受測頁（沒被導去 landing）', free.landedOn === path, '實際=' + free.landedOn);
    check(path + ' 未付費：仍會載入 AdSense loader', free.adRequests.length > 0,
        '攔截到 ' + free.adRequests.length + ' 個廣告請求');
    check(path + ' 未付費：loader script 有掛上', free.loaderTags === 1, 'loaderTags=' + free.loaderTags);

    const paid = await visit(path, { adfree: true });
    check(path + ' 已付費：停在受測頁', paid.landedOn === path, '實際=' + paid.landedOn);
    check(path + ' 已付費：對 AdSense 的請求數為 0', paid.adRequests.length === 0,
        '仍發出 ' + paid.adRequests.length + ' 個：' + paid.adRequests.join(', '));
    check(path + ' 已付費：頁面上沒有 loader script', paid.loaderTags === 0, 'loaderTags=' + paid.loaderTags);
    check(path + ' 已付費：根元素帶 pmc-adfree', paid.htmlClass.includes('pmc-adfree'), paid.htmlClass);

    if (path === '/index.html' || path.startsWith('/merchant/')) {
        check(path + ' 未付費：廣告版位存在且浮動入口顯示', free.adRow && free.insCount === 1 && free.ctaVisible,
            `adRow=${free.adRow} ins=${free.insCount} cta=${free.ctaVisible}`);
        check(path + ' 已付費：廣告版位已從 DOM 移除', !paid.adRow && paid.insCount === 0,
            `adRow=${paid.adRow} ins=${paid.insCount}`);
        check(path + ' 已付費：去廣告入口隱藏', !paid.ctaVisible, 'ctaVisible=' + paid.ctaVisible);
        check(path + ' 付費 modal 存在', free.modalExists, 'modalExists=' + free.modalExists);
    }
}

await browser.close();
console.log(fail ? '\n❌ 有項目未通過' : '\n✅ 全部通過');
process.exit(fail);
