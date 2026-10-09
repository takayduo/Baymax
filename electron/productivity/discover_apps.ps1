$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$apps = [System.Collections.Generic.List[object]]::new()
$wsh = New-Object -ComObject WScript.Shell
$roots = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:AppData\Microsoft\Windows\Start Menu\Programs")
foreach ($s in (Get-ChildItem -LiteralPath $roots -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue)) {
  try {
    $link = $wsh.CreateShortcut($s.FullName)
    $target = $link.TargetPath
    if ($target -and (Test-Path -LiteralPath $target) -and $target.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
      $proc = [IO.Path]::GetFileNameWithoutExtension($target)
      # Keep the real shortcut so wrapper arguments and working directory survive.
      if ($link.Arguments -match '--processStart\s+"?([^"\s]+\.exe)') {
        $childExe = $matches[1]; $proc = [IO.Path]::GetFileNameWithoutExtension($childExe)
        $child = Get-ChildItem -LiteralPath (Split-Path -Parent $target) -Filter $childExe -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($child) { $target = $child.FullName }
      }
      $apps.Add(@{ name=$s.BaseName; processName=$proc; path=$target; shortcut=$s.FullName; arguments=$link.Arguments; source='shortcut' })
    }
  } catch {}
}
# Registered Store/packaged apps often have no executable shortcut.
$registered = @(Get-StartApps -ErrorAction Stop)
$packages = @()
try { $packages = @(Get-AppxPackage -ErrorAction Stop) } catch { }
foreach ($a in $registered) {
  if ($a.AppID -notmatch '!') { continue }
  $exe = ''; $proc = ''
  try {
    $parts = $a.AppID.Split('!'); $pkg = $packages | Where-Object PackageFamilyName -eq $parts[0] | Select-Object -First 1
    if ($pkg) {
      $manifest = Get-AppxPackageManifest -Package $pkg.PackageFullName
      $appNode = $manifest.Package.Applications.Application | Where-Object Id -eq $parts[1] | Select-Object -First 1
      if ($appNode.Executable) { $exe = Join-Path $pkg.InstallLocation $appNode.Executable; $proc = [IO.Path]::GetFileNameWithoutExtension($exe) }
    }
  } catch {}
  $apps.Add(@{ name=$a.Name; appId=$a.AppID; path=$exe; processName=$proc; source='packaged' })
}
ConvertTo-Json -InputObject @($apps.ToArray()) -Depth 5 -Compress
