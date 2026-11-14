@echo off
setlocal
echo ==============================================================
echo   Uninstalling Instagram Monitor Windows 24/7 Service
echo ==============================================================
echo.

schtasks /Delete /TN "InstagramVisibilityMonitor" /F

if %ERRORLEVEL% equ 0 (
  echo [OK] Scheduled task "InstagramVisibilityMonitor" was successfully removed.
) else (
  echo [INFO] Task was not found or required administrator privileges.
)

echo Stopping any active background processes...
call "%~dp0stop-all.js" 2>nul || node "%~dp0stop-all.js"

echo.
echo [DONE] Service uninstalled cleanly.
pause
