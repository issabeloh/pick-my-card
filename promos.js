/* ==========================================================================
   promos.js — 新戶活動一覽頁的互動邏輯（小而美，無框架，不 fetch cards.data，
   頁面本身就是資料——所有活動內容已由 apps-script/cards-export.gs 的
   generatePromosPageHtml() 靜態生成進 HTML）。

   職責：
   1. 依每檔活動的 data-period-end 即時重算「最後 N 天」徽章（靜態生成的天數會過時）
   2. 隱藏已過期活動（逐檔；整組都過期才藏整張卡）
   3. 活動類型篩選 chips
   4. 活動詳情展開／收合（一張卡一組、組內一次只開一檔）
   5. 卡片特色抽屜（與活動堆疊互斥）＋「查看全部 ›」開內嵌詳情並捲到指定通路回饋
   6. 「立即申辦」點擊送 GA4 button_click 事件
   7. 活動宣傳圖縮圖點擊 → lightbox 放大原圖（2026-07-15 新增）
   8. 備註／適用通路客戶端量測：scrollHeight 超過 N 行高才收合＋加「展開 ▾」
      toggle。⚠️ 2026-09-17 起詳情預設收合，量測改到「展開之後」才做——
      display:none 時 scrollHeight 恆為 0
   9. 「隱藏我持有的卡片」篩選：唯讀讀取主站 localStorage 的 myOwnedCards_*，
      不寫入/刪除任何 key（2026-07-16 第四輪新增）

   ⚠️ 排序切換已於 2026-09-17 移除（站長裁定）：清單固定依「最高可拿」倒序。
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

  // 「最後 N 天」徽章：0 天顯示「今天截止」、1-14 天顯示「最後 N 天」，其餘隱藏；
  // 文案與主站搜尋結果一致（script.js 的 isEndingSoon / getDaysUntilEnd 語義）。
  // 順便隱藏已過期活動（data-expired 標記，篩選/排序都不會再讓它重新出現）。
  // 「最後 N 天」徽章與過期隱藏：2026-09-17 改版後改成**逐檔活動**判斷——一張卡
  // 可能有 4 檔活動、到期日各不相同（中信 uniopen 就是），掛在卡片上會算錯。
  // 整組活動都過期時，才把整張卡標記成過期（篩選/搜尋都不會再讓它重新出現）。
  function refreshBadgesAndExpiry() {
    var today = todayISO();
    document.querySelectorAll('.promo-card').forEach(function (card) {
      var acts = card.querySelectorAll('.promo-act');
      if (!acts.length) return;
      var aliveCount = 0;
      acts.forEach(function (act) {
        var endIso = act.getAttribute('data-period-end');
        var badge = act.querySelector('.promo-ending-badge');
        if (!endIso) { aliveCount++; if (badge) badge.hidden = true; return; }
        var diff = daysBetween(today, endIso);
        if (diff === null) { aliveCount++; if (badge) badge.hidden = true; return; }
        if (diff < 0) { act.hidden = true; return; }   // 這一檔過期 → 只藏這一檔
        aliveCount++;
        if (!badge) return;
        if (diff === 0) { badge.textContent = '今天截止！'; badge.hidden = false; }
        else if (diff <= 14) { badge.textContent = '最後 ' + diff + ' 天'; badge.hidden = false; }
        else { badge.hidden = true; }
      });
      if (aliveCount === 0) {
        card.hidden = true;
        card.setAttribute('data-expired', '1');
      }
    });
    refreshSectionBadges(today);
    refreshEndingChip();
  }

  // 站長推薦／行李箱專區（2026-09-23）：一格一檔活動，規則同上——過期藏起來、14 天內掛徽章。
  // 整區都過期時連標題一起藏；行李箱剩不到 2 檔就不成比較，也整區藏。
  function refreshSectionBadges(today) {
    [['.pmc-picks', '.pmc-pick', 1], ['.pmc-luggage', '.pmc-lg', 2]].forEach(function (def) {
      var section = document.querySelector(def[0]);
      if (!section) return;
      var alive = 0;
      section.querySelectorAll(def[1]).forEach(function (item) {
        var endIso = item.getAttribute('data-period-end');
        var badge = item.querySelector('.promo-ending-badge');
        var diff = endIso ? daysBetween(today, endIso) : null;
        if (diff !== null && diff < 0) { item.hidden = true; return; }
        alive++;
        if (!badge) return;
        if (diff === 0) { badge.textContent = '今天截止！'; badge.hidden = false; }
        else if (diff !== null && diff <= 14) { badge.textContent = '最後 ' + diff + ' 天'; badge.hidden = false; }
        else { badge.hidden = true; }
      });
      section.hidden = alive < def[2];
    });
  }

  // 「即將結束」篩選（2026-09-20 站長需求）：只要這張卡還有任何一檔活動掛著
  // 「最後 N 天／今天截止！」徽章，就算即將結束。**數量只能在這裡算**——徽章是拿
  // 「今天」逐檔比出來的，靜態生成當下寫死的數字隔天就錯（一次匯出可能掛好幾週）。
  // 生成器只輸出一顆 hidden 的骨架 chip，數字與顯示與否都由這裡決定。
  function refreshEndingChip() {
    var count = 0;
    document.querySelectorAll('.promo-card').forEach(function (card) {
      if (card.getAttribute('data-expired') === '1') { card.removeAttribute('data-has-ending'); return; }
      var has = false;
      card.querySelectorAll('.promo-act').forEach(function (act) {
        if (act.hidden) return;
        var badge = act.querySelector('.promo-ending-badge');
        if (badge && !badge.hidden) has = true;
      });
      if (has) { card.setAttribute('data-has-ending', '1'); count++; }
      else card.removeAttribute('data-has-ending');
    });
    var chip = document.getElementById('promos-chip-ending');
    if (!chip) return;
    var countEl = document.getElementById('promos-chip-ending-count');
    if (countEl) countEl.textContent = String(count);
    chip.hidden = count === 0;
    // 一張都沒有時把 chip 藏起來；若當下正停在這個篩選上，退回「全部」，
    // 否則使用者會看到空清單卻找不到是哪個篩選造成的。
    if (count === 0 && filterState.typeFilter === 'ending') {
      var allChip = document.querySelector('.promo-chip[data-filter="all"]');
      if (allChip) allChip.click();
    }
  }

  // 篩選狀態：類型 chips（typeFilter）與「隱藏我持有的卡片」（hideOwned）疊加
  // 運作，統一由 refreshVisibility() 依兩個條件重算每張卡的 hidden，取代原本
  // 只看類型的 applyFilter()（2026-07-16 第四輪站長回饋新增持有卡篩選）。
  var filterState = { typeFilter: 'all', hideOwned: false, searchQuery: '' };
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

  // 卡片名稱＋適用通路搜尋（2026-07-22 起卡名，2026-08-18 加通路）：即時 substring
  // 比對 data-card-name 與該卡的「適用通路」文字，疊加在類型/
  // 持有卡篩選之上（統一由 refreshVisibility 依三個條件重算每張卡的 hidden）。
  // 比對前一律 toLowerCase + trim——卡名多為中文，但 Richart／iLEO／Ubear 等
  // 拉丁字要大小寫不敏感。純前端過濾，不 fetch。清除 ✕ 鈕有輸入才顯示，樣式與
  // 主站 #merchant-input 的清除鈕一致。狀態不記憶——重整回到未搜尋（跟類型/排序
  // toggle 同哲學）。
  function setupSearch() {
    var input = document.getElementById('promos-search-input');
    var clearBtn = document.getElementById('promos-search-clear-btn');
    if (!input) return;
    function apply() {
      filterState.searchQuery = input.value.trim().toLowerCase();
      if (clearBtn) clearBtn.hidden = !input.value;
      refreshVisibility();
    }
    input.addEventListener('input', apply);
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        input.focus();
        apply();
      });
    }
  }

  // 「適用通路」（bonus_merchants）也要能搜到，例如輸入「line pay」要找出所有
  // 加碼通路含 LINE Pay 的活動。刻意直接讀已經渲染在卡片裡的 .promo-merchants-value
  // ——不請生成器另外多輸出一份 data-bonus-merchants：同一份資料兩個來源遲早分岔，
  // 而且這樣現有的 promos.html 不用重新匯出就生效。
  // 只有回饋加碼型活動會有這個節點（生成器僅在 bonus_merchants 非空時輸出），
  // 正好就是需要被通路搜到的那些；沒有的卡回傳空字串、永遠比不中。
  // 每張卡只讀一次就快取在元素上——每按一個鍵都會重算全部卡片，不快取等於每次
  // 都對整份 DOM 取一次 textContent。
  function promoMerchantsText(card) {
    if (card.__pmcMerchantsText === undefined) {
      var el = card.querySelector('.promo-merchants-value');
      card.__pmcMerchantsText = el ? (el.textContent || '').toLowerCase() : '';
    }
    return card.__pmcMerchantsText;
  }

  function refreshVisibility() {
    var cards = document.querySelectorAll('.promo-card');
    var anyVisible = false;
    cards.forEach(function (card) {
      if (card.getAttribute('data-expired') === '1') {
        card.hidden = true; // 過期卡永遠不重新顯示
        return;
      }
      var typeMatch;
      if (filterState.typeFilter === 'all') {
        typeMatch = true;
      } else if (filterState.typeFilter === 'ending') {
        // 「即將結束」不是 promo_types 的一種，是由徽章推出來的狀態
        // （data-has-ending 由 refreshEndingChip() 每次重算徽章時寫上）
        typeMatch = card.getAttribute('data-has-ending') === '1';
      } else {
        typeMatch = (card.getAttribute('data-type-buckets') || '').split(' ')
          .indexOf(filterState.typeFilter) !== -1;
      }
      var ownedMatch = true;
      if (filterState.hideOwned && ownedCardIds) {
        var cardId = card.getAttribute('data-card-id') || '';
        ownedMatch = ownedCardIds.indexOf(cardId) === -1;
      }
      var searchMatch = true;
      if (filterState.searchQuery) {
        var cardName = (card.getAttribute('data-card-name') || '').toLowerCase();
        searchMatch = cardName.indexOf(filterState.searchQuery) !== -1 ||
          promoMerchantsText(card).indexOf(filterState.searchQuery) !== -1;
      }
      var show = typeMatch && ownedMatch && searchMatch;
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

  // 活動詳情展開／收合（2026-09-17 改版）。
  // 一張卡一組、組內可能有多檔活動，每一檔都有自己的詳情（適用通路／達成條件／
  // 活動期間／新戶定義／備註）——同一張卡的多檔活動條件各不相同，所以詳情掛在
  // 「活動」身上而不是「卡片」身上。
  // 同一組內一次只開一個：開另一檔會先把前一檔收起來，避免整組被撐到看不完。
  // 桌機手機一致（不再像舊版那樣桌機強制全展開——那會讓 23 組卡片的頁面長到失控）。
  function closeActsIn(card) {
    card.querySelectorAll('.promo-act-row[aria-expanded="true"]').forEach(function (row) {
      row.setAttribute('aria-expanded', 'false');
      var detail = document.getElementById(row.getAttribute('aria-controls') || '');
      if (detail) detail.hidden = true;
    });
  }

  function setupActToggle() {
    document.addEventListener('click', function (e) {
      // 活動宣傳圖縮圖在 row 內，點它是要看大圖、不是展開詳情（見 setupGiftLightbox）。
      // 附屬列的小獎品圖（.promo-sub-thumb--gift）同理。
      if (e.target.closest('.promo-act-thumb--gift, .promo-sub-thumb--gift')) return;
      var row = e.target.closest('.promo-act-row');
      if (!row) return;
      var card = row.closest('.promo-card');
      if (!card) return;
      var wasOpen = row.getAttribute('aria-expanded') === 'true';
      closeActsIn(card);
      setFeatOpen(card, false);
      if (wasOpen) return;
      // 狀態一律掛在 row 的 aria-expanded 上（CSS 也是用它選），不另外掛 class
      row.setAttribute('aria-expanded', 'true');
      var detail = document.getElementById(row.getAttribute('aria-controls') || '');
      if (!detail) return;
      detail.hidden = false;
      // ⚠️ 收合時 display:none，scrollHeight 恆為 0——量測一定要等展開之後才做，
      // 否則備註／適用通路會全部被判定成「不需要收合」（2026-09-17 實測踩到）。
      clampWithin(detail);
    });
  }

  // 卡片特色（2026-09-17 做成抽屜，2026-09-20 起一律改 modal）。
  // 特色內容由部署時的 tools/build-promos-features.js 注入；
  // 沒跑生成器時容器是空的，這裡直接把按鈕藏起來，頁面其餘部分照常可用。
  // 手機與桌機都走 modal，版面在展開前後完全不動，所以不需要任何狀態 class。
  // 一律用 modal 呈現（2026-09-18 桌機先改，2026-09-20 站長要求手機也跟進）——
  // 特色有 5~7 列＋國內外基準列，就地展開會把整組卡片撐掉一整屏、下面的卡全被推走，
  // 手機上尤其嚴重（一展開就看不到自己原本在看哪張卡）。抽屜容器 .promo-card-feat
  // 保留著當內容來源與退路，但永遠不再展開。
  var featModal = null;
  var featModalBody = null;
  var featModalFoot = null;
  var featModalTitle = null;
  var featModalBtn = null;   // 開啟這個 modal 的「卡片特色」按鈕，關閉時要還原 aria/焦點

  function ensureFeatModal() {
    if (featModal) return;
    featModal = document.createElement('div');
    featModal.className = 'promo-feat-modal';
    featModal.setAttribute('role', 'dialog');
    featModal.setAttribute('aria-modal', 'true');
    featModal.setAttribute('aria-label', '卡片特色');
    featModal.innerHTML =
      '<div class="promo-feat-modal-inner">' +
      '<div class="promo-feat-modal-head">' +
      '<span class="promo-feat-modal-heading">' +
      '<span class="promo-feat-modal-kicker">卡片特色</span>' +
      '<b class="promo-feat-modal-title"></b>' +
      '</span>' +
      '<button type="button" class="promo-feat-modal-close" aria-label="關閉卡片特色">&times;</button>' +
      '</div>' +
      '<div class="promo-feat-modal-body"></div>' +
      '<div class="promo-feat-modal-foot" hidden></div>' +
      '</div>';
    document.body.appendChild(featModal);
    featModalBody = featModal.querySelector('.promo-feat-modal-body');
    featModalFoot = featModal.querySelector('.promo-feat-modal-foot');
    featModalTitle = featModal.querySelector('.promo-feat-modal-title');
    featModal.addEventListener('click', function (e) {
      // 點「查看全部」也要關：它接著會開卡片詳情 overlay（setupCardDetailOverlay 的
      // document 委派會收到同一次點擊），兩層遮罩疊著會看不懂。這時焦點交給 overlay，
      // 不要搶回按鈕。
      if (e.target.closest('.promo-feat-all')) { closeFeatModal(false); return; }
      if (e.target === featModal || e.target.closest('.promo-feat-modal-close')) closeFeatModal(true);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeFeatModal(true);
    });
  }

  function openFeatModal(card, btn) {
    var drawer = card.querySelector('.promo-card-feat');
    if (!drawer || !drawer.innerHTML.trim()) return false;
    ensureFeatModal();
    featModalTitle.textContent = card.getAttribute('data-card-name') || '卡片特色';
    // 內容是部署時由 tools/build-promos-features.js 注入的靜態片段：沒有 id、也沒有
    // 綁在節點上的事件（「查看全部」走 document 委派），所以複製 HTML 就夠，
    // 不必把節點搬進搬出——搬動會讓收合狀態與 DOM 順序變得難以推理。
    featModalBody.innerHTML = drawer.innerHTML;
    // 「查看卡片詳情」從內容區搬到 footer 當 CTA（站長 2026-09-21）。
    // 搬的是節點本身，所以 setupCardDetailOverlay 的 document 委派照常收得到點擊。
    var all = featModalBody.querySelector('.promo-feat-all');
    featModalFoot.innerHTML = '';
    featModalFoot.hidden = !all;
    if (all) featModalFoot.appendChild(all);
    // 連結搬走後，抬頭那一列可能只剩被 CSS 藏起來的 <b>（沒有級別標籤時就整列空了），
    // 留著會多出一段空白邊距。⚠️ .promo-feat-head 有 display:flex，author display 會蓋掉
    // [hidden] 的預設值——CSS 另外補了 .promo-feat-head[hidden]{display:none}。
    var head = featModalBody.querySelector('.promo-feat-head');
    if (head && !head.querySelector('.promo-feat-level')) head.hidden = true;
    featModal.classList.add('is-open');
    featModalBtn = btn || null;
    featModal.querySelector('.promo-feat-modal-close').focus();
    return true;
  }

  function closeFeatModal(restoreFocus) {
    if (!featModal || !featModal.classList.contains('is-open')) return;
    featModal.classList.remove('is-open');
    featModalBody.innerHTML = '';
    if (featModalFoot) { featModalFoot.innerHTML = ''; featModalFoot.hidden = true; }
    if (featModalBtn) {
      featModalBtn.setAttribute('aria-expanded', 'false');
      if (restoreFocus) featModalBtn.focus();
      featModalBtn = null;
    }
  }

  function setFeatOpen(card, open) {
    var btn = card.querySelector('.promo-feat-btn');
    var drawer = card.querySelector('.promo-card-feat');
    if (!btn || !drawer) return;
    if (open) { if (!openFeatModal(card, btn)) return; }
    else closeFeatModal(false);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    drawer.hidden = true;              // 抽屜永遠收著，內容一律由 modal 呈現
  }

  function setupFeatToggle() {
    document.querySelectorAll('.promo-card').forEach(function (card) {
      var drawer = card.querySelector('.promo-card-feat');
      var btn = card.querySelector('.promo-feat-btn');
      if (btn && (!drawer || !drawer.innerHTML.trim())) btn.hidden = true;
    });
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.promo-feat-btn');
      if (!btn) return;
      var card = btn.closest('.promo-card');
      if (!card) return;
      setFeatOpen(card, btn.getAttribute('aria-expanded') !== 'true');
    });
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
            card_name: link.getAttribute('data-card-name') || '',
            surface: 'promos_page',
            // 站長推薦／行李箱專區的按鈕帶 data-ga-section（picks／luggage），清單的按鈕是 list
            section: link.getAttribute('data-ga-section') || 'list'
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

  // 活動宣傳圖 lightbox：點縮圖（.promo-act-thumb--gift）開全螢幕深色遮罩置中
  // 看原圖，點遮罩／關閉鈕／Esc 都會關閉。lightbox 元素懶建立（第一次點擊才塞進 DOM）。
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

    // 縮圖在 .promo-act-row（<button>）內部，點它會冒泡成「展開活動詳情」——
    // setupActToggle 開頭已經先排除 .promo-act-thumb--gift，這裡再 stopPropagation
    // 當第二層保險。只有活動宣傳圖（獎品）可放大；退回卡片圖的縮圖不進 lightbox。
    // 附屬列右側的小圖（.promo-sub-thumb--gift，42px）走同一條路。
    document.addEventListener('click', function (e) {
      var thumb = e.target.closest('.promo-act-thumb--gift, .promo-sub-thumb--gift');
      if (!thumb) return;
      var img = thumb.querySelector('img');
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      openLightbox(img.getAttribute('src'), img.getAttribute('alt'));
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
  function setupLineClamp(selector, maxLines, toggleClassName, root) {
    var blocks = (root || document).querySelectorAll(selector);
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

  // 2026-09-17：活動詳情預設收合（display:none），量測必須改成「展開之後才做」，
  // 而且同一個區塊只量一次（用 data-clamped 記號防重複插入 toggle 按鈕）。
  function clampWithin(root) {
    if (!root || root.dataset.clamped === '1') return;
    root.dataset.clamped = '1';
    setupLineClamp('.promo-notes-text', 2, 'promo-notes-toggle', root);
    setupLineClamp('.promo-merchants-value', 3, 'promo-notes-toggle', root);
  }

  // 光影效果試用（TRIAL，站長選定後移除——對應 promos.css 底部試用區塊）：
  // ?shine=once|auto|glow 在 <body> 設 data-shine，讓三種效果可在真機上切換比較。
  function setupShineTrial() {
    var v = new URLSearchParams(location.search).get('shine');
    if (v === 'once' || v === 'auto' || v === 'glow') document.body.dataset.shine = v;
  }

  // ------------------------------------------------------------------
  // 手機漢堡側選單開合（2026-07-16 header 一致化改版）。header 右側原本試過
  // 頭像＋dropdown，站長二輪回饋裁定「副頁頭像做不到主站完整功能，意義不大」，
  // 已退回「返回首頁」鈕（純 <a> 連結，不需要 JS 狀態切換，見 cards-export.gs
  // 的 pmcPageTemplate_）。
  // ------------------------------------------------------------------

  // 手機漢堡側選單開合：比照 script.js setupSidebarDrawer()（script.js:6727-6772）。
  // promos.js 獨立載入、不共用 script.js 的 disableBodyScroll/enableBodyScroll
  // （那組有 refcount 是為了主站多層 modal 疊加），這裡頁面單純，簡化成直接
  // 鎖/解鎖 body 捲動。
  function setupSidebarDrawer() {
    var sidebar = document.getElementById('promos-sidebar');
    var overlay = document.getElementById('promos-sidebar-overlay');
    var toggleBtn = document.getElementById('promos-sidebar-toggle-btn');
    var closeBtn = document.getElementById('promos-sidebar-close-btn');
    if (!sidebar || !overlay || !toggleBtn || !closeBtn) return;

    function openDrawer() {
      sidebar.classList.add('open');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    toggleBtn.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) closeDrawer();
    });
  }

  // 回到頂部浮標（手機版，2026-07-16 新增）：比照 script.js setupBackToTopButton()
  // （script.js:1409-1430）——捲動超過 300px 才顯示，點擊平滑捲回頂部。
  function setupBackToTopButton() {
    var btn = document.getElementById('promos-back-to-top-btn');
    if (!btn) return;

    var toggle = function () {
      var scrolled = (window.pageYOffset || document.documentElement.scrollTop) > 300;
      btn.classList.toggle('is-visible', scrolled);
    };

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { toggle(); ticking = false; });
    }, { passive: true });

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    toggle();
  }

  // 卡片詳情內嵌彈窗（2026-07-16，站長核准「方案 A」）：點 ⓘ 不再開新分頁，改在頁內
  // 用一個常駐、只建立一次的 iframe 載入主站 /?start&embed=1，postMessage 換卡讓第二
  // 張以後的卡「秒開」。協定（origin 兩端都檢查，只信 location.origin）：
  //   iframe → 父頁：{type:'pmc-embed-ready'}（初始化完成）、
  //            {type:'pmc-detail-closed'}（modal 被關閉，兩條關閉路徑共用同一個
  //            closeModal，見 script.js showCardDetail）
  //   父頁 → iframe：{type:'pmc-open-card', cardId}（開/換卡）
  // 逾時 fallback：首次點擊後 8 秒內沒收到 ready，視為 iframe 內嵌不可行（例如
  // script.js 初始化卡住），放棄攔截、改用原本 <a> 的 href 開新分頁（target="_blank"
  // 已內建在生成的 HTML 裡），並記下「已放棄」——之後的點擊完全不再攔截、直接讓瀏覽器
  // 原生開新分頁，不會每次都空等 8 秒。
  function setupCardDetailOverlay() {
    var READY_TIMEOUT_MS = 8000;
    var overlay = null;
    var iframeEl = null;
    var spinnerEl = null;
    var iframeReady = false;
    var iframeGaveUp = false;
    var readyTimer = null;
    var pendingSection = '';
    var pendingCardId = null; // ready 之前點擊時先記住，ready 到達後補送
    var scrollLocked = false;
    var scrollLockY = 0;

    // 鎖父頁捲動：這裡只管 promos.html 自己這個 document，跟 iframe 內主站自己的
    // body scroll lock（disableBodyScroll/enableBodyScroll，refcount）完全獨立，
    // 兩個 document 互不知道對方存在，不會互相干擾也不用互相通知。
    function lockScroll() {
      if (scrollLocked) return;
      scrollLocked = true;
      scrollLockY = window.scrollY || window.pageYOffset || 0;
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + scrollLockY + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
    }

    function unlockScroll() {
      if (!scrollLocked) return;
      scrollLocked = false;
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollLockY);
    }

    function ensureOverlay() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.className = 'promo-detail-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', '卡片詳情');
      overlay.innerHTML =
        '<div class="promo-detail-overlay-inner">' +
        '<div class="promo-detail-spinner" aria-hidden="true"></div>' +
        '<iframe class="promo-detail-iframe" title="卡片詳情" src="/?start&embed=1"></iframe>' +
        '</div>';
      document.body.appendChild(overlay);
      iframeEl = overlay.querySelector('.promo-detail-iframe');
      spinnerEl = overlay.querySelector('.promo-detail-spinner');
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) hideOverlay();
      });
      readyTimer = window.setTimeout(function () {
        if (iframeReady) return;
        iframeGaveUp = true;
        console.error('❌ promos.js 卡片詳情 iframe 逾時（' + READY_TIMEOUT_MS + 'ms）未就緒，改開新分頁');
        var fallbackCardId = pendingCardId;
        pendingCardId = null;
        hideOverlay();
        if (fallbackCardId) openInNewTab(fallbackCardId);
      }, READY_TIMEOUT_MS);
    }

    function showOverlay() {
      ensureOverlay();
      overlay.classList.add('is-open');
      if (spinnerEl) spinnerEl.hidden = iframeReady;
      lockScroll();
    }

    function hideOverlay() {
      if (!overlay) return;
      overlay.classList.remove('is-open');
      unlockScroll();
    }

    function openInNewTab(cardId) {
      window.open('/?start&card=' + encodeURIComponent(cardId), '_blank', 'noopener,noreferrer');
    }

    function requestCard(cardId, section) {
      if (!iframeEl || !iframeEl.contentWindow) return;
      try {
        iframeEl.contentWindow.postMessage(
          { type: 'pmc-open-card', cardId: cardId, section: section || '' }, location.origin);
      } catch (err) {
        console.error('❌ promos.js postMessage pmc-open-card 失敗:', err);
      }
    }

    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin) return;
      var data = event.data;
      if (!data || !data.type) return;
      if (data.type === 'pmc-embed-ready') {
        iframeReady = true;
        if (readyTimer) {
          window.clearTimeout(readyTimer);
          readyTimer = null;
        }
        if (spinnerEl) spinnerEl.hidden = true;
        if (pendingCardId) {
          requestCard(pendingCardId, pendingSection);
          pendingCardId = null;
          pendingSection = '';
        }
      } else if (data.type === 'pmc-detail-closed') {
        hideOverlay();
      }
    });

    // Esc 在父頁也能關（iframe 內 modal 本身沒有 Esc 監聽，這裡是唯一的鍵盤關閉路徑）。
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && overlay && overlay.classList.contains('is-open')) {
        hideOverlay();
      }
    });

    // 入口：卡片特色區右上角的「查看全部 ›」（2026-09-17 起取代舊的卡名旁 ⓘ 鈕）。
    // data-section 讓詳情開啟後直接捲到「指定通路回饋」那一段，不用使用者自己找。
    document.addEventListener('click', function (e) {
      var link = e.target.closest('.promo-feat-all');
      if (!link) return;
      var cardId = link.getAttribute('data-card-id');
      if (!cardId || iframeGaveUp) return; // 沒有 id，或已逾時放棄 → 放行原生 <a> 行為
      e.preventDefault();
      showOverlay();
      var section = link.getAttribute('data-section') || '';
      if (iframeReady) {
        requestCard(cardId, section);
      } else {
        pendingCardId = cardId;
        pendingSection = section;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupSidebarDrawer();
    setupBackToTopButton();
    refreshBadgesAndExpiry();
    setupFilters();
    setupSearch();
    setupOwnedFilter();
    setupActToggle();
    setupFeatToggle();
    setupApplyTracking();
    setupGiftLightbox();
    setupShineTrial();
    setupCardDetailOverlay();
  });
})();
