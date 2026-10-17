# Rebuilds the studio's posing figures from Blender Studio's "Human Base Meshes" bundle (CC0).
#   1. Download human-base-meshes-bundle-v1.4.1.zip from https://www.blender.org/download/demo-files/#assets
#   2. Unzip it, then run:  powershell -File tools\figures\build_figures.ps1 -Bundle <path>\human_base_meshes_bundle.blend
# Writes studio\assets\characters\zoi-figure-male.glb and zoi-figure-female.glb, plus check renders in -Work.
param(
  [Parameter(Mandatory = $true)][string]$Bundle,
  [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe',
  [string]$Work = (Join-Path $env:TEMP 'zoi-figures')
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'studio\assets\characters'
New-Item -ItemType Directory -Force $Work | Out-Null
foreach ($sex in 'male', 'female') {
  & $Blender -b --factory-startup --disable-autoexec --python (Join-Path $here 'build_figure.py') -- $Bundle $sex (Join-Path $out "zoi-figure-$sex.glb") $Work
  if ($LASTEXITCODE -ne 0) { throw "Blender failed for the $sex figure" }
}
Write-Host "Done. Check renders are in $Work"
