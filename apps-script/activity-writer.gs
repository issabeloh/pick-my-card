// ==========================================
// 活動快寫（貼活動原文 → 解析 → 直接寫進試算表，2026-11-13 搬進試算表）
// ==========================================
//
// 住在「PMC 管理系統」試算表（跟 cards-export.gs、card-editor.gs、promo-editor.gs 同一個 Apps Script 專案），
// 搭配同專案的 ActivityWriter.html。
//
// ⚠️ ActivityWriter.html 是**生成檔**：來源是 tools/activity-writer/ 的 index.html＋parser.js＋app.js，
//    由 `node tools/activity-writer/build-apps-script.js` 產生，不要手改（preflight 會擋不一致）。
// ⚠️ 這兩個檔走 GitHub 自動部署（apps-script/deploy.json 的「PMC 管理系統」只列這兩支；
//    cards-export.gs 等仍然手動貼）。不要在網頁編輯器直接改，會被下一次部署擋下。
//
// 這支只做四件事，寫入全部交給既有的兩個編輯器（同一套衝突偵測與存檔前檢查）：
//   activityWriterInit      讀表上現況，組成解析器要的資料（卡片、槽位、新戶活動、通路詞庫）
//   activityWriterSaveRate  一般活動／領券活動 → cardEditorSave（寫進指定的 rate_N 或 couponMerchant_N 那一組欄位）
//   activityWriterSavePromo 新戶活動 → promoEditorSave（插在同卡最後一列下面）
//   activityWriterAi        選用的 AI 重新解析（Gemini；金鑰放指令碼屬性 GEMINI_API_KEY）
//
// 依賴：cards-export.gs（getValue、maxSlotIndex、readNewCardholderPromos、pmcIsTrueCell_、SITE_ORIGIN）、
//   card-editor.gs（cardEditorLoad、cardEditorSave）、promo-editor.gs（promoEditorLoad、promoEditorSave）。

const AW_DIALOG_WIDTH_ = 1240;
const AW_DIALOG_HEIGHT_ = 700;
// 一組回饋槽裡這支會寫的欄位（daysRemaining／period 是公式欄，另外處理）
const AW_RATE_FIELDS_ = ['rate', 'cashbackModel', 'cap', 'minSpend', 'maxSpend', 'items', 'category', 'conditions',
  'registerLink', 'periodStart', 'periodEnd'];
// 領券槽（couponPeriod_N 是公式欄，另外處理）
const AW_COUPON_FIELDS_ = ['couponMerchant', 'couponRate', 'couponCap', 'couponConditions', 'couponPeriodStart', 'couponPeriodEnd'];
// 骨幹槽（cashbackmodel-fill-guide.md 第 4 節）：不當成「第一個空槽」的候選
const AW_RESERVED_SLOTS_ = [14, 21, 22];
const AW_DEFAULT_MODELS_ = 'gemini-3.8-flash,gemini-3.6-flash,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite';

// ---------- 選單入口 ----------
function openActivityWriter() {
  const html = HtmlService.createHtmlOutputFromFile('ActivityWriter')
    .setWidth(AW_DIALOG_WIDTH_).setHeight(AW_DIALOG_HEIGHT_);
  SpreadsheetApp.getUi().showModelessDialog(html, '✍️ 活動快寫');
}

// ---------- 給視窗呼叫的函式（一律回 JSON 字串：日期等型別經 google.script.run 會整包變 null） ----------

function activityWriterInit() {
  const promos = readNewCardholderPromos();
  const vocab = awSiteVocab_();
  return JSON.stringify({
    cards: awReadCards_(),
    newCardholderPromos: promos.newCardholderPromos,
    cardApplyCtas: promos.cardApplyCtas,
    quickSearchOptions: vocab.quickSearchOptions || [],
    termAliases: vocab.termAliases || [],
    payments: vocab.payments || [],
    lastUpdated: '試算表現況',
    host: { reservedSlots: AW_RESERVED_SLOTS_, vocabNote: vocab.note || '',
      hasAiKey: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') }
  });
}

// payload（JSON 字串）= { id, group:'rate'|'coupon', slot, fields:{ rate, cashbackModel, … }, overwrite }
function activityWriterSaveRate(payloadJson) {
  const p = JSON.parse(payloadJson);
  const slot = parseInt(p.slot, 10);
  const coupon = p.group === 'coupon';
  const FIELDS = coupon ? AW_COUPON_FIELDS_ : AW_RATE_FIELDS_;
  const label = (coupon ? 'couponMerchant_' : 'rate_') + slot;
  const card = cardEditorLoad(p.id);
  const info = (coupon ? card.couponSlots : card.rateSlots).filter(function(s) { return s.n === slot; })[0];
  if (!info) return JSON.stringify({ ok: false, message: '表上沒有 ' + label + ' 這一組欄位' });
  const cur = function(f) { return card.fields[f + '_' + slot]; };
  const filled = FIELDS.some(function(f) { return cur(f) && !cur(f).formula && cur(f).value !== ''; });
  if (filled && !p.overwrite) {
    const r = cur(coupon ? 'couponRate' : 'rate'), it = cur(coupon ? 'couponMerchant' : 'items');
    return JSON.stringify({ ok: false, needConfirm: true, message: label + ' 現在有內容（' +
      (r ? r.value : '') + '%｜' + String(it ? it.value : '').slice(0, 40) + '）。視窗開著的時候表被改過，請重新確認要不要覆蓋' });
  }
  const changes = {}, missing = [], skipped = [];
  FIELDS.forEach(function(f) {
    const name = f + '_' + slot;
    const want = String(p.fields[f] == null ? '' : p.fields[f]).trim();
    const fld = card.fields[name];
    if (!fld) { if (want !== '') missing.push(name); return; }
    if (fld.readonly) { if (want !== '') skipped.push(name); return; }
    if (want !== fld.value) changes[name] = { original: fld.value, value: want };
  });
  if (missing.length) return JSON.stringify({ ok: false, message: '表上找不到欄位：' + missing.join('、') + '（先在 Cards Data 補上這幾欄，或把這幾格清空）' });
  let saved = [];
  if (Object.keys(changes).length) {
    const res = cardEditorSave({ id: p.id, changes: changes });
    if (!res.ok) return JSON.stringify(awFlatten_(res));
    saved = res.saved;
  }
  const added = awEnsureSlotFormulas_(p.id, slot, coupon);
  return JSON.stringify({ ok: true, slot: slot, rowNumber: card.rowNumber, saved: saved, skipped: skipped, formulasAdded: added,
    message: '已寫進 Cards Data 第 ' + card.rowNumber + ' 列的 ' + label + '（' + saved.length + ' 格' +
      (added.length ? '，補上 ' + added.join('、') + ' 的公式' : '') + '）' +
      (skipped.length ? '｜' + skipped.join('、') + ' 是公式欄，沒有寫' : '') });
}

// payload（JSON 字串）= { id, values:{ 欄名: 值 } }
function activityWriterSavePromo(payloadJson) {
  const p = JSON.parse(payloadJson);
  const loaded = promoEditorLoad(p.id);
  const values = {}, notes = [];
  Object.keys(p.values || {}).forEach(function(k) {
    const v = String(p.values[k] == null ? '' : p.values[k]);
    if (k !== 'id' && v.trim() !== '') values[k] = v;
  });
  // 申辦按鈕是卡片層級：這張卡已經有填就不在新列重複寫（要改到「新戶活動編輯器」改，會一次改到每一列）
  loaded.ctaFields.forEach(function(f) {
    const existing = loaded.rows.map(function(r) { return r.fields[f] ? r.fields[f].value : ''; }).filter(function(v) { return v !== ''; });
    if (!existing.length || values[f] === undefined) return;
    if (existing.indexOf(values[f]) < 0) notes.push(f + ' 沒有寫入（這張卡已有申辦按鈕，要改請用新戶活動編輯器）');
    delete values[f];
  });
  const missing = Object.keys(values).filter(function(k) { return !loaded.rows.length ? false : !loaded.rows[0].fields[k]; });
  if (missing.length) return JSON.stringify({ ok: false, message: '新戶活動表上找不到欄位：' + missing.join('、') });
  const res = promoEditorSave({
    id: p.id, cta: {},
    rows: loaded.rows.map(function(r) { return { rowNumber: r.rowNumber, fingerprint: r.fingerprint, changes: {} }; }),
    newRows: [{ values: values }]
  });
  if (!res.ok) return JSON.stringify(awFlatten_(res));
  const rows = res.card.rows.map(function(r) { return r.rowNumber; });
  return JSON.stringify({ ok: true, rowNumber: Math.max.apply(null, rows),
    message: '已新增到 New Cardholder Promos 第 ' + Math.max.apply(null, rows) + ' 列' + (notes.length ? '｜' + notes.join('；') : '') });
}

// req（JSON 字串）= { system, user, schema }（tools/activity-writer/parser.js 的 buildAiRequest 產生）
function activityWriterAi(reqJson) {
  const req = JSON.parse(reqJson);
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) return JSON.stringify({ ok: false, message: '這個專案還沒有設定指令碼屬性 GEMINI_API_KEY（專案設定 → 指令碼屬性；跟自動化檔用同一把即可）。規則解析不需要它' });
  const models = String(props.getProperty('ACTIVITY_WRITER_MODELS') || AW_DEFAULT_MODELS_).split(/[,，\s]+/).filter(String);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts: [{ text: req.user }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: req.schema, temperature: 0 }
  });
  const tried = [];
  for (let i = 0; i < models.length; i++) {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[i]) + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: body, muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 429 || code === 404 || code >= 500) { tried.push(models[i] + ' HTTP ' + code); continue; }
    let j;
    try { j = JSON.parse(res.getContentText()); } catch (e) { tried.push(models[i] + ' 回應不是 JSON'); continue; }
    if (code !== 200) return JSON.stringify({ ok: false, message: (j.error && j.error.message) || 'HTTP ' + code });
    const part = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0];
    if (!part || !part.text) return JSON.stringify({ ok: false, message: 'AI 沒有回傳內容' });
    try { return JSON.stringify({ ok: true, model: models[i], data: JSON.parse(part.text) }); }
    catch (e) { return JSON.stringify({ ok: false, message: 'AI 回傳的不是 JSON' }); }
  }
  return JSON.stringify({ ok: false, message: '所有模型都失敗：' + tried.join('；') });
}

// ---------- 內部工具 ----------

// Cards Data → 解析器要的最小卡片資料（讀的是表上現況，不是上次匯出的 cards.data）
function awReadCards_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cards Data');
  if (!sheet) throw new Error('找不到「Cards Data」工作表');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const maxRate = maxSlotIndex(headers, 'rate');
  const maxCoupon = maxSlotIndex(headers, 'couponMerchant');
  const num = function(v) { const n = parseFloat(v); return isNaN(n) ? undefined : n; };
  const str = function(v) { return Object.prototype.toString.call(v) === '[object Date]' ? '' : String(v == null ? '' : v).trim(); };
  const cards = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = str(getValue(row, headers, 'id'));
    if (!id) continue;
    const card = { id: id, name: str(getValue(row, headers, 'name')), bank: str(getValue(row, headers, 'bank')) || undefined,
      basicCashback: num(getValue(row, headers, 'basicCashback')) || 0,
      overseasCashback: num(getValue(row, headers, 'overseasCashback')), domesticBonusRate: num(getValue(row, headers, 'domesticBonusRate')),
      overseasBonusRate: num(getValue(row, headers, 'overseasBonusRate')), hasLevels: pmcIsTrueCell_(getValue(row, headers, 'hasLevels')),
      cashbackRates: [], couponCashbacks: [], slots: [], couponSlots: [] };
    for (let j = 1; j <= maxRate; j++) {
      const rateRaw = getValue(row, headers, 'rate_' + j);
      const items = str(getValue(row, headers, 'items_' + j));
      const rateStr = str(rateRaw);
      const empty = AW_RATE_FIELDS_.every(function(f) { const v = getValue(row, headers, f + '_' + j); return v === null || v === ''; });
      card.slots.push({ n: j, empty: empty, rate: rateStr, items: items.split(',').slice(0, 3).join('、') });
      if (!items || rateStr === '') continue;
      card.cashbackRates.push({ slot: j, rate: /^\{.+\}$/.test(rateStr) ? rateStr : num(rateRaw),
        items: items.split(',').map(function(s) { return s.trim(); }).filter(String),
        cashbackModel: str(getValue(row, headers, 'cashbackModel_' + j)), category: str(getValue(row, headers, 'category_' + j)),
        period: str(getValue(row, headers, 'period_' + j)) });
    }
    for (let k = 1; k <= maxCoupon; k++) {
      const m = str(getValue(row, headers, 'couponMerchant_' + k));
      const cr = str(getValue(row, headers, 'couponRate_' + k));
      const cEmpty = AW_COUPON_FIELDS_.every(function(f) { const v = getValue(row, headers, f + '_' + k); return v === null || v === ''; });
      card.couponSlots.push({ n: k, empty: cEmpty, rate: cr, items: m.split(',').slice(0, 3).join('、') });
      if (m) card.couponCashbacks.push({ slot: k, merchant: m, rate: cr, period: str(getValue(row, headers, 'couponPeriod_' + k)) });
    }
    cards.push(card);
  }
  return cards;
}

// 通路詞庫裡「不在這兩張表上」的部分（快捷搜尋、統一詞表、行動支付別名）沿用線上 cards.data；
// 讀不到就只用表上的通路，不擋工具
function awSiteVocab_() {
  try {
    const res = UrlFetchApp.fetch(SITE_ORIGIN + '/cards.data', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { note: '讀不到線上 cards.data（HTTP ' + res.getResponseCode() + '），通路詞庫只用表上的寫法' };
    const json = JSON.parse(Utilities.newBlob(Utilities.base64Decode(res.getContentText().trim())).getDataAsString('UTF-8'));
    return { quickSearchOptions: json.quickSearchOptions, termAliases: json.termAliases, payments: json.payments };
  } catch (e) {
    return { note: '讀不到線上 cards.data，通路詞庫只用表上的寫法' };
  }
}

// 新填的槽位若 daysRemaining_N／period_N（領券槽：couponPeriod_N）是空的，補上跟其他槽位同一種寫法的公式；
// 已有內容（公式或手填）就不動
function awEnsureSlotFormulas_(cardId, slot, coupon) {
  const sheet = ceSheet_();
  const headers = ceHeaders_(sheet);
  const row = ceFindRow_(sheet, headers, cardId);
  const a1 = function(name) { const c = headers.indexOf(name + '_' + slot); return c < 0 ? '' : sheet.getRange(row, c + 1).getA1Notation(); };
  const s = a1(coupon ? 'couponPeriodStart' : 'periodStart'), e = a1(coupon ? 'couponPeriodEnd' : 'periodEnd');
  if (!e) return [];
  const periodF = s ? '=IF(OR(ISBLANK(' + s + '),ISBLANK(' + e + ')),"",TEXT(' + s + ',"yyyy/m/d")&"~"&TEXT(' + e + ',"yyyy/m/d"))' : '';
  const want = coupon ? { couponPeriod: periodF } : { daysRemaining: '=IF(ISBLANK(' + e + '),"",' + e + '-TODAY())', period: periodF };
  const added = [];
  Object.keys(want).forEach(function(name) {
    const c = headers.indexOf(name + '_' + slot);
    if (c < 0 || !want[name]) return;
    const cell = sheet.getRange(row, c + 1);
    if (cell.getFormulas()[0][0] || String(cell.getValues()[0][0]) !== '') return;
    cell.setFormula(want[name]);
    added.push(name + '_' + slot);
  });
  if (added.length) SpreadsheetApp.flush();
  return added;
}

// 兩個編輯器的失敗回傳（errors／conflicts／conflict／levelWarning）→ 一句給人看的話
function awFlatten_(res) {
  const lines = [];
  if (res.message) lines.push(res.message);
  if (res.conflict) lines.push(res.conflict);
  (res.conflicts || []).forEach(function(c) { lines.push(c.field + ' 在視窗開著的時候被改成「' + c.sheetValue + '」，這次什麼都沒寫入——按「重新讀表」再試') ; });
  (res.errors || []).forEach(function(e) { lines.push((e.field ? e.field + '：' : '') + e.message); });
  return { ok: false, message: lines.join('；') || '存檔失敗（原因不明）', stale: !!(res.conflict || (res.conflicts && res.conflicts.length)) };
}
