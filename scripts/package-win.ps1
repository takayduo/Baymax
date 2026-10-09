param([switch]$SkipEngine, [switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$env:ELECTRON_BUILDER_CACHE = Join-Path (Get-Location) '.build-cache\electron-builder'
$env:PYINSTALLER_CONFIG_DIR = Join-Path (Get-Location) '.build-cache\pyinstaller'
$env:HF_HOME = Join-Path (Get-Location) '.build-cache\huggingface'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
if (-not $SkipFrontend) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
}
if (-not $SkipEngine) {
    & python -m PyInstaller --noconfirm --distpath build/engine --workpath build/pyinstaller engine/BaymaxEngine.spec
    if ($LASTEXITCODE -ne 0) { throw 'Engine packaging failed' }
}
$engineExe = Join-Path (Get-Location) 'build\engine\BaymaxEngine\BaymaxEngine.exe'
if (-not (Test-Path -LiteralPath $engineExe)) { throw 'Bundled engine is missing' }
$env:BAYMAX_ENGINE_DATA = Join-Path (Get-Location) 'build\engine-self-test-data'
& $engineExe --self-test
if ($LASTEXITCODE -ne 0) { throw 'Bundled engine validation failed' }
Remove-Item Env:BAYMAX_ENGINE_DATA
& (Join-Path $PSScriptRoot 'prepare-windows-tools.ps1')
$builder = Join-Path (Get-Location) 'node_modules\electron-builder\cli.js'
if (-not (Test-Path -LiteralPath $builder)) {
    $builder = Join-Path (Get-Location) 'productivity\node_modules\electron-builder\cli.js'
}
if (-not (Test-Path -LiteralPath $builder)) { throw 'Install dependencies before packaging' }
& node $builder --config electron-builder.json --win nsis --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'Windows installer packaging failed' }
Get-ChildItem -LiteralPath release -Filter '*.exe' | Get-FileHash -Algorithm SHA256
