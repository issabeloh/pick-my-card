#!/usr/bin/env node
/**
 * 輸入建議下拉選單（setupMerchantSuggest，js/search-match.js）行為測試（2026-10-14 新增）
 * 凍結資料＋凍結時鐘；排除名單在頁面裡臨時塞（凍結資料沒有那一欄）。
 * 用法：node tools/regression/merchant-suggest-test.js   # 全部通過 → exit 0
 */
const fs = require('fs'), path = require('path');
const { REPO, startServer, firebaseStub, freezeClockScript, readFixtureMeta } = require('./run-regression.js');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));

(async () => {
  const srv = await startServer(false);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const execPath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(execPath ? { executablePath: execPath } : {});
  const page = await browser.newPage();
  await page.addInitScript(freezeClockScript(readFixtureMeta().frozenDate));
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('gstatic.com/firebasejs')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: firebaseStub(url) });
    return route.abort();
  });
  await page.goto(`${base}/index.html?start`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.card-count')?.textContent?.trim() || ''), null, { timeout: 20000 });
  await page.waitForSelector('#merchant-input', { state: 'visible', timeout: 20000 });
  await page.evaluate(() => {
    document.querySelectorAll('.sidebar.peek').forEach(e => e.classList.remove('peek'));
    cardsData.cards[0].basicExclusions = ['zzz交通罰單', 'zzz停車罰單'];
    cardsData = Object.assign({}, cardsData); // 換參照 → 名稱表重建
  });

  const failures = [];
  const check = (name, cond, detail) => { if (cond) console.log('✅ ' + name); else { console.log('❌ ' + name); failures.push(`${name}：${detail}`); } };
  const typeAndList = async q => {
    await page.fill('#merchant-input', '');
    await page.type('#merchant-input', q);
    await page.waitForTimeout(100);
    return page.evaluate(() => { const b = document.getElementById('merchant-suggest');
      return { open: !b.hidden, items: [...b.querySelectorAll('li')].map(li => li.textContent), bold: [...b.querySelectorAll('li mark')].map(m => m.textContent) }; });
  };

  let r = await typeAndList('zzz');
  check('排除項目也列進建議', r.open && r.items.includes('zzz交通罰單') && r.items.includes('zzz停車罰單'), JSON.stringify(r));
  r = await typeAndList('罰');
  check('單一個字就提示（中段命中也算）', r.items.includes('zzz交通罰單') && r.bold.every(b => b === '罰'), JSON.stringify(r));
  r = await typeAndList('全聯');
  check('最多 8 筆、開頭相符排前面', r.items.length <= 8 && r.items.length > 0 && r.items[0].startsWith('全聯'), JSON.stringify(r));
  const lens = r.items.filter(i => i.startsWith('全聯')).map(i => i.length);
  check('同級短的在前', lens.every((l, i) => i === 0 || lens[i - 1] <= l), JSON.stringify(r.items));

  // 鍵盤選：↓ Enter → 填入、出匹配狀態列、不自動計算、選單收起
  await typeAndList('zzz交');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const picked = await page.evaluate(() => ({
    value: document.getElementById('merchant-input').value,
    open: !document.getElementById('merchant-suggest').hidden,
    status: document.getElementById('matched-item').innerText.trim(),
    results: document.querySelectorAll('#results-container .card-result').length }));
  check('↓＋Enter 選建議：填入、選單收起', picked.value === 'zzz交通罰單' && !picked.open, JSON.stringify(picked));
  check('選建議後出「✓ 匹配到一般消費排除項目」、不自動計算',
    picked.status.includes('✓ 匹配到一般消費排除項目: zzz交通罰單') && picked.results === 0, JSON.stringify(picked));

  // 沒選建議直接 Enter：照原本計算
  await typeAndList('全聯');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const calc = await page.evaluate(() => ({ results: document.querySelectorAll('#results-container .card-result').length,
    open: !document.getElementById('merchant-suggest').hidden }));
  check('沒選建議直接 Enter → 照常計算、選單收起', calc.results > 0 && !calc.open, JSON.stringify(calc));

  // 點選
  await typeAndList('zzz停');
  await page.click('#merchant-suggest li');
  const clicked = await page.inputValue('#merchant-input');
  check('滑鼠點選建議 → 填入', clicked === 'zzz停車罰單', clicked);

  r = await typeAndList('zzz停車罰單');
  check('已經打完整、只剩自己 → 不出選單', !r.open, JSON.stringify(r));
  await page.keyboard.press('Escape');

  // 快捷選項名稱也列；點了走快捷搜尋
  const quick = await page.evaluate(() => {
    quickSearchOptions.push({ id: 'zzz-quick', displayName: 'zzz醫療費用', merchants: ['zzz交通罰單', 'zzz停車罰單'] });
    cardsData = Object.assign({}, cardsData);
    return true;
  });
  r = await typeAndList('zzz醫');
  check('快捷選項名稱也列', quick && r.items[0] === 'zzz醫療費用', JSON.stringify(r));
  await page.click('#merchant-suggest li');
  const qs = await page.evaluate(() => ({ opt: currentQuickSearchOption && currentQuickSearchOption.id,
    status: document.getElementById('matched-item').innerText.trim() }));
  check('點快捷選項 → 走快捷搜尋（排除名單用全部關鍵詞）', qs.opt === 'zzz-quick' && qs.status.includes('zzz交通罰單、zzz停車罰單'), JSON.stringify(qs));

  const xss = await page.evaluate(() => {
    cardsData.cards[0].basicExclusions = ['zzz<img src=x onerror=window.__x=1>'];
    cardsData = Object.assign({}, cardsData);
    return true;
  });
  await typeAndList('zzz<');
  check('名稱照字面顯示、不當 HTML（鐵則 3）', xss && await page.evaluate(() =>
    !document.querySelector('#merchant-suggest img') && !window.__x), 'img 被解析了');

  // 統一詞的搜尋別名（termAliases → 模糊搜尋，2026-10-14）
  const alias = await page.evaluate(() => {
    mergeDataTermAliases({ termAliases: [{ term: 'zzz動物醫院', aliases: ['zzz寵物醫院', 'zzzUberEats'] }] });
    return { a: expandSearchTerms('zzz寵物醫院'), b: expandSearchTerms('zzz動物醫院') };
  });
  check('統一詞別名：搜別名帶出統一詞、搜統一詞帶出別名', alias.a.includes('zzz動物醫院') &&
    alias.b.includes('zzz寵物醫院') && alias.b.includes('zzzubereats'), JSON.stringify(alias));

  check('沒有 page error', errors.length === 0, errors.join(' | '));
  await browser.close();
  srv.close();
  if (failures.length) { console.error(`\n❌ ${failures.length} 項失敗：\n- ` + failures.join('\n- ')); process.exit(1); }
  console.log('\n✅ 輸入建議下拉選單：全部通過');
})().catch(e => { console.error(e); process.exit(1); });
