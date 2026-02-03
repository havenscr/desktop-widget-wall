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

REM Clean Tauri release folder to force full rebuild with new assets
echo Cleaning previous build...
del /f /q "src-tauri\target\release\Widget Wall.exe" 2>nul
del /f /q "src-tauri\target\release\deps\widget_wall_desktop.exe" 2>nul
rmdir /s /q "src-tauri\target\release\bundle" 2>nul

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
