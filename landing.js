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

    // 各幕在總進度中的相對長度（第 1 幕兩段式最長；第 3、5 幕內容多）
    var weights = [2.0, 1.0, 1.35, 1.0, 1.45, 1.0];
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

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    function applyScene(idx, subP) {
        sceneFx[idx].forEach(function (item) {
            item.el.classList.toggle('on', subP >= item.at);
            if (item.out !== null) item.el.classList.toggle('out', subP >= item.out);
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

        // 第 1 幕：碎片收斂進度（subP 0.08→0.34 完成收斂，接著結果卡彈出）
        var conv = idx === 0 ? clamp01((subP - 0.08) / 0.26) : 1;
        s1.style.setProperty('--conv', conv);

        // 第 1 幕：「省下的腦力」進度條（subP 0.36→0.56 從 0% 填到 100%）
        if (brainBar) {
            var brain = idx === 0 ? clamp01((subP - 0.36) / 0.20) : 1;
            var pctText = Math.round(brain * 100) + '%';
            brainBar.style.width = pctText;
            if (brainPct.textContent !== pctText) brainPct.textContent = pctText;
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
        // 跳到下一幕 93% 處：所有元素都已進場（含印章/勾勾/整行矩陣）
        var targetP = bounds[target][0] + 0.93 * (bounds[target][1] - bounds[target][0]);
        window.scrollTo({ top: Math.round(targetP * span), behavior: 'auto' });
    });
})();
