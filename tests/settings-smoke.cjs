const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, 'audit/settings-smoke-profile'));
app.disableHardwareAcceleration();
require('../electron/appProtocol').registerAppScheme(protocol);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [], writes = [];
let failSave = false, separateSettingsRequests = 0, win, lastPaint;
let failTaskSave = false, schedule = [], maxWhiteCoverage = 0, paintedFrames = 0, capturePreparations = 0, declines = 0;
let settings = { assistantName: 'Baymax', aiProvider: 'gemini', voiceName: 'Charon', soundEnabled: false,
  appPaths: { discord: 'Discord', whatsapp: 'WhatsApp', obs: 'OBS', premiere: 'Premiere' },
  activeIntegrations: [], autoCloseInterval: 2, geminiApiKey: '', groqModel: 'openai/gpt-oss-120b' };

app.whenReady().then(async () => {
  require('../electron/appProtocol').installAppProtocol(protocol, net, root);
  const handlers = {
    boot: () => ({ settings, schedule: [], version: '1.0.0-test', screen: { width: 1920, height: 1080, x: 0, y: 0, scale: 1 } }),
    'save-settings': async (_, patch) => {
      await wait(25);
      if (failSave) throw new Error('Test disk is read-only');
      writes.push(patch); settings = { ...settings, ...patch };
      win.webContents.send('settings-changed', settings); return true;
    },
    'get-chat-messages': () => [], 'get-tracked-apps': () => [], 'get-known-apps': () => [],
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
    'marklv-list-devices': () => ({ success: true, inputs: ['Test microphone'], outputs: ['Test speakers'] }),
    'marklv-list-memory': () => ({ success: true, entries: [{ category: 'notes', key: 'Project', value: 'Mochi is the name of my project' }] }),
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
    assert.equal(await js("document.querySelectorAll('.preferences-nav button').length"), 8);
    assert.ok(await js("document.querySelector('.preferences-view').getBoundingClientRect().width > 900"));
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    checks.push('Full settings loads inside the actual expanded companion with eight categories');
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
    await page('ai');
    assert.equal(await js("[...document.querySelectorAll('.settings-surface label')].filter(e=>e.textContent==='Live voice').length"), 1);
    assert.equal(await js("[...document.querySelectorAll('.settings-surface select')].find(e=>[...e.options].some(o=>o.value==='Charon')).value"), 'Charon');
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
    const text = await js("document.querySelector('.preferences-content').innerText");
    assert.ok(text.includes('Nova PC Control & AI Engine'));
    assert.ok(text.includes('Mochi is the name of my project'));
    assert.ok(!text.includes('Live Voice Model'));
    checks.push('PC control uses the chosen name, has no duplicate voice selector, and preserves user memory text');
    await page('ai');
    await js("[...document.querySelectorAll('.settings-surface button')].find(b=>/Groq/.test(b.textContent)).click()"); await wait(100);
    assert.ok(await js("[...document.querySelectorAll('.settings-surface select')].some(s=>s.value==='openai/gpt-oss-120b')"));
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
    for (const label of ['Home', 'Chat', 'Partner', 'PC', 'Tasks']) {
      await js(`document.querySelector('#header button[aria-label="${label}"]').click()`); await wait(650);
      if (label === 'Home') {
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
      if (label === 'PC') {
        const remote=await js(`(()=>{const card=document.querySelector('.remote-card').getBoundingClientRect(),text=document.querySelector('.remote-copy').getBoundingClientRect(),button=document.querySelector('.remote-actions button').getBoundingClientRect();return {height:card.height,textRight:text.right,buttonLeft:button.left,buttonBottom:button.bottom,bottom:card.bottom};})()`);
        assert.ok(remote.height>=85 && remote.height<=95,JSON.stringify(remote));
        assert.ok(remote.buttonLeft>=remote.textRight && remote.buttonBottom<=remote.bottom);
        checks.push('PC access renders as a 90px horizontal card with the request button on the right');
      }
      if (lastPaint) fs.writeFileSync(path.join(root, `audit/ui-${label.toLowerCase()}.png`), lastPaint.toPNG());
      assert.ok(await js("document.querySelectorAll('#views .view.on').length === 1"));
    }
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
    await js(`document.querySelector('#header button[aria-label="PC"]').click()`); await wait(450);
    await js("document.querySelector('.remote-actions button').click()"); await wait(120);
    assert.ok((await js("document.querySelector('.remote-error').textContent")).includes('Could not send'));
    assert.equal(await js("document.querySelector('.remote-actions button').textContent"),'Request Access');
    checks.push('Failed remote request displays a retryable error instead of pretending it was delivered');
    win.webContents.send('remote-access-requested',{sender:'Test Partner'}); await wait(600);
    assert.ok(await js("document.querySelector('.remote-card').getBoundingClientRect().height > 170"));
    assert.equal(await js("document.querySelectorAll('.remote-monitor select option').length"),2);
    assert.equal(capturePreparations,0);
    if(lastPaint)fs.writeFileSync(path.join(root,'audit/ui-pc-consent.png'),lastPaint.toPNG());
    await js("[...document.querySelectorAll('.remote-actions button')].find(b=>b.textContent==='Decline').click()"); await wait(600);
    assert.equal(declines,1); assert.equal(capturePreparations,0);
    assert.ok(await js("document.querySelector('.remote-card').getBoundingClientRect().height < 95"));
    checks.push('Incoming consent expands for screen selection, never starts capture on receipt, and shrinks after decline');
    for (let i = 0; i < 5; i++) {
      win.webContents.send('tray', 'pause'); await wait(450);
      win.webContents.send('tray', 'pause'); await wait(80);
      win.webContents.send('cursor', { x: 520, y: 4 }); await wait(180);
      win.webContents.send('tray', 'open'); await wait(180);
    }
    assert.ok(paintedFrames > 20);
    assert.ok(maxWhiteCoverage < .15, `White frame coverage: ${maxWhiteCoverage}`);
    checks.push('Five hide/wake cycles render without a white panel in the offscreen compositor');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(root, 'audit/settings-smoke-results.json'), JSON.stringify({ checks, errors, layout, paintedFrames, maxWhiteCoverage }, null, 2));
    console.log(JSON.stringify({ checks, errors, layout, paintedFrames, maxWhiteCoverage })); app.exit(0);
  } catch (error) {
    if (lastPaint) fs.writeFileSync(path.join(root, 'audit/settings-failure.png'), lastPaint.toPNG());
    fs.writeFileSync(path.join(root, 'audit/settings-smoke-results.json'), JSON.stringify({ checks, errors, failure: error.stack }, null, 2));
    console.error(error); app.exit(1);
  }
});
