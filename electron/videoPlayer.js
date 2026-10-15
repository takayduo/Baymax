const path=require('node:path'),fs=require('node:fs');
const {pathToFileURL,fileURLToPath}=require('node:url');
function mediaURL(source){
  if(typeof source!=='string'||!source.trim())throw new Error('A media source is required');
  if(path.isAbsolute(source)){
    if(!fs.statSync(source).isFile())throw new Error('Video file not found');
    return pathToFileURL(source).href;
  }
  const url=new URL(source);
  if(url.protocol==='file:')return mediaURL(fileURLToPath(url));
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Unsupported media URL');
  return url.href;
}
class VideoPlayer {
  constructor({BrowserWindow,ipcMain}){
    this.BrowserWindow=BrowserWindow;this.win=null;this.playing=false;this.serial=0;
    ipcMain.on('engine-video-status',(event,status)=>{
      if(event.sender!==this.win?.webContents||status?.id!==this.serial)return;
      this.playing=status.playing===true;
      if(status.error||this.playing)this.settle(status.error?new Error('Video could not play: '+status.error):null);
    });
  }
  settle(error){const wait=this.pending;this.pending=null;if(wait){clearTimeout(wait.timer);error?wait.reject(error):wait.resolve(true);}}
  async command(params){
    if(params.command==='status')return this.playing;
    if(params.command==='stop'){this.close();return true;}
    if(params.command==='mute'){
      if(!this.win||this.win.isDestroyed())throw new Error('No video is open');
      this.win.webContents.send('engine-video-mute',params.muted!==false);return true;
    }
    if(params.command!=='play')throw new Error('Unknown video command');
    const source=mediaURL(params.source),audioSource=params.audioSource?mediaURL(params.audioSource):'';
    this.close();
    const win=this.win=new this.BrowserWindow({width:760,height:470,title:'Baymax video',backgroundColor:'#141619',
      webPreferences:{preload:path.join(__dirname,'videoPreload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.on('closed',()=>{if(this.win===win){this.win=null;this.playing=false;this.settle(new Error('Video closed'));}});
    await win.loadFile(path.join(__dirname,'video.html'));
    if(this.win!==win)throw new Error('Video request was replaced');
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject,timer:setTimeout(()=>this.settle(new Error('Video did not start within 20 seconds')),20000)};
      win.webContents.send('engine-video-state',{id,source,audioSource,title:String(params.title||'Video').slice(0,200),muted:params.muted!==false});
    });
  }
  close(){this.settle(new Error('Video request cancelled'));this.playing=false;const win=this.win;this.win=null;if(win&&!win.isDestroyed())win.close();}
}
module.exports={VideoPlayer,mediaURL};
