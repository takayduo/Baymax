const { execFile } = require('node:child_process');
const { Notification } = require('electron');

const PROTECTED_PROCESSES = [
  'electron', 'distrack', 'baymax', 'mochi', 'explorer', 'taskmgr', 'dwm', 'svchost',
  'powershell', 'pwsh', 'cmd', 'conhost', 'antigravity', 'systemsettings',
  'applicationframehost', 'shellexperiencehost', 'startmenuexperiencehost',
  'runtimebroker', 'ctfmon', 'searchhost'
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
    this.mode = 'Deep Silence';
    this.recentlyBlocked = new Set();
    this.pendingCloses = new Map();
  }

  start(config = {}) {
    this.isActive = true;
    this.mode = config.mode || 'Deep Silence';
    this.recentlyBlocked.clear();
    this.pendingCloses.clear();
    console.log(`[Blocker] Started in ${this.mode} mode`);

    this.enforce();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.enforce(), 4000);
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

  getBlockedProcessNames() {
    const categories = this.store.get('appCategories', {});
    const blocklist = this.store.get('blocklist', []);
    let blocked = [];

    if (this.mode === 'Strict Lock') {
      blocked = Object.entries(categories)
        .filter(([_, cat]) => cat !== 'productive')
        .map(([name]) => name.toLowerCase());
    } else if (this.mode === 'Light Focus') {
      blocked = Object.entries(categories)
        .filter(([_, cat]) => cat === 'wasteful')
        .map(([name]) => name.toLowerCase());
    } else {
      // Deep Silence — custom blocklist + all wasteful apps
      const wasteful = Object.entries(categories)
        .filter(([_, cat]) => cat === 'wasteful')
        .map(([name]) => name.toLowerCase());
      const customBlocked = blocklist.map(b => b.toLowerCase());
      blocked = Array.from(new Set([...customBlocked, ...wasteful]));
    }

    return blocked.filter(b => !PROTECTED_PROCESSES.includes(b.toLowerCase()));
  }

  enforce() {
    if (!this.isActive) return;

    const blocked = this.getBlockedProcessNames();
    if (blocked.length === 0) {
      this.clearPendingCloses();
      return;
    }

    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return;

      const lines = stdout.split('\n');
      const runningBlockedProcs = new Set();

      for (const line of lines) {
        const match = line.match(/"([^"]+\.exe)"/i);
        if (!match) continue;
        const procName = match[1].replace(/\.exe$/i, '').toLowerCase();

        if (blocked.includes(procName)) {
          runningBlockedProcs.add(procName);
        }
      }

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

    console.log(`[Blocker] Detected distraction app during focus session: ${procName}. Warning user.`);

    try {
      this.onDistractionAlert(procName);
    } catch (alertErr) {
      console.warn('[Blocker] Distraction alert handler error:', alertErr);
    }

    execFile('taskkill.exe', ['/IM', `${procName}.exe`], { windowsHide: true }, () => {
      const settings = this.store.get('settings', { notifications: true });

      if (settings.notifications && Notification.isSupported()) {
        try {
          new Notification({
            title: 'Baymax — Focus Session Active',
            body: `"${procName}" will be closed in 10 seconds. Focus on your work!`,
          }).show();
        } catch (e) {}
      }

      try {
        this.broadcaster('app-close-warning', procName);
      } catch (e) { /* ignore */ }
    });

    const timer = setTimeout(() => {
      this.forceKillProcess(procName);
    }, 10000);

    this.pendingCloses.set(procName, { warnedAt: Date.now(), timer });
  }

  forceKillProcess(procName) {
    if (!this.isActive || PROTECTED_PROCESSES.includes(procName.toLowerCase())) return;

    console.log(`[Blocker] Timer expired. Force closing: ${procName}`);

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
                body: `Baymax requires Administrator privileges to block "${procName}".`,
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
