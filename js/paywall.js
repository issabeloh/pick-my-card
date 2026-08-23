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
    // 「我的帳號」不隨付費狀態隱藏——已購買者正是要靠它查詢自己的權益。
    // 移除廣告的入口已收進該 modal，下拉不再有獨立項目。
    const accountItem = document.getElementById('avatar-account');
    if (accountItem && (window.firebaseAuth && window.firebaseAuth.currentUser)) accountItem.style.display = '';
}

// 未購買時：顯示入口。訪客也看得到（點下去會先請他登入）。
function showAdfreeEntryPoints(isLoggedIn) {
    document.documentElement.classList.remove('pmc-adfree');
    const fab = document.getElementById('adfree-fab');
    if (fab) fab.style.display = '';
    const accountItem = document.getElementById('avatar-account');
    if (accountItem) accountItem.style.display = isLoggedIn ? '' : 'none';
}

// ============================================
// 向後端核對權益
// ============================================

/**
 * 等 Firebase 把登入狀態還原完成，回傳 user（逾時則 null）。
 *
 * ⚠️ 為什麼需要它：付款導回是「整頁重新載入」，DOMContentLoaded 當下
 * firebaseAuth.currentUser 幾乎一定還是 null——Firebase 要先跟伺服器換過
 * token 才會填上。2026-08-23 站長回報「付款失敗卻沒收到通知」就是這個原因：
 * notifyAdminPaymentIssue() 第一行看到 currentUser 是 null 就直接放棄了。
 * 成功路徑當時沒被發現，是因為它會輪詢六次、拖過那段空窗自己補救。
 */
async function waitForAuthUser(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const user = (window.firebaseAuth && window.firebaseAuth.currentUser) || null;
        if (user) return user;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
}

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

// 只開 modal 外框，不決定內容（內容由 showAdfreePurchaseView/showAdfreeResult 決定）
function showAdfreeModalShell() {
    const modal = document.getElementById('adfree-modal');
    if (!modal) return false;
    modal.style.display = 'flex';
    if (typeof disableBodyScroll === 'function') disableBodyScroll();
    return true;
}

/**
 * 切到結果視圖。取代原本的系統彈窗——手機上它會蓋住整頁、體驗差，
 * 而且付款結果本來就該留在畫面上讓用戶看得完、看得懂。
 * kind：success | pending | failed
 */
function showAdfreeResult(kind, title, message, opts = {}) {
    if (!showAdfreeModalShell()) return;
    const purchase = document.getElementById('adfree-purchase-view');
    const result = document.getElementById('adfree-result-view');
    if (purchase) purchase.style.display = 'none';
    if (result) result.style.display = 'block';

    const icon = document.getElementById('adfree-result-icon');
    if (icon) {
        icon.textContent = kind === 'success' ? '\u2713' : kind === 'pending' ? '\u22ef' : '\u2715';
        icon.className = 'adfree-result-icon is-' + kind;
    }
    // textContent：不走 innerHTML，無 XSS 風險（鐵則 3）
    const titleEl = document.getElementById('adfree-result-title');
    if (titleEl) titleEl.textContent = title;
    const msgEl = document.getElementById('adfree-result-message');
    if (msgEl) msgEl.textContent = message;

    const recheckBtn = document.getElementById('adfree-result-recheck');
    if (recheckBtn) {
        recheckBtn.style.display = opts.showRecheck ? '' : 'none';
        recheckBtn.disabled = false;
        recheckBtn.textContent = '重新查詢訂單';
    }

    // opts.busy＝流程還在跑（例如付款後正在向金流商確認）。此時把「知道了」和
    // 右上角的 X 都收起來：讓用戶關掉一個還沒有結論的畫面，等於讓他錯過結果。
    const closeBtn = document.getElementById('adfree-result-close');
    if (closeBtn) closeBtn.style.display = opts.busy ? 'none' : '';
    const xBtn = document.getElementById('close-adfree-modal');
    if (xBtn) xBtn.style.display = opts.busy ? 'none' : '';
    const spinner = document.getElementById('adfree-result-spinner');
    if (spinner) spinner.style.display = opts.busy ? '' : 'none';
}

function showAdfreePurchaseView() {
    const purchase = document.getElementById('adfree-purchase-view');
    const result = document.getElementById('adfree-result-view');
    if (purchase) purchase.style.display = 'block';
    if (result) result.style.display = 'none';
}

function clearAdfreeIntent() {
    try { sessionStorage.removeItem('pmc_adfree_intent'); } catch (e) { /* ignore */ }
}

function openAdfreeModal() {
    const user = (window.firebaseAuth && window.firebaseAuth.currentUser) || null;
    if (!user) {
        // 先登入再付款：身分必須在付款前就存在，否則錢進來了卻不知道要開通給誰
        if (typeof openAuthModal === 'function') openAuthModal('login');
        try { sessionStorage.setItem('pmc_adfree_intent', '1'); } catch (e) { /* ignore */ }
        return;
    }

    // 已購買者再次開啟 → 直接顯示狀態，不要再給他看一次購買表單
    if (readAdfreeFlag()) {
        showAdfreeResult('success', '你已移除廣告',
            '此帳號已購買去廣告權益，永久有效。在任何裝置用同一個帳號登入都會生效。');
        return;
    }

    const account = document.getElementById('adfree-account');
    if (account) account.textContent = '權益將綁定此帳號：' + (user.email || user.uid);

    const check = document.getElementById('adfree-consent-check');
    const payBtn = document.getElementById('adfree-pay-btn');
    if (check) check.checked = false;
    if (payBtn) { payBtn.disabled = true; payBtn.textContent = '前往付款'; }
    setAdfreeError('');
    showAdfreePurchaseView();
    showAdfreeModalShell();
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
        // 意圖已達成（人都要去付款了），清掉它。sessionStorage 會活過
        // 「跳去金流商再回來」，不清的話回站時會被它重新開出購買視窗，
        // 蓋掉付款結果畫面幾秒鐘（2026-08-21 站長回報的閃現問題）。
        clearAdfreeIntent();
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
    clearAdfreeIntent();
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
    const errCode = params.get('pmc_err') || '';

    // 先把網址上的付款參數清掉，重新整理才不會又跑一次
    try {
        const url = new URL(location.href);
        url.searchParams.delete('pmc_pay');
        url.searchParams.delete('pmc_trade');
        url.searchParams.delete('pmc_err');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) { /* ignore */ }

    if (result !== 'success') {
        // 明確失敗也通知管理員（站長要求）。不提供「重新查詢訂單」——這條路徑
        // 代表金流商已明確回報失敗，再查一次只會查到同樣的結果或用戶既有的權益，
        // 反而讓人以為付款成功了。
        showAdfreeResult('failed', '付款失敗', '正在通知管理員…', { busy: true });
        await waitForAuthUser();
        const notified = await notifyAdminPaymentIssue('', 'failed', errCode);
        showAdfreeResult('failed', '付款失敗',
            notified
                ? '已通知管理員，我們將儘快處理！請您稍後再嘗試！未向你收取任何費用。'
                : '未向你收取任何費用。請稍後再試一次；若持續失敗，請用「回報錯誤」聯繫我們。');
        return;
    }

    showAdfreeResult('pending', '確認付款中…', '正在向金流商確認這筆交易，請稍候，不要關閉這個頁面。',
        { busy: true });

    const markGranted = () => {
        const user = window.firebaseAuth && window.firebaseAuth.currentUser;
        if (user) writeAdfreeFlag(user.uid);
        applyAdfreeUI();
        if (typeof gtagEvent === 'function') gtagEvent('adfree_purchase_complete');
        showAdfreeResult('success', '付款完成，廣告已移除',
            '感謝你的支持！權益已綁定你的帳號、永久有效，換裝置登入同樣生效。');
    };

    // ⓪ 先等登入狀態還原——整頁重載後 currentUser 需要一點時間才會填上，
    //    沒等就打 API 只會拿到 401，白白浪費一輪。
    await waitForAuthUser();

    // ① 先主動要後端跟金流商對帳（/api/order-status 會自己查、自己開通）。
    //    不先等 webhook 的理由：webhook 只是「快一點」的路徑，而它可能慢、
    //    可能被擋、也可能根本沒送到。主動查通常 1~2 秒就有答案，
    //    比空等 9 秒輪詢好得多。
    const first = await callPaywallApi('/api/order-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (first.ok && first.data.adfree) { markGranted(); return; }

    // ② 還沒有結果（例如金流商那邊仍在處理）→ 等 webhook 落地，輪詢權益
    for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const { ok, data } = await callPaywallApi('/api/entitlement');
        if (ok && data.adfree) { markGranted(); return; }
    }

    // ③ 都沒等到 → 再對帳一次；仍失敗就通知管理員
    await recheckOrder();
}

// 主動跟綠界對帳補開通（「重新查詢訂單」按鈕，以及上面輪詢失敗時的最後一招）
async function recheckOrder() {
    const { ok, data } = await callPaywallApi('/api/order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (ok && data.adfree) {
        const user = window.firebaseAuth && window.firebaseAuth.currentUser;
        if (user) writeAdfreeFlag(user.uid);
        applyAdfreeUI();
        showAdfreeResult('success', '已確認付款，廣告已移除',
            '感謝你的支持！權益已綁定你的帳號、永久有效，換裝置登入同樣生效。');
        return true;
    }
    // 金流商說「還在處理中」（3D 驗證等情況會出現）→ 這不是異常，只是還沒好。
    // 不要通報管理員，也不要嚇用戶——請他稍後再查即可。
    if (data && data.providerStatus === 'charging') {
        showAdfreeResult('pending', '交易處理中',
            '金流商還在處理這筆交易（開啟 3D 驗證時常見）。請稍候幾分鐘後點下方再查一次；'
            + '權益確認後會自動生效，你不需要再付一次。',
            { showRecheck: true });
        return false;
    }

    // 到這裡代表「用戶可能已經付錢，但系統確認不到」——這是最需要人介入的情況，
    // 不能只叫用戶自己去回報。自動建立一筆問題回報，管理員在既有的回報清單就看得到。
    const tradeNo = (data && data.tradeNo) || '';
    const notified = await notifyAdminPaymentIssue(tradeNo);
    showAdfreeResult('pending', '付款結果確認中',
        notified
            ? '我們還沒收到金流商的確認。這筆問題已自動通知管理員處理，'
              + '請明天再開啟本頁確認一次——若已扣款，權益會補上，你不需要再付一次。'
            : '我們還沒收到金流商的確認。金流商的通知偶爾會慢幾分鐘，可以稍後再查一次；'
              + '若你確定已扣款且超過十分鐘仍有廣告，請用「回報錯誤」聯繫我們。',
        { showRecheck: true });
    return false;
}

// OEN 系統回應代碼對照表（只收錄交易相關的，供管理員回報用）
function describePayError(code) {
    const map = {
        T0001: '交易失敗', T0002: '安全碼 CVV 錯誤', T0003: '卡片過期',
        T0004: '額度不足', T0005: '拒絕授權',
        V0001: '請求錯誤', V0002: '交易狀態錯誤', A0001: '未授權', F0001: '系統錯誤',
    };
    return map[code] || '未知代碼';
}

/**
 * 把付款異常寫進既有的 feedback 集合。
 * 刻意重用問題回報的管道而不是另做一套通知：管理員本來就會看那份清單，
 * 多一個各自獨立的通知管道只會多一個沒人看的地方。
 * 回傳是否成功送出——送不出去就不要對用戶說「已通知管理員」。
 */
async function notifyAdminPaymentIssue(tradeNo, kind = 'unconfirmed', errCode = '') {
    const user = (window.firebaseAuth && window.firebaseAuth.currentUser) || null;
    if (!user || !window.addDoc || !window.collection || !window.db) return false;
    const detail = kind === 'failed'
        ? '金流商明確回報付款失敗' + (errCode ? ('，錯誤代碼 ' + errCode + '（' + describePayError(errCode) + '）') : '')
            + '。用戶未被扣款，但請留意是否為系統性問題（例如商戶設定或額度）。'
        : '用戶已完成付款流程但系統查不到成功紀錄，請至金流商後台比對是否已扣款。';
    try {
        await window.addDoc(window.collection(window.db, 'feedback'), {
            message: '[自動回報] 去廣告付款'
                + (kind === 'failed' ? '失敗' : '結果無法確認')
                + (tradeNo ? ('，訂單編號 ' + tradeNo) : '')
                + '。' + detail,
            userName: user.displayName || 'Unknown',
            userId: user.uid,
            userEmail: user.email || '',
            imageUrls: [],
            timestamp: window.serverTimestamp(),
            createdAt: new Date().toISOString(),
        });
        return true;
    } catch (err) {
        console.error('自動回報付款問題失敗', err);
        return false;
    }
}

// ============================================
// 帳號刪除的付費資料清理
// ============================================

// 由 js/auth-user-data.js 的 deleteAccountAndAllData() 呼叫，時機必須在
// Firebase 帳號被刪除**之前**——帳號沒了就拿不到能證明身分的 ID token。
// 失敗會丟錯讓刪除流程中止：寧可讓用戶重試，也不要留下刪不乾淨的個資。
async function purgePaywallDataForAccountDeletion() {
    const { ok, status, data } = await callPaywallApi('/api/account/purge', { method: 'POST' });
    if (!ok) {
        throw new Error('清除付費資料失敗（' + status + '）：' + ((data && data.error) || '請稍後再試'));
    }
    clearAdfreeFlag();
    return data;
}

// 刪除帳號 modal 開啟時呼叫：已購買者才顯示「權益會消失且不退款」那條警告
function updateDeleteAccountAdfreeWarning() {
    const item = document.getElementById('da-adfree-item');
    if (!item) return;
    item.style.display = readAdfreeFlag() ? '' : 'none';
    // 本機旗標可能過期或不存在（換裝置），再跟後端確認一次
    callPaywallApi('/api/entitlement').then(({ ok, data }) => {
        if (ok) item.style.display = data.adfree ? '' : 'none';
    }).catch((e) => console.error('查詢權益失敗', e));
}

// ============================================
// 我的帳號 modal
// ============================================

function openAccountModal() {
    const user = (window.firebaseAuth && window.firebaseAuth.currentUser) || null;
    if (!user) {
        if (typeof openAuthModal === 'function') openAuthModal('login');
        return;
    }
    const modal = document.getElementById('account-modal');
    if (!modal) return;

    const email = document.getElementById('account-email');
    if (email) email.textContent = user.email || user.uid;

    // 先用本機旗標給即時答案（避免空白閃爍），再向後端要權威狀態覆蓋
    renderAccountAdfree(!!readAdfreeFlag(), null, true);
    modal.style.display = 'flex';
    if (typeof disableBodyScroll === 'function') disableBodyScroll();

    callPaywallApi('/api/entitlement').then(({ ok, data }) => {
        if (ok) renderAccountAdfree(!!data.adfree, data.grantedAt, false);
    }).catch((e) => console.error('查詢權益失敗', e));
}

// provisional=true 代表這是本機旗標的推測值，還沒經後端確認
function renderAccountAdfree(adfree, grantedAt, provisional) {
    const status = document.getElementById('account-adfree-status');
    const note = document.getElementById('account-adfree-note');
    const buyBtn = document.getElementById('account-buy-adfree');

    if (status) {
        status.textContent = adfree ? '已購買' : (provisional ? '查詢中…' : '未購買');
        status.className = 'account-value ' + (adfree ? 'is-on' : 'is-off');
    }
    if (note) {
        if (adfree && grantedAt) {
            note.textContent = '購買於 ' + new Date(Number(grantedAt)).toLocaleDateString('zh-TW')
                + '，一次買斷、永久有效，不會自動續扣。';
            note.style.display = 'block';
        } else if (adfree) {
            note.textContent = '一次買斷、永久有效，不會自動續扣。';
            note.style.display = 'block';
        } else {
            note.style.display = 'none';
        }
    }
    // 還在查詢時不顯示購買鈕，免得已購買者閃一下看到「再買一次」
    if (buyBtn) buyBtn.style.display = (!adfree && !provisional) ? '' : 'none';
}

function closeAccountModal() {
    const modal = document.getElementById('account-modal');
    if (modal) modal.style.display = 'none';
    if (typeof enableBodyScroll === 'function') enableBodyScroll();
}

function setupAccountModal() {
    const closeBtn = document.getElementById('close-account-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeAccountModal);

    const modal = document.getElementById('account-modal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeAccountModal(); });

    const buyBtn = document.getElementById('account-buy-adfree');
    if (buyBtn) buyBtn.addEventListener('click', () => { closeAccountModal(); openAdfreeModal(); });

    // 刪除帳戶沿用 main 既有的流程（重新驗證、確認文字、逐項警告）
    const deleteBtn = document.getElementById('account-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            closeAccountModal();
            if (typeof openDeleteAccountModal === 'function') openDeleteAccountModal();
        });
    }

    // 登出沿用既有選單項的流程（含鐵則 9 的本機個資清理），不另寫一份實作
    const signOutBtn = document.getElementById('account-sign-out');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => {
            closeAccountModal();
            const item = document.getElementById('avatar-sign-out');
            if (item) item.click();
        });
    }
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

    const resultClose = document.getElementById('adfree-result-close');
    if (resultClose) resultClose.addEventListener('click', closeAdfreeModal);

    const resultRecheck = document.getElementById('adfree-result-recheck');
    if (resultRecheck) {
        resultRecheck.addEventListener('click', () => {
            resultRecheck.disabled = true;
            resultRecheck.textContent = '查詢中…';
            const closeBtn = document.getElementById('adfree-result-close');
            if (closeBtn) closeBtn.style.display = 'none';
            recheckOrder().catch((err) => {
                console.error('查詢訂單失敗', err);
                showAdfreeResult('failed', '查詢失敗', '請稍後再試一次。', { showRecheck: true });
            });
        });
    }

    setupAccountModal();

    const recheck = document.getElementById('adfree-recheck');
    if (recheck) {
        recheck.addEventListener('click', (e) => {
            e.preventDefault();
            setAdfreeError('');
            recheckOrder().catch((err) => {
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
    // ⚠️ 必須在 setupPaywall() 之前讀：handlePaymentReturn() 會把 pmc_pay
    // 從網址上清掉（避免重整時重跑），之後就再也判斷不出「剛從金流商回來」。
    const isPaymentReturn = new URLSearchParams(location.search).has('pmc_pay');

    setupPaywall();

    // 登入前點過「移除廣告」→ 登入完成後自動把 modal 接回來。
    // 網址帶著付款結果時一律跳過：那代表人剛從金流商回來，畫面該顯示的是
    // 付款結果，不是再開一次購買視窗（會蓋掉結果畫面）。
    try {
        if (isPaymentReturn) {
            // 剛付完款，舊意圖已無意義——不清的話它會留到下次開頁時
            // 莫名其妙彈出購買視窗。
            clearAdfreeIntent();
        } else if (sessionStorage.getItem('pmc_adfree_intent') === '1') {
            clearAdfreeIntent();
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
