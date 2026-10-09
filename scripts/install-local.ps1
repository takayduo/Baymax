param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Root dependency installation failed' }
& npm.cmd ci --prefix productivity
if ($LASTEXITCODE -ne 0) { throw 'Productivity dependency installation failed' }
& $Python -m venv engine/.venv
if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
$pythonPath = Join-Path (Get-Location) 'engine/.venv/Scripts/python.exe'
& $pythonPath -m pip install -r engine/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
& $pythonPath -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Python dependency validation failed' }
Set-Content -LiteralPath engine/python_path.txt -Value $pythonPath -NoNewline
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
