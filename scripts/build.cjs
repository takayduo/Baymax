const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
function node(script, args=[], cwd=root) { execFileSync(process.execPath, [path.join(cwd,script),...args],{cwd,stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}); }
node('node_modules/typescript/bin/tsc',['--noEmit']);
node('node_modules/typescript/bin/tsc',['--noEmit'],path.join(root,'productivity'));
execFileSync(process.execPath,['--test','tests/regressions.cjs'],{cwd:root,stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
node('node_modules/vite/bin/vite.js',['build']);
node('node_modules/vite/bin/vite.js',['build'],path.join(root,'productivity'));
let revision='local',dirty=true;try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim();}catch{}
fs.writeFileSync(path.join(root,'dist','build-info.json'),JSON.stringify({revision,dirty,builtAt:new Date().toISOString()},null,2));
console.log('Both frontends passed type checks, regression tests and production builds.');
