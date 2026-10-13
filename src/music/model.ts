export interface Track { id: string; title: string; artist: string; duration: number; addedBy?:string }
export interface Playlist { id: string; name: string; tracks: Track[] }
export type Repeat = 'off'|'all'|'one';
export interface Library { version: number; repeat?:Repeat; activePlaylistId: string; currentTrackId: string; playlists: Playlist[] }
export interface Playback { queue: Track[]; index: number; playing: boolean; position: number; at: number; revision: number; repeat:Repeat }
export type MusicAction = { type:'play'|'pause'|'next'|'previous'|'ended' } | {type:'repeat';mode:Repeat} | { type:'seek'; position:number } | {type:'pick';index:number} | {type:'queue';tracks:Track[];index:number;playing:boolean;position?:number};
export const emptyPlayback = (): Playback => ({queue:[],index:0,playing:false,position:0,at:Date.now(),revision:0,repeat:'off'});
export function tracks(value: unknown): Track[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('Playlist must contain at most 200 songs');
  return value.map(t => {
    if (!t || !/^[\w-]{11}$/.test(t.id) || typeof t.title !== 'string' || t.title.length > 180) throw new Error('Invalid song');
    return {id:t.id,title:t.title,artist:String(t.artist || '').slice(0,100),duration:Math.min(86400,Math.max(0,Number(t.duration)||0)),...(["me","her"].includes(t.addedBy)?{addedBy:t.addedBy}:{})};
  });
}
export function positionAt(state: Playback, now = Date.now()) {
  const position = Math.max(0,state.position + (state.playing ? Math.max(0,now-state.at)/1000 : 0));
  const duration = state.queue[state.index]?.duration;
  return duration ? Math.min(position,duration) : position;
}
export function reducePlayback(old: Playback, action: MusicAction, now = Date.now()): Playback {
  const state = {...old,position:positionAt(old,now),at:now,revision:old.revision+1};
  const advance=()=>{if(state.index+1<state.queue.length){state.index++;state.position=0;}else if(state.repeat==='all'){state.index=0;state.position=0;}else{state.playing=false;state.position=state.queue[state.index]?.duration || state.position;}};
  switch (action.type) {
    case 'queue': state.queue=tracks(action.tracks); state.index=Math.max(0,Math.min(state.queue.length-1,Math.trunc(action.index)||0)); state.position=Number.isFinite(action.position)?Math.max(0,action.position!):0; state.playing=!!action.playing; break;
    case 'play': if (state.position >= (state.queue[state.index]?.duration || Infinity)) state.position=0; state.playing=true; break;
    case 'pause': state.playing=false; break;
    case 'seek': if (!Number.isFinite(action.position)) throw new Error('Invalid seek'); state.position=Math.min(86400,Math.max(0,action.position)); break;
    case 'pick': if (!Number.isInteger(action.index) || !state.queue[action.index]) throw new Error('Invalid song index'); state.index=action.index; state.position=0;state.playing=true;break;
    case 'previous': state.index=Math.max(0,state.index-1);state.position=0;break;
    case 'repeat': if(!['off','all','one'].includes(action.mode))throw new Error('Invalid repeat mode');state.repeat=action.mode;break;
    case 'ended':
      if(state.repeat==='one'){state.position=0;state.playing=true;break;}
      advance();break;
    case 'next': advance();break; // Manual Next never gets trapped on repeat-one.
    default: throw new Error('Invalid music control');
  }
  if (!state.queue.length) state.playing=false;
  state.position=Math.min(state.position,state.queue[state.index]?.duration || 86400);
  return state;
}
export function parsePlayback(value: any): Playback {
  const queue=tracks(value?.queue);
  if (!Number.isInteger(value.index) || value.index<0 || value.index>=Math.max(1,queue.length) ||
      !Number.isSafeInteger(value.revision) || value.revision<0 || !Number.isFinite(value.at) || !Number.isFinite(value.position) || value.position<0 || value.position>86400) throw new Error('Invalid playback state');
  return {queue,index:value.index,playing:!!value.playing,position:value.position,at:value.at,revision:value.revision,repeat:['off','all','one'].includes(value.repeat)?value.repeat:'off'};
}
