$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $rootPath
& .\node_modules\.bin\esbuild.cmd src/views/productivity.ts --bundle --format=iife --global-name=Smoke --outfile=dist/smoke-parent.js
if ($LASTEXITCODE -ne 0) { throw 'Smoke fixture build failed' }
Set-Content -LiteralPath dist/smoke-parent.html -Value '<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#0a0a0a}.view{height:100%}</style></head><body><script src="smoke-parent.js"></script><script>document.body.appendChild(Smoke.buildProductivity({}).el)</script></body></html>'
try {
  $smoke = Start-Process -FilePath (Join-Path $rootPath 'node_modules/electron/dist/electron.exe') -ArgumentList @('"' + (Join-Path $rootPath 'tests/electron-smoke.cjs') + '"') -WorkingDirectory $rootPath -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $rootPath 'audit/electron-smoke-stdout.txt') -RedirectStandardError (Join-Path $rootPath 'audit/electron-smoke-stderr.txt')
  Get-Content -LiteralPath audit/electron-smoke-stdout.txt
  Get-Content -LiteralPath audit/electron-smoke-stderr.txt
  if ($smoke.ExitCode -ne 0) { throw "Electron smoke test failed with exit code $($smoke.ExitCode)" }
} finally {
  Remove-Item -LiteralPath (Join-Path $rootPath 'dist/smoke-parent.js'), (Join-Path $rootPath 'dist/smoke-parent.html') -Force -ErrorAction SilentlyContinue
}
