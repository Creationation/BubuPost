' Lance le watcher sans fenetre. Le suivi se lit dans l application, onglet Auto.
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c """ & Replace(WScript.ScriptFullName, "demarrer-cache.vbs", "demarrer-cache.bat") & """", 0, False
