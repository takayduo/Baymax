const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { cleanTrack } = require('./music');

// Per-song Lamport registers preserve unrelated offline edits. Deletions remain
// as tombstones so reconnecting an old PC cannot resurrect a removed song.
function cleanEntry(value) {
  const track = cleanTrack(value?.track);
  if (!Number.isSafeInteger(value?.clock) || value.clock < 1 || value.clock > 1e12 ||
      !['me','her'].includes(value.actor) || !Number.isFinite(value.position) || Math.abs(value.position)>1e9)
    throw new Error('Invalid shared playlist edit');
  return {track,clock:value.clock,actor:value.actor,position:value.position,deleted:!!value.deleted};
}
function compare(a,b) { return a.clock-b.clock || a.actor.localeCompare(b.actor) || Number(a.deleted)-Number(b.deleted); }
class SharedMusicStore {
  constructor(folder, scope) {
    const id=createHash('sha256').update(scope).digest('hex').slice(0,24);
    this.file=path.join(folder,`shared-playlist-${id}.json`);
  }
  load() {
    if(!fs.existsSync(this.file))return [];
    try {const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Array.isArray(data)||data.length>5000)throw Error();return data.map(cleanEntry);}
    catch {throw new Error('Could not read shared playlist. Your local file has been preserved.');}
  }
  write(entries) {
    if(entries.length>5000)throw new Error('Shared playlist history is full. Keep this file as a backup before starting a new channel.');
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    fs.writeFileSync(this.file+'.tmp',JSON.stringify(entries),'utf8');fs.renameSync(this.file+'.tmp',this.file);
  }
  tracks(entries=this.load()) {
    return entries.filter(e=>!e.deleted).sort((a,b)=>a.position-b.position || a.track.id.localeCompare(b.track.id)).slice(0,200).map(e=>e.track);
  }
  merge(incoming) {
    if(!Array.isArray(incoming)||incoming.length>40)throw new Error('Invalid playlist batch');
    const entries=this.load(),map=new Map(entries.map(e=>[e.track.id,e]));let changed=false;
    for(const raw of incoming){const item=cleanEntry(raw),old=map.get(item.track.id);if(!old||compare(item,old)>0){map.set(item.track.id,item);changed=true;}}
    if(changed)this.write([...map.values()]);return changed;
  }
  edit(base, desired, actor) {
    if(!Array.isArray(base)||!Array.isArray(desired)||base.length>200||desired.length>200)throw new Error('Shared playlist supports up to 200 songs');
    base=base.map(cleanTrack);desired=desired.map(cleanTrack);
    if(new Set(desired.map(t=>t.id)).size!==desired.length)throw new Error('Song already in shared playlist');
    const entries=this.load(),map=new Map(entries.map(e=>[e.track.id,e]));
    let clock=Math.max(0,...entries.map(e=>e.clock));const changes=[];
    const next=new Set(desired.map(t=>t.id)),previous=new Set(base.map(t=>t.id));
    for(const old of base)if(!next.has(old.id)){const item={track:old,clock:++clock,actor,position:map.get(old.id)?.position||0,deleted:true};map.set(old.id,item);changes.push(item);}
    // Only locally changed order positions are written; a stale UI cannot erase
    // tracks added by the other PC while this edit was being saved.
    desired.forEach((track,index)=>{
      if(!previous.has(track.id)||base.findIndex(t=>t.id===track.id)!==index){
        const before=desired[index-1],after=desired[index+1];
        const left=before?map.get(before.id)?.position:undefined,right=after?map.get(after.id)?.position:undefined;
        const position=left!=null&&right!=null&&right>left?(left+right)/2:left!=null?left+1:right!=null?right-1:index;
        const item={track:{...track,addedBy:map.get(track.id)?.track.addedBy||actor},clock:++clock,actor,position,deleted:false};
        map.set(track.id,item);changes.push(item);
      }
    });
    this.write([...map.values()]);return changes;
  }
}
module.exports={SharedMusicStore,cleanEntry};
