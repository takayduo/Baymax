$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Foreground {
  public delegate bool EnumWindowsProc(IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr w, StringBuilder s, int c);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr w, EnumWindowsProc f, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr process, ref uint length, StringBuilder id);
  public static string AppId(uint pid) {
    var h=OpenProcess(0x1000,false,pid); if(h==IntPtr.Zero)return "";
    try { uint size=512; var b=new StringBuilder(512); return GetApplicationUserModelId(h,ref size,b)==0 ? b.ToString() : ""; }
    finally { CloseHandle(h); }
  }
  public static uint ResolveChild(IntPtr w, uint host) {
    uint result = host;
    EnumChildWindows(w, (child, unused) => { uint p; GetWindowThreadProcessId(child, out p); if (p != 0 && p != host) { result=p; return false; } return true; }, IntPtr.Zero);
    return result;
  }
}
'@
while ($true) {
  $sample = @{ n=''; t=''; p=0; path='' }
  try {
    $w = [Foreground]::GetForegroundWindow()
    if ($w -ne [IntPtr]::Zero) {
      $procId = [uint32]0
      [Foreground]::GetWindowThreadProcessId($w, [ref]$procId) | Out-Null
      $p = Get-Process -Id $procId -ErrorAction Stop
      if ($p.ProcessName -eq 'ApplicationFrameHost') { $procId = [Foreground]::ResolveChild($w, $procId); $p = Get-Process -Id $procId -ErrorAction Stop }
      $title = New-Object Text.StringBuilder 2048
      [Foreground]::GetWindowText($w, $title, $title.Capacity) | Out-Null
      $exe = ''; try { $exe = $p.Path } catch {}
      $sample = @{ n=$p.ProcessName; t=$title.ToString(); p=[int]$procId; path=$exe; appId=[Foreground]::AppId($procId) }
    }
  } catch {}
  [Console]::WriteLine(($sample | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1500
}
