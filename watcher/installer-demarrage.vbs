' A lancer UNE fois, par double-clic.
' Le watcher demarrera ensuite tout seul a chaque ouverture de session Windows,
' sans fenetre. Son etat se lit dans l application, onglet Auto.
Option Explicit

Dim shell, fso, dossier, demarrage, lien, raccourci
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dossier = fso.GetParentFolderName(WScript.ScriptFullName)
demarrage = shell.SpecialFolders("Startup")
lien = demarrage & "\BubuPost Watcher.lnk"

If Not fso.FileExists(dossier & "\config.json") Then
  MsgBox "Il manque le fichier config.json dans " & dossier & vbCrLf & vbCrLf & _
         "Copie config.exemple.json en config.json et colle le jeton du fichier ACCES.txt.", _
         vbExclamation, "BubuPost"
  WScript.Quit 1
End If

Set raccourci = shell.CreateShortcut(lien)
raccourci.TargetPath = "C:\Windows\System32\wscript.exe"
raccourci.Arguments = """" & dossier & "\demarrer-cache.vbs"""
raccourci.WorkingDirectory = dossier
raccourci.Description = "BubuPost : surveillance du dossier TradeReels"
raccourci.Save

If fso.FileExists(lien) Then
  shell.Run """" & dossier & "\demarrer-cache.vbs""", 0, False
  MsgBox "C est fait." & vbCrLf & vbCrLf & _
         "Le watcher tourne maintenant en arriere-plan et redemarrera avec Windows." & vbCrLf & _
         "Dans l application, onglet Auto, la ligne Dernier passage doit se mettre a jour d ici une minute.", _
         vbInformation, "BubuPost"
Else
  MsgBox "Le raccourci n a pas pu etre cree dans " & demarrage, vbCritical, "BubuPost"
End If
