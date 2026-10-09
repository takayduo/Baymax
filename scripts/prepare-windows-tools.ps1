# app-builder's native Windows rcedit command uses this legacy bundle even when
# toolsets.winCodeSign is set. Extract Windows files only: the unrelated macOS
# dylib symlinks otherwise require Windows Developer Mode/admin privileges.
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$cachePath = Join-Path $workspacePath '.build-cache\electron-builder\winCodeSign'
$vendorPath = Join-Path $cachePath 'winCodeSign-2.6.0'
$markerPath = Join-Path $vendorPath '.baymax-verified-windows'
if ((Test-Path -LiteralPath $markerPath) -and (Test-Path -LiteralPath (Join-Path $vendorPath 'rcedit-x64.exe'))) { return }
# Upstream checksum: github.com/develar/app-builder/blob/master/pkg/download/tool.go
$expectedDigest = '6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA=='
function Get-ArchiveDigest([string]$archivePath) {
    $stream = [IO.File]::OpenRead($archivePath)
    $hasher = [Security.Cryptography.SHA512]::Create()
    try { return [Convert]::ToBase64String($hasher.ComputeHash($stream)) }
    finally { $stream.Dispose(); $hasher.Dispose() }
}
New-Item -ItemType Directory -Path $cachePath -Force | Out-Null
$archive = Get-ChildItem -LiteralPath $cachePath -Filter '*.7z' -File | Where-Object { (Get-ArchiveDigest $_.FullName) -eq $expectedDigest } | Select-Object -First 1
if (-not $archive) {
    $archivePath = Join-Path $cachePath 'winCodeSign-2.6.0.7z'
    Invoke-WebRequest -Uri 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -OutFile $archivePath -UseBasicParsing
    if ((Get-ArchiveDigest $archivePath) -ne $expectedDigest) { throw 'Windows tool archive checksum mismatch' }
    $archive = Get-Item -LiteralPath $archivePath
}
$extractor = Join-Path $workspacePath 'node_modules\7zip-bin\win\x64\7za.exe'
& $extractor x -y -bd $archive.FullName "-o$vendorPath" '-xr!darwin' '-xr!linux' | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $vendorPath 'rcedit-x64.exe'))) { throw 'Windows tool extraction failed' }
Set-Content -LiteralPath $markerPath -Value $expectedDigest -Encoding ascii
Write-Host 'Windows executable tools verified and prepared without macOS symlinks.'
