/* ============================================================
 * Pick My Card — js/cards-modals.js（載入順序第 8 支模組檔；完整順序以 index.html 的 <script> 標籤為準）
 * 區塊目錄（Grep 關鍵字）：
 *  - 手機側選單                → "setupSidebarDrawer"
 *  - 卡片選擇 modal 共用渲染    → "_renderCardSelectionModal" / "updateSelectionDirtyState"
 *  - 管理比較卡/持有卡入口      → "openManageCardsModal" / "openMyOwnedCardsModal"
 *  - 持有卡總覽（卡片格）       → "renderOwnedCardsOverview"
 *  - 單卡面板（點卡片直接編輯）→ "openOwnedCardPanel" / "ownedPanelExit"
 *  - 持有卡管理 modal           → "openManageOwnedCardsModal" / "setupMyOwnedCardsModal"
 *  - 卡片標籤/條件顯示 helpers  → "getTagClass" / "renderCardTags" / "renderConditionLine"
 *  - 側選單「最近異動」          → "renderSidebarChangelog"
 * ============================================================ */
// ==========================================
// Sidebar Drawer (Mobile)
// ==========================================

// 首訪引導動畫：手機版剛進到工具頁時，把側選單「探頭」露出約 1/4 再收回，
// 收回後漢堡鍵抖一下，讓使用者知道左上角那個 icon 底下有東西。
// 演滿 SIDEBAR_PEEK_MAX 次就不再演——第一次很可能人還沒看螢幕就錯過了，
// 所以給兩次機會（分兩次造訪，不是同一次連演兩遍：同一次連演只會在同一個
// 時間點重複，錯過的人還是錯過）。次數存在 localStorage 的
// pmc_sidebar_peek_count，與 index.html 的 pmc_seen_landing 一樣是純字串
// 旗標、不是 JSON，所以不走 readLocalJSON。
//
// 刻意不用 openDrawer()：探頭階段不掛遮罩、不鎖 body 捲動、側欄本身
// pointer-events:none，純粹是視覺提示，使用者要捲要點都不受影響。
const SIDEBAR_PEEK_FLAG = 'pmc_sidebar_peek_count';
const SIDEBAR_PEEK_MAX = 2;

function playSidebarPeekHint(sidebar, toggleBtn) {
    if (window.innerWidth > 768) return;                       // 桌機／平板側欄常駐，不需要提示
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let played = SIDEBAR_PEEK_MAX;
    try {
        played = parseInt(localStorage.getItem(SIDEBAR_PEEK_FLAG), 10) || 0;
    } catch (e) {
        return;  // localStorage 不可用（無痕強化）：不演，免得每次進來都動一次
    }
    if (played >= SIDEBAR_PEEK_MAX) return;

    // 等 boot loader 收掉再演，否則動畫會被載入遮罩蓋住等於沒演。
    // 最多等 5 秒，逾時就放棄（auth 卡住時不要無限等）。
    let waited = 0;
    const startWhenReady = () => {
        const booting = document.documentElement.classList.contains('pmc-returning-user');
        if (booting && waited < 5000) {
            waited += 200;
            setTimeout(startWhenReady, 200);
            return;
        }
        if (booting) return;
        setTimeout(runPeek, 600);   // 讓首屏先安定一下再動
    };

    const runPeek = () => {
        if (sidebar.classList.contains('open')) return;   // 使用者已自己打開，提示就沒必要了
        // 首次引導導覽進行中（js/home-ui.js「首次引導」）：不演，側欄會滑進打亮的區域裡；導覽最後一步本來就在講選卡。
        // 這次不算次數，下次來照常演
        if (document.documentElement.classList.contains('pmc-onboard')) return;
        try { localStorage.setItem(SIDEBAR_PEEK_FLAG, String(played + 1)); } catch (e) { /* 寫不進去就算了 */ }

        sidebar.classList.add('peek');
        setTimeout(() => {
            sidebar.classList.remove('peek');
            // 等側欄滑回去（CSS transition 0.3s）再讓漢堡鍵抖，兩段動作才有因果感
            setTimeout(() => {
                toggleBtn.classList.add('hb-nudge');
                setTimeout(() => toggleBtn.classList.remove('hb-nudge'), 1500);  // 動畫 0.7s x 2 次
            }, 320);
        }, 900);
    };

    startWhenReady();
}

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

        sidebar.classList.remove('peek');   // 使用者自己開了就中斷首訪探頭提示
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

    playSidebarPeekHint(sidebar, toggleBtn);

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
// Populates tag filter chips, the card rows, search filter, and updates
// toggle-all button state. Caller is responsible for showing the modal afterwards.
// 版面（2026-11-26 站長從選項頁選 A「單欄清單列」）：每張卡一列＝小卡面＋卡名＋圓形勾選，整列是 <label> 所以點哪裡都能勾；
// 沒有「詳情」鈕。打開當下已勾選的排最前面（只在打開時排，勾選中不跳位）。
// 篩選標籤跟動作鈕（全選／套用我的信用卡／已選 N）放在同一條單行橫向滑動的工具列（config.tagFilterChipsId）
function _renderCardSelectionModal(config) {
    const cardsSelection = document.getElementById(config.selectionId);
    const tagFilterChips = document.getElementById(config.tagFilterChipsId);
    const searchInput = document.getElementById(config.searchInputId);
    const toggleAllBtn = config.toggleAllBtnId ? document.getElementById(config.toggleAllBtnId) : null;
    const onlySelectedBtn = config.onlySelectedBtnId ? document.getElementById(config.onlySelectedBtnId) : null;
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

    // Render tag filter chips（工具列前面的動作鈕是 HTML 寫死的，只換掉標籤）
    const selectedTags = new Set();
    if (tagFilterChips) {
        tagFilterChips.querySelectorAll('.tag-filter-chip').forEach(chip => chip.remove());
        tagFilterChips.scrollLeft = 0;
        const sortedTags = CARD_TAG_DEFS.map(def => def.name)
            .filter(tag => allTags.has(tag));
        sortedTags.forEach(tag => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `tag-filter-chip card-tag ${getTagClass(tag)}`;
            chip.textContent = tag;
            chip.dataset.tag = tag;
            chip.setAttribute('aria-pressed', 'false');
            chip.addEventListener('click', () => {
                const on = chip.classList.toggle('active');
                chip.setAttribute('aria-pressed', String(on));
                if (on) selectedTags.add(tag);
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
            margin: 0 16px 12px;
            border-radius: 8px;
            text-align: center;
            font-weight: 500;
            grid-column: 1 / -1;
        `;
        loginPrompt.textContent = config.guestPromptText;
        cardsSelection.appendChild(loginPrompt);
    }

    // 已勾選的排前面，各自再照卡名排
    const sortedCards = [...cardsData.cards].sort((a, b) =>
        (currentSelection.has(b.id) - currentSelection.has(a.id)) || a.name.localeCompare(b.name));
    sortedCards.forEach(card => {
        const isSelected = currentSelection.has(card.id);
        const checkboxId = `${config.selectionId}-${card.id}`;
        const row = document.createElement('label');
        row.className = `card-checkbox sel-row ${isSelected ? 'selected' : ''}`;
        row.htmlFor = checkboxId;
        row.innerHTML = `
            <span class="sel-face"><img class="card-checkbox-image" alt="" src="assets/images/cards/${escapeHtml(card.id)}.png"></span>
            <span class="card-checkbox-label">${escapeHtml(card.name)}</span>
            <input type="checkbox" class="sel-check" id="${escapeHtml(checkboxId)}" value="${escapeHtml(card.id)}" ${isSelected ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}>
        `;
        const img = row.querySelector('.card-checkbox-image');
        // 缺圖留空白框（卡名才對得齊）；直式卡圖轉成橫式
        img.addEventListener('error', () => row.querySelector('.sel-face').classList.add('is-missing'));
        img.addEventListener('load', () => {
            if (img.naturalHeight > img.naturalWidth) row.querySelector('.sel-face').classList.add('is-portrait');
        });
        const checkbox = row.querySelector('input');
        if (canEdit) {
            checkbox.addEventListener('change', () => {
                row.classList.toggle('selected', checkbox.checked);
                updateSelectionDirtyState(config.selectionId);
            });
        }
        cardsSelection.appendChild(row);
    });

    // 打開當下的勾選＝比較基準：之後跟它不同「儲存」才可按（只算現有資料裡的卡，下架卡不算改動）
    cardsSelection._initialSelection = new Set(sortedCards.filter(c => currentSelection.has(c.id)).map(c => c.id));

    // Enable/disable toggle-all based on edit permission
    if (toggleAllBtn) {
        toggleAllBtn.disabled = !canEdit;
        if (canEdit) {
            const allSelected = sortedCards.every(card => currentSelection.has(card.id));
            toggleAllBtn.textContent = allSelected ? '全不選' : '全選';
        }
    }

    // 「已選 N」：點了只看勾起來的卡（每次打開都回到看全部）
    let onlySelected = false;
    if (onlySelectedBtn) {
        onlySelectedBtn.setAttribute('aria-pressed', 'false');
        onlySelectedBtn.classList.remove('active');
        onlySelectedBtn.onclick = () => {
            onlySelected = !onlySelected;
            onlySelectedBtn.classList.toggle('active', onlySelected);
            onlySelectedBtn.setAttribute('aria-pressed', String(onlySelected));
            applyFilters();
        };
    }

    updateSelectionDirtyState(config.selectionId);

    // Search filter (combined with tag filter and「已選 N」)
    searchInput.value = '';
    function applyFilters() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        cardsSelection.querySelectorAll('.card-checkbox').forEach(row => {
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (!checkbox) return;
            const cardId = checkbox.value;
            const card = cardsData.cards.find(c => c.id === cardId);
            if (!card) return;
            const label = row.querySelector('.card-checkbox-label');
            if (!label) return;
            const matchesSearch = searchTerm === '' || label.textContent.toLowerCase().includes(searchTerm);
            let matchesTags = true;
            if (selectedTags.size > 0) {
                const cardTags = card.tags || [];
                matchesTags = [...selectedTags].every(t => cardTags.includes(t));
            }
            const matchesSelected = !onlySelected || checkbox.checked;
            row.style.display = matchesSearch && matchesTags && matchesSelected ? '' : 'none';
        });
    }
    // Detach previous listener (each open call) to avoid duplicates
    if (searchInput._cardSelectionListener) {
        searchInput.removeEventListener('input', searchInput._cardSelectionListener);
    }
    searchInput._cardSelectionListener = applyFilters;
    searchInput.addEventListener('input', applyFilters);
    // 清空搜尋後補送 input：清除鈕（✕）跟著藏起來，列也全部顯示（監聽已換成這次的）
    searchInput.dispatchEvent(new Event('input'));
}

// 「儲存」鈕狀態（2026-11-26 改版：儲存鈕搬到固定在頂端的標題列，拿掉底部儲存列與「已變更 N 張」）。
// 「管理我的信用卡」「管理加入比較的卡片」「管理我的行動支付」共用：數一數跟打開當下不同的勾選有幾個，
// 0 → 「儲存」灰色不能按（沒改就用 × 關）；≥1 → 可按。順便更新工具列的「已選 N」（有的話）。
// 比較基準放在勾選容器的 _initialSelection（Set），由打開 modal 的那支設定。
// 勾選框的 change 會觸發；用程式改勾選的地方（全選、套用我的信用卡）要自己呼叫這支
function updateSelectionDirtyState(selectionId) {
    const box = document.getElementById(selectionId);
    const modal = box && box.closest('.modal');
    const saveBtn = modal && modal.querySelector('.sel-save');
    if (!box || !saveBtn) return 0;
    const initial = box._initialSelection || new Set();
    let changed = 0, checked = 0;
    box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.checked) checked++;
        if (cb.checked !== initial.has(cb.value)) changed++;
    });
    saveBtn.disabled = changed === 0;
    const count = modal.querySelector('.sel-count');
    if (count) count.textContent = `已選 ${checked}`;
    return changed;
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

    const modal = document.getElementById('manage-cards-modal');
    modal.style.display = 'flex';
    disableBodyScroll();
}

// Open the "我的信用卡" modal (avatar dropdown) — shows the owned-cards overview.
// Guests are allowed to edit; data persists to localStorage and asks to merge on login.
function openMyOwnedCardsModal() {
    ownedPanelExit({ render: false });   // 每次打開都從卡片格開始
    renderOwnedCardsOverview();

    const modal = document.getElementById('my-owned-cards-modal');
    modal.style.display = 'flex';
    disableBodyScroll();
}

// 「我的信用卡」總覽（2026-11-17 站長選定的「卡片格」；取代 2026-07-07 的錢包堆疊＋單卡頁）。
// 版面：摘要列（持有／總額度／免年費門檻）＋卡片格（卡面、卡名、級別・額度）＋最後一格「新增信用卡」。
// 點卡片 → 同一個視窗換成該卡的個人設定（單卡面板，openOwnedCardPanel；2026-11-22 起，取代「這頁唯讀、
// 點卡片開詳情頁」）。這一層只負責顯示，編輯全在單卡面板、也就是詳情頁那一份個人設定。
// 個人資料（級別／額度／免年費／結帳日）是非同步讀的：先畫卡面與卡名，讀到再補字；每個讀取都包 safe()，
// Firebase 被擋也照樣渲染。🔒 級別只「讀來顯示」，這裡絕不呼叫 saveCardLevel()（鐵則 1）。
// 空狀態：沒有持有卡時顯示提示＋「新增信用卡」鈕。
function renderOwnedCardsOverview() {
    const container = document.getElementById('owned-cards-overview');
    if (!container) return;
    container.innerHTML = '';
    const token = (renderOwnedCardsOverview._token = (renderOwnedCardsOverview._token || 0) + 1);

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

    const mk = (tag, cls, text) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
    };

    // --- 摘要列：張數馬上有；總額度與免年費等資料讀到再填 ---
    const sum = mk('dl', 'ow-sum');
    const mkStat = (label, value) => {
        const cell = mk('div');
        cell.appendChild(mk('dt', '', label));
        const dd = mk('dd', '', value);
        const small = mk('small');
        cell.appendChild(dd);
        cell.appendChild(small);
        sum.appendChild(cell);
        return { dd, small };
    };
    mkStat('持有', `${count} 張`);
    const limitStat = mkStat('總額度', '—');
    const feeStat = mkStat('免年費門檻', '—');
    container.appendChild(sum);

    // --- 卡片格 ---
    const grid = mk('div', 'ow-grid');
    container.appendChild(grid);

    // Card-face frame; portrait art is auto-rotated to landscape.
    const makeFace = (card) => {
        const frame = mk('div', 'ow-frame');
        const img = document.createElement('img');
        img.className = 'ow-img';
        img.alt = '';
        img.loading = 'lazy';
        img.src = `assets/images/cards/${card.id}.png`;
        img.addEventListener('load', () => {
            if (img.naturalHeight > img.naturalWidth) frame.classList.add('ow-portrait');
        });
        img.addEventListener('error', () => {
            img.remove();
            frame.classList.add('ow-noimg');
            frame.textContent = card.name;
        });
        frame.appendChild(img);
        return frame;
    };

    const tiles = ownedCards.map(card => {
        const tile = mk('button', 'ow-tile');
        tile.type = 'button';
        tile.title = `編輯 ${card.name} 的個人設定`;
        const pic = mk('span', 'ow-pic');
        pic.appendChild(makeFace(card));
        tile.appendChild(pic);
        tile.appendChild(mk('span', 'ow-name', card.name));
        const meta = mk('span', 'ow-meta', ' ');
        tile.appendChild(meta);
        tile.addEventListener('click', () => openOwnedCardPanel(card.id));
        grid.appendChild(tile);
        return { card, tile, meta };
    });

    const addTile = mk('button', 'ow-tile ow-tile-add');
    addTile.type = 'button';
    addTile.appendChild(mk('span', 'ow-add', '＋ 新增信用卡'));
    addTile.addEventListener('click', openManageOwnedCardsModal);
    grid.appendChild(addTile);

    // --- 個人資料：讀到再補 ---
    const safe = (fn, fallback) => {
        try { return Promise.resolve(fn()).catch(() => fallback); }
        catch (_) { return Promise.resolve(fallback); }
    };
    const fmtLimit = (n) => (n >= 10000 && n % 1000 === 0)
        ? `額度 ${n / 10000} 萬`
        : `額度 NT$${n.toLocaleString('en-US')}`;

    Promise.all(tiles.map(async ({ card, tile, meta }) => {
        const hasLevels = !!(card.hasLevels && card.levelSettings);
        const defaultLevel = hasLevels ? Object.keys(card.levelSettings)[0] : null;
        const [level, feeWaived, creditLimit, dates] = await Promise.all([
            hasLevels ? safe(() => getCardLevel(card.id, defaultLevel), defaultLevel) : Promise.resolve(null),
            safe(() => loadFeeWaiverStatus(card.id), false),
            safe(() => loadCreditLimit(card.id), null),
            safe(() => loadBillingDates(card.id), null)
        ]);
        if (token !== renderOwnedCardsOverview._token) return null; // 期間重畫過，這批作廢
        const limit = (typeof creditLimit === 'number' && isFinite(creditLimit)) ? creditLimit : null;

        meta.textContent = '';
        if (hasLevels && level) {
            meta.appendChild(document.createTextNode(`${level} ・ `));
        }
        if (limit !== null) meta.appendChild(document.createTextNode(fmtLimit(limit)));
        else meta.appendChild(mk('span', 'ow-faint', '額度未填'));

        // 結帳日／繳款日：有填才多一行（只標有的資訊，同免年費）。statementDate＝結帳日、billingDate＝繳款日
        const sd = dates ? billingDayNumber(dates.statementDate) : null;
        const bd = dates ? billingDayNumber(dates.billingDate) : null;
        if (sd || bd) {
            tile.appendChild(mk('span', 'ow-dates',
                [sd ? `${sd} 日結帳` : '', bd ? `${bd} 日繳款` : ''].filter(Boolean).join('・')));
        }

        // 只標正面訊息（2026-11-17 站長裁定）：沒勾過的人不該整排被標「未達標」，本來就免年費的卡也會被誤標
        if (feeWaived) tile.appendChild(mk('span', 'ow-ok', '✓ 已過免年費門檻'));
        return { limit, feeWaived: !!feeWaived };
    })).then(rows => {
        if (token !== renderOwnedCardsOverview._token || rows.some(r => r === null)) return;
        const filled = rows.filter(r => r.limit !== null);
        const total = filled.reduce((s, r) => s + r.limit, 0);
        if (filled.length === 0) {
            limitStat.dd.textContent = '未填寫';
            limitStat.dd.classList.add('ow-faint');
        } else {
            limitStat.dd.textContent = `NT$${total.toLocaleString('en-US')}`;
            limitStat.small.textContent = filled.length === count ? '全部已填' : `${count - filled.length} 張未填額度`;
        }
        const met = rows.filter(r => r.feeWaived).length;
        feeStat.dd.textContent = `${met}／${count} 張`;
        feeStat.small.textContent = met === count ? '全部已達成' : '已達成';
    });
}

// 單卡面板（2026-11-22，站長推翻「這頁唯讀」）：點卡片 → 同一個視窗換成該卡的個人設定，可以直接改。
// 編輯介面＝詳情頁那唯一一份 #card-personal-section，搬進 #owned-panel-settings（cdMountPersonalSection），
// 由 renderCardPersonalSettings(card, { context: 'owned' }) 填值、接自動儲存——沒有第二套畫面或存檔邏輯。
// 🔒 鐵則 1：這裡不呼叫 saveCardLevel()；級別只在用戶親自改下拉時由那支共用函數存。
// 離開面板（‹ 所有卡片、關閉、開詳情頁、重開 modal）一律走 ownedPanelExit：先送出還沒存的筆記、
// 把設定區搬回詳情頁、回到卡片格。手機返回鍵不處理（站長 2026-11-22：這次不做）
let _owPanelCardId = null;
let _owGridScroll = 0;

async function openOwnedCardPanel(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    const panel = document.getElementById('owned-card-panel');
    const host = document.getElementById('owned-panel-settings');
    if (!card || !panel || !host) return;
    const modal = document.getElementById('my-owned-cards-modal');
    const scroller = modal.querySelector('.modal-content');
    if (_owPanelCardId === null && scroller) _owGridScroll = scroller.scrollTop;
    _owPanelCardId = cardId;

    // 卡面＋卡名（textContent；缺圖顯示卡名，同卡片格）
    const pic = document.getElementById('owned-panel-pic');
    pic.textContent = '';
    const img = document.createElement('img');
    img.className = 'ow-img';
    img.alt = '';
    img.src = `assets/images/cards/${card.id}.png`;
    const frame = document.createElement('div');
    frame.className = 'ow-frame';
    img.addEventListener('load', () => { if (img.naturalHeight > img.naturalWidth) frame.classList.add('ow-portrait'); });
    img.addEventListener('error', () => { img.remove(); frame.classList.add('ow-noimg'); frame.textContent = card.name; });
    frame.appendChild(img);
    pic.appendChild(frame);
    document.getElementById('owned-panel-name').textContent = card.name;

    document.getElementById('owned-cards-overview').hidden = true;
    document.getElementById('owned-modal-title').hidden = true;
    document.getElementById('manage-owned-cards-btn').hidden = true;
    document.getElementById('owned-panel-back').hidden = false;
    panel.hidden = false;

    cdMountPersonalSection(host);
    if (scroller) scroller.scrollTop = 0;
    await renderCardPersonalSettings(card, { context: 'owned' });
}

// 離開單卡面板、回到卡片格。沒開著就什麼都不做（showCardDetail 每次開都會叫它）。
// opts.render=false：呼叫端自己會重畫卡片格
function ownedPanelExit(opts = {}) {
    if (_owPanelCardId === null) return false;
    _owPanelCardId = null;
    if (typeof cdFlushNotes === 'function') cdFlushNotes();
    currentNotesCardId = null;
    cdMountPersonalSection(null);
    const panel = document.getElementById('owned-card-panel');
    if (panel) panel.hidden = true;
    document.getElementById('owned-cards-overview').hidden = false;
    document.getElementById('owned-modal-title').hidden = false;
    document.getElementById('manage-owned-cards-btn').hidden = false;
    document.getElementById('owned-panel-back').hidden = true;
    if (opts.render !== false) {
        renderOwnedCardsOverview();   // 剛改的級別／額度／日期要馬上看得到
        const scroller = document.querySelector('#my-owned-cards-modal .modal-content');
        if (scroller) scroller.scrollTop = _owGridScroll;
    }
    return true;
}

// Open the "管理我的信用卡" modal (stacked on top of the overview).
function openManageOwnedCardsModal() {
    _renderCardSelectionModal({
        selectionId: 'owned-cards-selection',
        tagFilterChipsId: 'owned-tag-filter-chips',
        searchInputId: 'search-owned-cards-input',
        onlySelectedBtnId: 'owned-only-selected',
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
}

// Update the "套用我的信用卡" button state.
// Disabled only when no owned cards set (works for guests via localStorage too).
function updateApplyOwnedButtonState() {
    const btn = document.getElementById('apply-owned-cards-btn');
    if (!btn) return;
    // 停用的樣子由 CSS 的 .sel-chip:disabled 負責
    btn.disabled = myOwnedCards.size === 0;
    btn.title = btn.disabled ? '先去頭像下拉選單設定「我的信用卡」' : '一鍵套用「我的信用卡」';
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
        ownedPanelExit({ render: false });   // 面板開著就先把設定區搬回詳情頁、送出還沒存的筆記
        overviewModal.style.display = 'none';
        enableBodyScroll();
    };

    closeOverviewBtn.addEventListener('click', closeOverview);

    // 單卡面板：「‹ 所有卡片」回卡片格；「查看回饋詳情 ›」開詳情頁（showCardDetail 會先讓面板回到卡片格）
    document.getElementById('owned-panel-back').addEventListener('click', () => ownedPanelExit());
    document.getElementById('owned-panel-detail').addEventListener('click', () => {
        if (_owPanelCardId) showCardDetail(_owPanelCardId);
    });

    // 用戶從總覽進詳情頁改了額度／級別／免年費再關掉 → 下面這層要跟著更新。
    // 詳情頁有好幾個關閉入口，直接看它由開變關的那一刻最不會漏。
    const detailModal = document.getElementById('card-detail-modal');
    if (detailModal && typeof MutationObserver === 'function') {
        let detailWasOpen = false;
        new MutationObserver(() => {
            const isOpen = detailModal.style.display !== 'none' && detailModal.style.display !== '';
            if (detailWasOpen && !isOpen && overviewModal.style.display === 'flex') renderOwnedCardsOverview();
            detailWasOpen = isOpen;
        }).observe(detailModal, { attributes: true, attributeFilter: ['style'] });
    }
    overviewModal.addEventListener('click', (e) => { if (e.target === overviewModal) closeOverview(); });
    manageBtn.addEventListener('click', openManageOwnedCardsModal);

    // --- Manage modal (layer 2, stacked on top of overview) ---
    const closeManageBtn = document.getElementById('close-manage-owned-modal');
    const saveBtn = document.getElementById('save-owned-cards-btn');

    // Closes the manage modal only — overview underneath stays open.
    const closeManage = () => {
        manageModal.style.display = 'none';
        enableBodyScroll();
    };

    // × 就是取消：不存直接關（2026-11-26 拿掉底部儲存列的「取消」）
    closeManageBtn.addEventListener('click', closeManage);
    manageModal.addEventListener('click', (e) => { if (e.target === manageModal) closeManage(); });

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
    // 這個視窗沒有「全選」（2026-11-26：沒有人持有全部的卡），改成工具列的「已選 N」只看勾起來的卡
}

// ===== 卡片標籤總表（顯示順序＋CSS class，唯一正本）=====
// 陣列順序＝卡片選擇 modal 標籤篩選列的排列順序；cls 是 styles.css 裡 `.card-tag.tag-xxx` 的 class 名。
// 新增一個標籤要做三件事：
//   1. 在下面這張表加一項 { name: 標籤名, cls: 'tag-xxx' }（位置就是它在篩選列的排序位置）
//   2. 在 styles.css 補上對應的 `.tag-xxx` 樣式（否則會沒有顏色）
//   3. 確認 Google Sheets 的 Cards 工作表 tags 欄用的是同一個標籤名（字串要完全一致）
// 不在表裡的標籤：卡片上的標籤用預設樣式 `tag-default`，且不會出現在篩選列。
const CARD_TAG_DEFS = [
    { name: '旅遊', cls: 'tag-travel' },
    { name: '開車族', cls: 'tag-driving' },
    { name: '餐飲', cls: 'tag-restaurant' },
    { name: '交通', cls: 'tag-transport' },
    { name: '網購', cls: 'tag-online' },
    { name: '百貨公司', cls: 'tag-department' },
    { name: '外送', cls: 'tag-delivery' },
    { name: '娛樂', cls: 'tag-entertainment' },
    { name: '行動支付', cls: 'tag-payment' },
    { name: 'AI工具', cls: 'tag-ai' },
    { name: '便利商店', cls: 'tag-convenience' },
    { name: '串流平台', cls: 'tag-streaming' },
    { name: '超市', cls: 'tag-supermarket' },
    { name: '藥妝', cls: 'tag-pharmacy' },
    { name: '時尚品牌', cls: 'tag-fashion' },
    { name: '直銷品牌', cls: 'tag-direct-sales' },
    { name: '生活百貨', cls: 'tag-lifestyle' },
    { name: '運動', cls: 'tag-sports' },
    { name: '寵物', cls: 'tag-pet' },
    { name: '親子', cls: 'tag-family' },
    { name: '應用程式商店', cls: 'tag-appstore' },
    { name: '飲食品牌', cls: 'tag-food-brand' },
    { name: '美妝美髮保養品牌', cls: 'tag-beauty-brand' },
    { name: '保費', cls: 'tag-insurance' }
];
const CARD_TAG_CLASS_MAP = new Map(CARD_TAG_DEFS.map(def => [def.name, def.cls]));

// Helper function to convert tag name to CSS class
function getTagClass(tagName) {
    return CARD_TAG_CLASS_MAP.get(tagName) || 'tag-default';
}

// Helper function to render card tags
function renderCardTags(tags) {
    if (!tags || tags.length === 0) return '';

    const tagsHtml = tags.map(tag =>
        `<span class="card-tag ${getTagClass(tag)}">${escapeHtml(tag)}</span>`
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

// 「銀行官方登錄連結」（2026-09-08 新增）：有些活動要先到銀行的網頁登錄才算數，
// 登錄頁網址存在該組的 registerLink（Cards Data 的 registerLink_N 欄）。
// 刻意只把「銀行官方登錄連結」幾個字掛成超連結、不把網址攤在畫面上——那些網址又長又醜，
// 而且同一組的 conditions 早就在講「需登錄」了，這裡只是給一個可以直接點過去的去處。
// 字尾的方框箭頭 icon 是站內「這會開新分頁」的既有慣例（其他站內連結用純文字 ↗）。
//
// ⚠️ 鐵則 3：href 一律過 sanitizeUrl()（只放行 http/https），不合法就整行不渲染。
// ⚠️ App 專屬 scheme（cathaybk://、linepay:// 之類）會被 sanitizeUrl 擋掉，這是刻意的：
//    那種連結在沒裝 App 的手機上是一個看不懂的錯誤畫面，而且各家 App 的 scheme 沒有
//    公開保證、改版就失效。只能在 App 內操作的活動（「打開 App → 我的優惠 → 登錄」）
//    請把步驟寫成文字放進該組的 conditions，不要塞進這一欄。
//    （sanitizeUrl 刻意在 href 那一行**再叫一次**、不用上面存好的變數：security-scan 的
//    SEC6a 規則是逐行掃「範本字串裡的動態 href 插值」，同一行看不到 sanitizeUrl 就報錯，
//    保證要在掃得到的位置才算數——多一次字串比對，換一條機械擋得住的規則）
function renderRegisterLinkLine(url) {
    if (!sanitizeUrl(url)) return '';
    return `<div class="cashback-condition cashback-register-link">` +
        `<a href="${escapeHtml(sanitizeUrl(url))}" target="_blank" rel="noopener noreferrer">銀行官方登錄連結` +
        `<svg class="external-link-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">` +
        `<path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5"/>` +
        `<path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0z"/>` +
        `</svg></a></div>`;
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

// ==========================================
// 側選單「最近異動」（2026-09-08 新增）
// ==========================================
// 詳情頁的 #card-changelog-section 是「這張卡有什麼變動」；這裡是全站視角的
// 「最近哪幾張卡變動過」——把每張卡的 card.changelog 攤平、跨卡依日期由新到舊
// 取前 SIDEBAR_CHANGELOG_MAX 筆，點一列就開那張卡的詳情頁並捲到近期異動區。
//
// ⚠️ 排序完全靠 entry.date（ISO 字串，可直接字典序比大小），**不需要**站長手動排序：
//    「變動紀錄」工作表新增一列、重新匯出，它自己就會浮到最上面。
// ⚠️ 同一天的多筆維持卡片在 cardsData.cards 裡的順序（Array.prototype.sort 是穩定
//    排序，ES2019 起規格保證）——匯出的 changelog 只有 date，沒有「同日誰先發布」
//    的資訊（readChangelog 的 _seq 在匯出時就被丟掉了），站長 2026-09-08 定案
//    不為此改匯出程式。要精確到同日先後，得讓 cards-export.gs 把列序一起帶出來。
// ⚠️ 每張卡只取「最新 1 筆」（站長 2026-09-08 定案）：同一張卡連續佔掉兩三列時，
//    點哪一列都是進同一張卡的詳情頁，等於用掉名額卻沒多給一個去處；一卡一列才能讓
//    這 5 列涵蓋到 5 張不同的卡。該卡其餘異動在詳情頁的「近期異動」區看得到。
// ⚠️ 跨卡同一件事也只留一列（2026-10-30）：同日期＋同摘要視為同一則異動，見下方 seenChange。
// ⚠️ 鐵則 4：空陣列不是 falsy，`!card.changelog` 擋不掉 `[]`，長度也要判。
// ⚠️ 鐵則 3：cardName／summary 都是站長在 Sheets 自由輸入的文字，這裡刻意不走
//    innerHTML，用 createElement + textContent（與 renderCardDetailChangelog 同理由）。
const SIDEBAR_CHANGELOG_MAX = 5;

function renderSidebarChangelog() {
    const section = document.getElementById('sidebar-changelog');
    const list = document.getElementById('sidebar-changelog-list');
    if (!section || !list) return;

    list.textContent = '';

    const entries = [];
    const cards = (cardsData && cardsData.cards) || [];
    cards.forEach(card => {
        if (!card || !card.changelog || card.changelog.length === 0) return;
        // 每卡只取一筆：card.changelog 匯出時已是由新到舊（readChangelog 排好的），
        // 所以「第一筆有效的」就是這張卡最新的異動。缺日期或摘要的跳過往下找，
        // 不要因為第一筆是壞資料就整張卡消失。
        const latest = card.changelog.find(e =>
            e && String(e.date || '').trim() && String(e.summary || '').trim());
        if (!latest) return;
        entries.push({
            cardId: card.id,
            cardName: card.name || card.id,
            date: String(latest.date).trim(),
            summary: String(latest.summary).trim()
        });
    });

    // ISO 日期字串可直接比大小；回 0 的同日組維持原順序（穩定排序）
    entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    // 同一天、同一句摘要的多張卡只留第一張（2026-10-30 站長要求）：聯邦 5 張卡同天
    // 「一般消費排除項目新增 TikTok (抖音) 平台交易」會把 5 個名額全佔掉，內容卻是同一件事。
    // 留下的是 cardsData.cards 順序最前面那張（上面排序是穩定的）；其他卡的這筆在各自詳情頁看得到
    const seenChange = new Set();
    const shown = entries.filter(e => {
        const key = e.date + '\u0000' + e.summary;
        if (seenChange.has(key)) return false;
        seenChange.add(key);
        return true;
    });

    shown.slice(0, SIDEBAR_CHANGELOG_MAX).forEach(e => {
        const li = document.createElement('li');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sidebar-changelog-item';
        btn.dataset.cardId = e.cardId;
        // 摘要在畫面上最多兩行截斷，title 讓桌機 hover 看得到日期與全文
        btn.title = `${formatChangelogDate(e.date)}　${e.summary}`;

        // 最左側卡片圖（2026-09-28）：缺圖就整個 img 拿掉，版面退回純文字（ui-display.md 第 2 節）
        const img = document.createElement('img');
        img.className = 'sidebar-changelog-img';
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = `assets/images/cards/${e.cardId}.png`;
        img.addEventListener('error', () => img.remove());

        const textEl = document.createElement('span');
        textEl.className = 'sidebar-changelog-text';

        const nameEl = document.createElement('span');
        nameEl.className = 'sidebar-changelog-card';
        nameEl.textContent = e.cardName;

        const summaryEl = document.createElement('span');
        summaryEl.className = 'sidebar-changelog-summary';
        summaryEl.textContent = e.summary;

        textEl.appendChild(nameEl);
        textEl.appendChild(summaryEl);
        btn.appendChild(img);
        btn.appendChild(textEl);
        btn.addEventListener('click', () => openCardDetailAtChangelog(e.cardId));

        li.appendChild(btn);
        list.appendChild(li);
    });

    section.style.display = list.children.length ? 'block' : 'none';
}

// 開卡片詳情頁，落在「回饋」頁籤並展開「近期異動」清單。
// ⚠️ 切頁籤與捲動一律走 cardDetailGoToSection()（js/results-display.js）：它會找出包含該區塊的頁籤、
//    扣掉 sticky 頁首與頁籤列的高度——不要自己寫 scrollIntoView，日後頁首改高度時兩邊會各走各的。
// ⚠️ showCardDetail() 是 async，要 await 它把內容畫完、modal 顯示出來（rAF 再等一幀）才量得到位置。
async function openCardDetailAtChangelog(cardId) {
    if (typeof window.closeSidebarDrawer === 'function') window.closeSidebarDrawer();
    await showCardDetail(cardId);
    requestAnimationFrame(() => {
        if (typeof cardDetailGoToSection === 'function') cardDetailGoToSection('card-changelog-section');
    });
}
