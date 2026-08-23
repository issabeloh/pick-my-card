/* ============================================================
 * POST /api/order-status — 自我修復：主動跟綠界查訂單，補開通
 *
 * 用在「用戶付了錢，但綠界的通知遲到或漏送」。前端的「重新查詢訂單」按鈕會打這支。
 * 只查本人的訂單（tradeNo 必須屬於 token 的 uid），不接受任意訂單編號。
 * ============================================================ */
import { requireUser } from '../_lib/firebase-auth.js';
import { getOrder, getEntitlement, latestPendingOrder, markOrderPaid, grantAdfree } from '../_lib/db.js';
import { resolvePaymentConfig, queryTradeInfo, oenVerifyCharged } from '../_lib/payment.js';
import { json, fail } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
    let user;
    try {
        user = await requireUser(request, env);
    } catch (err) {
        return fail(401, '未登入', err);
    }

    try {
        if (await getEntitlement(env, user.uid)) return json({ adfree: true, status: 'paid' });

        let body = {};
        try { body = await request.json(); } catch (e) { /* 沒帶 body 就用最近一筆未完成訂單 */ }

        const order = body.tradeNo
            ? await getOrder(env, String(body.tradeNo))
            : await latestPendingOrder(env, user.uid);

        // 訂單不屬於本人＝當作不存在，不洩漏他人訂單是否存在
        if (!order || order.uid !== user.uid) return json({ adfree: false, status: 'no-order' });

        const cfg = resolvePaymentConfig(env);

        if (cfg.provider === 'oen') {
            const { paid, tx } = await oenVerifyCharged(cfg, order);
            if (paid) {
                await markOrderPaid(env, order.trade_no, {
                    providerTxnId: (tx && tx.id) || order.provider_txn_id,
                    paymentType: (tx && tx.paymentMethod) || null,
                    rtnCode: 1, rtnMsg: 'recovered by OEN query', raw: JSON.stringify(tx),
                });
                await grantAdfree(env, user.uid, { tradeNo: order.trade_no, source: 'oen-query' });
                console.error('[paywall] 由主動查詢補開通：uid=' + user.uid + ' 訂單=' + order.trade_no);
                return json({ adfree: true, status: 'paid' });
            }
            // 把 OEN 的實際狀態帶回去：前端才分得出「還在處理（charging）」
            // 與「真的沒下文」——前者不該驚動管理員，後者才該。
            return json({
                adfree: false, status: 'pending', tradeNo: order.trade_no,
                providerStatus: (tx && tx.status) || null,
                providerMessage: (tx && tx.message) || null,
            });
        }

        const info = await queryTradeInfo(cfg, order.trade_no);

        // TradeStatus：0=未付款、1=已付款、10200095=交易失敗
        if (info.TradeStatus === '1' && Number(info.TradeAmt) === Number(order.amount)) {
            await markOrderPaid(env, order.trade_no, {
                providerTxnId: info.TradeNo, paymentType: info.PaymentType,
                rtnCode: 1, rtnMsg: 'recovered by query', raw: JSON.stringify(info),
            });
            await grantAdfree(env, user.uid, { tradeNo: order.trade_no, source: 'ecpay-query' });
            console.error('[paywall] 由主動查詢補開通：uid=' + user.uid + ' 訂單=' + order.trade_no);
            return json({ adfree: true, status: 'paid' });
        }
        return json({ adfree: false, status: 'pending', tradeNo: order.trade_no });
    } catch (err) {
        return fail(500, '查詢訂單失敗，請稍後再試', err, env);
    }
}
