#!/usr/bin/env node
/*
 * 品牌標誌資產生成器（2026-10-07，依《Pick My Card 品牌標誌規範 v1.0》）
 *
 * 所有標誌檔都從這支的幾何常數畫出來——要改標誌改這裡，重跑，不要手改輸出檔。
 * 幾何來源：規範第 02 節的 100×100 單位網格，並以設計師交付的 2000px 原稿逐層
 * 擬合驗證（前卡/中卡/底卡 IoU ≥ 0.99）。座標原點＝前卡中心，單位＝規範單位。
 *
 * 用法（開發用，部署不跑）：
 *   npm install playwright opentype.js --no-fund --no-audit --loglevel=error --no-save
 *   node tools/build-logo-assets.js
 * 字標組合與分享圖需要網路（從 Google Fonts 抓 Manrope / Noto Sans TC 子集）；
 * 離線時加 --marks-only 只重生標誌本體與圖示。
 *
 * 輸出：
 *   assets/brand/   規範全套 SVG（各色彩版本、小尺寸版、橫式/直式字標組合）＋社群頭像
 *   assets/images/  網站實際引用的檔（header、favicon、App 圖示、分享圖）
 *   favicon.ico     根目錄（瀏覽器與搜尋引擎會直接要 /favicon.ico）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BRAND_DIR = path.join(ROOT, 'assets/brand');
const IMG_DIR = path.join(ROOT, 'assets/images');
const MARKS_ONLY = process.argv.includes('--marks-only');

// ---- 幾何（規範第 02 節）----
const FRONT = { cx: 0, cy: 0, w: 52, h: 52, r: 7, rot: 31 };           // 前卡：邊長 52、圓角 7、傾角 31°
// 晶片孔（規範「03 晶片孔」）：13×10、圓角 2.5、距前卡上緣與左緣各 7（前卡座標系）。
// 尺寸、位置、色彩皆固定——小尺寸版也不放大（2026-10-07 站長確認：放大後 favicon 的孔太大）
const CHIP = { cx: -12.5, cy: -14, w: 13, h: 10, r: 2.5 };
const MID = { cx: 9, cy: 12, w: 50, h: 50, r: 7, rot: 45 };             // 中層卡：45°、邊長 50
const BOTTOM = { cx: 13, cy: 17, w: 50, h: 50, r: 7, rot: 45 };         // 底層卡：再往右下錯位 (4, 5)
const GAP = 2.6;                                                        // 前卡與後方兩層的間隙

// 小尺寸版（規範第 04 節：32px 以下用）——移除底層、加寬間隙；晶片同標準版（見 CHIP）
const SMALL = {
  back: { cx: 10, cy: 13, w: 50, h: 50, r: 7, rot: 45 },
  gap: 5,
};

// ---- 色彩（規範第 05、06 節）----
const C = {
  deep: '#1E40AF', brand: '#3B82F6', mid: '#60A5FA', base: '#BFDBFE',
  ink: '#1A1815', paper: '#FAFBF8', chipBlue: '#2563EB', sub: '#4B5563',
};
const VARIANTS = {
  // 主要版本：漸層前卡＋中層藍/底層藍（淺底用）
  primary: { front: 'gradient', chip: '#FFFFFF', mid: [C.mid, 1], bottom: [C.base, 1] },
  // 單色藍／墨色單色：後方兩卡以同色 50%、22% 呈現
  'mono-blue': { front: C.deep, chip: '#FFFFFF', mid: [C.deep, 0.5], bottom: [C.deep, 0.22] },
  'mono-ink': { front: C.ink, chip: C.paper, mid: [C.ink, 0.5], bottom: [C.ink, 0.22] },
  // 反白・藍底：晶片孔是挖空、透出背景（cutout 選項）；透明底的檔案看不到背景，晶片填 #2563EB
  reverse: { front: '#FFFFFF', chip: C.chipBlue, mid: ['#FFFFFF', 0.6], bottom: ['#FFFFFF', 0.3] },
  // 反白・深色底（深色模式）
  'reverse-dark': { front: C.paper, chip: C.brand, mid: [C.paper, 0.55], bottom: [C.paper, 0.25] },
};

const n = (v) => +v.toFixed(3);

// 旋轉圓角矩形在 x/y 方向的半寬
function halfExtent(s) {
  const t = (s.rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(t)), si = Math.abs(Math.sin(t));
  return {
    x: (s.w / 2 - s.r) * c + (s.h / 2 - s.r) * si + s.r,
    y: (s.w / 2 - s.r) * si + (s.h / 2 - s.r) * c + s.r,
  };
}
function bboxOf(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    const e = halfExtent(s);
    x0 = Math.min(x0, s.cx - e.x); x1 = Math.max(x1, s.cx + e.x);
    y0 = Math.min(y0, s.cy - e.y); y1 = Math.max(y1, s.cy + e.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function rect(s, attrs, grow = 0) {
  const w = s.w + grow * 2, h = s.h + grow * 2, r = s.r + grow;
  const tf = s.rot ? ` transform="translate(${n(s.cx)} ${n(s.cy)}) rotate(${s.rot})"` : '';
  const x = s.rot ? -w / 2 : s.cx - w / 2, y = s.rot ? -h / 2 : s.cy - h / 2;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}"${tf}${attrs ? ' ' + attrs : ''}/>`;
}
function paint([color, alpha]) {
  return `fill="${color}"${alpha < 1 ? ` fill-opacity="${alpha}"` : ''}`;
}

/**
 * 標誌本體的 SVG 片段（不含 <svg> 外框），座標原點＝前卡中心。
 * idp：id 前綴，同一份文件內放多個標誌時避免 id 撞名。
 */
function markBody(variant, { small = false, idp = 'pmc', cutout = false } = {}) {
  const v = VARIANTS[variant];
  const backs = small ? [SMALL.back] : [MID, BOTTOM];
  const gap = small ? SMALL.gap : GAP;
  const chip = CHIP;
  const bb = bboxOf([FRONT, ...backs]);
  const pad = 2;
  const area = `x="${n(bb.x - pad)}" y="${n(bb.y - pad)}" width="${n(bb.w + pad * 2)}" height="${n(bb.h + pad * 2)}"`;
  const defs = [];
  const layers = [];

  if (v.front === 'gradient') {
    // 漸層定義在前卡自己的座標系：卡面左上 → 右下（＝規範的 135°），兩端落在卡面輪廓上
    defs.push(`<linearGradient id="${idp}-g" gradientUnits="userSpaceOnUse" x1="-24" y1="-24" x2="24" y2="24">` +
      `<stop offset="0" stop-color="${C.deep}"/><stop offset="1" stop-color="${C.brand}"/></linearGradient>`);
  }
  // 後方每一層都扣掉「它前面所有卡＋間隙」：間隙是真的鏤空，任何底色都透得出來
  const paints = small ? [v.mid] : [v.mid, v.bottom];
  backs.forEach((card, i) => {
    const covers = [FRONT, ...backs.slice(0, i)];
    defs.push(`<mask id="${idp}-m${i}" maskUnits="userSpaceOnUse" ${area}>` +
      `<rect ${area} fill="#fff"/>` + covers.map((s) => rect(s, 'fill="#000"', gap)).join('') + `</mask>`);
    layers.unshift(`<g mask="url(#${idp}-m${i})">${rect(card, paint(paints[i]))}</g>`);
  });
  const frontFill = v.front === 'gradient' ? `fill="url(#${idp}-g)"` : `fill="${v.front}"`;
  const f = { ...FRONT, rot: 0 };
  if (cutout) {
    // 晶片孔挖空：遮罩掛在未旋轉的外層 g，遮罩內容自己旋轉，避免各瀏覽器對 mask 座標系的解讀差異
    defs.push(`<mask id="${idp}-c" maskUnits="userSpaceOnUse" ${area}><rect ${area} fill="#fff"/>` +
      `<g transform="rotate(${FRONT.rot})">${rect(chip, 'fill="#000"')}</g></mask>`);
    layers.push(`<g mask="url(#${idp}-c)"><g transform="rotate(${FRONT.rot})">${rect(f, frontFill)}</g></g>`);
  } else {
    layers.push(`<g transform="rotate(${FRONT.rot})">${rect(f, frontFill)}${rect(chip, `fill="${v.chip}"`)}</g>`);
  }
  return { svg: `<defs>${defs.join('')}</defs>${layers.join('')}`, bbox: bb };
}

/** 獨立標誌 SVG。pad＝四周留白（規範單位）；square＝補成正方形畫布 */
function markSVG(variant, { small = false, pad = 0, square = false, bg = null, idp } = {}) {
  const { svg, bbox } = markBody(variant, { small, idp });
  let { x, y, w, h } = bbox;
  if (square) {
    const s = Math.max(w, h);
    x -= (s - w) / 2; y -= (s - h) / 2; w = h = s;
  }
  x -= pad; y -= pad; w += pad * 2; h += pad * 2;
  const vb = `${n(x)} ${n(y)} ${n(w)} ${n(h)}`;
  const label = 'Pick My Card';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${label}">` +
    (bg ? `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${bg}"/>` : '') +
    svg + `</svg>\n`;
}

/**
 * App 圖示：品牌藍漸層底（135°）＋反白標誌。
 * 標誌外框對角線落在中央 80% 圓內（maskable 安全區），所以同一張可同時當 any/maskable。
 * radius：圓角（佔邊長比例），0＝滿版方形（iOS／maskable 由系統裁圓角）。
 */
function appIconSVG({ radius = 0 } = {}) {
  // 背景跟標誌在同一個檔裡 → 晶片孔照規範挖空、透出漸層底
  const { svg, bbox } = markBody('reverse', { idp: 'app', cutout: true });
  const halfDiag = Math.hypot(bbox.w, bbox.h) / 2;
  const S = halfDiag / 0.39;  // 安全圓半徑 0.4S，留一點餘裕
  const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
  const x = cx - S / 2, y = cy - S / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(S)} ${n(S)}">` +
    `<defs><linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="${n(x)}" y1="${n(y)}" x2="${n(x + S)}" y2="${n(y + S)}">` +
    `<stop offset="0" stop-color="${C.deep}"/><stop offset="1" stop-color="${C.brand}"/></linearGradient></defs>` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(S)}" height="${n(S)}" rx="${n(S * radius)}" fill="url(#bg)"/>` +
    svg + `</svg>\n`;
}

// ---- 字標（規範第 03 節）：Manrope ExtraBold 字距 −2%；中文 Noto Sans TC Medium 字距 +12% ----
// 標誌與字標間距（標誌寬度的倍數）。規範文字寫 1/4（＝安全空間 x）；規範 PDF 的示意圖實際量起來約 1/2
const LOCKUP_GAP = 0.25;
const WORDMARK = 'Pick My Card';
const TAGLINE = '信用卡回饋大師';

async function fetchFont(family, weight, text) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const m = css.match(/url\((https:[^)]+)\)/);
  if (!m) throw new Error(`Google Fonts 沒回字型網址：${family}`);
  return Buffer.from(await (await fetch(m[1])).arrayBuffer());
}

/** 文字轉外框路徑（字標一律外框化，不依賴使用端有沒有裝字型） */
function textPath(font, text, size, tracking) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  let x = 0, d = '';
  glyphs.forEach((g, i) => {
    d += g.getPath(x, 0, size).toPathData(2);
    x += g.advanceWidth * scale + tracking * size;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  const width = x - tracking * size;
  const bb = font.getPath(text, 0, 0, size).getBoundingBox();
  return { d, width, top: bb.y1, bottom: bb.y2 };
}

function lockupSVG(fonts, { layout, variant = 'primary', idp = 'lk', gap = LOCKUP_GAP }) {
  const { svg, bbox } = markBody(variant, { idp });
  const reverse = variant === 'reverse';
  const ink = reverse ? '#FFFFFF' : C.ink;
  const sub = reverse ? 'rgba(255,255,255,0.85)' : C.sub;
  const space = bbox.w * gap;
  const cap = fonts.latin.charToGlyph('P').getBoundingBox().y2 / fonts.latin.unitsPerEm;
  let body, W, H;
  if (layout === 'horizontal') {
    // 字標大寫高 ≈ 標誌高 40%，中文副標字級 ≈ 標誌高 16%，整塊文字與標誌垂直置中
    const size = (bbox.h * 0.4) / cap;
    const wm = textPath(fonts.latin, WORDMARK, size, -0.02);
    const tg = textPath(fonts.cjk, TAGLINE, bbox.h * 0.16, 0.12);
    const lineGap = bbox.h * 0.16;
    const blockH = -wm.top + lineGap + (tg.bottom - tg.top);
    const top = bbox.y + (bbox.h - blockH) / 2;
    const tx = bbox.x + bbox.w + space;
    const wmBase = top - wm.top;
    const tgBase = wmBase + lineGap - tg.top;
    body = `<g transform="translate(${n(-bbox.x)} ${n(-bbox.y)})">${svg}` +
      `<path transform="translate(${n(tx)} ${n(wmBase)})" fill="${ink}" d="${wm.d}"/>` +
      `<path transform="translate(${n(tx)} ${n(tgBase)})" fill="${sub}" d="${tg.d}"/></g>`;
    W = bbox.w + space + Math.max(wm.width, tg.width);
    H = bbox.h;
  } else {
    // 直式：標誌在上、字標置中於下，間距同樣是 1/4 標誌寬
    const size = (bbox.h * 0.3) / cap;
    const wm = textPath(fonts.latin, WORDMARK, size, -0.02);
    W = Math.max(wm.width, bbox.w);
    const mx = (W - bbox.w) / 2 - bbox.x, my = -bbox.y;
    const base = bbox.h + space - wm.top;
    body = `<g transform="translate(${n(mx)} ${n(my)})">${svg}</g>` +
      `<path transform="translate(${n((W - wm.width) / 2)} ${n(base)})" fill="${ink}" d="${wm.d}"/>`;
    H = base + wm.bottom;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" role="img" aria-label="Pick My Card 信用卡回饋大師">${body}</svg>\n`;
}

// ---- 點陣化（Chromium）＋ ICO 打包 ----
async function rasterize(page, svg, width, height = width, { opaque = false } = {}) {
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;background:transparent">` +
    `<img src="${uri}" style="display:block;width:${width}px;height:${height}px"></body></html>`);
  await page.waitForFunction(() => document.images[0].complete);
  return page.screenshot({ omitBackground: !opaque, clip: { x: 0, y: 0, width, height } });
}
async function renderHTML(page, html, width, height) {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ clip: { x: 0, y: 0, width, height } });
}

function buildICO(entries) {
  // entries: [{ size, png }]，ICO 內直接嵌 PNG（Vista 以後所有瀏覽器都吃）
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log('  ' + path.relative(ROOT, file));
}

async function main() {
  const { chromium } = require('playwright');
  // 跟 tools/regression 一樣：容器預裝的 Chromium 優先（npm 版 playwright 可能對不上預裝的瀏覽器版本）
  const execPath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(execPath ? { executablePath: execPath } : {});
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  console.log('標誌本體（assets/brand/）');
  for (const v of Object.keys(VARIANTS)) {
    write(path.join(BRAND_DIR, v === 'primary' ? 'pmc-mark.svg' : `pmc-mark-${v}.svg`), markSVG(v));
  }
  write(path.join(BRAND_DIR, 'pmc-mark-small.svg'), markSVG('primary', { small: true }));
  write(path.join(BRAND_DIR, 'pmc-mark-small-reverse.svg'), markSVG('reverse', { small: true }));
  write(path.join(BRAND_DIR, 'pmc-app-icon.svg'), appIconSVG({ radius: 0.225 }));
  // 社群頭像：滿版漸層底，平台會自行裁圓
  write(path.join(BRAND_DIR, 'pmc-social-avatar.png'), await rasterize(page, appIconSVG(), 1024, 1024, { opaque: true }));

  console.log('網站用檔（assets/images/、根目錄）');
  // header（藍漸層底）＝反白版，緊貼外框；CSS 只設高度
  const header = markSVG('reverse');
  write(path.join(IMG_DIR, 'logo-header.svg'), header);
  // PNG 版留給尚未重匯出的 promos.html（舊版 Apps Script 引用 logo-header.png）
  const hb = markBody('reverse').bbox;
  write(path.join(IMG_DIR, 'logo-header.png'), await rasterize(page, header, Math.round(256 * hb.w / hb.h), 256));
  // 分頁 favicon：小尺寸版（規範：32px 以下）
  write(path.join(IMG_DIR, 'favicon.svg'), markSVG('primary', { small: true, square: true }));
  const ico = [];
  for (const size of [16, 24, 32, 48]) {
    const small = size < 32;
    ico.push({ size, png: await rasterize(page, markSVG('primary', { small, square: true, pad: small ? 0 : 1 }), size) });
  }
  write(path.join(ROOT, 'favicon.ico'), buildICO(ico));
  // 透明底主要版本（舊引用相容＋高解析用途）
  write(path.join(IMG_DIR, 'icon-pickmycard.png'), await rasterize(page, markSVG('primary', { square: true, pad: 4 }), 512));
  // App 圖示：apple-touch／maskable 用滿版方形（系統自己裁），manifest any 用圓角方塊
  write(path.join(IMG_DIR, 'icon-pickmycard-ios.png'), await rasterize(page, appIconSVG(), 512, 512, { opaque: true }));
  write(path.join(IMG_DIR, 'icon-192.png'), await rasterize(page, appIconSVG({ radius: 0.225 }), 192));
  write(path.join(IMG_DIR, 'icon-512.png'), await rasterize(page, appIconSVG({ radius: 0.225 }), 512));

  if (!MARKS_ONLY) {
    console.log('字標組合與分享圖（需要網路抓字型）');
    const opentype = require('opentype.js');
    const parse = (buf) => opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    const fonts = {
      latin: parse(await fetchFont('Manrope', 800, WORDMARK + 'pickmycard.ap')),
      cjk: parse(await fetchFont('Noto Sans TC', 500, TAGLINE)),
    };
    const lh = lockupSVG(fonts, { layout: 'horizontal' });
    write(path.join(BRAND_DIR, 'pmc-lockup-horizontal.svg'), lh);
    write(path.join(BRAND_DIR, 'pmc-lockup-horizontal-reverse.svg'), lockupSVG(fonts, { layout: 'horizontal', variant: 'reverse' }));
    write(path.join(BRAND_DIR, 'pmc-lockup-vertical.svg'), lockupSVG(fonts, { layout: 'vertical' }));

    // 社群分享圖 1200×630：淺底＋橫式主要組合，網址用外框字避免依賴系統字型
    const url = textPath(fonts.latin, 'pickmycard.app', 30, 0.01);
    const urlSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${n(url.top - 1)} ${n(url.width)} ${n(url.bottom - url.top + 2)}"><path fill="${C.deep}" d="${url.d}"/></svg>`;
    const b64 = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
    const og = `<html><body style="margin:0;width:1200px;height:630px;background:#FAFAF7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px">` +
      `<img src="${b64(lh)}" style="height:200px">` +
      `<img src="${b64(urlSVG)}" style="height:${n(url.bottom - url.top + 2)}px">` +
      `<div style="position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(135deg,${C.deep},${C.brand})"></div>` +
      `</body></html>`;
    write(path.join(IMG_DIR, 'pickmycard-social-share.png'), await renderHTML(page, og, 1200, 630));
  }

  await browser.close();
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { markSVG, markBody, appIconSVG, lockupSVG, fetchFont, textPath, VARIANTS, WORDMARK, TAGLINE };
