/* OEN 串接的自我測試（本環境連不到 oen.tw，用假 D1＋假 OEN API 驗證我方邏輯）。
 * 重點是攻擊面：webhook 沒有簽章，所以「偽造 webhook 拿不到權益」必須被證明。
 * 跑法：node tools/paywall/oen-selftest.mjs
 */
import { oenCreateCheckout, oenCheckoutPageUrl, resolvePaymentConfig,
         resolveChargeAmount, resolveAdfreePricing } from '../../functions/_lib/payment.js';
import { onRequestPost as notifyPost } from '../../functions/api/pay/notify.js';
import { onRequestPost as returnPost, onRequestGet as returnGet } from '../../functions/api/pay/return.js';

let fail = 0;
const check = (name, ok, detail) => {
    if (ok) { console.log('✅ ' + name); return; }
    fail = 1; console.error('❌ ' + name + (detail ? ' → ' + detail : ''));
};

// ── 假 D1：只實作 db.js 用到的幾條 SQL ─────────────────────────
function makeFakeDB() {
    const orders = new Map();
    const entitlements = new Map();
    return {
        orders, entitlements,
        prepare(sql) {
            return { bind(...args) {
                return {
                    async run() {
                        if (sql.startsWith('INSERT INTO orders')) {
                            const [trade_no, uid, email, amount, tip, status, created_at] = args;
                            orders.set(trade_no, { trade_no, uid, email, amount, tip, status, created_at, provider_txn_id: null });
                            return { meta: { changes: 1 } };
                        }
                        if (sql.includes("SET provider_txn_id = ?")) {
                            const [txn, tradeNo] = args;
                            const o = orders.get(tradeNo);
                            if (o && o.provider_txn_id == null) { o.provider_txn_id = txn; return { meta: { changes: 1 } }; }
                            return { meta: { changes: 0 } };
                        }
                        if (sql.includes("SET status = 'paid'")) {
                            const tradeNo = args[args.length - 1];
                            const o = orders.get(tradeNo);
                            if (o && o.status !== 'paid') { o.status = 'paid'; return { meta: { changes: 1 } }; }
                            return { meta: { changes: 0 } };
                        }
                        if (sql.includes("SET status = 'failed'")) {
                            const tradeNo = args[args.length - 1];
                            const o = orders.get(tradeNo);
                            if (o && o.status === 'pending') o.status = 'failed';
                            return { meta: { changes: 1 } };
                        }
                        if (sql.startsWith('INSERT OR IGNORE INTO entitlements')) {
                            // changes 必須誠實反映 OR IGNORE 的語意：已存在就是 0。
                            // 感謝信「不重複寄」正是靠這個值判斷的，假 DB 若一律回 1
                            // 會讓重寄的 bug 測不出來。
                            const [uid] = args;
                            if (entitlements.has(uid)) return { meta: { changes: 0 } };
                            entitlements.set(uid, { uid, granted_at: Date.now() });
                            return { meta: { changes: 1 } };
                        }
                        throw new Error('假 D1 不認得的 run SQL：' + sql);
                    },
                    async first() {
                        if (sql.includes('FROM orders WHERE trade_no')) return orders.get(args[0]) || null;
                        if (sql.includes('FROM entitlements WHERE uid')) return entitlements.get(args[0]) || null;
                        if (sql.includes("status = 'pending' ORDER BY")) {
                            const list = [...orders.values()].filter(o => o.uid === args[0] && o.status === 'pending');
                            return list.sort((a, b) => b.created_at - a.created_at)[0] || null;
                        }
                        throw new Error('假 D1 不認得的 first SQL：' + sql);
                    },
                };
            } };
        },
    };
}

// ── 假 OEN API：查詢回應由測試逐案指定 ─────────────────────────
const realFetch = globalThis.fetch;
let oenTransactions = {};   // txnId → transaction data
let capturedCheckout = null;
let mailsSent = [];         // 攔下來的感謝信，用來驗證「不重複寄」
globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('api.resend.com')) {
        mailsSent.push(JSON.parse(opts.body));
        return new Response(JSON.stringify({ id: 'mail-' + mailsSent.length }), { status: 200 });
    }
    if (u.endsWith('/checkout') && opts.method === 'POST') {
        capturedCheckout = { url: u, headers: opts.headers, body: JSON.parse(opts.body) };
        return new Response(JSON.stringify({ code: 'S0000', message: 'ok', data: { id: 'TXN_FAKE_1' } }), { status: 200 });
    }
    const m = u.match(/\/transactions\/([^/?]+)$/);
    if (m) {
        const tx = oenTransactions[decodeURIComponent(m[1])];
        if (!tx) return new Response(JSON.stringify({ code: 'V0001', message: 'not found' }), { status: 400 });
        return new Response(JSON.stringify({ code: 'S0000', message: 'ok', data: tx }), { status: 200 });
    }
    throw new Error('測試不該打到外部網路：' + u);
};

const DB = makeFakeDB();
const env = {
    DB,
    PMC_PAY_PROVIDER: 'oen',
    PMC_PAY_MERCHANT_ID: 'pick-my-card',
    PMC_PAY_TOKEN: 'FAKE_TOKEN',
    PMC_SITE_ORIGIN: 'https://pickmycard.app',
    PMC_MAIL_API_KEY: 'FAKE_MAIL_KEY',
    PMC_MAIL_FROM: 'Pick My Card <no-reply@pickmycard.app>',
};
const cfg = resolvePaymentConfig(env);

// ── 1. 建立交易的請求形狀 ─────────────────────────────────────
{
    const data = await oenCreateCheckout(cfg, {
        merchantId: cfg.merchantId, amount: 100, currency: 'TWD', orderId: 'PMCTEST01',
        successUrl: 'https://pickmycard.app/api/pay/return?r=ok',
        failureUrl: 'https://pickmycard.app/api/pay/return',
        productDetails: [{ productionCode: 'adfree', description: '去廣告權益（一次買斷）', quantity: 1, unit: '式', unitPrice: 100 }],
    });
    check('checkout 打測試環境 API', capturedCheckout.url === 'https://payment-api.testing.oen.tw/checkout', capturedCheckout.url);
    check('checkout 帶 Bearer token', capturedCheckout.headers.Authorization === 'Bearer FAKE_TOKEN');
    const b = capturedCheckout.body;
    check('checkout 必填欄位齊全',
        b.merchantId === 'pick-my-card' && b.amount === 100 && b.currency === 'TWD' &&
        b.orderId === 'PMCTEST01' && !!b.successUrl && !!b.failureUrl &&
        Array.isArray(b.productDetails) && b.productDetails.length === 1,
        JSON.stringify(b));
    check('結帳頁網址（測試環境子網域）',
        oenCheckoutPageUrl(cfg, data.id) === 'https://pick-my-card.testing.oen.tw/checkout/TXN_FAKE_1',
        oenCheckoutPageUrl(cfg, data.id));
}

// ── 2. webhook 攻防 ──────────────────────────────────────────
const postNotify = (body) => notifyPost({
    request: new Request('https://pickmycard.app/api/pay/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    env,
});

// 準備一筆待付款訂單：PMC001 / uid_alice / 150 元（底價 100 ＋ 加碼 50）/ OEN 交易 TXN_A
await DB.prepare('INSERT INTO orders').bind('PMC001', 'uid_alice', 'a@x.tw', 150, 50, 'pending', Date.now()).run();
await DB.prepare("UPDATE orders SET provider_txn_id = ? WHERE trade_no = ? AND provider_txn_id IS NULL").bind('TXN_A', 'PMC001').run();

// 2a. 偽造 webhook 宣稱成功，但 OEN 那邊交易根本還沒付
oenTransactions = { TXN_A: { id: 'TXN_A', status: 'initiated', amount: 150, orderId: 'PMC001' } };
await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_A', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC001' });
check('偽造「已付款」webhook：OEN 實際未付 → 不開通', !DB.entitlements.has('uid_alice'));
check('偽造「已付款」webhook：訂單維持 pending', DB.orders.get('PMC001').status === 'pending');

// 2b. 偽造 webhook 指向別人真的付過的交易（金額/orderId 對不上）
oenTransactions.TXN_OTHER = { id: 'TXN_OTHER', status: 'charged', amount: 100, orderId: 'SOMEONE_ELSE' };
await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_OTHER', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC001' });
check('偽造 webhook 借用他人交易 ID → 不開通（覆核用的是訂單上存的 TXN_A，非 webhook 的 id）', !DB.entitlements.has('uid_alice'));

// 2c. 真的付款成功：OEN 查詢說 charged、金額與 orderId 都相符
oenTransactions.TXN_A = { id: 'TXN_A', status: 'charged', amount: 150, orderId: 'PMC001', paymentMethod: 'card' };
const r1 = await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_A', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC001' });
check('真實付款 → 開通', DB.entitlements.has('uid_alice'));
check('訂單轉為 paid', DB.orders.get('PMC001').status === 'paid');
check('回 200（OEN 不再重送）', r1.status === 200, String(r1.status));

// 2d. 重送同一筆 → 冪等
const before = DB.entitlements.get('uid_alice').granted_at;
await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_A', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC001' });
check('重送 webhook → 冪等（不重複開通、時間不變）', DB.entitlements.get('uid_alice').granted_at === before);

// 感謝信只能寄一次。webhook 會重送（OEN 是 2/4/6 秒三次），若靠「訂單付款成功」
// 而不是「權益真的第一次寫入」來判斷，用戶會收到一疊重複的信。
check('開通時寄出感謝信（一封）', mailsSent.length === 1, `寄了 ${mailsSent.length} 封`);
check('重送 webhook → 不會再寄一封', mailsSent.length === 1, `寄了 ${mailsSent.length} 封`);
if (mailsSent[0]) {
    check('感謝信寄到訂單上的 email', String(mailsSent[0].to) === 'a@x.tw', JSON.stringify(mailsSent[0].to));
    check('感謝信金額用訂單實收（150）並點出加碼 50',
        mailsSent[0].text.includes('NT$150') && mailsSent[0].text.includes('NT$50'),
        mailsSent[0].text.slice(0, 60));
}

// 2e. 金額不符（訂單 100，OEN 說只收到 1）
await DB.prepare('INSERT INTO orders').bind('PMC002', 'uid_bob', 'b@x.tw', 100, 'pending', Date.now()).run();
await DB.prepare("UPDATE orders SET provider_txn_id = ? WHERE trade_no = ? AND provider_txn_id IS NULL").bind('TXN_B', 'PMC002').run();
oenTransactions.TXN_B = { id: 'TXN_B', status: 'charged', amount: 1, orderId: 'PMC002' };
await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_B', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC002' });
check('金額不符 → 不開通', !DB.entitlements.has('uid_bob'));

// 2f. purpose=token（卡號換 token）→ 略過
const r2 = await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_C', purpose: 'token', token: 'tok_x' });
check('purpose=token → 略過且回 200', r2.status === 200 && !DB.entitlements.has('uid_bob'));

// 2g. 查詢 API 掛掉 → 回 5xx 讓 OEN 重試
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('OEN API down'); };
const r3 = await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_A', purpose: 'charge', orderId: 'PMC002' });
check('查詢 API 掛掉 → 回 500（OEN 會依 2/4/6 秒重試）', r3.status === 500, String(r3.status));
globalThis.fetch = savedFetch;

// ── 3. 導回頁翻譯 ────────────────────────────────────────────
const getReturn = (qs) => returnGet({ request: new Request('https://pickmycard.app/api/pay/return' + qs), env });
{
    const ok = await getReturn('?r=ok');
    check('成功導回 → /?pmc_pay=success', ok.status === 303 && ok.headers.get('Location') === 'https://pickmycard.app/?pmc_pay=success',
        ok.headers.get('Location'));
    const bad = await getReturn('?payment_error=T0002');
    check('失敗導回 → /?pmc_pay=failed 並帶回錯誤代碼（供管理員通報用）',
        bad.headers.get('Location') === 'https://pickmycard.app/?pmc_pay=failed&pmc_err=T0002',
        bad.headers.get('Location'));
    const bare = await getReturn('');
    check('無參數亂逛 → 靜默回首頁', bare.headers.get('Location') === 'https://pickmycard.app/', bare.headers.get('Location'));
}

// ── 3.5 感謝信 ────────────────────────────────────────────────
{
    const { buildThanksEmail, sendPurchaseThanks } = await import('../../functions/_lib/mail.js');

    const tipped = buildThanksEmail({ amount: 150, tip: 50, tradeNo: 'PMC001' });
    check('感謝信：有加碼時主旨點名加碼', tipped.subject.includes('加碼'), tipped.subject);
    check('感謝信：有加碼時內文寫出底價與加碼的拆解',
        tipped.text.includes('NT$100') && tipped.text.includes('NT$50'), tipped.text.slice(0, 80));
    const plain = buildThanksEmail({ amount: 100, tip: 0, tradeNo: 'PMC002' });
    check('感謝信：未加碼時不會硬提加碼', !plain.subject.includes('加碼') && !plain.text.includes('加碼'), plain.subject);
    check('感謝信：訂單編號有帶進主旨與內文',
        plain.subject.includes('PMC002') && plain.text.includes('PMC002'), plain.subject);
    check('感謝信：HTML 版有做跳脫（不會把 < 原樣輸出）',
        !buildThanksEmail({ amount: 100, tip: 0, tradeNo: '<script>' }).html.includes('<script>'));

    // 沒設定 → 靜默跳過，絕不能因此丟例外把開通流程帶掉
    const off = await sendPurchaseThanks({}, { to: 'a@b.c', amount: 100, tip: 0, tradeNo: 'X' });
    check('感謝信：未設定金鑰時靜默跳過（不影響開通）', off.skipped === 'mail-not-configured', JSON.stringify(off));
    const noTo = await sendPurchaseThanks({ PMC_MAIL_API_KEY: 'k', PMC_MAIL_FROM: 'a@b.c' },
        { to: '', amount: 100, tip: 0, tradeNo: 'X' });
    check('感謝信：訂單沒有 email 時跳過', noTo.skipped === 'no-recipient', JSON.stringify(noTo));

    // 寄信 API 掛掉／丟例外，都不能往上拋
    const savedFetch2 = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 500 });
    const bad = await sendPurchaseThanks({ PMC_MAIL_API_KEY: 'k', PMC_MAIL_FROM: 'a@b.c' },
        { to: 'x@y.z', amount: 100, tip: 0, tradeNo: 'X' });
    check('感謝信：寄信服務回 500 → 記錄後吞掉，不丟例外', bad.failed === 500, JSON.stringify(bad));
    globalThis.fetch = async () => { throw new Error('network down'); };
    const boom = await sendPurchaseThanks({ PMC_MAIL_API_KEY: 'k', PMC_MAIL_FROM: 'a@b.c' },
        { to: 'x@y.z', amount: 100, tip: 0, tradeNo: 'X' });
    check('感謝信：寄信丟例外 → 吞掉，不丟例外', boom.failed === 'exception', JSON.stringify(boom));

    // 真的送出時的請求長相
    let captured = null;
    globalThis.fetch = async (url, init) => {
        captured = { url: String(url), init };
        return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
    };
    const okSend = await sendPurchaseThanks(
        { PMC_MAIL_API_KEY: 'secret-key', PMC_MAIL_FROM: 'Pick My Card <no-reply@pickmycard.app>' },
        { to: 'buyer@example.com', amount: 150, tip: 50, tradeNo: 'PMC003' });
    check('感謝信：設定齊全時真的送出', okSend.sent === true, JSON.stringify(okSend));
    const body = JSON.parse(captured.init.body);
    check('感謝信：預設打 Resend 端點', captured.url === 'https://api.resend.com/emails', captured.url);
    check('感謝信：帶 Bearer 金鑰', captured.init.headers.Authorization === 'Bearer secret-key');
    check('感謝信：收件人正確且只有一位', String(body.to) === 'buyer@example.com', JSON.stringify(body.to));
    check('感謝信：text 與 html 兩種格式都帶', !!body.text && !!body.html);
    globalThis.fetch = savedFetch2;
}

// ── 4. 隨喜加碼的金額驗證 ─────────────────────────────────────
// 金額改由前端決定之後，伺服器端的驗證就是唯一防線：擋不住的話有人直接
// POST 一個小數字就能用一塊錢買走權益。
{
    const e = {};                       // 底價 100、上限 1000（預設值）
    const ok = (tip, expect) => {
        const r = resolveChargeAmount(e, tip);
        check(`加碼 ${JSON.stringify(tip)} → NT$${expect}`, r.amount === expect && !r.error, JSON.stringify(r));
    };
    const rejected = (tip, why) => {
        const r = resolveChargeAmount(e, tip);
        check(`拒絕 ${JSON.stringify(tip)}（${why}）`, !!r.error && r.amount === undefined, JSON.stringify(r));
    };

    ok(undefined, 100);                 // 沒帶 tip＝只付底價
    ok(0, 100);
    ok(25, 125);
    ok(50, 150);
    ok(75, 175);                        // +25 +50 連按
    ok('50', 150);                      // 字串數字可接受（JSON 有可能這樣送）
    ok(900, 1000);                      // 剛好到上限

    rejected(-25, '負數＝想少付錢');
    rejected(-100, '負數＝想免費拿權益');
    rejected(30, '不是級距的倍數');
    rejected(1.5, '不是整數');
    rejected(925, '超過上限 NT$1000');
    rejected('abc', '不是數字');
    rejected(Infinity, '無限大');

    // 底價被 PMC_ADFREE_PRICE 調高時，上限仍以總額計算
    const e2 = { PMC_ADFREE_PRICE: '150', PMC_ADFREE_MAX: '300' };
    check('底價 150／上限 300：加碼 150 → NT$300',
        resolveChargeAmount(e2, 150).amount === 300, JSON.stringify(resolveChargeAmount(e2, 150)));
    check('底價 150／上限 300：加碼 175 被拒',
        !!resolveChargeAmount(e2, 175).error, JSON.stringify(resolveChargeAmount(e2, 175)));

    const pricing = resolveAdfreePricing({});
    check('GET /api/pricing 的內容：底價 100／上限 1000／級距 25,50',
        pricing.base === 100 && pricing.max === 1000 && String(pricing.steps) === '25,50', JSON.stringify(pricing));

    // 環境變數誤設也不能讓底價掉下來——設定失誤的後果跟被攻擊一樣
    for (const [bad, label] of [['-50', '負數'], ['0', '零'], ['abc', '非數字'], ['', '空字串']]) {
        const got = resolveAdfreePricing({ PMC_ADFREE_PRICE: bad });
        check(`底價設成 ${label}（${JSON.stringify(bad)}）→ 退回 100，不會變成免費`,
            got.base === 100, JSON.stringify(got));
    }
    check('上限設成負數 → 退回 1000',
        resolveAdfreePricing({ PMC_ADFREE_MAX: '-1' }).max === 1000);

    // 收費永遠不低於底價：這是整個加碼功能的下限保證，用窮舉釘死
    let floorHeld = true;
    for (let t = -500; t <= 500; t += 1) {
        const r = resolveChargeAmount({}, t);
        if (!r.error && r.amount < 100) { floorHeld = false; break; }
    }
    check('窮舉 tip = -500…500：沒有任何一個能讓收費低於底價 NT$100', floorHeld);
}

globalThis.fetch = realFetch;
console.log(fail ? '\n❌ 有項目未通過' : '\n✅ 全部通過');
process.exit(fail);
