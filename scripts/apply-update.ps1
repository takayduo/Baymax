param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][string]$Stage, [Parameter(Mandatory=$true)][string]$Backup, [int]$WaitPid)
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($Root)
$stagePath = [IO.Path]::GetFullPath($Stage)
$backupPath = [IO.Path]::GetFullPath($Backup)
$parentPath = [IO.Path]::GetDirectoryName($rootPath)
if ($rootPath -eq [IO.Path]::GetPathRoot($rootPath) -or [IO.Path]::GetDirectoryName($stagePath) -ne $parentPath -or [IO.Path]::GetDirectoryName($backupPath) -ne $parentPath -or $stagePath -eq $rootPath -or $backupPath -eq $rootPath -or (Test-Path -LiteralPath $backupPath)) { throw 'Unsafe update paths' }
if (-not (Test-Path -LiteralPath (Join-Path $stagePath 'dist/build-info.json')) -or -not (Test-Path -LiteralPath (Join-Path $stagePath 'productivity/dist/index.html'))) { throw 'Staged build is incomplete' }
$processToWait = Get-Process -Id $WaitPid -ErrorAction SilentlyContinue
if ($processToWait) { $processToWait.WaitForExit() }
Start-Sleep -Seconds 3
$moved = $false
try {
  Move-Item -LiteralPath $rootPath -Destination $backupPath
  $moved = $true
  Move-Item -LiteralPath $stagePath -Destination $rootPath
  $exe = Join-Path $rootPath 'node_modules/electron/dist/electron.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Staged Electron is missing' }
  Start-Process -FilePath $exe -ArgumentList @('"' + $rootPath + '"') -WorkingDirectory $rootPath -WindowStyle Hidden
} catch {
  if ($moved) {
    if (Test-Path -LiteralPath $rootPath) { Move-Item -LiteralPath $rootPath -Destination $stagePath }
    Move-Item -LiteralPath $backupPath -Destination $rootPath
  }
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $parentPath 'baymax-update-error.txt')
  throw
}
# The previous installation stays in Backup for recovery; no recursive deletes.
