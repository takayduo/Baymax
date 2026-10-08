$code = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;

namespace BaymaxTracker {
    public static class WindowHelper {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll")]
        public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        public static extern bool CloseDesktop(IntPtr hDesktop);

        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TOOLWINDOW = 0x00000080;

        public static string GetCurrentActiveApp() {
            // 1. Try GetForegroundWindow first
            IntPtr hFore = GetForegroundWindow();
            if (hFore != IntPtr.Zero && IsWindowVisible(hFore) && !IsIconic(hFore)) {
                uint pid = 0;
                GetWindowThreadProcessId(hFore, out pid);
                if (pid > 0) {
                    try {
                        var p = Process.GetProcessById((int)pid);
                        var sb = new StringBuilder(512);
                        GetWindowText(hFore, sb, sb.Capacity);
                        string path = "";
                        try { path = p.MainModule.FileName; } catch {}
                        return "{\"n\":\"" + p.ProcessName + "\",\"t\":\"" + sb.ToString().Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"p\":" + pid + ",\"path\":\"" + path.Replace("\\", "\\\\") + "\"}";
                    } catch {}
                }
            }

            // 2. Fallback to desktop Z-order enumeration
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk == IntPtr.Zero) return null;

            string found = null;
            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                if (IsWindowVisible(hWnd) && !IsIconic(hWnd)) {
                    int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                    if ((exStyle & WS_EX_TOOLWINDOW) != 0) return true;

                    StringBuilder sb = new StringBuilder(512);
                    int len = GetWindowText(hWnd, sb, sb.Capacity);
                    string title = sb.ToString();

                    uint pid = 0;
                    GetWindowThreadProcessId(hWnd, out pid);

                    if (pid > 0 && len > 0) {
                        try {
                            var proc = Process.GetProcessById((int)pid);
                            string pName = proc.ProcessName.ToLower();
                            if (pName != "explorer" &&
                                pName != "shellexperiencehost" &&
                                pName != "searchhost" &&
                                pName != "startmenuexperiencehost" &&
                                pName != "textinputhost" &&
                                pName != "applicationframehost" &&
                                pName != "electron" &&
                                pName != "mochi" &&
                                pName != "baymax") {
                                string path = "";
                                try { path = proc.MainModule.FileName; } catch {}
                                found = "{\"n\":\"" + proc.ProcessName + "\",\"t\":\"" + title.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"p\":" + pid + ",\"path\":\"" + path.Replace("\\", "\\\\") + "\"}";
                                return false; // Stop at top window
                            }
                        } catch {}
                    }
                }
                return true;
            }, IntPtr.Zero);

            CloseDesktop(hDesk);
            return found;
        }
    }
}
"@

try {
    Add-Type -TypeDefinition $code -ErrorAction Stop
} catch {}

while ($true) {
    try {
        $json = [BaymaxTracker.WindowHelper]::GetCurrentActiveApp()
        if ($json) {
            [Console]::WriteLine($json)
            [Console]::Out.Flush()
        }
    } catch {}
    Start-Sleep -Milliseconds 1500
}
