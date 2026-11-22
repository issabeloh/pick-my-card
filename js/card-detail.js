/* ============================================================
 * Pick My Card — js/card-detail.js（載入順序 9/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 卡片詳情頁主體            → "showCardDetail"
 *  - 近期異動（changelog）      → "renderCardDetailChangelog"
 *  - CUBE 卡專屬內容            → "generateCubeSpecialContent" / "updateCubeSpecialCashback"
 *  - onclick 轉義               → "escapeForOnclick"
 *  - 詳情頁回饋卡（同方案一張卡，2026-11-17）→ "planCardsHtml" / "renderPlanCard" / "formatRateCardCap"
 *  - 適用通路三行／條件一行（量寬度後才收）→ "cdFitChannel" / "setupCardDetailFit"
 *  - 計算條件列（分級卡）        → "updateCardCalcConditions"
 *  - 商家清單展開收合（含 window 賦值）→ "toggleMerchants"
 *  - 詳情頁項目過濾            → "filterCashbackItems" / "condenseMerchantList"
 *  - 個人設定儲存狀態列（2026-11-17 第三輪）→ "cdTrackSave" / "cdSaveStatusRender" / "cdSettingRowHtml" / "cdFlushNotes"
 *  - 新戶活動票券（2026-11-17 第三輪）→ "renderCardDetailPromoTickets" / "cdRenderPromoTicket" / "cdParsePromoSteps"
 *  - 用戶筆記                  → "loadUserNotes" / "saveUserNotes"
 * ============================================================ */
// ============================================================
// 詳情頁外殼狀態（2026-11-17 改版）
// ============================================================
let _cdCurrentCardId = null;   // 目前開著的卡（null＝關閉）；級別切換重繪同一張卡時用來保留頁籤與捲動位置
let _cdPushed = false;         // 這次開啟有沒有 pushState 過（關閉時決定要不要 history.back()）
let _cdExpectPop = false;      // 我們自己呼叫 history.back() 後那一次 popstate 要略過
let _cdClose = null;           // 目前開著的那一次 showCardDetail 裡的 closeModal（popstate 要呼叫它）
let _cdApply = null;           // { cardId, link } 這張卡的申辦資料；null＝沒有申辦連結

// 手機返回鍵：popstate 時關閉詳情頁（push 的時機在 showCardDetail 開啟處）。
// 只收詳情頁——疊在「我的信用卡」／選卡 modal／配卡組合頁上面開啟時，那些不用歷史，網址也沒變，
// 所以返回只會關掉詳情頁
// （掛在 DOMContentLoaded 裡：tools/lib/merchant-cards.js 在 vm 沙箱載入 js/，沙箱的 window 沒有 addEventListener）
document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('popstate', () => {
        if (_cdExpectPop) { _cdExpectPop = false; return; }
        const modal = document.getElementById('card-detail-modal');
        if (modal && modal.style.display === 'flex' && typeof _cdClose === 'function') {
            _cdPushed = false;   // 這筆歷史已經被退掉了，不能再 history.back()
            _cdClose({ fromHistory: true });
        }
    });
});

// 申辦資料 → 桌機頁首鈕＋手機膠囊。href 一律 sanitizeUrl（鐵則 3）；文字全走 textContent。
// 膠囊文字：這張卡有新戶活動時用第一筆（getActiveCardholderPromos 的既有排序）組字——
//   有 voucher_amount：「{promo_types[0]} NT$金額」；有 bonus_rate：「{promo_types[0]} 回饋率」；
//   否則「{promo_types[0]}」；沒有新戶活動（或沒有類型名稱）時用 applyCta.text
function setupCardDetailApply(card) {
    const applyCta = cardsData && cardsData.cardApplyCtas && cardsData.cardApplyCtas[card.id];
    const applyLink = applyCta ? sanitizeUrl(applyCta.link) : '';
    const headerBtn = document.getElementById('card-detail-apply-header-btn');
    const fab = document.getElementById('card-detail-apply-bar');
    const fabText = document.getElementById('card-detail-apply-bar-text');
    const fabBtn = document.getElementById('card-detail-apply-bar-btn');

    if (!applyLink) {
        _cdApply = null;
        if (headerBtn) { headerBtn.hidden = true; headerBtn.removeAttribute('href'); }
        if (fab) fab.hidden = true;
        if (fabBtn) fabBtn.removeAttribute('href');
        return;
    }
    _cdApply = { cardId: card.id, link: applyLink };

    if (headerBtn) {
        headerBtn.href = sanitizeUrl(applyLink);   // 掃描器逐行看，同一行要有 sanitizeUrl
        headerBtn.title = (applyCta && applyCta.text) || '';
        headerBtn.dataset.cardId = card.id;
        headerBtn.dataset.cardName = card.name;
    }
    if (fabBtn) {
        fabBtn.href = sanitizeUrl(applyLink);
        fabBtn.dataset.cardId = card.id;
        fabBtn.dataset.cardName = card.name;
    }
    if (fabText) {
        fabText.textContent = '';
        const promo = getActiveCardholderPromos(card.id)
            .find(p => Array.isArray(p.promo_types) && p.promo_types[0]);
        if (promo) {
            const type = String(promo.promo_types[0]);
            let emphasis = '';
            if (promo.voucher_amount) emphasis = `NT$${Math.round(Number(promo.voucher_amount)).toLocaleString()}`;
            else if (promo.bonus_rate != null && promo.bonus_rate !== '') emphasis = formatBonusRate(promo.bonus_rate);
            fabText.appendChild(document.createTextNode(type + (emphasis ? ' ' : '')));
            if (emphasis) {
                const b = document.createElement('b');
                b.textContent = emphasis;
                fabText.appendChild(b);
            }
        } else {
            fabText.textContent = (applyCta && applyCta.text) || '';
        }
        fabText.hidden = !fabText.textContent;
    }
    if (fab) fab.classList.remove('is-min');   // 每次開卡都從展開狀態開始
    refreshCardDetailApply();
}

// 持卡人（myOwnedCards 含這張卡）不顯示申辦；沒有連結的卡一律不顯示。
// 詳情頁開著時，loadMyOwnedCards 完成後（js/auth-user-data.js 兩處呼叫端）與
// 「我的信用卡」增刪卡後（pmc:mappings-data-changed 事件）都要重新判斷。
// 「新戶活動」頁籤本身不受影響（它是資訊，不是申辦鈕）。
function refreshCardDetailApply() {
    const headerBtn = document.getElementById('card-detail-apply-header-btn');
    const fab = document.getElementById('card-detail-apply-bar');
    const owned = !!(_cdApply && typeof myOwnedCards !== 'undefined' && myOwnedCards && myOwnedCards.has(_cdApply.cardId));
    const show = !!_cdApply && !owned;
    if (headerBtn) headerBtn.hidden = !show;
    if (fab) fab.hidden = !show;
    // 登入／登出（js/auth-user-data.js 的 onAuthStateChanged 兩個分支都會呼叫這裡）時，個人設定的
    // 儲存狀態列也要跟著從「只存在這台裝置」切成「已儲存到你的帳號」（反之亦然）
    cdSaveStatusRender();
}
document.addEventListener('pmc:mappings-data-changed', refreshCardDetailApply);

// ============================================================
// 個人設定：統一自動儲存＋常駐儲存狀態列（2026-11-17，三輪改版的第三輪）
// ============================================================
// 個人設定每一欄都是「改了就存」（級別／發卡組織／生日月份／童樂匯／免年費＝onchange；額度＝失焦或 Enter；
// 筆記＝停止輸入約 1 秒、離開輸入框、關閉詳情頁）。最上面一條狀態列（#cd-save-status）一直都在，
// 把「存好了沒」說清楚：已登入＝綠「已儲存到你的帳號」；訪客＝黃「只存在這台裝置…」＋「登入」連結；
// 任何一欄儲存時變灰「儲存中…」，成功後回到綠／黃並接上「・今天 HH:MM」；失敗＝紅，寫明原因。
// ⚠️ 狀態只反映「真正的儲存結果」：各欄既有的 save 函數回傳結果物件（見 js/levels-payments.js「儲存結果」），
//    cdTrackSave(key, promise) 等那個 promise 結案才換狀態；沒有任何「假裝成功」的計時器。
//    唯一的計時器是「儲存中…」至少顯示 CD_SAVE_MIN_BUSY_MS——訪客的本機儲存不到 1ms 就完成，不留一下的話
//    用戶永遠看不到「儲存中」那一格；結果仍是等真正結案後才顯示（失敗不會被吃掉）
// ⚠️ 錯誤依「欄位」記帳（key）：A 欄失敗後 B 欄成功，紅字不能被 B 的成功洗掉；同一欄之後存成功才清掉
const CD_SAVE_MIN_BUSY_MS = 350;
const CD_SAVE_LABELS = { level: '級別', issuer: '發卡組織', birthday: '生日月份', children: '童樂匯', fee: '免年費', credit: '額度', notes: '筆記' };
const _cdSv = { busy: 0, busySince: 0, errors: {}, volatile: {}, at: null, cardId: null, seq: 0 };

// 一列設定：標籤（左）／控制項（右）／說明小字（下一行）。標籤與控制項由呼叫端組好（已 escape 的 HTML）
function cdSettingRowHtml(labelHtml, controlHtml, subText) {
    return `<div class="cd-st-r"><div class="cd-st-l">${labelHtml}</div><div class="cd-st-c">${controlHtml}</div>` +
        (subText ? `<small class="cd-st-s">${escapeHtml(subText)}</small>` : '') + `</div>`;
}

function cdSaveTimeText(d) {
    const pad = n => String(n).padStart(2, '0');
    return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 依目前狀態重畫狀態列。狀態來源：busy（儲存中的筆數）→ errors（有欄位失敗）→ 登入與否
function cdSaveStatusRender() {
    const el = document.getElementById('cd-save-status');
    if (!el) return;
    const textEl = el.querySelector('.cd-sv-t');
    const loginBtn = el.querySelector('.cd-sv-login');
    const loggedIn = !!(typeof currentUser !== 'undefined' && currentUser);
    const errKeys = Object.keys(_cdSv.errors);
    const volKeys = Object.keys(_cdSv.volatile);
    const when = _cdSv.at ? `・${cdSaveTimeText(_cdSv.at)}` : '';
    let state, text, showLogin = false;
    if (_cdSv.busy > 0) {
        state = 'busy';
        text = '儲存中…';
    } else if (errKeys.length > 0) {
        // 多個欄位都失敗時顯示最近一個的原因，並註明還有幾項沒存成功
        const latest = errKeys.reduce((a, b) => (_cdSv.errors[b].seq > _cdSv.errors[a].seq ? b : a));
        const e = _cdSv.errors[latest];
        state = 'err';
        text = `儲存失敗（${CD_SAVE_LABELS[latest] || '設定'}）：${e.reason}。` + (e.local ? '已先存在這台裝置，請稍後再試。' : '請重試。') +
            (errKeys.length > 1 ? `另有 ${errKeys.length - 1} 項也沒存成功。` : '');
    } else if (volKeys.length > 0) {
        // 訪客且這項設定沒有本機備份（目前只有「童樂匯」）：照實說，不假裝存好了
        state = 'local';
        text = '這項設定只在這次瀏覽有效，登入後才會保存';
        showLogin = true;
    } else if (loggedIn) {
        state = 'ok';
        text = '已儲存到你的帳號' + when;
    } else {
        state = 'local';
        text = '只存在這台裝置。登入後會同步到帳號' + when;
        showLogin = true;
    }
    el.dataset.state = state;
    if (textEl) textEl.textContent = text;
    if (loginBtn) loginBtn.hidden = !showLogin;
}

// 換卡時清掉上一張卡的儲存記帳（錯誤、時間）；同一張卡重繪（級別切換）保留
function cdSaveStatusReset(cardId) {
    if (_cdSv.cardId !== cardId) {
        _cdSv.cardId = cardId;
        _cdSv.errors = {};
        _cdSv.volatile = {};
        _cdSv.at = null;
    }
    cdSaveStatusRender();
}

// 追蹤一次儲存：key＝欄位名，promise＝該欄既有 save 函數的回傳（結果物件）。
// 立刻切成「儲存中…」，真正結案後記帳（成功→清該欄錯誤、記時間；失敗→記原因），回傳原結果
function cdTrackSave(key, promise) {
    if (_cdSv.busy === 0) _cdSv.busySince = Date.now();
    _cdSv.busy++;
    cdSaveStatusRender();
    return Promise.resolve(promise)
        .then(r => r || { ok: true }, err => ({ ok: false, reason: describeSaveError(err), local: false }))
        .then(r => {
            const settle = () => {
                _cdSv.busy = Math.max(0, _cdSv.busy - 1);
                if (r.ok === false) {
                    _cdSv.errors[key] = { reason: r.reason || '儲存失敗', local: !!r.local, seq: ++_cdSv.seq };
                } else {
                    delete _cdSv.errors[key];
                    _cdSv.at = new Date();
                    if (r.volatile) _cdSv.volatile[key] = true; else delete _cdSv.volatile[key];
                }
                cdSaveStatusRender();
            };
            const wait = CD_SAVE_MIN_BUSY_MS - (Date.now() - _cdSv.busySince);
            if (wait > 0 && _cdSv.busy === 1) setTimeout(settle, wait); else settle();
            return r;
        });
}

// 筆記自動儲存：停止輸入約 1 秒存一次；離開輸入框、關閉詳情頁、換卡、分頁轉背景時立刻存一次。
// 待存內容（含卡片 id）記在 _cdNotesPending，不從輸入框現讀——換卡時輸入框已經換成另一張卡的內容
const CD_NOTES_DEBOUNCE_MS = 1000;
let _cdNotesPending = null;   // { cardId, text, timer }
function cdQueueNotesSave(cardId, text) {
    if (_cdNotesPending && _cdNotesPending.cardId !== cardId) cdFlushNotes();
    if (!_cdNotesPending) _cdNotesPending = { cardId, text, timer: 0 };
    _cdNotesPending.text = text;
    clearTimeout(_cdNotesPending.timer);
    _cdNotesPending.timer = setTimeout(cdFlushNotes, CD_NOTES_DEBOUNCE_MS);
}
function cdFlushNotes() {
    const p = _cdNotesPending;
    if (!p) return Promise.resolve(null);
    clearTimeout(p.timer);
    _cdNotesPending = null;
    if (!hasNotesChanged(p.cardId, p.text)) return Promise.resolve(null);   // 沒變（例如打了又改回原樣）就不存
    return cdTrackSave('notes', saveUserNotes(p.cardId, p.text));
}
// 分頁轉到背景（切分頁、鎖屏、關分頁）時把待存的筆記送出去（本機備份在每次輸入時就已經寫了）
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cdFlushNotes(); });
    // 「登入」連結：開既有的登入視窗
    const login = document.getElementById('cd-save-login');
    if (login) login.addEventListener('click', () => { if (typeof openAuthModal === 'function') openAuthModal('login'); });
});

// 摘要三格的前兩格。數字直接讀畫面上已經畫好的回饋卡（.cd-rate 的文字就是畫回饋卡時傳進
// planCardsHtml 的 getDisplayRate 結果，分級卡切換級別重畫後也跟著變）——不另寫一套算法，
// 摘要與回饋卡就不可能對不上（鐵則 5：placeholder 解析必傳 levelSettings 已在畫回饋卡的路徑內完成）。
//   最高回饋＝指定通路回饋區（目前有效的；即將開始的在另一區不算）所有列裡最大的顯示回饋率，
//            加上搬到一般回饋區的「特列項目」列（data-sl，以前就在指定通路區裡）；都沒有 → 「—」
//   一般消費＝一般回饋區「國內一般消費」那一列（data-role="basic"）的顯示回饋率
function readRateCardValue(el) {
    const text = (el.textContent || '').trim();
    return { text, num: parseFloat(text) };
}
function updateCardDetailFacts() {
    const maxEl = document.getElementById('card-fact-max');
    const basicEl = document.getElementById('card-fact-basic');
    if (maxEl) {
        let best = null;
        document.querySelectorAll('#card-special-cashback .cd-rr .cd-rate, #card-basic-cashback .cd-rr[data-sl] .cd-rate').forEach(el => {
            const v = readRateCardValue(el);
            if (Number.isFinite(v.num) && (best === null || v.num > best.num)) best = v;
        });
        maxEl.textContent = best ? best.text : '—';
    }
    if (basicEl) {
        const first = document.querySelector('#card-basic-cashback .cd-rr[data-role="basic"] .cd-rate');
        const v = first ? readRateCardValue(first) : null;
        basicEl.textContent = v && v.text ? v.text : '—';
    }
}

// 詳情頁摘要「年費」格的短版（2026-11-19）。Sheets 的 annualFee 是自由文字，但目前 34 張卡都是
// 「首年免年費，…NT$X…」或「(正卡)(年費)NT$X」兩種寫法。整理不了回 null，呼叫端顯示原文。
// 回傳 { main: 大字, sub: 小字（可為空字串） }
function summarizeAnnualFee(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const m = s.match(/NT\$\s*([\d,]+)/);
    const amount = m ? `NT$${m[1]}` : '';
    if (/^首年免年費/.test(s)) return { main: '首年免', sub: amount ? `次年 ${amount}` : '' };
    if (/^(終身)?免年費/.test(s) && !amount) return { main: '免年費', sub: '' };
    if (amount && /^(正卡)?(年費)?\s*NT\$/.test(s)) return { main: amount, sub: '每年' };
    return null;
}

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

    // 重置詳情頁搜尋框（含上一張卡搜尋時收起的區，不還原的話換卡後那幾區會一直藏著）
    const cashbackSearchInput = document.getElementById('cashback-search-input');
    if (cashbackSearchInput) cashbackSearchInput.value = '';
    const cashbackSearchEmpty = document.getElementById('cashback-search-empty');
    if (cashbackSearchEmpty) cashbackSearchEmpty.style.display = 'none';
    const cashbackSearchHint = document.getElementById('cashback-search-hint');
    if (cashbackSearchHint) cashbackSearchHint.hidden = true;
    DETAIL_SEARCH_SECTIONS.forEach(([, sectionId]) => {
        const section = document.getElementById(sectionId);
        if (section && section._searchHidden) { section.style.display = ''; section._searchHidden = false; }
    });

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

    // 申辦：桌機頁首亮黃鈕（#card-detail-apply-header-btn）＋手機浮動膠囊（#card-detail-apply-bar），
    // 兩者共用同一份 applyCta 資料。
    // 每次呼叫都要明確重設——上一張卡有 CTA、這張沒有時不能沿用舊狀態。
    // 持卡人（myOwnedCards 含這張卡）兩者都不顯示：預設先顯示，loadMyOwnedCards 完成後與
    // 「我的信用卡」增刪卡後由 refreshCardDetailApply() 重新判斷（見該函數）。
    setupCardDetailApply(card);

    // 卡圖（assets/images/cards/<card.id>.png）：缺圖自動隱藏
    const headerImg = document.getElementById('card-detail-image');
    if (headerImg) {
        headerImg.hidden = false;
        headerImg.onerror = () => { headerImg.hidden = true; };
        headerImg.src = `assets/images/cards/${card.id}.png`;
    }

    // 銀行名稱＝Cards Data 的 fullName
    const fullNameLink = document.getElementById('card-full-name-link');
    fullNameLink.textContent = card.fullName || card.name;

    // 信用卡官網連結（回饋類型那行旁的「信用卡官網 ↗」）：沒有合法網址就藏起來並清掉 href，
    // 免得上一張卡的連結沿用到這張
    const officialSiteLink = document.getElementById('card-official-site-link');
    if (officialSiteLink) {
        if (sanitizeUrl(card.website)) {
            officialSiteLink.href = sanitizeUrl(card.website);
            officialSiteLink.dataset.cardId = card.id;
            officialSiteLink.dataset.cardName = card.name;
            officialSiteLink.hidden = false;
        } else {
            officialSiteLink.removeAttribute('href');
            officialSiteLink.hidden = true;
        }
    }

    // 卡片標籤：詳情頁先不顯示（2026-10-14 站長要求；程式先留著，見 renderCardTags）。
    // 2026-11-17 改版後摘要區沒有 .info-grid-2col 可以掛，插入點不存在就整段略過
    const cardInfoSection = modal.querySelector('#card-basic-info-section');
    if (cardInfoSection) {
        const existingTags = cardInfoSection.querySelector('.card-tags-container');
        if (existingTags) existingTags.remove();
        if (card.tags && card.tags.length > 0) {
            const infoGrid = cardInfoSection.querySelector('.cd-facts');
            if (infoGrid) infoGrid.insertAdjacentHTML('afterend', renderCardTags(card.tags));
        }
    }

    // 年費（2026-11-19 改短版）：annualFee 整理得了就顯示「大字＋一行小字」（首年免／次年 NT$X、NT$X／每年），
    // 整理不了就照舊顯示原文小字——寧可長一點，也不要顯示錯的數字。完整原文放在 title。
    // 免年費條件（feeWaiver 原文）與「我已過免年費門檻」勾選在個人設定（#card-fee-waiver／#fee-waiver-checked）
    const annualFeeEl = document.getElementById('card-annual-fee');
    const feeShort = summarizeAnnualFee(card.annualFee);
    annualFeeEl.textContent = '';
    annualFeeEl.classList.toggle('is-raw', !feeShort);
    if (feeShort) {
        const feeMain = document.createElement('span');
        feeMain.className = feeShort.main.startsWith('NT$') ? 'cd-fee-main is-amount' : 'cd-fee-main';
        feeMain.textContent = feeShort.main;
        annualFeeEl.appendChild(feeMain);
        if (feeShort.sub) {
            const feeSub = document.createElement('small');
            feeSub.className = 'cd-fee-sub';
            feeSub.textContent = feeShort.sub;
            annualFeeEl.appendChild(feeSub);
        }
    } else {
        annualFeeEl.textContent = card.annualFee || '無資料';
    }
    annualFeeEl.title = card.annualFee || '';
    document.getElementById('card-fee-waiver').textContent = card.feeWaiver || '';

    // 回饋類型＋點數效期（摘要裡的一行小字）；沒資料就整行文字不出現
    const cashbackTypeSpan = document.getElementById('card-cashback-type');
    const typeParts = [];
    if (card.basicCashbackType) typeParts.push(card.basicCashbackType);
    if (card.pointsExpiry) typeParts.push(card.pointsExpiry);
    cashbackTypeSpan.textContent = typeParts.join('｜');

    // 一般回饋區：先不畫——「一般回饋特列項目」這類組別在下面各條指定通路路徑裡才分得出來，
    // 它們要併進這一區的「國內一般消費」卡（見 splitGeneralListEntries），所以等指定通路算完再畫
    const generalExtra = [];
    
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
                    // 「固定回饋」這種 onlySlots 級別沒有 specialRate，回饋率寫在它認領的槽裡
                    if (Array.isArray(data.onlySlots)) {
                        levelRatesInfo += `<div class="level-help-rate-line">• ${escapeHtml(level)}: 固定回饋率，不適用其他切換方案</div>`;
                        return;
                    }
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

        // 個人設定「計算條件」組（2026-11-17 第三輪）：一欄一列——標籤左、控制項右（下拉 36px 高、132px 寬靠右），
        // 說明小字在下一行；整組一個白底灰框盒子（.cd-set-box，樣式見 styles.css「個人設定」）。
        // 級別的「i」說明窗按鈕跟在標籤後面。⚠️ 動態內容一律 escapeHtml（鐵則 3）
        const lvOptions = levelNames.map(level =>
            `<option value="${escapeHtml(level)}" ${level === savedLevel ? 'selected' : ''}>${escapeHtml(level)}</option>`
        ).join('');
        const rows = [cdSettingRowHtml(
            `<label for="card-level-select">選擇級別</label>${levelHelpHtml}`,
            `<select id="card-level-select" class="cd-st-sel">${lvOptions}</select>`
        )];

        if (card.id === 'cathay-cube') {
            rows.push(cdSettingRowHtml(
                '<label for="cube-issuer-select">發卡組織</label>',
                `<select id="cube-issuer-select" class="cd-st-sel">${['Visa', 'Mastercard', 'JCB'].map(issuer =>
                    `<option value="${issuer}" ${issuer === cubeIssuer ? 'selected' : ''}>${issuer}</option>`
                ).join('')}</select>`
            ));
            // 生日月份：已登入才能設定。訪客仍擺一個 disabled 的下拉（「登入後即可設定」），
            // 一眼就知道「這裡本來可以選，但要先登入」，不會誤以為只是說明文字
            if (currentUser) {
                const monthOptions = '<option value="">未設定</option>' +
                    Array.from({length: 12}, (_, i) => {
                        const m = i + 1;
                        return `<option value="${m}" ${userBirthdayMonth === m ? 'selected' : ''}>${m} 月</option>`;
                    }).join('');
                rows.push(cdSettingRowHtml(
                    '<label for="birthday-month-select">我的生日月份</label>',
                    `<select id="birthday-month-select" class="cd-st-sel">${monthOptions}</select>`,
                    '設定後，「慶生月」只在你的生日月份納入比較'
                ));
            } else {
                rows.push(cdSettingRowHtml(
                    '<label for="birthday-month-guest">我的生日月份</label>',
                    '<select id="birthday-month-guest" class="cd-st-sel" disabled><option>需先登入</option></select>',
                    '登入並設定後，「慶生月」只在你的生日月份納入比較'
                ));
            }
            rows.push(cdSettingRowHtml(
                '<label for="children-eligible-checkbox">我符合「童樂匯」權益</label>',
                `<input type="checkbox" role="switch" class="cd-sw" id="children-eligible-checkbox" ${isChildrenEligible ? 'checked' : ''}>`,
                '開啟後才會在比較結果納入「童樂匯」方案的活動'
            ));
        }

        const levelSelectorHTML =
            '<div class="cd-set-sec"><h5 class="cd-set-sec-t">計算條件</h5><span class="cd-set-sec-s">會改變這張卡的回饋數字</span></div>' +
            `<div class="cd-set-box">${rows.join('')}</div>`;

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

            // 🔒 鐵則 1：saveCardLevel 的合法呼叫點只有這裡（用戶親自改級別下拉）。
            // 先發出儲存、交給儲存狀態列追蹤真正的結果（cdTrackSave），再重繪
            const levelSaving = saveCardLevel(card.id, this.value);
            await cdTrackSave('level', levelSaving);
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
                await cdTrackSave('birthday', saveBirthdayMonth(val ? parseInt(val) : null));
            };
        }

        // 童樂匯勾選框事件（影響搜尋配對；不影響 modal 顯示，所以不需要重新渲染）
        const childrenCheckbox = document.getElementById('children-eligible-checkbox');
        if (childrenCheckbox) {
            childrenCheckbox.onchange = async function() {
                await cdTrackSave('children', saveChildrenEligible(this.checked));
                updateCardCalcConditions(card);   // 「計算條件」列的「童樂匯」標籤
            };
        }

        // 發卡組織選擇事件（影響搜尋配對；不影響 modal 顯示，所以不需要重新渲染）
        const cubeIssuerSelect = document.getElementById('cube-issuer-select');
        if (cubeIssuerSelect) {
            cubeIssuerSelect.onchange = async function() {
                await cdTrackSave('issuer', saveCubeIssuer(this.value));
                updateCardCalcConditions(card);   // 「計算條件」列的發卡組織標籤
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
    // 2026-11-17 起「同方案一張卡」：下面各條路徑只負責把每個回饋組整理成一筆 entry（一列回饋：
    // 回饋率、上限、期間、通路、條件…），標題／上限／期間都相同的 entry 由 planCardsHtml() 併進同一張卡，
    // 卡片與卡內各列都照回饋率由高到低排（見 renderPlanCard 上方說明）
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    let specialHtml = '';

    if (card.hasLevels && card.id === 'cathay-cube') {
        const cube = await generateCubeSpecialContent(card);
        specialHtml = cube.html;
        generalExtra.push(...cube.general);
    } else if (card.hasLevels && card.specialItems && card.specialItems.length > 0) {
        // Handle generic level-based cards with specialItems (like Uni card and DBS Eco)
        const levelNames = Object.keys(card.levelSettings);
        const { level: lvName, data: levelData } = await resolveCardLevel(card, levelNames[0]);
        const entries = [];

        // First, display any cashbackRates if they exist (like DBS Eco's 10% cashback)
        // 2026-07-09 起逐筆顯示（不再按 rate+cap 合併）；2026-11-17 起標題／上限／期間相同的併成一張卡
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            const rendered = await renderCashbackRatesIndividually(card, levelData, { idPrefix: 'lvA', levelName: lvName });
            entries.push(...rendered.entries);

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups1 = rendered.upcoming;
            window._currentCard = card;
            window._currentLevelData1 = levelData;
        }

        // Then display the level-based cashback with specialItems
        // （通路多，由 .cd-ch 依寬度收成最多三行，其餘收在「顯示全部」）
        entries.push({
            rate: levelData.rate,
            levelLabel: cdLevelLabel(card, lvName),
            capText: formatRateCardCap(levelData.cap),
            merchants: { items: card.specialItems },
            conditions: levelData.condition
        });
        const composed = composeSpecialArea(entries);
        specialHtml = composed.html;
        generalExtra.push(...composed.general);
    } else if (card.hasLevels && (!card.specialItems || card.specialItems.length === 0)) {
        // Handle level-based cards without specialItems (or with empty specialItems array)
        const levelNames = Object.keys(card.levelSettings);
        const { level: savedLevel, data: levelData } = await resolveCardLevel(card, levelNames[0]);
        const entries = [];

        // Check if card also has cashbackRates (like DBS Eco card)
        if (card.cashbackRates && card.cashbackRates.length > 0) {
            // 2026-07-09 起逐筆顯示（不再按 rate+cap 合併），回饋率為 getDisplayRate 加總值；
            // cap 留空＝無上限（需要級別 cap 的槽明確填 {cap}；capFallbackToLevel 舊行為已於 2026-07-17 移除）
            const rendered = await renderCashbackRatesIndividually(card, levelData, { idPrefix: 'lvB', levelName: savedLevel });
            entries.push(...rendered.entries);

            // Store upcoming groups for later display in separate section
            window._currentUpcomingGroups2 = rendered.upcoming;
            window._currentCard = card;
            window._currentLevelData2 = levelData;

            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here
        } else {
            // Original logic for cards without cashbackRates
            // Note: "各級別回饋率" is now displayed next to the level selector, no need to repeat here
            entries.push({
                rate: levelData.rate,
                levelLabel: cdLevelLabel(card, savedLevel),
                capText: formatRateCardCap(levelData.cap)
            });
        }
        const composed = composeSpecialArea(entries);
        specialHtml = composed.html;
        generalExtra.push(...composed.general);
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

        const entries = [];
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

            entries.push({
                rate: displayRate,
                // stacking 模型加上「回饋組成」按鈕，解釋加總的來源
                rateBtnHtml: rateCompositionButtonHtml(card, rate, parsedRate, parsedCap, null),
                capText,
                title: rate.category,
                endingSoonEnd: rate.periodEnd,
                // 滿額門檻；maxSpend（未滿門檻）只影響匹配、不顯示標註（2026-07-17 用戶定案）
                minSpend: rate.minSpend,
                merchants: { items },
                period: rate.period,
                conditions: rate.conditions,
                // 銀行官方登錄連結（有 registerLink 才長出來；conditions 空的組別一樣要能顯示）
                registerLink: rate.registerLink
            });
        }
        const composed = composeSpecialArea(entries);
        specialHtml = composed.html;
        generalExtra.push(...composed.general);
    } else {
        specialHtml = '<div class="cashback-detail-item">無指定通路回饋</div>';
    }

    specialCashbackDiv.innerHTML = specialHtml;

    // 一般回饋區（國內一般消費等，加上從指定通路搬過來的「一般回饋特列項目」）
    await renderBasicArea(card, generalExtra);

    // Update upcoming cashback section
    const upcomingSection = document.getElementById('card-upcoming-section');
    const upcomingCashbackDiv = document.getElementById('card-upcoming-cashback');
    const upcomingGroups = window._currentUpcomingGroups1 || window._currentUpcomingGroups2 || window._currentUpcomingGroupsCube || window._currentUpcomingGroups3 || [];

    if (upcomingGroups.length > 0) {
        // upcomingGroups1/2 are [key, value] tuples from Map.entries();
        // upcomingGroups3/Cube are plain object arrays. Normalize both to [key, value].
        const groupsToDisplay = upcomingGroups.map((g, i) => Array.isArray(g) ? g : [i, g]);

        // 版面與進行中的活動一致（即將開始只差標題旁的徽章）；同標題／上限／期間的併成一張卡。
        // 條件逐條用可收合的條件列（CUBE 合併後可能有好幾條）；玉山 Uni Card 原本另有
        // 「▼ 查看各通路詳細條件」收合鈕，2026-10-05 統一改由條件列自己的「展開」處理過長內容
        const upcomingEntries = groupsToDisplay.map(([, group]) => ({
            rate: group.parsedRate,
            capText: formatRateCardCap(group.parsedCap),
            title: group.category,
            upcomingStart: group.periodStart,
            merchants: { items: group.items || [] },
            period: group.period,
            conditions: (group.conditions || []).map(c => c.conditions),
            extraClass: 'upcoming-activity'
        }));

        upcomingCashbackDiv.innerHTML = planCardsHtml(upcomingEntries);
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
        for (const coupon of card.couponCashbacks) {
            const actualRate = await calculateCouponRate(coupon, card);
            const couponStatus = getRateStatus(coupon.periodStart, coupon.periodEnd);

            // 適用通路（逗號分隔字串）
            const merchantItems = coupon.merchant
                ? coupon.merchant.split(',').map(m => m.trim()).filter(m => m)
                : [];

            // 領券區每筆仍是一張卡（不併），只換成同方案卡的樣式：標題＝商家名（只有一個商家時）
            // ＋「需領券」小標，其餘比照指定通路回饋
            couponContent += planCardsHtml([{
                rate: actualRate,
                capText: formatRateCardCap(coupon.cap),
                title: merchantItems.length === 1 ? merchantItems[0] : '',
                titleIsDisplay: true,
                tagText: '需領券',
                upcomingStart: (couponStatus === 'upcoming' && coupon.periodStart) ? coupon.periodStart : null,
                endingSoonEnd: (couponStatus === 'active' || couponStatus === 'always') ? coupon.periodEnd : null,
                merchants: { items: merchantItems },
                period: coupon.period,
                conditions: coupon.conditions
            }], { sort: false });
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

    // Load and setup user notes（2026-11-17 起自動儲存：停止輸入約 1 秒存、離開輸入框存、關閉詳情頁存；
    // 沒有儲存鈕了，結果由個人設定最上面的儲存狀態列表達——見 cdTrackSave／cdFlushNotes）
    cdFlushNotes();   // 上一張卡還沒送出的筆記先存（輸入框馬上要換成這張卡的內容）
    currentNotesCardId = card.id;
    const notesTextarea = document.getElementById('user-notes-input');

    // 讀取當前筆記
    loadUserNotes(card.id).then(notes => {
        notesTextarea.value = notes;
    });

    // 設置輸入監聽：先備份到本機（每個字都寫，維持既有行為），再排自動儲存
    notesTextarea.oninput = (e) => {
        const notes = e.target.value;
        autoBackupNotes(card.id, notes);
        cdQueueNotesSave(card.id, notes);
    };
    notesTextarea.onblur = () => { cdFlushNotes(); };

    // 個人設定的儲存狀態列：換卡清掉上一張卡的記帳，重繪同一張卡（級別切換）保留
    cdSaveStatusReset(card.id);

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
    // 重繪的是同一張卡（級別切換）→ 留在原本的頁籤與捲動位置；開新卡／換卡 → 回到「回饋」頁籤最上面
    const keepView = wasAlreadyOpen && _cdCurrentCardId === card.id;
    _cdCurrentCardId = card.id;
    modal.style.display = 'flex';
    if (!wasAlreadyOpen) {
        disableBodyScroll();
        // 手機返回鍵：開啟時 push 一筆歷史，popstate 時關閉（寫法照 js/mappings-page.js）。
        // embed 模式（新戶活動頁的 iframe）不 push——iframe 的歷史會和父頁串在一起，返回鍵該收的是外層 overlay。
        // 網址不變（push 同一個 href）：疊在配卡組合頁（/mappings）上面開啟時，那邊的 popstate
        // 看到路徑沒變就不會動；?card= 深連結也一樣，按返回只是收掉詳情頁、不離開網站
        _cdExpectPop = false;
        if (!isEmbedMode) {
            try { history.pushState({ cardDetail: true }, '', location.href); _cdPushed = true; } catch (e) { _cdPushed = false; }
        }
    }

    // 捲動容器是 #card-detail-scroll（.card-detail-content），不記憶上一張卡的捲動位置
    const modalContent = document.getElementById('card-detail-scroll');
    if (modalContent && !keepView) modalContent.scrollTop = 0;

    // Wire the tabs（筆數、沒內容的頁籤隱藏、預設落在「回饋」）。
    // 先畫完整內容、可見後再量：頁籤列依各區 DOM 判斷有沒有內容，不依賴版面尺寸
    setupCardDetailNav(modalContent, { keepTab: keepView });

    // 摘要三格（最高回饋／一般消費）：取自上面畫回饋卡時用的同一份顯示回饋率
    updateCardDetailFacts();

    // 「計算條件」列（分級卡才有）：讀剛畫好的個人設定欄位
    updateCardCalcConditions(card);

    // 先畫完整內容、modal 顯示後才量：適用通路收成最多三行、條件一行省略（超出才長「展開」）。
    // 沒顯示的頁籤（display:none）量到的寬度是 0，那時保留完整內容；切到那個頁籤（selectCardDetailTab）、
    // 視窗寬度改變、字型載入完成時由 cdFitAll 重收（見 setupCardDetailFit）
    setupCardDetailFit();
    cdFitAllContainers();

    // Setup close events
    const closeBtn = document.getElementById('close-card-detail');
    const closeModal = (closeOpts = {}) => {
        if (modal.style.display === 'none') return;   // 關閉鈕與 popstate 可能各來一次，只收一次
        cdFlushNotes();   // 打完字立刻關閉：還沒送出的筆記先存（見 cdQueueNotesSave）
        modal.style.display = 'none';
        enableBodyScroll();
        currentNotesCardId = null;
        _cdCurrentCardId = null;
        // Embed 模式：關閉路徑統一在這裡告知父頁（promos.js）modal 已關閉，讓外層 overlay 跟著收起——
        // iframe 常駐不銷毀，這裡只是隱藏 modal 內容，下次換卡不用重新載入。
        if (isEmbedMode) {
            try {
                parent.postMessage({ type: 'pmc-detail-closed' }, location.origin);
            } catch (e) {
                console.error('❌ pmc-detail-closed postMessage 失敗:', e);
            }
        }
        // 這次開啟有 push 過歷史：按返回箭頭關閉時要把那一筆退掉（history.back），否則返回鍵還要多按一次；
        // 由 popstate 觸發的關閉（fromHistory）歷史已經退過了
        if (_cdPushed) {
            _cdPushed = false;
            if (!closeOpts.fromHistory) {
                _cdExpectPop = true;
                history.back();
            }
        }
    };
    _cdClose = closeModal;

    closeBtn.onclick = () => closeModal();
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
            if (status === 'upcoming' && isUpcomingWithinDays(rate.periodStart, 30) &&
                isRateGroupInLevel(card, rate, levelSettings)) {   // 級別專屬槽位（onlySlots）
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

    // CUBE「慶生月」註記（2026-11-17 起放在慶生月那張卡裡、標題下一行灰字；原本在整區最上面）。
    // 文字隨登入／生日月份狀態變，kind='bday' 是「本月是生日月」那句（粉紅），其餘灰字
    let birthdayNote;
    if (!currentUser) {
        birthdayNote = { text: '※ 「慶生月」方案：目前一律納入比較；登入並設定生日月份後，只在您的生日月份納入' };
    } else if (!userBirthdayMonth) {
        birthdayNote = { text: '※ 「慶生月」方案：目前一律納入比較；在上方設定生日月份後，只在您的生日月份納入' };
    } else if (isBirthdayMonth) {
        birthdayNote = { text: `🎂 本月是您的生日月份（${userBirthdayMonth}月），「慶生月」方案已自動納入比較！`, kind: 'bday' };
    } else {
        birthdayNote = { text: `※ 「慶生月」方案：已設定只在您的生日月份（${userBirthdayMonth}月）納入比較，本月不納入` };
    }

    // 全部活動（含隨級別變動的玩數位／樂饗購／趣旅行）都在下面同一段整理。
    // {specialRate} 由 parseCashbackRate 依目前級別解析；切換級別時 updateCubeSpecialCashback
    // 會重畫整區，所以數字照樣跟著級別走。2026-10-07 前另有一段把這三個方案合併後排最前面，
    // 但下面這段沒排除它們，三個方案各出現兩次（且合併版沒有條件/登錄連結），故移除。
    // 童樂匯也一樣走下面（原本寫死比對 rate === 10/5，資料改成 9.7%+0.3% 後整組消失）。

    const entries = [];

    // 所有 cashbackRates，只顯示進行中的
    if (card.cashbackRates && card.cashbackRates.length > 0) {
        const otherRates = card.cashbackRates
            .filter(rate => {
                const status = getRateStatus(rate.periodStart, rate.periodEnd);
                return !rate.hideInDisplay &&
                    isRateGroupInLevel(card, rate, levelSettings) &&  // 級別專屬槽位（onlySlots）
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

        // 同回饋率＋同類別＋同期間＋同上限的槽合併成「一列」（通路與條件串在一起）——這是 2026-10 就有的
        // 列內合併（例：兩筆「樂饗購」同率同期間）。上限也放進 key：不同上限的槽不能共用第一筆的上限。
        // 列與列再依「標題＋上限＋期間」併成同一張卡，由 planCardsHtml 負責
        const mergedActiveRates = new Map();
        for (const rate of otherRates) {
            const designatedRate = await parseCashbackRate(rate.rate, card, levelSettings);
            const parsedRate = getDisplayRate(card, rate, designatedRate, levelSettings);
            const parsedCap = parseCashbackCap(rate.cap, card, levelSettings);

            // Create merge key: rate + category + period + cap
            const mergeKey = `${parsedRate}-${rate.category || 'no-category'}-${rate.period || 'no-period'}-${parsedCap || 'no-cap'}`;

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
                // 登錄連結：留先遇到的那一個，不串接（同一個活動的不同槽位不該有兩個登錄頁；
                // 真的出現時以先遇到的為準，其餘在 Cards Data 裡就該修掉）
                if (!existing.registerLink && rate.registerLink) {
                    existing.registerLink = rate.registerLink;
                }
            } else {
                // First time seeing this rate+category+period combination
                mergedActiveRates.set(mergeKey, {
                    parsedRate,
                    // 回饋率旁的「(分級: Level 3)」：只有回饋率由級別決定的槽（rate 寫 {specialRate} 之類）才標
                    levelLabel: cdRateUsesLevel(rate) ? cdLevelLabel(card, savedLevel) : '',
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

        for (const mergedRate of mergedActiveRates.values()) {
            entries.push({
                rate: mergedRate.parsedRate,
                rateBtnHtml: mergedRate.rateBtnHtml,
                levelLabel: mergedRate.levelLabel,
                capText: formatRateCardCap(mergedRate.parsedCap),
                title: mergedRate.category,
                endingSoonEnd: mergedRate.periodEnd,
                merchants: { items: mergedRate.items || [] },
                period: mergedRate.period,
                conditions: mergedRate.conditions,
                registerLink: mergedRate.registerLink
            });
        }
    }

    let noteUsed = false;
    return composeSpecialArea(entries, {
        noteFor: (g) => {
            if (noteUsed || !/慶生月/.test(g.title || '')) return null;
            noteUsed = true;
            return birthdayNote;
        }
    });
}

// Update CUBE special cashback when level changes
async function updateCubeSpecialCashback(card) {
    const specialCashbackDiv = document.getElementById('card-special-cashback');
    const cube = await generateCubeSpecialContent(card);
    specialCashbackDiv.innerHTML = cube.html;
    // 「一般回饋特列項目」搬在一般回饋區，它的回饋率也隨級別變，所以那一區一起重畫
    await renderBasicArea(card, cube.general);
    // generateCubeSpecialContent 會留下「即將開始」暫存（只給 showCardDetail 讀）；這裡不用，清掉免得漏到下一張卡
    delete window._currentUpcomingGroupsCube;
    delete window._currentCard;
    // 先畫完整內容、再量（通路收三行、條件一行省略）
    cdFitAllContainers();
    // 計算條件列、摘要的「最高回饋」與頁籤筆數跟著級別走（讀剛畫好的回饋卡）
    updateCardCalcConditions(card);
    updateCardDetailFacts();
    if (typeof refreshCardDetailTabs === 'function') refreshCardDetailTabs();
}

// ============================================================
// 詳情頁回饋卡：同方案一張卡（2026-11-17，三輪改版的第二輪）
// ============================================================
// 以前每個回饋組（cashbackRates 一筆）各一張卡，CUBE 指定通路 19 張、同一個方案（秋日遊 5 張、
// 慶生月 3 張…）被拆散、每張重寫一次上限與期間。現在各條 render 路徑只把每個回饋組整理成一筆
// entry（＝卡裡的一列），由 planCardsHtml() 併卡：
//   - 併卡鍵＝「標題、回饋消費上限、活動期間」（再加徽章用的開始／結束日、extraClass、tagText）。
//     三者任一不同就各自一張——絕不能把一筆的上限或期間寫成別人的
//   - 卡片依「卡內最高顯示回饋率」由高到低，同分維持原順序；卡內各列也由高到低（Array.sort 穩定）
//   - 領券區每筆仍一張卡（呼叫端各自 planCardsHtml([entry])），只換樣式
//   - 一般消費排除卡（renderBasicExclusionsCard）不走這裡，維持灰色獨立一張
// 長相照搜尋結果卡的字級顏色（docs/project/ui-display.md 1h／1n）：
//   標題（「切換「X」方案」→「X」＋灰小標「需切換方案」；徽章放標題旁）
//   → 兩格「回饋消費上限｜活動期間」→（CUBE 慶生月註記）→ 每個回饋率一列：
//   左欄 24px 回饋率＋計算機鈕＋「(分級: Level 3)」，右欄 適用通路／條件／登錄連結
// ⚠️ 適用通路「最多三行、顯示全部算在三行內」與條件「一行省略」都要量寬度：先畫完整內容，元素可見
//    且量得到寬度後才收（cdFitAll）。詳情頁打開前是 display:none、沒選中的頁籤也是 display:none，
//    那時量到 0 ——保留完整內容（CSS 的 max-height 先夾住三行，不會畫成空白）
// ⚠️ 詳情頁所有回饋卡（一般、指定通路、即將開始、領券、CUBE）都走這一支；要加欄位改這裡，
//    不要在個別呼叫端拼 HTML。改完跑 node tools/regression/card-detail-test.js

const CD_CHEV_SVG = '<svg class="cd-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

// 回饋率由級別決定的槽（rate 寫 {specialRate}／{rate} 之類的 placeholder）才在回饋率下標「(分級: Level 3)」；
// 固定數字的槽不隨級別變，標了反而誤導
function cdRateUsesLevel(rate) {
    return !!rate && typeof rate.rate === 'string' && rate.rate.indexOf('{') >= 0;
}

// 「(分級: Level 3)」：格式取自該卡的 levelLabelFormat（與搜尋結果同一份），以 {level} 為界切兩段各自不折行
function cdLevelLabel(card, level) {
    if (!card || !card.hasLevels || !card.levelLabelFormat || !level) return '';
    const fmt = card.levelLabelFormat;
    const at = fmt.indexOf('{level}');
    if (at < 0) return '';
    const head = fmt.slice(0, at);
    const tail = fmt.slice(at + '{level}'.length);
    return [`(${head.trimEnd()}`, `${level}${tail})`]
        .map(seg => `<span class="level-label-seg">${escapeHtml(seg)}</span>`)
        .join(head.endsWith(' ') ? ' ' : '');
}

// 「一般回饋特列項目」「國外消費特列項目」是基本回饋的特例清單（回饋率＝一般回饋，不是指定通路活動），
// 站長核定的版面把它們放在「一般回饋」區：上限無上限、沒有期間時併進「國內／海外一般消費」那張卡
// （右欄上方標原類別名）；上限或期間不同就在一般回饋區自己一張。
// （「一般消費特列項目」是玉山 Uni Card 手填的同義寫法；前兩個是 apps-script/card-benefits-parser.gs 產出的）
const CD_GENERAL_LIST = { '一般回饋特列項目': '國內一般消費', '一般消費特列項目': '國內一般消費', '國外消費特列項目': '海外一般消費' };

function splitGeneralListEntries(entries) {
    const special = [];
    const general = [];
    entries.forEach(e => {
        if (e.title && CD_GENERAL_LIST[e.title]) general.push({ ...e, specialList: true });
        else special.push(e);
    });
    return { special, general };
}

// 指定通路區：整理成 { html, general }。general＝要搬去一般回饋區的列；沒有任何指定通路時給一句說明
function composeSpecialArea(entries, opts = {}) {
    const { special, general } = splitGeneralListEntries(entries);
    let html = planCardsHtml(special, opts);
    if (!html) html = '<div class="cashback-detail-item">無指定通路回饋</div>';
    return { html, general };
}

// 一般回饋區的基底列：國內／海外一般消費、國內／海外加碼
async function buildBasicEntries(card) {
    const entries = [{
        rate: card.basicCashback,
        capText: '無上限',
        title: '國內一般消費',
        titleIsDisplay: true,
        conditions: card.basicConditions,
        role: 'basic'
    }];

    if (card.overseasCashback) {
        entries.push({
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
        entries.push({
            rate: domesticBonusRate,
            ratePrefix: '+',
            capText: formatRateCardCap(domesticBonusCap),
            title: '國內加碼',
            titleIsDisplay: true,
            conditions: domesticConditions
        });
    }

    if (overseasBonusRate) {
        entries.push({
            rate: overseasBonusRate,
            ratePrefix: '+',
            capText: formatRateCardCap(overseasBonusCap),
            title: '海外加碼',
            titleIsDisplay: true,
            conditions: overseasConditions
        });
    }
    return entries;
}

// 把從指定通路搬來的特列項目接到基底列後面：無上限＋沒期間＋基底卡存在 → 併進基底卡（標原類別名）；否則自己一張
function mergeGeneralListEntries(base, extra) {
    const out = base.slice();
    extra.forEach(e => {
        const baseTitle = CD_GENERAL_LIST[e.title];
        const plain = (e.capText || '無上限') === '無上限' && !e.period && !e.upcomingStart && !e.endingSoonEnd;
        if (plain && base.some(b => b.title === baseTitle)) {
            out.push({ ...e, title: baseTitle, titleIsDisplay: true, sub: e.title });
        } else {
            out.push({ ...e, titleIsDisplay: false });
        }
    });
    return out;
}

// 畫一般回饋區（#card-basic-cashback）：基底列＋搬來的特列項目。灰色的「一般消費排除項目」卡
// 2026-11-22 起放在下一區「一般回饋排除項目」（#card-basic-exclusions），沒有名單時整區不顯示。
// 一般回饋區的卡片維持固定順序（國內一般消費、海外一般消費、國內加碼、海外加碼），不依回饋率重排
async function renderBasicArea(card, extra = []) {
    const div = document.getElementById('card-basic-cashback');
    if (!div) return;
    const entries = mergeGeneralListEntries(await buildBasicEntries(card), extra);
    div.innerHTML = planCardsHtml(entries, { sort: false });
    // 一般消費排除項目（2026-10-11 站長要求；2026-11-22 改成獨立一區）：灰色，只列項目
    const exDiv = document.getElementById('card-basic-exclusions');
    const exSection = document.getElementById('card-basic-exclusions-section');
    if (exDiv && exSection) {
        const exHtml = renderBasicExclusionsCard(card);
        exDiv.innerHTML = exHtml;
        exSection.style.display = exHtml ? '' : 'none';
    }
}

// entries → 同方案卡的 HTML。entry 欄位：
//   rate（數字或字串，不含 %）、ratePrefix（加碼用 '+'）、rateBtnHtml（回饋組成按鈕）、levelLabel（已 escape 的 HTML）、
//   capText（已格式化，如 'NT$7,500'／'無上限'）、title（category 原文，內部轉顯示名稱並 escape）、titleIsDisplay、
//   tagText（標題旁灰小標，如「需領券」）、upcomingStart（即將開始的 periodStart）、endingSoonEnd（進行中活動的 periodEnd）、
//   minSpend、merchants（{ items }）、merchantsLabel、period、conditions（字串或字串陣列）、registerLink、
//   sub（列內第一行小字，如特列項目的原類別名）、role（'basic'＝國內一般消費那一列，摘要「一般消費」讀它）、
//   specialList（從指定通路搬來的特列項目，摘要「最高回饋」仍把它算進去）、extraClass
// opts.sort=false → 卡片維持輸入順序（列仍由高到低）；opts.noteFor(group) → 該卡標題下的灰字註記 { text, kind }
function planCardsHtml(entries, opts = {}) {
    const groups = [];
    const byKey = new Map();
    for (const o of entries) {
        const title = o.title ? (o.titleIsDisplay ? o.title : getCategoryDisplayName(o.title)) : '';
        const capText = o.capText || '無上限';
        const key = [title, capText, o.period || '', o.upcomingStart || '', o.endingSoonEnd || '', o.extraClass || '', o.tagText || ''].join('\u0001');
        let g = byKey.get(key);
        if (!g) {
            g = {
                title, capText,
                period: o.period || '',
                upcomingStart: o.upcomingStart || null,
                endingSoonEnd: o.endingSoonEnd || null,
                extraClass: o.extraClass || '',
                tagText: o.tagText || '',
                rows: []
            };
            byKey.set(key, g);
            groups.push(g);
        }
        g.rows.push(o);
    }
    const num = o => { const n = parseFloat(o.rate); return Number.isFinite(n) ? n : -Infinity; };
    const desc = (x, y) => (y > x ? 1 : y < x ? -1 : 0);   // 大到小；同值回 0（穩定排序保留原順序）
    groups.forEach(g => g.rows.sort((a, b) => desc(num(a), num(b))));
    if (opts.sort !== false) groups.sort((a, b) => desc(num(a.rows[0]), num(b.rows[0])));
    return groups.map(g => renderPlanCard(g, opts.noteFor ? opts.noteFor(g) : null)).join('');
}

function renderPlanCard(g, note) {
    // 只轉這個固定句型：「切換「X」方案」→「X」＋灰小標「需切換方案」；其他標題原樣
    const sw = /^切換「([^」]+)」方案$/.exec(g.title || '');
    const name = sw ? sw[1] : (g.title || '');
    // 即將開始／即將結束徽章放標題旁（renderUpcomingBadge／renderEndingSoonBadge 與搜尋結果共用）
    const badges = renderUpcomingBadge(g.upcomingStart) + renderEndingSoonBadge(g.endingSoonEnd).trim();
    const tags = (sw ? '<span class="cd-tag">需切換方案</span>' : '') +
        (g.tagText ? `<span class="cd-tag">${escapeHtml(g.tagText)}</span>` : '') + badges;

    let html = `<div class="cashback-detail-item cd-rc${g.extraClass ? ' ' + escapeHtml(g.extraClass) : ''}">`;
    if (name || tags) {
        html += `<div class="cd-rc-t">${name ? `<span class="cd-rc-name">${escapeHtml(name)}</span>` : ''}${tags}</div>`;
    }
    // 標題下兩格；沒有期間就不顯示那一格
    html += `<div class="cd-meta">` +
        `<div><div class="cd-lb">回饋消費上限</div><div class="cd-val">${escapeHtml(g.capText)}</div></div>` +
        (g.period ? `<div><div class="cd-lb">活動期間</div><div class="cd-val">${escapeHtml(g.period)}</div></div>` : '') +
        `</div>`;
    if (note && note.text) {
        html += `<div class="cd-rc-note${note.kind === 'bday' ? ' cd-rc-note-bday' : ''}">${escapeHtml(note.text)}</div>`;
    }
    html += `<div class="cd-rows"><div class="cd-lb cd-rows-lb">回饋率</div>${g.rows.map(renderPlanRow).join('')}</div>`;
    html += `</div>`;
    return html;
}

// 一列回饋：左欄回饋率（24px）＋計算機鈕＋分級標籤；右欄 適用通路／條件／銀行官方登錄連結。
// 回饋組成面板（toggleRateComposition）展開在這一列下方
function renderPlanRow(o) {
    let right = '';
    if (o.sub) right += `<div class="cd-sub">${escapeHtml(o.sub)}</div>`;
    right += renderSpendThresholdNote(o.minSpend);
    right += renderCdChannels(o.merchants, o.merchantsLabel);
    const conds = (Array.isArray(o.conditions) ? o.conditions : [o.conditions]).filter(Boolean);
    conds.forEach(c => { right += renderCdCondition(c); });
    // 銀行官方登錄連結（renderRegisterLinkLine 自帶 sanitizeUrl，沒有連結回空字串）
    right += renderRegisterLinkLine(o.registerLink);

    return `<div class="cd-rr"${o.role ? ` data-role="${escapeHtml(o.role)}"` : ''}${o.specialList ? ' data-sl="1"' : ''}>` +
        `<div class="cd-rr-l"><div class="cd-rr-n"><span class="cd-rate">${escapeHtml((o.ratePrefix || '') + String(o.rate))}%</span>${o.rateBtnHtml || ''}</div>` +
        (o.levelLabel ? `<div class="cd-lvl">${o.levelLabel}</div>` : '') +
        `</div><div class="cd-rr-r">${right}</div></div>`;
}

// 適用通路：先畫完整清單，「… 顯示全部N個」鈕與省略號先 hidden，由 cdFitChannel 在量得到寬度時收成最多三行
function renderCdChannels(merchants, label) {
    const items = merchants && merchants.items ? [...new Set(merchants.items)] : [];
    if (items.length === 0) return '';
    return `<div class="cd-ch" data-n="${items.length}">` +
        `<span class="cd-ch-lb">${escapeHtml(label || '適用通路')}: </span>` +
        `<strong class="merchant-list">${escapeHtml(items.join('、'))}</strong>` +
        `<span class="cd-ch-ell" hidden>… </span>` +
        `<button type="button" class="cd-pill cd-more" aria-expanded="false" hidden><span class="cd-pill-t">顯示全部${items.length}個</span>${CD_CHEV_SVG}</button>` +
        `</div>`;
}

// 條件：預設一行省略，超出才長「展開」（cdFitCond）。
// ⚠️ 條件文字照舊原樣輸出、不 escape——與搜尋結果、舊版詳情頁一向如此，改了可能動到 Sheets 裡刻意的格式
function renderCdCondition(text) {
    return `<div class="cd-cond-w"><div class="cd-cond">條件: ${text}</div>` +
        `<button type="button" class="cd-pill cd-cond-t" aria-expanded="false" hidden><span class="cd-pill-t">展開</span>${CD_CHEV_SVG}</button></div>`;
}

// ---- 量寬度後才收的部分 ----
const CD_CH_MAX_H = 54;   // 三行（.cd-ch 的 line-height 是 18px）
const CD_FIT_IDS = ['card-special-cashback', 'card-upcoming-cashback', 'card-basic-cashback', 'card-coupon-cashback', 'card-promos-content'];

// 適用通路收成最多三行（「… 顯示全部N個」算在三行內，放不下就少列幾個通路名）。
// 量不到寬度（元素或祖先 display:none）就保留完整內容、不動它；展開中的也不動
function cdFitChannel(el) {
    if (el._cdOpen) return;
    if (!el.clientWidth) return;
    const strong = el.querySelector('strong.merchant-list');
    const ell = el.querySelector('.cd-ch-ell');
    const btn = el.querySelector('.cd-more');
    if (!strong || !ell || !btn) return;
    if (el._cdFull === undefined) {
        // 搜尋時 condenseMerchantList 會暫時改寫 strong 的文字、原文記在 strong._fullText，要拿原文
        el._cdFull = strong._fullText !== undefined ? strong._fullText : strong.textContent;
        el._cdNames = splitMerchantList(el._cdFull);
    }
    const names = el._cdNames;
    const n = parseInt(el.dataset.n, 10) || names.length;
    const paint = (k) => {
        strong.textContent = names.slice(0, k).join('、');
        const more = k < names.length || n > names.length;
        ell.hidden = !more;
        btn.hidden = !more;
    };
    const fits = () => el.scrollHeight <= CD_CH_MAX_H + 1;
    paint(names.length);
    if (fits() || names.length <= 1) return;
    // 通路越多越高（單調），二分搜尋最多能列幾個；至少留一個
    let lo = 1, hi = names.length - 1, best = 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        paint(mid);
        if (fits()) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    paint(best);
}

// 條件一行省略；真的被截斷才顯示「展開」。看不到（寬度 0）就不動
function cdFitCond(w) {
    if (w.classList.contains('open')) return;
    const c = w.querySelector('.cd-cond');
    const b = w.querySelector('.cd-cond-t');
    if (!c || !b || !c.clientWidth) return;
    b.hidden = !(c.scrollWidth > c.clientWidth + 1);
}

function cdFitAll(root) {
    if (!root) return;
    root.querySelectorAll('.cd-ch').forEach(cdFitChannel);
    root.querySelectorAll('.cd-cond-w').forEach(cdFitCond);
}

function cdFitAllContainers() {
    CD_FIT_IDS.forEach(id => {
        const c = document.getElementById(id);
        if (c && c.clientWidth > 0) cdFitAll(c);
    });
}

function cdToggleChannel(btn) {
    const el = btn.closest('.cd-ch');
    if (!el) return;
    const strong = el.querySelector('strong.merchant-list');
    const ell = el.querySelector('.cd-ch-ell');
    const label = btn.querySelector('.cd-pill-t');
    if (!strong || !ell || !label) return;
    if (!el._cdOpen) {
        if (el._cdFull === undefined) return;   // 還沒量過（鈕是量完才出現的，不會發生）
        el._cdOpen = true;
        el.classList.add('open');
        strong.textContent = el._cdFull;
        ell.hidden = true;
        label.textContent = '收起';
        btn.setAttribute('aria-expanded', 'true');
    } else {
        el._cdOpen = false;
        el.classList.remove('open');
        label.textContent = `顯示全部${parseInt(el.dataset.n, 10) || 0}個`;
        btn.setAttribute('aria-expanded', 'false');
        cdFitChannel(el);
    }
}

// 新戶活動多筆模式：「達成條件與備註」膠囊展開／收起該筆的說明
function cdTogglePromoDetail(btn) {
    const d = btn.nextElementSibling;
    if (!d) return;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    d.hidden = !open;
}

function cdToggleCond(btn) {
    const w = btn.closest('.cd-cond-w');
    if (!w) return;
    const open = w.classList.toggle('open');
    const label = btn.querySelector('.cd-pill-t');
    if (label) label.textContent = open ? '收起' : '展開';
    btn.setAttribute('aria-expanded', String(open));
    if (!open) cdFitCond(w);
}

// 「變更 ›」：手機切到個人設定頁籤；桌機（個人設定常駐左欄）捲到那裡並聚焦級別下拉
function cdGoToPersonalSettings() {
    if (typeof isCardDetailDesktop === 'function' && isCardDetailDesktop()) {
        const sec = document.getElementById('card-personal-section');
        const sel = document.getElementById('card-level-select');
        if (sec) sec.scrollIntoView({ block: 'nearest' });
        if (sel) { try { sel.focus(); } catch (e) { /* 聚焦失敗不影響其餘 */ } }
    } else if (typeof selectCardDetailTab === 'function') {
        selectCardDetailTab('set');
    }
}

// 「計算條件」列（分級卡，「指定通路回饋」標題下方）：灰字「計算條件」＋各值灰底小標籤（級別；CUBE 另有
// 發卡組織、勾了童樂匯時「童樂匯」）＋「變更 ›」小膠囊。值直接讀個人設定欄位（選單／勾選框的目前值），
// 設定改變時由各欄位的 onchange 與 updateCubeSpecialCashback 重呼叫。非分級卡不顯示；搜尋中隱藏。
// 全程 createElement＋textContent（值來自選單選項，鐵則 3）
function updateCardCalcConditions(card) {
    const bar = document.getElementById('card-calc-cond');
    if (!bar) return;
    bar.textContent = '';
    bar._cdHas = false;
    if (!card || !card.hasLevels) { bar.hidden = true; return; }

    const vals = [];
    const lvSel = document.getElementById('card-level-select');
    if (lvSel && lvSel.value) vals.push(lvSel.value);
    if (card.id === 'cathay-cube') {
        const issuer = document.getElementById('cube-issuer-select');
        if (issuer && issuer.value) vals.push(issuer.value);
        // 「童樂匯」不顯示在這裡（站長 2026-11-20）：開關照舊在個人設定
    }
    if (vals.length === 0) { bar.hidden = true; return; }

    const lb = document.createElement('span');
    lb.className = 'cd-cc-lb';
    lb.textContent = '計算條件';
    bar.appendChild(lb);
    vals.forEach(v => {
        const s = document.createElement('span');
        s.className = 'cd-cc-v';
        s.textContent = v;
        bar.appendChild(s);
    });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cd-pill cd-cc-chg';
    btn.setAttribute('aria-label', '變更計算條件（到個人設定）');
    const t = document.createElement('span');
    t.className = 'cd-pill-t';
    t.textContent = '變更';
    btn.appendChild(t);
    btn.insertAdjacentHTML('beforeend', CD_CHEV_SVG);   // 靜態 SVG 常數
    bar.appendChild(btn);

    bar._cdHas = true;
    const searchInput = document.getElementById('cashback-search-input');
    bar.hidden = !!(searchInput && searchInput.value.trim());
}

// 一次性的綁定：委派點擊（回饋卡是 innerHTML 重畫的，節點會換）＋寬度／字型變動時重收。
// ⚠️ 元素從 display:none 變成可見、視窗寬度改變、字型載入完成，量到的寬度才會變——
//    所以用 ResizeObserver 盯四個回饋容器的寬度（寬度沒變就不動，免得自己改高度又觸發自己），
//    收的動作丟到下一個 frame（在 observer 回呼裡改版面會觸發「ResizeObserver loop」錯誤）
let _cdFitReady = false;
function setupCardDetailFit() {
    if (_cdFitReady) return;
    const modal = document.getElementById('card-detail-modal');
    if (!modal) return;
    _cdFitReady = true;

    modal.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        const more = t.closest('.cd-more');
        if (more) { cdToggleChannel(more); return; }
        const cond = t.closest('.cd-cond-t');
        if (cond) { cdToggleCond(cond); return; }
        const pm = t.closest('.cd-pm-t');
        if (pm) { cdTogglePromoDetail(pm); return; }
        if (t.closest('.cd-cc-chg')) cdGoToPersonalSettings();
    });

    let pending = false;
    const later = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; cdFitAllContainers(); });
    };
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(entries => {
            let changed = false;
            entries.forEach(en => {
                const w = Math.round(en.contentRect.width);
                if (w === en.target._cdW) return;
                en.target._cdW = w;
                if (w > 0) changed = true;
            });
            if (changed) later();
        });
        CD_FIT_IDS.forEach(id => { const c = document.getElementById(id); if (c) ro.observe(c); });
    } else {
        window.addEventListener('resize', later);
    }
    if (document.fonts) {
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', later);
        if (document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(later);
    }
}

// 詳情頁「一般回饋」區的灰色「一般消費排除項目」卡（2026-10-11 站長要求）。
// 刻意不走 planCardsHtml：那支一律輸出「回饋率｜回饋消費上限」兩欄，而這張卡的重點只有項目本身。
// 外框沿用 .rate-card 的「標題列｜body」兩段結構，桌機兩欄時才能跟旁邊的卡同排對齊（subgrid）。
// 項目多（台新 60 項）→ 先列 initialCount 個，展開鈕沿用 toggleMerchants（與適用通路同一套，
// 詳情頁「搜尋通路」也會自動點開它）。沒有名單回空字串。
function renderBasicExclusionsCard(card, initialCount = 10) {
    const items = Array.isArray(card && card.basicExclusions)
        ? [...new Set(card.basicExclusions.map(s => String(s || '').trim()).filter(Boolean))] : [];
    if (items.length === 0) return '';
    const fullList = items.join('、');
    let listHtml;
    if (items.length <= initialCount) {
        listHtml = `<strong class="merchant-list">${escapeHtml(fullList)}</strong>`;
    } else {
        const initialList = items.slice(0, initialCount).join('、');
        const merchantsId = `basic-exclusions-${escapeHtml(card.id)}-merchants`;
        const showAllId = `basic-exclusions-${escapeHtml(card.id)}-show-all`;
        listHtml = `<strong class="merchant-list" id="${merchantsId}">${escapeHtml(initialList)}</strong>` +
            `<button class="show-more-btn" id="${showAllId}" onclick="toggleMerchants('${merchantsId}', '${showAllId}', '${escapeHtml(escapeForOnclick(initialList))}', '${escapeHtml(escapeForOnclick(fullList))}')">… 顯示全部${items.length}個</button>`;
    }
    return `<div class="cashback-detail-item rate-card rate-card-excluded">` +
        `<div class="rate-card-header"><div class="rate-card-title">一般消費排除項目</div></div>` +
        `<div class="rate-card-body">` +
        `<div class="excluded-detail-note">刷以下項目沒有任何回饋（包含基本回饋）</div>` +
        `<div class="matched-merchant rate-card-info"><div class="activity-info-line">排除項目: ${listHtml}</div></div>` +
        `</div></div>`;
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

// 近期異動：「回饋」頁籤最上面的一行通知（最新一筆的日期與文字＋「共 N 則」），點了展開
// 完整清單（每列「日期 ＋ 一句話」，最多 5 筆）。筆數與新→舊排序由 Apps Script 匯出時決定
// （apps-script/cards-export.gs 的 readChangelog），前端照收不再排序。資料只在有異動的卡上出現。
//
// ⚠️ 空陣列不是 falsy（鐵則 4）：`!card.changelog` 擋不掉 `[]`，長度也要判，
//    否則會渲染出一條空通知。
// ⚠️ summary 是站長在 Google Sheets 自由輸入的文字（鐵則 3）。這裡刻意不走 innerHTML，
//    改用 createElement + textContent——瀏覽器不會把內容當標記解析，比事後 escapeHtml
//    少一個「哪天有人改成字串拼接就破功」的失誤面。
// ⚠️ 顯示用 style.display = ''（不是 'block'）：桌機 CSS 對 .cd-bar 內的這一區設了 display:contents，
//    行內的 block 會把它蓋掉
function renderCardDetailChangelog(card) {
    const section = document.getElementById('card-changelog-section');
    const list = document.getElementById('card-changelog-content');
    const bar = document.getElementById('cd-bar');
    const toggle = document.getElementById('card-changelog-toggle');
    if (!section || !list) return;

    list.textContent = '';
    list.hidden = true;                       // 每次重畫都回到收合
    if (toggle) toggle.setAttribute('aria-expanded', 'false');

    const entries = (card && card.changelog) || [];
    const shown = [];

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
        shown.push({ date: formatChangelogDate(entry.date), summary });
    });

    // 沒有任何可顯示的異動（含每一筆 summary 都是空的）→ 整條不顯示
    if (shown.length === 0) {
        section.style.display = 'none';
        if (bar) bar.classList.remove('has-news');
        return;
    }

    // 一行通知：最新一筆（匯出端已排成新→舊）。日期取 MM/DD，完整日期在展開的清單裡
    const latest = shown[0];
    const short = /^\d{4}\/(\d{2})\/(\d{2})$/.exec(latest.date);
    const dateOut = document.getElementById('card-changelog-latest-date');
    const textOut = document.getElementById('card-changelog-latest-text');
    const countOut = document.getElementById('card-changelog-count');
    if (dateOut) dateOut.textContent = short ? `${short[1]}/${short[2]}` : latest.date;
    if (textOut) textOut.textContent = latest.summary;
    if (countOut) countOut.textContent = `共 ${shown.length} 則`;
    if (toggle) {
        toggle.onclick = () => setCardDetailChangelogOpen(list.hidden);
    }
    section.style.display = '';
    if (bar) bar.classList.add('has-news');
}

// 展開／收合完整的近期異動清單（點通知、或側欄「最近異動」進來時展開）
function setCardDetailChangelogOpen(open) {
    const list = document.getElementById('card-changelog-content');
    const toggle = document.getElementById('card-changelog-toggle');
    if (!list || !toggle) return;
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
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
            // 多個搜尋詞（同義詞群組）依序標記：已標過的字不再包一層
            if (node.parentNode && node.parentNode.closest && node.parentNode.closest('mark.cashback-search-hl')) return NodeFilter.FILTER_REJECT;
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
    container.querySelectorAll('.show-more-btn, .cd-more').forEach(btn => {
        const collapsed = btn.textContent.includes('顯示全部');
        if (hasTerm) {
            if (collapsed) {
                btn._autoExpanded = true; // JS 屬性，不留 data-* 在 DOM 上
                btn.click(); // 舊樣式沿用 toggleMerchants（完整清單在其 onclick 參數中）；同方案卡走 cdToggleChannel（委派點擊）
            }
        } else if (btn._autoExpanded) {
            if (!collapsed) btn.click();
            btn._autoExpanded = false;
        }
    });
}

// 詳情頁搜尋：搜尋框在所有回饋區上方（2026-10-14 站長要求從「指定通路回饋」標題下移上來），
// 一次過濾指定通路／即將開始／一般回饋／領券四區的回饋卡，並把命中的字詞即時 highlight
// （不然使用者看不出是配對到哪個通路／條件）。一般回饋區的國內／海外一般消費、排除灰卡一樣照字過濾——
// 搜「罰」只留下排除灰卡。沒命中的區整區（含標題）收起；四區都沒有才出「找不到」。
// 本來就沒顯示的區（例：沒有即將開始的活動）不動它。
// 只在已渲染的 DOM 上做過濾（不重新計算或 fetch），效能 < 5ms
const DETAIL_SEARCH_SECTIONS = [
    ['card-special-cashback', 'card-special-section'],
    ['card-upcoming-cashback', 'card-upcoming-section'],
    ['card-basic-cashback', 'card-basic-cashback-section'],
    ['card-basic-exclusions', 'card-basic-exclusions-section'],
    ['card-coupon-cashback', 'card-coupon-section']
];
function filterCashbackItems(searchTerm) {
    const term = (searchTerm || '').toLowerCase().trim();
    // 打的是排除項目同義詞群組的代表名稱（如「醫療費用」）→ 各銀行寫法一起找（js/search-match.js）
    const terms = term ? expandExclusionGroupTerms([term]) : [];
    const emptyMsg = document.getElementById('cashback-search-empty');
    const hint = document.getElementById('cashback-search-hint');
    // 搜尋中隱藏「計算條件」列（它描述的是整張卡的計算前提，搜尋結果只留命中的列）
    const calcBar = document.getElementById('card-calc-cond');
    if (calcBar) calcBar.hidden = !calcBar._cdHas || !!term;
    let total = 0;
    let ratesTotal = 0;    // 「回饋」頁籤（指定通路／即將開始／一般回饋）的命中數
    let couponTotal = 0;   // 「領券・停車」頁籤（領券區）的命中數

    DETAIL_SEARCH_SECTIONS.forEach(([containerId, sectionId]) => {
        const container = document.getElementById(containerId);
        const section = document.getElementById(sectionId);
        if (!container || !section) return;
        // 先還原上一次搜尋收起的區，才分得出「本來就沒顯示」的區
        if (section._searchHidden) { section.style.display = ''; section._searchHidden = false; }
        if (section.style.display === 'none') return;
        const visible = filterDetailCards(container, terms);
        total += visible;
        if (sectionId === 'card-coupon-section') couponTotal += visible;
        else ratesTotal += visible;
        if (term && visible === 0) { section.style.display = 'none'; section._searchHidden = true; }
    });

    // 回饋頁籤沒命中、但領券區有命中：搜尋框在「回饋」頁籤，命中卻在另一個頁籤，不提示用戶會以為找不到
    const couponOnly = !!term && ratesTotal === 0 && couponTotal > 0;
    if (hint) {
        hint.hidden = !couponOnly;
        if (couponOnly) {
            hint.textContent = `「${searchTerm.trim()}」只在「領券・停車」有 ${couponTotal} 筆符合，點此查看 ›`;
            hint.onclick = () => { if (typeof selectCardDetailTab === 'function') selectCardDetailTab('coupon'); };
        }
    }
    if (emptyMsg) {
        emptyMsg.style.display = (term && total === 0) ? 'block' : 'none';
    }
}

// 過濾一個容器裡的 .cashback-detail-item，回傳顯示中的筆數。
// 同方案卡（.cd-rc）以「列」為單位：命中的列留、沒命中的列藏，卡內全部列都沒命中整張卡藏；
// 標題列（標題／註記／上限／期間）本身命中就整張卡的列都留（搜「慶生月」看得到整個方案）。
// 其他卡（一般消費排除卡、領券、停車、無指定通路的說明）整張比對。清空搜尋全部恢復
function filterDetailCards(container, terms) {
    const term = terms.length > 0;
    // 必須先還原，textContent 才是乾淨原文（也讓每次輸入都從無標記狀態重算）
    clearCashbackHighlights(container);
    restoreCondensedMerchantLists(container);
    // 再展開被截斷的通路清單，比對與標記才看得到完整內容
    syncMerchantListsForSearch(container, !!term);

    const hit = (el) => { const text = el.textContent.toLowerCase(); return terms.some(t => text.includes(t)); };
    let visibleCount = 0;
    container.querySelectorAll('.cashback-detail-item').forEach(item => {
        const rows = item.querySelectorAll('.cd-rr');
        if (rows.length > 0) {
            let shown = 0;
            const headHit = term && ['.cd-rc-t', '.cd-rc-note', '.cd-meta .cd-val'].some(sel =>
                Array.from(item.querySelectorAll(sel)).some(hit));
            rows.forEach(row => {
                const ok = !term || headHit || hit(row);
                row.style.display = ok ? '' : 'none';
                if (ok) {
                    shown++;
                    if (term) row.querySelectorAll('strong.merchant-list').forEach(el => condenseMerchantList(el, terms));
                }
            });
            item.style.display = shown > 0 ? '' : 'none';
            visibleCount += shown;
            if (term && shown > 0) terms.forEach(t => highlightCashbackTerm(item, t)); // 只標記顯示中的項目
            return;
        }
        if (!term) {
            item.style.display = '';
            visibleCount++;
            return;
        }
        // 比對整個卡片的 textContent，包含通路名稱、category 標籤、條件等
        if (hit(item)) {
            item.style.display = '';
            visibleCount++;
            item.querySelectorAll('strong.merchant-list').forEach(el => condenseMerchantList(el, terms));
            terms.forEach(t => highlightCashbackTerm(item, t)); // 只標記顯示中的項目
        } else {
            item.style.display = 'none';
        }
    });
    // 清空搜尋：自動展開的通路清單已在上面收回，但那時整列還藏著（display:none 量不到寬度），
    // 列重新顯示後才能收成三行
    if (!term) cdFitAll(container);
    return visibleCount;
}

// 通路清單以「、」分隔，但通路名本身可能含「、」（如「新光三越(桃園、林口、台中港、台南)」），
// 括號裡的頓號不切
function splitMerchantList(text) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of text) {
        if (ch === '(' || ch === '（') depth++;
        else if ((ch === ')' || ch === '）') && depth > 0) depth--;
        if (ch === '、' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts.map(p => p.trim()).filter(Boolean);
}

// 搜尋時清單只留命中的通路，中間沒命中的一段段縮成「…」（2026-10-14 站長要求：命中項目在長清單
// 後段時一眼就看到）。清單裡一個都沒命中（命中的是卡名、條件等）就不動。原文記在 JS 屬性，
// restoreCondensedMerchantLists 還原；只動 textContent，不碰 innerHTML（鐵則 3）
function condenseMerchantList(el, terms) {
    const full = el.textContent;
    const parts = splitMerchantList(full);
    const hit = p => { const lower = p.toLowerCase(); return terms.some(t => lower.includes(t)); };
    if (!parts.some(hit)) return;
    const out = [];
    parts.forEach(p => {
        if (hit(p)) out.push(p);
        else if (out[out.length - 1] !== '…') out.push('…');
    });
    const condensed = out.join('、');
    if (condensed === full) return;
    el._fullText = full;
    el._condensedText = condensed;
    el.textContent = condensed;
}

function restoreCondensedMerchantLists(container) {
    container.querySelectorAll('strong.merchant-list').forEach(el => {
        if (el._fullText === undefined) return;
        // 用戶搜尋中自己按了「收起」→ toggleMerchants 已換成短清單，不能再蓋回全文
        if (el.textContent === el._condensedText) el.textContent = el._fullText;
        delete el._fullText;
        delete el._condensedText;
    });
}

// 將 toggleMerchants 暴露到全局作用域（一般消費排除卡 renderBasicExclusionsCard 產生的 onclick 要用；
// 同方案卡的「顯示全部」改走 cdToggleChannel）
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

// 本地儲存（自動備份）；回傳寫入有沒有成功（私密模式／配額滿時 setItem 會丟錯，不再讓它中斷輸入流程）
function autoBackupNotes(cardId, notes) {
    const cacheKey = (auth && auth.currentUser) ? `notes_${auth.currentUser.uid}_${cardId}` : `notes_${cardId}`;
    try { localStorage.setItem(cacheKey, notes); return true; } catch (e) { return false; }
}

// 儲存筆記（自動儲存呼叫；2026-11-17 起沒有儲存鈕與 #save-indicator）。回傳儲存結果
// （見 js/levels-payments.js「儲存結果」）：訪客＝存在這台裝置；登入者＝寫入雲端（本機備份每次輸入時已寫）
async function saveUserNotes(cardId, notes) {
    const local = autoBackupNotes(cardId, notes);

    if (!auth || !auth.currentUser) {
        // 未登入時僅儲存在本地
        if (!local) return { ok: false, reason: '無法寫入這台裝置的儲存空間', local: false };
        lastSavedNotes.set(cardId, notes);
        return { ok: true };
    }

    try {
        const docRef = window.doc ? window.doc(db, 'userNotes', `${auth.currentUser.uid}_${cardId}`) : null;
        if (!docRef || !window.setDoc) throw new Error('Firestore not available');
        await window.setDoc(docRef, {
            notes: notes,
            updatedAt: new Date(),
            cardId: cardId
        });
        lastSavedNotes.set(cardId, notes);
        return { ok: true };
    } catch (error) {
        console.error('雲端儲存失敗:', error);
        return { ok: false, reason: describeSaveError(error), local };   // 本機備份已先寫（local）
    }
}

// ============================================================
// 新戶活動票券（2026-11-17，三輪改版的第三輪）
// ============================================================
// 詳情頁「新戶活動」頁籤：每筆活動一張票券（renderCardDetailPromoTickets，由 js/results-display.js 的
// renderCardDetailPromos 呼叫）。搜尋結果的活動卡（createCardholderPromoElement）不動、輸出不變。
//   左邊亮黃票根（#ffd84a）＝第一個活動類型的線條圖示＋文字；中間虛線、上下兩個半圓缺口；
//   右邊白底「資料有什麼畫什麼」：首刷禮（單一／N 選 1）、定額回饋（大字金額＋單位）、回饋率＋回饋消費上限、
//   適用通路（重用同方案回饋卡的三行收合 renderCdChannels／cdFitChannel）、new_customer_summary、首刷禮圖片
//   右上小標：快結束「剩 N 天」／未開始「N 天後開始」（getPromoTimeBadge，與搜尋結果同一份判斷）；
//   第二個以後的活動類型只有「右邊沒有對應數值」時才顯示成小標（避免「首刷禮＋定額回饋」把金額寫兩遍）
//   票券下方：只有一筆活動 → 直接攤開「達成條件」與「活動說明」；多筆 → 每張票券下一顆「達成條件與備註」
//   膠囊，點開才展開該筆；新戶資格各筆相同就在最下面寫一次（#card-promos-foot），不同就放進各筆展開內容
// ⚠️ 欄位空白（空字串、null、空陣列——鐵則 4）的項目整列不顯示；所有文字 escapeHtml、連結 sanitizeUrl（鐵則 3）
// ⚠️ 頁籤筆數＝活動筆數＝#card-promos-content 的直接子項 .cd-pm 個數（CTA 盒除外）；共用新戶資格放在
//    #card-promos-foot（content 之外），所以不會被算進筆數。每筆活動的內容（票券＋說明）都包在同一個 .cd-pm 裡
// ⚠️ 達成條件（promo_condition）「照換行拆」：以 ①②③／「1.」開頭的是一步（去掉開頭符號、前面加黃色圓圈數字）；
//    沒有符號的行若前面已有步驟（例如「-消費條件A…」「→…」「↓…」「持有凱基銀行帳戶」）併進上一步當附註，
//    不另編號——否則子條件會被編成獨立的一步；整段只有一行且不是步驟 → 直接一段文字

const CD_PT_ICONS = {
    gift: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-4-6-3.5-5-1 .6 1.3 3 1 5 1Zm0 0c1.5-4 6-3.5 5-1-.6 1.3-3 1-5 1Z"/></svg>',
    voucher: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.3c-.5-.8-1.4-1.3-2.5-1.3-1.5 0-2.5.7-2.5 1.8 0 2.4 5 1.2 5 3.6 0 1.1-1 1.8-2.5 1.8-1.2 0-2.1-.5-2.6-1.3M12 6.3v11.4"/></svg>',
    bonus: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M18 6 6 18"/></svg>'
};

// 活動類型 → 圖示（沿用 promoTypeClass：贈品＝首刷禮、定額抵用＝定額回饋；沒見過的類型用禮物圖示）
function cdPromoIcon(type) {
    const cls = promoTypeClass(type);
    return CD_PT_ICONS[cls] || CD_PT_ICONS.gift;
}

// 去掉行首的步驟符號：①～⑳、⑴～⒇、❶～❿、「1.」「1、」「1)」「(1)」
const CD_STEP_MARK = /^\s*(?:[①-⑳⑴-⒇❶-❿]|[（(]\d{1,2}[）)]|\d{1,2}[.、)）](?!\d))\s*/;

// promo_condition → { plain: 一段文字 } 或 { steps: [{ text, subs: [附註行…] }] }
function cdParsePromoSteps(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const marked = lines.some(l => CD_STEP_MARK.test(l));
    if (lines.length === 1 && !marked) return { plain: lines[0] };
    const steps = [];
    lines.forEach(l => {
        if (CD_STEP_MARK.test(l)) steps.push({ text: l.replace(CD_STEP_MARK, ''), subs: [] });
        else if (marked && steps.length > 0) steps[steps.length - 1].subs.push(l);
        else steps.push({ text: l, subs: [] });
    });
    return { steps };
}

// 備註 notes：照全形「；」與半形「;」拆成條列
function cdParsePromoNotes(text) {
    return String(text || '').split(/[；;]/).map(s => s.trim()).filter(Boolean);
}

// 首刷禮 gift_content：換行分隔、可能以 ①②③ 開頭 → 項目陣列（只有一項＝單一贈品）
function cdParseGiftItems(text) {
    return String(text || '').split(/\r?\n/).map(l => l.replace(CD_STEP_MARK, '').trim()).filter(Boolean);
}

function cdPromoCapText(promo) {
    return (typeof promo.bonus_cap === 'number' && !isNaN(promo.bonus_cap))
        ? `NT$${Math.round(Number(promo.bonus_cap)).toLocaleString()}` : '';
}

// 一張票券（HTML 字串；item＝{ promo, merchantList }）
function cdRenderPromoTicket(item) {
    const promo = item.promo;
    const gifts = promo.gift_content ? cdParseGiftItems(promo.gift_content) : [];
    const hasAmt = !!promo.voucher_amount;
    const rate = (promo.bonus_rate != null && promo.bonus_rate !== '') ? formatBonusRate(promo.bonus_rate) : '';
    const cap = cdPromoCapText(promo);

    // 票根：第一個活動類型；沒有類型名稱就依有的內容補一個
    let types = (Array.isArray(promo.promo_types) ? promo.promo_types : []).map(t => String(t || '').trim()).filter(Boolean);
    if (types.length === 0) types = [gifts.length ? '首刷禮' : hasAmt ? '定額回饋' : rate ? '回饋加碼' : '新戶活動'];

    // 右上小標：時間（剩 N 天／N 天後開始）＋第二個以後、右邊沒有對應數值的活動類型
    const chips = [];
    const tb = getPromoTimeBadge(promo);
    if (tb.kind === 'ending') chips.push(['soon', tb.days === 0 ? '今天截止' : `剩 ${tb.days} 天`]);
    else if (tb.kind === 'upcoming') chips.push(['soon', tb.days === 0 ? '今天開始' : `${tb.days} 天後開始`]);
    types.slice(1).forEach(t => {
        const cls = promoTypeClass(t);
        const shown = (cls === 'gift' && gifts.length) || (cls === 'voucher' && hasAmt) || (cls === 'bonus' && rate);
        if (!shown) chips.push(['', t]);
    });

    let body = '';
    if (chips.length > 0) {
        body += `<div class="cd-pt-chips">${chips.map(c => `<span${c[0] ? ` class="cd-pt-${c[0]}"` : ''}>${escapeHtml(c[1])}</span>`).join('')}</div>`;
    }
    if (gifts.length === 1) {
        body += `<div><div class="cd-lb">首刷禮</div><div class="cd-gname">${escapeHtml(gifts[0])}</div></div>`;
    } else if (gifts.length > 1) {
        body += `<div><div class="cd-lb">首刷禮 ${gifts.length} 選 1</div><ol class="cd-gopts">${gifts.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ol></div>`;
    }
    if (hasAmt) {
        body += `<div><div class="cd-lb">定額回饋</div><div class="cd-hz-amt"><b>NT$${escapeHtml(Math.round(Number(promo.voucher_amount)).toLocaleString())}</b>` +
            (promo.voucher_usage ? `<small>${escapeHtml(promo.voucher_usage)}</small>` : '') + `</div></div>`;
    }
    if (rate || cap) {
        body += `<div class="cd-meta">` +
            (rate ? `<div><div class="cd-lb">回饋率</div><div class="cd-hz-amt"><b>${escapeHtml(rate)}</b>` +
                // 有 voucher_usage 但沒有定額金額（例如「回饋 6％ LINE POINTS」）：單位跟在回饋率旁，不讓這個欄位消失
                (promo.voucher_usage && !hasAmt ? `<small>${escapeHtml(promo.voucher_usage)}</small>` : '') + `</div></div>` : '') +
            (cap ? `<div><div class="cd-lb">回饋消費上限</div><div class="cd-val">${escapeHtml(cap)}</div></div>` : '') +
            `</div>`;
    }
    if (item.merchantList && item.merchantList.length > 0) {
        body += renderCdChannels({ items: item.merchantList }, '適用通路');
    }
    if (promo.new_customer_summary) body += `<p class="cd-pt-sum">${escapeHtml(promo.new_customer_summary)}</p>`;
    // 首刷禮圖片放最下面；可以點擊放大（js/home-ui.js 的 setupGiftImageLightbox 認 .promo-gift-image）。鐵則 3：src 一律 sanitizeUrl
    const imgUrl = sanitizeUrl(promo.gift_image_url);
    if (imgUrl) {
        body += `<img class="cd-pt-img promo-gift-image" src="${escapeHtml(sanitizeUrl(promo.gift_image_url))}" alt="首刷禮圖片" loading="lazy" onerror="this.style.display='none'">`;
    }

    return `<div class="cd-tk"><div class="cd-tk-stub">${cdPromoIcon(types[0])}<span>${escapeHtml(types[0])}</span></div>` +
        `<div class="cd-tk-main">${body}</div></div>`;
}

// 一筆活動的「說明內容」：達成條件、新戶資格（opts.withDef）、活動期間、備註。
// 回傳 { steps, facts }：steps＝達成條件區塊 HTML（沒有條件回空字串）；facts＝期間／備註（與新戶資格）列 HTML
function cdRenderPromoDetails(promo, opts = {}) {
    let steps = '';
    const parsed = cdParsePromoSteps(promo.promo_condition);
    if (parsed && parsed.plain) {
        steps = `<p class="cd-pt-plain">${escapeHtml(parsed.plain)}</p>`;
    } else if (parsed && parsed.steps) {
        steps = '<ol class="cd-steps">' + parsed.steps.map((st, i) =>
            `<li><i aria-hidden="true">${i + 1}</i><span>${escapeHtml(st.text)}` +
            st.subs.map(l => `<span class="cd-step-sub">${escapeHtml(l)}</span>`).join('') + `</span></li>`
        ).join('') + '</ol>';
    }
    const def = String(promo.new_customer_definition || '').trim();
    const notes = cdParsePromoNotes(promo.notes);
    const hasPeriod = !!(promo.period_start || promo.period_end);
    // 空白的項目整列不顯示；全空就回空字串（呼叫端據此略過整塊）
    const facts = (opts.withDef && def ? `<div><div class="cd-lb">新戶資格</div><div class="cd-val">${escapeHtml(def)}</div></div>` : '') +
        (hasPeriod ? `<div><div class="cd-lb">活動期間</div><div class="cd-val">${escapeHtml(formatPromoPeriod(promo))}</div></div>` : '') +
        (notes.length > 0 ? `<div><div class="cd-lb">備註</div><ul class="cd-notes">${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>` : '');
    return { steps, facts: facts ? `<div class="cd-kv">${facts}</div>` : '' };
}

// 把 items（[{ promo, merchantList }]）畫進 #card-promos-content（與多筆時的 #card-promos-foot）
function renderCardDetailPromoTickets(card, items) {
    const content = document.getElementById('card-promos-content');
    const foot = document.getElementById('card-promos-foot');
    if (!content) return;
    const multi = items.length > 1;
    content.classList.toggle('cd-promos-multi', multi);

    // 多筆：新戶資格各筆都有且完全相同 → 最下面寫一次；否則各筆自己放進展開內容
    const defs = items.map(it => String(it.promo.new_customer_definition || '').trim());
    const commonDef = multi && defs.every(d => d && d === defs[0]) ? defs[0] : '';

    let html = '';
    items.forEach((it, i) => {
        const ticket = cdRenderPromoTicket(it);
        const d = cdRenderPromoDetails(it.promo, { withDef: multi ? !commonDef : true });
        if (!multi) {
            html += `<div class="cd-pm">${ticket}` +
                (d.steps ? `<h5 class="cd-pm-h">達成條件</h5><div class="cd-pm-box">${d.steps}</div>` : '') +
                (d.facts ? `<h5 class="cd-pm-h">活動說明</h5><div class="cd-pm-box">${d.facts}</div>` : '') + `</div>`;
        } else {
            const detId = `cd-pm-d-${i}`;
            html += `<div class="cd-pm">${ticket}` + ((d.steps || d.facts)
                ? `<button type="button" class="cd-pm-t" aria-expanded="false" aria-controls="${detId}"><span>達成條件與備註</span>${CD_CHEV_SVG}</button>` +
                  `<div class="cd-pm-d" id="${detId}" hidden>` +
                  (d.steps ? `<div class="cd-lb">達成條件</div>${d.steps}` : '') + d.facts + '</div>'
                : '') + '</div>';
        }
    });
    content.insertAdjacentHTML('beforeend', html);

    if (foot) {
        const footHtml = commonDef
            ? `<div class="cd-pm-box cd-pm-foot"><div class="cd-lb">新戶資格</div><div class="cd-val">${escapeHtml(commonDef)}</div></div>` : '';
        foot.innerHTML = footHtml;
    }
    cdFitAll(content);   // 窗格還藏著（寬度 0）時量不到，什麼都不做；顯示時由 selectCardDetailTab 補收
}
