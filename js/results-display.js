/* ============================================================
 * Pick My Card — js/results-display.js（載入順序 6/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 結果列表顯示              → "displayResults"
 *  - 領券回饋計算              → "calculateCouponRate"
 *  - Placeholder 解析（必傳 levelSettings，見鐵則 5）→ "extractPlaceholderField" / "parseCashbackRate"
 *  - 領券結果顯示              → "displayCouponCashbacks"
 *  - 停車折抵顯示              → "displayParkingBenefits"
 *  - 新戶活動顯示              → "displayCardholderPromos" / "createCardholderPromoElement"
 *  - HTML 轉義與連結防護（鐵則 3）→ "escapeHtml" / "sanitizeUrl"
 *  - 詳情頁導覽                → "setupCardDetailNav" / "renderCardDetailPromos"
 *  - 結果卡片元素              → "createCardResultElement" / "createCouponResultElement"
 *  - 計算明細 popover           → "showCalcBreakdown"
 *  - 率組成展開                → "toggleRateComposition"
 * ============================================================ */
function displayResults(results, originalAmount, searchedItem, isBasicCashback = false) {
    console.log('📊 displayResults 被調用');
    console.log('results 數量:', results.length);
    console.log('isBasicCashback:', isBasicCashback);
    resultsContainer.innerHTML = '';

    // Check if searchedItem is a payment method
    const paymentDisclaimer = document.getElementById('payment-disclaimer');
    const isPaymentMethod = paymentsData?.payments.some(payment =>
        payment.searchTerms.some(term =>
            searchedItem.toLowerCase().includes(term.toLowerCase()) ||
            term.toLowerCase().includes(searchedItem.toLowerCase())
        )
    );

    // Hide disclaimer if searching for payment method
    if (paymentDisclaimer) {
        paymentDisclaimer.style.display = isPaymentMethod ? 'none' : 'block';
    }
    
    if (results.length === 0) {
        // No cards have cashback for this item
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.innerHTML = `
            <h3>無符合的信用卡</h3>
            <p>沒有任何信用卡對「${escapeHtml(searchedItem)}」提供現金回饋。</p>
        `;
        resultsContainer.appendChild(noResultsDiv);
    } else {
        const maxCashback = results[0].cashbackAmount;

        // Use DocumentFragment to batch DOM operations and reduce reflows
        const fragment = document.createDocumentFragment();
        results.forEach((result, index) => {
            const cardElement = createCardResultElement(result, originalAmount, searchedItem, index === 0 && maxCashback > 0, isBasicCashback);
            fragment.appendChild(cardElement);
        });
        resultsContainer.appendChild(fragment);
    }

    // 顯示商家付款方式資訊 / 導購網站 / 推薦連結
    // Use actual user input, not the joined matched-item names — otherwise a search like
    // "日本" would match "7-ELEVEN" (because "日本7-ELEVEN門市" is a matched item) or
    // "ToCoo! 日本租車網" in Shopback (because "日本" appears inside the merchant name).
    const actualUserInput = merchantInput.value.trim();
    displayMerchantPaymentInfo(actualUserInput);
    displayCashbackSites(actualUserInput);
    displayReferralLink(actualUserInput);

    // 結果標題：無匹配（只剩基本回饋，isBasicCashback）時沒有「指定通路回饋」，
    // 標題退成「一般回饋」；有匹配時維持「一般回饋與指定通路回饋」。
    const resultsTitle = resultsSection.querySelector('h2');
    if (resultsTitle) {
        resultsTitle.textContent = isBasicCashback ? '一般回饋' : '一般回饋與指定通路回饋';
    }

    resultsSection.style.display = 'block';
    // 有搜尋結果時顯示「精選活動」快速跳轉浮標（結果太長時一鍵跳到最底的精選活動區）
    if (typeof updateScrollToSpotlightBtn === 'function') updateScrollToSpotlightBtn();
    // 商家落地頁的開頁自動計算：跳過這次捲動，讓頂部標題區塊與搜尋框先入眼（一次性旗標，
    // 之後用戶自己搜尋仍照常捲到結果）。
    if (window.__pmcSuppressNextScroll) {
        window.__pmcSuppressNextScroll = false;
    } else {
        // 無匹配（含僅停車匹配）時捲到 #matched-item 紅字狀態列：結果區在狀態列下方，
        // 照舊捲到結果區會把紅字推出畫面外，用戶看不到「沒匹配到、顯示的是基本回饋」。
        const statusBar = document.getElementById('matched-item');
        const showNoMatchStatus = statusBar && statusBar.style.display !== 'none' &&
            (statusBar.classList.contains('no-match') || statusBar.classList.contains('partial-match'));
        if (showNoMatchStatus) {
            // 手機：先讓聚焦中的輸入框（金額/商家）失焦收鍵盤，否則鍵盤收合造成的視窗
            // 高度變化會打斷 smooth scroll，只捲一點點就停（用戶回報）。再用 rAF 等版面
            // 回穩後把紅字捲到接近頂端（block:'start' ＋ #matched-item 的 scroll-margin-top），
            // 讓「沒匹配到」明確跳到上方、下方接著顯示基本回饋結果。block:'start' 也比
            // 'center' 更不受鍵盤造成的視窗高度變動影響。
            const active = document.activeElement;
            if (active && typeof active.blur === 'function') active.blur();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                statusBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }));
        } else {
            resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

// 計算 coupon 的實際回饋率（支援固定+分級回饋率）
async function calculateCouponRate(coupon, card) {
    let rate = coupon.rate;

    // 如果不是 CUBE 卡，直接返回原始 rate
    if (card.id !== 'cathay-cube') {
        return typeof rate === 'number' ? rate : parseFloat(rate);
    }

    // 如果 rate 不是字串，直接返回數字（向下相容）
    if (typeof rate !== 'string') {
        return rate;
    }

    // 取得用戶的 Level 設定
    const { data: levelSettings } = await resolveCardLevel(card, 'Level 1');

    // 處理純 "specialRate" 或 "generalRate" 的情況
    if (rate === 'specialRate') {
        return levelSettings.specialRate || 0;
    }
    if (rate === 'generalRate') {
        return levelSettings.generalRate || 0;
    }

    // 處理 "數字+變數" 的情況（例如 "4.5+specialRate"）
    if (rate.includes('+')) {
        const parts = rate.split('+');
        const fixedRate = parseFloat(parts[0].trim());
        const variableType = parts[1].trim();

        let variableRate = 0;
        if (variableType === 'specialRate') {
            variableRate = levelSettings.specialRate || 0;
        } else if (variableType === 'generalRate') {
            variableRate = levelSettings.generalRate || 0;
        }

        return fixedRate + variableRate;
    }

    // 如果都不是，當成固定數字處理
    return parseFloat(rate);
}

// ========== Placeholder 解析（{rate}、{cap}、{rate_1}、{overseasBonusRate} 等任意欄位）==========
// 三個 parse 函數共用這一個 placeholder 抽取邏輯（原本正則寫了 3 遍）。
// 從 "{欄位名}" 字串取出欄位名，不是 placeholder 格式則回 null。
function extractPlaceholderField(value) {
    if (typeof value !== 'string') return null;
    const m = value.match(/^\{(.+)\}$/);
    return m ? m[1] : null;
}

// 解析 cashbackRates 中的 rate 值（支援數字、{specialRate}、{rate} 等任意 placeholder）
// 註：2026-07 起改為同步函數（原本標成 async 但內部沒有任何非同步操作），
// 既有的 `await parseCashbackRate(...)` 呼叫方式仍完全相容。
function parseCashbackRate(rate, card, levelSettings) {
    // 如果是數字，直接返回
    if (typeof rate === 'number') {
        return rate;
    }

    // 處理 {placeholder} 格式（支援任意欄位名稱）
    const fieldName = extractPlaceholderField(rate);
    if (fieldName) {
        // 只有 hasLevels 的卡片才支援 placeholder
        if (card.hasLevels && levelSettings && levelSettings[fieldName] !== undefined) {
            return levelSettings[fieldName];
        }
        console.warn(`⚠️ ${card.name}: {${fieldName}} 需要 hasLevels=true 且 levelSettings 中有 ${fieldName}`);
        return 0;
    }

    // 其他情況當成數字處理
    return parseFloat(rate);
}

// 同步版本的 rate 解析（用於排序，不需要 card 物件、不顯示警告）
function parseCashbackRateSync(rate, levelData) {
    if (typeof rate === 'number') {
        return rate;
    }

    const fieldName = extractPlaceholderField(rate);
    if (fieldName) {
        return levelData?.[fieldName] || 0;
    }

    return parseFloat(rate) || 0;
}

// 解析 cashbackRates 中的 cap 值（支援數字和 {cap}、{cap_1} 等任意 placeholder）
// 與 rate 的差異：無效值回傳 null（代表無上限），不是 0
function parseCashbackCap(cap, card, levelSettings) {
    // 如果是數字，直接返回
    if (typeof cap === 'number') {
        return cap;
    }

    // 如果是 undefined 或 null，返回 null
    if (cap === undefined || cap === null) {
        return null;
    }

    // 處理 {placeholder} 格式（支援任意欄位名稱）
    const fieldName = extractPlaceholderField(cap);
    if (fieldName) {
        // 只有 hasLevels 的卡片才支援 placeholder
        if (card.hasLevels && levelSettings && levelSettings[fieldName] !== undefined) {
            return levelSettings[fieldName];
        }
        console.warn(`⚠️ ${card.name}: {${fieldName}} 需要 hasLevels=true 且 levelSettings 中有 ${fieldName}`);
        return null;
    }

    // 其他情況當成數字處理
    const parsed = parseInt(cap);
    return isNaN(parsed) ? null : parsed;
}

// Display coupon cashback results
async function displayCouponCashbacks(amount, merchantValue) {
    couponResultsContainer.innerHTML = '';

    // Get cards to check (user selected or all)
    const cardsToCheck = getCardsForComparison();

    // Collect all coupon cashbacks that match the merchant
    const matchingCoupons = [];

    // Pre-compute search variants once (含 fuzzy 別名，e.g. "711" → ["711","7-eleven"])
    const searchVariants = getAllSearchVariants(merchantValue);

    for (const card of cardsToCheck) {
        if (card.couponCashbacks) {
            for (const coupon of card.couponCashbacks) {
                if (!coupon.merchant) continue;
                // Split merchant string into array of individual merchants
                // 防禦：merchant 可能被資料匯出成 number（如 "8000"），String() 避免 .split 崩潰
                const merchantItems = String(coupon.merchant).split(',').map(m => m.trim());

                // Find all matching merchant items
                const matchedMerchants = [];
                for (const item of merchantItems) {
                    const itemLower = item.toLowerCase();
                    // itemLower.includes(term): 項目包含搜尋詞（允許）
                    // term ⊇ item: 用詞彙邊界判斷，避免 "singapore" 誤含 "gap"
                    if (searchVariants.some(term =>
                        itemLower.includes(term) || termContainsItemWithBoundary(term, itemLower)
                    )) {
                        matchedMerchants.push(item);
                    }
                }

                // If any merchants matched, add this coupon
                if (matchedMerchants.length > 0) {
                    // 計算實際回饋率（支援分級）
                    const actualRate = await calculateCouponRate(coupon, card);

                    // Apply couponCap: within-cap amount uses the coupon rate,
                    // spending beyond the cap earns the card's basic cashback rate.
                    const capNum = parseFloat(coupon.cap);
                    let potentialCashback;
                    let calculationLayers = null;

                    if (capNum && capNum > 0 && amount > capNum) {
                        const withinCapAmount = capNum;
                        const overflowAmount = amount - capNum;
                        const couponCashback = Math.floor(withinCapAmount * actualRate / 100);
                        // 領券活動的溢出直接用 basicCashback（與 getOverflowRate 現值等價，
                        // 不共用只是避免對 helper 的依賴；領券商家都是國內實體/電商通路）
                        const overflowRate = card.basicCashback || 0;
                        const overflowCashback = Math.floor(overflowAmount * overflowRate / 100);
                        potentialCashback = couponCashback + overflowCashback;
                        calculationLayers = [
                            { name: '領券活動', rate: actualRate, applicableAmount: withinCapAmount, cashback: couponCashback, cap: capNum },
                            { name: '基本回饋', rate: overflowRate, applicableAmount: overflowAmount, cashback: overflowCashback, cap: null }
                        ];
                    } else {
                        potentialCashback = Math.floor(amount * actualRate / 100);
                        calculationLayers = [
                            { name: '領券活動', rate: actualRate, applicableAmount: amount, cashback: potentialCashback, cap: (capNum && capNum > 0) ? capNum : null }
                        ];
                    }

                    matchingCoupons.push({
                        ...coupon,
                        cardName: card.name,
                        cardId: card.id,
                        actualRate: actualRate, // 儲存計算後的實際回饋率
                        potentialCashback: potentialCashback,
                        calculationLayers: calculationLayers,
                        matchedMerchants: matchedMerchants // Store matched merchants
                    });
                }
            }
        }
    }
    
    // If no matching coupons, hide the section
    if (matchingCoupons.length === 0) {
        couponResultsSection.style.display = 'none';
        return;
    }
    
    // Sort by cashback rate (highest first)
    matchingCoupons.sort((a, b) => b.actualRate - a.actualRate);

    // Display coupon results using DocumentFragment
    const fragment = document.createDocumentFragment();
    matchingCoupons.forEach(coupon => {
        const couponElement = createCouponResultElement(coupon, amount);
        fragment.appendChild(couponElement);
    });
    couponResultsContainer.appendChild(fragment);

    couponResultsSection.style.display = 'block';
}

// Display parking benefits
function displayParkingBenefits(merchantValue, cardsToCheck, searchKeywords = null) {
    // Check if benefits data exists
    if (!cardsData || !cardsData.benefits || cardsData.benefits.length === 0) {
        return;
    }

    // Determine search terms to use (含 fuzzy 別名展開)
    const searchTerms = searchKeywords
        ? [...new Set(searchKeywords.flatMap(k => getAllSearchVariants(k)))]
        : getAllSearchVariants(merchantValue);

    if (searchKeywords) {
        console.log(`🅿️ 使用快捷搜尋關鍵詞匹配停車折抵: [${searchTerms.join(', ')}]`);
    } else {
        console.log(`🅿️ 使用輸入值匹配停車折抵: "${searchTerms[0]}"`);
    }

    const matchingBenefits = [];

    // Find matching benefits
    for (const benefit of cardsData.benefits) {
        // Skip inactive benefits
        if (!benefit.active) continue;

        // Check if merchants match using any search term
        if (benefit.merchants && Array.isArray(benefit.merchants)) {
            for (const merchant of benefit.merchants) {
                const merchantItemLower = merchant.toLowerCase();

                // 注意：停車的商家名稱是長描述字串、關鍵詞常在中間（如「中興嘟嘟房」⊇「嘟嘟房」、
                // 「全台遠東百貨停車」⊇「遠東」），因此這裡刻意用 substring 而非 startsWith，
                // 否則會漏掉大量停車場。停車資料皆為台灣停車場專名，誤匹配風險低。
                const isMatch = searchTerms.some(searchTerm =>
                    searchTerm.includes(merchantItemLower) || merchantItemLower.includes(searchTerm)
                );

                if (isMatch) {
                    // Check if this card is in the user's selection
                    const shouldShow = !currentUser || cardsToCheck.some(card => card.id === benefit.id);

                    if (shouldShow) {
                        matchingBenefits.push({
                            ...benefit,
                            matchedMerchant: merchant
                        });
                    }
                    break; // Found a match for this benefit, move to next
                }
            }
        }
    }

    // If no matches, hide the section
    const parkingSection = document.getElementById('parking-benefits-section');
    const parkingContainer = document.getElementById('parking-benefits-container');

    if (matchingBenefits.length === 0) {
        if (parkingSection) parkingSection.style.display = 'none';
        return;
    }

    // Display parking benefits
    if (!parkingContainer) {
        console.error('❌ parking-benefits-container 元素不存在');
        return;
    }

    parkingContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    matchingBenefits.forEach(benefit => {
        const benefitElement = createParkingBenefitElement(benefit);
        fragment.appendChild(benefitElement);
    });

    parkingContainer.appendChild(fragment);
    if (parkingSection) parkingSection.style.display = 'block';
}

// ==========================================
// New Cardholder Promos (search results)
// ==========================================

// Toggle state shared by desktop + mobile checkboxes
let showCardholderPromos = false;

// Wire both desktop and mobile checkboxes; keep them in sync.
// Help popup is shown via CSS (:hover or :focus-within on .promo-help-wrap).
// On touch, tapping outside the wrap blurs the help button so the popup hides.
function setupCardholderPromoToggle() {
    // 2026-07-12 版面重整後桌機/手機共用同一個 checkbox（保留陣列形式與同步邏輯以防未來再分裝置）
    const ids = ['show-promos-checkbox'];
    const onChange = (e) => {
        showCardholderPromos = e.target.checked;
        // Sync the other checkbox so both stay in lockstep
        ids.forEach(id => {
            const cb = document.getElementById(id);
            if (cb && cb !== e.target) cb.checked = showCardholderPromos;
        });
        // Don't auto-recompute — toggle is part of setup, user clicks
        // "計算回饋" to apply.
    };
    ids.forEach(id => {
        const cb = document.getElementById(id);
        if (cb) cb.addEventListener('change', onChange);
    });

    // Help: click '?' toggles a floating text panel (overlay, doesn't push layout).
    // 一次只開一個說明——開新的先收舊的；點面板外任意處也會收合
    const inlineHelpBtns = [...document.querySelectorAll('.promo-help-inline')];
    const closeAllInlineHelp = () => {
        inlineHelpBtns.forEach(btn => {
            const t = document.getElementById(btn.getAttribute('data-help-target'));
            if (t && !t.hasAttribute('hidden')) {
                t.setAttribute('hidden', '');
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    };
    inlineHelpBtns.forEach(btn => {
        const targetId = btn.getAttribute('data-help-target');
        const text = targetId && document.getElementById(targetId);
        if (!text) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const wasHidden = text.hasAttribute('hidden');
            closeAllInlineHelp();
            text.toggleAttribute('hidden', !wasHidden);
            btn.setAttribute('aria-expanded', String(wasHidden));
        });
    });
    if (inlineHelpBtns.length > 0) {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.promo-help-text')) closeAllInlineHelp();
        });
    }

    // Desktop help: hover '?' shows a native popover (top-layer, escapes z-index).
    const popoverSupported = typeof HTMLElement.prototype.showPopover === 'function';
    document.querySelectorAll('.promo-help-hover').forEach(btn => {
        const popupId = btn.getAttribute('data-help-target');
        const popup = popupId && document.getElementById(popupId);
        if (!popup) return;

        const positionPopup = () => {
            const rect = btn.getBoundingClientRect();
            popup.style.position = 'fixed';
            popup.style.top = `${rect.bottom + 4}px`;
            popup.style.left = `${rect.left}px`;
            const popupRect = popup.getBoundingClientRect();
            const overflow = popupRect.right - window.innerWidth;
            if (overflow > 0) {
                popup.style.left = `${Math.max(8, rect.left - overflow - 8)}px`;
            }
        };

        const open = () => {
            if (popoverSupported && !popup.matches(':popover-open')) {
                try { popup.showPopover(); positionPopup(); } catch (e) { /* ignore */ }
            }
        };
        const close = () => {
            if (popoverSupported && popup.matches(':popover-open')) {
                try { popup.hidePopover(); } catch (e) { /* ignore */ }
            }
        };

        let leaveTimer = null;
        const cancelLeave = () => { if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; } };
        const scheduleHide = () => {
            cancelLeave();
            leaveTimer = setTimeout(close, 80);
        };

        btn.addEventListener('mouseenter', () => { cancelLeave(); open(); });
        btn.addEventListener('mouseleave', scheduleHide);
        popup.addEventListener('mouseenter', cancelLeave);
        popup.addEventListener('mouseleave', scheduleHide);
        popup.addEventListener('toggle', (e) => {
            if (e.newState === 'open') positionPopup();
        });
    });
}

// Parse a rate string like "5%" or "+3%" into a decimal (0.05).
// Expand a search term to include fuzzy aliases (e.g., 'linepay' ↔ 'line pay').
function expandSearchTerm(term) {
    const t = String(term || '').toLowerCase().trim();
    if (!t) return [];
    const variants = new Set([t]);
    // Forward map: t → mapped
    if (typeof fuzzySearchMap !== 'undefined' && fuzzySearchMap[t]) {
        variants.add(String(fuzzySearchMap[t]).toLowerCase());
    }
    // Reverse map: any key whose value is t
    if (typeof fuzzySearchMap !== 'undefined') {
        Object.entries(fuzzySearchMap).forEach(([k, v]) => {
            if (String(v).toLowerCase() === t) variants.add(k.toLowerCase());
        });
    }
    return Array.from(variants);
}

// Does a promo's bonus_merchants list match the current search term/keywords?
// Returns true for *all_items if the card has any cashbackRate item matching the search.
function promoMerchantsMatchSearch(promo, card, merchantValue, quickKeywords) {
    if (!promo.bonus_merchants) return false;

    // Build the list of search terms (lowercased + fuzzy variants)
    const rawTerms = [];
    if (Array.isArray(quickKeywords) && quickKeywords.length > 0) {
        quickKeywords.forEach(k => { if (k) rawTerms.push(k); });
    } else if (merchantValue) {
        rawTerms.push(merchantValue);
    }
    if (rawTerms.length === 0) return false;
    const terms = rawTerms.flatMap(expandSearchTerm);
    if (terms.length === 0) return false;

    // Resolve actual merchants list (handles *all_items)
    const merchants = expandPromoMerchants(promo, card);
    if (!merchants || merchants.length === 0) return false;

    // Substring match either way (also against each merchant's fuzzy variants)
    return merchants.some(m => {
        const ml = String(m).toLowerCase();
        const mlVariants = expandSearchTerm(ml);
        return terms.some(t => mlVariants.some(mv => mv.includes(t) || t.includes(mv)));
    });
}

// Format bonus_rate for display: handle both '10%' strings and 0.1 decimals
// (Google Sheets percentage cells come through Apps Script as decimal numbers).
// Convert a promo bonus_rate to a decimal multiplier (0.1 for 10%).
// Accepts numbers (0.1 or 10) or strings ("10%", "10", "0.1").
function promoBonusRateToDecimal(rate) {
    if (rate == null || rate === '') return null;
    let n;
    if (typeof rate === 'number') {
        n = rate;
    } else {
        const s = String(rate).trim().replace('%', '');
        n = parseFloat(s);
    }
    if (isNaN(n)) return null;
    return n < 1 ? n : n / 100;
}

// Compute bonus cashback amount for a promo given the consumption amount.
// bonus_cap is a spend cap (回饋消費上限): spend above the cap earns only the
// card's basicCashback rate, matching how regular / designated-merchant rewards
// are calculated elsewhere.
function computePromoBonusAmount(promo, card, amount) {
    const rate = promoBonusRateToDecimal(promo.bonus_rate);
    if (rate == null || rate <= 0) return null;
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) return null;
    const hasCap = typeof promo.bonus_cap === 'number' && !isNaN(promo.bonus_cap);
    const cap = hasCap ? Number(promo.bonus_cap) : Infinity;
    const eligibleSpend = Math.min(amt, cap);
    const excessSpend = Math.max(0, amt - cap);
    const basicRate = (card && typeof card.basicCashback === 'number') ? card.basicCashback / 100 : 0;
    const cashback = eligibleSpend * rate + excessSpend * basicRate;
    return Math.round(cashback);
}

function formatBonusRate(rate) {
    if (rate == null || rate === '') return '';
    if (typeof rate === 'number') {
        // Decimal like 0.1 → '10%'; values >=1 treated as already-percentage (10 → '10%')
        const pct = rate < 1 ? rate * 100 : rate;
        const formatted = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
        return `${formatted}%`;
    }
    const s = String(rate).trim();
    if (!s) return '';
    if (s.includes('%')) return s;
    const n = parseFloat(s);
    if (!isNaN(n)) {
        const pct = n < 1 ? n * 100 : n;
        const formatted = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
        return `${formatted}%`;
    }
    return s;
}

// Build the highlighted detail rows for a single promo.
// Each row: { label, value, extra? }. 'value' renders with .cashback-amount;
// 'extra' (e.g. voucher_usage) renders inline in default colour next to value.
function buildPromoDetailRows(promo, card, amount, bonusApplies) {
    const rows = [];

    if (promo.gift_content) {
        rows.push({ label: '首刷禮', value: promo.gift_content, multiline: true });
    }

    if (promo.voucher_amount) {
        rows.push({
            label: '定額回饋',
            value: `NT$${Math.round(Number(promo.voucher_amount)).toLocaleString()}`,
            extra: promo.voucher_usage || ''
        });
    }

    if (bonusApplies && (promo.bonus_rate != null && promo.bonus_rate !== '')) {
        rows.push({ label: '回饋率', value: formatBonusRate(promo.bonus_rate) });
    }

    return rows;
}

// Does a card match the current merchant search? (used to decide whether to
// show its promos at all). A card matches if any of its cashbackRates items
// substring-matches the search term or any quick-search keyword.
// Render new cardholder promos below the regular results.
// Filters: card in cardsInComparison, NOT in myOwnedCards, has matching active promo.
function displayCardholderPromos(merchantValue, amount, quickKeywords) {
    const section = document.getElementById('cardholder-promos-section');
    const container = document.getElementById('cardholder-promos-container');
    if (!section || !container) return;

    container.innerHTML = '';

    if (!showCardholderPromos) {
        section.style.display = 'none';
        return;
    }

    if (!cardsData || !cardsData.newCardholderPromos || cardsData.newCardholderPromos.length === 0) {
        section.style.display = 'none';
        return;
    }

    // Candidate cards: in comparison AND not owned. Whether each promo
    // shows is decided by promoMerchantsMatchSearch below.
    const candidateCards = getCardsForComparison().filter(c => !myOwnedCards.has(c.id));

    const fragment = document.createDocumentFragment();
    let renderedCount = 0;

    candidateCards.forEach(card => {
        const promos = getActiveCardholderPromos(card.id);
        if (promos.length === 0) return;

        promos.forEach(promo => {
            // Strict rule: only show a promo if its bonus_merchants matches
            // the current search (incl. fuzzy aliases and *all_items expansion).
            if (!promoMerchantsMatchSearch(promo, card, merchantValue, quickKeywords)) return;

            // Build highlight rows (gift / voucher / bonus_rate); skip if empty.
            const rows = buildPromoDetailRows(promo, card, amount, true);
            if (rows.length === 0) return;

            // Identify which merchants from bonus_merchants actually matched the search
            const rawTerms = (Array.isArray(quickKeywords) && quickKeywords.length > 0)
                ? quickKeywords
                : [merchantValue || ''];
            const expandedTerms = rawTerms.flatMap(expandSearchTerm);
            const matchedMerchants = expandPromoMerchants(promo, card).filter(m => {
                const ml = String(m).toLowerCase();
                const mlVariants = expandSearchTerm(ml);
                return expandedTerms.some(t => mlVariants.some(mv => mv.includes(t) || t.includes(mv)));
            });

            const el = createCardholderPromoElement(card, promo, rows, matchedMerchants, { amount });
            fragment.appendChild(el);
            renderedCount++;
        });
    });

    if (renderedCount === 0) {
        section.style.display = 'none';
        return;
    }

    container.appendChild(fragment);
    section.style.display = 'block';
}

// Build the DOM element for a single cardholder promo result.
// Display order:
//   (卡名) → new_customer_summary → 重點 detail rows + 回饋消費上限(若有)
//   → 匹配項目 + 活動期間 (small, .matched-merchant style)
// Reuses .card-result / .card-details / .detail-item for visual parity.
// opts.hideCardName: omit the card name (used on the card detail page where
// the modal title already shows the card name).
function createCardholderPromoElement(card, promo, rows, matchedMerchants, opts = {}) {
    const el = document.createElement('div');
    el.className = 'card-result cardholder-promo-item fade-in';

    // First-spend gift image (detail page only): show when this is a 贈品 promo
    // and an image URL is provided in the sheet. Desktop floats it to the right;
    // mobile drops it full-width between the summary and the detail rows.
    const giftImageHtml = (opts.showExtras
        && Array.isArray(promo.promo_types) && promo.promo_types.some(t => t === '贈品' || t === '首刷禮')
        && promo.gift_image_url)
        ? `<img class="promo-gift-image" src="${escapeHtml(promo.gift_image_url)}" alt="首刷禮圖片" loading="lazy" onerror="this.style.display='none'">`
        : '';
    if (giftImageHtml) el.className += ' has-gift';

    const summary = promo.new_customer_summary || '';

    const period = (promo.period_start || promo.period_end)
        ? `${promo.period_start || ''}${promo.period_start && promo.period_end ? '~' : (promo.period_end ? '~' : '')}${promo.period_end || ''}`.trim()
        : '不限期';

    // Upcoming / ending-soon badges (same logic as card activities)
    // promo dates are already ISO YYYY-MM-DD; fall back to slash-to-ISO conversion
    let promoBadgeHtml = '';
    const isoStart = promo.period_start
        ? (promo.period_start.includes('-') ? promo.period_start : slashDateToISO(promo.period_start))
        : '';
    const isoEnd = promo.period_end
        ? (promo.period_end.includes('-') ? promo.period_end : slashDateToISO(promo.period_end))
        : '';
    let promoStatus = getRateStatus(isoStart, isoEnd);
    // getRateStatus 對「只有開始日、沒有結束日」回 'always'，這裡補判尚未開始的情況
    if (promoStatus === 'always' && isoStart && isoStart > getTaiwanToday()) {
        promoStatus = 'upcoming';
    }
    if (promoStatus === 'upcoming' && isoStart) {
        const daysUntil = getDaysUntilStart(isoStart);
        if (daysUntil != null) {
            const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
            promoBadgeHtml = ` <span class="upcoming-badge">即將開始 (${daysText})</span>`;
        }
    } else if (promoStatus === 'active' && isoEnd && isEndingSoon(isoEnd, 14)) {
        const daysUntil = getDaysUntilEnd(isoEnd);
        if (daysUntil != null) {
            const daysText = daysUntil === 0 ? '今天截止' : `剩 ${daysUntil} 天`;
            promoBadgeHtml = ` <span class="ending-soon-badge">${daysText}</span>`;
        }
    }

    const merchantsText = matchedMerchants && matchedMerchants.length > 0
        ? matchedMerchants.join('、')
        : '不限通路';

    const renderRow = (r) => `
        <div class="detail-item">
            <div class="detail-label">${escapeHtml(r.label)}</div>
            <div class="detail-value">
                <span class="cashback-amount">${r.multiline ? escapeHtmlMultiline(r.value) : escapeHtml(r.value)}</span>${r.extra ? ' ' + escapeHtml(r.extra) : ''}
            </div>
        </div>
    `;
    const renderPlainRow = (label, value) => `
        <div class="detail-item">
            <div class="detail-label">${escapeHtml(label)}</div>
            <div class="detail-value">${escapeHtml(value)}</div>
        </div>
    `;

    // Group rows: gift / voucher are full-width; bonus_rate pairs side-by-side
    // with the bonus_cap row when both exist.
    const bonusRateRow = rows.find(r => r.label === '回饋率');
    const fullWidthRows = rows.filter(r => r !== bonusRateRow);
    const hasCap = typeof promo.bonus_cap === 'number' && !isNaN(promo.bonus_cap);
    const capValue = hasCap ? `NT$${Math.round(Number(promo.bonus_cap)).toLocaleString()}` : '';

    // Search-result mode: compute and show the bonus cashback amount between rate and cap.
    const showAmount = !opts.showExtras && bonusRateRow;
    let amountRowHtml = '';
    if (showAmount) {
        const amt = computePromoBonusAmount(promo, card, opts.amount);
        if (amt != null) {
            amountRowHtml = `
                <div class="detail-item">
                    <div class="detail-label">回饋金額</div>
                    <div class="detail-value"><span class="cashback-amount">NT$${amt.toLocaleString()}</span></div>
                </div>`;
        }
    }

    const fullWidthHtml = fullWidthRows.map(renderRow).join('');
    let bonusGroupHtml = '';
    if (bonusRateRow && hasCap) {
        bonusGroupHtml = `<div class="promo-bonus-row">
            ${renderRow(bonusRateRow)}
            ${amountRowHtml}
            ${renderPlainRow('回饋消費上限', capValue)}
        </div>`;
    } else if (bonusRateRow) {
        bonusGroupHtml = renderRow(bonusRateRow) + amountRowHtml;
    } else if (hasCap) {
        bonusGroupHtml = renderPlainRow('回饋消費上限', capValue);
    }

    const highlightRowsHtml = fullWidthHtml + bonusGroupHtml;
    const capRowHtml = '';  // already merged into bonusGroupHtml above

    // Detail page shows extra context (notes); search results don't
    const notesHtml = (opts.showExtras && promo.notes)
        ? `<div class="matched-merchant">備註: ${escapeHtml(promo.notes)}</div>`
        : '';

    // Promo type chips — always an inline chips row under the header.
    // (右上角 corner chip 已於 2026-07-15 移除：手機上會和卡名旁的立即申辦 pill 重疊)
    let chipsHtml = '';
    if (Array.isArray(promo.promo_types) && promo.promo_types.length > 0) {
        const chips = promo.promo_types
            .map(t => `<span class="promo-type-chip promo-type-${promoTypeClass(t)}">${escapeHtml(t)}</span>`)
            .join('');
        chipsHtml = `<div class="promo-type-chips">${chips}</div>`;
    }

    // Apply CTA link (search results only) — small "立即申辦" pill next to card name
    let applyCtaBtnHtml = '';
    if (!opts.showExtras) {
        const applyCta = cardsData && cardsData.cardApplyCtas && cardsData.cardApplyCtas[card.id];
        // 鐵則 3：動態 href 先 sanitizeUrl（escapeHtml 擋不住 javascript: scheme）
        const applyLink = applyCta ? sanitizeUrl(applyCta.link) : '';
        if (applyLink) {
            applyCtaBtnHtml = `<a class="promo-apply-cta-btn" href="${escapeHtml(applyLink)}" target="_blank" rel="noopener noreferrer" data-card-id="${escapeHtml(card.id)}" data-card-name="${escapeHtml(card.name)}">立即申辦<svg class="promo-apply-cta-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><path d="M8 1h3v3"/><path d="M11 1 6 6"/></svg></a>`;
        }
    }

    const cardHeaderHtmlWithCta = opts.hideCardName ? '' : `
        <div class="card-header">
            <div class="card-name-with-pin">
                <h3 class="card-name">${escapeHtml(card.name)}</h3>
                <button type="button" class="card-detail-peek-btn" data-card-id="${escapeHtml(card.id)}" aria-label="查看卡片詳情" title="查看卡片詳情">ⓘ</button>
                ${applyCtaBtnHtml}
            </div>
        </div>`;

    el.innerHTML = `
        ${cardHeaderHtmlWithCta}
        ${chipsHtml}
        ${summary ? `<div class="promo-summary">${escapeHtml(summary)}</div>` : ''}
        ${giftImageHtml}
        <div class="card-details">
            ${highlightRowsHtml}
            ${capRowHtml}
        </div>
        ${promo.promo_condition ? `<div class="matched-merchant promo-condition"><div class="promo-condition-label">達成條件:</div><div class="promo-condition-text">${escapeHtmlMultiline(promo.promo_condition)}</div></div>` : ''}
        <div class="matched-merchant">匹配項目: <strong>${escapeHtml(merchantsText)}</strong></div>
        <div class="matched-merchant">活動期間: ${escapeHtml(period)}${promoBadgeHtml}</div>
        ${notesHtml}
    `;
    return el;
}

// Map a promo type label (贈品 / 回饋加碼 / 定額抵用) to a CSS modifier
function promoTypeClass(label) {
    if (label === '贈品' || label === '首刷禮') return 'gift';
    if (label === '回饋加碼') return 'bonus';
    if (label === '定額抵用' || label === '定額回饋') return 'voucher';
    return 'default';
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Like escapeHtml but preserves manual line breaks (Alt+Enter in Sheets ->
// \n) by converting them to <br>. Use for free-text fields that should keep
// their multi-line formatting (gift_content, promo_condition).
function escapeHtmlMultiline(s) {
    return escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>');
}

// 外部連結防護：只允許 http/https 開頭的網址，杜絕 javascript: 等危險 scheme
// 被塞進 href（連結值來自 Google Sheets 資料，多一層保險）。不合法時回傳空字串，
// 呼叫端拿到空字串就不要渲染該連結。
function sanitizeUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

// Sticky nav inside the card detail modal: hide buttons whose section is
// missing or empty, smooth-scroll on click, highlight active section.
let _cardDetailNavObserver = null;
function setupCardDetailNav(modalContent) {
    const nav = document.getElementById('card-detail-nav');
    if (!nav || !modalContent) return;

    const buttons = Array.from(nav.querySelectorAll('.card-detail-nav-btn'));

    // Disconnect any prior observer (modal opens once per card, but be safe)
    if (_cardDetailNavObserver) {
        _cardDetailNavObserver.disconnect();
        _cardDetailNavObserver = null;
    }

    // Hide buttons whose section is missing, has display:none, or has no real content
    const visibleSections = [];
    buttons.forEach(btn => {
        const id = btn.dataset.section;
        const section = id && document.getElementById(id);
        const hasContent = section && section.offsetParent !== null && section.textContent.trim().length > 0;
        btn.hidden = !hasContent;
        btn.classList.remove('active');
        if (hasContent) visibleSections.push({ btn, section });
    });

    if (visibleSections.length === 0) return;

    // While a click-initiated smooth scroll runs, scroll events must NOT
    // recompute the highlight: the target lands 8px below the nav (or the
    // scroll clamps at the bottom for short trailing sections), so a
    // position-based recompute would light up the PREVIOUS section instead
    // of the clicked one. The clicked button is highlighted immediately and
    // suppression lifts shortly after scroll events stop arriving.
    let suppressScrollHighlight = false;
    let scrollSettleTimer = null;
    const armScrollSettleTimer = (ms) => {
        clearTimeout(scrollSettleTimer);
        scrollSettleTimer = setTimeout(() => { suppressScrollHighlight = false; }, ms);
    };

    // Click → smooth-scroll the modal-content so section sits just under the sticky nav
    buttons.forEach(btn => {
        btn.onclick = () => {
            const section = document.getElementById(btn.dataset.section);
            if (!section) return;
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            suppressScrollHighlight = true;
            // Fallback release in case no scroll event fires (already at target)
            armScrollSettleTimer(400);
            // Rect-based delta (same basis as updateActive) so the section's
            // heading lands just below the sticky nav, not hidden under it.
            // offsetTop was relative to the wrong offsetParent and overshot on mobile.
            const navHeight = nav.offsetHeight;
            const containerTop = modalContent.getBoundingClientRect().top;
            const sectionTop = section.getBoundingClientRect().top;
            const delta = sectionTop - containerTop - navHeight - 8;
            modalContent.scrollTo({ top: modalContent.scrollTop + delta, behavior: 'smooth' });
        };
    });

    // Highlight the section currently in view (whichever is closest to the
    // top of the scroll viewport, accounting for the sticky nav height).
    // The detection line (nav + 12px) sits BELOW the click landing point
    // (nav + 8px): a section a nav button just scrolled to must count as
    // past the line, otherwise the previous section stays highlighted.
    const updateActive = () => {
        const navHeight = nav.offsetHeight;
        const containerTop = modalContent.getBoundingClientRect().top;
        let current = visibleSections[0];
        for (const s of visibleSections) {
            const top = s.section.getBoundingClientRect().top - containerTop - navHeight - 12;
            if (top <= 0) current = s;
            else break;
        }
        // 捲到底時，尾端的短區塊永遠碰不到判定線——此時點亮最後一個可見區塊
        if (modalContent.scrollTop + modalContent.clientHeight >= modalContent.scrollHeight - 2) {
            current = visibleSections[visibleSections.length - 1];
        }
        buttons.forEach(b => b.classList.remove('active'));
        if (current) current.btn.classList.add('active');
    };

    // Throttle scroll handler with rAF
    let ticking = false;
    const onScroll = () => {
        if (suppressScrollHighlight) {
            armScrollSettleTimer(150);
            return;
        }
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { updateActive(); ticking = false; });
    };
    modalContent.removeEventListener('scroll', modalContent._cardDetailNavScroll || (() => {}));
    modalContent._cardDetailNavScroll = onScroll;
    modalContent.addEventListener('scroll', onScroll, { passive: true });

    // Initial active state
    updateActive();
}

// Render new cardholder promos in the card detail modal.
// Hidden entirely (header included) when user owns this card.
function renderCardDetailPromos(card) {
    const section = document.getElementById('card-promos-section');
    const content = document.getElementById('card-promos-content');
    if (!section || !content) return;

    content.innerHTML = '';

    // Regulatory warning sits above the 新戶活動 heading; hidden until we
    // actually render promo cards below.
    const disclaimerEl = document.getElementById('card-promo-disclaimer');
    if (disclaimerEl) disclaimerEl.style.display = 'none';

    const promos = getActiveCardholderPromos(card.id);
    const applyCta = cardsData && cardsData.cardApplyCtas && cardsData.cardApplyCtas[card.id];
    const hasCta = !!(applyCta && (applyCta.text || applyCta.link));

    if (promos.length === 0 && !hasCta) {
        section.style.display = 'none';
        return;
    }

    // Render apply CTA (text + button) above the promo cards.
    if (hasCta) {
        const ctaEl = document.createElement('div');
        ctaEl.className = 'card-apply-cta';
        const textSpan = document.createElement('span');
        textSpan.className = 'card-apply-cta-text';
        textSpan.textContent = applyCta.text || '';
        ctaEl.appendChild(textSpan);
        // SVG arrow keeps the glyph identical across OS / fonts.
        const arrow = document.createElement('span');
        arrow.className = 'card-apply-cta-arrow';
        arrow.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h12M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        ctaEl.appendChild(arrow);
        const ctaLink = sanitizeUrl(applyCta.link);
        if (ctaLink) {
            const btn = document.createElement('a');
            btn.className = 'card-apply-cta-btn';
            btn.href = ctaLink;
            btn.target = '_blank';
            btn.rel = 'noopener noreferrer';
            btn.textContent = '立即申辦';
            btn.dataset.cardId = card.id;
            btn.dataset.cardName = card.name;
            ctaEl.appendChild(btn);
        }
        content.appendChild(ctaEl);
    }

    if (promos.length === 0) {
        // CTA-only case: nothing more to render but keep section visible.
        section.style.display = 'block';
        return;
    }

    // Use current amount-input value for bonus calculation; fall back to 1000.
    const amountInputEl = document.getElementById('amount-input');
    const amount = amountInputEl && amountInputEl.value !== '' ? parseFloat(amountInputEl.value) : 1000;

    const fragment = document.createDocumentFragment();

    promos.forEach(promo => {
        // In detail page, no merchant search context — show bonus regardless.
        const bonusApplies = !!promo.bonus_rate;

        const rows = buildPromoDetailRows(promo, card, amount, bonusApplies);
        if (rows.length === 0) return;

        // Show all bonus_merchants (or "本卡所有指定通路" for *all_items)
        let merchantList = [];
        if (promo.bonus_merchants) {
            if (isAllItemsMarker(promo.bonus_merchants)) {
                merchantList = ['本卡所有指定通路'];
            } else {
                merchantList = expandPromoMerchants(promo, card);
            }
        }

        const el = createCardholderPromoElement(card, promo, rows, merchantList, { hideCardName: true, showExtras: true });
        fragment.appendChild(el);
    });

    if (!fragment.hasChildNodes()) {
        if (hasCta) {
            section.style.display = 'block';
        } else {
            section.style.display = 'none';
        }
        return;
    }

    // Promo cards exist → reveal the warning above the 新戶活動 heading.
    if (disclaimerEl) disclaimerEl.style.display = 'block';

    content.appendChild(fragment);
    section.style.display = 'block';
}

// Create parking benefit element
function createParkingBenefitElement(benefit) {
    const benefitDiv = document.createElement('div');
    benefitDiv.className = 'parking-benefit-item fade-in';

    // Find card name
    const card = cardsData.cards.find(c => c.id === benefit.id);
    const cardName = card ? card.name : benefit.id;

    benefitDiv.innerHTML = `
        <div class="parking-header">
            <div class="parking-card-name">${cardName}</div>
        </div>
        <div class="parking-benefit-highlight">
            ${benefit.benefit_desc}
        </div>
        <div class="parking-details">
            <div class="parking-detail-item">
                <span class="parking-label">地點：</span>
                <span class="parking-value parking-merchants-highlight">${benefit.merchants.join('、')}</span>
            </div>
            <div class="parking-detail-item">
                <span class="parking-label">條件：</span>
                <span class="parking-value">${benefit.conditions || '無'}</span>
            </div>
            ${benefit.benefit_period ? `
            <div class="parking-detail-item">
                <span class="parking-label">期限：</span>
                <span class="parking-value">${benefit.benefit_period}</span>
            </div>
            ` : ''}
            ${benefit.notes ? `
            <div class="parking-detail-item">
                <span class="parking-label">備註：</span>
                <span class="parking-value">${benefit.notes}</span>
            </div>
            ` : ''}
        </div>
    `;

    return benefitDiv;
}

// Create coupon result element
function createCouponResultElement(coupon, amount) {
    const couponDiv = document.createElement('div');
    couponDiv.className = 'coupon-item fade-in';

    // Handle cap display - same as regular cards
    // Check if cap exists and is a valid number
    const capText = (coupon.cap && !isNaN(coupon.cap)) ? `NT$${Math.floor(Number(coupon.cap)).toLocaleString()}` : '無上限';

    // Debug log to check cap value
    if (coupon.merchant.includes('星巴克')) {
        console.log('星巴克 coupon cap:', coupon.cap, 'type:', typeof coupon.cap);
    }

    if (coupon.calculationLayers) {
        couponDiv.dataset.calcLayers = JSON.stringify(coupon.calculationLayers);
        couponDiv.dataset.calcAmount = amount;
    }

    couponDiv.innerHTML = `
        <div class="coupon-header">
            <div class="card-name-with-pin">
                <div class="coupon-merchant">${coupon.cardName}</div>
                <button type="button" class="card-detail-peek-btn" data-card-id="${escapeHtml(coupon.cardId)}" aria-label="查看卡片詳情" title="查看卡片詳情">ⓘ</button>
            </div>
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">回饋率</div>
                <div class="detail-value">${coupon.actualRate}%</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋金額</div>
                <div class="detail-value cashback-amount">
                    NT$${coupon.potentialCashback.toLocaleString()}
                    ${coupon.calculationLayers && coupon.calculationLayers.length > 0 ? `
                        <button type="button" class="calc-breakdown-btn" title="查看計算明細" aria-label="查看計算明細"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10.5" x2="8.01" y2="10.5"/><line x1="12" y1="10.5" x2="12.01" y2="10.5"/><line x1="16" y1="10.5" x2="16.01" y2="10.5"/><line x1="8" y1="14.5" x2="8.01" y2="14.5"/><line x1="12" y1="14.5" x2="12.01" y2="14.5"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg></button>
                    ` : ''}
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋消費上限</div>
                <div class="detail-value">${capText}</div>
            </div>
        </div>
        <div class="matched-merchant">
            條件: ${coupon.conditions}<br>匹配項目: <strong>${coupon.matchedMerchants ? coupon.matchedMerchants.join('、') : coupon.merchant}</strong>${coupon.period ? `<br>活動期間: ${coupon.period}` : ''}
        </div>
    `;

    return couponDiv;
}

// Create card result element
function createCardResultElement(result, originalAmount, searchedItem, isBest, isBasicCashback = false) {
    const cardDiv = document.createElement('div');
    const isUpcoming = result.isUpcoming === true;
    cardDiv.className = `card-result fade-in ${isBest ? 'best-card' : ''} ${result.cashbackAmount === 0 ? 'no-cashback' : ''} ${isUpcoming ? 'upcoming-activity' : ''}`;

    let capText = result.cap ? `NT$${Math.floor(result.cap).toLocaleString()}` : '無上限';
    // Special handling for Taishin Richart card cap display
    if (result.card.id === 'taishin-richart' && result.cap) {
        capText = `NT$${Math.floor(result.cap).toLocaleString()}+`;
    }
    const cashbackText = result.cashbackAmount > 0 ? 
                        `NT$${result.cashbackAmount.toLocaleString()}` : 
                        '無回饋';
    
    // All rates are already totaled, simply display the rate
    let rateDisplay = result.rate > 0 ? `${result.rate}%` : '0%';

    // Generate level label if card has levels and levelLabelFormat
    let levelLabel = '';
    if (result.card.hasLevels && result.card.levelLabelFormat && result.selectedLevel) {
        levelLabel = result.card.levelLabelFormat.replace('{level}', result.selectedLevel);
    }

    // Ending-soon badge (inline, next to period text)
    let endingSoonInlineBadge = '';
    if (!isUpcoming && result.periodEnd && isEndingSoon(result.periodEnd, 10)) {
        const daysUntil = getDaysUntilEnd(result.periodEnd);
        if (daysUntil != null) {
            const daysText = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : `${daysUntil}天後`;
            endingSoonInlineBadge = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }
    }

    // 檢查是否已釘選（使用 matchedItem）
    const merchantForPin = result.matchedItems && result.matchedItems.length > 0
        ? result.matchedItems.join('、')
        : result.matchedItem;
    const pinned = merchantForPin && !isBasicCashback ? isPinned(result.card.id, merchantForPin) : false;

    // Store layers for the breakdown button
    if (result.calculationLayers) {
        cardDiv.dataset.calcLayers = JSON.stringify(result.calculationLayers);
        cardDiv.dataset.calcAmount = originalAmount;
    }

    cardDiv.innerHTML = `
        <div class="card-header">
            <div class="card-name-with-pin">
                <div class="card-name">${result.card.name}</div>
                <button type="button" class="card-detail-peek-btn" data-card-id="${result.card.id}" aria-label="查看卡片詳情" title="查看卡片詳情">ⓘ</button>
                ${merchantForPin && !isBasicCashback ? `
                    <button class="pin-btn ${pinned ? 'pinned' : ''}"
                            data-card-id="${result.card.id}"
                            data-card-name="${result.card.name}"
                            data-merchant="${merchantForPin}"
                            data-rate="${result.rate}"
                            data-period-end="${result.periodEnd || ''}"
                            data-period-start="${result.periodStart || ''}"
                            title="${pinned ? '取消釘選' : '釘選此配對'}">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
            <div class="badges-container">
                ${isBest ? '<div class="best-badge">最優回饋</div>' : ''}
                ${isUpcoming && result.periodStart ? (() => {
                    const daysUntil = getDaysUntilStart(result.periodStart);
                    const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
                    return `<div class="upcoming-badge">即將開始 (${daysText})</div>`;
                })() : ''}
            </div>
        </div>
        <div class="card-details">
            <div class="detail-item">
                <div class="detail-label">回饋率</div>
                <div class="detail-value">${rateDisplay}${levelLabel ? `<br><small style="color: #6b7280; font-size: 12px; font-weight: normal;">(${levelLabel})</small>` : ''}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋金額</div>
                <div class="detail-value ${result.cashbackAmount > 0 ? 'cashback-amount' : 'no-cashback-text'}">
                    ${cashbackText}
                    ${result.calculationLayers && result.calculationLayers.length > 0 ? `
                        <button type="button" class="calc-breakdown-btn" title="查看計算明細" aria-label="查看計算明細"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10.5" x2="8.01" y2="10.5"/><line x1="12" y1="10.5" x2="12.01" y2="10.5"/><line x1="16" y1="10.5" x2="16.01" y2="10.5"/><line x1="8" y1="14.5" x2="8.01" y2="14.5"/><line x1="12" y1="14.5" x2="12.01" y2="14.5"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg></button>
                    ` : ''}
                </div>
                ${(() => {
    if (result.card.basicCashbackType) {
        const cashbackType = result.card.basicCashbackType;
        return `<div class="cashback-type-label">(${cashbackType})</div>`;
                    }
                    return '';
                })()}
            </div>
            <div class="detail-item">
                <div class="detail-label">回饋消費上限</div>
                <div class="detail-value">${capText}</div>
            </div>
        </div>
        ${(() => {
            if (isBasicCashback && !isUpcoming) {
                let conditionsText = '';
                // Check if card has domesticBonusConditions
                if (result.card.domesticBonusConditions) {
                    conditionsText = `<br><small>條件: ${result.card.domesticBonusConditions}</small>`;
                }
                return `
                    <div class="matched-merchant">
                        一般消費回饋率${conditionsText}
                    </div>
                `;
            } else if (result.matchedItem) {
                let additionalInfo = '';
                // 滿額/未滿門檻是重要條件：獨立一行、黑色粗體、置於匹配項目上方
                // （緊貼回饋數字；2026-07-17 用戶定案，字級與匹配項目一致、不加特別色）
                let thresholdLine = '';

                // For upcoming activities, show period from result directly
                if (isUpcoming) {
                    if (result.period) {
                        additionalInfo += `<br><small>活動期間: ${result.period}</small>`;
                    } else if (result.periodStart && result.periodEnd) {
                        additionalInfo += `<br><small>活動期間: ${formatISODateForDisplay(result.periodStart)}~${formatISODateForDisplay(result.periodEnd)}</small>`;
                    }
                } else if (result.matchedRateGroup) {
                    // For active activities, use matchedRateGroup
                    const period = result.matchedRateGroup.period;
                    const conditions = result.matchedRateGroup.conditions;
                    const minSpend = result.matchedRateGroup.minSpend;

                    if (period) additionalInfo += `<br><small>活動期間: ${period}${endingSoonInlineBadge}</small>`;
                    if (conditions) additionalInfo += `<br><small>條件: ${conditions}</small>`;
                    // 滿額/未滿門檻標註（見 docs/project/cross-slot-ref-and-minspend-spec.md）：
                    // 搜尋結果卡片是獨立於詳情頁的 render 路徑，門檻標註要在這裡另外補上，
                    // 否則使用者在搜尋結果看不出這個活動有消費金額限制。
                    // maxSpend（未滿門檻）只影響匹配、不顯示標註（2026-07-17 用戶定案）
                    if (minSpend) thresholdLine += `<div class="spend-threshold-note">✔ 單筆滿 NT$${escapeHtml(Math.floor(minSpend).toLocaleString())}</div>`;
                } else if (endingSoonInlineBadge && result.periodEnd) {
                    const periodDisplay = result.periodStart
                        ? `${formatISODateForDisplay(result.periodStart)}~${formatISODateForDisplay(result.periodEnd)}`
                        : `~${formatISODateForDisplay(result.periodEnd)}`;
                    additionalInfo += `<br><small>活動期間: ${periodDisplay}${endingSoonInlineBadge}</small>`;
                }
                
                const categoryInfo = result.matchedCategory ? ` (類別: ${getCategoryDisplayName(result.matchedCategory)})` : '';
                
                // Special handling for Yushan Uni card exclusions in search results
                let exclusionNote = '';
                if (result.card.id === 'yushan-unicard' && 
                    (result.matchedItem === '街口' || result.matchedItem === '全支付')) {
                    exclusionNote = ' <small style="color: #f59e0b; font-weight: 500;">(排除超商)</small>';
                }
                
                // If multiple items matched (e.g., multiple travel agencies), show all
                let matchedItemsText = result.matchedItem;
                if (result.matchedItems && result.matchedItems.length > 1) {
                    matchedItemsText = result.matchedItems.join('、');
                }

                return `
                    ${thresholdLine}
                    <div class="matched-merchant">
                        匹配項目: <strong>${matchedItemsText}</strong>${exclusionNote}${categoryInfo}${additionalInfo}
                    </div>
                `;
            } else {
                return `
                    <div class="matched-merchant">
                        此卡無此項目回饋
                    </div>
                `;
            }
        })()}
    `;
    
    return cardDiv;
}

// Show a small inline breakdown popup when the user clicks "算式"
// Tracks which button currently has its breakdown open, so a second click on
// the SAME button toggles it closed, while clicking a DIFFERENT button closes
// the old one and opens the new one (instead of just closing whatever was open).
let openBreakdownBtn = null;

function closeOpenBreakdown() {
    if (openBreakdownBtn) {
        openBreakdownBtn.closest('.card-result, .coupon-item')?.querySelector('.calc-breakdown-popup')?.remove();
        openBreakdownBtn.classList.remove('active');
        openBreakdownBtn = null;
    }
}

function showCalcBreakdown(btn, cardResult) {
    // Clicking the button whose popup is already open just closes it
    if (openBreakdownBtn === btn) {
        closeOpenBreakdown();
        return;
    }

    // Otherwise close whichever popup was open elsewhere, then open this one
    closeOpenBreakdown();

    const layers = JSON.parse(cardResult.dataset.calcLayers || '[]');
    if (!layers.length) return;

    // 4 columns, no header: 項目 | 適用金額 | 回饋率 | 回饋金額
    // "封頂" marks a layer whose applicable amount was clamped by its cap.
    // 依回饋率高→低排列（2026-07-16 站長要求；Total 列固定最後不參與排序）
    layers.sort((a, b) => (parseFloat(b.rate) || 0) - (parseFloat(a.rate) || 0));
    const rows = layers.map(layer => {
        const amtLabel = `NT$${Math.floor(layer.applicableAmount).toLocaleString()}`;
        const cashLabel = `NT$${Math.floor(layer.cashback).toLocaleString()}`;
        const isCapped = layer.cap != null && layer.applicableAmount >= layer.cap;
        const cappedTag = isCapped ? `<span class="breakdown-capped">（封頂）</span>` : '';
        return `<tr>
            <td class="bd-name">${escapeHtml(String(layer.name))}</td>
            <td class="bd-amt">${amtLabel}</td>
            <td class="bd-rate">${layer.rate}%</td>
            <td class="bd-cash">${cashLabel}${cappedTag}</td>
        </tr>`;
    }).join('');

    // Total row: sum cashback across layers; total spending = actual amount
    // entered (NOT sum of applicable amounts, which overlaps for bonus/stacking).
    const totalCash = layers.reduce((s, l) => s + Math.floor(l.cashback), 0);
    const totalAmount = parseInt(cardResult.dataset.calcAmount, 10) || 0;
    const totalRow = `<tr class="bd-total">
        <td class="bd-name">Total</td>
        <td class="bd-amt">NT$${totalAmount.toLocaleString()}</td>
        <td class="bd-rate"></td>
        <td class="bd-cash">NT$${totalCash.toLocaleString()}</td>
    </tr>`;

    const popup = document.createElement('div');
    popup.className = 'calc-breakdown-popup';
    popup.innerHTML = `<table class="breakdown-table"><tbody>${rows}${totalRow}</tbody></table>`;

    // Append INSIDE the card/coupon box (not as a grid sibling) so it's visually
    // anchored to its own result — doesn't shift other grid items around, and
    // reads clearly as "this card's breakdown" instead of a floating panel.
    cardResult.appendChild(popup);
    btn.classList.add('active');
    openBreakdownBtn = btn;
    popup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// Close breakdown popup when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.calc-breakdown-popup') && !e.target.closest('.calc-breakdown-btn')) {
        closeOpenBreakdown();
    }
}, true);

// 詳情頁「回饋組成」抽屜：展開/收合各成分的回饋率與上限（不含金額，
// 與搜尋結果的計算明細不同——那個要有消費金額才算得出來）。
// 一次只開一個；資料來自按鈕的 data-comp（rateCompositionButtonHtml 產生）。
function toggleRateComposition(btn) {
    const item = btn.closest('.cashback-detail-item');
    if (!item) return;
    const wasOpen = !!item.querySelector('.calc-breakdown-popup');

    // 先關掉所有開著的組成抽屜（含自己）
    document.querySelectorAll('.cashback-detail-item .calc-breakdown-popup').forEach(p => p.remove());
    document.querySelectorAll('.cashback-detail-item .calc-breakdown-btn.active').forEach(b => b.classList.remove('active'));
    if (wasOpen) return; // 點的是已開啟的按鈕 → 收合即可

    let comp;
    try { comp = JSON.parse(btn.dataset.comp || '{}'); } catch (e) { return; }
    if (!comp.rows || !comp.rows.length) return;

    // 依回饋率高→低排列（2026-07-16 站長要求；合計列固定最後不參與排序）
    comp.rows.sort((a, b) => (parseFloat(b.rate) || 0) - (parseFloat(a.rate) || 0));
    const rows = comp.rows.map(r => `<tr>
        <td class="bd-name">${escapeHtml(String(r.name))}</td>
        <td class="bd-rate">${r.rate}%</td>
        <td class="bd-amt">${r.cap ? `上限 NT$${Math.floor(r.cap).toLocaleString()}` : '無上限'}</td>
    </tr>`).join('');
    const totalRow = `<tr class="bd-total"><td class="bd-name">合計</td><td class="bd-rate">${comp.total}%</td><td class="bd-amt"></td></tr>`;

    const popup = document.createElement('div');
    popup.className = 'calc-breakdown-popup';
    popup.innerHTML = `<table class="breakdown-table"><tbody>${rows}${totalRow}</tbody></table>`;
    item.appendChild(popup);
    btn.classList.add('active');
}

// Format currency

// Authentication setup
//
// Firebase 是從 gstatic 載入的外部模組，在公司網路/擋廣告環境可能永遠載不到。
// 過去的寫法是無限 100ms 輪詢直到 Firebase 就緒才綁定任何 UI 事件——
// Firebase 載不到＝整站卡在 boot loader，訪客連「計算」按鈕都按不到。
// 現在拆成兩條路：
//   - firebaseReadyHandled 之前（最多等 FIREBASE_FALLBACK_MS）：持續輪詢等 Firebase。
//   - 逾時仍未就緒：ensureGuestUIBound() 立即以訪客模式綁定 UI（不重複，見下方 guard），
//     輪詢繼續在背景跑；Firebase 之後就緒時只補跑 ensureAuthSubscribed()，不重新綁定事件。
const FIREBASE_FALLBACK_MS = 4000;

