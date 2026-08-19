/* ============================================================
 * POST /api/ecpay/return — 綠界把「瀏覽器」導回這裡（OrderResultURL）
 *
 * 只負責把人送回站上並顯示結果，不做任何開通動作：
 * 這條路徑上的參數使用者改得動，開通一律以 /api/ecpay/notify 為準。
 * 前端拿到 pmc_pay 參數後會再向 /api/entitlement 要一次真實狀態。
 * ============================================================ */
import { resolveEcpayConfig, verifyCheckMacValue } from '../../_lib/ecpay.js';
import { readFormParams, siteOrigin } from '../../_lib/http.js';

async function handle(request, env) {
    const origin = siteOrigin(request, env);
    let status = 'unknown';
    let tradeNo = '';
    try {
        const params = request.method === 'POST'
            ? await readFormParams(request)
            : Object.fromEntries(new URL(request.url).searchParams);
        tradeNo = params.MerchantTradeNo || '';
        const cfg = resolveEcpayConfig(env);
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
