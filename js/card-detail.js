/* ============================================================
 * Pick My Card — js/card-detail.js（載入順序 9/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 卡片詳情頁主體            → "showCardDetail"
 *  - CUBE 卡專屬內容            → "generateCubeSpecialContent" / "updateCubeSpecialCashback"
 *  - onclick 轉義               → "escapeForOnclick"
 *  - 商家/條件展開收合（含 window 賦值）→ "toggleMerchants" / "toggleConditions"
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
            card_name: card.name
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
let basicContent = `<div class="cashback-detail-item">`;
basicContent += `<div class="cashback-rate">國內: <span class="cashback-rate-num">${card.basicCashback}%</span></div>`;
if (card.basicConditions) {
    basicContent += `<div class="cashback-condition">條件: ${card.basicConditions}</div>`;
}
basicContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
basicContent += `</div>`; // ← 這裡關閉第一個區塊

if (card.overseasCashback) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外: <span class="cashback-rate-num">${card.overseasCashback}%</span></div>`;
    basicContent += `<div class="cashback-condition">海外消費上限: 無上限</div>`;
    basicContent += `</div>`;
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

if (domesticBonusRate) {
    basicContent += `<div class="cashback-detail-item">`; // ← 新的區塊
    basicContent += `<div class="cashback-rate">國內加碼: <span class="cashback-rate-num">+${domesticBonusRate}%</span></div>`;
    if (domesticConditions) {
        basicContent += `<div class="cashback-condition">條件: ${domesticConditions}</div>`;
    }
    if (domesticBonusCap) {
        basicContent += `<div class="cashback-condition">消費上限: NT$${domesticBonusCap.toLocaleString()}</div>`;
    }
    basicContent += `</div>`; // ← 關閉國內加碼區塊
}

if (overseasBonusRate) {
    basicContent += `<div class="cashback-detail-item">`;
    basicContent += `<div class="cashback-rate">海外加碼: <span class="cashback-rate-num">+${overseasBonusRate}%</span></div>`;
    if (overseasConditions) {
        basicContent += `<div class="cashback-condition">條件: ${overseasConditions}</div>`;
    }
    if (overseasBonusCap) {
        basicContent += `<div class="cashback-condition">消費上限: NT$${overseasBonusCap.toLocaleString()}</div>`;
    }
    basicContent += `</div>`;
}

basicCashbackDiv.innerHTML = basicContent;
    
    // Handle level selection for all cards with levels
    const cubeLevelSection = document.getElementById('cube-level-section');

    if (card.hasLevels) {
        const levelNames = Object.keys(card.levelSettings);
        const defaultLevel = levelNames[0];

        // Generate level selector HTML with note (通用支援)
        const { level: savedLevel, data: savedLevelData } = await resolveCardLevel(card, defaultLevel);

        const levelNoteText = savedLevelData['level-note'] || '';
        const noteFs = card.id === 'cathay-cube' ? '9.5px' : '11px';
        const noteMt = card.id === 'cathay-cube' ? '6px' : '8px';
        const levelNote = levelNoteText
            ? `<div id="level-note" style="font-size: ${noteFs}; color: #9ca3af; margin-top: ${noteMt}; word-wrap: break-word; white-space: normal; line-height: 1.5;">${levelNoteText}</div>`
            : `<div id="level-note" style="font-size: ${noteFs}; color: #9ca3af; margin-top: ${noteMt}; word-wrap: break-word; white-space: normal; line-height: 1.5;"></div>`;

        // Generate level rates info
        let levelRatesInfo = '';
        if (levelNames.length > 1 && card.id === 'cathay-cube') {
            // CUBE 卡用較小字體，配合統一設定區塊
            levelRatesInfo = '<div style="margin-left: 16px; flex-shrink: 0; padding: 5px 9px; border-left: 2px solid #e5e7eb; min-width: 0;">';
            levelRatesInfo += '<div style="font-size: 10.3px; color: #6b7280; font-weight: 600; margin-bottom: 3px;">各級別回饋率：</div>';
            levelNames.forEach(level => {
                const data = card.levelSettings[level];
                const displayRate = data.specialRate || data.rate || 0;
                levelRatesInfo += `<div style="font-size: 9.5px; color: #6b7280; line-height: 1.4; word-wrap: break-word;">• ${level}: ${displayRate}%</div>`;
            });
            levelRatesInfo += `<div style="font-size: 9px; color: #9ca3af; margin-top: 4px; font-style: italic; line-height: 1.3;">由分級決定回饋率的方案包含：玩數位、樂饗購、趣旅行</div>`;
            levelRatesInfo += '</div>';
        } else if (levelNames.length > 1) {
            levelRatesInfo = '<div style="margin-left: 24px; flex-shrink: 0; padding: 8px 12px; border-left: 3px solid #e5e7eb; background-color: #f9fafb; min-width: 0;">';
            levelRatesInfo += '<div style="font-size: 12px; color: #6b7280; font-weight: 600; margin-bottom: 4px;">各級別回饋率：</div>';

            if (card.id === 'dbs-eco') {
                // Simplified format for mobile compatibility
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}%</div>`;
                });
            } else if (card.id === 'sinopac-dawho') {
                // 永豐大戶卡自訂格式
                levelRatesInfo += `
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• 大戶Plus等級:</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">國內外加碼 4% (上限 NT$10,000 / NT$25,000 )</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">悠遊卡自動加值 5% (上限 NT$10,000)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-top: 4px;">• 大戶等級:</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">國內外加碼 2.5% (上限 NT$3,333 / NT$16,000)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-left: 8px;">悠遊卡自動加值 3% (上限 NT$3,333)</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word; margin-top: 4px;">• 大大等級: 只享有一般回饋</div>
                `;
            } else if (card.id === 'sinopac-coin') {
                // 永豐幣倍卡自訂格式
                levelRatesInfo += `
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">精選通路加碼 4%</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• Level 1：上限 NT$7,500</div>
                    <div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• Level 2：上限 NT$20,000</div>
                `;
            } else {
                // Default formatting for other cards (like Uni card)
                levelNames.forEach(level => {
                    const data = card.levelSettings[level];
                    levelRatesInfo += `<div style="font-size: 11px; color: #6b7280; line-height: 1.5; word-wrap: break-word;">• ${level}: ${data.rate}% (上限 NT$${data.cap ? Math.floor(data.cap).toLocaleString() : '無'})</div>`;
                });
            }
            levelRatesInfo += '</div>';
        }

        let levelSelectorHTML;

        if (card.id === 'cathay-cube') {
            // CUBE card: all three settings rows in one unified card
            const monthOptions = !currentUser ? '' :
                '<option value="">-- 未設定 --</option>' +
                Array.from({length: 12}, (_, i) => {
                    const m = i + 1;
                    return `<option value="${m}" ${userBirthdayMonth === m ? 'selected' : ''}>${m}月</option>`;
                }).join('');

            const birthdayRow = currentUser ? `
                <div>
                    <label style="font-weight: 600; flex-shrink: 0; font-size: 14px; color: #374151; margin-bottom: 4px;">我的生日月份：</label>
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                        <select id="birthday-month-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                            ${monthOptions}
                        </select>
                    </div>
                    <div style="font-size: 11px; color: #6b7280;">選取後，在您的生日月份會自動在比較結果納入「慶生月」方案的活動</div>
                </div>
            ` : `
                <div>
                    <span style="font-weight: 600; flex-shrink: 0; font-size: 14px; color: #374151;">我的生日月份：</span>
                    <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">輸入後將可以比較「慶生月」活動，請先登入才能設定生日月份</div>
                </div>
            `;

            levelSelectorHTML = `
                <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; padding: 12px 14px; margin-bottom: 16px;">
                    <div style="display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
                        <div style="flex-shrink: 0;">
                            <label style="font-weight: 600; margin-right: 6px; margin-bottom: 0; font-size: 14px; color: #374151;">選擇級別：</label>
                            <select id="card-level-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                                ${levelNames.map(level =>
                                    `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                                ).join('')}
                            </select>
                        </div>
                        ${levelRatesInfo}
                    </div>
                    ${levelNote}
                    <div style="border-top: 1px solid #e5e7eb; margin-top: 10px; padding-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px;">
                        ${birthdayRow}
                        <div>
                            <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 0; cursor: pointer; user-select: none;">
                                <input type="checkbox" id="children-eligible-checkbox"
                                    ${isChildrenEligible ? 'checked' : ''}
                                    style="width: 14px; height: 14px; cursor: pointer; accent-color: #3b82f6;">
                                <span style="font-weight: 600; font-size: 14px; color: #374151;">我符合「童樂匯」權益</span>
                            </label>
                            <div style="margin-top: 4px; padding-left: 20px; font-size: 11px; color: #9ca3af;">
                                勾選後才會在比較結果納入「童樂匯」方案的活動
                            </div>
                        </div>
                        <div>
                            <label for="cube-issuer-select" style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 14px; color: #374151;">發卡組織：</label>
                            <select id="cube-issuer-select" style="padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;">
                                ${['Visa', 'Mastercard', 'JCB'].map(issuer =>
                                    `<option value="${issuer}" ${issuer === cubeIssuer ? 'selected' : ''}>${issuer}</option>`
                                ).join('')}
                            </select>
                            <div style="margin-top: 4px; font-size: 11px; color: #9ca3af;">
                                選擇 JCB 才會在比較結果納入「JCB日本賞」方案的活動
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            levelSelectorHTML = `
                <div class="level-selector" style="margin-bottom: 16px;">
                    <div style="display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 8px;">
                        <div style="flex-shrink: 0;">
                            <label style="font-weight: 600; margin-right: 8px;">選擇級別：</label>
                            <select id="card-level-select" style="padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                                ${levelNames.map(level =>
                                    `<option value="${level}" ${level === savedLevel ? 'selected' : ''}>${level}</option>`
                                ).join('')}
                            </select>
                        </div>
                        ${levelRatesInfo}
                    </div>
                    ${levelNote}
                </div>
            `;
        }

        cubeLevelSection.innerHTML = levelSelectorHTML;
        cubeLevelSection.style.display = 'block';

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
        specialContent += `<div class="cashback-detail-item">`;
        specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${levelData.rate}%</span> 回饋</div>`;
        if (levelData.cap) {
            specialContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(levelData.cap).toLocaleString()}</div>`;
        } else {
            specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
        }

        if (levelData.condition) {
            specialContent += renderConditionLine(levelData.condition);
        }

        // Show applicable merchants
        if (card.specialItems.length <= 30) {
            const merchantsList = card.specialItems.join('、');
            specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
        } else {
            const initialList = card.specialItems.slice(0, 30).join('、');
            const fullList = card.specialItems.join('、');
            const merchantsId = `uni-merchants-${card.id}`;
            const showAllId = `uni-show-all-${card.id}`;

            specialContent += `<div class="cashback-merchants">`;
            specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
            specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">... 顯示全部${card.specialItems.length}個</button>`;
            specialContent += `</div>`;
        }

        specialContent += `</div>`;
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
            specialContent += `<div class="cashback-detail-item">`;
            specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${levelData.rate}%</span> 回饋 (${savedLevel})</div>`;
            if (levelData.cap) {
                specialContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(levelData.cap).toLocaleString()}</div>`;
            } else {
                specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here

            specialContent += `</div>`;
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
                    parsedCap,
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
            specialContent += `<div class="cashback-detail-item">`;

            // 解析 rate 值（支援 {specialRate} 和 {rate}，雖然 hasLevels=false 的卡片通常只有數字）
            const parsedRate = await parseCashbackRate(rate.rate, card, null);
            // For stacking models, show the summed rate (designated+basic+bonus),
            // same number the search-result card shows; otherwise show as-is.
            const displayRate = getDisplayRate(card, rate, parsedRate, null);

            // 解析 cap 值（支援 {cap}，hasLevels=false 的卡片通常只有數字）
            const parsedCap = parseCashbackCap(rate.cap, card, null);

            // Display rate with category in parentheses (with black color for consistency)
            const categoryStyle = rate.category ? getCategoryStyle(rate.category) : '';
            const categoryLabel = rate.category ? ` <span style="${categoryStyle}">${getCategoryDisplayName(rate.category)}</span>` : '';

            // Add ending soon badge if applicable
            let endingSoonBadge = '';
            if (rate.periodEnd && isEndingSoon(rate.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(rate.periodEnd);
                const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                endingSoonBadge = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            // stacking 模型加上「回饋組成」按鈕，解釋加總的來源
            const compBtn = rateCompositionButtonHtml(card, rate, parsedRate, parsedCap, null);
            specialContent += `<div class="cashback-rate"><span class="cashback-rate-num">${displayRate}%</span> 回饋${categoryLabel}${compBtn}${endingSoonBadge}</div>`;
            // 滿額門檻是重要條件：黑色、置於消費上限上方；maxSpend（未滿門檻）
            // 只影響匹配、不顯示標註（2026-07-17 用戶定案）
            if (rate.minSpend) {
                specialContent += `<div class="cashback-condition spend-threshold">單筆滿 NT$${Math.floor(rate.minSpend).toLocaleString()} 起</div>`;
            }

            if (parsedCap) {
                if (rate.capDescription && card.id === 'taishin-richart') {
                    specialContent += `<div class="cashback-condition">消費上限: ${rate.capDescription}</div>`;
                } else {
                    specialContent += `<div class="cashback-condition">消費上限: NT$${parsedCap.toLocaleString()}</div>`;
                }
            } else {
                specialContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            if (rate.conditions) {
                specialContent += renderConditionLine(rate.conditions);
            }

            if (rate.period) {
                specialContent += `<div class="cashback-condition">活動期間: ${rate.period}</div>`;
            }
            
            if (rate.items && rate.items.length > 0) {
                const merchantsId = `merchants-${card.id}-${index}`;
                const showAllId = `show-all-${card.id}-${index}`;
                
                // Special handling for Yushan Uni card exclusions
                let processedItems = [...rate.items];
                if (card.id === 'yushan-unicard') {
                    processedItems = rate.items.map(item => {
                        if (item === '街口' || item === '全支付') {
                            return item + '(排除超商)';
                        }
                        return item;
                    });
                }
                
                if (rate.items.length <= 5) {
                    // 少於20個直接顯示全部
                    const merchantsList = processedItems.join('、');
                    specialContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    // 超過20個顯示可展開的列表
                    const initialList = processedItems.slice(0, 5).join('、');
                    const fullList = processedItems.join('、');
                    
                    specialContent += `<div class="cashback-merchants">`;
                    specialContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    specialContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${rate.items.length}個</button>`;
                    specialContent += `</div>`;
                }
            }

            specialContent += `</div>`;
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
            upcomingContent += `<div class="cashback-detail-item upcoming-activity">`;

            // 顯示回饋率和即將開始標籤（包含 category 如果有的話）
            const daysUntil = getDaysUntilStart(group.periodStart);
            const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
            const categoryStyle = group.category ? getCategoryStyle(group.category) : '';
            const categoryText = group.category ? ` <span style="${categoryStyle}">${getCategoryDisplayName(group.category)}</span>` : '';
            upcomingContent += `<div class="cashback-rate"><span class="cashback-rate-num">${group.parsedRate}%</span> 回饋${categoryText} <span class="upcoming-badge">即將開始 (${daysText})</span></div>`;

            if (group.parsedCap) {
                upcomingContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(group.parsedCap).toLocaleString()}</div>`;
            } else {
                upcomingContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            if (group.period) {
                upcomingContent += `<div class="cashback-condition">活動期間: ${group.period}</div>`;
            }

            // 顯示所有通路
            if (group.items.length > 0) {
                const uniqueItems = [...new Set(group.items)];
                const merchantsId = `upcoming-merchants-${upcomingCard.id}-group-${groupKey}`;
                const showAllId = `upcoming-show-all-${upcomingCard.id}-group-${groupKey}`;

                if (uniqueItems.length <= 5) {
                    const merchantsList = uniqueItems.join('、');
                    upcomingContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = uniqueItems.slice(0, 5).join('、');
                    const fullList = uniqueItems.join('、');

                    upcomingContent += `<div class="cashback-merchants">`;
                    upcomingContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    upcomingContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${uniqueItems.length}個</button>`;
                    upcomingContent += `</div>`;
                }
            }

            // 按 category 顯示各通路條件
            if (group.conditions.length > 0) {
                if (upcomingCard.id === 'yushan-unicard') {
                    const conditionsId = `upcoming-conditions-${upcomingCard.id}-group-${groupKey}`;
                    const showConditionsId = `upcoming-show-conditions-${upcomingCard.id}-group-${groupKey}`;

                    let conditionsContent = '';
                    for (const cond of group.conditions) {
                        conditionsContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${cond.conditions}</div>`;
                    }

                    upcomingContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                    upcomingContent += `<button class="show-more-btn" id="${showConditionsId}" onclick="toggleConditions('${conditionsId}', '${showConditionsId}')" style="padding: 4px 12px; font-size: 13px;">▼ 查看各通路詳細條件</button>`;
                    upcomingContent += `<div id="${conditionsId}" style="display: none; margin-top: 8px;">`;
                    upcomingContent += conditionsContent;
                    upcomingContent += `</div>`;
                    upcomingContent += `</div>`;
                } else {
                    upcomingContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                    upcomingContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 條件：</div>`;

                    for (const cond of group.conditions) {
                        upcomingContent += `<div style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;">• ${cond.conditions}</div>`;
                    }

                    upcomingContent += `</div>`;
                }
            }

            upcomingContent += `</div>`;
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

            couponContent += `<div class="cashback-detail-item">`;

            // 顯示回饋率和標籤
            let badges = '';

            // 即將開始標籤
            if (couponStatus === 'upcoming' && coupon.periodStart) {
                const daysUntil = getDaysUntilStart(coupon.periodStart);
                const daysText = daysUntil === 0 ? '今天開始' : `${daysUntil}天後`;
                badges += ` <span class="upcoming-badge">即將開始 (${daysText})</span>`;
            }

            // 即將結束標籤
            if ((couponStatus === 'active' || couponStatus === 'always') && coupon.periodEnd && isEndingSoon(coupon.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(coupon.periodEnd);
                const daysText = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : `${daysUntil}天後`;
                badges += ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            couponContent += `<div class="cashback-rate"><span class="cashback-rate-num">${actualRate}%</span> 回饋${badges}</div>`;

            // 消費上限（如果有）
            if (coupon.cap) {
                couponContent += `<div class="cashback-condition">消費上限: NT$${Math.floor(coupon.cap).toLocaleString()}</div>`;
            } else {
                couponContent += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // 活動期間
            if (coupon.period) {
                couponContent += `<div class="cashback-condition">活動期間: ${coupon.period}</div>`;
            }

            // 適用通路（超過 5 個時收起顯示）
            if (coupon.merchant) {
                const merchantItems = coupon.merchant.split(',').map(m => m.trim()).filter(m => m);
                if (merchantItems.length <= 5) {
                    const merchantsList = merchantItems.join('、');
                    couponContent += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const merchantsId = `coupon-merchants-${card.id}-${couponIndex}`;
                    const showAllId = `coupon-show-all-${card.id}-${couponIndex}`;
                    const initialList = merchantItems.slice(0, 5).join('、');
                    const fullList = merchantItems.join('、');
                    couponContent += `<div class="cashback-merchants">`;
                    couponContent += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    couponContent += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${merchantItems.length}個</button>`;
                    couponContent += `</div>`;
                }
            }

            // 條件顯示（統一格式；內容過長時可收起）
            if (coupon.conditions) {
                couponContent += `<div class="cashback-condition" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">`;
                couponContent += `<div style="font-weight: 600; margin-bottom: 4px;">📝 條件：</div>`;
                couponContent += `<div class="cond-collapsible" style="font-size: 12px; color: #6b7280; margin-left: 12px; margin-top: 4px;"><span class="cond-text">• ${coupon.conditions}</span><button type="button" class="cond-toggle" style="display:none;">...展開</button></div>`;
                couponContent += `</div>`;
            }

            couponContent += `</div>`;
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
    initConditionClamps(document.getElementById('card-special-cashback'));
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
            const parsedRate = rate.rate === '{specialRate}' ? specialRate : rate.rate;
            return {
                parsedRate,
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
        birthdayNoteText = '※ 「慶生月」方案：請登入並設定生日月份，即可在生日當月自動納入比較';
        birthdayNoteColor = '#9ca3af';
    } else if (!userBirthdayMonth) {
        birthdayNoteText = '※ 「慶生月」方案：在上方設定生日月份後，將在您的生日月份自動納入比較';
        birthdayNoteColor = '#9ca3af';
    } else if (isBirthdayMonth) {
        birthdayNoteText = `🎂 本月是您的生日月份（${userBirthdayMonth}月），「慶生月」方案已自動納入比較！`;
        birthdayNoteColor = '#be185d';
    } else {
        birthdayNoteText = `※ 「慶生月」方案：已設定在您的生日月份（${userBirthdayMonth}月）自動納入比較`;
        birthdayNoteColor = '#9ca3af';
    }
    content += `
        <div class="cube-birthday-note" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px; margin-bottom: 16px;">
            <div style="color: ${birthdayNoteColor}; font-size: 11px; line-height: 1.5; font-style: italic;">
                ${birthdayNoteText}
            </div>
        </div>
    `;

    // 依照回饋率高低順序顯示，變動的玩數位樂饗購趣旅行放在最後

    // 1. 童樂匯 10% 回饋 (固定最高) - 只顯示進行中的
    const childrenRate10 = card.cashbackRates?.find(rate => {
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        return rate.rate === 10.0 && rate.category === '切換「童樂匯」方案' && (status === 'active' || status === 'always');
    });
    if (childrenRate10) {
        content += `<div class="cashback-detail-item">`;

        // Add ending soon badge if applicable
        let endingSoonBadge10 = '';
        if (childrenRate10.periodEnd && isEndingSoon(childrenRate10.periodEnd, 10)) {
            const daysUntil = getDaysUntilEnd(childrenRate10.periodEnd);
            const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
            endingSoonBadge10 = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }

        const categoryStyle10 = getCategoryStyle('童樂匯');
        content += `<div class="cashback-rate"><span class="cashback-rate-num">10%</span> 回饋 <span style="${categoryStyle10}">${getCategoryDisplayName('童樂匯')}</span>${endingSoonBadge10}</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;
        if (childrenRate10.conditions) {
            content += renderConditionLine(childrenRate10.conditions);
        }
        if (childrenRate10.period) {
            content += `<div class="cashback-condition">活動期間: ${childrenRate10.period}</div>`;
        }
        const items10 = childrenRate10.items;
        const merchantsList10 = items10.join('、');
        if (items10.length <= 5) {
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList10}</div>`;
        } else {
            const initialList10 = items10.slice(0, 5).join('、');
            const merchantsId10 = 'cube-children10-merchants';
            const showAllId10 = 'cube-children10-show-all';
            content += `<div class="cashback-merchants">`;
            content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId10}">${initialList10}</span>`;
            content += `<button class="show-more-btn" id="${showAllId10}" onclick="toggleMerchants('${merchantsId10}', '${showAllId10}', '${escapeForOnclick(initialList10)}', '${escapeForOnclick(merchantsList10)}')">... 顯示全部${items10.length}個</button>`;
            content += `</div>`;
        }
        content += `</div>`;
    }

    // 2. 童樂匯 5% 回饋 - 只顯示進行中的
    const childrenRate5 = card.cashbackRates?.find(rate => {
        const status = getRateStatus(rate.periodStart, rate.periodEnd);
        return rate.rate === 5.0 && rate.category === '切換「童樂匯」方案' && (status === 'active' || status === 'always');
    });
    if (childrenRate5) {
        content += `<div class="cashback-detail-item">`;

        // Add ending soon badge if applicable
        let endingSoonBadge5 = '';
        if (childrenRate5.periodEnd && isEndingSoon(childrenRate5.periodEnd, 10)) {
            const daysUntil = getDaysUntilEnd(childrenRate5.periodEnd);
            const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
            endingSoonBadge5 = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
        }

        const categoryStyle5 = getCategoryStyle('童樂匯');
        content += `<div class="cashback-rate"><span class="cashback-rate-num">5%</span> 回饋 <span style="${categoryStyle5}">${getCategoryDisplayName('童樂匯')}</span>${endingSoonBadge5}</div>`;
        content += `<div class="cashback-condition">消費上限: 無上限</div>`;
        if (childrenRate5.conditions) {
            content += renderConditionLine(childrenRate5.conditions);
        }
        if (childrenRate5.period) {
            content += `<div class="cashback-condition">活動期間: ${childrenRate5.period}</div>`;
        }
        const items5 = childrenRate5.items;
        const merchantsList5 = items5.join('、');
        if (items5.length <= 5) {
            content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList5}</div>`;
        } else {
            const initialList5 = items5.slice(0, 5).join('、');
            const merchantsId5 = 'cube-children5-merchants';
            const showAllId5 = 'cube-children5-show-all';
            content += `<div class="cashback-merchants">`;
            content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId5}">${initialList5}</span>`;
            content += `<button class="show-more-btn" id="${showAllId5}" onclick="toggleMerchants('${merchantsId5}', '${showAllId5}', '${escapeForOnclick(initialList5)}', '${escapeForOnclick(merchantsList5)}')">... 顯示全部${items5.length}個</button>`;
            content += `</div>`;
        }
        content += `</div>`;
    }

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
                    content += `<div class="cashback-detail-item">`;
                    const categoryStyle = getCategoryStyle(category);

                    // 解析 rate（支援 {specialRate} placeholder）
                    let displayRate = categoryData.rate;
                    if (categoryData.rate === '{specialRate}') {
                        displayRate = specialRate;
                    } else if (typeof categoryData.rate === 'string' && categoryData.rate.startsWith('{')) {
                        // 其他 placeholder，從 levelSettings 解析
                        const fieldName = categoryData.rate.slice(1, -1);
                        displayRate = levelSettings[fieldName] || categoryData.rate;
                    }

                    content += `<div class="cashback-rate"><span class="cashback-rate-num">${displayRate}%</span> 回饋 <span style="${categoryStyle}">${getCategoryDisplayName(category)}</span></div>`;
                    content += `<div class="cashback-condition">消費上限: ${categoryData.cap ? `NT$${Math.floor(categoryData.cap).toLocaleString()}` : '無上限'}</div>`;

                    if (categoryData.period) {
                        content += `<div class="cashback-condition">活動期間: ${categoryData.period}</div>`;
                    }

                    const merchantsList = items.join('、');
                    if (items.length <= 5) {
                        content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                    } else {
                        const initialList = items.slice(0, 5).join('、');
                        const merchantsId = `cube-merchants-${category}-${savedLevel}`;
                        const showAllId = `cube-show-all-${category}-${savedLevel}`;

                        content += `<div class="cashback-merchants">`;
                        content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                        content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(merchantsList)}')">... 顯示全部${items.length}個</button>`;
                        content += `</div>`;
                    }
                    content += `</div>`;
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
                    rate.category !== '切換「童樂匯」方案' &&
                    (status === 'active' || status === 'always');  // 只顯示進行中的
            })
            .sort((a, b) => {
                // 先解析 rate 以支援 {specialRate} 和 {rate} 的排序
                // 註：這裡刻意不經 getDisplayRate 加總（不像 7906/7940 等呼叫點）——
                // 本區塊下面的顯示（mergedRate.parsedRate）本來就是顯示原始 rate、不含
                // stacking 加總，排序理應跟著同一個數字走，否則才會「排序與顯示不一致」。
                // CUBE 卡既有 rate+basic 資料（如「切換全支付方案」）依賴這個既有順序，
                // 跨槽引用 rate_N 目前也沒有卡片用在這個 CUBE 專屬路徑，此處不動。
                const aRate = parseCashbackRateSync(a.rate, levelSettings);
                const bRate = parseCashbackRateSync(b.rate, levelSettings);
                return bRate - aRate;
            });

        // Merge active rates with same parsedRate, category, and period (CUBE card only)
        const mergedActiveRates = new Map();
        for (const rate of otherRates) {
            const parsedRate = await parseCashbackRate(rate.rate, card, levelSettings);
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
            } else {
                // First time seeing this rate+category+period combination
                mergedActiveRates.set(mergeKey, {
                    parsedRate,
                    parsedCap,
                    items: rate.items ? [...rate.items] : [],
                    conditions: rate.conditions || '',
                    period: rate.period,
                    periodEnd: rate.periodEnd,
                    category: rate.category
                });
            }
        }

        // Display merged rates
        let index = 0;
        for (const [mergeKey, mergedRate] of mergedActiveRates) {
            content += `<div class="cashback-detail-item">`;

            // 显示回饋率，如果有 category 则显示在括号中（使用動態樣式）
            const categoryStyleOther = mergedRate.category ? getCategoryStyle(mergedRate.category) : '';
            const categoryLabel = mergedRate.category ? ` <span style="${categoryStyleOther}">${getCategoryDisplayName(mergedRate.category)}</span>` : '';

            // Add ending soon badge if applicable
            let endingSoonBadgeOther = '';
            if (mergedRate.periodEnd && isEndingSoon(mergedRate.periodEnd, 10)) {
                const daysUntil = getDaysUntilEnd(mergedRate.periodEnd);
                const daysText = daysUntil === 0 ? '今天結束' : daysUntil === 1 ? '明天結束' : `${daysUntil}天後結束`;
                endingSoonBadgeOther = ` <span class="ending-soon-badge">即將結束 (${daysText})</span>`;
            }

            content += `<div class="cashback-rate"><span class="cashback-rate-num">${mergedRate.parsedRate}%</span> 回饋${categoryLabel}${endingSoonBadgeOther}</div>`;

            // 显示消費上限
            if (mergedRate.parsedCap) {
                content += `<div class="cashback-condition">消費上限: NT$${mergedRate.parsedCap.toLocaleString()}</div>`;
            } else {
                content += `<div class="cashback-condition">消費上限: 無上限</div>`;
            }

            // 显示條件
            if (mergedRate.conditions) {
                content += renderConditionLine(mergedRate.conditions);
            }

            // 显示活動期間
            if (mergedRate.period) {
                content += `<div class="cashback-condition">活動期間: ${mergedRate.period}</div>`;
            }

            // 显示適用通路
            if (mergedRate.items && mergedRate.items.length > 0) {
                const merchantsId = `cube-other-merchants-${index}`;
                const showAllId = `cube-other-show-all-${index}`;

                if (mergedRate.items.length <= 5) {
                    const merchantsList = mergedRate.items.join('、');
                    content += `<div class="cashback-merchants"><span class="cashback-merchants-label">適用通路：</span>${merchantsList}</div>`;
                } else {
                    const initialList = mergedRate.items.slice(0, 5).join('、');
                    const fullList = mergedRate.items.join('、');

                    content += `<div class="cashback-merchants">`;
                    content += `<span class="cashback-merchants-label">適用通路：</span><span id="${merchantsId}">${initialList}</span>`;
                    content += `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeForOnclick(initialList)}', '${escapeForOnclick(fullList)}')">… 顯示全部${mergedRate.items.length}個</button>`;
                    content += `</div>`;
                }
            }

            content += `</div>`;
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

// Escape a string for embedding as a single-quoted JS literal inside an HTML onclick attribute.
// Apostrophes (e.g. "Tomod's") would otherwise close the single-quoted string early.
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
        // 收起
        merchantsElement.textContent = shortList;
        const totalCount = fullList.split('、').length;
        buttonElement.textContent = `... 顯示全部${totalCount}個`;
    } else {
        // 展開
        merchantsElement.textContent = fullList;
        buttonElement.textContent = '收起';
    }
}

// 即時過濾「指定通路回饋」中的活動卡片
// 只在已渲染的 DOM 上做過濾（不重新計算或 fetch），效能 < 5ms
function filterCashbackItems(searchTerm) {
    const term = (searchTerm || '').toLowerCase().trim();
    const container = document.getElementById('card-special-cashback');
    const emptyMsg = document.getElementById('cashback-search-empty');
    if (!container) return;

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
        } else {
            item.style.display = 'none';
        }
    });

    if (emptyMsg) {
        emptyMsg.style.display = (term && visibleCount === 0) ? 'block' : 'none';
    }
}

// 切換條件顯示/隱藏
function toggleConditions(conditionsId, buttonId) {
    const conditionsElement = document.getElementById(conditionsId);
    const buttonElement = document.getElementById(buttonId);

    if (!conditionsElement || !buttonElement) return;

    const isHidden = conditionsElement.style.display === 'none';

    if (isHidden) {
        // 展開
        conditionsElement.style.display = 'block';
        buttonElement.textContent = '▲ 收起條件';
    } else {
        // 收起
        conditionsElement.style.display = 'none';
        buttonElement.textContent = '▼ 查看各通路詳細條件';
    }
}

// 將toggleMerchants和toggleConditions暴露到全局作用域，確保onclick可以訪問
window.toggleMerchants = toggleMerchants;
window.toggleConditions = toggleConditions;

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

