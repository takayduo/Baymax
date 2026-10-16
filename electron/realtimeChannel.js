const {createClient}=require('@supabase/supabase-js');

const AUTH_INTERVAL_MS=15000, SOCKET_STALE_MS=60000, JOIN_TIMEOUT_MS=12000;

// Owns one private subscription. Rejoining must never clear partner liveness,
// replay application signals, or reuse callbacks from an old account/channel.
class RealtimeChannel {
 constructor({account,topic,bind,onStatus=()=>{},onReady=()=>{},onClient=()=>{},isCurrent=()=>true,createClientImpl=createClient,now=Date.now,random=Math.random}){
  Object.assign(this,{account,topic,bind,onStatus,onReady,onClient,isCurrent,createClientImpl,now,random});
  this.active=false;this.epoch=0;this.attempt=0;this.client=null;this.channel=null;this.connected=false;
 }
 async start(){
  if(this.active)return;
  this.active=true;this.lastTick=this.now();
  this.tokenListener=()=>{if(this.connected)void this.refreshAuth();else this.recoverSoon();};
  this.account.on?.('token-refreshed',this.tokenListener);
  this.timer=setInterval(()=>this.tick(),3000);this.timer.unref?.();
  await this.connect();
 }
 valid(epoch=this.epoch){return this.active&&epoch===this.epoch&&this.isCurrent();}
 tick(){
  if(!this.active)return;
  if(!this.isCurrent()){void this.stop();return;}
  const now=this.now(),woke=now-this.lastTick>15000;this.lastTick=now;
  if(woke){this.retry('Restoring connection after sleep',0);return;}
  if(this.connected&&now-this.lastSocketAt>SOCKET_STALE_MS){this.retry('Realtime heartbeat expired');return;}
  if(this.connected&&now-this.lastAuthAt>=AUTH_INTERVAL_MS)void this.refreshAuth();
 }
 async refreshAuth(){
  if(!this.valid()||!this.client)return;
  if(this.authTask)return this.authTask;
  const epoch=this.epoch,client=this.client;
  const task=(async()=>{
   const token=await this.account.token();
   if(!this.valid(epoch)||client!==this.client)return;
   await client.realtime.setAuth(token);
   if(this.valid(epoch))this.lastAuthAt=this.now();
  })().catch(()=>{if(this.valid(epoch))this.retry('Refreshing private channel authorization');});
  this.authTask=task;
  try{await task;}finally{if(this.authTask===task)this.authTask=null;}
 }
 async connect(){
  if(!this.valid())return;
  const epoch=++this.epoch;
  try{
   const token=await this.account.token();
   if(!this.valid(epoch))return;
   let client;
   client=this.createClientImpl(this.account.config.supabaseUrl,this.account.config.supabaseAnonKey,{
    accessToken:()=>this.account.token(),auth:{persistSession:false},
    realtime:{heartbeatIntervalMs:15000,heartbeatCallback:status=>{
     if(!this.valid(epoch)||client!==this.client)return;
     if(status==='ok')this.lastSocketAt=this.now();
     else if(['error','timeout','disconnected'].includes(status))this.retry('Realtime heartbeat interrupted');
    }},
   });
   this.client=client;this.onClient(client);
   await client.realtime.setAuth(token);
   if(!this.valid(epoch)||client!==this.client)return;
   this.lastAuthAt=this.now();
   const channel=client.channel(this.topic,{config:{private:true}});this.channel=channel;
   const current=()=>this.valid(epoch)&&this.channel===channel;
   this.bind(channel,current);
   this.joinTimer=setTimeout(()=>{if(current())this.retry('Private channel subscription timed out');},JOIN_TIMEOUT_MS);
   this.joinTimer.unref?.();
   channel.subscribe(status=>{
    if(!current())return;
    if(status==='SUBSCRIBED'){
     clearTimeout(this.joinTimer);this.joinTimer=null;this.connected=true;
     this.attempt=0;this.lastSocketAt=this.now();this.onStatus({connected:true,reconnecting:false});
     Promise.resolve().then(()=>{if(current())return this.onReady();}).catch(()=>{});
    }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))this.retry('Private sync reconnecting');
   });
  }catch{if(this.valid(epoch))this.retry('Private channel authentication unavailable');}
 }
 detach(){
  ++this.epoch;this.connected=false;this.authTask=null;
  clearTimeout(this.joinTimer);this.joinTimer=null;
  const client=this.client;this.client=null;this.channel=null;this.onClient(null);
  if(!client)return Promise.resolve();
  // Invalidate callbacks before unsubscribe emits CLOSED. Discard the old
  // socket so a half-closed channel cannot be returned by client.channel().
  return Promise.allSettled([
   Promise.resolve().then(()=>client.removeAllChannels()),
   Promise.resolve().then(()=>client.realtime.disconnect()),
  ]);
 }
 retry(reason,delay){
  if(!this.active)return;
  if(!this.isCurrent()){void this.stop();return;}
  if(this.retryTimer&&delay!==0)return;
  clearTimeout(this.retryTimer);
  void this.detach();
  const epoch=this.epoch;
  const wait=delay??Math.min(30000,2000*2**Math.min(this.attempt++,4))+Math.floor(this.random()*500);
  this.onStatus({connected:false,reconnecting:true,error:reason+'…',retryInMs:wait});
  this.retryTimer=setTimeout(()=>{
   this.retryTimer=null;
   if(this.valid(epoch))void this.connect();
  },wait);this.retryTimer.unref?.();
 }
 recoverSoon(){
  if(this.active&&!this.connected&&this.retryTimer){clearTimeout(this.retryTimer);this.retryTimer=null;this.retry('Restoring private sync',2000);}
 }
 async stop(){
  this.active=false;clearInterval(this.timer);clearTimeout(this.retryTimer);this.retryTimer=null;
  if(this.tokenListener)this.account.off?.('token-refreshed',this.tokenListener);this.tokenListener=null;
  await this.detach();
 }
}
module.exports={RealtimeChannel};
