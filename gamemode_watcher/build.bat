@echo off
REM Build single-file exe via PyInstaller.
REM Output: dist\GameModeWatcher.exe (no console, tray-app windowed mode)

setlocal
cd /d "%~dp0"

REM Use the Python scripts dir that has pyinstaller.exe even if not on PATH.
set "PYI=%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\LocalCache\local-packages\Python313\Scripts\pyinstaller.exe"

if not exist "%PYI%" (
    echo Falling back to: python -m PyInstaller
    set "PYI=python -m PyInstaller"
)

%PYI% ^
    --name GameModeWatcher ^
    --onefile ^
    --windowed ^
    --noconfirm ^
    --clean ^
    gamemode_watcher.py

if errorlevel 1 (
    echo BUILD FAILED
    exit /b 1
)

echo.
echo Built: %~dp0dist\GameModeWatcher.exe
endlocal
