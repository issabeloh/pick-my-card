/* ============================================================
 * POST /api/checkout — 建立去廣告訂單，回傳要送去綠界的表單參數
 *
 * 身份規則：uid 只從驗過的 Firebase ID token 取，前端傳什麼都不信。
 * 訂單「一出生就綁 uid」——不存在「先付款、事後才知道是誰」的空窗。
 * ============================================================ */
import { requireUser } from '../_lib/firebase-auth.js';
import { createOrder, getEntitlement, setOrderProviderTxn } from '../_lib/db.js';
import { resolvePaymentConfig, makeCheckMacValue, taipeiTradeDate, newTradeNo,
         oenCreateCheckout, oenCheckoutPageUrl, resolveChargeAmount } from '../_lib/payment.js';
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

        // 隨喜加碼：前端送 tip（加碼金額），總額一律由伺服器端算並驗證。
        // body 讀不到就當作沒加碼——不要因為缺 body 就整個失敗。
        let body = {};
        try { body = await request.json(); } catch (e) { /* 無 body 或非 JSON → 視為未加碼 */ }
        const priced = resolveChargeAmount(env, body && body.tip);
        if (priced.error) return json({ error: priced.error }, 400);
        const amount = priced.amount;

        const cfg = resolvePaymentConfig(env);
        const origin = siteOrigin(request, env);
        const tradeNo = newTradeNo();

        // 先寫訂單再呼叫金流商：對方的通知回來時一定找得到對應的 uid。
        // 若後續呼叫失敗，這筆訂單留在 pending，無害。
        await createOrder(env, { tradeNo, uid: user.uid, email: user.email, amount, tip: priced.tip });

        if (cfg.provider === 'oen') {
            // OEN：JSON API 建立交易 → 把瀏覽器導去它的結帳頁。
            // 不帶 allowedPaymentMethods＝只開信用卡（OEN 預設）。超商/ATM 是
            // 非即時付款，會破壞「付款完成立即生效」的前提，刻意不開。
            const tx = await oenCreateCheckout(cfg, {
                merchantId: cfg.merchantId,
                amount,
                currency: 'TWD',
                orderId: tradeNo,
                // successUrl 帶 r=ok；failureUrl 保持無參數（OEN 失敗時會自己
                // 附上 ?payment_error=<code>，預先帶參數可能被拼壞）
                successUrl: origin + '/api/pay/return?r=ok',
                failureUrl: origin + '/api/pay/return',
                use3d: env.PMC_PAY_USE3D === '1',
                customId: user.uid, // 對帳備援；開通仍以訂單表的 uid 為準
                productDetails: [{
                    productionCode: 'adfree',
                    description: priced.tip > 0
                        ? `去廣告權益（一次買斷）＋加碼支持 NT$${priced.tip}`
                        : '去廣告權益（一次買斷）',
                    quantity: 1,
                    unit: '式',
                    unitPrice: amount,
                }],
            });
            // 交易 ID 存回訂單：webhook 覆核與自我修復都靠它
            await setOrderProviderTxn(env, tradeNo, tx.id);
            return json({ redirectUrl: oenCheckoutPageUrl(cfg, tx.id), tradeNo, amount });
        }

        const params = {
            MerchantID: cfg.merchantId,
            MerchantTradeNo: tradeNo,
            MerchantTradeDate: taipeiTradeDate(),
            PaymentType: 'aio',
            TotalAmount: amount,
            // TradeDesc 刻意用純英數：綠界文件對這欄是否要預先 UrlEncode 的敘述有歧義，
            // 用不需編碼的字串就讓歧義消失（ItemName 才是用戶在刷卡頁看到的名稱）。
            TradeDesc: 'PickMyCard AdFree',
            ItemName: priced.tip > 0
                ? `去廣告權益（一次買斷）＋加碼支持 NT$${priced.tip}`
                : '去廣告權益（一次買斷）',
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
        return fail(500, '建立訂單失敗，請稍後再試', err, env);
    }
}
