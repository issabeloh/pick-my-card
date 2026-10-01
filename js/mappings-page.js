/* ============================================================
 * Pick My Card — js/mappings-page.js（載入順序 13/13）
 * 「我的刷卡小抄」完整頁面（2026-09-28 由 modal 改版：收據風格「刷卡小抄」）
 * 區塊目錄（Grep 關鍵字）：
 *  - 狀態與偏好（排列/版面/字級/存圖設定）→ "mpLoadPrefs" / "mpSavePrefs"
 *  - 商家顯示名稱（改名／重設，存雲端）    → "loadMerchantAliases" / "mpSetAlias"
 *  - 分組／分類／拼音字首                 → "mpBuildGroups" / "mpCategoryOf" / "mpLetterOf"
 *  - 失效檢查與「更新活動」              → "mpProbeAll" / "mpUpdateDeadlines"
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
    probeGen: 0,           // 登入／登出時 +1，讓舊的重算結果作廢
    updated: null,          // 按過「更新活動」的結果 { ext, changed:[] }
    search: '',
    editKey: null,
    exp: { fits: true, capacity: 0 },
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
// 雲端這次沒讀到（mappingsLoadState 不是 ok）時，手上可能是舊的本機快取；這時寫回會蓋掉別台裝置新增的配對 → 擋下來
function mpCanWrite() {
    if (!currentUser || mappingsLoadState === 'ok') return true;
    alert('這次沒讀到雲端的刷卡小抄，為了不蓋掉你的資料，暫時不能修改。請確認網路後重新整理頁面。');
    return false;
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
        cardNames: p.cardNames === true, // 顯示卡片名稱（Cards Data 的 name）；預設關
        summary: p.summary === true,    // 小抄底部「共 N 張信用卡 ▪ 額度共 NT$ x萬」；預設關（額度屬隱私，存成桌布前讓用戶自己決定）
        fmt: p.fmt === 'long' ? 'long' : 'wall',
        // 'auto'＝手機本機尺寸（桌機沒有本機 → 用通用）；'common'＝通用比例。舊值 iphone／ios／android 都併入 common
        ratio: ['common', 'ios', 'iphone', 'android'].includes(p.ratio) ? 'common' : 'auto',
        theme: p.theme === 'dark' ? 'dark' : 'light',
        sel: Array.isArray(p.sel) ? p.sel.filter(s => typeof s === 'string') : null
    };
    // 存成圖片的設定（版面、排列、字級、勾選項）與小抄頁面各自獨立，不互相連動（2026-09-29 站長要求）。
    // 第一次沒有存過時，以小抄目前的樣子當起點。
    const x = p.x && typeof p.x === 'object' ? p.x : {};
    const pp = MP.prefs;
    pp.x = {
        sort: ['custom', 'az', 'cat'].includes(x.sort) ? x.sort : pp.sort,
        layout: x.layout === 'E' || x.layout === 'F' ? x.layout : pp.layout,
        size: x.size === 'large' || x.size === 'small' ? x.size : pp.size,
        labels: typeof x.labels === 'boolean' ? x.labels : pp.labels,
        caps: typeof x.caps === 'boolean' ? x.caps : pp.caps,
        cardNames: typeof x.cardNames === 'boolean' ? x.cardNames : pp.cardNames,
        summary: typeof x.summary === 'boolean' ? x.summary : pp.summary
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
// 失效檢查與「更新活動」
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

// 小抄底部摘要（單據的「合計」）：持有信用卡張數＝「我的信用卡」選取的卡（與 #owned-count-badge 同一個算法）；
// 額度合計＝這些卡在詳情頁「我的額度」填的金額（只讀）
function mpOwnedIds() {
    if (!cardsData || !cardsData.cards || typeof myOwnedCards === 'undefined') return [];
    return cardsData.cards.filter(c => myOwnedCards.has(c.id)).map(c => c.id);
}

async function mpLoadLimits() {
    const out = new Map();
    const ids = mpOwnedIds();
    const parse = v => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : null; };
    // 本機鏡像（saveCreditLimit／loadCreditLimit 寫的）：雲端讀不到或離線時用它
    const readLocal = () => {
        const pre = currentUser ? `creditLimit_${currentUser.uid}_` : 'creditLimit_local_';
        ids.forEach(id => { let v = null; try { v = localStorage.getItem(pre + id); } catch (e) { /* ignore */ } const n = parse(v); if (n !== null) out.set(id, n); });
    };
    try {
        if (currentUser && window.db && window.doc && window.getDoc) {
            const snap = await window.getDoc(window.doc(window.db, 'users', currentUser.uid));
            const map = snap.exists() && snap.data().creditLimits;
            if (map) ids.forEach(id => { const n = parse(map[id]); if (n !== null) out.set(id, n); });
            else readLocal();
        } else {
            readLocal();
        }
    } catch (error) {
        console.error('❌ [刷卡小抄] 讀取額度失敗，改用本機紀錄:', error);
        readLocal();
    }
    MP.limits = out;
    return out;
}

function mpSummaryData() {
    const ids = mpOwnedIds();
    const lim = MP.limits || new Map();
    let sum = 0, known = 0;
    ids.forEach(id => { if (lim.has(id)) { sum += lim.get(id); known++; } });
    return { count: ids.length, amount: known ? `NT$${Math.round(sum).toLocaleString()}` : '未填', missing: ids.length - known };
}


// 「?」說明氣泡；裡面的「我的信用卡」可以直接打開 modal
function mpOpenHelp(anchor) {
    mpCloseHelp();
    const pop = document.createElement('div');
    pop.className = 'mp-pop';
    pop.id = 'mp-help-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '顯示卡數與額度總和的說明');
    pop.innerHTML = '<p>信用卡數量為<button type="button" class="mp-linkbtn" data-mp-open-owned>「我的信用卡」</button>中選取的卡片數量；額度為各信用卡的詳情頁中，所填寫的「我的額度」。點小抄上的信用卡圖片就能打開詳情頁。</p>';
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = Math.min(300, innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 12)) + 'px';
    const h = pop.offsetHeight;
    pop.style.top = (r.bottom + 8 + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
}
function mpCloseHelp() {
    const old = document.getElementById('mp-help-pop');
    if (old) old.remove();
    document.querySelectorAll('.mp-help[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function mpOpenOwnedCards() {
    mpCloseHelp();
    if (typeof openMyOwnedCardsModal === 'function') openMyOwnedCardsModal();
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
        // 除了 1000 元，也用這張卡各活動的滿額門檻各算一次：「單筆滿 N」的活動在 1000 元時不會出現，不能因此當成下架
        const amounts = [...new Set([1000, ...(card.cashbackRates || []).map(g => Number(g.minSpend)).filter(n => n > 0)])].slice(0, 6);
        const seen = new Set();
        for (const amt of amounts) {
            const r = await calculateCardCashback(card, term, amt);
            (Array.isArray(r) ? r : []).forEach(x => {
                const k = `${x.rate}|${x.matchedCategory || ''}|${x.matchedRateGroup && x.matchedRateGroup.periodEnd || ''}`;
                if (!seen.has(k)) { seen.add(k); matches.push(x); }
            });
        }
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
    // 「已下架」只在卡片資料裡完全找不到這個商家時才判定（會被列進「刪除全部失效活動」，寧可漏判不可誤判）：
    // 還沒開始的活動、生日月等條件暫時不適用的活動，重算會是空的，但商家還在卡片資料裡 → 不算失效
    let listed = true;   // 判斷失敗時當成還在（安全方向）
    try { listed = JSON.stringify(card).toLowerCase().includes(JSON.stringify(term.toLowerCase())); } catch (e) { /* 保持 true */ }
    const upcoming = !!(m.periodStart && mpISO(m.periodStart) > getTaiwanToday());
    const gone = !matches.length && !listed && !upcoming;
    return { dead: gone ? 'gone' : null, labels, next, cap, hasMatches: matches.length > 0, newRates: matches.map(x => Number(x.rate) || 0), cands };
}

// mpProbe 的結果 → MP.status 存的形狀（一處定義，避免各處各拼一次）
function mpStatusOf(r) {
    return { dead: r.dead, labels: r.labels, cap: r.cap, next: r.next, hasMatches: r.hasMatches, newRates: r.newRates || [], cands: r.cands || [], changed: !!(r.cands && r.cands.length) };
}

async function mpProbeAll() {
    if (MP.probing) return MP.probing;
    const gen = MP.probeGen;
    const run = (async () => {
        const list = mpList().slice();
        // 各配對互不相干 → 同時算（查詢回饋本身也是對每張卡並行呼叫 calculateCardCashback）
        const results = await Promise.all(list.map(m => mpProbe(m)));
        if (gen !== MP.probeGen) return;   // 途中登入／登出了，這批結果不屬於目前的清單
        list.forEach((m, i) => MP.status.set(m.id, { ...(MP.status.get(m.id) || {}), ...mpStatusOf(results[i]) }));
        MP.probed = true;
        if (MP.probing === run) MP.probing = null;
        if (MP.open) mpRender();
    })();
    MP.probing = run;
    return run;
}

async function mpUpdateDeadlines() {
    if (!mpCanWrite()) return;
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

// 切到「我的刷卡小抄」：顯示在頁籤下方，查詢回饋畫面隱藏，不是蓋住整頁的覆蓋層
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
    if (MP.prefs.summary || MP.prefs.x.summary) await mpLoadLimits();
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
// 其他模組改了配對／持有卡／額度 → notifyMappingsDataChanged()（core-utils.js）發事件，頁面開著才重畫
async function mpOnDataChanged() {
    if (!MP.open || !MP.prefs) return;
    if (MP.prefs.summary || MP.prefs.x.summary) await mpLoadLimits();
    mpRender();
    mpRenderExport();
}

function refreshMappingsEntry() {
    if (!currentUser) { userMerchantAliases = {}; userMappingsTitle = ''; }   // 登出：上一位用戶的標題與改名不能留在記憶體
    MP.probeGen++;   // 進行中的重算（例如訪客範例）作廢，不寫回新狀態
    MP.probing = null;
    if (currentUser) MP.demo = null;
    MP.prefs = null;
    MP.status.clear();
    MP.probed = false;
    if (location.pathname === '/mappings') openMappingsPage({ fromHistory: true });
    else if (MP.open) { mpLoadPrefs(); mpRender(); }
    if (currentUser && MP.pendingFeedback) { MP.pendingFeedback = false; setTimeout(openFeedbackModal, 300); }
    else if (currentUser && !MP.open) setTimeout(mpShowMovedHint, 1200);
}

// ============================================
// 一次性改版提示（2026-09-30）：登入後在「我的刷卡小抄」頁籤下方冒出說明氣泡（站長決定不要飛入動畫）。
// 每個瀏覽器只顯示 2 次（計數存本機，不含個資，登出也不清）。
// ============================================
const MP_HINT_KEY = 'mpMovedHintCount';
const MP_HINT_TIMES = 2;
function mpAnyModalOpen() {
    return [...document.querySelectorAll('.modal')].some(m => getComputedStyle(m).display !== 'none');
}
function mpShowMovedHint(attempt = 0) {
    if (!currentUser || MP.open || document.querySelector('.mp-hint-bubble')) return;
    const n = Number(readLocalJSON(MP_HINT_KEY, 0)) || 0;
    if (n >= MP_HINT_TIMES) return;
    // 登入後常有其他視窗（問卷邀請等）同時跳出 → 等它們關掉再播，最多等約 30 秒；沒播出來就不扣次數
    if (mpAnyModalOpen()) { if (attempt < 20) setTimeout(() => mpShowMovedHint(attempt + 1), 1500); return; }
    const tab = mpEl('home-view-switch-mappings');
    if (!tab) return;
    const tr = tab.getBoundingClientRect();
    if (tr.bottom < 0 || tr.top > innerHeight || tr.width === 0) return;   // 頁籤不在畫面上就下次再說
    try { localStorage.setItem(MP_HINT_KEY, JSON.stringify(n + 1)); } catch (e) { /* ignore */ }

    const bubble = document.createElement('div');
    bubble.className = 'mp-hint-bubble';
    bubble.setAttribute('role', 'status');
    bubble.innerHTML = '<span>原「我的配卡組合」搬到這裡了！釘選過的都在裡面</span><button type="button" aria-label="關閉提示">×</button>';
    document.body.appendChild(bubble);
    const w = Math.min(280, innerWidth - 24);
    bubble.style.width = w + 'px';
    bubble.style.left = Math.max(12, Math.min(tr.left + tr.width / 2 - w / 2, innerWidth - w - 12)) + 'px';
    bubble.style.top = (tr.bottom + 10) + 'px';
    bubble.style.setProperty('--arrow-x', (tr.left + tr.width / 2 - parseFloat(bubble.style.left)) + 'px');
    // 氣泡本身不擋點擊（CSS pointer-events: none，只有 × 可按）；點畫面任何地方、捲動、6 秒後都會關
    const close = () => { bubble.remove(); document.removeEventListener('pointerdown', close, true); };
    bubble.querySelector('button').addEventListener('click', close);
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('scroll', close, { once: true, passive: true });
    setTimeout(close, 6000);
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

// 卡名查表（Cards Data 的 name）；cardsData 換新時重建
let mpCardNameMap = null, mpCardNameSrc = null;
function mpCardName(cardId, fallback) {
    const cards = cardsData && cardsData.cards;
    if (cards && cards !== mpCardNameSrc) { mpCardNameSrc = cards; mpCardNameMap = new Map(cards.map(c => [c.id, c.name])); }
    return (mpCardNameMap && mpCardNameMap.get(cardId)) || fallback || '';
}

// 單據「合計」區：左標籤、點狀引線、右數字（點一下打開「我的信用卡」）
function mpTotalsHtml() {
    const d = mpSummaryData();
    const esc = escapeHtml;
    return `<button type="button" class="mp-totals" id="mp-sum-btn" title="打開「我的信用卡」">
        <span class="mp-tot"><span class="mp-tot-k">持有信用卡</span><i></i><b>${esc(String(d.count))} 張</b></span>
        <span class="mp-tot"><span class="mp-tot-k">額度合計</span><i></i><b>${esc(d.amount)}</b></span>
        ${d.missing && d.amount !== '未填' ? `<span class="mp-tot-note">＊其中 ${esc(String(d.missing))} 張未填額度</span>` : ''}
    </button><div class="mp-eq mp-eq-tot" aria-hidden="true">${'='.repeat(80)}</div>`;
}

function mpReceiptHtml(sections, o) {
    const esc = escapeHtml;
    const star = g => g.dead ? '<span class="mp-star" aria-label="已失效">*</span>' : '';
    // 商家名稱只有「編輯本頁」時可以點（改名／刪除），並顯示鉛筆；平常是純文字
    const name = g => o.editing
        ? `<button type="button" class="mp-nm" data-mp-edit="${esc(g.key)}" title="點一下改顯示名稱或刪除">${esc(mpDisplayName(g))}${star(g)}<span class="mp-pen">${MP_ICON.pen}</span></button>`
        : `<span class="mp-nm">${esc(mpDisplayName(g))}${star(g)}</span>`;
    const grip = () => o.drag ? `<span class="mp-grip" data-mp-grip title="拖曳調整順序" aria-hidden="true">${MP_ICON.grip}</span>` : '';
    const thumb = e => `<button type="button" class="mp-cardbtn" data-mp-card="${esc(e.m.cardId)}" title="查看 ${esc(mpCardName(e.m.cardId, e.m.cardName))} 詳情"><img class="mp-th" src="assets/images/cards/${esc(e.m.cardId)}.png" alt="${esc(mpCardName(e.m.cardId, e.m.cardName))}" onerror="this.style.visibility='hidden'"></button>`;
    const due = e => `<span class="mp-due${mpIsHot(e) ? ' hot' : ''}${e.ext ? ' ext' : ''}">${esc(mpDueText(e))}</span>`;
    const flag = e => e.changed ? `<button type="button" class="mp-flag" data-mp-changed="${esc(e.m.id)}" title="點一下看新的回饋率">回饋已變</button>` : '';
    const labs = e => o.labels && e.labels.length ? `<span class="mp-labs">${e.labels.map(l => `<span class="mp-lab">${esc(l)}</span>`).join('')}</span>` : '';
    const rate = e => `<span class="mp-rate">${esc(String(e.rate))}%</span>`;
    const capOf = e => o.caps && e.cap ? `<span class="mp-cap">${esc(e.cap)}</span>` : '';
    const cnOf = e => o.cardNames ? `<span class="mp-cn">${esc(mpCardName(e.m.cardId, e.m.cardName))}</span>` : '';
    // 第二行：勾了「顯示卡片名稱」或「顯示活動封頂金額」→ [卡名][等級／方案][封頂金額] 一起放第二行（靠右）
    const useRow2 = o.caps || o.cardNames;
    const row2 = e => useRow2 && (cnOf(e) || capOf(e) || labs(e)) ? `<div class="mp-row2">${cnOf(e)}${labs(e)}${capOf(e)}</div>` : '';
    // 雙欄：欄太窄，卡名與封頂金額各自一行
    const eExtra = e => (cnOf(e) ? `<div class="mp-e-cap mp-e-cn">${cnOf(e)}</div>` : '') + (capOf(e) ? `<div class="mp-e-cap">${capOf(e)}</div>` : '');
    const sec = s => s.title === null ? '' : (!o.demo && MP.prefs.sort === 'az'
        ? `<div class="mp-sec az"><span class="mp-ltr">${esc(s.title)}</span></div>`
        : `<div class="mp-sec${s.key === '行動支付' ? ' pay' : ''}">${esc(s.title)}</div>`);

    let body;
    if (!sections.length) {
        body = '<p class="mp-none">找不到符合的商家</p>';
    } else if (o.layout === 'E') {
        body = `<div class="mp-e-grid">${sections.map(s => sec(s) + s.items.map(g => `<div class="mp-e-cell${g.dead ? ' mp-dead' : ''}" data-mp-row="${esc(g.key)}"><div class="mp-e-name">${grip()}${name(g)}</div>${g.entries.map((e, i) => `<div class="mp-e-line${i ? ' mp-alt' : ''}${e.dead ? ' mp-dead' : ''}">${thumb(e)}${rate(e)}${flag(e)}${due(e)}</div>${eExtra(e)}`).join('')}</div>`).join('')).join('')}</div>`;
    } else {
        body = '<div class="mp-colhead"><span>商家</span><span class="mp-cols"><span>卡</span><span>回饋</span><span>期限</span></span></div>' +
            sections.map(s => sec(s) + s.items.map(g => `<div class="mp-f-row${g.dead ? ' mp-dead' : ''}" data-mp-row="${esc(g.key)}"><div class="mp-f-lead">${grip()}${name(g)}</div>${g.entries.map((e, i) => { const r2 = row2(e); return `<div class="mp-f-pick${i ? ' mp-alt' : ''}${e.dead ? ' mp-dead' : ''}${r2 ? ' has-row2' : ''}">${r2 ? '' : flag(e)}${useRow2 ? '' : labs(e)}<div class="mp-f-cols">${thumb(e)}${rate(e)}${due(e)}</div>${r2}${r2 ? flag(e) : ''}</div>`; }).join('')}</div>`).join('')).join('');
    }
    const anyDead = sections.some(s => s.items.some(g => g.dead || g.entries.some(e => e.dead)));
    const note = anyDead ? `<div class="mp-note"><b>*</b> 活動已結束或有更動。${o.editing ? '點商家名稱可以移除' : '按「編輯本頁」後點商家名稱可以移除'}。記得回網站更新最新活動！</div>` : '';
    return `<div class="mp-rc${o.big ? ' lg' : ''}">
        <div class="mp-rc-head">${o.upd ? `<button type="button" class="mp-upd" id="mp-update-btn" title="用最新活動資料重新比對：回饋率沒變的自動延長期限，回饋率變了的列出來提醒你" ${MP.updated ? 'disabled' : ''}>${MP_ICON.upd}${MP.updated ? '已是最新' : '更新活動'}</button>` : ''}<span class="mp-store">${esc(mpMonthLabel())}</span>${o.editing ? `<button type="button" class="mp-title mp-title-btn" id="mp-title-btn" title="點一下修改標題">${esc(mpTitle())}<span class="mp-title-pen" aria-hidden="true">${MP_ICON.pen}</span></button>` : `<span class="mp-title" id="mp-title-btn">${esc(mpTitle())}</span>`}</div>
        <div class="mp-eq" aria-hidden="true">${'='.repeat(80)}</div>
        ${body}${note}
        ${o.summary ? mpTotalsHtml() : ''}
        <div class="mp-foot"><span class="mp-url">PICKMYCARD.APP</span></div>
    </div>`;
}

// ============================================
// 頁面渲染
// ============================================
// 「顯示等級／方案」常駐；雙欄放不下標籤，改成灰色不可勾（不改用戶存的勾選值）
function mpSummaryChk(id, p) {
    return `<span class="mp-chkwrap"><label class="mp-chk"><input type="checkbox" id="${id}" ${p.summary ? 'checked' : ''}>顯示卡數與額度總和</label><button type="button" class="mp-help" data-mp-help aria-label="卡數與額度是怎麼算的？" aria-expanded="false">?</button></span>`;
}
function mpCardNamesChk(id, p) {
    return `<label class="mp-chk"><input type="checkbox" id="${id}" ${p.cardNames ? 'checked' : ''}>顯示卡片名稱</label>`;
}
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
// 直接打開 /mappings 時，卡片資料可能還在下載 → 最多等 15 秒
function mpWaitCardsData(ms = 15000) {
    return new Promise(resolve => {
        const t0 = Date.now();
        (function tick() {
            if (typeof cardsData !== 'undefined' && cardsData && cardsData.cards) return resolve(true);
            if (Date.now() - t0 > ms) return resolve(false);
            setTimeout(tick, 150);
        })();
    });
}

// 同一時間只建一次（渲染可能連續呼叫多次）
function mpBuildDemo() {
    if (MP.demo) return Promise.resolve(MP.demo);
    if (!MP.demoBuilding) MP.demoBuilding = mpBuildDemoNow().finally(() => { MP.demoBuilding = null; });
    return MP.demoBuilding;
}
async function mpBuildDemoNow() {
    if (!(await mpWaitCardsData())) return MP.demo;
    if (MP.demo || currentUser) return MP.demo;
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
            ${mpCardNamesChk('mp-cardnames-toggle', p)}
            ${mpCapsChk('mp-caps-toggle', p)}
            ${mpSummaryChk('mp-summary-toggle', p)}
        </div>`;

    // 編輯模式：設定、提示列、拖曳把手只在按「編輯」後出現；預設只看乾淨的小抄＋搜尋框
    tools.hidden = !MP.editing;
    const editBtn = mpEl('mp-edit-toggle');
    if (editBtn) {
        // 圖示寫在 index.html，這裡只切換顯示與文字
        const t = editBtn.querySelector('.mp-edit-t'), pen = editBtn.querySelector('.mp-ico-pen'), ok = editBtn.querySelector('.mp-ico-ok');
        if (t) t.textContent = MP.editing ? '完成' : '編輯本頁'; else editBtn.textContent = MP.editing ? '完成' : '編輯本頁';
        // SVG 沒有 .hidden 屬性，要用 attribute
        if (pen) pen.toggleAttribute('hidden', MP.editing);
        if (ok) ok.toggleAttribute('hidden', !MP.editing);
        editBtn.classList.toggle('on', MP.editing); editBtn.setAttribute('aria-pressed', String(MP.editing));
    }
    // 提示列的文字寫在 index.html；這裡只控制「拖曳」那句（只有自訂排列才顯示）
    if (tip) tip.querySelectorAll('.mp-tip-drag').forEach(el => { el.hidden = !(p.sort === 'custom' && !MP.search); });

    if (notice) {
        if (MP.updated) {
            const u = MP.updated;
            const head = u.ext ? `已更新 ${u.ext} 筆截止日期` : '沒有需要延長的期限';
            notice.innerHTML = `<b>${escapeHtml(head)}</b>` + (u.ext ? '（回饋率不變，期限延長，日期下有點狀底線）' : '') +
                (u.changed.length ? `<span class="bad">${u.changed.length} 筆回饋率變了，沒有自動更新：${u.changed.map(escapeHtml).join('、')}。請重新搜尋後再加到我的小抄。</span>` : '');
            notice.hidden = false;
        } else notice.hidden = true;
    }

    const saveBtns = document.querySelectorAll('[data-mp-open-export]');
    const guest = mpEl('mp-guest'), searchbox = mpEl('mp-searchbox'), deadbarEl = mpEl('mp-deadbar');
    const show = (el, on) => { if (el) el.hidden = !on; };
    // 未登入：範例清單（可以照樣排列、改名、存圖，只是不保存）＋登入提示；鎖起來的只有「加到我的配卡」
    show(guest, !currentUser);
    const demoTag = mpEl('mp-demo-tag');
    if (demoTag) demoTag.hidden = !!currentUser;
    if (!currentUser && !MP.demo) {
        list.innerHTML = '<div class="mp-empty"><p>範例載入中…</p></div>';
        mpBuildDemo().then(() => { if (MP.open && !currentUser && MP.demo) { mpRender(); mpProbeAll(); } });
        show(searchbox, false); show(deadbarEl, false); show(tip, false);
        return;
    }
    // 空狀態（讀取失敗／真的沒資料）
    const mappings = mpList();
    // 商家數：#mp-count 在桌機左欄按鈕卡片裡、#mp-count-m 在手機小抄下方右側（CSS 各自只顯示一個）
    const countText = mappings.length ? (n => n ? `已加入 ${n} 家商家` : '')(mpBuildGroups().length) : '';
    ['mp-count', 'mp-count-m'].forEach(id => { const el = mpEl(id); if (el) el.textContent = countText; });
    show(searchbox, mappings.length > 0); show(tip, MP.editing && mappings.length > 0);
    if (!mappings.length) {
        let title, hint, retry = false;
        show(deadbarEl, false); show(tip, false);
        if (mappingsLoadState === 'error') { title = '配卡讀取失敗'; hint = '你的配卡還在雲端，只是這次沒讀到（網路不穩或 App 剛冷啟動）。請確認連線後重試。'; retry = true; }
        else { title = '還沒有配卡記錄'; hint = '在查詢回饋的結果中按「加到我的小抄」，就會出現在這張刷卡小抄裡'; }
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
        layout: p.layout, labels: p.layout === 'F' && p.labels, caps: p.caps, cardNames: p.cardNames, summary: p.summary, big: p.size === 'large',
        editing: MP.editing,   // 編輯中：標題旁顯示鉛筆（只在網頁上，存圖不畫）
        upd: !!currentUser,    // 小抄右上角「更新活動」（2026-09-30 起不藏在編輯裡；範例清單不顯示，因為不能存）
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
    if (!list || MP.prefs.layout !== 'F' || MP.prefs.size === 'large' || MP.prefs.caps || MP.prefs.cardNames) return;
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
        if (!mpCanWrite()) { mpRender(); return; }   // 還原畫面上的順序
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
    if (!mpCanWrite()) return;
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
    MP.status.set(m.id, mpStatusOf(r));
    mpRender();
}

// ---- 刪除全部失效活動 ----
function mpDeadIds() {
    return mpBuildGroups().flatMap(g => g.entries.filter(e => e.dead).map(e => e.m.id));
}

async function mpDeleteAllDead() {
    if (!mpCanWrite()) return;
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
    if (!mpCanWrite()) return;
    const m = mpList().find(x => x.id === id);
    if (currentUser) await removeMapping(id);
    else mpSetList(mpList().filter(x => x.id !== id));
    MP.status.delete(id);
    if (m && window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'remove_mapping', { card_id: m.cardId, card_name: m.cardName, merchant: m.merchant, rate: m.cashbackRate });
    }
    mpCloseSheets();
    mpRender();
}

// ============================================
// 存成圖片：canvas 直接繪製（預覽＝實際輸出的那張圖）
// ============================================
// 桌布尺寸：本機（只在手機上，讀實際螢幕，手機預設）＋通用（2026-09-29 依台灣熱銷機型查證，見 ui-display.md 第 8 節）。
// 通用＝19.5:9、1440×3120：iPhone 與三星熱銷機（A56/A36、S25 Ultra）同比例；vivo／OPPO／小米／Pixel 約 20:9，
// 用這張圖只會左右各裁約 1.3%，被左右留白吸收。1440 寬＝熱銷機都是縮小顯示，字銳利。
// 留白（MP_WALL_TOP/BOTTOM）一體適用：指紋圖示在下方正中，單欄時落在虛線引線上，不擋重點。
const MP_WALL_COMMON = { w: 1440, h: 3120 };
// 比例文字：高÷寬×9，取到 0.5（2532/1170 → 19.5:9、3200/1440 → 20:9）
function mpRatioText(w, h) {
    return `${Math.round(h / w * 9 * 2) / 2}:9`;
}

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

// 實際使用的桌布規格：key 是目前選中的選項（桌機沒有本機 → 通用）
function mpWallSize() {
    const d = MP.prefs.ratio === 'auto' ? mpDetectScreen() : null;
    if (d) return { key: 'auto', w: d.w, h: d.h, label: '本機' };
    return { key: 'common', ...MP_WALL_COMMON, label: '通用' };
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
    ops.push({ t: 'spaced', text: mpMonthLabel(), x: X0 + W / 2, y: y + 8, font: font(700, 9.5, MP_MONO), color: 'sub', spacing: 2.2 });
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
                let labsBelow = big || !!o.caps || !!o.cardNames;
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
                    const cnT = o.cardNames ? mpCardName(e.m.cardId, e.m.cardName) : '';
                    if (capT || cnT) {
                        // 第二行：[卡名][標籤][封頂金額] 靠右（與網頁 .mp-row2 同順序）
                        const capF = font(500, S.due, MP_MONO), cnF = font(500, S.due + 1, MP_SANS);
                        ctx.font = capF;
                        const cw = capT ? ctx.measureText(capT).width : 0;
                        ctx.font = cnF;
                        const nw = cnT ? ctx.measureText(cnT).width : 0;
                        const lw = labels.length ? labelsW(labels) : 0;
                        const r2w = cw + (lw ? lw + 6 : 0) + (nw ? nw + 6 : 0);
                        const step = i === 0 ? S.row : S.sub;
                        // 名稱換成兩行時，寬的第二行會撞到名稱第二行 → 改排到名稱下面
                        const push = i === 0 && lines.length > 1 && r2w > colsW + 4 ? Math.max(0, nameBottom - (y + step)) : 0;
                        y += step + push;
                        const rowH = Math.max(S.labRow, S.due + 8);
                        // [卡名][標籤…][封頂金額] 依序排，放不下就換行；每行靠右（與網頁 .mp-row2 的 flex-wrap 一致，絕不畫出收據外）
                        const labF = font(700, S.lab, MP_MONO);
                        ctx.font = labF;
                        const items = [];
                        if (cnT) items.push({ k: 'cn', w: nw, text: cnT });
                        labels.forEach(l => items.push({ k: 'lab', w: ctx.measureText(l).width + 8, text: l }));
                        if (capT) items.push({ k: 'cap', w: cw, text: capT });
                        const rows = [[]];
                        let used = 0;
                        items.forEach(it => {
                            const cur = rows[rows.length - 1];
                            const add = (cur.length ? 6 : 0) + it.w;
                            if (cur.length && used + add > IW) { rows.push([it]); used = it.w; } else { cur.push(it); used += add; }
                        });
                        rows.forEach((row, ri) => {
                            const tot = row.reduce((sum, it, k) => sum + it.w + (k ? 6 : 0), 0);
                            let x = IX + IW - tot;
                            const mid = y + rowH / 2 - 2;
                            row.forEach(it => {
                                if (it.k === 'lab') ops.push({ t: 'lab', text: it.text, x, y: mid - (S.lab + 6) / 2, w: it.w, h: S.lab + 6, font: labF, alpha });
                                else ops.push({ t: 'text', text: it.text, x, y: mid + (it.k === 'cn' ? S.due + 1 : S.due) * 0.36, font: it.k === 'cn' ? cnF : capF, color: 'sub', align: 'left', alpha });
                                x += it.w + 6;
                            });
                            if (ri < rows.length - 1) y += rowH;
                        });
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
                        if (o.cardNames) {
                            ops.push({ t: 'text', text: mpCardName(e.m.cardId, e.m.cardName), x: x + colW, y: cy + S.due * 0.8, font: font(500, S.due + 1, MP_SANS), color: 'sub', align: 'right', alpha });
                            cy += S.due + 6;
                        }
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

    // 底部：虛線、（勾選時）單據合計區、網址
    y += 12;
    ops.push({ t: 'dash', x1: IX, x2: IX + IW, y, color: 'rule', dash: [4, 3], lw: 1.5 });
    y += 16;
    if (o.summary) {
        const d = mpSummaryData();
        const kf = font(700, big ? 12.5 : 11, MP_SANS), vf = font(700, big ? 13.5 : 12, MP_MONO);
        const row = (k, v) => {
            ctx.font = kf; const kw = ctx.measureText(k).width;
            ctx.font = vf; const vw = ctx.measureText(v).width;
            ops.push({ t: 'text', text: k, x: IX, y: y + 4, font: kf, color: 'ink', align: 'left' });
            ops.push({ t: 'text', text: v, x: IX + IW, y: y + 4, font: vf, color: 'ink', align: 'right' });
            if (IX + IW - vw - 6 > IX + kw + 10) ops.push({ t: 'dash', x1: IX + kw + 6, x2: IX + IW - vw - 6, y: y + 2, color: 'rule', dash: [1.5, 2.5], lw: 1.5 });
            y += big ? 22 : 19;
        };
        row('持有信用卡', `${d.count} 張`);
        row('額度合計', d.amount);
        if (d.missing && d.amount !== '未填') {
            ops.push({ t: 'text', text: `＊其中 ${d.missing} 張未填額度`, x: IX + IW, y: y + 1, font: font(500, big ? 11 : 9.5, MP_SANS), color: 'sub', align: 'right' });
            y += big ? 17 : 15;
        }
        ops.push({ t: 'eq', x: IX, y: y, w: IW });
        y += 18;
    }
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
        top = 24;
        avail = Infinity;
        // iOS Safari 的 canvas 上限約 16.7M 像素，超過會變成空白圖 → 很長時自動降低寬度（最低 540）
        const baseH = lay.height + top + 24;
        outW = Math.max(540, Math.min(1080, Math.floor(Math.sqrt(16e6 * MP_BASE_W / baseH))));
        outH = Math.round(baseH * outW / MP_BASE_W);
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
        }
        ctx.restore();
    });
    return { canvas, fits, contentH: lay.height, avail };
}

// 存圖設定：可選的商家（排除失效）依目前排列的順序
function mpExportPool() {
    const groups = mpBuildGroups().filter(g => !g.dead);
    return mpArrange(groups, MP.prefs.x.sort).flatMap(s => s.items);
}

function mpExportSections(selectedKeys) {
    const sel = new Set(selectedKeys);
    const groups = mpBuildGroups().filter(g => !g.dead && sel.has(g.key)).map(g => ({ ...g, entries: g.entries.filter(e => !e.dead) }));
    return mpArrange(groups, MP.prefs.x.sort);
}

function mpExportOpts() {
    const p = MP.prefs, x = p.x;
    return { layout: x.layout, labels: x.layout === 'F' && x.labels, caps: x.caps, cardNames: x.cardNames, summary: x.summary, big: x.size === 'large', sort: x.sort, theme: p.theme, fmt: p.fmt, wall: mpWallSize() };
}

// 桌布扣掉上方時鐘、下方手電筒／相機鈕後，收據可用的高度（與 mpRenderCanvas 同算法）
function mpWallAvail(o) {
    const baseH = MP_BASE_W * o.wall.h / o.wall.w;
    return baseH - Math.round(baseH * MP_WALL_TOP) - baseH * MP_WALL_BOTTOM;
}

// 桌布放不下時：逐一試「只關掉某個有勾的選項」能不能放下，回傳能放下的做法文字（給提示用，不改任何設定）
function mpWallFixOptions(sel) {
    const c = document.createElement('canvas').getContext('2d');
    const o = mpExportOpts(), avail = mpWallAvail(o), sections = mpExportSections(sel);
    return [['summary', '取消「顯示卡數與額度總和」'], ['cardNames', '取消「顯示卡片名稱」'], ['caps', '取消「顯示活動封頂金額」'], ['labels', '取消「顯示等級／方案」'], ['big', '字級改成小字']]
        .filter(([k]) => o[k])
        .filter(([k]) => mpLayoutReceipt(c, sections, { ...o, [k]: false }).height <= avail)
        .map(([, label]) => label);
}

// 桌布最多放得下前幾家（依目前順序逐一加，實際排版量高度）
function mpWallCapacity(pool) {
    const c = document.createElement('canvas').getContext('2d');
    const o = mpExportOpts();
    const avail = mpWallAvail(o);
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
    MP.exp.pickOpen = false;   // 手機：「要放進圖片的商家」每次打開都先收合，讓預覽圖不用捲就看得到
    dlg.hidden = false;
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
        ${p.fmt === 'wall' ? `<div class="mp-set-block"><h4>桌布尺寸</h4>${auto ? `<div class="mp-seg" role="group" aria-label="桌布尺寸">
            <button type="button" data-mp-ratio="auto" class="${size.key === 'auto' ? 'on' : ''}">本機</button>
            <button type="button" data-mp-ratio="common" class="${size.key === 'common' ? 'on' : ''}" title="iPhone、三星與多數 Android">通用</button>
        </div>` : ''}<p class="mp-set-note mp-ratio-note">${size.key === 'auto' ? '本機螢幕' : '通用（iPhone、三星與多數 Android）'}：比例 ${mpRatioText(size.w, size.h)}（${size.w}×${size.h}）</p></div>` : ''}
        <div class="mp-set-row">
            <div class="mp-set-block"><h4>版面</h4>${mpSegHtml('版面', p.x.layout, [['F', MP_ICON.one, '單欄'], ['E', MP_ICON.two, '雙欄']])}</div>
            <div class="mp-set-block"><h4>排列</h4>${mpSegHtml('排列方式', p.x.sort, [['custom', '自訂'], ['az', 'A–Z'], ['cat', '分類']])}</div>
            <div class="mp-set-block"><h4>字級</h4>${mpSegHtml('字級', p.x.size, [['small', '小字'], ['large', '大字']])}</div>
        </div>
        <div class="mp-set-row">${mpLabelsChk('mp-exp-labels', p.x)}${mpCardNamesChk('mp-exp-cardnames', p.x)}${mpCapsChk('mp-exp-caps', p.x)}${mpSummaryChk('mp-exp-summary', p.x)}</div>
        <div class="mp-set-block mp-pickwrap${MP.exp.pickOpen ? ' open' : ''}">
            <div class="mp-pick-head">
                <button type="button" class="mp-pick-toggle" id="mp-pick-toggle" aria-expanded="${MP.exp.pickOpen ? 'true' : 'false'}" aria-controls="mp-picks"><span class="mp-pick-title">要放進圖片的商家</span><span class="mp-cnt${p.fmt === 'wall' && sel.length > lim ? ' over' : ''}">${sel.length}${p.fmt === 'wall' ? ' / ' + lim : ''} 家</span><span class="mp-chev"><span class="mp-chev-t">${MP.exp.pickOpen ? '收合' : '展開'}</span>${MP_ICON.chev}</span></button>
            </div>
            <div class="mp-pick-bar">${p.fmt === 'wall' && pool.length > lim ? `<p class="mp-set-hint mp-pick-hint">已選的圖片規格只放得下 ${lim} 家。若想全放，請改選「長圖」。</p>` : ''}<button type="button" class="mp-all" id="mp-exp-all">${allOn ? '全不選' : '全選'}</button></div>
            <div class="mp-picks" id="mp-picks">${mpArrange(mpBuildGroups(), p.x.sort).map(s => (s.title !== null ? `<div class="mp-pk-sec${s.key === '行動支付' ? ' pay' : ''}">${esc(s.title)}</div>` : '') + s.items.map(g => {
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
    MP.exp.blob = null;
    // 先把檔案準備好：按「儲存圖片」時直接叫分享面板，不在點擊後才 await（iPhone 會把晚了的分享擋掉）
    canvas.toBlob(b => { if (seq === mpPreviewSeq) MP.exp.blob = b; }, 'image/png');
    MP.exp.fits = fits;
    const img = mpEl('mp-exp-img');
    img.src = canvas.toDataURL('image/png');
    img.hidden = false;
    img.classList.toggle('wall', p.fmt === 'wall');
    const expTip = mpEl('mp-exp-tip');
    if (expTip) expTip.hidden = p.fmt !== 'wall';
    if (p.fmt === 'wall') {
        if (fits) meta.textContent = `手機桌布 ${size.label} ${canvas.width}×${canvas.height}・${sel.length} 家`;
        else {
            const fix = mpWallFixOptions(sel);
            meta.textContent = fix.length
                ? `超出一個螢幕了：${fix.join('，或')}就放得下；也可以少勾幾家，或改存長圖`
                : '超出一個螢幕了，請少勾幾家，或改存長圖';
        }
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
    const blob = MP.exp.blob || await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) { alert('圖片產生失敗（可能太長了）。請少勾幾家，或改用小字後再試一次。'); return; }
    if (window.logEvent && window.firebaseAnalytics) {
        window.logEvent(window.firebaseAnalytics, 'mappings_save_image', { fmt: MP.prefs.fmt, layout: MP.prefs.x.layout, size: MP.prefs.x.size, theme: MP.prefs.theme });
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
        if (b.id === 'mp-retry-btn') { b.disabled = true; b.textContent = '讀取中…'; await loadSpendingMappings(); mpRender(); if ((userSpendingMappings || []).length) mpProbeAll(); return; }
        if (b.dataset.mpEdit) { mpOpenEditSheet(b.dataset.mpEdit); return; }
        if (b.dataset.mpCard) { showCardDetail(b.dataset.mpCard); return; }
        if (b.id === 'mp-sum-btn') { mpOpenOwnedCards(); return; }
        if (b.id === 'mp-intro-toggle') {
            const steps = mpEl('mp-steps'), open = steps.hidden;
            steps.hidden = !open; b.setAttribute('aria-expanded', String(open));
            return;
        }
        if (b.id === 'mp-feedback-btn') {
            // 回報表單只給登入用戶（同頭像選單「回報錯誤」）；未登入先開登入視窗，登入後自動打開表單
            if (!currentUser) { MP.pendingFeedback = true; if (typeof openAuthModal === 'function') openAuthModal('login'); return; }
            openFeedbackModal();
            return;
        }
        if (b.hasAttribute('data-mp-help')) { if (document.getElementById('mp-help-pop')) mpCloseHelp(); else mpOpenHelp(b); return; }
        if (b.hasAttribute('data-mp-open-export')) { mpOpenExport(); return; }
        if (b.id === 'mp-edit-save') { await mpSaveEdit(false); return; }
        if (b.id === 'mp-edit-reset') { await mpSaveEdit(true); return; }
        if (b.dataset.mpRemove) {
            // 兩段式確認（刪了無法復原）：第一次按只變成「確定刪除？」，4 秒內再按一次才刪
            if (b.dataset.armed !== '1') {
                b.dataset.armed = '1'; b.dataset.label = b.textContent; b.textContent = '確定刪除？再按一次';
                setTimeout(() => { if (b.isConnected && b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = b.dataset.label; } }, 4000);
                return;
            }
            await mpRemoveMapping(b.dataset.mpRemove);
            return;
        }
        if (b.hasAttribute('data-mp-sheet-close')) { mpCloseSheets(); return; }
        // 存圖對話框
        if (b.closest('#mp-export')) {
            const p = MP.prefs;
            if (b.hasAttribute('data-mp-exp-close')) { mpCloseExport(); return; }
            if (b.dataset.mpFmt) { p.fmt = b.dataset.mpFmt; }
            else if (b.dataset.mpRatio) { p.ratio = b.dataset.mpRatio; }
            else if (b.dataset.mpLayout) { p.x.layout = b.dataset.mpLayout; }
            else if (b.dataset.mpSort) { p.x.sort = b.dataset.mpSort; }
            else if (b.dataset.mpSize) { p.x.size = b.dataset.mpSize; }
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
                const ct = b.querySelector('.mp-chev-t');
                if (ct) ct.textContent = MP.exp.pickOpen ? '收合' : '展開';
                return;
            }
            else return;
            mpSavePrefs();
            mpRenderExport();   // 存圖設定不連動小抄頁面
        }
    });

    page.addEventListener('change', async e => {
        const t = e.target;
        // 小抄頁面的勾選項 → 只影響頁面；存圖對話框的 → 只影響圖片（MP.prefs.x）
        const pageKey = { 'mp-labels-toggle': 'labels', 'mp-cardnames-toggle': 'cardNames', 'mp-caps-toggle': 'caps', 'mp-summary-toggle': 'summary' }[t.id];
        const expKey = { 'mp-exp-labels': 'labels', 'mp-exp-cardnames': 'cardNames', 'mp-exp-caps': 'caps', 'mp-exp-summary': 'summary' }[t.id];
        if (pageKey || expKey) {
            if (pageKey) MP.prefs[pageKey] = t.checked; else MP.prefs.x[expKey] = t.checked;
            mpSavePrefs();
            if ((pageKey || expKey) === 'summary' && t.checked) await mpLoadLimits();
            if (pageKey) mpRender(); else mpRenderExport();
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

    // 「?」說明氣泡掛在 body 上（不在 #mappings-page 裡）：「我的信用卡」連結與點外面關閉都在這裡處理
    document.addEventListener('click', e => {
        const t = e.target;
        if (t.closest && t.closest('[data-mp-open-owned]')) { mpOpenOwnedCards(); return; }
        if (!(t.closest && (t.closest('#mp-help-pop') || t.closest('[data-mp-help]')))) mpCloseHelp();
    });
    window.addEventListener('resize', mpCloseHelp);
    document.addEventListener('pmc:mappings-data-changed', mpOnDataChanged);
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
