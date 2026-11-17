/* ============================================================
 * Pick My Card — js/data-loader.js（載入順序第 2 支模組檔；完整順序以 index.html 的 <script> 標籤為準）
 * 區塊目錄（Grep 關鍵字）：
 *  - 卡片搜尋索引              → "buildCardItemsIndex"
 *  - 資料載入（cards.data）     → "loadCardsData"
 *  - 行動支付資料初始化         → "initializePaymentsData"
 *  - 快捷選項初始化/偏好載存    → "initializeQuickSearchOptions" / "loadUserQuickSearchPrefs"
 *  - 舊版偏好遷移              → "migrateLegacyQuickSearchOptions"
 *  - 快捷按鈕渲染/下拉         → "renderQuickSearchButtons" / "setupQuickSearchDropdown"
 *  - 快捷搜尋觸發／兩型判斷     → "handleQuickSearch" / "isTypingHelperQuickOption"
 * ============================================================ */
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
        // 併入「統一詞」工作表的其他寫法／搜尋別名（選填）→ 模糊搜尋
        mergeDataTermAliases(cardsData);

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
        // 優先用 contentUpdatedIso（內容真的變動才前進，與 sitemap lastmod、商家頁烤進 HTML 的
        // 日期同源；結構與 tools/build-merchant-pages.js 的 buildUpdateDate() 一致，重寫一次
        // 看不出差別）。舊版 cards.data 沒有這欄就退回 lastUpdated（匯出當天）。
        const lastUpdateElement = document.getElementById('last-update-date');
        const contentIso = cardsData.contentUpdatedIso;
        if (lastUpdateElement && typeof contentIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(contentIso)) {
            const [y, m, d] = contentIso.split('-');
            const timeEl = document.createElement('time');
            timeEl.dateTime = contentIso;
            timeEl.textContent = `${y}/${Number(m)}/${Number(d)}`;
            lastUpdateElement.textContent = '最後資料更新：';
            lastUpdateElement.appendChild(timeEl);
            console.log(`📅 最後資料更新：${contentIso}`);
        } else if (lastUpdateElement && cardsData.lastUpdated) {
            lastUpdateElement.textContent = `最後資料更新：${cardsData.lastUpdated}`;
            console.log(`📅 最後資料更新：${cardsData.lastUpdated}`);
        }
        renderTrustLine();

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
// 快捷選項的線條圖示（2026-11-16，取代 emoji——站長：「很有 AI 感」，見 docs/project/ui-refresh-diagnosis.md）。
// 快捷選項的 icon 欄在 Sheets 裡填的是 emoji；這裡把已知的 emoji 對到線條圖示，Sheets 不用改。
// 對照表沒有的（用戶自訂選項自己挑的 emoji、之後 Sheets 新增的）照原樣顯示 emoji——
// 要換成線條圖示就在這張表加一列。內容是寫死的 SVG 路徑，不含任何外部輸入。
// viewBox 一律 0 0 24 24；線寬、端點、顏色由 styles.css 的 .line-icon 決定。
const QUICK_ICON_PATHS = {
    '💳': '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14.5h3"/>',
    '📢': '<path d="M4 10v4h3l7 4V6l-7 4H4zM17.5 9.5a3.5 3.5 0 0 1 0 5"/>',
    '🏪': '<path d="M4 10v9h16v-9M3 10l1.5-5h15L21 10H3zM10 19v-5h4v5"/>',
    '🛒': '<path d="M3 4h2.5l2.2 10.5h9.6L19.5 7H6.3"/><circle cx="9" cy="18.5" r="1.3"/><circle cx="16.5" cy="18.5" r="1.3"/>',
    '🎏': '<path d="M4 6c5 1.5 11 1.5 16 0M5 10h14M8 6.8V20M16 6.8V20"/>',
    '🌍': '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
    '🌐': '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
    '🥡': '<path d="M6 8h12l-1 12H7L6 8zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
    '💊': '<rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M9.5 9.5l5 5"/>',
    '🚕': '<path d="M4 17v-4l2-5.2A1.5 1.5 0 0 1 7.4 7h9.2a1.5 1.5 0 0 1 1.4.8l2 5.2v4H4zM4.5 13h15M6.5 17v1.8M17.5 17v1.8"/>',
    '🎤': '<rect x="9" y="3.5" width="6" height="10" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21M9 21h6"/>',
    '🏨': '<path d="M3 18V7M3 14h18v4M21 14v-1.5a3 3 0 0 0-3-3h-7V14"/><circle cx="7" cy="11" r="1.6"/>',
    '✈': '<path d="M12 3c.9 0 1.5 1 1.5 2.3V9l6.5 4v2l-6.5-2v4l2 1.5V20l-3.5-1L8.5 20v-1.5l2-1.5v-4L4 15v-2l6.5-4V5.3C10.5 4 11.1 3 12 3z"/>',
    '🧳': '<rect x="5" y="7.5" width="14" height="12" rx="2"/><path d="M9.5 7.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.5M9.5 11v5M14.5 11v5"/>',
    '⛽': '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20M3.5 20h12M7.5 7.5h4V11h-4zM14 12h1.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 0 3 0V9.5L17.5 7"/>',
    '📱': '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
    '🎬': '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 5v14M16 5v14M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5"/>',
    '🏬': '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5V20M3 20h18M9 8h1.5M13.5 8H15M9 12h1.5M13.5 12H15M10.5 20v-4h3v4"/>',
    '🏢': '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5V20M3 20h18M9 8h1.5M13.5 8H15M9 12h1.5M13.5 12H15M10.5 20v-4h3v4"/>',
    '🎡': '<circle cx="12" cy="10.5" r="6.5"/><path d="M12 4v13M5.5 10.5h13M12 10.5L8 20.5h8l-4-10"/>',
    '🎟': '<path d="M4 8a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 8v2a2 2 0 0 0 0 4v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16v-2a2 2 0 0 0 0-4V8zM14 6.5v2M14 11v2M14 15.5v2"/>',
    '🍽': '<path d="M7 3.5v6a2 2 0 0 0 4 0v-6M9 3.5v17M16.5 20.5v-17c-2 1.2-3 3.5-3 6.5v2.5h3"/>'
};

// 產生快捷選項圖示的 HTML。className 是外層 span 的 class（膠囊用 "icon"、管理視窗用 "tag-icon"）。
// 鐵則 3：對照表以外的 icon 可能是用戶自訂輸入，一律 escapeHtml。
function renderQuickOptionIcon(icon, className) {
    if (!icon) return '';
    // emoji 常帶變體選擇符（U+FE0F，如 ✈️ 🎟️ 🍽️），對照表的 key 不帶，比對前先去掉
    const key = String(icon).replace(/\uFE0F/g, '').trim();
    if (Object.prototype.hasOwnProperty.call(QUICK_ICON_PATHS, key)) {
        return `<span class="${className} line-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${QUICK_ICON_PATHS[key]}</svg></span>`;
    }
    return `<span class="${className}">${escapeHtml(icon)}</span>`;
}

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

        // 鐵則 3：displayName/icon 含用戶自訂快捷選項輸入，必須轉義
        const iconHtml = renderQuickOptionIcon(option.icon, 'icon');
        button.innerHTML = `${iconHtml}<span>${escapeHtml(option.displayName)}</span>`;

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
// 快捷搜尋按鈕分兩種（2026-10-08 站長定義）：
// - 「一次比多家」：merchants 有多個關鍵詞（所有計程車、三大電商平台…），把各關鍵詞的匹配聯集起來比較。
//   這種刻意不受精準搜尋影響、也不跳 Search Hints：關鍵詞清單是編輯挑好的，靠模糊比對把同一家的
//   各種寫法一起收進來（「台灣大車隊」→「55688台灣大車隊」），套精準搜尋會把這些變體砍掉、
//   結果變少；輸入框顯示的又是類別名（所有計程車），拿它查提示或做精準比對都沒有意義。
// - 「協助輸入」：merchants 只有一個關鍵詞（LinePay、街口支付、ApplePay…），沒有一次比多家的功能，
//   按鈕只是替用戶把名稱打進搜尋框——之後的一切（精準搜尋、Search Hints、送出時重新匹配）
//   都要跟用戶自己打字完全一樣。用戶自訂的快捷選項同樣適用這條規則。
// ⚠️ tools/lib/merchant-cards.js（商家頁卡片清單）直接呼叫這支判斷，規則只寫在這裡
function isTypingHelperQuickOption(option) {
    return !!(option && Array.isArray(option.merchants) && option.merchants.length === 1);
}

function handleQuickSearch(option) {
    const merchantInput = document.getElementById('merchant-input');
    if (!merchantInput || !cardsData) return;

    // 協助輸入型：等同用戶在搜尋框打了這個名稱（handleMerchantInput 會清掉 currentQuickSearchOption、
    // 套用精準搜尋、顯示 Search Hints、更新清除鈕與計算鈕），不走下面的多關鍵詞聯集
    if (isTypingHelperQuickOption(option)) {
        merchantInput.value = option.displayName;
        handleMerchantInput();
        return;
    }

    console.log(`\n🔍 快捷搜索: ${option.displayName}`);
    console.log(`   包含 ${option.merchants.length} 個關鍵詞:`);

    // 「找」：每個關鍵詞各找一次再合併（同名只留一個、保留先到先得的順序），規則在 findSearchHits
    const allMatches = findSearchHits(option.displayName, { quickOption: option }) || [];

    console.log(`\n   ✨ 總計找到 ${allMatches.length} 個唯一的匹配結果\n`);

    // Update UI
    merchantInput.value = option.displayName;
    // 快捷搜尋不走 handleMerchantInput，清除 ✕ 的顯示要自己更新
    if (typeof updateMerchantClearBtn === 'function') updateMerchantClearBtn();
    // 快捷搜尋不受精準搜尋影響，清掉手動輸入殘留的零結果提示；
    // 也不跳 Search Hints，上一個詞的提示一起收掉（協助輸入型走 handleMerchantInput，會自己換成新詞的提示）
    toggleExactSearchEmptyHint(false);
    if (typeof clearSearchHints === 'function') clearSearchHints();

    // 排除名單用全部關鍵詞的聯集比（快捷搜尋不受精準搜尋影響 → exactOnly=false）
    const exclusionTerms = getBasicExclusionSearchTerms(option.displayName, option);
    if (allMatches.length > 0) {
        // Get cards to compare for parking benefits check
        const cardsToCompare = getCardsForComparison();
        showMatchedItem(allMatches, option.displayName, cardsToCompare);
        currentMatchedItem = allMatches;
        currentQuickSearchOption = option; // Store quick search option for parking benefits
        showBasicExclusionPreview(exclusionTerms, false, true);

        // 快捷搜尋只填入、不自動計算（2026-07-12 產品決策）：計算一律由用戶按「計算」觸發。
        // 需要點了就出結果的入口（Spotlight 的比較按鈕）由呼叫端自行觸發計算。
    } else if (showBasicExclusionPreview(exclusionTerms, false, false)) {
        // 關鍵詞全是排除項目（如「醫療費用」）：沒有活動可匹配，但選項要留著，
        // 計算時排除判斷才會用全部關鍵詞（calculateCashback 讀 currentQuickSearchOption）
        currentMatchedItem = null;
        currentQuickSearchOption = option;
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
        currentQuickSearchOption = null;
        console.warn(`   ⚠️ 沒有找到任何匹配項目，請檢查 QuickSearch sheet 的 merchants 欄位\n`);
    }
    // 已經算過時提醒按「計算」（協助輸入型走 handleMerchantInput，那邊自己會判斷）
    if (typeof nudgeIfCalcConditionsChanged === 'function') nudgeIfCalcConditionsChanged();

    merchantInput.focus();
    validateInputs();
}

// ===== 信任列（2026-11-16）=====
// 搜尋區最下面那行「收錄 N 家銀行、N 張信用卡・資料更新 YYYY/M/D」（index.html #trust-line）。
// 數字直接從 cardsData 算，不寫死；日期和頁尾「最後資料更新」同一個來源（contentUpdatedIso，沒有就退回 lastUpdated）。
// 全部用 textContent／createElement 組，沒有 innerHTML。算不出張數就維持隱藏。
function renderTrustLine() {
    const el = document.getElementById('trust-line');
    if (!el || !cardsData || !Array.isArray(cardsData.cards) || cardsData.cards.length === 0) return;
    const bankCount = new Set(cardsData.cards.map(c => c && c.bank).filter(Boolean)).size;
    const iso = cardsData.contentUpdatedIso;
    let dateText = '';
    if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        const [y, m, d] = iso.split('-');
        dateText = `${y}/${Number(m)}/${Number(d)}`;
    } else if (cardsData.lastUpdated) {
        dateText = String(cardsData.lastUpdated);
    }
    const bold = (n) => { const b = document.createElement('b'); b.textContent = String(n); return b; };
    el.textContent = '';
    el.append('收錄 ');
    if (bankCount > 0) el.append(bold(bankCount), ' 家銀行、');
    el.append(bold(cardsData.cards.length), ' 張信用卡');
    if (dateText) el.append('・資料更新 ' + dateText);
    el.hidden = false;
}
