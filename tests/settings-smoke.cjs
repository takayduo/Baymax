const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, 'audit/settings-smoke-profile'));
app.disableHardwareAcceleration();
require('../electron/appProtocol').registerAppScheme(protocol);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [], writes = [];
const suspensions = [], muteCommands = [], copiedSql = [], callLocks = [], collapseStates = [];
let interruptCommands = 0;
const appResults=[];ipcMain.on("app-action-result",(_,result)=>appResults.push(result));
let musicLibrary={version:1,activePlaylistId:'favorites',currentTrackId:'',playlists:[{id:'favorites',name:'My playlist',tracks:[]}]};
let failSave = false, separateSettingsRequests = 0, win, lastPaint;
let failTaskSave = false, schedule = [], maxWhiteCoverage = 0, paintedFrames = 0, capturePreparations = 0, declines = 0;
let settings = { assistantName: 'Baymax', aiProvider: 'gemini', voiceName: 'Charon', soundEnabled: false,
  appPaths: { discord: 'Discord', whatsapp: 'WhatsApp', obs: 'OBS', premiere: 'Premiere' },
  activeIntegrations: [], autoCloseInterval: 2, geminiApiKey: '', groqModel: 'openai/gpt-oss-120b' };

app.whenReady().then(async () => {
  require('../electron/appProtocol').installAppProtocol(protocol, net, root);
  const handlers = {
    'set-collapsed': (_,value) => {collapseStates.push(value);return true;},
    'voice-call-active': (_,value) => {callLocks.push(value);return true;},
    'clipboard:writeText': (_,text) => {copiedSql.push(text);return true;},
    'get-supabase-sql-setup': () => require('../electron/supabase').SUPABASE_SQL_SETUP,
    'test-supabase': () => ({success:true}),
    'check-supabase-cloud-status': () => ({ready:true}),
    'music-load': () => musicLibrary,
    'music-save': (_,value) => {musicLibrary=require('../electron/music').cleanLibrary(value);return musicLibrary;},
    'music-search': () => [{id:'abcdefghijk',title:'Evening light',artist:'Local test artist',duration:180}],
    boot: () => ({ settings, schedule: [], version: '1.0.0-test', screen: { width: 1920, height: 1080, x: 0, y: 0, scale: 1 } }),
    'save-settings': async (_, patch) => {
      await wait(25);
      if (failSave) throw new Error('Test disk is read-only');
      writes.push(patch); settings = { ...settings, ...patch };
      win.webContents.send('settings-changed', settings); return true;
    },
    'get-chat-messages': () => [], 'get-tracked-apps': () => [], 'get-known-apps': () => [],
    'get-push-to-talk-state': () => ({ enabled: !!settings.pushToTalkEnabled, held: false, ready: true, suspended: false, key: settings.pushToTalkKey || 'Control+Space', error: '' }),
    'suspend-push-to-talk': (_, paused) => { suspensions.push(paused); return true; },
    'ai-mute': (_, muted) => { muteCommands.push(muted); return true; },
    'ai-interrupt': () => { interruptCommands++; return true; },
    'save-schedule-item': (_, item) => { if (failTaskSave) throw new Error('Test task save failed'); schedule.push(item); return schedule; },
    'toggle-schedule-item': (_, id) => { schedule = schedule.map(s => s.id === id ? { ...s, completed: !s.completed } : s); return schedule; },
    'delete-schedule-item': (_, id) => { schedule = schedule.filter(s => s.id !== id); return schedule; },
    'get-daily-totals': () => [], 'get-app-categories': () => ({}), 'get-focus-sessions': () => [],
    'get-blocklist': () => [], 'get-focus-active': () => ({ active: false }),
    'get-settings': () => ({ theme: 'dark', notifications: false }), 'is-onboarded': () => true,
    'get-user-profile': () => ({ name: 'Test User' }), 'get-tracking-health': () => ({ active: true }),
    'request-remote-access': () => false,
    'prepare-remote-host': () => { capturePreparations++; return false; },
    'respond-remote-access': (_, accepted) => { if (!accepted) declines++; return true; },
    'get-available-screens': () => [1, 2].map(id => ({ id: `test-${id}`, name: `Screen ${id}`, label: `Screen ${id}`, isPrimary: id === 1, width: 1920, height: 1080, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
    'secret-present': () => false,
    'engine-list-devices': () => ({ success: true, inputs: ['Test microphone'], outputs: ['Test speakers'] }),
    'engine-list-memory': () => ({ success: true, entries: [{ category: 'notes', key: 'Project', value: 'Mochi is the name of my project' }] }),
    'open-settings-window': () => { separateSettingsRequests++; return true; },
  };
  const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
  for (const channel of new Set([...preload.matchAll(/ipcRenderer\.invoke\(["']([^"']+)/g)].map(m => m[1]))) {
    ipcMain.handle(channel, handlers[channel] || (() => true));
  }
  win = new BrowserWindow({ show: false, frame: false, transparent: true, backgroundColor: '#00000000', width: 1040, height: 640, webPreferences: {
    offscreen: true, backgroundThrottling: false, preload: path.join(root, 'electron/preload.js'),
    contextIsolation: true, nodeIntegration: false, webSecurity: true,
  } });
  win.webContents.on('paint', (_, __, picture) => {
    lastPaint = picture; paintedFrames++;
    const bitmap = picture.toBitmap();
    let white = 0, samples = 0;
    for (let i = 0; i < bitmap.length; i += 64) {
      samples++;
      if (bitmap[i] > 238 && bitmap[i + 1] > 238 && bitmap[i + 2] > 238 && bitmap[i + 3] > 238) white++;
    }
    const coverage = white / Math.max(1, samples);
    if (coverage > .15 && coverage > maxWhiteCoverage) {
      fs.writeFileSync(path.join(root, 'audit/white-frame-failure.png'), picture.toPNG());
    }
    maxWhiteCoverage = Math.max(maxWhiteCoverage, coverage);
  });
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = script => win.webContents.executeJavaScript(script);
  const page = async id => { await js(`document.querySelector('.preferences-nav button[data-page="${id}"]').click()`); await wait(180); };
  try {
    await win.loadURL('baymax://app/index.html'); await wait(850);
    win.webContents.send('tray', 'settings'); await wait(850);
    assert.equal(await js("document.querySelectorAll('.preferences-nav button').length"), 9);
    assert.ok(await js("document.querySelector('.preferences-view').getBoundingClientRect().width > 900"));
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    checks.push('Full settings loads inside the actual expanded companion with nine categories');
    if (lastPaint) fs.writeFileSync(path.join(root, 'audit/settings-companion.png'), lastPaint.toPNG());
    // Leaving the companion must not collapse the form while the user edits it.
    win.webContents.send('cursor', { x: 1039, y: 639 }); await wait(2600);
    assert.ok(await js("document.querySelector('.preferences-view').getBoundingClientRect().height > 400"));
    checks.push('Preferences stays expanded beyond the configured mouse-leave timeout');
    await js("(()=>{const input=document.querySelector('#assistant-display-name');input.value='Nova';input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await wait(150);
    assert.equal(settings.assistantName, 'Nova');
    assert.deepEqual(Object.keys(writes.at(-1)), ['assistantName']);
    assert.equal(await js("document.querySelector('.preferences-header h1').textContent"), 'Nova settings');
    checks.push('Renaming persists only the changed field and updates the companion immediately');
    assert.equal(await js("document.querySelectorAll('.wardrobe-card').length"), 20);
    await js("document.querySelector('[data-avatar-id=nori].wardrobe-pick').click()"); await wait(180);
    assert.equal(settings.companion.avatarId, 'nori');
    assert.deepEqual(Object.keys(writes.at(-1)), ['companion']);
    assert.equal(await js("document.querySelector('[data-avatar-id=nori].wardrobe-pick').getAttribute('aria-pressed')"), 'true');
    checks.push('Wardrobe offers twenty companions and updates the selected card with only a companion settings patch');
    await js("document.querySelector('[data-customize=fenn]').click()"); await wait(350);
    await js("document.querySelector('[aria-label=\"Body colour: Pink\"]').click(); const a=document.querySelector('[data-style=accessory]');a.value='bow';a.dispatchEvent(new Event('change'));");
    await page('sync');
    assert.equal(await js("document.querySelector('input[type=email]')"),null);
    assert.ok(!(await js("document.querySelector('.preferences-content').innerText")).includes('Account password'));
    await js("const url=document.querySelector('input[placeholder*=supabase]');url.value='https://example.invalid';const key=document.querySelector('.settings-surface input[type=password]');key.value='test-only-key';[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Test Connection')).click()");await wait(100);
    assert.ok((await js("document.querySelector('.preferences-content').innerText")).includes('Connection successful'));
    win.webContents.send('sync-status',{connected:true});await wait(50);
    assert.ok((await js("document.querySelector('.preferences-content').innerText")).includes('Connected to live partner channel'));
    assert.ok(await js("!!document.querySelector('[aria-label=\"Partner channel\"]')"));
    checks.push('Open project settings requires URL, key and channel only and shows a green live connection status');
    await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Copy 1-Click SQL Setup')).click()");await wait(60);
    assert.equal(copiedSql[0],require('../electron/supabase').SUPABASE_SQL_SETUP);checks.push('SQL setup uses native clipboard IPC on the custom app protocol');
    await page('ai'); await page('companion');
    assert.equal(await js("document.querySelector('[data-style=color]').value"), '#f0a6ca');
    await js("document.querySelector('.wardrobe-editor').scrollIntoView({block:'nearest'})"); await wait(250);
    if (lastPaint) fs.writeFileSync(path.join(root, 'audit/wardrobe-customize.png'), lastPaint.toPNG());
    failSave = true;
    await js("document.querySelector('[data-wardrobe-apply=fenn]').click()"); await wait(180);
    assert.equal(settings.companion.avatarId, 'nori');
    assert.equal(await js("document.querySelector('[data-avatar-id=nori].wardrobe-pick').getAttribute('aria-pressed')"), 'true');
    assert.equal(await js("document.querySelector('[data-style=color]').value"), '#f0a6ca');
    assert.ok((await js("document.querySelector('.wardrobe-status').textContent")).includes('Could not save'));
    failSave = false;
    await js("document.querySelector('[data-wardrobe-apply=fenn]').click()"); await wait(180);
    assert.equal(settings.companion.avatarId, 'fenn'); assert.equal(settings.companion.styles.fenn.color, '#F0A6CA');
    assert.equal(settings.companion.styles.fenn.accessory, 'bow');
    await js("document.querySelector('[data-avatar-id=nori].wardrobe-pick').click()"); await wait(180);
    await js("document.querySelector('[data-avatar-id=fenn].wardrobe-pick').click()"); await wait(180);
    assert.equal(settings.companion.styles.fenn.color, '#F0A6CA');
    assert.equal(await js("document.querySelector('[data-avatar-id=fenn].wardrobe-pick').getAttribute('aria-pressed')"), 'true');
    checks.push('Custom colour and accessory drafts survive navigation and failed saves; retry applies them and switching preserves each style');
    await js("document.querySelector('.preferences-content').scrollTop=0"); await wait(250);
    if (lastPaint) fs.writeFileSync(path.join(root, 'audit/wardrobe-settings.png'), lastPaint.toPNG());
    await page('ai');
    assert.equal(await js("[...document.querySelectorAll('.settings-surface label')].filter(e=>e.textContent==='Live voice').length"), 1);
    assert.equal(await js("document.querySelector('.voice-picker summary').textContent"), 'Charon');
    assert.equal(await js("document.querySelectorAll('.voice-preview').length"),30);
    failSave = true;
    await js("(()=>{const input=document.querySelector('.settings-surface input[type=password]');input.value='test-key-not-a-real-secret';input.parentElement.querySelector('button').click();})()");
    await wait(140);
    assert.ok((await js("document.querySelector('.preferences-save-status').textContent")).includes('Could not save'));
    assert.equal(await js("document.querySelector('.settings-surface input[type=password]').value"), 'test-key-not-a-real-secret');
    failSave = false;
    await js("document.querySelector('.settings-surface input[type=password]').parentElement.querySelector('button').click()");
    await wait(140);
    assert.equal(settings.geminiApiKey, 'test-key-not-a-real-secret');
    assert.equal(await js("document.querySelector('.settings-surface input[type=password]').value"), '');
    checks.push('Failed API-key save keeps the draft and reports failure; retry saves successfully');
    await page('control');
    assert.equal(await js("document.querySelectorAll('[data-skill]').length"),18);
    await js("document.querySelector('[data-skill=browser_control] .switch').click()");await wait(100);
    assert.equal(settings.activeActions.browser_control,false);
    await js("document.querySelector('[data-skill=browser_control] .switch').click()");await wait(100);
    assert.equal(settings.activeActions.browser_control,true);
    checks.push('All 18 skills appear and browser control toggles persist in both directions');
    const text = await js("document.querySelector('.preferences-content').innerText");
    assert.ok(text.includes('Nova AI Engine'));
    assert.ok(text.includes('Mochi is the name of my project'));
    assert.ok(!text.includes('Live Voice Model'));
    checks.push('AI engine uses the chosen name, has no duplicate voice selector, and preserves user memory text');
    assert.equal(await js("document.querySelector('[aria-label=\"Unprompted AI Check-ins\"]').getAttribute('aria-pressed')"),'false');
    await js("document.querySelector('[aria-label=\"Unprompted AI Check-ins\"]').click()"); await wait(100);
    assert.equal(settings.proactiveTalkingEnabled,true);
    await js("document.querySelector('[aria-label=\"Unprompted AI Check-ins\"]').click()"); await wait(100);
    assert.equal(settings.proactiveTalkingEnabled,false);
    failSave=true;
    await js("const interests=document.querySelector('#user-interests'); interests.value='YouTube growth, tech, editing'; interests.dispatchEvent(new Event('input')); document.querySelector('.save-interests').click()"); await wait(100);
    assert.equal(await js("document.querySelector('#user-interests').value"),'YouTube growth, tech, editing');
    assert.ok(!settings.userInterests);
    failSave=false;
    await js("document.querySelector('.save-interests').click()"); await wait(100);
    assert.equal(settings.userInterests,'YouTube growth, tech, editing');
    checks.push('Unprompted check-ins default OFF, toggle both ways, and interests survive save failure before a successful retry');
    await js("document.querySelector('.ptt-change-key').click()"); await wait(150);
    assert.ok(await js("document.querySelector('.ptt-key-dialog').open"));
    fs.writeFileSync(path.join(root, 'audit/push-to-talk-picker-preview.png'), (await win.webContents.capturePage()).toPNG());
    assert.ok(!settings.pushToTalkEnabled);
    assert.ok(await js("document.querySelector('.ptt-key-save').disabled"));
    await js("document.querySelector('.ptt-key-cancel').click()"); await wait(100);
    assert.ok(!settings.pushToTalkEnabled);
    await js("document.querySelector('.ptt-change-key').click()"); await wait(100);
    await js("document.querySelector('.ptt-key-record').dispatchEvent(new KeyboardEvent('keydown', {key:'F8',code:'F8',ctrlKey:true,bubbles:true,cancelable:true}))");
    assert.equal(await js("document.querySelector('.ptt-key-record').textContent"), 'Ctrl + F8');
    failSave = true;
    await js("document.querySelector('.ptt-key-save').click()"); await wait(100);
    assert.ok(!settings.pushToTalkEnabled); assert.ok(await js("document.querySelector('.ptt-key-dialog').open"));
    failSave = false;
    await js("document.querySelector('.ptt-key-save').click()"); await wait(150);
    assert.equal(settings.pushToTalkKey, 'Control+F8'); assert.equal(settings.pushToTalkEnabled, true);
    assert.equal(await js("document.querySelector('.ptt-key-dialog') === null"), true);
    await js("document.querySelector('.ptt-setting .switch').click()"); await wait(100);
    assert.equal(settings.pushToTalkEnabled, false);
    await js("document.querySelector('.ptt-setting .switch').click()"); await wait(100);
    assert.equal(settings.pushToTalkEnabled,true); assert.ok(await js("!document.querySelector('.ptt-key-dialog')"));
    await js("document.querySelector('.ptt-change-key').click()"); await wait(100);
    assert.equal(suspensions.at(-1),true);
    await js("document.querySelector('.ptt-key-dialog').remove()"); await wait(100);
    assert.equal(suspensions.at(-1),false);
    await js("document.querySelector('.ptt-change-key').click()"); await wait(100);
    await page('ai'); await wait(100);
    assert.equal(suspensions.at(-1),false); assert.ok(await js("!document.querySelector('.ptt-key-dialog')"));
    checks.push('Saved talk keys toggle directly; picker failures retain drafts; removing the modal or navigating away always resumes the microphone');
    await page('ai');
    await js("window.__micRequests=0;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.__micRequests++;throw new Error('Simulated unavailable microphone');}}})");
    await js("[...document.querySelectorAll('.settings-surface button')].find(b=>/Groq/.test(b.textContent)).click()"); await wait(100);
    assert.ok(await js("[...document.querySelectorAll('.settings-surface select')].some(s=>s.value==='openai/gpt-oss-120b')"));
    assert.equal(muteCommands.at(-1),true); assert.equal(await js('window.__micRequests'),1);
    await js("[...document.querySelectorAll('.settings-surface button')].find(b=>/Gemini Live/.test(b.textContent)).click()"); await wait(100);
    for(let i=0;i<40 && muteCommands.at(-1)!==false;i++)await wait(50);
    assert.equal(muteCommands.at(-1),false,JSON.stringify({provider:settings.aiProvider,mic:settings.micEnabled,mutes:muteCommands.slice(-5)}));
    checks.push('Provider changes synchronize the fresh settings: Groq opens its microphone and mutes Gemini; switching back unmutes Gemini');
    checks.push('Groq model picker represents the saved GPT OSS model instead of silently selecting an obsolete model');
    await page('companion');
    await js("document.querySelector('.preferences-close').click()"); await wait(150);
    await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='All settings…').click()"); await wait(150);
    assert.equal(separateSettingsRequests, 0);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    checks.push('Quick settings reopens the retained embedded panel without creating a separate window');
    await wait(450);
    const layout = await js("(()=>{const p=document.querySelector('.preferences-content');return {width:p.clientWidth,scrollWidth:p.scrollWidth,height:p.clientHeight,scrollHeight:p.scrollHeight};})()");
    assert.ok(layout.scrollWidth <= layout.width + 2, JSON.stringify(layout));
    checks.push('Settings has vertical scrolling without horizontal overflow at the actual companion size');
    if (lastPaint) fs.writeFileSync(path.join(root, 'audit/settings-companion.png'), lastPaint.toPNG());
    for (const label of ['Home', 'Chat', 'Partner', 'Tasks']) {
      await js(`document.querySelector('#header button[aria-label="${label}"]').click()`); await wait(650);
      if (label === 'Home') {
        assert.equal(await js("document.querySelector('#bot-canvas').dataset.avatarId"),settings.companion.avatarId);
        const home = await js(`(()=>{
          const card=document.querySelector('.overview .left .card').getBoundingClientRect();
          const count=document.querySelector('.home-count').getBoundingClientRect();
          const arrow=document.querySelector('.overview .jump').getBoundingClientRect();
          const buttons=[...document.querySelectorAll('.home-actions button')].map(b=>({background:getComputedStyle(b).background,border:getComputedStyle(b).border,color:getComputedStyle(b).color,bottom:b.getBoundingClientRect().bottom}));
          const pills=[...document.querySelectorAll('.overview .right .pill')].map(b=>b.getBoundingClientRect().height);
          return {height:card.height,bottom:card.bottom,gap:arrow.left-count.right,buttons,pills};
        })()`);
        assert.ok(home.height >= 85 && home.height <= 95, JSON.stringify(home));
        assert.ok(home.gap >= 8); assert.equal(home.buttons[0].background,home.buttons[1].background);
        assert.equal(home.buttons[0].border,home.buttons[1].border);
        assert.ok(home.buttons.every(b=>b.bottom <= home.bottom));
        assert.equal(home.pills.length,4); assert.ok(home.pills.every(height=>height>=30 && height<=35));
        checks.push('Home renders a 90px card, four balanced app pills, matching dark buttons and clear arrow spacing');
      }
      if (label === 'Chat') {
        const style=await js(`(()=>{const input=document.querySelector('textarea.chat-input');input.focus();const s=getComputedStyle(input);return {border:s.borderTopWidth,outline:s.outlineStyle,shadow:s.boxShadow};})()`);
        assert.deepEqual(style,{border:'0px',outline:'none',shadow:'none'});
        checks.push('Focused Chat textarea has no border, outline or shadow inside its dark input bar');
      }
      if (label === 'Tasks') {
        assert.equal(await js("getComputedStyle(document.querySelector('#bot-canvas')).display"),'none');
        checks.push('Tasks hides the companion immediately instead of leaving a spring-shrunk dot');
      }
      if (lastPaint) fs.writeFileSync(path.join(root, `audit/ui-${label.toLowerCase()}.png`), lastPaint.toPNG());
      assert.ok(await js("document.querySelectorAll('#views .view.on').length === 1"));
    }
    await js(`document.querySelector('#header button[aria-label="Home"]').click()`);await wait(400);
    assert.equal(await js("document.querySelectorAll('.home-actions .music-mini button').length"),4);
    await js("document.querySelector('.home-actions [aria-label=\"Play music\"]').click()");await wait(450);
    assert.ok(await js("document.querySelector('.music-view').classList.contains('on')"));
    assert.ok(await js("document.querySelector('.repeat-btn').parentElement.classList.contains('music-mini') && document.querySelector('.repeat-btn').previousElementSibling.getAttribute('aria-label')==='Next song'"));
    assert.equal(await js("getComputedStyle(document.querySelector('.music-player.card')).paddingLeft"),'78px');
    checks.push('Music retains the left-side companion space and Repeat beside Next in one compact row');
    await js("document.querySelector('[aria-label=\"Playlist name\"]').value='Evening';document.querySelector('[aria-label=\"Create playlist\"]').click()");await wait(150);
    assert.equal(musicLibrary.playlists.length,2);
    await js("document.querySelector('[aria-label=\"Search songs\"]').value='Evening';document.querySelector('.music-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");await wait(100);
    await js("document.querySelector('.music-results button').click()");await wait(200);
    assert.equal(musicLibrary.playlists[1].tracks[0].title,'Evening light');
    assert.equal(await js("document.querySelector('.music-track-list .music-track-label span').textContent"),'Evening light');
    assert.ok(await js("(()=>{const e=document.querySelector('.music-view');return e.scrollWidth<=e.clientWidth+1})()"));
    fs.writeFileSync(path.join(root,'audit/ui-music.png'),(await win.webContents.capturePage()).toPNG());
    checks.push('Compact Home music controls open the player; creating a playlist, searching and adding a song persist locally without horizontal overflow');
    win.webContents.send('partner-presence',{online:true,justCameOnline:false});
    win.webContents.send('music-signal',{type:'status',playing:true,title:'A song from your partner'});await wait(100);
    assert.ok(await js("document.querySelector('.music-partner [aria-label=\"Join partner music\"]') !== null"));
    await js(`document.querySelector('#header button[aria-label="Home"]').click()`);await wait(350);
    assert.ok(await js("document.querySelector('.home-summary .music-partner-pill').textContent.includes('A song from your partner')"));
    win.webContents.send('partner-presence',{online:false});await wait(100);
    assert.ok(await js("!document.querySelector('.home-summary [aria-label=\"Join partner music\"]')"));
    checks.push('Partner music badge and Join appear in Music and Home while online and disappear when offline');
    await js(`document.querySelector('#header button[aria-label="Tasks"]').click()`);await wait(300);
    failTaskSave = true;
    await js("(()=>{const input=document.querySelector('.sched-input');input.value='A task to preserve';document.querySelector('.sched-add-btn').click();})()"); await wait(100);
    assert.equal(await js("document.querySelector('.sched-input').value"), 'A task to preserve');
    assert.equal(schedule.length, 0);
    assert.ok((await js("document.querySelector('.schedule-view .chat-error').textContent")).includes('Could not save'));
    failTaskSave = false;
    await js("document.querySelector('.sched-add-btn').click()"); await wait(100);
    assert.equal(schedule.length, 1); assert.equal(schedule[0].time, '');
    assert.equal(await js("document.querySelector('.sched-input').value"), '');
    checks.push('Task-save failure preserves the draft; retry persists once, without inventing a deadline');
    assert.equal(await js("!!document.querySelector('#header button[aria-label=\"PC Control\"]')"),true);
    assert.equal(capturePreparations,0);
    checks.push('PC Control stays visible and never starts screen capture without consent');
    for (let i = 0; i < 5; i++) {
      win.webContents.send('tray', 'pause'); await wait(450);
      win.webContents.send('tray', 'pause'); await wait(80);
      win.webContents.send('cursor', { x: 520, y: 4 }); await wait(180);
      win.webContents.send('tray', 'open'); await wait(180);
    }
    const beforeInterrupt=interruptCommands;
    await js("const bot=document.querySelector('#bot-canvas'); const rect=bot.getBoundingClientRect(); bot.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2+20}))"); await wait(80);
    assert.ok(interruptCommands>beforeInterrupt,'Clicking the companion must send interrupt even when the renderer last reported idle');
    checks.push('Clicking the companion interrupts without relying on a stale renderer busy state');
    await js(`document.querySelector('#header button[aria-label="Home"]').click()`);await wait(450);
    win.webContents.send('cursor',{x:520,y:70});
    const clickCompanion=()=>js("(()=>{const b=document.querySelector('#bot-canvas'),r=b.getBoundingClientRect();b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2+20}));})()");
    await clickCompanion();await wait(310);await clickCompanion();await wait(310);await clickCompanion();await wait(250);
    assert.ok(await js("document.querySelector('#views .view.on')?.textContent.includes('Too many hits')"),'Third deliberate click enters the dizzy view');
    assert.equal(await js("getComputedStyle(document.querySelector('#header')).opacity"),'1');
    for(let i=0;i<8;i++){await clickCompanion();await wait(35);}
    await wait(3600);
    assert.ok(await js("getComputedStyle(document.querySelector('#bot-canvas')).display!=='none' && document.querySelector('.overview').classList.contains('on')"));
    checks.push('Triple-click remains visible; rapid clicks cannot extend dizzy mode, and Home recovers');
    assert.ok(paintedFrames > 20);
    assert.ok(maxWhiteCoverage < .15, `White frame coverage: ${maxWhiteCoverage}`);
    checks.push('Five hide/wake cycles render without a white panel in the offscreen compositor');
    win.webContents.send('app-action',{id:'navigation-test',action:'open_view',view:'music'});await wait(450);
    assert.ok(await js("!!document.querySelector('.music-view')"));assert.equal(appResults.at(-1).result,'Opened music.');
    win.webContents.send('app-action',{id:'dizzy-test',action:'emote',emote:'dizzy'});await wait(100);
    assert.equal(appResults.at(-1).result,'Showing dizzy.');
    checks.push('AI navigation and dizzy emote cross the preload bridge and acknowledge completion');
    win.webContents.send('voice-signal',{type:'ring',sessionId:'settings-call-test'});await wait(250);
    assert.equal(callLocks.at(-1),true);
    assert.equal(muteCommands.at(-1),true);
    assert.ok(await js("document.querySelector('.couple-chat-view').classList.contains('on')"));
    assert.equal(collapseStates.at(-1),false);
    await js("[...document.querySelectorAll('.couple-chat-view button')].find(b=>b.textContent==='Decline').click()");await wait(100);
    assert.equal(callLocks.at(-1),false);
    checks.push('Incoming call wakes partner chat, marks the window expanded, locks the AI microphone, and releases the lock on decline');
    assert.ok(collapseStates.includes(true) && collapseStates.includes(false),'Native collapsed state must follow UI transitions');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(root, 'audit/settings-smoke-results.json'), JSON.stringify({ checks, errors, layout, paintedFrames, maxWhiteCoverage }, null, 2));
    console.log(JSON.stringify({ checks, errors, layout, paintedFrames, maxWhiteCoverage })); app.exit(0);
  } catch (error) {
    if (lastPaint) fs.writeFileSync(path.join(root, 'audit/settings-failure.png'), lastPaint.toPNG());
    fs.writeFileSync(path.join(root, 'audit/settings-smoke-results.json'), JSON.stringify({ checks, errors, failure: error.stack }, null, 2));
    console.error(error); app.exit(1);
  }
});
