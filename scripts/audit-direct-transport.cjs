// One-off source migration; run from the repository root.
const fs=require('node:fs');
const file='electron/account.js';let s=fs.readFileSync(file,'utf8');
const replaceSection=(from,to,value)=>{const a=s.indexOf(from),b=s.indexOf(to,a);if(a<0||b<0)throw new Error('Missing source anchor '+from);s=s.slice(0,a)+value+s.slice(b);};
replaceSection(' ensureRealtimeClient(){',' persist(){',` ensureRealtimeClient(){
  if(!this.configured||!this.saved?.user?.id)return null;
  return this.realtimeClient ||= createClient(this.config.supabaseUrl,this.config.supabaseAnonKey,{accessToken:()=>this.token(),auth:{persistSession:false}});
 }
 startUserChannel(){
  if(!this.configured||!this.saved?.user?.id)return;
  const client=this.ensureRealtimeClient(),name='baymax:user:'+this.saved.user.id;
  if(this.userChannel?.topic==='realtime:'+name)return;
  this.stopUserChannel();
  const channel=client.channel(name,{config:{private:true}});this.userChannel=channel;
  channel.on('broadcast',{event:'account-changed'},()=>{void this.refresh();});
  channel.subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){this.error='Live account updates unavailable; reconnecting';}});
 }
 stopUserChannel(){
  const channel=this.userChannel;this.userChannel=null;
  if(channel&&this.realtimeClient)void this.realtimeClient.removeChannel(channel).catch(()=>{});
 }
`);
replaceSection(' async api(service,payload){',' async refresh(){',` async api(service,payload){
  if(service!=='billing')throw new Error('Unsupported service. Install the current database migrations.');
  if(!this.config.billingUrl)throw new Error('Payment service setup is required. Add the owner billing service URL in account configuration.');
  return this.fetchJSON(this.config.billingUrl+'/api/billing',{method:'POST',headers:{authorization:'Bearer '+await this.token()},body:JSON.stringify(payload)});
 }
 async rest(resource,options={}){return this.fetchJSON(this.config.supabaseUrl+'/rest/v1/'+resource,{...options,headers:{authorization:'Bearer '+await this.token(),...options.headers}});}
 async rpc(name,args={}){return this.rest('rpc/'+name,{method:'POST',body:JSON.stringify(args)});}
 async accountSnapshot(){
  const snapshot=await this.rpc('get_my_account');
  if(!snapshot||typeof snapshot!=='object'||!snapshot.entitlement||!Array.isArray(snapshot.invites))throw new Error('Account service returned an incomplete response. Apply the latest database migrations.');
  return snapshot;
 }
`);
replaceSection(' async action(op,args={}){',' async billing(op,args={}){',` async action(op,args={}){
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
  const values={...args};
  if(values.username)values.username=String(values.username).trim().replace(/^@/,'').toLowerCase();
  if(op==='lookup'&&!/^[a-z0-9_]{3,24}$/.test(values.username||''))throw new Error('Enter the exact partner username');
  if(values.token){values.tokenHash=crypto.createHash('sha256').update(String(values.token)).digest('hex');delete values.token;}
  const aliases={'migration-propose':'propose-backend','migration-accept':'accept-backend','migration-cancel':'cancel-backend','migration-commit':'commit-backend'};
  const result=await this.rpc('account_action',{p_op:aliases[op]||op,p_args:values});
  if(op!=='lookup')await this.refresh();return result;
 }
`);
const start=s.indexOf('   if(result?.plan){',s.indexOf(' async billing(')),end=s.indexOf('   this.saved.planChosen',start);
if(start<0||end<0)throw new Error('Missing billing anchor');s=s.slice(0,start)+s.slice(end);
s=s.replaceAll("try{this.realtimeClient.removeAllChannels();}catch{}","void this.realtimeClient.removeAllChannels().catch(()=>{});");
s=s.replace("razorpayKeyId:'',planIds:","razorpayKeyId:'',billingUrl:'',planIds:");
s=s.replace(" config.razorpayKeyId=", " config.billingUrl=String(config.billingUrl||'').trim().replace(/\\/$/,'');\n if(config.billingUrl){const url=new URL(config.billingUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use the HTTPS origin of your billing service');}\n config.razorpayKeyId=");
s=s.replace("Date.parse(ent.periodEnd)>now", "(ent.periodEnd==='infinity'||Date.parse(ent.periodEnd)>now)");
s=s.replace(" const pair=saved?.snapshot?.pair;", " const pair=saved?.snapshot?.pair,emergency=saved?.snapshot?.system?.emergency===true;");
s=s.replace("listenTogether:paid&&", "listenTogether:!emergency&&paid&&").replace("cloud:paid&&", "cloud:!emergency&&paid&&").replace("pcControl:paid,", "pcControl:!emergency&&paid,");
replaceSection(' async fetchJSON(url,options={}){',' async token(){',` async fetchJSON(url,options={}){
  const response=await this.request(url,{...options,headers:{apikey:this.config.supabaseAnonKey,'content-type':'application/json',...options.headers},signal:AbortSignal.timeout(15000),redirect:'error'});
  const raw=response.status===204?'':await response.text();let result=null;
  try{result=raw?JSON.parse(raw):null;}catch{const error=new Error('Service returned an invalid response ('+response.status+'). Please retry.');error.status=response.status;throw error;}
  if(!response.ok){const error=new Error(result?.code==='23505'?'This record already exists. Refresh and try again.':result?.error_description||result?.error?.message||(typeof result?.error==='string'?result.error:null)||result?.message||result?.msg||'Service unavailable');error.status=response.status;error.code=result?.code;throw error;}
  return result;
 }
`);
fs.writeFileSync(file,s);
let sql=fs.readFileSync('supabase/migrations/202610140006_duo_seats_revocation.sql','utf8');
sql=sql.slice(sql.indexOf('create or replace function public.claim_beta_membership'),sql.indexOf('-- 4. Update RLS'));
sql=sql.replace('perform public.accept_partner_invite(existing_inv);',"-- A purchased seat does not accept a relationship on someone's behalf.\n     null;");
fs.appendFileSync('supabase/migrations/202610140007_direct_authenticated_transport.sql','\n-- Preserve active-seat reassignment; reciprocal invites still require explicit acceptance.\n'+sql);
let main=fs.readFileSync('electron/main.js','utf8').replace('state.pair?.id,state.pair?.backend,','state.pair?.id,state.pair?.channel_token,state.pair?.backend,');fs.writeFileSync('electron/main.js',main);
let settings=fs.readFileSync('src/settings/account.ts','utf8').replace("(State.settings.userRole||'me')==='her'?'she':'he'","State.settings.userGender||'he'").replaceAll("State.settings.userRole='me'","State.settings.userGender='he'").replaceAll("State.settings.userRole='her'","State.settings.userGender='she'").replace("Bridge.saveSettings({userRole:'me'})","Bridge.saveSettings({userGender:'he'})").replace("Bridge.saveSettings({userRole:'her'})","Bridge.saveSettings({userGender:'she'})");fs.writeFileSync('src/settings/account.ts',settings);
let state=fs.readFileSync('src/core/state.ts','utf8').replace('userRole:',"userGender: 'he' as 'he' | 'she',\n    userRole:");fs.writeFileSync('src/core/state.ts',state);
for(const p of ['package.json','package-lock.json']){const obj=JSON.parse(fs.readFileSync(p));obj.license='UNLICENSED';if(obj.packages?.[''])obj.packages[''].license='UNLICENSED';fs.writeFileSync(p,JSON.stringify(obj,null,2)+'\n');}
