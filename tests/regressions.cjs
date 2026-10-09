const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { RemoteSession } = require('../electron/remoteSession');
const { canonicalId, isJunk } = require('../electron/productivity/catalog');
const { resolveApplication } = require('../electron/appCommands');
class Store {
  constructor(data = {}) { this.data = structuredClone(data); }
  get(k, fallback) { return k.split('.').reduce((v,k) => v?.[k], this.data) ?? fallback; }
  set(k,v) { const keys=k.split('.'); let o=this.data; for(const p of keys.slice(0,-1)) o=o[p] ||= {}; o[keys.at(-1)]=v; }
  saveSync() {}
}
function load(file, mocks = {}, globals = {}) {
  const filename=path.resolve(__dirname,'..',file), actual=createRequire(filename), module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), { module, exports:module.exports, require:n=>mocks[n] || actual(n), __dirname:path.dirname(filename), process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval, ...globals }, {filename});
  return module.exports;
}
function harness(start = new Date(2026,9,8,10).getTime(), childProcess) {
  let wall=start, mono=0, idle=0;
  const runtime=childProcess ? load('electron/productivity/tracker-runtime.js', {'node:child_process':childProcess}) : require('../electron/productivity/tracker-runtime');
  const AppTracker=runtime.createTracker({ app:{}, powerMonitor:{getSystemIdleTime:()=>idle}, getLocalDateKey:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, DEFAULT_CATEGORIES:{code:'productive'}, ICON_MAP:{}, SYSTEM_IGNORED_PROCS:['lockapp'] });
  const store=new Store(), tracker=new AppTracker(store,()=>{},null,null,{now:()=>wall,monotonic:()=>mono});
  return {store,tracker,advance:ms=>{wall+=ms;mono+=ms;},idle:v=>{idle=v;}};
}
test('40 x 1.5s intervals total 60s, assigned to previous foreground',()=>{
  const h=harness(); h.tracker.recordActivity('code','','C:\\Code.exe',22);
  for(let i=0;i<40;i++){h.advance(1500);h.tracker.recordActivity('code','','C:\\Code.exe',22);}
  assert.equal(h.tracker.getTodayApps()[0].totalSeconds,60);
  h.advance(3000);h.tracker.recordActivity('chrome','','C:\\Chrome.exe',23);
  assert.equal(h.tracker.getTodayApps().find(a=>a.name==='code').totalSeconds,63);
  assert.equal(h.tracker.getTodayApps().find(a=>a.name==='chrome'),undefined);
});
test('real tools monitored, idle and unknown foreground stop accrual',()=>{
  const h=harness();
  for(const name of ['antigravity','powershell','cmd','explorer','electron']) {
    h.tracker.recordActivity(name,'',`C:\\other\\${name}.exe`,22);h.advance(1500);h.tracker.recordActivity(name,'',`C:\\other\\${name}.exe`,22);
  }
  assert.equal(h.tracker.getTodayApps().length,5);
  const total=()=>h.tracker.getTodayApps().reduce((s,a)=>s+a.totalSeconds,0);
  const before=total();h.idle(200);h.advance(1500);h.tracker.recordActivity('chrome','','C:\\Chrome.exe',23);
  assert.equal(total(),before); assert.equal(h.tracker.getCurrentForeground(),null);
  h.idle(0);h.tracker.recordActivity('code','','C:\\Code.exe',23);h.advance(30000);h.tracker.recordActivity('code','','C:\\Code.exe',23);
  assert.equal(total(),before);
});
test('midnight split and stale library usage reset',()=>{
  const h=harness(new Date(2026,9,8,23,59,59).getTime());
  h.tracker.recordActivity('code','','C:\\Code.exe',22);h.advance(1500);h.tracker.recordActivity('code','','C:\\Code.exe',22);
  assert.equal(h.tracker.getTodayApps()[0].totalSeconds,.5);
  assert.equal(Object.values(h.store.data.usageData['2026-10-08'])[0].totalSeconds,1);
  h.store.set('usageData',{});assert.equal(h.tracker.getKnownApps()[0].totalSeconds,0);
});
test('catalog keeps executable identities distinct, hides installer shortcuts',()=>{
  assert.notEqual(canonicalId({path:'C:\\One\\app.exe'}),canonicalId({path:'D:\\Two\\app.exe'}));
  assert.equal(isJunk({name:'Uninstall Node.js'}),true);
  assert.equal(isJunk({name:'GitHub Desktop',processName:'GitHubDesktop'}),false);
  const h=harness();h.tracker.register({processName:'app',name:'One',path:'C:\\One\\app.exe'});h.tracker.register({processName:'app',name:'Two',path:'D:\\Two\\app.exe'});
  assert.equal(h.tracker.getKnownApps().length,2);
  const direct={name:'Discord',processName:'Discord',path:'C:\\Discord.exe',source:'shortcut'};
  h.tracker.register(direct);h.tracker.register({...direct,arguments:'--processStart Discord.exe',shortcut:'C:\\Discord.lnk'});
  assert.equal(h.tracker.getKnownApps().filter(a=>a.name==='Discord').length,1);
});
test('stdout carries JSON across arbitrary and UTF8 chunk boundaries',()=>{
  const child=new EventEmitter(); child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  const h=harness(undefined,{spawn:()=>child});h.tracker.isTracking=true;h.tracker.spawnTrackerProcess();
  const buf=Buffer.from(JSON.stringify({n:'code',t:'café\nnotes',path:'C:\\Code.exe',p:22})+'\n');
  for(const byte of buf) child.stdout.emit('data',Buffer.from([byte]));
  assert.equal(h.tracker.getCurrentForeground().windowTitle,'café\nnotes');assert.equal(h.tracker.parseErrors,0);
  h.tracker.stop();
});
test('week aggregation matches displayed calendar dates',()=>{
  const h=harness(new Date(2026,9,8,12).getTime());
  h.store.set('usageData',{'2026-10-04':{code:{totalSeconds:999}},'2026-10-05':{code:{totalSeconds:60}}});
  assert.equal(h.tracker.getWeekApps()[0].totalSeconds,60);
  assert.equal(h.tracker.getDailyTotals().reduce((s,a)=>s+a.value*3600,0),60);
});
test('focus expires without a renderer; Pomodoro break survives and records once',()=>{
  let now=100000;class FakeDate extends Date { static now(){return now;} }
  const {AppBlocker}=load('electron/productivity/blocker.js',{'electron':{Notification:{}},'./tracker':{DEFAULT_CATEGORIES:{},getLocalDateKey:()=>''},'node:child_process':{execFile:()=>{}}},{Date:FakeDate,setInterval:()=>1,clearInterval:()=>{}});
  const store=new Store(), blocker=new AppBlocker(store);
  blocker.start({durationMinutes:1}); now+=61000;
  assert.equal(blocker.getStatus().active,false);assert.equal(store.get('focusSessions',[]).length,1);
  blocker.getStatus();assert.equal(store.get('focusSessions',[]).length,1);
  blocker.start({durationMinutes:1,timerMode:'pomodoro',breakMinutes:1}); now+=60000;
  assert.equal(blocker.getStatus().phase,'break');assert.equal(blocker.getStatus().active,true);
  now+=60000;assert.equal(blocker.getStatus().active,false);assert.equal(store.get('focusSessions',[]).length,2);
});
test('remote input requires acceptance, exact session and peer; end and expiry revoke it',()=>{
  let now=1000;const host=new RemoteSession(()=>now), viewer=new RemoteSession(()=>now), id=viewer.begin();
  const packet={action:'request',sessionId:id,senderId:'peer',timestamp:now};
  assert.equal(host.receive({...packet,action:'input'}),false);
  assert.equal(host.receive(packet),true);assert.equal(host.receive({...packet,action:'input'}),false);
  host.accept(true);assert.equal(host.receive({...packet,action:'input'}),true);
  assert.equal(host.receive({...packet,action:'input',senderId:'stranger'}),false);
  host.end();assert.equal(host.receive({...packet,action:'input'}),false);
  host.receive(packet);host.accept(true);now+=3600001;assert.equal(host.isHost(),false);
});
test('app command resolution rejects shell text and ambiguous guessed names',()=>{
  for(const query of ['chrome & calc','x"; Remove-Item C:\\','', 'notepad']) assert.throws(()=>resolveApplication(query,{},[]));
  const catalog=[{id:'app-1',name:'My App',path:'C:\\App.exe',args:['--flag']}];
  assert.equal(resolveApplication('My App',{},catalog),catalog[0]);
});

test('task merge converges, retains offline edits and deletion tombstones',()=>{
  const {mergeTasks,stampTasks}=require('../electron/taskSync');
  const base={id:'t',title:'Work',createdAt:1,updatedAt:10,revision:'a',completed:false};
  const edit={...base,title:'Review',updatedAt:20,revision:'b'};
  assert.deepEqual(mergeTasks([base],[edit]),mergeTasks([edit],[base]));
  const deleted={...edit,deleted:true};stampTasks([deleted],[edit],30);
  assert.equal(deleted.updatedAt,30);
  assert.equal(mergeTasks([deleted],[base],[edit])[0].deleted,true);
  const concurrent={...edit,title:'Publish',revision:'c'};
  assert.deepEqual(mergeTasks([concurrent],[edit]),mergeTasks([edit],[concurrent]));
});
test('settings encrypt secrets and never return them through public settings',()=>{
  const {encodeSettings,decodeSettings,publicSettings,mergeSettings,MARKER}=require('../electron/secretSettings');
  const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const original={userName:'User',geminiApiKey:'test-only-key',syncPassword:'test-only-password',googleOAuth:{refreshToken:'test-only-token'}};
  const encoded=encodeSettings(original,storage);
  assert.ok(encoded.geminiApiKey.encrypted);assert.deepEqual(decodeSettings(encoded,storage),original);
  const publicView=publicSettings(original);assert.equal(publicView.geminiApiKey,MARKER);assert.equal(publicView.googleOAuth,MARKER);
  assert.deepEqual(mergeSettings(original,publicView),original);
  assert.throws(()=>encodeSettings(original,{isEncryptionAvailable:()=>false}));
});
test('engine RPC rejects unauthorized requests and executes duplicate request IDs once',async()=>{
  const {startEngineRpc}=require('../electron/engineRpc');let calls=0;
  const server=await startEngineRpc(async()=>{calls++;return {saved:true};});
  try {
    const url=process.env.BAYMAX_RPC_URL, body=JSON.stringify({id:'test-request',action:'test',parameters:{}});
    assert.equal((await fetch(url,{method:'POST',body})).status,403);
    const headers={Authorization:'Bearer '+process.env.BAYMAX_RPC_TOKEN};
    const responses=await Promise.all([fetch(url,{method:'POST',headers,body}),fetch(url,{method:'POST',headers,body})]);
    for(const response of responses) assert.equal((await response.json()).success,true);
    assert.equal(calls,1);
  } finally { await new Promise(resolve=>server.close(resolve));delete process.env.BAYMAX_RPC_URL;delete process.env.BAYMAX_RPC_TOKEN; }
});

test('action parser preserves quoted braces, deduplicates commands and uses absolute roles',()=>{
  const {parseActionTags,resolveRole}=require('../electron/actionTags');
  const command='[ADD_TASK: '+JSON.stringify({title:'Review {draft} and ] quotes "x"',for:'me'})+']';
  const parsed=parseActionTags('Saving. '+command+' '+command);
  assert.equal(parsed.actions.length,1);assert.equal(parsed.actions[0].value.title,'Review {draft} and ] quotes "x"');
  assert.equal(resolveRole('me','her'),'me');assert.equal(resolveRole('her','me'),'her');assert.equal(resolveRole('partner','her'),'me');
  assert.throws(()=>parseActionTags('[ADD_TASK: {"title":"broken"}'));
});

test('ambiguous application names fail instead of choosing an arbitrary executable',()=>{
  const catalog=[{id:'one',name:'Editor',path:'C:\\one.exe'},{id:'two',name:'Editor',path:'D:\\two.exe'}];
  assert.throws(()=>resolveApplication('Editor',{},catalog),/More than one/);
  assert.equal(resolveApplication('two',{},catalog),catalog[1]);
});

test('JSON persistence preserves corrupt files and reports unsuccessful writes',()=>{
  const {readArray,writeJson}=require('../electron/jsonFiles');
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'baymax-json-')),file=path.join(dir,'data.json');
  try {
    assert.deepEqual(readArray(file),[]);writeJson(file,[{id:'saved'}]);assert.equal(readArray(file)[0].id,'saved');
    fs.writeFileSync(file,'{broken');assert.throws(()=>readArray(file));assert.equal(fs.readFileSync(file,'utf8'),'{broken');
    assert.throws(()=>writeJson(path.join(dir,'absent','file.json'),[]));assert.equal(fs.readdirSync(dir).length,1);
  } finally {fs.unlinkSync(file);fs.rmdirSync(dir);}
});

test('utility migration preserves history and allows real apps to be restored',()=>{
  const h=harness();h.store.set('knownApps',{msiexec:{name:'Uninstall Node.js'},wmplayer:{name:'Windows Media Player Legacy'},scale:{name:'Scale'}});
  h.store.set('usageData',{'2026-10-08':{wmplayer:{totalSeconds:60}}});h.tracker.cleanStore();
  assert.equal(h.tracker.getKnownApps().length,0);assert.equal(h.tracker.getTodayApps()[0].totalSeconds,60);
  h.tracker.setHidden('wmplayer',false);h.tracker.cleanStore();assert.equal(h.tracker.getKnownApps()[0].name,'Windows Media Player Legacy');
});

test('updater refuses dirty installations before downloading or writing files',async()=>{
  let network=0,writes=0;
  const updater=load('electron/updater.js',{'electron':{app:{quit:()=>assert.fail('must not quit')}},'fs':{existsSync:()=>true,writeFileSync:()=>writes++},'node:child_process':{execFile:(_file,args,_options,callback)=>callback(null,' M electron/main.js','')}},{fetch:()=>{network++;throw new Error('must not fetch');}});
  await assert.rejects(updater.performUpdate(),/Local changes/);assert.equal(network,0);assert.equal(writes,0);
});

test('asset protocol rejects invalid URLs and traversal without reading private files',async()=>{
  let handler,reads=0;
  require('../electron/appProtocol').installAppProtocol({handle:(_name,fn)=>handler=fn},{fetch:()=>{reads++;throw new Error('missing');}},path.resolve(__dirname,'..'));
  for(const url of ['baymax://app/%FF','baymax://other/index.html','baymax://app/productivity/..%2f..%2fpackage.json','baymax://app/../engine/config/api_keys.json']) {
    assert.ok((await handler({url})).status>=400);
  }
  // A public-looking path is constrained to dist, where the mocked fetch fails.
  assert.ok(reads<=1);
  const priorReads=reads;
  await handler({url:'baymax://app/sounds/blip.wav'});
  assert.equal(reads,priorReads+1,'Bundled notification audio must reach the asset loader');
});

test('OAuth rejects wrong state and replacing a flow cannot close the new server',async()=>{
  const servers=[],timers=[];let fetches=0;
  const http={createServer:handler=>{const server=new EventEmitter();Object.assign(server,{handler,closed:false,listen:(_port,_host,ready)=>ready(),close:()=>{server.closed=true;}});servers.push(server);return server;}};
  const {startGoogleOAuthFlow}=load('electron/gdrive.js',{'node:http':http},{URL,URLSearchParams,AbortController,AbortSignal,fetch:()=>{fetches++;throw new Error('unexpected request');},setTimeout:fn=>{timers.push(fn);return {unref(){}};},clearTimeout:()=>{}});
  const first=startGoogleOAuthFlow({clientId:'test-client',clientSecret:'test-secret'});await first.serverStarted;
  const response={status:0,writeHead(status){this.status=status;return this;},end(){}};
  await servers[0].handler({url:'/oauth2callback?state=wrong&code=forged'},response);assert.equal(response.status,403);assert.equal(fetches,0);
  const rejection=assert.rejects(first.completion,/replaced/);
  const second=startGoogleOAuthFlow({clientId:'test-client',clientSecret:'test-secret'});await rejection;await second.serverStarted;
  timers[0]();assert.equal(servers[1].closed,false);
  const state=new URL(second.authUrl).searchParams.get('state');assert.ok(new URL(second.authUrl).searchParams.get('code_challenge'));
  const cancelled=assert.rejects(second.completion,/cancelled/);
  await servers[1].handler({url:'/oauth2callback?state='+state+'&error=denied'},response);await cancelled;assert.equal(servers[1].closed,true);
});

test('stale Supabase authentication cannot replace the latest connection',async()=>{
  const clients=[];
  const createClient=()=>{
    const client={removed:false};
    client.auth={signInWithPassword:()=>new Promise(resolve=>{client.authenticate=resolve;}),onAuthStateChange:()=>{}};
    client.realtime={setAuth:async()=>{}};
    client.from=()=>({select:()=>({eq:()=>({single:async()=>({data:{user_a:'a',user_b:'b'}})})})});
    client.channel=()=>{const ch={owner:client,on:()=>ch,subscribe:()=>ch,untrack:()=>{},send:async()=>{client.sent=true;return 'ok';}};return ch;};
    client.removeAllChannels=()=>{client.removed=true;};client.removeChannel=()=>{};clients.push(client);return client;
  };
  const sync=load('electron/supabase.js',{'@supabase/supabase-js':{createClient}});
  const options={url:'https://example.invalid',key:'test-key',email:'test@example.invalid',password:'test-only',channelName:'pair'};
  const old=sync.initSupabase(options),latest=sync.initSupabase(options);
  clients[1].authenticate({data:{user:{id:'a'},session:{access_token:'fake-token'}}});await latest;
  clients[0].authenticate({data:{user:{id:'a'},session:{access_token:'fake-token'}}});assert.equal(await old,null);
  assert.equal(await sync.broadcastChatMessage({text:'test'}),true);assert.equal(clients[1].sent,true);assert.equal(clients[0].sent,undefined);assert.equal(clients[0].removed,true);sync.disconnectSupabase();
});
test('Overlay hover has a stable wake region and coalesces native click-through changes', () => {
  const { pointerInside, createMousePassthrough } = require('../electron/overlayInteraction');
  const hidden = { x: 428, y: 0, w: 184, h: 0 };
  assert.equal(pointerInside(410, 4, hidden), true);
  assert.equal(pointerInside(520, 30, hidden), false);
  assert.equal(pointerInside(520, 4, { ...hidden, w: NaN }), false);
  const visible = { x: 376, y: 0, w: 288, h: 32 };
  assert.equal(pointerInside(670, 30, visible, false), true);
  assert.equal(pointerInside(673, 30, visible, true), true);
  assert.equal(pointerInside(673, 30, visible, false), false);
  const calls = [];
  const update = createMousePassthrough((...args) => calls.push(args));
  for (let i = 0; i < 100; i++) update(true);
  update(false); update(false); update(true);
  assert.deepEqual(calls, [[true, { forward: true }], [false, undefined], [true, { forward: true }]]);
});
