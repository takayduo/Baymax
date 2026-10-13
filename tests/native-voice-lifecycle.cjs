// Exercise only processes this test owns. No API calls, microphone access or keyboard injection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { terminateProcessTree } = require('../electron/processTree');
const { PushToTalkService } = require('../electron/pushToTalk');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

(async () => {
  const checks = [];
  let parent, shortcut;
  try {
    assert.equal(process.platform, 'win32');
    parent = spawn(process.execPath, ['-e', `
      const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {windowsHide:true,stdio:'ignore'});
      child.once('spawn',()=>process.send({child:child.pid}));
      setInterval(()=>{},1000);
    `], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const descendant = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test descendant did not start')), 10000);
      parent.once('message', message => { clearTimeout(timeout); resolve(message.child); });
      parent.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    assert.ok(alive(parent.pid)); assert.ok(alive(descendant));
    await terminateProcessTree(parent);
    for (let i = 0; i < 40 && (alive(parent.pid) || alive(descendant)); i++) await wait(50);
    assert.equal(alive(parent.pid), false); assert.equal(alive(descendant), false);
    checks.push('Windows shutdown removes the owned parent and its actual child process');

    shortcut = new PushToTalkService(() => {});
    shortcut.configure({ pushToTalkEnabled: true, pushToTalkKey: 'Control+Shift+F8' });
    async function waitReady(previous) {
      for (let i = 0; i < 375; i++) {
        if (shortcut.snapshot().ready && shortcut.child !== previous) return;
        await wait(200);
      }
      throw new Error(shortcut.snapshot().error || 'Native shortcut did not become ready');
    }
    await waitReady(null);
    const first = shortcut.child;
    first.kill(); // Simulate a transient helper crash; production must recover by itself.
    await waitReady(first);
    assert.notEqual(shortcut.child.pid, first.pid);
    assert.equal(shortcut.snapshot().held, false);
    checks.push('The real Windows shortcut helper automatically restarts after an unexpected exit');
    const recovered = shortcut.child;
    shortcut.configure({ pushToTalkEnabled: false, pushToTalkKey: 'Control+Shift+F8' });
    for (let i = 0; i < 40 && alive(recovered.pid); i++) await wait(50);
    assert.equal(alive(recovered.pid), false);
    assert.equal(shortcut.retryTimer, null); assert.equal(shortcut.snapshot().ready, false);
    checks.push('Disabling push-to-talk stops the recovered helper and cancels recovery');
    const result = { checks, errors: [], microphoneOpened: false, injectedKeys: false };
    fs.writeFileSync(path.join(__dirname, '../audit/native-voice-lifecycle.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    shortcut?.stop();
    if (parent?.pid && alive(parent.pid)) await terminateProcessTree(parent);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
