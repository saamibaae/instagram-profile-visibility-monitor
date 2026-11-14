@echo off
echo Removing Windows Task Scheduler task "InstagramProfileMonitor"...
schtasks /delete /tn "InstagramProfileMonitor" /f
pause
