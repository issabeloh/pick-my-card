#!/usr/bin/env node
// 活動快寫 → 試算表視窗用的單一檔案：把 index.html、parser.js、app.js 併成 apps-script/ActivityWriter.html。
// HtmlService 的視窗只能載入同專案的一個 HTML 檔（不能 <script src> 引用 repo 的檔），所以要併檔。
//
//   node tools/activity-writer/build-apps-script.js           重新生成
//   node tools/activity-writer/build-apps-script.js --check   只檢查生成檔是不是最新（preflight 用，不一致 exit 1）
//
// 改了 tools/activity-writer/ 的 index.html／parser.js／app.js 之後一定要跑，生成檔一起 commit——
// 合併進 main 後 GitHub 會自動把它推到「PMC 管理系統」的 Apps Script（apps-script/deploy.json）。
'use strict';
const fs = require('fs'), path = require('path');
const SRC = __dirname, OUT = path.join(__dirname, '..', '..', 'apps-script', 'ActivityWriter.html');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

function build() {
  let html = read('index.html');
  const tags = '<script src="parser.js"></script>\n<script src="app.js"></script>';
  if (html.split(tags).length !== 2) throw new Error('index.html 裡找不到那兩行 <script src>（被改過？）');
  const inline = ['parser.js', 'app.js'].map(f => {
    const js = read(f);
    if (/<\/script/i.test(js)) throw new Error(f + ' 裡出現 </script，併進 HTML 會提早結束 script 區塊');
    return '<script>\n' + js.replace(/\s+$/, '') + '\n</script>';
  }).join('\n');
  html = html.replace(tags, () => inline);
  const banner = '<!-- ⚠️ 生成檔，不要手改：來源是 tools/activity-writer/（index.html＋parser.js＋app.js），\n' +
    '     用 node tools/activity-writer/build-apps-script.js 重新生成。伺服器端在 activity-writer.gs。 -->\n';
  html = html.replace('<head>', () => '<head>\n<base target="_top">');
  return html.replace(/^<!DOCTYPE html>\n/i, m => m + banner);
}

const out = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== out) { console.error('❌ apps-script/ActivityWriter.html 不是最新——跑 node tools/activity-writer/build-apps-script.js 重新生成後再 commit'); process.exit(1); }
  console.log('✅ apps-script/ActivityWriter.html 與來源一致');
} else {
  fs.writeFileSync(OUT, out);
  console.log('已生成 apps-script/ActivityWriter.html（' + Math.round(out.length / 1024) + ' KB）');
}
