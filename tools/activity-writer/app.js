/* 活動快寫工具：介面（解析規則都在 parser.js）
 * 流程只有一個畫面：選卡（自動）→ 貼原文 → 審核區打勾 → 寫進試算表（或複製一列）。
 * 審核（2026-11-14）：黃色（信心不夠）的格子＋條件欄集中在「需要你審核」，勾了才寫入、沒勾留空；率與通路沒勾不給寫。
 * 多個活動（2026-11-14）：原文有【活動1】【活動2】這種編號標題 → 可一鍵拆成分頁（一頁一個活動、各自寫入）；沒有就只提示。
 * 同一份程式跑在兩個地方（HOST 判斷）：
 *   試算表視窗（apps-script/ActivityWriter.html，由 build-apps-script.js 生成）——資料讀表上現況、可直接寫入、AI 走伺服器端
 *   本機網頁（index.html，開發與測試用）——資料讀 cards.data、只能複製
 * 畫面上的動態文字一律用 textContent／DOM API 建立，不組 HTML 字串。
 */
(function () {
  'use strict';
  var P = window.PMCWriter;
  var DEFAULT_MODELS = 'gemini-3.8-flash,gemini-3.6-flash,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite';
  var $ = function (id) { return document.getElementById(id); };

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('pmcw.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('pmcw.' + k, v); } catch (e) { /* 無痕模式等情況：設定不保存而已 */ } }
  };

  // 在試算表的視窗裡（HtmlService）才有 google.script.run
  var HOST = !!(window.google && window.google.script && window.google.script.run);
  // 呼叫 apps-script/activity-writer.gs 的函式；伺服器一律回 JSON 字串
  function server(fn, arg) {
    return new Promise(function (resolve, reject) {
      var run = window.google.script.run
        .withSuccessHandler(function (s) { try { resolve(typeof s === 'string' ? JSON.parse(s) : s); } catch (e) { reject(e); } })
        .withFailureHandler(function (e) { reject(new Error((e && e.message) || String(e))); });
      if (arg === undefined) run[fn](); else run[fn](arg);
    });
  }

  var state = {
    index: null, kind: 'rate', kindManual: false, cardId: '', cardManual: false,
    openNotes: {}, rows: [], active: 0,          // rows[i] = { result, fields, dirty:{}, review:{}, approved:{}, kind, headline }
    multi: null,                                 // P.splitActivities() 的結果（原文裡有幾個活動）
    split: null,                                 // 拆成分頁後 = { whole: 拆之前的整段原文 }；每一頁的原文在 rows[i].text
    aiBusy: false
  };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.classList.remove('show'); }, 4200);
  }

  // ---------- 資料載入 ----------
  function decodeData(b64) {
    var bin = atob(b64.trim()), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  }

  function boot(data) {
    state.index = P.buildIndex(data);
    $('dataMeta').textContent = (HOST ? '讀自試算表現況：' : '卡片資料：') + state.index.cards.length + ' 張卡' +
      (HOST ? '' : '｜匯出於 ' + (data.lastUpdated || '（未知）')) + '｜通路詞庫 ' + state.index.vocabKeys.length + ' 個寫法' +
      (data.host && data.host.vocabNote ? '｜⚠ ' + data.host.vocabNote : '');
    var sel = $('cardSel');
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: '— 選卡片（貼上原文會自動認）—' }));
    var groups = {};
    state.index.cards.forEach(function (c) { (groups[c.bank || '其他'] = groups[c.bank || '其他'] || []).push(c); });
    Object.keys(groups).forEach(function (bank) {
      var og = el('optgroup', { label: bank });
      groups[bank].forEach(function (c) { og.appendChild(el('option', { value: c.id, text: c.name + '（' + c.id + '）' })); });
      sel.appendChild(og);
    });
    $('loadFail').hidden = true; $('app').hidden = false; $('bar').hidden = false;
    renderAll();
  }

  function loadData() {
    if (HOST) {
      return server('activityWriterInit').then(boot).catch(function (e) {
        console.error('讀試算表失敗', e);
        $('dataMeta').textContent = '讀不到試算表：' + e.message;
      });
    }
    fetch('../../cards.data?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) { boot(decodeData(t)); })
      .catch(function (e) {
        console.error('載入 cards.data 失敗', e);
        $('dataMeta').textContent = '讀不到 cards.data';
        $('loadFail').hidden = false;
      });
  }

  // ---------- 解析 ----------
  // 「需要你審核」：信心不夠（黃色）的格子，加上固定要看的條件欄。勾了才會寫入，沒勾的那格留空。
  var ALWAYS_REVIEW = { conditions: 1, promo_condition: 1, couponConditions: 1 };
  // 率與通路是活動的骨幹：在審核區卻沒勾就不給寫（留空會寫出一個搜不到、或沒有回饋率的活動）。
  // 新戶活動的類型與摘要是必填，同樣處理
  var MUST_CONFIRM = ['rate', 'items', 'couponRate', 'couponMerchant', 'bonus_rate', 'bonus_merchants', 'promo_types', 'new_customer_summary'];

  function makeRow(result, keepFrom, kind) {
    var row = { result: result, fields: {}, dirty: {}, review: {}, approved: {}, kind: kind || state.kind,
      headline: result.structure ? result.structure.headline : null,
      structChoice: result.structure ? result.structure.choice : -1, options: result.structure ? result.structure.options : [] };
    Object.keys(result.fields).forEach(function (k) { row.fields[k] = result.fields[k]; });
    KINDS[row.kind].fields.forEach(function (def) {
      var n = result.notes[def[0]];
      if (ALWAYS_REVIEW[def[0]] || (n && n.level === 'check')) row.review[def[0]] = true;
    });
    if (keepFrom) Object.keys(keepFrom.dirty).forEach(function (k) {   // 手動改過的格子不被重新解析蓋掉
      if (k in row.fields) { row.fields[k] = keepFrom.fields[k]; row.dirty[k] = true; if (row.review[k]) row.approved[k] = !!keepFrom.approved[k]; }
    });
    return row;
  }

  function hasValue(row, name) { return String(row.fields[name] == null ? '' : row.fields[name]).trim() !== ''; }
  // 還沒勾的審核格（有內容的才算；空的本來就不會寫東西）
  function unapproved(row) { return Object.keys(row.review).filter(function (k) { return !row.approved[k] && hasValue(row, k); }); }
  function blockers(row) { var u = unapproved(row); return MUST_CONFIRM.filter(function (k) { return u.indexOf(k) >= 0; }); }
  // 實際會寫出去（或複製）的值：沒勾的審核格留空
  function outFields(row) {
    var f = {}; Object.keys(row.fields).forEach(function (k) { f[k] = row.fields[k]; });
    unapproved(row).forEach(function (k) { f[k] = ''; });
    return f;
  }

  function parseText(kind, text) { return KINDS[kind].parse(state.index, state.cardId, text, { url: $('sourceUrl').value }); }

  function reparse() {
    if (!state.index) return;
    var text = $('source').value;
    if (state.split) {   // 分頁模式：左邊的原文是目前這一頁的，只重新解析這一頁
      var old = cur(); if (!old || old.written) return;
      old.text = text;
      var fresh = makeRow(parseText(old.kind, text), old, old.kind);
      fresh.text = text; fresh.title = old.title; fresh.fullTitle = old.fullTitle;
      state.rows[state.active] = fresh;
      renderAll(); return;
    }
    state.multi = null;
    if (!text.trim()) { state.rows = []; state.active = 0; renderAll(); return; }
    if (!state.kindManual) state.kind = P.detectKind(P.normalizeText(text));
    if (!state.cardManual) { var id = P.detectCard(state.index, text); if (id) state.cardId = id; }
    state.multi = P.splitActivities(text);
    state.rows = [makeRow(parseText(state.kind, text), state.rows[0])];
    state.active = 0;
    renderAll();
  }

  // 有【活動1】【活動2】這種編號標題時：一個活動一頁，各自確認、各自寫入
  function doSplit() {
    var m = state.multi; if (!m || !m.explicit) return;
    state.split = { whole: $('source').value };
    state.rows = m.parts.map(function (p) {
      var kind = state.kindManual ? state.kind : P.detectKind(P.normalizeText(p.own));
      var row = makeRow(parseText(kind, p.text), null, kind);
      row.text = p.text; row.title = p.title.split('：')[0]; row.fullTitle = p.title;
      return row;
    });
    state.multi = null;
    activate(0);
  }

  function unsplit() {
    if (!state.split) return;
    $('source').value = state.split.whole; state.split = null; state.rows = [];
    reparse();
  }

  function activate(i) {
    state.active = i;
    var row = cur();
    if (row && state.split) { state.kind = row.kind; $('source').value = row.text; }
    renderAll();
  }

  var reparseSoon = (function () { var t; return function () { clearTimeout(t); t = setTimeout(reparse, 220); }; })();

  function cur() { return state.rows[state.active]; }

  function setField(name, value, fromUser) {
    var row = cur(); if (!row) return;
    row.fields[name] = value;
    if (fromUser) { row.dirty[name] = true; if (row.review[name]) row.approved[name] = hasValue(row, name); }   // 親手改過＝看過了
    if (name === 'rate' && !row.dirty.cap) recomputeCap(row);
  }

  function recomputeCap(row) {
    var info = row.result.capInfo;
    if (!info || info.spend != null || info.reward == null) return;
    row.fields.cap = P.capFromReward(info.reward, Number(row.fields.rate));
  }

  function chooseStructure(i) {
    var row = cur(), o = row.options[i]; if (!o) return;
    row.structChoice = i;
    row.fields.rate = String(o.rate); row.fields.cashbackModel = o.model;
    row.dirty.rate = true; row.dirty.cashbackModel = true;
    if (row.review.rate) row.approved.rate = true;
    if (row.review.cashbackModel) row.approved.cashbackModel = true;
    row.result.notes.rate = { level: 'ok', text: '你選的結構：合計 ' + o.total + '%（' + o.label + '）' };
    row.result.notes.cashbackModel = { level: 'ok', text: '顯示合計 ' + o.total + '%' };
    if (!row.dirty.cap) recomputeCap(row);
    renderResult(); renderBar();
  }

  // ---------- 畫面：左側 ----------
  function renderLeft() {
    Array.prototype.forEach.call($('kindSeg').children, function (b) { b.classList.toggle('on', b.getAttribute('data-kind') === state.kind); });
    $('kindAuto').hidden = state.kindManual || !$('source').value.trim();
    $('cardSel').value = state.cardId;
    $('cardAuto').hidden = state.cardManual || !state.cardId;
    $('urlRow').hidden = state.kind !== 'promo';
    renderCtx();
  }

  function renderCtx() {
    var box = $('ctx'); box.textContent = '';
    var card = state.index && P.getCard(state.index, state.cardId);
    if (!card) { box.appendChild(el('span', { class: 'hint', text: '選了卡片之後，這裡會列出它的基本回饋與既有活動，方便對照。' })); return; }
    var row = cur();
    box.appendChild(el('h2', { text: card.name }));
    var base = '基本 ' + card.basicCashback + '%' + (card.overseasCashback ? '｜海外基本 ' + card.overseasCashback + '%' : '') +
      (card.domesticBonusRate ? '｜國內加碼 ' + card.domesticBonusRate + '%' : '') + (card.overseasBonusRate ? '｜海外加碼 ' + card.overseasBonusRate + '%' : '') +
      (card.hasLevels ? '｜分級卡' : '');
    box.appendChild(el('div', { text: base }));
    if (state.kind === 'coupon') {
      if (row && row.result.existing) {
        var cx = row.result.existing;
        box.appendChild(el('div', { class: 'hit', style: 'margin-top:8px',
          text: '這個通路已經有一張券（' + (cx.slot ? 'couponMerchant_' + cx.slot : '第 ' + cx.index + ' 張') + '，現在 ' + cx.rate + '%' + (cx.period ? '、' + cx.period : '') + '）→ 多半是更新它' }));
      }
      var cul = el('ul');
      (card.couponCashbacks || []).forEach(function (c, i) {
        cul.appendChild(el('li', { text: (c.slot ? 'coupon_' + c.slot : '第 ' + (i + 1) + ' 張') + '｜' + c.rate + '%｜' + c.merchant + (c.period ? '｜' + c.period : '') }));
      });
      box.appendChild(el('h2', { text: '這張卡現有的領券活動（' + (card.couponCashbacks || []).length + ' 張）', style: 'margin-top:10px' })); box.appendChild(cul);
    } else if (state.kind === 'rate') {
      if (row && row.result.existing) {
        var ex = row.result.existing;
        box.appendChild(el('div', { class: 'hit', style: 'margin-top:8px',
          text: '可能是更新既有的 rate_' + ex.slot + '（通路重疊 ' + ex.hit + '/' + ex.total + '，現在 ' + ex.rate + '%' +
            (ex.model ? '、' + ex.model : '') + (ex.period ? '、' + ex.period : '') + '）→ 貼到那一槽覆蓋' }));
      } else if (row) box.appendChild(el('div', { class: 'hint', style: 'margin-top:8px', text: '跟既有槽位的通路沒有重疊 → 新活動，貼到這張卡第一個空的 rate_N（避開 14／21／22）' }));
      var ul = el('ul');
      (card.cashbackRates || []).forEach(function (r) {
        ul.appendChild(el('li', { text: 'rate_' + r.slot + '｜' + r.rate + '%｜' + (r.cashbackModel || '（留空）') + '｜' +
          (r.category ? r.category + '｜' : '') + (r.items || []).slice(0, 4).join('、') + ((r.items || []).length > 4 ? '…' : '') }));
      });
      box.appendChild(el('h2', { text: '既有活動', style: 'margin-top:10px' })); box.appendChild(ul);
    } else {
      var prev = (state.index.data.newCardholderPromos || []).filter(function (p) { return p.id === card.id; });
      box.appendChild(el('h2', { text: '這張卡現有的新戶活動（' + prev.length + ' 檔）', style: 'margin-top:10px' }));
      var ul2 = el('ul');
      prev.forEach(function (p) { ul2.appendChild(el('li', { text: (p.period_start || '?') + '~' + (p.period_end || '?') + '｜' + (p.promo_types || []).join('+') + '｜' + (p.new_customer_summary || '') })); });
      box.appendChild(ul2);
    }
  }

  // ---------- 畫面：欄位 ----------
  // [欄名, 提示, 型別, 佔幾格（12 格一列）]——順序＝試算表欄位順序，改順序要連 parser.js 的 RATE_COLS／PROMO_COLS 一起看
  var RATE_FIELDS = [
    ['rate', '這一槽自己的率', 'text', 2], ['cashbackModel', '怎麼跟基本回饋疊', 'model', 4], ['cap', '消費上限', 'text', 2],
    ['minSpend', '單筆門檻', 'text', 2], ['maxSpend', '級距上界', 'text', 2],
    ['items', '通路，半形逗號分隔', 'area', 8], ['category', '分類標題', 'text', 4],
    ['conditions', '全形分號分隔', 'area', 5], ['registerLink', '官方登錄頁', 'text', 3],
    ['periodStart', 'YYYY/M/D', 'text', 2], ['periodEnd', 'YYYY/M/D', 'text', 2]
  ];
  var PROMO_FIELDS = [
    ['id', '', 'text', 2], ['promo_types', '可複選', 'types', 4], ['new_customer_definition', '', 'area', 6],
    ['new_customer_summary', '誰＋門檻＋獎勵', 'area', 6], ['promo_condition', '兩項以上用①②③', 'area', 6],
    ['period_start', 'YYYY/M/D', 'text', 2], ['period_end', 'YYYY/M/D', 'text', 2], ['min_spend', '', 'text', 2],
    ['gift_content', '首刷禮品名', 'area', 4], ['gift_image_url', '自己補', 'text', 2],
    ['luggage_inch', '', 'text', 2], ['luggage_value', '', 'text', 2], ['bonus_rate', '小數，只填加碼', 'text', 2],
    ['bonus_merchants', '半形逗號；不限通路填 *general', 'area', 4], ['bonus_cap', '消費上限', 'text', 2],
    ['voucher_amount', '', 'text', 2], ['voucher_usage', '', 'text', 4], ['notes', '全形分號分隔', 'area', 6],
    ['link', '活動頁', 'text', 5], ['active', '', 'text', 2], ['apply_cta_text', '', 'text', 5],
    ['apply_cta_link', '沿用同卡', 'text', 4], ['apply_cta_expiry', '連結到期日', 'text', 2], ['pick_rank', '1–5 或 x', 'text', 2],
    ['pick_question', '一句鉤子', 'text', 4], ['pick_reason', '一句理由', 'area', 12]
  ];
  var COUPON_FIELDS = [
    ['couponMerchant', '通路，半形逗號分隔', 'area', 8], ['couponRate', '領券加碼的率', 'text', 2], ['couponCap', '消費上限', 'text', 2],
    ['couponConditions', '全形分號分隔；最後寫去哪領券', 'area', 8], ['couponPeriodStart', 'YYYY/M/D', 'text', 2], ['couponPeriodEnd', 'YYYY/M/D', 'text', 2]
  ];
  // 三種活動各自的欄位、輸出欄、解析函式、貼上位置、試算表版寫入的那組槽位
  var KINDS = {
    rate: { fields: RATE_FIELDS, cols: P.RATE_COLS, parse: P.parseActivity, slotKey: 'slots', prefix: 'rate_',
      row: function (f) { return P.buildRateRow(f, store.get('derived', 'formula'), null, $('anchorCell').value); } },
    coupon: { fields: COUPON_FIELDS, cols: P.COUPON_COLS, parse: P.parseCoupon, slotKey: 'couponSlots', prefix: 'couponMerchant_',
      row: function (f) { return P.buildCouponRow(f); } },
    promo: { fields: PROMO_FIELDS, cols: P.PROMO_COLS, parse: P.parsePromo, row: function (f) { return P.buildPromoRow(f); } }
  };
  function K() { return KINDS[state.kind] || KINDS.rate; }
  var MODELS = ['', 'rate', 'rate+basic', 'basic+domesticBonusRate', 'rate+basic+domesticBonusRate', 'rate+overseasCashback',
    'overseasCashback+overseasBonusRate', 'rate+overseasCashback+overseasBonusRate', 'basic', 'overseasCashback'];

  function splitList(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

  function toggleInList(field, name, sep) {
    var row = cur();
    var parts = sep === '；' ? String(row.fields[field] || '').split('；').filter(Boolean) : splitList(row.fields[field]);
    var k = P.termKey(name), at = -1;
    parts.forEach(function (p, i) { if (P.termKey(p) === k) at = i; });
    if (at >= 0) parts.splice(at, 1); else parts.push(name);
    setField(field, parts.join(sep === '；' ? '；' : ','), true);
    renderResult(); renderBar();
  }

  function chipList(items, isOn, onClick, cls) {
    var box = el('div', { class: 'chips' });
    items.forEach(function (it) {
      var name = typeof it === 'string' ? it : (it.name || it.text);
      box.appendChild(el('span', { class: 'chip' + (isOn(name) ? ' on' : '') + (cls ? ' ' + cls(it) : ''), text: name, title: it.why || '',
        onclick: function () { onClick(name); } }));
    });
    return box;
  }

  function inputFor(def, row) {
    var name = def[0], type = def[2], val = row.fields[name] == null ? '' : row.fields[name];
    var onInput = function (e) { setField(name, e.target.value, true); syncCheck(name); renderBar(); if (name === 'rate') syncDependents(); };
    if (type === 'area') {
      // 列數照內容估：一格大約塞 4.6 個全形字（12 格 ≈ 55 字）
      var perLine = Math.max(8, Math.floor((def[3] || 12) * 4.6));
      var lines = String(val).split('\n').reduce(function (n, l) { return n + Math.max(1, Math.ceil(l.length / perLine)); }, 0);
      var ta = el('textarea', { id: 'f_' + name, rows: String(Math.min(6, Math.max(1, lines))), oninput: onInput });
      ta.value = val; return ta;
    }
    if (type === 'model') {
      var sel = el('select', { id: 'f_' + name, onchange: function (e) { setField(name, e.target.value, true); syncCheck(name); renderBar(); } });
      var opts = MODELS.slice();
      row.options.forEach(function (o) { if (opts.indexOf(o.model) < 0) opts.push(o.model); });
      if (opts.indexOf(val) < 0) opts.push(val);
      opts.forEach(function (m) { sel.appendChild(el('option', { value: m, text: m || '（留空）' })); });
      sel.value = val; return sel;
    }
    var inp = el('input', { type: 'text', id: 'f_' + name, oninput: onInput });
    inp.value = val; return inp;
  }

  // 打字時不重畫整塊（會跳游標），只把那一格的勾選框對齊
  function syncCheck(name) {
    var row = cur(), box = $('ok_' + name); if (!box || !row) return;
    box.disabled = !hasValue(row, name); box.checked = !!row.approved[name];
    box.closest('.field').classList.toggle('rv-on', box.checked);
  }

  function syncDependents() {
    var row = cur(), capEl = $('f_cap');
    if (capEl && !row.dirty.cap) capEl.value = row.fields.cap || '';
  }

  // 「官網標榜 X% 怎麼組成」的選項：整列寬、選項橫排（原本一個選項佔一行）
  function structBlock(row) {
    if (!row.options.length) return null;
    var hl = el('div', { class: 'headline' }, ['官網標榜', el('input', { type: 'text', id: 'headline', value: row.headline == null ? '' : String(row.headline),
      onchange: function (e) {
        var v = parseFloat(e.target.value); if (isNaN(v)) return;
        var card = P.getCard(state.index, state.cardId) || {};
        row.headline = v; row.options = P.structureOptions(card, v, false); row.structChoice = -1;
        renderResult();
      } }), '% ——這個數字怎麼組成？選一個：']);
    var box = el('div', { class: 'struct' });
    // 跨槽疊加（rate+rate_N）少用，收進折疊區；被選中時才展開
    var crossBox = el('div', { class: 'struct' }), crossOn = false;
    row.options.forEach(function (o, i) {
      var on = row.fields.cashbackModel === o.model && Number(row.fields.rate) === o.rate;
      var cross = /rate_\d/.test(o.model);
      if (cross && on) crossOn = true;
      (cross ? crossBox : box).appendChild(el('label', { class: on ? 'on' : '' }, [
        el('input', { type: 'radio', name: 'struct', checked: on, onchange: function () { chooseStructure(i); } }),
        el('code', { text: 'rate=' + o.rate + '｜' + (o.model || '留空') }), el('span', { class: 'lab', text: o.label })
      ]));
    });
    var more = crossBox.children.length ? el('details', { class: 'more', open: crossOn }, [el('summary', { text: '疊在這張卡其他槽位之上（跨槽疊加，' + crossBox.children.length + ' 個）' }), crossBox]) : null;
    return el('div', { class: 'structwrap' }, [hl, box, more]);
  }

  function fieldBlock(def, row) {
    var name = def[0], note = row.result.notes[name];
    if (note && row.dirty[name] && note.level !== 'ok' && String(row.fields[name] || '').trim()) note = { level: 'ok', text: '已手動修改' };
    var body = el('div', {}, [inputFor(def, row)]);
    var chips = row.result.chips || {};

    if ((name === 'items' || name === 'bonus_merchants' || name === 'couponMerchant') && chips.items && chips.items.length) {
      var inList = splitList(row.fields[name]).map(P.termKey);
      body.appendChild(chipList(chips.items, function (n) { return inList.indexOf(P.termKey(n)) >= 0; },
        function (n) { toggleInList(name, n, ','); },
        function (it) { return (it.known ? '' : 'new') + (it.excluded ? ' ex' : ''); }));
    }
    if ((name === 'conditions' || name === 'couponConditions') && chips.conditions && chips.conditions.length) {
      var have = String(row.fields[name] || '').split('；');
      body.appendChild(chipList(chips.conditions, function (n) { return have.indexOf(n) >= 0; }, function (n) { toggleInList(name, n, '；'); }));
    }
    if (name === 'category' && chips.category && chips.category.length) {
      body.appendChild(chipList(chips.category.slice(0, 14), function (n) { return row.fields.category === n; },
        function (n) { setField('category', n, true); renderResult(); renderBar(); }));
    }
    if ((name === 'registerLink' || name === 'link') && chips.urls && chips.urls.length) {
      body.appendChild(chipList(chips.urls, function (n) { return row.fields[name] === n; }, function (n) { setField(name, n, true); renderResult(); renderBar(); }));
    }
    if (name === 'promo_types') {
      var types = splitList(row.fields.promo_types);
      body.appendChild(chipList(P.PROMO_TYPES, function (n) { return types.indexOf(n) >= 0; }, function (n) { toggleInList('promo_types', n, ','); }));
    }
    if (name === 'voucher_usage' && chips.usages) {
      body.appendChild(chipList(chips.usages, function (n) { return row.fields.voucher_usage === n; }, function (n) { setField('voucher_usage', n, true); renderResult(); renderBar(); }));
    }
    if (note && note.text) {
      var full = (note.level === 'ok' ? '✓ ' : note.level === 'check' ? '請確認：' : '要填：') + note.text;
      body.appendChild(el('div', { class: 'note ' + note.level + (state.openNotes[name] ? ' open' : ''), text: full, title: full + '\n（點一下展開／收合）',
        onclick: function (e) { state.openNotes[name] = !state.openNotes[name]; e.currentTarget.classList.toggle('open'); } }));
    }
    var box = null;
    if (row.review[name]) {
      box = el('input', { type: 'checkbox', class: 'okbox', id: 'ok_' + name, checked: !!row.approved[name], disabled: !hasValue(row, name),
        title: '勾了才會寫入這一格；沒勾就留空', onchange: function (e) {
          row.approved[name] = e.target.checked;
          e.target.closest('.field').classList.toggle('rv-on', e.target.checked);
          renderBar();
        } });
    }
    return el('div', { class: 'field s' + (def[3] || 12) + (note ? ' lv-' + note.level : '') + (row.review[name] ? ' rv' + (row.approved[name] ? ' rv-on' : '') : '') }, [
      el('label', { for: 'f_' + name }, [box, name, def[1] ? el('small', { text: def[1] }) : null]), body
    ]);
  }

  function renderResult() {
    var box = $('result'), row = cur();
    var focusId = document.activeElement && document.activeElement.id, pos = document.activeElement && document.activeElement.selectionStart;
    box.textContent = '';
    if (!row) {
      box.appendChild(el('p', { class: 'hint', text: '貼上原文後，這裡會照試算表的欄位順序列出每一格。綠色＝有原文依據，黃色＝請看一眼原文確認，紅色＝要自己填。' }));
      return;
    }
    if (state.rows.length > 1 || row.result.viaAi || state.split) {
      var tabs = el('div', { class: 'tabs' });
      state.rows.forEach(function (r, i) {
        var rateText = r.fields.rate || r.fields.couponRate;
        tabs.appendChild(el('button', { type: 'button', class: i === state.active ? 'on' : '', title: r.fullTitle || '',
          text: (r.title || '第 ' + (i + 1) + ' 列') + (rateText ? '（' + rateText + '%）' : '') + (r.written ? ' ✓' : ''), onclick: function () { activate(i); } }));
      });
      if (row.result.viaAi) tabs.appendChild(el('span', { class: 'auto', text: 'AI 解析' }));
      if (state.split) {
        tabs.appendChild(el('span', { class: 'hint', text: '一頁一個活動，各自確認、各自寫入；左邊是這一頁的原文' }));
        tabs.appendChild(el('button', { type: 'button', id: 'unsplitBtn', text: '回到整段', title: '放棄分頁，回到拆之前的整段原文', onclick: unsplit }));
      }
      box.appendChild(tabs);
    }
    if (!state.split && state.multi && state.multi.hint) {
      box.appendChild(el('div', { class: 'note check banner multi', id: 'multiHint', style: 'margin-bottom:6px' }, [
        el('span', { text: state.multi.explicit ? state.multi.hint + '。現在整段當成一個活動解析——建議拆開，一個活動一頁、各自寫入　' : '⚠ ' + state.multi.hint }),
        state.multi.explicit ? el('button', { type: 'button', class: 'primary', id: 'splitBtn', text: '拆成 ' + state.multi.parts.length + ' 個分頁', onclick: doSplit }) : null
      ]));
    }
    if (row.result.skipped) box.appendChild(el('div', { class: 'note check banner', style: 'margin-bottom:6px', text: row.result.skipped }));
    if (row.result.evidence) box.appendChild(el('p', { class: 'evidence', text: 'AI 引用的原文：' + row.result.evidence }));
    // 審核區在上：信心不夠的格子集中在這裡，一格一個勾選框
    var rv = K().fields.filter(function (def) { return row.review[def[0]]; });
    var structAfter = row.review.rate ? 'rate' : 'maxSpend';
    var fill = function (grid, defs) {
      defs.forEach(function (def) {
        grid.appendChild(fieldBlock(def, row));
        if (def[0] === structAfter) { var sb = structBlock(row); if (sb) grid.appendChild(sb); }
      });
      return grid;
    };
    if (rv.length) {
      box.appendChild(el('div', { class: 'review', id: 'review' }, [
        el('div', { class: 'rvhead' }, [
          el('b', { text: '需要你審核（' + rv.length + ' 格）' }),
          el('span', { class: 'hint', text: '看過、沒問題就打勾。寫入時只寫綠色的格子＋這裡有勾的；沒勾的那格留空' }),
          el('button', { type: 'button', id: 'okAllBtn', text: '全部勾選', onclick: function () {
            rv.forEach(function (def) { if (hasValue(row, def[0])) row.approved[def[0]] = true; });
            renderResult(); renderBar();
          } })
        ]),
        fill(el('div', { class: 'grid', id: 'reviewFields' }), rv)
      ]));
    }
    box.appendChild(fill(el('div', { class: 'grid', id: 'fields' }), K().fields.filter(function (def) { return !row.review[def[0]]; })));
    if (state.kind === 'rate') box.appendChild(el('p', { class: 'hint', style: 'margin:6px 0 0', text: 'daysRemaining、period 兩欄由程式產生（設定裡可改成公式／純值／留空）。' }));
    if (focusId && $(focusId)) { $(focusId).focus(); try { $(focusId).setSelectionRange(pos, pos); } catch (e) { /* select 沒有游標 */ } }
  }

  // ---------- 畫面：底部輸出 ----------
  function rowCells(row) {
    return K().row(outFields(row));
  }

  function renderBar() {
    var row = cur(), issues = $('issues'), prev = $('preview');
    issues.textContent = ''; prev.textContent = '';
    $('copyBtn').disabled = !row;
    $('copyAllBtn').hidden = !(state.kind === 'promo' && state.rows.length > 1 && state.rows.every(function (r) { return r.kind === 'promo'; }));
    $('anchorCell').hidden = HOST || state.kind !== 'rate' || store.get('derived', 'formula') !== 'formula';
    renderWrite(row);
    if (!row) { issues.appendChild(el('span', { class: 'hint', text: '還沒有內容' })); return; }
    if (row.serverMsg) issues.appendChild(el('span', { class: row.serverMsg.ok ? 'good' : 'bad', text: (row.serverMsg.ok ? '✓ ' : '⛔ ') + row.serverMsg.text + '　' }));
    var list = problemsOf(row), must = blockers(row);
    var pending = unapproved(row).filter(function (k) { return must.indexOf(k) < 0; });
    if (must.length) issues.appendChild(el('span', { class: 'bad', id: 'mustMsg', text: '⛔ ' + must.join('、') + ' 在審核區還沒勾——這幾格（率、通路、必填）要勾了才能寫入　' }));
    if (list.length) issues.appendChild(el('span', { class: 'bad', text: '⚠ ' + list.join('；') }));
    else if (!must.length) issues.appendChild(el('span', { class: 'good', text: '格式檢查通過' }));
    if (pending.length) issues.appendChild(el('span', { class: 'hint', id: 'pendingMsg', text: '　沒勾、會留空：' + pending.join('、') }));
    var cols = K().cols;
    rowCells(row).forEach(function (c, i) {
      var text = c && c.formula ? c.formula : String(c);
      prev.appendChild(el('span', { class: 'cell' + (text ? '' : ' blank'), text: text.replace(/\n/g, '⏎'), title: cols[i] + '：' + text }));
    });
  }

  // 格式檢查看「實際會寫出去的值」；率與通路沒勾另外擋（不讓它變成一句「rate 是空的」）
  function problemsOf(row) {
    var f = outFields(row);
    blockers(row).forEach(function (k) { f[k] = row.fields[k]; });
    return P.validate(state.kind, f);
  }

  // ---------- 寫進試算表（只在試算表視窗裡） ----------
  function slotsOf() { var c = state.index && P.getCard(state.index, state.cardId); return (c && K().slotKey && c[K().slotKey]) || []; }

  function defaultSlot(row) {
    if (row.result.existing && row.result.existing.slot) return row.result.existing.slot;
    var reserved = state.kind === 'rate' ? ((state.index.data.host && state.index.data.host.reservedSlots) || []) : [];
    var free = slotsOf().filter(function (s) { return s.empty && reserved.indexOf(s.n) < 0; })[0];
    return free ? free.n : '';
  }

  function renderWrite(row) {
    var btn = $('writeBtn'), sel = $('slotSel');
    btn.hidden = !HOST; $('reloadBtn').hidden = !HOST;
    $('copyBtn').classList.toggle('primary', !HOST);
    sel.hidden = !HOST || !row || state.kind === 'promo';
    if (!HOST) return;
    btn.disabled = !row || state.busy || !!row.written;
    if (!row) { btn.textContent = '寫進試算表'; return; }
    if (row.written) { btn.textContent = '已寫入 ✓'; return; }
    if (state.kind === 'promo') { btn.textContent = state.busy ? '寫入中…' : '新增到新戶活動表'; return; }
    if (row.slot == null) row.slot = defaultSlot(row);
    var reserved = state.kind === 'rate' ? ((state.index.data.host && state.index.data.host.reservedSlots) || []) : [];
    var pre = K().prefix;
    sel.textContent = '';
    if (row.slot === '') sel.appendChild(el('option', { value: '', text: '沒有空槽——選一槽覆蓋' }));
    slotsOf().forEach(function (s) {
      sel.appendChild(el('option', { value: String(s.n), text: pre + s.n + (s.empty ? '（空' + (reserved.indexOf(s.n) >= 0 ? '・骨幹槽' : '') + '）' : '｜' + s.rate + '%｜' + s.items) }));
    });
    sel.value = String(row.slot);
    var slot = slotsOf().filter(function (s) { return String(s.n) === String(row.slot); })[0];
    btn.disabled = btn.disabled || !slot;
    btn.textContent = state.busy ? '寫入中…' : !slot ? '先選槽位' : slot.empty ? '寫進 ' + pre + slot.n
      : (row.armed === slot.n ? '再按一次：確定覆蓋 ' + pre + slot.n : '覆蓋 ' + pre + slot.n + '（有內容）');
  }

  function writeRow() {
    var row = cur(); if (!row || state.busy || row.written) return;
    if (!state.cardId) return toast('先選卡片');
    var must = blockers(row);
    if (must.length) return toast(must.join('、') + ' 在「需要你審核」區還沒勾——這幾格（率、通路、必填）要勾了才能寫入');
    var problems = problemsOf(row);
    if (problems.length) return toast('先處理下方的格式問題：' + problems[0]);
    var out = outFields(row);
    var call;
    if (state.kind !== 'promo') {
      var slot = slotsOf().filter(function (s) { return String(s.n) === String(row.slot); })[0];
      if (!slot) return toast('先選要寫進哪一槽');
      if (!slot.empty && row.armed !== slot.n) {   // 覆蓋要按兩次
        row.armed = slot.n; renderBar();
        return toast(K().prefix + slot.n + ' 現在是 ' + slot.rate + '%｜' + slot.items + '——再按一次就覆蓋');
      }
      call = server('activityWriterSaveRate', JSON.stringify({ id: state.cardId, group: state.kind, slot: slot.n, fields: out, overwrite: !slot.empty }));
    } else {
      call = server('activityWriterSavePromo', JSON.stringify({ id: state.cardId, values: out }));
    }
    state.busy = true; row.serverMsg = null; renderBar();
    call.then(function (res) {
      row.serverMsg = { ok: !!res.ok, text: res.message || (res.ok ? '已寫入' : '寫入失敗') };
      row.armed = null;
      if (res.ok) { row.written = true; toast(res.message || '已寫入'); return refreshIndex(); }
    }).catch(function (e) {
      console.error('寫入失敗', e);
      row.serverMsg = { ok: false, text: '寫入失敗：' + e.message };
    }).then(function () { state.busy = false; renderAll(); });
  }

  // 寫入後或按「重新讀表」：重讀表上現況（槽位空不空、既有活動），不動右邊已經填好的格子
  function refreshIndex() {
    return server('activityWriterInit').then(function (data) {
      state.index = P.buildIndex(data);
      state.rows.forEach(function (r) { if (!r.written) { r.slot = null; r.armed = null; } });
    });
  }

  function copyText(text) {
    var legacy = function () { return new Promise(function (resolve, reject) {
      var ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); } finally { ta.remove(); }
    }); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(legacy);
    return legacy();
  }

  function copyRows(rows) {
    var tsv = P.toTsv(rows.map(rowCells));
    window.__lastCopied = tsv;   // 測試用
    copyText(tsv).then(function () {
      var row = cur();
      var where = state.kind === 'coupon' ? '到 Cards Data 這張卡的 couponMerchant_N 那格貼上（欄位順序：' + P.COUPON_COLS.join('、') + '）' : state.kind === 'rate'
        ? (row.result.existing ? '到 Cards Data 這張卡的 rate_' + row.result.existing.slot + ' 那格貼上（覆蓋）' : '到 Cards Data 這張卡第一個空的 rate_N 那格貼上')
        : '到 New Cardholder Promos 的 id 欄那格貼上';
      if (HOST) where += '（視窗裡建議直接按「寫進試算表」，會依欄名寫入）';
      var blank = rows.reduce(function (n, r) { return n + unapproved(r).length; }, 0);
      toast('已複製 ' + rows.length + ' 列 × ' + K().cols.length + ' 欄' + (blank ? '（審核區沒勾的 ' + blank + ' 格留空）' : '') + ' → ' + where);
    }).catch(function (e) { console.error('複製失敗', e); toast('複製失敗——請手動選取下方預覽'); });
  }

  // ---------- AI（選用） ----------
  function callGemini(req) {
    if (HOST) {   // 試算表視窗：金鑰在指令碼屬性，從伺服器端呼叫
      $('aiStatus').textContent = '解析中…';
      return server('activityWriterAi', JSON.stringify(req)).then(function (res) {
        if (!res.ok) throw new Error(res.message || 'AI 解析失敗');
        return { model: res.model, data: res.data };
      });
    }
    var key = store.get('geminiKey', '');
    var models = store.get('models', DEFAULT_MODELS).split(/[,，\s]+/).filter(Boolean);
    var body = JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: req.schema, temperature: 0 }
    });
    var tried = [];
    var attempt = function (i) {
      if (i >= models.length) return Promise.reject(new Error('所有模型都失敗：' + tried.join('；')));
      $('aiStatus').textContent = '解析中（' + models[i] + '）…';
      return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[i]) + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: body
      }).then(function (res) {
        if (res.status === 429 || res.status === 404 || res.status >= 500) { tried.push(models[i] + ' HTTP ' + res.status); return attempt(i + 1); }
        return res.json().then(function (j) {
          if (!res.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + res.status);
          var part = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0];
          if (!part || !part.text) throw new Error('AI 沒有回傳內容');
          return { model: models[i], data: JSON.parse(part.text) };
        });
      });
    };
    return attempt(0);
  }

  function runAi() {
    var text = $('source').value;
    if (!text.trim()) return toast('先貼原文');
    if (!state.cardId) return toast('先選卡片');
    if (state.kind === 'coupon') return toast('領券活動目前只有規則解析（欄位少，直接改比較快）');
    if (!HOST && !store.get('geminiKey', '')) { openSettings(); return toast('要用 AI 得先填 Gemini 金鑰（規則解析不需要）'); }
    state.aiBusy = true; $('aiBtn').disabled = true;
    var base = cur() ? cur().result : null;
    callGemini(P.buildAiRequest(state.index, state.kind, state.cardId, text)).then(function (out) {
      var list = state.kind === 'rate' ? (out.data.groups || []) : (out.data.promos || []);
      if (!list.length) { $('aiStatus').textContent = 'AI 沒有抽出活動：' + (out.data.note || '（沒說原因）'); return; }
      var page = state.split ? cur() : null;
      var made = list.map(function (g, i) {
        var r = makeRow(state.kind === 'rate' ? P.applyAiActivity(state.index, state.cardId, g, base) : P.applyAiPromo(state.index, state.cardId, g, base));
        if (page) { r.text = page.text; r.fullTitle = page.fullTitle; r.title = page.title + (list.length > 1 ? '-' + (i + 1) : ''); }
        return r;
      });
      if (page) Array.prototype.splice.apply(state.rows, [state.active, 1].concat(made));   // 分頁模式：只換掉這一頁
      else { state.rows = made; state.active = 0; }
      $('aiStatus').textContent = '完成（' + out.model + '）：' + list.length + ' 列' + (out.data.note ? '｜' + out.data.note : '');
      renderAll();
    }).catch(function (e) {
      console.error('AI 解析失敗', e);
      $('aiStatus').textContent = '失敗：' + e.message;
    }).then(function () { state.aiBusy = false; $('aiBtn').disabled = false; });
  }

  // ---------- 設定 ----------
  function openSettings() {
    $('setDerived').value = store.get('derived', 'formula');
    $('setKey').value = store.get('geminiKey', '');
    $('setModels').value = store.get('models', DEFAULT_MODELS);
    $('setAiBox').hidden = HOST;   // 試算表視窗的金鑰與模型在指令碼屬性
    $('settings').showModal();
  }

  function renderAll() { renderLeft(); renderResult(); renderBar(); }

  // ---------- 事件 ----------
  $('source').addEventListener('input', reparseSoon);
  $('source').addEventListener('paste', function () { setTimeout(reparse, 0); });
  $('sourceUrl').addEventListener('input', function () {
    var row = cur(); if (row && state.kind === 'promo' && !row.dirty.link) { row.fields.link = $('sourceUrl').value.trim(); renderResult(); renderBar(); }
  });
  $('kindSeg').addEventListener('click', function (e) {
    var k = e.target.getAttribute('data-kind'); if (!k) return;
    state.kind = k; state.kindManual = true;
    if (state.split && cur()) { if (cur().written) return renderAll(); cur().kind = k; cur().dirty = {}; } else state.rows = [];
    reparse();
  });
  $('cardSel').addEventListener('change', function (e) {
    state.cardId = e.target.value; state.cardManual = !!e.target.value;
    if (state.split) {   // 換卡：每一頁（還沒寫入的）都重新解析
      state.rows = state.rows.map(function (r) {
        if (r.written) return r;
        var n = makeRow(parseText(r.kind, r.text), r, r.kind); n.text = r.text; n.title = r.title; n.fullTitle = r.fullTitle; return n;
      });
      return renderAll();
    }
    reparse(); if (!$('source').value.trim()) renderAll();
  });
  $('resetBtn').addEventListener('click', function () {
    $('source').value = ''; $('sourceUrl').value = ''; $('aiStatus').textContent = '';
    state.rows = []; state.kindManual = false; state.cardManual = false; state.cardId = ''; state.active = 0; state.split = null; state.multi = null;
    renderAll(); $('source').focus();
  });
  $('anchorCell').addEventListener('input', renderBar);
  $('writeBtn').addEventListener('click', writeRow);
  $('slotSel').addEventListener('change', function (e) { var row = cur(); if (row) { row.slot = e.target.value === '' ? '' : Number(e.target.value); row.armed = null; renderBar(); } });
  $('reloadBtn').addEventListener('click', function () {
    $('reloadBtn').disabled = true;
    refreshIndex().then(function () { toast('已重新讀表'); }).catch(function (e) { console.error(e); toast('重新讀表失敗：' + e.message); })
      .then(function () { $('reloadBtn').disabled = false; renderAll(); });
  });
  $('aiBtn').addEventListener('click', runAi);
  $('copyBtn').addEventListener('click', function () { if (cur()) copyRows([cur()]); });
  $('copyAllBtn').addEventListener('click', function () { copyRows(state.rows); });
  $('settingsBtn').addEventListener('click', openSettings);
  $('setCancel').addEventListener('click', function () { $('settings').close(); });
  $('setSave').addEventListener('click', function () {
    store.set('derived', $('setDerived').value); store.set('geminiKey', $('setKey').value.trim());
    store.set('models', $('setModels').value.trim() || DEFAULT_MODELS);
    $('settings').close(); renderBar();
  });
  $('dataFile').addEventListener('change', function (e) {
    var file = e.target.files[0]; if (!file) return;
    file.text().then(function (t) { boot(decodeData(t)); }).catch(function (err) { console.error(err); toast('這個檔讀不出來，確定是 cards.data 嗎？'); });
  });

  loadData();
})();
