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
require('./engine-lifecycle.cjs');
require('./music.cjs');
require('./fourteen.cjs');
require('./sounds.cjs');
require('./restored-tools.cjs');
test('Minimal companions lead the catalog, retain the originals, and default to plain Puff', () => {
  const catalog = require('../public/companions/catalog.json');
  assert.deepEqual(catalog.slice(0, 10).map(a => a.id), ['puff','pebble','mallow','drop','tama','neko','kuma','usagi','kumo','hoshi']);
  assert.equal(new Set(catalog.map(a => a.id)).size, 20);
  for (const avatar of catalog.slice(0, 10)) { assert.equal(avatar.minimal, true); assert.equal(avatar.face, ''); assert.deepEqual(avatar.details, []); }
  const { normalizeCompanion } = require('../electron/companion');
  assert.equal(normalizeCompanion({ styles: { puff: {} } }).styles.puff.markings, 'plain');
});
test('Global talk key validates chords, pauses safely, requires release after restart, and closes on helper failure', () => {
  const { PushToTalkService, parseShortcut } = require('../electron/pushToTalk');
  for (const value of ['Alt+F4', 'Meta+KeyA', 'Control+Control+F8', 'F99', '$(bad)', {}, 'Control']) assert.equal(parseShortcut(value), null);
  assert.equal(parseShortcut('Shift+Control+F8').key, 'Control+Shift+F8');
  const events = [], children = [];
  const service = new PushToTalkService(s => events.push(s), { platform: 'win32', spawn: (_command, args, options) => {
    assert.equal(options.windowsHide, true); assert.ok(args.includes('-EncodedCommand'));
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { child.killed = true; child.emit('exit'); }; children.push(child); return child;
  } });
  try {
    service.configure({pushToTalkEnabled:true, pushToTalkKey:'F8'});
    const first = children[0]; first.stdout.emit('data', '1\n'); assert.equal(service.snapshot().held, false);
    first.stdout.emit('data','0\n1\n'); assert.equal(service.snapshot().held,true);
    service.suspend('picker',true); assert.equal(service.snapshot().held,false);
    first.stdout.emit('data','1\n'); assert.equal(service.snapshot().held,false);
    service.suspend('picker',false); first.stdout.emit('data','1\n'); assert.equal(service.snapshot().held,false);
    first.stdout.emit('data','0\n1\n0\n'); assert.equal(service.snapshot().held,false);
    service.configure({pushToTalkEnabled:true,pushToTalkKey:'Control+Space'});
    assert.equal(first.killed,true); first.stdout.emit('data','1\n'); assert.equal(service.snapshot().held,false);
    children[1].stdout.emit('data','0\n1\n'); assert.equal(service.snapshot().held,true);
    children[1].emit('exit'); assert.equal(service.snapshot().held,false); assert.ok(service.snapshot().error);
    service.configure({pushToTalkEnabled:true,pushToTalkKey:'F8',micEnabled:false}); assert.equal(children.length,2);
    assert.ok(events.some(e => e.ready && e.held));
  } finally { service.stop(); }
});
test('Hold-to-talk audio contains only held samples, ignores taps and silence, and is bounded to 30 seconds', () => {
  const module = { exports: {} };
  const code = require('esbuild').transformSync(fs.readFileSync(path.join(__dirname,'../src/core/holdAudio.ts'),'utf8'), {loader:'ts',format:'cjs'}).code;
  vm.runInNewContext(code, { module, exports:module.exports, Float32Array });
  const { HoldAudio } = module.exports, capture = new HoldAudio();
  const voice = new Float32Array(3200).fill(.1);
  capture.push(voice); assert.equal(capture.release().length,0);
  capture.reset(true); capture.push(new Float32Array(3200)); assert.equal(capture.release().length,0);
  capture.reset(true); capture.push(voice.subarray(0,100)); assert.equal(capture.release().length,0);
  capture.reset(true); capture.push(voice); voice.fill(.9); assert.ok(Math.abs(capture.release()[0][0]-.1)<.00001);
  capture.reset(true); for(let i=0;i<200;i++) capture.push(voice);
  assert.equal(capture.release().reduce((sum,c)=>sum+c.length,0),480000);
  capture.reset(true); capture.push(voice); capture.reset(); assert.equal(capture.release().length,0);
});
test('Talk helper tolerates slow startup and buffered heartbeats, recovers after failure, and cancels retries when disabled', () => {
  const {PushToTalkService}=require('../electron/pushToTalk');
  let now=0,nextId=0; const timers=new Map(),intervals=new Map(),children=[];
  const service=new PushToTalkService(()=>{}, {platform:'win32',now:()=>now,
    setTimeout:(fn,delay)=>{timers.set(++nextId,{fn,delay});return nextId;},clearTimeout:id=>timers.delete(id),
    setInterval:fn=>{intervals.set(++nextId,fn);return nextId;},clearInterval:id=>intervals.delete(id),
    spawn:(_command,args)=>{const script=Buffer.from(args.at(-1),'base64').toString('utf16le');assert.ok(script.includes('held != previous'));assert.ok(script.includes('lastSent >= 1000'));
      const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=()=>{};children.push(p);return p;},
  });
  const tick=()=>[...intervals.values()].forEach(fn=>fn());
  try {
    service.configure({pushToTalkEnabled:true,pushToTalkKey:'F2'});
    now=45000;tick();assert.equal(children.length,1);assert.equal(timers.size,0);
    children[0].stdout.emit('data','0\n'.repeat(6000));assert.equal(service.snapshot().ready,true);
    now+=5000;tick();assert.equal(timers.size,0);
    children[0].emit('exit');assert.equal(service.snapshot().held,false);assert.equal(timers.size,1);
    const [id,retry]=[...timers][0];timers.delete(id);retry.fn();assert.equal(children.length,2);
    children[1].stdout.emit('data','1\n');assert.equal(service.snapshot().held,false);
    children[1].stdout.emit('data','0\n1\n');assert.equal(service.snapshot().held,true);assert.equal(service.snapshot().error,'');
    children[1].emit('exit');service.configure({pushToTalkEnabled:false,pushToTalkKey:'F2'});assert.equal(timers.size,0);assert.equal(service.snapshot().held,false);
  } finally {service.stop();}
});
test('Wardrobe settings accept only built-in avatars, safe colours and supported details', () => {
  const { normalizeCompanion } = require('../electron/companion');
  assert.deepEqual(normalizeCompanion(null), { avatarId: 'puff', styles: {} });
  const input = { avatarId: 'nori', styles: { nori: { color: '#f0a6ca', accent: '#765593', accessory: 'bow', markings: 'freckles' }, fenn: { color: '#000000', accent: '#ffffff', accessory: 'scarf', markings: 'plain' }, alien: { color: '#111111' } } };
  const result = normalizeCompanion(input);
  assert.equal(result.avatarId, 'nori'); assert.equal(result.styles.nori.color, '#F0A6CA'); assert.equal(result.styles.fenn.color, '#000000');
  assert.equal(result.styles.alien, undefined); assert.equal(input.styles.nori.color, '#f0a6ca');
  assert.deepEqual(normalizeCompanion({ avatarId: '__proto__', styles: { sprout: { color: 'url(https://invalid)', accessory: '<svg>', markings: {} } } }), { avatarId: 'puff', styles: { sprout: { color: '#A6D7A0', accent: '#487C64', accessory: 'none', markings: 'cheeks' } } });
});
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
test('Productivity broadcasts reach the companion and standalone window without a stale window reference', () => {
  const source = fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8');
  const start = source.indexOf('function broadcastToProductivity('), end = source.indexOf('\nlet lastDistractionAlertTime',start);
  const sent = [];
  const window = id => ({isDestroyed:()=>false,webContents:{send:(...args)=>sent.push([id,...args])}});
  const scope = {productivityWin:window('productivity'),overlayWin:window('companion')};
  vm.runInNewContext(source.slice(start,end),scope);
  scope.broadcastToProductivity('tracking-update',{seconds:4});
  assert.deepEqual(sent.map(event=>event[0]),['productivity','companion']);
  scope.productivityWin=null; scope.overlayWin=null;
  scope.broadcastToProductivity('tracking-update',{});
});
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

test('Open project sync uses role IDs without auth and ignores stale subscriptions',async()=>{
  const clients=[];
  const createClient=()=>{
    const client={};
    client.channel=(name,options)=>{const ch={name,options,handlers:[],owner:client,on:(kind,filter,fn)=>{ch.handlers.push({kind,filter,fn});return ch;},subscribe:fn=>{ch.subscribed=fn;return ch;},track:async()=>{},untrack:()=>{},send:async packet=>{client.packet=packet;return 'ok';}};(client.channels||=[]).push(ch);return ch;};
    client.from=()=>({select:()=>({limit:async()=>({})})});
    client.removeChannel=()=>{};clients.push(client);return client;
  };
  const sync=load('electron/supabase.js',{'@supabase/supabase-js':{createClient}}),statuses=[];
  const options={url:'https://example.invalid',key:'test-key',channelName:'pair',onStatus:s=>statuses.push(s)};
  await sync.initSupabase({...options,userRole:'me'});
  await sync.initSupabase({...options,userRole:'her'});
  assert.equal(clients[1].channels[0].options.config.private,undefined);
  await clients[0].channels[0].subscribed('SUBSCRIBED');assert.equal(statuses.length,0);
  await clients[1].channels[0].subscribed('SUBSCRIBED');assert.equal(statuses[0].connected,true);
  assert.equal(await sync.broadcastMusicSignal({type:'probe'}),true);
  assert.equal(clients[1].packet.payload.senderId,'her');assert.equal(clients[1].packet.payload.recipientId,'me');
  assert.equal((await sync.checkCloudStorageReady(options)).ready,true);sync.disconnectSupabase();
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
