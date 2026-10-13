const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'audit/music-smoke');
app.setPath('userData',path.join(root,'audit/music-smoke-profile'));app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  try{
    const win=new BrowserWindow({show:false,width:800,height:650,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    await win.loadFile(path.join(folder,'index.html'));
    const result=await win.webContents.executeJavaScript('musicTest.run()');
    fs.writeFileSync(path.join(root,'audit/music-smoke-results.json'),JSON.stringify(result,null,2));
    await new Promise(resolve=>setTimeout(resolve,300));
    fs.writeFileSync(path.join(root,'audit/music-headphones.png'),(await win.webContents.capturePage()).toPNG());
    console.log(JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
