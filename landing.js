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

    /* ---------- 一次一幕的 snap 捲動 ----------
       接管 wheel / touch / 鍵盤：一個手勢只前進或後退「一個停留點」，平滑捲到定位
       後才解鎖，再滾一次才會到下一幕（原本一次滾動會翻過好幾幕）。捲動用動畫做，
       所以途中 update() 照跑，第 1 幕的收斂/結果卡/品牌等滾動敘事仍會順順播出；
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
    function computeStops() {
        var span = scrolly.offsetHeight - window.innerHeight;
        var arr = stopDefs.map(function (d) {
            var prog = bounds[d.s][0] + d.sub * (bounds[d.s][1] - bounds[d.s][0]);
            return Math.round(prog * span);
        });
        arr[arr.length - 1] = span; // 最後一幕 CTA 對齊 scrolly 底（畫面置中）
        // scrolly 之後還有頁尾 SEO 說明（.lp-footer，不在任何一幕內）：多加一個
        // 「捲到文件最底」的停留點，讓最後再滑一次能看到它（否則會被鎖在 scrolly 底看不到）
        var docMax = Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight);
        if (docMax > span + 4) arr.push(docMax);
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

    var STEP_DUR = 500;    // 每次 snap 捲動的時間（毫秒）——調短讓翻頁更即時
    var QUIET_GAP = 120;   // 手勢停止多久才解鎖（吸收 trackpad / 觸控慣性尾巴）
    var WHEEL_MIN = 4;     // 太小的 wheel delta 視為雜訊，不觸發翻頁
    var TOUCH_MIN = 24;    // 滑動距離超過此值（px）才算一次翻頁
    var locked = false;
    var lastGestureTime = 0;
    var snapAnim = null;

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
            window.scrollTo(0, Math.round(startTop + delta * easeInOutCubic(q)));
            if (q < 1) {
                snapAnim = requestAnimationFrame(frame);
            } else {
                snapAnim = null;
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
        goToStop(target);
    }

    // 滑鼠滾輪 / trackpad：完全接管，一個手勢一幕
    window.addEventListener('wheel', function (e) {
        e.preventDefault();
        lastGestureTime = performance.now();
        if (locked) return;
        if (Math.abs(e.deltaY) < WHEEL_MIN) return;
        step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    // 觸控：往上滑 → 下一幕、往下滑 → 上一幕。
    // 一超過門檻就在 touchmove 當下觸發（不等手指放開），手機才不會「滑了半天畫面沒動、
    // 以為沒滑到」；同時擋掉原生捲動改由 snap 接手。
    var touchY = null, touchFired = false;
    window.addEventListener('touchstart', function (e) {
        touchY = e.touches.length ? e.touches[0].clientY : null;
        touchFired = false;
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
        e.preventDefault();
        if (touchFired || locked || touchY === null || !e.touches.length) return;
        var dy = touchY - e.touches[0].clientY; // 手指往上移（往上滑）→ dy > 0 → 下一幕
        if (Math.abs(dy) < TOUCH_MIN) return;
        touchFired = true; // 本次滑動只翻一頁，之後的 move 忽略到放手為止
        lastGestureTime = performance.now();
        step(dy > 0 ? 1 : -1);
    }, { passive: false });
    window.addEventListener('touchend', function () {
        lastGestureTime = performance.now();
        touchY = null;
        touchFired = false;
    }, { passive: true });

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
