@echo off
title Instagram Visibility Monitor - Stop All
cd /d "%~dp0"
cls
node "%~dp0scripts\stop-all.js"
echo.
echo Press any key to close this window...
pause >nul
exit
