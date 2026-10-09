const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { StringDecoder } = require('node:string_decoder');
const { canonicalId, catalogEntry, matchCatalog, isJunk, normalize } = require('./catalog');

exports.createTracker = ({ app, powerMonitor, getLocalDateKey, DEFAULT_CATEGORIES, ICON_MAP, SYSTEM_IGNORED_PROCS, WINDOW_SCANNER_SCRIPT }) => class AppTracker {
  constructor(store, broadcaster, isFocusActiveFn, onFocusDistractionFn, clocks = {}) {
    Object.assign(this, { store, broadcaster: broadcaster || (() => {}), isFocusActiveFn: isFocusActiveFn || (() => false), onFocusDistractionFn: onFocusDistractionFn || (() => {}) });
    this.now = clocks.now || Date.now;
    this.monotonic = clocks.monotonic || (() => performance.now());
    this.currentForeground = null; this.previous = null; this.psProcess = null;
    this.isTracking = false; this.paused = false; this.lastSampleAt = 0; this.parseErrors = 0; this.restartDelay = 1000;
    this.listeners = [];
    this.cleanStore();
  }
  cleanStore() {
    const known = this.store.get('knownApps', {});
    // Metadata migration deliberately preserves historical usage and categories.
    for (const [key, value] of Object.entries(known)) {
      value.id = key; value.processName ||= normalize(value.name || key);
      if (!key.startsWith('app-')) value.processName = normalize(key);
      value.aliases ||= [normalize(key), value.processName, value.processName.replace(/\.root$/, '')];
      value.source ||= 'legacy';
      if (isJunk(value)) value.hidden = true;
      if (value.hidden == null && ['wmplayer', 'windowsterminal'].includes(value.processName)) value.hidden = true;
      delete value.totalSeconds; delete value.timeSpentMinutes;
    }
    this.store.set('knownApps', known);
    this.store.set('catalogVersion', 2);
  }
  register(info) {
    const known = this.store.get('knownApps', {});
    let previous = known[canonicalId(info)] || matchCatalog(known, info.processName, info.path, info.appId);
    if (info.source === 'shortcut' && previous?.arguments !== info.arguments) previous = known[canonicalId(info)];
    // Promote legacy metadata to path/AppID identity; aliases keep old history visible.
    if (previous && info.source === 'observed') {
      info = { ...info, name: previous.name, appId: previous.appId, arguments: previous.arguments, source: previous.source };
    }
    const entry = catalogEntry(info, previous || {});
    if (previous?.source === 'manual') entry.hidden = previous.hidden;
    if (previous && previous.id !== entry.id) { entry.aliases.push(previous.id); delete known[previous.id]; }
    known[entry.id] = entry;
    this.store.set('knownApps', known);
    if (!entry.icon?.startsWith('data:') && entry.path && app.getFileIcon) {
      app.getFileIcon(entry.path, { size: 'normal' }).then(icon => {
        const latest = this.store.get('knownApps', {});
        if (latest[entry.id]) { latest[entry.id].icon = icon.toDataURL(); this.store.set('knownApps', latest); }
      }).catch(() => {});
    }
    return entry;
  }
  start() {
    if (this.isTracking) return;
    this.isTracking = true;
    const pause = () => { this.paused = true; this.previous = null; this.currentForeground = null; };
    const resume = () => { this.paused = false; this.previous = null; };
    for (const [event, fn] of [['suspend', pause], ['lock-screen', pause], ['resume', resume], ['unlock-screen', resume]]) {
      powerMonitor?.on(event, fn); this.listeners.push([event, fn]);
    }
    this.initialScan(); this.spawnTrackerProcess();
    this.heartbeatTimer = setInterval(() => {
      if (this.now() - this.lastSampleAt > 12000 && !this.restartTimer) {
        this.currentForeground = null; this.previous = null;
        this.scheduleRestart();
      }
      this.broadcaster('tracking-health', this.getHealth());
    }, 4000);
  }
  scheduleRestart() {
    if (!this.isTracking || this.restartTimer) return;
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.spawnTrackerProcess(); }, this.restartDelay);
    this.restartDelay = Math.min(this.restartDelay * 2, 30000);
  }
  spawnTrackerProcess() {
    if (!this.isTracking) return;
    const old = this.psProcess; this.psProcess = null; old?.kill();
    this.previous = null; this.lastSampleAt = this.now();
    const child = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'foreground.ps1')], { windowsHide: true });
    this.psProcess = child;
    const decoder = new StringDecoder('utf8'); let buffer = '';
    child.stdout.on('data', data => {
      if (this.psProcess !== child) return;
      buffer += decoder.write(data);
      if (buffer.length > 1024 * 1024) { buffer = ''; this.parseErrors++; this.scheduleRestart(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { const info = JSON.parse(line); this.recordActivity(info.n, info.t, info.path, info.p, info.appId); }
        catch { this.parseErrors++; }
      }
    });
    child.stderr.on('data', () => { this.lastError = 'Foreground helper reported an error'; });
    child.on('error', err => { this.lastError = err.message; this.scheduleRestart(); });
    child.on('exit', () => { if (this.psProcess === child) { this.psProcess = null; this.previous = null; this.scheduleRestart(); } });
  }
  recordActivity(processName, windowTitle, exePath, pid, appId) {
    const now = this.now(), mono = this.monotonic();
    this.lastSampleAt = now; this.restartDelay = 1000;
    const idle = powerMonitor?.getSystemIdleTime?.() >= (this.store.get('settings.idleThresholdSeconds', 120));
    const old = this.previous;
    // Charge the interval to its previous foreground; never round samples.
    if (old && !this.paused && !idle) {
      const elapsed = mono - old.mono;
      if (elapsed > 0 && elapsed <= 6000 && Math.abs((now - old.wall) - elapsed) < 2000) this.accrue(old, elapsed);
    }
    this.previous = null; this.currentForeground = null;
    const proc = normalize(processName);
    const ownPath = exePath && exePath.toLowerCase() === process.execPath.toLowerCase();
    if (!proc || this.paused || idle || pid === process.pid || ownPath || SYSTEM_IGNORED_PROCS.includes(proc)) { this.publish(); return; }
    const entry = this.register({ processName: proc, name: processName, path: exePath || '', appId, source: 'observed' });
    const category = this.getCategory(entry.id);
    this.currentForeground = { id: entry.id, processName, windowTitle: windowTitle || processName, exePath, category, lastSeen: now };
    this.previous = { ...this.currentForeground, wall: now, mono };
    if (this.isFocusActiveFn() && (category === 'wasteful' || this.store.get('blocklist', []).some(k => k === entry.id || k === proc)) && now - (this.lastDistractionWarnTime || 0) > 60000) {
      this.lastDistractionWarnTime = now; this.onFocusDistractionFn(processName);
    }
    this.publish();
  }
  accrue(previous, elapsed) {
    let start = previous.wall, remaining = elapsed;
    while (remaining > 0) {
      const d = new Date(start), next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const amount = Math.min(remaining, next - start), key = getLocalDateKey(d);
      const usage = this.store.get(`usageData.${key}`, {});
      const item = usage[previous.id] || { processName: previous.processName, totalSeconds: 0 };
      item.totalSeconds = (Number(item.totalSeconds) || 0) + amount / 1000;
      item.windowTitle = previous.windowTitle; item.lastActive = start + amount;
      usage[previous.id] = item; this.store.set(`usageData.${key}`, usage);
      remaining -= amount; start += amount;
    }
  }
  publish() { this.broadcaster('tracking-update', { timeframe: 'daily', dateKey: getLocalDateKey(new Date(this.now())), apps: this.getTodayApps(), health: this.getHealth() }); }
  getHealth() { return { active: this.isTracking && this.now() - this.lastSampleAt < 12000, paused: this.paused, idle: powerMonitor?.getSystemIdleTime?.() >= this.store.get('settings.idleThresholdSeconds',120), lastSampleAt: this.lastSampleAt, parseErrors: this.parseErrors, error: this.store.lastError || this.lastError || null }; }
  getCurrentForeground() { return this.now() - (this.currentForeground?.lastSeen || 0) <= 6000 ? this.currentForeground : null; }
  getCategory(key) {
    const cats = this.store.get('appCategories', {}), entry = this.store.get('knownApps', {})[key];
    for (const alias of [key, ...(entry?.aliases || [])]) if (cats[alias]) return cats[alias];
    return DEFAULT_CATEGORIES[entry?.processName || key] || 'neutral';
  }
  formatApps(data) {
    const known = this.store.get('knownApps', {}), merged = {};
    for (const [key, value] of Object.entries(data)) {
      const meta = known[key] || matchCatalog(known, key);
      const id = meta?.id || key;
      const row = merged[id] ||= { ...meta, id, name: meta?.name || value.processName || key, windowTitle: value.windowTitle, totalSeconds: 0, category: this.getCategory(id), type: 'application', icon: meta?.icon || value.icon || ICON_MAP[value.processName] || 'apps' };
      row.totalSeconds += Number(value.totalSeconds) || 0;
      row.timeSpentMinutes = row.totalSeconds / 60;
    }
    return Object.values(merged).filter(a => a.totalSeconds > 0).sort((a,b) => b.totalSeconds - a.totalSeconds);
  }
  getTodayApps() { return this.formatApps(this.store.get(`usageData.${getLocalDateKey(new Date(this.now()))}`, {})); }
  weekDates() {
    const d = new Date(this.now()); d.setHours(0,0,0,0); d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + i));
  }
  getWeekApps() {
    const merged = {};
    for (const d of this.weekDates()) for (const [key, row] of Object.entries(this.store.get(`usageData.${getLocalDateKey(d)}`, {}))) {
      merged[key] ||= { ...row, totalSeconds: 0 }; merged[key].totalSeconds += Number(row.totalSeconds) || 0;
    }
    return this.formatApps(merged);
  }
  getDailyTotals() { return this.weekDates().map((d,i) => ({ day: ['M','T','W','T','F','S','S'][i], label: ['M','T','W','T','F','S','S'][i], date: getLocalDateKey(d), value: Object.values(this.store.get(`usageData.${getLocalDateKey(d)}`, {})).reduce((sum,a) => sum + (a.totalSeconds || 0), 0) / 3600 })); }
  getKnownApps(includeHidden = false) {
    const usage = Object.fromEntries(this.getTodayApps().map(a => [a.id,a]));
    return Object.values(this.store.get('knownApps', {})).filter(a => includeHidden || !a.hidden).map(a => ({ ...a, category: this.getCategory(a.id), totalSeconds: usage[a.id]?.totalSeconds || 0, timeSpentMinutes: (usage[a.id]?.totalSeconds || 0) / 60 })).sort((a,b) => b.totalSeconds - a.totalSeconds || a.name.localeCompare(b.name));
  }
  updateCategory(key, category) {
    if (!['productive','neutral','wasteful'].includes(category)) throw new Error('Invalid category');
    const cats = this.store.get('appCategories', {}); cats[key] = category; this.store.set('appCategories', cats); this.store.saveSync?.();
  }
  saveCustomApp(data) {
    if (!data?.name?.trim() || (!data.path && !data.processName?.trim())) throw new Error('Select an executable or enter its exact process name.');
    const entry = this.register({ ...data, source: 'manual', hidden: false });
    this.updateCategory(entry.id, data.category || 'neutral'); return { ...entry, totalSeconds: 0, timeSpentMinutes: 0 };
  }
  setHidden(id, hidden) { const known = this.store.get('knownApps', {}); if (known[id]) { known[id].hidden = !!hidden; this.store.set('knownApps', known); this.store.saveSync?.(); } }
  initialScan() {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOW_SCANNER_SCRIPT], { windowsHide: true, timeout: 15000 }, (err, out) => {
      if (!err) try { let rows = JSON.parse(out || '[]'); for (const p of (Array.isArray(rows) ? rows : [rows])) if (p && p.Id !== process.pid && p.Path?.toLowerCase() !== process.execPath.toLowerCase() && !SYSTEM_IGNORED_PROCS.includes(normalize(p.ProcessName))) this.register({ name:p.ProcessName, processName:p.ProcessName, path:p.Path, source:'observed' }); } catch {}
      this.hasInitialScan = true;
    });
  }
  async scanAllInstalledApps() {
    const rows = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'discover_apps.ps1')], { windowsHide: true, timeout: 60000, maxBuffer: 16*1024*1024, encoding: 'utf8' }, (err,out) => {
      if (err) return reject(err); try { const rows = JSON.parse(out.replace(/^\uFEFF/, '') || '[]'); resolve(Array.isArray(rows) ? rows : [rows]); } catch(e) { reject(e); }
    }));
    for (const item of rows) if (item && (item.path || item.appId)) this.register(item);
    this.cleanStore(); return this.getKnownApps();
  }
  stop() {
    this.isTracking = false; this.previous = null; this.currentForeground = null;
    clearInterval(this.heartbeatTimer); clearTimeout(this.restartTimer);
    const child = this.psProcess; this.psProcess = null; child?.kill();
    for (const [e, fn] of this.listeners) powerMonitor?.removeListener(e, fn);
    this.listeners = []; this.store.saveSync?.();
  }
};
