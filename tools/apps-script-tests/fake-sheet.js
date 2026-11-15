// 單卡編輯器離線測試共用的假試算表（card-editor-test.js 與 card-editor-ui-test.js 共用）。
// 用 Node vm 載入 cards-export.gs ＋ card-editor.gs，names 是要拿出來呼叫的函式名稱。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');

// ---------- 假試算表 ----------
function makeSheet(name, grid, formulas) {
  formulas = formulas || {};
  const writes = [];
  const sheet = {
    name, grid, formulas, writes,
    getLastRow: () => grid.length,
    getLastColumn: () => Math.max(...grid.map(r => r.length)),
    getDataRange: () => sheet.getRange(1, 1, grid.length, sheet.getLastColumn()),
    clear: () => { grid.length = 0; },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const row = grid[r - 1 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; })),
        getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) =>
          formulas[(r + i) + ',' + (c + j)] || '')),
        setValue: (v) => { writes.push({ r, c, v }); (grid[r - 1] = grid[r - 1] || [])[c - 1] = v; return rng; },
        setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => { (grid[r - 1 + i] = grid[r - 1 + i] || [])[c - 1 + j] = v; })); return rng; },
        setFontWeight: () => rng, setBackground: () => rng, setFontColor: () => rng,
      };
      return rng;
    },
  };
  return sheet;
}

function loadScripts(sheets, names) {
  const alerts = [], menus = [];
  const menu = () => { const m = { items: [], addItem: (a, b) => { m.items.push(b); return m; }, addSeparator: () => m, addSubMenu: () => m, addToUi: () => { menus.push(m); return m; } }; return m; };
  const ss = { getSheetByName: n => sheets[n] || null, getSpreadsheetTimeZone: () => 'Asia/Taipei' };
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, flush: () => {},
      getUi: () => ({ alert: (...a) => alerts.push(a), createMenu: menu, ButtonSet: { OK: 'OK' }, showSidebar: () => {} }),
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
          .formatToParts(d).map(x => [x.type, x.value]));
        const y = p.year, M = String(+p.month), D = String(+p.day);
        if (fmt === 'yyyy-MM-dd') return `${y}-${M.padStart(2, '0')}-${D.padStart(2, '0')}`;
        if (fmt === 'yyyy/M/d') return `${y}/${M}/${D}`;
        throw new Error('fmt ' + fmt);
      },
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle: function() { return this; } }) },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(root, 'apps-script/cards-export.gs'), 'utf8') + '\n' +
              fs.readFileSync(path.join(root, 'apps-script/card-editor.gs'), 'utf8') +
              '\n;this.__x = { ' + names.join(', ') + ' };';
  vm.runInContext(src, ctx, { filename: 'apps-script' });
  return Object.assign(ctx.__x, { alerts, menus });
}

module.exports = { makeSheet, loadScripts };
