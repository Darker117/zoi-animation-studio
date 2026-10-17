; Studio installer (Inno Setup 6.7+).
; Build with installer\build.ps1, which compiles the launcher, renders the banner and icon, and
; passes them in as defines.

#ifndef AppVersion
  #define AppVersion "1.1.1"
#endif
#ifndef BannerImages
  #define BannerImages "art\banner-source.jpg"
#endif
#ifndef SmallImages
  #define SmallImages ""
#endif
#ifndef IconFile
  #define IconFile ""
#endif

#define AppName "Studio"
#define AppExe "Studio.exe"

[Setup]
AppId={{6F3C1D0B-2E7A-4C4B-9C61-2D7A5E0B9A31}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Zoi Animation Studio
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} Setup
; Per-user install: no administrator prompt, lands in %LOCALAPPDATA%\Programs.
PrivilegesRequired=lowest
; Setup runs ai\setup_ai.ps1, and uv links each Python version folder with a directory junction.
; RedirectionGuard (inherited by child processes) blocks those junctions; it protects elevated
; installs from path-redirection attacks, which do not apply to this per-user, non-admin install.
RedirectionGuard=no
; The install folder keeps its original name, so upgrades land in the same place.
DefaultDirName={autopf}\Zoi Motion Studio
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=Studio-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
; Setup and Uninstall wait for the studio to be closed (the launcher holds this mutex).
AppMutex=ZoiMotionStudio.Running
CloseApplications=no
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
; Look: the studio's dark charcoal, with the banner across the top of Welcome and Finish.
WizardStyle=modern dark includetitlebar hidebevels
; Taller than the default 120,120 so the banner leaves room for the text under it.
WizardSizePercent=120,140
WizardBackColor=#232529
WizardImageBackColor=#232529
WizardImageFile={#BannerImages}
WizardSmallImageFile={#SmallImages}
#if IconFile != ""
SetupIconFile={#IconFile}
#endif

[Messages]
WelcomeLabel1=Welcome to [name]
WelcomeLabel2=Make animations for your Zois: pose them like a doll, set keys on a timeline, act motions out on a webcam, and watch them live in inZOI.%n%nThis installs [name/ver] for your Windows account. Your projects and exports are kept in Documents\Zoi Motion Studio.
FinishedHeadingLabel=[name] is ready
FinishedLabelNoIcons=[name] is installed.
FinishedLabel=[name] is installed. Open it any time from the Start menu.
ClickFinish=

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "gamemod"; Description: "Install the Zoi Animation Studio mod into inZOI (experimental: not yet tested in the game)"; GroupDescription: "inZOI:"; Flags: unchecked; Check: InzoiFound
Name: "aimodel"; Description: "Download the AI for Describe a motion (about 4 GB download and 6.5 GB on disk with an NVIDIA graphics card, about 1 GB without; needs the internet once)"; GroupDescription: "AI:"

[Files]
Source: "build\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\{#AppExe}.config"; DestDir: "{app}"; Flags: ignoreversion
; WebView2 SDK (Microsoft): hosts the studio inside the app window.
Source: "build\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\WebView2-LICENSE.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "build\WebView2-NOTICE.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "..\studio\vendor\three\LICENSE"; DestDir: "{app}\licenses"; DestName: "three.js-LICENSE.txt"; Flags: ignoreversion
Source: "..\studio\*"; DestDir: "{app}\studio"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\bridge\*"; DestDir: "{app}\bridge"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\blender\zoi_motion_bridge.zip"; DestDir: "{app}\blender"; Flags: ignoreversion
Source: "..\blender\README.md"; DestDir: "{app}\blender"; Flags: ignoreversion
Source: "..\docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
; The in-game framework mod. Pack files the studio installs later are left alone (the pack index
; is only written when it is missing, so reinstalling never hides installed packs).
Source: "..\runtime\ZoiAnimFramework\*"; DestDir: "{userdocs}\inZOI\Mods\InGame\ZoiAnimFramework"; Excludes: "ui\zaf\packs\*"; Flags: ignoreversion recursesubdirs createallsubdirs; Tasks: gamemod
Source: "..\runtime\ZoiAnimFramework\ui\zaf\packs\*"; DestDir: "{userdocs}\inZOI\Mods\InGame\ZoiAnimFramework\ui\zaf\packs"; Flags: onlyifdoesntexist uninsneveruninstall; Tasks: gamemod

; Text-to-motion AI (MSFlow). Python, PyTorch and the model files are downloaded by ai\setup_ai.ps1.
Source: "..\ai\server.py"; DestDir: "{app}\ai"; Flags: ignoreversion
Source: "..\ai\setup_ai.ps1"; DestDir: "{app}\ai"; Flags: ignoreversion
Source: "..\ai\models.json"; DestDir: "{app}\ai"; Flags: ignoreversion
Source: "..\ai\requirements.txt"; DestDir: "{app}\ai"; Flags: ignoreversion
Source: "..\ai\msflow\*"; DestDir: "{app}\ai\msflow"; Excludes: "*.pyc,__pycache__"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build\uv\uv.exe"; DestDir: "{app}\ai\bin"; Flags: ignoreversion
Source: "build\uv\uv-LICENSE-MIT.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "Make animations for your Zois"; AppUserModelID: "ZoiAnimationFramework.ZoiMotionStudio"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "Make animations for your Zois"; AppUserModelID: "ZoiAnimationFramework.ZoiMotionStudio"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Open {#AppName}"; Flags: nowait postinstall skipifsilent

[InstallDelete]
; Files and shortcuts from builds named "Zoi Motion Studio".
Type: files; Name: "{app}\ZoiMotionStudio.exe"
Type: files; Name: "{app}\ZoiMotionStudio.exe.config"
Type: files; Name: "{autoprograms}\Zoi Motion Studio.lnk"
Type: files; Name: "{autodesktop}\Zoi Motion Studio.lnk"

[UninstallRun]
; Stop the AI server if it is still running, so its files can be removed.
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Get-CimInstance Win32_Process | Where-Object {{ $_.ExecutablePath -like '{app}\ai\runtime\*' } | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }"""; Flags: runhidden; RunOnceId: "StopStudioAI"
; Remove the AI folder with long-path syntax first: PyTorch's files can sit deeper than the
; 260-character limit the uninstaller's own file removal is subject to.
Filename: "{cmd}"; Parameters: "/c rmdir /s /q ""\\?\{app}\ai"""; Flags: runhidden; RunOnceId: "RemoveStudioAI"

[UninstallDelete]
; The AI's downloaded Python, packages and model files (several GB).
Type: filesandordirs; Name: "{app}\ai"
; Only the app's log and window placement. Saved work (the studio profile in
; %LOCALAPPDATA%\Zoi Motion Studio\WebView2, and Documents\Zoi Motion Studio) stays.
Type: files; Name: "{localappdata}\Zoi Motion Studio\launcher.log"
Type: files; Name: "{localappdata}\Zoi Motion Studio\window.txt"

[Code]
function WebView2Installed: Boolean;
var
  V: String;
begin
  Result := (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) or
             RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V)) and
            (V <> '') and (V <> '0.0.0.0');
end;

{ The app window needs the WebView2 runtime (built into Windows 11). Warn early when it is missing. }
function InitializeSetup: Boolean;
begin
  Result := True;
  if not WebView2Installed then
    Result := MsgBox('Studio needs the Microsoft Edge WebView2 Runtime. It is part of Windows 11 but is missing on this PC.' + #13#10#13#10 +
                     'You can install now and get the runtime from Microsoft afterwards (the app shows the link). Continue?',
                     mbConfirmation, MB_YESNO) = IDYES;
end;

{ ------------------------------------------------------------------ AI download during setup }
var
  AiError: String;

{ setup_ai.ps1 prints "@@ <percent> <message>" lines; show them in Setup's progress bar. }
procedure AiSetupLog(const S: String; const Error, FirstLine: Boolean);
var
  Rest: String;
  P, Pct: Integer;
begin
  if Copy(S, 1, 8) = '@@ERROR ' then
  begin
    AiError := Copy(S, 9, MaxInt);
    Exit;
  end;
  if Copy(S, 1, 3) <> '@@ ' then Exit;
  Rest := Copy(S, 4, MaxInt);
  P := Pos(' ', Rest);
  if P = 0 then Exit;
  Pct := StrToIntDef(Copy(Rest, 1, P - 1), -1);
  if Pct >= 0 then WizardForm.ProgressGauge.Position := Pct;
  WizardForm.FilenameLabel.Caption := Copy(Rest, P + 1, MaxInt);
end;

procedure RunAiSetup;
var
  Code: Integer;
  Ok: Boolean;
begin
  WizardForm.StatusLabel.Caption := 'Setting up the AI for Describe a motion. The download can take a while...';
  WizardForm.FilenameLabel.Caption := '';
  WizardForm.ProgressGauge.Style := npbstNormal;
  WizardForm.ProgressGauge.Min := 0;
  WizardForm.ProgressGauge.Max := 100;
  WizardForm.ProgressGauge.Position := 0;
  AiError := '';
  Ok := False;
  try
    Ok := ExecAndLogOutput(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\ai\setup_ai.ps1') + '"',
      ExpandConstant('{app}\ai'), SW_HIDE, ewWaitUntilTerminated, Code, @AiSetupLog) and (Code = 0);
  except
    AiError := GetExceptionMessage;
  end;
  if not Ok then
  begin
    if AiError = '' then AiError := 'The setup stopped unexpectedly (code ' + IntToStr(Code) + ').';
    Log('AI setup failed: ' + AiError);
    if not WizardSilent then
      MsgBox('Studio is installed, but the AI could not be set up:' + #13#10#13#10 + AiError + #13#10#13#10 +
        'Studio works without it. To try again, open Describe a motion in Studio and choose Download AI model.', mbInformation, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('aimodel') then RunAiSetup;
end;

function InzoiFound: Boolean;
var
  Steam: String;
begin
  Result := DirExists(ExpandConstant('{userdocs}\inZOI'));
  if (not Result) and RegQueryStringValue(HKCU, 'Software\Valve\Steam', 'SteamPath', Steam) then
    Result := FileExists(AddBackslash(Steam) + 'steamapps\common\inZOI\inZOI.exe');
  if not Result then
    Result := FileExists(ExpandConstant('{commonpf32}\Steam\steamapps\common\inZOI\inZOI.exe'));
end;

const
  BannerRatio = 24; { banner width : height = 2.4 : 1, as tenths }

{ Puts the banner across the full width of a Welcome/Finish page and stacks the text under it. }
function PlaceBanner(Img: TBitmapImage; Page: TNewNotebookPage): Integer;
var
  W, H: Integer;
begin
  W := Page.Width;
  H := W * 10 div BannerRatio;
  Img.Anchors := [];
  Img.Stretch := True;
  Img.SetBounds(0, 0, W, H);
  Result := H;
end;

procedure StackText(Ctl: TNewStaticText; Top, Pad, Width: Integer);
begin
  Ctl.Anchors := [];
  Ctl.Left := Pad;
  Ctl.Top := Top;
  Ctl.Width := Width;
  Ctl.AdjustHeight;
end;

procedure InitializeWizard;
var
  Pad, W, Y: Integer;
begin
  Pad := ScaleX(28);

  W := WizardForm.WelcomePage.Width - 2 * Pad;
  Y := PlaceBanner(WizardForm.WizardBitmapImage, WizardForm.WelcomePage) + ScaleY(18);
  StackText(WizardForm.WelcomeLabel1, Y, Pad, W);
  StackText(WizardForm.WelcomeLabel2, WizardForm.WelcomeLabel1.Top + WizardForm.WelcomeLabel1.Height + ScaleY(4), Pad, W);

  W := WizardForm.FinishedPage.Width - 2 * Pad;
  Y := PlaceBanner(WizardForm.WizardBitmapImage2, WizardForm.FinishedPage) + ScaleY(18);
  StackText(WizardForm.FinishedHeadingLabel, Y, Pad, W);
  StackText(WizardForm.FinishedLabel, WizardForm.FinishedHeadingLabel.Top + WizardForm.FinishedHeadingLabel.Height + ScaleY(4), Pad, W);
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Pad: Integer;
begin
  { Setup lays out the "Open ..." checkbox when the Finish page opens; move it under our text. }
  if CurPageID = wpFinished then
  begin
    Pad := ScaleX(28);
    WizardForm.FinishedLabel.AdjustHeight;
    WizardForm.RunList.Anchors := [];
    WizardForm.RunList.SetBounds(Pad, WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(14),
      WizardForm.FinishedPage.Width - 2 * Pad, WizardForm.RunList.Height);
  end;
end;
