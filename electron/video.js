const video=document.querySelector('video'),audio=document.querySelector('audio'),status=document.querySelector('#status');
let current=null;
function report(error=''){if(current)window.videoBridge.status({id:current.id,playing:!video.paused&&!video.ended,error});}
function sync(){if(current?.audioSource&&Math.abs(audio.currentTime-video.currentTime)>.15)audio.currentTime=video.currentTime;}
video.addEventListener('playing',()=>{sync();if(current?.audioSource)void audio.play().catch(()=>report('Audio playback failed'));status.textContent='Playing';report();});
video.addEventListener('pause',()=>{audio.pause();status.textContent='Paused';report();});
video.addEventListener('ended',()=>{audio.pause();status.textContent='Finished';report();});
video.addEventListener('seeking',sync);video.addEventListener('timeupdate',sync);
video.addEventListener('ratechange',()=>{audio.playbackRate=video.playbackRate;});
video.addEventListener('volumechange',()=>{audio.muted=video.muted;audio.volume=video.volume;});
for(const element of [video,audio])element.addEventListener('error',()=>{status.textContent='Playback unavailable';report('Unsupported format or unavailable stream');});
window.videoBridge.onMute(muted=>{video.muted=audio.muted=muted;});
window.videoBridge.onLoad(value=>{
  current=value;document.querySelector('#title').textContent=value.title;
  video.muted=audio.muted=value.muted;video.src=value.source;
  if(value.audioSource)audio.src=value.audioSource;
  void video.play().catch(()=>{status.textContent='Press Play to start';report('Playback needs a click on Play');});
});
