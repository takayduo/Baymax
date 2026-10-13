import { parsePlayback, type MusicAction, type Playback } from './model';

export type ListenStatus = 'solo'|'connecting'|'together';
export interface MusicSignal {type:string;sessionId?:string;sdp?:string;playing?:boolean;title?:string}
interface Options {
  signal(value:MusicSignal):Promise<boolean>;
  snapshot():Playback;
  control(action:MusicAction):void;
  receive(state:Playback):void;
  status(value:ListenStatus, error?:string):void;
  createPeer?():RTCPeerConnection;
}
/** Host orders all controls. Only handshake messages use the cloud transport. */
export class ListenTogether {
  role:'host'|'guest'|null=null;
  state:ListenStatus='solo';
  private sessionId='';
  private pc:RTCPeerConnection|null=null;
  private channel:RTCDataChannel|null=null;
  private timeout:ReturnType<typeof setTimeout>|undefined;
  private heartbeat:ReturnType<typeof setInterval>|undefined;
  private lastReceived=0;
  private clockOffset=0;
  private bestRtt=Infinity;
  private latestRevision=-1;
  private partial:{id:string;parts:string[];size:number;time:number}|null=null;
  constructor(private options:Options) {}
  get session(){return this.sessionId;}
  private owns(pc:RTCPeerConnection){return this.pc===pc;}
  private report(value:ListenStatus,error='') { this.state=value; this.options.status(value,error); }
  async join() {
    this.leave(); this.role='guest'; this.sessionId=crypto.randomUUID(); this.report('connecting');this.armTimeout();
    try {if (!await this.options.signal({type:'join',sessionId:this.sessionId})) throw new Error('Partner connection is unavailable');}
    catch {this.leave('Could not reach your partner. Try again when both PCs are online.');}
  }
  private armTimeout() { clearTimeout(this.timeout); this.timeout=setTimeout(()=>this.leave('Direct connection failed. Playback stays local; these networks may need a TURN relay.'),25000); }
  async signal(message:MusicSignal) {
    try {
      if (message.type==='join') {
        if (this.state==='together' || (this.state==='connecting' && this.sessionId < message.sessionId!)) {
          await this.options.signal({type:'decline',sessionId:message.sessionId});return;
        }
        this.leave(); this.role='host';this.sessionId=message.sessionId!;this.report('connecting');this.armTimeout();
        const pc=this.create();this.attach(pc.createDataChannel('baymax-music',{ordered:true}));
        await pc.setLocalDescription(await pc.createOffer());await this.gather(pc);
        if (this.pc===pc && !await this.options.signal({type:'offer',sessionId:this.sessionId,sdp:pc.localDescription!.sdp})) this.leave('Could not send the music invitation.');
      } else if (message.sessionId===this.sessionId && this.sessionId) {
        if (message.type==='leave') this.leave('Partner left. Playback continues locally.');
        else if (message.type==='decline') this.leave('Partner is already in a listening session.');
        else if (message.type==='offer' && this.role==='guest' && !this.pc) {
          const pc=this.create();pc.ondatachannel=e=>this.attach(e.channel);
          await pc.setRemoteDescription({type:'offer',sdp:message.sdp});
          await pc.setLocalDescription(await pc.createAnswer());await this.gather(pc);
          if (this.owns(pc) && !await this.options.signal({type:'answer',sessionId:this.sessionId,sdp:pc.localDescription!.sdp})) this.leave('Could not answer the music invitation.');
        } else if (message.type==='answer' && this.role==='host' && this.pc?.signalingState==='have-local-offer') {
          await this.pc.setRemoteDescription({type:'answer',sdp:message.sdp});
        }
      }
    } catch { this.leave('Could not establish Listen Together. Your local playback continues.'); }
  }
  private create() {
    const pc=this.options.createPeer?.() || new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]});
    this.pc=pc;
    pc.onconnectionstatechange=()=>{if (this.pc===pc && ['failed','closed'].includes(pc.connectionState)) this.leave('Partner disconnected. Playback continues on this PC.');};
    return pc;
  }
  private gather(pc:RTCPeerConnection) {
    if (pc.iceGatheringState==='complete') return Promise.resolve();
    return new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};
      const check=()=>{if(pc.iceGatheringState==='complete')done();};
      const timer=setTimeout(done,10000);pc.addEventListener('icegatheringstatechange',check);check();
    });
  }
  private attach(channel:RTCDataChannel) {
    if (channel.label!=='baymax-music' || this.channel) {channel.close();return;}
    this.channel=channel;
    channel.onopen=()=>{
      if(this.channel!==channel)return;
      clearTimeout(this.timeout);this.lastReceived=Date.now();this.report('together');
      this.send({type:'ping',at:Date.now()});this.broadcast();
      this.heartbeat=setInterval(()=>{
        if(Date.now()-this.lastReceived>12000){this.leave('Partner disconnected. Playback continues on this PC.');return;}
        this.send({type:'ping',at:Date.now()});this.broadcast();
      },2000);
    };
    channel.onmessage=e=>{if(this.channel===channel)this.message(e.data);};
    channel.onclose=()=>{if(this.channel===channel)this.leave('Partner left. Playback continues on this PC.');};
    channel.onerror=()=>{if(this.channel===channel)this.leave('Music connection lost. Playback continues locally.');};
  }
  private send(value:unknown) {
    const channel=this.channel;
    if(channel?.readyState!=='open')return false;
    const json=JSON.stringify(value);
    if(json.length>200000 || channel.bufferedAmount>500000)return false;
    try {
      if(json.length<=3000)channel.send(json);
      else {
        const id=crypto.randomUUID(),count=Math.ceil(json.length/3000);
        for(let index=0;index<count;index++)channel.send(JSON.stringify({type:'chunk',id,index,count,data:json.slice(index*3000,(index+1)*3000)}));
      }
      return true;
    }catch{return false;}
  }
  private message(raw:unknown) {
    if(typeof raw!=='string' || raw.length>16000)return;
    try {
      let msg=JSON.parse(raw);
      if(msg.type==='chunk'){
        if(typeof msg.id!=='string' || typeof msg.data!=='string' || msg.data.length>3000 || !Number.isInteger(msg.index) || !Number.isInteger(msg.count) || msg.count<1 || msg.count>67 || msg.index<0 || msg.index>=msg.count)return;
        if(msg.index===0)this.partial={id:msg.id,parts:[],size:0,time:Date.now()};
        const part=this.partial;
        if(!part || part.id!==msg.id || part.parts.length!==msg.index || Date.now()-part.time>10000)return;
        part.parts.push(msg.data);part.size+=msg.data.length;
        if(part.size>200000){this.partial=null;return;}
        if(part.parts.length<msg.count)return;
        this.partial=null;msg=JSON.parse(part.parts.join(''));
      }
      this.lastReceived=Date.now();
      if(msg.type==='leave'){this.leave('Partner left. Playback continues locally.');return;}
      if(msg.type==='ping' && Number.isFinite(msg.at)){this.send({type:'pong',at:msg.at,remote:Date.now()});return;}
      if(msg.type==='pong' && Number.isFinite(msg.at) && Number.isFinite(msg.remote)){
        const rtt=Date.now()-msg.at;
        if(rtt>=0 && rtt<this.bestRtt){this.bestRtt=rtt;this.clockOffset=msg.remote-(msg.at+Date.now())/2;}return;
      }
      if(msg.type==='control' && this.role==='host'){this.options.control(msg.action);return;}
      if(msg.type==='state' && this.role==='guest'){
        const state=parsePlayback(msg.state);
        if(state.revision<this.latestRevision)return;
        this.latestRevision=state.revision;
        this.options.receive({...state,at:state.at-this.clockOffset});
      }
    }catch{ /* Malformed peer payloads never modify local playlists or execute commands. */ }
  }
  control(action:MusicAction) { return this.role==='guest' && this.state==='together' ? this.send({type:'control',action}) : false; }
  broadcast() { if(this.role==='host' && this.state==='together')this.send({type:'state',state:this.options.snapshot()}); }
  leave(error='') {
    this.send({type:'leave'});
    const channel=this.channel,pc=this.pc;this.channel=null;this.pc=null;
    clearTimeout(this.timeout);clearInterval(this.heartbeat);
    this.role=null;this.sessionId='';this.partial=null;this.latestRevision=-1;this.bestRtt=Infinity;this.clockOffset=0;
    channel?.close();pc?.close();this.report('solo',error);
  }
}
