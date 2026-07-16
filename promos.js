/* ==========================================================================
   promos.js — 新戶活動一覽頁的互動邏輯（小而美，無框架，不 fetch cards.data，
   頁面本身就是資料——所有活動內容已由 apps-script/cards-export.gs 的
   generatePromosPageHtml() 靜態生成進 HTML）。

   職責：
   1. 依 data-period-end 即時重算「剩 N 天」徽章（靜態生成的天數會過時）
   2. 隱藏已過期活動（防呆：靜態生成後才過期，或站長忘了重新匯出）
   3. 活動類型篩選 chips
   4. 排序切換（即將截止 / 依卡片）
   5. 「立即申辦」點擊送 GA4 button_click 事件
   6. 活動宣傳圖小縮圖點擊 → lightbox 放大原圖（2026-07-15 新增）
   7. 備註／適用通路客戶端量測：scrollHeight 超過 N 行高才收合＋加「展開 ▾」
      toggle（setupLineClamp 通用機制，備註 2 行、適用通路 3 行，2026-07-16
      第五輪把適用通路併入同一套機制）
   8. 「隱藏我持有的卡片」篩選：唯讀讀取主站 localStorage 的 myOwnedCards_*，
      不寫入/刪除任何 key（2026-07-16 第四輪新增）
   ========================================================================== */

(function () {
  'use strict';

  // 與 apps-script/cards-export.gs 的 pmcTodayISO_() 同一套算法：先轉 UTC 再
  // 固定加 8 小時換算台北時間，不論使用者裝置時區為何都得到一致的「今天」。
  function todayISO() {
    var now = new Date();
    var utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    var taipei = new Date(utcMs + 8 * 3600000);
    var y = taipei.getUTCFullYear();
    var m = String(taipei.getUTCMonth() + 1).padStart(2, '0');
    var d = String(taipei.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  // 容忍 ISO "2026-07-01" 與台式 "2026/7/1"（不一定補零）——data-period-end 屬性
  // 由生成器輸出，理論上一律 ISO，但這裡仍照專案慣例雙格式容忍，不假設只有一種
  // （見 docs/project/data-pipeline.md 第 8 節：日期欄位雙格式陷阱）。
  function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    var s = String(dateStr).trim();
    if (!s) return null;
    var parts;
    if (s.indexOf('-') !== -1) {
      parts = s.split('-').map(Number);
    } else if (s.indexOf('/') !== -1) {
      parts = s.split('/').map(Number);
    } else {
      return null;
    }
    if (parts.length !== 3 || parts.some(function (n) { return isNaN(n); })) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function daysBetween(fromISO, toDateStr) {
    var from = parseLocalDate(fromISO);
    var to = parseLocalDate(toDateStr);
    if (!from || !to) return null;
    return Math.ceil((to - from) / 86400000);
  }

  // 「剩 N 天」徽章：0 天顯示「今天截止」、1-14 天顯示「剩 N 天」，其餘隱藏；
  // 文案與主站搜尋結果一致（script.js 的 isEndingSoon / getDaysUntilEnd 語義）。
  // 順便隱藏已過期活動（data-expired 標記，篩選/排序都不會再讓它重新出現）。
  function refreshBadgesAndExpiry() {
    var today = todayISO();
    var cards = document.querySelectorAll('.promo-card');
    cards.forEach(function (card) {
      var endIso = card.getAttribute('data-period-end');
      var badge = card.querySelector('.promo-ending-badge');
      if (!endIso) {
        if (badge) badge.hidden = true;
        return;
      }
      var diff = daysBetween(today, endIso);
      if (diff === null) {
        if (badge) badge.hidden = true;
        return;
      }
      if (diff < 0) {
        card.hidden = true;
        card.setAttribute('data-expired', '1');
        return;
      }
      if (!badge) return;
      if (diff === 0) {
        badge.textContent = '今天截止';
        badge.hidden = false;
      } else if (diff <= 14) {
        badge.textContent = '剩 ' + diff + ' 天';
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    });
  }

  // 篩選狀態：類型 chips（typeFilter）與「隱藏我持有的卡片」（hideOwned）疊加
  // 運作，統一由 refreshVisibility() 依兩個條件重算每張卡的 hidden，取代原本
  // 只看類型的 applyFilter()（2026-07-16 第四輪站長回饋新增持有卡篩選）。
  var filterState = { typeFilter: 'all', hideOwned: false };
  var ownedCardIds = null; // 讀到的持有卡 id 清單（Array），沒有持有資料時維持 null

  function setupFilters() {
    var chipsContainer = document.getElementById('promos-filter-chips');
    if (!chipsContainer) return;
    chipsContainer.addEventListener('click', function (e) {
      var btn = e.target.closest('.promo-chip');
      if (!btn || !chipsContainer.contains(btn)) return;
      Array.prototype.forEach.call(chipsContainer.querySelectorAll('.promo-chip'), function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      filterState.typeFilter = btn.getAttribute('data-filter') || 'all';
      refreshVisibility();
    });
  }

  function refreshVisibility() {
    var cards = document.querySelectorAll('.promo-card');
    var anyVisible = false;
    cards.forEach(function (card) {
      if (card.getAttribute('data-expired') === '1') {
        card.hidden = true; // 過期卡永遠不重新顯示
        return;
      }
      var buckets = (card.getAttribute('data-type-buckets') || '').split(' ');
      var typeMatch = filterState.typeFilter === 'all' || buckets.indexOf(filterState.typeFilter) !== -1;
      var ownedMatch = true;
      if (filterState.hideOwned && ownedCardIds) {
        var cardId = card.getAttribute('data-card-id') || '';
        ownedMatch = ownedCardIds.indexOf(cardId) === -1;
      }
      var show = typeMatch && ownedMatch;
      card.hidden = !show;
      if (show) anyVisible = true;
    });
    var emptyState = document.getElementById('promos-empty-state');
    if (emptyState) emptyState.hidden = anyVisible;
  }

  // 安全解析 localStorage 的 myOwnedCards_*（訪客 key「myOwnedCards_guest」＋
  // 所有登入者本機鏡像「myOwnedCards_<uid>」的聯集）。純讀取、絕不寫入/刪除任何
  // localStorage key（唯讀鐵則，見 CLAUDE.md 鐵則 2 精神／docs/project/
  // storage-and-security.md 第 1 節）；這頁不載入 script.js，沒有共用的
  // readLocalJSON() 可用，因此自己寫一個容錯的小函數：壞資料一律 try/catch
  // 吞掉、回空陣列，絕不讓 JSON.parse 拋錯中斷頁面其餘互動。
  function readOwnedCardIdsSafe() {
    var ids = [];
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('myOwnedCards_') === 0) keys.push(k);
      }
    } catch (err) {
      console.error('❌ promos.js 掃描 localStorage keys 失敗:', err);
      return [];
    }
    keys.forEach(function (key) {
      try {
        var raw = localStorage.getItem(key);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(function (id) {
            if (typeof id === 'string' && id) ids.push(id);
          });
        }
      } catch (err) {
        console.error('❌ promos.js 解析 ' + key + ' 失敗:', err);
      }
    });
    // 去重
    var seen = {};
    var result = [];
    ids.forEach(function (id) {
      if (seen[id]) return;
      seen[id] = true;
      result.push(id);
    });
    return result;
  }

  // 「隱藏我持有的卡片」篩選：generatePromosPageHtml() 生成當下不知道訪客/用戶
  // 持有哪些卡，.promos-control-group#promos-owned-filter-group 一律先 hidden，
  // 這裡偵測到有持有資料才拿掉 hidden；完全沒讀到任何持有資料（訪客也沒存過、
  // 也沒有任何 uid 鏡像）時整組維持隱藏，不顯示空的篩選項。狀態不記憶——
  // 重整頁面回到未勾選，跟主站精準搜尋 toggle 同哲學。
  function setupOwnedFilter() {
    var group = document.getElementById('promos-owned-filter-group');
    var checkbox = document.getElementById('promos-hide-owned-checkbox');
    if (!group || !checkbox) return;
    var ids = readOwnedCardIdsSafe();
    if (!ids.length) return;
    ownedCardIds = ids;
    group.hidden = false;
    checkbox.addEventListener('change', function () {
      filterState.hideOwned = checkbox.checked;
      refreshVisibility();
    });
    setupOwnedHelp();
  }

  // 「?」浮出說明（2026-07-16 站長回饋）：點擊浮出、不推開版面；
  // 張數＝用戶在「我的信用卡」勾選的張數（ownedCardIds 已去重），
  // 不是頁面上實際被藏的活動卡數（2026-07-16 站長二次指示）。
  function setupOwnedHelp() {
    var btn = document.getElementById('promos-owned-help-btn');
    var pop = document.getElementById('promos-owned-help-pop');
    var countEl = document.getElementById('promos-owned-help-count');
    if (!btn || !pop || !countEl) return;
    countEl.textContent = String(ownedCardIds.length);
    function close() {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = pop.hidden;
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function setupSort() {
    var toggle = document.getElementById('promos-sort-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function (e) {
      var btn = e.target.closest('.promo-sort-btn');
      if (!btn || !toggle.contains(btn)) return;
      Array.prototype.forEach.call(toggle.querySelectorAll('.promo-sort-btn'), function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      applySort(btn.getAttribute('data-sort') || 'deadline');
    });
  }

  function applySort(mode) {
    var grid = document.getElementById('promo-grid');
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.promo-card'));
    cards.sort(function (a, b) {
      if (mode === 'card') {
        var an = a.getAttribute('data-card-name') || '';
        var bn = b.getAttribute('data-card-name') || '';
        return an.localeCompare(bn, 'zh-Hant');
      }
      // 即將截止：period_end 升冪，無截止日（空字串）排最後；同日期用生成順序
      // （data-order-index，來自生成器的 priority 排序）當穩定的次要鍵，
      // 這樣來回切換排序模式時，同日期的相對順序不會因瀏覽器 sort 穩定性而漂移。
      var ae = a.getAttribute('data-period-end') || '';
      var be = b.getAttribute('data-period-end') || '';
      if (!ae) ae = '9999-99-99';
      if (!be) be = '9999-99-99';
      if (ae !== be) return ae < be ? -1 : 1;
      var ai = parseInt(a.getAttribute('data-order-index'), 10) || 0;
      var bi = parseInt(b.getAttribute('data-order-index'), 10) || 0;
      return ai - bi;
    });
    cards.forEach(function (card) { grid.appendChild(card); });
  }

  // 手機版「摘要卡可展開」：點卡片收合區（.promo-card-toggle，除申辦鈕外的整個收合
  // 態表面）展開/收回詳情（新戶定義、達成條件、活動期間、宣傳圖、備註、次要連結）。
  // 用 role="button" 的 div 而非真 <button>——裡面包 <h2> 標題，<button> 的內容模型
  // 不允許 heading 後代（見 cards-export.gs pmcRenderPromoCard_ 註解），所以鍵盤可及性
  // （Enter/Space 觸發）要自己補。
  //
  // 桌機（≥769px）版型維持全部展開、無收合行為（CSS 在該寬度一律強制
  // .promo-card-detail 展開，不看 is-open class）；這裡用 matchMedia 讓桌機寬度下
  // 點擊/按鍵不做事，並讓 aria-expanded 誠實反映「桌機一律展開」的視覺事實。
  function setupCardToggle() {
    var mq = window.matchMedia('(max-width: 768px)');

    function toggle(el) {
      var card = el.closest('.promo-card');
      if (!card) return;
      var isOpen = card.classList.toggle('is-open');
      el.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    function syncAriaForBreakpoint() {
      var toggles = document.querySelectorAll('.promo-card-toggle');
      toggles.forEach(function (el) {
        if (mq.matches) {
          var card = el.closest('.promo-card');
          el.setAttribute('aria-expanded', card && card.classList.contains('is-open') ? 'true' : 'false');
        } else {
          el.setAttribute('aria-expanded', 'true'); // 桌機視覺上一律展開
        }
      });
    }

    // 2026-07-16 第四輪站長回饋：「立即申辦」按鈕移到卡名右側後變成
    // .promo-card-toggle 的後代，點按鈕的 click/keydown 事件會冒泡到這裡；
    // 明確排除 .promo-apply-btn，避免點申辦按鈕時「連帶」觸發卡片展開/收合
    // （按鈕本身的連結行為完全不受影響，仍走瀏覽器預設開新分頁）。
    document.addEventListener('click', function (e) {
      var el = e.target.closest('.promo-card-toggle');
      if (!el || !mq.matches) return;
      if (e.target.closest('.promo-apply-btn')) return;
      toggle(el);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var el = e.target.closest('.promo-card-toggle');
      if (!el || !mq.matches) return;
      if (e.target.closest('.promo-apply-btn')) return;
      e.preventDefault();
      toggle(el);
    });

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', syncAriaForBreakpoint);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(syncAriaForBreakpoint); // Safari < 14 fallback
    }
    syncAriaForBreakpoint();
  }

  // 「立即申辦」點擊 → GA4 button_click（promos.html 內嵌的精簡版 Firebase
  // Analytics 初始化會設定 window.firebaseAnalytics / window.logEvent；
  // 若載入失敗或被封鎖，安靜跳過，不擋使用者點擊申辦連結）。
  function setupApplyTracking() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('.promo-apply-btn[data-ga-track]');
      if (!link) return;
      try {
        if (window.firebaseAnalytics && typeof window.logEvent === 'function') {
          window.logEvent(window.firebaseAnalytics, 'button_click', {
            button_type: 'promos_page_apply',
            card_id: link.getAttribute('data-card-id') || '',
            card_name: link.getAttribute('data-card-name') || ''
          });
        }
      } catch (err) {
        console.error('❌ promos.js GA4 logEvent failed:', err);
      }
    });
  }

  // 外部連結防護：只允許 http/https 開頭，語義同 apps-script/cards-export.gs 的
  // pmcSanitizeUrl_（縮圖 src 已在生成器端過濾過，這裡是多一層保險，不假設
  // data-full-src 屬性值一定乾淨）。
  function sanitizeImgUrl(url) {
    if (typeof url !== 'string') return '';
    var trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : '';
  }

  // 活動宣傳圖 lightbox：點小縮圖（.promo-gift-thumb）開全螢幕深色遮罩置中
  // 看原圖，點遮罩／關閉鈕／Esc 都會關閉。lightbox 元素懶建立（第一次點擊才
  // 塞進 DOM），縮圖按鈕本身在 .promo-card-toggle 之外（見 cards-export.gs
  // pmcRenderPromoCard_ 註解），不需要特別擋 toggle 展開的冒泡，但仍保留
  // stopPropagation 當防禦性寫法，避免未來版面調整後行為悄悄改變。
  function setupGiftLightbox() {
    var lightbox = null;
    var imgEl = null;
    var lastFocused = null;

    function ensureLightbox() {
      if (lightbox) return;
      lightbox = document.createElement('div');
      lightbox.className = 'promo-lightbox';
      lightbox.setAttribute('role', 'dialog');
      lightbox.setAttribute('aria-modal', 'true');
      lightbox.setAttribute('aria-label', '活動宣傳圖放大檢視');
      lightbox.innerHTML =
        '<button type="button" class="promo-lightbox-close" aria-label="關閉放大圖">&times;</button>' +
        '<img class="promo-lightbox-img" src="" alt="">';
      document.body.appendChild(lightbox);
      imgEl = lightbox.querySelector('.promo-lightbox-img');
      lightbox.addEventListener('click', function (e) {
        if (e.target === lightbox || e.target.closest('.promo-lightbox-close')) {
          closeLightbox();
        }
      });
    }

    function openLightbox(src, alt) {
      var safeSrc = sanitizeImgUrl(src);
      if (!safeSrc) return;
      ensureLightbox();
      imgEl.src = safeSrc;
      imgEl.alt = alt || '';
      lightbox.classList.add('is-open');
      lastFocused = document.activeElement;
      lightbox.querySelector('.promo-lightbox-close').focus();
    }

    function closeLightbox() {
      if (!lightbox || !lightbox.classList.contains('is-open')) return;
      lightbox.classList.remove('is-open');
      imgEl.src = '';
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    document.addEventListener('click', function (e) {
      var thumb = e.target.closest('.promo-gift-thumb');
      if (!thumb) return;
      e.preventDefault();
      e.stopPropagation();
      openLightbox(thumb.getAttribute('data-full-src'), thumb.getAttribute('data-full-alt'));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeLightbox();
    });
  }

  // 通用「超過 N 行才收合＋展開 toggle」機制：先讓內容完整渲染，量測
  // scrollHeight 是否超過 N 行高，超過才套 .is-clamped（CSS line-clamp:N）＋
  // 補一個「展開 ▾」toggle 按鈕；N 行內完全不加任何 toggle。呼叫端 CSS 的
  // line-height 要用固定數值（不是 normal），getComputedStyle 才能量到穩定的
  // px 值——見 promos.css .promo-notes-text／.promo-merchants-value。
  // 2026-07-16 第五輪新增「適用通路」3 行收合，跟備註 2 行收合共用同一套邏輯
  // （原本各自一份函數，抽成通用版避免兩份幾乎一樣的程式碼分岔）。
  function setupLineClamp(selector, maxLines, toggleClassName) {
    var blocks = document.querySelectorAll(selector);
    blocks.forEach(function (el) {
      var lineHeight = parseFloat(window.getComputedStyle(el).lineHeight);
      if (!lineHeight || isNaN(lineHeight)) return; // 量不到就保留完整顯示，不冒然收合
      var maxHeight = lineHeight * maxLines;
      var fullHeight = el.scrollHeight;
      if (fullHeight <= maxHeight + 1) return; // N 行內，不加 toggle
      el.classList.add('is-clamped');
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = toggleClassName;
      toggle.textContent = '展開 ▾';
      toggle.setAttribute('aria-expanded', 'false');
      // 插在量測目標之後（afterend）：備註量測目標是 <div>，適用通路量測目標是
      // <dl><dd> 內的 <span>（見 apps-script/cards-export.gs 的 clampClass 註解），
      // 兩種情況 afterend 插入點都還是合法的 flow/phrasing content，不會破壞
      // <dl> 只能有 dt/dd 子元素的內容模型。
      el.insertAdjacentElement('afterend', toggle);
      toggle.addEventListener('click', function () {
        var stillClamped = el.classList.toggle('is-clamped');
        var isOpen = !stillClamped;
        toggle.textContent = isOpen ? '收合 ▴' : '展開 ▾';
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    });
  }

  function setupNotesClamp() {
    setupLineClamp('.promo-notes-text', 2, 'promo-notes-toggle');
  }

  function setupMerchantsClamp() {
    setupLineClamp('.promo-merchants-value', 3, 'promo-notes-toggle');
  }

  // 光影效果試用（TRIAL，站長選定後移除——對應 promos.css 底部試用區塊）：
  // ?shine=once|auto|glow 在 <body> 設 data-shine，讓三種效果可在真機上切換比較。
  function setupShineTrial() {
    var v = new URLSearchParams(location.search).get('shine');
    if (v === 'once' || v === 'auto' || v === 'glow') document.body.dataset.shine = v;
  }

  document.addEventListener('DOMContentLoaded', function () {
    refreshBadgesAndExpiry();
    setupFilters();
    setupOwnedFilter();
    setupSort();
    setupCardToggle();
    setupApplyTracking();
    setupGiftLightbox();
    setupNotesClamp();
    setupMerchantsClamp();
    setupShineTrial();
  });
})();
