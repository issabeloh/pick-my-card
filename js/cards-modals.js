/* ============================================================
 * Pick My Card — js/cards-modals.js（載入順序 8/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 手機側選單                → "setupSidebarDrawer"
 *  - 卡片選擇 modal 共用渲染    → "_renderCardSelectionModal"
 *  - 管理比較卡/持有卡入口      → "openManageCardsModal" / "openMyOwnedCardsModal"
 *  - 持有卡總覽（wallet stack） → "renderOwnedCardsOverview"
 *  - 持有卡管理 modal           → "openManageOwnedCardsModal" / "setupMyOwnedCardsModal"
 *  - 卡片標籤/條件顯示 helpers  → "getTagClass" / "renderConditionLine"
 * ============================================================ */
// ==========================================
// Sidebar Drawer (Mobile)
// ==========================================

function setupSidebarDrawer() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const closeBtn = document.getElementById('sidebar-close-btn');

    if (!sidebar || !overlay || !toggleBtn || !closeBtn) return;

    function openDrawer() {
        // Ensure sidebar content is visible (may be hidden on landing page)
        const supportedCards = sidebar.querySelector('.supported-cards');
        if (supportedCards) supportedCards.style.display = 'block';

        sidebar.classList.add('open');
        overlay.classList.add('active');
        disableBodyScroll();
    }

    function closeDrawer() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        enableBodyScroll();
    }
    window.closeSidebarDrawer = closeDrawer;

    toggleBtn.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeDrawer();
        }
    });

    // Close drawer when resizing to desktop
    let wasMobileDrawer = window.innerWidth <= 768;
    window.addEventListener('resize', () => {
        const nowMobile = window.innerWidth <= 768;
        if (wasMobileDrawer && !nowMobile) {
            closeDrawer();
        }
        wasMobileDrawer = nowMobile;
    });
}

// Shared renderer for card-selection modals (used by both Manage Cards and My Owned Cards).
// Populates tag filter chips, the card list with checkboxes, search filter, and updates
// toggle-all button state. Caller is responsible for showing the modal afterwards.
function _renderCardSelectionModal(config) {
    const cardsSelection = document.getElementById(config.selectionId);
    const tagFilterChips = document.getElementById(config.tagFilterChipsId);
    const searchInput = document.getElementById(config.searchInputId);
    const toggleAllBtn = document.getElementById(config.toggleAllBtnId);
    const saveBtn = document.getElementById(config.saveBtnId);

    const currentSelection = config.currentSelection;
    const isLoggedIn = currentUser !== null;
    const canEdit = isLoggedIn || config.allowGuestEdit === true;

    // Collect all unique tags
    const allTags = new Set();
    cardsData.cards.forEach(card => {
        if (card.tags && Array.isArray(card.tags)) {
            card.tags.forEach(tag => allTags.add(tag));
        }
    });

    // Wire up the collapsible tag-filter-section toggle (idempotent).
    const tagFilterSection = tagFilterChips ? tagFilterChips.closest('.tag-filter-section') : null;
    const tagFilterToggle = tagFilterSection ? tagFilterSection.querySelector('.tag-filter-toggle') : null;
    if (tagFilterToggle && !tagFilterToggle.dataset.bound) {
        tagFilterToggle.dataset.bound = '1';
        tagFilterToggle.addEventListener('click', () => {
            const collapsed = tagFilterSection.classList.toggle('collapsed');
            tagFilterToggle.setAttribute('aria-expanded', String(!collapsed));
            tagFilterChips.hidden = collapsed;
        });
    }

    // Render tag filter chips
    const selectedTags = new Set();
    if (allTags.size > 0) {
        tagFilterChips.innerHTML = '';
        const sortedTags = ['旅遊', '開車族', '餐飲', '交通', '網購', '百貨公司', '外送', '娛樂', '行動支付', 'AI工具', '便利商店', '串流平台', '超市', '藥妝', '時尚品牌', '直銷品牌', '生活百貨', '運動', '寵物', '親子', '應用程式商店', '飲食品牌', '美妝美髮保養品牌', '保費']
            .filter(tag => allTags.has(tag));
        sortedTags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = `tag-filter-chip card-tag ${getTagClass(tag)}`;
            chip.textContent = tag;
            chip.dataset.tag = tag;
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                if (chip.classList.contains('active')) selectedTags.add(tag);
                else selectedTags.delete(tag);
                applyFilters();
            });
            tagFilterChips.appendChild(chip);
        });
    }

    // Populate cards selection
    cardsSelection.innerHTML = '';

    // Show login prompt if user can't edit (guest in a guest-disabled mode)
    if (!canEdit && config.guestPromptText) {
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
            grid-column: 1 / -1;
            width: 100%;
        `;
        loginPrompt.textContent = config.guestPromptText;
        cardsSelection.appendChild(loginPrompt);
    }

    const sortedCards = [...cardsData.cards].sort((a, b) => a.name.localeCompare(b.name));
    sortedCards.forEach(card => {
        const isSelected = currentSelection.has(card.id);
        const cardDiv = document.createElement('div');
        cardDiv.className = `card-checkbox ${isSelected ? 'selected' : ''}`;
        const checkboxId = `${config.selectionId}-${card.id}`;
        cardDiv.innerHTML = `
            <div class="card-checkbox-row">
                <input type="checkbox" id="${checkboxId}" value="${card.id}" ${isSelected ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}>
                <label for="${checkboxId}" class="card-checkbox-label">${card.name}</label>
                <button type="button" class="card-detail-peek-btn" aria-label="查看詳情" title="查看詳情">ⓘ</button>
            </div>
            <img class="card-checkbox-image" alt="" src="assets/images/cards/${card.id}.png" onerror="this.style.display='none'">
        `;
        const checkbox = cardDiv.querySelector('input');
        if (canEdit) {
            checkbox.addEventListener('change', () => {
                cardDiv.classList.toggle('selected', checkbox.checked);
            });
        }
        const peekBtn = cardDiv.querySelector('.card-detail-peek-btn');
        peekBtn.addEventListener('click', (e) => {
            // Don't toggle the checkbox or close the host modal
            e.preventDefault();
            e.stopPropagation();
            showCardDetail(card.id);
        });
        const img = cardDiv.querySelector('.card-checkbox-image');
        if (img && canEdit) {
            img.addEventListener('click', (e) => {
                e.stopPropagation();
                checkbox.checked = !checkbox.checked;
                cardDiv.classList.toggle('selected', checkbox.checked);
            });
        }
        cardsSelection.appendChild(cardDiv);
    });

    // Enable/disable footer buttons based on edit permission
    if (!canEdit) {
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
        const allSelected = sortedCards.every(card => currentSelection.has(card.id));
        toggleAllBtn.textContent = allSelected ? '全不選' : '全選';
    }

    // Search filter (combined with tag filter)
    searchInput.value = '';
    function applyFilters() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        cardsSelection.querySelectorAll('.card-checkbox').forEach(cardDiv => {
            const checkbox = cardDiv.querySelector('input[type="checkbox"]');
            if (!checkbox) return;
            const cardId = checkbox.value;
            const card = cardsData.cards.find(c => c.id === cardId);
            if (!card) return;
            const label = cardDiv.querySelector('.card-checkbox-label');
            if (!label) return;
            const matchesSearch = searchTerm === '' || label.textContent.toLowerCase().includes(searchTerm);
            let matchesTags = true;
            if (selectedTags.size > 0) {
                const cardTags = card.tags || [];
                matchesTags = [...selectedTags].every(t => cardTags.includes(t));
            }
            cardDiv.style.display = matchesSearch && matchesTags ? 'flex' : 'none';
        });
    }
    // Detach previous listener (each open call) to avoid duplicates
    if (searchInput._cardSelectionListener) {
        searchInput.removeEventListener('input', searchInput._cardSelectionListener);
    }
    searchInput._cardSelectionListener = applyFilters;
    searchInput.addEventListener('input', applyFilters);
}

// Open the "管理加入比較的卡片" modal
function openManageCardsModal() {
    _renderCardSelectionModal({
        selectionId: 'cards-selection',
        tagFilterChipsId: 'tag-filter-chips',
        searchInputId: 'search-cards-input',
        toggleAllBtnId: 'toggle-all-cards',
        saveBtnId: 'save-cards-btn',
        currentSelection: cardsInComparison,
        allowGuestEdit: true
    });

    updateApplyOwnedButtonState();

    // 篩選標籤每次開 modal 都預設收合（不記憶上次展開狀態）
    const tagSection = document.getElementById('manage-tag-filter-section');
    if (tagSection && !tagSection.classList.contains('collapsed')) {
        tagSection.classList.add('collapsed');
        const toggle = tagSection.querySelector('.tag-filter-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        const chips = document.getElementById('tag-filter-chips');
        if (chips) chips.hidden = true;
    }

    const modal = document.getElementById('manage-cards-modal');
    modal.style.display = 'flex';
    disableBodyScroll();
}

// Open the "我的信用卡" modal (avatar dropdown) — shows the owned-cards overview.
// Guests are allowed to edit; data persists to localStorage and asks to merge on login.
function openMyOwnedCardsModal() {
    renderOwnedCardsOverview();

    const modal = document.getElementById('my-owned-cards-modal');
    modal.style.display = 'flex';
    disableBodyScroll();
}

// Render the owned-cards overview tiles (image + name, click opens card detail).
// Shows an empty-state prompt with a "新增信用卡" button when nothing is selected.
function renderOwnedCardsOverview() {
    const container = document.getElementById('owned-cards-overview');
    if (!container) return;
    container.innerHTML = '';

    const ownedCards = [...cardsData.cards]
        .filter(card => myOwnedCards.has(card.id))
        .sort((a, b) => a.name.localeCompare(b.name));

    const badge = document.getElementById('owned-count-badge');

    if (ownedCards.length === 0) {
        if (badge) badge.style.display = 'none';
        const empty = document.createElement('div');
        empty.className = 'owned-overview-empty';
        empty.innerHTML = `
            <p class="owned-overview-empty-text">你還沒有新增任何信用卡。</p>
            <button type="button" id="owned-overview-add-btn" class="manage-owned-btn">
                <span aria-hidden="true">＋</span> 新增信用卡
            </button>
        `;
        container.appendChild(empty);
        const addBtn = empty.querySelector('#owned-overview-add-btn');
        addBtn.addEventListener('click', openManageOwnedCardsModal);
        return;
    }

    const count = ownedCards.length;

    // Card count lives as quiet muted text after the modal title.
    if (badge) {
        badge.textContent = `・${count} 張`;
        badge.style.display = '';
    }

    // --- View 1: wallet stack — all cards at a glance, no names.
    // Tap a covered card to reveal its full face in place; tap a fully
    // visible card to open the solo view. ---
    const stack = document.createElement('div');
    stack.className = 'ow-stack';
    container.appendChild(stack);

    // "收合" pill: appears only while a card is revealed, folds the
    // stack fully closed again.
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'ow-collapse-btn';
    collapseBtn.textContent = '收合';
    collapseBtn.style.display = 'none';
    container.appendChild(collapseBtn);

    // --- View 2: solo card + personal info area (hidden until opened) ---
    const solo = document.createElement('div');
    solo.className = 'ow-solo';
    solo.style.display = 'none';
    container.appendChild(solo);

    const GAP = 40;    // breathing room under a revealed card
    let expanded = null;
    let soloIndex = 0;

    // Builds a card-face frame; portrait art is auto-rotated to landscape.
    const makeFace = (card) => {
        const frame = document.createElement('div');
        frame.className = 'ow-frame';
        const img = document.createElement('img');
        img.className = 'ow-img';
        img.alt = card.name;
        img.src = `assets/images/cards/${card.id}.png`;
        img.addEventListener('load', () => {
            if (img.naturalHeight > img.naturalWidth) frame.classList.add('ow-portrait');
        });
        img.addEventListener('error', () => {
            frame.classList.add('ow-noimg');
            frame.textContent = card.name;
        });
        frame.appendChild(img);
        return frame;
    };

    const slots = ownedCards.map((card, i) => {
        const slot = document.createElement('div');
        slot.className = 'ow-slot';
        slot.style.zIndex = String(i + 1);
        slot.setAttribute('role', 'button');
        slot.setAttribute('tabindex', '0');
        slot.setAttribute('aria-label', card.name);
        slot.appendChild(makeFace(card));
        // Tap-again affordance: pill fades in on the revealed card.
        const hint = document.createElement('div');
        hint.className = 'ow-hint';
        hint.textContent = '查看個人資訊 ›';
        slot.appendChild(hint);
        const activate = () => {
            // Fully visible cards (revealed, or the bottom-most) open solo view.
            if (i === expanded || i === count - 1) openSolo(i);
            else { expanded = i; layoutStack(); }
        };
        slot.addEventListener('click', activate);
        slot.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
        stack.appendChild(slot);
        return slot;
    });

    const layoutStack = () => {
        const h = stack.clientWidth / 1.586; // standard card aspect ratio
        // Budget ~320px for the whole stack: the more cards, the thinner
        // each visible strip (floor of 12px).
        const peek = Math.max(12, Math.min(40, Math.round((320 - h) / Math.max(1, count - 1))));
        let shift = 0, maxBottom = 0;
        slots.forEach((slot, i) => {
            slot.classList.toggle('ow-open', expanded === i);
            const top = i * peek + shift;
            slot.style.top = `${top}px`;
            maxBottom = Math.max(maxBottom, top + h);
            if (expanded === i) shift = h - peek + GAP;
        });
        stack.style.height = `${Math.ceil(maxBottom)}px`;
        collapseBtn.style.display = expanded === null ? 'none' : '';
    };

    collapseBtn.addEventListener('click', () => {
        expanded = null;
        layoutStack();
    });

    const openSolo = (i) => {
        soloIndex = i;
        renderSolo();
        stack.style.display = 'none';
        collapseBtn.style.display = 'none';
        solo.style.display = '';
    };

    const backToStack = () => {
        solo.style.display = 'none';
        stack.style.display = '';
        expanded = soloIndex; // keep the card you were viewing revealed
        layoutStack();
    };

    let soloToken = 0;

    const renderSolo = () => {
        const card = ownedCards[soloIndex];
        const token = ++soloToken;
        solo.innerHTML = '';

        const top = document.createElement('div');
        top.className = 'ow-solo-top';
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'ow-back';
        back.innerHTML = '‹ 所有卡片';
        back.addEventListener('click', backToStack);
        top.appendChild(back);
        solo.appendChild(top);

        const row = document.createElement('div');
        row.className = 'ow-solo-row';
        // Arrows and swipe wrap around (last → first, first → last).
        const step = (dir) => {
            soloIndex = (soloIndex + dir + count) % count;
            renderSolo();
        };
        const mkArrow = (dir) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ow-arrow';
            b.innerHTML = dir < 0 ? '‹' : '›';
            b.setAttribute('aria-label', dir < 0 ? '上一張' : '下一張');
            b.disabled = count <= 1;
            b.addEventListener('click', () => step(dir));
            return b;
        };
        row.appendChild(mkArrow(-1));
        const face = makeFace(card);
        face.classList.add('ow-solo-face');
        // Swipe left/right to switch cards.
        let sx = null;
        face.addEventListener('pointerdown', (e) => { sx = e.clientX; });
        face.addEventListener('pointerup', (e) => {
            if (sx === null) return;
            const dx = e.clientX - sx;
            sx = null;
            if (dx < -40 && count > 1) step(1);
            else if (dx > 40 && count > 1) step(-1);
        });
        row.appendChild(face);
        row.appendChild(mkArrow(1));
        solo.appendChild(row);

        const name = document.createElement('div');
        name.className = 'ow-solo-name';
        name.textContent = card.name;
        solo.appendChild(name);

        const dots = document.createElement('div');
        dots.className = 'ow-dots';
        ownedCards.forEach((_, i) => {
            const d = document.createElement('i');
            if (i === soloIndex) d.className = 'on';
            dots.appendChild(d);
        });
        solo.appendChild(dots);

        // --- Read-only personal info (editing lives in the card detail page) ---
        const info = document.createElement('div');
        info.className = 'ow-solo-info';
        const infoHead = document.createElement('div');
        infoHead.className = 'ow-info-head';
        infoHead.textContent = '個人化設定';
        info.appendChild(infoHead);
        const list = document.createElement('div');
        list.className = 'ow-info-list';
        list.innerHTML = '<div class="ow-info-loading">載入中…</div>';
        info.appendChild(list);
        const detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className = 'ow-detail-btn';
        detailBtn.textContent = '前往卡片介紹頁編輯 ›';
        detailBtn.addEventListener('click', () => showCardDetail(card.id));
        info.appendChild(detailBtn);
        solo.appendChild(info);

        fillSoloInfo(card, list, token);
    };

    const fillSoloInfo = async (card, list, token) => {
        const hasLevels = !!(card.hasLevels && card.levelSettings);
        // Each load falls back to a default if storage (e.g. Firebase) is
        // unavailable, so the panel always renders.
        const safe = (fn, fallback) => {
            try { return Promise.resolve(fn()).catch(() => fallback); }
            catch (_) { return Promise.resolve(fallback); }
        };
        const defaultLevel = hasLevels ? Object.keys(card.levelSettings)[0] : null;
        const [level, notes, feeWaived, creditLimit] = await Promise.all([
            hasLevels ? safe(() => getCardLevel(card.id, defaultLevel), defaultLevel) : Promise.resolve(null),
            safe(() => loadUserNotes(card.id), ''),
            safe(() => loadFeeWaiverStatus(card.id), false),
            safe(() => loadCreditLimit(card.id), null)
        ]);
        if (token !== soloToken) return; // user switched cards while loading

        list.innerHTML = '';
        const addRow = (label, value, cls) => {
            const row = document.createElement('div');
            row.className = 'ow-info-row';
            const l = document.createElement('span');
            l.className = 'ow-info-label';
            l.textContent = label;
            const v = document.createElement('span');
            v.className = 'ow-info-value' + (cls ? ' ' + cls : '');
            v.textContent = value;
            row.appendChild(l);
            row.appendChild(v);
            list.appendChild(row);
        };

        if (hasLevels && level) {
            const label = card.levelLabelFormat
                ? card.levelLabelFormat.replace('{level}', level)
                : level;
            addRow('卡片分級', label);
        }
        // 發卡組織／生日月份／童樂匯 are CUBE-specific settings today.
        if (card.id === 'cathay-cube') {
            addRow('發卡組織', cubeIssuer);
            addRow('生日月份', userBirthdayMonth ? `${userBirthdayMonth} 月` : '未填寫',
                userBirthdayMonth ? '' : 'ow-muted');
            addRow('童樂匯權益', isChildrenEligible ? '✓ 符合' : '不符合',
                isChildrenEligible ? 'ow-ok' : 'ow-muted');
        }
        addRow('免年費門檻', feeWaived ? '✓ 已達成' : '尚未達成', feeWaived ? 'ow-ok' : 'ow-warn');
        addRow('我的額度', creditLimit !== null ? `NT$ ${creditLimit.toLocaleString()}` : '未填寫',
            creditLimit !== null ? '' : 'ow-muted');

        const noteText = (notes || '').trim();
        const noteRow = document.createElement('div');
        noteRow.className = 'ow-info-note';
        const noteLabel = document.createElement('div');
        noteLabel.className = 'ow-info-label';
        noteLabel.textContent = '我的筆記';
        const noteBody = document.createElement('div');
        noteBody.className = 'ow-note-text' + (noteText ? '' : ' ow-note-empty');
        noteBody.textContent = noteText || '未填寫';
        noteRow.appendChild(noteLabel);
        noteRow.appendChild(noteBody);
        list.appendChild(noteRow);
    };

    // The modal isn't displayed yet when this runs; lay out on the next
    // frame (and again on resize) so clientWidth is real.
    requestAnimationFrame(() => requestAnimationFrame(layoutStack));
    if (renderOwnedCardsOverview._onResize) {
        window.removeEventListener('resize', renderOwnedCardsOverview._onResize);
    }
    renderOwnedCardsOverview._onResize = layoutStack;
    window.addEventListener('resize', renderOwnedCardsOverview._onResize);
}

// Open the "管理我的信用卡" modal (stacked on top of the overview).
function openManageOwnedCardsModal() {
    _renderCardSelectionModal({
        selectionId: 'owned-cards-selection',
        tagFilterChipsId: 'owned-tag-filter-chips',
        searchInputId: 'search-owned-cards-input',
        toggleAllBtnId: 'toggle-all-owned-cards',
        saveBtnId: 'save-owned-cards-btn',
        currentSelection: myOwnedCards,
        allowGuestEdit: true
    });

    const modal = document.getElementById('manage-owned-cards-modal');
    modal.style.display = 'flex';
    disableBodyScroll();

    // Always open at the top — don't keep the previous session's scroll.
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

    // 篩選標籤預設收合（需要時再點開）
    const tagSection = document.getElementById('owned-tag-filter-section');
    if (tagSection && !tagSection.classList.contains('collapsed')) {
        tagSection.classList.add('collapsed');
        const toggle = tagSection.querySelector('.tag-filter-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        const chips = document.getElementById('owned-tag-filter-chips');
        if (chips) chips.hidden = true;
    }
}

// Update the "套用我的信用卡選項" button state.
// Disabled only when no owned cards set (works for guests via localStorage too).
function updateApplyOwnedButtonState() {
    const btn = document.getElementById('apply-owned-cards-btn');
    if (!btn) return;
    if (myOwnedCards.size === 0) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.title = '先去頭像下拉選單設定「我的信用卡」';
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.title = '一鍵套用「我的信用卡」';
    }
}

// Setup the "我的信用卡" overview modal + the stacked "管理我的信用卡" modal.
function setupMyOwnedCardsModal() {
    const overviewModal = document.getElementById('my-owned-cards-modal');
    const manageModal = document.getElementById('manage-owned-cards-modal');
    if (!overviewModal || !manageModal) return;

    // --- Overview modal (layer 1) ---
    const closeOverviewBtn = document.getElementById('close-owned-modal');
    const manageBtn = document.getElementById('manage-owned-cards-btn');

    const closeOverview = () => {
        overviewModal.style.display = 'none';
        enableBodyScroll();
    };

    closeOverviewBtn.addEventListener('click', closeOverview);
    overviewModal.addEventListener('click', (e) => { if (e.target === overviewModal) closeOverview(); });
    manageBtn.addEventListener('click', openManageOwnedCardsModal);

    // --- Manage modal (layer 2, stacked on top of overview) ---
    const closeManageBtn = document.getElementById('close-manage-owned-modal');
    const cancelBtn = document.getElementById('cancel-owned-cards-btn');
    const saveBtn = document.getElementById('save-owned-cards-btn');
    const toggleAllBtn = document.getElementById('toggle-all-owned-cards');

    // Closes the manage modal only — overview underneath stays open.
    const closeManage = () => {
        manageModal.style.display = 'none';
        enableBodyScroll();
    };

    closeManageBtn.addEventListener('click', closeManage);
    cancelBtn.addEventListener('click', closeManage);
    manageModal.addEventListener('click', (e) => { if (e.target === manageModal) closeManage(); });

    // Top save button (on the 全選 row) proxies the bottom one so users
    // don't have to scroll to the footer to save.
    const saveBtnTop = document.getElementById('save-owned-cards-btn-top');
    if (saveBtnTop) saveBtnTop.addEventListener('click', () => saveBtn.click());

    saveBtn.addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('#owned-cards-selection input[type="checkbox"]');
        const newSelection = new Set();
        checkboxes.forEach(cb => { if (cb.checked) newSelection.add(cb.value); });
        myOwnedCards = newSelection;
        await saveMyOwnedCards();
        closeManage();
        // Refresh the overview underneath so it reflects the new selection
        renderOwnedCardsOverview();
    });

    toggleAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#owned-cards-selection input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        if (allChecked) {
            checkboxes.forEach(cb => { cb.checked = false; cb.parentElement.classList.remove('selected'); });
            toggleAllBtn.textContent = '全選';
        } else {
            checkboxes.forEach(cb => { cb.checked = true; cb.parentElement.classList.add('selected'); });
            toggleAllBtn.textContent = '全不選';
        }
    });
}

// Show card detail modal
// Helper function to convert tag name to CSS class
function getTagClass(tagName) {
    const tagMap = {
        '旅遊': 'tag-travel',
        '開車族': 'tag-driving',
        '餐飲': 'tag-restaurant',
        '交通': 'tag-transport',
        '網購': 'tag-online',
        '百貨公司': 'tag-department',
        '外送': 'tag-delivery',
        '娛樂': 'tag-entertainment',
        '行動支付': 'tag-payment',
        'AI工具': 'tag-ai',
        '便利商店': 'tag-convenience',
        '串流平台': 'tag-streaming',
        '超市': 'tag-supermarket',
        '藥妝': 'tag-pharmacy',
        '時尚品牌': 'tag-fashion',
        '直銷品牌': 'tag-direct-sales',
        '生活百貨': 'tag-lifestyle',
        '運動': 'tag-sports',
        '寵物': 'tag-pet',
        '親子': 'tag-family',
        '應用程式商店': 'tag-appstore',
        '飲食品牌': 'tag-food-brand',
        '美妝美髮保養品牌': 'tag-beauty-brand',
        '保費': 'tag-insurance'
    };
    return tagMap[tagName] || 'tag-default';
}

// Helper function to render card tags
function renderCardTags(tags) {
    if (!tags || tags.length === 0) return '';

    const tagsHtml = tags.map(tag =>
        `<span class="card-tag ${getTagClass(tag)}">${tag}</span>`
    ).join('');

    return `<div class="card-tags-container">${tagsHtml}</div>`;
}

// Render a 條件 line that clamps to a few lines and reveals a 展開/收起 toggle
// only when the text actually overflows (see initConditionClamps + CSS
// .cond-collapsible). Used in the card-detail activity cards so a long 條件
// doesn't blow up the card height (esp. now that rows are equal-height).
function renderConditionLine(text) {
    return `<div class="cashback-condition cond-collapsible">` +
        `<span class="cond-text">條件: ${text}</span>` +
        `<button type="button" class="cond-toggle" style="display:none;">...展開</button>` +
        `</div>`;
}

// After the detail content is in the DOM AND visible, reveal a toggle only on
// conditions whose text is actually clamped (overflowing). Must run while the
// modal is displayed, otherwise clientHeight/scrollHeight are 0.
function initConditionClamps(container) {
    if (!container) return;
    container.querySelectorAll('.cond-collapsible').forEach(el => {
        const text = el.querySelector('.cond-text');
        const btn = el.querySelector('.cond-toggle');
        if (!text || !btn) return;
        // Overflowing = content taller than the clamped box (2px tolerance)
        if (text.scrollHeight - text.clientHeight > 2) {
            btn.style.display = 'inline';
            btn.onclick = (e) => {
                e.stopPropagation();
                const expanded = el.classList.toggle('expanded');
                btn.textContent = expanded ? '收起' : '...展開';
            };
        } else {
            btn.style.display = 'none';
        }
    });
}

