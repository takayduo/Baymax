const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'audit','smoke-user-data'));
app.disableHardwareAcceleration();
require('../electron/appProtocol').registerAppScheme(protocol);
const daily=[{id:'chrome',name:'Chrome',totalSeconds:20,timeSpentMinutes:1/3,category:'neutral',type:'application',icon:'apps'},{id:'code',name:'Code',totalSeconds:20,timeSpentMinutes:1/3,category:'productive',type:'application',icon:'apps'},{id:'antigravity',name:'Antigravity',totalSeconds:20,timeSpentMinutes:1/3,category:'productive',type:'application',icon:'apps'}];
const weekly=[{...daily[1],totalSeconds:600,timeSpentMinutes:10}];
let currentDaily=daily;
const library=[...daily,{id:'utility',name:'Windows Media Player Legacy',hidden:true,category:'neutral',timeSpentMinutes:0,totalSeconds:0,type:'application',icon:'apps'}];
const results={checks:[],errors:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  require('../electron/appProtocol').installAppProtocol(protocol,net,root);
  for(const [channel,handler] of Object.entries({
    'get-tracked-apps':(_,period)=>period==='weekly'?weekly:currentDaily,
    'get-known-apps':(_,includeHidden)=>library.filter(a=>includeHidden || !a.hidden),
    'set-app-hidden':(_,id,hidden)=>{library.find(a=>a.id===id).hidden=hidden;return true;},
    'get-daily-totals':()=>[],'get-app-categories':()=>({}),
    'get-focus-active':()=>({active:false,phase:'ended'}),'get-focus-sessions':()=>[],
    'get-blocklist':()=>[],'get-settings':()=>({theme:'dark',notifications:false}),
    'is-onboarded':()=>true,'get-user-profile':()=>({name:'Test User',email:'test@example.invalid'}),
    'get-tracking-health':()=>({active:true}),
  })) ipcMain.handle(channel,handler);
  const win=new BrowserWindow({show:false,width:1150,height:800,webPreferences:{backgroundThrottling:false,preload:path.join(root,'electron','preload.js'),contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true}});
  win.webContents.on('console-message',event=>{if(event.level==='error')results.errors.push(event.message);});
  try {
    await win.loadURL('baymax://app/smoke-parent.html');await wait(2000);
    const frame=win.webContents.mainFrame.frames.find(f=>f.url.includes('productivity/index.html'));
    assert.ok(frame,'Productivity iframe loaded');
    let text=await frame.executeJavaScript('document.body.innerText');
    assert.ok(text.includes('Productivity Overview'));assert.ok(text.includes('1m'));assert.ok(text.includes('Antigravity'));
    results.checks.push('Embedded Overview loads all three apps and aggregates 3 x 20 seconds into one minute');
    const api=await frame.executeJavaScript('({shell:typeof require,secrets:typeof window.electronAPI.secretGet,tracking:typeof window.electronAPI.getTrackedApps})');
    assert.equal(api.shell,'undefined');assert.equal(api.secrets,'undefined');assert.equal(api.tracking,'function');
    assert.equal(await frame.executeJavaScript('(()=>{try{return !!window.parent.electronAPI;}catch{return false;}})()'),false);
    results.checks.push('Subframe has no Node or secret API; scoped RPC works with webSecurity enabled');
    const portrait = await frame.executeJavaScript("document.querySelector('img[alt=\"Your companion\"]').src");
    assert.ok(portrait.startsWith('data:image/png;base64,'));
    const changedPortrait = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'public/icons/32x32.png')).toString('base64');
    await win.webContents.executeJavaScript(`document.querySelector('iframe').contentWindow.postMessage(${JSON.stringify({type:'baymax:brand',assistantName:'Test Companion',companionIcon:changedPortrait})},'*')`);
    await wait(120);
    assert.equal(await frame.executeJavaScript("document.querySelector('img[alt=\"Your companion\"]').src"), changedPortrait);
    results.checks.push('Productivity receives the selected companion portrait through its scoped parent bridge and updates without reloading');
    await frame.executeJavaScript("[...document.querySelectorAll('button')].find(b=>/Week/i.test(b.textContent))?.click()");
    for(let i=0;i<3;i++){win.webContents.send('tracking-update',{apps:daily,timeframe:'daily'});await wait(700);}
    text=await frame.executeJavaScript('document.body.innerText');assert.ok(text.includes('10m'));assert.ok(!text.includes('Antigravity'));
    results.checks.push('Weekly Overview remains weekly during daily tracking events');
    await frame.executeJavaScript("document.querySelector('a[href=\"#/insights\"]')?.click()");await wait(500);
    text=await frame.executeJavaScript('document.body.innerText');assert.ok(text.includes('Focus & Activity Insights'));assert.ok(text.includes('10m'));assert.ok(!text.includes('25m'));
    results.checks.push('Empty focus history does not invent a sample session');
    await frame.executeJavaScript("document.querySelector('a[href=\"#/classification\"]')?.click()");await wait(500);
    text=await frame.executeJavaScript('document.body.innerText');assert.ok(text.includes('Antigravity'));assert.ok(!text.includes('Windows Media Player Legacy'));
    await frame.executeJavaScript("document.querySelector('input[type=checkbox]')?.click()");await wait(100);
    text=await frame.executeJavaScript('document.body.innerText');assert.ok(text.includes('Windows Media Player Legacy'));
    await frame.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Restore')?.click()");await wait(200);
    assert.equal(library.find(a=>a.id==='utility').hidden,false);
    results.checks.push('Apps lists real applications, hides utilities by default and restores them on request');
    await frame.executeJavaScript("document.querySelector('a[href=\"#/\"]')?.click()");await wait(100);
    await frame.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Daily')?.click()");await wait(200);
    await frame.executeJavaScript("document.querySelector('a[href=\"#/insights\"]')?.click()");await wait(200);
    text=await frame.executeJavaScript('document.body.innerText');assert.ok(text.includes('Chrome'));assert.ok(text.includes('Antigravity'));assert.ok(text.includes('1m'));
    results.checks.push('Daily Insights includes neutral and productive apps with the same total as Overview');
    // Hidden-window compositor captures can lag behind navigation. Assertions
    // inspect the actual child DOM; do not publish a misleading stale capture.
    currentDaily=[];win.webContents.send('tracking-update',{apps:[],timeframe:'daily'});await wait(1800);
    text=await frame.executeJavaScript('document.body.innerText');assert.ok(text.includes('Total Recorded: 0s'));assert.ok(!text.includes('Antigravity'));
    results.checks.push('Empty current-day data clears prior usage instead of keeping stale totals');
    assert.deepEqual(results.errors,[],'No renderer console errors');
    fs.writeFileSync(path.join(root,'audit','electron-smoke-results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results));win.destroy();app.exit(0);
  } catch(e) {results.errors.push(e.stack);fs.writeFileSync(path.join(root,'audit','electron-smoke-results.json'),JSON.stringify(results,null,2));console.error(e);win.destroy();app.exit(1);}
});
