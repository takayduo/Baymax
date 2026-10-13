param([switch]$WriteIcons)
$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
Set-Location $rootPath
& node tests/build-wardrobe-fixture.cjs
if ($LASTEXITCODE -ne 0) { throw 'Wardrobe fixture build failed' }
$arguments = @('"' + (Join-Path $rootPath 'tests/wardrobe-render.cjs') + '"')
if ($WriteIcons) { $arguments += '--write-icons' }
$testProcess = Start-Process -FilePath (Join-Path $rootPath 'node_modules/electron/dist/electron.exe') -ArgumentList $arguments -WorkingDirectory $rootPath -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $rootPath 'audit/wardrobe-render-stdout.txt') -RedirectStandardError (Join-Path $rootPath 'audit/wardrobe-render-stderr.txt')
Get-Content -LiteralPath (Join-Path $rootPath 'audit/wardrobe-render-stdout.txt')
Get-Content -LiteralPath (Join-Path $rootPath 'audit/wardrobe-render-stderr.txt')
if ($testProcess.ExitCode -ne 0) { throw "Wardrobe rendering failed: $($testProcess.ExitCode)" }
