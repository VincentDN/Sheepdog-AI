' Starts the Sheepdog service with no console window.
' Used by the Startup shortcut created by install-autostart.ps1.
Dim shell, fso, here, serviceDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
serviceDir = fso.BuildPath(fso.GetParentFolderName(here), "service")

shell.CurrentDirectory = serviceDir
shell.Run "node src\index.js", 0, False
