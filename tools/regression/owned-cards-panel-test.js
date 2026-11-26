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
 *  - 選卡 modal（管理我的信用卡／管理加入比較的卡片／管理我的行動支付，2026-11-26 改版）：「儲存」在固定的標題列、有改動才可按；
 *    單欄清單列（整列可點、沒有詳情鈕）、已勾選排前面、「已選 N」篩選；手機 390px 版面；管理視窗跟「我的信用卡」同寬
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
      // 2026-11-22 起狀態是標題列右側小字，整句分在幾個節點裡：讀 innerText 去空白（同 card-settings-promo-test.js）
      statusText: document.getElementById('cd-save-status').innerText.replace(/\s+/g, '')
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
  // 控制項樣式：面板裡量一次，等一下在詳情頁再量一次，兩邊要一樣（不寫死數字：手機／桌機的高度、字級本來就不同）
  const ctlStyle = () => p.evaluate(() => {
    const pick = (id, props) => { const c = getComputedStyle(document.getElementById(id)); return props.map(k => c[k]).join('|'); };
    return [pick('statement-date', ['height', 'width', 'fontSize', 'color', 'borderTopColor', 'borderRadius']),
      pick('fee-waiver-checked', ['appearance', 'width', 'height', 'backgroundColor']),
      pick('credit-limit-input', ['height', 'width', 'color', 'textAlign']),
      getComputedStyle(document.querySelector('label[for="statement-date"]')).fontSize].join(' / ');
  });
  const panelStyle = await ctlStyle();
  // 2026-11-24 起是「設定清單」：下拉無框、寬度＝最長選項（不寫死），輸入框 120px，開關 36×20
  check('面板裡的控制項是自訂外觀（開關 appearance:none 36×20、額度輸入框 120px）', /none\|36px\|20px/.test(panelStyle) && /\|120px\|rgb\(55, 65, 81\)\|right/.test(panelStyle), panelStyle);
  check('面板裡保留「個人設定」標題列（儲存狀態住在那裡），不顯示「到首頁點我的信用卡」提示', await p.evaluate(() => document.querySelector('#card-personal-section .cd-set-hd').offsetParent !== null && getComputedStyle(document.querySelector('#card-personal-section .cd-set-foot')).display === 'none'));
  check('結帳日／繳款截止日：未設定＋每月 1–31 日', await p.evaluate(() => ['statement-date', 'billing-date'].every(id => { const o = [...document.getElementById(id).options]; return o.length === 32 && o[0].textContent === '未設定' && o[0].value === '' && o[31].textContent === '每月 31 日'; })));
  await p.selectOption('#statement-date', '5'); await p.waitForTimeout(500);
  await p.selectOption('#billing-date', '20'); await p.waitForTimeout(600);
  st = await state(p);
  check('選結帳日 5、繳款日 20 → 訪客 key 存 {billingDate:"20", statementDate:"5"}，狀態列回到訪客「存在這台裝置」',
    await p.evaluate(() => localStorage.getItem('billingDates_local_cathay-cube')) === '{"billingDate":"20","statementDate":"5"}' && st.status === 'local' && /存在這台裝置/.test(st.statusText), st.statusText);
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
  const detailStyle = await ctlStyle();
  check('控制項樣式在面板與詳情頁完全一樣（高、寬、字級、顏色、框線、開關）', detailStyle === panelStyle, detailStyle === panelStyle ? '' : panelStyle + '  ≠  ' + detailStyle);
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

  console.log('A3. 選卡 modal（2026-11-26 改版：儲存在固定的標題列、有改動才可按；單欄清單列；沒有詳情鈕）');
  p = await open(true, 1280);
  await p.evaluate(() => openMyOwnedCardsModal()); await p.waitForTimeout(400);
  await p.click('#manage-owned-cards-btn'); await p.waitForTimeout(400);
  const canSave = (p, id) => p.evaluate(id => !document.getElementById(id).closest('.modal').querySelector('.sel-save').disabled, id);
  const isOpen = (p, id) => p.evaluate(id => document.getElementById(id).style.display !== 'none', id);
  check('三個視窗都沒有底部儲存列、取消鈕、「已變更」說明、說明文字', await p.evaluate(() => ['manage-owned-cards-modal', 'manage-cards-modal', 'manage-payments-modal'].every(id => {
    const m = document.getElementById(id);
    return !m.querySelector('.sel-footer, .sel-dirty, .cancel-btn, .modal-description') && m.querySelectorAll('.sel-top .sel-save').length === 1; })));
  check('上方的儲存鈕拿掉了', await p.evaluate(() => !document.getElementById('save-owned-cards-btn-top') && !document.getElementById('save-cards-btn-quick')));
  check('桌機：「管理我的信用卡」跟後面的「我的信用卡」同寬（蓋得住）', await p.evaluate(() => {
    const a = document.querySelector('#my-owned-cards-modal .modal-content').getBoundingClientRect(); const b = document.querySelector('#manage-owned-cards-modal .modal-content').getBoundingClientRect();
    return Math.abs(a.width - b.width) < 1 && b.left <= a.left + 1 && b.right >= a.right - 1; }));
  check('每張卡一列：卡面＋卡名＋勾選，沒有詳情鈕；沒有「全選」', await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#owned-cards-selection .sel-row')];
    return rows.length === cardsData.cards.length && rows.every(r => r.tagName === 'LABEL' && r.querySelector('.sel-face img') && r.querySelector('.card-checkbox-label') && r.querySelector('input.sel-check')) &&
      !document.querySelector('#manage-owned-cards-modal .card-detail-peek-btn') && !document.getElementById('toggle-all-owned-cards'); }));
  check('打開時已持有的卡排最前面', await p.evaluate(() => {
    const ids = [...document.querySelectorAll('#owned-cards-selection input')].map(c => c.value);
    return ids.slice(0, myOwnedCards.size).every(id => myOwnedCards.has(id)); }));
  check('沒改動 → 「儲存」不能按；「已選 N」＝持有張數', !(await canSave(p, 'owned-cards-selection')) &&
    await p.evaluate(() => document.getElementById('owned-only-selected').textContent === `已選 ${myOwnedCards.size}`));
  const firstOff = await p.evaluate(() => [...document.querySelectorAll('#owned-cards-selection input')].find(c => !c.checked).value);
  await p.click(`#owned-cards-selection label[for="owned-cards-selection-${firstOff}"] .card-checkbox-label`); await p.waitForTimeout(100);
  check('點卡名（整列都能點）→ 勾起來、「儲存」可按、「已選」＋1', await canSave(p, 'owned-cards-selection') &&
    await p.evaluate(id => document.getElementById('owned-cards-selection-' + id).checked && document.getElementById('owned-only-selected').textContent === `已選 ${myOwnedCards.size + 1}`, firstOff));
  check('標題列（含儲存）固定在頂端（捲到最下面也看得到）', await p.evaluate(() => {
    const m = document.querySelector('#manage-owned-cards-modal .modal-content'); m.scrollTop = m.scrollHeight;
    const hr = m.querySelector('.sel-top').getBoundingClientRect(); const mr = m.getBoundingClientRect();
    const ok = m.scrollHeight > m.clientHeight && Math.abs(hr.top - mr.top) < 2; m.scrollTop = 0; return ok; }));
  await p.click(`#owned-cards-selection label[for="owned-cards-selection-${firstOff}"] .sel-face`); await p.waitForTimeout(100);
  check('點卡面勾回原樣 → 「儲存」又不能按', !(await canSave(p, 'owned-cards-selection')));
  await p.click(`#owned-cards-selection label[for="owned-cards-selection-${firstOff}"]`); await p.waitForTimeout(100);
  await p.click('#owned-only-selected'); await p.waitForTimeout(100);
  check('「已選 N」→ 只看勾起來的卡', await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#owned-cards-selection .sel-row')];
    const shown = rows.filter(r => r.offsetParent !== null);
    return shown.length === myOwnedCards.size + 1 && shown.every(r => r.querySelector('input').checked) && document.getElementById('owned-only-selected').getAttribute('aria-pressed') === 'true'; }));
  await p.click('#owned-only-selected'); await p.waitForTimeout(100);
  check('再點一次 → 看全部', await p.evaluate(() => [...document.querySelectorAll('#owned-cards-selection .sel-row')].every(r => r.offsetParent !== null)));
  await p.fill('#search-owned-cards-input', 'CUBE'); await p.waitForTimeout(100);
  check('搜尋卡名', await p.evaluate(() => { const shown = [...document.querySelectorAll('#owned-cards-selection .sel-row')].filter(r => r.offsetParent !== null); return shown.length >= 1 && shown.every(r => /CUBE/i.test(r.textContent)); }));
  await p.click('#save-owned-cards-btn'); await p.waitForTimeout(500);
  check('儲存 → 關掉管理、持有卡多了剛勾的那張', await p.evaluate(id => document.getElementById('manage-owned-cards-modal').style.display === 'none' && myOwnedCards.has(id) && myOwnedCards.size === 4, firstOff));
  await p.click('#manage-owned-cards-btn'); await p.waitForTimeout(400);
  check('再打開 → 以新的勾選為基準（「儲存」不能按）、搜尋清空、新勾的卡排在前面', !(await canSave(p, 'owned-cards-selection')) && await p.evaluate(id => {
    const ids = [...document.querySelectorAll('#owned-cards-selection input')].map(c => c.value);
    return document.getElementById('search-owned-cards-input').value === '' && ids.indexOf(id) < 4 && [...document.querySelectorAll('#owned-cards-selection .sel-row')].every(r => r.offsetParent !== null); }, firstOff));
  await p.evaluate(() => { document.getElementById('close-manage-owned-modal').click(); document.getElementById('close-owned-modal').click(); });
  // 管理加入比較的卡片：同一套
  await p.evaluate(() => openManageCardsModal()); await p.waitForTimeout(400);
  check('加入比較：沒改動 → 「儲存」不能按；工具列有「套用我的信用卡」「全選／全不選」和篩選標籤', !(await canSave(p, 'cards-selection')) && await p.evaluate(() => {
    const t = document.getElementById('tag-filter-chips');
    return t.contains(document.getElementById('apply-owned-cards-btn')) && t.contains(document.getElementById('toggle-all-cards')) && t.querySelectorAll('.tag-filter-chip').length > 0 && !document.querySelector('#manage-cards-modal .card-detail-peek-btn'); }));
  const before = await p.evaluate(() => [...cardsInComparison].sort().join());
  await p.click('#cards-selection .sel-row:first-child .card-checkbox-label'); await p.waitForTimeout(100);
  check('加入比較：點一列切換 → 「儲存」可按', await canSave(p, 'cards-selection'));
  await p.evaluate(() => document.querySelector('#tag-filter-chips .tag-filter-chip').click()); await p.waitForTimeout(100);
  check('加入比較：點篩選標籤 → 只剩有這個標籤的卡', await p.evaluate(() => {
    const tag = document.querySelector('#tag-filter-chips .tag-filter-chip.active').dataset.tag;
    const shown = [...document.querySelectorAll('#cards-selection .sel-row')].filter(r => r.offsetParent !== null);
    return shown.length > 0 && shown.length < cardsData.cards.length && shown.every(r => (cardsData.cards.find(c => c.id === r.querySelector('input').value).tags || []).includes(tag)); }));
  await p.click('#close-modal'); await p.waitForTimeout(200);
  check('加入比較：× → 關閉、沒有存', !(await isOpen(p, 'manage-cards-modal')) && await p.evaluate(b => [...cardsInComparison].sort().join() === b, before));
  await p.evaluate(() => openManageCardsModal()); await p.waitForTimeout(300);
  check('加入比較：再打開 → 篩選標籤清掉、全部顯示', await p.evaluate(() => !document.querySelector('#tag-filter-chips .tag-filter-chip.active') && [...document.querySelectorAll('#cards-selection .sel-row')].every(r => r.offsetParent !== null)));
  await p.evaluate(() => document.getElementById('close-modal').click());
  // 管理我的行動支付：同一套
  await p.evaluate(() => openManagePaymentsModal()); await p.waitForTimeout(300);
  check('行動支付：沒改動 → 「儲存」不能按；一列一個、沒有卡面', !(await canSave(p, 'payments-selection')) && await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#payments-selection .sel-row')];
    return rows.length === paymentsData.payments.length && rows.every(r => r.tagName === 'LABEL' && !r.querySelector('img')); }));
  const pay = await p.evaluate(() => document.querySelector('#payments-selection input').id);
  await p.click('#' + pay); await p.waitForTimeout(100);
  check('行動支付：勾一個 → 「儲存」可按', await canSave(p, 'payments-selection'));
  await p.click('#toggle-all-payments'); await p.waitForTimeout(100);
  check('行動支付：「全選」也會更新', await canSave(p, 'payments-selection'));
  const want = await p.evaluate(() => [...document.querySelectorAll('#payments-selection input:checked')].map(c => c.value).sort().join());
  await p.click('#save-payments-btn'); await p.waitForTimeout(400);
  check('行動支付：儲存 → 關閉並存進 userSelectedPayments', await p.evaluate(w => document.getElementById('manage-payments-modal').style.display === 'none' && [...userSelectedPayments].sort().join() === w, want));
  await p.evaluate(() => openManagePaymentsModal()); await p.waitForTimeout(300);
  check('行動支付：再打開以新勾選為基準、「儲存」不能按', !(await canSave(p, 'payments-selection')));
  await p.evaluate(() => document.getElementById('close-payments-modal').click());
  await p.context().close();

  console.log('A4. 選卡 modal 手機版面（390px）');
  p = await open(true, 390);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => openMyOwnedCardsModal()); await p.waitForTimeout(300);
  await p.click('#manage-owned-cards-btn'); await p.waitForTimeout(400);
  const lay = await p.evaluate(() => {
    const m = document.querySelector('#manage-owned-cards-modal .modal-content'); const mr = m.getBoundingClientRect();
    const rows = [...m.querySelectorAll('.sel-row')];
    const full = rows.filter(r => { const q = r.getBoundingClientRect(); return q.top >= mr.top && q.bottom <= mr.bottom + 0.5; }).length;
    const tools = m.querySelector('.sel-tools'); const ts = getComputedStyle(tools);
    return { ratio: mr.height / innerHeight, full, rowH: Math.round(rows[0].getBoundingClientRect().height), oneLine: ts.flexWrap === 'nowrap' && tools.getBoundingClientRect().height < 50,
      noHScroll: document.documentElement.scrollWidth <= innerWidth && m.scrollWidth <= m.clientWidth, sticky: getComputedStyle(m.querySelector('.sel-top')).position === 'sticky' && getComputedStyle(tools).position !== 'sticky' };
  });
  check('手機：視窗高約 90%、第一個畫面看得到 ≥8 張卡、每列 ≤60px', lay.ratio > 0.85 && lay.ratio <= 0.91 && lay.full >= 8 && lay.rowH <= 60, JSON.stringify(lay));
  check('手機：篩選標籤一行橫向滑動、不固定；標題列固定；沒有橫向捲軸', lay.oneLine && lay.sticky && lay.noHScroll, JSON.stringify(lay));
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
  check('改繳款日 → 寫入 users/testuid.billingDates，狀態列綠＋時間', await p.evaluate(() => { const x = __sets.filter(s => s.path === 'users/testuid' && s.data.billingDates).pop(); return !!x && x.data.billingDates['cathay-cube'].billingDate === '15' && x.data.billingDates['cathay-cube'].statementDate === '7'; }) && st.status === 'ok' && /^已儲存・\d\d:\d\d$/.test(st.statusText), st.statusText);
  await p.evaluate(() => { __failSets = 1; __failCode = 'unavailable'; });
  await p.selectOption('#statement-date', '9'); await p.waitForTimeout(800);
  st = await state(p);
  check('雲端失敗 → 紅字「結帳日／繳款日沒存成功」＋第二行「已先存在這台裝置」', st.status === 'err' && /^結帳日／繳款日沒存成功/.test(st.statusText) && /已先存在這台裝置/.test(st.statusText) &&
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
