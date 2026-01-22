@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" x64
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
set CARGO_TARGET_DIR=C:\temp\widget-wall-target
cd /d "C:\Users\haven\OneDrive - Havens Consulting Inc\Documents\GitHub\widget-wall-desktop"
npm run tauri dev
