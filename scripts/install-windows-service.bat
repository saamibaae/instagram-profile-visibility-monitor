@echo off
setlocal
echo ==============================================================
echo   Instagram Profile Visibility Monitor - Windows 24/7 Service
echo ==============================================================
echo.
echo Installing persistent background task using Windows Task Scheduler...
echo (Task Name: InstagramVisibilityMonitor)
echo.

set SCRIPT_DIR=%~dp0
set VBS_PATH=%SCRIPT_DIR%run-background.vbs

if not exist "%VBS_PATH%" (
  echo [ERROR] run-background.vbs not found at %VBS_PATH%!
  pause
  exit /b 1
)

:: Register task to run on system startup with highest privileges
schtasks /Create /TN "InstagramVisibilityMonitor" /TR "wscript.exe \"%VBS_PATH%\"" /SC ONSTART /RL HIGHEST /F

if %ERRORLEVEL% equ 0 (
  echo.
  echo [OK] Windows 24/7 persistent background task successfully registered!
  echo The service will now automatically start at system boot and persist across logoffs.
  echo.
  echo Starting service immediately...
  schtasks /Run /TN "InstagramVisibilityMonitor"
  echo.
  echo To check status: npm run status
  echo To uninstall:    scripts\uninstall-windows-service.bat
) else (
  echo.
  echo [WARNING] Elevated privileges required. If prompted with Access Denied,
  echo right-click this batch file and select "Run as administrator".
)

echo.
pause
