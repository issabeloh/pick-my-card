function buildCardItemsIndex(card) {
    const itemsMap = new Map();

    // Index cashbackRates items
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        card.cashbackRates.forEach((rateGroup, rateIndex) => {
            if (rateGroup.items && rateGroup.items.length > 0) {
                rateGroup.items.forEach(item => {
                    const itemLower = item.toLowerCase();
                    if (!itemsMap.has(itemLower)) {
                        itemsMap.set(itemLower, []);
                    }
                    itemsMap.get(itemLower).push({
                        type: 'cashbackRate',
                        index: rateIndex,
                        rateGroup: rateGroup
                    });
                });
            }
        });
    }

    // Index specialItems (can be string array or object array)
    if (card.specialItems && card.specialItems.length > 0) {
        card.specialItems.forEach((specialItem, specialIndex) => {
            const itemLower = (typeof specialItem === 'string' ? specialItem : specialItem.item || '').toLowerCase();
            if (itemLower) {
                if (!itemsMap.has(itemLower)) {
                    itemsMap.set(itemLower, []);
                }
                itemsMap.get(itemLower).push({
                    type: 'specialItem',
                    index: specialIndex,
                    specialItem: specialItem
                });
            }
        });
    }

    // Index generalItems (for cards like CUBE - object with category keys)
    if (card.generalItems && typeof card.generalItems === 'object') {
        for (const [category, items] of Object.entries(card.generalItems)) {
            if (Array.isArray(items)) {
                items.forEach(item => {
                    const itemLower = item.toLowerCase();
                    if (!itemsMap.has(itemLower)) {
                        itemsMap.set(itemLower, []);
                    }
                    itemsMap.get(itemLower).push({
                        type: 'generalItem',
                        category: category,
                        item: item
                    });
                });
            }
        }
    }

    card._itemsIndex = itemsMap;
    return itemsMap.size; // Return number of indexed items
}

// Load cards data from cards.data (encoded)
//
// 快取策略（2026-07 版本指標方案）：
// 1. 先抓幾十 bytes 的 cards.version（永遠不快取）
// 2. 用版本號當 cards.data 的 ?v= 參數 → 版本沒變時瀏覽器直接用快取，
//    省下每次進站 ~485KB 的下載；資料更新後版本號改變 → 立即抓到新資料
// 3. cards.version 不存在或抓不到時，回退舊行為（no-store 每次重抓），
//    功能完全不受影響
// ⚠️ 資料維護流程：更新 cards.data 時「務必」同步更新 cards.version
//    （詳見 CARDS-DATA-CACHE-README.md），否則使用者最多會延遲約 10 分鐘
//    （GitHub Pages 的快取時效）才看到新資料。
async function loadCardsData() {
    try {
        let version = null;
        try {
            const vRes = await fetch(`cards.version?t=${Date.now()}`, { cache: 'no-store' });
            if (vRes.ok) {
                const text = (await vRes.text()).trim();
                // 防呆：版本檔應是短字串（時間戳），過長或像 HTML（404 頁）視為無效
                if (text && text.length <= 64 && !text.includes('<')) {
                    version = encodeURIComponent(text);
                }
            }
        } catch (e) { /* 拿不到版本檔 → 回退舊行為 */ }

        const response = version
            ? await fetch(`cards.data?v=${version}`) // 可被瀏覽器快取，版本變了自動失效
            : await fetch(`cards.data?t=${Date.now()}`, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // 讀取編碼的文字
        const encoded = await response.text();
        
        // 解碼函數
        const decoded = decodeURIComponent(escape(atob(encoded)));
        cardsData = JSON.parse(decoded);

        // Filter out expired rates based on periodStart and periodEnd
        cardsData = filterExpiredRates(cardsData);

        // 併入資料驅動的搜尋排除規則（SearchExclusions 工作表，選填）
        mergeDataSearchExclusions(cardsData);

        console.log('✅ 信用卡資料已從 cards.data 載入');
        console.log(`📊 載入了 ${cardsData.cards.length} 張信用卡`);
        console.log(`📢 公告數量: ${cardsData.announcements ? cardsData.announcements.length : 0} 則`);
        console.log(`📦 檔案大小: ${Math.round(encoded.length / 1024)} KB (載入時間: ${new Date().toLocaleTimeString()})`);

        // Build search index for all cards
        let totalIndexedItems = 0;
        cardsData.cards.forEach(card => {
            const indexedCount = buildCardItemsIndex(card);
            totalIndexedItems += indexedCount;
        });
        console.log(`🚀 搜尋索引已建立: ${totalIndexedItems} 個項目`);

        // Update card count (.card-count may appear in multiple places)
        const cardCountElements = document.querySelectorAll('.card-count');
        if (cardCountElements.length > 0) {
            cardCountElements.forEach(el => {
                el.textContent = cardsData.cards.length;
                el.classList.remove('loading');
            });
            console.log(`✅ 卡片數量已更新: ${cardsData.cards.length} 張`);
        } else {
            console.warn('⚠️ 找不到 .card-count 元素');
        }

        // Display last update date
        const lastUpdateElement = document.getElementById('last-update-date');
        if (lastUpdateElement && cardsData.lastUpdated) {
            lastUpdateElement.textContent = `最後資料更新：${cardsData.lastUpdated}`;
            console.log(`📅 最後資料更新：${cardsData.lastUpdated}`);
        }

        return true;
    } catch (error) {
        console.error('❌ 載入信用卡資料失敗:', error);
        showErrorMessage('無法載入信用卡資料,請重新整理頁面或聯絡管理員。');
        return false;
    }
}

// Initialize payments data from cardsData
function initializePaymentsData() {
    // Try to load from cardsData first (from cards.data file)
    if (cardsData && cardsData.payments) {
        paymentsData = {
            payments: cardsData.payments
        };
        console.log('✅ 行動支付資料已從 cards.data 載入');
        console.log(`📱 載入了 ${paymentsData.payments.length} 種行動支付`);
    } else {
        // Fallback to hardcoded data if not available in cards.data
        console.warn('⚠️ cards.data 中沒有 payments 資料，使用預設資料');
        paymentsData = {
            payments: [
                { id: 'linepay', name: 'LINE Pay', website: 'https://pay.line.me/portal/tw/main', searchTerms: ['linepay', 'line pay'] },
                { id: 'jkopay', name: '街口支付', website: 'https://www.jkopay.com/', searchTerms: ['街口', '街口支付', 'jkopay'] },
                { id: 'applepay', name: 'Apple Pay', website: 'https://www.apple.com/tw/apple-pay/', searchTerms: ['apple pay', 'applepay'] },
                { id: 'pxpayplus', name: '全支付', website: 'https://www.pxpay.com.tw/', searchTerms: ['全支付', 'pxpay'] },
                { id: 'easywallet', name: '悠遊付', website: 'https://easywallet.easycard.com.tw/', searchTerms: ['悠遊付', 'easy wallet', 'easywallet'] },
                { id: 'googlepay', name: 'Google Pay', website: 'https://pay.google.com/intl/zh-TW_tw/about/', searchTerms: ['google pay', 'googlepay'] },
                { id: 'esunwallet', name: '玉山 Wallet', website: 'https://www.esunbank.com/zh-tw/personal/deposit/ebank/wallet', searchTerms: ['玉山wallet', 'esun wallet'] },
                { id: 'pluspay', name: '全盈+Pay', website: 'https://www.pluspay.com.tw/', searchTerms: ['全盈+pay', '全盈支付', '全盈+', '全盈+pay'] },
                { id: 'openwallet', name: 'OPEN 錢包', website: 'https://www.openpoint.com.tw/opw/index.aspx', searchTerms: ['open錢包', 'open wallet'] },
                { id: 'piwallet', name: 'Pi 拍錢包', website: 'https://www.piwallet.com.tw/', searchTerms: ['pi錢包', 'pi 拍錢包', 'pi wallet'] },
                { id: 'icashpay', name: 'iCash Pay', website: 'https://www.icashpay.com.tw/', searchTerms: ['icash pay', 'icashpay'] },
                { id: 'samsungpay', name: 'Samsung Pay', website: 'https://www.samsung.com/tw/apps/samsung-pay/', searchTerms: ['samsung pay', 'samsungpay'] },
                { id: 'opay', name: '歐付寶行動支付', website: 'https://www.opay.tw/', searchTerms: ['歐付寶', '歐付寶行動支付', 'opay'] },
                { id: 'ecpay', name: '橘子支付', website: 'https://www.ecpay.com.tw/', searchTerms: ['橘子支付', 'ecpay'] },
                { id: 'paypal', name: 'PayPal', website: 'https://www.paypal.com/tw/home', searchTerms: ['paypal'] },
                { id: 'twpay', name: '台灣 Pay', website: 'https://www.twpay.com.tw/', searchTerms: ['台灣pay', 'taiwan pay', 'twpay', '台灣支付'] },
                { id: 'skmpay', name: 'SKM Pay', website: 'https://www.skmpay.com.tw/', searchTerms: ['skm pay', 'skmpay'] },
                { id: 'hamipay', name: 'Hami Pay 掃碼付', website: 'https://hamipay.emome.net/', searchTerms: ['hami pay', 'hamipay', 'hami pay掃碼付'] },
                { id: 'cpcpay', name: '中油 Pay', website: 'https://www.cpc.com.tw/', searchTerms: ['中油pay', 'cpc pay'] },
                { id: 'garminpay', name: 'Garmin Pay', website: 'https://www.garmin.com.tw/minisite/garmin-pay/', searchTerms: ['garmin pay', 'garminpay'] }
            ]
        };
        console.log('✅ 行動支付資料已初始化（預設）');
    }
}

// Get default quick search options from cardsData
function getDefaultQuickSearchOptions() {
    if (cardsData && cardsData.quickSearchOptions) {
        return cardsData.quickSearchOptions;
    }
    return [];
}

// Initialize quick search options from defaults + user prefs (hidden ids + custom options)
// New model: defaults always come from cards.json (so developer updates propagate).
// User prefs store only:
//   - hiddenDefaultIds: which default options the user has removed from their list
//   - customQuickOptions: user-created options
//   - selectedOrder: display order (mix of default ids and custom ids)
async function initializeQuickSearchOptions(userData = null) {
    const defaultOptions = getDefaultQuickSearchOptions();
    const prefs = await loadUserQuickSearchPrefs(userData);

    // Filter out defaults the user has hidden
    const visibleDefaults = defaultOptions.filter(o => !prefs.hiddenDefaultIds.includes(o.id));

    // Combine visible defaults + user's custom options
    let combined = [...visibleDefaults, ...prefs.customQuickOptions];

    // Apply user's preferred order (items not in order list appended in their natural position)
    if (prefs.selectedOrder && prefs.selectedOrder.length > 0) {
        const orderMap = new Map();
        prefs.selectedOrder.forEach((id, idx) => orderMap.set(id, idx));
        combined.sort((a, b) => {
            const aIdx = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
            const bIdx = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
            return aIdx - bIdx;
        });
    }

    quickSearchOptions = combined;
    console.log(`⚡ 載入了 ${quickSearchOptions.length} 個快捷選項 (${visibleDefaults.length} 預設 + ${prefs.customQuickOptions.length} 自訂，隱藏 ${prefs.hiddenDefaultIds.length})`);
}

// Load user quick search preferences (hiddenDefaultIds + customQuickOptions + selectedOrder).
// Auto-migrates legacy `quickSearchOptions` array format on first load.
async function loadUserQuickSearchPrefs(userData = null) {
    const empty = { hiddenDefaultIds: [], customQuickOptions: [], selectedOrder: [] };

    try {
        // Logged-in user: use unified userData or Firestore
        if (currentUser && window.db) {
            let data = userData;
            if (!data) {
                const userDoc = await window.getDoc(window.doc(window.db, 'users', currentUser.uid));
                data = userDoc.exists() ? userDoc.data() : null;
            }
            if (data) {
                // Check if migration is needed (legacy `quickSearchOptions` array exists)
                if (Array.isArray(data.quickSearchOptions)) {
                    console.log('🔀 偵測到舊格式快捷選項，自動遷移為新格式');
                    return await migrateLegacyQuickSearchOptions(data);
                }
                return {
                    hiddenDefaultIds: data.hiddenDefaultIds || [],
                    customQuickOptions: data.customQuickOptions || [],
                    selectedOrder: data.selectedOrder || []
                };
            }
        }

        // Guest: load from localStorage（readLocalJSON：壞資料自動移除並回 null）
        const parsed = readLocalJSON('userQuickSearchPrefs', null);
        if (parsed && typeof parsed === 'object') {
            return {
                hiddenDefaultIds: parsed.hiddenDefaultIds || [],
                customQuickOptions: parsed.customQuickOptions || [],
                selectedOrder: parsed.selectedOrder || []
            };
        }

        // Legacy localStorage migration (guest had old format)
        const oldList = readLocalJSONArray('userQuickSearchOptions', null);
        if (Array.isArray(oldList)) {
            console.log('🔀 偵測到 localStorage 舊格式，自動遷移');
            const customs = readLocalJSONArray('userCustomQuickOptions');
            const migrated = computeMigratedPrefs(oldList, customs);
            localStorage.setItem('userQuickSearchPrefs', JSON.stringify(migrated));
            localStorage.removeItem('userQuickSearchOptions');
            return migrated;
        }
    } catch (error) {
        console.error('載入快捷選項偏好時出錯:', error);
    }
    return empty;
}

// Compute new prefs format from legacy saved list + customs
function computeMigratedPrefs(oldSavedList, existingCustoms) {
    const defaultOptions = getDefaultQuickSearchOptions();
    const defaultIds = new Set(defaultOptions.map(o => o.id));
    const savedIds = new Set(oldSavedList.map(o => o.id));

    // Defaults missing from saved list → hidden
    const hiddenDefaultIds = defaultOptions
        .map(o => o.id)
        .filter(id => !savedIds.has(id));

    // Items in saved list that aren't defaults → custom (merge with existing customs by id)
    const customMap = new Map();
    (existingCustoms || []).forEach(c => { if (c && c.id) customMap.set(c.id, c); });
    oldSavedList.forEach(o => {
        if (o && o.id && !defaultIds.has(o.id) && !customMap.has(o.id)) {
            customMap.set(o.id, o);
        }
    });
    const customQuickOptions = Array.from(customMap.values());

    // Preserve user's order
    const selectedOrder = oldSavedList.map(o => o.id).filter(Boolean);

    return { hiddenDefaultIds, customQuickOptions, selectedOrder };
}

// Migrate Firestore legacy format and persist
async function migrateLegacyQuickSearchOptions(userData) {
    const oldList = userData.quickSearchOptions || [];
    const existingCustoms = userData.customQuickOptions || [];
    const migrated = computeMigratedPrefs(oldList, existingCustoms);

    try {
        if (currentUser && window.db && window.deleteField) {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                hiddenDefaultIds: migrated.hiddenDefaultIds,
                customQuickOptions: migrated.customQuickOptions,
                selectedOrder: migrated.selectedOrder,
                quickSearchOptions: window.deleteField()
            }, { merge: true });
            console.log('✅ 已將舊快捷選項格式遷移為新格式並刪除舊欄位');
        }
        // Update localStorage too
        localStorage.setItem('userQuickSearchPrefs', JSON.stringify(migrated));
        localStorage.removeItem('userQuickSearchOptions');
    } catch (e) {
        console.error('遷移舊快捷選項格式時出錯:', e);
    }

    return migrated;
}

// Save user quick search preferences (new format)
async function saveUserQuickSearchPrefs(prefs) {
    try {
        if (currentUser && window.db) {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                hiddenDefaultIds: prefs.hiddenDefaultIds,
                customQuickOptions: prefs.customQuickOptions,
                selectedOrder: prefs.selectedOrder
            }, { merge: true });
        }
        localStorage.setItem('userQuickSearchPrefs', JSON.stringify(prefs));
        console.log('✅ 用戶快捷選項偏好已保存');
        return true;
    } catch (error) {
        console.error('保存快捷選項偏好時出錯:', error);
        return false;
    }
}

// Render quick search buttons
function renderQuickSearchButtons() {
    const visibleContainer = document.getElementById('quick-search-visible');
    const dropdownContent = document.getElementById('quick-search-dropdown-content');
    const expandBtn = document.getElementById('quick-search-expand-btn');

    if (!visibleContainer || !dropdownContent || !expandBtn) return;

    // Clear existing buttons
    visibleContainer.innerHTML = '';
    dropdownContent.innerHTML = '';

    // If no options, hide everything
    if (quickSearchOptions.length === 0) {
        visibleContainer.style.display = 'none';
        expandBtn.classList.add('hidden');
        return;
    }

    visibleContainer.style.display = 'flex';

    // Create button element helper
    const createButton = (option) => {
        const button = document.createElement('button');
        button.className = 'quick-search-btn';
        button.dataset.merchants = option.merchants.join(',');

        const iconHtml = option.icon ? `<span class="icon">${option.icon}</span>` : '';
        button.innerHTML = `${iconHtml}<span>${option.displayName}</span>`;

        button.addEventListener('click', () => {
            handleQuickSearch(option);
            closeQuickSearchDropdown();
        });

        return button;
    };

    // Add buttons to visible row
    quickSearchOptions.forEach(option => {
        visibleContainer.appendChild(createButton(option));
    });

    // Add all buttons to dropdown
    quickSearchOptions.forEach(option => {
        dropdownContent.appendChild(createButton(option));
    });

    // Setup expand button and dropdown
    setupQuickSearchDropdown();

    console.log(`✅ 已渲染 ${quickSearchOptions.length} 個快捷搜索按鈕`);
}

// Setup quick search dropdown expand/collapse
function setupQuickSearchDropdown() {
    const expandBtn = document.getElementById('quick-search-expand-btn');
    const dropdown = document.getElementById('quick-search-dropdown');

    if (!expandBtn || !dropdown) return;

    // Toggle dropdown on button click
    expandBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        if (isOpen) {
            closeQuickSearchDropdown();
        } else {
            openQuickSearchDropdown();
        }
    };

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !expandBtn.contains(e.target)) {
            closeQuickSearchDropdown();
        }
    });

    // Update position on scroll instead of closing
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        if (dropdown.classList.contains('open')) {
            // Throttle position updates
            if (!scrollTimeout) {
                scrollTimeout = setTimeout(() => {
                    updateDropdownPosition();
                    scrollTimeout = null;
                }, 16); // ~60fps
            }
        }
    }, true);
}

function updateDropdownPosition() {
    const dropdown = document.getElementById('quick-search-dropdown');
    const wrapper = document.querySelector('.quick-search-wrapper');

    if (!dropdown || !wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    // Set dropdown width to match wrapper
    const dropdownWidth = Math.min(wrapperRect.width, viewportWidth - 20);

    // Position below the wrapper
    let top = wrapperRect.bottom + 4;
    let left = wrapperRect.left;

    // Ensure dropdown doesn't go off-screen horizontally
    if (left + dropdownWidth > viewportWidth - 10) {
        left = viewportWidth - dropdownWidth - 10;
    }
    if (left < 10) left = 10;

    // Apply position
    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;
    dropdown.style.width = `${dropdownWidth}px`;
}

function openQuickSearchDropdown() {
    const dropdown = document.getElementById('quick-search-dropdown');
    const expandBtn = document.getElementById('quick-search-expand-btn');

    if (!dropdown) return;

    updateDropdownPosition();
    dropdown.classList.add('open');
    if (expandBtn) expandBtn.classList.add('expanded');
}

function closeQuickSearchDropdown() {
    const dropdown = document.getElementById('quick-search-dropdown');
    const expandBtn = document.getElementById('quick-search-expand-btn');
    if (dropdown) dropdown.classList.remove('open');
    if (expandBtn) expandBtn.classList.remove('expanded');
}

// Handle quick search button click
function handleQuickSearch(option) {
    const merchantInput = document.getElementById('merchant-input');
    if (!merchantInput || !cardsData) return;

    console.log(`\n🔍 快捷搜索: ${option.displayName}`);
    console.log(`   包含 ${option.merchants.length} 個關鍵詞:`);

    // Search for all merchants and combine results
    const allMatches = [];
    const processedItems = new Set(); // Avoid duplicates

    option.merchants.forEach((merchant, index) => {
        const trimmedMerchant = merchant.trim();
        console.log(`   [${index + 1}/${option.merchants.length}] 搜尋: "${trimmedMerchant}"`);

        const matches = findMatchingItem(trimmedMerchant);

        if (matches && matches.length > 0) {
            console.log(`      ✅ 找到 ${matches.length} 個匹配項目`);
            let addedCount = 0;
            matches.forEach(match => {
                // Use originalItem (the actual item name) as the unique key
                const key = match.originalItem.toLowerCase();
                if (!processedItems.has(key)) {
                    processedItems.add(key);
                    allMatches.push(match);
                    addedCount++;
                    console.log(`         ➕ 添加: ${match.originalItem}`);
                } else {
                    console.log(`         ⏭️ 跳過重複: ${match.originalItem}`);
                }
            });
            console.log(`      📌 新增 ${addedCount} 個結果（已去重）`);
        } else {
            console.log(`      ❌ 無匹配結果 - 請檢查 Cards Data 中是否有 "${trimmedMerchant}"`);
        }
    });

    console.log(`\n   ✨ 總計找到 ${allMatches.length} 個唯一的匹配結果\n`);

    // Update UI
    merchantInput.value = option.displayName;
    // 快捷搜尋不受精準搜尋影響，清掉手動輸入殘留的零結果提示
    toggleExactSearchEmptyHint(false);

    if (allMatches.length > 0) {
        // Get cards to compare for parking benefits check
        const cardsToCompare = getCardsForComparison();
        showMatchedItem(allMatches, option.displayName, cardsToCompare);
        currentMatchedItem = allMatches;
        currentQuickSearchOption = option; // Store quick search option for parking benefits

        // 快捷搜尋只填入、不自動計算（2026-07-12 產品決策）：計算一律由用戶按「計算」觸發。
        // 需要點了就出結果的入口（Spotlight 的比較按鈕）由呼叫端自行觸發計算。
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
        currentQuickSearchOption = null;
        console.warn(`   ⚠️ 沒有找到任何匹配項目，請檢查 QuickSearch sheet 的 merchants 欄位\n`);
    }

    merchantInput.focus();
    validateInputs();
}

