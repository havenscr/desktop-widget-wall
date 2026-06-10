@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" x64
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
set CARGO_TARGET_DIR=C:\temp\widget-wall-target
cd /d "%~dp0"
call npm install --no-audit --no-fund
call npm run tauri dev
pause
