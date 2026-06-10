@echo off
REM Widget Wall Desktop Launcher
REM Runs the Tauri app in dev mode

cd /d "%~dp0"

REM Add Cargo to PATH if not already present
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

REM Kill any existing instances that might be using port 1420
echo Cleaning up any existing instances...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1420 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)
taskkill /IM "Widget Wall.exe" /F >nul 2>&1
taskkill /IM "widget-wall-desktop.exe" /F >nul 2>&1

REM Wait a moment for cleanup
timeout /t 2 /nobreak >nul

REM Keep frontend deps in sync (fast no-op when already installed).
REM "call" is required - npm is a .cmd, and without call it never returns,
REM so errors would close the window before the pause below.
echo Checking dependencies...
call npm install --no-audit --no-fund

echo Starting Widget Wall...
call npm run tauri dev
pause
