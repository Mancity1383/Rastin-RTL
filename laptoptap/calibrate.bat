@echo off
title LaptopTap Personal Calibration Wizard
cd /d "%~dp0"
echo ============================================================
echo   Starting LaptopTap Personal Calibration Wizard...
echo ============================================================
echo.
py -3.12 calibrate.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Trying standard python...
    python calibrate.py
)
pause
