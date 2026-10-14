#!/usr/bin/env node
/**
 * 一般消費排除項目（card.basicExclusions）行為測試（2026-09-30 新增）
 *
 * 為什麼獨立一支：凍結的 fixture.data 拍攝時還沒有 basicExclusions 欄，run-regression.js 因此
 * 完全碰不到這條路徑（那也正是它應有的樣子——沒填名單時行為必須逐字不變）。這支載入同一份
 * 凍結資料＋凍結時鐘，再在頁面裡對 cardsData.cards 臨時塞排除名單，逐情境驗證。
 *
 * 用法（repo 根目錄，需先 npm install playwright）：
 *   node tools/regression/basic-exclusions-test.js     # 全部通過 → exit 0，任一失敗 → exit 1
 *
 * 規則的正本在 js/search-match.js「一般消費排除項目」區塊。
 */
const fs = require('fs'), path = require('path');
// 凍結資料伺服器、Firebase 訪客替身、凍結時鐘一律沿用 run-regression.js（index.html 的 Firebase import 增修時只改那一份）
const { REPO, startServer, firebaseStub, freezeClockScript, readFixtureMeta } = require('./run-regression.js');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const META = readFixtureMeta();

(async () => {
  const srv = await startServer(false);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const execPath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(execPath ? { executablePath: execPath } : {});
  const page = await browser.newPage();
  await page.addInitScript(freezeClockScript(META.frozenDate));
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // 外部資源（廣告/字型）被 route.abort() 擋掉會噴 Failed to load resource，那是測試環境刻意的，不算
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text());
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('gstatic.com/firebasejs')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: firebaseStub(url) });
    return route.abort();
  });
  await page.goto(`${base}/index.html?start&debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.card-count')?.textContent?.trim() || ''), null, { timeout: 20000 });
  await page.waitForSelector('#merchant-input', { state: 'visible', timeout: 20000 });
  const total = await page.evaluate(() => cardsData.cards.length);

  // setup：{ all: [...] } 全部卡塞同一份名單；{ first: n, items: [...] } 只塞前 n 張
  async function search(query, setup) {
    await page.evaluate(s => {
      cardsData.cards.forEach((c, i) => {
        delete c.basicExclusions;
        if (s && s.all) c.basicExclusions = s.all.slice();
        if (s && s.first && i < s.first) c.basicExclusions = s.items.slice();
      });
      for (const id of ['results-container', 'coupon-results-container', 'parking-benefits-container']) {
        const el = document.getElementById(id); if (el) el.innerHTML = '';
      }
      const m = document.getElementById('matched-item'); m.innerHTML = ''; m.style.display = 'none';
    }, setup || null);
    await page.fill('#amount-input', '1000');
    await page.fill('#merchant-input', query);
    await page.click('#calculate-btn');
    await page.waitForFunction(() => document.getElementById('matched-item').innerText.trim().length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    return page.evaluate(() => ({
      // cards＝一般結果卡；excluded＝灰色「一般消費排除」卡（2026-10-11 起排除的卡不拿掉、改成灰卡墊底）
      cards: [...document.querySelectorAll('#results-container .card-result:not(.excluded-card)')].map(el =>
        el.querySelector('.card-name')?.innerText.trim()),
      excluded: [...document.querySelectorAll('#results-container .card-result.excluded-card')].map(el => ({
        name: el.querySelector('.card-name')?.innerText.trim(),
        items: el.querySelector('.excluded-card-match strong')?.innerText.trim(),
        label: el.querySelector('.excluded-card-match')?.innerText.split(':')[0].trim(),
        badge: el.querySelector('.excluded-badge')?.innerText.trim(),
        maybe: el.classList.contains('maybe-excluded-card'),
        hasRateFields: !!el.querySelector('.detail-label, .cashback-amount, .calc-breakdown-btn'),
      })),
      lastIsExcluded: (() => { const all = [...document.querySelectorAll('#results-container .card-result')];
        const firstEx = all.findIndex(el => el.classList.contains('excluded-card'));
        return firstEx < 0 || all.slice(firstEx).every(el => el.classList.contains('excluded-card')); })(),
      title: document.querySelector('#results-section h2')?.innerText.trim(),
      maybe: [...document.querySelectorAll('#results-container .card-result:not(.excluded-card) .maybe-excluded-note')].map(el => ({
        name: el.closest('.card-result').querySelector('.card-name')?.innerText.trim(), text: el.innerText.trim() })),
      status: document.getElementById('matched-item').innerText.replace(/\s+/g, ' ').trim(),
      noResultsBox: !!document.querySelector('#results-container .no-results'),
      firstNames: cardsData.cards.slice(0, 5).map(c => c.name),
    }));
  }

  const failures = [];
  const check = (name, cond, detail) => {
    console.log(`${cond ? '✅' : '❌'} ${name}`);
    if (!cond) failures.push(`${name}：${detail}`);
  };

  // 0. 沒填名單＝行為不變（基本回饋全列）
  let r = await search('zzz繳稅');
  check('無名單：全部卡顯示基本回饋、沒有排除字樣', r.cards.length === total && !/排除項目/.test(r.status),
    `cards=${r.cards.length}/${total} status=${r.status}`);

  // 1. 全部排除 → 只剩灰色排除卡、講清楚沒有回饋、也不出「無符合的信用卡」框
  r = await search('繳稅', { all: ['繳稅', '學費'] });
  check('全部排除：沒有一般結果卡，全部是灰色排除卡', r.cards.length === 0 && r.excluded.length === total,
    `cards=${r.cards.length} excluded=${r.excluded.length}`);
  check('全部排除：灰卡只寫命中的排除項目，不出回饋率/金額/上限', r.excluded.every(e => e.items === '繳稅' && !e.hasRateFields),
    JSON.stringify(r.excluded.slice(0, 2)));
  check('全部排除：結果標題是「一般消費排除項目」', r.title === '一般消費排除項目', r.title);
  check('全部排除：狀態列說明是一般消費排除項目、沒有任何回饋',
    r.status.includes(`你比較的 ${total} 張卡都沒有「繳稅」的活動`) && r.status.includes('一般消費排除項目') &&
    r.status.includes('包含基本回饋'), r.status);
  check('全部排除：不出現「無符合的信用卡」框', !r.noResultsBox, 'no-results 框出現了');

  // 2. 部分排除 → 其餘照常顯示基本回饋，狀態列補一行
  r = await search('繳稅', { first: 5, items: ['繳稅'] });
  check('部分排除：剩下的卡照常顯示', r.cards.length === total - 5, `cards=${r.cards.length}，預期 ${total - 5}`);
  check('部分排除：被排除的 5 張是灰卡、不在一般結果裡',
    r.firstNames.every(n => !r.cards.includes(n) && r.excluded.some(e => e.name === n)) && r.excluded.length === 5,
    `excluded=${r.excluded.map(e => e.name).join('、')}`);
  check('部分排除：灰卡墊底', r.lastIsExcluded, '灰卡後面還有一般卡');
  check('部分排除：標題兩種都講', r.title === '一般回饋與一般消費排除項目', r.title);
  check('部分排除：狀態列補「另有 5 張卡…見下方灰色卡片」',
    r.status.includes('另有 5 張卡把「繳稅」列為一般消費排除項目，刷卡無回饋（見下方灰色卡片）'), r.status);

  // 3. 搜尋詞「包含」排除詞也算（用造的詞：真實詞如「人壽保費」會先匹配到保費活動，走活動路徑）
  r = await search('zzz國泰qq代繳費', { all: ['qq代繳'] });
  check('包含規則：搜尋詞含排除詞 → 排除', r.cards.length === 0 && r.status.includes('一般消費排除項目'),
    `cards=${r.cards.length} status=${r.status}`);
  check('包含規則：灰卡顯示的是命中的排除項目（不是搜尋詞）', r.excluded.length > 0 && r.excluded[0].items === 'qq代繳',
    JSON.stringify(r.excluded[0]));

  // 4. 反方向不判「確定排除」：排除詞含搜尋詞 → 只當「可能排除」灰卡（2026-10-11 起，原本照常顯示基本回饋）
  r = await search('zzz代', { all: ['zzz代收'] });
  check('反方向：排除詞「zzz代收」對搜尋「zzz代」只算可能排除', r.excluded.length === total && r.excluded.every(e => e.maybe),
    `excluded=${r.excluded.length} status=${r.status}`);

  // 5. 單字排除詞一律忽略（「稅」會誤殺「免稅店」）
  r = await search('zzz免稅', { all: ['稅'] });
  check('單字排除詞忽略', r.cards.length === total, `cards=${r.cards.length}`);

  // 6. 有指定活動的卡：活動優先、照常顯示；沒有活動、但名單命中的卡補成灰卡墊底（2026-10-11 起）
  const baseline = await search('家樂福');
  r = await search('家樂福', { all: ['家樂福'] });
  const activityCards = new Set(baseline.cards).size;
  check('活動優先：有活動的卡照常顯示（與沒名單時完全相同）',
    baseline.cards.length > 0 && JSON.stringify(r.cards) === JSON.stringify(baseline.cards),
    `baseline=${baseline.cards.length} now=${r.cards.length}`);
  check('有指定通路結果時：其餘命中名單的卡補成灰卡墊底', r.excluded.length === total - activityCards && r.lastIsExcluded,
    `excluded=${r.excluded.length} 預期 ${total - activityCards}`);
  check('有指定通路結果時：活動筆數不含灰卡、補一行排除說明',
    r.status.includes(`有 ${baseline.cards.length} 筆活動符合你的選項`) &&
    r.status.includes(`另有 ${total - activityCards} 張卡把「家樂福」列為一般消費排除項目，刷卡無回饋（見下方灰色卡片）`), r.status);
  check('有指定通路結果時：標題是「指定通路回饋與一般消費排除項目」', r.title === '指定通路回饋與一般消費排除項目', r.title);
  r = await search('家樂福');
  check('沒名單時：有指定通路結果也不出灰卡', r.excluded.length === 0 && !/排除項目/.test(r.status), r.status);

  // 7. 勾「精準搜尋」時只認全等（2026-10-11 站長決定）
  await page.evaluate(() => { const cb = document.getElementById('exact-search-checkbox'); if (cb && !cb.checked) cb.click(); });
  r = await search('zzz台電電費', { all: ['電費'] });
  check('精準搜尋：搜尋詞只是「包含」排除詞 → 不排除', r.cards.length === total && !/排除項目/.test(r.status),
    `cards=${r.cards.length} status=${r.status}`);
  r = await search('zzz電費', { all: ['zzz電費'] });
  check('精準搜尋：全等 → 照樣排除', r.cards.length === 0 && r.excluded.length === total, `cards=${r.cards.length}`);
  await page.evaluate(() => { const cb = document.getElementById('exact-search-checkbox'); if (cb && cb.checked) cb.click(); });

  // 8. 搜尋詞只有輸入＋fuzzy 別名，不含 findMatchingItem 匹配到的 item 名（站長決定）
  const terms = await page.evaluate(() => ({ quan: getBasicExclusionSearchTerms('全聯'), park: getBasicExclusionSearchTerms('停車') }));
  check('搜尋詞：fuzzy 別名照算（全聯 → 全聯福利中心）', terms.quan.includes('全聯福利中心'), terms.quan.join('|'));
  check('搜尋詞：不含匹配到的商家名（停車 只有自己）', terms.park.length === 1 && terms.park[0] === '停車', terms.park.join('|'));

  // 8b. 「可能排除」：搜尋詞比名單項目短 → 同樣是灰卡，標籤「可能屬於排除項目」（2026-10-11 站長改）
  r = await search('zzz醫院費用', { first: 2, items: ['臺北醫學大學附設zzz醫院費用'] });
  check('可能排除：那 2 張變灰卡，其餘照常', r.cards.length === total - 2 && r.excluded.length === 2 &&
    r.excluded.every(e => e.maybe && r.firstNames.slice(0, 2).includes(e.name)), JSON.stringify(r.excluded));
  check('可能排除：標籤「可能屬於排除項目」、徽章維持「一般消費排除」、寫出完整項目、不出回饋欄位',
    r.excluded.every(e => e.label === '可能屬於排除項目' && e.badge === '一般消費排除' && e.items === '臺北醫學大學附設zzz醫院費用' && !e.hasRateFields),
    JSON.stringify(r.excluded[0]));
  check('可能排除：狀態列補「另有 2 張卡可能排除…」', r.status.includes('另有 2 張卡可能排除「zzz醫院費用」（見下方灰色卡片）'), r.status);
  r = await search('zzz醫院費用', { all: ['臺北醫學大學附設zzz醫院費用'] });
  check('可能排除：全部都是灰卡時用專用狀態列（不說「都列為排除」、也不說「以下顯示基本回饋」）',
    r.excluded.length === total && r.status.includes(`有 ${total} 張卡可能排除「zzz醫院費用」，請看下方灰色卡片確認`) &&
    !/都把它列為/.test(r.status) && !/以下結果顯示基本回饋/.test(r.status), r.status);
  r = await search('zzz費用', { first: 1, items: ['zzz費用'], });
  check('確定命中優先於可能命中', r.excluded.length === 1 && !r.excluded[0].maybe, JSON.stringify(r.excluded));
  await page.evaluate(() => { const cb = document.getElementById('exact-search-checkbox'); if (cb && !cb.checked) cb.click(); });
  r = await search('zzz醫院費用', { first: 2, items: ['臺北醫學大學附設zzz醫院費用'] });
  check('可能排除：勾精準搜尋時不出', r.excluded.length === 0, JSON.stringify(r.excluded));
  await page.evaluate(() => { const cb = document.getElementById('exact-search-checkbox'); if (cb && cb.checked) cb.click(); });

  // 9. 詳情頁「一般回饋」區最後一張是灰色「一般消費排除項目」卡；項目多時先收合
  const detail = await page.evaluate(async () => {
    const card = cardsData.cards[0];
    card.basicExclusions = Array.from({ length: 12 }, (_, i) => 'zzz項目' + (i + 1));
    await showCardDetail(card.id);
    await new Promise(res => setTimeout(res, 300));
    const box = document.querySelector('#card-basic-cashback .rate-card-excluded');
    const last = document.querySelector('#card-basic-cashback > .cashback-detail-item:last-child');
    const out = box ? {
      isLast: last === box,
      title: box.querySelector('.rate-card-title')?.innerText.trim(),
      shown: box.querySelector('.matched-merchant strong')?.innerText.trim(),
      btn: box.querySelector('.show-more-btn')?.innerText.trim(),
      hasRate: !!box.querySelector('.rate-card-rate'),
    } : null;
    delete card.basicExclusions;
    await showCardDetail(card.id);
    await new Promise(res => setTimeout(res, 300));
    const gone = !document.querySelector('#card-basic-cashback .rate-card-excluded');
    document.querySelector('#card-detail-modal .close, #card-detail-modal [data-close]')?.click();
    return { out, gone };
  });
  check('詳情頁：一般回饋區最後一張是「一般消費排除項目」灰卡、沒有回饋率欄',
    detail.out && detail.out.isLast && detail.out.title === '一般消費排除項目' && !detail.out.hasRate, JSON.stringify(detail.out));
  check('詳情頁：超過 10 項先收合、有「顯示全部12個」', detail.out && detail.out.btn && detail.out.btn.includes('顯示全部12個') &&
    detail.out.shown.split('、').length === 10, JSON.stringify(detail.out));
  check('詳情頁：沒有名單就不出現', detail.gone, '沒名單仍出現排除卡');

  // 輸入時的匹配提示也講排除名單（2026-10-14）
  // 上面詳情頁的測試會留著 modal（它的關閉鈕選擇器對不到），蓋住計算鈕
  await page.evaluate(() => { const m = document.getElementById('card-detail-modal'); if (m) m.style.display = 'none'; document.body.style.overflow = ''; });
  async function typePreview(query, items) {
    await page.evaluate(list => cardsData.cards.forEach(c => { c.basicExclusions = list.slice(); }), items);
    await page.fill('#merchant-input', '');
    await page.fill('#merchant-input', query);
    await page.waitForTimeout(150);
    return page.evaluate(() => { const m = document.getElementById('matched-item');
      return { shown: m.style.display !== 'none', text: m.innerText.replace(/\s+/g, ' ').trim(), cls: m.className }; });
  }
  let pv = await typePreview('罰單', ['交通罰單', '停車罰單']);
  check('輸入預覽：沒有商家匹配、命中排除名單 → 出「✓ 匹配到一般消費排除項目」',
    pv.shown && pv.text === '✓ 匹配到一般消費排除項目: 交通罰單、停車罰單' && pv.cls === 'matched-item', JSON.stringify(pv));
  pv = await typePreview('全聯', ['全聯福利中心']);
  check('輸入預覽：有商家匹配又命中排除名單 → 兩行都出',
    /^✓ 匹配到: /.test(pv.text) && pv.text.includes('✓ 匹配到一般消費排除項目: 全聯福利中心'), JSON.stringify(pv));
  pv = await typePreview('罰單', []);
  check('輸入預覽：沒名單時不出排除那行（沒商家匹配 → 整列收起）', !pv.shown, JSON.stringify(pv));
  pv = await typePreview('費用', Array.from({ length: 7 }, (_, i) => 'zzz費用' + i));
  check('輸入預覽：最多列 5 個，其餘寫「等 N 項」', pv.text.includes('zzz費用4 等 7 項') && !pv.text.includes('zzz費用5'), JSON.stringify(pv));

  // 快捷搜尋的關鍵詞全是排除項目（如「醫療費用」）：預覽要出、計算時用全部關鍵詞比名單
  const quick = await page.evaluate(() => {
    cardsData.cards.forEach(c => { c.basicExclusions = ['醫指付APP', 'zzz公部門醫療服務費用'] ; });
    handleQuickSearch({ displayName: 'zzz醫療費用', merchants: ['zzz公部門醫療服務費用', '醫指付'] });
    const m = document.getElementById('matched-item');
    return { text: m.innerText.replace(/\s+/g, ' ').trim(), kept: !!currentQuickSearchOption };
  });
  check('快捷搜尋：關鍵詞全是排除項目 → 預覽列出命中項目、選項保留',
    quick.kept && quick.text.startsWith('✓ 匹配到一般消費排除項目: ') && quick.text.includes('醫指付APP'), JSON.stringify(quick));
  await page.fill('#amount-input', '1000');
  await page.click('#calculate-btn');
  await page.waitForTimeout(600);
  const quickRes = await page.evaluate(() => ({
    excluded: document.querySelectorAll('#results-container .card-result.excluded-card').length,
    normal: document.querySelectorAll('#results-container .card-result:not(.excluded-card)').length }));
  check('快捷搜尋：計算時用全部關鍵詞比名單 → 全部卡變灰卡', quickRes.normal === 0 && quickRes.excluded === total, JSON.stringify(quickRes));
  await page.evaluate(() => { cardsData.cards.forEach(c => delete c.basicExclusions); currentQuickSearchOption = null; });
  await page.fill('#merchant-input', '');

  // 詳情頁搜尋框也查一般回饋區（2026-10-14）：第 11 項以後的名單要能搜到（收合時不在 DOM 裡）；
  // 沒命中的國內／海外一般消費卡要藏起來；命中項目前後沒命中的縮成「…」
  const dsearch = await page.evaluate(async () => {
    const card = cardsData.cards[0];
    card.basicExclusions = [...Array.from({ length: 10 }, (_, i) => 'zzz項目' + (i + 1)), '交通罰單', 'zzz項目11', '停車罰單', 'zzz項目12'];
    await showCardDetail(card.id);
    await new Promise(res => setTimeout(res, 300));
    const input = document.getElementById('cashback-search-input');
    const run = v => { input.value = v; filterCashbackItems(v); };
    const basic = document.getElementById('card-basic-cashback');
    const box = () => basic.querySelector('.rate-card-excluded');
    const visible = () => [...basic.querySelectorAll('.cashback-detail-item')].filter(el => el.style.display !== 'none').length;
    const totalBasic = basic.querySelectorAll('.cashback-detail-item').length;
    run('罰');
    const hit = { visible: visible(), list: box().querySelector('strong.merchant-list').textContent,
      marks: [...box().querySelectorAll('mark.cashback-search-hl')].map(m => m.textContent) };
    run('zzzz不存在');
    const miss = { sectionShown: document.getElementById('card-basic-cashback-section').style.display };
    run('');
    const cleared = { visible: visible(), sectionShown: document.getElementById('card-basic-cashback-section').style.display,
      marks: basic.querySelectorAll('mark').length, list: box().querySelector('strong.merchant-list').textContent,
      btn: box().querySelector('.show-more-btn')?.innerText.trim() };
    delete card.basicExclusions;
    document.querySelector('#card-detail-modal .close, #card-detail-modal [data-close]')?.click();
    return { hit, miss, cleared, totalBasic };
  });
  check('詳情頁搜尋：「罰」→ 一般回饋區只留排除灰卡（國內／海外一般消費藏起來）',
    dsearch.totalBasic > 1 && dsearch.hit.visible === 1, JSON.stringify(dsearch));
  check('詳情頁搜尋：清單只留命中項目，沒命中的段落縮成「…」',
    dsearch.hit.list === '…、交通罰單、…、停車罰單、…', dsearch.hit.list);
  check('詳情頁搜尋：命中字標記', dsearch.hit.marks.length === 2, JSON.stringify(dsearch.hit.marks));
  check('詳情頁搜尋：一般回饋區一張不剩 → 整區收起', dsearch.miss.sectionShown === 'none', JSON.stringify(dsearch.miss));
  check('詳情頁搜尋：清空 → 全部回來、清單還原收合、標記清掉',
    dsearch.cleared.visible === dsearch.totalBasic && dsearch.cleared.sectionShown === '' && dsearch.cleared.marks === 0 &&
    dsearch.cleared.list.split('、').length === 10 && /顯示全部/.test(dsearch.cleared.btn || ''), JSON.stringify(dsearch.cleared));
  const split = await page.evaluate(() => splitMerchantList('新光三越(桃園、林口)、全聯（台北、新北）、7-11'));
  check('通路清單切分：括號裡的頓號不切', split.length === 3 && split[0] === '新光三越(桃園、林口)', JSON.stringify(split));

  check('沒有 console error', errors.length === 0, errors.join(' | '));

  await browser.close();
  srv.close();
  if (failures.length) {
    console.error(`\n❌ ${failures.length} 項失敗：\n- ` + failures.join('\n- '));
    process.exit(1);
  }
  console.log('\n✅ 一般消費排除項目：全部通過');
})().catch(e => { console.error(e); process.exit(1); });
