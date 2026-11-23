/**
 * Firebase 測試替身的補洞器（2026-11-17）
 *
 * 背景：回歸測試用自製的 ES module 替身取代 Firebase SDK。ES module 只要少一個具名 export，
 * 整個 <script type="module"> 就載入失敗、Firebase 永遠不會初始化。2026-11 index.html 多 import 了
 * setUserProperties，三份替身都沒跟上，配卡組合頁測試與刪除帳號測試悄悄變紅；訪客型的搜尋回歸
 * 因為不需要 Firebase 仍然全綠，所以沒人發現。
 *
 * 做法：每份替身回傳前都過 completeFirebaseStub()。它讀 index.html 實際 import 的名稱，
 * 替身沒有的就補一個空函式，並印一行警告。測試不會再因為「漏補一個名字」整包掛掉，
 * 而警告會提醒你去替身裡補上有意義的實作（空函式回傳 undefined，未必符合該 API 的行為）。
 */
const fs = require('fs');
const path = require('path');

const INDEX_HTML = path.resolve(__dirname, '..', '..', 'index.html');
let importsByModule = null;
const warned = new Set();

function readImports() {
  if (importsByModule) return importsByModule;
  importsByModule = {};
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const re = /import\s*\{([^}]+)\}\s*from\s*["']https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+)\.js["']/g;
  let m;
  while ((m = re.exec(html))) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    (importsByModule[m[2]] = importsByModule[m[2]] || new Set());
    names.forEach(n => importsByModule[m[2]].add(n));
  }
  return importsByModule;
}

function completeFirebaseStub(url, body) {
  const mod = (String(url).match(/(firebase-[a-z-]+)\.js/) || [])[1];
  const wanted = mod && readImports()[mod];
  if (!wanted) return body;
  const have = new Set();
  const re = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(body))) have.add(m[1]);
  const missing = [...wanted].filter(n => !have.has(n));
  if (missing.length === 0) return body;
  missing.forEach(n => {
    const key = mod + ':' + n;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`⚠️ Firebase 替身缺 ${mod} 的 ${n}（index.html 有 import），已自動補空函式——請到測試的替身補上正式的 export`);
  });
  return body + '\n' + missing.map(n => `export function ${n}(){}`).join('\n');
}

module.exports = { completeFirebaseStub };
