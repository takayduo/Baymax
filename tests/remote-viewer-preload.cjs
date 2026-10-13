const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('viewerAPI',{
  on(){},getPartnerInfo:async()=>({partnerName:'Test Partner',assistantName:'Baymax'}),
  sendSignal(){},sendInputFast:cmd=>ipcRenderer.send('test-input',cmd),
  toggleFullscreen:()=>ipcRenderer.send('test-fullscreen'),endSession(){},
});
