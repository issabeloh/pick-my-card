#!/usr/bin/env node
/**
 * NCCC 小額支付品牌清單生成器（2026-11-13）
 *
 * 做什麼：把聯卡中心「小額支付平台」門市清單（data/nccc/merchants.csv，約 2 萬列）
 * 依品牌對照表（data/nccc/brand-map.csv）收斂成「一個品牌一行」的前端靜態檔：
 *   js/micropayment-brands.js   ← 網站讀這個（品牌名、級別、搜尋別名、資料日期；不含任何門市）
 *   data/nccc/summary.json      ← 維護用：各品牌門市數＋「對照表沒收、但列數多」的候選名單。
 *                                  每週更新的 PR 看這個檔的 diff 就知道哪個品牌變多／變少／消失
 *
 * 用法（repo 根目錄）：
 *   node tools/build-nccc-brands.js           # 重新生成兩個輸出檔
 *   node tools/build-nccc-brands.js --check   # 只比對，輸出檔落後就 exit 1（preflight 用）
 *
 * 規則：
 *   ・比對對象＝門市的「對外名稱」或「登記名稱」（NFKC 正規化＋轉小寫後套對照表的「比對規則」regex）
 *   ・只算仍有效的列（小額付款結束日＝00000000 或晚於資料日期）
 *   ・對照表有、名單上已 0 列的品牌：不寫進前端檔（它已退出平台），並在終端機與 summary.json 標出來
 *   ・級別只認「全門市」「部分門市」；其他值＝對照表寫錯，直接報錯
 * 改對照表（加品牌、改級別、補別名）後跑這支，連同輸出檔一起 commit。
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SRC_CSV = path.join(REPO, 'data/nccc/merchants.csv');
const MAP_CSV = path.join(REPO, 'data/nccc/brand-map.csv');
const SOURCE_JSON = path.join(REPO, 'data/nccc/source.json');
const OUT_JS = path.join(REPO, 'js/micropayment-brands.js');
const OUT_SUMMARY = path.join(REPO, 'data/nccc/summary.json');
const SOURCE_PAGE = 'https://www.nccc.com.tw/wps/wcm/connect/zh/home/BusinessOperations/CardBusiness/MicroPayment';
const LEVELS = { '全門市': 'full', '部分門市': 'partial' };
const CANDIDATE_MIN_ROWS = 15;
const CANDIDATE_LIMIT = 25;

// 最小 CSV 解析（支援雙引號欄位與 "" 跳脫）；兩個輸入檔都沒有欄內換行
function parseCsv(text) {
    const rows = [];
    text.replace(/^﻿/, '').split(/\r?\n/).forEach(line => {
        if (!line.trim()) return;
        const cells = [];
        let cur = '', quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cur += ch;
            } else if (ch === '"') quoted = true;
            else if (ch === ',') { cells.push(cur); cur = ''; }
            else cur += ch;
        }
        cells.push(cur);
        rows.push(cells);
    });
    const headers = rows.shift().map(h => h.trim());
    return rows.map(cells => Object.fromEntries(headers.map((h, i) => [h, (cells[i] || '').trim()])));
}

const norm = s => String(s || '').normalize('NFKC').toLowerCase();

function build() {
    const source = JSON.parse(fs.readFileSync(SOURCE_JSON, 'utf8'));
    const asOfCompact = String(source.asOf || '').replace(/-/g, '');
    if (!/^\d{8}$/.test(asOfCompact)) throw new Error(`data/nccc/source.json 的 asOf 不是 YYYY-MM-DD：${source.asOf}`);

    const stores = parseCsv(fs.readFileSync(SRC_CSV, 'utf8'))
        .filter(r => { const end = r['小額付款結束日']; return !end || end === '00000000' || end >= asOfCompact; })
        .map(r => ({ name: norm(r['對外名稱']), legal: norm(r['登記名稱']), addr: r['營業地址市區'] + r['營業地址'] }));

    const map = parseCsv(fs.readFileSync(MAP_CSV, 'utf8'));
    const taken = new Array(stores.length).fill(false);
    const brands = [], dropped = [], summaryBrands = {};
    const seenAlias = new Map();

    map.forEach(row => {
        const name = row['品牌'];
        const level = LEVELS[row['級別']];
        if (!name) throw new Error('brand-map.csv 有一列沒有品牌名');
        if (!level) throw new Error(`brand-map.csv「${name}」的級別只能是 全門市／部分門市，現在是「${row['級別']}」`);
        const aliases = [...new Set(row['搜尋別名'].split('、').map(a => norm(a).trim()).filter(Boolean))];
        if (aliases.length === 0) throw new Error(`brand-map.csv「${name}」沒有搜尋別名`);
        aliases.forEach(a => {
            if (a.length < 2) throw new Error(`brand-map.csv「${name}」的別名「${a}」少於 2 個字，會誤判`);
            if (seenAlias.has(a)) throw new Error(`別名「${a}」同時出現在「${seenAlias.get(a)}」與「${name}」`);
            seenAlias.set(a, name);
        });
        let rule;
        try { rule = new RegExp(row['比對規則']); } catch (e) { throw new Error(`brand-map.csv「${name}」的比對規則不是合法 regex：${e.message}`); }

        const addresses = new Set();
        let rows = 0;
        stores.forEach((s, i) => {
            if (!rule.test(s.name) && !rule.test(s.legal)) return;
            rows++; taken[i] = true; addresses.add(s.addr);
        });
        summaryBrands[name] = { level: row['級別'], rows, addresses: addresses.size };
        if (rows === 0) { dropped.push(name); return; }
        brands.push({ name, level, aliases });
    });

    // 候選：對照表沒涵蓋的門市，依名稱開頭歸堆。從 2 個字起往後延伸，只要下一個字仍留住八成列數就繼續，
    // 得到的就是「很多列共用的開頭」＝大概是品牌名。只是給人看的線索，不進前端檔
    const rest = stores.filter((s, i) => !taken[i]).map(s => s.name).filter(n => n.length >= 2);
    const prefixCount = new Map();
    rest.forEach(n => { for (let len = 2; len <= Math.min(10, n.length); len++) { const p = n.slice(0, len); prefixCount.set(p, (prefixCount.get(p) || 0) + 1); } });
    const candidates = new Map();
    [...new Set(rest.map(n => n.slice(0, 2)))].forEach(start => {
        let p = start, count = prefixCount.get(p) || 0;
        if (count < CANDIDATE_MIN_ROWS) return;
        for (;;) {
            let best = null, bestCount = 0;
            rest.forEach(n => { if (n.length > p.length && n.startsWith(p)) { const q = n.slice(0, p.length + 1); const c = prefixCount.get(q) || 0; if (c > bestCount) { best = q; bestCount = c; } } });
            if (!best || best.length > 10 || bestCount < count * 0.8) break;
            p = best; count = bestCount;
        }
        candidates.set(p.trim(), count);
    });
    const candidateList = [...candidates.entries()].filter(([p]) => p.length >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, CANDIDATE_LIMIT).map(([prefix, rows]) => ({ prefix, rows }));

    const js = [
        '/**',
        ' * NCCC 小額支付平台品牌清單（資料檔）',
        ' * ⚠️ 本檔由 tools/build-nccc-brands.js 生成，禁止手改——改 data/nccc/brand-map.csv 後重跑生成器。',
        ' * 一個品牌一行，不含門市。level：full＝幾乎全門市在名單上；partial＝只有部分門市。',
        ' * aliases：用戶搜尋時認得的寫法（一律小寫）。讀取端在 js/search-match.js「NCCC 小額支付品牌」區塊。',
        ' */',
        'const MICROPAYMENT_BRANDS = {',
        `    asOf: ${JSON.stringify(source.asOf)},`,
        `    asOfLabel: ${JSON.stringify(source.asOfLabel || '')},`,
        `    sourceUrl: ${JSON.stringify(SOURCE_PAGE)},`,
        '    brands: [',
        ...brands.map(b => `        ${JSON.stringify(b)},`),
        '    ]',
        '};',
        ''
    ].join('\n');

    const summary = JSON.stringify({
        asOf: source.asOf,
        activeStoreRows: stores.length,
        brandCount: brands.length,
        droppedBrands: dropped,
        brands: summaryBrands,
        unmappedCandidates: candidateList
    }, null, 2) + '\n';

    return { js, summary, brands, dropped, candidateList, storeCount: stores.length };
}

function main() {
    const check = process.argv.includes('--check');
    const out = build();
    const current = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
    if (check) {
        const stale = [];
        if (current(OUT_JS) !== out.js) stale.push('js/micropayment-brands.js');
        if (current(OUT_SUMMARY) !== out.summary) stale.push('data/nccc/summary.json');
        if (stale.length) {
            console.error(`❌ ${stale.join('、')} 與生成結果不一致——跑 node tools/build-nccc-brands.js 重新生成後再 commit`);
            process.exit(1);
        }
        console.log(`✅ NCCC 品牌清單與來源一致（${out.brands.length} 個品牌）`);
        return;
    }
    fs.writeFileSync(OUT_JS, out.js);
    fs.writeFileSync(OUT_SUMMARY, out.summary);
    const full = out.brands.filter(b => b.level === 'full').length;
    console.log(`✅ 已生成：${out.brands.length} 個品牌（全門市 ${full}、部分門市 ${out.brands.length - full}），來源 ${out.storeCount} 列有效門市`);
    if (out.dropped.length) console.log(`⚠️ 對照表有、名單上已 0 列（未寫進前端檔）：${out.dropped.join('、')}`);
    if (out.candidateList.length) console.log(`ℹ️ 對照表沒收、列數較多的名稱開頭（前 10）：${out.candidateList.slice(0, 10).map(c => `${c.prefix}(${c.rows})`).join('、')}`);
}

try { main(); } catch (e) { console.error('❌ ' + e.message); process.exit(1); }
