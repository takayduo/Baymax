const { randomUUID } = require('node:crypto');
function version(t) { return [Number(t.updatedAt || t.createdAt) || 0, t.deleted ? 1 : 0, String(t.revision || ''), JSON.stringify([t.title,t.time,t.assignee,t.completed])]; }
function compare(a,b) { const aa=version(a),bb=version(b);for(let i=0;i<aa.length;i++){if(aa[i]>bb[i])return 1;if(aa[i]<bb[i])return -1;}return 0; }
function mergeTasks(...lists) {
  const map=new Map();for(const list of lists) for(const t of list || []) {
    if(!t || typeof t.id!=='string' || !t.id || typeof t.title!=='string') continue;
    const old=map.get(t.id); if(!old || compare(t,old)>0) map.set(t.id,{...t});
  }
  return [...map.values()].sort((a,b)=>(a.createdAt || 0)-(b.createdAt || 0) || a.id.localeCompare(b.id));
}
function stampTasks(items, previous, now=Date.now()) {
  const old=new Map(previous.map(t=>[t.id,t]));
  for(const t of items) {
    const before=old.get(t.id);
    if(!before || (JSON.stringify([t.title,t.time,t.assignee,t.completed,t.deleted])!==JSON.stringify([before.title,before.time,before.assignee,before.completed,before.deleted]) && (compare(t,before)<=0 || (t.updatedAt===before.updatedAt && t.revision===before.revision)))) {
      t.updatedAt=Math.max(now,(before?.updatedAt || 0)+1);t.revision=randomUUID();
    }
  }
  return items;
}
module.exports={mergeTasks,stampTasks,compare};
