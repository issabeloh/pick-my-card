#!/usr/bin/env node
/**
 * 「我的信用卡」單卡面板測試（2026-11-22：點卡片 → 同一個視窗直接編輯該卡個人設定；補上結帳日／繳款截止日）。
 *
 * 用法（repo 根目錄）：node tools/regression/owned-cards-panel-test.js   （有 ❌ → exit 1）
 *
 * 驗的是「共用、不複製」與鐵則 1：
 *  - 整頁只有一份 #card-personal-section，開面板時搬進 #owned-panel-settings、開詳情頁時搬回去；詳情頁不會被彈出來
 *  - 控制項樣式在面板裡跟詳情頁一樣（CSS 掛在 #card-personal-section）
 *  - 結帳日／繳款截止日：#statement-date→statementDate、#billing-date→billingDate（欄位名跟意思相反，站長確認）；
 *    訪客存 billingDates_local_<id>、登入者存 users/<uid>.billingDates；失敗照實顯示紅字；卡片格多一行
 *  - 🔒 鐵則 1：開面板不呼叫 saveCardLevel；存的級別找不到只顯示預設、不寫回；用戶改級別才存一次，且不打開詳情頁
 *  - 打完筆記立刻按「‹ 所有卡片」或關閉 → 筆記照樣存
 *  - 選卡 modal（管理我的信用卡／管理加入比較的卡片／管理我的行動支付）的儲存列：有改動才出現、固定在底部；管理視窗跟「我的信用卡」同寬
 * 沿用 run-regression.js 的凍結資料與時鐘、card-settings-promo-test.js 的 Firebase 替身。
 */
'use strict';
const path = require('path');
const { REPO, startServer, freezeClockScript, readFixtureMeta } = require('./run-regression.js');
const { stub } = require('./card-settings-promo-test.js');
let chromium;
try { ({ chromium } = require(path.join(REPO, 'node_modules', 'playwright'))); }
catch (e) { ({ chromium } = require('playwright')); }

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log((ok ? '  ✅ ' : '  ❌ ') + name + (extra ? ' — ' + extra : '')); };

if (require.main === module) (async () => {
  const srv = await startServer(false);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const frozen = readFixtureMeta().frozenDate;
  const errors = [];

  async function open(guest, width = 390) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript(freezeClockScript(frozen));
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|simulated|Firestore 保存失敗/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 200)); });
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(base)) return r.continue();
      if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: stub(u, guest) });
      return r.abort();
    });
    await page.goto(`${base}/index.html?start`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(g => typeof cardsData !== 'undefined' && cardsData && cardsData.cards && cardsData.cards.length > 0 &&
      typeof appStarted !== 'undefined' && appStarted && (g || (typeof currentUser !== 'undefined' && currentUser)), guest, { timeout: 20000 });
    await page.waitForTimeout(300);
    // 持有卡：CUBE、玉山 Unicard（分級）、一張非分級卡；saveCardLevel 掛上計數器（鐵則 1）
    await page.evaluate(() => {
      const plain = cardsData.cards.find(c => !c.hasLevels).id;
      myOwnedCards = new Set(['cathay-cube', 'yushan-unicard', plain]);
      window.__plain = plain;
      window.__lvCalls = [];
      const orig = saveCardLevel;
      window.saveCardLevel = function (id, lv) { window.__lvCalls.push([id, lv]); return orig.apply(this, arguments); };
    });
    return page;
  }
  const state = p => p.evaluate(() => {
    const sec = document.getElementById('card-personal-section');
    const vis = id => { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; };
    return {
      inPanel: !!sec.closest('#owned-panel-settings'),
      inDetail: !!sec.closest('#card-detail-modal'),
      secCount: document.querySelectorAll('#card-personal-section').length,
      panel: vis('owned-card-panel'), grid: vis('owned-cards-overview'), back: vis('owned-panel-back'),
      title: vis('owned-modal-title'), manage: vis('manage-owned-cards-btn'),
      detailOpen: document.getElementById('card-detail-modal').style.display === 'flex',
      ownedOpen: document.getElementById('my-owned-cards-modal').style.display === 'flex',
      status: document.getElementById('cd-save-status').dataset.state,
      statusText: document.querySelector('#cd-save-status .cd-sv-t').textContent
    };
  });
  const tile = (p, id) => p.evaluate(id => { const c = cardsData.cards.find(x => x.id === id); return [...document.querySelectorAll('.ow-tile')].find(t => t.querySelector('.ow-name') && t.querySelector('.ow-name').textContent === c.name).textContent; }, id);
  const clickTile = async (p, id) => { await p.evaluate(id => { const c = cardsData.cards.find(x => x.id === id); [...document.querySelectorAll('.ow-tile')].find(t => t.querySelector('.ow-name') && t.querySelector('.ow-name').textContent === c.name).click(); }, id); await p.waitForTimeout(600); };

  console.log('A. 訪客');
  let p = await open(true);
  await p.evaluate(() => localStorage.setItem('cardLevel-yushan-unicard', '不存在的級別'));
  await p.evaluate(() => openMyOwnedCardsModal()); await p.waitForTimeout(500);
  await clickTile(p, 'cathay-cube');
  let st = await state(p);
  check('點卡片 → 同一個視窗換成單卡面板：卡片格／標題／管理卡片藏起來，出現「‹ 所有卡片」', st.ownedOpen && st.panel && !st.grid && st.back && !st.title && !st.manage, JSON.stringify(st));
  check('設定區是詳情頁那一份搬進來的（整頁只有 1 份），詳情頁沒有被打開', st.inPanel && !st.inDetail && st.secCount === 1 && !st.detailOpen);
  check('面板顯示卡名與 CUBE 的計算條件欄位', await p.evaluate(() => document.getElementById('owned-panel-name').textContent === cardsData.cards.find(c => c.id === 'cathay-cube').name &&
    !!document.getElementById('card-level-select') && !!document.getElementById('cube-issuer-select') && !!document.getElementById('children-eligible-checkbox')));
  check('控制項樣式跟詳情頁一樣（下拉 36px 高、開關是自訂外觀）', await p.evaluate(() => {
    const sel = getComputedStyle(document.getElementById('statement-date')); const sw = getComputedStyle(document.getElementById('fee-waiver-checked'));
    return sel.height === '36px' && sel.width === '132px' && sw.appearance === 'none' && sw.width === '40px'; }));
  check('面板裡不顯示「個人設定」標題與「可以在我的信用卡…」提示', await p.evaluate(() => getComputedStyle(document.querySelector('#card-personal-section .cd-set-h')).display === 'none' && getComputedStyle(document.querySelector('#card-personal-section .cd-set-foot')).display === 'none'));
  check('結帳日／繳款截止日：未設定＋每月 1–31 日', await p.evaluate(() => ['statement-date', 'billing-date'].every(id => { const o = [...document.getElementById(id).options]; return o.length === 32 && o[0].textContent === '未設定' && o[0].value === '' && o[31].textContent === '每月 31 日'; })));
  await p.selectOption('#statement-date', '5'); await p.waitForTimeout(500);
  await p.selectOption('#billing-date', '20'); await p.waitForTimeout(600);
  st = await state(p);
  check('選結帳日 5、繳款日 20 → 訪客 key 存 {billingDate:"20", statementDate:"5"}，狀態列黃色帶時間',
    await p.evaluate(() => localStorage.getItem('billingDates_local_cathay-cube')) === '{"billingDate":"20","statementDate":"5"}' && st.status === 'local' && /・今天/.test(st.statusText), st.statusText);
  await p.fill('#credit-limit-input', '200000'); await p.press('#credit-limit-input', 'Enter'); await p.waitForTimeout(500);
  await p.click('label[for="fee-waiver-checked"]'); await p.waitForTimeout(500);
  await p.selectOption('#cube-issuer-select', 'JCB'); await p.waitForTimeout(500);
  check('面板裡改額度／免年費／發卡組織：存進各自既有的 key', await p.evaluate(() => localStorage.getItem('creditLimit_local_cathay-cube') === '200000' && localStorage.getItem('feeWaiver_local_cathay-cube') === 'true' && localStorage.getItem('cubeIssuer') === 'JCB'));
  check('改了 CUBE 設定詳情頁仍沒打開', !(await state(p)).detailOpen);
  await p.fill('#user-notes-input', '面板裡的筆記');
  await p.click('#owned-panel-back'); await p.waitForTimeout(800);
  st = await state(p);
  check('打完筆記立刻按「‹ 所有卡片」→ 筆記存了', await p.evaluate(() => localStorage.getItem('notes_cathay-cube')) === '面板裡的筆記');
  check('「‹ 所有卡片」→ 回到卡片格、設定區搬回詳情頁', st.grid && !st.panel && !st.back && st.title && st.manage && st.inDetail && !st.inPanel);
  const t = await tile(p, 'cathay-cube');
  check('卡片格立刻更新：額度 20 萬、「5 日結帳・20 日繳款」、已過免年費門檻', /額度 20 萬/.test(t) && /5 日結帳・20 日繳款/.test(t) && /已過免年費門檻/.test(t), t);
  check('沒填日期的卡不多那一行', !/結帳|繳款/.test(await tile(p, 'yushan-unicard')));

  // 鐵則 1：存的級別找不到 → 面板顯示預設、不寫回；用戶改了才存一次
  await clickTile(p, 'yushan-unicard');
  check('🔒 開面板（存的級別找不到）：沒呼叫 saveCardLevel、本機值沒被改', await p.evaluate(() => window.__lvCalls.length === 0 && localStorage.getItem('cardLevel-yushan-unicard') === '不存在的級別'));
  const opts = await p.evaluate(() => [...document.getElementById('card-level-select').options].map(o => o.value));
  await p.selectOption('#card-level-select', opts[1]); await p.waitForTimeout(800);
  st = await state(p);
  check('🔒 用戶改級別 → saveCardLevel 剛好一次、存進去，且沒打開詳情頁、仍在面板', await p.evaluate(v => window.__lvCalls.length === 1 && window.__lvCalls[0][1] === v && localStorage.getItem('cardLevel-yushan-unicard') === v, opts[1]) && !st.detailOpen && st.panel && st.inPanel);
  await p.click('#owned-panel-back'); await p.waitForTimeout(600);
  check('卡片格顯示新級別', (await tile(p, 'yushan-unicard')).startsWith(await p.evaluate(() => cardsData.cards.find(c => c.id === 'yushan-unicard').name) + opts[1]));

  // 非分級卡：沒有計算條件組
  await clickTile(p, await p.evaluate(() => window.__plain));
  check('非分級卡：沒有「計算條件」組，日期欄位已清成未設定', await p.evaluate(() => document.getElementById('cube-level-section').style.display === 'none' && document.getElementById('statement-date').value === '' && document.getElementById('billing-date').value === ''));

  // 查看回饋詳情 → 詳情頁開、設定區回詳情頁、下面回卡片格
  await p.click('#owned-panel-detail'); await p.waitForTimeout(800);
  st = await state(p);
  check('「查看回饋詳情 ›」→ 詳情頁打開、設定區回到詳情頁、下層回到卡片格', st.detailOpen && st.inDetail && !st.inPanel && st.grid && !st.panel);
  await p.evaluate(() => selectCardDetailTab('set')); await p.waitForTimeout(200);
  check('詳情頁的個人設定頁籤照常可見、有提示行', await p.evaluate(() => { const s = document.getElementById('card-personal-section'); return !s.hidden && s.offsetParent !== null && getComputedStyle(s.querySelector('.cd-set-foot')).display !== 'none'; }));
  await p.evaluate(() => document.getElementById('close-card-detail').click()); await p.waitForTimeout(400);
  check('關掉詳情頁 → 回到「我的信用卡」卡片格', (await state(p)).grid && (await state(p)).ownedOpen);

  // 面板開著直接關掉 modal → 再開是卡片格；打完的筆記也存
  await clickTile(p, 'cathay-cube');
  await p.fill('#user-notes-input', '關閉前的筆記');
  await p.click('#close-owned-modal'); await p.waitForTimeout(800);
  check('面板開著按 × → 筆記存了、設定區搬回詳情頁', await p.evaluate(() => localStorage.getItem('notes_cathay-cube')) === '關閉前的筆記' && (await state(p)).inDetail);
  await p.evaluate(() => openMyOwnedCardsModal()); await p.waitForTimeout(400);
  st = await state(p);
  check('再打開「我的信用卡」→ 從卡片格開始', st.grid && !st.panel && st.title);
  // 從詳情頁直接改日期，兩邊是同一份資料
  await p.evaluate(() => document.getElementById('close-owned-modal').click());
  await p.evaluate(() => showCardDetail('cathay-cube')); await p.waitForTimeout(600);
  check('詳情頁也有結帳日／繳款日，值是剛剛在面板存的', await p.evaluate(() => document.getElementById('statement-date').value === '5' && document.getElementById('billing-date').value === '20'));
  await p.context().close();

  console.log('A3. 選卡 modal 的儲存列（2026-11-22：有改動才出現、固定在底部）');
  p = await open(true, 1280);
  await p.evaluate(() => openMyOwnedCardsModal()); await p.waitForTimeout(400);
  await p.click('#manage-owned-cards-btn'); await p.waitForTimeout(400);
  const foot = (p, id) => p.evaluate(id => { const f = document.getElementById(id).closest('.modal').querySelector('.sel-footer'); return { shown: !f.hidden && f.offsetParent !== null, text: f.querySelector('.sel-dirty').textContent }; }, id);
  check('上方的儲存鈕拿掉了', await p.evaluate(() => !document.getElementById('save-owned-cards-btn-top') && !document.getElementById('save-cards-btn-quick')));
  check('桌機：「管理我的信用卡」跟後面的「我的信用卡」同寬（蓋得住）', await p.evaluate(() => {
    const a = document.querySelector('#my-owned-cards-modal .modal-content').getBoundingClientRect(); const b = document.querySelector('#manage-owned-cards-modal .modal-content').getBoundingClientRect();
    return Math.abs(a.width - b.width) < 1 && b.left <= a.left + 1 && b.right >= a.right - 1; }));
  check('沒改動 → 沒有儲存列', !(await foot(p, 'owned-cards-selection')).shown);
  const firstOff = await p.evaluate(() => [...document.querySelectorAll('#owned-cards-selection input')].find(c => !c.checked).id);
  await p.click('#' + firstOff); await p.waitForTimeout(100);
  let f = await foot(p, 'owned-cards-selection');
  check('勾一張 → 出現「已變更 1 張」儲存列', f.shown && f.text === '已變更 1 張', f.text);
  check('儲存列固定在視窗底部（捲到最上面也看得到）', await p.evaluate(() => {
    const m = document.querySelector('#manage-owned-cards-modal .modal-content'); m.scrollTop = 0;
    const fr = m.querySelector('.sel-footer').getBoundingClientRect(); const mr = m.getBoundingClientRect();
    return m.scrollHeight > m.clientHeight && Math.abs(fr.bottom - mr.bottom) < 2; }));
  await p.click('#' + firstOff); await p.waitForTimeout(100);
  check('勾回原樣 → 儲存列消失', !(await foot(p, 'owned-cards-selection')).shown);
  await p.click('#toggle-all-owned-cards'); await p.waitForTimeout(100);
  f = await foot(p, 'owned-cards-selection');
  check('「全選」也會更新（已變更 N 張）', f.shown && /^已變更 \d+ 張$/.test(f.text), f.text);
  await p.click('#save-owned-cards-btn'); await p.waitForTimeout(500);
  check('儲存 → 關掉管理、持有卡＝全部', await p.evaluate(() => document.getElementById('manage-owned-cards-modal').style.display === 'none' && myOwnedCards.size === cardsData.cards.length));
  await p.click('#manage-owned-cards-btn'); await p.waitForTimeout(400);
  check('再打開 → 以新的勾選為基準，沒有儲存列', !(await foot(p, 'owned-cards-selection')).shown);
  await p.evaluate(() => { document.getElementById('close-manage-owned-modal').click(); document.getElementById('close-owned-modal').click(); });
  // 管理加入比較的卡片：同一套
  await p.evaluate(() => openManageCardsModal()); await p.waitForTimeout(400);
  check('加入比較：沒改動 → 沒有儲存列', !(await foot(p, 'cards-selection')).shown);
  await p.evaluate(() => { const c = document.querySelector('#cards-selection .card-checkbox-image'); c.click(); });
  f = await foot(p, 'cards-selection');
  check('加入比較：點卡圖切換 → 「已變更 1 張」', f.shown && f.text === '已變更 1 張', f.text);
  await p.click('#cancel-cards-btn'); await p.waitForTimeout(200);
  check('取消 → 關閉、沒有存', await p.evaluate(() => document.getElementById('manage-cards-modal').style.display === 'none'));
  // 管理我的行動支付：同一套，單位「個」
  await p.evaluate(() => openManagePaymentsModal()); await p.waitForTimeout(300);
  check('行動支付：沒改動 → 沒有儲存列；舊的儲存／取消鈕仍在儲存列裡', !(await foot(p, 'payments-selection')).shown && await p.evaluate(() => !!document.querySelector('#manage-payments-modal .sel-footer #save-payments-btn')));
  const pay = await p.evaluate(() => document.querySelector('#payments-selection input').id);
  await p.click('#' + pay); await p.waitForTimeout(100);
  f = await foot(p, 'payments-selection');
  check('行動支付：勾一個 → 「已變更 1 個」', f.shown && f.text === '已變更 1 個', f.text);
  await p.click('#toggle-all-payments'); await p.waitForTimeout(100);
  f = await foot(p, 'payments-selection');
  check('行動支付：「全選」也會更新', f.shown && /^已變更 \d+ 個$/.test(f.text), f.text);
  const want = await p.evaluate(() => [...document.querySelectorAll('#payments-selection input:checked')].map(c => c.value).sort().join());
  await p.click('#save-payments-btn'); await p.waitForTimeout(400);
  check('行動支付：儲存 → 關閉並存進 userSelectedPayments', await p.evaluate(w => document.getElementById('manage-payments-modal').style.display === 'none' && [...userSelectedPayments].sort().join() === w, want));
  await p.evaluate(() => openManagePaymentsModal()); await p.waitForTimeout(300);
  check('行動支付：再打開以新勾選為基準、沒有儲存列', !(await foot(p, 'payments-selection')).shown);
  await p.evaluate(() => document.getElementById('close-payments-modal').click());
  await p.context().close();

  console.log('B. 已登入');
  p = await open(false);
  await p.evaluate(() => { __docs['users/testuid'] = { billingDates: { 'cathay-cube': { billingDate: '25', statementDate: '07' } } }; });
  await p.evaluate(() => openMyOwnedCardsModal()); await p.waitForTimeout(600);
  check('卡片格讀雲端日期（"07" 顯示成 7）', /7 日結帳・25 日繳款/.test(await tile(p, 'cathay-cube')), await tile(p, 'cathay-cube'));
  await clickTile(p, 'cathay-cube');
  check('面板讀到雲端日期', await p.evaluate(() => document.getElementById('statement-date').value === '7' && document.getElementById('billing-date').value === '25'));
  await p.selectOption('#billing-date', '15'); await p.waitForTimeout(800);
  st = await state(p);
  check('改繳款日 → 寫入 users/testuid.billingDates，狀態列綠＋時間', await p.evaluate(() => { const x = __sets.filter(s => s.path === 'users/testuid' && s.data.billingDates).pop(); return !!x && x.data.billingDates['cathay-cube'].billingDate === '15' && x.data.billingDates['cathay-cube'].statementDate === '7'; }) && st.status === 'ok' && /・今天/.test(st.statusText), st.statusText);
  await p.evaluate(() => { __failSets = 1; __failCode = 'unavailable'; });
  await p.selectOption('#statement-date', '9'); await p.waitForTimeout(800);
  st = await state(p);
  check('雲端失敗 → 紅字（結帳日／繳款日）＋已先存在這台裝置', st.status === 'err' && /（結帳日／繳款日）/.test(st.statusText) && /已先存在這台裝置/.test(st.statusText) &&
    await p.evaluate(() => JSON.parse(localStorage.getItem('billingDates_testuid_cathay-cube')).statementDate === '9'), st.statusText);
  await p.context().close();

  console.log('C. 桌機寬度');
  p = await open(true, 1280);
  await p.evaluate(() => openMyOwnedCardsModal()); await p.waitForTimeout(500);
  await clickTile(p, 'cathay-cube');
  check('桌機：面板裡的設定區可見、在 modal 寬度內', await p.evaluate(() => { const s = document.getElementById('card-personal-section'); const r = s.getBoundingClientRect(); const m = document.querySelector('#my-owned-cards-modal .modal-content').getBoundingClientRect(); return s.offsetParent !== null && r.width > 300 && r.right <= m.right + 1; }));
  await p.context().close();

  check('頁面沒有 JavaScript 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  const bad = results.filter(r => !r.ok).length;
  console.log(bad === 0 ? `\n✅ 我的信用卡單卡面板測試通過：${results.length}/${results.length}` : `\n❌ ${bad} 項失敗（共 ${results.length}）`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
