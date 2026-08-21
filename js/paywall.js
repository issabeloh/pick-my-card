/* ============================================================
 * Pick My Card — js/paywall.js（載入順序 13/13）
 * 去廣告付費牆的前端。後端在 functions/api/*（Cloudflare Pages Functions）。
 * 區塊目錄（Grep 關鍵字）：
 *  - 本機旗標讀寫          → "readAdfreeFlag" / "writeAdfreeFlag" / "clearAdfreeFlag"
 *  - 套用去廣告 UI         → "applyAdfreeUI"
 *  - 向後端核對權益        → "refreshAdfreeEntitlement"
 *  - 認證狀態掛鉤          → "onPaywallAuthChanged"
 *  - 付費 modal            → "openAdfreeModal" / "closeAdfreeModal"
 *  - 送出付款              → "startAdfreeCheckout"
 *  - 付款導回處理          → "handlePaymentReturn"
 *  - 事件綁定              → "setupPaywall"
 *
 * 設計要點：
 *  1. 廣告的「載或不載」在 <head> 的內聯腳本就決定了（看 pmc_adfree 旗標）。
 *     本檔負責維護那個旗標的正確性——旗標只是快取，權威狀態一律在後端。
 *  2. 旗標存成 "<uid>|<到期毫秒>" 純字串（<head> 用得到、不需要 JSON 解析）。
 *     帶 uid 是為了換帳號登入時能立刻發現對不上；帶到期時間是為了退款/撤銷
 *     後最多 7 天內一定會回頭問後端一次。
 *  3. 這是前端旗標，本來就擋不住會改 devtools 的人——但擋得住的部分（真正的
 *     權益判定、訂單、開通）全在後端，前端造假只會讓自己少看到廣告，
 *     跟裝擋廣告外掛沒有兩樣，不構成金流風險。
 * ============================================================ */

const PMC_ADFREE_KEY = 'pmc_adfree';
const PMC_ADFREE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 旗標最多信任 7 天

// ============================================
// 本機旗標讀寫
// ============================================

// 回傳 { uid, exp } 或 null。格式與 index.html <head> 的內聯閘門必須一致。
function readAdfreeFlag() {
    let raw = '';
    try { raw = localStorage.getItem(PMC_ADFREE_KEY) || ''; } catch (e) { return null; }
    const parts = raw.split('|');
    if (parts.length !== 2 || !parts[0]) return null;
    const exp = Number(parts[1]);
    if (!(exp > Date.now())) return null;
    return { uid: parts[0], exp };
}

function writeAdfreeFlag(uid) {
    try { localStorage.setItem(PMC_ADFREE_KEY, uid + '|' + (Date.now() + PMC_ADFREE_TTL_MS)); } catch (e) { /* ignore */ }
}

function clearAdfreeFlag() {
    try { localStorage.removeItem(PMC_ADFREE_KEY); } catch (e) { /* ignore */ }
}

// ============================================
// 套用去廣告 UI
// ============================================

// 把已經在頁面上的廣告痕跡清乾淨。
// 注意：這只處理「本次載入時旗標還沒建立、廣告已經載進來」的補救情況
// （例如剛付款完那一次）。之後的每次載入，<head> 閘門會讓 loader 根本不執行。
function applyAdfreeUI() {
    document.documentElement.classList.add('pmc-adfree');
    const adRow = document.getElementById('ad-row');
    if (adRow && adRow.parentNode) adRow.parentNode.removeChild(adRow);
    const fab = document.getElementById('adfree-fab');
    if (fab) fab.style.display = 'none';
    const menuItem = document.getElementById('avatar-remove-ads');
    if (menuItem) menuItem.style.display = 'none';
}

// 未購買時：顯示入口。訪客也看得到（點下去會先請他登入）。
function showAdfreeEntryPoints(isLoggedIn) {
    document.documentElement.classList.remove('pmc-adfree');
    const fab = document.getElementById('adfree-fab');
    if (fab) fab.style.display = '';
    const menuItem = document.getElementById('avatar-remove-ads');
    if (menuItem) menuItem.style.display = isLoggedIn ? '' : 'none';
}

// ============================================
// 向後端核對權益
// ============================================

async function getIdToken() {
    const user = (window.firebaseAuth && window.firebaseAuth.currentUser) || null;
    if (!user) return null;
    try { return await user.getIdToken(); } catch (e) { console.error('取得 ID token 失敗', e); return null; }
}

async function callPaywallApi(path, options = {}) {
    const token = await getIdToken();
    if (!token) return { ok: false, status: 401, data: { error: '未登入' } };
    const res = await fetch(path, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token },
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* 非 JSON 回應 → 當作空物件 */ }
    return { ok: res.ok, status: res.status, data };
}

// 以後端為準更新旗標與 UI。登出/未登入時只負責「撤銷對不上的旗標」。
async function refreshAdfreeEntitlement(user) {
    const flag = readAdfreeFlag();

    if (!user) {
        // 未登入：旗標無法驗證。留著它到期自然失效即可（不主動清，
        // 免得 Firebase 還沒回來的短暫空窗被誤判成登出）。
        showAdfreeEntryPoints(false);
        if (flag) applyAdfreeUI();
        return;
    }

    // 換帳號登入且旗標屬於別人 → 立刻作廢，不能讓 A 的權益帶到 B
    if (flag && flag.uid !== user.uid) {
        clearAdfreeFlag();
        showAdfreeEntryPoints(true);
    }

    const { ok, data } = await callPaywallApi('/api/entitlement');
    if (!ok) return; // 後端暫時不通 → 維持現狀，不動旗標

    if (data.adfree) {
        writeAdfreeFlag(user.uid);
        applyAdfreeUI();
    } else {
        clearAdfreeFlag();
        showAdfreeEntryPoints(true);
    }
}

// 由 js/auth-user-data.js 的 onAuthStateChanged 兩個分支呼叫。
function onPaywallAuthChanged(user) {
    refreshAdfreeEntitlement(user).catch((e) => console.error('核對去廣告權益失敗', e));
}

// ============================================
// 付費 modal
// ============================================

function setAdfreeError(message) {
    const box = document.getElementById('adfree-error');
    if (!box) return;
    box.textContent = message || '';           // textContent：不走 innerHTML，無 XSS 風險
    box.style.display = message ? 'block' : 'none';
}

function openAdfreeModal() {
    const user = (window.firebaseAuth && window.firebaseAuth.currentUser) || null;
    if (!user) {
        // 先登入再付款：身分必須在付款前就存在，否則錢進來了卻不知道要開通給誰
        if (typeof openAuthModal === 'function') openAuthModal('login');
        try { sessionStorage.setItem('pmc_adfree_intent', '1'); } catch (e) { /* ignore */ }
        return;
    }

    const modal = document.getElementById('adfree-modal');
    if (!modal) return;

    const account = document.getElementById('adfree-account');
    if (account) account.textContent = '權益將綁定此帳號：' + (user.email || user.uid);

    const check = document.getElementById('adfree-consent-check');
    const payBtn = document.getElementById('adfree-pay-btn');
    if (check) check.checked = false;
    if (payBtn) { payBtn.disabled = true; payBtn.textContent = '前往付款'; }
    setAdfreeError('');

    modal.style.display = 'flex';
    if (typeof disableBodyScroll === 'function') disableBodyScroll();
}

function closeAdfreeModal() {
    const modal = document.getElementById('adfree-modal');
    if (modal) modal.style.display = 'none';
    if (typeof enableBodyScroll === 'function') enableBodyScroll();
}

// ============================================
// 送出付款
// ============================================

// 用後端回傳的參數組出表單並送去綠界。刻意用 DOM API 一個個建 input，
// 不用 innerHTML 拼字串（鐵則 3）。
function submitToEcpay(action, params) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.style.display = 'none';
    Object.keys(params).forEach((name) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = String(params[name]);
        form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
}

async function startAdfreeCheckout() {
    const payBtn = document.getElementById('adfree-pay-btn');
    if (payBtn) { payBtn.disabled = true; payBtn.textContent = '建立訂單中…'; }
    setAdfreeError('');

    const { ok, status, data } = await callPaywallApi('/api/checkout', { method: 'POST' });

    if (ok && data.alreadyPaid) {
        const user = window.firebaseAuth && window.firebaseAuth.currentUser;
        if (user) writeAdfreeFlag(user.uid);
        applyAdfreeUI();
        closeAdfreeModal();
        return;
    }
    // OEN（全跳轉）：後端回 redirectUrl，整頁導去它的結帳頁
    if (ok && data.redirectUrl) {
        const safeUrl = typeof sanitizeUrl === 'function' ? sanitizeUrl(data.redirectUrl) : data.redirectUrl;
        if (!safeUrl) {
            setAdfreeError('付款頁網址異常，請稍後再試。');
            if (payBtn) { payBtn.disabled = false; payBtn.textContent = '前往付款'; }
            return;
        }
        if (typeof gtagEvent === 'function') gtagEvent('adfree_checkout_start');
        location.assign(safeUrl);
        return;
    }

    if (!ok || !data.action || !data.params) {
        setAdfreeError(status === 401 ? '登入狀態已過期，請重新登入後再試。'
                                      : (data.error || '建立訂單失敗，請稍後再試。'));
        if (payBtn) { payBtn.disabled = false; payBtn.textContent = '前往付款'; }
        return;
    }

    if (typeof gtagEvent === 'function') gtagEvent('adfree_checkout_start');
    submitToEcpay(data.action, data.params);
}

// ============================================
// 付款導回處理
// ============================================

// 綠界把瀏覽器導回 /?pmc_pay=success 之後：真實狀態一律再問後端一次。
// 通知偶爾會比瀏覽器慢幾秒，所以輪詢幾輪再放棄。
async function handlePaymentReturn() {
    const params = new URLSearchParams(location.search);
    const result = params.get('pmc_pay');
    if (!result) return;

    // 先把網址上的付款參數清掉，重新整理才不會又跑一次
    try {
        const url = new URL(location.href);
        url.searchParams.delete('pmc_pay');
        url.searchParams.delete('pmc_trade');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) { /* ignore */ }

    if (result !== 'success') {
        alert('付款未完成，未向你收取任何費用。如果你認為這是錯誤，可以稍後在「移除廣告」裡點「重新查詢訂單」。');
        return;
    }

    for (let attempt = 0; attempt < 6; attempt++) {
        const { ok, data } = await callPaywallApi('/api/entitlement');
        if (ok && data.adfree) {
            const user = window.firebaseAuth && window.firebaseAuth.currentUser;
            if (user) writeAdfreeFlag(user.uid);
            applyAdfreeUI();
            if (typeof gtagEvent === 'function') gtagEvent('adfree_purchase_complete');
            alert('付款完成，廣告已移除，感謝你的支持！');
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    // 輪詢都沒等到 → 走主動查詢補救
    await recheckOrder(true);
}

// 主動跟綠界對帳補開通（「重新查詢訂單」按鈕，以及上面輪詢失敗時的最後一招）
async function recheckOrder(silentWhenPending) {
    const { ok, data } = await callPaywallApi('/api/order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (ok && data.adfree) {
        const user = window.firebaseAuth && window.firebaseAuth.currentUser;
        if (user) writeAdfreeFlag(user.uid);
        applyAdfreeUI();
        closeAdfreeModal();
        alert('已確認付款，廣告已移除，感謝你的支持！');
        return true;
    }
    if (!silentWhenPending) {
        setAdfreeError('查詢後仍未看到成功的付款紀錄。若你確定已扣款，請用「回報錯誤」聯繫我們，附上你的訂單編號。');
    } else {
        alert('付款結果還在確認中。稍後重新整理頁面即可；若超過十分鐘仍有廣告，請用「回報錯誤」聯繫我們。');
    }
    return false;
}

// ============================================
// 事件綁定
// ============================================

function setupPaywall() {
    const fabBtn = document.getElementById('adfree-fab');
    if (fabBtn) fabBtn.addEventListener('click', openAdfreeModal);

    const closeBtn = document.getElementById('close-adfree-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeAdfreeModal);

    const modal = document.getElementById('adfree-modal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeAdfreeModal(); });

    const check = document.getElementById('adfree-consent-check');
    const payBtn = document.getElementById('adfree-pay-btn');
    // 同意條款才能付款——「事先同意」是排除七天猶豫期的法定前提，不能預設勾選
    if (check && payBtn) check.addEventListener('change', () => { payBtn.disabled = !check.checked; });
    if (payBtn) payBtn.addEventListener('click', () => { startAdfreeCheckout().catch((e) => {
        console.error('建立訂單失敗', e);
        setAdfreeError('建立訂單失敗，請稍後再試。');
        payBtn.disabled = false;
        payBtn.textContent = '前往付款';
    }); });

    const termsToggle = document.getElementById('adfree-terms-toggle');
    if (termsToggle) {
        termsToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const terms = document.getElementById('adfree-terms');
            if (terms) terms.style.display = terms.style.display === 'none' ? 'block' : 'none';
        });
    }

    const recheck = document.getElementById('adfree-recheck');
    if (recheck) {
        recheck.addEventListener('click', (e) => {
            e.preventDefault();
            setAdfreeError('');
            recheckOrder(false).catch((err) => {
                console.error('查詢訂單失敗', err);
                setAdfreeError('查詢訂單失敗，請稍後再試。');
            });
        });
    }

    // 先用本機旗標決定初始樣子，不等 Firebase：
    // 認證那條路可能很慢、甚至永遠不通（公司網路擋 gstatic），入口若只在
    // onAuthStateChanged 之後才出現，那些人就永遠看不到購買入口。
    // 之後 refreshAdfreeEntitlement() 會用後端的答案覆蓋這裡的猜測。
    if (readAdfreeFlag()) applyAdfreeUI();
    else showAdfreeEntryPoints(false);

    handlePaymentReturn().catch((e) => console.error('處理付款結果失敗', e));
}

document.addEventListener('DOMContentLoaded', () => {
    setupPaywall();

    // 登入前點過「移除廣告」→ 登入完成後自動把 modal 接回來
    try {
        if (sessionStorage.getItem('pmc_adfree_intent') === '1') {
            sessionStorage.removeItem('pmc_adfree_intent');
            const timer = setInterval(() => {
                if (window.firebaseAuth && window.firebaseAuth.currentUser) {
                    clearInterval(timer);
                    openAdfreeModal();
                }
            }, 500);
            setTimeout(() => clearInterval(timer), 30000);
        }
    } catch (e) { /* sessionStorage 被停用 → 只是少了這個便利功能 */ }
});
