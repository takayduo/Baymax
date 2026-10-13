const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {MusicStore,MusicExtractor,cleanMusicSignal}=require('../electron/music');
const song=(id,title)=>({id,title,artist:'Artist',duration:120});
const first=song('abcdefghijk','First'),second=song('ABCDEFGHIJK','Second');
test('Local playlists persist creation, ordering, removal and selection without losing an invalid file',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'baymax-music-')),store=new MusicStore(folder);
  try{
    const data=store.load();data.playlists[0].tracks=[first,second];data.currentTrackId=first.id;
    data.playlists.push({id:'work',name:'Work',tracks:[second]});store.save(data);
    const read=new MusicStore(folder).load();assert.equal(read.playlists.length,2);assert.equal(read.currentTrackId,first.id);
    read.playlists[0].tracks.reverse();store.save(read);assert.equal(store.load().playlists[0].tracks[0].id,second.id);
    read.playlists[0].tracks.pop();read.activePlaylistId='work';read.currentTrackId=second.id;store.save(read);
    assert.equal(store.load().activePlaylistId,'work');assert.equal(store.load().playlists[0].tracks.length,1);
    assert.throws(()=>store.save({...read,playlists:[{id:'bad',tracks:[{id:'file:///private'}]}]}));
    fs.writeFileSync(store.file,'broken json');assert.throws(()=>store.load(),/preserved/);assert.equal(fs.readFileSync(store.file,'utf8'),'broken json');
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('Music resolver uses bounded shell-free yt-dlp requests and only returns approved HTTPS media URLs',async()=>{
  const calls=[];
  const runner=new MusicExtractor(()=>({file:'python.exe',prefix:['-m','yt_dlp'],runtime:'electron.exe'}),(_file,args,options,done)=>{
    calls.push({args,options});setImmediate(()=>done(null,args.includes('-g')?'https://rr1.googlevideo.com/audio?expires=123':JSON.stringify({entries:[{...first,uploader:'Artist'}]})));return {kill(){}};
  });
  assert.equal((await runner.search('artist & song'))[0].id,first.id);
  assert.ok(calls[0].args.includes('ytsearch8:artist & song'));assert.equal(calls[0].options.shell,undefined);
  const [a,b]=await Promise.all([runner.resolve(first.id),runner.resolve(first.id)]);assert.equal(a,b);assert.equal(calls.length,2);
  assert.ok(calls[1].args.includes('-g'));assert.ok(!calls[1].args.includes('-o'));
  await assert.rejects(runner.resolve('--exec evil'));
});
test('Overlapping stream requests queue at three, prefer m4a, and force refresh bypasses in-flight coalescing',async()=>{
  const callbacks=[],calls=[];let active=0,max=0;
  const runner=new MusicExtractor(()=>({file:'python',prefix:[]}),(_file,args,_options,done)=>{
    active++;max=Math.max(max,active);calls.push(args);callbacks.push(()=>{active--;done(null,'https://rr1.googlevideo.com/audio');});return {kill(){}};
  });
  const jobs=Array.from({length:5},(_,i)=>runner.resolve(String(i).padStart(11,'0')));
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,3);
  while(callbacks.length || runner.queue.length){callbacks.shift()?.();await new Promise(r=>setImmediate(r));}
  await Promise.all(jobs);assert.equal(max,3);assert.equal(calls.length,5);assert.match(calls[0][calls[0].indexOf('-f')+1],/^bestaudio\[ext=m4a\]/);
  const first=runner.resolve('abcdefghijk'),refresh=runner.resolve('abcdefghijk',true);await new Promise(r=>setImmediate(r));assert.equal(calls.length,7);
  callbacks.splice(0).forEach(done=>done());await Promise.all([first,refresh]);runner.close();
});
test('Supabase carries validated playlist edits, never playback controls or arbitrary signal types',()=>{
  assert.deepEqual(cleanMusicSignal({type:'status',playing:true,title:'A',queue:[first]}),{type:'status',playing:true,title:'A'});
  assert.throws(()=>cleanMusicSignal({type:'control',sessionId:'test',action:'seek'}));
  assert.throws(()=>cleanMusicSignal({type:'offer',sessionId:'../bad',sdp:'x'}));
  assert.deepEqual(cleanMusicSignal({type:'offer',sessionId:'valid',sdp:'test'}),{type:'offer',sessionId:'valid',sdp:'test'});
});
test('Shared playlist merges offline additions, reorder and tombstones, and persists per project/channel',()=>{
  const {SharedMusicStore}=require('../electron/sharedMusic');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'baymax-shared-'));
  try{
    const a=new SharedMusicStore(folder,'project|a'),b=new SharedMusicStore(folder,'project|b');
    const firstEdit=a.edit([],[first],'me'),secondEdit=b.edit([],[second],'her');
    a.merge(secondEdit);b.merge(firstEdit);assert.deepEqual(a.tracks(),b.tracks());assert.equal(a.tracks().length,2);
    assert.equal(a.tracks().find(t=>t.id===first.id).addedBy,'me');
    const order=a.tracks().reverse(),reordered=a.edit(a.tracks(),order,'me');b.merge(reordered);assert.deepEqual(b.tracks().map(t=>t.id),order.map(t=>t.id));
    const deleted=b.edit(b.tracks(),b.tracks().filter(t=>t.id!==first.id),'her');a.merge(deleted);a.merge(firstEdit);
    assert.deepEqual(a.tracks(),b.tracks());assert.equal(a.tracks().length,1);
    const c=new SharedMusicStore(folder,'project|a');assert.deepEqual(c.tracks(),a.tracks());
    assert.deepEqual(new SharedMusicStore(folder,'different-project|a').tracks(),[]);
    assert.throws(()=>cleanMusicSignal({type:'playlist',entries:[{...firstEdit[0],track:{id:'file://evil'}}]}));
    assert.deepEqual(cleanMusicSignal({type:'playlist',entries:deleted}).entries,deleted);
    // Stale UI editing another song must not erase a newly arrived song.
    a.edit([second],[second,{id:'12345678901',title:'Third',artist:'',duration:10}],'me');
    assert.equal(a.tracks().length,2);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('AI app commands are explicitly bounded and do not accept arbitrary IPC or URLs',()=>{
  const {cleanAppAction}=require('../electron/appActions');
  assert.equal(cleanAppAction({action:'music',command:'join'}).command,'join');
  assert.equal(cleanAppAction({action:'open_view',view:'tasks'}).view,'tasks');
  assert.equal(cleanAppAction({action:'emote',emote:'dizzy'}).emote,'dizzy');
  assert.throws(()=>cleanAppAction({action:'shell',command:'anything'}));
  assert.throws(()=>cleanAppAction({action:'music',command:'volume',volume:101}));
  assert.throws(()=>cleanAppAction({action:'open_view',view:'https://example.com'}));
});
test('Playback advances sequentially, stops at the end, preserves seek and rejects invalid peer state',()=>{
  const code=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src/music/model.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
  const module={exports:{}};new Function('module','exports',code)(module,module.exports);
  const {emptyPlayback,reducePlayback,positionAt,parsePlayback}=module.exports;
  let state=reducePlayback(emptyPlayback(),{type:'queue',tracks:[first,second],index:0,playing:true},1000);
  assert.equal(positionAt(state,2500),1.5);
  state=reducePlayback(state,{type:'next'},3000);assert.equal(state.index,1);assert.equal(state.playing,true);assert.equal(state.position,0);
  state=reducePlayback(state,{type:'seek',position:15},3000);assert.equal(positionAt(state,4000),16);
  state=reducePlayback(state,{type:'pause'},4000);assert.equal(positionAt(state,8000),16);
  state=reducePlayback(state,{type:'next'},8000);assert.equal(state.index,1);assert.equal(state.playing,false);
  assert.throws(()=>parsePlayback({...state,queue:[{id:'https://evil.test',title:'x'}]}));
  assert.throws(()=>reducePlayback(state,{type:'seek',position:NaN}));
  state=reducePlayback(state,{type:'repeat',mode:'one'});state=reducePlayback(state,{type:'ended'});assert.equal(state.index,1);assert.equal(state.position,0);assert.equal(state.playing,true);
  state=reducePlayback(state,{type:'next'});assert.equal(state.playing,false);
  state=reducePlayback(state,{type:'repeat',mode:'all'});state=reducePlayback(state,{type:'play'});state=reducePlayback(state,{type:'ended'});assert.equal(state.index,0);assert.equal(state.playing,true);
  assert.equal(parsePlayback(state).repeat,'all');assert.throws(()=>reducePlayback(state,{type:'repeat',mode:'evil'}));
  assert.equal(cleanMusicSignal({type:'leave',sessionId:'test'}).type,'leave');
});
