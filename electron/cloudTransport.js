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
   const channelName=`baymax_pair_${this.pair.id}`;
   const channel=this.client.channel(channelName);
   this.mainChannel=channel;
   channel.on('broadcast',{event:'partner'},({payload})=>{if(generation===this.generation)this.receive(payload);});
   channel.on('broadcast',{event:'revoked'},()=>{void account.refresh();void this.stop();});
   channel.on('broadcast',{event:'unpaired'},({payload})=>{
    if(account.saved?.snapshot)account.saved.snapshot.pair=null;
    account.persist();
    account.changed();
    void account.refresh();
    account.emit('partner-unpaired',payload||{});
    void this.stop();
   });
   channel.subscribe(status=>{
    if(generation!==this.generation)return;
    if(status==='SUBSCRIBED'){
     callbacks.onStatus?.({connected:true});
     void this.signal('presence',{online:true});
    }
   });
   this.channels.push(channel);
  }else if(!this.pair.backend){callbacks.onStatus?.({connected:false,error:'Custom database is not verified'});return false;}
  const tick=async()=>{
   if(generation!==this.generation||this.polling)return;this.polling=true;
   try{
    if(this.pair.backend_kind==='custom'){
     const poll=await this.call({op:'poll',cursor:this.signalCursor});if(generation!==this.generation)return;
     this.signalCursor=poll.cursor;
     for(const item of poll.items||[])if(Date.parse(item.created_at)>=this.startAt-1000)this.receive({senderId:item.sender_id,kind:item.kind,value:item.value,at:Date.parse(item.created_at)});
    }
    if(!this.lastPulse||Date.now()-this.lastPulse>10000){this.lastPulse=Date.now();await this.signal('presence',{online:true});await this.sync();}
    if(this.remoteAt&&Date.now()-this.remoteAt>35000){this.remoteAt=0;callbacks.onPresenceSync?.({});}
    callbacks.onStatus?.({connected:true});
   }catch(error){callbacks.onStatus?.({connected:false,error:error.message});}finally{this.polling=false;}
  };
  this.timer=setInterval(()=>void tick(),3000);this.timer.unref?.();void tick();return true;
 }
 async stop(){
  ++this.generation;clearInterval(this.timer);this.timer=null;
  if(this.mainChannel){
   try{
    await this.mainChannel.send({
     type:'broadcast',
     event:'partner',
     payload:{senderId:this.user?.id,kind:'presence',value:{online:false},at:Date.now()}
    });
   }catch{}
  }
  this.mainChannel=null;this.remoteAt=0;this.signalCursor=0;this.lastPulse=0;this.polling=false;this.revisions.clear();const client=this.client,channels=this.channels;this.client=null;this.channels=[];await Promise.allSettled(channels.map(c=>client?.removeChannel(c)));this.callbacks?.onPresenceSync?.({});
 }
 async call(payload){
  const pair=this.account?.snapshot().pair;if(!pair||pair.id!==this.pair?.id)throw new Error('Partner connection changed');
  if(pair.backend_kind==='cloud'){try{return await this.account.api('content',{...payload,pairId:pair.id});}catch{return {items:[],cursor:null};}}
  const backend=pair.backend;if(!backend)throw new Error('Custom database unavailable');
  return this.account.fetchJSON(backend.endpoint,{method:'POST',headers:{apikey:backend.publicKey,authorization:'Bearer '+await this.account.token()},body:JSON.stringify({...payload,pairId:pair.id,backendId:backend.id})});
 }
 local(){return this.pair.members.find(m=>m.userId===this.user.id);}
 other(){return this.pair.members.find(m=>m.userId!==this.user.id);}
 chat(row){const author=this.pair.members.find(m=>m.userId===row.sender_id);return {id:row.id,sender:author?.displayName||author?.username||'Partner',senderRole:author?.slot===1?'me':'her',recipient:this.user.displayName||'',text:row.body,timestamp:Date.parse(row.created_at),read:false,delivery:'stored',cloudPending:false};}
 task(row){this.revisions.set(row.id,row.revision);return {...row.body,id:row.id,syncPairId:this.pair?.id,deleted:!!row.deleted_at,updatedAt:Date.parse(row.updated_at),cloudRevision:row.revision};}
 async all(op){const items=[];let cursor=null;do{const page=await this.call({op,cursor});items.push(...page.items);cursor=page.cursor;}while(cursor);return items;}
 async messages(){
  if(this.pair?.backend_kind==='cloud'){
   try{
    const rows=await this.account.rest(`messages?pair_id=eq.${encodeURIComponent(this.pair.id)}&order=created_at.asc`).catch(()=>[]);
    if(Array.isArray(rows)&&rows.length)return rows.map(r=>this.chat(r));
   }catch{}
   return [];
  }
  return (await this.all('messages')).map(row=>this.chat(row));
 }
 async tasks(){
  if(this.pair?.backend_kind==='cloud'){
   try{
    const rows=await this.account.rest(`tasks?pair_id=eq.${encodeURIComponent(this.pair.id)}&order=updated_at.asc`).catch(()=>[]);
    if(Array.isArray(rows)&&rows.length)return rows.map(r=>this.task(r));
   }catch{}
   return [];
  }
  return (await this.all('tasks')).map(row=>this.task(row));
 }
 async sync(){const generation=this.generation;const [messages,tasks]=await Promise.all([this.messages(),this.tasks()]);if(generation!==this.generation)return;this.callbacks.onSyncResponse?.({messages,schedule:tasks});}
 async saveMessage(msg){
  const id=stableId(msg.id);
  void this.signal('chat-live',{id,text:msg.text});
  try{
   if(this.pair?.backend_kind==='cloud'){
    await this.account.rest('messages',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({pair_id:this.pair.id,id,sender_id:this.user.id,body:msg.text})});
    return true;
   }
   await this.call({op:'message',id,text:msg.text});return true;
  }catch{
   return true;
  }
 }
 async saveTask(task){
  const id=stableId(task.id);
  const currentRev=(this.revisions.get(id)||task.cloudRevision||0)+1;
  const taskWithMeta={...task,id,syncPairId:this.pair?.id,cloudRevision:currentRev};
  void this.signal('schedule-live',{items:[taskWithMeta],senderName:this.user?.displayName||this.user?.username||'Partner'});
  try{
   if(this.pair?.backend_kind==='cloud'){
    const record={
     pair_id:this.pair.id,
     id,
     updated_by:this.user.id,
     revision:currentRev,
     deleted_at:task.deleted?new Date().toISOString():null,
     body:taskWithMeta,
     updated_at:new Date().toISOString()
    };
    await this.account.rest('tasks',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify(record)});
    this.revisions.set(id,currentRev);return true;
   }
   const result=await this.call({op:'task',id,body:taskWithMeta,expectedRevision:this.revisions.get(id)||task.cloudRevision||0});
   this.revisions.set(id,result.task.revision);return true;
  }catch{
   return true;
  }
 }
 async signal(kind,value){
  if(this.mainChannel){
   try{
    await this.mainChannel.send({
     type:'broadcast',
     event:'partner',
     payload:{senderId:this.user.id,kind,value,at:Date.now()}
    });
    return true;
   }catch(err){
    console.warn('[CloudTransport] signal broadcast failed:', err);
   }
  }
  try{await this.call({op:'signal',kind,value});return true;}catch{return false;}
 }
 receive(payload){
  if(!payload||payload.senderId===this.user?.id)return;
  if(payload.kind==='unpaired'||payload.event==='unpaired'){
   if(this.account?.saved?.snapshot)this.account.saved.snapshot.pair=null;
   this.account?.persist();
   this.account?.changed();
   void this.account?.refresh();
   this.account?.emit('partner-unpaired',payload.value||payload);
   void this.stop();
   return;
  }
  if(!this.pair?.members.some(m=>m.userId===payload.senderId))return;
  if(payload.kind==='presence'){
   this.remoteAt=payload.value?.online?Date.now():0;const partner=this.other();
   this.callbacks.onPresenceSync?.(this.remoteAt?{[partner.userId]:[{user:partner.displayName||partner.username,role:partner.slot===1?'me':'her'}]}:{});
  }else if(payload.kind==='voice')this.callbacks.onVoiceSignal?.(payload.value);
  else if(payload.kind==='remote'&&this.account.caps.pcControl)this.callbacks.onRemoteAccess?.({...payload.value,senderId:payload.senderId,recipientId:this.user.id,sender:this.other()?.displayName||this.other()?.username||'Partner',timestamp:payload.at});
  else if(payload.kind==='music'&&this.account.caps.listenTogether)this.callbacks.onMusicSignal?.(payload.value);
  else if(payload.kind==='chat-live'&&payload.value?.id&&typeof payload.value.text==='string')this.callbacks.onChatMessage?.(this.chat({id:payload.value.id,sender_id:payload.senderId,body:payload.value.text,created_at:new Date(payload.at).toISOString()}));
  else if(payload.kind==='schedule-live'&&payload.value){
   if(Array.isArray(payload.value.items))this.callbacks.onScheduleUpdated?.(payload.value);
   void this.sync().catch(()=>{});
  }
  else if(payload.kind==='chat-hint'||payload.kind==='schedule-hint')void this.sync().catch(()=>{});
 }
}
module.exports={CloudTransport,stableId};
