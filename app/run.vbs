' Magma Extension: runs boot.ps1 without showing a console window.
' Usage: wscript run.vbs         -> open Magma with the wand
'        wscript run.vbs /repair -> check updates and re-link Magma shortcuts (at logon)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/repair" Then extra = " -Repair"
End If
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\boot.ps1""" & extra, 0, False
