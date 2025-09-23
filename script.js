// Emergency minimal version with working cards display
let currentUser = null;
let userSelectedCards = new Set();
let auth = null;
let db = null;

// Simple card data with ONLY English to avoid encoding issues
const cardsData = {
  "cards": [
    {
      "id": "taishin-richart",
      "name": "Taishin Richart Card",
      "basicCashback": 0.3
    },
    {
      "id": "yushan-unicard", 
      "name": "Yushan Uni Card",
      "basicCashback": 1.0
    },
    {
      "id": "cathay-cube",
      "name": "Cathay CUBE Card", 
      "basicCashback": 0.3
    }
  ]
};

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, initializing...');
    
    // Initialize user cards for non-logged users
    userSelectedCards = new Set(cardsData.cards.map(card => card.id));
    
    // Populate cards immediately
    populateCardChips();
    
    // Setup basic event listeners
    const calculateBtn = document.getElementById('calculate-btn');
    const merchantInput = document.getElementById('merchant-input');
    const amountInput = document.getElementById('amount-input');
    
    if (calculateBtn && merchantInput && amountInput) {
        calculateBtn.addEventListener('click', () => {
            const amount = parseFloat(amountInput.value);
            if (amount > 0) {
                displayResults(amount);
            }
        });
    }
    
    // Try to setup authentication
    setupAuthentication();
});

// Populate card chips in header
function populateCardChips() {
    console.log('Populating card chips...');
    
    const cardChipsContainer = document.getElementById('card-chips');
    if (!cardChipsContainer) {
        console.error('card-chips container not found!');
        return;
    }
    
    // Clear existing chips
    cardChipsContainer.innerHTML = '';
    
    // Show all cards
    cardsData.cards.forEach(card => {
        const chip = document.createElement('div');
        chip.className = 'card-chip chip-clickable';
        chip.textContent = card.name;
        chip.addEventListener('click', () => alert('Card detail: ' + card.name));
        cardChipsContainer.appendChild(chip);
    });
    
    console.log('Successfully populated', cardsData.cards.length, 'card chips');
}

// Display basic results
function displayResults(amount) {
    const resultsContainer = document.getElementById('results-container');
    const resultsSection = document.getElementById('results-section');
    
    if (!resultsContainer) return;
    
    resultsContainer.innerHTML = '';
    
    cardsData.cards.forEach(card => {
        const cashback = Math.floor(amount * card.basicCashback / 100);
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card-result fade-in';
        cardDiv.innerHTML = `
            <div class="card-header">
                <div class="card-name">${card.name}</div>
            </div>
            <div class="card-details">
                <div class="detail-item">
                    <div class="detail-label">Cashback Rate</div>
                    <div class="detail-value">${card.basicCashback}%</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Cashback Amount</div>
                    <div class="detail-value">NT$${cashback.toLocaleString()}</div>
                </div>
            </div>
        `;
        
        resultsContainer.appendChild(cardDiv);
    });
    
    if (resultsSection) {
        resultsSection.style.display = 'block';
    }
}

// Basic authentication setup
function setupAuthentication() {
    const checkFirebaseReady = () => {
        if (typeof window.firebaseAuth !== 'undefined') {
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
            alert('Login function not available');
            return;
        }
        
        try {
            const result = await window.signInWithPopup(auth, window.googleProvider);
            console.log('Sign in successful:', result.user.email);
        } catch (error) {
            console.error('Sign in failed:', error);
            alert('Login failed: ' + error.message);
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
        } else {
            currentUser = null;
            signInBtn.style.display = 'inline-block';
            userInfo.style.display = 'none';
        }
    });
}