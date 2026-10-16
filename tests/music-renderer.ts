import { MusicPlayer } from '../src/music/player';
import { Bridge } from '../src/core/bridge';
import { ListenTogether } from '../src/music/peer';
import { emptyPlayback,reducePlayback,type Track } from '../src/music/model';
import { AVATARS,getAppearance,musicAppearance,setMusicHeadphones,setMusicPlayback } from '../src/companion/appearance';
import { drawPortrait,drawCompanionBody,projectHead } from '../src/companion/render';
import { runMusicAction } from '../src/music/actions';
import { musicHeadphonesToggle } from '../src/settings/wardrobe';
const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);};
const until=async(test:()=>unknown)=>{for(let i=0;i<200;i++){if(test())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out waiting for music');};
const songs:Track[]=[{id:'abcdefghijk',title:'First',artist:'A',duration:120},{id:'ABCDEFGHIJK',title:'Second',artist:'B',duration:120}];
class FakeAudio extends EventTarget {
  src='';preload='';volume=.6;currentTime=0;duration=120;playbackRate=1;paused=true;
  load(){queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));}
  async play(){if(this.paused){this.paused=false;this.dispatchEvent(new Event('playing'));}}
  pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
  removeAttribute(){this.src='';}
}
(window as any).musicTest={async run(){
  const checks:string[]=[];
  const saved={version:1,activePlaylistId:'test',currentTrackId:'',playlists:[{id:'test',name:'Saved music',tracks:structuredClone(songs)}]};
  Bridge.musicLoad=async()=>structuredClone(saved);Bridge.musicSave=async lib=>structuredClone(lib);
  const resolved:string[]=[];Bridge.musicResolve=async id=>{resolved.push(id);return 'https://media.invalid/'+id;};
  const audio=new FakeAudio(),player=new MusicPlayer(audio as unknown as HTMLAudioElement,async()=>true);
  await player.command({type:'play'});await until(()=>player.actualPlaying);
  assert(player.current.id===songs[0].id,'Home play did not start saved playlist');
  audio.dispatchEvent(new Event('ended'));await until(()=>player.current.id===songs[1].id && !player.loading);
  assert(resolved.join()===songs.map(t=>t.id).join(),'Sequential playback skipped or repeated a song');
  await player.command({type:'pause'});assert(audio.paused,'Pause failed');
  checks.push('Saved active playlist starts without opening Music; ended advances in order; pause works');
  let finish!: (url:string)=>void;Bridge.musicResolve=()=>new Promise(resolve=>{finish=resolve;});
  await player.command({type:'pick',index:0});await until(()=>player.loading);await player.command({type:'pause'});
  finish('https://media.invalid/late');await until(()=>!player.loading);assert(audio.paused,'Slow extraction ignored Pause');
  checks.push('Pause during stream extraction prevents late autoplay');
  audio.playbackRate=.98;player.peer.leave('Disconnected');assert(audio.playbackRate===1,'Disconnect left local audio slowed down');
  Bridge.musicResolve=async id=>'https://media.invalid/'+id;
  Bridge.musicSearch=async()=>[songs[1]];
  player.library.playlists.push({id:'shared',name:'Our playlist',tracks:[]});
  await runMusicAction(player,{command:'add_shared',query:'Second'});
  assert(player.library.playlists.find(p=>p.id==='shared')!.tracks[0].id===songs[1].id,'AI did not add to shared playlist');
  await runMusicAction(player,{command:'play',query:'Second'});assert(player.actualPlaying && player.current.id===songs[1].id,'AI song play failed');
  await runMusicAction(player,{command:'volume',volume:35});assert(audio.volume===.35,'AI volume failed');
  await runMusicAction(player,{command:'pause'});assert(audio.paused,'AI pause failed');
  checks.push('AI searches and plays built-in music, adds a shared song, adjusts volume and pauses with confirmed results');
  let echoed=0;
  const command=player.command.bind(player);
  player.command=async()=>{echoed++;};player.peer.role='guest';player.peer.state='together';
  const latest=structuredClone(player.library);latest.activePlaylistId='shared';
  Bridge.musicLoad=async()=>structuredClone(latest);player.receiveLibrary(latest);
  await until(()=>player.activePlaylist.id==='shared');assert(echoed===0,'Guest echoed a stale shared-library event as playback control');
  player.command=command;player.peer.leave();
  let offlineJoinFailed=false;
  try{await runMusicAction(player,{command:'join'});}catch{offlineJoinFailed=true;}
  assert(offlineJoinFailed,'AI claimed to join a partner who is not sharing music');
  checks.push('Guest library refresh does not echo stale playback controls; AI rejects unavailable partner music');

  let hostState=reducePlayback(emptyPlayback(),{type:'queue',tracks:songs,index:0,playing:true});
  let guestState=emptyPlayback(),host:ListenTogether,guest:ListenTogether;
  const signaling:string[]=[];
  const createPeer=()=>new RTCPeerConnection({iceServers:[]});
  host=new ListenTogether({createPeer,signal:async msg=>{signaling.push(msg.type);queueMicrotask(()=>void guest.signal(msg));return true;},snapshot:()=>hostState,
    control:action=>{hostState=reducePlayback(hostState,action);host.broadcast();},receive:()=>{},status:()=>{}});
  guest=new ListenTogether({createPeer,signal:async msg=>{signaling.push(msg.type);queueMicrotask(()=>void host.signal(msg));return true;},snapshot:()=>guestState,
    control:()=>{},receive:value=>{guestState=value;},status:()=>{}});
  try{
    await guest.join();await until(()=>host.state==='together' && guest.state==='together' && guestState.queue.length===2);
    const handshake=signaling.length;
    guest.control({type:'seek',position:42});await until(()=>hostState.position===42 && guestState.position===42);
    guest.control({type:'pause'});await until(()=>!hostState.playing && !guestState.playing);
    guest.control({type:'next'});await until(()=>hostState.index===1 && guestState.index===1);
    hostState=reducePlayback(hostState,{type:'previous'});host.broadcast();await until(()=>guestState.index===0);
    assert(signaling.length===handshake,'Ongoing controls used Supabase signaling');
    assert(Math.abs(guestState.at-hostState.at)<250,'Clock offset correction failed');
    checks.push('Real RTCDataChannel joins, shares queue, and applies guest seek/pause/next and host previous without cloud sync messages');
    assert(host.healthy && guest.healthy,'Connected peers did not report healthy data channels');
    const savedPeer=player.peer;
    // Exercise the production presence handler against an actual RTCDataChannel.
    Object.defineProperty(player,'peer',{value:guest,configurable:true});
    player.presence(false);player.presence(false);
    assert(guest.state==='together' && host.state==='together','Cloud Offline notice closed healthy P2P music');
    guest.control({type:'seek',position:63});await until(()=>hostState.position===63 && guestState.position===63);
    Object.defineProperty(player,'peer',{value:savedPeer,configurable:true});
    checks.push('Cloud Offline notices preserve a healthy real P2P session and subsequent two-way controls');
    // Large queue exercises chunking instead of exceeding RTC message limits.
    const large=Array.from({length:200},(_,i)=>({...songs[0],id:String(i).padStart(11,'0'),title:'Long song title '.repeat(10)}));
    hostState=reducePlayback(hostState,{type:'queue',tracks:large,index:123,playing:false});host.broadcast();await until(()=>guestState.queue.length===200);
    assert(guestState.index===123,'Chunked queue was corrupted');
    const before=JSON.stringify(guestState);guest.leave();await until(()=>host.state==='solo');
    assert(JSON.stringify(guestState)===before,'Leaving cleared the local queue');
    checks.push('A 200-song queue is chunked safely; Leave closes peers while preserving playback state');
  }finally{host.leave();guest.leave();}

  const gallery=document.querySelector('#gallery')!;
  setMusicHeadphones(true);setMusicPlayback(true);
  const poseImages=new Set<string>();
  for(const pose of [{yaw:-.6,pitch:0},{yaw:0,pitch:0},{yaw:.6,pitch:0},{yaw:0,pitch:-.4},{yaw:0,pitch:.4}]){
    const picture=document.createElement('canvas');picture.width=120;picture.height=120;const context=picture.getContext('2d')!;
    context.translate(60,60);drawCompanionBody(context,48,44,getAppearance('puff'),pose);poseImages.add(picture.toDataURL());gallery.append(picture);
  }
  assert(poseImages.size===5,'Headphones did not follow head direction');
  const left=projectHead(-.84,0,.04,{yaw:.6,pitch:.3}),right=projectHead(.84,0,.04,{yaw:.6,pitch:.3});
  assert(left.scale>right.scale && left.y!==right.y,'Ear cups lack perspective depth/pitch');
  checks.push('Headphone band and earcups follow five head poses with perspective depth');
  for(const avatar of AVATARS){
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=120;
    const ctx=canvas.getContext('2d')!;setMusicPlayback(false);drawPortrait(ctx,120,getAppearance(avatar.id));const plain=canvas.toDataURL();
    ctx.clearRect(0,0,120,120);setMusicHeadphones(true);setMusicPlayback(true);drawPortrait(ctx,120,getAppearance(avatar.id));
    assert(plain!==canvas.toDataURL(),`${avatar.name} headphones were not drawn`);gallery.append(canvas);
  }
  setMusicPlayback(false,0);setMusicPlayback(true,1000);
  assert(musicAppearance(1200).bob!==0,'Music vibe never started');
  assert(musicAppearance(3001).bob===0 && musicAppearance(3001).tilt===0 && musicAppearance(3001).headphones,'Vibe must settle within two seconds with headphones retained');
  setMusicHeadphones(false);assert(!musicAppearance().headphones,'Wardrobe preference was ignored');
  setMusicHeadphones(true);setMusicPlayback(false);assert(!musicAppearance().headphones,'Paused music still shows headphones');
  let enabled=true;
  const toggle=musicHeadphonesToggle(true,async value=>{enabled=value;setMusicHeadphones(value);return true;});document.body.append(toggle);
  toggle.querySelector('input')!.click();await until(()=>enabled===false);assert(!toggle.querySelector('input')!.checked,'Headphones toggle did not persist');
  checks.push('All 20 companions render headphones; vibe settles by two seconds; pause and Wardrobe toggle hide headphones');
  return {checks,errors:[]};
}};
