import {body,checked,env,hash,identity,randomToken,serve,text,username,uuid,endpoint} from '../_shared/http.ts';
import {migration} from '../_shared/migration.ts';

export const handler=serve(async req=>{
 const {db,user,token}=await identity(req);const b=await body(req),actor=user.id;
 const rpc=async(name:string,args:any)=>checked(await db.rpc(name,args));
 await rpc('limit_action',{p_actor:actor,p_action:'account',p_limit:120,p_seconds:60});
 if(b.op.startsWith('migration-'))return migration(db,actor,token,b);
 switch(b.op){
 case 'snapshot':return rpc('account_snapshot',{p_actor:actor});
 case 'reserve':await rpc('reserve_username',{p_actor:actor,p_username:username(b.username),p_display:text(b.displayName||user.user_metadata.full_name||b.username,80),p_avatar:user.user_metadata.avatar_url||''});break;
 case 'lookup':{
  await rpc('limit_action',{p_actor:actor,p_action:'lookup',p_limit:30,p_seconds:3600});
  const found=checked(await db.from('profiles').select('user_id,username,display_name,avatar_url').eq('username',username(b.username)).maybeSingle());
  if(!found || found.user_id===actor)return {profile:null};
  const blocks=checked(await db.from('blocks').select('blocker_id').or(`and(blocker_id.eq.${actor},blocked_id.eq.${found.user_id}),and(blocker_id.eq.${found.user_id},blocked_id.eq.${actor})`));
  return {profile:blocks?.length?null:found};
 }
 case 'invite':{
  const recipient=b.username?checked(await db.from('profiles').select('user_id').eq('username',username(b.username)).single())!.user_id:null;
  const inviteToken=recipient?null:randomToken();
  const invitation=await rpc('create_partner_invite',{p_actor:actor,p_recipient:recipient,p_token_hash:inviteToken?await hash(inviteToken):null,p_backend:b.backendId?uuid(b.backendId):null});
  return {id:invitation.id,token:inviteToken,expiresAt:invitation.expires_at};
 }
 case 'invite-preview':{
  const id=uuid(b.id),digest=await hash(text(b.token,64));
  const inv=checked(await db.from('partner_invites').select('id,sender_id,backend_id,expires_at').eq('id',id).eq('token_hash',digest).eq('status','pending').gt('expires_at',new Date().toISOString()).maybeSingle());
  if(!inv)throw new Error('Invitation expired or unavailable');
  const profile=checked(await db.from('profiles').select('username,display_name').eq('user_id',inv.sender_id).single());return {...inv,profile};
 }
 case 'accept':await rpc('accept_partner_invite',{p_actor:actor,p_invite:uuid(b.id),p_token_hash:b.token?await hash(text(b.token,64)):null,p_custom_consent:b.customConsent===true});break;
 case 'decline':case 'revoke':{
  checked(await db.from('partner_invites').update({status:b.op==='decline'?'declined':'revoked',token_hash:null}).eq('id',uuid(b.id)).eq(b.op==='decline'?'recipient_id':'sender_id',actor).eq('status','pending'));break;
 }
 case 'end-pair':{
  const snapshot=await rpc('account_snapshot',{p_actor:actor});await rpc('end_pair',{p_actor:actor});
  if(snapshot.pair)await db.channel('baymax:'+snapshot.pair.id+':signal',{config:{private:true}}).send({type:'broadcast',event:'revoked',payload:{pairId:snapshot.pair.id}});break;
 }
 case 'block':{
  const blocked=uuid(b.userId);if(blocked===actor)throw new Error('Cannot block yourself');
  const snapshot=await rpc('account_snapshot',{p_actor:actor});
  if(snapshot.pair?.members.some((m:any)=>m.userId===blocked))await rpc('end_pair',{p_actor:actor});checked(await db.from('blocks').upsert({blocker_id:actor,blocked_id:blocked}));
  checked(await db.from('partner_invites').update({status:'revoked',token_hash:null}).or(`and(sender_id.eq.${actor},recipient_id.eq.${blocked}),and(sender_id.eq.${blocked},recipient_id.eq.${actor})`).eq('status','pending'));break;
 }
 case 'backend-prepare':{
  const url=endpoint(b.endpoint),challenge=randomToken();
  const row=checked(await db.from('custom_backends').insert({owner_id:actor,endpoint:url,public_key:text(b.publicKey,4096),challenge_hash:await hash(challenge),challenge_expires_at:new Date(Date.now()+86400000).toISOString()}).select('id').single());
  if(!row)throw new Error('Connection could not be prepared');return {backendId:row.id,ownerId:actor,challenge,templateVersion:1,centralUrl:env('SUPABASE_URL')};
 }
 case 'backend-confirm':{
  const row=checked(await db.from('custom_backends').select('*').eq('id',uuid(b.id)).eq('owner_id',actor).eq('status','pending').single());
  if(Date.parse(row.challenge_expires_at)<Date.now())throw new Error('Setup challenge expired');
  const response=await fetch(endpoint(row.endpoint),{method:'POST',headers:{authorization:'Bearer '+token,apikey:row.public_key,'content-type':'application/json'},body:JSON.stringify({op:'setup',backendId:row.id}),signal:AbortSignal.timeout(15000),redirect:'error'});
  const proof=await response.json();if(!response.ok || proof.version!==1 || proof.ownerId!==actor || proof.backendId!==row.id || await hash(String(proof.challenge))!==row.challenge_hash)throw new Error('Database ownership challenge failed');
  checked(await db.from('custom_backends').update({status:'ready',challenge_hash:null,challenge_expires_at:null}).eq('id',row.id).eq('status','pending'));break;
 }
 case 'membership':{
  const snapshot=await rpc('account_snapshot',{p_actor:actor}),pair=snapshot.pair;
  if(pair&&pair.id===uuid(b.pairId)&&b.migrationId){
   const change=checked(await db.from('backend_switches').select('*').eq('id',uuid(b.migrationId)).eq('pair_id',pair.id).eq('status','copying').gt('lease_until',new Date().toISOString()).single());
   if(!change||await hash(String(b.ticket))!==change.ticket_hash||![change.backend_id,change.previous_backend_id].includes(uuid(b.backendId)))throw new Error('Migration access denied');
   return {userId:actor,pairId:pair.id,backendId:b.backendId,members:pair.members,migration:{id:change.id,target:change.backend_id===b.backendId},expiresAt:Date.now()+15000};
  }
  if(!pair || pair.id!==uuid(b.pairId) || pair.backend_kind!=='custom' || pair.backend?.id!==uuid(b.backendId))throw new Error('Pair access revoked');
  const released=checked(await db.from('backend_switches').select('id').eq('pair_id',pair.id).in('status',['committed','cancelled','rolled_back']))||[];
  return {userId:actor,pairId:pair.id,backendId:pair.backend.id,members:pair.members,music:pair.cloudEligible,releaseMigrations:released.map((r:any)=>r.id),frozen:await rpc('backend_frozen',{p_pair:pair.id}),expiresAt:Date.now()+15000};
 }
 case 'export':{
  const s=await rpc('account_snapshot',{p_actor:actor});return {account:s,subscriptions:checked(await db.from('subscriptions').select('id,provider,plan_code,state,period_end').eq('purchaser_id',actor))};
 }
 case 'delete-account':{
  if(b.confirm!=='DELETE')throw new Error('Type DELETE to confirm');
  const subscriptions=checked(await db.from('subscriptions').select('id').eq('purchaser_id',actor).eq('provider','razorpay').in('state',['active','pending','halted']));
  if(subscriptions?.length)throw new Error('Cancel billing and wait until the paid period ends before deleting your account');
  await rpc('end_pair',{p_actor:actor});
  // Retain legally required billing records, but detach public identity and tokens.
  checked(await db.from('profiles').delete().eq('user_id',actor));checked(await db.auth.admin.updateUserById(actor,{ban_duration:'876000h',user_metadata:{deleted:true}}));
  return {deleted:true};
 }
 default:throw new Error('Unknown account operation');
 }
 return rpc('account_snapshot',{p_actor:actor});
});
Deno.serve(handler);
