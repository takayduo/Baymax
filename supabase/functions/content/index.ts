import {body,checked,identity,serve,text,uuid} from '../_shared/http.ts';
import {page,signal,taskBody} from '../_shared/content.ts';
export const handler=serve(async req=>{
 const {db,user}=await identity(req),b=await body(req),pair=uuid(b.pairId);
 checked(await db.rpc('limit_action',{p_actor:user.id,p_action:'content',p_limit:180,p_seconds:60}));
 const member=checked(await db.rpc('is_pair_member',{p_pair:pair,p_user:user.id}));if(!member)throw new Error('Pair access revoked');
 if(b.op==='export'){
  if(!checked(await db.rpc('cloud_export',{p_pair:pair,p_user:user.id})))throw new Error('Export window expired');
  if(!['messages','tasks','attachments'].includes(b.table))throw new Error('Invalid export table');return page(db,b.table,pair,b.cursor);
 }
 if(!checked(await db.rpc('cloud_access',{p_pair:pair,p_user:user.id})))throw new Error('Baymax Cloud requires active Pro or Duo for both partners');
 if(['message','task'].includes(b.op)||(b.op==='signal'&&b.kind==='chat-live'))if(checked(await db.rpc('backend_frozen',{p_pair:pair})))throw new Error('Shared data is paused while your database is being copied');
 switch(b.op){
 case 'messages':return page(db,'messages',pair,b.cursor);
 case 'tasks':return page(db,'tasks',pair,b.cursor);
 case 'message':{
  checked(await db.rpc('write_cloud_message',{p_actor:user.id,p_pair:pair,p_id:uuid(b.id),p_text:text(b.text,12000)}));return {saved:true};
 }
 case 'task':{
  const result=checked(await db.rpc('write_cloud_task',{p_actor:user.id,p_pair:pair,p_id:uuid(b.id),p_body:taskBody(b.body),p_revision:Number(b.expectedRevision)||0}));return {saved:true,task:result};
 }
 case 'signal':{
  const payload=signal(b.kind,b.value,checked(await db.rpc('pair_paid',{p_pair:pair})));
  const topic='baymax:'+pair+':'+(b.kind==='music'?'music':['voice','remote','presence'].includes(b.kind)?'signal':'cloud');
  const channel=db.channel(topic,{config:{private:true}});
  const result=await channel.send({type:'broadcast',event:'partner',payload:{senderId:user.id,kind:b.kind,value:payload,at:Date.now()}});
  if(result!=='ok')throw new Error('Partner signaling unavailable');return {sent:true};
 }
 case 'files':return page(db,'attachments',pair,b.cursor);
 case 'file-upload':{
  const size=Number(b.bytes);if(!Number.isInteger(size)||size<1||size>10485760)throw new Error('Maximum attachment size is 10 MiB');
  const id=crypto.randomUUID(),objectPath=pair+'/'+id;
  checked(await db.rpc('reserve_cloud_file',{p_actor:user.id,p_pair:pair,p_id:id,p_name:text(b.name,180),p_bytes:size}));
  const signed=checked(await db.storage.from('baymax-files').createSignedUploadUrl(objectPath));if(!signed)throw new Error('Upload unavailable');return {id,path:objectPath,url:signed.signedUrl};
 }
 case 'file-download':{
  const file=checked(await db.from('attachments').select('*').eq('id',uuid(b.id)).eq('pair_id',pair).single());
  const signed=checked(await db.storage.from('baymax-files').createSignedUrl(file.object_path,120));if(!signed)throw new Error('Download unavailable');return {url:signed.signedUrl,file};
 }
 case 'file-delete':{
  const file=checked(await db.from('attachments').select('*').eq('id',uuid(b.id)).eq('pair_id',pair).eq('owner_id',user.id).single());
  checked(await db.storage.from('baymax-files').remove([file.object_path]));checked(await db.from('attachments').delete().eq('id',file.id).eq('owner_id',user.id));return {deleted:true};
 }
 default:throw new Error('Unknown content operation');
 }
});
Deno.serve(handler);
