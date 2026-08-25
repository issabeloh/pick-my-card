/* GET /api/pay/healthcheck — 白名單健檢（給外部排程呼叫，見 docs/project/paywall.md 3.5）
 *
 * 為什麼需要這支：正式環境的 OEN 用「來源 IP 白名單」控管，而我們跑在 Cloudflare
 * Pages Functions 上、出口 IP 不固定（走 Cloudflare 共用池）。應援同意以 Cloudflare
 * 公布的區段設白名單，但他們無從得知區段何時變動——所以監控責任在我們這邊。
 *
 * 這支端點做兩件事，而且**必須從 Cloudflare 這一端執行**（從 GitHub Actions 直接
 * 打 OEN 是驗不到白名單的，來源 IP 根本不一樣）：
 *   1. 用金流設定實際打一次 OEN 查詢 API，確認我們的出口 IP 沒有被擋
 *   2. 回報 Cloudflare 官方 IP 區段清單的 etag，讓排程比對有沒有變動
 *
 * 刻意不自己發通知：判斷與告警交給呼叫端（tools/paywall/healthcheck-client.mjs
 * ＋ GitHub Actions，失敗時 GitHub 會寄信）。這支只負責誠實回報事實。
 */
import { resolvePaymentConfig } from '../../_lib/payment.js';
import { json } from '../../_lib/http.js';

const CF_IPS_URL = 'https://api.cloudflare.com/client/v4/ips';

/** 拿不到就回 null，不讓 Cloudflare 端的問題蓋掉 OEN 的檢查結果。 */
async function probeCloudflareIps() {
    try {
        const res = await fetch(CF_IPS_URL, { headers: { Accept: 'application/json' } });
        const out = await res.json();
        if (!res.ok || !out || !out.success || !out.result) {
            return { ok: false, error: `HTTP ${res.status}` };
        }
        const r = out.result;
        return {
            ok: true,
            etag: r.etag || '',
            ipv4Count: Array.isArray(r.ipv4_cidrs) ? r.ipv4_cidrs.length : 0,
            ipv6Count: Array.isArray(r.ipv6_cidrs) ? r.ipv6_cidrs.length : 0,
        };
    } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
    }
}

/**
 * 打一次 OEN 查詢 API，判斷「有沒有通過白名單」。
 *
 * 注意判準：我們要驗的是**連得到**，不是查得到交易。所以只要 OEN 有回一個
 * 帶 code 的 JSON（哪怕是查無此交易），就代表白名單是通的。反過來，連線層失敗
 * 或 401/403，才是被擋掉的訊號。
 * 設了 PMC_HEALTHCHECK_TXN_ID（一筆真實的舊交易 id）時判準更嚴：要求 code=S0000。
 */
async function probeOen(cfg, txnId) {
    const url = cfg.queryUrl + '/' + encodeURIComponent(txnId);
    let res;
    try {
        res = await fetch(url, {
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.bearerToken },
        });
    } catch (err) {
        // fetch 層就失敗＝連不上，最像被 IP 白名單擋掉的樣子
        return { reachable: false, reason: 'network', error: err && err.message ? err.message : String(err) };
    }
    let out = null;
    try { out = await res.json(); } catch (e) { /* 非 JSON → 下面照樣判 */ }
    const code = out && out.code ? String(out.code) : '';
    if (res.status === 401 || res.status === 403) {
        return { reachable: false, reason: 'rejected', httpStatus: res.status, code };
    }
    if (!code) {
        // 有回應但不像 OEN 的格式：可能被中間層攔截，值得人工看一眼
        return { reachable: false, reason: 'unexpected-body', httpStatus: res.status };
    }
    return { reachable: true, httpStatus: res.status, code, strictOk: code === 'S0000' };
}

export async function onRequestGet({ request, env }) {
    // 這支端點會實際去打金流商，必須擋住陌生人；token 沒設就整支停用，不留後門。
    const expected = env.PMC_HEALTHCHECK_TOKEN || '';
    const given = request.headers.get('x-pmc-healthcheck') || '';
    if (!expected || given !== expected) {
        return json({ error: 'unauthorized' }, 401);
    }

    let cfg;
    try {
        cfg = resolvePaymentConfig(env);
    } catch (err) {
        return json({
            ok: false,
            stage: 'config',
            error: err && err.message ? err.message : String(err),
        }, 200);
    }

    // 沒指定就用一個一定查不到的 id：目的是驗連通性，不是驗資料
    const probeTxnId = env.PMC_HEALTHCHECK_TXN_ID || 'pmc-healthcheck-probe';
    const strict = !!env.PMC_HEALTHCHECK_TXN_ID;
    const [oen, cfIps] = await Promise.all([probeOen(cfg, probeTxnId), probeCloudflareIps()]);

    const oenOk = oen.reachable && (!strict || oen.strictOk);
    if (!oenOk) console.error('[paywall] 白名單健檢失敗：' + JSON.stringify(oen));

    return json({
        ok: oenOk,
        checkedAt: new Date().toISOString(),
        provider: cfg.provider,
        mode: cfg.mode,
        strict,
        oen,
        cfIps,
    });
}
