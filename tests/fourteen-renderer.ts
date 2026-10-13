import '../src/style.css';
import { VoiceCall, cleanAppearance } from '../src/call/voiceCall';
import { Calls } from '../src/call/player';
import { Bridge } from '../src/core/bridge';
import { State } from '../src/core/state';
import { buildCoupleChat } from '../src/views/coupleChat';
import { buildSchedule } from '../src/views/schedule';
import { voicePicker, VOICES } from '../src/settings/voicePicker';
import { MusicPlayer } from '../src/music/player';
import { verifyFocus } from './focus-renderer';

const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);};
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check:()=>unknown,message:string)=>{for(let i=0;i<400;i++){if(check())return;await wait(25);}throw new Error(message);};
const contexts:AudioContext[]=[];
async function syntheticMic(){
  const context=new AudioContext({sampleRate:48000});contexts.push(context);await context.resume();
  const tone=context.createOscillator(),gain=context.createGain(),out=context.createMediaStreamDestination();
  tone.frequency.value=420;gain.gain.value=.1;tone.connect(gain).connect(out);tone.start();return out.stream;
}
const checks:string[]=[];
function pair(){
  const signals:string[]=[],locksA:boolean[]=[],locksB:boolean[]=[];
  let a:VoiceCall,b:VoiceCall;
  const createPeer=()=>new RTCPeerConnection({iceServers:[]});
  const appearance=()=>cleanAppearance({companion:{avatarId:'neko',styles:{neko:{color:'#ffbbdd',accessory:'bow',markings:'cheeks'}}},headphones:true});
  a=new VoiceCall({createPeer,getMedia:syntheticMic,appearance,signal:async msg=>{signals.push(msg.type);queueMicrotask(()=>void b.signal(msg));return true;},active:async v=>{locksA.push(v);},incoming(){},changed(){}});
  b=new VoiceCall({createPeer,getMedia:syntheticMic,appearance,signal:async msg=>{signals.push(msg.type);queueMicrotask(()=>void a.signal(msg));return true;},active:async v=>{locksB.push(v);},incoming(){},changed(){}});
  (a as any).ring=()=>{};(b as any).ring=()=>{};
  return {a,b,signals,locksA,locksB};
}
(window as any).fourteenTest={async run(){
  const {a,b,signals,locksA,locksB}=pair();
  try{
    await a.call();await until(()=>b.phase==='incoming','Incoming ring missing');
    assert(locksA.at(-1) && locksB.at(-1),'AI not locked while ringing');
    await b.accept();await until(()=>a.phase==='connected' && b.phase==='connected','Real RTC voice connection failed');
    await until(()=>a.remoteLevel>.008 && b.remoteLevel>.008,'Processed audio did not arrive on both peers');
    const stats=await (b as any).pc.getStats();assert([...stats.values()].some((s:any)=>s.type==='inbound-rtp' && s.kind==='audio' && s.packetsReceived>0),'No RTP audio packets');
    assert(b.remoteAppearance.companion.avatarId==='neko' && b.remoteAppearance.headphones,'Caller customization lost');
    const handshake=signals.length;
    a.toggleMute();await until(()=>b.remoteMuted,'Peer mute badge missing');
    assert((a as any).raw.getAudioTracks().every((t:MediaStreamTrack)=>!t.enabled),'Call mute left raw capture enabled');
    await until(()=>a.localLevel===0 && b.remoteLevel===0,'Muted meters did not stop');
    a.toggleMute();await until(()=>!b.remoteMuted && b.remoteLevel>.008,'Unmute did not restore speech');
    a.setCompact(true);assert(a.phase==='connected','Shrinking stopped call');
    await wait(2200);assert(signals.length===handshake,'Heartbeat, mute or speaking levels used cloud signaling');
    checks.push('Two real RTC peers exchange processed RTP audio; mute and avatars sync P2P; levels/heartbeat never use cloud');
    a.end();await until(()=>b.phase==='idle','Hangup not delivered');assert(!locksA.at(-1) && !locksB.at(-1),'AI lock not released');
    assert(!(a as any).raw && !(b as any).context,'Media survived hangup');
    checks.push('Hangup releases both microphone pipelines and restores AI mode');
    await a.signal({type:'hangup',sessionId:'late-ring'});await a.signal({type:'ring',sessionId:'late-ring'});assert(a.phase==='idle','Late ring resurrected a cancelled call');
    await a.call();await until(()=>b.phase==='incoming','Second ring missing');b.decline();await until(()=>!a.active,'Decline did not end caller');
    checks.push('Decline and out-of-order cancellation do not leave ghost ringing sessions');
  }finally{a.end();b.end();}
  const glare=pair();
  try{
    await Promise.all([glare.a.call(),glare.b.call()]);await until(()=>glare.a.phase==='connected' && glare.b.phase==='connected','Simultaneous calls did not merge');
    assert(glare.a.sessionId===glare.b.sessionId,'Two glare sessions remain');
    assert(glare.signals.filter(s=>s==='offer').length===1,'Glare created duplicate offers');
    // Simulate a silent cable pull: no more datachannel packets are processed.
    (glare.a as any).channel.onmessage=null;(glare.a as any).lastSeen=Date.now()-13000;
    await until(()=>!glare.a.active && !glare.b.active,'Heartbeat did not clear a dead peer');
    checks.push('Simultaneous calls merge into one session; a missing heartbeat closes both sides');
  }finally{glare.a.end();glare.b.end();}

  let release!:(stream:MediaStream)=>void;const lock:boolean[]=[];
  const delayed=new VoiceCall({signal:async()=>true,appearance:()=>cleanAppearance(null),active:async v=>{lock.push(v);},changed(){},incoming(){},getMedia:()=>new Promise(resolve=>release=resolve)});
  (delayed as any).ring=()=>{};
  await delayed.signal({type:'ring',sessionId:'slow'});const accepting=delayed.accept();await until(()=>!!release,'Permission request missing');delayed.end();
  const late=await syntheticMic();release(late);await accepting;assert(late.getTracks().every(t=>t.readyState==='ended'),'Late microphone permission leaked capture');
  await delayed.call();(delayed as any).arm(30,'Call was not answered.');await until(()=>!delayed.active,'Unanswered call did not time out');assert(!lock.at(-1),'Timeout left AI muted');
  checks.push('Late microphone permission is disposed after cancellation; unanswered calls time out and release AI');

  Bridge.setVoiceCallActive=async()=>true;Bridge.aiMute=async()=>true;Bridge.aiInterrupt=async()=>true;Bridge.voiceSignal=async()=>true;Bridge.markChatRead=async()=>true;
  State.settings={...State.settings,userName:'Alex',partnerName:'Mira',userRole:'me',micEnabled:false,aiProvider:'gemini'};
  State.partnerOnline=true;State.mode='expanded';State.view='couple-chat';State.partnerChatMessages=[];
  const view=buildCoupleChat({} as any);view.el.classList.add('on');document.querySelector('#gallery')!.append(view.el);view.sync();
  function snapshot(){const copy=view.el.cloneNode(true) as HTMLElement;copy.querySelectorAll('canvas').forEach((canvas,index)=>(canvas as HTMLCanvasElement).getContext('2d')!.drawImage(view.el.querySelectorAll('canvas')[index],0,0));document.querySelector('#gallery')!.append(copy);}
  Bridge.sendChatMessage=async text=>{const msg={id:'sent-once',text,sender:'Alex',senderRole:'me',recipient:'Mira',timestamp:Date.now(),read:false};State.partnerChatMessages.push(msg);return msg;};
  const input=view.el.querySelector<HTMLInputElement>('.chat-input')!;input.value='One message, one bubble';view.el.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await wait(20);view.sync();
  assert(State.partnerChatMessages.length===1 && view.el.querySelectorAll('.couple-bubble').length===1,'Sent message duplicated');input.focus();
  assert(getComputedStyle(input).outlineStyle==='none' && getComputedStyle(input).boxShadow==='none','Partner composer still has outline');
  (Calls as any).ring=()=>{};await Calls.signal({type:'ring',sessionId:'ui-call',appearance:cleanAppearance({companion:{avatarId:'kuma'}})});view.sync();
  assert(State.defaultView()==='couple-chat','Call did not become default reopen view');assert(view.el.textContent!.includes('Accept'),'Incoming call card missing');
  Calls.phase='connected';Calls.startedAt=Date.now();view.sync();assert(view.el.querySelectorAll('.call-avatar').length===2,'Side by side companions missing');
  const fullCanvas=view.el.querySelectorAll('canvas');assert((fullCanvas[0] as HTMLCanvasElement).toDataURL()!==(fullCanvas[1] as HTMLCanvasElement).toDataURL(),'Different companion appearances were lost');
  Calls.localLevel=.05;Calls.remoteLevel=.07;view.tick?.();assert(view.el.querySelectorAll('.speaking').length===2,'Speaking glow missing');
  snapshot();
  Calls.setCompact(true);view.sync();assert(view.el.querySelector('.call-compact') && !view.el.querySelector<HTMLElement>('.chat-log')!.hidden,'Compact call hid text chat');
  snapshot();
  view.el.querySelector<HTMLButtonElement>('.call-expand')!.click();view.sync();assert(!Calls.compact,'Compact header did not expand');
  State.mode='compact';assert(Calls.active,'Idle collapse stopped the call');State.mode='expanded';
  const recreated=buildCoupleChat({} as any);recreated.sync();assert(recreated.el.querySelectorAll('.call-avatar').length===2,'Rebuilt view lost persistent call');
  checks.push('Partner chat deduplicates sender IPC echo; composer outline removed; full/compact call cards survive view recreation and idle');
  Calls.end();view.sync();
  State.schedule=[{id:'task',title:'Plan our weekend',time:'18:00',assignee:'me',assignedBy:'her',completed:false,createdAt:Date.now()}];
  const tasks=buildSchedule({} as any);tasks.el.classList.add('on');document.querySelector('#gallery')!.append(tasks.el);tasks.sync();
  assert(!tasks.el.querySelector('.sched-presence-badge') && !/[👤💖]/u.test(tasks.el.textContent || ''),'Tasks still have presence clutter');

  let selected='Charon';const picker=voicePicker(selected,async id=>{selected=id;return true;});document.querySelector('#gallery')!.append(picker);
  assert(VOICES.length===30 && picker.querySelectorAll('.voice-preview').length===30,'Missing voice previews');
  const originalPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.resolve();
  (picker.querySelector('.voice-preview') as HTMLButtonElement).click();assert(selected==='Charon','Preview changed selected voice');
  (picker.querySelectorAll('.voice-preview')[1] as HTMLButtonElement).click();assert(picker.querySelectorAll('.voice-preview[aria-pressed=true]').length===1,'Multiple samples played');
  (picker.querySelector('.voice-choice') as HTMLButtonElement).click();await wait(10);assert(selected==='Leda','Voice selection not saved');HTMLMediaElement.prototype.play=originalPlay;
  checks.push('Tasks use clean controls; all 30 voice samples preview independently from selection');

  class TestAudio extends EventTarget {src='';preload='';volume=1;currentTime=0;duration=90;playbackRate=1;paused=true;load(){if(this.src)queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));}async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}removeAttribute(){this.src='';}}
  const track={id:'abcdefghijk',title:'Retry test',artist:'',duration:90};let attempts=0;const refreshes:boolean[]=[];
  Bridge.musicLoad=async()=>({version:1,repeat:'off',activePlaylistId:'a',currentTrackId:'',playlists:[{id:'a',name:'A',tracks:[track]}]});Bridge.musicSave=async lib=>lib;
  Bridge.musicResolve=async(_id,refresh=false)=>{attempts++;refreshes.push(refresh);if(attempts<3)throw new Error('temporary');return 'https://rr.googlevideo.com/audio';};
  const audio=new TestAudio(),music=new MusicPlayer(audio as unknown as HTMLAudioElement,async()=>true);await music.command({type:'play'});await until(()=>music.actualPlaying,'First-play retry failed');
  assert(attempts===3 && refreshes.join()==='false,true,true','Retries did not refresh URL');
  await music.command({type:'repeat',mode:'one'});audio.currentTime=90;audio.dispatchEvent(new Event('ended'));await wait(10);assert(audio.currentTime<1 && music.playback.playing,'Repeat one did not restart audio');
  await music.command({type:'repeat',mode:'off'});audio.dispatchEvent(new Event('ended'));assert(!music.playback.playing,'Repeat off did not stop at end');
  checks.push('Stream resolution retries twice with fresh URLs; repeat-one seeks and replays; repeat-off stops at end');
  await verifyFocus();checks.push('Actual FocusOverlay counts down from four, clears at zero, and responds to focus stop and Dismiss');
  for(const context of contexts)await context.close();
  return {checks,errors:[]};
}};
