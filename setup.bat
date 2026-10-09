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

:: Locked dependencies, isolated Python environment, and both frontend builds.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-local.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Setup failed. See the error above. The application was not launched.
    pause
    exit /b 1
)
call npm run app
