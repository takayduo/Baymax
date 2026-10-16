const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {AccountService}=require('../electron/account');
const {CloudTransport}=require('../electron/cloudTransport');
const {RealtimeChannel}=require('../electron/realtimeChannel');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const BASE=Date.parse('2026-10-17T00:00:00Z');

function fixture(){
 let now=BASE,refreshes=0,network=true,rows=[];
 const clients=[],presence=[],statuses=[],music=[],received=[];
 const pair={id:'pair',backend_kind:'cloud',channel_token:'secret-topic',cloudEligible:true,members:[{userId:'alice',slot:1},{userId:'bella',slot:2}]};
 const account=new EventEmitter();Object.setPrototypeOf(account,AccountService.prototype);
 Object.assign(account,{generation:0,config:{supabaseUrl:'https://fixture.supabase.co',supabaseAnonKey:'public'},error:'',now:()=>now,persist(){},
  saved:{user:{id:'alice'},verifiedAt:now,session:{access_token:'token-0',refresh_token:'refresh-0',expires_at:now/1000+3600},
   snapshot:{profile:{username:'alice'},pair,entitlement:{plan:'duo',periodEnd:'infinity'},invites:[]}},
  fetchJSON:async()=>{if(!network)throw Error('offline');return {access_token:'token-'+(++refreshes),refresh_token:'refresh-'+refreshes,expires_in:3600};},
  rest:async resource=>{if(!network)throw Error('offline');return resource.startsWith('messages?')?rows:[];},
  rpc:async()=>{if(!network)throw Error('offline');return true;},
 });
 function createClient(_url,_key,options){
  const client={options,auth:[],removed:0,disconnected:0,channels:[],
   realtime:{setAuth:async token=>{if(!network)throw Error('offline');client.auth.push(token);},disconnect:async()=>{client.disconnected++;}},
   removeAllChannels:async()=>{client.removed++;for(const channel of client.channels)channel.status?.('CLOSED');},
   channel:(topic,config)=>{
    const handlers={};const channel={topic:'realtime:'+topic,config,handlers,
     on(_kind,{event},fn){handlers[event]=fn;return channel;},
     subscribe(fn){channel.status=fn;fn(network?'SUBSCRIBED':'CHANNEL_ERROR');return channel;},
    };client.channels.push(channel);return channel;
   },
  };clients.push(client);return client;
 }
 account.ensureRealtimeClient=options=>createClient(null,null,options);
 const transport=new CloudTransport({createClientImpl:createClient,now:()=>now,random:()=>0});
 const callbacks={onPresenceSync:value=>presence.push(Object.keys(value).length>0),onStatus:value=>statuses.push(value),onMusicSignal:value=>music.push(value),onChatMessage:value=>received.push(value)};
 const packet=(kind,value)=>({senderId:'bella',kind,value,at:now});
 return {account,transport,clients,presence,statuses,music,received,pair,callbacks,createClient,packet,
  advance:ms=>now+=ms,now:()=>now,refreshes:()=>refreshes,network:value=>network=value,
  rows:value=>rows=value,beat:()=>clients.forEach(c=>{if(!c.disconnected)c.options.realtime.heartbeatCallback('ok');}),
  stop:async()=>{account.stopUserChannel();await transport.stop();await flush();},
 };
}

test('24 simulated hours rotate JWTs on both private sockets without restarting or dropping presence',async t=>{
 const f=fixture();t.after(()=>f.stop());
 await f.account.startUserChannel();await f.transport.start(f.account,f.callbacks);await flush();
 f.transport.receive(f.packet('presence',{online:true}));const begin=f.presence.length;
 for(let i=0;i<24*60*4;i++){
  f.advance(15000);f.beat();
  f.account.userRealtime.tick();f.transport.live.tick();
  if(i%2===0)f.transport.receive(f.packet('presence',{online:true}));
  await flush();
 }
 assert.ok(f.refreshes()>=24);assert.equal(f.clients.length,2);
 for(const client of f.clients){assert.ok(new Set(client.auth).size>=25);assert.equal(client.auth.at(-1),f.account.saved.session.access_token);assert.equal(client.channels[0].config.config.private,true);}
 assert.ok(!f.presence.slice(begin).includes(false));
 assert.equal(f.account.listenerCount('token-refreshed'),2);
});

test('Channel error/timeout/closed self-heal with fresh auth; old callbacks cannot end the new connection',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const f=fixture();t.after(()=>f.stop());
 await f.transport.start(f.account,f.callbacks);await flush();f.transport.receive(f.packet('presence',{online:true}));const begin=f.presence.length;
 for(const status of ['CHANNEL_ERROR','TIMED_OUT','CLOSED']){
  const old=f.clients.at(-1),channel=old.channels[0];channel.status(status);await flush();
  assert.equal(f.transport.mainChannel,null);
  t.mock.timers.tick(1999);await flush();assert.equal(f.clients.at(-1),old);
  t.mock.timers.tick(1);await flush();assert.notEqual(f.clients.at(-1),old);
  const current=f.transport.mainChannel;
  channel.status('CLOSED');channel.handlers.partner({payload:f.packet('presence',{online:false})});await flush();
  assert.equal(f.transport.mainChannel,current);assert.equal(f.clients.at(-1).auth.at(-1),'token-0');
 }
 assert.ok(!f.presence.slice(begin).includes(false));
 assert.equal(f.clients.filter(c=>!c.disconnected).length,1);
});

test('Heartbeat failure, silent socket stall and sleep/wake each rebuild the private channel',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const f=fixture();t.after(()=>f.stop());
 await f.transport.start(f.account,f.callbacks);await flush();
 f.clients.at(-1).options.realtime.heartbeatCallback('timeout');t.mock.timers.tick(2000);await flush();assert.equal(f.clients.length,2);
 for(let i=0;i<5;i++){f.advance(15000);f.transport.live.tick();await flush();}
 t.mock.timers.tick(2000);await flush();assert.equal(f.clients.length,3);
 f.advance(20*60000);f.transport.live.tick();t.mock.timers.tick(0);await flush();assert.equal(f.clients.length,4);
 assert.equal(f.clients.at(-1).auth.at(-1),await f.account.token());
});

test('Repeated auth failures back off, recover without restart, and stop permanently after explicit teardown',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const f=fixture();t.after(()=>f.stop());
 await f.transport.start(f.account,f.callbacks);await flush();
 f.network(false);f.account.saved.session.expires_at=1;f.clients.at(-1).channels[0].status('CHANNEL_ERROR');
 for(const delay of [2000,4000,8000,16000,30000]){t.mock.timers.tick(delay);await flush();}
 assert.deepEqual(f.statuses.filter(s=>s.retryInMs!==undefined).map(s=>s.retryInMs),[2000,4000,8000,16000,30000,30000]);
 f.network(true);await f.account.token();t.mock.timers.tick(2000);await flush();
 assert.equal(f.transport.live.connected,true);assert.equal(f.clients.at(-1).auth.at(-1),'token-1');
 f.clients.at(-1).channels[0].status('CLOSED');await f.stop();const count=f.clients.length;
 t.mock.timers.tick(120000);await flush();assert.equal(f.clients.length,count);assert.equal(f.account.listenerCount('token-refreshed'),0);
});

test('Recent partner database messages preserve liveness for two minutes; old history and own writes do not',async t=>{
 const f=fixture();t.after(()=>f.stop());await f.transport.start(f.account,f.callbacks);await flush();
 f.transport.receive(f.packet('presence',{online:true}));f.advance(70000);
 const created=f.now()-30000;f.rows([{id:'m',sender_id:'bella',body:'still here',created_at:new Date(created).toISOString()}]);
 await f.transport.sync();assert.equal(f.presence.at(-1),true);
 f.advance(89000);await f.transport.sync();assert.equal(f.presence.at(-1),true);
 f.advance(2000);await f.transport.sync();assert.equal(f.presence.at(-1),false);
 f.rows([{id:'mine',sender_id:'alice',body:'outgoing',created_at:new Date(f.now()).toISOString()}]);
 await f.transport.saveMessage({id:'mine',text:'outgoing'});await f.transport.sync();assert.equal(f.presence.at(-1),false);
 f.rows([{id:'new',sender_id:'bella',body:'back',created_at:new Date(f.now()).toISOString()}]);await f.transport.sync();assert.equal(f.presence.at(-1),true);
 f.transport.receive(f.packet('presence',{online:false}));await f.transport.sync();assert.equal(f.presence.at(-1),false);
});

test('Other valid partner traffic restores presence; unrelated senders cannot; revoked pairs stay stopped',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const f=fixture();t.after(()=>f.stop());await f.transport.start(f.account,f.callbacks);await flush();
 f.transport.receive({...f.packet('music',{type:'status'}),senderId:'stranger'});assert.notEqual(f.presence.at(-1),true);
 f.transport.receive(f.packet('chat-live',{id:'chat',text:'hello'}));assert.equal(f.presence.at(-1),true);assert.equal(f.received.length,1);
 const old=f.clients.at(-1).channels[0];old.status('CHANNEL_ERROR');f.account.saved.snapshot.pair=null;
 await f.transport.tick();t.mock.timers.tick(60000);await flush();
 assert.equal(f.presence.at(-1),false);assert.equal(f.clients.length,1);
 old.handlers.partner({payload:f.packet('music',{type:'status',playing:true})});assert.equal(f.music.length,0);
});

test('Refresh is single-flight and stale refreshes cannot overwrite a replacement login',async()=>{
 const f=fixture();f.account.saved.session.expires_at=1;
 await Promise.all([f.account.token(),f.account.token(),f.account.token()]);assert.equal(f.refreshes(),1);
 let finish;f.account.saved.session.expires_at=1;f.account.fetchJSON=()=>new Promise(r=>finish=r);
 const old=f.account.token();f.account.generation++;f.account.tokenRefresh=null;
 const replacement={access_token:'new-user',refresh_token:'new-refresh',expires_at:f.now()/1000+3600};f.account.saved.session=replacement;
 finish({access_token:'old-user',refresh_token:'old-refresh',expires_in:3600});await assert.rejects(old,/Account changed/);
 assert.equal(f.account.saved.session,replacement);assert.equal(await f.account.token(),'new-user');
});

test('Account topic reauthenticates and resubscribes after a server close without waiting for account polling',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const f=fixture();t.after(()=>f.stop());
 await f.account.startUserChannel();const old=f.clients[0];
 old.channels[0].status('CLOSED');f.account.saved.session.expires_at=1;
 t.mock.timers.tick(2500);await flush();
 assert.equal(f.clients.length,2);assert.equal(f.account.userRealtime.connected,true);
 assert.equal(f.account.userChannel.topic,'realtime:baymax:user:alice');assert.equal(f.clients[1].auth.at(-1),'token-1');
 old.channels[0].status('CHANNEL_ERROR');await flush();assert.equal(f.account.userRealtime.connected,true);
});

test('A stalled join is retried; stopping during authorization prevents a late subscription',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const f=fixture();t.after(()=>f.stop());
 const live=new RealtimeChannel({account:f.account,topic:'baymax:user:alice',bind:()=>{},random:()=>0,now:f.now,
  createClientImpl:(...args)=>{
   const client=f.createClient(...args),channel=client.channel;
   client.channel=(...values)=>{const result=channel(...values);result.subscribe=()=>result;return result;};return client;
  },
 });t.after(()=>live.stop());await live.start();
 t.mock.timers.tick(12000);await flush();assert.equal(live.connected,false);assert.equal(f.clients[0].disconnected,1);
 t.mock.timers.tick(2000);await flush();assert.equal(f.clients.length,2);await live.stop();
 let finish;f.account.token=()=>new Promise(r=>finish=r);
 const starting=live.start();await live.stop();finish('too-late');await starting;await flush();
 assert.equal(f.clients.length,2);assert.equal(f.account.listenerCount('token-refreshed'),0);
});

test('Database liveness uses server time and late task reads cannot modify a replacement transport',async t=>{
 const f=fixture();t.after(()=>f.stop());await f.transport.start(f.account,f.callbacks);await flush();
 f.account.serverClockOffset=300000;
 f.rows([{id:'clock',sender_id:'bella',body:'here',created_at:new Date(f.account.serverNow()-10000).toISOString()}]);
 await f.transport.sync();assert.equal(f.presence.at(-1),true);
 let finish;f.account.rest=()=>new Promise(r=>finish=r);
 const pending=f.transport.tasks();await f.transport.stop();
 finish([{id:'old-task',revision:42,body:{},updated_at:new Date(f.now()).toISOString()}]);
 assert.deepEqual(await pending,[]);assert.equal(f.transport.revisions.size,0);assert.equal(f.presence.at(-1),false);
});

test('A healthy music data channel survives cloud offline notices; a lost peer and revoked entitlement still leave',()=>{
 const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
 let allowed=true,leaves=0,notifies=0;
 const source=fs.readFileSync(path.join(__dirname,'../src/music/player.ts'),'utf8');
 const method=source.slice(source.indexOf('  presence(online:boolean){'),source.indexOf('  announce(force=false)'));
 const code=ts.transpile('class Fixture {'+method+'}',{target:ts.ScriptTarget.ES2022});
 const scope={allowed:()=>allowed,Date,Bridge:{musicSignal:()=>Promise.resolve(true)}};vm.createContext(scope);vm.runInContext(code+';this.Fixture=Fixture',scope);
 const player=new scope.Fixture();Object.assign(player,{peer:{healthy:true,leave:()=>leaves++},partner:{title:'song'},notify:()=>notifies++,announce(){}});
 player.presence(false);assert.equal(leaves,0);assert.equal(player.partner.title,'song');
 player.peer.healthy=false;player.presence(false);assert.equal(leaves,1);assert.equal(player.partner,null);
 player.peer.healthy=true;allowed=false;player.presence(false);assert.equal(leaves,2);
 const peerSource=fs.readFileSync(path.join(__dirname,'../src/music/peer.ts'),'utf8');
 const getter=peerSource.slice(peerSource.indexOf('  get healthy()'),peerSource.indexOf('  private owns'));
 vm.runInContext(ts.transpile('class PeerFixture {'+getter+'}',{target:ts.ScriptTarget.ES2022})+';this.PeerFixture=PeerFixture',scope);
 const peer=new scope.PeerFixture();Object.assign(peer,{state:'together',channel:{readyState:'open'},lastReceived:Date.now()});assert.equal(peer.healthy,true);
 peer.lastReceived-=13000;assert.equal(peer.healthy,false);peer.lastReceived=Date.now();peer.channel.readyState='closed';assert.equal(peer.healthy,false);
});
