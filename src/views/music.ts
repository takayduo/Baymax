import { h, svg } from './dom';
import type { ViewHost } from './views';
import { Music } from '../music/player';
import { Bridge } from '../core/bridge';
import type { Track } from '../music/model';

const time=(value:number)=>{const seconds=Math.max(0,Math.floor(value||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
function button(text:string,label:string,run:()=>unknown){
  const icons:Record<string,string>={'▶':'M7 4v16l13-8z','⏸':'M6 4h4v16H6zm8 0h4v16h-4z','⏮':'M4 4h3v16H4zm15 0v16L8 12z','⏭':'M17 4h3v16h-3zM5 4v16l11-8z','⋯':'M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4m7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4m7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4'};
  return h('button',{type:'button',class:'music-button',title:label,'aria-label':label,onclick:()=>{void run();}},icons[text]?svg(icons[text],12):text);
}
export function musicControls(open:()=>void) {
  const play=button(Music.playback.playing?'⏸':'▶',Music.playback.playing?'Pause music':'Play music',async()=>{
    await Music.init();
    if(!Music.playback.queue.length){open();return;}
    await Music.toggle();
  });
  if(Music.loading)play.setAttribute('aria-label','Pause loading music');
  return h('div',{class:'music-mini','aria-label':'Music controls'},
    button('⏮','Previous song',()=>Music.command({type:'previous'})),play,
    button('⏭','Next song',()=>Music.command({type:'next'})),button('⋯','Open music player',open));
}
export function partnerMusicPill() {
  const title=Music.partnerTitle();
  const pill=h('div',{class:'music-partner-pill',hidden:!title && Music.peer.state==='solo'});
  if(Music.peer.state!=='solo')pill.append(h('span',{text:Music.peer.state==='together'?'♫ Listening together':'Connecting…'}),button('Leave','Leave Listen Together',()=>Music.leave()));
  else if(title)pill.append(h('span',{text:`♫ ${title}`,title:`Partner is listening to ${title}`}),button('Join','Join partner music',()=>Music.join()));
  return pill;
}
export function buildMusic():ViewHost {
  const title=h('strong',{class:'music-now-title',text:'Your music, your space'});
  const subtitle=h('span',{class:'music-subtitle'});
  const controls=h('div',{class:'music-transport'});
  const partner=h('div',{class:'music-partner'});
  const error=h('div',{class:'music-error',role:'status','aria-live':'polite'});
  const seek=h('input',{type:'range',min:0,max:100,step:.1,value:0,'aria-label':'Seek song'}) as HTMLInputElement;
  const timestamp=h('span',{class:'music-time',text:'0:00 / 0:00'});
  let seeking=false;
  seek.addEventListener('input',()=>{seeking=true;timestamp.textContent=time(Number(seek.value));});
  seek.addEventListener('change',()=>{seeking=false;void Music.command({type:'seek',position:Number(seek.value)});});
  const volume=h('input',{type:'range',min:0,max:1,step:.05,value:Music.audio.volume,'aria-label':'Music volume'}) as HTMLInputElement;
  volume.addEventListener('input',()=>{Music.audio.volume=Number(volume.value);});
  const playlists=h('select',{'aria-label':'Active playlist'}) as HTMLSelectElement;
  playlists.addEventListener('change',()=>{void Music.select(playlists.value).catch(()=>{});});
  const name=h('input',{type:'text',maxlength:80,placeholder:'New playlist name','aria-label':'Playlist name'}) as HTMLInputElement;
  const list=h('div',{class:'music-track-list','aria-label':'Playlist songs'});
  const results=h('div',{class:'music-results','aria-label':'Search results'});
  const search=h('input',{type:'search',maxlength:200,placeholder:'Search songs or artists','aria-label':'Search songs'}) as HTMLInputElement;
  const searchStatus=h('span',{class:'music-subtitle',role:'status'});
  let searchGeneration=0,searchBusy=false;
  async function find(){
    if(!search.value.trim() || searchBusy)return;
    searchBusy=true;const generation=++searchGeneration;searchStatus.textContent='Searching…';results.replaceChildren();
    try{
      const found=await Bridge.musicSearch(search.value.trim());
      if(generation!==searchGeneration)return;
      for(const track of found)results.append(trackRow(track,()=>Music.add(track),true));
      searchStatus.textContent=found.length?`${found.length} songs · add to ${Music.activePlaylist.name}`:'No songs found. Try another search.';
    }catch(reason){searchStatus.textContent=reason instanceof Error?reason.message:String(reason);}
    finally{searchBusy=false;}
  }
  const searchForm=h('form',{class:'music-search'},search,h('button',{type:'submit',text:'Search'}));
  searchForm.addEventListener('submit',event=>{event.preventDefault();void find();});
  function trackRow(track:Track,run:()=>Promise<void>,add=false,index=0){
    const pick=button(add?'+':String(index+1),add?`Add ${track.title}`:`Play ${track.title}`,async()=>{try{await run();}catch(reason){error.textContent=reason instanceof Error?reason.message:String(reason);}});
    const label=h('div',{class:'music-track-label'},h('span',{text:track.title,title:track.title}),h('small',{text:(track.artist || 'YouTube')+(track.addedBy ? ' · added by '+track.addedBy : '')}));
    if(!add){label.setAttribute('role','button');label.tabIndex=0;label.addEventListener('click',()=>{void run();});label.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void run();}});}
    const row=h('div',{class:`music-track${!add && Music.current?.id===track.id?' current':''}`},pick,label,h('span',{class:'music-time',text:time(track.duration)}));
    if(!add && Music.playback.queue.map(t=>t.id).join()===Music.activePlaylist.tracks.map(t=>t.id).join()){
      const change=(offset:number)=>Music.edit(lib=>{const tracks=lib.playlists.find(p=>p.id===lib.activePlaylistId)!.tracks;const target=index+offset;if(target<0||target>=tracks.length)return;[tracks[index],tracks[target]]=[tracks[target],tracks[index]];}).catch(()=>{});
      row.append(button('↑',`Move ${track.title} up`,()=>change(-1)),button('↓',`Move ${track.title} down`,()=>change(1)),
        button('×',`Remove ${track.title}`,()=>Music.edit(lib=>{lib.playlists.find(p=>p.id===lib.activePlaylistId)!.tracks.splice(index,1);}).catch(()=>{})));
    }
    return row;
  }
  const saveQueue=button('Save a copy','Save listening queue as local playlist',()=>Music.edit(lib=>{
    const id=crypto.randomUUID();lib.playlists.push({id,name:name.value.trim() || 'Together playlist',tracks:structuredClone(Music.playback.queue)});lib.activePlaylistId=id;
  },false).catch(()=>{}));
  const create=button('+ Create','Create playlist',async()=>{
    if(!name.value.trim()){name.focus();return;}
    try{const id=crypto.randomUUID();await Music.edit(lib=>{lib.playlists.push({id,name:name.value.trim(),tracks:[]});},false);name.value='';await Music.select(id);}catch{}
  });
  const rename=button('Rename','Rename playlist',()=>{if(Music.activePlaylist.id==='shared')return;if(!name.value.trim()){name.focus();return;}return Music.edit(lib=>{lib.playlists.find(p=>p.id===lib.activePlaylistId)!.name=name.value.trim();},false).catch(()=>{});});
  const remove=button('Delete','Delete playlist',()=>{
    if(Music.activePlaylist.id==='shared'){error.textContent='Our playlist stays available for both of you. Remove individual songs instead.';return;}
    if(Music.library.playlists.length===1){error.textContent='Keep at least one playlist.';return;}
    return Music.edit(lib=>{lib.playlists=lib.playlists.filter(p=>p.id!==lib.activePlaylistId);lib.activePlaylistId=lib.playlists[0].id;}).catch(()=>{});
  });
  const el=h('div',{class:'view music-view'},
    h('section',{class:'music-player card'},
      h('div',{class:'music-now'},h('span',{class:'music-art','aria-hidden':'true',text:'♫'}),h('div',{class:'music-now-copy'},title,subtitle),partner),
      h('div',{class:'music-progress'},seek,timestamp),h('div',{class:'music-bottom'},controls,h('label',{class:'music-volume'},h('span',{text:'Volume'}),volume))),
    error,
    h('div',{class:'music-library-toolbar'},playlists,name,create,rename,remove),
    h('div',{class:'music-queue-tools'},h('span',{class:'music-subtitle',text:'Our playlist syncs when both PCs connect · saved locally · streams need internet'}),saveQueue),
    h('div',{class:'music-columns'},h('section',{class:'music-library'},list),h('section',{class:'music-discovery'},searchForm,searchStatus,results)));
  let key='';
  return {el,focus:()=>{void Music.init();},sync(){
    const next=JSON.stringify([Music.library,Music.playback.queue,Music.playback.index,Music.playback.playing,Music.playback.repeat,Music.actualPlaying,Music.loading,Music.error,Music.peer.state,Music.partnerTitle(),Music.saving]);
    if(next===key)return;key=next;
    title.textContent=Music.current?.title || 'Your music, your space';subtitle.textContent=Music.loading?'Loading audio…':Music.actualPlaying ? Music.current?.artist || 'Playing' : 'Choose a song. Settle in.';
    const mini=musicControls(()=>{});mini.querySelector('button:last-child')?.remove();
    const repeat=Music.playback.repeat;
    const repeatButton=button(repeat==='one'?'↻ 1':'↻',`Repeat ${repeat==='all'?'playlist':repeat==='one'?'song':'off'}`,()=>Music.command({type:'repeat',mode:repeat==='off'?'all':repeat==='all'?'one':'off'}));
    repeatButton.classList.add('repeat-btn');repeatButton.classList.toggle('active',repeat!=='off');repeatButton.setAttribute('aria-pressed',String(repeat!=='off'));
    mini.append(repeatButton);controls.replaceChildren(mini);
    partner.replaceChildren(partnerMusicPill());error.textContent=Music.error;
    playlists.replaceChildren(...Music.library.playlists.map(p=>h('option',{value:p.id,text:p.name})));playlists.value=Music.library.activePlaylistId;
    saveQueue.hidden=Music.peer.state!=='together' && Music.playback.queue.map(t=>t.id).join()===Music.activePlaylist.tracks.map(t=>t.id).join();
    list.replaceChildren();
    const queue=Music.playback.queue;
    if(!queue.length)list.append(h('div',{class:'music-empty'},h('strong',{text:'A little soundtrack for your day'}),h('span',{text:'Search for a favourite song, then add it here.'})));
    queue.forEach((track,index)=>list.append(trackRow(track,()=>Music.command({type:'pick',index}),false,index)));
    for(const control of [playlists,name,create,rename,remove]) (control as HTMLInputElement).disabled=Music.saving;
  },tick(){
    if(seeking)return;
    const duration=Number.isFinite(Music.audio.duration)?Music.audio.duration:Music.current?.duration || 0;
    seek.max=String(duration || 1);seek.disabled=!Music.current;seek.value=String(Music.audio.currentTime || 0);
    timestamp.textContent=`${time(Number(seek.value))} / ${time(duration)}`;
  }};
}
