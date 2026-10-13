const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'audit/fourteen-smoke-profile'));app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.whenReady().then(async()=>{
  let win;
  try{
    win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.webContents.setAudioMuted(true);
    win.webContents.on('console-message',(_event,_level,message)=>console.log(message));
    await win.loadFile(path.join(root,'audit/fourteen-smoke/index.html'));
    const result=await win.webContents.executeJavaScript('fourteenTest.run()');
    fs.writeFileSync(path.join(root,'audit/fourteen-smoke-results.json'),JSON.stringify(result,null,2));
    fs.writeFileSync(path.join(root,'audit/fourteen-ui.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);if(win)fs.writeFileSync(path.join(root,'audit/fourteen-failed.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
});
