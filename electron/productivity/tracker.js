const { execFile, spawn } = require('node:child_process');
const path = require('node:path');
const { app } = require('electron');

function getLocalDateKey(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Closing protections live separately. Baymax excludes its own PID/path.
const SYSTEM_IGNORED_PROCS = [
  'textinputhost', 'shellexperiencehost', 'startmenuexperiencehost',
  'searchhost', 'searchapp', 'dwm', 'svchost', 'lockapp', 'runtimebroker',
  'ctfmon', 'conhost', 'wslhost', 'applicationframehost',
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

const AppTracker = require('./tracker-runtime').createTracker({
  app, powerMonitor: require('electron').powerMonitor, getLocalDateKey,
  DEFAULT_CATEGORIES, ICON_MAP, SYSTEM_IGNORED_PROCS, WINDOW_SCANNER_SCRIPT,
});
module.exports = { AppTracker, getLocalDateKey, SYSTEM_IGNORED_PROCS, DEFAULT_CATEGORIES, ICON_MAP, WINDOW_SCANNER_SCRIPT };
