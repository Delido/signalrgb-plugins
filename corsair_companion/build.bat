@echo off
REM Build single-file exe via PyInstaller.
REM Output: dist\CorsairCompanion.exe (no console, tray-app windowed mode)
REM
REM --add-data bundles the sibling modules so the frozen exe can re-spawn
REM itself in --settings mode and import them. PyInstaller analyzes the
REM main script's imports automatically; explicit --hidden-import only
REM needed for dynamic imports (we don't have any).

setlocal
cd /d "%~dp0"

set "PYI=%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\LocalCache\local-packages\Python313\Scripts\pyinstaller.exe"

if not exist "%PYI%" (
    echo Falling back to: python -m PyInstaller
    set "PYI=python -m PyInstaller"
)

%PYI% ^
    --name CorsairCompanion ^
    --onefile ^
    --windowed ^
    --noconfirm ^
    --clean ^
    corsair_companion.py

if errorlevel 1 (
    echo BUILD FAILED
    exit /b 1
)

echo.
echo Built: %~dp0dist\CorsairCompanion.exe
endlocal
