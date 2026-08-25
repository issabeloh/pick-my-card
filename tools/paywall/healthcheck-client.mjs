#!/usr/bin/env node
/* tools/paywall/healthcheck-client.mjs — 白名單健檢的排程端（見 docs/project/paywall.md 3.5）
 *
 * 由 .github/workflows/paywall-healthcheck.yml 每天叫一次。做兩件判斷：
 *   1. /api/pay/healthcheck 回報的 ok 是不是 true（＝我們的出口 IP 通得過 OEN 白名單）
 *   2. Cloudflare 官方 IP 區段清單的 etag 有沒有跟 cf-ips.etag 這個基準檔不一樣
 *
 * 任何一項不對就 exit 1。GitHub Actions 失敗會寄信給 repo 擁有者——這就是通知管道，
 * 不另外接告警服務（成本 0）。
 *
 * 環境變數：
 *   PMC_HEALTHCHECK_URL    健檢端點完整網址，例如 https://pickmycard.app/api/pay/healthcheck
 *   PMC_HEALTHCHECK_TOKEN  與 CF Pages 的同名變數一致（Secret）
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ETAG_FILE = join(HERE, 'cf-ips.etag');
const BOOTSTRAP = 'BOOTSTRAP';

const url = process.env.PMC_HEALTHCHECK_URL || '';
const token = process.env.PMC_HEALTHCHECK_TOKEN || '';

function die(msg) {
    console.error('❌ ' + msg);
    process.exit(1);
}

if (!url || !token) die('缺少 PMC_HEALTHCHECK_URL 或 PMC_HEALTHCHECK_TOKEN。');

let data;
try {
    const res = await fetch(url, { headers: { 'x-pmc-healthcheck': token } });
    const text = await res.text();
    try {
        data = JSON.parse(text);
    } catch (e) {
        die(`健檢端點回傳的不是 JSON（HTTP ${res.status}）：${text.slice(0, 300)}`);
    }
    if (res.status === 401) die('健檢端點回 401：PMC_HEALTHCHECK_TOKEN 兩邊不一致，或 CF Pages 上沒設這個變數。');
} catch (err) {
    if (!data) die('打不到健檢端點：' + (err && err.message ? err.message : String(err)));
}

console.log('健檢回應：' + JSON.stringify(data, null, 2));

const problems = [];

if (data.stage === 'config') {
    problems.push('金流設定解析失敗：' + data.error);
} else if (!data.ok) {
    const o = data.oen || {};
    problems.push(
        `OEN API 連不通（reason=${o.reason} httpStatus=${o.httpStatus || '-'} code=${o.code || '-'}）。` +
        '\n   最可能的原因：Cloudflare 的出口 IP 區段變了，我們被應援的白名單擋在外面。' +
        '\n   處理：把下面的 Cloudflare 區段清單寄給應援請他們更新白名單。' +
        '\n   https://www.cloudflare.com/ips-v4  /  https://www.cloudflare.com/ips-v6',
    );
}

// etag 比對：拿不到 Cloudflare 清單只是警告，不當失敗——那是 Cloudflare 端的暫時性問題，
// 跟「我們被擋了」是兩回事，混在一起會製造假警報。
const cf = data.cfIps || {};
if (!cf.ok) {
    console.log(`⚠️  這次拿不到 Cloudflare IP 清單（${cf.error || '未知原因'}），略過 etag 比對。`);
} else {
    const current = String(cf.etag || '');
    const baseline = existsSync(ETAG_FILE) ? readFileSync(ETAG_FILE, 'utf8').trim() : '';
    if (!baseline || baseline === BOOTSTRAP) {
        problems.push(
            `首次執行：請把目前的 etag 寫進 tools/paywall/cf-ips.etag 並 commit。` +
            `\n   目前值：${current}` +
            `\n   指令：echo '${current}' > tools/paywall/cf-ips.etag`,
        );
    } else if (baseline !== current) {
        problems.push(
            `Cloudflare 的 IP 區段清單變了（基準 ${baseline} → 目前 ${current}，` +
            `ipv4 ${cf.ipv4Count} 段 / ipv6 ${cf.ipv6Count} 段）。` +
            '\n   處理：① 把新的區段清單寄給應援請他們更新白名單；' +
            '\n        ② 確認生效後，把新 etag 寫進 tools/paywall/cf-ips.etag 並 commit。' +
            '\n   ⚠️ 順序不能顛倒——先改基準檔會讓這個警報消失，但白名單其實還沒更新。',
        );
    } else {
        console.log(`✅ Cloudflare IP 區段清單未變動（etag ${current}）。`);
    }
}

if (problems.length) {
    console.error('\n❌ 白名單健檢有問題：');
    for (const p of problems) console.error('\n • ' + p);
    process.exit(1);
}

console.log('\n✅ 白名單健檢通過。');
