; Studio installer (Inno Setup 6.7+).
; Build with installer\build.ps1, which compiles the launcher, renders the banner and icon, and
; passes them in as defines.

#ifndef AppVersion
  #define AppVersion "1.0.0"
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
AppPublisher=Zoi Animation Framework
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} Setup
; Per-user install: no administrator prompt, lands in %LOCALAPPDATA%\Programs.
PrivilegesRequired=lowest
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
Name: "gamemod"; Description: "Install the Zoi Animation Framework mod into inZOI (experimental: not yet tested in the game)"; GroupDescription: "inZOI:"; Flags: unchecked; Check: InzoiFound

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

[UninstallDelete]
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
