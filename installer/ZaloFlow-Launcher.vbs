Option Explicit
Dim fso, shell, appDir, nodeExe, scriptPath, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = appDir & "\node.exe"
scriptPath = appDir & "\src\index.js"

' Use bundled node.exe if present, otherwise fallback to system node
If Not fso.FileExists(nodeExe) Then
    nodeExe = "node"
End If

' Set working directory to appDir
shell.CurrentDirectory = appDir

' Set environment variable for packaged desktop mode
shell.Environment("Process")("ZALOFLOW_PACKAGED") = "1"

' Run node.exe src/index.js completely hidden (0 = hide window, false = non-blocking)
cmd = """" & nodeExe & """ """ & scriptPath & """"
shell.Run cmd, 0, False

Set shell = Nothing
Set fso = Nothing
