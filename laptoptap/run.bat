@echo off
title LaptopTap Launcher
cd /d "%~dp0"
echo Starting LaptopTap...
py -3.12 main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo LaptopTap exited with error. Trying standard python...
    python main.py
)
pause
