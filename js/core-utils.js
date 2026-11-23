/* ============================================================
 * Pick My Card — js/core-utils.js（載入順序第 1 支模組檔；完整順序以 index.html 的 <script> 標籤為準）
 * js/ 的模組檔為傳統全域 script（非 ES module），依 index.html 標籤
 * 順序載入，被依賴的在前；模組地圖見 CLAUDE.md 專案地圖。
 * 區塊目錄（Grep 關鍵字）：
 *  - Debug 日誌閘門              → "Debug 日誌閘門"
 *  - 全域狀態                    → "Global variables"
 *  - Embed 模式（新戶活動頁 iframe） → "Embed 模式" / "isEmbedMode"
 *  - GA4 版位標記                → "getAnalyticsSurface"
 *  - Body scroll lock            → "bodyScrollLockDepth" / "disableBodyScroll"
 *  - Modal 每次打開都從最上方    → "setupModalScrollReset"
 *  - 全域 loading overlay        → "loadingOverlay"
 *  - WebView 內建瀏覽器警告      → "isInAppBrowser" / "showWebViewWarning"
 *  - 台灣時區日期工具            → "getTaiwanToday" / "formatISODateForDisplay"
 *  - 活動期間狀態＋快取          → "getRateStatus" / "rateStatusCache"
 *  - 級別快取                    → "cardLevelCache"
 *  - localStorage 安全讀取       → "localStorage 安全讀取 helpers" / "readLocalJSON"
 *  - 「還有幾天」唯一算法        → "taiwanDaysUntil" / "getTaiwanMonth" / "isEndingSoon"
 *  - 卡片權益期限解析            → "parseBenefitPeriod" / "getBenefitStatus"
 *  - 過期活動過濾                → "filterExpiredRates"
 *  - 比較卡集合                  → "getCardsForComparison"
 *  - 新戶活動 helpers            → "getActiveCardholderPromos" / "expandPromoMerchants"
 *  - 卡片項目彙整                → "collectCardItems"
 *  - 雲端同步錯誤提示            → "pmcOnFirestoreError"
 * ============================================================ */

// ========== Debug 日誌閘門 ==========
// 正式環境靜音 console.log / console.warn（減少執行負擔與雜訊）。
// 需要除錯時在網址加 ?debug=1 即可全部重新開啟。
// console.error 永遠保留 —— 錯誤一定要看得到。
(function () {
    try {
        if (!new URLSearchParams(location.search).has('debug')) {
            console.log = function () {};
            console.warn = function () {};
        }
    } catch (e) { /* 環境不支援時維持原樣 */ }
})();

// Global variables
let currentUser = null;
let appStarted = false; // true after user clicks "開始使用"
let cardsInComparison = new Set();
let myOwnedCards = new Set();
let userSelectedPayments = new Set();
let userSpendingMappings = []; // 用戶的消費配卡表
// 配卡表最近一次載入的結果：'guest'（未登入／尚未為登入者載過）/ 'ok'（雲端讀取成功，
// 空陣列＝雲端真的沒資料）/ 'error'（雲端讀不到，畫面上的空陣列不可信）。
// 存在理由：空清單過去在三種情況下長得一模一樣（沒登入 / 讀取失敗 / 真的沒配卡），
// iPhone 桌面 App 回報「配卡不見了」時無從分辨。見 js/spending-mappings.js。
let mappingsLoadState = 'guest';
let auth = null;
let db = null;
let cardsData = null;
let paymentsData = null;
let quickSearchOptions = [];
let userBirthdayMonth = null; // 用戶生日月份 (1-12)，null 表示未設定
let isBirthdayMonth = false;  // 預先計算的旗標：當前月份是否為生日月份
// 用戶是否符合「童樂匯」權益（預設為是）。訪客的選擇存在本機 childrenEligible_guest（2026-11-20 起，只存 true/false）；
// 登入者以雲端 users/{uid}.isChildrenEligible 為準（onAuthStateChanged 會覆蓋這個初值）
let isChildrenEligible = readLocalJSON('childrenEligible_guest', true) !== false;
// 國泰 CUBE 卡「童樂匯」方案在資料（cards.data 的 category 欄）裡的類別字串；是比對用的識別碼，一個字都不能改
const CHILDREN_PLAN_CATEGORY = '切換「童樂匯」方案';
let cubeIssuer = (typeof localStorage !== 'undefined' && localStorage.getItem('cubeIssuer')) || 'Visa'; // 國泰CUBE卡發卡組織（Visa/Mastercard/JCB）

// Embed 模式（新戶活動頁 iframe 內嵌卡片詳情彈窗，2026-07-16）：URL 帶 ?embed=1 時
// 精簡顯示（對應 index.html pre-paint script 加的 <html class="pmc-embed">／
// styles.css 隱藏全站 UI）。只用來決定要不要送/收 postMessage，不影響 auth 流程——
// onAuthStateChanged 照常跑，個人化資料在 iframe 內一樣可用（同網域）。
let isEmbedMode = false;
try {
    isEmbedMode = new URLSearchParams(location.search).get('embed') === '1';
} catch (e) {
    // URLSearchParams 不支援時維持 false（退回一般模式，不影響核心功能）
}

// ========== GA4 版位標記（2026-08-20）==========
// 同一支事件可能來自三種脈絡，但 page_location 都指向 `/`，在 GA4 裡分不開：
//  - promos_embed：/promos 用 iframe 載 `/?start&embed=1` 開卡片詳情。詳情瀏覽與
//    申辦點擊全被記成首頁的，/promos 因此看起來「0 申辦」——那是歸因問題不是行為。
//  - merchant_page：商家落地頁與 `?merchant=` 深連結開頁就自動試算（設計如此），
//    那筆 calculate_cashback 不是用戶按計算鍵，混在一起會高估試算率。
// ⚠️ `surface` 要在 GA4 後台註冊成自訂維度才查得到，且 GA4 不回填——沒註冊的期間永遠是空的。
function getAnalyticsSurface() {
    try {
        if (isEmbedMode) return 'promos_embed';
        // 首次引導導覽裡、用範例商家按出來的那一次計算（js/home-ui.js「首次引導」）：不是用戶自己要查的，分流結果要排除
        if (window.pmcOnboardCalc) return 'onboard_example';
        if (window.__PMC_MERCHANT__) return 'merchant_page';
        if (new URLSearchParams(location.search).get('merchant')) return 'merchant_page';
    } catch (e) {
        // URLSearchParams 不支援時退回 'site'——標記不準不值得擋掉事件本身
    }
    return 'site';
}

// Body scroll lock utilities (compensate scrollbar width to prevent layout shift).
// Refcounted so stacked modals (e.g. card detail opened from inside another modal)
// don't release the scroll lock while an outer modal is still open.
let bodyScrollLockDepth = 0;
// Modal 每次打開都從最上方開始（2026-10-14 站長要求）：以前關掉再開，多數 modal 會停在上次捲到的位置。
// 一條共用規則蓋所有 .modal（含日後新增的）：觀察 .modal 的 style／class／hidden 變化，
// 從「關」變「開」的那一刻把 modal 本身與裡面所有捲動過的區塊歸零；開著時的變化不動
// （不會干擾開啟後才捲到指定區塊的功能——那些都在下一幀 requestAnimationFrame 才捲，晚於這裡）
(function setupModalScrollReset() {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return;
    const openModals = new WeakSet();
    const isShown = el => el.isConnected && !el.hidden && getComputedStyle(el).display !== 'none';
    const check = el => {
        if (!el.classList || !el.classList.contains('modal')) return;
        if (!isShown(el)) { openModals.delete(el); return; }
        if (openModals.has(el)) return;
        openModals.add(el);
        if (el.scrollTop) el.scrollTop = 0;
        el.querySelectorAll('*').forEach(child => { if (child.scrollTop) child.scrollTop = 0; });
    };
    const start = () => new MutationObserver(records => records.forEach(r => check(r.target)))
        .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

function disableBodyScroll() {
    if (bodyScrollLockDepth === 0) {
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
            document.body.style.paddingRight = scrollbarWidth + 'px';
        }
    }
    bodyScrollLockDepth++;
}

function enableBodyScroll() {
    bodyScrollLockDepth = Math.max(0, bodyScrollLockDepth - 1);
    if (bodyScrollLockDepth === 0) {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }
}

// ==========================================
// Global Loading Utilities
// ==========================================

const loadingOverlay = {
    element: null,
    textElement: null,
    startTime: null,
    // true 只在 show() 真的把 overlay 顯示出來之後；hide() 用它 guard，
    // 讓「show() 從未被呼叫過就呼叫 hide()」是安全的 no-op（calculateCashback 的
    // 150ms 延遲顯示模式：計算很快時 show() 可能永遠不會跑到，但 finally 仍會
    // 無條件呼叫 hide()）。沒有這個 guard，hide() 會在未 show() 的情況下也呼叫
    // enableBodyScroll()，可能誤解除「其他 modal 正持有」的 scroll lock。
    shown: false,

    init() {
        this.element = document.getElementById('global-loading-overlay');
        this.textElement = document.getElementById('loading-text');
    },

    show(message = '載入中...') {
        if (!this.element) this.init();

        this.shown = true;
        this.startTime = performance.now();
        if (this.textElement) {
            this.textElement.textContent = message;
        }
        if (this.element) {
            this.element.style.display = 'flex';
        }
        disableBodyScroll();

        console.log(`⏱️ Loading started: ${message}`);
    },

    hide() {
        if (!this.shown) return; // 從未 show() 過，不做任何事（見上方 shown 註解）
        this.shown = false;

        if (!this.element) this.init();

        if (this.element) {
            this.element.style.display = 'none';
        }
        enableBodyScroll();

        if (this.startTime) {
            const duration = performance.now() - this.startTime;
            console.log(`⏱️ Loading finished in ${duration.toFixed(2)}ms (${(duration / 1000).toFixed(2)}s)`);
            this.startTime = null;
        }
    },

    // Wrapper for async operations with loading
    async wrap(asyncFn, message = '載入中...') {
        this.show(message);
        try {
            const result = await asyncFn();
            return result;
        } finally {
            this.hide();
        }
    }
};

// WebView detection function
function isInAppBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;

    // Check for common in-app browsers
    const patterns = [
        /FBAN|FBAV/i,        // Facebook
        /Instagram/i,         // Instagram
        /Line/i,             // LINE
        /Barcelona/i,        // Threads (internal codename)
        /IABMV/i,            // In-App Browser Mobile View (used by Threads and others)
        /Twitter/i,          // Twitter
        /WeChat/i,           // WeChat
        /\bwv\b/i,           // Generic WebView
        /WebView/i           // Generic WebView
    ];

    const isWebView = patterns.some(pattern => pattern.test(ua));

    if (isWebView) {
        console.log('🔍 Detected in-app browser:', ua);
    }

    return isWebView;
}

// Show WebView warning modal
function showWebViewWarning() {
    const modal = document.getElementById('webview-warning-modal');
    if (modal) {
        modal.style.display = 'flex';
        disableBodyScroll();
    }
}

// Close WebView warning modal
function closeWebViewWarning() {
    const modal = document.getElementById('webview-warning-modal');
    if (modal) {
        modal.style.display = 'none';
        enableBodyScroll();
    }
}

// Copy current URL to clipboard
function copyUrlToClipboard() {
    const url = window.location.href;

    // Try using Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showCopyFeedback(true);
        }).catch(() => {
            // Fallback to old method
            fallbackCopyUrl(url);
        });
    } else {
        // Fallback for older browsers
        fallbackCopyUrl(url);
    }
}

// Fallback copy method
function fallbackCopyUrl(url) {
    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        document.execCommand('copy');
        showCopyFeedback(true);
    } catch (err) {
        showCopyFeedback(false);
    }

    document.body.removeChild(textArea);
}

// Show copy feedback
function showCopyFeedback(success) {
    const feedback = document.getElementById('copy-feedback');
    if (feedback) {
        feedback.textContent = success ? '✅ 連結已複製！' : '❌ 複製失敗，請手動複製';
        feedback.style.display = 'block';

        setTimeout(() => {
            feedback.style.display = 'none';
        }, 2000);
    }
}

// Open in browser (try to open in default browser)
function openInBrowser() {
    const url = window.location.href;

    // For iOS, try to open in Safari
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        // iOS doesn't allow direct opening in Safari from WebView
        // Show copy instruction instead
        copyUrlToClipboard();
        alert('請點擊右上角「...」選單，選擇「在 Safari 中開啟」');
    }
    // For Android, try various methods
    else if (/Android/i.test(navigator.userAgent)) {
        // Try intent URL for Android
        window.location.href = 'intent://' + url.replace(/https?:\/\//, '') + '#Intent;scheme=https;end';

        // Fallback: show instructions
        setTimeout(() => {
            copyUrlToClipboard();
            alert('請點擊右上角「⋮」選單，選擇「在瀏覽器中開啟」');
        }, 1000);
    }
    // For other platforms
    else {
        copyUrlToClipboard();
    }
}

// 取得台灣今天的日期字串 YYYY-MM-DD（UTC+8，不依賴使用者瀏覽器時區）
function getTaiwanToday() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

// 將 ISO 日期 YYYY-MM-DD 格式化為台灣慣用顯示 YYYY/M/D（去補零）
function formatISODateForDisplay(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    return `${y}/${m}/${d}`;
}

// 將台灣慣用 YYYY/M/D 轉為 ISO YYYY-MM-DD（供日期工具函數使用）
function slashDateToISO(slashDate) {
    if (!slashDate || typeof slashDate !== 'string') return '';
    const parts = slashDate.split('/');
    if (parts.length !== 3) return '';
    const [y, m, d] = parts.map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Get the status of a rate based on periodStart and periodEnd (UTC+8 Taiwan time)
// Returns: 'active' | 'upcoming' | 'expired' | 'always'
function getRateStatus(periodStart, periodEnd) {
    // If no date restrictions at all, rate is always active
    if (!periodStart && !periodEnd) {
        return 'always';
    }

    try {
        const today = getTaiwanToday(); // YYYY-MM-DD，ISO 字典序 = 日期序
        // periodStart/periodEnd 可能是 ISO "YYYY-MM-DD" 或台灣慣用 "YYYY/M/D"，
        // 字串比較前先統一轉成 ISO，否則 "-" 與 "/" 的字元順序會讓比較結果錯亂。
        // ⚠️ 只給一邊也要判斷：只有 periodStart = 開始後無限期；只有 periodEnd =
        //   一開始就有效、到期為止。過去「缺一邊就回 always」會讓已過期（有 periodEnd
        //   但沒 periodStart）的活動永遠不被隱藏。
        const start = periodStart ? (periodStart.includes('-') ? periodStart : slashDateToISO(periodStart)) : null;
        const end = periodEnd ? (periodEnd.includes('-') ? periodEnd : slashDateToISO(periodEnd)) : null;
        if (end && today > end) return 'expired';
        if (start && today < start) return 'upcoming';
        return 'active';
    } catch (error) {
        console.error('❌ Date parsing error:', error, { periodStart, periodEnd });
        return 'always';
    }
}

// 有一整類活動，Apps Script 只匯出了合併字串 period（"YYYY/M/D~YYYY/M/D"）與
// periodEnd，卻「沒有」單獨的 periodStart 欄位。expiry / upcoming 判斷看的是
// periodStart/periodEnd 欄位，缺欄位會誤判（過期活動不被隱藏、未來活動提早顯示）。
// 這裡從 period 字串把缺少的那一邊「補回」——只補「缺的」欄位、絕不覆寫既有值，
// 因為 period 字串偶爾比 periodStart/periodEnd 欄位舊（如中信 LINE Pay 肌膚之鑰：
// period 停在 ~6/30 但 periodEnd 欄位已更新為 12/31，覆寫會誤把生效中的活動判為過期）。
function backfillPeriodBounds(entry) {
    if (!entry || typeof entry.period !== 'string' || !entry.period.includes('~')) return;
    const [startRaw, endRaw] = entry.period.split('~');
    if (!entry.periodStart && startRaw) {
        const iso = slashDateToISO(startRaw.trim());
        if (iso) entry.periodStart = iso;
    }
    if (!entry.periodEnd && endRaw) {
        const iso = slashDateToISO(endRaw.trim());
        if (iso) entry.periodEnd = iso;
    }
}

// Check if a rate is currently active (for backwards compatibility)
// Rate status cache for performance optimization
let rateStatusCache = new Map();

// Card level cache: avoids repeated Firestore getDoc calls for the same card's
// selected level during a single calculation. getCardLevel() is called once per
// (matchedItem × card), so a multi-item search like "日本" would otherwise fire
// dozens of identical network round-trips (~10s on mobile). Keyed by uid+cardId;
// write-through on saveCardLevel and cleared on auth changes to stay fresh.
let cardLevelCache = new Map();

function cardLevelCacheKey(cardId) {
    const uid = (auth && auth.currentUser) ? auth.currentUser.uid : 'guest';
    return `${uid}_${cardId}`;
}

function clearCardLevelCache() {
    cardLevelCache.clear();
}

// ========== localStorage 安全讀取 helpers ==========
// localStorage 裡的 JSON 一旦損毀（舊版程式寫入格式不符、被手動改過、擴充套件污染），
// 直接 JSON.parse 會拋錯並中斷整個載入流程（過去曾因此造成詳情頁打不開）。
// 所有 localStorage 的 JSON 讀取一律走這裡：壞資料回傳 fallback 並移除該 key。
// 配卡資料（配對、持有卡、額度）變了 → 通知「我的刷卡小抄」頁（js/mappings-page.js 監聽；頁面沒開就什麼都不做）。
// 用 DOM 事件而不是直接呼叫對方的函式：發出端不用知道誰在聽，也不用 typeof 檢查。
function notifyMappingsDataChanged() {
    document.dispatchEvent(new Event('pmc:mappings-data-changed'));
}

// 寫 localStorage 的「本機快取」那一步（2026-11-23，稽核 B7）。setItem 在儲存空間滿了、或瀏覽器的
// 隱私設定擋住網站資料時會直接拋錯；以前免年費／額度／結帳日／刷卡小抄的儲存函式第一行就是裸的
// setItem，一拋錯整個函式中斷，**後面的雲端寫入根本沒跑**——登入用戶改了設定、畫面上看起來成功，
// 其實哪裡都沒存。本機快取只是快取，寫不進去不該擋住雲端。回傳 true＝寫成功。
function writeLocal(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.error('❌ 本機儲存失敗（雲端照常同步）:', key, e);
        return false;
    }
}

function readLocalJSON(key, fallback = null) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { return fallback; }
    if (raw === null) return fallback;
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.error(`⚠️ localStorage "${key}" 資料損毀，已移除該筆資料`, e);
        try { localStorage.removeItem(key); } catch (e2) { /* ignore */ }
        return fallback;
    }
}

// 讀取「必須是陣列」的 localStorage JSON；非陣列（污染成物件/字串）一律回 fallback，
// 避免下游 new Set(...) / .forEach(...) 直接拋錯。
function readLocalJSONArray(key, fallback = []) {
    const parsed = readLocalJSON(key, null);
    return Array.isArray(parsed) ? parsed : fallback;
}

// 過濾掉 cards.data 中已不存在的卡片 ID（卡片下架/改名後，用戶本機或雲端
// 可能還存著舊 ID）。只在記憶體中過濾、絕不回寫儲存 —— 「找不到」可能是
// 資料匯出短暫不完整造成的暫時現象，回寫會永久抹掉用戶的選擇。
function filterKnownCardIds(ids) {
    if (!Array.isArray(ids)) return [];
    if (!cardsData || !Array.isArray(cardsData.cards) || cardsData.cards.length === 0) return ids;
    const known = new Set(cardsData.cards.map(card => card.id));
    return ids.filter(id => known.has(id));
}

// Get cached rate status to avoid repeated date calculations
function getCachedRateStatus(periodStart, periodEnd) {
    const key = `${periodStart}-${periodEnd}`;
    if (!rateStatusCache.has(key)) {
        rateStatusCache.set(key, getRateStatus(periodStart, periodEnd));
    }
    return rateStatusCache.get(key);
}

// ============================================================
// 「還有幾天」的唯一算法（2026-11-17 合併；原本 core-utils 四支、home-ui、mappings-page 各算各的，
// 其中亮點卡用的是裝置時區）。
// 台灣今天到指定日期的天數（整數）：當天 0、明天 1、昨天 -1；日期字串不合法回 null。
// 接受 ISO "YYYY-MM-DD" 與台式 "YYYY/M/D"。
// ⚠️「今天」一律是台灣的今天（getTaiwanToday），而且用 UTC 日曆日相減——結果跟使用者裝置的
//    時區、日光節約時間都無關。新增任何「剩 N 天／N 天後開始」的顯示都走這支，不要再自己 new Date() 相減。
function taiwanDaysUntil(dateStr) {
    if (!dateStr) return null;
    const utcDay = (value) => {
        const str = String(value);
        const iso = str.includes('-') ? str : slashDateToISO(str);
        if (!iso) return NaN;
        const [y, m, d] = iso.split('-').map(Number);
        return Date.UTC(y, m - 1, d);
    };
    const diff = (utcDay(dateStr) - utcDay(getTaiwanToday())) / 86400000;
    return Number.isFinite(diff) ? Math.round(diff) : null;
}

// 台灣現在是幾月（1–12）。慶生月方案的判斷用，不看裝置時區。
function getTaiwanMonth() {
    return Number(getTaiwanToday().slice(5, 7));
}

// Check if upcoming activity starts within N days
function isUpcomingWithinDays(periodStart, days = 30) {
    const diffDays = taiwanDaysUntil(periodStart);
    return diffDays !== null && diffDays >= 0 && diffDays <= days;
}

// Get days until activity starts (returns number or null if error)
function getDaysUntilStart(periodStart) {
    const diffDays = taiwanDaysUntil(periodStart);
    return diffDays !== null && diffDays >= 0 ? diffDays : null;
}

// Check if activity is ending soon (within N days)
function isEndingSoon(periodEnd, days = 10) {
    const diffDays = taiwanDaysUntil(periodEnd);
    return diffDays !== null && diffDays >= 0 && diffDays <= days;
}

// Get days until activity ends (returns number or null if error)
function getDaysUntilEnd(periodEnd) {
    const diffDays = taiwanDaysUntil(periodEnd);
    return diffDays !== null && diffDays >= 0 ? diffDays : null;
}

// 卡片權益（cardsData.benefits，停車折抵那類）的期限欄位只有一個自由格式字串
// `benefit_period`：現行資料全是「單一結束日」（"2026-12-31" 或 "2026/12/31"），
// 但資料端隨時可能改寫成區間（"2026/7/1~2026/12/31"）或非日期文字（"依官網公告"）。
// 這裡一律用「抓出字串裡所有日期樣式」的方式拆成 { start, end }：
//   0 個日期 → 兩邊都 null（＝不設限，永不隱藏；自由文字不可以被當成過期）
//   1 個日期 → 只當結束日（現行資料的寫法）
//   ≥2 個   → 第一個當開始日、最後一個當結束日
function parseBenefitPeriod(benefitPeriod) {
    if (!benefitPeriod || typeof benefitPeriod !== 'string') return { start: null, end: null };
    const found = benefitPeriod.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g);
    if (!found || found.length === 0) return { start: null, end: null };
    const toISO = (raw) => {
        const [y, m, d] = raw.split(/[/-]/).map(Number);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    if (found.length === 1) return { start: null, end: toISO(found[0]) };
    return { start: toISO(found[0]), end: toISO(found[found.length - 1]) };
}

// 卡片權益的期間狀態，語義與 getRateStatus 相同：'active' | 'upcoming' | 'expired' | 'always'
function getBenefitStatus(benefit) {
    if (!benefit) return 'always';
    const { start, end } = parseBenefitPeriod(benefit.benefit_period);
    return getRateStatus(start, end);
}

// 國內／海外加碼的活動期間（2026-11-23 站長要求：和其他活動一樣依期間到期）。
// 匯出端欄位是卡片層的 domesticBonusPeriod／overseasBonusPeriod（"YYYY/M/D~YYYY/M/D"，
// 一張卡兩種加碼各一個，分級卡各級別共用卡片層的期間）。沒填＝長期有效，照舊。
//
// 為什麼在載入時把率歸零、而不是在每個讀率的地方判斷期間：加碼率有 6 個讀取點
// （resolveBonusComponent、getDisplayRate、buildRateCompositionRows、calculateStackedCashback、
// 空白 model 的舊預設、詳情頁一般回饋區），逐處加判斷一定會漏。這裡跟 cashbackRates 過期濾除
// 在同一個時機、同一套 getRateStatus，下游全部自然看到 0：不算、不顯示、組成表不列。
// 卡片層與每個級別的加碼率一起歸零——級別讀不到才退回卡片層（`ls.x || card.x`），只歸一邊會漏。
//
// 還在期間內的，期間記在 card.bonusPeriods[kind]，詳情頁回饋卡拿來顯示「活動期間」與「即將結束」。
// 未開始的加碼只歸零、不預告（目前資料的加碼期間都從年初起算，沒有這種案例）。
function applyBonusPeriods(card) {
    ['domestic', 'overseas'].forEach(kind => {
        const raw = card[kind + 'BonusPeriod'];
        if (!raw) return;
        const p = { period: String(raw) };
        backfillPeriodBounds(p);
        if (!p.periodStart && !p.periodEnd) return; // 期間格式不認得：當作沒填，不隱藏
        const status = getRateStatus(p.periodStart, p.periodEnd);
        if (status === 'active' || status === 'always') {
            if (!card.bonusPeriods) card.bonusPeriods = {};
            card.bonusPeriods[kind] = p;
            return;
        }
        const rateKey = kind + 'BonusRate';
        // 記下來給只讀條件、不讀率的地方用（搜尋結果「一般消費回饋率」卡的加碼條件）
        if (!card.endedBonuses) card.endedBonuses = {};
        card.endedBonuses[kind] = status;
        console.log(`🕒 ${card.name}: ${status === 'expired' ? '加碼已過期' : '加碼未開始'}，${rateKey} 歸零 (${p.period})`);
        if (card[rateKey] != null) card[rateKey] = 0;
        Object.values(card.levelSettings || {}).forEach(ls => {
            if (ls && ls[rateKey] != null) ls[rateKey] = 0;
        });
    });
}

// Filter expired rates from cards data (keep active and upcoming within 30 days)
function filterExpiredRates(cardsData) {
    if (!cardsData || !cardsData.cards) {
        return cardsData;
    }

    cardsData.cards.forEach(card => {
        // A card can claim hasLevels=true while its levelSettings is empty — e.g.
        // every level's period has expired and the Google Sheets export dropped
        // them, leaving `levelSettings: {}`. Downstream code assumes at least one
        // level exists (Object.keys(levelSettings)[0]) and would read
        // levelSettings[undefined] → crash (the card detail modal never opens).
        // Demote such a card to a plain non-level card so every `if (card.hasLevels)`
        // branch is skipped uniformly.
        if (card.hasLevels && (!card.levelSettings || Object.keys(card.levelSettings).length === 0)) {
            console.warn(`⚠️ ${card.name}: hasLevels=true 但 levelSettings 為空（可能所有級別已過期），改以一般卡處理`);
            card.hasLevels = false;
        }

        applyBonusPeriods(card); // 加碼期間過了（或還沒到）→ 加碼率歸零，見函式說明

        // Filter cashbackRates - keep active and upcoming (within 30 days)
        if (card.cashbackRates && Array.isArray(card.cashbackRates)) {
            card.cashbackRates = card.cashbackRates.filter(rate => {
                backfillPeriodBounds(rate); // 從 period 字串補回缺少的 periodStart/periodEnd
                const status = getRateStatus(rate.periodStart, rate.periodEnd);

                // Always keep active and always-active rates
                if (status === 'active' || status === 'always') {
                    return true;
                }

                // Keep upcoming if within 30 days
                if (status === 'upcoming') {
                    const isWithin30Days = isUpcomingWithinDays(rate.periodStart, 30);
                    if (!isWithin30Days) {
                        console.log(`🕒 ${card.name}: 隐藏未来优惠 - ${rate.items ? rate.items[0] : 'unknown'} (${rate.periodStart}~${rate.periodEnd})`);
                    }
                    return isWithin30Days;
                }

                // Filter out expired
                console.log(`🕒 ${card.name}: 隐藏过期优惠 - ${rate.items ? rate.items[0] : 'unknown'} (${rate.periodStart}~${rate.periodEnd})`);
                return false;
            });
        }

        // Filter couponCashbacks - keep active and upcoming (within 30 days)
        if (card.couponCashbacks && Array.isArray(card.couponCashbacks)) {
            card.couponCashbacks = card.couponCashbacks.filter(coupon => {
                backfillPeriodBounds(coupon); // 從 period 字串補回缺少的 periodStart/periodEnd
                const status = getRateStatus(coupon.periodStart, coupon.periodEnd);

                // Always keep active and always-active coupons
                if (status === 'active' || status === 'always') {
                    return true;
                }

                // Keep upcoming if within 30 days
                if (status === 'upcoming') {
                    const isWithin30Days = isUpcomingWithinDays(coupon.periodStart, 30);
                    if (!isWithin30Days) {
                        console.log(`🕒 ${card.name}: 隐藏未来优惠券 - ${coupon.merchant} (${coupon.periodStart}~${coupon.periodEnd})`);
                    }
                    return isWithin30Days;
                }

                // Filter out expired
                console.log(`🕒 ${card.name}: 隐藏过期优惠券 - ${coupon.merchant} (${coupon.periodStart}~${coupon.periodEnd})`);
                return false;
            });
        }
    });

    // Filter expired new cardholder promos (top-level array, not per-card)
    if (cardsData.newCardholderPromos && Array.isArray(cardsData.newCardholderPromos)) {
        const before = cardsData.newCardholderPromos.length;
        cardsData.newCardholderPromos = cardsData.newCardholderPromos.filter(promo => {
            // Keep if no end date (ongoing) or end date >= today
            if (!promo.period_end) return true;
            // period_end 相容 ISO 與台式斜線兩種寫法（見 data-pipeline.md 第 8 節）；格式不對的當作沒寫、不隱藏
            // 「今天」用台灣的今天（getRateStatus 內部走 getTaiwanToday），不看裝置時區——
            // 原本拿裝置的本地午夜來比，海外用戶會早一天或晚一天看到活動下架
            const isActive = getRateStatus(null, promo.period_end) !== 'expired';
            if (!isActive) {
                console.log(`🕒 隱藏過期新戶活動 - ${promo.id} ${promo.promo_name} (~${promo.period_end})`);
            }
            return isActive;
        });
        console.log(`✨ 新戶活動: ${before} → ${cardsData.newCardholderPromos.length} 筆有效`);
    }

    // Filter expired card benefits（停車折抵等「卡片權益」，top-level 陣列）
    // 2026-09-02：權益過去完全沒有期限判斷，過期的（如遠東樂家+卡 ~2026/6/30）
    // 在搜尋結果與卡片詳情頁都還照常顯示。與 cashbackRates 一樣在載入時就濾掉，
    // 四個消費端（displayParkingBenefits、詳情頁權益區、兩處搜尋提示）一次到位。
    // 只濾 expired：upcoming 留著（權益資料目前不寫開始日，留著也不會誤顯示）。
    if (cardsData.benefits && Array.isArray(cardsData.benefits)) {
        const before = cardsData.benefits.length;
        cardsData.benefits = cardsData.benefits.filter(benefit => {
            if (getBenefitStatus(benefit) !== 'expired') return true;
            console.log(`🕒 隱藏過期卡片權益 - ${benefit.id} ${benefit.benefit_desc || ''} (~${benefit.benefit_period})`);
            return false;
        });
        if (before !== cardsData.benefits.length) {
            console.log(`🅿️ 卡片權益: ${before} → ${cardsData.benefits.length} 筆有效`);
        }
    }

    return cardsData;
}

// Returns the cards to use in comparison results, based on the user's selection.
// Falls back to all cards if cardsInComparison is empty (e.g., before auth state fires).
function getCardsForComparison() {
    if (cardsInComparison.size === 0) return cardsData.cards;
    return cardsData.cards.filter(card => cardsInComparison.has(card.id));
}

// Get active new cardholder promos for a given card id, sorted by priority
function getActiveCardholderPromos(cardId) {
    if (!cardsData || !cardsData.newCardholderPromos) return [];
    return cardsData.newCardholderPromos
        .filter(promo => promo.id === cardId)
        .sort((a, b) => {
            const pa = typeof a.priority === 'number' ? a.priority : 99;
            const pb = typeof b.priority === 'number' ? b.priority : 99;
            return pa - pb;
        });
}

// True if the bonus_merchants value (string or array) represents the *all_items wildcard.
// Robust to whitespace and case variants.
function isAllItemsMarker(raw) {
    const norm = (s) => String(s).trim().toLowerCase();
    if (typeof raw === 'string') return norm(raw) === '*all_items';
    if (Array.isArray(raw)) {
        // Treat as wildcard if any (typically the only) entry is the marker
        return raw.some(item => norm(item) === '*all_items');
    }
    return false;
}

// 新戶活動 bonus_merchants 的兩個萬用標記（站長 2026-10-04 定義）：
//   *all_items ＝ 只加碼在這張卡原本的回饋通路上 → 展開成該卡 cashbackRates 的 items
//   *general   ＝ 一般消費都算（不限通路）→ 任何搜尋都符合，顯示 GENERAL_SPENDING_LABEL
const GENERAL_SPENDING_LABEL = '一般消費皆適用';
function isGeneralSpendingMarker(raw) {
    const norm = (s) => String(s).trim().toLowerCase();
    if (typeof raw === 'string') return norm(raw) === '*general';
    if (Array.isArray(raw)) return raw.some(item => norm(item) === '*general');
    return false;
}

// Expand bonus_merchants - if it's "*all_items", return the card's actual cashbackRates items.
// *general 沒有可展開的通路，回傳空陣列；呼叫端要先用 isGeneralSpendingMarker() 判斷。
function expandPromoMerchants(promo, card) {
    if (!promo.bonus_merchants) return [];
    if (isAllItemsMarker(promo.bonus_merchants)) {
        return collectCardItems(card);
    }
    if (typeof promo.bonus_merchants === 'string') {
        return promo.bonus_merchants.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (Array.isArray(promo.bonus_merchants)) {
        return promo.bonus_merchants.map(s => String(s).trim()).filter(Boolean);
    }
    return [];
}

// Collect all items from a card's cashbackRates (for *all_items expansion)
function collectCardItems(card) {
    if (!card) return [];
    const items = new Set();
    if (Array.isArray(card.cashbackRates)) {
        card.cashbackRates.forEach(rate => {
            if (Array.isArray(rate.items)) {
                rate.items.forEach(item => items.add(item));
            }
        });
    }
    return Array.from(items);
}

// Build items index for fast lookup (performance optimization)

// ========== 雲端同步錯誤提示（pmcOnFirestoreError） ==========
// index.html 把 window.getDoc/setDoc/addDoc/deleteDoc 包了一層，任何 Firestore 請求失敗都會
// 先呼叫這裡，再把錯誤原樣丟回給原本的 catch（各處既有的錯誤處理不變）。
// 只處理 permission-denied：App Check Enforce 後擋廣告／隱私外掛擋掉 reCAPTCHA、
// 超過每帳號寫入上限（firestore.rules 的 rateLimits），都會以這個錯誤被拒（規則擋下也是）。原本各處 catch 只寫
// console，用戶只看到「存了沒反應」，所以這裡補一則看得到的說明；每次開頁只提示一次。
let pmcCloudErrorShown = false;
window.pmcOnFirestoreError = function (err) {
    if (!err || err.code !== 'permission-denied') return;
    if (typeof currentUser === 'undefined' || !currentUser) return; // 訪客不碰 Firestore；登出途中的殘留請求不提示
    console.error('☁️ 雲端存取被拒（permission-denied）:', err);
    if (pmcCloudErrorShown) return;
    pmcCloudErrorShown = true;

    const bar = document.createElement('div');
    bar.className = 'pmc-cloud-error';
    bar.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.textContent = '雲端同步失敗：你的設定可能沒有存到雲端。請先重新整理頁面再試一次。'
        + '如果有開擋廣告或隱私保護外掛，請把 pickmycard.app 加入白名單；仍然不行請從頭像選單「回報問題」告訴我們。';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pmc-cloud-error-close';
    close.setAttribute('aria-label', '關閉');
    close.textContent = '×';
    close.addEventListener('click', () => bar.remove());
    bar.append(text, close);
    document.body.appendChild(bar);
};

// ========== 回饋上限文字 formatCapText（2026-11-17 由六種寫法合併）==========
// 把「回饋消費上限」數字轉成畫面文字：有上限 → 「NT$7,500」，沒有 → 「無上限」。
// ⚠️ 合併時各處對 0／空字串／非數字字串的處理本來就不一致，為了「畫面逐字不變」，用
// unlimitedWhen 保留各自的判斷，**不要自行統一**（要不要統一由站長決定）。
//
// opts.unlimitedWhen（什麼值算「無上限」）：
//   'falsy'        （預設）!cap：null／undefined／''／0／NaN 算無上限；字串 '0' 與 'abc' 不算
//                  （會印成 NT$0／NT$NaN）。→ formatRateCardCap（詳情頁回饋卡、搜尋結果卡上限欄）、
//                    搜尋結果卡 capText、「回饋組成」彈窗每列上限、詳情頁級別說明（card-detail 的 levelSettings）
//   'falsyOrNaN'   !cap 或 isNaN(cap)：多擋掉非數字字串；'0'、負數照印。→ 領券結果卡（createCouponResultElement）
//   'nullishOrNaN' 只有 null／undefined／NaN／非數字字串算無上限；**0 與 '' 會印成 NT$0**。→ formatSpotlightCap（推薦活動）
//   'nonPositive'  凡不是「大於 0 的數」都算無上限（0、負數、非數字都是）。→ mpCapText（刷卡小抄）、
//                  搜尋結果卡「計算明細」上限欄（layer.cap）
// opts.unlimitedText  無上限時的字樣，預設 '無上限'（可傳 '' 留白）
// opts.currency       false＝數字前不加「NT$」（計算明細的上限欄，欄位標題已有幣別）
// opts.prefix/suffix  只加在「有上限」的字樣前後（例：'上限 '、台新 Richart 的 '+'）
function formatCapText(cap, opts) {
    const o = opts || {};
    const unlimitedText = o.unlimitedText !== undefined ? o.unlimitedText : '無上限';
    let unlimited;
    switch (o.unlimitedWhen) {
        case 'falsyOrNaN': unlimited = !cap || isNaN(cap); break;
        case 'nullishOrNaN': unlimited = cap === null || cap === undefined || isNaN(cap); break;
        case 'nonPositive': unlimited = !(cap != null && cap > 0); break;
        default: unlimited = !cap;
    }
    if (unlimited) return unlimitedText;
    return `${o.prefix || ''}${o.currency === false ? '' : 'NT$'}${Math.floor(cap).toLocaleString()}${o.suffix || ''}`;
}
