# 🍡 Mochi Ultra — 1-Click Automated Uninstaller for Windows
$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "===================================================" -ForegroundColor Magenta
Write-Host "      🍡 MOCHI ULTRA 1-CLICK UNINSTALLER           " -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Magenta
Write-Host ""

# 1. Close running Mochi processes
Write-Host "[1/4] Stopping Mochi processes..." -ForegroundColor Yellow
Get-Process electron, python, pythonw -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*Mochi-Ultra*" -or $_.Path -like "*Mochi-Eye*" -or $_.CommandLine -like "*Mochi*" -or $_.CommandLine -like "*mochi_bridge*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Write-Host "      ✓ Stopped running processes" -ForegroundColor Green

# 2. Remove Desktop Shortcuts
Write-Host "[2/4] Removing Desktop shortcut..." -ForegroundColor Yellow
$desktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$shortcuts = @("Baymax.lnk", "Mochi Ultra.lnk", "Mochi Eye.lnk", "Mochi.lnk")
foreach ($s in $shortcuts) {
    $shortcutPath = Join-Path $desktopPath $s
    if (Test-Path $shortcutPath) {
        Remove-Item -Force $shortcutPath -ErrorAction SilentlyContinue
    }
}
Write-Host "      ✓ Desktop shortcuts removed" -ForegroundColor Green

# 3. Clean up Windows Startup (Shortcut & Registry)
Write-Host "[3/4] Removing from Windows Startup..." -ForegroundColor Yellow
$startupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
$startupShortcuts = @("Baymax.lnk", "Mochi Ultra.lnk", "Mochi Eye.lnk", "Mochi.lnk", "CoucouCreator.vbs")
foreach ($s in $startupShortcuts) {
    $p = Join-Path $startupFolder $s
    if (Test-Path $p) { Remove-Item -Force $p -ErrorAction SilentlyContinue }
}

Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CoucouCreator" -ErrorAction SilentlyContinue
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Mochi" -ErrorAction SilentlyContinue
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Mochi Ultra" -ErrorAction SilentlyContinue
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Baymax" -ErrorAction SilentlyContinue
Write-Host "      ✓ Startup entries removed" -ForegroundColor Green

# 4. Remove Mochi Folder & Cache
Write-Host "[4/4] Removing Baymax / Mochi files and data..." -ForegroundColor Yellow
$installFolders = @("$env:USERPROFILE\Baymax", "$env:USERPROFILE\Mochi-Ultra", "$env:USERPROFILE\Mochi-Eye")
foreach ($folder in $installFolders) {
    if (Test-Path $folder) {
        Remove-Item -Recurse -Force $folder -ErrorAction SilentlyContinue
    }
}
$appDataFolders = @(
    (Join-Path $env:APPDATA "baymax"),
    (Join-Path $env:APPDATA "mochi-ultra"),
    (Join-Path $env:APPDATA "mochi-eye"),
    (Join-Path $env:LOCALAPPDATA "baymax"),
    (Join-Path $env:LOCALAPPDATA "mochi-ultra")
)
foreach ($folder in $appDataFolders) {
    if (Test-Path $folder) {
        Remove-Item -Recurse -Force $folder -ErrorAction SilentlyContinue
    }
}
Write-Host "      ✓ Files and cache cleaned" -ForegroundColor Green

Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host "🎉 SUCCESS: Mochi Ultra has been completely removed!" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host ""
