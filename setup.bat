@echo off
setlocal enabledelayedexpansion
title Mochi Ultra Setup & Launcher
cd /d "%~dp0"

echo ===================================================
echo          MOCHI ULTRA INSTALLER & LAUNCHER
echo ===================================================
echo.

:: 1. Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
    ) else (
        echo [!] Node.js was not detected on your PC.
        echo [*] Installing Node.js 22 LTS automatically for you, please wait...
        echo.
        where winget >nul 2>nul
        if !ERRORLEVEL! EQU 0 (
            winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        ) else (
            echo Downloading Node.js installer from nodejs.org...
            powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%TEMP%\nodejs.msi'"
            echo Installing Node.js...
            msiexec /i "%TEMP%\nodejs.msi" /passive /norestart
        )
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
    )
)

:: Verify node again
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Could not automatically install Node.js.
    echo Please download and install Node.js from https://nodejs.org
    echo Then run this setup.bat file again!
    pause
    exit /b 1
)

echo [OK] Node.js is ready!
echo.

:: 2. Install dependencies
if not exist "node_modules\electron\dist\electron.exe" (
    echo [*] Installing Mochi dependencies...
    if exist "package-lock.json" del /f /q "package-lock.json" 2>nul
    call npm install
)

:: Verify electron binary was extracted successfully
if not exist "node_modules\electron\dist\electron.exe" (
    echo [*] Downloading Electron binary directly...
    powershell -NoProfile -Command "$v = '44.5.1'; if (Test-Path 'node_modules\electron\package.json') { $v = (Get-Content 'node_modules\electron\package.json' -Raw | ConvertFrom-Json).version }; $zip = \"$env:TEMP\electron.zip\"; Invoke-WebRequest -Uri \"https://github.com/electron/electron/releases/download/v$v/electron-v$v-win32-x64.zip\" -OutFile $zip; if (-not (Test-Path 'node_modules\electron\dist')) { New-Item -ItemType Directory -Path 'node_modules\electron\dist' -Force | Out-Null }; Expand-Archive -Path $zip -DestinationPath 'node_modules\electron\dist' -Force; Set-Content -Path 'node_modules\electron\path.txt' -Value 'electron.exe' -NoNewline; Remove-Item -Force $zip -ErrorAction SilentlyContinue" >nul 2>nul
)

:: 3. Check for Python & install engine requirements (Mark-LV Engine)
if exist "engine\requirements.txt" (
    echo [*] Checking Python environment for Mark-LV autonomous engine...
    where python >nul 2>nul
    if !ERRORLEVEL! NEQ 0 (
        if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
            set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;!PATH!"
        ) else if exist "%ProgramFiles%\Python312\python.exe" (
            set "PATH=%ProgramFiles%\Python312;%ProgramFiles%\Python312\Scripts;!PATH!"
        ) else (
            echo [!] Python 3 was not detected on your PC.
            echo [*] Installing Python 3.12 automatically for you, please wait...
            where winget >nul 2>nul
            if !ERRORLEVEL! EQU 0 (
                winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
            ) else (
                echo Downloading official Python 3.12 installer from python.org...
                powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' -OutFile '%TEMP%\python312.exe'"
                echo Installing Python 3.12...
                "%TEMP%\python312.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 SimpleInstall=1
                del /f /q "%TEMP%\python312.exe" 2>nul
            )
            if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
                set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;!PATH!"
            ) else if exist "%ProgramFiles%\Python312\python.exe" (
                set "PATH=%ProgramFiles%\Python312;%ProgramFiles%\Python312\Scripts;!PATH!"
            )
        )
    )

    where python >nul 2>nul
    if !ERRORLEVEL! EQU 0 (
        echo [*] Installing Python engine dependencies (pip)...
        python -m pip install --upgrade pip --quiet --disable-pip-version-check
        python -m pip install -r engine\requirements.txt --disable-pip-version-check
        echo [OK] Python engine dependencies installed!
        powershell -NoProfile -Command "(Get-Command python.exe).Source | Set-Content -Path 'engine\python_path.txt' -Force" 2>nul
    ) else (
        echo [!] Python could not be detected. Mark-LV engine features will be limited until Python 3.12 is installed.
    )
    echo.
)

:: 4. Build Baymax
echo [*] Building Baymax...
call npm run build

:: 5. Create Desktop Shortcut pointing directly to electron.exe
powershell -NoProfile -Command "$wsh = New-Object -ComObject WScript.Shell; $s = $wsh.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Baymax.lnk')); $electron = [System.IO.Path]::Combine('%~dp0', 'node_modules\electron\dist\electron.exe'); if (Test-Path $electron) { $s.TargetPath = $electron; $s.Arguments = '.' } else { $s.TargetPath = 'cmd.exe'; $s.Arguments = '/c \"\"%~dp0Launch Baymax.bat\"\"' }; $s.WorkingDirectory = '%~dp0'; if (Test-Path '%~dp0public\icons\icon.ico') { $s.IconLocation = '%~dp0public\icons\icon.ico,0' }; $s.Description = 'Baymax — Autonomous AI Desktop Companion & Productivity Engine'; $s.Save()" >nul 2>nul
powershell -NoProfile -Command "$wsh = New-Object -ComObject WScript.Shell; $s = $wsh.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Mochi Ultra.lnk')); $electron = [System.IO.Path]::Combine('%~dp0', 'node_modules\electron\dist\electron.exe'); if (Test-Path $electron) { $s.TargetPath = $electron; $s.Arguments = '.' } else { $s.TargetPath = 'cmd.exe'; $s.Arguments = '/c \"\"%~dp0Launch Baymax.bat\"\"' }; $s.WorkingDirectory = '%~dp0'; if (Test-Path '%~dp0public\icons\icon.ico') { $s.IconLocation = '%~dp0public\icons\icon.ico,0' }; $s.Description = 'Baymax — Autonomous AI Desktop Companion'; $s.Save()" >nul 2>nul

echo.
echo ===================================================
echo   [SUCCESS] Baymax is installed and ready!
echo   A desktop shortcut 'Baymax' has been created.
echo ===================================================
echo.
echo Starting Baymax now...
if exist "%~dp0node_modules\electron\dist\electron.exe" (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
) else (
    start "" "%~dp0Launch Baymax.bat"
)
exit
