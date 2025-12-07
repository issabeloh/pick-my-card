// FAQ Page Script
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

    // Remove previously dynamically added items (those without data-category)
    const dynamicItems = faqList.querySelectorAll('.faq-item:not([data-category])');
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

// Create a single FAQ item (accordion)
function createFAQItem(item) {
    const faqItem = document.createElement('div');
    faqItem.className = 'faq-item';
    faqItem.id = `faq-${item.id}`; // Add anchor ID for cross-linking
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
    initPrerenderFAQs(); // Initialize pre-rendered FAQ event listeners
    loadFAQData();
    initReviewSystem();
    handleFAQAnchorLinks(); // Handle cross-linking between FAQs
});

// ============================================
// Body scroll lock utilities
// ============================================

function disableBodyScroll() {
    document.body.style.overflow = 'hidden';
}

function enableBodyScroll() {
    document.body.style.overflow = '';
}

// ============================================
// Review System (Star Rating)
// ============================================

let selectedRating = 0;

function initReviewSystem() {
    const openReviewBtn = document.getElementById('open-review-btn');
    const starsModal = document.querySelectorAll('.star-modal');
    const starRatingModal = document.getElementById('star-rating-modal');
    const reviewFeedback = document.getElementById('review-feedback');
    const reviewModal = document.getElementById('review-modal');
    const reviewModalTitle = document.getElementById('review-modal-title');
    const reviewCommentSection = document.getElementById('review-comment-section');
    const reviewComment = document.getElementById('review-comment');
    const reviewCharCount = document.getElementById('review-char-count');
    const submitReviewBtn = document.getElementById('submit-review-btn');
    const skipReviewBtn = document.getElementById('skip-review-btn');
    const closeReviewModal = document.getElementById('close-review-modal');
    const reviewError = document.getElementById('review-error');

    // Check if user has already reviewed
    const hasReviewed = localStorage.getItem('hasReviewed');
    if (hasReviewed) {
        if (openReviewBtn) {
            openReviewBtn.style.opacity = '0.5';
            openReviewBtn.style.pointerEvents = 'none';
        }
        return;
    }

    // Open review modal button
    if (openReviewBtn) {
        openReviewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openReviewModalInitial();
        });
    }

    // Star hover effect in modal
    starsModal.forEach(star => {
        star.addEventListener('mouseenter', () => {
            const rating = parseInt(star.dataset.rating);
            highlightModalStars(rating);
        });
    });

    if (starRatingModal) {
        starRatingModal.addEventListener('mouseleave', () => {
            highlightModalStars(selectedRating);
        });
    }

    // Star click handler in modal
    starsModal.forEach(star => {
        star.addEventListener('click', () => {
            const rating = parseInt(star.dataset.rating);
            selectedRating = rating;
            highlightModalStars(rating);
        });
    });

    // Character counter
    if (reviewComment) {
        reviewComment.addEventListener('input', () => {
            reviewCharCount.textContent = reviewComment.value.length;
        });
    }

    // Submit review
    if (submitReviewBtn) {
        submitReviewBtn.addEventListener('click', async () => {
            await submitReview();
        });
    }

    // Skip review - close modal without submitting
    if (skipReviewBtn) {
        skipReviewBtn.addEventListener('click', () => {
            closeReviewModalHandler();
        });
    }

    // Close modal
    if (closeReviewModal) {
        closeReviewModal.addEventListener('click', closeReviewModalHandler);
    }

    // Close on backdrop click
    if (reviewModal) {
        reviewModal.addEventListener('click', (e) => {
            if (e.target === reviewModal) {
                closeReviewModalHandler();
            }
        });
    }
}

function highlightModalStars(rating) {
    const stars = document.querySelectorAll('.star-modal');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.classList.add('hover');
            star.classList.add('selected');
        } else {
            star.classList.remove('hover');
            star.classList.remove('selected');
        }
    });
}

function openReviewModalInitial() {
    const reviewModal = document.getElementById('review-modal');
    const reviewModalTitle = document.getElementById('review-modal-title');
    const reviewComment = document.getElementById('review-comment');
    const reviewCharCount = document.getElementById('review-char-count');
    const reviewError = document.getElementById('review-error');

    // Reset state
    selectedRating = 0;
    highlightModalStars(0);
    reviewModalTitle.textContent = '請為我們評分';
    reviewComment.value = '';
    reviewCharCount.textContent = '0';
    reviewError.style.display = 'none';

    // Show modal
    reviewModal.style.display = 'flex';
    disableBodyScroll();
}

function closeReviewModalHandler() {
    const reviewModal = document.getElementById('review-modal');
    reviewModal.style.display = 'none';
    enableBodyScroll();
    // Reset selected rating if user closes without submitting
    if (!localStorage.getItem('hasReviewed')) {
        selectedRating = 0;
        highlightModalStars(0);
    }
}

async function submitReview() {
    const reviewComment = document.getElementById('review-comment');
    const submitReviewBtn = document.getElementById('submit-review-btn');
    const reviewError = document.getElementById('review-error');

    const comment = reviewComment.value.trim();

    // Validate rating
    if (!selectedRating || selectedRating === 0) {
        reviewError.textContent = '請先選擇星星評分';
        reviewError.style.display = 'block';
        return;
    }

    // Disable button
    submitReviewBtn.disabled = true;
    submitReviewBtn.textContent = '送出中...';
    reviewError.style.display = 'none';

    try {
        // Check if Firebase is initialized
        if (!window.db || !window.collection || !window.addDoc || !window.serverTimestamp) {
            throw new Error('Firebase not initialized');
        }

        const reviewData = {
            rating: selectedRating,
            comment: comment || null,
            timestamp: window.serverTimestamp(),
            userAgent: navigator.userAgent,
            screenSize: `${window.screen.width}x${window.screen.height}`,
            source: 'faq'
        };

        // Save to Firebase
        await window.addDoc(window.collection(window.db, 'reviews'), reviewData);

        // Mark as reviewed
        localStorage.setItem('hasReviewed', 'true');
        localStorage.setItem('userRating', selectedRating);

        // Show success message in modal
        showReviewSuccessInModal();

        console.log('Review submitted successfully:', reviewData);
    } catch (error) {
        console.error('Error submitting review:', error);
        console.error('Error details:', error.message, error.code);

        // Better error messages
        let errorMessage = '送出失敗，請稍後再試';
        if (error.message === 'Firebase not initialized') {
            errorMessage = '系統初始化中，請稍後再試';
        } else if (error.code === 'permission-denied') {
            errorMessage = '權限不足，請重新整理頁面後再試';
        } else if (error.code === 'unavailable') {
            errorMessage = '網路連線問題，請檢查網路後再試';
        }

        reviewError.textContent = errorMessage;
        reviewError.style.display = 'block';
    } finally {
        submitReviewBtn.disabled = false;
        submitReviewBtn.textContent = '送出評價';
    }
}

function showReviewFeedback(message) {
    const reviewFeedback = document.getElementById('review-feedback');
    reviewFeedback.textContent = message;
    reviewFeedback.style.display = 'block';
}

function showReviewSuccessInModal() {
    const reviewModalTitle = document.getElementById('review-modal-title');
    const starRatingModal = document.getElementById('star-rating-modal');
    const reviewCommentSection = document.getElementById('review-comment-section');
    const reviewError = document.getElementById('review-error');

    // Hide stars and comment section
    starRatingModal.style.display = 'none';
    reviewCommentSection.style.display = 'none';
    reviewError.style.display = 'none';

    // Change title to thank you message
    reviewModalTitle.textContent = '感謝您的評價！';
    reviewModalTitle.style.textAlign = 'center';
    reviewModalTitle.style.color = '#10b981';
    reviewModalTitle.style.fontSize = '24px';
    reviewModalTitle.style.padding = '40px 20px';

    // Auto close modal after 2 seconds
    setTimeout(() => {
        document.getElementById('review-modal').style.display = 'none';
        enableBodyScroll();

        // Disable review button
        disableReviewButton();

        // Reset modal for next time (if needed)
        reviewModalTitle.style.textAlign = '';
        reviewModalTitle.style.color = '';
        reviewModalTitle.style.fontSize = '';
        reviewModalTitle.style.padding = '';
        starRatingModal.style.display = '';
        reviewCommentSection.style.display = '';
    }, 2000);
}

function disableReviewButton() {
    const openReviewBtn = document.getElementById('open-review-btn');
    if (openReviewBtn) {
        openReviewBtn.style.opacity = '0.5';
        openReviewBtn.style.pointerEvents = 'none';
    }
}
