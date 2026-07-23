// FAQ Page Script

// Debug 日誌閘門：正式環境靜音 log/warn，?debug=1 重新開啟（同 script.js）
(function () {
    try {
        if (!new URLSearchParams(location.search).has('debug')) {
            console.log = function () {};
            console.warn = function () {};
        }
    } catch (e) { /* ignore */ }
})();

let faqData = [];
let currentCategory = 'all';
let prerenderFAQIds = []; // Track pre-rendered FAQ IDs

// DOM Elements
const faqLoading = document.getElementById('faq-loading');
const faqError = document.getElementById('faq-error');
const faqSection = document.getElementById('faq-section');
const faqList = document.getElementById('faq-list');
const faqEmpty = document.getElementById('faq-empty');
const categoryFilter = document.getElementById('category-filter');
const retryBtn = document.getElementById('retry-btn');

// ------------------------------------------------------------------
// 手機側選單開合（2026-07-16 header 改版）。header 右側原本試過頭像＋dropdown，
// 站長二輪回饋裁定「副頁頭像做不到主站完整功能（無法登出/管理），意義不大」，
// 已退回「返回首頁」鈕（純 <a> 連結，不需要 JS 狀態切換）。
// ------------------------------------------------------------------

// 手機漢堡側選單開合：比照 script.js setupSidebarDrawer()（script.js:6727-6772）。
// faq.js 獨立載入、不共用 script.js 的 disableBodyScroll/enableBodyScroll（那組有
// refcount 是為了主站多層 modal 疊加），這裡頁面單純，簡化成直接鎖/解鎖 body 捲動。
function setupSidebarDrawer() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const closeBtn = document.getElementById('sidebar-close-btn');
    if (!sidebar || !overlay || !toggleBtn || !closeBtn) return;

    function openDrawer() {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    toggleBtn.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) closeDrawer();
    });
}

// 回到頂部浮標（手機版）：比照 script.js setupBackToTopButton()（script.js:1409-1430）——
// 捲動超過 300px 才顯示，點擊平滑捲回頂部。樣式/顯示門檻沿用 styles.css 既有的
// .back-to-top-btn（faq.html 已載入 styles.css），這裡只負責行為邏輯。
function setupBackToTopButton() {
    const btn = document.getElementById('back-to-top-btn');
    if (!btn) return;

    const toggle = () => {
        const scrolled = (window.pageYOffset || document.documentElement.scrollTop) > 300;
        btn.classList.toggle('is-visible', scrolled);
    };

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { toggle(); ticking = false; });
    }, { passive: true });

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    toggle();
}

// Initialize event listeners for pre-rendered FAQ items
function initPrerenderFAQs() {
    const prerenderItems = faqList.querySelectorAll('.faq-item[data-id]');
    prerenderItems.forEach(item => {
        const questionBtn = item.querySelector('.faq-question');
        const answerDiv = item.querySelector('.faq-answer');
        const faqId = item.dataset.id;

        // Track this ID
        prerenderFAQIds.push(faqId);

        // Add click event
        if (questionBtn && answerDiv) {
            questionBtn.addEventListener('click', () => {
                const isOpen = answerDiv.style.display !== 'none';

                if (isOpen) {
                    answerDiv.style.display = 'none';
                    questionBtn.classList.remove('active');
                } else {
                    answerDiv.style.display = 'block';
                    questionBtn.classList.add('active');
                }
            });
        }
    });
}

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

        // Read encoded text (cards.data is Base64 encoded)
        const encoded = await response.text();

        // Decode function (same as script.js)
        const decoded = decodeURIComponent(escape(atob(encoded)));
        const parsedData = JSON.parse(decoded);

        // Extract FAQ data (it should be in the faq property)
        if (parsedData.faq && Array.isArray(parsedData.faq)) {
            // Filter active items and exclude pre-rendered ones
            faqData = parsedData.faq
                .filter(item => item.isActive === true || item.isActive === 'TRUE')
                .filter(item => !prerenderFAQIds.includes(String(item.id))) // Skip pre-rendered FAQs
                .sort((a, b) => parseInt(a.order) - parseInt(b.order));

            // Even if faqData is empty (all FAQs are pre-rendered), initialize
            initializeFAQ();
            showContent();
        } else {
            // If no FAQ data exists yet, check if we have pre-rendered items
            if (prerenderFAQIds.length > 0) {
                initializeFAQ();
                showContent();
            } else {
                showError('FAQ 內容即將推出，敬請期待！');
            }
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
    // Get categories from dynamic data
    const dynamicCategories = faqData.map(item => item.category);

    // Get categories from pre-rendered items
    const prerenderItems = faqList.querySelectorAll('.faq-item[data-category]');
    const prerenderCategories = Array.from(prerenderItems).map(item => item.dataset.category);

    // Combine and get unique categories
    const categories = ['all', ...new Set([...dynamicCategories, ...prerenderCategories])];

    // Clear existing buttons
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
    // Filter dynamic items by category
    const filteredItems = category === 'all'
        ? faqData
        : faqData.filter(item => item.category === category);

    // Handle pre-rendered items visibility
    const prerenderItems = faqList.querySelectorAll('.faq-item[data-category]');
    prerenderItems.forEach(item => {
        if (category === 'all' || item.dataset.category === category) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });

    // Remove previously dynamically added items (marked with data-dynamic)
    const dynamicItems = faqList.querySelectorAll('.faq-item[data-dynamic="true"]');
    dynamicItems.forEach(item => item.remove());

    // Count visible items
    const visiblePrerenderCount = Array.from(prerenderItems).filter(item => item.style.display !== 'none').length;
    const totalVisibleCount = visiblePrerenderCount + filteredItems.length;

    if (totalVisibleCount === 0) {
        faqEmpty.style.display = 'block';
        return;
    }

    faqEmpty.style.display = 'none';

    // Create and append dynamic FAQ items
    filteredItems.forEach(item => {
        const faqItem = createFAQItem(item);
        faqList.appendChild(faqItem);
    });
}

// HTML 轉義（faq.js 獨立載入，不共用 script.js 的 helper）
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Create a single FAQ item (accordion)
function createFAQItem(item) {
    const faqItem = document.createElement('div');
    faqItem.className = 'faq-item';
    faqItem.id = `faq-${item.id}`; // Add anchor ID for cross-linking
    faqItem.dataset.id = item.id;
    faqItem.dataset.category = item.category; // Add category for auto-switching
    faqItem.dataset.dynamic = 'true'; // Mark as dynamically created

    // Question button
    const questionBtn = document.createElement('button');
    questionBtn.className = 'faq-question';
    questionBtn.innerHTML = `
        <span class="question-text">${escapeHtml(item.question)}</span>
        <span class="toggle-icon">▼</span>
    `;

    // Answer content
    // ⚠️ answer 是「刻意」允許 HTML 的：內容來自 FAQ 工作表（管理者控制），
    // 可放 <a>、<b> 等排版。不要把使用者輸入餵進這個欄位。
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

// Handle FAQ anchor links (cross-linking between FAQs)
function handleFAQAnchorLinks() {
    console.log('FAQ anchor links handler initialized');

    // Function to expand a specific FAQ by ID with retry mechanism
    function expandFAQ(faqId, retries = 10) {
        console.log(`Attempting to expand FAQ: ${faqId}, retries left: ${retries}`);
        const faqItem = document.getElementById(faqId);

        if (!faqItem) {
            console.log(`FAQ ${faqId} not found in DOM`);
            // FAQ not found, retry after delay (might still be loading)
            if (retries > 0) {
                setTimeout(() => {
                    expandFAQ(faqId, retries - 1);
                }, 400); // Retry every 400ms
            } else {
                console.warn(`FAQ ${faqId} not found after all retries`);
            }
            return false;
        }

        console.log(`FAQ ${faqId} found, checking visibility`);

        // Check if FAQ is hidden by category filter
        if (faqItem.style.display === 'none') {
            console.log(`FAQ ${faqId} is hidden by category filter`);
            // Switch to the FAQ's category or 'all'
            const faqCategory = faqItem.dataset.category;
            if (faqCategory) {
                console.log(`Switching to category: ${faqCategory}`);
                currentCategory = faqCategory;
                updateCategoryFilter();
                renderFAQItems(currentCategory);

                // Wait for render to complete, then try again
                setTimeout(() => {
                    expandFAQ(faqId, 0); // No more retries after category switch
                }, 300);
                return false;
            }
        }

        const questionBtn = faqItem.querySelector('.faq-question');
        const answerDiv = faqItem.querySelector('.faq-answer');

        if (questionBtn && answerDiv) {
            console.log(`Expanding FAQ ${faqId}`);
            // Expand the FAQ
            answerDiv.style.display = 'block';
            questionBtn.classList.add('active');

            // Scroll to the FAQ with smooth behavior
            setTimeout(() => {
                faqItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
                console.log(`Scrolled to FAQ ${faqId}`);
                // Highlight the FAQ briefly
                faqItem.style.transition = 'background-color 0.3s';
                faqItem.style.backgroundColor = 'rgba(139, 92, 246, 0.1)';
                setTimeout(() => {
                    faqItem.style.backgroundColor = '';
                }, 2000);
            }, 150);

            return true;
        }
        console.warn(`FAQ ${faqId} found but missing question or answer elements`);
        return false;
    }

    // Handle hash on page load
    if (window.location.hash) {
        const hash = window.location.hash.substring(1); // Remove #
        console.log(`Hash detected on page load: ${hash}`);
        if (hash.startsWith('faq-')) {
            setTimeout(() => {
                console.log('Starting FAQ expansion from page load hash');
                expandFAQ(hash);
            }, 1500); // Longer initial delay for FAQ data to load
        }
    }

    // Handle hash change (when clicking anchor links)
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.substring(1);
        console.log(`Hash changed: ${hash}`);
        if (hash.startsWith('faq-')) {
            expandFAQ(hash);
        }
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setupSidebarDrawer();
    setupBackToTopButton();
    initPrerenderFAQs(); // Initialize pre-rendered FAQ event listeners
    loadFAQData();
    handleFAQAnchorLinks(); // Handle cross-linking between FAQs
});
