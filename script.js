// Global variables
let currentUser = null;
let userSelectedCards = new Set(); // Store user's selected card IDs
let auth = null;
let db = null;
let cardsData = null;

// Load cards data from JSON file
async function loadCardsData() {
    try {
        const response = await fetch('cards.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        cardsData = await response.json();
        console.log('✅ 成功載入信用卡資料');
        return true;
    } catch (error) {
        console.error('❌ 載入信用卡資料失敗:', error);
        showErrorMessage('無法載入信用卡資料，請檢查網路連線或重新載入頁面。');
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
    
    // Find matching items
    const matchedItem = findMatchingItem(input);
    
    if (matchedItem) {
        showMatchedItem(matchedItem);
        currentMatchedItem = matchedItem;
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
    }
    
    validateInputs();
}

// Find matching item in cards database
function findMatchingItem(searchTerm) {
    if (!cardsData) return null;
    
    for (const card of cardsData.cards) {
        for (const rateGroup of card.cashbackRates) {
            for (const item of rateGroup.items) {
                if (item.toLowerCase().includes(searchTerm) || 
                    searchTerm.includes(item.toLowerCase())) {
                    return {
                        originalItem: item,
                        searchTerm: searchTerm
                    };
                }
            }
        }
    }
    return null;
}

// Show matched item
function showMatchedItem(matchedItem) {
    matchedItemDiv.innerHTML = `✓ 系統匹配到: <strong>${matchedItem.originalItem}</strong>`;
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
        // User input matched specific items - show special cashback rates
        const searchTerm = currentMatchedItem.originalItem.toLowerCase();
        results = cardsToCompare.map(card => {
            const result = calculateCardCashback(card, searchTerm, amount);
            return {
                ...result,
                card: card
            };
        })
        // Filter out cards with no special cashback
        .filter(result => result.cashbackAmount > 0);
        
        // Show no-match message and basic rates when no special rates found
        if (results.length === 0 && merchantValue.length > 0) {
            showNoMatchMessage();
            // Show basic cashback for selected cards when no special rates found
            isBasicCashback = true;
            results = cardsToCompare.map(card => {
                let basicCashbackAmount = 0;
                let effectiveRate = card.basicCashback;
                
                // Handle complex cards like HSBC Live+ with multiple basic rates
                if (card.autoBillCashback && card.autoBillCap) {
                    const autoBillAmount = Math.min(amount, card.autoBillCap);
                    const autoBillCashback = Math.floor(autoBillAmount * (card.basicCashback + card.autoBillCashback) / 100);
                    const normalAmount = amount - autoBillAmount;
                    const normalCashback = Math.floor(normalAmount * card.basicCashback / 100);
                    basicCashbackAmount = autoBillCashback + normalCashback;
                    effectiveRate = ((autoBillCashback + normalCashback) / amount * 100).toFixed(2);
                } else if (card.domesticBonusRate && card.domesticBonusCap) {
                    // Handle 永豐幣倍 type cards with domestic bonus
                    const bonusAmount = Math.min(amount, card.domesticBonusCap);
                    const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
                    const basicCashback = Math.floor(amount * card.basicCashback / 100);
                    basicCashbackAmount = bonusCashback + basicCashback;
                    effectiveRate = card.basicCashback + card.domesticBonusRate;
                } else {
                    basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
                }
                
                return {
                    rate: effectiveRate,
                    cashbackAmount: basicCashbackAmount,
                    cap: null,
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
            
            // Handle complex cards like HSBC Live+ with multiple basic rates
            if (card.autoBillCashback && card.autoBillCap) {
                const autoBillAmount = Math.min(amount, card.autoBillCap);
                const autoBillCashback = Math.floor(autoBillAmount * (card.basicCashback + card.autoBillCashback) / 100);
                const normalAmount = amount - autoBillAmount;
                const normalCashback = Math.floor(normalAmount * card.basicCashback / 100);
                basicCashbackAmount = autoBillCashback + normalCashback;
                effectiveRate = ((autoBillCashback + normalCashback) / amount * 100).toFixed(2);
            } else if (card.domesticBonusRate && card.domesticBonusCap) {
                // Handle 永豐幣倍 type cards with domestic bonus
                const bonusAmount = Math.min(amount, card.domesticBonusCap);
                const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
                const basicCashback = Math.floor(amount * card.basicCashback / 100);
                basicCashbackAmount = bonusCashback + basicCashback;
                effectiveRate = card.basicCashback + card.domesticBonusRate;
            } else {
                basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
            }
            
            return {
                rate: effectiveRate,
                cashbackAmount: basicCashbackAmount,
                cap: null,
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
    
    // Display results
    displayResults(results, amount, currentMatchedItem ? currentMatchedItem.originalItem : merchantValue, isBasicCashback);
    
    // Display coupon cashbacks
    displayCouponCashbacks(amount, merchantValue);
}

// Calculate cashback for a specific card
function calculateCardCashback(card, searchTerm, amount) {
    let bestRate = 0;
    let applicableCap = null;
    let matchedItem = null;
    let matchedCategory = null;
    
    // Handle CUBE card with levels
    if (card.hasLevels && card.id === 'cathay-cube') {
        const savedLevel = localStorage.getItem(`cubeLevel-${card.id}`) || 'level1';
        const levelSettings = card.levelSettings[savedLevel];
        
        // Check if merchant matches special items
        const isSpecialItem = card.specialItems.some(item => 
            item.toLowerCase().includes(searchTerm) || 
            searchTerm.includes(item.toLowerCase())
        );
        
        if (isSpecialItem) {
            bestRate = levelSettings.specialRate;
            matchedItem = card.specialItems.find(item => 
                item.toLowerCase().includes(searchTerm) || 
                searchTerm.includes(item.toLowerCase())
            );
            matchedCategory = '玩數位、樂饗購、趣旅行';
        } else {
            // Other merchants get general rate
            bestRate = levelSettings.generalRate;
            matchedItem = '其他通路';
            matchedCategory = '其他通路';
        }
        applicableCap = null; // CUBE card has no cap
    } else {
        // Original logic for other cards
        for (const rateGroup of card.cashbackRates) {
            for (const item of rateGroup.items) {
                if (item.toLowerCase().includes(searchTerm) || 
                    searchTerm.includes(item.toLowerCase())) {
                    if (rateGroup.rate > bestRate) {
                        bestRate = rateGroup.rate;
                        applicableCap = rateGroup.cap;
                        matchedItem = item;
                        matchedCategory = rateGroup.category || null;
                    }
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
        
        specialCashback = Math.floor(effectiveSpecialAmount * bestRate / 100);
        
        // Determine basic rate and additional bonuses based on card type and merchant
        let basicRate = card.basicCashback;
        let bonusRate = 0;
        
        // Handle special cards like 永豐幣倍 with different domestic/overseas rates
        if (matchedItem === '海外' && card.overseasCashback) {
            basicRate = card.overseasCashback;
            if (card.overseasBonusRate && card.overseasBonusCap) {
                bonusRate = card.overseasBonusRate;
            }
        } else if (card.domesticBonusRate && card.domesticBonusCap) {
            bonusRate = card.domesticBonusRate;
        }
        
        // Add basic cashback for the same amount (layered rewards)
        let basicCashback = Math.floor(effectiveSpecialAmount * basicRate / 100);
        
        // Add bonus cashback if applicable
        let bonusCashback = 0;
        if (bonusRate > 0) {
            let bonusAmount = effectiveSpecialAmount;
            if (matchedItem === '海外' && card.overseasBonusCap) {
                bonusAmount = Math.min(effectiveSpecialAmount, card.overseasBonusCap);
            } else if (card.domesticBonusCap) {
                bonusAmount = Math.min(effectiveSpecialAmount, card.domesticBonusCap);
            }
            bonusCashback = Math.floor(bonusAmount * bonusRate / 100);
        }
        
        // Handle remaining amount if capped
        let remainingCashback = 0;
        if (applicableCap && amount > applicableCap) {
            const remainingAmount = amount - applicableCap;
            remainingCashback = Math.floor(remainingAmount * basicRate / 100);
            
            // Add bonus for remaining amount if applicable
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
        
        cashbackAmount = specialCashback + basicCashback + bonusCashback + remainingCashback;
        totalRate = bestRate + basicRate + bonusRate;
        effectiveAmount = applicableCap; // Keep this for display purposes
    }
    
    return {
        rate: totalRate,
        specialRate: bestRate,
        basicRate: card.basicCashback,
        cashbackAmount: cashbackAmount,
        cap: applicableCap,
        matchedItem: matchedItem,
        matchedCategory: matchedCategory,
        effectiveAmount: effectiveAmount
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
    
    const capText = result.cap ? `NT$${result.cap.toLocaleString()}` : '無上限';
    const cashbackText = result.cashbackAmount > 0 ? 
                        `NT$${result.cashbackAmount.toLocaleString()}` : 
                        '無回饋';
    
    // Format rate display for complex cards
    let rateDisplay = result.rate > 0 ? `${result.rate}%` : '0%';
    if (result.specialRate && result.basicRate && result.specialRate > 0) {
        const totalRate = result.specialRate + result.basicRate;
        rateDisplay = `${totalRate}% (${result.specialRate}%+基本${result.basicRate}%)`;
    }
    
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
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋消費上限</div>
                <div class="detail-value">${capText}</div>
            </div>
        </div>
        ${isBasicCashback ? `
            <div class="matched-merchant">
                一般消費回饋率
            </div>
        ` : (result.matchedItem ? `
            <div class="matched-merchant">
                匹配項目: <strong>${result.matchedItem}</strong>${result.matchedCategory ? ` (類別: ${result.matchedCategory})` : ''}
            </div>
        ` : `
            <div class="matched-merchant">
                此卡無此項目回饋
            </div>
        `)}
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
            
            // Hide manage cards button
            document.getElementById('manage-cards-btn').style.display = 'none';
            
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
        if (!currentUser) {
            alert('請先登入才能管理信用卡');
            return;
        }
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
    
    // Populate cards selection
    cardsSelection.innerHTML = '';
    
    // Sort cards by name
    const sortedCards = [...cardsData.cards].sort((a, b) => a.name.localeCompare(b.name));
    
    sortedCards.forEach(card => {
        const isSelected = userSelectedCards.has(card.id);
        
        const cardDiv = document.createElement('div');
        cardDiv.className = `card-checkbox ${isSelected ? 'selected' : ''}`;
        
        cardDiv.innerHTML = `
            <input type="checkbox" id="card-${card.id}" value="${card.id}" ${isSelected ? 'checked' : ''}>
            <label for="card-${card.id}" class="card-checkbox-label">${card.name}</label>
        `;
        
        // Update visual state on checkbox change
        const checkbox = cardDiv.querySelector('input');
        checkbox.addEventListener('change', () => {
            cardDiv.classList.toggle('selected', checkbox.checked);
        });
        
        cardsSelection.appendChild(cardDiv);
    });
    
    // Update toggle button state
    const toggleAllBtn = document.getElementById('toggle-all-cards');
    const allSelected = sortedCards.every(card => userSelectedCards.has(card.id));
    toggleAllBtn.textContent = allSelected ? '全不選' : '全選';
    
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
    
    document.getElementById('card-annual-fee').textContent = card.annualFee || '無資料';
    document.getElementById('card-fee-waiver').textContent = card.feeWaiver || '無資料';
    
    // Update basic cashback
    const basicCashbackDiv = document.getElementById('card-basic-cashback');
    let basicContent = `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">國內一般回饋: ${card.basicCashback}%</div>`;
    basicContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
    
    if (card.overseasCashback) {
        basicContent += `<div class="cashback-rate">海外一般回饋: ${card.overseasCashback}%</div>`;
        basicContent += `<div class="cashback-condition">海外消費上限: 無上限</div>`;
    }
    
    basicContent += `</div>`;
    
    if (card.domesticBonusRate) {
        basicContent += `<div class="cashback-detail-item">`;
        basicContent += `<div class="cashback-rate">國內加碼回饋: +${card.domesticBonusRate}%</div>`;
        basicContent += `<div class="cashback-condition">消費上限: NT$${card.domesticBonusCap?.toLocaleString()}</div>`;
        basicContent += `</div>`;
    }
    
    if (card.overseasBonusRate) {
        basicContent += `<div class="cashback-detail-item">`;
        basicContent += `<div class="cashback-rate">海外加碼回饋: +${card.overseasBonusRate}%</div>`;
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
        
        // Add change listener
        cubeLevelSelect.onchange = function() {
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
        card.cashbackRates.forEach((rate, index) => {
            // 跳過需要隱藏的項目
            if (rate.hideInDisplay) {
                return;
            }
            
            specialContent += `<div class="cashback-detail-item">`;
            
            // 回饋率和是否含一般回饋的說明
            const includesBasic = rate.rate > card.basicCashback;
            if (includesBasic) {
                specialContent += `<div class="cashback-rate">${rate.rate}% 回饋 (含一般回饋${card.basicCashback}%)</div>`;
            } else {
                specialContent += `<div class="cashback-rate">${rate.rate}% 回饋</div>`;
            }
            
            // 消費上限
            if (rate.cap) {
                specialContent += `<div class="cashback-condition">消費上限: NT$${rate.cap.toLocaleString()}</div>`;
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
                
                if (rate.items.length <= 20) {
                    // 少於20個直接顯示全部
                    const merchantsList = rate.items.join('、');
                    specialContent += `<div class="cashback-merchants">適用通路: ${merchantsList}</div>`;
                } else {
                    // 超過20個顯示可展開的列表
                    const initialList = rate.items.slice(0, 20).join('、');
                    const fullList = rate.items.join('、');
                    
                    specialContent += `<div class="cashback-merchants">`;
                    specialContent += `適用通路: <span id="${merchantsId}">${initialList}</span>`;
                    specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${initialList}', '${fullList}')">... 顯示全部${rate.items.length}個</button>`;
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
    const selectedLevel = document.getElementById('cube-level-select').value;
    const levelSettings = card.levelSettings[selectedLevel];
    let content = '';
    
    // Special categories (玩數位、樂饗購、趣旅行)
    content += `<div class="cashback-detail-item">`;
    content += `<div class="cashback-rate">${levelSettings.specialRate}% 回饋 (玩數位、樂饗購、趣旅行)</div>`;
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
    
    // Other categories (2%)
    content += `<div class="cashback-detail-item">`;
    content += `<div class="cashback-rate">${levelSettings.generalRate}% 回饋 (其他通路)</div>`;
    content += `<div class="cashback-condition">消費上限: 無上限</div>`;
    content += `<div class="cashback-merchants">適用通路: 除上述特殊通路外的所有消費</div>`;
    content += `</div>`;
    
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
