/* ============================================================
 * POST /api/pay/notify — 金流商的 server 對 server 付款結果通知
 *
 * 這是「唯一」會開通權益的入口。瀏覽器導回頁（/api/pay/return）不開通，
 * 因為那條路徑上的參數是使用者可以自己捏造的。
 *
 * 兩種金流商、同一條鐵律——不信任通知本身：
 *   綠界家族：通知帶 CheckMacValue 簽章 → 驗章 + 特店/訂單/金額四道關卡
 *   OEN：通知**沒有簽章** → 通知只當鈴聲，一律拿自己的 token 反查
 *        GET /transactions/{id}，以 OEN API 的回答為唯一事實來源
 *
 * 冪等：金流商都會重送（OEN 失敗重試 3 次，間隔 2/4/6 秒）。
 * markOrderPaid 只有第一次會真的改到列，grantAdfree 是 INSERT OR IGNORE。
 * ============================================================ */
import { resolvePaymentConfig, verifyCheckMacValue, oenVerifyCharged } from '../../_lib/payment.js';
import { getOrder, markOrderPaid, markOrderFailed, grantAdfree } from '../../_lib/db.js';
import { readFormParams } from '../../_lib/http.js';

const OK = () => new Response('1|OK', { headers: { 'Content-Type': 'text/plain' } });
const NG = (msg) => new Response('0|' + msg, { headers: { 'Content-Type': 'text/plain' } });

export async function onRequestPost({ request, env }) {
    let cfg;
    try {
        cfg = resolvePaymentConfig(env);
    } catch (err) {
        console.error('[paywall] notify 金流設定錯誤 →', err);
        return new Response('Server Error', { status: 500 });
    }
    return cfg.provider === 'oen' ? handleOenNotify(request, env, cfg) : handleEcpayNotify(request, env, cfg);
}

// ============================================
// OEN：webhook 當鈴聲，事實反查 API
// ============================================
async function handleOenNotify(request, env, cfg) {
    let body;
    try {
        body = await request.json();
    } catch (err) {
        console.error('[paywall] OEN notify body 非 JSON →', err);
        return new Response('Bad Request', { status: 400 });
    }

    try {
        // 只處理金流交易；卡號換 token 等其他 purpose 一律略過
        if (body.purpose && body.purpose !== 'charge') return OK();

        const tradeNo = body.orderId ? String(body.orderId) : '';
        if (!tradeNo) {
            console.error('[paywall] OEN notify 缺 orderId，txn=' + (body.id || '?'));
            return OK();
        }
        const order = await getOrder(env, tradeNo);
        if (!order) {
            console.error('[paywall] OEN notify 找不到訂單：' + tradeNo);
            return OK();
        }
        if (order.status === 'paid') return OK(); // 重送 → 冪等直接回

        // 🔑 唯一的信任來源：拿自己的 token 問 OEN。webhook 內容再漂亮都不算數。
        const { paid, tx } = await oenVerifyCharged(cfg, order, body.id);
        const raw = JSON.stringify({ webhook: body, verified: tx || null });

        if (paid) {
            const firstTime = await markOrderPaid(env, tradeNo, {
                providerTxnId: (tx && tx.id) || order.provider_txn_id || body.id,
                paymentType: (tx && tx.paymentMethod) || body.paymentMethod || null,
                rtnCode: 1, rtnMsg: 'verified via OEN query API', raw,
            });
            await grantAdfree(env, order.uid, { tradeNo, source: 'oen-notify' });
            if (firstTime) console.error('[paywall] 已開通去廣告：uid=' + order.uid + ' 訂單=' + tradeNo);
        } else if (tx && tx.status === 'failed') {
            await markOrderFailed(env, tradeNo, { rtnCode: 0, rtnMsg: tx.message || 'failed', raw });
        } else {
            // 覆核不通過但也不是明確失敗（金額不符/orderId 不符/還在 charging）→ 只記錄
            console.error('[paywall] OEN notify 覆核未通過：訂單=' + tradeNo + ' 狀態=' + (tx && tx.status));
        }
        return OK();
    } catch (err) {
        // 回 5xx 讓 OEN 依 2/4/6 秒重試，暫時性錯誤（如查詢 API 逾時）自動補救
        console.error('[paywall] OEN notify 處理失敗 →', err);
        return new Response('Server Error', { status: 500 });
    }
}

// ============================================
// 綠界家族：CheckMacValue 簽章 + 四道關卡（原邏輯不動）
// ============================================
async function handleEcpayNotify(request, env, cfg) {
    let params;
    try {
        params = await readFormParams(request);
    } catch (err) {
        console.error('[paywall] notify 讀取參數失敗 →', err);
        return NG('BadRequest');
    }

    try {
        if (!(await verifyCheckMacValue(params, cfg.hashKey, cfg.hashIV))) {
            console.error('[paywall] notify CheckMacValue 驗證失敗，訂單=' + params.MerchantTradeNo);
            return NG('CheckMacValue Error');
        }
        if (params.MerchantID !== cfg.merchantId) {
            console.error('[paywall] notify 特店代號不符：' + params.MerchantID);
            return NG('MerchantID Error');
        }

        const tradeNo = params.MerchantTradeNo;
        const order = await getOrder(env, tradeNo);
        if (!order) {
            // 找不到訂單就不要讓金流商無限重送——記下來人工查即可
            console.error('[paywall] notify 找不到訂單：' + tradeNo);
            return OK();
        }

        // 測試環境的「模擬付款」不是真的收到錢，絕不能開通
        if (params.SimulatePaid === '1') {
            console.error('[paywall] notify 為模擬付款，不開通：' + tradeNo);
            return OK();
        }

        const raw = JSON.stringify(params);
        if (params.RtnCode !== '1') {
            await markOrderFailed(env, tradeNo, { rtnCode: Number(params.RtnCode), rtnMsg: params.RtnMsg, raw });
            return OK();
        }
        if (Number(params.TradeAmt) !== Number(order.amount)) {
            console.error(`[paywall] notify 金額不符：訂單 ${order.amount} vs 通知 ${params.TradeAmt}（${tradeNo}）`);
            return OK();
        }

        const firstTime = await markOrderPaid(env, tradeNo, {
            providerTxnId: params.TradeNo, paymentType: params.PaymentType,
            rtnCode: Number(params.RtnCode), rtnMsg: params.RtnMsg, raw,
        });
        await grantAdfree(env, order.uid, { tradeNo, source: 'ecpay-notify' });
        if (firstTime) console.error('[paywall] 已開通去廣告：uid=' + order.uid + ' 訂單=' + tradeNo);
        return OK();
    } catch (err) {
        // 回非 1|OK 會讓綠界稍後重送，暫時性錯誤因此能自動補救
        console.error('[paywall] notify 處理失敗 →', err);
        return NG('ServerError');
    }
}
