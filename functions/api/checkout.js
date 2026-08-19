/* ============================================================
 * POST /api/checkout — 建立去廣告訂單，回傳要送去綠界的表單參數
 *
 * 身份規則：uid 只從驗過的 Firebase ID token 取，前端傳什麼都不信。
 * 訂單「一出生就綁 uid」——不存在「先付款、事後才知道是誰」的空窗。
 * ============================================================ */
import { requireUser } from '../_lib/firebase-auth.js';
import { createOrder, getEntitlement } from '../_lib/db.js';
import { resolvePaymentConfig, makeCheckMacValue, taipeiTradeDate, newTradeNo } from '../_lib/payment.js';
import { json, fail, siteOrigin } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
    let user;
    try {
        user = await requireUser(request, env);
    } catch (err) {
        return fail(401, '請先登入再購買', err);
    }

    try {
        // 已經買過就不要再讓他付一次錢
        if (await getEntitlement(env, user.uid)) {
            return json({ alreadyPaid: true });
        }

        const cfg = resolvePaymentConfig(env);
        const origin = siteOrigin(request, env);
        const amount = Number(env.PMC_ADFREE_PRICE || 100);
        const tradeNo = newTradeNo();

        // 先寫訂單再送綠界：綠界的通知一定找得到對應的 uid
        await createOrder(env, { tradeNo, uid: user.uid, email: user.email, amount });

        const params = {
            MerchantID: cfg.merchantId,
            MerchantTradeNo: tradeNo,
            MerchantTradeDate: taipeiTradeDate(),
            PaymentType: 'aio',
            TotalAmount: amount,
            // TradeDesc 刻意用純英數：綠界文件對這欄是否要預先 UrlEncode 的敘述有歧義，
            // 用不需編碼的字串就讓歧義消失（ItemName 才是用戶在刷卡頁看到的名稱）。
            TradeDesc: 'PickMyCard AdFree',
            ItemName: '去廣告權益（一次買斷）',
            ReturnURL: origin + '/api/pay/notify',       // 綠界 server 對 server 通知＝唯一開通依據
            OrderResultURL: origin + '/api/pay/return',  // 瀏覽器導回，只做畫面顯示
            ClientBackURL: origin + '/',
            ChoosePayment: cfg.choosePayment,
            EncryptType: 1,
            NeedExtraPaidInfo: 'N',
            CustomField1: user.uid,  // 對帳用備援；開通仍以訂單表的 uid 為準
        };
        params.CheckMacValue = await makeCheckMacValue(params, cfg.hashKey, cfg.hashIV);

        return json({ action: cfg.checkoutUrl, params, tradeNo, amount });
    } catch (err) {
        return fail(500, '建立訂單失敗，請稍後再試', err);
    }
}
