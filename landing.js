/* ============================================================
   Pick My Card — Landing Page scrollytelling 引擎
   - 純 vanilla JS：scroll 進度 → 幕切換 + 幕內元素進場（可倒帶重播）
   - prefers-reduced-motion：關掉整個引擎，改為靜態依序排版
   ============================================================ */
(function () {
    'use strict';

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
        return;
    }

    /* ---------- Scrolly 引擎 ---------- */
    var scrolly = document.getElementById('lp-scrolly');
    var progressBar = document.getElementById('lp-progress-bar');
    var hint = document.getElementById('lp-hint');
    var scrollCue = document.getElementById('lp-scrollcue');
    var scenes = Array.prototype.slice.call(document.querySelectorAll('.lp-scene'));

    // 各幕在總進度中的相對長度（第 1、3、5 幕內容較多，多給一點滾動距離）
    var weights = [1.5, 1.0, 1.35, 1.0, 1.45, 1.0];
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var bounds = [];
    (function () {
        var acc = 0;
        for (var i = 0; i < weights.length; i++) {
            bounds.push([acc / total, (acc + weights[i]) / total]);
            acc += weights[i];
        }
    })();

    // 每幕的 [data-at] 元素快取
    var sceneFx = scenes.map(function (scene) {
        return Array.prototype.slice.call(scene.querySelectorAll('[data-at]')).map(function (el) {
            return { el: el, at: parseFloat(el.getAttribute('data-at')) || 0 };
        });
    });

    var s1 = scenes[0];

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    function applyScene(idx, subP) {
        sceneFx[idx].forEach(function (item) {
            item.el.classList.toggle('on', subP >= item.at);
        });
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
        applyScene(idx, subP);

        // 第 1 幕：碎片收斂進度（subP 0.10→0.42 之間完成收斂，接著結果卡片彈出）
        var conv = idx === 0 ? clamp01((subP - 0.10) / 0.32) : 1;
        s1.style.setProperty('--conv', conv);

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
})();
