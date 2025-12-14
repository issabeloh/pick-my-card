// Global variables
let currentUser = null;
let userSelectedCards = new Set();
let userSelectedPayments = new Set();
let userSpendingMappings = []; // 用戶的消費配卡表
let auth = null;
let db = null;
let cardsData = null;
let paymentsData = null;
let quickSearchOptions = [];

// Body scroll lock utilities
function disableBodyScroll() {
    document.body.style.overflow = 'hidden';
}

function enableBodyScroll() {
    document.body.style.overflow = '';
}

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

// Get the status of a rate based on periodStart and periodEnd (UTC+8 Taiwan time)
// Returns: 'active' | 'upcoming' | 'expired' | 'always'
function getRateStatus(periodStart, periodEnd) {
    // If no date restrictions, rate is always active
    if (!periodStart || !periodEnd) {
        return 'always';
    }

    try {
        // Get current date in UTC+8 (Taiwan time)
        const now = new Date();
        const utcOffset = now.getTimezoneOffset(); // Current UTC offset in minutes
        const taiwanTime = new Date(now.getTime() + (utcOffset + 480) * 60000); // UTC+8 = +480 minutes

        // Get Taiwan date components (YYYY/M/D)
        const currentYear = taiwanTime.getFullYear();
        const currentMonth = taiwanTime.getMonth() + 1;
        const currentDay = taiwanTime.getDate();

        // Parse start and end dates (format: yyyy/m/d)
        const startParts = periodStart.split('/').map(p => parseInt(p));
        const endParts = periodEnd.split('/').map(p => parseInt(p));

        // Convert to comparable numbers (YYYYMMDD format)
        const currentDate = currentYear * 10000 + currentMonth * 100 + currentDay;
        const startDate = startParts[0] * 10000 + startParts[1] * 100 + startParts[2];
        const endDate = endParts[0] * 10000 + endParts[1] * 100 + endParts[2];

        // Check status
        if (currentDate >= startDate && currentDate <= endDate) {
            return 'active';
        } else if (currentDate < startDate) {
            return 'upcoming';
        } else {
            return 'expired';
        }
    } catch (error) {
        console.error('❌ Date parsing error:', error, { periodStart, periodEnd });
        return 'always'; // If error, show the rate (safer to show than hide)
    }
}

// Check if a rate is currently active (for backwards compatibility)
function isRateActive(periodStart, periodEnd) {
    const status = getRateStatus(periodStart, periodEnd);
    return status === 'active' || status === 'always';
}

// Check if upcoming activity starts within N days
function isUpcomingWithinDays(periodStart, days = 30) {
    if (!periodStart) return false;

    try {
        // Get current date in UTC+8 (Taiwan time)
        const now = new Date();
        const utcOffset = now.getTimezoneOffset();
        const taiwanTime = new Date(now.getTime() + (utcOffset + 480) * 60000);

        // Parse start date
        const startParts = periodStart.split('/').map(p => parseInt(p));
        const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);

        // Calculate difference in days
        const diffTime = startDate - taiwanTime;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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
        // Get current date in UTC+8 (Taiwan time)
        const now = new Date();
        const utcOffset = now.getTimezoneOffset();
        const taiwanTime = new Date(now.getTime() + (utcOffset + 480) * 60000);

        // Parse start date
        const startParts = periodStart.split('/').map(p => parseInt(p));
        const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);

        // Calculate difference in days
        const diffTime = startDate - taiwanTime;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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
        // Get current date in UTC+8 (Taiwan time)
        const now = new Date();
        const utcOffset = now.getTimezoneOffset();
        const taiwanTime = new Date(now.getTime() + (utcOffset + 480) * 60000);

        // Parse end date
        const endParts = periodEnd.split('/').map(p => parseInt(p));
        const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);

        // Calculate difference in days
        const diffTime = endDate - taiwanTime;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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
        // Get current date in UTC+8 (Taiwan time)
        const now = new Date();
        const utcOffset = now.getTimezoneOffset();
        const taiwanTime = new Date(now.getTime() + (utcOffset + 480) * 60000);

        // Parse end date
        const endParts = periodEnd.split('/').map(p => parseInt(p));
        const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);

        // Calculate difference in days
        const diffTime = endDate - taiwanTime;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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

    return cardsData;
}

// Load cards data from cards.data (encoded)
async function loadCardsData() {
    try {
        const timestamp = new Date().getTime(); // 防止快取
        const response = await fetch(`cards.data?t=${timestamp}`);
        
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

        // Update card count in subtitle
        const cardCountElement = document.getElementById('card-count');
        if (cardCountElement) {
            cardCountElement.textContent = cardsData.cards.length;
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

// Initialize quick search options from cardsData or user settings
async function initializeQuickSearchOptions() {
    // Get default options from cards.data
    const defaultOptions = getDefaultQuickSearchOptions();

    // Try to load user customized options
    const userOptions = await loadUserQuickSearchOptions();

    if (userOptions && userOptions.length > 0) {
        quickSearchOptions = userOptions;
        console.log('✅ 快捷搜索選項已從用戶設定載入');
        console.log(`⚡ 載入了 ${quickSearchOptions.length} 個自定義快捷選項`);
    } else if (defaultOptions.length > 0) {
        quickSearchOptions = defaultOptions;
        console.log('✅ 快捷搜索選項已從 cards.data 載入');
        console.log(`⚡ 載入了 ${quickSearchOptions.length} 個預設快捷選項`);
    } else {
        console.warn('⚠️ 沒有可用的快捷搜索選項');
        quickSearchOptions = [];
    }
}

// Load user customized quick search options
async function loadUserQuickSearchOptions() {
    try {
        if (currentUser && db) {
            // Load from Firebase
            const userDoc = await window.getDoc(window.doc(db, 'users', currentUser.uid));
            if (userDoc.exists() && userDoc.data().quickSearchOptions) {
                return userDoc.data().quickSearchOptions;
            }
        }

        // Fallback to localStorage
        const stored = localStorage.getItem('userQuickSearchOptions');
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (error) {
        console.error('載入用戶快捷選項時出錯:', error);
    }
    return null;
}

// Save user customized quick search options
async function saveUserQuickSearchOptions(options) {
    try {
        if (currentUser && db) {
            // Save to Firebase
            await window.setDoc(window.doc(db, 'users', currentUser.uid), {
                quickSearchOptions: options
            }, { merge: true });
        }

        // Also save to localStorage as backup
        localStorage.setItem('userQuickSearchOptions', JSON.stringify(options));
        console.log('✅ 用戶快捷選項已保存');
        return true;
    } catch (error) {
        console.error('保存用戶快捷選項時出錯:', error);
        return false;
    }
}

// Render quick search buttons
function renderQuickSearchButtons() {
    const container = document.getElementById('quick-search-container');
    if (!container) return;

    // Clear existing buttons
    container.innerHTML = '';

    // If no options, hide container and arrows
    if (quickSearchOptions.length === 0) {
        container.style.display = 'none';
        hideScrollArrows();
        return;
    }

    container.style.display = 'flex';

    // Create buttons
    quickSearchOptions.forEach(option => {
        const button = document.createElement('button');
        button.className = 'quick-search-btn';
        button.dataset.merchants = option.merchants.join(',');

        // 構建icon HTML（如果有的話）
        const iconHtml = option.icon ? `<span class="icon">${option.icon}</span>` : '';

        button.innerHTML = `
            ${iconHtml}
            <span>${option.displayName}</span>
        `;

        // Add click event
        button.addEventListener('click', () => {
            handleQuickSearch(option);
        });

        container.appendChild(button);
    });

    // Setup scroll arrows
    setupScrollArrows();

    console.log(`✅ 已渲染 ${quickSearchOptions.length} 個快捷搜索按鈕`);
}

// Setup scroll arrows
function setupScrollArrows() {
    const container = document.getElementById('quick-search-container');
    const leftArrow = document.getElementById('scroll-left');
    const rightArrow = document.getElementById('scroll-right');

    if (!container || !leftArrow || !rightArrow) {
        console.warn('⚠️ 箭头元素未找到');
        return;
    }

    // Update arrow states (always visible on desktop, disabled when at edges)
    const updateArrowsVisibility = () => {
        const hasScroll = container.scrollWidth > container.clientWidth;
        const isAtStart = container.scrollLeft <= 0;
        const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;

        // Disable/enable arrows based on scroll position
        leftArrow.disabled = !hasScroll || isAtStart;
        rightArrow.disabled = !hasScroll || isAtEnd;
    };

    // Scroll functions
    const scrollAmount = 200;

    leftArrow.onclick = () => {
        container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    };

    rightArrow.onclick = () => {
        container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    };

    // Update arrows on scroll
    container.addEventListener('scroll', updateArrowsVisibility);

    // Initial update with longer delay
    setTimeout(updateArrowsVisibility, 300);

    // Second check to ensure
    setTimeout(updateArrowsVisibility, 1000);

    // Update on window resize
    window.addEventListener('resize', updateArrowsVisibility);
}

function hideScrollArrows() {
    const leftArrow = document.getElementById('scroll-left');
    const rightArrow = document.getElementById('scroll-right');
    if (leftArrow) leftArrow.style.display = 'none';
    if (rightArrow) rightArrow.style.display = 'none';
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
        showMatchedItem(allMatches);
        currentMatchedItem = allMatches;

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
        console.warn(`   ⚠️ 沒有找到任何匹配項目，請檢查 QuickSearch sheet 的 merchants 欄位\n`);
    }

    merchantInput.focus();
    validateInputs();
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

// DOM elements
const merchantInput = document.getElementById('merchant-input');
const amountInput = document.getElementById('amount-input');
const calculateBtn = document.getElementById('calculate-btn');
const resultsSection = document.getElementById('results-section');
const resultsContainer = document.getElementById('results-container');
const couponResultsSection = document.getElementById('coupon-results-section');
const couponResultsContainer = document.getElementById('coupon-results-container');
const matchedItemDiv = document.getElementById('matched-item');

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    // Load cards data first
    const dataLoaded = await loadCardsData();
    if (!dataLoaded) {
        // If data loading fails, disable the app
        if (calculateBtn) calculateBtn.disabled = true;
        return;
    }

    // Initialize payments data
    initializePaymentsData();

    // Initialize quick search options (async)
    await initializeQuickSearchOptions();

    populateCardChips();
    populatePaymentChips();
    renderQuickSearchButtons();
    setupEventListeners();
    setupAuthentication();

    // Initialize lazy loading for videos and images
    initializeLazyLoading();
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
    const cardsToShow = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    cardsToShow.forEach(card => {
        const chip = document.createElement('div');
        chip.className = 'card-chip chip-clickable';
        chip.textContent = card.name;
        chip.addEventListener('click', () => showCardDetail(card.id));
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
        emptyMsg.style.color = 'rgba(255, 255, 255, 0.7)';
        emptyMsg.style.fontSize = '0.875rem';
        emptyMsg.textContent = '未選取行動支付，請點擊上方齒輪選取';
        paymentChipsContainer.appendChild(emptyMsg);
        return;
    }

    paymentsToShow.forEach(payment => {
        const chip = document.createElement('div');
        chip.className = 'payment-chip';
        chip.textContent = payment.name;
        chip.addEventListener('click', () => showPaymentDetail(payment.id));
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
    
    // Amount input validation
    amountInput.addEventListener('input', validateInputs);
    
    // Calculate button
    calculateBtn.addEventListener('click', () => {
        calculateCashback();
    });
    
    // Enter key support
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !calculateBtn.disabled) {
            calculateCashback();
        }
    });

    // Manage payments button
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
            const pinBtn = e.target.closest('.pin-btn');
            if (pinBtn) {
                e.preventDefault();
                const cardId = pinBtn.dataset.cardId;
                const cardName = pinBtn.dataset.cardName;
                const merchant = pinBtn.dataset.merchant;
                const rate = parseFloat(pinBtn.dataset.rate);

                await togglePin(pinBtn, cardId, cardName, merchant, rate);
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

// Handle merchant input changes
function handleMerchantInput() {
    const input = merchantInput.value.trim().toLowerCase();

    console.log('🔍 handleMerchantInput:', input);

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
        showMatchedItem(matchedItems);
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
    // 新增海外和國外的對應
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
    '車險': '產險'
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
    }
    
    if (allMatches.length === 0) return null;

    // Remove duplicates (same item appearing in multiple cards)
    // 使用originalItem（cards.data中的實際名稱）去重
    // 這樣"海外"和"國外"會被視為不同的items（因為它們在cards.data中是不同的item名稱）
    const uniqueMatches = [];
    const seenItems = new Set();

    for (const match of allMatches) {
        const itemKey = match.originalItem;

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
function showMatchedItem(matchedItems) {
    if (Array.isArray(matchedItems)) {
        if (matchedItems.length === 1) {
            matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${matchedItems[0].originalItem}</strong>`;
        } else {
    // 如果所有項目名稱相同，只顯示一次
    const uniqueItems = [...new Set(matchedItems.map(item => item.originalItem))];
    if (uniqueItems.length === 1) {
        matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${uniqueItems[0]}</strong>`;
    } else {
        const itemList = uniqueItems.join('、');
        matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${itemList}</strong>`;
    }
}
    } else {
        // Backward compatibility for single item
        matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${matchedItems.originalItem}</strong>`;
    }
    matchedItemDiv.className = 'matched-item';
    matchedItemDiv.style.display = 'block';
}

// Show no match message with red styling
function showNoMatchMessage() {
    matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>您選取的卡片中沒有任何匹配的項目，以下結果顯示基本回饋</strong>`;
    matchedItemDiv.className = 'matched-item no-match';
    matchedItemDiv.style.display = 'block';
}

// Hide matched item
function hideMatchedItem() {
    matchedItemDiv.style.display = 'none';
}


// Validate inputs
function validateInputs() {
    const merchantValue = merchantInput.value.trim();
    const amountValue = parseFloat(amountInput.value);
    
    const isValid = merchantValue.length > 0 && 
                   !isNaN(amountValue) && 
                   amountValue > 0;
    
    calculateBtn.disabled = !isValid;
}

// Calculate cashback for all cards
async function calculateCashback() {
    console.log('🔄 calculateCashback 被調用');
    console.log('cardsData:', cardsData ? `已載入 (${cardsData.cards.length} 張卡)` : '未載入');

    if (!cardsData) {
        console.error('❌ cardsData 未載入，無法計算');
        return;
    }

    const amount = parseFloat(amountInput.value);
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
    const cardsToCompare = currentUser ?
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;

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
                    const result = await calculateCardCashback(card, searchTerm, amount);
                    return {
                        ...result,
                        card: card,
                        matchedItemName: result.matchedItem // 使用卡片實際匹配到的item，而非搜尋詞
                    };
                })).then(results => results.filter(result => result.cashbackAmount > 0));

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

            // Deduplicate by card - if same card appears multiple times, combine matched items
            const cardResultsMap = new Map();
            allItemResults.forEach(result => {
                const cardId = result.card.id;
                const existing = cardResultsMap.get(cardId);

                if (!existing) {
                    // First time seeing this card - add it with matched items as array
                    result.matchedItems = [result.matchedItemName];
                    cardResultsMap.set(cardId, result);
                } else {
                    // Card already exists - compare rates and combine matched items
                    if (result.cashbackAmount > existing.cashbackAmount) {
                        // Higher rate - replace but keep matched items
                        result.matchedItems = [result.matchedItemName, ...existing.matchedItems];
                        cardResultsMap.set(cardId, result);
                    } else if (result.cashbackAmount === existing.cashbackAmount) {
                        // Same rate - add to matched items list
                        if (!existing.matchedItems.includes(result.matchedItemName)) {
                            existing.matchedItems.push(result.matchedItemName);
                        }
                    }
                    // Lower rate - ignore this result
                }
            });

            console.log(`📊 去重後: ${cardResultsMap.size} 張不同的卡片`);
            allResults = Array.from(cardResultsMap.values());
        } else {
            // Single match - backward compatibility
            const searchTerm = currentMatchedItem.originalItem.toLowerCase();
            allResults = await Promise.all(cardsToCompare.map(async card => {
                const result = await calculateCardCashback(card, searchTerm, amount);
                return {
                    ...result,
                    card: card
                };
            })).then(results => results.filter(result => result.cashbackAmount > 0));
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
                    const upcomingActivity = await findUpcomingActivity(card, searchTerm, amount);
                    if (upcomingActivity) {
                        return {
                            card: card,
                            ...upcomingActivity,
                            isUpcoming: true
                        };
                    }
                    return null;
                }));

                upcomingResults.push(...upcomingActivities.filter(r => r !== null));
            }
        }

        // Remove duplicates from upcoming results (same card might match multiple search terms)
        uniqueUpcomingResults = [];  // Reuse the variable declared at function scope
        const seenCardIds = new Set();
        for (const result of upcomingResults) {
            if (!seenCardIds.has(result.card.id)) {
                seenCardIds.add(result.card.id);
                uniqueUpcomingResults.push(result);
            }
        }

        // Show no-match message and basic rates when no special rates found
        if (results.length === 0 && merchantValue.length > 0) {
            showNoMatchMessage();
            // Show basic cashback for selected cards when no special rates found
            isBasicCashback = true;
            results = cardsToCompare.map(card => {
                let basicCashbackAmount = 0;
                let effectiveRate = card.basicCashback;
                
                // Handle complex cards like 永豐幣倍 with domestic bonus
if (card.domesticBonusRate && card.domesticBonusCap) {
                    // Handle 永豐幣倍 type cards with domestic bonus
                    const bonusAmount = Math.min(amount, card.domesticBonusCap);
                    const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
                    const basicCashback = Math.floor(amount * card.basicCashback / 100);
                    basicCashbackAmount = bonusCashback + basicCashback;
                    effectiveRate = card.basicCashback + card.domesticBonusRate;
                } else {
                    basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
                }
                
                // Determine cap for display
                let displayCap = null;
                if (card.domesticBonusRate && card.domesticBonusCap) {
                    displayCap = card.domesticBonusCap;
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
        results = cardsToCompare.map(card => {
            let basicCashbackAmount = 0;
            let effectiveRate = card.basicCashback;
            
            // Handle complex cards like 永豐幣倍 with domestic bonus
if (card.domesticBonusRate && card.domesticBonusCap) {
                // Handle 永豐幣倍 type cards with domestic bonus
                const bonusAmount = Math.min(amount, card.domesticBonusCap);
                const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
                const basicCashback = Math.floor(amount * card.basicCashback / 100);
                basicCashbackAmount = bonusCashback + basicCashback;
                effectiveRate = card.basicCashback + card.domesticBonusRate;
            } else {
                basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
            }
            
            // Determine cap for display
            let displayCap = null;
            if (card.domesticBonusRate && card.domesticBonusCap) {
                displayCap = card.domesticBonusCap;
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
            showNoMatchMessage();
        }
    }
    
    // Sort active results by cashback amount (highest first)
    results.sort((a, b) => b.cashbackAmount - a.cashbackAmount);

    // Append upcoming results after active results (if they exist)
    if (typeof uniqueUpcomingResults !== 'undefined' && uniqueUpcomingResults.length > 0) {
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

// Helper function to get category display style
function getCategoryStyle(category) {
    // All categories display in black color for consistency
    return category ? 'color: #111827;' : '';
}

// Calculate cashback for a specific card
async function calculateCardCashback(card, searchTerm, amount) {
    let bestRate = 0;
    let applicableCap = null;
    let matchedItem = null;
    let matchedCategory = null;
    let matchedRateGroup = null;
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
            return {
                rate: 0,
                cashbackAmount: 0,
                cap: null,
                matchedItem: null,
                effectiveAmount: 0,
                selectedLevel: null
            };
        }

        // First, check cashbackRates if they exist (for cards like DBS Eco with special promotions)
        let cashbackRateMatch = false;
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            for (const rateGroup of card.cashbackRates) {
                if (!rateGroup.items) continue;

                // Only consider active rates for cashback calculation (not upcoming)
                const rateStatus = getRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
                if (rateStatus !== 'active' && rateStatus !== 'always') {
                    continue;
                }

                // 解析 rate 值（支援 {specialRate}）
                const parsedRate = await parseCashbackRate(rateGroup.rate, card, levelSettings);

                for (const variant of searchVariants) {
                    let exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);
                    // Note: We don't check hideInDisplay here because hidden rates should still be searchable
                    if (exactMatch && parsedRate > bestRate) {
                        bestRate = parsedRate;
                        applicableCap = rateGroup.cap;
                        matchedItem = exactMatch;
                        matchedCategory = rateGroup.category || null;
                        matchedRateGroup = rateGroup;
                        cashbackRateMatch = true;

                        // Check if levelSettings has rate_hide to override the cashbackRate
                        // This allows level-specific rates for items in cashbackRates
                        if (levelSettings && levelSettings.rate_hide !== undefined) {
                            bestRate = levelSettings.rate_hide;
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
                        break;
                    }
                }
                if (cashbackRateMatch) break;
            }
        }

        // If no cashbackRates match, check specialItems
        if (!cashbackRateMatch) {
            let matchedSpecialItem = null;
            for (const variant of searchVariants) {
                matchedSpecialItem = card.specialItems.find(item => item.toLowerCase() === variant);
                if (matchedSpecialItem) {
                    console.log(`✅ ${card.name}: 匹配到 specialItem "${matchedSpecialItem}" (搜索詞: "${variant}")`);
                    break;
                }
            }

            if (!matchedSpecialItem && card.id === 'cathay-cube') {
                console.log(`⚠️ ${card.name}: 未匹配到 (搜索變體: ${searchVariants.join(', ')}, specialItems 前3項: ${card.specialItems.slice(0, 3).join(', ')})`);
            }

            if (matchedSpecialItem) {
                // CUBE card uses specialRate, other cards use rate
                bestRate = levelSettings.specialRate || levelSettings.rate;
                matchedItem = matchedSpecialItem;

                // Set category from levelSettings or find from specialItemsWithCategory
                if (levelSettings.category) {
                    matchedCategory = levelSettings.category;
                } else if (card.id === 'cathay-cube' && card.specialItemsWithCategory) {
                    // Find which category this item belongs to
                    for (const [category, items] of Object.entries(card.specialItemsWithCategory)) {
                        if (items.some(item => item.toLowerCase() === matchedSpecialItem.toLowerCase())) {
                            matchedCategory = category;
                            break;
                        }
                    }
                    // Fallback if not found in categories
                    if (!matchedCategory) {
                        matchedCategory = '玩數位、樂饗購、趣旅行';
                    }
                } else {
                    matchedCategory = null; // 不再寫死「指定通路」
                }

                // Set cap based on card type
                applicableCap = levelSettings.cap || null;

                // Set period from levelSettings if available
                if (levelSettings.period) {
                    matchedRateGroup = { period: levelSettings.period };
                }
            }
        }

        // If still no match and this is CUBE card, check generalItems
        if (bestRate === 0 && card.id === 'cathay-cube') {
            // CUBE card: check general items for 2% reward
            let matchedGeneralItem = null;
            let matchedGeneralCategory = null;

            if (card.generalItems) {
                for (const [category, items] of Object.entries(card.generalItems)) {
                    for (const variant of searchVariants) {
                        const foundItem = items.find(item => {
                            const itemLower = item.toLowerCase();
                            return itemLower === variant || itemLower.includes(variant) || variant.includes(itemLower);
                        });
                        if (foundItem) {
                            matchedGeneralItem = foundItem;
                            matchedGeneralCategory = category;
                            break;
                        }
                    }
                    if (matchedGeneralItem) break;
                }
            }

            if (matchedGeneralItem) {
                bestRate = levelSettings.generalRate;
                matchedItem = matchedGeneralItem;
                matchedCategory = matchedGeneralCategory;
                applicableCap = null; // CUBE card has no cap
            }
            // If no match at all, bestRate remains 0
        }
        // For other level-based cards: if no match found (bestRate is still 0), it will return 0 cashback below
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

        // Check exact matches for all search variants
        for (const rateGroup of card.cashbackRates) {
            // Only consider active rates for cashback calculation (not upcoming)
            const rateStatus = getRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
            if (rateStatus !== 'active' && rateStatus !== 'always') {
                continue;
            }

            // 解析 rate 值（支援 {rate}、{specialRate} 等）
            const parsedRate = await parseCashbackRate(rateGroup.rate, card, levelData);
            const parsedCap = parseCashbackCap(rateGroup.cap, card, levelData);

            // Check all search variants against all items in the rate group
            for (const variant of searchVariants) {
                let exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);
                if (exactMatch && parsedRate > bestRate) {
                    bestRate = parsedRate;
                    applicableCap = parsedCap !== null ? parsedCap : rateGroup.cap;
                    matchedItem = exactMatch;
                    matchedCategory = rateGroup.category || null;
                    matchedRateGroup = rateGroup;
                }
            }
        }
    }

    let cashbackAmount = 0;
    let effectiveAmount = amount;
    let totalRate = bestRate;
    
    if (bestRate > 0) {
        // Calculate special rate cashback
        let specialCashback = 0;
        let effectiveSpecialAmount = amount;
        
        if (applicableCap && amount > applicableCap) {
            effectiveSpecialAmount = applicableCap;
        }
        
        // NOTE: All cashback rates in cashbackRates are already TOTAL rates (including basic)
        // Do NOT add basicCashback or domesticBonusRate on top
        specialCashback = Math.floor(effectiveSpecialAmount * bestRate / 100);

        // domesticBonusRate and overseasBonusRate are ONLY for basic cashback
        // When there's a special rate (from cashbackRates), do NOT add these bonus rates
        let bonusRate = 0;
        let bonusCashback = 0;

        // Handle remaining amount if capped (excess amount gets basic cashback only)
        let remainingCashback = 0;
        if (applicableCap && amount > applicableCap) {
            const remainingAmount = amount - applicableCap;
            // Remaining amount only gets basic cashback rate
            remainingCashback = Math.floor(remainingAmount * card.basicCashback / 100);
        }

        // Total cashback = special rate amount + remaining basic amount
        cashbackAmount = specialCashback + bonusCashback + remainingCashback;

        // Total rate is the special rate from cashbackRates (no bonusRate added)
        totalRate = Math.round(bestRate * 100) / 100;
        effectiveAmount = applicableCap; // Keep this for display purposes
    }

    return {
        rate: Math.round(totalRate * 100) / 100,
        specialRate: Math.round(bestRate * 100) / 100,
        basicRate: Math.round(card.basicCashback * 100) / 100,
        cashbackAmount: cashbackAmount,
        cap: applicableCap,
        matchedItem: matchedItem,
        matchedCategory: matchedCategory,
        effectiveAmount: effectiveAmount,
        matchedRateGroup: matchedRateGroup,
        selectedLevel: selectedLevel // Pass selected level to display
    };
}

// Find upcoming activities for a card (activities starting within 30 days)
async function findUpcomingActivity(card, searchTerm, amount) {
    let matchedUpcomingActivity = null;

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
            const rateStatus = getRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
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

            // Check if any search variant matches
            for (const variant of searchVariants) {
                const exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);
                if (exactMatch) {
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
                        remainingCashback = Math.floor(remainingAmount * card.basicCashback / 100);
                    }

                    cashbackAmount = specialCashback + remainingCashback;

                    matchedUpcomingActivity = {
                        rate: parsedRate,
                        cap: parsedCap,
                        cashbackAmount: cashbackAmount,
                        matchedItem: exactMatch,
                        matchedCategory: rateGroup.category || null,
                        periodStart: rateGroup.periodStart,
                        periodEnd: rateGroup.periodEnd,
                        period: rateGroup.period,
                        selectedLevel: selectedLevel
                    };
                    break;
                }
            }
            if (matchedUpcomingActivity) break;
        }
    }

    return matchedUpcomingActivity;
}

// Display calculation results
// 模糊匹配商家名稱
function findMerchantPaymentInfo(searchedItem) {
    console.log('🔍 findMerchantPaymentInfo 被調用，搜尋詞:', searchedItem);

    if (!cardsData?.merchantPayments) {
        console.log('❌ cardsData.merchantPayments 不存在');
        return null;
    }

    if (!searchedItem) {
        console.log('❌ searchedItem 為空');
        return null;
    }

    const searchLower = searchedItem.toLowerCase().trim();
    console.log('🔍 轉換為小寫後:', searchLower);
    console.log('📋 可用的商家:', Object.keys(cardsData.merchantPayments));

    // 完全匹配
    for (const [merchantName, paymentInfo] of Object.entries(cardsData.merchantPayments)) {
        if (merchantName.toLowerCase() === searchLower) {
            console.log('✅ 完全匹配到:', merchantName);
            return { merchantName, ...paymentInfo };
        }
    }

    // 部分匹配：搜尋詞包含商家名稱或商家名稱包含搜尋詞
    for (const [merchantName, paymentInfo] of Object.entries(cardsData.merchantPayments)) {
        const merchantLower = merchantName.toLowerCase();
        if (searchLower.includes(merchantLower) || merchantLower.includes(searchLower)) {
            console.log('✅ 部分匹配到:', merchantName);
            return { merchantName, ...paymentInfo };
        }
    }

    console.log('❌ 沒有匹配到任何商家');
    return null;
}

// 顯示商家付款方式資訊
function displayMerchantPaymentInfo(searchedItem) {
    // 移除舊的商家付款方式區塊（如果存在）
    const existingBlock = document.getElementById('merchant-payment-info');
    if (existingBlock) {
        existingBlock.remove();
    }

    if (!searchedItem) {
        return;
    }

    // 如果搜尋詞包含頓號，拆分並嘗試匹配每個詞
    let merchantInfo = null;
    const searchTerms = searchedItem.split('、');

    console.log('🔍 搜尋商家付款方式，原始搜尋詞:', searchedItem);
    console.log('🔍 拆分後的搜尋詞:', searchTerms);

    for (const term of searchTerms) {
        merchantInfo = findMerchantPaymentInfo(term);
        if (merchantInfo) {
            console.log('✅ 使用搜尋詞匹配成功:', term);
            break;
        }
    }

    if (!merchantInfo) {
        console.log('❌ 所有搜尋詞都未匹配到商家付款方式');
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

    // 插入到「一般回饋與指定通路回饋」標題下方、免責聲明上方
    const resultsSection = document.getElementById('results-section');
    const paymentDisclaimer = document.getElementById('payment-disclaimer');

    if (resultsSection && paymentDisclaimer) {
        resultsSection.insertBefore(infoBlock, paymentDisclaimer);
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
        
        results.forEach((result, index) => {
            const cardElement = createCardResultElement(result, originalAmount, searchedItem, index === 0 && maxCashback > 0, isBasicCashback);
            resultsContainer.appendChild(cardElement);
        });
    }

    // 顯示商家付款方式資訊
    displayMerchantPaymentInfo(searchedItem);

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

    // 處理 {specialRate} 的情況
    if (rate === '{specialRate}') {
        // 只有 hasLevels 的卡片才支援 {specialRate}
        if (card.hasLevels && levelSettings && levelSettings.specialRate !== undefined) {
            return levelSettings.specialRate;
        }
        console.warn(`⚠️ ${card.name}: {specialRate} 需要 hasLevels=true 且 levelSettings 中有 specialRate`);
        return 0;
    }

    // 處理 {rate} 的情況
    if (rate === '{rate}') {
        // 只有 hasLevels 的卡片才支援 {rate}
        if (card.hasLevels && levelSettings && levelSettings.rate !== undefined) {
            return levelSettings.rate;
        }
        console.warn(`⚠️ ${card.name}: {rate} 需要 hasLevels=true 且 levelSettings 中有 rate`);
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
    if (rate === '{specialRate}') {
        return levelData?.specialRate || 0;
    }
    if (rate === '{rate}') {
        return levelData?.rate || 0;
    }
    return parseFloat(rate) || 0;
}

// 解析 cashbackRates 中的 cap 值（支援數字和 {cap}）
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

    // 處理 {cap} 的情況
    if (cap === '{cap}') {
        // 只有 hasLevels 的卡片才支援 {cap}
        if (card.hasLevels && levelSettings && levelSettings.cap !== undefined) {
            return levelSettings.cap;
        }
        console.warn(`⚠️ ${card.name}: {cap} 需要 hasLevels=true 且 levelSettings 中有 cap`);
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
    const cardsToCheck = currentUser ?
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;

    // Collect all coupon cashbacks that match the merchant
    const matchingCoupons = [];

    for (const card of cardsToCheck) {
        if (card.couponCashbacks) {
            for (const coupon of card.couponCashbacks) {
                const merchantLower = merchantValue.toLowerCase();
                const couponMerchantLower = coupon.merchant.toLowerCase();

                // Check if merchant matches coupon merchant
                if (merchantLower.includes(couponMerchantLower) ||
                    couponMerchantLower.includes(merchantLower)) {
                    // 計算實際回饋率（支援分級）
                    const actualRate = await calculateCouponRate(coupon, card);

                    matchingCoupons.push({
                        ...coupon,
                        cardName: card.name,
                        cardId: card.id,
                        actualRate: actualRate, // 儲存計算後的實際回饋率
                        potentialCashback: Math.floor(amount * actualRate / 100)
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
    
    // Display coupon results
    matchingCoupons.forEach(coupon => {
        const couponElement = createCouponResultElement(coupon, amount);
        couponResultsContainer.appendChild(couponElement);
    });
    
    couponResultsSection.style.display = 'block';
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
            條件: ${coupon.conditions}<br>匹配項目: <strong>${coupon.merchant}</strong>
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

    // 檢查是否已釘選（使用 matchedItem）
    const merchantForPin = result.matchedItems && result.matchedItems.length > 0
        ? result.matchedItems.join('、')
        : result.matchedItem;
    const pinned = merchantForPin && !isBasicCashback ? isPinned(result.card.id, merchantForPin) : false;

    cardDiv.innerHTML = `
        <div class="card-header">
            <div class="card-name-with-pin">
                <div class="card-name">${result.card.name}</div>
                ${merchantForPin && !isBasicCashback ? `
                    <button class="pin-btn ${pinned ? 'pinned' : ''}"
                            data-card-id="${result.card.id}"
                            data-card-name="${result.card.name}"
                            data-merchant="${merchantForPin}"
                            data-rate="${result.rate}"
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
                ${!isUpcoming && result.periodEnd && isEndingSoon(result.periodEnd, 10) ? (() => {
                    const daysUntil = getDaysUntilEnd(result.periodEnd);
                    const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                    return `<div class="ending-soon-badge">即將結束 (${daysText})</div>`;
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
            if (isBasicCashback) {
                return `
                    <div class="matched-merchant">
                        一般消費回饋率
                    </div>
                `;
            } else if (result.matchedItem) {
                let additionalInfo = '';

                // For upcoming activities, show period from result directly
                if (isUpcoming) {
                    if (result.period) {
                        additionalInfo += `<br><small>活動期間: ${result.period}</small>`;
                    } else if (result.periodStart && result.periodEnd) {
                        additionalInfo += `<br><small>活動期間: ${result.periodStart}~${result.periodEnd}</small>`;
                    }
                } else if (result.matchedRateGroup) {
                    // For active activities, use matchedRateGroup
                    const period = result.matchedRateGroup.period;
                    const conditions = result.matchedRateGroup.conditions;

                    if (period) additionalInfo += `<br><small>活動期間: ${period}</small>`;
                    if (conditions) additionalInfo += `<br><small>條件: ${conditions}</small>`;
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

function initializeAuthListeners() {
    const signInBtn = document.getElementById('sign-in-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    const userInfo = document.getElementById('user-info');
    const userPhoto = document.getElementById('user-photo');
    const userName = document.getElementById('user-name');

    // Sign in function - open auth modal
    signInBtn.addEventListener('click', () => {
        openAuthModal('login');
    });

    // Sign out function
    signOutBtn.addEventListener('click', async () => {
        try {
            await window.signOut(auth);
            console.log('Sign out successful');
        } catch (error) {
            console.error('Sign out failed:', error);
        }
    });
    
    // Helper functions to show/hide tool sections
    function showToolSections() {
        // Input section (main tool UI)
        const inputSection = document.querySelector('.input-section');
        if (inputSection) inputSection.style.display = 'block';

        // Header tool sections (cards and payments selection)
        const supportedCards = document.querySelector('.supported-cards');
        const headerSection = document.querySelector('.header-section');

        if (supportedCards) supportedCards.style.display = 'block';
        if (headerSection) headerSection.style.display = 'block';

        // Note: Results sections are controlled by query logic, not here
    }

    function hideToolSections() {
        // Input section (main tool UI)
        const inputSection = document.querySelector('.input-section');
        if (inputSection) inputSection.style.display = 'none';

        // Header tool sections (cards and payments selection)
        const supportedCards = document.querySelector('.supported-cards');
        const headerSection = document.querySelector('.header-section');

        if (supportedCards) supportedCards.style.display = 'none';
        if (headerSection) headerSection.style.display = 'none';

        // Hide results sections when hiding tool
        const resultsSection = document.querySelector('.results-section');
        const couponResultsSection = document.querySelector('.coupon-results-section');

        if (resultsSection) resultsSection.style.display = 'none';
        if (couponResultsSection) couponResultsSection.style.display = 'none';
    }

    // Listen for authentication state changes
    window.onAuthStateChanged(auth, async (user) => {
        const productIntroSection = document.getElementById('product-intro-section');

        if (user) {
            // User is signed in
            console.log('User signed in:', user);
            currentUser = user;
            signInBtn.style.display = 'none';
            userInfo.style.display = 'inline-flex';

            // Hide product introduction section and show tool sections when logged in
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }
            showToolSections();

            // Set user photo with fallback
            if (user.photoURL) {
                userPhoto.src = user.photoURL;
                userPhoto.style.display = 'block';
            } else {
                userPhoto.style.display = 'none'; // Hide if no photo
            }

            userName.textContent = user.displayName || user.email;

            // Show manage cards button
            document.getElementById('manage-cards-btn').style.display = 'block';

            // Show my mappings button
            const myMappingsBtn = document.getElementById('my-mappings-btn');
            if (myMappingsBtn) {
                myMappingsBtn.style.display = 'flex';
            }

            // Load user's selected cards and payments from Firestore (async)
            await loadUserCards();
            await loadUserPayments();
            await loadSpendingMappings();

            // Load user's quick search options and custom options
            await initializeQuickSearchOptions();
            customOptions = await loadUserCustomOptions() || [];
            renderQuickSearchButtons();

            // Update chips display
            populateCardChips();
            populatePaymentChips();
        } else {
            // User is signed out
            console.log('User signed out');
            currentUser = null;
            userSelectedCards.clear();
            userSelectedPayments.clear();
            userSpendingMappings = [];
            signInBtn.style.display = 'inline-block';
            userInfo.style.display = 'none';

            // Reset quick search options to default
            await initializeQuickSearchOptions();
            customOptions = [];
            renderQuickSearchButtons();

            // Show product introduction section and hide tool sections when not logged in
            if (productIntroSection) {
                productIntroSection.style.display = 'block';
            }
            hideToolSections();

            // Clear user info
            userPhoto.src = '';
            userPhoto.style.display = 'none';
            userName.textContent = '';

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
            showToolSections();

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
            showToolSections();

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

// Load user's selected cards from Firestore (with localStorage fallback)
async function loadUserCards() {
    if (!currentUser) {
        console.log('No current user, using all cards');
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        return;
    }

    try {
        // Try to load from Firestore first
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().selectedCards) {
                const cloudCards = docSnap.data().selectedCards;
                userSelectedCards = new Set(cloudCards);
                console.log('✅ Loaded user cards from Firestore:', Array.from(userSelectedCards));

                // Sync to localStorage for offline use
                const storageKey = `selectedCards_${currentUser.uid}`;
                localStorage.setItem(storageKey, JSON.stringify(cloudCards));
                return;
            }
        }

        // Fallback to localStorage if Firestore fails or no data
        const storageKey = `selectedCards_${currentUser.uid}`;
        const savedCards = localStorage.getItem(storageKey);

        if (savedCards) {
            userSelectedCards = new Set(JSON.parse(savedCards));
            console.log('📦 Loaded user cards from localStorage (fallback):', Array.from(userSelectedCards));
        } else {
            // First time user - select all cards by default
            console.log('🆕 First time user, selecting all cards');
            userSelectedCards = new Set(cardsData.cards.map(card => card.id));
            saveUserCards();
        }
    } catch (error) {
        console.error('❌ Error loading user cards:', error);
        // Default to all cards if error
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
    }
}

// Save user's selected cards to localStorage and Firestore
async function saveUserCards() {
    if (!currentUser) {
        console.log('No user logged in, skipping save');
        return;
    }

    const cardsArray = Array.from(userSelectedCards);

    try {
        // Save to localStorage as backup
        const storageKey = `selectedCards_${currentUser.uid}`;
        localStorage.setItem(storageKey, JSON.stringify(cardsArray));
        console.log('✅ Saved user cards to localStorage:', cardsArray);

        // Save to Firestore for cross-device sync
        if (window.db && window.doc && window.setDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            await window.setDoc(docRef, {
                selectedCards: cardsArray,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('☁️ Synced user cards to Firestore:', cardsArray);
        }
    } catch (error) {
        console.error('Error saving user cards:', error);
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
    
    // Save cards
    saveBtn.addEventListener('click', async () => {
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
        userSelectedCards = newSelection;
        await saveUserCards();

        // Update UI immediately
        populateCardChips();

        // Close modal
        closeModal();
    });
    
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
}

// Open manage cards modal
function openManageCardsModal() {
    const modal = document.getElementById('manage-cards-modal');
    const cardsSelection = document.getElementById('cards-selection');
    const saveBtn = document.getElementById('save-cards-btn');
    const toggleAllBtn = document.getElementById('toggle-all-cards');

    // Check if user is logged in
    const isLoggedIn = currentUser !== null;

    // Collect all unique tags from cards
    const allTags = new Set();
    cardsData.cards.forEach(card => {
        if (card.tags && Array.isArray(card.tags)) {
            card.tags.forEach(tag => allTags.add(tag));
        }
    });

    // Render tag filter chips
    const tagFilterChips = document.getElementById('tag-filter-chips');
    const selectedTags = new Set(); // Track selected tags for filtering

    if (allTags.size > 0) {
        tagFilterChips.innerHTML = '';
        const sortedTags = ['旅遊', '開車族', '餐廳', '交通', '網購', '百貨公司', '外送', '娛樂', '行動支付', 'AI工具', '便利商店', '串流平台', '超市', '藥妝', '時尚品牌', '生活百貨', '運動', '寵物', '親子', '應用程式商店', '飲食品牌', '美妝美髮保養品牌', '保費']
            .filter(tag => allTags.has(tag));

        sortedTags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = `tag-filter-chip card-tag ${getTagClass(tag)}`;
            chip.textContent = tag;
            chip.dataset.tag = tag;

            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                if (chip.classList.contains('active')) {
                    selectedTags.add(tag);
                } else {
                    selectedTags.delete(tag);
                }
                applyCardFilters();
            });

            tagFilterChips.appendChild(chip);
        });
    }

    // Populate cards selection
    cardsSelection.innerHTML = '';

    // Add login prompt if not logged in
    if (!isLoggedIn) {
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
        loginPrompt.textContent = '登入後即可選取指定卡片做比較';
        cardsSelection.appendChild(loginPrompt);
    }

    // Sort cards by name
    const sortedCards = [...cardsData.cards].sort((a, b) => a.name.localeCompare(b.name));

    sortedCards.forEach(card => {
        const isSelected = userSelectedCards.has(card.id);

        const cardDiv = document.createElement('div');
        cardDiv.className = `card-checkbox ${isSelected ? 'selected' : ''}`;

        cardDiv.innerHTML = `
            <input type="checkbox" id="card-${card.id}" value="${card.id}" ${isSelected ? 'checked' : ''} ${!isLoggedIn ? 'disabled' : ''}>
            <label for="card-${card.id}" class="card-checkbox-label">${card.name}</label>
        `;

        // Update visual state on checkbox change (only if logged in)
        const checkbox = cardDiv.querySelector('input');
        if (isLoggedIn) {
            checkbox.addEventListener('change', () => {
                cardDiv.classList.toggle('selected', checkbox.checked);
            });
        }

        cardsSelection.appendChild(cardDiv);
    });

    // Disable buttons if not logged in
    if (!isLoggedIn) {
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

        // Update toggle button state
        const allSelected = sortedCards.every(card => userSelectedCards.has(card.id));
        toggleAllBtn.textContent = allSelected ? '全不選' : '全選';
    }

    // Setup combined search and tag filter functionality
    const searchInput = document.getElementById('search-cards-input');
    searchInput.value = ''; // Clear search on open

    // Function to apply both text search and tag filters
    function applyCardFilters() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        const cardDivs = cardsSelection.querySelectorAll('.card-checkbox');

        cardDivs.forEach(cardDiv => {
            const checkbox = cardDiv.querySelector('input[type="checkbox"]');
            if (!checkbox) return;

            const cardId = checkbox.value;
            const card = cardsData.cards.find(c => c.id === cardId);
            if (!card) return;

            const label = cardDiv.querySelector('.card-checkbox-label');
            if (!label) return;

            // Text search filter
            const cardName = label.textContent.toLowerCase();
            const matchesSearch = searchTerm === '' || cardName.includes(searchTerm);

            // Tag filter (must have ALL selected tags)
            let matchesTags = true;
            if (selectedTags.size > 0) {
                const cardTags = card.tags || [];
                matchesTags = [...selectedTags].every(tag => cardTags.includes(tag));
            }

            // Show card only if it matches BOTH filters (AND relationship)
            if (matchesSearch && matchesTags) {
                cardDiv.style.display = 'flex';
            } else {
                cardDiv.style.display = 'none';
            }
        });
    }

    // Listen to search input changes
    searchInput.addEventListener('input', applyCardFilters);

    modal.style.display = 'flex';
    disableBodyScroll();
}

// Show card detail modal
// Helper function to convert tag name to CSS class
function getTagClass(tagName) {
    const tagMap = {
        '旅遊': 'tag-travel',
        '開車族': 'tag-driving',
        '餐廳': 'tag-restaurant',
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

    const modal = document.getElementById('card-detail-modal');

    // Update basic information
    document.getElementById('card-detail-title').textContent = card.name + ' 詳情';

    const fullNameLink = document.getElementById('card-full-name-link');
    fullNameLink.textContent = card.fullName || card.name;
    if (card.website) {
        fullNameLink.href = card.website;
        // 追蹤外部連結點擊
        fullNameLink.onclick = () => {
            if (window.logEvent && window.firebaseAnalytics) {
                window.logEvent(window.firebaseAnalytics, 'click_bank_website', {
                    card_id: card.id,
                    card_name: card.name,
                    website: card.website
                });
            }
        };
    } else {
        fullNameLink.removeAttribute('href');
        fullNameLink.style.textDecoration = 'none';
        fullNameLink.style.color = 'inherit';
    }

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
        
    // Update basic cashback
const basicCashbackDiv = document.getElementById('card-basic-cashback');
let basicContent = `<div class="cashback-detail-item">`;
basicContent += `<div class="cashback-rate">國內一般回饋: ${card.basicCashback}%</div>`;
if (card.basicConditions) {
    basicContent += `<div class="cashback-condition">條件: ${card.basicConditions}</div>`;
}
basicContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
basicContent += `</div>`; // ← 這裡關閉第一個區塊

if (card.overseasCashback) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外一般回饋: ${card.overseasCashback}%</div>`;
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
    const savedLevel = await getCardLevel(card.id, defaultLevel);
    const levelData = card.levelSettings[savedLevel];

    if (levelData.domesticBonusRate !== undefined) {
        domesticBonusRate = levelData.domesticBonusRate;
        domesticBonusCap = levelData.domesticBonusCap;
        domesticConditions = levelData.domesticBonusConditions || card.domesticBonusConditions;
    }
    if (levelData.overseasBonusRate !== undefined) {
        overseasBonusRate = levelData.overseasBonusRate;
        overseasBonusCap = levelData.overseasBonusCap;
        overseasConditions = levelData.overseasBonusConditions || card.overseasBonusConditions;
    }
}

if (domesticBonusRate) {
    basicContent += `<div class="cashback-detail-item">`; // ← 新的區塊
    basicContent += `<div class="cashback-rate">國內加碼回饋: +${domesticBonusRate}%</div>`;
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
    basicContent += `<div class="cashback-rate">海外加碼回饋: +${overseasBonusRate}%</div>`;
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

        // Generate level selector HTML with note
        let levelNote = '';
        if (card.id === 'dbs-eco') {
            if (savedLevel === '精選卡友') {
                levelNote = '<div id="level-note" style="font-size: 11px; color: #9ca3af; margin-top: 8px;">需同時持有星展帳戶且資產達NT$30萬連續4個月</div>';
            } else if (savedLevel === '豐盛理財客戶/豐盛理財私人客戶') {
                levelNote = '<div id="level-note" style="font-size: 11px; color: #9ca3af; margin-top: 8px;">需星展總資產達NT$300萬/NT$3000萬連續4個月</div>';
            } else {
                levelNote = '<div id="level-note" style="font-size: 11px; color: #9ca3af; margin-top: 8px;"></div>';
            }
        }

        // Generate level rates info
        let levelRatesInfo = '';
        if (levelNames.length > 1) {
            levelRatesInfo = '<div style="margin-left: 24px; flex-shrink: 0; padding: 8px 12px; border-left: 3px solid #e5e7eb; background-color: #f9fafb; min-width: 0;">';
            levelRatesInfo += '<div style="font-size: 12px; color: #6b7280; font-weight: 600; margin-bottom: 4px;">各級別回饋率：</div>';

            if (card.id === 'cathay-cube') {
                // CUBE card uses specialRate instead of rate
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    const displayRate = data.specialRate || data.rate || 0;
                    levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${displayRate}% (無上限)</div>`;
                });
                // Add note about which categories are affected by level
                levelRatesInfo += `<div style="font-size: 10px; color: #9ca3af; margin-top: 6px; font-style: italic; line-height: 1.4;">由分級決定回饋率的方案包含：玩數位、樂饗購、趣旅行</div>`;
            } else if (card.id === 'dbs-eco') {
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    if (level === '一般卡友') {
                        levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'})</div>`;
                    } else if (level === '精選卡友') {
                        levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'}；加碼 1.8% 上限為 NT$ 50,000)</div>`;
                    } else if (level === '豐盛理財客戶/豐盛理財私人客戶') {
                        levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'}；加碼 4.8% 上限為 NT$ 37,500)</div>`;
                    } else {
                        levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}% (上限 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'})</div>`;
                    }
                });
            } else {
                // Default formatting for other cards (like Uni card)
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}% (上限 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'})</div>`;
                });
            }
            levelRatesInfo += '</div>';
        }

        let levelSelectorHTML = `
            <div class="level-selector" style="margin-bottom: 16px; display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
                <div style="flex-shrink: 0;">
                    <div>
                        <label style="font-weight: 600; margin-right: 8px;">選擇級別：</label>
                        <select id="card-level-select" style="padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                            ${levelNames.map(level =>
                                `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                            ).join('')}
                        </select>
                    </div>
                    ${levelNote}
                </div>
                ${levelRatesInfo}
            </div>
        `;

        cubeLevelSection.innerHTML = levelSelectorHTML;
        cubeLevelSection.style.display = 'block';

        // Add change listener
        const levelSelect = document.getElementById('card-level-select');
        levelSelect.onchange = async function() {
            // Update level note for DBS Eco card
            if (card.id === 'dbs-eco') {
                const levelNoteElement = document.getElementById('level-note');
                if (levelNoteElement) {
                    if (this.value === '精選卡友') {
                        levelNoteElement.textContent = '需同時持有星展帳戶且資產達NT$30萬連續4個月';
                    } else if (this.value === '豐盛理財客戶/豐盛理財私人客戶') {
                        levelNoteElement.textContent = '需星展總資產達NT$300萬/NT$3000萬連續4個月';
                    } else {
                        levelNoteElement.textContent = '';
                    }
                }
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
                    const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                    endingSoonBadgeLevel1 = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
                }

                specialContent += `<div class="cashback-rate">${group.parsedRate}% 回饋${endingSoonBadgeLevel1}</div>`;

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

                    if (uniqueItems.length <= 20) {
                        const merchantsList = uniqueItems.join('、');
                        specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = uniqueItems.slice(0, 20).join('、');
                        const fullList = uniqueItems.join('、');

                        specialContent += `<div class="cashback-merchants">`;
                        specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">… 顯示全部${uniqueItems.length}個</button>`;
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
        specialContent += `<div class="cashback-rate">${levelData.rate}% 回饋</div>`;
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
            specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">... 顯示全部${card.specialItems.length}個</button>`;
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
                    const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                    endingSoonBadgeLevel = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
                }

                specialContent += `<div class="cashback-rate">${group.parsedRate}% 回饋${endingSoonBadgeLevel}</div>`;

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

                    if (uniqueItems.length <= 20) {
                        const merchantsList = uniqueItems.join('、');
                        specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = uniqueItems.slice(0, 20).join('、');
                        const fullList = uniqueItems.join('、');

                        specialContent += `<div class="cashback-merchants">`;
                        specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">… 顯示全部${uniqueItems.length}個</button>`;
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
            specialContent += `<div class="cashback-rate">${levelData.rate}% 回饋 (${savedLevel})</div>`;
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

            // Display rate with category in parentheses (like Cube card style)
            const categoryLabel = rate.category ? ` (${rate.category})` : '';

            // Add ending soon badge if applicable
            let endingSoonBadge = '';
            if (rate.periodEnd && isEndingSoon(rate.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(rate.periodEnd);
                const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                endingSoonBadge = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            specialContent += `<div class="cashback-rate">${parsedRate}% 回饋${categoryLabel}${endingSoonBadge}</div>`;

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
                
                if (rate.items.length <= 20) {
                    // 少於20個直接顯示全部
                    const merchantsList = processedItems.join('、');
                    specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    // 超過20個顯示可展開的列表
                    const initialList = processedItems.slice(0, 20).join('、');
                    const fullList = processedItems.join('、');
                    
                    specialContent += `<div class="cashback-merchants">`;
                    specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">… 顯示全部${rate.items.length}個</button>`;
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

        // Handle both Map (from upcomingGroups1/2) and Array (from upcomingGroupsCube)
        const groupsToDisplay = Array.isArray(upcomingGroups) ? upcomingGroups.map((g, i) => [i, g]) : upcomingGroups;

        for (const [groupKey, group] of groupsToDisplay) {
            upcomingContent += `<div class="cashback-detail-item upcoming-activity">`;

            // 顯示回饋率和即將開始標籤（包含 category 如果有的話）
            const daysUntil = getDaysUntilStart(group.periodStart);
            const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
            const categoryStyle = group.category ? getCategoryStyle(group.category) : '';
            const categoryText = group.category ? ` <span style="${categoryStyle}">(${getCategoryDisplayName(group.category)})</span>` : '';
            upcomingContent += `<div class="cashback-rate">${group.parsedRate}% 回饋${categoryText} <span class="upcoming-badge">即將開始 (${daysText})</span></div>`;

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

                if (uniqueItems.length <= 20) {
                    const merchantsList = uniqueItems.join('、');
                    upcomingContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = uniqueItems.slice(0, 20).join('、');
                    const fullList = uniqueItems.join('、');

                    upcomingContent += `<div class="cashback-merchants">`;
                    upcomingContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    upcomingContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">… 顯示全部${uniqueItems.length}個</button>`;
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
                        conditionsContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${getCategoryDisplayName(cond.category)}：${cond.conditions}</div>`;
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
                        upcomingContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${getCategoryDisplayName(cond.category)}：${cond.conditions}</div>`;
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
        for (const coupon of card.couponCashbacks) {
            const actualRate = await calculateCouponRate(coupon, card);

            couponContent += `<div class="cashback-detail-item">`;
            couponContent += `<div class="cashback-rate">${coupon.merchant}: ${actualRate}% 回饋</div>`;
            couponContent += `<div class="cashback-condition">條件: ${coupon.conditions}</div>`;
            couponContent += `<div class="cashback-condition">活動期間: ${coupon.period}</div>`;
            couponContent += `</div>`;
        }

        couponCashbackDiv.innerHTML = couponContent;
        couponSection.style.display = 'block';
    } else {
        couponSection.style.display = 'none';
    }
    
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
    // 只處理有 specialItems 的卡片
    if (!card.specialItems || card.specialItems.length === 0) {
        return '';
    }

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
        window._currentUpcomingGroupsCube = upcomingRates.map(rate => {
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
        window._currentCard = card;
    }

    let content = '';

    // Add CUBE-specific birthday note at the beginning
    content += `
        <div class="cube-birthday-note" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px; margin-bottom: 16px;">
            <div style="color: #9ca3af; font-size: 11px; line-height: 1.5; font-style: italic;">
                ※ 慶生月方案不納入回饋比較，請於您的生日月份到<a href="https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/cube-list" target="_blank" rel="noopener" style="color: #6b7280; text-decoration: underline;">官網查詢</a>
            </div>
        </div>
    `;

    // 依照回饋率高低順序顯示，變動的玩數位樂饗購趣旅行放在最後

    // 1. 童樂匯 10% 回饋 (固定最高) - 只顯示進行中的
    const childrenRate10 = card.cashbackRates?.find(rate => {
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        return rate.rate === 10.0 && (rate.category === '童樂匯' || rate.category === '切換「童樂匯」方案') && (status === 'active' || status === 'always');
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
        content += `<div class="cashback-rate">10% 回饋 <span style="${categoryStyle10}">(${getCategoryDisplayName('童樂匯')})</span>${endingSoonBadge10}</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;
        if (childrenRate10.conditions) {
            content += `<div class="cashback-condition">條件: ${childrenRate10.conditions}</div>`;
        }
        if (childrenRate10.period) {
            content += `<div class="cashback-condition">活動期間: ${childrenRate10.period}</div>`;
        }
        content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${childrenRate10.items.join('、')}</div>`;
        content += `</div>`;
    }

    // 2. 童樂匯 5% 回饋 - 只顯示進行中的
    const childrenRate5 = card.cashbackRates?.find(rate => {
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        return rate.rate === 5.0 && (rate.category === '童樂匯' || rate.category === '切換「童樂匯」方案') && (status === 'active' || status === 'always');
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
        content += `<div class="cashback-rate">5% 回饋 <span style="${categoryStyle5}">(${getCategoryDisplayName('童樂匯')})</span>${endingSoonBadge5}</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;
        if (childrenRate5.conditions) {
            content += `<div class="cashback-condition">條件: ${childrenRate5.conditions}</div>`;
        }
        if (childrenRate5.period) {
            content += `<div class="cashback-condition">活動期間: ${childrenRate5.period}</div>`;
        }
        content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${childrenRate5.items.join('、')}</div>`;
        content += `</div>`;
    }

    // 3. Level變動的特殊通路 - 按類別分組顯示
    if (card.specialItemsWithCategory) {
        // 有分類資料，按類別顯示
        const categories = ['玩數位', '樂饗購', '趣旅行'];
        categories.forEach(category => {
            const items = card.specialItemsWithCategory[category];
            if (items && items.length > 0) {
                content += `<div class="cashback-detail-item">`;
                const categoryStyle = getCategoryStyle(category);
                content += `<div class="cashback-rate">${specialRate}% 回饋 <span style="${categoryStyle}">(${getCategoryDisplayName(category)})</span></div>`;
                content += `<div class="cashback-condition">消費上限: 無上限</div>`;

                const merchantsList = items.join('、');
                if (items.length <= 20) {
                    content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = items.slice(0, 20).join('、');
                    const merchantsId = `cube-merchants-${category}-${savedLevel}`;
                    const showAllId = `cube-show-all-${category}-${savedLevel}`;

                    content += `<div class="cashback-merchants">`;
                    content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${merchantsList}')">... 顯示全部${items.length}個</button>`;
                    content += `</div>`;
                }
                content += `</div>`;
            }
        });
    } else {
        // 沒有分類資料，使用舊的顯示方式
        content += `<div class="cashback-detail-item">`;
        content += `<div class="cashback-rate">${specialRate}% 回饋 (玩數位、樂饗購、趣旅行)</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;

        const merchantsList = card.specialItems.join('、');
        if (card.specialItems.length <= 30) {
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
        } else {
            const initialList = card.specialItems.slice(0, 30).join('、');
            const fullList = merchantsList;
            const merchantsId = `cube-merchants-${savedLevel}`;
            const showAllId = `cube-show-all-${savedLevel}`;

            content += `<div class="cashback-merchants">`;
            content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
            content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">... 顯示全部${card.specialItems.length}個</button>`;
            content += `</div>`;
        }
        content += `</div>`;
    }
    
    // 4. 集精選和來支付 (2%)
    if (card.generalItems) {
        Object.entries(card.generalItems).forEach(([category, items]) => {
            content += `<div class="cashback-detail-item">`;
            const categoryStyle = getCategoryStyle(category);
            content += `<div class="cashback-rate">2% 回饋 <span style="${categoryStyle}">(${getCategoryDisplayName(category)})</span></div>`;
            content += `<div class="cashback-condition">消費上限: 無上限</div>`;
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${items.join('、')}</div>`;
            content += `</div>`;
        });
    }

    // 5. 其他 cashbackRates（如 LINE PAY 2%）- 放在最後，只顯示進行中的
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        const otherRates = card.cashbackRates
            .filter(rate => {
                const status = getRateStatus(rate.periodStart, rate.periodEnd);
                return !rate.hideInDisplay &&
                    rate.category !== '童樂匯' &&
                    rate.category !== '切換「童樂匯」方案' &&
                    (status === 'active' || status === 'always');  // 只顯示進行中的
            })
            .sort((a, b) => {
                // 先解析 rate 以支援 {specialRate} 和 {rate} 的排序
                const aRate = parseCashbackRateSync(a.rate, levelSettings);
                const bRate = parseCashbackRateSync(b.rate, levelSettings);
                return bRate - aRate;
            });

        for (let index = 0; index < otherRates.length; index++) {
            const rate = otherRates[index];
            content += `<div class="cashback-detail-item">`;

            // 解析 rate 值（支援 {specialRate} 和 {rate}）
            const parsedRate = await parseCashbackRate(rate.rate, card, levelSettings);

            // 显示回饋率，如果有 category 则显示在括号中（使用動態樣式）
            const categoryStyleOther = rate.category ? getCategoryStyle(rate.category) : '';
            const categoryLabel = rate.category ? ` <span style="${categoryStyleOther}">(${getCategoryDisplayName(rate.category)})</span>` : '';

            // Add ending soon badge if applicable
            let endingSoonBadgeOther = '';
            if (rate.periodEnd && isEndingSoon(rate.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(rate.periodEnd);
                const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                endingSoonBadgeOther = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            content += `<div class="cashback-rate">${parsedRate}% 回饋${categoryLabel}${endingSoonBadgeOther}</div>`;

            // 解析 cap 值（支援 {cap}）
            const parsedCap = parseCashbackCap(rate.cap, card, levelSettings);
            if (parsedCap) {
                content += `<div class="cashback-condition">消費上限: NT$${parsedCap.toLocaleString()}</div>`;
            } else {
                content += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // 显示條件
            if (rate.conditions) {
                content += `<div class="cashback-condition">條件: ${rate.conditions}</div>`;
            }

            // 显示活動期間
            if (rate.period) {
                content += `<div class="cashback-condition">活動期間: ${rate.period}</div>`;
            }

            // 显示適用通路
            if (rate.items && rate.items.length > 0) {
                const merchantsId = `cube-other-merchants-${index}`;
                const showAllId = `cube-other-show-all-${index}`;

                if (rate.items.length <= 20) {
                    const merchantsList = rate.items.join('、');
                    content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = rate.items.slice(0, 20).join('、');
                    const fullList = rate.items.join('、');

                    content += `<div class="cashback-merchants">`;
                    content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">… 顯示全部${rate.items.length}個</button>`;
                    content += `</div>`;
                }
            }

            content += `</div>`;
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

// 讀取用戶筆記 (註: 筆記僅依賴cardId，與userSelectedCards狀態無關)
async function loadUserNotes(cardId) {
    const cacheKey = auth.currentUser ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    
    if (!auth.currentUser) {
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
    const cacheKey = auth.currentUser ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    localStorage.setItem(cacheKey, notes);
}

// 手動儲存筆記
async function saveUserNotes(cardId, notes) {
    const saveBtn = document.getElementById('save-notes-btn');
    const saveIndicator = document.getElementById('save-indicator');
    const btnText = document.querySelector('.btn-text');
    const btnIcon = document.querySelector('.btn-icon');
    
    if (!auth.currentUser) {
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
        btnIcon.textContent = '⏳';
        btnText.textContent = '儲存中...';
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
        btnIcon.textContent = '✓';
        btnText.textContent = '已儲存';
        saveIndicator.textContent = '✓ 雲端同步成功';
        saveIndicator.style.color = '#10b981';
        
        // 2秒後恢復正常狀態
        setTimeout(() => {
            saveBtn.className = 'save-notes-btn';
            saveBtn.disabled = true; // 沒有變更時保持禁用
            btnIcon.textContent = '💾';
            btnText.textContent = '儲存筆記';
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
        btnIcon.textContent = '⚠️';
        btnText.textContent = '重試儲存';
        saveIndicator.textContent = '雲端儲存失敗，已本地儲存';
        saveIndicator.style.color = '#dc2626';
        
        // 5秒後恢復
        setTimeout(() => {
            btnIcon.textContent = '💾';
            btnText.textContent = '儲存筆記';
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
async function addMapping(cardId, cardName, merchant, cashbackRate) {
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
        hasChanged: false // 初始為未變動
    };

    console.log('➕ [配卡] 新增配對:', cardName, '-', merchant, cashbackRate + '%');
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
async function togglePin(button, cardId, cardName, merchant, rate) {
    // 檢查是否有登入用戶
    if (!currentUser) {
        alert('請先登入才能使用釘選功能');
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
        const newMapping = await addMapping(cardId, cardName, merchant, rate);
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
function renderMappingsList(searchTerm = '') {
    const mappingsList = document.getElementById('mappings-list');
    if (!mappingsList) return;

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

    // 按 order 排序（用戶自訂順序）
    filteredMappings.sort((a, b) => (a.order || 0) - (b.order || 0));

    // 渲染標準表格
    let html = `
        <table class="mappings-table">
            <thead>
                <tr>
                    <th class="drag-handle-header"></th>
                    <th>商家</th>
                    <th>卡片名稱</th>
                    <th class="rate-column">回饋率</th>
                    <th class="delete-column"></th>
                </tr>
            </thead>
            <tbody>
    `;

    filteredMappings.forEach((mapping, index) => {
        const merchant = optimizeMerchantName(mapping.merchant);
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
    `;

    mappingsList.innerHTML = html;

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

    // If user not logged in, use localStorage
    if (!auth.currentUser) {
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

// Save card level to Firestore (with localStorage backup)
async function saveCardLevel(cardId, level) {
    if (!cardId || !level) return;

    // Always save to localStorage as backup
    localStorage.setItem(`cardLevel-${cardId}`, level);

    // If user not logged in, only save locally
    if (!auth.currentUser) {
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
function openManagePaymentsModal() {
    const modal = document.getElementById('manage-payments-modal');
    const paymentsSelection = document.getElementById('payments-selection');
    const saveBtn = document.getElementById('save-payments-btn');
    const toggleAllBtn = document.getElementById('toggle-all-payments');

    const isLoggedIn = currentUser !== null;

    paymentsSelection.innerHTML = '';

    if (!isLoggedIn) {
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
        loginPrompt.textContent = '登入後即可選取指定行動支付做比較';
        paymentsSelection.appendChild(loginPrompt);
    }

    paymentsData.payments.forEach(payment => {
        const isSelected = userSelectedPayments.has(payment.id);

        const paymentDiv = document.createElement('div');
        paymentDiv.className = `card-checkbox ${isSelected ? 'selected' : ''}`;

        paymentDiv.innerHTML = `
            <input type="checkbox" id="payment-${payment.id}" value="${payment.id}" ${isSelected ? 'checked' : ''} ${!isLoggedIn ? 'disabled' : ''}>
            <label for="payment-${payment.id}" class="card-checkbox-label">${payment.name}</label>
        `;

        const checkbox = paymentDiv.querySelector('input');
        if (isLoggedIn) {
            checkbox.addEventListener('change', () => {
                paymentDiv.classList.toggle('selected', checkbox.checked);
            });
        }

        paymentsSelection.appendChild(paymentDiv);
    });

    if (!isLoggedIn) {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
        toggleAllBtn.disabled = true;
        toggleAllBtn.style.opacity = '0.5';
    } else {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
        toggleAllBtn.disabled = false;
        toggleAllBtn.style.opacity = '1';
    }

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
    const cardsToCheck = currentUser ?
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;

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
                const result = await calculateCardCashback(card, term, 1000); // Use 1000 as dummy amount
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

    const paymentsToCompare = currentUser ?
        paymentsData.payments.filter(p => userSelectedPayments.has(p.id)) :
        paymentsData.payments;

    if (paymentsToCompare.length === 0) {
        contentContainer.innerHTML = '<p style="text-align: center; color: #666;">請先選擇要比較的行動支付</p>';
    } else {
        let paymentsWithCards = [];

        for (const payment of paymentsToCompare) {
            const cardsToCheck = currentUser ?
                cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
                cardsData.cards;

            let matchingCards = [];

            // Search for matches using all payment search terms
            for (const term of payment.searchTerms) {
                const matches = findMatchingItem(term);
                if (matches && matches.length > 0) {
                    // For each matched item, calculate cashback for all cards
                    for (const card of cardsToCheck) {
                        const result = await calculateCardCashback(card, term, 1000); // Use 1000 as dummy amount
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

    modal.style.display = 'flex';
    disableBodyScroll();
}

// Load user payments
// Load user's selected payments from Firestore (with localStorage fallback)
async function loadUserPayments() {
    if (!currentUser) {
        console.log('No current user, showing no payments by default');
        userSelectedPayments = new Set();
        return;
    }

    try {
        // Try to load from Firestore first
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
    if (!currentUser) return;

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
    loadUserCustomOptions().then(customOpts => {
        tempCustomOptions = customOpts || [];
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
    const tag = document.createElement('div');
    tag.className = 'tag-item';
    tag.dataset.optionId = option.id || option.displayName;
    tag.dataset.isCustom = option.isCustom ? 'true' : 'false';

    // 構建icon HTML（如果有的話）
    const iconHtml = option.icon ? `<span class="tag-icon">${option.icon}</span>` : '';

    if (type === 'selected') {
        tag.draggable = true;
        tag.dataset.index = index;
        tag.innerHTML = `
            ${iconHtml}
            <span class="tag-name">${option.displayName}</span>
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

    return tag;
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

    if (draggedElement !== e.target && e.target.classList.contains('tag-item')) {
        const fromIndex = parseInt(draggedElement.dataset.index);
        const toIndex = parseInt(e.target.dataset.index);

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
    if (e.target.classList.contains('tag-remove-btn') || e.target.classList.contains('tag-add-btn')) {
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
        resetBtn.onclick = async () => {
            await resetQuickOptionsToDefault();
            modal.style.display = 'none';
            enableBodyScroll();
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
    // Save selected options
    const saved = await saveUserQuickSearchOptions(tempSelectedOptions);

    // Save custom options
    await saveUserCustomOptions(tempCustomOptions);

    if (saved) {
        // Update current options
        quickSearchOptions = tempSelectedOptions;

        // Re-render buttons
        renderQuickSearchButtons();

        console.log('✅ 快捷選項已更新');
    } else {
        console.error('❌ 保存快捷選項失敗');
        alert('保存失敗，請稍後再試');
    }
}

// Custom options management
async function loadUserCustomOptions() {
    try {
        if (currentUser && db) {
            const userDoc = await window.getDoc(window.doc(db, 'users', currentUser.uid));
            if (userDoc.exists() && userDoc.data().customQuickOptions) {
                return userDoc.data().customQuickOptions;
            }
        }
        const stored = localStorage.getItem('userCustomQuickOptions');
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (error) {
        console.error('載入自訂快捷選項時出錯:', error);
    }
    return [];
}

async function saveUserCustomOptions(customOptions) {
    try {
        if (currentUser && db) {
            await window.setDoc(window.doc(db, 'users', currentUser.uid), {
                customQuickOptions: customOptions
            }, { merge: true });
        }
        localStorage.setItem('userCustomQuickOptions', JSON.stringify(customOptions));
        return true;
    } catch (error) {
        console.error('保存自訂快捷選項時出錯:', error);
        return false;
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
        const item = document.createElement('div');
        item.className = 'custom-option-item';

        // 構建icon HTML（如果有的話）
        const iconHtml = option.icon ? `<span class="tag-icon">${option.icon}</span>` : '';

        item.innerHTML = `
            ${iconHtml}
            <span class="tag-name">${option.displayName}</span>
            <button class="custom-option-delete" title="刪除">×</button>
        `;

        const deleteBtn = item.querySelector('.custom-option-delete');
        deleteBtn.onclick = () => {
            deleteCustomOption(option);
        };

        container.appendChild(item);
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

async function resetQuickOptionsToDefault() {
    const defaultOptions = getDefaultQuickSearchOptions();

    // Clear user customization
    try {
        if (currentUser && db) {
            await window.setDoc(window.doc(db, 'users', currentUser.uid), {
                quickSearchOptions: null
            }, { merge: true });
        }
        localStorage.removeItem('userQuickSearchOptions');

        // Update current options
        quickSearchOptions = defaultOptions;

        // Re-render buttons
        renderQuickSearchButtons();

        console.log('✅ 快捷選項已恢復為預設');
    } catch (error) {
        console.error('恢復預設快捷選項時出錯:', error);
        alert('恢復預設失敗，請稍後再試');
    }
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
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
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
    
                    // Convert to blob with compression
                    canvas.toBlob((blob) => {
                        resolve(blob);
                    }, file.type, 0.85); // 85% quality
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
            // Upload images to Firebase Storage
            const imageUrls = [];
    
            if (selectedImages.length > 0) {
                for (let i = 0; i < selectedImages.length; i++) {
                    const imgData = selectedImages[i];
                    showStatus('loading', `正在上傳圖片 ${i + 1}/${selectedImages.length}...`);
    
                    // Compress image
                    const compressedBlob = await compressImage(imgData.file);
    
                    // Generate unique filename
                    const timestamp = Date.now();
                    const userId = currentUser?.uid || 'anonymous';
                    const filename = `feedback/${timestamp}_${userId}_${i}.jpg`;
    
                    // Upload to Firebase Storage
                    const storageReference = window.storageRef(window.storage, filename);
                    await window.uploadBytes(storageReference, compressedBlob);
    
                    // Get download URL
                    const downloadUrl = await window.getDownloadURL(storageReference);
                    imageUrls.push(downloadUrl);
                }
            }
    
            // Save to Firestore
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
    
            await window.addDoc(window.collection(window.db, 'feedback'), feedbackData);
    
            // Success
            showStatus('success', '✅ 回報已送出，感謝您的回饋！');
    
            // Reset form after 2 seconds
            setTimeout(() => {
                closeFeedbackModalHandler();
            }, 2000);
    
        } catch (error) {
            console.error('Error submitting feedback:', error);
            showStatus('error', '❌ 送出失敗，請稍後再試');
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





