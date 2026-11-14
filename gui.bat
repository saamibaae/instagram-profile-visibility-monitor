@echo off
title Instagram Visibility Monitor - Dashboard
cd /d "%~dp0"

:: Ensure background services are running
wscript.exe "%~dp0scripts\run-background.vbs"
timeout /t 1 /nobreak >nul

:: Open dashboard in browser
start http://localhost:3847/
exit
