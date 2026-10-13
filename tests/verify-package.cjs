// Check that the distributable contains the current build, not stale resources.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),app=path.join(root,'release/win-unpacked/resources/app');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk=folder=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(folder,e.name)):[path.join(folder,e.name)]);
const checked=[];
function same(source,destination){assert.equal(hash(destination),hash(source),`Stale package: ${destination}`);checked.push(path.relative(root,source).replaceAll('\\','/'));}
for(const folder of ['dist','productivity/dist'])for(const file of walk(path.join(root,folder)))if(!file.endsWith('.map'))same(file,path.join(app,path.relative(root,file)));
for(const file of walk(path.join(root,'electron')))if(/\.(?:js|cjs|ps1|sql)$/.test(file))same(file,path.join(app,path.relative(root,file)));
for(const file of ['electron/cloud-config.json','public/remote-viewer.html','public/companions/catalog.json','public/companions/accessories.json'])same(path.join(root,file),path.join(app,file));
for(const file of ['core/prompt.txt',...fs.readdirSync(path.join(root,'engine/actions')).filter(f=>f.endsWith('.py')).map(f=>'actions/'+f)])same(path.join(root,'engine',file),path.join(root,'release/win-unpacked/resources/engine/_internal',file));
same(path.join(root,'build/engine/BaymaxEngine/BaymaxEngine.exe'),path.join(root,'release/win-unpacked/resources/engine/BaymaxEngine.exe'));
const file='Baymax-Setup-1.0.1-x64.exe',installer=path.join(root,'release',file),buffer=fs.readFileSync(installer);
const pe=buffer.readUInt32LE(0x3c),optional=pe+24,dataDirectories=optional+(buffer.readUInt16LE(optional)===0x20b?112:96);
const certificateSize=buffer.readUInt32LE(dataDirectories+4*8+4);
const verification={date:new Date().toISOString().slice(0,10),file,bytes:buffer.length,mebibytes:Number((buffer.length/1024/1024).toFixed(1)),sha256:hash(installer),signature:certificateSize?'Certificate table present (verify Authenticode separately)':'NotSigned',source:root,checkedResources:checked,packagedSmoke:'audit/packaged-smoke-results.json',liveMusicAttempt:'audit/packaged-live-attempt.json',buildLog:'audit/windows-package-onboarding.log'};
fs.writeFileSync(path.join(root,'release/SHA256SUMS.txt'),verification.sha256+'  '+file+'\n');
fs.writeFileSync(path.join(root,'audit/release-verification.json'),JSON.stringify(verification,null,2)+'\n');
console.log(JSON.stringify({...verification,checkedResources:checked.length},null,2));
