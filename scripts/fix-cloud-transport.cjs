const fs=require('node:fs');const f='electron/cloudTransport.js';let s=fs.readFileSync(f,'utf8');
function section(a,b,r){const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<0)throw new Error(a);s=s.slice(0,i)+r+s.slice(j);}
s=s.replace('const channelName=`baymax_pair_${this.pair.id}`;',"if(!this.pair.channel_token){callbacks.onStatus?.({connected:false,error:'Apply the latest database migrations'});return false;}\n   const channelName=`baymax:pair:${this.pair.id}:${this.pair.channel_token}`;");
s=s.replace('this.client.channel(channelName)','this.client.channel(channelName,{config:{private:true}})');
section("   channel.on('broadcast',{event:'unpaired'}",'   channel.subscribe', '');
section('  if(this.mainChannel){','  this.mainChannel=null;', '');
s=s.replace("if(pair.backend_kind==='cloud'){try{return await this.account.api('content',{...payload,pairId:pair.id});}catch{return {items:[],cursor:null};}}","if(pair.backend_kind==='cloud')throw new Error('Unsupported Cloud operation');");
section(' async all(op){',' async sync(){',` async all(op){const items=[];let cursor=null;const seen=new Set();do{const page=await this.call({op,cursor});if(!Array.isArray(page?.items))throw new Error('Invalid database response');items.push(...page.items);cursor=page.cursor;if(cursor&&seen.has(cursor))throw new Error('Invalid pagination cursor');seen.add(cursor);}while(cursor);return items;}
 async rows(table){
  const rows=[];let last=null;
  for(;;){const page=await this.account.rest(table+'?pair_id=eq.'+encodeURIComponent(this.pair.id)+'&order=id.asc&limit=500'+(last?'&id=gt.'+last:''));
   if(!Array.isArray(page))throw new Error('Invalid database response');rows.push(...page);if(page.length<500)return rows;
   const next=page.at(-1)?.id;if(!next||next===last)throw new Error('Invalid database cursor');last=encodeURIComponent(next);
  }
 }
 async messages(){return (this.pair?.backend_kind==='cloud'?await this.rows('messages'):await this.all('messages')).map(row=>this.chat(row)).sort((a,b)=>a.timestamp-b.timestamp);}
 async tasks(){return (this.pair?.backend_kind==='cloud'?await this.rows('tasks'):await this.all('tasks')).map(row=>this.task(row));}
`);
section(' async saveMessage(msg){',' receive(payload){',` async saveMessage(msg){
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
`);
section("  if(payload.kind==='unpaired'",'  if(!this.pair?.members', '');
s=s.replace("if(!payload||payload.senderId===this.user?.id)return;","if(!payload||payload.senderId===this.user?.id||!Number.isFinite(payload.at)||Math.abs(Date.now()-payload.at)>120000||!payload.value||typeof payload.value!=='object')return;");
section("  else if(payload.kind==='schedule-live'", "  else if(payload.kind==='chat-hint'",`  else if(payload.kind==='task-row'&&payload.value.pair_id===this.pair.id&&payload.value.body&&Number.isSafeInteger(payload.value.revision)){
   if((this.revisions.get(payload.value.id)||0)>=payload.value.revision)return;
   this.callbacks.onScheduleUpdated?.({items:[this.task(payload.value)],senderName:this.other()?.displayName||'Partner'});
  }
`);
s=s.replace("if(generation!==this.generation||this.polling)return;this.polling=true;","if(generation!==this.generation||this.pollGeneration===generation)return;this.pollGeneration=generation;");
s=s.replace('finally{this.polling=false;}','finally{if(this.pollGeneration===generation)this.pollGeneration=null;}');
s=s.replace("    callbacks.onStatus?.({connected:true});\n   }catch", "   }catch");
s=s.replace("channel.on('broadcast',{event:'revoked'},()=>{void account.refresh();void this.stop();});","channel.on('broadcast',{event:'revoked'},()=>{if(generation===this.generation){void this.stop();void account.refresh();}});");
fs.writeFileSync(f,s);
