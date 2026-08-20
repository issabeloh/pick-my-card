/* OEN 串接的自我測試（本環境連不到 oen.tw，用假 D1＋假 OEN API 驗證我方邏輯）。
 * 重點是攻擊面：webhook 沒有簽章，所以「偽造 webhook 拿不到權益」必須被證明。
 * 跑法：node tools/paywall/oen-selftest.mjs
 */
import { oenCreateCheckout, oenCheckoutPageUrl, resolvePaymentConfig } from '../../functions/_lib/payment.js';
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
                            const [trade_no, uid, email, amount, status, created_at] = args;
                            orders.set(trade_no, { trade_no, uid, email, amount, status, created_at, provider_txn_id: null });
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
                            const [uid] = args;
                            if (!entitlements.has(uid)) entitlements.set(uid, { uid, granted_at: Date.now() });
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
globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
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

// 準備一筆待付款訂單：PMC001 / uid_alice / 100 元 / OEN 交易 TXN_A
await DB.prepare('INSERT INTO orders').bind('PMC001', 'uid_alice', 'a@x.tw', 100, 'pending', Date.now()).run();
await DB.prepare("UPDATE orders SET provider_txn_id = ? WHERE trade_no = ? AND provider_txn_id IS NULL").bind('TXN_A', 'PMC001').run();

// 2a. 偽造 webhook 宣稱成功，但 OEN 那邊交易根本還沒付
oenTransactions = { TXN_A: { id: 'TXN_A', status: 'initiated', amount: 100, orderId: 'PMC001' } };
await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_A', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC001' });
check('偽造「已付款」webhook：OEN 實際未付 → 不開通', !DB.entitlements.has('uid_alice'));
check('偽造「已付款」webhook：訂單維持 pending', DB.orders.get('PMC001').status === 'pending');

// 2b. 偽造 webhook 指向別人真的付過的交易（金額/orderId 對不上）
oenTransactions.TXN_OTHER = { id: 'TXN_OTHER', status: 'charged', amount: 100, orderId: 'SOMEONE_ELSE' };
await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_OTHER', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC001' });
check('偽造 webhook 借用他人交易 ID → 不開通（覆核用的是訂單上存的 TXN_A，非 webhook 的 id）', !DB.entitlements.has('uid_alice'));

// 2c. 真的付款成功：OEN 查詢說 charged、金額與 orderId 都相符
oenTransactions.TXN_A = { id: 'TXN_A', status: 'charged', amount: 100, orderId: 'PMC001', paymentMethod: 'card' };
const r1 = await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_A', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC001' });
check('真實付款 → 開通', DB.entitlements.has('uid_alice'));
check('訂單轉為 paid', DB.orders.get('PMC001').status === 'paid');
check('回 200（OEN 不再重送）', r1.status === 200, String(r1.status));

// 2d. 重送同一筆 → 冪等
const before = DB.entitlements.get('uid_alice').granted_at;
await postNotify({ merchantId: 'pick-my-card', success: true, id: 'TXN_A', purpose: 'charge', status: 'charged', amount: 100, orderId: 'PMC001' });
check('重送 webhook → 冪等（不重複開通、時間不變）', DB.entitlements.get('uid_alice').granted_at === before);

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
    check('失敗導回 → /?pmc_pay=failed', bad.headers.get('Location') === 'https://pickmycard.app/?pmc_pay=failed',
        bad.headers.get('Location'));
    const bare = await getReturn('');
    check('無參數亂逛 → 靜默回首頁', bare.headers.get('Location') === 'https://pickmycard.app/', bare.headers.get('Location'));
}

globalThis.fetch = realFetch;
console.log(fail ? '\n❌ 有項目未通過' : '\n✅ 全部通過');
process.exit(fail);
