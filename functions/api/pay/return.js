/* ============================================================
 * POST /api/ecpay/return — 綠界把「瀏覽器」導回這裡（OrderResultURL）
 *
 * 只負責把人送回站上並顯示結果，不做任何開通動作：
 * 這條路徑上的參數使用者改得動，開通一律以 /api/ecpay/notify 為準。
 * 前端拿到 pmc_pay 參數後會再向 /api/entitlement 要一次真實狀態。
 * ============================================================ */
import { resolvePaymentConfig, verifyCheckMacValue } from '../../_lib/payment.js';
import { readFormParams, siteOrigin } from '../../_lib/http.js';

async function handle(request, env) {
    const origin = siteOrigin(request, env);
    let status = 'unknown';
    let tradeNo = '';

    // OEN：付款後以 GET 轉址回來。successUrl 我方帶了 r=ok；failureUrl 無參數、
    // OEN 失敗時自己附 ?payment_error=<code>。這條路沒有簽章可驗——沒關係，
    // 本頁本來就只做畫面翻譯，真實狀態由前端再向 /api/entitlement 要。
    try {
        const cfg = resolvePaymentConfig(env);
        if (cfg.provider === 'oen') {
            const sp = new URL(request.url).searchParams;
            if (sp.get('payment_error')) status = 'failed';
            else if (sp.get('r') === 'ok') status = 'success';
            const url = status === 'unknown'
                ? origin + '/'
                : origin + '/?pmc_pay=' + encodeURIComponent(status);
            return Response.redirect(url, 303);
        }
    } catch (err) {
        console.error('[paywall] return 金流設定錯誤 →', err);
        return Response.redirect(origin + '/', 303);
    }

    try {
        const params = request.method === 'POST'
            ? await readFormParams(request)
            : Object.fromEntries(new URL(request.url).searchParams);
        tradeNo = params.MerchantTradeNo || '';
        const cfg = resolvePaymentConfig(env);
        if (await verifyCheckMacValue(params, cfg.hashKey, cfg.hashIV)) {
            status = params.RtnCode === '1' ? 'success' : 'failed';
        }
    } catch (err) {
        console.error('[paywall] return 處理失敗 →', err);
    }
    const url = `${origin}/?pmc_pay=${encodeURIComponent(status)}` +
                (tradeNo ? `&pmc_trade=${encodeURIComponent(tradeNo)}` : '');
    return Response.redirect(url, 303);
}

export const onRequestPost = ({ request, env }) => handle(request, env);
export const onRequestGet = ({ request, env }) => handle(request, env);
