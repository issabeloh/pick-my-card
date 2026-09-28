/* ============================================================
 * Pick My Card — js/spending-mappings.js（載入順序 10/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 消費配卡表載存            → "loadSpendingMappings" / "saveSpendingMappings"
 *  - 釘選/取消釘選             → "togglePin" / "addMapping"
 *  - 我的配卡組合頁面           → 見 js/mappings-page.js（2026-09-28 由 modal 改成完整頁面）
 *  - 免年費狀態                → "loadFeeWaiverStatus" / "setupFeeWaiverStatus"
 *  - 我的額度相關功能           → "loadCreditLimit" / "setupCreditLimit"
 *  - 結帳日/繳款日             → "loadBillingDates" / "setupBillingDates"
 * ============================================================ */
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
        mappingsLoadState = 'guest';
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
                mappingsLoadState = 'ok';
                userSpendingMappings = mappings;
                console.log('✅ [配卡] 從 Firestore 讀取成功:', mappings.length, '筆');

                // 更新本地快取
                localStorage.setItem(`spendingMappings_${currentUser.uid}`, JSON.stringify(mappings));
                return mappings;
            }

            // 讀得到雲端文件、但沒有配卡欄位 → 這位用戶真的還沒配過卡（空清單可信）
            mappingsLoadState = 'ok';
        } else {
            // Firebase SDK 還沒就緒（例：手機冷啟動時 gstatic 模組載入超過 4 秒，
            // auth 逾時 fallback 先跑）——此時的空清單不可信，標成 error 讓 UI 提供重試。
            mappingsLoadState = 'error';
            console.error('❌ [配卡] Firestore SDK 尚未就緒，改用本地快取');
        }

        // Fallback to localStorage if Firestore fails or no data
        userSpendingMappings = readLocalJSONArray(`spendingMappings_${currentUser.uid}`);
        console.log('📦 [配卡] 從本地快取載入 (fallback):', userSpendingMappings.length, '筆');
        return userSpendingMappings;
    } catch (error) {
        // 雲端讀取失敗：本地快取在「新裝置／新容器」（如 iPhone 加到桌面的 App，
        // 它的 localStorage 與 Safari 完全隔離）是空的，直接顯示空清單會被誤讀成
        // 「配卡不見了」。標成 error，由配卡組合頁（mpRender）顯示錯誤與重試。
        mappingsLoadState = 'error';
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
            mappingsLoadState = 'ok'; // 寫入成功＝雲端狀態已知，記憶體版本可信
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
            if (typeof updateMappingsSwitch === 'function') updateMappingsSwitch();

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
    showToast('已加入我的配卡組合✓', cardElement);

    // 2. 顯示 +1 徽章動畫
    showPlusBadgeAnimation();
}

// 顯示 +1 徽章動畫
function showPlusBadgeAnimation() {
    // 釘選數量顯示在首頁「我的配卡組合」切換鈕上（2026-09-28 取代浮動按鈕）
    if (typeof updateMappingsSwitch === 'function') updateMappingsSwitch();
    const btn = document.getElementById('home-view-switch-mappings');
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

