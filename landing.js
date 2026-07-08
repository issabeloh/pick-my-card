/* ============================================================
   Pick My Card — Landing Page scrollytelling 引擎
   - 純 vanilla JS：scroll 進度 → 幕切換 + 幕內元素進場（可倒帶重播）
   - prefers-reduced-motion：關掉整個引擎，改為靜態依序排版
   ============================================================ */
(function () {
    'use strict';

    // 記錄「看過 landing」：之後打 pickmycard.app 會直接進工具，不再導回來
    try { localStorage.setItem('pmc_seen_landing', '1'); } catch (e) { /* 無痕模式忽略 */ }

    // 使用者可在靜態版點「播放動態版本」覆寫系統的減少動態設定
    var forceMotion = false;
    try { forceMotion = localStorage.getItem('pmc_force_motion') === '1'; } catch (e) { /* ignore */ }
    if (forceMotion) document.documentElement.classList.add('lp-force-motion');

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches && !forceMotion;

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
        // 靜態版頂部提供「播放動態版本」：給系統關了動畫但其實想看的人
        var motionBtn = document.createElement('button');
        motionBtn.type = 'button';
        motionBtn.className = 'lp-motion-btn';
        motionBtn.textContent = '▶ 播放動態版本';
        motionBtn.addEventListener('click', function () {
            try { localStorage.setItem('pmc_force_motion', '1'); } catch (e) { /* ignore */ }
            location.reload();
        });
        document.body.insertBefore(motionBtn, document.body.firstChild);
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
    var weights = [2.0, 0.8, 1.0, 0.8, 1.0, 0.8];
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

        // 右上角「開始使用」快速入口：只在第 1 幕顯示，進入第 2 幕淡出
        if (skipBtn) skipBtn.classList.toggle('gone', idx > 0);

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

    /* ---------- 下滑提示點擊：直接跳到下一幕的完整狀態 ---------- */
    scrollCue.addEventListener('click', function () {
        var span = scrolly.offsetHeight - window.innerHeight;
        if (span <= 0) return;
        var p = clamp01(-scrolly.getBoundingClientRect().top / span);
        var idx = 0;
        for (var i = 0; i < bounds.length; i++) {
            if (p >= bounds[i][0] && p < bounds[i][1]) { idx = i; break; }
            if (p >= bounds[bounds.length - 1][1] - 1e-9) idx = bounds.length - 1;
        }
        var target = Math.min(idx + 1, bounds.length - 1);
        // 跳到下一幕開頭偏後一點：進場動畫會自動連續播完
        var targetP = bounds[target][0] + 0.30 * (bounds[target][1] - bounds[target][0]);
        window.scrollTo({ top: Math.round(targetP * span), behavior: 'auto' });
    });
})();
