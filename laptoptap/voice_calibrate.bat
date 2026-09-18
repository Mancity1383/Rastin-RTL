@echo off
title LaptopTap - Voice Calibration
cd /d "%~dp0"
echo ========================================================
echo   LaptopTap Voice Calibration Wizard
echo ========================================================
py -3.12 voice_calibrate.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Trying fallback python...
    C:\Users\Ali\AppData\Local\Programs\Python\Python312\python.exe voice_calibrate.py
)
pause
