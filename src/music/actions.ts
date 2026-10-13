import { Bridge } from '../core/bridge';
import type { MusicPlayer } from './player';

function confirmed(player:MusicPlayer, ready:()=>boolean, timeout=60000) {
  return new Promise<void>((resolve,reject)=>{
    let off=()=>{};
    const timer=setTimeout(()=>{off();reject(new Error('Music did not become ready. Check the Music view.'));},timeout);
    const check=()=>{if(player.error || ready()){clearTimeout(timer);off();player.error?reject(new Error(player.error)):resolve();}};
    off=player.subscribe(check);check();
  });
}
export async function runMusicAction(player:MusicPlayer, params:{command:string;query?:string;volume?:number}) {
  await player.init();player.error='';
  const command=params.command;
  if(command==='volume'){player.audio.volume=Math.min(1,Math.max(0,Number(params.volume)/100));return `Music volume is ${Math.round(player.audio.volume*100)}%.`;}
  if(command==='join'){
    if(!player.partnerTitle())throw new Error('Your partner is not sharing music right now. Ask them to start a song first.');
    await player.join();await confirmed(player,()=>player.peer.state==='together',30000);return 'Listening together with your partner.';
  }
  if(command==='leave'){player.leave();return 'Left Listen Together. Local playback continues.';}
  if(command==='add_shared' || (command==='play' && params.query)){
    const track=params.query ? (await Bridge.musicSearch(params.query))[0] : player.current;
    if(!track)throw new Error('No matching song. Try a song and artist name.');
    const shared=command==='add_shared' || player.peer.state==='together';
    await player.edit(lib=>{
      const list=lib.playlists.find(p=>p.id===(shared?'shared':lib.activePlaylistId));
      if(!list)throw new Error('Shared playlist is not ready');
      if(!list.tracks.some(t=>t.id===track.id))list.tracks.push(track);
      if(command==='play')lib.activePlaylistId=list.id;
    },command==='play' || player.activePlaylist.id==='shared');
    if(command==='add_shared')return `Added ${track.title} to Our playlist.`;
    await player.command({type:'pick',index:player.activePlaylist.tracks.findIndex(t=>t.id===track.id)});
  }else{
    const type=command==='resume'?'play':command;
    if(!['play','pause','next','previous'].includes(type))throw new Error('Unknown music command');
    if(!player.current && type==='play')throw new Error('Your playlist is empty. Ask for a song by name.');
    await player.command({type:type as 'play'|'pause'|'next'|'previous'});
  }
  await confirmed(player,()=>command==='pause'?!player.playback.playing:(!player.loading && player.actualPlaying) || !player.playback.playing);
  return player.actualPlaying?`Playing ${player.current?.title}.`:'Music paused.';
}
