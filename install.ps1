# 🤖 Baymax — 1-Click Automated Installer for Any Windows PC
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Download-Fast($url, $dest, $showProgress = $false) {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        if ($showProgress) {
            & curl.exe -f -# -SL "$url" -o "$dest"
        } else {
            & curl.exe -f -sSL "$url" -o "$dest"
        }
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
    } else {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($url, $dest)
    }
}

function Refresh-EnvPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $combined = "$userPath;$machinePath;$env:Path"
    $env:Path = ($combined -split ";" | Where-Object { $_ -ne "" } | Select-Object -Unique) -join ";"
}

function Find-RealPython {
    Refresh-EnvPath
    # 1. Search python.exe in current PATH (skip WindowsApps zero-byte stubs)
    $all = Get-Command python.exe -All -ErrorAction SilentlyContinue
    foreach ($cmd in $all) {
        if ($cmd.Source -and $cmd.Source -notlike "*WindowsApps*" -and (Test-Path $cmd.Source)) {
            return $cmd.Source
        }
    }
    # 2. Check standard Python installation directories
    $standardDirs = @(
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe",
        "$env:ProgramFiles\Python312\python.exe",
        "$env:ProgramFiles\Python311\python.exe",
        "$env:ProgramFiles\Python310\python.exe",
        "${env:ProgramFiles(x86)}\Python312\python.exe",
        "${env:ProgramFiles(x86)}\Python311\python.exe"
    )
    foreach ($p in $standardDirs) {
        if (Test-Path $p) {
            return $p
        }
    }
    # 3. Check py.exe launcher
    $pyCmd = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pyCmd -and (Test-Path $pyCmd.Source)) {
        return $pyCmd.Source
    }
    return $null
}

Write-Host ""
Write-Host "===================================================" -ForegroundColor Magenta
Write-Host "      🤖 BAYMAX 1-CLICK WINDOWS INSTALLER          " -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Magenta
Write-Host ""

# 1. Check & Install Node.js if missing
Write-Host "[1/6] Checking Node.js environment..." -ForegroundColor Yellow

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    if (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
        $env:Path = "$env:ProgramFiles\nodejs;" + $env:Path
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    } elseif (Test-Path "${env:ProgramFiles(x86)}\nodejs\node.exe") {
        $env:Path = "${env:ProgramFiles(x86)}\nodejs;" + $env:Path
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    }
}

if (-not $nodeCmd) {
    Write-Host "      Node.js not detected. Installing Node.js LTS automatically..." -ForegroundColor Cyan
    $installed = $false
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        Write-Host "      Checking Windows Package Manager (winget)..." -ForegroundColor Gray
        try {
            $p = Start-Process winget -ArgumentList "install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements" -Wait -PassThru
            if (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
                $installed = $true
            }
        } catch {
            $installed = $false
        }
    }
    if (-not $installed) {
        $msiUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
        $msiDest = "$env:TEMP\nodejs_lts.msi"
        Write-Host "      Downloading official Node.js 22 LTS installer from nodejs.org..." -ForegroundColor Gray
        Download-Fast $msiUrl $msiDest
        Write-Host "      Installing Node.js..." -ForegroundColor Gray
        Start-Process msiexec.exe -ArgumentList "/i `"$msiDest`" /passive /norestart" -Wait
    }
    $env:Path = "$env:ProgramFiles\nodejs;$env:APPDATA\npm;" + $env:Path
}

$npmExe = "npm"
if (Test-Path "$env:ProgramFiles\nodejs\npm.cmd") {
    $npmExe = "$env:ProgramFiles\nodejs\npm.cmd"
}
if (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
    $nodeExe = "$env:ProgramFiles\nodejs\node.exe"
} else {
    $nodeExe = "node"
}

Write-Host "      [OK] Node.js is ready: $(& $nodeExe -v)" -ForegroundColor Green

# 2. Check Python for Mark-LV Autonomous Engine
Write-Host "[2/6] Checking Python 3 environment..." -ForegroundColor Yellow
$pyExe = Find-RealPython

if (-not $pyExe) {
    Write-Host "      Python not detected. Installing Python 3.12 automatically..." -ForegroundColor Cyan
    $installed = $false

    # Try winget first if available
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        try {
            Write-Host "      Attempting installation via winget..." -ForegroundColor Gray
            Start-Process winget -ArgumentList "install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements" -Wait
            Refresh-EnvPath
            $pyExe = Find-RealPython
            if ($pyExe) { $installed = $true }
        } catch {}
    }

    # Direct download official Python 3.12 installer if winget failed or is missing
    if (-not $installed -or -not $pyExe) {
        Write-Host "      Downloading official Python 3.12 installer from python.org..." -ForegroundColor Gray
        $pyUrl = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
        $pyDest = "$env:TEMP\python_312_installer.exe"
        Download-Fast $pyUrl $pyDest
        Write-Host "      Installing Python 3.12 (silent)..." -ForegroundColor Gray
        Start-Process -FilePath $pyDest -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 SimpleInstall=1" -Wait
        Remove-Item -Force $pyDest -ErrorAction SilentlyContinue
        Refresh-EnvPath
        $pyExe = Find-RealPython
    }
}

if ($pyExe) {
    $pyDir = Split-Path $pyExe
    $pyScripts = Join-Path $pyDir "Scripts"
    $env:Path = "$pyDir;$pyScripts;$env:Path"
    Write-Host "      [OK] Python is ready: $pyExe" -ForegroundColor Green
} else {
    Write-Host "      [!] Python could not be installed automatically. Please install Python 3.12 from python.org." -ForegroundColor Yellow
}

# 3. Download Baymax from GitHub
Write-Host "[3/6] Downloading Baymax from GitHub..." -ForegroundColor Yellow
$installFolder = "$env:USERPROFILE\Baymax"
if (Test-Path -LiteralPath $installFolder) {
    $installFolder = Join-Path $env:USERPROFILE ('Baymax-' + [Guid]::NewGuid().ToString('N'))
}
New-Item -ItemType Directory -Path $installFolder | Out-Null

$zipUrlPrimary = "https://github.com/takayduo/BEMAX/archive/refs/heads/main.zip"
$zipUrlFallback = "https://github.com/takayduo/Mochi-Ultra/archive/refs/heads/main.zip"
$downloadId = [Guid]::NewGuid().ToString('N')
$zipFile = Join-Path $env:TEMP "Baymax-$downloadId.zip"
$extractTemp = Join-Path $env:TEMP "Baymax-$downloadId"

$downloaded = $false
try {
    Write-Host "      Fetching latest bundle from BEMAX..." -ForegroundColor Gray
    Download-Fast $zipUrlPrimary $zipFile
    if ((Test-Path $zipFile) -and ((Get-Item $zipFile).Length -gt 10000)) {
        $downloaded = $true
    }
} catch {
    $downloaded = $false
}

if (-not $downloaded) {
    Write-Host "      Checking fallback repository..." -ForegroundColor Gray
    Download-Fast $zipUrlFallback $zipFile
}

Expand-Archive -Path $zipFile -DestinationPath $extractTemp -Force

# Locate extracted directory (BEMAX-main or Mochi-Ultra-main)
$extractedSubdirs = Get-ChildItem -Directory -Path $extractTemp
$srcDir = if ($extractedSubdirs.Count -gt 0) { $extractedSubdirs[0].FullName } else { $extractTemp }

# Copy files into target folder
Copy-Item -Path "$srcDir\*" -Destination $installFolder -Recurse -Force
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
foreach ($cleanupPath in @($zipFile, $extractTemp)) {
    $resolvedCleanup = [IO.Path]::GetFullPath($cleanupPath)
    if (-not $resolvedCleanup.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe temporary cleanup path' }
    Remove-Item -LiteralPath $resolvedCleanup -Recurse -Force
}

# Save resolved Python path for Electron engine runner
if ($pyExe) {
    if (-not (Test-Path "$installFolder\engine")) {
        New-Item -ItemType Directory -Path "$installFolder\engine" -Force | Out-Null
    }
    Set-Content -Path (Join-Path $installFolder "engine\python_path.txt") -Value $pyExe -Force
}

Write-Host "      [OK] Downloaded into $installFolder" -ForegroundColor Green

# 4-5. Use the same fail-checked setup as the local working copy.
Write-Host '[4/6] Installing locked dependencies and building both frontends...' -ForegroundColor Yellow
Set-Location -LiteralPath $installFolder
$localSetup = Join-Path $installFolder 'scripts/install-local.ps1'
if (-not (Test-Path -LiteralPath $localSetup)) { throw 'Downloaded release lacks the verified setup script. Use the repaired local checkout.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $localSetup -Python $pyExe
if ($LASTEXITCODE -ne 0) { throw 'Setup failed. Application was not launched.' }
# 6. Create Desktop Shortcut
Write-Host "[6/6] Creating Desktop Shortcut..." -ForegroundColor Yellow
$desktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$shortcutPath = Join-Path $desktopPath "Baymax.lnk"

# Clean up old Mochi shortcuts
foreach ($oldLnk in @("Mochi Ultra.lnk", "Mochi Eye.lnk", "Mochi.lnk")) {
    $oldPath = Join-Path $desktopPath $oldLnk
    if (Test-Path $oldPath) {
        Remove-Item -Force $oldPath -ErrorAction SilentlyContinue
    }
}

$electronExe = Join-Path $installFolder "node_modules\electron\dist\electron.exe"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)

if (Test-Path $electronExe) {
    $shortcut.TargetPath = $electronExe
    $shortcut.Arguments = "."
} else {
    $shortcut.TargetPath = "cmd.exe"
    $shortcut.Arguments = "/c `"$installFolder\Launch Baymax.bat`""
}

$shortcut.WorkingDirectory = $installFolder
$iconFile = Join-Path $installFolder "public\icons\icon.ico"
if (Test-Path $iconFile) {
    $shortcut.IconLocation = "$iconFile,0"
}
$shortcut.Description = "Baymax — Autonomous AI Desktop Companion & Productivity Engine"
$shortcut.Save()

Write-Host "      [OK] Desktop shortcut created: $shortcutPath" -ForegroundColor Green

Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host "   [SUCCESS] Baymax is installed and ready!        " -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Launching Baymax now..." -ForegroundColor Cyan

if (Test-Path $electronExe) {
    Start-Process -FilePath $electronExe -ArgumentList "." -WorkingDirectory $installFolder
} else {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$installFolder\Launch Baymax.bat`"" -WindowStyle Hidden
}
