// Read-only audit probes. Real child processes, Electron APIs, disk writes and
// timers in the inspected modules are replaced with in-memory fakes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const root = process.argv[2] || path.resolve(__dirname, '..');
const results = [];
let now = new Date(2026, 9, 8, 12).getTime();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
class MemoryStore {
  constructor(data = {}) { this.data = structuredClone(data); }
  get(key, fallback) {
    const value = key.split('.').reduce((o, k) => o?.[k], this.data);
    return value === undefined ? fallback : value;
  }
  set(key, value) {
    const parts = key.split('.');
    let dest = this.data;
    for (const k of parts.slice(0, -1)) dest = dest[k] ||= {};
    dest[parts.at(-1)] = value;
  }
}
let spawned;
const fakeChildren = {
  execFile(_exe, _args, _options, callback) { callback(null, '[]', ''); },
  spawn() {
    spawned = new EventEmitter();
    spawned.stdout = new EventEmitter();
    spawned.stderr = new EventEmitter();
    spawned.kill = () => { spawned.killed = true; };
    return spawned;
  }
};
const electron = {
  app: { getFileIcon: async () => ({ toDataURL: () => 'data:image/png;base64,fake' }) },
  Notification: { isSupported: () => false }
};
function load(file, extra = {}) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, __dirname: path.dirname(filename),
    Date: Clock, console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'node:child_process') return fakeChildren;
      if (name in extra) return extra[name];
      if (name === 'node:path') return path;
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return module.exports;
}
const trackerModule = load('electron/productivity/tracker.js');
const { AppTracker, getLocalDateKey } = trackerModule;
const { AppBlocker } = load('electron/productivity/blocker.js', { './tracker': trackerModule });
async function probe(name, fn) {
  try { const detail = await fn(); results.push({ name, reproduced: true, detail }); }
  catch (e) { results.push({ name, reproduced: false, error: e.message }); }
}

(async () => {
  await probe('1500 ms samples overcount by 33 percent', async () => {
    const store = new MemoryStore();
    const tracker = new AppTracker(store);
    tracker.lastPollTime = now;
    for (let i = 0; i < 40; i++) { now += 1500; await tracker.recordActivity('chrome', '', ''); }
    const recorded = tracker.getTodayApps()[0].totalSeconds;
    assert.equal(recorded, 80);
    return { actualElapsedSeconds: 60, recordedSeconds: recorded };
  });
  await probe('Antigravity and terminal processes are silently ignored', async () => {
    const tracker = new AppTracker(new MemoryStore());
    for (const name of ['antigravity', 'powershell', 'cmd', 'ApplicationFrameHost', 'electron']) {
      now += 1500; await tracker.recordActivity(name, 'User application', '');
    }
    assert.equal(tracker.getTodayApps().length, 0);
    return { appsTested: 5, appsRecorded: 0 };
  });
  await probe('Zero-result rescan retains obsolete library entries', async () => {
    const knownApps = Object.fromEntries(['msiexec', 'wmplayer', 'scale', 'scalehost'].map(id =>
      [id, { id, name: id, timeSpentMinutes: 0 }]));
    const tracker = new AppTracker(new MemoryStore({ knownApps }));
    const after = await tracker.scanAllInstalledApps();
    assert.equal(after.length, 4);
    return { newlyFound: 0, retained: after.map(a => a.id) };
  });
  await probe('App library retains previous-day usage', async () => {
    const tracker = new AppTracker(new MemoryStore({ knownApps: {
      chrome: { id: 'chrome', name: 'Chrome', totalSeconds: 600, timeSpentMinutes: 10 }
    }, usageData: {} }));
    assert.equal(tracker.getTodayApps().length, 0);
    assert.equal(tracker.getKnownApps()[0].timeSpentMinutes, 10);
    return { todayApps: 0, libraryMinutes: 10 };
  });
  await probe('Split stdout chunks drop valid activity samples', async () => {
    const tracker = new AppTracker(new MemoryStore());
    const received = [];
    tracker.isTracking = true;
    tracker.recordActivity = (...args) => received.push(args);
    tracker.spawnTrackerProcess();
    spawned.stdout.emit('data', Buffer.from('{"n":"chr'));
    spawned.stdout.emit('data', Buffer.from('ome","t":"","path":""}\n'));
    assert.equal(received.length, 0);
    spawned.stdout.emit('data', Buffer.from('{"n":"chrome","t":"","path":""}\n'));
    assert.equal(received.length, 1);
    return { fragmentedSampleReceived: false, completeSampleReceived: true };
  });
  await probe('Focus blocker remains active after its deadline', async () => {
    const blocker = new AppBlocker(new MemoryStore());
    blocker.enforce = () => {};
    blocker.start({ durationMinutes: 1 });
    now += 61000;
    const status = blocker.getStatus();
    assert.equal(status.remainingSeconds, 0);
    assert.equal(status.active, true);
    return { remainingSeconds: status.remainingSeconds, active: status.active };
  });
  await probe('Ignored foreground leaves previous current-app state', async () => {
    const tracker = new AppTracker(new MemoryStore());
    await tracker.recordActivity('chrome', '', '');
    now += 1500;
    await tracker.recordActivity('antigravity', '', '');
    assert.equal(tracker.getCurrentForeground().processName, 'chrome');
    return { realLatestSample: 'antigravity', reportedForeground: 'chrome' };
  });
  await probe('Elapsed interval is credited to newly sampled app', async () => {
    const tracker = new AppTracker(new MemoryStore());
    await tracker.recordActivity('code', '', '');
    now += 3000;
    await tracker.recordActivity('chrome', '', '');
    const usage = tracker.store.get(`usageData.${getLocalDateKey()}`);
    assert.equal(usage.chrome.totalSeconds, 3);
    return { previousApp: 'code', intervalSeconds: 3, creditedApp: 'chrome' };
  });
  await probe('Insights loses sub-30-second activity through per-app rounding', async () => {
    const apps = [{ totalSeconds: 20 }, { totalSeconds: 20 }, { totalSeconds: 20 }];
    const overviewMinutes = Math.round(apps.reduce((s, a) => s + a.totalSeconds, 0) / 60);
    const insightMinutes = apps.reduce((s, a) => s + Math.round(a.totalSeconds / 60), 0);
    assert.equal(overviewMinutes, 1); assert.equal(insightMinutes, 0);
    return { overviewMinutes, insightMinutes };
  });
  await probe('Task role tags are reversed on the partner PC', async () => {
    const mainSource = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
    const start = mainSource.indexOf('async function executeActionTags(');
    const end = mainSource.indexOf('async function callGeminiAI(', start);
    assert.ok(start >= 0 && end > start);
    const context = {
      activeSettings: { userRole: 'her', userName: 'A', partnerName: 'B' },
      activeSchedule: [], overlayWin: null, Date: Clock,
      saveSchedule() {}, syncScheduleToPartner() {}, console,
    };
    vm.createContext(context);
    vm.runInContext(mainSource.slice(start, end), context);
    await context.executeActionTags('[ADD_TASK: {"title":"Example","for":"her"}]');
    assert.equal(context.activeSchedule[0].assignee, 'me');
    return { requestedRole: 'her', assignedRole: context.activeSchedule[0].assignee };
  });
  console.log(JSON.stringify({ sourceRoot: root, results }, null, 2));
  if (results.some(r => !r.reproduced)) process.exitCode = 1;
})();
