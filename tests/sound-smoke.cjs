// Real Chromium/WebAudio checks. Synthetic app sounds only; no microphone or account access.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'audit/sound-smoke');
fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, 'result.json'), { force: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const bundle = buildSync({ entryPoints: [path.join(root, 'src/core/sound.ts')], bundle: true, write: false, format: 'iife', globalName: 'soundModule' }).outputFiles[0].text;
const names = new Set(require('../public/sounds/manifest.json').sounds.map(sound => sound.file));
const requests = [];
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  let content, type;
  if (pathname === '/') { content = '<!doctype html><script src="/sound.js"></script>'; type = 'text/html'; }
  else if (pathname === '/sound.js') { content = bundle; type = 'text/javascript'; }
  else if (pathname === '/docs/sounds-preview.html') { content = fs.readFileSync(path.join(root, pathname)); type = 'text/html'; }
  else if (/^\/(?:public\/)?sounds\//.test(pathname) && names.has(path.basename(pathname))) {
    requests.push(path.basename(pathname)); content = fs.readFileSync(path.join(root, 'public/sounds', path.basename(pathname))); type = 'audio/wav';
  } else { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(content);
});

app.whenReady().then(async () => {
  let win;
  const watchdog = setTimeout(() => { console.error('Audio smoke timed out'); app.exit(1); }, 60000);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    // Silence the automated test at the output device; WebAudio is still rendered and measured.
    win.webContents.setAudioMuted(true);
    const run = code => win.webContents.executeJavaScript(code, true);
    const until = async condition => {
      const end = Date.now() + 6000;
      while (Date.now() < end) { if (await run(condition)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw new Error('Preview did not settle: ' + condition);
    };
    await win.loadURL(origin);
    const result = await run(`(async()=>{
      const {Sound,SOUND_NAMES}=soundModule,checks=[];
      const check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      await Sound.preload();const ctx=Sound.ctx;
      check(Sound.buffers.size===28 && SOUND_NAMES.every(name=>Sound.buffers.get(name)?.numberOfChannels===1),'All 28 replacement WAVs decode in Chromium');
      await Sound.preload();check(Sound.ctx===ctx,'Repeated preload reuses the audio context');
      await ctx.resume();
      const analyser=ctx.createAnalyser(),silence=ctx.createGain();analyser.fftSize=256;silence.gain.value=0;
      Sound.master.connect(analyser);analyser.connect(silence);silence.connect(ctx.destination);
      const peak=async duration=>{let maximum=0;const values=new Float32Array(analyser.fftSize),end=performance.now()+duration;
        while(performance.now()<end){analyser.getFloatTimeDomainData(values);for(const value of values)maximum=Math.max(maximum,Math.abs(value));await wait(4);}return maximum;};
      Sound.play('blip');const normal=await peak(250);
      check(Sound.volume===.12 && normal>.01,'Playback produces audio at the unchanged default volume');
      Sound.setVolume(.06);Sound.play('blip');const quiet=await peak(250);
      check(quiet>normal*.35 && quiet<normal*.65,'Volume scales actual rendered audio');
      Sound.setVolume(1);check(Sound.master.gain.value>.199 && Sound.master.gain.value<.201,'Maximum volume remains 0.2');
      Sound.setVolume(-1);Sound.play('pop');check(await peak(220)<.00001,'Zero volume renders silence');
      Sound.setVolume(.12);Sound.setEnabled(false);Sound.play('pop');check(await peak(220)<.00001,'Disabled effects do not start audio');
      Sound.setEnabled(true);Sound.play('pop');check(await peak(220)>.005,'Re-enabling effects restores playback');
      Sound.idle();await wait(1750);check(ctx.state==='suspended','Idle audio context suspends after the existing delay');
      Sound.play('blip');const resumed=await peak(350);check(ctx.state==='running'&&resumed>.005,'Playing after idle resumes audio');
      Sound.idle();await wait(50);Sound.resume();await wait(1650);check(ctx.state==='running','User interaction cancels pending idle suspension');
      await ctx.close();return {checks,normalPeak:normal,quietPeak:quiet};
    })()`);
    assert.equal(requests.length, 28, 'Preload fetches each asset only once');
    assert.equal(new Set(requests).size, 28);
    await win.loadURL(origin + '/docs/sounds-preview.html');
    assert.equal(await run('document.querySelectorAll("article").length'), 28);
    await run('window.previewPlayed=[];document.getElementById("player").addEventListener("playing",()=>previewPlayed.push(document.getElementById("player").src));document.querySelector("article button").click()');
    await until('previewPlayed.some(url=>url.endsWith("peek.wav"))');
    assert.equal(await run('document.getElementById("player").error'), null);
    await run('previewPlayed.length=0;document.getElementById("play-all").click()');
    await until('previewPlayed.some(url=>url.endsWith("open.wav"))');
    assert.equal(await run('previewPlayed[0].endsWith("peek.wav")'), true);
    await run('document.getElementById("stop").click()');
    assert.equal(await run('document.getElementById("player").paused'), true);
    assert.equal(await run('document.querySelectorAll("article.active").length'), 0);
    result.checks.push('Labelled preview lists all 28 effects, plays sequentially and stops cleanly');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    fs.writeFileSync(path.join(output, 'preview.png'), (await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checkCount: result.checks.length, ...result, outputDeviceMuted: true }, null, 2) + '\n');
    console.log(JSON.stringify(result));
    clearTimeout(watchdog); win.destroy(); server.close(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(watchdog); win?.destroy(); server.close(); app.exit(1); }
});
