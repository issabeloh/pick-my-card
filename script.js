// Global variables
let currentUser = null;
let userSelectedCards = new Set(); // Store user's selected card IDs
let cardsData = {
  "cards": [
    {
      "id": "taishin-richart",
      "name": "台新Richart卡",
      "basicCashback": 0.3,
      "billingDate": "20日",
      "cashbackRates": [
        {
          "rate": 3.8,
          "cap": 480000,
          "items": ["台灣Pay場域", "超商（單筆限額最高 NT3,000元，且不含代收水電稅費/禮物卡/儲值"]
        },
        {
          "rate": 3.3,
          "cap": 480000,
          "items": [
            "華航", "長榮", "星宇", "虎航", "國泰航空", "華信", "立榮", "klook", "kkday", "airsim", "agoda", "booking.com", "trip.com", "airbnb", "hotels.com", "expedia", "雄獅旅遊", "易遊網", "東南旅遊", "海外實體", "海外線上", "蝦皮", "momo", "酷澎", "coupang", "pchome", "yahoo", "amazon", "東森", "博客來", "richart mart", "hahow", "pressplay", "amazing talker", "udemy", "kobo", "readmoo", "uniqlo", "gu", "zara", "net", "lativ", "gap", "uber eats", "foodpanda", "中油直營", "台亞直營", "全國加油", "源點evoasis", "華城電能evalue", "拓元售票", "kktix", "年代售票", "寬宏售票", "opentix兩廳院文化生活", "晶華國際酒店集團", "台灣萬豪國際集團旗下飯店", "煙波飯店", "老爺酒店集團", "福華集團", "漢來飯店事業群", "台北君悅酒店", "高雄洲際酒店", "礁溪寒沐", "義大遊樂世界", "麗寶樂園", "六福村主題遊樂園", "九族文化村", "劍湖山世界主題遊樂園", "x-park", "國立海洋生物博物館", "遠雄海洋公園", "大魯閣", "小人國主題樂園", "全台餐飲新光三越", "遠東sogo", "廣三sogo", "遠東百貨", "微風", "台北101", "遠東巨城", "南紡購物中心", "漢神百貨", "漢神巨蛋", "誠品生活", "mitsui shopping park", "lalaport", "mitsui outlet park", "華泰名品城", "skm park outlets", "ikea", "特力屋", "hola", "宜得利", "瑪黑家居", "7-11", "全家", "家樂福", "大買家", "臺鐵", "高鐵", "台灣大車隊", "linego", "yoxi", "uber", "嘟嘟房", "autopass", "城市車旅", "vivipark", "uspace", "udrive", "irent", "和運租車", "格上租車"
          ]
        }
      ]
    },
    {
      "id": "yushan-unicard",
      "name": "玉山UniCard",
      "basicCashback": 1.0,
      "billingDate": "7日",
      "cashbackRates": [
        {
          "rate": 3.5,
          "cap": 20000,
          "items": [
            "linepay", "街口", "悠遊付", "全盈支付", "全支付", "橘子支付", "momo購物網", "蝦皮購物", "淘寶", "coupang", "東森購物", "博客來", "新光三越", "台北101", "華泰名品城", "三井outlet", "京站", "美麗華", "秀泰生活", "lalaport", "統領廣場", "采盟", "昇恆昌", "太平洋百貨", "統一時代百貨", "遠東百貨", "遠東sogo", "遠東巨城", "大遠百", "漢神百貨", "微風廣場", "微風信義", "微風南京", "微風南山", "微風台北車站", "誠品生活", "誠品線上", "誠品書店", "家樂福", "屈臣氏", "特力屋", "hola", "hoi好好生活", "uniqlo", "net", "大樹藥局", "丁丁藥妝", "uber eats", "ubereats", "foodpanda", "eztable", "王品瘋美食", "摩斯", "路易莎", "饗食天堂", "果然匯", "加集", "開飯", "響泰多", "真珠", "瓦城", "非常泰", "時時香", "1010湘", "大心", "乾杯燒肉居酒屋", "老乾杯", "漢來海港", "島語", "漢來蔬食", "漢來名人坊", "東方樓", "漢來上海湯包", "溜溜酸菜", "魚專賣店", "上菜片皮鴨", "翠園", "漢來軒", "焰", "pavo", "精瀲海鮮火鍋", "日本料理弁慶", "福園台菜海鮮", "日日烘焙坊", "糕餅小舖", "台北漢來大廳酒廊", "hi lai cafe", "台灣中油", "台灣大車隊", "台鐵", "高鐵", "yoxi", "桃園機場捷運", "中華航空", "長榮航空", "日本航空", "台灣虎航", "樂桃航空", "酷航", "立榮航空", "華信航空", "trip.com", "booking.com", "hotels.com", "asiayo", "expedia", "kkday", "klook", "雄獅旅", "可樂旅", "東南旅行社", "apple直營", "小米台灣", "全國電子", "燦坤", "迪卡儂", "寵物公園", "youbike2.0", "youbike 2.0"
          ]
        }
      ]
    },
    {
      "id": "cathay-cube",
      "name": "國泰CUBE卡",
      "basicCashback": 0.3,
      "billingDate": "15日",
      "cashbackRates": [
        {
          "rate": 2.0,
          "cap": null,
          "items": [
            "chatgpt", "canva", "claude", "cursor", "duolingo", "gamma", "gemini", "notion", "perplexity", "speak", "apple 媒體服務", "google play", "disney+", "netflix", "spotify", "kkbox", "youtube premium", "max", "蝦皮", "momo", "pchome", "小樹購", "淘寶/天貓", "遠東sogo百貨", "遠東garden city", "太平洋百貨", "新光三越", "skm park", "bellavita", "微風廣場", "遠東百貨", "big city遠東巨城購物中心", "誠品生活", "環球購物中心", "citylink", "統一時代台北店", "台北101", "att 4 fun", "明曜百貨", "京站", "美麗華", "大葉高島屋", "比漾廣場", "大江國際購物中心", "中友百貨", "廣三sogo", "tiger city", "勤美誠品綠園道", "大魯閣新時代", "耐斯廣場", "南紡購物中心", "夢時代", "漢神百貨", "漢神巨蛋", "mitsui outlet park", "mitsui shopping park lalaport", "義大世界購物廣場", "華泰名品城", "義享天地", "麗寶outlet mall", "秀泰生活", "台茂購物中心", "新月廣場", "三創生活", "宏匯廣場", "noke忠泰樂生活", "uber eats", "foodpanda", "國內餐飲", "麥當勞", "康是美", "屈臣氏", "海外實體消費", "東京迪士尼樂園", "東京華納兄弟哈利波特影城", "大阪環球影城", "apple錢包指定交通卡", "uber", "grab", "台灣高鐵", "yoxi", "台灣大車隊", "irent", "和運租車", "格上租車", "中華航空", "長榮航空", "星宇航空", "台灣虎航", "國泰航空", "樂桃航空", "阿聯酋航空", "酷航", "捷星航空", "日本航空", "ana全日空", "亞洲航空", "聯合航空", "新加坡航空", "越捷航空", "大韓航空", "達美航空", "土耳其航空", "卡達航空", "法國航空", "星野集團", "全球迪士尼飯店", "東橫inn", "國內飯店住宿", "kkday", "agoda", "klook", "airbnb", "booking.com", "trip.com", "eztravel易遊網", "雄獅旅遊", "可樂旅遊", "東南旅遊", "五福旅遊", "燦星旅遊", "山富旅遊", "長汎假期", "鳳凰旅行社", "ezfly易飛網", "理想旅遊", "永利旅行社", "三賀旅行社", "家樂福", "lopia台灣", "全聯福利中心", "台灣中油-直營站", "7-11", "全家", "ikea", "linepay"
          ]
        }
      ]
    },
    {
      "id": "sinopac-sport",
      "name": "永豐Sport卡",
      "basicCashback": 1.0,
      "billingDate": "12日",
      "cashbackRates": [
        {
          "rate": 7.0,
          "cap": 7500,
          "items": [
            "world gym", "健身工廠", "true yoga", "curves", "運動中心", "anytime fitness", "屈臣氏", "康是美", "寶雅", "好心肝", "杏一", "大樹藥局", "丁丁藥局", "新高橋藥局", "app store", "google play", "nintendo", "playstation", "steam", "apple pay", "google pay", "samsung pay", "garmin pay"
          ]
        }
      ]
    },
    {
      "id": "sinopac-green",
      "name": "永豐Green卡",
      "basicCashback": 1.0,
      "billingDate": "12日",
      "cashbackRates": [
        {
          "rate": 5.0,
          "cap": 7500,
          "items": [
            "藏壽司", "mos", "築間", "義美食品", "馬可先生", "寬心園", "miacucina", "小小樹食", "陽明春天", "屋馬", "熱浪島", "草蔬宴", "原素食府", "herbivore", "印度蔬食", "養心茶樓", "山海樓", "qburger", "麥味登", "一之軒", "捷絲旅", "承億", "煙波", "翰品", "希爾頓", "國賓", "福容", "新驛", "圓山", "城市商旅", "凱薩", "老爺", "新光影城", "威秀", "喜樂時代", "kktix", "拓元售票", "全國電子", "studioa", "straighta", "大潤發", "家樂福", "愛買", "uniqlo", "h&m", "zara", "gu", "gap", "net", "o'right", "aesop", "10/10 hope", "主婦聯盟", "里仁", "棉花田", "聖德科斯", "義美生機", "統一生機", "綠藤生機", "茶籽堂", "艾瑪絲", "長庚生技", "營養師輕食", "安永鮮物", "野菜村", "無毒的家", "無毒農", "健康食彩", "直接跟農夫買", "irent", "zipcar", "gosmart", "goshare", "gogoro", "wemo", "line go", "tesla 充電", "裕電俥電", "evalue", "evoasis", "sharkparking", "zocha", "begin", "星舟快充", "emoving", "emoving 電池", "悠遊卡自動加值", "悠遊卡加值", "悠遊卡 自動加值"
          ]
        }
      ]
    },
    {
      "id": "sinopac-daway",
      "name": "永豐DAWAY卡",
      "basicCashback": 0.5,
      "billingDate": "12日",
      "cashbackRates": [
        {
          "rate": 4.0,
          "cap": null,
          "items": ["海外"]
        },
        {
          "rate": 2.0,
          "cap": 20000,
          "items": ["linepay"]
        }
      ]
    },
    {
      "id": "yushan-ubear",
      "name": "玉山ubear卡",
      "basicCashback": 1.0,
      "billingDate": "7日",
      "cashbackRates": [
        {
          "rate": 3.0,
          "cap": 7500,
          "items": [
            "line pay", "街口支付", "悠遊付", "open錢包", "icash pay", "全盈+pay", "全支付", "橘子支付", "skm pay", "中油pay", "玉山wallet", "pi 拍錢包", "歐付寶行動支付", "paypal", "hami pay掃碼付", "pchome", "momo購物網", "蝦皮", "coupang酷澎", "yahoo購物中心", "yahoo拍賣", "淘寶", "露天", "博客來", "全電商", "生活市集", "松果購物", "誠品網路書店", "friday購物", "udn售票網", "gomaji", "17life", "樂天市場", "citiesocial", "91-app", "媽咪愛", "屈臣氏網路商城", "康是美線上商城", "家樂福線上購物", "神腦商城", "燦坤線上購物", "瘋狂賣客", "myfone購物", "486團購網", "86小舖", "小三美日", "apple官網", "studio a官網", "straight a官網", "台灣小米", "台灣索尼股份有限公司", "良興eclife購物網", "isunfar愛順發3c購物網", "迪卡儂線上購物", "拓元售票系統", "zara", "h&m", "gu網路商店", "uniqlo網路商店", "ob 嚴選", "lativ米格國際", "genquo", "zalora", "mos線上儲值", "星巴克線上儲值", "ibon售票系統", "ibon mart 統一超商線上購物中心", "eztable", "pinkoi", "55688 app", "uber", "呼叫小黃", "台灣高鐵t-ex行動購票", "台鐵線上購票", "eztravel", "agoda", "hotels.com", "expedia", "klook", "kkday", "booking.com", "airbnb", "中華航空", "長榮航空", "台灣虎航", "uber eats", "foodpanda", "foodomo", "lalamove", "你訂", "kkbox", "itunes", "google play", "funnow"
          ]
        }
      ]
    }
  ]
};
let currentMatchedItem = null;

// DOM elements
const merchantInput = document.getElementById('merchant-input');
const amountInput = document.getElementById('amount-input');
const calculateBtn = document.getElementById('calculate-btn');
const resultsSection = document.getElementById('results-section');
const resultsContainer = document.getElementById('results-container');
const matchedItemDiv = document.getElementById('matched-item');

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
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
        chip.className = 'card-chip';
        chip.textContent = card.name;
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
                const basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
                return {
                    rate: card.basicCashback,
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
            const basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
            return {
                rate: card.basicCashback,
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
}

// Calculate cashback for a specific card
function calculateCardCashback(card, searchTerm, amount) {
    let bestRate = 0;
    let applicableCap = null;
    let matchedItem = null;
    
    for (const rateGroup of card.cashbackRates) {
        for (const item of rateGroup.items) {
            if (item.toLowerCase().includes(searchTerm) || 
                searchTerm.includes(item.toLowerCase())) {
                if (rateGroup.rate > bestRate) {
                    bestRate = rateGroup.rate;
                    applicableCap = rateGroup.cap;
                    matchedItem = item;
                }
            }
        }
    }
    
    let cashbackAmount = 0;
    let effectiveAmount = amount;
    
    if (bestRate > 0) {
        // Apply cap if exists
        if (applicableCap && amount > applicableCap) {
            effectiveAmount = applicableCap;
        }
        
        cashbackAmount = Math.floor(effectiveAmount * bestRate / 100);
    }
    
    return {
        rate: bestRate,
        cashbackAmount: cashbackAmount,
        cap: applicableCap,
        matchedItem: matchedItem,
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

// Create card result element
function createCardResultElement(result, originalAmount, searchedItem, isBest, isBasicCashback = false) {
    const cardDiv = document.createElement('div');
    cardDiv.className = `card-result fade-in ${isBest ? 'best-card' : ''} ${result.cashbackAmount === 0 ? 'no-cashback' : ''}`;
    
    const capText = result.cap ? `NT$${result.cap.toLocaleString()}` : '無上限';
    const cashbackText = result.cashbackAmount > 0 ? 
                        `NT$${result.cashbackAmount.toLocaleString()}` : 
                        '無回饋';
    
    cardDiv.innerHTML = `
        <div class="card-header">
            <div class="card-name">${result.card.name}</div>
            ${isBest ? '<div class="best-badge">最優回饋</div>' : ''}
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">回饋率</div>
                <div class="detail-value">${result.rate > 0 ? `${result.rate}%` : '0%'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋金額</div>
                <div class="detail-value ${result.cashbackAmount > 0 ? 'cashback-amount' : 'no-cashback-text'}">${cashbackText}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">${isBasicCashback ? '結帳日' : '消費限制'}</div>
                <div class="detail-value">${isBasicCashback ? result.card.billingDate : capText}</div>
            </div>
        </div>
        ${isBasicCashback ? `
            <div class="matched-merchant">
                一般消費回饋率
            </div>
        ` : (result.matchedItem ? `
            <div class="matched-merchant">
                匹配項目: <strong>${result.matchedItem}</strong>
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
        if (typeof window.firebaseAuth !== 'undefined') {
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
            const result = await window.signInWithPopup(window.firebaseAuth, window.googleProvider);
            console.log('Sign in successful:', result.user);
        } catch (error) {
            console.error('Sign in failed:', error);
            alert('登入失敗：' + error.message);
        }
    });
    
    // Sign out function
    signOutBtn.addEventListener('click', async () => {
        try {
            await window.signOut(window.firebaseAuth);
            console.log('Sign out successful');
        } catch (error) {
            console.error('Sign out failed:', error);
        }
    });
    
    // Listen for authentication state changes
    window.onAuthStateChanged(window.firebaseAuth, async (user) => {
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
}

// Open manage cards modal
function openManageCardsModal() {
    const modal = document.getElementById('manage-cards-modal');
    const cardsSelection = document.getElementById('cards-selection');
    
    // Populate cards selection
    cardsSelection.innerHTML = '';
    
    cardsData.cards.forEach(card => {
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
    
    modal.style.display = 'flex';
}
