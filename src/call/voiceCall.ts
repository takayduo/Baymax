import { normalizePreferences, type CompanionPreferences } from '../companion/appearance';

export interface CallAppearance { companion:CompanionPreferences; headphones:boolean }
export interface VoiceSignal {type:'ring'|'accept'|'offer'|'answer'|'decline'|'hangup';sessionId:string;sdp?:string;appearance?:CallAppearance}
export type CallPhase = 'idle'|'outgoing'|'incoming'|'connecting'|'connected';
interface Options {
  signal(value:VoiceSignal):Promise<boolean>;
  appearance():CallAppearance;
  active(value:boolean):Promise<unknown>;
  changed():void;
  incoming():void;
  createPeer?():RTCPeerConnection;
  getMedia?():Promise<MediaStream>;
  createContext?():AudioContext;
}
export function cleanAppearance(value:any):CallAppearance {
  const companion=normalizePreferences(value?.companion);
  // Only the currently worn avatar travels across the connection.
  const style=companion.styles[companion.avatarId];
  companion.styles=style?{[companion.avatarId]:style}:{};
  return {companion,headphones:value?.headphones===true};
}
export function audioLevel(node:AnalyserNode|null) {
  if(!node)return 0;
  const values=new Float32Array(node.fftSize);node.getFloatTimeDomainData(values);
  return Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
}

/** Owns media independently of any view. Signaling carries no audio or level data. */
export class VoiceCall {
  phase:CallPhase='idle'; sessionId=''; compact=false; muted=false; remoteMuted=false;
  remoteAppearance:CallAppearance=cleanAppearance(null);
  startedAt=0; error=''; localLevel=0; remoteLevel=0;
  private pc:RTCPeerConnection|null=null;
  private channel:RTCDataChannel|null=null;
  private context:AudioContext|null=null;
  private raw:MediaStream|null=null;
  private processed:MediaStream|null=null;
  private remoteAudio:HTMLAudioElement|null=null;
  private localMeter:AnalyserNode|null=null;
  private remoteMeter:AnalyserNode|null=null;
  private gateTimer:ReturnType<typeof setInterval>|undefined;
  private deadline:ReturnType<typeof setTimeout>|undefined;
  private heartbeat:ReturnType<typeof setInterval>|undefined;
  private ringTimer:ReturnType<typeof setInterval>|undefined;
  private ringContext:AudioContext|null=null;
  private lastSeen=0;
  private generation=0;
  private mediaPromise:Promise<void>|null=null;
  private lock:Promise<unknown>=Promise.resolve();
  private closedSessions=new Set<string>();
  private lastAppearance='';
  constructor(private options:Options){}
  private owns(pc:RTCPeerConnection){return this.pc===pc;}
  get active(){return this.phase!=='idle';}
  private notify(){this.options.changed();}
  private arm(ms:number,message:string){clearTimeout(this.deadline);this.deadline=setTimeout(()=>this.end(message),ms);}
  private begin(session:string,phase:CallPhase){
    this.sessionId=session;this.phase=phase;this.error='';this.compact=false;this.muted=false;this.remoteMuted=false;
    this.lock=this.options.active(true);this.lock.catch(()=>{if(this.sessionId===session)this.end('Could not pause the AI microphone.');});
    this.arm(30000,'Call was not answered.');this.notify();
  }
  async call(){
    if(this.active)return;
    this.begin(crypto.randomUUID(),'outgoing');const id=this.sessionId;
    try{
      await this.lock;
      if(this.sessionId!==id)return;
      if(!await this.options.signal({type:'ring',sessionId:id,appearance:cleanAppearance(this.options.appearance())}))throw new Error('Your partner is unavailable.');
    }catch(error){if(this.sessionId===id)this.end(String(error instanceof Error?error.message:error));}
  }
  async signal(message:VoiceSignal){
    if(!message || !/^[\w-]{1,80}$/.test(message.sessionId))return;
    const id=message.sessionId;
    try{
      if(message.type==='ring'){
        if(this.closedSessions.has(id) || id===this.sessionId)return;
        if(this.phase==='outgoing'){
          // Lower invitation ID is the offerer on both PCs. Never create two peers.
          if(this.sessionId<id)return;
          this.remember(this.sessionId);this.cleanup();
          this.begin(id,'incoming');this.remoteAppearance=cleanAppearance(message.appearance);
          await this.accept();return;
        }
        if(this.active){await this.options.signal({type:'decline',sessionId:id});return;}
        this.begin(id,'incoming');this.remoteAppearance=cleanAppearance(message.appearance);
        this.ring();this.options.incoming();this.notify();return;
      }
      if(message.type==='hangup' || message.type==='decline')this.remember(id);
      if(id!==this.sessionId || !this.active)return;
      if(message.type==='hangup' || message.type==='decline'){this.end(message.type==='decline'?'Call declined.':'Call ended.',false);return;}
      if(message.type==='accept' && this.phase==='outgoing'){
        this.phase='connecting';this.remoteAppearance=cleanAppearance(message.appearance);this.arm(30000,'Could not connect directly. These networks may need a TURN relay.');this.notify();
        await this.prepareMedia();if(id!==this.sessionId)return;
        const pc=this.createPeer();this.attach(pc.createDataChannel('baymax-voice',{ordered:true}));
        await pc.setLocalDescription(await pc.createOffer());await this.gather(pc);
        if(this.owns(pc)){
          const sent=await this.options.signal({type:'offer',sessionId:id,sdp:pc.localDescription!.sdp});
          if(this.owns(pc) && !sent)this.end('Could not send call offer.');
        }
      }else if(message.type==='offer' && this.phase==='connecting' && !this.pc){
        await this.prepareMedia();if(id!==this.sessionId || this.pc)return;
        const pc=this.createPeer();pc.ondatachannel=event=>{if(this.pc===pc)this.attach(event.channel);};
        await pc.setRemoteDescription({type:'offer',sdp:message.sdp});
        await pc.setLocalDescription(await pc.createAnswer());await this.gather(pc);
        if(this.owns(pc)){
          const sent=await this.options.signal({type:'answer',sessionId:id,sdp:pc.localDescription!.sdp});
          if(this.owns(pc) && !sent)this.end('Could not answer call.');
        }
      }else if(message.type==='answer' && this.pc?.signalingState==='have-local-offer'){
        await this.pc.setRemoteDescription({type:'answer',sdp:message.sdp});
      }
    }catch(error){if(id===this.sessionId)this.end(`Call could not connect: ${error instanceof Error?error.message:error}`);}
  }
  async accept(){
    if(this.phase!=='incoming')return;
    const id=this.sessionId;this.phase='connecting';this.stopRing();this.arm(30000,'Could not connect directly. These networks may need a TURN relay.');this.notify();
    try{
      await this.prepareMedia();if(this.sessionId!==id)return;
      if(!await this.options.signal({type:'accept',sessionId:id,appearance:cleanAppearance(this.options.appearance())}) && this.sessionId===id)throw new Error('Partner is unavailable');
    }catch(error){if(id===this.sessionId)this.end(`Microphone unavailable: ${error instanceof Error?error.message:error}`);}
  }
  decline(){if(this.phase==='incoming')void this.options.signal({type:'decline',sessionId:this.sessionId}).catch(()=>{});this.end('',false);}
  private prepareMedia(){
    if(this.mediaPromise)return this.mediaPromise;
    const generation=this.generation;
    return this.mediaPromise=(async()=>{
      await this.lock;if(generation!==this.generation)return;
      const raw=await (this.options.getMedia?.() || navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1,sampleRate:48000}}));
      if(generation!==this.generation){raw.getTracks().forEach(track=>track.stop());return;}
      this.raw=raw;raw.getAudioTracks().forEach(track=>{track.enabled=!this.muted;track.onended=()=>{if(this.raw===raw)this.end('Microphone disconnected.');};});
      const context=this.options.createContext?.() || new AudioContext({sampleRate:48000});this.context=context;
      await context.resume();if(generation!==this.generation)return;
      const source=context.createMediaStreamSource(raw);
      const high=context.createBiquadFilter();high.type='highpass';high.frequency.value=85;
      const presence=context.createBiquadFilter();presence.type='peaking';presence.frequency.value=3000;presence.gain.value=2.5;presence.Q.value=1;
      const low=context.createBiquadFilter();low.type='lowpass';low.frequency.value=12000;
      const inputMeter=context.createAnalyser();inputMeter.fftSize=1024;
      const gate=context.createGain();gate.gain.value=0;
      const compressor=context.createDynamicsCompressor();compressor.threshold.value=-24;compressor.knee.value=20;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.25;
      this.localMeter=context.createAnalyser();this.localMeter.fftSize=1024;
      const destination=context.createMediaStreamDestination();this.processed=destination.stream;
      source.connect(high).connect(presence).connect(low).connect(inputMeter).connect(gate).connect(compressor).connect(this.localMeter).connect(destination);
      this.processed.getAudioTracks().forEach(track=>track.enabled=!this.muted);
      let lastVoice=0;
      this.gateTimer=setInterval(()=>{
        if(audioLevel(inputMeter)>.004)lastVoice=performance.now();
        const open=!this.muted && performance.now()-lastVoice<180;
        gate.gain.setTargetAtTime(open?1:0,context.currentTime,open?.008:.08);
        this.localLevel=this.muted?0:audioLevel(this.localMeter);this.remoteLevel=this.remoteMuted?0:audioLevel(this.remoteMeter);
      },25);
    })();
  }
  private createPeer(){
    const pc=this.options.createPeer?.() || new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]});
    this.pc=pc;
    for(const track of this.processed!.getAudioTracks())pc.addTrack(track,this.processed!);
    pc.onconnectionstatechange=()=>{if(this.pc===pc && ['failed','closed'].includes(pc.connectionState))this.end('Partner disconnected.');};
    pc.ontrack=event=>{
      if(this.pc!==pc || event.track.kind!=='audio')return;
      const stream=event.streams[0] || new MediaStream([event.track]);
      const audio=new Audio();audio.autoplay=true;audio.srcObject=stream;
      this.remoteAudio?.pause();this.remoteAudio=audio;
      const meter=this.context!.createAnalyser();meter.fftSize=1024;this.remoteMeter=meter;
      this.context!.createMediaStreamSource(stream).connect(meter);
      void audio.play().catch(()=>{this.error='Click Resume call audio to hear your partner.';this.notify();});
    };
    return pc;
  }
  resumeAudio(){void this.context?.resume();void this.remoteAudio?.play().then(()=>{this.error='';this.notify();}).catch(()=>{});}
  private gather(pc:RTCPeerConnection){
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    return new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};
      const check=()=>{if(pc.iceGatheringState==='complete' || this.pc!==pc)done();};
      const timer=setTimeout(done,10000);pc.addEventListener('icegatheringstatechange',check);check();
    });
  }
  private attach(channel:RTCDataChannel){
    if(channel.label!=='baymax-voice' || this.channel){channel.close();return;}
    this.channel=channel;
    channel.onopen=()=>{
      if(this.channel!==channel)return;
      clearTimeout(this.deadline);this.stopRing();this.phase='connected';this.startedAt=Date.now();this.lastSeen=Date.now();
      this.send({type:'mute',muted:this.muted});this.syncAppearance(true);this.notify();
      this.heartbeat=setInterval(()=>{
        if(Date.now()-this.lastSeen>12000){this.end('Partner disconnected.');return;}
        this.send({type:'ping'});this.syncAppearance();
      },2000);
    };
    channel.onclose=()=>{if(this.channel===channel)this.end('Call ended.',false);};
    channel.onerror=()=>{if(this.channel===channel)this.end('Call connection lost.');};
    channel.onmessage=event=>{
      if(this.channel!==channel || typeof event.data!=='string' || event.data.length>12000)return;
      try{
        const value=JSON.parse(event.data);
        if(!['ping','pong','mute','appearance','hangup'].includes(value.type))return;
        this.lastSeen=Date.now();
        if(value.type==='ping')this.send({type:'pong'});
        else if(value.type==='hangup')this.end('Call ended.',false);
        else if(value.type==='mute'){this.remoteMuted=value.muted===true;this.notify();}
        else if(value.type==='appearance'){this.remoteAppearance=cleanAppearance(value.appearance);this.notify();}
      }catch{}
    };
  }
  private send(value:unknown){if(this.channel?.readyState==='open' && this.channel.bufferedAmount<32000)try{this.channel.send(JSON.stringify(value));}catch{}}
  syncAppearance(force=false){const appearance=cleanAppearance(this.options.appearance()),key=JSON.stringify(appearance);if(force || key!==this.lastAppearance){this.lastAppearance=key;this.send({type:'appearance',appearance});}}
  toggleMute(){
    this.muted=!this.muted;
    for(const stream of [this.raw,this.processed])stream?.getAudioTracks().forEach(track=>track.enabled=!this.muted);
    if(this.muted)this.localLevel=0;this.send({type:'mute',muted:this.muted});this.notify();
  }
  setCompact(value:boolean){this.compact=value;this.notify();}
  private ring(){
    try{
      const ctx=new AudioContext();this.ringContext=ctx;void ctx.resume().catch(()=>{});
      const chime=()=>{for(const [offset,freq] of [[0,523.25],[.22,659.25]]){
        const osc=ctx.createOscillator(),gain=ctx.createGain(),at=ctx.currentTime+offset;
        osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.075,at+.04);gain.gain.exponentialRampToValueAtTime(.001,at+.38);
        osc.connect(gain).connect(ctx.destination);osc.start(at);osc.stop(at+.4);
      }};chime();this.ringTimer=setInterval(chime,2200);
    }catch{}
  }
  private stopRing(){clearInterval(this.ringTimer);void this.ringContext?.close().catch(()=>{});this.ringContext=null;}
  private remember(id:string){if(!id)return;this.closedSessions.add(id);if(this.closedSessions.size>64)this.closedSessions.delete(this.closedSessions.values().next().value!);}
  private cleanup(){
    ++this.generation;clearTimeout(this.deadline);clearInterval(this.heartbeat);clearInterval(this.gateTimer);this.stopRing();
    const channel=this.channel,pc=this.pc;this.channel=null;this.pc=null;channel?.close();pc?.close();
    for(const stream of [this.raw,this.processed])stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});
    this.raw=null;this.processed=null;this.mediaPromise=null;this.remoteAudio?.pause();if(this.remoteAudio)this.remoteAudio.srcObject=null;this.remoteAudio=null;
    void this.context?.close().catch(()=>{});this.context=null;this.localMeter=null;this.remoteMeter=null;this.localLevel=0;this.remoteLevel=0;this.lastAppearance='';
  }
  end(message='',signal=true){
    const id=this.sessionId;
    if(signal && id){this.send({type:'hangup'});void this.options.signal({type:'hangup',sessionId:id}).catch(()=>{});}
    this.remember(id);this.cleanup();this.sessionId='';this.phase='idle';this.startedAt=0;this.error=message;this.compact=false;
    void this.options.active(false).catch(()=>{});this.notify();
  }
}
