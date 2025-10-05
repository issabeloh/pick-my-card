// Global variables
let currentUser = null;
let userSelectedCards = new Set();
let auth = null;
let db = null;
let cardsData = null;

// Load cards data from cards.json
async function loadCardsData() {
    try {
        const timestamp = new Date().getTime(); // 防止快取
        const response = await fetch(`cards.json?t=${timestamp}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        cardsData = await response.json();
        console.log('✅ 信用卡資料已從 cards.json 載入');
        console.log(`📊 載入了 ${cardsData.cards.length} 張信用卡`);
        return true;
    } catch (error) {
        console.error('❌ 載入信用卡資料失敗:', error);
        showErrorMessage('無法載入信用卡資料，請重新整理頁面或聯絡管理員。');
        return false;
    }
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
    
    populateCardChips();
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

// 特殊處理：如果輸入「海外」，直接檢查 overseasCashback
if (input === '海外' || input === 'overseas') {
    const cardsWithOverseas = cardsData.cards
        .filter(card => card.overseasCashback && card.overseasCashback > 0)
        .map(card => ({
            cardId: card.id,
            cardName: card.name,
            item: '海外消費',
            originalItem: '海外消費',  // 加上這行
            rate: card.overseasCashback,
            isOverseas: true
        }));
    
    if (cardsWithOverseas.length > 0) {
        showMatchedItem(cardsWithOverseas);
        currentMatchedItem = cardsWithOverseas;
        validateInputs();
        return;
    }
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
    // 如果所有項目名稱相同，只顯示一次
    const uniqueItems = [...new Set(matchedItems.map(item => item.originalItem))];
    if (uniqueItems.length === 1) {
        matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${uniqueItems[0]}</strong>`;
    } else {
        const itemList = uniqueItems.join('、');
        matchedItemDiv.innerHTML = `✓ 系統匹配到 ${matchedItems.length} 項: <strong>${itemList}</strong>`;
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
    
    const amount = parseFloat(amountInput.value);
    const merchantValue = merchantInput.value.trim();
    
    let results;
    let isBasicCashback = false;
    
    // Get cards to compare (user selected or all)
    const cardsToCompare = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    if (currentMatchedItem) {
        // User input matched specific items - show special cashback rates for ALL matched items
        let allResults = [];
        
        if (Array.isArray(currentMatchedItem)) {
            // Multiple matches - calculate for all items and combine results
            const itemResultsMap = new Map();
            
            currentMatchedItem.forEach(matchedItem => {
// 特殊處理：如果是海外消費，使用 overseasCashback
if (matchedItem.isOverseas) {
    const itemResults = cardsToCompare
        .filter(card => card.overseasCashback && card.overseasCashback > 0)
        .map(card => ({
            rate: card.overseasCashback,
            cashbackAmount: Math.floor(amount * card.overseasCashback / 100),
            cap: card.overseasBonusCap || null,
            matchedItem: '海外消費',
            effectiveAmount: amount,
            card: card,
            matchedItemName: '海外消費'
        }));

    itemResults.forEach(result => {
        const cardId = result.card.id;
        if (!itemResultsMap.has(cardId) || result.cashbackAmount > itemResultsMap.get(cardId).cashbackAmount) {
            itemResultsMap.set(cardId, result);
        }
    });
    return; // Early return from forEach callback is allowed
}
                const searchTerm = matchedItem.originalItem.toLowerCase();
                const itemResults = cardsToCompare.map(card => {
                    const result = calculateCardCashback(card, searchTerm, amount);
                    return {
                        ...result,
                        card: card,
                        matchedItemName: matchedItem.originalItem
                    };
                }).filter(result => result.cashbackAmount > 0);
                
                // Add to combined results, keeping track of the best rate per card
                itemResults.forEach(result => {
                    const cardId = result.card.id;
                    if (!itemResultsMap.has(cardId) || result.cashbackAmount > itemResultsMap.get(cardId).cashbackAmount) {
                        itemResultsMap.set(cardId, result);
                    }
                });
            });
            
            allResults = Array.from(itemResultsMap.values());
        } else {
            // Single match - backward compatibility
            const searchTerm = currentMatchedItem.originalItem.toLowerCase();
            allResults = cardsToCompare.map(card => {
                const result = calculateCardCashback(card, searchTerm, amount);
                return {
                    ...result,
                    card: card
                };
            }).filter(result => result.cashbackAmount > 0);
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
function calculateCardCashback(card, searchTerm, amount) {
    let bestRate = 0;
    let applicableCap = null;
    let matchedItem = null;
    let matchedCategory = null;
    let matchedRateGroup = null;
    
    // Get all possible search variants
    const searchVariants = getAllSearchVariants(searchTerm);
    
    // Handle CUBE card with levels
    if (card.hasLevels && card.id === 'cathay-cube') {
        // 動態取得預設等級（第一個等級）
const defaultLevel = Object.keys(card.levelSettings)[0];
const savedLevel = localStorage.getItem(`cubeLevel-${card.id}`) || defaultLevel;
        const levelSettings = card.levelSettings[savedLevel];
        
// 判斷是否有 specialRate（CUBE卡）或只有 rate（Uni卡）
const hasSpecialItems = card.specialItems && card.specialItems.length > 0;

        // Check if merchant matches special items using all search variants
        let matchedSpecialItem = null;
        for (const variant of searchVariants) {
            matchedSpecialItem = card.specialItems.find(item => item.toLowerCase() === variant);
            if (matchedSpecialItem) break;
        }
        
        if (matchedSpecialItem) {
            bestRate = levelSettings.specialRate;
            matchedItem = matchedSpecialItem;
            matchedCategory = '玩數位、樂饗購、趣旅行';
        } else {
            // Check if merchant matches general items (2% reward categories)
            let matchedGeneralItem = null;
            let matchedGeneralCategory = null;
            
            if (card.generalItems) {
                for (const [category, items] of Object.entries(card.generalItems)) {
                    for (const variant of searchVariants) {
                        // Try exact match first, then contains match
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
            } else {
                // No match found - CUBE card gives 0.3% basic rate only for unmatched items
                bestRate = 0; // No special rate for unmatched items
                matchedItem = null;
                matchedCategory = null;
            }
        }
        applicableCap = null; // CUBE card has no cap
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
        const savedLevel = localStorage.getItem(`cardLevel-${card.id}`) || defaultLevel;
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
        matchedRateGroup: matchedRateGroup
    };
}

// Display calculation results
function displayResults(results, originalAmount, searchedItem, isBasicCashback = false) {
    resultsContainer.innerHTML = '';
    
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
    
    cardDiv.innerHTML = `
        <div class="card-header">
            <div class="card-name">${result.card.name}</div>
            ${isBest ? '<div class="best-badge">最優回饋</div>' : ''}
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">回饋率</div>
                <div class="detail-value">${rateDisplay}</div>
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
                
                const categoryInfo = result.matchedCategory && result.card.id !== 'cathay-cube' ? ` (類別: ${result.matchedCategory})` : '';
                
                // Special handling for Yushan Uni card exclusions in search results
                let exclusionNote = '';
                if (result.card.id === 'yushan-unicard' && 
                    (result.matchedItem === '街口' || result.matchedItem === '全支付')) {
                    exclusionNote = ' <small style="color: #f59e0b; font-weight: 500;">(排除超商)</small>';
                }
                
                return `
                    <div class="matched-merchant">
                        匹配項目: <strong>${result.matchedItem}</strong>${exclusionNote}${categoryInfo}${additionalInfo}
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
    
    // Sign in function
    signInBtn.addEventListener('click', async () => {
        try {
            const result = await window.signInWithPopup(auth, window.googleProvider);
            console.log('Sign in successful:', result.user);
        } catch (error) {
            console.error('Sign in failed:', error);
            alert('登入失敗：' + error.message);
        }
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
    window.onAuthStateChanged(auth, (user) => {
        if (user) {
            // User is signed in
            console.log('User signed in:', user);
            currentUser = user;
            signInBtn.style.display = 'none';
            userInfo.style.display = 'inline-flex';
            userPhoto.src = user.photoURL || '';
            userName.textContent = user.displayName || user.email;
            
            // Show manage cards button
            document.getElementById('manage-cards-btn').style.display = 'block';
            
            // Load user's selected cards from localStorage
            loadUserCards();
            
            // Update card chips display
            populateCardChips();
        } else {
            // User is signed out
            console.log('User signed out');
            currentUser = null;
            userSelectedCards.clear();
            signInBtn.style.display = 'inline-block';
            userInfo.style.display = 'none';

            // Show manage cards button even when not logged in (read-only mode)
            document.getElementById('manage-cards-btn').style.display = 'block';

            // Show all cards when signed out
            populateCardChips();
        }
    });
    
    // Setup manage cards modal
    setupManageCardsModal();
}

// Load user's selected cards from localStorage
function loadUserCards() {
    if (!currentUser) {
        console.log('No current user, using all cards');
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        return;
    }
    
    try {
        const storageKey = `selectedCards_${currentUser.uid}`;
        const savedCards = localStorage.getItem(storageKey);
        
        if (savedCards) {
            userSelectedCards = new Set(JSON.parse(savedCards));
            console.log('Loaded user cards from localStorage:', Array.from(userSelectedCards));
        } else {
            // First time user - select all cards by default
            console.log('First time user, selecting all cards');
            userSelectedCards = new Set(cardsData.cards.map(card => card.id));
            saveUserCards();
        }
    } catch (error) {
        console.error('Error loading user cards from localStorage:', error);
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

    modal.style.display = 'flex';
}

// Show card detail modal
function showCardDetail(cardId) {
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
    // 顯示級別選擇器（適用於所有有分級的卡片）
if (card.hasLevels) {
    const levelNames = Object.keys(card.levelSettings);
    const savedLevel = localStorage.getItem(`cardLevel-${card.id}`) || levelNames[0];
    
    levelSelectHTML = `
        <div class="level-selector">
            <label>選擇級別：</label>
            <select id="card-level-select" onchange="updateCardLevel('${card.id}')">
                ${levelNames.map(level => 
                    `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                ).join('')}
            </select>
        </div>
    `;
}

// Update card level selection (for cards with levels like Uni card)
function updateCardLevel(cardId) {
    const select = document.getElementById('card-level-select');
    if (!select) return;
    
    const selectedLevel = select.value;
    localStorage.setItem(`cardLevel-${cardId}`, selectedLevel);
    
    // 重新顯示卡片詳情
    const card = cardsData.cards.find(c => c.id === cardId);
    if (card) {
        showCardDetail(card);
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
    if (card.overseasConditions) {
        basicContent += `<div class="cashback-condition">條件: ${card.overseasConditions}</div>`;
    }
    basicContent += `<div class="cashback-condition">海外消費上限: 無上限</div>`;
    basicContent += `</div>`;
}

if (card.domesticBonusRate) {
    basicContent += `<div class="cashback-detail-item">`; // ← 新的區塊
    basicContent += `<div class="cashback-rate">國內加碼回饋: +${card.domesticBonusRate}%</div>`;
    if (card.domesticConditions) {
        basicContent += `<div class="cashback-condition">條件: ${card.domesticConditions}</div>`;
    }
    basicContent += `<div class="cashback-condition">消費上限: NT$${card.domesticBonusCap?.toLocaleString()}</div>`;
    basicContent += `</div>`; // ← 關閉國內加碼區塊
}

if (card.overseasBonusRate) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外加碼回饋: +${card.overseasBonusRate}%</div>`;
    if (card.overseasConditions) {
        basicContent += `<div class="cashback-condition">條件: ${card.overseasConditions}</div>`;
    }
    basicContent += `<div class="cashback-condition">消費上限: NT$${card.overseasBonusCap?.toLocaleString()}</div>`;
    basicContent += `</div>`;
}

basicCashbackDiv.innerHTML = basicContent;
    
    // Handle CUBE card level selection
    const cubeLevelSection = document.getElementById('cube-level-section');
    const cubeLevelSelect = document.getElementById('cube-level-select');
    
    if (card.hasLevels && card.id === 'cathay-cube') {
        cubeLevelSection.style.display = 'block';
        
        // Load saved level or default to level1
        const savedLevel = localStorage.getItem(`cubeLevel-${card.id}`) || 'level1';
        cubeLevelSelect.value = savedLevel;
        
        // Add birthday month note after level selection
        const levelSectionContent = cubeLevelSection.innerHTML;
        const birthdayNote = `
            <div class="cube-birthday-note" style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin-top: 12px;">
                <div style="color: #d97706; font-size: 14px; margin-bottom: 4px; font-weight: 600;">提醒</div>
                <div style="color: #92400e; font-size: 13px; line-height: 1.4;">
                    慶生月方案不納入回饋比較，請於您的生日月份到<a href="https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/cube-list" target="_blank" rel="noopener" style="color: #d97706; text-decoration: underline; font-weight: 500;">官網查詢</a>哦！
                </div>
            </div>
        `;
        cubeLevelSection.innerHTML = levelSectionContent + birthdayNote;
        
        // Re-get the select element after innerHTML modification and add change listener
        const newCubeLevelSelect = document.getElementById('cube-level-select');
        newCubeLevelSelect.value = savedLevel;
        newCubeLevelSelect.onchange = function() {
            localStorage.setItem(`cubeLevel-${card.id}`, this.value);
            updateCubeSpecialCashback(card);
        };
    } else {
        cubeLevelSection.style.display = 'none';
    }
    
    // Update special cashback
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    let specialContent = '';
    
    if (card.hasLevels && card.id === 'cathay-cube') {
        specialContent = generateCubeSpecialContent(card);
    } else if (card.cashbackRates && card.cashbackRates.length > 0) {
        // Sort rates by percentage in descending order
        const sortedRates = [...card.cashbackRates]
            .filter(rate => !rate.hideInDisplay)
            .sort((a, b) => b.rate - a.rate);
            
        sortedRates.forEach((rate, index) => {
            specialContent += `<div class="cashback-detail-item">`;

            // Display rate as-is (rates are already total rates)
            specialContent += `<div class="cashback-rate">${rate.rate}% 回饋</div>`;
            
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
            
            if (rate.category) {
                specialContent += `<div class="cashback-condition">類別: ${rate.category}</div>`;
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
                    specialContent += `<div class="cashback-merchants">適用通路: ${merchantsList}</div>`;
                } else {
                    // 超過20個顯示可展開的列表
                    const initialList = processedItems.slice(0, 20).join('、');
                    const fullList = processedItems.join('、');
                    
                    specialContent += `<div class="cashback-merchants">`;
                    specialContent += `適用通路: <span id="${merchantsId}">${initialList}</span>`;
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
function generateCubeSpecialContent(card) {
    // 只處理有 specialItems 的卡片
    if (!card.specialItems || card.specialItems.length === 0) {
        return '';
    }
    
    const selectedLevel = document.getElementById('cube-level-select').value;
    const levelSettings = card.levelSettings[selectedLevel];
    
    // 使用 specialRate（如果有）或 rate
    const specialRate = levelSettings.specialRate || levelSettings.rate;
    
    let content = '';
    
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
        content += `<div class="cashback-merchants">適用通路: ${childrenRate10.items.join('、')}</div>`;
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
        content += `<div class="cashback-merchants">適用通路: ${childrenRate5.items.join('、')}</div>`;
        content += `</div>`;
    }
    
    // 3. Level變動的特殊通路 (玩數位、樂饗購、趣旅行) - 移到5%童樂匯下、2%集精選上
    content += `<div class="cashback-detail-item">`;
    content += `<div class="cashback-rate">${specialRate}% 回饋 (玩數位、樂饗購、趣旅行)</div>`;
    content += `<div class="cashback-condition">消費上限: 無上限</div>`;
    
    const merchantsList = card.specialItems.join('、');
    if (card.specialItems.length <= 30) {
        content += `<div class="cashback-merchants">適用通路: ${merchantsList}</div>`;
    } else {
        const initialList = card.specialItems.slice(0, 30).join('、');
        const fullList = merchantsList;
        const merchantsId = `cube-merchants-${selectedLevel}`;
        const showAllId = `cube-show-all-${selectedLevel}`;
        
        content += `<div class="cashback-merchants">`;
        content += `適用通路: <span id="${merchantsId}">${initialList}</span>`;
        content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">... 顯示全部${card.specialItems.length}個</button>`;
        content += `</div>`;
    }
    content += `</div>`;
    
    // 4. 集精選和來支付 (2%) - 放在最後
    if (card.generalItems) {
        Object.entries(card.generalItems).forEach(([category, items]) => {
            content += `<div class="cashback-detail-item">`;
            content += `<div class="cashback-rate">2% 回饋 (${category})</div>`;
            content += `<div class="cashback-condition">消費上限: 無上限</div>`;
            content += `<div class="cashback-merchants">適用通路: ${items.join('、')}</div>`;
            content += `</div>`;
        });
    }
    
    return content;
}

// Update CUBE special cashback when level changes
function updateCubeSpecialCashback(card) {
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    const newContent = generateCubeSpecialContent(card);
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
