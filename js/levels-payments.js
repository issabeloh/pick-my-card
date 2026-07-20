/* ============================================================
 * Pick My Card — js/levels-payments.js（載入順序 11/12）
 * ⚠️ 本檔含 saveCardLevel()——CLAUDE.md 鐵則 1（🔒 最高等級）：
 * 只有「用戶親自點選」與「大小寫/空格正規化」兩個合法呼叫場景。
 * 區塊目錄（Grep 關鍵字）：
 *  - Card Level Management     → "Card Level Management" / "getCardLevel"
 *  - 級別快取暖機              → "warmCardLevelCache"
 *  - 生日月/CUBE 發卡組織/童樂匯 → "saveBirthdayMonth" / "saveCubeIssuer" / "saveChildrenEligible"
 *  - 級別儲存（鐵則 1 🔒）      → "saveCardLevel"
 *  - 級別解析                  → "resolveCardLevel"
 *  - 行動支付管理              → "Payment Management" / "openMyPaymentsModal"
 *  - 支付詳情/比較             → "showPaymentDetail" / "showComparePaymentsModal"
 *  - 用戶支付載存              → "loadUserPayments" / "saveUserPayments"
 * ============================================================ */
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
    // 鐵則 3：動態 href 先 sanitizeUrl（不合法網址視同沒有網站）
    const paymentSite = sanitizeUrl(payment.website);
    if (paymentSite) {
        websiteLink.href = paymentSite;
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

