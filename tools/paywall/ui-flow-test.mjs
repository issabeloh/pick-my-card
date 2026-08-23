/* 付費牆 UI 流程回歸：購買視圖／結果視圖切換、我的帳號 modal、以及
 * 「絕不使用系統彈窗」這條（手機上 alert 會蓋住整頁，體驗差）。
 * Firebase 與後端 API 都用假的——這裡驗的是前端流程，不是金流。
 * 跑法：先起 python3 -m http.server 8000，再 node tools/paywall/ui-flow-test.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:8000';
let fail = 0;
const check = (name, ok, detail) => {
    if (ok) { console.log('✅ ' + name); return; }
    fail = 1; console.error('❌ ' + name + (detail ? ' → ' + detail : ''));
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// adfree=true 時預先寫入本機旗標；entitled 決定假 API 回什麼
async function open({ loggedIn = true, adfreeFlag = false, entitled = false, query = '', staleIntent = false, authDelayMs = 0 } = {}) {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(BASE)) return route.continue();
        return route.abort();   // 擋掉 firebase/adsense/clarity 等外部資源
    });
    const page = await ctx.newPage();
    await page.addInitScript(([loggedIn, adfreeFlag, entitled, staleIntent, authDelayMs]) => {
        localStorage.setItem('pmc_seen_landing', '1');
        if (staleIntent) sessionStorage.setItem('pmc_adfree_intent', '1');
        if (adfreeFlag) localStorage.setItem('pmc_adfree', 'testuid123|' + (Date.now() + 86400000));
        if (loggedIn) {
            const fakeUser = {
                uid: 'testuid123', email: 'test@example.com',
                getIdToken: async () => 'faketoken',
            };
            if (authDelayMs > 0) {
                // 模擬真實情況：整頁重載後 Firebase 要一段時間才還原 currentUser
                window.firebaseAuth = { currentUser: null };
                setTimeout(() => { window.firebaseAuth.currentUser = fakeUser; }, authDelayMs);
            } else {
                window.firebaseAuth = { currentUser: fakeUser };
            }
        }
        // 記錄系統彈窗是否被呼叫（本專案的要求是永遠不用）
        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(m);
        // 攔截 Firestore 寫入，驗證「自動通知管理員」有沒有真的送出
        window.__feedback = [];
        window.addDoc = async (_col, doc) => { window.__feedback.push(doc); return { id: 'fake' }; };
        window.collection = () => ({});
        window.serverTimestamp = () => 'ts';
        window.db = {};
        // 假後端
        const realFetch = window.fetch;
        window.fetch = async (input, init) => {
            const u = String(input && input.url ? input.url : input);
            if (u.includes('/api/entitlement')) {
                return new Response(JSON.stringify({ adfree: entitled, grantedAt: entitled ? 1755000000000 : null }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (u.includes('/api/order-status')) {
                const body = { adfree: entitled, status: entitled ? 'paid' : 'pending', tradeNo: 'PMCTEST01' };
                if (window.__providerStatus) body.providerStatus = window.__providerStatus;
                return new Response(JSON.stringify(body),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (u.includes('/api/account/purge')) {
                window.__purged = true;
                return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return realFetch(input, init);
        };
    }, [loggedIn, adfreeFlag, entitled, staleIntent, authDelayMs]);
    await page.goto(BASE + '/index.html' + query, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    return { ctx, page };
}

// 注意：不能用 offsetParent 判斷可見性——position:fixed 的元素 offsetParent
// 永遠是 null，而本專案所有 .modal 都是 fixed（這個坑讓本測試第一版誤報兩紅）。
const vis = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
}, sel);
const text = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);

// ── A. 未登入點浮標 → 先要求登入 ──────────────────────
{
    const { ctx, page } = await open({ loggedIn: false });
    await page.click('#adfree-fab');
    await page.waitForTimeout(300);
    check('未登入點「移除廣告」→ 跳登入而非購買表單',
        await vis(page, '#auth-modal') && !(await vis(page, '#adfree-modal')));
    await ctx.close();
}

// ── B. 已登入、未購買 → 購買表單 ──────────────────────
{
    const { ctx, page } = await open({ entitled: false });
    await page.click('#adfree-fab');
    await page.waitForTimeout(300);
    check('未購買 → 顯示購買表單',
        await vis(page, '#adfree-purchase-view') && !(await vis(page, '#adfree-result-view')));
    check('未購買 → 同意條款前「前往付款」為停用',
        await page.evaluate(() => document.getElementById('adfree-pay-btn').disabled));
    await ctx.close();
}

// ── C. 已購買者再次開啟 → 狀態視圖，不再看到購買表單 ──
{
    const { ctx, page } = await open({ adfreeFlag: true, entitled: true });
    await page.evaluate(() => { openAdfreeModal(); });
    await page.waitForTimeout(300);
    check('已購買 → 顯示狀態視圖而非購買表單',
        (await vis(page, '#adfree-result-view')) && !(await vis(page, '#adfree-purchase-view')));
    check('已購買 → 標題為「你已移除廣告」',
        (await text(page, '#adfree-result-title')).includes('已移除廣告'),
        await text(page, '#adfree-result-title'));
    await ctx.close();
}

// ── D. 付款導回：結果顯示在 modal 內，且完全不用系統彈窗 ──
{
    const { ctx, page } = await open({ entitled: true, query: '?pmc_pay=success' });
    await page.waitForTimeout(1200);
    check('付款導回 → modal 內顯示成功結果',
        (await vis(page, '#adfree-result-view')) && (await text(page, '#adfree-result-title')).includes('付款完成'),
        await text(page, '#adfree-result-title'));
    check('付款導回 → 沒有任何系統彈窗',
        (await page.evaluate(() => window.__alerts.length)) === 0,
        JSON.stringify(await page.evaluate(() => window.__alerts)));
    check('付款導回 → 網址上的付款參數已清掉',
        !(await page.evaluate(() => location.search)).includes('pmc_pay'),
        await page.evaluate(() => location.search));
    check('付款導回 → 廣告位已從 DOM 移除',
        await page.evaluate(() => !document.getElementById('ad-row')));
    await ctx.close();
}

// ── E. 付款失敗導回：通知管理員、不提供會誤導的「重新查詢」 ──
{
    const { ctx, page } = await open({ entitled: false, query: '?pmc_pay=failed&pmc_err=T0004' });
    await page.waitForTimeout(900);
    check('付款失敗 → 標題為「付款失敗」、無系統彈窗',
        (await text(page, '#adfree-result-title')) === '付款失敗'
        && (await page.evaluate(() => window.__alerts.length)) === 0,
        await text(page, '#adfree-result-title'));
    const msg = await text(page, '#adfree-result-message');
    check('付款失敗 → 文案包含三個要點',
        msg.includes('已通知管理員') && msg.includes('稍後再嘗試') && msg.includes('未向你收取任何費用'), msg);
    const fb = await page.evaluate(() => window.__feedback);
    check('付款失敗 → 自動通知管理員且帶上錯誤代碼與中文說明',
        fb.length === 1 && fb[0].message.includes('T0004') && fb[0].message.includes('額度不足'),
        JSON.stringify(fb));
    check('付款失敗 → 不提供「重新查詢訂單」（避免顯示既有權益而誤導）',
        !(await vis(page, '#adfree-result-recheck')));
    check('付款失敗 → 可以關閉（流程已結束）', await vis(page, '#adfree-result-close'));
    check('付款失敗 → 網址上的錯誤代碼已清掉',
        !(await page.evaluate(() => location.search)).includes('pmc_err'),
        await page.evaluate(() => location.search));
    await ctx.close();
}

// ── F. 我的帳號 modal ─────────────────────────────────
for (const entitled of [true, false]) {
    const { ctx, page } = await open({ entitled, adfreeFlag: entitled });
    await page.evaluate(() => { openAccountModal(); });
    await page.waitForTimeout(400);
    check(`我的帳號（${entitled ? '已購買' : '未購買'}）→ modal 開啟且顯示 email`,
        (await vis(page, '#account-modal')) && (await text(page, '#account-email')) === 'test@example.com',
        await text(page, '#account-email'));
    check(`我的帳號（${entitled ? '已購買' : '未購買'}）→ 廣告移除狀態正確`,
        (await text(page, '#account-adfree-status')) === (entitled ? '已購買' : '未購買'),
        await text(page, '#account-adfree-status'));
    check(`我的帳號（${entitled ? '已購買' : '未購買'}）→ 購買鈕顯示正確`,
        (await vis(page, '#account-buy-adfree')) === !entitled);
    if (entitled) {
        check('我的帳號（已購買）→ 顯示購買日期說明',
            (await text(page, '#account-adfree-note')).includes('永久有效'),
            await text(page, '#account-adfree-note'));
    }
    await ctx.close();
}

// ── G. 付款確認不到 → 自動通知管理員，並如實告知用戶 ──
{
    const { ctx, page } = await open({ entitled: false });
    await page.evaluate(() => recheckOrder());
    await page.waitForTimeout(400);
    const fb = await page.evaluate(() => window.__feedback);
    check('確認不到付款 → 自動建立一筆問題回報', fb.length === 1 && fb[0].message.includes('PMCTEST01'),
        JSON.stringify(fb));
    check('確認不到付款 → 回報帶著用戶身分（管理員才對得起來）',
        fb[0] && fb[0].userId === 'testuid123' && fb[0].userEmail === 'test@example.com');
    check('確認不到付款 → 畫面告知已通知管理員、請明天再試',
        (await text(page, '#adfree-result-message')).includes('已自動通知管理員')
        && (await text(page, '#adfree-result-message')).includes('明天'),
        await text(page, '#adfree-result-message'));
    check('確認不到付款 → 仍然沒有系統彈窗',
        (await page.evaluate(() => window.__alerts.length)) === 0);
    await ctx.close();
}

// ── H. 刪除帳號：已購買才顯示權益警告；清理會呼叫後端 ──
for (const entitled of [true, false]) {
    const { ctx, page } = await open({ entitled, adfreeFlag: entitled });
    // 真的開啟刪除帳號 modal（而不是只呼叫那個更新函式）——順便驗證
    // openDeleteAccountModal 裡的整合點有接上。currentUser 是 auth-user-data.js
    // 的全域變數，Firebase 沒載入時要自己補上。
    await page.evaluate(() => {
        currentUser = { uid: 'testuid123', email: 'test@example.com', providerData: [{ providerId: 'google.com' }] };
        openDeleteAccountModal();
    });
    await page.waitForTimeout(400);
    check(`刪除帳號 modal（${entitled ? '已購買' : '未購買'}）→ 有開起來`,
        await vis(page, '#delete-account-modal'));
    check(`刪除帳號警告（${entitled ? '已購買' : '未購買'}）→ 顯示狀態正確`,
        (await vis(page, '#da-adfree-item')) === entitled);
    if (entitled) {
        check('刪除帳號警告 → 說明權益消失且不退款',
            (await text(page, '#da-adfree-item')).includes('不予退款'),
            await text(page, '#da-adfree-item'));
    }
    await ctx.close();
}
{
    const { ctx, page } = await open({ entitled: true, adfreeFlag: true });
    const res = await page.evaluate(async () => {
        await purgePaywallDataForAccountDeletion();
        return { purged: !!window.__purged, flag: localStorage.getItem('pmc_adfree') };
    });
    check('刪除帳號 → 呼叫後端清除付費資料且清掉本機旗標',
        res.purged === true && res.flag === null, JSON.stringify(res));
    await ctx.close();
}

// ── I. header logo 可點擊回首頁 ──
{
    const { ctx, page } = await open({});
    check('header logo 是連往首頁的連結',
        await page.evaluate(() => {
            const a = document.querySelector('.header-logo-link');
            return !!a && new URL(a.href).pathname === '/' && !!a.querySelector('img.header-logo');
        }));
    await ctx.close();
}

// ── J. 下拉選單瘦身：帳號相關三項只在「我的帳號」modal 裡 ──
{
    const { ctx, page } = await open({ entitled: false });
    const state = await page.evaluate(() => {
        // 模擬登入後的頭像狀態（Firebase 沒載入，直接呼叫既有函式）
        const btn = document.getElementById('avatar-btn');
        btn.click();  // 開下拉
        return null;
    });
    // 直接檢查三個下拉項目在「登入狀態」下是否被隱藏
    await page.evaluate(() => {
        ['avatar-delete-account', 'avatar-delete-divider', 'avatar-remove-ads', 'avatar-sign-out']
            .forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        document.getElementById('avatar-account').style.display = '';
    });
    for (const id of ['avatar-remove-ads', 'avatar-sign-out', 'avatar-delete-account']) {
        check(`下拉選單不再顯示 #${id}`, !(await vis(page, '#' + id)));
        check(`#${id} 仍留在 DOM（訪客登入入口與 modal 轉呼叫需要它）`,
            await page.evaluate((i) => !!document.getElementById(i), id));
    }
    check('下拉選單保留「我的帳號」', await vis(page, '#avatar-account'));
    await ctx.close();
}

// ── K. 我的帳號 modal 三顆按鈕都在 ──
{
    const { ctx, page } = await open({ entitled: false });
    await page.evaluate(() => openAccountModal());
    await page.waitForTimeout(400);
    check('帳號 modal：有購買、登出、刪除帳戶三個入口',
        (await vis(page, '#account-buy-adfree')) && (await vis(page, '#account-sign-out'))
        && (await vis(page, '#account-delete')));
    check('帳號 modal：刪除帳戶會開啟 main 的刪除流程', await page.evaluate(async () => {
        currentUser = { uid: 'testuid123', email: 'test@example.com', providerData: [{ providerId: 'google.com' }] };
        document.getElementById('account-delete').click();
        await new Promise((r) => setTimeout(r, 300));
        const m = document.getElementById('delete-account-modal');
        return getComputedStyle(m).display !== 'none';
    }));
    await ctx.close();
}

// ── L. 頭像按鈕四種狀態尺寸一致 ──
{
    const { ctx, page } = await open({});
    const sizes = await page.evaluate(() => {
        const btn = document.getElementById('avatar-btn');
        const photo = document.getElementById('user-photo');
        const icon = document.getElementById('guest-avatar-icon');
        const name = document.getElementById('user-name');
        const measure = () => { const r = btn.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; };
        const out = {};
        // 訪客
        icon.style.display = ''; photo.style.display = 'none'; name.textContent = '';
        out.guest = measure();
        // 登入有頭像
        icon.style.display = 'none'; photo.style.display = 'block';
        photo.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        name.textContent = '測試使用者';
        out.withPhoto = measure();
        // 登入無頭像（email 帳號）→ 走預設圓形圖示
        photo.style.display = 'none'; icon.style.display = '';
        out.noPhoto = measure();
        return out;
    });
    check('登入有無頭像時按鈕高度一致', sizes.withPhoto.h === sizes.noPhoto.h, JSON.stringify(sizes));
    check('訪客狀態按鈕高度也一致', sizes.guest.h === sizes.withPhoto.h, JSON.stringify(sizes));
    check('按鈕高度符合固定值 38px', sizes.withPhoto.h === 38, JSON.stringify(sizes));
    check('登入有無頭像時按鈕寬度一致', sizes.withPhoto.w === sizes.noPhoto.w, JSON.stringify(sizes));
    check('訪客按鈕不會塌成一條（最小寬度生效）', sizes.guest.w >= 72, JSON.stringify(sizes));
    await ctx.close();
}

// ── M. modal 內的按鈕必須看得見（.auth-btn 基礎樣式是白字白底，曾整顆隱形）──
{
    const { ctx, page } = await open({ entitled: false });
    await page.evaluate(() => openAccountModal());
    await page.waitForTimeout(400);
    const contrast = await page.evaluate(() => {
        // 取元素與其背後 modal 內容的顏色，粗略比對亮度差
        const lum = (c) => {
            const m = c.match(/\d+(\.\d+)?/g).map(Number);
            return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
        };
        const out = {};
        for (const id of ['account-sign-out', 'account-delete', 'account-buy-adfree']) {
            const el = document.getElementById(id);
            if (!el) { out[id] = null; continue; }
            const st = getComputedStyle(el);
            let bg = st.backgroundColor;
            // 背景透明就往上找到第一個不透明的祖先
            let node = el;
            while (bg === 'rgba(0, 0, 0, 0)' && node.parentElement) {
                node = node.parentElement;
                bg = getComputedStyle(node).backgroundColor;
            }
            out[id] = Math.abs(lum(st.color) - lum(bg));
        }
        return out;
    });
    for (const [id, diff] of Object.entries(contrast)) {
        check(`#${id} 的文字與背景有足夠對比（不是白字白底）`, diff !== null && diff > 40,
            '亮度差=' + diff);
    }
    await ctx.close();
}

// ── N. 「確認付款中」時不能讓用戶關掉（流程還在跑）──
{
    const { ctx, page } = await open({ entitled: false });
    await page.evaluate(() => showAdfreeResult('pending', '確認付款中…', '測試', { busy: true }));
    await page.waitForTimeout(200);
    check('確認中：「知道了」隱藏', !(await vis(page, '#adfree-result-close')));
    check('確認中：右上角 X 也隱藏', !(await vis(page, '#close-adfree-modal')));
    check('確認中：顯示轉圈告訴用戶還在跑', await vis(page, '#adfree-result-spinner'));
    // 有結論後兩顆都要回來
    await page.evaluate(() => showAdfreeResult('success', '完成', '測試'));
    await page.waitForTimeout(200);
    check('有結論後：「知道了」回來', await vis(page, '#adfree-result-close'));
    check('有結論後：X 回來', await vis(page, '#close-adfree-modal'));
    check('有結論後：轉圈消失', !(await vis(page, '#adfree-result-spinner')));
    await ctx.close();
}

// ── O. 下拉選單不再有孤兒分隔線 ──
{
    const { ctx, page } = await open({});
    check('下拉選單已無 avatar-dropdown-divider 元素',
        await page.evaluate(() => document.querySelectorAll('.avatar-dropdown-divider').length === 0));
    await ctx.close();
}

// ── P. 付款導回時，殘留的「登入後自動開購買視窗」意圖不得蓋掉結果畫面 ──
//    sessionStorage 會活過「跳去金流商再回來」，這正是站長看到購買畫面
//    閃現幾秒的原因（2026-08-21）。
{
    const { ctx, page } = await open({ entitled: true, query: '?pmc_pay=success', staleIntent: true });
    // 觀察整段期間：只要曾經出現購買視圖就算失敗
    const sawPurchase = await page.evaluate(async () => {
        let seen = false;
        for (let i = 0; i < 40; i++) {
            const el = document.getElementById('adfree-purchase-view');
            if (el && getComputedStyle(el).display !== 'none'
                && el.getBoundingClientRect().height > 0) { seen = true; break; }
            await new Promise((r) => setTimeout(r, 100));
        }
        return seen;
    });
    check('付款導回：全程都不會閃出購買視圖', !sawPurchase);
    check('付款導回：最後顯示成功結果',
        (await text(page, '#adfree-result-title')).includes('付款完成'),
        await text(page, '#adfree-result-title'));
    check('付款導回：殘留意圖旗標已清除',
        (await page.evaluate(() => sessionStorage.getItem('pmc_adfree_intent'))) === null);
    await ctx.close();
}

// ── Q. 購買 pill 在「廣告移除」那一列內、且看得見 ──
{
    const { ctx, page } = await open({ entitled: false });
    await page.evaluate(() => openAccountModal());
    await page.waitForTimeout(400);
    check('購買 pill 在「廣告移除」那一列內',
        await page.evaluate(() => {
            const pill = document.getElementById('account-buy-adfree');
            const row = document.getElementById('account-adfree-status').closest('.account-row');
            return !!pill && !!row && row.contains(pill);
        }));
    check('購買 pill 看得見（未購買時）', await vis(page, '#account-buy-adfree'));
    await ctx.close();
}
{
    const { ctx, page } = await open({ entitled: true, adfreeFlag: true });
    await page.evaluate(() => openAccountModal());
    await page.waitForTimeout(400);
    check('已購買時購買 pill 隱藏', !(await vis(page, '#account-buy-adfree')));
    await ctx.close();
}

// ── R. 金流商回報「處理中」時不該驚動管理員（3D 驗證常見）──
{
    const { ctx, page } = await open({ entitled: false });
    await page.evaluate(() => { window.__providerStatus = 'charging'; });
    await page.evaluate(() => recheckOrder());
    await page.waitForTimeout(400);
    check('交易處理中 → 不建立問題回報',
        (await page.evaluate(() => window.__feedback.length)) === 0);
    check('交易處理中 → 告知用戶稍候再查、不會重複扣款',
        (await text(page, '#adfree-result-title')).includes('處理中')
        && (await text(page, '#adfree-result-message')).includes('不需要再付一次'),
        await text(page, '#adfree-result-title'));
    check('交易處理中 → 提供再查一次的入口', await vis(page, '#adfree-result-recheck'));
    await ctx.close();
}
// 對照組：沒有 charging 時仍要通報
{
    const { ctx, page } = await open({ entitled: false });
    await page.evaluate(() => recheckOrder());
    await page.waitForTimeout(400);
    check('確認不到（非處理中）→ 仍會通報管理員',
        (await page.evaluate(() => window.__feedback.length)) === 1);
    await ctx.close();
}

// ── S. 登入狀態延遲還原時，付款結果處理仍要正確 ──
//    付款導回是整頁重載，DOMContentLoaded 當下 currentUser 還是 null。
//    2026-08-23 站長回報「付款失敗卻沒通知管理員」就是這個空窗造成的。
{
    const { ctx, page } = await open({
        entitled: false, query: '?pmc_pay=failed&pmc_err=T0001', authDelayMs: 1200,
    });
    await page.waitForTimeout(3000);
    const fb = await page.evaluate(() => window.__feedback);
    check('登入延遲還原：付款失敗仍會通知管理員', fb.length === 1, JSON.stringify(fb));
    check('登入延遲還原：畫面顯示「已通知管理員」而非備用文案',
        (await text(page, '#adfree-result-message')).includes('已通知管理員'),
        await text(page, '#adfree-result-message'));
    await ctx.close();
}
{
    const { ctx, page } = await open({
        entitled: true, query: '?pmc_pay=success', authDelayMs: 1200,
    });
    await page.waitForTimeout(3500);
    check('登入延遲還原：付款成功仍會開通',
        (await text(page, '#adfree-result-title')).includes('付款完成'),
        await text(page, '#adfree-result-title'));
    await ctx.close();
}

await browser.close();
console.log(fail ? '\n❌ 有項目未通過' : '\n✅ 全部通過');
process.exit(fail);
