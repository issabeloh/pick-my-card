/* ============================================================
 * 商家頁卡片清單計算（給 tools/build-merchant-pages.js 用）
 *
 * 為什麼用 vm 載入 js/ 而不是自己寫一套比對邏輯：
 * 商家頁上使用者看到的清單是 js/ 那 12 個模組算出來的。如果這裡另寫一套「哪些卡
 * 命中這個商家」的規則，兩套邏輯遲早分岔，頁面上寫的跟 JSON-LD 講的就會不一致
 * ——那正是 2026-08-16 發現的病（momo 頁第一名是遠東快樂卡，JSON-LD 卻沒有它）。
 * 所以這裡直接把前端那份程式碼原封不動載進 Node 的 vm 跑，只補一個極簡 DOM 替身。
 * 驗證方式：tools/build-merchant-pages.js --verify 會用 Playwright 開真的頁面比對，
 * 兩邊清單必須逐筆一致（做法見 docs/project/data-pipeline.md 第 11 節）。
 *
 * ⚠️ 兩個踩過的坑：
 * 1. js/core-utils.js 會把 console.log/warn 靜音（正式環境行為）。傳給 vm 的 console
 *    必須是獨立物件，否則它會順手把 Node 這邊的 console 一起關掉，除錯時全黑。
 * 2. 模組頂層的 `let cardsData` 是 vm context 的「語彙綁定」，不是 global 物件屬性——
 *    從外面 ctx.cardsData = x 只會多一個沒人看的變數。必須用 runInContext 從裡面指派。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');

// js/ 的載入順序＝index.html 的 <script> 順序（傳統全域 script 靠順序滿足依賴）
const MODULES = [
  'core-utils', 'data-loader', 'home-ui', 'search-match', 'cashback-engine',
  'results-display', 'auth-user-data', 'cards-modals', 'card-detail',
  'spending-mappings', 'levels-payments', 'quick-options-misc'
];

function makeElementStub() {
  const stub = new Proxy({}, {
    get(target, key) {
      if (key === 'style') return {};
      if (key === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (key === 'value') return '';
      if (key === 'checked') return false;
      if (key === 'dataset') return {};
      if (key === 'children' || key === 'childNodes') return [];
      if (key === 'textContent' || key === 'innerHTML' || key === 'innerText') return '';
      if (typeof key === 'string') return () => stub;
      return undefined;
    },
    set() { return true; }
  });
  return stub;
}

function createEngine(cardsData) {
  const el = makeElementStub();
  const ctx = {
    // 獨立 console：core-utils 會把它靜音，不能共用 Node 的（見檔頭坑 1）
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => el,
      addEventListener() {},
      body: el,
      documentElement: el
    },
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '', hash: '', href: 'https://pickmycard.app/', origin: 'https://pickmycard.app' },
    navigator: { userAgent: 'node' },
    URLSearchParams,
    fetch: () => Promise.reject(new Error('build 期間不連外部網路'))
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  for (const name of MODULES) {
    const file = path.join(REPO, 'js', name + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'js/' + name + '.js' });
  }

  // 從 context 內部指派，才吃得到模組頂層的 let 綁定（見檔頭坑 2）。
  //
  // ⚠️ 這四步是照抄 js/data-loader.js 的 loadCardsData()，順序與內容都不能改：
  //   1. cardsData = 解碼結果
  //   2. filterExpiredRates —— 濾掉過期活動。少了它，已結束的活動會出現在清單裡
  //   3. mergeDataSearchExclusions —— 併入 SearchExclusions 工作表的排除規則。少了它，
  //      被排除的項目會被誤匹配（2026-08-16 linepay 頁多出「LINE Pay 找體驗 APP」就是這個）
  //   4. buildCardItemsIndex —— 建每張卡的搜尋索引，沒有它 findMatchingItem 全部落空
  // 前端載入流程若有變動，這裡要跟著改，否則生成的清單會與畫面分岔。
  ctx.__cardsData = cardsData;
  vm.runInContext([
    'cardsData = __cardsData;',
    'cardsData = filterExpiredRates(cardsData);',
    'mergeDataSearchExclusions(cardsData);',
    'cardsData.cards.forEach(function (c) { buildCardItemsIndex(c); });',
    '__cardsData = cardsData;'
  ].join('\n'), ctx);
  return ctx;
}

// 商家字串 → 匹配項清單。照抄 compareSpotlightMerchant() 的分支：商家名剛好等於某個
// 快捷搜尋的 displayName（如 LinePay、廣告費）就走 handleQuickSearch 的多關鍵詞路徑，
// 否則當一般單一商家搜尋。少了這個分支，LinePay 這種頁的匹配項會跟畫面不一樣。
function resolveMatchedItems(engine, merchant) {
  const options = engine.__cardsData.quickSearchOptions || [];
  const normalized = String(merchant).trim().toLowerCase();
  const option = options.find(o => o.displayName && String(o.displayName).trim().toLowerCase() === normalized);
  if (!option) return engine.findMatchingItem(String(merchant), { exactOnly: false });

  // handleQuickSearch：逐個關鍵詞查，依 originalItem 去重，保留先到先得的順序
  const seen = new Set();
  const out = [];
  for (const keyword of (option.merchants || [])) {
    const matches = engine.findMatchingItem(String(keyword).trim()) || [];
    for (const m of matches) {
      const key = String(m.originalItem).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

/**
 * 算出某商家頁會顯示哪些卡片，順序與頁面一致（回饋金額高到低）。
 * 走的路徑與 js/cashback-engine.js 的 calculateCashback() 完全相同：
 * findMatchingItem → 逐卡 calculateCardCashback → 濾掉 cashbackAmount<=0 →
 * mergeResultsByActivity → 依金額排序。
 *
 * @returns {Promise<{names: string[], top: {rate: number, cardName: string}|null}>}
 *   names＝卡片名稱（已去重，保留頁面順序）；top＝第一名那列的回饋率與卡名，
 *   給「推薦比較」內鏈區塊寫「最高 X%（某某卡）」用。rate 直接取結果物件的
 *   `rate` 欄，與畫面上那張卡顯示的「回饋率」是同一個數字（見 results-display.js
 *   的 rateDisplay），不另外用金額回推，否則兩邊會對不上。
 */
async function computeMerchantCards(engine, merchant, amount) {
  const matched = resolveMatchedItems(engine, merchant);
  if (!matched || matched.length === 0) return { names: [], top: null };

  // ⚠️ 這裡的兩段排序都是照抄 calculateCashback()，順序不能省：它每處理完一個匹配項
  // 就先把該項結果排一次序才累加，最後合併完再排一次。JS 的 sort 是穩定排序，所以
  // 同分的卡片最終順序取決於「進入陣列時的順序」——少了那個先排，同分的卡就會換位置
  // （2026-08-16 linepay 頁前三名對不上瀏覽器，就是漏了這一步）。
  const cards = engine.getCardsForComparison();
  const all = [];
  for (const item of matched) {
    const term = String(item.originalItem).toLowerCase();
    const itemResults = [];
    for (const card of cards) {
      const results = await engine.calculateCardCashback(card, term, amount);
      (results || []).forEach(r => itemResults.push(Object.assign({}, r, { card: card, matchedItemName: r.matchedItem })));
    }
    const positive = itemResults.filter(r => r.cashbackAmount > 0);
    if (positive.length > 0) {
      positive.sort((a, b) => b.cashbackAmount - a.cashbackAmount);
      all.push(...positive);
    }
  }

  const merged = engine.mergeResultsByActivity(all);
  merged.sort((a, b) => b.cashbackAmount - a.cashbackAmount);

  // 同一張卡可能因多個活動出現多列（頁面上是這樣顯示的）；清單只留第一次出現，
  // 保持頁面順序——JSON-LD 的 ItemList 列同名兩次沒有意義。
  const seen = new Set();
  const names = [];
  for (const r of merged) {
    const name = r.card && r.card.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  const first = merged[0];
  const top = first && first.card
    ? { rate: first.rate, cardName: first.card.name }
    : null;
  return { names, top };
}

module.exports = { createEngine, computeMerchantCards, MODULES };
