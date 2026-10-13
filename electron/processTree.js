const { execFile } = require('node:child_process');
const path = require('node:path');

/** Resolve only after the owned process tree has terminated; never kill by executable name. */
function terminateProcessTree(proc, deps = {}) {
  if (!proc?.pid) return Promise.resolve();
  const platform = deps.platform || process.platform;
  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      (deps.execFile || execFile)(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 15000 }, error => {
          if (!error || proc.exitCode !== null || proc.signalCode != null) resolve();
          else reject(new Error(`Could not stop voice process ${proc.pid}: ${error.message}`));
        });
      return;
    }
    if (proc.exitCode !== null || proc.signalCode != null) { resolve(); return; }
    const timeout = setTimeout(() => reject(new Error('Voice process did not stop')), 10000);
    proc.once('close', () => { clearTimeout(timeout); resolve(); });
    try { proc.kill(); } catch (error) { clearTimeout(timeout); reject(error); }
  });
}
module.exports = { terminateProcessTree };
