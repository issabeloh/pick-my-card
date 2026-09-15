/* ============================================================
 * functions/portaly-signature.js 的驗收測試
 *
 * 用 portaly-payment skill 附的**官方 production-derived 測試向量**核對，
 * 不是自簽自驗（skill 明說自簽自驗不算證據）。
 *
 * 跑法：node functions/portaly-signature.vectors.test.js
 * 動過 portaly-signature.js 就要重跑，全綠才能 commit。
 * ============================================================ */
'use strict';

const path = require('node:path');
const {
  stableJson,
  signPortalyCallback,
  verifyPortalyCallback,
  isTimestampFresh,
} = require('./portaly-signature');

const VECTORS_PATH = path.join(
  __dirname,
  '..',
  '.agents',
  'skills',
  'portaly-payment',
  'references',
  'callback-signature-v1-vectors.json'
);

let failures = 0;

function check(name, ok) {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    console.error(`  ❌ ${name}`);
    failures += 1;
  }
}

const { vectors } = require(VECTORS_PATH);

if (!Array.isArray(vectors) || vectors.length === 0) {
  console.error('❌ 讀不到官方測試向量，或向量是空的。');
  process.exit(2);
}

console.log(`官方向量 ${vectors.length} 組：`);

for (const vector of vectors) {
  const { id, secret, timestamp, payload } = vector;

  // 1. stableJson 必須逐字元等於官方序列化結果（key 排序是最容易走樣的地方）
  if (typeof vector.stableJson === 'string') {
    check(`${id} — stableJson 逐字元相符`, stableJson(payload) === vector.stableJson);
  }

  // 2. 簽章必須等於官方簽出來的值
  const expected = vector.signature || vector.expectedSignature;
  const actual = signPortalyCallback({ secret, payload, timestamp });
  check(`${id} — 簽章相符`, actual === expected);

  // 3. 正向驗證
  check(
    `${id} — verify 通過`,
    verifyPortalyCallback({ secret, payload, timestamp, signature: expected })
  );

  // 4. 負向：竄改簽章、換密鑰、換時間戳，三者都必須被擋下
  const tampered = expected.slice(0, -1) + (expected.endsWith('0') ? '1' : '0');
  check(
    `${id} — 竄改簽章被拒`,
    !verifyPortalyCallback({ secret, payload, timestamp, signature: tampered })
  );
  check(
    `${id} — 錯誤密鑰被拒`,
    !verifyPortalyCallback({
      secret: `${secret}_wrong`,
      payload,
      timestamp,
      signature: expected,
    })
  );
  check(
    `${id} — 時間戳被動過就被拒`,
    !verifyPortalyCallback({
      secret,
      payload,
      timestamp: '2020-01-01T00:00:00.000Z',
      signature: expected,
    })
  );
}

console.log('時間戳容忍窗：');
const now = Date.parse('2026-09-15T12:00:00.000Z');
check('同一時刻 → 接受', isTimestampFresh('2026-09-15T12:00:00.000Z', now));
check('慢 4 分鐘 → 接受', isTimestampFresh('2026-09-15T11:56:00.000Z', now));
check('快 4 分鐘 → 接受（時鐘誤差）', isTimestampFresh('2026-09-15T12:04:00.000Z', now));
check('慢 6 分鐘 → 拒絕', !isTimestampFresh('2026-09-15T11:54:00.000Z', now));
check('快 6 分鐘 → 拒絕', !isTimestampFresh('2026-09-15T12:06:00.000Z', now));
check('非 ISO 字串 → 拒絕', !isTimestampFresh('not-a-timestamp', now));
check('空值 → 拒絕', !isTimestampFresh('', now));

if (failures > 0) {
  console.error(`\n❌ ${failures} 項未通過。`);
  process.exit(1);
}

console.log('\n✅ 全部通過。');
