$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force audit/fourteen-smoke | Out-Null
Copy-Item -LiteralPath tests/fourteen.html -Destination audit/fourteen-smoke/index.html
& node_modules/.bin/esbuild.cmd tests/fourteen-renderer.ts --bundle --format=iife --loader:.png=dataurl --outfile=audit/fourteen-smoke/renderer.js
if ($LASTEXITCODE -ne 0) { throw 'Smoke fixture build failed' }
& node_modules/.bin/electron.cmd tests/fourteen-smoke.cjs
if ($LASTEXITCODE -ne 0) { throw 'Call, UI or focus smoke tests failed' }
