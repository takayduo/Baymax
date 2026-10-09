@echo off
title Baymax — Autonomous AI Desktop Companion & Productivity Engine
cd /d "%~dp0"
call npm run build
if errorlevel 1 (
    echo Build failed. Baymax was not launched.
    pause
    exit /b 1
)
if exist "%~dp0node_modules\electron\dist\electron.exe" (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
) else (
    start "" npm run app
)
exit
