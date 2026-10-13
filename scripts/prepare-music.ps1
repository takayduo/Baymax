$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $rootPath '.build-cache\music-core'
if (-not (Test-Path (Join-Path $runtimePath 'yt_dlp-2026.8.19.dist-info')) -or -not (Test-Path (Join-Path $runtimePath 'yt_dlp_ejs-0.8.0.dist-info'))) {
    & python -m pip install --target $runtimePath --upgrade --no-deps 'yt-dlp==2026.8.19' 'yt-dlp-ejs==0.8.0'
    if ($LASTEXITCODE -ne 0) { throw 'Music extractor setup failed' }
}
