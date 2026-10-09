$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
$testProcess = Start-Process -FilePath (Join-Path $rootPath 'node_modules/electron/dist/electron.exe') -ArgumentList @('"' + (Join-Path $rootPath 'tests/settings-smoke.cjs') + '"') -WorkingDirectory $rootPath -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $rootPath 'audit/settings-smoke-stdout.txt') -RedirectStandardError (Join-Path $rootPath 'audit/settings-smoke-stderr.txt')
Get-Content -LiteralPath (Join-Path $rootPath 'audit/settings-smoke-stdout.txt')
Get-Content -LiteralPath (Join-Path $rootPath 'audit/settings-smoke-stderr.txt')
if ($testProcess.ExitCode -ne 0) { throw "Settings smoke test failed: $($testProcess.ExitCode)" }
