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
 *  - 支付清單列/名次            → "renderPaymentRow" / "renderPaymentRank"
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

// ===== 儲存結果（2026-11-17，個人設定「統一自動儲存＋常駐儲存狀態列」）=====
// 下面四個 save 函數、js/spending-mappings.js 的 saveFeeWaiverStatus／saveCreditLimit、
// js/card-detail.js 的 saveUserNotes 都回傳同一種結果物件，詳情頁的儲存狀態列（cdTrackSave）據此顯示，
// 不再是「存了沒反應」：
//   { ok: true }                        成功（訪客＝存在這台裝置；登入者＝已寫入雲端）
//   { ok: true, volatile: true }        訪客且這項設定沒有本機備份（只在這次瀏覽有效；目前只有生日月份，而訪客不能設）
//   { ok: false, reason, local }        失敗；reason 是給人看的原因，local＝失敗前是否已先存在這台裝置
// 邏輯本身（寫哪個 key、哪份文件、什麼格式）一律不變，只是把原本吞掉的結果回傳出來。
// 呼叫端不看結果也沒事（absorbGuestPersonalData 等舊呼叫端照舊）。
function describeSaveError(error) {
    const code = error && error.code ? String(error.code) : '';
    const msg = error && error.message ? String(error.message) : '';
    if (/permission-denied/.test(code)) return '沒有寫入權限（可能需要重新登入）';
    if (/unauthenticated/.test(code)) return '登入已失效（請重新登入）';
    if (/unavailable|deadline-exceeded|network/i.test(code) || /network|offline|Failed to fetch/i.test(msg)) return '網路連線不穩';
    if (/resource-exhausted/.test(code)) return '寫入太頻繁，請稍後再試';
    if (/Firestore not available/.test(msg)) return '雲端連線尚未就緒';
    return '雲端寫入失敗';
}

// Save user's birthday month to Firestore and update pre-computed flag
async function saveBirthdayMonth(month) {
    userBirthdayMonth = month;
    isBirthdayMonth = month !== null && month === (new Date().getMonth() + 1);

    // 訪客：生日月份只有登入後才能設定（詳情頁的下拉是 disabled），這裡不會有東西要存
    if (!auth || !auth.currentUser) return { ok: true, volatile: true };
    if (!window.db || !window.doc || !window.setDoc) return { ok: false, reason: '雲端連線尚未就緒', local: false };

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { birthdayMonth: month, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Birthday month saved: ${month}`);
        return { ok: true };
    } catch (error) {
        console.error('Failed to save birthday month:', error);
        return { ok: false, reason: describeSaveError(error), local: false };   // 沒有本機備份
    }
}

// Save user's CUBE card issuer (Visa/Mastercard/JCB) to Firestore + localStorage and update global flag
async function saveCubeIssuer(issuer) {
    cubeIssuer = issuer;
    let local = true;
    try { localStorage.setItem('cubeIssuer', issuer); } catch (e) { local = false; }

    if (!auth || !auth.currentUser) {
        return local ? { ok: true } : { ok: false, reason: '無法寫入這台裝置的儲存空間', local: false };
    }
    if (!window.db || !window.doc || !window.setDoc) return { ok: false, reason: '雲端連線尚未就緒', local };

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { cubeIssuer: issuer, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Cube issuer saved: ${issuer}`);
        return { ok: true };
    } catch (error) {
        console.error('Failed to save cube issuer:', error);
        return { ok: false, reason: describeSaveError(error), local };
    }
}

// Save user's children eligibility to Firestore and update global flag
async function saveChildrenEligible(eligible) {
    isChildrenEligible = eligible;

    // 訪客：存在這台裝置（2026-11-20 起；key childrenEligible_guest，只存 true/false）。登入時由
    // absorbGuestPersonalData 帶進帳號並移除，登出清理也會清（js/auth-user-data.js）。
    // ⚠️ 登入狀態下不讀寫這個訪客 key（共用電腦上那可能是別人的選擇）
    if (!auth || !auth.currentUser) {
        try {
            localStorage.setItem('childrenEligible_guest', JSON.stringify(!!eligible));
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: '這台裝置不允許網站存資料（例如無痕模式）', local: false };
        }
    }
    if (!window.db || !window.doc || !window.setDoc) return { ok: false, reason: '雲端連線尚未就緒', local: false };

    try {
        const docRef = window.doc(window.db, 'users', auth.currentUser.uid);
        await window.setDoc(docRef, { isChildrenEligible: eligible, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`Children eligibility saved: ${eligible}`);
        return { ok: true };
    } catch (error) {
        console.error('Failed to save children eligibility:', error);
        return { ok: false, reason: describeSaveError(error), local: false };
    }
}

// Save card level to Firestore (with localStorage backup)
// 回傳儲存結果（見上方「儲存結果」說明）；寫入邏輯不變。⚠️ 呼叫點的限制見檔頭（鐵則 1）
async function saveCardLevel(cardId, level) {
    if (!cardId || !level) return { ok: false, reason: '缺少資料', local: false };

    // Write-through to the in-memory cache so subsequent reads see the new value.
    cardLevelCache.set(cardLevelCacheKey(cardId), level);

    // Always save to localStorage as backup（登入者用 uid 區分的 key，見 cardLevelLocalKey）
    let local = true;
    try { localStorage.setItem(cardLevelLocalKey(cardId), level); } catch (e) { local = false; }

    // If user not logged in, only save locally
    if (!auth || !auth.currentUser) {
        console.log(`Card level saved locally for ${cardId}: ${level}`);
        return local ? { ok: true } : { ok: false, reason: '無法寫入這台裝置的儲存空間', local: false };
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
        return { ok: true };
    } catch (error) {
        console.error('Failed to save card level to Firestore:', error);
        return { ok: false, reason: describeSaveError(error), local };
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
            updateSelectionDirtyState('payments-selection');
        });

        paymentsSelection.appendChild(paymentDiv);
    });

    // 儲存列（2026-11-22，同選卡 modal）：打開當下的勾選＝比較基準，有改動才出現「已變更 N 個　取消　儲存設定」
    paymentsSelection._initialSelection = new Set(paymentsData.payments.filter(p => userSelectedPayments.has(p.id)).map(p => p.id));
    updateSelectionDirtyState('payments-selection');

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
        updateSelectionDirtyState('payments-selection');
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
    // 用 oninput 不用 addEventListener：這支每次打開都會跑，addEventListener 會一次疊一個監聽
    searchInput.oninput = (e) => {
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
    };

    modal.style.display = 'flex';
    disableBodyScroll();
}

// Show payment detail modal
// 一個行動支付 → 每張卡的最高回饋，由高到低（單一支付詳情與「比較所有行動支付回饋」共用，2026-11-02 由兩份抄本合併）。
// 走搜尋三步的「找、算」：每個 searchTerm 先 findSearchHits 拿資料裡的名字，再逐名計算（以前直接拿 searchTerm 去算）。
// 刻意只認完全一致（exactOnly）：包含式比對會把「Line Pay 韓國」（韓國限定 19%）當成 LINE Pay 的一般回饋。
// 改版前後用 2026-10-30 線上資料比過：21 個行動支付結果完全相同
async function computePaymentCards(payment, cards) {
    const matchingCards = [];
    for (const term of payment.searchTerms || []) {
        const hits = findSearchHits(term, { exactOnly: true }) || [];
        for (const hit of hits) {
            for (const card of cards) {
                const results = await calculateCardCashback(card, String(hit.originalItem).toLowerCase(), 1000); // 沒有消費金額，用 1000 試算
                results.forEach(result => {
                    if (result.rate > 0) {
                        matchingCards.push({ card, rate: result.rate, cap: result.cap, category: result.matchedCategory || null, rateGroup: null });
                    }
                });
            }
        }
    }
    // 同一張卡只留回饋最高的那個活動
    const cardMap = new Map();
    matchingCards.forEach(mc => {
        if (!cardMap.has(mc.card.id) || cardMap.get(mc.card.id).rate < mc.rate) cardMap.set(mc.card.id, mc);
    });
    return Array.from(cardMap.values()).sort((a, b) => b.rate - a.rate);
}

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

    const uniqueCards = await computePaymentCards(payment, cardsToCheck);

    // Display matching cards
    detailsContainer.innerHTML = '';
    
    if (uniqueCards.length === 0) {
        detailsContainer.innerHTML = '<p style="text-align: center; color: #666;">目前沒有信用卡認列此支付方式</p>';
    } else {
        const maxRate = uniqueCards[0].rate;

        // 每一列與「比較所有行動支付回饋」共用 renderPaymentRow
        detailsContainer.innerHTML = uniqueCards
            .map((mc, index) => renderPaymentRow(mc, index === 0 && maxRate > 0))
            .join('');
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

// 行動支付的一張卡＝一列（單一支付詳情 modal、「比較所有行動支付回饋」modal 共用）。
// 2026-11-16 由「搜尋結果卡片的縮小版」改成清單列：縮圖｜卡名（下方灰字＝活動名）｜右側回饋率大字＋上限小字。
// 原本每張卡一個框、每個支付一張綠底「最優回饋」，加上縮圖後畫面太亂（站長裁定，示意圖比較見
// docs/project/ui-display.md 第 1i 節）。列與列之間只有一條細線，排第一列就是最優。
// showBest：只有單一支付詳情的第一列傳 true（卡名後面一個小的「最優」）；比較 modal 每個支付的第一列
// 都是最優，標了等於沒標，所以不傳。
// mc = { card, rate, cap, category }
function renderPaymentRow(mc, showBest) {
    const cap = formatRateCardCap(mc.cap); // 上限字樣與詳情頁回饋卡同一支（js/card-detail.js）
    const capText = mc.cap ? `上限 ${cap}` : cap; // 無上限就不再加「上限」兩個字
    const activity = mc.category ? getCategoryDisplayName(mc.category) : '';
    return `
        <div class="payment-row">
            ${renderCardThumb(mc.card.id)}
            <div class="payment-row-main">
                <div class="payment-row-name">${escapeHtml(mc.card.name)}${showBest ? ' <span class="payment-row-best">最優</span>' : ''}</div>
                ${activity ? `<div class="payment-row-activity">${escapeHtml(activity)}</div>` : ''}
            </div>
            <div class="payment-row-nums">
                <div class="payment-row-rate">${escapeHtml(String(mc.rate))}%</div>
                <div class="payment-row-cap">${escapeHtml(capText)}</div>
            </div>
        </div>
    `;
}

// 名次（行動支付比較，每個支付名稱前面）：斜體「NO.1」，沒有底色；第 1 名墨色、其餘灰色。
// 沿革：彩帶＋金銀銅獎牌 SVG（2026-10-08）→ 圓形數字（2026-11-16，站長：獎牌有 AI 感、讓畫面亂）
// → 現在這個（2026-11-17，站長：圓形數字不夠像名次；三個示意裡選的）。樣式在 styles.css「.payment-rank」
function renderPaymentRank(rank) {
    return `<span class="payment-rank${rank === 1 ? ' payment-rank-first' : ''}" role="img" aria-label="第 ${rank} 名"><small>NO.</small>${rank}</span>`;
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

    // 只比用戶選的行動支付——沒登入也一樣（訪客的選擇存在 localStorage，首頁清單也照它顯示）。
    // 以前訪客會比全部（2026-10-14 站長回報：沒登入測試，所有支付都被比出結果）
    const paymentsToCompare = paymentsData.payments.filter(p => userSelectedPayments.has(p.id));

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

            const uniqueCards = await computePaymentCards(payment, cardsToCheck);

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
        // 每個支付名稱前面標名次。同回饋率的支付常常一大串，
        // 只比回饋率的話名次等於原始清單順序。同分依序再比：最優那張的消費上限（高者勝，無上限最高）
        // → 第二名卡片的回饋率——都是「這個支付實際上能拿多少」，名次才講得出道理。
        // 三者全同＝真的並列，給同一個名次。並列之後接下一個數字（1、1、1、2、3），不跳號——
        // 2026-10-08～11-16 是跳號的競賽排名（1、1、1、4），站長 2026-11-17 裁定那是錯的
        const capOf = mc => (mc.cap ? mc.cap : Infinity);
        const comparePayments = (a, b) =>
            (b.cards[0].rate - a.cards[0].rate) ||
            (capOf(b.cards[0]) === capOf(a.cards[0]) ? 0 : (capOf(b.cards[0]) > capOf(a.cards[0]) ? 1 : -1)) ||
            ((b.cards[1] ? b.cards[1].rate : 0) - (a.cards[1] ? a.cards[1].rate : 0));
        paymentsWithCards.sort(comparePayments);
        paymentsWithCards.forEach((pwc, i) => {
            const prev = paymentsWithCards[i - 1];
            pwc.rank = !prev ? 1 : (comparePayments(prev, pwc) === 0 ? prev.rank : prev.rank + 1);
        });

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

                const cardsHTML = pwc.cards.map(mc => renderPaymentRow(mc, false)).join('');

                paymentCard.innerHTML = `
                    <div class="compare-payment-name">
                        ${renderPaymentRank(pwc.rank)}<span>${escapeHtml(pwc.payment.name)}</span>
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

