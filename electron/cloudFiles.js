const fs=require('node:fs'),path=require('node:path');
function validateURL(value,account){const url=new URL(value);if(url.origin!==account.config.supabaseUrl||!url.pathname.startsWith('/storage/v1/object/'))throw new Error('Invalid storage URL');return url.href;}
async function cloudFiles(account,dialog,op,args={}){
 account.require('cloud');const pairId=account.snapshot().pair.id,userId=account.snapshot().user.id;
 const current=()=>{if(account.snapshot().pair?.id!==pairId||account.snapshot().user?.id!==userId)throw new Error('Account or partner changed');account.require('cloud');};
 const api=(op,body={})=>{current();return account.api('content',{...body,op,pairId});};
 if(op==='list'){const files=[];let cursor=null;do{const page=await api('files',{cursor});files.push(...page.items);cursor=page.cursor;}while(cursor);return {files};}
 if(op==='delete')return api('file-delete',{id:args.id});
 if(op==='upload'){
  const selected=await dialog.showOpenDialog({title:'Share a file with your partner',properties:['openFile']});if(selected.canceled)return {cancelled:true};current();
  const file=selected.filePaths[0],stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size<1||stat.size>10485760)throw new Error('Choose a file up to 10 MiB');
  const signed=await api('file-upload',{name:path.basename(file),bytes:stat.size});
  try{const body=await fs.promises.readFile(file);current();if(body.length!==stat.size)throw new Error('File changed during upload');const result=await account.request(validateURL(signed.url,account),{method:'PUT',body,headers:{'content-type':'application/octet-stream'},redirect:'error',signal:AbortSignal.timeout(60000)});if(!result.ok)throw new Error('Upload failed');return {uploaded:true};}
  catch(error){await api('file-delete',{id:signed.id}).catch(()=>{});throw error;}
 }
 if(op==='download'){
  const signed=await api('file-download',{id:args.id}),chosen=await dialog.showSaveDialog({title:'Save partner file',defaultPath:path.basename(signed.file.name)});if(chosen.canceled||!chosen.filePath)return {cancelled:true};current();
  const response=await account.request(validateURL(signed.url,account),{redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('Download unavailable');
  const reader=response.body.getReader(),chunks=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>10485760){await reader.cancel();throw new Error('File is too large');}chunks.push(Buffer.from(part.value));}
  current();await fs.promises.writeFile(chosen.filePath,Buffer.concat(chunks));return {downloaded:true};
 }
 throw new Error('Unknown file operation');
}
module.exports={cloudFiles,validateURL};
