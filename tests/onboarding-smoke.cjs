const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(root,'audit/onboarding-profile-'));
app.setPath('userData',folder);app.disableHardwareAcceleration();require('../electron/appProtocol').registerAppScheme(protocol);
const {capabilities,cleanConfig}=require('../electron/account');
const config=cleanConfig({supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'sb_publishable_fixture'});
let saved=null,win,lastPaint;const errors=[],checks=[],requests=[],rects=[];
const snapshot=()=>({configured:true,config,user:saved?.user||null,...(saved?.snapshot||{}),planChosen:!!saved?.planChosen,capabilities:capabilities(config,saved)});
const emit=()=>win.webContents.send('account-changed',snapshot());
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 require('../electron/appProtocol').installAppProtocol(protocol,net,root);
 const handlers={
  boot:()=>({settings:{assistantName:'Baymax',aiProvider:'groq',soundEnabled:false,activeIntegrations:[],autoCloseInterval:2},account:snapshot(),schedule:[],version:'1.0.1-test'}),
  'account-snapshot':snapshot,'account-refresh':snapshot,
  'account-login':()=>{saved={user:{id:'alice',email:'alice@example.com',displayName:'Alice'},snapshot:{profile:null,entitlement:{plan:'free'}},verifiedAt:Date.now(),planChosen:false};emit();return {started:true};},
  'account-action':(_,op,args)=>{requests.push({op,args});if(op==='reserve'){assert.match(args.username,/^[a-z0-9_]{3,24}$/);saved.snapshot.profile={user_id:'alice',username:args.username,display_name:'Alice'};}if(op==='continue-free')saved.planChosen=true;emit();return snapshot();},
  'account-billing':(_,op,args)=>{requests.push({op,args});if(op==='plans')return {ready:false,plans:[]};saved.snapshot.entitlement={plan:args.priceCode.startsWith('duo')?'duo':'pro',provider:'beta_test',periodEnd:new Date(Date.now()+365*86400000).toISOString()};saved.planChosen=true;saved.verifiedAt=Date.now();emit();return {testing:true};},
  'get-chat-messages':()=>[],'get-known-apps':()=>[],'get-tracked-apps':()=>[],'get-focus-sessions':()=>[],
  'music-load':()=>({version:1,activePlaylistId:'favorites',currentTrackId:'',playlists:[{id:'favorites',name:'My playlist',tracks:[]}]}),
  'get-push-to-talk-state':()=>({enabled:false,held:false,ready:true,suspended:false,key:'F2',error:''}),
  'set-island-rect':(_,x,y,w,h)=>{rects.push({x,y,w,h});return true;},
  'request-remote-access':()=>{throw new Error('Capture must not start from navigation');},
 };
 const preload=fs.readFileSync(path.join(root,'electron/preload.js'),'utf8');
 for(const channel of new Set([...preload.matchAll(/ipcRenderer\.invoke\(["']([^"']+)/g)].map(m=>m[1])))ipcMain.handle(channel,handlers[channel]||(()=>true));
 win=new BrowserWindow({show:false,frame:false,transparent:true,width:1040,height:640,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,preload:path.join(root,'electron/preload.js')}});
 win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});win.webContents.on('paint',(_,__,image)=>{lastPaint=image;});
 const js=code=>win.webContents.executeJavaScript(code),click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait(400);};
 const shot=name=>{if(lastPaint)fs.writeFileSync(path.join(root,'audit/onboarding-'+name+'.png'),lastPaint.toPNG());};
 try{
  await win.loadURL('baymax://app/index.html');await wait(2700);
  assert.equal(await js("document.querySelector('.onboarding-view.on')?.dataset.stage"),'google');
  assert.equal(await js("getComputedStyle(document.querySelector('.welcome-cards')).opacity"),'1');shot('welcome');
  for(const label of ['Home','Chat','Partner','PC Control','Tasks','Focus'])assert.ok(await js(`document.querySelector('#header button[aria-label="${label}"]')`));
  await click('#header button[aria-label="Home"]');emit();await wait(100);assert.ok(await js("document.querySelector('.overview.on')!==null"));
  checks.push('First-run welcome waves; all six tabs remain visible and account updates never force Settings');
  await js("window.dispatchEvent(new Event('baymax-open-welcome'))");await wait(350);
  await click('.welcome-google');await wait(800);assert.equal(await js("document.querySelector('.onboarding-view.on').dataset.stage"),'username');shot('username');
  await js("const input=document.querySelector('.welcome-card input');input.value='alice_123';input.dispatchEvent(new Event('input'));document.querySelector('.welcome-card form').requestSubmit()");await wait(650);
  assert.equal(await js("document.querySelector('.onboarding-view.on').dataset.stage"),'plans');
  assert.equal(await js("document.querySelector('.onboarding-view').querySelectorAll('.plan-card').length"),3);shot('plans');
  assert.equal(requests.find(r=>r.op==='reserve').args.username,'alice_123');
  checks.push('Google success moves to username; reservation progresses to exactly three plan cards');
  await click('.onboarding-view [data-plan="free"] button');assert.ok(await js("document.querySelector('.overview.on')!==null"));
  await click('#header button[aria-label="PC Control"]');assert.ok(await js("document.querySelector('.upgrade-dialog')?.open"));
  const bounds=await js("(()=>{const d=document.querySelector('.upgrade-dialog').getBoundingClientRect(),i=document.querySelector('#island').getBoundingClientRect();return {bottom:d.bottom,islandBottom:i.bottom};})()");assert.ok(bounds.bottom<=bounds.islandBottom,JSON.stringify(bounds));shot('upgrade');
  await js("document.querySelector('.upgrade-dialog button').click()");await wait(700);
  assert.equal(await js("document.querySelector('.settings-surface').dataset.page"),'plans');assert.equal(await js("document.querySelector('.upgrade-dialog')"),null);
  assert.ok(!(await js("document.querySelector('.preferences-content').textContent")).match(/pro_monthly|duo_monthly|razorpayKeyId|supabaseAnonKey/));shot('membership');
  checks.push('Free PC access opens a clickable upgrade modal whose button opens Plans & Membership directly');
  await click('.preferences-content [data-plan="pro"] button');assert.equal(saved.snapshot.entitlement.plan,'pro');
  assert.match(await js("document.querySelector('.preferences-content .plan-status-badge').textContent"),/Pay for yourself/);
  await click('.preferences-content [data-plan="duo"] button');assert.equal(saved.snapshot.entitlement.plan,'duo');
  await click('.preferences-nav [data-page="sync"]');
  assert.match(await js("document.querySelector('.preferences-content').textContent"),/Baymax Cloud Database/);
  assert.match(await js("document.querySelector('.preferences-content').textContent"),/Personal Supabase Database/);shot('database');
  checks.push('Beta Pro/Duo choices activate and refresh the active-plan badge; database choices are separate from Account');
  await click('#header button[aria-label="Tasks"]');emit();await wait(100);assert.ok(await js("document.querySelector('.schedule-view.on')!==null"));
  const billingCount=requests.filter(r=>r.op==='createCheckout').length;
  config.razorpayKeyId='rzp_test_fixture';saved.planChosen=false;saved.snapshot.entitlement.plan='duo';saved.snapshot.entitlement.provider='manual_grant';emit();
  await js("window.dispatchEvent(new Event('baymax-open-welcome'))");await wait(350);
  assert.equal(await js("document.querySelector('.onboarding-view [data-plan=duo] button').textContent"),'Continue with Duo');
  await click('.onboarding-view [data-plan="duo"] button');assert.ok(await js("document.querySelector('.overview.on')!==null"));assert.equal(requests.filter(r=>r.op==='createCheckout').length,billingCount);
  checks.push('A recipient with an existing Duo seat can finish onboarding without buying again or entering another partner');
  assert.deepEqual(errors,[]);checks.push('No renderer errors; task navigation stays usable after account changes');
  fs.writeFileSync(path.join(root,'audit/onboarding-smoke-results.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));app.exit(0);
 }catch(error){shot('failure');fs.writeFileSync(path.join(root,'audit/onboarding-smoke-results.json'),JSON.stringify({checks,errors,failure:error.stack},null,2));console.error(error);app.exit(1);}
});
