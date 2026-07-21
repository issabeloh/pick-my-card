/* ============================================================
 * Pick My Card — js/spending-mappings.js（載入順序 10/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 消費配卡表載存            → "loadSpendingMappings" / "saveSpendingMappings"
 *  - 釘選/取消釘選             → "togglePin" / "addMapping"
 *  - 我的配卡 modal＋分組視圖   → "openMyMappingsModal" / "renderMappingsList"
 *  - 拖曳排序                  → "setupMappingsDrag" / "persistMappingsDomOrder"
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
                <p style="font-size: 12px; margin-top: 8px;">登入後查詢商家，點擊結果卡片的釘選按鈕即可加入配卡</p>
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

