' Windows VBScript to launch background services with zero terminal windows
Set objFSO = CreateObject("Scripting.FileSystemObject")
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strProjectDir = objFSO.GetParentFolderName(strScriptDir)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = strProjectDir

' Launch unified daemon + dashboard server in a single lightweight background process (<35MB RAM, zero window)
WshShell.Run "powershell.exe -NoProfile -WindowStyle Hidden -Command ""Set-Location '" & strProjectDir & "'; Start-Process node -ArgumentList '--expose-gc', '--max-old-space-size=64', '--optimize-for-size', 'daemon/server.js', '--with-scheduler', '--no-open' -WindowStyle Hidden""", 0, True

Set WshShell = Nothing
Set objFSO = Nothing
