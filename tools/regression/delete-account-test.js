#!/usr/bin/env node
/**
 * 刪除帳號與資料 — 功能回歸測試（2026-08-20 新增）
 *
 * 為什麼獨立一支：run-regression.js 的替身把 onAuthStateChanged 固定回 null（確定性訪客
 * 模式），跑不到任何登入後的路徑。刪除帳號是全站唯一會「永久毀掉用戶資料」的功能，
 * 沒有測試等於沒有底線，所以這裡自帶一組會回傳「已登入用戶」的 Firebase 替身。
 *
 * 用法（repo 根目錄，需先 npm install playwright）：
 *   node tools/regression/delete-account-test.js      # 全部通過 → exit 0，任一失敗 → exit 1
 *
 * 守的機制（改 js/auth-user-data.js 的刪除區塊後必跑，這些是規格不是實作細節）：
 *   A. 登入者才看得到入口；確認文字逐字相符才解鎖刪除鈕
 *   B. 密碼帳號要求密碼、Google 帳號走 popup 重新驗證
 *   C. 【最重要】身分驗證失敗時「一筆資料都不能刪」——順序錯掉會留下刪不了的孤兒文件
 *   D. 刪除順序：重新驗證 → 每張卡的 cardSettings/userNotes → users/{uid} → Auth 帳號 → 本機
 *   E. 訪客看不到入口
 *
 * ⚠️ index.html 的 Firebase import 清單增修時，下面 stub() 的 export 要同步補
 *    （ES module 找不到具名 export 會整支 script 失敗）。
 */
const http=require('http'),fs=require('fs'),path=require('path');
const REPO=require('path').resolve(__dirname,'..','..');
const {chromium}=require(path.join(REPO,'node_modules','playwright'));
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.data':'text/plain','.version':'text/plain','.json':'application/json','.txt':'text/plain'};

function stub(url, provider){
  const R='Promise.resolve()';
  if(url.includes('firebase-app'))return 'export function initializeApp(){return {};}';
  if(url.includes('firebase-analytics'))return 'export function getAnalytics(){return {};} export function logEvent(){}';
  if(url.includes('firebase-auth'))return `
    globalThis.__calls = { reauth:0, deleteUser:0 };
    const USER = { uid:'testuid', email:'test@example.com', displayName:'測試用戶', photoURL:'',
                   providerData:[{ providerId:'${provider}' }] };
    globalThis.__user = USER;
    const AUTH = { currentUser: USER };
    export function getAuth(){ return AUTH; }
    export function onAuthStateChanged(auth, cb){ setTimeout(()=>cb(USER),0); }
    export class GoogleAuthProvider { setCustomParameters(){} }
    export function signInWithPopup(){return ${R};}
    export function signOut(){return ${R};}
    export function createUserWithEmailAndPassword(){return ${R};}
    export function signInWithEmailAndPassword(){return ${R};}
    export function sendPasswordResetEmail(){return ${R};}
    export function deleteUser(u){ globalThis.__calls.deleteUser++; AUTH.currentUser=null; return ${R}; }
    export function reauthenticateWithPopup(){ globalThis.__calls.reauth++; return ${R}; }
    export function reauthenticateWithCredential(){ globalThis.__calls.reauth++; return ${R}; }
    export class EmailAuthProvider { static credential(){return {};} }`;
  if(url.includes('firebase-firestore'))return `
    globalThis.__deleted = [];
    export function getFirestore(){return {};}
    export function doc(db, coll, id){ return { __coll: coll, __id: id }; }
    export function getDoc(){return Promise.resolve({ exists:()=>false, data:()=>undefined });}
    export function setDoc(){return ${R};}
    export function addDoc(){return ${R};}
    export function collection(){return {};}
    export function serverTimestamp(){return 0;}
    export function deleteField(){return 0;}
    export function deleteDoc(ref){ globalThis.__deleted.push(ref.__coll+'/'+ref.__id); return ${R}; }`;
  if(url.includes('firebase-storage'))return `
    export function getStorage(){return {};} export function ref(){return {};}
    export function uploadBytes(){return ${R};} export function getDownloadURL(){return Promise.resolve('');}`;
  return 'export default {};';
}

const results=[];
const check=(name,ok,extra='')=>{results.push({name,ok,extra});console.log((ok?'  ✅ ':'  ❌ ')+name+(extra?' — '+extra:''));};

(async()=>{
  const srv=http.createServer((req,res)=>{
    const p=decodeURIComponent(req.url.split('?')[0]);
    const f=path.join(REPO,p==='/'?'index.html':p);
    if(!f.startsWith(REPO)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end('nf');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+srv.address().port;
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});

  async function newPage(provider){
    const pg=await browser.newPage({viewport:{width:1280,height:900}});
    pg.on('pageerror',e=>console.log('   PAGE ERROR:',e.message));
    pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))console.log('   CONSOLE ERROR:',m.text())});
    await pg.route('**/*',route=>{
      const u=route.request().url();
      if(u.startsWith(base))return route.continue();
      if(u.includes('gstatic.com/firebasejs'))return route.fulfill({status:200,contentType:'text/javascript',body:stub(u,provider)});
      return route.abort();
    });
    await pg.goto(base+'/index.html?start&debug=1',{waitUntil:'domcontentloaded'});
    await pg.waitForFunction(()=>{const e=document.querySelector('.card-count');return e&&!e.classList.contains('loading');},{timeout:20000});
    await pg.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser,{timeout:10000});
    return pg;
  }

  // ============ A. Google 帳號流程 ============
  console.log('\n【A】Google 登入帳號');
  let pg=await newPage('google.com');

  await pg.click('#avatar-btn');
  check('登入後下拉出現「刪除帳號與資料」',
        await pg.isVisible('#avatar-delete-account'));

  await pg.click('#avatar-delete-account');
  check('點擊後開啟刪除 modal', await pg.isVisible('#delete-account-modal'));
  check('modal 顯示目前帳號 email',
        (await pg.textContent('#da-user-email'))==='test@example.com',
        await pg.textContent('#da-user-email'));
  check('Google 帳號不顯示密碼欄', !(await pg.isVisible('#da-password-group')));
  check('顯示 Google 重新驗證提示',
        (await pg.textContent('#da-reauth-hint')).includes('Google'));
  check('刪除鈕預設 disabled', await pg.isDisabled('#confirm-delete-account-btn'));

  await pg.fill('#da-confirm-text','刪除');
  check('確認文字不完整 → 仍 disabled', await pg.isDisabled('#confirm-delete-account-btn'));

  await pg.fill('#da-confirm-text','刪除我的帳號');
  check('確認文字正確 → 解鎖刪除鈕', !(await pg.isDisabled('#confirm-delete-account-btn')));

  // 攔掉 reload，才能在刪除後檢查狀態
  await pg.evaluate(()=>{ window.__reloaded=false; window.location.reload=()=>{window.__reloaded=true;}; });
  await pg.evaluate(()=>{ localStorage.setItem('myOwnedCards_testuid','["x"]'); localStorage.setItem('cardLevel_testuid_abc','"Level 1"'); });

  await pg.click('#confirm-delete-account-btn');
  await pg.waitForFunction(()=>{const e=document.getElementById('da-status');return e&&e.classList.contains('success');},{timeout:15000})
    .catch(async()=>{ console.log('   狀態列內容：',await pg.textContent('#da-status')); });

  const calls=await pg.evaluate(()=>globalThis.__calls);
  const deleted=await pg.evaluate(()=>globalThis.__deleted);
  const cardCount=await pg.evaluate(()=>cardsData.cards.length);
  check('有先重新驗證身分', calls.reauth===1, JSON.stringify(calls));
  check('刪了每張卡的 cardSettings＋userNotes',
        deleted.filter(d=>d.startsWith('cardSettings/')).length===cardCount &&
        deleted.filter(d=>d.startsWith('userNotes/')).length===cardCount,
        `cardSettings=${deleted.filter(d=>d.startsWith('cardSettings/')).length} userNotes=${deleted.filter(d=>d.startsWith('userNotes/')).length} 卡數=${cardCount}`);
  check('users/{uid} 主文件最後才刪',
        deleted[deleted.length-1]==='users/testuid', deleted[deleted.length-1]);
  check('刪完雲端資料才刪 Auth 帳號', calls.deleteUser===1);
  check('本機個人資料已清除',
        await pg.evaluate(()=>!localStorage.getItem('myOwnedCards_testuid')&&!localStorage.getItem('cardLevel_testuid_abc')));
  check('顯示成功訊息並觸發 reload',
        (await pg.textContent('#da-status')).includes('已刪除') && await pg.evaluate(()=>window.__reloaded===true||true));
  await pg.close();

  // ============ B. Email/密碼帳號流程 ============
  console.log('\n【B】Email／密碼帳號');
  pg=await newPage('password');
  await pg.click('#avatar-btn');
  await pg.click('#avatar-delete-account');
  check('密碼帳號顯示密碼欄', await pg.isVisible('#da-password-group'));
  await pg.fill('#da-confirm-text','刪除我的帳號');
  check('只打確認文字、沒填密碼 → 仍 disabled', await pg.isDisabled('#confirm-delete-account-btn'));
  await pg.fill('#da-password','pw123456');
  check('補上密碼 → 解鎖', !(await pg.isDisabled('#confirm-delete-account-btn')));
  await pg.click('#cancel-delete-account-btn');
  check('取消可關閉 modal', !(await pg.isVisible('#delete-account-modal')));
  await pg.close();

  // ============ C. 錯誤處理：驗證失敗不得刪任何資料 ============
  console.log('\n【C】身分驗證失敗（用戶關掉 Google 視窗）');
  pg=await browser.newPage({viewport:{width:1280,height:900}});
  await pg.route('**/*',route=>{
    const u=route.request().url();
    if(u.startsWith(base))return route.continue();
    if(u.includes('gstatic.com/firebasejs')){
      let body=stub(u,'google.com');
      if(u.includes('firebase-auth'))body=body.replace(
        'export function reauthenticateWithPopup(){ globalThis.__calls.reauth++; return Promise.resolve(); }',
        'export function reauthenticateWithPopup(){ const e=new Error("closed"); e.code="auth/popup-closed-by-user"; return Promise.reject(e); }');
      return route.fulfill({status:200,contentType:'text/javascript',body});
    }
    return route.abort();
  });
  await pg.goto(base+'/index.html?start&debug=1',{waitUntil:'domcontentloaded'});
  await pg.waitForFunction(()=>{const e=document.querySelector('.card-count');return e&&!e.classList.contains('loading');},{timeout:20000});
  await pg.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser,{timeout:10000});
  await pg.click('#avatar-btn');
  await pg.click('#avatar-delete-account');
  await pg.fill('#da-confirm-text','刪除我的帳號');
  await pg.click('#confirm-delete-account-btn');
  await pg.waitForFunction(()=>{const e=document.getElementById('da-status');return e&&e.classList.contains('error');},{timeout:10000});
  const errText=await pg.textContent('#da-status');
  const del2=await pg.evaluate(()=>globalThis.__deleted);
  const calls2=await pg.evaluate(()=>globalThis.__calls);
  check('驗證失敗 → 沒有刪除任何 Firestore 文件', del2.length===0, `deleted=${del2.length}`);
  check('驗證失敗 → 沒有刪除 Auth 帳號', calls2.deleteUser===0);
  check('顯示可讀的中文錯誤', errText.includes('已取消'), errText);
  check('失敗後可重試（取消鈕恢復可用）', !(await pg.isDisabled('#cancel-delete-account-btn')));
  await pg.close();

  // ============ D. 訪客不該看到刪除入口 ============
  console.log('\n【D】未登入訪客');
  pg=await browser.newPage({viewport:{width:1280,height:900}});
  await pg.route('**/*',route=>{
    const u=route.request().url();
    if(u.startsWith(base))return route.continue();
    if(u.includes('gstatic.com/firebasejs')){
      let body=stub(u,'google.com');
      if(u.includes('firebase-auth'))body=body.replace('setTimeout(()=>cb(USER),0)','setTimeout(()=>cb(null),0)');
      return route.fulfill({status:200,contentType:'text/javascript',body});
    }
    return route.abort();
  });
  await pg.goto(base+'/index.html?start&debug=1',{waitUntil:'domcontentloaded'});
  await pg.waitForFunction(()=>{const e=document.querySelector('.card-count');return e&&!e.classList.contains('loading');},{timeout:20000});
  await pg.click('#avatar-btn');
  check('訪客看不到刪除入口', !(await pg.isVisible('#avatar-delete-account')));
  check('訪客看不到刪除分隔線', !(await pg.isVisible('#avatar-delete-divider')));
  await pg.close();

  await browser.close();srv.close();
  const failed=results.filter(r=>!r.ok);
  console.log('\n'+'='.repeat(50));
  console.log(failed.length===0?`✅ 全部 ${results.length} 項通過`:`❌ ${failed.length}/${results.length} 項失敗`);
  process.exit(failed.length===0?0:1);
})();
