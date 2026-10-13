const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const packaged = path.join(root, 'release/win-unpacked');
const appRoot = path.join(packaged, 'resources/app');
const checks = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(root, 'audit/package-profile-'));
fs.mkdirSync(path.join(profile,'CoucouCreator'),{recursive:true});
fs.writeFileSync(path.join(profile,'CoucouCreator/cloud-config.json'),JSON.stringify({supabaseUrl:'',supabaseAnonKey:'',razorpayKeyId:'',planIds:{}}));
const env = { ...process.env, BAYMAX_USER_DATA: profile, BAYMAX_ENGINE_DATA: path.join(profile, 'engine') };
for (const key of Object.keys(env)) if (/(API_KEY|TOKEN|SECRET|PASSWORD|PYTHONPATH|PYTHONHOME|ELECTRON_RUN_AS_NODE)/i.test(key)) delete env[key];
env.PATH = `${env.SystemRoot}\\System32;${env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0;${env.SystemRoot}`;
const exe = path.join(packaged, 'Baymax.exe');
let child, socket, sequence = 0;
const pending = new Map();
const log = fs.openSync(path.join(profile, 'startup.log'), 'a');

function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 65000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
function walk(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
}
(async () => {
  try {
    for (const file of ['dist/index.html', 'electron/main.js', 'electron/preload.js', 'electron/preload-productivity.cjs', 'public/icons/icon.ico', 'public/companions/catalog.json', 'public/companions/accessories.json', 'public/remote-viewer.html', 'productivity/dist/index.html']) {
      assert.ok(fs.existsSync(path.join(appRoot, file)), file);
    }
    checks.push('Required renderer, native icons, remote viewer and Productivity assets are packaged');
    const forbidden = walk(path.join(packaged, 'resources')).filter(file => /(?:^|[\\/])(?:\.env(?:\..*)?|api_keys\.json|long_term\.json|sessions\.json|service_account.*\.json|client_secret.*\.json|credentials\.json|smoke-parent\.(?:js|html))$/i.test(file));
    assert.deepEqual(forbidden, [], 'Local secrets, memories or temporary UI fixtures must not be shipped');
    checks.push('Known local credentials, saved memory and temporary smoke fixtures are absent from the package');
    const engine = spawnSync(path.join(packaged, 'resources/engine/BaymaxEngine.exe'), ['--self-test'], { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
    assert.equal(engine.status, 0, engine.stderr);
    const engineResult = JSON.parse(engine.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(engineResult.success, true); assert.equal(engineResult.actions.length, 22); assert.equal(engineResult.data_separate, true);
    assert.equal(engineResult.companions, 20); assert.equal(engineResult.accessories, 3);
    checks.push('Packaged engine imports successfully and discovers 22 actions with Python absent from PATH');
    child = spawn(exe, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { env, cwd: packaged, windowsHide: true, stdio: ['ignore', log, log] });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) { if (child.exitCode !== null) throw new Error(`Packaged app exited early: ${child.exitCode}`); await wait(200); }
    assert.ok(fs.existsSync(portFile), 'Packaged app must start its renderer');
    const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    let target;
    for (let i = 0; i < 80 && !target; i++) {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = pages.find(page => page.url === 'baymax://app/index.html');
      if (!target) await wait(250);
    }
    assert.ok(target, 'Production companion page must load');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), job = pending.get(message.id);
      if (!job) return;
      pending.delete(message.id);
      if (message.error) job.reject(new Error(message.error.message)); else job.resolve(message.result);
    });
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    for (let i = 0; i < 80; i++) { if (await evaluate("!!document.querySelector('#header') && !!window.electronAPI")) break; await wait(150); }
    assert.equal(await evaluate('typeof require'), 'undefined');
    await evaluate('window.electronAPI.openSettingsWindow()');
    for (let i = 0; i < 80; i++) { if (await evaluate("document.querySelectorAll('.preferences-nav button').length === 9")) break; await wait(150); }
    assert.equal(await evaluate("document.querySelectorAll('.preferences-nav button').length"), 9);
    assert.equal(await evaluate("document.querySelector('.preferences-header h1').textContent"), 'Baymax settings');
    assert.ok((await evaluate('window.electronAPI.boot()')).version.startsWith('1.0.1'));
    checks.push('Actual Baymax.exe boots with an isolated profile and opens all nine embedded settings categories');
    const initial=(await evaluate('window.electronAPI.boot()')).settings;
    assert.equal(initial.proactiveTalkingEnabled,false);assert.equal(initial.musicHeadphonesEnabled,true);
    await evaluate("window.electronAPI.saveSettings({userInterests:'editing, psychology'})");
    const interestsMemory=JSON.parse(fs.readFileSync(path.join(profile,'CoucouCreator/engine/memory/long_term.json'),'utf8'));
    assert.equal(interestsMemory.preferences.user_interests.value,'editing, psychology');
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'CoucouCreator/engine/config/api_keys.json'),'utf8')).user_interests,'editing, psychology');
    checks.push('Packaged check-ins default OFF, headphones default ON, and interests persist to settings, engine config and memory');
    const library=await evaluate('window.electronAPI.musicLoad()');
    library.sharedBase=structuredClone(library.playlists.find(p=>p.id==='shared').tracks);
    library.playlists[0].tracks=[{id:'abcdefghijk',title:'Saved song',artist:'Test',duration:120}];
    await evaluate(`window.electronAPI.musicSave(${JSON.stringify(library)})`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'CoucouCreator/playlists.json'),'utf8')).playlists[0].tracks[0].title,'Saved song');
    assert.equal(await evaluate("window.electronAPI.musicResolve('file:///invalid').then(()=>false,()=>true)"),true);
    assert.equal((await evaluate('window.electronAPI.musicLoad()')).playlists.find(p=>p.id==='shared').tracks[0].addedBy,'me');
    checks.push('Packaged music library persists locally and rejects arbitrary URL/file extraction');
    if(process.argv.includes('--live-music')){
      const media=await evaluate(`(async()=>{
        const found=await window.electronAPI.musicSearch('lofi chill royalty free');
        const song=found.find(t=>t.duration>0 && t.duration<600)||found[0];
        const url=await window.electronAPI.musicResolve(song.id);
        const audio=new Audio();audio.muted=true;audio.src=url;
        const duration=await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{audio.pause();reject(new Error('Music did not start'));},18000);
          audio.onplaying=()=>{clearTimeout(timer);const duration=audio.duration;audio.pause();audio.removeAttribute('src');resolve(duration);};
          audio.onerror=()=>{clearTimeout(timer);reject(new Error('HTML5 music playback failed'));};
          audio.play().catch(reject);
        });
        return {results:found.length,trackId:song.id,duration,host:new URL(url).hostname};
      })()`);
      assert.ok(media.results>0 && media.duration>0);fs.writeFileSync(path.join(root,'audit/packaged-music-live.json'),JSON.stringify(media,null,2));
      checks.push('Packaged app searches, resolves and starts muted HTML5 audio using its bundled extractor and Electron runtime with Python/Node absent from PATH');
    }
    assert.equal(await evaluate("document.querySelectorAll('.wardrobe-card').length"), 20);
    assert.equal(await evaluate("document.querySelector('.wardrobe-card [data-avatar-id]').dataset.avatarId"), 'puff');
    await evaluate("document.querySelector('[data-customize=atlas]').click()"); await wait(200);
    await evaluate("document.querySelector('[aria-label=\"Body colour: Pink\"]').click();const a=document.querySelector('[data-style=accessory]');a.value='scarf';a.dispatchEvent(new Event('change'));document.querySelector('[data-wardrobe-apply=atlas]').click()");
    await wait(500);
    const savedCompanion = (await evaluate('window.electronAPI.boot()')).settings.companion;
    assert.equal(savedCompanion.avatarId, 'atlas'); assert.equal(savedCompanion.styles.atlas.color, '#F0A6CA'); assert.equal(savedCompanion.styles.atlas.accessory, 'scarf');
    assert.equal(await evaluate("document.querySelector('[data-avatar-id=atlas].wardrobe-pick').getAttribute('aria-pressed')"), 'true');
    const iconPath = path.join(profile, 'CoucouCreator/companion-icon.png');
    assert.ok(fs.existsSync(iconPath)); const savedIcon = fs.readFileSync(iconPath);
    assert.equal(savedIcon.readUInt32BE(16), 128);
    assert.equal(await evaluate("window.electronAPI.setCompanionIcon('invalid').then(()=>false,()=>true)"), true);
    assert.deepEqual(fs.readFileSync(iconPath), savedIcon);
    const diskCompanion = JSON.parse(fs.readFileSync(path.join(profile, 'CoucouCreator/settings.json'), 'utf8')).companion;
    assert.deepEqual(diskCompanion, savedCompanion);
    const engineConfig = JSON.parse(fs.readFileSync(path.join(profile, 'CoucouCreator/engine/config/api_keys.json'), 'utf8'));
    assert.deepEqual(engineConfig.companion, savedCompanion);
    checks.push('Packaged wardrobe persists the selected avatar, pink colour and scarf to disk and HUD config, updates native icons and rejects invalid icon payloads');
    await evaluate("document.querySelector('[data-page=control]').click()"); await wait(650);
    for (let i=0;i<80 && !await evaluate("!!document.querySelector('.ptt-setting .switch')");i++) await wait(150);
    await evaluate("document.querySelector('.ptt-change-key').click()"); await wait(250);
    assert.ok(await evaluate("document.querySelector('.ptt-key-dialog').open"));
    await evaluate("document.querySelector('.ptt-key-record').dispatchEvent(new KeyboardEvent('keydown',{code:'F8',key:'F8',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))");
    const pickerShot = await command('Page.captureScreenshot', {format:'png'});
    fs.writeFileSync(path.join(root,'audit/push-to-talk-picker.png'),Buffer.from(pickerShot.data,'base64'));
    await evaluate("document.querySelector('.ptt-key-save').click()"); await wait(150);
    let talkState;
    for (let i=0;i<350;i++) { talkState=await evaluate('window.electronAPI.getPushToTalkState()'); if(talkState.ready) break; await wait(200); }
    assert.equal(talkState.ready,true,JSON.stringify(talkState)); assert.equal(talkState.key,'Control+Shift+F8');
    await evaluate('window.electronAPI.suspendPushToTalk(true)');
    assert.equal((await evaluate('window.electronAPI.getPushToTalkState()')).suspended,true);
    await evaluate('window.electronAPI.suspendPushToTalk(false)');
    await evaluate("window.electronAPI.saveSettings({pushToTalkEnabled:false})");
    const savedVoice=JSON.parse(fs.readFileSync(path.join(profile,'CoucouCreator/settings.json'),'utf8'));
    assert.equal(savedVoice.pushToTalkKey,'Control+Shift+F8');
    assert.equal((await evaluate('window.electronAPI.getPushToTalkState()')).ready,false);
    checks.push('Packaged global shortcut helper starts without Python on PATH, persists the chosen chord, suspends for key capture and stops when disabled');
    await command('Page.reload'); await wait(1300);
    assert.deepEqual((await evaluate('window.electronAPI.boot()')).settings.companion, savedCompanion);
    await evaluate("document.querySelector('#header button[aria-label=Home]').click()");await wait(700);
    assert.equal(await evaluate("document.querySelector('#bot-canvas').dataset.avatarId"), 'atlas');
    checks.push('Reloading the packaged renderer restores the saved companion and its custom style');
    assert.equal(await evaluate("fetch('baymax://app/sounds/blip.wav').then(response=>response.status)"), 200);
    checks.push('Packaged notification audio is readable through the production asset protocol');
    await evaluate("document.querySelector('#header button[aria-label=Home]').click()"); await wait(700);
    const homeHeight = await evaluate("document.querySelector('.overview .card').getBoundingClientRect().height");
    assert.ok(homeHeight >= 85 && homeHeight <= 95, String(homeHeight));
    checks.push('Packaged executable renders the compact 90px Home card');
    assert.ok(!fs.readFileSync(path.join(profile,'startup.log'),'utf8').includes('[Uncaught Exception]'), 'No uncaught main-process exceptions during live tracker ticks');
    fs.writeFileSync(path.join(root, 'audit/packaged-smoke-results.json'), JSON.stringify({ checks, errors: [], homeHeight, engine: engineResult }, null, 2));
    console.log(JSON.stringify({ checks, errors: [], homeHeight }));
  } catch (error) {
    fs.writeFileSync(path.join(root, 'audit/packaged-smoke-results.json'), JSON.stringify({ checks, errors: [error.stack] }, null, 2));
    console.error(error); process.exitCode = 1;
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      // Quit through the app lifecycle so the foreground helper is stopped too.
      try { socket.send(JSON.stringify({ id: ++sequence, method: 'Runtime.evaluate', params: { expression: 'window.electronAPI.quit()' } })); } catch {}
      await wait(1000); socket.close();
    }
    if (child && child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    fs.closeSync(log);
  }
})().finally(() => setTimeout(() => process.exit(process.exitCode || 0), 100));
