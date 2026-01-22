@echo off
REM Widget Wall Desktop Builder
REM Builds the production .exe

cd /d "%~dp0"
echo Building Widget Wall...
echo This may take a few minutes on first build.
echo.

REM Clean dist folder to ensure fresh build (prevents stale files)
if exist "dist" (
    echo Cleaning dist folder...
    rmdir /s /q dist
)

npm run tauri build

if exist "src-tauri\target\release\Widget Wall.exe" (
    echo.
    echo Build complete!
    echo Executable: src-tauri\target\release\Widget Wall.exe
    echo Installer: src-tauri\target\release\bundle\msi\
) else (
    echo.
    echo Build may have failed. Check the output above.
)
pause
