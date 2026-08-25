/* GET /api/pricing — 去廣告的底價、上限與加碼級距（公開資訊，不需登入）
 *
 * 為什麼要有這支：底價由 PMC_ADFREE_PRICE 決定（測試環境會調高），
 * 如果前端另外寫死一份數字，用戶看到的總額就會跟實際扣款不一致——
 * 加了隨喜加碼之後這種不一致會直接變成「多扣錢」，不是小事。
 * 所以定價只有一個來源：伺服器端的 resolveAdfreePricing()。
 */
import { resolveAdfreePricing } from '../_lib/payment.js';
import { json } from '../_lib/http.js';

export async function onRequestGet({ env }) {
    return json(resolveAdfreePricing(env));
}
