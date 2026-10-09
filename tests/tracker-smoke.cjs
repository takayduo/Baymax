// Observe existing foreground activity briefly. No windows are opened, closed,
// focused or controlled, and no production data is read or written.
const {createTracker}=require('../electron/productivity/tracker-runtime');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const data={};
const store={get:(key,fallback)=>key.split('.').reduce((v,k)=>v?.[k],data) ?? fallback,set:(key,value)=>{let row=data;const keys=key.split('.');for(const k of keys.slice(0,-1))row=row[k] ||= {};row[keys.at(-1)]=value;},saveSync:()=>{}};
const monitor=new EventEmitter();monitor.getSystemIdleTime=()=>0;
const AppTracker=createTracker({app:{},powerMonitor:monitor,getLocalDateKey:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,DEFAULT_CATEGORIES:{},ICON_MAP:{},SYSTEM_IGNORED_PROCS:[]});
const tracker=new AppTracker(store,()=>{});tracker.isTracking=true;tracker.spawnTrackerProcess();
setTimeout(()=>{
  try {
    const health=tracker.getHealth(),apps=tracker.getTodayApps();
    assert.equal(health.active,true);assert.equal(tracker.parseErrors,0);
    const result={health,sampledApps:apps.map(a=>({name:a.name,totalSeconds:a.totalSeconds})),note:'Read-only live foreground helper; idle state mocked active; persistence in memory only.'};
    fs.writeFileSync(path.join(__dirname,'../audit/tracker-smoke-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } catch(e){console.error(e);process.exitCode=1;}finally{tracker.stop();}
},9500);
