/* ============================================================
   Pick My Card — Landing Page scrollytelling 引擎
   - 純 vanilla JS：scroll 進度 → 幕切換 + 幕內元素進場（可倒帶重播）
   - prefers-reduced-motion：關掉整個引擎，改為靜態依序排版
   ============================================================ */
(function () {
    'use strict';

    // 記錄「看過 landing」：之後打 pickmycard.app 會直接進工具，不再導回來
    try { localStorage.setItem('pmc_seen_landing', '1'); } catch (e) { /* 無痕模式忽略 */ }

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var typedEl = document.getElementById('lp-typed');
    var typedText = typedEl ? (typedEl.getAttribute('data-text') || '') : '';

    /* ---------- 減少動態：靜態版 ---------- */
    if (reduced) {
        document.documentElement.classList.add('lp-reduced');
        if (typedEl) typedEl.textContent = typedText;
        // 所有進場元素直接進入最終狀態
        document.querySelectorAll('[data-at]').forEach(function (el) {
            el.classList.add('on');
        });
        document.querySelectorAll('.lp-scene').forEach(function (s) {
            s.classList.add('active');
        });
        var brainPctStatic = document.getElementById('lp-brain-pct');
        if (brainPctStatic) brainPctStatic.textContent = '100%';
        return;
    }

    /* ---------- Scrolly 引擎 ---------- */
    var scrolly = document.getElementById('lp-scrolly');
    var progressBar = document.getElementById('lp-progress-bar');
    var hint = document.getElementById('lp-hint');
    var scrollCue = document.getElementById('lp-scrollcue');
    var scenes = Array.prototype.slice.call(document.querySelectorAll('.lp-scene'));

    // 各幕在總進度中的相對長度（第 1 幕兩段式最長；其餘幕動畫改為進場即播，
    // 不需要長滾動距離）
    var weights = [2.0, 0.8, 1.0, 0.9, 0.8, 1.0, 0.8];
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var bounds = [];
    (function () {
        var acc = 0;
        for (var i = 0; i < weights.length; i++) {
            bounds.push([acc / total, (acc + weights[i]) / total]);
            acc += weights[i];
        }
    })();

    // 每幕的 [data-at]（進場）與 [data-out]（退場）元素快取
    var sceneFx = scenes.map(function (scene) {
        return Array.prototype.slice.call(scene.querySelectorAll('[data-at]')).map(function (el) {
            return {
                el: el,
                at: parseFloat(el.getAttribute('data-at')) || 0,
                out: el.hasAttribute('data-out') ? parseFloat(el.getAttribute('data-out')) : null
            };
        });
    });

    var s1 = scenes[0];
    var brainBar = document.getElementById('lp-brain-bar');
    var brainPct = document.getElementById('lp-brain-pct');
    var skipBtn = document.getElementById('lp-skip');

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    /* 第 1 幕：維持滾動驅動（收斂/結果卡/品牌是滾動敘事的主軸） */
    function applyScene(idx, subP) {
        sceneFx[idx].forEach(function (item) {
            item.el.classList.toggle('on', subP >= item.at);
            if (item.out !== null) item.el.classList.toggle('out', subP >= item.out);
        });
    }

    /* 第 2 幕起：進場後一次連續播放整幕動畫（約 0.9 秒內全部出齊），
       data-at 只當「出場順序」用；離開該幕即重置，回來會重播 */
    var SCENE_PLAY_TOTAL = 900;
    var scenePlayed = scenes.map(function () { return false; });
    var sceneTimers = scenes.map(function () { return []; });
    function playScene(i) {
        if (scenePlayed[i]) return;
        scenePlayed[i] = true;
        var items = sceneFx[i].slice().sort(function (a, b) { return a.at - b.at; });
        var n = items.length;
        items.forEach(function (item, k) {
            var d = n > 1 ? Math.round(k / (n - 1) * SCENE_PLAY_TOTAL) : 0;
            sceneTimers[i].push(setTimeout(function () { item.el.classList.add('on'); }, d));
        });
    }
    function resetScene(i) {
        if (!scenePlayed[i]) return;
        scenePlayed[i] = false;
        sceneTimers[i].forEach(clearTimeout);
        sceneTimers[i] = [];
        sceneFx[i].forEach(function (item) { item.el.classList.remove('on'); });
    }

    /* 「省下的腦力」進度條：結果卡出現後自動跑完（約 0.9 秒），不綁滑動距離 */
    var S1_CARD_AT = 0.24;
    var brainAnim = null;
    var brainPlayed = false;
    function playBrain() {
        brainPlayed = true;
        var start = performance.now();
        var dur = 900;
        function step(t) {
            var q = Math.min(1, (t - start) / dur);
            var eased = 1 - Math.pow(1 - q, 2);
            var pctText = Math.round(eased * 100) + '%';
            brainBar.style.width = pctText;
            brainPct.textContent = pctText;
            brainAnim = q < 1 ? requestAnimationFrame(step) : null;
        }
        brainAnim = requestAnimationFrame(step);
    }
    function resetBrain() {
        if (brainAnim) { cancelAnimationFrame(brainAnim); brainAnim = null; }
        brainPlayed = false;
        brainBar.style.width = '0%';
        brainPct.textContent = '0%';
    }

    /* 打字動畫：進入第 3 幕後用計時器快速打完（不逐字綁滾動，
       稍微一滑就會看到完整的 "uniqlo" 打字過程） */
    var typingTimer = null;
    var typingStarted = false;
    function startTyping() {
        typingStarted = true;
        var n = 0;
        typedEl.textContent = '';
        typingTimer = setInterval(function () {
            n++;
            typedEl.textContent = typedText.slice(0, n);
            if (n >= typedText.length) { clearInterval(typingTimer); typingTimer = null; }
        }, 75);
    }
    function resetTyping(fullText) {
        if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
        typingStarted = false;
        typedEl.textContent = fullText ? typedText : '';
    }

    function update() {
        var rect = scrolly.getBoundingClientRect();
        var span = scrolly.offsetHeight - window.innerHeight;
        var p = span > 0 ? clamp01(-rect.top / span) : 0;

        // 頂端進度條
        progressBar.style.transform = 'scaleX(' + p + ')';

        // 開場提示：一開始滑動就淡出；淺灰下滑提示接手，接近結尾消失
        hint.classList.toggle('gone', p > 0.015);
        scrollCue.classList.toggle('show', p > 0.015 && p < 0.93);

        // 目前在哪一幕
        var idx = 0;
        for (var i = 0; i < bounds.length; i++) {
            if (p >= bounds[i][0] && p < bounds[i][1]) { idx = i; break; }
            if (p >= bounds[bounds.length - 1][1] - 1e-9) idx = bounds.length - 1;
        }
        var subP = clamp01((p - bounds[idx][0]) / (bounds[idx][1] - bounds[idx][0]));
        if (p >= 1) { idx = scenes.length - 1; subP = 1; }

        scenes.forEach(function (scene, i) {
            scene.classList.toggle('active', i === idx);
        });

        // 第 1 幕走滾動驅動；第 2 幕起進場即連續播放、離場重置（回滑重播）
        if (idx === 0) applyScene(0, subP);
        for (var s = 1; s < scenes.length; s++) {
            if (s === idx) playScene(s); else resetScene(s);
        }

        // 右上角「開始使用」快速入口：全程常駐（站長要求「中間不要消失」），不再隨幕淡出

        // 第 1 幕：碎片收斂進度（subP 0.08→0.34 完成收斂，接著結果卡凝聚成形）
        var conv = idx === 0 ? clamp01((subP - 0.08) / 0.26) : 1;
        s1.style.setProperty('--conv', conv);

        // 第 1 幕：「省下的腦力」進度條——結果卡出現後自動跑完，不綁滑動距離
        if (brainBar) {
            if (idx === 0) {
                if (subP >= S1_CARD_AT && !brainPlayed) playBrain();
                if (subP < S1_CARD_AT && brainPlayed) resetBrain();
            } else if (!brainPlayed) {
                brainPlayed = true;
                brainBar.style.width = '100%';
                brainPct.textContent = '100%';
            }
        }

        // 第 3 幕打字：進場即觸發；離開幕時重置（回滑重播）
        if (typedEl) {
            if (idx === 2) {
                if (subP >= 0.06 && !typingStarted) startTyping();
                if (subP < 0.06 && typingStarted) resetTyping(false);
            } else if (typingStarted || typedEl.textContent !== (idx > 2 ? typedText : '')) {
                resetTyping(idx > 2);
            }
        }
    }

    var ticking = false;
    function onScroll() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
            ticking = false;
            update();
        });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();

    /* ---------- 混合捲動：第 1 幕跟手、第 2 幕起一次一幕 snap ----------
       接管 wheel / touch / 鍵盤。第 1 幕（碎片收斂→結果卡→品牌）是「自由區」：
       捲多少動多少，收斂隨手勢一點一點發生；頂到品牌畫面停住，再滑一次才進第 2 幕。
       第 2 幕起一個手勢只前進/後退一個停留點，snap 到定位後解鎖，再滑才到下一幕。
       離開一幕會 resetScene、回滑會重播，維持原引擎行為。
       （reduced-motion 已在最上方 return，不會進到這裡，維持原生捲動與無障礙。） */

    // 停留點：用 bounds 換算，weights 之後若調整仍正確。
    // 第 1 幕給兩個停留點——收斂後的搜尋結果卡、品牌畫面；其餘幕各一個。
    var stopDefs = [
        { s: 0, sub: 0.00 },   // 開場：碎片散開＋提示
        { s: 0, sub: 0.42 },   // 收斂 → 搜尋結果卡
        { s: 0, sub: 0.82 },   // 品牌畫面
        { s: 1, sub: 0.35 },
        { s: 2, sub: 0.35 },
        { s: 3, sub: 0.35 },
        { s: 4, sub: 0.35 },
        { s: 5, sub: 0.35 },
        { s: 6, sub: 0.55 }
    ];
    // stops = 每個停留點的「絕對捲動位置（px）」
    var hasFooterStop = false;
    function computeStops() {
        var span = scrolly.offsetHeight - window.innerHeight;
        var arr = stopDefs.map(function (d) {
            var prog = bounds[d.s][0] + d.sub * (bounds[d.s][1] - bounds[d.s][0]);
            return Math.round(prog * span);
        });
        arr[arr.length - 1] = span; // 最後一幕 CTA 對齊 scrolly 底（畫面置中、正常顯示）
        // scrolly 之後還有頁尾 SEO 說明（.lp-footer，不在任何一幕內）：多加一個
        // 「捲到文件最底」的停留點，讓最後再滑一次能看到它（否則會被鎖在 scrolly 底看不到）
        var docMax = Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight);
        hasFooterStop = docMax > span + 4;
        if (hasFooterStop) arr.push(docMax);
        return arr;
    }
    var stops = computeStops();

    function currentY() {
        return window.pageYOffset || document.documentElement.scrollTop || 0;
    }
    function nearestStop(y) {
        var best = 0, bestD = Infinity;
        for (var i = 0; i < stops.length; i++) {
            var d = Math.abs(stops[i] - y);
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }

    var STEP_DUR = 420;     // snap 捲動時間（毫秒）：短＋easeOut 起步快，翻頁跟手
    var QUIET_GAP = 100;    // 手勢停止多久才解鎖（吸收 trackpad / 觸控慣性尾巴）
    var WHEEL_MIN = 4;      // 太小的 wheel delta 視為雜訊，不觸發翻頁
    var TOUCH_MIN = 24;     // snap 區：滑動距離超過此值（px）才算一次翻頁
    var WHEEL_MULT = 1.6;   // 自由區滾輪捲動倍率
    var TOUCH_MULT = 1.8;   // 自由區觸控跟手倍率
    var FOOTER_DWELL = 650; // 抵達最後一幕後要先停穩這麼久，再滑才會進頁尾（防連滑衝過頭）
    var FREE_EDGE_COOLDOWN = 300; // 滾輪頂到自由區底後，這段時間內不換幕（擋 momentum 尾巴）
    var locked = false;
    var lastGestureTime = 0;
    var lastSettleTime = 0;
    var freeClampT = 0;
    var snapAnim = null;

    /* 自由區＝第 1 幕（碎片收斂 → 結果卡 → 品牌）：捲多少、動多少，收斂跟著
       手指/滾輪一點一點發生（不做 snap 動畫）；頂到 stops[2]（品牌畫面）就停住，
       手放開後「再滑一次」才 snap 進第 2 幕。第 2 幕起維持一手勢一幕。 */
    function freeMax() { return stops[2]; }

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }
    function animateTo(targetTop) {
        if (snapAnim) cancelAnimationFrame(snapAnim);
        var startTop = window.pageYOffset || document.documentElement.scrollTop || 0;
        var delta = targetTop - startTop;
        if (Math.abs(delta) < 1) { locked = false; return; }
        var startT = performance.now();
        locked = true;
        (function frame(now) {
            var q = Math.min(1, (now - startT) / STEP_DUR);
            window.scrollTo(0, Math.round(startTop + delta * easeOutCubic(q)));
            if (q < 1) {
                snapAnim = requestAnimationFrame(frame);
            } else {
                snapAnim = null;
                lastSettleTime = performance.now();
                scheduleUnlock();
            }
        })(startT);
    }
    function scheduleUnlock() {
        // 動畫跑完後，等手勢真正停下來（慣性尾巴）才解鎖，避免一次甩動翻多幕
        if (performance.now() - lastGestureTime < QUIET_GAP) {
            setTimeout(scheduleUnlock, QUIET_GAP);
        } else {
            locked = false;
        }
    }
    function goToStop(idx) {
        idx = idx < 0 ? 0 : (idx >= stops.length ? stops.length - 1 : idx);
        animateTo(stops[idx]);
    }
    function step(dir) {
        var target = nearestStop(currentY()) + dir;
        if (target < 0 || target > stops.length - 1) return; // 已到頭 / 尾就不動
        // 頁尾停留點要「刻意再滑一次」才進：抵達最後一幕 CTA 後須先停穩
        // FOOTER_DWELL，連續甩滑不會直接衝到最底、把 CTA 畫面跳過去
        if (hasFooterStop && target === stops.length - 1 &&
            performance.now() - lastSettleTime < FOOTER_DWELL) return;
        goToStop(target);
    }

    // 滑鼠滾輪 / trackpad：自由區內直接跟著滾（收斂由捲動位置驅動）；
    // 自由區外一個手勢一幕
    window.addEventListener('wheel', function (e) {
        e.preventDefault();
        var now = performance.now();
        lastGestureTime = now;
        if (locked) return;
        if (Math.abs(e.deltaY) < WHEEL_MIN) return;
        var y = currentY();
        if (y < freeMax() - 1) {
            // 自由區：捲多少動多少，頂到品牌畫面（freeMax）就停
            var ny = Math.min(freeMax(), Math.max(0, y + e.deltaY * WHEEL_MULT));
            window.scrollTo(0, ny);
            if (ny >= freeMax()) freeClampT = now; // 記下頂到底的時間，擋 momentum 尾巴直接換幕
            return;
        }
        if (e.deltaY < 0 && y <= freeMax() + 1) {
            // 站在自由區底往回滾 → 回到自由區（品牌 → 結果卡 → 碎片倒帶）
            window.scrollTo(0, Math.max(0, y + e.deltaY * WHEEL_MULT));
            return;
        }
        if (e.deltaY > 0 && y <= freeMax() + 1 &&
            now - freeClampT < FREE_EDGE_COOLDOWN) return; // 同一波慣性，不換幕
        step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    // 觸控：自由區內完全跟手（手指動多少畫面捲多少，收斂一點一點發生）；
    // 自由區外一超過門檻就在 touchmove 當下翻一幕（不等手指放開）。
    // 手勢起點決定模式：在自由區起手的整個手勢都跟手，就算頂到自由區底也只停住，
    // 不會同一手勢直接衝進第 2 幕（放手後再滑一次才換幕）。
    var touchY = null, touchLastY = null, touchFired = false, touchFree = false;
    window.addEventListener('touchstart', function (e) {
        touchY = touchLastY = e.touches.length ? e.touches[0].clientY : null;
        touchFired = false;
        touchFree = currentY() < freeMax() - 1;
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
        e.preventDefault();
        lastGestureTime = performance.now(); // 手指還在動就持續刷新，解鎖要等真的停下
        if (touchFired || locked || touchY === null || !e.touches.length) return;
        var cy = e.touches[0].clientY;
        if (touchFree) {
            var d = (touchLastY - cy) * TOUCH_MULT; // 手指往上移 → 畫面前進
            touchLastY = cy;
            window.scrollTo(0, Math.min(freeMax(), Math.max(0, currentY() + d)));
            return;
        }
        var dy = touchY - cy; // 手指往上移（往上滑）→ dy > 0 → 下一幕
        if (Math.abs(dy) < TOUCH_MIN) return;
        touchFired = true; // 本次滑動只翻一頁，之後的 move 忽略到放手為止
        step(dy > 0 ? 1 : -1);
    }, { passive: false });
    function endTouch() {
        lastGestureTime = performance.now();
        touchY = touchLastY = null;
        touchFired = false;
        touchFree = false;
    }
    window.addEventListener('touchend', endTouch, { passive: true });
    window.addEventListener('touchcancel', endTouch, { passive: true });

    // 鍵盤：方向鍵 / PgUp、PgDn / Space / Home、End
    window.addEventListener('keydown', function (e) {
        var k = e.key;
        var next = (k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Spacebar');
        var prev = (k === 'ArrowUp' || k === 'PageUp');
        if (next || prev) {
            e.preventDefault();
            if (!locked) step(next ? 1 : -1);
        } else if (k === 'Home') {
            e.preventDefault();
            if (!locked) goToStop(0);
        } else if (k === 'End') {
            e.preventDefault();
            if (!locked) goToStop(stops.length - 1);
        }
    });

    window.addEventListener('resize', function () { stops = computeStops(); }, { passive: true });

    /* 下滑提示點擊：前進一個停留點 */
    scrollCue.addEventListener('click', function () { step(1); });
})();
