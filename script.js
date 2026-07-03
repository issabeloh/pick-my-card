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

    init() {
        this.element = document.getElementById('global-loading-overlay');
        this.textElement = document.getElementById('loading-text');
    },

    show(message = '載入中...') {
        if (!this.element) this.init();

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
    // If no date restrictions, rate is always active
    if (!periodStart || !periodEnd) {
        return 'always';
    }

    try {
        const today = getTaiwanToday(); // YYYY-MM-DD，ISO 字典序 = 日期序
        // periodStart/periodEnd 可能是 ISO "YYYY-MM-DD" 或台灣慣用 "YYYY/M/D"，
        // 字串比較前先統一轉成 ISO，否則 "-" 與 "/" 的字元順序會讓比較結果錯亂
        const start = periodStart.includes('-') ? periodStart : slashDateToISO(periodStart);
        const end = periodEnd.includes('-') ? periodEnd : slashDateToISO(periodEnd);
        if (today >= start && today <= end) return 'active';
        if (today < start) return 'upcoming';
        return 'expired';
    } catch (error) {
        console.error('❌ Date parsing error:', error, { periodStart, periodEnd });
        return 'always';
    }
}

// Check if a rate is currently active (for backwards compatibility)
function isRateActive(periodStart, periodEnd) {
    const status = getRateStatus(periodStart, periodEnd);
    return status === 'active' || status === 'always';
}

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
        // Filter cashbackRates - keep active and upcoming (within 30 days)
        if (card.cashbackRates && Array.isArray(card.cashbackRates)) {
            card.cashbackRates = card.cashbackRates.filter(rate => {
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
            const endDate = parseDateString(promo.period_end);
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

// Parse YYYY/M/D or YYYY/MM/DD date string to Date object
function parseDateString(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    return new Date(year, month, day);
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
async function loadCardsData() {
    try {
        const timestamp = new Date().getTime(); // 防止快取
        const response = await fetch(`cards.data?t=${timestamp}`, {
            cache: 'no-store', // 強制不使用快取
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

        // Guest: load from localStorage
        const storedPrefs = localStorage.getItem('userQuickSearchPrefs');
        if (storedPrefs) {
            const parsed = JSON.parse(storedPrefs);
            return {
                hiddenDefaultIds: parsed.hiddenDefaultIds || [],
                customQuickOptions: parsed.customQuickOptions || [],
                selectedOrder: parsed.selectedOrder || []
            };
        }

        // Legacy localStorage migration (guest had old format)
        const legacyOptions = localStorage.getItem('userQuickSearchOptions');
        const legacyCustoms = localStorage.getItem('userCustomQuickOptions');
        if (legacyOptions) {
            console.log('🔀 偵測到 localStorage 舊格式，自動遷移');
            const oldList = JSON.parse(legacyOptions);
            const customs = legacyCustoms ? JSON.parse(legacyCustoms) : [];
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

    if (allMatches.length > 0) {
        // Get cards to compare for parking benefits check
        const cardsToCompare = getCardsForComparison();
        showMatchedItem(allMatches, option.displayName, cardsToCompare);
        currentMatchedItem = allMatches;
        currentQuickSearchOption = option; // Store quick search option for parking benefits

        // Auto-trigger calculation if amount is filled
        const amountInput = document.getElementById('amount-input');
        if (amountInput && amountInput.value) {
            const calculateBtn = document.getElementById('calculate-btn');
            if (calculateBtn && !calculateBtn.disabled) {
                calculateBtn.click();
            }
        }
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
        const rateNum = parseCashbackRateSync(group.rate, levelData);
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
        handleQuickSearch(matchedOption);
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

    // Click on text to show modal
    announcementText.addEventListener('click', (e) => {
        e.preventDefault();
        showAnnouncementModal(currentAnnouncementIndex);
    });
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

    // Get fullText and display with HTML support
    const fullText = announcement.fullText || announcement.text;

    // Clear and update modal content
    modalBody.innerHTML = '';
    modalBody.style.color = '#374151';
    modalBody.style.fontSize = '0.95rem';
    modalBody.innerHTML = fullText;

    // Show/hide link button
    if (announcement.link) {
        modalLink.href = announcement.link;
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
function displayAnnouncement(index) {
    const announcementText = document.getElementById('announcement-text');
    const announcementIndicator = document.getElementById('announcement-indicator');

    if (!announcementText || !announcements[index]) return;

    const announcement = announcements[index];

    // Fade out
    announcementText.classList.add('fade-out');

    setTimeout(() => {
        // Update content with date badge if available
        if (announcement.date) {
            // Display with date badge
            announcementText.innerHTML = `<span class="announcement-date-badge">${announcement.date}</span>${announcement.text}`;
        } else {
            // Display without date
            announcementText.textContent = announcement.text;
        }

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
function toggleAnnouncementPause() {
    isAnnouncementPaused = !isAnnouncementPaused;
}

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
        currentMatchedItem = null;
        validateInputs();
        return;
    }

    // Find matching items (now returns array)
    const matchedItems = findMatchingItem(input);

    console.log('  findMatchingItem 結果:', matchedItems ? matchedItems.length : 0);

    if (matchedItems && matchedItems.length > 0) {
        // Get cards to compare for parking benefits check
        const cardsToCompare = getCardsForComparison();
        showMatchedItem(matchedItems, input, cardsToCompare);
        currentMatchedItem = matchedItems; // Now stores array of matches
        console.log('  ✅ 設定 currentMatchedItem:', currentMatchedItem.length);
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
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
    '日航': 'jal',
    'jal': 'japan airlines',
    '全日空': 'ana',
    'all nippon airways': 'ana',
    '大韓航空': 'korean air',
    '大韓': 'korean air',
    '韓亞航空': 'asiana airlines',
    '韓亞': 'asiana airlines',
    '國泰航空': 'cathay pacific',
    '國泰': 'cathay pacific',
    '新加坡航空': 'singapore airlines',
    '新航': 'singapore airlines',
    'sia': 'singapore airlines',
    '泰國航空': 'thai airways',
    '泰航': 'thai airways',
    '馬來西亞航空': 'malaysia airlines',
    'airasia': '亞洲航空',
    '馬航': 'malaysia airlines',
    '越南航空': 'vietnam airlines',
    '越航': 'vietnam airlines',
    '菲律賓航空': 'philippine airlines',
    '菲航': 'philippine airlines',
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
    'sogo': '遠東 SOGO'
};

// Search term exclusion rules - prevents unwanted matches
// Format: 'searchTerm': ['excluded item 1', 'excluded item 2', ...]
const searchExclusionMap = {
    '街口': ['日本paypay(限於街口支付綁定)'],
    '街口支付': ['日本paypay(限於街口支付綁定)']
};

// Find matching item in cards database
function findMatchingItem(searchTerm) {
    if (!cardsData) return null;

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
            messageHtml = `✓ 匹配到: <strong>${matchedItems[0].originalItem}</strong>`;
        } else {
            // 如果所有項目名稱相同，只顯示一次
            const uniqueItems = [...new Set(matchedItems.map(item => item.originalItem))];
            if (uniqueItems.length === 1) {
                messageHtml = `✓ 匹配到: <strong>${uniqueItems[0]}</strong>`;
            } else {
                const itemList = uniqueItems.join('、');
                messageHtml = `✓ 匹配到: <strong>${itemList}</strong>`;
            }
        }
    } else {
        // Backward compatibility for single item
        messageHtml = `✓ 匹配到: <strong>${matchedItems.originalItem}</strong>`;
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

    // Show loading for operations that might take time
    const cardsToCompareCount = getCardsForComparison().length;

    // Only show loading if comparing many cards or multiple matched items
    const shouldShowLoading = cardsToCompareCount > 5 || (currentMatchedItem && Array.isArray(currentMatchedItem) && currentMatchedItem.length > 3);

    if (shouldShowLoading) {
        loadingOverlay.show('正在計算回饋...');
        // Allow UI to update
        await new Promise(resolve => setTimeout(resolve, 50));
    }

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
                    const cardNames = itemResults.map(r => `${r.card.name}(${r.rate}%)`).join(', ');
                    console.log(`  ✅ 找到 ${itemResults.length} 張卡有回饋: ${cardNames}`);

                    // Sort by cashback amount (highest first)
                    itemResults.sort((a, b) => b.cashbackAmount - a.cashbackAmount);
                    console.log(`    🥇 最佳: ${itemResults[0].card.name} ${itemResults[0].rate}%`);

                    // Add ALL cards with cashback, not just the best one
                    allItemResults.push(...itemResults);
                } else {
                    console.log(`  ⚠️ 找到 0 張卡有回饋 (可能未選取相關卡片)`);
                }
            }

            console.log(`📊 總共 ${allItemResults.length} 個項目有回饋結果`);

            // If some items matched but no cards have cashback, add a note
            const unmatchedCount = currentMatchedItem.length - allItemResults.length;
            if (unmatchedCount > 0 && currentUser) {
                console.log(`⚠️ 有 ${unmatchedCount} 個匹配項目沒有找到回饋，可能是因為未選取相關卡片`);
            }

            // Merge results from same card and same activity
            // Group by: card + rate + cap + period + category + conditions
            const mergedResultsMap = new Map();

            for (const result of allItemResults) {
                // Create a unique key for this activity
                const mergeKey = `${result.card.id}-${result.rate}-${result.cap || 'nocap'}-${result.periodStart || ''}-${result.periodEnd || ''}-${result.matchedCategory || 'nocat'}`;

                if (mergedResultsMap.has(mergeKey)) {
                    // Same activity - add this item to the matched items list
                    const existing = mergedResultsMap.get(mergeKey);
                    if (!existing.matchedItems.includes(result.matchedItemName)) {
                        existing.matchedItems.push(result.matchedItemName);
                    }
                } else {
                    // New activity - create new entry
                    mergedResultsMap.set(mergeKey, {
                        ...result,
                        matchedItems: [result.matchedItemName]
                    });
                }
            }

            allResults = Array.from(mergedResultsMap.values());

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
            const mergedResultsMap = new Map();

            for (const result of itemResults) {
                // Create a unique key for this activity
                const mergeKey = `${result.card.id}-${result.rate}-${result.cap || 'nocap'}-${result.periodStart || ''}-${result.periodEnd || ''}-${result.matchedCategory || 'nocat'}`;

                if (mergedResultsMap.has(mergeKey)) {
                    // Same activity - add this item to the matched items list
                    const existing = mergedResultsMap.get(mergeKey);
                    if (!existing.matchedItems.includes(result.matchedItemName)) {
                        existing.matchedItems.push(result.matchedItemName);
                    }
                } else {
                    // New activity - create new entry
                    mergedResultsMap.set(mergeKey, {
                        ...result,
                        matchedItems: [result.matchedItemName]
                    });
                }
            }

            allResults = Array.from(mergedResultsMap.values());

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
        // Group by: card + rate + cap + period + category
        const mergedUpcomingMap = new Map();

        for (const result of upcomingResults) {
            // Create a unique key for this activity
            const mergeKey = `${result.card.id}-${result.rate}-${result.cap || 'nocap'}-${result.periodStart || ''}-${result.periodEnd || ''}-${result.matchedCategory || 'nocat'}`;

            if (mergedUpcomingMap.has(mergeKey)) {
                // Same activity - merge matched items
                const existing = mergedUpcomingMap.get(mergeKey);

                // Ensure existing has matchedItems array
                if (!existing.matchedItems) {
                    existing.matchedItems = existing.matchedItem ? [existing.matchedItem] : [];
                }

                // Add new matched items (could be single item or array)
                const newItems = result.matchedItems || [result.matchedItemName || result.matchedItem];
                for (const item of newItems) {
                    if (item && !existing.matchedItems.includes(item)) {
                        existing.matchedItems.push(item);
                    }
                }
            } else {
                // New activity - create new entry
                mergedUpcomingMap.set(mergeKey, {
                    ...result,
                    matchedItems: result.matchedItems || [result.matchedItemName || result.matchedItem]
                });
            }
        }

        uniqueUpcomingResults = Array.from(mergedUpcomingMap.values());

        console.log(`📊 Upcoming 合併前: ${upcomingResults.length} 個結果，合併後: ${uniqueUpcomingResults.length} 個結果`);

        // Show no-match message and basic rates when no special rates found
        if (results.length === 0 && merchantValue.length > 0) {
            showNoMatchMessage(merchantValue, cardsToCompare);
            // Show basic cashback for selected cards when no special rates found
            isBasicCashback = true;

            // Check if search term is overseas-related
            const overseasKeywords = ['海外', '國外', '日本', '韓國', '美國', '歐洲', '新加坡', '泰國', '越南', '馬來西亞', '印尼', '菲律賓', '香港', '澳門', '中國'];
            const merchantLower = merchantValue.toLowerCase();
            const isOverseasSearch = overseasKeywords.some(keyword =>
                merchantLower.includes(keyword.toLowerCase())
            );

            results = cardsToCompare.map(card => {
                let basicCashbackAmount = 0;
                let effectiveRate = card.basicCashback;
                let displayCap = null;

                if (isOverseasSearch && card.overseasCashback) {
                    // Use overseas cashback rate for overseas searches
                    effectiveRate = card.overseasCashback;

                    if (card.overseasBonusRate && card.overseasBonusCap) {
                        // Has overseas bonus (like 永豐大戶卡)
                        const bonusAmount = Math.min(amount, card.overseasBonusCap);
                        const bonusCashback = Math.floor(bonusAmount * card.overseasBonusRate / 100);
                        const basicCashback = Math.floor(amount * card.overseasCashback / 100);
                        basicCashbackAmount = bonusCashback + basicCashback;
                        effectiveRate = card.overseasCashback + card.overseasBonusRate;
                        displayCap = card.overseasBonusCap;
                    } else {
                        // Simple overseas cashback
                        basicCashbackAmount = Math.floor(amount * card.overseasCashback / 100);
                    }
                } else if (card.domesticBonusRate && card.domesticBonusCap) {
                    // Handle complex cards like 永豐幣倍 with domestic bonus
                    const bonusAmount = Math.min(amount, card.domesticBonusCap);
                    const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
                    const basicCashback = Math.floor(amount * card.basicCashback / 100);
                    basicCashbackAmount = bonusCashback + basicCashback;
                    effectiveRate = card.basicCashback + card.domesticBonusRate;
                    displayCap = card.domesticBonusCap;
                } else {
                    basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
                }

                return {
                    rate: effectiveRate,
                    cashbackAmount: basicCashbackAmount,
                    cap: displayCap,
                    matchedItem: null,
                    effectiveAmount: amount,
                    card: card,
                    isBasic: true
                };
            });
        }
    } else {
        // No match found or no input - show basic cashback for selected cards
        isBasicCashback = true;

        // Check if search term is overseas-related
        const overseasKeywords = ['海外', '國外', '日本', '韓國', '美國', '歐洲', '新加坡', '泰國', '越南', '馬來西亞', '印尼', '菲律賓', '香港', '澳門', '中國'];
        const merchantLower = merchantValue.toLowerCase();
        const isOverseasSearch = overseasKeywords.some(keyword =>
            merchantLower.includes(keyword.toLowerCase())
        );

        results = cardsToCompare.map(card => {
            let basicCashbackAmount = 0;
            let effectiveRate = card.basicCashback;
            let displayCap = null;

            if (isOverseasSearch && card.overseasCashback) {
                // Use overseas cashback rate for overseas searches
                effectiveRate = card.overseasCashback;

                if (card.overseasBonusRate && card.overseasBonusCap) {
                    // Has overseas bonus (like 永豐大戶卡)
                    const bonusAmount = Math.min(amount, card.overseasBonusCap);
                    const bonusCashback = Math.floor(bonusAmount * card.overseasBonusRate / 100);
                    const basicCashback = Math.floor(amount * card.overseasCashback / 100);
                    basicCashbackAmount = bonusCashback + basicCashback;
                    effectiveRate = card.overseasCashback + card.overseasBonusRate;
                    displayCap = card.overseasBonusCap;
                } else {
                    // Simple overseas cashback
                    basicCashbackAmount = Math.floor(amount * card.overseasCashback / 100);
                }
            } else if (card.domesticBonusRate && card.domesticBonusCap) {
                // Handle complex cards like 永豐幣倍 with domestic bonus
                const bonusAmount = Math.min(amount, card.domesticBonusCap);
                const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
                const basicCashback = Math.floor(amount * card.basicCashback / 100);
                basicCashbackAmount = bonusCashback + basicCashback;
                effectiveRate = card.basicCashback + card.domesticBonusRate;
                displayCap = card.domesticBonusCap;
            } else {
                basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
            }

            return {
                rate: effectiveRate,
                cashbackAmount: basicCashbackAmount,
                cap: displayCap,
                matchedItem: null,
                effectiveAmount: amount,
                card: card,
                isBasic: true
            };
        });

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

            const mergedMap = new Map();
            for (const result of upcomingResults) {
                const key = `${result.card.id}-${result.rate}-${result.cap || 'nocap'}-${result.periodStart || ''}-${result.periodEnd || ''}-${result.matchedCategory || 'nocat'}`;
                if (mergedMap.has(key)) {
                    const existing = mergedMap.get(key);
                    if (!existing.matchedItems) existing.matchedItems = existing.matchedItem ? [existing.matchedItem] : [];
                    const newItems = result.matchedItems || [result.matchedItemName || result.matchedItem];
                    for (const item of newItems) {
                        if (item && !existing.matchedItems.includes(item)) existing.matchedItems.push(item);
                    }
                } else {
                    mergedMap.set(key, { ...result, matchedItems: result.matchedItems || [result.matchedItemName || result.matchedItem] });
                }
            }
            uniqueUpcomingResults = Array.from(mergedMap.values());
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
        // Always hide loading overlay, even on error
        if (shouldShowLoading) {
            loadingOverlay.hide();
        }
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
function merchantMatchesStrict(merchantName, searchVariants) {
    const units = getMerchantSearchUnits(merchantName);
    return units.some(unit =>
        searchVariants.some(term =>
            term === unit || term.startsWith(unit) || unit.startsWith(term)
        )
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
function calculateLayeredCashback(card, levelSettings, amount, displayedRate, cap, isOverseas = false) {
    const layers = [];
    let totalCashback = 0;

    // Layer 1: Basic cashback (always applies, no cap)
    const basicCashback = Math.floor(amount * card.basicCashback / 100);
    layers.push({
        name: '基本回饋',
        rate: card.basicCashback,
        applicableAmount: amount,
        cashback: basicCashback,
        cap: null
    });
    totalCashback += basicCashback;

    // Layer 2: Bonus rate (domestic or overseas, with consumption cap)
    let bonusRate = 0;
    let bonusCap = 0;
    let bonusName = '';

    if (isOverseas && levelSettings.overseasBonusRate && levelSettings.overseasBonusCap) {
        bonusRate = levelSettings.overseasBonusRate;
        bonusCap = levelSettings.overseasBonusCap;
        bonusName = '海外消費加碼';
    } else if (!isOverseas && levelSettings.domesticBonusRate && levelSettings.domesticBonusCap) {
        bonusRate = levelSettings.domesticBonusRate;
        bonusCap = levelSettings.domesticBonusCap;
        bonusName = '國內消費加碼';
    }

    if (bonusRate > 0 && bonusCap > 0) {
        const bonusApplicableAmount = Math.min(amount, bonusCap);
        const bonusCashback = Math.floor(bonusApplicableAmount * bonusRate / 100);
        layers.push({
            name: bonusName,
            rate: bonusRate,
            applicableAmount: bonusApplicableAmount,
            cashback: bonusCashback,
            cap: bonusCap
        });
        totalCashback += bonusCashback;
    }

    // Layer 3: Designated region/category bonus (with consumption cap)
    // This is the additional rate on top of basic + bonus
    const designatedBonusRate = displayedRate - card.basicCashback - bonusRate;

    if (designatedBonusRate > 0 && cap) {
        const designatedApplicableAmount = Math.min(amount, cap);
        const designatedCashback = Math.floor(designatedApplicableAmount * designatedBonusRate / 100);
        layers.push({
            name: '指定項目加碼',
            rate: designatedBonusRate,
            applicableAmount: designatedApplicableAmount,
            cashback: designatedCashback,
            cap: cap
        });
        totalCashback += designatedCashback;
    }

    return {
        cashbackAmount: totalCashback,
        layers: layers
    };
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
                // Update Firestore with correct format
                await saveCardLevel(card.id, savedLevel);
            } else {
                // Fallback to default level
                savedLevel = defaultLevel;
                await saveCardLevel(card.id, savedLevel);
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

                    // Check if levelSettings has rate_hide to override the cashbackRate
                    // Only apply rate_hide for rateGroups with hideInDisplay=true
                    let finalRate = parsedRate;
                    if (levelSettings && levelSettings.rate_hide !== undefined && rateGroup.hideInDisplay === true) {
                        finalRate = levelSettings.rate_hide;
                        // Also update cap from levelSettings if available
                        if (levelSettings.cap !== undefined) {
                            applicableCap = levelSettings.cap;
                        }
                        console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}"，使用 levelSettings.rate_hide (${levelSettings.rate_hide}%)`);
                    } else {
                        // 顯示原始 rate 或解析後的值
                        const displayRate = (rateGroup.rate === '{specialRate}' || rateGroup.rate === '{rate}')
                            ? `${rateGroup.rate}=${parsedRate}`
                            : parsedRate;
                        console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}" (${displayRate}%)`);
                    }

                    // Add this match to allMatches array
                    allMatches.push({
                        rate: finalRate,
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

            if (!matchedSpecialItem && card.id === 'cathay-cube') {
                console.log(`⚠️ ${card.name}: 未匹配到 specialItem (搜索變體: ${searchVariants.join(', ')})`);
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
            const savedLevel = await getCardLevel(card.id, defaultLevel);
            levelData = card.levelSettings[savedLevel];
            selectedLevel = savedLevel; // Store selected level for display
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

                    // 解析 rate 值（支援 {rate}、{specialRate}、{rate_hide} 等）
                    let parsedRate = await parseCashbackRate(rateGroup.rate, card, levelData);
                    let parsedCap = parseCashbackCap(rateGroup.cap, card, levelData);

                    // Find the exact matched item name
                    const exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);

                    // Check if levelSettings has rate_hide to override the cashbackRate
                    // Only apply rate_hide for rateGroups with hideInDisplay=true
                    let finalRate = parsedRate;
                    let applicableCap = parsedCap !== null ? parsedCap : rateGroup.cap;

                    if (levelData && levelData.rate_hide !== undefined && rateGroup.hideInDisplay === true) {
                        finalRate = levelData.rate_hide;
                        // Also update cap from levelSettings if available
                        if (levelData.cap !== undefined) {
                            applicableCap = levelData.cap;
                        }
                        console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}"，使用 levelSettings.rate_hide (${levelData.rate_hide}%)`);
                    } else {
                        // 顯示原始 rate 或解析後的值
                        const displayRate = (rateGroup.rate === '{rate_hide}' || rateGroup.rate === '{rate}')
                            ? `${rateGroup.rate}=${parsedRate}`
                            : parsedRate;
                        console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}" (${displayRate}%)`);
                    }

                    // Add this match to allMatches array
                    allMatches.push({
                        rate: finalRate,
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

        // Check if we should use layered calculation
        // Criteria: card has levelSettings with overseasBonusRate or domesticBonusRate
        let shouldUseLayeredCalculation = false;
        let levelSettingsForCalc = null;
        let isOverseasTransaction = false;

        if (card.hasLevels && card.levelSettings) {
            // Get the level settings for this card
            const availableLevels = Object.keys(card.levelSettings);
            const levelToUse = selectedLevel || availableLevels[0];
            levelSettingsForCalc = card.levelSettings[levelToUse];

            // Check if this level has bonus rates (indicating layered calculation needed)
            if (levelSettingsForCalc &&
                (levelSettingsForCalc.overseasBonusRate || levelSettingsForCalc.domesticBonusRate)) {
                shouldUseLayeredCalculation = true;

                // Determine if this is an overseas transaction
                // Check the matched item or category for overseas keywords
                const overseasKeywords = ['海外', '國外', '日本', '韓國', '美國', '歐洲', '新加坡', '泰國', '越南', '馬來西亞', '印尼', '菲律賓', '香港', '澳門', '中國'];
                const itemToCheck = (matchedItem || '').toLowerCase();
                const categoryToCheck = (matchedCategory || '').toLowerCase();

                isOverseasTransaction = overseasKeywords.some(keyword =>
                    itemToCheck.includes(keyword.toLowerCase()) ||
                    categoryToCheck.includes(keyword.toLowerCase())
                );
            }
        }

        if (rate > 0) {
            if (shouldUseLayeredCalculation && levelSettingsForCalc) {
                // Use layered calculation for complex multi-tier cashback
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
                // Use simple calculation for standard cashback
                let specialCashback = 0;
                let effectiveSpecialAmount = amount;

                if (cap && amount > cap) {
                    effectiveSpecialAmount = cap;
                }

                // NOTE: All cashback rates in cashbackRates are already TOTAL rates (including basic)
                // Do NOT add basicCashback or domesticBonusRate on top
                specialCashback = Math.floor(effectiveSpecialAmount * rate / 100);

                // Handle remaining amount if capped (excess amount gets basic cashback only)
                let remainingCashback = 0;
                if (cap && amount > cap) {
                    const remainingAmount = amount - cap;

                    // 🔥 Check if should use overseasCashback for excess amount
                    // Conditions: items include meta广告 or google广告, and NOT 台新 Richart 卡
                    const isAdPlatform = matchedRateGroup?.items?.some(item =>
                        item.toLowerCase().includes('meta廣告') ||
                        item.toLowerCase().includes('google廣告')
                    );
                    const shouldUseOverseasForExcess =
                        isAdPlatform && card.id !== 'taishin-richart';

                    // Choose excess rate: overseasCashback > basicCashback
                    const excessRate = shouldUseOverseasForExcess
                        ? (card.overseasCashback || card.basicCashback)
                        : card.basicCashback;

                    remainingCashback = Math.floor(remainingAmount * excessRate / 100);
                }

                // Total cashback = special rate amount + remaining basic amount
                cashbackAmount = specialCashback + remainingCashback;

                // Total rate is the special rate from cashbackRates (no bonusRate added)
                totalRate = Math.round(rate * 100) / 100;
                effectiveAmount = cap; // Keep this for display purposes
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
        const savedLevel = await getCardLevel(card.id, defaultLevel);
        levelData = card.levelSettings[savedLevel];
        selectedLevel = savedLevel;
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

                    // 🔥 Check if should use overseasCashback for excess amount
                    // Conditions: items include meta广告 or google广告, and NOT 台新 Richart 卡
                    const isAdPlatform = rateGroup.items?.some(item =>
                        item.toLowerCase().includes('meta廣告') ||
                        item.toLowerCase().includes('google廣告')
                    );
                    const shouldUseOverseasForExcess =
                        isAdPlatform && card.id !== 'taishin-richart';

                    // Choose excess rate: overseasCashback > basicCashback
                    const excessRate = shouldUseOverseasForExcess
                        ? (card.overseasCashback || card.basicCashback)
                        : card.basicCashback;

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

    let infoHTML = `<div class="merchant-payment-title">＊ ${merchantInfo.merchantName}也支援以下行動支付</div>`;

    // 計算有多少個付款方式
    const hasOnline = merchantInfo.online && merchantInfo.online.trim() !== '';
    const hasOffline = merchantInfo.offline && merchantInfo.offline.trim() !== '';
    const bothExist = hasOnline && hasOffline;

    if (hasOnline) {
        const label = bothExist ? '<span class="payment-label">線上：</span>' : '';
        infoHTML += `<div class="merchant-payment-item">${label}${merchantInfo.online}</div>`;
    }

    if (hasOffline) {
        const label = bothExist ? '<span class="payment-label">門市：</span>' : '';
        infoHTML += `<div class="merchant-payment-item">${label}${merchantInfo.offline}</div>`;
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

    infoBlock.innerHTML = `
        <div class="referral-link-content">
            <span class="referral-link-icon">🎁</span>
            <span class="referral-link-text">${matchedReferral.description}</span>
            <a href="${matchedReferral.url}" target="_blank" rel="noopener noreferrer" class="referral-link-button">
                前往註冊 →
            </a>
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
    let html = `<div class="merchant-payment-title">＊ <strong>${matchedMerchantName}</strong> 也可透過導購網站享加碼回饋</div>`;
    if (shopbackMatch) {
        html += `<div class="merchant-payment-item"><a href="${shopbackMatch.link}" target="_blank" rel="noopener noreferrer" class="cashback-site-link">Shopback →</a></div>`;
    }
    if (linebuyMatch) {
        html += `<div class="merchant-payment-item"><a href="${linebuyMatch.link}" target="_blank" rel="noopener noreferrer" class="cashback-site-link">LINE 購物 →</a></div>`;
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
            <p>沒有任何信用卡對「${searchedItem}」提供現金回饋。</p>
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
    const level = await getCardLevel('cathay-cube', 'Level 1');
    const levelSettings = card.levelSettings[level];

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

// 解析 cashbackRates 中的 rate 值（支援數字、{specialRate}、{rate}）
async function parseCashbackRate(rate, card, levelSettings) {
    // 如果是數字，直接返回
    if (typeof rate === 'number') {
        return rate;
    }

    // 如果不是字串，嘗試轉換成數字
    if (typeof rate !== 'string') {
        return parseFloat(rate);
    }

    // 處理 {placeholder} 格式（支援任意欄位名稱）
    const placeholderMatch = rate.match(/^\{(.+)\}$/);
    if (placeholderMatch) {
        const fieldName = placeholderMatch[1]; // 提取欄位名稱（如 "rate", "rate_1", "overseasBonusRate"）

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

// 同步版本的 rate 解析（用於排序，不顯示警告）
function parseCashbackRateSync(rate, levelData) {
    if (typeof rate === 'number') {
        return rate;
    }

    // 處理 {placeholder} 格式（支援任意欄位名稱）
    if (typeof rate === 'string') {
        const placeholderMatch = rate.match(/^\{(.+)\}$/);
        if (placeholderMatch) {
            const fieldName = placeholderMatch[1];
            return levelData?.[fieldName] || 0;
        }
    }

    return parseFloat(rate) || 0;
}

// 解析 cashbackRates 中的 cap 值（支援數字和 {cap}、{cap_1} 等任意 placeholder）
function parseCashbackCap(cap, card, levelSettings) {
    // 如果是數字，直接返回
    if (typeof cap === 'number') {
        return cap;
    }

    // 如果是 undefined 或 null，返回 null
    if (cap === undefined || cap === null) {
        return null;
    }

    // 如果不是字串，嘗試轉換成數字
    if (typeof cap !== 'string') {
        const parsed = parseInt(cap);
        return isNaN(parsed) ? null : parsed;
    }

    // 處理 {placeholder} 格式（支援任意欄位名稱）
    const placeholderMatch = cap.match(/^\{(.+)\}$/);
    if (placeholderMatch) {
        const fieldName = placeholderMatch[1]; // 提取欄位名稱（如 "cap", "cap_1", "domesticBonusCap"）

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

                    matchingCoupons.push({
                        ...coupon,
                        cardName: card.name,
                        cardId: card.id,
                        actualRate: actualRate, // 儲存計算後的實際回饋率
                        potentialCashback: Math.floor(amount * actualRate / 100),
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
    const ids = ['show-promos-toggle-desktop', 'show-promos-toggle-mobile'];
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

    // Mobile help: click '?' toggles a sibling text panel inline.
    document.querySelectorAll('.promo-help-inline').forEach(btn => {
        const targetId = btn.getAttribute('data-help-target');
        const text = targetId && document.getElementById(targetId);
        if (!text) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const isHidden = text.hasAttribute('hidden');
            text.toggleAttribute('hidden', !isHidden);
            btn.setAttribute('aria-expanded', String(isHidden));
        });
    });

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
function parsePromoRate(rateStr) {
    if (!rateStr) return 0;
    const m = String(rateStr).match(/(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    return parseFloat(m[1]) / 100;
}

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
function cardMatchesSearch(card, merchantValue, quickKeywords) {
    if (!card || !card._itemsIndex) return false;
    const terms = [];
    if (Array.isArray(quickKeywords) && quickKeywords.length > 0) {
        quickKeywords.forEach(k => { if (k) terms.push(String(k).toLowerCase()); });
    } else if (merchantValue) {
        terms.push(String(merchantValue).toLowerCase());
    }
    if (terms.length === 0) return false;
    for (const itemKey of card._itemsIndex.keys()) {
        if (terms.some(t => itemKey.includes(t) || t.includes(itemKey))) return true;
    }
    return false;
}

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
    } else if (promoStatus === 'active' && isoEnd && isEndingSoon(isoEnd, 10)) {
        const daysUntil = getDaysUntilEnd(isoEnd);
        if (daysUntil != null) {
            const daysText = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : `${daysUntil}天後`;
            promoBadgeHtml = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
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

    // Promo type chips — detail page shows all types inline; search results show
    // the first promo type as a corner chip (colored by type).
    let chipsHtml = '';
    let cornerChipHtml = '';
    if (Array.isArray(promo.promo_types) && promo.promo_types.length > 0) {
        if (opts.showExtras) {
            const chips = promo.promo_types
                .map(t => `<span class="promo-type-chip promo-type-${promoTypeClass(t)}">${escapeHtml(t)}</span>`)
                .join('');
            chipsHtml = `<div class="promo-type-chips">${chips}</div>`;
        } else {
            // Prefer 回饋加碼 if present, otherwise use the first type
            const cornerType = promo.promo_types.includes('回饋加碼')
                ? '回饋加碼'
                : promo.promo_types[0];
            cornerChipHtml = `<span class="promo-type-chip promo-type-${promoTypeClass(cornerType)} promo-type-chip-corner">${escapeHtml(cornerType)}</span>`;
        }
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
        ${cornerChipHtml}
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

    // Click → smooth-scroll the modal-content so section sits just under the sticky nav
    buttons.forEach(btn => {
        btn.onclick = () => {
            const section = document.getElementById(btn.dataset.section);
            if (!section) return;
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
    const updateActive = () => {
        const navHeight = nav.offsetHeight;
        const containerTop = modalContent.getBoundingClientRect().top;
        let current = visibleSections[0];
        for (const s of visibleSections) {
            const top = s.section.getBoundingClientRect().top - containerTop - navHeight - 4;
            if (top <= 0) current = s;
            else break;
        }
        buttons.forEach(b => b.classList.remove('active'));
        if (current) current.btn.classList.add('active');
    };

    // Throttle scroll handler with rAF
    let ticking = false;
    const onScroll = () => {
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

    couponDiv.innerHTML = `
        <div class="coupon-header">
            <div class="coupon-merchant">${coupon.cardName}</div>
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">回饋率</div>
                <div class="detail-value">${coupon.actualRate}%</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋金額</div>
                <div class="detail-value cashback-amount">NT$${coupon.potentialCashback.toLocaleString()}</div>
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
                <div class="detail-value ${result.cashbackAmount > 0 ? 'cashback-amount' : 'no-cashback-text'}">${cashbackText}</div>
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

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Authentication setup
function setupAuthentication() {
    // Wait for Firebase to load
    const checkFirebaseReady = () => {
        if (typeof window.firebaseAuth !== 'undefined' && typeof window.db !== 'undefined') {
            auth = window.firebaseAuth;
            db = window.db;
            initializeAuthListeners();
        } else {
            setTimeout(checkFirebaseReady, 100);
        }
    };
    checkFirebaseReady();
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

function initializeAuthListeners() {
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

            // Load user's selected cards and payments using unified data
            await loadCardsInComparison(userData);
            await loadMyOwnedCards(userData);
            await loadUserPayments(userData);
            await maybeMergeGuestPayments();
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

            // Show product introduction section and hide tool sections when not logged in
            if (productIntroSection) {
                productIntroSection.style.display = 'block';
            }
            hideToolSections();

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
    });
    
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

// Load user's cards-in-comparison from Firestore (with localStorage fallback)
// Reads new field `cardsInComparison` first; falls back to legacy `selectedCards` for migration.
// Guests load from localStorage `cardsInComparison_guest`; default is all cards.
// Accepts optional userData parameter to avoid redundant Firestore calls.
async function loadCardsInComparison(userData = null) {
    if (!currentUser) {
        // Guest: load from localStorage; default to all cards if nothing saved
        try {
            const saved = localStorage.getItem('cardsInComparison_guest');
            if (saved) {
                cardsInComparison = new Set(JSON.parse(saved));
                console.log('📦 Loaded cards-in-comparison from guest localStorage:', Array.from(cardsInComparison));
            } else {
                cardsInComparison = new Set(cardsData.cards.map(card => card.id));
                console.log('🆕 Guest with no saved comparison, defaulting to all cards');
            }
        } catch (e) {
            cardsInComparison = new Set(cardsData.cards.map(card => card.id));
        }
        return;
    }

    const newKey = `cardsInComparison_${currentUser.uid}`;
    const legacyKey = `selectedCards_${currentUser.uid}`;

    try {
        // Use provided userData if available (from unified load)
        if (userData) {
            const cloudCards = userData.cardsInComparison || userData.selectedCards;
            if (cloudCards) {
                cardsInComparison = new Set(cloudCards);
                console.log('✅ Using cards-in-comparison from unified data load:', Array.from(cardsInComparison));
                localStorage.setItem(newKey, JSON.stringify(cloudCards));
                return;
            }
        }

        // Fallback: Try to load from Firestore if userData not provided
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                const cloudCards = data.cardsInComparison || data.selectedCards;
                if (cloudCards) {
                    cardsInComparison = new Set(cloudCards);
                    console.log('✅ Loaded cards-in-comparison from Firestore:', Array.from(cardsInComparison));
                    localStorage.setItem(newKey, JSON.stringify(cloudCards));
                    return;
                }
            }
        }

        // Fallback to localStorage (try new key first, then legacy)
        const savedCards = localStorage.getItem(newKey) || localStorage.getItem(legacyKey);

        if (savedCards) {
            cardsInComparison = new Set(JSON.parse(savedCards));
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

    // After loading, check if guest data exists from before login
    await maybeMergeGuestCardsInComparison();
}

// On login, if guest had locally-saved cards-in-comparison data, prompt to merge.
async function maybeMergeGuestCardsInComparison() {
    const guestKey = 'cardsInComparison_guest';
    const guestData = localStorage.getItem(guestKey);
    if (!guestData) return;

    try {
        const guestCards = JSON.parse(guestData);
        if (!Array.isArray(guestCards) || guestCards.length === 0) {
            localStorage.removeItem(guestKey);
            return;
        }

        const shouldMerge = confirm('偵測到本地的『加入比較的卡片』設定，要合併到此賬號嗎？');
        if (shouldMerge) {
            guestCards.forEach(id => cardsInComparison.add(id));
            await saveCardsInComparison();
            console.log('🔀 Merged guest cards-in-comparison into account:', guestCards);
        }
        localStorage.removeItem(guestKey);
    } catch (e) {
        console.error('Error merging guest cards-in-comparison:', e);
        localStorage.removeItem(guestKey);
    }
}

// On login, if guest had locally-saved payments, prompt to merge.
async function maybeMergeGuestPayments() {
    const guestKey = 'selectedPayments_guest';
    const guestData = localStorage.getItem(guestKey);
    if (!guestData) return;

    try {
        const guestPayments = JSON.parse(guestData);
        if (!Array.isArray(guestPayments) || guestPayments.length === 0) {
            localStorage.removeItem(guestKey);
            return;
        }

        const shouldMerge = confirm('偵測到本地的『行動支付』設定，要合併到此賬號嗎？');
        if (shouldMerge) {
            guestPayments.forEach(id => userSelectedPayments.add(id));
            await saveUserPayments();
            console.log('🔀 Merged guest payments into account:', guestPayments);
        }
        localStorage.removeItem(guestKey);
    } catch (e) {
        console.error('Error merging guest payments:', e);
        localStorage.removeItem(guestKey);
    }
}

// Load my-owned-cards from Firestore (logged in) or localStorage (guest).
// Default for everyone is empty Set.
async function loadMyOwnedCards(userData = null) {
    if (!currentUser) {
        // Guest: load from localStorage
        try {
            const saved = localStorage.getItem('myOwnedCards_guest');
            myOwnedCards = saved ? new Set(JSON.parse(saved)) : new Set();
            console.log('📦 Loaded myOwnedCards from guest localStorage:', Array.from(myOwnedCards));
        } catch (e) {
            myOwnedCards = new Set();
        }
        return;
    }

    const userKey = `myOwnedCards_${currentUser.uid}`;
    try {
        let cloudOwned = null;
        if (userData && Array.isArray(userData.myOwnedCards)) {
            cloudOwned = userData.myOwnedCards;
        } else if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists() && Array.isArray(docSnap.data().myOwnedCards)) {
                cloudOwned = docSnap.data().myOwnedCards;
            }
        }

        myOwnedCards = new Set(cloudOwned || []);
        console.log('✅ Loaded myOwnedCards from Firestore:', Array.from(myOwnedCards));
        localStorage.setItem(userKey, JSON.stringify(Array.from(myOwnedCards)));

        // After loading, check if guest data exists from before login
        await maybeMergeGuestMyOwnedCards();
    } catch (error) {
        console.error('❌ Error loading myOwnedCards:', error);
        // Fallback to user-specific localStorage
        try {
            const saved = localStorage.getItem(userKey);
            myOwnedCards = saved ? new Set(JSON.parse(saved)) : new Set();
        } catch (e) {
            myOwnedCards = new Set();
        }
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

// On login, if guest had locally-saved myOwnedCards data, prompt to merge into account.
async function maybeMergeGuestMyOwnedCards() {
    const guestKey = 'myOwnedCards_guest';
    const guestData = localStorage.getItem(guestKey);
    if (!guestData) return;

    try {
        const guestCards = JSON.parse(guestData);
        if (!Array.isArray(guestCards) || guestCards.length === 0) {
            localStorage.removeItem(guestKey);
            return;
        }

        const shouldMerge = confirm('偵測到本地的『我的信用卡』資料，要合併到此賬號嗎？');
        if (shouldMerge) {
            guestCards.forEach(id => myOwnedCards.add(id));
            await saveMyOwnedCards();
            console.log('🔀 Merged guest myOwnedCards into account:', guestCards);
        }
        // Remove guest data either way (don't ask again)
        localStorage.removeItem(guestKey);
    } catch (e) {
        console.error('Error merging guest myOwnedCards:', e);
        localStorage.removeItem(guestKey);
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

    const actions = document.getElementById('owned-overview-actions');

    const ownedCards = [...cardsData.cards]
        .filter(card => myOwnedCards.has(card.id))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (ownedCards.length === 0) {
        // Empty state has its own CTA; hide the bottom manage button to avoid duplication
        if (actions) actions.style.display = 'none';
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

    if (actions) actions.style.display = 'flex';

    ownedCards.forEach(card => {
        const tile = document.createElement('div');
        tile.className = 'owned-overview-card';
        tile.setAttribute('role', 'button');
        tile.setAttribute('tabindex', '0');
        tile.title = '查看詳情';
        tile.innerHTML = `
            <img class="owned-overview-card-image" alt="" src="assets/images/cards/${card.id}.png" onerror="this.style.display='none'">
            <span class="owned-overview-card-name">${card.name}</span>
        `;
        tile.addEventListener('click', () => showCardDetail(card.id));
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showCardDetail(card.id);
            }
        });
        container.appendChild(tile);
    });
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
basicContent += `<div class="cashback-rate">國內一般回饋: <span class="cashback-rate-num">${card.basicCashback}%</span></div>`;
if (card.basicConditions) {
    basicContent += `<div class="cashback-condition">條件: ${card.basicConditions}</div>`;
}
basicContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
basicContent += `</div>`; // ← 這裡關閉第一個區塊

if (card.overseasCashback) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外一般回饋: <span class="cashback-rate-num">${card.overseasCashback}%</span></div>`;
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
    let savedLevel = await getCardLevel(card.id, defaultLevel);
    let levelData = card.levelSettings[savedLevel];

    // 🔥 新增：如果 levelData 不存在，使用 defaultLevel
    if (!levelData) {
        console.warn(`⚠️ ${card.name}: 保存的級別 "${savedLevel}" 不存在，使用預設級別 "${defaultLevel}"`);
        savedLevel = defaultLevel;
        levelData = card.levelSettings[savedLevel];
        // 更新保存的級別
        await saveCardLevel(card.id, savedLevel);
    }

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
    basicContent += `<div class="cashback-rate">國內加碼回饋: <span class="cashback-rate-num">+${domesticBonusRate}%</span></div>`;
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
    basicContent += `<div class="cashback-rate">海外加碼回饋: <span class="cashback-rate-num">+${overseasBonusRate}%</span></div>`;
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
        const savedLevel = await getCardLevel(card.id, defaultLevel);

        // Generate level selector HTML with note (通用支援)
        const savedLevelData = card.levelSettings[savedLevel];
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
                <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; padding: 10px 14px; margin-bottom: 16px;">
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
                    <div style="border-top: 1px solid #e5e7eb; margin-top: 8px; padding-top: 8px;">
                        ${birthdayRow}
                    </div>
                    <div style="border-top: 1px solid #e5e7eb; margin-top: 8px; padding-top: 8px;">
                        <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 0; cursor: pointer; user-select: none;">
                            <input type="checkbox" id="children-eligible-checkbox"
                                ${isChildrenEligible ? 'checked' : ''}
                                style="width: 14px; height: 14px; cursor: pointer; accent-color: #3b82f6;">
                            <span style="font-weight: 600; font-size: 14px; color: #374151;">我符合「童樂匯」權益</span>
                        </label>
                        <div style="margin-top: 1px; padding-left: 20px; font-size: 11px; color: #9ca3af;">
                            勾選後才會在比較結果納入「童樂匯」方案的活動
                        </div>
                    </div>
                    <div style="border-top: 1px solid #e5e7eb; margin-top: 8px; padding-top: 8px;">
                        <label for="cube-issuer-select" style="font-weight: 600; margin-right: 6px; margin-bottom: 0; font-size: 14px; color: #374151;">發卡組織：</label>
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
        const savedLevel = await getCardLevel(card.id, levelNames[0]);
        const levelData = card.levelSettings[savedLevel];

        // First, display any cashbackRates if they exist (like DBS Eco's 10% cashback)
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            const filteredRates = card.cashbackRates.filter(rate => !rate.hideInDisplay);

            // 按 rate 值、cap 值和狀態分組（相同 rate 和 cap 的活動合併顯示）
            const activeRateGroups = new Map();
            const upcomingRateGroups = new Map();

            for (const rate of filteredRates) {
                const parsedRate = await parseCashbackRate(rate.rate, card, levelData);
                const parsedCap = parseCashbackCap(rate.cap, card, levelData);
                const rateStatus = getRateStatus(rate.periodStart, rate.periodEnd);
                const groupKey = `${parsedRate}-${parsedCap || 'nocap'}`;

                // 根據狀態選擇分組
                const targetGroups = (rateStatus === 'active' || rateStatus === 'always') ? activeRateGroups : upcomingRateGroups;

                if (!targetGroups.has(groupKey)) {
                    targetGroups.set(groupKey, {
                        parsedRate,
                        parsedCap,
                        items: [],
                        conditions: [],
                        period: rate.period,
                        periodStart: rate.periodStart,
                        periodEnd: rate.periodEnd,
                        status: rateStatus
                    });
                }

                const group = targetGroups.get(groupKey);
                if (rate.items) {
                    group.items.push(...rate.items);
                }
                if (rate.conditions && rate.category) {
                    group.conditions.push({
                        category: rate.category,
                        conditions: rate.conditions
                    });
                }
            }

            // 按 parsedRate 排序
            const sortedActiveGroups = Array.from(activeRateGroups.entries())
                .sort((a, b) => b[1].parsedRate - a[1].parsedRate);
            const sortedUpcomingGroups = Array.from(upcomingRateGroups.entries())
                .sort((a, b) => b[1].parsedRate - a[1].parsedRate);

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups1 = sortedUpcomingGroups;
            window._currentCard = card;
            window._currentLevelData1 = levelData;

            // Only display active groups in special cashback section
            for (const [groupKey, group] of sortedActiveGroups) {
                specialContent += `<div class="cashback-detail-item">`;

                // 顯示回饋率
                // Add ending soon badge if applicable
                let endingSoonBadgeLevel1 = '';
                if (group.periodEnd && isEndingSoon(group.periodEnd, 10)) {
                    const daysUntil = getDaysUntilEnd(group.periodEnd);
                    const daysText = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : `${daysUntil}天後`;
                    endingSoonBadgeLevel1 = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
                }

                specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${group.parsedRate}%</span> 回饋${endingSoonBadgeLevel1}</div>`;

                if (group.parsedCap) {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(group.parsedCap).toLocaleString()}</div>`;
                } else {
                    specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
                }

                if (group.period) {
                    specialContent += `<div class="cashback-condition">活動期間: ${group.period}</div>`;
                }

                // 顯示所有通路
                if (group.items.length > 0) {
                    // 去重
                    const uniqueItems = [...new Set(group.items)];
                    const merchantsId = `merchants-${card.id}-group-${groupKey}`;
                    const showAllId = `show-all-${card.id}-group-${groupKey}`;

                    if (uniqueItems.length <= 5) {
                        const merchantsList = uniqueItems.join('、');
                        specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = uniqueItems.slice(0, 5).join('、');
                        const fullList = uniqueItems.join('、');

                        specialContent += `<div class="cashback-merchants">`;
                        specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${uniqueItems.length}個</button>`;
                        specialContent += `</div>`;
                    }
                }

                // 按 category 顯示各通路條件
                if (group.conditions.length > 0) {
                    // 玉山 Uni Card 使用可展開的詳細條件，其他卡片直接顯示
                    if (card.id === 'yushan-unicard') {
                        const conditionsId = `conditions-${card.id}-group-${groupKey}`;
                        const showConditionsId = `show-conditions-${card.id}-group-${groupKey}`;

                        // 生成條件內容
                        let conditionsContent = '';
                        for (const cond of group.conditions) {
                            conditionsContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${getCategoryDisplayName(cond.category)}：${cond.conditions}</div>`;
                        }

                        specialContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                        specialContent += `<button class="show-more-btn" id="${showConditionsId}" onclick="toggleConditions('${conditionsId}', '${showConditionsId}')" style="padding: 4px 12px; font-size: 13px;">▼ 查看各通路詳細條件</button>`;
                        specialContent += `<div id="${conditionsId}" style="display: none; margin-top: 8px;">`;
                        specialContent += conditionsContent;
                        specialContent += `</div>`;
                        specialContent += `</div>`;
                    } else {
                        // 其他卡片直接顯示條件
                        specialContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                        specialContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 各通路條件：</div>`;

                        for (const cond of group.conditions) {
                            specialContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${getCategoryDisplayName(cond.category)}：${cond.conditions}</div>`;
                        }

                        specialContent += `</div>`;
                    }
                }

                specialContent += `</div>`;
            }
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
            specialContent += `<div class="cashback-condition">條件: ${levelData.condition}</div>`;
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
        const savedLevel = await getCardLevel(card.id, levelNames[0]);
        const levelData = card.levelSettings[savedLevel];

        // Check if card also has cashbackRates (like DBS Eco card)
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            const filteredRates = card.cashbackRates.filter(rate => !rate.hideInDisplay);

            // 按 rate 值、cap 值和狀態分組（相同 rate 和 cap 的活動合併顯示）
            const activeRateGroups = new Map();
            const upcomingRateGroups = new Map();

            for (const rate of filteredRates) {
                const parsedRate = await parseCashbackRate(rate.rate, card, levelData);
                const parsedCap = parseCashbackCap(rate.cap, card, levelData) || levelData.cap;
                const rateStatus = getRateStatus(rate.periodStart, rate.periodEnd);
                const groupKey = `${parsedRate}-${parsedCap || 'nocap'}`;

                // 根據狀態選擇分組
                const targetGroups = (rateStatus === 'active' || rateStatus === 'always') ? activeRateGroups : upcomingRateGroups;

                if (!targetGroups.has(groupKey)) {
                    targetGroups.set(groupKey, {
                        parsedRate,
                        parsedCap,
                        items: [],
                        conditions: [],
                        period: rate.period,
                        periodStart: rate.periodStart,
                        periodEnd: rate.periodEnd,
                        status: rateStatus
                    });
                }

                const group = targetGroups.get(groupKey);
                if (rate.items) {
                    group.items.push(...rate.items);
                }
                if (rate.conditions && rate.category) {
                    group.conditions.push({
                        category: rate.category,
                        conditions: rate.conditions
                    });
                }
            }

            // 按 parsedRate 排序
            const sortedActiveGroups = Array.from(activeRateGroups.entries())
                .sort((a, b) => b[1].parsedRate - a[1].parsedRate);
            const sortedUpcomingGroups = Array.from(upcomingRateGroups.entries())
                .sort((a, b) => b[1].parsedRate - a[1].parsedRate);

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups2 = sortedUpcomingGroups;
            window._currentCard = card;
            window._currentLevelData2 = levelData;

            // Only display active groups in special cashback section
            for (const [groupKey, group] of sortedActiveGroups) {
                specialContent += `<div class="cashback-detail-item">`;

                // 顯示回饋率
                // Add ending soon badge if applicable
                let endingSoonBadgeLevel = '';
                if (group.periodEnd && isEndingSoon(group.periodEnd, 10)) {
                    const daysUntil = getDaysUntilEnd(group.periodEnd);
                    const daysText = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : `${daysUntil}天後`;
                    endingSoonBadgeLevel = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
                }

                specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${group.parsedRate}%</span> 回饋${endingSoonBadgeLevel}</div>`;

                if (group.parsedCap) {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(group.parsedCap).toLocaleString()}</div>`;
                } else {
                    specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
                }

                if (group.period) {
                    specialContent += `<div class="cashback-condition">活動期間: ${group.period}</div>`;
                }

                // 顯示所有通路
                if (group.items.length > 0) {
                    // 去重
                    const uniqueItems = [...new Set(group.items)];
                    const merchantsId = `merchants-${card.id}-group-${groupKey}`;
                    const showAllId = `show-all-${card.id}-group-${groupKey}`;

                    if (uniqueItems.length <= 5) {
                        const merchantsList = uniqueItems.join('、');
                        specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = uniqueItems.slice(0, 5).join('、');
                        const fullList = uniqueItems.join('、');

                        specialContent += `<div class="cashback-merchants">`;
                        specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${uniqueItems.length}個</button>`;
                        specialContent += `</div>`;
                    }
                }

                // 按 category 顯示各通路條件
                if (group.conditions.length > 0) {
                    // 玉山 Uni Card 使用可展開的詳細條件，其他卡片直接顯示
                    if (card.id === 'yushan-unicard') {
                        const conditionsId = `conditions-${card.id}-group-${groupKey}`;
                        const showConditionsId = `show-conditions-${card.id}-group-${groupKey}`;

                        // 生成條件內容
                        let conditionsContent = '';
                        for (const cond of group.conditions) {
                            conditionsContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${getCategoryDisplayName(cond.category)}：${cond.conditions}</div>`;
                        }

                        specialContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                        specialContent += `<button class="show-more-btn" id="${showConditionsId}" onclick="toggleConditions('${conditionsId}', '${showConditionsId}')" style="padding: 4px 12px; font-size: 13px;">▼ 查看各通路詳細條件</button>`;
                        specialContent += `<div id="${conditionsId}" style="display: none; margin-top: 8px;">`;
                        specialContent += conditionsContent;
                        specialContent += `</div>`;
                        specialContent += `</div>`;
                    } else {
                        // 其他卡片直接顯示條件
                        specialContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                        specialContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 各通路條件：</div>`;

                        for (const cond of group.conditions) {
                            specialContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${getCategoryDisplayName(cond.category)}：${cond.conditions}</div>`;
                        }

                        specialContent += `</div>`;
                    }
                }

                specialContent += `</div>`;
            }

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

        // Sort active rates by percentage in descending order
        const sortedRates = activeRates.sort((a, b) => {
            // 解析 rate（hasLevels=false 的卡片，levelData 為 null）
            const aRate = parseCashbackRateSync(a.rate, null);
            const bRate = parseCashbackRateSync(b.rate, null);
            return bRate - aRate;
        });

        // Store upcoming rates for display in separate section
        if (upcomingRates.length > 0) {
            window._currentUpcomingGroups3 = await Promise.all(upcomingRates.map(async (rate) => {
                const parsedRate = await parseCashbackRate(rate.rate, card, null);
                const parsedCap = parseCashbackCap(rate.cap, card, null);
                return {
                    parsedRate,
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

            specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${parsedRate}%</span> 回饋${categoryLabel}${endingSoonBadge}</div>`;

            // 解析 cap 值（支援 {cap}，hasLevels=false 的卡片通常只有數字）
            const parsedCap = parseCashbackCap(rate.cap, card, null);
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
                specialContent += `<div class="cashback-condition">條件: ${rate.conditions}</div>`;
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

            // 條件顯示（統一格式）
            if (coupon.conditions) {
                couponContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                couponContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 條件：</div>`;
                couponContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${coupon.conditions}</div>`;
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
    
    // 設置結帳日期功能
    setupBillingDates(card.id);
    
    // Show modal
    modal.style.display = 'flex';
    disableBodyScroll();

    // 滾動到最上面（不記憶上一個 modal 的捲動位置）
    // .modal-content 才是真正的捲動容器（overflow-y: auto; max-height: 80vh）
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

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
    const savedLevel = await getCardLevel(card.id, defaultLevel);
    const levelSettings = card.levelSettings[savedLevel];

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
            content += `<div class="cashback-condition">條件: ${childrenRate10.conditions}</div>`;
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
            content += `<div class="cashback-condition">條件: ${childrenRate5.conditions}</div>`;
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
                content += `<div class="cashback-condition">條件: ${mergedRate.conditions}</div>`;
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
        const localData = localStorage.getItem('spendingMappings');
        userSpendingMappings = localData ? JSON.parse(localData) : [];
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
        const localData = localStorage.getItem(`spendingMappings_${currentUser.uid}`);
        userSpendingMappings = localData ? JSON.parse(localData) : [];
        console.log('📦 [配卡] 從本地快取載入 (fallback):', userSpendingMappings.length, '筆');
        return userSpendingMappings;
    } catch (error) {
        console.error('❌ [配卡] 讀取失敗，使用本地快取:', error);
        const localData = localStorage.getItem(`spendingMappings_${currentUser.uid}`);
        userSpendingMappings = localData ? JSON.parse(localData) : [];
        console.log('📋 [配卡] 本地快取載入:', userSpendingMappings.length, '筆');
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

// 結帳日期相關功能

// 讀取結帳日期
async function loadBillingDates(cardId) {
    const defaultDates = { billingDate: '', statementDate: '' };

    if (!currentUser) {
        const localKey = `billingDates_local_${cardId}`;
        const saved = localStorage.getItem(localKey);
        return saved ? JSON.parse(saved) : defaultDates;
    }

    try {
        // 從 Firestore 的 users collection 讀取
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().billingDates && docSnap.data().billingDates[cardId]) {
                const dates = docSnap.data().billingDates[cardId];
                // 更新本地快取
                const localKey = `billingDates_${currentUser.uid}_${cardId}`;
                localStorage.setItem(localKey, JSON.stringify(dates));
                console.log('✅ [結帳日期] 從 Firestore 讀取:', cardId, dates);
                return dates;
            }
        }

        // Fallback to localStorage
        const localKey = `billingDates_${currentUser.uid}_${cardId}`;
        const saved = localStorage.getItem(localKey);
        const result = saved ? JSON.parse(saved) : defaultDates;
        console.log('📦 [結帳日期] 從本地讀取 (fallback):', cardId, result);
        return result;
    } catch (error) {
        console.error('❌ 讀取結帳日期失敗:', error);
        const localKey = `billingDates_${currentUser.uid}_${cardId}`;
        const saved = localStorage.getItem(localKey);
        return saved ? JSON.parse(saved) : defaultDates;
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

async function getCardLevelUncached(cardId, defaultLevel) {
    // If user not logged in, use localStorage
    if (!auth || !auth.currentUser) {
        return localStorage.getItem(`cardLevel-${cardId}`) || defaultLevel;
    }

    try {
        const docRef = window.doc ? window.doc(db, 'cardSettings', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');

        const docSnap = await window.getDoc(docRef);

        if (docSnap.exists()) {
            // Return level from Firestore
            return docSnap.data().level || defaultLevel;
        } else {
            // Check localStorage for migration
            const localLevel = localStorage.getItem(`cardLevel-${cardId}`);
            if (localLevel && localLevel !== defaultLevel) {
                // Migrate to Firestore
                console.log(`Migrating level for ${cardId} from localStorage to Firestore: ${localLevel}`);
                await saveCardLevel(cardId, localLevel);
                return localLevel;
            }
            return defaultLevel;
        }
    } catch (error) {
        console.log('Failed to load card level from Firestore:', error);
        // Fallback to localStorage
        return localStorage.getItem(`cardLevel-${cardId}`) || defaultLevel;
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

    // Always save to localStorage as backup
    localStorage.setItem(`cardLevel-${cardId}`, level);

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
        try {
            const saved = localStorage.getItem('selectedPayments_guest');
            if (saved) {
                userSelectedPayments = new Set(JSON.parse(saved));
                console.log('📦 Loaded user payments from guest localStorage:', Array.from(userSelectedPayments));
            } else {
                userSelectedPayments = new Set();
                console.log('🆕 Guest first time, no payments selected');
            }
        } catch (e) {
            userSelectedPayments = new Set();
        }
        return;
    }

    try {
        // Use provided userData if available (from unified load)
        if (userData && userData.selectedPayments) {
            const cloudPayments = userData.selectedPayments;
            userSelectedPayments = new Set(cloudPayments);
            console.log('✅ Using user payments from unified data load:', Array.from(userSelectedPayments));

            // Sync to localStorage for offline use
            const storageKey = `selectedPayments_${currentUser.uid}`;
            localStorage.setItem(storageKey, JSON.stringify(cloudPayments));
            return;
        }

        // Fallback: Try to load from Firestore if userData not provided
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().selectedPayments) {
                const cloudPayments = docSnap.data().selectedPayments;
                userSelectedPayments = new Set(cloudPayments);
                console.log('✅ Loaded user payments from Firestore:', Array.from(userSelectedPayments));

                // Sync to localStorage for offline use
                const storageKey = `selectedPayments_${currentUser.uid}`;
                localStorage.setItem(storageKey, JSON.stringify(cloudPayments));
                return;
            }
        }

        // Fallback to localStorage if Firestore fails or no data
        const storageKey = `selectedPayments_${currentUser.uid}`;
        const savedPayments = localStorage.getItem(storageKey);

        if (savedPayments) {
            userSelectedPayments = new Set(JSON.parse(savedPayments));
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
                    selectedPayments: paymentsArray
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
            alert('請先登入才能回報問題 🔐\n\n登入後可以幫助我們更好地追蹤和回覆您的回報。');
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
// Review System (Star Rating)
// ============================================

let selectedRating = 0;

function initReviewSystem() {
    const openReviewBtn = document.getElementById('open-review-btn');
    const starsModal = document.querySelectorAll('.star-modal');
    const starRatingModal = document.getElementById('star-rating-modal');
    const reviewFeedback = document.getElementById('review-feedback');
    const reviewModal = document.getElementById('review-modal');
    const reviewModalTitle = document.getElementById('review-modal-title');
    const reviewCommentSection = document.getElementById('review-comment-section');
    const reviewComment = document.getElementById('review-comment');
    const reviewCharCount = document.getElementById('review-char-count');
    const submitReviewBtn = document.getElementById('submit-review-btn');
    const skipReviewBtn = document.getElementById('skip-review-btn');
    const closeReviewModal = document.getElementById('close-review-modal');
    const reviewError = document.getElementById('review-error');

    // Check if user has already reviewed
    const hasReviewed = localStorage.getItem('hasReviewed');
    if (hasReviewed) {
        if (openReviewBtn) {
            openReviewBtn.style.opacity = '0.5';
            openReviewBtn.style.pointerEvents = 'none';
        }
        return;
    }

    // Open review modal button
    if (openReviewBtn) {
        openReviewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openReviewModalInitial();
        });
    }

    // Star hover effect in modal
    starsModal.forEach(star => {
        star.addEventListener('mouseenter', () => {
            const rating = parseInt(star.dataset.rating);
            highlightModalStars(rating);
        });
    });

    if (starRatingModal) {
        starRatingModal.addEventListener('mouseleave', () => {
            highlightModalStars(selectedRating);
        });
    }

    // Star click handler in modal
    starsModal.forEach(star => {
        star.addEventListener('click', () => {
            const rating = parseInt(star.dataset.rating);
            selectedRating = rating;
            highlightModalStars(rating);
        });
    });

    // Character counter
    if (reviewComment) {
        reviewComment.addEventListener('input', () => {
            reviewCharCount.textContent = reviewComment.value.length;
        });
    }

    // Submit review
    if (submitReviewBtn) {
        submitReviewBtn.addEventListener('click', async () => {
            await submitReview();
        });
    }

    // Skip review - close modal without submitting
    if (skipReviewBtn) {
        skipReviewBtn.addEventListener('click', () => {
            closeReviewModalHandler();
        });
    }

    // Close modal
    if (closeReviewModal) {
        closeReviewModal.addEventListener('click', closeReviewModalHandler);
    }

    // Close on backdrop click
    if (reviewModal) {
        reviewModal.addEventListener('click', (e) => {
            if (e.target === reviewModal) {
                closeReviewModalHandler();
            }
        });
    }
}

function highlightModalStars(rating) {
    const stars = document.querySelectorAll('.star-modal');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.classList.add('hover');
            star.classList.add('selected');
        } else {
            star.classList.remove('hover');
            star.classList.remove('selected');
        }
    });
}

function openReviewModalInitial() {
    const reviewModal = document.getElementById('review-modal');
    const reviewModalTitle = document.getElementById('review-modal-title');
    const reviewComment = document.getElementById('review-comment');
    const reviewCharCount = document.getElementById('review-char-count');
    const reviewError = document.getElementById('review-error');

    // Reset state
    selectedRating = 0;
    highlightModalStars(0);
    reviewModalTitle.textContent = '請為我們評分';
    reviewComment.value = '';
    reviewCharCount.textContent = '0';
    reviewError.style.display = 'none';

    // Show modal
    reviewModal.style.display = 'flex';
    disableBodyScroll();
}

function closeReviewModalHandler() {
    const reviewModal = document.getElementById('review-modal');
    reviewModal.style.display = 'none';
    enableBodyScroll();
    // Reset selected rating if user closes without submitting
    if (!localStorage.getItem('hasReviewed')) {
        selectedRating = 0;
        highlightModalStars(0);
    }
}

async function submitReview() {
    const reviewComment = document.getElementById('review-comment');
    const submitReviewBtn = document.getElementById('submit-review-btn');
    const reviewError = document.getElementById('review-error');

    const comment = reviewComment.value.trim();

    // Validate rating
    if (!selectedRating || selectedRating === 0) {
        reviewError.textContent = '請先選擇星星評分';
        reviewError.style.display = 'block';
        return;
    }

    // Disable button
    submitReviewBtn.disabled = true;
    submitReviewBtn.textContent = '送出中...';
    reviewError.style.display = 'none';

    try {
        // Check if Firebase is initialized
        if (!window.db || !window.collection || !window.addDoc || !window.serverTimestamp) {
            throw new Error('Firebase not initialized');
        }

        const reviewData = {
            rating: selectedRating,
            comment: comment || null,
            timestamp: window.serverTimestamp(),
            userAgent: navigator.userAgent,
            screenSize: `${window.screen.width}x${window.screen.height}`
        };

        // Try to add user ID if logged in
        if (window.firebaseAuth && window.firebaseAuth.currentUser) {
            reviewData.userId = window.firebaseAuth.currentUser.uid;
            reviewData.userEmail = window.firebaseAuth.currentUser.email;
        }

        // Save to Firebase
        await window.addDoc(window.collection(window.db, 'reviews'), reviewData);

        // Mark as reviewed
        localStorage.setItem('hasReviewed', 'true');
        localStorage.setItem('userRating', selectedRating);

        // Show success message in modal
        showReviewSuccessInModal();

        console.log('Review submitted successfully:', reviewData);
    } catch (error) {
        console.error('Error submitting review:', error);
        console.error('Error details:', error.message, error.code);

        // Better error messages
        let errorMessage = '送出失敗，請稍後再試';
        if (error.message === 'Firebase not initialized') {
            errorMessage = '系統初始化中，請稍後再試';
        } else if (error.code === 'permission-denied') {
            errorMessage = '權限不足，請重新整理頁面後再試';
        } else if (error.code === 'unavailable') {
            errorMessage = '網路連線問題，請檢查網路後再試';
        }

        reviewError.textContent = errorMessage;
        reviewError.style.display = 'block';
    } finally {
        submitReviewBtn.disabled = false;
        submitReviewBtn.textContent = '送出評價';
    }
}

function showReviewFeedback(message) {
    const reviewFeedback = document.getElementById('review-feedback');
    reviewFeedback.textContent = message;
    reviewFeedback.style.display = 'block';
}

function showReviewSuccessInModal() {
    const reviewModalTitle = document.getElementById('review-modal-title');
    const starRatingModal = document.getElementById('star-rating-modal');
    const reviewCommentSection = document.getElementById('review-comment-section');
    const reviewError = document.getElementById('review-error');

    // Hide stars and comment section
    starRatingModal.style.display = 'none';
    reviewCommentSection.style.display = 'none';
    reviewError.style.display = 'none';

    // Change title to thank you message
    reviewModalTitle.textContent = '感謝您的評價！';
    reviewModalTitle.style.textAlign = 'center';
    reviewModalTitle.style.color = '#10b981';
    reviewModalTitle.style.fontSize = '24px';
    reviewModalTitle.style.padding = '40px 20px';

    // Auto close modal after 2 seconds
    setTimeout(() => {
        document.getElementById('review-modal').style.display = 'none';
        enableBodyScroll();

        // Disable review button
        disableReviewButton();

        // Reset modal for next time (if needed)
        reviewModalTitle.style.textAlign = '';
        reviewModalTitle.style.color = '';
        reviewModalTitle.style.fontSize = '';
        reviewModalTitle.style.padding = '';
        starRatingModal.style.display = '';
        reviewCommentSection.style.display = '';
    }, 2000);
}

function disableReviewButton() {
    const openReviewBtn = document.getElementById('open-review-btn');
    if (openReviewBtn) {
        openReviewBtn.style.opacity = '0.5';
        openReviewBtn.style.pointerEvents = 'none';
    }
}

// Initialize review system when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initReviewSystem();
});

// ============================================
// GA4 Button Click Tracking
// ============================================
document.addEventListener('click', function(e) {
    if (!window.logEvent || !window.firebaseAnalytics) return;
    const btn = e.target.closest(
        '.spotlight-compare-btn, .spotlight-info-btn, .card-apply-cta-btn, .promo-apply-cta-btn'
    );
    if (!btn) return;

    let buttonType;
    if (btn.classList.contains('spotlight-compare-btn'))        buttonType = 'spotlight_compare';
    else if (btn.classList.contains('spotlight-info-btn'))      buttonType = 'spotlight_info';
    else if (btn.classList.contains('spotlight-apply-cta-btn')) buttonType = 'spotlight_apply';
    else if (btn.classList.contains('card-apply-cta-btn'))      buttonType = 'card_apply';
    else                                                         buttonType = 'search_result_apply';

    window.logEvent(window.firebaseAnalytics, 'button_click', {
        button_type: buttonType,
        card_id:     btn.dataset.cardId   || '',
        card_name:   btn.dataset.cardName || '',
        merchant:    btn.dataset.merchant || '',
    });
});









