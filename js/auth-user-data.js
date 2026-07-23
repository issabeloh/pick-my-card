/* ============================================================
 * Pick My Card — js/auth-user-data.js（載入順序 7/12）
 * 改這檔前必讀 docs/project/storage-and-security.md（登出清理鐵則 9）。
 * 區塊目錄（Grep 關鍵字）：
 *  - 認證入口/訪客 UI           → "setupAuthentication" / "ensureGuestUIBound"
 *  - 頭像下拉                  → "setupAvatarDropdown"
 *  - 登出個資清理（鐵則 9）     → "clearPersonalLocalDataOnSignOut"
 *  - Firebase 認證訂閱          → "ensureAuthSubscribed" / "onAuthStateChanged"
 *  - 用戶資料載入              → "loadUserData"
 *  - 訪客資料吸收              → "absorbGuestPersonalData"
 *  - 比較卡/持有卡載存          → "loadCardsInComparison" / "loadMyOwnedCards"
 *  - 管理比較卡 modal           → "setupManageCardsModal"
 * ============================================================ */
function setupAuthentication() {
    let firebaseReadyHandled = false;

    const onFirebaseReady = () => {
        if (firebaseReadyHandled) return;
        firebaseReadyHandled = true;
        auth = window.firebaseAuth;
        db = window.db;
        initializeAuthListeners();
    };

    // Wait for Firebase to load
    const checkFirebaseReady = () => {
        if (firebaseReadyHandled) return; // already handled via fallback+late-arrival path
        if (typeof window.firebaseAuth !== 'undefined' && typeof window.db !== 'undefined') {
            onFirebaseReady();
        } else {
            setTimeout(checkFirebaseReady, 100);
        }
    };
    checkFirebaseReady();

    // Fallback: Firebase 逾時未就緒 → 先以訪客模式初始化 UI，避免整站卡死。
    // 輪詢（checkFirebaseReady 的 setTimeout 鏈）仍在跑，Firebase 之後到位時
    // onFirebaseReady 會補做 auth 訂閱與登入態更新。
    setTimeout(() => {
        if (firebaseReadyHandled) return;
        console.error('⏱️ Firebase 載入逾時（' + FIREBASE_FALLBACK_MS + 'ms），以訪客模式初始化 UI，持續等待 SDK...');
        ensureGuestUIBound();
        // hero 已移除（2026-07-20）：逾時 fallback 必須自己顯示工具區，否則
        // onAuthStateChanged 永遠不觸發時，頁面會停在 boot loader 清掉後的空白。
        appStarted = true;
        if (_authUIRefs) {
            _authUIRefs.setGuestAvatarState();
            _authUIRefs.showToolSections();
        }
        setGuestDropdownVisibility();
    }, FIREBASE_FALLBACK_MS);
}

// Setup avatar dropdown menu (toggle, close on outside click, menu actions)
// Show/hide guest-only dropdown items depending on whether the app has started.
// Called on init and whenever appStarted flips to true.
function setGuestDropdownVisibility() {
    if (currentUser) return; // logged-in users always see full menu
    const ids = ['avatar-manage-cards', 'avatar-manage-payments', 'avatar-my-mappings', 'avatar-feedback'];
    const divider = document.querySelector('.avatar-dropdown-divider');
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = appStarted ? '' : 'none';
    });
    if (divider) divider.style.display = appStarted ? '' : 'none';
}

function setupAvatarDropdown() {
    const avatarBtn = document.getElementById('avatar-btn');
    const avatarDropdown = document.getElementById('avatar-dropdown');
    if (!avatarBtn || !avatarDropdown) return;

    const closeDropdown = () => avatarDropdown.classList.remove('open');

    avatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        avatarDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!avatarDropdown.contains(e.target) && !avatarBtn.contains(e.target)) closeDropdown();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
    });

    // Menu item actions — map element IDs to handler functions
    const menuActions = {
        'avatar-manage-cards': () => openMyOwnedCardsModal(),
        'avatar-manage-payments': () => openMyPaymentsModal(),
        'avatar-my-mappings': () => openMyMappingsModal(),
        'avatar-feedback': () => {
            const modal = document.getElementById('feedback-modal');
            if (modal) { modal.style.display = 'flex'; disableBodyScroll(); }
        },
        'avatar-sign-out': async () => {
            if (currentUser) {
                // 先清本機個人資料再登出：順序固定，避免與 onAuthStateChanged
                // 的訪客資料重載互相競速。Firestore 是雲端事實來源，本機鏡像
                // 清掉後下次登入會自動重建。
                clearPersonalLocalDataOnSignOut(currentUser.uid);
                try { await window.signOut(auth); }
                catch (error) { console.error('Sign out failed:', error); }
            } else {
                openAuthModal('login');
            }
        }
    };

    for (const [id, action] of Object.entries(menuActions)) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                closeDropdown();
                action();
            });
        }
    }
}

// 登出時清理本機的個人資料：所有帶 uid 的鏡像 + 未帶 uid 區分的個人 key，
// 防止共用電腦上洩漏給下一位使用者。
// ⚠️ 只能在「用戶親自按登出」時呼叫 —— 不能放進 onAuthStateChanged 的登出分支，
// 那個分支在純訪客每次開頁時也會觸發，會誤刪訪客自己的資料。
function clearPersonalLocalDataOnSignOut(uid) {
    let allKeys = [];
    try {
        for (let i = 0; i < localStorage.length; i++) allKeys.push(localStorage.key(i));
    } catch (e) { return; }

    const uidExact = uid ? [
        `cardsInComparison_${uid}`, `selectedCards_${uid}`, `myOwnedCards_${uid}`,
        `selectedPayments_${uid}`, `spendingMappings_${uid}`
    ] : [];
    const uidPrefixes = uid ? [
        `feeWaiver_${uid}_`, `billingDates_${uid}_`, `notes_${uid}_`, `cardLevel_${uid}_`,
        `creditLimit_${uid}_`
    ] : [];
    // 非 uid 區分的個人 key（訪客資料多半已在登入時被 absorbGuestPersonalData 消化，
    // 這裡清掉的是殘留值）
    const guestExact = [
        'spendingMappings', 'cubeIssuer', 'userQuickSearchPrefs',
        'cardsInComparison_guest', 'myOwnedCards_guest', 'selectedPayments_guest'
    ];
    const guestPrefixes = ['cardLevel-', 'feeWaiver_local_', 'billingDates_local_', 'creditLimit_local_'];
    // 訪客筆記 key 是 notes_<cardId>，用已知卡片 ID 跟 notes_<uid>_<cardId> 區分
    const knownCardIds = new Set(((cardsData && cardsData.cards) || []).map(c => c.id));

    for (const key of allKeys) {
        const isPersonal =
            uidExact.includes(key) ||
            uidPrefixes.some(p => key.startsWith(p)) ||
            guestExact.includes(key) ||
            guestPrefixes.some(p => key.startsWith(p)) ||
            (key.startsWith('notes_') && knownCardIds.has(key.slice('notes_'.length)));
        if (isPersonal) {
            try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
        }
    }
    console.log('🧹 已清理本機個人資料（登出）');
}

// UI 綁定與 auth 訂閱拆開兩個 guard：Firebase 逾時 fallback 時只需要 ensureGuestUIBound()
// 就能讓網站可互動；Firebase 之後就緒時只補跑 ensureAuthSubscribed()，不重新綁定任何
// 事件監聽器（重複綁定會讓按鈕點擊、document click 等監聽器疊加觸發）。
let _guestUIBound = false;
let _authStateSubscribed = false;
// ensureGuestUIBound() 內定義的 closures，ensureAuthSubscribed() 的 onAuthStateChanged
// callback 需要用到同一份（避免兩份 showToolSections/setGuestAvatarState 各自為政）。
let _authUIRefs = null;

// 綁定「訪客也能用」的 UI：avatar 狀態、工具區顯示/隱藏、各種 modal、「開始使用」按鈕。
// 刻意不依賴 auth/db 是否就緒——Firebase 逾時時這是唯一會跑到的初始化路徑。
function ensureGuestUIBound() {
    if (_guestUIBound) return;
    _guestUIBound = true;

    // Firebase 逾時 fallback 時，這裡是唯一會清除 boot loader 的地方
    // （原本綁在 onAuthStateChanged 裡，Firebase 若永遠載不到就永遠不會清）。
    // 見 index.html #pmc-boot-loader / html.pmc-returning-user 的說明。
    document.documentElement.classList.remove('pmc-returning-user');

    const signInBtn = document.getElementById('sign-in-btn');
    const userPhoto = document.getElementById('user-photo');
    const userName = document.getElementById('user-name');
    const avatarBtn = document.getElementById('avatar-btn');
    const guestAvatarIcon = document.getElementById('guest-avatar-icon');
    const signOutLabel = document.getElementById('sign-out-label');

    // Sign in button (now hidden, kept for fallback)
    if (signInBtn) signInBtn.addEventListener('click', () => openAuthModal('login'));

    function setGuestAvatarState() {
        if (avatarBtn) avatarBtn.classList.add('guest-mode');
        if (guestAvatarIcon) guestAvatarIcon.style.display = '';
        if (userPhoto) { userPhoto.src = ''; userPhoto.style.display = 'none'; }
        if (userName) userName.textContent = '';
        if (signOutLabel) signOutLabel.textContent = '註冊／登入';
        const signOutItem = document.getElementById('avatar-sign-out');
        if (signOutItem) {
            signOutItem.classList.remove('avatar-dropdown-logout');
            signOutItem.classList.add('avatar-dropdown-signin');
        }
        setGuestDropdownVisibility();
    }

    function setLoggedInAvatarState(user) {
        if (avatarBtn) avatarBtn.classList.remove('guest-mode');
        if (guestAvatarIcon) guestAvatarIcon.style.display = 'none';
        if (user.photoURL) {
            userPhoto.src = user.photoURL;
            userPhoto.style.display = 'block';
        } else {
            userPhoto.style.display = 'none';
        }
        if (userName) userName.textContent = user.displayName || user.email;
        if (signOutLabel) signOutLabel.textContent = '登出';
        const signOutItem = document.getElementById('avatar-sign-out');
        if (signOutItem) {
            signOutItem.classList.add('avatar-dropdown-logout');
            signOutItem.classList.remove('avatar-dropdown-signin');
        }
        // Always show all menu items for logged-in users
        const ids = ['avatar-manage-cards', 'avatar-manage-payments', 'avatar-my-mappings', 'avatar-feedback'];
        const divider = document.querySelector('.avatar-dropdown-divider');
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
        if (divider) divider.style.display = '';
    }

    // Initialize as guest state on page load
    setGuestAvatarState();

    // Setup avatar dropdown menu
    setupAvatarDropdown();
    
    // Cache shared DOM references for show/hide
    const toolElements = {
        inputSection: document.querySelector('.input-section'),
        supportedCards: document.querySelector('.supported-cards'),
        sidebar: document.getElementById('sidebar'),
        appLayout: document.querySelector('.app-layout'),
        sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
        announcementBar: document.getElementById('announcement-bar'),
        resultsSection: document.querySelector('.results-section'),
        couponResultsSection: document.querySelector('.coupon-results-section'),
        spotlightSection: document.getElementById('spotlight-section'),
        financeWarningRow: document.getElementById('finance-warning-row'),
    };

    function showToolSections() {
        const t = toolElements;
        if (t.inputSection) t.inputSection.style.display = 'block';
        if (t.supportedCards) t.supportedCards.style.display = 'block';
        renderSpotlights();
        if (t.financeWarningRow) t.financeWarningRow.style.display = 'block';
        if (t.sidebar) t.sidebar.style.display = '';
        if (t.appLayout) t.appLayout.classList.remove('no-sidebar');
        if (t.sidebarToggleBtn) t.sidebarToggleBtn.style.display = '';
        if (t.announcementBar && announcements && announcements.length > 0) {
            t.announcementBar.style.display = 'block';
        }
    }

    function hideToolSections() {
        const t = toolElements;
        if (t.inputSection) t.inputSection.style.display = 'none';
        if (t.supportedCards) t.supportedCards.style.display = 'none';

        // Mobile: keep sidebar as drawer; Desktop: hide from grid
        if (t.sidebar) {
            t.sidebar.style.display = window.innerWidth <= 768 ? '' : 'none';
        }
        if (t.appLayout) t.appLayout.classList.add('no-sidebar');
        if (t.sidebarToggleBtn) t.sidebarToggleBtn.style.display = '';
        if (t.announcementBar) t.announcementBar.style.display = 'none';
        if (t.resultsSection) t.resultsSection.style.display = 'none';
        if (t.couponResultsSection) t.couponResultsSection.style.display = 'none';
        if (t.spotlightSection) t.spotlightSection.style.display = 'none';
        if (t.financeWarningRow) t.financeWarningRow.style.display = 'none';
        stopSpotlightAutoRotate();
        // 結果收起 → 收起「精選活動」快速跳轉浮標
        if (typeof updateScrollToSpotlightBtn === 'function') updateScrollToSpotlightBtn();
    }

    // 分享給 ensureAuthSubscribed() 的 onAuthStateChanged callback用，避免兩份
    // showToolSections/setGuestAvatarState/setLoggedInAvatarState 各自為政。
    _authUIRefs = { setGuestAvatarState, setLoggedInAvatarState, showToolSections, hideToolSections };

    // Setup manage cards modal
    setupManageCardsModal();

    // Setup my-owned-cards modal
    setupMyOwnedCardsModal();

    // Setup new cardholder promos toggle (search results section)
    setupCardholderPromoToggle();

    // Setup sidebar drawer for mobile
    setupSidebarDrawer();
}

// 訂閱 Firebase auth 狀態變化。只在 auth 真的就緒時呼叫；用 _authStateSubscribed
// guard 避免 Firebase 逾時 fallback 之後晚到時重複訂閱（onAuthStateChanged 訂閱兩次
// 會讓登入/登出流程跑兩遍，造成 loadUserData 等重複呼叫）。
function ensureAuthSubscribed() {
    if (_authStateSubscribed) return;
    if (!auth) {
        console.error('❌ ensureAuthSubscribed() 在 auth 就緒前被呼叫，略過訂閱');
        return;
    }
    if (!_authUIRefs) {
        console.error('❌ ensureAuthSubscribed() 在 ensureGuestUIBound() 之前被呼叫，略過訂閱');
        return;
    }
    _authStateSubscribed = true;

    const { setGuestAvatarState, setLoggedInAvatarState, showToolSections } = _authUIRefs;

    // Listen for authentication state changes
    window.onAuthStateChanged(auth, async (user) => {
        // Card levels are user-scoped; drop cached values when the user changes.
        clearCardLevelCache();

        // Update the pre-paint auth hint so the next visit skips the boot loader delay
        // (or correctly shows it if the user signed out / token expired).
        try {
            if (user) {
                localStorage.setItem('pmc_known_logged_in', '1');
            } else {
                localStorage.removeItem('pmc_known_logged_in');
            }
        } catch (e) { /* localStorage disabled — silently ignore */ }
        document.documentElement.classList.remove('pmc-returning-user');

        if (user) {
            // User is signed in
            console.log('User signed in:', user);
            currentUser = user;
            setLoggedInAvatarState(user);

            appStarted = true;
            showToolSections();

            // Show manage cards button
            document.getElementById('manage-cards-btn').style.display = 'block';

            // Show my mappings button
            const myMappingsBtn = document.getElementById('my-mappings-btn');
            if (myMappingsBtn) {
                myMappingsBtn.style.display = 'flex';
            }

            // ✨ Load ALL user data in ONE Firestore call (optimized!)
            const userData = await loadUserData();

            // Load birthday month and pre-compute flag (O(1) for all subsequent searches)
            userBirthdayMonth = (userData && userData.birthdayMonth != null) ? userData.birthdayMonth : null;
            isBirthdayMonth = userBirthdayMonth !== null && userBirthdayMonth === (new Date().getMonth() + 1);

            // Load children eligibility flag (defaults to true if not set)
            isChildrenEligible = (userData && userData.isChildrenEligible != null) ? userData.isChildrenEligible : true;

            // Load CUBE card issuer (defaults to Visa, fall back to localStorage if Firestore not set)
            if (userData && userData.cubeIssuer) {
                cubeIssuer = userData.cubeIssuer;
                try { localStorage.setItem('cubeIssuer', cubeIssuer); } catch (e) {}
            }

            // Load user's selected cards and payments using unified data.
            // 訪客資料的處理原則（2026-07 統一）：雲端有值 → 雲端為準；
            // 雲端沒值 → 靜默帶入訪客值並上傳；訪客 key 兩種情況都會被消化移除。
            await loadCardsInComparison(userData);
            await loadMyOwnedCards(userData);
            await loadUserPayments(userData);
            await absorbGuestPersonalData(userData);
            await loadSpendingMappings();

            // Load user's quick search options (new prefs format with auto-migration)
            await initializeQuickSearchOptions(userData);
            renderQuickSearchButtons();

            // Update chips display
            populateCardChips();
            populatePaymentChips();

        } else {
            // User is signed out — guest mode
            console.log('User signed out');
            currentUser = null;
            appStarted = false;
            cardsInComparison.clear();
            myOwnedCards.clear();
            // Load guest data from localStorage
            await loadCardsInComparison();
            await loadMyOwnedCards();
            userSelectedPayments.clear();
            await loadUserPayments();  // loads guest payments from localStorage
            await loadSpendingMappings();
            userBirthdayMonth = null;
            isBirthdayMonth = false;
            isChildrenEligible = true;
            cubeIssuer = (typeof localStorage !== 'undefined' && localStorage.getItem('cubeIssuer')) || 'Visa';
            setGuestAvatarState();

            // Load guest quick search prefs from localStorage (or defaults)
            await initializeQuickSearchOptions();
            renderQuickSearchButtons();

            // hero（product-intro）已從 DOM 移除（2026-07-20）：landing 接手行銷/上手敘事。
            // 首屏路由（index.html pre-paint）已把全新訪客導去 landing，因此能走到
            // 這裡的登出使用者都是「從 landing 來」或「用過工具的舊用戶」——直接進工具。
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();

            // Hide my mappings button
            const myMappingsBtn = document.getElementById('my-mappings-btn');
            if (myMappingsBtn) {
                myMappingsBtn.style.display = 'none';
            }

            // Show manage cards button even when not logged in (read-only mode)
            document.getElementById('manage-cards-btn').style.display = 'block';

            // Show all cards and payments when signed out
            populateCardChips();
            populatePaymentChips();
        }

        // 登入成功後預熱級別快取（見 warmCardLevelCache 定義處的說明），
        // fire-and-forget——不擋 onAuthStateChanged 流程。
        if (user) {
            warmCardLevelCache();
        }
    });
}

// Firebase 就緒後才呼叫：先確保訪客 UI 已綁定（fallback 逾時可能已經跑過，
// 這裡的 ensureGuestUIBound() 是 no-op），再訂閱 auth 狀態。
function initializeAuthListeners() {
    ensureGuestUIBound();
    ensureAuthSubscribed();
}

// ✨ Unified user data loader - loads ALL user data in ONE Firestore call
async function loadUserData() {
    if (!currentUser || !window.db || !window.doc || !window.getDoc) {
        return null;
    }

    try {
        const docRef = window.doc(window.db, 'users', currentUser.uid);
        const docSnap = await window.getDoc(docRef);

        if (docSnap.exists()) {
            const userData = docSnap.data();
            console.log('✅ Loaded all user data from Firestore in ONE call:', Object.keys(userData));
            return userData;
        }
    } catch (error) {
        console.error('❌ Error loading user data:', error);
    }

    return null;
}

// 登入時消化「訪客期間留下的其餘個人資料」：消費配卡表、卡片級別、筆記、
// 免年費、結帳日、CUBE 發卡組織。（信用卡/行動支付在各自的 load 函數內處理。）
// 原則：雲端有值 → 雲端為準；雲端沒值 → 靜默帶入訪客值並上傳（不彈窗）。
// 訪客 key 處理完即移除，避免留在共用電腦上被下一位使用者「繼承」——
// 這正是過去卡片級別跨用戶洩漏的根源。
// 高價值資料（級別、筆記）在上傳失敗時保留 key，下次登入重試。
async function absorbGuestPersonalData(userData) {
    if (!currentUser || !window.db || !window.doc) return;
    const canWrite = !!window.setDoc;
    const canRead = !!window.getDoc;

    // 先收集所有 key 再處理，避免邊迭代邊刪除
    let allKeys = [];
    try {
        for (let i = 0; i < localStorage.length; i++) allKeys.push(localStorage.key(i));
    } catch (e) { return; }

    const knownCardIds = new Set(((cardsData && cardsData.cards) || []).map(c => c.id));

    // 1. 消費配卡表（訪客 key: spendingMappings）
    if (allKeys.includes('spendingMappings')) {
        const guestMappings = readLocalJSONArray('spendingMappings');
        localStorage.removeItem('spendingMappings');
        const cloudHasMappings = Array.isArray(userData?.spendingMappings) && userData.spendingMappings.length > 0;
        if (!cloudHasMappings && guestMappings.length > 0 && canWrite) {
            try {
                await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                    spendingMappings: guestMappings,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                console.log('🔀 雲端無配卡表，已帶入訪客的配卡表:', guestMappings.length, '筆');
            } catch (e) { console.error('帶入訪客配卡表失敗:', e); }
        }
    }

    // 2. 卡片級別（訪客 key: cardLevel-<cardId>；登入後鏡像是 cardLevel_<uid>_<cardId>）
    //    只有雲端「沒有」這張卡的級別時才帶入 —— 絕不覆蓋用戶已儲存的選擇。
    for (const key of allKeys.filter(k => k.startsWith('cardLevel-'))) {
        const cardId = key.slice('cardLevel-'.length);
        let guestLevel = null;
        try { guestLevel = localStorage.getItem(key); } catch (e) { continue; }
        if (!guestLevel || !knownCardIds.has(cardId)) {
            try { localStorage.removeItem(key); } catch (e) {}
            continue;
        }
        if (!canRead || !canWrite) continue;
        try {
            const snap = await window.getDoc(window.doc(window.db, 'cardSettings', `${currentUser.uid}_${cardId}`));
            if (!snap.exists()) {
                await saveCardLevel(cardId, guestLevel);
                console.log(`🔀 雲端無級別，帶入訪客選擇 ${cardId}: ${guestLevel}`);
            }
            localStorage.removeItem(key); // 成功處理（帶入或雲端已有）才移除
        } catch (e) {
            console.error('帶入訪客級別失敗（保留待下次重試）:', cardId, e);
        }
    }

    // 3. 筆記（訪客 key: notes_<cardId>；用 knownCardIds 區分 notes_<uid>_<cardId> 鏡像）
    for (const key of allKeys.filter(k => k.startsWith('notes_'))) {
        const cardId = key.slice('notes_'.length);
        if (!knownCardIds.has(cardId)) continue; // 不是訪客筆記 key
        let guestNotes = null;
        try { guestNotes = localStorage.getItem(key); } catch (e) { continue; }
        if (!guestNotes) {
            try { localStorage.removeItem(key); } catch (e) {}
            continue;
        }
        if (!canRead || !canWrite) continue;
        try {
            const ref = window.doc(window.db, 'userNotes', `${currentUser.uid}_${cardId}`);
            const snap = await window.getDoc(ref);
            if (!snap.exists() || !snap.data().notes) {
                await window.setDoc(ref, { notes: guestNotes, updatedAt: new Date(), cardId: cardId });
                console.log(`🔀 雲端無筆記，帶入訪客筆記 ${cardId}`);
            }
            localStorage.removeItem(key);
        } catch (e) {
            console.error('帶入訪客筆記失敗（保留待下次重試）:', cardId, e);
        }
    }

    // 4. 免年費（訪客 key: feeWaiver_local_<cardId>；雲端是 users 文件的 feeWaiverStatus map）
    const cloudFeeWaiver = (userData && userData.feeWaiverStatus) || {};
    const feeWaiverUpdates = {};
    for (const key of allKeys.filter(k => k.startsWith('feeWaiver_local_'))) {
        const cardId = key.slice('feeWaiver_local_'.length);
        let val = null;
        try { val = localStorage.getItem(key); localStorage.removeItem(key); } catch (e) { continue; }
        if (knownCardIds.has(cardId) && val === 'true' && !(cardId in cloudFeeWaiver)) {
            feeWaiverUpdates[cardId] = true;
        }
    }
    if (Object.keys(feeWaiverUpdates).length > 0 && canWrite) {
        try {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                feeWaiverStatus: { ...cloudFeeWaiver, ...feeWaiverUpdates },
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('🔀 帶入訪客的免年費設定:', Object.keys(feeWaiverUpdates));
        } catch (e) { console.error('帶入訪客免年費失敗:', e); }
    }

    // 5. 結帳日期（訪客 key: billingDates_local_<cardId>；雲端是 users 文件的 billingDates map）
    const cloudBillingDates = (userData && userData.billingDates) || {};
    const billingUpdates = {};
    for (const key of allKeys.filter(k => k.startsWith('billingDates_local_'))) {
        const cardId = key.slice('billingDates_local_'.length);
        const dates = readLocalJSON(key, null);
        try { localStorage.removeItem(key); } catch (e) {}
        if (knownCardIds.has(cardId) && dates && typeof dates === 'object' && !(cardId in cloudBillingDates)) {
            billingUpdates[cardId] = {
                billingDate: typeof dates.billingDate === 'string' ? dates.billingDate : '',
                statementDate: typeof dates.statementDate === 'string' ? dates.statementDate : ''
            };
        }
    }
    if (Object.keys(billingUpdates).length > 0 && canWrite) {
        try {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                billingDates: { ...cloudBillingDates, ...billingUpdates },
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('🔀 帶入訪客的結帳日期設定:', Object.keys(billingUpdates));
        } catch (e) { console.error('帶入訪客結帳日期失敗:', e); }
    }

    // 6. CUBE 發卡組織：雲端沒有且訪客改過（非預設 Visa）→ 帶入
    if (!(userData && userData.cubeIssuer)) {
        let localIssuer = null;
        try { localIssuer = localStorage.getItem('cubeIssuer'); } catch (e) {}
        if (localIssuer && localIssuer !== 'Visa') {
            await saveCubeIssuer(localIssuer);
            console.log('🔀 雲端無 CUBE 發卡組織設定，帶入訪客選擇:', localIssuer);
        }
    }
}

// Load user's cards-in-comparison from Firestore (with localStorage fallback)
// Reads new field `cardsInComparison` first; falls back to legacy `selectedCards` for migration.
// Guests load from localStorage `cardsInComparison_guest`; default is all cards.
// Accepts optional userData parameter to avoid redundant Firestore calls.
async function loadCardsInComparison(userData = null) {
    if (!currentUser) {
        // Guest: load from localStorage; default to all cards if nothing saved
        const saved = readLocalJSON('cardsInComparison_guest', null);
        if (Array.isArray(saved)) {
            cardsInComparison = new Set(filterKnownCardIds(saved));
            console.log('📦 Loaded cards-in-comparison from guest localStorage:', Array.from(cardsInComparison));
        } else {
            cardsInComparison = new Set(cardsData.cards.map(card => card.id));
            console.log('🆕 Guest with no saved comparison, defaulting to all cards');
        }
        return;
    }

    const newKey = `cardsInComparison_${currentUser.uid}`;
    const legacyKey = `selectedCards_${currentUser.uid}`;

    try {
        // Use provided userData if available (from unified load)
        let cloudCards = null;
        if (userData) {
            cloudCards = userData.cardsInComparison || userData.selectedCards || null;
        } else if (window.db && window.doc && window.getDoc) {
            // Fallback: Try to load from Firestore if userData not provided
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                cloudCards = data.cardsInComparison || data.selectedCards || null;
            }
        }

        if (Array.isArray(cloudCards)) {
            // 雲端有設定 → 雲端為準；移除訪客殘留 key，避免留給下一位使用者
            cardsInComparison = new Set(filterKnownCardIds(cloudCards));
            console.log('✅ Loaded cards-in-comparison from cloud:', Array.from(cardsInComparison));
            localStorage.setItem(newKey, JSON.stringify(cloudCards));
            localStorage.removeItem('cardsInComparison_guest');
            return;
        }

        // 雲端沒有設定：若訪客期間有儲存過選擇 → 靜默帶入並上傳（不彈窗）
        const guestCards = readLocalJSON('cardsInComparison_guest', null);
        if (guestCards !== null) localStorage.removeItem('cardsInComparison_guest');
        if (Array.isArray(guestCards) && guestCards.length > 0) {
            cardsInComparison = new Set(filterKnownCardIds(guestCards));
            console.log('🔀 雲端無設定，帶入訪客的加入比較卡片:', Array.from(cardsInComparison));
            await saveCardsInComparison();
            return;
        }

        // Fallback to localStorage (try new key first, then legacy)
        const savedCards = readLocalJSON(newKey, null) || readLocalJSON(legacyKey, null);

        if (Array.isArray(savedCards)) {
            cardsInComparison = new Set(filterKnownCardIds(savedCards));
            console.log('📦 Loaded cards-in-comparison from localStorage (fallback):', Array.from(cardsInComparison));
        } else {
            // First time user - select all cards by default
            console.log('🆕 First time user, selecting all cards');
            cardsInComparison = new Set(cardsData.cards.map(card => card.id));
            saveCardsInComparison();
        }
    } catch (error) {
        console.error('❌ Error loading cards-in-comparison:', error);
        // Default to all cards if error
        cardsInComparison = new Set(cardsData.cards.map(card => card.id));
    }
}

// Load my-owned-cards from Firestore (logged in) or localStorage (guest).
// Default for everyone is empty Set.
async function loadMyOwnedCards(userData = null) {
    if (!currentUser) {
        // Guest: load from localStorage
        const saved = readLocalJSON('myOwnedCards_guest', null);
        myOwnedCards = Array.isArray(saved) ? new Set(filterKnownCardIds(saved)) : new Set();
        console.log('📦 Loaded myOwnedCards (guest):', Array.from(myOwnedCards));
        return;
    }

    const userKey = `myOwnedCards_${currentUser.uid}`;
    try {
        let cloudOwned = null;
        if (userData && Array.isArray(userData.myOwnedCards)) {
            cloudOwned = userData.myOwnedCards;
        } else if (!userData && window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists() && Array.isArray(docSnap.data().myOwnedCards)) {
                cloudOwned = docSnap.data().myOwnedCards;
            }
        }

        if (cloudOwned !== null) {
            // 雲端有設定 → 雲端為準；移除訪客殘留 key
            myOwnedCards = new Set(filterKnownCardIds(cloudOwned));
            console.log('✅ Loaded myOwnedCards from cloud:', Array.from(myOwnedCards));
            localStorage.setItem(userKey, JSON.stringify(cloudOwned));
            localStorage.removeItem('myOwnedCards_guest');
            return;
        }

        // 雲端沒有設定：若訪客期間有儲存過 → 靜默帶入並上傳（不彈窗）
        const guestCards = readLocalJSON('myOwnedCards_guest', null);
        if (guestCards !== null) localStorage.removeItem('myOwnedCards_guest');
        if (Array.isArray(guestCards) && guestCards.length > 0) {
            myOwnedCards = new Set(filterKnownCardIds(guestCards));
            console.log('🔀 雲端無設定，帶入訪客的我的信用卡:', Array.from(myOwnedCards));
            await saveMyOwnedCards();
            return;
        }

        myOwnedCards = new Set();
        localStorage.setItem(userKey, JSON.stringify([]));
    } catch (error) {
        console.error('❌ Error loading myOwnedCards:', error);
        // Fallback to user-specific localStorage
        const saved = readLocalJSON(userKey, null);
        myOwnedCards = Array.isArray(saved) ? new Set(filterKnownCardIds(saved)) : new Set();
    }
}

// Save my-owned-cards to localStorage (always) and Firestore (if logged in).
async function saveMyOwnedCards() {
    const cardsArray = Array.from(myOwnedCards);

    if (!currentUser) {
        try {
            localStorage.setItem('myOwnedCards_guest', JSON.stringify(cardsArray));
            console.log('✅ Saved myOwnedCards to guest localStorage:', cardsArray);
        } catch (e) {
            console.error('Error saving guest myOwnedCards:', e);
        }
        return;
    }

    try {
        const userKey = `myOwnedCards_${currentUser.uid}`;
        localStorage.setItem(userKey, JSON.stringify(cardsArray));

        if (window.db && window.doc && window.setDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            await window.setDoc(docRef, {
                myOwnedCards: cardsArray,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('☁️ Synced myOwnedCards to Firestore:', cardsArray);
        }
    } catch (error) {
        console.error('Error saving myOwnedCards:', error);
    }
}

// Save cards-in-comparison to localStorage (always) and Firestore (if logged in)
async function saveCardsInComparison() {
    const cardsArray = Array.from(cardsInComparison);

    if (!currentUser) {
        try {
            localStorage.setItem('cardsInComparison_guest', JSON.stringify(cardsArray));
            console.log('✅ Saved cards-in-comparison to guest localStorage:', cardsArray);
        } catch (e) {
            console.error('Error saving guest cards-in-comparison:', e);
        }
        return;
    }

    try {
        // Save to localStorage as backup
        const storageKey = `cardsInComparison_${currentUser.uid}`;
        localStorage.setItem(storageKey, JSON.stringify(cardsArray));
        console.log('✅ Saved cards-in-comparison to localStorage:', cardsArray);

        // Save to Firestore for cross-device sync
        if (window.db && window.doc && window.setDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            await window.setDoc(docRef, {
                cardsInComparison: cardsArray,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log('☁️ Synced cards-in-comparison to Firestore:', cardsArray);
        }
    } catch (error) {
        console.error('Error saving cards-in-comparison:', error);
        // Don't throw error - at least localStorage is saved
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
        openManageCardsModal();
    });
    
    // Close modal function
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    // Save cards (shared handler for both footer and quick-save buttons)
    const doSaveCards = async () => {
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
        cardsInComparison = newSelection;
        await saveCardsInComparison();

        // Update UI immediately
        populateCardChips();

        // Close modal
        closeModal();
    };
    saveBtn.addEventListener('click', doSaveCards);
    const quickSaveBtn = document.getElementById('save-cards-btn-quick');
    if (quickSaveBtn) quickSaveBtn.addEventListener('click', doSaveCards);
    
    // Toggle all cards button
    const toggleAllBtn = document.getElementById('toggle-all-cards');
    toggleAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('#cards-selection input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);

        if (allChecked) {
            // Uncheck all
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
                checkbox.parentElement.classList.remove('selected');
            });
            toggleAllBtn.textContent = '全選';
        } else {
            // Check all
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
                checkbox.parentElement.classList.add('selected');
            });
            toggleAllBtn.textContent = '全不選';
        }
    });

    // "套用我的信用卡" toggle: add all myOwnedCards to current selection,
    // or remove them if all are already selected. Does not affect other cards.
    const applyOwnedBtn = document.getElementById('apply-owned-cards-btn');
    if (applyOwnedBtn) {
        applyOwnedBtn.addEventListener('click', () => {
            if (myOwnedCards.size === 0) return;
            const checkboxes = Array.from(document.querySelectorAll('#cards-selection input[type="checkbox"]'));
            const ownedCheckboxes = checkboxes.filter(cb => myOwnedCards.has(cb.value));
            const allOwnedChecked = ownedCheckboxes.length > 0 && ownedCheckboxes.every(cb => cb.checked);
            ownedCheckboxes.forEach(cb => {
                cb.checked = !allOwnedChecked;
                cb.parentElement.classList.toggle('selected', !allOwnedChecked);
            });
        });
    }
}

