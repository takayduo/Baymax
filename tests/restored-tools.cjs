const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {EngineBridge}=require('../electron/engineBridge');
const {runActionConversation}=require('../electron/actionConversation');
const source=fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8');
const tools=['computer_control','browser_control','open_app','close_app','desktop_control','computer_settings','file_controller','file_processor','web_search','youtube_video','weather_report','flight_finder','game_updater','video_player','reminder','send_message','code_helper','dev_agent'];

test('All eighteen skills remain exposed; paid accounts can use every registered skill',()=>{
  const panel=fs.readFileSync(path.join(__dirname,'../src/settings/panel.ts'),'utf8');
  const metadata=panel.slice(panel.indexOf('const ACTIONS_METADATA:'),panel.indexOf('let audioInputs:'));
  assert.deepEqual([...metadata.matchAll(/key: "(\w+)"/g)].map(m=>m[1]),tools);
  assert.doesNotMatch(metadata,/\.filter\(|\.splice\(/);
  const {AccountService}=require('../electron/account');
  const instance=Object.create(AccountService.prototype);instance.config={supabaseUrl:''};instance.now=Date.now;
  for(const name of [...tools,'undo','system_status','my_registered_plugin'])assert.doesNotThrow(()=>instance.guardAction(name,{}),name);
});

function bridgeFixture(){
  const children=[],writes=[],kills=[];
  const bridge=new EngineBridge({timeoutMs:1000,spawn:()=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
    child.stdin.write=data=>writes.push(JSON.parse(data));children.push(child);return child;
  },terminate:async proc=>{kills.push(proc);}});
  return {bridge,children,writes,kills,reply:value=>children.at(-1).stdout.emit('data',Buffer.from(JSON.stringify(value)+'\n'))};
}
test('Action worker retains one process, serializes calls, correlates results, and never replays failures',async()=>{
  const f=bridgeFixture();const a=f.bridge.request({cmd:'execute',name:'browser_control',parameters:{action:'go_to'}}),b=f.bridge.request({cmd:'execute',name:'browser_control',parameters:{action:'get_text'}});
  assert.equal(f.children.length,1);assert.equal(f.writes.length,1);
  f.reply({id:999,success:true});assert.equal(f.writes.length,1);
  f.reply({id:f.writes[0].id,success:true,result:'Opened'});assert.equal((await a).result,'Opened');assert.equal(f.writes.length,2);
  f.children[0].emit('error',new Error('broken'));assert.equal((await b).success,false);await f.bridge.stop();
  const c=f.bridge.request({cmd:'list-actions'});assert.equal(f.children.length,2);
  f.children[0].emit('close',1);f.reply({id:f.writes[2].id,success:true,actions:[]});assert.equal((await c).success,true);await f.bridge.stop();
  assert.equal(f.writes.filter(w=>w.name==='browser_control').length,2);
});
test('Tool conversations inspect results, continue steps, refuse repeats and respect cancellation',async()=>{
  const calls=[],histories=[];const replies=['[TOOL: {"name":"browser_control","parameters":{"action":"get_text"}}]','[TOOL: {"name":"browser_control","parameters":{"action":"click","text":"Play"}}]','Playback started.'];
  const result=await runActionConversation({request:async h=>{histories.push(structuredClone(h));return replies.shift();},execute:async s=>{calls.push(s);return 'Verified tool result';}});
  assert.equal(result.text,'Playback started.');assert.equal(calls.length,2);assert.match(histories[1][1].text,/untrusted data/);
  let count=0;const repeat=await runActionConversation({request:async()=> '[LAUNCH: spotify]',execute:async()=>{count++;return 'Opened Spotify';}});
  assert.equal(count,1);assert.match(repeat.text,/repeated action/);
  const controller=new AbortController();controller.abort();await assert.rejects(runActionConversation({signal:controller.signal,request:async()=>assert.fail('cancelled'),execute:async()=>{}}),/abort/i);
});
test('Text action dispatch honors disabled skills and routes explicit YouTube separately from default built-in music',async()=>{
  const calls=[],scope={activeSettings:{userRole:'me',activeActions:{}},account:{guardAction(){}},
    getEngineToolDeclarations:async()=>tools.map(name=>({name})),actionBridge:{stop:async()=>{}},
    runMochiBridgeCmd:async(...args)=>{calls.push(args);return {success:true,result:'done'};},
    handleEngineAction:async(...args)=>{calls.push(args);return 'playing in Baymax';},require,URL};
  vm.createContext(scope);
  vm.runInContext("const {parseActionTags,resolveRole}=require('../electron/actionTags');\n"+source.slice(source.indexOf('async function executeRegisteredAction('),source.indexOf('// ── Gemini REST Engine')),scope);
  await scope.executeActionTags('[APP: {"action":"music","command":"play","query":"Test song"}]');
  assert.equal(calls[0][0],'control_app');assert.equal(calls[0][1].query,'Test song');
  await scope.executeActionTags('[PLAY_YOUTUBE: Test song]');assert.equal(calls[1][1],'youtube_video');
  await scope.executeActionTags('[TOOL: {"name":"open_app","parameters":{"app_name":"Spotify"}}]');assert.equal(JSON.parse(calls[2][2]).app_name,'Spotify');
  scope.activeSettings.activeActions.open_app=false;
  await assert.rejects(scope.executeActionTags('[LAUNCH: Spotify]'),/disabled/);
  await assert.rejects(scope.executeRegisteredAction('invented_tool',{}),/unavailable/);
  assert.equal(calls.length,3);
});
test('Account refresh reconnects changed pairs once, without ending stable remote sessions',()=>{
  const handlers={},calls={sync:0,end:0,history:0};
  const scope={account:{on:(name,fn)=>handlers[name]=fn},activeRemoteRole:'host',remoteSession:{current:()=>({}),end:()=>calls.end++},pendingViewerSignals:[],
    closeRemoteViewerWindow(){},stopInputInjector(){},setHostDisplayBounds(){},activeSettings:{},cachedEngineTools:null,
    overlayWin:{isDestroyed:()=>false,webContents:{send:name=>{if(name==='partner-chat-history')calls.history++;}}},settingsWin:null,
    stopMochiLiveEngine:async()=>{},startMochiLiveEngine(){},app:{isReady:()=>true},productivityTracker:null,productivityBlocker:null,
    loadSchedule:()=>[],loadChatHistory:()=>[],startSupabaseSync:()=>calls.sync++,secrets:{publicSettings:s=>s}};
  vm.createContext(scope);vm.runInContext(source.slice(source.indexOf("let cloudConnectionKey="),source.indexOf("account.on('partner-invite-received'")),scope);
  const state={configured:true,config:{supabaseUrl:'test'},user:{id:'alice'},pair:{id:'p1',channel_token:'one',members:[]},capabilities:{cloud:true,pcControl:true,gemini:true,productivity:true}};
  handlers.changed(state);assert.equal(calls.sync,1);assert.equal(calls.end,1);
  handlers.changed(structuredClone(state));assert.equal(calls.sync,1);assert.equal(calls.end,1);
  state.pair.channel_token='two';handlers.changed(state);assert.equal(calls.sync,2);assert.equal(calls.end,2);assert.equal(calls.history,2);
});
test('Private account subscription authenticates first and ignores superseded logins',async()=>{
  const {AccountService}=require('../electron/account');let auth=[],channels=[],unsubs=[];
  const instance=Object.create(AccountService.prototype);instance.config={supabaseUrl:'test'};instance.saved={user:{id:'alice'}};
  instance.realtimeClient={realtime:{setAuth:async token=>auth.push(token)},channel:(name,options)=>{
    const c={topic:'realtime:'+name,on(){return c;},subscribe(){}};channels.push({name,options});return c;
  },removeChannel:async c=>unsubs.push(c)};
  let resolveToken;instance.token=()=>new Promise(r=>resolveToken=r);
  const first=instance.startUserChannel();instance.stopUserChannel();resolveToken('stale');await first;assert.equal(channels.length,0);
  instance.token=async()=>{throw Error('expired');};await instance.startUserChannel();assert.equal(channels.length,0);
  instance.token=async()=> 'fresh';await instance.startUserChannel();assert.deepEqual(auth,['fresh']);assert.equal(channels[0].options.config.private,true);
  await instance.startUserChannel();assert.equal(channels.length,1);instance.stopUserChannel();assert.equal(unsubs.length,1);
});
test('Video sources are media URLs or existing files, never executable URL schemes',()=>{
  const {mediaURL}=require('../electron/videoPlayer');
  for(const value of ['javascript:alert(1)','data:text/html,evil','https://user:password@example.com/x'])assert.throws(()=>mediaURL(value));
  assert.equal(mediaURL('https://example.com/a.mp4'),'https://example.com/a.mp4');
  assert.match(mediaURL(path.join(__dirname,'../public/sounds/pop.wav')),/^file:/);
});
