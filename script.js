// Global variables
let currentUser = null;
let userSelectedCards = new Set();
let auth = null;
let db = null;
let cardsData = null;

// DOM elements
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
    
    // Load cards data
    const dataLoaded = await loadCardsData();
    if (!dataLoaded) {
        showErrorMessage('信用卡資料載入失敗');
        return;
    }
    
    // Initialize user cards (all cards for non-logged users)
    loadUserCards();
    
    // Populate card chips
    populateCardChips();
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup authentication
    setupAuthentication();
});

// Load cards data from JSON file
async function loadCardsData() {
    try {
        const response = await fetch('./cards.json');
        if (!response.ok) throw new Error('Failed to fetch cards data');
        cardsData = await response.json();
        console.log('✅ Cards data loaded:', cardsData.cards.length, 'cards');
        return true;
    } catch (error) {
        console.error('❌ Error loading cards data:', error);
        return false;
    }
}

// Populate card chips in header
function populateCardChips() {
    console.log('🔄 Populating card chips...');
    
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
    
    if (cardsToShow.length === 0) {
        cardChipsContainer.innerHTML = '<div style="color: #666; padding: 10px;">尚未選擇任何信用卡</div>';
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
    if (!merchantInput || !amountInput || !calculateBtn) return;

    // Merchant input
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

// Calculate cashback for all cards
function calculateCashback() {
    if (!cardsData) return;
    
    const amount = parseFloat(amountInput.value);
    const merchantValue = merchantInput.value.trim();
    
    displayResults(amount, merchantValue);
}

// Display results
function displayResults(amount, merchantValue) {
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
    
    if (resultsSection) {
        resultsSection.style.display = 'block';
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Show card detail (placeholder)
function showCardDetail(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    if (card) {
        alert(`卡片詳情：${card.fullName || card.name}\n基本回饋：${card.basicCashback}%`);
    }
}

// Load user's selected cards
function loadUserCards() {
    if (!currentUser) {
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        return;
    }
    
    try {
        const storageKey = `selectedCards_${currentUser.uid}`;
        const savedCards = localStorage.getItem(storageKey);
        
        if (savedCards) {
            userSelectedCards = new Set(JSON.parse(savedCards));
        } else {
            userSelectedCards = new Set(cardsData.cards.map(card => card.id));
        }
    } catch (error) {
        console.error('Error loading user cards:', error);
        userSelectedCards = new Set(cardsData.cards.map(card => card.id));
    }
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

// Authentication setup
function setupAuthentication() {
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
    
    if (!signInBtn || !signOutBtn || !userInfo) return;
    
    // Sign in function
    signInBtn.addEventListener('click', async () => {
        if (!window.signInWithPopup || !window.googleProvider) {
            alert('登入功能不可用，請稍後再試');
            return;
        }
        
        try {
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
    
    // Auth state changes
    window.onAuthStateChanged(auth, (user) => {
        if (user) {
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
            currentUser = null;
            userSelectedCards.clear();
            signInBtn.style.display = 'inline-block';
            userInfo.style.display = 'none';
            
            populateCardChips();
        }
    });
}