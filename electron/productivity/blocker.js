const { execFile } = require('node:child_process');
const { Notification } = require('electron');
const { DEFAULT_CATEGORIES, getLocalDateKey } = require('./tracker');

const PROTECTED_PROCESSES = [
  'electron', 'distrack', 'baymax', 'mochi', 'explorer', 'taskmgr', 'dwm', 'svchost',
  'powershell', 'pwsh', 'cmd', 'conhost', 'antigravity', 'systemsettings',
  'applicationframehost', 'shellexperiencehost', 'startmenuexperiencehost',
  'runtimebroker', 'ctfmon', 'searchhost', 'system', 'idle', 'smss', 'csrss',
  'wininit', 'services', 'lsass', 'winlogon', 'spoolsv', 'fontdrvhost', 'sihost',
  'registry', 'memory compression', 'audiodg', 'wlanext', 'textinputhost'
];

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
  }

  start(config = {}) {
    this.isActive = true;
    this.mode = config.mode || 'Strict Lock';
    this.recentlyBlocked.clear();
    this.pendingCloses.clear();
    console.log(`[Blocker] Started in ${this.mode} mode`);

    this.enforce();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.enforce(), 1200);
  }

  stop() {
    this.isActive = false;
    this.recentlyBlocked.clear();
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
    const key = procName.toLowerCase();
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
      // In Strict Lock mode, any app not categorized as 'productive' is blocked!
      for (const app of allKnown) {
        const cat = this.getProcessCategory(app);
        if (cat !== 'productive') {
          blocked.add(app);
        }
      }
    } else if (this.mode === 'Light Focus') {
      // In Light Focus mode, block only wasteful apps
      for (const app of allKnown) {
        const cat = this.getProcessCategory(app);
        if (cat === 'wasteful') {
          blocked.add(app);
        }
      }
    } else {
      // Deep Silence (default): custom blocklist + all wasteful apps
      for (const app of blocklist) {
        blocked.add(app.toLowerCase());
      }
      for (const app of allKnown) {
        const cat = this.getProcessCategory(app);
        if (cat === 'wasteful') {
          blocked.add(app);
        }
      }
    }

    return Array.from(blocked).filter(b => !PROTECTED_PROCESSES.includes(b));
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

        if (PROTECTED_PROCESSES.includes(procName)) continue;

        if (this.mode === 'Strict Lock') {
          // In Strict Lock, if it's explicitly blocked OR if it's running and not marked productive
          const cat = this.getProcessCategory(procName);
          if (cat !== 'productive' && (blockedList.includes(procName) || DEFAULT_CATEGORIES[procName] || cat !== null)) {
            runningBlockedProcs.add(procName);
          } else if (blockedList.includes(procName)) {
            runningBlockedProcs.add(procName);
          }
        } else {
          if (blockedList.includes(procName)) {
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
    if (PROTECTED_PROCESSES.includes(procName.toLowerCase())) return;
    if (this.pendingCloses.has(procName)) {
      return;
    }

    console.log(`[Blocker] Detected distraction app during focus session (${this.mode}): ${procName}`);

    try {
      this.onDistractionAlert(procName);
    } catch (alertErr) {
      console.warn('[Blocker] Distraction alert handler error:', alertErr);
    }

    // In Strict Lock mode: terminate immediately with /F!
    if (this.mode === 'Strict Lock') {
      this.forceKillProcess(procName);
      return;
    }

    // Deep Silence / Light Focus: 4-second warning before force kill
    execFile('taskkill.exe', ['/IM', `${procName}.exe`], { windowsHide: true }, () => {
      const settings = this.store.get('settings', { notifications: true });

      if (settings.notifications && Notification.isSupported()) {
        try {
          new Notification({
            title: 'Baymax — Focus Session Active',
            body: `"${procName}" will be closed in 4 seconds. Focus on your work!`,
          }).show();
        } catch (e) {}
      }

      try {
        this.broadcaster('app-close-warning', procName);
      } catch (e) { /* ignore */ }
    });

    const timer = setTimeout(() => {
      this.forceKillProcess(procName);
    }, 4000);

    this.pendingCloses.set(procName, { warnedAt: Date.now(), timer });
  }

  forceKillProcess(procName) {
    if (!this.isActive || PROTECTED_PROCESSES.includes(procName.toLowerCase())) return;

    console.log(`[Blocker] Force killing: ${procName}`);

    execFile('taskkill.exe', ['/IM', `${procName}.exe`, '/F'], { windowsHide: true }, (err, stdout, stderr) => {
      this.pendingCloses.delete(procName);

      if (err) {
        const errorMsg = (stderr || '').toLowerCase() + (err.message || '').toLowerCase();
        if (errorMsg.includes('access is denied') || errorMsg.includes('access denied')) {
          console.error(`[Blocker] Privilege escalation required to kill ${procName}`);

          const settings = this.store.get('settings', { notifications: true });
          if (settings.notifications && Notification.isSupported()) {
            try {
              new Notification({
                title: 'Baymax — Permission Required',
                body: `Baymax requires Administrator privileges to close "${procName}".`,
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
      setTimeout(() => this.recentlyBlocked.delete(procName), 15000);

      console.log(`[Blocker] Force killed: ${procName}`);

      const settings = this.store.get('settings', { notifications: true });

      if (settings.notifications && Notification.isSupported()) {
        try {
          new Notification({
            title: 'Baymax — Distraction Closed',
            body: `"${procName}" was closed to maintain your focus.`,
          }).show();
        } catch (e) {}
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
};
