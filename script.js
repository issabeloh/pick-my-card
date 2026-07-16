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
function buildCardItemsIndex(card) {
    const itemsMap = new Map();

    // Index cashbackRates items
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        card.cashbackRates.forEach((rateGroup, rateIndex) => {
            if (rateGroup.items && rateGroup.items.length > 0) {
                rateGroup.items.forEach(item => {
                    const itemLower = item.toLowerCase();
                    if (!itemsMap.has(itemLower)) {
                        itemsMap.set(itemLower, []);
                    }
                    itemsMap.get(itemLower).push({
                        type: 'cashbackRate',
                        index: rateIndex,
                        rateGroup: rateGroup
                    });
                });
            }
        });
    }

    // Index specialItems (can be string array or object array)
    if (card.specialItems && card.specialItems.length > 0) {
        card.specialItems.forEach((specialItem, specialIndex) => {
            const itemLower = (typeof specialItem === 'string' ? specialItem : specialItem.item || '').toLowerCase();
            if (itemLower) {
                if (!itemsMap.has(itemLower)) {
                    itemsMap.set(itemLower, []);
                }
                itemsMap.get(itemLower).push({
                    type: 'specialItem',
                    index: specialIndex,
                    specialItem: specialItem
                });
            }
        });
    }

    // Index generalItems (for cards like CUBE - object with category keys)
    if (card.generalItems && typeof card.generalItems === 'object') {
        for (const [category, items] of Object.entries(card.generalItems)) {
            if (Array.isArray(items)) {
                items.forEach(item => {
                    const itemLower = item.toLowerCase();
                    if (!itemsMap.has(itemLower)) {
                        itemsMap.set(itemLower, []);
                    }
                    itemsMap.get(itemLower).push({
                        type: 'generalItem',
                        category: category,
                        item: item
                    });
                });
            }
        }
    }

    card._itemsIndex = itemsMap;
    return itemsMap.size; // Return number of indexed items
}

// Load cards data from cards.data (encoded)
//
// 快取策略（2026-07 版本指標方案）：
// 1. 先抓幾十 bytes 的 cards.version（永遠不快取）
// 2. 用版本號當 cards.data 的 ?v= 參數 → 版本沒變時瀏覽器直接用快取，
//    省下每次進站 ~485KB 的下載；資料更新後版本號改變 → 立即抓到新資料
// 3. cards.version 不存在或抓不到時，回退舊行為（no-store 每次重抓），
//    功能完全不受影響
// ⚠️ 資料維護流程：更新 cards.data 時「務必」同步更新 cards.version
//    （詳見 CARDS-DATA-CACHE-README.md），否則使用者最多會延遲約 10 分鐘
//    （GitHub Pages 的快取時效）才看到新資料。
async function loadCardsData() {
    try {
        let version = null;
        try {
            const vRes = await fetch(`cards.version?t=${Date.now()}`, { cache: 'no-store' });
            if (vRes.ok) {
                const text = (await vRes.text()).trim();
                // 防呆：版本檔應是短字串（時間戳），過長或像 HTML（404 頁）視為無效
                if (text && text.length <= 64 && !text.includes('<')) {
                    version = encodeURIComponent(text);
                }
            }
        } catch (e) { /* 拿不到版本檔 → 回退舊行為 */ }

        const response = version
            ? await fetch(`cards.data?v=${version}`) // 可被瀏覽器快取，版本變了自動失效
            : await fetch(`cards.data?t=${Date.now()}`, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // 讀取編碼的文字
        const encoded = await response.text();
        
        // 解碼函數
        const decoded = decodeURIComponent(escape(atob(encoded)));
        cardsData = JSON.parse(decoded);

        // Filter out expired rates based on periodStart and periodEnd
        cardsData = filterExpiredRates(cardsData);

        // 併入資料驅動的搜尋排除規則（SearchExclusions 工作表，選填）
        mergeDataSearchExclusions(cardsData);

        console.log('✅ 信用卡資料已從 cards.data 載入');
        console.log(`📊 載入了 ${cardsData.cards.length} 張信用卡`);
        console.log(`📢 公告數量: ${cardsData.announcements ? cardsData.announcements.length : 0} 則`);
        console.log(`📦 檔案大小: ${Math.round(encoded.length / 1024)} KB (載入時間: ${new Date().toLocaleTimeString()})`);

        // Build search index for all cards
        let totalIndexedItems = 0;
        cardsData.cards.forEach(card => {
            const indexedCount = buildCardItemsIndex(card);
            totalIndexedItems += indexedCount;
        });
        console.log(`🚀 搜尋索引已建立: ${totalIndexedItems} 個項目`);

        // Update card count (.card-count may appear in multiple places)
        const cardCountElements = document.querySelectorAll('.card-count');
        if (cardCountElements.length > 0) {
            cardCountElements.forEach(el => {
                el.textContent = cardsData.cards.length;
                el.classList.remove('loading');
            });
            console.log(`✅ 卡片數量已更新: ${cardsData.cards.length} 張`);
        } else {
            console.warn('⚠️ 找不到 .card-count 元素');
        }

        // Display last update date
        const lastUpdateElement = document.getElementById('last-update-date');
        if (lastUpdateElement && cardsData.lastUpdated) {
            lastUpdateElement.textContent = `最後資料更新：${cardsData.lastUpdated}`;
            console.log(`📅 最後資料更新：${cardsData.lastUpdated}`);
        }

        return true;
    } catch (error) {
        console.error('❌ 載入信用卡資料失敗:', error);
        showErrorMessage('無法載入信用卡資料,請重新整理頁面或聯絡管理員。');
        return false;
    }
}

// Initialize payments data from cardsData
function initializePaymentsData() {
    // Try to load from cardsData first (from cards.data file)
    if (cardsData && cardsData.payments) {
        paymentsData = {
            payments: cardsData.payments
        };
        console.log('✅ 行動支付資料已從 cards.data 載入');
        console.log(`📱 載入了 ${paymentsData.payments.length} 種行動支付`);
    } else {
        // Fallback to hardcoded data if not available in cards.data
        console.warn('⚠️ cards.data 中沒有 payments 資料，使用預設資料');
        paymentsData = {
            payments: [
                { id: 'linepay', name: 'LINE Pay', website: 'https://pay.line.me/portal/tw/main', searchTerms: ['linepay', 'line pay'] },
                { id: 'jkopay', name: '街口支付', website: 'https://www.jkopay.com/', searchTerms: ['街口', '街口支付', 'jkopay'] },
                { id: 'applepay', name: 'Apple Pay', website: 'https://www.apple.com/tw/apple-pay/', searchTerms: ['apple pay', 'applepay'] },
                { id: 'pxpayplus', name: '全支付', website: 'https://www.pxpay.com.tw/', searchTerms: ['全支付', 'pxpay'] },
                { id: 'easywallet', name: '悠遊付', website: 'https://easywallet.easycard.com.tw/', searchTerms: ['悠遊付', 'easy wallet', 'easywallet'] },
                { id: 'googlepay', name: 'Google Pay', website: 'https://pay.google.com/intl/zh-TW_tw/about/', searchTerms: ['google pay', 'googlepay'] },
                { id: 'esunwallet', name: '玉山 Wallet', website: 'https://www.esunbank.com/zh-tw/personal/deposit/ebank/wallet', searchTerms: ['玉山wallet', 'esun wallet'] },
                { id: 'pluspay', name: '全盈+Pay', website: 'https://www.pluspay.com.tw/', searchTerms: ['全盈+pay', '全盈支付', '全盈+', '全盈+pay'] },
                { id: 'openwallet', name: 'OPEN 錢包', website: 'https://www.openpoint.com.tw/opw/index.aspx', searchTerms: ['open錢包', 'open wallet'] },
                { id: 'piwallet', name: 'Pi 拍錢包', website: 'https://www.piwallet.com.tw/', searchTerms: ['pi錢包', 'pi 拍錢包', 'pi wallet'] },
                { id: 'icashpay', name: 'iCash Pay', website: 'https://www.icashpay.com.tw/', searchTerms: ['icash pay', 'icashpay'] },
                { id: 'samsungpay', name: 'Samsung Pay', website: 'https://www.samsung.com/tw/apps/samsung-pay/', searchTerms: ['samsung pay', 'samsungpay'] },
                { id: 'opay', name: '歐付寶行動支付', website: 'https://www.opay.tw/', searchTerms: ['歐付寶', '歐付寶行動支付', 'opay'] },
                { id: 'ecpay', name: '橘子支付', website: 'https://www.ecpay.com.tw/', searchTerms: ['橘子支付', 'ecpay'] },
                { id: 'paypal', name: 'PayPal', website: 'https://www.paypal.com/tw/home', searchTerms: ['paypal'] },
                { id: 'twpay', name: '台灣 Pay', website: 'https://www.twpay.com.tw/', searchTerms: ['台灣pay', 'taiwan pay', 'twpay', '台灣支付'] },
                { id: 'skmpay', name: 'SKM Pay', website: 'https://www.skmpay.com.tw/', searchTerms: ['skm pay', 'skmpay'] },
                { id: 'hamipay', name: 'Hami Pay 掃碼付', website: 'https://hamipay.emome.net/', searchTerms: ['hami pay', 'hamipay', 'hami pay掃碼付'] },
                { id: 'cpcpay', name: '中油 Pay', website: 'https://www.cpc.com.tw/', searchTerms: ['中油pay', 'cpc pay'] },
                { id: 'garminpay', name: 'Garmin Pay', website: 'https://www.garmin.com.tw/minisite/garmin-pay/', searchTerms: ['garmin pay', 'garminpay'] }
            ]
        };
        console.log('✅ 行動支付資料已初始化（預設）');
    }
}

// Get default quick search options from cardsData
function getDefaultQuickSearchOptions() {
    if (cardsData && cardsData.quickSearchOptions) {
        return cardsData.quickSearchOptions;
    }
    return [];
}

// Initialize quick search options from defaults + user prefs (hidden ids + custom options)
// New model: defaults always come from cards.json (so developer updates propagate).
// User prefs store only:
//   - hiddenDefaultIds: which default options the user has removed from their list
//   - customQuickOptions: user-created options
//   - selectedOrder: display order (mix of default ids and custom ids)
async function initializeQuickSearchOptions(userData = null) {
    const defaultOptions = getDefaultQuickSearchOptions();
    const prefs = await loadUserQuickSearchPrefs(userData);

    // Filter out defaults the user has hidden
    const visibleDefaults = defaultOptions.filter(o => !prefs.hiddenDefaultIds.includes(o.id));

    // Combine visible defaults + user's custom options
    let combined = [...visibleDefaults, ...prefs.customQuickOptions];

    // Apply user's preferred order (items not in order list appended in their natural position)
    if (prefs.selectedOrder && prefs.selectedOrder.length > 0) {
        const orderMap = new Map();
        prefs.selectedOrder.forEach((id, idx) => orderMap.set(id, idx));
        combined.sort((a, b) => {
            const aIdx = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
            const bIdx = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
            return aIdx - bIdx;
        });
    }

    quickSearchOptions = combined;
    console.log(`⚡ 載入了 ${quickSearchOptions.length} 個快捷選項 (${visibleDefaults.length} 預設 + ${prefs.customQuickOptions.length} 自訂，隱藏 ${prefs.hiddenDefaultIds.length})`);
}

// Load user quick search preferences (hiddenDefaultIds + customQuickOptions + selectedOrder).
// Auto-migrates legacy `quickSearchOptions` array format on first load.
async function loadUserQuickSearchPrefs(userData = null) {
    const empty = { hiddenDefaultIds: [], customQuickOptions: [], selectedOrder: [] };

    try {
        // Logged-in user: use unified userData or Firestore
        if (currentUser && window.db) {
            let data = userData;
            if (!data) {
                const userDoc = await window.getDoc(window.doc(window.db, 'users', currentUser.uid));
                data = userDoc.exists() ? userDoc.data() : null;
            }
            if (data) {
                // Check if migration is needed (legacy `quickSearchOptions` array exists)
                if (Array.isArray(data.quickSearchOptions)) {
                    console.log('🔀 偵測到舊格式快捷選項，自動遷移為新格式');
                    return await migrateLegacyQuickSearchOptions(data);
                }
                return {
                    hiddenDefaultIds: data.hiddenDefaultIds || [],
                    customQuickOptions: data.customQuickOptions || [],
                    selectedOrder: data.selectedOrder || []
                };
            }
        }

        // Guest: load from localStorage（readLocalJSON：壞資料自動移除並回 null）
        const parsed = readLocalJSON('userQuickSearchPrefs', null);
        if (parsed && typeof parsed === 'object') {
            return {
                hiddenDefaultIds: parsed.hiddenDefaultIds || [],
                customQuickOptions: parsed.customQuickOptions || [],
                selectedOrder: parsed.selectedOrder || []
            };
        }

        // Legacy localStorage migration (guest had old format)
        const oldList = readLocalJSONArray('userQuickSearchOptions', null);
        if (Array.isArray(oldList)) {
            console.log('🔀 偵測到 localStorage 舊格式，自動遷移');
            const customs = readLocalJSONArray('userCustomQuickOptions');
            const migrated = computeMigratedPrefs(oldList, customs);
            localStorage.setItem('userQuickSearchPrefs', JSON.stringify(migrated));
            localStorage.removeItem('userQuickSearchOptions');
            return migrated;
        }
    } catch (error) {
        console.error('載入快捷選項偏好時出錯:', error);
    }
    return empty;
}

// Compute new prefs format from legacy saved list + customs
function computeMigratedPrefs(oldSavedList, existingCustoms) {
    const defaultOptions = getDefaultQuickSearchOptions();
    const defaultIds = new Set(defaultOptions.map(o => o.id));
    const savedIds = new Set(oldSavedList.map(o => o.id));

    // Defaults missing from saved list → hidden
    const hiddenDefaultIds = defaultOptions
        .map(o => o.id)
        .filter(id => !savedIds.has(id));

    // Items in saved list that aren't defaults → custom (merge with existing customs by id)
    const customMap = new Map();
    (existingCustoms || []).forEach(c => { if (c && c.id) customMap.set(c.id, c); });
    oldSavedList.forEach(o => {
        if (o && o.id && !defaultIds.has(o.id) && !customMap.has(o.id)) {
            customMap.set(o.id, o);
        }
    });
    const customQuickOptions = Array.from(customMap.values());

    // Preserve user's order
    const selectedOrder = oldSavedList.map(o => o.id).filter(Boolean);

    return { hiddenDefaultIds, customQuickOptions, selectedOrder };
}

// Migrate Firestore legacy format and persist
async function migrateLegacyQuickSearchOptions(userData) {
    const oldList = userData.quickSearchOptions || [];
    const existingCustoms = userData.customQuickOptions || [];
    const migrated = computeMigratedPrefs(oldList, existingCustoms);

    try {
        if (currentUser && window.db && window.deleteField) {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                hiddenDefaultIds: migrated.hiddenDefaultIds,
                customQuickOptions: migrated.customQuickOptions,
                selectedOrder: migrated.selectedOrder,
                quickSearchOptions: window.deleteField()
            }, { merge: true });
            console.log('✅ 已將舊快捷選項格式遷移為新格式並刪除舊欄位');
        }
        // Update localStorage too
        localStorage.setItem('userQuickSearchPrefs', JSON.stringify(migrated));
        localStorage.removeItem('userQuickSearchOptions');
    } catch (e) {
        console.error('遷移舊快捷選項格式時出錯:', e);
    }

    return migrated;
}

// Save user quick search preferences (new format)
async function saveUserQuickSearchPrefs(prefs) {
    try {
        if (currentUser && window.db) {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                hiddenDefaultIds: prefs.hiddenDefaultIds,
                customQuickOptions: prefs.customQuickOptions,
                selectedOrder: prefs.selectedOrder
            }, { merge: true });
        }
        localStorage.setItem('userQuickSearchPrefs', JSON.stringify(prefs));
        console.log('✅ 用戶快捷選項偏好已保存');
        return true;
    } catch (error) {
        console.error('保存快捷選項偏好時出錯:', error);
        return false;
    }
}

// Render quick search buttons
function renderQuickSearchButtons() {
    const visibleContainer = document.getElementById('quick-search-visible');
    const dropdownContent = document.getElementById('quick-search-dropdown-content');
    const expandBtn = document.getElementById('quick-search-expand-btn');

    if (!visibleContainer || !dropdownContent || !expandBtn) return;

    // Clear existing buttons
    visibleContainer.innerHTML = '';
    dropdownContent.innerHTML = '';

    // If no options, hide everything
    if (quickSearchOptions.length === 0) {
        visibleContainer.style.display = 'none';
        expandBtn.classList.add('hidden');
        return;
    }

    visibleContainer.style.display = 'flex';

    // Create button element helper
    const createButton = (option) => {
        const button = document.createElement('button');
        button.className = 'quick-search-btn';
        button.dataset.merchants = option.merchants.join(',');

        const iconHtml = option.icon ? `<span class="icon">${option.icon}</span>` : '';
        button.innerHTML = `${iconHtml}<span>${option.displayName}</span>`;

        button.addEventListener('click', () => {
            handleQuickSearch(option);
            closeQuickSearchDropdown();
        });

        return button;
    };

    // Add buttons to visible row
    quickSearchOptions.forEach(option => {
        visibleContainer.appendChild(createButton(option));
    });

    // Add all buttons to dropdown
    quickSearchOptions.forEach(option => {
        dropdownContent.appendChild(createButton(option));
    });

    // Setup expand button and dropdown
    setupQuickSearchDropdown();

    console.log(`✅ 已渲染 ${quickSearchOptions.length} 個快捷搜索按鈕`);
}

// Setup quick search dropdown expand/collapse
function setupQuickSearchDropdown() {
    const expandBtn = document.getElementById('quick-search-expand-btn');
    const dropdown = document.getElementById('quick-search-dropdown');

    if (!expandBtn || !dropdown) return;

    // Toggle dropdown on button click
    expandBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        if (isOpen) {
            closeQuickSearchDropdown();
        } else {
            openQuickSearchDropdown();
        }
    };

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !expandBtn.contains(e.target)) {
            closeQuickSearchDropdown();
        }
    });

    // Update position on scroll instead of closing
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        if (dropdown.classList.contains('open')) {
            // Throttle position updates
            if (!scrollTimeout) {
                scrollTimeout = setTimeout(() => {
                    updateDropdownPosition();
                    scrollTimeout = null;
                }, 16); // ~60fps
            }
        }
    }, true);
}

function updateDropdownPosition() {
    const dropdown = document.getElementById('quick-search-dropdown');
    const wrapper = document.querySelector('.quick-search-wrapper');

    if (!dropdown || !wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    // Set dropdown width to match wrapper
    const dropdownWidth = Math.min(wrapperRect.width, viewportWidth - 20);

    // Position below the wrapper
    let top = wrapperRect.bottom + 4;
    let left = wrapperRect.left;

    // Ensure dropdown doesn't go off-screen horizontally
    if (left + dropdownWidth > viewportWidth - 10) {
        left = viewportWidth - dropdownWidth - 10;
    }
    if (left < 10) left = 10;

    // Apply position
    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;
    dropdown.style.width = `${dropdownWidth}px`;
}

function openQuickSearchDropdown() {
    const dropdown = document.getElementById('quick-search-dropdown');
    const expandBtn = document.getElementById('quick-search-expand-btn');

    if (!dropdown) return;

    updateDropdownPosition();
    dropdown.classList.add('open');
    if (expandBtn) expandBtn.classList.add('expanded');
}

function closeQuickSearchDropdown() {
    const dropdown = document.getElementById('quick-search-dropdown');
    const expandBtn = document.getElementById('quick-search-expand-btn');
    if (dropdown) dropdown.classList.remove('open');
    if (expandBtn) expandBtn.classList.remove('expanded');
}

// Handle quick search button click
function handleQuickSearch(option) {
    const merchantInput = document.getElementById('merchant-input');
    if (!merchantInput || !cardsData) return;

    console.log(`\n🔍 快捷搜索: ${option.displayName}`);
    console.log(`   包含 ${option.merchants.length} 個關鍵詞:`);

    // Search for all merchants and combine results
    const allMatches = [];
    const processedItems = new Set(); // Avoid duplicates

    option.merchants.forEach((merchant, index) => {
        const trimmedMerchant = merchant.trim();
        console.log(`   [${index + 1}/${option.merchants.length}] 搜尋: "${trimmedMerchant}"`);

        const matches = findMatchingItem(trimmedMerchant);

        if (matches && matches.length > 0) {
            console.log(`      ✅ 找到 ${matches.length} 個匹配項目`);
            let addedCount = 0;
            matches.forEach(match => {
                // Use originalItem (the actual item name) as the unique key
                const key = match.originalItem.toLowerCase();
                if (!processedItems.has(key)) {
                    processedItems.add(key);
                    allMatches.push(match);
                    addedCount++;
                    console.log(`         ➕ 添加: ${match.originalItem}`);
                } else {
                    console.log(`         ⏭️ 跳過重複: ${match.originalItem}`);
                }
            });
            console.log(`      📌 新增 ${addedCount} 個結果（已去重）`);
        } else {
            console.log(`      ❌ 無匹配結果 - 請檢查 Cards Data 中是否有 "${trimmedMerchant}"`);
        }
    });

    console.log(`\n   ✨ 總計找到 ${allMatches.length} 個唯一的匹配結果\n`);

    // Update UI
    merchantInput.value = option.displayName;
    // 快捷搜尋不受精準搜尋影響，清掉手動輸入殘留的零結果提示
    toggleExactSearchEmptyHint(false);

    if (allMatches.length > 0) {
        // Get cards to compare for parking benefits check
        const cardsToCompare = getCardsForComparison();
        showMatchedItem(allMatches, option.displayName, cardsToCompare);
        currentMatchedItem = allMatches;
        currentQuickSearchOption = option; // Store quick search option for parking benefits

        // 快捷搜尋只填入、不自動計算（2026-07-12 產品決策）：計算一律由用戶按「計算」觸發。
        // 需要點了就出結果的入口（Spotlight 的比較按鈕）由呼叫端自行觸發計算。
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
        currentQuickSearchOption = null;
        console.warn(`   ⚠️ 沒有找到任何匹配項目，請檢查 QuickSearch sheet 的 merchants 欄位\n`);
    }

    merchantInput.focus();
    validateInputs();
}

// ============ 本週亮點活動 (Spotlight) ============
// Editorial highlights from cardsData.spotlights. Shows 3 per page in an
// auto-rotating carousel; the count cap is decoupled from what's visible.
let spotlightItems = [];
let spotlightPage = 0;
let spotlightTimer = null;
const SPOTLIGHT_PAGE_SIZE = 3;
const SPOTLIGHT_MAX = 12;
const SPOTLIGHT_INTERVAL = 6000;

function getSpotlightDaysLeft(deadline) {
    if (!deadline) return null;
    const end = new Date(deadline);
    if (isNaN(end.getTime())) return null;
    end.setHours(23, 59, 59, 999);
    return Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
}

function spotlightTotalPages() {
    return Math.ceil(spotlightItems.length / SPOTLIGHT_PAGE_SIZE);
}

function renderSpotlights() {
    const section = document.getElementById('spotlight-section');
    const track = document.getElementById('spotlight-track');
    if (!section || !track) return;

    const all = (cardsData && Array.isArray(cardsData.spotlights)) ? cardsData.spotlights : [];
    spotlightItems = all
        .filter(s => s && s.active !== false && s.active !== 'FALSE')
        .sort((a, b) => (Number(a.order) || 999) - (Number(b.order) || 999))
        .slice(0, SPOTLIGHT_MAX);

    if (spotlightItems.length === 0) {
        section.style.display = 'none';
        stopSpotlightAutoRotate();
        return;
    }

    section.style.display = 'block';

    spotlightPage = 0;
    buildSpotlightDots();
    renderSpotlightPage();

    const multiPage = spotlightTotalPages() > 1;
    const dots = document.getElementById('spotlight-dots');
    updateSpotlightNav();
    if (dots) dots.style.display = multiPage ? 'flex' : 'none';

    if (multiPage) startSpotlightAutoRotate();
    else stopSpotlightAutoRotate();
}

function renderSpotlightPage() {
    const track = document.getElementById('spotlight-track');
    if (!track) return;
    const start = spotlightPage * SPOTLIGHT_PAGE_SIZE;
    const pageItems = spotlightItems.slice(start, start + SPOTLIGHT_PAGE_SIZE);

    const frag = document.createDocumentFragment();
    pageItems.forEach((item, i) => {
        frag.appendChild(buildSpotlightCard(item, start + i));
    });

    track.classList.remove('spotlight-fade-in');
    track.innerHTML = '';
    track.appendChild(frag);
    void track.offsetWidth; // restart fade animation
    track.classList.add('spotlight-fade-in');

    updateSpotlightDots();
    updateSpotlightNav();
}

// Show the next arrow whenever there are multiple pages; show the prev arrow
// only when we're past the first page (no "previous" on page 1).
function updateSpotlightNav() {
    const multiPage = spotlightTotalPages() > 1;
    const prevBtn = document.getElementById('spotlight-prev-btn');
    const nextBtn = document.getElementById('spotlight-next-btn');
    if (nextBtn) nextBtn.style.display = multiPage ? 'inline-flex' : 'none';
    if (prevBtn) prevBtn.style.display = (multiPage && spotlightPage > 0) ? 'inline-flex' : 'none';
}

function buildSpotlightCard(item, index) {
    const card = document.createElement('div');
    card.className = 'spotlight-card';

    const rate = (item.rate !== undefined && item.rate !== '') ? `${item.rate}%` : '';
    const daysLeft = getSpotlightDaysLeft(item.deadline);
    const daysBadge = (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14)
        ? `<span class="spotlight-days-badge">剩 ${daysLeft} 天</span>` : '';
    const categoryChip = item.category
        ? `<span class="spotlight-tag-chip">${escapeHtml(item.category)}</span>` : '';

    card.innerHTML = `
        <div class="spotlight-card-top">
            <div class="spotlight-tags">
                <span class="spotlight-merchant-tag">${escapeHtml(item.merchant || '')}</span>
                ${categoryChip}
            </div>
            <span class="spotlight-rate">${escapeHtml(rate)}</span>
        </div>
        <div class="spotlight-desc">${escapeHtml(item.description || '')}</div>
        <div class="spotlight-meta">
            <div class="spotlight-meta-row spotlight-meta-card"><span class="spotlight-meta-icon">💳</span><span>${escapeHtml(item.card_name || '')}</span></div>
            ${item.cap ? `<div class="spotlight-meta-row"><span class="spotlight-meta-icon">＄</span><span>消費上限 ${escapeHtml(item.cap)}</span></div>` : ''}
            ${item.deadline ? `<div class="spotlight-meta-row"><span class="spotlight-meta-icon">🕒</span><span>${escapeHtml(item.deadline)} ${daysBadge}</span></div>` : ''}
        </div>
        <div class="spotlight-card-actions">
            <button type="button" class="spotlight-compare-btn" data-card-id="${escapeHtml(item.card_id || '')}" data-card-name="${escapeHtml(item.card_name || '')}" data-merchant="${escapeHtml(item.merchant || '')}">比較這個通路 →</button>
            <button type="button" class="spotlight-info-btn" aria-label="活動詳情" data-card-id="${escapeHtml(item.card_id || '')}" data-card-name="${escapeHtml(item.card_name || '')}" data-merchant="${escapeHtml(item.merchant || '')}">ⓘ</button>
        </div>
    `;

    card.querySelector('.spotlight-compare-btn').addEventListener('click', () => compareSpotlightMerchant(item.merchant));
    card.querySelector('.spotlight-info-btn').addEventListener('click', () => openSpotlightModal(index));
    return card;
}

function buildSpotlightDots() {
    const dots = document.getElementById('spotlight-dots');
    if (!dots) return;
    const total = spotlightTotalPages();
    dots.innerHTML = '';
    for (let i = 0; i < total; i++) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'spotlight-dot';
        dot.setAttribute('aria-label', `第 ${i + 1} 組`);
        dot.addEventListener('click', () => goToSpotlightPage(i, true));
        dots.appendChild(dot);
    }
}

function updateSpotlightDots() {
    const dots = document.getElementById('spotlight-dots');
    if (!dots) return;
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('active', i === spotlightPage));
}

function goToSpotlightPage(page, userTriggered) {
    const total = spotlightTotalPages();
    if (total === 0) return;
    spotlightPage = ((page % total) + total) % total;
    renderSpotlightPage();
    if (userTriggered) startSpotlightAutoRotate(); // reset countdown
}

function nextSpotlightPage(userTriggered) {
    goToSpotlightPage(spotlightPage + 1, userTriggered);
}

function prevSpotlightPage(userTriggered) {
    goToSpotlightPage(spotlightPage - 1, userTriggered);
}

function startSpotlightAutoRotate() {
    stopSpotlightAutoRotate();
    if (spotlightTotalPages() <= 1) return;
    spotlightTimer = setInterval(() => nextSpotlightPage(false), SPOTLIGHT_INTERVAL);
}

function stopSpotlightAutoRotate() {
    if (spotlightTimer) {
        clearInterval(spotlightTimer);
        spotlightTimer = null;
    }
}

function setupSpotlightControls() {
    const nextBtn = document.getElementById('spotlight-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', () => nextSpotlightPage(true));

    const prevBtn = document.getElementById('spotlight-prev-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => prevSpotlightPage(true));

    const track = document.getElementById('spotlight-track');
    if (track) {
        track.addEventListener('mouseenter', stopSpotlightAutoRotate);
        track.addEventListener('mouseleave', startSpotlightAutoRotate);
    }
}

// Click-to-enlarge: open any .promo-gift-image (or .image-zoomable) in a
// fullscreen lightbox. Uses event delegation so dynamically-rendered promo
// cards work without re-binding.
function setupGiftImageLightbox() {
    const lightbox = document.getElementById('image-lightbox');
    const lightboxImg = document.getElementById('image-lightbox-img');
    if (!lightbox || !lightboxImg) return;

    document.addEventListener('click', (e) => {
        const img = e.target.closest('.promo-gift-image');
        if (!img || !img.src) return;
        lightboxImg.src = img.src;
        lightbox.style.display = 'flex';
        disableBodyScroll();
    });

    const close = () => {
        lightbox.style.display = 'none';
        lightboxImg.src = '';
        enableBodyScroll();
    };
    lightbox.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.style.display === 'flex') close();
    });
}

// Mobile back-to-top floating button: appears (above the feedback button)
// once the page is scrolled down, smooth-scrolls to the top on click.
function setupBackToTopButton() {
    const btn = document.getElementById('back-to-top-btn');
    if (!btn) return;

    const toggle = () => {
        const scrolled = (window.pageYOffset || document.documentElement.scrollTop) > 300;
        btn.classList.toggle('is-visible', scrolled);
    };

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { toggle(); ticking = false; });
    }, { passive: true });

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    toggle();
}

// Find the actual cashbackRate activities in a card that cover the spotlight's
// merchant, by looking up the card's prebuilt items index. Keywords come from a
// matching quick-search option (so "所有加油站" expands to 中油/台塑/…) or from
// the merchant itself.
function findSpotlightCardActivities(card, merchant) {
    if (!card || !card._itemsIndex || !merchant) return [];

    let keywords;
    const options = (cardsData && cardsData.quickSearchOptions) || [];
    const normalized = merchant.trim().toLowerCase();
    const opt = options.find(o => o.displayName && o.displayName.trim().toLowerCase() === normalized);
    if (opt && Array.isArray(opt.merchants)) {
        keywords = opt.merchants.slice();
    } else {
        keywords = [merchant.trim()];
    }
    const variants = [...new Set(keywords.flatMap(k => getAllSearchVariants(k)))].filter(v => v && v.length >= 2);
    if (variants.length === 0) return [];

    const collect = (predicate) => {
        const seen = new Set();
        const out = [];
        for (const [itemLower, entries] of card._itemsIndex.entries()) {
            if (!predicate(itemLower)) continue;
            entries.forEach(e => {
                if (e.type === 'cashbackRate' && e.rateGroup && !seen.has(e.rateGroup)) {
                    seen.add(e.rateGroup);
                    out.push(e.rateGroup);
                }
            });
        }
        return out;
    };

    let groups = collect(itemLower => variants.includes(itemLower));
    if (groups.length === 0) {
        groups = collect(itemLower => variants.some(v => itemLower.includes(v) || v.includes(itemLower)));
    }
    return groups;
}

function buildSpotlightModalBody(item) {
    const card = ((cardsData && cardsData.cards) || []).find(c => c.id === item.card_id);
    const activities = card ? findSpotlightCardActivities(card, item.merchant) : [];

    const applyCta = (cardsData && cardsData.cardApplyCtas && item.card_id) ? cardsData.cardApplyCtas[item.card_id] : null;
    const applyCtaHtml = (applyCta && applyCta.link)
        ? `<a class="promo-apply-cta-btn spotlight-apply-cta-btn" href="${escapeHtml(applyCta.link)}" target="_blank" rel="noopener noreferrer" data-card-id="${escapeHtml(item.card_id || '')}" data-card-name="${escapeHtml(item.card_name || '')}" data-merchant="${escapeHtml(item.merchant || '')}">馬上辦卡<svg class="promo-apply-cta-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><path d="M8 1h3v3"/><path d="M11 1 6 6"/></svg></a>`
        : '';
    // Card name: clickable (opens the card detail modal) when we can resolve
    // the card; otherwise a plain label.
    const cardNameText = escapeHtml(item.card_name || (card && card.name) || '');
    const cardNameInner = card
        ? `<button type="button" class="spotlight-modal-cardname-text spotlight-cardname-link" data-card-id="${escapeHtml(card.id)}">💳 ${cardNameText}<svg class="spotlight-cardname-chevron" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
        : `<span class="spotlight-modal-cardname-text">💳 ${cardNameText}</span>`;
    const cardNameLine = `<div class="spotlight-modal-cardname">${cardNameInner}${applyCtaHtml}</div>`;

    // Fallback to the editorial Highlights data when the card/activity can't be resolved.
    if (activities.length === 0) {
        const rate = (item.rate !== undefined && item.rate !== '') ? `${item.rate}%` : '';
        const daysLeft = getSpotlightDaysLeft(item.deadline);
        const daysBadge = (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14)
            ? `<span class="spotlight-days-badge">剩 ${daysLeft} 天</span>` : '';
        return `
            ${cardNameLine}
            ${rate ? `<div class="spotlight-modal-rate">${escapeHtml(rate)}</div>` : ''}
            <p class="spotlight-modal-desc">${escapeHtml(item.description || '')}</p>
            <div class="spotlight-modal-info">
                ${item.cap ? `<div><span class="spotlight-modal-label">消費上限</span><span>${escapeHtml(item.cap)}</span></div>` : ''}
                ${item.deadline ? `<div><span class="spotlight-modal-label">活動期限</span><span>${escapeHtml(item.deadline)} ${daysBadge}</span></div>` : ''}
            </div>
        `;
    }

    let levelData = null;
    if (card.hasLevels && card.levelSettings) {
        levelData = card.levelSettings[Object.keys(card.levelSettings)[0]] || null;
    }

    const blocks = activities.map(group => {
        const parsedRate = parseCashbackRateSync(group.rate, levelData);
        // For stacking models (rate+basic+…) rate_N holds only the designated-channel
        // rate, so show the summed total (designated + basic + bonus) — same number the
        // search-result card shows. Non-stacking models return the parsed rate as-is.
        const rateNum = getDisplayRate(card, group, parsedRate, levelData);
        const capNum = parseCashbackCap(group.cap, card, levelData);
        const capText = (capNum !== null && capNum !== undefined && !isNaN(capNum))
            ? `NT$${Math.floor(capNum).toLocaleString()}` : '無上限';
        const period = group.period || ((group.periodStart && group.periodEnd) ? `${group.periodStart}~${group.periodEnd}` : '');
        const items = Array.isArray(group.items) ? group.items : [];
        return `
            <div class="spotlight-activity">
                <div class="spotlight-modal-rate">${escapeHtml(rateNum ? rateNum + '%' : '')}</div>
                <div class="spotlight-modal-info">
                    <div><span class="spotlight-modal-label">回饋上限</span><span>${capText}</span></div>
                    ${period ? `<div><span class="spotlight-modal-label">活動期間</span><span>${escapeHtml(period)}</span></div>` : ''}
                    ${group.conditions ? `<div><span class="spotlight-modal-label">條件</span><span>${escapeHtml(group.conditions)}</span></div>` : ''}
                </div>
                ${items.length ? `<div class="spotlight-act-items"><span class="spotlight-modal-label">適用通路</span><span>${items.map(escapeHtml).join('、')}</span></div>` : ''}
            </div>
        `;
    }).join('');

    return `${cardNameLine}${blocks}`;
}

function openSpotlightModal(index) {
    const item = spotlightItems[index];
    if (!item) return;
    const modal = document.getElementById('spotlight-modal');
    const titleEl = document.getElementById('spotlight-modal-title');
    const bodyEl = document.getElementById('spotlight-modal-body');
    if (!modal || !bodyEl) return;

    if (titleEl) titleEl.textContent = item.merchant || '活動詳情';

    bodyEl.innerHTML = buildSpotlightModalBody(item);

    // Card name → open the card detail modal (stacked on top of this one).
    const cardnameLink = bodyEl.querySelector('.spotlight-cardname-link');
    if (cardnameLink) {
        cardnameLink.addEventListener('click', () => showCardDetail(cardnameLink.dataset.cardId));
    }

    modal.style.display = 'flex';
    disableBodyScroll();
    stopSpotlightAutoRotate();

    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

    const closeBtn = document.getElementById('spotlight-modal-close');
    if (closeBtn) closeBtn.onclick = closeSpotlightModal;
    modal.onclick = (e) => { if (e.target === modal) closeSpotlightModal(); };
}

function closeSpotlightModal() {
    const modal = document.getElementById('spotlight-modal');
    if (modal) modal.style.display = 'none';
    enableBodyScroll();
    startSpotlightAutoRotate();
}

// Auto-fill the merchant search and run the comparison. If the merchant matches
// a quick-search option's displayName (e.g. 所有加油站), trigger that multi-keyword
// search; otherwise do a plain single-merchant search.
function compareSpotlightMerchant(merchant) {
    if (!merchant) return;
    const merchantInputEl = document.getElementById('merchant-input');
    const amountInput = document.getElementById('amount-input');

    const options = (cardsData && cardsData.quickSearchOptions) ? cardsData.quickSearchOptions : [];
    const normalized = merchant.trim().toLowerCase();
    const matchedOption = options.find(o => o.displayName && o.displayName.trim().toLowerCase() === normalized);

    if (matchedOption) {
        // handleQuickSearch 只填入關鍵詞（不自動計算）；其結尾的 validateInputs()
        // 已依「商家非空」啟用計算鈕，這裡代替用戶按下計算，維持本按鈕「點了就比較」的承諾
        handleQuickSearch(matchedOption);
        if (amountInput && !amountInput.value) amountInput.value = '1000';
        const calcBtn = document.getElementById('calculate-btn');
        if (calcBtn && !calcBtn.disabled) calcBtn.click();
    } else {
        if (merchantInputEl) {
            merchantInputEl.value = merchant;
            handleMerchantInput();
        }
        if (amountInput && !amountInput.value) amountInput.value = '1000';
        const calcBtn = document.getElementById('calculate-btn');
        if (calcBtn && !calcBtn.disabled) calcBtn.click();
    }

    setTimeout(() => {
        const results = document.getElementById('results-section');
        const target = (results && results.style.display !== 'none') ? results : merchantInputEl;
        if (target) target.scrollIntoView({ behavior: 'smooth', block: results === target ? 'start' : 'center' });
    }, 200);
}

// Show error message to user
function showErrorMessage(message) {
    const container = document.querySelector('.container');
    if (container) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            background: #fee2e2;
            border: 1px solid #fca5a5;
            color: #dc2626;
            padding: 16px;
            margin: 16px;
            border-radius: 8px;
            text-align: center;
            font-weight: 500;
        `;
        errorDiv.innerHTML = `⚠️ ${message}`;
        container.insertBefore(errorDiv, container.firstChild);
    }
}

let currentMatchedItem = null;
let currentQuickSearchOption = null; // Store current quick search option for parking benefits

// DOM elements
const merchantInput = document.getElementById('merchant-input');
const amountInput = document.getElementById('amount-input');
const calculateBtn = document.getElementById('calculate-btn');
const resultsSection = document.getElementById('results-section');
const resultsContainer = document.getElementById('results-container');
const couponResultsSection = document.getElementById('coupon-results-section');
const couponResultsContainer = document.getElementById('coupon-results-container');
const matchedItemDiv = document.getElementById('matched-item');

// ==========================================
// Announcement Bar System
// ==========================================

let announcements = [];
let currentAnnouncementIndex = 0;
let announcementInterval = null;
let isAnnouncementPaused = false;

// Initialize announcements from cardsData
function initializeAnnouncements() {
    if (cardsData && cardsData.announcements && cardsData.announcements.length > 0) {
        announcements = cardsData.announcements.slice(0, 5); // 限制最多 5 則
        setupAnnouncementBar();
        startAnnouncementRotation();
    }
}

// Setup announcement bar UI and event listeners
function setupAnnouncementBar() {
    const announcementBar = document.getElementById('announcement-bar');
    const announcementText = document.getElementById('announcement-text');
    const announcementIndicator = document.getElementById('announcement-indicator');
    const prevBtn = document.getElementById('announcement-prev');
    const nextBtn = document.getElementById('announcement-next');
    const closeBtn = document.getElementById('announcement-close');

    if (!announcementBar || !announcementText) return;

    // Show announcement bar
    announcementBar.style.display = 'block';

    // Display first announcement
    displayAnnouncement(0);

    // Event listeners
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            showPreviousAnnouncement();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            showNextAnnouncement();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeAnnouncementBar();
        });
    }

    // Pause on hover, resume on mouse leave
    announcementBar.addEventListener('mouseenter', () => {
        pauseAnnouncementRotation();
    });

    announcementBar.addEventListener('mouseleave', () => {
        resumeAnnouncementRotation();
    });

    // Click on text or date badge to show modal
    announcementText.addEventListener('click', (e) => {
        e.preventDefault();
        showAnnouncementModal(currentAnnouncementIndex);
    });

    const announcementDate = document.getElementById('announcement-date');
    if (announcementDate) {
        announcementDate.addEventListener('click', () => {
            showAnnouncementModal(currentAnnouncementIndex);
        });
    }
}

// Show announcement modal with full content
function showAnnouncementModal(index) {
    const announcement = announcements[index];
    if (!announcement) return;

    const modal = document.getElementById('announcement-modal');
    const modalBody = document.getElementById('announcement-modal-body');
    const modalLink = document.getElementById('announcement-modal-link');
    const modalCloseX = document.getElementById('announcement-modal-close');

    if (!modal || !modalBody) return;

    // Get fullText and display with HTML support.
    // ⚠️ 這裡是「刻意」允許 HTML 的：fullText 來自 Google Sheets 的公告工作表，
    // 屬於管理者（你本人）控制的內容，可以放 <b>、<a> 等排版。
    // 千萬不要把任何「使用者輸入」餵進這個欄位。
    const fullText = announcement.fullText || announcement.text;

    // Clear and update modal content
    modalBody.innerHTML = '';
    modalBody.style.color = '#374151';
    modalBody.style.fontSize = '0.95rem';
    modalBody.innerHTML = fullText;

    // Show/hide link button（僅接受 http/https 連結）
    const safeLink = sanitizeUrl(announcement.link);
    if (safeLink) {
        modalLink.href = safeLink;
        modalLink.style.display = 'inline-block';
    } else {
        modalLink.style.display = 'none';
    }

    // Show modal
    modal.style.display = 'flex';

    // Close handlers
    const closeModal = () => {
        modal.style.display = 'none';
    };

    if (modalCloseX) modalCloseX.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// Display announcement by index
// ⚠️ announcement-text 只能用 textContent 放純文字，不能塞任何行內元素（含日期）：
//    iOS Safari 對「line-clamp 元素內含 inline-block ＋ opacity 淡入淡出」會停止重繪
//    文字圖層，畫面卡在上一則變疊字亂碼。日期放在獨立的 #announcement-date badge。
function displayAnnouncement(index) {
    const announcementText = document.getElementById('announcement-text');
    const announcementDate = document.getElementById('announcement-date');
    const announcementIndicator = document.getElementById('announcement-indicator');

    if (!announcementText || !announcements[index]) return;

    const announcement = announcements[index];

    // Fade out
    announcementText.classList.add('fade-out');
    if (announcementDate) announcementDate.classList.add('fade-out');

    setTimeout(() => {
        // Update date badge (sibling element, see warning above)
        if (announcementDate) {
            if (announcement.date) {
                announcementDate.textContent = announcement.date;
                announcementDate.style.display = '';
            } else {
                announcementDate.style.display = 'none';
            }
        }

        // Update text (plain text only, see warning above)
        announcementText.textContent = announcement.text;

        // Always set as clickable (opens modal)
        announcementText.href = '#';
        announcementText.style.cursor = 'pointer';

        // Update indicator
        if (announcementIndicator && announcements.length > 1) {
            announcementIndicator.textContent = `${index + 1}/${announcements.length}`;
        }

        // Fade in
        announcementText.classList.remove('fade-out');
        announcementText.classList.add('fade-in');
        if (announcementDate) {
            announcementDate.classList.remove('fade-out');
            announcementDate.classList.add('fade-in');
        }
    }, 150);

    currentAnnouncementIndex = index;
}

// Show next announcement
function showNextAnnouncement() {
    const nextIndex = (currentAnnouncementIndex + 1) % announcements.length;
    displayAnnouncement(nextIndex);
    resetAnnouncementRotation();
}

// Show previous announcement
function showPreviousAnnouncement() {
    const prevIndex = (currentAnnouncementIndex - 1 + announcements.length) % announcements.length;
    displayAnnouncement(prevIndex);
    resetAnnouncementRotation();
}

// Start automatic rotation
function startAnnouncementRotation() {
    if (announcements.length <= 1) return;

    announcementInterval = setInterval(() => {
        if (!isAnnouncementPaused) {
            showNextAnnouncement();
        }
    }, 6000); // 每 6 秒切換一次
}

// Pause rotation
function pauseAnnouncementRotation() {
    isAnnouncementPaused = true;
}

// Resume rotation
function resumeAnnouncementRotation() {
    isAnnouncementPaused = false;
}

// Toggle pause state
// Reset rotation timer
function resetAnnouncementRotation() {
    if (announcementInterval) {
        clearInterval(announcementInterval);
        startAnnouncementRotation();
    }
}

// Close announcement bar
function closeAnnouncementBar() {
    const announcementBar = document.getElementById('announcement-bar');
    if (announcementBar) {
        announcementBar.style.display = 'none';
    }
    if (announcementInterval) {
        clearInterval(announcementInterval);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 應用程式初始化開始...', new Date().toISOString());

    // Load cards data first
    const dataLoaded = await loadCardsData();
    if (!dataLoaded) {
        // If data loading fails, disable the app
        console.error('❌ 資料載入失敗，停用應用程式');
        if (calculateBtn) calculateBtn.disabled = true;
        return;
    }

    // Initialize payments data
    console.log('📱 初始化行動支付資料...');
    initializePaymentsData();

    // Initialize quick search options (async)
    await initializeQuickSearchOptions();

    // Initialize announcements
    initializeAnnouncements();

    console.log('🎨 填充卡片和支付選項...');
    populateCardChips();
    populatePaymentChips();
    renderQuickSearchButtons();

    console.log('🔧 設定事件監聽器...');
    setupEventListeners();
    setupAuthentication();

    // Initialize lazy loading for videos and images
    initializeLazyLoading();

    // 深連結：?card=<卡片id> 直接開卡片詳情 modal（新戶活動一覽頁 ⓘ 的入口，
    // 2026-07-16）。搭配 ?start 繞過 landing 首訪轉址；無效 id 靜默忽略。
    const deepLinkCardId = new URLSearchParams(location.search).get('card');
    if (deepLinkCardId && cardsData && cardsData.cards.some(c => c.id === deepLinkCardId)) {
        showCardDetail(deepLinkCardId);
    }

    console.log('✅ 應用程式初始化完成！');
});

// Lazy loading for videos and images using Intersection Observer
function initializeLazyLoading() {
    // Intersection Observer options
    const observerOptions = {
        root: null,
        rootMargin: '50px', // Start loading 50px before entering viewport
        threshold: 0.1
    };

    // Callback for when elements enter viewport
    const observerCallback = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const element = entry.target;

                if (element.tagName === 'VIDEO') {
                    // Load and play video
                    const videoSrc = element.getAttribute('data-src');
                    if (videoSrc && !element.src) {
                        const source = document.createElement('source');
                        source.src = videoSrc;
                        source.type = 'video/mp4';
                        element.appendChild(source);
                        element.load();

                        // Play video when loaded
                        element.addEventListener('loadeddata', () => {
                            element.play().catch(err => {
                                console.log('Video autoplay failed:', err);
                            });
                        });
                    }
                } else if (element.tagName === 'IMG') {
                    // Load image (supports both direct img and picture > img)
                    const picture = element.parentElement;

                    // Load picture source if exists
                    if (picture && picture.tagName === 'PICTURE') {
                        const sources = picture.querySelectorAll('source[data-srcset]');
                        sources.forEach(source => {
                            const srcset = source.getAttribute('data-srcset');
                            if (srcset) {
                                source.srcset = srcset;
                                source.removeAttribute('data-srcset');
                            }
                        });
                    }

                    // Load img src
                    const imageSrc = element.getAttribute('data-src');
                    if (imageSrc && !element.src) {
                        element.src = imageSrc;
                        element.onload = () => {
                            element.classList.add('loaded');
                        };
                    }
                }

                // Stop observing this element
                observer.unobserve(element);
            }
        });
    };

    // Create observer
    const observer = new IntersectionObserver(observerCallback, observerOptions);

    // Observe all lazy videos and images
    document.querySelectorAll('.lazy-video').forEach(video => {
        observer.observe(video);
    });

    document.querySelectorAll('.lazy-image').forEach(img => {
        observer.observe(img);
    });
}

// Populate card chips in header
function populateCardChips() {
    const cardChipsContainer = document.getElementById('card-chips');
    if (!cardChipsContainer) return;

    // Clear existing chips
    cardChipsContainer.innerHTML = '';

    // Show cards based on user selection or all cards if not logged in
    const cardsToShow = getCardsForComparison();

    cardsToShow.forEach(card => {
        const chip = document.createElement('div');
        chip.className = 'card-chip chip-clickable';
        chip.textContent = card.name;
        chip.addEventListener('click', () => {
            if (window.closeSidebarDrawer) window.closeSidebarDrawer();
            showCardDetail(card.id);
        });
        cardChipsContainer.appendChild(chip);
    });

}

// Populate payment chips in header
function populatePaymentChips() {
    const paymentChipsContainer = document.getElementById('payment-chips');
    if (!paymentChipsContainer) return;

    // Clear existing chips
    paymentChipsContainer.innerHTML = '';

    // Show payments based on user selection (both logged in and not logged in use userSelectedPayments)
    const paymentsToShow = paymentsData.payments.filter(payment => userSelectedPayments.has(payment.id));

    if (paymentsToShow.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.color = '#9ca3af';
        emptyMsg.style.fontSize = '0.875rem';
        emptyMsg.textContent = '未選取行動支付，請點擊上方齒輪選取';
        paymentChipsContainer.appendChild(emptyMsg);
        return;
    }

    paymentsToShow.forEach(payment => {
        const chip = document.createElement('div');
        chip.className = 'payment-chip';
        chip.textContent = payment.name;
        chip.addEventListener('click', () => {
            if (window.closeSidebarDrawer) window.closeSidebarDrawer();
            showPaymentDetail(payment.id);
        });
        paymentChipsContainer.appendChild(chip);
    });
}

// Setup event listeners
function setupEventListeners() {
    // Input guide toggle
    const toggleGuideBtn = document.getElementById('toggle-input-guide');
    const inputGuide = document.getElementById('input-guide');

    if (toggleGuideBtn && inputGuide) {
        toggleGuideBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isVisible = inputGuide.style.display !== 'none';
            inputGuide.style.display = isVisible ? 'none' : 'block';
        });
    }

    // Disclaimer toggle
    const disclaimerToggle = document.getElementById('disclaimer-toggle');
    const disclaimerContent = document.getElementById('disclaimer-content');

    if (disclaimerToggle && disclaimerContent) {
        disclaimerToggle.addEventListener('click', () => {
            const isVisible = disclaimerContent.style.display !== 'none';
            disclaimerContent.style.display = isVisible ? 'none' : 'block';
            disclaimerToggle.classList.toggle('active', !isVisible);
        });
    }

    // Merchant input with real-time matching
    merchantInput.addEventListener('input', handleMerchantInput);

    // 精準搜尋開關：切換時重跑手動輸入的匹配。桌機/手機兩個 checkbox 保持同步
    // （比照 setupCardholderPromoToggle）。快捷搜尋不受精準搜尋影響
    // （currentQuickSearchOption 存在時不動它的結果）。
    const onExactSearchChange = (e) => {
        EXACT_SEARCH_CHECKBOX_IDS.forEach(id => {
            const cb = document.getElementById(id);
            if (cb && cb !== e.target) cb.checked = e.target.checked;
        });
        if (currentQuickSearchOption) return;
        if (merchantInput.value.trim()) {
            handleMerchantInput();
        } else {
            toggleExactSearchEmptyHint(false);
        }
    };
    EXACT_SEARCH_CHECKBOX_IDS.forEach(id => {
        const cb = document.getElementById(id);
        if (cb) cb.addEventListener('change', onExactSearchChange);
    });

    // Spotlight carousel controls (next button + hover pause)
    setupSpotlightControls();

    // Click-to-enlarge for the first-spend gift image + mobile back-to-top button
    setupGiftImageLightbox();
    setupBackToTopButton();

    // Amount input: clear default on focus, restore on blur if empty
    amountInput.addEventListener('focus', () => {
        if (amountInput.value === '1000' && amountInput.dataset.userModified !== 'true') {
            amountInput.value = '';
            validateInputs();
        }
    });
    amountInput.addEventListener('blur', () => {
        if (amountInput.value === '') {
            amountInput.value = '1000';
            delete amountInput.dataset.userModified;
            validateInputs();
        }
    });
    amountInput.addEventListener('input', () => {
        amountInput.dataset.userModified = 'true';
        validateInputs();
    });
    
    // Calculate button
    calculateBtn.addEventListener('click', () => {
        calculateCashback();
    });
    
    // Enter key support (disabled when any modal is open)
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !calculateBtn.disabled) {
            const anyModalOpen = document.querySelector('[id$="-modal"][style*="display: flex"], [id$="-modal"][style*="display:flex"]');
            if (anyModalOpen) return;
            calculateCashback();
        }
    });

    // Prevent Enter in the cashback search input from bubbling to the global handler
    const cashbackSearchInputEl = document.getElementById('cashback-search-input');
    if (cashbackSearchInputEl) {
        cashbackSearchInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    // Manage payments button (gear icon inside my-payments modal)
    const managePaymentsBtn = document.getElementById('manage-payments-btn');
    if (managePaymentsBtn) {
        managePaymentsBtn.addEventListener('click', () => {
            openManagePaymentsModal();
        });
    }

    // Manage quick options button
    const manageQuickOptionsBtn = document.getElementById('manage-quick-options-btn');
    if (manageQuickOptionsBtn) {
        manageQuickOptionsBtn.addEventListener('click', () => {
            closeQuickSearchDropdown();
            openManageQuickOptionsModal();
        });
    }

    // Compare payments button
    const comparePaymentsBtn = document.getElementById('compare-payments-btn');
    if (comparePaymentsBtn) {
        comparePaymentsBtn.addEventListener('click', () => {
            showComparePaymentsModal();
        });
    }

    // 釘選按鈕事件委託
    const resultsContainer = document.getElementById('results-container');
    if (resultsContainer) {
        resultsContainer.addEventListener('click', async (e) => {
            const peekBtn = e.target.closest('.card-detail-peek-btn');
            if (peekBtn) {
                e.preventDefault();
                e.stopPropagation();
                showCardDetail(peekBtn.dataset.cardId);
                return;
            }
            const breakdownBtn = e.target.closest('.calc-breakdown-btn');
            if (breakdownBtn) {
                e.preventDefault();
                e.stopPropagation();
                const cardResult = breakdownBtn.closest('.card-result');
                showCalcBreakdown(breakdownBtn, cardResult);
                return;
            }
            const pinBtn = e.target.closest('.pin-btn');
            if (pinBtn) {
                e.preventDefault();
                const cardId = pinBtn.dataset.cardId;
                const cardName = pinBtn.dataset.cardName;
                const merchant = pinBtn.dataset.merchant;
                const rate = parseFloat(pinBtn.dataset.rate);
                const periodEnd = pinBtn.dataset.periodEnd || null;
                const periodStart = pinBtn.dataset.periodStart || null;

                await togglePin(pinBtn, cardId, cardName, merchant, rate, periodEnd, periodStart);
            }
        });
    }

    // 領券活動卡片的計算明細按鈕
    const couponResultsContainerEl = document.getElementById('coupon-results-container');
    if (couponResultsContainerEl) {
        couponResultsContainerEl.addEventListener('click', (e) => {
            const breakdownBtn = e.target.closest('.calc-breakdown-btn');
            if (breakdownBtn) {
                e.preventDefault();
                e.stopPropagation();
                const couponResult = breakdownBtn.closest('.coupon-item');
                showCalcBreakdown(breakdownBtn, couponResult);
            }
        });
    }

    // 新戶活動卡片的 ⓘ 詳情按鈕（搜尋結果）
    const cardholderPromosContainer = document.getElementById('cardholder-promos-container');
    if (cardholderPromosContainer) {
        cardholderPromosContainer.addEventListener('click', (e) => {
            const peekBtn = e.target.closest('.card-detail-peek-btn');
            if (peekBtn) {
                e.preventDefault();
                e.stopPropagation();
                showCardDetail(peekBtn.dataset.cardId);
            }
        });
    }

    // 領券型活動卡片的 ⓘ 詳情按鈕（搜尋結果）
    if (couponResultsContainer) {
        couponResultsContainer.addEventListener('click', (e) => {
            const peekBtn = e.target.closest('.card-detail-peek-btn');
            if (peekBtn) {
                e.preventDefault();
                e.stopPropagation();
                showCardDetail(peekBtn.dataset.cardId);
            }
        });
    }

    // 我的配卡按鈕
    const myMappingsBtn = document.getElementById('my-mappings-btn');
    if (myMappingsBtn) {
        myMappingsBtn.addEventListener('click', () => {
            openMyMappingsModal();
        });
    }
}

// Check and show search hints
function checkAndShowSearchHint(searchTerm) {
    const searchHintsContainer = document.getElementById('search-hints-container');

    // 清空之前的提示
    if (searchHintsContainer) {
        searchHintsContainer.innerHTML = '';
    }

    if (!searchTerm || searchTerm.length < 2) {
        return;
    }

    const hint = cardsData.searchHints?.[searchTerm.toLowerCase()];

    if (hint && hint.suggestions.length > 0) {
        const hintDiv = document.createElement('div');
        hintDiv.className = 'search-hint';
        hintDiv.innerHTML = `
            <span class="hint-message">${hint.message}</span>
            <div class="hint-suggestions">
                ${hint.suggestions.map(s =>
                    `<button class="hint-button" onclick="searchFromHint('${s}')">${s}</button>`
                ).join('')}
            </div>
        `;
        searchHintsContainer.appendChild(hintDiv);
    }
}

// Search from hint button
function searchFromHint(suggestion) {
    const merchantInput = document.getElementById('merchant-input');
    if (merchantInput) {
        merchantInput.value = suggestion;
        // 觸發 input 事件來更新匹配狀態
        merchantInput.dispatchEvent(new Event('input'));
        // 自動計算回饋
        calculateCashback();
    }
}

// Handle merchant input changes
function handleMerchantInput() {
    const input = merchantInput.value.trim().toLowerCase();

    console.log('🔍 handleMerchantInput:', input);

    // Clear quick search option when user manually types
    currentQuickSearchOption = null;

    // 🔥 新增：檢查並顯示搜尋提示
    checkAndShowSearchHint(input);

    if (input.length === 0) {
        hideMatchedItem();
        toggleExactSearchEmptyHint(false);
        currentMatchedItem = null;
        validateInputs();
        return;
    }

    // Find matching items (now returns array)
    const exactOnly = isExactSearchEnabled();
    const matchedItems = findMatchingItem(input, { exactOnly });

    console.log('  findMatchingItem 結果:', matchedItems ? matchedItems.length : 0);

    if (matchedItems && matchedItems.length > 0) {
        // Get cards to compare for parking benefits check
        const cardsToCompare = getCardsForComparison();
        showMatchedItem(matchedItems, input, cardsToCompare);
        toggleExactSearchEmptyHint(false);
        currentMatchedItem = matchedItems; // Now stores array of matches
        console.log('  ✅ 設定 currentMatchedItem:', currentMatchedItem.length);
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
        // 精準搜尋下沒有完全一致、但放寬後有相近結果 → 提示用戶可取消勾選
        const relaxedWouldMatch = exactOnly &&
            (findMatchingItem(input) || []).length > 0;
        toggleExactSearchEmptyHint(relaxedWouldMatch);
        console.log('  ❌ 無匹配，清除 currentMatchedItem');
    }

    validateInputs();
}

// Fuzzy search mapping for common terms
const fuzzySearchMap = {
    'pchome': 'pchome',
    'pchome商店街': 'pchome',
    'pchome24h': 'pchome 24h購物',
    'shopee': '蝦皮購物',
    '蝦皮': '蝦皮購物',
    'rakuten': '樂天市場',
    '樂天': '樂天市場',
    'momo': 'momo購物網',
    'yahoo': 'yahoo',
    'yahoo購物': 'yahoo',
    'yahoo超級商城': 'yahoo',
    'costco': '好市多',
    '好市多': 'costco',
    '711': '7-11',
    '7eleven': '7-11',
    '7 11': '7-11',
    '7-eleven': '7-11',
    '全家': '全家',
    'familymart': '全家',
    '全家便利商店': '全家',
    '萊爾富': 'ok mart',
    '莱尔富': 'ok mart',
    'okmart': 'ok mart',
    'pxmart': '全聯福利中心',
    '全聯': '全聯福利中心',
    '全聯小時達': '全聯小時達',
    '小時達': '全聯小時達',
    'carrefour': '家樂福',
    '家樂福': 'carrefour',
    'rt-mart': '大潤發',
    '大潤發': 'rt-mart',
    'mcd': '麥當勞',
    'mcdonalds': '麥當勞',
    '麥當勞': 'mcdonalds',
    'starbucks': '星巴克',
    '星巴克': 'starbucks',
    'linepay': 'line pay',
    'line pay': 'linepay',
    'applepay': 'apple pay',
    'apple pay': 'applepay',
    '海外': '國外',
    '國外': '海外',
    'overseas': '海外',
    'apple wallet': 'apple pay',
    'googlepay': 'google pay',
    'google pay': 'googlepay',
    'samsungpay': 'samsung pay',
    'samsung pay': 'samsungpay',
    '街口': '街口支付',
    '街口支付': '街口',
    'jkopay': '街口',
    'pi錢包': 'pi 拍錢包',
    'pi wallet': 'pi 拍錢包',
    '台灣支付': '台灣pay',
    'taiwan pay': '台灣pay',
    'taiwanpay': '台灣pay',
    '悠遊付': 'easy wallet',
    'easywallet': '悠遊付',
    '長榮': '長榮航空',
    'eva air': '長榮航空',
    'evaair': '長榮航空',
    '華航': '中華航空',
    'china airlines': '中華航空',
    '立榮': 'uni air',
    'uniaire': 'uni air',
    '星宇': '星宇航空',
    'starlux': '星宇航空',
    'starlux airlines': '星宇航空',
    '日本航空': 'japan airlines',
    '日航': '日本航空',
    'jal': '日本航空',
    'ana': '全日空',
    'all nippon airways': '全日空',
    '大韓航空': 'korean air',
    '大韓': 'korean air',
    '韓亞': '韓亞航空',
    'asiana airlines': '韓亞航空',
    '國泰航空': 'cathay pacific',
    '國泰': 'cathay pacific',
    '新加坡航空': 'singapore airlines',
    '新航': '新加坡航空',
    'sia': '新加坡航空',
    '泰航': '泰國航空',
    'thai airways': '泰國航空',
    '馬航': '馬來西亞航空',
    'malaysia airlines': '馬來西亞航空',
    'airasia': '亞洲航空',
    '越航': '越南航空',
    'vietnam airlines': '越南航空',
    '菲航': '菲律賓航空',
    'philippine airlines': '菲律賓航空',
    '華信航空': 'mandarin airlines',
    '華信': 'mandarin airlines',
    '台灣高鐵': '高鐵',
    'taiwan high speed rail': '高鐵',
    'high speed rail': '高鐵',
    'thsr': '高鐵',
    'foodpanda': 'foodpanda',
    'food panda': 'foodpanda',
    '熊貓': 'foodpanda',
    'uber eats': 'uber eats',
    'ubereats': 'uber eats',
    'ubereat': 'uber eats',
    'uber eat': 'uber eats',
    // Remove uber/uber eats cross-mapping to prevent unwanted matches
    '三井(mitsui outlet park)': '三井',
    '三井outlet': '三井',
    '三井': '三井(mitsui outlet park)',
    'mitsui': '三井',
    'mitsui outlet': '三井',
    'mitsui outlet park': '三井(mitsui outlet park)',
    '國外': '海外',
    '海外': '國外',
    'decathlon': '迪卡儂',
    '迪卡儂': 'decathlon',
    'ikea': 'IKEA宜家家居',
    '宜家': 'IKEA宜家家居',
    '宜家家居': 'IKEA宜家家居',
    'IKEA宜家家居': 'ikea',
    'greenvines': '綠藤生機',
    '綠藤生機': 'greenvines',
    '綠藤': '綠藤生機',
    '屈臣氏': 'watsons',
    'watsons': '屈臣氏',
    '康是美': 'cosmed',
    'cosmed': '康是美',
    'hnm': 'h&m',
    '唐吉軻德 DON DON DONKI': '唐吉訶德 DON DON DONKI',
    '唐吉訶德 DON DON DONKI': '唐吉軻德 DON DON DONKI',
    '餐廳': '餐飲',
    '國內餐廳': '國內餐飲',
    '國外餐廳': '國外餐飲',
    '全台餐廳': '全台餐飲',
    '全臺餐廳': '全臺餐飲',
    '國內國外餐廳': '國內國外餐飲',
    'holiday ktv': '好樂迪',
    'party world': '錢櫃',
    'fb廣告': 'meta廣告',
    'facebook廣告': 'meta廣告',
    'meta 廣告': 'meta廣告',
    'fb ads': 'meta廣告',
    'meta ads': 'meta廣告',
    'google 廣告': 'google廣告',
    'google ads': 'google廣告',
    'abc mart': 'abc-mart',
    'MAC': 'M.A.C',
    'nitori': '宜得利',
    'mia cbon': 'Mia C\'bon',
    'tomods': 'Tomod\'s',
    'sogo': '遠東 SOGO',
    '台北捷運': '臺北捷運',
    '臺北捷運': '台北捷運'
};

// Search term exclusion rules - prevents unwanted matches
// Format: 'searchTerm': ['excluded item 1', 'excluded item 2', ...]
// 比對規則：searchTerm 對 fuzzy 展開後的每個搜尋詞生效，excluded item 與 item 名做小寫全等比對。
// 日常維護走 Google Sheets 的 SearchExclusions 工作表（載入時由 mergeDataSearchExclusions 併入），
// 這裡只保留兜底預設值。
const searchExclusionMap = {
    '街口': ['日本paypay(限於街口支付綁定)'],
    '街口支付': ['日本paypay(限於街口支付綁定)'],
    // 「新加坡航空」fuzzy 展開出別名 sia，子字串誤中 a"sia"yo
    'sia': ['asiayo']
};

// 將 cards.data 匯出的 searchExclusions（SearchExclusions 工作表）併入內建排除表，
// 讓排除規則可從 Google Sheets 維護、不必改程式。格式：[{ term, excludedItems: [...] }]。
// 一律正規化為小寫存放，與 checkItemMatches 的小寫全等比對一致。
function mergeDataSearchExclusions(data) {
    if (!data || !Array.isArray(data.searchExclusions)) return;
    let mergedCount = 0;
    data.searchExclusions.forEach(entry => {
        const term = String(entry && entry.term || '').toLowerCase().trim();
        const items = Array.isArray(entry && entry.excludedItems) ? entry.excludedItems : [];
        if (!term || items.length === 0) return;
        if (!searchExclusionMap[term]) searchExclusionMap[term] = [];
        const existing = searchExclusionMap[term];
        items.forEach(item => {
            const normalized = String(item).toLowerCase().trim();
            if (normalized && !existing.some(e => e.toLowerCase() === normalized)) {
                existing.push(normalized);
                mergedCount++;
            }
        });
    });
    if (mergedCount > 0) {
        console.log(`🚫 已從 cards.data 併入 ${mergedCount} 條搜尋排除規則`);
    }
}

// 精準搜尋核取方塊狀態（只作用於手動輸入路徑，快捷搜尋不受影響）
// 2026-07-12 版面重整後桌機/手機共用同一個 checkbox（保留陣列形式以防未來再分裝置）
const EXACT_SEARCH_CHECKBOX_IDS = ['exact-search-checkbox'];
function isExactSearchEnabled() {
    return EXACT_SEARCH_CHECKBOX_IDS.some(id => {
        const checkbox = document.getElementById(id);
        return !!(checkbox && checkbox.checked);
    });
}

// 精準搜尋下零結果的提示（「無完全一致項目，可取消勾選看相近結果」）
function toggleExactSearchEmptyHint(show) {
    const hint = document.getElementById('exact-search-empty-hint');
    if (hint) hint.style.display = show ? 'block' : 'none';
}

// Find matching item in cards database
// options.exactOnly：只回傳完全一致的匹配（isExactMatch；fuzzy 同義詞展開後全等也算，
// 例如搜「國外」時 item「海外」視為完全一致）。快捷搜尋等呼叫端不傳即維持原行為。
function findMatchingItem(searchTerm, options = {}) {
    if (!cardsData) return null;
    const exactOnly = !!options.exactOnly;

    let searchLower = searchTerm.toLowerCase().trim();
    let searchTerms = [searchLower]; // Always include original search term

    // Add fuzzy search mapping if exists
    if (fuzzySearchMap[searchLower]) {
        const mappedTerm = fuzzySearchMap[searchLower].toLowerCase();
        if (!searchTerms.includes(mappedTerm)) {
            searchTerms.push(mappedTerm);
        }
    }

    // Also add reverse mappings (find all terms that map to current search)
    Object.entries(fuzzySearchMap).forEach(([key, value]) => {
        if (value.toLowerCase() === searchLower && !searchTerms.includes(key)) {
            searchTerms.push(key);
        }
    });

    console.log(`🔎 findMatchingItem 開始搜尋:`, {
        原始輸入: searchTerm,
        搜尋詞: searchTerms
    });

    let allMatches = [];
    
    // Helper function to check item matches
    const checkItemMatches = (items, searchTerms, searchLower, allMatches, searchTerm) => {
        for (const item of items) {
            const itemLower = item.toLowerCase();

            // Check if this item is explicitly excluded for this search term
            const exclusionList = searchExclusionMap[searchLower];
            if (exclusionList && exclusionList.some(excluded => itemLower === excluded.toLowerCase())) {
                continue; // Skip this item - it's excluded
            }

            // Check if any search term matches this item
            let matchFound = false;
            let bestMatchTerm = searchLower;
            let isExactMatch = false;
            let isFullContainment = false;

                for (const term of searchTerms) {
                    // Check exclusions for this specific term too
                    const termExclusions = searchExclusionMap[term];
                    if (termExclusions && termExclusions.some(excluded => itemLower === excluded.toLowerCase())) {
                        continue;
                    }

                    // Prevent uber/uber eats cross matching with more precise logic
                    if (term === 'uber' && (itemLower.includes('uber eats') || itemLower.includes('ubereats'))) {
                        // Skip uber eats items when searching for 'uber'
                        continue;
                    }
                    if ((term === 'uber eats' || term === 'ubereats' || term === 'ubereat' || term === 'uber eat') && itemLower === 'uber') {
                        // Skip 'uber' item when searching for uber eats variants
                        continue;
                    }

                // Check for matches with word boundary awareness
                const exactMatch = itemLower === term;
                const itemContainsTerm = itemLower.includes(term);

                // For term.includes(itemLower), check if it's a word boundary match
                // to prevent "singapore airlines" from matching "gap"
                let termContainsItem = false;
                if (term.includes(itemLower)) {
                    // Create word boundary regex: match itemLower as complete word(s)
                    // Use \b for English, allow Chinese characters to match anywhere
                    const isChinese = /[\u4e00-\u9fa5]/.test(itemLower);
                    if (isChinese) {
                        // For Chinese, allow substring match
                        termContainsItem = true;
                    } else {
                        // For English, require word boundaries
                        const wordBoundaryRegex = new RegExp(`(^|\\s|[^a-z])${itemLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-z])`, 'i');
                        termContainsItem = wordBoundaryRegex.test(term);
                    }
                }

                if (exactMatch || itemContainsTerm || termContainsItem) {
                    matchFound = true;

                    if (exactMatch) {
                        isExactMatch = true;
                        bestMatchTerm = term;
                        break;
                    }
                    if (itemContainsTerm) {
                        isFullContainment = true;
                        bestMatchTerm = term;
                    }
                }
            }

            if (matchFound) {
                console.log(`    ✓ 匹配到: "${item}" (搜尋詞: "${bestMatchTerm}")`);
                allMatches.push({
                    originalItem: item,
                    searchTerm: searchTerm,
                    itemLower: itemLower,
                    searchLower: bestMatchTerm,
                    // Calculate match quality
                    isExactMatch: isExactMatch,
                    isFullContainment: isFullContainment,
                    length: itemLower.length
                });
            }
        }
    };
    
    // Collect all possible matches using all search terms
    for (const card of cardsData.cards) {
        // Check cashbackRates items (包含隱藏的rate，因為隱藏rate也在cashbackRates中)
        for (const rateGroup of card.cashbackRates) {
            checkItemMatches(rateGroup.items, searchTerms, searchLower, allMatches, searchTerm);
        }

        // Check specialItems for CUBE card
        if (card.specialItems) {
            checkItemMatches(card.specialItems, searchTerms, searchLower, allMatches, searchTerm);
        }

        // Check generalItems for CUBE card
        if (card.generalItems) {
            for (const [category, items] of Object.entries(card.generalItems)) {
                checkItemMatches(items, searchTerms, searchLower, allMatches, searchTerm);
            }
        }

        // Check couponCashbacks merchant field
        if (card.couponCashbacks) {
            for (const coupon of card.couponCashbacks) {
                if (coupon.merchant) {
                    // Split merchant string into array (comma-separated)
                    const merchantItems = coupon.merchant.split(',').map(m => m.trim());
                    checkItemMatches(merchantItems, searchTerms, searchLower, allMatches, searchTerm);
                }
            }
        }
    }
    
    if (allMatches.length === 0) return null;

    // Remove duplicates (same item appearing in multiple cards)
    // 使用 itemLower 並考慮 fuzzySearchMap 映射關係去重
    // 這樣"KLOOK"和"klook"會被視為相同，"海外"和"國外"也會被視為相同
    const uniqueMatches = [];
    const seenItems = new Set();

    // Helper function to get normalized key considering fuzzy search mappings
    const getNormalizedKey = (itemLower) => {
        // If this item maps to another term in fuzzySearchMap, use the mapped term
        // This ensures "海外" and "國外" get the same key
        if (fuzzySearchMap[itemLower]) {
            const mappedTerm = fuzzySearchMap[itemLower].toLowerCase();
            // Use the alphabetically first term as the canonical key to avoid circular mapping
            return itemLower < mappedTerm ? itemLower : mappedTerm;
        }
        return itemLower;
    };

    for (const match of allMatches) {
        const itemKey = getNormalizedKey(match.itemLower);

        if (!seenItems.has(itemKey)) {
            seenItems.add(itemKey);
            if (exactOnly && !match.isExactMatch) continue;
            uniqueMatches.push(match);
        }
    }

    // 添加調試日誌
    console.log(`🔍 findMatchingItem 搜尋結果: 找到 ${allMatches.length} 個匹配, 去重後 ${uniqueMatches.length} 個唯一item`);
    uniqueMatches.forEach(m => console.log(`  ✓ ${m.originalItem}`));
    
    // Sort by match quality
    uniqueMatches.sort((a, b) => {
        // 1. Exact matches first
        if (a.isExactMatch && !b.isExactMatch) return -1;
        if (!a.isExactMatch && b.isExactMatch) return 1;
        
        // 2. Full containment (search term fully contained in item)
        if (a.isFullContainment && !b.isFullContainment) return -1;
        if (!a.isFullContainment && b.isFullContainment) return 1;
        
        // 3. For non-exact matches, prefer shorter items (more specific)
        if (!a.isExactMatch && !b.isExactMatch) {
            return a.length - b.length;
        }
        
        return 0;
    });
    
    // Return all matches for comprehensive results
    return uniqueMatches;
}

// Show matched item(s)
function showMatchedItem(matchedItems, merchantValue = '', cardsToCheck = []) {
    let messageHtml = '';

    if (Array.isArray(matchedItems)) {
        if (matchedItems.length === 1) {
            messageHtml = `✓ 匹配到: <strong>${escapeHtml(matchedItems[0].originalItem)}</strong>`;
        } else {
            // 如果所有項目名稱相同，只顯示一次
            const uniqueItems = [...new Set(matchedItems.map(item => item.originalItem))];
            if (uniqueItems.length === 1) {
                messageHtml = `✓ 匹配到: <strong>${escapeHtml(uniqueItems[0])}</strong>`;
            } else {
                const itemList = uniqueItems.join('、');
                messageHtml = `✓ 匹配到: <strong>${escapeHtml(itemList)}</strong>`;
            }
        }
    } else {
        // Backward compatibility for single item
        messageHtml = `✓ 匹配到: <strong>${escapeHtml(matchedItems.originalItem)}</strong>`;
    }

    // Check if there are parking benefits matches
    if (merchantValue && cardsData && cardsData.benefits && cardsData.benefits.length > 0) {
        const merchantLower = merchantValue.toLowerCase().trim();
        const matchingBenefits = cardsData.benefits.filter(benefit => {
            if (!benefit.active) return false;

            // Check if this card is in the user's selection
            const shouldShow = !currentUser || cardsToCheck.some(card => card.id === benefit.id);
            if (!shouldShow) return false;

            // Check if merchants match
            if (benefit.merchants && Array.isArray(benefit.merchants)) {
                return benefit.merchants.some(merchant => {
                    const merchantItemLower = merchant.toLowerCase();
                    return merchantLower.includes(merchantItemLower) || merchantItemLower.includes(merchantLower);
                });
            }
            return false;
        });

        if (matchingBenefits.length > 0) {
            messageHtml += `<br>✓ 匹配到: <a href="javascript:void(0)" class="parking-jump-link" onclick="scrollToParkingBenefits()">停車折抵優惠 (${matchingBenefits.length}張卡片) - 點擊查看 ↓</a>`;
        }
    }

    matchedItemDiv.innerHTML = messageHtml;
    matchedItemDiv.className = 'matched-item';
    matchedItemDiv.style.display = 'block';
}

// Show no match message with styling
function showNoMatchMessage(merchantValue = '', cardsToCheck = []) {
    let messageHtml = `✘ 匹配到: <strong>您選取的卡片中沒有任何匹配項目，以下結果顯示基本回饋</strong>`;
    let hasParkingMatch = false;

    // Check if there are parking benefits matches
    if (merchantValue && cardsData && cardsData.benefits && cardsData.benefits.length > 0) {
        const merchantLower = merchantValue.toLowerCase().trim();
        const matchingBenefits = cardsData.benefits.filter(benefit => {
            if (!benefit.active) return false;

            // Check if this card is in the user's selection
            const shouldShow = !currentUser || cardsToCheck.some(card => card.id === benefit.id);
            if (!shouldShow) return false;

            // Check if merchants match
            if (benefit.merchants && Array.isArray(benefit.merchants)) {
                return benefit.merchants.some(merchant => {
                    const merchantItemLower = merchant.toLowerCase();
                    return merchantLower.includes(merchantItemLower) || merchantItemLower.includes(merchantLower);
                });
            }
            return false;
        });

        if (matchingBenefits.length > 0) {
            hasParkingMatch = true;
            messageHtml += `<br>✓ 匹配到: <a href="javascript:void(0)" class="parking-jump-link" onclick="scrollToParkingBenefits()">停車折抵優惠 (${matchingBenefits.length}張卡片) - 點擊查看 ↓</a>`;
        }
    }

    matchedItemDiv.innerHTML = messageHtml;
    // Use different style class depending on whether parking benefits matched
    matchedItemDiv.className = hasParkingMatch ? 'matched-item partial-match' : 'matched-item no-match';
    matchedItemDiv.style.display = 'block';
    // 匹配狀態列一次只顯示一行：✘/部分匹配訊息出現時收起精準搜尋的橙色提示
    toggleExactSearchEmptyHint(false);
}

// Hide matched item
function hideMatchedItem() {
    matchedItemDiv.style.display = 'none';
}

// Scroll to parking benefits section
function scrollToParkingBenefits() {
    const parkingSection = document.getElementById('parking-benefits-section');
    if (parkingSection && parkingSection.style.display !== 'none') {
        parkingSection.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
        // Add a brief highlight animation
        parkingSection.style.transition = 'background-color 0.5s ease';
        parkingSection.style.backgroundColor = '#dbeafe';
        setTimeout(() => {
            parkingSection.style.backgroundColor = '';
        }, 1500);
    }
}


// Validate inputs
function validateInputs() {
    const merchantValue = merchantInput.value.trim();
    const amountValue = parseFloat(amountInput.value);

    // Empty amount is valid (defaults to 1000)
    const isValid = merchantValue.length > 0 &&
                   (amountInput.value === '' || (!isNaN(amountValue) && amountValue > 0));

    calculateBtn.disabled = !isValid;
}

// 合併相同活動的搜尋結果：同一張卡 + 同 rate/cap/期間/類別 = 同一個活動，
// 個別匹配到的 item 收進 matchedItems 陣列。
// （這段邏輯原本在 calculateCashback 內複製了 4 份：多項目/單項目/即將開始 ×2）
function mergeResultsByActivity(resultList) {
    const merged = new Map();
    for (const result of resultList) {
        const mergeKey = `${result.card.id}-${result.rate}-${result.cap || 'nocap'}-${result.periodStart || ''}-${result.periodEnd || ''}-${result.matchedCategory || 'nocat'}`;

        if (merged.has(mergeKey)) {
            // Same activity - merge matched items
            const existing = merged.get(mergeKey);
            if (!existing.matchedItems) {
                existing.matchedItems = existing.matchedItem ? [existing.matchedItem] : [];
            }
            const newItems = result.matchedItems || [result.matchedItemName || result.matchedItem];
            for (const item of newItems) {
                if (item && !existing.matchedItems.includes(item)) {
                    existing.matchedItems.push(item);
                }
            }
        } else {
            // New activity - create new entry
            merged.set(mergeKey, {
                ...result,
                matchedItems: result.matchedItems || [result.matchedItemName || result.matchedItem]
            });
        }
    }
    return Array.from(merged.values());
}

// 無匹配活動時的「基本回饋」結果（含國內加碼卡如永豐幣倍的兩層計算）。
// （原本在「有搜尋詞但無結果」與「無搜尋詞」兩處各複製一份）
function buildBasicCashbackResult(card, amount) {
    let basicCashbackAmount = 0;
    let effectiveRate = card.basicCashback;
    let displayCap = null;
    let layers;

    if (card.domesticBonusRate && card.domesticBonusCap) {
        // Handle complex cards like 永豐幣倍 with domestic bonus
        const bonusAmount = Math.min(amount, card.domesticBonusCap);
        const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
        const basicCashback = Math.floor(amount * card.basicCashback / 100);
        basicCashbackAmount = bonusCashback + basicCashback;
        effectiveRate = card.basicCashback + card.domesticBonusRate;
        displayCap = card.domesticBonusCap;
        layers = [
            { name: '基本回饋', rate: card.basicCashback, applicableAmount: amount, cashback: basicCashback, cap: null },
            { name: '國內消費加碼', rate: card.domesticBonusRate, applicableAmount: bonusAmount, cashback: bonusCashback, cap: card.domesticBonusCap }
        ];
    } else {
        basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
        layers = [
            { name: '基本回饋', rate: card.basicCashback, applicableAmount: amount, cashback: basicCashbackAmount, cap: null }
        ];
    }

    return {
        rate: effectiveRate,
        cashbackAmount: basicCashbackAmount,
        cap: displayCap,
        matchedItem: null,
        effectiveAmount: amount,
        card: card,
        isBasic: true,
        calculationLayers: layers
    };
}

// Calculate cashback for all cards
async function calculateCashback() {
    console.log('🔄 calculateCashback 被調用');
    console.log('cardsData:', cardsData ? `已載入 (${cardsData.cards.length} 張卡)` : '未載入');

    const startTime = performance.now();

    // Clear rate status cache at the start of each calculation
    rateStatusCache.clear();

    if (!cardsData) {
        console.error('❌ cardsData 未載入，無法計算');
        return;
    }

    // Loading overlay 延遲顯示：多數計算（包含訪客的全部案例）在 80-155ms 內完成，
    // 立刻顯示 overlay 對快搜尋只會造成閃爍、沒有實際回饋感。改成「超過 150ms 才顯示」
    // ——只有真的慢（主要是登入用戶第一次計算要序列等 Firestore getDoc）才會看到。
    // 已知限制：純 CPU 阻塞主執行緒時，這個 timer 本身也要等主執行緒讓出才會觸發，
    // overlay 可能到計算尾端才畫出來；Firestore 等待型的慢（主要場景）會正常顯示，
    // 因為 await 會讓出主執行緒，timer 能準時觸發。
    const loadingShowTimer = setTimeout(() => {
        loadingOverlay.show('正在計算回饋...');
    }, 150);

    try {

    const amount = amountInput.value === '' ? 1000 : parseFloat(amountInput.value);
    const merchantValue = merchantInput.value.trim();

    console.log('輸入：', { merchantValue, amount });
    console.log('currentMatchedItem:', currentMatchedItem);

    // 追蹤計算回饋事件
    if (window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'calculate_cashback', {
            merchant: merchantValue,
            amount: amount,
            has_match: currentMatchedItem ? true : false
        });
    }

    let results;
    let isBasicCashback = false;
    let uniqueUpcomingResults = [];  // Define here for proper scope

    // Get cards to compare (user selected or all)
    const cardsToCompare = getCardsForComparison();

    console.log(`比較 ${cardsToCompare.length} 張卡片`);
    
    if (currentMatchedItem) {
        // User input matched specific items - show special cashback rates for ALL matched items
        let allResults = [];
        
        if (Array.isArray(currentMatchedItem)) {
            // Multiple matches - calculate for all items and show best card for EACH item
            const allItemResults = [];

            console.log(`🔍 處理 ${currentMatchedItem.length} 個匹配項目`);

            for (const matchedItem of currentMatchedItem) {
                const searchTerm = matchedItem.originalItem.toLowerCase();
                console.log(`  📝 計算項目: ${matchedItem.originalItem}`);

                const itemResults = await Promise.all(cardsToCompare.map(async card => {
                    const results = await calculateCardCashback(card, searchTerm, amount);
                    // calculateCardCashback now returns an array of all matching activities
                    return results.map(result => ({
                        ...result,
                        card: card,
                        matchedItemName: result.matchedItem // 使用卡片實際匹配到的item，而非搜尋詞
                    }));
                })).then(results => results.flat().filter(result => result.cashbackAmount > 0));

                if (itemResults.length > 0) {
                    // Sort by cashback amount (highest first)
                    itemResults.sort((a, b) => b.cashbackAmount - a.cashbackAmount);

                    // Add ALL cards with cashback, not just the best one
                    allItemResults.push(...itemResults);
                }
            }

            // Merge results from same card and same activity
            allResults = mergeResultsByActivity(allItemResults);

            console.log(`📊 合併前: ${allItemResults.length} 個結果，合併後: ${allResults.length} 個結果`);
        } else {
            // Single match - backward compatibility
            const searchTerm = currentMatchedItem.originalItem.toLowerCase();
            const itemResults = await Promise.all(cardsToCompare.map(async card => {
                const results = await calculateCardCashback(card, searchTerm, amount);
                // calculateCardCashback now returns an array of all matching activities
                return results.map(result => ({
                    ...result,
                    card: card,
                    matchedItemName: result.matchedItem
                }));
            })).then(results => results.flat().filter(result => result.cashbackAmount > 0));

            // Merge results from same card and same activity
            allResults = mergeResultsByActivity(itemResults);

            console.log(`📊 合併前: ${itemResults.length} 個結果，合併後: ${allResults.length} 個結果`);
        }
        
        results = allResults;

        // Also find upcoming activities (within 30 days)
        const upcomingResults = [];
        if (currentMatchedItem) {
            const searchTermsForUpcoming = Array.isArray(currentMatchedItem)
                ? currentMatchedItem.map(item => item.originalItem.toLowerCase())
                : [currentMatchedItem.originalItem.toLowerCase()];

            for (const searchTerm of searchTermsForUpcoming) {
                const upcomingActivities = await Promise.all(cardsToCompare.map(async card => {
                    const activities = await findUpcomingActivity(card, searchTerm, amount);
                    // findUpcomingActivity now returns an array
                    return activities.map(activity => ({
                        card: card,
                        ...activity,
                        isUpcoming: true,
                        matchedItemName: activity.matchedItem
                    }));
                }));

                upcomingResults.push(...upcomingActivities.flat());
            }
        }

        // Merge upcoming results from same card and same activity
        uniqueUpcomingResults = mergeResultsByActivity(upcomingResults);

        console.log(`📊 Upcoming 合併前: ${upcomingResults.length} 個結果，合併後: ${uniqueUpcomingResults.length} 個結果`);

        // Show no-match message and basic rates when no special rates found
        if (results.length === 0 && merchantValue.length > 0) {
            showNoMatchMessage(merchantValue, cardsToCompare);
            // Show basic cashback for selected cards when no special rates found
            isBasicCashback = true;

            results = cardsToCompare.map(card => buildBasicCashbackResult(card, amount));
        }
    } else {
        // No match found or no input - show basic cashback for selected cards
        isBasicCashback = true;

        results = cardsToCompare.map(card => buildBasicCashbackResult(card, amount));

        // Show no match message if user has typed something
        if (merchantValue.length > 0) {
            showNoMatchMessage(merchantValue, cardsToCompare);
        }

        // Still search for upcoming activities even without active matches
        if (merchantValue.length > 0) {
            const upcomingResults = [];
            const searchTerm = merchantValue.toLowerCase();
            const upcomingActivities = await Promise.all(cardsToCompare.map(async card => {
                const activities = await findUpcomingActivity(card, searchTerm, amount);
                return activities.map(activity => ({
                    card: card,
                    ...activity,
                    isUpcoming: true,
                    matchedItemName: activity.matchedItem
                }));
            }));
            upcomingResults.push(...upcomingActivities.flat());

            uniqueUpcomingResults = mergeResultsByActivity(upcomingResults);
        }
    }
    
    // Sort active results by cashback amount (highest first)
    results.sort((a, b) => b.cashbackAmount - a.cashbackAmount);

    // Append upcoming results after active results (if they exist)
    if (typeof uniqueUpcomingResults !== 'undefined' && uniqueUpcomingResults.length > 0) {
        // Sort upcoming results by cashback amount (highest first)
        uniqueUpcomingResults.sort((a, b) => b.cashbackAmount - a.cashbackAmount);
        // Append all upcoming results (even if card already has active result)
        results = [...results, ...uniqueUpcomingResults];
    }

    // Display results - handle multiple matched items
    let displayedMatchItem;
    if (currentMatchedItem) {
        if (Array.isArray(currentMatchedItem)) {
            displayedMatchItem = currentMatchedItem.map(item => item.originalItem).join('、');
        } else {
            displayedMatchItem = currentMatchedItem.originalItem;
        }
    } else {
        displayedMatchItem = merchantValue;
    }

    displayResults(results, amount, displayedMatchItem, isBasicCashback);

    // Display coupon cashbacks
    await displayCouponCashbacks(amount, merchantValue);

    // Display parking benefits - pass quick search keywords if available
    displayParkingBenefits(merchantValue, cardsToCompare, currentQuickSearchOption?.merchants);

    // Display new cardholder promos (filtered by user toggle, ownership, and merchant match)
    displayCardholderPromos(merchantValue, amount, currentQuickSearchOption?.merchants);

    const duration = performance.now() - startTime;
    console.log(`⏱️ calculateCashback 完成 - 耗時: ${duration.toFixed(2)}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`📊 比較了 ${cardsToCompare.length} 張卡片，找到 ${results.length} 個結果`);

    } catch (err) {
        console.error('❌ calculateCashback 發生錯誤:', err);
    } finally {
        // 無條件清 timer + hide：若 150ms timer 還沒觸發就先 clearTimeout（overlay
        // 從未顯示過，loadingOverlay.hide() 的 shown guard 讓這是安全的 no-op）；
        // 若 timer 已經顯示了 overlay，這裡負責收尾隱藏。
        clearTimeout(loadingShowTimer);
        loadingOverlay.hide();
    }
}

// Get all search term variants for comprehensive matching
function getAllSearchVariants(searchTerm) {
    const searchLower = searchTerm.toLowerCase().trim();
    let searchTerms = [searchLower];
    
    // Add fuzzy search mapping if exists
    if (fuzzySearchMap[searchLower]) {
        const mappedTerm = fuzzySearchMap[searchLower].toLowerCase();
        if (!searchTerms.includes(mappedTerm)) {
            searchTerms.push(mappedTerm);
        }
    }
    
    // Also add reverse mappings (find all terms that map to current search)
    Object.entries(fuzzySearchMap).forEach(([key, value]) => {
        if (value.toLowerCase() === searchLower && !searchTerms.includes(key)) {
            searchTerms.push(key);
        }
    });
    
    return searchTerms;
}

// 判斷搜尋詞是否「包含」某個項目名稱（term ⊇ item）。
// 中文允許任意 substring；英文要求詞彙邊界，避免 "singapore" 誤含 "gap"。
function termContainsItemWithBoundary(term, itemLower) {
    if (!term.includes(itemLower)) return false;
    const isChinese = /[\u4e00-\u9fa5]/.test(itemLower);
    if (isChinese) return true;
    const wordBoundaryRegex = new RegExp(
        `(^|\\s|[^a-z])${itemLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-z])`,
        'i'
    );
    return wordBoundaryRegex.test(term);
}

// 把商家名稱拆成可比對單元：主名稱（去掉括號）+ 每個括號內的別名。
// 括號是「唯一」的別名邊界（空格不算），所以雙語商家請統一寫成「中文名 (English)」。
// e.g. "酷澎 (Coupang)"      → ["酷澎", "coupang"]
//      "肯德基 (KFC)"        → ["肯德基", "kfc"]
//      "ToCoo! 日本租車網"   → ["tocoo! 日本租車網"]（無括號 → 整串當一個單元）
function getMerchantSearchUnits(merchantName) {
    const lower = String(merchantName || '').toLowerCase();
    const units = [];
    // 抓出所有括號內容（支援半形 () 與全形 （））
    const bracketRegex = /[(（]([^)）]*)[)）]/g;
    let m;
    while ((m = bracketRegex.exec(lower)) !== null) {
        const inner = m[1].trim();
        if (inner) units.push(inner);
    }
    // 去掉所有括號後的主名稱
    const main = lower.replace(/[(（][^)）]*[)）]/g, '').trim();
    if (main) units.push(main);
    return units.length > 0 ? units : [lower];
}

// B 類（補充資訊）嚴格比對：商家名稱 vs 已 fuzzy 展開的搜尋詞陣列。
// 規則：把商家拆成單元後，任一單元與任一搜尋詞 exact 或雙向 startsWith 即算命中。
// 嚴格的 startsWith（而非 includes）可避免 "日本7-ELEVEN門市" 誤匹配 "7-ELEVEN"。
// unit.startsWith(term) 額外排除「配對後緊接空白+全新英文單字」的情況，
// 避免 "Line Pay" 誤配到完全不同的產品 "Line Pay Money"（"money" 是新單字，不是同一商家的註記）。
// 雙語商家名稱請統一寫成 "中文 (English)" 括號格式（見 getMerchantSearchUnits），
// 才會被拆成獨立 unit 做 exact 比對，不會受此規則影響。
function merchantMatchesStrict(merchantName, searchVariants) {
    const units = getMerchantSearchUnits(merchantName);
    return units.some(unit =>
        searchVariants.some(term => {
            if (term === unit || term.startsWith(unit)) return true;
            if (unit.startsWith(term)) {
                const rest = unit.slice(term.length);
                const isNewEnglishWord = /^\s+[a-z]/i.test(rest);
                return !isNewEnglishWord;
            }
            return false;
        })
    );
}

// 取得類別顯示名稱
function getCategoryDisplayName(category) {
    const categoryMap = {
        '玩數位': '切換「玩數位」方案',
        '樂饗購': '切換「樂饗購」方案',
        '趣旅行': '切換「趣旅行」方案',
        '集精選': '切換「集精選」方案',
        '來支付': '切換「來支付」方案',
        '童樂匯': '切換「童樂匯」方案'
    };
    return categoryMap[category] || category;
}

// Helper function to get category display style (blue chip)
function getCategoryStyle(category) {
    if (!category) return '';
    return 'display: inline-block; background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; vertical-align: middle;';
}

// Base cashback rate for a domestic vs overseas transaction. Overseas falls
// back to basicCashback if the card has no dedicated overseasCashback field.
function resolveBaseRate(card, isOverseas) {
    return isOverseas ? (card.overseasCashback || card.basicCashback) : card.basicCashback;
}

// Domestic/海外 bonus component (rate + cap + display name) for a card+level.
// Priority: levelSettings first (bonus varies per level, e.g. 大戶卡),
// then top-level card fields (bonus is level-independent for all other
// cards, e.g. DBS Eco, 凱基誠品, 中信 uniopen, 滙豐 Live+, iLEO…).
// cap === null means uncapped (無上限). Shared by calculateLayeredCashback
// (Tier 3) and calculateStackedCashback (Layer 2) — same lookup either way.
function resolveBonusComponent(card, levelSettings, isOverseas) {
    if (isOverseas) {
        const rate = (levelSettings && levelSettings.overseasBonusRate) || card.overseasBonusRate || 0;
        const rawCap = (levelSettings && levelSettings.overseasBonusCap != null)
            ? levelSettings.overseasBonusCap : card.overseasBonusCap;
        return { rate, cap: (rawCap != null && rawCap > 0) ? rawCap : null, name: '海外消費加碼' };
    }
    const rate = (levelSettings && levelSettings.domesticBonusRate) || card.domesticBonusRate || 0;
    const rawCap = (levelSettings && levelSettings.domesticBonusCap != null)
        ? levelSettings.domesticBonusCap : card.domesticBonusCap;
    return { rate, cap: (rawCap != null && rawCap > 0) ? rawCap : null, name: '國內消費加碼' };
}

// Overflow rate for the simple (cap→rate_N, overflow→basic) path: basicCashback.
// Shared by calculateCardCashback's simple path and findUpcomingActivity.
// （2026-07-12 移除 meta/google 廣告 → overseasCashback 特例：所有廣告槽位
// 已改用明確的 cashbackModel（stacking），不再進簡單路徑——海外與否一律由
// cashbackModel 決定，程式不認通路名稱。）
function getOverflowRate(card) {
    return resolveBaseRate(card, false);
}

// The rate to SHOW the user for a cashbackRate item. For stacking models
// ("...+...BonusRate", e.g. Sport 卡 Apple Pay) rate_N holds only the
// designated-channel rate, so the displayed rate is designated + basic + bonus
// (3%+1%+1% = 5%) — identical to what the search-result card shows (this mirrors
// calculateStackedCashback's totalRate). For every other model, or blank,
// rate_N is already a total and is shown as-is.
function getDisplayRate(card, rateGroup, designatedRate, levelSettings) {
    const model = rateGroup && rateGroup.cashbackModel;
    if (!model || !model.includes('+')) return designatedRate;
    const isOverseas = model.includes('overseasBonusRate');
    const basicRate = resolveBaseRate(card, isOverseas);
    const { rate: bonusRate } = resolveBonusComponent(card, levelSettings, isOverseas);
    return Math.round((designatedRate + basicRate + bonusRate) * 100) / 100;
}

// 詳情頁「回饋組成」按鈕（計算機圖示）：只有 stacking 模型（cashbackModel 含 '+'）
// 需要解釋加總的來源（如 5% = 3%+1%+1%）；其他模型 rate 即總率，不顯示按鈕。
// 組成資料以 JSON 存在按鈕的 data-comp，點擊由 toggleRateComposition 展開抽屜。
const CALC_BREAKDOWN_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10.5" x2="8.01" y2="10.5"/><line x1="12" y1="10.5" x2="12.01" y2="10.5"/><line x1="16" y1="10.5" x2="16.01" y2="10.5"/><line x1="8" y1="14.5" x2="8.01" y2="14.5"/><line x1="12" y1="14.5" x2="12.01" y2="14.5"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg>';
function rateCompositionButtonHtml(card, rateGroup, designatedRate, designatedCap, levelSettings) {
    const model = rateGroup && rateGroup.cashbackModel;
    if (!model || !model.includes('+')) return '';
    const isOverseas = model.includes('overseasBonusRate');
    const basicRate = resolveBaseRate(card, isOverseas);
    const { rate: bonusRate, cap: bonusCap, name: bonusName } = resolveBonusComponent(card, levelSettings, isOverseas);

    const rows = [];
    if (designatedRate > 0) rows.push({ name: '指定通路加碼', rate: designatedRate, cap: (designatedCap && designatedCap > 0) ? designatedCap : null });
    if (basicRate > 0) rows.push({ name: isOverseas ? '海外基本回饋' : '基本回饋', rate: basicRate, cap: null });
    if (bonusRate > 0) rows.push({ name: bonusName, rate: bonusRate, cap: bonusCap });
    if (rows.length < 2) return '';

    const total = Math.round(rows.reduce((s, r) => s + r.rate, 0) * 100) / 100;
    const comp = escapeHtml(JSON.stringify({ rows, total }));
    return ` <button type="button" class="calc-breakdown-btn" title="查看回饋組成" aria-label="查看回饋組成" data-comp="${comp}" onclick="toggleRateComposition(this)">${CALC_BREAKDOWN_ICON_SVG}</button>`;
}

// 詳情頁：逐筆渲染 cashbackRates（2026-07-09 起不再按 rate+cap 合併），
// category 一律以藍色 chip 顯示在回饋率旁（與一般卡片一致），回饋率顯示
// getDisplayRate 加總值（stacking 模型 = 指定+基本+加碼）。
// 回傳 { html, upcoming }；upcoming 為 30 天內即將開始的活動（逐筆、含 category）。
async function renderCashbackRatesIndividually(card, levelData, options = {}) {
    const { capFallbackToLevel = false, idPrefix = 'lv' } = options;
    const activeRates = [];
    const upcoming = [];

    for (const rate of card.cashbackRates) {
        if (rate.hideInDisplay) continue;
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        if (status !== 'active' && status !== 'always' && status !== 'upcoming') continue;

        const parsedRate = await parseCashbackRate(rate.rate, card, levelData);
        let parsedCap = parseCashbackCap(rate.cap, card, levelData);
        if (parsedCap == null && capFallbackToLevel && levelData) parsedCap = levelData.cap || null;
        const displayRate = getDisplayRate(card, rate, parsedRate, levelData);

        if (status === 'upcoming') {
            if (isUpcomingWithinDays(rate.periodStart, 30)) {
                upcoming.push({
                    parsedRate: displayRate,
                    parsedCap,
                    items: rate.items || [],
                    conditions: rate.conditions ? [{ category: rate.category || '', conditions: rate.conditions }] : [],
                    period: rate.period,
                    periodStart: rate.periodStart,
                    periodEnd: rate.periodEnd,
                    status: 'upcoming',
                    category: rate.category
                });
            }
            continue;
        }
        activeRates.push({ rate, parsedRate, parsedCap, displayRate });
    }

    // 按顯示回饋率（加總後）由高到低排序
    activeRates.sort((a, b) => b.displayRate - a.displayRate);

    let html = '';
    activeRates.forEach((entry, index) => {
        const { rate, parsedRate, parsedCap, displayRate } = entry;
        html += `<div class="cashback-detail-item">`;

        const categoryStyle = rate.category ? getCategoryStyle(rate.category) : '';
        const categoryLabel = rate.category ? ` <span style="${categoryStyle}">${getCategoryDisplayName(rate.category)}</span>` : '';

        let endingSoonBadge = '';
        if (rate.periodEnd && isEndingSoon(rate.periodEnd, 10)) {
            const daysUntil = getDaysUntilEnd(rate.periodEnd);
            const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
            endingSoonBadge = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }

        const compBtn = rateCompositionButtonHtml(card, rate, parsedRate, parsedCap, levelData);
        html += `<div class="cashback-rate"><span class="cashback-rate-num">${displayRate}%</span> 回饋${categoryLabel}${compBtn}${endingSoonBadge}</div>`;

        if (parsedCap) {
            html += `<div class="cashback-condition">消費上限: NT$${Math.floor(parsedCap).toLocaleString()}</div>`;
        } else {
            html += `<div class="cashback-condition">消費上限: 無上限</div>`;
        }

        if (rate.conditions) {
            html += renderConditionLine(rate.conditions);
        }

        if (rate.period) {
            html += `<div class="cashback-condition">活動期間: ${rate.period}</div>`;
        }

        if (rate.items && rate.items.length > 0) {
            const uniqueItems = [...new Set(rate.items)];
            const merchantsId = `merchants-${card.id}-${idPrefix}-${index}`;
            const showAllId = `show-all-${card.id}-${idPrefix}-${index}`;

            if (uniqueItems.length <= 5) {
                html += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${uniqueItems.join('、')}</div>`;
            } else {
                const initialList = uniqueItems.slice(0, 5).join('、');
                const fullList = uniqueItems.join('、');
                html += `<div class="cashback-merchants">`;
                html += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                html += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${uniqueItems.length}個</button>`;
                html += `</div>`;
            }
        }

        html += `</div>`;
    });

    return { html, upcoming };
}

/**
 * Calculate layered cashback for cards with multi-tier reward structures
 * Used for cards like DBS Eco where multiple reward rates stack with independent caps
 *
 * @param {Object} card - The card object
 * @param {Object} levelSettings - Level settings containing bonus rates and caps
 * @param {number} amount - Transaction amount
 * @param {number} displayedRate - Total displayed rate (for reference)
 * @param {number} cap - Consumption cap for the highest tier bonus
 * @param {boolean} isOverseas - Whether this is an overseas transaction
 * @returns {Object} - { cashbackAmount, layers }
 */
// Waterfall cashback for designated-channel cards that also carry a 國內/海外
// 加碼 (e.g. 永豐大戶卡 悠遊卡自動加值). The designated rate is a flat TOTAL
// within its own cap and does NOT overlap basic; only the OVERFLOW beyond that
// cap drops down to 基本 + 加碼. Driven entirely by data fields (designated
// rate/cap from the matched rateGroup, bonus rate/cap from levelSettings or the
// top-level card) — no card-specific branching.
//
//   Tier 1 指定通路 : min(amount, designatedCap) × designatedRate   (flat, no basic overlap)
//   Tier 2 基本回饋 : overflow × baseRate                            (無上限)
//   Tier 3 國內/海外加碼 : min(overflow, bonusCap) × bonusRate        (capped)
function calculateLayeredCashback(card, levelSettings, amount, displayedRate, cap, isOverseas = false) {
    const layers = [];
    let totalCashback = 0;

    // Tier 1: designated channel — flat total rate within its own cap, no basic overlap
    const designatedAmount = (cap && cap > 0) ? Math.min(amount, cap) : amount;
    const designatedCashback = Math.floor(designatedAmount * displayedRate / 100);
    layers.push({
        name: '指定通路',
        rate: displayedRate,
        applicableAmount: designatedAmount,
        cashback: designatedCashback,
        cap: (cap && cap > 0) ? cap : null
    });
    totalCashback += designatedCashback;

    const overflow = amount - designatedAmount;

    if (overflow > 0) {
        // Tier 2: base rate on the overflow (no cap).
        const baseRate = resolveBaseRate(card, isOverseas);
        const baseCashback = Math.floor(overflow * baseRate / 100);
        layers.push({
            name: '基本回饋',
            rate: baseRate,
            applicableAmount: overflow,
            cashback: baseCashback,
            cap: null
        });
        totalCashback += baseCashback;

        // Tier 3: 國內/海外加碼 on the overflow.
        const { rate: bonusRate, cap: bonusCap, name: bonusName } = resolveBonusComponent(card, levelSettings, isOverseas);

        if (bonusRate > 0) {
            // bonusCap null = apply to full overflow (無上限)
            const bonusApplicableAmount = bonusCap != null ? Math.min(overflow, bonusCap) : overflow;
            const bonusCashback = Math.floor(bonusApplicableAmount * bonusRate / 100);
            layers.push({
                name: bonusName,
                rate: bonusRate,
                applicableAmount: bonusApplicableAmount,
                cashback: bonusCashback,
                cap: bonusCap // null = 無上限, preserved for display
            });
            totalCashback += bonusCashback;
        }
    }

    return {
        cashbackAmount: totalCashback,
        layers: layers
    };
}

// Stacking (疊加) model: all rate components apply to the same spending amount simultaneously.
// Used when cashbackModel = "...+domesticBonusRate" or "...+overseasBonusRate".
// rate_N for a stacking item holds ONLY the designated-channel rate (e.g. Sport 卡
// Apple Pay rate_N = 3, not 5) — it does NOT include basic/bonus. The displayed
// 回饋率 (totalRate) is computed here as designated + basic + bonus for the user.
// Each component has its own cap; they are applied concurrently (not waterfall).
function calculateStackedCashback(card, levelSettings, amount, designatedRate, cap, isOverseas = false) {
    const layers = [];
    let totalCashback = 0;

    const basicRate = resolveBaseRate(card, isOverseas);
    const { rate: bonusRate, cap: bonusCap, name: bonusName } = resolveBonusComponent(card, levelSettings, isOverseas);

    // Layer 1: base cashback on ALL spending (no cap) — 海外模型自動用
    // overseasCashback（resolveBaseRate），所以「overseasCashback+overseasBonusRate」
    // 這種無 basic 的組合不需要特殊處理
    const basicCashback = Math.floor(amount * basicRate / 100);
    layers.push({ name: isOverseas ? '海外基本回饋' : '基本回饋', rate: basicRate, applicableAmount: amount, cashback: basicCashback, cap: null });
    totalCashback += basicCashback;

    // Layer 2: Bonus (domestic / overseas), within its own cap
    if (bonusRate > 0) {
        const bonusAmount = bonusCap != null ? Math.min(amount, bonusCap) : amount;
        const bonusCashback = Math.floor(bonusAmount * bonusRate / 100);
        layers.push({ name: bonusName, rate: bonusRate, applicableAmount: bonusAmount, cashback: bonusCashback, cap: bonusCap });
        totalCashback += bonusCashback;
    }

    // Layer 3: Designated channel rate (from rate_N as-is), within cashbackRate cap
    if (designatedRate > 0) {
        const designatedAmount = (cap && cap > 0) ? Math.min(amount, cap) : amount;
        const designatedCashback = Math.floor(designatedAmount * designatedRate / 100);
        layers.push({ name: '指定通路加碼', rate: designatedRate, applicableAmount: designatedAmount, cashback: designatedCashback, cap: (cap && cap > 0) ? cap : null });
        totalCashback += designatedCashback;
    }

    // Displayed 回饋率 = sum of all active components (e.g. 3%+1%+1% = 5%)
    const totalRate = designatedRate + basicRate + bonusRate;

    return { cashbackAmount: totalCashback, layers, totalRate };
}

// Calculate cashback for a specific card
async function calculateCardCashback(card, searchTerm, amount) {
    let allMatches = []; // Collect ALL matching activities
    let selectedLevel = null; // Track selected level for display

    // Get all possible search variants
    const searchVariants = getAllSearchVariants(searchTerm);

    // Handle cards with levels and specialItems (CUBE or Uni card)
    if (card.hasLevels && card.specialItems && card.specialItems.length > 0) {
        const availableLevels = Object.keys(card.levelSettings || {});
        const defaultLevel = availableLevels[0];
        let savedLevel = await getCardLevel(card.id, defaultLevel);

        // Try to find matching level if savedLevel doesn't exist
        if (!card.levelSettings?.[savedLevel]) {
            // Try case-insensitive match
            const matchedLevel = availableLevels.find(level =>
                level.toLowerCase().replace(/\s+/g, '') === savedLevel.toLowerCase().replace(/\s+/g, '')
            );
            if (matchedLevel) {
                savedLevel = matchedLevel;
                // Same level, just a formatting difference (e.g. "level1" vs
                // "Level 1") — safe to persist the normalized form.
                await saveCardLevel(card.id, savedLevel);
            } else {
                // Genuinely not found — use default for this calculation only,
                // but do NOT persist it, so the user's stored choice survives a
                // transient data mismatch (see resolveCardLevel for rationale).
                savedLevel = defaultLevel;
            }
        }

        selectedLevel = savedLevel; // Store selected level
        const levelSettings = card.levelSettings?.[savedLevel];

        // Safety check: if levelSettings is still undefined, return 0 cashback
        if (!levelSettings) {
            console.warn(`⚠️ ${card.name}: levelSettings 未定義 for level "${savedLevel}"`);
            return [];
        }

        // First, check cashbackRates if they exist (for cards like DBS Eco with special promotions)
        // Use index for fast lookup
        if (card.cashbackRates && card.cashbackRates.length > 0 && card._itemsIndex) {
            const processedRateGroups = new Set(); // Track processed rate groups to avoid duplicates

            for (const variant of searchVariants) {
                const indexMatches = card._itemsIndex.get(variant);
                if (!indexMatches) continue;

                // Filter for cashbackRate matches only
                const cashbackMatches = indexMatches.filter(match => match.type === 'cashbackRate');

                for (const match of cashbackMatches) {
                    const rateGroup = match.rateGroup;

                    // Skip if already processed this rate group
                    if (processedRateGroups.has(rateGroup)) continue;
                    processedRateGroups.add(rateGroup);

                    // Only consider active rates for cashback calculation (not upcoming)
                    const rateStatus = getCachedRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
                    if (rateStatus !== 'active' && rateStatus !== 'always') {
                        continue;
                    }

                    // 慶生月方案只在用戶生日當月配對
                    if (rateGroup.category === '切換「慶生月」方案' && !isBirthdayMonth) {
                        continue;
                    }

                    // 童樂匯方案只對符合資格的用戶配對
                    if (rateGroup.category === '切換「童樂匯」方案' && !isChildrenEligible) {
                        continue;
                    }

                    // JCB日本賞方案只對 JCB 發卡組織用戶配對
                    if (rateGroup.category === '切換「JCB日本賞」方案' && cubeIssuer !== 'JCB') {
                        continue;
                    }

                    // 解析 rate 值（支援 {specialRate}）
                    let parsedRate = await parseCashbackRate(rateGroup.rate, card, levelSettings);
                    let applicableCap = rateGroup.cap;

                    // Find the exact matched item name
                    const exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);

                    // 隱藏槽（hideInDisplay）與一般活動走完全相同的計算與匹配邏輯：
                    // cashbackModel 空 → 預設行為；有值 → 以 model 為準（rate=0 表示
                    // 「無指定通路加碼成分」，如純 basic+加碼 的一般消費槽）。
                    console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}" (${parsedRate}%)`);

                    // Add this match to allMatches array
                    allMatches.push({
                        rate: parsedRate,
                        cap: applicableCap,
                        matchedItem: exactMatch,
                        matchedCategory: rateGroup.category || null,
                        matchedRateGroup: rateGroup
                    });
                }
            }
        }

        // If no cashbackRates match, check specialItems
        if (allMatches.length === 0) {
            let matchedSpecialItem = null;
            let matchedVariant = null;

            // Use index for fast lookup
            if (card._itemsIndex) {
                for (const variant of searchVariants) {
                    const indexMatches = card._itemsIndex.get(variant);
                    if (indexMatches) {
                        const specialMatch = indexMatches.find(match => match.type === 'specialItem');
                        if (specialMatch) {
                            matchedSpecialItem = typeof specialMatch.specialItem === 'string'
                                ? specialMatch.specialItem
                                : specialMatch.specialItem.item;
                            matchedVariant = variant;
                            console.log(`✅ ${card.name}: 匹配到 specialItem "${matchedSpecialItem}" (搜索詞: "${variant}")`);
                            break;
                        }
                    }
                }
            }

            if (matchedSpecialItem) {
                // CUBE card uses specialRate, other cards use rate
                let rate = levelSettings.specialRate || levelSettings.rate;
                let matchedCategory = null;

                // Set category from levelSettings
                if (levelSettings.category) {
                    matchedCategory = levelSettings.category;
                } else {
                    matchedCategory = null;
                }

                // Set cap based on card type
                let cap = levelSettings.cap || null;

                // Set period from levelSettings if available
                let rateGroup = null;
                if (levelSettings.period) {
                    rateGroup = { period: levelSettings.period };
                }

                // Add this match to allMatches array
                allMatches.push({
                    rate: rate,
                    cap: cap,
                    matchedItem: matchedSpecialItem,
                    matchedCategory: matchedCategory,
                    matchedRateGroup: rateGroup
                });
            }
        }

        // If still no match and this is CUBE card, check generalItems
        if (allMatches.length === 0 && card.id === 'cathay-cube') {
            // CUBE card: check general items for 2% reward using index
            let matchedGeneralItem = null;
            let matchedGeneralCategory = null;

            if (card.generalItems && card._itemsIndex) {
                for (const variant of searchVariants) {
                    const indexMatches = card._itemsIndex.get(variant);
                    if (indexMatches) {
                        const generalMatch = indexMatches.find(match => match.type === 'generalItem');
                        if (generalMatch) {
                            matchedGeneralItem = generalMatch.item;
                            matchedGeneralCategory = generalMatch.category;
                            break;
                        }
                    }
                }
            }

            if (matchedGeneralItem) {
                allMatches.push({
                    rate: levelSettings.generalRate,
                    cap: null, // CUBE card has no cap
                    matchedItem: matchedGeneralItem,
                    matchedCategory: matchedGeneralCategory,
                    matchedRateGroup: null
                });
            }
        }
        // For other level-based cards: if no match found, allMatches will be empty
    } else {
        // Handle cards without specialItems (or with empty specialItems)
        // Get level settings if card has levels
        let levelData = null;
        if (card.hasLevels) {
            const defaultLevel = Object.keys(card.levelSettings)[0];
            const resolved = await resolveCardLevel(card, defaultLevel);
            levelData = resolved.data;
            selectedLevel = resolved.level; // Store selected level for display
        }

        // Check exact matches for all search variants using index
        if (card._itemsIndex) {
            const processedRateGroups = new Set();

            for (const variant of searchVariants) {
                const indexMatches = card._itemsIndex.get(variant);
                if (!indexMatches) continue;

                const cashbackMatches = indexMatches.filter(match => match.type === 'cashbackRate');

                for (const match of cashbackMatches) {
                    const rateGroup = match.rateGroup;

                    // Skip if already processed
                    if (processedRateGroups.has(rateGroup)) continue;
                    processedRateGroups.add(rateGroup);

                    // Only consider active rates for cashback calculation (not upcoming)
                    const rateStatus = getCachedRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
                    if (rateStatus !== 'active' && rateStatus !== 'always') {
                        continue;
                    }

                    // 慶生月方案只在用戶生日當月配對
                    if (rateGroup.category === '切換「慶生月」方案' && !isBirthdayMonth) {
                        continue;
                    }

                    // 童樂匯方案只對符合資格的用戶配對
                    if (rateGroup.category === '切換「童樂匯」方案' && !isChildrenEligible) {
                        continue;
                    }

                    // JCB日本賞方案只對 JCB 發卡組織用戶配對
                    if (rateGroup.category === '切換「JCB日本賞」方案' && cubeIssuer !== 'JCB') {
                        continue;
                    }

                    // 解析 rate 值（支援 {rate}、{specialRate} 等任意 levelSettings 欄位）
                    let parsedRate = await parseCashbackRate(rateGroup.rate, card, levelData);
                    let parsedCap = parseCashbackCap(rateGroup.cap, card, levelData);

                    // Find the exact matched item name
                    const exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);

                    // 隱藏槽（hideInDisplay）與一般活動走完全相同的計算與匹配邏輯：
                    // cashbackModel 空 → 預設行為；有值 → 以 model 為準（rate=0 表示
                    // 「無指定通路加碼成分」，如純 basic+加碼 的一般消費槽）。
                    const applicableCap = parsedCap !== null ? parsedCap : rateGroup.cap;
                    console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}" (${parsedRate}%)`);

                    // Add this match to allMatches array
                    allMatches.push({
                        rate: parsedRate,
                        cap: applicableCap,
                        matchedItem: exactMatch,
                        matchedCategory: rateGroup.category || null,
                        matchedRateGroup: rateGroup
                    });
                }
            }
        }
    }

    // Calculate cashback for each match and return array of results
    const results = allMatches.map(match => {
        const { rate, cap, matchedItem, matchedCategory, matchedRateGroup } = match;

        let cashbackAmount = 0;
        let effectiveAmount = amount;
        let totalRate = rate;
        let calculationLayers = null;

        // Determine calculation path based on cashbackModel field and card bonus rates.
        // cashbackModel values (set per-cashbackRate item in Sheet); the name lists
        // every rate component that applies, in order of cap consumption:
        //   "rate" / "rate+basic"           → just the rate, basic on overflow, NO bonus
        //   "rate+basic+domesticBonusRate"  → stacking: designated + basic + domestic bonus
        //   "rate+basic+overseasBonusRate"  → stacking: designated + basic + overseas bonus
        //   "basic+domesticBonusRate"       → stacking, no designated (general 國內消費)
        //   "basic+overseasBonusRate"       → stacking, no designated (general 國外消費)
        //   (not set)                       → waterfall if card carries any bonus rate
        let shouldUseLayeredCalculation = false;
        let shouldUseStackedCalculation = false;
        let stackedIsOverseas = false;
        let levelSettingsForCalc = null;
        let isOverseasTransaction = false;

        // Step 1: resolve level settings for hasLevels cards (regardless of bonus)
        if (card.hasLevels && card.levelSettings) {
            const availableLevels = Object.keys(card.levelSettings);
            const levelToUse = selectedLevel || availableLevels[0];
            levelSettingsForCalc = card.levelSettings[levelToUse];
        }

        // Step 2: pick calculation model
        const cashbackModel = matchedRateGroup ? matchedRateGroup.cashbackModel : null;

        // cashbackModel grammar — the SEPARATOR alone picks stacking vs waterfall,
        // per rate_N slot, independent of every other slot on the same card:
        //   "+" → STACKING: components apply concurrently to the FULL amount,
        //         each with its own cap (calculateStackedCashback). rate_N here
        //         is the designated-only rate (does NOT include basic).
        //         e.g. "rate+basic+domesticBonusRate", "basic+overseasBonusRate"
        //   ">" → WATERFALL: rate_N is cap-limited; the overflow then earns the
        //         next component(s) (calculateLayeredCashback). rate_N here is
        //         the ALREADY-TOTALED rate (includes basic).
        //         e.g. "rate>basic>domesticBonusRate", "rate>basic>overseasBonusRate"
        //   "rate" (bare, no separator) → simple 2-tier, NEVER applies any bonus
        //         regardless of the card's own bonus fields (cap→rate_N,
        //         overflow→basicCashback only) — for channels fully excluded
        //         from the card's bonus program, e.g. 大戶卡「悠遊卡自動加值」.
        //   (blank) → legacy default: if the card carries domesticBonusRate/
        //         overseasBonusRate, behaves like an implicit domestic
        //         "rate>basic>domesticBonusRate" — kept so cards not yet
        //         tagged (DBS Eco 國內項目, 凱基誠品, …) keep working unchanged.
        //
        // Domestic vs overseas is read purely from whether the literal keyword
        // `domesticBonusRate` / `overseasBonusRate` appears in the string —
        // never auto-detected from the search term or item name.
        // NOTE: the retired name "rate+basic" (used before this redesign) is NOT
        // an alias for bare "rate" — it now matches the "+" branch (stacking).
        // Rename any existing "rate+basic" data to bare "rate".
        const isOverseasModel = cashbackModel ? cashbackModel.includes('overseasBonusRate') : false;

        if (cashbackModel === 'rate') {
            // Simple path, no bonus ever — handled by the final `else` branch below.
        } else if (cashbackModel && cashbackModel.includes('+')) {
            shouldUseStackedCalculation = true;
            stackedIsOverseas = isOverseasModel;
        } else if (cashbackModel && cashbackModel.includes('>')) {
            shouldUseLayeredCalculation = true;
            isOverseasTransaction = isOverseasModel;
        } else if (!cashbackModel) {
            // Blank — legacy default: waterfall (domestic) if card carries bonus rates
            const effectiveDomBonus = (levelSettingsForCalc && levelSettingsForCalc.domesticBonusRate) || card.domesticBonusRate;
            const effectiveOvsBonus = (levelSettingsForCalc && levelSettingsForCalc.overseasBonusRate) || card.overseasBonusRate;

            if (effectiveDomBonus || effectiveOvsBonus) {
                shouldUseLayeredCalculation = true;
                isOverseasTransaction = false;
            }
        }

        // 註：stacking 允許 rate=0 的「無指定加碼」項目（如隱藏的一般國內消費槽，
        // model=basic+domesticBonusRate）——基本與加碼層仍會計算。
        if (rate > 0 || shouldUseStackedCalculation) {
            if (shouldUseStackedCalculation) {
                // Stacking model: basic + bonus + designated all applied to same amount
                const stackedResult = calculateStackedCashback(
                    card,
                    levelSettingsForCalc,
                    amount,
                    rate,
                    cap,
                    stackedIsOverseas
                );
                cashbackAmount = stackedResult.cashbackAmount;
                calculationLayers = stackedResult.layers;
                totalRate = stackedResult.totalRate; // 顯示加總後的最高回饋率（如 3%+1%+1%=5%）
                effectiveAmount = amount;
            } else if (shouldUseLayeredCalculation) {
                // Waterfall: designated tier first, basic on overflow, bonus on overflow
                const layeredResult = calculateLayeredCashback(
                    card,
                    levelSettingsForCalc,
                    amount,
                    rate,
                    cap,
                    isOverseasTransaction
                );
                cashbackAmount = layeredResult.cashbackAmount;
                calculationLayers = layeredResult.layers;
                totalRate = rate; // Keep displayed total rate
                effectiveAmount = amount; // Show full amount for layered calculation
            } else {
                // Simple path: cap 內用 rate_N(已含 basic)、溢出視 cashbackModel 而定.
                // Build the breakdown layers once and derive cashbackAmount from
                // them, instead of computing each layer's cashback twice.
                const effectiveSpecialAmount = (cap && cap > 0) ? Math.min(amount, cap) : amount;
                const specialCashback = Math.floor(effectiveSpecialAmount * rate / 100);

                const layers = [
                    { name: '指定通路', rate: rate, applicableAmount: effectiveSpecialAmount, cashback: specialCashback, cap: (cap && cap > 0) ? cap : null }
                ];

                if (cap && amount > cap) {
                    const remainingAmount = amount - cap;
                    if (cashbackModel === 'rate') {
                        // Fully excluded from the card's ordinary spending program
                        // (e.g. 大戶卡「悠遊卡自動加值」) — spending beyond the cap
                        // earns nothing, shown explicitly as 0 rather than silently
                        // missing from the total.
                        layers.push({ name: '超過上限(不列入回饋)', rate: 0, applicableAmount: remainingAmount, cashback: 0, cap: null });
                    } else {
                        const excessRate = getOverflowRate(card);
                        const remainingCashback = Math.floor(remainingAmount * excessRate / 100);
                        layers.push({ name: '基本回饋', rate: excessRate, applicableAmount: remainingAmount, cashback: remainingCashback, cap: null });
                    }
                }

                cashbackAmount = layers.reduce((sum, layer) => sum + layer.cashback, 0);
                totalRate = Math.round(rate * 100) / 100;
                effectiveAmount = cap; // Keep this for display purposes
                calculationLayers = layers;
            }
        }

        return {
            rate: Math.round(totalRate * 100) / 100,
            specialRate: Math.round(rate * 100) / 100,
            basicRate: Math.round(card.basicCashback * 100) / 100,
            cashbackAmount: cashbackAmount,
            cap: cap,
            matchedItem: matchedItem,
            matchedCategory: matchedCategory,
            effectiveAmount: effectiveAmount,
            matchedRateGroup: matchedRateGroup,
            selectedLevel: selectedLevel, // Pass selected level to display
            periodStart: matchedRateGroup?.periodStart || null,
            periodEnd: matchedRateGroup?.periodEnd || null,
            calculationLayers: calculationLayers, // Include layer breakdown if available
            isLayeredCalculation: shouldUseLayeredCalculation
        };
    });

    return results;
}

// Find upcoming activities for a card (activities starting within 30 days)
async function findUpcomingActivity(card, searchTerm, amount) {
    let allMatchedActivities = [];

    // Get all possible search variants
    const searchVariants = getAllSearchVariants(searchTerm);

    // Get level settings if card has levels
    let levelData = null;
    let selectedLevel = null;
    if (card.hasLevels) {
        const availableLevels = Object.keys(card.levelSettings || {});
        const defaultLevel = availableLevels[0];
        const resolved = await resolveCardLevel(card, defaultLevel);
        levelData = resolved.data;
        selectedLevel = resolved.level;
    }

    // Check cashbackRates for upcoming activities
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        for (const rateGroup of card.cashbackRates) {
            if (!rateGroup.items) continue;

            // Only consider upcoming rates
            const rateStatus = getCachedRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
            if (rateStatus !== 'upcoming') {
                continue;
            }

            // Check if it's within 30 days
            if (!isUpcomingWithinDays(rateGroup.periodStart, 30)) {
                continue;
            }

            // Parse rate and cap
            const parsedRate = await parseCashbackRate(rateGroup.rate, card, levelData);
            const parsedCap = parseCashbackCap(rateGroup.cap, card, levelData);

            // Collect all items that match the search term
            const matchedItems = [];
            for (const item of rateGroup.items) {
                const itemLower = item.toLowerCase();
                for (const variant of searchVariants) {
                    if (itemLower === variant) {
                        matchedItems.push(item);
                        break; // Found match for this item, move to next item
                    }
                }
            }

            // If any items matched, add this activity
            if (matchedItems.length > 0) {
                // Calculate cashback amount
                let cashbackAmount = 0;
                let effectiveAmount = amount;

                if (parsedCap && amount > parsedCap) {
                    effectiveAmount = parsedCap;
                }

                // Calculate special rate cashback
                const specialCashback = Math.floor(effectiveAmount * parsedRate / 100);

                // Calculate remaining amount cashback (if capped)
                let remainingCashback = 0;
                if (parsedCap && amount > parsedCap) {
                    const remainingAmount = amount - parsedCap;
                    const excessRate = getOverflowRate(card);
                    remainingCashback = Math.floor(remainingAmount * excessRate / 100);
                }

                cashbackAmount = specialCashback + remainingCashback;

                allMatchedActivities.push({
                    rate: parsedRate,
                    cap: parsedCap,
                    cashbackAmount: cashbackAmount,
                    matchedItem: matchedItems[0], // First matched item for backward compatibility
                    matchedItems: matchedItems, // All matched items
                    matchedCategory: rateGroup.category || null,
                    periodStart: rateGroup.periodStart,
                    periodEnd: rateGroup.periodEnd,
                    period: rateGroup.period,
                    selectedLevel: selectedLevel
                });
            }
        }
    }

    return allMatchedActivities;
}

// Display calculation results
// 模糊匹配商家名稱
// searchVariants：已 fuzzy 展開的搜尋詞陣列（由 displayMerchantPaymentInfo 傳入）
function findMerchantPaymentInfo(searchVariants) {
    console.log('🔍 findMerchantPaymentInfo 被調用，搜尋詞:', searchVariants);

    if (!cardsData?.merchantPayments) {
        console.log('❌ cardsData.merchantPayments 不存在');
        return null;
    }

    if (!searchVariants || searchVariants.length === 0) {
        console.log('❌ searchVariants 為空');
        return null;
    }

    // B 類嚴格比對：商家名稱拆括號 + 雙向 startsWith
    // e.g. "好市多 (Costco)" 可用「好市多」或「Costco」搜到；
    //      "日本7-ELEVEN門市" 不會誤匹配 "7-ELEVEN"
    for (const [merchantName, paymentInfo] of Object.entries(cardsData.merchantPayments)) {
        if (merchantMatchesStrict(merchantName, searchVariants)) {
            console.log('✅ 匹配到:', merchantName);
            return { merchantName, ...paymentInfo };
        }
    }

    console.log('❌ 沒有匹配到任何商家');
    return null;
}

// 顯示商家付款方式資訊
// 取得或建立 merchant-info 兩欄容器（左：商家付款方式，右：導購加碼）
function getOrCreateMerchantInfoRow() {
    let row = document.getElementById('merchant-info-row');
    if (row) return row;

    row = document.createElement('div');
    row.id = 'merchant-info-row';
    row.className = 'merchant-info-row';

    const resultsSection = document.getElementById('results-section');
    const paymentDisclaimer = document.getElementById('payment-disclaimer');
    if (resultsSection && paymentDisclaimer) {
        resultsSection.insertBefore(row, paymentDisclaimer);
    }
    return row;
}

function removeMerchantInfoRowIfEmpty() {
    const row = document.getElementById('merchant-info-row');
    if (row && row.children.length === 0) {
        row.remove();
    }
}

function displayMerchantPaymentInfo(searchedItem) {
    // 移除舊的商家付款方式區塊（如果存在）
    const existingBlock = document.getElementById('merchant-payment-info');
    if (existingBlock) {
        existingBlock.remove();
    }

    if (!searchedItem) {
        return;
    }

    // 展開別名（e.g. "711" → ["711","7-eleven"]），讓縮寫也能匹配
    const searchTerms = getAllSearchVariants(searchedItem);

    console.log('🔍 搜尋商家付款方式，原始搜尋詞:', searchedItem);
    console.log('🔍 展開後的搜尋詞:', searchTerms);

    const merchantInfo = findMerchantPaymentInfo(searchTerms);

    if (!merchantInfo) {
        console.log('❌ 所有搜尋詞都未匹配到商家付款方式');
        removeMerchantInfoRowIfEmpty();
        return;
    }

    // 建立商家付款方式區塊
    const infoBlock = document.createElement('div');
    infoBlock.id = 'merchant-payment-info';
    infoBlock.className = 'merchant-payment-info';

    let infoHTML = `<div class="merchant-payment-title">＊ ${escapeHtml(merchantInfo.merchantName)}也支援以下行動支付</div>`;

    // 計算有多少個付款方式
    const hasOnline = merchantInfo.online && merchantInfo.online.trim() !== '';
    const hasOffline = merchantInfo.offline && merchantInfo.offline.trim() !== '';
    const bothExist = hasOnline && hasOffline;

    if (hasOnline) {
        const label = bothExist ? '<span class="payment-label">線上：</span>' : '';
        infoHTML += `<div class="merchant-payment-item">${label}${escapeHtml(merchantInfo.online)}</div>`;
    }

    if (hasOffline) {
        const label = bothExist ? '<span class="payment-label">門市：</span>' : '';
        infoHTML += `<div class="merchant-payment-item">${label}${escapeHtml(merchantInfo.offline)}</div>`;
    }

    infoBlock.innerHTML = infoHTML;

    // 插入到 merchant-info-row 容器（左欄）
    const row = getOrCreateMerchantInfoRow();
    if (row) {
        // 確保 merchant-payment-info 在最前面（左欄）
        row.insertBefore(infoBlock, row.firstChild);
    }
}

// 顯示推薦連結資訊
function displayReferralLink(searchedItem) {
    // 移除舊的推薦連結區塊（如果存在）
    const existingBlock = document.getElementById('referral-link-info');
    if (existingBlock) {
        existingBlock.remove();
    }

    if (!searchedItem || !cardsData?.referralLinks) {
        return;
    }

    // 搜尋匹配的推薦連結（含 fuzzy 別名展開，e.g. "711" 也能匹配 "7-ELEVEN"）
    // B 類嚴格比對：商家拆括號 + 雙向 startsWith，避免 "日本7-ELEVEN門市" 誤匹配 "7-ELEVEN"
    const searchVariants = getAllSearchVariants(searchedItem);
    const matchedReferral = cardsData.referralLinks.find(referral =>
        referral.active && merchantMatchesStrict(referral.merchant, searchVariants)
    );

    if (!matchedReferral) {
        return;
    }

    console.log('✅ 找到推薦連結:', matchedReferral.merchant);

    // 建立推薦連結區塊
    const infoBlock = document.createElement('div');
    infoBlock.id = 'referral-link-info';
    infoBlock.className = 'referral-link-info';

    const referralUrl = sanitizeUrl(matchedReferral.url);
    infoBlock.innerHTML = `
        <div class="referral-link-content">
            <span class="referral-link-icon">🎁</span>
            <span class="referral-link-text">${escapeHtml(matchedReferral.description)}</span>
            ${referralUrl ? `<a href="${escapeHtml(referralUrl)}" target="_blank" rel="noopener noreferrer" class="referral-link-button">
                前往註冊 →
            </a>` : ''}
        </div>
    `;

    // 插入到商家付款方式區塊下方、免責聲明上方
    const resultsSection = document.getElementById('results-section');
    const paymentDisclaimer = document.getElementById('payment-disclaimer');
    const merchantInfoRow = document.getElementById('merchant-info-row');

    if (resultsSection && paymentDisclaimer) {
        // 如果有 merchant-info-row，插入在它下方；否則插入在免責聲明上方
        const insertBeforeElement = merchantInfoRow ? merchantInfoRow.nextSibling : paymentDisclaimer;
        resultsSection.insertBefore(infoBlock, insertBeforeElement);
    }
}

// 顯示導購網站回饋資訊（Shopback / Line 購物）
// 建立獨立 block 放在 merchant-info-row 的右欄
function displayCashbackSites(searchedItem) {
    const existingBlock = document.getElementById('cashback-sites-info');
    if (existingBlock) {
        existingBlock.remove();
    }

    if (!searchedItem || !cardsData?.cashbackSites) {
        removeMerchantInfoRowIfEmpty();
        return;
    }

    const sites = cardsData.cashbackSites;
    const shopbackList = Array.isArray(sites.shopback) ? sites.shopback : [];
    const linebuyList = Array.isArray(sites.linebuy) ? sites.linebuy : [];

    // 展開別名（e.g. "全聯" → ["全聯","px mart"]），讓縮寫也能匹配
    const searchTerms = getAllSearchVariants(searchedItem);

    // B 類嚴格比對：商家拆括號 + 雙向 startsWith
    // e.g. "酷澎 (Coupang)" 可用「酷澎」或「Coupang」搜到；
    //      "ToCoo! 日本租車網" 不會被「日本」誤匹配
    const matchEntry = (list) =>
        list.find(entry => entry && entry.merchant && merchantMatchesStrict(entry.merchant, searchTerms)) || null;

    const shopbackMatch = matchEntry(shopbackList);
    const linebuyMatch = matchEntry(linebuyList);

    if (!shopbackMatch && !linebuyMatch) {
        removeMerchantInfoRowIfEmpty();
        return;
    }

    // 建立獨立 block（同 merchant-payment-info 灰色樣式）
    const infoBlock = document.createElement('div');
    infoBlock.id = 'cashback-sites-info';
    infoBlock.className = 'merchant-payment-info';

    // 標題顯示實際匹配到的商家名稱（粗體），而非使用者輸入
    const matchedMerchantName = (shopbackMatch || linebuyMatch).merchant;
    let html = `<div class="merchant-payment-title">＊ <strong>${escapeHtml(matchedMerchantName)}</strong> 也可透過導購網站享加碼回饋</div>`;
    const shopbackUrl = shopbackMatch ? sanitizeUrl(shopbackMatch.link) : '';
    const linebuyUrl = linebuyMatch ? sanitizeUrl(linebuyMatch.link) : '';
    if (shopbackUrl) {
        html += `<div class="merchant-payment-item"><a href="${escapeHtml(shopbackUrl)}" target="_blank" rel="noopener noreferrer" class="cashback-site-link">Shopback →</a></div>`;
    }
    if (linebuyUrl) {
        html += `<div class="merchant-payment-item"><a href="${escapeHtml(linebuyUrl)}" target="_blank" rel="noopener noreferrer" class="cashback-site-link">LINE 購物 →</a></div>`;
    }
    infoBlock.innerHTML = html;

    // 插入到 merchant-info-row 容器（右欄）
    const row = getOrCreateMerchantInfoRow();
    if (row) {
        row.appendChild(infoBlock);
    }
}

function displayResults(results, originalAmount, searchedItem, isBasicCashback = false) {
    console.log('📊 displayResults 被調用');
    console.log('results 數量:', results.length);
    console.log('isBasicCashback:', isBasicCashback);
    resultsContainer.innerHTML = '';

    // Check if searchedItem is a payment method
    const paymentDisclaimer = document.getElementById('payment-disclaimer');
    const isPaymentMethod = paymentsData?.payments.some(payment =>
        payment.searchTerms.some(term =>
            searchedItem.toLowerCase().includes(term.toLowerCase()) ||
            term.toLowerCase().includes(searchedItem.toLowerCase())
        )
    );

    // Hide disclaimer if searching for payment method
    if (paymentDisclaimer) {
        paymentDisclaimer.style.display = isPaymentMethod ? 'none' : 'block';
    }
    
    if (results.length === 0) {
        // No cards have cashback for this item
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.innerHTML = `
            <h3>無符合的信用卡</h3>
            <p>沒有任何信用卡對「${escapeHtml(searchedItem)}」提供現金回饋。</p>
        `;
        resultsContainer.appendChild(noResultsDiv);
    } else {
        const maxCashback = results[0].cashbackAmount;

        // Use DocumentFragment to batch DOM operations and reduce reflows
        const fragment = document.createDocumentFragment();
        results.forEach((result, index) => {
            const cardElement = createCardResultElement(result, originalAmount, searchedItem, index === 0 && maxCashback > 0, isBasicCashback);
            fragment.appendChild(cardElement);
        });
        resultsContainer.appendChild(fragment);
    }

    // 顯示商家付款方式資訊 / 導購網站 / 推薦連結
    // Use actual user input, not the joined matched-item names — otherwise a search like
    // "日本" would match "7-ELEVEN" (because "日本7-ELEVEN門市" is a matched item) or
    // "ToCoo! 日本租車網" in Shopback (because "日本" appears inside the merchant name).
    const actualUserInput = merchantInput.value.trim();
    displayMerchantPaymentInfo(actualUserInput);
    displayCashbackSites(actualUserInput);
    displayReferralLink(actualUserInput);

    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 計算 coupon 的實際回饋率（支援固定+分級回饋率）
async function calculateCouponRate(coupon, card) {
    let rate = coupon.rate;

    // 如果不是 CUBE 卡，直接返回原始 rate
    if (card.id !== 'cathay-cube') {
        return typeof rate === 'number' ? rate : parseFloat(rate);
    }

    // 如果 rate 不是字串，直接返回數字（向下相容）
    if (typeof rate !== 'string') {
        return rate;
    }

    // 取得用戶的 Level 設定
    const { data: levelSettings } = await resolveCardLevel(card, 'Level 1');

    // 處理純 "specialRate" 或 "generalRate" 的情況
    if (rate === 'specialRate') {
        return levelSettings.specialRate || 0;
    }
    if (rate === 'generalRate') {
        return levelSettings.generalRate || 0;
    }

    // 處理 "數字+變數" 的情況（例如 "4.5+specialRate"）
    if (rate.includes('+')) {
        const parts = rate.split('+');
        const fixedRate = parseFloat(parts[0].trim());
        const variableType = parts[1].trim();

        let variableRate = 0;
        if (variableType === 'specialRate') {
            variableRate = levelSettings.specialRate || 0;
        } else if (variableType === 'generalRate') {
            variableRate = levelSettings.generalRate || 0;
        }

        return fixedRate + variableRate;
    }

    // 如果都不是，當成固定數字處理
    return parseFloat(rate);
}

// ========== Placeholder 解析（{rate}、{cap}、{rate_1}、{overseasBonusRate} 等任意欄位）==========
// 三個 parse 函數共用這一個 placeholder 抽取邏輯（原本正則寫了 3 遍）。
// 從 "{欄位名}" 字串取出欄位名，不是 placeholder 格式則回 null。
function extractPlaceholderField(value) {
    if (typeof value !== 'string') return null;
    const m = value.match(/^\{(.+)\}$/);
    return m ? m[1] : null;
}

// 解析 cashbackRates 中的 rate 值（支援數字、{specialRate}、{rate} 等任意 placeholder）
// 註：2026-07 起改為同步函數（原本標成 async 但內部沒有任何非同步操作），
// 既有的 `await parseCashbackRate(...)` 呼叫方式仍完全相容。
function parseCashbackRate(rate, card, levelSettings) {
    // 如果是數字，直接返回
    if (typeof rate === 'number') {
        return rate;
    }

    // 處理 {placeholder} 格式（支援任意欄位名稱）
    const fieldName = extractPlaceholderField(rate);
    if (fieldName) {
        // 只有 hasLevels 的卡片才支援 placeholder
        if (card.hasLevels && levelSettings && levelSettings[fieldName] !== undefined) {
            return levelSettings[fieldName];
        }
        console.warn(`⚠️ ${card.name}: {${fieldName}} 需要 hasLevels=true 且 levelSettings 中有 ${fieldName}`);
        return 0;
    }

    // 其他情況當成數字處理
    return parseFloat(rate);
}

// 同步版本的 rate 解析（用於排序，不需要 card 物件、不顯示警告）
function parseCashbackRateSync(rate, levelData) {
    if (typeof rate === 'number') {
        return rate;
    }

    const fieldName = extractPlaceholderField(rate);
    if (fieldName) {
        return levelData?.[fieldName] || 0;
    }

    return parseFloat(rate) || 0;
}

// 解析 cashbackRates 中的 cap 值（支援數字和 {cap}、{cap_1} 等任意 placeholder）
// 與 rate 的差異：無效值回傳 null（代表無上限），不是 0
function parseCashbackCap(cap, card, levelSettings) {
    // 如果是數字，直接返回
    if (typeof cap === 'number') {
        return cap;
    }

    // 如果是 undefined 或 null，返回 null
    if (cap === undefined || cap === null) {
        return null;
    }

    // 處理 {placeholder} 格式（支援任意欄位名稱）
    const fieldName = extractPlaceholderField(cap);
    if (fieldName) {
        // 只有 hasLevels 的卡片才支援 placeholder
        if (card.hasLevels && levelSettings && levelSettings[fieldName] !== undefined) {
            return levelSettings[fieldName];
        }
        console.warn(`⚠️ ${card.name}: {${fieldName}} 需要 hasLevels=true 且 levelSettings 中有 ${fieldName}`);
        return null;
    }

    // 其他情況當成數字處理
    const parsed = parseInt(cap);
    return isNaN(parsed) ? null : parsed;
}

// Display coupon cashback results
async function displayCouponCashbacks(amount, merchantValue) {
    couponResultsContainer.innerHTML = '';

    // Get cards to check (user selected or all)
    const cardsToCheck = getCardsForComparison();

    // Collect all coupon cashbacks that match the merchant
    const matchingCoupons = [];

    // Pre-compute search variants once (含 fuzzy 別名，e.g. "711" → ["711","7-eleven"])
    const searchVariants = getAllSearchVariants(merchantValue);

    for (const card of cardsToCheck) {
        if (card.couponCashbacks) {
            for (const coupon of card.couponCashbacks) {
                // Split merchant string into array of individual merchants
                const merchantItems = coupon.merchant.split(',').map(m => m.trim());

                // Find all matching merchant items
                const matchedMerchants = [];
                for (const item of merchantItems) {
                    const itemLower = item.toLowerCase();
                    // itemLower.includes(term): 項目包含搜尋詞（允許）
                    // term ⊇ item: 用詞彙邊界判斷，避免 "singapore" 誤含 "gap"
                    if (searchVariants.some(term =>
                        itemLower.includes(term) || termContainsItemWithBoundary(term, itemLower)
                    )) {
                        matchedMerchants.push(item);
                    }
                }

                // If any merchants matched, add this coupon
                if (matchedMerchants.length > 0) {
                    // 計算實際回饋率（支援分級）
                    const actualRate = await calculateCouponRate(coupon, card);

                    // Apply couponCap: within-cap amount uses the coupon rate,
                    // spending beyond the cap earns the card's basic cashback rate.
                    const capNum = parseFloat(coupon.cap);
                    let potentialCashback;
                    let calculationLayers = null;

                    if (capNum && capNum > 0 && amount > capNum) {
                        const withinCapAmount = capNum;
                        const overflowAmount = amount - capNum;
                        const couponCashback = Math.floor(withinCapAmount * actualRate / 100);
                        // 領券活動的溢出直接用 basicCashback（與 getOverflowRate 現值等價，
                        // 不共用只是避免對 helper 的依賴；領券商家都是國內實體/電商通路）
                        const overflowRate = card.basicCashback || 0;
                        const overflowCashback = Math.floor(overflowAmount * overflowRate / 100);
                        potentialCashback = couponCashback + overflowCashback;
                        calculationLayers = [
                            { name: '領券活動', rate: actualRate, applicableAmount: withinCapAmount, cashback: couponCashback, cap: capNum },
                            { name: '基本回饋', rate: overflowRate, applicableAmount: overflowAmount, cashback: overflowCashback, cap: null }
                        ];
                    } else {
                        potentialCashback = Math.floor(amount * actualRate / 100);
                        calculationLayers = [
                            { name: '領券活動', rate: actualRate, applicableAmount: amount, cashback: potentialCashback, cap: (capNum && capNum > 0) ? capNum : null }
                        ];
                    }

                    matchingCoupons.push({
                        ...coupon,
                        cardName: card.name,
                        cardId: card.id,
                        actualRate: actualRate, // 儲存計算後的實際回饋率
                        potentialCashback: potentialCashback,
                        calculationLayers: calculationLayers,
                        matchedMerchants: matchedMerchants // Store matched merchants
                    });
                }
            }
        }
    }
    
    // If no matching coupons, hide the section
    if (matchingCoupons.length === 0) {
        couponResultsSection.style.display = 'none';
        return;
    }
    
    // Sort by cashback rate (highest first)
    matchingCoupons.sort((a, b) => b.actualRate - a.actualRate);

    // Display coupon results using DocumentFragment
    const fragment = document.createDocumentFragment();
    matchingCoupons.forEach(coupon => {
        const couponElement = createCouponResultElement(coupon, amount);
        fragment.appendChild(couponElement);
    });
    couponResultsContainer.appendChild(fragment);

    couponResultsSection.style.display = 'block';
}

// Display parking benefits
function displayParkingBenefits(merchantValue, cardsToCheck, searchKeywords = null) {
    // Check if benefits data exists
    if (!cardsData || !cardsData.benefits || cardsData.benefits.length === 0) {
        return;
    }

    // Determine search terms to use (含 fuzzy 別名展開)
    const searchTerms = searchKeywords
        ? [...new Set(searchKeywords.flatMap(k => getAllSearchVariants(k)))]
        : getAllSearchVariants(merchantValue);

    if (searchKeywords) {
        console.log(`🅿️ 使用快捷搜尋關鍵詞匹配停車折抵: [${searchTerms.join(', ')}]`);
    } else {
        console.log(`🅿️ 使用輸入值匹配停車折抵: "${searchTerms[0]}"`);
    }

    const matchingBenefits = [];

    // Find matching benefits
    for (const benefit of cardsData.benefits) {
        // Skip inactive benefits
        if (!benefit.active) continue;

        // Check if merchants match using any search term
        if (benefit.merchants && Array.isArray(benefit.merchants)) {
            for (const merchant of benefit.merchants) {
                const merchantItemLower = merchant.toLowerCase();

                // 注意：停車的商家名稱是長描述字串、關鍵詞常在中間（如「中興嘟嘟房」⊇「嘟嘟房」、
                // 「全台遠東百貨停車」⊇「遠東」），因此這裡刻意用 substring 而非 startsWith，
                // 否則會漏掉大量停車場。停車資料皆為台灣停車場專名，誤匹配風險低。
                const isMatch = searchTerms.some(searchTerm =>
                    searchTerm.includes(merchantItemLower) || merchantItemLower.includes(searchTerm)
                );

                if (isMatch) {
                    // Check if this card is in the user's selection
                    const shouldShow = !currentUser || cardsToCheck.some(card => card.id === benefit.id);

                    if (shouldShow) {
                        matchingBenefits.push({
                            ...benefit,
                            matchedMerchant: merchant
                        });
                    }
                    break; // Found a match for this benefit, move to next
                }
            }
        }
    }

    // If no matches, hide the section
    const parkingSection = document.getElementById('parking-benefits-section');
    const parkingContainer = document.getElementById('parking-benefits-container');

    if (matchingBenefits.length === 0) {
        if (parkingSection) parkingSection.style.display = 'none';
        return;
    }

    // Display parking benefits
    if (!parkingContainer) {
        console.error('❌ parking-benefits-container 元素不存在');
        return;
    }

    parkingContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    matchingBenefits.forEach(benefit => {
        const benefitElement = createParkingBenefitElement(benefit);
        fragment.appendChild(benefitElement);
    });

    parkingContainer.appendChild(fragment);
    if (parkingSection) parkingSection.style.display = 'block';
}

// ==========================================
// New Cardholder Promos (search results)
// ==========================================

// Toggle state shared by desktop + mobile checkboxes
let showCardholderPromos = false;

// Wire both desktop and mobile checkboxes; keep them in sync.
// Help popup is shown via CSS (:hover or :focus-within on .promo-help-wrap).
// On touch, tapping outside the wrap blurs the help button so the popup hides.
function setupCardholderPromoToggle() {
    // 2026-07-12 版面重整後桌機/手機共用同一個 checkbox（保留陣列形式與同步邏輯以防未來再分裝置）
    const ids = ['show-promos-checkbox'];
    const onChange = (e) => {
        showCardholderPromos = e.target.checked;
        // Sync the other checkbox so both stay in lockstep
        ids.forEach(id => {
            const cb = document.getElementById(id);
            if (cb && cb !== e.target) cb.checked = showCardholderPromos;
        });
        // Don't auto-recompute — toggle is part of setup, user clicks
        // "計算回饋" to apply.
    };
    ids.forEach(id => {
        const cb = document.getElementById(id);
        if (cb) cb.addEventListener('change', onChange);
    });

    // Help: click '?' toggles a floating text panel (overlay, doesn't push layout).
    // 一次只開一個說明——開新的先收舊的；點面板外任意處也會收合
    const inlineHelpBtns = [...document.querySelectorAll('.promo-help-inline')];
    const closeAllInlineHelp = () => {
        inlineHelpBtns.forEach(btn => {
            const t = document.getElementById(btn.getAttribute('data-help-target'));
            if (t && !t.hasAttribute('hidden')) {
                t.setAttribute('hidden', '');
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    };
    inlineHelpBtns.forEach(btn => {
        const targetId = btn.getAttribute('data-help-target');
        const text = targetId && document.getElementById(targetId);
        if (!text) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const wasHidden = text.hasAttribute('hidden');
            closeAllInlineHelp();
            text.toggleAttribute('hidden', !wasHidden);
            btn.setAttribute('aria-expanded', String(wasHidden));
        });
    });
    if (inlineHelpBtns.length > 0) {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.promo-help-text')) closeAllInlineHelp();
        });
    }

    // Desktop help: hover '?' shows a native popover (top-layer, escapes z-index).
    const popoverSupported = typeof HTMLElement.prototype.showPopover === 'function';
    document.querySelectorAll('.promo-help-hover').forEach(btn => {
        const popupId = btn.getAttribute('data-help-target');
        const popup = popupId && document.getElementById(popupId);
        if (!popup) return;

        const positionPopup = () => {
            const rect = btn.getBoundingClientRect();
            popup.style.position = 'fixed';
            popup.style.top = `${rect.bottom + 4}px`;
            popup.style.left = `${rect.left}px`;
            const popupRect = popup.getBoundingClientRect();
            const overflow = popupRect.right - window.innerWidth;
            if (overflow > 0) {
                popup.style.left = `${Math.max(8, rect.left - overflow - 8)}px`;
            }
        };

        const open = () => {
            if (popoverSupported && !popup.matches(':popover-open')) {
                try { popup.showPopover(); positionPopup(); } catch (e) { /* ignore */ }
            }
        };
        const close = () => {
            if (popoverSupported && popup.matches(':popover-open')) {
                try { popup.hidePopover(); } catch (e) { /* ignore */ }
            }
        };

        let leaveTimer = null;
        const cancelLeave = () => { if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; } };
        const scheduleHide = () => {
            cancelLeave();
            leaveTimer = setTimeout(close, 80);
        };

        btn.addEventListener('mouseenter', () => { cancelLeave(); open(); });
        btn.addEventListener('mouseleave', scheduleHide);
        popup.addEventListener('mouseenter', cancelLeave);
        popup.addEventListener('mouseleave', scheduleHide);
        popup.addEventListener('toggle', (e) => {
            if (e.newState === 'open') positionPopup();
        });
    });
}

// Parse a rate string like "5%" or "+3%" into a decimal (0.05).
// Expand a search term to include fuzzy aliases (e.g., 'linepay' ↔ 'line pay').
function expandSearchTerm(term) {
    const t = String(term || '').toLowerCase().trim();
    if (!t) return [];
    const variants = new Set([t]);
    // Forward map: t → mapped
    if (typeof fuzzySearchMap !== 'undefined' && fuzzySearchMap[t]) {
        variants.add(String(fuzzySearchMap[t]).toLowerCase());
    }
    // Reverse map: any key whose value is t
    if (typeof fuzzySearchMap !== 'undefined') {
        Object.entries(fuzzySearchMap).forEach(([k, v]) => {
            if (String(v).toLowerCase() === t) variants.add(k.toLowerCase());
        });
    }
    return Array.from(variants);
}

// Does a promo's bonus_merchants list match the current search term/keywords?
// Returns true for *all_items if the card has any cashbackRate item matching the search.
function promoMerchantsMatchSearch(promo, card, merchantValue, quickKeywords) {
    if (!promo.bonus_merchants) return false;

    // Build the list of search terms (lowercased + fuzzy variants)
    const rawTerms = [];
    if (Array.isArray(quickKeywords) && quickKeywords.length > 0) {
        quickKeywords.forEach(k => { if (k) rawTerms.push(k); });
    } else if (merchantValue) {
        rawTerms.push(merchantValue);
    }
    if (rawTerms.length === 0) return false;
    const terms = rawTerms.flatMap(expandSearchTerm);
    if (terms.length === 0) return false;

    // Resolve actual merchants list (handles *all_items)
    const merchants = expandPromoMerchants(promo, card);
    if (!merchants || merchants.length === 0) return false;

    // Substring match either way (also against each merchant's fuzzy variants)
    return merchants.some(m => {
        const ml = String(m).toLowerCase();
        const mlVariants = expandSearchTerm(ml);
        return terms.some(t => mlVariants.some(mv => mv.includes(t) || t.includes(mv)));
    });
}

// Format bonus_rate for display: handle both '10%' strings and 0.1 decimals
// (Google Sheets percentage cells come through Apps Script as decimal numbers).
// Convert a promo bonus_rate to a decimal multiplier (0.1 for 10%).
// Accepts numbers (0.1 or 10) or strings ("10%", "10", "0.1").
function promoBonusRateToDecimal(rate) {
    if (rate == null || rate === '') return null;
    let n;
    if (typeof rate === 'number') {
        n = rate;
    } else {
        const s = String(rate).trim().replace('%', '');
        n = parseFloat(s);
    }
    if (isNaN(n)) return null;
    return n < 1 ? n : n / 100;
}

// Compute bonus cashback amount for a promo given the consumption amount.
// bonus_cap is a spend cap (回饋消費上限): spend above the cap earns only the
// card's basicCashback rate, matching how regular / designated-merchant rewards
// are calculated elsewhere.
function computePromoBonusAmount(promo, card, amount) {
    const rate = promoBonusRateToDecimal(promo.bonus_rate);
    if (rate == null || rate <= 0) return null;
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) return null;
    const hasCap = typeof promo.bonus_cap === 'number' && !isNaN(promo.bonus_cap);
    const cap = hasCap ? Number(promo.bonus_cap) : Infinity;
    const eligibleSpend = Math.min(amt, cap);
    const excessSpend = Math.max(0, amt - cap);
    const basicRate = (card && typeof card.basicCashback === 'number') ? card.basicCashback / 100 : 0;
    const cashback = eligibleSpend * rate + excessSpend * basicRate;
    return Math.round(cashback);
}

function formatBonusRate(rate) {
    if (rate == null || rate === '') return '';
    if (typeof rate === 'number') {
        // Decimal like 0.1 → '10%'; values >=1 treated as already-percentage (10 → '10%')
        const pct = rate < 1 ? rate * 100 : rate;
        const formatted = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
        return `${formatted}%`;
    }
    const s = String(rate).trim();
    if (!s) return '';
    if (s.includes('%')) return s;
    const n = parseFloat(s);
    if (!isNaN(n)) {
        const pct = n < 1 ? n * 100 : n;
        const formatted = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
        return `${formatted}%`;
    }
    return s;
}

// Build the highlighted detail rows for a single promo.
// Each row: { label, value, extra? }. 'value' renders with .cashback-amount;
// 'extra' (e.g. voucher_usage) renders inline in default colour next to value.
function buildPromoDetailRows(promo, card, amount, bonusApplies) {
    const rows = [];

    if (promo.gift_content) {
        rows.push({ label: '首刷禮', value: promo.gift_content, multiline: true });
    }

    if (promo.voucher_amount) {
        rows.push({
            label: '定額回饋',
            value: `NT$${Math.round(Number(promo.voucher_amount)).toLocaleString()}`,
            extra: promo.voucher_usage || ''
        });
    }

    if (bonusApplies && (promo.bonus_rate != null && promo.bonus_rate !== '')) {
        rows.push({ label: '回饋率', value: formatBonusRate(promo.bonus_rate) });
    }

    return rows;
}

// Does a card match the current merchant search? (used to decide whether to
// show its promos at all). A card matches if any of its cashbackRates items
// substring-matches the search term or any quick-search keyword.
// Render new cardholder promos below the regular results.
// Filters: card in cardsInComparison, NOT in myOwnedCards, has matching active promo.
function displayCardholderPromos(merchantValue, amount, quickKeywords) {
    const section = document.getElementById('cardholder-promos-section');
    const container = document.getElementById('cardholder-promos-container');
    if (!section || !container) return;

    container.innerHTML = '';

    if (!showCardholderPromos) {
        section.style.display = 'none';
        return;
    }

    if (!cardsData || !cardsData.newCardholderPromos || cardsData.newCardholderPromos.length === 0) {
        section.style.display = 'none';
        return;
    }

    // Candidate cards: in comparison AND not owned. Whether each promo
    // shows is decided by promoMerchantsMatchSearch below.
    const candidateCards = getCardsForComparison().filter(c => !myOwnedCards.has(c.id));

    const fragment = document.createDocumentFragment();
    let renderedCount = 0;

    candidateCards.forEach(card => {
        const promos = getActiveCardholderPromos(card.id);
        if (promos.length === 0) return;

        promos.forEach(promo => {
            // Strict rule: only show a promo if its bonus_merchants matches
            // the current search (incl. fuzzy aliases and *all_items expansion).
            if (!promoMerchantsMatchSearch(promo, card, merchantValue, quickKeywords)) return;

            // Build highlight rows (gift / voucher / bonus_rate); skip if empty.
            const rows = buildPromoDetailRows(promo, card, amount, true);
            if (rows.length === 0) return;

            // Identify which merchants from bonus_merchants actually matched the search
            const rawTerms = (Array.isArray(quickKeywords) && quickKeywords.length > 0)
                ? quickKeywords
                : [merchantValue || ''];
            const expandedTerms = rawTerms.flatMap(expandSearchTerm);
            const matchedMerchants = expandPromoMerchants(promo, card).filter(m => {
                const ml = String(m).toLowerCase();
                const mlVariants = expandSearchTerm(ml);
                return expandedTerms.some(t => mlVariants.some(mv => mv.includes(t) || t.includes(mv)));
            });

            const el = createCardholderPromoElement(card, promo, rows, matchedMerchants, { amount });
            fragment.appendChild(el);
            renderedCount++;
        });
    });

    if (renderedCount === 0) {
        section.style.display = 'none';
        return;
    }

    container.appendChild(fragment);
    section.style.display = 'block';
}

// Build the DOM element for a single cardholder promo result.
// Display order:
//   (卡名) → new_customer_summary → 重點 detail rows + 回饋消費上限(若有)
//   → 匹配項目 + 活動期間 (small, .matched-merchant style)
// Reuses .card-result / .card-details / .detail-item for visual parity.
// opts.hideCardName: omit the card name (used on the card detail page where
// the modal title already shows the card name).
function createCardholderPromoElement(card, promo, rows, matchedMerchants, opts = {}) {
    const el = document.createElement('div');
    el.className = 'card-result cardholder-promo-item fade-in';

    // First-spend gift image (detail page only): show when this is a 贈品 promo
    // and an image URL is provided in the sheet. Desktop floats it to the right;
    // mobile drops it full-width between the summary and the detail rows.
    const giftImageHtml = (opts.showExtras
        && Array.isArray(promo.promo_types) && promo.promo_types.some(t => t === '贈品' || t === '首刷禮')
        && promo.gift_image_url)
        ? `<img class="promo-gift-image" src="${escapeHtml(promo.gift_image_url)}" alt="首刷禮圖片" loading="lazy" onerror="this.style.display='none'">`
        : '';
    if (giftImageHtml) el.className += ' has-gift';

    const summary = promo.new_customer_summary || '';

    const period = (promo.period_start || promo.period_end)
        ? `${promo.period_start || ''}${promo.period_start && promo.period_end ? '~' : (promo.period_end ? '~' : '')}${promo.period_end || ''}`.trim()
        : '不限期';

    // Upcoming / ending-soon badges (same logic as card activities)
    // promo dates are already ISO YYYY-MM-DD; fall back to slash-to-ISO conversion
    let promoBadgeHtml = '';
    const isoStart = promo.period_start
        ? (promo.period_start.includes('-') ? promo.period_start : slashDateToISO(promo.period_start))
        : '';
    const isoEnd = promo.period_end
        ? (promo.period_end.includes('-') ? promo.period_end : slashDateToISO(promo.period_end))
        : '';
    const promoStatus = getRateStatus(isoStart, isoEnd);
    if (promoStatus === 'upcoming' && isoStart) {
        const daysUntil = getDaysUntilStart(isoStart);
        if (daysUntil != null) {
            const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
            promoBadgeHtml = ` <span class="upcoming-badge">即將開始 (${daysText})</span>`;
        }
    } else if (promoStatus === 'active' && isoEnd && isEndingSoon(isoEnd, 14)) {
        const daysUntil = getDaysUntilEnd(isoEnd);
        if (daysUntil != null) {
            const daysText = daysUntil === 0 ? '今天截止' : `剩 ${daysUntil} 天`;
            promoBadgeHtml = ` <span class="ending-soon-badge">${daysText}</span>`;
        }
    }

    const merchantsText = matchedMerchants && matchedMerchants.length > 0
        ? matchedMerchants.join('、')
        : '不限通路';

    const renderRow = (r) => `
        <div class="detail-item">
            <div class="detail-label">${escapeHtml(r.label)}</div>
            <div class="detail-value">
                <span class="cashback-amount">${r.multiline ? escapeHtmlMultiline(r.value) : escapeHtml(r.value)}</span>${r.extra ? ' ' + escapeHtml(r.extra) : ''}
            </div>
        </div>
    `;
    const renderPlainRow = (label, value) => `
        <div class="detail-item">
            <div class="detail-label">${escapeHtml(label)}</div>
            <div class="detail-value">${escapeHtml(value)}</div>
        </div>
    `;

    // Group rows: gift / voucher are full-width; bonus_rate pairs side-by-side
    // with the bonus_cap row when both exist.
    const bonusRateRow = rows.find(r => r.label === '回饋率');
    const fullWidthRows = rows.filter(r => r !== bonusRateRow);
    const hasCap = typeof promo.bonus_cap === 'number' && !isNaN(promo.bonus_cap);
    const capValue = hasCap ? `NT$${Math.round(Number(promo.bonus_cap)).toLocaleString()}` : '';

    // Search-result mode: compute and show the bonus cashback amount between rate and cap.
    const showAmount = !opts.showExtras && bonusRateRow;
    let amountRowHtml = '';
    if (showAmount) {
        const amt = computePromoBonusAmount(promo, card, opts.amount);
        if (amt != null) {
            amountRowHtml = `
                <div class="detail-item">
                    <div class="detail-label">回饋金額</div>
                    <div class="detail-value"><span class="cashback-amount">NT$${amt.toLocaleString()}</span></div>
                </div>`;
        }
    }

    const fullWidthHtml = fullWidthRows.map(renderRow).join('');
    let bonusGroupHtml = '';
    if (bonusRateRow && hasCap) {
        bonusGroupHtml = `<div class="promo-bonus-row">
            ${renderRow(bonusRateRow)}
            ${amountRowHtml}
            ${renderPlainRow('回饋消費上限', capValue)}
        </div>`;
    } else if (bonusRateRow) {
        bonusGroupHtml = renderRow(bonusRateRow) + amountRowHtml;
    } else if (hasCap) {
        bonusGroupHtml = renderPlainRow('回饋消費上限', capValue);
    }

    const highlightRowsHtml = fullWidthHtml + bonusGroupHtml;
    const capRowHtml = '';  // already merged into bonusGroupHtml above

    // Detail page shows extra context (notes); search results don't
    const notesHtml = (opts.showExtras && promo.notes)
        ? `<div class="matched-merchant">備註: ${escapeHtml(promo.notes)}</div>`
        : '';

    // Promo type chips — always an inline chips row under the header.
    // (右上角 corner chip 已於 2026-07-15 移除：手機上會和卡名旁的馬上辦卡 pill 重疊)
    let chipsHtml = '';
    if (Array.isArray(promo.promo_types) && promo.promo_types.length > 0) {
        const chips = promo.promo_types
            .map(t => `<span class="promo-type-chip promo-type-${promoTypeClass(t)}">${escapeHtml(t)}</span>`)
            .join('');
        chipsHtml = `<div class="promo-type-chips">${chips}</div>`;
    }

    // Apply CTA link (search results only) — small "馬上辦卡" pill next to card name
    let applyCtaBtnHtml = '';
    if (!opts.showExtras) {
        const applyCta = cardsData && cardsData.cardApplyCtas && cardsData.cardApplyCtas[card.id];
        if (applyCta && applyCta.link) {
            applyCtaBtnHtml = `<a class="promo-apply-cta-btn" href="${escapeHtml(applyCta.link)}" target="_blank" rel="noopener noreferrer" data-card-id="${escapeHtml(card.id)}" data-card-name="${escapeHtml(card.name)}">馬上辦卡<svg class="promo-apply-cta-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><path d="M8 1h3v3"/><path d="M11 1 6 6"/></svg></a>`;
        }
    }

    const cardHeaderHtmlWithCta = opts.hideCardName ? '' : `
        <div class="card-header">
            <div class="card-name-with-pin">
                <h3 class="card-name">${escapeHtml(card.name)}</h3>
                <button type="button" class="card-detail-peek-btn" data-card-id="${escapeHtml(card.id)}" aria-label="查看卡片詳情" title="查看卡片詳情">ⓘ</button>
                ${applyCtaBtnHtml}
            </div>
        </div>`;

    el.innerHTML = `
        ${cardHeaderHtmlWithCta}
        ${chipsHtml}
        ${summary ? `<div class="promo-summary">${escapeHtml(summary)}</div>` : ''}
        ${giftImageHtml}
        <div class="card-details">
            ${highlightRowsHtml}
            ${capRowHtml}
        </div>
        ${promo.promo_condition ? `<div class="matched-merchant promo-condition"><div class="promo-condition-label">達成條件:</div><div class="promo-condition-text">${escapeHtmlMultiline(promo.promo_condition)}</div></div>` : ''}
        <div class="matched-merchant">匹配項目: <strong>${escapeHtml(merchantsText)}</strong></div>
        <div class="matched-merchant">活動期間: ${escapeHtml(period)}${promoBadgeHtml}</div>
        ${notesHtml}
    `;
    return el;
}

// Map a promo type label (贈品 / 回饋加碼 / 定額抵用) to a CSS modifier
function promoTypeClass(label) {
    if (label === '贈品' || label === '首刷禮') return 'gift';
    if (label === '回饋加碼') return 'bonus';
    if (label === '定額抵用' || label === '定額回饋') return 'voucher';
    return 'default';
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Like escapeHtml but preserves manual line breaks (Alt+Enter in Sheets ->
// \n) by converting them to <br>. Use for free-text fields that should keep
// their multi-line formatting (gift_content, promo_condition).
function escapeHtmlMultiline(s) {
    return escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>');
}

// 外部連結防護：只允許 http/https 開頭的網址，杜絕 javascript: 等危險 scheme
// 被塞進 href（連結值來自 Google Sheets 資料，多一層保險）。不合法時回傳空字串，
// 呼叫端拿到空字串就不要渲染該連結。
function sanitizeUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

// Sticky nav inside the card detail modal: hide buttons whose section is
// missing or empty, smooth-scroll on click, highlight active section.
let _cardDetailNavObserver = null;
function setupCardDetailNav(modalContent) {
    const nav = document.getElementById('card-detail-nav');
    if (!nav || !modalContent) return;

    const buttons = Array.from(nav.querySelectorAll('.card-detail-nav-btn'));

    // Disconnect any prior observer (modal opens once per card, but be safe)
    if (_cardDetailNavObserver) {
        _cardDetailNavObserver.disconnect();
        _cardDetailNavObserver = null;
    }

    // Hide buttons whose section is missing, has display:none, or has no real content
    const visibleSections = [];
    buttons.forEach(btn => {
        const id = btn.dataset.section;
        const section = id && document.getElementById(id);
        const hasContent = section && section.offsetParent !== null && section.textContent.trim().length > 0;
        btn.hidden = !hasContent;
        btn.classList.remove('active');
        if (hasContent) visibleSections.push({ btn, section });
    });

    if (visibleSections.length === 0) return;

    // While a click-initiated smooth scroll runs, scroll events must NOT
    // recompute the highlight: the target lands 8px below the nav (or the
    // scroll clamps at the bottom for short trailing sections), so a
    // position-based recompute would light up the PREVIOUS section instead
    // of the clicked one. The clicked button is highlighted immediately and
    // suppression lifts shortly after scroll events stop arriving.
    let suppressScrollHighlight = false;
    let scrollSettleTimer = null;
    const armScrollSettleTimer = (ms) => {
        clearTimeout(scrollSettleTimer);
        scrollSettleTimer = setTimeout(() => { suppressScrollHighlight = false; }, ms);
    };

    // Click → smooth-scroll the modal-content so section sits just under the sticky nav
    buttons.forEach(btn => {
        btn.onclick = () => {
            const section = document.getElementById(btn.dataset.section);
            if (!section) return;
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            suppressScrollHighlight = true;
            // Fallback release in case no scroll event fires (already at target)
            armScrollSettleTimer(400);
            // Rect-based delta (same basis as updateActive) so the section's
            // heading lands just below the sticky nav, not hidden under it.
            // offsetTop was relative to the wrong offsetParent and overshot on mobile.
            const navHeight = nav.offsetHeight;
            const containerTop = modalContent.getBoundingClientRect().top;
            const sectionTop = section.getBoundingClientRect().top;
            const delta = sectionTop - containerTop - navHeight - 8;
            modalContent.scrollTo({ top: modalContent.scrollTop + delta, behavior: 'smooth' });
        };
    });

    // Highlight the section currently in view (whichever is closest to the
    // top of the scroll viewport, accounting for the sticky nav height).
    // The detection line (nav + 12px) sits BELOW the click landing point
    // (nav + 8px): a section a nav button just scrolled to must count as
    // past the line, otherwise the previous section stays highlighted.
    const updateActive = () => {
        const navHeight = nav.offsetHeight;
        const containerTop = modalContent.getBoundingClientRect().top;
        let current = visibleSections[0];
        for (const s of visibleSections) {
            const top = s.section.getBoundingClientRect().top - containerTop - navHeight - 12;
            if (top <= 0) current = s;
            else break;
        }
        // 捲到底時，尾端的短區塊永遠碰不到判定線——此時點亮最後一個可見區塊
        if (modalContent.scrollTop + modalContent.clientHeight >= modalContent.scrollHeight - 2) {
            current = visibleSections[visibleSections.length - 1];
        }
        buttons.forEach(b => b.classList.remove('active'));
        if (current) current.btn.classList.add('active');
    };

    // Throttle scroll handler with rAF
    let ticking = false;
    const onScroll = () => {
        if (suppressScrollHighlight) {
            armScrollSettleTimer(150);
            return;
        }
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { updateActive(); ticking = false; });
    };
    modalContent.removeEventListener('scroll', modalContent._cardDetailNavScroll || (() => {}));
    modalContent._cardDetailNavScroll = onScroll;
    modalContent.addEventListener('scroll', onScroll, { passive: true });

    // Initial active state
    updateActive();
}

// Render new cardholder promos in the card detail modal.
// Hidden entirely (header included) when user owns this card.
function renderCardDetailPromos(card) {
    const section = document.getElementById('card-promos-section');
    const content = document.getElementById('card-promos-content');
    if (!section || !content) return;

    content.innerHTML = '';

    // Regulatory warning sits above the 新戶活動 heading; hidden until we
    // actually render promo cards below.
    const disclaimerEl = document.getElementById('card-promo-disclaimer');
    if (disclaimerEl) disclaimerEl.style.display = 'none';

    const promos = getActiveCardholderPromos(card.id);
    const applyCta = cardsData && cardsData.cardApplyCtas && cardsData.cardApplyCtas[card.id];
    const hasCta = !!(applyCta && (applyCta.text || applyCta.link));

    if (promos.length === 0 && !hasCta) {
        section.style.display = 'none';
        return;
    }

    // Render apply CTA (text + button) above the promo cards.
    if (hasCta) {
        const ctaEl = document.createElement('div');
        ctaEl.className = 'card-apply-cta';
        const textSpan = document.createElement('span');
        textSpan.className = 'card-apply-cta-text';
        textSpan.textContent = applyCta.text || '';
        ctaEl.appendChild(textSpan);
        // SVG arrow keeps the glyph identical across OS / fonts.
        const arrow = document.createElement('span');
        arrow.className = 'card-apply-cta-arrow';
        arrow.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h12M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        ctaEl.appendChild(arrow);
        if (applyCta.link) {
            const btn = document.createElement('a');
            btn.className = 'card-apply-cta-btn';
            btn.href = applyCta.link;
            btn.target = '_blank';
            btn.rel = 'noopener noreferrer';
            btn.textContent = '立即申辦';
            btn.dataset.cardId = card.id;
            btn.dataset.cardName = card.name;
            ctaEl.appendChild(btn);
        }
        content.appendChild(ctaEl);
    }

    if (promos.length === 0) {
        // CTA-only case: nothing more to render but keep section visible.
        section.style.display = 'block';
        return;
    }

    // Use current amount-input value for bonus calculation; fall back to 1000.
    const amountInputEl = document.getElementById('amount-input');
    const amount = amountInputEl && amountInputEl.value !== '' ? parseFloat(amountInputEl.value) : 1000;

    const fragment = document.createDocumentFragment();

    promos.forEach(promo => {
        // In detail page, no merchant search context — show bonus regardless.
        const bonusApplies = !!promo.bonus_rate;

        const rows = buildPromoDetailRows(promo, card, amount, bonusApplies);
        if (rows.length === 0) return;

        // Show all bonus_merchants (or "本卡所有指定通路" for *all_items)
        let merchantList = [];
        if (promo.bonus_merchants) {
            if (isAllItemsMarker(promo.bonus_merchants)) {
                merchantList = ['本卡所有指定通路'];
            } else {
                merchantList = expandPromoMerchants(promo, card);
            }
        }

        const el = createCardholderPromoElement(card, promo, rows, merchantList, { hideCardName: true, showExtras: true });
        fragment.appendChild(el);
    });

    if (!fragment.hasChildNodes()) {
        if (hasCta) {
            section.style.display = 'block';
        } else {
            section.style.display = 'none';
        }
        return;
    }

    // Promo cards exist → reveal the warning above the 新戶活動 heading.
    if (disclaimerEl) disclaimerEl.style.display = 'block';

    content.appendChild(fragment);
    section.style.display = 'block';
}

// Create parking benefit element
function createParkingBenefitElement(benefit) {
    const benefitDiv = document.createElement('div');
    benefitDiv.className = 'parking-benefit-item fade-in';

    // Find card name
    const card = cardsData.cards.find(c => c.id === benefit.id);
    const cardName = card ? card.name : benefit.id;

    benefitDiv.innerHTML = `
        <div class="parking-header">
            <div class="parking-card-name">${cardName}</div>
        </div>
        <div class="parking-benefit-highlight">
            ${benefit.benefit_desc}
        </div>
        <div class="parking-details">
            <div class="parking-detail-item">
                <span class="parking-label">地點：</span>
                <span class="parking-value parking-merchants-highlight">${benefit.merchants.join('、')}</span>
            </div>
            <div class="parking-detail-item">
                <span class="parking-label">條件：</span>
                <span class="parking-value">${benefit.conditions || '無'}</span>
            </div>
            ${benefit.benefit_period ? `
            <div class="parking-detail-item">
                <span class="parking-label">期限：</span>
                <span class="parking-value">${benefit.benefit_period}</span>
            </div>
            ` : ''}
            ${benefit.notes ? `
            <div class="parking-detail-item">
                <span class="parking-label">備註：</span>
                <span class="parking-value">${benefit.notes}</span>
            </div>
            ` : ''}
        </div>
    `;

    return benefitDiv;
}

// Create coupon result element
function createCouponResultElement(coupon, amount) {
    const couponDiv = document.createElement('div');
    couponDiv.className = 'coupon-item fade-in';

    // Handle cap display - same as regular cards
    // Check if cap exists and is a valid number
    const capText = (coupon.cap && !isNaN(coupon.cap)) ? `NT$${Math.floor(Number(coupon.cap)).toLocaleString()}` : '無上限';

    // Debug log to check cap value
    if (coupon.merchant.includes('星巴克')) {
        console.log('星巴克 coupon cap:', coupon.cap, 'type:', typeof coupon.cap);
    }

    if (coupon.calculationLayers) {
        couponDiv.dataset.calcLayers = JSON.stringify(coupon.calculationLayers);
        couponDiv.dataset.calcAmount = amount;
    }

    couponDiv.innerHTML = `
        <div class="coupon-header">
            <div class="card-name-with-pin">
                <div class="coupon-merchant">${coupon.cardName}</div>
                <button type="button" class="card-detail-peek-btn" data-card-id="${escapeHtml(coupon.cardId)}" aria-label="查看卡片詳情" title="查看卡片詳情">ⓘ</button>
            </div>
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">回饋率</div>
                <div class="detail-value">${coupon.actualRate}%</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋金額</div>
                <div class="detail-value cashback-amount">
                    NT$${coupon.potentialCashback.toLocaleString()}
                    ${coupon.calculationLayers && coupon.calculationLayers.length > 0 ? `
                        <button type="button" class="calc-breakdown-btn" title="查看計算明細" aria-label="查看計算明細"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10.5" x2="8.01" y2="10.5"/><line x1="12" y1="10.5" x2="12.01" y2="10.5"/><line x1="16" y1="10.5" x2="16.01" y2="10.5"/><line x1="8" y1="14.5" x2="8.01" y2="14.5"/><line x1="12" y1="14.5" x2="12.01" y2="14.5"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg></button>
                    ` : ''}
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋消費上限</div>
                <div class="detail-value">${capText}</div>
            </div>
        </div>
        <div class="matched-merchant">
            條件: ${coupon.conditions}<br>匹配項目: <strong>${coupon.matchedMerchants ? coupon.matchedMerchants.join('、') : coupon.merchant}</strong>${coupon.period ? `<br>活動期間: ${coupon.period}` : ''}
        </div>
    `;

    return couponDiv;
}

// Create card result element
function createCardResultElement(result, originalAmount, searchedItem, isBest, isBasicCashback = false) {
    const cardDiv = document.createElement('div');
    const isUpcoming = result.isUpcoming === true;
    cardDiv.className = `card-result fade-in ${isBest ? 'best-card' : ''} ${result.cashbackAmount === 0 ? 'no-cashback' : ''} ${isUpcoming ? 'upcoming-activity' : ''}`;

    let capText = result.cap ? `NT$${Math.floor(result.cap).toLocaleString()}` : '無上限';
    // Special handling for Taishin Richart card cap display
    if (result.card.id === 'taishin-richart' && result.cap) {
        capText = `NT$${Math.floor(result.cap).toLocaleString()}+`;
    }
    const cashbackText = result.cashbackAmount > 0 ? 
                        `NT$${result.cashbackAmount.toLocaleString()}` : 
                        '無回饋';
    
    // All rates are already totaled, simply display the rate
    let rateDisplay = result.rate > 0 ? `${result.rate}%` : '0%';

    // Generate level label if card has levels and levelLabelFormat
    let levelLabel = '';
    if (result.card.hasLevels && result.card.levelLabelFormat && result.selectedLevel) {
        levelLabel = result.card.levelLabelFormat.replace('{level}', result.selectedLevel);
    }

    // Ending-soon badge (inline, next to period text)
    let endingSoonInlineBadge = '';
    if (!isUpcoming && result.periodEnd && isEndingSoon(result.periodEnd, 10)) {
        const daysUntil = getDaysUntilEnd(result.periodEnd);
        if (daysUntil != null) {
            const daysText = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : `${daysUntil}天後`;
            endingSoonInlineBadge = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }
    }

    // 檢查是否已釘選（使用 matchedItem）
    const merchantForPin = result.matchedItems && result.matchedItems.length > 0
        ? result.matchedItems.join('、')
        : result.matchedItem;
    const pinned = merchantForPin && !isBasicCashback ? isPinned(result.card.id, merchantForPin) : false;

    // Store layers for the breakdown button
    if (result.calculationLayers) {
        cardDiv.dataset.calcLayers = JSON.stringify(result.calculationLayers);
        cardDiv.dataset.calcAmount = originalAmount;
    }

    cardDiv.innerHTML = `
        <div class="card-header">
            <div class="card-name-with-pin">
                <div class="card-name">${result.card.name}</div>
                <button type="button" class="card-detail-peek-btn" data-card-id="${result.card.id}" aria-label="查看卡片詳情" title="查看卡片詳情">ⓘ</button>
                ${merchantForPin && !isBasicCashback ? `
                    <button class="pin-btn ${pinned ? 'pinned' : ''}"
                            data-card-id="${result.card.id}"
                            data-card-name="${result.card.name}"
                            data-merchant="${merchantForPin}"
                            data-rate="${result.rate}"
                            data-period-end="${result.periodEnd || ''}"
                            data-period-start="${result.periodStart || ''}"
                            title="${pinned ? '取消釘選' : '釘選此配對'}">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
            <div class="badges-container">
                ${isBest ? '<div class="best-badge">最優回饋</div>' : ''}
                ${isUpcoming && result.periodStart ? (() => {
                    const daysUntil = getDaysUntilStart(result.periodStart);
                    const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
                    return `<div class="upcoming-badge">即將開始 (${daysText})</div>`;
                })() : ''}
            </div>
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">回饋率</div>
                <div class="detail-value">${rateDisplay}${levelLabel ? `<br><small style="color: #6b7280; font-size: 12px; font-weight: normal;">(${levelLabel})</small>` : ''}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋金額</div>
                <div class="detail-value ${result.cashbackAmount > 0 ? 'cashback-amount' : 'no-cashback-text'}">
                    ${cashbackText}
                    ${result.calculationLayers && result.calculationLayers.length > 0 ? `
                        <button type="button" class="calc-breakdown-btn" title="查看計算明細" aria-label="查看計算明細"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10.5" x2="8.01" y2="10.5"/><line x1="12" y1="10.5" x2="12.01" y2="10.5"/><line x1="16" y1="10.5" x2="16.01" y2="10.5"/><line x1="8" y1="14.5" x2="8.01" y2="14.5"/><line x1="12" y1="14.5" x2="12.01" y2="14.5"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg></button>
                    ` : ''}
                </div>
                ${(() => {
    if (result.card.basicCashbackType) {
        const cashbackType = result.card.basicCashbackType;
        return `<div class="cashback-type-label">(${cashbackType})</div>`;
                    }
                    return '';
                })()}
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋消費上限</div>
                <div class="detail-value">${capText}</div>
            </div>
        </div>
        ${(() => {
            if (isBasicCashback && !isUpcoming) {
                let conditionsText = '';
                // Check if card has domesticBonusConditions
                if (result.card.domesticBonusConditions) {
                    conditionsText = `<br><small>條件: ${result.card.domesticBonusConditions}</small>`;
                }
                return `
                    <div class="matched-merchant">
                        一般消費回饋率${conditionsText}
                    </div>
                `;
            } else if (result.matchedItem) {
                let additionalInfo = '';

                // For upcoming activities, show period from result directly
                if (isUpcoming) {
                    if (result.period) {
                        additionalInfo += `<br><small>活動期間: ${result.period}</small>`;
                    } else if (result.periodStart && result.periodEnd) {
                        additionalInfo += `<br><small>活動期間: ${formatISODateForDisplay(result.periodStart)}~${formatISODateForDisplay(result.periodEnd)}</small>`;
                    }
                } else if (result.matchedRateGroup) {
                    // For active activities, use matchedRateGroup
                    const period = result.matchedRateGroup.period;
                    const conditions = result.matchedRateGroup.conditions;

                    if (period) additionalInfo += `<br><small>活動期間: ${period}${endingSoonInlineBadge}</small>`;
                    if (conditions) additionalInfo += `<br><small>條件: ${conditions}</small>`;
                } else if (endingSoonInlineBadge && result.periodEnd) {
                    const periodDisplay = result.periodStart
                        ? `${formatISODateForDisplay(result.periodStart)}~${formatISODateForDisplay(result.periodEnd)}`
                        : `~${formatISODateForDisplay(result.periodEnd)}`;
                    additionalInfo += `<br><small>活動期間: ${periodDisplay}${endingSoonInlineBadge}</small>`;
                }
                
                const categoryInfo = result.matchedCategory ? ` (類別: ${getCategoryDisplayName(result.matchedCategory)})` : '';
                
                // Special handling for Yushan Uni card exclusions in search results
                let exclusionNote = '';
                if (result.card.id === 'yushan-unicard' && 
                    (result.matchedItem === '街口' || result.matchedItem === '全支付')) {
                    exclusionNote = ' <small style="color: #f59e0b; font-weight: 500;">(排除超商)</small>';
                }
                
                // If multiple items matched (e.g., multiple travel agencies), show all
                let matchedItemsText = result.matchedItem;
                if (result.matchedItems && result.matchedItems.length > 1) {
                    matchedItemsText = result.matchedItems.join('、');
                }

                return `
                    <div class="matched-merchant">
                        匹配項目: <strong>${matchedItemsText}</strong>${exclusionNote}${categoryInfo}${additionalInfo}
                    </div>
                `;
            } else {
                return `
                    <div class="matched-merchant">
                        此卡無此項目回饋
                    </div>
                `;
            }
        })()}
    `;
    
    return cardDiv;
}

// Show a small inline breakdown popup when the user clicks "算式"
// Tracks which button currently has its breakdown open, so a second click on
// the SAME button toggles it closed, while clicking a DIFFERENT button closes
// the old one and opens the new one (instead of just closing whatever was open).
let openBreakdownBtn = null;

function closeOpenBreakdown() {
    if (openBreakdownBtn) {
        openBreakdownBtn.closest('.card-result, .coupon-item')?.querySelector('.calc-breakdown-popup')?.remove();
        openBreakdownBtn.classList.remove('active');
        openBreakdownBtn = null;
    }
}

function showCalcBreakdown(btn, cardResult) {
    // Clicking the button whose popup is already open just closes it
    if (openBreakdownBtn === btn) {
        closeOpenBreakdown();
        return;
    }

    // Otherwise close whichever popup was open elsewhere, then open this one
    closeOpenBreakdown();

    const layers = JSON.parse(cardResult.dataset.calcLayers || '[]');
    if (!layers.length) return;

    // 4 columns, no header: 項目 | 適用金額 | 回饋率 | 回饋金額
    // "封頂" marks a layer whose applicable amount was clamped by its cap.
    // 依回饋率高→低排列（2026-07-16 站長要求；Total 列固定最後不參與排序）
    layers.sort((a, b) => (parseFloat(b.rate) || 0) - (parseFloat(a.rate) || 0));
    const rows = layers.map(layer => {
        const amtLabel = `NT$${Math.floor(layer.applicableAmount).toLocaleString()}`;
        const cashLabel = `NT$${Math.floor(layer.cashback).toLocaleString()}`;
        const isCapped = layer.cap != null && layer.applicableAmount >= layer.cap;
        const cappedTag = isCapped ? `<span class="breakdown-capped">（封頂）</span>` : '';
        return `<tr>
            <td class="bd-name">${layer.name}</td>
            <td class="bd-amt">${amtLabel}</td>
            <td class="bd-rate">${layer.rate}%</td>
            <td class="bd-cash">${cashLabel}${cappedTag}</td>
        </tr>`;
    }).join('');

    // Total row: sum cashback across layers; total spending = actual amount
    // entered (NOT sum of applicable amounts, which overlaps for bonus/stacking).
    const totalCash = layers.reduce((s, l) => s + Math.floor(l.cashback), 0);
    const totalAmount = parseInt(cardResult.dataset.calcAmount, 10) || 0;
    const totalRow = `<tr class="bd-total">
        <td class="bd-name">Total</td>
        <td class="bd-amt">NT$${totalAmount.toLocaleString()}</td>
        <td class="bd-rate"></td>
        <td class="bd-cash">NT$${totalCash.toLocaleString()}</td>
    </tr>`;

    const popup = document.createElement('div');
    popup.className = 'calc-breakdown-popup';
    popup.innerHTML = `<table class="breakdown-table"><tbody>${rows}${totalRow}</tbody></table>`;

    // Append INSIDE the card/coupon box (not as a grid sibling) so it's visually
    // anchored to its own result — doesn't shift other grid items around, and
    // reads clearly as "this card's breakdown" instead of a floating panel.
    cardResult.appendChild(popup);
    btn.classList.add('active');
    openBreakdownBtn = btn;
    popup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// Close breakdown popup when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.calc-breakdown-popup') && !e.target.closest('.calc-breakdown-btn')) {
        closeOpenBreakdown();
    }
}, true);

// 詳情頁「回饋組成」抽屜：展開/收合各成分的回饋率與上限（不含金額，
// 與搜尋結果的計算明細不同——那個要有消費金額才算得出來）。
// 一次只開一個；資料來自按鈕的 data-comp（rateCompositionButtonHtml 產生）。
function toggleRateComposition(btn) {
    const item = btn.closest('.cashback-detail-item');
    if (!item) return;
    const wasOpen = !!item.querySelector('.calc-breakdown-popup');

    // 先關掉所有開著的組成抽屜（含自己）
    document.querySelectorAll('.cashback-detail-item .calc-breakdown-popup').forEach(p => p.remove());
    document.querySelectorAll('.cashback-detail-item .calc-breakdown-btn.active').forEach(b => b.classList.remove('active'));
    if (wasOpen) return; // 點的是已開啟的按鈕 → 收合即可

    let comp;
    try { comp = JSON.parse(btn.dataset.comp || '{}'); } catch (e) { return; }
    if (!comp.rows || !comp.rows.length) return;

    // 依回饋率高→低排列（2026-07-16 站長要求；合計列固定最後不參與排序）
    comp.rows.sort((a, b) => (parseFloat(b.rate) || 0) - (parseFloat(a.rate) || 0));
    const rows = comp.rows.map(r => `<tr>
        <td class="bd-name">${escapeHtml(String(r.name))}</td>
        <td class="bd-rate">${r.rate}%</td>
        <td class="bd-amt">${r.cap ? `上限 NT$${Math.floor(r.cap).toLocaleString()}` : '無上限'}</td>
    </tr>`).join('');
    const totalRow = `<tr class="bd-total"><td class="bd-name">合計</td><td class="bd-rate">${comp.total}%</td><td class="bd-amt"></td></tr>`;

    const popup = document.createElement('div');
    popup.className = 'calc-breakdown-popup';
    popup.innerHTML = `<table class="breakdown-table"><tbody>${rows}${totalRow}</tbody></table>`;
    item.appendChild(popup);
    btn.classList.add('active');
}

// Format currency

// Authentication setup
//
// Firebase 是從 gstatic 載入的外部模組，在公司網路/擋廣告環境可能永遠載不到。
// 過去的寫法是無限 100ms 輪詢直到 Firebase 就緒才綁定任何 UI 事件——
// Firebase 載不到＝整站卡在 boot loader，訪客連「計算」按鈕都按不到。
// 現在拆成兩條路：
//   - firebaseReadyHandled 之前（最多等 FIREBASE_FALLBACK_MS）：持續輪詢等 Firebase。
//   - 逾時仍未就緒：ensureGuestUIBound() 立即以訪客模式綁定 UI（不重複，見下方 guard），
//     輪詢繼續在背景跑；Firebase 之後就緒時只補跑 ensureAuthSubscribed()，不重新綁定事件。
const FIREBASE_FALLBACK_MS = 4000;

function setupAuthentication() {
    let firebaseReadyHandled = false;

    const onFirebaseReady = () => {
        if (firebaseReadyHandled) return;
        firebaseReadyHandled = true;
        auth = window.firebaseAuth;
        db = window.db;
        initializeAuthListeners();
    };

    // Wait for Firebase to load
    const checkFirebaseReady = () => {
        if (firebaseReadyHandled) return; // already handled via fallback+late-arrival path
        if (typeof window.firebaseAuth !== 'undefined' && typeof window.db !== 'undefined') {
            onFirebaseReady();
        } else {
            setTimeout(checkFirebaseReady, 100);
        }
    };
    checkFirebaseReady();

    // Fallback: Firebase 逾時未就緒 → 先以訪客模式初始化 UI，避免整站卡死。
    // 輪詢（checkFirebaseReady 的 setTimeout 鏈）仍在跑，Firebase 之後到位時
    // onFirebaseReady 會補做 auth 訂閱與登入態更新。
    setTimeout(() => {
        if (firebaseReadyHandled) return;
        console.error('⏱️ Firebase 載入逾時（' + FIREBASE_FALLBACK_MS + 'ms），以訪客模式初始化 UI，持續等待 SDK...');
        ensureGuestUIBound();
    }, FIREBASE_FALLBACK_MS);
}

// Setup avatar dropdown menu (toggle, close on outside click, menu actions)
// Show/hide guest-only dropdown items depending on whether the app has started.
// Called on init and whenever appStarted flips to true.
function setGuestDropdownVisibility() {
    if (currentUser) return; // logged-in users always see full menu
    const ids = ['avatar-manage-cards', 'avatar-manage-payments', 'avatar-my-mappings', 'avatar-feedback'];
    const divider = document.querySelector('.avatar-dropdown-divider');
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = appStarted ? '' : 'none';
    });
    if (divider) divider.style.display = appStarted ? '' : 'none';
}

function setupAvatarDropdown() {
    const avatarBtn = document.getElementById('avatar-btn');
    const avatarDropdown = document.getElementById('avatar-dropdown');
    if (!avatarBtn || !avatarDropdown) return;

    const closeDropdown = () => avatarDropdown.classList.remove('open');

    avatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        avatarDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!avatarDropdown.contains(e.target) && !avatarBtn.contains(e.target)) closeDropdown();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
    });

    // Menu item actions — map element IDs to handler functions
    const menuActions = {
        'avatar-manage-cards': () => openMyOwnedCardsModal(),
        'avatar-manage-payments': () => openMyPaymentsModal(),
        'avatar-my-mappings': () => openMyMappingsModal(),
        'avatar-feedback': () => {
            const modal = document.getElementById('feedback-modal');
            if (modal) { modal.style.display = 'flex'; disableBodyScroll(); }
        },
        'avatar-sign-out': async () => {
            if (currentUser) {
                // 先清本機個人資料再登出：順序固定，避免與 onAuthStateChanged
                // 的訪客資料重載互相競速。Firestore 是雲端事實來源，本機鏡像
                // 清掉後下次登入會自動重建。
                clearPersonalLocalDataOnSignOut(currentUser.uid);
                try { await window.signOut(auth); }
                catch (error) { console.error('Sign out failed:', error); }
            } else {
                openAuthModal('login');
            }
        }
    };

    for (const [id, action] of Object.entries(menuActions)) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                closeDropdown();
                action();
            });
        }
    }
}

// 登出時清理本機的個人資料：所有帶 uid 的鏡像 + 未帶 uid 區分的個人 key，
// 防止共用電腦上洩漏給下一位使用者。
// ⚠️ 只能在「用戶親自按登出」時呼叫 —— 不能放進 onAuthStateChanged 的登出分支，
// 那個分支在純訪客每次開頁時也會觸發，會誤刪訪客自己的資料。
function clearPersonalLocalDataOnSignOut(uid) {
    let allKeys = [];
    try {
        for (let i = 0; i < localStorage.length; i++) allKeys.push(localStorage.key(i));
    } catch (e) { return; }

    const uidExact = uid ? [
        `cardsInComparison_${uid}`, `selectedCards_${uid}`, `myOwnedCards_${uid}`,
        `selectedPayments_${uid}`, `spendingMappings_${uid}`
    ] : [];
    const uidPrefixes = uid ? [
        `feeWaiver_${uid}_`, `billingDates_${uid}_`, `notes_${uid}_`, `cardLevel_${uid}_`,
        `creditLimit_${uid}_`
    ] : [];
    // 非 uid 區分的個人 key（訪客資料多半已在登入時被 absorbGuestPersonalData 消化，
    // 這裡清掉的是殘留值）
    const guestExact = [
        'spendingMappings', 'cubeIssuer', 'userQuickSearchPrefs',
        'cardsInComparison_guest', 'myOwnedCards_guest', 'selectedPayments_guest'
    ];
    const guestPrefixes = ['cardLevel-', 'feeWaiver_local_', 'billingDates_local_', 'creditLimit_local_'];
    // 訪客筆記 key 是 notes_<cardId>，用已知卡片 ID 跟 notes_<uid>_<cardId> 區分
    const knownCardIds = new Set(((cardsData && cardsData.cards) || []).map(c => c.id));

    for (const key of allKeys) {
        const isPersonal =
            uidExact.includes(key) ||
            uidPrefixes.some(p => key.startsWith(p)) ||
            guestExact.includes(key) ||
            guestPrefixes.some(p => key.startsWith(p)) ||
            (key.startsWith('notes_') && knownCardIds.has(key.slice('notes_'.length)));
        if (isPersonal) {
            try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
        }
    }
    console.log('🧹 已清理本機個人資料（登出）');
}

// UI 綁定與 auth 訂閱拆開兩個 guard：Firebase 逾時 fallback 時只需要 ensureGuestUIBound()
// 就能讓網站可互動；Firebase 之後就緒時只補跑 ensureAuthSubscribed()，不重新綁定任何
// 事件監聽器（重複綁定會讓按鈕點擊、document click 等監聽器疊加觸發）。
let _guestUIBound = false;
let _authStateSubscribed = false;
// ensureGuestUIBound() 內定義的 closures，ensureAuthSubscribed() 的 onAuthStateChanged
// callback 需要用到同一份（避免兩份 showToolSections/setGuestAvatarState 各自為政）。
let _authUIRefs = null;

// 綁定「訪客也能用」的 UI：avatar 狀態、工具區顯示/隱藏、各種 modal、「開始使用」按鈕。
// 刻意不依賴 auth/db 是否就緒——Firebase 逾時時這是唯一會跑到的初始化路徑。
function ensureGuestUIBound() {
    if (_guestUIBound) return;
    _guestUIBound = true;

    // Firebase 逾時 fallback 時，這裡是唯一會清除 boot loader 的地方
    // （原本綁在 onAuthStateChanged 裡，Firebase 若永遠載不到就永遠不會清）。
    // 見 index.html #pmc-boot-loader / html.pmc-returning-user 的說明。
    document.documentElement.classList.remove('pmc-returning-user');

    const signInBtn = document.getElementById('sign-in-btn');
    const userPhoto = document.getElementById('user-photo');
    const userName = document.getElementById('user-name');
    const avatarBtn = document.getElementById('avatar-btn');
    const guestAvatarIcon = document.getElementById('guest-avatar-icon');
    const signOutLabel = document.getElementById('sign-out-label');

    // Sign in button (now hidden, kept for fallback)
    if (signInBtn) signInBtn.addEventListener('click', () => openAuthModal('login'));

    function setGuestAvatarState() {
        if (avatarBtn) avatarBtn.classList.add('guest-mode');
        if (guestAvatarIcon) guestAvatarIcon.style.display = '';
        if (userPhoto) { userPhoto.src = ''; userPhoto.style.display = 'none'; }
        if (userName) userName.textContent = '';
        if (signOutLabel) signOutLabel.textContent = '註冊／登入';
        const signOutItem = document.getElementById('avatar-sign-out');
        if (signOutItem) {
            signOutItem.classList.remove('avatar-dropdown-logout');
            signOutItem.classList.add('avatar-dropdown-signin');
        }
        setGuestDropdownVisibility();
    }

    function setLoggedInAvatarState(user) {
        if (avatarBtn) avatarBtn.classList.remove('guest-mode');
        if (guestAvatarIcon) guestAvatarIcon.style.display = 'none';
        if (user.photoURL) {
            userPhoto.src = user.photoURL;
            userPhoto.style.display = 'block';
        } else {
            userPhoto.style.display = 'none';
        }
        if (userName) userName.textContent = user.displayName || user.email;
        if (signOutLabel) signOutLabel.textContent = '登出';
        const signOutItem = document.getElementById('avatar-sign-out');
        if (signOutItem) {
            signOutItem.classList.add('avatar-dropdown-logout');
            signOutItem.classList.remove('avatar-dropdown-signin');
        }
        // Always show all menu items for logged-in users
        const ids = ['avatar-manage-cards', 'avatar-manage-payments', 'avatar-my-mappings', 'avatar-feedback'];
        const divider = document.querySelector('.avatar-dropdown-divider');
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
        if (divider) divider.style.display = '';
    }

    // Initialize as guest state on page load
    setGuestAvatarState();

    // Setup avatar dropdown menu
    setupAvatarDropdown();
    
    // Cache shared DOM references for show/hide
    const toolElements = {
        inputSection: document.querySelector('.input-section'),
        supportedCards: document.querySelector('.supported-cards'),
        sidebar: document.getElementById('sidebar'),
        appLayout: document.querySelector('.app-layout'),
        sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
        announcementBar: document.getElementById('announcement-bar'),
        resultsSection: document.querySelector('.results-section'),
        couponResultsSection: document.querySelector('.coupon-results-section'),
        spotlightSection: document.getElementById('spotlight-section'),
        financeWarningRow: document.getElementById('finance-warning-row'),
    };

    function showToolSections() {
        const t = toolElements;
        if (t.inputSection) t.inputSection.style.display = 'block';
        if (t.supportedCards) t.supportedCards.style.display = 'block';
        renderSpotlights();
        if (t.financeWarningRow) t.financeWarningRow.style.display = 'block';
        if (t.sidebar) t.sidebar.style.display = '';
        if (t.appLayout) t.appLayout.classList.remove('no-sidebar');
        if (t.sidebarToggleBtn) t.sidebarToggleBtn.style.display = '';
        if (t.announcementBar && announcements && announcements.length > 0) {
            t.announcementBar.style.display = 'block';
        }
    }

    function hideToolSections() {
        const t = toolElements;
        if (t.inputSection) t.inputSection.style.display = 'none';
        if (t.supportedCards) t.supportedCards.style.display = 'none';

        // Mobile: keep sidebar as drawer; Desktop: hide from grid
        if (t.sidebar) {
            t.sidebar.style.display = window.innerWidth <= 768 ? '' : 'none';
        }
        if (t.appLayout) t.appLayout.classList.add('no-sidebar');
        if (t.sidebarToggleBtn) t.sidebarToggleBtn.style.display = '';
        if (t.announcementBar) t.announcementBar.style.display = 'none';
        if (t.resultsSection) t.resultsSection.style.display = 'none';
        if (t.couponResultsSection) t.couponResultsSection.style.display = 'none';
        if (t.spotlightSection) t.spotlightSection.style.display = 'none';
        if (t.financeWarningRow) t.financeWarningRow.style.display = 'none';
        stopSpotlightAutoRotate();
    }

    // 分享給 ensureAuthSubscribed() 的 onAuthStateChanged callback用，避免兩份
    // showToolSections/setGuestAvatarState/setLoggedInAvatarState 各自為政。
    _authUIRefs = { setGuestAvatarState, setLoggedInAvatarState, showToolSections, hideToolSections };

    // Setup manage cards modal
    setupManageCardsModal();

    // Setup my-owned-cards modal
    setupMyOwnedCardsModal();

    // Setup new cardholder promos toggle (search results section)
    setupCardholderPromoToggle();

    // Setup sidebar drawer for mobile
    setupSidebarDrawer();

    // Setup "Start Using" button click event (Option 2: Toggle display)
    const startUsingBtn = document.getElementById('start-using-btn');
    if (startUsingBtn) {
        startUsingBtn.addEventListener('click', () => {
            // Hide product intro section
            const productIntroSection = document.getElementById('product-intro-section');
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }

            // Show tool sections
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();

            // Hide the button itself (for mobile)
            startUsingBtn.style.display = 'none';

            // Focus on merchant input
            setTimeout(() => {
                const merchantInput = document.getElementById('merchant-input');
                if (merchantInput) {
                    merchantInput.focus();
                }
            }, 100);
        });
    }

    // Setup header "Start Using" button (in auth section)
    const startUsingBtnHeader = document.getElementById('start-using-btn-header');
    if (startUsingBtnHeader) {
        startUsingBtnHeader.addEventListener('click', () => {
            // Hide product intro section
            const productIntroSection = document.getElementById('product-intro-section');
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }

            // Show tool sections
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();

            // Hide the button itself (for mobile)
            startUsingBtnHeader.style.display = 'none';

            // Focus on merchant input
            setTimeout(() => {
                const merchantInput = document.getElementById('merchant-input');
                if (merchantInput) {
                    merchantInput.focus();
                }
            }, 100);
        });
    }

    // Setup second "Start Using" button with same functionality
    const startUsingBtn2 = document.getElementById('start-using-btn-2');
    if (startUsingBtn2) {
        startUsingBtn2.addEventListener('click', () => {
            // Hide product intro section
            const productIntroSection = document.getElementById('product-intro-section');
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }

            // Show tool sections
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();

            // Hide the button itself (for mobile)
            startUsingBtn2.style.display = 'none';

            // Focus on merchant input
            setTimeout(() => {
                const merchantInput = document.getElementById('merchant-input');
                if (merchantInput) {
                    merchantInput.focus();
                }
            }, 100);
        });
    }
}

// 訂閱 Firebase auth 狀態變化。只在 auth 真的就緒時呼叫；用 _authStateSubscribed
// guard 避免 Firebase 逾時 fallback 之後晚到時重複訂閱（onAuthStateChanged 訂閱兩次
// 會讓登入/登出流程跑兩遍，造成 loadUserData 等重複呼叫）。
function ensureAuthSubscribed() {
    if (_authStateSubscribed) return;
    if (!auth) {
        console.error('❌ ensureAuthSubscribed() 在 auth 就緒前被呼叫，略過訂閱');
        return;
    }
    if (!_authUIRefs) {
        console.error('❌ ensureAuthSubscribed() 在 ensureGuestUIBound() 之前被呼叫，略過訂閱');
        return;
    }
    _authStateSubscribed = true;

    const { setGuestAvatarState, setLoggedInAvatarState, showToolSections } = _authUIRefs;

    // Listen for authentication state changes
    window.onAuthStateChanged(auth, async (user) => {
        // Card levels are user-scoped; drop cached values when the user changes.
        clearCardLevelCache();

        const productIntroSection = document.getElementById('product-intro-section');

        // Update the pre-paint auth hint so the next visit skips the hero flash
        // (or correctly shows it if the user signed out / token expired).
        try {
            if (user) {
                localStorage.setItem('pmc_known_logged_in', '1');
            } else {
                localStorage.removeItem('pmc_known_logged_in');
            }
        } catch (e) { /* localStorage disabled — silently ignore */ }
        document.documentElement.classList.remove('pmc-returning-user');

        if (user) {
            // User is signed in
            console.log('User signed in:', user);
            currentUser = user;
            setLoggedInAvatarState(user);

            // Hide "Start Using" button when logged in
            const startUsingBtnHeader = document.getElementById('start-using-btn-header');
            if (startUsingBtnHeader) {
                startUsingBtnHeader.style.display = 'none';
            }

            // Hide product introduction section and show tool sections when logged in
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }
            appStarted = true;
            showToolSections();

            // Show manage cards button
            document.getElementById('manage-cards-btn').style.display = 'block';

            // Show my mappings button
            const myMappingsBtn = document.getElementById('my-mappings-btn');
            if (myMappingsBtn) {
                myMappingsBtn.style.display = 'flex';
            }

            // ✨ Load ALL user data in ONE Firestore call (optimized!)
            const userData = await loadUserData();

            // Load birthday month and pre-compute flag (O(1) for all subsequent searches)
            userBirthdayMonth = (userData && userData.birthdayMonth != null) ? userData.birthdayMonth : null;
            isBirthdayMonth = userBirthdayMonth !== null && userBirthdayMonth === (new Date().getMonth() + 1);

            // Load children eligibility flag (defaults to true if not set)
            isChildrenEligible = (userData && userData.isChildrenEligible != null) ? userData.isChildrenEligible : true;

            // Load CUBE card issuer (defaults to Visa, fall back to localStorage if Firestore not set)
            if (userData && userData.cubeIssuer) {
                cubeIssuer = userData.cubeIssuer;
                try { localStorage.setItem('cubeIssuer', cubeIssuer); } catch (e) {}
            }

            // Load user's selected cards and payments using unified data.
            // 訪客資料的處理原則（2026-07 統一）：雲端有值 → 雲端為準；
            // 雲端沒值 → 靜默帶入訪客值並上傳；訪客 key 兩種情況都會被消化移除。
            await loadCardsInComparison(userData);
            await loadMyOwnedCards(userData);
            await loadUserPayments(userData);
            await absorbGuestPersonalData(userData);
            await loadSpendingMappings();

            // Load user's quick search options (new prefs format with auto-migration)
            await initializeQuickSearchOptions(userData);
            renderQuickSearchButtons();

            // Update chips display
            populateCardChips();
            populatePaymentChips();

        } else {
            // User is signed out — guest mode
            console.log('User signed out');
            currentUser = null;
            appStarted = false;
            cardsInComparison.clear();
            myOwnedCards.clear();
            // Load guest data from localStorage
            await loadCardsInComparison();
            await loadMyOwnedCards();
            userSelectedPayments.clear();
            await loadUserPayments();  // loads guest payments from localStorage
            await loadSpendingMappings();
            userBirthdayMonth = null;
            isBirthdayMonth = false;
            isChildrenEligible = true;
            cubeIssuer = (typeof localStorage !== 'undefined' && localStorage.getItem('cubeIssuer')) || 'Visa';
            setGuestAvatarState();

            // Show "Start Using" button when logged out
            const startUsingBtnHeader = document.getElementById('start-using-btn-header');
            if (startUsingBtnHeader) {
                startUsingBtnHeader.style.display = 'inline-block';
            }

            // Load guest quick search prefs from localStorage (or defaults)
            await initializeQuickSearchOptions();
            renderQuickSearchButtons();

            // hero（product-intro）不再顯示：landing 已接手行銷/上手敘事。
            // 首屏路由（index.html pre-paint）已把全新訪客導去 landing，因此能走到
            // 這裡的登出使用者都是「從 landing 來」或「用過工具的舊用戶」——兩者都
            // 直接進工具、不看 hero，避免與 landing 重複敘事、也讓舊用戶開頁即用。
            // （hero 區塊正式從 DOM 移除是獨立的 follow-up；這裡只是不顯示它）
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();
            if (startUsingBtnHeader) {
                startUsingBtnHeader.style.display = 'none';
            }

            // Hide my mappings button
            const myMappingsBtn = document.getElementById('my-mappings-btn');
            if (myMappingsBtn) {
                myMappingsBtn.style.display = 'none';
            }

            // Show manage cards button even when not logged in (read-only mode)
            document.getElementById('manage-cards-btn').style.display = 'block';

            // Show all cards and payments when signed out
            populateCardChips();
            populatePaymentChips();
        }

        // 登入成功後預熱級別快取（見 warmCardLevelCache 定義處的說明），
        // fire-and-forget——不擋 onAuthStateChanged 流程。
        if (user) {
            warmCardLevelCache();
        }
    });
}

// Firebase 就緒後才呼叫：先確保訪客 UI 已綁定（fallback 逾時可能已經跑過，
// 這裡的 ensureGuestUIBound() 是 no-op），再訂閱 auth 狀態。
function initializeAuthListeners() {
    ensureGuestUIBound();
    ensureAuthSubscribed();
}

// ✨ Unified user data loader - loads ALL user data in ONE Firestore call
async function loadUserData() {
    if (!currentUser || !window.db || !window.doc || !window.getDoc) {
        return null;
    }

    try {
        const docRef = window.doc(window.db, 'users', currentUser.uid);
        const docSnap = await window.getDoc(docRef);

        if (docSnap.exists()) {
            const userData = docSnap.data();
            console.log('✅ Loaded all user data from Firestore in ONE call:', Object.keys(userData));
            return userData;
        }
    } catch (error) {
        console.error('❌ Error loading user data:', error);
    }

    return null;
}

// 登入時消化「訪客期間留下的其餘個人資料」：消費配卡表、卡片級別、筆記、
// 免年費、結帳日、CUBE 發卡組織。（信用卡/行動支付在各自的 load 函數內處理。）
// 原則：雲端有值 → 雲端為準；雲端沒值 → 靜默帶入訪客值並上傳（不彈窗）。
// 訪客 key 處理完即移除，避免留在共用電腦上被下一位使用者「繼承」——
// 這正是過去卡片級別跨用戶洩漏的根源。
// 高價值資料（級別、筆記）在上傳失敗時保留 key，下次登入重試。
async function absorbGuestPersonalData(userData) {
    if (!currentUser || !window.db || !window.doc) return;
    const canWrite = !!window.setDoc;
    const canRead = !!window.getDoc;

    // 先收集所有 key 再處理，避免邊迭代邊刪除
    let allKeys = [];
    try {
        for (let i = 0; i < localStorage.length; i++) allKeys.push(localStorage.key(i));
    } catch (e) { return; }

    const knownCardIds = new Set(((cardsData && cardsData.cards) || []).map(c => c.id));

    // 1. 消費配卡表（訪客 key: spendingMappings）
    if (allKeys.includes('spendingMappings')) {
        const guestMappings = readLocalJSONArray('spendingMappings');
        localStorage.removeItem('spendingMappings');
        const cloudHasMappings = Array.isArray(userData?.spendingMappings) && userData.spendingMappings.length > 0;
        if (!cloudHasMappings && guestMappings.length > 0 && canWrite) {
            try {
                await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                    spendingMappings: guestMappings,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                console.log('🔀 雲端無配卡表，已帶入訪客的配卡表:', guestMappings.length, '筆');
            } catch (e) { console.error('帶入訪客配卡表失敗:', e); }
        }
    }

    // 2. 卡片級別（訪客 key: cardLevel-<cardId>；登入後鏡像是 cardLevel_<uid>_<cardId>）
    //    只有雲端「沒有」這張卡的級別時才帶入 —— 絕不覆蓋用戶已儲存的選擇。
    for (const key of allKeys.filter(k => k.startsWith('cardLevel-'))) {
        const cardId = key.slice('cardLevel-'.length);
        let guestLevel = null;
        try { guestLevel = localStorage.getItem(key); } catch (e) { continue; }
        if (!guestLevel || !knownCardIds.has(cardId)) {
            try { localStorage.removeItem(key); } catch (e) {}
            continue;
        }
        if (!canRead || !canWrite) continue;
        try {
            const snap = await window.getDoc(window.doc(window.db, 'cardSettings', `${currentUser.uid}_${cardId}`));
            if (!snap.exists()) {
                await saveCardLevel(cardId, guestLevel);
                console.log(`🔀 雲端無級別，帶入訪客選擇 ${cardId}: ${guestLevel}`);
            }
            localStorage.removeItem(key); // 成功處理（帶入或雲端已有）才移除
        } catch (e) {
            console.error('帶入訪客級別失敗（保留待下次重試）:', cardId, e);
        }
    }

    // 3. 筆記（訪客 key: notes_<cardId>；用 knownCardIds 區分 notes_<uid>_<cardId> 鏡像）
    for (const key of allKeys.filter(k => k.startsWith('notes_'))) {
        const cardId = key.slice('notes_'.length);
        if (!knownCardIds.has(cardId)) continue; // 不是訪客筆記 key
        let guestNotes = null;
        try { guestNotes = localStorage.getItem(key); } catch (e) { continue; }
        if (!guestNotes) {
            try { localStorage.removeItem(key); } catch (e) {}
            continue;
        }
        if (!canRead || !canWrite) continue;
        try {
            const ref = window.doc(window.db, 'userNotes', `${currentUser.uid}_${cardId}`);
            const snap = await window.getDoc(ref);
            if (!snap.exists() || !snap.data().notes) {
                await window.setDoc(ref, { notes: guestNotes, updatedAt: new Date(), cardId: cardId });
                console.log(`🔀 雲端無筆記，帶入訪客筆記 ${cardId}`);
            }
            localStorage.removeItem(key);
        } catch (e) {
            console.error('帶入訪客筆記失敗（保留待下次重試）:', cardId, e);
        }
    }

    // 4. 免年費（訪客 key: feeWaiver_local_<cardId>；雲端是 users 文件的 feeWaiverStatus map）
    const cloudFeeWaiver = (userData && userData.feeWaiverStatus) || {};
    const feeWaiverUpdates = {};
    for (const key of allKeys.filter(k => k.startsWith('feeWaiver_local_'))) {
        const cardId = key.slice('feeWaiver_local_'.length);
        let val = null;
        try { val = localStorage.getItem(key); localStorage.removeItem(key); } catch (e) { continue; }
        if (knownCardIds.has(cardId) && val === 'true' && !(cardId in cloudFeeWaiver)) {
            feeWaiverUpdates[cardId] = true;
        }
    }
    if (Object.keys(feeWaiverUpdates).length > 0 && canWrite) {
        try {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                feeWaiverStatus: { ...cloudFeeWaiver, ...feeWaiverUpdates },
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('🔀 帶入訪客的免年費設定:', Object.keys(feeWaiverUpdates));
        } catch (e) { console.error('帶入訪客免年費失敗:', e); }
    }

    // 5. 結帳日期（訪客 key: billingDates_local_<cardId>；雲端是 users 文件的 billingDates map）
    const cloudBillingDates = (userData && userData.billingDates) || {};
    const billingUpdates = {};
    for (const key of allKeys.filter(k => k.startsWith('billingDates_local_'))) {
        const cardId = key.slice('billingDates_local_'.length);
        const dates = readLocalJSON(key, null);
        try { localStorage.removeItem(key); } catch (e) {}
        if (knownCardIds.has(cardId) && dates && typeof dates === 'object' && !(cardId in cloudBillingDates)) {
            billingUpdates[cardId] = {
                billingDate: typeof dates.billingDate === 'string' ? dates.billingDate : '',
                statementDate: typeof dates.statementDate === 'string' ? dates.statementDate : ''
            };
        }
    }
    if (Object.keys(billingUpdates).length > 0 && canWrite) {
        try {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                billingDates: { ...cloudBillingDates, ...billingUpdates },
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('🔀 帶入訪客的結帳日期設定:', Object.keys(billingUpdates));
        } catch (e) { console.error('帶入訪客結帳日期失敗:', e); }
    }

    // 6. CUBE 發卡組織：雲端沒有且訪客改過（非預設 Visa）→ 帶入
    if (!(userData && userData.cubeIssuer)) {
        let localIssuer = null;
        try { localIssuer = localStorage.getItem('cubeIssuer'); } catch (e) {}
        if (localIssuer && localIssuer !== 'Visa') {
            await saveCubeIssuer(localIssuer);
            console.log('🔀 雲端無 CUBE 發卡組織設定，帶入訪客選擇:', localIssuer);
        }
    }
}

// Load user's cards-in-comparison from Firestore (with localStorage fallback)
// Reads new field `cardsInComparison` first; falls back to legacy `selectedCards` for migration.
// Guests load from localStorage `cardsInComparison_guest`; default is all cards.
// Accepts optional userData parameter to avoid redundant Firestore calls.
async function loadCardsInComparison(userData = null) {
    if (!currentUser) {
        // Guest: load from localStorage; default to all cards if nothing saved
        const saved = readLocalJSON('cardsInComparison_guest', null);
        if (Array.isArray(saved)) {
            cardsInComparison = new Set(filterKnownCardIds(saved));
            console.log('📦 Loaded cards-in-comparison from guest localStorage:', Array.from(cardsInComparison));
        } else {
            cardsInComparison = new Set(cardsData.cards.map(card => card.id));
            console.log('🆕 Guest with no saved comparison, defaulting to all cards');
        }
        return;
    }

    const newKey = `cardsInComparison_${currentUser.uid}`;
    const legacyKey = `selectedCards_${currentUser.uid}`;

    try {
        // Use provided userData if available (from unified load)
        let cloudCards = null;
        if (userData) {
            cloudCards = userData.cardsInComparison || userData.selectedCards || null;
        } else if (window.db && window.doc && window.getDoc) {
            // Fallback: Try to load from Firestore if userData not provided
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                cloudCards = data.cardsInComparison || data.selectedCards || null;
            }
        }

        if (Array.isArray(cloudCards)) {
            // 雲端有設定 → 雲端為準；移除訪客殘留 key，避免留給下一位使用者
            cardsInComparison = new Set(filterKnownCardIds(cloudCards));
            console.log('✅ Loaded cards-in-comparison from cloud:', Array.from(cardsInComparison));
            localStorage.setItem(newKey, JSON.stringify(cloudCards));
            localStorage.removeItem('cardsInComparison_guest');
            return;
        }

        // 雲端沒有設定：若訪客期間有儲存過選擇 → 靜默帶入並上傳（不彈窗）
        const guestCards = readLocalJSON('cardsInComparison_guest', null);
        if (guestCards !== null) localStorage.removeItem('cardsInComparison_guest');
        if (Array.isArray(guestCards) && guestCards.length > 0) {
            cardsInComparison = new Set(filterKnownCardIds(guestCards));
            console.log('🔀 雲端無設定，帶入訪客的加入比較卡片:', Array.from(cardsInComparison));
            await saveCardsInComparison();
            return;
        }

        // Fallback to localStorage (try new key first, then legacy)
        const savedCards = readLocalJSON(newKey, null) || readLocalJSON(legacyKey, null);

        if (Array.isArray(savedCards)) {
            cardsInComparison = new Set(filterKnownCardIds(savedCards));
            console.log('📦 Loaded cards-in-comparison from localStorage (fallback):', Array.from(cardsInComparison));
        } else {
            // First time user - select all cards by default
            console.log('🆕 First time user, selecting all cards');
            cardsInComparison = new Set(cardsData.cards.map(card => card.id));
            saveCardsInComparison();
        }
    } catch (error) {
        console.error('❌ Error loading cards-in-comparison:', error);
        // Default to all cards if error
        cardsInComparison = new Set(cardsData.cards.map(card => card.id));
    }
}

// Load my-owned-cards from Firestore (logged in) or localStorage (guest).
// Default for everyone is empty Set.
async function loadMyOwnedCards(userData = null) {
    if (!currentUser) {
        // Guest: load from localStorage
        const saved = readLocalJSON('myOwnedCards_guest', null);
        myOwnedCards = Array.isArray(saved) ? new Set(filterKnownCardIds(saved)) : new Set();
        console.log('📦 Loaded myOwnedCards (guest):', Array.from(myOwnedCards));
        return;
    }

    const userKey = `myOwnedCards_${currentUser.uid}`;
    try {
        let cloudOwned = null;
        if (userData && Array.isArray(userData.myOwnedCards)) {
            cloudOwned = userData.myOwnedCards;
        } else if (!userData && window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists() && Array.isArray(docSnap.data().myOwnedCards)) {
                cloudOwned = docSnap.data().myOwnedCards;
            }
        }

        if (cloudOwned !== null) {
            // 雲端有設定 → 雲端為準；移除訪客殘留 key
            myOwnedCards = new Set(filterKnownCardIds(cloudOwned));
            console.log('✅ Loaded myOwnedCards from cloud:', Array.from(myOwnedCards));
            localStorage.setItem(userKey, JSON.stringify(cloudOwned));
            localStorage.removeItem('myOwnedCards_guest');
            return;
        }

        // 雲端沒有設定：若訪客期間有儲存過 → 靜默帶入並上傳（不彈窗）
        const guestCards = readLocalJSON('myOwnedCards_guest', null);
        if (guestCards !== null) localStorage.removeItem('myOwnedCards_guest');
        if (Array.isArray(guestCards) && guestCards.length > 0) {
            myOwnedCards = new Set(filterKnownCardIds(guestCards));
            console.log('🔀 雲端無設定，帶入訪客的我的信用卡:', Array.from(myOwnedCards));
            await saveMyOwnedCards();
            return;
        }

        myOwnedCards = new Set();
        localStorage.setItem(userKey, JSON.stringify([]));
    } catch (error) {
        console.error('❌ Error loading myOwnedCards:', error);
        // Fallback to user-specific localStorage
        const saved = readLocalJSON(userKey, null);
        myOwnedCards = Array.isArray(saved) ? new Set(filterKnownCardIds(saved)) : new Set();
    }
}

// Save my-owned-cards to localStorage (always) and Firestore (if logged in).
async function saveMyOwnedCards() {
    const cardsArray = Array.from(myOwnedCards);

    if (!currentUser) {
        try {
            localStorage.setItem('myOwnedCards_guest', JSON.stringify(cardsArray));
            console.log('✅ Saved myOwnedCards to guest localStorage:', cardsArray);
        } catch (e) {
            console.error('Error saving guest myOwnedCards:', e);
        }
        return;
    }

    try {
        const userKey = `myOwnedCards_${currentUser.uid}`;
        localStorage.setItem(userKey, JSON.stringify(cardsArray));

        if (window.db && window.doc && window.setDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            await window.setDoc(docRef, {
                myOwnedCards: cardsArray,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('☁️ Synced myOwnedCards to Firestore:', cardsArray);
        }
    } catch (error) {
        console.error('Error saving myOwnedCards:', error);
    }
}

// Save cards-in-comparison to localStorage (always) and Firestore (if logged in)
async function saveCardsInComparison() {
    const cardsArray = Array.from(cardsInComparison);

    if (!currentUser) {
        try {
            localStorage.setItem('cardsInComparison_guest', JSON.stringify(cardsArray));
            console.log('✅ Saved cards-in-comparison to guest localStorage:', cardsArray);
        } catch (e) {
            console.error('Error saving guest cards-in-comparison:', e);
        }
        return;
    }

    try {
        // Save to localStorage as backup
        const storageKey = `cardsInComparison_${currentUser.uid}`;
        localStorage.setItem(storageKey, JSON.stringify(cardsArray));
        console.log('✅ Saved cards-in-comparison to localStorage:', cardsArray);

        // Save to Firestore for cross-device sync
        if (window.db && window.doc && window.setDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            await window.setDoc(docRef, {
                cardsInComparison: cardsArray,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('☁️ Synced cards-in-comparison to Firestore:', cardsArray);
        }
    } catch (error) {
        console.error('Error saving cards-in-comparison:', error);
        // Don't throw error - at least localStorage is saved
    }
}

// Setup manage cards modal
function setupManageCardsModal() {
    const manageBtn = document.getElementById('manage-cards-btn');
    const modal = document.getElementById('manage-cards-modal');
    const closeBtn = document.getElementById('close-modal');
    const cancelBtn = document.getElementById('cancel-cards-btn');
    const saveBtn = document.getElementById('save-cards-btn');
    
    // Open modal
    manageBtn.addEventListener('click', () => {
        openManageCardsModal();
    });
    
    // Close modal function
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    // Save cards (shared handler for both footer and quick-save buttons)
    const doSaveCards = async () => {
        const checkboxes = document.querySelectorAll('#cards-selection input[type="checkbox"]');
        const newSelection = new Set();

        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                newSelection.add(checkbox.value);
            }
        });

        // Validate at least one card is selected
        if (newSelection.size === 0) {
            alert('請至少選擇一張信用卡');
            return;
        }

        // Update and save
        cardsInComparison = newSelection;
        await saveCardsInComparison();

        // Update UI immediately
        populateCardChips();

        // Close modal
        closeModal();
    };
    saveBtn.addEventListener('click', doSaveCards);
    const quickSaveBtn = document.getElementById('save-cards-btn-quick');
    if (quickSaveBtn) quickSaveBtn.addEventListener('click', doSaveCards);
    
    // Toggle all cards button
    const toggleAllBtn = document.getElementById('toggle-all-cards');
    toggleAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#cards-selection input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);

        if (allChecked) {
            // Uncheck all
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
                checkbox.parentElement.classList.remove('selected');
            });
            toggleAllBtn.textContent = '全選';
        } else {
            // Check all
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
                checkbox.parentElement.classList.add('selected');
            });
            toggleAllBtn.textContent = '全不選';
        }
    });

    // "套用我的信用卡" toggle: add all myOwnedCards to current selection,
    // or remove them if all are already selected. Does not affect other cards.
    const applyOwnedBtn = document.getElementById('apply-owned-cards-btn');
    if (applyOwnedBtn) {
        applyOwnedBtn.addEventListener('click', () => {
            if (myOwnedCards.size === 0) return;
            const checkboxes = Array.from(document.querySelectorAll('#cards-selection input[type="checkbox"]'));
            const ownedCheckboxes = checkboxes.filter(cb => myOwnedCards.has(cb.value));
            const allOwnedChecked = ownedCheckboxes.length > 0 && ownedCheckboxes.every(cb => cb.checked);
            ownedCheckboxes.forEach(cb => {
                cb.checked = !allOwnedChecked;
                cb.parentElement.classList.toggle('selected', !allOwnedChecked);
            });
        });
    }
}

// ==========================================
// Sidebar Drawer (Mobile)
// ==========================================

function setupSidebarDrawer() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const closeBtn = document.getElementById('sidebar-close-btn');

    if (!sidebar || !overlay || !toggleBtn || !closeBtn) return;

    function openDrawer() {
        // Ensure sidebar content is visible (may be hidden on landing page)
        const supportedCards = sidebar.querySelector('.supported-cards');
        if (supportedCards) supportedCards.style.display = 'block';

        sidebar.classList.add('open');
        overlay.classList.add('active');
        disableBodyScroll();
    }

    function closeDrawer() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        enableBodyScroll();
    }
    window.closeSidebarDrawer = closeDrawer;

    toggleBtn.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeDrawer();
        }
    });

    // Close drawer when resizing to desktop
    let wasMobileDrawer = window.innerWidth <= 768;
    window.addEventListener('resize', () => {
        const nowMobile = window.innerWidth <= 768;
        if (wasMobileDrawer && !nowMobile) {
            closeDrawer();
        }
        wasMobileDrawer = nowMobile;
    });
}

// Shared renderer for card-selection modals (used by both Manage Cards and My Owned Cards).
// Populates tag filter chips, the card list with checkboxes, search filter, and updates
// toggle-all button state. Caller is responsible for showing the modal afterwards.
function _renderCardSelectionModal(config) {
    const cardsSelection = document.getElementById(config.selectionId);
    const tagFilterChips = document.getElementById(config.tagFilterChipsId);
    const searchInput = document.getElementById(config.searchInputId);
    const toggleAllBtn = document.getElementById(config.toggleAllBtnId);
    const saveBtn = document.getElementById(config.saveBtnId);

    const currentSelection = config.currentSelection;
    const isLoggedIn = currentUser !== null;
    const canEdit = isLoggedIn || config.allowGuestEdit === true;

    // Collect all unique tags
    const allTags = new Set();
    cardsData.cards.forEach(card => {
        if (card.tags && Array.isArray(card.tags)) {
            card.tags.forEach(tag => allTags.add(tag));
        }
    });

    // Wire up the collapsible tag-filter-section toggle (idempotent).
    const tagFilterSection = tagFilterChips ? tagFilterChips.closest('.tag-filter-section') : null;
    const tagFilterToggle = tagFilterSection ? tagFilterSection.querySelector('.tag-filter-toggle') : null;
    if (tagFilterToggle && !tagFilterToggle.dataset.bound) {
        tagFilterToggle.dataset.bound = '1';
        tagFilterToggle.addEventListener('click', () => {
            const collapsed = tagFilterSection.classList.toggle('collapsed');
            tagFilterToggle.setAttribute('aria-expanded', String(!collapsed));
            tagFilterChips.hidden = collapsed;
        });
    }

    // Render tag filter chips
    const selectedTags = new Set();
    if (allTags.size > 0) {
        tagFilterChips.innerHTML = '';
        const sortedTags = ['旅遊', '開車族', '餐飲', '交通', '網購', '百貨公司', '外送', '娛樂', '行動支付', 'AI工具', '便利商店', '串流平台', '超市', '藥妝', '時尚品牌', '直銷品牌', '生活百貨', '運動', '寵物', '親子', '應用程式商店', '飲食品牌', '美妝美髮保養品牌', '保費']
            .filter(tag => allTags.has(tag));
        sortedTags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = `tag-filter-chip card-tag ${getTagClass(tag)}`;
            chip.textContent = tag;
            chip.dataset.tag = tag;
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                if (chip.classList.contains('active')) selectedTags.add(tag);
                else selectedTags.delete(tag);
                applyFilters();
            });
            tagFilterChips.appendChild(chip);
        });
    }

    // Populate cards selection
    cardsSelection.innerHTML = '';

    // Show login prompt if user can't edit (guest in a guest-disabled mode)
    if (!canEdit && config.guestPromptText) {
        const loginPrompt = document.createElement('div');
        loginPrompt.style.cssText = `
            background: #fef3c7;
            border: 1px solid #f59e0b;
            color: #92400e;
            padding: 12px 16px;
            margin-bottom: 16px;
            border-radius: 8px;
            text-align: center;
            font-weight: 500;
            grid-column: 1 / -1;
            width: 100%;
        `;
        loginPrompt.textContent = config.guestPromptText;
        cardsSelection.appendChild(loginPrompt);
    }

    const sortedCards = [...cardsData.cards].sort((a, b) => a.name.localeCompare(b.name));
    sortedCards.forEach(card => {
        const isSelected = currentSelection.has(card.id);
        const cardDiv = document.createElement('div');
        cardDiv.className = `card-checkbox ${isSelected ? 'selected' : ''}`;
        const checkboxId = `${config.selectionId}-${card.id}`;
        cardDiv.innerHTML = `
            <div class="card-checkbox-row">
                <input type="checkbox" id="${checkboxId}" value="${card.id}" ${isSelected ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}>
                <label for="${checkboxId}" class="card-checkbox-label">${card.name}</label>
                <button type="button" class="card-detail-peek-btn" aria-label="查看詳情" title="查看詳情">ⓘ</button>
            </div>
            <img class="card-checkbox-image" alt="" src="assets/images/cards/${card.id}.png" onerror="this.style.display='none'">
        `;
        const checkbox = cardDiv.querySelector('input');
        if (canEdit) {
            checkbox.addEventListener('change', () => {
                cardDiv.classList.toggle('selected', checkbox.checked);
            });
        }
        const peekBtn = cardDiv.querySelector('.card-detail-peek-btn');
        peekBtn.addEventListener('click', (e) => {
            // Don't toggle the checkbox or close the host modal
            e.preventDefault();
            e.stopPropagation();
            showCardDetail(card.id);
        });
        const img = cardDiv.querySelector('.card-checkbox-image');
        if (img && canEdit) {
            img.addEventListener('click', (e) => {
                e.stopPropagation();
                checkbox.checked = !checkbox.checked;
                cardDiv.classList.toggle('selected', checkbox.checked);
            });
        }
        cardsSelection.appendChild(cardDiv);
    });

    // Enable/disable footer buttons based on edit permission
    if (!canEdit) {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
        toggleAllBtn.disabled = true;
        toggleAllBtn.style.opacity = '0.5';
        toggleAllBtn.style.cursor = 'not-allowed';
    } else {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
        toggleAllBtn.disabled = false;
        toggleAllBtn.style.opacity = '1';
        toggleAllBtn.style.cursor = 'pointer';
        const allSelected = sortedCards.every(card => currentSelection.has(card.id));
        toggleAllBtn.textContent = allSelected ? '全不選' : '全選';
    }

    // Search filter (combined with tag filter)
    searchInput.value = '';
    function applyFilters() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        cardsSelection.querySelectorAll('.card-checkbox').forEach(cardDiv => {
            const checkbox = cardDiv.querySelector('input[type="checkbox"]');
            if (!checkbox) return;
            const cardId = checkbox.value;
            const card = cardsData.cards.find(c => c.id === cardId);
            if (!card) return;
            const label = cardDiv.querySelector('.card-checkbox-label');
            if (!label) return;
            const matchesSearch = searchTerm === '' || label.textContent.toLowerCase().includes(searchTerm);
            let matchesTags = true;
            if (selectedTags.size > 0) {
                const cardTags = card.tags || [];
                matchesTags = [...selectedTags].every(t => cardTags.includes(t));
            }
            cardDiv.style.display = matchesSearch && matchesTags ? 'flex' : 'none';
        });
    }
    // Detach previous listener (each open call) to avoid duplicates
    if (searchInput._cardSelectionListener) {
        searchInput.removeEventListener('input', searchInput._cardSelectionListener);
    }
    searchInput._cardSelectionListener = applyFilters;
    searchInput.addEventListener('input', applyFilters);
}

// Open the "管理加入比較的卡片" modal
function openManageCardsModal() {
    _renderCardSelectionModal({
        selectionId: 'cards-selection',
        tagFilterChipsId: 'tag-filter-chips',
        searchInputId: 'search-cards-input',
        toggleAllBtnId: 'toggle-all-cards',
        saveBtnId: 'save-cards-btn',
        currentSelection: cardsInComparison,
        allowGuestEdit: true
    });

    updateApplyOwnedButtonState();

    const modal = document.getElementById('manage-cards-modal');
    modal.style.display = 'flex';
    disableBodyScroll();
}

// Open the "我的信用卡" modal (avatar dropdown) — shows the owned-cards overview.
// Guests are allowed to edit; data persists to localStorage and asks to merge on login.
function openMyOwnedCardsModal() {
    renderOwnedCardsOverview();

    const modal = document.getElementById('my-owned-cards-modal');
    modal.style.display = 'flex';
    disableBodyScroll();
}

// Render the owned-cards overview tiles (image + name, click opens card detail).
// Shows an empty-state prompt with a "新增信用卡" button when nothing is selected.
function renderOwnedCardsOverview() {
    const container = document.getElementById('owned-cards-overview');
    if (!container) return;
    container.innerHTML = '';

    const ownedCards = [...cardsData.cards]
        .filter(card => myOwnedCards.has(card.id))
        .sort((a, b) => a.name.localeCompare(b.name));

    const badge = document.getElementById('owned-count-badge');

    if (ownedCards.length === 0) {
        if (badge) badge.style.display = 'none';
        const empty = document.createElement('div');
        empty.className = 'owned-overview-empty';
        empty.innerHTML = `
            <p class="owned-overview-empty-text">你還沒有新增任何信用卡。</p>
            <button type="button" id="owned-overview-add-btn" class="manage-owned-btn">
                <span aria-hidden="true">＋</span> 新增信用卡
            </button>
        `;
        container.appendChild(empty);
        const addBtn = empty.querySelector('#owned-overview-add-btn');
        addBtn.addEventListener('click', openManageOwnedCardsModal);
        return;
    }

    const count = ownedCards.length;

    // Card count lives as quiet muted text after the modal title.
    if (badge) {
        badge.textContent = `・${count} 張`;
        badge.style.display = '';
    }

    // --- View 1: wallet stack — all cards at a glance, no names.
    // Tap a covered card to reveal its full face in place; tap a fully
    // visible card to open the solo view. ---
    const stack = document.createElement('div');
    stack.className = 'ow-stack';
    container.appendChild(stack);

    // "收合" pill: appears only while a card is revealed, folds the
    // stack fully closed again.
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'ow-collapse-btn';
    collapseBtn.textContent = '收合';
    collapseBtn.style.display = 'none';
    container.appendChild(collapseBtn);

    // --- View 2: solo card + personal info area (hidden until opened) ---
    const solo = document.createElement('div');
    solo.className = 'ow-solo';
    solo.style.display = 'none';
    container.appendChild(solo);

    const GAP = 40;    // breathing room under a revealed card
    let expanded = null;
    let soloIndex = 0;

    // Builds a card-face frame; portrait art is auto-rotated to landscape.
    const makeFace = (card) => {
        const frame = document.createElement('div');
        frame.className = 'ow-frame';
        const img = document.createElement('img');
        img.className = 'ow-img';
        img.alt = card.name;
        img.src = `assets/images/cards/${card.id}.png`;
        img.addEventListener('load', () => {
            if (img.naturalHeight > img.naturalWidth) frame.classList.add('ow-portrait');
        });
        img.addEventListener('error', () => {
            frame.classList.add('ow-noimg');
            frame.textContent = card.name;
        });
        frame.appendChild(img);
        return frame;
    };

    const slots = ownedCards.map((card, i) => {
        const slot = document.createElement('div');
        slot.className = 'ow-slot';
        slot.style.zIndex = String(i + 1);
        slot.setAttribute('role', 'button');
        slot.setAttribute('tabindex', '0');
        slot.setAttribute('aria-label', card.name);
        slot.appendChild(makeFace(card));
        // Tap-again affordance: pill fades in on the revealed card.
        const hint = document.createElement('div');
        hint.className = 'ow-hint';
        hint.textContent = '查看個人資訊 ›';
        slot.appendChild(hint);
        const activate = () => {
            // Fully visible cards (revealed, or the bottom-most) open solo view.
            if (i === expanded || i === count - 1) openSolo(i);
            else { expanded = i; layoutStack(); }
        };
        slot.addEventListener('click', activate);
        slot.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
        stack.appendChild(slot);
        return slot;
    });

    const layoutStack = () => {
        const h = stack.clientWidth / 1.586; // standard card aspect ratio
        // Budget ~320px for the whole stack: the more cards, the thinner
        // each visible strip (floor of 12px).
        const peek = Math.max(12, Math.min(40, Math.round((320 - h) / Math.max(1, count - 1))));
        let shift = 0, maxBottom = 0;
        slots.forEach((slot, i) => {
            slot.classList.toggle('ow-open', expanded === i);
            const top = i * peek + shift;
            slot.style.top = `${top}px`;
            maxBottom = Math.max(maxBottom, top + h);
            if (expanded === i) shift = h - peek + GAP;
        });
        stack.style.height = `${Math.ceil(maxBottom)}px`;
        collapseBtn.style.display = expanded === null ? 'none' : '';
    };

    collapseBtn.addEventListener('click', () => {
        expanded = null;
        layoutStack();
    });

    const openSolo = (i) => {
        soloIndex = i;
        renderSolo();
        stack.style.display = 'none';
        collapseBtn.style.display = 'none';
        solo.style.display = '';
    };

    const backToStack = () => {
        solo.style.display = 'none';
        stack.style.display = '';
        expanded = soloIndex; // keep the card you were viewing revealed
        layoutStack();
    };

    let soloToken = 0;

    const renderSolo = () => {
        const card = ownedCards[soloIndex];
        const token = ++soloToken;
        solo.innerHTML = '';

        const top = document.createElement('div');
        top.className = 'ow-solo-top';
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'ow-back';
        back.innerHTML = '‹ 所有卡片';
        back.addEventListener('click', backToStack);
        top.appendChild(back);
        solo.appendChild(top);

        const row = document.createElement('div');
        row.className = 'ow-solo-row';
        // Arrows and swipe wrap around (last → first, first → last).
        const step = (dir) => {
            soloIndex = (soloIndex + dir + count) % count;
            renderSolo();
        };
        const mkArrow = (dir) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ow-arrow';
            b.innerHTML = dir < 0 ? '‹' : '›';
            b.setAttribute('aria-label', dir < 0 ? '上一張' : '下一張');
            b.disabled = count <= 1;
            b.addEventListener('click', () => step(dir));
            return b;
        };
        row.appendChild(mkArrow(-1));
        const face = makeFace(card);
        face.classList.add('ow-solo-face');
        // Swipe left/right to switch cards.
        let sx = null;
        face.addEventListener('pointerdown', (e) => { sx = e.clientX; });
        face.addEventListener('pointerup', (e) => {
            if (sx === null) return;
            const dx = e.clientX - sx;
            sx = null;
            if (dx < -40 && count > 1) step(1);
            else if (dx > 40 && count > 1) step(-1);
        });
        row.appendChild(face);
        row.appendChild(mkArrow(1));
        solo.appendChild(row);

        const name = document.createElement('div');
        name.className = 'ow-solo-name';
        name.textContent = card.name;
        solo.appendChild(name);

        const dots = document.createElement('div');
        dots.className = 'ow-dots';
        ownedCards.forEach((_, i) => {
            const d = document.createElement('i');
            if (i === soloIndex) d.className = 'on';
            dots.appendChild(d);
        });
        solo.appendChild(dots);

        // --- Read-only personal info (editing lives in the card detail page) ---
        const info = document.createElement('div');
        info.className = 'ow-solo-info';
        const infoHead = document.createElement('div');
        infoHead.className = 'ow-info-head';
        infoHead.textContent = '個人化設定';
        info.appendChild(infoHead);
        const list = document.createElement('div');
        list.className = 'ow-info-list';
        list.innerHTML = '<div class="ow-info-loading">載入中…</div>';
        info.appendChild(list);
        const detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className = 'ow-detail-btn';
        detailBtn.textContent = '前往卡片介紹頁編輯 ›';
        detailBtn.addEventListener('click', () => showCardDetail(card.id));
        info.appendChild(detailBtn);
        solo.appendChild(info);

        fillSoloInfo(card, list, token);
    };

    const fillSoloInfo = async (card, list, token) => {
        const hasLevels = !!(card.hasLevels && card.levelSettings);
        // Each load falls back to a default if storage (e.g. Firebase) is
        // unavailable, so the panel always renders.
        const safe = (fn, fallback) => {
            try { return Promise.resolve(fn()).catch(() => fallback); }
            catch (_) { return Promise.resolve(fallback); }
        };
        const defaultLevel = hasLevels ? Object.keys(card.levelSettings)[0] : null;
        const [level, notes, feeWaived, creditLimit] = await Promise.all([
            hasLevels ? safe(() => getCardLevel(card.id, defaultLevel), defaultLevel) : Promise.resolve(null),
            safe(() => loadUserNotes(card.id), ''),
            safe(() => loadFeeWaiverStatus(card.id), false),
            safe(() => loadCreditLimit(card.id), null)
        ]);
        if (token !== soloToken) return; // user switched cards while loading

        list.innerHTML = '';
        const addRow = (label, value, cls) => {
            const row = document.createElement('div');
            row.className = 'ow-info-row';
            const l = document.createElement('span');
            l.className = 'ow-info-label';
            l.textContent = label;
            const v = document.createElement('span');
            v.className = 'ow-info-value' + (cls ? ' ' + cls : '');
            v.textContent = value;
            row.appendChild(l);
            row.appendChild(v);
            list.appendChild(row);
        };

        if (hasLevels && level) {
            const label = card.levelLabelFormat
                ? card.levelLabelFormat.replace('{level}', level)
                : level;
            addRow('卡片分級', label);
        }
        // 發卡組織／生日月份／童樂匯 are CUBE-specific settings today.
        if (card.id === 'cathay-cube') {
            addRow('發卡組織', cubeIssuer);
            addRow('生日月份', userBirthdayMonth ? `${userBirthdayMonth} 月` : '未填寫',
                userBirthdayMonth ? '' : 'ow-muted');
            addRow('童樂匯權益', isChildrenEligible ? '✓ 符合' : '不符合',
                isChildrenEligible ? 'ow-ok' : 'ow-muted');
        }
        addRow('免年費門檻', feeWaived ? '✓ 已達成' : '尚未達成', feeWaived ? 'ow-ok' : 'ow-warn');
        addRow('我的額度', creditLimit !== null ? `NT$ ${creditLimit.toLocaleString()}` : '未填寫',
            creditLimit !== null ? '' : 'ow-muted');

        const noteText = (notes || '').trim();
        const noteRow = document.createElement('div');
        noteRow.className = 'ow-info-note';
        const noteLabel = document.createElement('div');
        noteLabel.className = 'ow-info-label';
        noteLabel.textContent = '我的筆記';
        const noteBody = document.createElement('div');
        noteBody.className = 'ow-note-text' + (noteText ? '' : ' ow-note-empty');
        noteBody.textContent = noteText || '未填寫';
        noteRow.appendChild(noteLabel);
        noteRow.appendChild(noteBody);
        list.appendChild(noteRow);
    };

    // The modal isn't displayed yet when this runs; lay out on the next
    // frame (and again on resize) so clientWidth is real.
    requestAnimationFrame(() => requestAnimationFrame(layoutStack));
    if (renderOwnedCardsOverview._onResize) {
        window.removeEventListener('resize', renderOwnedCardsOverview._onResize);
    }
    renderOwnedCardsOverview._onResize = layoutStack;
    window.addEventListener('resize', renderOwnedCardsOverview._onResize);
}

// Open the "管理我的信用卡" modal (stacked on top of the overview).
function openManageOwnedCardsModal() {
    _renderCardSelectionModal({
        selectionId: 'owned-cards-selection',
        tagFilterChipsId: 'owned-tag-filter-chips',
        searchInputId: 'search-owned-cards-input',
        toggleAllBtnId: 'toggle-all-owned-cards',
        saveBtnId: 'save-owned-cards-btn',
        currentSelection: myOwnedCards,
        allowGuestEdit: true
    });

    const modal = document.getElementById('manage-owned-cards-modal');
    modal.style.display = 'flex';
    disableBodyScroll();

    // Always open at the top — don't keep the previous session's scroll.
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

    // 篩選標籤預設收合（需要時再點開）
    const tagSection = document.getElementById('owned-tag-filter-section');
    if (tagSection && !tagSection.classList.contains('collapsed')) {
        tagSection.classList.add('collapsed');
        const toggle = tagSection.querySelector('.tag-filter-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        const chips = document.getElementById('owned-tag-filter-chips');
        if (chips) chips.hidden = true;
    }
}

// Update the "套用我的信用卡選項" button state.
// Disabled only when no owned cards set (works for guests via localStorage too).
function updateApplyOwnedButtonState() {
    const btn = document.getElementById('apply-owned-cards-btn');
    if (!btn) return;
    if (myOwnedCards.size === 0) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.title = '先去頭像下拉選單設定「我的信用卡」';
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.title = '一鍵套用「我的信用卡」';
    }
}

// Setup the "我的信用卡" overview modal + the stacked "管理我的信用卡" modal.
function setupMyOwnedCardsModal() {
    const overviewModal = document.getElementById('my-owned-cards-modal');
    const manageModal = document.getElementById('manage-owned-cards-modal');
    if (!overviewModal || !manageModal) return;

    // --- Overview modal (layer 1) ---
    const closeOverviewBtn = document.getElementById('close-owned-modal');
    const manageBtn = document.getElementById('manage-owned-cards-btn');

    const closeOverview = () => {
        overviewModal.style.display = 'none';
        enableBodyScroll();
    };

    closeOverviewBtn.addEventListener('click', closeOverview);
    overviewModal.addEventListener('click', (e) => { if (e.target === overviewModal) closeOverview(); });
    manageBtn.addEventListener('click', openManageOwnedCardsModal);

    // --- Manage modal (layer 2, stacked on top of overview) ---
    const closeManageBtn = document.getElementById('close-manage-owned-modal');
    const cancelBtn = document.getElementById('cancel-owned-cards-btn');
    const saveBtn = document.getElementById('save-owned-cards-btn');
    const toggleAllBtn = document.getElementById('toggle-all-owned-cards');

    // Closes the manage modal only — overview underneath stays open.
    const closeManage = () => {
        manageModal.style.display = 'none';
        enableBodyScroll();
    };

    closeManageBtn.addEventListener('click', closeManage);
    cancelBtn.addEventListener('click', closeManage);
    manageModal.addEventListener('click', (e) => { if (e.target === manageModal) closeManage(); });

    // Top save button (on the 全選 row) proxies the bottom one so users
    // don't have to scroll to the footer to save.
    const saveBtnTop = document.getElementById('save-owned-cards-btn-top');
    if (saveBtnTop) saveBtnTop.addEventListener('click', () => saveBtn.click());

    saveBtn.addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('#owned-cards-selection input[type="checkbox"]');
        const newSelection = new Set();
        checkboxes.forEach(cb => { if (cb.checked) newSelection.add(cb.value); });
        myOwnedCards = newSelection;
        await saveMyOwnedCards();
        closeManage();
        // Refresh the overview underneath so it reflects the new selection
        renderOwnedCardsOverview();
    });

    toggleAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#owned-cards-selection input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        if (allChecked) {
            checkboxes.forEach(cb => { cb.checked = false; cb.parentElement.classList.remove('selected'); });
            toggleAllBtn.textContent = '全選';
        } else {
            checkboxes.forEach(cb => { cb.checked = true; cb.parentElement.classList.add('selected'); });
            toggleAllBtn.textContent = '全不選';
        }
    });
}

// Show card detail modal
// Helper function to convert tag name to CSS class
function getTagClass(tagName) {
    const tagMap = {
        '旅遊': 'tag-travel',
        '開車族': 'tag-driving',
        '餐飲': 'tag-restaurant',
        '交通': 'tag-transport',
        '網購': 'tag-online',
        '百貨公司': 'tag-department',
        '外送': 'tag-delivery',
        '娛樂': 'tag-entertainment',
        '行動支付': 'tag-payment',
        'AI工具': 'tag-ai',
        '便利商店': 'tag-convenience',
        '串流平台': 'tag-streaming',
        '超市': 'tag-supermarket',
        '藥妝': 'tag-pharmacy',
        '時尚品牌': 'tag-fashion',
        '直銷品牌': 'tag-direct-sales',
        '生活百貨': 'tag-lifestyle',
        '運動': 'tag-sports',
        '寵物': 'tag-pet',
        '親子': 'tag-family',
        '應用程式商店': 'tag-appstore',
        '飲食品牌': 'tag-food-brand',
        '美妝美髮保養品牌': 'tag-beauty-brand',
        '保費': 'tag-insurance'
    };
    return tagMap[tagName] || 'tag-default';
}

// Helper function to render card tags
function renderCardTags(tags) {
    if (!tags || tags.length === 0) return '';

    const tagsHtml = tags.map(tag =>
        `<span class="card-tag ${getTagClass(tag)}">${tag}</span>`
    ).join('');

    return `<div class="card-tags-container">${tagsHtml}</div>`;
}

// Render a 條件 line that clamps to a few lines and reveals a 展開/收起 toggle
// only when the text actually overflows (see initConditionClamps + CSS
// .cond-collapsible). Used in the card-detail activity cards so a long 條件
// doesn't blow up the card height (esp. now that rows are equal-height).
function renderConditionLine(text) {
    return `<div class="cashback-condition cond-collapsible">` +
        `<span class="cond-text">條件: ${text}</span>` +
        `<button type="button" class="cond-toggle" style="display:none;">...展開</button>` +
        `</div>`;
}

// After the detail content is in the DOM AND visible, reveal a toggle only on
// conditions whose text is actually clamped (overflowing). Must run while the
// modal is displayed, otherwise clientHeight/scrollHeight are 0.
function initConditionClamps(container) {
    if (!container) return;
    container.querySelectorAll('.cond-collapsible').forEach(el => {
        const text = el.querySelector('.cond-text');
        const btn = el.querySelector('.cond-toggle');
        if (!text || !btn) return;
        // Overflowing = content taller than the clamped box (2px tolerance)
        if (text.scrollHeight - text.clientHeight > 2) {
            btn.style.display = 'inline';
            btn.onclick = (e) => {
                e.stopPropagation();
                const expanded = el.classList.toggle('expanded');
                btn.textContent = expanded ? '收起' : '...展開';
            };
        } else {
            btn.style.display = 'none';
        }
    });
}

async function showCardDetail(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    if (!card) return;

    // 追蹤卡片詳情查看
    if (window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'view_card_detail', {
            card_id: cardId,
            card_name: card.name
        });
    }

    // 重置指定通路回饋的搜尋框
    const cashbackSearchInput = document.getElementById('cashback-search-input');
    if (cashbackSearchInput) cashbackSearchInput.value = '';
    const cashbackSearchEmpty = document.getElementById('cashback-search-empty');
    if (cashbackSearchEmpty) cashbackSearchEmpty.style.display = 'none';

    const modal = document.getElementById('card-detail-modal');

    // Update basic information
    document.getElementById('card-detail-title').textContent = card.name;

    // Header 申辦按鈕（桌機）＋ sticky 申辦列（手機）：兩者共用同一份 applyCta 資料。
    // 每次呼叫都要明確重設 hidden——上一張卡有 CTA、這張沒有時不能沿用舊狀態。
    const applyCta = cardsData && cardsData.cardApplyCtas && cardsData.cardApplyCtas[card.id];
    const applyLink = applyCta ? sanitizeUrl(applyCta.link) : '';
    const headerApplyBtn = document.getElementById('card-detail-apply-header-btn');
    const applyBar = document.getElementById('card-detail-apply-bar');
    const applyBarText = applyBar ? applyBar.querySelector('.card-detail-apply-bar-text') : null;
    const applyBarBtn = applyBar ? applyBar.querySelector('.card-detail-apply-bar-btn') : null;
    if (applyLink) {
        if (headerApplyBtn) {
            headerApplyBtn.hidden = false;
            headerApplyBtn.href = applyLink;
            headerApplyBtn.title = applyCta.text || '';
            headerApplyBtn.dataset.cardId = card.id;
            headerApplyBtn.dataset.cardName = card.name;
        }
        if (applyBar) {
            applyBar.hidden = false;
            if (applyBarText) {
                const text = applyCta.text || '';
                applyBarText.textContent = text;
                applyBarText.hidden = !text;
            }
            if (applyBarBtn) {
                applyBarBtn.href = applyLink;
                applyBarBtn.dataset.cardId = card.id;
                applyBarBtn.dataset.cardName = card.name;
            }
        }
    } else {
        if (headerApplyBtn) headerApplyBtn.hidden = true;
        if (applyBar) applyBar.hidden = true;
    }

    // Optional card image (assets/images/cards/<card.id>.png) — gracefully hides if missing
    const headerImg = document.getElementById('card-detail-image');
    if (headerImg) {
        headerImg.hidden = false;
        headerImg.onerror = () => { headerImg.hidden = true; };
        headerImg.src = `assets/images/cards/${card.id}.png`;
    }

    const fullNameLink = document.getElementById('card-full-name-link');
    fullNameLink.textContent = card.fullName || card.name;

    // Render tags after card full name
    const cardInfoSection = modal.querySelector('.card-info-section');
    const existingTags = cardInfoSection.querySelector('.card-tags-container');
    if (existingTags) {
        existingTags.remove();
    }

    if (card.tags && card.tags.length > 0) {
        const tagsHtml = renderCardTags(card.tags);
        const infoGrid = cardInfoSection.querySelector('.info-grid-2col');
        if (infoGrid) {
            infoGrid.insertAdjacentHTML('afterend', tagsHtml);
        }
    }

    // 直接顯示年費和免年費資訊
const annualFeeText = card.annualFee || '無資料';
const feeWaiverText = card.feeWaiver || '無資料';
const combinedFeeInfo = `${annualFeeText} ${feeWaiverText}`;

document.getElementById('card-annual-fee').textContent = combinedFeeInfo;
document.getElementById('card-fee-waiver').style.display = 'none';

    // Update cashback type and points expiry
    const cashbackTypeDiv = document.getElementById('card-cashback-type');
    const cashbackTypeExpirySection = document.getElementById('cashback-type-expiry-section');

    // 只在有資料時顯示此區塊
    if (card.basicCashbackType || card.pointsExpiry) {
        const parts = [];
        if (card.basicCashbackType) parts.push(card.basicCashbackType);
        if (card.pointsExpiry) parts.push(card.pointsExpiry);
        cashbackTypeDiv.textContent = parts.join(' | ');
        cashbackTypeExpirySection.style.display = 'flex';
    } else {
        cashbackTypeExpirySection.style.display = 'none';
    }

    // Update basic cashback
const basicCashbackDiv = document.getElementById('card-basic-cashback');
let basicContent = `<div class="cashback-detail-item">`;
basicContent += `<div class="cashback-rate">國內: <span class="cashback-rate-num">${card.basicCashback}%</span></div>`;
if (card.basicConditions) {
    basicContent += `<div class="cashback-condition">條件: ${card.basicConditions}</div>`;
}
basicContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
basicContent += `</div>`; // ← 這裡關閉第一個區塊

if (card.overseasCashback) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外: <span class="cashback-rate-num">${card.overseasCashback}%</span></div>`;
    basicContent += `<div class="cashback-condition">海外消費上限: 無上限</div>`;
    basicContent += `</div>`;
}

// Check for domesticBonusRate and overseasBonusRate in card level or levelSettings
let domesticBonusRate = card.domesticBonusRate;
let domesticBonusCap = card.domesticBonusCap;
let domesticConditions = card.domesticBonusConditions;
let overseasBonusRate = card.overseasBonusRate;
let overseasBonusCap = card.overseasBonusCap;
let overseasConditions = card.overseasBonusConditions;

// If card has levels, check levelSettings for bonus rates
if (card.hasLevels) {
    const levelNames = Object.keys(card.levelSettings);
    const defaultLevel = levelNames[0];
    const { data: levelData } = await resolveCardLevel(card, defaultLevel);

    if (levelData && levelData.domesticBonusRate !== undefined) {
        domesticBonusRate = levelData.domesticBonusRate;
        domesticBonusCap = levelData.domesticBonusCap;
        domesticConditions = levelData.domesticBonusConditions || card.domesticBonusConditions;
    }
    if (levelData && levelData.overseasBonusRate !== undefined) {
        overseasBonusRate = levelData.overseasBonusRate;
        overseasBonusCap = levelData.overseasBonusCap;
        overseasConditions = levelData.overseasBonusConditions || card.overseasBonusConditions;
    }
}

if (domesticBonusRate) {
    basicContent += `<div class="cashback-detail-item">`; // ← 新的區塊
    basicContent += `<div class="cashback-rate">國內加碼: <span class="cashback-rate-num">+${domesticBonusRate}%</span></div>`;
    if (domesticConditions) {
        basicContent += `<div class="cashback-condition">條件: ${domesticConditions}</div>`;
    }
    if (domesticBonusCap) {
        basicContent += `<div class="cashback-condition">消費上限: NT$${domesticBonusCap.toLocaleString()}</div>`;
    }
    basicContent += `</div>`; // ← 關閉國內加碼區塊
}

if (overseasBonusRate) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外加碼: <span class="cashback-rate-num">+${overseasBonusRate}%</span></div>`;
    if (overseasConditions) {
        basicContent += `<div class="cashback-condition">條件: ${overseasConditions}</div>`;
    }
    if (overseasBonusCap) {
        basicContent += `<div class="cashback-condition">消費上限: NT$${overseasBonusCap.toLocaleString()}</div>`;
    }
    basicContent += `</div>`;
}

basicCashbackDiv.innerHTML = basicContent;
    
    // Handle level selection for all cards with levels
    const cubeLevelSection = document.getElementById('cube-level-section');

    if (card.hasLevels) {
        const levelNames = Object.keys(card.levelSettings);
        const defaultLevel = levelNames[0];

        // Generate level selector HTML with note (通用支援)
        const { level: savedLevel, data: savedLevelData } = await resolveCardLevel(card, defaultLevel);

        const levelNoteText = savedLevelData['level-note'] || '';
        const noteFs = card.id === 'cathay-cube' ? '9.5px' : '11px';
        const noteMt = card.id === 'cathay-cube' ? '6px' : '8px';
        const levelNote = levelNoteText
            ? `<div id="level-note" style="font-size: ${noteFs}; color: #9ca3af; margin-top: ${noteMt}; word-wrap: break-word; white-space: normal; line-height: 1.5;">${levelNoteText}</div>`
            : `<div id="level-note" style="font-size: ${noteFs}; color: #9ca3af; margin-top: ${noteMt}; word-wrap: break-word; white-space: normal; line-height: 1.5;"></div>`;

        // Generate level rates info
        let levelRatesInfo = '';
        if (levelNames.length > 1 && card.id === 'cathay-cube') {
            // CUBE 卡用較小字體，配合統一設定區塊
            levelRatesInfo = '<div style="margin-left: 16px; flex-shrink: 0; padding: 5px 9px; border-left: 2px solid #e5e7eb; min-width: 0;">';
            levelRatesInfo += '<div style="font-size: 10.3px; color: #6b7280; font-weight: 600; margin-bottom: 3px;">各級別回饋率：</div>';
            levelNames.forEach(level => {
                const data = card.levelSettings[level];
                const displayRate = data.specialRate || data.rate || 0;
                levelRatesInfo += `<div style="font-size: 9.5px; color: #6b7280; line-height: 1.4; word-wrap: break-word;">• ${level}: ${displayRate}%</div>`;
            });
            levelRatesInfo += `<div style="font-size: 9px; color: #9ca3af; margin-top: 4px; font-style: italic; line-height: 1.3;">由分級決定回饋率的方案包含：玩數位、樂饗購、趣旅行</div>`;
            levelRatesInfo += '</div>';
        } else if (levelNames.length > 1) {
            levelRatesInfo = '<div style="margin-left: 24px; flex-shrink: 0; padding: 8px 12px; border-left: 3px solid #e5e7eb; background-color: #f9fafb; min-width: 0;">';
            levelRatesInfo += '<div style="font-size: 12px; color: #6b7280; font-weight: 600; margin-bottom: 4px;">各級別回饋率：</div>';

            if (card.id === 'dbs-eco') {
                // Simplified format for mobile compatibility
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}%</div>`;
                });
            } else if (card.id === 'sinopac-dawho') {
                // 永豐大戶卡自訂格式
                levelRatesInfo += `
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• 大戶Plus等級:</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">國內外加碼 4% (上限 NT$10,000 / NT$25,000 )</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">悠遊卡自動加值 5% (上限 NT$10,000)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-top: 4px;">• 大戶等級:</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">國內外加碼 2.5% (上限 NT$3,333 / NT$16,000)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">悠遊卡自動加值 3% (上限 NT$3,333)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-top: 4px;">• 大大等級: 只享有一般回饋</div>
                `;
            } else if (card.id === 'sinopac-coin') {
                // 永豐幣倍卡自訂格式
                levelRatesInfo += `
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">精選通路加碼 4%</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• Level 1：上限 NT$7,500</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• Level 2：上限 NT$20,000</div>
                `;
            } else {
                // Default formatting for other cards (like Uni card)
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}% (上限 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'})</div>`;
                });
            }
            levelRatesInfo += '</div>';
        }

        let levelSelectorHTML;

        if (card.id === 'cathay-cube') {
            // CUBE card: all three settings rows in one unified card
            const monthOptions = !currentUser ? '' :
                '<option value="">-- 未設定 --</option>' +
                Array.from({length: 12}, (_, i) => {
                    const m = i + 1;
                    return `<option value="${m}" ${userBirthdayMonth === m ? 'selected' : ''}>${m}月</option>`;
                }).join('');

            const birthdayRow = currentUser ? `
                <div>
                    <label style="font-weight: 600; flex-shrink: 0; font-size: 14px; color: #374151; margin-bottom: 4px;">我的生日月份：</label>
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                        <select id="birthday-month-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                            ${monthOptions}
                        </select>
                    </div>
                    <div style="font-size: 11px; color: #6b7280;">選取後，在您的生日月份會自動在比較結果納入「慶生月」方案的活動</div>
                </div>
            ` : `
                <div>
                    <span style="font-weight: 600; flex-shrink: 0; font-size: 14px; color: #374151;">我的生日月份：</span>
                    <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">輸入後將可以比較「慶生月」活動，請先登入才能設定生日月份</div>
                </div>
            `;

            levelSelectorHTML = `
                <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; padding: 12px 14px; margin-bottom: 16px;">
                    <div style="display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
                        <div style="flex-shrink: 0;">
                            <label style="font-weight: 600; margin-right: 6px; margin-bottom: 0; font-size: 14px; color: #374151;">選擇級別：</label>
                            <select id="card-level-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                                ${levelNames.map(level =>
                                    `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                                ).join('')}
                            </select>
                        </div>
                        ${levelRatesInfo}
                    </div>
                    ${levelNote}
                    <div style="border-top: 1px solid #e5e7eb; margin-top: 10px; padding-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px;">
                        ${birthdayRow}
                        <div>
                            <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 0; cursor: pointer; user-select: none;">
                                <input type="checkbox" id="children-eligible-checkbox"
                                    ${isChildrenEligible ? 'checked' : ''}
                                    style="width: 14px; height: 14px; cursor: pointer; accent-color: #3b82f6;">
                                <span style="font-weight: 600; font-size: 14px; color: #374151;">我符合「童樂匯」權益</span>
                            </label>
                            <div style="margin-top: 4px; padding-left: 20px; font-size: 11px; color: #9ca3af;">
                                勾選後才會在比較結果納入「童樂匯」方案的活動
                            </div>
                        </div>
                        <div>
                            <label for="cube-issuer-select" style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 14px; color: #374151;">發卡組織：</label>
                            <select id="cube-issuer-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                                ${['Visa', 'Mastercard', 'JCB'].map(issuer =>
                                    `<option value="${issuer}" ${issuer === cubeIssuer ? 'selected' : ''}>${issuer}</option>`
                                ).join('')}
                            </select>
                            <div style="margin-top: 4px; font-size: 11px; color: #9ca3af;">
                                選擇 JCB 才會在比較結果納入「JCB日本賞」方案的活動
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            levelSelectorHTML = `
                <div class="level-selector" style="margin-bottom: 16px;">
                    <div style="display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 8px;">
                        <div style="flex-shrink: 0;">
                            <label style="font-weight: 600; margin-right: 8px;">選擇級別：</label>
                            <select id="card-level-select" style="padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                                ${levelNames.map(level =>
                                    `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                                ).join('')}
                            </select>
                        </div>
                        ${levelRatesInfo}
                    </div>
                    ${levelNote}
                </div>
            `;
        }

        cubeLevelSection.innerHTML = levelSelectorHTML;
        cubeLevelSection.style.display = 'block';

        // Add change listener
        const levelSelect = document.getElementById('card-level-select');
        levelSelect.onchange = async function() {
            // Update level note (通用支援所有卡片)
            const levelNoteElement = document.getElementById('level-note');
            if (levelNoteElement) {
                const selectedLevelData = card.levelSettings[this.value];
                const noteText = selectedLevelData['level-note'] || '';
                levelNoteElement.textContent = noteText;
            }

            await saveCardLevel(card.id, this.value);
            // Refresh card detail display
            if (card.id === 'cathay-cube') {
                await updateCubeSpecialCashback(card);
            } else {
                // For other cards, just re-render the detail
                await showCardDetail(card.id);
            }
        };

        // 生日月份選擇器事件（CUBE卡，已登入）
        const birthdayMonthSelect = document.getElementById('birthday-month-select');
        if (birthdayMonthSelect) {
            birthdayMonthSelect.onchange = async function() {
                const val = this.value;
                await saveBirthdayMonth(val ? parseInt(val) : null);
            };
        }

        // 童樂匯勾選框事件（影響搜尋配對；不影響 modal 顯示，所以不需要重新渲染）
        const childrenCheckbox = document.getElementById('children-eligible-checkbox');
        if (childrenCheckbox) {
            childrenCheckbox.onchange = async function() {
                await saveChildrenEligible(this.checked);
            };
        }

        // 發卡組織選擇事件（影響搜尋配對；不影響 modal 顯示，所以不需要重新渲染）
        const cubeIssuerSelect = document.getElementById('cube-issuer-select');
        if (cubeIssuerSelect) {
            cubeIssuerSelect.onchange = async function() {
                await saveCubeIssuer(this.value);
            };
        }
    } else {
        cubeLevelSection.style.display = 'none';
    }
    
    // Update special cashback
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    let specialContent = '';

    if (card.hasLevels && card.id === 'cathay-cube') {
        specialContent = await generateCubeSpecialContent(card);
    } else if (card.hasLevels && card.specialItems && card.specialItems.length > 0) {
        // Handle generic level-based cards with specialItems (like Uni card and DBS Eco)
        const levelNames = Object.keys(card.levelSettings);
        const { data: levelData } = await resolveCardLevel(card, levelNames[0]);

        // First, display any cashbackRates if they exist (like DBS Eco's 10% cashback)
        // 2026-07-09 起逐筆顯示（不再按 rate+cap 合併），category 以 chip 顯示在回饋率旁
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            const rendered = await renderCashbackRatesIndividually(card, levelData, { idPrefix: 'lvA' });
            specialContent += rendered.html;

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups1 = rendered.upcoming;
            window._currentCard = card;
            window._currentLevelData1 = levelData;
        }

        // Then display the level-based cashback with specialItems
        specialContent += `<div class="cashback-detail-item">`;
        specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${levelData.rate}%</span> 回饋</div>`;
        if (levelData.cap) {
            specialContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(levelData.cap).toLocaleString()}</div>`;
        } else {
            specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
        }

        if (levelData.condition) {
            specialContent += renderConditionLine(levelData.condition);
        }

        // Show applicable merchants
        if (card.specialItems.length <= 30) {
            const merchantsList = card.specialItems.join('、');
            specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
        } else {
            const initialList = card.specialItems.slice(0, 30).join('、');
            const fullList = card.specialItems.join('、');
            const merchantsId = `uni-merchants-${card.id}`;
            const showAllId = `uni-show-all-${card.id}`;

            specialContent += `<div class="cashback-merchants">`;
            specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
            specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">... 顯示全部${card.specialItems.length}個</button>`;
            specialContent += `</div>`;
        }

        specialContent += `</div>`;
    } else if (card.hasLevels && (!card.specialItems || card.specialItems.length === 0)) {
        // Handle level-based cards without specialItems (or with empty specialItems array)
        const levelNames = Object.keys(card.levelSettings);
        const { level: savedLevel, data: levelData } = await resolveCardLevel(card, levelNames[0]);

        // Check if card also has cashbackRates (like DBS Eco card)
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            // 2026-07-09 起逐筆顯示（不再按 rate+cap 合併），category 以 chip 顯示在
            // 回饋率旁，回饋率為 getDisplayRate 加總值；cap 留空退回 levelData.cap（舊行為）
            const rendered = await renderCashbackRatesIndividually(card, levelData, { capFallbackToLevel: true, idPrefix: 'lvB' });
            specialContent += rendered.html;

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups2 = rendered.upcoming;
            window._currentCard = card;
            window._currentLevelData2 = levelData;

            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here
        } else {
            // Original logic for cards without cashbackRates
            specialContent += `<div class="cashback-detail-item">`;
            specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${levelData.rate}%</span> 回饋 (${savedLevel})</div>`;
            if (levelData.cap) {
                specialContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(levelData.cap).toLocaleString()}</div>`;
            } else {
                specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here

            specialContent += `</div>`;
        }
    } else if (card.cashbackRates && card.cashbackRates.length > 0) {
        // Separate active and upcoming rates for non-hasLevels cards
        const activeRates = [];
        const upcomingRates = [];

        for (const rate of card.cashbackRates) {
            if (rate.hideInDisplay) continue;

            const rateStatus = getRateStatus(rate.periodStart, rate.periodEnd);
            if (rateStatus === 'active' || rateStatus === 'always') {
                activeRates.push(rate);
            } else if (rateStatus === 'upcoming' && isUpcomingWithinDays(rate.periodStart, 30)) {
                upcomingRates.push(rate);
            }
        }

        // Sort active rates by DISPLAYED percentage descending (so a stacking
        // item like Apple Pay sorts by its summed 5%, not its raw designated 3%)
        const sortedRates = activeRates.sort((a, b) => {
            const aRate = getDisplayRate(card, a, parseCashbackRateSync(a.rate, null), null);
            const bRate = getDisplayRate(card, b, parseCashbackRateSync(b.rate, null), null);
            return bRate - aRate;
        });

        // Store upcoming rates for display in separate section
        if (upcomingRates.length > 0) {
            window._currentUpcomingGroups3 = await Promise.all(upcomingRates.map(async (rate) => {
                const parsedRate = await parseCashbackRate(rate.rate, card, null);
                const parsedCap = parseCashbackCap(rate.cap, card, null);
                return {
                    // stacking 模型顯示加總後的回饋率（與進行中活動一致）
                    parsedRate: getDisplayRate(card, rate, parsedRate, null),
                    parsedCap,
                    items: rate.items || [],
                    conditions: rate.conditions ? [{category: rate.category || '', conditions: rate.conditions}] : [],
                    period: rate.period,
                    periodStart: rate.periodStart,
                    periodEnd: rate.periodEnd,
                    status: 'upcoming',
                    category: rate.category
                };
            }));
            window._currentCard = card;
        }

        for (let index = 0; index < sortedRates.length; index++) {
            const rate = sortedRates[index];
            specialContent += `<div class="cashback-detail-item">`;

            // 解析 rate 值（支援 {specialRate} 和 {rate}，雖然 hasLevels=false 的卡片通常只有數字）
            const parsedRate = await parseCashbackRate(rate.rate, card, null);
            // For stacking models, show the summed rate (designated+basic+bonus),
            // same number the search-result card shows; otherwise show as-is.
            const displayRate = getDisplayRate(card, rate, parsedRate, null);

            // 解析 cap 值（支援 {cap}，hasLevels=false 的卡片通常只有數字）
            const parsedCap = parseCashbackCap(rate.cap, card, null);

            // Display rate with category in parentheses (with black color for consistency)
            const categoryStyle = rate.category ? getCategoryStyle(rate.category) : '';
            const categoryLabel = rate.category ? ` <span style="${categoryStyle}">${getCategoryDisplayName(rate.category)}</span>` : '';

            // Add ending soon badge if applicable
            let endingSoonBadge = '';
            if (rate.periodEnd && isEndingSoon(rate.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(rate.periodEnd);
                const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                endingSoonBadge = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            // stacking 模型加上「回饋組成」按鈕，解釋加總的來源
            const compBtn = rateCompositionButtonHtml(card, rate, parsedRate, parsedCap, null);
            specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${displayRate}%</span> 回饋${categoryLabel}${compBtn}${endingSoonBadge}</div>`;
            if (parsedCap) {
                if (rate.capDescription && card.id === 'taishin-richart') {
                    specialContent += `<div class="cashback-condition">消費上限: ${rate.capDescription}</div>`;
                } else {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${parsedCap.toLocaleString()}</div>`;
                }
            } else {
                specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            if (rate.conditions) {
                specialContent += renderConditionLine(rate.conditions);
            }

            if (rate.period) {
                specialContent += `<div class="cashback-condition">活動期間: ${rate.period}</div>`;
            }
            
            if (rate.items && rate.items.length > 0) {
                const merchantsId = `merchants-${card.id}-${index}`;
                const showAllId = `show-all-${card.id}-${index}`;
                
                // Special handling for Yushan Uni card exclusions
                let processedItems = [...rate.items];
                if (card.id === 'yushan-unicard') {
                    processedItems = rate.items.map(item => {
                        if (item === '街口' || item === '全支付') {
                            return item + '(排除超商)';
                        }
                        return item;
                    });
                }
                
                if (rate.items.length <= 5) {
                    // 少於20個直接顯示全部
                    const merchantsList = processedItems.join('、');
                    specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    // 超過20個顯示可展開的列表
                    const initialList = processedItems.slice(0, 5).join('、');
                    const fullList = processedItems.join('、');
                    
                    specialContent += `<div class="cashback-merchants">`;
                    specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${rate.items.length}個</button>`;
                    specialContent += `</div>`;
                }
            }

            specialContent += `</div>`;
        }
    } else {
        specialContent = '<div class="cashback-detail-item">無指定通路回饋</div>';
    }
    
    specialCashbackDiv.innerHTML = specialContent;

    // Update upcoming cashback section
    const upcomingSection = document.getElementById('card-upcoming-section');
    const upcomingCashbackDiv = document.getElementById('card-upcoming-cashback');
    const upcomingGroups = window._currentUpcomingGroups1 || window._currentUpcomingGroups2 || window._currentUpcomingGroupsCube || window._currentUpcomingGroups3 || [];
    const upcomingCard = window._currentCard;
    const upcomingLevelData = window._currentLevelData1 || window._currentLevelData2;

    if (upcomingGroups.length > 0) {
        let upcomingContent = '';

        // upcomingGroups1/2 are [key, value] tuples from Map.entries();
        // upcomingGroups3/Cube are plain object arrays. Normalize both to [key, value].
        const groupsToDisplay = upcomingGroups.map((g, i) => Array.isArray(g) ? g : [i, g]);

        for (const [groupKey, group] of groupsToDisplay) {
            upcomingContent += `<div class="cashback-detail-item upcoming-activity">`;

            // 顯示回饋率和即將開始標籤（包含 category 如果有的話）
            const daysUntil = getDaysUntilStart(group.periodStart);
            const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
            const categoryStyle = group.category ? getCategoryStyle(group.category) : '';
            const categoryText = group.category ? ` <span style="${categoryStyle}">${getCategoryDisplayName(group.category)}</span>` : '';
            upcomingContent += `<div class="cashback-rate"><span class="cashback-rate-num">${group.parsedRate}%</span> 回饋${categoryText} <span class="upcoming-badge">即將開始 (${daysText})</span></div>`;

            if (group.parsedCap) {
                upcomingContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(group.parsedCap).toLocaleString()}</div>`;
            } else {
                upcomingContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            if (group.period) {
                upcomingContent += `<div class="cashback-condition">活動期間: ${group.period}</div>`;
            }

            // 顯示所有通路
            if (group.items.length > 0) {
                const uniqueItems = [...new Set(group.items)];
                const merchantsId = `upcoming-merchants-${upcomingCard.id}-group-${groupKey}`;
                const showAllId = `upcoming-show-all-${upcomingCard.id}-group-${groupKey}`;

                if (uniqueItems.length <= 5) {
                    const merchantsList = uniqueItems.join('、');
                    upcomingContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = uniqueItems.slice(0, 5).join('、');
                    const fullList = uniqueItems.join('、');

                    upcomingContent += `<div class="cashback-merchants">`;
                    upcomingContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    upcomingContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${uniqueItems.length}個</button>`;
                    upcomingContent += `</div>`;
                }
            }

            // 按 category 顯示各通路條件
            if (group.conditions.length > 0) {
                if (upcomingCard.id === 'yushan-unicard') {
                    const conditionsId = `upcoming-conditions-${upcomingCard.id}-group-${groupKey}`;
                    const showConditionsId = `upcoming-show-conditions-${upcomingCard.id}-group-${groupKey}`;

                    let conditionsContent = '';
                    for (const cond of group.conditions) {
                        conditionsContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${cond.conditions}</div>`;
                    }

                    upcomingContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                    upcomingContent += `<button class="show-more-btn" id="${showConditionsId}" onclick="toggleConditions('${conditionsId}', '${showConditionsId}')" style="padding: 4px 12px; font-size: 13px;">▼ 查看各通路詳細條件</button>`;
                    upcomingContent += `<div id="${conditionsId}" style="display: none; margin-top: 8px;">`;
                    upcomingContent += conditionsContent;
                    upcomingContent += `</div>`;
                    upcomingContent += `</div>`;
                } else {
                    upcomingContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                    upcomingContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 條件：</div>`;

                    for (const cond of group.conditions) {
                        upcomingContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${cond.conditions}</div>`;
                    }

                    upcomingContent += `</div>`;
                }
            }

            upcomingContent += `</div>`;
        }

        upcomingCashbackDiv.innerHTML = upcomingContent;
        upcomingSection.style.display = 'block';
    } else {
        upcomingSection.style.display = 'none';
    }

    // Clean up temporary variables
    delete window._currentUpcomingGroups1;
    delete window._currentUpcomingGroups2;
    delete window._currentUpcomingGroupsCube;
    delete window._currentUpcomingGroups3;
    delete window._currentCard;
    delete window._currentLevelData1;
    delete window._currentLevelData2;

    // Update coupon cashback
    const couponSection = document.getElementById('card-coupon-section');
    const couponCashbackDiv = document.getElementById('card-coupon-cashback');
    
    if (card.couponCashbacks && card.couponCashbacks.length > 0) {
        let couponContent = '';

        // 處理每個 coupon，計算實際回饋率
        let couponIndex = 0;
        for (const coupon of card.couponCashbacks) {
            const actualRate = await calculateCouponRate(coupon, card);
            const couponStatus = getRateStatus(coupon.periodStart, coupon.periodEnd);

            couponContent += `<div class="cashback-detail-item">`;

            // 顯示回饋率和標籤
            let badges = '';

            // 即將開始標籤
            if (couponStatus === 'upcoming' && coupon.periodStart) {
                const daysUntil = getDaysUntilStart(coupon.periodStart);
                const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
                badges += ` <span class="upcoming-badge">即將開始 (${daysText})</span>`;
            }

            // 即將結束標籤
            if ((couponStatus === 'active' || couponStatus === 'always') && coupon.periodEnd && isEndingSoon(coupon.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(coupon.periodEnd);
                const daysText = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : `${daysUntil}天後`;
                badges += ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            couponContent += `<div class="cashback-rate"><span class="cashback-rate-num">${actualRate}%</span> 回饋${badges}</div>`;

            // 消費上限（如果有）
            if (coupon.cap) {
                couponContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(coupon.cap).toLocaleString()}</div>`;
            } else {
                couponContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // 活動期間
            if (coupon.period) {
                couponContent += `<div class="cashback-condition">活動期間: ${coupon.period}</div>`;
            }

            // 適用通路（超過 5 個時收起顯示）
            if (coupon.merchant) {
                const merchantItems = coupon.merchant.split(',').map(m => m.trim()).filter(m => m);
                if (merchantItems.length <= 5) {
                    const merchantsList = merchantItems.join('、');
                    couponContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const merchantsId = `coupon-merchants-${card.id}-${couponIndex}`;
                    const showAllId = `coupon-show-all-${card.id}-${couponIndex}`;
                    const initialList = merchantItems.slice(0, 5).join('、');
                    const fullList = merchantItems.join('、');
                    couponContent += `<div class="cashback-merchants">`;
                    couponContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    couponContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${merchantItems.length}個</button>`;
                    couponContent += `</div>`;
                }
            }

            // 條件顯示（統一格式；內容過長時可收起）
            if (coupon.conditions) {
                couponContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                couponContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 條件：</div>`;
                couponContent += `<div class="cond-collapsible" style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;"><span class="cond-text">• ${coupon.conditions}</span><button type="button" class="cond-toggle" style="display:none;">...展開</button></div>`;
                couponContent += `</div>`;
            }

            couponContent += `</div>`;
            couponIndex++;
        }

        couponCashbackDiv.innerHTML = couponContent;
        couponSection.style.display = 'block';
    } else {
        couponSection.style.display = 'none';
    }

    // Display parking benefits
    const benefitsSection = document.getElementById('card-benefits-section');
    const benefitsContent = document.getElementById('card-benefits-content');

    if (cardsData.benefits && cardsData.benefits.length > 0) {
        // Find benefits for this card
        const cardBenefits = cardsData.benefits.filter(b => b.id === card.id && b.active);

        if (cardBenefits.length > 0) {
            let benefitsHtml = '';

            cardBenefits.forEach(benefit => {
                benefitsHtml += `<div class="cashback-detail-item">`;
                benefitsHtml += `<div class="cashback-rate" style="color: #2563eb; margin-bottom: 8px;">${benefit.benefit_desc}</div>`;

                if (benefit.merchants && benefit.merchants.length > 0) {
                    benefitsHtml += `<div class="cashback-condition parking-strong-line">地點: ${benefit.merchants.join('、')}</div>`;
                }

                if (benefit.conditions) {
                    benefitsHtml += `<div class="cashback-condition parking-strong-line">條件: ${benefit.conditions}</div>`;
                }

                if (benefit.benefit_period) {
                    benefitsHtml += `<div class="cashback-condition">期限: ${benefit.benefit_period}</div>`;
                }

                if (benefit.notes) {
                    benefitsHtml += `<div class="cashback-condition">備註: ${benefit.notes}</div>`;
                }

                benefitsHtml += `</div>`;
            });

            benefitsContent.innerHTML = benefitsHtml;
            benefitsSection.style.display = 'block';
        } else {
            benefitsSection.style.display = 'none';
        }
    } else {
        benefitsSection.style.display = 'none';
    }

    // Display new cardholder promos for this card (hidden if user owns the card)
    renderCardDetailPromos(card);

    // Load and setup user notes
    currentNotesCardId = card.id;
    const notesTextarea = document.getElementById('user-notes-input');
    const saveIndicator = document.getElementById('save-indicator');
    
    // 讀取當前筆記
    loadUserNotes(card.id).then(notes => {
        notesTextarea.value = notes;
    });
    
    // 設置輸入監聽
    notesTextarea.oninput = (e) => {
        const notes = e.target.value;
        
        // 自動本地備份
        autoBackupNotes(card.id, notes);
        
        // 更新按鈕狀態
        updateSaveButtonState(card.id, notes);
    };
    
    // 設置儲存按鈕監聽
    const saveBtn = document.getElementById('save-notes-btn');
    saveBtn.onclick = () => {
        const currentNotes = notesTextarea.value;
        saveUserNotes(card.id, currentNotes);
    };

    // 設置免年費狀態功能
    setupFeeWaiverStatus(card.id);

    // 設置我的額度輸入
    setupCreditLimit(card.id);

    // 設置結帳日期功能
    setupBillingDates(card.id);

    // Show modal
    // 級別切換等重繪路徑會在 modal 已開啟時重呼叫 showCardDetail()；
    // 已開啟就不再 disableBodyScroll()，否則鎖深度多加、closeModal 只解一次，頁面會鎖死
    const wasAlreadyOpen = modal.style.display === 'flex';
    modal.style.display = 'flex';
    if (!wasAlreadyOpen) disableBodyScroll();

    // 滾動到最上面（不記憶上一個 modal 的捲動位置）
    // .modal-content 才是真正的捲動容器（overflow-y: auto; max-height: 80vh）
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

    // Reveal 展開 toggles only on conditions that actually overflow — must run
    // now that the modal is displayed (measurements need layout).
    initConditionClamps(document.getElementById('card-special-cashback'));
    initConditionClamps(document.getElementById('card-coupon-cashback'));

    // Wire the sticky section nav after sections are rendered.
    setupCardDetailNav(modalContent);

    // Setup close events
    const closeBtn = document.getElementById('close-card-detail');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
        currentNotesCardId = null;
    };
    
    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// Generate CUBE special content based on selected level
async function generateCubeSpecialContent(card) {
    // Get level from Firestore or default to first level
    const defaultLevel = Object.keys(card.levelSettings)[0];
    const { level: savedLevel, data: levelSettings } = await resolveCardLevel(card, defaultLevel);

    // 使用 specialRate（如果有）或 rate
    const specialRate = levelSettings.specialRate || levelSettings.rate;

    // Separate active and upcoming cashbackRates
    const upcomingRates = [];
    if (card.cashbackRates) {
        card.cashbackRates.forEach(rate => {
            const status = getRateStatus(rate.periodStart, rate.periodEnd);
            if (status === 'upcoming' && isUpcomingWithinDays(rate.periodStart, 30)) {
                upcomingRates.push(rate);
            }
        });
    }

    // Store upcoming rates for display in separate section
    if (upcomingRates.length > 0) {
        const upcomingGroups = upcomingRates.map(rate => {
            const parsedRate = rate.rate === '{specialRate}' ? specialRate : rate.rate;
            return {
                parsedRate,
                parsedCap: null,
                items: rate.items || [],
                conditions: rate.conditions && rate.category ? [{category: rate.category, conditions: rate.conditions}] : [],
                period: rate.period,
                periodStart: rate.periodStart,
                periodEnd: rate.periodEnd,
                status: 'upcoming',
                category: rate.category
            };
        });

        // Merge upcoming activities with same rate, category, and period (CUBE card only)
        const mergedGroups = new Map();
        upcomingGroups.forEach(group => {
            // Create merge key: rate + category + period
            const mergeKey = `${group.parsedRate}-${group.category || 'no-category'}-${group.period || 'no-period'}`;

            if (mergedGroups.has(mergeKey)) {
                // Merge with existing group
                const existing = mergedGroups.get(mergeKey);
                existing.items = [...existing.items, ...group.items];

                // Merge conditions - list all conditions as bullet points
                if (group.conditions.length > 0) {
                    existing.conditions = [...existing.conditions, ...group.conditions];
                }
            } else {
                // First time seeing this rate+category+period combination
                mergedGroups.set(mergeKey, {...group});
            }
        });

        window._currentUpcomingGroupsCube = Array.from(mergedGroups.values());
        window._currentCard = card;
    }

    let content = '';

    // Add CUBE-specific birthday note at the beginning
    let birthdayNoteText;
    let birthdayNoteColor;
    if (!currentUser) {
        birthdayNoteText = '※ 「慶生月」方案：請登入並設定生日月份，即可在生日當月自動納入比較';
        birthdayNoteColor = '#9ca3af';
    } else if (!userBirthdayMonth) {
        birthdayNoteText = '※ 「慶生月」方案：在上方設定生日月份後，將在您的生日月份自動納入比較';
        birthdayNoteColor = '#9ca3af';
    } else if (isBirthdayMonth) {
        birthdayNoteText = `🎂 本月是您的生日月份（${userBirthdayMonth}月），「慶生月」方案已自動納入比較！`;
        birthdayNoteColor = '#be185d';
    } else {
        birthdayNoteText = `※ 「慶生月」方案：已設定在您的生日月份（${userBirthdayMonth}月）自動納入比較`;
        birthdayNoteColor = '#9ca3af';
    }
    content += `
        <div class="cube-birthday-note" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px; margin-bottom: 16px;">
            <div style="color: ${birthdayNoteColor}; font-size: 11px; line-height: 1.5; font-style: italic;">
                ${birthdayNoteText}
            </div>
        </div>
    `;

    // 依照回饋率高低順序顯示，變動的玩數位樂饗購趣旅行放在最後

    // 1. 童樂匯 10% 回饋 (固定最高) - 只顯示進行中的
    const childrenRate10 = card.cashbackRates?.find(rate => {
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        return rate.rate === 10.0 && rate.category === '切換「童樂匯」方案' && (status === 'active' || status === 'always');
    });
    if (childrenRate10) {
        content += `<div class="cashback-detail-item">`;

        // Add ending soon badge if applicable
        let endingSoonBadge10 = '';
        if (childrenRate10.periodEnd && isEndingSoon(childrenRate10.periodEnd, 10)) {
            const daysUntil = getDaysUntilEnd(childrenRate10.periodEnd);
            const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
            endingSoonBadge10 = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }

        const categoryStyle10 = getCategoryStyle('童樂匯');
        content += `<div class="cashback-rate"><span class="cashback-rate-num">10%</span> 回饋 <span style="${categoryStyle10}">${getCategoryDisplayName('童樂匯')}</span>${endingSoonBadge10}</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;
        if (childrenRate10.conditions) {
            content += renderConditionLine(childrenRate10.conditions);
        }
        if (childrenRate10.period) {
            content += `<div class="cashback-condition">活動期間: ${childrenRate10.period}</div>`;
        }
        const items10 = childrenRate10.items;
        const merchantsList10 = items10.join('、');
        if (items10.length <= 5) {
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList10}</div>`;
        } else {
            const initialList10 = items10.slice(0, 5).join('、');
            const merchantsId10 = 'cube-children10-merchants';
            const showAllId10 = 'cube-children10-show-all';
            content += `<div class="cashback-merchants">`;
            content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId10}">${initialList10}</span>`;
            content += `<button class="show-more-btn" id="${showAllId10}" onclick="toggleMerchants('${merchantsId10}', '${showAllId10}', '${escapeForOnclick(initialList10)}', '${escapeForOnclick(merchantsList10)}')">... 顯示全部${items10.length}個</button>`;
            content += `</div>`;
        }
        content += `</div>`;
    }

    // 2. 童樂匯 5% 回饋 - 只顯示進行中的
    const childrenRate5 = card.cashbackRates?.find(rate => {
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        return rate.rate === 5.0 && rate.category === '切換「童樂匯」方案' && (status === 'active' || status === 'always');
    });
    if (childrenRate5) {
        content += `<div class="cashback-detail-item">`;

        // Add ending soon badge if applicable
        let endingSoonBadge5 = '';
        if (childrenRate5.periodEnd && isEndingSoon(childrenRate5.periodEnd, 10)) {
            const daysUntil = getDaysUntilEnd(childrenRate5.periodEnd);
            const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
            endingSoonBadge5 = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }

        const categoryStyle5 = getCategoryStyle('童樂匯');
        content += `<div class="cashback-rate"><span class="cashback-rate-num">5%</span> 回饋 <span style="${categoryStyle5}">${getCategoryDisplayName('童樂匯')}</span>${endingSoonBadge5}</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;
        if (childrenRate5.conditions) {
            content += renderConditionLine(childrenRate5.conditions);
        }
        if (childrenRate5.period) {
            content += `<div class="cashback-condition">活動期間: ${childrenRate5.period}</div>`;
        }
        const items5 = childrenRate5.items;
        const merchantsList5 = items5.join('、');
        if (items5.length <= 5) {
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList5}</div>`;
        } else {
            const initialList5 = items5.slice(0, 5).join('、');
            const merchantsId5 = 'cube-children5-merchants';
            const showAllId5 = 'cube-children5-show-all';
            content += `<div class="cashback-merchants">`;
            content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId5}">${initialList5}</span>`;
            content += `<button class="show-more-btn" id="${showAllId5}" onclick="toggleMerchants('${merchantsId5}', '${showAllId5}', '${escapeForOnclick(initialList5)}', '${escapeForOnclick(merchantsList5)}')">... 顯示全部${items5.length}個</button>`;
            content += `</div>`;
        }
        content += `</div>`;
    }

    // 3. Level變動的特殊通路 - 從 cashbackRates 中讀取並按類別分組顯示
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        const categories = ['玩數位', '樂饗購', '趣旅行'];
        const categoryRates = new Map();

        // 從 cashbackRates 中收集各類別的項目（只包含進行中的活動）
        card.cashbackRates.forEach(rate => {
            const status = getRateStatus(rate.periodStart, rate.periodEnd);
            const isActive = (status === 'active' || status === 'always');

            if (rate.category && categories.some(cat => rate.category.includes(cat)) && isActive) {
                // 找出是哪個類別
                const matchedCategory = categories.find(cat => rate.category.includes(cat));
                if (!categoryRates.has(matchedCategory)) {
                    categoryRates.set(matchedCategory, {
                        items: [],
                        rate: rate.rate,
                        cap: rate.cap,
                        period: rate.period
                    });
                }
                const categoryData = categoryRates.get(matchedCategory);
                if (rate.items) {
                    categoryData.items.push(...rate.items);
                }
            }
        });

        // 按類別順序顯示
        categories.forEach(category => {
            if (categoryRates.has(category)) {
                const categoryData = categoryRates.get(category);
                const items = [...new Set(categoryData.items)]; // 去重

                if (items.length > 0) {
                    content += `<div class="cashback-detail-item">`;
                    const categoryStyle = getCategoryStyle(category);

                    // 解析 rate（支援 {specialRate} placeholder）
                    let displayRate = categoryData.rate;
                    if (categoryData.rate === '{specialRate}') {
                        displayRate = specialRate;
                    } else if (typeof categoryData.rate === 'string' && categoryData.rate.startsWith('{')) {
                        // 其他 placeholder，從 levelSettings 解析
                        const fieldName = categoryData.rate.slice(1, -1);
                        displayRate = levelSettings[fieldName] || categoryData.rate;
                    }

                    content += `<div class="cashback-rate"><span class="cashback-rate-num">${displayRate}%</span> 回饋 <span style="${categoryStyle}">${getCategoryDisplayName(category)}</span></div>`;
                    content += `<div class="cashback-condition">消費上限: ${categoryData.cap ? `NT$${Math.floor(categoryData.cap).toLocaleString()}` : '無上限'}</div>`;

                    if (categoryData.period) {
                        content += `<div class="cashback-condition">活動期間: ${categoryData.period}</div>`;
                    }

                    const merchantsList = items.join('、');
                    if (items.length <= 5) {
                        content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = items.slice(0, 5).join('、');
                        const merchantsId = `cube-merchants-${category}-${savedLevel}`;
                        const showAllId = `cube-show-all-${category}-${savedLevel}`;

                        content += `<div class="cashback-merchants">`;
                        content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(merchantsList)}')">... 顯示全部${items.length}個</button>`;
                        content += `</div>`;
                    }
                    content += `</div>`;
                }
            }
        });
    }

    // 5. 其他 cashbackRates（如 LINE PAY 2%）- 放在最後，只顯示進行中的
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        const otherRates = card.cashbackRates
            .filter(rate => {
                const status = getRateStatus(rate.periodStart, rate.periodEnd);
                return !rate.hideInDisplay &&
                    rate.category !== '切換「童樂匯」方案' &&
                    (status === 'active' || status === 'always');  // 只顯示進行中的
            })
            .sort((a, b) => {
                // 先解析 rate 以支援 {specialRate} 和 {rate} 的排序
                const aRate = parseCashbackRateSync(a.rate, levelSettings);
                const bRate = parseCashbackRateSync(b.rate, levelSettings);
                return bRate - aRate;
            });

        // Merge active rates with same parsedRate, category, and period (CUBE card only)
        const mergedActiveRates = new Map();
        for (const rate of otherRates) {
            const parsedRate = await parseCashbackRate(rate.rate, card, levelSettings);
            const parsedCap = parseCashbackCap(rate.cap, card, levelSettings);

            // Create merge key: rate + category + period
            const mergeKey = `${parsedRate}-${rate.category || 'no-category'}-${rate.period || 'no-period'}`;

            if (mergedActiveRates.has(mergeKey)) {
                // Merge with existing rate
                const existing = mergedActiveRates.get(mergeKey);
                if (rate.items) {
                    existing.items = [...existing.items, ...rate.items];
                }
                // Merge conditions
                if (rate.conditions) {
                    if (existing.conditions) {
                        existing.conditions += '\n' + rate.conditions;
                    } else {
                        existing.conditions = rate.conditions;
                    }
                }
            } else {
                // First time seeing this rate+category+period combination
                mergedActiveRates.set(mergeKey, {
                    parsedRate,
                    parsedCap,
                    items: rate.items ? [...rate.items] : [],
                    conditions: rate.conditions || '',
                    period: rate.period,
                    periodEnd: rate.periodEnd,
                    category: rate.category
                });
            }
        }

        // Display merged rates
        let index = 0;
        for (const [mergeKey, mergedRate] of mergedActiveRates) {
            content += `<div class="cashback-detail-item">`;

            // 显示回饋率，如果有 category 则显示在括号中（使用動態樣式）
            const categoryStyleOther = mergedRate.category ? getCategoryStyle(mergedRate.category) : '';
            const categoryLabel = mergedRate.category ? ` <span style="${categoryStyleOther}">${getCategoryDisplayName(mergedRate.category)}</span>` : '';

            // Add ending soon badge if applicable
            let endingSoonBadgeOther = '';
            if (mergedRate.periodEnd && isEndingSoon(mergedRate.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(mergedRate.periodEnd);
                const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                endingSoonBadgeOther = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            content += `<div class="cashback-rate"><span class="cashback-rate-num">${mergedRate.parsedRate}%</span> 回饋${categoryLabel}${endingSoonBadgeOther}</div>`;

            // 显示消費上限
            if (mergedRate.parsedCap) {
                content += `<div class="cashback-condition">消費上限: NT$${mergedRate.parsedCap.toLocaleString()}</div>`;
            } else {
                content += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // 显示條件
            if (mergedRate.conditions) {
                content += renderConditionLine(mergedRate.conditions);
            }

            // 显示活動期間
            if (mergedRate.period) {
                content += `<div class="cashback-condition">活動期間: ${mergedRate.period}</div>`;
            }

            // 显示適用通路
            if (mergedRate.items && mergedRate.items.length > 0) {
                const merchantsId = `cube-other-merchants-${index}`;
                const showAllId = `cube-other-show-all-${index}`;

                if (mergedRate.items.length <= 5) {
                    const merchantsList = mergedRate.items.join('、');
                    content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = mergedRate.items.slice(0, 5).join('、');
                    const fullList = mergedRate.items.join('、');

                    content += `<div class="cashback-merchants">`;
                    content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${mergedRate.items.length}個</button>`;
                    content += `</div>`;
                }
            }

            content += `</div>`;
            index++;
        }
    }

    return content;
}

// Update CUBE special cashback when level changes
async function updateCubeSpecialCashback(card) {
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    const newContent = await generateCubeSpecialContent(card);
    specialCashbackDiv.innerHTML = newContent;
    // Re-evaluate condition clamps for the freshly rendered content
    initConditionClamps(specialCashbackDiv);
}

// Escape a string for embedding as a single-quoted JS literal inside an HTML onclick attribute.
// Apostrophes (e.g. "Tomod's") would otherwise close the single-quoted string early.
function escapeForOnclick(s) {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 切換通路顯示展開/收起
function toggleMerchants(merchantsId, buttonId, shortList, fullList) {
    const merchantsElement = document.getElementById(merchantsId);
    const buttonElement = document.getElementById(buttonId);

    if (!merchantsElement || !buttonElement) return;

    const isExpanded = buttonElement.textContent.includes('收起');

    if (isExpanded) {
        // 收起
        merchantsElement.textContent = shortList;
        const totalCount = fullList.split('、').length;
        buttonElement.textContent = `... 顯示全部${totalCount}個`;
    } else {
        // 展開
        merchantsElement.textContent = fullList;
        buttonElement.textContent = '收起';
    }
}

// 即時過濾「指定通路回饋」中的活動卡片
// 只在已渲染的 DOM 上做過濾（不重新計算或 fetch），效能 < 5ms
function filterCashbackItems(searchTerm) {
    const term = (searchTerm || '').toLowerCase().trim();
    const container = document.getElementById('card-special-cashback');
    const emptyMsg = document.getElementById('cashback-search-empty');
    if (!container) return;

    const items = container.querySelectorAll('.cashback-detail-item');
    let visibleCount = 0;

    items.forEach(item => {
        if (!term) {
            item.style.display = '';
            visibleCount++;
            return;
        }
        // 比對整個卡片的 textContent，包含通路名稱、category 標籤、條件等
        const text = item.textContent.toLowerCase();
        if (text.includes(term)) {
            item.style.display = '';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });

    if (emptyMsg) {
        emptyMsg.style.display = (term && visibleCount === 0) ? 'block' : 'none';
    }
}

// 切換條件顯示/隱藏
function toggleConditions(conditionsId, buttonId) {
    const conditionsElement = document.getElementById(conditionsId);
    const buttonElement = document.getElementById(buttonId);

    if (!conditionsElement || !buttonElement) return;

    const isHidden = conditionsElement.style.display === 'none';

    if (isHidden) {
        // 展開
        conditionsElement.style.display = 'block';
        buttonElement.textContent = '▲ 收起條件';
    } else {
        // 收起
        conditionsElement.style.display = 'none';
        buttonElement.textContent = '▼ 查看各通路詳細條件';
    }
}

// 將toggleMerchants和toggleConditions暴露到全局作用域，確保onclick可以訪問
window.toggleMerchants = toggleMerchants;
window.toggleConditions = toggleConditions;

// 用戶筆記相關功能
let currentNotesCardId = null;
let lastSavedNotes = new Map(); // 記錄每張卡最後儲存的內容

// 讀取用戶筆記 (註: 筆記僅依賴cardId，與cardsInComparison狀態無關)
async function loadUserNotes(cardId) {
    const cacheKey = (auth && auth.currentUser) ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;

    if (!auth || !auth.currentUser) {
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
    
    try {
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        const notes = docSnap.exists() ? docSnap.data().notes : '';
        
        // 更新本地快取和記錄
        localStorage.setItem(cacheKey, notes);
        lastSavedNotes.set(cardId, notes);
        
        return notes;
    } catch (error) {
        console.log('讀取筆記失敗，使用本地快取:', error);
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
}

// 本地儲存（自動備份）
function autoBackupNotes(cardId, notes) {
    const cacheKey = (auth && auth.currentUser) ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    localStorage.setItem(cacheKey, notes);
}

// 手動儲存筆記
async function saveUserNotes(cardId, notes) {
    const saveBtn = document.getElementById('save-notes-btn');
    const saveIndicator = document.getElementById('save-indicator');
    const btnText = document.querySelector('.btn-text');
    const btnIcon = document.querySelector('.btn-icon');
    
    if (!auth || !auth.currentUser) {
        // 未登入時僅儲存在本地
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // 更新按鈕狀態
        saveBtn.disabled = true;
        saveIndicator.textContent = '已儲存在本地 (未登入)';
        saveIndicator.style.color = '#6b7280';
        return true;
    }
    
    try {
        // 更新按鈕為儲存中狀態
        saveBtn.className = 'save-notes-btn saving';
        saveBtn.disabled = true;
        if (btnIcon) btnIcon.textContent = '⏳';
        if (btnText) btnText.textContent = '儲存中...';
        saveIndicator.textContent = '';
        
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            notes: notes,
            updatedAt: new Date(),
            cardId: cardId
        });
        
        // 也儲存在本地作為快取
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // 成功狀態
        saveBtn.className = 'save-notes-btn success';
        if (btnIcon) btnIcon.textContent = '✓';
        if (btnText) btnText.textContent = '已儲存';
        saveIndicator.textContent = '✓ 雲端同步成功';
        saveIndicator.style.color = '#10b981';

        // 2秒後恢復正常狀態
        setTimeout(() => {
            saveBtn.className = 'save-notes-btn';
            saveBtn.disabled = true; // 沒有變更時保持禁用
            if (btnIcon) btnIcon.textContent = '💾';
            if (btnText) btnText.textContent = '儲存筆記';
            saveIndicator.textContent = '';
        }, 2000);
        
        return true;
        
    } catch (error) {
        console.error('雲端儲存失敗:', error);
        
        // 失敗時仍然儲存在本地
        autoBackupNotes(cardId, notes);
        
        // 錯誤狀態
        saveBtn.className = 'save-notes-btn';
        saveBtn.disabled = false; // 可以再次嘗試
        if (btnIcon) btnIcon.textContent = '⚠️';
        if (btnText) btnText.textContent = '重試儲存';
        saveIndicator.textContent = '雲端儲存失敗，已本地儲存';
        saveIndicator.style.color = '#dc2626';

        // 5秒後恢復
        setTimeout(() => {
            if (btnIcon) btnIcon.textContent = '💾';
            if (btnText) btnText.textContent = '儲存筆記';
            saveIndicator.textContent = '';
        }, 5000);
        
        return false;
    }
}

// ============================================
// 消費配卡表功能
// ============================================

// 生成唯一 ID
function generateMappingId() {
    return 'mapping_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 讀取用戶的消費配卡表
async function loadSpendingMappings() {
    // 檢查是否有登入用戶
    if (!currentUser) {
        // 未登入用戶
        userSpendingMappings = readLocalJSONArray('spendingMappings');
        console.log('📋 [配卡] 未登入，從本地載入:', userSpendingMappings.length, '筆');
        return userSpendingMappings;
    }

    try {
        // 從 Firestore 的 users collection 讀取
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().spendingMappings) {
                const mappings = docSnap.data().spendingMappings;
                userSpendingMappings = mappings;
                console.log('✅ [配卡] 從 Firestore 讀取成功:', mappings.length, '筆');

                // 更新本地快取
                localStorage.setItem(`spendingMappings_${currentUser.uid}`, JSON.stringify(mappings));
                return mappings;
            }
        }

        // Fallback to localStorage if Firestore fails or no data
        userSpendingMappings = readLocalJSONArray(`spendingMappings_${currentUser.uid}`);
        console.log('📦 [配卡] 從本地快取載入 (fallback):', userSpendingMappings.length, '筆');
        return userSpendingMappings;
    } catch (error) {
        console.error('❌ [配卡] 讀取失敗，使用本地快取:', error);
        userSpendingMappings = readLocalJSONArray(`spendingMappings_${currentUser.uid}`);
        return userSpendingMappings;
    }
}

// 保存用戶的消費配卡表
async function saveSpendingMappings(mappings) {
    userSpendingMappings = mappings;

    // 檢查是否有登入用戶
    if (!currentUser) {
        // 未登入用戶只保存在本地
        localStorage.setItem('spendingMappings', JSON.stringify(mappings));
        console.log('💾 [配卡] 未登入，僅保存到本地');
        return true;
    }

    try {
        // 保存到本地快取
        localStorage.setItem(`spendingMappings_${currentUser.uid}`, JSON.stringify(mappings));
        console.log('✅ [配卡] 已保存到本地快取:', mappings.length, '筆');

        // 保存到 Firestore 的 users collection
        if (window.db && window.doc && window.setDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            await window.setDoc(docRef, {
                spendingMappings: mappings,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('☁️ [配卡] 已同步到 Firestore:', mappings.length, '筆');
        }

        return true;
    } catch (error) {
        console.error('❌ [配卡] Firestore 保存失敗:', error);
        // 失敗時至少本地已保存
        return false;
    }
}

// 添加配對
async function addMapping(cardId, cardName, merchant, cashbackRate, periodEnd = null, periodStart = null) {
    // 檢查是否有登入用戶
    if (!currentUser) {
        alert('請先登入才能使用此功能');
        return null;
    }

    const now = Date.now();
    const newMapping = {
        id: generateMappingId(),
        cardId: cardId,
        cardName: cardName,
        merchant: merchant,
        cashbackRate: cashbackRate,
        createdAt: now,
        lastCheckedRate: cashbackRate, // 記錄最後檢查的回饋率
        lastCheckedTime: now, // 記錄最後檢查的時間
        hasChanged: false, // 初始為未變動
        periodEnd: periodEnd, // 活動結束日期
        periodStart: periodStart // 活動開始日期
    };

    console.log('➕ [配卡] 新增配對:', cardName, '-', merchant, cashbackRate + '%', periodEnd ? `(到期: ${periodEnd})` : '');
    userSpendingMappings.push(newMapping);
    const saved = await saveSpendingMappings(userSpendingMappings);

    if (!saved) {
        console.warn('⚠️ [配卡] 保存到雲端失敗，但已保存到本地');
    }

    return newMapping;
}

// 刪除配對
async function removeMapping(mappingId) {
    console.log('🗑️ [配卡] 刪除配對:', mappingId);
    userSpendingMappings = userSpendingMappings.filter(m => m.id !== mappingId);
    const saved = await saveSpendingMappings(userSpendingMappings);

    if (!saved) {
        console.warn('⚠️ [配卡] 刪除後保存到雲端失敗，但已保存到本地');
    }
}

// 檢查是否已釘選
function isPinned(cardId, merchant) {
    return userSpendingMappings.some(m =>
        m.cardId === cardId && m.merchant === merchant
    );
}

// 切換釘選狀態
async function togglePin(button, cardId, cardName, merchant, rate, periodEnd = null, periodStart = null) {
    // 檢查是否有登入用戶
    if (!currentUser) {
        alert('登入後即可使用釘選功能，幫您記錄個人配卡！');
        return;
    }

    const alreadyPinned = isPinned(cardId, merchant);

    if (alreadyPinned) {
        // 取消釘選
        const mapping = userSpendingMappings.find(m =>
            m.cardId === cardId && m.merchant === merchant
        );
        if (mapping) {
            await removeMapping(mapping.id);
            button.classList.remove('pinned');
            button.title = '釘選此配對';
            showToast('已取消釘選', button.closest('.card-result'));

            // 追蹤取消釘選事件
            if (window.logEvent && window.firebaseAnalytics) {
                window.logEvent(window.firebaseAnalytics, 'unpin_card', {
                    card_id: cardId,
                    card_name: cardName,
                    merchant: merchant,
                    rate: rate
                });
            }
        }
    } else {
        // 釘選
        const newMapping = await addMapping(cardId, cardName, merchant, rate, periodEnd, periodStart);
        if (newMapping) {
            button.classList.add('pinned');
            button.title = '取消釘選';

            // 顯示成功動畫
            showPinSuccessAnimation(button);

            // 追蹤釘選事件
            if (window.logEvent && window.firebaseAnalytics) {
                window.logEvent(window.firebaseAnalytics, 'pin_card', {
                    card_id: cardId,
                    card_name: cardName,
                    merchant: merchant,
                    rate: rate
                });
            }
        }
    }
}

// 顯示釘選成功動畫
function showPinSuccessAnimation(button) {
    const cardElement = button.closest('.card-result');

    // 1. 顯示提示
    showToast('已加入我的配卡✓', cardElement);

    // 2. 顯示 +1 徽章動畫
    showPlusBadgeAnimation();
}

// 顯示 +1 徽章動畫
function showPlusBadgeAnimation() {
    const btn = document.getElementById('my-mappings-btn');
    if (!btn) return;

    // 創建 +1 徽章
    const badge = document.createElement('span');
    badge.className = 'pin-badge';
    badge.textContent = '+1';
    btn.appendChild(badge);

    // 從小放大動畫
    badge.animate([
        { transform: 'scale(0)', opacity: 0 },
        { transform: 'scale(1.2)', opacity: 1, offset: 0.5 },
        { transform: 'scale(1)', opacity: 1 }
    ], {
        duration: 400,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    });

    // 閃爍效果
    setTimeout(() => {
        badge.animate([
            { opacity: 1 },
            { opacity: 0.6 },
            { opacity: 1 }
        ], {
            duration: 300
        });
    }, 400);

    // 1.5秒後淡出並移除
    setTimeout(() => {
        const fadeOut = badge.animate([
            { opacity: 1 },
            { opacity: 0 }
        ], {
            duration: 300,
            fill: 'forwards'
        });
        fadeOut.onfinish = () => badge.remove();
    }, 1500);
}

// 顯示小提示
function showToast(message, cardElement) {
    const toast = document.createElement('div');
    toast.className = 'pin-toast';
    toast.textContent = message;
    cardElement.appendChild(toast);

    // 淡入
    setTimeout(() => toast.classList.add('show'), 10);

    // 2秒後淡出並移除
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// 優化商家名稱顯示（去重、選擇最完整的名稱）
function optimizeMerchantName(merchant) {
    if (!merchant) return '';

    // 如果包含頓號，說明有多個項目
    if (merchant.includes('、')) {
        const items = merchant.split('、').map(s => s.trim()).filter(Boolean);

        // 去重
        const uniqueItems = [...new Set(items)];

        // 如果只剩一個，直接返回
        if (uniqueItems.length === 1) {
            return uniqueItems[0];
        }

        // 選擇最長的名稱（通常是最完整的）
        // 例如："街口支付" vs "街口" -> 選擇 "街口支付"
        const sorted = uniqueItems.sort((a, b) => b.length - a.length);

        // 檢查是否有包含關係
        const longest = sorted[0];
        const filtered = sorted.filter(item => {
            // 如果 item 被 longest 包含，則過濾掉
            return item === longest || !longest.includes(item);
        });

        // 如果過濾後只剩一個，返回它
        if (filtered.length === 1) {
            return filtered[0];
        }

        // 否則返回前兩個
        return filtered.slice(0, 2).join('、');
    }

    return merchant;
}

// 輔助函數：從 cardsData 中查找活動的到期日
function findActivityPeriod(cardId, merchant) {
    const card = cardsData?.cards.find(c => c.id === cardId);
    if (!card) return null;

    const merchantLower = merchant.toLowerCase();

    // 搜尋 cashbackRates
    if (card.cashbackRates) {
        for (const rate of card.cashbackRates) {
            if (rate.items) {
                for (const item of rate.items) {
                    if (item.toLowerCase().includes(merchantLower) || merchantLower.includes(item.toLowerCase())) {
                        return {
                            periodEnd: rate.periodEnd || null,
                            periodStart: rate.periodStart || null
                        };
                    }
                }
            }
        }
    }

    // 搜尋 specialItems
    if (card.specialItems) {
        for (const item of card.specialItems) {
            if (item.toLowerCase().includes(merchantLower) || merchantLower.includes(item.toLowerCase())) {
                // specialItems 通常沒有獨立的 period，使用 card 層級的
                return {
                    periodEnd: null,
                    periodStart: null
                };
            }
        }
    }

    // 搜尋 generalItems (CUBE 卡)
    if (card.generalItems) {
        for (const item of card.generalItems) {
            if (item.toLowerCase().includes(merchantLower) || merchantLower.includes(item.toLowerCase())) {
                return {
                    periodEnd: null,
                    periodStart: null
                };
            }
        }
    }

    return null;
}

// 打開我的配卡表 Modal
async function openMyMappingsModal() {
    const modal = document.getElementById('my-mappings-modal');
    const mappingsList = document.getElementById('mappings-list');
    const searchInput = document.getElementById('mappings-search');

    if (!modal || !mappingsList) return;

    // 渲染配卡表
    renderMappingsList();

    // 顯示 Modal
    modal.style.display = 'flex';
    disableBodyScroll();

    // 綁定關閉按鈕
    const closeBtn = document.getElementById('close-mappings-modal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    // 點擊背景關閉
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            enableBodyScroll();
        }
    };

    // 搜尋功能
    if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = () => {
            renderMappingsList(searchInput.value.trim());
        };
    }
}

// 渲染配卡表清單（標準表格式，支援拖曳排序）
// 排序狀態
let mappingsSortConfig = {
    column: null,  // null, 'rate', 'expiry'
    direction: 'asc'  // 'asc' or 'desc'
};

function renderMappingsList(searchTerm = '') {
    const mappingsList = document.getElementById('mappings-list');
    if (!mappingsList) return;

    // 保存當前滾動位置（用於排序後恢復）
    const existingWrapper = mappingsList.querySelector('.mappings-table-wrapper');
    const savedScrollLeft = existingWrapper ? existingWrapper.scrollLeft : 0;

    // 篩選
    let filteredMappings = userSpendingMappings;
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filteredMappings = userSpendingMappings.filter(m =>
            m.merchant.toLowerCase().includes(term) ||
            m.cardName.toLowerCase().includes(term)
        );
    }

    if (filteredMappings.length === 0) {
        mappingsList.innerHTML = `
            <div class="mappings-empty">
                <svg width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                    <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                </svg>
                <p>${searchTerm ? '找不到符合的配對' : '還沒有配卡記錄'}</p>
                <p style="font-size: 12px; margin-top: 8px;">查詢商家後，點擊結果卡片的釘選按鈕即可添加</p>
            </div>
        `;
        return;
    }

    // 確保每個 mapping 都有 order 欄位（用於拖曳排序）
    filteredMappings.forEach((mapping, index) => {
        if (mapping.order === undefined) {
            mapping.order = index;
        }
    });

    // 排序邏輯
    if (mappingsSortConfig.column === 'rate') {
        // 按回饋率排序
        filteredMappings.sort((a, b) => {
            const rateA = parseFloat(a.cashbackRate) || 0;
            const rateB = parseFloat(b.cashbackRate) || 0;
            return mappingsSortConfig.direction === 'asc' ? rateA - rateB : rateB - rateA;
        });
    } else if (mappingsSortConfig.column === 'expiry') {
        // 按活動到期日排序
        filteredMappings.sort((a, b) => {
            // 如果沒有到期日，放在最後
            const dateA = a.periodEnd ? parseISODate(a.periodEnd) : new Date('9999-12-31');
            const dateB = b.periodEnd ? parseISODate(b.periodEnd) : new Date('9999-12-31');
            return mappingsSortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
        });
    } else {
        // 按 order 排序（用戶自訂順序）
        filteredMappings.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    // 取得目前台灣今天（用於計算到期狀態）
    const taiwanToday = parseISODate(getTaiwanToday());

    // 排序指示器
    const getSortIcon = (column) => {
        if (mappingsSortConfig.column !== column) {
            return '<span class="sort-icon">⇅</span>';
        }
        return mappingsSortConfig.direction === 'asc'
            ? '<span class="sort-icon active">↑</span>'
            : '<span class="sort-icon active">↓</span>';
    };

    // 渲染標準表格（包裹在可滾動容器中）
    let html = `
        <div class="mappings-table-wrapper">
            <table class="mappings-table">
                <thead>
                    <tr>
                        <th class="drag-handle-header"></th>
                        <th class="merchant-column">商家</th>
                        <th class="card-name-column">卡片名稱</th>
                        <th class="rate-column sortable" data-sort="rate">回饋率 ${getSortIcon('rate')}</th>
                        <th class="expiry-column sortable" data-sort="expiry">活動到期日 ${getSortIcon('expiry')}</th>
                        <th class="delete-column"></th>
                    </tr>
                </thead>
                <tbody>
    `;

    filteredMappings.forEach((mapping, index) => {
        const merchant = optimizeMerchantName(mapping.merchant);

        // 計算活動到期日顯示
        let expiryDisplay = '—';  // 預設顯示破折號
        let expiryClass = '';
        let foundPeriod = null;

        // 如果 mapping 沒有 periodEnd，嘗試從 cardsData 中查找
        if (!mapping.periodEnd) {
            foundPeriod = findActivityPeriod(mapping.cardId, mapping.merchant);
            if (foundPeriod && foundPeriod.periodEnd) {
                mapping.periodEnd = foundPeriod.periodEnd;
                mapping.periodStart = foundPeriod.periodStart;

                // 在背景異步更新到 Firestore/localStorage
                setTimeout(() => {
                    saveSpendingMappings(userSpendingMappings).catch(err => {
                        console.warn('⚠️ 背景更新 mapping periodEnd 失敗:', err);
                    });
                }, 100);
            }
        }

        if (mapping.periodEnd) {
            try {
                const endDate = parseISODate(mapping.periodEnd);
                const diffDays = Math.ceil((endDate - taiwanToday) / 86400000);

                if (diffDays < 0) {
                    // 已過期：紅色文字
                    expiryDisplay = `${mapping.periodEnd} (已過期)`;
                    expiryClass = 'expired';
                } else {
                    // 未過期：只顯示日期
                    expiryDisplay = mapping.periodEnd;
                }
            } catch (error) {
                console.error('❌ Date parsing error:', error, { periodEnd: mapping.periodEnd });
                expiryDisplay = mapping.periodEnd;  // 解析失敗時直接顯示原始日期
            }
        }

        html += `
            <tr class="mapping-row"
                draggable="true"
                data-mapping-id="${mapping.id}"
                data-index="${index}">
                <td class="drag-handle">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
                    </svg>
                </td>
                <td class="merchant-cell">${merchant}</td>
                <td class="card-cell">${mapping.cardName}</td>
                <td class="rate-cell">${mapping.cashbackRate}%</td>
                <td class="expiry-cell ${expiryClass}">${expiryDisplay}</td>
                <td class="delete-cell">
                    <button class="mapping-delete-btn"
                            data-mapping-id="${mapping.id}"
                            title="刪除">×</button>
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    mappingsList.innerHTML = html;

    // 恢復滾動位置
    const newWrapper = mappingsList.querySelector('.mappings-table-wrapper');
    if (newWrapper && savedScrollLeft > 0) {
        // 使用 setTimeout 確保 DOM 已完全渲染
        setTimeout(() => {
            newWrapper.scrollLeft = savedScrollLeft;
        }, 0);
    }

    // 綁定排序按鈕
    mappingsList.querySelectorAll('th.sortable').forEach(th => {
        th.style.cursor = 'pointer';
        th.onclick = () => {
            const column = th.dataset.sort;
            if (mappingsSortConfig.column === column) {
                // 切換排序方向
                mappingsSortConfig.direction = mappingsSortConfig.direction === 'asc' ? 'desc' : 'asc';
            } else {
                // 新欄位，預設升序
                mappingsSortConfig.column = column;
                mappingsSortConfig.direction = 'asc';
            }
            renderMappingsList(document.getElementById('mappings-search')?.value || '');
        };
    });

    // 綁定刪除按鈕
    mappingsList.querySelectorAll('.mapping-delete-btn').forEach(btn => {
        btn.onclick = async (e) => {
            e.preventDefault();
            const mappingId = btn.dataset.mappingId;
            if (confirm('確定要刪除這個配對嗎？')) {
                // 在刪除前取得 mapping 資訊用於追蹤
                const mapping = userSpendingMappings.find(m => m.id === mappingId);

                await removeMapping(mappingId);
                renderMappingsList(document.getElementById('mappings-search')?.value || '');

                // 更新結果卡片的釘選狀態（如果結果還在顯示）
                updatePinButtonsState();

                // 追蹤從我的配卡中刪除事件
                if (mapping && window.logEvent && window.firebaseAnalytics) {
                    window.logEvent(window.firebaseAnalytics, 'remove_mapping', {
                        card_id: mapping.cardId,
                        card_name: mapping.cardName,
                        merchant: mapping.merchant,
                        rate: mapping.cashbackRate
                    });
                }
            }
        };
    });

    // 綁定拖曳排序功能
    initDragAndDrop();
}

// 初始化拖曳排序功能
function initDragAndDrop() {
    const rows = document.querySelectorAll('.mapping-row');
    let draggedRow = null;
    let draggedIndex = null;

    rows.forEach(row => {
        row.addEventListener('dragstart', function(e) {
            draggedRow = this;
            draggedIndex = parseInt(this.dataset.index);
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', this.innerHTML);
        });

        row.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (this !== draggedRow) {
                this.classList.add('drag-over');
            }
        });

        row.addEventListener('dragleave', function(e) {
            this.classList.remove('drag-over');
        });

        row.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('drag-over');

            if (this !== draggedRow) {
                const targetIndex = parseInt(this.dataset.index);

                // 更新陣列順序
                reorderMappings(draggedIndex, targetIndex);
            }
        });

        row.addEventListener('dragend', function(e) {
            this.classList.remove('dragging');

            // 移除所有 drag-over class
            rows.forEach(r => r.classList.remove('drag-over'));
        });
    });
}

// 重新排序配卡表
async function reorderMappings(fromIndex, toIndex) {
    // 取得目前的篩選結果
    const searchTerm = document.getElementById('mappings-search')?.value || '';
    let filteredMappings = userSpendingMappings;

    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filteredMappings = userSpendingMappings.filter(m =>
            m.merchant.toLowerCase().includes(term) ||
            m.cardName.toLowerCase().includes(term)
        );
    }

    // 確保有 order 欄位並排序
    filteredMappings.forEach((mapping, index) => {
        if (mapping.order === undefined) {
            mapping.order = index;
        }
    });
    filteredMappings.sort((a, b) => (a.order || 0) - (b.order || 0));

    // 移動元素
    const [movedItem] = filteredMappings.splice(fromIndex, 1);
    filteredMappings.splice(toIndex, 0, movedItem);

    // 重新分配 order
    filteredMappings.forEach((mapping, index) => {
        mapping.order = index;
    });

    // 保存並重新渲染
    await saveSpendingMappings(userSpendingMappings);
    renderMappingsList(searchTerm);
}

// 更新釘選按鈕狀態
function updatePinButtonsState() {
    document.querySelectorAll('.pin-btn').forEach(btn => {
        const cardId = btn.dataset.cardId;
        const merchant = btn.dataset.merchant;
        const pinned = isPinned(cardId, merchant);

        if (pinned) {
            btn.classList.add('pinned');
            btn.title = '取消釘選';
        } else {
            btn.classList.remove('pinned');
            btn.title = '釘選此配對';
        }
    });
}

// 檢查筆記是否有變更
function hasNotesChanged(cardId, currentNotes) {
    const lastSaved = lastSavedNotes.get(cardId) || '';
    return currentNotes !== lastSaved;
}

// 更新儲存按鈕狀態
function updateSaveButtonState(cardId, currentNotes) {
    const saveBtn = document.getElementById('save-notes-btn');
    if (!saveBtn) return;
    
    const hasChanged = hasNotesChanged(cardId, currentNotes);
    saveBtn.disabled = !hasChanged;
    
    if (hasChanged && !saveBtn.className.includes('saving')) {
        saveBtn.className = 'save-notes-btn';
    }
}

// 免年費狀態相關功能

// 讀取免年費狀態
async function loadFeeWaiverStatus(cardId) {
    if (!currentUser) {
        const localKey = `feeWaiver_local_${cardId}`;
        return localStorage.getItem(localKey) === 'true';
    }

    try {
        // 從 Firestore 的 users collection 讀取
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().feeWaiverStatus) {
                const isWaived = docSnap.data().feeWaiverStatus[cardId] || false;
                // 更新本地快取
                const localKey = `feeWaiver_${currentUser.uid}_${cardId}`;
                localStorage.setItem(localKey, isWaived.toString());
                console.log('✅ [免年費] 從 Firestore 讀取:', cardId, isWaived);
                return isWaived;
            }
        }

        // Fallback to localStorage
        const localKey = `feeWaiver_${currentUser.uid}_${cardId}`;
        const saved = localStorage.getItem(localKey) === 'true';
        console.log('📦 [免年費] 從本地讀取 (fallback):', cardId, saved);
        return saved;
    } catch (error) {
        console.error('❌ 讀取免年費狀態失敗:', error);
        const localKey = `feeWaiver_${currentUser.uid}_${cardId}`;
        return localStorage.getItem(localKey) === 'true';
    }
}

// 儲存免年費狀態
async function saveFeeWaiverStatus(cardId, isWaived) {
    const localKey = `feeWaiver_${currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, isWaived.toString());
    console.log('✅ [免年費] 已保存到本地快取:', cardId, isWaived);

    if (!currentUser) return;

    try {
        // 保存到 Firestore 的 users collection
        if (window.db && window.doc && window.setDoc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);

            // 先讀取現有的 feeWaiverStatus
            const docSnap = await window.getDoc(docRef);
            const existingData = docSnap.exists() ? docSnap.data() : {};
            const feeWaiverStatus = existingData.feeWaiverStatus || {};

            // 更新特定卡片的狀態
            feeWaiverStatus[cardId] = isWaived;

            await window.setDoc(docRef, {
                feeWaiverStatus: feeWaiverStatus,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('☁️ [免年費] 已同步到 Firestore:', cardId, isWaived);
        }
    } catch (error) {
        console.error('❌ [免年費] Firestore 保存失敗:', error);
    }
}

// 設置免年費狀態功能
async function setupFeeWaiverStatus(cardId) {
    const checkbox = document.getElementById('fee-waiver-checked');
    if (!checkbox) return;

    // 讀取當前狀態
    const isWaived = await loadFeeWaiverStatus(cardId);
    checkbox.checked = isWaived;

    // 設置變更監聽
    checkbox.onchange = (e) => {
        const newStatus = e.target.checked;
        saveFeeWaiverStatus(cardId, newStatus);

        // 更新視覺提示 (可選)
        const checkboxLabel = e.target.parentElement.querySelector('.checkbox-label');
        if (newStatus) {
            checkboxLabel.style.color = '#10b981';
            setTimeout(() => {
                checkboxLabel.style.color = '';
            }, 1000);
        }
    };
}

// 我的額度相關功能（選填金額；比照免年費狀態的儲存方式）

// 讀取我的額度（回傳數字，未填寫回傳 null）
async function loadCreditLimit(cardId) {
    const parse = (v) => {
        const n = Number(v);
        return v !== null && v !== '' && Number.isFinite(n) && n > 0 ? n : null;
    };

    if (!currentUser) {
        return parse(localStorage.getItem(`creditLimit_local_${cardId}`));
    }

    try {
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists() && docSnap.data().creditLimits) {
                const amount = parse(docSnap.data().creditLimits[cardId]);
                const localKey = `creditLimit_${currentUser.uid}_${cardId}`;
                localStorage.setItem(localKey, amount === null ? '' : String(amount));
                return amount;
            }
        }
        return parse(localStorage.getItem(`creditLimit_${currentUser.uid}_${cardId}`));
    } catch (error) {
        console.error('❌ 讀取我的額度失敗:', error);
        return parse(localStorage.getItem(`creditLimit_${currentUser.uid}_${cardId}`));
    }
}

// 儲存我的額度（amount 為數字，null 表示清空）
async function saveCreditLimit(cardId, amount) {
    const localKey = `creditLimit_${currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, amount === null ? '' : String(amount));

    if (!currentUser) return;

    try {
        if (window.db && window.doc && window.setDoc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            const existingData = docSnap.exists() ? docSnap.data() : {};
            const creditLimits = existingData.creditLimits || {};

            if (amount === null) {
                delete creditLimits[cardId];
            } else {
                creditLimits[cardId] = amount;
            }

            await window.setDoc(docRef, {
                creditLimits: creditLimits,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('☁️ [我的額度] 已同步到 Firestore:', cardId, amount);
        }
    } catch (error) {
        console.error('❌ [我的額度] Firestore 保存失敗:', error);
    }
}

// 設置我的額度輸入（卡片詳情頁）
async function setupCreditLimit(cardId) {
    const input = document.getElementById('credit-limit-input');
    const savedTag = document.getElementById('credit-limit-saved');
    if (!input) return;

    if (savedTag) savedTag.textContent = '';
    const current = await loadCreditLimit(cardId);
    input.value = current !== null ? current.toLocaleString() : '';

    // 失焦或按 Enter 即儲存；只留數字，顯示千分位
    input.onchange = () => {
        const raw = input.value.replace(/[^\d]/g, '');
        const amount = raw ? Number(raw) : null;
        input.value = amount !== null ? amount.toLocaleString() : '';
        saveCreditLimit(cardId, amount);
        if (savedTag) {
            savedTag.textContent = '✓ 已儲存';
            setTimeout(() => {
                if (savedTag.textContent === '✓ 已儲存') savedTag.textContent = '';
            }, 2000);
        }
    };
    input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    };
}

// 結帳日期相關功能

// 讀取結帳日期
async function loadBillingDates(cardId) {
    const defaultDates = { billingDate: '', statementDate: '' };
    // 確保回傳值一定是 { billingDate, statementDate } 形狀，儲存的資料被污染也不會讓 UI 掛掉
    const normalizeDates = (raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...defaultDates };
        return {
            billingDate: typeof raw.billingDate === 'string' ? raw.billingDate : '',
            statementDate: typeof raw.statementDate === 'string' ? raw.statementDate : ''
        };
    };

    if (!currentUser) {
        return normalizeDates(readLocalJSON(`billingDates_local_${cardId}`));
    }

    try {
        // 從 Firestore 的 users collection 讀取
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().billingDates && docSnap.data().billingDates[cardId]) {
                const dates = normalizeDates(docSnap.data().billingDates[cardId]);
                // 更新本地快取
                const localKey = `billingDates_${currentUser.uid}_${cardId}`;
                localStorage.setItem(localKey, JSON.stringify(dates));
                console.log('✅ [結帳日期] 從 Firestore 讀取:', cardId, dates);
                return dates;
            }
        }

        // Fallback to localStorage
        return normalizeDates(readLocalJSON(`billingDates_${currentUser.uid}_${cardId}`));
    } catch (error) {
        console.error('❌ 讀取結帳日期失敗:', error);
        return normalizeDates(readLocalJSON(`billingDates_${currentUser.uid}_${cardId}`));
    }
}

// 儲存結帳日期
async function saveBillingDates(cardId, billingDate, statementDate) {
    const dateData = {
        billingDate: billingDate || '',
        statementDate: statementDate || ''
    };

    const localKey = `billingDates_${currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, JSON.stringify(dateData));
    console.log('✅ [結帳日期] 已保存到本地快取:', cardId, dateData);

    if (!currentUser) return;

    try {
        // 保存到 Firestore 的 users collection
        if (window.db && window.doc && window.setDoc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);

            // 先讀取現有的 billingDates
            const docSnap = await window.getDoc(docRef);
            const existingData = docSnap.exists() ? docSnap.data() : {};
            const billingDates = existingData.billingDates || {};

            // 更新特定卡片的結帳日期
            billingDates[cardId] = dateData;

            await window.setDoc(docRef, {
                billingDates: billingDates,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('☁️ [結帳日期] 已同步到 Firestore:', cardId, dateData);
        }
    } catch (error) {
        console.error('❌ [結帳日期] Firestore 保存失敗:', error);
    }
}

// 設置結帳日期功能
async function setupBillingDates(cardId) {
    const billingInput = document.getElementById('billing-date');
    const statementInput = document.getElementById('statement-date');
    
    if (!billingInput || !statementInput) return;
    
    // 讀取已儲存的日期
    const savedDates = await loadBillingDates(cardId);
    billingInput.value = savedDates.billingDate;
    statementInput.value = savedDates.statementDate;
    
    // 為有值的輸入框加上視覺強調
    const updateInputAppearance = (input) => {
        if (input.value.trim() !== '') {
            input.style.borderColor = '#10b981';
            input.style.background = 'white';
            input.style.fontWeight = '600';
        }
    };
    
    updateInputAppearance(billingInput);
    updateInputAppearance(statementInput);
    
    // 儲存功能
    const saveDates = () => {
        const billing = billingInput.value;
        const statement = statementInput.value;
        saveBillingDates(cardId, billing, statement);
        
        // 更新視覺狀態
        updateInputAppearance(billingInput);
        updateInputAppearance(statementInput);
    };
    
    // 設置變更監聽
    billingInput.onchange = saveDates;
    billingInput.onblur = saveDates;
    statementInput.onchange = saveDates;
    statementInput.onblur = saveDates;
    
    // 輸入驗證
    [billingInput, statementInput].forEach(input => {
        input.oninput = (e) => {
            let value = parseInt(e.target.value);
            if (value > 31) e.target.value = 31;
            if (value < 1 && e.target.value !== '') e.target.value = 1;
        };
    });
}

// ========== Card Level Management Functions ==========

// Load card level from Firestore (with localStorage fallback and migration)
async function getCardLevel(cardId, defaultLevel) {
    // For non-level cards, return default immediately
    if (!cardId || !defaultLevel) return defaultLevel;

    // Serve from cache when available (avoids repeated Firestore reads within a
    // single calculation; invalidated by saveCardLevel and auth changes).
    const cacheKey = cardLevelCacheKey(cardId);
    if (cardLevelCache.has(cacheKey)) {
        return cardLevelCache.get(cacheKey);
    }

    const resolved = await getCardLevelUncached(cardId, defaultLevel);
    cardLevelCache.set(cacheKey, resolved);
    return resolved;
}

// 登入後預熱級別快取：並行對所有「有級別設定」的卡呼叫 getCardLevel()，把結果灌進
// cardLevelCache，讓使用者登入後的第一次計算不用再對每張卡串行等 Firestore getDoc
// （resolveCardLevel → getCardLevel 命中快取直接回傳）。
//
// 只讀不寫：這裡只是把 getCardLevel() 本來就會做的讀取提前、並行跑，不呼叫
// saveCardLevel()。getCardLevelUncached() 內既有的「本機鏡像補上傳 Firestore」邏輯
// （雲端沒值但本機鏡像有值時會 saveCardLevel 一次）維持原樣不動——那是既有的合法
// 呼叫場景（見 docs/project/storage-and-security.md 第 2 節），預熱只是提早觸發它，
// 不是新增呼叫路徑。
//
// Fire-and-forget：呼叫端不 await，逐卡失敗各自 catch 並 console.error，不讓單一
// 卡片的 Firestore 錯誤擋住其他卡或影響 onAuthStateChanged 流程。
function warmCardLevelCache() {
    if (!auth || !auth.currentUser) return; // 訪客沒有 Firestore 級別可預熱
    if (!cardsData || !Array.isArray(cardsData.cards)) return; // cardsData 還沒載入時安靜跳過

    const levelCards = cardsData.cards.filter(
        card => card.hasLevels && card.levelSettings && Object.keys(card.levelSettings).length > 0
    );

    Promise.all(levelCards.map(card => {
        const defaultLevel = Object.keys(card.levelSettings)[0];
        return getCardLevel(card.id, defaultLevel).catch(err => {
            console.error(`⚠️ 級別快取預熱失敗 (${card.id}):`, err);
        });
    })).then(() => {
        console.log(`✅ 級別快取預熱完成（${levelCards.length} 張卡）`);
    });
}

// 卡片級別的本機 key：登入者一律用 uid 區分（cardLevel_<uid>_<cardId>），
// 訪客沿用舊 key（cardLevel-<cardId>），既有訪客的資料不受影響。
// ⚠️ 登入狀態下絕不可讀寫訪客 key —— 共用電腦上那可能是「別人」的選擇
// （過去曾因此把前一位使用者的級別遷移進當前帳號）。訪客 key 只在登入當下
// 由 absorbGuestPersonalData() 統一消化。
function cardLevelLocalKey(cardId) {
    return (auth && auth.currentUser)
        ? `cardLevel_${auth.currentUser.uid}_${cardId}`
        : `cardLevel-${cardId}`;
}

async function getCardLevelUncached(cardId, defaultLevel) {
    // If user not logged in, use localStorage
    if (!auth || !auth.currentUser) {
        return localStorage.getItem(cardLevelLocalKey(cardId)) || defaultLevel;
    }

    try {
        const docRef = window.doc ? window.doc(db, 'cardSettings', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');

        const docSnap = await window.getDoc(docRef);

        if (docSnap.exists()) {
            const level = docSnap.data().level || defaultLevel;
            // 更新本機鏡像，離線時 fallback 用
            try { localStorage.setItem(cardLevelLocalKey(cardId), level); } catch (e) {}
            return level;
        } else {
            // 雲端沒有：檢查「自己的」本機鏡像（例如之前離線時儲存的），有則補上傳
            const localLevel = localStorage.getItem(cardLevelLocalKey(cardId));
            if (localLevel && localLevel !== defaultLevel) {
                console.log(`Migrating level for ${cardId} from local mirror to Firestore: ${localLevel}`);
                await saveCardLevel(cardId, localLevel);
                return localLevel;
            }
            return defaultLevel;
        }
    } catch (error) {
        console.log('Failed to load card level from Firestore:', error);
        // Fallback to本機鏡像（uid 區分，不會讀到別人的資料）
        return localStorage.getItem(cardLevelLocalKey(cardId)) || defaultLevel;
    }
}

// Save user's birthday month to Firestore and update pre-computed flag
async function saveBirthdayMonth(month) {
    userBirthdayMonth = month;
    isBirthdayMonth = month !== null && month === (new Date().getMonth() + 1);

    if (!auth || !auth.currentUser || !window.db || !window.doc || !window.setDoc) return;

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { birthdayMonth: month, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Birthday month saved: ${month}`);
    } catch (error) {
        console.error('Failed to save birthday month:', error);
    }
}

// Save user's CUBE card issuer (Visa/Mastercard/JCB) to Firestore + localStorage and update global flag
async function saveCubeIssuer(issuer) {
    cubeIssuer = issuer;
    try { localStorage.setItem('cubeIssuer', issuer); } catch (e) {}

    if (!auth || !auth.currentUser || !window.db || !window.doc || !window.setDoc) return;

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { cubeIssuer: issuer, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Cube issuer saved: ${issuer}`);
    } catch (error) {
        console.error('Failed to save cube issuer:', error);
    }
}

// Save user's children eligibility to Firestore and update global flag
async function saveChildrenEligible(eligible) {
    isChildrenEligible = eligible;

    if (!auth || !auth.currentUser || !window.db || !window.doc || !window.setDoc) return;

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { isChildrenEligible: eligible, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Children eligibility saved: ${eligible}`);
    } catch (error) {
        console.error('Failed to save children eligibility:', error);
    }
}

// Save card level to Firestore (with localStorage backup)
async function saveCardLevel(cardId, level) {
    if (!cardId || !level) return;

    // Write-through to the in-memory cache so subsequent reads see the new value.
    cardLevelCache.set(cardLevelCacheKey(cardId), level);

    // Always save to localStorage as backup（登入者用 uid 區分的 key，見 cardLevelLocalKey）
    try { localStorage.setItem(cardLevelLocalKey(cardId), level); } catch (e) {}

    // If user not logged in, only save locally
    if (!auth || !auth.currentUser) {
        console.log(`Card level saved locally for ${cardId}: ${level}`);
        return;
    }

    try {
        const docRef = window.doc ? window.doc(db, 'cardSettings', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');

        await window.setDoc(docRef, {
            level: level,
            updatedAt: new Date(),
            cardId: cardId
        });

        console.log(`Card level synced to Firestore for ${cardId}: ${level}`);
    } catch (error) {
        console.error('Failed to save card level to Firestore:', error);
    }
}

// Resolve a hasLevels card's current level + settings, falling back to
// defaultLevel WITHOUT overwriting the user's stored choice when the saved
// level isn't currently present in card.levelSettings.
//
// Why we do NOT re-save the fallback: a saved level can fail to match for a
// TRANSIENT reason — e.g. the moment after cards.data is updated, or a briefly
// malformed export — not only a permanent rename. Persisting the default in
// that window would erase a logged-in user's real choice (Level 2 → Level 1)
// for good, even after the data is corrected. So we fall back to the default
// for THIS render only and leave the stored preference untouched; once the
// card's data contains the saved level again, it resolves correctly on its own.
//
// Returns { level, data } — level is always a valid key into levelSettings,
// data is always defined (never crashes downstream on `.rate`/`.cap` access).
async function resolveCardLevel(card, defaultLevel) {
    const savedLevel = await getCardLevel(card.id, defaultLevel);
    const savedData = card.levelSettings[savedLevel];
    if (savedData) {
        return { level: savedLevel, data: savedData };
    }
    // Saved level not found in current data — render with the default but do
    // NOT persist it, so the user's stored preference survives the mismatch.
    console.warn(`⚠️ ${card.name}: 保存的級別 "${savedLevel}" 目前不在資料中，暫時顯示預設級別 "${defaultLevel}"（不覆蓋已儲存的選擇）`);
    return { level: defaultLevel, data: card.levelSettings[defaultLevel] };
}

// ========== Payment Management Functions ==========

// Open manage payments modal
function openMyPaymentsModal() {
    const modal = document.getElementById('my-payments-modal');
    if (!modal) return;

    populatePaymentChips();

    modal.style.display = 'flex';
    disableBodyScroll();

    const closeBtn = document.getElementById('close-my-payments-modal');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };
    window.closeMyPaymentsModal = closeModal;

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

function openManagePaymentsModal() {
    const modal = document.getElementById('manage-payments-modal');
    const paymentsSelection = document.getElementById('payments-selection');
    const saveBtn = document.getElementById('save-payments-btn');
    const toggleAllBtn = document.getElementById('toggle-all-payments');

    const isLoggedIn = currentUser !== null;

    paymentsSelection.innerHTML = '';

    paymentsData.payments.forEach(payment => {
        const isSelected = userSelectedPayments.has(payment.id);

        const paymentDiv = document.createElement('div');
        paymentDiv.className = `card-checkbox ${isSelected ? 'selected' : ''}`;

        paymentDiv.innerHTML = `
            <input type="checkbox" id="payment-${payment.id}" value="${payment.id}" ${isSelected ? 'checked' : ''}>
            <label for="payment-${payment.id}" class="card-checkbox-label">${payment.name}</label>
        `;

        const checkbox = paymentDiv.querySelector('input');
        checkbox.addEventListener('change', () => {
            paymentDiv.classList.toggle('selected', checkbox.checked);
        });

        paymentsSelection.appendChild(paymentDiv);
    });

    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
    saveBtn.style.cursor = 'pointer';
    toggleAllBtn.disabled = false;
    toggleAllBtn.style.opacity = '1';

    // Toggle all payments
    let allSelected = userSelectedPayments.size === paymentsData.payments.length;
    toggleAllBtn.textContent = allSelected ? '取消全選' : '全選';
    toggleAllBtn.onclick = () => {
        allSelected = !allSelected;
        const checkboxes = paymentsSelection.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = allSelected;
            cb.closest('.card-checkbox').classList.toggle('selected', allSelected);
        });
        toggleAllBtn.textContent = allSelected ? '取消全選' : '全選';
    };

    // Setup modal controls
    const closeBtn = document.getElementById('close-payments-modal');
    const cancelBtn = document.getElementById('cancel-payments-btn');

    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    saveBtn.onclick = async () => {
        const checkboxes = paymentsSelection.querySelectorAll('input[type="checkbox"]:checked');
        const selectedPayments = Array.from(checkboxes).map(cb => cb.value);

        userSelectedPayments = new Set(selectedPayments);

        // Save to both localStorage and Firestore
        await saveUserPayments();

        populatePaymentChips();
        closeModal();
    };

    // Setup search functionality
    const searchInput = document.getElementById('search-payments-input');
    searchInput.value = ''; // Clear search on open
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const paymentDivs = paymentsSelection.querySelectorAll('.card-checkbox');

        paymentDivs.forEach(paymentDiv => {
            const label = paymentDiv.querySelector('.card-checkbox-label');
            if (label) {
                const paymentName = label.textContent.toLowerCase();
                if (paymentName.includes(searchTerm)) {
                    paymentDiv.style.display = 'flex';
                } else {
                    paymentDiv.style.display = 'none';
                }
            }
        });
    });

    modal.style.display = 'flex';
    disableBodyScroll();
}

// Show payment detail modal
async function showPaymentDetail(paymentId) {
    console.log('🔍 showPaymentDetail 被調用:', paymentId);
    const payment = paymentsData.payments.find(p => p.id === paymentId);
    if (!payment) {
        console.error('❌ 找不到 payment:', paymentId);
        return;
    }
    console.log('✅ 找到 payment:', payment.name);

    const modal = document.getElementById('payment-detail-modal');
    const title = document.getElementById('payment-detail-title');
    const websiteLink = document.getElementById('payment-website-link');
    const detailsContainer = document.getElementById('payment-cashback-details');

    title.textContent = payment.name;

    // Set website link
    if (payment.website) {
        websiteLink.href = payment.website;
        websiteLink.textContent = '點此查看官方網站';
        websiteLink.style.display = 'inline';
    } else {
        websiteLink.textContent = '（待更新）';
        websiteLink.removeAttribute('href');
        websiteLink.style.display = 'inline';
    }

    // Get matching cards for this payment
    const cardsToCheck = getCardsForComparison();

    let matchingCards = [];

    // Search for matches using all payment search terms
    console.log(`🔎 搜尋 ${payment.name} 的匹配卡片...`);
    console.log('searchTerms:', payment.searchTerms);
    console.log('cardsToCheck 數量:', cardsToCheck.length);

    for (const term of payment.searchTerms) {
        const matches = findMatchingItem(term);
        console.log(`  term "${term}" 找到 ${matches ? matches.length : 0} 個匹配`);
        if (matches && matches.length > 0) {
            // For each matched item, calculate cashback for all cards
            for (const card of cardsToCheck) {
                const results = await calculateCardCashback(card, term, 1000); // Use 1000 as dummy amount
                // calculateCardCashback now returns an array of all matching activities
                for (const result of results) {
                    if (result.rate > 0) {
                        console.log(`    ✅ ${card.name}: ${result.rate}%`);
                        matchingCards.push({
                            card: card,
                            rate: result.rate,
                            cap: result.cap,
                            rateGroup: null // Not needed for display
                        });
                    }
                }
            }
        }
    }

    // Remove duplicates - keep highest rate per card
    const cardMap = new Map();
    matchingCards.forEach(mc => {
        if (!cardMap.has(mc.card.id) || cardMap.get(mc.card.id).rate < mc.rate) {
            cardMap.set(mc.card.id, mc);
        }
    });

    const uniqueCards = Array.from(cardMap.values());

    // Sort by rate descending
    uniqueCards.sort((a, b) => b.rate - a.rate);

    // Display matching cards
    detailsContainer.innerHTML = '';
    
    if (uniqueCards.length === 0) {
        detailsContainer.innerHTML = '<p style="text-align: center; color: #666;">目前沒有信用卡認列此支付方式</p>';
    } else {
        const maxRate = uniqueCards[0].rate;

        uniqueCards.forEach((mc, index) => {
            const cardDiv = document.createElement('div');
            const isBest = index === 0 && maxRate > 0;
            cardDiv.className = `cashback-detail-item ${isBest ? 'best-cashback' : ''}`;

            let capText = mc.cap ? `NT$${Math.floor(mc.cap).toLocaleString()}` : '無上限';
            let periodText = mc.rateGroup?.period ? `<div class="cashback-condition">活動期間: ${mc.rateGroup.period}</div>` : '';
            let conditionsText = mc.rateGroup?.conditions ? `<div class="cashback-condition">條件: ${mc.rateGroup.conditions}</div>` : '';
            let bestBadge = isBest ? '<div class="best-badge">最優回饋</div>' : '';

            cardDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="color: #1f2937; font-weight: 600; font-size: 15px;">${mc.card.name}</span>
                        ${bestBadge}
                    </div>
                    <span style="color: #059669; font-weight: 700; font-size: 1.15rem;">${mc.rate}%</span>
                </div>
                <div class="cashback-condition">消費上限: ${capText}</div>
                ${periodText}
                ${conditionsText}
            `;
            detailsContainer.appendChild(cardDiv);
        });
    }

    // Setup close events
    const closeBtn = document.getElementById('close-payment-detail');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    modal.style.display = 'flex';
    disableBodyScroll();
}

// Show compare payments modal
async function showComparePaymentsModal() {
    console.log('📊 showComparePaymentsModal 被調用');
    const modal = document.getElementById('compare-payments-modal');
    const contentContainer = document.getElementById('compare-payments-content');

    if (!modal || !contentContainer) {
        console.error('❌ Modal 元素未找到');
        return;
    }

    // Show modal first (for better UX)
    modal.style.display = 'flex';
    disableBodyScroll();

    const paymentsToCompare = currentUser ?
        paymentsData.payments.filter(p => userSelectedPayments.has(p.id)) :
        paymentsData.payments;

    if (paymentsToCompare.length === 0) {
        contentContainer.innerHTML = '<p style="text-align: center; color: #666;">請先選擇要比較的行動支付</p>';
    } else {
        // Show loading state
        contentContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; gap: 16px;">
                <div class="loading-spinner-large"></div>
                <div style="color: #6b7280; font-size: 0.95rem;">正在計算所有行動支付回饋...</div>
            </div>
        `;

        // Wrap calculation in try-catch and use setTimeout to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 50));

        const startTime = performance.now();
        let paymentsWithCards = [];

        for (const payment of paymentsToCompare) {
            const cardsToCheck = getCardsForComparison();

            let matchingCards = [];

            // Search for matches using all payment search terms
            for (const term of payment.searchTerms) {
                const matches = findMatchingItem(term);
                if (matches && matches.length > 0) {
                    // For each matched item, calculate cashback for all cards
                    for (const card of cardsToCheck) {
                        const results = await calculateCardCashback(card, term, 1000); // Use 1000 as dummy amount
                        // calculateCardCashback now returns an array of all matching activities
                        for (const result of results) {
                            if (result.rate > 0) {
                                matchingCards.push({
                                    card: card,
                                    rate: result.rate,
                                    cap: result.cap,
                                    rateGroup: null
                                });
                            }
                        }
                    }
                }
            }

            // Remove duplicates - keep highest rate per card
            const cardMap = new Map();
            matchingCards.forEach(mc => {
                if (!cardMap.has(mc.card.id) || cardMap.get(mc.card.id).rate < mc.rate) {
                    cardMap.set(mc.card.id, mc);
                }
            });

            const uniqueCards = Array.from(cardMap.values());

            uniqueCards.sort((a, b) => b.rate - a.rate);

            // Only keep top 2
            const top2 = uniqueCards.slice(0, 2);

            if (top2.length > 0) {
                paymentsWithCards.push({
                    payment: payment,
                    cards: top2
                });
            }
        }

        // Sort payments by highest rate
        paymentsWithCards.sort((a, b) => b.cards[0].rate - a.cards[0].rate);

        // Display compact comparison with 2-column grid
        contentContainer.innerHTML = '';

        if (paymentsWithCards.length === 0) {
            contentContainer.innerHTML = '<p style="text-align: center; color: #666;">目前沒有信用卡認列已選的行動支付</p>';
        } else {
            // Create grid container
            const gridContainer = document.createElement('div');
            gridContainer.className = 'compare-payments-grid';

            paymentsWithCards.forEach(pwc => {
                const paymentCard = document.createElement('div');
                paymentCard.className = 'compare-payment-card';

                let cardsHTML = '';
                pwc.cards.forEach((mc, index) => {
                    const isBest = index === 0;
                    let capText = mc.cap ? `NT$${Math.floor(mc.cap).toLocaleString()}` : '無上限';
                    let bestBadge = isBest ? '<div class="best-badge">最優回饋</div>' : '';

                    cardsHTML += `
                        <div class="cashback-detail-item ${isBest ? 'best-cashback' : ''}" style="margin-top: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="color: #1f2937; font-weight: 600; font-size: 15px;">${mc.card.name}</span>
                                    ${bestBadge}
                                </div>
                                <span style="color: #059669; font-weight: 700; font-size: 1.15rem;">${mc.rate}%</span>
                            </div>
                            <div class="cashback-condition">消費上限: ${capText}</div>
                        </div>
                    `;
                });

                paymentCard.innerHTML = `
                    <div class="compare-payment-name">
                        ${pwc.payment.name}
                    </div>
                    ${cardsHTML}
                `;

                gridContainer.appendChild(paymentCard);
            });

            contentContainer.appendChild(gridContainer);
        }

        // Log performance
        const duration = performance.now() - startTime;
        console.log(`⏱️ 行動支付比較完成 - 耗時: ${duration.toFixed(2)}ms (${(duration / 1000).toFixed(2)}s)`);
        console.log(`📊 比較了 ${paymentsToCompare.length} 個行動支付，找到 ${paymentsWithCards.length} 個有回饋`);
    }

    // Setup close events
    const closeBtn = document.getElementById('close-compare-payments');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// Load user payments
// Load user's selected payments from Firestore (with localStorage fallback)
// Now accepts optional userData parameter to avoid redundant Firestore calls
async function loadUserPayments(userData = null) {
    if (!currentUser) {
        // Guest: load from localStorage
        const saved = readLocalJSON('selectedPayments_guest', null);
        userSelectedPayments = Array.isArray(saved) ? new Set(saved) : new Set();
        console.log('📦 Loaded user payments (guest):', Array.from(userSelectedPayments));
        return;
    }

    try {
        // Use provided userData if available (from unified load)
        let cloudPayments = null;
        if (userData && Array.isArray(userData.selectedPayments)) {
            cloudPayments = userData.selectedPayments;
        } else if (!userData && window.db && window.doc && window.getDoc) {
            // Fallback: Try to load from Firestore if userData not provided
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists() && Array.isArray(docSnap.data().selectedPayments)) {
                cloudPayments = docSnap.data().selectedPayments;
            }
        }

        if (cloudPayments !== null) {
            // 雲端有設定 → 雲端為準；移除訪客殘留 key
            userSelectedPayments = new Set(cloudPayments);
            console.log('✅ Loaded user payments from cloud:', Array.from(userSelectedPayments));
            localStorage.setItem(`selectedPayments_${currentUser.uid}`, JSON.stringify(cloudPayments));
            localStorage.removeItem('selectedPayments_guest');
            return;
        }

        // 雲端沒有設定：若訪客期間有儲存過選擇 → 靜默帶入並上傳（不彈窗）
        const guestPayments = readLocalJSON('selectedPayments_guest', null);
        if (guestPayments !== null) localStorage.removeItem('selectedPayments_guest');
        if (Array.isArray(guestPayments) && guestPayments.length > 0) {
            userSelectedPayments = new Set(guestPayments);
            console.log('🔀 雲端無設定，帶入訪客的行動支付選擇:', guestPayments);
            await saveUserPayments();
            return;
        }

        // Fallback to localStorage if Firestore fails or no data
        const savedPayments = readLocalJSON(`selectedPayments_${currentUser.uid}`, null);

        if (Array.isArray(savedPayments)) {
            userSelectedPayments = new Set(savedPayments);
            console.log('📦 Loaded user payments from localStorage (fallback):', Array.from(userSelectedPayments));
        } else {
            // First time user - no payments selected by default
            console.log('🆕 First time user, no payments selected');
            userSelectedPayments = new Set();
            saveUserPayments();
        }
    } catch (error) {
        console.error('❌ Error loading user payments:', error);
        userSelectedPayments = new Set();
    }
}

// Save user payments
async function saveUserPayments() {
    if (!currentUser) {
        try {
            const paymentsArray = Array.from(userSelectedPayments);
            localStorage.setItem('selectedPayments_guest', JSON.stringify(paymentsArray));
            console.log('✅ Saved guest payments to localStorage:', paymentsArray);
        } catch (e) {
            console.error('Error saving guest payments to localStorage:', e);
        }
        return;
    }

    try {
        const storageKey = `selectedPayments_${currentUser.uid}`;
        const paymentsArray = Array.from(userSelectedPayments);
        localStorage.setItem(storageKey, JSON.stringify(paymentsArray));
        console.log('Saved user payments to localStorage');

        // Also save to Firestore if available
        if (window.db && window.doc && window.setDoc) {
            try {
                await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                    selectedPayments: paymentsArray,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                console.log('✅ Payments saved to Firestore');
            } catch (firestoreError) {
                console.error('❌ Error saving payments to Firestore:', firestoreError);
            }
        }
    } catch (error) {
        console.error('Error saving user payments to localStorage:', error);
    }
}

// ============================================
// Quick Search Options Management
// ============================================

// Temporary state for managing quick options in modal
let tempSelectedOptions = [];
let tempCustomOptions = [];

function openManageQuickOptionsModal() {
    const modal = document.getElementById('manage-quick-options-modal');

    if (!modal) {
        console.error('Quick options modal not found');
        return;
    }

    // Initialize temporary state with current options
    tempSelectedOptions = JSON.parse(JSON.stringify(quickSearchOptions));
    loadUserQuickSearchPrefs().then(prefs => {
        tempCustomOptions = JSON.parse(JSON.stringify(prefs.customQuickOptions || []));
        renderQuickOptionsModal();
    });

    // Setup modal buttons
    setupQuickOptionsModalButtons();

    // Show modal
    modal.style.display = 'flex';
    disableBodyScroll();
}

function renderQuickOptionsModal() {
    renderSelectedTags();
    renderAvailableTags();
    renderCustomOptionsList();
}

function renderSelectedTags() {
    const container = document.getElementById('selected-tags-container');
    if (!container) return;

    container.innerHTML = '';

    tempSelectedOptions.forEach((option, index) => {
        const tag = createTagElement(option, 'selected', index);
        container.appendChild(tag);
    });
}

function renderAvailableTags() {
    const container = document.getElementById('available-tags-container');
    if (!container) return;

    container.innerHTML = '';

    // Get all available options (default + custom)
    const defaultOptions = getDefaultQuickSearchOptions();
    const allOptions = [...defaultOptions, ...tempCustomOptions];

    // Filter out already selected options
    const selectedIds = tempSelectedOptions.map(opt => opt.id || opt.displayName);
    const availableOptions = allOptions.filter(opt => !selectedIds.includes(opt.id || opt.displayName));

    availableOptions.forEach((option) => {
        const tag = createTagElement(option, 'available');
        container.appendChild(tag);
    });
}

function createTagElement(option, type, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tag-wrapper';

    const tag = document.createElement('div');
    tag.className = 'tag-item';
    tag.dataset.optionId = option.id || option.displayName;
    tag.dataset.isCustom = option.isCustom ? 'true' : 'false';

    // Icon HTML
    const iconHtml = option.icon ? `<span class="tag-icon">${option.icon}</span>` : '';

    // Expand button (only when merchants exist)
    const hasMerchants = Array.isArray(option.merchants) && option.merchants.length > 1;

    if (type === 'selected') {
        tag.draggable = true;
        tag.dataset.index = index;
        tag.innerHTML = `
            ${iconHtml}
            <span class="tag-name">${option.displayName}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
            <button class="tag-remove-btn" title="移除">×</button>
        `;

        // Remove button
        const removeBtn = tag.querySelector('.tag-remove-btn');
        const handleRemove = (e) => {
            e.stopPropagation();
            e.preventDefault();
            removeOption(option);
        };
        removeBtn.addEventListener('click', handleRemove);
        removeBtn.addEventListener('touchend', handleRemove);

        // Drag and drop for reordering
        tag.addEventListener('dragstart', handleDragStart);
        tag.addEventListener('dragend', handleDragEnd);
        tag.addEventListener('dragover', handleDragOver);
        tag.addEventListener('drop', handleDrop);

        // Touch events for mobile drag and drop
        tag.addEventListener('touchstart', handleTouchStart, { passive: false });
        tag.addEventListener('touchmove', handleTouchMove, { passive: false });
        tag.addEventListener('touchend', handleTouchEnd);
    } else {
        // Available tag with add button
        tag.innerHTML = `
            <button class="tag-add-btn" title="新增">+</button>
            ${iconHtml}
            <span class="tag-name">${option.displayName}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
        `;

        const addBtn = tag.querySelector('.tag-add-btn');
        const handleAdd = (e) => {
            e.stopPropagation();
            e.preventDefault();
            addOption(option);
        };
        addBtn.addEventListener('click', handleAdd);
        addBtn.addEventListener('touchend', handleAdd);
    }

    wrapper.appendChild(tag);

    // Merchants panel (collapsed by default)
    if (hasMerchants) {
        const panel = document.createElement('div');
        panel.className = 'tag-merchants-panel';
        panel.textContent = option.merchants.join('、');
        wrapper.appendChild(panel);

        const expandBtn = tag.querySelector('.tag-expand-btn');
        const toggle = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const isOpen = panel.classList.contains('open');
            panel.classList.toggle('open', !isOpen);
            expandBtn.classList.toggle('expanded', !isOpen);
        };
        expandBtn.addEventListener('click', toggle);
        expandBtn.addEventListener('touchend', toggle);
    }

    return wrapper;
}

function addOption(option) {
    tempSelectedOptions.push(option);
    renderQuickOptionsModal();
}

function removeOption(option) {
    const optionId = option.id || option.displayName;
    tempSelectedOptions = tempSelectedOptions.filter(opt => (opt.id || opt.displayName) !== optionId);
    renderQuickOptionsModal();
}

// Drag and drop handlers
let draggedElement = null;
let touchDraggedElement = null;
let touchStartY = 0;
let touchStartX = 0;

function handleDragStart(e) {
    draggedElement = e.target;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    const dropTarget = e.target.closest?.('.tag-item') || e.target;
    if (draggedElement !== dropTarget && dropTarget.classList.contains('tag-item')) {
        const fromIndex = parseInt(draggedElement.dataset.index);
        const toIndex = parseInt(dropTarget.dataset.index);

        if (!isNaN(fromIndex) && !isNaN(toIndex)) {
            // Reorder array
            const item = tempSelectedOptions.splice(fromIndex, 1)[0];
            tempSelectedOptions.splice(toIndex, 0, item);
            renderQuickOptionsModal();
        }
    }

    return false;
}

// Touch event handlers for mobile drag and drop
function handleTouchStart(e) {
    // Don't interfere with button clicks
    if (e.target.classList.contains('tag-remove-btn') ||
        e.target.classList.contains('tag-add-btn') ||
        e.target.classList.contains('tag-expand-btn')) {
        return;
    }

    touchDraggedElement = e.target.closest('.tag-item');
    if (!touchDraggedElement) return;

    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;

    touchDraggedElement.classList.add('dragging');

    // Prevent default to avoid scrolling while dragging
    e.preventDefault();
}

function handleTouchMove(e) {
    if (!touchDraggedElement) return;

    e.preventDefault();

    const touch = e.touches[0];
    const currentX = touch.clientX;
    const currentY = touch.clientY;

    // Find the element under the touch point
    const elementBelow = document.elementFromPoint(currentX, currentY);
    const targetTag = elementBelow?.closest('.tag-item');

    if (targetTag && targetTag !== touchDraggedElement && targetTag.classList.contains('tag-item')) {
        const fromIndex = parseInt(touchDraggedElement.dataset.index);
        const toIndex = parseInt(targetTag.dataset.index);

        if (!isNaN(fromIndex) && !isNaN(toIndex) && fromIndex !== toIndex) {
            // Reorder array
            const item = tempSelectedOptions.splice(fromIndex, 1)[0];
            tempSelectedOptions.splice(toIndex, 0, item);
            renderQuickOptionsModal();

            // Update the dragged element reference
            const newTags = document.querySelectorAll('.selected-tags-container .tag-item');
            touchDraggedElement = newTags[toIndex];
            if (touchDraggedElement) {
                touchDraggedElement.classList.add('dragging');
            }
        }
    }
}

function handleTouchEnd(e) {
    if (touchDraggedElement) {
        touchDraggedElement.classList.remove('dragging');
        touchDraggedElement = null;
    }
}

function setupQuickOptionsModalButtons() {
    const modal = document.getElementById('manage-quick-options-modal');
    const closeBtn = document.getElementById('close-quick-options-modal');
    const cancelBtn = document.getElementById('cancel-quick-options-btn');
    const saveBtn = document.getElementById('save-quick-options-btn');
    const resetBtn = document.getElementById('reset-quick-options-btn');
    const clearAllBtn = document.getElementById('clear-all-quick-options-btn');
    const addCustomBtn = document.getElementById('add-custom-option-btn');

    if (closeBtn) {
        closeBtn.onclick = () => {
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (saveBtn) {
        saveBtn.onclick = async () => {
            await saveQuickOptionsSelection();
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            resetQuickOptionsToDefault();
        };
    }

    if (clearAllBtn) {
        clearAllBtn.onclick = () => {
            clearAllQuickOptions();
        };
    }

    if (addCustomBtn) {
        addCustomBtn.onclick = () => {
            showCustomOptionForm();
        };
    }

    // Custom option form buttons
    setupCustomOptionFormButtons();
}

async function saveQuickOptionsSelection() {
    // Compute new prefs from current modal state
    const defaultOptions = getDefaultQuickSearchOptions();
    const defaultIds = new Set(defaultOptions.map(o => o.id));
    const selectedDefaultIds = new Set(
        tempSelectedOptions.filter(o => defaultIds.has(o.id)).map(o => o.id)
    );

    // Defaults NOT in user's selected list = hidden
    const hiddenDefaultIds = defaultOptions
        .map(o => o.id)
        .filter(id => !selectedDefaultIds.has(id));

    // User's custom options (from tempCustomOptions, the source of truth for customs)
    const customQuickOptions = tempCustomOptions;

    // Preserve user's ordering
    const selectedOrder = tempSelectedOptions.map(o => o.id).filter(Boolean);

    const prefs = { hiddenDefaultIds, customQuickOptions, selectedOrder };
    const saved = await saveUserQuickSearchPrefs(prefs);

    if (saved) {
        // Reload quickSearchOptions from new prefs (which pulls fresh defaults from cards.json)
        await initializeQuickSearchOptions();
        renderQuickSearchButtons();
        console.log('✅ 快捷選項已更新');
    } else {
        console.error('❌ 保存快捷選項失敗');
        alert('保存失敗，請稍後再試');
    }
}

function renderCustomOptionsList() {
    const container = document.getElementById('custom-options-list');
    if (!container) return;

    container.innerHTML = '';

    if (tempCustomOptions.length === 0) {
        return;
    }

    tempCustomOptions.forEach((option) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-option-wrapper';

        const item = document.createElement('div');
        item.className = 'custom-option-item';

        // 構建icon HTML（如果有的話）
        const iconHtml = option.icon ? `<span class="tag-icon">${option.icon}</span>` : '';
        const hasMerchants = Array.isArray(option.merchants) && option.merchants.length > 1;

        item.innerHTML = `
            ${iconHtml}
            <span class="tag-name">${option.displayName}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
            <button class="custom-option-delete" title="刪除">×</button>
        `;

        const deleteBtn = item.querySelector('.custom-option-delete');
        deleteBtn.onclick = () => { deleteCustomOption(option); };

        wrapper.appendChild(item);

        if (hasMerchants) {
            const panel = document.createElement('div');
            panel.className = 'tag-merchants-panel';
            panel.textContent = option.merchants.join('、');
            wrapper.appendChild(panel);

            const expandBtn = item.querySelector('.tag-expand-btn');
            const toggle = (e) => {
                e.stopPropagation();
                e.preventDefault();
                panel.classList.toggle('open');
                expandBtn.classList.toggle('expanded');
            };
            expandBtn.addEventListener('click', toggle);
            expandBtn.addEventListener('touchend', toggle);
        }

        container.appendChild(wrapper);
    });
}

// Emoji選擇器相關變數
let selectedEmoji = '';
const commonEmojis = ['🏪', '🏬', '🛒', '🍔', '☕', '🍕', '🎬', '✈️', '🚗', '⛽', '🏨', '🎮', '📱', '💻', '👕', '👟', '📚', '💊', '🏥', '🎵', '🎨', '⚽', '🎾', '🏃'];

function showCustomOptionForm() {
    const form = document.getElementById('custom-option-form');
    const addBtn = document.getElementById('add-custom-option-btn');

    if (form && addBtn) {
        form.style.display = 'block';
        addBtn.style.display = 'none';

        // Clear form
        document.getElementById('custom-display-name').value = '';

        // Reset emoji picker
        selectedEmoji = '';
        updateEmojiDisplay();

        // Setup emoji picker
        setupEmojiPicker();
    }
}

function setupEmojiPicker() {
    const selectedEmojiDiv = document.getElementById('selected-emoji');
    const emojiGrid = document.getElementById('emoji-grid');
    const clearBtn = document.getElementById('clear-emoji-btn');

    // Toggle emoji grid
    selectedEmojiDiv.onclick = () => {
        emojiGrid.style.display = emojiGrid.style.display === 'none' ? 'grid' : 'none';

        // Populate emoji grid if empty
        if (emojiGrid.children.length === 0) {
            commonEmojis.forEach(emoji => {
                const emojiBtn = document.createElement('div');
                emojiBtn.className = 'emoji-option';
                emojiBtn.textContent = emoji;
                emojiBtn.onclick = () => {
                    selectEmoji(emoji);
                };
                emojiGrid.appendChild(emojiBtn);
            });
        }
    };

    // Clear emoji button
    clearBtn.onclick = () => {
        selectedEmoji = '';
        updateEmojiDisplay();
    };
}

function selectEmoji(emoji) {
    selectedEmoji = emoji;
    updateEmojiDisplay();
    // Hide emoji grid after selection
    document.getElementById('emoji-grid').style.display = 'none';
}

function updateEmojiDisplay() {
    const selectedEmojiDiv = document.getElementById('selected-emoji');
    const clearBtn = document.getElementById('clear-emoji-btn');

    if (selectedEmoji) {
        selectedEmojiDiv.innerHTML = selectedEmoji;
        clearBtn.style.display = 'block';
    } else {
        selectedEmojiDiv.innerHTML = '<span class="emoji-placeholder">點擊選擇emoji</span>';
        clearBtn.style.display = 'none';
    }
}

function hideCustomOptionForm() {
    const form = document.getElementById('custom-option-form');
    const addBtn = document.getElementById('add-custom-option-btn');
    const emojiGrid = document.getElementById('emoji-grid');

    if (form && addBtn) {
        form.style.display = 'none';
        addBtn.style.display = 'block';
        // Hide emoji grid
        if (emojiGrid) {
            emojiGrid.style.display = 'none';
        }
    }
}

function setupCustomOptionFormButtons() {
    const saveBtn = document.getElementById('save-custom-option-btn');
    const cancelBtn = document.getElementById('cancel-custom-option-btn');

    if (saveBtn) {
        saveBtn.onclick = () => {
            saveCustomOption();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCustomOptionForm();
        };
    }
}

function saveCustomOption() {
    const displayName = document.getElementById('custom-display-name').value.trim();

    // Validation
    if (!displayName) {
        alert('請輸入顯示名稱');
        return;
    }

    // Create new custom option - use displayName as the search keyword
    const newOption = {
        id: `custom-${Date.now()}`,
        displayName: displayName,
        icon: selectedEmoji || '', // 使用選擇的emoji，沒選就留空
        merchants: [displayName], // Use display name as the only search keyword
        isCustom: true
    };

    // Add to custom options
    tempCustomOptions.push(newOption);

    // Re-render
    renderQuickOptionsModal();
    hideCustomOptionForm();
}

function deleteCustomOption(option) {
    if (!confirm(`確定要刪除「${option.displayName}」嗎？`)) {
        return;
    }

    const optionId = option.id || option.displayName;

    // Remove from custom options
    tempCustomOptions = tempCustomOptions.filter(opt => (opt.id || opt.displayName) !== optionId);

    // Remove from selected if present
    tempSelectedOptions = tempSelectedOptions.filter(opt => (opt.id || opt.displayName) !== optionId);

    // Re-render
    renderQuickOptionsModal();
}

function clearAllQuickOptions() {
    // Move all selected options back to available
    tempSelectedOptions = [];

    // Re-render the modal to reflect changes
    renderQuickOptionsModal();

    console.log('✅ 已移除所有已選擇的快捷選項');
}

function resetQuickOptionsToDefault() {
    const defaultOptions = getDefaultQuickSearchOptions();

    // Reset temp selected options to default
    tempSelectedOptions = [...defaultOptions];

    // Clear temp custom options
    tempCustomOptions = [];

    // Re-render the modal to reflect changes
    renderQuickOptionsModal();

    console.log('✅ 已恢復為預設快捷選項（需儲存才會生效）');
}

// ============================================
// Feedback System
// ============================================

// Initialize feedback system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // State
    let selectedImages = [];
    const MAX_IMAGES = 5;
    const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

    // DOM Elements
    const feedbackBtn = document.getElementById('feedback-btn');
    const feedbackModal = document.getElementById('feedback-modal');
    const closeFeedbackModal = document.getElementById('close-feedback-modal');
    const cancelFeedbackBtn = document.getElementById('cancel-feedback-btn');
    const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
    const feedbackForm = document.getElementById('feedback-form');
    const feedbackMessage = document.getElementById('feedback-message');
    const feedbackImages = document.getElementById('feedback-images');
    const imageUploadArea = document.getElementById('image-upload-area');
    const uploadPlaceholder = document.getElementById('upload-placeholder');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const feedbackStatus = document.getElementById('feedback-status');

    // Check if elements exist
    if (!feedbackBtn || !feedbackModal) {
        console.warn('Feedback elements not found');
        return;
    }

    // Image Compression Function
    async function compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('讀取圖片失敗：' + (reader.error?.message || 'FileReader error')));
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => reject(new Error(`圖片格式不支援或檔案損毀（${file.type || 'unknown type'}）`));
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions (max 1920px)
                    const MAX_WIDTH = 1920;
                    const MAX_HEIGHT = 1920;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // canvas.toBlob with the source mime may return null when the
                    // browser can't encode that type (e.g. image/heic). Fall back
                    // to image/jpeg so the upload still succeeds.
                    const tryEncode = (mime, quality) => new Promise(res => canvas.toBlob(b => res(b), mime, quality));
                    (async () => {
                        let blob = await tryEncode(file.type, 0.85);
                        if (!blob) blob = await tryEncode('image/jpeg', 0.85);
                        if (!blob) return reject(new Error('圖片編碼失敗（canvas.toBlob 回傳 null）'));
                        resolve(blob);
                    })();
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
    
    // Open Feedback Modal
    feedbackBtn.addEventListener('click', () => {
        // Check if user is logged in
        if (!currentUser) {
            alert('請先登入才能回報問題 🔐\n\n登入後可以幫助我們更好地追蹤您的回報。');
            return;
        }

        feedbackModal.style.display = 'flex';
        disableBodyScroll();
    });

    // Close Feedback Modal
    function closeFeedbackModalHandler() {
        feedbackModal.style.display = 'none';
        enableBodyScroll();
        resetFeedbackForm();
    }
    
    closeFeedbackModal.addEventListener('click', closeFeedbackModalHandler);
    cancelFeedbackBtn.addEventListener('click', closeFeedbackModalHandler);
    
    // Close modal when clicking outside
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) {
            closeFeedbackModalHandler();
        }
    });
    
    // Reset Form
    function resetFeedbackForm() {
        feedbackForm.reset();
        selectedImages = [];
        renderImagePreviews();
        feedbackStatus.className = 'feedback-status';
        feedbackStatus.textContent = '';
    }
    
    // Image Upload - Click
    imageUploadArea.addEventListener('click', () => {
        feedbackImages.click();
    });
    
    // Image Upload - File Input Change
    feedbackImages.addEventListener('change', (e) => {
        handleImageFiles(e.target.files);
    });
    
    // Image Upload - Drag and Drop
    imageUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        imageUploadArea.classList.add('drag-over');
    });
    
    imageUploadArea.addEventListener('dragleave', () => {
        imageUploadArea.classList.remove('drag-over');
    });
    
    imageUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        imageUploadArea.classList.remove('drag-over');
        handleImageFiles(e.dataTransfer.files);
    });
    
    // Handle Image Files
    function handleImageFiles(files) {
        const fileArray = Array.from(files);
    
        // Filter valid image files
        const imageFiles = fileArray.filter(file =>
            file.type === 'image/jpeg' ||
            file.type === 'image/png' ||
            file.type === 'image/webp'
        );
    
        // Check total count
        const remainingSlots = MAX_IMAGES - selectedImages.length;
        const filesToAdd = imageFiles.slice(0, remainingSlots);
    
        if (filesToAdd.length === 0 && selectedImages.length >= MAX_IMAGES) {
            showStatus('error', `最多只能上傳 ${MAX_IMAGES} 張圖片`);
            return;
        }
    
        // Add files to selectedImages
        filesToAdd.forEach(file => {
            selectedImages.push({
                file: file,
                preview: URL.createObjectURL(file),
                size: file.size
            });
        });
    
        renderImagePreviews();
    }
    
    // Render Image Previews
    function renderImagePreviews() {
        if (selectedImages.length === 0) {
            imagePreviewContainer.innerHTML = '';
            uploadPlaceholder.style.display = 'flex';
            return;
        }
    
        uploadPlaceholder.style.display = 'none';
    
        imagePreviewContainer.innerHTML = selectedImages.map((img, index) => `
            <div class="image-preview-item">
                <img src="${img.preview}" alt="Preview ${index + 1}">
                <button type="button" class="image-preview-remove" data-index="${index}">×</button>
                ${img.size > MAX_IMAGE_SIZE ? '<div class="image-size-warning">檔案較大</div>' : ''}
            </div>
        `).join('');
    
        // Add remove handlers
        document.querySelectorAll('.image-preview-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                URL.revokeObjectURL(selectedImages[index].preview);
                selectedImages.splice(index, 1);
                renderImagePreviews();
            });
        });
    }
    
    // Show Status Message
    function showStatus(type, message) {
        feedbackStatus.className = `feedback-status ${type}`;
        feedbackStatus.textContent = message;
    }
    
    // Submit Feedback
    submitFeedbackBtn.addEventListener('click', async () => {
        const message = feedbackMessage.value.trim();

        // Validation
        if (!message) {
            showStatus('error', '請填寫問題描述');
            return;
        }

        // Double check user is logged in
        if (!currentUser) {
            showStatus('error', '請先登入才能提交回報');
            return;
        }
    
        // Disable submit button
        submitFeedbackBtn.disabled = true;
        showStatus('loading', '正在上傳...');
    
        try {
            // Upload images to Firebase Storage — each one is wrapped so a single
            // failure (e.g. Storage quota exceeded) doesn't abort the whole
            // submission. Text feedback still goes through with whatever images
            // we managed to upload.
            const imageUrls = [];
            const imageUploadErrors = [];

            if (selectedImages.length > 0) {
                for (let i = 0; i < selectedImages.length; i++) {
                    const imgData = selectedImages[i];
                    showStatus('loading', `正在上傳圖片 ${i + 1}/${selectedImages.length}...`);

                    try {
                        const compressedBlob = await compressImage(imgData.file);
                        const timestamp = Date.now();
                        const userId = currentUser?.uid || 'anonymous';
                        const filename = `feedback/${timestamp}_${userId}_${i}.jpg`;
                        const storageReference = window.storageRef(window.storage, filename);
                        await window.uploadBytes(storageReference, compressedBlob);
                        const downloadUrl = await window.getDownloadURL(storageReference);
                        imageUrls.push(downloadUrl);
                    } catch (imgError) {
                        console.warn(`圖片 ${i + 1} 上傳失敗:`, imgError);
                        imageUploadErrors.push(imgError);
                    }
                }
            }

            // Save text feedback to Firestore even if images failed
            showStatus('loading', '正在儲存...');

            const feedbackData = {
                message: message,
                userName: currentUser.displayName || 'Unknown',
                userId: currentUser.uid,
                userEmail: currentUser.email || '',
                imageUrls: imageUrls,
                timestamp: window.serverTimestamp(),
                createdAt: new Date().toISOString()
            };
            // Record image-upload failure context for triage (quota, mime, etc.)
            if (imageUploadErrors.length > 0) {
                feedbackData.imageUploadFailedCount = imageUploadErrors.length;
                feedbackData.imageUploadFirstError = (imageUploadErrors[0] && (imageUploadErrors[0].code || imageUploadErrors[0].message)) || String(imageUploadErrors[0]);
            }

            await window.addDoc(window.collection(window.db, 'feedback'), feedbackData);

            // Status reflects what actually happened with images
            const total = selectedImages.length;
            const ok = imageUrls.length;
            let successMsg;
            if (total === 0 || imageUploadErrors.length === 0) {
                successMsg = '✅ 回報已送出，感謝您的回饋！';
            } else if (ok === 0) {
                successMsg = '⚠️ 文字回報已送出（圖片暫時無法上傳，已紀錄錯誤）';
            } else {
                successMsg = `⚠️ 已送出（${ok}/${total} 張圖片成功上傳）`;
            }
            showStatus('success', successMsg);

            // Reset form after 2 seconds
            setTimeout(() => {
                closeFeedbackModalHandler();
            }, 2000);

        } catch (error) {
            // Only reached if the Firestore write itself failed — image errors are
            // now handled per-image above and don't get here.
            console.error('Error saving feedback:', error);
            const detail = (error && (error.code || error.message)) || String(error);
            showStatus('error', `❌ 送出失敗：${detail}`);
        } finally {
            submitFeedbackBtn.disabled = false;
        }
    });

}); // End of Feedback System DOMContentLoaded

// ============================================
// Auth Modal System (Login/Register with Email)
// ============================================

let authMode = 'login'; // 'login', 'register', or 'forgotPassword'

function openAuthModal(mode = 'login') {
    authMode = mode;
    const modal = document.getElementById('auth-modal');
    const modalTitle = document.getElementById('auth-modal-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const switchText = document.getElementById('auth-switch-text');
    const confirmPasswordGroup = document.getElementById('auth-confirm-password-group');
    const passwordGroup = document.querySelector('.form-group:has(#auth-password)');
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    const authError = document.getElementById('auth-error');

    // Clear form
    document.getElementById('auth-form').reset();
    authError.style.display = 'none';

    if (mode === 'register') {
        modalTitle.textContent = '註冊';
        submitBtn.textContent = '註冊';
        switchText.innerHTML = '已經有帳號？<a href="#" id="auth-switch-link">立即登入</a>';
        confirmPasswordGroup.style.display = 'block';
        passwordGroup.style.display = 'block';
        forgotPasswordLink.style.display = 'none';
    } else if (mode === 'forgotPassword') {
        modalTitle.textContent = '忘記密碼';
        submitBtn.textContent = '發送重設密碼郵件';
        switchText.innerHTML = '<a href="#" id="auth-switch-link">返回登入</a>';
        confirmPasswordGroup.style.display = 'none';
        passwordGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'none';
    } else {
        modalTitle.textContent = '登入';
        submitBtn.textContent = '登入';
        switchText.innerHTML = '還沒有帳號？<a href="#" id="auth-switch-link">立即註冊</a>';
        confirmPasswordGroup.style.display = 'none';
        passwordGroup.style.display = 'block';
        forgotPasswordLink.style.display = 'inline-block';
    }

    modal.style.display = 'flex';
    disableBodyScroll();

    // Re-attach event listener for switch link
    document.getElementById('auth-switch-link').addEventListener('click', (e) => {
        e.preventDefault();
        if (authMode === 'forgotPassword') {
            openAuthModal('login');
        } else {
            openAuthModal(authMode === 'login' ? 'register' : 'login');
        }
    });
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'none';
    enableBodyScroll();
    document.getElementById('auth-form').reset();
    document.getElementById('auth-error').style.display = 'none';
}

function showAuthError(message) {
    const authError = document.getElementById('auth-error');
    authError.textContent = message;
    authError.style.display = 'block';
}

// Initialize auth modal event listeners
document.addEventListener('DOMContentLoaded', () => {
    const closeAuthModalBtn = document.getElementById('close-auth-modal');
    const googleSignInBtn = document.getElementById('google-sign-in-btn');
    const authForm = document.getElementById('auth-form');
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    const authModal = document.getElementById('auth-modal');

    // Close modal
    if (closeAuthModalBtn) {
        closeAuthModalBtn.addEventListener('click', closeAuthModal);
    }

    // Close on backdrop click
    if (authModal) {
        authModal.addEventListener('click', (e) => {
            if (e.target === authModal) {
                closeAuthModal();
            }
        });
    }

    // Google sign in
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async () => {
            // Check if user is in an in-app browser
            if (isInAppBrowser()) {
                console.log('⚠️ Google sign-in blocked: in-app browser detected');
                closeAuthModal();
                showWebViewWarning();
                return;
            }

            try {
                const result = await window.signInWithPopup(auth, window.googleProvider);
                console.log('Google sign in successful:', result.user);
                closeAuthModal();
            } catch (error) {
                console.error('Google sign in failed:', error);
                let errorMessage = '登入失敗，請稍後再試';
                if (error.code === 'auth/popup-closed-by-user') {
                    errorMessage = '登入視窗已關閉';
                } else if (error.code === 'auth/popup-blocked') {
                    errorMessage = '彈出視窗被瀏覽器阻擋，請允許彈出視窗';
                } else if (error.code === 'auth/unauthorized-domain') {
                    errorMessage = '此網域未經授權，請聯絡管理員';
                }
                showAuthError(errorMessage);
            }
        });
    }

    // Email/Password form submission
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const confirmPassword = document.getElementById('auth-confirm-password').value;
            const submitBtn = document.getElementById('auth-submit-btn');

            // Handle forgot password mode
            if (authMode === 'forgotPassword') {
                if (!email) {
                    showAuthError('請輸入您的 Email');
                    return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = '發送中...';

                try {
                    await window.sendPasswordResetEmail(auth, email);
                    const authError = document.getElementById('auth-error');
                    authError.textContent = '✅ 密碼重設信已寄出，請檢查您的 Email';
                    authError.style.display = 'block';
                    authError.style.background = '#d4edda';
                    authError.style.color = '#155724';
                } catch (error) {
                    console.error('Password reset error:', error);
                    let errorMessage = '發送失敗，請稍後再試';

                    if (error.code === 'auth/user-not-found') {
                        errorMessage = '找不到此 Email 帳號';
                    } else if (error.code === 'auth/invalid-email') {
                        errorMessage = 'Email 格式不正確';
                    }

                    const authError = document.getElementById('auth-error');
                    authError.textContent = errorMessage;
                    authError.style.display = 'block';
                    authError.style.background = '#fce8e6';
                    authError.style.color = '#c5221f';
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '發送重設密碼郵件';
                }
                return;
            }

            // Validation for login/register
            if (!email || !password) {
                showAuthError('請填寫所有欄位');
                return;
            }

            if (password.length < 6) {
                showAuthError('密碼至少需要 6 個字元');
                return;
            }

            if (authMode === 'register' && password !== confirmPassword) {
                showAuthError('密碼不一致，請重新輸入');
                return;
            }

            // Disable submit button
            submitBtn.disabled = true;
            submitBtn.textContent = authMode === 'login' ? '登入中...' : '註冊中...';

            try {
                if (authMode === 'register') {
                    // Register
                    const result = await window.createUserWithEmailAndPassword(auth, email, password);
                    console.log('Registration successful:', result.user);
                    closeAuthModal();
                } else {
                    // Login
                    const result = await window.signInWithEmailAndPassword(auth, email, password);
                    console.log('Login successful:', result.user);
                    closeAuthModal();
                }
            } catch (error) {
                console.error('Auth error:', error);
                let errorMessage = '操作失敗，請稍後再試';

                // Handle specific error codes
                switch (error.code) {
                    case 'auth/email-already-in-use':
                        errorMessage = '此 Email 已被註冊';
                        break;
                    case 'auth/invalid-email':
                        errorMessage = 'Email 格式不正確';
                        break;
                    case 'auth/user-not-found':
                        errorMessage = '找不到此帳號';
                        break;
                    case 'auth/wrong-password':
                        errorMessage = '密碼錯誤';
                        break;
                    case 'auth/too-many-requests':
                        errorMessage = '嘗試次數過多，請稍後再試';
                        break;
                    case 'auth/weak-password':
                        errorMessage = '密碼強度不足';
                        break;
                    case 'auth/invalid-credential':
                        errorMessage = 'Email 或密碼錯誤';
                        break;
                }

                showAuthError(errorMessage);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = authMode === 'login' ? '登入' : '註冊';
            }
        });
    }

    // Forgot password link - switch to forgot password mode
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            openAuthModal('forgotPassword');
        });
    }
}); // End of Auth Modal DOMContentLoaded

// ============================================
// WebView Warning Modal Event Listeners
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const closeWebViewWarningBtn = document.getElementById('close-webview-warning');
    const openInBrowserBtn = document.getElementById('open-in-browser-btn');
    const copyUrlBtn = document.getElementById('copy-url-btn');
    const useEmailLoginBtn = document.getElementById('use-email-login-btn');
    const webviewWarningModal = document.getElementById('webview-warning-modal');

    // Close WebView warning modal
    if (closeWebViewWarningBtn) {
        closeWebViewWarningBtn.addEventListener('click', () => {
            closeWebViewWarning();
        });
    }

    // Close on backdrop click
    if (webviewWarningModal) {
        webviewWarningModal.addEventListener('click', (e) => {
            if (e.target === webviewWarningModal) {
                closeWebViewWarning();
            }
        });
    }

    // Open in browser button
    if (openInBrowserBtn) {
        openInBrowserBtn.addEventListener('click', () => {
            openInBrowser();
        });
    }

    // Copy URL button
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', () => {
            copyUrlToClipboard();
        });
    }

    // Use email login button
    if (useEmailLoginBtn) {
        useEmailLoginBtn.addEventListener('click', () => {
            closeWebViewWarning();
            openAuthModal('login');
        });
    }
}); // End of WebView Warning Modal DOMContentLoaded

// ============================================
// GA4 Button Click Tracking
// ============================================
document.addEventListener('click', function(e) {
    if (!window.logEvent || !window.firebaseAnalytics) return;
    const btn = e.target.closest(
        '.spotlight-compare-btn, .spotlight-info-btn, .card-apply-cta-btn, .promo-apply-cta-btn, .card-detail-apply-header-btn, .card-detail-apply-bar-btn'
    );
    if (!btn) return;

    let buttonType;
    if (btn.classList.contains('spotlight-compare-btn'))        buttonType = 'spotlight_compare';
    else if (btn.classList.contains('spotlight-info-btn'))      buttonType = 'spotlight_info';
    else if (btn.classList.contains('spotlight-apply-cta-btn')) buttonType = 'spotlight_apply';
    else if (btn.classList.contains('card-detail-apply-header-btn')) buttonType = 'detail_header_apply';
    else if (btn.classList.contains('card-detail-apply-bar-btn'))    buttonType = 'detail_sticky_apply';
    else if (btn.classList.contains('card-apply-cta-btn'))      buttonType = 'card_apply';
    else                                                         buttonType = 'search_result_apply';

    window.logEvent(window.firebaseAnalytics, 'button_click', {
        button_type: buttonType,
        card_id:     btn.dataset.cardId   || '',
        card_name:   btn.dataset.cardName || '',
        merchant:    btn.dataset.merchant || '',
    });
});









