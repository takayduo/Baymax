const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {EventEmitter}=require('node:events');
const {createClient}=require('@supabase/supabase-js');
const OFFLINE_GRACE_MS=72*60*60*1000,LOGIN_MS=5*60*1000;
const EMPTY_CONFIG={supabaseUrl:'',supabaseAnonKey:'',razorpayKeyId:'',planIds:{pro_monthly:'',pro_annual:'',duo_monthly:'',duo_annual:''}};
function cleanConfig(value){
 const config={...EMPTY_CONFIG,...value,planIds:{...EMPTY_CONFIG.planIds,...value?.planIds}};
 config.supabaseUrl=String(config.supabaseUrl||'').trim().replace(/\/$/,'');
 config.supabaseAnonKey=String(config.supabaseAnonKey||'').trim();
 if(config.supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl))throw new Error('Use a Supabase project HTTPS URL');
 if(config.supabaseUrl){
  let publicKey=config.supabaseAnonKey.startsWith('sb_publishable_');
  try{publicKey ||= JSON.parse(Buffer.from(config.supabaseAnonKey.split('.')[1],'base64url')).role==='anon';}catch{}
  if(!publicKey || config.supabaseAnonKey.length>4096)throw new Error('Use the public publishable/anon key, never a secret or service-role key');
 }
 config.razorpayKeyId=String(config.razorpayKeyId||'').trim();
 if(config.razorpayKeyId&&!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(config.razorpayKeyId))throw new Error('Enter only the public Razorpay Key ID');
 for(const key of Object.keys(EMPTY_CONFIG.planIds)){config.planIds[key]=String(config.planIds[key]||'').trim();if(config.planIds[key]&&!/^plan_[A-Za-z0-9]+$/.test(config.planIds[key]))throw new Error('Invalid public plan ID');}
 return Object.fromEntries(Object.keys(EMPTY_CONFIG).map(key=>[key,config[key]]));
}
function capabilities(config,saved,now=Date.now()){
 if(!config.supabaseUrl)return {configured:false,signedIn:false,local:true,groq:true,tasks:true,musicSolo:true,gemini:true,productivity:true,listenTogether:true,partner:true,cloud:false,pcControl:true,grace:false};
 const known=!!saved?.user?.id,verification=Number(saved?.verifiedAt)||0;
 const within=now>=verification-300000 && now-verification<=OFFLINE_GRACE_MS;
 const ent=saved?.snapshot?.entitlement,paid=known&&within&&['pro','duo'].includes(ent?.plan)&&Date.parse(ent.periodEnd)>now;
 const pair=saved?.snapshot?.pair;
 const local=known&&!!saved?.snapshot?.profile;
 return {configured:true,signedIn:known,local,groq:local,tasks:local,musicSolo:local,gemini:paid,productivity:paid,listenTogether:paid&&!!pair?.cloudEligible&&!!pair,partner:local&&!!pair,cloud:paid&&pair?.backend_kind==='cloud'&&pair?.cloudEligible===true,pcControl:paid,grace:paid&&now-verification>5*60000};
}
const PRODUCTIVITY_IPC=new Set(['get-tracked-apps','get-daily-totals','get-app-categories','update-app-category','scan-running-apps','get-focus-sessions','add-focus-session','set-focus-sessions','start-focus-session','stop-focus-session','get-focus-active','scan-all-installed-apps','get-tracking-health','set-app-hidden','get-known-apps','add-custom-app','get-blocklist','toggle-block-app','set-blocklist','get-settings','update-settings','clear-data','is-onboarded','set-onboarded','get-user-profile','set-user-profile','kill-process','open-productivity-window']);
const PC_IPC=new Set(['request-remote-access','prepare-remote-host','respond-remote-access','send-remote-signal','get-available-screens','get-primary-screen-source','inject-remote-input','viewer-get-partner-info','viewer-send-signal','viewer-send-input','launch-app','close-app']);
const PC_ACTIONS=new Set(['computer_control','browser_control','open_app','close_app','desktop_control','computer_settings','file_controller','file_processor','screen_processor','system_monitor','code_helper','dev_agent','game_updater','video_player','youtube_video']);
class AccountService extends EventEmitter {
 constructor({folder,safeStorage,openExternal,openCheckout=openExternal,request=fetch,environment=process.env,now=Date.now,configPath=path.join(__dirname,'cloud-config.json'),callbackPort=42837}){
  super();Object.assign(this,{folder,safeStorage,openExternal,openCheckout,request,now,callbackPort});this.saved=null;this.login=null;this.refreshing=null;this.error='';this.generation=0;
  this.configFile=path.join(folder,'cloud-config.json');this.sessionFile=path.join(folder,'account.dpapi.json');
  const base=fs.existsSync(this.configFile)?JSON.parse(fs.readFileSync(this.configFile,'utf8')):fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):EMPTY_CONFIG;
  this.config=cleanConfig({...base,...(environment.BAYMAX_CENTRAL_URL?{supabaseUrl:environment.BAYMAX_CENTRAL_URL}:{}),...(environment.BAYMAX_CENTRAL_PUBLIC_KEY?{supabaseAnonKey:environment.BAYMAX_CENTRAL_PUBLIC_KEY}:{}),...(environment.BAYMAX_RAZORPAY_KEY_ID?{razorpayKeyId:environment.BAYMAX_RAZORPAY_KEY_ID}:{})});
 }
 get configured(){return !!this.config.supabaseUrl;}
 get caps(){return capabilities(this.config,this.saved,this.now());}
 require(feature){if(!this.caps[feature])throw new Error(this.caps.signedIn?`${feature==='listenTogether'?'Listen Together':feature==='gemini'?'Gemini Live':feature==='productivity'?'Productivity':'This feature'} requires an eligible plan and partner setup. Open Account & Plan.`:'Sign in with Google in Account & Plan first.');}
 guardIPC(channel,args=[]){
  if(PC_IPC.has(channel)&&!['launch-app','close-app'].includes(channel))this.require('pcControl');
  if(PRODUCTIVITY_IPC.has(channel))this.require('productivity');
  if(channel==='marklv-launch-hud'||channel==='ai-set-voice')this.require('gemini');
  if(channel==='music-signal' && !['leave','decline'].includes(args[0]?.type))this.require('listenTogether');
  if(channel==='voice-signal'&&!['hangup','decline'].includes(args[0]?.type))this.require('partner');
  if(['chat-send','transcribe-audio','music-search','music-resolve','save-schedule-item','toggle-schedule-item','delete-schedule-item'].includes(channel))this.require('local');
  if(channel==='send-chat-message')this.require('partner');
 }
 guardAction(name,parameters={}){
  if(['open_app','close_app'].includes(name))return; // Saved local app shortcuts are independent of remote access.
  if(PC_ACTIONS.has(name))throw new Error('This AI automation action is not included in this release');
  if(!new Set(['web_search','weather_report','flight_finder','reminder','manage_schedule','productivity_manager','control_app','send_partner_message','screen_process','close_camera','manage_monitor','shutdown_jarvis','save_memory','recall_memory']).has(name))throw new Error('This action is not included in this release');
  if(['screen_process','manage_monitor'].includes(name))this.require('gemini');
  if(name==='productivity_manager')this.require('productivity');
  if(name==='control_app'){
   if(parameters.action==='open_view'&&parameters.view==='productivity')this.require('productivity');
   if(parameters.action==='music'&&['join','add_shared'].includes(parameters.command))this.require('listenTogether');
   if(parameters.action==='read_partner_messages')this.require('partner');
  }
  if(name==='send_partner_message')this.require('partner');
  this.require('local');
 }
 ensureRealtimeClient(){
  if(!this.configured||!this.saved?.user?.id)return null;
  if(this.realtimeClient)return this.realtimeClient;
  try{
   this.realtimeClient=createClient(this.config.supabaseUrl,this.config.supabaseAnonKey,{
    accessToken:()=>this.token().catch(()=>this.config.supabaseAnonKey),
    auth:{persistSession:false}
   });
   return this.realtimeClient;
  }catch{
   return null;
  }
 }
 startUserChannel(){
  if(!this.configured||!this.saved?.user?.id)return;
  const client=this.ensureRealtimeClient();
  if(!client)return;
  const chName=`baymax_user_${this.saved.user.id}`;
  if(this.userChannel&&this.userChannel.topic===`realtime:${chName}`)return;
  this.stopUserChannel();
  try{
   const ch=client.channel(chName);
   this.userChannel=ch;
   ch.on('broadcast',{event:'invite'},({payload})=>{
    void this.refresh();
    this.emit('partner-invite-received',payload||{});
   });
   ch.on('broadcast',{event:'invite-accepted'},({payload})=>{
    void this.refresh();
    this.emit('partner-invite-accepted',payload||{});
   });
   ch.on('broadcast',{event:'invite-declined'},({payload})=>{
    void this.refresh();
    this.emit('partner-invite-declined',payload||{});
   });
   ch.on('broadcast',{event:'unpaired'},async({payload})=>{
    if(this.saved?.snapshot)this.saved.snapshot.pair=null;
    this.persist();
    this.changed();
    void this.refresh();
    this.emit('partner-unpaired',payload||{});
   });
   ch.subscribe();
  }catch(err){
   console.warn('[AccountService] Failed to start userChannel:',err);
  }
 }
 stopUserChannel(){
  if(this.userChannel&&this.realtimeClient){
   try{this.realtimeClient.removeChannel(this.userChannel);}catch{}
   this.userChannel=null;
  }
 }
 async broadcastToUser(targetUserId,payload){
  if(!targetUserId)return false;
  try{
   const client=this.ensureRealtimeClient();
   if(!client)return false;
   const chName=`baymax_user_${targetUserId}`;
   const ch=client.channel(chName);
   await new Promise(resolve=>{
    ch.subscribe(status=>{if(status==='SUBSCRIBED'||status==='TIMED_OUT'||status==='CHANNEL_ERROR')resolve();});
    setTimeout(resolve,1000);
   });
   await ch.send({type:'broadcast',event:payload.event||'account-event',payload});
   setTimeout(()=>client.removeChannel(ch),2000);
   return true;
  }catch{
   return false;
  }
 }
 async broadcastToPair(pairId,payload){
  if(!pairId)return false;
  try{
   const client=this.ensureRealtimeClient();
   if(!client)return false;
   const chName=`baymax_pair_${pairId}`;
   const ch=client.channel(chName);
   await new Promise(resolve=>{
    ch.subscribe(status=>{if(status==='SUBSCRIBED'||status==='TIMED_OUT'||status==='CHANNEL_ERROR')resolve();});
    setTimeout(resolve,1000);
   });
   await ch.send({type:'broadcast',event:payload.event||'partner',payload});
   setTimeout(()=>client.removeChannel(ch),2000);
   return true;
  }catch{
   return false;
  }
 }
 persist(){
  if(!this.saved){if(fs.existsSync(this.sessionFile))fs.unlinkSync(this.sessionFile);return;}
  if(!this.safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable');
  fs.mkdirSync(this.folder,{recursive:true});const tmp=this.sessionFile+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({version:1,encrypted:this.safeStorage.encryptString(JSON.stringify({project:this.config.supabaseUrl,...this.saved})).toString('base64')}));fs.renameSync(tmp,this.sessionFile);
 }
 snapshot(){return {config:this.config,configured:this.configured,user:this.saved?.user||null,...(this.saved?.snapshot||{}),capabilities:this.caps,verifiedAt:this.saved?.verifiedAt||0,error:this.error,loggingIn:!!this.login,planChosen:this.saved?.planChosen===true};}
 changed(){this.emit('changed',this.snapshot());}
 async init(){
  if(this.configured&&fs.existsSync(this.sessionFile)){
   try{const raw=JSON.parse(fs.readFileSync(this.sessionFile,'utf8'));const saved=JSON.parse(this.safeStorage.decryptString(Buffer.from(raw.encrypted,'base64')));if(saved.project===this.config.supabaseUrl)this.saved=saved;}catch{this.error='Saved login could not be decrypted. Sign in again; local data is preserved.';}
  }
  if(this.saved){
   this.startUserChannel();
   await this.refresh().catch(()=>{});
  }
  this.timer=setInterval(()=>{if(this.saved)void this.refresh().catch(()=>{});else this.changed();},10000);this.timer.unref?.();return this.snapshot();
 }
 async saveConfig(value){
  const next=cleanConfig(value);if(next.supabaseUrl!==this.config.supabaseUrl||next.supabaseAnonKey!==this.config.supabaseAnonKey)await this.logout(false);
  this.config=next;fs.mkdirSync(this.folder,{recursive:true});const temp=this.configFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2));fs.renameSync(temp,this.configFile);this.changed();return this.snapshot();
 }
 async fetchJSON(url,options={}){
  const response=await this.request(url,{...options,headers:{apikey:this.config.supabaseAnonKey,'content-type':'application/json',...options.headers},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(response.status===204)return null;
  const result=await response.json();if(!response.ok){const err=new Error(result.code==='23505'?'That username is already taken. Try another.':result.error_description||result.error?.message||result.error||result.message||result.msg||'Service unavailable');err.status=response.status;err.code=result.code;throw err;}return result;
 }
 async token(){
  if(!this.saved?.session)throw new Error('Sign in required');
  if(!this.saved.session.expires_at||this.saved.session.expires_at*1000<this.now()+60000){
   if(this.tokenRefresh)return this.tokenRefresh;
   const generation=this.generation;
   this.tokenRefresh=(async()=>{
    const session=await this.fetchJSON(this.config.supabaseUrl+'/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:this.saved.session.refresh_token})}).catch(error=>{if([400,401].includes(error.status))error.authRejected=true;throw error;});
    if(generation!==this.generation)throw new Error('Account changed');
    session.expires_at ||= Math.floor(this.now()/1000)+Number(session.expires_in||3600);
    this.saved.session=session;this.persist();return session.access_token;
   })().finally(()=>{this.tokenRefresh=null;});
   return this.tokenRefresh;
  }
  return this.saved.session.access_token;
 }
 async api(service,payload){return this.fetchJSON(this.config.supabaseUrl+'/functions/v1/'+service,{method:'POST',headers:{authorization:'Bearer '+await this.token()},body:JSON.stringify(payload)});}
 async rest(resource,options={}){return this.fetchJSON(this.config.supabaseUrl+'/rest/v1/'+resource,{...options,headers:{authorization:'Bearer '+await this.token(),...options.headers}});}
 async accountSnapshot(){
  try{
   const snap=await this.rest('rpc/get_my_account',{method:'POST',body:'{}'});
   if(snap && typeof snap==='object')return snap;
  }catch{}
  try{
   const snap=await this.rest('rpc/account_snapshot',{method:'POST',body:JSON.stringify({p_actor:this.saved.user.id})});
   if(snap && typeof snap==='object')return snap;
  }catch{}
  const profiles=await this.rest('profiles?select=*&user_id=eq.'+encodeURIComponent(this.saved.user.id)).catch(()=>[]);
  let invites=[];
  try{
   const inc=await this.rest('partner_invites?select=id,sender_id,recipient_id,status,created_at&recipient_id=eq.'+encodeURIComponent(this.saved.user.id)+'&status=eq.pending').catch(()=>[]);
   const out=await this.rest('partner_invites?select=id,sender_id,recipient_id,status,created_at&sender_id=eq.'+encodeURIComponent(this.saved.user.id)+'&status=eq.pending').catch(()=>[]);
   invites=[...(inc||[]),...(out||[])].map(i=>({id:i.id,senderId:i.sender_id,recipientId:i.recipient_id,status:i.status}));
   for(const inv of invites){
    const other=inv.senderId===this.saved.user.id?inv.recipientId:inv.senderId;
    if(other){
     const p=await this.rest('profiles?select=username,display_name&user_id=eq.'+encodeURIComponent(other)).catch(()=>[]);
     if(p?.[0]){inv.sender=p[0].username;inv.displayName=p[0].display_name;}
    }
   }
  }catch{}
  let activePair=null;
  try{
   const memberRows=await this.rest(`pair_members?select=pair_id,slot,user_id&user_id=eq.${encodeURIComponent(this.saved.user.id)}&ended_at=is.null`).catch(()=>[]);
   if(Array.isArray(memberRows)&&memberRows.length>0){
    const pairId=memberRows[0].pair_id;
    const pairRows=await this.rest(`pairs?select=*&id=eq.${encodeURIComponent(pairId)}&status=eq.active`).catch(()=>[]);
    if(Array.isArray(pairRows)&&pairRows.length>0){
     const allMembers=await this.rest(`pair_members?select=pair_id,slot,user_id&pair_id=eq.${encodeURIComponent(pairId)}&ended_at=is.null`).catch(()=>[]);
     const members=[];
     for(const m of (allMembers||[])){
      const p=await this.rest(`profiles?select=username,display_name,avatar_url&user_id=eq.${encodeURIComponent(m.user_id)}`).catch(()=>[]);
      members.push({
       userId:m.user_id,
       slot:m.slot,
       username:p?.[0]?.username||'partner',
       displayName:p?.[0]?.display_name||p?.[0]?.username||'Partner'
      });
     }
     activePair={
      id:pairRows[0].id,
      backend_kind:pairRows[0].backend_kind||'cloud',
      backend_id:pairRows[0].backend_id||null,
      status:pairRows[0].status,
      cloudEligible:true,
      members
     };
    }
   }
  }catch(err){
   console.warn('[Account] Active pair query failed:', err);
  }
  let activeEntitlement = {plan:'free'};
  try{
   const seatRows=await this.rest(`seats?select=subscription_id,state&user_id=eq.${encodeURIComponent(this.saved.user.id)}&state=eq.active`).catch(()=>[]);
   if(Array.isArray(seatRows)&&seatRows.length>0){
    const subId=seatRows[0].subscription_id;
    const subRows=await this.rest(`subscriptions?select=id,plan_code,provider,purchaser_id,period_end,cancelled_at_period_end,state&id=eq.${encodeURIComponent(subId)}&state=eq.active`).catch(()=>[]);
    if(Array.isArray(subRows)&&subRows.length>0&&Date.parse(subRows[0].period_end)>this.now()){
     activeEntitlement={
      plan:subRows[0].plan_code,
      provider:subRows[0].provider,
      subscriptionId:subRows[0].id,
      purchaserId:subRows[0].purchaser_id,
      periodEnd:subRows[0].period_end,
      cancelAtPeriodEnd:subRows[0].cancelled_at_period_end
     };
    }
   }else{
    const directSubs=await this.rest(`subscriptions?select=id,plan_code,provider,purchaser_id,period_end,cancelled_at_period_end,state&purchaser_id=eq.${encodeURIComponent(this.saved.user.id)}&state=eq.active&order=period_end.desc&limit=1`).catch(()=>[]);
    if(Array.isArray(directSubs)&&directSubs.length>0&&Date.parse(directSubs[0].period_end)>this.now()){
     activeEntitlement={
      plan:directSubs[0].plan_code,
      provider:directSubs[0].provider,
      subscriptionId:directSubs[0].id,
      purchaserId:directSubs[0].purchaser_id,
      periodEnd:directSubs[0].period_end,
      cancelAtPeriodEnd:directSubs[0].cancelled_at_period_end
     };
    }
   }
  }catch(err){
   console.warn('[Account] Entitlement query fallback failed:', err);
   activeEntitlement=this.saved?.snapshot?.entitlement||{plan:'free'};
  }
  return {
   profile:profiles?.[0]||this.saved?.snapshot?.profile||null,
   entitlement:activeEntitlement,
   pair:activePair,
   invites,
   backends:this.saved?.snapshot?.backends||[],
   migrations:this.saved?.snapshot?.migrations||[]
  };
 }
 async refresh(){
  if(!this.configured||!this.saved)return this.snapshot();if(this.refreshing)return this.refreshing;
  const generation=this.generation;
  return this.refreshing=(async()=>{
   try{
    const snapshot=await this.accountSnapshot();if(generation!==this.generation)return this.snapshot();
    this.saved.snapshot=snapshot;this.saved.verifiedAt=this.now();this.error='';this.persist();
   }catch(error){
    if(generation!==this.generation)return this.snapshot();
    if(error.status===401||error.authRejected){this.saved=null;this.persist();}
    this.error=error.message||'Offline: using bounded cached access';
   }
   this.changed();return this.snapshot();
  })().finally(()=>{this.refreshing=null;});
 }
 cancelLogin(){const attempt=this.login;this.login=null;if(attempt){clearTimeout(attempt.timer);if(attempt.server?.listening)attempt.server.close();}this.changed();}
 async startLogin(){
  if(!this.configured)throw new Error('Configure the central Supabase project first');
  if(!this.safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable');
  this.cancelLogin();const generation=++this.generation;
  const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const attempt={state,verifier,expires:this.now()+LOGIN_MS,used:false,server:null,timer:null};
  const server=http.createServer(async(req,res)=>{
   const reply=(status,message)=>{res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'"});res.end(message);};
   const url=new URL(req.url||'/',`http://127.0.0.1:${this.callbackPort}`);
   if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${this.callbackPort}`||url.pathname!=='/auth/callback')return reply(404,'Not found');
   const returned=Buffer.from(url.searchParams.get('state')||''),expected=Buffer.from(state);
   if(this.login!==attempt||attempt.used||this.now()>attempt.expires||returned.length!==expected.length||!crypto.timingSafeEqual(returned,expected))return reply(400,'Login attempt expired or invalid. Return to Baymax and try again.');
   const code=url.searchParams.get('code');if(!code||code.length>4096){reply(400,'Google sign-in was cancelled or failed.');this.cancelLogin();return;}
   attempt.used=true;
   try{
    const session=await this.fetchJSON(this.config.supabaseUrl+'/auth/v1/token?grant_type=pkce',{method:'POST',body:JSON.stringify({auth_code:code,code_verifier:verifier})});
    const user=await this.fetchJSON(this.config.supabaseUrl+'/auth/v1/user',{headers:{authorization:'Bearer '+session.access_token}});
    session.expires_at ||= Math.floor(this.now()/1000)+Number(session.expires_in||3600);
    if(generation!==this.generation||this.login!==attempt)throw new Error('Login was replaced');
    if(!(user.app_metadata?.providers||[user.app_metadata?.provider]).includes('google'))throw new Error('Use your Google account to sign in');
    this.saved={user:{id:user.id,email:user.email,displayName:user.user_metadata?.full_name||'',avatarUrl:user.user_metadata?.avatar_url||''},session,snapshot:null,verifiedAt:0,planChosen:false};
    this.persist();this.error='';reply(200,'Signed in. You can return to Baymax and close this tab.');this.cancelLogin();this.startUserChannel();await this.refresh();
   }catch(error){reply(400,'Sign-in could not finish. Return to Baymax and try again.');this.error=error.message;this.cancelLogin();}
  });
  attempt.server=server;this.login=attempt;
  try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.callbackPort,'127.0.0.1',resolve);});
   attempt.timer=setTimeout(()=>{if(this.login===attempt){this.error='Sign-in expired. Please try again.';this.cancelLogin();}},LOGIN_MS);attempt.timer.unref?.();
   const redirect=`http://127.0.0.1:${this.callbackPort}/auth/callback?state=${state}`;
   const url=new URL(this.config.supabaseUrl+'/auth/v1/authorize');url.search=new URLSearchParams({provider:'google',redirect_to:redirect,code_challenge:challenge,code_challenge_method:'s256',access_type:'offline',prompt:'select_account'}).toString();
   await this.openExternal(url.href);this.changed();return {started:true};
  }catch(error){this.cancelLogin();throw error;}
 }
 async action(op,args={}){
  if(op==='reserve'){
   if(!this.saved?.user?.id)throw new Error('Sign in with Google first');
   const username=String(args.username||'').trim().replace(/^@/,'');
   if(!/^[a-z0-9_]{3,24}$/.test(username))throw new Error('Use 3–24 lowercase letters, numbers or underscores.');
   const display=String(args.displayName||this.saved.user.displayName||username).trim().slice(0,80)||username;
   const generation=this.generation;
   let row=null;
   try{
    const rows=await this.rest('profiles?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:this.saved.user.id,username,display_name:display})});
    row=rows?.[0];
   }catch{
    row={user_id:this.saved.user.id,username,display_name:display};
   }
   if(!row?.username)row={user_id:this.saved.user.id,username,display_name:display};
   if(generation!==this.generation)throw new Error('Account changed');
   this.saved.snapshot={...(this.saved.snapshot||{entitlement:{plan:'free'}}),profile:row};this.persist();this.changed();
   await this.refresh().catch(()=>{});return {profile:row};
  }
  if(op==='continue-free'){if(!this.saved?.snapshot?.profile)throw new Error('Choose a username first');this.saved.planChosen=true;this.persist();this.changed();return this.snapshot();}
  if(op==='lookup'){
   const target=String(args.username||'').trim().toLowerCase().replace(/^@/,'');
   if(!target)return {profile:null};
   try{
    const rows=await this.rest('profiles?select=user_id,username,display_name,avatar_url&username=ilike.'+encodeURIComponent(target));
    if(rows?.[0] && rows[0].user_id!==this.saved?.user?.id)return {profile:rows[0]};
    return {profile:null};
   }catch{
    return {profile:null};
   }
  }
  if(op==='invite'){
   const target=String(args.username||'').trim().toLowerCase().replace(/^@/,'');
   let recipientId=args.recipientId||null;
   if(target && !recipientId){
    const profs=await this.rest('profiles?select=user_id&username=ilike.'+encodeURIComponent(target)).catch(()=>[]);
    recipientId=profs?.[0]?.user_id||null;
   }
   if(!recipientId)throw new Error('Partner @'+target+' was not found. Please check spelling.');
   if(recipientId===this.saved.user.id)throw new Error('You cannot invite yourself');
   let res=null;
   try{
    res=await this.rest('rpc/create_partner_invite',{method:'POST',body:JSON.stringify({p_actor:this.saved.user.id,p_recipient:recipientId,p_token_hash:null,p_backend:args.backendId||null})});
   }catch(err){
    const ins=await this.rest('partner_invites',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({sender_id:this.saved.user.id,recipient_id:recipientId,backend_id:args.backendId||null})});
    res=ins?.[0]||{success:true};
   }
   void this.broadcastToUser(recipientId,{
    event:'invite',
    senderId:this.saved.user.id,
    senderUsername:this.saved.snapshot?.profile?.username||'Someone'
   });
   await this.refresh().catch(()=>{});
   return res||{success:true};
  }
  if(op==='accept'){
   let senderId=args.senderId||null;
   if(!senderId&&args.id){
    const invRows=await this.rest('partner_invites?select=sender_id&id=eq.'+encodeURIComponent(args.id)).catch(()=>[]);
    senderId=invRows?.[0]?.sender_id||null;
   }
   try{
    await this.rest('rpc/accept_partner_invite',{method:'POST',body:JSON.stringify({p_actor:this.saved.user.id,p_invite:args.id,p_token_hash:null,p_custom_consent:args.customConsent===true})});
   }catch{
    await this.rest('partner_invites?id=eq.'+encodeURIComponent(args.id),{method:'PATCH',body:JSON.stringify({status:'accepted'})}).catch(()=>{});
   }
   if(senderId){
    void this.broadcastToUser(senderId,{
     event:'invite-accepted',
     partnerId:this.saved.user.id,
     partnerUsername:this.saved.snapshot?.profile?.username||'Partner'
    });
   }
   await this.refresh().catch(()=>{});
   return {accepted:true};
  }
  if(op==='decline'||op==='revoke'){
   let targetUserId=args.senderId||null;
   if(!targetUserId&&args.id){
    const invRows=await this.rest('partner_invites?select=sender_id,recipient_id&id=eq.'+encodeURIComponent(args.id)).catch(()=>[]);
    targetUserId=invRows?.[0]?.sender_id===this.saved?.user?.id?invRows?.[0]?.recipient_id:invRows?.[0]?.sender_id;
   }
   await this.rest('partner_invites?id=eq.'+encodeURIComponent(args.id),{method:'PATCH',body:JSON.stringify({status:op==='decline'?'declined':'revoked'})}).catch(()=>{});
   if(targetUserId){
    void this.broadcastToUser(targetUserId,{
     event:'invite-declined',
     partnerUsername:this.saved.snapshot?.profile?.username||'Partner'
    });
   }
   await this.refresh().catch(()=>{});
   return {success:true};
  }
  if(op==='end-pair'){
   const currentPair=this.saved?.snapshot?.pair;
   const otherMember=currentPair?.members?.find(m=>m.userId!==this.saved?.user?.id);
   const unpairPayload={
    event:'unpaired',
    endedById:this.saved.user.id,
    endedByUsername:this.saved.snapshot?.profile?.username||'Partner',
    pairId:currentPair?.id,
    at:Date.now()
   };
   if(currentPair?.id){
    void this.broadcastToPair(currentPair.id,unpairPayload);
   }
   if(otherMember?.userId){
    void this.broadcastToUser(otherMember.userId,unpairPayload);
   }
   try{
    await this.rest('rpc/end_pair',{method:'POST',body:JSON.stringify({p_actor:this.saved.user.id})});
   }catch{
    if(currentPair?.id){
     await this.rest('pairs?id=eq.'+encodeURIComponent(currentPair.id),{method:'PATCH',body:JSON.stringify({status:'ended',ended_at:new Date().toISOString()})}).catch(()=>{});
     await this.rest('pair_members?pair_id=eq.'+encodeURIComponent(currentPair.id),{method:'PATCH',body:JSON.stringify({ended_at:new Date().toISOString()})}).catch(()=>{});
    }
   }
   if(this.saved?.snapshot){
    this.saved.snapshot.pair=null;
    this.persist();
   }
   this.changed();
   await this.refresh().catch(()=>{});
   return {ended:true};
  }
  let result={};
  try{result=await this.api('account',{...args,op});}catch{}
  await this.refresh().catch(()=>{});
  return result;
 }
 async billing(op,args={}){
  if(op==='createCheckout'&&!this.config.razorpayKeyId){
   if(!this.saved?.snapshot?.profile)throw new Error('Sign in and choose a username first');
   const plan=String(args.priceCode||'').split('_')[0];
   if(!['pro','duo'].includes(plan))throw new Error('Choose Pro or Duo');
   const generation=this.generation;
   const result=await this.rest('rpc/claim_beta_membership',{method:'POST',body:JSON.stringify({p_plan:plan,p_partner_username:String(args.partnerUsername||'').trim().replace(/^@/,'')||null})});
   if(generation!==this.generation)throw new Error('Account changed');
   if(result?.plan){
    const ent={
     plan:result.plan,
     provider:'beta_test',
     periodEnd:result.periodEnd,
     cancelAtPeriodEnd:false
    };
    this.saved.snapshot={...(this.saved.snapshot||{}),entitlement:ent};
   }
   this.saved.planChosen=true;this.persist();this.changed();await this.refresh();return {testing:true,...result};
  }
  const result=await this.api('billing',{...args,op});
  if(op==='createCheckout'){
   const url=new URL(result.url);if(url.protocol!=='https:'||!['rzp.io','razorpay.com','www.razorpay.com'].includes(url.hostname))throw new Error('Invalid checkout URL');
   this.saved.planChosen=true;this.persist();await this.openCheckout(url.href);this.changed();
  }
  return result;
 }
 async logout(revoke=true){
  this.cancelLogin();++this.generation;
  this.stopUserChannel();
  if(this.realtimeClient){try{this.realtimeClient.removeAllChannels();}catch{}this.realtimeClient=null;}
  const access=this.saved?.session?.access_token;this.saved=null;this.error='';
  if(fs.existsSync(this.sessionFile))fs.unlinkSync(this.sessionFile);this.changed();
  if(revoke&&access)await this.fetchJSON(this.config.supabaseUrl+'/auth/v1/logout?scope=local',{method:'POST',headers:{authorization:'Bearer '+access}}).catch(()=>{});
  return this.snapshot();
 }
 dispose(){
  clearInterval(this.timer);
  this.cancelLogin();
  this.stopUserChannel();
  if(this.realtimeClient){try{this.realtimeClient.removeAllChannels();}catch{}this.realtimeClient=null;}
 }
}
module.exports={AccountService,cleanConfig,capabilities,OFFLINE_GRACE_MS,PC_ACTIONS,PRODUCTIVITY_IPC};
