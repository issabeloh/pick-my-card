/* ============================================================
 * functions/_lib/firebase-auth.js — 在 Cloudflare Worker 裡驗 Firebase ID token
 * 區塊目錄（Grep 關鍵字）：
 *  - 公鑰快取        → "getSigningKeys"
 *  - 驗證主流程      → "verifyIdToken"
 *  - 從請求取 token  → "requireUser"
 *
 * 為什麼要自己驗：Worker 上沒有 firebase-admin（Node SDK）。改用 Google 公開的
 * JWK 端點 + Web Crypto 驗 RS256 簽章。這是後端唯一承認的身份來源——
 * 前端傳來的 uid 一律不信，uid 只從驗過的 token 的 sub 取。
 * ============================================================ */

const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let keyCache = { keys: null, expiresAt: 0 };

async function getSigningKeys() {
    if (keyCache.keys && keyCache.expiresAt > Date.now()) return keyCache.keys;
    const res = await fetch(JWK_URL);
    if (!res.ok) throw new Error('無法取得 Firebase 公鑰：HTTP ' + res.status);
    const data = await res.json();
    const map = {};
    for (const jwk of data.keys || []) map[jwk.kid] = jwk;
    // 照 Google 給的 Cache-Control 決定快取多久，拿不到就退 1 小時
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
    keyCache = { keys: map, expiresAt: Date.now() + (maxAge ? Number(maxAge[1]) * 1000 : 3600_000) };
    return map;
}

function b64urlToBytes(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function b64urlToJSON(str) {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
}

/**
 * 驗證 Firebase ID token，成功回傳 { uid, email, emailVerified }。
 * 任何一項不符就丟錯（呼叫端一律轉成 401）。
 */
export async function verifyIdToken(token, projectId) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('token 格式錯誤');

    const header = b64urlToJSON(parts[0]);
    const payload = b64urlToJSON(parts[1]);

    if (header.alg !== 'RS256') throw new Error('簽章演算法必須是 RS256');
    if (!header.kid) throw new Error('token 缺少 kid');

    const jwk = (await getSigningKeys())[header.kid];
    if (!jwk) throw new Error('找不到對應的簽章公鑰（kid 已輪替或 token 非 Firebase 簽發）');

    const key = await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
    );
    const ok = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        b64urlToBytes(parts[2]),
        new TextEncoder().encode(parts[0] + '.' + parts[1]),
    );
    if (!ok) throw new Error('簽章驗證失敗');

    const now = Math.floor(Date.now() / 1000);
    const SKEW = 60; // 容許 60 秒時鐘誤差
    if (payload.aud !== projectId) throw new Error('aud 不是本專案');
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('iss 不正確');
    if (!payload.sub) throw new Error('token 缺少 sub');
    if (typeof payload.exp !== 'number' || payload.exp + SKEW < now) throw new Error('token 已過期');
    if (typeof payload.iat !== 'number' || payload.iat - SKEW > now) throw new Error('token 的 iat 在未來');

    return { uid: payload.sub, email: payload.email || null, emailVerified: !!payload.email_verified };
}

/** 從 Authorization: Bearer 取出並驗證 token；沒帶或驗不過都丟錯。 */
export async function requireUser(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!m) throw new Error('缺少 Authorization: Bearer <idToken>');
    const projectId = env.PMC_FIREBASE_PROJECT_ID || 'pick-my-card-28f2a';
    return verifyIdToken(m[1], projectId);
}
