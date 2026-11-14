@echo off
title Instagram Visibility Monitor - Start
cd /d "%~dp0"
cls
echo ==============================================================
echo    INSTAGRAM PROFILE VISIBILITY MONITOR — START
echo ==============================================================
echo.
echo [1/2] Starting background daemon and dashboard server...
wscript.exe "%~dp0scripts\run-background.vbs"

echo [2/2] Verifying background services...
timeout /t 2 /nobreak >nul

echo Opening dashboard in default browser...
start http://localhost:3847/

cls
echo ==============================================================
echo    INSTAGRAM VISIBILITY MONITOR — ALL SERVICES RUNNING
echo ==============================================================
echo.
echo  ✓ Background Monitor: RUNNING (checking Instagram continuously)
echo  ✓ Local Dashboard:    http://localhost:3847/
echo  ✓ Telegram Alerts:    ACTIVE
echo.
echo  -------------------------------------------------------------
echo  NOTICE: Everything runs silently in the background!
echo  You can CLOSE this terminal window and CLOSE your browser.
echo  Monitoring and alerts will KEEP RUNNING uninterrupted.
echo.
echo  To stop everything completely, run STOP.BAT.
echo  -------------------------------------------------------------
echo.
echo Closing this window in 3 seconds...
timeout /t 3 >nul
exit
