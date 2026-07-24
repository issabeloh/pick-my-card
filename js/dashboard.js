/* ============================================================
 * Pick My Card — js/dashboard.js（第 13 個模組檔，載入順序最後；docs/project/dashboard.md）
 *
 * Phase 1：儀表板是 main 裡的一個分頁視圖（hash #dashboard 切換），不是 modal——
 * 彙整持有卡的個人資料做「唯讀」視覺化（結帳日、年費、額度、釘選通路、分級、筆記）。
 * merchant/landing 頁沒有這裡用到的 DOM，所有函式一律 null-check no-op，不丟 console 錯誤。
 * 🔒 CLAUDE.md 鐵則 1：本檔任何路徑都不得呼叫「儲存級別」的函式（分級只唯讀顯示，用 getCardLevel 讀取）。
 *
 * 區塊目錄（Grep 關鍵字）：
 *  - 視圖切換                  → "pmcApplyViewFromHash" / "goToView"
 *  - 初始化（DOMContentLoaded） → "initDashboardView"
 *  - 顯示設定（dashboardBlocks）→ "getDashboardBlockPrefs" / "renderSettingsPanel"
 *  - 持有卡個人資料彙整         → "buildDashboardData"（登入者 users/{uid} 單一 snapshot）
 *  - Block 渲染                → "renderBillingBlock" / "renderAnnualFeeBlock" /
 *                                 "renderCreditLimitBlock" / "renderPinnedBlock" /
 *                                 "renderLevelsBlock" / "renderNotesBlock"
 * ============================================================ */
(function () {
    'use strict';

    // 六個 block 的定義與渲染順序（docs/project/dashboard.md 第 4 節表格順序）
    const BLOCK_DEFS = [
        { id: 'billing', title: '📅 結帳日 / 繳款日', render: renderBillingBlock },
        { id: 'annualFee', title: '💳 年費', render: renderAnnualFeeBlock },
        { id: 'creditLimit', title: '💰 我的額度', render: renderCreditLimitBlock },
        { id: 'pinned', title: '📌 釘選通路', render: renderPinnedBlock },
        { id: 'levels', title: '🎯 分級', render: renderLevelsBlock },
        { id: 'notes', title: '📝 我的筆記', render: renderNotesBlock }
    ];
    const DASHBOARD_BLOCKS_KEY = 'dashboardBlocks';

    let dashboardViewEl = null;
    let dashboardGridEl = null;
    // 避免「使用者已切走／再次觸發渲染」時，較舊的非同步渲染結果晚到還蓋掉畫面
    let _renderToken = 0;

    // ========== 顯示設定（dashboardBlocks，裝置級偏好；Phase 1 不同步 Firestore） ==========

    // 讀取偏好：缺 key／損毀資料一律視為「全部顯示」（預設全開，見 dashboard.md 第 4 節）
    function getDashboardBlockPrefs() {
        const saved = readLocalJSON(DASHBOARD_BLOCKS_KEY, null);
        const prefs = {};
        BLOCK_DEFS.forEach(function (b) {
            prefs[b.id] = !(saved && typeof saved === 'object' && !Array.isArray(saved) && saved[b.id] === false);
        });
        return prefs;
    }

    function saveDashboardBlockPrefs(prefs) {
        try {
            localStorage.setItem(DASHBOARD_BLOCKS_KEY, JSON.stringify(prefs));
        } catch (e) {
            console.error('❌ [儀表板] 儲存顯示設定失敗:', e);
        }
    }

    function renderSettingsPanel() {
        const list = document.getElementById('dashboard-settings-list');
        if (!list) return;
        const prefs = getDashboardBlockPrefs();
        list.innerHTML = BLOCK_DEFS.map(function (def) {
            return (
                '<label class="dashboard-settings-item">' +
                '<input type="checkbox" data-block-toggle="' + escapeHtml(def.id) + '" ' +
                (prefs[def.id] ? 'checked' : '') + '>' +
                '<span>' + escapeHtml(def.title) + '</span>' +
                '</label>'
            );
        }).join('');
        list.querySelectorAll('[data-block-toggle]').forEach(function (cb) {
            cb.onchange = function () {
                const current = getDashboardBlockPrefs();
                current[cb.getAttribute('data-block-toggle')] = cb.checked;
                saveDashboardBlockPrefs(current);
                renderDashboard(); // 即時反映（不需要「儲存」按鈕）
            };
        });
    }

    function openDashboardSettings() {
        const modal = document.getElementById('dashboard-settings-modal');
        if (!modal) return;
        renderSettingsPanel();
        modal.style.display = 'flex';
        disableBodyScroll();
    }

    function closeDashboardSettings() {
        const modal = document.getElementById('dashboard-settings-modal');
        if (!modal) return;
        modal.style.display = 'none';
        enableBodyScroll();
    }

    // ========== 小工具 ==========

    function dashFormatToday() {
        const d = new Date();
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 週' + weekdays[d.getDay()];
    }

    // 持有卡清單來源與 renderOwnedCardsOverview()（js/cards-modals.js）相同：
    // cardsData.cards 用 myOwnedCards 過濾、按卡名排序。
    function dashGetOwnedCards() {
        if (!cardsData || !Array.isArray(cardsData.cards) || typeof myOwnedCards === 'undefined' || !myOwnedCards) {
            return [];
        }
        return cardsData.cards
            .filter(function (card) { return myOwnedCards.has(card.id); })
            .sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    function dashEmptyBlockHtml(cardIdForLink) {
        const safeCardId = escapeHtml(String(cardIdForLink || ''));
        return (
            '<div class="dashboard-empty-block">' +
            '<p>尚無資料</p>' +
            '<button type="button" class="dashboard-empty-link" data-goto-card="' + safeCardId + '">前往卡片介紹頁填寫 ›</button>' +
            '</div>'
        );
    }

    function blockWrap(id, title, innerHtml) {
        return (
            '<div class="dashboard-block" data-block="' + escapeHtml(id) + '">' +
            '<h3 class="dashboard-block-title">' + escapeHtml(title) + '</h3>' +
            innerHtml +
            '</div>'
        );
    }

    // 等待 cardsData 就緒（輪詢；data-loader.js 非同步載入完成前 cardsData 是 null）
    function dashWaitForCardsData(maxWaitMs) {
        return new Promise(function (resolve) {
            const start = Date.now();
            (function poll() {
                if (cardsData && Array.isArray(cardsData.cards)) return resolve(true);
                if (Date.now() - start > maxWaitMs) return resolve(false);
                setTimeout(poll, 150);
            })();
        });
    }

    // day（1-31）距離「今天」下一次出現的天數（>=0）；不考慮月份天數差異的邊界，
    // 只是儀表板時間軸的排序/highlight 用途，非精確帳務計算
    function dashDaysUntilDay(day, today) {
        const todayDate = today.getDate();
        if (day >= todayDate) return day - todayDate;
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        return (daysInMonth - todayDate) + day;
    }

    function dashNormalizeBillingDates(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { billingDate: '', statementDate: '' };
        return {
            billingDate: typeof raw.billingDate === 'string' ? raw.billingDate : '',
            statementDate: typeof raw.statementDate === 'string' ? raw.statementDate : ''
        };
    }

    // 比照 loadCreditLimit() 的 parse()：只接受正的有限數字
    function dashParseCreditLimit(v) {
        const n = Number(v);
        return (v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n > 0) ? n : null;
    }

    function bindDashboardCardLinks() {
        if (!dashboardGridEl) return;
        dashboardGridEl.querySelectorAll('[data-goto-card]').forEach(function (btn) {
            const cardId = btn.getAttribute('data-goto-card');
            btn.onclick = function () {
                if (cardId && typeof showCardDetail === 'function') showCardDetail(cardId);
            };
        });
    }

    // ========== 資料彙整（讀取效率：登入者 users/{uid} 只取一次 snapshot） ==========

    // 登入者：一次 getDoc 讀 users/{uid}，feeWaiverStatus/creditLimits/billingDates 都從
    // 同一個 snapshot 取欄位（欄位名照各 save 函數：saveFeeWaiverStatus/saveCreditLimit/
    // saveBillingDates，皆寫在 js/spending-mappings.js）。訪客走各自 local key，一律走
    // readLocalJSON（billingDates 是 JSON）或原始字串比對（feeWaiver/creditLimit 本來就
    // 不是 JSON，比照原函式的讀法）。
    async function dashLoadUserSnapshot() {
        if (typeof currentUser === 'undefined' || !currentUser) return null;
        try {
            if (window.db && window.doc && window.getDoc) {
                const docRef = window.doc(window.db, 'users', currentUser.uid);
                const docSnap = await window.getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data() || {};
                    return {
                        feeWaiverStatus: data.feeWaiverStatus || {},
                        creditLimits: data.creditLimits || {},
                        billingDates: data.billingDates || {}
                    };
                }
            }
        } catch (e) {
            console.error('❌ [儀表板] 讀取 users/{uid} snapshot 失敗:', e);
        }
        return { feeWaiverStatus: {}, creditLimits: {}, billingDates: {} };
    }

    // 筆記存在獨立的 userNotes/{uid}_{cardId} collection（非 users/{uid} 底下），資料模型
    // 本身就無法用單一 snapshot 讀多卡——這裡逐卡呼叫既有的 loadUserNotes()（它自己會走
    // Firestore 或 localStorage fallback），只對「持有卡」跑，數量有界，不逐字面優化。
    // 級別同理是唯讀例外，直接用 getCardLevel()（有正規化/快取邏輯，不重讀）。
    async function buildDashboardData(ownedCards) {
        const snapshot = await dashLoadUserSnapshot();

        // 釘選通路：既有的 loadSpendingMappings() 本身就是「一次」讀取（登入者一次 getDoc、
        // 訪客一次 localStorage 讀），直接沿用、不重新發請求。
        await loadSpendingMappings();
        const pinnedByCardId = new Map();
        (Array.isArray(userSpendingMappings) ? userSpendingMappings : []).forEach(function (m) {
            if (!m || !m.cardId || !m.merchant) return;
            if (!ownedCards.some(function (c) { return c.id === m.cardId; })) return; // 只列持有卡
            if (!pinnedByCardId.has(m.cardId)) pinnedByCardId.set(m.cardId, []);
            pinnedByCardId.get(m.cardId).push(m);
        });

        const billing = [];
        const annualFeeRows = [];
        let annualFeeTotal = 0;
        let annualFeeUncounted = 0;
        const creditLimitRows = [];
        const levelsRows = [];
        const notesRows = [];

        for (const card of ownedCards) {
            // --- 結帳日/繳款日 ---
            const dates = snapshot
                ? dashNormalizeBillingDates(snapshot.billingDates[card.id])
                : dashNormalizeBillingDates(readLocalJSON('billingDates_local_' + card.id, null));
            if (dates.billingDate || dates.statementDate) {
                billing.push({ card: card, billingDate: dates.billingDate, statementDate: dates.statementDate });
            }

            // --- 年費（isWaived 優先；否則看 annualFeeAmount 是否存在，見 dashboard.md 5d 節）---
            let isWaived = false;
            try {
                isWaived = snapshot
                    ? !!snapshot.feeWaiverStatus[card.id]
                    : localStorage.getItem('feeWaiver_local_' + card.id) === 'true';
            } catch (e) { /* localStorage 被擋時當作未免年費 */ }
            const amt = card.annualFeeAmount;
            const hasAmt = typeof amt === 'number' && Number.isFinite(amt);
            if (isWaived) {
                // 已免年費：不計入加總
            } else if (hasAmt) {
                annualFeeTotal += amt;
            } else {
                annualFeeUncounted++;
            }
            annualFeeRows.push({ card: card, isWaived: isWaived, hasAmt: hasAmt, amount: hasAmt ? amt : null, rawText: card.annualFee || '' });

            // --- 我的額度 ---
            let limitRaw;
            try {
                limitRaw = snapshot ? snapshot.creditLimits[card.id] : localStorage.getItem('creditLimit_local_' + card.id);
            } catch (e) { limitRaw = null; }
            creditLimitRows.push({ card: card, amount: dashParseCreditLimit(limitRaw) });

            // --- 分級（唯讀，getCardLevel 有快取/正規化邏輯，不自行重讀 localStorage）---
            if (card.hasLevels && card.levelSettings && Object.keys(card.levelSettings).length > 0) {
                const defaultLevel = Object.keys(card.levelSettings)[0];
                try {
                    const level = await getCardLevel(card.id, defaultLevel);
                    levelsRows.push({ card: card, level: level });
                } catch (e) {
                    console.error('❌ [儀表板] 讀取級別失敗 (' + card.id + '):', e);
                }
            }

            // --- 我的筆記（只列有筆記的卡）---
            try {
                const notes = await loadUserNotes(card.id);
                if (notes && String(notes).trim()) {
                    notesRows.push({ card: card, notes: String(notes).trim() });
                }
            } catch (e) {
                console.error('❌ [儀表板] 讀取筆記失敗 (' + card.id + '):', e);
            }
        }

        const pinnedGroups = [];
        ownedCards.forEach(function (card) {
            const mappings = pinnedByCardId.get(card.id);
            if (mappings && mappings.length > 0) {
                pinnedGroups.push({
                    card: card,
                    mappings: mappings.slice().sort(function (a, b) { return (Number(b.cashbackRate) || 0) - (Number(a.cashbackRate) || 0); })
                });
            }
        });

        return {
            billing: billing,
            annualFee: { rows: annualFeeRows, total: annualFeeTotal, uncounted: annualFeeUncounted },
            creditLimit: creditLimitRows,
            pinned: pinnedGroups,
            levels: levelsRows,
            notes: notesRows
        };
    }

    // ========== Block 渲染 ==========

    function renderBillingBlock(data, ownedCards) {
        const rows = data.billing;
        if (rows.length === 0) {
            return blockWrap('billing', BLOCK_DEFS[0].title, dashEmptyBlockHtml(ownedCards[0] && ownedCards[0].id));
        }
        const today = new Date();
        const withDay = rows
            .filter(function (r) { return r.billingDate && Number.isFinite(parseInt(r.billingDate, 10)); })
            .map(function (r) { return Object.assign({}, r, { _dayNum: parseInt(r.billingDate, 10) }); })
            .sort(function (a, b) { return a._dayNum - b._dayNum; });
        const withoutDay = rows.filter(function (r) { return !(r.billingDate && Number.isFinite(parseInt(r.billingDate, 10))); });

        let nearestId = null;
        if (withDay.length > 0) {
            let minDist = Infinity;
            withDay.forEach(function (r) {
                const dist = dashDaysUntilDay(r._dayNum, today);
                if (dist < minDist) { minDist = dist; nearestId = r.card.id; }
            });
        }

        function rowHtml(r) {
            const isNext = r.card.id === nearestId;
            const nextChip = isNext ? '<span class="dashboard-chip dashboard-chip--peach dashboard-chip--sm">最近</span>' : '';
            return (
                '<div class="dashboard-timeline-row' + (isNext ? ' is-next' : '') + '">' +
                '<div class="dashboard-timeline-dot" aria-hidden="true"></div>' +
                '<div class="dashboard-timeline-body">' +
                '<div class="dashboard-timeline-card">' + escapeHtml(r.card.name) + nextChip + '</div>' +
                '<div class="dashboard-timeline-dates">' +
                '<span>結帳日 ' + (r.billingDate ? escapeHtml(r.billingDate) + '日' : '未設定') + '</span>' +
                '<span>繳款日 ' + (r.statementDate ? escapeHtml(r.statementDate) + '日' : '未設定') + '</span>' +
                '</div></div></div>'
            );
        }

        const html = withDay.map(rowHtml).join('') + withoutDay.map(rowHtml).join('');
        return blockWrap('billing', BLOCK_DEFS[0].title, '<div class="dashboard-timeline">' + html + '</div>');
    }

    function renderAnnualFeeBlock(data, ownedCards) {
        const info = data.annualFee;
        if (info.rows.length === 0) {
            return blockWrap('annualFee', BLOCK_DEFS[1].title, dashEmptyBlockHtml(ownedCards[0] && ownedCards[0].id));
        }
        const rowsHtml = info.rows.map(function (r) {
            const name = escapeHtml(r.card.name);
            if (r.isWaived) {
                return '<div class="dashboard-fee-row"><span class="dashboard-fee-card">' + name + '</span>' +
                    '<span class="dashboard-chip dashboard-chip--mint">已免年費</span></div>';
            }
            if (r.hasAmt) {
                const text = r.amount > 0 ? ('NT$' + r.amount.toLocaleString()) : '免年費';
                return '<div class="dashboard-fee-row"><span class="dashboard-fee-card">' + name + '</span>' +
                    '<span class="dashboard-fee-amount">' + escapeHtml(text) + '</span></div>';
            }
            return '<div class="dashboard-fee-row"><span class="dashboard-fee-card">' + name + '</span>' +
                '<span class="dashboard-fee-raw">' + escapeHtml(r.rawText || '未提供年費資訊') +
                ' <span class="dashboard-chip dashboard-chip--peach dashboard-chip--sm">待補資料</span></span></div>';
        }).join('');
        const noteHtml = info.uncounted > 0
            ? '<div class="dashboard-fee-total-note">＊ ' + info.uncounted + ' 張卡年費未計入加總（待補資料）</div>'
            : '';
        const totalHtml =
            '<div class="dashboard-fee-total">' +
            '<div class="dashboard-fee-total-label">年費加總</div>' +
            '<div class="dashboard-fee-total-amount">NT$' + info.total.toLocaleString() + '</div>' +
            noteHtml +
            '</div>';
        return blockWrap('annualFee', BLOCK_DEFS[1].title, totalHtml + rowsHtml);
    }

    function renderCreditLimitBlock(data, ownedCards) {
        const rows = data.creditLimit;
        const withValue = rows.filter(function (r) { return r.amount !== null; }).sort(function (a, b) { return b.amount - a.amount; });
        if (withValue.length === 0) {
            return blockWrap('creditLimit', BLOCK_DEFS[2].title, dashEmptyBlockHtml(ownedCards[0] && ownedCards[0].id));
        }
        const max = withValue[0].amount;
        const barsHtml = withValue.map(function (r) {
            const pct = max > 0 ? Math.max(4, Math.round((r.amount / max) * 100)) : 0;
            return (
                '<div class="dashboard-limit-row">' +
                '<div class="dashboard-limit-label"><span>' + escapeHtml(r.card.name) + '</span>' +
                '<span class="dashboard-limit-value">NT$' + r.amount.toLocaleString() + '</span></div>' +
                '<div class="dashboard-limit-bar-track"><div class="dashboard-limit-bar-fill" style="width:' + pct + '%"></div></div>' +
                '</div>'
            );
        }).join('');
        const withoutValue = rows.filter(function (r) { return r.amount === null; });
        const unfilledHtml = withoutValue.length > 0
            ? '<div class="dashboard-limit-unfilled">' +
              withoutValue.map(function (r) { return '<span>' + escapeHtml(r.card.name) + ' · 未填寫</span>'; }).join('') +
              '</div>'
            : '';
        return blockWrap('creditLimit', BLOCK_DEFS[2].title, barsHtml + unfilledHtml);
    }

    function renderPinnedBlock(data, ownedCards) {
        const groups = data.pinned;
        if (groups.length === 0) {
            return blockWrap('pinned', BLOCK_DEFS[3].title, dashEmptyBlockHtml(ownedCards[0] && ownedCards[0].id));
        }
        const html = groups.map(function (g) {
            const chips = g.mappings.map(function (m) {
                const rateNum = Number(m.cashbackRate);
                const rateText = Number.isFinite(rateNum) ? (rateNum + '%') : escapeHtml(String(m.cashbackRate || ''));
                return '<span class="dashboard-chip dashboard-chip--lavender">' + escapeHtml(m.merchant) + ' ' + rateText + '</span>';
            }).join('');
            return (
                '<div class="dashboard-pinned-group">' +
                '<div class="dashboard-pinned-card">' + escapeHtml(g.card.name) + '</div>' +
                '<div class="dashboard-pinned-chips">' + chips + '</div>' +
                '</div>'
            );
        }).join('');
        return blockWrap('pinned', BLOCK_DEFS[3].title, html);
    }

    function renderLevelsBlock(data, ownedCards) {
        const rows = data.levels;
        if (rows.length === 0) {
            return blockWrap('levels', BLOCK_DEFS[4].title, dashEmptyBlockHtml(ownedCards[0] && ownedCards[0].id));
        }
        const html = rows.map(function (r) {
            return (
                '<div class="dashboard-level-row">' +
                '<span class="dashboard-level-card">' + escapeHtml(r.card.name) + '</span>' +
                '<span class="dashboard-chip dashboard-chip--mint">' + escapeHtml(String(r.level)) + '</span>' +
                '</div>'
            );
        }).join('');
        return blockWrap('levels', BLOCK_DEFS[4].title, html);
    }

    function renderNotesBlock(data, ownedCards) {
        const rows = data.notes;
        if (rows.length === 0) {
            return blockWrap('notes', BLOCK_DEFS[5].title, dashEmptyBlockHtml(ownedCards[0] && ownedCards[0].id));
        }
        const html = rows.map(function (r) {
            return (
                '<div class="dashboard-note-row">' +
                '<div class="dashboard-note-card">' + escapeHtml(r.card.name) + '</div>' +
                '<div class="dashboard-note-text">' + escapeHtmlMultiline(r.notes) + '</div>' +
                '</div>'
            );
        }).join('');
        return blockWrap('notes', BLOCK_DEFS[5].title, html);
    }

    // ========== 主渲染流程 ==========

    async function renderDashboard() {
        if (!dashboardViewEl || !dashboardGridEl) return;
        const token = ++_renderToken;

        const ready = await dashWaitForCardsData(6000);
        if (token !== _renderToken) return; // 使用者已切走或再次觸發了渲染
        if (!ready) {
            console.error('❌ [儀表板] cardsData 逾時未就緒，無法渲染');
            return;
        }

        const dateEl = document.getElementById('dashboard-date');
        if (dateEl) dateEl.textContent = dashFormatToday();

        const ownedCards = dashGetOwnedCards();
        const countEl = document.getElementById('dashboard-owned-count');
        if (countEl) countEl.textContent = '持有卡 ' + ownedCards.length + ' 張';

        if (ownedCards.length === 0) {
            dashboardGridEl.innerHTML =
                '<div class="dashboard-empty-all">' +
                '<p>你還沒有新增任何持有卡片。</p>' +
                '<button type="button" class="dashboard-empty-link" id="dashboard-add-owned-btn">前往新增持有卡片 ›</button>' +
                '</div>';
            const addBtn = document.getElementById('dashboard-add-owned-btn');
            if (addBtn) {
                addBtn.onclick = function () {
                    if (typeof openManageOwnedCardsModal === 'function') openManageOwnedCardsModal();
                };
            }
            return;
        }

        let data;
        try {
            data = await buildDashboardData(ownedCards);
        } catch (e) {
            console.error('❌ [儀表板] 讀取個人資料失敗:', e);
            data = { billing: [], annualFee: { rows: [], total: 0, uncounted: 0 }, creditLimit: [], pinned: [], levels: [], notes: [] };
        }
        if (token !== _renderToken) return;

        const prefs = getDashboardBlockPrefs();
        let html = '';
        BLOCK_DEFS.forEach(function (def) {
            if (!prefs[def.id]) return;
            html += def.render(data, ownedCards);
        });
        dashboardGridEl.innerHTML = html || dashEmptyBlockHtml(ownedCards[0].id);
        bindDashboardCardLinks();
    }

    // ========== 視圖切換（hash #dashboard，非 modal） ==========

    function updateViewSwitchButtons(isDashboard) {
        document.querySelectorAll('[data-view]').forEach(function (btn) {
            const active = (btn.getAttribute('data-view') === 'dashboard') === isDashboard;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    function pmcApplyViewFromHash() {
        if (!dashboardViewEl) return;
        const isDashboard = location.hash === '#dashboard';
        document.body.classList.toggle('view-dashboard', isDashboard);
        dashboardViewEl.style.display = isDashboard ? '' : 'none';
        updateViewSwitchButtons(isDashboard);
        if (isDashboard) renderDashboard();
    }

    function goToView(view) {
        if (!dashboardViewEl) return;
        const wantsDashboard = view === 'dashboard';
        const isDashboard = location.hash === '#dashboard';
        if (wantsDashboard === isDashboard) {
            pmcApplyViewFromHash();
            return;
        }
        if (wantsDashboard) {
            // 設定 hash 會自動 push 一筆 history，讓瀏覽器返回鍵能回到工具視圖
            location.hash = 'dashboard';
        } else {
            // 離開儀表板：清掉 hash 但不佔用新的「前進」歷史紀錄；pushState 不會觸發
            // hashchange，手動呼叫一次套用畫面
            history.pushState(null, '', location.pathname + location.search);
            pmcApplyViewFromHash();
        }
    }

    // ========== 初始化 ==========

    function initDashboardView() {
        dashboardViewEl = document.getElementById('dashboard-view');
        dashboardGridEl = document.getElementById('dashboard-grid');
        if (!dashboardViewEl || !dashboardGridEl) return; // merchant/landing 頁沒有儀表板 DOM

        document.body.classList.add('has-dashboard-nav');

        document.querySelectorAll('[data-view]').forEach(function (btn) {
            btn.addEventListener('click', function () { goToView(btn.getAttribute('data-view')); });
        });

        window.addEventListener('hashchange', pmcApplyViewFromHash);

        const settingsBtn = document.getElementById('dashboard-settings-btn');
        if (settingsBtn) settingsBtn.addEventListener('click', openDashboardSettings);
        const settingsClose = document.getElementById('dashboard-settings-close');
        if (settingsClose) settingsClose.addEventListener('click', closeDashboardSettings);
        const settingsModal = document.getElementById('dashboard-settings-modal');
        if (settingsModal) {
            settingsModal.addEventListener('click', function (e) {
                if (e.target === settingsModal) closeDashboardSettings();
            });
        }

        pmcApplyViewFromHash();

        // 進場時 cardsData/myOwnedCards 等可能還沒就緒（onAuthStateChanged 是非同步流程，
        // 本檔範圍限制不能去改 auth-user-data.js 加就緒事件）；若使用者一開頁就停在
        // #dashboard（書籤/分享連結），補一次延遲重繪把可能晚到的持有卡資料撿回來。
        // 重繪是唯讀且冪等，多跑一次無副作用。
        setTimeout(function () {
            if (location.hash === '#dashboard') renderDashboard();
        }, 1200);
    }

    document.addEventListener('DOMContentLoaded', initDashboardView);
})();
