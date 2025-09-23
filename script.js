// Global variables
let currentUser = null;
let userSelectedCards = new Set();
let auth = null;
let db = null;
let cardsData = null;

// Embedded cards data with clean UTF-8 encoding
cardsData = {
  "cards": [
    {
      "id": "taishin-richart",
      "name": "台新Richart卡",
      "fullName": "台新銀行Richart信用卡",
      "basicCashback": 0.3,
      "annualFee": "正卡每卡年NT$1,500、附卡每卡每年NT$750",
      "feeWaiver": "首年免年費，次年起使用台新電子/行動簡訊帳單且生效，享免年費優惠",
      "website": "https://www.taishinbank.com.tw/TSB/personal/credit/intro/overview/cg047/card001/",
      "cashbackRates": [
        {
          "rate": 3.8,
          "cap": 480000,
          "items": ["台灣Pay場域", "超商（單筆限額最高 NT3,000元，且不含代收水電稅費/禮物卡/儲值）"]
        },
        {
          "rate": 3.3,
          "cap": 480000,
          "items": ["華航", "長榮", "星宇", "虎航", "國泰航空", "華信", "立榮", "klook", "kkday"]
        }
      ]
    },
    {
      "id": "yushan-unicard",
      "name": "玉山Uni卡",
      "fullName": "玉山銀行UniCard信用卡",
      "basicCashback": 1.0,
      "annualFee": "御璽卡NT$3,000",
      "feeWaiver": "首年免年費，每年有消費年年免年費",
      "website": "https://www.esunbank.com/zh-tw/personal/credit-card/intro/bank-card/unicard",
      "cashbackRates": [
        {
          "rate": 3.5,
          "cap": 20000,
          "items": ["linepay", "街口", "悠遊付", "全盈支付", "全支付", "橘子支付", "momo購物網", "蝦皮購物"]
        }
      ]
    },
    {
      "id": "cathay-cube",
      "name": "國泰CUBE卡",
      "fullName": "國泰世華CUBE信用卡",
      "basicCashback": 0.3,
      "annualFee": "首年免年費，次年起年費NT$1,800",
      "feeWaiver": "申辦電子帳單、前年度消費12次、前一年累積消費達18萬(三擇一)即可減免年費",
      "website": "https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/cube",
      "hasLevels": true,
      "levelSettings": {
        "level1": { "specialRate": 2.0, "generalRate": 2.0 },
        "level2": { "specialRate": 3.0, "generalRate": 2.0 },
        "level3": { "specialRate": 3.3, "generalRate": 2.0 }
      },
      "specialItems": ["netflix", "spotify", "youtube premium", "蝦皮購物", "momo購物網"],
      "cashbackRates": [
        {
          "rate": 2.0,
          "cap": null,
          "category": "精選",
          "items": ["家樂福", "7-11", "全家"]
        }
      ]
    }
  ]
};

// DOM elements - will be initialized after DOM is loaded  
let merchantInput, amountInput, calculateBtn, resultsSection, resultsContainer, couponResultsSection, couponResultsContainer, matchedItemDiv;

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 DOM loaded, initializing application...');
    
    // Initialize DOM elements
    merchantInput = document.getElementById('merchant-input');
    amountInput = document.getElementById('amount-input');
    calculateBtn = document.getElementById('calculate-btn');
    resultsSection = document.getElementById('results-section');
    resultsContainer = document.getElementById('results-container');
    couponResultsSection = document.getElementById('coupon-results-section');
    couponResultsContainer = document.getElementById('coupon-results-container');
    matchedItemDiv = document.getElementById('matched-item');
    
    // Check if essential DOM elements exist
    if (!merchantInput || !amountInput || !calculateBtn) {
        console.error('❌ Essential DOM elements not found!');
        showErrorMessage('頁面載入錯誤，請重新整理頁面');
        return;
    }
    
    // Load cards data first
    const dataLoaded = await loadCardsData();
    if (!dataLoaded) {
        console.error('❌ Failed to load cards data');
        showErrorMessage('信用卡資料載入失敗');
        if (calculateBtn) calculateBtn.disabled = true;
        return;
    }
    
    console.log('✅ Cards data loaded, initializing user cards...');
    // Initialize user cards (all cards for non-logged users)
    loadUserCards();
    
    console.log('✅ Populating card chips...');
    populateCardChips();
    
    console.log('✅ Setting up event listeners...');
    setupEventListeners();
    
    console.log('✅ Setting up authentication...');
    setupAuthentication();
});

// Load cards data function
async function loadCardsData() {
    console.log('✅ 信用卡資料已內嵌載入');
    return true;
}

// Populate card chips in header
function populateCardChips() {
    console.log('🔄 populateCardChips called, currentUser:', currentUser ? currentUser.email : 'not logged in');
    
    const cardChipsContainer = document.getElementById('card-chips');
    if (!cardChipsContainer) {
        console.error('❌ card-chips container not found!');
        return;
    }
    
    // Clear existing chips
    cardChipsContainer.innerHTML = '';
    
    // Check if cards data exists
    if (!cardsData || !cardsData.cards || cardsData.cards.length === 0) {
        console.error('❌ No cards data available!');
        cardChipsContainer.innerHTML = '<div style="color: red; padding: 10px;">信用卡資料載入失敗</div>';
        return;
    }
    
    // Show cards based on user selection or all cards if not logged in
    const cardsToShow = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    console.log('📊 Cards to show:', cardsToShow.length, 'total cards:', cardsData.cards.length);
    console.log('📋 Selected cards:', Array.from(userSelectedCards));
    
    if (cardsToShow.length === 0) {
        if (currentUser && userSelectedCards.size === 0) {
            cardChipsContainer.innerHTML = '<div style="color: #666; padding: 10px;">尚未選擇任何信用卡，請點擊設定按鈕選擇</div>';
        } else {
            cardChipsContainer.innerHTML = '<div style="color: red; padding: 10px;">找不到符合條件的信用卡</div>';
        }
        return;
    }
    
    cardsToShow.forEach(card => {
        const chip = document.createElement('div');
        chip.className = 'card-chip chip-clickable';
        chip.textContent = card.name;
        chip.addEventListener('click', () => showCardDetail(card.id));
        cardChipsContainer.appendChild(chip);
    });
    
    console.log('✅ Successfully populated', cardsToShow.length, 'card chips');
}

// Setup event listeners
function setupEventListeners() {
    if (!merchantInput || !amountInput || !calculateBtn) {
        console.error('❌ Cannot setup event listeners - elements not found');
        return;
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
}

// Handle merchant input changes
function handleMerchantInput() {
    const input = merchantInput.value.trim().toLowerCase();
    
    if (input.length === 0) {
        hideMatchedItem();
        validateInputs();
        return;
    }
    
    validateInputs();
}

// Validate inputs
function validateInputs() {
    if (!merchantInput || !amountInput || !calculateBtn) return;
    
    const merchantValue = merchantInput.value.trim();
    const amountValue = amountInput.value.trim();
    
    const isValid = merchantValue.length > 0 && amountValue.length > 0 && parseFloat(amountValue) > 0;
    
    calculateBtn.disabled = !isValid;
}

// Hide matched item
function hideMatchedItem() {
    if (matchedItemDiv) {
        matchedItemDiv.style.display = 'none';
    }
}

// Calculate cashback for all cards
function calculateCashback() {
    if (!cardsData) return;
    
    const amount = parseFloat(amountInput.value);
    const merchantValue = merchantInput.value.trim();
    
    // Show results
    displayBasicResults(amount, merchantValue);
}

// Display basic results
function displayBasicResults(amount, merchantValue) {
    if (!resultsContainer) return;
    
    resultsContainer.innerHTML = '';
    
    const cardsToCompare = currentUser ? 
        cardsData.cards.filter(card => userSelectedCards.has(card.id)) :
        cardsData.cards;
    
    cardsToCompare.forEach(card => {
        const basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card-result fade-in';
        cardDiv.innerHTML = `
            <div class="card-header">
                <div class="card-name">${card.name}</div>
            </div>
            <div class="card-details">
                <div class="detail-item">
                    <div class="detail-label">回饋率</div>
                    <div class="detail-value">${card.basicCashback}%</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">回饋金額</div>
                    <div class="detail-value">NT$${basicCashbackAmount.toLocaleString()}</div>
                    <div class="cashback-type-info">(現金回饋)</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">回饋消費上限</div>
                    <div class="detail-value">無上限</div>
                </div>
            </div>
            <div class="matched-merchant">一般消費回饋率</div>
        `;
        
        resultsContainer.appendChild(cardDiv);
    });
    
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Show error message
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

// Load user's selected cards
function loadUserCards() {
    console.log('📚 Loading user cards, currentUser:', currentUser ? currentUser.email : 'not logged in');
    
    if (!currentUser) {
        console.log('ℹ️ No current user, using all cards');
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        console.log('✅ Set all cards for non-logged user:', Array.from(userSelectedCards));
        return;
    }
    
    // For logged in users, load from localStorage
    try {
        const storageKey = `selectedCards_${currentUser.uid}`;
        const savedCards = localStorage.getItem(storageKey);
        
        if (savedCards) {
            userSelectedCards = new Set(JSON.parse(savedCards));
            console.log('✅ Loaded user cards from localStorage:', Array.from(userSelectedCards));
        } else {
            console.log('🎆 First time user, selecting all cards');
            userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        }
    } catch (error) {
        console.error('❌ Error loading user cards from localStorage:', error);
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        console.log('🔄 Defaulted to all cards due to error');
    }
}

// Show card detail (placeholder)
function showCardDetail(cardId) {
    console.log('Show card detail for:', cardId);
    alert('卡片詳情功能開發中...');
}

// Authentication setup
function setupAuthentication() {
    console.log('🔐 Setting up authentication...');
    
    const checkFirebaseReady = () => {
        console.log('🔍 Checking Firebase ready state...');
        
        if (typeof window.firebaseAuth !== 'undefined' && typeof window.db !== 'undefined') {
            console.log('✅ Firebase is ready!');
            auth = window.firebaseAuth;
            db = window.db;
            initializeAuth();
        } else {
            console.log('⏳ Firebase not ready yet, retrying...');
            setTimeout(checkFirebaseReady, 100);
        }
    };
    
    checkFirebaseReady();
}

function initializeAuth() {
    console.log('🛠️ Initializing authentication...');
    
    const signInBtn = document.getElementById('sign-in-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    const userInfo = document.getElementById('user-info');
    
    if (!signInBtn || !signOutBtn || !userInfo) {
        console.error('❌ Authentication elements not found!');
        return;
    }
    
    console.log('✅ Authentication elements found');
    
    // Sign in function
    signInBtn.addEventListener('click', async () => {
        console.log('💆 Sign in button clicked');
        
        if (!window.signInWithPopup || !window.googleProvider) {
            console.error('❌ Firebase auth functions not available');
            alert('登入功能不可用，請稍後再試');
            return;
        }
        
        try {
            console.log('🚀 Attempting sign in...');
            const result = await window.signInWithPopup(auth, window.googleProvider);
            console.log('✅ Sign in successful:', result.user.email);
        } catch (error) {
            console.error('❌ Sign in failed:', error);
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
            console.log('User signed in:', user.email);
            currentUser = user;
            signInBtn.style.display = 'none';
            userInfo.style.display = 'inline-flex';
            
            const userPhoto = document.getElementById('user-photo');
            const userName = document.getElementById('user-name');
            if (userPhoto) userPhoto.src = user.photoURL || '';
            if (userName) userName.textContent = user.displayName || user.email;
            
            loadUserCards();
            populateCardChips();
        } else {
            console.log('User signed out');
            currentUser = null;
            userSelectedCards.clear();
            signInBtn.style.display = 'inline-block';
            userInfo.style.display = 'none';
            
            populateCardChips();
        }
    });
}