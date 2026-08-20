/* ============================================================
 * functions/_lib/payment.js — 金流工具（綠界 ECPay / 歐付寶 O'Pay 家族）
 * 區塊目錄（Grep 關鍵字）：
 *  - .NET 相容 URL encode  → "dotNetUrlEncode"
 *  - CheckMacValue 計算     → "makeCheckMacValue"
 *  - 驗證回呼               → "verifyCheckMacValue"
 *  - 端點與設定             → "resolvePaymentConfig" / "ENDPOINTS"
 *  - 訂單編號生成           → "newTradeNo"
 *  - 查詢訂單               → "queryTradeInfo"
 *
 * ⚠️ CheckMacValue 是整條金流唯一的防偽章。綠界的演算法規定用 .NET 的
 *    HttpUtility.UrlEncode 語意（空白→`+`、安全字元只有 A-Za-z0-9-_.!*()），
 *    跟 JS 的 encodeURIComponent 有三處差異，全部在 dotNetUrlEncode 補齊。
 *    算錯的症狀是綠界回 10200073「CheckMacValue Error」。
 * ============================================================ */

// 綠界測試環境的公開測試特店（官方文件公布，任何人可用）。
// 只有在 provider=ecpay 且非 prod 時才會被拿來當預設值——正式環境沒設金鑰
// 一律直接報錯，避免「上線了但錢進到別人的測試帳號」這種災難。
const ECPAY_STAGE_DEFAULTS = {
    merchantId: '2000132',
    hashKey: '5294y06JbISpM5x9',
    hashIV: 'v77hoKGq4kWxNNIS',
};

// 綠界與歐付寶同源（綠界的團隊自歐付寶分出），CheckMacValue 的演算法與
// AioCheckOut 的參數規格屬同一家族，因此共用本檔的實作，只有端點不同。
//
// ⚠️ 歐付寶的端點網址是依同一命名慣例推得的，**尚未實測**。帳號下來後：
//    1. 先跑 node tools/paywall/mac-selftest.mjs（演算法層）
//    2. 再用測試環境送一筆真的訂單，確認不是回 CheckMacValue Error
//    若歐付寶的網址或規格與此不同，不必改程式——直接設
//    PMC_PAY_CHECKOUT_URL / PMC_PAY_QUERY_URL 覆蓋即可（見下方 resolvePaymentConfig）。
const ENDPOINTS = {
    ecpay: {
        stage: {
            checkout: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
            query: 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5',
        },
        prod: {
            checkout: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
            query: 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5',
        },
    },
    opay: {
        stage: {
            checkout: 'https://payment-stage.opay.tw/Cashier/AioCheckOut/V5',
            query: 'https://payment-stage.opay.tw/Cashier/QueryTradeInfo/V5',
        },
        prod: {
            checkout: 'https://payment.opay.tw/Cashier/AioCheckOut/V5',
            query: 'https://payment.opay.tw/Cashier/QueryTradeInfo/V5',
        },
    },
    // OEN 應援科技（全跳轉）。已知事實（2026-08-20，由 OEN 業務提供）：
    //   測試環境入口 https://pick-my-card.testing.oen.tw/ ——注意是「每個特店一個子網域」
    //   merchantId   pick-my-card ——是字串代號，不是綠界那種數字特店編號
    // 未知：API 路徑、請求格式、回呼格式與驗章方式（API 文件在 Postman 上，
    //       本開發環境的 egress 政策讀不到）。
    // 因此這裡**不給任何預設路徑**——沒有真實文件就不猜，猜錯的驗章不是
    // 「不能用」就是「誰都能偽造已付款通知」。要用 OEN 必須顯式設定
    // PMC_PAY_CHECKOUT_URL / PMC_PAY_QUERY_URL，否則下面會丟出帶指引的錯誤。
    oen: { stage: {}, prod: {} },
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
 * 從 Cloudflare 環境變數解析金流設定。
 *
 * PMC_PAY_PROVIDER  ecpay（預設）| opay
 * PMC_PAY_ENV       stage（預設）| prod
 * PMC_PAY_CHECKOUT_URL / PMC_PAY_QUERY_URL
 *                   端點逃生門：金流商換網址、或實際規格與上面的推測不符時，
 *                   設這兩個變數就能覆蓋，不必改程式碼、不必重新部署程式。
 *
 * 正式環境（PMC_PAY_ENV=prod）缺任何一把金鑰就丟錯，不會靜默退回測試帳號。
 */
export function resolvePaymentConfig(env) {
    const provider = (env.PMC_PAY_PROVIDER || 'ecpay').toLowerCase();
    if (!ENDPOINTS[provider]) {
        throw new Error(`不支援的金流商 PMC_PAY_PROVIDER=${provider}（可用：${Object.keys(ENDPOINTS).join(' / ')}）`);
    }
    const mode = (env.PMC_PAY_ENV || 'stage').toLowerCase() === 'prod' ? 'prod' : 'stage';

    // 公開測試帳號只有綠界有；歐付寶一律要自己填，不做任何猜測
    const canUseStageDefaults = provider === 'ecpay' && mode === 'stage';
    const merchantId = env.PMC_PAY_MERCHANT_ID || (canUseStageDefaults ? ECPAY_STAGE_DEFAULTS.merchantId : '');
    const hashKey = env.PMC_PAY_HASH_KEY || (canUseStageDefaults ? ECPAY_STAGE_DEFAULTS.hashKey : '');
    const hashIV = env.PMC_PAY_HASH_IV || (canUseStageDefaults ? ECPAY_STAGE_DEFAULTS.hashIV : '');
    if (!merchantId || !hashKey || !hashIV) {
        throw new Error('金流設定不完整：PMC_PAY_MERCHANT_ID / PMC_PAY_HASH_KEY / PMC_PAY_HASH_IV 必須設定');
    }

    // 沒有內建端點的金流商（目前是 oen）必須顯式指定，錯誤訊息要講清楚該設什麼
    const checkoutUrl = env.PMC_PAY_CHECKOUT_URL || ENDPOINTS[provider][mode].checkout;
    if (!checkoutUrl) {
        throw new Error(
            `金流商 ${provider} 沒有內建結帳端點，請設定 PMC_PAY_CHECKOUT_URL` +
            `（${provider === 'oen' ? '測試環境入口為 https://pick-my-card.testing.oen.tw/，實際 API 路徑見 OEN 文件' : '見金流商文件'}）`,
        );
    }

    return {
        provider,
        mode,
        merchantId,
        hashKey,
        hashIV,
        checkoutUrl,
        queryUrl: env.PMC_PAY_QUERY_URL || ENDPOINTS[provider][mode].query || '',
        // Credit＝信用卡頁（Apple Pay 在金流商後台開通後會出現在同一頁）。
        choosePayment: env.PMC_PAY_CHOOSE_PAYMENT || 'Credit',
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
