@echo off
echo ========================================================
echo   Setting up Windows Task Scheduler for Instagram Monitor
echo ========================================================
echo Task will start silently on user logon.
schtasks /create /tn "InstagramProfileMonitor" /tr "wscript.exe \"%~dp0run-background.vbs\"" /sc onlogon /f
if %ERRORLEVEL% EQU 0 (
  echo [x] Successfully registered Task Scheduler task "InstagramProfileMonitor"
  echo It will automatically start in the background when you log in.
) else (
  echo [!] Failed to register Task Scheduler task. Try running as administrator.
)
pause
