import {uuid,text} from './http.ts';
export function signal(kind:string,value:any,musicAllowed:boolean){
 if(!value || typeof value!=='object' || JSON.stringify(value).length>50000)throw new Error('Invalid signal');
 if(kind==='presence')return {online:value.online===true};
 if(kind==='chat-live')return {id:uuid(value.id),text:text(value.text,12000)};
 if(kind==='chat-hint'||kind==='schedule-hint')return {};
 if(kind==='remote'){
  if(!musicAllowed&&value.action!=='end')throw new Error('Remote PC Control requires Pro or Duo for both partners');
  if(!['request','response','signal','input','end'].includes(value.action)||typeof value.sessionId!=='string'||!/^[\w-]{36}$/.test(value.sessionId))throw new Error('Invalid remote session');
  const result:any={action:value.action,sessionId:value.sessionId};
  if(value.action==='response'){result.accepted=value.accepted===true;if(result.accepted){if(value.offer?.type!=='offer'||typeof value.offer.sdp!=='string'||!value.offer.sdp.startsWith('v=0'))throw new Error('Invalid offer');result.offer=value.offer;result.resolution=value.resolution;}}
  if(value.action==='signal'){if(!value.signal||typeof value.signal!=='object'||JSON.stringify(value.signal).length>48000)throw new Error('Invalid signal');result.signal=value.signal;}
  if(value.action==='input'){if(!value.cmd||typeof value.cmd!=='object'||JSON.stringify(value.cmd).length>1000)throw new Error('Invalid input');result.cmd=value.cmd;}
  return result;
 }
 if(kind==='voice'){
  if(!['ring','accept','offer','answer','decline','hangup'].includes(value.type))throw new Error('Unsupported voice signal');
 }else if(kind==='music'){
  if(!['status','probe','playlist','join','decline','leave','offer','answer'].includes(value.type))throw new Error('Unsupported music signal');
  if(!musicAllowed && !['leave','decline'].includes(value.type))throw new Error('Listen Together requires Pro or Duo for both partners');
  if(value.type==='status')return {type:'status',playing:!!value.playing,title:text(value.title||'',180)};
  if(value.type==='probe')return {type:'probe'};
  if(value.type==='playlist'){
   if(!Array.isArray(value.entries)||value.entries.length>40)throw new Error('Invalid playlist signal');
   // Receiver's CRDT validator handles each bounded record; no arbitrary control messages allowed.
   return {type:'playlist',entries:value.entries};
  }
 }else throw new Error('Unsupported signal');
 if(typeof value.sessionId!=='string'||!/^[\w-]{1,80}$/.test(value.sessionId))throw new Error('Invalid session');
 const result:any={type:value.type,sessionId:value.sessionId};
 if(['offer','answer'].includes(value.type)) {result.sdp=text(value.sdp,48000);if(!result.sdp.startsWith('v=0'))throw new Error('Invalid SDP');}
 if(kind==='voice' && ['ring','accept'].includes(value.type) && value.appearance){
  if(JSON.stringify(value.appearance).length>8000)throw new Error('Appearance too large');result.appearance=value.appearance;
 }
 return result;
}
export function taskBody(value:any){
 if(!value||typeof value!=='object')throw new Error('Invalid task');
 if(!['me','her','both'].includes(value.assignee))throw new Error('Invalid assignee');
 return {title:text(value.title,500),time:text(value.time||'',20),assignee:value.assignee,assignedBy:['me','her'].includes(value.assignedBy)?value.assignedBy:'me',completed:value.completed===true,createdAt:Number(value.createdAt)||Date.now(),updatedAt:Number(value.updatedAt)||Date.now(),revision:text(value.revision||'',100),deleted:value.deleted===true};
}
export async function page(db:any,table:string,pair:string,cursor:any){
 let q=db.from(table).select('*').eq('pair_id',uuid(pair)).order('id').limit(200);
 if(cursor)q=q.gt('id',uuid(cursor));const {data,error}=await q;if(error)throw new Error(error.message);
 return {items:data,cursor:data.length===200?data.at(-1).id:null};
}
