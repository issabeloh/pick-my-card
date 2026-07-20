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









