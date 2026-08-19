/* ============================================================
 * POST /api/ecpay/notify — 綠界 server 對 server 付款結果通知（ReturnURL）
 *
 * 這是「唯一」會開通權益的入口。瀏覽器導回頁（/api/ecpay/return）不開通，
 * 因為那條路徑上的參數是使用者可以自己捏造的。
 *
 * 四道關卡都過才開通：CheckMacValue 正確 → 特店代號相符 → 訂單存在
 * → 金額相符 且 RtnCode=1。
 * 冪等：綠界收不到 1|OK 會重送，markOrderPaid 只有第一次會真的改到列，
 * grantAdfree 是 INSERT OR IGNORE，重複通知不會重複開通。
 * ============================================================ */
import { resolvePaymentConfig, verifyCheckMacValue } from '../../_lib/payment.js';
import { getOrder, markOrderPaid, markOrderFailed, grantAdfree } from '../../_lib/db.js';
import { readFormParams } from '../../_lib/http.js';

const OK = () => new Response('1|OK', { headers: { 'Content-Type': 'text/plain' } });
const NG = (msg) => new Response('0|' + msg, { headers: { 'Content-Type': 'text/plain' } });

export async function onRequestPost({ request, env }) {
    let params;
    try {
        params = await readFormParams(request);
    } catch (err) {
        console.error('[paywall] notify 讀取參數失敗 →', err);
        return NG('BadRequest');
    }

    try {
        const cfg = resolvePaymentConfig(env);

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
            // 找不到訂單就不要讓綠界無限重送——記下來人工查即可
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
            ecpayTradeNo: params.TradeNo, paymentType: params.PaymentType,
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
