/* 活動快寫工具：介面（解析規則都在 parser.js）
 * 流程只有一個畫面：選卡（自動）→ 貼原文 → 逐格確認 → 複製一列。
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

  var state = {
    index: null, kind: 'rate', kindManual: false, cardId: '', cardManual: false,
    openNotes: {}, rows: [], active: 0,          // rows[i] = { result, fields, dirty:{}, itemSel:{}, condSel:{}, headline }
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
    $('dataMeta').textContent = '卡片資料：' + state.index.cards.length + ' 張卡｜匯出於 ' + (data.lastUpdated || '（未知）') +
      '｜通路詞庫 ' + state.index.vocabKeys.length + ' 個寫法';
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
  function makeRow(result, keepFrom) {
    var row = { result: result, fields: {}, dirty: {}, headline: result.structure ? result.structure.headline : null,
      structChoice: result.structure ? result.structure.choice : -1, options: result.structure ? result.structure.options : [] };
    Object.keys(result.fields).forEach(function (k) { row.fields[k] = result.fields[k]; });
    if (keepFrom) Object.keys(keepFrom.dirty).forEach(function (k) {   // 手動改過的格子不被重新解析蓋掉
      if (k in row.fields) { row.fields[k] = keepFrom.fields[k]; row.dirty[k] = true; }
    });
    return row;
  }

  function reparse() {
    if (!state.index) return;
    var text = $('source').value;
    if (!text.trim()) { state.rows = []; state.active = 0; renderAll(); return; }
    if (!state.kindManual) state.kind = P.detectKind(P.normalizeText(text));
    if (!state.cardManual) { var id = P.detectCard(state.index, text); if (id) state.cardId = id; }
    var extra = { url: $('sourceUrl').value };
    var result = state.kind === 'rate' ? P.parseActivity(state.index, state.cardId, text, extra) : P.parsePromo(state.index, state.cardId, text, extra);
    state.rows = [makeRow(result, state.rows[0])];
    state.active = 0;
    renderAll();
  }

  var reparseSoon = (function () { var t; return function () { clearTimeout(t); t = setTimeout(reparse, 220); }; })();

  function cur() { return state.rows[state.active]; }

  function setField(name, value, fromUser) {
    var row = cur(); if (!row) return;
    row.fields[name] = value;
    if (fromUser) row.dirty[name] = true;
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
    if (state.kind === 'rate') {
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
    ['apply_cta_link', '沿用同卡', 'text', 4], ['pick_question', '一句鉤子', 'text', 4], ['pick_reason', '一句理由', 'area', 4]
  ];
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
    var onInput = function (e) { setField(name, e.target.value, true); renderBar(); if (name === 'rate') syncDependents(); };
    if (type === 'area') {
      // 列數照內容估：一格大約塞 4.6 個全形字（12 格 ≈ 55 字）
      var perLine = Math.max(8, Math.floor((def[3] || 12) * 4.6));
      var lines = String(val).split('\n').reduce(function (n, l) { return n + Math.max(1, Math.ceil(l.length / perLine)); }, 0);
      var ta = el('textarea', { id: 'f_' + name, rows: String(Math.min(6, Math.max(1, lines))), oninput: onInput });
      ta.value = val; return ta;
    }
    if (type === 'model') {
      var sel = el('select', { id: 'f_' + name, onchange: function (e) { setField(name, e.target.value, true); renderBar(); } });
      var opts = MODELS.slice();
      row.options.forEach(function (o) { if (opts.indexOf(o.model) < 0) opts.push(o.model); });
      if (opts.indexOf(val) < 0) opts.push(val);
      opts.forEach(function (m) { sel.appendChild(el('option', { value: m, text: m || '（留空）' })); });
      sel.value = val; return sel;
    }
    var inp = el('input', { type: 'text', id: 'f_' + name, oninput: onInput });
    inp.value = val; return inp;
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

    if ((name === 'items' || name === 'bonus_merchants') && chips.items && chips.items.length) {
      var inList = splitList(row.fields[name]).map(P.termKey);
      body.appendChild(chipList(chips.items, function (n) { return inList.indexOf(P.termKey(n)) >= 0; },
        function (n) { toggleInList(name, n, ','); },
        function (it) { return (it.known ? '' : 'new') + (it.excluded ? ' ex' : ''); }));
    }
    if (name === 'conditions' && chips.conditions && chips.conditions.length) {
      var have = String(row.fields.conditions || '').split('；');
      body.appendChild(chipList(chips.conditions, function (n) { return have.indexOf(n) >= 0; }, function (n) { toggleInList('conditions', n, '；'); }));
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
    return el('div', { class: 'field s' + (def[3] || 12) + (note ? ' lv-' + note.level : '') }, [
      el('label', { for: 'f_' + name }, [name, def[1] ? el('small', { text: def[1] }) : null]), body
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
    if (state.rows.length > 1 || row.result.viaAi) {
      var tabs = el('div', { class: 'tabs' });
      state.rows.forEach(function (r, i) {
        tabs.appendChild(el('button', { type: 'button', class: i === state.active ? 'on' : '',
          text: '第 ' + (i + 1) + ' 列' + (r.fields.rate ? '（' + r.fields.rate + '%）' : ''), onclick: function () { state.active = i; renderAll(); } }));
      });
      if (row.result.viaAi) tabs.appendChild(el('span', { class: 'auto', text: 'AI 解析' }));
      box.appendChild(tabs);
    }
    if (row.result.skipped) box.appendChild(el('div', { class: 'note check banner', style: 'margin-bottom:6px', text: row.result.skipped }));
    if (row.result.evidence) box.appendChild(el('p', { class: 'evidence', text: 'AI 引用的原文：' + row.result.evidence }));
    var grid = el('div', { id: 'fields' });
    (state.kind === 'rate' ? RATE_FIELDS : PROMO_FIELDS).forEach(function (def) {
      grid.appendChild(fieldBlock(def, row));
      if (def[0] === 'maxSpend') { var sb = structBlock(row); if (sb) grid.appendChild(sb); }   // 第一列（rate…maxSpend）排完後接結構選項
    });
    box.appendChild(grid);
    if (state.kind === 'rate') box.appendChild(el('p', { class: 'hint', style: 'margin:6px 0 0', text: 'daysRemaining、period 兩欄由程式產生（設定裡可改成公式／純值／留空）。' }));
    if (focusId && $(focusId)) { $(focusId).focus(); try { $(focusId).setSelectionRange(pos, pos); } catch (e) { /* select 沒有游標 */ } }
  }

  // ---------- 畫面：底部輸出 ----------
  function rowCells(row) {
    return state.kind === 'rate' ? P.buildRateRow(row.fields, store.get('derived', 'formula'), null, $('anchorCell').value) : P.buildPromoRow(row.fields);
  }

  function renderBar() {
    var row = cur(), issues = $('issues'), prev = $('preview');
    issues.textContent = ''; prev.textContent = '';
    $('copyBtn').disabled = !row;
    $('copyAllBtn').hidden = !(state.kind === 'promo' && state.rows.length > 1);
    $('anchorCell').hidden = state.kind !== 'rate' || store.get('derived', 'formula') !== 'formula';
    if (!row) { issues.appendChild(el('span', { class: 'hint', text: '還沒有內容' })); return; }
    var list = P.validate(state.kind, row.fields);
    var pending = Object.keys(row.result.notes).filter(function (k) {
      var n = row.result.notes[k]; return n.level === 'check' && !row.dirty[k];
    });
    if (list.length) issues.appendChild(el('span', { class: 'bad', text: '⚠ ' + list.join('；') }));
    else issues.appendChild(el('span', { class: 'good', text: '格式檢查通過' }));
    if (pending.length) issues.appendChild(el('span', { class: 'hint', text: '　還沒確認的黃色欄位：' + pending.join('、') }));
    var cols = state.kind === 'rate' ? P.RATE_COLS : P.PROMO_COLS;
    rowCells(row).forEach(function (c, i) {
      var text = c && c.formula ? c.formula : String(c);
      prev.appendChild(el('span', { class: 'cell' + (text ? '' : ' blank'), text: text.replace(/\n/g, '⏎'), title: cols[i] + '：' + text }));
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
      var where = state.kind === 'rate'
        ? (row.result.existing ? '到 Cards Data 這張卡的 rate_' + row.result.existing.slot + ' 那格貼上（覆蓋）' : '到 Cards Data 這張卡第一個空的 rate_N 那格貼上')
        : '到 New Cardholder Promos 的 id 欄那格貼上';
      toast('已複製 ' + rows.length + ' 列 × ' + (state.kind === 'rate' ? P.RATE_COLS.length : P.PROMO_COLS.length) + ' 欄 → ' + where);
    }).catch(function (e) { console.error('複製失敗', e); toast('複製失敗——請手動選取下方預覽'); });
  }

  // ---------- AI（選用） ----------
  function callGemini(req) {
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
    if (!store.get('geminiKey', '')) { openSettings(); return toast('要用 AI 得先填 Gemini 金鑰（規則解析不需要）'); }
    state.aiBusy = true; $('aiBtn').disabled = true;
    var base = cur() ? cur().result : null;
    callGemini(P.buildAiRequest(state.index, state.kind, state.cardId, text)).then(function (out) {
      var list = state.kind === 'rate' ? (out.data.groups || []) : (out.data.promos || []);
      if (!list.length) { $('aiStatus').textContent = 'AI 沒有抽出活動：' + (out.data.note || '（沒說原因）'); return; }
      state.rows = list.map(function (g) {
        return makeRow(state.kind === 'rate' ? P.applyAiActivity(state.index, state.cardId, g, base) : P.applyAiPromo(state.index, state.cardId, g, base));
      });
      state.active = 0;
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
    state.kind = k; state.kindManual = true; state.rows = []; reparse();
  });
  $('cardSel').addEventListener('change', function (e) { state.cardId = e.target.value; state.cardManual = !!e.target.value; reparse(); if (!$('source').value.trim()) renderAll(); });
  $('resetBtn').addEventListener('click', function () {
    $('source').value = ''; $('sourceUrl').value = ''; $('aiStatus').textContent = '';
    state.rows = []; state.kindManual = false; state.cardManual = false; state.cardId = ''; state.active = 0;
    renderAll(); $('source').focus();
  });
  $('anchorCell').addEventListener('input', renderBar);
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
