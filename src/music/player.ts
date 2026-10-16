import { allowed, requireFeature } from '../core/account';
import { Bridge } from '../core/bridge';
import { State } from '../core/state';
import { setMusicPlayback } from '../companion/appearance';
import { ListenTogether, type MusicSignal } from './peer';
import { emptyPlayback, positionAt, reducePlayback, type Library, type MusicAction, type Playback, type Track } from './model';

export class MusicPlayer {
  library:Library={version:1,activePlaylistId:'favorites',currentTrackId:'',playlists:[{id:'favorites',name:'My playlist',tracks:[]}]};
  playback=emptyPlayback();
  error=''; loading=false; saving=false; actualPlaying=false;
  partner:{title:string;playing:boolean}|null=null;
  readonly peer:ListenTogether;
  private initialized:Promise<void>|null=null;
  private generation=0;
  private loadedId='';
  private attemptedId='';
  private failedRevision=-1;
  private saveChain=Promise.resolve();
  private listeners=new Set<()=>void>();
  private discoveryKey='';
  private lastProbe=0;
  private lastPartnerStatus=0;
  constructor(readonly audio:HTMLAudioElement = new Audio(), signal = (message:MusicSignal)=>Bridge.musicSignal(message)) {
    audio.preload='auto';audio.volume=.6;
    this.peer=new ListenTogether({signal,snapshot:()=>this.snapshot(),control:action=>this.applyAction(action),
      receive:state=>this.apply(state),status:(status,error)=>{
        if(status==='solo')this.audio.playbackRate=1;
        if(status==='together')void this.adoptSharedQueue();
        if(error)this.error=error;this.notify();
      }});
    audio.addEventListener('playing',()=>{this.actualPlaying=true;setMusicPlayback(true);this.notify();this.announce();});
    audio.addEventListener('pause',()=>{this.actualPlaying=false;setMusicPlayback(false);this.notify();this.announce();});
    audio.addEventListener('ended',()=>{
      this.actualPlaying=false;setMusicPlayback(false);
      if(this.peer.role!=='guest' || this.peer.state!=='together')this.applyAction({type:'ended'});
      this.notify();
    });
    audio.addEventListener('error',()=>{
      if(!this.loadedId || this.loading)return; // Loading failures are owned by load().
      this.fail('This stream could not play. Press Play to retry, or choose another song.');
    });
  }
  private async adoptSharedQueue(){
    const host=this.peer.role==='host';
    try{await this.edit(lib=>{
      const shared=lib.playlists.find(p=>p.id==='shared');if(!shared)return;
      if(host)for(const track of this.playback.queue)if(!shared.tracks.some(t=>t.id===track.id))shared.tracks.push(track);
      lib.activePlaylistId='shared';
    },host);}catch{}
  }
  subscribe(listener:()=>void) {this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  private notify(){for(const listener of this.listeners)listener();State.notify();}
  get activePlaylist(){return this.library.playlists.find(p=>p.id===this.library.activePlaylistId)!;}
  get current(){return this.playback.queue[this.playback.index];}
  init(){
    if(!this.initialized)this.initialized=(async()=>{
      try{const library=await Bridge.musicLoad();if(!Array.isArray(library?.playlists) || !library.playlists.length)throw new Error('Could not load local playlists.');this.library=library;const index=Math.max(0,this.activePlaylist.tracks.findIndex(t=>t.id===this.library.currentTrackId));
        this.playback={...emptyPlayback(),repeat:library.repeat || 'off',queue:this.activePlaylist.tracks,index};}
      catch(error){this.error=String(error instanceof Error?error.message:error);}
      this.notify();
    })();
    return this.initialized;
  }
  snapshot():Playback {
    return {...this.playback,position:this.loadedId===this.current?.id && !this.loading ? this.audio.currentTime : this.loading ? this.playback.position : positionAt(this.playback),at:Date.now()};
  }
  async command(action:MusicAction){
    await this.init();this.error='';
    if(this.peer.role==='guest' && this.peer.state==='together'){
      if(!this.peer.control(action)){this.error='Partner connection is busy. Please retry.';this.notify();}return;
    }
    this.applyAction(action);
  }
  private applyAction(action:MusicAction){
    try {
      this.apply(reducePlayback(this.snapshot(),action));this.peer.broadcast();
      if(['pick','next','previous','play','queue'].includes(action.type) && this.current && this.activePlaylist.tracks.some(t=>t.id===this.current.id)) {
        const id=this.current.id;
        if(this.library.currentTrackId!==id)void this.edit(library=>{library.currentTrackId=id;},false).catch(()=>{});
      }
    }catch(error){this.error=error instanceof Error?error.message:String(error);this.notify();}
  }
  private apply(state:Playback){
    if(state.repeat!==this.library.repeat)void this.edit(lib=>{lib.repeat=state.repeat;},false).catch(()=>{});
    this.playback=state;
    const track=this.current;
    if(!track){++this.generation;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.loadedId='';this.attemptedId='';this.loading=false;this.notify();return;}
    if(this.attemptedId!==track.id){
      ++this.generation;this.audio.pause();this.loadedId='';this.attemptedId='';this.loading=false;
    }
    if(state.playing && !this.loadedId && !this.loading && state.revision!==this.failedRevision)void this.load(track);
    else if(this.loadedId===track.id)this.align();
    this.notify();this.announce();
  }
  private async load(track:Track){
    const generation=++this.generation;this.loading=true;this.attemptedId=track.id;this.notify();
    for(let attempt=0;attempt<3;attempt++) {
    try {
      if(attempt)await new Promise(resolve=>setTimeout(resolve,500));
      if(generation!==this.generation)return;
      const url=await Bridge.musicResolve(track.id,attempt>0);
      if(generation!==this.generation)return;
      this.audio.src=url;
      await new Promise<void>((resolve,reject)=>{
        const done=()=>{clearTimeout(timer);this.audio.removeEventListener('loadedmetadata',loaded);this.audio.removeEventListener('error',failed);};
        const loaded=()=>{done();resolve();};const failed=()=>{done();reject(new Error('Audio stream unavailable'));};
        const timer=setTimeout(()=>{done();reject(new Error('Music took too long to load. Try another song.'));},20000);
        this.audio.addEventListener('loadedmetadata',loaded,{once:true});this.audio.addEventListener('error',failed,{once:true});this.audio.load();
      });
      if(generation!==this.generation)return;
      this.loadedId=track.id;this.loading=false;
      if(this.peer.role!=='guest')this.playback={...this.playback,at:Date.now()};
      this.align();this.peer.broadcast();this.notify();
      return;
    }catch(error){
      if(generation!==this.generation)return;
      if(attempt===2)this.fail(error instanceof Error?error.message:String(error));
      else {this.audio.pause();this.audio.removeAttribute('src');this.audio.load();}
    }
    }
  }
  private fail(message:string){
    this.failedRevision=this.playback.revision;
    this.audio.pause();this.loading=false;this.actualPlaying=false;setMusicPlayback(false);this.loadedId='';this.attemptedId='';
    this.playback={...this.playback,playing:false,revision:this.playback.revision+(this.peer.role==='guest'?0:1)};
    this.error=message;this.peer.broadcast();this.notify();this.announce();
  }
  private align(){
    const target=positionAt(this.playback),delta=target-this.audio.currentTime;
    if(Math.abs(delta)>.25 || !this.playback.playing)this.audio.currentTime=target;
    this.audio.playbackRate=this.peer.state==='together' && Math.abs(delta)>.06 && Math.abs(delta)<=.25 ? (delta>0?1.02:.98):1;
    if(this.playback.playing){
      if(this.audio.ended && target>=this.audio.duration-.1)return;
      const generation=this.generation;
      void this.audio.play().catch(error=>{
        if(generation!==this.generation || !this.playback.playing || error?.name==='AbortError')return;
        this.fail('Playback needs a click. Press Play to continue.');
      });
    } else this.audio.pause();
  }
  toggle(){return this.command({type:this.playback.playing?'pause':'play'});}
  edit(change:(library:Library)=>void, updateQueue=true):Promise<void>{
    const task=this.saveChain.then(async()=>{
      await this.init();this.saving=true;this.notify();
      try{
        const draft=structuredClone(this.library);change(draft);
        const saved=await Bridge.musicSave({...draft,sharedBase:this.library.playlists.find(p=>p.id==='shared')?.tracks || []} as Library);this.library=saved;
        if(updateQueue){const index=Math.max(0,this.activePlaylist.tracks.findIndex(t=>t.id===this.current?.id));
          await this.command({type:'queue',tracks:this.activePlaylist.tracks,index,playing:this.playback.playing,position:this.activePlaylist.tracks[index]?.id===this.current?.id?this.audio.currentTime:0});}
        this.error='';
      }catch(error){this.error=error instanceof Error?error.message:String(error);throw error;}
      finally{this.saving=false;this.notify();}
    });
    this.saveChain=task.catch(()=>{});return task;
  }
  receiveLibrary(library:Library) {
    // Serialize incoming disk snapshots with local saves, then fetch the newest
    // version so a delayed notification cannot replace a later edit.
    this.saveChain=this.saveChain.then(async()=>{
      const fresh=await Bridge.musicLoad();this.library=fresh;
      // The host applies incoming library changes to playback. A guest must
      // not echo a delayed cloud snapshot back as a new playback command.
      if(fresh.activePlaylistId==='shared' && !(this.peer.role==='guest' && this.peer.state==='together')){
        const queue=fresh.playlists.find(p=>p.id==='shared')!.tracks,index=Math.max(0,queue.findIndex(t=>t.id===this.current?.id));
        await this.command({type:'queue',tracks:queue,index,playing:this.playback.playing,position:queue[index]?.id===this.current?.id?this.audio.currentTime:0});
      }
      this.notify();
    }).catch(error=>{this.error=String(error);this.notify();});
  }
  async select(id:string){await this.edit(lib=>{lib.activePlaylistId=id;lib.currentTrackId='';},false);await this.command({type:'queue',tracks:this.activePlaylist.tracks,index:0,playing:false});}
  async add(track:Track){await this.edit(lib=>{const list=lib.playlists.find(p=>p.id===lib.activePlaylistId)!;if(list.tracks.some(t=>t.id===track.id))throw new Error('Already in this playlist');list.tracks.push(track);});}
  async signal(message:MusicSignal){
    if(!allowed('listenTogether'))return;
    if(message.type==='status'){this.partner={title:message.title || '',playing:!!message.playing};this.lastPartnerStatus=Date.now();this.notify();}
    else if(message.type==='probe'){this.announce(true);}
    else {if(message.type==='leave' && message.sessionId===this.peer.session){this.partner=null;this.notify();}await this.peer.signal(message);}
  }
  presence(online:boolean){
    if(!allowed('listenTogether')){this.peer.leave();this.partner=null;return;}
    if(!online){
      // A cloud presence outage is not a peer disconnect. The data channel's
      // own heartbeat still closes a genuinely lost peer; account changes and
      // explicit Leave continue to revoke the session immediately.
      if(this.peer.healthy)return;
      this.partner=null;this.peer.leave();this.notify();return;
    }
    if(Date.now()-this.lastProbe>5000){this.lastProbe=Date.now();void Bridge.musicSignal({type:'probe'});this.announce(true);}
  }
  announce(force=false){
    if(!allowed('listenTogether'))return;
    const value={type:'status',playing:this.actualPlaying,title:this.actualPlaying?this.current?.title || '':''};
    const key=JSON.stringify(value);
    if(State.partnerOnline && (force || key!==this.discoveryKey)){this.discoveryKey=key;void Bridge.musicSignal(value).catch(()=>{});}
  }
  async join(){if(!requireFeature('listenTogether'))return;await this.init();if(!State.partnerOnline){this.error='Your partner is offline. You can keep listening on your own.';this.notify();return;}await this.peer.join();}
  leave(){
    const sessionId=this.peer.session;
    if(sessionId)void Bridge.musicSignal({type:'leave',sessionId}).catch(()=>{});
    void Bridge.musicSignal({type:'status',playing:false,title:''}).catch(()=>{});
    this.peer.leave();this.partner=null;this.audio.playbackRate=1;this.notify();
  }
  partnerTitle(){return State.partnerOnline && this.partner?.playing && Date.now()-this.lastPartnerStatus<24*3600000 ? this.partner.title : '';}
}
export const Music = new MusicPlayer();
