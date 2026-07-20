// Calculate cashback for all cards
async function calculateCashback() {
    console.log('🔄 calculateCashback 被調用');
    console.log('cardsData:', cardsData ? `已載入 (${cardsData.cards.length} 張卡)` : '未載入');

    const startTime = performance.now();

    // Clear rate status cache at the start of each calculation
    rateStatusCache.clear();

    if (!cardsData) {
        console.error('❌ cardsData 未載入，無法計算');
        return;
    }

    // Loading overlay 延遲顯示：多數計算（包含訪客的全部案例）在 80-155ms 內完成，
    // 立刻顯示 overlay 對快搜尋只會造成閃爍、沒有實際回饋感。改成「超過 150ms 才顯示」
    // ——只有真的慢（主要是登入用戶第一次計算要序列等 Firestore getDoc）才會看到。
    // 已知限制：純 CPU 阻塞主執行緒時，這個 timer 本身也要等主執行緒讓出才會觸發，
    // overlay 可能到計算尾端才畫出來；Firestore 等待型的慢（主要場景）會正常顯示，
    // 因為 await 會讓出主執行緒，timer 能準時觸發。
    const loadingShowTimer = setTimeout(() => {
        loadingOverlay.show('正在計算回饋...');
    }, 150);

    try {

    const amount = amountInput.value === '' ? 1000 : parseFloat(amountInput.value);
    const merchantValue = merchantInput.value.trim();

    console.log('輸入：', { merchantValue, amount });
    console.log('currentMatchedItem:', currentMatchedItem);

    // 追蹤計算回饋事件
    if (window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'calculate_cashback', {
            merchant: merchantValue,
            amount: amount,
            has_match: currentMatchedItem ? true : false
        });
    }

    let results;
    let isBasicCashback = false;
    let uniqueUpcomingResults = [];  // Define here for proper scope

    // Get cards to compare (user selected or all)
    const cardsToCompare = getCardsForComparison();

    console.log(`比較 ${cardsToCompare.length} 張卡片`);
    
    if (currentMatchedItem) {
        // User input matched specific items - show special cashback rates for ALL matched items
        let allResults = [];
        
        if (Array.isArray(currentMatchedItem)) {
            // Multiple matches - calculate for all items and show best card for EACH item
            const allItemResults = [];

            console.log(`🔍 處理 ${currentMatchedItem.length} 個匹配項目`);

            for (const matchedItem of currentMatchedItem) {
                const searchTerm = matchedItem.originalItem.toLowerCase();
                console.log(`  📝 計算項目: ${matchedItem.originalItem}`);

                const itemResults = await Promise.all(cardsToCompare.map(async card => {
                    const results = await calculateCardCashback(card, searchTerm, amount);
                    // calculateCardCashback now returns an array of all matching activities
                    return results.map(result => ({
                        ...result,
                        card: card,
                        matchedItemName: result.matchedItem // 使用卡片實際匹配到的item，而非搜尋詞
                    }));
                })).then(results => results.flat().filter(result => result.cashbackAmount > 0));

                if (itemResults.length > 0) {
                    // Sort by cashback amount (highest first)
                    itemResults.sort((a, b) => b.cashbackAmount - a.cashbackAmount);

                    // Add ALL cards with cashback, not just the best one
                    allItemResults.push(...itemResults);
                }
            }

            // Merge results from same card and same activity
            allResults = mergeResultsByActivity(allItemResults);

            console.log(`📊 合併前: ${allItemResults.length} 個結果，合併後: ${allResults.length} 個結果`);
        } else {
            // Single match - backward compatibility
            const searchTerm = currentMatchedItem.originalItem.toLowerCase();
            const itemResults = await Promise.all(cardsToCompare.map(async card => {
                const results = await calculateCardCashback(card, searchTerm, amount);
                // calculateCardCashback now returns an array of all matching activities
                return results.map(result => ({
                    ...result,
                    card: card,
                    matchedItemName: result.matchedItem
                }));
            })).then(results => results.flat().filter(result => result.cashbackAmount > 0));

            // Merge results from same card and same activity
            allResults = mergeResultsByActivity(itemResults);

            console.log(`📊 合併前: ${itemResults.length} 個結果，合併後: ${allResults.length} 個結果`);
        }
        
        results = allResults;

        // Also find upcoming activities (within 30 days)
        const upcomingResults = [];
        if (currentMatchedItem) {
            const searchTermsForUpcoming = Array.isArray(currentMatchedItem)
                ? currentMatchedItem.map(item => item.originalItem.toLowerCase())
                : [currentMatchedItem.originalItem.toLowerCase()];

            for (const searchTerm of searchTermsForUpcoming) {
                const upcomingActivities = await Promise.all(cardsToCompare.map(async card => {
                    const activities = await findUpcomingActivity(card, searchTerm, amount);
                    // findUpcomingActivity now returns an array
                    return activities.map(activity => ({
                        card: card,
                        ...activity,
                        isUpcoming: true,
                        matchedItemName: activity.matchedItem
                    }));
                }));

                upcomingResults.push(...upcomingActivities.flat());
            }
        }

        // Merge upcoming results from same card and same activity
        uniqueUpcomingResults = mergeResultsByActivity(upcomingResults);

        console.log(`📊 Upcoming 合併前: ${upcomingResults.length} 個結果，合併後: ${uniqueUpcomingResults.length} 個結果`);

        // Show no-match message and basic rates when no special rates found
        if (results.length === 0 && merchantValue.length > 0) {
            showNoMatchMessage(merchantValue, cardsToCompare);
            // Show basic cashback for selected cards when no special rates found
            isBasicCashback = true;

            results = cardsToCompare.map(card => buildBasicCashbackResult(card, amount));
        }
    } else {
        // No match found or no input - show basic cashback for selected cards
        isBasicCashback = true;

        results = cardsToCompare.map(card => buildBasicCashbackResult(card, amount));

        // Show no match message if user has typed something
        if (merchantValue.length > 0) {
            showNoMatchMessage(merchantValue, cardsToCompare);
        }

        // Still search for upcoming activities even without active matches
        if (merchantValue.length > 0) {
            const upcomingResults = [];
            const searchTerm = merchantValue.toLowerCase();
            const upcomingActivities = await Promise.all(cardsToCompare.map(async card => {
                const activities = await findUpcomingActivity(card, searchTerm, amount);
                return activities.map(activity => ({
                    card: card,
                    ...activity,
                    isUpcoming: true,
                    matchedItemName: activity.matchedItem
                }));
            }));
            upcomingResults.push(...upcomingActivities.flat());

            uniqueUpcomingResults = mergeResultsByActivity(upcomingResults);
        }
    }
    
    // Sort active results by cashback amount (highest first)
    results.sort((a, b) => b.cashbackAmount - a.cashbackAmount);

    // Append upcoming results after active results (if they exist)
    if (typeof uniqueUpcomingResults !== 'undefined' && uniqueUpcomingResults.length > 0) {
        // Sort upcoming results by cashback amount (highest first)
        uniqueUpcomingResults.sort((a, b) => b.cashbackAmount - a.cashbackAmount);
        // Append all upcoming results (even if card already has active result)
        results = [...results, ...uniqueUpcomingResults];
    }

    // Display results - handle multiple matched items
    let displayedMatchItem;
    if (currentMatchedItem) {
        if (Array.isArray(currentMatchedItem)) {
            displayedMatchItem = currentMatchedItem.map(item => item.originalItem).join('、');
        } else {
            displayedMatchItem = currentMatchedItem.originalItem;
        }
    } else {
        displayedMatchItem = merchantValue;
    }

    displayResults(results, amount, displayedMatchItem, isBasicCashback);

    // Display coupon cashbacks
    await displayCouponCashbacks(amount, merchantValue);

    // Display parking benefits - pass quick search keywords if available
    displayParkingBenefits(merchantValue, cardsToCompare, currentQuickSearchOption?.merchants);

    // Display new cardholder promos (filtered by user toggle, ownership, and merchant match)
    displayCardholderPromos(merchantValue, amount, currentQuickSearchOption?.merchants);

    const duration = performance.now() - startTime;
    console.log(`⏱️ calculateCashback 完成 - 耗時: ${duration.toFixed(2)}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`📊 比較了 ${cardsToCompare.length} 張卡片，找到 ${results.length} 個結果`);

    } catch (err) {
        console.error('❌ calculateCashback 發生錯誤:', err);
    } finally {
        // 無條件清 timer + hide：若 150ms timer 還沒觸發就先 clearTimeout（overlay
        // 從未顯示過，loadingOverlay.hide() 的 shown guard 讓這是安全的 no-op）；
        // 若 timer 已經顯示了 overlay，這裡負責收尾隱藏。
        clearTimeout(loadingShowTimer);
        loadingOverlay.hide();
    }
}

// Get all search term variants for comprehensive matching
function getAllSearchVariants(searchTerm) {
    const searchLower = searchTerm.toLowerCase().trim();
    let searchTerms = [searchLower];
    
    // Add fuzzy search mapping if exists
    if (fuzzySearchMap[searchLower]) {
        const mappedTerm = fuzzySearchMap[searchLower].toLowerCase();
        if (!searchTerms.includes(mappedTerm)) {
            searchTerms.push(mappedTerm);
        }
    }
    
    // Also add reverse mappings (find all terms that map to current search)
    Object.entries(fuzzySearchMap).forEach(([key, value]) => {
        if (value.toLowerCase() === searchLower && !searchTerms.includes(key)) {
            searchTerms.push(key);
        }
    });
    
    return searchTerms;
}

// 判斷搜尋詞是否「包含」某個項目名稱（term ⊇ item）。
// 中文允許任意 substring；英文要求詞彙邊界，避免 "singapore" 誤含 "gap"。
function termContainsItemWithBoundary(term, itemLower) {
    if (!term.includes(itemLower)) return false;
    const isChinese = /[\u4e00-\u9fa5]/.test(itemLower);
    if (isChinese) return true;
    const wordBoundaryRegex = new RegExp(
        `(^|\\s|[^a-z])${itemLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-z])`,
        'i'
    );
    return wordBoundaryRegex.test(term);
}

// 把商家名稱拆成可比對單元：主名稱（去掉括號）+ 每個括號內的別名。
// 括號是「唯一」的別名邊界（空格不算），所以雙語商家請統一寫成「中文名 (English)」。
// e.g. "酷澎 (Coupang)"      → ["酷澎", "coupang"]
//      "肯德基 (KFC)"        → ["肯德基", "kfc"]
//      "ToCoo! 日本租車網"   → ["tocoo! 日本租車網"]（無括號 → 整串當一個單元）
function getMerchantSearchUnits(merchantName) {
    const lower = String(merchantName || '').toLowerCase();
    const units = [];
    // 抓出所有括號內容（支援半形 () 與全形 （））
    const bracketRegex = /[(（]([^)）]*)[)）]/g;
    let m;
    while ((m = bracketRegex.exec(lower)) !== null) {
        const inner = m[1].trim();
        if (inner) units.push(inner);
    }
    // 去掉所有括號後的主名稱
    const main = lower.replace(/[(（][^)）]*[)）]/g, '').trim();
    if (main) units.push(main);
    return units.length > 0 ? units : [lower];
}

// B 類（補充資訊）嚴格比對：商家名稱 vs 已 fuzzy 展開的搜尋詞陣列。
// 規則：把商家拆成單元後，任一單元與任一搜尋詞 exact 或雙向 startsWith 即算命中。
// 嚴格的 startsWith（而非 includes）可避免 "日本7-ELEVEN門市" 誤匹配 "7-ELEVEN"。
// unit.startsWith(term) 額外排除「配對後緊接空白+全新英文單字」的情況，
// 避免 "Line Pay" 誤配到完全不同的產品 "Line Pay Money"（"money" 是新單字，不是同一商家的註記）。
// 雙語商家名稱請統一寫成 "中文 (English)" 括號格式（見 getMerchantSearchUnits），
// 才會被拆成獨立 unit 做 exact 比對，不會受此規則影響。
function merchantMatchesStrict(merchantName, searchVariants) {
    const units = getMerchantSearchUnits(merchantName);
    return units.some(unit =>
        searchVariants.some(term => {
            if (term === unit || term.startsWith(unit)) return true;
            if (unit.startsWith(term)) {
                const rest = unit.slice(term.length);
                const isNewEnglishWord = /^\s+[a-z]/i.test(rest);
                return !isNewEnglishWord;
            }
            return false;
        })
    );
}

// 取得類別顯示名稱
function getCategoryDisplayName(category) {
    const categoryMap = {
        '玩數位': '切換「玩數位」方案',
        '樂饗購': '切換「樂饗購」方案',
        '趣旅行': '切換「趣旅行」方案',
        '集精選': '切換「集精選」方案',
        '來支付': '切換「來支付」方案',
        '童樂匯': '切換「童樂匯」方案'
    };
    return categoryMap[category] || category;
}

// Helper function to get category display style (blue chip)
function getCategoryStyle(category) {
    if (!category) return '';
    return 'display: inline-block; background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; vertical-align: middle;';
}

// Base cashback rate for a domestic vs overseas transaction. Overseas falls
// back to basicCashback if the card has no dedicated overseasCashback field.
function resolveBaseRate(card, isOverseas) {
    return isOverseas ? (card.overseasCashback || card.basicCashback) : card.basicCashback;
}

// Domestic/海外 bonus component (rate + cap + display name) for a card+level.
// Priority: levelSettings first (bonus varies per level, e.g. 大戶卡),
// then top-level card fields (bonus is level-independent for all other
// cards, e.g. DBS Eco, 凱基誠品, 中信 uniopen, 滙豐 Live+, iLEO…).
// cap === null means uncapped (無上限). Shared by calculateLayeredCashback
// (Tier 3) and calculateStackedCashback (Layer 2) — same lookup either way.
function resolveBonusComponent(card, levelSettings, isOverseas) {
    if (isOverseas) {
        const rate = (levelSettings && levelSettings.overseasBonusRate) || card.overseasBonusRate || 0;
        const rawCap = (levelSettings && levelSettings.overseasBonusCap != null)
            ? levelSettings.overseasBonusCap : card.overseasBonusCap;
        return { rate, cap: (rawCap != null && rawCap > 0) ? rawCap : null, name: '海外消費加碼' };
    }
    const rate = (levelSettings && levelSettings.domesticBonusRate) || card.domesticBonusRate || 0;
    const rawCap = (levelSettings && levelSettings.domesticBonusCap != null)
        ? levelSettings.domesticBonusCap : card.domesticBonusCap;
    return { rate, cap: (rawCap != null && rawCap > 0) ? rawCap : null, name: '國內消費加碼' };
}

// Overflow rate for the simple (cap→rate_N, overflow→basic) path: basicCashback.
// Shared by calculateCardCashback's simple path and findUpcomingActivity.
// （2026-07-12 移除 meta/google 廣告 → overseasCashback 特例：所有廣告槽位
// 已改用明確的 cashbackModel（stacking），不再進簡單路徑——海外與否一律由
// cashbackModel 決定，程式不認通路名稱。）
function getOverflowRate(card) {
    return resolveBaseRate(card, false);
}

// ========== 跨槽引用 rate_N（見 docs/project/cross-slot-ref-and-minspend-spec.md）==========
// 語法：stacking（"+"）cashbackModel 字串裡的成分寫成裸 `rate_N`（無大括號），
// N＝同卡 card.cashbackRates 陣列的 1-based 槽位編號，引用「兄弟槽」。
// 與 `{rate_1}`（大括號、在 rate/cap 值欄位、hasLevels 卡讀 levelSettings）是完全
// 不同的兩套語法、不同欄位，不衝突——見 cashback-engine.md 第 6 節「命名澄清」。
const CROSS_SLOT_REF_RE = /^rate_(\d+)$/;

// 找出 cashbackModel（或其任一分隔符切出的成分）裡的 rate_N token，不管格式合不合法。
// 用於 stacking 分支之外的偵測（那些分支不支援 rate_N，只需要抓出來供 warn 用）。
function findRateNTokens(cashbackModel) {
    if (!cashbackModel) return [];
    const matches = cashbackModel.match(/rate_\d+/g);
    return matches || [];
}

// 用穩定 slot 號（Sheet 真實槽號，見 apps-script/cards-export.gs 的 rateObj.slot）
// 定位被引用槽，取代「陣列位置 cashbackRates[N-1]」——中間跳號（如 slot 1,3,5）
// 時陣列位置會漂移，slot 號不會。
// 相容：若這張卡的 cashbackRates 都沒有 `.slot` 欄（舊 cards.data 尚未重匯出），
// 退回舊的陣列位置 [N-1] 邏輯，行為不變。
function findRateGroupBySlot(card, slotNum) {
    const rates = card.cashbackRates;
    const hasSlotField = rates.some(rg => rg && rg.slot != null);
    if (hasSlotField) {
        return rates.find(rg => rg && rg.slot === slotNum) || null;
    }
    return rates[slotNum - 1] || null;
}

// 解析 stacking cashbackModel 裡的 rate_N 跨槽引用，回傳獨立 layer 陣列
// [{ rate, cap, name }]，供 calculateStackedCashback 疊加。
// 非遞迴：只讀被引用槽的原始 rate/cap 數字，不執行它自己的 cashbackModel
// ——這是避免循環引用、避免重複算 basic 的關鍵設計。
// 被引用槽若是 {...} placeholder（hasLevels 卡），用同一 levelSettings 經
// parseCashbackRate/parseCashbackCap 解析，與現有 placeholder 系統一致。
function resolveCrossSlotLayers(card, cashbackModel, levelSettings) {
    if (!card || !cashbackModel || !Array.isArray(card.cashbackRates)) return [];
    const layers = [];
    for (const rawToken of cashbackModel.split('+')) {
        const token = rawToken.trim();
        const m = token.match(CROSS_SLOT_REF_RE);
        if (!m) continue;
        const slotNum = parseInt(m[1], 10);
        const refGroup = findRateGroupBySlot(card, slotNum);
        if (!refGroup) {
            console.error(`❌ ${card.name || card.id}: cashbackModel "${cashbackModel}" 引用不存在的槽 rate_${slotNum}（該卡只有 ${card.cashbackRates.length} 槽）`);
            continue;
        }
        const refRate = parseCashbackRate(refGroup.rate, card, levelSettings);
        const refCap = parseCashbackCap(refGroup.cap, card, levelSettings);
        layers.push({ rate: refRate, cap: refCap, name: refGroup.category || `活動${slotNum}加碼` });
    }
    return layers;
}

// rate_N 僅在 stacking（"+"）分支支援；waterfall（">"）與裸 rate 分支偵測到就
// console.error 一筆並忽略該 token（不得靜默算錯）——見 spec 功能一末段。
function warnIfCrossSlotRefMisused(card, cashbackModel) {
    const tokens = findRateNTokens(cashbackModel);
    if (tokens.length === 0) return;
    console.error(`❌ ${card.name || card.id}: cashbackModel "${cashbackModel}" 在非 stacking("+") 分支使用 ${tokens.join(', ')}——跨槽引用僅 "+" 支援，已忽略該 token`);
}

// The rate to SHOW the user for a cashbackRate item. For stacking models
// ("...+...BonusRate", e.g. Sport 卡 Apple Pay) rate_N holds only the
// designated-channel rate, so the displayed rate is designated + basic + bonus
// (3%+1%+1% = 5%) — identical to what the search-result card shows (this mirrors
// calculateStackedCashback's totalRate). For every other model, or blank,
// rate_N is already a total and is shown as-is.
// 跨槽引用（裸 rate_N，見上方）也計入加總，讓排序與詳情頁顯示跟實際計算一致。
function getDisplayRate(card, rateGroup, designatedRate, levelSettings) {
    const model = rateGroup && rateGroup.cashbackModel;
    if (!model || !model.includes('+')) return designatedRate;
    const isOverseas = model.includes('overseasBonusRate');
    // Fix B（2026-07-16）：基本層與加碼層都只在 model 字串明確列出對應成分時才計入，
    // 不再無條件加——「寫什麼才加什麼」。基本層關鍵字＝basic 或 overseasCashback
    // （海外 model 用 basic 寬鬆指代 overseasCashback base，故兩者任一即算有列基準）。
    // 見 cashback-engine.md 第 6 節、calculateStackedCashback 的 applyBase/applyBonus gate。
    const applyBase = model.includes('basic') || model.includes('overseasCashback');
    const applyBonus = model.includes('domesticBonusRate') || model.includes('overseasBonusRate');
    const basicRate = applyBase ? resolveBaseRate(card, isOverseas) : 0;
    const { rate: bonusRateRaw } = resolveBonusComponent(card, levelSettings, isOverseas);
    const bonusRate = applyBonus ? bonusRateRaw : 0;
    const crossSlotRate = resolveCrossSlotLayers(card, model, levelSettings)
        .reduce((sum, layer) => sum + (layer.rate || 0), 0);
    return Math.round((designatedRate + basicRate + bonusRate + crossSlotRate) * 100) / 100;
}

// 詳情頁「回饋組成」按鈕（計算機圖示）：只有 stacking 模型（cashbackModel 含 '+'）
// 需要解釋加總的來源（如 5% = 3%+1%+1%）；其他模型 rate 即總率，不顯示按鈕。
// 組成資料以 JSON 存在按鈕的 data-comp，點擊由 toggleRateComposition 展開抽屜。
const CALC_BREAKDOWN_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10.5" x2="8.01" y2="10.5"/><line x1="12" y1="10.5" x2="12.01" y2="10.5"/><line x1="16" y1="10.5" x2="16.01" y2="10.5"/><line x1="8" y1="14.5" x2="8.01" y2="14.5"/><line x1="12" y1="14.5" x2="12.01" y2="14.5"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg>';
function rateCompositionButtonHtml(card, rateGroup, designatedRate, designatedCap, levelSettings) {
    const model = rateGroup && rateGroup.cashbackModel;
    if (!model || !model.includes('+')) return '';
    const isOverseas = model.includes('overseasBonusRate');
    // Fix B（2026-07-16）：基本層與加碼層都只在 model 字串明確列出時才顯示——
    // 與 getDisplayRate、calculateStackedCashback 的 gate 一致，三處必須同步。
    const applyBase = model.includes('basic') || model.includes('overseasCashback');
    const applyBonus = model.includes('domesticBonusRate') || model.includes('overseasBonusRate');
    const basicRate = applyBase ? resolveBaseRate(card, isOverseas) : 0;
    const { rate: bonusRate, cap: bonusCap, name: bonusName } = resolveBonusComponent(card, levelSettings, isOverseas);

    const rows = [];
    if (designatedRate > 0) rows.push({ name: '指定通路加碼', rate: designatedRate, cap: (designatedCap && designatedCap > 0) ? designatedCap : null });
    if (basicRate > 0) rows.push({ name: isOverseas ? '海外基本回饋' : '基本回饋', rate: basicRate, cap: null });
    if (applyBonus && bonusRate > 0) rows.push({ name: bonusName, rate: bonusRate, cap: bonusCap });
    // 跨槽引用（rate_N）：每個被引用槽是獨立一行，各自的 category + rate + cap
    resolveCrossSlotLayers(card, model, levelSettings).forEach(layer => {
        if (layer.rate > 0) rows.push({ name: layer.name, rate: layer.rate, cap: layer.cap });
    });
    if (rows.length < 2) return '';

    const total = Math.round(rows.reduce((s, r) => s + r.rate, 0) * 100) / 100;
    const comp = escapeHtml(JSON.stringify({ rows, total }));
    return ` <button type="button" class="calc-breakdown-btn" title="查看回饋組成" aria-label="查看回饋組成" data-comp="${comp}" onclick="toggleRateComposition(this)">${CALC_BREAKDOWN_ICON_SVG}</button>`;
}

// 詳情頁：逐筆渲染 cashbackRates（2026-07-09 起不再按 rate+cap 合併），
// category 一律以藍色 chip 顯示在回饋率旁（與一般卡片一致），回饋率顯示
// getDisplayRate 加總值（stacking 模型 = 指定+基本+加碼）。
// 回傳 { html, upcoming }；upcoming 為 30 天內即將開始的活動（逐筆、含 category）。
async function renderCashbackRatesIndividually(card, levelData, options = {}) {
    const { idPrefix = 'lv' } = options;
    const activeRates = [];
    const upcoming = [];

    for (const rate of card.cashbackRates) {
        if (rate.hideInDisplay) continue;
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        if (status !== 'active' && status !== 'always' && status !== 'upcoming') continue;

        const parsedRate = await parseCashbackRate(rate.rate, card, levelData);
        // cap 留空＝無上限，與搜尋結果/計算引擎一致。（2026-07-17 移除 capFallbackToLevel：
        // 舊 fallback 會把留空的槽顯示成級別 cap，需要級別 cap 的槽請明確填 {cap}）
        const parsedCap = parseCashbackCap(rate.cap, card, levelData);
        const displayRate = getDisplayRate(card, rate, parsedRate, levelData);

        if (status === 'upcoming') {
            if (isUpcomingWithinDays(rate.periodStart, 30)) {
                upcoming.push({
                    parsedRate: displayRate,
                    parsedCap,
                    items: rate.items || [],
                    conditions: rate.conditions ? [{ category: rate.category || '', conditions: rate.conditions }] : [],
                    period: rate.period,
                    periodStart: rate.periodStart,
                    periodEnd: rate.periodEnd,
                    status: 'upcoming',
                    category: rate.category
                });
            }
            continue;
        }
        activeRates.push({ rate, parsedRate, parsedCap, displayRate });
    }

    // 按顯示回饋率（加總後）由高到低排序
    activeRates.sort((a, b) => b.displayRate - a.displayRate);

    let html = '';
    activeRates.forEach((entry, index) => {
        const { rate, parsedRate, parsedCap, displayRate } = entry;
        html += `<div class="cashback-detail-item">`;

        const categoryStyle = rate.category ? getCategoryStyle(rate.category) : '';
        const categoryLabel = rate.category ? ` <span style="${categoryStyle}">${getCategoryDisplayName(rate.category)}</span>` : '';

        let endingSoonBadge = '';
        if (rate.periodEnd && isEndingSoon(rate.periodEnd, 10)) {
            const daysUntil = getDaysUntilEnd(rate.periodEnd);
            const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
            endingSoonBadge = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }

        const compBtn = rateCompositionButtonHtml(card, rate, parsedRate, parsedCap, levelData);
        html += `<div class="cashback-rate"><span class="cashback-rate-num">${displayRate}%</span> 回饋${categoryLabel}${compBtn}${endingSoonBadge}</div>`;

        // 滿額門檻是重要條件：黑色、置於消費上限上方；maxSpend（未滿門檻）
        // 只影響匹配、不顯示標註（2026-07-17 用戶定案）
        if (rate.minSpend) {
            html += `<div class="cashback-condition spend-threshold">單筆滿 NT$${Math.floor(rate.minSpend).toLocaleString()} 起</div>`;
        }

        if (parsedCap) {
            html += `<div class="cashback-condition">消費上限: NT$${Math.floor(parsedCap).toLocaleString()}</div>`;
        } else {
            html += `<div class="cashback-condition">消費上限: 無上限</div>`;
        }

        if (rate.conditions) {
            html += renderConditionLine(rate.conditions);
        }

        if (rate.period) {
            html += `<div class="cashback-condition">活動期間: ${rate.period}</div>`;
        }

        if (rate.items && rate.items.length > 0) {
            const uniqueItems = [...new Set(rate.items)];
            const merchantsId = `merchants-${card.id}-${idPrefix}-${index}`;
            const showAllId = `show-all-${card.id}-${idPrefix}-${index}`;

            if (uniqueItems.length <= 5) {
                html += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${uniqueItems.join('、')}</div>`;
            } else {
                const initialList = uniqueItems.slice(0, 5).join('、');
                const fullList = uniqueItems.join('、');
                html += `<div class="cashback-merchants">`;
                html += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                html += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${uniqueItems.length}個</button>`;
                html += `</div>`;
            }
        }

        html += `</div>`;
    });

    return { html, upcoming };
}

/**
 * Calculate layered cashback for cards with multi-tier reward structures
 * Used for cards like DBS Eco where multiple reward rates stack with independent caps
 *
 * @param {Object} card - The card object
 * @param {Object} levelSettings - Level settings containing bonus rates and caps
 * @param {number} amount - Transaction amount
 * @param {number} displayedRate - Total displayed rate (for reference)
 * @param {number} cap - Consumption cap for the highest tier bonus
 * @param {boolean} isOverseas - Whether this is an overseas transaction
 * @returns {Object} - { cashbackAmount, layers }
 */
// Waterfall cashback for designated-channel cards that also carry a 國內/海外
// 加碼 (e.g. 永豐大戶卡 悠遊卡自動加值). The designated rate is a flat TOTAL
// within its own cap and does NOT overlap basic; only the OVERFLOW beyond that
// cap drops down to 基本 + 加碼. Driven entirely by data fields (designated
// rate/cap from the matched rateGroup, bonus rate/cap from levelSettings or the
// top-level card) — no card-specific branching.
//
//   Tier 1 指定通路 : min(amount, designatedCap) × designatedRate   (flat, no basic overlap)
//   Tier 2 基本回饋 : overflow × baseRate                            (無上限)
//   Tier 3 國內/海外加碼 : min(overflow, bonusCap) × bonusRate        (capped)
function calculateLayeredCashback(card, levelSettings, amount, displayedRate, cap, isOverseas = false) {
    const layers = [];
    let totalCashback = 0;

    // Tier 1: designated channel — flat total rate within its own cap, no basic overlap
    const designatedAmount = (cap && cap > 0) ? Math.min(amount, cap) : amount;
    const designatedCashback = Math.floor(designatedAmount * displayedRate / 100);
    layers.push({
        name: '指定通路',
        rate: displayedRate,
        applicableAmount: designatedAmount,
        cashback: designatedCashback,
        cap: (cap && cap > 0) ? cap : null
    });
    totalCashback += designatedCashback;

    const overflow = amount - designatedAmount;

    if (overflow > 0) {
        // Tier 2: base rate on the overflow (no cap).
        const baseRate = resolveBaseRate(card, isOverseas);
        const baseCashback = Math.floor(overflow * baseRate / 100);
        layers.push({
            name: '基本回饋',
            rate: baseRate,
            applicableAmount: overflow,
            cashback: baseCashback,
            cap: null
        });
        totalCashback += baseCashback;

        // Tier 3: 國內/海外加碼 on the overflow.
        const { rate: bonusRate, cap: bonusCap, name: bonusName } = resolveBonusComponent(card, levelSettings, isOverseas);

        if (bonusRate > 0) {
            // bonusCap null = apply to full overflow (無上限)
            const bonusApplicableAmount = bonusCap != null ? Math.min(overflow, bonusCap) : overflow;
            const bonusCashback = Math.floor(bonusApplicableAmount * bonusRate / 100);
            layers.push({
                name: bonusName,
                rate: bonusRate,
                applicableAmount: bonusApplicableAmount,
                cashback: bonusCashback,
                cap: bonusCap // null = 無上限, preserved for display
            });
            totalCashback += bonusCashback;
        }
    }

    return {
        cashbackAmount: totalCashback,
        layers: layers
    };
}

// Stacking (疊加) model: all rate components apply to the same spending amount simultaneously.
// Used when cashbackModel = "...+domesticBonusRate" or "...+overseasBonusRate".
// rate_N for a stacking item holds ONLY the designated-channel rate (e.g. Sport 卡
// Apple Pay rate_N = 3, not 5) — it does NOT include basic/bonus. The displayed
// 回饋率 (totalRate) is computed here as designated + basic + bonus for the user.
// Each component has its own cap; they are applied concurrently (not waterfall).
// extraLayers（optional）：跨槽引用 rate_N 解析出的獨立層 [{ rate, cap, name }]
// （見 resolveCrossSlotLayers）。每層都吃自己的 cap、獨立作用於全額，
// 與 Layer 1-3 完全對等地加入 totalCashback/totalRate。空陣列/未傳都安全（鐵則4：
// 用 length 判斷，不靠陣列本身的 truthiness）。
function calculateStackedCashback(card, levelSettings, amount, designatedRate, cap, isOverseas = false, extraLayers = [], applyBonus = true, applyBase = true) {
    const layers = [];
    let totalCashback = 0;

    const basicRate = applyBase ? resolveBaseRate(card, isOverseas) : 0;
    const { rate: bonusRate, cap: bonusCap, name: bonusName } = resolveBonusComponent(card, levelSettings, isOverseas);

    // Layer 1: base cashback on ALL spending (no cap) — gated by applyBase（Fix B）：
    // 基本層只在 model 字串列出 basic/overseasCashback 時才加（「寫什麼才加什麼」）。
    // 海外模型的 base 由 resolveBaseRate 自動給 overseasCashback。
    if (applyBase && basicRate > 0) {
        const basicCashback = Math.floor(amount * basicRate / 100);
        layers.push({ name: isOverseas ? '海外基本回饋' : '基本回饋', rate: basicRate, applicableAmount: amount, cashback: basicCashback, cap: null });
        totalCashback += basicCashback;
    }

    // Layer 2: Bonus (domestic / overseas), within its own cap — gated by
    // applyBonus (Fix B, 2026-07-16): the card-level bonus rate only applies
    // when the cashbackModel string actually lists domesticBonusRate/
    // overseasBonusRate as a component; see cashback-engine.md 第 6 節.
    if (applyBonus && bonusRate > 0) {
        const bonusAmount = bonusCap != null ? Math.min(amount, bonusCap) : amount;
        const bonusCashback = Math.floor(bonusAmount * bonusRate / 100);
        layers.push({ name: bonusName, rate: bonusRate, applicableAmount: bonusAmount, cashback: bonusCashback, cap: bonusCap });
        totalCashback += bonusCashback;
    }

    // Layer 3: Designated channel rate (from rate_N as-is), within cashbackRate cap
    if (designatedRate > 0) {
        const designatedAmount = (cap && cap > 0) ? Math.min(amount, cap) : amount;
        const designatedCashback = Math.floor(designatedAmount * designatedRate / 100);
        layers.push({ name: '指定通路加碼', rate: designatedRate, applicableAmount: designatedAmount, cashback: designatedCashback, cap: (cap && cap > 0) ? cap : null });
        totalCashback += designatedCashback;
    }

    // Extra layers: cross-slot rate_N references. Each is a fully independent
    // layer (own cap, applies to the full amount) — non-recursive, so this can
    // never double-count or loop (see resolveCrossSlotLayers).
    let extraRateSum = 0;
    if (extraLayers.length > 0) {
        for (const extra of extraLayers) {
            if (!extra || !(extra.rate > 0)) continue;
            const extraAmount = (extra.cap != null && extra.cap > 0) ? Math.min(amount, extra.cap) : amount;
            const extraCashback = Math.floor(extraAmount * extra.rate / 100);
            layers.push({ name: extra.name, rate: extra.rate, applicableAmount: extraAmount, cashback: extraCashback, cap: (extra.cap != null && extra.cap > 0) ? extra.cap : null });
            totalCashback += extraCashback;
            extraRateSum += extra.rate;
        }
    }

    // Displayed 回饋率 = sum of all active components (e.g. 3%+1%+1% = 5%)
    // basicRate 已在宣告時受 applyBase gate、bonusRate 在此受 applyBonus gate（Fix B）——
    // 顯示率與實際計入金額一致（金額層 Layer 1/2 各自已 gate）。
    const totalRate = designatedRate + basicRate + (applyBonus ? bonusRate : 0) + extraRateSum;

    return { cashbackAmount: totalCashback, layers, totalRate };
}

// Calculate cashback for a specific card
async function calculateCardCashback(card, searchTerm, amount) {
    let allMatches = []; // Collect ALL matching activities
    let selectedLevel = null; // Track selected level for display

    // Get all possible search variants
    const searchVariants = getAllSearchVariants(searchTerm);

    // Handle cards with levels and specialItems (CUBE or Uni card)
    if (card.hasLevels && card.specialItems && card.specialItems.length > 0) {
        const availableLevels = Object.keys(card.levelSettings || {});
        const defaultLevel = availableLevels[0];
        let savedLevel = await getCardLevel(card.id, defaultLevel);

        // Try to find matching level if savedLevel doesn't exist
        if (!card.levelSettings?.[savedLevel]) {
            // Try case-insensitive match
            const matchedLevel = availableLevels.find(level =>
                level.toLowerCase().replace(/\s+/g, '') === savedLevel.toLowerCase().replace(/\s+/g, '')
            );
            if (matchedLevel) {
                savedLevel = matchedLevel;
                // Same level, just a formatting difference (e.g. "level1" vs
                // "Level 1") — safe to persist the normalized form.
                await saveCardLevel(card.id, savedLevel);
            } else {
                // Genuinely not found — use default for this calculation only,
                // but do NOT persist it, so the user's stored choice survives a
                // transient data mismatch (see resolveCardLevel for rationale).
                savedLevel = defaultLevel;
            }
        }

        selectedLevel = savedLevel; // Store selected level
        const levelSettings = card.levelSettings?.[savedLevel];

        // Safety check: if levelSettings is still undefined, return 0 cashback
        if (!levelSettings) {
            console.warn(`⚠️ ${card.name}: levelSettings 未定義 for level "${savedLevel}"`);
            return [];
        }

        // First, check cashbackRates if they exist (for cards like DBS Eco with special promotions)
        // Use index for fast lookup
        if (card.cashbackRates && card.cashbackRates.length > 0 && card._itemsIndex) {
            const processedRateGroups = new Set(); // Track processed rate groups to avoid duplicates

            for (const variant of searchVariants) {
                const indexMatches = card._itemsIndex.get(variant);
                if (!indexMatches) continue;

                // Filter for cashbackRate matches only
                const cashbackMatches = indexMatches.filter(match => match.type === 'cashbackRate');

                for (const match of cashbackMatches) {
                    const rateGroup = match.rateGroup;

                    // Skip if already processed this rate group
                    if (processedRateGroups.has(rateGroup)) continue;
                    processedRateGroups.add(rateGroup);

                    // Only consider active rates for cashback calculation (not upcoming)
                    const rateStatus = getCachedRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
                    if (rateStatus !== 'active' && rateStatus !== 'always') {
                        continue;
                    }

                    // 慶生月方案只在用戶生日當月配對
                    if (rateGroup.category === '切換「慶生月」方案' && !isBirthdayMonth) {
                        continue;
                    }

                    // 童樂匯方案只對符合資格的用戶配對
                    if (rateGroup.category === '切換「童樂匯」方案' && !isChildrenEligible) {
                        continue;
                    }

                    // JCB日本賞方案只對 JCB 發卡組織用戶配對
                    if (rateGroup.category === '切換「JCB日本賞」方案' && cubeIssuer !== 'JCB') {
                        continue;
                    }

                    // 滿額門檻 minSpend/maxSpend：金額 < minSpend 或 amount >= maxSpend
                    // 時此槽不符資格——純粹不匹配，不貢獻此活動回饋，也不退回 basic
                    // （退回 basic 的邏輯已移除：用戶會用另一槽的 maxSpend 負責未滿門檻
                    // 的回饋，退回 basic 會跟那槽打架、產生重複結果。見
                    // docs/project/cross-slot-ref-and-minspend-spec.md 2026-07-16 更正）。
                    if (rateGroup.minSpend && amount < rateGroup.minSpend) {
                        continue;
                    }
                    if (rateGroup.maxSpend && amount >= rateGroup.maxSpend) {
                        continue;
                    }

                    // 解析 rate 值（支援 {specialRate}）
                    let parsedRate = await parseCashbackRate(rateGroup.rate, card, levelSettings);
                    let applicableCap = rateGroup.cap;

                    // Find the exact matched item name
                    const exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);

                    // 隱藏槽（hideInDisplay）與一般活動走完全相同的計算與匹配邏輯：
                    // cashbackModel 空 → 預設行為；有值 → 以 model 為準（rate=0 表示
                    // 「無指定通路加碼成分」，如純 basic+加碼 的一般消費槽）。
                    console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}" (${parsedRate}%)`);

                    // Add this match to allMatches array
                    allMatches.push({
                        rate: parsedRate,
                        cap: applicableCap,
                        matchedItem: exactMatch,
                        matchedCategory: rateGroup.category || null,
                        matchedRateGroup: rateGroup
                    });
                }
            }
        }

        // If no cashbackRates match, check specialItems
        if (allMatches.length === 0) {
            let matchedSpecialItem = null;
            let matchedVariant = null;

            // Use index for fast lookup
            if (card._itemsIndex) {
                for (const variant of searchVariants) {
                    const indexMatches = card._itemsIndex.get(variant);
                    if (indexMatches) {
                        const specialMatch = indexMatches.find(match => match.type === 'specialItem');
                        if (specialMatch) {
                            matchedSpecialItem = typeof specialMatch.specialItem === 'string'
                                ? specialMatch.specialItem
                                : specialMatch.specialItem.item;
                            matchedVariant = variant;
                            console.log(`✅ ${card.name}: 匹配到 specialItem "${matchedSpecialItem}" (搜索詞: "${variant}")`);
                            break;
                        }
                    }
                }
            }

            if (matchedSpecialItem) {
                // CUBE card uses specialRate, other cards use rate
                let rate = levelSettings.specialRate || levelSettings.rate;
                let matchedCategory = null;

                // Set category from levelSettings
                if (levelSettings.category) {
                    matchedCategory = levelSettings.category;
                } else {
                    matchedCategory = null;
                }

                // Set cap based on card type
                let cap = levelSettings.cap || null;

                // Set period from levelSettings if available
                let rateGroup = null;
                if (levelSettings.period) {
                    rateGroup = { period: levelSettings.period };
                }

                // Add this match to allMatches array
                allMatches.push({
                    rate: rate,
                    cap: cap,
                    matchedItem: matchedSpecialItem,
                    matchedCategory: matchedCategory,
                    matchedRateGroup: rateGroup
                });
            }
        }

        // If still no match and this is CUBE card, check generalItems
        if (allMatches.length === 0 && card.id === 'cathay-cube') {
            // CUBE card: check general items for 2% reward using index
            let matchedGeneralItem = null;
            let matchedGeneralCategory = null;

            if (card.generalItems && card._itemsIndex) {
                for (const variant of searchVariants) {
                    const indexMatches = card._itemsIndex.get(variant);
                    if (indexMatches) {
                        const generalMatch = indexMatches.find(match => match.type === 'generalItem');
                        if (generalMatch) {
                            matchedGeneralItem = generalMatch.item;
                            matchedGeneralCategory = generalMatch.category;
                            break;
                        }
                    }
                }
            }

            if (matchedGeneralItem) {
                allMatches.push({
                    rate: levelSettings.generalRate,
                    cap: null, // CUBE card has no cap
                    matchedItem: matchedGeneralItem,
                    matchedCategory: matchedGeneralCategory,
                    matchedRateGroup: null
                });
            }
        }
        // For other level-based cards: if no match found, allMatches will be empty
    } else {
        // Handle cards without specialItems (or with empty specialItems)
        // Get level settings if card has levels
        let levelData = null;
        if (card.hasLevels) {
            const defaultLevel = Object.keys(card.levelSettings)[0];
            const resolved = await resolveCardLevel(card, defaultLevel);
            levelData = resolved.data;
            selectedLevel = resolved.level; // Store selected level for display
        }

        // Check exact matches for all search variants using index
        if (card._itemsIndex) {
            const processedRateGroups = new Set();

            for (const variant of searchVariants) {
                const indexMatches = card._itemsIndex.get(variant);
                if (!indexMatches) continue;

                const cashbackMatches = indexMatches.filter(match => match.type === 'cashbackRate');

                for (const match of cashbackMatches) {
                    const rateGroup = match.rateGroup;

                    // Skip if already processed
                    if (processedRateGroups.has(rateGroup)) continue;
                    processedRateGroups.add(rateGroup);

                    // Only consider active rates for cashback calculation (not upcoming)
                    const rateStatus = getCachedRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
                    if (rateStatus !== 'active' && rateStatus !== 'always') {
                        continue;
                    }

                    // 慶生月方案只在用戶生日當月配對
                    if (rateGroup.category === '切換「慶生月」方案' && !isBirthdayMonth) {
                        continue;
                    }

                    // 童樂匯方案只對符合資格的用戶配對
                    if (rateGroup.category === '切換「童樂匯」方案' && !isChildrenEligible) {
                        continue;
                    }

                    // JCB日本賞方案只對 JCB 發卡組織用戶配對
                    if (rateGroup.category === '切換「JCB日本賞」方案' && cubeIssuer !== 'JCB') {
                        continue;
                    }

                    // 滿額門檻 minSpend/maxSpend：金額 < minSpend 或 amount >= maxSpend
                    // 時此槽不符資格——純粹不匹配，不貢獻此活動回饋，也不退回 basic
                    // （見上方 hasLevels 分支同款判斷的註解與 spec 2026-07-16 更正）。
                    if (rateGroup.minSpend && amount < rateGroup.minSpend) {
                        continue;
                    }
                    if (rateGroup.maxSpend && amount >= rateGroup.maxSpend) {
                        continue;
                    }

                    // 解析 rate 值（支援 {rate}、{specialRate} 等任意 levelSettings 欄位）
                    let parsedRate = await parseCashbackRate(rateGroup.rate, card, levelData);
                    let parsedCap = parseCashbackCap(rateGroup.cap, card, levelData);

                    // Find the exact matched item name
                    const exactMatch = rateGroup.items.find(item => item.toLowerCase() === variant);

                    // 隱藏槽（hideInDisplay）與一般活動走完全相同的計算與匹配邏輯：
                    // cashbackModel 空 → 預設行為；有值 → 以 model 為準（rate=0 表示
                    // 「無指定通路加碼成分」，如純 basic+加碼 的一般消費槽）。
                    const applicableCap = parsedCap !== null ? parsedCap : rateGroup.cap;
                    console.log(`✅ ${card.name}: 匹配到 cashbackRates "${exactMatch}" (${parsedRate}%)`);

                    // Add this match to allMatches array
                    allMatches.push({
                        rate: parsedRate,
                        cap: applicableCap,
                        matchedItem: exactMatch,
                        matchedCategory: rateGroup.category || null,
                        matchedRateGroup: rateGroup
                    });
                }
            }
        }
    }

    // Calculate cashback for each match and return array of results
    const results = allMatches.map(match => {
        const { rate, cap, matchedItem, matchedCategory, matchedRateGroup } = match;

        let cashbackAmount = 0;
        let effectiveAmount = amount;
        let totalRate = rate;
        let calculationLayers = null;

        // Determine calculation path based on cashbackModel field and card bonus rates.
        // cashbackModel values (set per-cashbackRate item in Sheet); the name lists
        // every rate component that applies, in order of cap consumption:
        //   "rate" / "rate+basic"           → just the rate, basic on overflow, NO bonus
        //   "rate+basic+domesticBonusRate"  → stacking: designated + basic + domestic bonus
        //   "rate+basic+overseasBonusRate"  → stacking: designated + basic + overseas bonus
        //   "basic+domesticBonusRate"       → stacking, no designated (general 國內消費)
        //   "basic+overseasBonusRate"       → stacking, no designated (general 國外消費)
        //   (not set)                       → waterfall if card carries any bonus rate
        let shouldUseLayeredCalculation = false;
        let shouldUseStackedCalculation = false;
        let stackedIsOverseas = false;
        let stackedExtraLayers = []; // 跨槽引用 rate_N 解析出的獨立層（僅 stacking 分支使用）
        let stackedApplyBonus = false; // Fix B（2026-07-16）：加碼層只在 model 字串含 dbr/obr 關鍵字時才加
        let stackedApplyBase = false; // Fix B（2026-07-16）：基本層只在 model 字串含 basic/overseasCashback 時才加
        let levelSettingsForCalc = null;
        let isOverseasTransaction = false;

        // Step 1: resolve level settings for hasLevels cards (regardless of bonus)
        if (card.hasLevels && card.levelSettings) {
            const availableLevels = Object.keys(card.levelSettings);
            const levelToUse = selectedLevel || availableLevels[0];
            levelSettingsForCalc = card.levelSettings[levelToUse];
        }

        // Step 2: pick calculation model
        const cashbackModel = matchedRateGroup ? matchedRateGroup.cashbackModel : null;

        // cashbackModel grammar — the SEPARATOR alone picks stacking vs waterfall,
        // per rate_N slot, independent of every other slot on the same card:
        //   "+" → STACKING: components apply concurrently to the FULL amount,
        //         each with its own cap (calculateStackedCashback). rate_N here
        //         is the designated-only rate (does NOT include basic).
        //         e.g. "rate+basic+domesticBonusRate", "basic+overseasBonusRate"
        //   ">" → WATERFALL: rate_N is cap-limited; the overflow then earns the
        //         next component(s) (calculateLayeredCashback). rate_N here is
        //         the ALREADY-TOTALED rate (includes basic).
        //         e.g. "rate>basic>domesticBonusRate", "rate>basic>overseasBonusRate"
        //   "rate" (bare, no separator) → simple 2-tier, NEVER applies any bonus
        //         regardless of the card's own bonus fields (cap→rate_N,
        //         overflow→basicCashback only) — for channels fully excluded
        //         from the card's bonus program, e.g. 大戶卡「悠遊卡自動加值」.
        //   (blank) → legacy default: if the card carries domesticBonusRate/
        //         overseasBonusRate, behaves like an implicit domestic
        //         "rate>basic>domesticBonusRate" — kept so cards not yet
        //         tagged (DBS Eco 國內項目, 凱基誠品, …) keep working unchanged.
        //
        // Domestic vs overseas is read purely from whether the literal keyword
        // `domesticBonusRate` / `overseasBonusRate` appears in the string —
        // never auto-detected from the search term or item name.
        // NOTE: the retired name "rate+basic" (used before this redesign) is NOT
        // an alias for bare "rate" — it now matches the "+" branch (stacking).
        // Rename any existing "rate+basic" data to bare "rate".
        const isOverseasModel = cashbackModel ? cashbackModel.includes('overseasBonusRate') : false;

        if (cashbackModel === 'rate') {
            // Simple path, no bonus ever — handled by the final `else` branch below.
        } else if (cashbackModel && cashbackModel.includes('+')) {
            shouldUseStackedCalculation = true;
            stackedIsOverseas = isOverseasModel;
            // 跨槽引用 rate_N（僅 stacking 分支支援）：非遞迴，只讀被引用槽的原始
            // rate/cap，不執行它自己的 cashbackModel。見 resolveCrossSlotLayers。
            stackedExtraLayers = resolveCrossSlotLayers(card, cashbackModel, levelSettingsForCalc);
            // Fix B（2026-07-16）：加碼層（Layer 2）只在 model 字串明確列出
            // domesticBonusRate/overseasBonusRate 時才加，不再無條件加卡片級
            // dbr/obr——見 docs/project/cross-slot-ref-and-minspend-spec.md 功能三。
            stackedApplyBonus = cashbackModel.includes('domesticBonusRate') || cashbackModel.includes('overseasBonusRate');
            // 基本層（Layer 1）同理：只在 model 字串明確列出 basic 或 overseasCashback 時才加。
            stackedApplyBase = cashbackModel.includes('basic') || cashbackModel.includes('overseasCashback');
        } else if (cashbackModel && cashbackModel.includes('>')) {
            shouldUseLayeredCalculation = true;
            isOverseasTransaction = isOverseasModel;
            // rate_N 跨槽引用不支援 waterfall 分支——偵測到就 warn，忽略該 token
            warnIfCrossSlotRefMisused(card, cashbackModel);
        } else if (!cashbackModel) {
            // Blank — legacy default: waterfall (domestic) if card carries bonus rates
            const effectiveDomBonus = (levelSettingsForCalc && levelSettingsForCalc.domesticBonusRate) || card.domesticBonusRate;
            const effectiveOvsBonus = (levelSettingsForCalc && levelSettingsForCalc.overseasBonusRate) || card.overseasBonusRate;

            if (effectiveDomBonus || effectiveOvsBonus) {
                shouldUseLayeredCalculation = true;
                isOverseasTransaction = false;
            }
        } else {
            // Model set but not 'rate' / '+' / '>' — falls through to the simple
            // path unchanged (existing behavior). rate_N is unsupported here too;
            // warn rather than silently mis-computing.
            warnIfCrossSlotRefMisused(card, cashbackModel);
        }

        // 註：stacking 允許 rate=0 的「無指定加碼」項目（如隱藏的一般國內消費槽，
        // model=basic+domesticBonusRate）——基本與加碼層仍會計算。
        if (rate > 0 || shouldUseStackedCalculation) {
            if (shouldUseStackedCalculation) {
                // Stacking model: basic + bonus + designated all applied to same amount
                const stackedResult = calculateStackedCashback(
                    card,
                    levelSettingsForCalc,
                    amount,
                    rate,
                    cap,
                    stackedIsOverseas,
                    stackedExtraLayers,
                    stackedApplyBonus,
                    stackedApplyBase
                );
                cashbackAmount = stackedResult.cashbackAmount;
                calculationLayers = stackedResult.layers;
                totalRate = stackedResult.totalRate; // 顯示加總後的最高回饋率（如 3%+1%+1%=5%）
                effectiveAmount = amount;
            } else if (shouldUseLayeredCalculation) {
                // Waterfall: designated tier first, basic on overflow, bonus on overflow
                const layeredResult = calculateLayeredCashback(
                    card,
                    levelSettingsForCalc,
                    amount,
                    rate,
                    cap,
                    isOverseasTransaction
                );
                cashbackAmount = layeredResult.cashbackAmount;
                calculationLayers = layeredResult.layers;
                totalRate = rate; // Keep displayed total rate
                effectiveAmount = amount; // Show full amount for layered calculation
            } else {
                // Simple path: cap 內用 rate_N(已含 basic)、溢出視 cashbackModel 而定.
                // Build the breakdown layers once and derive cashbackAmount from
                // them, instead of computing each layer's cashback twice.
                const effectiveSpecialAmount = (cap && cap > 0) ? Math.min(amount, cap) : amount;
                const specialCashback = Math.floor(effectiveSpecialAmount * rate / 100);

                const layers = [
                    { name: '指定通路', rate: rate, applicableAmount: effectiveSpecialAmount, cashback: specialCashback, cap: (cap && cap > 0) ? cap : null }
                ];

                if (cap && amount > cap) {
                    const remainingAmount = amount - cap;
                    if (cashbackModel === 'rate') {
                        // Fully excluded from the card's ordinary spending program
                        // (e.g. 大戶卡「悠遊卡自動加值」) — spending beyond the cap
                        // earns nothing, shown explicitly as 0 rather than silently
                        // missing from the total.
                        layers.push({ name: '超過上限(不列入回饋)', rate: 0, applicableAmount: remainingAmount, cashback: 0, cap: null });
                    } else {
                        const excessRate = getOverflowRate(card);
                        const remainingCashback = Math.floor(remainingAmount * excessRate / 100);
                        layers.push({ name: '基本回饋', rate: excessRate, applicableAmount: remainingAmount, cashback: remainingCashback, cap: null });
                    }
                }

                cashbackAmount = layers.reduce((sum, layer) => sum + layer.cashback, 0);
                totalRate = Math.round(rate * 100) / 100;
                effectiveAmount = cap; // Keep this for display purposes
                calculationLayers = layers;
            }
        }

        return {
            rate: Math.round(totalRate * 100) / 100,
            specialRate: Math.round(rate * 100) / 100,
            basicRate: Math.round(card.basicCashback * 100) / 100,
            cashbackAmount: cashbackAmount,
            cap: cap,
            matchedItem: matchedItem,
            matchedCategory: matchedCategory,
            effectiveAmount: effectiveAmount,
            matchedRateGroup: matchedRateGroup,
            selectedLevel: selectedLevel, // Pass selected level to display
            periodStart: matchedRateGroup?.periodStart || null,
            periodEnd: matchedRateGroup?.periodEnd || null,
            calculationLayers: calculationLayers, // Include layer breakdown if available
            isLayeredCalculation: shouldUseLayeredCalculation
        };
    });

    return results;
}

// Find upcoming activities for a card (activities starting within 30 days)
async function findUpcomingActivity(card, searchTerm, amount) {
    let allMatchedActivities = [];

    // Get all possible search variants
    const searchVariants = getAllSearchVariants(searchTerm);

    // Get level settings if card has levels
    let levelData = null;
    let selectedLevel = null;
    if (card.hasLevels) {
        const availableLevels = Object.keys(card.levelSettings || {});
        const defaultLevel = availableLevels[0];
        const resolved = await resolveCardLevel(card, defaultLevel);
        levelData = resolved.data;
        selectedLevel = resolved.level;
    }

    // Check cashbackRates for upcoming activities
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        for (const rateGroup of card.cashbackRates) {
            if (!rateGroup.items) continue;

            // Only consider upcoming rates
            const rateStatus = getCachedRateStatus(rateGroup.periodStart, rateGroup.periodEnd);
            if (rateStatus !== 'upcoming') {
                continue;
            }

            // Check if it's within 30 days
            if (!isUpcomingWithinDays(rateGroup.periodStart, 30)) {
                continue;
            }

            // Parse rate and cap
            const parsedRate = await parseCashbackRate(rateGroup.rate, card, levelData);
            const parsedCap = parseCashbackCap(rateGroup.cap, card, levelData);

            // Collect all items that match the search term
            const matchedItems = [];
            for (const item of rateGroup.items) {
                const itemLower = item.toLowerCase();
                for (const variant of searchVariants) {
                    if (itemLower === variant) {
                        matchedItems.push(item);
                        break; // Found match for this item, move to next item
                    }
                }
            }

            // If any items matched, add this activity
            if (matchedItems.length > 0) {
                // Calculate cashback amount
                let cashbackAmount = 0;
                let effectiveAmount = amount;

                if (parsedCap && amount > parsedCap) {
                    effectiveAmount = parsedCap;
                }

                // Calculate special rate cashback
                const specialCashback = Math.floor(effectiveAmount * parsedRate / 100);

                // Calculate remaining amount cashback (if capped)
                let remainingCashback = 0;
                if (parsedCap && amount > parsedCap) {
                    const remainingAmount = amount - parsedCap;
                    const excessRate = getOverflowRate(card);
                    remainingCashback = Math.floor(remainingAmount * excessRate / 100);
                }

                cashbackAmount = specialCashback + remainingCashback;

                allMatchedActivities.push({
                    rate: parsedRate,
                    cap: parsedCap,
                    cashbackAmount: cashbackAmount,
                    matchedItem: matchedItems[0], // First matched item for backward compatibility
                    matchedItems: matchedItems, // All matched items
                    matchedCategory: rateGroup.category || null,
                    periodStart: rateGroup.periodStart,
                    periodEnd: rateGroup.periodEnd,
                    period: rateGroup.period,
                    selectedLevel: selectedLevel
                });
            }
        }
    }

    return allMatchedActivities;
}

// Display calculation results
// 模糊匹配商家名稱
// searchVariants：已 fuzzy 展開的搜尋詞陣列（由 displayMerchantPaymentInfo 傳入）
function findMerchantPaymentInfo(searchVariants) {
    console.log('🔍 findMerchantPaymentInfo 被調用，搜尋詞:', searchVariants);

    if (!cardsData?.merchantPayments) {
        console.log('❌ cardsData.merchantPayments 不存在');
        return null;
    }

    if (!searchVariants || searchVariants.length === 0) {
        console.log('❌ searchVariants 為空');
        return null;
    }

    // B 類嚴格比對：商家名稱拆括號 + 雙向 startsWith
    // e.g. "好市多 (Costco)" 可用「好市多」或「Costco」搜到；
    //      "日本7-ELEVEN門市" 不會誤匹配 "7-ELEVEN"
    for (const [merchantName, paymentInfo] of Object.entries(cardsData.merchantPayments)) {
        if (merchantMatchesStrict(merchantName, searchVariants)) {
            console.log('✅ 匹配到:', merchantName);
            return { merchantName, ...paymentInfo };
        }
    }

    console.log('❌ 沒有匹配到任何商家');
    return null;
}

// 顯示商家付款方式資訊
// 取得或建立 merchant-info 兩欄容器（左：商家付款方式，右：導購加碼）
function getOrCreateMerchantInfoRow() {
    let row = document.getElementById('merchant-info-row');
    if (row) return row;

    row = document.createElement('div');
    row.id = 'merchant-info-row';
    row.className = 'merchant-info-row';

    const resultsSection = document.getElementById('results-section');
    const paymentDisclaimer = document.getElementById('payment-disclaimer');
    if (resultsSection && paymentDisclaimer) {
        resultsSection.insertBefore(row, paymentDisclaimer);
    }
    return row;
}

function removeMerchantInfoRowIfEmpty() {
    const row = document.getElementById('merchant-info-row');
    if (row && row.children.length === 0) {
        row.remove();
    }
}

function displayMerchantPaymentInfo(searchedItem) {
    // 移除舊的商家付款方式區塊（如果存在）
    const existingBlock = document.getElementById('merchant-payment-info');
    if (existingBlock) {
        existingBlock.remove();
    }

    if (!searchedItem) {
        return;
    }

    // 展開別名（e.g. "711" → ["711","7-eleven"]），讓縮寫也能匹配
    const searchTerms = getAllSearchVariants(searchedItem);

    console.log('🔍 搜尋商家付款方式，原始搜尋詞:', searchedItem);
    console.log('🔍 展開後的搜尋詞:', searchTerms);

    const merchantInfo = findMerchantPaymentInfo(searchTerms);

    if (!merchantInfo) {
        console.log('❌ 所有搜尋詞都未匹配到商家付款方式');
        removeMerchantInfoRowIfEmpty();
        return;
    }

    // 建立商家付款方式區塊
    const infoBlock = document.createElement('div');
    infoBlock.id = 'merchant-payment-info';
    infoBlock.className = 'merchant-payment-info';

    let infoHTML = `<div class="merchant-payment-title">＊ ${escapeHtml(merchantInfo.merchantName)}也支援以下行動支付</div>`;

    // 計算有多少個付款方式
    const hasOnline = merchantInfo.online && merchantInfo.online.trim() !== '';
    const hasOffline = merchantInfo.offline && merchantInfo.offline.trim() !== '';
    const bothExist = hasOnline && hasOffline;

    if (hasOnline) {
        const label = bothExist ? '<span class="payment-label">線上：</span>' : '';
        infoHTML += `<div class="merchant-payment-item">${label}${escapeHtml(merchantInfo.online)}</div>`;
    }

    if (hasOffline) {
        const label = bothExist ? '<span class="payment-label">門市：</span>' : '';
        infoHTML += `<div class="merchant-payment-item">${label}${escapeHtml(merchantInfo.offline)}</div>`;
    }

    infoBlock.innerHTML = infoHTML;

    // 插入到 merchant-info-row 容器（左欄）
    const row = getOrCreateMerchantInfoRow();
    if (row) {
        // 確保 merchant-payment-info 在最前面（左欄）
        row.insertBefore(infoBlock, row.firstChild);
    }
}

// 顯示推薦連結資訊
function displayReferralLink(searchedItem) {
    // 移除舊的推薦連結區塊（如果存在）
    const existingBlock = document.getElementById('referral-link-info');
    if (existingBlock) {
        existingBlock.remove();
    }

    if (!searchedItem || !cardsData?.referralLinks) {
        return;
    }

    // 搜尋匹配的推薦連結（含 fuzzy 別名展開，e.g. "711" 也能匹配 "7-ELEVEN"）
    // B 類嚴格比對：商家拆括號 + 雙向 startsWith，避免 "日本7-ELEVEN門市" 誤匹配 "7-ELEVEN"
    const searchVariants = getAllSearchVariants(searchedItem);
    const matchedReferral = cardsData.referralLinks.find(referral =>
        referral.active && merchantMatchesStrict(referral.merchant, searchVariants)
    );

    if (!matchedReferral) {
        return;
    }

    console.log('✅ 找到推薦連結:', matchedReferral.merchant);

    // 建立推薦連結區塊
    const infoBlock = document.createElement('div');
    infoBlock.id = 'referral-link-info';
    infoBlock.className = 'referral-link-info';

    const referralUrl = sanitizeUrl(matchedReferral.url);
    infoBlock.innerHTML = `
        <div class="referral-link-content">
            <span class="referral-link-icon">🎁</span>
            <span class="referral-link-text">${escapeHtml(matchedReferral.description)}</span>
            ${referralUrl ? `<a href="${escapeHtml(referralUrl)}" target="_blank" rel="noopener noreferrer" class="referral-link-button">
                前往註冊 →
            </a>` : ''}
        </div>
    `;

    // 插入到商家付款方式區塊下方、免責聲明上方
    const resultsSection = document.getElementById('results-section');
    const paymentDisclaimer = document.getElementById('payment-disclaimer');
    const merchantInfoRow = document.getElementById('merchant-info-row');

    if (resultsSection && paymentDisclaimer) {
        // 如果有 merchant-info-row，插入在它下方；否則插入在免責聲明上方
        const insertBeforeElement = merchantInfoRow ? merchantInfoRow.nextSibling : paymentDisclaimer;
        resultsSection.insertBefore(infoBlock, insertBeforeElement);
    }
}

// 顯示導購網站回饋資訊（Shopback / Line 購物）
// 建立獨立 block 放在 merchant-info-row 的右欄
function displayCashbackSites(searchedItem) {
    const existingBlock = document.getElementById('cashback-sites-info');
    if (existingBlock) {
        existingBlock.remove();
    }

    if (!searchedItem || !cardsData?.cashbackSites) {
        removeMerchantInfoRowIfEmpty();
        return;
    }

    const sites = cardsData.cashbackSites;
    const shopbackList = Array.isArray(sites.shopback) ? sites.shopback : [];
    const linebuyList = Array.isArray(sites.linebuy) ? sites.linebuy : [];

    // 展開別名（e.g. "全聯" → ["全聯","px mart"]），讓縮寫也能匹配
    const searchTerms = getAllSearchVariants(searchedItem);

    // B 類嚴格比對：商家拆括號 + 雙向 startsWith
    // e.g. "酷澎 (Coupang)" 可用「酷澎」或「Coupang」搜到；
    //      "ToCoo! 日本租車網" 不會被「日本」誤匹配
    const matchEntry = (list) =>
        list.find(entry => entry && entry.merchant && merchantMatchesStrict(entry.merchant, searchTerms)) || null;

    const shopbackMatch = matchEntry(shopbackList);
    const linebuyMatch = matchEntry(linebuyList);

    if (!shopbackMatch && !linebuyMatch) {
        removeMerchantInfoRowIfEmpty();
        return;
    }

    // 建立獨立 block（同 merchant-payment-info 灰色樣式）
    const infoBlock = document.createElement('div');
    infoBlock.id = 'cashback-sites-info';
    infoBlock.className = 'merchant-payment-info';

    // 標題顯示實際匹配到的商家名稱（粗體），而非使用者輸入
    const matchedMerchantName = (shopbackMatch || linebuyMatch).merchant;
    let html = `<div class="merchant-payment-title">＊ <strong>${escapeHtml(matchedMerchantName)}</strong> 也可透過導購網站享加碼回饋</div>`;
    const shopbackUrl = shopbackMatch ? sanitizeUrl(shopbackMatch.link) : '';
    const linebuyUrl = linebuyMatch ? sanitizeUrl(linebuyMatch.link) : '';
    if (shopbackUrl) {
        html += `<div class="merchant-payment-item"><a href="${escapeHtml(shopbackUrl)}" target="_blank" rel="noopener noreferrer" class="cashback-site-link">Shopback →</a></div>`;
    }
    if (linebuyUrl) {
        html += `<div class="merchant-payment-item"><a href="${escapeHtml(linebuyUrl)}" target="_blank" rel="noopener noreferrer" class="cashback-site-link">LINE 購物 →</a></div>`;
    }
    infoBlock.innerHTML = html;

    // 插入到 merchant-info-row 容器（右欄）
    const row = getOrCreateMerchantInfoRow();
    if (row) {
        row.appendChild(infoBlock);
    }
}

