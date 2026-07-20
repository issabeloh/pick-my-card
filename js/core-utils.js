/* ============================================================
 * Pick My Card — script.js 區塊目錄
 * （用下列關鍵字在檔案內搜尋即可跳到該區；刻意不寫行號以免過時）
 *
 *  1. Debug 日誌閘門           → "Debug 日誌閘門"
 *  2. 全域狀態                 → "Global variables"
 *  3. localStorage 安全讀取     → "localStorage 安全讀取 helpers"
 *  4. 資料載入與搜尋索引        → "loadCardsData" / "buildCardItemsIndex"
 *  5. 快捷搜尋                 → "handleQuickSearch" / "QuickSearch"
 *  6. 精選活動（Spotlight）     → "renderSpotlights"
 *  7. 公告                    → "displayAnnouncement"
 *  8. 搜尋匹配                 → "findMatchingItem"
 *  9. 回饋計算（總調度）        → "calculateCashback"
 * 10. 回饋計算（單卡引擎）      → "calculateCardCashback" /
 *     "calculateLayeredCashback"(瀑布) / "calculateStackedCashback"(疊加) /
 *     "getOverflowRate"(溢出) / "findUpcomingActivity"(即將開始)
 * 11. Placeholder 解析         → "extractPlaceholderField"
 * 12. 結果顯示                 → "displayResults" / "displayCouponCashbacks" /
 *     "displayParkingBenefits" / "displayCardholderPromos"
 * 13. HTML 轉義與連結防護      → "escapeHtml" / "sanitizeUrl"
 * 14. 登入/登出與資料同步      → "onAuthStateChanged" / "absorbGuestPersonalData" /
 *     "clearPersonalLocalDataOnSignOut"
 * 15. 用戶資料載入/儲存        → "loadCardsInComparison" / "loadMyOwnedCards" /
 *     "loadUserPayments" / "loadSpendingMappings"
 * 16. 卡片詳情頁              → "showCardDetail"
 * 17. 筆記/免年費/結帳日       → "loadUserNotes" / "loadFeeWaiverStatus" / "loadBillingDates"
 * 18. 卡片級別                → "Card Level Management" / "resolveCardLevel"
 * 19. 回報（意見回饋）        → "feedback"
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
let auth = null;
let db = null;
let cardsData = null;
let paymentsData = null;
let quickSearchOptions = [];
let userBirthdayMonth = null; // 用戶生日月份 (1-12)，null 表示未設定
let isBirthdayMonth = false;  // 預先計算的旗標：當前月份是否為生日月份
let isChildrenEligible = true; // 用戶是否符合「童樂匯」權益（預設為是）
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

// Body scroll lock utilities (compensate scrollbar width to prevent layout shift).
// Refcounted so stacked modals (e.g. card detail opened from inside another modal)
// don't release the scroll lock while an outer modal is still open.
let bodyScrollLockDepth = 0;
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

// 解析日期字串為本地午夜 Date 物件（供天數差計算用）
// 相容 ISO "YYYY-MM-DD" 與台灣慣用 "YYYY/M/D"（Apps Script 匯出的 periodStart/periodEnd 兩種格式都會出現）
function parseISODate(dateStr) {
    if (!dateStr) return null;
    const isoStr = dateStr.includes('-') ? dateStr : slashDateToISO(dateStr);
    if (!isoStr) return null;
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(y, m - 1, d);
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

// Check if upcoming activity starts within N days
function isUpcomingWithinDays(periodStart, days = 30) {
    if (!periodStart) return false;

    try {
        const today = parseISODate(getTaiwanToday());
        const startDate = parseISODate(periodStart);
        const diffDays = Math.ceil((startDate - today) / 86400000);
        return diffDays >= 0 && diffDays <= days;
    } catch (error) {
        console.error('❌ Date parsing error:', error, { periodStart });
        return false;
    }
}

// Get days until activity starts (returns number or null if error)
function getDaysUntilStart(periodStart) {
    if (!periodStart) return null;

    try {
        const today = parseISODate(getTaiwanToday());
        const startDate = parseISODate(periodStart);
        const diffDays = Math.ceil((startDate - today) / 86400000);
        return diffDays >= 0 ? diffDays : null;
    } catch (error) {
        console.error('❌ Date parsing error:', error, { periodStart });
        return null;
    }
}

// Check if activity is ending soon (within N days)
function isEndingSoon(periodEnd, days = 10) {
    if (!periodEnd) return false;

    try {
        const today = parseISODate(getTaiwanToday());
        const endDate = parseISODate(periodEnd);
        const diffDays = Math.ceil((endDate - today) / 86400000);
        return diffDays >= 0 && diffDays <= days;
    } catch (error) {
        console.error('❌ Date parsing error:', error, { periodEnd });
        return false;
    }
}

// Get days until activity ends (returns number or null if error)
function getDaysUntilEnd(periodEnd) {
    if (!periodEnd) return null;

    try {
        const today = parseISODate(getTaiwanToday());
        const endDate = parseISODate(periodEnd);
        const diffDays = Math.ceil((endDate - today) / 86400000);
        return diffDays >= 0 ? diffDays : null;
    } catch (error) {
        console.error('❌ Date parsing error:', error, { periodEnd });
        return null;
    }
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
            // 一律走 parseISODate（相容 ISO 與台式斜線，見 data-pipeline.md 第 8 節）——
            // 舊 parseDateString 只認 "/"，ISO 的 period_end 解析成 null 被當永久有效，過期活動永遠濾不掉
            const endDate = parseISODate(promo.period_end);
            if (!endDate) return true;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const isActive = endDate >= today;
            if (!isActive) {
                console.log(`🕒 隱藏過期新戶活動 - ${promo.id} ${promo.promo_name} (~${promo.period_end})`);
            }
            return isActive;
        });
        console.log(`✨ 新戶活動: ${before} → ${cardsData.newCardholderPromos.length} 筆有效`);
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

// Expand bonus_merchants - if it's "*all_items", return the card's actual cashbackRates items.
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
