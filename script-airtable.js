// Global variables
let currentUser = null;
let userSelectedCards = new Set(); // Store user's selected card IDs
let auth = null;
let db = null;
let cardsData = null; // Will be loaded from Airtable

// Load cards data from Airtable API
async function loadCardsData() {
    try {
        console.log('🔄 開始載入Airtable資料...');
        
        // Load Cards data
        const cardsResponse = await fetch(getTableUrl(AIRTABLE_CONFIG.TABLES.CARDS), {
            headers: getApiHeaders()
        });
        
        if (!cardsResponse.ok) {
            throw new Error(`載入Cards資料失敗: ${cardsResponse.status} ${cardsResponse.statusText}`);
        }
        
        const cardsResult = await cardsResponse.json();
        console.log('✅ Cards資料載入成功:', cardsResult.records.length, '筆記錄');
        
        // Load CashbackRates data
        const ratesResponse = await fetch(getTableUrl(AIRTABLE_CONFIG.TABLES.CASHBACK_RATES), {
            headers: getApiHeaders()
        });
        
        if (!ratesResponse.ok) {
            throw new Error(`載入CashbackRates資料失敗: ${ratesResponse.status} ${ratesResponse.statusText}`);
        }
        
        const ratesResult = await ratesResponse.json();
        console.log('✅ CashbackRates資料載入成功:', ratesResult.records.length, '筆記錄');
        
        // Transform Airtable data to our format
        cardsData = transformAirtableData(cardsResult.records, ratesResult.records);
        console.log('✅ 資料轉換完成，共', cardsData.cards.length, '張信用卡');
        
        return true;
    } catch (error) {
        console.error('❌ 載入Airtable資料失敗:', error);
        showErrorMessage(`載入資料失敗: ${error.message}`);
        return false;
    }
}

// Transform Airtable data to our internal format
function transformAirtableData(cardsRecords, ratesRecords) {
    console.log('🔄 開始轉換資料格式...');
    
    const cards = cardsRecords.map(record => {
        const fields = record.fields;
        const cardId = fields['Card ID'];
        
        // Find all cashback rates for this card
        const cardRates = ratesRecords
            .filter(rateRecord => rateRecord.fields['Card ID'] === cardId)
            .map(rateRecord => {
                const rateFields = rateRecord.fields;
                return {
                    rate: rateFields['Rate'] || 0,
                    cap: rateFields['Cap'] || null,
                    capDescription: rateFields['Cap Description'] || null,
                    period: rateFields['Period'] || null,
                    category: rateFields['Category'] || null,
                    conditions: rateFields['Conditions'] || null,
                    items: rateFields['Items'] ? rateFields['Items'].split('、').map(item => item.trim()) : [],
                    notes: rateFields['Notes'] || null,
                    cashbackType: rateFields['Cashback Type'] || '現金回饋',
                    hideInDisplay: rateFields['Hide in Display'] || false
                };
            });
        
        // Build card object
        const card = {
            id: cardId,
            name: fields['Name'] || '',
            fullName: fields['Full Name'] || '',
            basicCashback: fields['Basic Cashback'] || 0,
            basicConditions: fields['Basic Conditions'] || null,
            annualFee: fields['Annual Fee'] || '',
            feeWaiver: fields['Fee Waiver'] || '',
            website: fields['Website'] || '',
            cashbackRates: cardRates.filter(rate => !rate.hideInDisplay),
            specialFeatures: fields['Special Features'] || null
        };
        
        // Handle special card features
        if (fields['Has Levels']) {
            card.hasLevels = true;
            // You can add level settings logic here if needed
        }
        
        if (fields['Overseas Cashback']) {
            card.overseasCashback = fields['Overseas Cashback'];
        }
        
        return card;
    });
    
    console.log('✅ 資料格式轉換完成');
    return { cards };
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
    console.log('🚀 應用程式初始化開始...');
    
    // Load cards data first
    const dataLoaded = await loadCardsData();
    if (!dataLoaded) {
        // If data loading fails, disable the app
        if (calculateBtn) calculateBtn.disabled = true;
        return;
    }
    
    populateCardChips();
    setupEventListeners();
    setupAuthentication();
    
    console.log('✅ 應用程式初始化完成');
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

// Setup event listeners
function setupEventListeners() {
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
}

// Handle merchant input changes
function handleMerchantInput() {
    const input = merchantInput.value.trim().toLowerCase();
    
    if (input.length === 0) {
        hideMatchedItem();
        currentMatchedItem = null;
        validateInputs();
        return;
    }
    
    // Find matching items (now returns array)
    const matchedItems = findMatchingItem(input);
    
    if (matchedItems && matchedItems.length > 0) {
        showMatchedItem(matchedItems);
        currentMatchedItem = matchedItems; // Now stores array of matches
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
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
    '7-11': '7-11',
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
    // 新增迪卡儂相關詞彙
    'decathlon': '迪卡儂',
    '迪卡儂': 'decathlon',
    // 新增宜家相關詞彙
    'ikea': 'IKEA宜家家居',
    '宜家': 'IKEA宜家家居',
    '宜家家居': 'IKEA宜家家居',
    'IKEA宜家家居': 'ikea',
    // Add Taiwan Pay special handling
    '台灣pay場域': '台灣Pay場域',
    'taiwan pay場域': '台灣Pay場域',
    '台灣Pay': '台灣Pay場域'
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
    
    let allMatches = [];
    
    // Helper function to check item matches
    const checkItemMatches = (items, searchTerms, searchLower, allMatches, searchTerm) => {
        for (const item of items) {
            const itemLower = item.toLowerCase();
            
            // Check if any search term matches this item
            let matchFound = false;
            let bestMatchTerm = searchLower;
            let isExactMatch = false;
            let isFullContainment = false;
            
                for (const term of searchTerms) {
                    // Prevent uber/uber eats cross matching with more precise logic
                    if (term === 'uber' && (itemLower.includes('uber eats') || itemLower.includes('ubereats'))) {
                        // Skip uber eats items when searching for 'uber'
                        continue;
                    }
                    if ((term === 'uber eats' || term === 'ubereats' || term === 'ubereat' || term === 'uber eat') && itemLower === 'uber') {
                        // Skip 'uber' item when searching for uber eats variants
                        continue;
                    }
                
                if (itemLower.includes(term) || term.includes(itemLower) || itemLower === term) {
                    matchFound = true;
                    if (itemLower === term) {
                        isExactMatch = true;
                        bestMatchTerm = term;
                        break;
                    }
                    if (itemLower.includes(term)) {
                        isFullContainment = true;
                        bestMatchTerm = term;
                    }
                }
            }
            
            if (matchFound) {
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
        // Check cashbackRates items
        for (const rateGroup of card.cashbackRates) {
            checkItemMatches(rateGroup.items, searchTerms, searchLower, allMatches, searchTerm);
        }
        
        // Check specialItems for CUBE card (if implemented)
        if (card.specialItems) {
            checkItemMatches(card.specialItems, searchTerms, searchLower, allMatches, searchTerm);
        }
        
        // Check generalItems for CUBE card (if implemented)
        if (card.generalItems) {
            for (const [category, items] of Object.entries(card.generalItems)) {
                checkItemMatches(items, searchTerms, searchLower, allMatches, searchTerm);
            }
        }
    }
    
    if (allMatches.length === 0) return null;
    
    // Remove duplicates (same item appearing in multiple cards)
    const uniqueMatches = [];
    const seenItems = new Set();
    for (const match of allMatches) {
        if (!seenItems.has(match.itemLower)) {
            seenItems.add(match.itemLower);
            uniqueMatches.push(match);
        }
    }
    
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
            const itemList = matchedItems.map(item => item.originalItem).join('、');
            matchedItemDiv.innerHTML = `✓ 系統匹配到 ${matchedItems.length} 項: <strong>${itemList}</strong>`;
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
    matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>沒有任何匹配的項目，以下結果顯示基本回饋</strong>`;
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
function calculateCashback() {
    if (!cardsData) {
        return;
    }
    
    console.log('🧮 開始計算回饋...');
    const amount = parseFloat(amountInput.value);
    const merchantValue = merchantInput.value.trim();
    
    let results;
    let isBasicCashback = false;
    
    // Get cards to compare (user selected or all)
    const cardsToCompare = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    if (currentMatchedItem) {
        // User input matched specific items - show special cashback rates
        results = calculateSpecialCashback(amount, currentMatchedItem, cardsToCompare);
        console.log('✅ 特殊回饋計算完成');
    } else {
        // No match - show basic cashback rates
        results = calculateBasicCashback(amount, cardsToCompare);
        isBasicCashback = true;
        showNoMatchMessage();
        console.log('✅ 基本回饋計算完成');
    }
    
    displayResults(results, isBasicCashback);
}

// Calculate special cashback based on matched items
function calculateSpecialCashback(amount, matchedItems, cards) {
    const results = [];
    
    for (const card of cards) {
        let bestRate = { rate: card.basicCashback, cap: null, items: ['一般消費'], source: 'basic' };
        
        // Check each matched item
        if (Array.isArray(matchedItems)) {
            for (const matchedItem of matchedItems) {
                const itemName = matchedItem.originalItem;
                
                // Check each cashback rate group
                for (const rateGroup of card.cashbackRates) {
                    if (rateGroup.items.some(item => item.toLowerCase() === itemName.toLowerCase())) {
                        if (rateGroup.rate > bestRate.rate) {
                            bestRate = {
                                rate: rateGroup.rate,
                                cap: rateGroup.cap,
                                items: [itemName],
                                conditions: rateGroup.conditions,
                                period: rateGroup.period,
                                category: rateGroup.category,
                                source: 'special'
                            };
                        }
                    }
                }
            }
        }
        
        const cashbackAmount = calculateCashbackAmount(amount, bestRate.rate, bestRate.cap);
        
        results.push({
            card: card,
            rate: bestRate.rate,
            cap: bestRate.cap,
            cashback: cashbackAmount.amount,
            effectiveRate: cashbackAmount.effectiveRate,
            items: bestRate.items,
            conditions: bestRate.conditions,
            period: bestRate.period,
            category: bestRate.category,
            source: bestRate.source,
            isMaxCap: cashbackAmount.isMaxCap
        });
    }
    
    // Sort by cashback amount (descending)
    results.sort((a, b) => b.cashback - a.cashback);
    
    return results;
}

// Calculate basic cashback for all cards
function calculateBasicCashback(amount, cards) {
    const results = [];
    
    for (const card of cards) {
        const cashbackAmount = calculateCashbackAmount(amount, card.basicCashback, null);
        
        results.push({
            card: card,
            rate: card.basicCashback,
            cap: null,
            cashback: cashbackAmount.amount,
            effectiveRate: cashbackAmount.effectiveRate,
            items: ['一般消費'],
            conditions: card.basicConditions,
            source: 'basic',
            isMaxCap: false
        });
    }
    
    // Sort by cashback amount (descending)
    results.sort((a, b) => b.cashback - a.cashback);
    
    return results;
}

// Calculate cashback amount considering caps
function calculateCashbackAmount(amount, rate, cap) {
    const baseAmount = amount * (rate / 100);
    
    if (cap && baseAmount > cap) {
        return {
            amount: cap,
            effectiveRate: (cap / amount) * 100,
            isMaxCap: true
        };
    }
    
    return {
        amount: baseAmount,
        effectiveRate: rate,
        isMaxCap: false
    };
}

// Display results
function displayResults(results, isBasicCashback) {
    resultsContainer.innerHTML = '';
    
    if (results.length === 0) {
        resultsContainer.innerHTML = '<p>沒有找到適合的信用卡資料。</p>';
        resultsSection.style.display = 'block';
        return;
    }
    
    results.forEach((result, index) => {
        const resultCard = createResultCard(result, index);
        resultsContainer.appendChild(resultCard);
    });
    
    resultsSection.style.display = 'block';
    console.log('✅ 結果顯示完成');
}

// Create result card HTML
function createResultCard(result, index) {
    const div = document.createElement('div');
    div.className = `result-card ${index === 0 ? 'best-result' : ''}`;
    
    const rankBadge = index === 0 ? '<span class="rank-badge">最佳</span>' : `<span class="rank-number">#${index + 1}</span>`;
    
    const conditionsHtml = result.conditions ? 
        `<div class="result-conditions">條件: ${result.conditions}</div>` : '';
    
    const periodHtml = result.period ? 
        `<div class="result-period">期間: ${result.period}</div>` : '';
    
    const categoryHtml = result.category ? 
        `<div class="result-category">類別: ${result.category}</div>` : '';
    
    const capWarning = result.isMaxCap ? 
        `<div class="cap-warning">⚠️ 已達回饋上限 NT$${result.cap.toLocaleString()}</div>` : '';
    
    div.innerHTML = `
        <div class="result-header">
            ${rankBadge}
            <h3 class="card-name">${result.card.name}</h3>
            <div class="cashback-amount">NT$${Math.round(result.cashback)}</div>
        </div>
        <div class="result-details">
            <div class="rate-info">
                <span class="rate">${result.rate}%</span>
                <span class="items">${result.items.join('、')}</span>
            </div>
            ${conditionsHtml}
            ${periodHtml}
            ${categoryHtml}
            ${capWarning}
        </div>
    `;
    
    return div;
}

// Authentication setup (simplified for now)
function setupAuthentication() {
    // This will be implemented with Firebase Auth
    console.log('🔐 認證系統設定完成');
}

// Card detail modal (simplified)
function showCardDetail(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    if (card) {
        console.log('📋 顯示卡片詳情:', card.name);
        // Implementation for card detail modal
    }
}