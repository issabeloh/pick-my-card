/* 活動快寫工具：解析核心（純函式，瀏覽器與 node 共用）
 *
 * 區塊目錄（Grep 關鍵字）：
 *   "文字正規化"      normalizeText / parseAmount / fmtDate
 *   "卡片索引"        buildIndex（商家詞庫、卡片別名）
 *   "日期解析"        parsePeriod
 *   "回饋率解析"      findRates / structureOptions
 *   "上限與門檻"      findCaps / findMinSpend
 *   "通路比對"        matchItems
 *   "條件片語"        findConditions / needsRegister
 *   "一般活動"        parseActivity
 *   "新戶活動"        parsePromo（"特定族群新戶" audienceOf、"條件草稿" draftTasks）
 *   "輸出一列"        buildRateRow / buildPromoRow / toTsv
 *   "AI 提示詞"       buildAiRequest / applyAiActivity / applyAiPromo
 *
 * 欄位寫法的規則來源（改這裡的規則前先對照，兩邊要同調）：
 *   docs/project/cashbackmodel-fill-guide.md（rate／cashbackModel／cap 換算）
 *   apps-script/card-benefits-parser.gs extractCard_（items、conditions 的寫法）
 *   apps-script/benefits-parser.gs extractNewPromos_（新戶活動各欄）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PMCWriter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RATE_COLS = ['rate', 'cashbackModel', 'cap', 'minSpend', 'maxSpend', 'items', 'category', 'conditions',
    'registerLink', 'periodStart', 'periodEnd', 'daysRemaining', 'period'];
  var PROMO_COLS = ['id', 'promo_types', 'new_customer_definition', 'new_customer_summary', 'promo_condition',
    'period_start', 'period_end', 'min_spend', 'gift_content', 'gift_image_url', 'luggage_inch', 'luggage_value',
    'bonus_rate', 'bonus_merchants', 'bonus_cap', 'voucher_amount', 'voucher_usage', 'notes', 'link', 'priority',
    'active', 'apply_cta_text', 'apply_cta_link', 'pick_question', 'pick_reason'];
  var PROMO_TYPES = ['首刷禮', '回饋加碼', '定額回饋'];

  // ===== 文字正規化 =====
  function normalizeText(raw) {
    return String(raw == null ? '' : raw)
      .replace(/\r\n?/g, '\n')
      .replace(/[！-～]/g, function (ch) {   // 全形英數與符號 → 半形（保留全形標點中的「，；：（）」）
        if ('，；：（）！？'.indexOf(ch) >= 0) return ch;
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      })
      .replace(/[～〜∼]/g, '~')
      .replace(/[ 　\t]/g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
  }

  var AMT = '(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?\\s*(萬|千)?';
  var CUR = '(?:NT\\$?|NTD|新[臺台]幣|\\$)?\\s*';

  function parseAmount(intPart, decPart, unit) {
    var n = parseFloat(String(intPart).replace(/,/g, '') + (decPart ? '.' + decPart : ''));
    if (isNaN(n)) return null;
    if (unit === '萬') n *= 10000;
    if (unit === '千') n *= 1000;
    return n;
  }

  function fmtDate(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (y < 200) y += 1911;                      // 民國年
    if (!(y > 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    return y + '/' + m + '/' + d;
  }

  function normalizeDate(s) {
    var m = /(\d{2,4})\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})/.exec(String(s || ''));
    return m ? fmtDate(m[1], m[2], m[3]) : '';
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function trimNum(n) { return n == null || n === '' || isNaN(n) ? '' : String(round2(Number(n))); }

  // 比對用的鍵：忽略大小寫、空白、臺/台（與 term-unify.gs 的 termUnifyKey_ 同精神）
  function termKey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '').replace(/臺/g, '台');
  }

  function snippet(text, index, len, pad) {
    pad = pad == null ? 14 : pad;
    var a = Math.max(0, index - pad), b = Math.min(text.length, index + len + pad);
    return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\n/g, ' ') + (b < text.length ? '…' : '');
  }

  // ===== 卡片索引 =====
  var GENERIC_ITEM = /^(國內|國外|海外|一般|日本|韓國)?(一般)?(消費|實體消費|線上消費|網路消費)?$|^(網購|保費|保險|餐廳|百貨|超商|加油|交通|國內餐廳|行動支付)$/;

  var GENERIC_CATEGORY = /^(網購|保費|保險|餐廳|百貨|超商|加油|交通|國內餐廳)$/;   // 類別詞：沒有具體商家時可以當通路

  function buildIndex(data) {
    data = data || {};
    var cards = data.cards || [];
    var counts = {};                 // key → { 寫法: 次數 }
    var add = function (name, weight) {
      name = String(name == null ? '' : name).trim();
      if (name.length < 2) return;
      var k = termKey(name);
      (counts[k] = counts[k] || {})[name] = (counts[k][name] || 0) + (weight || 1);
    };
    cards.forEach(function (c) {
      (c.cashbackRates || []).forEach(function (r) { (r.items || []).forEach(function (it) { add(it); }); });
      (c.couponCashbacks || []).forEach(function (cp) {
        String(cp.merchant || '').split(/[,，]/).forEach(function (m) { add(m); });
      });
    });
    (data.newCardholderPromos || []).forEach(function (p) {
      (p.bonus_merchants || []).forEach(function (m) { if (m.charAt(0) !== '*') add(m); });
    });
    (data.quickSearchOptions || []).forEach(function (q) { (q.merchants || []).forEach(function (m) { add(m); }); });

    var vocab = {};                  // key → 統一寫法
    Object.keys(counts).forEach(function (k) {
      var best = '', n = -1;
      Object.keys(counts[k]).forEach(function (name) { if (counts[k][name] > n) { n = counts[k][name]; best = name; } });
      vocab[k] = best;
    });
    // 帶括號的寫法（uniqlo(實體門市及官網)）另外用括號前的品牌名當鍵，才比得到官網文字
    Object.keys(vocab).forEach(function (k) {
      var base = k.replace(/[(（].*$/, '');
      if (base.length >= 2 && base !== k && !vocab[base]) vocab[base] = vocab[k];
    });
    // 統一詞表是權威：term 與它的別名都指向 term
    (data.termAliases || []).forEach(function (t) {
      if (!t || !t.term) return;
      vocab[termKey(t.term)] = t.term;
      (t.aliases || []).forEach(function (a) { if (termKey(a).length >= 2) vocab[termKey(a)] = t.term; });
    });
    // 行動支付的別名 → 資料裡已有的寫法（沒有才用 Payments 表的名稱）
    (data.payments || []).forEach(function (p) {
      var canon = vocab[termKey(p.name)] || p.name;
      [p.name].concat(p.searchTerms || []).forEach(function (s) {
        var k = termKey(s);
        if (k.length >= 2 && !vocab[k]) vocab[k] = canon;
      });
    });

    var vocabKeys = Object.keys(vocab).sort(function (a, b) { return b.length - a.length; });
    var paymentKeys = {};            // 行動支付（付款工具，不是通路）——新戶活動的 bonus_merchants 預設不選
    (data.payments || []).forEach(function (p) {
      [p.name].concat(p.searchTerms || []).forEach(function (s) { paymentKeys[termKey(s)] = true; });
      paymentKeys[termKey(vocab[termKey(p.name)] || p.name)] = true;
    });

    var cardAliases = cards.map(function (c) {
      var names = {};
      var push = function (s) { var k = termKey(s); if (k.length >= 3) names[k] = true; };
      push(c.name);
      var noBank = String(c.name || '').replace(new RegExp('^' + (c.bank || '') + '(銀行)?'), '');
      push(noBank);
      push(noBank.replace(/(信用卡|聯名卡|卡)(\(.*\))?$/, ''));
      push(String(c.name || '').replace(/(信用卡|聯名卡|卡)(\(.*\))?$/, ''));
      // 官網常用簡稱：「企銀藝FUN悠遊御璽卡」寫成「藝FUN卡」→ 卡名開頭 3 字以上 ＋「卡」也算
      var core = termKey(noBank.replace(/(信用卡|聯名卡|卡)(\(.*\))?$/, ''));
      for (var n = 3; n < core.length; n++) names[core.slice(0, n) + '卡'] = true;
      return { id: c.id, keys: Object.keys(names).sort(function (a, b) { return b.length - a.length; }) };
    });

    var usages = {};
    (data.newCardholderPromos || []).forEach(function (p) { if (p.voucher_usage) usages[termKey(p.voucher_usage)] = p.voucher_usage; });

    return { data: data, cards: cards, vocab: vocab, vocabKeys: vocabKeys, paymentKeys: paymentKeys, cardAliases: cardAliases, usages: usages };
  }

  function getCard(index, id) {
    for (var i = 0; i < index.cards.length; i++) if (index.cards[i].id === id) return index.cards[i];
    return null;
  }

  function detectCard(index, text) {
    var t = termKey(normalizeText(text));
    var best = null;
    index.cardAliases.forEach(function (c) {
      c.keys.forEach(function (k) {
        if (t.indexOf(k) >= 0 && (!best || k.length > best.len)) best = { id: c.id, len: k.length };
      });
    });
    return best ? best.id : '';
  }

  function detectKind(text) {
    return /新戶|首刷|核卡後|新卡友|新申辦|首次申辦/.test(text) ? 'promo' : 'rate';
  }

  // ===== 日期解析 =====
  function parsePeriod(text) {
    var D = '(\\d{2,4})\\s*[\\/.\\-年]\\s*(\\d{1,2})\\s*[\\/.\\-月]\\s*(\\d{1,2})\\s*日?';
    var PART = '(?:(\\d{2,4})\\s*[\\/.\\-年]\\s*)?(\\d{1,2})\\s*[\\/.\\-月]\\s*(\\d{1,2})\\s*日?';
    var SEP = '\\s*(?:\\([^)]{1,4}\\))?\\s*(?:~|至|到|起至|－|–|—|-)\\s*';
    var re = new RegExp(D + SEP + PART, 'g');
    var ranges = [], m;
    while ((m = re.exec(text))) {
      var s = fmtDate(m[1], m[2], m[3]);
      var e = fmtDate(m[4] || m[1], m[5], m[6]);
      if (!s || !e) continue;
      var before = text.slice(Math.max(0, m.index - 12), m.index);
      ranges.push({ start: s, end: e, index: m.index, len: m[0].length,
        score: /(活動|優惠|適用)?(期間|時間|日期|期限)/.test(before) ? 2 : 1 });
    }
    if (ranges.length) {
      ranges.sort(function (a, b) { return b.score - a.score || a.index - b.index; });
      var r = ranges[0];
      return { start: r.start, end: r.end, evidence: snippet(text, r.index, r.len, 8),
        alternatives: ranges.slice(1).map(function (x) { return { start: x.start, end: x.end }; }) };
    }
    // 只有結束日：「即日起至 2026/12/31」「～2026/12/31 止」
    var one = new RegExp('(?:即日起|至|~|到)\\s*' + D).exec(text);
    if (one) {
      var end = fmtDate(one[1], one[2], one[3]);
      if (end) return { start: '', end: end, evidence: snippet(text, one.index, one[0].length, 8), alternatives: [] };
    }
    return { start: '', end: '', evidence: '', alternatives: [] };
  }

  // ===== 回饋率解析 =====
  // 回傳文字中所有百分比；kind：fee（手續費／利率，不算回饋）、max（最高）、bonus（加碼）、base（原／基本）、plain
  function findRates(text) {
    var re = /(\d+(?:\.\d+)?)\s*%/g, out = [], m;
    while ((m = re.exec(text))) {
      var v = parseFloat(m[1]);
      var before = text.slice(Math.max(0, m.index - 14), m.index);
      var after = text.slice(m.index + m[0].length, m.index + m[0].length + 20);
      var kind = 'plain';
      if (/(服務費|手續費|利率|年息|分期)[^%]{0,6}$/.test(before) || /^\s*(國外交易)?(服務費|手續費|利率)/.test(after) || /^\s*OFF/i.test(after)) kind = 'fee';
      else if (/(原權益|原回饋|原有回饋|基本回饋)[^%，。\n]{0,6}$/.test(before)) kind = 'base';   // 「原權益最高 2%」是原本就有的，不是這檔的標榜數字
      else if (/最高[^%，。\n]{0,10}$/.test(before)) kind = 'max';
      else if (/(原|基本|一般消費)[^%，。\n]{0,8}$/.test(before)) kind = 'base';
      else if (/(加碼|再享|再加|額外|加贈)[^%，。\n]{0,8}$/.test(before)) kind = 'bonus';
      else if (/^[^，。\n%]{0,16}?加碼/.test(after)) kind = 'bonus';                               // 「6%台新Point(信用卡)加碼回饋」
      if (v > 0 && v <= 100) out.push({ value: v, kind: kind, index: m.index, len: m[0].length });
    }
    return out;
  }

  function near(a, b) { return Math.abs(a - b) < 0.0005; }

  // 找一組成分加總＝headline（「最高 3% ＝ 原 0.5% ＋ 加碼 2.5%」）
  function findComposition(headline, values) {
    var pool = values.filter(function (v) { return v < headline; });
    var uniq = pool.filter(function (v, i) { return pool.indexOf(v) === i; }).slice(0, 8);
    var best = null;
    var walk = function (start, picked, sum) {
      if (picked.length >= 2 && near(sum, headline)) { if (!best || picked.length < best.length) best = picked.slice(); return; }
      if (picked.length >= 4 || sum > headline) return;
      for (var i = start; i < uniq.length; i++) walk(i + 1, picked.concat(uniq[i]), sum + uniq[i]);
    };
    walk(0, [], 0);
    return best;
  }

  // 給定「官網標榜的數字」與卡片，列出所有合理的（cashbackModel, rate）組合
  // 規則：rate_N ＝ 標榜數字 −（model 裡列出的成分之和）——fill-guide 第 3 節
  function structureOptions(card, headline, overseas) {
    card = card || {};
    var n = function (v) { return typeof v === 'number' ? v : (parseFloat(v) || 0); };
    var basic = n(card.basicCashback), dom = n(card.domesticBonusRate);
    var ovs = n(card.overseasCashback), ovsB = n(card.overseasBonusRate);
    var opts = [];
    var push = function (model, parts, label) {
      var sum = parts.reduce(function (a, b) { return a + b; }, 0);
      var rate = round2(headline - sum);
      if (rate < 0) return;
      opts.push({ model: model, rate: rate, total: headline, label: label });
    };
    push('rate+basic', [basic], '含基本回饋 ' + basic + '%');
    if (dom) push('rate+basic+domesticBonusRate', [basic, dom], '含基本 ' + basic + '%＋國內加碼 ' + dom + '%');
    if (ovs) push('rate+overseasCashback', [ovs], '含海外基本 ' + ovs + '%');
    if (ovs && ovsB) push('rate+overseasCashback+overseasBonusRate', [ovs, ovsB], '含海外基本 ' + ovs + '%＋海外加碼 ' + ovsB + '%');
    push('rate', [], '這個通路的完整率（不與基本回饋併計）');
    push('', [], '留空（cap 內用 rate、超過退回基本回饋）');
    (card.cashbackRates || []).forEach(function (r) {
      if (typeof r.rate !== 'number' || !r.slot || r.rate <= 0 || r.rate >= headline) return;
      push('rate+rate_' + r.slot, [r.rate], '疊在 rate_' + r.slot + '（' + r.rate + '%，' + (r.items || []).slice(0, 2).join('、') + '）之上');
    });
    return overseas ? opts.sort(function (a, b) {
      return (/overseas/.test(b.model) ? 1 : 0) - (/overseas/.test(a.model) ? 1 : 0);
    }) : opts;
  }

  function pickStructure(card, text, rates, overseas) {
    var usable = rates.filter(function (r) { return r.kind !== 'fee'; });
    if (!usable.length) return { headline: null, options: [], choice: -1, confident: false, reason: '文字裡找不到回饋率（%）' };
    var maxes = usable.filter(function (r) { return r.kind === 'max'; });
    var top = usable.reduce(function (a, b) { return b.value > a.value ? b : a; });
    var head = maxes.length ? maxes.reduce(function (a, b) { return b.value > a.value ? b : a; }) : top;
    var headline = head.value;
    var options = structureOptions(card, headline, overseas);
    var find = function (model) { for (var i = 0; i < options.length; i++) if (options[i].model === model) return i; return -1; };
    var basic = typeof card.basicCashback === 'number' ? card.basicCashback : null;
    var res = { headline: headline, options: options, choice: -1, confident: false, reason: '',
      evidence: snippet(text, head.index, head.len) };

    if (/(不列入一般消費|不併計|不得併計|不予併計|不再享(有)?(原|基本)|不適用(原|基本)|恕不(適用|享有)(原|基本))/.test(text)) {
      res.choice = find('rate'); res.confident = true;
      res.reason = '原文寫明不與基本回饋併計 → 排除型，rate 填完整率';
      return res;
    }
    var comp = findComposition(headline, usable.map(function (r) { return r.value; }));
    if (comp) {
      var has = function (v) { return v && comp.some(function (c) { return near(c, v); }); };
      var model = null;
      if (overseas && has(card.overseasCashback)) model = has(card.overseasBonusRate) ? 'rate+overseasCashback+overseasBonusRate' : 'rate+overseasCashback';
      else if (has(basic)) model = has(card.domesticBonusRate) ? 'rate+basic+domesticBonusRate' : 'rate+basic';
      else if (has(card.overseasCashback)) model = 'rate+overseasCashback';
      if (model) {
        res.choice = find(model); res.confident = true;
        res.reason = '原文拆解 ' + headline + '% ＝ ' + comp.join('% ＋ ') + '%，其中有本卡的基本回饋';
        return res;
      }
      var slotHit = -1;
      options.forEach(function (o, i) {
        var mm = /^rate\+rate_(\d+)$/.exec(o.model);
        if (mm && comp.some(function (c) { return near(c, o.rate); })) slotHit = i;
      });
      if (slotHit >= 0) {
        res.choice = slotHit;
        res.reason = '原文拆解 ' + headline + '% ＝ ' + comp.join('% ＋ ') + '%，成分對得上既有槽位 → 疑似跨槽疊加，請確認';
        return res;
      }
      res.reason = '原文拆解 ' + headline + '% ＝ ' + comp.join('% ＋ ') + '%，但成分對不上本卡的基本回饋——請自己選結構';
    }
    var bonus = usable.filter(function (r) { return r.kind === 'bonus'; });
    if (!maxes.length && bonus.length) {
      // 只講「加碼 X%」：X 就是這一槽自己的率，疊在基本回饋上
      var b = bonus[0].value;
      var o2 = structureOptions(card, b + (overseas && card.overseasCashback ? card.overseasCashback : (basic || 0)), overseas);
      res.headline = round2(b + (overseas && card.overseasCashback ? card.overseasCashback : (basic || 0)));
      res.options = o2;
      res.choice = (function () {
        var want = overseas && card.overseasCashback ? 'rate+overseasCashback' : 'rate+basic';
        for (var i = 0; i < o2.length; i++) if (o2[i].model === want) return i;
        return 0;
      })();
      res.reason = '原文只講「加碼 ' + b + '%」→ rate 填 ' + b + '，疊在基本回饋上（合計 ' + res.headline + '%）。請確認';
      res.evidence = snippet(text, bonus[0].index, bonus[0].len);
      return res;
    }
    // 只有「最高 X%」：通常已含基本回饋，但文字沒說死
    res.choice = find(overseas && card.overseasCashback ? 'rate+overseasCashback' : 'rate+basic');
    if (res.choice < 0) res.choice = 0;
    res.reason = (res.reason ? res.reason + '；' : '') + '官網只寫「' + (maxes.length ? '最高 ' : '') + headline +
      '%」、沒拆解成分——先假設已含基本回饋，請看原文確認';
    return res;
  }

  // ===== 上限與門檻 =====
  function findCaps(text) {
    var out = { spend: null, reward: null, period: '', evidence: '' };
    var m = new RegExp('(?:消費|刷卡)(?:金額)?(?:累[積計])?(?:之)?上限[^\\d\\n]{0,10}?' + CUR + AMT + '\\s*元?').exec(text);
    if (m) { out.spend = parseAmount(m[1], m[2], m[3]); out.evidence = snippet(text, m.index, m[0].length); }
    var res = [
      new RegExp('(每[月季年期戶人卡][^。\\n]{0,14}?|活動期間[^。\\n]{0,10}?)?(?:回饋|加碼|贈點|點數|刷卡金|回饋金)?[^。\\n\\d]{0,8}?上限[^\\d\\n]{0,10}?' + CUR + AMT + '(?![\\d,])\\s*(元|點)?(?!\\s*(?:名|位|人|%|筆|次|天|日|吋))'),
      new RegExp('(每[月季年期戶人卡][^。\\n]{0,14}?|活動期間[^。\\n]{0,10}?)?最高(?:可)?(?:回饋|贈|享|獲得)[^\\d\\n%]{0,8}?' + CUR + AMT + '(?![\\d,])\\s*(元|點)(?!\\s*(?:名|位|人|%))')
    ];
    for (var i = 0; i < res.length && out.reward == null; i++) {
      var r = res[i].exec(text);
      if (!r) continue;
      if (m && r.index >= m.index && r.index < m.index + m[0].length) continue;   // 同一句已當成消費上限
      out.reward = parseAmount(r[2], r[3], r[4]);
      var per = /每[月季年期]|活動期間/.exec(r[0]);
      out.period = per ? per[0] : '';
      out.rewardText = (out.period || '') + '上限' + String(r[2]) + (r[4] || '') + (r[5] || '元');
      if (!out.evidence) out.evidence = snippet(text, r.index, r[0].length, 6);
    }
    return out;
  }

  function findMinSpend(text) {
    var m = new RegExp('單筆(?:消費|刷卡|交易)?(?:金額)?(?:需|須|每)?(?:滿|達|超過)\\s*' + CUR + AMT).exec(text);
    if (!m) return { value: null, evidence: '' };
    return { value: parseAmount(m[1], m[2], m[3]), evidence: snippet(text, m.index, m[0].length) };
  }

  function findAccumulated(text) {
    var m = new RegExp('((?:當月|每月|當期|活動期間)?[^，。；\\n]{0,10}?(?:累[積計])[^，。；\\n\\d]{0,10}?(?:滿|達)\\s*' + CUR + AMT + '\\s*元?)').exec(text);
    if (!m) return null;
    return { value: parseAmount(m[2], m[3], m[4]), text: m[1].replace(/^[\s、及且並]+/, ''), evidence: snippet(text, m.index, m[0].length) };
  }

  // ===== 通路比對 =====
  // 回傳 [{ name, known, excluded, generic }]；known＝資料裡已有這個通路（用既有寫法），excluded＝出現在「排除…」子句
  function matchItems(index, text) {
    var lower = text.toLowerCase().replace(/臺/g, '台');
    // 壓掉空白的版本，並記住每個字元在原文的位置
    var compact = '', pos = [];
    for (var i = 0; i < lower.length; i++) { if (!/\s/.test(lower[i])) { compact += lower[i]; pos.push(i); } }
    var taken = new Array(compact.length);
    var found = [];
    var isAscii = function (ch) { return ch && /[a-z0-9]/.test(ch); };
    index.vocabKeys.forEach(function (k) {
      if (k.length < 2) return;
      var from = 0, at;
      while ((at = compact.indexOf(k, from)) >= 0) {
        from = at + 1;
        var clash = false;
        for (var j = at; j < at + k.length; j++) if (taken[j]) { clash = true; break; }
        if (clash) continue;
        // 純英數的詞要有邊界，避免 sia 命中 asiayo
        if (/^[a-z0-9]+$/.test(k) && (isAscii(compact[at - 1]) || isAscii(compact[at + k.length]))) continue;
        for (var j2 = at; j2 < at + k.length; j2++) taken[j2] = true;
        found.push({ name: index.vocab[k], at: pos[at], known: true });
      }
    });
    found.sort(function (a, b) { return a.at - b.at; });

    // 清單句裡沒見過的通路：含兩個以上頓號的句子，逐項切開
    var seenKey = {};
    found.forEach(function (f) { seenKey[termKey(f.name)] = true; });
    var bodyLen = splitBody(text).body.length;   // 注意事項裡的清單多半是排除項與罰則，不拿來猜新通路
    var lineRe = /[^\n。；]+/g, lm;
    while ((lm = lineRe.exec(text)) && lm.index < bodyLen) {
      var seg = lm[0];
      if ((seg.match(/、/g) || []).length < 2) continue;
      // 上一行是「不列入…之交易如下：」→ 這一行整串都是排除項
      if (/(不列入|排除|不適用|不含|不回饋|不予回饋)[^\n]*[:：]\s*\n\s*$/.test(text.slice(Math.max(0, lm.index - 60), lm.index))) continue;
      var marked = /(指定|適用|合作|特約)(通路|商店|商家|店家|特店|品牌)|包含|如下|[:：]/.test(seg);
      var body = seg.replace(/^.*?[:：]/, '');
      var offset = lm.index + (seg.length - body.length);
      body.split(/、|，(?![^(（]*[)）])/).forEach(function (tok) {
        var at = offset + body.indexOf(tok);
        var name = tok.replace(/^[\s\-‧•●▪■◆*※【\[]+|[\s】\]。.]+$/g, '').replace(/^(及|與|和|或|以及)/, '').replace(/等.*$/, '').trim();
        if (name.length < 2 || name.length > 24) return;
        if (/%|\d{4}|享|回饋|消費滿|登錄|上限|期間|持卡人|本行|不含|排除|電子帳單|自動扣繳/.test(name)) return;
        var k = termKey(name);
        if (seenKey[k] || index.vocab[k]) return;
        // 已經被詞庫比對吃掉的片段（如「日本UNIQLO」裡的 UNIQLO）不重複列
        if (found.some(function (f) { return f.known && termKey(name).indexOf(termKey(f.name)) >= 0 && f.at >= at && f.at < at + tok.length; })) {
          // 保留「國家＋品牌」這種更精確的寫法，但預設不選
          found.push({ name: name, at: at, known: false, weak: true });
        } else {
          found.push({ name: name, at: at, known: false, weak: !marked });
        }
        seenKey[k] = true;
      });
    }

    // 排除子句：同一句裡前面出現「排除／不含／不適用」
    var out = [], dedupe = {};
    found.sort(function (a, b) { return a.at - b.at; });
    found.forEach(function (f) {
      var clauseStart = Math.max(text.lastIndexOf('。', f.at), text.lastIndexOf('\n', f.at), text.lastIndexOf('；', f.at)) + 1;
      var clause = text.slice(clauseStart, f.at);
      var excluded = /(排除|不含|不包含|不包括|不適用|恕不|除外|不列入|不予)/.test(clause);
      // 排除字寫在清單後面：「其他支付工具(如A、B、C等)不適用本活動」——只看到下一個括號外的逗號為止
      if (!excluded) {
        var depth = 0, end = f.at;
        for (; end < text.length; end++) {
          var ch = text[end];
          if (ch === '(' || ch === '（') depth++; else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
          else if (ch === '。' || ch === '\n' || ch === '；' || (depth === 0 && ch === '，')) break;
        }
        excluded = /(不適用|不列入|不予回饋|不回饋|不計入|除外)[^，]{0,8}$/.test(text.slice(f.at, end));
      }
      if (excluded && !f.known) return;            // 沒見過又被排除的詞，列出來只是雜訊
      var k = termKey(f.name);
      if (dedupe[k]) { if (!excluded) dedupe[k].excluded = false; return; }
      var item = { name: f.name, known: !!f.known, excluded: excluded, generic: GENERIC_ITEM.test(f.name), weak: !!f.weak,
        payment: !!index.paymentKeys[k] || /(pay|支付|錢包)$/i.test(f.name) };
      dedupe[k] = item; out.push(item);
    });
    var hasSpecific = out.some(function (x) { return !x.excluded && !x.generic && !x.weak; });
    out.forEach(function (x) { x.selected = !x.excluded && !x.weak && (!x.generic || !hasSpecific); });
    return out;
  }

  // 本文／注意事項分界：獨立一行的「注意事項」之後是細則，條件草稿與新通路只從本文找
  function splitBody(text) {
    var m = /(?:^|\n)[ \t]*[【\[]?[ \t]*(?:活動)?(?:注意事項|謹慎理財[^\n]*)[ \t]*[】\]]?[:：]?[ \t]*(?=\n)/.exec(text);
    return m && m.index > 0 ? { body: text.slice(0, m.index), fine: text.slice(m.index) } : { body: text, fine: '' };
  }

  // ===== 條件片語 =====
  // 「登錄」要是參加條件才算：「若同時領券及登錄分期活動」這種只是提到別的活動
  function needsRegister(text) {
    return /(?:需|須|應|請)(?:先|事先|每月|於[^，。\n]{0,20})?(?:皆)?(?:需|須)?(?:重新)?(?:完成)?(?:活動)?登錄|完成(?:活動)?登錄|登錄(?:成功)?(?:後|始|方|才)|登錄(?:網址|連結|頁|期間|時間|名額)|限量登錄|每月(?:皆)?(?:需|須)?(?:重新)?登錄/.test(text);
  }
  function quotaOf(text) {
    var m = /(?:限量|名額|前)\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(名|位|人|份|張|組)/.exec(text);
    return m ? { n: m[1], unit: m[2] } : null;
  }
  function normalizeConditions(s) {
    return String(s == null ? '' : s)
      .replace(/\s*[;；]\s*/g, '；').replace(/；+/g, '；').replace(/^；|[；。\s]+$/g, '').trim();
  }

  // 回傳 [{ text, on, why }]；on＝預設寫進 conditions
  function findConditions(text, opts) {
    opts = opts || {};
    var out = [];
    var add = function (t, on, why) {
      t = normalizeConditions(t);
      if (!t || out.some(function (o) { return o.text === t; })) return;
      out.push({ text: t, on: on !== false, why: why || '' });
    };
    if (needsRegister(text)) {
      var quota = /(?:限量|名額|前)\s*(\d{1,3}(?:,\d{3})*|\d+)\s*(名|位|人)/.exec(text);
      var monthly = /每月(?:皆)?(?:需|須)?(?:重新)?登錄/.test(text);
      add((monthly ? '需每月登錄' : '需登錄') + (quota ? '，限量' + quota[1] + '名' : (/限量|額滿/.test(text) ? '，限量' : '')), true, '原文提到登錄');
    }
    var ebill = /電子(化)?帳單|帳單\s*e\s*化|電子對帳單/i.test(text), auto = /自動扣繳|自動轉帳扣繳|自扣/.test(text);
    if (ebill && auto) add(/電子[^。\n]{0,12}(或)[^。\n]{0,12}自動扣|自動扣[^。\n]{0,12}(或)[^。\n]{0,12}電子/.test(text) ? '申辦電子帳單或設定自動扣繳' : '申辦電子帳單及自動扣繳');
    else if (ebill) add('申辦電子帳單');
    else if (auto) add('設定自動扣繳');

    var acc = opts.accumulated;
    if (acc) add(acc.text.replace(/\s+/g, ''), true, '累積門檻不是單筆門檻，寫條件、不填 minSpend');

    var day = /(每週[一二三四五六日]|每周[一二三四五六日]|週[一二三四五六日](?:、週?[一二三四五六日])*|每月\s*\d+\s*[日號]|偶數日|奇數日|假日|平日)/.exec(text);
    if (day) add('限' + day[1].replace(/\s+/g, ''));

    var pay = /(?:限|需|須)?(?:以|使用|透過)?綁定([^，。；\n]{2,24}?)(?:消費|支付|付款|結帳|交易|感應)/.exec(text);
    if (pay) add('限綁定' + pay[1].trim(), false, '若這個支付工具本身就是通路（已在 items），不必重複寫');
    if (/限(於)?實體(門市|店|商店|通路)|實體(門市|店面)(消費)?(方|才|始)/.test(text)) add('限實體門市');
    if (/限(於)?(官網|官方網站|網路|線上|APP)/i.test(text)) add('限官網／APP', false);

    var exRe = /(排除|不含|不包含|不包括)([^。；\n]{2,60})/g, em;
    while ((em = exRe.exec(text))) add('排除' + em[2].replace(/^[:：\s]+/, '').replace(/[，,]\s*$/, '').replace(/(等)?(交易|消費|項目)?$/, ''), true);

    var fee = /(免收|需收取|加收|另收)[^。；\n]{0,6}?(\d+(?:\.\d+)?)\s*%[^。；\n]{0,4}?(國外交易)?(服務費|手續費)/.exec(text);
    if (fee) add(fee[1] + fee[2] + '%國外交易服務費', true, '手續費不算進 rate，只寫條件');
    var stack = /(可與[^。；\n]{2,30}?(疊加|併用|同時享有))/.exec(text);
    if (stack) add(stack[1]);
    var either = /((?:與|和)[^。；\n]{2,30}?擇[一優](?:回饋|參加|適用)?)/.exec(text);
    if (either) add(either[1]);
    if (opts.cap && opts.cap.rewardText) add(opts.cap.rewardText, false, '一般上限已由 cap 表達；想讓人看到週期才加');
    if (/認列為國外|視為國外(交易|消費)/.test(text)) add('認列為國外消費', false);
    return out;
  }

  function findUrls(text) {
    var re = /https?:\/\/[^\s<>"'）)」】，。]+/g, out = [], m;
    while ((m = re.exec(text))) if (out.indexOf(m[0]) < 0) out.push(m[0]);
    return out;
  }

  function normalizeLink(v) {
    var s = String(v == null ? '' : v).trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  function capFromReward(reward, ratePercent) {
    if (!reward || !ratePercent) return '';
    return trimNum(reward / (ratePercent / 100));
  }

  function matchExistingSlot(card, itemNames) {
    var keys = {};
    itemNames.forEach(function (n) { keys[termKey(n)] = true; });
    var best = null;
    ((card && card.cashbackRates) || []).forEach(function (r) {
      var hit = (r.items || []).filter(function (it) { return keys[termKey(it)]; }).length;
      if (hit && (!best || hit > best.hit)) best = { slot: r.slot, hit: hit, total: (r.items || []).length, rate: r.rate, category: r.category || '', model: r.cashbackModel || '', period: r.period || '' };
    });
    return best;
  }

  function guessCategory(card, text) {
    var cats = [];
    ((card && card.cashbackRates) || []).forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
    var compact = termKey(text);
    for (var i = 0; i < cats.length; i++) {
      var q = /[「『]([^」』]{2,12})[」』]/.exec(cats[i]);
      if (q && compact.indexOf(termKey(q[1])) >= 0) return { value: cats[i], why: '原文提到「' + q[1] + '」，沿用這張卡既有的分類', options: cats };
      if (cats[i].length >= 3 && compact.indexOf(termKey(cats[i])) >= 0) return { value: cats[i], why: '沿用這張卡既有的分類', options: cats };
    }
    var bracket = /[【\[]([^】\]\n]{2,18})[】\]]/.exec(text);
    if (bracket && !/注意|說明|期間|活動(辦法|內容|期間)/.test(bracket[1])) return { value: bracket[1].trim(), why: '取自原文的【】標題', options: cats };
    var first = (text.split('\n').filter(function (l) { return l.trim(); })[0] || '').trim();
    first = first.replace(/^[^\s，。：:]{0,14}?卡\s+/, '').replace(/^[\s\-｜|:：]+/, '');
    if (first && first.length <= 18 && !/[%\d]{3,}/.test(first)) return { value: first, why: '取自原文第一行', options: cats };
    return { value: '', why: '', options: cats };
  }

  // ===== 一般活動 =====
  // 回傳 { fields, notes:{欄位:{level:'ok'|'check'|'empty', text}}, chips, structure, existing }
  function parseActivity(index, cardId, rawText, extra) {
    var text = normalizeText(rawText);
    var card = getCard(index, cardId) || {};
    var notes = {};
    var note = function (f, level, t) { notes[f] = { level: level, text: t }; };

    var items = matchItems(index, text);
    var selected = items.filter(function (x) { return x.selected; }).map(function (x) { return x.name; });
    var overseas = /國外|海外|日本|韓國|外幣|日圓|日幣/.test(text) && !/國內/.test(text.slice(0, 60));
    var rates = findRates(text);
    var st = pickStructure(card, text, rates, overseas);
    var chosen = st.choice >= 0 ? st.options[st.choice] : null;
    var cap = findCaps(text);
    var minSpend = findMinSpend(text);
    var acc = findAccumulated(text);
    var period = parsePeriod(text);
    var conds = findConditions(text, { cap: cap, accumulated: acc });
    var urls = findUrls(text);
    var cat = guessCategory(card, text);

    var f = {};
    f.rate = chosen ? trimNum(chosen.rate) : '';
    f.cashbackModel = chosen ? chosen.model : '';
    if (!chosen) note('rate', 'empty', st.reason);
    else {
      note('rate', st.confident ? 'ok' : 'check', st.reason + (st.evidence ? '｜原文：' + st.evidence : ''));
      note('cashbackModel', st.confident ? 'ok' : 'check', '顯示合計 ' + chosen.total + '%（' + chosen.label + '）');
    }
    if (card.hasLevels) note('cashbackModel', 'check', '分級卡：若這檔活動的率隨級別變，rate／cap 要填 {rate}／{cap} 並改 levelSettings——這個工具不處理');

    if (cap.spend != null) { f.cap = trimNum(cap.spend); note('cap', 'ok', '官網直接給消費上限｜原文：' + cap.evidence); }
    else if (cap.reward != null) {
      f.cap = capFromReward(cap.reward, Number(f.rate));
      note('cap', f.cap ? 'check' : 'empty', f.cap
        ? '回饋上限 ' + cap.reward + ' ÷ ' + f.rate + '% ＝ ' + f.cap + '（消費上限）｜原文：' + cap.evidence
        : '回饋上限 ' + cap.reward + '，但 rate 是 0／空，算不出消費上限');
    } else { f.cap = ''; note('cap', 'empty', '原文沒寫上限（無上限就留空）'); }

    f.minSpend = minSpend.value != null ? trimNum(minSpend.value) : '';
    if (f.minSpend) note('minSpend', 'ok', '原文：' + minSpend.evidence);
    f.maxSpend = '';
    f.items = selected.join(',');
    if (!selected.length) note('items', 'empty', '沒比對到通路——請自己填（半形逗號分隔）');
    else if (items.some(function (x) { return x.selected && !x.known; })) note('items', 'check', '有資料裡沒出現過的新通路，請確認寫法');
    else note('items', 'ok', '都是資料裡已有的通路，已套用既有寫法');
    f.category = cat.value;
    if (cat.value) note('category', 'check', cat.why);
    f.conditions = normalizeConditions(conds.filter(function (c) { return c.on; }).map(function (c) { return c.text; }).join('；'));
    var linkFromText = urls.filter(function (u) { return /regist|登錄|signup|apply|event|activity/i.test(u); })[0] || '';
    f.registerLink = needsRegister(text) ? normalizeLink(linkFromText || (urls.length === 1 ? urls[0] : '')) : '';
    if (needsRegister(text) && !f.registerLink) note('registerLink', 'empty', '需登錄但原文沒有網址——有官方登錄頁就貼上（只收 https://）');
    else if (f.registerLink) note('registerLink', 'check', '確認這是登錄頁、不是活動說明頁');
    f.periodStart = period.start; f.periodEnd = period.end;
    if (period.end) note('periodEnd', 'ok', '原文：' + period.evidence);
    else note('periodEnd', 'empty', '找不到活動期間');

    return {
      kind: 'rate', fields: f, notes: notes,
      chips: { items: items, conditions: conds, category: cat.options, urls: urls,
        rates: rates.filter(function (r) { return r.kind !== 'fee'; }).map(function (r) { return r.value; }) },
      structure: st, capInfo: cap,
      existing: matchExistingSlot(card, selected),
      skipped: /折價券|優惠券|領券/.test(text) ? '原文提到領券／優惠券：領券型活動要寫 couponMerchant_N 那組，不是 rate_N' : ''
    };
  }

  // ===== 新戶活動 =====
  var CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

  function extractTasks(text) {
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var re = /^(?:[①②③④⑤⑥⑦⑧⑨⑩]|\(?\d{1,2}[.)、）]|（\d{1,2}）|[‧•●▪■◆✓✔]|任務\s*[一二三四五\d][:：]?|步驟\s*[一二三四五\d][:：]?|STEP\s*\d[:：]?)\s*(.+)$/i;
    var tasks = [];
    lines.forEach(function (l) {
      var m = re.exec(l);
      if (m && m[1].length >= 4 && m[1].length <= 90 && !/注意事項|保留.*權利|喪失|恕不/.test(m[1])) tasks.push(m[1].replace(/[。；;]+$/, ''));
    });
    return tasks.slice(0, 8);
  }

  function numbered(list) {
    if (!list.length) return '';
    if (list.length === 1) return list[0];
    return list.map(function (t, i) { return CIRCLED.charAt(i) + t; }).join('\n');
  }

  function sameCardPromos(index, cardId) {
    return ((index.data.newCardholderPromos) || []).filter(function (p) { return p.id === cardId; })
      .sort(function (a, b) { return String(b.period_start || '').localeCompare(String(a.period_start || '')); });
  }

  // 特定族群新戶：「保險新戶」「數位帳戶新戶」這種只看某一類交易的新戶，不是全行信用卡新戶
  // 回傳 { name:'保險新戶', definition:'原文定義（精簡過）' }；一般的「新戶定義：」回 null（沿用同卡現有寫法）
  function audienceOf(text) {
    var m = /([\u4e00-\u9fa5]{2,4})新戶(?:之|的)?定義\s*[:：]\s*([^\n。]+)/.exec(text);
    if (!m || /^(本行|本卡|信用卡|卡片|銀行|所稱|活動|以下)$/.test(m[1])) return null;
    return { name: m[1] + '新戶', definition: condenseDefinition(m[2]) };
  }

  // 新戶定義精簡成站長的寫法：去逗號、去句尾「者」、「未曾使用任一張X信用卡」→「未以任一X卡」
  function condenseDefinition(d) {
    return String(d || '').trim()
      .replace(/[，]\s*/g, '').replace(/者$/, '')
      .replace(/未曾?使用/g, '未以').replace(/任一張/g, '任一').replace(/信用卡(?!正卡|附卡)/g, '卡')
      .replace(/刷?累[積計]保費金額|刷?保費累[積計]金額/g, '累積金額');
  }

  function cardNameRe(card) {
    var parts = String((card && card.name) || '').split(/\s+/).filter(Boolean).map(function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    return parts.length ? new RegExp('(?:使用|持|以)?' + parts.join('\\s*') + '(?:信用卡)?[，,]?', 'i') : null;
  }

  // 條件草稿：本文沒有條列任務時，從本文挑「獎勵句／疊加句／領券或登錄／帳戶設定」四種句子拼成 ①②③
  // 回傳 { tasks:[], coupon:bool }；找不到獎勵句回 null（退回舊做法：抓全文的條列）
  function draftTasks(text, body, card, rates) {
    var lines = body.split('\n').map(function (l) { return l.replace(/^[\s\-–—‧•●▪■◆*※＊]+/, '').trim(); }).filter(Boolean);
    var bonusVals = rates.filter(function (r) { return r.kind === 'bonus'; }).map(function (r) { return r.value; });
    var hasRate = function (l, v) { return new RegExp('(^|[^\\d.])' + String(v).replace('.', '\\.') + '\\s*%').test(l); };
    var rewardLine = '';
    lines.forEach(function (l) {
      if (rewardLine || !/享|贈|回饋/.test(l) || /合計/.test(l)) return;
      if (bonusVals.some(function (v) { return hasRate(l, v); })) rewardLine = l;
    });
    if (!rewardLine) return null;
    var nameRe = cardNameRe(card);
    var t1 = rewardLine.split('。')[0]
      .replace(/^\d{2,4}\/\d{1,2}\/\d{1,2}\s*[-~]\s*(?:\d{2,4}\/)?\d{1,2}\/\d{1,2}\s*/, '');
    if (nameRe) t1 = t1.replace(nameRe, '');
    t1 = t1.replace(/[(（](?:回饋)?上限[^)）]*[)）]/g, '').replace(/[(（]信用卡[)）]/g, '')
      .replace(/[，,](?:回饋|加碼)?上限[^，。]*$/, '').replace(/([^%\d])(?:加碼)?回饋$/, '$1').replace(/[！!。\s]+$/, '');
    var tasks = [t1];

    // 疊加句：「搭配切換「假日刷」，原權益最高2%，合計最高回饋8%」→「搭配切換「假日刷」+2%」
    var stack = [], seen = {};
    lines.forEach(function (l) {
      if (!/合計/.test(l)) return;
      var head = l.split(/[，,]/)[0].replace(/[！!。\s]+$/, '');
      var pct = /(\d+(?:\.\d+)?)\s*%/.exec(l.slice(head.length));
      if (!pct || /%/.test(head) || seen[pct[1]]) return;
      seen[pct[1]] = true; stack.push(head + '+' + pct[1] + '%');
    });
    if (stack.length) tasks.push(stack.join('；'));

    var coupon = /領券|領取[^，。\n]{0,8}券/.test(text), q = quotaOf(text);
    if (coupon) tasks.push('需領券' + (q ? '，限量' + q.n + '張' : (/限量/.test(text) ? '，限量' : '')));
    else if (needsRegister(text)) tasks.push('需登錄' + (q ? '，限量' + q.n + q.unit : (/限量|額滿/.test(text) ? '，限量' : '')));

    var setup = /完成設定\s*([^。\n]{4,70})/.exec(text);
    if (setup) tasks.push(('完成設定' + setup[1]).replace(/【/g, '「').replace(/】/g, '」').replace(/者$/, ''));
    else if (/自動扣繳|自動轉帳扣繳/.test(text)) tasks.push('設定自動扣繳信用卡帳款');
    return { tasks: tasks, coupon: coupon };
  }

  function parsePromo(index, cardId, rawText, extra) {
    extra = extra || {};
    var text = normalizeText(rawText);
    var card = getCard(index, cardId) || {};
    var notes = {};
    var note = function (f, level, t) { notes[f] = { level: level, text: t }; };
    var prev = sameCardPromos(index, cardId);
    var f = {};
    PROMO_COLS.forEach(function (c) { f[c] = ''; });
    f.id = cardId || '';

    var rates = findRates(text).filter(function (r) { return r.kind !== 'fee'; });
    var period = parsePeriod(text);
    var urls = findUrls(text);
    var items = matchItems(index, text);

    // 定額：刷卡金／點數
    var usageWords = '(刷卡金|回饋金|現金回饋|購物金|LINE\\s*POINTS?|OPEN\\s*POINT|[A-Za-z\\u4e00-\\u9fa5]{0,6}e\\s*point|即享券|[\\u4e00-\\u9fa5]{0,4}點數?|[\\u4e00-\\u9fa5]{0,3}幣)';
    var v1 = new RegExp('(?:贈|送|享|得|回饋|加碼)[^。\\n\\d%]{0,10}?' + CUR + AMT + '\\s*(元|點)?\\s*(?:之|的|等值)?' + usageWords, 'i').exec(text);
    var v2 = new RegExp(usageWords + '\\s*' + CUR + AMT + '\\s*(元|點)', 'i').exec(text);
    var voucher = null;
    if (v1) voucher = { amount: parseAmount(v1[1], v1[2], v1[3]), usage: v1[5], ev: snippet(text, v1.index, v1[0].length) };
    else if (v2) voucher = { amount: parseAmount(v2[2], v2[3], v2[4]), usage: v2[1], ev: snippet(text, v2.index, v2[0].length) };
    var vm = v1 || v2;
    if (voucher && (/上限/.test(vm[0]) || /上限[^。\n\d]{0,6}$/.test(text.slice(0, vm.index)))) voucher = null;   // 「回饋上限 1,200 點」是上限，不是定額
    if (voucher) {
      var uk = termKey(voucher.usage);
      voucher.usage = index.usages[uk] || (/點數?$/.test(voucher.usage) && voucher.usage.length <= 2 ? '' : voucher.usage.replace(/\s+/g, ' ').trim());
      if (/回饋金|現金回饋/.test(voucher.usage)) voucher.usage = '刷卡金';
    }

    // 首刷禮
    var gift = /(?:贈|送|獲得|獲贈|可得)(?:送)?\s*[「『【]?([^，。；\n「」『』【】%]{3,40}?)(?:[」』】]|乙[個只台組份]|一[個只台組份]|，|。|；|\n|$)/.exec(text);
    var giftName = gift && !/^\s*[\d,]+\s*(元|點)|刷卡金|回饋金|點數|%/.test(gift[1])
      ? gift[1].replace(/[（(](?:市價|價值|建議售價|原價)[^）)]*[）)]?/g, '').replace(/[\s:：,，、]+$/, '').trim() : '';
    var inch = /(\d{2})\s*[吋寸]/.exec(text);
    var value = new RegExp('(?:市價|價值|建議售價|原價)[^\\d\\n]{0,8}' + CUR + AMT).exec(text);

    var types = [];
    if (giftName) types.push('首刷禮');
    if (rates.length) types.push('回饋加碼');
    if (voucher && voucher.amount) types.push('定額回饋');
    f.promo_types = types.join(',');
    note('promo_types', types.length ? 'check' : 'empty', types.length ? '依原文出現的獎勵種類判斷' : '判斷不出類型，請選');

    // 新戶定義：先抄同卡現有的
    var def = /([^。\n]{0,30}(?:未曾?持有|不曾持有|未持有)[^。\n]{0,40})/.exec(text);
    var audience = audienceOf(text);
    if (audience) {
      f.new_customer_definition = audience.definition;
      note('new_customer_definition', 'check', '原文有自己的「' + audience.name + '」定義（不是全行新戶），所以不沿用這張卡現有的新戶定義；已精簡，請順一下');
    } else if (prev.length && prev[0].new_customer_definition) {
      f.new_customer_definition = prev[0].new_customer_definition;
      note('new_customer_definition', def ? 'check' : 'ok', '沿用這張卡現有活動的寫法' + (def ? '｜這次原文：' + def[1].trim() : ''));
    } else if (def) { f.new_customer_definition = def[1].trim().replace(/^[（(:：\s]+/, ''); note('new_customer_definition', 'check', '摘自原文，請順一下'); }
    else note('new_customer_definition', 'empty', '原文沒寫新戶定義');

    // 條件：本文有條列就用條列；沒有就從本文挑句子拼草稿；注意事項的 (1)(2)(3) 是細則，最後才考慮
    var parts = splitBody(text);
    var tasks = extractTasks(parts.body), draft = null;
    if (!tasks.length) { draft = draftTasks(text, parts.body, card, rates); tasks = draft ? draft.tasks : extractTasks(text); }
    f.promo_condition = numbered(tasks);
    note('promo_condition', tasks.length ? 'check' : 'empty', !tasks.length ? '原文沒有條列的任務——請自己寫（兩項以上用①②③）'
      : (draft ? '原文沒有條列任務，這是從本文挑「獎勵／疊加／領券或登錄／帳戶設定」的句子拼的草稿，請順一下' : '依原文的條列整理，請精簡成最短講法'));

    f.period_start = period.start; f.period_end = period.end;
    note('period_end', period.end ? 'ok' : 'empty', period.end ? '原文：' + period.evidence : '找不到活動期間');

    var spend = new RegExp('(?:累[積計]|單筆|消費|刷卡)[^。\\n\\d]{0,10}?(?:滿|達)\\s*' + CUR + AMT).exec(text);
    if (spend) { f.min_spend = trimNum(parseAmount(spend[1], spend[2], spend[3])); note('min_spend', 'check', '原文：' + snippet(text, spend.index, spend[0].length)); }

    if (giftName) {
      f.gift_content = giftName; note('gift_content', 'check', '原文：' + snippet(text, gift.index, gift[0].length, 4));
      if (inch && /行李箱|登機箱|旅行箱/.test(text)) f.luggage_inch = inch[1];
      if (value) f.luggage_value = trimNum(parseAmount(value[1], value[2], value[3]));
    }
    if (rates.length) {
      var top = rates.reduce(function (a, b) { return b.value > a.value ? b : a; });
      // bonus_rate 只填「這檔活動自己加碼的部分」：最高 8% ＝ 加碼 6% ＋ 原權益 2% → 填 6%
      var uniq = rates.map(function (r) { return r.value; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var bonuses = rates.filter(function (r) { return r.kind === 'bonus' && r.value < top.value; });
      var comp = bonuses.length ? findComposition(top.value, uniq) : null;
      var own = top, split = '';
      if (comp) {
        var hit = bonuses.filter(function (b) { return comp.some(function (c) { return near(c, b.value); }); })[0];
        if (hit) { own = hit; split = '原文 ' + top.value + '% ＝ ' + comp.join('% ＋ ') + '%，其中這檔活動加碼的是 ' + hit.value + '%，其餘是原權益疊上去的'; }
      }
      f.bonus_rate = String(Math.round(own.value * 10000) / 1000000);
      note('bonus_rate', uniq.length > 1 ? 'check' : 'ok', split ? split + ' → 填小數 ' + f.bonus_rate
        : '原文 ' + own.value + '% → 填小數 ' + f.bonus_rate + (uniq.length > 1 ? '（原文有多個 %：' + uniq.join('、') + '）' : ''));
      // 通路：有具體商家就用商家（連同提到的支付工具）；沒有就用類別詞（保費、網購…）；再沒有才用支付工具
      // 付款方式（可用 Apple Pay 繳）與時段（假日）不是通路
      var cand = items.filter(function (x) { return !x.excluded && !x.weak && !/^(假日|平日|週末|周末|節假日)$/.test(x.name); });
      var specific = cand.filter(function (x) { return !x.generic && !x.payment; });
      var category = cand.filter(function (x) { return GENERIC_CATEGORY.test(x.name); });
      var pays = cand.filter(function (x) { return x.payment; });
      var sel = (specific.length ? cand.filter(function (x) { return !x.generic; }) : (category.length ? category : pays)).map(function (x) { return x.name; });
      f.bonus_merchants = sel.length ? sel.join(',') : (/一般消費|不限通路/.test(text) ? '*general' : '');
      if (!f.bonus_merchants) note('bonus_merchants', 'empty', '加碼適用哪些通路？不限通路填 *general');
      else if (!specific.length) note('bonus_merchants', 'check', category.length ? '原文沒有具體商家，用類別詞；支付工具與時段不算通路（要加就點下面的標籤）' : '只找到支付工具，確認它是通路而不是付款方式');
      var cap = findCaps(text);
      if (cap.spend != null) f.bonus_cap = trimNum(cap.spend);
      else if (cap.reward != null) {
        f.bonus_cap = capFromReward(cap.reward, own.value);
        note('bonus_cap', 'check', '回饋上限 ' + cap.reward + ' ÷ ' + own.value + '% ＝ ' + f.bonus_cap + '（消費上限）');
      }
    }
    if (voucher && voucher.amount) {
      f.voucher_amount = trimNum(voucher.amount); f.voucher_usage = voucher.usage || '';
      note('voucher_amount', 'check', '原文：' + voucher.ev);
    }

    // notes
    var n = [];
    // 領券／登錄已經寫進條件草稿就不重複；「登錄」要是參加條件才算（見 needsRegister）
    if (!draft) {
      var q = quotaOf(text);
      if (/領券/.test(text)) n.push('需領券' + (q ? '，限量' + q.n + '張' : (/限量/.test(text) ? '，限量' : '')));
      else if (needsRegister(text)) n.push(/限量|名額/.test(text) ? '需登錄，限量' : '需登錄');
    }
    var deadline = new RegExp('(?:限|須|需)?(?:於)?\\s*(\\d{2,4}\\s*[\\/.年]\\s*\\d{1,2}\\s*[\\/.月]\\s*\\d{1,2})\\s*日?\\s*\\(?含?\\)?\\s*前(?:完成)?核卡').exec(text);
    if (deadline) n.push('限於' + normalizeDate(deadline[1]) + '前核卡');
    // 只抄原文真的寫出來的那一句，抓不到就不寫（不自己編「與其他新戶活動擇一」）
    var mm = /(不[得可]與[^。\n；]{0,40}(?:並行|併用|同時[^。\n；]{0,6}|重複[^。\n；]{0,6}))/.exec(text) ||
      /((?:與|和)[^，。；\n]{2,30}?(?:僅可|只能|須|需)?擇[一優](?:適用|回饋|參加)?)/.exec(text);
    if (mm) n.push(mm[1]);
    f.notes = normalizeConditions(n.join('；'));

    f.link = normalizeLink(extra.url || urls[0] || '');
    if (!f.link) note('link', 'empty', '貼上活動頁網址');
    // priority 留空＝匯出時當 99（目前全表都是 99）；同卡現有活動填了別的數字才沿用
    f.priority = prev.length && prev[0].priority != null && Number(prev[0].priority) !== 99 ? String(prev[0].priority) : '';
    f.active = 'TRUE';
    var cta = (index.data.cardApplyCtas || {})[cardId];
    f.apply_cta_text = (cta && cta.text) || (card.name ? '申辦' + card.name : '');
    f.apply_cta_link = (cta && cta.link) || '';
    note('apply_cta_link', f.apply_cta_link ? 'ok' : 'empty', f.apply_cta_link ? '沿用這張卡現有的申辦連結' : '這張卡目前沒有申辦連結');

    // 摘要草稿：核卡後X天內＋最關鍵門檻＋獎勵
    var days = /核卡後\s*(\d+)\s*(天|日)內/.exec(text);
    var reward = giftName ? '贈' + (giftName.length > 14 && /行李箱|登機箱/.test(giftName) ? '行李箱' : giftName)
      : (voucher && voucher.amount ? '享' + voucher.amount + (voucher.usage === '刷卡金' ? '元刷卡金' : (voucher.usage ? '點' + voucher.usage : '元回饋'))
        : (rates.length ? (function (t) { return '享' + (t.kind === 'max' ? '最高' : '') + t.value + '%' + (t.kind === 'max' ? '' : '回饋'); })(rates.reduce(function (a, b) { return b.value > a.value ? b : a; })) : ''));
    var firstBuy = /首筆([\u4e00-\u9fa5]{2,4}?)(?=[，,、。\s一享刷]|$)/.exec(text);
    if (reward && audience && !giftName && !(voucher && voucher.amount)) {
      // 特定族群新戶：「誰＋做什麼，符合條件享最高X%」（標榜的合計數字放摘要，bonus_rate 才是加碼的部分）
      f.new_customer_summary = audience.name + (firstBuy ? '刷首筆' + firstBuy[1] : '') + '，符合條件' + reward;
      note('new_customer_summary', 'check', '程式拼的草稿——請順成一句話');
    } else if (reward) {
      f.new_customer_summary = (days ? '核卡後' + days[1] + days[2] + '內' : '') +
        (f.min_spend ? (days ? '，' : '') + '消費滿NT$' + Number(f.min_spend).toLocaleString('en-US') + '元' : (days ? '符合條件' : '符合條件')) + '，' + reward;
      note('new_customer_summary', 'check', '程式拼的草稿——請順成一句話');
    } else note('new_customer_summary', 'empty', '請寫一句話：核卡後X天內＋最關鍵門檻＋獎勵');

    return { kind: 'promo', fields: f, notes: notes,
      chips: { items: items, urls: urls, types: PROMO_TYPES, usages: Object.keys(index.usages).map(function (k) { return index.usages[k]; }) },
      previous: prev.slice(0, 3) };
  }

  // ===== 輸出一列 =====
  // 期間與剩餘天數的公式：用 ADDRESS(ROW(),COLUMN()-n) 取同列左邊的格子，貼在哪一欄都成立；
  // 刻意不含任何引號，避免貼上時被當成「帶引號的儲存格」解析錯
  var FORMULA_DAYS = '=LET(e,INDIRECT(ADDRESS(ROW(),COLUMN()-1)),IF(ISBLANK(e),,e-TODAY()))';
  var FORMULA_PERIOD = '=LET(s,INDIRECT(ADDRESS(ROW(),COLUMN()-3)),e,INDIRECT(ADDRESS(ROW(),COLUMN()-2)),' +
    'IF(ISBLANK(e),,IF(ISBLANK(s),,YEAR(s)&CHAR(47)&MONTH(s)&CHAR(47)&DAY(s))&CHAR(126)&YEAR(e)&CHAR(47)&MONTH(e)&CHAR(47)&DAY(e)))';

  function daysBetween(dateStr, today) {
    var m = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(dateStr || '');
    if (!m) return '';
    var end = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var t = today || new Date();
    return String(Math.round((end - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000));
  }

  // derivedMode：'formula'（預設）｜'value'｜'blank'
  // 欄號 ↔ 欄名（A=1 … Z=26, AA=27）
  function colToNum(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64); return n; }
  function numToCol(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
  // 「rate 那格的位置」（如 CB15）→ 站長試算表原本的公式寫法；沒給或看不懂就回 null
  function sheetFormulas(anchor) {
    var m = /^\s*\$?([A-Za-z]{1,3})\$?(\d{1,5})\s*$/.exec(String(anchor || ''));
    if (!m) return null;
    var base = colToNum(m[1].toUpperCase()), row = m[2];
    var s = numToCol(base + RATE_COLS.indexOf('periodStart')) + row, e = numToCol(base + RATE_COLS.indexOf('periodEnd')) + row;
    return {
      days: '=IF(ISBLANK(' + e + '),"",' + e + '-TODAY())',
      period: '=IF(OR(ISBLANK(' + s + '),ISBLANK(' + e + ')),"",TEXT(' + s + ',"yyyy/m/d")&"~"&TEXT(' + e + ',"yyyy/m/d"))'
    };
  }

  function buildRateRow(fields, derivedMode, today, anchor) {
    var f = fields || {};
    var row = RATE_COLS.map(function (c) { return f[c] == null ? '' : String(f[c]); });
    var iDays = RATE_COLS.indexOf('daysRemaining'), iPeriod = RATE_COLS.indexOf('period');
    if (derivedMode === 'blank') { row[iDays] = ''; row[iPeriod] = ''; }
    else if (derivedMode === 'value') {
      row[iDays] = daysBetween(f.periodEnd, today);
      row[iPeriod] = (f.periodStart || f.periodEnd) ? (f.periodStart || '') + '~' + (f.periodEnd || '') : '';
    } else {
      var own = sheetFormulas(anchor);
      row[iDays] = { formula: own ? own.days : FORMULA_DAYS }; row[iPeriod] = { formula: own ? own.period : FORMULA_PERIOD };
    }
    return row;
  }

  function buildPromoRow(fields) {
    var f = fields || {};
    return PROMO_COLS.map(function (c) { return f[c] == null ? '' : String(f[c]); });
  }

  // 一格 → TSV：公式照貼；文字若以 = + 開頭，前面加單引號避免被試算表當成公式；
  // 含換行／Tab／引號的格子用雙引號包起來（試算表自己複製出來也是這個格式）
  function tsvCell(v) {
    if (v && typeof v === 'object' && v.formula) return v.formula;
    var s = String(v == null ? '' : v).replace(/\r\n?/g, '\n');
    if (/^[=+]/.test(s)) s = "'" + s;
    if (/[\n\t"]/.test(s)) s = '"' + s.replace(/\t/g, ' ').replace(/"/g, '""') + '"';
    return s;
  }

  function toTsv(rows) {
    return rows.map(function (r) { return r.map(tsvCell).join('\t'); }).join('\n');
  }

  // 寫入前的檢查（對應 cards-export.gs 的 pmcValidateCardRow_／pmcValidatePromoRow_ 最常擋的幾條）
  function validate(kind, f) {
    var issues = [];
    var isNum = function (v) { return v === '' || v == null || /^-?\d+(\.\d+)?$/.test(String(v).trim()) || /^\{[a-zA-Z_0-9]+\}$/.test(String(v).trim()); };
    var isDate = function (v) { return v === '' || v == null || !!normalizeDate(v); };
    var isUrl = function (v) { return v === '' || v == null || /^https?:\/\//i.test(String(v).trim()); };
    var ts = function (v) { var m = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(normalizeDate(v) || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
    if (kind === 'rate') {
      if (f.rate === '' || f.rate == null) issues.push('rate 是空的');
      ['rate', 'cap', 'minSpend', 'maxSpend'].forEach(function (c) { if (!isNum(f[c])) issues.push(c + '「' + f[c] + '」不是數字（不要逗號、%、元）'); });
      if (!String(f.items || '').trim()) issues.push('items 是空的——沒有通路就搜不到');
      if (/[，、]/.test(String(f.items || '').replace(/[(（][^)）]*[)）]/g, ''))) issues.push('items 要用半形逗號分隔（現在有全形逗號或頓號）');
      if (!isUrl(f.registerLink)) issues.push('registerLink 只收 https:// 網址');
      if (!isDate(f.periodStart)) issues.push('periodStart 不是日期');
      if (!isDate(f.periodEnd)) issues.push('periodEnd 不是日期');
      if (ts(f.periodStart) && ts(f.periodEnd) && ts(f.periodEnd) < ts(f.periodStart)) issues.push('結束日早於開始日');
      if (f.cashbackModel && !/^(rate|basic|overseasCashback|overseasBonusRate|domesticBonusRate|rate_\d+)([+>](rate|basic|overseasCashback|overseasBonusRate|domesticBonusRate|rate_\d+))*$/.test(f.cashbackModel)) issues.push('cashbackModel「' + f.cashbackModel + '」不是認得的寫法');
      if (Number(f.minSpend) && Number(f.maxSpend) && Number(f.maxSpend) <= Number(f.minSpend)) issues.push('maxSpend 要大於 minSpend');
    } else {
      if (!f.id) issues.push('id 是空的（先選卡片）');
      var types = String(f.promo_types || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      if (!types.length) issues.push('promo_types 是空的');
      types.forEach(function (t) { if (PROMO_TYPES.indexOf(t) < 0) issues.push('promo_types「' + t + '」不是 ' + PROMO_TYPES.join('／')); });
      if (!String(f.new_customer_summary || '').trim()) issues.push('new_customer_summary 是空的');
      ['period_start', 'period_end'].forEach(function (c) { if (!isDate(f[c])) issues.push(c + ' 不是日期'); });
      if (ts(f.period_start) && ts(f.period_end) && ts(f.period_end) < ts(f.period_start)) issues.push('結束日早於開始日');
      ['min_spend', 'luggage_inch', 'luggage_value', 'bonus_rate', 'bonus_cap', 'voucher_amount', 'priority'].forEach(function (c) { if (!isNum(f[c])) issues.push(c + '「' + f[c] + '」不是數字'); });
      if (f.bonus_rate !== '' && Number(f.bonus_rate) >= 1) issues.push('bonus_rate 要填小數（10% → 0.1），現在是 ' + f.bonus_rate);
      ['link', 'gift_image_url', 'apply_cta_link'].forEach(function (c) { if (!isUrl(f[c])) issues.push(c + ' 不是 https:// 網址'); });
      ['new_customer_summary', 'promo_condition', 'notes', 'new_customer_definition'].forEach(function (c) { if (/。\s*$/.test(String(f[c] || ''))) issues.push(c + ' 結尾不要句號'); });
    }
    return issues;
  }

  // ===== AI 提示詞 =====
  // 規則是 apps-script 兩支解析器 prompt 的精簡版；AI 只抽事實，cap 換算與 cashbackModel 由程式決定。
  function cardContext(index, card) {
    var lines = ['【這張卡】' + card.id + '｜' + card.name,
      '基本回饋 ' + card.basicCashback + '%' + (card.overseasCashback ? '、海外基本 ' + card.overseasCashback + '%' : '') +
      (card.domesticBonusRate ? '、國內加碼 ' + card.domesticBonusRate + '%' : '') + (card.overseasBonusRate ? '、海外加碼 ' + card.overseasBonusRate + '%' : ''),
      '既有活動（槽位｜率｜分類｜通路）：'];
    (card.cashbackRates || []).slice(0, 30).forEach(function (r) {
      lines.push('  rate_' + r.slot + '｜' + r.rate + '｜' + (r.category || '') + '｜' + (r.items || []).slice(0, 8).join(','));
    });
    return lines.join('\n');
  }

  function buildAiRequest(index, kind, cardId, rawText) {
    var card = getCard(index, cardId) || { id: cardId, name: cardId };
    var text = normalizeText(rawText).slice(0, 30000);
    var known = matchItems(index, text).filter(function (x) { return x.known; }).map(function (x) { return x.name; });
    var common = [
      'A. 只抽文字中明確寫出的資訊，絕不假設或腦補；找不到的欄位省略。',
      'B. 所有文字欄位不要以句號結尾。日期格式 YYYY/M/D（民國年請換成西元）。',
      'C. 通路名稱若出現在「既有寫法」清單裡，一律用清單的寫法：' + (known.length ? known.join('、') : '（無）')
    ];
    var system, schema;
    if (kind === 'rate') {
      system = [
        '你是台灣信用卡權益的資料分析師。站長貼了一段「已上線卡片」的活動原文，請抽出這檔活動，輸出結構化 JSON。',
        '只抽這段文字寫到的活動；新戶／核卡限定、領券型、定額（滿X送Y元）、折扣型都不要輸出，並在 note 說明原因。',
        '不同回饋率、不同門檻級距各自成一組（groups 的一個元素）。',
        ''
      ].concat(common, [
        '1. headline_rate：官網標榜的回饋率「百分比數字」（5% → 5）。免收／回饋國外交易服務費不算回饋，不可加進來。',
        '2. bonus_rate：這檔活動「自己加碼的部分」的百分比數字——官網有拆解（最高3%＝原0.5%＋加碼2.5%）才填，沒拆解就省略。',
        '3. includes_basic：headline_rate 是否已包含卡片原本的基本回饋——「是」「否」「不確定」。原文明寫「含原回饋」「合計」→是；明寫「不併計」「不列入一般消費」→否；沒講→不確定。',
        '4. group_kind：指定通路加碼／國外指定加碼／排除型／其他。is_stacked：是否疊在另一檔活動之上才成立。',
        '5. items：使用者會搜尋的「實際商家名」，一家一個元素；分類標題（指定超商、蔬食餐廳）寫進 category、不進 items。',
        '   去掉贅字後綴（官方APP、官方網站、之充電費用）。限定在某國消費而該品牌台灣也有時加國家前綴（日本UNIQLO）。',
        '6. conditions：用全形分號「；」分隔、精簡到剩動作本身（「需登錄」「申辦電子帳單及自動扣繳」「排除分期」「限綁定LINE Pay」）。',
        '   不要寫：單筆滿額門檻（放 min_spend）、一般的回饋上限（放 cap）、免責罰則樣板。累積消費門檻、登錄限量名額、國外交易服務費要寫。',
        '7. min_spend：單筆最低消費門檻；max_spend：級距的排他上界（下一級的下界）。',
        '8. cap_spend：官網直接講的消費上限；cap_reward：回饋金額上限（兩者擇一，原始數字，不要換算）。',
        '9. register_link：只填官網給的 https:// 登錄頁網址，沒有就省略。',
        '10. structure_note：官網把「最高X%」拆成各成分的那句話，逐字照抄；沒有就自己寫一句。evidence：支撐率／上限／期間的原文句子。',
        '11. 不確定就 needs_review=true，問題寫進 review_question。',
        '',
        cardContext(index, card)
      ]).join('\n');
      schema = { type: 'OBJECT', properties: {
        groups: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
          headline_rate: { type: 'NUMBER' }, bonus_rate: { type: 'NUMBER' },
          includes_basic: { type: 'STRING', enum: ['是', '否', '不確定'] },
          group_kind: { type: 'STRING', enum: ['指定通路加碼', '國外指定加碼', '排除型', '其他'] },
          is_stacked: { type: 'BOOLEAN' }, items: { type: 'ARRAY', items: { type: 'STRING' } },
          category: { type: 'STRING' }, conditions: { type: 'STRING' },
          min_spend: { type: 'NUMBER' }, max_spend: { type: 'NUMBER' }, cap_spend: { type: 'NUMBER' }, cap_reward: { type: 'NUMBER' },
          register_link: { type: 'STRING' }, period_start: { type: 'STRING' }, period_end: { type: 'STRING' },
          structure_note: { type: 'STRING' }, evidence: { type: 'STRING' },
          needs_review: { type: 'BOOLEAN' }, review_question: { type: 'STRING' }
        }, required: ['headline_rate', 'items', 'includes_basic', 'evidence', 'needs_review'] } },
        note: { type: 'STRING' }
      }, required: ['groups'] };
    } else {
      var prev = sameCardPromos(index, cardId).slice(0, 2);
      system = [
        '你是台灣信用卡「新戶活動」的資料分析師。站長貼了一段活動原文，請抽出其中的新戶／核卡相關活動，輸出結構化 JSON。',
        '每個獨立活動（不同條件、不同期限）一個物件；同一活動有多種獎勵時放在同一物件的 promo_types。',
        ''
      ].concat(common, [
        '1. promo_types 只能選：首刷禮（實體或虛擬禮品）、回饋加碼（特定消費有額外百分比回饋）、定額回饋（固定金額的點數或刷卡金）。',
        '2. new_customer_definition：官網對「新戶」的定義，一句話；沒寫就省略。活動若針對特定族群（保險新戶、數位帳戶新戶…），抄那個族群的定義，不要寫成全行信用卡新戶。',
        '3. promo_condition：為了拿到獎勵必須完成的任務。兩項以上用①②③編號、一項一行（約25字內）；只有一項不編號。',
        '   寫法精簡：「新增N筆一般消費且每筆金額均滿NT$X」→「新增N筆NT$X元(含)以上的一般消費」。',
        '4. new_customer_summary：一句話「核卡後X天內＋最關鍵門檻＋獎勵」，不要把每個條件都塞進來。',
        '5. min_spend：最關鍵的消費門檻金額（原始數字）。',
        '6. gift_content：首刷禮的實際品名（多選一用①②③分行）。行李箱另填 luggage_inch（吋數）、luggage_value（官網寫的市價）。',
        '   bonus_rate_percent 只填這檔活動「自己加碼」的百分比：最高8%＝加碼6%＋原權益2% → 填 6（合計數字寫在 summary）。',
        '7. bonus_rate_percent、bonus_cap_reward（加碼的回饋金額上限）、bonus_cap_spend（官網直接講的消費上限）、voucher_amount 只填原始數字，不要換算。',
        '8. bonus_merchants：加碼適用通路；一般消費都算填 *general；其餘逐一列通路名稱；沒有具體商家就填類別（保費、網購）。',
        '   可用的付款方式（Apple Pay…）、不適用的支付工具、時段（假日）都不是通路，不要列。',
        '9. voucher_usage：定額回饋的形式（刷卡金、LINE POINTS、玉山e point…）。',
        '   「領券」與「登錄」是兩件事，原文寫哪個就寫哪個；原文沒寫的限制（例如與其他活動擇一）不要自己加。',
        '10. notes：「非任務」的重要限制，用全形分號「；」分隔：回饋結構拆解、核卡期限、不可與其他活動並行、排除條款、發放規則與名額。',
        '    已寫進 promo_condition 的不要重複；喪失資格、銀行保留權利這類通用樣板不要寫。',
        '11. pick_question／pick_reason：給想辦卡的人看的一句鉤子與一句理由（例：「小額就想拿回饋？」／「刷滿 NT$600 就拿 NT$300，換算回饋率約 50%。」）。只用原文有的數字。',
        '12. evidence：逐字引用支撐回饋率／上限／期間的原文。不確定就 needs_review=true 並寫 review_question。',
        '',
        '【這張卡】' + card.id + '｜' + card.name
      ], prev.length ? ['【這張卡現有活動的寫法，供語氣參考】'].concat(prev.map(function (p) {
        return '  summary=' + p.new_customer_summary + '｜condition=' + String(p.promo_condition || '').replace(/\n/g, ' ') + '｜notes=' + (p.notes || '');
      })) : []).join('\n');
      schema = { type: 'OBJECT', properties: {
        promos: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
          promo_types: { type: 'ARRAY', items: { type: 'STRING', enum: PROMO_TYPES } },
          new_customer_definition: { type: 'STRING' }, new_customer_summary: { type: 'STRING' }, promo_condition: { type: 'STRING' },
          period_start: { type: 'STRING' }, period_end: { type: 'STRING' }, min_spend: { type: 'NUMBER' },
          gift_content: { type: 'STRING' }, luggage_inch: { type: 'NUMBER' }, luggage_value: { type: 'NUMBER' },
          bonus_rate_percent: { type: 'NUMBER' }, bonus_merchants: { type: 'ARRAY', items: { type: 'STRING' } },
          bonus_cap_reward: { type: 'NUMBER' }, bonus_cap_spend: { type: 'NUMBER' },
          voucher_amount: { type: 'NUMBER' }, voucher_usage: { type: 'STRING' }, notes: { type: 'STRING' },
          pick_question: { type: 'STRING' }, pick_reason: { type: 'STRING' },
          evidence: { type: 'STRING' }, needs_review: { type: 'BOOLEAN' }, review_question: { type: 'STRING' }
        }, required: ['promo_types', 'new_customer_summary', 'evidence', 'needs_review'] } },
        note: { type: 'STRING' }
      }, required: ['promos'] };
    }
    return { system: system, user: '以下是信用卡官網文字：\n\n' + text, schema: schema };
  }

  function unifyItems(index, list) {
    var seen = {}, out = [];
    (list || []).forEach(function (raw) {
      var name = String(raw == null ? '' : raw).trim();
      if (!name) return;
      var canon = name.charAt(0) === '*' ? name : (index.vocab[termKey(name)] || name);
      var k = termKey(canon);
      if (!seen[k]) { seen[k] = true; out.push(canon); }
    });
    return out;
  }

  var noPeriod = function (s) { return String(s == null ? '' : s).replace(/[。\s]+$/, '').trim(); };

  // AI 的一組 → 與規則解析同形狀的結果（base＝同一段文字的規則解析結果，拿它的 chips 與比對）
  function applyAiActivity(index, cardId, g, base) {
    var card = getCard(index, cardId) || {};
    var notes = {};
    var note = function (f, level, t) { notes[f] = { level: level, text: t }; };
    var overseas = g.group_kind === '國外指定加碼';
    var headline = Number(g.headline_rate) || 0;
    var options = structureOptions(card, headline, overseas);
    var find = function (model) { for (var i = 0; i < options.length; i++) if (options[i].model === model) return i; return -1; };
    var choice, confident = false, reason;
    if (g.is_stacked) { choice = -1; options.forEach(function (o, i) { if (choice < 0 && /^rate\+rate_\d+$/.test(o.model)) choice = i; }); reason = 'AI 判斷這組疊在別的活動之上——請確認疊在哪一槽'; if (choice < 0) choice = find(''); }
    else if (g.group_kind === '排除型' || g.includes_basic === '否') { choice = find('rate'); confident = g.includes_basic === '否'; reason = 'AI 判斷不與基本回饋併計 → rate 填完整率'; }
    else if (g.includes_basic === '是') {
      choice = find(overseas && card.overseasCashback ? 'rate+overseasCashback' : 'rate+basic'); confident = !overseas;
      reason = 'AI 判斷 ' + headline + '% 已含基本回饋';
      if (g.bonus_rate && choice >= 0 && !near(options[choice].rate, g.bonus_rate)) {
        var alt = -1; options.forEach(function (o, i) { if (alt < 0 && near(o.rate, g.bonus_rate)) alt = i; });
        if (alt >= 0) choice = alt; else { confident = false; reason += '，但原文的加碼 ' + g.bonus_rate + '% 與 ' + headline + '−基本 對不起來，請確認'; }
      }
    } else { choice = find(overseas && card.overseasCashback ? 'rate+overseasCashback' : 'rate+basic'); reason = '原文沒說 ' + headline + '% 是否含基本回饋——先假設已含，請確認'; }
    if (choice < 0) choice = 0;
    var chosen = options[choice] || { rate: headline, model: '', total: headline, label: '' };
    var f = {};
    f.rate = trimNum(chosen.rate); f.cashbackModel = chosen.model;
    note('rate', confident ? 'ok' : 'check', reason + (g.structure_note ? '｜回饋組成：' + g.structure_note : ''));
    note('cashbackModel', confident ? 'ok' : 'check', '顯示合計 ' + chosen.total + '%（' + chosen.label + '）');
    var capInfo = { spend: g.cap_spend || null, reward: g.cap_reward || null };
    if (g.cap_spend) { f.cap = trimNum(g.cap_spend); note('cap', 'ok', '官網直接給消費上限'); }
    else if (g.cap_reward) { f.cap = capFromReward(g.cap_reward, Number(f.rate)); note('cap', 'check', '回饋上限 ' + g.cap_reward + ' ÷ ' + f.rate + '% ＝ ' + f.cap); }
    else f.cap = '';
    if (f.cap && g.max_spend && Number(f.cap) > g.max_spend - 1) { f.cap = trimNum(g.max_spend - 1); note('cap', 'check', '級距組：cap 取 maxSpend − 1'); }
    f.minSpend = g.min_spend ? trimNum(g.min_spend) : ''; f.maxSpend = g.max_spend ? trimNum(g.max_spend) : '';
    var items = unifyItems(index, g.items);
    f.items = items.join(',');
    var fresh = items.filter(function (n) { return !index.vocab[termKey(n)]; });
    note('items', !items.length ? 'empty' : (fresh.length ? 'check' : 'ok'), !items.length ? 'AI 沒抽到通路' : (fresh.length ? '新通路（資料裡沒出現過）：' + fresh.join('、') : '都是資料裡已有的通路'));
    f.category = noPeriod(g.category);
    f.conditions = normalizeConditions(g.conditions);
    f.registerLink = normalizeLink(g.register_link);
    f.periodStart = normalizeDate(g.period_start); f.periodEnd = normalizeDate(g.period_end);
    if (!f.periodEnd) note('periodEnd', 'empty', 'AI 沒抽到結束日');
    if (g.needs_review) note('conditions', 'check', 'AI 想問：' + (g.review_question || '（沒寫問題）'));
    var chips = base ? base.chips : { items: [], conditions: [], category: [], urls: [], rates: [] };
    return { kind: 'rate', fields: f, notes: notes, chips: chips, viaAi: true, evidence: g.evidence || '',
      structure: { headline: headline, options: options, choice: choice, confident: confident, reason: reason },
      capInfo: capInfo, existing: matchExistingSlot(card, items), skipped: '' };
  }

  function applyAiPromo(index, cardId, p, base) {
    var f = {};
    PROMO_COLS.forEach(function (c) { f[c] = base ? base.fields[c] : ''; });
    var notes = {};
    var note = function (k, level, t) { notes[k] = { level: level, text: t }; };
    if (base) ['new_customer_definition', 'apply_cta_link', 'link'].forEach(function (k) { if (base.notes[k]) notes[k] = base.notes[k]; });
    f.id = cardId;
    f.promo_types = (p.promo_types || []).filter(function (t) { return PROMO_TYPES.indexOf(t) >= 0; }).join(',');
    if (p.new_customer_definition && !(base && base.fields.new_customer_definition)) f.new_customer_definition = noPeriod(p.new_customer_definition);
    f.new_customer_summary = noPeriod(p.new_customer_summary);
    f.promo_condition = noPeriod(p.promo_condition);
    f.period_start = normalizeDate(p.period_start); f.period_end = normalizeDate(p.period_end);
    f.min_spend = p.min_spend ? trimNum(p.min_spend) : '';
    f.gift_content = noPeriod(p.gift_content);
    f.luggage_inch = p.luggage_inch ? trimNum(p.luggage_inch) : '';
    f.luggage_value = p.luggage_value ? trimNum(p.luggage_value) : '';
    f.bonus_rate = p.bonus_rate_percent ? String(Math.round(p.bonus_rate_percent * 10000) / 1000000) : '';
    f.bonus_merchants = unifyItems(index, p.bonus_merchants).join(',');
    f.bonus_cap = p.bonus_cap_spend ? trimNum(p.bonus_cap_spend) : (p.bonus_cap_reward && p.bonus_rate_percent ? capFromReward(p.bonus_cap_reward, p.bonus_rate_percent) : '');
    if (!p.bonus_cap_spend && p.bonus_cap_reward) note('bonus_cap', 'check', '回饋上限 ' + p.bonus_cap_reward + ' ÷ ' + p.bonus_rate_percent + '% ＝ ' + f.bonus_cap + '（消費上限）');
    f.voucher_amount = p.voucher_amount ? trimNum(p.voucher_amount) : '';
    f.voucher_usage = p.voucher_usage ? (index.usages[termKey(p.voucher_usage)] || p.voucher_usage) : '';
    f.notes = normalizeConditions(p.notes);
    f.pick_question = noPeriod(p.pick_question); f.pick_reason = String(p.pick_reason || '').trim();
    if (f.pick_question) note('pick_question', 'check', 'AI 草擬，請改成你的語氣');
    if (p.needs_review) note('notes', 'check', 'AI 想問：' + (p.review_question || '（沒寫問題）'));
    return { kind: 'promo', fields: f, notes: notes, chips: base ? base.chips : { items: [], urls: [], types: PROMO_TYPES, usages: [] },
      previous: base ? base.previous : [], viaAi: true, evidence: p.evidence || '' };
  }

  return {
    RATE_COLS: RATE_COLS, PROMO_COLS: PROMO_COLS, PROMO_TYPES: PROMO_TYPES,
    normalizeText: normalizeText, normalizeDate: normalizeDate, normalizeConditions: normalizeConditions, termKey: termKey,
    buildIndex: buildIndex, getCard: getCard, detectCard: detectCard, detectKind: detectKind,
    parsePeriod: parsePeriod, findRates: findRates, structureOptions: structureOptions, findCaps: findCaps,
    matchItems: matchItems, findConditions: findConditions, capFromReward: capFromReward,
    parseActivity: parseActivity, parsePromo: parsePromo,
    buildRateRow: buildRateRow, sheetFormulas: sheetFormulas, buildPromoRow: buildPromoRow, toTsv: toTsv, validate: validate,
    buildAiRequest: buildAiRequest, applyAiActivity: applyAiActivity, applyAiPromo: applyAiPromo, unifyItems: unifyItems
  };
});
