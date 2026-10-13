const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8');

test('Engine replacement waits for tree termination; stale events and cancelled retries never spawn a second engine', async () => {
  const children = [], kills = [], events = [], timers = new Map(); let id = 0;
  const scope = {
    account:{caps:{gemini:true}},
    path, process: {env:{}}, console:{log(){},warn(){},error(){}}, engineDir:'G:\\baymax\\engine',
    activeSettings:{aiProvider:'gemini',geminiApiKey:'test'}, isQuitting:false, liveUserStopped:false, voiceCallActive:false,
    syncEngineConfig(){}, resolvePythonPath:()=> 'python.exe',engineArgs:()=>['mochi_runner.py'],
    displayAssistantName:()=> 'Baymax', handleLiveEngineEvent:msg=>events.push(msg),
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),
    terminateProcessTree:proc=>new Promise(resolve=>kills.push({proc,resolve})),
    spawn:(_file,_args,options)=>{
      const p = new EventEmitter(); p.pid=100+children.length;p.exitCode=null;p.signalCode=null;
      p.options=options;
      p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin=new EventEmitter();p.stdin.write=()=>{};
      children.push(p);return p;
    },
  };
  vm.createContext(scope);
  vm.runInContext(`let mochiLiveProc=null,mochiLiveRestartTimer=null,mochiLiveStopPromise=null,mochiLiveStartRequested=false; const intentionallyStoppedLiveProcesses=new WeakSet(); let pendingTextResolvers=[];`,scope);
  vm.runInContext(source.slice(source.indexOf('function startMochiLiveEngine()'),source.indexOf('function handleLiveEngineEvent(')),scope);
  const active=()=>vm.runInContext('mochiLiveProc',scope);
  scope.startMochiLiveEngine(); const first=active();
  scope.liveUserStopped=true;
  const stopping=scope.stopMochiLiveEngine(); scope.startMochiLiveEngine(); scope.startMochiLiveEngine();
  assert.equal(children.length,1);assert.equal(kills[0].proc,first);
  first.exitCode=0;kills[0].resolve();await stopping;
  const second=active();assert.equal(children.length,2);assert.notEqual(first,second);
  assert.equal(first.options.env.BAYMAX_SPEECH_STOPPED,'0');
  assert.equal(second.options.env.BAYMAX_SPEECH_STOPPED,'1');
  first.emit('close',0);first.emit('error',new Error('late error'));first.stdout.emit('data',Buffer.from('MOCHI_IPC:{"event":"ready"}\n'));
  assert.equal(active(),second);assert.equal(timers.size,0);assert.equal(events.length,0);
  second.exitCode=1;second.emit('close',1);assert.equal(active(),null);assert.equal(timers.size,1);
  await scope.stopMochiLiveEngine();assert.equal(timers.size,0);
  assert.equal(scope.sendToLiveEngine({cmd:'mute',muted:false}),false);assert.equal(children.length,2);
  scope.startMochiLiveEngine();scope.isQuitting=true;
  const quitting=scope.stopMochiLiveEngine();scope.startMochiLiveEngine();kills[1].resolve();await quitting;
  assert.equal(children.length,3);assert.equal(active(),null);
});

test('Windows voice shutdown targets only the owned PID and its descendants', async () => {
  const { terminateProcessTree }=require('../electron/processTree');let invocation;
  await terminateProcessTree({pid:321,exitCode:null}, {platform:'win32',execFile:(file,args,options,done)=>{invocation={file,args,options};done(null);}});
  assert.deepEqual(invocation.args,['/PID','321','/T','/F']);assert.equal(invocation.options.windowsHide,true);
  await assert.rejects(terminateProcessTree({pid:322,exitCode:null}, {platform:'win32',execFile:(_f,_a,_o,done)=>done(new Error('access denied'))}), /Could not stop/);
});

test('Saving push-to-talk ON, OFF or a different key configures the existing Gemini engine without restarting', () => {
  const sent=[], starts=[],stops=[];let save;
  const scope={
    account:{configured:false},
    ipcMain:{handle:(_channel,fn)=>{save=fn;}},activeSettings:{aiProvider:'gemini',geminiApiKey:'test',assistantName:'Baymax',pushToTalkEnabled:false,pushToTalkKey:'Control+Space'},
    secrets:{mergeSettings:(old,patch)=>({...old,...patch}),publicSettings:s=>s},
    ...require('../electron/pushToTalk'),...require('../electron/companion'),
    saveSettings(){},talkShortcut:{configure(){},snapshot:()=>({held:false,suspended:false})},cachedMarkLvTools:null,
    tray:null,overlayWin:null,displayAssistantName:()=> 'Baymax',syncEngineConfig(){},applyStartupMode(){},startSupabaseSync(){},
    mochiLiveProc:{},startMochiLiveEngine:()=>starts.push(1),stopMochiLiveEngine:()=>stops.push(1),sendToLiveEngine:message=>sent.push(message),console,
  };
  const start=source.indexOf('ipcMain.handle("save-settings"'),end=source.indexOf('ipcMain.handle("test-supabase"',start);
  vm.runInNewContext(source.slice(start,end),scope);
  for(const patch of [{pushToTalkEnabled:true},{pushToTalkKey:'F2'},{pushToTalkEnabled:false}]) save({},patch);
  assert.equal(starts.length,0);assert.equal(stops.length,0);
  assert.deepEqual(sent.filter(s=>s.cmd==='ptt_config').map(s=>s.enabled),[true,true,false]);
  sent.length = 0;
  save({}, {proactiveTalkingEnabled:true,userInterests:'  YouTube growth, editing  '});
  save({}, {proactiveTalkingEnabled:false});
  assert.equal(starts.length,0); assert.equal(stops.length,0);
  assert.deepEqual(sent.filter(s=>s.cmd==='proactive_config').map(s=>[s.enabled,s.interests]),
    [[true,'YouTube growth, editing'],[false,'YouTube growth, editing']]);
});

test('Interrupted engine events cannot reopen the mouth until new speech is authorized', () => {
  const sent=[];
  const scope={voiceCallActive:false,overlayWin:{isDestroyed:()=>false,webContents:{send:(...args)=>sent.push(args)}},pendingTextResolvers:[]};
  vm.createContext(scope);
  const resetStart=source.indexOf('let liveOutputSuppressed = false;');
  vm.runInContext(source.slice(resetStart, source.indexOf('const talkShortcut =',resetStart)),scope);
  const handlerStart=source.indexOf('function handleLiveEngineEvent(');
  vm.runInContext(source.slice(handlerStart,source.indexOf('async function deliverMessage(',handlerStart)),scope);
  scope.resetLiveSpeechOutput();
  scope.handleLiveEngineEvent({event:'speech_allowed'}); // Delayed pre-click background event.
  scope.handleLiveEngineEvent({event:'state',state:'SPEAKING'});
  scope.handleLiveEngineEvent({event:'audio_level',level:1});
  scope.handleLiveEngineEvent({event:'transcript',role:'assistant',text:'stale'});
  assert.ok(!sent.some(([name,value])=>name==='ai-state' && value==='speaking'));
  assert.ok(!sent.some(([name])=>name==='ai-transcript'));
  assert.equal(sent.at(-1)[1],0);
  scope.handleLiveEngineEvent({event:'user_turn'});
  scope.handleLiveEngineEvent({event:'state',state:'SPEAKING'});
  assert.deepEqual(sent.at(-1),['ai-state','speaking']);
});

test('Settings interests sync preserves existing local memories and supports clearing', () => {
  const {syncInterestsMemory}=require('../electron/interests');
  const folder=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'baymax-interests-'));
  try {
    fs.mkdirSync(path.join(folder,'memory'));
    const file=path.join(folder,'memory/long_term.json');
    fs.writeFileSync(file,JSON.stringify({identity:{name:{value:'Owner'}},preferences:{theme:{value:'dark'}}}));
    syncInterestsMemory(folder,'psychology, lifestyle');
    let saved=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(saved.identity.name.value,'Owner'); assert.equal(saved.preferences.theme.value,'dark');
    assert.equal(saved.preferences.user_interests.value,'psychology, lifestyle');
    syncInterestsMemory(folder,'');
    saved=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(saved.preferences.user_interests.value,'');
  } finally { fs.rmSync(folder,{recursive:true,force:true}); }
});
