/* ============================================================
 * Pick My Card — js/mappings-page.js（載入順序 13/13）
 * 「我的配卡組合」完整頁面（2026-09-28 由 modal 改版：收據風格「刷卡小抄」）
 * 區塊目錄（Grep 關鍵字）：
 *  - 狀態與偏好（排列/版面/字級/存圖設定）→ "mpLoadPrefs" / "mpSavePrefs"
 *  - 商家顯示名稱（改名／重設，存雲端）    → "loadMerchantAliases" / "mpSetAlias"
 *  - 分組／分類／拼音字首                 → "mpBuildGroups" / "mpCategoryOf" / "mpLetterOf"
 *  - 失效檢查與「更新期限」              → "mpProbeAll" / "mpUpdateDeadlines"
 *  - 頁面開關與網址 /mappings            → "openMappingsPage" / "closeMappingsPage"
 *  - 收據 HTML                         → "mpReceiptHtml"
 *  - 拖曳排序（自訂）                   → "mpStartDrag"
 *  - 改名面板                          → "mpOpenEditSheet"
 *  - 存成圖片（canvas 繪製、桌布尺寸）     → "mpOpenExport" / "mpRenderCanvas" / "mpWallSize"
 *
 * 設計紀錄：docs/project/ui-display.md 第 8 節。
 * ⚠️ 這支檔案也會被 tools/lib/merchant-cards.js 用 vm 載入（build 期間），頂層不可以直接
 *    碰 DOM；所有初始化都放在 DOMContentLoaded 之後。
 * ============================================================ */

// ============================================
// 狀態與偏好
// ============================================
const MP_TODAY_YEAR = () => getTaiwanToday().slice(0, 4);
const MP = {
    open: false,
    pushed: false,          // 這次開頁是否 pushState 過（關閉時決定 back 還是 replace）
    prefs: null,
    status: new Map(),      // mapping.id → { dead:'ended'|'gone'|null, labels:[], next, changed, ext }
    probed: false,
    probing: null,
    updated: null,          // 按過「更新期限」的結果 { ext, changed:[] }
    search: '',
    editKey: null,
    exp: { step: 'settings', dataUrl: null, fits: true, capacity: 0 },
    editing: false,         // 按「編輯」才顯示排列／字級／版面等設定（預設只看乾淨的小抄＋搜尋框）
    demo: null,             // 未登入時的範例清單（只在記憶體，不存任何地方）
    drag: null
};

// 目前這張小抄的配對清單：登入＝自己的配對；未登入＝範例（可以照樣排列、改名、存圖，只是不會保存）
function mpList() {
    if (currentUser) return Array.isArray(userSpendingMappings) ? userSpendingMappings : [];
    return MP.demo || [];
}
function mpSetList(arr) {
    if (currentUser) userSpendingMappings = arr; else MP.demo = arr;
}
async function mpPersist() {
    if (currentUser) return saveSpendingMappings(userSpendingMappings);
    return true;   // 範例不保存
}

function mpPrefsKey() {
    return currentUser ? `mappingsPrefs_${currentUser.uid}` : 'mappingsPrefs_guest';
}

function mpLoadPrefs() {
    const p = readLocalJSON(mpPrefsKey(), null) || {};
    MP.prefs = {
        sort: ['custom', 'az', 'cat'].includes(p.sort) ? p.sort : 'cat',
        layout: p.layout === 'E' ? 'E' : 'F',
        size: p.size === 'large' ? 'large' : 'small',
        labels: p.labels !== false,
        caps: p.caps === true,          // 顯示活動封頂金額（消費上限）；預設關
        fmt: p.fmt === 'long' ? 'long' : 'wall',
        ratio: ['auto', 'iphone', 'android', 'old'].includes(p.ratio) ? p.ratio : 'auto',
        theme: p.theme === 'dark' ? 'dark' : 'light',
        sel: Array.isArray(p.sel) ? p.sel.filter(s => typeof s === 'string') : null
    };
}

function mpSavePrefs() {
    try { localStorage.setItem(mpPrefsKey(), JSON.stringify(MP.prefs)); } catch (e) { /* 私密模式等 */ }
}

// ============================================
// 商家顯示名稱（改名只改顯示；搜尋、計算、分類一律用原名）
// ============================================
let userMerchantAliases = {};
let userMappingsTitle = '';          // 小抄標題（空＝預設「刷卡小抄」）；存 Firestore users/<uid>.mappingsTitle
const MP_DEFAULT_TITLE = '刷卡小抄';
const MP_TITLE_MAX = 10;             // 寬度單位：中文字＝1、英數字＝0.6（10 個中文字大字也不換行）

function mpTitleUnits(t) {
    return [...String(t || '')].reduce((n, ch) => n + (/[\u0000-\u00ff]/.test(ch) ? 0.6 : 1), 0);
}

function mpTitle() { return userMappingsTitle || MP_DEFAULT_TITLE; }

function mpSanitizeAliases(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(obj).forEach(k => {
        const v = obj[k];
        if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== k) out[k] = v.trim().slice(0, 20);
    });
    return out;
}

// 登入流程呼叫（auth-user-data.js）：雲端有值 → 雲端為準並更新本機鏡像；雲端沒有 → 讀本機鏡像
function loadMerchantAliases(userData) {
    if (!currentUser) { userMerchantAliases = {}; userMappingsTitle = ''; return; }
    const titleKey = `mappingsTitle_${currentUser.uid}`;
    if (userData && typeof userData.mappingsTitle === 'string') {
        userMappingsTitle = userData.mappingsTitle.trim();
        try { localStorage.setItem(titleKey, userMappingsTitle); } catch (e) { /* ignore */ }
    } else {
        try { userMappingsTitle = (localStorage.getItem(titleKey) || '').trim(); } catch (e) { userMappingsTitle = ''; }
    }
    if (mpTitleUnits(userMappingsTitle) > MP_TITLE_MAX) userMappingsTitle = '';
    const localKey = `merchantAliases_${currentUser.uid}`;
    if (userData && userData.merchantAliases && typeof userData.merchantAliases === 'object') {
        userMerchantAliases = mpSanitizeAliases(userData.merchantAliases);
        try { localStorage.setItem(localKey, JSON.stringify(userMerchantAliases)); } catch (e) { /* ignore */ }
    } else {
        userMerchantAliases = mpSanitizeAliases(readLocalJSON(localKey, {}));
    }
}

async function mpSetAlias(key, alias) {
    const clean = (alias || '').trim().slice(0, 20);
    const reset = !clean || clean.toLowerCase() === key;
    if (reset) delete userMerchantAliases[key]; else userMerchantAliases[key] = clean;
    if (!currentUser) return;   // 範例：只改畫面
    try { localStorage.setItem(`merchantAliases_${currentUser.uid}`, JSON.stringify(userMerchantAliases)); } catch (e) { /* ignore */ }
    try {
        if (window.db && window.doc && window.setDoc) {
            const value = reset ? (window.deleteField ? window.deleteField() : null) : clean;
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                merchantAliases: { [key]: value },
                updatedAt: new Date().toISOString()
            }, { merge: true });
        }
    } catch (error) {
        console.error('❌ [配卡] 商家名稱同步失敗（本機已保存）:', error);
    }
}

// 分組鍵：同一個商家不分大小寫（搜尋結果的 matchedItem 可能是「uber eats」也可能是「Uber Eats」）
function mpKeyOf(m) {
    return optimizeMerchantName(m.merchant).trim().toLowerCase();
}

// 顯示名稱：自訂名稱優先，否則用這組第一筆的原名
async function mpSetTitle(title) {
    let t = String(title || '').trim();
    if (t === MP_DEFAULT_TITLE) t = '';
    if (mpTitleUnits(t) > MP_TITLE_MAX) return;
    userMappingsTitle = t;
    if (!currentUser) return;   // 範例：只改畫面
    try { localStorage.setItem(`mappingsTitle_${currentUser.uid}`, t); } catch (e) { /* ignore */ }
    try {
        if (window.db && window.doc && window.setDoc) {
            await window.setDoc(window.doc(window.db, 'users', currentUser.uid), {
                mappingsTitle: t ? t : (window.deleteField ? window.deleteField() : ''),
                updatedAt: new Date().toISOString()
            }, { merge: true });
        }
    } catch (error) {
        console.error('❌ [配卡] 小抄標題同步失敗（本機已保存）:', error);
    }
}

function mpDisplayName(group) {
    return userMerchantAliases[group.key] || group.name;
}

// ============================================
// 分組／分類／拼音字首
// ============================================
const MP_CATS = ['行動支付', '餐飲', '網購', '超市超商', '交通', '旅遊', '娛樂', '其他'];
// 關鍵字 → 分類（依序比對，先中先贏；比對的是原名，不受改名影響）
const MP_CAT_RULES = [
    ['行動支付', ['line pay', 'linepay', '街口', '全支付', '悠遊付', 'apple pay', 'applepay', 'google pay', 'googlepay', 'samsung pay', '台灣pay', 'twpay', 'icash pay', 'icashpay', '一卡通money', 'ipass money', '全盈', '拍錢包', '橘子支付', 'easy wallet', 'pxpay', 'px pay', 'skm pay', 'open錢包', '行動支付']],
    ['餐飲', ['uber eats', 'ubereats', 'foodpanda', '麥當勞', '星巴克', '摩斯', '肯德基', '漢堡王', '必勝客', '達美樂', '路易莎', 'cama', '85度c', '王品', '饗賓', '饗a', 'eztable', 'inline', '餐廳', '咖啡', '拉麵', '燒肉', '壽司', '美食', '餐飲', '外送', '早餐', '手搖', '飲料', '50嵐', '清心', '迷客夏', '可不可', '八方雲集', '爭鮮', '瓦城', '鼎泰豐', '瘋pay']],
    ['網購', ['蝦皮', 'shopee', 'momo', '酷澎', 'coupang', 'pchome', 'yahoo', '露天', '淘寶', '天貓', 'amazon', '博客來', '東森購物', 'friday', '網購', '電商', '線上', '官網', 'books']],
    ['超市超商', ['全聯', '家樂福', '好市多', 'costco', '7-eleven', '7-11', '統一超商', '全家', '萊爾富', 'ok超商', '美廉社', '頂好', '愛買', '大潤發', '超市', '超商', '量販']],
    ['交通', ['高鐵', '台鐵', '捷運', 'uber', '計程車', 'yoxi', '大車隊', '悠遊卡', '一卡通', '加油', '中油', '台塑', '停車', 'etag', '客運', '公車', 'youbike', 'irent', 'gogoro', '交通']],
    ['旅遊', ['航空', 'agoda', 'booking', 'hotels.com', 'klook', 'kkday', 'expedia', 'trip.com', 'airbnb', '雄獅', '易遊網', '可樂旅遊', '飯店', '旅行', '旅遊', '海外', '國外', '日本', '韓國', '星宇', '華航', '長榮', '虎航', '樂桃', '酷航']],
    ['娛樂', ['ktv', '錢櫃', '好樂迪', '電影', '威秀', '國賓', '秀泰', 'netflix', 'spotify', 'disney', 'youtube', 'kkbox', 'steam', 'playstation', 'nintendo', 'switch', '遊戲', '串流', 'funnow', '樂園']]
];

function mpCategoryOf(name) {
    const n = String(name || '').toLowerCase();
    for (const [cat, words] of MP_CAT_RULES) {
        if (words.some(w => n.includes(w))) return cat;
    }
    return '其他';
}

// 拼音字首：瀏覽器內建的 pinyin collation（不需套件）。破音字靠 MP_POLY 補。
// 瀏覽器不支援 pinyin collation 時 MP_COLL 為 null，字首一律歸「#」、依一般排序。
const MP_COLL = (() => {
    try {
        const c = new Intl.Collator('zh-Hant-u-co-pinyin');
        return c.resolvedOptions().collation === 'pinyin' ? c : null;
    } catch (e) { return null; }
})();
const MP_BOUND = '阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥扨它穵夕丫帀';
const MP_LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ';
const MP_POLY = { '長': 'C', '重': 'C', '行': 'X', '樂': 'L', '廈': 'X', '曾': 'Z', '單': 'D' };

function mpLetterOf(s) {
    const ch = String(s || '').trim()[0] || '#';
    if (/[a-z]/i.test(ch)) return ch.toUpperCase();
    if (/[0-9]/.test(ch)) return '#';
    if (MP_POLY[ch]) return MP_POLY[ch];
    if (!MP_COLL) return '#';
    let r = '#';
    for (let i = 0; i < MP_BOUND.length; i++) {
        if (MP_COLL.compare(ch, MP_BOUND[i]) >= 0) r = MP_LETTERS[i]; else break;
    }
    return r;
}

function mpISO(d) {
    if (!d) return null;
    const s = String(d);
    return s.includes('-') ? s : (typeof slashDateToISO === 'function' ? slashDateToISO(s) : s);
}

function mpDaysLeft(end) {
    const iso = mpISO(end);
    if (!iso) return null;
    const endDate = parseISODate(iso), today = parseISODate(getTaiwanToday());
    if (!endDate || !today) return null;
    return Math.round((endDate - today) / 86400000);
}

// 配對 → 以商家分組。組序＝組內最小 order；組內依回饋率高→低。
function mpBuildGroups() {
    const list = mpList();
    list.forEach((m, i) => { if (m.order === undefined) m.order = i; });
    const byKey = new Map();
    list.forEach(m => {
        const key = mpKeyOf(m);
        if (!key) return;
        if (!byKey.has(key)) byKey.set(key, { key, name: optimizeMerchantName(m.merchant).trim(), order: m.order || 0, cat: mpCategoryOf(key), entries: [] });
        const g = byKey.get(key);
        g.order = Math.min(g.order, m.order || 0);
        const days = mpDaysLeft(m.periodEnd);
        const st = MP.status.get(m.id) || {};
        const dead = days !== null && days < 0 ? 'ended' : (st.dead || null);
        g.entries.push({ m, rate: Number(m.cashbackRate) || 0, end: mpISO(m.periodEnd), days, dead, labels: st.labels || [], cap: dead ? null : (st.cap || null), changed: !!st.changed, ext: !!st.ext });
    });
    const groups = [...byKey.values()];
    groups.forEach(g => {
        g.entries.sort((a, b) => (!!a.dead - !!b.dead) || (b.rate - a.rate));
        g.dead = g.entries.every(e => e.dead);
    });
    return groups;
}

function mpCmpName(a, b) {
    const na = mpDisplayName(a), nb = mpDisplayName(b);
    const la = mpLetterOf(na), lb = mpLetterOf(nb);
    if (la !== lb) return la === '#' ? 1 : lb === '#' ? -1 : la.localeCompare(lb);
    return MP_COLL ? MP_COLL.compare(na, nb) : na.localeCompare(nb, 'zh-Hant');
}

// 依排列方式分段：[{ key, title, items }]；自訂＝單一段（無標題）
function mpArrange(groups, sort) {
    if (sort === 'az') {
        const out = [];
        [...groups].sort(mpCmpName).forEach(g => {
            const l = mpLetterOf(mpDisplayName(g));
            if (!out.length || out[out.length - 1].key !== l) out.push({ key: l, title: l, items: [] });
            out[out.length - 1].items.push(g);
        });
        return out;
    }
    const byOrder = [...groups].sort((a, b) => a.order - b.order);
    if (sort === 'cat') {
        return MP_CATS.map(c => ({ key: c, title: c, items: byOrder.filter(g => g.cat === c) })).filter(s => s.items.length);
    }
    return [{ key: null, title: null, items: byOrder }];
}

// ============================================
// 失效檢查與「更新期限」
// ============================================
// 用站上同一支 calculateCardCashback() 重算：拿配對的卡片＋商家到最新資料裡找目前的活動。
// 只讀不寫；級別透過 getCardLevel() 讀用戶存的值，絕不回寫（鐵則 1）。
// 方案標籤只給「要切換方案」的卡（CUBE、Richart），其他卡只顯示 levelSettings 的等級。
// 活動的 category 長這樣：切換「全支付」方案、切換「慶生月」方案 - 美食、「固定回饋」方案 → 取「」裡的名稱。
const MP_PLAN_CARDS = ['cathay-cube', 'taishin-richart'];
function mpPlanLabel(cardId, category) {
    if (!MP_PLAN_CARDS.includes(cardId)) return null;
    const hit = String(category || '').match(/「([^」]+)」方案/);
    return hit ? hit[1].trim() : null;
}

// 活動封頂金額＝站上查詢結果「回饋消費上限」同一個值（calculateCardCashback 的 cap）
function mpCapText(cardId, cap) {
    const n = Number(cap);
    if (!cap || isNaN(n) || n <= 0) return '無消費上限';
    return `消費上限 NT$${Math.floor(n).toLocaleString()}${cardId === 'taishin-richart' ? '+' : ''}`;
}

function mpShortLevel(level) {
    const s = String(level || '').trim();
    const lv = s.match(/^level\s*(\d+)$/i);
    if (lv) return 'Lv' + lv[1];
    return s.replace(/等級$/, '');
}

async function mpProbe(m) {
    const card = cardsData && cardsData.cards ? cardsData.cards.find(c => c.id === m.cardId) : null;
    if (!card) return { dead: 'gone', labels: [], next: null, hasMatches: false, cap: null };
    const term = optimizeMerchantName(m.merchant).split('、')[0].trim();
    let matches = [];
    try {
        const r = await calculateCardCashback(card, term, 1000);
        matches = Array.isArray(r) ? r : [];
    } catch (error) {
        console.error('❌ [配卡] 重算失敗:', m.merchant, error);
        return { dead: null, labels: [], next: null, hasMatches: true, error: true, cap: null };
    }
    const labels = [];
    if (card.hasLevels && card.levelSettings && Object.keys(card.levelSettings).length) {
        try {
            const def = Object.keys(card.levelSettings)[0];
            const { level } = await resolveCardLevel(card, def);
            if (level) labels.push(mpShortLevel(level));
        } catch (e) { /* 顯示用，失敗就不顯示 */ }
    }
    const rate = Number(m.cashbackRate) || 0;
    const same = matches.filter(x => Math.abs((Number(x.rate) || 0) - rate) < 0.001);
    const endOf = x => mpISO(x.matchedRateGroup && x.matchedRateGroup.periodEnd) || null;
    let next = null, cap = null;
    if (same.length) {
        const best = same.slice().sort((a, b) => String(endOf(b) || '9999-12-31').localeCompare(String(endOf(a) || '9999-12-31')))[0];
        next = { rate, end: endOf(best), start: mpISO(best.matchedRateGroup && best.matchedRateGroup.periodStart) || null };
        const plan = mpPlanLabel(card.id, best.matchedCategory);
        if (plan) labels.push(plan);
        cap = mpCapText(card.id, best.cap);
    }
    // 回饋率已變：列出目前資料裡這張卡＋商家的活動（同回饋率只留一筆，取期限最晚），讓用戶自己確認要更新成哪一個
    const cands = [];
    if (!same.length) {
        matches.forEach(x => {
            const r = Number(x.rate) || 0;
            const c = { rate: r, end: endOf(x), start: mpISO(x.matchedRateGroup && x.matchedRateGroup.periodStart) || null, category: x.matchedCategory || '' };
            const i = cands.findIndex(y => Math.abs(y.rate - r) < 0.001);
            if (i < 0) cands.push(c);
            else if ((c.end || '9999-12-31') > (cands[i].end || '9999-12-31')) cands[i] = c;
        });
        cands.sort((a, b) => b.rate - a.rate);
    }
    return { dead: matches.length ? null : 'gone', labels, next, cap, hasMatches: matches.length > 0, newRates: matches.map(x => Number(x.rate) || 0), cands };
}

async function mpProbeAll() {
    if (MP.probing) return MP.probing;
    MP.probing = (async () => {
        const list = mpList().slice();
        for (const m of list) {
            const prev = MP.status.get(m.id) || {};
            const r = await mpProbe(m);
            MP.status.set(m.id, { ...prev, dead: r.dead, labels: r.labels, cap: r.cap, next: r.next, hasMatches: r.hasMatches, newRates: r.newRates || [], cands: r.cands || [], changed: !!(r.cands && r.cands.length) });
        }
        MP.probed = true;
        MP.probing = null;
        if (MP.open) mpRender();
    })();
    return MP.probing;
}

async function mpUpdateDeadlines() {
    await mpProbeAll();
    let ext = 0;
    const changed = [];
    mpList().forEach(m => {
        const st = MP.status.get(m.id) || {};
        const curEnd = mpISO(m.periodEnd);
        if (st.next) {
            // 回饋率不變 → 期限換成最新活動的期限（條件改了也算，只要回饋率一樣）
            const newEnd = st.next.end;
            if ((newEnd || '9999-12-31') > (curEnd || '9999-12-31') || (curEnd && !newEnd)) {
                m.periodEnd = newEnd;
                m.periodStart = st.next.start;
                MP.status.set(m.id, { ...st, ext: true, dead: null });
                ext++;
            }
        } else if (st.hasMatches) {
            MP.status.set(m.id, { ...st, changed: true });
            const rates = [...new Set(st.newRates || [])].join('／');
            changed.push(`${userMerchantAliases[mpKeyOf(m)] || optimizeMerchantName(m.merchant)}（${m.cardName} ${m.cashbackRate}% → ${rates}%）`);
        }
    });
    if (ext > 0) await mpPersist();
    MP.updated = { ext, changed };
    if (window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'mappings_update_deadlines', { extended: ext, changed: changed.length });
    }
    mpRender();
}

// ============================================
// 頁面開關與網址 /mappings
// ============================================
function mpEl(id) { return document.getElementById(id); }

// 頁籤切換「畫面」：index.html 裡每個畫面的容器都標 data-view（search／mappings），
// 同一個畫面可能分成好幾塊（查詢回饋＝#view-search＋#view-search-extras），一起顯示或隱藏
function setAppView(name) {
    document.querySelectorAll('[data-view]').forEach(el => { el.hidden = el.dataset.view !== name; });
    document.body.dataset.appView = name;
}

// 切到「我的配卡組合」：顯示在頁籤下方，查詢回饋畫面隱藏，不是蓋住整頁的覆蓋層
function mpSetSwitchState(onMappings) {
    const a = mpEl('home-view-switch-search'), b = mpEl('home-view-switch-mappings');
    if (a) { a.classList.toggle('on', !onMappings); a.setAttribute('aria-pressed', String(!onMappings)); }
    if (b) { b.classList.toggle('on', onMappings); b.setAttribute('aria-pressed', String(onMappings)); }
    setAppView(onMappings ? 'mappings' : 'search');
}

async function openMappingsPage(options = {}) {
    const page = mpEl('mappings-page');
    if (!page) return;
    if (!MP.prefs) mpLoadPrefs();
    if (!MP.open) {
        MP.open = true;
        page.hidden = false;
        mpSetSwitchState(true);
        if (!options.fromHistory && location.pathname !== '/mappings') {
            try { history.pushState({ mappingsPage: true }, '', '/mappings'); MP.pushed = true; } catch (e) { MP.pushed = false; }
        }
        // 切換鈕捲出畫面時才捲回來（從頁面下方切過來的情況）
        const sw = mpEl('home-view-switch');
        if (sw && sw.getBoundingClientRect().top < 0) sw.scrollIntoView({ block: 'start' });
        if (window.logEvent && window.firebaseAnalytics) window.logEvent(window.firebaseAnalytics, 'open_mappings_page', {});
    }
    // 登入中、雲端狀態未確認、手上是空的 → 補讀一次（沿用舊 modal 的保護）
    if (currentUser && mappingsLoadState !== 'ok' && (!userSpendingMappings || userSpendingMappings.length === 0)) {
        await loadSpendingMappings();
    }
    MP.updated = null;
    if (!currentUser) await mpBuildDemo();
    mpRender();
    if (mpList().length) mpProbeAll();
}

function closeMappingsPage(options = {}) {
    const page = mpEl('mappings-page');
    if (!page || !MP.open) return;
    MP.open = false;
    page.hidden = true;
    mpCloseExport();
    mpCloseSheets();
    mpSetSwitchState(false);
    if (!options.fromHistory && location.pathname === '/mappings') {
        if (MP.pushed) history.back();
        else { try { history.replaceState(null, '', '/'); } catch (e) { /* ignore */ } }
    }
    MP.pushed = false;
    if (typeof updatePinButtonsState === 'function') updatePinButtonsState();
}

// 登入／登出完成後由 auth-user-data.js 呼叫：更新首頁切換鈕、若網址是 /mappings 就開頁
// 切換鈕登入與否都顯示（未登入切過去看範例＋登入提示）；登入狀態改變時重畫
function updateMappingsSwitch() {
    const sw = mpEl('home-view-switch');
    if (sw) sw.hidden = false;
    if (MP.open) mpRender();
}

function refreshMappingsEntry() {
    updateMappingsSwitch();
    if (currentUser) MP.demo = null;
    MP.prefs = null;
    MP.status.clear();
    MP.probed = false;
    if (location.pathname === '/mappings') openMappingsPage({ fromHistory: true });
    else if (MP.open) { mpLoadPrefs(); mpRender(); }
}

// ============================================
// 收據 HTML
// ============================================
const MP_ICON = {
    chev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6"/></svg>',
    pen: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.15.85a1.5 1.5 0 0 1 2.12 0l.88.88a1.5 1.5 0 0 1 0 2.12L5.6 13.4l-3.9.95.95-3.9L12.15.85Z"/></svg>',
    card: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 4.5A1.5 1.5 0 0 1 2.5 3h11A1.5 1.5 0 0 1 15 4.5V5H1v-.5ZM1 7h14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 11.5V7Zm2 3v1h3v-1H3Z"/></svg>',
    grip: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="3" r="1.3"/><circle cx="10" cy="3" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="13" r="1.3"/><circle cx="10" cy="13" r="1.3"/></svg>',
    one: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="12" height="2" rx="1"/><rect x="2" y="7" width="12" height="2" rx="1"/><rect x="2" y="11" width="12" height="2" rx="1"/></svg>',
    two: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="5" height="4" rx="1"/><rect x="9" y="3" width="5" height="4" rx="1"/><rect x="2" y="9" width="5" height="4" rx="1"/><rect x="9" y="9" width="5" height="4" rx="1"/></svg>',
    upd: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 3a5 5 0 0 0-4.55 2.93.75.75 0 1 1-1.37-.62A6.5 6.5 0 0 1 13.5 4.4V2.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.6A5 5 0 0 0 8 3Zm5.92 6.46a.75.75 0 0 1 .38.99A6.5 6.5 0 0 1 2.5 11.6v1.65a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 1.75 9h3.5a.75.75 0 0 1 0 1.5h-1.6a5 5 0 0 0 9.28-.66.75.75 0 0 1 .99-.38Z"/></svg>',
    dl: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1a.75.75 0 0 1 .75.75v6.69l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V1.75A.75.75 0 0 1 8 1ZM2.75 12a.75.75 0 0 1 .75.75v.75h9v-.75a.75.75 0 0 1 1.5 0v1.5a.75.75 0 0 1-.75.75H2.75a.75.75 0 0 1-.75-.75v-1.5a.75.75 0 0 1 .75-.75Z"/></svg>'
};

// Code 128（字元集 B）。模組序列已用 python-barcode 比對一致；內容固定 PICKMYCARD.APP
const MP_C128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232'.split(' ');
const MP_BARCODE_TEXT = 'PICKMYCARD.APP';

// 回傳 [{x, w}] 黑條（單位＝模組，前後各留 10 模組靜區）＋總寬
function mpBarcodeBars(text) {
    const vals = [104, ...[...text].map(ch => ch.charCodeAt(0) - 32)];
    const chk = vals.slice(1).reduce((sum, v, i) => sum + (i + 1) * v, 104) % 103;
    const pats = [...vals, chk].map(v => MP_C128[v]).concat('2331112');
    const bars = [];
    let x = 10;
    pats.forEach(pt => [...pt].forEach((w, i) => { w = +w; if (i % 2 === 0) bars.push({ x, w }); x += w; }));
    return { bars, width: x + 10 };
}

function mpBarcodeSvg() {
    const { bars, width } = mpBarcodeBars(MP_BARCODE_TEXT);
    return `<svg class="mp-barcode" viewBox="0 0 ${width} 30" preserveAspectRatio="none" fill="currentColor" role="img" aria-label="條碼：${MP_BARCODE_TEXT}">${bars.map(b => `<rect x="${b.x}" y="0" width="${b.w}" height="30"/>`).join('')}</svg>`;
}

function mpMonthLabel() {
    return getTaiwanToday().slice(0, 7);
}

function mpDueText(e) {
    if (e.dead === 'ended') return '已結束';
    if (e.dead === 'gone') return '已下架';
    if (!e.end) return '長期';
    const [y, mo, d] = e.end.split('-');
    return `${y !== MP_TODAY_YEAR() ? y.slice(2) + '/' : ''}${+mo}/${+d}`;
}

function mpIsHot(e) { return !e.dead && e.days !== null && e.days >= 0 && e.days <= 7; }

function mpCardName(cardId, fallback) {
    const c = cardsData && cardsData.cards ? cardsData.cards.find(x => x.id === cardId) : null;
    return (c && c.name) || fallback || '';
}

function mpReceiptHtml(sections, o) {
    const esc = escapeHtml;
    const star = g => g.dead ? '<span class="mp-star" aria-label="已失效">*</span>' : '';
    const name = g => `<button type="button" class="mp-nm" data-mp-edit="${esc(g.key)}" title="點一下改顯示名稱">${esc(mpDisplayName(g))}${star(g)}${userMerchantAliases[g.key] ? `<span class="mp-pen">${MP_ICON.pen}</span>` : ''}</button>`;
    const grip = () => o.drag ? `<span class="mp-grip" data-mp-grip title="拖曳調整順序" aria-hidden="true">${MP_ICON.grip}</span>` : '';
    const thumb = e => `<button type="button" class="mp-cardbtn" data-mp-card="${esc(e.m.cardId)}" title="查看 ${esc(mpCardName(e.m.cardId, e.m.cardName))} 詳情"><img class="mp-th" src="assets/images/cards/${esc(e.m.cardId)}.png" alt="${esc(mpCardName(e.m.cardId, e.m.cardName))}" onerror="this.style.visibility='hidden'"></button>`;
    const due = e => `<span class="mp-due${mpIsHot(e) ? ' hot' : ''}${e.ext ? ' ext' : ''}">${esc(mpDueText(e))}</span>`;
    const flag = e => e.changed ? `<button type="button" class="mp-flag" data-mp-changed="${esc(e.m.id)}" title="點一下看新的回饋率">回饋已變</button>` : '';
    const labs = e => o.labels && e.labels.length ? `<span class="mp-labs">${e.labels.map(l => `<span class="mp-lab">${esc(l)}</span>`).join('')}</span>` : '';
    const rate = e => `<span class="mp-rate">${esc(String(e.rate))}%</span>`;
    const capOf = e => o.caps && e.cap ? `<span class="mp-cap">${esc(e.cap)}</span>` : '';
    // 第二行：勾了「顯示活動封頂金額」→ 等級／方案標籤＋封頂金額一起放第二行
    const row2 = e => o.caps && (capOf(e) || labs(e)) ? `<div class="mp-row2">${labs(e)}${capOf(e)}</div>` : '';
    const sec = s => s.title === null ? '' : (!o.demo && MP.prefs.sort === 'az'
        ? `<div class="mp-sec az"><span class="mp-ltr">${esc(s.title)}</span></div>`
        : `<div class="mp-sec${s.key === '行動支付' ? ' pay' : ''}">${esc(s.title)}</div>`);

    let body;
    if (!sections.length) {
        body = '<p class="mp-none">找不到符合的商家</p>';
    } else if (o.layout === 'E') {
        body = `<div class="mp-e-grid">${sections.map(s => sec(s) + s.items.map(g => `<div class="mp-e-cell${g.dead ? ' mp-dead' : ''}" data-mp-row="${esc(g.key)}"><div class="mp-e-name">${grip()}${name(g)}</div>${g.entries.map((e, i) => `<div class="mp-e-line${i ? ' mp-alt' : ''}${e.dead ? ' mp-dead' : ''}">${thumb(e)}${rate(e)}${flag(e)}${due(e)}</div>${capOf(e) ? `<div class="mp-e-cap">${capOf(e)}</div>` : ''}`).join('')}</div>`).join('')).join('')}</div>`;
    } else {
        body = '<div class="mp-colhead"><span>商家</span><span class="mp-cols"><span>卡</span><span>回饋</span><span>期限</span></span></div>' +
            sections.map(s => sec(s) + s.items.map(g => `<div class="mp-f-row${g.dead ? ' mp-dead' : ''}" data-mp-row="${esc(g.key)}"><div class="mp-f-lead">${grip()}${name(g)}</div>${g.entries.map((e, i) => `<div class="mp-f-pick${i ? ' mp-alt' : ''}${e.dead ? ' mp-dead' : ''}${row2(e) ? ' has-row2' : ''}">${row2(e) ? '' : flag(e)}${o.caps ? '' : labs(e)}<div class="mp-f-cols">${thumb(e)}${rate(e)}${due(e)}</div>${row2(e)}${row2(e) ? flag(e) : ''}</div>`).join('')}</div>`).join('')).join('');
    }
    const anyDead = sections.some(s => s.items.some(g => g.dead || g.entries.some(e => e.dead)));
    const note = anyDead ? '<div class="mp-note"><b>*</b> 活動已結束或有更動。點商家名稱可以移除。記得回網站更新最新活動！</div>' : '';
    return `<div class="mp-rc${o.big ? ' lg' : ''}">
        <div class="mp-rc-head"><span class="mp-store">PICK MY CARD<i>▪</i>${esc(mpMonthLabel())}</span><button type="button" class="mp-title mp-title-btn" id="mp-title-btn" title="點一下修改標題">${esc(mpTitle())}</button></div>
        <div class="mp-eq" aria-hidden="true">${'='.repeat(80)}</div>
        ${body}${note}
        <div class="mp-foot">${mpBarcodeSvg()}<span class="mp-url">PICKMYCARD.APP</span></div>
    </div>`;
}

// ============================================
// 頁面渲染
// ============================================
// 「顯示等級／方案」常駐；雙欄放不下標籤，改成灰色不可勾（不改用戶存的勾選值）
function mpCapsChk(id, p) {
    return `<label class="mp-chk"><input type="checkbox" id="${id}" ${p.caps ? 'checked' : ''}>顯示活動封頂金額</label>`;
}
function mpLabelsChk(id, p) {
    const two = p.layout !== 'F';
    return `<label class="mp-chk${two ? ' dis' : ''}"${two ? ' title="雙欄放不下等級／方案標籤，切回單欄才能顯示"' : ''}><input type="checkbox" id="${id}" ${p.labels && !two ? 'checked' : ''} ${two ? 'disabled' : ''}>顯示等級／方案</label>`;
}

function mpSegHtml(name, cur, opts) {
    return `<div class="mp-seg" role="group" aria-label="${escapeHtml(name)}">${opts.map(([v, label, aria]) => `<button type="button" data-mp-${name === '排列方式' ? 'sort' : name === '版面' ? 'layout' : name === '字級' ? 'size' : 'x'}="${v}" class="${cur === v ? 'on' : ''}"${aria ? ` aria-label="${aria}" title="${aria}"` : ''}>${label}</button>`).join('')}</div>`;
}

// 未登入時的範例小抄：用站上同一支 calculateCardCashback()（訪客的預設級別）算出真實回饋率
const MP_DEMO_PAIRS = [['taishin-richart', 'Line Pay'], ['yushan-unicard', 'Uber Eats'], ['hsbc-liveplus', '麥當勞'],
    ['taishin-richart', 'momo'], ['cathay-cube', '全聯'], ['yushan-unicard', '高鐵'], ['sinopac-dawho', '國外']];
async function mpBuildDemo() {
    if (MP.demo || !cardsData || !cardsData.cards) return MP.demo;
    const list = [];
    for (const [cardId, term] of MP_DEMO_PAIRS) {
        const card = cardsData.cards.find(c => c.id === cardId);
        if (!card) continue;
        let r = [];
        try { r = await calculateCardCashback(card, term, 1000); } catch (e) { r = []; }
        const x = Array.isArray(r) && r[0];
        if (!x) continue;
        list.push({ id: 'demo_' + list.length, cardId, cardName: card.name, merchant: String(x.matchedItem || term), cashbackRate: x.rate,
            periodEnd: mpISO(x.matchedRateGroup && x.matchedRateGroup.periodEnd) || null,
            periodStart: mpISO(x.matchedRateGroup && x.matchedRateGroup.periodStart) || null, order: list.length, demo: true });
    }
    if (!currentUser) MP.demo = list;
    return list;
}

function mpRender() {
    if (!MP.open) return;
    if (!MP.prefs) mpLoadPrefs();
    const p = MP.prefs;
    const tools = mpEl('mp-tools'), list = mpEl('mp-list'), notice = mpEl('mp-notice'), tip = mpEl('mp-tip');
    if (!tools || !list) return;

    tools.innerHTML = `
        <div class="mp-bar">
            ${mpSegHtml('排列方式', p.sort, [['custom', '自訂'], ['az', 'A–Z'], ['cat', '分類']])}
            <span class="mp-grow"></span>
            ${mpSegHtml('字級', p.size, [['small', '<span class="mp-a-s">A</span>', '小字'], ['large', '<span class="mp-a-l">A</span>', '大字']])}
            ${mpSegHtml('版面', p.layout, [['F', MP_ICON.one, '單欄'], ['E', MP_ICON.two, '雙欄']])}
        </div>
        <div class="mp-bar">
            ${mpLabelsChk('mp-labels-toggle', p)}
            ${mpCapsChk('mp-caps-toggle', p)}
            <span class="mp-grow"></span>
            <button type="button" class="mp-upd" id="mp-update-btn" ${MP.updated || !mpList().length ? 'disabled' : ''}>${MP_ICON.upd}${MP.updated ? '期限已是最新' : '更新期限'}</button>
        </div>`;

    // 編輯模式：設定、提示列、拖曳把手只在按「編輯」後出現；預設只看乾淨的小抄＋搜尋框
    tools.hidden = !MP.editing;
    const layoutEl = mpEl('mappings-page') && mpEl('mappings-page').querySelector('.mp-layout');
    if (layoutEl) layoutEl.classList.toggle('editing', MP.editing);
    const editBtn = mpEl('mp-edit-toggle');
    if (editBtn) { editBtn.textContent = MP.editing ? '完成' : '編輯'; editBtn.classList.toggle('on', MP.editing); editBtn.setAttribute('aria-pressed', String(MP.editing)); }
    // 提示列的文字寫在 index.html；這裡只控制「拖曳」那句（只有自訂排列才顯示）
    if (tip) tip.querySelectorAll('.mp-tip-drag').forEach(el => { el.hidden = !(p.sort === 'custom' && !MP.search); });

    if (notice) {
        if (MP.updated) {
            const u = MP.updated;
            const head = u.ext ? `已更新 ${u.ext} 筆截止日期` : '沒有需要延長的期限';
            notice.innerHTML = `<b>${escapeHtml(head)}</b>` + (u.ext ? '（回饋率不變，期限延長，日期下有點狀底線）' : '') +
                (u.changed.length ? `<span class="bad">${u.changed.length} 筆回饋率變了，沒有自動更新：${u.changed.map(escapeHtml).join('、')}。請重新搜尋後再加到我的配卡。</span>` : '');
            notice.hidden = false;
        } else notice.hidden = true;
    }

    const saveBtns = document.querySelectorAll('[data-mp-open-export]');
    const guest = mpEl('mp-guest'), searchbox = mpEl('mp-searchbox'), savebar = mpEl('mp-savebar'), deadbarEl = mpEl('mp-deadbar');
    const show = (el, on) => { if (el) el.hidden = !on; };
    // 未登入：範例清單（可以照樣排列、改名、存圖，只是不保存）＋登入提示；鎖起來的只有「加到我的配卡」
    show(guest, !currentUser);
    const demoTag = mpEl('mp-demo-tag');
    if (demoTag) demoTag.hidden = !!currentUser;
    if (!currentUser && !MP.demo) {
        list.innerHTML = '<div class="mp-empty"><p>範例載入中…</p></div>';
        mpBuildDemo().then(() => { if (MP.open && !currentUser && MP.demo) { mpRender(); mpProbeAll(); } });
        show(searchbox, false); show(savebar, false); show(deadbarEl, false); show(tip, false);
        return;
    }
    // 空狀態（讀取失敗／真的沒資料）
    const mappings = mpList();
    show(searchbox, mappings.length > 0); show(savebar, mappings.length > 0); show(tip, MP.editing && mappings.length > 0);
    if (!mappings.length) {
        let title, hint, retry = false;
        show(deadbarEl, false); show(tip, false);
        if (mappingsLoadState === 'error') { title = '配卡讀取失敗'; hint = '你的配卡還在雲端，只是這次沒讀到（網路不穩或 App 剛冷啟動）。請確認連線後重試。'; retry = true; }
        else { title = '還沒有配卡記錄'; hint = '在查詢結果的卡片上按「加到我的配卡」，就會出現在這張刷卡小抄裡'; }
        list.innerHTML = `<div class="mp-empty"><p class="mp-empty-title">${escapeHtml(title)}</p><p>${escapeHtml(hint)}</p>` +
            (retry ? '<button type="button" class="mp-retry" id="mp-retry-btn">重新載入</button>' : '') + '</div>';
        saveBtns.forEach(b => { b.disabled = true; });
        tools.classList.add('mp-disabled');
        return;
    }
    tools.classList.remove('mp-disabled');
    saveBtns.forEach(b => { b.disabled = false; });

    let groups = mpBuildGroups();
    if (MP.search) {
        const t = MP.search.toLowerCase();
        groups = groups.filter(g => g.key.includes(t) || mpDisplayName(g).toLowerCase().includes(t) ||
            g.entries.some(e => mpCardName(e.m.cardId, e.m.cardName).toLowerCase().includes(t)));
    }
    const sections = mpArrange(groups, p.sort);
    list.innerHTML = mpReceiptHtml(sections, {
        layout: p.layout, labels: p.layout === 'F' && p.labels, caps: p.caps, big: p.size === 'large',
        drag: MP.editing && p.sort === 'custom' && !MP.search
    });
    mpFitRows();

    const deadbar = mpEl('mp-deadbar');
    if (deadbar) {
        // 「刪除全部失效活動」屬於整理動作，跟其他設定一樣按「編輯」後才出現
        const n = MP.search || !MP.editing ? 0 : mpDeadIds().length;
        deadbar.hidden = n === 0;
        deadbar.innerHTML = n ? `<button type="button" class="mp-btn-danger" id="mp-delete-dead">${escapeHtml(`刪除全部失效活動（${n}）`)}</button>` : '';
    }
}

// 單欄小字：等級標籤排在回饋率左邊時，若把商家名稱擠到換行，就把標籤移到下一行（名稱優先）
function mpFitRows() {
    const list = mpEl('mp-list');
    if (!list || MP.prefs.layout !== 'F' || MP.prefs.size === 'large' || MP.prefs.caps) return;
    list.querySelectorAll('.mp-f-row').forEach(row => {
        if (!row.querySelector('.mp-labs')) return;
        row.classList.remove('mp-labs-below');
        const nm = row.querySelector('.mp-nm');
        const lh = parseFloat(getComputedStyle(nm).lineHeight) || 20;
        if (nm.getBoundingClientRect().height > lh * 1.4) row.classList.add('mp-labs-below');
    });
}

// ============================================
// 拖曳排序（自訂）：move/up 掛 document，不用 setPointerCapture（見 ui-display.md 教訓）
// ============================================
function mpStartDrag(e) {
    const grip = e.target.closest('[data-mp-grip]');
    if (!grip) return;
    e.preventDefault();
    const row = grip.closest('[data-mp-row]');
    const list = mpEl('mp-list');
    if (!row || !list) return;
    row.classList.add('mp-dragging');
    let moved = false;
    const vertical = MP.prefs.layout !== 'E';
    const onMove = ev => {
        const rows = [...list.querySelectorAll('[data-mp-row]')].filter(el => el !== row);
        for (const sib of rows) {
            const r = sib.getBoundingClientRect();
            const hit = ev.clientY > r.top && ev.clientY < r.bottom && (vertical || (ev.clientX > r.left && ev.clientX < r.right));
            if (!hit) continue;
            const before = vertical ? ev.clientY < r.top + r.height / 2 : ev.clientX < r.left + r.width / 2;
            const target = before ? sib : sib.nextSibling;
            if (target !== row && target !== row.nextSibling) { sib.parentNode.insertBefore(row, target); moved = true; }
            break;
        }
    };
    const onUp = async () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        row.classList.remove('mp-dragging');
        if (!moved) return;
        const keys = [...list.querySelectorAll('[data-mp-row]')].map(el => el.dataset.mpRow);
        const rank = new Map(keys.map((k, i) => [k, i]));
        const sorted = mpList().slice().sort((a, b) =>
            ((rank.get(mpKeyOf(a)) ?? 1e9) - (rank.get(mpKeyOf(b)) ?? 1e9)) || ((a.order || 0) - (b.order || 0)));
        sorted.forEach((m, i) => { m.order = i; });
        await mpPersist();
        mpRender();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

// ============================================
// 改名面板（也是移除配對的地方）
// ============================================
function mpCloseSheets() {
    ['mp-edit-sheet', 'mp-title-sheet', 'mp-rate-sheet'].forEach(id => { const sh = mpEl(id); if (sh) sh.hidden = true; });
    MP.editKey = null;
    MP.rateId = null;
}

function mpAnySheetOpen() {
    return ['mp-edit-sheet', 'mp-title-sheet', 'mp-rate-sheet'].some(id => mpEl(id) && !mpEl(id).hidden);
}

// ---- 小抄標題 ----
function mpOpenTitleSheet() {
    const sheet = mpEl('mp-title-sheet');
    if (!sheet) return;
    const input = mpEl('mp-title-input');
    input.value = mpTitle();
    mpTitleCount();
    sheet.hidden = false;
    setTimeout(() => { try { input.focus({ preventScroll: true }); input.select(); } catch (err) { /* ignore */ } }, 50);
}

function mpTitleCount() {
    const input = mpEl('mp-title-input'), cnt = mpEl('mp-title-count'), save = mpEl('mp-title-save');
    // 超過上限就把多的字截掉（中文字 1、英數 0.6），不讓標題換行
    let v = input.value;
    while (mpTitleUnits(v) > MP_TITLE_MAX) v = [...v].slice(0, -1).join('');
    if (v !== input.value) input.value = v;
    const u = mpTitleUnits(v);
    cnt.textContent = `${Math.ceil(u * 10) / 10} / ${MP_TITLE_MAX}`;
    cnt.classList.toggle('over', u >= MP_TITLE_MAX);
    save.disabled = !v.trim();
}

async function mpSaveTitle(reset) {
    await mpSetTitle(reset ? '' : mpEl('mp-title-input').value);
    mpCloseSheets();
    mpRender();
}

// ---- 回饋率已變：顯示新舊回饋率，讓用戶確認更新 ----
function mpOpenRateSheet(id) {
    const m = mpList().find(x => x.id === id);
    const st = MP.status.get(id) || {};
    const sheet = mpEl('mp-rate-sheet');
    if (!m || !sheet || !(st.cands && st.cands.length)) return;
    MP.rateId = id;
    const esc = escapeHtml;
    const endTxt = d => d ? `至 ${d.replace(/-/g, '/')}` : '無期限';
    const name = userMerchantAliases[mpKeyOf(m)] || optimizeMerchantName(m.merchant);
    mpEl('mp-rate-body').innerHTML =
        `<p><b>${esc(name)}</b>・${esc(mpCardName(m.cardId, m.cardName))}</p>` +
        `<div class="mp-rate-old">原本加入時：<b>${esc(String(m.cashbackRate))}%</b>（${esc(endTxt(mpISO(m.periodEnd)))}）</div>` +
        `<p>目前資料裡的回饋率${st.cands.length > 1 ? '有幾種（依方案、條件不同）' : ''}，要更新成：</p>` +
        st.cands.map((c, i) => `<button type="button" class="mp-rate-opt" data-mp-rate-pick="${i}">更新成 ${esc(String(c.rate))}%（${esc(endTxt(c.end))}）${c.category ? `<br><small>${esc(c.category)}</small>` : ''}</button>`).join('');
    sheet.hidden = false;
}

async function mpApplyRate(idx) {
    const id = MP.rateId;
    const m = mpList().find(x => x.id === id);
    const st = MP.status.get(id) || {};
    const c = st.cands && st.cands[idx];
    if (!m || !c) return;
    m.cashbackRate = c.rate;
    m.lastCheckedRate = c.rate;
    m.lastCheckedTime = Date.now();
    m.periodEnd = c.end;
    m.periodStart = c.start;
    await mpPersist();
    if (window.logEvent && window.firebaseAnalytics) window.logEvent(window.firebaseAnalytics, 'mappings_update_rate', { card_id: m.cardId, merchant: m.merchant, rate: c.rate });
    mpCloseSheets();
    const r = await mpProbe(m);   // 重新判斷標籤與狀態
    MP.status.set(m.id, { dead: r.dead, labels: r.labels, cap: r.cap, next: r.next, hasMatches: r.hasMatches, newRates: r.newRates || [], cands: r.cands || [], changed: !!(r.cands && r.cands.length) });
    mpRender();
}

// ---- 刪除全部失效活動 ----
function mpDeadIds() {
    return mpBuildGroups().flatMap(g => g.entries.filter(e => e.dead).map(e => e.m.id));
}

async function mpDeleteAllDead() {
    const ids = new Set(mpDeadIds());
    if (!ids.size) return;
    mpSetList(mpList().filter(m => !ids.has(m.id)));
    ids.forEach(id => MP.status.delete(id));
    await mpPersist();
    if (window.logEvent && window.firebaseAnalytics) window.logEvent(window.firebaseAnalytics, 'mappings_delete_dead', { count: ids.size });
    if (typeof updatePinButtonsState === 'function') updatePinButtonsState();
    mpRender();
}

function mpOpenEditSheet(key) {
    const g = mpBuildGroups().find(x => x.key === key);
    const sheet = mpEl('mp-edit-sheet');
    if (!g || !sheet) return;
    MP.editKey = key;
    const esc = escapeHtml;
    const dead = g.entries.find(e => e.dead);
    const status = g.dead
        ? (dead.dead === 'ended'
            ? `* 這個活動 ${esc((dead.end || '').replace(/-/g, '/'))} 已結束。建議移除，或重新搜尋「${esc(g.name)}」找其他卡。`
            : `* ${esc(mpCardName(dead.m.cardId, dead.m.cardName))} 目前已不再提供這個商家的回饋。建議移除，或重新搜尋「${esc(g.name)}」找其他卡。`)
        : '';
    mpEl('mp-edit-status').innerHTML = status;
    mpEl('mp-edit-status').hidden = !status;
    const input = mpEl('mp-edit-input');
    input.value = userMerchantAliases[key] || g.name;
    mpEl('mp-edit-orig').textContent = g.name;
    mpEl('mp-edit-reset').disabled = !userMerchantAliases[key];
    const multi = g.entries.length > 1;
    mpEl('mp-edit-remove').innerHTML = g.entries.map(e => {
        const label = e.dead ? '刪除這個失效活動' : '刪除這個活動';
        const which = multi ? `（${mpCardName(e.m.cardId, e.m.cardName)} ${e.rate}%）` : '';
        return `<button type="button" class="mp-btn-danger" data-mp-remove="${esc(e.m.id)}">${esc(label + which)}</button>`;
    }).join('');
    sheet.hidden = false;
    setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }, 50);
}

async function mpSaveEdit(reset) {
    const key = MP.editKey;
    if (!key) return;
    const v = reset ? '' : mpEl('mp-edit-input').value;
    await mpSetAlias(key, v);
    mpCloseSheets();
    mpRender();
}

async function mpRemoveMapping(id) {
    const m = mpList().find(x => x.id === id);
    if (currentUser) await removeMapping(id);
    else mpSetList(mpList().filter(x => x.id !== id));
    MP.status.delete(id);
    if (m && window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'remove_mapping', { card_id: m.cardId, card_name: m.cardName, merchant: m.merchant, rate: m.cashbackRate });
    }
    mpCloseSheets();
    updateMappingsSwitch();
    mpRender();
}

// ============================================
// 存成圖片：canvas 直接繪製（預覽＝實際輸出的那張圖）
// ============================================
const MP_RATIOS = {
    iphone: { label: 'iPhone', w: 1179, h: 2556, desc: 'iPhone X 之後' },
    android: { label: 'Android', w: 1080, h: 2400, desc: '多數 Android' },
    old: { label: '16:9', w: 1080, h: 1920, desc: 'iPhone 8／SE 等舊機（全螢幕 iPhone 用它會被裁掉左右）' }
};

// 手機上讀實際螢幕：screen 寬高（CSS px，直向）× devicePixelRatio。桌機、平板或讀不到 → null
function mpDetectScreen() {
    try {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const sw = Math.min(screen.width, screen.height), sh = Math.max(screen.width, screen.height);
        if (!coarse || !sw || !sh || sw >= 600) return null;
        const dpr = window.devicePixelRatio || 1;
        return { w: Math.round(sw * dpr), h: Math.round(sh * dpr) };
    } catch (e) { return null; }
}

function mpWallSize() {
    const r = MP.prefs.ratio;
    if (r !== 'auto' && MP_RATIOS[r]) return { w: MP_RATIOS[r].w, h: MP_RATIOS[r].h, label: MP_RATIOS[r].label };
    const d = mpDetectScreen();
    if (d) return { w: d.w, h: d.h, label: '本機螢幕' };
    return { w: MP_RATIOS.iphone.w, h: MP_RATIOS.iphone.h, label: 'iPhone' };
}

const MP_THEME = {
    light: { bg: '#e6e9ee', paper: '#fffffd', ink: '#1a1d23', sub: '#6b7280', rule: '#cfd4dc', pay: '#ea580c', cat: '#1d4ed8', hotBg: '#1a1d23', hotFg: '#fffffd' },
    dark: { bg: '#0f1013', paper: '#232427', ink: '#efe8d8', sub: '#a39d90', rule: '#43454b', pay: '#fb923c', cat: '#93b4ff', hotBg: '#efe8d8', hotFg: '#232427' }
};
const MP_SANS = '"Noto Sans TC", -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';
const MP_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const MP_BASE_W = 390;
// 桌布留白（依站長 iPhone 13 實測截圖 2026-09-28）：時鐘底部約在螢幕高度 25%、手電筒／相機鈕頂端約 86%
const MP_WALL_TOP = 0.29;
const MP_WALL_BOTTOM = 0.15;   // 設計寬度（CSS px）；輸出時整體等比放大到實際像素

const mpImgCache = new Map();
function mpLoadImg(src) {
    if (mpImgCache.has(src)) return mpImgCache.get(src);
    const p = new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
    mpImgCache.set(src, p);
    return p;
}

// 在設計座標系（寬 390）排版一次，回傳繪製指令與總高度；measure 與 draw 共用同一份排版，確保「放不放得下」算得準
function mpLayoutReceipt(ctx, groupsSections, o) {
    const big = o.big;
    const S = big
        ? { name: 17, rate: 16, due: 12, lab: 11, th: [32, 20], cols: [32, 58, 58], row: 36, sub: 26, labRow: 20, sec: 14 }
        : { name: 14, rate: 13.5, due: 10, lab: 9.5, th: [26, 16], cols: [26, 48, 48], row: 28, sub: 21, labRow: 0, sec: 12 };
    const ops = [];
    // 桌布左右多留一點：iPhone 設桌布時常自動放大 1.1–1.2 倍，邊緣會被切掉
    const X0 = o.fmt === 'wall' ? 30 : 18;
    const PAD = 16, W = MP_BASE_W - X0 * 2, IX = X0 + PAD, IW = W - PAD * 2;
    let y = 22;   // 撕邊之下
    const font = (w, s, fam) => `${w} ${s}px ${fam}`;
    const colsW = S.cols[0] + S.cols[1] + S.cols[2] + 12;

    // 抬頭
    ops.push({ t: 'spaced', text: `PICK MY CARD ▪ ${mpMonthLabel()}`, x: X0 + W / 2, y: y + 8, font: font(700, 9.5, MP_MONO), color: 'sub', spacing: 2.2 });
    y += 16;
    ops.push({ t: 'spaced', text: mpTitle(), x: X0 + W / 2, y: y + 18, font: font(900, big ? 21 : 18, MP_SANS), color: 'ink', spacing: big ? 3.6 : 3.2 });
    y += big ? 32 : 28;
    ops.push({ t: 'eq', x: IX, y: y + 6, w: IW });
    y += 14;

    // 商家名稱不截斷：放不下就逐字換行
    const wrap = (text, f, maxW) => {
        ctx.font = f;
        const lines = [];
        let cur = '';
        for (const ch of [...text]) {
            if (cur && ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; } else cur += ch;
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [''];
    };
    const fits = (text, f, maxW) => { ctx.font = f; return ctx.measureText(text).width <= maxW; };

    if (o.layout === 'F') {
        ops.push({ t: 'text', text: '商家', x: IX, y: y + 9, font: font(700, 9, MP_MONO), color: 'sub', align: 'left' });
        const cx = IX + IW - colsW;
        ops.push({ t: 'text', text: '卡', x: cx + S.cols[0] / 2, y: y + 9, font: font(700, 9, MP_MONO), color: 'sub', align: 'center' });
        ops.push({ t: 'text', text: '回饋', x: cx + S.cols[0] + 6 + S.cols[1], y: y + 9, font: font(700, 9, MP_MONO), color: 'sub', align: 'right' });
        ops.push({ t: 'text', text: '期限', x: IX + IW, y: y + 9, font: font(700, 9, MP_MONO), color: 'sub', align: 'right' });
        y += 14;
        ops.push({ t: 'dash', x1: IX, x2: IX + IW, y, color: 'rule', dash: [3, 3] });
    }

    const drawPickCols = (e, rightX, cy, alpha) => {
        const [tw, thH] = S.th;
        const cx = rightX - colsW;
        ops.push({ t: 'img', card: e.m.cardId, x: cx + (S.cols[0] - tw) / 2, y: cy - thH / 2, w: tw, h: thH, alpha });
        ops.push({ t: 'text', text: `${e.rate}%`, x: cx + S.cols[0] + 6 + S.cols[1], y: cy + S.rate * 0.36, font: font(700, S.rate, MP_MONO), color: 'ink', align: 'right', alpha });
        const dueT = mpDueText(e);
        ops.push({ t: mpIsHot(e) ? 'hot' : 'text', text: dueT, x: rightX, y: cy + S.due * 0.36, font: font(mpIsHot(e) ? 700 : 500, S.due, MP_MONO), color: 'sub', align: 'right', alpha });
        return cx;
    };

    const labelsW = labels => {
        ctx.font = font(700, S.lab, MP_MONO);
        return labels.reduce((w, l) => w + ctx.measureText(l).width + 8 + 4, 0);
    };
    const drawLabels = (labels, rightX, cy, alpha) => {
        ctx.font = font(700, S.lab, MP_MONO);
        let x = rightX;
        [...labels].reverse().forEach(l => {
            const w = ctx.measureText(l).width + 8;
            ops.push({ t: 'lab', text: l, x: x - w, y: cy - (S.lab + 6) / 2, w, h: S.lab + 6, font: font(700, S.lab, MP_MONO), alpha });
            x -= w + 4;
        });
    };

    groupsSections.forEach(sec => {
        if (sec.title !== null) {
            y += 12;
            const color = sec.key === '行動支付' ? 'pay' : 'cat';
            if (o.sort === 'az') {
                ops.push({ t: 'text', text: sec.title, x: IX, y: y + S.sec, font: font(800, S.sec + 2, MP_SANS), color, align: 'left' });
            } else {
                ops.push({ t: 'rect', x: IX, y: y + S.sec / 2 - 1, w: 5, h: 5, color });
                ops.push({ t: 'spaced', text: sec.title, x: IX + 11, y: y + S.sec, font: font(900, S.sec, MP_SANS), color, spacing: 1.5, align: 'left' });
            }
            ctx.font = font(900, S.sec + 2, MP_SANS);
            const tw = ctx.measureText(sec.title).width + (o.sort === 'az' ? 8 : 11 + sec.title.length * 1.5 + 8);
            ops.push({ t: 'dash', x1: IX + tw, x2: IX + IW, y: y + S.sec / 2 + 2, color, dash: [4, 3], alpha: 0.5 });
            y += S.sec + 6;
        }
        if (o.layout === 'F') {
            sec.items.forEach((g, gi) => {
                const top = y;
                const first = g.entries[0];
                const labsFirst = o.labels ? first.labels : [];
                const nf = font(700, S.name, MP_SANS);
                const full = mpDisplayName(g);
                // 標籤放回饋率左邊會把名稱擠到換行 → 標籤改放下一行（同大字）
                let labsBelow = big || !!o.caps;
                let inlineLabW = !labsBelow && labsFirst.length ? labelsW(labsFirst) : 0;
                if (inlineLabW && !fits(full, nf, IW - colsW - inlineLabW - 16)) { labsBelow = true; inlineLabW = 0; }
                const lines = wrap(full, nf, IW - colsW - inlineLabW - 16);
                const nameLH = S.name * 1.35;
                const cy = y + S.row / 2;
                lines.forEach((ln, li) => ops.push({ t: 'text', text: ln, x: IX, y: y + S.row / 2 + S.name * 0.36 + li * nameLH, font: nf, color: 'ink', align: 'left' }));
                ctx.font = nf;
                const lastY = y + S.row / 2 + S.name * 0.36 + (lines.length - 1) * nameLH;
                const nameEnd = IX + ctx.measureText(lines[lines.length - 1]).width + 6;
                const leaderEnd = IX + IW - colsW - inlineLabW - 6;
                if (leaderEnd > nameEnd + 4) ops.push({ t: 'dash', x1: nameEnd, x2: leaderEnd, y: lastY, color: 'rule', dash: [1.5, 2.5], lw: 1.5 });
                const nameBottom = y + S.row + (lines.length - 1) * nameLH;
                g.entries.forEach((e, i) => {
                    const alpha = i ? 0.5 : 1;
                    const lineCy = i === 0 ? cy : y + S.sub / 2;
                    drawPickCols(e, IX + IW, lineCy, alpha);
                    const labels = o.labels ? e.labels : [];
                    const capT = o.caps && e.cap ? e.cap : '';
                    if (capT) {
                        // 第二行：[標籤][封頂金額] 靠右
                        const capF = font(500, S.due, MP_MONO);
                        ctx.font = capF;
                        const cw = ctx.measureText(capT).width;
                        const r2w = cw + (labels.length ? labelsW(labels) + 6 : 0);
                        const step = i === 0 ? S.row : S.sub;
                        // 名稱換成兩行時，寬的第二行會撞到名稱第二行 → 改排到名稱下面
                        const push = i === 0 && lines.length > 1 && r2w > colsW + 4 ? Math.max(0, nameBottom - (y + step)) : 0;
                        y += step + push;
                        const rowH = Math.max(S.labRow, S.due + 8);
                        ops.push({ t: 'text', text: capT, x: IX + IW, y: y + rowH / 2 + S.due * 0.36 - 2, font: capF, color: 'sub', align: 'right', alpha });
                        if (labels.length) drawLabels(labels, IX + IW - cw - 6, y + rowH / 2 - 2, alpha);
                        y += rowH - step;
                    } else if (labels.length) {
                        if (labsBelow) {
                            y += (i === 0 ? S.row : S.sub);
                            drawLabels(labels, IX + IW, y + S.labRow / 2 - 2, alpha);
                            y += S.labRow - (i === 0 ? S.row : S.sub);
                        } else {
                            drawLabels(labels, IX + IW - colsW - 4, lineCy, alpha);
                        }
                    }
                    y += i === 0 ? S.row : S.sub;
                });
                if (y < nameBottom) y = nameBottom;
                const lastRow = gi === sec.items.length - 1;
                if (!lastRow) ops.push({ t: 'dash', x1: IX, x2: IX + IW, y: y, color: 'rule', dash: [1, 2] });
                if (y - top < S.row) y = top + S.row;
            });
        } else {
            const colW = (IW - 14) / 2;
            for (let i = 0; i < sec.items.length; i += 2) {
                const pair = sec.items.slice(i, i + 2);
                const top = y;
                let rowBottom = y;
                pair.forEach((g, pi) => {
                    const x = IX + pi * (colW + 14);
                    let cy = top + 6 + S.name * 0.9;
                    const nl = wrap(mpDisplayName(g), font(700, S.name, MP_SANS), colW);
                    nl.forEach((ln, li) => ops.push({ t: 'text', text: ln, x, y: cy + li * S.name * 1.35, font: font(700, S.name, MP_SANS), color: 'ink', align: 'left' }));
                    cy += (nl.length - 1) * S.name * 1.35 + (big ? 10 : 6);
                    if (big) { ops.push({ t: 'dash', x1: x, x2: x + colW, y: cy - 4, color: 'rule', dash: [] }); cy += 2; }
                    g.entries.forEach((e, ei) => {
                        const alpha = ei ? 0.5 : 1;
                        const lh = S.th[1] + (big ? 8 : 5);
                        const mid = cy + lh / 2;
                        ops.push({ t: 'img', card: e.m.cardId, x, y: mid - S.th[1] / 2, w: S.th[0], h: S.th[1], alpha });
                        ops.push({ t: 'text', text: `${e.rate}%`, x: x + S.th[0] + 6, y: mid + S.rate * 0.36, font: font(700, S.rate, MP_MONO), color: 'ink', align: 'left', alpha });
                        ops.push({ t: mpIsHot(e) ? 'hot' : 'text', text: mpDueText(e), x: x + colW, y: mid + S.due * 0.36, font: font(mpIsHot(e) ? 700 : 500, S.due, MP_MONO), color: 'sub', align: 'right', alpha });
                        cy += lh;
                        if (o.caps && e.cap) {
                            ops.push({ t: 'text', text: e.cap, x: x + colW, y: cy + S.due * 0.8, font: font(500, S.due, MP_MONO), color: 'sub', align: 'right', alpha });
                            cy += S.due + 6;
                        }
                    });
                    rowBottom = Math.max(rowBottom, cy + 4);
                });
                y = rowBottom;
                ops.push({ t: 'dash', x1: IX, x2: IX + colW, y, color: 'rule', dash: [1, 2] });
                if (pair.length > 1) ops.push({ t: 'dash', x1: IX + colW + 14, x2: IX + IW, y, color: 'rule', dash: [1, 2] });
            }
        }
    });

    // 底部：虛線、條碼、網址
    y += 12;
    ops.push({ t: 'dash', x1: IX, x2: IX + IW, y, color: 'rule', dash: [4, 3], lw: 1.5 });
    y += 12;
    const bcW = big ? 190 : 170, bcH = 24;
    ops.push({ t: 'barcode', x: X0 + W / 2 - bcW / 2, y, w: bcW, h: bcH });
    y += bcH + 12;
    ops.push({ t: 'spaced', text: 'PICKMYCARD.APP', x: X0 + W / 2, y: y, font: font(500, 9.5, MP_MONO), color: 'sub', spacing: 2.4 });
    y += 16;
    return { ops, height: y + 8, x: X0, w: W };
}

function mpDrawSpaced(ctx, text, x, y, spacing, align) {
    const chars = [...text];
    const widths = chars.map(c => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cx = align === 'left' ? x : x - total / 2;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
}

async function mpRenderCanvas(sections, o) {
    try { if (document.fonts && document.fonts.load) await Promise.all([document.fonts.load(`700 16px ${MP_SANS}`), document.fonts.load(`900 16px ${MP_SANS}`)]); } catch (e) { /* 用後備字型 */ }
    const measureCanvas = document.createElement('canvas');
    const mctx = measureCanvas.getContext('2d');
    const lay = mpLayoutReceipt(mctx, sections, o);
    const C = MP_THEME[o.theme] || MP_THEME.light;

    let outW, outH, top, avail;
    if (o.fmt === 'wall') {
        outW = o.wall.w; outH = o.wall.h;
        const baseH = MP_BASE_W * outH / outW;
        top = Math.round(baseH * MP_WALL_TOP);        // 鎖定畫面的日期＋時鐘
        avail = baseH - top - baseH * MP_WALL_BOTTOM;  // 底部留給手電筒／相機鈕
    } else {
        outW = 1080;
        top = 24;
        avail = Infinity;
        outH = Math.round((lay.height + top + 24) * outW / MP_BASE_W);
    }
    const fits = lay.height <= avail;
    const scale = outW / MP_BASE_W;
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, MP_BASE_W, outH / scale);

    // 紙張（上下鋸齒撕邊）
    const px = lay.x, pw = lay.w, py = top, ph = lay.height, tooth = 12, depth = 6;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
    ctx.beginPath();
    ctx.moveTo(px, py + depth);
    for (let x = px; x < px + pw; x += tooth) { ctx.lineTo(Math.min(x + tooth / 2, px + pw), py); ctx.lineTo(Math.min(x + tooth, px + pw), py + depth); }
    ctx.lineTo(px + pw, py + ph - depth);
    for (let x = px + pw; x > px; x -= tooth) { ctx.lineTo(Math.max(x - tooth / 2, px), py + ph); ctx.lineTo(Math.max(x - tooth, px), py + ph - depth); }
    ctx.closePath();
    ctx.fillStyle = C.paper;
    ctx.fill();
    ctx.restore();

    ctx.translate(0, py);
    ctx.textBaseline = 'alphabetic';
    const imgs = {};
    await Promise.all([...new Set(lay.ops.filter(op => op.t === 'img').map(op => op.card))].map(async id => { imgs[id] = await mpLoadImg(`assets/images/cards/${id}.png`); }));
    const { bars, width: bw } = mpBarcodeBars(MP_BARCODE_TEXT);

    lay.ops.forEach(op => {
        ctx.save();
        ctx.globalAlpha = op.alpha == null ? 1 : op.alpha;
        const col = op.color ? C[op.color] : C.ink;
        switch (op.t) {
            case 'text':
                ctx.font = op.font; ctx.fillStyle = col; ctx.textAlign = op.align || 'left';
                ctx.fillText(op.text, op.x, op.y);
                break;
            case 'spaced':
                ctx.font = op.font; ctx.fillStyle = col;
                mpDrawSpaced(ctx, op.text, op.x, op.y, op.spacing, op.align);
                break;
            case 'hot': {
                ctx.font = op.font; ctx.textAlign = 'right';
                const w = ctx.measureText(op.text).width;
                const size = parseFloat(op.font.split(' ')[1]);
                ctx.fillStyle = C.hotBg;
                ctx.fillRect(op.x - w - 3, op.y - size * 0.95, w + 6, size * 1.35);
                ctx.fillStyle = C.hotFg;
                ctx.fillText(op.text, op.x, op.y);
                break;
            }
            case 'eq':
                ctx.font = `500 10px ${MP_MONO}`; ctx.fillStyle = C.sub; ctx.textAlign = 'left';
                ctx.save(); ctx.beginPath(); ctx.rect(op.x, op.y - 10, op.w, 14); ctx.clip();
                ctx.fillText('='.repeat(80), op.x, op.y + 2);
                ctx.restore();
                break;
            case 'dash':
                ctx.strokeStyle = col; ctx.lineWidth = op.lw || 1; ctx.setLineDash(op.dash || []);
                ctx.beginPath(); ctx.moveTo(op.x1, op.y); ctx.lineTo(op.x2, op.y); ctx.stroke();
                break;
            case 'rect':
                ctx.fillStyle = col; ctx.fillRect(op.x, op.y, op.w, op.h);
                break;
            case 'lab':
                ctx.strokeStyle = C.rule; ctx.lineWidth = 1; ctx.setLineDash([]);
                ctx.strokeRect(op.x + 0.5, op.y + 0.5, op.w - 1, op.h - 1);
                ctx.font = op.font; ctx.fillStyle = C.sub; ctx.textAlign = 'center';
                ctx.fillText(op.text, op.x + op.w / 2, op.y + op.h - 4);
                break;
            case 'img': {
                const img = imgs[op.card];
                if (img) {
                    // object-fit: cover（直式卡圖也填滿 8:5 小框）
                    const r = Math.max(op.w / img.width, op.h / img.height);
                    const sw = op.w / r, sh = op.h / r;
                    ctx.beginPath(); ctx.rect(op.x, op.y, op.w, op.h); ctx.clip();
                    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, op.x, op.y, op.w, op.h);
                } else {
                    ctx.fillStyle = C.rule; ctx.fillRect(op.x, op.y, op.w, op.h);
                }
                break;
            }
            case 'barcode': {
                ctx.fillStyle = C.ink;
                const k = op.w / bw;
                bars.forEach(b => ctx.fillRect(op.x + b.x * k, op.y, b.w * k, op.h));
                break;
            }
        }
        ctx.restore();
    });
    return { canvas, fits, contentH: lay.height, avail };
}

// 存圖設定：可選的商家（排除失效）依目前排列的順序
function mpExportPool() {
    const groups = mpBuildGroups().filter(g => !g.dead);
    return mpArrange(groups, MP.prefs.sort).flatMap(s => s.items);
}

function mpExportSections(selectedKeys) {
    const sel = new Set(selectedKeys);
    const groups = mpBuildGroups().filter(g => !g.dead && sel.has(g.key)).map(g => ({ ...g, entries: g.entries.filter(e => !e.dead) }));
    return mpArrange(groups, MP.prefs.sort);
}

function mpExportOpts() {
    const p = MP.prefs;
    return { layout: p.layout, labels: p.layout === 'F' && p.labels, caps: p.caps, big: p.size === 'large', sort: p.sort, theme: p.theme, fmt: p.fmt, wall: mpWallSize() };
}

// 桌布最多放得下前幾家（依目前順序逐一加，實際排版量高度）
function mpWallCapacity(pool) {
    const c = document.createElement('canvas').getContext('2d');
    const o = mpExportOpts();
    const baseH = MP_BASE_W * o.wall.h / o.wall.w;
    const avail = baseH - Math.round(baseH * MP_WALL_TOP) - baseH * MP_WALL_BOTTOM;
    let n = 0;
    for (let i = 1; i <= pool.length; i++) {
        const lay = mpLayoutReceipt(c, mpExportSections(pool.slice(0, i).map(g => g.key)), o);
        if (lay.height > avail) break;
        n = i;
    }
    return n;
}

function mpExportSelection(pool) {
    const keys = new Set(pool.map(g => g.key));
    if (MP.prefs.sel) return MP.prefs.sel.filter(k => keys.has(k));
    const cap = MP.prefs.fmt === 'wall' ? MP.exp.capacity : pool.length;
    return pool.slice(0, cap).map(g => g.key);
}

function mpOpenExport() {
    const dlg = mpEl('mp-export');
    if (!dlg) return;
    MP.exp.step = 'settings';
    MP.exp.pickOpen = false;   // 手機：「要放進圖片的商家」每次打開都先收合，讓預覽圖不用捲就看得到
    dlg.hidden = false;
    dlg.dataset.step = 'settings';
    mpRenderExport();
}

function mpCloseExport() {
    const dlg = mpEl('mp-export');
    if (dlg) dlg.hidden = true;
}

let mpPreviewSeq = 0;
async function mpRenderExport() {
    const dlg = mpEl('mp-export');
    if (!dlg || dlg.hidden) return;
    const p = MP.prefs;
    const pool = mpExportPool();
    MP.exp.capacity = mpWallCapacity(pool);
    const sel = mpExportSelection(pool);
    const lim = p.fmt === 'wall' ? MP.exp.capacity : pool.length;
    const esc = escapeHtml;
    const size = mpWallSize();
    const auto = mpDetectScreen();
    const allOn = sel.length >= Math.min(pool.length, lim) && sel.length > 0;

    mpEl('mp-exp-settings').innerHTML = `
        <div class="mp-set-block"><h4>格式</h4><div class="mp-fmt">
            <button type="button" data-mp-fmt="wall" class="${p.fmt === 'wall' ? 'on' : ''}"><b>手機桌布</b><span>最多約 ${MP.exp.capacity} 家（依字級、版面而定）</span></button>
            <button type="button" data-mp-fmt="long" class="${p.fmt === 'long' ? 'on' : ''}"><b>長圖</b><span>不限數量，存到相簿</span></button>
        </div></div>
        ${p.fmt === 'wall' && p.ratio === 'old' ? '<p class="mp-set-hint">16:9 是給 iPhone 8／SE 等舊機用的。iPhone X 之後的全螢幕 iPhone 用它，左右會被裁掉、時鐘也可能蓋到內容，請選「iPhone」或「本機」。</p>' : ''}
        ${p.fmt === 'wall' ? `<div class="mp-set-block"><h4>桌布尺寸</h4><div class="mp-seg mp-seg-wrap" role="group" aria-label="桌布尺寸">
            <button type="button" data-mp-ratio="auto" class="${p.ratio === 'auto' ? 'on' : ''}">${auto ? `本機（${auto.w}×${auto.h}）` : '自動（iPhone）'}</button>
            ${Object.entries(MP_RATIOS).map(([k, v]) => `<button type="button" data-mp-ratio="${k}" class="${p.ratio === k ? 'on' : ''}" title="${v.desc}">${v.label}</button>`).join('')}
        </div></div>` : ''}
        <div class="mp-set-row">
            <div class="mp-set-block"><h4>版面</h4>${mpSegHtml('版面', p.layout, [['F', MP_ICON.one, '單欄'], ['E', MP_ICON.two, '雙欄']])}</div>
            <div class="mp-set-block"><h4>排列</h4>${mpSegHtml('排列方式', p.sort, [['custom', '自訂'], ['az', 'A–Z'], ['cat', '分類']])}</div>
            <div class="mp-set-block"><h4>字級</h4>${mpSegHtml('字級', p.size, [['small', '小字'], ['large', '大字']])}</div>
        </div>
        <div class="mp-set-row">${mpLabelsChk('mp-exp-labels', p)}${mpCapsChk('mp-exp-caps', p)}</div>
        <div class="mp-set-block mp-pickwrap${MP.exp.pickOpen ? ' open' : ''}">
            <div class="mp-pick-head"><button type="button" class="mp-pick-toggle" id="mp-pick-toggle" aria-expanded="${MP.exp.pickOpen ? 'true' : 'false'}" aria-controls="mp-picks"><h4>要放進圖片的商家</h4><span class="mp-chev" aria-hidden="true">${MP_ICON.chev}</span></button><span class="mp-cnt${p.fmt === 'wall' && sel.length > lim ? ' over' : ''}">${sel.length}${p.fmt === 'wall' ? ' / ' + lim : ''}</span>
                <button type="button" class="mp-all" id="mp-exp-all">${allOn ? '全不選' : '全選'}</button></div>
            ${p.fmt === 'wall' && pool.length > lim ? `<p class="mp-set-hint mp-pick-hint">桌布放得下前 ${lim} 家，按「全選」會選前 ${lim} 家。想全部放進去，請改選「長圖」。</p>` : ''}
            <div class="mp-picks" id="mp-picks">${mpArrange(mpBuildGroups(), p.sort).map(s => (s.title !== null ? `<div class="mp-pk-sec${s.key === '行動支付' ? ' pay' : ''}">${esc(s.title)}</div>` : '') + s.items.map(g => {
                const on = sel.includes(g.key), off = g.dead;
                return `<label class="mp-pk${off ? ' off' : ''}"><input type="checkbox" data-mp-pick="${esc(g.key)}" ${on && !off ? 'checked' : ''} ${off ? 'disabled' : ''}><span class="mp-pk-name">${esc(mpDisplayName(g))}${off ? '<small>已失效</small>' : ''}</span><img class="mp-th" src="assets/images/cards/${esc(g.entries[0].m.cardId)}.png" alt="" onerror="this.style.visibility='hidden'"></label>`;
            }).join('')).join('')}</div>
        </div>`;

    // 預覽：直接產生實際要存的圖
    const seq = ++mpPreviewSeq;
    const meta = mpEl('mp-exp-meta');
    const themeSeg = mpEl('mp-exp-theme');
    themeSeg.querySelectorAll('[data-mp-theme]').forEach(b => b.classList.toggle('on', b.dataset.mpTheme === p.theme));
    mpEl('mp-exp-preview-pane').classList.toggle('lt', p.theme === 'light');
    const saveBtn = mpEl('mp-exp-save');
    if (!sel.length) {
        mpEl('mp-exp-img').removeAttribute('src');
        mpEl('mp-exp-img').hidden = true;
        meta.textContent = '還沒有勾選商家';
        saveBtn.disabled = true;
        return;
    }
    meta.textContent = '產生預覽中…';
    const { canvas, fits } = await mpRenderCanvas(mpExportSections(sel), mpExportOpts());
    if (seq !== mpPreviewSeq) return;
    MP.exp.canvas = canvas;
    MP.exp.fits = fits;
    const img = mpEl('mp-exp-img');
    img.src = canvas.toDataURL('image/png');
    img.hidden = false;
    img.classList.toggle('wall', p.fmt === 'wall');
    const expTip = mpEl('mp-exp-tip');
    if (expTip) expTip.hidden = p.fmt !== 'wall';
    if (p.fmt === 'wall') {
        meta.textContent = fits ? `手機桌布 ${size.label} ${canvas.width}×${canvas.height}・${sel.length} 家` : '超出一個螢幕了，請少勾幾家，或改存長圖';
        meta.classList.toggle('over', !fits);
        saveBtn.disabled = !fits;
    } else {
        meta.textContent = `長圖 ${canvas.width}×${canvas.height}・${sel.length} 家`;
        meta.classList.remove('over');
        saveBtn.disabled = false;
    }
}

async function mpSaveImage() {
    const canvas = MP.exp.canvas;
    if (!canvas) return;
    const fname = `pickmycard-${mpMonthLabel()}.png`;
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) return;
    if (window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'mappings_save_image', { fmt: MP.prefs.fmt, layout: MP.prefs.layout, size: MP.prefs.size, theme: MP.prefs.theme });
    }
    // 手機優先用分享面板（iPhone 會有「儲存影像」）；不支援再退回下載
    try {
        const file = new File([blob], fname, { type: 'image/png' });
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            return;
        }
    } catch (error) {
        if (error && error.name === 'AbortError') return;   // 用戶自己關掉分享面板
        console.error('❌ [配卡] 分享圖片失敗，改用下載:', error);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ============================================
// 事件綁定
// ============================================
function mpBind() {
    const page = mpEl('mappings-page');
    if (!page || page.dataset.bound) return;
    page.dataset.bound = '1';

    mpEl('home-view-switch-mappings')?.addEventListener('click', () => openMappingsPage());
    mpEl('home-view-switch-search')?.addEventListener('click', () => closeMappingsPage());

    page.addEventListener('click', async e => {
        const t = e.target;
        const b = t.closest('button');
        if (!b) return;
        if (b.id === 'mp-title-btn') { mpOpenTitleSheet(); return; }
        if (b.id === 'mp-title-save') { await mpSaveTitle(false); return; }
        if (b.id === 'mp-title-reset') { await mpSaveTitle(true); return; }
        if (b.dataset.mpChanged) { mpOpenRateSheet(b.dataset.mpChanged); return; }
        if (b.dataset.mpRatePick !== undefined) { b.disabled = true; await mpApplyRate(Number(b.dataset.mpRatePick)); return; }
        if (b.id === 'mp-delete-dead') {
            // 兩段式確認（站內不用 confirm()）：第一下變紅色「確定刪除？」，4 秒內再按一次才刪
            if (!b.classList.contains('confirm')) {
                const n = mpDeadIds().length;
                b.classList.add('confirm');
                b.textContent = `確定刪除 ${n} 筆失效活動？再按一次`;
                setTimeout(() => { if (b.isConnected && b.classList.contains('confirm')) { b.classList.remove('confirm'); b.textContent = `刪除全部失效活動（${n}）`; } }, 4000);
                return;
            }
            b.disabled = true;
            await mpDeleteAllDead();
            return;
        }
        if (b.dataset.mpSort && !b.closest('#mp-exp-settings')) { MP.prefs.sort = b.dataset.mpSort; mpSavePrefs(); mpRender(); return; }
        if (b.dataset.mpSize && !b.closest('#mp-exp-settings')) { MP.prefs.size = b.dataset.mpSize; mpSavePrefs(); mpRender(); return; }
        if (b.dataset.mpLayout && !b.closest('#mp-exp-settings')) { MP.prefs.layout = b.dataset.mpLayout; mpSavePrefs(); mpRender(); return; }
        if (b.id === 'mp-update-btn') { b.disabled = true; b.classList.add('busy'); await mpUpdateDeadlines(); return; }
        if (b.id === 'mp-retry-btn') { b.disabled = true; b.textContent = '讀取中…'; await loadSpendingMappings(); updateMappingsSwitch(); mpRender(); if ((userSpendingMappings || []).length) mpProbeAll(); return; }
        if (b.dataset.mpEdit) { mpOpenEditSheet(b.dataset.mpEdit); return; }
        if (b.dataset.mpCard) { showCardDetail(b.dataset.mpCard); return; }
        if (b.hasAttribute('data-mp-open-export')) { mpOpenExport(); return; }
        if (b.id === 'mp-edit-save') { await mpSaveEdit(false); return; }
        if (b.id === 'mp-edit-reset') { await mpSaveEdit(true); return; }
        if (b.dataset.mpRemove) { await mpRemoveMapping(b.dataset.mpRemove); return; }
        if (b.hasAttribute('data-mp-sheet-close')) { mpCloseSheets(); return; }
        // 存圖對話框
        if (b.closest('#mp-export')) {
            const p = MP.prefs;
            if (b.hasAttribute('data-mp-exp-close')) { mpCloseExport(); return; }
            if (b.dataset.mpFmt) { p.fmt = b.dataset.mpFmt; }
            else if (b.dataset.mpRatio) { p.ratio = b.dataset.mpRatio; }
            else if (b.dataset.mpLayout) { p.layout = b.dataset.mpLayout; }
            else if (b.dataset.mpSort) { p.sort = b.dataset.mpSort; }
            else if (b.dataset.mpSize) { p.size = b.dataset.mpSize; }
            else if (b.dataset.mpTheme) { p.theme = b.dataset.mpTheme; }
            else if (b.id === 'mp-exp-all') {
                const pool = mpExportPool();
                const lim = p.fmt === 'wall' ? mpWallCapacity(pool) : pool.length;
                const cur = mpExportSelection(pool);
                p.sel = cur.length >= Math.min(pool.length, lim) && cur.length > 0 ? [] : pool.slice(0, lim).map(g => g.key);
            }
            else if (b.id === 'mp-exp-save') { await mpSaveImage(); return; }
            else if (b.id === 'mp-pick-toggle') {
                MP.exp.pickOpen = !MP.exp.pickOpen;
                const w = b.closest('.mp-pickwrap');
                if (w) w.classList.toggle('open', MP.exp.pickOpen);
                b.setAttribute('aria-expanded', String(MP.exp.pickOpen));
                return;
            }
            else return;
            mpSavePrefs();
            mpRenderExport();
            mpRender();
        }
    });

    page.addEventListener('change', e => {
        const t = e.target;
        if (t.id === 'mp-labels-toggle' || t.id === 'mp-exp-labels') {
            MP.prefs.labels = t.checked; mpSavePrefs(); mpRender();
            if (t.id === 'mp-exp-labels') mpRenderExport();
            return;
        }
        if (t.id === 'mp-caps-toggle' || t.id === 'mp-exp-caps') {
            MP.prefs.caps = t.checked; mpSavePrefs(); mpRender();
            if (t.id === 'mp-exp-caps') mpRenderExport();
            return;
        }
        if (t.dataset.mpPick !== undefined) {
            const pool = mpExportPool();
            const cur = new Set(mpExportSelection(pool));
            if (t.checked) cur.add(t.dataset.mpPick); else cur.delete(t.dataset.mpPick);
            MP.prefs.sel = pool.map(g => g.key).filter(k => cur.has(k));
            mpSavePrefs();
            mpRenderExport();
        }
    });

    page.addEventListener('pointerdown', mpStartDrag);
    // 拖曳把手上的 mousedown 會選取文字，擋掉
    page.addEventListener('mousedown', e => { if (e.target.closest('[data-mp-grip]')) e.preventDefault(); });

    const search = mpEl('mp-search'), clearBtn = mpEl('mp-search-clear');
    if (search) search.addEventListener('input', () => { MP.search = search.value.trim(); if (clearBtn) clearBtn.hidden = !search.value; mpRender(); });
    if (clearBtn) clearBtn.addEventListener('click', () => { search.value = ''; MP.search = ''; clearBtn.hidden = true; mpRender(); search.focus(); });
    mpEl('mp-guest-login')?.addEventListener('click', () => { if (typeof openAuthModal === 'function') openAuthModal('login'); });
    mpEl('mp-edit-toggle')?.addEventListener('click', () => { MP.editing = !MP.editing; mpRender(); });

    const input = mpEl('mp-edit-input');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); mpSaveEdit(false); } });

    ['mp-edit-sheet', 'mp-title-sheet', 'mp-rate-sheet'].forEach(id => mpEl(id)?.addEventListener('click', e => { if (e.target.id === id) mpCloseSheets(); }));
    const titleInput = mpEl('mp-title-input');
    if (titleInput) {
        titleInput.addEventListener('input', mpTitleCount);
        titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!mpEl('mp-title-save').disabled) mpSaveTitle(false); } });
    }
    mpEl('mp-export')?.addEventListener('click', e => { if (e.target.id === 'mp-export') mpCloseExport(); });

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || !MP.open) return;
        if (document.getElementById('card-detail-modal')?.style.display === 'flex') return;   // 詳情頁自己處理
        if (mpAnySheetOpen()) mpCloseSheets();
        else if (!mpEl('mp-export').hidden) mpCloseExport();
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (!MP.open) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(mpFitRows, 150);
    });

    window.addEventListener('popstate', () => {
        if (location.pathname === '/mappings') { if (!MP.open) openMappingsPage({ fromHistory: true }); }
        else if (MP.open) { MP.pushed = false; closeMappingsPage({ fromHistory: true }); }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    mpBind();

    // 直接打開 /mappings：先把頁面蓋上（資料載入後 refreshMappingsEntry 會重畫）
    if (location.pathname === '/mappings' && document.getElementById('mappings-page')) openMappingsPage({ fromHistory: true });
});
