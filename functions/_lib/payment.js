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
    // OEN 應援科技（全跳轉；端點依官方 API 文件，2026-08-20 站長提供）。
    //   checkout：POST，JSON body，回 {code,message,data}，data.id 拿去組結帳頁網址
    //   query：GET {query}/{transactionId}，覆核交易狀態（webhook 只當鈴聲，事實以此為準）
    //   結帳頁（瀏覽器跳轉目的地）是另一個網域：https://{merchantId}[.testing].oen.tw/checkout/{id}
    //   認證：Authorization: Bearer {PMC_PAY_TOKEN}（CRM 後台產製，只顯示一次）
    //   webhook 無簽章標頭 → 一律不信任其內容，收到後反查 query API 才算數
    oen: {
        stage: {
            checkout: 'https://payment-api.testing.oen.tw/checkout',
            query: 'https://payment-api.testing.oen.tw/transactions',
        },
        prod: {
            checkout: 'https://payment-api.oen.tw/checkout',
            query: 'https://payment-api.oen.tw/transactions',
        },
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

    // 🔒 正式部署的防呆：PMC_PAY_ENV 沒設會預設 stage，如果上線時忘了在 Production
    // 補這個變數，真實用戶會被送去金流商的「測試環境」——沒有真的收到錢，卻照樣
    // 開通權益，而且不會有任何錯誤訊息。這種靜默失敗比壞掉更糟，所以正式分支的
    // 部署一律要求顯式宣告 prod，寧可讓購買功能報錯也不要假裝在收錢。
    // （只擋建立訂單與回呼；/api/entitlement 不經過本函式，已購買的用戶不受影響。）
    const productionBranch = env.PMC_PRODUCTION_BRANCH || 'main';
    if (env.CF_PAGES_BRANCH === productionBranch && mode !== 'prod') {
        throw new Error(
            `正式部署（分支 ${productionBranch}）必須顯式設定 PMC_PAY_ENV=prod。` +
            '未設定時會落到金流商的測試環境：收不到錢卻照常開通權益。',
        );
    }

    // 憑證需求依金流商而異：
    //   綠界/歐付寶家族 → HashKey + HashIV（CheckMacValue 簽章）
    //   OEN            → Bearer token（PMC_PAY_TOKEN；在應援 CRM 後台產製，
    //                    只顯示一次、重產即覆蓋。存 CF Pages 環境變數並勾 Secret，
    //                    絕不進 git、絕不出現在前端）
    // 公開測試帳號只有綠界有；其他一律要自己填，不做任何猜測。
    const canUseStageDefaults = provider === 'ecpay' && mode === 'stage';
    const merchantId = env.PMC_PAY_MERCHANT_ID || (canUseStageDefaults ? ECPAY_STAGE_DEFAULTS.merchantId : '');
    const hashKey = env.PMC_PAY_HASH_KEY || (canUseStageDefaults ? ECPAY_STAGE_DEFAULTS.hashKey : '');
    const hashIV = env.PMC_PAY_HASH_IV || (canUseStageDefaults ? ECPAY_STAGE_DEFAULTS.hashIV : '');
    const bearerToken = env.PMC_PAY_TOKEN || '';
    if (provider === 'oen') {
        if (!merchantId || !bearerToken) {
            throw new Error('OEN 設定不完整：PMC_PAY_MERCHANT_ID 與 PMC_PAY_TOKEN 必須設定（token 於應援 CRM 後台產製）');
        }
    } else if (!merchantId || !hashKey || !hashIV) {
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
        bearerToken,
        checkoutUrl,
        queryUrl: env.PMC_PAY_QUERY_URL || ENDPOINTS[provider][mode].query || '',
        // Credit＝信用卡頁（Apple Pay 在金流商後台開通後會出現在同一頁）。
        choosePayment: env.PMC_PAY_CHOOSE_PAYMENT || 'Credit',
        // OEN 結帳頁 base（瀏覽器跳轉目的地；API base 是上面的 checkoutUrl，兩者不同網域）
        pageBase: env.PMC_PAY_PAGE_BASE ||
            (mode === 'stage' ? `https://${merchantId}.testing.oen.tw` : `https://${merchantId}.oen.tw`),
    };
}

// ============================================
// 去廣告定價（底價 ＋ 隨喜加碼）
// ============================================

/** 加碼級距。前端的按鈕與後端的驗證共用這一組數字，改這裡兩邊一起變。 */
export const ADFREE_TIP_STEPS = [25, 50];

/** 任何情況下都不接受低於這個數字的收費。設定失誤與程式改壞都被它擋住。 */
export const ADFREE_MIN_AMOUNT = 1;

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

/**
 * 定價設定。底價 PMC_ADFREE_PRICE 在測試環境會被調高（OEN 測試環境要求 >100），
 * 上限 PMC_ADFREE_MAX 用來擋惡意或誤觸的極端金額。
 * 前端靠 GET /api/pricing 拿這份設定來畫按鈕——**不可以在前端另外寫死一份**，
 * 兩邊數字不同會讓用戶看到的金額與實際扣款不一致。
 */
export function resolveAdfreePricing(env) {
    // 環境變數誤設成負數或 0 時不能讓它變成底價——那等於免費送權益。
    // 這不是攻擊路徑（設定只有站長改得動），但後果跟被攻擊一樣，所以照樣夾住。
    const rawBase = Math.trunc(Number(env.PMC_ADFREE_PRICE));
    const base = Number.isFinite(rawBase) && rawBase >= ADFREE_MIN_AMOUNT ? rawBase : 100;
    const rawMax = Math.trunc(Number(env.PMC_ADFREE_MAX));
    const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 1000;
    return { base, max: Math.max(base, max), steps: ADFREE_TIP_STEPS.slice() };
}

/**
 * 把前端送來的加碼金額換算成實際要收的總額。
 *
 * ⚠️ 金額一旦交給前端決定，伺服器端就必須自己驗一次——不然有人直接
 * POST {"tip": -99} 就能用一塊錢買走權益。**這裡是唯一的守門員**，
 * 前端把按鈕 disabled 掉只是體驗，不是防線。
 *
 * 回傳 { amount, base, tip } 或 { error }。
 */
export function resolveChargeAmount(env, rawTip) {
    const { base, max, steps } = resolveAdfreePricing(env);
    if (rawTip === undefined || rawTip === null || rawTip === '') {
        return { amount: base, base, tip: 0 };
    }
    const tip = Number(rawTip);
    if (!Number.isInteger(tip) || tip < 0) {
        return { error: '加碼金額必須是 0 或正整數' };
    }
    // 級距的最大公因數＝允許的最小顆粒（[25,50] → 25）。用 gcd 而不是寫死 25，
    // 這樣改 ADFREE_TIP_STEPS 時驗證會自動跟上。
    const unit = steps.reduce((a, b) => gcd(a, b));
    if (tip % unit !== 0) {
        return { error: `加碼金額必須是 ${unit} 的倍數` };
    }
    const amount = base + tip;
    if (amount > max) {
        return { error: `總金額上限為 NT$${max}` };
    }
    // 明寫的下限。今天 tip >= 0 已經保證 amount >= base，這行看起來是多餘的——
    // 但那條保證是「推導」出來的：哪天有人把介面改成直接收 amount，
    // 下限就會無聲消失。這行讓那種改法會在測試裡當場失敗，而不是上線後才發現。
    if (!Number.isFinite(amount) || amount < base || amount < ADFREE_MIN_AMOUNT) {
        return { error: '金額異常' };
    }
    return { amount, base, tip };
}

// ============================================
// OEN 應援科技（JSON API + Bearer token）
// ============================================

/** POST /checkout 建立交易。成功回傳 data（含 id）；code 非 S0000 一律丟錯。 */
export async function oenCreateCheckout(cfg, body) {
    const res = await fetch(cfg.checkoutUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.bearerToken },
        body: JSON.stringify(body),
    });
    let out = null;
    try { out = await res.json(); } catch (e) { /* 非 JSON → 走下面的錯誤路徑 */ }
    if (!res.ok || !out || out.code !== 'S0000' || !out.data || !out.data.id) {
        throw new Error(`OEN 建立交易失敗：HTTP ${res.status} code=${out && out.code} message=${out && out.message}`);
    }
    return out.data;
}

/** GET /transactions/{id} 查交易明細。回傳 data；查不到丟錯。 */
export async function oenGetTransaction(cfg, txnId) {
    const res = await fetch(cfg.queryUrl + '/' + encodeURIComponent(txnId), {
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.bearerToken },
    });
    let out = null;
    try { out = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok || !out || out.code !== 'S0000' || !out.data) {
        throw new Error(`OEN 查詢交易失敗：HTTP ${res.status} code=${out && out.code} message=${out && out.message}`);
    }
    return out.data;
}

/** 消費者要跳轉去的 OEN 結帳頁網址。 */
export function oenCheckoutPageUrl(cfg, txnId) {
    return cfg.pageBase + '/checkout/' + encodeURIComponent(txnId);
}

/**
 * 用 OEN 查詢 API 覆核一筆訂單是否真的付款成功。
 * 這是 OEN 流程唯一的事實來源——webhook 沒有簽章，只當「該來查了」的鈴聲。
 * 三道檢查：狀態是 charged/claimed、金額相符、OEN 記錄的 orderId 就是這筆訂單。
 * fallbackTxnId：訂單上沒存 provider_txn_id 時（建單後補寫失敗的邊角），
 * 可用 webhook 給的 id 查——安全，因為 orderId 綁定是由 OEN 的回應確認的。
 */
export async function oenVerifyCharged(cfg, order, fallbackTxnId) {
    const txnId = order.provider_txn_id || fallbackTxnId || '';
    if (!txnId) return { paid: false, reason: 'no-txn-id' };
    const tx = await oenGetTransaction(cfg, txnId);
    const statusOk = tx.status === 'charged' || tx.status === 'claimed';
    const amountOk = Number(tx.amount) === Number(order.amount);
    const orderOk = !('orderId' in tx) || tx.orderId === order.trade_no;
    if (!orderOk) console.error(`[paywall] OEN 交易 ${txnId} 的 orderId=${tx.orderId} 與訂單 ${order.trade_no} 不符`);
    return { paid: statusOk && amountOk && orderOk, tx };
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
