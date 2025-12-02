// FAQ Page Script
let faqData = [];
let currentCategory = 'all';

// DOM Elements
const faqLoading = document.getElementById('faq-loading');
const faqError = document.getElementById('faq-error');
const faqSection = document.getElementById('faq-section');
const faqList = document.getElementById('faq-list');
const faqEmpty = document.getElementById('faq-empty');
const categoryFilter = document.getElementById('category-filter');
const retryBtn = document.getElementById('retry-btn');

// Load FAQ data from cards.data
async function loadFAQData() {
    try {
        showLoading();

        // Add cache busting timestamp
        const timestamp = new Date().getTime();
        const response = await fetch(`cards.data?t=${timestamp}`);

        if (!response.ok) {
            throw new Error('Failed to fetch FAQ data');
        }

        const data = await response.text();
        const parsedData = JSON.parse(data);

        // Extract FAQ data (it should be in the faq property)
        if (parsedData.faq && Array.isArray(parsedData.faq)) {
            faqData = parsedData.faq
                .filter(item => item.isActive === true || item.isActive === 'TRUE')
                .sort((a, b) => parseInt(a.order) - parseInt(b.order));

            if (faqData.length === 0) {
                showError('目前沒有可用的 FAQ 內容。');
                return;
            }

            initializeFAQ();
            showContent();
        } else {
            // If no FAQ data exists yet, show a friendly message
            showError('FAQ 內容即將推出，敬請期待！');
        }
    } catch (error) {
        console.error('Error loading FAQ data:', error);
        showError('載入 FAQ 資料時發生錯誤，請稍後再試。');
    }
}

// Initialize FAQ - build categories and render items
function initializeFAQ() {
    buildCategoryFilter();
    renderFAQItems(currentCategory);
}

// Build category filter buttons
function buildCategoryFilter() {
    // Get unique categories
    const categories = ['all', ...new Set(faqData.map(item => item.category))];

    // Clear existing buttons except "全部"
    categoryFilter.innerHTML = '';

    // Create category buttons
    categories.forEach(category => {
        const button = document.createElement('button');
        button.className = 'category-btn';
        button.dataset.category = category;
        button.textContent = category === 'all' ? '全部' : category;

        if (category === currentCategory) {
            button.classList.add('active');
        }

        button.addEventListener('click', () => {
            currentCategory = category;
            updateCategoryFilter();
            renderFAQItems(category);
        });

        categoryFilter.appendChild(button);
    });
}

// Update category filter active state
function updateCategoryFilter() {
    const buttons = categoryFilter.querySelectorAll('.category-btn');
    buttons.forEach(btn => {
        if (btn.dataset.category === currentCategory) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Render FAQ items
function renderFAQItems(category) {
    // Filter items by category
    const filteredItems = category === 'all'
        ? faqData
        : faqData.filter(item => item.category === category);

    // Clear existing items
    faqList.innerHTML = '';

    if (filteredItems.length === 0) {
        faqEmpty.style.display = 'block';
        return;
    }

    faqEmpty.style.display = 'none';

    // Create FAQ items
    filteredItems.forEach(item => {
        const faqItem = createFAQItem(item);
        faqList.appendChild(faqItem);
    });
}

// Create a single FAQ item (accordion)
function createFAQItem(item) {
    const faqItem = document.createElement('div');
    faqItem.className = 'faq-item';
    faqItem.dataset.id = item.id;

    // Question button
    const questionBtn = document.createElement('button');
    questionBtn.className = 'faq-question';
    questionBtn.innerHTML = `
        <span class="question-text">${item.question}</span>
        <span class="toggle-icon">▼</span>
    `;

    // Answer content
    const answerDiv = document.createElement('div');
    answerDiv.className = 'faq-answer';
    answerDiv.style.display = 'none';
    answerDiv.innerHTML = `
        <div class="answer-content">
            ${item.answer}
        </div>
    `;

    // Toggle accordion on click
    questionBtn.addEventListener('click', () => {
        const isOpen = answerDiv.style.display !== 'none';

        if (isOpen) {
            // Close this item
            answerDiv.style.display = 'none';
            questionBtn.classList.remove('active');
        } else {
            // Open this item
            answerDiv.style.display = 'block';
            questionBtn.classList.add('active');
        }
    });

    faqItem.appendChild(questionBtn);
    faqItem.appendChild(answerDiv);

    return faqItem;
}

// Show loading state
function showLoading() {
    faqLoading.style.display = 'flex';
    faqError.style.display = 'none';
    faqSection.style.display = 'none';
}

// Show error state
function showError(message) {
    faqLoading.style.display = 'none';
    faqError.style.display = 'flex';
    faqSection.style.display = 'none';

    // Update error message if provided
    if (message) {
        const errorText = faqError.querySelector('p');
        if (errorText) {
            errorText.textContent = message;
        }
    }
}

// Show content
function showContent() {
    faqLoading.style.display = 'none';
    faqError.style.display = 'none';
    faqSection.style.display = 'block';
}

// Retry loading
if (retryBtn) {
    retryBtn.addEventListener('click', () => {
        loadFAQData();
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadFAQData();
});
