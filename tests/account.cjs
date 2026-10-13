const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {AccountService,capabilities,cleanConfig,OFFLINE_GRACE_MS}=require('../electron/account');
const config={supabaseUrl:'https://baymax-test.supabase.co',supabaseAnonKey:'sb_publishable_fixture'};
const now=Date.now(),saved={user:{id:'alice'},planChosen:true,verifiedAt:now,snapshot:{profile:{username:'alice'},entitlement:{plan:'free'},pair:null}};
test('Free keeps local tasks/Groq/solo music; paid pairs unlock Live, Focus and Listen Together within bounded grace',()=>{
 let c=capabilities(config,saved,now);for(const key of ['local','groq','tasks','musicSolo'])assert.equal(c[key],true);
 for(const key of ['gemini','productivity','listenTogether','cloud','pcControl'])assert.equal(c[key],false);
 const paid=structuredClone(saved);paid.snapshot.entitlement={plan:'duo',provider:'manual_grant',periodEnd:new Date(now+5*86400000).toISOString()};paid.snapshot.pair={backend_kind:'cloud',cloudEligible:true};
 c=capabilities(config,paid,now);for(const key of ['gemini','productivity','listenTogether','cloud','pcControl'])assert.equal(c[key],true);
 assert.equal(capabilities(config,paid,now+OFFLINE_GRACE_MS+1).gemini,false);
 assert.equal(capabilities(config,paid,now-600000).gemini,false);
 paid.snapshot.pair.cloudEligible=false;assert.equal(capabilities(config,paid,now).listenTogether,false);
 assert.equal(capabilities({},null).gemini,true);assert.equal(capabilities({},null).pcControl,true);
});
test('Public config rejects service-role keys and untrusted project endpoints',()=>{
 assert.throws(()=>cleanConfig({...config,supabaseUrl:'http://localhost:5555'}),/HTTPS/);
 assert.throws(()=>cleanConfig({...config,supabaseAnonKey:'x.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.x'}),/public/);
 assert.equal(cleanConfig(config).supabaseUrl,config.supabaseUrl);
});
function fixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'baymax-account-'));const key=crypto.randomBytes(32);const encrypt=s=>{const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),data=Buffer.concat([cipher.update(s,'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),data]);};
 const decrypt=b=>{const cipher=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString();};
 const urls=[],requests=[];let authRefresh=0;
 const service=new AccountService({folder,environment:{},now:()=>now,openExternal:async url=>urls.push(url),safeStorage:{isEncryptionAvailable:()=>true,encryptString:encrypt,decryptString:decrypt},request:async(url,options)=>{
  requests.push({url,options});const body=options.body&&JSON.parse(options.body);
  let data={};if(url.includes('grant_type=pkce'))data={access_token:'access-private',refresh_token:'refresh-private',expires_in:3600};
  else if(url.includes('grant_type=refresh_token')){authRefresh++;await new Promise(r=>setTimeout(r,15));data={access_token:'refreshed',refresh_token:'refresh-rotated',expires_in:3600};}
  else if(url.endsWith('/user'))data={id:'alice',email:'alice@example.com',app_metadata:{providers:['google']},user_metadata:{full_name:'Alice'}};
  else if(url.endsWith('/get_my_account'))data=structuredClone(saved.snapshot);
  else if(url.includes('/profiles?'))data=[{...body}];
  else if(url.endsWith('/claim_beta_membership'))data={plan:body.p_plan,periodEnd:new Date(now+365*86400000).toISOString()};
  else if(url.endsWith('/billing'))data={url:'https://rzp.io/test',intentId:'intent'};
  else if(url.endsWith('/revoke_partner_seat'))data={success:true,revokedUser:'bob'};
  else if(url.includes('/seats?'))data=[{subscription_id:'sub-123',user_id:'bob',state:'active'}];
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 }});
 service.config=cleanConfig(config);t.after(()=>{service.dispose();fs.rmSync(folder,{recursive:true,force:true});});return {service,urls,requests,folder,refreshes:()=>authRefresh};
}
test('Google PKCE validates state, persists encrypted tokens, prevents replay and coalesces refresh',async t=>{
 const {service,urls,requests,folder,refreshes}=fixture(t);
 await service.startLogin();const authorization=new URL(urls[0]),callback=new URL(authorization.searchParams.get('redirect_to'));
 assert.equal(authorization.searchParams.get('provider'),'google');assert.equal(authorization.searchParams.get('code_challenge_method'),'s256');
 const attempt=service.login;assert.equal(authorization.searchParams.get('code_challenge'),crypto.createHash('sha256').update(attempt.verifier).digest('base64url'));
 const wrong=new URL(callback);wrong.searchParams.set('state','bad');wrong.searchParams.set('code','code');assert.equal((await fetch(wrong)).status,400);assert.equal(requests.length,0);
 callback.searchParams.set('code','one-use');assert.equal((await fetch(callback)).status,200);
 await new Promise(r=>setTimeout(r,20));assert.equal(service.snapshot().user.id,'alice');assert.equal(service.snapshot().capabilities.gemini,false);
 assert.equal(service.login,null);assert.equal(requests.filter(r=>r.url.includes('grant_type=pkce')).length,1);
 const disk=fs.readFileSync(path.join(folder,'account.dpapi.json'),'utf8');assert.ok(!disk.includes('refresh-private'));assert.ok(!disk.includes('access-private'));
 service.saved.session.expires_at=1;assert.deepEqual(await Promise.all([service.token(),service.token(),service.token()]),['refreshed','refreshed','refreshed']);assert.equal(refreshes(),1);
 service.config.razorpayKeyId='rzp_test_fixture';await service.billing('createCheckout',{});assert.equal(service.caps.gemini,false,'opening checkout cannot grant Pro');
 await service.logout(false);assert.equal(service.caps.local,false);assert.equal(fs.existsSync(service.sessionFile),false);
});
test('Native IPC and action gates reject premium/PC paths while Free solo playback and own tasks remain usable',t=>{
 const {service}=fixture(t);service.saved=structuredClone(saved);
 for(const ipc of ['music-search','music-resolve','music-save','save-schedule-item','chat-send','launch-app','close-app'])assert.doesNotThrow(()=>service.guardIPC(ipc,[]));
 for(const ipc of ['start-focus-session','get-tracked-apps','marklv-launch-hud','request-remote-access'])assert.throws(()=>service.guardIPC(ipc,[]));
 assert.throws(()=>service.guardIPC('music-signal',[{type:'join'}]));assert.throws(()=>service.guardAction('control_app',{action:'music',command:'join'}));assert.throws(()=>service.guardAction('computer_control',{}));
 assert.doesNotThrow(()=>service.guardAction('manage_schedule',{}));
});
test('Username reservation writes profiles directly and beta checkout calls the authenticated 365-day grant',async t=>{
 const {service,requests,urls}=fixture(t);service.saved={...structuredClone(saved),session:{access_token:'private',expires_at:Math.floor(now/1000)+3600}};
 await assert.rejects(service.action('reserve',{username:'Not Valid'}),/lowercase/);
 await service.action('reserve',{username:'alice',displayName:'Alice'});
 const write=requests.find(r=>r.url.includes('/rest/v1/profiles?'));
 assert.ok(write);assert.equal(JSON.parse(write.options.body).user_id,'alice');assert.match(write.options.headers.Prefer,/merge-duplicates/);
 assert.ok(!requests.some(r=>r.url.includes('/functions/v1/account')));
 const beta=await service.billing('createCheckout',{priceCode:'duo_monthly',partnerUsername:'@bella'});
 assert.equal(beta.testing,true);assert.equal(Date.parse(beta.periodEnd)-now,365*86400000);assert.equal(urls.length,0);
 const rpc=requests.find(r=>r.url.endsWith('/claim_beta_membership'));assert.deepEqual(JSON.parse(rpc.options.body),{p_plan:'duo',p_partner_username:'bella'});
 assert.equal(rpc.options.headers.authorization,'Bearer private');
});
test('Razorpay verifies raw HMAC, uses server plan amount and cancels at period end',async()=>{
 const out=require('esbuild').buildSync({entryPoints:['supabase/functions/_shared/razorpay.ts'],bundle:true,platform:'node',format:'cjs',write:false});const module={exports:{}};new Function('module','exports',out.outputFiles[0].text)(module,module.exports);const {Razorpay,subscriptionState}=module.exports;
 const calls=[],plan={code:'pro_monthly',provider_plan_id:'plan_test',amount:19900,currency:'INR',period:'monthly',total_count:120};
 const provider=new Razorpay('rzp_test_fixture','server-only','webhook-only',async(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body)});return Response.json(url.includes('/plans/')?{id:'plan_test',item:{amount:19900,currency:'INR'},period:'monthly',interval:1}:{id:'sub_test',short_url:'https://rzp.io/testing'});});
 const raw=Buffer.from('{"event":"subscription.charged"}'),sig=crypto.createHmac('sha256','webhook-only').update(raw).digest('hex');
 assert.equal(await provider.verifyWebhook(raw,sig),true);assert.equal(await provider.verifyWebhook(Buffer.concat([raw,Buffer.from(' ')]),sig),false);assert.equal(await provider.verifyWebhook(raw,'0'.repeat(64)),false);
 await provider.createCheckout(plan,{id:'intent',purchaser_id:'alice'});assert.equal(calls[1].body.notes.baymax_purchaser,'alice');assert.equal(calls[1].body.plan_id,'plan_test');
 await provider.cancelAtPeriodEnd('sub_test');assert.equal(calls.at(-1).body.cancel_at_cycle_end,1);
 assert.equal(subscriptionState({status:'active',paid_count:0,current_end:Date.now()/1000+5000},'subscription.activated'),'pending');
});

test('end-pair and revoke-seat revoke partner seats on Duo subscriptions', async t => {
 const {service, requests} = fixture(t);
 service.saved = {
  user: {id: 'alice'},
  session: {access_token: 'private', expires_at: Math.floor(now/1000) + 3600},
  snapshot: {
   profile: {username: 'alice'},
   entitlement: {plan: 'duo', purchaserId: 'alice', subscriptionId: 'sub-123'},
   pair: {id: 'pair-456', members: [{userId: 'alice', username: 'alice'}, {userId: 'bob', username: 'bob'}]}
  }
 };
 await service.action('revoke-seat');
 const rpcRevoke = requests.find(r => r.url.endsWith('/rpc/revoke_partner_seat'));
 assert.ok(rpcRevoke, 'revoking seat calls rpc/revoke_partner_seat');

 service.saved.snapshot = {
  profile: {username: 'alice'},
  entitlement: {plan: 'duo', purchaserId: 'alice', subscriptionId: 'sub-123'},
  pair: {id: 'pair-456', members: [{userId: 'alice', username: 'alice'}, {userId: 'bob', username: 'bob'}]}
 };
 await service.action('end-pair');
 const unpairPatch = requests.find(r => r.url.includes('/rest/v1/seats?') && r.options.method === 'PATCH');
 assert.ok(unpairPatch, 'end-pair revokes partner seat on purchaser subscription');
 assert.equal(JSON.parse(unpairPatch.options.body).state, 'revoked');
});

