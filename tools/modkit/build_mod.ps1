# Studio -> inZOI ModKit: one-click permanent animation mod.
#
# Takes a pack exported by the studio (Animations\*.fbx + zaf_pack.json) and, without opening the
# ModKit window:
#   1. checks the pack (ModKit's bundled Python, a second or two),
#   2. runs the ModKit editor headless to create/update the mod project, import the FBX files onto the
#      Zoi skeleton, make the montages and write the Character Animation rows (about 20-80 s),
#   3. cooks and packages the mod with the ModKit's own PackageUGC automation and installs it into
#      Documents\inZOI\Mods (about 1-2 min).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\modkit\build_mod.ps1 -Pack "<pack folder>"
#     -OutDir <folder>     install somewhere else than Documents\inZOI\Mods
#     -NoPackage           stop after step 2 (the project then also opens in the ModKit as usual)
#     -StatusFile <json>   progress for the studio bridge (state, step, message)
#   powershell -ExecutionPolicy Bypass -File tools\modkit\build_mod.ps1 -ExportZoiSkeleton [-SkeletonOut <fbx>]
#     writes the Zoi body FBX (default Documents\Zoi Motion Studio\Characters) for the studio's
#     Import > Use as character, so packs can be exported bone-for-bone on the Zoi skeleton.
#
# Needs the inZOI ModKit (Epic Games Store). Close the ModKit window first: the build and the editor
# would otherwise write the same project at the same time.

param(
  [string]$Pack,
  [string]$ModKitRoot,
  [string]$OutDir,
  [string]$ModName,
  [string]$Author,
  [string]$StatusFile,
  [switch]$NoPackage,
  [switch]$ExportZoiSkeleton,
  [string]$SkeletonOut,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Utf8 = New-Object Text.UTF8Encoding($false)
$Started = Get-Date
$Docs = [Environment]::GetFolderPath('MyDocuments')

function Write-Status([string]$state, [string]$step, [string]$message, $extra) {
  if ($message) { Write-Host "[$step] $message" }
  if (-not $StatusFile) { return }
  $o = [ordered]@{ state = $state; step = $step; message = $message; pack = $Pack; started = $Started.ToString('o'); updated = (Get-Date).ToString('o') }
  if ($extra) { foreach ($k in $extra.Keys) { $o[$k] = $extra[$k] } }
  New-Item -ItemType Directory -Force -Path (Split-Path $StatusFile) | Out-Null
  [IO.File]::WriteAllText($StatusFile, ($o | ConvertTo-Json -Depth 6), $Utf8)
}

function Fail([string]$step, [string]$message, $extra) {
  Write-Status 'error' $step $message $extra
  Write-Host $message -ForegroundColor Red
  exit 1
}

function Find-ModKit {
  if ($ModKitRoot) { return $ModKitRoot }
  if ($env:ZAF_MODKIT_ROOT) { return $env:ZAF_MODKIT_ROOT }
  $manifests = Join-Path $env:ProgramData 'Epic\EpicGamesLauncher\Data\Manifests'
  if (Test-Path $manifests) {
    foreach ($f in (Get-ChildItem $manifests -Filter '*.item')) {
      try {
        $m = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json
        if ($m.DisplayName -eq 'inZOI ModKit' -and $m.InstallLocation) { return $m.InstallLocation }
      } catch { }
    }
  }
  $guess = Join-Path $Docs 'inZOIModKit'
  if (Test-Path $guess) { return $guess }
  return $null
}

# Runs zaf_modkit.py inside the ModKit editor (no window) and returns its result.json.
function Invoke-ModKitScript([string]$jobFile, [string]$resultFile, [string]$log, [string]$step, [switch]$Rendering) {
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
  $env:ZAF_MODKIT_JOB = $jobFile
  # Forward slashes: the editor reads backslash sequences in -script (e.g. "\tools") as escapes.
  $editorArgs = @($Uproject, '-run=pythonscript', ('-script=' + ($Script -replace '\\', '/')), '-Installed', '-unattended',
    '-nop4', '-nosourcecontrol', '-nosplash', "-abslog=$log")
  if ($Rendering) { $editorArgs += '-AllowCommandletRendering' }   # exporting a skeletal mesh needs a renderer
  $ErrorActionPreference = 'Continue'
  & $EditorCmd @editorArgs 2>&1 | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Remove-Item Env:\ZAF_MODKIT_JOB
  if (-not (Test-Path $resultFile)) { Fail $step "The ModKit stopped before finishing (exit code $code). Log: $log" @{ log = $log } }
  $res = [IO.File]::ReadAllText($resultFile) | ConvertFrom-Json
  if (-not $res.ok) { Fail $step ("The ModKit could not finish: " + $res.error) @{ log = $log } }
  return $res
}

# ------------------------------------------------------------------ locate the ModKit

$root = Find-ModKit
if (-not $root) { Fail 'check' 'The inZOI ModKit is not installed. Install it from the Epic Games Store (free, about 100 GB), then try again.' }
$EditorCmd = Join-Path $root 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$Uproject = Join-Path $root 'inZOIModKit\inZOIModKit.uproject'
$Uat = Join-Path $root 'Engine\Build\BatchFiles\RunUAT.bat'
$Py = Join-Path $root 'Engine\Binaries\ThirdParty\Python3\Win64\python.exe'
foreach ($p in @($EditorCmd, $Uproject, $Uat, $Py)) { if (-not (Test-Path $p)) { Fail 'check' "The ModKit at $root looks incomplete (missing $p). Verify it in the Epic Games Launcher." } }
$Script = Join-Path $PSScriptRoot 'zaf_modkit.py'

$running = @(Get-CimInstance Win32_Process -Filter "Name='UnrealEditor.exe' OR Name='UnrealEditor-Cmd.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*inZOIModKit.uproject*' })
if ($running.Count -gt 0 -and -not $Force) {
  Fail 'check' 'The inZOI ModKit is open. Close it (or wait for its packaging to finish), then try again.'
}

# ------------------------------------------------------------------ Zoi skeleton for the studio

if ($ExportZoiSkeleton) {
  if (-not $SkeletonOut) { $SkeletonOut = Join-Path $Docs 'Zoi Motion Studio\Characters\Zoi body (inZOI ModKit).fbx' }
  $SkeletonOut = [IO.Path]::GetFullPath($SkeletonOut)
  $work = Join-Path $env:TEMP 'ZoiMotionStudio-modkit'
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $job = Join-Path $work 'export_skeleton.json'
  $resultFile = Join-Path $work 'export_skeleton_result.json'
  [IO.File]::WriteAllText($job, (@{ task = 'export_skeleton'; out = $SkeletonOut; result = $resultFile } | ConvertTo-Json), $Utf8)
  Write-Status 'running' 'skeleton' 'Exporting the Zoi body from the ModKit (about a minute)...'
  $res = Invoke-ModKitScript $job $resultFile (Join-Path $work 'export_skeleton.log') 'skeleton' -Rendering
  Write-Status 'done' 'skeleton' "Wrote $($res.fbx). In the studio: Import > Use as character." @{ fbx = $res.fbx }
  exit 0
}

# ------------------------------------------------------------------ 1. check the pack

if (-not $Pack) { Fail 'check' 'Pass -Pack <folder with zaf_pack.json>, or -ExportZoiSkeleton.' }
$Pack = (Resolve-Path $Pack -ErrorAction SilentlyContinue).Path
if (-not $Pack) { Fail 'check' 'The pack folder was not found.' }
if (-not $OutDir) { $OutDir = Join-Path $Docs 'inZOI\Mods' }
$Work = Join-Path $Pack 'modkit_build'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$StateFile = Join-Path $Pack 'modkit_build.json'
$JobFile = Join-Path $Work 'job.json'
$ResultFile = Join-Path $Work 'result.json'
$EditorLog = Join-Path $Work 'modkit_editor.log'
$PackageLog = Join-Path $Work 'modkit_package.log'

$prevPlugin = ''
if (Test-Path $StateFile) { try { $prevPlugin = ([IO.File]::ReadAllText($StateFile) | ConvertFrom-Json).plugin } catch { } }

Write-Status 'running' 'check' 'Checking the pack...'
$planArgs = @('-I', $Script, 'plan', '--pack', $Pack, '--out', $JobFile, '--result', $ResultFile)
if ($ModName) { $planArgs += @('--mod-name', $ModName) }
if ($Author) { $planArgs += @('--author', $Author) }
if ($prevPlugin) { $planArgs += @('--plugin', $prevPlugin) }
$ErrorActionPreference = 'Continue'   # native programs: read exit codes, never throw on stderr
$planOut = @(& $Py @planArgs 2>&1 | ForEach-Object { "$_" })
$planExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$plan = $null
try { $plan = ($planOut | Select-Object -Last 1) | ConvertFrom-Json } catch { }
if ($planExit -ne 0 -or -not $plan -or -not $plan.ok) {
  $msg = if ($plan -and $plan.error) { $plan.error } else { ($planOut -join "`n").Trim() }
  Fail 'check' $msg
}
foreach ($s in $plan.skipped) { Write-Host "  skipped $($s.id): $($s.reason)" -ForegroundColor Yellow }

# ------------------------------------------------------------------ 2. ModKit editor, headless

Write-Status 'running' 'import' "Importing $($plan.animations) animation(s) into the ModKit (about a minute)..."
$result = Invoke-ModKitScript $JobFile $ResultFile $EditorLog 'import'
$plugin = $result.plugin
[IO.File]::WriteAllText($StateFile, (@{ plugin = $plugin; modkit = $root; built = (Get-Date).ToString('o') } | ConvertTo-Json), $Utf8)
foreach ($w in $result.warnings) { Write-Host "  $w" -ForegroundColor Yellow }
foreach ($a in $result.animations) { Write-Host ("  {0}: {1:N2} s, {2} bone tracks" -f $a.anim_id, $a.length, $a.bone_tracks) }

if ($NoPackage) {
  Write-Status 'done' 'import' "Mod project $plugin is ready in the ModKit (not packaged)." @{ plugin = $plugin; project = $result.mod_dir }
  exit 0
}

# ------------------------------------------------------------------ 3. cook + package (the ModKit's PackageUGC)

Write-Status 'running' 'package' 'Cooking and packaging the mod (one to two minutes)...' @{ plugin = $plugin }
$stage = Join-Path (Split-Path $Uproject) "Mods\$plugin"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
# Same arguments as the ModKit's own Package button (see its log), with our install folder.
$uatArgs = "PackageUGC -Prepare=true -ugc_cook -TargetPlatform=Windows -Migration -StagingDirectory=`"$stage`" -ExportToGameMods=`"$OutDir`" -nocompileeditor -skipbuildeditor -installed -NoCompile -NoZenDDC -ddc=NoZenLocalFallback -nocompile -nocompileuat"
$ErrorActionPreference = 'Continue'
& cmd.exe /c "`"$Uat`" $uatArgs > `"$PackageLog`" 2>&1"
$uatExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$installed = Join-Path $OutDir $plugin
if ($uatExit -ne 0 -or -not (Test-Path (Join-Path $installed 'mod_manifest.json'))) {
  Fail 'package' "Packaging failed (exit code $uatExit). Log: $PackageLog" @{ plugin = $plugin; log = $PackageLog }
}

$secs = [int]((Get-Date) - $Started).TotalSeconds
Write-Status 'done' 'package' "Installed $plugin in $OutDir ($secs s). Restart inZOI to load it." @{
  plugin = $plugin; installed = $installed; animations = @($result.animations | ForEach-Object { $_.anim_id }); seconds = $secs
}
Write-Host "Done: $installed" -ForegroundColor Green
exit 0
