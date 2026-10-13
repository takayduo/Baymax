const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const main=fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8');
test('Duplicate partner deliveries return before UI events and desktop notifications',()=>{
  const history=[{id:'same'}],events=[];
  const scope={history,events,currentUserName:'Me',partnerUserName:'Partner',activeSettings:{userRole:'me'},console:{log(){}},loadChatHistory:()=>history,saveChatHistory(){},overlayWin:{isDestroyed:()=>false,isFocused:()=>true,webContents:{send:(...a)=>events.push(a)}},isCollapsed:false};
  const start=main.indexOf('    onChatMessage: (payload) => {'),end=main.indexOf('    onFileShared:',start);
  const fn=vm.runInNewContext('('+main.slice(start,end).trim().replace(/^onChatMessage: /,'').replace(/,$/,'')+')',scope);
  fn({id:'same',text:'Old',sender:'Partner'});assert.equal(events.length,0);assert.equal(history.length,1);
  fn({id:'new',text:'New',sender:'Partner'});assert.equal(events.length,1);assert.equal(history.length,2);
});
test('Outbox cloud retries never re-broadcast messages already delivered live',async()=>{
  let broadcast=0,events=0,cloud=false;const history=[];
  const scope={saveChatMessageToCloud:async()=>cloud,activeSettings:{shareChannel:'test'},broadcastChatMessage:async()=>{broadcast++;return true;},loadChatHistory:()=>history,saveChatHistory(){},overlayWin:{webContents:{send(){events++;}}}};
  vm.createContext(scope);vm.runInContext(main.slice(main.indexOf('async function deliverMessage('),main.indexOf('let flushingOutbox')),scope);
  const msg={id:'test',delivery:'pending'};await scope.deliverMessage(msg);await scope.deliverMessage(msg);cloud=true;await scope.deliverMessage(msg);
  assert.equal(broadcast,1);assert.equal(msg.delivery,'stored');assert.equal(msg.cloudPending,false);assert.equal(history.length,1);assert.equal(events,3);
  await scope.deliverMessage({id:'legacy',delivery:'sent',cloudPending:true});assert.equal(broadcast,1);
});
test('Live chat is delivered before storage, and cloud writes use only existing message columns',async()=>{
  const order=[],history=[];
  const scope={saveChatMessageToCloud:async()=>{order.push('cloud');return true;},activeSettings:{shareChannel:'test'},broadcastChatMessage:async()=>{order.push('live');return true;},loadChatHistory:()=>history,saveChatHistory(){},overlayWin:{webContents:{send(){}}}};
  vm.createContext(scope);vm.runInContext(main.slice(main.indexOf('async function deliverMessage('),main.indexOf('let flushingOutbox')),scope);
  await scope.deliverMessage({id:'test'});assert.deepEqual(order,['live','cloud']);
  const source=fs.readFileSync(path.join(__dirname,'../electron/supabase.js'),'utf8');let saved;
  const cloudScope={supabaseClient:{from:()=>({upsert:async row=>{saved=row;return {error:null};}})}};
  const start=source.indexOf('async function saveChatMessageToCloud('),end=source.indexOf('/**',start);
  vm.createContext(cloudScope);vm.runInContext(source.slice(start,end),cloudScope);
  assert.equal(await cloudScope.saveChatMessageToCloud({id:'id',sender:'A',senderRole:'me',recipient:'B',text:'hello'}),true);
  assert.deepEqual(Object.keys(saved).sort(),['channel','id','is_ai_generated','read','recipient','sender','text','timestamp']);
});
test('Focus success clears repeated warnings even while notifications are throttled; transient failures cancel warnings',()=>{
  const events=[],jobs=[];let notices=0;
  const source=fs.readFileSync(path.join(__dirname,'../electron/productivity/blocker.js'),'utf8'),module={exports:{}};
  const requireMock=name=>name==='electron'?{Notification:class {static isSupported(){return true;}show(){notices++;}}}:name==='node:child_process'?{execFile:(_f,_a,_o,done)=>jobs.push(done)}:{DEFAULT_CATEGORIES:{}};
  vm.runInNewContext(source,{require:requireMock,module,exports:module.exports,console:{log(){},warn(){}},setTimeout:()=>1,Date});
  const blocker=new module.exports.AppBlocker({get:()=>({notifications:true})},(...event)=>events.push(event));blocker.tick=()=>{};blocker.isActive=true;blocker.phase='work';
  blocker.forceKillProcess('chrome');jobs.shift()(null,'','');blocker.forceKillProcess('chrome');jobs.shift()(null,'','');
  assert.equal(events.filter(e=>e[0]==='app-blocked').length,2);assert.equal(notices,1);
  blocker.forceKillProcess('firefox');jobs.shift()(new Error('not found'),'','');assert.equal(events.at(-1)[0],'app-close-warning-cancelled');assert.equal(blocker.failedKills.has('firefox'),false);
  blocker.forceKillProcess('firefox');jobs.shift()(new Error('access denied'),'','');assert.equal(events.at(-1)[0],'app-block-failed-privilege');assert.equal(blocker.failedKills.has('firefox'),true);
});
test('Call signaling allowlist bounds metadata and rejects cloud audio, levels, controls and malformed SDP',()=>{
  const {cleanVoiceSignal}=require('../electron/voiceCall');
  for(const type of ['audio','level','mute','appearance','arbitrary'])assert.throws(()=>cleanVoiceSignal({type,sessionId:'ok'}));
  const ring=cleanVoiceSignal({type:'ring',sessionId:'ok',audio:'private',appearance:{companion:{avatarId:'puff',styles:{puff:{color:'#ffccdd'},neko:{color:'#ffffff'}}},headphones:true}});
  assert.equal(ring.audio,undefined);assert.deepEqual(Object.keys(ring.appearance.companion.styles),['puff']);assert.equal(ring.appearance.companion.styles.puff.color,'#FFCCDD');
  assert.throws(()=>cleanVoiceSignal({type:'offer',sessionId:'ok',sdp:'not SDP'}));assert.equal(cleanVoiceSignal({type:'hangup',sessionId:'ok'}).type,'hangup');
});
test('AI call lock overrides mic toggles and blocks attempts to reopen speech until hangup',()=>{
  const sent=[];const scope={voiceCallActive:true,mochiLiveProc:{stdin:{write:value=>sent.push(JSON.parse(value))}},console};
  vm.createContext(scope);vm.runInContext(main.slice(main.indexOf('function sendToLiveEngine('),main.indexOf('function handleLiveEngineEvent(')),scope);
  scope.sendToLiveEngine({cmd:'mute',muted:false});assert.equal(sent.at(-1).muted,true);
  assert.equal(scope.sendToLiveEngine({cmd:'user_turn'}),false);assert.equal(scope.sendToLiveEngine({cmd:'background',text:'hello'}),false);
  scope.voiceCallActive=false;scope.sendToLiveEngine({cmd:'mute',muted:false});assert.equal(sent.at(-1).muted,false);
});
test('Quit sends music leave, status and call hangup before disconnecting the partner channel',async()=>{
  const events=[];let release;const pending=new Promise(resolve=>release=resolve);
  const scope={musicSession:'music-test',voiceCallSession:'voice-test',voiceCallActive:true,setTimeout,
    broadcastMusicSignal:async msg=>{events.push(msg);await pending;},broadcastVoiceSignal:async msg=>{events.push(msg);await pending;},disconnectSupabase:async()=>events.push('disconnect')};
  vm.createContext(scope);vm.runInContext(main.slice(main.indexOf('async function endPartnerSessions()'),main.indexOf('const engineArgs')),scope);
  const stopping=scope.endPartnerSessions();assert.equal(events.length,3);assert.equal(events.some(e=>e==='disconnect'),false);
  release();await stopping;assert.deepEqual(events.slice(0,3).map(e=>e.type),['status','leave','hangup']);assert.equal(events.at(-1),'disconnect');assert.equal(scope.voiceCallActive,false);
});
