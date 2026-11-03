// checkWatchlist「抓取殘缺」防呆的驗證腳本（2026-11-03）
//
// 跑法：node tools/test-watchlist-incomplete-fetch.js  （零依賴）
// 什麼時候要跑：改了 apps-script/watchlist-monitor.gs 的抓取殘缺防呆
//              （字數 1/3、removedRatio、countBenefitSignals_ 訊號詞）或 MONITOR_CONFIG 對應門檻。
//
// 真實案例：臺灣企銀藝FUN卡（tbb-artfun）官網改版，這次只抓到新版導覽列＋頁尾，正文整段沒抓到。
//   舊的兩道防呆都被騙過（新版導覽列變長、「新增」超過 200 字），AI 摘要寫成
//   「移除當月帳單一般消費達 6,000 元以上且登錄的條件」——官網其實沒改。
//   下面的 OLD / SHELL 就是那次「變動段落」的 － 行與 ＋ 行（節錄，未改字）。
//
// 守住的不變式：
//   1. 只抓到殼 → 不寫「2-變動通知」、不覆寫 last_snapshot、信裡列成錯誤
//   2. 拿掉訊號詞防呆時，同一份資料**會**漏網（證明這個測試真的重現了當時的 bug）
//   3. 真的回饋變動（上限 500→300）照樣通知，不被新防呆誤擋
//   4. 首次建立的基準若零訊號詞 → 信裡提醒

'use strict';
const fs = require('fs');
const path = require('path');

const OLD_BODY = [
  '藝FUN悠遊御璽卡 : 臺灣企銀 $AP2 您的網路瀏覽器已過舊。 更新您的瀏覽器以獲得更佳的安全性、速度以及在此網站的最佳體驗。',
  '更新瀏覽器 臺企銀行動銀行App 下載 : 個人金融 信用卡 信用卡產品 卡片一覽 藝FUN悠遊御璽卡 匯率查詢 臺幣存放款利率查詢 外幣存放款利率查詢 當日黃金牌價查詢 歷史黃金牌價查詢 匯率試算 臺幣存款利率試算 外幣存款利率試算 房貸還款金額試算 信貸還款金額試算 藝FUN悠遊御璽卡 游藝四方企宇非凡 有什麼特色?',
  '國內外百大指定博物館 下載檔案 指定通路最高享3%現金回饋(即原卡片國內一般消費回饋0.5%，國外刷卡回饋2%，國內一般消費加碼2.5%，國外消費加碼1%，加碼回饋每戶每月上限500元，需登錄) 藝FUN卡當月帳單一般消費6,000元(含)以上且登錄，享指定通路額外加碼活動，加碼回饋部分每戶每月上限500元。',
  '了解更多 悠遊聯名卡嗶小額處處享優惠 嗶悠遊吃喝玩樂享好康 了解更多 另開視窗 VISA國際組織不定期優惠 Visa樂享精彩優惠。 了解更多 另開視窗 信用卡秘書專屬服務 尊榮秘書提供您24小時全年無休的服務，24小時服務專線：02-6619-9339。',
  '注意事項 新戶係指首次申辦藝FUN卡正卡，且申請人於核卡日前6個月未曾持有本行信用卡正卡者，若持卡人曾停用藝FUN卡再申辦者，恕無法適用新戶資格。新戶須於核卡後60日內完成一般消費刷卡交易並入帳始計算，限信用卡正卡持卡人參加且同一人僅限參加一次。',
  '一般消費係指排除：核定稅額及罰款(如：交通違規罰款等)、悠遊卡/一卡通自動加值金、信用卡預借現金金額、信用卡各項手續費、信用卡各項利息、代繳公用事業費、境外投資交易平臺(如eToro或類似平臺)、本行分期付款每期入帳之款項、本行零利率分期付款之消費、及其他於 本行官網公告 之排除項目等。',
  '指定通路最高享3%現金回饋：持卡人須於115年1月1日至115年12月31日至本行官網活動頁面完成登錄始符合資格(限以正卡人資料登錄)。自登錄當月起計算消費金額，並於次月回饋至信用卡帳單，恕不追溯回饋。已登錄者自登錄月份起無需重新登錄，每月均享有本活動資格。',
  '國內餐廳之認列限交易地點為臺灣之餐飲消費且依收單機構所設定登錄之餐廳分類代碼(MCC code為5811、5812、5813、5814、5462)為判斷依據，惟不含外送平台Uber Eats、foodpanda及foodomo等關鍵字。',
  '指定通路加碼回饋將於次月入至信用卡帳單，如持卡人刷退或取消交易，亦將於信用卡帳單收回加碼回饋部分。指定通路最高享3%現金回饋：國內一般消費加碼2.5%，國外刷卡加碼1%，加碼回饋每戶每月上限500元。',
  '【範例】林先生帳單結帳日為每月1號，2月2日至3月1日以藝FUN卡刷卡消費入帳10,000元，其中於OPENTIX兩廳院文化生活購票消費5,000元，百貨公司消費5,000元，則 3月帳單可獲得50元刷卡金，4月帳單可獲得指定通路125元刷卡金： 國內一般消費回饋0.5%：回饋50元(10,000元x 0.5%)。指定通路再加碼回饋2.5%：因OPENTIX兩廳院文化生活為指定通路消費，再享回饋125元(5,000元x2.5% )。',
  '國外消費(Agoda)回饋2%：回饋200元(10,000元x 2%)。指定通路：國外再加碼回饋1%：Agoda為指定通路消費，回饋100元(10,000元*1%)。指定通路：國內再加碼回饋2.5%：OPENTIX兩廳院文化生活、義大遊樂世界為指定通路消費，回饋500元(20,000元x2.5%)。指定通路可得回饋500元：原回饋為600元(100元+500元)，惟加碼回饋每月上限500元。',
  '常見問題 Q 申請進度查詢 申請信用卡進度可透過以下方式查詢: 線上查詢:您可透過本行官網查詢，完成身分與OTP驗證後 ，即可查詢信用卡辦理進度。專人服務: 您可撥打24小時客服中心電話 0800-01-7171 ，手機請撥 02-2357-7171 ，由專人協助您查詢信用卡辦理進度。',
  '本行信用卡提供 單筆分期付款 及 帳單分期付款 服務。單筆分期付款：單筆消費NT$1,000， 並於當期帳單結帳日前，來電本行客服中心申請，分期期數 3~30期，分期年利率6.88%起。',
  '匯利率 匯率查詢 臺幣存放款利率查詢 外幣存放款利率查詢 當日黃金牌價查詢 歷史黃金牌價查詢 試算 匯率試算 臺幣存款利率試算 外幣存款利率試算 房貸還款金額試算 信貸還款金額試算 數位帳戶 雲端櫃檯 關閉 重要! 臺灣企銀防詐宣導 上一則 下一則'
].join(' ');

const SHELL_BODY = [
  '主要內容區塊 網站導覽 ::: 個人金融 企業金融 數位金融 關於臺灣企銀 金融友善專區 服務據點 永續發展 投資人關係 EN 貸款 存款外匯 信用卡 投資理財 保險 信託 財富管理 登入 ::: 個人金融 信用卡 信用卡產品 卡片一覽 藝FUN悠遊御璽卡 已複製 藝FUN悠遊御璽卡 游藝四方企宇非凡 有什麼特色?',
  '線上服務 雲端櫃台 定型化契約 表單下載 常見問題 聯絡我們 智能客服 客服信箱 服務據點 國內分行 ATM據點 海外分行 證券分公司 103 台北市大同區塔城街30號 24小時客服專線：',
  '0800-01-7171(限市話)',
  '02-2357-7171 金融友善服務專區防詐騙專區法定公開揭露事項盡職治理守則遵循揭露專區顧客重要權益 網站導覽線上徵才隱私權與引用本行網站說明資通安全政策營運持續聲明 ©臺灣中小企業銀行 關閉 重要!'
].join(' ');

// 兩版都有、所以沒出現在「變動段落」裡的共同部分（新版網站的大型下拉選單）。
// 實際頁面的舊快照與殼都含這一大段，殼才會躲過「字數不到 1/3」那道防呆——不補這段，
// 測試會被字數防呆先擋下，測不到真正漏網的那條路。內容刻意不含任何回饋訊號詞。
const MENU_ITEMS = ['信用貸款', '房屋貸款', '臺幣存款', '外幣存款', '數位存款帳戶', '基金', '債券', '黃金存摺',
  '人身保險', '產物保險', '有價證券信託', '安養信託', '理財規劃', '網路銀行', '行動銀行', '雲端櫃檯'];
const COMMON = MENU_ITEMS.map((m, i) => m + '服務介紹 ' + m + '常見問答 ' + m + '申請流程第' + (i + 1) + '項')
  .join(' ').repeat(3);

const OLD = COMMON + ' ' + OLD_BODY;
const SHELL = COMMON + ' ' + SHELL_BODY;

// ---- 假的 Apps Script 服務（同 test-watchlist-chunking.js 的做法） ----
const store = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); },
  deleteProperty: k => { delete store[k]; }
})};
global.ScriptApp = { getProjectTriggers: () => [], deleteTrigger: () => {},
  newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => ({ getUniqueId: () => 'x' }) }) }) }) };

const HEADERS = ['card_id', 'bank', 'url', 'last_snapshot', 'last_checked', 'active'];
const grid = [HEADERS.slice(), ['tbb-artfun', '臺灣企銀', 'https://example.com/artfun', '', '', 'TRUE']];
const mkSheet = (name, data) => ({
  getName: () => name,
  getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
  getRange: (r, c) => ({
    setValue: v => { if (data[r - 1]) data[r - 1][c - 1] = v; },
    setValues: () => {}, setFontWeight: () => {}, setBackground: () => {},
    setBorder: () => {}, getValues: () => [[]], setWrap: () => {}
  }),
  getLastRow: () => data.length, getLastColumn: () => (data[0] || []).length,
  appendRow: r => data.push(r), setColumnWidth: () => {}, setFrozenRows: () => {},
  getMaxColumns: () => 30, insertColumnsAfter: () => {}
});
const sheets = { '1-監控清單': mkSheet('1-監控清單', grid), '2-變動通知': mkSheet('2-變動通知', []) };
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({
  getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mkSheet(n, []))
})};

let page = '';
global.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '<main>' + page + '</main>' }) };
const mails = [];
global.MailApp = { sendEmail: (to, subject, body) => mails.push({ subject, body }) };
global.Session = { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) };
global.Utilities = { sleep: () => {} };

const DRIVER = `
const inboxRows = [];
appendToInbox_ = function (ss, info) { inboxRows.push(info); };
const ok = (label, got, want) => console.log((String(got) === String(want) ? '  ✅ ' : '  ❌ ') + label + ': ' + got + ' (應為 ' + want + ')');
const run = (oldSnap, newPage) => {
  grid[1][3] = oldSnap; page = newPage; inboxRows.length = 0; mails.length = 0;
  Object.keys(store).forEach(k => delete store[k]);
  checkWatchlist();
};
const lastMail = () => (mails[mails.length - 1] || { body: '' }).body;

console.log('訊號詞：舊基準 ' + countBenefitSignals_(OLD) + ' 個、殼 ' + countBenefitSignals_(SHELL) + ' 個');

console.log('=== 1. 藝FUN卡真實案例：只抓到殼 ===');
run(OLD, SHELL);
ok('不寫進變動通知', inboxRows.length, 0);
ok('last_snapshot 保留原基準', grid[1][3] === OLD, true);
ok('信裡有訊號詞錯誤', /回饋相關字詞/.test(lastMail()), true);

console.log('=== 2. 對照組：關掉訊號詞防呆 → 當時的 bug 重現（會漏網） ===');
const keep = MONITOR_CONFIG.signalMinOld;
MONITOR_CONFIG.signalMinOld = Infinity;
run(OLD, SHELL);
ok('舊防呆擋不住、寫進變動通知', inboxRows.length, 1);
MONITOR_CONFIG.signalMinOld = keep;

console.log('=== 3. 真的回饋變動（上限 500→300）照樣通知 ===');
const changed = OLD.split('每戶每月上限500元').join('每戶每月上限300元');
run(OLD, changed);
ok('寫進變動通知', inboxRows.length, 1);
ok('last_snapshot 更新成新版', grid[1][3] === changed, true);

console.log('=== 4. 首次建基準就只抓到殼 → 信裡提醒 ===');
run('', SHELL);
ok('基準照存', grid[1][3] === SHELL, true);
ok('信裡有提醒', /剛建立的基準快照/.test(lastMail()), true);
`;

const SRC = path.join(__dirname, '..', 'apps-script', 'watchlist-monitor.gs');
let failed = 0;
const origLog = console.log;
console.log = function () {
  if (String(arguments[0]).indexOf('  ❌') === 0) failed++;
  origLog.apply(console, arguments);
};
eval(fs.readFileSync(SRC, 'utf8') + '\n' + DRIVER);
console.log = origLog;
console.log(failed ? '\n❌ ' + failed + ' 項未通過' : '\n✅ 全部通過');
process.exit(failed ? 1 : 0);
