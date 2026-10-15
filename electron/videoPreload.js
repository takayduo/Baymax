const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('videoBridge',{
  onLoad:handler=>ipcRenderer.on('engine-video-state',(_,value)=>handler(value)),
  onMute:handler=>ipcRenderer.on('engine-video-mute',(_,value)=>handler(value)),
  status:value=>ipcRenderer.send('engine-video-status',value),
});
