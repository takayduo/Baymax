const { execFile } = require('node:child_process');
const { Notification } = require('electron');
const { DEFAULT_CATEGORIES, getLocalDateKey } = require('./tracker');

const PROTECTED_PROCESSES = [
  'electron', 'distrack', 'baymax', 'mochi', 'explorer', 'taskmgr', 'dwm', 'svchost',
  'powershell', 'pwsh', 'cmd', 'conhost', 'antigravity', 'systemsettings',
  'applicationframehost', 'shellexperiencehost', 'startmenuexperiencehost',
  'runtimebroker', 'ctfmon', 'searchhost', 'searchapp', 'system', 'idle', 'smss', 'csrss',
  'wininit', 'services', 'lsass', 'winlogon', 'spoolsv', 'fontdrvhost', 'sihost',
  'registry', 'memory compression', 'audiodg', 'wlanext', 'textinputhost', 'lockapp',
  'widgets', 'msedgewebview2', 'apcent', 'node', 'git', 'python', 'code',
  'windowsterminal', 'terminal', 'devenv', 'wsl', 'wslhost', 'awcc', 'appcenter',
  'nvcontainer', 'nvspcaps', 'nvspcaps64', 'nvidia share', 'nvidia web helper',
  'powertoys', 'powertoys.quickaccess', 'powertoys.awake', 'powertoys.fancyzones'
];

function isProtectedProcess(name) {
  if (!name) return true;
  const p = name.toLowerCase().replace(/\.exe$/i, '').trim();
  if (PROTECTED_PROCESSES.includes(p)) return true;
  // Guard against any system / driver / hardware / background helper processes
  if (/^(svchost|csrss|lsass|smss|services|dwm|explorer|conhost|winlogon|fontdrvhost|sihost|runtimebroker|ctfmon|searchhost|searchapp|systemsettings|shellexperiencehost|startmenuexperiencehost|applicationframehost|textinputhost|audiodg|wlanext|lockapp|widgets|msedgewebview2|apcent|gigabyte|nvidia|nvcontainer|nvspcaps|amd|amdrsserv|radeon|intel|realtek|system|idle|registry)$/i.test(p)) {
    return true;
  }
  // Ignore background services and utilities
  if (p.includes('host') || p.includes('broker') || p.includes('service') || p.includes('helper') || p.includes('daemon') || p.includes('driver') || p.includes('webview') || p.includes('updater') || p.includes('setup')) {
    return true;
  }
  return false;
}

class AppBlocker {
  /**
   * @param {any} store
   * @param {(channel: string, ...args: any[]) => void} broadcaster
   * @param {(procName: string) => void} [onDistractionAlert]
   */
  constructor(store, broadcaster, onDistractionAlert) {
    this.store = store;
    this.broadcaster = broadcaster || (() => {});
    this.onDistractionAlert = onDistractionAlert || (() => {});
    this.isActive = false;
    this.pollTimer = null;
    this.mode = 'Strict Lock';
    this.recentlyBlocked = new Set();
    this.pendingCloses = new Map();
    this.failedKills = new Set();
    this.lastProcessAlertTimes = new Map();
    this.lastDistractionAlertTime = 0;
  }

  start(config = {}) {
    this.isActive = true;
    this.mode = config.mode || 'Strict Lock';
    this.recentlyBlocked.clear();
    this.pendingCloses.clear();
    this.failedKills.clear();
    this.lastProcessAlertTimes.clear();
    this.lastDistractionAlertTime = 0;
    console.log(`[Blocker] Started in ${this.mode} mode`);

    this.enforce();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.enforce(), 1500);
  }

  stop() {
    this.isActive = false;
    this.recentlyBlocked.clear();
    this.failedKills.clear();
    this.clearPendingCloses();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[Blocker] Stopped');
  }

  clearPendingCloses() {
    for (const [procName, entry] of this.pendingCloses.entries()) {
      if (entry.timer) clearTimeout(entry.timer);
      try {
        this.broadcaster('app-close-warning-cancelled', procName);
      } catch (e) { /* ignore */ }
    }
    this.pendingCloses.clear();
  }

  getProcessCategory(procName) {
    const key = procName.toLowerCase().replace(/\.exe$/i, '').trim();
    const userCats = this.store.get('appCategories', {});
    if (userCats[key]) return userCats[key];

    try {
      const dateKey = getLocalDateKey();
      const usage = this.store.get(`usageData.${dateKey}`, {});
      if (usage[key] && usage[key].category) return usage[key].category;
    } catch (e) {}

    return DEFAULT_CATEGORIES[key] || null;
  }

  getBlockedProcessNames() {
    const categories = this.store.get('appCategories', {});
    const blocklist = this.store.get('blocklist', []);
    let usage = {};
    try {
      const dateKey = getLocalDateKey();
      usage = this.store.get(`usageData.${dateKey}`, {});
    } catch (e) {}

    const allKnown = new Set([
      ...Object.keys(categories),
      ...Object.keys(usage),
      ...Object.keys(DEFAULT_CATEGORIES),
      ...blocklist.map(b => b.toLowerCase())
    ]);

    const blocked = new Set();

    if (this.mode === 'Strict Lock') {
      // In Strict Lock mode: block custom blocklist + all wasteful apps + explicitly categorized non-productive
      for (const app of allKnown) {
        if (isProtectedProcess(app)) continue;
        const cat = this.getProcessCategory(app);
        if (cat === 'wasteful' || blocklist.includes(app.toLowerCase())) {
          blocked.add(app);
        } else if (cat !== 'productive' && categories[app]) {
          blocked.add(app);
        }
      }
    } else if (this.mode === 'Light Focus') {
      // In Light Focus mode, block only wasteful apps
      for (const app of allKnown) {
        if (isProtectedProcess(app)) continue;
        const cat = this.getProcessCategory(app);
        if (cat === 'wasteful') {
          blocked.add(app);
        }
      }
    } else {
      // Deep Silence (default): custom blocklist + all wasteful apps
      for (const app of blocklist) {
        if (!isProtectedProcess(app)) blocked.add(app.toLowerCase());
      }
      for (const app of allKnown) {
        if (isProtectedProcess(app)) continue;
        const cat = this.getProcessCategory(app);
        if (cat === 'wasteful') {
          blocked.add(app);
        }
      }
    }

    return Array.from(blocked).filter(b => !isProtectedProcess(b));
  }

  enforce() {
    if (!this.isActive) return;

    const blockedList = this.getBlockedProcessNames();

    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return;

      const lines = stdout.split('\n');
      const runningBlockedProcs = new Set();

      for (const line of lines) {
        const match = line.match(/"([^"]+\.exe)"/i);
        if (!match) continue;
        const procName = match[1].replace(/\.exe$/i, '').toLowerCase();

        if (isProtectedProcess(procName)) continue;
        if (this.failedKills.has(procName)) continue;

        if (blockedList.includes(procName)) {
          runningBlockedProcs.add(procName);
        } else if (this.mode === 'Strict Lock') {
          const cat = this.getProcessCategory(procName);
          if (cat === 'wasteful') {
            runningBlockedProcs.add(procName);
          }
        }
      }

      // Check if previously warned apps have been closed
      for (const procName of this.pendingCloses.keys()) {
        if (!runningBlockedProcs.has(procName)) {
          const entry = this.pendingCloses.get(procName);
          if (entry.timer) clearTimeout(entry.timer);
          this.pendingCloses.delete(procName);
          console.log(`[Blocker] ${procName} was closed, removed from pending list`);
          try {
            this.broadcaster('app-close-warning-cancelled', procName);
          } catch (e) { /* ignore */ }
        }
      }

      // Handle running blocked processes
      for (const procName of runningBlockedProcs) {
        this.handleBlockedProcess(procName);
      }
    });
  }

  handleBlockedProcess(procName) {
    if (isProtectedProcess(procName)) return;
    if (this.failedKills.has(procName)) return;
    if (this.pendingCloses.has(procName)) return;

    const now = Date.now();
    const lastAlert = this.lastProcessAlertTimes.get(procName) || 0;
    const canAlert = (now - lastAlert > 60000) && (now - this.lastDistractionAlertTime > 30000);

    if (canAlert) {
      this.lastProcessAlertTimes.set(procName, now);
      this.lastDistractionAlertTime = now;
      console.log(`[Blocker] Detected distraction app during focus session (${this.mode}): ${procName}`);

      try {
        this.onDistractionAlert(procName);
      } catch (alertErr) {
        console.warn('[Blocker] Distraction alert handler error:', alertErr);
      }
    }

    // In Strict Lock mode: terminate immediately with /F!
    if (this.mode === 'Strict Lock') {
      this.forceKillProcess(procName);
      return;
    }

    // Deep Silence / Light Focus: 4-second warning before force kill
    if (canAlert) {
      const settings = this.store.get('settings', { notifications: true });
      if (settings.notifications && Notification.isSupported()) {
        try {
          const friendly = procName.charAt(0).toUpperCase() + procName.slice(1);
          new Notification({
            title: 'Baymax — Focus Session Active',
            body: `"${friendly}" will be closed in 4 seconds. Focus on your work!`,
          }).show();
        } catch (e) {}
      }
    }

    try {
      this.broadcaster('app-close-warning', procName);
    } catch (e) { /* ignore */ }

    const timer = setTimeout(() => {
      this.forceKillProcess(procName);
    }, 4000);

    this.pendingCloses.set(procName, { warnedAt: now, timer });
  }

  forceKillProcess(procName) {
    if (!this.isActive || isProtectedProcess(procName)) return;
    if (this.failedKills.has(procName)) return;

    execFile('taskkill.exe', ['/IM', `${procName}.exe`, '/F'], { windowsHide: true }, (err, stdout, stderr) => {
      this.pendingCloses.delete(procName);

      if (err) {
        // Suppress repeated attempts on unkillable processes
        this.failedKills.add(procName);
        console.warn(`[Blocker] Could not kill ${procName}, marking unkillable:`, err.message);

        const errorMsg = (stderr || '').toLowerCase() + (err.message || '').toLowerCase();
        if (errorMsg.includes('access is denied') || errorMsg.includes('access denied')) {
          const settings = this.store.get('settings', { notifications: true });
          if (settings.notifications && Notification.isSupported()) {
            try {
              const friendly = procName.charAt(0).toUpperCase() + procName.slice(1);
              new Notification({
                title: 'Baymax — Permission Required',
                body: `Baymax requires Administrator privileges to close "${friendly}".`,
              }).show();
            } catch (e) {}
          }

          try {
            this.broadcaster('app-block-failed-privilege', procName);
          } catch (e) { /* ignore */ }
        }
        return;
      }

      if (this.recentlyBlocked.has(procName)) return;
      this.recentlyBlocked.add(procName);
      setTimeout(() => this.recentlyBlocked.delete(procName), 30000);

      console.log(`[Blocker] Force killed: ${procName}`);

      const now = Date.now();
      const lastClosedNotify = this.lastProcessAlertTimes.get(`${procName}_closed`) || 0;
      if (now - lastClosedNotify > 60000) {
        this.lastProcessAlertTimes.set(`${procName}_closed`, now);
        const settings = this.store.get('settings', { notifications: true });
        if (settings.notifications && Notification.isSupported()) {
          try {
            const friendly = procName.charAt(0).toUpperCase() + procName.slice(1);
            new Notification({
              title: 'Baymax — Distraction Closed',
              body: `"${friendly}" was closed to maintain your focus.`,
            }).show();
          } catch (e) {}
        }
      }

      try {
        this.broadcaster('app-blocked', procName);
      } catch (e) { /* ignore */ }
    });
  }
}

module.exports = {
  AppBlocker,
  PROTECTED_PROCESSES,
  isProtectedProcess,
};
