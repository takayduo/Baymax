const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');

function resolveApplication(query, configured = {}, catalog = []) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Choose an application first.');
  const q = query.trim().toLowerCase();
  const matches = catalog.filter(a => [a.id, a.name, a.processName, ...(a.aliases || [])].some(n => n?.toLowerCase() === q));
  const exactId = matches.find(a => a.id?.toLowerCase() === q);
  const configuredPath = Object.entries(configured).find(([key]) => key.toLowerCase() === q)?.[1];
  if (!exactId && matches.length > 1 && !configuredPath) throw new Error('More than one application matches. Choose its exact app ID or executable path.');
  const entry = exactId || matches[0];
  if (entry && !configuredPath) return entry;
  const raw = String(configuredPath || query).trim();
  // Accept an existing full path, or a quoted executable followed by separately
  // parsed arguments. No command shell, interpolation, or fuzzy title matching.
  let executable = raw, args = [];
  if (!fs.existsSync(raw)) {
    const match = /^"([^"]+\.exe)"(?:\s+(.*))?$/i.exec(raw) || /^(.+?\.exe)\s+(.*)$/i.exec(raw);
    if (match) {
      executable = match[1];
      args = (match[2]?.match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, ''));
    }
  }
  if (!path.win32.isAbsolute(executable) || !fs.existsSync(executable) || !/\.(exe|lnk)$/i.test(executable)) {
    if (entry) return entry;
    throw new Error('Application not found. Scan Apps or select its executable/shortcut in Settings.');
  }
  return { path: executable, args, processName: path.basename(executable, path.extname(executable)) };
}

async function launchApplication(query, configured, catalog, shell) {
  try {
    const entry = resolveApplication(query, configured, catalog);
    if (entry.shortcut || /\.lnk$/i.test(entry.path || '')) {
      const error = await shell.openPath(entry.shortcut || entry.path);
      return error ? { success: false, error } : { success: true };
    }
    const executable = entry.appId ? path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe') : entry.path;
    const args = entry.appId ? ['shell:AppsFolder\\' + entry.appId] : (entry.args || []);
    if (!executable || !fs.existsSync(executable)) throw new Error('Application executable is unavailable. Rescan Apps.');
    return await new Promise(resolve => {
      const child = spawn(executable, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', e => resolve({ success: false, error: e.message }));
      child.once('spawn', () => { child.unref(); resolve({ success: true, path: executable }); });
    });
  } catch (e) { return { success: false, error: e.message }; }
}

async function closeApplication(query, configured, catalog, getRunning, isProtected) {
  try {
    const entry = resolveApplication(query, configured, catalog);
    if (!entry.path || !/\.exe$/i.test(entry.path)) throw new Error('No verified executable for this application. Open it and rescan first.');
    const running = await getRunning();
    const matches = running.filter(p => p.Path?.toLowerCase() === entry.path.toLowerCase() && p.Id !== process.pid && !isProtected(p.ProcessName));
    if (!matches.length) return { success: false, notRunning: true, error: 'No matching closeable application is running.' };
    const results = await Promise.all(matches.map(p => new Promise(resolve => {
      execFile('taskkill.exe', ['/PID', String(p.Id)], { windowsHide: true, timeout: 10000 }, err => resolve(!err));
    })));
    return results.every(Boolean) ? { success: true } : { success: false, error: 'The application did not close. Check for a save dialog.' };
  } catch (e) { return { success: false, error: e.message }; }
}
module.exports = { resolveApplication, launchApplication, closeApplication };
