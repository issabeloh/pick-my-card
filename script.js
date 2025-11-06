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
});

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
    calculateBtn.addEventListener('click', calculateCashback);
    
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
    '台灣行動支付': '台灣pay',
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
    // Add uber eats variations
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
    'IKEA宜家家居': 'ikea'
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

    let results;
    let isBasicCashback = false;

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
    
    // Sort by cashback amount (highest first)
    results.sort((a, b) => b.cashbackAmount - a.cashbackAmount);
    
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
    displayCouponCashbacks(amount, merchantValue);
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

                for (const variant of searchVariants) {
                    let exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);
                    // Note: We don't check hideInDisplay here because hidden rates should still be searchable
                    if (exactMatch && rateGroup.rate > bestRate) {
                        bestRate = rateGroup.rate;
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
                            console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}" (${rateGroup.rate}%)`);
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
        // Check exact matches for all search variants
        for (const rateGroup of card.cashbackRates) {
            // Check all search variants against all items in the rate group
            for (const variant of searchVariants) {
                let exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);
                if (exactMatch && rateGroup.rate > bestRate) {
                    bestRate = rateGroup.rate;
                    applicableCap = rateGroup.cap;
                    matchedItem = exactMatch;
                    matchedCategory = rateGroup.category || null;
                    matchedRateGroup = rateGroup;
                }
            }
        }
    }

    // 如果卡片有分級且不是 CUBE 卡，使用級別設定覆蓋回饋率和上限
    if (card.hasLevels && !card.specialItems && bestRate > 0) {
        const defaultLevel = Object.keys(card.levelSettings)[0];
        const savedLevel = await getCardLevel(card.id, defaultLevel);
        const levelData = card.levelSettings[savedLevel];

        bestRate = levelData.rate;
        applicableCap = levelData.cap || null;
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
        // Do NOT add basicCashback on top unless it's a special case with domesticBonusRate
        specialCashback = Math.floor(effectiveSpecialAmount * bestRate / 100);

        // Only handle additional bonus rates that are truly additive (like 永豐幣倍 domestic bonus)
        let bonusRate = 0;
        let bonusCashback = 0;

        // Handle special cards like 永豐幣倍 with separate domestic bonus
        if (card.domesticBonusRate && card.domesticBonusCap && matchedItem !== '海外') {
            bonusRate = card.domesticBonusRate;
            let bonusAmount = Math.min(effectiveSpecialAmount, card.domesticBonusCap);
            bonusCashback = Math.floor(bonusAmount * bonusRate / 100);
        } else if (matchedItem === '海外' && card.overseasBonusRate && card.overseasBonusCap) {
            bonusRate = card.overseasBonusRate;
            let bonusAmount = Math.min(effectiveSpecialAmount, card.overseasBonusCap);
            bonusCashback = Math.floor(bonusAmount * bonusRate / 100);
        }
        
        // Handle remaining amount if capped (excess amount gets basic cashback only)
        let remainingCashback = 0;
        if (applicableCap && amount > applicableCap) {
            const remainingAmount = amount - applicableCap;
            // Remaining amount only gets basic cashback rate
            remainingCashback = Math.floor(remainingAmount * card.basicCashback / 100);

            // Add bonus for remaining amount if still under bonus cap
            if (bonusRate > 0) {
                let remainingBonusAmount = remainingAmount;
                if (matchedItem === '海外' && card.overseasBonusCap) {
                    const usedBonus = Math.min(effectiveSpecialAmount, card.overseasBonusCap);
                    const remainingBonusCapacity = Math.max(0, card.overseasBonusCap - usedBonus);
                    remainingBonusAmount = Math.min(remainingAmount, remainingBonusCapacity);
                } else if (card.domesticBonusCap) {
                    const usedBonus = Math.min(effectiveSpecialAmount, card.domesticBonusCap);
                    const remainingBonusCapacity = Math.max(0, card.domesticBonusCap - usedBonus);
                    remainingBonusAmount = Math.min(remainingAmount, remainingBonusCapacity);
                }
                remainingCashback += Math.floor(remainingBonusAmount * bonusRate / 100);
            }
        }

        // Total cashback = special rate amount + bonus amount + remaining basic amount
        cashbackAmount = specialCashback + bonusCashback + remainingCashback;

        // Total rate is already in bestRate (no need to add basicRate)
        // Only add bonusRate if it's truly additive
        totalRate = Math.round((bestRate + bonusRate) * 10) / 10;
        effectiveAmount = applicableCap; // Keep this for display purposes
    }
    
    return {
        rate: Math.round(totalRate * 10) / 10,
        specialRate: Math.round(bestRate * 10) / 10,
        basicRate: Math.round(card.basicCashback * 10) / 10,
        cashbackAmount: cashbackAmount,
        cap: applicableCap,
        matchedItem: matchedItem,
        matchedCategory: matchedCategory,
        effectiveAmount: effectiveAmount,
        matchedRateGroup: matchedRateGroup,
        selectedLevel: selectedLevel // Pass selected level to display
    };
}

// Display calculation results
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
    
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Display coupon cashback results
function displayCouponCashbacks(amount, merchantValue) {
    couponResultsContainer.innerHTML = '';
    
    // Get cards to check (user selected or all)
    const cardsToCheck = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    // Collect all coupon cashbacks that match the merchant
    const matchingCoupons = [];
    
    cardsToCheck.forEach(card => {
        if (card.couponCashbacks) {
            card.couponCashbacks.forEach(coupon => {
                const merchantLower = merchantValue.toLowerCase();
                const couponMerchantLower = coupon.merchant.toLowerCase();
                
                // Check if merchant matches coupon merchant
                if (merchantLower.includes(couponMerchantLower) || 
                    couponMerchantLower.includes(merchantLower)) {
                    matchingCoupons.push({
                        ...coupon,
                        cardName: card.name,
                        cardId: card.id,
                        potentialCashback: Math.floor(amount * coupon.rate / 100)
                    });
                }
            });
        }
    });
    
    // If no matching coupons, hide the section
    if (matchingCoupons.length === 0) {
        couponResultsSection.style.display = 'none';
        return;
    }
    
    // Sort by cashback rate (highest first)
    matchingCoupons.sort((a, b) => b.rate - a.rate);
    
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
    
    couponDiv.innerHTML = `
        <div class="coupon-header">
            <div class="coupon-merchant">${coupon.cardName}</div>
            <div class="coupon-rate">${coupon.rate}%</div>
        </div>
        <div class="coupon-details">
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">回饋金額:</div>
                <div class="coupon-detail-value">NT$${coupon.potentialCashback.toLocaleString()}</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">回饋消費上限:</div>
                <div class="coupon-detail-value">無上限</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">回饋條件:</div>
                <div class="coupon-detail-value">${coupon.conditions}</div>
            </div>
            <div class="coupon-detail-row">
                <div class="coupon-detail-label">活動期間:</div>
                <div class="coupon-detail-value">${coupon.period}</div>
            </div>
        </div>
        <div class="coupon-card-name">匹配項目: ${coupon.merchant}</div>
    `;
    
    return couponDiv;
}

// Create card result element
function createCardResultElement(result, originalAmount, searchedItem, isBest, isBasicCashback = false) {
    const cardDiv = document.createElement('div');
    cardDiv.className = `card-result fade-in ${isBest ? 'best-card' : ''} ${result.cashbackAmount === 0 ? 'no-cashback' : ''}`;
    
    let capText = result.cap ? `NT$${result.cap.toLocaleString()}` : '無上限';
    // Special handling for Taishin Richart card cap display
    if (result.card.id === 'taishin-richart' && result.cap) {
        capText = `NT$${result.cap.toLocaleString()}+`;
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
            ${isBest ? '<div class="best-badge">最優回饋</div>' : ''}
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
                if (result.matchedRateGroup) {
                    const period = result.matchedRateGroup.period;
                    const conditions = result.matchedRateGroup.conditions;
                    
                    if (period) additionalInfo += `<br><small>活動期間: ${period}</small>`;
                    if (conditions) additionalInfo += `<br><small>條件: ${conditions}</small>`;
                }
                
                const categoryInfo = result.matchedCategory ? ` (類別: ${result.matchedCategory})` : '';
                
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
            initializeAuth();
        } else {
            setTimeout(checkFirebaseReady, 100);
        }
    };
    checkFirebaseReady();
}

function initializeAuth() {
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
    
    // Listen for authentication state changes
    window.onAuthStateChanged(auth, async (user) => {
        if (user) {
            // User is signed in
            console.log('User signed in:', user);
            currentUser = user;
            signInBtn.style.display = 'none';
            userInfo.style.display = 'inline-flex';

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

// Save user's selected cards to localStorage
function saveUserCards() {
    if (!currentUser) {
        console.log('No user logged in, skipping save');
        return;
    }
    
    try {
        const storageKey = `selectedCards_${currentUser.uid}`;
        localStorage.setItem(storageKey, JSON.stringify(Array.from(userSelectedCards)));
        console.log('Saved user cards to localStorage:', Array.from(userSelectedCards));
    } catch (error) {
        console.error('Error saving user cards to localStorage:', error);
        throw error;
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
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    // Save cards
    saveBtn.addEventListener('click', () => {
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
        saveUserCards();
        
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

    // Setup search functionality
    const searchInput = document.getElementById('search-cards-input');
    searchInput.value = ''; // Clear search on open
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const cardDivs = cardsSelection.querySelectorAll('.card-checkbox');

        cardDivs.forEach(cardDiv => {
            const label = cardDiv.querySelector('.card-checkbox-label');
            if (label) {
                const cardName = label.textContent.toLowerCase();
                if (cardName.includes(searchTerm)) {
                    cardDiv.style.display = 'flex';
                } else {
                    cardDiv.style.display = 'none';
                }
            }
        });
    });

    modal.style.display = 'flex';
}

// Show card detail modal
async function showCardDetail(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    if (!card) return;
    
    const modal = document.getElementById('card-detail-modal');
    
    // Update basic information
    document.getElementById('card-detail-title').textContent = card.name + ' 詳情';
    
    const fullNameLink = document.getElementById('card-full-name-link');
    fullNameLink.textContent = card.fullName || card.name;
    if (card.website) {
        fullNameLink.href = card.website;
    } else {
        fullNameLink.removeAttribute('href');
        fullNameLink.style.textDecoration = 'none';
        fullNameLink.style.color = 'inherit';
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
                levelNote = '<span id="level-note" style="font-size: 11px; color: #9ca3af; margin-left: 8px;">需同時持有星展帳戶且資產達NT$30萬連續4個月</span>';
            } else if (savedLevel === '豐盛理財客戶/豐盛理財私人客戶') {
                levelNote = '<span id="level-note" style="font-size: 11px; color: #9ca3af; margin-left: 8px;">需星展總資產達NT$300萬/NT$3000萬連續4個月</span>';
            } else {
                levelNote = '<span id="level-note" style="font-size: 11px; color: #9ca3af; margin-left: 8px;"></span>';
            }
        }

        let levelSelectorHTML = `
            <div class="level-selector" style="margin-bottom: 16px;">
                <label style="font-weight: 600; margin-right: 8px;">選擇級別：</label>
                <select id="card-level-select" style="padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                    ${levelNames.map(level =>
                        `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                    ).join('')}
                </select>
                ${levelNote}
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
            const sortedRates = [...card.cashbackRates]
                .filter(rate => !rate.hideInDisplay)
                .sort((a, b) => b.rate - a.rate);

            sortedRates.forEach((rate, index) => {
                specialContent += `<div class="cashback-detail-item">`;

                // Display rate with category in parentheses
                const categoryLabel = rate.category ? ` (${rate.category})` : '';
                specialContent += `<div class="cashback-rate">${rate.rate}% 回饋${categoryLabel}</div>`;

                // Use cap from rate
                if (rate.cap) {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${rate.cap.toLocaleString()}</div>`;
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
                    const merchantsId = `merchants-${card.id}-rate-${index}`;
                    const showAllId = `show-all-${card.id}-rate-${index}`;

                    if (rate.items.length <= 20) {
                        const merchantsList = rate.items.join('、');
                        specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = rate.items.slice(0, 20).join('、');
                        const fullList = rate.items.join('、');

                        specialContent += `<div class="cashback-merchants">`;
                        specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">… 顯示全部${rate.items.length}個</button>`;
                        specialContent += `</div>`;
                    }
                }

                specialContent += `</div>`;
            });
        }

        // Then display the level-based cashback with specialItems
        specialContent += `<div class="cashback-detail-item">`;
        specialContent += `<div class="cashback-rate">${levelData.rate}% 回饋 (${savedLevel})</div>`;
        if (levelData.cap) {
            specialContent += `<div class="cashback-condition">消費上限: NT$${levelData.cap.toLocaleString()}</div>`;
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

        // Show all level options for reference with special formatting for DBS Eco card
        if (levelNames.length > 1) {
            specialContent += `<div class="cashback-condition" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">各級別回饋率：</div>`;

            // Special formatting for DBS Eco card
            if (card.id === 'dbs-eco') {
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    if (level === '一般卡友') {
                        specialContent += `<div class="cashback-merchants" style="font-size: 11px; color: #6b7280;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap?.toLocaleString() || '無'})</div>`;
                    } else if (level === '精選卡友') {
                        specialContent += `<div class="cashback-merchants" style="font-size: 11px; color: #6b7280;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap?.toLocaleString() || '無'}；加碼 1.8% 上限為 NT$ 50,000)</div>`;
                    } else if (level === '豐盛理財客戶/豐盛理財私人客戶') {
                        specialContent += `<div class="cashback-merchants" style="font-size: 11px; color: #6b7280;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap?.toLocaleString() || '無'}；加碼 4.8% 上限為 NT$ 37,500)</div>`;
                    } else {
                        specialContent += `<div class="cashback-merchants" style="font-size: 11px; color: #6b7280;">• ${level}: ${data.rate}% (上限 NT$${data.cap?.toLocaleString() || '無'})</div>`;
                    }
                });
            } else {
                // Default formatting for other cards
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    specialContent += `<div class="cashback-merchants" style="font-size: 13px; color: #6b7280;">• ${level}: ${data.rate}% (上限 NT$${data.cap?.toLocaleString() || '無'})</div>`;
                });
            }
        }

        specialContent += `</div>`;
    } else if (card.hasLevels && !card.specialItems) {
        // Handle level-based cards without specialItems
        const levelNames = Object.keys(card.levelSettings);
        const savedLevel = await getCardLevel(card.id, levelNames[0]);
        const levelData = card.levelSettings[savedLevel];

        // Check if card also has cashbackRates (like DBS Eco card)
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            // Display cashbackRates with level-based cap
            const sortedRates = [...card.cashbackRates]
                .filter(rate => !rate.hideInDisplay)
                .sort((a, b) => b.rate - a.rate);

            sortedRates.forEach((rate, index) => {
                specialContent += `<div class="cashback-detail-item">`;

                // Display rate with category in parentheses
                const categoryLabel = rate.category ? ` (${rate.category})` : '';
                specialContent += `<div class="cashback-rate">${rate.rate}% 回饋${categoryLabel}</div>`;

                // Use cap from rate if available, otherwise from levelData
                const cap = rate.cap || levelData.cap;
                if (cap) {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${cap.toLocaleString()}</div>`;
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

                    if (rate.items.length <= 20) {
                        const merchantsList = rate.items.join('、');
                        specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = rate.items.slice(0, 20).join('、');
                        const fullList = rate.items.join('、');

                        specialContent += `<div class="cashback-merchants">`;
                        specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">… 顯示全部${rate.items.length}個</button>`;
                        specialContent += `</div>`;
                    }
                }

                specialContent += `</div>`;
            });

            // Show all level options for reference with special formatting for DBS Eco card
            if (levelNames.length > 1) {
                specialContent += `<div class="cashback-detail-item">`;
                specialContent += `<div class="cashback-condition" style="margin-top: 0; padding-top: 0; border-top: none;">各級別回饋率：</div>`;

                // Special formatting for DBS Eco card
                if (card.id === 'dbs-eco') {
                    levelNames.forEach(level => {
                        const data = card.levelSettings[level];
                        if (level === '一般卡友') {
                            specialContent += `<div class="cashback-merchants" style="font-size: 11px; color: #6b7280;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap?.toLocaleString() || '無'})</div>`;
                        } else if (level === '精選卡友') {
                            specialContent += `<div class="cashback-merchants" style="font-size: 11px; color: #6b7280;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap?.toLocaleString() || '無'}；加碼 1.8% 上限為 NT$ 50,000)</div>`;
                        } else if (level === '豐盛理財客戶/豐盛理財私人客戶') {
                            specialContent += `<div class="cashback-merchants" style="font-size: 11px; color: #6b7280;">• ${level}: ${data.rate}% (其中加碼 3.8% 的上限為 NT$${data.cap?.toLocaleString() || '無'}；加碼 4.8% 上限為 NT$ 37,500)</div>`;
                        } else {
                            specialContent += `<div class="cashback-merchants" style="font-size: 11px; color: #6b7280;">• ${level}: ${data.rate}% (上限 NT$${data.cap?.toLocaleString() || '無'})</div>`;
                        }
                    });
                } else {
                    // Default formatting for other cards
                    levelNames.forEach(level => {
                        const data = card.levelSettings[level];
                        specialContent += `<div class="cashback-merchants" style="font-size: 13px; color: #6b7280;">• ${level}: ${data.rate}% (上限 NT$${data.cap?.toLocaleString() || '無'})</div>`;
                    });
                }

                specialContent += `</div>`;
            }
        } else {
            // Original logic for cards without cashbackRates
            specialContent += `<div class="cashback-detail-item">`;
            specialContent += `<div class="cashback-rate">${levelData.rate}% 回饋 (${savedLevel})</div>`;
            if (levelData.cap) {
                specialContent += `<div class="cashback-condition">消費上限: NT$${levelData.cap.toLocaleString()}</div>`;
            } else {
                specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // Show all level options for reference
            specialContent += `<div class="cashback-condition" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">各級別回饋率：</div>`;
            levelNames.forEach(level => {
                const data = card.levelSettings[level];
                specialContent += `<div class="cashback-merchants" style="font-size: 13px; color: #6b7280;">• ${level}: ${data.rate}% (上限 NT$${data.cap?.toLocaleString() || '無'})</div>`;
            });

            specialContent += `</div>`;
        }
    } else if (card.cashbackRates && card.cashbackRates.length > 0) {
        // Sort rates by percentage in descending order
        const sortedRates = [...card.cashbackRates]
            .filter(rate => !rate.hideInDisplay)
            .sort((a, b) => b.rate - a.rate);
            
        sortedRates.forEach((rate, index) => {
            specialContent += `<div class="cashback-detail-item">`;

            // Display rate with category in parentheses (like Cube card style)
            const categoryLabel = rate.category ? ` (${rate.category})` : '';
            specialContent += `<div class="cashback-rate">${rate.rate}% 回饋${categoryLabel}</div>`;

            // 消費上限
            if (rate.cap) {
                if (rate.capDescription && card.id === 'taishin-richart') {
                    specialContent += `<div class="cashback-condition">消費上限: ${rate.capDescription}</div>`;
                } else {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${rate.cap.toLocaleString()}</div>`;
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
        });
    } else {
        specialContent = '<div class="cashback-detail-item">無指定通路回饋</div>';
    }
    
    specialCashbackDiv.innerHTML = specialContent;
    
    // Update coupon cashback
    const couponSection = document.getElementById('card-coupon-section');
    const couponCashbackDiv = document.getElementById('card-coupon-cashback');
    
    if (card.couponCashbacks && card.couponCashbacks.length > 0) {
        let couponContent = '';
        card.couponCashbacks.forEach(coupon => {
            couponContent += `<div class="cashback-detail-item">`;
            couponContent += `<div class="cashback-rate">${coupon.merchant}: ${coupon.rate}% 回饋</div>`;
            couponContent += `<div class="cashback-condition">條件: ${coupon.conditions}</div>`;
            couponContent += `<div class="cashback-condition">活動期間: ${coupon.period}</div>`;
            couponContent += `</div>`;
        });
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
    
    // Setup close events
    const closeBtn = document.getElementById('close-card-detail');
    const closeModal = () => {
        modal.style.display = 'none';
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
    
    // 1. 童樂匯 10% 回饋 (固定最高)
    const childrenRate10 = card.cashbackRates?.find(rate => rate.rate === 10.0 && rate.category === '童樂匯');
    if (childrenRate10) {
        content += `<div class="cashback-detail-item">`;
        content += `<div class="cashback-rate">10% 回饋 (童樂匯)</div>`;
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
    
    // 2. 童樂匯 5% 回饋
    const childrenRate5 = card.cashbackRates?.find(rate => rate.rate === 5.0 && rate.category === '童樂匯');
    if (childrenRate5) {
        content += `<div class="cashback-detail-item">`;
        content += `<div class="cashback-rate">5% 回饋 (童樂匯)</div>`;
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
                content += `<div class="cashback-rate">${specialRate}% 回饋 (${category})</div>`;
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
    
    // 4. 集精選和來支付 (2%) - 放在最後
    if (card.generalItems) {
        Object.entries(card.generalItems).forEach(([category, items]) => {
            content += `<div class="cashback-detail-item">`;
            content += `<div class="cashback-rate">2% 回饋 (${category})</div>`;
            content += `<div class="cashback-condition">消費上限: 無上限</div>`;
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${items.join('、')}</div>`;
            content += `</div>`;
        });
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

// 將toggleMerchants暴露到全局作用域，確保onclick可以訪問
window.toggleMerchants = toggleMerchants;

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
    if (!auth.currentUser) {
        // 未登入用戶
        const localData = localStorage.getItem('spendingMappings');
        userSpendingMappings = localData ? JSON.parse(localData) : [];
        return userSpendingMappings;
    }

    try {
        const docRef = window.doc ? window.doc(db, 'spendingMappings', auth.currentUser.uid) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');

        const docSnap = await window.getDoc(docRef);
        const mappings = docSnap.exists() ? docSnap.data().mappings : [];

        // 更新本地快取
        localStorage.setItem(`spendingMappings_${auth.currentUser.uid}`, JSON.stringify(mappings));
        userSpendingMappings = mappings;

        return mappings;
    } catch (error) {
        console.log('讀取配卡表失敗，使用本地快取:', error);
        const localData = localStorage.getItem(`spendingMappings_${auth.currentUser.uid}`);
        userSpendingMappings = localData ? JSON.parse(localData) : [];
        return userSpendingMappings;
    }
}

// 保存用戶的消費配卡表
async function saveSpendingMappings(mappings) {
    userSpendingMappings = mappings;

    if (!auth.currentUser) {
        // 未登入用戶只保存在本地
        localStorage.setItem('spendingMappings', JSON.stringify(mappings));
        return true;
    }

    try {
        // 保存到本地快取
        localStorage.setItem(`spendingMappings_${auth.currentUser.uid}`, JSON.stringify(mappings));

        // 保存到 Firestore
        const docRef = window.doc ? window.doc(db, 'spendingMappings', auth.currentUser.uid) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');

        await window.setDoc(docRef, {
            mappings: mappings,
            updatedAt: new Date()
        });

        return true;
    } catch (error) {
        console.error('雲端儲存配卡表失敗:', error);
        // 失敗時仍然保存在本地
        localStorage.setItem(`spendingMappings_${auth.currentUser.uid}`, JSON.stringify(mappings));
        return false;
    }
}

// 添加配對
async function addMapping(cardId, cardName, merchant, cashbackRate) {
    if (!auth.currentUser) {
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

    userSpendingMappings.push(newMapping);
    await saveSpendingMappings(userSpendingMappings);

    return newMapping;
}

// 刪除配對
async function removeMapping(mappingId) {
    userSpendingMappings = userSpendingMappings.filter(m => m.id !== mappingId);
    await saveSpendingMappings(userSpendingMappings);
}

// 檢查是否已釘選
function isPinned(cardId, merchant) {
    return userSpendingMappings.some(m =>
        m.cardId === cardId && m.merchant === merchant
    );
}

// 切換釘選狀態
async function togglePin(button, cardId, cardName, merchant, rate) {
    if (!auth.currentUser) {
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
        }
    } else {
        // 釘選
        await addMapping(cardId, cardName, merchant, rate);
        button.classList.add('pinned');
        button.title = '取消釘選';

        // 顯示成功動畫
        showPinSuccessAnimation(button);
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

    // 綁定關閉按鈕
    const closeBtn = document.getElementById('close-mappings-modal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }

    // 點擊背景關閉
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
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
                await removeMapping(mappingId);
                renderMappingsList(document.getElementById('mappings-search')?.value || '');

                // 更新結果卡片的釘選狀態（如果結果還在顯示）
                updatePinButtonsState();
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
    if (!auth.currentUser) return false;
    
    try {
        const docRef = window.doc ? window.doc(db, 'feeWaiverStatus', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        return docSnap.exists() ? docSnap.data().isWaived : false;
    } catch (error) {
        console.log('讀取免年費狀態失敗:', error);
        const localKey = `feeWaiver_${auth.currentUser?.uid || 'local'}_${cardId}`;
        return localStorage.getItem(localKey) === 'true';
    }
}

// 儲存免年費狀態
async function saveFeeWaiverStatus(cardId, isWaived) {
    const localKey = `feeWaiver_${auth.currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, isWaived.toString());
    
    if (!auth.currentUser) return;
    
    try {
        const docRef = window.doc ? window.doc(db, 'feeWaiverStatus', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            isWaived: isWaived,
            updatedAt: new Date(),
            cardId: cardId
        });
        console.log('免年費狀態已同步至雲端');
    } catch (error) {
        console.error('雲端儲存免年費狀態失敗:', error);
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
    
    if (!auth.currentUser) {
        const localKey = `billingDates_local_${cardId}`;
        const saved = localStorage.getItem(localKey);
        return saved ? JSON.parse(saved) : defaultDates;
    }
    
    try {
        const docRef = window.doc ? window.doc(db, 'billingDates', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                billingDate: data.billingDate || '',
                statementDate: data.statementDate || ''
            };
        }
        return defaultDates;
    } catch (error) {
        console.log('讀取結帳日期失敗:', error);
        const localKey = `billingDates_${auth.currentUser?.uid || 'local'}_${cardId}`;
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
    
    const localKey = `billingDates_${auth.currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, JSON.stringify(dateData));
    
    if (!auth.currentUser) return;
    
    try {
        const docRef = window.doc ? window.doc(db, 'billingDates', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            ...dateData,
            updatedAt: new Date(),
            cardId: cardId
        });
        console.log('結帳日期已同步至雲端');
    } catch (error) {
        console.error('雲端儲存結帳日期失敗:', error);
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

            let capText = mc.cap ? `NT$${mc.cap.toLocaleString()}` : '無上限';
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
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    modal.style.display = 'flex';
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
                    let capText = mc.cap ? `NT$${mc.cap.toLocaleString()}` : '無上限';
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
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    modal.style.display = 'flex';
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
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeOption(option);
        };

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
        addBtn.onclick = (e) => {
            e.stopPropagation();
            addOption(option);
        };
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
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCustomOptionForm();
            modal.style.display = 'none';
        };
    }

    if (saveBtn) {
        saveBtn.onclick = async () => {
            await saveQuickOptionsSelection();
            hideCustomOptionForm();
            modal.style.display = 'none';
        };
    }

    if (resetBtn) {
        resetBtn.onclick = async () => {
            await resetQuickOptionsToDefault();
            modal.style.display = 'none';
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
    });
    
    // Close Feedback Modal
    function closeFeedbackModalHandler() {
        feedbackModal.style.display = 'none';
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

let authMode = 'login'; // 'login' or 'register'

function openAuthModal(mode = 'login') {
    authMode = mode;
    const modal = document.getElementById('auth-modal');
    const modalTitle = document.getElementById('auth-modal-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const switchText = document.getElementById('auth-switch-text');
    const confirmPasswordGroup = document.getElementById('auth-confirm-password-group');
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
        forgotPasswordLink.style.display = 'none';
    } else {
        modalTitle.textContent = '登入';
        submitBtn.textContent = '登入';
        switchText.innerHTML = '還沒有帳號？<a href="#" id="auth-switch-link">立即註冊</a>';
        confirmPasswordGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'inline-block';
    }

    modal.style.display = 'flex';

    // Re-attach event listener for switch link
    document.getElementById('auth-switch-link').addEventListener('click', (e) => {
        e.preventDefault();
        openAuthModal(authMode === 'login' ? 'register' : 'login');
    });
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'none';
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

            // Validation
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

    // Forgot password
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', async (e) => {
            e.preventDefault();

            const email = document.getElementById('auth-email').value.trim();

            if (!email) {
                showAuthError('請先輸入您的 Email');
                return;
            }

            try {
                await window.sendPasswordResetEmail(auth, email);
                showAuthError('✅ 密碼重設信已寄出，請檢查您的 Email');
            } catch (error) {
                console.error('Password reset error:', error);
                let errorMessage = '發送失敗，請稍後再試';

                if (error.code === 'auth/user-not-found') {
                    errorMessage = '找不到此 Email 帳號';
                } else if (error.code === 'auth/invalid-email') {
                    errorMessage = 'Email 格式不正確';
                }

                showAuthError(errorMessage);
            }
        });
    }
}); // End of Auth Modal DOMContentLoaded

