// ==========================================
// 新戶活動編輯器（New Cardholder Promos 的「一張卡一頁」操作介面，2026-11-11 新增）
// ==========================================
//
// 住在「PMC 管理系統」試算表（跟 cards-export.gs、card-editor.gs 同一個 Apps Script 專案），
// 搭配同專案的 PromoEditor.html。安裝與使用見 apps-script/README.md「新戶活動編輯器」一節。
//
// 這張表一列一檔活動，同一張卡分散在好幾列（樂天 8 列）。編輯器選一張卡就列出它所有的列：
//   - 申辦按鈕（apply_cta_text／apply_cta_link／apply_cta_expiry）是「卡片層級」，只顯示一次；
//     改它會寫到這張卡「原本有填這欄」的每一列（都沒填就寫第一列），順便讓各列一致
//   - 每一檔活動一張可收合的卡片；「＋ 新增一檔活動」插在這張卡最後一列的下面，
//     並從上一檔（最後一檔啟用中的）複製新戶定義、條件、連結、priority 當起點；active 預設勾選
//   - **不提供刪除**（站長 2026-11-11 決定）：下架請取消 active；真的要刪到表上刪
//   - 只寫改過的格子；公式欄唯讀；存檔前跑 pmcValidatePromoRow_（cards-export.gs，與
//     runQACheck 檢查 13 共用），有任何問題就整筆擋下
//   - 開編輯器後這張卡的列在表上被改過、多了或少了（例如 AI 自動化剛寫進來）→ 擋下要求重新載入
//
// 依賴：cards-export.gs（getValue、isPromoRow_、pmcValidatePromoRow_、pmcIsTrueCell_…）與
//   card-editor.gs（ceNormalize_、ceToCell_、CE_DIALOG_*）。三個檔案要在同一個 Apps Script 專案。

const PE_SHEET_NAME_ = 'New Cardholder Promos';  // getSheetByName 不分大小寫，表上叫 New CardHolder Promos 也找得到
const PE_CTA_FIELDS_ = ['apply_cta_text', 'apply_cta_link', 'apply_cta_expiry'];
const PE_DATE_FIELDS_ = ['period_start', 'period_end', 'apply_cta_expiry'];
const PE_NUMERIC_FIELDS_ = ['bonus_cap', 'voucher_amount', 'priority', 'luggage_inch', 'luggage_value'];
// 新增活動時從上一檔複製的欄位（站長 2026-11-11 同意）
const PE_COPY_FIELDS_ = ['new_customer_definition', 'promo_condition', 'link', 'priority', 'active'];
// 畫面上的分組（沒列到的欄位放「其他欄位」，表上新加欄也會自動出現）
const PE_GROUPS_ = [
  ['活動內容', ['promo_types', 'new_customer_summary', 'new_customer_definition', 'promo_condition', 'period_start', 'period_end', 'min_spend', 'active', 'priority']],
  ['回饋／獎勵', ['bonus_rate', 'bonus_cap', 'bonus_merchants', 'voucher_amount', 'voucher_usage', 'gift_content', 'gift_image_url', 'luggage_inch', 'luggage_value']],
  ['備註與連結', ['notes', 'link']],
  ['站長推薦', ['pick_rank', 'pick_question', 'pick_reason']]
];

// ---------- 選單入口 ----------
function openPromoEditor() {
  const html = HtmlService.createHtmlOutputFromFile('PromoEditor')
    .setWidth(CE_DIALOG_WIDTH_).setHeight(CE_DIALOG_HEIGHT_);
  SpreadsheetApp.getUi().showModelessDialog(html, '🎁 新戶活動編輯器');
}

// ---------- 給視窗呼叫的函式 ----------

// 卡片清單：Cards Data 的卡（含還沒有新戶活動的）＋ 新戶活動表上有、Cards Data 沒有的 id
function promoEditorListCards() {
  const counts = {};
  const sheet = peSheet_();
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('id');
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idCol] || '').trim();
    if (!id) continue;
    if (isPromoRow_(data[i], data[0])) counts[id] = (counts[id] || 0) + 1;
    else counts[id] = counts[id] || 0;
  }
  const list = [];
  const seen = {};
  const cardsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cards Data');
  if (cardsSheet) {
    const cd = cardsSheet.getDataRange().getValues();
    const ci = cd[0].indexOf('id'), ni = cd[0].indexOf('name');
    for (let i = 1; i < cd.length; i++) {
      const id = String(cd[i][ci] || '').trim();
      if (!id || seen[id]) continue;
      seen[id] = true;
      list.push({ id: id, name: ni >= 0 ? String(cd[i][ni] || '') : '', count: counts[id] || 0 });
    }
  }
  Object.keys(counts).forEach(function(id) {
    if (!seen[id]) list.push({ id: id, name: '⚠️ 不在 Cards Data', count: counts[id] });
  });
  return list;
}

function promoEditorLoad(cardId) {
  const sheet = peSheet_();
  const tz = ceTz_();
  const range = sheet.getDataRange();
  const values = range.getValues();
  const formulas = range.getFormulas();
  const headers = values[0];
  const seen = {}, cols = [];
  headers.forEach(function(h, idx) {
    const name = String(h);
    if (name.trim() === '' || seen[name]) return;   // 重複標題只認第一欄（同匯出）
    seen[name] = true;
    cols.push({ name: name, idx: idx });
  });

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][headers.indexOf('id')] || '').trim() !== cardId) continue;
    rows.push(peRowInfo_(headers, cols, values[i], formulas[i], i + 1, tz));
  }

  // 分組：照 PE_GROUPS_，沒列到的進「其他欄位」
  const placed = { id: true };
  PE_CTA_FIELDS_.forEach(function(f) { placed[f] = true; });
  const groups = PE_GROUPS_.map(function(g) {
    const fields = g[1].filter(function(f) { return seen[f]; });
    fields.forEach(function(f) { placed[f] = true; });
    return { title: g[0], fields: fields };
  });
  const others = cols.map(function(c) { return c.name; }).filter(function(f) { return !placed[f]; });
  if (others.length) groups.push({ title: '其他欄位', fields: others });

  return {
    id: cardId,
    rows: rows,
    groups: groups,
    ctaFields: PE_CTA_FIELDS_.filter(function(f) { return seen[f]; }),
    copyFields: PE_COPY_FIELDS_.filter(function(f) { return seen[f]; }),
    dateFields: PE_DATE_FIELDS_,
    knownTypes: PMC_PROMO_KNOWN_TYPES,
    today: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')
  };
}

// payload = {
//   id,
//   rows:    [{ rowNumber, fingerprint, changes: { 欄位: { original, value } } }]  ← 這張卡「全部」的列
//   cta:     { 欄位: 新值 }   （有改或按了「統一」的申辦按鈕欄位）
//   newRows: [{ values: { 欄位: 值 } }]
// }
function promoEditorSave(payload) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) return { ok: false, message: '試算表正忙（可能有人在匯出），請稍等幾秒再存一次' };
  try {
    const sheet = peSheet_();
    const tz = ceTz_();
    const range = sheet.getDataRange();
    const values = range.getValues();
    const formulas = range.getFormulas();
    const headers = values[0];
    const idCol = headers.indexOf('id');
    const cols = [];
    const seen = {};
    headers.forEach(function(h, idx) { const n = String(h); if (n.trim() && !seen[n]) { seen[n] = true; cols.push({ name: n, idx: idx }); } });
    const colOf = function(name) { return headers.indexOf(name); };

    // 1. 找回每一列（先看原列號，被插列擠走的話用指紋找），並確認這張卡沒有多出／少掉列
    const sheetRows = [];
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idCol] || '').trim() === payload.id) sheetRows.push(i + 1);
    }
    const fpOf = function(r) { return peRowInfo_(headers, cols, values[r - 1], formulas[r - 1], r, tz).fingerprint; };
    const located = [];
    const used = {};
    for (let k = 0; k < payload.rows.length; k++) {
      const pr = payload.rows[k];
      let r = null;
      if (sheetRows.indexOf(pr.rowNumber) >= 0 && fpOf(pr.rowNumber) === pr.fingerprint) r = pr.rowNumber;
      else {
        const hits = sheetRows.filter(function(x) { return !used[x] && fpOf(x) === pr.fingerprint; });
        if (hits.length === 1) r = hits[0];
      }
      if (!r) return { ok: false, conflict: '第 ' + pr.rowNumber + ' 列在你打開編輯器之後被改過（或被移走）。為了不蓋掉別人的修改，這次什麼都沒寫入。' };
      used[r] = true;
      located.push({ r: r, changes: pr.changes || {}, key: 'r' + pr.rowNumber });
    }
    if (sheetRows.length !== payload.rows.length) {
      return { ok: false, conflict: '這張卡在表上現在有 ' + sheetRows.length + ' 列、你打開時是 ' + payload.rows.length + ' 列（有人新增或刪了列）。這次什麼都沒寫入。' };
    }

    // 2. 申辦按鈕：寫到原本有填這欄的每一列，都沒填就寫第一列
    const cta = payload.cta || {};
    const newRowsIn = payload.newRows || [];
    if (Object.keys(cta).length && located.length === 0) {
      // 這張卡在表上還沒有任何列：跟著第一檔新活動寫進去
      if (!newRowsIn.length) return { ok: false, message: '這張卡在新戶活動表上還沒有任何列，請先「＋ 新增一檔活動」再填申辦按鈕' };
      Object.keys(cta).forEach(function(f) { newRowsIn[0].values[f] = cta[f]; });
    }
    Object.keys(cta).forEach(function(f) {
      if (colOf(f) < 0) return;
      let targets = located.filter(function(l) { return String(values[l.r - 1][colOf(f)]).trim() !== ''; });
      if (targets.length === 0 && located.length) targets = [located.slice().sort(function(a, b) { return a.r - b.r; })[0]];
      targets.forEach(function(l) {
        l.changes[f] = { original: ceNormalize_(values[l.r - 1][colOf(f)], peKind_(f, values[l.r - 1][colOf(f)]), tz), value: String(cta[f]) };
      });
    });

    // 3. 檢查要寫的格子、組出存檔後的樣子跑驗證
    const errors = [];
    for (let k = 0; k < located.length; k++) {
      const l = located[k];
      const proposed = values[l.r - 1].slice();
      const names = Object.keys(l.changes);
      for (let j = 0; j < names.length; j++) {
        const c = colOf(names[j]);
        if (c < 0) return { ok: false, message: '表上找不到「' + names[j] + '」欄（標題被改過？）請重新載入' };
        if (names[j] === 'id') return { ok: false, message: 'id 不能在編輯器裡改' };
        if (formulas[l.r - 1][c]) return { ok: false, message: '「' + names[j] + '」是公式欄，不能在編輯器裡改' };
        const kind = peKind_(names[j], values[l.r - 1][c]);
        proposed[c] = kind === 'bool' ? (l.changes[names[j]].value === 'TRUE') : l.changes[names[j]].value;
      }
      pmcValidatePromoRow_(headers, proposed, '第 ' + l.r + ' 列').forEach(function(it) { it.rowKey = l.key; errors.push(it); });
    }
    const newRows = payload.newRows || [];
    newRows.forEach(function(nr, i) {
      const proposed = headers.map(function(h) {
        if (String(h) === 'id') return payload.id;
        const v = nr.values[String(h)];
        return v === undefined ? '' : (peKind_(String(h), '') === 'bool' ? v === 'TRUE' : v);
      });
      const label = '新活動 ' + (i + 1);
      if (!isPromoRow_(proposed, headers)) {
        errors.push({ code: 'NEW_EMPTY', field: 'new_customer_summary', slotLabel: label, message: '新活動沒有填任何活動內容（摘要、類型、期間…），不會被當成一檔活動', rowKey: 'n' + i });
      }
      pmcValidatePromoRow_(headers, proposed, label).forEach(function(it) { it.rowKey = 'n' + i; errors.push(it); });
    });
    if (errors.length) return { ok: false, errors: errors };

    // 4. 寫入：先改既有列，再插新列（插在這張卡最後一列下面，不會擠動上面要改的列）
    let written = 0;
    located.forEach(function(l) {
      Object.keys(l.changes).forEach(function(f) {
        const c = colOf(f);
        const raw = values[l.r - 1][c];
        const v = ceToCell_(f, peKind_(f, raw), l.changes[f].value, raw, PE_NUMERIC_FIELDS_.indexOf(f) >= 0);
        sheet.getRange(l.r, c + 1).setValue(v);
        written++;
      });
    });
    if (newRows.length) {
      let after = sheetRows.length ? Math.max.apply(null, sheetRows) : sheet.getLastRow();
      const template = after;  // 格式、勾選框、公式照這一列
      const lastCol = sheet.getLastColumn();
      newRows.forEach(function(nr) {
        sheet.insertRowAfter(after);
        const r = after + 1;
        const tRow = template;  // 新列都插在模板列下面，模板列不會被擠動
        const src = sheet.getRange(tRow, 1, 1, lastCol);
        const dst = sheet.getRange(r, 1, 1, lastCol);
        src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
        const tFormulas = src.getFormulas()[0];
        headers.forEach(function(h, c) {
          const name = String(h);
          if (tFormulas[c]) { sheet.getRange(tRow, c + 1).copyTo(sheet.getRange(r, c + 1)); return; }
          if (name.trim() === '' || colOf(name) !== c) return;  // 重複標題的後面那欄不寫
          const v = name === 'id' ? payload.id : nr.values[name];
          if (v === undefined || String(v) === '') return;
          const kind = peKind_(name, '');
          sheet.getRange(r, c + 1).setValue(name === 'id' ? payload.id : ceToCell_(name, kind, v, '', PE_NUMERIC_FIELDS_.indexOf(name) >= 0));
        });
        after = r;
      });
    }
    SpreadsheetApp.flush();
    return { ok: true, card: promoEditorLoad(payload.id), written: written, added: newRows.length };
  } finally {
    lock.releaseLock();
  }
}

// ---------- 內部工具 ----------

function peSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PE_SHEET_NAME_);
  if (!sheet) throw new Error('找不到「' + PE_SHEET_NAME_ + '」工作表');
  if (sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf('id') < 0) {
    throw new Error('「' + PE_SHEET_NAME_ + '」第一列找不到 id 欄');
  }
  return sheet;
}

function peKind_(name, raw) {
  if (PE_DATE_FIELDS_.indexOf(name) >= 0) return 'date';
  if (name === 'active' || typeof raw === 'boolean') return 'bool';
  return 'text';
}

// 一列 → 畫面要的資料＋指紋（整列正規化後的字串，用來偵測「被別人改過／被移走」）
function peRowInfo_(headers, cols, rowValues, rowFormulas, rowNumber, tz) {
  const fields = {};
  const fp = [];
  cols.forEach(function(c) {
    const raw = rowValues[c.idx];
    const kind = peKind_(c.name, raw);
    const value = ceNormalize_(raw, kind, tz);
    const formula = rowFormulas[c.idx] || '';
    fields[c.name] = { value: value, kind: kind, readonly: !!formula || c.name === 'id', formula: formula };
    if (!formula) fp.push(c.name + '=' + value);
  });
  return {
    rowNumber: rowNumber,
    isPromo: isPromoRow_(rowValues, headers),
    fields: fields,
    fingerprint: fp.join('\u0001')
  };
}
