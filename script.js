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

    // Setup "Start Using" button click event (Option 2: Toggle display)
    const startUsingBtn = document.getElementById('start-using-btn');
    if (startUsingBtn) {
        startUsingBtn.addEventListener('click', () => {
            // Hide product intro section
            const productIntroSection = document.getElementById('product-intro-section');
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }

            // Show tool sections
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();

            // Hide the button itself (for mobile)
            startUsingBtn.style.display = 'none';

            // Focus on merchant input
            setTimeout(() => {
                const merchantInput = document.getElementById('merchant-input');
                if (merchantInput) {
                    merchantInput.focus();
                }
            }, 100);
        });
    }

    // Setup header "Start Using" button (in auth section)
    const startUsingBtnHeader = document.getElementById('start-using-btn-header');
    if (startUsingBtnHeader) {
        startUsingBtnHeader.addEventListener('click', () => {
            // Hide product intro section
            const productIntroSection = document.getElementById('product-intro-section');
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }

            // Show tool sections
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();

            // Hide the button itself (for mobile)
            startUsingBtnHeader.style.display = 'none';

            // Focus on merchant input
            setTimeout(() => {
                const merchantInput = document.getElementById('merchant-input');
                if (merchantInput) {
                    merchantInput.focus();
                }
            }, 100);
        });
    }

    // Setup second "Start Using" button with same functionality
    const startUsingBtn2 = document.getElementById('start-using-btn-2');
    if (startUsingBtn2) {
        startUsingBtn2.addEventListener('click', () => {
            // Hide product intro section
            const productIntroSection = document.getElementById('product-intro-section');
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }

            // Show tool sections
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();

            // Hide the button itself (for mobile)
            startUsingBtn2.style.display = 'none';

            // Focus on merchant input
            setTimeout(() => {
                const merchantInput = document.getElementById('merchant-input');
                if (merchantInput) {
                    merchantInput.focus();
                }
            }, 100);
        });
    }
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

        const productIntroSection = document.getElementById('product-intro-section');

        // Update the pre-paint auth hint so the next visit skips the hero flash
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

            // Hide "Start Using" button when logged in
            const startUsingBtnHeader = document.getElementById('start-using-btn-header');
            if (startUsingBtnHeader) {
                startUsingBtnHeader.style.display = 'none';
            }

            // Hide product introduction section and show tool sections when logged in
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }
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

            // Show "Start Using" button when logged out
            const startUsingBtnHeader = document.getElementById('start-using-btn-header');
            if (startUsingBtnHeader) {
                startUsingBtnHeader.style.display = 'inline-block';
            }

            // Load guest quick search prefs from localStorage (or defaults)
            await initializeQuickSearchOptions();
            renderQuickSearchButtons();

            // hero（product-intro）不再顯示：landing 已接手行銷/上手敘事。
            // 首屏路由（index.html pre-paint）已把全新訪客導去 landing，因此能走到
            // 這裡的登出使用者都是「從 landing 來」或「用過工具的舊用戶」——兩者都
            // 直接進工具、不看 hero，避免與 landing 重複敘事、也讓舊用戶開頁即用。
            // （hero 區塊正式從 DOM 移除是獨立的 follow-up；這裡只是不顯示它）
            if (productIntroSection) {
                productIntroSection.style.display = 'none';
            }
            appStarted = true;
            setGuestDropdownVisibility();
            showToolSections();
            if (startUsingBtnHeader) {
                startUsingBtnHeader.style.display = 'none';
            }

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

async function showCardDetail(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    if (!card) return;

    // 追蹤卡片詳情查看
    if (window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'view_card_detail', {
            card_id: cardId,
            card_name: card.name
        });
    }

    // 重置指定通路回饋的搜尋框
    const cashbackSearchInput = document.getElementById('cashback-search-input');
    if (cashbackSearchInput) cashbackSearchInput.value = '';
    const cashbackSearchEmpty = document.getElementById('cashback-search-empty');
    if (cashbackSearchEmpty) cashbackSearchEmpty.style.display = 'none';

    const modal = document.getElementById('card-detail-modal');

    // Update basic information
    document.getElementById('card-detail-title').textContent = card.name;

    // Header 申辦按鈕（桌機）＋ sticky 申辦列（手機）：兩者共用同一份 applyCta 資料。
    // 每次呼叫都要明確重設 hidden——上一張卡有 CTA、這張沒有時不能沿用舊狀態。
    const applyCta = cardsData && cardsData.cardApplyCtas && cardsData.cardApplyCtas[card.id];
    const applyLink = applyCta ? sanitizeUrl(applyCta.link) : '';
    const headerApplyBtn = document.getElementById('card-detail-apply-header-btn');
    const applyBar = document.getElementById('card-detail-apply-bar');
    const applyBarText = applyBar ? applyBar.querySelector('.card-detail-apply-bar-text') : null;
    const applyBarBtn = applyBar ? applyBar.querySelector('.card-detail-apply-bar-btn') : null;
    if (applyLink) {
        if (headerApplyBtn) {
            headerApplyBtn.hidden = false;
            headerApplyBtn.href = applyLink;
            headerApplyBtn.title = applyCta.text || '';
            headerApplyBtn.dataset.cardId = card.id;
            headerApplyBtn.dataset.cardName = card.name;
        }
        if (applyBar) {
            applyBar.hidden = false;
            if (applyBarText) {
                const text = applyCta.text || '';
                applyBarText.textContent = text;
                applyBarText.hidden = !text;
            }
            if (applyBarBtn) {
                applyBarBtn.href = applyLink;
                applyBarBtn.dataset.cardId = card.id;
                applyBarBtn.dataset.cardName = card.name;
            }
        }
    } else {
        if (headerApplyBtn) headerApplyBtn.hidden = true;
        if (applyBar) applyBar.hidden = true;
    }

    // Optional card image (assets/images/cards/<card.id>.png) — gracefully hides if missing
    const headerImg = document.getElementById('card-detail-image');
    if (headerImg) {
        headerImg.hidden = false;
        headerImg.onerror = () => { headerImg.hidden = true; };
        headerImg.src = `assets/images/cards/${card.id}.png`;
    }

    const fullNameLink = document.getElementById('card-full-name-link');
    fullNameLink.textContent = card.fullName || card.name;

    // Render tags after card full name
    const cardInfoSection = modal.querySelector('.card-info-section');
    const existingTags = cardInfoSection.querySelector('.card-tags-container');
    if (existingTags) {
        existingTags.remove();
    }

    if (card.tags && card.tags.length > 0) {
        const tagsHtml = renderCardTags(card.tags);
        const infoGrid = cardInfoSection.querySelector('.info-grid-2col');
        if (infoGrid) {
            infoGrid.insertAdjacentHTML('afterend', tagsHtml);
        }
    }

    // 直接顯示年費和免年費資訊
const annualFeeText = card.annualFee || '無資料';
const feeWaiverText = card.feeWaiver || '無資料';
const combinedFeeInfo = `${annualFeeText} ${feeWaiverText}`;

document.getElementById('card-annual-fee').textContent = combinedFeeInfo;
document.getElementById('card-fee-waiver').style.display = 'none';

    // Update cashback type and points expiry
    const cashbackTypeDiv = document.getElementById('card-cashback-type');
    const cashbackTypeExpirySection = document.getElementById('cashback-type-expiry-section');

    // 只在有資料時顯示此區塊
    if (card.basicCashbackType || card.pointsExpiry) {
        const parts = [];
        if (card.basicCashbackType) parts.push(card.basicCashbackType);
        if (card.pointsExpiry) parts.push(card.pointsExpiry);
        cashbackTypeDiv.textContent = parts.join(' | ');
        cashbackTypeExpirySection.style.display = 'flex';
    } else {
        cashbackTypeExpirySection.style.display = 'none';
    }

    // Update basic cashback
const basicCashbackDiv = document.getElementById('card-basic-cashback');
let basicContent = `<div class="cashback-detail-item">`;
basicContent += `<div class="cashback-rate">國內: <span class="cashback-rate-num">${card.basicCashback}%</span></div>`;
if (card.basicConditions) {
    basicContent += `<div class="cashback-condition">條件: ${card.basicConditions}</div>`;
}
basicContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
basicContent += `</div>`; // ← 這裡關閉第一個區塊

if (card.overseasCashback) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外: <span class="cashback-rate-num">${card.overseasCashback}%</span></div>`;
    basicContent += `<div class="cashback-condition">海外消費上限: 無上限</div>`;
    basicContent += `</div>`;
}

// Check for domesticBonusRate and overseasBonusRate in card level or levelSettings
let domesticBonusRate = card.domesticBonusRate;
let domesticBonusCap = card.domesticBonusCap;
let domesticConditions = card.domesticBonusConditions;
let overseasBonusRate = card.overseasBonusRate;
let overseasBonusCap = card.overseasBonusCap;
let overseasConditions = card.overseasBonusConditions;

// If card has levels, check levelSettings for bonus rates
if (card.hasLevels) {
    const levelNames = Object.keys(card.levelSettings);
    const defaultLevel = levelNames[0];
    const { data: levelData } = await resolveCardLevel(card, defaultLevel);

    if (levelData && levelData.domesticBonusRate !== undefined) {
        domesticBonusRate = levelData.domesticBonusRate;
        domesticBonusCap = levelData.domesticBonusCap;
        domesticConditions = levelData.domesticBonusConditions || card.domesticBonusConditions;
    }
    if (levelData && levelData.overseasBonusRate !== undefined) {
        overseasBonusRate = levelData.overseasBonusRate;
        overseasBonusCap = levelData.overseasBonusCap;
        overseasConditions = levelData.overseasBonusConditions || card.overseasBonusConditions;
    }
}

if (domesticBonusRate) {
    basicContent += `<div class="cashback-detail-item">`; // ← 新的區塊
    basicContent += `<div class="cashback-rate">國內加碼: <span class="cashback-rate-num">+${domesticBonusRate}%</span></div>`;
    if (domesticConditions) {
        basicContent += `<div class="cashback-condition">條件: ${domesticConditions}</div>`;
    }
    if (domesticBonusCap) {
        basicContent += `<div class="cashback-condition">消費上限: NT$${domesticBonusCap.toLocaleString()}</div>`;
    }
    basicContent += `</div>`; // ← 關閉國內加碼區塊
}

if (overseasBonusRate) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外加碼: <span class="cashback-rate-num">+${overseasBonusRate}%</span></div>`;
    if (overseasConditions) {
        basicContent += `<div class="cashback-condition">條件: ${overseasConditions}</div>`;
    }
    if (overseasBonusCap) {
        basicContent += `<div class="cashback-condition">消費上限: NT$${overseasBonusCap.toLocaleString()}</div>`;
    }
    basicContent += `</div>`;
}

basicCashbackDiv.innerHTML = basicContent;
    
    // Handle level selection for all cards with levels
    const cubeLevelSection = document.getElementById('cube-level-section');

    if (card.hasLevels) {
        const levelNames = Object.keys(card.levelSettings);
        const defaultLevel = levelNames[0];

        // Generate level selector HTML with note (通用支援)
        const { level: savedLevel, data: savedLevelData } = await resolveCardLevel(card, defaultLevel);

        const levelNoteText = savedLevelData['level-note'] || '';
        const noteFs = card.id === 'cathay-cube' ? '9.5px' : '11px';
        const noteMt = card.id === 'cathay-cube' ? '6px' : '8px';
        const levelNote = levelNoteText
            ? `<div id="level-note" style="font-size: ${noteFs}; color: #9ca3af; margin-top: ${noteMt}; word-wrap: break-word; white-space: normal; line-height: 1.5;">${levelNoteText}</div>`
            : `<div id="level-note" style="font-size: ${noteFs}; color: #9ca3af; margin-top: ${noteMt}; word-wrap: break-word; white-space: normal; line-height: 1.5;"></div>`;

        // Generate level rates info
        let levelRatesInfo = '';
        if (levelNames.length > 1 && card.id === 'cathay-cube') {
            // CUBE 卡用較小字體，配合統一設定區塊
            levelRatesInfo = '<div style="margin-left: 16px; flex-shrink: 0; padding: 5px 9px; border-left: 2px solid #e5e7eb; min-width: 0;">';
            levelRatesInfo += '<div style="font-size: 10.3px; color: #6b7280; font-weight: 600; margin-bottom: 3px;">各級別回饋率：</div>';
            levelNames.forEach(level => {
                const data = card.levelSettings[level];
                const displayRate = data.specialRate || data.rate || 0;
                levelRatesInfo += `<div style="font-size: 9.5px; color: #6b7280; line-height: 1.4; word-wrap: break-word;">• ${level}: ${displayRate}%</div>`;
            });
            levelRatesInfo += `<div style="font-size: 9px; color: #9ca3af; margin-top: 4px; font-style: italic; line-height: 1.3;">由分級決定回饋率的方案包含：玩數位、樂饗購、趣旅行</div>`;
            levelRatesInfo += '</div>';
        } else if (levelNames.length > 1) {
            levelRatesInfo = '<div style="margin-left: 24px; flex-shrink: 0; padding: 8px 12px; border-left: 3px solid #e5e7eb; background-color: #f9fafb; min-width: 0;">';
            levelRatesInfo += '<div style="font-size: 12px; color: #6b7280; font-weight: 600; margin-bottom: 4px;">各級別回饋率：</div>';

            if (card.id === 'dbs-eco') {
                // Simplified format for mobile compatibility
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}%</div>`;
                });
            } else if (card.id === 'sinopac-dawho') {
                // 永豐大戶卡自訂格式
                levelRatesInfo += `
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• 大戶Plus等級:</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">國內外加碼 4% (上限 NT$10,000 / NT$25,000 )</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">悠遊卡自動加值 5% (上限 NT$10,000)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-top: 4px;">• 大戶等級:</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">國內外加碼 2.5% (上限 NT$3,333 / NT$16,000)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">悠遊卡自動加值 3% (上限 NT$3,333)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-top: 4px;">• 大大等級: 只享有一般回饋</div>
                `;
            } else if (card.id === 'sinopac-coin') {
                // 永豐幣倍卡自訂格式
                levelRatesInfo += `
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">精選通路加碼 4%</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• Level 1：上限 NT$7,500</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• Level 2：上限 NT$20,000</div>
                `;
            } else {
                // Default formatting for other cards (like Uni card)
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}% (上限 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'})</div>`;
                });
            }
            levelRatesInfo += '</div>';
        }

        let levelSelectorHTML;

        if (card.id === 'cathay-cube') {
            // CUBE card: all three settings rows in one unified card
            const monthOptions = !currentUser ? '' :
                '<option value="">-- 未設定 --</option>' +
                Array.from({length: 12}, (_, i) => {
                    const m = i + 1;
                    return `<option value="${m}" ${userBirthdayMonth === m ? 'selected' : ''}>${m}月</option>`;
                }).join('');

            const birthdayRow = currentUser ? `
                <div>
                    <label style="font-weight: 600; flex-shrink: 0; font-size: 14px; color: #374151; margin-bottom: 4px;">我的生日月份：</label>
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                        <select id="birthday-month-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                            ${monthOptions}
                        </select>
                    </div>
                    <div style="font-size: 11px; color: #6b7280;">選取後，在您的生日月份會自動在比較結果納入「慶生月」方案的活動</div>
                </div>
            ` : `
                <div>
                    <span style="font-weight: 600; flex-shrink: 0; font-size: 14px; color: #374151;">我的生日月份：</span>
                    <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">輸入後將可以比較「慶生月」活動，請先登入才能設定生日月份</div>
                </div>
            `;

            levelSelectorHTML = `
                <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; padding: 12px 14px; margin-bottom: 16px;">
                    <div style="display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
                        <div style="flex-shrink: 0;">
                            <label style="font-weight: 600; margin-right: 6px; margin-bottom: 0; font-size: 14px; color: #374151;">選擇級別：</label>
                            <select id="card-level-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                                ${levelNames.map(level =>
                                    `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                                ).join('')}
                            </select>
                        </div>
                        ${levelRatesInfo}
                    </div>
                    ${levelNote}
                    <div style="border-top: 1px solid #e5e7eb; margin-top: 10px; padding-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px;">
                        ${birthdayRow}
                        <div>
                            <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 0; cursor: pointer; user-select: none;">
                                <input type="checkbox" id="children-eligible-checkbox"
                                    ${isChildrenEligible ? 'checked' : ''}
                                    style="width: 14px; height: 14px; cursor: pointer; accent-color: #3b82f6;">
                                <span style="font-weight: 600; font-size: 14px; color: #374151;">我符合「童樂匯」權益</span>
                            </label>
                            <div style="margin-top: 4px; padding-left: 20px; font-size: 11px; color: #9ca3af;">
                                勾選後才會在比較結果納入「童樂匯」方案的活動
                            </div>
                        </div>
                        <div>
                            <label for="cube-issuer-select" style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 14px; color: #374151;">發卡組織：</label>
                            <select id="cube-issuer-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                                ${['Visa', 'Mastercard', 'JCB'].map(issuer =>
                                    `<option value="${issuer}" ${issuer === cubeIssuer ? 'selected' : ''}>${issuer}</option>`
                                ).join('')}
                            </select>
                            <div style="margin-top: 4px; font-size: 11px; color: #9ca3af;">
                                選擇 JCB 才會在比較結果納入「JCB日本賞」方案的活動
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            levelSelectorHTML = `
                <div class="level-selector" style="margin-bottom: 16px;">
                    <div style="display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 8px;">
                        <div style="flex-shrink: 0;">
                            <label style="font-weight: 600; margin-right: 8px;">選擇級別：</label>
                            <select id="card-level-select" style="padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                                ${levelNames.map(level =>
                                    `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                                ).join('')}
                            </select>
                        </div>
                        ${levelRatesInfo}
                    </div>
                    ${levelNote}
                </div>
            `;
        }

        cubeLevelSection.innerHTML = levelSelectorHTML;
        cubeLevelSection.style.display = 'block';

        // Add change listener
        const levelSelect = document.getElementById('card-level-select');
        levelSelect.onchange = async function() {
            // Update level note (通用支援所有卡片)
            const levelNoteElement = document.getElementById('level-note');
            if (levelNoteElement) {
                const selectedLevelData = card.levelSettings[this.value];
                const noteText = selectedLevelData['level-note'] || '';
                levelNoteElement.textContent = noteText;
            }

            await saveCardLevel(card.id, this.value);
            // Refresh card detail display
            if (card.id === 'cathay-cube') {
                await updateCubeSpecialCashback(card);
            } else {
                // For other cards, just re-render the detail
                await showCardDetail(card.id);
            }
        };

        // 生日月份選擇器事件（CUBE卡，已登入）
        const birthdayMonthSelect = document.getElementById('birthday-month-select');
        if (birthdayMonthSelect) {
            birthdayMonthSelect.onchange = async function() {
                const val = this.value;
                await saveBirthdayMonth(val ? parseInt(val) : null);
            };
        }

        // 童樂匯勾選框事件（影響搜尋配對；不影響 modal 顯示，所以不需要重新渲染）
        const childrenCheckbox = document.getElementById('children-eligible-checkbox');
        if (childrenCheckbox) {
            childrenCheckbox.onchange = async function() {
                await saveChildrenEligible(this.checked);
            };
        }

        // 發卡組織選擇事件（影響搜尋配對；不影響 modal 顯示，所以不需要重新渲染）
        const cubeIssuerSelect = document.getElementById('cube-issuer-select');
        if (cubeIssuerSelect) {
            cubeIssuerSelect.onchange = async function() {
                await saveCubeIssuer(this.value);
            };
        }
    } else {
        cubeLevelSection.style.display = 'none';
    }
    
    // Update special cashback
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    let specialContent = '';

    if (card.hasLevels && card.id === 'cathay-cube') {
        specialContent = await generateCubeSpecialContent(card);
    } else if (card.hasLevels && card.specialItems && card.specialItems.length > 0) {
        // Handle generic level-based cards with specialItems (like Uni card and DBS Eco)
        const levelNames = Object.keys(card.levelSettings);
        const { data: levelData } = await resolveCardLevel(card, levelNames[0]);

        // First, display any cashbackRates if they exist (like DBS Eco's 10% cashback)
        // 2026-07-09 起逐筆顯示（不再按 rate+cap 合併），category 以 chip 顯示在回饋率旁
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            const rendered = await renderCashbackRatesIndividually(card, levelData, { idPrefix: 'lvA' });
            specialContent += rendered.html;

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups1 = rendered.upcoming;
            window._currentCard = card;
            window._currentLevelData1 = levelData;
        }

        // Then display the level-based cashback with specialItems
        specialContent += `<div class="cashback-detail-item">`;
        specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${levelData.rate}%</span> 回饋</div>`;
        if (levelData.cap) {
            specialContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(levelData.cap).toLocaleString()}</div>`;
        } else {
            specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
        }

        if (levelData.condition) {
            specialContent += renderConditionLine(levelData.condition);
        }

        // Show applicable merchants
        if (card.specialItems.length <= 30) {
            const merchantsList = card.specialItems.join('、');
            specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
        } else {
            const initialList = card.specialItems.slice(0, 30).join('、');
            const fullList = card.specialItems.join('、');
            const merchantsId = `uni-merchants-${card.id}`;
            const showAllId = `uni-show-all-${card.id}`;

            specialContent += `<div class="cashback-merchants">`;
            specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
            specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">... 顯示全部${card.specialItems.length}個</button>`;
            specialContent += `</div>`;
        }

        specialContent += `</div>`;
    } else if (card.hasLevels && (!card.specialItems || card.specialItems.length === 0)) {
        // Handle level-based cards without specialItems (or with empty specialItems array)
        const levelNames = Object.keys(card.levelSettings);
        const { level: savedLevel, data: levelData } = await resolveCardLevel(card, levelNames[0]);

        // Check if card also has cashbackRates (like DBS Eco card)
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            // 2026-07-09 起逐筆顯示（不再按 rate+cap 合併），category 以 chip 顯示在
            // 回饋率旁，回饋率為 getDisplayRate 加總值；cap 留空＝無上限（需要級別
            // cap 的槽明確填 {cap}；capFallbackToLevel 舊行為已於 2026-07-17 移除）
            const rendered = await renderCashbackRatesIndividually(card, levelData, { idPrefix: 'lvB' });
            specialContent += rendered.html;

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups2 = rendered.upcoming;
            window._currentCard = card;
            window._currentLevelData2 = levelData;

            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here
        } else {
            // Original logic for cards without cashbackRates
            specialContent += `<div class="cashback-detail-item">`;
            specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${levelData.rate}%</span> 回饋 (${savedLevel})</div>`;
            if (levelData.cap) {
                specialContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(levelData.cap).toLocaleString()}</div>`;
            } else {
                specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here

            specialContent += `</div>`;
        }
    } else if (card.cashbackRates && card.cashbackRates.length > 0) {
        // Separate active and upcoming rates for non-hasLevels cards
        const activeRates = [];
        const upcomingRates = [];

        for (const rate of card.cashbackRates) {
            if (rate.hideInDisplay) continue;

            const rateStatus = getRateStatus(rate.periodStart, rate.periodEnd);
            if (rateStatus === 'active' || rateStatus === 'always') {
                activeRates.push(rate);
            } else if (rateStatus === 'upcoming' && isUpcomingWithinDays(rate.periodStart, 30)) {
                upcomingRates.push(rate);
            }
        }

        // Sort active rates by DISPLAYED percentage descending (so a stacking
        // item like Apple Pay sorts by its summed 5%, not its raw designated 3%)
        const sortedRates = activeRates.sort((a, b) => {
            const aRate = getDisplayRate(card, a, parseCashbackRateSync(a.rate, null), null);
            const bRate = getDisplayRate(card, b, parseCashbackRateSync(b.rate, null), null);
            return bRate - aRate;
        });

        // Store upcoming rates for display in separate section
        if (upcomingRates.length > 0) {
            window._currentUpcomingGroups3 = await Promise.all(upcomingRates.map(async (rate) => {
                const parsedRate = await parseCashbackRate(rate.rate, card, null);
                const parsedCap = parseCashbackCap(rate.cap, card, null);
                return {
                    // stacking 模型顯示加總後的回饋率（與進行中活動一致）
                    parsedRate: getDisplayRate(card, rate, parsedRate, null),
                    parsedCap,
                    items: rate.items || [],
                    conditions: rate.conditions ? [{category: rate.category || '', conditions: rate.conditions}] : [],
                    period: rate.period,
                    periodStart: rate.periodStart,
                    periodEnd: rate.periodEnd,
                    status: 'upcoming',
                    category: rate.category
                };
            }));
            window._currentCard = card;
        }

        for (let index = 0; index < sortedRates.length; index++) {
            const rate = sortedRates[index];
            specialContent += `<div class="cashback-detail-item">`;

            // 解析 rate 值（支援 {specialRate} 和 {rate}，雖然 hasLevels=false 的卡片通常只有數字）
            const parsedRate = await parseCashbackRate(rate.rate, card, null);
            // For stacking models, show the summed rate (designated+basic+bonus),
            // same number the search-result card shows; otherwise show as-is.
            const displayRate = getDisplayRate(card, rate, parsedRate, null);

            // 解析 cap 值（支援 {cap}，hasLevels=false 的卡片通常只有數字）
            const parsedCap = parseCashbackCap(rate.cap, card, null);

            // Display rate with category in parentheses (with black color for consistency)
            const categoryStyle = rate.category ? getCategoryStyle(rate.category) : '';
            const categoryLabel = rate.category ? ` <span style="${categoryStyle}">${getCategoryDisplayName(rate.category)}</span>` : '';

            // Add ending soon badge if applicable
            let endingSoonBadge = '';
            if (rate.periodEnd && isEndingSoon(rate.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(rate.periodEnd);
                const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                endingSoonBadge = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            // stacking 模型加上「回饋組成」按鈕，解釋加總的來源
            const compBtn = rateCompositionButtonHtml(card, rate, parsedRate, parsedCap, null);
            specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${displayRate}%</span> 回饋${categoryLabel}${compBtn}${endingSoonBadge}</div>`;
            // 滿額門檻是重要條件：黑色、置於消費上限上方；maxSpend（未滿門檻）
            // 只影響匹配、不顯示標註（2026-07-17 用戶定案）
            if (rate.minSpend) {
                specialContent += `<div class="cashback-condition spend-threshold">單筆滿 NT$${Math.floor(rate.minSpend).toLocaleString()} 起</div>`;
            }

            if (parsedCap) {
                if (rate.capDescription && card.id === 'taishin-richart') {
                    specialContent += `<div class="cashback-condition">消費上限: ${rate.capDescription}</div>`;
                } else {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${parsedCap.toLocaleString()}</div>`;
                }
            } else {
                specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            if (rate.conditions) {
                specialContent += renderConditionLine(rate.conditions);
            }

            if (rate.period) {
                specialContent += `<div class="cashback-condition">活動期間: ${rate.period}</div>`;
            }
            
            if (rate.items && rate.items.length > 0) {
                const merchantsId = `merchants-${card.id}-${index}`;
                const showAllId = `show-all-${card.id}-${index}`;
                
                // Special handling for Yushan Uni card exclusions
                let processedItems = [...rate.items];
                if (card.id === 'yushan-unicard') {
                    processedItems = rate.items.map(item => {
                        if (item === '街口' || item === '全支付') {
                            return item + '(排除超商)';
                        }
                        return item;
                    });
                }
                
                if (rate.items.length <= 5) {
                    // 少於20個直接顯示全部
                    const merchantsList = processedItems.join('、');
                    specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    // 超過20個顯示可展開的列表
                    const initialList = processedItems.slice(0, 5).join('、');
                    const fullList = processedItems.join('、');
                    
                    specialContent += `<div class="cashback-merchants">`;
                    specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${rate.items.length}個</button>`;
                    specialContent += `</div>`;
                }
            }

            specialContent += `</div>`;
        }
    } else {
        specialContent = '<div class="cashback-detail-item">無指定通路回饋</div>';
    }
    
    specialCashbackDiv.innerHTML = specialContent;

    // Update upcoming cashback section
    const upcomingSection = document.getElementById('card-upcoming-section');
    const upcomingCashbackDiv = document.getElementById('card-upcoming-cashback');
    const upcomingGroups = window._currentUpcomingGroups1 || window._currentUpcomingGroups2 || window._currentUpcomingGroupsCube || window._currentUpcomingGroups3 || [];
    const upcomingCard = window._currentCard;
    const upcomingLevelData = window._currentLevelData1 || window._currentLevelData2;

    if (upcomingGroups.length > 0) {
        let upcomingContent = '';

        // upcomingGroups1/2 are [key, value] tuples from Map.entries();
        // upcomingGroups3/Cube are plain object arrays. Normalize both to [key, value].
        const groupsToDisplay = upcomingGroups.map((g, i) => Array.isArray(g) ? g : [i, g]);

        for (const [groupKey, group] of groupsToDisplay) {
            upcomingContent += `<div class="cashback-detail-item upcoming-activity">`;

            // 顯示回饋率和即將開始標籤（包含 category 如果有的話）
            const daysUntil = getDaysUntilStart(group.periodStart);
            const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
            const categoryStyle = group.category ? getCategoryStyle(group.category) : '';
            const categoryText = group.category ? ` <span style="${categoryStyle}">${getCategoryDisplayName(group.category)}</span>` : '';
            upcomingContent += `<div class="cashback-rate"><span class="cashback-rate-num">${group.parsedRate}%</span> 回饋${categoryText} <span class="upcoming-badge">即將開始 (${daysText})</span></div>`;

            if (group.parsedCap) {
                upcomingContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(group.parsedCap).toLocaleString()}</div>`;
            } else {
                upcomingContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            if (group.period) {
                upcomingContent += `<div class="cashback-condition">活動期間: ${group.period}</div>`;
            }

            // 顯示所有通路
            if (group.items.length > 0) {
                const uniqueItems = [...new Set(group.items)];
                const merchantsId = `upcoming-merchants-${upcomingCard.id}-group-${groupKey}`;
                const showAllId = `upcoming-show-all-${upcomingCard.id}-group-${groupKey}`;

                if (uniqueItems.length <= 5) {
                    const merchantsList = uniqueItems.join('、');
                    upcomingContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = uniqueItems.slice(0, 5).join('、');
                    const fullList = uniqueItems.join('、');

                    upcomingContent += `<div class="cashback-merchants">`;
                    upcomingContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    upcomingContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${uniqueItems.length}個</button>`;
                    upcomingContent += `</div>`;
                }
            }

            // 按 category 顯示各通路條件
            if (group.conditions.length > 0) {
                if (upcomingCard.id === 'yushan-unicard') {
                    const conditionsId = `upcoming-conditions-${upcomingCard.id}-group-${groupKey}`;
                    const showConditionsId = `upcoming-show-conditions-${upcomingCard.id}-group-${groupKey}`;

                    let conditionsContent = '';
                    for (const cond of group.conditions) {
                        conditionsContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${cond.conditions}</div>`;
                    }

                    upcomingContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                    upcomingContent += `<button class="show-more-btn" id="${showConditionsId}" onclick="toggleConditions('${conditionsId}', '${showConditionsId}')" style="padding: 4px 12px; font-size: 13px;">▼ 查看各通路詳細條件</button>`;
                    upcomingContent += `<div id="${conditionsId}" style="display: none; margin-top: 8px;">`;
                    upcomingContent += conditionsContent;
                    upcomingContent += `</div>`;
                    upcomingContent += `</div>`;
                } else {
                    upcomingContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                    upcomingContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 條件：</div>`;

                    for (const cond of group.conditions) {
                        upcomingContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${cond.conditions}</div>`;
                    }

                    upcomingContent += `</div>`;
                }
            }

            upcomingContent += `</div>`;
        }

        upcomingCashbackDiv.innerHTML = upcomingContent;
        upcomingSection.style.display = 'block';
    } else {
        upcomingSection.style.display = 'none';
    }

    // Clean up temporary variables
    delete window._currentUpcomingGroups1;
    delete window._currentUpcomingGroups2;
    delete window._currentUpcomingGroupsCube;
    delete window._currentUpcomingGroups3;
    delete window._currentCard;
    delete window._currentLevelData1;
    delete window._currentLevelData2;

    // Update coupon cashback
    const couponSection = document.getElementById('card-coupon-section');
    const couponCashbackDiv = document.getElementById('card-coupon-cashback');
    
    if (card.couponCashbacks && card.couponCashbacks.length > 0) {
        let couponContent = '';

        // 處理每個 coupon，計算實際回饋率
        let couponIndex = 0;
        for (const coupon of card.couponCashbacks) {
            const actualRate = await calculateCouponRate(coupon, card);
            const couponStatus = getRateStatus(coupon.periodStart, coupon.periodEnd);

            couponContent += `<div class="cashback-detail-item">`;

            // 顯示回饋率和標籤
            let badges = '';

            // 即將開始標籤
            if (couponStatus === 'upcoming' && coupon.periodStart) {
                const daysUntil = getDaysUntilStart(coupon.periodStart);
                const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
                badges += ` <span class="upcoming-badge">即將開始 (${daysText})</span>`;
            }

            // 即將結束標籤
            if ((couponStatus === 'active' || couponStatus === 'always') && coupon.periodEnd && isEndingSoon(coupon.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(coupon.periodEnd);
                const daysText = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : `${daysUntil}天後`;
                badges += ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            couponContent += `<div class="cashback-rate"><span class="cashback-rate-num">${actualRate}%</span> 回饋${badges}</div>`;

            // 消費上限（如果有）
            if (coupon.cap) {
                couponContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(coupon.cap).toLocaleString()}</div>`;
            } else {
                couponContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // 活動期間
            if (coupon.period) {
                couponContent += `<div class="cashback-condition">活動期間: ${coupon.period}</div>`;
            }

            // 適用通路（超過 5 個時收起顯示）
            if (coupon.merchant) {
                const merchantItems = coupon.merchant.split(',').map(m => m.trim()).filter(m => m);
                if (merchantItems.length <= 5) {
                    const merchantsList = merchantItems.join('、');
                    couponContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const merchantsId = `coupon-merchants-${card.id}-${couponIndex}`;
                    const showAllId = `coupon-show-all-${card.id}-${couponIndex}`;
                    const initialList = merchantItems.slice(0, 5).join('、');
                    const fullList = merchantItems.join('、');
                    couponContent += `<div class="cashback-merchants">`;
                    couponContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    couponContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${merchantItems.length}個</button>`;
                    couponContent += `</div>`;
                }
            }

            // 條件顯示（統一格式；內容過長時可收起）
            if (coupon.conditions) {
                couponContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                couponContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 條件：</div>`;
                couponContent += `<div class="cond-collapsible" style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;"><span class="cond-text">• ${coupon.conditions}</span><button type="button" class="cond-toggle" style="display:none;">...展開</button></div>`;
                couponContent += `</div>`;
            }

            couponContent += `</div>`;
            couponIndex++;
        }

        couponCashbackDiv.innerHTML = couponContent;
        couponSection.style.display = 'block';
    } else {
        couponSection.style.display = 'none';
    }

    // Display parking benefits
    const benefitsSection = document.getElementById('card-benefits-section');
    const benefitsContent = document.getElementById('card-benefits-content');

    if (cardsData.benefits && cardsData.benefits.length > 0) {
        // Find benefits for this card
        const cardBenefits = cardsData.benefits.filter(b => b.id === card.id && b.active);

        if (cardBenefits.length > 0) {
            let benefitsHtml = '';

            cardBenefits.forEach(benefit => {
                benefitsHtml += `<div class="cashback-detail-item">`;
                benefitsHtml += `<div class="cashback-rate" style="color: #2563eb; margin-bottom: 8px;">${benefit.benefit_desc}</div>`;

                if (benefit.merchants && benefit.merchants.length > 0) {
                    benefitsHtml += `<div class="cashback-condition parking-strong-line">地點: ${benefit.merchants.join('、')}</div>`;
                }

                if (benefit.conditions) {
                    benefitsHtml += `<div class="cashback-condition parking-strong-line">條件: ${benefit.conditions}</div>`;
                }

                if (benefit.benefit_period) {
                    benefitsHtml += `<div class="cashback-condition">期限: ${benefit.benefit_period}</div>`;
                }

                if (benefit.notes) {
                    benefitsHtml += `<div class="cashback-condition">備註: ${benefit.notes}</div>`;
                }

                benefitsHtml += `</div>`;
            });

            benefitsContent.innerHTML = benefitsHtml;
            benefitsSection.style.display = 'block';
        } else {
            benefitsSection.style.display = 'none';
        }
    } else {
        benefitsSection.style.display = 'none';
    }

    // Display new cardholder promos for this card (hidden if user owns the card)
    renderCardDetailPromos(card);

    // Load and setup user notes
    currentNotesCardId = card.id;
    const notesTextarea = document.getElementById('user-notes-input');
    const saveIndicator = document.getElementById('save-indicator');
    
    // 讀取當前筆記
    loadUserNotes(card.id).then(notes => {
        notesTextarea.value = notes;
    });
    
    // 設置輸入監聽
    notesTextarea.oninput = (e) => {
        const notes = e.target.value;
        
        // 自動本地備份
        autoBackupNotes(card.id, notes);
        
        // 更新按鈕狀態
        updateSaveButtonState(card.id, notes);
    };
    
    // 設置儲存按鈕監聽
    const saveBtn = document.getElementById('save-notes-btn');
    saveBtn.onclick = () => {
        const currentNotes = notesTextarea.value;
        saveUserNotes(card.id, currentNotes);
    };

    // 設置免年費狀態功能
    setupFeeWaiverStatus(card.id);

    // 設置我的額度輸入
    setupCreditLimit(card.id);

    // 設置結帳日期功能
    setupBillingDates(card.id);

    // Show modal
    // 級別切換等重繪路徑會在 modal 已開啟時重呼叫 showCardDetail()；
    // 已開啟就不再 disableBodyScroll()，否則鎖深度多加、closeModal 只解一次，頁面會鎖死
    const wasAlreadyOpen = modal.style.display === 'flex';
    modal.style.display = 'flex';
    if (!wasAlreadyOpen) disableBodyScroll();

    // 滾動到最上面（不記憶上一個 modal 的捲動位置）
    // .modal-content 才是真正的捲動容器（overflow-y: auto; max-height: 80vh）
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

    // Reveal 展開 toggles only on conditions that actually overflow — must run
    // now that the modal is displayed (measurements need layout).
    initConditionClamps(document.getElementById('card-special-cashback'));
    initConditionClamps(document.getElementById('card-coupon-cashback'));

    // Wire the sticky section nav after sections are rendered.
    setupCardDetailNav(modalContent);

    // Setup close events
    const closeBtn = document.getElementById('close-card-detail');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
        currentNotesCardId = null;
        // Embed 模式：兩條關閉路徑（關閉鈕／點遮罩）都會走到這裡，統一在這裡告知父頁
        // （promos.js）modal 已關閉，讓外層 overlay 跟著收起——iframe 常駐不銷毀，
        // 這裡只是隱藏 modal 內容，下次換卡不用重新載入。
        if (isEmbedMode) {
            try {
                parent.postMessage({ type: 'pmc-detail-closed' }, location.origin);
            } catch (e) {
                console.error('❌ pmc-detail-closed postMessage 失敗:', e);
            }
        }
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// Generate CUBE special content based on selected level
async function generateCubeSpecialContent(card) {
    // Get level from Firestore or default to first level
    const defaultLevel = Object.keys(card.levelSettings)[0];
    const { level: savedLevel, data: levelSettings } = await resolveCardLevel(card, defaultLevel);

    // 使用 specialRate（如果有）或 rate
    const specialRate = levelSettings.specialRate || levelSettings.rate;

    // Separate active and upcoming cashbackRates
    const upcomingRates = [];
    if (card.cashbackRates) {
        card.cashbackRates.forEach(rate => {
            const status = getRateStatus(rate.periodStart, rate.periodEnd);
            if (status === 'upcoming' && isUpcomingWithinDays(rate.periodStart, 30)) {
                upcomingRates.push(rate);
            }
        });
    }

    // Store upcoming rates for display in separate section
    if (upcomingRates.length > 0) {
        const upcomingGroups = upcomingRates.map(rate => {
            const parsedRate = rate.rate === '{specialRate}' ? specialRate : rate.rate;
            return {
                parsedRate,
                parsedCap: null,
                items: rate.items || [],
                conditions: rate.conditions && rate.category ? [{category: rate.category, conditions: rate.conditions}] : [],
                period: rate.period,
                periodStart: rate.periodStart,
                periodEnd: rate.periodEnd,
                status: 'upcoming',
                category: rate.category
            };
        });

        // Merge upcoming activities with same rate, category, and period (CUBE card only)
        const mergedGroups = new Map();
        upcomingGroups.forEach(group => {
            // Create merge key: rate + category + period
            const mergeKey = `${group.parsedRate}-${group.category || 'no-category'}-${group.period || 'no-period'}`;

            if (mergedGroups.has(mergeKey)) {
                // Merge with existing group
                const existing = mergedGroups.get(mergeKey);
                existing.items = [...existing.items, ...group.items];

                // Merge conditions - list all conditions as bullet points
                if (group.conditions.length > 0) {
                    existing.conditions = [...existing.conditions, ...group.conditions];
                }
            } else {
                // First time seeing this rate+category+period combination
                mergedGroups.set(mergeKey, {...group});
            }
        });

        window._currentUpcomingGroupsCube = Array.from(mergedGroups.values());
        window._currentCard = card;
    }

    let content = '';

    // Add CUBE-specific birthday note at the beginning
    let birthdayNoteText;
    let birthdayNoteColor;
    if (!currentUser) {
        birthdayNoteText = '※ 「慶生月」方案：請登入並設定生日月份，即可在生日當月自動納入比較';
        birthdayNoteColor = '#9ca3af';
    } else if (!userBirthdayMonth) {
        birthdayNoteText = '※ 「慶生月」方案：在上方設定生日月份後，將在您的生日月份自動納入比較';
        birthdayNoteColor = '#9ca3af';
    } else if (isBirthdayMonth) {
        birthdayNoteText = `🎂 本月是您的生日月份（${userBirthdayMonth}月），「慶生月」方案已自動納入比較！`;
        birthdayNoteColor = '#be185d';
    } else {
        birthdayNoteText = `※ 「慶生月」方案：已設定在您的生日月份（${userBirthdayMonth}月）自動納入比較`;
        birthdayNoteColor = '#9ca3af';
    }
    content += `
        <div class="cube-birthday-note" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px; margin-bottom: 16px;">
            <div style="color: ${birthdayNoteColor}; font-size: 11px; line-height: 1.5; font-style: italic;">
                ${birthdayNoteText}
            </div>
        </div>
    `;

    // 依照回饋率高低順序顯示，變動的玩數位樂饗購趣旅行放在最後

    // 1. 童樂匯 10% 回饋 (固定最高) - 只顯示進行中的
    const childrenRate10 = card.cashbackRates?.find(rate => {
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        return rate.rate === 10.0 && rate.category === '切換「童樂匯」方案' && (status === 'active' || status === 'always');
    });
    if (childrenRate10) {
        content += `<div class="cashback-detail-item">`;

        // Add ending soon badge if applicable
        let endingSoonBadge10 = '';
        if (childrenRate10.periodEnd && isEndingSoon(childrenRate10.periodEnd, 10)) {
            const daysUntil = getDaysUntilEnd(childrenRate10.periodEnd);
            const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
            endingSoonBadge10 = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }

        const categoryStyle10 = getCategoryStyle('童樂匯');
        content += `<div class="cashback-rate"><span class="cashback-rate-num">10%</span> 回饋 <span style="${categoryStyle10}">${getCategoryDisplayName('童樂匯')}</span>${endingSoonBadge10}</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;
        if (childrenRate10.conditions) {
            content += renderConditionLine(childrenRate10.conditions);
        }
        if (childrenRate10.period) {
            content += `<div class="cashback-condition">活動期間: ${childrenRate10.period}</div>`;
        }
        const items10 = childrenRate10.items;
        const merchantsList10 = items10.join('、');
        if (items10.length <= 5) {
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList10}</div>`;
        } else {
            const initialList10 = items10.slice(0, 5).join('、');
            const merchantsId10 = 'cube-children10-merchants';
            const showAllId10 = 'cube-children10-show-all';
            content += `<div class="cashback-merchants">`;
            content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId10}">${initialList10}</span>`;
            content += `<button class="show-more-btn" id="${showAllId10}" onclick="toggleMerchants('${merchantsId10}', '${showAllId10}', '${escapeForOnclick(initialList10)}', '${escapeForOnclick(merchantsList10)}')">... 顯示全部${items10.length}個</button>`;
            content += `</div>`;
        }
        content += `</div>`;
    }

    // 2. 童樂匯 5% 回饋 - 只顯示進行中的
    const childrenRate5 = card.cashbackRates?.find(rate => {
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        return rate.rate === 5.0 && rate.category === '切換「童樂匯」方案' && (status === 'active' || status === 'always');
    });
    if (childrenRate5) {
        content += `<div class="cashback-detail-item">`;

        // Add ending soon badge if applicable
        let endingSoonBadge5 = '';
        if (childrenRate5.periodEnd && isEndingSoon(childrenRate5.periodEnd, 10)) {
            const daysUntil = getDaysUntilEnd(childrenRate5.periodEnd);
            const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
            endingSoonBadge5 = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }

        const categoryStyle5 = getCategoryStyle('童樂匯');
        content += `<div class="cashback-rate"><span class="cashback-rate-num">5%</span> 回饋 <span style="${categoryStyle5}">${getCategoryDisplayName('童樂匯')}</span>${endingSoonBadge5}</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;
        if (childrenRate5.conditions) {
            content += renderConditionLine(childrenRate5.conditions);
        }
        if (childrenRate5.period) {
            content += `<div class="cashback-condition">活動期間: ${childrenRate5.period}</div>`;
        }
        const items5 = childrenRate5.items;
        const merchantsList5 = items5.join('、');
        if (items5.length <= 5) {
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList5}</div>`;
        } else {
            const initialList5 = items5.slice(0, 5).join('、');
            const merchantsId5 = 'cube-children5-merchants';
            const showAllId5 = 'cube-children5-show-all';
            content += `<div class="cashback-merchants">`;
            content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId5}">${initialList5}</span>`;
            content += `<button class="show-more-btn" id="${showAllId5}" onclick="toggleMerchants('${merchantsId5}', '${showAllId5}', '${escapeForOnclick(initialList5)}', '${escapeForOnclick(merchantsList5)}')">... 顯示全部${items5.length}個</button>`;
            content += `</div>`;
        }
        content += `</div>`;
    }

    // 3. Level變動的特殊通路 - 從 cashbackRates 中讀取並按類別分組顯示
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        const categories = ['玩數位', '樂饗購', '趣旅行'];
        const categoryRates = new Map();

        // 從 cashbackRates 中收集各類別的項目（只包含進行中的活動）
        card.cashbackRates.forEach(rate => {
            const status = getRateStatus(rate.periodStart, rate.periodEnd);
            const isActive = (status === 'active' || status === 'always');

            if (rate.category && categories.some(cat => rate.category.includes(cat)) && isActive) {
                // 找出是哪個類別
                const matchedCategory = categories.find(cat => rate.category.includes(cat));
                if (!categoryRates.has(matchedCategory)) {
                    categoryRates.set(matchedCategory, {
                        items: [],
                        rate: rate.rate,
                        cap: rate.cap,
                        period: rate.period
                    });
                }
                const categoryData = categoryRates.get(matchedCategory);
                if (rate.items) {
                    categoryData.items.push(...rate.items);
                }
            }
        });

        // 按類別順序顯示
        categories.forEach(category => {
            if (categoryRates.has(category)) {
                const categoryData = categoryRates.get(category);
                const items = [...new Set(categoryData.items)]; // 去重

                if (items.length > 0) {
                    content += `<div class="cashback-detail-item">`;
                    const categoryStyle = getCategoryStyle(category);

                    // 解析 rate（支援 {specialRate} placeholder）
                    let displayRate = categoryData.rate;
                    if (categoryData.rate === '{specialRate}') {
                        displayRate = specialRate;
                    } else if (typeof categoryData.rate === 'string' && categoryData.rate.startsWith('{')) {
                        // 其他 placeholder，從 levelSettings 解析
                        const fieldName = categoryData.rate.slice(1, -1);
                        displayRate = levelSettings[fieldName] || categoryData.rate;
                    }

                    content += `<div class="cashback-rate"><span class="cashback-rate-num">${displayRate}%</span> 回饋 <span style="${categoryStyle}">${getCategoryDisplayName(category)}</span></div>`;
                    content += `<div class="cashback-condition">消費上限: ${categoryData.cap ? `NT$${Math.floor(categoryData.cap).toLocaleString()}` : '無上限'}</div>`;

                    if (categoryData.period) {
                        content += `<div class="cashback-condition">活動期間: ${categoryData.period}</div>`;
                    }

                    const merchantsList = items.join('、');
                    if (items.length <= 5) {
                        content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = items.slice(0, 5).join('、');
                        const merchantsId = `cube-merchants-${category}-${savedLevel}`;
                        const showAllId = `cube-show-all-${category}-${savedLevel}`;

                        content += `<div class="cashback-merchants">`;
                        content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(merchantsList)}')">... 顯示全部${items.length}個</button>`;
                        content += `</div>`;
                    }
                    content += `</div>`;
                }
            }
        });
    }

    // 5. 其他 cashbackRates（如 LINE PAY 2%）- 放在最後，只顯示進行中的
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        const otherRates = card.cashbackRates
            .filter(rate => {
                const status = getRateStatus(rate.periodStart, rate.periodEnd);
                return !rate.hideInDisplay &&
                    rate.category !== '切換「童樂匯」方案' &&
                    (status === 'active' || status === 'always');  // 只顯示進行中的
            })
            .sort((a, b) => {
                // 先解析 rate 以支援 {specialRate} 和 {rate} 的排序
                // 註：這裡刻意不經 getDisplayRate 加總（不像 7906/7940 等呼叫點）——
                // 本區塊下面的顯示（mergedRate.parsedRate）本來就是顯示原始 rate、不含
                // stacking 加總，排序理應跟著同一個數字走，否則才會「排序與顯示不一致」。
                // CUBE 卡既有 rate+basic 資料（如「切換全支付方案」）依賴這個既有順序，
                // 跨槽引用 rate_N 目前也沒有卡片用在這個 CUBE 專屬路徑，此處不動。
                const aRate = parseCashbackRateSync(a.rate, levelSettings);
                const bRate = parseCashbackRateSync(b.rate, levelSettings);
                return bRate - aRate;
            });

        // Merge active rates with same parsedRate, category, and period (CUBE card only)
        const mergedActiveRates = new Map();
        for (const rate of otherRates) {
            const parsedRate = await parseCashbackRate(rate.rate, card, levelSettings);
            const parsedCap = parseCashbackCap(rate.cap, card, levelSettings);

            // Create merge key: rate + category + period
            const mergeKey = `${parsedRate}-${rate.category || 'no-category'}-${rate.period || 'no-period'}`;

            if (mergedActiveRates.has(mergeKey)) {
                // Merge with existing rate
                const existing = mergedActiveRates.get(mergeKey);
                if (rate.items) {
                    existing.items = [...existing.items, ...rate.items];
                }
                // Merge conditions
                if (rate.conditions) {
                    if (existing.conditions) {
                        existing.conditions += '\n' + rate.conditions;
                    } else {
                        existing.conditions = rate.conditions;
                    }
                }
            } else {
                // First time seeing this rate+category+period combination
                mergedActiveRates.set(mergeKey, {
                    parsedRate,
                    parsedCap,
                    items: rate.items ? [...rate.items] : [],
                    conditions: rate.conditions || '',
                    period: rate.period,
                    periodEnd: rate.periodEnd,
                    category: rate.category
                });
            }
        }

        // Display merged rates
        let index = 0;
        for (const [mergeKey, mergedRate] of mergedActiveRates) {
            content += `<div class="cashback-detail-item">`;

            // 显示回饋率，如果有 category 则显示在括号中（使用動態樣式）
            const categoryStyleOther = mergedRate.category ? getCategoryStyle(mergedRate.category) : '';
            const categoryLabel = mergedRate.category ? ` <span style="${categoryStyleOther}">${getCategoryDisplayName(mergedRate.category)}</span>` : '';

            // Add ending soon badge if applicable
            let endingSoonBadgeOther = '';
            if (mergedRate.periodEnd && isEndingSoon(mergedRate.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(mergedRate.periodEnd);
                const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                endingSoonBadgeOther = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            content += `<div class="cashback-rate"><span class="cashback-rate-num">${mergedRate.parsedRate}%</span> 回饋${categoryLabel}${endingSoonBadgeOther}</div>`;

            // 显示消費上限
            if (mergedRate.parsedCap) {
                content += `<div class="cashback-condition">消費上限: NT$${mergedRate.parsedCap.toLocaleString()}</div>`;
            } else {
                content += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // 显示條件
            if (mergedRate.conditions) {
                content += renderConditionLine(mergedRate.conditions);
            }

            // 显示活動期間
            if (mergedRate.period) {
                content += `<div class="cashback-condition">活動期間: ${mergedRate.period}</div>`;
            }

            // 显示適用通路
            if (mergedRate.items && mergedRate.items.length > 0) {
                const merchantsId = `cube-other-merchants-${index}`;
                const showAllId = `cube-other-show-all-${index}`;

                if (mergedRate.items.length <= 5) {
                    const merchantsList = mergedRate.items.join('、');
                    content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = mergedRate.items.slice(0, 5).join('、');
                    const fullList = mergedRate.items.join('、');

                    content += `<div class="cashback-merchants">`;
                    content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${mergedRate.items.length}個</button>`;
                    content += `</div>`;
                }
            }

            content += `</div>`;
            index++;
        }
    }

    return content;
}

// Update CUBE special cashback when level changes
async function updateCubeSpecialCashback(card) {
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    const newContent = await generateCubeSpecialContent(card);
    specialCashbackDiv.innerHTML = newContent;
    // Re-evaluate condition clamps for the freshly rendered content
    initConditionClamps(specialCashbackDiv);
}

// Escape a string for embedding as a single-quoted JS literal inside an HTML onclick attribute.
// Apostrophes (e.g. "Tomod's") would otherwise close the single-quoted string early.
function escapeForOnclick(s) {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 切換通路顯示展開/收起
function toggleMerchants(merchantsId, buttonId, shortList, fullList) {
    const merchantsElement = document.getElementById(merchantsId);
    const buttonElement = document.getElementById(buttonId);

    if (!merchantsElement || !buttonElement) return;

    const isExpanded = buttonElement.textContent.includes('收起');

    if (isExpanded) {
        // 收起
        merchantsElement.textContent = shortList;
        const totalCount = fullList.split('、').length;
        buttonElement.textContent = `... 顯示全部${totalCount}個`;
    } else {
        // 展開
        merchantsElement.textContent = fullList;
        buttonElement.textContent = '收起';
    }
}

// 即時過濾「指定通路回饋」中的活動卡片
// 只在已渲染的 DOM 上做過濾（不重新計算或 fetch），效能 < 5ms
function filterCashbackItems(searchTerm) {
    const term = (searchTerm || '').toLowerCase().trim();
    const container = document.getElementById('card-special-cashback');
    const emptyMsg = document.getElementById('cashback-search-empty');
    if (!container) return;

    const items = container.querySelectorAll('.cashback-detail-item');
    let visibleCount = 0;

    items.forEach(item => {
        if (!term) {
            item.style.display = '';
            visibleCount++;
            return;
        }
        // 比對整個卡片的 textContent，包含通路名稱、category 標籤、條件等
        const text = item.textContent.toLowerCase();
        if (text.includes(term)) {
            item.style.display = '';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });

    if (emptyMsg) {
        emptyMsg.style.display = (term && visibleCount === 0) ? 'block' : 'none';
    }
}

// 切換條件顯示/隱藏
function toggleConditions(conditionsId, buttonId) {
    const conditionsElement = document.getElementById(conditionsId);
    const buttonElement = document.getElementById(buttonId);

    if (!conditionsElement || !buttonElement) return;

    const isHidden = conditionsElement.style.display === 'none';

    if (isHidden) {
        // 展開
        conditionsElement.style.display = 'block';
        buttonElement.textContent = '▲ 收起條件';
    } else {
        // 收起
        conditionsElement.style.display = 'none';
        buttonElement.textContent = '▼ 查看各通路詳細條件';
    }
}

// 將toggleMerchants和toggleConditions暴露到全局作用域，確保onclick可以訪問
window.toggleMerchants = toggleMerchants;
window.toggleConditions = toggleConditions;

// 用戶筆記相關功能
let currentNotesCardId = null;
let lastSavedNotes = new Map(); // 記錄每張卡最後儲存的內容

// 讀取用戶筆記 (註: 筆記僅依賴cardId，與cardsInComparison狀態無關)
async function loadUserNotes(cardId) {
    const cacheKey = (auth && auth.currentUser) ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;

    if (!auth || !auth.currentUser) {
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
    
    try {
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        const notes = docSnap.exists() ? docSnap.data().notes : '';
        
        // 更新本地快取和記錄
        localStorage.setItem(cacheKey, notes);
        lastSavedNotes.set(cardId, notes);
        
        return notes;
    } catch (error) {
        console.log('讀取筆記失敗，使用本地快取:', error);
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
}

// 本地儲存（自動備份）
function autoBackupNotes(cardId, notes) {
    const cacheKey = (auth && auth.currentUser) ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    localStorage.setItem(cacheKey, notes);
}

// 手動儲存筆記
async function saveUserNotes(cardId, notes) {
    const saveBtn = document.getElementById('save-notes-btn');
    const saveIndicator = document.getElementById('save-indicator');
    const btnText = document.querySelector('.btn-text');
    const btnIcon = document.querySelector('.btn-icon');
    
    if (!auth || !auth.currentUser) {
        // 未登入時僅儲存在本地
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // 更新按鈕狀態
        saveBtn.disabled = true;
        saveIndicator.textContent = '已儲存在本地 (未登入)';
        saveIndicator.style.color = '#6b7280';
        return true;
    }
    
    try {
        // 更新按鈕為儲存中狀態
        saveBtn.className = 'save-notes-btn saving';
        saveBtn.disabled = true;
        if (btnIcon) btnIcon.textContent = '⏳';
        if (btnText) btnText.textContent = '儲存中...';
        saveIndicator.textContent = '';
        
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            notes: notes,
            updatedAt: new Date(),
            cardId: cardId
        });
        
        // 也儲存在本地作為快取
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // 成功狀態
        saveBtn.className = 'save-notes-btn success';
        if (btnIcon) btnIcon.textContent = '✓';
        if (btnText) btnText.textContent = '已儲存';
        saveIndicator.textContent = '✓ 雲端同步成功';
        saveIndicator.style.color = '#10b981';

        // 2秒後恢復正常狀態
        setTimeout(() => {
            saveBtn.className = 'save-notes-btn';
            saveBtn.disabled = true; // 沒有變更時保持禁用
            if (btnIcon) btnIcon.textContent = '💾';
            if (btnText) btnText.textContent = '儲存筆記';
            saveIndicator.textContent = '';
        }, 2000);
        
        return true;
        
    } catch (error) {
        console.error('雲端儲存失敗:', error);
        
        // 失敗時仍然儲存在本地
        autoBackupNotes(cardId, notes);
        
        // 錯誤狀態
        saveBtn.className = 'save-notes-btn';
        saveBtn.disabled = false; // 可以再次嘗試
        if (btnIcon) btnIcon.textContent = '⚠️';
        if (btnText) btnText.textContent = '重試儲存';
        saveIndicator.textContent = '雲端儲存失敗，已本地儲存';
        saveIndicator.style.color = '#dc2626';

        // 5秒後恢復
        setTimeout(() => {
            if (btnIcon) btnIcon.textContent = '💾';
            if (btnText) btnText.textContent = '儲存筆記';
            saveIndicator.textContent = '';
        }, 5000);
        
        return false;
    }
}

// ============================================
// 消費配卡表功能
// ============================================

// 生成唯一 ID
function generateMappingId() {
    return 'mapping_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 讀取用戶的消費配卡表
async function loadSpendingMappings() {
    // 檢查是否有登入用戶
    if (!currentUser) {
        // 未登入用戶
        userSpendingMappings = readLocalJSONArray('spendingMappings');
        console.log('📋 [配卡] 未登入，從本地載入:', userSpendingMappings.length, '筆');
        return userSpendingMappings;
    }

    try {
        // 從 Firestore 的 users collection 讀取
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().spendingMappings) {
                const mappings = docSnap.data().spendingMappings;
                userSpendingMappings = mappings;
                console.log('✅ [配卡] 從 Firestore 讀取成功:', mappings.length, '筆');

                // 更新本地快取
                localStorage.setItem(`spendingMappings_${currentUser.uid}`, JSON.stringify(mappings));
                return mappings;
            }
        }

        // Fallback to localStorage if Firestore fails or no data
        userSpendingMappings = readLocalJSONArray(`spendingMappings_${currentUser.uid}`);
        console.log('📦 [配卡] 從本地快取載入 (fallback):', userSpendingMappings.length, '筆');
        return userSpendingMappings;
    } catch (error) {
        console.error('❌ [配卡] 讀取失敗，使用本地快取:', error);
        userSpendingMappings = readLocalJSONArray(`spendingMappings_${currentUser.uid}`);
        return userSpendingMappings;
    }
}

// 保存用戶的消費配卡表
async function saveSpendingMappings(mappings) {
    userSpendingMappings = mappings;

    // 檢查是否有登入用戶
    if (!currentUser) {
        // 未登入用戶只保存在本地
        localStorage.setItem('spendingMappings', JSON.stringify(mappings));
        console.log('💾 [配卡] 未登入，僅保存到本地');
        return true;
    }

    try {
        // 保存到本地快取
        localStorage.setItem(`spendingMappings_${currentUser.uid}`, JSON.stringify(mappings));
        console.log('✅ [配卡] 已保存到本地快取:', mappings.length, '筆');

        // 保存到 Firestore 的 users collection
        if (window.db && window.doc && window.setDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            await window.setDoc(docRef, {
                spendingMappings: mappings,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('☁️ [配卡] 已同步到 Firestore:', mappings.length, '筆');
        }

        return true;
    } catch (error) {
        console.error('❌ [配卡] Firestore 保存失敗:', error);
        // 失敗時至少本地已保存
        return false;
    }
}

// 添加配對
async function addMapping(cardId, cardName, merchant, cashbackRate, periodEnd = null, periodStart = null) {
    // 檢查是否有登入用戶
    if (!currentUser) {
        alert('請先登入才能使用此功能');
        return null;
    }

    const now = Date.now();
    const newMapping = {
        id: generateMappingId(),
        cardId: cardId,
        cardName: cardName,
        merchant: merchant,
        cashbackRate: cashbackRate,
        createdAt: now,
        lastCheckedRate: cashbackRate, // 記錄最後檢查的回饋率
        lastCheckedTime: now, // 記錄最後檢查的時間
        hasChanged: false, // 初始為未變動
        periodEnd: periodEnd, // 活動結束日期
        periodStart: periodStart // 活動開始日期
    };

    console.log('➕ [配卡] 新增配對:', cardName, '-', merchant, cashbackRate + '%', periodEnd ? `(到期: ${periodEnd})` : '');
    userSpendingMappings.push(newMapping);
    const saved = await saveSpendingMappings(userSpendingMappings);

    if (!saved) {
        console.warn('⚠️ [配卡] 保存到雲端失敗，但已保存到本地');
    }

    return newMapping;
}

// 刪除配對
async function removeMapping(mappingId) {
    console.log('🗑️ [配卡] 刪除配對:', mappingId);
    userSpendingMappings = userSpendingMappings.filter(m => m.id !== mappingId);
    const saved = await saveSpendingMappings(userSpendingMappings);

    if (!saved) {
        console.warn('⚠️ [配卡] 刪除後保存到雲端失敗，但已保存到本地');
    }
}

// 檢查是否已釘選
function isPinned(cardId, merchant) {
    return userSpendingMappings.some(m =>
        m.cardId === cardId && m.merchant === merchant
    );
}

// 切換釘選狀態
async function togglePin(button, cardId, cardName, merchant, rate, periodEnd = null, periodStart = null) {
    // 檢查是否有登入用戶
    if (!currentUser) {
        alert('登入後即可使用釘選功能，幫您記錄個人配卡！');
        return;
    }

    const alreadyPinned = isPinned(cardId, merchant);

    if (alreadyPinned) {
        // 取消釘選
        const mapping = userSpendingMappings.find(m =>
            m.cardId === cardId && m.merchant === merchant
        );
        if (mapping) {
            await removeMapping(mapping.id);
            button.classList.remove('pinned');
            button.title = '釘選此配對';
            showToast('已取消釘選', button.closest('.card-result'));

            // 追蹤取消釘選事件
            if (window.logEvent && window.firebaseAnalytics) {
                window.logEvent(window.firebaseAnalytics, 'unpin_card', {
                    card_id: cardId,
                    card_name: cardName,
                    merchant: merchant,
                    rate: rate
                });
            }
        }
    } else {
        // 釘選
        const newMapping = await addMapping(cardId, cardName, merchant, rate, periodEnd, periodStart);
        if (newMapping) {
            button.classList.add('pinned');
            button.title = '取消釘選';

            // 顯示成功動畫
            showPinSuccessAnimation(button);

            // 追蹤釘選事件
            if (window.logEvent && window.firebaseAnalytics) {
                window.logEvent(window.firebaseAnalytics, 'pin_card', {
                    card_id: cardId,
                    card_name: cardName,
                    merchant: merchant,
                    rate: rate
                });
            }
        }
    }
}

// 顯示釘選成功動畫
function showPinSuccessAnimation(button) {
    const cardElement = button.closest('.card-result');

    // 1. 顯示提示
    showToast('已加入我的配卡✓', cardElement);

    // 2. 顯示 +1 徽章動畫
    showPlusBadgeAnimation();
}

// 顯示 +1 徽章動畫
function showPlusBadgeAnimation() {
    const btn = document.getElementById('my-mappings-btn');
    if (!btn) return;

    // 創建 +1 徽章
    const badge = document.createElement('span');
    badge.className = 'pin-badge';
    badge.textContent = '+1';
    btn.appendChild(badge);

    // 從小放大動畫
    badge.animate([
        { transform: 'scale(0)', opacity: 0 },
        { transform: 'scale(1.2)', opacity: 1, offset: 0.5 },
        { transform: 'scale(1)', opacity: 1 }
    ], {
        duration: 400,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    });

    // 閃爍效果
    setTimeout(() => {
        badge.animate([
            { opacity: 1 },
            { opacity: 0.6 },
            { opacity: 1 }
        ], {
            duration: 300
        });
    }, 400);

    // 1.5秒後淡出並移除
    setTimeout(() => {
        const fadeOut = badge.animate([
            { opacity: 1 },
            { opacity: 0 }
        ], {
            duration: 300,
            fill: 'forwards'
        });
        fadeOut.onfinish = () => badge.remove();
    }, 1500);
}

// 顯示小提示
function showToast(message, cardElement) {
    const toast = document.createElement('div');
    toast.className = 'pin-toast';
    toast.textContent = message;
    cardElement.appendChild(toast);

    // 淡入
    setTimeout(() => toast.classList.add('show'), 10);

    // 2秒後淡出並移除
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// 優化商家名稱顯示（去重、選擇最完整的名稱）
function optimizeMerchantName(merchant) {
    if (!merchant) return '';

    // 如果包含頓號，說明有多個項目
    if (merchant.includes('、')) {
        const items = merchant.split('、').map(s => s.trim()).filter(Boolean);

        // 去重
        const uniqueItems = [...new Set(items)];

        // 如果只剩一個，直接返回
        if (uniqueItems.length === 1) {
            return uniqueItems[0];
        }

        // 選擇最長的名稱（通常是最完整的）
        // 例如："街口支付" vs "街口" -> 選擇 "街口支付"
        const sorted = uniqueItems.sort((a, b) => b.length - a.length);

        // 檢查是否有包含關係
        const longest = sorted[0];
        const filtered = sorted.filter(item => {
            // 如果 item 被 longest 包含，則過濾掉
            return item === longest || !longest.includes(item);
        });

        // 如果過濾後只剩一個，返回它
        if (filtered.length === 1) {
            return filtered[0];
        }

        // 否則返回前兩個
        return filtered.slice(0, 2).join('、');
    }

    return merchant;
}

// 輔助函數：從 cardsData 中查找活動的到期日
function findActivityPeriod(cardId, merchant) {
    const card = cardsData?.cards.find(c => c.id === cardId);
    if (!card) return null;

    const merchantLower = merchant.toLowerCase();

    // 搜尋 cashbackRates
    if (card.cashbackRates) {
        for (const rate of card.cashbackRates) {
            if (rate.items) {
                for (const item of rate.items) {
                    if (item.toLowerCase().includes(merchantLower) || merchantLower.includes(item.toLowerCase())) {
                        return {
                            periodEnd: rate.periodEnd || null,
                            periodStart: rate.periodStart || null
                        };
                    }
                }
            }
        }
    }

    // 搜尋 specialItems
    if (card.specialItems) {
        for (const item of card.specialItems) {
            if (item.toLowerCase().includes(merchantLower) || merchantLower.includes(item.toLowerCase())) {
                // specialItems 通常沒有獨立的 period，使用 card 層級的
                return {
                    periodEnd: null,
                    periodStart: null
                };
            }
        }
    }

    // 搜尋 generalItems (CUBE 卡)
    if (card.generalItems) {
        for (const item of card.generalItems) {
            if (item.toLowerCase().includes(merchantLower) || merchantLower.includes(item.toLowerCase())) {
                return {
                    periodEnd: null,
                    periodStart: null
                };
            }
        }
    }

    return null;
}

// 打開我的配卡表 Modal
async function openMyMappingsModal() {
    const modal = document.getElementById('my-mappings-modal');
    const mappingsList = document.getElementById('mappings-list');
    const searchInput = document.getElementById('mappings-search');

    if (!modal || !mappingsList) return;

    // 渲染配卡表（過期收合區每次開 modal 都從收合狀態開始）
    mappingsExpiredOpen = false;
    renderMappingsList();

    // 顯示 Modal
    modal.style.display = 'flex';
    disableBodyScroll();

    // 綁定關閉按鈕
    const closeBtn = document.getElementById('close-mappings-modal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    // 點擊背景關閉
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            enableBodyScroll();
        }
    };

    // 搜尋功能
    if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = () => {
            renderMappingsList(searchInput.value.trim());
        };
    }
}

// ============== 我的配卡：分組卡片式視圖（2026-07-16 重造） ==============
// 一張信用卡＝一個群組卡片：卡名色塊（統一淺灰，2026-07-17 起不吸卡面色，
// 舊 CARD_ACCENT_COLORS 抽色表見 git 歷史）＋ⓘ 詳情＋活動列。
// 同卡＋同回饋率＋同截止日＝同一活動，商家合併成一列 pills；
// 活動列固定回饋率高→低排序，卡片組可整組拖、pill 限同列內拖。
// 過期配對自動沉底成收合區（含一鍵清理）；14 天內到期顯示黃色預警。

// 到期狀態分類：expired（過期沉底）/ soon（14 天內，黃色預警）/ active / none
function getMappingExpiryInfo(mapping, taiwanToday) {
    if (!mapping.periodEnd) return { status: 'none' };
    try {
        const endDate = parseISODate(mapping.periodEnd);
        const diffDays = Math.ceil((endDate - taiwanToday) / 86400000);
        if (diffDays < 0) return { status: 'expired' };
        if (diffDays <= 14) return { status: 'soon', diffDays };
        return { status: 'active' };
    } catch (error) {
        console.error('❌ Date parsing error:', error, { periodEnd: mapping.periodEnd });
        return { status: 'none' };
    }
}

// 過期收合區展開狀態（modal 開啟期間記住，重開 modal 歸零）
let mappingsExpiredOpen = false;

function renderMappingsList(searchTerm = '') {
    const mappingsList = document.getElementById('mappings-list');
    if (!mappingsList) return;

    // 篩選（商家或卡名）
    let filteredMappings = userSpendingMappings;
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filteredMappings = userSpendingMappings.filter(m =>
            m.merchant.toLowerCase().includes(term) ||
            m.cardName.toLowerCase().includes(term)
        );
    }

    if (filteredMappings.length === 0) {
        mappingsList.innerHTML = `
            <div class="mappings-empty">
                <svg width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                    <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                </svg>
                <p>${searchTerm ? '找不到符合的配對' : '還沒有配卡記錄'}</p>
                <p style="font-size: 12px; margin-top: 8px;">查詢商家後，點擊結果卡片的釘選按鈕即可添加</p>
            </div>
        `;
        return;
    }

    // 確保每個 mapping 都有 order 欄位（拖曳排序的持久化鍵）
    filteredMappings.forEach((mapping, index) => {
        if (mapping.order === undefined) {
            mapping.order = index;
        }
    });
    filteredMappings.sort((a, b) => (a.order || 0) - (b.order || 0));

    const taiwanToday = parseISODate(getTaiwanToday());

    // mapping 沒有 periodEnd 時嘗試從 cardsData 回填（沿用舊行為）
    let needsBackfillSave = false;
    filteredMappings.forEach(mapping => {
        if (!mapping.periodEnd) {
            const foundPeriod = findActivityPeriod(mapping.cardId, mapping.merchant);
            if (foundPeriod && foundPeriod.periodEnd) {
                mapping.periodEnd = foundPeriod.periodEnd;
                mapping.periodStart = foundPeriod.periodStart;
                needsBackfillSave = true;
            }
        }
    });
    if (needsBackfillSave) {
        setTimeout(() => {
            saveSpendingMappings(userSpendingMappings).catch(err => {
                console.warn('⚠️ 背景更新 mapping periodEnd 失敗:', err);
            });
        }, 100);
    }

    // 分類：有效配對依卡分組（組序＝組內最前面那筆的順序），過期配對沉底
    const groups = [];
    const groupIndex = new Map(); // cardId -> groups[] index
    const expiredMappings = [];
    filteredMappings.forEach(mapping => {
        const expiry = getMappingExpiryInfo(mapping, taiwanToday);
        if (expiry.status === 'expired') {
            expiredMappings.push(mapping);
            return;
        }
        if (!groupIndex.has(mapping.cardId)) {
            groupIndex.set(mapping.cardId, groups.length);
            groups.push({ cardId: mapping.cardId, cardName: mapping.cardName, rows: [] });
        }
        groups[groupIndex.get(mapping.cardId)].rows.push({ mapping, expiry });
    });

    // 搜尋過濾時停用拖曳（過濾後的順序沒有全域意義，拖了會亂寫 order）
    const dragEnabled = !searchTerm;
    const dragHandleHtml = () => dragEnabled ? `
        <span class="mapping-drag-handle group-handle" title="拖曳排序">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
            </svg>
        </span>` : '';

    // 同卡＋同回饋率＋同截止日＝同一個活動：商家合併成一列 pills。
    // 活動列不開放拖曳，固定回饋率高→低（同率截止日近→遠）；pill 順序仍吃 order、可拖
    const buildActivities = (rows) => {
        const activities = [];
        const actIndex = new Map();
        rows.forEach(({ mapping, expiry }) => {
            const key = `${mapping.cashbackRate}|${mapping.periodEnd || ''}`;
            if (!actIndex.has(key)) {
                actIndex.set(key, activities.length);
                activities.push({ rate: mapping.cashbackRate, periodEnd: mapping.periodEnd, expiry, mappings: [] });
            }
            activities[actIndex.get(key)].mappings.push(mapping);
        });
        activities.sort((a, b) =>
            (parseFloat(b.rate) || 0) - (parseFloat(a.rate) || 0) ||
            String(a.periodEnd || '9999-99-99').localeCompare(String(b.periodEnd || '9999-99-99')));
        return activities;
    };

    const pillHtml = (mapping) => `
        <span class="mapping-pill" data-mapping-id="${escapeHtml(mapping.id)}">
            <span class="mapping-pill-name">${escapeHtml(optimizeMerchantName(mapping.merchant))}</span>
            <button type="button" class="mapping-pill-remove" data-mapping-id="${escapeHtml(mapping.id)}" title="刪除">×</button>
        </span>`;

    const activityHtml = (activity) => {
        let dateHtml;
        if (activity.expiry.status === 'soon') {
            dateHtml = `${escapeHtml(activity.periodEnd)} 止 <span class="mapping-badge-soon">即將到期</span>`;
        } else if (activity.expiry.status === 'active') {
            dateHtml = `${escapeHtml(activity.periodEnd)} 止`;
        } else {
            dateHtml = '無活動期限';
        }
        return `
            <div class="mapping-item">
                <div class="mapping-item-main">
                    <div class="mapping-item-pills">${activity.mappings.map(pillHtml).join('')}</div>
                    <div class="mapping-item-date">${dateHtml}</div>
                </div>
                <span class="mapping-item-rate">${escapeHtml(String(activity.rate))}%</span>
            </div>`;
    };

    let html = '<div class="mapping-groups">';
    groups.forEach(group => {
        html += `
            <div class="mapping-group" data-card-id="${escapeHtml(group.cardId)}">
                <div class="mapping-group-head">
                    ${dragHandleHtml()}
                    <img class="mapping-group-cardimg" src="assets/images/cards/${escapeHtml(group.cardId)}.png" alt="" onerror="this.style.display='none'">
                    <span class="mapping-group-name">${escapeHtml(group.cardName)}</span>
                    <button type="button" class="mapping-peek-btn" data-card-id="${escapeHtml(group.cardId)}" aria-label="查看卡片詳情" title="查看卡片詳情">ⓘ</button>
                </div>
                <div class="mapping-group-rows">
                    ${buildActivities(group.rows).map(activityHtml).join('')}
                </div>
            </div>`;
    });

    if (expiredMappings.length > 0) {
        html += `
            <div class="mappings-expired ${mappingsExpiredOpen ? 'open' : ''}">
                <button type="button" class="mappings-expired-toggle" id="mappings-expired-toggle">
                    <span>已過期（${expiredMappings.length}）</span>
                    <span class="mappings-expired-chev">▾</span>
                </button>
                <div class="mappings-expired-body">
                    ${expiredMappings.map(mapping => `
                        <div class="mapping-item" data-mapping-id="${escapeHtml(mapping.id)}">
                            <div class="mapping-item-main">
                                <div class="mapping-item-merchant">${escapeHtml(optimizeMerchantName(mapping.merchant))}<span class="mapping-expired-cardname">・${escapeHtml(mapping.cardName)}</span></div>
                                <div class="mapping-item-date">${escapeHtml(mapping.periodEnd)} <span class="mapping-badge-expired">已過期</span></div>
                            </div>
                            <span class="mapping-item-rate">${escapeHtml(String(mapping.cashbackRate))}%</span>
                            <button class="mapping-delete-btn" data-mapping-id="${escapeHtml(mapping.id)}" title="刪除">×</button>
                        </div>`).join('')}
                    <button type="button" class="mappings-clear-expired" id="mappings-clear-expired">清除全部過期配對</button>
                </div>
            </div>`;
    }
    html += '</div>';

    mappingsList.innerHTML = html;

    // ⓘ → 詳情頁（疊在配卡 modal 之上，body scroll lock 是 refcount 所以安全）
    mappingsList.querySelectorAll('.mapping-peek-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showCardDetail(btn.dataset.cardId);
        };
    });

    // 過期區展開/收合
    const expiredToggle = document.getElementById('mappings-expired-toggle');
    if (expiredToggle) {
        expiredToggle.onclick = () => {
            mappingsExpiredOpen = !mappingsExpiredOpen;
            expiredToggle.closest('.mappings-expired').classList.toggle('open', mappingsExpiredOpen);
        };
    }

    // 一鍵清理全部過期
    const clearExpiredBtn = document.getElementById('mappings-clear-expired');
    if (clearExpiredBtn) {
        clearExpiredBtn.onclick = async () => {
            if (!confirm(`確定要刪除全部 ${expiredMappings.length} 筆已過期的配對嗎？`)) return;
            const expiredIds = new Set(expiredMappings.map(m => m.id));
            userSpendingMappings = userSpendingMappings.filter(m => !expiredIds.has(m.id));
            await saveSpendingMappings(userSpendingMappings);
            renderMappingsList(searchTerm);
            updatePinButtonsState();
            if (window.logEvent && window.firebaseAnalytics) {
                window.logEvent(window.firebaseAnalytics, 'clear_expired_mappings', {
                    count: expiredIds.size
                });
            }
        };
    }

    // 綁定刪除按鈕（過期區的 × ＋ 活動列 pill 內的 ×）
    mappingsList.querySelectorAll('.mapping-delete-btn, .mapping-pill-remove').forEach(btn => {
        btn.onclick = async (e) => {
            e.preventDefault();
            const mappingId = btn.dataset.mappingId;
            if (confirm('確定要刪除這個配對嗎？')) {
                // 在刪除前取得 mapping 資訊用於追蹤
                const mapping = userSpendingMappings.find(m => m.id === mappingId);

                await removeMapping(mappingId);
                renderMappingsList(document.getElementById('mappings-search')?.value || '');

                // 更新結果卡片的釘選狀態（如果結果還在顯示）
                updatePinButtonsState();

                // 追蹤從我的配卡中刪除事件
                if (mapping && window.logEvent && window.firebaseAnalytics) {
                    window.logEvent(window.firebaseAnalytics, 'remove_mapping', {
                        card_id: mapping.cardId,
                        card_name: mapping.cardName,
                        merchant: mapping.merchant,
                        rate: mapping.cashbackRate
                    });
                }
            }
        };
    });

    // 綁定拖曳排序
    if (dragEnabled) setupMappingsDrag(mappingsList);
}

// 拖曳排序（Pointer Events，桌機滑鼠與手機觸控共用一套）：
// move/up 掛在 document（不用 setPointerCapture——實測 Chromium 會在拖曳中途
// 無故 lostpointercapture，事件斷流）；觸控防捲動靠元素的 touch-action: none。
// 卡片組從把手整組拖（.mapping-group 之間換位）；商家 pill 整顆拖、
// 限同一活動列的 pills 容器內換位（跨列＝不同回饋率/截止日，混了語義就錯）。
function setupMappingsDrag(container) {
    // horizontal：pill 換行排列，命中判斷要同時看 X/Y、換位看左右半邊
    const startDrag = (item, selector, horizontal) => (e) => {
        e.preventDefault();
        const parent = item.parentElement;
        item.classList.add('mapping-dragging');
        let moved = false;

        const onMove = (ev) => {
            // 指標跨過某個兄弟元素的中線就即時換位（live reorder，無 ghost）
            const siblings = Array.from(parent.querySelectorAll(':scope > ' + selector)).filter(el => el !== item);
            for (const sib of siblings) {
                const r = sib.getBoundingClientRect();
                const hit = ev.clientY > r.top && ev.clientY < r.bottom &&
                    (!horizontal || (ev.clientX > r.left && ev.clientX < r.right));
                if (hit) {
                    const before = horizontal
                        ? ev.clientX < r.left + r.width / 2
                        : ev.clientY < r.top + r.height / 2;
                    const target = before ? sib : sib.nextSibling;
                    if (target !== item && target !== item.nextSibling) {
                        parent.insertBefore(item, target);
                        moved = true;
                    }
                    break;
                }
            }
        };
        const onUp = async () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            item.classList.remove('mapping-dragging');
            if (moved) await persistMappingsDomOrder();
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    };

    container.querySelectorAll('.mapping-drag-handle').forEach(handle => {
        const group = handle.closest('.mapping-group');
        if (!group) return;
        handle.addEventListener('pointerdown', startDrag(group, '.mapping-group', false));
    });

    container.querySelectorAll('.mapping-pill').forEach(pill => {
        pill.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.mapping-pill-remove')) return;
            startDrag(pill, '.mapping-pill', true)(e);
        });
    });
}

// 依畫面目前的 DOM 順序重寫所有 mapping 的 order 並存檔。
// 過期列不在主序裡，接在後面、維持原相對順序。
async function persistMappingsDomOrder() {
    const mappingsList = document.getElementById('mappings-list');
    if (!mappingsList) return;
    const byId = new Map(userSpendingMappings.map(m => [m.id, m]));
    const seenIds = new Set();
    let seq = 0;
    mappingsList.querySelectorAll('.mapping-group .mapping-pill').forEach(el => {
        const mapping = byId.get(el.dataset.mappingId);
        if (mapping) {
            mapping.order = seq++;
            seenIds.add(mapping.id);
        }
    });
    userSpendingMappings
        .filter(m => !seenIds.has(m.id))
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach(m => { m.order = seq++; });
    await saveSpendingMappings(userSpendingMappings);
    renderMappingsList(document.getElementById('mappings-search')?.value.trim() || '');
}

// 更新釘選按鈕狀態
function updatePinButtonsState() {
    document.querySelectorAll('.pin-btn').forEach(btn => {
        const cardId = btn.dataset.cardId;
        const merchant = btn.dataset.merchant;
        const pinned = isPinned(cardId, merchant);

        if (pinned) {
            btn.classList.add('pinned');
            btn.title = '取消釘選';
        } else {
            btn.classList.remove('pinned');
            btn.title = '釘選此配對';
        }
    });
}

// 檢查筆記是否有變更
function hasNotesChanged(cardId, currentNotes) {
    const lastSaved = lastSavedNotes.get(cardId) || '';
    return currentNotes !== lastSaved;
}

// 更新儲存按鈕狀態
function updateSaveButtonState(cardId, currentNotes) {
    const saveBtn = document.getElementById('save-notes-btn');
    if (!saveBtn) return;
    
    const hasChanged = hasNotesChanged(cardId, currentNotes);
    saveBtn.disabled = !hasChanged;
    
    if (hasChanged && !saveBtn.className.includes('saving')) {
        saveBtn.className = 'save-notes-btn';
    }
}

// 免年費狀態相關功能

// 讀取免年費狀態
async function loadFeeWaiverStatus(cardId) {
    if (!currentUser) {
        const localKey = `feeWaiver_local_${cardId}`;
        return localStorage.getItem(localKey) === 'true';
    }

    try {
        // 從 Firestore 的 users collection 讀取
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().feeWaiverStatus) {
                const isWaived = docSnap.data().feeWaiverStatus[cardId] || false;
                // 更新本地快取
                const localKey = `feeWaiver_${currentUser.uid}_${cardId}`;
                localStorage.setItem(localKey, isWaived.toString());
                console.log('✅ [免年費] 從 Firestore 讀取:', cardId, isWaived);
                return isWaived;
            }
        }

        // Fallback to localStorage
        const localKey = `feeWaiver_${currentUser.uid}_${cardId}`;
        const saved = localStorage.getItem(localKey) === 'true';
        console.log('📦 [免年費] 從本地讀取 (fallback):', cardId, saved);
        return saved;
    } catch (error) {
        console.error('❌ 讀取免年費狀態失敗:', error);
        const localKey = `feeWaiver_${currentUser.uid}_${cardId}`;
        return localStorage.getItem(localKey) === 'true';
    }
}

// 儲存免年費狀態
async function saveFeeWaiverStatus(cardId, isWaived) {
    const localKey = `feeWaiver_${currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, isWaived.toString());
    console.log('✅ [免年費] 已保存到本地快取:', cardId, isWaived);

    if (!currentUser) return;

    try {
        // 保存到 Firestore 的 users collection
        if (window.db && window.doc && window.setDoc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);

            // 先讀取現有的 feeWaiverStatus
            const docSnap = await window.getDoc(docRef);
            const existingData = docSnap.exists() ? docSnap.data() : {};
            const feeWaiverStatus = existingData.feeWaiverStatus || {};

            // 更新特定卡片的狀態
            feeWaiverStatus[cardId] = isWaived;

            await window.setDoc(docRef, {
                feeWaiverStatus: feeWaiverStatus,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('☁️ [免年費] 已同步到 Firestore:', cardId, isWaived);
        }
    } catch (error) {
        console.error('❌ [免年費] Firestore 保存失敗:', error);
    }
}

// 設置免年費狀態功能
async function setupFeeWaiverStatus(cardId) {
    const checkbox = document.getElementById('fee-waiver-checked');
    if (!checkbox) return;

    // 讀取當前狀態
    const isWaived = await loadFeeWaiverStatus(cardId);
    checkbox.checked = isWaived;

    // 設置變更監聽
    checkbox.onchange = (e) => {
        const newStatus = e.target.checked;
        saveFeeWaiverStatus(cardId, newStatus);

        // 更新視覺提示 (可選)
        const checkboxLabel = e.target.parentElement.querySelector('.checkbox-label');
        if (newStatus) {
            checkboxLabel.style.color = '#10b981';
            setTimeout(() => {
                checkboxLabel.style.color = '';
            }, 1000);
        }
    };
}

// 我的額度相關功能（選填金額；比照免年費狀態的儲存方式）

// 讀取我的額度（回傳數字，未填寫回傳 null）
async function loadCreditLimit(cardId) {
    const parse = (v) => {
        const n = Number(v);
        return v !== null && v !== '' && Number.isFinite(n) && n > 0 ? n : null;
    };

    if (!currentUser) {
        return parse(localStorage.getItem(`creditLimit_local_${cardId}`));
    }

    try {
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists() && docSnap.data().creditLimits) {
                const amount = parse(docSnap.data().creditLimits[cardId]);
                const localKey = `creditLimit_${currentUser.uid}_${cardId}`;
                localStorage.setItem(localKey, amount === null ? '' : String(amount));
                return amount;
            }
        }
        return parse(localStorage.getItem(`creditLimit_${currentUser.uid}_${cardId}`));
    } catch (error) {
        console.error('❌ 讀取我的額度失敗:', error);
        return parse(localStorage.getItem(`creditLimit_${currentUser.uid}_${cardId}`));
    }
}

// 儲存我的額度（amount 為數字，null 表示清空）
async function saveCreditLimit(cardId, amount) {
    const localKey = `creditLimit_${currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, amount === null ? '' : String(amount));

    if (!currentUser) return;

    try {
        if (window.db && window.doc && window.setDoc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            const existingData = docSnap.exists() ? docSnap.data() : {};
            const creditLimits = existingData.creditLimits || {};

            if (amount === null) {
                delete creditLimits[cardId];
            } else {
                creditLimits[cardId] = amount;
            }

            await window.setDoc(docRef, {
                creditLimits: creditLimits,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('☁️ [我的額度] 已同步到 Firestore:', cardId, amount);
        }
    } catch (error) {
        console.error('❌ [我的額度] Firestore 保存失敗:', error);
    }
}

// 設置我的額度輸入（卡片詳情頁）
async function setupCreditLimit(cardId) {
    const input = document.getElementById('credit-limit-input');
    const savedTag = document.getElementById('credit-limit-saved');
    if (!input) return;

    if (savedTag) savedTag.textContent = '';
    const current = await loadCreditLimit(cardId);
    input.value = current !== null ? current.toLocaleString() : '';

    // 失焦或按 Enter 即儲存；只留數字，顯示千分位
    input.onchange = () => {
        const raw = input.value.replace(/[^\d]/g, '');
        const amount = raw ? Number(raw) : null;
        input.value = amount !== null ? amount.toLocaleString() : '';
        saveCreditLimit(cardId, amount);
        if (savedTag) {
            savedTag.textContent = '✓ 已儲存';
            setTimeout(() => {
                if (savedTag.textContent === '✓ 已儲存') savedTag.textContent = '';
            }, 2000);
        }
    };
    input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    };
}

// 結帳日期相關功能

// 讀取結帳日期
async function loadBillingDates(cardId) {
    const defaultDates = { billingDate: '', statementDate: '' };
    // 確保回傳值一定是 { billingDate, statementDate } 形狀，儲存的資料被污染也不會讓 UI 掛掉
    const normalizeDates = (raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...defaultDates };
        return {
            billingDate: typeof raw.billingDate === 'string' ? raw.billingDate : '',
            statementDate: typeof raw.statementDate === 'string' ? raw.statementDate : ''
        };
    };

    if (!currentUser) {
        return normalizeDates(readLocalJSON(`billingDates_local_${cardId}`));
    }

    try {
        // 從 Firestore 的 users collection 讀取
        if (window.db && window.doc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);

            if (docSnap.exists() && docSnap.data().billingDates && docSnap.data().billingDates[cardId]) {
                const dates = normalizeDates(docSnap.data().billingDates[cardId]);
                // 更新本地快取
                const localKey = `billingDates_${currentUser.uid}_${cardId}`;
                localStorage.setItem(localKey, JSON.stringify(dates));
                console.log('✅ [結帳日期] 從 Firestore 讀取:', cardId, dates);
                return dates;
            }
        }

        // Fallback to localStorage
        return normalizeDates(readLocalJSON(`billingDates_${currentUser.uid}_${cardId}`));
    } catch (error) {
        console.error('❌ 讀取結帳日期失敗:', error);
        return normalizeDates(readLocalJSON(`billingDates_${currentUser.uid}_${cardId}`));
    }
}

// 儲存結帳日期
async function saveBillingDates(cardId, billingDate, statementDate) {
    const dateData = {
        billingDate: billingDate || '',
        statementDate: statementDate || ''
    };

    const localKey = `billingDates_${currentUser?.uid || 'local'}_${cardId}`;
    localStorage.setItem(localKey, JSON.stringify(dateData));
    console.log('✅ [結帳日期] 已保存到本地快取:', cardId, dateData);

    if (!currentUser) return;

    try {
        // 保存到 Firestore 的 users collection
        if (window.db && window.doc && window.setDoc && window.getDoc) {
            const docRef = window.doc(window.db, 'users', currentUser.uid);

            // 先讀取現有的 billingDates
            const docSnap = await window.getDoc(docRef);
            const existingData = docSnap.exists() ? docSnap.data() : {};
            const billingDates = existingData.billingDates || {};

            // 更新特定卡片的結帳日期
            billingDates[cardId] = dateData;

            await window.setDoc(docRef, {
                billingDates: billingDates,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('☁️ [結帳日期] 已同步到 Firestore:', cardId, dateData);
        }
    } catch (error) {
        console.error('❌ [結帳日期] Firestore 保存失敗:', error);
    }
}

// 設置結帳日期功能
async function setupBillingDates(cardId) {
    const billingInput = document.getElementById('billing-date');
    const statementInput = document.getElementById('statement-date');
    
    if (!billingInput || !statementInput) return;
    
    // 讀取已儲存的日期
    const savedDates = await loadBillingDates(cardId);
    billingInput.value = savedDates.billingDate;
    statementInput.value = savedDates.statementDate;
    
    // 為有值的輸入框加上視覺強調
    const updateInputAppearance = (input) => {
        if (input.value.trim() !== '') {
            input.style.borderColor = '#10b981';
            input.style.background = 'white';
            input.style.fontWeight = '600';
        }
    };
    
    updateInputAppearance(billingInput);
    updateInputAppearance(statementInput);
    
    // 儲存功能
    const saveDates = () => {
        const billing = billingInput.value;
        const statement = statementInput.value;
        saveBillingDates(cardId, billing, statement);
        
        // 更新視覺狀態
        updateInputAppearance(billingInput);
        updateInputAppearance(statementInput);
    };
    
    // 設置變更監聽
    billingInput.onchange = saveDates;
    billingInput.onblur = saveDates;
    statementInput.onchange = saveDates;
    statementInput.onblur = saveDates;
    
    // 輸入驗證
    [billingInput, statementInput].forEach(input => {
        input.oninput = (e) => {
            let value = parseInt(e.target.value);
            if (value > 31) e.target.value = 31;
            if (value < 1 && e.target.value !== '') e.target.value = 1;
        };
    });
}

// ========== Card Level Management Functions ==========

// Load card level from Firestore (with localStorage fallback and migration)
async function getCardLevel(cardId, defaultLevel) {
    // For non-level cards, return default immediately
    if (!cardId || !defaultLevel) return defaultLevel;

    // Serve from cache when available (avoids repeated Firestore reads within a
    // single calculation; invalidated by saveCardLevel and auth changes).
    const cacheKey = cardLevelCacheKey(cardId);
    if (cardLevelCache.has(cacheKey)) {
        return cardLevelCache.get(cacheKey);
    }

    const resolved = await getCardLevelUncached(cardId, defaultLevel);
    cardLevelCache.set(cacheKey, resolved);
    return resolved;
}

// 登入後預熱級別快取：並行對所有「有級別設定」的卡呼叫 getCardLevel()，把結果灌進
// cardLevelCache，讓使用者登入後的第一次計算不用再對每張卡串行等 Firestore getDoc
// （resolveCardLevel → getCardLevel 命中快取直接回傳）。
//
// 只讀不寫：這裡只是把 getCardLevel() 本來就會做的讀取提前、並行跑，不呼叫
// saveCardLevel()。getCardLevelUncached() 內既有的「本機鏡像補上傳 Firestore」邏輯
// （雲端沒值但本機鏡像有值時會 saveCardLevel 一次）維持原樣不動——那是既有的合法
// 呼叫場景（見 docs/project/storage-and-security.md 第 2 節），預熱只是提早觸發它，
// 不是新增呼叫路徑。
//
// Fire-and-forget：呼叫端不 await，逐卡失敗各自 catch 並 console.error，不讓單一
// 卡片的 Firestore 錯誤擋住其他卡或影響 onAuthStateChanged 流程。
function warmCardLevelCache() {
    if (!auth || !auth.currentUser) return; // 訪客沒有 Firestore 級別可預熱
    if (!cardsData || !Array.isArray(cardsData.cards)) return; // cardsData 還沒載入時安靜跳過

    const levelCards = cardsData.cards.filter(
        card => card.hasLevels && card.levelSettings && Object.keys(card.levelSettings).length > 0
    );

    Promise.all(levelCards.map(card => {
        const defaultLevel = Object.keys(card.levelSettings)[0];
        return getCardLevel(card.id, defaultLevel).catch(err => {
            console.error(`⚠️ 級別快取預熱失敗 (${card.id}):`, err);
        });
    })).then(() => {
        console.log(`✅ 級別快取預熱完成（${levelCards.length} 張卡）`);
    });
}

// 卡片級別的本機 key：登入者一律用 uid 區分（cardLevel_<uid>_<cardId>），
// 訪客沿用舊 key（cardLevel-<cardId>），既有訪客的資料不受影響。
// ⚠️ 登入狀態下絕不可讀寫訪客 key —— 共用電腦上那可能是「別人」的選擇
// （過去曾因此把前一位使用者的級別遷移進當前帳號）。訪客 key 只在登入當下
// 由 absorbGuestPersonalData() 統一消化。
function cardLevelLocalKey(cardId) {
    return (auth && auth.currentUser)
        ? `cardLevel_${auth.currentUser.uid}_${cardId}`
        : `cardLevel-${cardId}`;
}

async function getCardLevelUncached(cardId, defaultLevel) {
    // If user not logged in, use localStorage
    if (!auth || !auth.currentUser) {
        return localStorage.getItem(cardLevelLocalKey(cardId)) || defaultLevel;
    }

    try {
        const docRef = window.doc ? window.doc(db, 'cardSettings', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');

        const docSnap = await window.getDoc(docRef);

        if (docSnap.exists()) {
            const level = docSnap.data().level || defaultLevel;
            // 更新本機鏡像，離線時 fallback 用
            try { localStorage.setItem(cardLevelLocalKey(cardId), level); } catch (e) {}
            return level;
        } else {
            // 雲端沒有：檢查「自己的」本機鏡像（例如之前離線時儲存的），有則補上傳
            const localLevel = localStorage.getItem(cardLevelLocalKey(cardId));
            if (localLevel && localLevel !== defaultLevel) {
                console.log(`Migrating level for ${cardId} from local mirror to Firestore: ${localLevel}`);
                await saveCardLevel(cardId, localLevel);
                return localLevel;
            }
            return defaultLevel;
        }
    } catch (error) {
        console.log('Failed to load card level from Firestore:', error);
        // Fallback to本機鏡像（uid 區分，不會讀到別人的資料）
        return localStorage.getItem(cardLevelLocalKey(cardId)) || defaultLevel;
    }
}

// Save user's birthday month to Firestore and update pre-computed flag
async function saveBirthdayMonth(month) {
    userBirthdayMonth = month;
    isBirthdayMonth = month !== null && month === (new Date().getMonth() + 1);

    if (!auth || !auth.currentUser || !window.db || !window.doc || !window.setDoc) return;

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { birthdayMonth: month, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Birthday month saved: ${month}`);
    } catch (error) {
        console.error('Failed to save birthday month:', error);
    }
}

// Save user's CUBE card issuer (Visa/Mastercard/JCB) to Firestore + localStorage and update global flag
async function saveCubeIssuer(issuer) {
    cubeIssuer = issuer;
    try { localStorage.setItem('cubeIssuer', issuer); } catch (e) {}

    if (!auth || !auth.currentUser || !window.db || !window.doc || !window.setDoc) return;

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { cubeIssuer: issuer, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Cube issuer saved: ${issuer}`);
    } catch (error) {
        console.error('Failed to save cube issuer:', error);
    }
}

// Save user's children eligibility to Firestore and update global flag
async function saveChildrenEligible(eligible) {
    isChildrenEligible = eligible;

    if (!auth || !auth.currentUser || !window.db || !window.doc || !window.setDoc) return;

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { isChildrenEligible: eligible, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Children eligibility saved: ${eligible}`);
    } catch (error) {
        console.error('Failed to save children eligibility:', error);
    }
}

// Save card level to Firestore (with localStorage backup)
async function saveCardLevel(cardId, level) {
    if (!cardId || !level) return;

    // Write-through to the in-memory cache so subsequent reads see the new value.
    cardLevelCache.set(cardLevelCacheKey(cardId), level);

    // Always save to localStorage as backup（登入者用 uid 區分的 key，見 cardLevelLocalKey）
    try { localStorage.setItem(cardLevelLocalKey(cardId), level); } catch (e) {}

    // If user not logged in, only save locally
    if (!auth || !auth.currentUser) {
        console.log(`Card level saved locally for ${cardId}: ${level}`);
        return;
    }

    try {
        const docRef = window.doc ? window.doc(db, 'cardSettings', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');

        await window.setDoc(docRef, {
            level: level,
            updatedAt: new Date(),
            cardId: cardId
        });

        console.log(`Card level synced to Firestore for ${cardId}: ${level}`);
    } catch (error) {
        console.error('Failed to save card level to Firestore:', error);
    }
}

// Resolve a hasLevels card's current level + settings, falling back to
// defaultLevel WITHOUT overwriting the user's stored choice when the saved
// level isn't currently present in card.levelSettings.
//
// Why we do NOT re-save the fallback: a saved level can fail to match for a
// TRANSIENT reason — e.g. the moment after cards.data is updated, or a briefly
// malformed export — not only a permanent rename. Persisting the default in
// that window would erase a logged-in user's real choice (Level 2 → Level 1)
// for good, even after the data is corrected. So we fall back to the default
// for THIS render only and leave the stored preference untouched; once the
// card's data contains the saved level again, it resolves correctly on its own.
//
// Returns { level, data } — level is always a valid key into levelSettings,
// data is always defined (never crashes downstream on `.rate`/`.cap` access).
async function resolveCardLevel(card, defaultLevel) {
    const savedLevel = await getCardLevel(card.id, defaultLevel);
    const savedData = card.levelSettings[savedLevel];
    if (savedData) {
        return { level: savedLevel, data: savedData };
    }
    // Saved level not found in current data — render with the default but do
    // NOT persist it, so the user's stored preference survives the mismatch.
    console.warn(`⚠️ ${card.name}: 保存的級別 "${savedLevel}" 目前不在資料中，暫時顯示預設級別 "${defaultLevel}"（不覆蓋已儲存的選擇）`);
    return { level: defaultLevel, data: card.levelSettings[defaultLevel] };
}

// ========== Payment Management Functions ==========

// Open manage payments modal
function openMyPaymentsModal() {
    const modal = document.getElementById('my-payments-modal');
    if (!modal) return;

    populatePaymentChips();

    modal.style.display = 'flex';
    disableBodyScroll();

    const closeBtn = document.getElementById('close-my-payments-modal');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };
    window.closeMyPaymentsModal = closeModal;

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

function openManagePaymentsModal() {
    const modal = document.getElementById('manage-payments-modal');
    const paymentsSelection = document.getElementById('payments-selection');
    const saveBtn = document.getElementById('save-payments-btn');
    const toggleAllBtn = document.getElementById('toggle-all-payments');

    const isLoggedIn = currentUser !== null;

    paymentsSelection.innerHTML = '';

    paymentsData.payments.forEach(payment => {
        const isSelected = userSelectedPayments.has(payment.id);

        const paymentDiv = document.createElement('div');
        paymentDiv.className = `card-checkbox ${isSelected ? 'selected' : ''}`;

        paymentDiv.innerHTML = `
            <input type="checkbox" id="payment-${payment.id}" value="${payment.id}" ${isSelected ? 'checked' : ''}>
            <label for="payment-${payment.id}" class="card-checkbox-label">${payment.name}</label>
        `;

        const checkbox = paymentDiv.querySelector('input');
        checkbox.addEventListener('change', () => {
            paymentDiv.classList.toggle('selected', checkbox.checked);
        });

        paymentsSelection.appendChild(paymentDiv);
    });

    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
    saveBtn.style.cursor = 'pointer';
    toggleAllBtn.disabled = false;
    toggleAllBtn.style.opacity = '1';

    // Toggle all payments
    let allSelected = userSelectedPayments.size === paymentsData.payments.length;
    toggleAllBtn.textContent = allSelected ? '取消全選' : '全選';
    toggleAllBtn.onclick = () => {
        allSelected = !allSelected;
        const checkboxes = paymentsSelection.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = allSelected;
            cb.closest('.card-checkbox').classList.toggle('selected', allSelected);
        });
        toggleAllBtn.textContent = allSelected ? '取消全選' : '全選';
    };

    // Setup modal controls
    const closeBtn = document.getElementById('close-payments-modal');
    const cancelBtn = document.getElementById('cancel-payments-btn');

    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    saveBtn.onclick = async () => {
        const checkboxes = paymentsSelection.querySelectorAll('input[type="checkbox"]:checked');
        const selectedPayments = Array.from(checkboxes).map(cb => cb.value);

        userSelectedPayments = new Set(selectedPayments);

        // Save to both localStorage and Firestore
        await saveUserPayments();

        populatePaymentChips();
        closeModal();
    };

    // Setup search functionality
    const searchInput = document.getElementById('search-payments-input');
    searchInput.value = ''; // Clear search on open
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const paymentDivs = paymentsSelection.querySelectorAll('.card-checkbox');

        paymentDivs.forEach(paymentDiv => {
            const label = paymentDiv.querySelector('.card-checkbox-label');
            if (label) {
                const paymentName = label.textContent.toLowerCase();
                if (paymentName.includes(searchTerm)) {
                    paymentDiv.style.display = 'flex';
                } else {
                    paymentDiv.style.display = 'none';
                }
            }
        });
    });

    modal.style.display = 'flex';
    disableBodyScroll();
}

// Show payment detail modal
async function showPaymentDetail(paymentId) {
    console.log('🔍 showPaymentDetail 被調用:', paymentId);
    const payment = paymentsData.payments.find(p => p.id === paymentId);
    if (!payment) {
        console.error('❌ 找不到 payment:', paymentId);
        return;
    }
    console.log('✅ 找到 payment:', payment.name);

    const modal = document.getElementById('payment-detail-modal');
    const title = document.getElementById('payment-detail-title');
    const websiteLink = document.getElementById('payment-website-link');
    const detailsContainer = document.getElementById('payment-cashback-details');

    title.textContent = payment.name;

    // Set website link
    if (payment.website) {
        websiteLink.href = payment.website;
        websiteLink.textContent = '點此查看官方網站';
        websiteLink.style.display = 'inline';
    } else {
        websiteLink.textContent = '（待更新）';
        websiteLink.removeAttribute('href');
        websiteLink.style.display = 'inline';
    }

    // Get matching cards for this payment
    const cardsToCheck = getCardsForComparison();

    let matchingCards = [];

    // Search for matches using all payment search terms
    console.log(`🔎 搜尋 ${payment.name} 的匹配卡片...`);
    console.log('searchTerms:', payment.searchTerms);
    console.log('cardsToCheck 數量:', cardsToCheck.length);

    for (const term of payment.searchTerms) {
        const matches = findMatchingItem(term);
        console.log(`  term "${term}" 找到 ${matches ? matches.length : 0} 個匹配`);
        if (matches && matches.length > 0) {
            // For each matched item, calculate cashback for all cards
            for (const card of cardsToCheck) {
                const results = await calculateCardCashback(card, term, 1000); // Use 1000 as dummy amount
                // calculateCardCashback now returns an array of all matching activities
                for (const result of results) {
                    if (result.rate > 0) {
                        console.log(`    ✅ ${card.name}: ${result.rate}%`);
                        matchingCards.push({
                            card: card,
                            rate: result.rate,
                            cap: result.cap,
                            rateGroup: null // Not needed for display
                        });
                    }
                }
            }
        }
    }

    // Remove duplicates - keep highest rate per card
    const cardMap = new Map();
    matchingCards.forEach(mc => {
        if (!cardMap.has(mc.card.id) || cardMap.get(mc.card.id).rate < mc.rate) {
            cardMap.set(mc.card.id, mc);
        }
    });

    const uniqueCards = Array.from(cardMap.values());

    // Sort by rate descending
    uniqueCards.sort((a, b) => b.rate - a.rate);

    // Display matching cards
    detailsContainer.innerHTML = '';
    
    if (uniqueCards.length === 0) {
        detailsContainer.innerHTML = '<p style="text-align: center; color: #666;">目前沒有信用卡認列此支付方式</p>';
    } else {
        const maxRate = uniqueCards[0].rate;

        uniqueCards.forEach((mc, index) => {
            const cardDiv = document.createElement('div');
            const isBest = index === 0 && maxRate > 0;
            cardDiv.className = `cashback-detail-item ${isBest ? 'best-cashback' : ''}`;

            let capText = mc.cap ? `NT$${Math.floor(mc.cap).toLocaleString()}` : '無上限';
            let periodText = mc.rateGroup?.period ? `<div class="cashback-condition">活動期間: ${mc.rateGroup.period}</div>` : '';
            let conditionsText = mc.rateGroup?.conditions ? `<div class="cashback-condition">條件: ${mc.rateGroup.conditions}</div>` : '';
            let bestBadge = isBest ? '<div class="best-badge">最優回饋</div>' : '';

            cardDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="color: #1f2937; font-weight: 600; font-size: 15px;">${mc.card.name}</span>
                        ${bestBadge}
                    </div>
                    <span style="color: #059669; font-weight: 700; font-size: 1.15rem;">${mc.rate}%</span>
                </div>
                <div class="cashback-condition">消費上限: ${capText}</div>
                ${periodText}
                ${conditionsText}
            `;
            detailsContainer.appendChild(cardDiv);
        });
    }

    // Setup close events
    const closeBtn = document.getElementById('close-payment-detail');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    modal.style.display = 'flex';
    disableBodyScroll();
}

// Show compare payments modal
async function showComparePaymentsModal() {
    console.log('📊 showComparePaymentsModal 被調用');
    const modal = document.getElementById('compare-payments-modal');
    const contentContainer = document.getElementById('compare-payments-content');

    if (!modal || !contentContainer) {
        console.error('❌ Modal 元素未找到');
        return;
    }

    // Show modal first (for better UX)
    modal.style.display = 'flex';
    disableBodyScroll();

    const paymentsToCompare = currentUser ?
        paymentsData.payments.filter(p => userSelectedPayments.has(p.id)) :
        paymentsData.payments;

    if (paymentsToCompare.length === 0) {
        contentContainer.innerHTML = '<p style="text-align: center; color: #666;">請先選擇要比較的行動支付</p>';
    } else {
        // Show loading state
        contentContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; gap: 16px;">
                <div class="loading-spinner-large"></div>
                <div style="color: #6b7280; font-size: 0.95rem;">正在計算所有行動支付回饋...</div>
            </div>
        `;

        // Wrap calculation in try-catch and use setTimeout to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 50));

        const startTime = performance.now();
        let paymentsWithCards = [];

        for (const payment of paymentsToCompare) {
            const cardsToCheck = getCardsForComparison();

            let matchingCards = [];

            // Search for matches using all payment search terms
            for (const term of payment.searchTerms) {
                const matches = findMatchingItem(term);
                if (matches && matches.length > 0) {
                    // For each matched item, calculate cashback for all cards
                    for (const card of cardsToCheck) {
                        const results = await calculateCardCashback(card, term, 1000); // Use 1000 as dummy amount
                        // calculateCardCashback now returns an array of all matching activities
                        for (const result of results) {
                            if (result.rate > 0) {
                                matchingCards.push({
                                    card: card,
                                    rate: result.rate,
                                    cap: result.cap,
                                    rateGroup: null
                                });
                            }
                        }
                    }
                }
            }

            // Remove duplicates - keep highest rate per card
            const cardMap = new Map();
            matchingCards.forEach(mc => {
                if (!cardMap.has(mc.card.id) || cardMap.get(mc.card.id).rate < mc.rate) {
                    cardMap.set(mc.card.id, mc);
                }
            });

            const uniqueCards = Array.from(cardMap.values());

            uniqueCards.sort((a, b) => b.rate - a.rate);

            // Only keep top 2
            const top2 = uniqueCards.slice(0, 2);

            if (top2.length > 0) {
                paymentsWithCards.push({
                    payment: payment,
                    cards: top2
                });
            }
        }

        // Sort payments by highest rate
        paymentsWithCards.sort((a, b) => b.cards[0].rate - a.cards[0].rate);

        // Display compact comparison with 2-column grid
        contentContainer.innerHTML = '';

        if (paymentsWithCards.length === 0) {
            contentContainer.innerHTML = '<p style="text-align: center; color: #666;">目前沒有信用卡認列已選的行動支付</p>';
        } else {
            // Create grid container
            const gridContainer = document.createElement('div');
            gridContainer.className = 'compare-payments-grid';

            paymentsWithCards.forEach(pwc => {
                const paymentCard = document.createElement('div');
                paymentCard.className = 'compare-payment-card';

                let cardsHTML = '';
                pwc.cards.forEach((mc, index) => {
                    const isBest = index === 0;
                    let capText = mc.cap ? `NT$${Math.floor(mc.cap).toLocaleString()}` : '無上限';
                    let bestBadge = isBest ? '<div class="best-badge">最優回饋</div>' : '';

                    cardsHTML += `
                        <div class="cashback-detail-item ${isBest ? 'best-cashback' : ''}" style="margin-top: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="color: #1f2937; font-weight: 600; font-size: 15px;">${mc.card.name}</span>
                                    ${bestBadge}
                                </div>
                                <span style="color: #059669; font-weight: 700; font-size: 1.15rem;">${mc.rate}%</span>
                            </div>
                            <div class="cashback-condition">消費上限: ${capText}</div>
                        </div>
                    `;
                });

                paymentCard.innerHTML = `
                    <div class="compare-payment-name">
                        ${pwc.payment.name}
                    </div>
                    ${cardsHTML}
                `;

                gridContainer.appendChild(paymentCard);
            });

            contentContainer.appendChild(gridContainer);
        }

        // Log performance
        const duration = performance.now() - startTime;
        console.log(`⏱️ 行動支付比較完成 - 耗時: ${duration.toFixed(2)}ms (${(duration / 1000).toFixed(2)}s)`);
        console.log(`📊 比較了 ${paymentsToCompare.length} 個行動支付，找到 ${paymentsWithCards.length} 個有回饋`);
    }

    // Setup close events
    const closeBtn = document.getElementById('close-compare-payments');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// Load user payments
// Load user's selected payments from Firestore (with localStorage fallback)
// Now accepts optional userData parameter to avoid redundant Firestore calls
async function loadUserPayments(userData = null) {
    if (!currentUser) {
        // Guest: load from localStorage
        const saved = readLocalJSON('selectedPayments_guest', null);
        userSelectedPayments = Array.isArray(saved) ? new Set(saved) : new Set();
        console.log('📦 Loaded user payments (guest):', Array.from(userSelectedPayments));
        return;
    }

    try {
        // Use provided userData if available (from unified load)
        let cloudPayments = null;
        if (userData && Array.isArray(userData.selectedPayments)) {
            cloudPayments = userData.selectedPayments;
        } else if (!userData && window.db && window.doc && window.getDoc) {
            // Fallback: Try to load from Firestore if userData not provided
            const docRef = window.doc(window.db, 'users', currentUser.uid);
            const docSnap = await window.getDoc(docRef);
            if (docSnap.exists() && Array.isArray(docSnap.data().selectedPayments)) {
                cloudPayments = docSnap.data().selectedPayments;
            }
        }

        if (cloudPayments !== null) {
            // 雲端有設定 → 雲端為準；移除訪客殘留 key
            userSelectedPayments = new Set(cloudPayments);
            console.log('✅ Loaded user payments from cloud:', Array.from(userSelectedPayments));
            localStorage.setItem(`selectedPayments_${currentUser.uid}`, JSON.stringify(cloudPayments));
            localStorage.removeItem('selectedPayments_guest');
            return;
        }

        // 雲端沒有設定：若訪客期間有儲存過選擇 → 靜默帶入並上傳（不彈窗）
        const guestPayments = readLocalJSON('selectedPayments_guest', null);
        if (guestPayments !== null) localStorage.removeItem('selectedPayments_guest');
        if (Array.isArray(guestPayments) && guestPayments.length > 0) {
            userSelectedPayments = new Set(guestPayments);
            console.log('🔀 雲端無設定，帶入訪客的行動支付選擇:', guestPayments);
            await saveUserPayments();
            return;
        }

        // Fallback to localStorage if Firestore fails or no data
        const savedPayments = readLocalJSON(`selectedPayments_${currentUser.uid}`, null);

        if (Array.isArray(savedPayments)) {
            userSelectedPayments = new Set(savedPayments);
            console.log('📦 Loaded user payments from localStorage (fallback):', Array.from(userSelectedPayments));
        } else {
            // First time user - no payments selected by default
            console.log('🆕 First time user, no payments selected');
            userSelectedPayments = new Set();
            saveUserPayments();
        }
    } catch (error) {
        console.error('❌ Error loading user payments:', error);
        userSelectedPayments = new Set();
    }
}

// Save user payments
async function saveUserPayments() {
    if (!currentUser) {
        try {
            const paymentsArray = Array.from(userSelectedPayments);
            localStorage.setItem('selectedPayments_guest', JSON.stringify(paymentsArray));
            console.log('✅ Saved guest payments to localStorage:', paymentsArray);
        } catch (e) {
            console.error('Error saving guest payments to localStorage:', e);
        }
        return;
    }

    try {
        const storageKey = `selectedPayments_${currentUser.uid}`;
        const paymentsArray = Array.from(userSelectedPayments);
        localStorage.setItem(storageKey, JSON.stringify(paymentsArray));
        console.log('Saved user payments to localStorage');

        // Also save to Firestore if available
        if (window.db && window.doc && window.setDoc) {
            try {
                await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                    selectedPayments: paymentsArray,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                console.log('✅ Payments saved to Firestore');
            } catch (firestoreError) {
                console.error('❌ Error saving payments to Firestore:', firestoreError);
            }
        }
    } catch (error) {
        console.error('Error saving user payments to localStorage:', error);
    }
}

// ============================================
// Quick Search Options Management
// ============================================

// Temporary state for managing quick options in modal
let tempSelectedOptions = [];
let tempCustomOptions = [];

function openManageQuickOptionsModal() {
    const modal = document.getElementById('manage-quick-options-modal');

    if (!modal) {
        console.error('Quick options modal not found');
        return;
    }

    // Initialize temporary state with current options
    tempSelectedOptions = JSON.parse(JSON.stringify(quickSearchOptions));
    loadUserQuickSearchPrefs().then(prefs => {
        tempCustomOptions = JSON.parse(JSON.stringify(prefs.customQuickOptions || []));
        renderQuickOptionsModal();
    });

    // Setup modal buttons
    setupQuickOptionsModalButtons();

    // Show modal
    modal.style.display = 'flex';
    disableBodyScroll();
}

function renderQuickOptionsModal() {
    renderSelectedTags();
    renderAvailableTags();
    renderCustomOptionsList();
}

function renderSelectedTags() {
    const container = document.getElementById('selected-tags-container');
    if (!container) return;

    container.innerHTML = '';

    tempSelectedOptions.forEach((option, index) => {
        const tag = createTagElement(option, 'selected', index);
        container.appendChild(tag);
    });
}

function renderAvailableTags() {
    const container = document.getElementById('available-tags-container');
    if (!container) return;

    container.innerHTML = '';

    // Get all available options (default + custom)
    const defaultOptions = getDefaultQuickSearchOptions();
    const allOptions = [...defaultOptions, ...tempCustomOptions];

    // Filter out already selected options
    const selectedIds = tempSelectedOptions.map(opt => opt.id || opt.displayName);
    const availableOptions = allOptions.filter(opt => !selectedIds.includes(opt.id || opt.displayName));

    availableOptions.forEach((option) => {
        const tag = createTagElement(option, 'available');
        container.appendChild(tag);
    });
}

function createTagElement(option, type, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tag-wrapper';

    const tag = document.createElement('div');
    tag.className = 'tag-item';
    tag.dataset.optionId = option.id || option.displayName;
    tag.dataset.isCustom = option.isCustom ? 'true' : 'false';

    // Icon HTML
    const iconHtml = option.icon ? `<span class="tag-icon">${option.icon}</span>` : '';

    // Expand button (only when merchants exist)
    const hasMerchants = Array.isArray(option.merchants) && option.merchants.length > 1;

    if (type === 'selected') {
        tag.draggable = true;
        tag.dataset.index = index;
        tag.innerHTML = `
            ${iconHtml}
            <span class="tag-name">${option.displayName}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
            <button class="tag-remove-btn" title="移除">×</button>
        `;

        // Remove button
        const removeBtn = tag.querySelector('.tag-remove-btn');
        const handleRemove = (e) => {
            e.stopPropagation();
            e.preventDefault();
            removeOption(option);
        };
        removeBtn.addEventListener('click', handleRemove);
        removeBtn.addEventListener('touchend', handleRemove);

        // Drag and drop for reordering
        tag.addEventListener('dragstart', handleDragStart);
        tag.addEventListener('dragend', handleDragEnd);
        tag.addEventListener('dragover', handleDragOver);
        tag.addEventListener('drop', handleDrop);

        // Touch events for mobile drag and drop
        tag.addEventListener('touchstart', handleTouchStart, { passive: false });
        tag.addEventListener('touchmove', handleTouchMove, { passive: false });
        tag.addEventListener('touchend', handleTouchEnd);
    } else {
        // Available tag with add button
        tag.innerHTML = `
            <button class="tag-add-btn" title="新增">+</button>
            ${iconHtml}
            <span class="tag-name">${option.displayName}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
        `;

        const addBtn = tag.querySelector('.tag-add-btn');
        const handleAdd = (e) => {
            e.stopPropagation();
            e.preventDefault();
            addOption(option);
        };
        addBtn.addEventListener('click', handleAdd);
        addBtn.addEventListener('touchend', handleAdd);
    }

    wrapper.appendChild(tag);

    // Merchants panel (collapsed by default)
    if (hasMerchants) {
        const panel = document.createElement('div');
        panel.className = 'tag-merchants-panel';
        panel.textContent = option.merchants.join('、');
        wrapper.appendChild(panel);

        const expandBtn = tag.querySelector('.tag-expand-btn');
        const toggle = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const isOpen = panel.classList.contains('open');
            panel.classList.toggle('open', !isOpen);
            expandBtn.classList.toggle('expanded', !isOpen);
        };
        expandBtn.addEventListener('click', toggle);
        expandBtn.addEventListener('touchend', toggle);
    }

    return wrapper;
}

function addOption(option) {
    tempSelectedOptions.push(option);
    renderQuickOptionsModal();
}

function removeOption(option) {
    const optionId = option.id || option.displayName;
    tempSelectedOptions = tempSelectedOptions.filter(opt => (opt.id || opt.displayName) !== optionId);
    renderQuickOptionsModal();
}

// Drag and drop handlers
let draggedElement = null;
let touchDraggedElement = null;
let touchStartY = 0;
let touchStartX = 0;

function handleDragStart(e) {
    draggedElement = e.target;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    const dropTarget = e.target.closest?.('.tag-item') || e.target;
    if (draggedElement !== dropTarget && dropTarget.classList.contains('tag-item')) {
        const fromIndex = parseInt(draggedElement.dataset.index);
        const toIndex = parseInt(dropTarget.dataset.index);

        if (!isNaN(fromIndex) && !isNaN(toIndex)) {
            // Reorder array
            const item = tempSelectedOptions.splice(fromIndex, 1)[0];
            tempSelectedOptions.splice(toIndex, 0, item);
            renderQuickOptionsModal();
        }
    }

    return false;
}

// Touch event handlers for mobile drag and drop
function handleTouchStart(e) {
    // Don't interfere with button clicks
    if (e.target.classList.contains('tag-remove-btn') ||
        e.target.classList.contains('tag-add-btn') ||
        e.target.classList.contains('tag-expand-btn')) {
        return;
    }

    touchDraggedElement = e.target.closest('.tag-item');
    if (!touchDraggedElement) return;

    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;

    touchDraggedElement.classList.add('dragging');

    // Prevent default to avoid scrolling while dragging
    e.preventDefault();
}

function handleTouchMove(e) {
    if (!touchDraggedElement) return;

    e.preventDefault();

    const touch = e.touches[0];
    const currentX = touch.clientX;
    const currentY = touch.clientY;

    // Find the element under the touch point
    const elementBelow = document.elementFromPoint(currentX, currentY);
    const targetTag = elementBelow?.closest('.tag-item');

    if (targetTag && targetTag !== touchDraggedElement && targetTag.classList.contains('tag-item')) {
        const fromIndex = parseInt(touchDraggedElement.dataset.index);
        const toIndex = parseInt(targetTag.dataset.index);

        if (!isNaN(fromIndex) && !isNaN(toIndex) && fromIndex !== toIndex) {
            // Reorder array
            const item = tempSelectedOptions.splice(fromIndex, 1)[0];
            tempSelectedOptions.splice(toIndex, 0, item);
            renderQuickOptionsModal();

            // Update the dragged element reference
            const newTags = document.querySelectorAll('.selected-tags-container .tag-item');
            touchDraggedElement = newTags[toIndex];
            if (touchDraggedElement) {
                touchDraggedElement.classList.add('dragging');
            }
        }
    }
}

function handleTouchEnd(e) {
    if (touchDraggedElement) {
        touchDraggedElement.classList.remove('dragging');
        touchDraggedElement = null;
    }
}

function setupQuickOptionsModalButtons() {
    const modal = document.getElementById('manage-quick-options-modal');
    const closeBtn = document.getElementById('close-quick-options-modal');
    const cancelBtn = document.getElementById('cancel-quick-options-btn');
    const saveBtn = document.getElementById('save-quick-options-btn');
    const resetBtn = document.getElementById('reset-quick-options-btn');
    const clearAllBtn = document.getElementById('clear-all-quick-options-btn');
    const addCustomBtn = document.getElementById('add-custom-option-btn');

    if (closeBtn) {
        closeBtn.onclick = () => {
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (saveBtn) {
        saveBtn.onclick = async () => {
            await saveQuickOptionsSelection();
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            resetQuickOptionsToDefault();
        };
    }

    if (clearAllBtn) {
        clearAllBtn.onclick = () => {
            clearAllQuickOptions();
        };
    }

    if (addCustomBtn) {
        addCustomBtn.onclick = () => {
            showCustomOptionForm();
        };
    }

    // Custom option form buttons
    setupCustomOptionFormButtons();
}

async function saveQuickOptionsSelection() {
    // Compute new prefs from current modal state
    const defaultOptions = getDefaultQuickSearchOptions();
    const defaultIds = new Set(defaultOptions.map(o => o.id));
    const selectedDefaultIds = new Set(
        tempSelectedOptions.filter(o => defaultIds.has(o.id)).map(o => o.id)
    );

    // Defaults NOT in user's selected list = hidden
    const hiddenDefaultIds = defaultOptions
        .map(o => o.id)
        .filter(id => !selectedDefaultIds.has(id));

    // User's custom options (from tempCustomOptions, the source of truth for customs)
    const customQuickOptions = tempCustomOptions;

    // Preserve user's ordering
    const selectedOrder = tempSelectedOptions.map(o => o.id).filter(Boolean);

    const prefs = { hiddenDefaultIds, customQuickOptions, selectedOrder };
    const saved = await saveUserQuickSearchPrefs(prefs);

    if (saved) {
        // Reload quickSearchOptions from new prefs (which pulls fresh defaults from cards.json)
        await initializeQuickSearchOptions();
        renderQuickSearchButtons();
        console.log('✅ 快捷選項已更新');
    } else {
        console.error('❌ 保存快捷選項失敗');
        alert('保存失敗，請稍後再試');
    }
}

function renderCustomOptionsList() {
    const container = document.getElementById('custom-options-list');
    if (!container) return;

    container.innerHTML = '';

    if (tempCustomOptions.length === 0) {
        return;
    }

    tempCustomOptions.forEach((option) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-option-wrapper';

        const item = document.createElement('div');
        item.className = 'custom-option-item';

        // 構建icon HTML（如果有的話）
        const iconHtml = option.icon ? `<span class="tag-icon">${option.icon}</span>` : '';
        const hasMerchants = Array.isArray(option.merchants) && option.merchants.length > 1;

        item.innerHTML = `
            ${iconHtml}
            <span class="tag-name">${option.displayName}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
            <button class="custom-option-delete" title="刪除">×</button>
        `;

        const deleteBtn = item.querySelector('.custom-option-delete');
        deleteBtn.onclick = () => { deleteCustomOption(option); };

        wrapper.appendChild(item);

        if (hasMerchants) {
            const panel = document.createElement('div');
            panel.className = 'tag-merchants-panel';
            panel.textContent = option.merchants.join('、');
            wrapper.appendChild(panel);

            const expandBtn = item.querySelector('.tag-expand-btn');
            const toggle = (e) => {
                e.stopPropagation();
                e.preventDefault();
                panel.classList.toggle('open');
                expandBtn.classList.toggle('expanded');
            };
            expandBtn.addEventListener('click', toggle);
            expandBtn.addEventListener('touchend', toggle);
        }

        container.appendChild(wrapper);
    });
}

// Emoji選擇器相關變數
let selectedEmoji = '';
const commonEmojis = ['🏪', '🏬', '🛒', '🍔', '☕', '🍕', '🎬', '✈️', '🚗', '⛽', '🏨', '🎮', '📱', '💻', '👕', '👟', '📚', '💊', '🏥', '🎵', '🎨', '⚽', '🎾', '🏃'];

function showCustomOptionForm() {
    const form = document.getElementById('custom-option-form');
    const addBtn = document.getElementById('add-custom-option-btn');

    if (form && addBtn) {
        form.style.display = 'block';
        addBtn.style.display = 'none';

        // Clear form
        document.getElementById('custom-display-name').value = '';

        // Reset emoji picker
        selectedEmoji = '';
        updateEmojiDisplay();

        // Setup emoji picker
        setupEmojiPicker();
    }
}

function setupEmojiPicker() {
    const selectedEmojiDiv = document.getElementById('selected-emoji');
    const emojiGrid = document.getElementById('emoji-grid');
    const clearBtn = document.getElementById('clear-emoji-btn');

    // Toggle emoji grid
    selectedEmojiDiv.onclick = () => {
        emojiGrid.style.display = emojiGrid.style.display === 'none' ? 'grid' : 'none';

        // Populate emoji grid if empty
        if (emojiGrid.children.length === 0) {
            commonEmojis.forEach(emoji => {
                const emojiBtn = document.createElement('div');
                emojiBtn.className = 'emoji-option';
                emojiBtn.textContent = emoji;
                emojiBtn.onclick = () => {
                    selectEmoji(emoji);
                };
                emojiGrid.appendChild(emojiBtn);
            });
        }
    };

    // Clear emoji button
    clearBtn.onclick = () => {
        selectedEmoji = '';
        updateEmojiDisplay();
    };
}

function selectEmoji(emoji) {
    selectedEmoji = emoji;
    updateEmojiDisplay();
    // Hide emoji grid after selection
    document.getElementById('emoji-grid').style.display = 'none';
}

function updateEmojiDisplay() {
    const selectedEmojiDiv = document.getElementById('selected-emoji');
    const clearBtn = document.getElementById('clear-emoji-btn');

    if (selectedEmoji) {
        selectedEmojiDiv.innerHTML = selectedEmoji;
        clearBtn.style.display = 'block';
    } else {
        selectedEmojiDiv.innerHTML = '<span class="emoji-placeholder">點擊選擇emoji</span>';
        clearBtn.style.display = 'none';
    }
}

function hideCustomOptionForm() {
    const form = document.getElementById('custom-option-form');
    const addBtn = document.getElementById('add-custom-option-btn');
    const emojiGrid = document.getElementById('emoji-grid');

    if (form && addBtn) {
        form.style.display = 'none';
        addBtn.style.display = 'block';
        // Hide emoji grid
        if (emojiGrid) {
            emojiGrid.style.display = 'none';
        }
    }
}

function setupCustomOptionFormButtons() {
    const saveBtn = document.getElementById('save-custom-option-btn');
    const cancelBtn = document.getElementById('cancel-custom-option-btn');

    if (saveBtn) {
        saveBtn.onclick = () => {
            saveCustomOption();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCustomOptionForm();
        };
    }
}

function saveCustomOption() {
    const displayName = document.getElementById('custom-display-name').value.trim();

    // Validation
    if (!displayName) {
        alert('請輸入顯示名稱');
        return;
    }

    // Create new custom option - use displayName as the search keyword
    const newOption = {
        id: `custom-${Date.now()}`,
        displayName: displayName,
        icon: selectedEmoji || '', // 使用選擇的emoji，沒選就留空
        merchants: [displayName], // Use display name as the only search keyword
        isCustom: true
    };

    // Add to custom options
    tempCustomOptions.push(newOption);

    // Re-render
    renderQuickOptionsModal();
    hideCustomOptionForm();
}

function deleteCustomOption(option) {
    if (!confirm(`確定要刪除「${option.displayName}」嗎？`)) {
        return;
    }

    const optionId = option.id || option.displayName;

    // Remove from custom options
    tempCustomOptions = tempCustomOptions.filter(opt => (opt.id || opt.displayName) !== optionId);

    // Remove from selected if present
    tempSelectedOptions = tempSelectedOptions.filter(opt => (opt.id || opt.displayName) !== optionId);

    // Re-render
    renderQuickOptionsModal();
}

function clearAllQuickOptions() {
    // Move all selected options back to available
    tempSelectedOptions = [];

    // Re-render the modal to reflect changes
    renderQuickOptionsModal();

    console.log('✅ 已移除所有已選擇的快捷選項');
}

function resetQuickOptionsToDefault() {
    const defaultOptions = getDefaultQuickSearchOptions();

    // Reset temp selected options to default
    tempSelectedOptions = [...defaultOptions];

    // Clear temp custom options
    tempCustomOptions = [];

    // Re-render the modal to reflect changes
    renderQuickOptionsModal();

    console.log('✅ 已恢復為預設快捷選項（需儲存才會生效）');
}

// ============================================
// Feedback System
// ============================================

// Initialize feedback system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // State
    let selectedImages = [];
    const MAX_IMAGES = 5;
    const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

    // DOM Elements
    const feedbackBtn = document.getElementById('feedback-btn');
    const feedbackModal = document.getElementById('feedback-modal');
    const closeFeedbackModal = document.getElementById('close-feedback-modal');
    const cancelFeedbackBtn = document.getElementById('cancel-feedback-btn');
    const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
    const feedbackForm = document.getElementById('feedback-form');
    const feedbackMessage = document.getElementById('feedback-message');
    const feedbackImages = document.getElementById('feedback-images');
    const imageUploadArea = document.getElementById('image-upload-area');
    const uploadPlaceholder = document.getElementById('upload-placeholder');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const feedbackStatus = document.getElementById('feedback-status');

    // Check if elements exist
    if (!feedbackBtn || !feedbackModal) {
        console.warn('Feedback elements not found');
        return;
    }

    // Image Compression Function
    async function compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('讀取圖片失敗：' + (reader.error?.message || 'FileReader error')));
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => reject(new Error(`圖片格式不支援或檔案損毀（${file.type || 'unknown type'}）`));
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions (max 1920px)
                    const MAX_WIDTH = 1920;
                    const MAX_HEIGHT = 1920;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // canvas.toBlob with the source mime may return null when the
                    // browser can't encode that type (e.g. image/heic). Fall back
                    // to image/jpeg so the upload still succeeds.
                    const tryEncode = (mime, quality) => new Promise(res => canvas.toBlob(b => res(b), mime, quality));
                    (async () => {
                        let blob = await tryEncode(file.type, 0.85);
                        if (!blob) blob = await tryEncode('image/jpeg', 0.85);
                        if (!blob) return reject(new Error('圖片編碼失敗（canvas.toBlob 回傳 null）'));
                        resolve(blob);
                    })();
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
    
    // Open Feedback Modal
    feedbackBtn.addEventListener('click', () => {
        // Check if user is logged in
        if (!currentUser) {
            alert('請先登入才能回報問題 🔐\n\n登入後可以幫助我們更好地追蹤您的回報。');
            return;
        }

        feedbackModal.style.display = 'flex';
        disableBodyScroll();
    });

    // Close Feedback Modal
    function closeFeedbackModalHandler() {
        feedbackModal.style.display = 'none';
        enableBodyScroll();
        resetFeedbackForm();
    }
    
    closeFeedbackModal.addEventListener('click', closeFeedbackModalHandler);
    cancelFeedbackBtn.addEventListener('click', closeFeedbackModalHandler);
    
    // Close modal when clicking outside
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) {
            closeFeedbackModalHandler();
        }
    });
    
    // Reset Form
    function resetFeedbackForm() {
        feedbackForm.reset();
        selectedImages = [];
        renderImagePreviews();
        feedbackStatus.className = 'feedback-status';
        feedbackStatus.textContent = '';
    }
    
    // Image Upload - Click
    imageUploadArea.addEventListener('click', () => {
        feedbackImages.click();
    });
    
    // Image Upload - File Input Change
    feedbackImages.addEventListener('change', (e) => {
        handleImageFiles(e.target.files);
    });
    
    // Image Upload - Drag and Drop
    imageUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        imageUploadArea.classList.add('drag-over');
    });
    
    imageUploadArea.addEventListener('dragleave', () => {
        imageUploadArea.classList.remove('drag-over');
    });
    
    imageUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        imageUploadArea.classList.remove('drag-over');
        handleImageFiles(e.dataTransfer.files);
    });
    
    // Handle Image Files
    function handleImageFiles(files) {
        const fileArray = Array.from(files);
    
        // Filter valid image files
        const imageFiles = fileArray.filter(file =>
            file.type === 'image/jpeg' ||
            file.type === 'image/png' ||
            file.type === 'image/webp'
        );
    
        // Check total count
        const remainingSlots = MAX_IMAGES - selectedImages.length;
        const filesToAdd = imageFiles.slice(0, remainingSlots);
    
        if (filesToAdd.length === 0 && selectedImages.length >= MAX_IMAGES) {
            showStatus('error', `最多只能上傳 ${MAX_IMAGES} 張圖片`);
            return;
        }
    
        // Add files to selectedImages
        filesToAdd.forEach(file => {
            selectedImages.push({
                file: file,
                preview: URL.createObjectURL(file),
                size: file.size
            });
        });
    
        renderImagePreviews();
    }
    
    // Render Image Previews
    function renderImagePreviews() {
        if (selectedImages.length === 0) {
            imagePreviewContainer.innerHTML = '';
            uploadPlaceholder.style.display = 'flex';
            return;
        }
    
        uploadPlaceholder.style.display = 'none';
    
        imagePreviewContainer.innerHTML = selectedImages.map((img, index) => `
            <div class="image-preview-item">
                <img src="${img.preview}" alt="Preview ${index + 1}">
                <button type="button" class="image-preview-remove" data-index="${index}">×</button>
                ${img.size > MAX_IMAGE_SIZE ? '<div class="image-size-warning">檔案較大</div>' : ''}
            </div>
        `).join('');
    
        // Add remove handlers
        document.querySelectorAll('.image-preview-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                URL.revokeObjectURL(selectedImages[index].preview);
                selectedImages.splice(index, 1);
                renderImagePreviews();
            });
        });
    }
    
    // Show Status Message
    function showStatus(type, message) {
        feedbackStatus.className = `feedback-status ${type}`;
        feedbackStatus.textContent = message;
    }
    
    // Submit Feedback
    submitFeedbackBtn.addEventListener('click', async () => {
        const message = feedbackMessage.value.trim();

        // Validation
        if (!message) {
            showStatus('error', '請填寫問題描述');
            return;
        }

        // Double check user is logged in
        if (!currentUser) {
            showStatus('error', '請先登入才能提交回報');
            return;
        }
    
        // Disable submit button
        submitFeedbackBtn.disabled = true;
        showStatus('loading', '正在上傳...');
    
        try {
            // Upload images to Firebase Storage — each one is wrapped so a single
            // failure (e.g. Storage quota exceeded) doesn't abort the whole
            // submission. Text feedback still goes through with whatever images
            // we managed to upload.
            const imageUrls = [];
            const imageUploadErrors = [];

            if (selectedImages.length > 0) {
                for (let i = 0; i < selectedImages.length; i++) {
                    const imgData = selectedImages[i];
                    showStatus('loading', `正在上傳圖片 ${i + 1}/${selectedImages.length}...`);

                    try {
                        const compressedBlob = await compressImage(imgData.file);
                        const timestamp = Date.now();
                        const userId = currentUser?.uid || 'anonymous';
                        const filename = `feedback/${timestamp}_${userId}_${i}.jpg`;
                        const storageReference = window.storageRef(window.storage, filename);
                        await window.uploadBytes(storageReference, compressedBlob);
                        const downloadUrl = await window.getDownloadURL(storageReference);
                        imageUrls.push(downloadUrl);
                    } catch (imgError) {
                        console.warn(`圖片 ${i + 1} 上傳失敗:`, imgError);
                        imageUploadErrors.push(imgError);
                    }
                }
            }

            // Save text feedback to Firestore even if images failed
            showStatus('loading', '正在儲存...');

            const feedbackData = {
                message: message,
                userName: currentUser.displayName || 'Unknown',
                userId: currentUser.uid,
                userEmail: currentUser.email || '',
                imageUrls: imageUrls,
                timestamp: window.serverTimestamp(),
                createdAt: new Date().toISOString()
            };
            // Record image-upload failure context for triage (quota, mime, etc.)
            if (imageUploadErrors.length > 0) {
                feedbackData.imageUploadFailedCount = imageUploadErrors.length;
                feedbackData.imageUploadFirstError = (imageUploadErrors[0] && (imageUploadErrors[0].code || imageUploadErrors[0].message)) || String(imageUploadErrors[0]);
            }

            await window.addDoc(window.collection(window.db, 'feedback'), feedbackData);

            // Status reflects what actually happened with images
            const total = selectedImages.length;
            const ok = imageUrls.length;
            let successMsg;
            if (total === 0 || imageUploadErrors.length === 0) {
                successMsg = '✅ 回報已送出，感謝您的回饋！';
            } else if (ok === 0) {
                successMsg = '⚠️ 文字回報已送出（圖片暫時無法上傳，已紀錄錯誤）';
            } else {
                successMsg = `⚠️ 已送出（${ok}/${total} 張圖片成功上傳）`;
            }
            showStatus('success', successMsg);

            // Reset form after 2 seconds
            setTimeout(() => {
                closeFeedbackModalHandler();
            }, 2000);

        } catch (error) {
            // Only reached if the Firestore write itself failed — image errors are
            // now handled per-image above and don't get here.
            console.error('Error saving feedback:', error);
            const detail = (error && (error.code || error.message)) || String(error);
            showStatus('error', `❌ 送出失敗：${detail}`);
        } finally {
            submitFeedbackBtn.disabled = false;
        }
    });

}); // End of Feedback System DOMContentLoaded

// ============================================
// Auth Modal System (Login/Register with Email)
// ============================================

let authMode = 'login'; // 'login', 'register', or 'forgotPassword'

function openAuthModal(mode = 'login') {
    authMode = mode;
    const modal = document.getElementById('auth-modal');
    const modalTitle = document.getElementById('auth-modal-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const switchText = document.getElementById('auth-switch-text');
    const confirmPasswordGroup = document.getElementById('auth-confirm-password-group');
    const passwordGroup = document.querySelector('.form-group:has(#auth-password)');
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    const authError = document.getElementById('auth-error');

    // Clear form
    document.getElementById('auth-form').reset();
    authError.style.display = 'none';

    if (mode === 'register') {
        modalTitle.textContent = '註冊';
        submitBtn.textContent = '註冊';
        switchText.innerHTML = '已經有帳號？<a href="#" id="auth-switch-link">立即登入</a>';
        confirmPasswordGroup.style.display = 'block';
        passwordGroup.style.display = 'block';
        forgotPasswordLink.style.display = 'none';
    } else if (mode === 'forgotPassword') {
        modalTitle.textContent = '忘記密碼';
        submitBtn.textContent = '發送重設密碼郵件';
        switchText.innerHTML = '<a href="#" id="auth-switch-link">返回登入</a>';
        confirmPasswordGroup.style.display = 'none';
        passwordGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'none';
    } else {
        modalTitle.textContent = '登入';
        submitBtn.textContent = '登入';
        switchText.innerHTML = '還沒有帳號？<a href="#" id="auth-switch-link">立即註冊</a>';
        confirmPasswordGroup.style.display = 'none';
        passwordGroup.style.display = 'block';
        forgotPasswordLink.style.display = 'inline-block';
    }

    modal.style.display = 'flex';
    disableBodyScroll();

    // Re-attach event listener for switch link
    document.getElementById('auth-switch-link').addEventListener('click', (e) => {
        e.preventDefault();
        if (authMode === 'forgotPassword') {
            openAuthModal('login');
        } else {
            openAuthModal(authMode === 'login' ? 'register' : 'login');
        }
    });
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'none';
    enableBodyScroll();
    document.getElementById('auth-form').reset();
    document.getElementById('auth-error').style.display = 'none';
}

function showAuthError(message) {
    const authError = document.getElementById('auth-error');
    authError.textContent = message;
    authError.style.display = 'block';
}

// Initialize auth modal event listeners
document.addEventListener('DOMContentLoaded', () => {
    const closeAuthModalBtn = document.getElementById('close-auth-modal');
    const googleSignInBtn = document.getElementById('google-sign-in-btn');
    const authForm = document.getElementById('auth-form');
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    const authModal = document.getElementById('auth-modal');

    // Close modal
    if (closeAuthModalBtn) {
        closeAuthModalBtn.addEventListener('click', closeAuthModal);
    }

    // Close on backdrop click
    if (authModal) {
        authModal.addEventListener('click', (e) => {
            if (e.target === authModal) {
                closeAuthModal();
            }
        });
    }

    // Google sign in
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async () => {
            // Check if user is in an in-app browser
            if (isInAppBrowser()) {
                console.log('⚠️ Google sign-in blocked: in-app browser detected');
                closeAuthModal();
                showWebViewWarning();
                return;
            }

            try {
                const result = await window.signInWithPopup(auth, window.googleProvider);
                console.log('Google sign in successful:', result.user);
                closeAuthModal();
            } catch (error) {
                console.error('Google sign in failed:', error);
                let errorMessage = '登入失敗，請稍後再試';
                if (error.code === 'auth/popup-closed-by-user') {
                    errorMessage = '登入視窗已關閉';
                } else if (error.code === 'auth/popup-blocked') {
                    errorMessage = '彈出視窗被瀏覽器阻擋，請允許彈出視窗';
                } else if (error.code === 'auth/unauthorized-domain') {
                    errorMessage = '此網域未經授權，請聯絡管理員';
                }
                showAuthError(errorMessage);
            }
        });
    }

    // Email/Password form submission
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const confirmPassword = document.getElementById('auth-confirm-password').value;
            const submitBtn = document.getElementById('auth-submit-btn');

            // Handle forgot password mode
            if (authMode === 'forgotPassword') {
                if (!email) {
                    showAuthError('請輸入您的 Email');
                    return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = '發送中...';

                try {
                    await window.sendPasswordResetEmail(auth, email);
                    const authError = document.getElementById('auth-error');
                    authError.textContent = '✅ 密碼重設信已寄出，請檢查您的 Email';
                    authError.style.display = 'block';
                    authError.style.background = '#d4edda';
                    authError.style.color = '#155724';
                } catch (error) {
                    console.error('Password reset error:', error);
                    let errorMessage = '發送失敗，請稍後再試';

                    if (error.code === 'auth/user-not-found') {
                        errorMessage = '找不到此 Email 帳號';
                    } else if (error.code === 'auth/invalid-email') {
                        errorMessage = 'Email 格式不正確';
                    }

                    const authError = document.getElementById('auth-error');
                    authError.textContent = errorMessage;
                    authError.style.display = 'block';
                    authError.style.background = '#fce8e6';
                    authError.style.color = '#c5221f';
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '發送重設密碼郵件';
                }
                return;
            }

            // Validation for login/register
            if (!email || !password) {
                showAuthError('請填寫所有欄位');
                return;
            }

            if (password.length < 6) {
                showAuthError('密碼至少需要 6 個字元');
                return;
            }

            if (authMode === 'register' && password !== confirmPassword) {
                showAuthError('密碼不一致，請重新輸入');
                return;
            }

            // Disable submit button
            submitBtn.disabled = true;
            submitBtn.textContent = authMode === 'login' ? '登入中...' : '註冊中...';

            try {
                if (authMode === 'register') {
                    // Register
                    const result = await window.createUserWithEmailAndPassword(auth, email, password);
                    console.log('Registration successful:', result.user);
                    closeAuthModal();
                } else {
                    // Login
                    const result = await window.signInWithEmailAndPassword(auth, email, password);
                    console.log('Login successful:', result.user);
                    closeAuthModal();
                }
            } catch (error) {
                console.error('Auth error:', error);
                let errorMessage = '操作失敗，請稍後再試';

                // Handle specific error codes
                switch (error.code) {
                    case 'auth/email-already-in-use':
                        errorMessage = '此 Email 已被註冊';
                        break;
                    case 'auth/invalid-email':
                        errorMessage = 'Email 格式不正確';
                        break;
                    case 'auth/user-not-found':
                        errorMessage = '找不到此帳號';
                        break;
                    case 'auth/wrong-password':
                        errorMessage = '密碼錯誤';
                        break;
                    case 'auth/too-many-requests':
                        errorMessage = '嘗試次數過多，請稍後再試';
                        break;
                    case 'auth/weak-password':
                        errorMessage = '密碼強度不足';
                        break;
                    case 'auth/invalid-credential':
                        errorMessage = 'Email 或密碼錯誤';
                        break;
                }

                showAuthError(errorMessage);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = authMode === 'login' ? '登入' : '註冊';
            }
        });
    }

    // Forgot password link - switch to forgot password mode
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            openAuthModal('forgotPassword');
        });
    }
}); // End of Auth Modal DOMContentLoaded

// ============================================
// WebView Warning Modal Event Listeners
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const closeWebViewWarningBtn = document.getElementById('close-webview-warning');
    const openInBrowserBtn = document.getElementById('open-in-browser-btn');
    const copyUrlBtn = document.getElementById('copy-url-btn');
    const useEmailLoginBtn = document.getElementById('use-email-login-btn');
    const webviewWarningModal = document.getElementById('webview-warning-modal');

    // Close WebView warning modal
    if (closeWebViewWarningBtn) {
        closeWebViewWarningBtn.addEventListener('click', () => {
            closeWebViewWarning();
        });
    }

    // Close on backdrop click
    if (webviewWarningModal) {
        webviewWarningModal.addEventListener('click', (e) => {
            if (e.target === webviewWarningModal) {
                closeWebViewWarning();
            }
        });
    }

    // Open in browser button
    if (openInBrowserBtn) {
        openInBrowserBtn.addEventListener('click', () => {
            openInBrowser();
        });
    }

    // Copy URL button
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', () => {
            copyUrlToClipboard();
        });
    }

    // Use email login button
    if (useEmailLoginBtn) {
        useEmailLoginBtn.addEventListener('click', () => {
            closeWebViewWarning();
            openAuthModal('login');
        });
    }
}); // End of WebView Warning Modal DOMContentLoaded

// ============================================
// GA4 Button Click Tracking
// ============================================
document.addEventListener('click', function(e) {
    if (!window.logEvent || !window.firebaseAnalytics) return;
    const btn = e.target.closest(
        '.spotlight-compare-btn, .spotlight-info-btn, .card-apply-cta-btn, .promo-apply-cta-btn, .card-detail-apply-header-btn, .card-detail-apply-bar-btn'
    );
    if (!btn) return;

    let buttonType;
    if (btn.classList.contains('spotlight-compare-btn'))        buttonType = 'spotlight_compare';
    else if (btn.classList.contains('spotlight-info-btn'))      buttonType = 'spotlight_info';
    else if (btn.classList.contains('spotlight-apply-cta-btn')) buttonType = 'spotlight_apply';
    else if (btn.classList.contains('card-detail-apply-header-btn')) buttonType = 'detail_header_apply';
    else if (btn.classList.contains('card-detail-apply-bar-btn'))    buttonType = 'detail_sticky_apply';
    else if (btn.classList.contains('card-apply-cta-btn'))      buttonType = 'card_apply';
    else                                                         buttonType = 'search_result_apply';

    window.logEvent(window.firebaseAnalytics, 'button_click', {
        button_type: buttonType,
        card_id:     btn.dataset.cardId   || '',
        card_name:   btn.dataset.cardName || '',
        merchant:    btn.dataset.merchant || '',
    });
});









