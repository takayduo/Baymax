const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'audit/remote-viewer-smoke-profile'));app.disableHardwareAcceleration();
let fullscreen=0;ipcMain.on('test-fullscreen',()=>fullscreen++);
app.whenReady().then(async()=>{
  try{
    const win=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'remote-viewer-preload.cjs'),contextIsolation:true,offscreen:true}});
    const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
    await win.loadFile(path.join(root,'public/remote-viewer.html'));await new Promise(r=>setTimeout(r,100));
    const result=await win.webContents.executeJavaScript(`(()=>{
      const video=document.querySelector('#remoteVideo');video.dispatchEvent(new Event('playing'));
      const cursors=['html','body','#viewport','#remoteVideo'].map(s=>getComputedStyle(document.querySelector(s)).cursor);
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'F11'}));
      return {toolbar:!!document.querySelector('#toolbar'),cursors};
    })()`);
    await new Promise(r=>setTimeout(r,30));assert.equal(result.toolbar,false);assert.equal(fullscreen,1);assert.ok(result.cursors.every(value=>value.includes('data:image/png;base64') && value.endsWith('none')));assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,'audit/remote-viewer-smoke.json'),JSON.stringify({checks:['Toolbar absent','Transparent cursor on html/body/viewport/video while controlling','F11 still toggles fullscreen'],errors},null,2));console.log('Remote viewer: 3 checks passed');app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
