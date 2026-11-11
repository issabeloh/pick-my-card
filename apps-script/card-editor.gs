// ==========================================
// 單卡編輯器（Cards Data 的直式操作介面，2026-11-11 新增）
// ==========================================
//
// 住在「PMC 管理系統」試算表（跟 cards-export.gs 同一個 Apps Script 專案），搭配同專案的
// CardEditor.html。安裝與使用見 apps-script/README.md「單卡編輯器」一節。
//
// 它只是 Cards Data 寬表的「另一個操作介面」：
//   - 不改表結構、不碰 exportToJSON；欄位一律依第一列標題名稱對應，不寫死欄號
//   - 存檔「只寫有改的格子」，整列不重寫——period_N 這類公式欄只顯示、不能改，也不會被蓋掉
//   - 存檔前跑 pmcValidateCardRow_（在 cards-export.gs，與 runQACheck 檢查 12 共用），
//     有任何問題就整筆擋下，什麼都不寫
//   - 級別名稱是識別碼（docs/project/data-pipeline.md 第 6 節）：levelSettings 的級別被改名／
//     刪除，或第一個級別（＝網站預設級別）換人，必須在警告視窗按「確定」才會寫入
//   - 開編輯器之後，若有人在表格裡直接改了同一格，存檔會擋下並指出是哪一格（不互相覆蓋）
//
// 依賴 cards-export.gs 的：getValue、maxSlotIndex、pmcValidateCardRow_、pmcParseLevelSettings_、
//   pmcIsTrueCell_。這兩個檔案必須在同一個 Apps Script 專案。

const CE_SHEET_NAME_ = 'Cards Data';

// 級別區的欄位
const CE_LEVEL_FIELDS_ = ['hasLevels', 'levelSettings', 'levelLabelFormat'];

// 這些欄位「看起來是數字」時寫成數字；其他欄位一律寫成文字
// （例如 items 填「85」也要是文字——匯出會對 items 做 .split，數字會讓匯出當掉）
const CE_NUMERIC_FIELDS_ = ['basicCashback', 'overseasCashback', 'overseasBonusRate', 'overseasBonusCap',
  'domesticBonusRate', 'domesticBonusCap', 'autoBillCashback', 'autoBillCap'];
const CE_NUMERIC_SLOT_RE_ = /^(rate|cap|couponRate|couponCap|minSpend|maxSpend)_\d+$/;
const CE_DATE_RE_ = /^(periodStart|periodEnd|couponPeriodStart|couponPeriodEnd)_\d+$/;
const CE_BOOL_RE_ = /^(hasLevels|hideInDisplay_\d+)$/;

// 槽位內欄位的顯示順序（沒列到的接在後面，照表上順序）
const CE_RATE_ORDER_ = ['rate', 'items', 'cap', 'category', 'conditions', 'periodStart', 'periodEnd', 'period',
  'cashbackModel', 'minSpend', 'maxSpend', 'hideInDisplay', 'registerLink'];
const CE_COUPON_ORDER_ = ['couponMerchant', 'couponRate', 'couponCap', 'couponConditions',
  'couponPeriodStart', 'couponPeriodEnd', 'couponPeriod'];

// 編輯器視窗大小（像素）。螢幕比較小、視窗超出畫面時，把這兩個數字改小再存檔即可
const CE_DIALOG_WIDTH_ = 1060;
const CE_DIALOG_HEIGHT_ = 660;

// ---------- 選單入口 ----------
// 2026-11-11 改成大視窗（非強制回應對話框）：側邊欄固定 300px 太窄。
// 開著視窗時仍可點試算表；版面會隨寬度調整，窄的時候左側索引改到上方。
function openCardEditor() {
  const html = HtmlService.createHtmlOutputFromFile('CardEditor')
    .setWidth(CE_DIALOG_WIDTH_).setHeight(CE_DIALOG_HEIGHT_);
  SpreadsheetApp.getUi().showModelessDialog(html, '📝 單卡編輯器');
}

// ---------- 給側邊欄呼叫的函式 ----------

// 卡片清單（下拉選單用）
function cardEditorListCards() {
  const sheet = ceSheet_();
  const headers = ceHeaders_(sheet);
  const idCol = headers.indexOf('id');
  const nameCol = headers.indexOf('name');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const list = [];
  data.forEach(function(r) {
    const id = String(r[idCol] || '').trim();
    if (!id) return;
    list.push({ id: id, name: nameCol >= 0 ? String(r[nameCol] || '') : '' });
  });
  return list;
}

// 讀一張卡，整理成側邊欄要的直式結構
function cardEditorLoad(cardId) {
  const sheet = ceSheet_();
  const headers = ceHeaders_(sheet);
  const tz = ceTz_();
  const rowNumber = ceFindRow_(sheet, headers, cardId);
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  const formulas = range.getFormulas()[0];

  const fields = {};
  const seen = {};
  const duplicates = [];
  const base = [], levels = [];
  const rateSlots = {}, couponSlots = {};

  headers.forEach(function(h, idx) {
    const name = String(h);
    if (name.trim() === '') return;
    // 標題重複：匯出只讀最前面那欄（headers.indexOf），編輯器也一樣，後面的忽略
    if (seen[name]) { duplicates.push(name); return; }
    seen[name] = true;

    const raw = values[idx];
    const kind = ceKind_(name, raw);
    const formula = formulas[idx] || '';
    fields[name] = {
      value: ceNormalize_(raw, kind, tz),
      kind: kind,
      readonly: !!formula || name === 'id',
      formula: formula,
      readonlyReason: formula ? '這格是公式，會自動算出來，請改它引用的欄位'
        : (name === 'id' ? 'id 是卡片識別碼（其他工作表與網站網址都靠它），請直接在表上改' : '')
    };

    if (CE_LEVEL_FIELDS_.indexOf(name) >= 0) { levels.push(name); return; }
    const m = name.match(/^(.+)_(\d+)$/);
    if (m) {
      const n = parseInt(m[2], 10);
      const bucket = m[1].indexOf('coupon') === 0 ? couponSlots : rateSlots;
      (bucket[n] = bucket[n] || []).push(name);
      return;
    }
    base.push(name);
  });

  const toSlotList = function(bucket, order) {
    return Object.keys(bucket).map(Number).sort(function(a, b) { return a - b; }).map(function(n) {
      const names = bucket[n].slice().sort(function(a, b) {
        const ia = order.indexOf(a.replace(/_\d+$/, '')), ib = order.indexOf(b.replace(/_\d+$/, ''));
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);  // 沒列在順序表的保持表上順序（sort 穩定）
      });
      const empty = names.every(function(f) {
        return fields[f].formula || fields[f].value === '';
      });
      return { n: n, fields: names, empty: empty };
    });
  };

  return {
    id: cardId,
    rowNumber: rowNumber,
    fields: fields,
    base: base,
    levels: levels,
    rateSlots: toSlotList(rateSlots, CE_RATE_ORDER_),
    couponSlots: toSlotList(couponSlots, CE_COUPON_ORDER_),
    duplicates: duplicates
  };
}

// 存檔。payload = { id, changes: { 欄位名: { original, value } }, confirmLevelChange }
// 回傳 { ok:true, card } 或 { ok:false, conflicts | errors | levelWarning | message }
function cardEditorSave(payload) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, message: '試算表正忙（可能有人在匯出），請稍等幾秒再存一次' };
  }
  try {
    const sheet = ceSheet_();
    const headers = ceHeaders_(sheet);
    const tz = ceTz_();
    const rowNumber = ceFindRow_(sheet, headers, payload.id);
    const range = sheet.getRange(rowNumber, 1, 1, headers.length);
    const current = range.getValues()[0];
    const formulas = range.getFormulas()[0];
    const changes = payload.changes || {};
    const names = Object.keys(changes);
    if (names.length === 0) return { ok: false, message: '沒有任何修改' };

    // 1. 欄位還在、可寫、沒被別人改過
    const conflicts = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const col = headers.indexOf(name);
      if (col < 0) return { ok: false, message: '表上找不到「' + name + '」欄（標題被改過？）請重新整理編輯器' };
      if (name === 'id') return { ok: false, message: 'id 不能在編輯器裡改' };
      if (formulas[col]) return { ok: false, message: '「' + name + '」是公式欄，不能在編輯器裡改' };
      const kind = ceKind_(name, current[col]);
      const now = ceNormalize_(current[col], kind, tz);
      if (now !== String(changes[name].original)) {
        conflicts.push({ field: name, sheetValue: now, yourOriginal: String(changes[name].original) });
      }
    }
    if (conflicts.length > 0) return { ok: false, conflicts: conflicts };

    // 2. 組出「存檔後的樣子」跑驗證（與 runQACheck 檢查 12 同一套規則）
    const proposed = current.slice();
    names.forEach(function(name) {
      const kind = ceKind_(name, current[headers.indexOf(name)]);
      proposed[headers.indexOf(name)] = kind === 'bool' ? (changes[name].value === 'TRUE') : changes[name].value;
    });
    const errors = pmcValidateCardRow_(headers, proposed);
    if (errors.length > 0) return { ok: false, errors: errors };

    // 3. 級別名稱是識別碼：改名／刪除／預設級別換人 → 要使用者確認
    if (changes.levelSettings && !payload.confirmLevelChange) {
      const warn = ceLevelChange_(current[headers.indexOf('levelSettings')], changes.levelSettings.value);
      if (warn) return { ok: false, levelWarning: warn };
    }

    // 4. 只寫有改的格子
    names.forEach(function(name) {
      const col = headers.indexOf(name);
      const kind = ceKind_(name, current[col]);
      sheet.getRange(rowNumber, col + 1).setValue(ceToCell_(name, kind, changes[name].value, current[col]));
    });
    SpreadsheetApp.flush();

    // 5. 讀回來確認日期沒被試算表解讀成別的日子
    const card = cardEditorLoad(payload.id);
    const mismatched = names.filter(function(name) {
      if (card.fields[name].kind !== 'date') return false;
      return pmcParseDateCell_(card.fields[name].value) !== pmcParseDateCell_(changes[name].value);
    });
    return { ok: true, card: card, saved: names, dateMismatch: mismatched };
  } finally {
    lock.releaseLock();
  }
}

// ---------- 內部工具 ----------

function ceSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CE_SHEET_NAME_);
  if (!sheet) throw new Error('找不到「' + CE_SHEET_NAME_ + '」工作表');
  return sheet;
}

function ceHeaders_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('id') < 0) throw new Error('「' + CE_SHEET_NAME_ + '」第一列找不到 id 欄');
  return headers;
}

function ceTz_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Taipei';
}

// 依 id 找列號（1-based）。找不到或重複都拒絕，不猜
function ceFindRow_(sheet, headers, cardId) {
  const idCol = headers.indexOf('id');
  const lastRow = sheet.getLastRow();
  const ids = lastRow < 2 ? [] : sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  const hits = [];
  ids.forEach(function(r, i) { if (String(r[0]).trim() === String(cardId).trim()) hits.push(i + 2); });
  if (hits.length === 0) throw new Error('找不到 id「' + cardId + '」的卡片（被改名或刪除了？）');
  if (hits.length > 1) throw new Error('id「' + cardId + '」出現在第 ' + hits.join('、') + ' 列，請先在表上處理重複');
  return hits[0];
}

// 欄位型別：date／bool／text（數字也當 text 顯示，寫回時再判斷）
function ceKind_(name, raw) {
  if (CE_DATE_RE_.test(name)) return 'date';
  if (CE_BOOL_RE_.test(name) || typeof raw === 'boolean') return 'bool';
  return 'text';
}

// 儲存格值 → 側邊欄顯示用字串（也用來比對「有沒有被別人改過」）
function ceNormalize_(raw, kind, tz) {
  if (raw === null || raw === undefined) return '';
  if (kind === 'bool') return pmcIsTrueCell_(raw) ? 'TRUE' : '';
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    return isNaN(raw.getTime()) ? '' : Utilities.formatDate(raw, tz, 'yyyy/M/d');
  }
  return String(raw);
}

function ceIsNumericField_(name) {
  return CE_NUMERIC_FIELDS_.indexOf(name) >= 0 || CE_NUMERIC_SLOT_RE_.test(name);
}

// 側邊欄字串 → 要寫進儲存格的值
function ceToCell_(name, kind, value, originalRaw) {
  const v = String(value);
  if (kind === 'bool') {
    if (v === 'TRUE') return true;
    return typeof originalRaw === 'boolean' ? false : '';  // 勾選框維持 FALSE，原本是空白就留空白
  }
  if (v.trim() === '') return '';
  if (kind === 'date') return v.trim();  // 已通過驗證的 2026/7/1 或 2026-07-01，交給試算表解讀成日期
  if ((ceIsNumericField_(name) || typeof originalRaw === 'number') && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return parseFloat(v.trim());
  }
  // 文字欄：看起來會被試算表自動轉成數字／日期／公式的，前面加 ' 強制存成文字
  // （例：items 填「7-11」會被當成 7 月 11 日、填「85」會變數字）
  if (/^[=+\-@]/.test(v) || /^[\d\s.,\/:%$-]+$/.test(v.trim())) return "'" + v;
  return v;
}

// 比對 levelSettings 前後的級別名稱。沒有需要警告的事回 null
function ceLevelChange_(oldRaw, newRaw) {
  const oldP = pmcParseLevelSettings_(oldRaw);
  const newP = pmcParseLevelSettings_(newRaw);
  const keysOf = function(p) {
    return (p.ok && p.value && typeof p.value === 'object' && !Array.isArray(p.value)) ? Object.keys(p.value) : [];
  };
  const oldKeys = keysOf(oldP), newKeys = keysOf(newP);
  if (oldKeys.length === 0) return null;  // 原本沒有級別（或原本就壞掉）：純新增，沒有用戶存過的名稱
  const removed = oldKeys.filter(function(k) { return newKeys.indexOf(k) < 0; });
  const added = newKeys.filter(function(k) { return oldKeys.indexOf(k) < 0; });
  const defaultChanged = newKeys.length > 0 && oldKeys[0] !== newKeys[0];
  if (removed.length === 0 && !defaultChanged) return null;
  return { removed: removed, added: added, defaultChanged: defaultChanged,
    oldDefault: oldKeys[0], newDefault: newKeys[0] || '' };
}
