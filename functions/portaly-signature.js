/* ============================================================
 * Portaly callback v1 簽章驗證
 *
 * ⚠️ 這支檔案是 portaly-payment skill 附的官方 Node adapter
 *   （.agents/skills/portaly-payment/scripts/sign_callback.mjs）
 *   的 CommonJS 移植版，**逐行照抄、不是憑記憶重寫**。
 *   skill 文件明文禁止憑記憶翻譯這段（callback-signature-v1.md
 *   「Choose an evidence-backed route」）。
 *
 * 改這支檔案後**必須**跑：
 *   node functions/portaly-signature.vectors.test.js
 * 它會拿官方 production-derived 測試向量核對，全綠才算數。
 * 自己簽自己驗不算證據——同一個 bug 會同時存在於兩邊。
 *
 * v1 契約：
 *   HMAC-SHA256(callbackSecret,
 *               x-portaly-timestamp + "." + stableJson(JSON.parse(wireBody)))
 *   輸出小寫 hex。簽的是「解析後再序列化」的結果，不是原始 HTTP body。
 *
 * stableJson 的坑：物件 key 用 JavaScript localeCompare 排序，**不是**
 * code-point 排序。內建欄位 canceledAt / cancelEffectiveAt 這兩個在兩種
 * 排法下順序就不一樣，用錯會驗不過。
 * ============================================================ */
'use strict';

const crypto = require('node:crypto');

/** 與官方 signer 位元等價的序列化：key 用 localeCompare 排序，其餘比照 JSON.stringify。 */
function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (typeof item === 'undefined' ? 'null' : stableJson(item)))
      .join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, val]) => typeof val !== 'undefined')
      .sort(([a], [b]) => a.localeCompare(b));

    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${stableJson(val)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function signPortalyCallback({ secret, payload, timestamp }) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${stableJson(payload)}`)
    .digest('hex');
}

/** 時間安全比對；長度不同直接 false（timingSafeEqual 長度不等會丟例外）。 */
function verifyPortalyCallback({ secret, payload, timestamp, signature }) {
  if (typeof signature !== 'string' || signature.length === 0) {
    return false;
  }

  const expected = signPortalyCallback({ secret, payload, timestamp });
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.byteLength !== signatureBuffer.byteLength) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

/**
 * 時間戳容忍窗：與現在相差超過 5 分鐘（任一方向）就拒絕。
 * 刻意是雙向的——只擋「未來」會讓正常 callback 因為兩端時鐘微幅誤差而
 * 間歇性 401（skill: Safe handler order 第 2 點）。
 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function isTimestampFresh(timestamp, now = Date.now()) {
  if (typeof timestamp !== 'string' || timestamp.length === 0) {
    return false;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return false;
  }

  return Math.abs(now - parsed) <= TIMESTAMP_TOLERANCE_MS;
}

module.exports = {
  stableJson,
  signPortalyCallback,
  verifyPortalyCallback,
  isTimestampFresh,
  TIMESTAMP_TOLERANCE_MS,
};
