const { execFile, spawn } = require('node:child_process');
const path = require('node:path');
const { app } = require('electron');

function getLocalDateKey(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const SYSTEM_IGNORED_PROCS = [
  'electron', 'distrack', 'baymax', 'mochi', 'systemsettings', 'textinputhost', 'applicationframehost',
  'shellexperiencehost', 'awcc', 'explorer', 'searchapp', 'startmenuexperiencehost',
  'widgets', 'ctfmon', 'searchhost', 'taskmgr', 'dwm', 'svchost', 'lockapp',
  'runtimebroker', 'nvidia share', 'nvspcaps64', 'nvcontainer', 'nvspcaps',
  'nvidia web helper', 'powertoys.quickaccess', 'powertoys', 'powertoys.awake',
  'powertoys.fancyzones', 'antigravity', 'conhost', 'wslhost', 'wsl', 'cmd',
  'powershell', 'pwsh'
];

/** Default app category guesses based on common process names */
const DEFAULT_CATEGORIES = {
  code: 'productive', devenv: 'productive', idea64: 'productive', webstorm64: 'productive',
  pycharm64: 'productive', figma: 'productive', slack: 'productive', teams: 'productive',
  outlook: 'productive', winword: 'productive', excel: 'productive', powerpnt: 'productive',
  onenote: 'productive', notion: 'productive', obsidian: 'productive', terminal: 'productive',
  windowsterminal: 'productive', powershell: 'productive', cmd: 'productive',
  postman: 'productive', gitkraken: 'productive', sourcetree: 'productive',
  androidstudio64: 'productive', sublime_text: 'productive', atom: 'productive',
  premiere: 'productive', afterfx: 'productive', photoshop: 'productive', blender: 'productive',

  chrome: 'neutral', firefox: 'neutral', msedge: 'neutral', brave: 'neutral',
  opera: 'neutral', explorer: 'neutral', spotify: 'neutral', vlc: 'neutral',
  notepad: 'neutral', 'notepad++': 'neutral', calc: 'neutral',
  mspaint: 'neutral', photos: 'neutral', snippingtool: 'neutral',

  discord: 'wasteful', telegram: 'wasteful', whatsapp: 'wasteful',
  instagram: 'wasteful', twitter: 'wasteful', steam: 'wasteful',
  epicgameslauncher: 'wasteful', riotclientservices: 'wasteful',
  valorant: 'wasteful', leagueclient: 'wasteful', robloxplayerbeta: 'wasteful',
  tiktok: 'wasteful', netflix: 'wasteful', youtube: 'wasteful',
};

const ICON_MAP = {
  code: 'code', devenv: 'code', idea64: 'code', webstorm64: 'code', pycharm64: 'code',
  chrome: 'public', firefox: 'public', msedge: 'public', brave: 'public', opera: 'public',
  discord: 'chat', telegram: 'chat', whatsapp: 'chat', slack: 'forum', teams: 'group',
  spotify: 'music_note', vlc: 'play_circle', figma: 'draw', explorer: 'folder',
  outlook: 'mail', winword: 'description', excel: 'table', powerpnt: 'slideshow',
  notion: 'edit_note', obsidian: 'edit_note', notepad: 'edit_note',
  terminal: 'terminal', windowsterminal: 'terminal', powershell: 'terminal', cmd: 'terminal',
};

// PowerShell script to enumerate interactive desktop windows reliably
const WINDOW_SCANNER_SCRIPT = `
Add-Type @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;

public class WindowInfo {
    public int Id { get; set; }
    public string ProcessName { get; set; }
    public string MainWindowTitle { get; set; }
    public string Path { get; set; }
}

public class WindowScanner {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static List<WindowInfo> GetActiveWindows() {
        var list = new List<WindowInfo>();
        var seenPids = new HashSet<int>();

        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
        if (hDesk == IntPtr.Zero) return list;

        EnumDesktopWindows(hDesk, (hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                StringBuilder sb = new StringBuilder(512);
                int len = GetWindowText(hWnd, sb, sb.Capacity);
                if (len > 0) {
                    uint pid = 0;
                    GetWindowThreadProcessId(hWnd, out pid);
                    int pInt = (int)pid;
                    if (pInt > 0 && !seenPids.Contains(pInt)) {
                        try {
                            var proc = Process.GetProcessById(pInt);
                            string path = "";
                            try { path = proc.MainModule.FileName; } catch {}
                            list.Add(new WindowInfo {
                                Id = pInt,
                                ProcessName = proc.ProcessName,
                                MainWindowTitle = sb.ToString(),
                                Path = path
                            });
                            seenPids.Add(pInt);
                        } catch {}
                    }
                }
            }
            return true;
        }, IntPtr.Zero);

        CloseDesktop(hDesk);
        return list;
    }
}
'@

$windows = [WindowScanner]::GetActiveWindows()
$windows | ConvertTo-Json -Compress
`;

// PowerShell script to monitor foreground window in real-time
const PS_SCRIPT = `
Add-Type -MemberDefinition '
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
' -Name 'U' -Namespace 'W' -ErrorAction SilentlyContinue

while($true) {
  try {
    $h = [W.U]::GetForegroundWindow()
    if ($h -ne [IntPtr]::Zero) {
      $p = [uint32]0
      [W.U]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
      if ($p -gt 0) {
        $pr = Get-Process -Id $p -ErrorAction SilentlyContinue
        if ($pr) {
          $sb = New-Object System.Text.StringBuilder 512
          [W.U]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
          $t = $sb.ToString()
          $path = ""
          try { $path = $pr.Path } catch {}
          $json = @{ n = $pr.ProcessName; t = $t; p = [int]$p; path = $path } | ConvertTo-Json -Compress
          [Console]::WriteLine($json)
          [Console]::Out.Flush()
        }
      }
    }
  } catch {}
  Start-Sleep -Milliseconds 1500
}
`;

class AppTracker {
  /**
   * @param {any} store
   * @param {(channel: string, ...args: any[]) => void} broadcaster
   * @param {() => boolean} [isFocusActiveFn]
   * @param {(appKey: string) => void} [onFocusDistractionFn]
   */
  constructor(store, broadcaster, isFocusActiveFn, onFocusDistractionFn) {
    this.store = store;
    this.broadcaster = broadcaster || (() => {});
    this.isFocusActiveFn = isFocusActiveFn || (() => false);
    this.onFocusDistractionFn = onFocusDistractionFn || (() => {});
    this.psProcess = null;
    this.lastPollTime = null;
    this.isTracking = false;
    this.hasInitialScan = false;
    this.currentForeground = null;
    this.lastDistractionWarnTime = 0;
    this.heartbeatTimer = null;
    this.cleanStore();
  }

  cleanStore() {
    try {
      const JUNK_REGEX = /^(charmap|cleanmgr|mdsched|iscsicpl|odbcad32|regedit|recoverydrive|perfmon|msinfo32|msconfig|dfrgui|psr|quickassist|wfs|runupd.*|thermalconsole.*|git-bash|git-cmd|git-gui|javacpl|appvlp|setlang|msoev|robloxstudioinstaller|launcherpatcher|wondershare.*|livecaptions|magnify|narrator|osk|voiceaccess|antigravity.*)$/i;
      const known = this.store.get('knownApps', {});
      let knownChanged = false;
      for (const key of Object.keys(known)) {
        if (JUNK_REGEX.test(key) || SYSTEM_IGNORED_PROCS.includes(key)) {
          delete known[key];
          knownChanged = true;
        }
      }
      if (knownChanged) this.store.set('knownApps', known);

      const dateKey = getLocalDateKey();
      const usageData = this.store.get(`usageData.${dateKey}`, {});
      let usageChanged = false;
      for (const [key, d] of Object.entries(usageData)) {
        if (JUNK_REGEX.test(key) || SYSTEM_IGNORED_PROCS.includes(key) || ((d.totalSeconds || 0) === 0 && !DEFAULT_CATEGORIES[key])) {
          delete usageData[key];
          usageChanged = true;
        }
      }
      if (usageChanged) this.store.set(`usageData.${dateKey}`, usageData);
    } catch (e) {}
  }

  start() {
    if (this.isTracking) return;
    this.isTracking = true;
    this.cleanStore();
    this.lastPollTime = Date.now();
    console.log('[Tracker] Started with live auto-flush');

    this.initialScan();
    this.spawnTrackerProcess();

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.isTracking) return;
      const now = Date.now();
      if (this.lastPollTime && now - this.lastPollTime > 6000) {
        if (!this.psProcess || this.psProcess.killed) {
          console.warn('[Tracker] Heartbeat noticed dead process, respawning...');
          this.spawnTrackerProcess();
        }
      }
    }, 4000);
  }

  spawnTrackerProcess() {
    if (!this.isTracking) return;
    if (this.psProcess) {
      try { this.psProcess.kill(); } catch (e) {}
      this.psProcess = null;
    }

    const psScriptPath = path.join(__dirname, 'foreground_tracker.ps1');
    this.psProcess = spawn('powershell.exe', [
      '-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath
    ], { windowsHide: true });

    this.psProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const info = JSON.parse(trimmed);
          if (info && info.n) {
            this.recordActivity(info.n, info.t, info.path);
          }
        } catch (e) {}
      }
    });

    this.psProcess.on('error', (err) => {
      console.warn('[Tracker] PowerShell process error:', err.message);
    });

    this.psProcess.on('exit', (code, signal) => {
      if (this.isTracking) {
        console.warn(`[Tracker] PowerShell process exited (${code}), auto-restarting in 1s...`);
        setTimeout(() => this.spawnTrackerProcess(), 1000);
      }
    });
  }

  initialScan() {
    const dateKey = getLocalDateKey();
    const usageData = this.store.get(`usageData.${dateKey}`, {});
    const known = this.store.get('knownApps', {});
    const categories = this.store.get('appCategories', {});

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', WINDOW_SCANNER_SCRIPT],
      { windowsHide: true, timeout: 10000 },
      async (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          this.hasInitialScan = true;
          return;
        }
        try {
          let data = JSON.parse(stdout.trim());
          if (!Array.isArray(data)) data = [data];

          const now = Date.now();
          let changed = false;

          const promises = data.map(async (proc) => {
            if (!proc || !proc.ProcessName) return;
            const appKey = proc.ProcessName.toLowerCase();

            if (SYSTEM_IGNORED_PROCS.includes(appKey)) return;

            let iconDataUrl = null;
            if (proc.Path) {
              try {
                const img = await app.getFileIcon(proc.Path, { size: 'normal' });
                iconDataUrl = img.toDataURL();
              } catch (e) {}
            }

            if (!usageData[appKey] || !usageData[appKey].icon || !usageData[appKey].icon.startsWith('data:')) {
              if (!usageData[appKey]) {
                usageData[appKey] = {
                  processName: proc.ProcessName,
                  windowTitle: proc.MainWindowTitle || proc.ProcessName,
                  totalSeconds: 0,
                  category: categories[appKey] || this.getCategory(appKey),
                  lastActive: now,
                  icon: iconDataUrl,
                };
                changed = true;
              } else if (iconDataUrl) {
                usageData[appKey].icon = iconDataUrl;
                changed = true;
              }
            }

            const cat = categories[appKey] || usageData[appKey]?.category || this.getCategory(appKey);
            const totalSecs = usageData[appKey]?.totalSeconds || 0;
            if (!known[appKey] || !known[appKey].icon) {
              known[appKey] = {
                id: appKey,
                name: proc.ProcessName,
                windowTitle: proc.MainWindowTitle || proc.ProcessName,
                totalSeconds: totalSecs,
                timeSpentMinutes: Math.round(totalSecs / 60),
                category: cat,
                type: 'application',
                icon: iconDataUrl || known[appKey]?.icon || ICON_MAP[appKey] || 'apps',
              };
            }
          });

          await Promise.all(promises);

          if (changed) {
            this.store.set(`usageData.${dateKey}`, usageData);
          }
          this.store.set('knownApps', known);
          this.hasInitialScan = true;

          try {
            this.broadcaster('tracking-update', {
              dateKey,
              apps: this.formatApps(usageData),
            });
          } catch (e) {}

          console.log(`[Tracker] Initial scan: found ${Object.keys(usageData).length} apps, total library ${Object.keys(known).length}`);
        } catch (e) {
          console.error('[Tracker] Initial scan parse error:', e.message);
          this.hasInitialScan = true;
        }
      }
    );
  }

  async recordActivity(processName, windowTitle, exePath) {
    const now = Date.now();
    const elapsed = this.lastPollTime ? Math.round((now - this.lastPollTime) / 1000) : 2;
    this.lastPollTime = now;

    const seconds = Math.min(elapsed, 30);
    const dateKey = getLocalDateKey();
    const appKey = processName.toLowerCase();

    if (SYSTEM_IGNORED_PROCS.includes(appKey)) return;

    const cat = this.getCategory(appKey);
    this.currentForeground = {
      processName,
      windowTitle: windowTitle || processName,
      exePath: exePath || '',
      category: cat,
      lastSeen: now,
    };

    if (this.isFocusActiveFn()) {
      const blocklist = this.store.get('blocklist', []);
      const isBlocked = cat === 'wasteful' || blocklist.includes(appKey);
      if (isBlocked) {
        if (now - this.lastDistractionWarnTime > 60000) {
          this.lastDistractionWarnTime = now;
          this.onFocusDistractionFn(processName);
        }
      }
    }

    const usageData = this.store.get(`usageData.${dateKey}`, {});

    if (!usageData[appKey]) {
      let iconDataUrl = null;
      if (exePath) {
        try {
          const img = await app.getFileIcon(exePath, { size: 'normal' });
          iconDataUrl = img.toDataURL();
        } catch (e) {}
      }
      usageData[appKey] = {
        processName,
        windowTitle: windowTitle || processName,
        totalSeconds: 0,
        category: cat,
        lastActive: now,
        icon: iconDataUrl,
      };
    }

    usageData[appKey].totalSeconds += seconds;
    if (windowTitle && windowTitle.trim()) {
      usageData[appKey].windowTitle = windowTitle.trim();
    }
    usageData[appKey].lastActive = now;

    this.store.set(`usageData.${dateKey}`, usageData);

    const known = this.store.get('knownApps', {});
    const mins = Math.ceil(usageData[appKey].totalSeconds / 60);
    if (!known[appKey]) {
      known[appKey] = {
        id: appKey,
        name: processName,
        windowTitle: usageData[appKey].windowTitle || processName,
        timeSpentMinutes: mins,
        category: cat,
        type: 'application',
        icon: usageData[appKey].icon || ICON_MAP[appKey] || 'apps',
      };
    } else {
      known[appKey].timeSpentMinutes = mins;
      if (usageData[appKey].icon && !known[appKey].icon) {
        known[appKey].icon = usageData[appKey].icon;
      }
      known[appKey].category = cat;
    }
    this.store.set('knownApps', known);

    try {
      this.broadcaster('tracking-update', {
        dateKey,
        apps: this.formatApps(usageData),
      });
    } catch (e) {}
  }

  getCategory(appKey) {
    const userCats = this.store.get('appCategories', {});
    if (userCats[appKey]) return userCats[appKey];
    return DEFAULT_CATEGORIES[appKey] || 'neutral';
  }

  formatApps(usageData) {
    return Object.entries(usageData)
      .map(([key, d]) => {
        const totalSecs = d.totalSeconds || 0;
        return {
          id: key,
          name: d.processName,
          windowTitle: d.windowTitle,
          totalSeconds: totalSecs,
          timeSpentMinutes: Math.round(totalSecs / 60),
          category: this.getCategory(key),
          type: 'application',
          icon: d.icon || ICON_MAP[key] || 'apps',
        };
      })
      .filter(a => (a.totalSeconds || 0) > 0 || (a.timeSpentMinutes || 0) > 0)
      .sort((a, b) => (b.totalSeconds || 0) - (a.totalSeconds || 0));
  }

  getTodayApps() {
    const dateKey = getLocalDateKey();
    return this.formatApps(this.store.get(`usageData.${dateKey}`, {}));
  }

  getWeekApps() {
    const merged = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayData = this.store.get(`usageData.${getLocalDateKey(d)}`, {});
      for (const [key, data] of Object.entries(dayData)) {
        if (!merged[key]) merged[key] = { ...data, totalSeconds: 0 };
        merged[key].totalSeconds += data.totalSeconds;
      }
    }
    return this.formatApps(merged);
  }

  getDailyTotals() {
    const today = new Date();
    const day = today.getDay();
    const monday = new Date(today);
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    monday.setDate(diff);

    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const totals = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const dateKey = getLocalDateKey(d);
      const dayData = this.store.get(`usageData.${dateKey}`, {});
      const totalHours = Object.values(dayData).reduce((s, a) => s + (a.totalSeconds || 0), 0) / 3600;
      totals.push({
        day: days[i],
        label: days[i],
        value: Math.round(totalHours * 10) / 10,
        date: dateKey
      });
    }
    return totals;
  }

  getCurrentForeground() {
    return this.currentForeground;
  }

  getKnownApps() {
    this.cleanStore();
    const known = this.store.get('knownApps', {});
    const dateKey = getLocalDateKey();
    const usageData = this.store.get(`usageData.${dateKey}`, {});
    const categories = this.store.get('appCategories', {});

    // Sync today's usageData into knownApps
    for (const [key, d] of Object.entries(usageData)) {
      if (SYSTEM_IGNORED_PROCS.includes(key)) continue;
      const cat = categories[key] || d.category || this.getCategory(key);
      const totalSecs = d.totalSeconds || 0;
      const mins = Math.round(totalSecs / 60);
      if (!known[key]) {
        known[key] = {
          id: key,
          name: d.processName,
          windowTitle: d.windowTitle || d.processName,
          totalSeconds: totalSecs,
          timeSpentMinutes: mins,
          category: cat,
          type: 'application',
          icon: d.icon || ICON_MAP[key] || 'apps',
        };
      } else {
        known[key].totalSeconds = totalSecs;
        known[key].timeSpentMinutes = mins;
        if (d.icon && !known[key].icon) known[key].icon = d.icon;
        known[key].category = cat;
      }
    }

    return Object.values(known).sort((a, b) => {
      if ((b.timeSpentMinutes || 0) !== (a.timeSpentMinutes || 0)) {
        return (b.timeSpentMinutes || 0) - (a.timeSpentMinutes || 0);
      }
      return a.name.localeCompare(b.name);
    });
  }

  saveCustomApp(appData) {
    if (!appData || !appData.name) return null;
    const name = appData.name.trim();
    const rawProc = (appData.processName || name).trim().replace(/\.exe$/i, '');
    const key = rawProc.toLowerCase();
    const cat = appData.category || 'neutral';

    const categories = this.store.get('appCategories', {});
    categories[key] = cat;
    this.store.set('appCategories', categories);

    const known = this.store.get('knownApps', {});
    const dateKey = getLocalDateKey();
    const usageData = this.store.get(`usageData.${dateKey}`, {});
    const totalSecs = usageData[key]?.totalSeconds || 0;

    const entry = {
      id: key,
      name,
      windowTitle: name,
      timeSpentMinutes: Math.ceil(totalSecs / 60),
      category: cat,
      type: 'application',
      icon: ICON_MAP[key] || 'apps',
    };
    known[key] = entry;
    this.store.set('knownApps', known);

    return entry;
  }

  updateCategory(processName, category) {
    const key = processName.toLowerCase();
    const categories = this.store.get('appCategories', {});
    categories[key] = category;
    this.store.set('appCategories', categories);

    const known = this.store.get('knownApps', {});
    if (known[key]) {
      known[key].category = category;
      this.store.set('knownApps', known);
    }

    const dateKey = getLocalDateKey();
    const usageData = this.store.get(`usageData.${dateKey}`, {});
    if (usageData[key]) {
      usageData[key].category = category;
      this.store.set(`usageData.${dateKey}`, usageData);
    }
  }

  async scanAllInstalledApps() {
    return new Promise((resolve) => {
      const script = `
        $wsh = New-Object -ComObject WScript.Shell
        $shortcuts = Get-ChildItem -Path "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "$env:AppData\\Microsoft\\Windows\\Start Menu\\Programs" -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue

        $winDir = [System.Environment]::GetFolderPath('Windows')
        $excluded = 'unins|setup|install|update|helper|crash|report|clean|charmap|iscsi|odbc|resmon|regedit|perfmon|dfrgui|eventvwr|taskmgr|msconfig|msinfo|dxdiag|service|diagnost|troubleshoot|feedback|register|git|siv|console|terminal|powershell|cmd|prompt|accessibility|administrative'

        $seen = New-Object System.Collections.Generic.HashSet[string]
        $apps = @()

        foreach ($s in $shortcuts) {
          if ($s.FullName -match 'Administrative Tools|Windows Tools|Windows PowerShell|Accessibility|System Tools|Accessories') { continue }
          try {
            $t = $wsh.CreateShortcut($s.FullName).TargetPath
            if ($t -and (Test-Path $t) -and ($t.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase))) {
              if ($t.StartsWith($winDir, [System.StringComparison]::OrdinalIgnoreCase)) { continue }

              $pName = [System.IO.Path]::GetFileNameWithoutExtension($t)
              $key = $pName.ToLower()
              $baseName = $s.BaseName.ToLower()

              if ($key -match $excluded -or $baseName -match $excluded) { continue }

              if (-not $seen.Contains($key)) {
                $seen.Add($key) | Out-Null
                $apps += @{
                  processName = $pName;
                  name = $s.BaseName;
                  path = $t;
                }
              }
            }
          } catch {}
        }
        $apps | ConvertTo-Json -Compress
      `;

      execFile(
        'powershell.exe',
        ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
        async (err, stdout) => {
          if (err || !stdout || !stdout.trim()) {
            console.warn('[Tracker] scanAllInstalledApps failed:', err ? err.message : 'no output');
            resolve(this.getKnownApps());
            return;
          }

          try {
            let data = JSON.parse(stdout.trim());
            if (!Array.isArray(data)) data = [data];

            const known = this.store.get('knownApps', {});
            const categories = this.store.get('appCategories', {});
            const dateKey = getLocalDateKey();
            const usageData = this.store.get(`usageData.${dateKey}`, {});

            for (const item of data) {
              if (!item || !item.processName) continue;
              const key = item.processName.toLowerCase();
              if (SYSTEM_IGNORED_PROCS.includes(key)) continue;

              let iconDataUrl = null;
              if (item.path) {
                try {
                  const img = await app.getFileIcon(item.path, { size: 'normal' });
                  iconDataUrl = img.toDataURL();
                } catch (e) {}
              }

              const cat = categories[key] || this.getCategory(key);
              const totalSecs = usageData[key]?.totalSeconds || 0;

              known[key] = {
                id: key,
                name: item.name || item.processName,
                windowTitle: item.name || item.processName,
                totalSeconds: totalSecs,
                timeSpentMinutes: Math.round(totalSecs / 60),
                category: cat,
                type: 'application',
                icon: iconDataUrl || known[key]?.icon || ICON_MAP[key] || 'apps',
              };
            }

            this.store.set('knownApps', known);
            console.log(`[Tracker] scanAllInstalledApps saved ${Object.keys(known).length} apps to library`);
            resolve(this.getKnownApps());
          } catch (e) {
            console.error('[Tracker] scanAllInstalledApps parse error:', e.message);
            resolve(this.getKnownApps());
          }
        }
      );
    });
  }

  stop() {
    this.isTracking = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.psProcess) {
      try { this.psProcess.kill(); } catch (e) {}
      this.psProcess = null;
    }
    console.log('[Tracker] Stopped');
  }
}

module.exports = {
  AppTracker,
  getLocalDateKey,
  SYSTEM_IGNORED_PROCS,
  DEFAULT_CATEGORIES,
  ICON_MAP,
  WINDOW_SCANNER_SCRIPT,
};
