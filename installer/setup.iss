; Script generated for Zalo-Flow Desktop Edition
; Inno Setup 6.x

#define MyAppName "Zalo-Flow"
#define MyAppVersion "1.2.0"
#define MyAppPublisher "Zalo-Flow Community"
#define MyAppURL "https://github.com/aizaloapp/zalo-flow"
#define MyAppExeName "ZaloFlow-Launcher.vbs"

[Setup]
AppId={{D37E8C21-9B5A-4A23-8B37-129487192A44}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\ZaloFlow
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=ZaloFlow-Setup-v{#MyAppVersion}
SetupIconFile=app.ico
UninstallDisplayIcon={app}\app.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Node.js portable runtime
Source: "tools\node.exe"; DestDir: "{app}"; Flags: ignoreversion
; Application source and assets
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
; Launchers & Control scripts
Source: "ZaloFlow-Launcher.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "Dừng Zalo-Flow.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "app.ico"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\data"
Name: "{app}\sessions"

[Icons]
; Desktop Icon
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon
; Start Menu Icons
Name: "{userprograms}\{#MyAppName}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"
Name: "{userprograms}\{#MyAppName}\Dừng {#MyAppName}"; Filename: "{app}\Dừng Zalo-Flow.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 27
Name: "{userprograms}\{#MyAppName}\Thư Mục Dữ Liệu"; Filename: "{app}\data"
Name: "{userprograms}\{#MyAppName}\Gỡ Cài Đặt {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
; Auto run launcher after installation finished
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: postinstall shellexec skipifsilent

[Code]
// Generate a random 32-character hex string for SESSION_SECRET
function GenerateRandomSecret(): String;
var
  I: Integer;
  Chars: String;
  ResultStr: String;
begin
  Chars := '0123456789abcdef';
  ResultStr := '';
  for I := 1 to 32 do
  begin
    ResultStr := ResultStr + Chars[Random(Length(Chars)) + 1];
  end;
  Result := ResultStr;
end;

// Create default .env file if not already exists
procedure CurStepChanged(CurStep: TSetupStep);
var
  EnvPath: String;
  EnvContent: String;
  Secret: String;
begin
  if CurStep = ssPostInstall then
  begin
    EnvPath := ExpandConstant('{app}\.env');
    if not FileExists(EnvPath) then
    begin
      Secret := GenerateRandomSecret();
      EnvContent := 
        '# Zalo-Flow Desktop Edition Environment Configuration' + #13#10 +
        'PORT=3000' + #13#10 +
        'HOST=127.0.0.1' + #13#10 +
        'ZALOFLOW_PACKAGED=1' + #13#10 +
        'SESSION_SECRET=' + Secret + #13#10 +
        'AUTO_REPLY_ENABLED=false' + #13#10 +
        'CHATWOOT_ENABLED=false' + #13#10;
      SaveStringToFile(EnvPath, EnvContent, False);
    end;
  end;
end;

// Terminate any running Zalo-Flow processes before uninstall
function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  // Call shutdown API and kill any remaining processes in app folder
  Exec('cmd.exe', '/c "' + ExpandConstant('{app}\Dừng Zalo-Flow.bat') + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := True;
end;
