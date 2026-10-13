// Optional integration probe: metadata and a tiny audio range only, no playback or saved audio.
const fs=require('node:fs'),path=require('node:path');
const {MusicExtractor}=require('../electron/music');
const root=path.resolve(__dirname,'..');
const extractor=new MusicExtractor(()=>({file:process.env.BAYMAX_MUSIC_ENGINE || 'python',prefix:process.env.BAYMAX_MUSIC_ENGINE?['python','-m','yt_dlp']:['-m','yt_dlp'],runtime:process.execPath,pythonPath:path.join(root,'.build-cache/music-core')}));
(async()=>{
  const found=await extractor.search('lofi chill royalty free');
  if(!found.length)throw new Error('No music search results');
  const track=found.find(t=>t.duration>0 && t.duration<600) || found[0];
  const url=await extractor.resolve(track.id);
  const response=await fetch(url,{headers:{Range:'bytes=0-4095'},signal:AbortSignal.timeout(20000)});
  const type=response.headers.get('content-type');
  await response.body?.cancel();
  if(!response.ok)throw new Error(`Music stream returned HTTP ${response.status}`);
  const result={searchResults:found.length,trackId:track.id,audioHost:new URL(url).hostname,httpStatus:response.status,contentType:type,audioSaved:false};
  fs.writeFileSync(path.join(root,'audit/music-live-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>extractor.close());
