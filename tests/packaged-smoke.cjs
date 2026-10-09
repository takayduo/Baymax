const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const packaged = path.join(root, 'release/win-unpacked');
const appRoot = path.join(packaged, 'resources/app');
const checks = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(root, 'audit/package-profile-'));
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}
function walk(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
}
(async () => {
  try {
    for (const file of ['dist/index.html', 'electron/main.js', 'electron/preload.js', 'public/icons/icon.ico', 'public/remote-viewer.html', 'productivity/dist/index.html']) {
      assert.ok(fs.existsSync(path.join(appRoot, file)), file);
    }
    checks.push('Required renderer, native icons, remote viewer and Productivity assets are packaged');
    const forbidden = walk(path.join(packaged, 'resources')).filter(file => /(?:^|[\\/])(?:\.env(?:\..*)?|api_keys\.json|long_term\.json|sessions\.json|service_account.*\.json|client_secret.*\.json|credentials\.json|smoke-parent\.(?:js|html))$/i.test(file));
    assert.deepEqual(forbidden, [], 'Local secrets, memories or temporary UI fixtures must not be shipped');
    checks.push('Known local credentials, saved memory and temporary smoke fixtures are absent from the package');
    const engine = spawnSync(path.join(packaged, 'resources/engine/BaymaxEngine.exe'), ['--self-test'], { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
    assert.equal(engine.status, 0, engine.stderr);
    const engineResult = JSON.parse(engine.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(engineResult.success, true); assert.equal(engineResult.actions.length, 21); assert.equal(engineResult.data_separate, true);
    checks.push('Packaged engine imports successfully and discovers 21 actions with Python absent from PATH');
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
    for (let i = 0; i < 80; i++) { if (await evaluate("document.querySelectorAll('.preferences-nav button').length === 8")) break; await wait(150); }
    assert.equal(await evaluate("document.querySelectorAll('.preferences-nav button').length"), 8);
    assert.equal(await evaluate("document.querySelector('.preferences-header h1').textContent"), 'Baymax settings');
    checks.push('Actual Baymax.exe boots with an isolated profile and opens all eight embedded settings categories');
    assert.equal(await evaluate("fetch('baymax://app/sounds/blip.wav').then(response=>response.status)"), 200);
    checks.push('Packaged notification audio is readable through the production asset protocol');
    await evaluate("document.querySelector('#header button[aria-label=Home]').click()"); await wait(700);
    const homeHeight = await evaluate("document.querySelector('.overview .card').getBoundingClientRect().height");
    assert.ok(homeHeight >= 85 && homeHeight <= 95, String(homeHeight));
    checks.push('Packaged executable renders the compact 90px Home card');
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
