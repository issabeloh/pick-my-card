#!/usr/bin/env node
/**
 * Apps Script 自動部署：把 repo 的 apps-script/*.gs 推到線上的 Apps Script 專案。
 * 由 .github/workflows/apps-script-deploy.yml 在 main 更新時執行；也可手動跑（見 README）。
 *
 * 為什麼不用 clasp push：clasp 是「本機資料夾＝整個專案」，線上檔名必須跟本機一樣。
 * 站長把線上檔案改成「權益解析-新戶-benefits-parser」這種名字，clasp 會另外建一個
 * benefits-parser 檔——同一個函數定義兩次，整個專案直接壞掉。所以這裡直接呼叫
 * Apps Script API，自己控制「哪支對哪支」。
 *
 * 三道保護（任何一道沒過就整批不推，一個檔案都不改）：
 *   1. 對照：每支要部署的檔案，線上必須「剛好一個」檔名對得上（同名，或以「-檔名」結尾）。
 *      對不到或對到兩個 → 停。絕不自動新建檔案（新建＝可能重複定義）。
 *   2. 防蓋掉線上手改：線上現在的內容必須是 repo 歷史裡出現過的某個版本。
 *      不是 → 代表有人直接在網頁編輯器改過，停下來（要蓋掉就手動跑並勾 force）。
 *   3. 只動清單裡的檔案：線上其他檔案、appsscript.json 原封不動送回去。
 *
 * 用法：
 *   CLASPRC_JSON="$(cat ~/.clasprc.json)" node tools/apps-script-deploy/deploy.js [--dry-run] [--force]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'apps-script', 'deploy.json');

// 比對用：換行統一、去掉行尾空白與檔尾空行（網頁編輯器存檔常改這些，不算真的改過）
function normalize(src) {
  return String(src || '').replace(/\r\n?/g, '\n').split('\n')
    .map(function (l) { return l.replace(/\s+$/, ''); }).join('\n').replace(/\n+$/, '');
}

function baseName(repoFile) { return repoFile.replace(/\.gs$/, ''); }

// 線上檔名對 repo 檔名：同名，或以「-檔名」結尾。
// ⚠️ 一個線上檔只歸給「最長」那個對得上的 repo 檔名：「權益解析-新卡-card-benefits-parser」
//    同時以「-benefits-parser」結尾，不這樣做會被 benefits-parser.gs 一起認走（測試抓到的）。
function ownerOf(onlineName, allRepoFiles) {
  let best = null;
  allRepoFiles.forEach(function (rf) {
    const b = baseName(rf);
    if (onlineName === b || onlineName.endsWith('-' + b)) {
      if (!best || b.length > baseName(best).length) best = rf;
    }
  });
  return best;
}

function matchOnline(onlineFiles, repoFile, allRepoFiles) {
  const all = allRepoFiles || [repoFile];
  return onlineFiles.filter(function (f) {
    return f.type === 'SERVER_JS' && ownerOf(f.name, all) === repoFile;
  });
}

// repo 歷史裡這支檔案出現過的所有版本（正規化後）
function historicalVersions(repoRelPath) {
  const out = new Set();
  let revs = [];
  try {
    revs = execFileSync('git', ['log', '--format=%H', '--', repoRelPath], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
      .split('\n').filter(Boolean);
  } catch (e) { return out; }
  revs.forEach(function (rev) {
    try {
      out.add(normalize(execFileSync('git', ['show', rev + ':' + repoRelPath], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })));
    } catch (e) { /* 那個版本裡沒有這支 */ }
  });
  return out;
}

// 線上被手改過（drift）時，挑 repo 歷史裡最接近的一版，印出差在哪幾行——站長才知道
// 那些手改是什麼、要不要留（2026-10-04 第一次試跑 watchlist-monitor 就被擋，卻看不到原因）
function closestVersion(onlineSrc, versions) {
  const cur = normalize(onlineSrc).split('\n');
  const curSet = new Set(cur);
  let best = null, bestScore = Infinity;
  versions.forEach(function (v) {
    const lines = v.split('\n');
    const set = new Set(lines);
    let score = 0;
    cur.forEach(function (l) { if (!set.has(l)) score++; });
    lines.forEach(function (l) { if (!curSet.has(l)) score++; });
    if (score < bestScore) { bestScore = score; best = v; }
  });
  return best;
}

function diffText(oldSrc, newSrc, maxLines) {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdiff-'));
  const a = path.join(dir, 'repo最接近的一版'), b = path.join(dir, '線上現在');
  fs.writeFileSync(a, oldSrc + '\n'); fs.writeFileSync(b, normalize(newSrc) + '\n');
  let out = '';
  try {
    out = execFileSync('git', ['diff', '--no-index', '--no-color', '-U1', a, b], { encoding: 'utf8' });
  } catch (e) { out = String(e.stdout || ''); }   // 有差異時 git diff 回 exit 1，內容在 stdout
  const lines = out.split('\n').filter(function (l) { return !/^(diff --git|index |--- |\+\+\+ )/.test(l); });
  // Actions 頁面在公開 repo 誰都看得到：線上手改常是填 email 或金鑰，先遮掉再印
  const mask = function (l) {
    return l.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '***@***')
      .replace(/\b(AIza[\w-]{20,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|sk-[\w-]{20,}|jina_\w{20,})/g, '***金鑰已遮***')
      .replace(/(['"])[A-Za-z0-9_\-]{32,}\1/g, '$1***長字串已遮***$1');
  };
  return lines.slice(0, maxLines).map(mask).join('\n') + (lines.length > maxLines ? '\n…（還有 ' + (lines.length - maxLines) + ' 行）' : '');
}

// 純函數：算出要做什麼。readRepo(file) → 內容；versionsOf(file) → Set
function buildPlan(onlineFiles, repoFiles, readRepo, versionsOf) {
  const items = [], errors = [];
  const claimed = {};
  repoFiles.forEach(function (file) {
    const hits = matchOnline(onlineFiles, file, repoFiles);
    if (hits.length === 0) {
      errors.push('線上找不到對應「' + file + '」的檔案。請把線上那支改名成「' + baseName(file) +
        '」或「〇〇-' + baseName(file) + '」（例：使用說明-' + baseName(file) + '）。');
      return;
    }
    if (hits.length > 1) {
      errors.push('「' + file + '」對到線上 ' + hits.length + ' 個檔案：' + hits.map(function (h) { return h.name; }).join('、') + '。只能留一個。');
      return;
    }
    const online = hits[0];
    if (claimed[online.name]) {
      errors.push('線上「' + online.name + '」同時對到「' + claimed[online.name] + '」和「' + file + '」。');
      return;
    }
    claimed[online.name] = file;
    const repoSrc = readRepo(file);
    const cur = normalize(online.source);
    let status;
    if (cur === normalize(repoSrc)) status = 'same';
    else if (versionsOf(file).has(cur)) status = 'update';
    else status = 'drift';   // 線上內容不是 repo 任何一版 → 有人在網頁上直接改過
    items.push({ file: file, online: online.name, status: status, newSource: repoSrc, onlineSource: online.source });
  });
  return { items: items, errors: errors };
}

function applyPlan(onlineFiles, plan) {
  const byName = {};
  plan.items.forEach(function (it) { if (it.status !== 'same') byName[it.online] = it.newSource; });
  return onlineFiles.map(function (f) {
    return Object.prototype.hasOwnProperty.call(byName, f.name)
      ? { name: f.name, type: f.type, source: byName[f.name] }
      : { name: f.name, type: f.type, source: f.source };   // 其他檔案、appsscript.json 原樣送回
  });
}

// 從終端機複製常會出問題（2026-10-04 第一次部署就踩到）：長行被折成好幾行、
// 多複製到提示字元、少複製到頭尾的大括號。依序試幾種讀法；都不行才報錯。
// 也收 base64（`base64 -w0 ~/.clasprc.json` 的輸出）——一整串英數字，怎麼折行都不會壞。
function parseSecret_(raw) {
  const s = String(raw || '').trim();
  const tries = [
    function () { return JSON.parse(s); },
    function () { return JSON.parse(s.replace(/[\r\n]+/g, '')); },                 // 折行塞進字串中間
    function () {                                                                   // 前後多了雜字
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a < 0 || b <= a) throw new Error('no braces');
      return JSON.parse(s.slice(a, b + 1).replace(/[\r\n]+/g, ''));
    },
    function () {                                                                   // base64
      const b64 = s.replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('not base64');
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    }
  ];
  for (let i = 0; i < tries.length; i++) {
    try { return tries[i](); } catch (e) { /* 試下一種 */ }
  }
  // 不把內容印出來（那是授權），只給判斷得出問題的線索
  throw new Error('CLASPRC_JSON 讀不懂（收到 ' + s.length + ' 個字，開頭' +
    (s.charAt(0) === '{' ? '是' : '不是') + '「{」、結尾' + (s.slice(-1) === '}' ? '是' : '不是') + '「}」）。' +
    '最穩的做法：在 Cloud Shell 執行 base64 -w0 ~/.clasprc.json，把那一整串貼進 Secret。');
}

function readCredentials(raw) {
  const j = parseSecret_(raw);
  const t = (j.tokens && (j.tokens.default || j.tokens[Object.keys(j.tokens)[0]])) || null;   // clasp 3
  if (t && t.refresh_token) return { clientId: t.client_id, clientSecret: t.client_secret, refreshToken: t.refresh_token };
  if (j.token && j.token.refresh_token && j.oauth2ClientSettings) {                              // clasp 2
    return { clientId: j.oauth2ClientSettings.clientId, clientSecret: j.oauth2ClientSettings.clientSecret, refreshToken: j.token.refresh_token };
  }
  throw new Error('CLASPRC_JSON 裡找不到 refresh_token（是不是貼錯檔案？）');
}

async function accessToken(c) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' })
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) {
    throw new Error('換不到 Google 授權（' + (j.error || res.status) + '）。授權可能過期或被撤銷：重新跑一次 clasp login，更新 GitHub 的 CLASPRC_JSON。');
  }
  return j.access_token;
}

async function api(method, url, token, body) {
  const res = await fetch(url, {
    method: method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    if (/has not (been used|enabled)|SERVICE_DISABLED|Apps Script API/i.test(text) && res.status === 403) {
      throw new Error('Apps Script API 沒開：到 https://script.google.com/home/usersettings 把「Google Apps Script API」打開，等幾分鐘再試。');
    }
    throw new Error(method + ' ' + url + ' → ' + res.status + '：' + text.slice(0, 400));
  }
  return text ? JSON.parse(text) : {};
}

function summarize(project, plan) {
  const label = { same: '沒變，略過', update: '更新', drift: '⛔ 線上被手改過' };
  const lines = ['### ' + project.name, '', '| repo 檔案 | 線上檔案 | 動作 |', '|---|---|---|'];
  plan.items.forEach(function (it) { lines.push('| ' + it.file + ' | ' + it.online + ' | ' + label[it.status] + ' |'); });
  plan.errors.forEach(function (e) { lines.push('', '❌ ' + e); });
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.indexOf('--dry-run') >= 0;
  const force = args.indexOf('--force') >= 0;
  const report = [];
  const out = function (s) { console.log(s); report.push(s); };

  if (!process.env.CLASPRC_JSON) {
    out('⚠️ 還沒設定 GitHub Secret「CLASPRC_JSON」，這次不部署（照 apps-script/README.md「自動部署」一節設定）。');
    flushSummary(report);
    return;
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const token = await accessToken(readCredentials(process.env.CLASPRC_JSON));

  let failed = false;
  for (const project of config.projects) {
    const url = 'https://script.googleapis.com/v1/projects/' + project.scriptId + '/content';
    const content = await api('GET', url, token);
    const onlineFiles = content.files || [];
    const plan = buildPlan(onlineFiles, project.files,
      function (f) { return fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'); },
      function (f) { return historicalVersions('apps-script/' + f); });
    out(summarize(project, plan));

    const drift = plan.items.filter(function (it) { return it.status === 'drift'; });
    drift.forEach(function (d) {
      const near = closestVersion(d.onlineSource, historicalVersions('apps-script/' + d.file));
      if (!near) return;
      out('\n#### ' + d.online + '：線上跟 repo 最接近的一版差在這裡（－ repo／＋ 線上）\n\n```diff\n' +
        diffText(near, d.onlineSource, 120) + '\n```');
    });
    const changes = plan.items.filter(function (it) { return it.status !== 'same'; });
    if (plan.errors.length) { failed = true; out('\n整批不推（上面的 ❌ 處理好再跑一次）。'); continue; }
    if (drift.length && !force) {
      failed = true;
      out('\n整批不推：' + drift.map(function (d) { return d.online; }).join('、') +
        ' 的線上內容不是 repo 任何一版，代表有人直接在網頁編輯器改過。\n' +
        '先把那些改動告訴 Claude 放回 repo；確定要蓋掉，就到 GitHub Actions 手動執行這個流程並勾選 force。');
      continue;
    }
    if (!changes.length) { out('\n全部跟線上一樣，不用推。'); continue; }
    if (dryRun) { out('\n（試跑模式：以上是會做的事，這次沒有真的推。）'); continue; }
    await api('PUT', url, token, { files: applyPlan(onlineFiles, plan) });
    out('\n✅ 已更新 ' + changes.length + ' 支。重新整理試算表就是新版。');
  }
  flushSummary(report);
  if (failed) process.exit(1);
}

function flushSummary(report) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.join('\n') + '\n');
}

if (require.main === module) {
  main().catch(function (e) { console.error('❌ ' + e.message); flushSummary(['❌ ' + e.message]); process.exit(1); });
}

module.exports = { normalize, matchOnline, buildPlan, applyPlan, readCredentials, historicalVersions, closestVersion, diffText };
