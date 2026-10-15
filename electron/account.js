const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {EventEmitter}=require('node:events');
const {createClient}=require('@supabase/supabase-js');
const OFFLINE_GRACE_MS=72*60*60*1000,LOGIN_MS=5*60*1000;
const EMPTY_CONFIG={supabaseUrl:'',supabaseAnonKey:'',razorpayKeyId:'',billingUrl:'',planIds:{pro_monthly:'',pro_annual:'',duo_monthly:'',duo_annual:''}};
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
 config.billingUrl=String(config.billingUrl||'').trim().replace(/\/$/,'');
 if(config.billingUrl){const url=new URL(config.billingUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use the HTTPS origin of your billing service');}
 config.razorpayKeyId=String(config.razorpayKeyId||'').trim();
 if(config.razorpayKeyId&&!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(config.razorpayKeyId))throw new Error('Enter only the public Razorpay Key ID');
 for(const key of Object.keys(EMPTY_CONFIG.planIds)){config.planIds[key]=String(config.planIds[key]||'').trim();if(config.planIds[key]&&!/^plan_[A-Za-z0-9]+$/.test(config.planIds[key]))throw new Error('Invalid public plan ID');}
 return Object.fromEntries(Object.keys(EMPTY_CONFIG).map(key=>[key,config[key]]));
}
function capabilities(config,saved,now=Date.now()){
 if(!config.supabaseUrl)return {configured:false,signedIn:false,local:true,groq:true,tasks:true,musicSolo:true,gemini:true,productivity:true,listenTogether:true,partner:true,cloud:false,pcControl:true,grace:false};
 const known=!!saved?.user?.id,verification=Number(saved?.verifiedAt)||0;
 const within=now>=verification-300000 && now-verification<=OFFLINE_GRACE_MS;
 const ent=saved?.snapshot?.entitlement,paid=known&&within&&['pro','duo'].includes(ent?.plan)&&(ent.periodEnd==='infinity'||Date.parse(ent.periodEnd)>now);
 const pair=saved?.snapshot?.pair,emergency=saved?.snapshot?.system?.emergency===true;
 const local=known&&!!saved?.snapshot?.profile;
 return {configured:true,signedIn:known,local,groq:local,tasks:local,musicSolo:local,gemini:paid,productivity:paid,listenTogether:!emergency&&paid&&!!pair?.cloudEligible&&!!pair,partner:local&&!!pair,cloud:!emergency&&paid&&pair?.backend_kind==='cloud'&&pair?.cloudEligible===true,pcControl:!emergency&&paid,grace:paid&&now-verification>5*60000};
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
  if(channel==='engine-launch-hud'||channel==='ai-set-voice')this.require('gemini');
  if(channel==='music-signal' && !['leave','decline'].includes(args[0]?.type))this.require('listenTogether');
  if(channel==='voice-signal'&&!['hangup','decline'].includes(args[0]?.type))this.require('partner');
  if(['chat-send','transcribe-audio','music-search','music-resolve','save-schedule-item','toggle-schedule-item','delete-schedule-item'].includes(channel))this.require('local');
  if(channel==='send-chat-message')this.require('partner');
 }
 guardAction(name,parameters={}){
  if(['open_app','close_app'].includes(name))return; // Saved local app shortcuts are independent of remote access.
  // Registration is checked by the action registry. Plan checks must not hide
  // implemented tools or prevent newly installed, enabled plugins from running.
  if(PC_ACTIONS.has(name)||name==='send_message')this.require('pcControl');
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
  return this.realtimeClient ||= createClient(this.config.supabaseUrl,this.config.supabaseAnonKey,{accessToken:()=>this.token(),auth:{persistSession:false}});
 }
 async startUserChannel(){
  if(!this.configured||!this.saved?.user?.id)return;
  const client=this.ensureRealtimeClient(),name='baymax:user:'+this.saved.user.id;
  if(this.userChannel?.topic==='realtime:'+name)return;
  this.stopUserChannel();
  const generation=this.userChannelGeneration;
  try{
   const token=await this.token();
   if(generation!==this.userChannelGeneration)return;
   await client.realtime.setAuth(token);
  }catch{
   if(generation===this.userChannelGeneration)this.error='Live account authentication unavailable; retrying';
   return;
  }
  if(generation!==this.userChannelGeneration||client!==this.realtimeClient)return;
  const channel=client.channel(name,{config:{private:true}});this.userChannel=channel;
  channel.on('broadcast',{event:'account-changed'},()=>{void this.refresh().catch(()=>{});});
  channel.subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){this.error='Live account updates unavailable; reconnecting';}});
 }
 stopUserChannel(){
  this.userChannelGeneration=(this.userChannelGeneration||0)+1;
  const channel=this.userChannel;this.userChannel=null;
  if(channel&&this.realtimeClient)void this.realtimeClient.removeChannel(channel).catch(()=>{});
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
   void this.startUserChannel().catch(()=>{this.error='Live account updates unavailable';});
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
  const raw=response.status===204?'':await response.text();let result=null;
  try{result=raw?JSON.parse(raw):null;}catch{const error=new Error('Service returned an invalid response ('+response.status+'). Please retry.');error.status=response.status;throw error;}
  if(!response.ok){const error=new Error(result?.code==='23505'?'This record already exists. Refresh and try again.':result?.error_description||result?.error?.message||(typeof result?.error==='string'?result.error:null)||result?.message||result?.msg||'Service unavailable');error.status=response.status;error.code=result?.code;throw error;}
  return result;
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
 async api(service,payload){
  if(service==='content')return this.content(payload);
  if(service!=='billing')throw new Error('Unsupported service. Install the current database migrations.');
  if(!this.config.billingUrl)throw new Error('Payment service setup is required. Add the owner billing service URL in account configuration.');
  return this.fetchJSON(this.config.billingUrl+'/api/billing',{method:'POST',headers:{authorization:'Bearer '+await this.token()},body:JSON.stringify(payload)});
 }
 async rest(resource,options={}){return this.fetchJSON(this.config.supabaseUrl+'/rest/v1/'+resource,{...options,headers:{authorization:'Bearer '+await this.token(),...options.headers}});}
 async rpc(name,args={}){return this.rest('rpc/'+name,{method:'POST',body:JSON.stringify(args)});}
 async content(payload){
  this.require('cloud');const pair=this.snapshot().pair;
  if(payload.pairId!==pair?.id)throw new Error('Partner changed');
  const storage=(resource,body)=>this.fetchJSON(this.config.supabaseUrl+'/storage/v1/'+resource,{method:'POST',headers:{authorization:'Bearer '+this.saved.session.access_token},body:JSON.stringify(body)});
  await this.token();
  if(payload.op==='files'){
   const cursor=payload.cursor;if(cursor&&!/^[0-9a-f-]{36}$/i.test(cursor))throw new Error('Invalid cursor');
   const rows=await this.rest('attachments?pair_id=eq.'+pair.id+'&order=id.asc&limit=100'+(cursor?'&id=gt.'+cursor:''));
   if(!Array.isArray(rows))throw new Error('Invalid file response');return {items:rows,cursor:rows.length===100?rows.at(-1).id:null};
  }
  if(payload.op==='file-upload'){
   const id=crypto.randomUUID();await this.rpc('reserve_my_file',{p_pair:pair.id,p_id:id,p_name:payload.name,p_bytes:payload.bytes});
   try{const result=await storage('object/upload/sign/baymax-files/'+pair.id+'/'+id,{});if(!result?.url)throw new Error('Upload authorization failed');return {id,url:this.config.supabaseUrl+'/storage/v1'+result.url};}
   catch(error){await this.rpc('remove_my_file',{p_pair:pair.id,p_id:id}).catch(()=>{});throw error;}
  }
  if(!/^[0-9a-f-]{36}$/i.test(payload.id||''))throw new Error('Invalid file');
  const file=(await this.rest('attachments?pair_id=eq.'+pair.id+'&id=eq.'+payload.id))?.[0];if(!file)throw new Error('File unavailable');
  if(payload.op==='file-download'){const result=await storage('object/sign/baymax-files/'+file.object_path,{expiresIn:60});if(!result?.signedURL)throw new Error('Download authorization failed');return {file,url:this.config.supabaseUrl+'/storage/v1'+result.signedURL};}
  if(payload.op==='file-delete'){
   await this.fetchJSON(this.config.supabaseUrl+'/storage/v1/object/baymax-files',{method:'DELETE',headers:{authorization:'Bearer '+await this.token()},body:JSON.stringify({prefixes:[file.object_path]})});
   await this.rpc('remove_my_file',{p_pair:pair.id,p_id:file.id});return {deleted:true};
  }
  throw new Error('Unknown file operation');
 }
 async accountSnapshot(){
  const snapshot=await this.rpc('get_my_account');
  if(!snapshot||typeof snapshot!=='object'||!snapshot.entitlement||!Array.isArray(snapshot.invites))throw new Error('Account service returned an incomplete response. Apply the latest database migrations.');
  return snapshot;
 }
 async refresh(){
  if(!this.configured||!this.saved)return this.snapshot();if(this.refreshing)return this.refreshing;
  const generation=this.generation;
  return this.refreshing=(async()=>{
   try{
    const snapshot=await this.accountSnapshot();if(generation!==this.generation)return this.snapshot();
    const previous=this.saved.snapshot;
    this.saved.snapshot=snapshot;this.saved.verifiedAt=this.now();this.error='';
    void this.startUserChannel().catch(()=>{this.error='Live account updates unavailable';});
    this.saved.deviceId ||= crypto.randomUUID();this.persist();
    if(!this.lastHeartbeat||this.now()-this.lastHeartbeat>60000){this.lastHeartbeat=this.now();void this.rpc('device_heartbeat',{p_id:this.saved.deviceId,p_name:require('node:os').hostname(),p_version:require('../package.json').version}).catch(()=>{});}
    if(previous?.pair&&!snapshot.pair)this.emit('partner-unpaired',{pairId:previous.pair.id});
    for(const invite of snapshot.invites)if(invite.recipientId===this.saved.user.id&&!previous?.invites?.some(i=>i.id===invite.id))this.emit('partner-invite-received',{senderUsername:invite.sender});
    if(previous&&!previous.pair&&snapshot.pair){const partner=snapshot.pair.members?.find(m=>m.userId!==this.saved.user.id);this.emit('partner-invite-accepted',{partnerUsername:partner?.username});}
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
    this.persist();this.error='';reply(200,'Signed in. You can return to Baymax and close this tab.');this.cancelLogin();void this.startUserChannel().catch(()=>{});await this.refresh();
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
  if(!this.saved?.user?.id)throw new Error('Sign in with Google first');
  if(op==='reserve'){
   const username=String(args.username||'').trim().replace(/^@/,'');
   if(!/^[a-z0-9_]{3,24}$/.test(username))throw new Error('Use 3–24 lowercase letters, numbers or underscores.');
   const display=String(args.displayName||this.saved.user.displayName||username).trim().slice(0,80)||username,generation=this.generation;
   const rows=await this.rest('profiles?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:this.saved.user.id,username,display_name:display})});
   const row=rows?.[0];if(row?.username!==username)throw new Error('Username was not saved. Please retry.');
   if(generation!==this.generation)throw new Error('Account changed');
   this.saved.snapshot={...(this.saved.snapshot||{entitlement:{plan:'free'}}),profile:row};this.persist();this.changed();await this.refresh();return {profile:row};
  }
  if(op==='continue-free'){if(!this.saved.snapshot?.profile)throw new Error('Choose a username first');this.saved.planChosen=true;this.persist();this.changed();return this.snapshot();}
  if(op==='revoke-seat'||op==='revoke-partner-seat'){const result=await this.rpc('revoke_partner_seat');await this.refresh();return result;}
  if(op==='assign-seat'){const result=await this.rpc('assign_partner_seat',{p_username:String(args.username||'').trim().replace(/^@/,'').toLowerCase()});await this.refresh();return result;}
  const values={...args};
  if(values.username)values.username=String(values.username).trim().replace(/^@/,'').toLowerCase();
  if(op==='lookup'&&!/^[a-z0-9_]{3,24}$/.test(values.username||''))throw new Error('Enter the exact partner username');
  if(values.token){values.tokenHash=crypto.createHash('sha256').update(String(values.token)).digest('hex');delete values.token;}
  const aliases={'migration-propose':'propose-backend','migration-accept':'accept-backend','migration-cancel':'cancel-backend','migration-commit':'commit-backend'};
  const result=await this.rpc('account_action',{p_op:aliases[op]||op,p_args:values});
  if(op!=='lookup')await this.refresh();return result;
 }
 async billing(op,args={}){
  if(op==='createCheckout'&&!this.config.razorpayKeyId){
   if(!this.saved?.snapshot?.profile)throw new Error('Sign in and choose a username first');
   const plan=String(args.priceCode||'').split('_')[0];
   if(!['pro','duo'].includes(plan))throw new Error('Choose Pro or Duo');
   const generation=this.generation;
   const result=await this.rest('rpc/claim_beta_membership',{method:'POST',body:JSON.stringify({p_plan:plan,p_partner_username:String(args.partnerUsername||'').trim().replace(/^@/,'')||null})});
   if(generation!==this.generation)throw new Error('Account changed');
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
  if(this.realtimeClient){void this.realtimeClient.removeAllChannels().catch(()=>{});this.realtimeClient=null;}
  const access=this.saved?.session?.access_token;this.saved=null;this.error='';
  if(fs.existsSync(this.sessionFile))fs.unlinkSync(this.sessionFile);this.changed();
  if(revoke&&access)await this.fetchJSON(this.config.supabaseUrl+'/auth/v1/logout?scope=local',{method:'POST',headers:{authorization:'Bearer '+access}}).catch(()=>{});
  return this.snapshot();
 }
 dispose(){
  clearInterval(this.timer);
  this.cancelLogin();
  this.stopUserChannel();
  if(this.realtimeClient){void this.realtimeClient.removeAllChannels().catch(()=>{});this.realtimeClient=null;}
 }
}
module.exports={AccountService,cleanConfig,capabilities,OFFLINE_GRACE_MS,PC_ACTIONS,PRODUCTIVITY_IPC};
