@echo off
title Baymax — Autonomous AI Desktop Companion & Productivity Engine
cd /d "%~dp0"
if not exist "%~dp0dist\index.html" (
    call npm run build
)
if exist "%~dp0node_modules\electron\dist\electron.exe" (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
) else (
    start "" npm run app
)
exit
