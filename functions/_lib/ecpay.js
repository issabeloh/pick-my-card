/* ============================================================
 * functions/_lib/ecpay.js — 綠界 AIO 全方位金流工具
 * 區塊目錄（Grep 關鍵字）：
 *  - .NET 相容 URL encode  → "dotNetUrlEncode"
 *  - CheckMacValue 計算     → "makeCheckMacValue"
 *  - 驗證回呼               → "verifyCheckMacValue"
 *  - 端點與設定             → "resolveEcpayConfig"
 *  - 訂單編號生成           → "newTradeNo"
 *  - 查詢訂單               → "queryTradeInfo"
 *
 * ⚠️ CheckMacValue 是整條金流唯一的防偽章。綠界的演算法規定用 .NET 的
 *    HttpUtility.UrlEncode 語意（空白→`+`、安全字元只有 A-Za-z0-9-_.!*()），
 *    跟 JS 的 encodeURIComponent 有三處差異，全部在 dotNetUrlEncode 補齊。
 *    算錯的症狀是綠界回 10200073「CheckMacValue Error」。
 * ============================================================ */

// 綠界測試環境的公開測試特店（官方文件公布，任何人可用）。
// 只有在 PMC_ECPAY_ENV 不是 'prod' 時才會被拿來當預設值——正式環境沒設金鑰
// 一律直接報錯，避免「上線了但錢進到綠界的測試帳號」這種災難。
const STAGE_DEFAULTS = {
    merchantId: '2000132',
    hashKey: '5294y06JbISpM5x9',
    hashIV: 'v77hoKGq4kWxNNIS',
};

const ENDPOINTS = {
    stage: {
        checkout: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
        query: 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5',
    },
    prod: {
        checkout: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
        query: 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5',
    },
};

// .NET HttpUtility.UrlEncode 相容編碼。
// encodeURIComponent 與 .NET 的三處差異：
//   1. 空白：encodeURIComponent → %20，.NET → +
//   2. 單引號 '：encodeURIComponent 不編碼，.NET → %27
//   3. 波浪號 ~：encodeURIComponent 不編碼，.NET → %7e
// 其餘安全字元（- _ . ! * ( )）兩邊一致，不用動。
export function dotNetUrlEncode(str) {
    return encodeURIComponent(String(str))
        .replace(/%20/g, '+')
        .replace(/'/g, '%27')
        .replace(/~/g, '%7e');
}

async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 依綠界規格計算 CheckMacValue（EncryptType=1，SHA256）。
 * 步驟：參數依 key 英文字母排序 → 前後夾 HashKey/HashIV → URL encode → 轉小寫
 *      → SHA256 → 轉大寫。
 */
export function buildMacSource(params, hashKey, hashIV) {
    const keys = Object.keys(params)
        .filter((k) => k !== 'CheckMacValue' && params[k] !== undefined && params[k] !== null)
        .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
    const body = keys.map((k) => `${k}=${params[k]}`).join('&');
    return dotNetUrlEncode(`HashKey=${hashKey}&${body}&HashIV=${hashIV}`).toLowerCase();
}

export async function makeCheckMacValue(params, hashKey, hashIV) {
    return (await sha256Hex(buildMacSource(params, hashKey, hashIV))).toUpperCase();
}

/** 驗證綠界回呼的 CheckMacValue。回呼一律先過這關，沒過就當成偽造請求丟掉。 */
export async function verifyCheckMacValue(params, hashKey, hashIV) {
    const received = String(params.CheckMacValue || '').toUpperCase();
    if (!received) return false;
    const expected = await makeCheckMacValue(params, hashKey, hashIV);
    // 長度先比，再逐字元比（固定時間比對，避免時序側錄）
    if (expected.length !== received.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
    return diff === 0;
}

/**
 * 從 Cloudflare 環境變數解析綠界設定。
 * 正式環境（PMC_ECPAY_ENV=prod）缺任何一把金鑰就丟錯，不會靜默退回測試帳號。
 */
export function resolveEcpayConfig(env) {
    const mode = (env.PMC_ECPAY_ENV || 'stage').toLowerCase() === 'prod' ? 'prod' : 'stage';
    const merchantId = env.PMC_ECPAY_MERCHANT_ID || (mode === 'stage' ? STAGE_DEFAULTS.merchantId : '');
    const hashKey = env.PMC_ECPAY_HASH_KEY || (mode === 'stage' ? STAGE_DEFAULTS.hashKey : '');
    const hashIV = env.PMC_ECPAY_HASH_IV || (mode === 'stage' ? STAGE_DEFAULTS.hashIV : '');
    if (!merchantId || !hashKey || !hashIV) {
        throw new Error('綠界設定不完整：PMC_ECPAY_MERCHANT_ID / PMC_ECPAY_HASH_KEY / PMC_ECPAY_HASH_IV 必須設定');
    }
    return {
        mode,
        merchantId,
        hashKey,
        hashIV,
        checkoutUrl: ENDPOINTS[mode].checkout,
        queryUrl: ENDPOINTS[mode].query,
        // Credit＝信用卡頁（Apple Pay 在綠界後台開通後會出現在同一頁）。
        // 若綠界確認 ApplePay 可當獨立 ChoosePayment 值，改這個環境變數即可。
        choosePayment: env.PMC_ECPAY_CHOOSE_PAYMENT || 'Credit',
    };
}

/** 綠界要求 MerchantTradeDate 是台灣時間 yyyy/MM/dd HH:mm:ss。 */
export function taipeiTradeDate(now = new Date()) {
    const tw = new Date(now.getTime() + 8 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${tw.getUTCFullYear()}/${p(tw.getUTCMonth() + 1)}/${p(tw.getUTCDate())} ` +
           `${p(tw.getUTCHours())}:${p(tw.getUTCMinutes())}:${p(tw.getUTCSeconds())}`;
}

/** 訂單編號：綠界限制 20 碼英數。PMC + base36 時間 + 6 碼亂數 = 17 碼。 */
export function newTradeNo() {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const rand = Array.from(bytes).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6);
    return ('PMC' + Date.now().toString(36) + rand).toUpperCase().slice(0, 20);
}

/** 主動查詢訂單狀態（對帳／自我修復用）。 */
export async function queryTradeInfo(cfg, tradeNo) {
    const params = {
        MerchantID: cfg.merchantId,
        MerchantTradeNo: tradeNo,
        TimeStamp: Math.floor(Date.now() / 1000),
        PlatformID: '',
    };
    params.CheckMacValue = await makeCheckMacValue(params, cfg.hashKey, cfg.hashIV);
    const res = await fetch(cfg.queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
    });
    const text = await res.text();
    const out = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
}
