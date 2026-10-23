; DeusEdix's installer (Inno Setup 6). Built by dev\build_installer.py:
;   build\pyi\DeusEdix  the program (PyInstaller)
;   build\release       the editor's code and DeusEdix's UnrealScript (dev\stage.py --clean)
; It installs for the current user only (no administrator rights), in a folder the editor can write in:
; it keeps its caches, its workspace and the user's work next to its code.

#define AppName "DeusEdix"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{4FBB3E78-6DE3-47C5-8026-BE48E53048E1}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion} (preview)
AppPublisher=Gabby
VersionInfoVersion={#AppVersion}
VersionInfoCompany=Gabby
VersionInfoDescription={#AppName} setup
VersionInfoProductName={#AppName}
VersionInfoCopyright=Copyright (c) 2026 Gabby
AppComments=A fan-made map editor for Deus Ex and Deus Ex: Revision. Not affiliated with the Revision team, Eidos or Square Enix.
DefaultDirName={localappdata}\Programs\DeusEdix
DefaultGroupName=DeusEdix
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\build\installer
OutputBaseFilename=DeusEdix-Setup-{#AppVersion}
SetupIconFile=..\launcher\deusedix.ico
UninstallDisplayIcon={app}\DeusEdix.exe
UninstallDisplayName={#AppName}
WizardStyle=modern
WizardSmallImageFile=..\launcher\wizard-small.bmp
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\build\pyi\DeusEdix\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\release\*"; DestDir: "{app}"; Excludes: "UCPortraits.uc,UCVoiceDubs.uc"; Flags: ignoreversion recursesubdirs createallsubdirs
; These are generated from the user's portraits and recordings. Seed a new install only.
Source: "..\build\release\src\DeusEdix\Classes\UCPortraits.uc"; DestDir: "{app}\src\DeusEdix\Classes"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\build\release\src\DeusEdix\Classes\UCVoiceDubs.uc"; DestDir: "{app}\src\DeusEdix\Classes"; Flags: onlyifdoesntexist uninsneveruninstall
; Clean templates are application code, not the user's generated indexes.
Source: "..\build\release\tools\mapkit\project-template\src\DeusEdix\Classes\UCPortraits.uc"; DestDir: "{app}\tools\mapkit\project-template\src\DeusEdix\Classes"; Flags: ignoreversion
Source: "..\build\release\tools\mapkit\project-template\src\DeusEdix\Classes\UCVoiceDubs.uc"; DestDir: "{app}\tools\mapkit\project-template\src\DeusEdix\Classes"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\DeusEdix"; Filename: "{app}\DeusEdix.exe"
Name: "{userprograms}\DeusEdix guide"; Filename: "{app}\docs\guide\guide.html"
Name: "{userdesktop}\DeusEdix"; Filename: "{app}\DeusEdix.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\DeusEdix.exe"; Description: "Start DeusEdix"; Flags: nowait postinstall skipifsilent
Filename: "{app}\docs\guide\guide.html"; Description: "Open the guide"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
; Revision.ini and DeusEx.ini without DeusEdix's lines, the workspace and the caches made from the game removed
; (links to the game's folders are removed as links: the game's own files are never touched)
Filename: "{app}\deusedix-cli.exe"; Parameters: "--uninstall-cleanup"; Flags: runhidden waituntilterminated; RunOnceId: "DeusEdixCleanup"

[UninstallDelete]
; Projects, their registry/manifests, authored maps, and .deusedix-*-ui.json
; are user data: never add them here or to the recursive [Files] payload.
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\webview"
Type: filesandordirs; Name: "{app}\tools\mapkit\__pycache__"
Type: filesandordirs; Name: "{app}\tools\mapkit\editor\__pycache__"
Type: filesandordirs; Name: "{app}\tools\__pycache__"
Type: files; Name: "{app}\deusedix.json"
; the package compiled on the first start (made again from src\DeusEdix whenever needed)
Type: filesandordirs; Name: "{app}\dist"
; the tutorial's copies (made again the next time it starts)
Type: files; Name: "{app}\tools\mapkit\maps\deusedix_tutorial.py"
Type: files; Name: "{app}\tools\mapkit\maps\deusedix_tutorial.edits.json"
Type: files; Name: "{app}\tools\mapkit\story\00_DeusEdix_Tutorial.json"

[Code]
var
  DisclaimerPage: TWizardPage;
  Understood: TNewCheckBox;
  GamePage: TInputDirWizardPage;
  GameStatus: TNewStaticText;

{ what DeusEdix needs: the original game (its engine is the editor's); Revision is optional }
function GameMissing(Dir: String): String;
begin
  Result := '';
  if not FileExists(AddBackslash(Dir) + 'System\Editor.dll') or not FileExists(AddBackslash(Dir) + 'System\DeusEx.exe') then
    Result := 'Deus Ex: Game of the Year Edition';
end;

function HasRevision(Dir: String): Boolean;
begin
  Result := FileExists(AddBackslash(Dir) + 'Revision\System\Revision.exe');
end;

{ the original game from GOG (GOG Galaxy or its offline installer): GOG's registry, then the usual folders }
function GogDir(Dir: String): String;
begin
  Result := '';
  if GameMissing(Dir) = '' then
    Result := Dir;
end;

function FindGog(): String;
var
  Names: TArrayOfString;
  I, R: Integer;
  Root, Name, Dir: String;
begin
  Result := '';
  for R := 0 to 1 do begin
    if R = 0 then Root := 'SOFTWARE\WOW6432Node\GOG.com\Games' else Root := 'SOFTWARE\GOG.com\Games';
    if RegGetSubkeyNames(HKLM, Root, Names) then
      for I := 0 to GetArrayLength(Names) - 1 do
        if RegQueryStringValue(HKLM, Root + '\' + Names[I], 'gameName', Name) and
           (Pos('deus ex', Lowercase(Name)) > 0) and
           RegQueryStringValue(HKLM, Root + '\' + Names[I], 'path', Dir) and (GogDir(Dir) <> '') then begin
          Result := Dir;
          Exit;
        end;
  end;
  Result := GogDir('C:\GOG Games\Deus Ex GOTY');
  if Result = '' then Result := GogDir('C:\GOG Games\Deus Ex');
  if Result = '' then Result := GogDir(ExpandConstant('{commonpf32}\GOG Galaxy\Games\Deus Ex GOTY'));
  if Result = '' then Result := GogDir(ExpandConstant('{commonpf32}\GOG Galaxy\Games\Deus Ex'));
  if Result = '' then Result := GogDir(ExpandConstant('{commonpf32}\GOG.com\Deus Ex GOTY'));
end;

{ Steam's library folders: the Steam folder and the "path" lines of steamapps\libraryfolders.vdf; then GOG }
function FindGame(): String;
var
  Steam, Text, Line, Lib, Candidate: String;
  Lines: TArrayOfString;
  I: Integer;
  Libs: TStringList;
begin
  Result := '';
  Libs := TStringList.Create;
  try
    if RegQueryStringValue(HKCU, 'Software\Valve\Steam', 'SteamPath', Steam) then begin
      StringChangeEx(Steam, '/', '\', True);
      Libs.Add(Steam);
      if LoadStringsFromFile(AddBackslash(Steam) + 'steamapps\libraryfolders.vdf', Lines) then
        for I := 0 to GetArrayLength(Lines) - 1 do begin
          Line := Trim(Lines[I]);
          if Pos('"path"', Line) = 1 then begin
            Text := Trim(Copy(Line, 7, Length(Line)));
            if (Length(Text) > 2) and (Text[1] = '"') then begin
              Lib := Copy(Text, 2, Length(Text) - 2);
              StringChangeEx(Lib, '\\', '\', True);
              Libs.Add(Lib);
            end;
          end;
        end;
    end;
    Libs.Add(ExpandConstant('{commonpf32}\Steam'));
    { a folder with Revision first, else one with the original game }
    for I := 0 to Libs.Count - 1 do begin
      Candidate := AddBackslash(Libs[I]) + 'steamapps\common\Deus Ex';
      if (GameMissing(Candidate) = '') and HasRevision(Candidate) then begin
        Result := Candidate;
        Exit;
      end;
      if (GameMissing(Candidate) = '') and (Result = '') then
        Result := Candidate;
    end;
  finally
    Libs.Free;
  end;
  if Result = '' then
    Result := FindGog();
end;

procedure OpenStore(Sender: TObject);
var
  Code: Integer;
begin
  if TNewStaticText(Sender).Tag = 1 then
    ShellExec('open', 'https://store.steampowered.com/app/6910/', '', '', SW_SHOWNORMAL, ewNoWait, Code)
  else if TNewStaticText(Sender).Tag = 3 then
    ShellExec('open', 'https://www.gog.com/en/game/deus_ex', '', '', SW_SHOWNORMAL, ewNoWait, Code)
  else
    ShellExec('open', 'https://store.steampowered.com/app/397550/', '', '', SW_SHOWNORMAL, ewNoWait, Code);
end;

procedure UpdateGameStatus(Sender: TObject);
var
  Missing: String;
begin
  Missing := GameMissing(GamePage.Values[0]);
  if (Missing = '') and HasRevision(GamePage.Values[0]) then begin
    GameStatus.Caption := 'Found: Deus Ex and Deus Ex: Revision.';
    GameStatus.Font.Color := $00308030;
  end else if Missing = '' then begin
    GameStatus.Caption := 'Found: Deus Ex. Deus Ex: Revision is not here (optional: only maps for Revision need it).';
    GameStatus.Font.Color := $00308030;
  end else begin
    GameStatus.Caption := 'Not found in this folder: ' + Missing + '.';
    GameStatus.Font.Color := clRed;
  end;
end;

function AddLink(Page: TWizardPage; Top, Tag: Integer; Caption: String): TNewStaticText;
begin
  Result := TNewStaticText.Create(Page);
  Result.Parent := Page.Surface;
  Result.Top := Top;
  Result.Caption := Caption;
  Result.Cursor := crHand;
  Result.Font.Color := clBlue;
  Result.Font.Style := [fsUnderline];
  Result.Tag := Tag;
  Result.OnClick := @OpenStore;
end;

procedure InitializeWizard();
var
  Warning, Info: TNewStaticText;
  Found: String;
begin
  { 1. not affiliated, at your own risk }
  DisclaimerPage := CreateCustomPage(wpWelcome, 'Before you install', 'Please read this.');
  Warning := TNewStaticText.Create(DisclaimerPage);
  Warning.Parent := DisclaimerPage.Surface;
  Warning.WordWrap := True;
  Warning.Width := DisclaimerPage.SurfaceWidth;
  Warning.Font.Color := clRed;
  Warning.Font.Style := [fsBold];
  Warning.Caption := 'DeusEdix is a fan-made tool. It is NOT affiliated with, endorsed or supported by the ' +
    'Deus Ex: Revision team (Caustic Creative), Eidos, Square Enix or Ion Storm.' + #13#10#13#10 +
    'Install and use it at your own risk.';
  Info := TNewStaticText.Create(DisclaimerPage);
  Info.Parent := DisclaimerPage.Surface;
  Info.WordWrap := True;
  Info.Width := DisclaimerPage.SurfaceWidth;
  Info.Top := Warning.Top + Warning.Height + ScaleY(16);
  Info.Caption := 'DeusEdix contains nothing of Deus Ex or Revision: it works on your own copy of the game (and of ' +
    'Revision, if you have it), read where Steam or GOG installed it, and never changes its files.' + #13#10#13#10 +
    'When you install a project from the editor, DeusEdix puts its maps in a folder of its own inside the game ' +
    '(DeusEdixProjects, or Revision\DeusEdixProjects) and adds that folder to the game''s settings (DeusEx.ini, ' +
    'or Revision.ini; a backup is kept). Uninstalling DeusEdix takes those lines out.';
  Understood := TNewCheckBox.Create(DisclaimerPage);
  Understood.Parent := DisclaimerPage.Surface;
  Understood.Top := Info.Top + Info.Height + ScaleY(20);
  Understood.Width := DisclaimerPage.SurfaceWidth;
  Understood.Height := ScaleY(24);
  Understood.Caption := 'I understand, and I install DeusEdix at my own risk';

  { 2. the game folder, found through Steam or GOG, or picked }
  GamePage := CreateInputDirPage(DisclaimerPage.ID, 'Deus Ex folder',
    'Where is Deus Ex installed?',
    'DeusEdix needs Deus Ex: Game of the Year Edition, from Steam (steamapps\common\Deus Ex) or GOG. Deus Ex: ' +
    'Revision (Steam) is optional: it installs into the same folder and lets you make maps for Revision too. ' +
    'DeusEdix found the folder by itself if the box below is filled.',
    False, '');
  GamePage.Add('');
  Found := FindGame();
  GamePage.Values[0] := Found;
  GamePage.Edits[0].OnChange := @UpdateGameStatus;
  GameStatus := TNewStaticText.Create(GamePage);
  GameStatus.Parent := GamePage.Surface;
  GameStatus.Top := GamePage.Edits[0].Top + GamePage.Edits[0].Height + ScaleY(12);
  GameStatus.Font.Style := [fsBold];
  AddLink(GamePage, GameStatus.Top + ScaleY(36), 1, 'Get Deus Ex: Game of the Year Edition on Steam');
  AddLink(GamePage, GameStatus.Top + ScaleY(58), 3, 'Get Deus Ex: Game of the Year Edition on GOG');
  AddLink(GamePage, GameStatus.Top + ScaleY(80), 2, 'Get Deus Ex: Revision on Steam (optional)');
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = GamePage.ID then
    UpdateGameStatus(nil);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Missing: String;
begin
  Result := True;
  if CurPageID = DisclaimerPage.ID then begin
    { an unattended install (/SILENT, /VERYSILENT) is consent given on the command line }
    if not WizardSilent() and not Understood.Checked then begin
      SuppressibleMsgBox('Please tick the box to confirm you have read this.', mbInformation, MB_OK, IDOK);
      Result := False;
    end;
  end else if CurPageID = GamePage.ID then begin
    Missing := GameMissing(GamePage.Values[0]);
    if Missing <> '' then
      Result := SuppressibleMsgBox('This folder does not have ' + Missing + '.' + #13#10#13#10 +
        'Install DeusEdix anyway? It will ask for the Deus Ex folder when it starts.',
        mbConfirmation, MB_YESNO, IDYES) = IDYES;
  end;
end;

{ previews of the pages (dev only: ISCC /DPreviewPage=1 opens on the notice, =2 on the game folder) }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
#ifdef PreviewPage
  if PageID = wpWelcome then
    Result := True;
  #if PreviewPage == "2"
  if PageID = DisclaimerPage.ID then
    Result := True;
  #endif
#endif
end;

function JsonText(S: String): String;
begin
  Result := S;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Game: String;
begin
  if CurStep = ssPostInstall then begin
    Game := GamePage.Values[0];
    if GameMissing(Game) <> '' then
      Game := '';
    { no "target": the editor's own workspace is Revision's; each project says which game it is made for }
    SaveStringToFile(ExpandConstant('{app}\deusedix.json'),
      '{"game": "' + JsonText(Game) + '", "package": "DeusEdix", "version": "{#AppVersion}"}', False);
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo,
  MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo + NewLine + NewLine + 'Deus Ex folder:' + NewLine + Space + GamePage.Values[0];
  if MemoTasksInfo <> '' then
    Result := Result + NewLine + NewLine + MemoTasksInfo;
end;
