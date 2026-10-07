/* ============================================================
 * Pick My Card — js/card-detail.js（載入順序 9/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 卡片詳情頁主體            → "showCardDetail"
 *  - 近期異動（changelog）      → "renderCardDetailChangelog"
 *  - CUBE 卡專屬內容            → "generateCubeSpecialContent" / "updateCubeSpecialCashback"
 *  - onclick 轉義               → "escapeForOnclick"
 *  - 詳情頁回饋卡（版面比照搜尋結果）→ "renderRateCard" / "formatRateCardCap"
 *  - 商家清單展開收合（含 window 賦值）→ "toggleMerchants"
 *  - 詳情頁項目過濾            → "filterCashbackItems"
 *  - 用戶筆記                  → "loadUserNotes" / "saveUserNotes"
 * ============================================================ */
async function showCardDetail(cardId) {
    const card = cardsData.cards.find(c => c.id === cardId);
    if (!card) return;

    // 追蹤卡片詳情查看
    if (window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'view_card_detail', {
            card_id: cardId,
            card_name: card.name,
            surface: getAnalyticsSurface()
        });
    }

    // 重置指定通路回饋的搜尋框
    const cashbackSearchInput = document.getElementById('cashback-search-input');
    if (cashbackSearchInput) cashbackSearchInput.value = '';
    const cashbackSearchEmpty = document.getElementById('cashback-search-empty');
    if (cashbackSearchEmpty) cashbackSearchEmpty.style.display = 'none';

    const modal = document.getElementById('card-detail-modal');

    // Update basic information
    document.getElementById('card-detail-title').textContent = card.name;

    // 卡片用途（Cards Data 的 cardUseCase 欄，選填）：一句話講這張卡適合什麼情境。
    // 用 textContent 不用 innerHTML——這是站長在 Sheets 自由輸入的文字（鐵則 3），
    // textContent 比事後 escapeHtml() 少一個「哪天改成字串拼接就破功」的失誤面
    // （同 renderCardDetailChangelog 的作法）。
    // 每次呼叫都要明確設 hidden：上一張卡有、這張沒有時不能沿用舊狀態。
    const useCaseEl = document.getElementById('card-use-case');
    if (useCaseEl) {
        const useCase = (card.cardUseCase || '').trim();
        useCaseEl.textContent = useCase;
        useCaseEl.hidden = !useCase;
    }

    // Header 申辦按鈕（桌機）＋ sticky 申辦列（手機）：兩者共用同一份 applyCta 資料。
    // 每次呼叫都要明確重設 hidden——上一張卡有 CTA、這張沒有時不能沿用舊狀態。
    const applyCta = cardsData && cardsData.cardApplyCtas && cardsData.cardApplyCtas[card.id];
    const applyLink = applyCta ? sanitizeUrl(applyCta.link) : '';
    const headerApplyBtn = document.getElementById('card-detail-apply-header-btn');
    const applyBar = document.getElementById('card-detail-apply-bar');
    const applyBarText = applyBar ? applyBar.querySelector('.card-detail-apply-bar-text') : null;
    const applyBarBtn = applyBar ? applyBar.querySelector('.card-detail-apply-bar-btn') : null;
    if (applyLink) {
        if (headerApplyBtn) {
            headerApplyBtn.hidden = false;
            headerApplyBtn.href = applyLink;
            headerApplyBtn.title = applyCta.text || '';
            headerApplyBtn.dataset.cardId = card.id;
            headerApplyBtn.dataset.cardName = card.name;
        }
        if (applyBar) {
            applyBar.hidden = false;
            if (applyBarText) {
                const text = applyCta.text || '';
                applyBarText.textContent = text;
                applyBarText.hidden = !text;
            }
            if (applyBarBtn) {
                applyBarBtn.href = applyLink;
                applyBarBtn.dataset.cardId = card.id;
                applyBarBtn.dataset.cardName = card.name;
            }
        }
    } else {
        if (headerApplyBtn) headerApplyBtn.hidden = true;
        if (applyBar) applyBar.hidden = true;
    }

    // Optional card image (assets/images/cards/<card.id>.png) — gracefully hides if missing
    const headerImg = document.getElementById('card-detail-image');
    if (headerImg) {
        headerImg.hidden = false;
        headerImg.onerror = () => { headerImg.hidden = true; };
        headerImg.src = `assets/images/cards/${card.id}.png`;
    }

    const fullNameLink = document.getElementById('card-full-name-link');
    fullNameLink.textContent = card.fullName || card.name;

    // Render tags after card full name
    const cardInfoSection = modal.querySelector('.card-info-section');
    const existingTags = cardInfoSection.querySelector('.card-tags-container');
    if (existingTags) {
        existingTags.remove();
    }

    if (card.tags && card.tags.length > 0) {
        const tagsHtml = renderCardTags(card.tags);
        const infoGrid = cardInfoSection.querySelector('.info-grid-2col');
        if (infoGrid) {
            infoGrid.insertAdjacentHTML('afterend', tagsHtml);
        }
    }

    // 直接顯示年費和免年費資訊
const annualFeeText = card.annualFee || '無資料';
const feeWaiverText = card.feeWaiver || '無資料';
const combinedFeeInfo = `${annualFeeText} ${feeWaiverText}`;

document.getElementById('card-annual-fee').textContent = combinedFeeInfo;
document.getElementById('card-fee-waiver').style.display = 'none';

    // Update cashback type and points expiry
    const cashbackTypeDiv = document.getElementById('card-cashback-type');
    const cashbackTypeExpirySection = document.getElementById('cashback-type-expiry-section');

    // 只在有資料時顯示此區塊
    if (card.basicCashbackType || card.pointsExpiry) {
        const parts = [];
        if (card.basicCashbackType) parts.push(card.basicCashbackType);
        if (card.pointsExpiry) parts.push(card.pointsExpiry);
        cashbackTypeDiv.textContent = parts.join(' | ');
        cashbackTypeExpirySection.style.display = 'flex';
    } else {
        cashbackTypeExpirySection.style.display = 'none';
    }

    // Update basic cashback
const basicCashbackDiv = document.getElementById('card-basic-cashback');
// 四種一般回饋（國內／海外／國內加碼／海外加碼）都用 renderRateCard，版面比照搜尋結果卡片；
// 標題列放「國內」「海外加碼」這類名稱，相當於指定通路卡的活動類別
let basicContent = renderRateCard({
    rate: card.basicCashback,
    capText: '無上限',
    title: '國內一般消費',
    titleIsDisplay: true,
    conditions: card.basicConditions
});

if (card.overseasCashback) {
    basicContent += renderRateCard({
        rate: card.overseasCashback,
        capText: '無上限',
        title: '海外一般消費',
        titleIsDisplay: true
    });
}

// Check for domesticBonusRate and overseasBonusRate in card level or levelSettings
let domesticBonusRate = card.domesticBonusRate;
let domesticBonusCap = card.domesticBonusCap;
let domesticConditions = card.domesticBonusConditions;
let overseasBonusRate = card.overseasBonusRate;
let overseasBonusCap = card.overseasBonusCap;
let overseasConditions = card.overseasBonusConditions;

// If card has levels, check levelSettings for bonus rates
if (card.hasLevels) {
    const levelNames = Object.keys(card.levelSettings);
    const defaultLevel = levelNames[0];
    const { data: levelData } = await resolveCardLevel(card, defaultLevel);

    if (levelData && levelData.domesticBonusRate !== undefined) {
        domesticBonusRate = levelData.domesticBonusRate;
        domesticBonusCap = levelData.domesticBonusCap;
        domesticConditions = levelData.domesticBonusConditions || card.domesticBonusConditions;
    }
    if (levelData && levelData.overseasBonusRate !== undefined) {
        overseasBonusRate = levelData.overseasBonusRate;
        overseasBonusCap = levelData.overseasBonusCap;
        overseasConditions = levelData.overseasBonusConditions || card.overseasBonusConditions;
    }
}

// 加碼的上限欄：舊版沒填 cap 時整行不顯示（沒說無上限也沒說有上限），
// 改成固定欄位後沿用 formatRateCardCap，沒填一律顯示「無上限」——與計算一致
// （resolveBonusComponent 的 bonusCap 為 null 時套用整筆金額）
if (domesticBonusRate) {
    basicContent += renderRateCard({
        rate: domesticBonusRate,
        ratePrefix: '+',
        capText: formatRateCardCap(domesticBonusCap),
        title: '國內加碼',
        titleIsDisplay: true,
        conditions: domesticConditions
    });
}

if (overseasBonusRate) {
    basicContent += renderRateCard({
        rate: overseasBonusRate,
        ratePrefix: '+',
        capText: formatRateCardCap(overseasBonusCap),
        title: '海外加碼',
        titleIsDisplay: true,
        conditions: overseasConditions
    });
}

basicCashbackDiv.innerHTML = basicContent;
    
    // Handle level selection for all cards with levels
    const cubeLevelSection = document.getElementById('cube-level-section');

    if (card.hasLevels) {
        const levelNames = Object.keys(card.levelSettings);
        const defaultLevel = levelNames[0];

        // Generate level selector HTML with note (通用支援)
        const { level: savedLevel, data: savedLevelData } = await resolveCardLevel(card, defaultLevel);

        // 級別備註（level-note）與「各級別回饋率」原本是攤在選擇器旁/下方的兩塊小字。
        // 2026-08-01 改成收進「i」按鈕的浮動說明窗：這兩段是查表用的參考資料，不是
        // 每次開卡都要讀的東西，攤開來只是把「個人設定」撐高、把真正要操作的下拉選單
        // 擠到旁邊。內容不變，只是預設收起來。
        const levelNoteText = savedLevelData['level-note'] || '';
        // level-note 由級別切換時就地更新（見下方 levelSelect.onchange），所以固定留這個節點
        const levelNote = `<div id="level-note" class="level-help-note">${escapeHtml(levelNoteText)}</div>`;

        // Generate level rates info
        let levelRatesInfo = '';
        if (levelNames.length > 1) {
            levelRatesInfo = '<div class="level-help-rates">';
            levelRatesInfo += '<div class="level-help-rates-title">各級別回饋率</div>';

            if (card.id === 'cathay-cube') {
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    const displayRate = data.specialRate || data.rate || 0;
                    levelRatesInfo += `<div class="level-help-rate-line">• ${escapeHtml(level)}: ${displayRate}%</div>`;
                });
                levelRatesInfo += `<div class="level-help-rates-foot">由分級決定回饋率的方案包含：玩數位、樂饗購、趣旅行</div>`;
            } else if (card.id === 'dbs-eco') {
                // Simplified format for mobile compatibility
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div class="level-help-rate-line">• ${escapeHtml(level)}: ${data.rate}%</div>`;
                });
            } else if (card.id === 'sinopac-dawho') {
                // 永豐大戶卡自訂格式
                levelRatesInfo += `
                    <div class="level-help-rate-line">• 大戶Plus等級:</div>
                    <div class="level-help-rate-line level-help-rate-sub">國內外加碼 4% (上限 NT$10,000 / NT$25,000 )</div>
                    <div class="level-help-rate-line level-help-rate-sub">悠遊卡自動加值 5% (上限 NT$10,000)</div>
                    <div class="level-help-rate-line">• 大戶等級:</div>
                    <div class="level-help-rate-line level-help-rate-sub">國內外加碼 2.5% (上限 NT$3,333 / NT$16,000)</div>
                    <div class="level-help-rate-line level-help-rate-sub">悠遊卡自動加值 3% (上限 NT$3,333)</div>
                    <div class="level-help-rate-line">• 大大等級: 只享有一般回饋</div>
                `;
            } else if (card.id === 'sinopac-coin') {
                // 永豐幣倍卡自訂格式
                levelRatesInfo += `
                    <div class="level-help-rate-line">精選通路加碼 4%</div>
                    <div class="level-help-rate-line">• Level 1：上限 NT$7,500</div>
                    <div class="level-help-rate-line">• Level 2：上限 NT$20,000</div>
                `;
            } else {
                // Default formatting for other cards (like Uni card)
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div class="level-help-rate-line">• ${escapeHtml(level)}: ${data.rate}% (上限 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'})</div>`;
                });
            }
            levelRatesInfo += '</div>';
        }

        // 「i」按鈕＋浮動說明窗。兩段內容都沒有時就不長按鈕（免得點開是空的）。
        // 窗體用原生 Popover API 進 top layer——modal 自己有 z-index/overflow，
        // 一般絕對定位的浮層會被 .modal-content 的捲動容器裁掉。
        const hasLevelHelp = !!(levelRatesInfo || levelNoteText);
        const levelHelpHtml = hasLevelHelp ? `
            <button type="button" class="level-help-btn" id="level-help-btn"
                    aria-expanded="false" aria-label="級別說明">i</button>
            <div id="level-help-popup" class="level-help-popup" popover>
                ${levelRatesInfo}
                ${levelNote}
            </div>
        ` : levelNote;   // 沒東西可看時仍保留 level-note 節點（切換級別的更新目標），CSS 讓它不佔位

        let levelSelectorHTML;

        if (card.id === 'cathay-cube') {
            // CUBE card: all three settings rows in one unified card
            const monthOptions = !currentUser ? '' :
                '<option value="">-- 未設定 --</option>' +
                Array.from({length: 12}, (_, i) => {
                    const m = i + 1;
                    return `<option value="${m}" ${userBirthdayMonth === m ? 'selected' : ''}>${m}月</option>`;
                }).join('');

            // 「慶生月」方案活動 用 nowrap 包成一個單位：這欄桌機只有約 199px（三欄格線），
            // 不鎖的話會斷在「慶生／月」把方案名切兩半，或讓尾行只剩「活動」兩字
            const birthdayPlan = '<span style="white-space: nowrap;">「慶生月」方案活動</span>';
            const birthdayRow = currentUser ? `
                <div class="personal-field">
                    <div class="personal-field-title">我的生日月份</div>
                    <select id="birthday-month-select" class="personal-level-select">
                        ${monthOptions}
                    </select>
                    <div class="personal-field-hint">設定後僅於生日月份配對${birthdayPlan}</div>
                </div>
            ` : `
                <div class="personal-field">
                    <div class="personal-field-title">我的生日月份</div>
                    <!-- 未登入也擺一個下拉選單（disabled、只有一個說明用選項）：
                         這格若只剩一行灰字，四格排在一起時會看不出它其實是個可設定的欄位，
                         只以為是說明文字。留著選單的外型 ＋ disabled，一眼就知道
                         「這裡本來可以選，但要先登入」 -->
                    <select class="personal-level-select" disabled aria-label="我的生日月份（需登入）">
                        <option>登入後即可設定</option>
                    </select>
                    <div class="personal-field-hint">自動在你的生日月份配對${birthdayPlan}</div>
                </div>
            `;

            // ⚠️ 外層灰底框已由 index.html 的 .personal-settings-box 提供（2026-08-01
            //    級別區與額度/筆記併成同一區），這裡不再自帶邊框背景，否則會框中框。
            //    欄位標題一律 .personal-field-title，與額度/筆記同字級
            levelSelectorHTML = `
                <div class="cube-settings-grid">
                    <div class="personal-field">
                        <div class="personal-field-title">選擇級別</div>
                        <div class="personal-level-row">
                            <select id="card-level-select" class="personal-level-select">
                                ${levelNames.map(level =>
                                    `<option value="${escapeHtml(level)}" ${level === savedLevel ? 'selected' : ''}>${escapeHtml(level)}</option>`
                                ).join('')}
                            </select>
                            ${levelHelpHtml}
                        </div>
                    </div>
                    ${birthdayRow}
                    <div class="personal-field">
                        <label class="personal-field-title personal-field-check">
                            <input type="checkbox" id="children-eligible-checkbox" ${isChildrenEligible ? 'checked' : ''}>
                            <span>我符合「童樂匯」權益</span>
                        </label>
                        <div class="personal-field-hint personal-field-hint-indent">
                            勾選後才會在比較結果納入「童樂匯」方案的活動
                        </div>
                    </div>
                    <div class="personal-field">
                        <label for="cube-issuer-select" class="personal-field-title">發卡組織</label>
                        <select id="cube-issuer-select" class="personal-level-select">
                            ${['Visa', 'Mastercard', 'JCB'].map(issuer =>
                                `<option value="${issuer}" ${issuer === cubeIssuer ? 'selected' : ''}>${issuer}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
            `;
        } else {
            levelSelectorHTML = `
                <div class="personal-field personal-field-level">
                    <div class="personal-field-title">選擇級別</div>
                    <div class="personal-level-row">
                        <select id="card-level-select" class="personal-level-select">
                            ${levelNames.map(level =>
                                `<option value="${escapeHtml(level)}" ${level === savedLevel ? 'selected' : ''}>${escapeHtml(level)}</option>`
                            ).join('')}
                        </select>
                        ${levelHelpHtml}
                    </div>
                </div>
            `;
        }

        cubeLevelSection.innerHTML = levelSelectorHTML;
        cubeLevelSection.style.display = 'block';
        setupLevelHelpPopover();

        // Add change listener
        const levelSelect = document.getElementById('card-level-select');
        levelSelect.onchange = async function() {
            // Update level note (通用支援所有卡片)
            const levelNoteElement = document.getElementById('level-note');
            if (levelNoteElement) {
                const selectedLevelData = card.levelSettings[this.value];
                const noteText = selectedLevelData['level-note'] || '';
                levelNoteElement.textContent = noteText;
            }

            await saveCardLevel(card.id, this.value);
            // Refresh card detail display
            if (card.id === 'cathay-cube') {
                await updateCubeSpecialCashback(card);
            } else {
                // For other cards, just re-render the detail
                await showCardDetail(card.id);
            }
        };

        // 生日月份選擇器事件（CUBE卡，已登入）
        const birthdayMonthSelect = document.getElementById('birthday-month-select');
        if (birthdayMonthSelect) {
            birthdayMonthSelect.onchange = async function() {
                const val = this.value;
                await saveBirthdayMonth(val ? parseInt(val) : null);
            };
        }

        // 童樂匯勾選框事件（影響搜尋配對；不影響 modal 顯示，所以不需要重新渲染）
        const childrenCheckbox = document.getElementById('children-eligible-checkbox');
        if (childrenCheckbox) {
            childrenCheckbox.onchange = async function() {
                await saveChildrenEligible(this.checked);
            };
        }

        // 發卡組織選擇事件（影響搜尋配對；不影響 modal 顯示，所以不需要重新渲染）
        const cubeIssuerSelect = document.getElementById('cube-issuer-select');
        if (cubeIssuerSelect) {
            cubeIssuerSelect.onchange = async function() {
                await saveCubeIssuer(this.value);
            };
        }
    } else {
        // 非分級卡：連內容一起清掉，不只是藏起來。留著上一張卡的級別選擇器與說明窗
        // （含 top layer 的 popover 節點）沒有任何用處，只會讓「這張卡到底有沒有級別」
        // 在 DOM 上讀起來是錯的
        cubeLevelSection.innerHTML = '';
        cubeLevelSection.style.display = 'none';
    }
    
    // Update special cashback
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    let specialContent = '';

    if (card.hasLevels && card.id === 'cathay-cube') {
        specialContent = await generateCubeSpecialContent(card);
    } else if (card.hasLevels && card.specialItems && card.specialItems.length > 0) {
        // Handle generic level-based cards with specialItems (like Uni card and DBS Eco)
        const levelNames = Object.keys(card.levelSettings);
        const { data: levelData } = await resolveCardLevel(card, levelNames[0]);

        // First, display any cashbackRates if they exist (like DBS Eco's 10% cashback)
        // 2026-07-09 起逐筆顯示（不再按 rate+cap 合併），category 以 chip 顯示在回饋率旁
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            const rendered = await renderCashbackRatesIndividually(card, levelData, { idPrefix: 'lvA' });
            specialContent += rendered.html;

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups1 = rendered.upcoming;
            window._currentCard = card;
            window._currentLevelData1 = levelData;
        }

        // Then display the level-based cashback with specialItems
        // （通路多，先顯示 30 個，其餘收在「顯示全部」）
        specialContent += renderRateCard({
            rate: levelData.rate,
            capText: formatRateCardCap(levelData.cap),
            merchants: { items: card.specialItems, id: `uni-${card.id}`, initialCount: 30 },
            conditions: levelData.condition
        });
    } else if (card.hasLevels && (!card.specialItems || card.specialItems.length === 0)) {
        // Handle level-based cards without specialItems (or with empty specialItems array)
        const levelNames = Object.keys(card.levelSettings);
        const { level: savedLevel, data: levelData } = await resolveCardLevel(card, levelNames[0]);

        // Check if card also has cashbackRates (like DBS Eco card)
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            // 2026-07-09 起逐筆顯示（不再按 rate+cap 合併），category 以 chip 顯示在
            // 回饋率旁，回饋率為 getDisplayRate 加總值；cap 留空＝無上限（需要級別
            // cap 的槽明確填 {cap}；capFallbackToLevel 舊行為已於 2026-07-17 移除）
            const rendered = await renderCashbackRatesIndividually(card, levelData, { idPrefix: 'lvB' });
            specialContent += rendered.html;

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups2 = rendered.upcoming;
            window._currentCard = card;
            window._currentLevelData2 = levelData;

            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here
        } else {
            // Original logic for cards without cashbackRates
            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here
            specialContent += renderRateCard({
                rate: levelData.rate,
                rateNote: savedLevel,
                capText: formatRateCardCap(levelData.cap)
            });
        }
    } else if (card.cashbackRates && card.cashbackRates.length > 0) {
        // Separate active and upcoming rates for non-hasLevels cards
        const activeRates = [];
        const upcomingRates = [];

        for (const rate of card.cashbackRates) {
            if (rate.hideInDisplay) continue;

            const rateStatus = getRateStatus(rate.periodStart, rate.periodEnd);
            if (rateStatus === 'active' || rateStatus === 'always') {
                activeRates.push(rate);
            } else if (rateStatus === 'upcoming' && isUpcomingWithinDays(rate.periodStart, 30)) {
                upcomingRates.push(rate);
            }
        }

        // Sort active rates by DISPLAYED percentage descending (so a stacking
        // item like Apple Pay sorts by its summed 5%, not its raw designated 3%)
        const sortedRates = activeRates.sort((a, b) => {
            const aRate = getDisplayRate(card, a, parseCashbackRateSync(a.rate, null), null);
            const bRate = getDisplayRate(card, b, parseCashbackRateSync(b.rate, null), null);
            return bRate - aRate;
        });

        // Store upcoming rates for display in separate section
        if (upcomingRates.length > 0) {
            window._currentUpcomingGroups3 = await Promise.all(upcomingRates.map(async (rate) => {
                const parsedRate = await parseCashbackRate(rate.rate, card, null);
                const parsedCap = parseCashbackCap(rate.cap, card, null);
                return {
                    // stacking 模型顯示加總後的回饋率（與進行中活動一致）
                    parsedRate: getDisplayRate(card, rate, parsedRate, null),
                    // cap 留空的 stacking 槽顯示加碼層的實際上限（見 resolveDisplayCap）
                    parsedCap: resolveDisplayCap(card, rate, parsedCap, null),
                    items: rate.items || [],
                    conditions: rate.conditions ? [{category: rate.category || '', conditions: rate.conditions}] : [],
                    period: rate.period,
                    periodStart: rate.periodStart,
                    periodEnd: rate.periodEnd,
                    status: 'upcoming',
                    category: rate.category
                };
            }));
            window._currentCard = card;
        }

        for (let index = 0; index < sortedRates.length; index++) {
            const rate = sortedRates[index];

            // 解析 rate 值（支援 {specialRate} 和 {rate}，雖然 hasLevels=false 的卡片通常只有數字）
            const parsedRate = await parseCashbackRate(rate.rate, card, null);
            // For stacking models, show the summed rate (designated+basic+bonus),
            // same number the search-result card shows; otherwise show as-is.
            const displayRate = getDisplayRate(card, rate, parsedRate, null);

            // 解析 cap 值（支援 {cap}，hasLevels=false 的卡片通常只有數字）
            const parsedCap = parseCashbackCap(rate.cap, card, null);
            // 顯示用上限：cap 留空的 stacking 槽改顯示加碼層的實際上限（見 resolveDisplayCap）。
            // parsedCap 本身不動——「回饋組成」按鈕要的是這個槽自己的指定通路上限。
            const displayCap = resolveDisplayCap(card, rate, parsedCap, null);
            let capText = formatRateCardCap(displayCap);
            if (displayCap && rate.capDescription && card.id === 'taishin-richart') {
                capText = rate.capDescription;
            }

            // Special handling for Yushan Uni card exclusions
            let items = rate.items || [];
            if (card.id === 'yushan-unicard') {
                items = items.map(item => (item === '街口' || item === '全支付') ? item + '(排除超商)' : item);
            }

            // 版面比照搜尋結果卡片，見 renderRateCard（js/cards-modals.js）
            specialContent += renderRateCard({
                rate: displayRate,
                // stacking 模型加上「回饋組成」按鈕，解釋加總的來源
                rateBtnHtml: rateCompositionButtonHtml(card, rate, parsedRate, parsedCap, null),
                capText,
                title: rate.category,
                endingSoonEnd: rate.periodEnd,
                // 滿額門檻；maxSpend（未滿門檻）只影響匹配、不顯示標註（2026-07-17 用戶定案）
                minSpend: rate.minSpend,
                merchants: { items, id: `${card.id}-${index}` },
                period: rate.period,
                conditions: rate.conditions,
                // 銀行官方登錄連結（有 registerLink 才長出來；conditions 空的組別一樣要能顯示）
                registerLink: rate.registerLink
            });
        }
    } else {
        specialContent = '<div class="cashback-detail-item">無指定通路回饋</div>';
    }
    
    specialCashbackDiv.innerHTML = specialContent;

    // Update upcoming cashback section
    const upcomingSection = document.getElementById('card-upcoming-section');
    const upcomingCashbackDiv = document.getElementById('card-upcoming-cashback');
    const upcomingGroups = window._currentUpcomingGroups1 || window._currentUpcomingGroups2 || window._currentUpcomingGroupsCube || window._currentUpcomingGroups3 || [];
    const upcomingCard = window._currentCard;
    const upcomingLevelData = window._currentLevelData1 || window._currentLevelData2;

    if (upcomingGroups.length > 0) {
        let upcomingContent = '';

        // upcomingGroups1/2 are [key, value] tuples from Map.entries();
        // upcomingGroups3/Cube are plain object arrays. Normalize both to [key, value].
        const groupsToDisplay = upcomingGroups.map((g, i) => Array.isArray(g) ? g : [i, g]);

        for (const [groupKey, group] of groupsToDisplay) {
            // 版面比照搜尋結果卡片（即將開始的搜尋結果同樣只差一個右上徽章，見 ui-display.md 1d 節）。
            // 條件逐條用可收合的條件列（CUBE 合併後可能有好幾條）；玉山 Uni Card 原本另有
            // 「▼ 查看各通路詳細條件」收合鈕，2026-10-05 統一改由條件列自己的「...展開」處理過長內容
            upcomingContent += renderRateCard({
                rate: group.parsedRate,
                capText: formatRateCardCap(group.parsedCap),
                title: group.category,
                upcomingStart: group.periodStart,
                merchants: { items: group.items || [], id: `upcoming-${upcomingCard.id}-group-${groupKey}` },
                period: group.period,
                conditions: (group.conditions || []).map(c => c.conditions),
                extraClass: 'upcoming-activity'
            });
        }

        upcomingCashbackDiv.innerHTML = upcomingContent;
        upcomingSection.style.display = 'block';
    } else {
        upcomingSection.style.display = 'none';
    }

    // Clean up temporary variables
    delete window._currentUpcomingGroups1;
    delete window._currentUpcomingGroups2;
    delete window._currentUpcomingGroupsCube;
    delete window._currentUpcomingGroups3;
    delete window._currentCard;
    delete window._currentLevelData1;
    delete window._currentLevelData2;

    // Update coupon cashback
    const couponSection = document.getElementById('card-coupon-section');
    const couponCashbackDiv = document.getElementById('card-coupon-cashback');
    
    if (card.couponCashbacks && card.couponCashbacks.length > 0) {
        let couponContent = '';

        // 處理每個 coupon，計算實際回饋率
        let couponIndex = 0;
        for (const coupon of card.couponCashbacks) {
            const actualRate = await calculateCouponRate(coupon, card);
            const couponStatus = getRateStatus(coupon.periodStart, coupon.periodEnd);

            // 適用通路（逗號分隔字串）
            const merchantItems = coupon.merchant
                ? coupon.merchant.split(',').map(m => m.trim()).filter(m => m)
                : [];

            // 版面比照搜尋結果卡片，見 renderRateCard（js/cards-modals.js）
            couponContent += renderRateCard({
                rate: actualRate,
                capText: formatRateCardCap(coupon.cap),
                upcomingStart: (couponStatus === 'upcoming' && coupon.periodStart) ? coupon.periodStart : null,
                endingSoonEnd: (couponStatus === 'active' || couponStatus === 'always') ? coupon.periodEnd : null,
                merchants: { items: merchantItems, id: `coupon-${card.id}-${couponIndex}` },
                period: coupon.period,
                conditions: coupon.conditions
            });
            couponIndex++;
        }

        couponCashbackDiv.innerHTML = couponContent;
        couponSection.style.display = 'block';
    } else {
        couponSection.style.display = 'none';
    }

    // Display parking benefits
    const benefitsSection = document.getElementById('card-benefits-section');
    const benefitsContent = document.getElementById('card-benefits-content');

    if (cardsData.benefits && cardsData.benefits.length > 0) {
        // Find benefits for this card
        const cardBenefits = cardsData.benefits.filter(b => b.id === card.id && b.active);

        if (cardBenefits.length > 0) {
            let benefitsHtml = '';

            cardBenefits.forEach(benefit => {
                benefitsHtml += `<div class="cashback-detail-item">`;
                benefitsHtml += `<div class="cashback-rate" style="color: #2563eb; margin-bottom: 8px;">${benefit.benefit_desc}</div>`;

                if (benefit.merchants && benefit.merchants.length > 0) {
                    benefitsHtml += `<div class="cashback-condition parking-strong-line">地點: ${benefit.merchants.join('、')}</div>`;
                }

                if (benefit.conditions) {
                    benefitsHtml += `<div class="cashback-condition parking-strong-line">條件: ${benefit.conditions}</div>`;
                }

                if (benefit.benefit_period) {
                    benefitsHtml += `<div class="cashback-condition">期限: ${benefit.benefit_period}</div>`;
                }

                if (benefit.notes) {
                    benefitsHtml += `<div class="cashback-condition">備註: ${benefit.notes}</div>`;
                }

                benefitsHtml += `</div>`;
            });

            benefitsContent.innerHTML = benefitsHtml;
            benefitsSection.style.display = 'block';
        } else {
            benefitsSection.style.display = 'none';
        }
    } else {
        benefitsSection.style.display = 'none';
    }

    // Display new cardholder promos for this card (hidden if user owns the card)
    renderCardDetailPromos(card);

    // 近期異動（權益變化 log）
    renderCardDetailChangelog(card);

    // Load and setup user notes
    currentNotesCardId = card.id;
    const notesTextarea = document.getElementById('user-notes-input');
    const saveIndicator = document.getElementById('save-indicator');
    
    // 讀取當前筆記
    loadUserNotes(card.id).then(notes => {
        notesTextarea.value = notes;
    });
    
    // 設置輸入監聽
    notesTextarea.oninput = (e) => {
        const notes = e.target.value;
        
        // 自動本地備份
        autoBackupNotes(card.id, notes);
        
        // 更新按鈕狀態
        updateSaveButtonState(card.id, notes);
    };
    
    // 設置儲存按鈕監聽
    const saveBtn = document.getElementById('save-notes-btn');
    saveBtn.onclick = () => {
        const currentNotes = notesTextarea.value;
        saveUserNotes(card.id, currentNotes);
    };

    // 設置免年費狀態功能
    setupFeeWaiverStatus(card.id);

    // 設置我的額度輸入
    setupCreditLimit(card.id);

    // 設置結帳日期功能
    setupBillingDates(card.id);

    // Show modal
    // 級別切換等重繪路徑會在 modal 已開啟時重呼叫 showCardDetail()；
    // 已開啟就不再 disableBodyScroll()，否則鎖深度多加、closeModal 只解一次，頁面會鎖死
    const wasAlreadyOpen = modal.style.display === 'flex';
    modal.style.display = 'flex';
    if (!wasAlreadyOpen) disableBodyScroll();

    // 滾動到最上面（不記憶上一個 modal 的捲動位置）
    // .modal-content 才是真正的捲動容器（overflow-y: auto; max-height: 80vh）
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

    // Reveal 展開 toggles only on conditions that actually overflow — must run
    // now that the modal is displayed (measurements need layout).
    initConditionClamps(document.getElementById('card-basic-cashback'));
    initConditionClamps(document.getElementById('card-special-cashback'));
    initConditionClamps(document.getElementById('card-upcoming-cashback'));
    initConditionClamps(document.getElementById('card-coupon-cashback'));

    // Wire the sticky section nav after sections are rendered.
    setupCardDetailNav(modalContent);

    // Setup close events
    const closeBtn = document.getElementById('close-card-detail');
    const closeModal = () => {
        modal.style.display = 'none';
        enableBodyScroll();
        currentNotesCardId = null;
        // Embed 模式：兩條關閉路徑（關閉鈕／點遮罩）都會走到這裡，統一在這裡告知父頁
        // （promos.js）modal 已關閉，讓外層 overlay 跟著收起——iframe 常駐不銷毀，
        // 這裡只是隱藏 modal 內容，下次換卡不用重新載入。
        if (isEmbedMode) {
            try {
                parent.postMessage({ type: 'pmc-detail-closed' }, location.origin);
            } catch (e) {
                console.error('❌ pmc-detail-closed postMessage 失敗:', e);
            }
        }
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

// Generate CUBE special content based on selected level
async function generateCubeSpecialContent(card) {
    // Get level from Firestore or default to first level
    const defaultLevel = Object.keys(card.levelSettings)[0];
    const { level: savedLevel, data: levelSettings } = await resolveCardLevel(card, defaultLevel);

    // 使用 specialRate（如果有）或 rate
    const specialRate = levelSettings.specialRate || levelSettings.rate;

    // Separate active and upcoming cashbackRates
    const upcomingRates = [];
    if (card.cashbackRates) {
        card.cashbackRates.forEach(rate => {
            const status = getRateStatus(rate.periodStart, rate.periodEnd);
            if (status === 'upcoming' && isUpcomingWithinDays(rate.periodStart, 30)) {
                upcomingRates.push(rate);
            }
        });
    }

    // Store upcoming rates for display in separate section
    if (upcomingRates.length > 0) {
        const upcomingGroups = upcomingRates.map(rate => {
            const designatedRate = rate.rate === '{specialRate}' ? specialRate : rate.rate;
            return {
                // stacking 模型（如 rate+basic）顯示加總後的率，與搜尋結果同一個數字
                parsedRate: getDisplayRate(card, rate, designatedRate, levelSettings),
                parsedCap: null,
                items: rate.items || [],
                conditions: rate.conditions && rate.category ? [{category: rate.category, conditions: rate.conditions}] : [],
                period: rate.period,
                periodStart: rate.periodStart,
                periodEnd: rate.periodEnd,
                status: 'upcoming',
                category: rate.category
            };
        });

        // Merge upcoming activities with same rate, category, and period (CUBE card only)
        const mergedGroups = new Map();
        upcomingGroups.forEach(group => {
            // Create merge key: rate + category + period
            const mergeKey = `${group.parsedRate}-${group.category || 'no-category'}-${group.period || 'no-period'}`;

            if (mergedGroups.has(mergeKey)) {
                // Merge with existing group
                const existing = mergedGroups.get(mergeKey);
                existing.items = [...existing.items, ...group.items];

                // Merge conditions - list all conditions as bullet points
                if (group.conditions.length > 0) {
                    existing.conditions = [...existing.conditions, ...group.conditions];
                }
            } else {
                // First time seeing this rate+category+period combination
                mergedGroups.set(mergeKey, {...group});
            }
        });

        window._currentUpcomingGroupsCube = Array.from(mergedGroups.values());
        window._currentCard = card;
    }

    let content = '';

    // Add CUBE-specific birthday note at the beginning
    let birthdayNoteText;
    let birthdayNoteColor;
    if (!currentUser) {
        birthdayNoteText = '※ 「慶生月」方案：目前一律納入比較；登入並設定生日月份後，只在您的生日月份納入';
        birthdayNoteColor = '#9ca3af';
    } else if (!userBirthdayMonth) {
        birthdayNoteText = '※ 「慶生月」方案：目前一律納入比較；在上方設定生日月份後，只在您的生日月份納入';
        birthdayNoteColor = '#9ca3af';
    } else if (isBirthdayMonth) {
        birthdayNoteText = `🎂 本月是您的生日月份（${userBirthdayMonth}月），「慶生月」方案已自動納入比較！`;
        birthdayNoteColor = '#be185d';
    } else {
        birthdayNoteText = `※ 「慶生月」方案：已設定只在您的生日月份（${userBirthdayMonth}月）納入比較，本月不納入`;
        birthdayNoteColor = '#9ca3af';
    }
    content += `
        <div class="cube-birthday-note" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px;">
            <div style="color: ${birthdayNoteColor}; font-size: 11px; line-height: 1.5; font-style: italic;">
                ${birthdayNoteText}
            </div>
        </div>
    `;

    // 依照回饋率高低順序顯示，變動的玩數位樂饗購趣旅行放在最後

    // 童樂匯方案不再寫死 10%/5% 兩張卡：資料改成 rate+basic（9.7%+0.3%）後寫死的
    // 數字比對永遠對不到、整組消失。現在跟其他活動一起走第 5 段，依加總後的回饋率排序。

    // 3. Level變動的特殊通路 - 從 cashbackRates 中讀取並按類別分組顯示
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        const categories = ['玩數位', '樂饗購', '趣旅行'];
        const categoryRates = new Map();

        // 從 cashbackRates 中收集各類別的項目（只包含進行中的活動）
        card.cashbackRates.forEach(rate => {
            const status = getRateStatus(rate.periodStart, rate.periodEnd);
            const isActive = (status === 'active' || status === 'always');

            if (rate.category && categories.some(cat => rate.category.includes(cat)) && isActive) {
                // 找出是哪個類別
                const matchedCategory = categories.find(cat => rate.category.includes(cat));
                if (!categoryRates.has(matchedCategory)) {
                    categoryRates.set(matchedCategory, {
                        items: [],
                        rate: rate.rate,
                        cap: rate.cap,
                        period: rate.period
                    });
                }
                const categoryData = categoryRates.get(matchedCategory);
                if (rate.items) {
                    categoryData.items.push(...rate.items);
                }
            }
        });

        // 按類別順序顯示
        categories.forEach(category => {
            if (categoryRates.has(category)) {
                const categoryData = categoryRates.get(category);
                const items = [...new Set(categoryData.items)]; // 去重

                if (items.length > 0) {
                    // 解析 rate（支援 {specialRate} placeholder）
                    let displayRate = categoryData.rate;
                    if (categoryData.rate === '{specialRate}') {
                        displayRate = specialRate;
                    } else if (typeof categoryData.rate === 'string' && categoryData.rate.startsWith('{')) {
                        // 其他 placeholder，從 levelSettings 解析
                        const fieldName = categoryData.rate.slice(1, -1);
                        displayRate = levelSettings[fieldName] || categoryData.rate;
                    }

                    content += renderRateCard({
                        rate: displayRate,
                        capText: formatRateCardCap(categoryData.cap),
                        title: category,
                        merchants: { items, id: `cube-${category}-${savedLevel}` },
                        period: categoryData.period
                    });
                }
            }
        });
    }

    // 5. 其他 cashbackRates（如 LINE PAY 2%）- 放在最後，只顯示進行中的
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        const otherRates = card.cashbackRates
            .filter(rate => {
                const status = getRateStatus(rate.periodStart, rate.periodEnd);
                return !rate.hideInDisplay &&
                    (status === 'active' || status === 'always');  // 只顯示進行中的
            })
            .sort((a, b) => {
                // 排序與顯示用同一個數字：getDisplayRate 加總值（stacking 模型＝指定+基本+加碼）。
                // 2026-10-07 前這裡刻意顯示原始 rate，結果 rate+basic 的槽（週四外出用餐
                // 4.7%+0.3%）詳情頁顯示 4.7%、搜尋結果顯示 5%，兩邊對不上。
                const aRate = getDisplayRate(card, a, parseCashbackRateSync(a.rate, levelSettings), levelSettings);
                const bRate = getDisplayRate(card, b, parseCashbackRateSync(b.rate, levelSettings), levelSettings);
                return bRate - aRate;
            });

        // Merge active rates with same parsedRate, category, and period (CUBE card only)
        const mergedActiveRates = new Map();
        for (const rate of otherRates) {
            const designatedRate = await parseCashbackRate(rate.rate, card, levelSettings);
            const parsedRate = getDisplayRate(card, rate, designatedRate, levelSettings);
            const parsedCap = parseCashbackCap(rate.cap, card, levelSettings);

            // Create merge key: rate + category + period
            const mergeKey = `${parsedRate}-${rate.category || 'no-category'}-${rate.period || 'no-period'}`;

            if (mergedActiveRates.has(mergeKey)) {
                // Merge with existing rate
                const existing = mergedActiveRates.get(mergeKey);
                if (rate.items) {
                    existing.items = [...existing.items, ...rate.items];
                }
                // Merge conditions
                if (rate.conditions) {
                    if (existing.conditions) {
                        existing.conditions += '\n' + rate.conditions;
                    } else {
                        existing.conditions = rate.conditions;
                    }
                }
                // 登錄連結：留先遇到的那一個，不串接（見下方顯示處的說明）
                if (!existing.registerLink && rate.registerLink) {
                    existing.registerLink = rate.registerLink;
                }
            } else {
                // First time seeing this rate+category+period combination
                mergedActiveRates.set(mergeKey, {
                    parsedRate,
                    // stacking 模型的「回饋組成」按鈕（合併後以第一個槽為代表，同 key＝同率同活動）
                    rateBtnHtml: rateCompositionButtonHtml(card, rate, designatedRate, parsedCap, levelSettings),
                    // cap 留空的 stacking 槽顯示加碼層的實際上限（見 resolveDisplayCap）
                    parsedCap: resolveDisplayCap(card, rate, parsedCap, levelSettings),
                    items: rate.items ? [...rate.items] : [],
                    conditions: rate.conditions || '',
                    registerLink: rate.registerLink || '',
                    period: rate.period,
                    periodEnd: rate.periodEnd,
                    category: rate.category
                });
            }
        }

        // Display merged rates
        let index = 0;
        for (const [mergeKey, mergedRate] of mergedActiveRates) {
            // 銀行官方登錄連結：這條路徑會把 rate+category+period 相同的組別合併成
            // 一列，合併後只留第一個有登錄連結的（同一個活動的不同槽位不該有兩個登錄頁；
            // 真的出現時以先遇到的為準，其餘在 Cards Data 裡就該修掉）。
            content += renderRateCard({
                rate: mergedRate.parsedRate,
                rateBtnHtml: mergedRate.rateBtnHtml,
                capText: formatRateCardCap(mergedRate.parsedCap),
                title: mergedRate.category,
                endingSoonEnd: mergedRate.periodEnd,
                merchants: { items: mergedRate.items || [], id: `cube-other-${index}` },
                period: mergedRate.period,
                conditions: mergedRate.conditions,
                registerLink: mergedRate.registerLink
            });
            index++;
        }
    }

    return content;
}

// Update CUBE special cashback when level changes
async function updateCubeSpecialCashback(card) {
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    const newContent = await generateCubeSpecialContent(card);
    specialCashbackDiv.innerHTML = newContent;
    // Re-evaluate condition clamps for the freshly rendered content
    initConditionClamps(specialCashbackDiv);
}

// 詳情頁回饋卡（.cashback-detail-item.rate-card，2026-10-05）：排版比照搜尋結果卡片
// createCardResultElement（js/results-display.js），只少「回饋金額」一欄——用戶在搜尋結果
// 與詳情頁讀到的是同一套結構，不必每次重新找「上限在哪、條件在哪」。對應關係：
//   搜尋結果                         詳情頁
//   卡名 ＋ 右上徽章                 活動類別（category）＋ 右上「即將開始」徽章
//   回饋率｜回饋金額｜回饋消費上限   回饋率｜回饋消費上限
//   ✔ 單筆滿 NT$X                   同
//   匹配項目 / 活動期間 / 條件 / 登錄連結   適用通路 / 活動期間 / 條件 / 登錄連結（順序相同）
// 兩邊共同的片段（徽章、門檻句、資訊區行序）在 results-display.js 的「回饋卡共用片段」，
// 這裡只組詳情頁特有的部分（標題列、兩欄、可展開的通路清單）。
// ⚠️ 詳情頁所有回饋卡（基本、指定通路、即將開始、領券、CUBE 專屬）都走這一支；
//    要加欄位改這裡，不要在個別呼叫端拼 HTML——拼回去就又是七種長相。
//    改完跑 node tools/regression/card-detail-test.js。
//
// 參數：rate（數字或字串，不含 %）、ratePrefix（加碼用 '+'）、rateNote（回饋率下方小字）、
// rateBtnHtml（回饋組成按鈕）、capText（已格式化，如 'NT$7,500'／'無上限'）、
// title（category 原文，內部轉顯示名稱並 escape）、titleIsDisplay（title 已是顯示名稱）、
// upcomingStart（即將開始的 periodStart）、endingSoonEnd（進行中活動的 periodEnd）、
// minSpend、merchants（{ items, id, initialCount }：id 用來產生展開鈕的 DOM id，
// initialCount＝收合時顯示幾個，預設 5）、merchantsLabel、period、
// conditions（字串或字串陣列）、registerLink、extraClass
function renderRateCard(o) {
    const title = o.title ? (o.titleIsDisplay ? o.title : getCategoryDisplayName(o.title)) : '';
    const upcomingBadge = renderUpcomingBadge(o.upcomingStart);

    let html = `<div class="cashback-detail-item rate-card${o.extraClass ? ' ' + o.extraClass : ''}">`;

    // 標題列一律輸出（沒有標題也沒有徽章時是空的 div）：桌機兩欄時，同一排只要有一張卡
    // 有標題，另一張就留同高的空白，讓下面的回饋率對齊（CSS subgrid，見 styles.css
    // 「同排對齊」）。單欄（手機）時空的標題列不佔位，跟以前一樣。
    // 標題列以外的內容全部包在 .rate-card-body——subgrid 只分「標題列｜其餘」兩列。
    html += `<div class="rate-card-header">` +
        (title || upcomingBadge
            ? `<div class="rate-card-title">${escapeHtml(title)}</div>` +
              (upcomingBadge ? `<div class="badges-container">${upcomingBadge}</div>` : '')
            : '') +
        `</div>`;

    html += `<div class="rate-card-body">`;
    html += `<div class="card-details rate-card-details">` +
        `<div class="detail-item"><div class="detail-label">回饋率</div>` +
        `<div class="detail-value rate-card-rate">${o.ratePrefix || ''}${escapeHtml(String(o.rate))}%${o.rateBtnHtml || ''}</div>` +
        (o.rateNote ? `<div class="cashback-type-label">${escapeHtml(o.rateNote)}</div>` : '') +
        `</div>` +
        `<div class="detail-item"><div class="detail-label">回饋消費上限</div>` +
        `<div class="detail-value">${escapeHtml(o.capText || '無上限')}</div></div>` +
        `</div>`;

    html += renderSpendThresholdNote(o.minSpend);

    // 適用通路：超過 initialCount 個先收合，展開鈕沿用 toggleMerchants（textContent 換字），
    // 詳情頁「搜尋通路」會自動點開它（syncMerchantListsForSearch）
    let matchHtml = '';
    const items = o.merchants && o.merchants.items ? [...new Set(o.merchants.items)] : [];
    if (items.length > 0) {
        const label = o.merchantsLabel || '適用通路';
        const fullList = items.join('、');
        const limit = o.merchants.initialCount || 5;
        if (items.length <= limit) {
            matchHtml = `${label}: <strong>${escapeHtml(fullList)}</strong>`;
        } else {
            const initialList = items.slice(0, limit).join('、');
            const merchantsId = `${o.merchants.id}-merchants`;
            const showAllId = `${o.merchants.id}-show-all`;
            matchHtml = `${label}: <strong id="${merchantsId}">${escapeHtml(initialList)}</strong>` +
                `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeHtml(escapeForOnclick(initialList))}', '${escapeHtml(escapeForOnclick(fullList))}')">… 顯示全部${items.length}個</button>`;
        }
    }

    html += renderActivityInfo({
        matchHtml,
        period: o.period,
        endingSoonBadge: renderEndingSoonBadge(o.endingSoonEnd),
        conditions: o.conditions,
        collapsibleConditions: true,
        registerLink: o.registerLink,
        extraClass: 'rate-card-info'
    });
    html += `</div></div>`; // .rate-card-body、.rate-card
    return html;
}

// 「NT$7,500」／「無上限」：詳情頁回饋卡的上限欄（cap 是 null/0/'' 都算無上限）
function formatRateCardCap(cap) {
    return cap ? `NT$${Math.floor(cap).toLocaleString()}` : '無上限';
}

// Escape a string for embedding as a single-quoted JS literal inside an HTML onclick attribute.
// Apostrophes (e.g. "Tomod's") would otherwise close the single-quoted string early.
// 級別說明「i」按鈕：點一下開浮動窗（各級別回饋率 ＋ 該級別的達成條件備註）。
// 每次 showCardDetail() 重繪級別區都會重新掛一次——內容是 innerHTML 重生的，
// 舊節點連同監聽器一起被丟掉，不會累積。
//
// ⚠️ 用原生 Popover API 把窗體送進 top layer：詳情頁是 z-index 1100 的 modal，
//    捲動容器 .modal-content 有 overflow-y:auto，一般絕對定位浮層會被裁掉。
//    不支援 popover 的舊瀏覽器退回 .is-open class（CSS 那邊有對應規則），
//    行為一樣，只是少了原生的 light-dismiss，所以下面自己補了「點外面關閉」。
function setupLevelHelpPopover() {
    const btn = document.getElementById('level-help-btn');
    const popup = document.getElementById('level-help-popup');
    if (!btn || !popup) return;

    const supported = typeof HTMLElement.prototype.showPopover === 'function';
    const isOpen = () => supported ? popup.matches(':popover-open') : popup.classList.contains('is-open');

    // 位置跟著按鈕走（top layer 不受父層 transform/overflow 影響，用 fixed 座標即可）
    const position = () => {
        const rect = btn.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.top = `${rect.bottom + 6}px`;
        popup.style.left = `${rect.left}px`;
        const pr = popup.getBoundingClientRect();
        const overflowRight = pr.right - window.innerWidth + 8;
        if (overflowRight > 0) popup.style.left = `${Math.max(8, rect.left - overflowRight)}px`;
        // 下方放不下就翻到按鈕上面（手機把說明開在畫面底部時最常遇到）
        if (pr.bottom > window.innerHeight - 8 && rect.top > pr.height + 12) {
            popup.style.top = `${rect.top - pr.height - 6}px`;
        }
    };

    const open = () => {
        if (supported) {
            try { popup.showPopover(); } catch (e) { /* 已開啟等狀況直接忽略 */ }
        } else {
            popup.classList.add('is-open');
        }
        position();
        btn.setAttribute('aria-expanded', 'true');
    };
    const close = () => {
        if (supported) {
            try { popup.hidePopover(); } catch (e) { /* ignore */ }
        } else {
            popup.classList.remove('is-open');
        }
        btn.setAttribute('aria-expanded', 'false');
    };

    btn.onclick = (e) => {
        e.stopPropagation();
        isOpen() ? close() : open();
    };
    popup.addEventListener('toggle', (e) => {
        if (e.newState === 'open') position();
        else btn.setAttribute('aria-expanded', 'false');
    });
    if (!supported) {
        document.addEventListener('click', (e) => {
            if (isOpen() && !popup.contains(e.target) && e.target !== btn) close();
        });
    }
}

// 近期異動：每列「日期 ＋ 一句話」，最多 5 筆（筆數與新→舊排序
// 由 Apps Script 匯出時決定，前端照收不再排序，見 apps-script/cards-export.gs 的
// readChangelog）。資料只在有異動的卡上出現。
//
// ⚠️ 空陣列不是 falsy（鐵則 4）：`!card.changelog` 擋不掉 `[]`，長度也要判，
//    否則會渲染出一個只有標題、下面空空的區塊。
// ⚠️ summary 是站長在 Google Sheets 自由輸入的文字（鐵則 3）。這裡刻意不走 innerHTML，
//    改用 createElement + textContent——瀏覽器不會把內容當標記解析，比事後 escapeHtml
//    少一個「哪天有人改成字串拼接就破功」的失誤面。
function renderCardDetailChangelog(card) {
    const section = document.getElementById('card-changelog-section');
    const list = document.getElementById('card-changelog-content');
    if (!section || !list) return;

    list.textContent = '';

    const entries = (card && card.changelog) || [];
    if (entries.length === 0) {
        section.style.display = 'none';
        return;
    }

    entries.forEach(entry => {
        if (!entry) return;
        const summary = String(entry.summary || '').trim();
        if (!summary) return;   // 沒有句子就沒有這一列可看，不留空 bullet

        const li = document.createElement('li');
        li.className = 'card-changelog-item';

        const dateEl = document.createElement('span');
        dateEl.className = 'card-changelog-date';
        dateEl.textContent = formatChangelogDate(entry.date);

        const textEl = document.createElement('span');
        textEl.className = 'card-changelog-text';
        textEl.textContent = summary;

        li.appendChild(dateEl);
        li.appendChild(textEl);
        list.appendChild(li);
    });

    // 每一筆的 summary 都是空的（理論上匯出端已擋掉）→ 整塊仍然不顯示
    section.style.display = list.children.length ? 'block' : 'none';
}

// ISO "2026-07-31" → "2026/07/31"（站內日期慣例是斜線）。
// 認不得的格式原樣顯示，不猜、也不吐 Invalid Date——資料來自試算表，什麼都可能填。
function formatChangelogDate(value) {
    const raw = String(value || '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : raw;
}

function escapeForOnclick(s) {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 切換通路顯示展開/收起
function toggleMerchants(merchantsId, buttonId, shortList, fullList) {
    const merchantsElement = document.getElementById(merchantsId);
    const buttonElement = document.getElementById(buttonId);

    if (!merchantsElement || !buttonElement) return;

    const isExpanded = buttonElement.textContent.includes('收起');

    if (isExpanded) {
        // 收起：還原展開前的原始標籤。原本用 fullList.split('、').length 重算數量，
        // 但通路名本身可能含「、」（如「新光三越(桃園、林口、台中港、台南)」），
        // 會把 40 個算成 43 個；改用展開時記下的原始文字，數量才不會跑掉。
        // 存成 JS 屬性而非 data-* 屬性，避免動到 DOM 標記。
        merchantsElement.textContent = shortList;
        buttonElement.textContent = buttonElement._collapsedLabel
            || `... 顯示全部${fullList.split('、').length}個`;
    } else {
        // 展開
        if (!buttonElement._collapsedLabel) buttonElement._collapsedLabel = buttonElement.textContent;
        merchantsElement.textContent = fullList;
        buttonElement.textContent = '收起';
    }
}

// 還原上一次搜尋的 highlight：把 <mark> 換回純文字，再 normalize 合併相鄰文字節點
// （不合併的話，同一個詞被拆成多個節點，下次搜尋較長的詞會比對不到）
function clearCashbackHighlights(container) {
    const marks = container.querySelectorAll('mark.cashback-search-hl');
    if (marks.length === 0) return;
    marks.forEach(mark => {
        mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark);
    });
    container.normalize();
}

// 將 term 在文字節點上標記出來。全程用 DOM API（createTextNode/createElement），
// 不碰 innerHTML —— 天然免疫 XSS，也不會破壞既有標籤與屬性（鐵則 3）
function highlightCashbackTerm(root, term) {
    if (!term) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            return node.nodeValue.toLowerCase().includes(term)
                ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });

    // 先收集再改動：邊走邊改 DOM 會讓 TreeWalker 的游標失準
    const targets = [];
    let node;
    while ((node = walker.nextNode())) targets.push(node);

    targets.forEach(textNode => {
        const text = textNode.nodeValue;
        const lower = text.toLowerCase();
        const frag = document.createDocumentFragment();
        let from = 0;
        let idx = lower.indexOf(term);
        while (idx !== -1) {
            if (idx > from) frag.appendChild(document.createTextNode(text.slice(from, idx)));
            const mark = document.createElement('mark');
            mark.className = 'cashback-search-hl';
            mark.textContent = text.slice(idx, idx + term.length); // 保留原始大小寫
            frag.appendChild(mark);
            from = idx + term.length;
            idx = lower.indexOf(term, from);
        }
        if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
        textNode.parentNode.replaceChild(frag, textNode);
    });
}

// 搜尋時自動展開被截斷的「適用通路」清單：清單收合時 DOM 內只有前 5 個通路
// （其餘只存在於 show-more-btn 的 onclick 參數裡），搜尋第 6 個之後的通路不但
// 標不到，整張活動卡還會被判定為不符而整個隱藏。這裡代按「顯示全部」讓命中處
// 看得見，並記住是程式展開的，清空搜尋時再收回（使用者自己展開的不動）。
function syncMerchantListsForSearch(container, hasTerm) {
    container.querySelectorAll('.show-more-btn').forEach(btn => {
        const collapsed = btn.textContent.includes('顯示全部');
        if (hasTerm) {
            if (collapsed) {
                btn._autoExpanded = true; // JS 屬性，不留 data-* 在 DOM 上
                btn.click(); // 沿用既有 toggleMerchants（完整清單在其 onclick 參數中）
            }
        } else if (btn._autoExpanded) {
            if (!collapsed) btn.click();
            btn._autoExpanded = false;
        }
    });
}

// 即時過濾「指定通路回饋」中的活動卡片，並把命中的字詞即時 highlight
// （不然使用者看不出是配對到哪個通路／條件）
// 只在已渲染的 DOM 上做過濾（不重新計算或 fetch），效能 < 5ms
function filterCashbackItems(searchTerm) {
    const term = (searchTerm || '').toLowerCase().trim();
    const container = document.getElementById('card-special-cashback');
    const emptyMsg = document.getElementById('cashback-search-empty');
    if (!container) return;

    // 必須先還原，textContent 才是乾淨原文（也讓每次輸入都從無標記狀態重算）
    clearCashbackHighlights(container);
    // 再展開被截斷的通路清單，比對與標記才看得到完整內容
    syncMerchantListsForSearch(container, !!term);

    const items = container.querySelectorAll('.cashback-detail-item');
    let visibleCount = 0;

    items.forEach(item => {
        if (!term) {
            item.style.display = '';
            visibleCount++;
            return;
        }
        // 比對整個卡片的 textContent，包含通路名稱、category 標籤、條件等
        const text = item.textContent.toLowerCase();
        if (text.includes(term)) {
            item.style.display = '';
            visibleCount++;
            highlightCashbackTerm(item, term); // 只標記顯示中的項目
        } else {
            item.style.display = 'none';
        }
    });

    if (emptyMsg) {
        emptyMsg.style.display = (term && visibleCount === 0) ? 'block' : 'none';
    }
}

// 將 toggleMerchants 暴露到全局作用域，確保 renderRateCard 產生的 onclick 可以訪問
// （toggleConditions 已於 2026-10-06 移除：唯一呼叫端「玉山 Uni Card 即將開始的條件收合鈕」
//   在詳情頁回饋卡統一版面時改由條件列自己的「...展開」處理）
window.toggleMerchants = toggleMerchants;

// 用戶筆記相關功能
let currentNotesCardId = null;
let lastSavedNotes = new Map(); // 記錄每張卡最後儲存的內容

// 讀取用戶筆記 (註: 筆記僅依賴cardId，與cardsInComparison狀態無關)
async function loadUserNotes(cardId) {
    const cacheKey = (auth && auth.currentUser) ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;

    if (!auth || !auth.currentUser) {
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
    
    try {
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.getDoc) throw new Error('Firestore not available');
        const docSnap = await window.getDoc(docRef);
        const notes = docSnap.exists() ? docSnap.data().notes : '';
        
        // 更新本地快取和記錄
        localStorage.setItem(cacheKey, notes);
        lastSavedNotes.set(cardId, notes);
        
        return notes;
    } catch (error) {
        console.log('讀取筆記失敗，使用本地快取:', error);
        const localNotes = localStorage.getItem(cacheKey) || '';
        lastSavedNotes.set(cardId, localNotes);
        return localNotes;
    }
}

// 本地儲存（自動備份）
function autoBackupNotes(cardId, notes) {
    const cacheKey = (auth && auth.currentUser) ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    localStorage.setItem(cacheKey, notes);
}

// 手動儲存筆記
async function saveUserNotes(cardId, notes) {
    const saveBtn = document.getElementById('save-notes-btn');
    const saveIndicator = document.getElementById('save-indicator');
    const btnText = document.querySelector('.btn-text');
    const btnIcon = document.querySelector('.btn-icon');
    
    if (!auth || !auth.currentUser) {
        // 未登入時僅儲存在本地
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // 更新按鈕狀態
        saveBtn.disabled = true;
        saveIndicator.textContent = '已儲存在本地 (未登入)';
        saveIndicator.style.color = '#6b7280';
        return true;
    }
    
    try {
        // 更新按鈕為儲存中狀態
        saveBtn.className = 'save-notes-btn saving';
        saveBtn.disabled = true;
        if (btnIcon) btnIcon.textContent = '⏳';
        if (btnText) btnText.textContent = '儲存中...';
        saveIndicator.textContent = '';
        
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            notes: notes,
            updatedAt: new Date(),
            cardId: cardId
        });
        
        // 也儲存在本地作為快取
        autoBackupNotes(cardId, notes);
        lastSavedNotes.set(cardId, notes);
        
        // 成功狀態
        saveBtn.className = 'save-notes-btn success';
        if (btnIcon) btnIcon.textContent = '✓';
        if (btnText) btnText.textContent = '已儲存';
        saveIndicator.textContent = '✓ 雲端同步成功';
        saveIndicator.style.color = '#10b981';

        // 2秒後恢復正常狀態
        setTimeout(() => {
            saveBtn.className = 'save-notes-btn';
            saveBtn.disabled = true; // 沒有變更時保持禁用
            if (btnIcon) btnIcon.textContent = '💾';
            if (btnText) btnText.textContent = '儲存筆記';
            saveIndicator.textContent = '';
        }, 2000);
        
        return true;
        
    } catch (error) {
        console.error('雲端儲存失敗:', error);
        
        // 失敗時仍然儲存在本地
        autoBackupNotes(cardId, notes);
        
        // 錯誤狀態
        saveBtn.className = 'save-notes-btn';
        saveBtn.disabled = false; // 可以再次嘗試
        if (btnIcon) btnIcon.textContent = '⚠️';
        if (btnText) btnText.textContent = '重試儲存';
        saveIndicator.textContent = '雲端儲存失敗，已本地儲存';
        saveIndicator.style.color = '#dc2626';

        // 5秒後恢復
        setTimeout(() => {
            if (btnIcon) btnIcon.textContent = '💾';
            if (btnText) btnText.textContent = '儲存筆記';
            saveIndicator.textContent = '';
        }, 5000);
        
        return false;
    }
}

