$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
Set-Location $rootPath
& node tests/build-music-fixture.cjs
if ($LASTEXITCODE -ne 0) { throw 'Music fixture build failed' }
$process = Start-Process -FilePath (Join-Path $rootPath 'node_modules/electron/dist/electron.exe') -ArgumentList @('"' + (Join-Path $rootPath 'tests/music-smoke.cjs') + '"') -WorkingDirectory $rootPath -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $rootPath 'audit/music-smoke-stdout.txt') -RedirectStandardError (Join-Path $rootPath 'audit/music-smoke-stderr.txt')
Get-Content audit/music-smoke-stdout.txt
Get-Content audit/music-smoke-stderr.txt
if ($process.ExitCode -ne 0) { throw "Music tests failed: $($process.ExitCode)" }
