// 單卡頁分享圖示意（2026-11-22）。站長選定 B3b（深色格線＋藍光暈＋3D 斜放真卡圖＋大字卡名＋毛玻璃「新戶活動」＋底部品牌藍細條重複 pickmycard.app）；其他是被否決的版本。
// 用法：node docs/mockups/promo-og-mock-2026-11-22.js <輸出資料夾> B3b
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2];
const R = '/home/user/pick-my-card/assets/images/';
const uri = (f, t) => `data:${t};base64,` + fs.readFileSync(R + f).toString('base64');
const logo = uri('icon-pickmycard.png', 'image/png');
const cards = { eco: ['星展 eco 永續卡', uri('cards/dbs-eco.png', 'image/png')], dawho: ['永豐大戶卡', uri('cards/sinopac-dawho.png', 'image/png')], long: ['滙豐現金回饋御璽卡', uri('cards/hsbc-cashback-signature.png', 'image/png')] };
const base = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@500;700;900&display=swap');
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;font-family:'Noto Sans TC','WenQuanYi Zen Hei',sans-serif;position:relative;overflow:hidden}
  .glass{display:inline-flex;align-items:center;gap:12px;padding:14px 24px;border-radius:999px;background:rgba(255,255,255,.72);
    -webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.8);box-shadow:0 10px 30px rgba(0,0,0,.18);
    font-weight:700;font-size:26px;color:#111827;white-space:nowrap}
  .glass img{width:38px;height:38px}
  .glass i{font-style:normal;color:#9ca3af;font-weight:500}
`;
const v = {
  // B1 Apple 產品頁：淺灰底、卡片置中正放、地面倒影；只有一顆毛玻璃膠囊壓在卡片下緣
  B1: ([nm, img]) => `<style>${base}
      body{background:#f5f5f7}
      .c{position:absolute;left:50%;top:70px;width:640px;transform:translateX(-50%)}
      .c img.card{display:block;width:640px;border-radius:30px;box-shadow:0 40px 80px rgba(0,0,0,.22)}
      .c .refl{position:absolute;left:0;top:100%;width:640px;height:200px;margin-top:14px;border-radius:30px;background:url(${img}) center top/640px auto no-repeat;
        transform:scaleY(-1);opacity:.12;-webkit-mask:linear-gradient(to top,#000,transparent 60%);mask:linear-gradient(to top,#000,transparent 60%)}
      .glass{position:absolute;left:50%;bottom:78px;transform:translateX(-50%)}
    </style>
    <div class="c"><img class="card" src="${img}"><div class="refl"></div></div>
    <div class="glass"><img src="${logo}">${nm}<i>｜</i>新戶活動整理</div>`,
  // B2 The Points Guy／NerdWallet 卡片評測：品牌色滿版、卡片微斜偏右、左邊編輯式大標；角落一枚小圓章
  B2: ([nm, img]) => `<style>${base}
      body{background:#1e40af;color:#fff}
      .k{position:absolute;left:72px;top:84px;font-size:24px;font-weight:700;letter-spacing:4px;color:#93c5fd}
      h1{position:absolute;left:72px;top:126px;width:500px;font-size:66px;font-weight:900;line-height:1.15}
      .by{position:absolute;left:72px;bottom:70px;display:flex;align-items:center;gap:12px;font-size:24px;font-weight:700}
      .by img{width:42px;height:42px;background:#fff;border-radius:10px;padding:4px}
      .c{position:absolute;right:70px;top:120px;transform:rotate(-8deg)}
      .c img{display:block;width:520px;border-radius:26px;box-shadow:0 30px 60px rgba(0,0,0,.4)}
      .seal{position:absolute;right:-28px;bottom:-30px;width:112px;height:112px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(0,0,0,.3)}
      .seal img{width:64px;height:64px}
    </style>
    <div class="k">新戶活動整理</div><h1>${nm}</h1>
    <div class="c"><img src="${img}"><div class="seal"><img src="${logo}"></div></div>
    <div class="by"><img src="${logo}">pickmycard.app</div>`,
  // B3 Stripe／Linear：深色底＋淡格線＋卡片後面的光暈，卡片 3D 透視；毛玻璃標籤壓在卡片左下
  B3: ([nm, img]) => `<style>${base}
      body{background:#0b1220;color:#fff}
      .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:48px 48px;
        -webkit-mask:radial-gradient(circle at 62% 50%,#000 0%,transparent 70%);mask:radial-gradient(circle at 62% 50%,#000 0%,transparent 70%)}
      .glow{position:absolute;left:520px;top:120px;width:560px;height:380px;border-radius:50%;background:radial-gradient(#3b82f6,transparent 65%);filter:blur(40px);opacity:.8}
      .c{position:absolute;left:470px;top:110px;perspective:1400px}
      .c img{display:block;width:600px;border-radius:28px;transform:rotateY(-18deg) rotateX(8deg) rotateZ(-3deg);box-shadow:0 40px 80px rgba(0,0,0,.6)}
      .glass{position:absolute;left:430px;top:420px;background:rgba(15,23,42,.55);border-color:rgba(255,255,255,.18);color:#fff}
      .glass i{color:#64748b}
      .t{position:absolute;left:72px;top:80px;width:420px}
      .t small{display:block;font-size:22px;font-weight:700;color:#60a5fa;letter-spacing:3px}
      .t b{display:block;font-size:52px;font-weight:900;line-height:1.2;margin-top:14px}
    </style><div class="grid"></div><div class="glow"></div>
    <div class="t"><small>PICK MY CARD</small><b>${nm}</b></div>
    <div class="c"><img src="${img}"></div>
    <div class="glass"><img src="${logo}">新戶活動整理<i>・</i>pickmycard.app</div>`,
  // B3b：B3 放大字、減資訊——只留卡名（大）＋「新戶活動」毛玻璃標籤（含品牌標誌），拿掉網址與小字
  B3b: ([nm, img]) => `<style>${base}
      body{background:#0b1220;color:#fff}
      .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:48px 48px;
        -webkit-mask:radial-gradient(circle at 66% 50%,#000 0%,transparent 70%);mask:radial-gradient(circle at 66% 50%,#000 0%,transparent 70%)}
      .glow{position:absolute;left:560px;top:110px;width:560px;height:400px;border-radius:50%;background:radial-gradient(#3b82f6,transparent 65%);filter:blur(40px);opacity:.85}
      .c{position:absolute;left:560px;top:120px;perspective:1400px}
      .c img{display:block;width:580px;border-radius:28px;transform:rotateY(-18deg) rotateX(8deg) rotateZ(-3deg);box-shadow:0 40px 80px rgba(0,0,0,.6)}
      .t{position:absolute;left:64px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center}
      .t b{display:block;font-size:76px;font-weight:900;line-height:1.15;letter-spacing:-1px;text-wrap:balance}
      .glass{margin-top:34px;align-self:flex-start;gap:14px;padding:16px 30px 16px 18px;font-size:40px;font-weight:900;background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.28);color:#fff}
      .glass img{width:52px;height:52px;background:#fff;border-radius:12px;padding:5px}
      .ban{position:absolute;left:0;right:0;bottom:0;height:24px;background:#1e40af;color:rgba(255,255,255,.75);font-size:12px;font-weight:700;line-height:24px;letter-spacing:.5px;white-space:nowrap;overflow:hidden;padding-left:10px}
      .ban i{font-style:normal;opacity:.6;margin:0 8px}
    </style><div class="grid"></div><div class="glow"></div>
    <div class="c"><img src="${img}"></div>
    <div class="t"><b>${nm}</b><div class="glass"><img src="${logo}">新戶活動</div></div>
    <div class="ban">${Array(40).fill('pickmycard.app').join('<i>・</i>')}</div>`,
  // B4 Revolut／Monzo 卡片廣告：飽和色底、卡片很大、超大字直接壓過卡片（文字在卡片上面）
  B4: ([nm, img]) => `<style>${base}
      body{background:#2563eb;color:#fff}
      .c{position:absolute;left:330px;top:40px;transform:rotate(-14deg)}
      .c img{display:block;width:720px;border-radius:34px;box-shadow:0 40px 80px rgba(0,0,0,.35)}
      .big{position:absolute;left:60px;top:250px;font-size:150px;font-weight:900;line-height:1;letter-spacing:-2px;text-shadow:0 8px 30px rgba(0,0,0,.35)}
      .nm{position:absolute;left:66px;top:430px;font-size:34px;font-weight:700;text-shadow:0 4px 16px rgba(0,0,0,.4)}
      .lg{position:absolute;left:66px;top:56px;display:flex;align-items:center;gap:12px;font-size:24px;font-weight:900}
      .lg img{width:42px;height:42px;background:#fff;border-radius:10px;padding:4px}
    </style>
    <div class="c"><img src="${img}"></div>
    <div class="lg"><img src="${logo}">Pick My Card</div>
    <div class="big">新戶活動</div><div class="nm">${nm}・整理</div>`,
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  for (const [k, fn] of Object.entries(v).filter(([k]) => !process.argv[3] || k === process.argv[3])) for (const [ck, c] of Object.entries(cards)) {
    await p.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body>' + fn(c) + '</body></html>', { waitUntil: 'networkidle' });
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${S}/og4-${k}-${ck}.png` });
  }
  await b.close();
})();
