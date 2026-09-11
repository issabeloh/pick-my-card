/* ============================================================
 * Pick My Card — js/search-match.js（載入順序 4/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 模糊搜尋對照表            → "fuzzySearchMap"
 *  - 搜尋排除表                → "searchExclusionMap" / "mergeDataSearchExclusions"
 *  - 精準搜尋開關              → "isExactSearchEnabled"
 *  - 搜尋匹配核心              → "findMatchingItem"
 *  - 匹配結果提示 UI            → "showMatchedItem" / "showNoMatchMessage"
 *  - 匹配到但沒活動的提示        → "showMatchedButNoActivityMessage"
 *  - 送出時重新推導匹配          → "syncMatchedItemToInput"
 *  - 輸入驗證                  → "validateInputs"
 *  - 同活動合併                → "mergeResultsByActivity"
 *  - 無匹配 fallback            → "buildBasicCashbackResult"
 * ============================================================ */
// Fuzzy search mapping for common terms
const fuzzySearchMap = {
    'pchome': 'pchome',
    'pchome商店街': 'pchome',
    'pchome24h': 'pchome 24h購物',
    'shopee': '蝦皮購物',
    '蝦皮': '蝦皮購物',
    'rakuten': '樂天市場',
    '樂天': '樂天市場',
    'momo': 'momo購物網',
    'yahoo': 'yahoo',
    'yahoo購物': 'yahoo',
    'yahoo超級商城': 'yahoo',
    'costco': '好市多',
    '好市多': 'costco',
    '711': '7-11',
    '7eleven': '7-11',
    '7 11': '7-11',
    '7-eleven': '7-11',
    '全家': '全家',
    'familymart': '全家',
    '全家便利商店': '全家',
    '萊爾富': 'ok mart',
    '莱尔富': 'ok mart',
    'okmart': 'ok mart',
    'pxmart': '全聯福利中心',
    '全聯': '全聯福利中心',
    '全聯小時達': '全聯小時達',
    '小時達': '全聯小時達',
    'carrefour': '家樂福',
    '家樂福': 'carrefour',
    'rt-mart': '大潤發',
    '大潤發': 'rt-mart',
    'mcd': '麥當勞',
    'mcdonalds': '麥當勞',
    '麥當勞': 'mcdonalds',
    'starbucks': '星巴克',
    '星巴克': 'starbucks',
    'linepay': 'line pay',
    'line pay': 'linepay',
    'applepay': 'apple pay',
    'apple pay': 'applepay',
    '海外': '國外',
    '國外': '海外',
    'overseas': '海外',
    'apple wallet': 'apple pay',
    // Apple 直營通路別名：資料裡「apple 官網」與「Apple store」／「Apple Store 在線商城」
    // 是同一件事的不同寫法，彼此不含子字串，靠這張表打通（反向展開讓搜「apple store」
    // 也吃得到「apple 官網」的活動）。無空格寫法一併保留：使用者手打通常不加空格。
    'apple 官網': 'apple store',
    'apple官網': 'apple store',
    'googlepay': 'google pay',
    'google pay': 'googlepay',
    'samsungpay': 'samsung pay',
    'samsung pay': 'samsungpay',
    'iqiyi': '愛奇藝',
    '愛奇藝': 'iqiyi',
    '街口': '街口支付',
    '街口支付': '街口',
    'jkopay': '街口',
    'pi錢包': 'pi 拍錢包',
    'pi wallet': 'pi 拍錢包',
    '台灣支付': '台灣pay',
    'taiwan pay': '台灣pay',
    'taiwanpay': '台灣pay',
    '悠遊付': 'easy wallet',
    'easywallet': '悠遊付',
    '長榮': '長榮航空',
    'eva air': '長榮航空',
    'evaair': '長榮航空',
    '華航': '中華航空',
    'china airlines': '中華航空',
    '立榮': 'uni air',
    'uniaire': 'uni air',
    '星宇': '星宇航空',
    'starlux': '星宇航空',
    'starlux airlines': '星宇航空',
    '日本航空': 'japan airlines',
    '日航': '日本航空',
    'jal': '日本航空',
    'ana': '全日空',
    'all nippon airways': '全日空',
    '大韓航空': 'korean air',
    '大韓': 'korean air',
    '韓亞': '韓亞航空',
    'asiana airlines': '韓亞航空',
    '國泰航空': 'cathay pacific',
    '國泰': 'cathay pacific',
    '新加坡航空': 'singapore airlines',
    '新航': '新加坡航空',
    'sia': '新加坡航空',
    '泰航': '泰國航空',
    'thai airways': '泰國航空',
    '馬航': '馬來西亞航空',
    'malaysia airlines': '馬來西亞航空',
    'airasia': '亞洲航空',
    '越航': '越南航空',
    'vietnam airlines': '越南航空',
    '菲航': '菲律賓航空',
    'philippine airlines': '菲律賓航空',
    '華信航空': 'mandarin airlines',
    '華信': 'mandarin airlines',
    '台灣高鐵': '高鐵',
    'taiwan high speed rail': '高鐵',
    'high speed rail': '高鐵',
    'thsr': '高鐵',
    'foodpanda': 'foodpanda',
    'food panda': 'foodpanda',
    '熊貓': 'foodpanda',
    'uber eats': 'uber eats',
    'ubereats': 'uber eats',
    'ubereat': 'uber eats',
    'uber eat': 'uber eats',
    // Remove uber/uber eats cross-mapping to prevent unwanted matches
    '三井(mitsui outlet park)': '三井',
    '三井outlet': '三井',
    '三井': '三井(mitsui outlet park)',
    'mitsui': '三井',
    'mitsui outlet': '三井',
    'mitsui outlet park': '三井(mitsui outlet park)',
    '國外': '海外',
    '海外': '國外',
    'decathlon': '迪卡儂',
    '迪卡儂': 'decathlon',
    'ikea': 'IKEA宜家家居',
    '宜家': 'IKEA宜家家居',
    '宜家家居': 'IKEA宜家家居',
    'IKEA宜家家居': 'ikea',
    'greenvines': '綠藤生機',
    '綠藤生機': 'greenvines',
    '綠藤': '綠藤生機',
    '屈臣氏': 'watsons',
    'watsons': '屈臣氏',
    '康是美': 'cosmed',
    'cosmed': '康是美',
    'hnm': 'h&m',
    '唐吉軻德 DON DON DONKI': '唐吉訶德 DON DON DONKI',
    '唐吉訶德 DON DON DONKI': '唐吉軻德 DON DON DONKI',
    '餐廳': '餐飲',
    '國內餐廳': '國內餐飲',
    '國外餐廳': '國外餐飲',
    '全台餐廳': '全台餐飲',
    '全臺餐廳': '全臺餐飲',
    '國內國外餐廳': '國內國外餐飲',
    'holiday ktv': '好樂迪',
    'party world': '錢櫃',
    'fb廣告': 'meta廣告',
    'facebook廣告': 'meta廣告',
    'meta 廣告': 'meta廣告',
    'fb ads': 'meta廣告',
    'meta ads': 'meta廣告',
    'google 廣告': 'google廣告',
    'google ads': 'google廣告',
    'abc mart': 'abc-mart',
    'MAC': 'M.A.C',
    'nitori': '宜得利',
    'mia cbon': 'Mia C\'bon',
    'tomods': 'Tomod\'s',
    'sogo': '遠東 SOGO',
    '台北捷運': '臺北捷運',
    '臺北捷運': '台北捷運'
};

// 詞素級同義詞（片語展開用）。
// fuzzySearchMap 是「完全一致」查表：表裡有 '海外'→'國外'，但使用者輸入「海外消費」
// 查不到這個鍵，展開不出「國外消費」，就跟資料裡 137 筆的「國外消費」擦身而過。
// 這裡改成把詞素換掉再比一次，一條規則覆蓋 海外消費／海外實體／海外線上／海外購物
// 整個家族，不必為每個組合各補一列別名。
const synonymPhrasePairs = [
    ['海外', '國外']
];

// 回傳 termLower 做完詞素替換後的其他寫法（不含 termLower 自己）。
// 雙向替換：輸入「海外消費」得到「國外消費」，輸入「國外消費」也得到「海外消費」。
function expandSynonymPhrases(termLower) {
    const variants = [];
    synonymPhrasePairs.forEach(([left, right]) => {
        [[left, right], [right, left]].forEach(([from, to]) => {
            if (!termLower.includes(from)) return;
            const variant = termLower.split(from).join(to);
            if (variant !== termLower && !variants.includes(variant)) {
                variants.push(variant);
            }
        });
    });
    return variants;
}

// Search term exclusion rules - prevents unwanted matches
// Format: 'searchTerm': ['excluded item 1', 'excluded item 2', ...]
// 比對規則：searchTerm 對 fuzzy 展開後的每個搜尋詞生效，excluded item 與 item 名做小寫全等比對。
// 日常維護走 Google Sheets 的 SearchExclusions 工作表（載入時由 mergeDataSearchExclusions 併入），
// 這裡只保留兜底預設值。
const searchExclusionMap = {
    '街口': ['日本paypay(限於街口支付綁定)'],
    '街口支付': ['日本paypay(限於街口支付綁定)'],
    // 「新加坡航空」fuzzy 展開出別名 sia，子字串誤中 a"sia"yo
    'sia': ['asiayo']
};

// 將 cards.data 匯出的 searchExclusions（SearchExclusions 工作表）併入內建排除表，
// 讓排除規則可從 Google Sheets 維護、不必改程式。格式：[{ term, excludedItems: [...] }]。
// 一律正規化為小寫存放，與 checkItemMatches 的小寫全等比對一致。
function mergeDataSearchExclusions(data) {
    if (!data || !Array.isArray(data.searchExclusions)) return;
    let mergedCount = 0;
    data.searchExclusions.forEach(entry => {
        const term = String(entry && entry.term || '').toLowerCase().trim();
        const items = Array.isArray(entry && entry.excludedItems) ? entry.excludedItems : [];
        if (!term || items.length === 0) return;
        if (!searchExclusionMap[term]) searchExclusionMap[term] = [];
        const existing = searchExclusionMap[term];
        items.forEach(item => {
            const normalized = String(item).toLowerCase().trim();
            if (normalized && !existing.some(e => e.toLowerCase() === normalized)) {
                existing.push(normalized);
                mergedCount++;
            }
        });
    });
    if (mergedCount > 0) {
        console.log(`🚫 已從 cards.data 併入 ${mergedCount} 條搜尋排除規則`);
    }
}

// 精準搜尋核取方塊狀態（只作用於手動輸入路徑，快捷搜尋不受影響）
// 2026-07-12 版面重整後桌機/手機共用同一個 checkbox（保留陣列形式以防未來再分裝置）
const EXACT_SEARCH_CHECKBOX_IDS = ['exact-search-checkbox'];
function isExactSearchEnabled() {
    return EXACT_SEARCH_CHECKBOX_IDS.some(id => {
        const checkbox = document.getElementById(id);
        return !!(checkbox && checkbox.checked);
    });
}

// 精準搜尋下零結果的提示（「無完全一致項目，可取消勾選看相近結果」）
function toggleExactSearchEmptyHint(show) {
    const hint = document.getElementById('exact-search-empty-hint');
    if (hint) hint.style.display = show ? 'block' : 'none';
}

// Find matching item in cards database
// options.exactOnly：只回傳完全一致的匹配（isExactMatch；fuzzy 同義詞展開後全等也算，
// 例如搜「國外」時 item「海外」視為完全一致）。快捷搜尋等呼叫端不傳即維持原行為。
function findMatchingItem(searchTerm, options = {}) {
    if (!cardsData) return null;
    const exactOnly = !!options.exactOnly;

    let searchLower = searchTerm.toLowerCase().trim();
    let searchTerms = [searchLower]; // Always include original search term

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

    // 片語級同義詞展開：「海外消費」→「國外消費」
    expandSynonymPhrases(searchLower).forEach(variant => {
        if (!searchTerms.includes(variant)) searchTerms.push(variant);
    });

    console.log(`🔎 findMatchingItem 開始搜尋:`, {
        原始輸入: searchTerm,
        搜尋詞: searchTerms
    });

    let allMatches = [];
    
    // Helper function to check item matches
    const checkItemMatches = (items, searchTerms, searchLower, allMatches, searchTerm) => {
        for (const item of items) {
            const itemLower = item.toLowerCase();

            // Check if this item is explicitly excluded for this search term
            const exclusionList = searchExclusionMap[searchLower];
            if (exclusionList && exclusionList.some(excluded => itemLower === excluded.toLowerCase())) {
                continue; // Skip this item - it's excluded
            }

            // Check if any search term matches this item
            let matchFound = false;
            let bestMatchTerm = searchLower;
            let isExactMatch = false;
            let isFullContainment = false;

                for (const term of searchTerms) {
                    // Check exclusions for this specific term too
                    const termExclusions = searchExclusionMap[term];
                    if (termExclusions && termExclusions.some(excluded => itemLower === excluded.toLowerCase())) {
                        continue;
                    }

                    // Prevent uber/uber eats cross matching with more precise logic
                    if (term === 'uber' && (itemLower.includes('uber eats') || itemLower.includes('ubereats'))) {
                        // Skip uber eats items when searching for 'uber'
                        continue;
                    }
                    if ((term === 'uber eats' || term === 'ubereats' || term === 'ubereat' || term === 'uber eat') && itemLower === 'uber') {
                        // Skip 'uber' item when searching for uber eats variants
                        continue;
                    }

                // Check for matches with word boundary awareness
                const exactMatch = itemLower === term;
                const itemContainsTerm = itemLower.includes(term);

                // For term.includes(itemLower), check if it's a word boundary match
                // to prevent "singapore airlines" from matching "gap"
                let termContainsItem = false;
                if (term.includes(itemLower)) {
                    // Create word boundary regex: match itemLower as complete word(s)
                    // Use \b for English, allow Chinese characters to match anywhere
                    const isChinese = /[\u4e00-\u9fa5]/.test(itemLower);
                    if (isChinese) {
                        // For Chinese, allow substring match
                        termContainsItem = true;
                    } else {
                        // For English, require word boundaries
                        const wordBoundaryRegex = new RegExp(`(^|\\s|[^a-z])${itemLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-z])`, 'i');
                        termContainsItem = wordBoundaryRegex.test(term);
                    }
                }

                if (exactMatch || itemContainsTerm || termContainsItem) {
                    matchFound = true;

                    if (exactMatch) {
                        isExactMatch = true;
                        bestMatchTerm = term;
                        break;
                    }
                    if (itemContainsTerm) {
                        isFullContainment = true;
                        bestMatchTerm = term;
                    }
                }
            }

            if (matchFound) {
                console.log(`    ✓ 匹配到: "${item}" (搜尋詞: "${bestMatchTerm}")`);
                allMatches.push({
                    originalItem: item,
                    searchTerm: searchTerm,
                    itemLower: itemLower,
                    searchLower: bestMatchTerm,
                    // Calculate match quality
                    isExactMatch: isExactMatch,
                    isFullContainment: isFullContainment,
                    length: itemLower.length
                });
            }
        }
    };
    
    // Collect all possible matches using all search terms
    for (const card of cardsData.cards) {
        // Check cashbackRates items (包含隱藏的rate，因為隱藏rate也在cashbackRates中)
        for (const rateGroup of card.cashbackRates) {
            checkItemMatches(rateGroup.items, searchTerms, searchLower, allMatches, searchTerm);
        }

        // Check specialItems for CUBE card
        if (card.specialItems) {
            checkItemMatches(card.specialItems, searchTerms, searchLower, allMatches, searchTerm);
        }

        // Check generalItems for CUBE card
        if (card.generalItems) {
            for (const [category, items] of Object.entries(card.generalItems)) {
                checkItemMatches(items, searchTerms, searchLower, allMatches, searchTerm);
            }
        }

        // Check couponCashbacks merchant field
        if (card.couponCashbacks) {
            for (const coupon of card.couponCashbacks) {
                if (coupon.merchant) {
                    // Split merchant string into array (comma-separated)
                    // 防禦：merchant 可能被資料匯出成 number（如 "8000"），String() 避免 .split 崩潰
                    const merchantItems = String(coupon.merchant).split(',').map(m => m.trim());
                    checkItemMatches(merchantItems, searchTerms, searchLower, allMatches, searchTerm);
                }
            }
        }
    }
    
    if (allMatches.length === 0) return null;

    // Remove duplicates (same item appearing in multiple cards)
    // 使用 itemLower 並考慮 fuzzySearchMap 映射關係去重
    // 這樣"KLOOK"和"klook"會被視為相同，"海外"和"國外"也會被視為相同
    const uniqueMatches = [];
    const seenItems = new Set();

    // Helper function to get normalized key considering fuzzy search mappings
    const getNormalizedKey = (itemLower) => {
        // If this item maps to another term in fuzzySearchMap, use the mapped term
        // This ensures "海外" and "國外" get the same key
        if (fuzzySearchMap[itemLower]) {
            const mappedTerm = fuzzySearchMap[itemLower].toLowerCase();
            // Use the alphabetically first term as the canonical key to avoid circular mapping
            return itemLower < mappedTerm ? itemLower : mappedTerm;
        }
        return itemLower;
    };

    for (const match of allMatches) {
        const itemKey = getNormalizedKey(match.itemLower);

        if (!seenItems.has(itemKey)) {
            seenItems.add(itemKey);
            if (exactOnly && !match.isExactMatch) continue;
            uniqueMatches.push(match);
        }
    }

    // 添加調試日誌
    console.log(`🔍 findMatchingItem 搜尋結果: 找到 ${allMatches.length} 個匹配, 去重後 ${uniqueMatches.length} 個唯一item`);
    uniqueMatches.forEach(m => console.log(`  ✓ ${m.originalItem}`));
    
    // Sort by match quality
    uniqueMatches.sort((a, b) => {
        // 1. Exact matches first
        if (a.isExactMatch && !b.isExactMatch) return -1;
        if (!a.isExactMatch && b.isExactMatch) return 1;
        
        // 2. Full containment (search term fully contained in item)
        if (a.isFullContainment && !b.isFullContainment) return -1;
        if (!a.isFullContainment && b.isFullContainment) return 1;
        
        // 3. For non-exact matches, prefer shorter items (more specific)
        if (!a.isExactMatch && !b.isExactMatch) {
            return a.length - b.length;
        }
        
        return 0;
    });
    
    // Return all matches for comprehensive results
    return uniqueMatches;
}

// Show matched item(s)
// summaryText：送出後才知道「你的選項下符合幾筆」，打字時不傳（打字階段還沒算結果）。
// 由呼叫端組好字串（活動與領券的量詞不同），這裡只負責接在 ✓ 那行後面。
// 這一行的職責始終是「你打的詞我認得，認到這幾個」；「你的設定下有沒有結果」是另一回事，
// 沒有結果時由 showMatchedButNoActivityMessage() 用紅字第二行講，不會把 ✓ 覆蓋掉。
function showMatchedItem(matchedItems, merchantValue = '', cardsToCheck = [], summaryText = null) {
    let messageHtml = '';

    if (Array.isArray(matchedItems)) {
        if (matchedItems.length === 1) {
            messageHtml = `✓ 匹配到: <strong>${escapeHtml(matchedItems[0].originalItem)}</strong>`;
        } else {
            // 如果所有項目名稱相同，只顯示一次
            const uniqueItems = [...new Set(matchedItems.map(item => item.originalItem))];
            if (uniqueItems.length === 1) {
                messageHtml = `✓ 匹配到: <strong>${escapeHtml(uniqueItems[0])}</strong>`;
            } else {
                const itemList = uniqueItems.join('、');
                messageHtml = `✓ 匹配到: <strong>${escapeHtml(itemList)}</strong>`;
            }
        }
    } else {
        // Backward compatibility for single item
        messageHtml = `✓ 匹配到: <strong>${escapeHtml(matchedItems.originalItem)}</strong>`;
    }

    if (summaryText) {
        messageHtml += ` | ${escapeHtml(summaryText)}`;
    }

    // Check if there are parking benefits matches
    if (merchantValue && cardsData && cardsData.benefits && cardsData.benefits.length > 0) {
        const merchantLower = merchantValue.toLowerCase().trim();
        const matchingBenefits = cardsData.benefits.filter(benefit => {
            if (!benefit.active) return false;

            // Check if this card is in the user's selection
            const shouldShow = !currentUser || cardsToCheck.some(card => card.id === benefit.id);
            if (!shouldShow) return false;

            // Check if merchants match
            if (benefit.merchants && Array.isArray(benefit.merchants)) {
                return benefit.merchants.some(merchant => {
                    const merchantItemLower = merchant.toLowerCase();
                    return merchantLower.includes(merchantItemLower) || merchantItemLower.includes(merchantLower);
                });
            }
            return false;
        });

        if (matchingBenefits.length > 0) {
            messageHtml += `<br>✓ 匹配到: <a href="javascript:void(0)" class="parking-jump-link" onclick="scrollToParkingBenefits()">停車折抵優惠 (${matchingBenefits.length}張卡片) - 點擊查看 ↓</a>`;
        }
    }

    matchedItemDiv.innerHTML = messageHtml;
    matchedItemDiv.className = 'matched-item';
    matchedItemDiv.style.display = 'block';
}

// Show no match message with styling
function showNoMatchMessage(merchantValue = '', cardsToCheck = []) {
    // 回顯商家名讓用戶能確認「是打錯字還是真的沒活動」；用戶輸入必過 escapeHtml（鐵則）
    const safeMerchant = escapeHtml((merchantValue || '').trim());
    const merchantPart = safeMerchant ? `<strong>${safeMerchant}</strong>` : '任何商家';
    let messageHtml = `✘ 沒有匹配到 ${merchantPart} 的活動（以下結果顯示基本回饋）`;
    let hasParkingMatch = false;

    // Check if there are parking benefits matches
    if (merchantValue && cardsData && cardsData.benefits && cardsData.benefits.length > 0) {
        const merchantLower = merchantValue.toLowerCase().trim();
        const matchingBenefits = cardsData.benefits.filter(benefit => {
            if (!benefit.active) return false;

            // Check if this card is in the user's selection
            const shouldShow = !currentUser || cardsToCheck.some(card => card.id === benefit.id);
            if (!shouldShow) return false;

            // Check if merchants match
            if (benefit.merchants && Array.isArray(benefit.merchants)) {
                return benefit.merchants.some(merchant => {
                    const merchantItemLower = merchant.toLowerCase();
                    return merchantLower.includes(merchantItemLower) || merchantItemLower.includes(merchantLower);
                });
            }
            return false;
        });

        if (matchingBenefits.length > 0) {
            hasParkingMatch = true;
            messageHtml += `<br>✓ 匹配到: <a href="javascript:void(0)" class="parking-jump-link" onclick="scrollToParkingBenefits()">停車折抵優惠 (${matchingBenefits.length}張卡片) - 點擊查看 ↓</a>`;
        }
    }

    matchedItemDiv.innerHTML = messageHtml;
    // Use different style class depending on whether parking benefits matched
    matchedItemDiv.className = hasParkingMatch ? 'matched-item partial-match' : 'matched-item no-match';
    matchedItemDiv.style.display = 'block';
    // 匹配狀態列一次只顯示一行：✘/部分匹配訊息出現時收起精準搜尋的橙色提示
    toggleExactSearchEmptyHint(false);
}

// 「匹配到了，但你加入比較的卡片裡沒有這個活動」（2026-09-11 新增）
//
// 修的是一個會讓人以為搜尋壞掉的訊息：打字時的提示掃**全部卡片**，按下計算卻只算
// **加入比較的卡片**。於是「樂天KOBO 只有台新 Richart 有、而用戶沒把那張卡加入比較」
// 這種情況，畫面會先顯示「✓ 匹配到: 樂天KOBO」，按下計算後被 showNoMatchMessage()
// 改寫成「✘ 沒有匹配到『樂天kobo』的商家」——但匹配根本沒失敗，只是被卡片篩選擋掉。
// 用戶（與站長）都會把它讀成搜尋壞了。
//
// 「其他卡片中有 N 張」只認**真的算得出回饋**的卡：先用 _itemsIndex 挑候選（O(1) 查表，
// 不掃全卡），再對候選實際算一次，取 cashbackAmount > 0 的。不這樣做的話，活動已結束、
// 尚未開始、或算出來是 0 的卡也會被算進去，等於叫用戶去加一張同樣沒用的卡。
// N 為 0 時（例如只靠 couponCashbacks 匹配到，或所有活動都算不出回饋）換一句話講，
// 不要顯示「有 0 張卡有」。
async function showMatchedButNoActivityMessage(matchedItems, cardsToCheck = [], amount = 1000, couponCount = 0) {
    const list = Array.isArray(matchedItems) ? matchedItems : [matchedItems];
    const names = [...new Set(list.map(m => (m && m.originalItem) || '').filter(Boolean))];
    const displayName = names.join('、');

    const outsideCount = await countCardsWithActivityOutside(names, cardsToCheck, amount);

    // 兩行分工：第一行只講「詞認得」（綠色，跟打字時同一句，不推翻它）；
    // 第二行才講「你的設定下沒有結果」（紅色）。合成一句會變成「✓ 開頭、否定結尾」，
    // 要讀完整句才懂——那正是 2026-09-11 用戶回報的困惑點。
    let warn;
    if (outsideCount > 0) {
        warn = `✘ 你的選項中沒有符合的活動，試看看修改信用卡選項！（其他卡片中有 ${outsideCount} 張卡符合）`;
    } else if (couponCount > 0) {
        // 只靠 couponCashbacks 匹配到的商家（資料裡有 49 個這種），領券結果在下方另一區塊，
        // 說「沒有活動」會與畫面矛盾——要指出領券那一區
        warn = `✘ 沒有卡片有這個商家的一般活動（下方有 ${couponCount} 筆領券優惠）`;
    } else {
        warn = '✘ 目前沒有卡片有這個商家的活動';
    }

    let messageHtml = `✓ 匹配到 <strong>${escapeHtml(displayName)}</strong>`;
    messageHtml += `<br><span class="matched-item-warn">${warn}</span>`;

    // 停車折抵與一般活動是兩套資料，這裡沒活動不代表停車也沒有——沿用 showNoMatchMessage 的附加
    if (cardsData && cardsData.benefits && cardsData.benefits.length > 0) {
        const merchantLower = displayName.toLowerCase().trim();
        const matchingBenefits = cardsData.benefits.filter(benefit => {
            if (!benefit.active) return false;
            const shouldShow = !currentUser || cardsToCheck.some(card => card.id === benefit.id);
            if (!shouldShow) return false;
            if (benefit.merchants && Array.isArray(benefit.merchants)) {
                return benefit.merchants.some(merchant => {
                    const merchantItemLower = merchant.toLowerCase();
                    return merchantLower.includes(merchantItemLower) || merchantItemLower.includes(merchantLower);
                });
            }
            return false;
        });
        if (matchingBenefits.length > 0) {
            messageHtml += `<br>✓ 匹配到: <a href="javascript:void(0)" class="parking-jump-link" onclick="scrollToParkingBenefits()">停車折抵優惠 (${matchingBenefits.length}張卡片) - 點擊查看 ↓</a>`;
        }
    }

    matchedItemDiv.innerHTML = messageHtml;
    // 容器維持預設（綠）讓第一行是 ✓ 的顏色；紅字只落在第二行的 .matched-item-warn
    matchedItemDiv.className = 'matched-item';
    matchedItemDiv.style.display = 'block';
    toggleExactSearchEmptyHint(false);
}

// 比較清單「以外」、真的有東西可看的卡有幾張（理由見 showMatchedButNoActivityMessage）。
// 一般活動與領券活動要分開查：領券的商家欄不會進 _itemsIndex（那支索引只收
// cashbackRates／specialItems／generalItems），只看索引會把「只有券的卡」算成 0，
// 於是明明別張卡有券，卻對使用者說「沒有卡片有這個商家的活動」。
async function countCardsWithActivityOutside(itemNames, cardsToCheck, amount) {
    if (!cardsData || !Array.isArray(cardsData.cards)) return 0;
    const inSet = new Set((cardsToCheck || []).map(c => c.id));
    const names = itemNames.map(n => String(n).toLowerCase()).filter(Boolean);
    if (names.length === 0) return 0;

    let count = 0;
    for (const card of cardsData.cards) {
        if (inSet.has(card.id)) continue;

        // ① 一般活動：先用 _itemsIndex 挑候選（O(1) 查表），再實際算一次，只認回饋 > 0 的。
        //    不實算的話，活動已結束／尚未開始／算出來是 0 的卡也會被算進去，
        //    等於叫使用者去加一張同樣沒用的卡。
        let hit = false;
        if (card._itemsIndex && names.some(n => card._itemsIndex.has(n))) {
            for (const name of names) {
                const rs = await calculateCardCashback(card, name, amount);
                if (rs && rs.some(r => r.cashbackAmount > 0)) { hit = true; break; }
            }
        }

        // ② 領券活動：merchant 是逗號分隔字串，逐項比對（過期的券已由 filterExpiredRates 濾掉）
        if (!hit && Array.isArray(card.couponCashbacks)) {
            hit = card.couponCashbacks.some(coupon => {
                if (!coupon.merchant) return false;
                return String(coupon.merchant).split(',')
                    .map(x => x.trim().toLowerCase())
                    .some(x => x && names.includes(x));
            });
        }

        if (hit) count++;
    }
    return count;
}

// Hide matched item
function hideMatchedItem() {
    matchedItemDiv.style.display = 'none';
}

// Scroll to parking benefits section
function scrollToParkingBenefits() {
    const parkingSection = document.getElementById('parking-benefits-section');
    if (parkingSection && parkingSection.style.display !== 'none') {
        parkingSection.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
        // Add a brief highlight animation
        parkingSection.style.transition = 'background-color 0.5s ease';
        parkingSection.style.backgroundColor = '#dbeafe';
        setTimeout(() => {
            parkingSection.style.backgroundColor = '';
        }, 1500);
    }
}


// 送出時重新推導匹配（2026-09-10）：輸入框的值是唯一真相。
//
// calculateCashback() 原本直接讀 currentMatchedItem，而那個全域只有輸入框的 input 事件
// （handleMerchantInput）和快捷搜尋會更新。於是任何「值已經變了、但 input 的處理還沒跑完
// 就觸發計算」的情況，都會用舊關鍵詞算出結果——畫面上更詭異的是匹配狀態列由晚到的 input
// 更新成新詞，結果列表卻是舊詞算的（實例：狀態列寫「✓ 匹配到: 樂天KOBO」，結果卻是「樂天」
// 的 6 張卡，台新 Richart 不在裡面）。已知觸發路徑：IME 組字送出時 Enter 與 compositionend
// 的到達順序、瀏覽器還原表單值（F5／上一頁回來都不派 input）、程式填值忘了 dispatch。
//
// 這裡只改「什麼時候算」，不改「怎麼算」：呼叫的是同一支 findMatchingItem()、同一個
// 精準搜尋開關，所以本來就正確的情況重算會得到一樣的結果（等冪）。成本實測 ≤0.7ms。
//
// 與 handleMerchantInput() 刻意不共用的兩點：
// - 快捷搜尋的 currentMatchedItem 是多個關鍵詞的聯集，輸入框裡只有 displayName（不是 item），
//   拿它重算會變成無匹配 → 輸入框仍等於當前快捷選項的 displayName 時直接跳過不動。
// - 不碰 checkAndShowSearchHint：搜尋提示是打字中的引導，不屬於送出流程。
function syncMatchedItemToInput() {
    if (!cardsData || !merchantInput) return;

    const raw = merchantInput.value.trim();

    // 快捷搜尋的結果不能用 displayName 重算（理由見上）
    if (currentQuickSearchOption &&
        raw === (currentQuickSearchOption.displayName || '').trim()) {
        return;
    }
    // 走到這裡代表輸入框的內容已不是那個快捷選項 → 選項不再適用
    currentQuickSearchOption = null;

    if (raw.length === 0) {
        hideMatchedItem();
        toggleExactSearchEmptyHint(false);
        currentMatchedItem = null;
        return;
    }

    const input = raw.toLowerCase();
    const exactOnly = isExactSearchEnabled();
    const matchedItems = findMatchingItem(input, { exactOnly });

    if (matchedItems && matchedItems.length > 0) {
        showMatchedItem(matchedItems, input, getCardsForComparison());
        toggleExactSearchEmptyHint(false);
        currentMatchedItem = matchedItems;
    } else {
        hideMatchedItem();
        currentMatchedItem = null;
        // 精準搜尋下沒有完全一致、但放寬後有相近結果 → 提示用戶可取消勾選
        toggleExactSearchEmptyHint(exactOnly && (findMatchingItem(input) || []).length > 0);
    }
}

// Validate inputs
function validateInputs() {
    const merchantValue = merchantInput.value.trim();
    const amountValue = parseFloat(amountInput.value);

    // Empty amount is valid (defaults to 1000)
    const isValid = merchantValue.length > 0 &&
                   (amountInput.value === '' || (!isNaN(amountValue) && amountValue > 0));

    calculateBtn.disabled = !isValid;
}

// 合併相同活動的搜尋結果：同一張卡 + 同 rate/cap/期間/類別 = 同一個活動，
// 個別匹配到的 item 收進 matchedItems 陣列。
// （這段邏輯原本在 calculateCashback 內複製了 4 份：多項目/單項目/即將開始 ×2）
function mergeResultsByActivity(resultList) {
    const merged = new Map();
    for (const result of resultList) {
        const mergeKey = `${result.card.id}-${result.rate}-${result.cap || 'nocap'}-${result.periodStart || ''}-${result.periodEnd || ''}-${result.matchedCategory || 'nocat'}`;

        if (merged.has(mergeKey)) {
            // Same activity - merge matched items
            const existing = merged.get(mergeKey);
            if (!existing.matchedItems) {
                existing.matchedItems = existing.matchedItem ? [existing.matchedItem] : [];
            }
            const newItems = result.matchedItems || [result.matchedItemName || result.matchedItem];
            for (const item of newItems) {
                if (item && !existing.matchedItems.includes(item)) {
                    existing.matchedItems.push(item);
                }
            }
        } else {
            // New activity - create new entry
            merged.set(mergeKey, {
                ...result,
                matchedItems: result.matchedItems || [result.matchedItemName || result.matchedItem]
            });
        }
    }
    return Array.from(merged.values());
}

// 無匹配活動時的「基本回饋」結果（含國內加碼卡如永豐幣倍的兩層計算）。
// （原本在「有搜尋詞但無結果」與「無搜尋詞」兩處各複製一份）
function buildBasicCashbackResult(card, amount) {
    let basicCashbackAmount = 0;
    let effectiveRate = card.basicCashback;
    let displayCap = null;
    let layers;

    if (card.domesticBonusRate && card.domesticBonusCap) {
        // Handle complex cards like 永豐幣倍 with domestic bonus
        const bonusAmount = Math.min(amount, card.domesticBonusCap);
        const bonusCashback = Math.floor(bonusAmount * card.domesticBonusRate / 100);
        const basicCashback = Math.floor(amount * card.basicCashback / 100);
        basicCashbackAmount = bonusCashback + basicCashback;
        effectiveRate = card.basicCashback + card.domesticBonusRate;
        displayCap = card.domesticBonusCap;
        layers = [
            { name: '基本回饋', rate: card.basicCashback, applicableAmount: amount, cashback: basicCashback, cap: null },
            { name: '國內消費加碼', rate: card.domesticBonusRate, applicableAmount: bonusAmount, cashback: bonusCashback, cap: card.domesticBonusCap }
        ];
    } else {
        basicCashbackAmount = Math.floor(amount * card.basicCashback / 100);
        layers = [
            { name: '基本回饋', rate: card.basicCashback, applicableAmount: amount, cashback: basicCashbackAmount, cap: null }
        ];
    }

    return {
        rate: effectiveRate,
        cashbackAmount: basicCashbackAmount,
        cap: displayCap,
        matchedItem: null,
        effectiveAmount: amount,
        card: card,
        isBasic: true,
        calculationLayers: layers
    };
}

