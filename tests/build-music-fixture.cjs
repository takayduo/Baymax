const fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'../audit/music-smoke');fs.mkdirSync(out,{recursive:true});
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'music-renderer.ts')],bundle:true,outfile:path.join(out,'renderer.js'),format:'iife'});
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><style>body{background:#111719;color:#ccd8d5;font:16px Segoe UI;padding:16px}#gallery{display:grid;grid-template-columns:repeat(5,1fr)}</style></head><body><h2>Your soundtrack. Their headphones.</h2><div id="gallery"></div><script src="renderer.js"></script></body></html>');
