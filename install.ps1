# 🤖 Baymax — 1-Click Automated Installer for Any Windows PC
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Download-Fast($url, $dest, $showProgress = $false) {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        if ($showProgress) {
            & curl.exe -# -SL "$url" -o "$dest"
        } else {
            & curl.exe -sSL "$url" -o "$dest"
        }
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
if (-not (Test-Path $installFolder)) {
    if (Test-Path "$env:USERPROFILE\Mochi-Ultra") {
        $installFolder = "$env:USERPROFILE\Mochi-Ultra"
    } else {
        New-Item -ItemType Directory -Path $installFolder -Force | Out-Null
    }
}

$zipUrlPrimary = "https://github.com/takayduo/BEMAX/archive/refs/heads/main.zip"
$zipUrlFallback = "https://github.com/takayduo/Mochi-Ultra/archive/refs/heads/main.zip"
$zipFile = "$env:TEMP\Baymax_Latest.zip"
$extractTemp = "$env:TEMP\Baymax_Extract"

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

if (Test-Path $extractTemp) {
    Remove-Item -Recurse -Force $extractTemp
}
Expand-Archive -Path $zipFile -DestinationPath $extractTemp -Force

# Locate extracted directory (BEMAX-main or Mochi-Ultra-main)
$extractedSubdirs = Get-ChildItem -Directory -Path $extractTemp
$srcDir = if ($extractedSubdirs.Count -gt 0) { $extractedSubdirs[0].FullName } else { $extractTemp }

# Copy files into target folder
Copy-Item -Path "$srcDir\*" -Destination $installFolder -Recurse -Force
Remove-Item -Recurse -Force $zipFile, $extractTemp

# Save resolved Python path for Electron engine runner
if ($pyExe) {
    if (-not (Test-Path "$installFolder\engine")) {
        New-Item -ItemType Directory -Path "$installFolder\engine" -Force | Out-Null
    }
    Set-Content -Path (Join-Path $installFolder "engine\python_path.txt") -Value $pyExe -Force
}

Write-Host "      [OK] Downloaded into $installFolder" -ForegroundColor Green

# 4. Install NPM Dependencies & Python Requirements
Write-Host "[4/6] Installing packages (npm install and pip)..." -ForegroundColor Yellow
Set-Location -Path $installFolder

if (Test-Path "$installFolder\package-lock.json") {
    Remove-Item -Force "$installFolder\package-lock.json" -ErrorAction SilentlyContinue
}

& $npmExe install

# Install Python requirements for Mark-LV autonomous engine
if ($pyExe -and (Test-Path "$installFolder\engine\requirements.txt")) {
    Write-Host "      Installing Mark-LV engine Python dependencies..." -ForegroundColor Cyan
    try {
        & "$pyExe" -m pip install --upgrade pip --quiet
        & "$pyExe" -m pip install -r "$installFolder\engine\requirements.txt"
        Write-Host "      [OK] Python dependencies installed successfully!" -ForegroundColor Green
    } catch {
        Write-Host "      [!] Python dependency install note: $_" -ForegroundColor Yellow
    }
}

# Ensure Electron binary is fully extracted (bypasses npm bug #4828 on clean Windows)
$electronDist = Join-Path $installFolder "node_modules\electron\dist"
$electronExe = Join-Path $electronDist "electron.exe"

if (-not (Test-Path $electronExe)) {
    Write-Host "      Configuring Electron binary..." -ForegroundColor Cyan
    $electronPkgPath = Join-Path $installFolder "node_modules\electron\package.json"
    if (Test-Path $electronPkgPath) {
        $electronPkg = Get-Content $electronPkgPath -Raw | ConvertFrom-Json
        $electronVersion = $electronPkg.version
    } else {
        $electronVersion = "44.5.1"
    }
    
    $electronZipUrl = "https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-win32-x64.zip"
    $electronZipPath = "$env:TEMP\electron-v$electronVersion.zip"
    
    Write-Host "      Downloading Electron v$electronVersion (~150 MB)... please wait a moment." -ForegroundColor Cyan
    Download-Fast $electronZipUrl $electronZipPath $true
    
    Write-Host "      Extracting Electron files..." -ForegroundColor Gray
    if (-not (Test-Path $electronDist)) {
        New-Item -ItemType Directory -Path $electronDist -Force | Out-Null
    }
    Expand-Archive -Path $electronZipPath -DestinationPath $electronDist -Force
    Set-Content -Path (Join-Path $installFolder "node_modules\electron\path.txt") -Value "electron.exe" -NoNewline
    Remove-Item -Force $electronZipPath -ErrorAction SilentlyContinue
    Write-Host "      [OK] Electron binary ready: $electronExe" -ForegroundColor Green
}

# 5. Build Baymax
Write-Host "[5/6] Building application bundle (vite build)..." -ForegroundColor Yellow
if (Test-Path "$installFolder\node_modules\esbuild\install.js") {
    & $nodeExe "$installFolder\node_modules\esbuild\install.js" 2>$null
}
& $npmExe run build

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
