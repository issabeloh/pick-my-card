#!/usr/bin/env node
/* ============================================================
 * 商家落地頁生成器（2026-08-16）
 *
 * 為什麼存在：merchant/*.html 原本是 index.html 的手抄副本，抄一份就多一份會歪的
 * 東西。實際歪掉的證據（動手當天量到的）：
 *  - 6 頁裡有 4 頁還停在舊版介面（少「個人設定」「近期異動」兩個區塊）
 *  - 頁面裡寫死的 JSON-LD 卡片清單與 SEO 文案早就過期（momo 頁實際第一名是
 *    遠東快樂卡，兩份清單裡都沒有它）
 * 解法：頁面不再手維護，改成每次部署時從 index.html ＋ cards.data 現場組出來。
 * index.html 永遠是版面的唯一來源，卡片清單永遠跟著資料走。
 *
 * 用法：
 *   node tools/build-merchant-pages.js            # 生成（Cloudflare Pages build 會跑）
 *   node tools/build-merchant-pages.js --check    # 只檢查是否與現有檔案一致，不寫入（preflight 用）
 *   node tools/build-merchant-pages.js --verify   # 額外用 Playwright 開真頁比對卡片清單
 *
 * 設定來源：cards.data 的 merchantPages（Google Sheets 的 MerchantPages 工作表）；
 * 沒有這個欄位時退回 tools/merchant-pages.fallback.json（工作表建好之前的過渡用）。
 * 欄位：slug, merchant(搜尋詞), displayName(選填，預設同 merchant), title, description, active,
 *       bodyHtml(選填，站長手寫的正文 HTML；信任層級同 promos，直接烤進頁面不 escape)
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { createEngine, computeMerchantCards } = require('./lib/merchant-cards');

const REPO = path.resolve(__dirname, '..');
const SITE = 'https://pickmycard.app';
const AMOUNT = 1000; // 與頁面開頁自動計算的預設金額一致（compareSpotlightMerchant 代填 1000）

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const VERIFY = argv.includes('--verify');

function readCardsData() {
  const raw = fs.readFileSync(path.join(REPO, 'cards.data'), 'utf8').trim();
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

function loadConfig(cardsData) {
  const fromSheet = cardsData && Array.isArray(cardsData.merchantPages) ? cardsData.merchantPages : null;
  if (fromSheet && fromSheet.length) return { source: 'cards.data (MerchantPages 工作表)', pages: fromSheet };
  const fallback = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'merchant-pages.fallback.json'), 'utf8'));
  return { source: 'tools/merchant-pages.fallback.json（工作表尚未建立）', pages: fallback };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// 一定要換到的東西：換不到就是 index.html 改了結構，寧可炸掉也不要默默生出半殘的頁。
// build 收 (完整比對字串, 群組1, 群組2…) 回傳替換內容——刻意不用字串替換，
// 因為 title/description 是使用者填的，裡面若出現 $& 或 $1 會被 replace 當成反向參照。
function replaceOnce(html, pattern, build, what) {
  if (!pattern.test(html)) {
    throw new Error(`index.html 找不到「${what}」的錨點，生成器需要跟著更新：${pattern}`);
  }
  if (pattern.global) pattern.lastIndex = 0;
  return html.replace(pattern, (...args) => build(...args));
}

function buildJsonLd(displayName, cardNames) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: displayName + ' 信用卡回饋比較',
    itemListElement: cardNames.map((name, i) => ({
      '@type': 'ListItem', position: i + 1, name: name
    }))
  };
  return JSON.stringify(ld).replace(/<\//g, '<\\/');
}

function buildSeoFooter(displayName, cardNames) {
  // 文案裡列的卡片刻意比 JSON-LD 少一張：JSON-LD 是給機器讀的完整清單，
  // 這段是給人讀的，列太長會變成關鍵字堆砌。與 2026-08-16 之前的手寫版同樣做法。
  const listed = cardNames.slice(0, 8).join('、');
  const d = escapeHtml(displayName);
  return '        <section class="mc-seo-footer" aria-label="' + d + ' 信用卡回饋說明">\n' +
    '  <h1>' + d + ' 信用卡回饋比較</h1>\n' +
    '  <p>想知道刷 ' + d + ' 哪張信用卡回饋最高？本頁已用回饋大師為你即時試算上方各張信用卡在 ' + d +
    ' 的回饋率、消費上限、達成條件與活動期間，資料持續更新。' +
    (listed ? '涵蓋 ' + escapeHtml(listed) + ' 等信用卡。' : '') +
    '你也可以用上方搜尋框改查其他商家。</p>\n' +
    '</section>\n';
}

// 「推薦比較」內鏈工具列（2026-08-18）。刻意不做成卡片：站長要的是「工具欄，有空
// 才會看看的地方」，不是又一塊內容區——所以灰底出血、字級小、一眼看得出是連結
// （藍字＋底線＋箭頭），與上下的白底內容區明顯區隔。樣式在 styles.css（兩種頁共用）。
// 回饋數字取該頁自己排第一名那列的 rate 與卡名，跟點進去看到的第一張卡一致。
//
// index.html 放一個空的 <nav class="mc-related"> 當佔位，這裡把它整段換掉：
// 首頁列全部商家頁（currentSlug 傳 null），商家頁各自排除自己。
const RELATED_EMPTY = '<nav class="mc-related" aria-label="推薦比較"></nav>';
const RELATED_RE = /<nav class="mc-related"[\s\S]*?<\/nav>/;

function buildRelatedBar(currentSlug, allPages) {
  const others = allPages.filter(p => p.slug !== currentSlug && p.top);
  // 只有一個商家頁時沒有別的可連——留空的 <nav>，styles.css 的 :empty 會整條收起來
  if (others.length === 0) return RELATED_EMPTY;
  const items = others.map(p =>
    '    <li><a class="mc-related-link" href="/merchant/' + encodeURIComponent(p.slug) + '">' +
    '<span class="mc-related-name">' + escapeHtml(p.displayName) + '</span>' +
    '<span class="mc-related-meta">最高 ' + escapeHtml(String(p.top.rate)) + '%（' +
    escapeHtml(p.top.cardName) + '）</span>' +
    '<span class="mc-related-go" aria-hidden="true">&rarr;</span></a></li>'
  ).join('\n');
  return '<nav class="mc-related" aria-label="推薦比較">\n' +
    '  <span class="mc-related-label">推薦比較</span>\n' +
    '  <ul class="mc-related-list">\n' + items + '\n  </ul>\n        </nav>';
}

// index.html 在 repo 裡也帶著上一次生成的內容（它自己就是輸出之一），所以每次都要先
// 清回空佔位再拿來當模板，否則會拿到「上一版的工具列」去生商家頁。
function stripRelatedBar(html) {
  return replaceOnce(html, RELATED_RE, () => RELATED_EMPTY,
    '推薦比較工具列佔位（index.html 的 <nav class="mc-related">）');
}

// MerchantPages 的 bodyHtml 欄：站長手寫的正文，信任層級同 promos（工作表只有站長能改），
// 所以刻意**不 escape**——escape 掉就等於這個欄位不能用。外部來源的內容永遠不該進這欄。
function buildBodyHtml(bodyHtml, displayName) {
  const body = String(bodyHtml == null ? '' : bodyHtml).trim();
  if (!body) return '';
  // aria-label 是必要的：沒有無障礙名稱的 <section> 不算 region 地標，裡面的正文
  // 會被判成「不在任何地標裡」（axe region）。
  return '        <section class="mc-body" aria-label="' + escapeHtml(displayName) + ' 補充說明">\n' + body + '\n</section>\n';
}

const MERCHANT_PAGE_STYLE =
  '<style>\n' +
  '.mc-seo-footer{max-width:1100px;margin:8px auto 0;padding:20px 24px;color:#6b7280;font-size:13px;line-height:1.8;border-top:1px solid #e5e7eb;}\n' +
  '.mc-seo-footer h1{font-size:16px;font-weight:700;color:#374151;margin:0 0 8px;}\n' +
  // 字級／行距／顏色刻意與 .mc-seo-footer 完全相同：兩塊在頁面上緊鄰，
  // 只差一點就會看起來像沒對齊（13px/1.8/#6b7280，標題 #374151）。
  '.mc-body{max-width:1100px;margin:0 auto;padding:4px 24px 20px;color:#6b7280;font-size:13px;line-height:1.8;}\n' +
  '.mc-body h2{font-size:15px;font-weight:700;color:#374151;margin:18px 0 8px;}\n' +
  '.mc-body h3{font-size:14px;font-weight:700;color:#374151;margin:14px 0 6px;}\n' +
  '.mc-body p{margin:0 0 10px;}\n' +
  '.mc-body ul,.mc-body ol{margin:0 0 10px;padding-left:1.4em;}\n' +
  '.mc-body a{color:#1d4ed8;}\n' +
  '</style>\n';
// 註：.mc-related（推薦比較工具列）的樣式**不在這裡**——首頁也要用，所以收在
// styles.css，兩種頁共用同一份。這個 <style> 只放 merchant 頁專屬的兩塊。

function buildPage(indexHtml, page, cardNames, allPages) {
  const merchant = String(page.merchant);
  const displayName = String(page.displayName || page.merchant);
  const slug = String(page.slug);
  const url = SITE + '/merchant/' + encodeURIComponent(slug);
  const title = escapeHtml(page.title);
  const desc = escapeHtml(page.description);
  let html = indexHtml;

  // 1) <base href="/"> ＋ 商家注入。商家頁在 /merchant/ 底下，沒有 base 的話所有
  //    相對路徑（js/、styles.css、assets/）都會找去 /merchant/ 底下。
  html = replaceOnce(html, /(<meta name="viewport"[^>]*>\n)/,
    (m, p1) => p1 + '    <base href="/">\n    <script>window.__PMC_MERCHANT__=' +
      JSON.stringify(merchant) + ';</script>\n',
    '<base> 與商家注入點（viewport meta）');

  // 2) 標題與 meta
  html = replaceOnce(html, /<title>[^<]*<\/title>/, () => '<title>' + title + '</title>', '<title>');
  html = replaceOnce(html, /(<meta name="description" content=")[^"]*(")/,
    (m, p1, p2) => p1 + desc + p2, 'meta description');
  html = replaceOnce(html, /(<link rel="canonical" href=")[^"]*(")/,
    (m, p1, p2) => p1 + url + p2, 'canonical');
  for (const [attr, key, value] of [
    ['property', 'og:url', url], ['property', 'og:title', title], ['property', 'og:description', desc],
    ['name', 'twitter:url', url], ['name', 'twitter:title', title], ['name', 'twitter:description', desc]
  ]) {
    const re = new RegExp('(<meta ' + attr + '="' + key + '" content=")[^"]*(")');
    html = replaceOnce(html, re, (m, p1, p2) => p1 + value + p2, key);
  }

  // 3) 商家頁一律直接進工具，不走「首次訪客導去 landing」那條路
  html = replaceOnce(html, /var pmcFromLanding = location\.search\.indexOf\('start'\) !== -1;/,
    () => "var pmcFromLanding = true; /* 商家落地頁：一律直接進工具 */",
    'pmcFromLanding 判斷');

  // 3b) 新戶活動區的警語：商家頁專屬，index.html 從來沒有過（查過 git log -S，不是 drift）。
  //     商家頁是從 Google 進來的陌生訪客第一個看到的頁，這行留著。
  html = replaceOnce(html, /(<p class="cardholder-promos-desc">[\s\S]*?<\/p>\n)/,
    (m, p1) => p1 + '                <p class="cardholder-promos-disclaimer">謹慎理財、信用至上</p>\n',
    '新戶活動說明段落（警語插入點）');

  // 4) SEO footer 樣式 ＋ JSON-LD（塞在 </head> 前）
  html = replaceOnce(html, /(\n<\/head>)/,
    (m, p1) => '\n' + MERCHANT_PAGE_STYLE +
      '<script type="application/ld+json">' + buildJsonLd(displayName, cardNames) + '</script>' + p1,
    '</head>');

  // 5) 換掉 index.html 的推薦比較佔位，並在它後面接上 SEO 說明區與 bodyHtml。
  //    三塊都掛在同一個錨點，順序才保證是：
  //      精選活動 → 推薦比較工具列 → SEO 說明區 → bodyHtml → 廣告列
  //    （位置是站長 2026-08-18 選定的：不打斷上方任何既有區塊。）
  html = replaceOnce(html, RELATED_RE,
    () => buildRelatedBar(slug, allPages) + '\n\n' +
      buildSeoFooter(displayName, cardNames) + buildBodyHtml(page.bodyHtml, displayName),
    '推薦比較工具列佔位（index.html 的 <nav class="mc-related">）');

  return html;
}

// 把「跟著 cards.data 走」的兩塊挖掉，剩下的就是版面。用來分辨「資料更新造成的落後」
// 與「有人手改了版面」——前者部署時自己會修好，後者一定要擋。
function stripDataRegions(html) {
  return html
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
    .replace(/<section class="mc-seo-footer"[\s\S]*?<\/section>/g, '')
    .replace(/<nav class="mc-related"[\s\S]*?<\/nav>/g, '');
}

async function main() {
  const cardsData = readCardsData();
  const { source, pages } = loadConfig(cardsData);
  const active = pages.filter(p => p && p.active !== false && p.active !== 'FALSE' && p.slug && p.merchant);
  const indexFile = path.join(REPO, 'index.html');
  const indexOnDisk = fs.readFileSync(indexFile, 'utf8');
  // index.html 自己也是輸出之一（首頁那條工具列），所以先清回空佔位再當模板
  const indexHtml = stripRelatedBar(indexOnDisk);

  process.stdout.write('商家頁設定來源：' + source + '（' + active.length + ' 頁）\n');

  const engine = createEngine(cardsData);
  const results = [];
  let changed = 0;
  let shellDrift = 0;   // 版面對不上：手改過，或 index.html 改了沒重生 → 擋 commit
  let dataDrift = 0;    // 只有卡片清單對不上：cards.data 更新後的正常現象 → 只提醒

  // 分成兩輪的理由：「推薦比較」工具列要寫出其他每一頁的最高回饋，
  // 所以任何一頁都得等全部算完才組得出來，不能邊算邊寫檔。
  const computed = [];
  for (const page of active) {
    const { names, top } = await computeMerchantCards(engine, page.merchant, AMOUNT);
    if (names.length === 0) {
      throw new Error(`商家「${page.merchant}」（${page.slug}）算不出任何卡片——搜尋詞可能打錯或資料已無對應項目`);
    }
    computed.push({
      page,
      cardNames: names,
      slug: String(page.slug),
      displayName: String(page.displayName || page.merchant),
      top
    });
  }

  for (const entry of computed) {
    const { page, cardNames } = entry;
    const html = buildPage(indexHtml, page, cardNames, computed);
    const file = path.join(REPO, 'merchant', page.slug + '.html');
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const same = before === html;
    let kind = '';
    if (!same) {
      changed++;
      // 兩種不一致要分開對待，否則每次 Apps Script 匯出（cards.data 一變）都會擋住
      // 所有不相干的 commit——那只會讓人習慣性忽略 preflight，比沒有檢查還糟。
      if (before !== null && stripDataRegions(before) === stripDataRegions(html)) {
        dataDrift++; kind = '（卡片清單隨 cards.data 更新）';
      } else {
        shellDrift++; kind = '（版面不一致：手改過或 index.html 改了沒重生）';
      }
    }
    if (!CHECK_ONLY && !same) fs.writeFileSync(file, html);
    results.push({ slug: page.slug, merchant: page.merchant, cards: cardNames, same });
    process.stdout.write('  ' + (same ? '＝' : (CHECK_ONLY ? '≠' : '✍')) + ' merchant/' + page.slug +
      '.html（' + cardNames.length + ' 張卡，首位 ' + cardNames[0] + '）' + kind + '\n');
  }

  // 首頁：同一條工具列，列出全部商家頁（沒有「自己」要排除，所以 currentSlug 傳 null）
  const indexOut = replaceOnce(indexHtml, RELATED_RE,
    () => buildRelatedBar(null, computed),
    '推薦比較工具列佔位（index.html 的 <nav class="mc-related">）');
  const indexSame = indexOnDisk === indexOut;
  if (!indexSame) {
    changed++;
    // 首頁只有工具列這一塊是生成的，其餘全是手寫——所以差異一律當資料面看待
    // （手改版面不會動到 <nav class="mc-related">，動到了也是這裡重生就好）
    dataDrift++;
    if (!CHECK_ONLY) fs.writeFileSync(indexFile, indexOut);
  }
  process.stdout.write('  ' + (indexSame ? '＝' : (CHECK_ONLY ? '≠' : '✍')) + ' index.html（首頁工具列，' +
    computed.length + ' 個商家頁）\n');

  if (VERIFY) await verifyAgainstBrowser(results);

  if (CHECK_ONLY) {
    if (shellDrift > 0) {
      process.stdout.write('\n❌ 有 ' + shellDrift + ' 頁的版面與生成結果不一致' +
        '——跑 node tools/build-merchant-pages.js 重新生成後再 commit\n');
      process.exit(1);
    }
    if (dataDrift > 0) {
      process.stdout.write('\n⚠️  有 ' + dataDrift + ' 頁的卡片清單落後 cards.data（部署時會自動重生，' +
        '不影響線上；想讓 repo 同步就跑 node tools/build-merchant-pages.js）\n');
      process.exit(0);
    }
    process.stdout.write('\n✅ 全部與生成結果一致\n');
    return;
  }
  process.stdout.write('\n✅ 完成（' + changed + ' 頁有變動）\n');
}

// 用真的瀏覽器開生成出來的頁，比對畫面上的卡片與我們烤進 JSON-LD 的清單。
// 這是「Node 版引擎 == 前端引擎」的唯一證明，改了 js/ 或這支工具都該重跑一次。
async function verifyAgainstBrowser(results) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) {
    process.stdout.write('\n⚠️  找不到 playwright，跳過瀏覽器比對（npm install playwright）\n');
    return;
  }
  const http = require('http');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
    '.data': 'text/plain', '.version': 'text/plain', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(REPO, p);
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  }).listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const exec = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(exec ? { executablePath: exec } : {});
  const stub = 'export default {};';
  let bad = 0;
  process.stdout.write('\n瀏覽器比對（畫面實際跑出來的卡片 vs 烤進頁面的清單）：\n');
  for (const r of results) {
    const page = await browser.newPage();
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u.startsWith(base)) return route.continue();
      if (u.includes('gstatic.com/firebasejs')) {
        const body = u.includes('firebase-auth')
          ? 'export function getAuth(){return {};} export function onAuthStateChanged(a,cb){setTimeout(function(){cb(null);},0);} export class GoogleAuthProvider{setCustomParameters(){}} export function signInWithPopup(){return Promise.resolve({});} export function signOut(){return Promise.resolve({});} export function createUserWithEmailAndPassword(){return Promise.resolve({});} export function signInWithEmailAndPassword(){return Promise.resolve({});} export function sendPasswordResetEmail(){return Promise.resolve({});}'
          : u.includes('firebase-firestore')
          ? 'export function getFirestore(){return {};} export function doc(){return {};} export function getDoc(){return Promise.resolve({exists:function(){return false;},data:function(){}});} export function setDoc(){return Promise.resolve({});} export function addDoc(){return Promise.resolve({});} export function collection(){return {};} export function serverTimestamp(){return 0;} export function deleteField(){return 0;}'
          : u.includes('firebase-app') ? 'export function initializeApp(){return {};}'
          : u.includes('firebase-analytics') ? 'export function getAnalytics(){return {};} export function logEvent(){}'
          : u.includes('firebase-storage') ? 'export function getStorage(){return {};} export function ref(){return {};} export function uploadBytes(){return Promise.resolve({});} export function getDownloadURL(){return Promise.resolve("");}'
          : stub;
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: body });
      }
      return route.abort();
    });
    await page.goto(base + '/merchant/' + encodeURIComponent(r.slug) + '.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#results-container .card-name', { timeout: 30000 });
    await page.waitForTimeout(800);
    const shown = await page.$$eval('#results-container .card-name',
      els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
    const uniqueShown = shown.filter((n, i) => shown.indexOf(n) === i);
    const ok = JSON.stringify(uniqueShown) === JSON.stringify(r.cards);
    if (!ok) {
      bad++;
      process.stdout.write('  ❌ ' + r.slug + '\n     畫面：' + uniqueShown.join(' / ') +
        '\n     頁面清單：' + r.cards.join(' / ') + '\n');
    } else {
      process.stdout.write('  ✅ ' + r.slug + '（' + r.cards.length + ' 張，逐筆一致）\n');
    }
    await page.close();
  }
  await browser.close();
  srv.close();
  if (bad > 0) {
    process.stdout.write('\n❌ 有 ' + bad + ' 頁的清單與畫面不一致——Node 版引擎與前端已分岔，先修這個再部署\n');
    process.exit(1);
  }
}

main().catch(err => { process.stderr.write('❌ ' + (err && err.stack || err) + '\n'); process.exit(1); });
