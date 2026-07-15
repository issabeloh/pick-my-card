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

  function setupFilters() {
    var chipsContainer = document.getElementById('promos-filter-chips');
    if (!chipsContainer) return;
    chipsContainer.addEventListener('click', function (e) {
      var btn = e.target.closest('.promo-chip');
      if (!btn || !chipsContainer.contains(btn)) return;
      Array.prototype.forEach.call(chipsContainer.querySelectorAll('.promo-chip'), function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      applyFilter(btn.getAttribute('data-filter') || 'all');
    });
  }

  function applyFilter(filter) {
    var cards = document.querySelectorAll('.promo-card');
    var anyVisible = false;
    cards.forEach(function (card) {
      if (card.getAttribute('data-expired') === '1') return; // 過期卡永遠不重新顯示
      var buckets = (card.getAttribute('data-type-buckets') || '').split(' ');
      var show = filter === 'all' || buckets.indexOf(filter) !== -1;
      card.hidden = !show;
      if (show) anyVisible = true;
    });
    var emptyState = document.getElementById('promos-empty-state');
    if (emptyState) emptyState.hidden = anyVisible;
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

    document.addEventListener('click', function (e) {
      var el = e.target.closest('.promo-card-toggle');
      if (!el || !mq.matches) return;
      toggle(el);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var el = e.target.closest('.promo-card-toggle');
      if (!el || !mq.matches) return;
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

  document.addEventListener('DOMContentLoaded', function () {
    refreshBadgesAndExpiry();
    setupFilters();
    setupSort();
    setupCardToggle();
    setupApplyTracking();
  });
})();
