/* 綠界 CheckMacValue 自我測試。
 * 對照組是綠界 AIO V5 文件「CheckMacValue 產生規則」的官方範例：
 * 從那組固定參數算出的「編碼後小寫字串」必須逐字元相符——CheckMacValue 的
 * bug 幾乎全出在這一步（空白→+、冒號/斜線要編、大小寫），雜湊本身不會出錯。
 * 跑法：node tools/paywall/mac-selftest.mjs
 */
import { buildMacSource, makeCheckMacValue, dotNetUrlEncode } from '../../functions/_lib/ecpay.js';

const HASH_KEY = '5294y06JbISpM5x9';
const HASH_IV = 'v77hoKGq4kWxNNIS';

const DOC_PARAMS = {
    MerchantID: '2000132',
    MerchantTradeNo: 'Test1234567',
    MerchantTradeDate: '2013/03/12 15:30:23',
    PaymentType: 'aio',
    TotalAmount: '1000',
    TradeDesc: '測試交易描述',
    ItemName: '測試商品等',
    ReturnURL: 'http://public.ecpay.com.tw/receive.php',
    ChoosePayment: 'ALL',
};

// 綠界規則：把「整串」（含 = 與 & 分隔符）一起做 URL Encode，所以分隔符會變成
// %3d / %26——這是最多人踩錯的一點。下面這行是照規格用 Python 的
// urllib.parse.quote_plus(raw, safe='-_.!*()') 獨立算出來的，不是抄自本專案的實作。
const DOC_EXPECTED_SOURCE =
    'hashkey%3d5294y06jbispm5x9%26choosepayment%3dall%26itemname%3d%e6%b8%ac%e8%a9%a6%e5%95%86%e5%93%81%e7%ad%89' +
    '%26merchantid%3d2000132%26merchanttradedate%3d2013%2f03%2f12+15%3a30%3a23%26merchanttradeno%3dtest1234567' +
    '%26paymenttype%3daio%26returnurl%3dhttp%3a%2f%2fpublic.ecpay.com.tw%2freceive.php%26totalamount%3d1000' +
    '%26tradedesc%3d%e6%b8%ac%e8%a9%a6%e4%ba%a4%e6%98%93%e6%8f%8f%e8%bf%b0%26hashiv%3dv77hokgq4kwxnnis';

let fail = 0;
function check(name, actual, expected) {
    if (actual === expected) { console.log('✅ ' + name); return; }
    fail = 1;
    console.error('❌ ' + name);
    console.error('   實際：' + actual);
    console.error('   預期：' + expected);
}

check('文件範例：排序＋夾 HashKey/HashIV＋.NET UrlEncode＋轉小寫',
    buildMacSource(DOC_PARAMS, HASH_KEY, HASH_IV), DOC_EXPECTED_SOURCE);

// .NET UrlEncode 與 encodeURIComponent 的三處差異
check('空白編成 +', dotNetUrlEncode('a b'), 'a+b');
check("單引號編成 %27", dotNetUrlEncode("it's"), 'it%27s');
check('波浪號編成 %7e', dotNetUrlEncode('~x'), '%7ex');
check('安全字元不編碼', dotNetUrlEncode("-_.!*()"), '-_.!*()');

// 排序是不分大小寫的字母序，且必須排除 CheckMacValue 自己
const withMac = { ...DOC_PARAMS, CheckMacValue: 'SHOULD_BE_IGNORED' };
check('計算時排除 CheckMacValue 欄位',
    buildMacSource(withMac, HASH_KEY, HASH_IV), DOC_EXPECTED_SOURCE);

// 同一組參數必須穩定產生同一個雜湊（大寫 64 碼 hex）
const mac = await makeCheckMacValue(DOC_PARAMS, HASH_KEY, HASH_IV);
check('雜湊格式為大寫 64 碼 hex', /^[0-9A-F]{64}$/.test(mac) ? 'ok' : mac, 'ok');
check('雜湊可重現', mac, await makeCheckMacValue(DOC_PARAMS, HASH_KEY, HASH_IV));

process.exit(fail);
