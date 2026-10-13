import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.3';
const env=(key:string)=>Deno.env.get(key)||'';
const central=env('BAYMAX_CENTRAL_URL');
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(central))throw new Error('Pin the central project URL');
const jwks=createRemoteJWKSet(new URL(central+'/auth/v1/.well-known/jwks.json'),{cacheMaxAge:600000,cooldownDuration:30000});
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const id=(v:any)=>{if(typeof v!=='string'||!/^[0-9a-f-]{36}$/i.test(v))throw new Error('Invalid ID');return v;};
const checked=(r:any)=>{if(r.error)throw new Error(r.error.message);return r.data;};
const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
Deno.serve(async req=>{
 try{
  if(req.method!=='POST')throw new Error('POST required');
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
  const {payload}=await jwtVerify(token,jwks,{issuer:central+'/auth/v1',audience:'authenticated',algorithms:['ES256','RS256']});
  const actor=id(payload.sub),raw=await req.text();if(raw.length>1000000)throw new Error('Request too large');const b=JSON.parse(raw);if(!String(b.op).startsWith('migration-')&&raw.length>64000)throw new Error('Request too large');
  if(id(b.backendId)!==env('BAYMAX_BACKEND_ID'))throw new Error('Wrong backend');
  if(b.op==='setup'){
   if(actor!==env('BAYMAX_OWNER_ID')||!env('BAYMAX_SETUP_CHALLENGE'))throw new Error('Setup ownership denied');
   checked(await db.from('baymax_template').select('version').eq('version',1).single());
   return json({version:1,backendId:b.backendId,ownerId:actor,challenge:env('BAYMAX_SETUP_CHALLENGE')});
  }
  // Online membership verification on EVERY operation makes revocation fail closed.
  const proof=await fetch(central+'/functions/v1/account',{method:'POST',headers:{authorization:'Bearer '+token,apikey:env('BAYMAX_CENTRAL_PUBLIC_KEY'),'content-type':'application/json'},body:JSON.stringify({op:'membership',pairId:id(b.pairId),backendId:b.backendId,...(String(b.op).startsWith('migration-')?{migrationId:id(b.migrationId),ticket:b.ticket}:{})}),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!proof.ok)throw new Error('Pair access revoked or central verification unavailable');const membership=await proof.json();
  if(membership.userId!==actor || membership.pairId!==b.pairId || membership.backendId!==b.backendId || membership.expiresAt<Date.now())throw new Error('Invalid membership');
  const pair=b.pairId;
  if(membership.migration){
   if(b.op==='migration-freeze'){checked(await db.rpc('baymax_freeze',{p_pair:pair,p_migration:membership.migration.id}));return json({frozen:true});}
   if(!['messages','tasks'].includes(b.table))throw new Error('Invalid table');
   if(b.op==='migration-count'&&membership.migration.target){const r=await db.from('baymax_'+b.table).select('id',{count:'exact',head:true}).eq('pair_id',pair);checked(r);return json({count:r.count});}
   if(b.op==='migration-read'&&!membership.migration.target){let q=db.from('baymax_'+b.table).select('*').eq('pair_id',pair).order('id').limit(50);if(b.cursor)q=q.gt('id',id(b.cursor));const items=checked(await q);return json({items,cursor:items.length===50?items.at(-1).id:null});}
   if(b.op==='migration-import'&&membership.migration.target){
    if(!Array.isArray(b.items)||b.items.length>50||b.items.some((r:any)=>r.pair_id!==pair||!membership.members.some((m:any)=>m.userId===(b.table==='messages'?r.sender_id:r.updated_by))))throw new Error('Invalid migration records');
    checked(await db.from('baymax_'+b.table).upsert(b.items,{onConflict:'pair_id,id'}));return json({copied:true});
   }
   if(b.op==='migration-verify'&&membership.migration.target&&Array.isArray(b.ids)&&b.ids.length<=50)return json({items:checked(await db.from('baymax_'+b.table).select('*').eq('pair_id',pair).in('id',b.ids.map(id)))});
   throw new Error('Migration operation denied');
  }
  if(membership.releaseMigrations?.length)checked(await db.from('baymax_pair_locks').delete().eq('pair_id',pair).in('migration_id',membership.releaseMigrations));
  if(membership.frozen&&(['message','task'].includes(b.op)||(b.op==='signal'&&b.kind==='chat-live')))throw new Error('Database migration in progress');
  if(b.op==='messages'||b.op==='tasks'){
   let q=db.from('baymax_'+b.op).select('*').eq('pair_id',pair).order('id').limit(200);if(b.cursor)q=q.gt('id',id(b.cursor));const items=checked(await q);return json({items,cursor:items.length===200?items.at(-1).id:null});
  }
  if(b.op==='message'){
   if(typeof b.text!=='string'||b.text.length>12000||!b.text.trim())throw new Error('Invalid message');
   checked(await db.rpc('baymax_write_message',{p_actor:actor,p_pair:pair,p_id:id(b.id),p_text:b.text}));return json({saved:true});
  }
  if(b.op==='task'){
   if(!b.body||typeof b.body.title!=='string'||b.body.title.length>500||JSON.stringify(b.body).length>3000||!['me','her','both'].includes(b.body.assignee))throw new Error('Invalid task');
   const task=checked(await db.rpc('baymax_write_task',{p_actor:actor,p_pair:pair,p_id:id(b.id),p_body:b.body,p_revision:Number(b.expectedRevision)||0}));return json({saved:true,task});
  }
  if(b.op==='signal'){
   if(!['voice','music','remote','presence','chat-live','chat-hint','schedule-hint'].includes(b.kind)||!b.value||JSON.stringify(b.value).length>50000)throw new Error('Invalid signal');
   if(b.kind==='remote'&&(!membership.music||!['request','response','signal','input','end'].includes(b.value.action)||!/^[\w-]{36}$/.test(b.value.sessionId||'')))throw new Error('Remote PC Control requires a paid pair and a valid session');
   if(b.kind==='chat-live'){id(b.value.id);if(typeof b.value.text!=='string'||b.value.text.length>12000)throw new Error('Invalid message');}
   if(b.kind==='music'&&!membership.music&&!['leave','decline'].includes(b.value?.type))throw new Error('Listen Together requires Pro/Duo for both partners');
   const types=b.kind==='voice'?['ring','accept','offer','answer','decline','hangup']:['status','probe','playlist','join','decline','leave','offer','answer'];
   if(['voice','music'].includes(b.kind)&&!types.includes(b.value?.type))throw new Error('Unsupported signal');
   checked(await db.from('baymax_signals').insert({pair_id:pair,sender_id:actor,kind:b.kind,value:b.value}));
   checked(await db.from('baymax_signals').delete().lt('created_at',new Date(Date.now()-900000).toISOString()));return json({sent:true});
  }
  if(b.op==='poll'){
   const after=Number(b.cursor)||0;if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid cursor');
   const items=checked(await db.from('baymax_signals').select('*').eq('pair_id',pair).neq('sender_id',actor).gt('id',after).order('id').limit(100));return json({items,cursor:items.at(-1)?.id||after});
  }
  throw new Error('Unsupported adapter operation');
 }catch(e){return json({error:e instanceof Error?e.message:'Access denied'},403);}
});
