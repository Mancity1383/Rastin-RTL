@echo off
chcp 65001 > nul
title LaptopTap - Voice Calibration Wizard
cd /d "%~dp0"
echo ========================================================
echo   LaptopTap Voice Calibration Wizard (100%% Precision)
echo ========================================================
py -3.12 voice_calibrate.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Trying fallback python...
    python voice_calibrate.py
    if %ERRORLEVEL% NEQ 0 (
        C:\Users\Ali\AppData\Local\Programs\Python\Python312\python.exe voice_calibrate.py
    )
)

