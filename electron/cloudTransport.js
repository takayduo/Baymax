const {createClient}=require('@supabase/supabase-js');
const crypto=require('node:crypto');
function stableId(value){if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))return value;const h=crypto.createHash('sha256').update(String(value)).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
class CloudTransport {
 constructor(){this.generation=0;this.channels=[];this.mainChannel=null;this.timer=null;this.revisions=new Map();this.remoteAt=0;this.signalCursor=0;this.startAt=0;}
 async start(account,callbacks){
  await this.stop();this.account=account;this.callbacks=callbacks;this.pair=account.snapshot().pair;this.user=account.snapshot().user;
  if(!this.pair||!this.user)return false;const generation=this.generation;this.startAt=Date.now();
  if(this.pair.backend_kind==='cloud'){
   if(!account.caps.cloud){callbacks.onStatus?.({connected:false,error:'Both partners need Pro or Duo for Cloud'});return false;}
   this.client=createClient(account.config.supabaseUrl,account.config.supabaseAnonKey,{accessToken:()=>account.token(),auth:{persistSession:false}});
   try{const token=await account.token();if(generation!==this.generation)return false;await this.client.realtime.setAuth(token);}catch{
    if(generation===this.generation){
     callbacks.onStatus?.({connected:false,error:'Private sync authentication failed; reconnect to retry'});
     await this.stop();
     const retryGeneration=this.generation;
     this.retryTimer=setTimeout(()=>{
      if(retryGeneration===this.generation)void this.start(account,callbacks).catch(()=>{});
     },5000);this.retryTimer.unref?.();
    }
    return false;
   }
   if(generation!==this.generation)return false;
   if(!this.pair.channel_token){callbacks.onStatus?.({connected:false,error:'Apply the latest database migrations'});return false;}
   const channelName=`baymax:pair:${this.pair.id}:${this.pair.channel_token}`;
   const channel=this.client.channel(channelName,{config:{private:true}});
   this.mainChannel=channel;
   channel.on('broadcast',{event:'partner'},({payload})=>{if(generation===this.generation)this.receive(payload);});
   channel.on('broadcast',{event:'revoked'},()=>{if(generation===this.generation){void this.stop();void account.refresh();}});
   channel.subscribe(status=>{
    if(generation!==this.generation)return;
    if(status==='SUBSCRIBED'){
     callbacks.onStatus?.({connected:true});
     void this.signal('presence',{online:true});
    }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))callbacks.onStatus?.({connected:false,error:'Private sync reconnecting…'});
   });
   this.channels.push(channel);
  }else if(!this.pair.backend){callbacks.onStatus?.({connected:false,error:'Custom database is not verified'});return false;}
  const tick=async()=>{
   if(generation!==this.generation||this.pollGeneration===generation)return;this.pollGeneration=generation;
   try{
    if(this.pair.backend_kind==='custom'){
     const poll=await this.call({op:'poll',cursor:this.signalCursor});if(generation!==this.generation)return;
     this.signalCursor=poll.cursor;
     for(const item of poll.items||[])if(Date.parse(item.created_at)>=this.startAt-1000)this.receive({senderId:item.sender_id,kind:item.kind,value:item.value,at:Date.parse(item.created_at)});
    }
    if(!this.lastPulse||Date.now()-this.lastPulse>10000){this.lastPulse=Date.now();await this.signal('presence',{online:true});await this.sync();}
    if(this.remoteAt&&Date.now()-this.remoteAt>60000){this.remoteAt=0;callbacks.onPresenceSync?.({});}
   }catch(error){callbacks.onStatus?.({connected:false,error:error.message});}finally{if(this.pollGeneration===generation)this.pollGeneration=null;}
  };
  this.timer=setInterval(()=>void tick(),3000);this.timer.unref?.();void tick();return true;
 }
 async stop(){
  clearTimeout(this.retryTimer);this.retryTimer=null;
  ++this.generation;clearInterval(this.timer);this.timer=null;
  this.mainChannel=null;this.remoteAt=0;this.signalCursor=0;this.lastPulse=0;this.polling=false;this.revisions.clear();const client=this.client,channels=this.channels;this.client=null;this.channels=[];await Promise.allSettled(channels.map(c=>client?.removeChannel(c)));this.callbacks?.onPresenceSync?.({});
 }
 async call(payload){
  const pair=this.account?.snapshot().pair;if(!pair||pair.id!==this.pair?.id)throw new Error('Partner connection changed');
  if(pair.backend_kind==='cloud')throw new Error('Unsupported Cloud operation');
  const backend=pair.backend;if(!backend)throw new Error('Custom database unavailable');
  return this.account.fetchJSON(backend.endpoint,{method:'POST',headers:{apikey:backend.publicKey,authorization:'Bearer '+await this.account.token()},body:JSON.stringify({...payload,pairId:pair.id,backendId:backend.id})});
 }
 local(){return this.pair.members.find(m=>m.userId===this.user.id);}
 other(){return this.pair.members.find(m=>m.userId!==this.user.id);}
 chat(row){const author=this.pair.members.find(m=>m.userId===row.sender_id);return {id:row.id,sender:author?.displayName||author?.username||'Partner',senderRole:author?.slot===1?'me':'her',recipient:this.user.displayName||'',text:row.body,timestamp:Date.parse(row.created_at),read:false,delivery:'stored',cloudPending:false};}
 task(row){this.revisions.set(row.id,row.revision);return {...row.body,id:row.id,syncPairId:this.pair?.id,deleted:!!row.deleted_at,updatedAt:Date.parse(row.updated_at),cloudRevision:row.revision};}
 async all(op){const items=[];let cursor=null;const seen=new Set();do{const page=await this.call({op,cursor});if(!Array.isArray(page?.items))throw new Error('Invalid database response');items.push(...page.items);cursor=page.cursor;if(cursor&&seen.has(cursor))throw new Error('Invalid pagination cursor');seen.add(cursor);}while(cursor);return items;}
 async rows(table){
  const rows=[];let last=null;
  for(;;){const page=await this.account.rest(table+'?pair_id=eq.'+encodeURIComponent(this.pair.id)+'&order=id.asc&limit=500'+(last?'&id=gt.'+last:''));
   if(!Array.isArray(page))throw new Error('Invalid database response');rows.push(...page);if(page.length<500)return rows;
   const next=page.at(-1)?.id;if(!next||next===last)throw new Error('Invalid database cursor');last=encodeURIComponent(next);
  }
 }
 async messages(){return (this.pair?.backend_kind==='cloud'?await this.rows('messages'):await this.all('messages')).map(row=>this.chat(row)).sort((a,b)=>a.timestamp-b.timestamp);}
 async tasks(){return (this.pair?.backend_kind==='cloud'?await this.rows('tasks'):await this.all('tasks')).map(row=>this.task(row));}
 async sync(){const generation=this.generation;const [messages,tasks]=await Promise.all([this.messages(),this.tasks()]);if(generation!==this.generation)return;this.callbacks.onSyncResponse?.({messages,schedule:tasks});}
 async saveMessage(msg){
  try{const id=stableId(msg.id);if(this.pair?.backend_kind==='cloud')await this.account.rpc('save_my_message',{p_pair:this.pair.id,p_id:id,p_text:msg.text});else await this.call({op:'message',id,text:msg.text});return true;}
  catch(error){this.callbacks?.onStatus?.({connected:false,error:error.message});return false;}
 }
 async saveTask(task){
  const id=stableId(task.id),revision=Number.isSafeInteger(task.cloudRevision)?task.cloudRevision:(this.revisions.get(id)||0);
  try{
   const body={...task,id,syncPairId:this.pair?.id};
   const result=this.pair?.backend_kind==='cloud'?await this.account.rpc('save_my_task',{p_pair:this.pair.id,p_id:id,p_body:body,p_revision:revision}):(await this.call({op:'task',id,body,expectedRevision:revision})).task;
   if(!result||!Number.isSafeInteger(result.revision))throw new Error('Task save was not acknowledged');this.revisions.set(id,result.revision);task.cloudRevision=result.revision;return true;
  }catch(error){this.callbacks?.onStatus?.({connected:false,error:error.message});return false;}
 }
 async signal(kind,value){
  try{
   if(!this.pair||this.account.snapshot().pair?.id!==this.pair.id)return false;
   if(kind==='schedule-live'){kind='schedule-hint';value={};}
   if(this.pair.backend_kind==='cloud')return await this.account.rpc('send_pair_signal',{p_pair:this.pair.id,p_kind:kind,p_value:value})===true;
   await this.call({op:'signal',kind,value});return true;
  }catch(error){this.callbacks?.onStatus?.({connected:false,error:error.message});return false;}
 }
 receive(payload){
  if(!payload||payload.senderId===this.user?.id||!Number.isFinite(payload.at)||Math.abs(Date.now()-payload.at)>600000||!payload.value||typeof payload.value!=='object')return;
  if(!this.pair?.members.some(m=>m.userId===payload.senderId))return;
  if(payload.kind==='presence'){
   this.remoteAt=payload.value?.online?Date.now():0;const partner=this.other();
   this.callbacks.onPresenceSync?.(this.remoteAt?{[partner.userId]:[{user:partner.displayName||partner.username,role:partner.slot===1?'me':'her'}]}:{});
  }else if(payload.kind==='voice')this.callbacks.onVoiceSignal?.(payload.value);
  else if(payload.kind==='remote'&&this.account.caps.pcControl)this.callbacks.onRemoteAccess?.({...payload.value,senderId:payload.senderId,recipientId:this.user.id,sender:this.other()?.displayName||this.other()?.username||'Partner',timestamp:Date.now()});
  else if(payload.kind==='music'&&this.account.caps.listenTogether)this.callbacks.onMusicSignal?.(payload.value);
  else if(payload.kind==='chat-live'&&payload.value?.id&&typeof payload.value.text==='string')this.callbacks.onChatMessage?.(this.chat({id:payload.value.id,sender_id:payload.senderId,body:payload.value.text,created_at:new Date(payload.at).toISOString()}));
  else if(payload.kind==='task-row'&&payload.value.pair_id===this.pair.id&&payload.value.body&&Number.isSafeInteger(payload.value.revision)){
   if((this.revisions.get(payload.value.id)||0)>=payload.value.revision)return;
   this.callbacks.onScheduleUpdated?.({items:[this.task(payload.value)],senderName:this.other()?.displayName||'Partner'});
  }
  else if(payload.kind==='chat-hint'||payload.kind==='schedule-hint')void this.sync().catch(()=>{});
 }
}
module.exports={CloudTransport,stableId};
