const path = require('node:path');
const { spawn } = require('node:child_process');
const keys = require('../public/voice-keys.json');
const modifiers = { Control: 17, Alt: 18, Shift: 16 };

function parseShortcut(value) {
  if (typeof value !== 'string' || value.length > 60) return null;
  const parts = value.split('+'), key = keys.find(k => k.code === parts.at(-1));
  const mods = parts.slice(0, -1);
  if (!key || mods.some(m => !Object.hasOwn(modifiers, m)) || new Set(mods).size !== mods.length) return null;
  if (mods.includes('Alt') && key.code === 'F4') return null;
  const ordered = Object.keys(modifiers).filter(m => mods.includes(m));
  return { key: [...ordered, key.code].join('+'), codes: [...ordered.map(m => modifiers[m]), key.vk],
    label: [...ordered.map(m => m === 'Control' ? 'Ctrl' : m), key.label].join(' + ') };
}

// One global press/release source for both voice providers. No keyboard text is captured.
class PushToTalkService {
  constructor(onChange, deps = {}) {
    this.onChange = onChange; this.spawn = deps.spawn || spawn; this.platform = deps.platform || process.platform;
    this.now = deps.now || Date.now;
    this.later = deps.setTimeout || setTimeout; this.cancel = deps.clearTimeout || clearTimeout;
    this.every = deps.setInterval || setInterval; this.cancelEvery = deps.clearInterval || clearInterval;
    this.pauses = new Set(); this.child = null; this.timer = null; this.retryTimer = null; this.armed = false;
    this.active = false; this.failures = 0;
    this.state = { enabled: false, held: false, ready: false, suspended: false, key: 'Control+Space', error: '' };
  }
  publish(patch) { const next = { ...this.state, ...patch }; if (JSON.stringify(next) !== JSON.stringify(this.state)) { this.state = next; this.onChange({ ...next }); } }
  snapshot() { return { ...this.state }; }
  suspend(owner, paused) {
    if (paused) this.pauses.add(owner); else this.pauses.delete(owner);
    this.armed = false;
    this.publish({ held: false, suspended: this.pauses.size > 0 });
  }
  configure(settings) {
    const shortcut = parseShortcut(settings.pushToTalkKey || 'Control+Space');
    const enabled = !!settings.pushToTalkEnabled, active = enabled && settings.micEnabled !== false;
    const signature = JSON.stringify([active, shortcut?.key]);
    if (signature === this.signature && (!active || this.child || this.retryTimer)) { this.publish({ enabled }); return; }
    this.stop(); this.signature = signature; this.shortcut = shortcut; this.active = active;
    this.publish({ enabled, key: shortcut?.key || '', error: '' });
    if (!active) return;
    if (!shortcut || this.platform !== 'win32') { this.active = false; this.publish({ error: 'Global push-to-talk requires Windows and a valid shortcut.' }); return; }
    this.startHelper();
  }
  startHelper() {
    if (!this.active || this.child) return;
    const shortcut = this.shortcut;
    const required = shortcut.codes.map(code => `(Down(${code}))`).join(' && ');
    const excluded = [16, 17, 18, 91, 92].filter(code => !shortcut.codes.includes(code)).map(code => `!Down(${code})`).join(' && ');
    // Poll responsively, but write only transitions plus a heartbeat. No text keys are logged.
    const script = `$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\nusing System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;\npublic static class BaymaxTalkKey {\n[DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);\nstatic bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }\npublic static void Run() {\nvar parent = Process.GetProcessById(${process.pid}); var clock = Stopwatch.StartNew(); long lastSent = -1000; bool previous = false;\nwhile(!parent.HasExited) { bool held = ${required} && ${excluded}; if(held != previous || clock.ElapsedMilliseconds - lastSent >= 1000) { Console.WriteLine(held ? "1" : "0"); Console.Out.Flush(); previous = held; lastSent = clock.ElapsedMilliseconds; } Thread.Sleep(25); }\n}\n}\n'@\n[BaymaxTalkKey]::Run()`;
    let child;
    try {
      child = this.spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
    } catch { this.recover(); return; }
    let buffer = '', lastSeen = this.now(), started = false;
    const born = lastSeen;
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      buffer += chunk.toString();
      let lineEnd;
      // Drain complete lines before checking the remaining partial line's size.
      while ((lineEnd = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, lineEnd).trim(); buffer = buffer.slice(lineEnd + 1);
        if (line !== '0' && line !== '1') continue;
        started = true; lastSeen = this.now();
        if (lastSeen - born > 60000) this.failures = 0;
        if (line === '0' && !this.pauses.size) this.armed = true;
        this.publish({ ready: true, error: '', held: line === '1' && this.armed && !this.pauses.size });
      }
      if (buffer.length > 8192) this.fail(child);
    });
    child.stderr.on('data', () => {});
    child.on('error', () => this.fail(child)); child.on('exit', () => this.fail(child));
    this.timer = this.every(() => { if (this.now() - lastSeen > (started ? 20000 : 60000)) this.fail(child); }, 2000);
    this.timer.unref?.();
  }
  fail(child) { if (this.child !== child) return; this.stopHelper(); this.recover(); }
  recover() {
    if (!this.active || this.retryTimer) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5));
    this.publish({ held: false, ready: false, error: 'Reconnecting the talk shortcut… Your microphone stays gated until it is ready.' });
    this.retryTimer = this.later(() => { this.retryTimer = null; this.startHelper(); }, delay);
    this.retryTimer.unref?.();
  }
  stopHelper() {
    const child = this.child; this.child = null; this.armed = false;
    if (this.timer) this.cancelEvery(this.timer); this.timer = null;
    if (child) { try { child.kill(); } catch {} }
    this.publish({ held: false, ready: false });
  }
  stop() {
    this.active = false; this.signature = null; this.failures = 0;
    if (this.retryTimer) this.cancel(this.retryTimer); this.retryTimer = null;
    this.stopHelper();
  }
}
module.exports = { parseShortcut, PushToTalkService };
