/* ============================================================
 * Pick My Card — js/home-ui.js（載入順序 3/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 本週亮點活動 Spotlight     → "renderSpotlights" / "openSpotlightModal"
 *  - 禮物圖 lightbox／回頂鈕   → "setupGiftImageLightbox" / "setupBackToTopButton"
 *  - 錯誤訊息                  → "showErrorMessage"
 *  - 主要 DOM 元素參照          → "merchantInput" / "calculateBtn"
 *  - 公告列＋公告 modal         → "setupAnnouncementBar" / "displayAnnouncement"
 *  - 主初始化（DOMContentLoaded）→ "DOMContentLoaded"
 *  - 圖片 lazy loading          → "initializeLazyLoading"
 *  - 卡片/支付 chips            → "populateCardChips" / "populatePaymentChips"
 *  - 全站事件綁定              → "setupEventListeners"
 *  - 搜尋提示                  → "checkAndShowSearchHint" / "handleMerchantInput"
 * ============================================================ */
// ============ 本週亮點活動 (Spotlight) ============
// Editorial highlights from cardsData.spotlights. Shows 3 per page in a
// manual carousel (arrows / dots / swipe, no auto-rotate); the count cap is
// decoupled from what's visible.
let spotlightItems = [];
let spotlightPage = 0;
const SPOTLIGHT_PAGE_SIZE = 3;
const SPOTLIGHT_MAX = 12;

function getSpotlightDaysLeft(deadline) {
    if (!deadline) return null;
    const end = new Date(deadline);
    if (isNaN(end.getTime())) return null;
    end.setHours(23, 59, 59, 999);
    return Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
}

function spotlightTotalPages() {
    return Math.ceil(spotlightItems.length / SPOTLIGHT_PAGE_SIZE);
}

function renderSpotlights() {
    const section = document.getElementById('spotlight-section');
    const track = document.getElementById('spotlight-track');
    if (!section || !track) return;

    const all = (cardsData && Array.isArray(cardsData.spotlights)) ? cardsData.spotlights : [];
    spotlightItems = all
        .filter(s => s && s.active !== false && s.active !== 'FALSE')
        .sort((a, b) => (Number(a.order) || 999) - (Number(b.order) || 999))
        .slice(0, SPOTLIGHT_MAX);

    if (spotlightItems.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    spotlightPage = 0;
    buildSpotlightDots();
    renderSpotlightPage();

    const multiPage = spotlightTotalPages() > 1;
    const dots = document.getElementById('spotlight-dots');
    updateSpotlightNav();
    if (dots) dots.style.display = multiPage ? 'flex' : 'none';
}

function renderSpotlightPage() {
    const track = document.getElementById('spotlight-track');
    if (!track) return;
    const start = spotlightPage * SPOTLIGHT_PAGE_SIZE;
    const pageItems = spotlightItems.slice(start, start + SPOTLIGHT_PAGE_SIZE);

    const frag = document.createDocumentFragment();
    pageItems.forEach((item, i) => {
        frag.appendChild(buildSpotlightCard(item, start + i));
    });

    track.classList.remove('spotlight-fade-in');
    track.innerHTML = '';
    track.appendChild(frag);
    void track.offsetWidth; // restart fade animation
    track.classList.add('spotlight-fade-in');

    updateSpotlightDots();
    updateSpotlightNav();
}

// 有多頁就兩顆箭頭都顯示。2026-08-15 起第一頁也給「上一組」——輪播本來就是循環的
// （goToSpotlightPage 用 modulo 收尾，第一頁按上一組會跳到最後一頁），
// 原本在第一頁把它藏起來，反而讓按鈕列忽有忽無、位置還會左右跳。
function updateSpotlightNav() {
    const multiPage = spotlightTotalPages() > 1;
    const prevBtn = document.getElementById('spotlight-prev-btn');
    const nextBtn = document.getElementById('spotlight-next-btn');
    if (nextBtn) nextBtn.style.display = multiPage ? 'inline-flex' : 'none';
    if (prevBtn) prevBtn.style.display = multiPage ? 'inline-flex' : 'none';
}

// description 開頭的「XX！」＝活動類型標籤（全卡唯一帶分類色的元素）。
// 對不到表列類型就不顯示標籤、description 全文照常顯示，資料端不需配合改
const SPOTLIGHT_HYPE_TYPES = {
    '全場最高': 'hype-top',
    '壓倒性神卡': 'hype-god',
    '獨家回饋': 'hype-excl',
    '無腦刷': 'hype-easy'
};

function parseSpotlightHype(description) {
    const m = /^(.+?)[！!]/.exec(description || '');
    if (m && SPOTLIGHT_HYPE_TYPES[m[1]]) {
        return {
            label: m[1],
            cssClass: SPOTLIGHT_HYPE_TYPES[m[1]],
            rest: description.slice(m[0].length).trim()
        };
    }
    return null;
}

function buildSpotlightCard(item, index) {
    const card = document.createElement('div');
    card.className = 'spotlight-card';

    const rate = (item.rate !== undefined && item.rate !== '') ? `${item.rate}%` : '';
    const daysLeft = getSpotlightDaysLeft(item.deadline);
    const daysBadge = (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14)
        ? `<span class="spotlight-days-badge">剩 ${daysLeft} 天</span>` : '';

    const hype = parseSpotlightHype(item.description);
    const hypeTag = hype
        ? `<span class="spotlight-hype-tag ${hype.cssClass}">${escapeHtml(hype.label)}</span>` : '';
    const desc = hype ? hype.rest : (item.description || '');
    const sticker = rate ? `<span class="spotlight-rate-sticker">${escapeHtml(rate)}</span>` : '';

    card.innerHTML = `
        <div class="spotlight-top-row">
            <div class="spotlight-ccwrap">
                <img class="spotlight-ccimg" src="assets/images/cards/${escapeHtml(item.card_id || '')}.png" alt="${escapeHtml(item.card_name || '')}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('noimg')">
                ${sticker}
            </div>
            <div class="spotlight-top-right">
                ${hypeTag}
                <div class="spotlight-merchant">${escapeHtml(item.merchant || '')}</div>
                <div class="spotlight-desc">${escapeHtml(desc)}</div>
            </div>
        </div>
        <div class="spotlight-info-row">
            ${item.cap ? `<span>上限 <b>${escapeHtml(item.cap)}</b></span>` : ''}
            ${item.deadline ? `<span>至 <b>${escapeHtml(item.deadline)}</b>${daysBadge}</span>` : ''}
        </div>
        <div class="spotlight-card-actions">
            <button type="button" class="spotlight-compare-btn" data-card-id="${escapeHtml(item.card_id || '')}" data-card-name="${escapeHtml(item.card_name || '')}" data-merchant="${escapeHtml(item.merchant || '')}">比較這個通路 →</button>
            <button type="button" class="spotlight-info-btn" aria-label="活動詳情" data-card-id="${escapeHtml(item.card_id || '')}" data-card-name="${escapeHtml(item.card_name || '')}" data-merchant="${escapeHtml(item.merchant || '')}">ⓘ</button>
        </div>
    `;

    card.querySelector('.spotlight-compare-btn').addEventListener('click', () => compareSpotlightMerchant(item.merchant));
    card.querySelector('.spotlight-info-btn').addEventListener('click', () => openSpotlightModal(index));
    return card;
}

function buildSpotlightDots() {
    const dots = document.getElementById('spotlight-dots');
    if (!dots) return;
    const total = spotlightTotalPages();
    dots.innerHTML = '';
    for (let i = 0; i < total; i++) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'spotlight-dot';
        dot.setAttribute('aria-label', `第 ${i + 1} 組`);
        dot.addEventListener('click', () => goToSpotlightPage(i));
        dots.appendChild(dot);
    }
}

function updateSpotlightDots() {
    const dots = document.getElementById('spotlight-dots');
    if (!dots) return;
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('active', i === spotlightPage));
}

function goToSpotlightPage(page) {
    const total = spotlightTotalPages();
    if (total === 0) return;
    spotlightPage = ((page % total) + total) % total;
    renderSpotlightPage();
}

function nextSpotlightPage() {
    goToSpotlightPage(spotlightPage + 1);
}

function prevSpotlightPage() {
    goToSpotlightPage(spotlightPage - 1);
}

function setupSpotlightControls() {
    const nextBtn = document.getElementById('spotlight-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', () => nextSpotlightPage());

    const prevBtn = document.getElementById('spotlight-prev-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => prevSpotlightPage());

    const track = document.getElementById('spotlight-track');
    if (track) {
        setupSpotlightSwipe(track);
    }
}

// 手機版左右滑動翻頁：橫向滑動距離夠大、且明顯比縱向大（避免攔截正常上下捲動）才換頁。
function setupSpotlightSwipe(track) {
    const SWIPE_THRESHOLD = 45;   // 觸發翻頁的最小橫向位移(px)
    let startX = 0, startY = 0, tracking = false;

    track.addEventListener('touchstart', (e) => {
        if (spotlightTotalPages() <= 1 || e.touches.length !== 1) { tracking = false; return; }
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        tracking = true;
    }, { passive: true });

    track.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = (e.changedTouches && e.changedTouches[0]) || null;
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) nextSpotlightPage(); // 左滑 → 下一組
            else prevSpotlightPage();        // 右滑 → 上一組
        }
    }, { passive: true });

    track.addEventListener('touchcancel', () => {
        tracking = false;
    }, { passive: true });
}

// Click-to-enlarge: open any .promo-gift-image (or .image-zoomable) in a
// fullscreen lightbox. Uses event delegation so dynamically-rendered promo
// cards work without re-binding.
function setupGiftImageLightbox() {
    const lightbox = document.getElementById('image-lightbox');
    const lightboxImg = document.getElementById('image-lightbox-img');
    if (!lightbox || !lightboxImg) return;

    document.addEventListener('click', (e) => {
        const img = e.target.closest('.promo-gift-image');
        if (!img || !img.src) return;
        lightboxImg.src = img.src;
        lightbox.style.display = 'flex';
        disableBodyScroll();
    });

    const close = () => {
        lightbox.style.display = 'none';
        lightboxImg.src = '';
        enableBodyScroll();
    };
    lightbox.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.style.display === 'flex') close();
    });
}

// Mobile back-to-top floating button: appears (above the feedback button)
// once the page is scrolled down, smooth-scrolls to the top on click.
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

// 精選活動快速跳轉浮標：搜尋結果有時很長，這顆讓用戶一鍵跳到最底的精選活動區。
// 顯示條件＝有搜尋結果（#results-section 顯示中）且精選活動區本身有顯示（有資料）。
// 由 displayResults()（結果出現）與 hideToolSections()（結果收起）呼叫更新。
function updateScrollToSpotlightBtn() {
    const btn = document.getElementById('scroll-to-spotlight-btn');
    if (!btn) return;
    const results = document.getElementById('results-section');
    const spotlight = document.getElementById('spotlight-section');
    const resultsVisible = !!results && results.style.display !== 'none';
    const spotlightVisible = !!spotlight && spotlight.style.display !== 'none';
    btn.classList.toggle('is-visible', resultsVisible && spotlightVisible);
}

function setupScrollToSpotlightButton() {
    const btn = document.getElementById('scroll-to-spotlight-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const spotlight = document.getElementById('spotlight-section');
        if (spotlight) spotlight.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// Find the actual cashbackRate activities in a card that cover the spotlight's
// merchant, by looking up the card's prebuilt items index. Keywords come from a
// matching quick-search option (so "所有加油站" expands to 中油/台塑/…) or from
// the merchant itself.
function findSpotlightCardActivities(card, merchant) {
    if (!card || !card._itemsIndex || !merchant) return [];

    let keywords;
    const options = (cardsData && cardsData.quickSearchOptions) || [];
    const normalized = merchant.trim().toLowerCase();
    const opt = options.find(o => o.displayName && o.displayName.trim().toLowerCase() === normalized);
    if (opt && Array.isArray(opt.merchants)) {
        keywords = opt.merchants.slice();
    } else {
        keywords = [merchant.trim()];
    }
    const variants = [...new Set(keywords.flatMap(k => getAllSearchVariants(k)))].filter(v => v && v.length >= 2);
    if (variants.length === 0) return [];

    const collect = (predicate) => {
        const seen = new Set();
        const out = [];
        for (const [itemLower, entries] of card._itemsIndex.entries()) {
            if (!predicate(itemLower)) continue;
            entries.forEach(e => {
                if (e.type === 'cashbackRate' && e.rateGroup && !seen.has(e.rateGroup)) {
                    seen.add(e.rateGroup);
                    out.push(e.rateGroup);
                }
            });
        }
        return out;
    };

    let groups = collect(itemLower => variants.includes(itemLower));
    if (groups.length === 0) {
        groups = collect(itemLower => variants.some(v => itemLower.includes(v) || v.includes(itemLower)));
    }
    return groups;
}

// 卡片詳情 ⓘ 與立即申辦按鈕：置於 modal header 標題（卡名）下方（openSpotlightModal
// 動態插入 header），卡名只在 header 標題顯示、body 不重複。
function buildSpotlightModalActions(item, card) {
    const applyCta = (cardsData && cardsData.cardApplyCtas && item.card_id) ? cardsData.cardApplyCtas[item.card_id] : null;
    // 鐵則 3：動態 href 先 sanitizeUrl（escapeHtml 擋不住 javascript: scheme）
    const applyLink = applyCta ? sanitizeUrl(applyCta.link) : '';
    const applyCtaHtml = applyLink
        ? `<a class="promo-apply-cta-btn spotlight-apply-cta-btn" href="${escapeHtml(applyLink)}" target="_blank" rel="noopener noreferrer" data-card-id="${escapeHtml(item.card_id || '')}" data-card-name="${escapeHtml(item.card_name || '')}" data-merchant="${escapeHtml(item.merchant || '')}">立即申辦<svg class="promo-apply-cta-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><path d="M8 1h3v3"/><path d="M11 1 6 6"/></svg></a>`
        : '';
    const cardDetailBtn = card
        ? `<button type="button" class="card-detail-peek-btn spotlight-carddetail-btn" data-card-id="${escapeHtml(card.id)}" aria-label="卡片詳情" title="卡片詳情">ⓘ</button>`
        : '';
    return `${cardDetailBtn}${applyCtaHtml}`;
}

function buildSpotlightModalBody(item, card) {
    const activities = card ? findSpotlightCardActivities(card, item.merchant) : [];

    // Highlights 編輯文字（含「壓倒性神卡！」等前綴）
    const descHtml = item.description ? `<p class="spotlight-modal-desc">${escapeHtml(item.description)}</p>` : '';

    // Fallback to the editorial Highlights data when the card/activity can't be resolved.
    if (activities.length === 0) {
        const rate = (item.rate !== undefined && item.rate !== '') ? `${item.rate}%` : '';
        const daysLeft = getSpotlightDaysLeft(item.deadline);
        const daysBadge = (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14)
            ? `<span class="spotlight-days-badge">剩 ${daysLeft} 天</span>` : '';
        return `
            ${descHtml}
            ${rate ? `<div class="spotlight-modal-rate">${escapeHtml(rate)}</div>` : ''}
            <div class="spotlight-modal-info">
                ${item.cap ? `<div><span class="spotlight-modal-label">消費上限</span><span>${escapeHtml(item.cap)}</span></div>` : ''}
                ${item.deadline ? `<div><span class="spotlight-modal-label">活動期限</span><span>${escapeHtml(item.deadline)} ${daysBadge}</span></div>` : ''}
            </div>
        `;
    }

    let levelData = null;
    if (card.hasLevels && card.levelSettings) {
        levelData = card.levelSettings[Object.keys(card.levelSettings)[0]] || null;
    }

    const blocks = activities.map(group => {
        const parsedRate = parseCashbackRateSync(group.rate, levelData);
        // For stacking models (rate+basic+…) rate_N holds only the designated-channel
        // rate, so show the summed total (designated + basic + bonus) — same number the
        // search-result card shows. Non-stacking models return the parsed rate as-is.
        const rateNum = getDisplayRate(card, group, parsedRate, levelData);
        const capNum = parseCashbackCap(group.cap, card, levelData);
        const capText = (capNum !== null && capNum !== undefined && !isNaN(capNum))
            ? `NT$${Math.floor(capNum).toLocaleString()}` : '無上限';
        const period = group.period || ((group.periodStart && group.periodEnd) ? `${group.periodStart}~${group.periodEnd}` : '');
        const items = Array.isArray(group.items) ? group.items : [];
        // 回饋率列：比照卡片詳情頁 .cashback-rate（綠色回饋率＋黑字「回饋」）；
        // category 改為低調的灰字註記（不用藍膠囊，避免被誤認成可點按鈕）
        const categoryLabel = group.category
            ? ` <span class="spotlight-rate-category">${escapeHtml(getCategoryDisplayName(group.category))}</span>`
            : '';
        const rateLine = `<div class="cashback-rate">${rateNum ? `<span class="cashback-rate-num">${escapeHtml(rateNum + '%')}</span> 回饋` : ''}${categoryLabel}</div>`;
        // 適用通路：標題獨立一行、內容下一行；超過 3 行預設收合、點擊展開（toggle 由 setupSpotlightActItemsToggle 開啟）
        const actItemsHtml = items.length
            ? `<div class="spotlight-act-items"><div class="spotlight-act-items-label">此活動也適用以下通路</div><div class="spotlight-act-items-values clamped">${items.map(escapeHtml).join('、')}</div><button type="button" class="spotlight-act-items-toggle" hidden>展開</button></div>`
            : '';
        return `
            <div class="spotlight-activity">
                ${rateLine}
                ${actItemsHtml}
                <div class="spotlight-modal-info">
                    <div><span class="spotlight-modal-label">回饋上限</span><span>${capText}</span></div>
                    ${period ? `<div><span class="spotlight-modal-label">活動期間</span><span>${escapeHtml(period)}</span></div>` : ''}
                    ${group.conditions ? `<div><span class="spotlight-modal-label">條件</span><span class="spotlight-cond-value">${escapeHtml(group.conditions)}</span></div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    return `${descHtml}${blocks}`;
}

// 「適用通路」內容超過 3 行才顯示展開鈕（收合時 -webkit-line-clamp:3）；點擊切換展開/收合
function setupSpotlightActItemsToggle(container) {
    if (!container) return;
    container.querySelectorAll('.spotlight-act-items').forEach(wrap => {
        const values = wrap.querySelector('.spotlight-act-items-values');
        const toggle = wrap.querySelector('.spotlight-act-items-toggle');
        if (!values || !toggle) return;
        // clamp 生效時，內容溢出 3 行才提供展開/收合
        if (values.scrollHeight - values.clientHeight > 2) {
            toggle.hidden = false;
            toggle.addEventListener('click', () => {
                const expanded = values.classList.toggle('expanded');
                values.classList.toggle('clamped', !expanded);
                toggle.textContent = expanded ? '收合' : '展開';
            });
        }
    });
}

function openSpotlightModal(index) {
    const item = spotlightItems[index];
    if (!item) return;
    const modal = document.getElementById('spotlight-modal');
    const titleEl = document.getElementById('spotlight-modal-title');
    const bodyEl = document.getElementById('spotlight-modal-body');
    if (!modal || !bodyEl) return;

    const card = ((cardsData && cardsData.cards) || []).find(c => c.id === item.card_id);

    // Modal 標題改為卡片名稱（原為通路名稱）
    if (titleEl) titleEl.textContent = item.card_name || item.merchant || '活動詳情';

    // 卡片詳情/立即申辦按鈕：放在 header 卡名下方（動態插入 .modal-header，第一次開啟時建立）
    let actionsEl = document.getElementById('spotlight-modal-actions');
    if (!actionsEl && titleEl && titleEl.parentElement) {
        actionsEl = document.createElement('div');
        actionsEl.id = 'spotlight-modal-actions';
        actionsEl.className = 'spotlight-modal-actions';
        titleEl.parentElement.appendChild(actionsEl);
    }
    if (actionsEl) actionsEl.innerHTML = buildSpotlightModalActions(item, card);

    bodyEl.innerHTML = buildSpotlightModalBody(item, card);

    // ⓘ「卡片詳情」按鈕 → 開啟卡片詳情頁（疊在本 modal 之上）；卡名本身不再可點
    const cardDetailBtn = (actionsEl || bodyEl).querySelector('.spotlight-carddetail-btn');
    if (cardDetailBtn) {
        cardDetailBtn.addEventListener('click', () => showCardDetail(cardDetailBtn.dataset.cardId));
    }

    modal.style.display = 'flex';
    disableBodyScroll();

    // 適用通路收合/展開：需在 modal 顯示後量測行高才準
    setupSpotlightActItemsToggle(bodyEl);

    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

    const closeBtn = document.getElementById('spotlight-modal-close');
    if (closeBtn) closeBtn.onclick = closeSpotlightModal;
    modal.onclick = (e) => { if (e.target === modal) closeSpotlightModal(); };
}

function closeSpotlightModal() {
    const modal = document.getElementById('spotlight-modal');
    if (modal) modal.style.display = 'none';
    enableBodyScroll();
}

// Auto-fill the merchant search and run the comparison. If the merchant matches
// a quick-search option's displayName (e.g. 所有加油站), trigger that multi-keyword
// search; otherwise do a plain single-merchant search.
function compareSpotlightMerchant(merchant, opts) {
    if (!merchant) return;
    opts = opts || {};
    const merchantInputEl = document.getElementById('merchant-input');
    const amountInput = document.getElementById('amount-input');

    const options = (cardsData && cardsData.quickSearchOptions) ? cardsData.quickSearchOptions : [];
    const normalized = merchant.trim().toLowerCase();
    const matchedOption = options.find(o => o.displayName && o.displayName.trim().toLowerCase() === normalized);

    if (matchedOption) {
        // handleQuickSearch 只填入關鍵詞（不自動計算）；其結尾的 validateInputs()
        // 已依「商家非空」啟用計算鈕，這裡代替用戶按下計算，維持本按鈕「點了就比較」的承諾
        handleQuickSearch(matchedOption);
        if (amountInput && !amountInput.value) amountInput.value = '1000';
        const calcBtn = document.getElementById('calculate-btn');
        if (calcBtn && !calcBtn.disabled) calcBtn.click();
    } else {
        if (merchantInputEl) {
            merchantInputEl.value = merchant;
            handleMerchantInput();
        }
        if (amountInput && !amountInput.value) amountInput.value = '1000';
        const calcBtn = document.getElementById('calculate-btn');
        if (calcBtn && !calcBtn.disabled) calcBtn.click();
    }

    // 商家落地頁（noScroll）不自動捲到結果，讓頂部標題區塊與搜尋框先入眼；
    // 一般 spotlight 點擊維持「點了就捲到結果」。
    if (opts.noScroll) return;
    setTimeout(() => {
        const results = document.getElementById('results-section');
        const target = (results && results.style.display !== 'none') ? results : merchantInputEl;
        if (target) target.scrollIntoView({ behavior: 'smooth', block: results === target ? 'start' : 'center' });
    }, 200);
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
        errorDiv.textContent = `⚠️ ${message}`;
        container.insertBefore(errorDiv, container.firstChild);
    }
}

let currentMatchedItem = null;
let currentQuickSearchOption = null; // Store current quick search option for parking benefits

// DOM elements
const merchantInput = document.getElementById('merchant-input');
const amountInput = document.getElementById('amount-input');
const calculateBtn = document.getElementById('calculate-btn');
const resultsSection = document.getElementById('results-section');
const resultsContainer = document.getElementById('results-container');
const couponResultsSection = document.getElementById('coupon-results-section');
const couponResultsContainer = document.getElementById('coupon-results-container');
const matchedItemDiv = document.getElementById('matched-item');

// ==========================================
// Announcement Bar System
// ==========================================

let announcements = [];
let currentAnnouncementIndex = 0;
let announcementInterval = null;
let isAnnouncementPaused = false;

// Initialize announcements from cardsData
function initializeAnnouncements() {
    if (cardsData && cardsData.announcements && cardsData.announcements.length > 0) {
        announcements = cardsData.announcements.slice(0, 5); // 限制最多 5 則
        setupAnnouncementBar();
        startAnnouncementRotation();
    }
}

// Setup announcement bar UI and event listeners
function setupAnnouncementBar() {
    const announcementBar = document.getElementById('announcement-bar');
    const announcementText = document.getElementById('announcement-text');
    const announcementIndicator = document.getElementById('announcement-indicator');
    const prevBtn = document.getElementById('announcement-prev');
    const nextBtn = document.getElementById('announcement-next');
    const closeBtn = document.getElementById('announcement-close');

    if (!announcementBar || !announcementText) return;

    // Show announcement bar
    announcementBar.style.display = 'block';

    // Display first announcement
    displayAnnouncement(0);

    // Event listeners
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            showPreviousAnnouncement();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            showNextAnnouncement();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeAnnouncementBar();
        });
    }

    // Pause on hover, resume on mouse leave
    announcementBar.addEventListener('mouseenter', () => {
        pauseAnnouncementRotation();
    });

    announcementBar.addEventListener('mouseleave', () => {
        resumeAnnouncementRotation();
    });

    // 手機版（方案 B）：圓點指示＋左右滑動換則。桌機以 CSS 隱藏圓點、保留箭頭。
    buildAnnouncementDots();

    // 滑動手勢：水平位移 >40px 且大於垂直位移才算滑動（避免吃掉頁面捲動與點擊）。
    // passive:true——不呼叫 preventDefault，捲動效能不受影響；真的滑動時瀏覽器
    // 自己就不會觸發 click，開公告 modal 的點擊行為不衝突。
    let touchStartX = 0;
    let touchStartY = 0;
    announcementBar.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    announcementBar.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) showNextAnnouncement();
            else showPreviousAnnouncement();
        }
    }, { passive: true });

    // Click on text or date badge to show modal
    announcementText.addEventListener('click', (e) => {
        e.preventDefault();
        showAnnouncementModal(currentAnnouncementIndex);
    });

    const announcementDate = document.getElementById('announcement-date');
    if (announcementDate) {
        announcementDate.addEventListener('click', () => {
            showAnnouncementModal(currentAnnouncementIndex);
        });
    }
}

// Show announcement modal with full content
function showAnnouncementModal(index) {
    const announcement = announcements[index];
    if (!announcement) return;

    const modal = document.getElementById('announcement-modal');
    const modalBody = document.getElementById('announcement-modal-body');
    const modalLink = document.getElementById('announcement-modal-link');
    const modalCloseX = document.getElementById('announcement-modal-close');

    if (!modal || !modalBody) return;

    // Get fullText and display with HTML support.
    // ⚠️ 這裡是「刻意」允許 HTML 的：fullText 來自 Google Sheets 的公告工作表，
    // 屬於管理者（你本人）控制的內容，可以放 <b>、<a> 等排版。
    // 千萬不要把任何「使用者輸入」餵進這個欄位。
    const fullText = announcement.fullText || announcement.text;

    // Clear and update modal content
    modalBody.innerHTML = '';
    modalBody.style.color = '#374151';
    modalBody.style.fontSize = '0.95rem';
    modalBody.innerHTML = fullText;

    // Show/hide link button（僅接受 http/https 連結）
    const safeLink = sanitizeUrl(announcement.link);
    if (safeLink) {
        modalLink.href = safeLink;
        modalLink.style.display = 'inline-block';
    } else {
        modalLink.style.display = 'none';
    }

    // Show modal
    modal.style.display = 'flex';

    // Close handlers
    const closeModal = () => {
        modal.style.display = 'none';
    };

    if (modalCloseX) modalCloseX.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// 手機版圓點指示：一則一顆，點擊可直接跳到該則（點擊區用 padding 撐到 ~20px）
function buildAnnouncementDots() {
    const dots = document.getElementById('announcement-dots');
    if (!dots) return;
    dots.innerHTML = '';
    if (announcements.length <= 1) return;
    announcements.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'announcement-dot';
        dot.setAttribute('aria-label', `第 ${i + 1} 則公告`);
        dot.addEventListener('click', () => displayAnnouncement(i));
        dots.appendChild(dot);
    });
    updateAnnouncementDots(0);
}

function updateAnnouncementDots(index) {
    const dots = document.getElementById('announcement-dots');
    if (!dots) return;
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('active', i === index));
}

// Display announcement by index
// ⚠️ announcement-text 只能用 textContent 放純文字，不能塞任何行內元素（含日期）：
//    iOS Safari 對「line-clamp 元素內含 inline-block ＋ opacity 淡入淡出」會停止重繪
//    文字圖層，畫面卡在上一則變疊字亂碼。日期放在獨立的 #announcement-date badge。
function displayAnnouncement(index) {
    const announcementText = document.getElementById('announcement-text');
    const announcementDate = document.getElementById('announcement-date');
    const announcementIndicator = document.getElementById('announcement-indicator');

    if (!announcementText || !announcements[index]) return;

    const announcement = announcements[index];

    // Fade out
    announcementText.classList.add('fade-out');
    if (announcementDate) announcementDate.classList.add('fade-out');

    setTimeout(() => {
        // Update date badge (sibling element, see warning above)
        if (announcementDate) {
            if (announcement.date) {
                announcementDate.textContent = announcement.date;
                announcementDate.style.display = '';
            } else {
                announcementDate.style.display = 'none';
            }
        }

        // Update text (plain text only, see warning above)
        announcementText.textContent = announcement.text;

        // Always set as clickable (opens modal)
        announcementText.href = '#';
        announcementText.style.cursor = 'pointer';

        // Update indicator
        if (announcementIndicator && announcements.length > 1) {
            announcementIndicator.textContent = `${index + 1}/${announcements.length}`;
        }
        updateAnnouncementDots(index);

        // Fade in
        announcementText.classList.remove('fade-out');
        announcementText.classList.add('fade-in');
        if (announcementDate) {
            announcementDate.classList.remove('fade-out');
            announcementDate.classList.add('fade-in');
        }
    }, 150);

    currentAnnouncementIndex = index;
}

// Show next announcement
function showNextAnnouncement() {
    const nextIndex = (currentAnnouncementIndex + 1) % announcements.length;
    displayAnnouncement(nextIndex);
    resetAnnouncementRotation();
}

// Show previous announcement
function showPreviousAnnouncement() {
    const prevIndex = (currentAnnouncementIndex - 1 + announcements.length) % announcements.length;
    displayAnnouncement(prevIndex);
    resetAnnouncementRotation();
}

// 2026-07-20 取消自動輪播：輪播讓用戶多半只看到隨機一則（觸控裝置無 hover 暫停，
// 閱讀中途被換掉更傷）。公告固定顯示第一則（最新），由用戶用左右箭頭手動切換，
// n/N 位置指示（#announcement-indicator）提示還有其他則。函式保留為 no-op，
// 呼叫端（初始化與 resetAnnouncementRotation）不用改。
function startAnnouncementRotation() {
}

// Pause rotation
function pauseAnnouncementRotation() {
    isAnnouncementPaused = true;
}

// Resume rotation
function resumeAnnouncementRotation() {
    isAnnouncementPaused = false;
}

// Toggle pause state
// Reset rotation timer
function resetAnnouncementRotation() {
    if (announcementInterval) {
        clearInterval(announcementInterval);
        startAnnouncementRotation();
    }
}

// Close announcement bar
function closeAnnouncementBar() {
    const announcementBar = document.getElementById('announcement-bar');
    if (announcementBar) {
        announcementBar.style.display = 'none';
    }
    if (announcementInterval) {
        clearInterval(announcementInterval);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 應用程式初始化開始...', new Date().toISOString());

    // Load cards data first
    const dataLoaded = await loadCardsData();
    if (!dataLoaded) {
        // If data loading fails, disable the app
        console.error('❌ 資料載入失敗，停用應用程式');
        if (calculateBtn) calculateBtn.disabled = true;
        return;
    }

    // Initialize payments data
    console.log('📱 初始化行動支付資料...');
    initializePaymentsData();

    // Initialize quick search options (async)
    await initializeQuickSearchOptions();

    // Initialize announcements
    initializeAnnouncements();

    console.log('🎨 填充卡片和支付選項...');
    populateCardChips();
    populatePaymentChips();
    renderQuickSearchButtons();

    console.log('🔧 設定事件監聽器...');
    setupEventListeners();
    setupAuthentication();

    // Initialize lazy loading for videos and images
    initializeLazyLoading();

    // 深連結：?card=<卡片id> 直接開卡片詳情 modal（新戶活動一覽頁 ⓘ 的入口，
    // 2026-07-16）。搭配 ?start 繞過 landing 首訪轉址；無效 id 靜默忽略。
    const deepLinkCardId = new URLSearchParams(location.search).get('card');
    if (deepLinkCardId && cardsData && cardsData.cards.some(c => c.id === deepLinkCardId)) {
        showCardDetail(deepLinkCardId);
    }

    // 深連結：商家落地頁（/merchant/<商家>）注入的 window.__PMC_MERCHANT__，或 ?merchant=<商家>
    // → 開頁自動填入商家並即時計算（沿用 compareSpotlightMerchant，快捷/模糊查詢一併處理）。
    // 讓從 Google 落地商家頁的用戶開頁即見即時結果（見 merchant/ 靜態頁生成，data-pipeline.md）。
    const deepLinkMerchant = (typeof window !== 'undefined' && window.__PMC_MERCHANT__) ||
        new URLSearchParams(location.search).get('merchant');
    if (deepLinkMerchant && typeof compareSpotlightMerchant === 'function') {
        // 商家落地頁：直接顯示搜尋框等工具區塊，不依賴 Firebase 驗證流程或 _authUIRefs
        // 是否就緒（setupAuthentication 可能非同步、晚於此處才填好 _authUIRefs）——
        // 落地用戶要能改搜其他商家、非唯讀。再自動搜尋本頁商家並即時計算（不自動捲動，
        // 讓頂部標題與搜尋框先入眼）。
        appStarted = true;
        const inputSection = document.querySelector('.input-section');
        if (inputSection) inputSection.style.display = 'block';
        const supportedCards = document.querySelector('.supported-cards');
        if (supportedCards) supportedCards.style.display = 'block';
        if (_authUIRefs && typeof _authUIRefs.showToolSections === 'function') {
            _authUIRefs.showToolSections();
        }
        window.__pmcSuppressNextScroll = true; // 開頁自動計算不捲動（displayResults 讀取後清除）
        compareSpotlightMerchant(String(deepLinkMerchant), { noScroll: true });
    }

    // Embed 模式（新戶活動頁 iframe，2026-07-16）：告知父頁（promos.js）已就緒可以開卡，
    // 並監聽父頁的換卡指令。origin 檢查兩端都做（promos.js 送 postMessage 時也會檢查
    // event.origin）；非 embed 模式完全不掛這個 listener、不送任何 postMessage。
    if (isEmbedMode) {
        window.addEventListener('message', (event) => {
            if (event.origin !== location.origin) return;
            const data = event.data;
            if (!data || data.type !== 'pmc-open-card') return;
            const cardId = data.cardId;
            if (cardId && cardsData && cardsData.cards.some(c => c.id === cardId)) {
                showCardDetail(cardId);
            }
        });
        try {
            parent.postMessage({ type: 'pmc-embed-ready' }, location.origin);
        } catch (e) {
            console.error('❌ pmc-embed-ready postMessage 失敗:', e);
        }
    }

    console.log('✅ 應用程式初始化完成！');
});

// Lazy loading for videos and images using Intersection Observer
function initializeLazyLoading() {
    // Intersection Observer options
    const observerOptions = {
        root: null,
        rootMargin: '50px', // Start loading 50px before entering viewport
        threshold: 0.1
    };

    // Callback for when elements enter viewport
    const observerCallback = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const element = entry.target;

                if (element.tagName === 'VIDEO') {
                    // Load and play video
                    const videoSrc = element.getAttribute('data-src');
                    if (videoSrc && !element.src) {
                        const source = document.createElement('source');
                        source.src = videoSrc;
                        source.type = 'video/mp4';
                        element.appendChild(source);
                        element.load();

                        // Play video when loaded
                        element.addEventListener('loadeddata', () => {
                            element.play().catch(err => {
                                console.log('Video autoplay failed:', err);
                            });
                        });
                    }
                } else if (element.tagName === 'IMG') {
                    // Load image (supports both direct img and picture > img)
                    const picture = element.parentElement;

                    // Load picture source if exists
                    if (picture && picture.tagName === 'PICTURE') {
                        const sources = picture.querySelectorAll('source[data-srcset]');
                        sources.forEach(source => {
                            const srcset = source.getAttribute('data-srcset');
                            if (srcset) {
                                source.srcset = srcset;
                                source.removeAttribute('data-srcset');
                            }
                        });
                    }

                    // Load img src
                    const imageSrc = element.getAttribute('data-src');
                    if (imageSrc && !element.src) {
                        element.src = imageSrc;
                        element.onload = () => {
                            element.classList.add('loaded');
                        };
                    }
                }

                // Stop observing this element
                observer.unobserve(element);
            }
        });
    };

    // Create observer
    const observer = new IntersectionObserver(observerCallback, observerOptions);

    // Observe all lazy videos and images
    document.querySelectorAll('.lazy-video').forEach(video => {
        observer.observe(video);
    });

    document.querySelectorAll('.lazy-image').forEach(img => {
        observer.observe(img);
    });
}

// Populate card chips in header
function populateCardChips() {
    const cardChipsContainer = document.getElementById('card-chips');
    if (!cardChipsContainer) return;

    // Clear existing chips
    cardChipsContainer.innerHTML = '';

    // Show cards based on user selection or all cards if not logged in
    const cardsToShow = getCardsForComparison();

    cardsToShow.forEach(card => {
        const chip = document.createElement('div');
        chip.className = 'card-chip chip-clickable';

        // 左右分割：左半銀行、右半卡名，讓用戶先掃銀行再找卡（2026-07-28）
        const bank = getCardBankName(card);
        if (bank) {
            chip.classList.add('card-chip-split');
            const bankEl = document.createElement('span');
            bankEl.className = 'card-chip-bank';
            bankEl.textContent = bank;
            const nameEl = document.createElement('span');
            nameEl.className = 'card-chip-name';
            nameEl.textContent = stripBankPrefix(card.name, bank);
            chip.appendChild(bankEl);
            chip.appendChild(nameEl);
        } else {
            // 未收錄的發卡行（新卡）→ 退回單一膠囊顯示完整卡名，不會壞掉
            chip.textContent = card.name;
        }

        chip.addEventListener('click', () => {
            if (window.closeSidebarDrawer) window.closeSidebarDrawer();
            showCardDetail(card.id);
        });
        cardChipsContainer.appendChild(chip);
    });

    updateCardChipsCount(cardsToShow.length);
}

// 發卡行來源，依序：
//   1. 卡片資料的 bank 欄位（Google Sheets 的 bank 欄，唯一權威來源）
//   2. 下面的 id 前綴對照表（尚未在 Sheets 建 bank 欄時的相容退路）
//   3. 都沒有 → 回傳空字串，膠囊退回「單一膠囊＋完整卡名」，不會壞掉
// 想改銀行顯示字樣（例如「第一銀行」改成「一銀」）只要改 Sheets 的 bank 欄，
// 前端不必動；tools/check-card-banks.js 會在 preflight 檢查有沒有卡對不到銀行。
function getCardBankName(card) {
    if (!card) return '';
    const fromData = typeof card.bank === 'string' ? card.bank.trim() : '';
    if (fromData) return fromData;
    const prefix = String(card.id || '').split('-')[0];
    return CARD_BANK_BY_ID_PREFIX[prefix] || '';
}

// 【相容退路】卡片 id 前綴 → 發卡行顯示名稱。id 前綴本來就是依發卡行命名，
// 一個前綴固定對應一家銀行，所以在 Sheets 還沒建 bank 欄前也能正確顯示。
// 顯示名稱盡量與卡名開頭一致（如 tbb 用「企銀」對上「企銀朝天宮卡」），
// stripBankPrefix() 才能把重複的銀行字樣去掉。
const CARD_BANK_BY_ID_PREFIX = {
    cathay: '國泰',
    ctbc: '中信',
    dbs: '星展',
    febank: '遠東',
    firstbank: '第一銀行',
    fubon: '富邦',
    hsbc: '滙豐',
    kgi: '凱基',
    mega: '兆豐',
    sinopac: '永豐',
    sunny: '陽信',
    taishin: '台新',
    tbb: '企銀',
    ubot: '聯邦',
    yushan: '玉山'
};

// 卡名開頭若已是銀行字樣就去掉，避免膠囊左右兩半重複（「玉山｜玉山 Uni 卡」）。
// 對不上的（如 iLEO 信用卡、藝FUN悠遊御璽卡）原樣保留。
function stripBankPrefix(name, bank) {
    const full = String(name || '');
    if (!bank || !full.startsWith(bank)) return full;
    const rest = full.slice(bank.length).trim();
    return rest || full;
}

// 卡片清單上方的灰字統計「已選取 xx/nn 張信用卡」（在「加入比較的卡片：」之下、
// 卡片膠囊之上）。nn＝全站收錄張數、xx＝目前加入比較的張數（未選取時
// getCardsForComparison 回傳全部，兩者相等）。
// 元素動態建立，index 與 merchant 落地頁都不必改 HTML。
function updateCardChipsCount(selectedCount) {
    const cardChipsContainer = document.getElementById('card-chips');
    if (!cardChipsContainer || !cardChipsContainer.parentNode) return;

    let note = document.getElementById('card-chips-count');
    if (!note) {
        note = document.createElement('div');
        note.id = 'card-chips-count';
        note.className = 'card-chips-count';
        cardChipsContainer.parentNode.insertBefore(note, cardChipsContainer);
    }

    const total = (cardsData && Array.isArray(cardsData.cards)) ? cardsData.cards.length : 0;
    note.textContent = `已選取 ${selectedCount}/${total} 張信用卡`;
}

// Populate payment chips in header
function populatePaymentChips() {
    const paymentChipsContainer = document.getElementById('payment-chips');
    if (!paymentChipsContainer) return;

    // Clear existing chips
    paymentChipsContainer.innerHTML = '';

    // Show payments based on user selection (both logged in and not logged in use userSelectedPayments)
    const paymentsToShow = paymentsData.payments.filter(payment => userSelectedPayments.has(payment.id));

    if (paymentsToShow.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.color = '#9ca3af';
        emptyMsg.style.fontSize = '0.875rem';
        emptyMsg.textContent = '未選取行動支付，請點擊上方齒輪選取';
        paymentChipsContainer.appendChild(emptyMsg);
        return;
    }

    paymentsToShow.forEach(payment => {
        const chip = document.createElement('div');
        chip.className = 'payment-chip';
        chip.textContent = payment.name;
        chip.addEventListener('click', () => {
            if (window.closeSidebarDrawer) window.closeSidebarDrawer();
            showPaymentDetail(payment.id);
        });
        paymentChipsContainer.appendChild(chip);
    });
}

// 為搜尋框加上框內右側的清除 ✕（有輸入才顯示）。做法是把輸入框包進一層
// 相對定位的 .input-clear-wrap，✕ 絕對定位在其中；清除後補送一個 input 事件，
// 讓各搜尋框既有的即時過濾邏輯（含 HTML 上的 oninput）照常被觸發。
function attachInputClearButton(input) {
    if (!input || input.dataset.clearBtnReady === '1') return;

    const wrap = document.createElement('span');
    wrap.className = 'input-clear-wrap';
    if (input.id) wrap.dataset.for = input.id;
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'input-clear-btn';
    btn.setAttribute('aria-label', '清除輸入');
    btn.textContent = '✕';
    wrap.appendChild(btn);

    const sync = () => { btn.hidden = !input.value; };
    input.addEventListener('input', sync);
    btn.addEventListener('click', () => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sync();
        input.focus();
    });
    sync();

    input.dataset.clearBtnReady = '1';
}

// 全站搜尋框的清除鈕（#merchant-input 另有自己的 .merchant-clear-btn、
// 新戶活動頁 promos 也已內建，故不在此列）
function setupSearchClearButtons() {
    [
        'search-cards-input',      // 管理卡片
        'search-owned-cards-input',// 我的信用卡
        'search-payments-input',   // 行動支付
        'cashback-search-input',   // 卡片詳情頁：指定通路回饋
        'mappings-search'          // 我的配卡組合
    ].forEach(id => attachInputClearButton(document.getElementById(id)));
}

// Setup event listeners
function setupEventListeners() {
    setupSearchClearButtons();

    // Input guide toggle
    const toggleGuideBtn = document.getElementById('toggle-input-guide');
    const inputGuide = document.getElementById('input-guide');

    if (toggleGuideBtn && inputGuide) {
        toggleGuideBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isVisible = inputGuide.style.display !== 'none';
            inputGuide.style.display = isVisible ? 'none' : 'block';
        });
    }

    // Disclaimer toggle
    const disclaimerToggle = document.getElementById('disclaimer-toggle');
    const disclaimerContent = document.getElementById('disclaimer-content');

    if (disclaimerToggle && disclaimerContent) {
        disclaimerToggle.addEventListener('click', () => {
            const isVisible = disclaimerContent.style.display !== 'none';
            disclaimerContent.style.display = isVisible ? 'none' : 'block';
            disclaimerToggle.classList.toggle('active', !isVisible);
        });
    }

    // Merchant input with real-time matching
    merchantInput.addEventListener('input', handleMerchantInput);

    // 一鍵清除輸入的 ✕：有內容才顯示；清除後回到未輸入狀態並保持焦點
    const merchantClearBtn = document.getElementById('merchant-clear-btn');
    if (merchantClearBtn) {
        merchantClearBtn.addEventListener('click', () => {
            merchantInput.value = '';
            handleMerchantInput(); // 收掉匹配狀態列/搜尋提示，並更新 ✕ 顯示
            merchantInput.focus();
        });
    }

    // 精準搜尋開關：切換時重跑手動輸入的匹配。桌機/手機兩個 checkbox 保持同步
    // （比照 setupCardholderPromoToggle）。快捷搜尋不受精準搜尋影響
    // （currentQuickSearchOption 存在時不動它的結果）。
    const onExactSearchChange = (e) => {
        EXACT_SEARCH_CHECKBOX_IDS.forEach(id => {
            const cb = document.getElementById(id);
            if (cb && cb !== e.target) cb.checked = e.target.checked;
        });
        if (currentQuickSearchOption) return;
        if (merchantInput.value.trim()) {
            handleMerchantInput();
        } else {
            toggleExactSearchEmptyHint(false);
        }
    };
    EXACT_SEARCH_CHECKBOX_IDS.forEach(id => {
        const cb = document.getElementById(id);
        if (cb) cb.addEventListener('change', onExactSearchChange);
    });

    // Spotlight carousel controls (next button + hover pause)
    setupSpotlightControls();

    // Click-to-enlarge for the first-spend gift image + mobile back-to-top button
    setupGiftImageLightbox();
    setupBackToTopButton();
    setupScrollToSpotlightButton();

    // Amount input: clear default on focus, restore on blur if empty
    amountInput.addEventListener('focus', () => {
        if (amountInput.value === '1000' && amountInput.dataset.userModified !== 'true') {
            amountInput.value = '';
            validateInputs();
        }
    });
    amountInput.addEventListener('blur', () => {
        if (amountInput.value === '') {
            amountInput.value = '1000';
            delete amountInput.dataset.userModified;
            validateInputs();
        }
    });
    amountInput.addEventListener('input', () => {
        amountInput.dataset.userModified = 'true';
        validateInputs();
    });
    
    // Calculate button
    calculateBtn.addEventListener('click', () => {
        calculateCashback();
    });
    
    // Enter key support (disabled when any modal is open)
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !calculateBtn.disabled) {
            const anyModalOpen = document.querySelector('[id$="-modal"][style*="display: flex"], [id$="-modal"][style*="display:flex"]');
            if (anyModalOpen) return;
            calculateCashback();
        }
    });

    // Prevent Enter in the cashback search input from bubbling to the global handler
    const cashbackSearchInputEl = document.getElementById('cashback-search-input');
    if (cashbackSearchInputEl) {
        cashbackSearchInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    // Manage payments button (gear icon inside my-payments modal)
    const managePaymentsBtn = document.getElementById('manage-payments-btn');
    if (managePaymentsBtn) {
        managePaymentsBtn.addEventListener('click', () => {
            openManagePaymentsModal();
        });
    }

    // Manage quick options button
    const manageQuickOptionsBtn = document.getElementById('manage-quick-options-btn');
    if (manageQuickOptionsBtn) {
        manageQuickOptionsBtn.addEventListener('click', () => {
            closeQuickSearchDropdown();
            openManageQuickOptionsModal();
        });
    }

    // Compare payments button
    const comparePaymentsBtn = document.getElementById('compare-payments-btn');
    if (comparePaymentsBtn) {
        comparePaymentsBtn.addEventListener('click', () => {
            showComparePaymentsModal();
        });
    }

    // 釘選按鈕事件委託
    const resultsContainer = document.getElementById('results-container');
    if (resultsContainer) {
        resultsContainer.addEventListener('click', async (e) => {
            const peekBtn = e.target.closest('.card-detail-peek-btn');
            if (peekBtn) {
                e.preventDefault();
                e.stopPropagation();
                showCardDetail(peekBtn.dataset.cardId);
                return;
            }
            const breakdownBtn = e.target.closest('.calc-breakdown-btn');
            if (breakdownBtn) {
                e.preventDefault();
                e.stopPropagation();
                const cardResult = breakdownBtn.closest('.card-result');
                showCalcBreakdown(breakdownBtn, cardResult);
                return;
            }
            const pinBtn = e.target.closest('.pin-btn');
            if (pinBtn) {
                e.preventDefault();
                const cardId = pinBtn.dataset.cardId;
                const cardName = pinBtn.dataset.cardName;
                const merchant = pinBtn.dataset.merchant;
                const rate = parseFloat(pinBtn.dataset.rate);
                const periodEnd = pinBtn.dataset.periodEnd || null;
                const periodStart = pinBtn.dataset.periodStart || null;

                await togglePin(pinBtn, cardId, cardName, merchant, rate, periodEnd, periodStart);
            }
        });
    }

    // 領券活動卡片的計算明細按鈕
    const couponResultsContainerEl = document.getElementById('coupon-results-container');
    if (couponResultsContainerEl) {
        couponResultsContainerEl.addEventListener('click', (e) => {
            const breakdownBtn = e.target.closest('.calc-breakdown-btn');
            if (breakdownBtn) {
                e.preventDefault();
                e.stopPropagation();
                const couponResult = breakdownBtn.closest('.coupon-item');
                showCalcBreakdown(breakdownBtn, couponResult);
            }
        });
    }

    // 新戶活動卡片的 ⓘ 詳情按鈕（搜尋結果）
    const cardholderPromosContainer = document.getElementById('cardholder-promos-container');
    if (cardholderPromosContainer) {
        cardholderPromosContainer.addEventListener('click', (e) => {
            const peekBtn = e.target.closest('.card-detail-peek-btn');
            if (peekBtn) {
                e.preventDefault();
                e.stopPropagation();
                showCardDetail(peekBtn.dataset.cardId);
            }
        });
    }

    // 領券型活動卡片的 ⓘ 詳情按鈕（搜尋結果）
    if (couponResultsContainer) {
        couponResultsContainer.addEventListener('click', (e) => {
            const peekBtn = e.target.closest('.card-detail-peek-btn');
            if (peekBtn) {
                e.preventDefault();
                e.stopPropagation();
                showCardDetail(peekBtn.dataset.cardId);
            }
        });
    }

    // 我的配卡按鈕
    const myMappingsBtn = document.getElementById('my-mappings-btn');
    if (myMappingsBtn) {
        myMappingsBtn.addEventListener('click', () => {
            openMyMappingsModal();
        });
    }
}

// 使用者手動關閉搜尋提示後記住該關鍵詞，避免同一詞重複彈出（手機版提示是
// 浮層、蓋在下方勾選/按鈕上，給關閉鈕才不會擋到操作）。清空輸入時歸零。
let dismissedHintTerm = null;

// Check and show search hints
function checkAndShowSearchHint(searchTerm) {
    const searchHintsContainer = document.getElementById('search-hints-container');

    // 清空之前的提示
    if (searchHintsContainer) {
        searchHintsContainer.innerHTML = '';
    }

    if (!searchTerm || searchTerm.length < 2) {
        if (!searchTerm) dismissedHintTerm = null; // 清空輸入 → 重置關閉狀態
        return;
    }

    const key = searchTerm.toLowerCase();
    if (key === dismissedHintTerm) {
        return; // 此關鍵詞的提示已被使用者關閉
    }

    const hint = cardsData.searchHints?.[key];

    if (hint && hint.suggestions.length > 0) {
        const hintDiv = document.createElement('div');
        hintDiv.className = 'search-hint';
        // 關閉鈕（手機版浮層蓋在勾選/計算鈕上時，讓使用者能收起提示）
        hintDiv.innerHTML = `
            <button type="button" class="search-hint-close" aria-label="關閉提示" onclick="dismissSearchHint()">✕</button>
            <span class="hint-message">${hint.message}</span>
            <div class="hint-suggestions">
                ${hint.suggestions.map(s =>
                    `<button class="hint-button" onclick="searchFromHint('${s}')">${s}</button>`
                ).join('')}
            </div>
        `;
        searchHintsContainer.appendChild(hintDiv);
    }
}

// 關閉目前的搜尋提示，並記住關鍵詞，避免同詞再次彈出
function dismissSearchHint() {
    const merchantInput = document.getElementById('merchant-input');
    dismissedHintTerm = merchantInput ? (merchantInput.value || '').trim().toLowerCase() : null;
    const searchHintsContainer = document.getElementById('search-hints-container');
    if (searchHintsContainer) {
        searchHintsContainer.innerHTML = '';
    }
}

// Search from hint button
function searchFromHint(suggestion) {
    const merchantInput = document.getElementById('merchant-input');
    if (merchantInput) {
        dismissedHintTerm = null; // 使用者採用建議，換新關鍵詞
        merchantInput.value = suggestion;
        // 觸發 input 事件來更新匹配狀態
        merchantInput.dispatchEvent(new Event('input'));
        // 自動計算回饋
        calculateCashback();
    }
}

// Handle merchant input changes
// 依輸入框是否有內容切換清除 ✕ 的顯示（手動輸入與程式填值都要呼叫）
function updateMerchantClearBtn() {
    const btn = document.getElementById('merchant-clear-btn');
    if (btn) btn.hidden = merchantInput.value.length === 0;
}

function handleMerchantInput() {
    const input = merchantInput.value.trim().toLowerCase();
    updateMerchantClearBtn();

    console.log('🔍 handleMerchantInput:', input);

    // Clear quick search option when user manually types
    currentQuickSearchOption = null;

    // 🔥 新增：檢查並顯示搜尋提示
    checkAndShowSearchHint(input);

    if (input.length === 0) {
        hideMatchedItem();
        toggleExactSearchEmptyHint(false);
        currentMatchedItem = null;
        validateInputs();
        return;
    }

    // Find matching items (now returns array)
    const exactOnly = isExactSearchEnabled();
    const matchedItems = findMatchingItem(input, { exactOnly });

    console.log('  findMatchingItem 結果:', matchedItems ? matchedItems.length : 0);

    if (matchedItems && matchedItems.length > 0) {
        // Get cards to compare for parking benefits check
        const cardsToCompare = getCardsForComparison();
        showMatchedItem(matchedItems, input, cardsToCompare);
        toggleExactSearchEmptyHint(false);
        currentMatchedItem = matchedItems; // Now stores array of matches
        console.log('  ✅ 設定 currentMatchedItem:', currentMatchedItem.length);
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
        // 精準搜尋下沒有完全一致、但放寬後有相近結果 → 提示用戶可取消勾選
        const relaxedWouldMatch = exactOnly &&
            (findMatchingItem(input) || []).length > 0;
        toggleExactSearchEmptyHint(relaxedWouldMatch);
        console.log('  ❌ 無匹配，清除 currentMatchedItem');
    }

    validateInputs();
}

