/* functions/_lib/http.js — 共用回應工具 */

export function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

/** 對外只吐通用訊息，細節寫 console.error（正式環境永遠輸出，符合鐵則 8）。 */
export function fail(status, publicMessage, err) {
    if (err) console.error('[paywall] ' + publicMessage + ' → ' + (err && err.message ? err.message : err));
    return json({ error: publicMessage }, status);
}

/** 讀取 x-www-form-urlencoded 的請求（綠界回呼一律是這個格式）。 */
export async function readFormParams(request) {
    const text = await request.text();
    const out = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
}

/** 對外的站台網址：優先用環境變數（正式網域），否則用這次請求的 origin。 */
export function siteOrigin(request, env) {
    return (env.PMC_SITE_ORIGIN || new URL(request.url).origin).replace(/\/$/, '');
}
