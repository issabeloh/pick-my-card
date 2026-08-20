/* ============================================================
 * ALL /api/pay/inspect — 金流回呼的「原樣抓取」端點（串接期專用）
 *
 * 用途：新金流商串接時，把對方的「交易資料回傳網址」先指到這裡，
 *      跑一筆測試交易，就能在 Cloudflare 的即時日誌看到對方**實際**送出的
 *      方法、標頭與原始 body。有了真實樣本才能寫出正確的驗章邏輯——
 *      靠猜的只有兩種結果：全部擋掉（不能用），或放寬驗證（任何人都能
 *      偽造一筆「已付款」通知白拿權益，那是真的資安漏洞）。
 *
 * ⚠️ 三個刻意的設計：
 *   1. 預設 404。要設 PMC_PAY_INSPECT=1 才會啟用，避免忘了拿掉就上線。
 *   2. 這支永遠不碰 D1、不開通任何權益、不回報成功與否給業務邏輯。
 *      它只是一台錄音機。
 *   3. 標頭會原樣記錄（驗證機制常藏在標頭裡，遮掉就失去意義）。
 *      因此只在**測試環境**用，串完就把 PMC_PAY_INSPECT 移除。
 * ============================================================ */

const MAX_BODY_LOG = 8000; // 避免超長 body 灌爆日誌

export async function onRequest({ request, env }) {
    // 啟用條件（二擇一）：
    //   a. 顯式設 PMC_PAY_INSPECT=1
    //   b. 這是 preview 部署（CF Pages 會給 CF_PAGES_BRANCH；非正式分支即 preview）
    // (b) 是為了少一個手動步驟：串接期本來就在 preview 上做。正式站永遠不會啟用，
    //     因為正式站的 CF_PAGES_BRANCH 就是 PRODUCTION_BRANCH。
    const productionBranch = env.PMC_PRODUCTION_BRANCH || 'main';
    const branch = env.CF_PAGES_BRANCH || '';
    const enabled = env.PMC_PAY_INSPECT === '1' || (branch !== '' && branch !== productionBranch);
    if (!enabled) {
        return new Response('Not Found', { status: 404 });
    }

    const url = new URL(request.url);
    const headers = {};
    for (const [key, value] of request.headers) headers[key] = value;

    let body = '';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        try {
            body = await request.text();
        } catch (err) {
            body = '（讀取 body 失敗：' + (err && err.message ? err.message : err) + '）';
        }
    }
    const truncated = body.length > MAX_BODY_LOG;

    // console.error：正式環境也一定會輸出（鐵則 8）
    console.error('[pay-inspect] ' + JSON.stringify({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        contentType: request.headers.get('content-type') || null,
        headers,
        bodyLength: body.length,
        bodyTruncated: truncated,
        body: truncated ? body.slice(0, MAX_BODY_LOG) + '…(截斷)' : body,
    }, null, 2));

    // 回 200＋簡短純文字：多數金流商把非 2xx 當成失敗並重送，
    // 抓取階段我們希望對方認為成功、不要一直重送。
    return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
