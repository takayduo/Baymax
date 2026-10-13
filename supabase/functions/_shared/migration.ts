import {checked,endpoint,hash,randomToken,uuid} from './http.ts';
export async function migration(db:any,actor:string,token:string,b:any){
 if(b.op!=='migration-step')return checked(await db.rpc('change_backend',{p_actor:actor,p_operation:b.op.slice(10),p_id:b.id?uuid(b.id):null,p_target:b.backendId?uuid(b.backendId):null}));
 const id=uuid(b.id),snapshot=checked(await db.rpc('account_snapshot',{p_actor:actor})),pair=snapshot.pair;
 if(!pair)throw new Error('Pair access revoked');
 if(pair.backend_kind==='cloud'&&!checked(await db.rpc('cloud_export',{p_pair:pair.id,p_user:actor})))throw new Error('Export window expired');
 const ticket=randomToken(),ticketHash=await hash(ticket);
 const rows=checked(await db.from('backend_switches').update({lease_until:new Date(Date.now()+60000).toISOString(),ticket_hash:ticketHash}).eq('id',id).eq('pair_id',pair.id).eq('status','copying').or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select('*'));
 if(!rows.length)throw new Error('A copy batch is running or migration is complete. Refresh status.');
 const change=rows[0],checkpoint=change.checkpoint;
 if(!change.backend_id&&!pair.cloudEligible){await db.from('backend_switches').update({lease_until:null,ticket_hash:null}).eq('id',id).eq('ticket_hash',ticketHash);throw new Error('Both partners need Pro or Duo for Cloud');}
 const backend=async(key:string|null)=>key?checked(await db.from('custom_backends').select('*').eq('id',key).eq('status','ready').single()):null;
 const source=await backend(change.previous_backend_id),target=await backend(change.backend_id);
 async function custom(server:any,op:string,args:any={}){
  const r=await fetch(endpoint(server.endpoint),{method:'POST',headers:{authorization:'Bearer '+token,apikey:server.public_key,'content-type':'application/json'},body:JSON.stringify({...args,op,pairId:pair.id,backendId:server.id,migrationId:id,ticket}),signal:AbortSignal.timeout(15000),redirect:'error'});
  const result=await r.json();if(!r.ok)throw new Error(result.error||'Migration adapter unavailable');return result;
 }
 try{
  // Both endpoints freeze their own writes before the first copy, including in-flight writes.
  for(const server of [source,target])if(server)await custom(server,'migration-freeze');
  const table=checkpoint.table;if(!['messages','tasks'].includes(table))throw new Error('Invalid checkpoint');
  let page;
  if(source)page=await custom(source,'migration-read',{table,cursor:checkpoint.cursor});
  else{let q=db.from(table).select('*').eq('pair_id',pair.id).order('id').limit(50);if(checkpoint.cursor)q=q.gt('id',checkpoint.cursor);const items=checked(await q);page={items,cursor:items.length===50?items.at(-1).id:null};}
  if(page.items.some((row:any)=>row.pair_id!==pair.id||!pair.members.some((m:any)=>m.userId===(table==='messages'?row.sender_id:row.updated_by))))throw new Error('Source ownership mismatch');
  // Explicit columns prevent a custom host from inserting fields outside the versioned schema.
  const columns=table==='messages'?['pair_id','id','sender_id','body','created_at']:['pair_id','id','updated_by','body','revision','deleted_at','updated_at'];
  const items=page.items.map((row:any)=>Object.fromEntries(columns.map(key=>[key,row[key]])));
  if(items.length){
   if(target)await custom(target,'migration-import',{table,items});
   else checked(await db.from(table).upsert(items,{onConflict:'pair_id,id'}));
   const destination=target?(await custom(target,'migration-verify',{table,ids:items.map((r:any)=>r.id)})).items:checked(await db.from(table).select('*').eq('pair_id',pair.id).in('id',items.map((r:any)=>r.id)));
   const canonical=(row:any)=>JSON.stringify(columns.map(key=>key.endsWith('_at')&&row[key]?new Date(row[key]).toISOString():row[key]));
   if(items.some((row:any)=>!destination.some((copy:any)=>copy.id===row.id&&canonical(copy)===canonical(row))))throw new Error('Copy verification failed; original data is preserved');
  }
  checkpoint.counts[table]+=items.length;checkpoint.cursor=page.cursor;
  let status='copying';if(!page.cursor){if(table==='messages'){checkpoint.table='tasks';checkpoint.cursor=null;}else{
   for(const name of ['messages','tasks']){
    const total=target?(await custom(target,'migration-count',{table:name})).count:(await db.from(name).select('id',{count:'exact',head:true}).eq('pair_id',pair.id)).count;
    if(total!==checkpoint.counts[name])throw new Error('Destination contains additional records. Switch paused; both copies are preserved.');
   }
   status='ready';
  }}
  checked(await db.from('backend_switches').update({checkpoint,status,lease_until:null,ticket_hash:null}).eq('id',id).eq('ticket_hash',ticketHash));
  return {status,checkpoint};
 }catch(error){await db.from('backend_switches').update({lease_until:null,ticket_hash:null}).eq('id',id).eq('ticket_hash',ticketHash);throw error;}
}
