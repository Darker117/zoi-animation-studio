# Builds the Windows installer: dist\Studio-Setup-<version>.exe
#
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
#
# Needs Inno Setup 6.7+ (winget install JRSoftware.InnoSetup). The launcher is compiled with the
# C# compiler that ships with Windows. If studio\assets\logo.png exists it becomes the app and
# installer icon; otherwise Windows' default icons are used.
param([string]$Iscc)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$Root = Split-Path -Parent $PSScriptRoot
$Here = $PSScriptRoot
$Build = Join-Path $Here 'build'
New-Item -ItemType Directory -Force -Path $Build | Out-Null

# Version comes from the helper so the app and the installer always agree.
$Version = ([regex]::Match((Get-Content (Join-Path $Root 'bridge\server.ps1') -Raw), "\`$Version = '([^']+)'")).Groups[1].Value
if (-not $Version) { throw 'Could not read $Version from bridge\server.ps1' }
Write-Host "Studio $Version"

# ------------------------------------------------------------------ images

function Save-Png([System.Drawing.Image]$img, [string]$path) { $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }

function Resize([System.Drawing.Image]$src, [System.Drawing.Rectangle]$crop, [int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), $crop.X, $crop.Y, $crop.Width, $crop.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $g.Dispose()
  return $bmp
}

# Banner across the top of the Welcome and Finish pages (wide crop of the artwork). Several
# sizes let Setup pick the sharpest one for the screen's scaling.
$src = [System.Drawing.Image]::FromFile((Join-Path $Here 'art\banner-source.jpg'))
$crop = New-Object System.Drawing.Rectangle(0, 0, $src.Width, [int]($src.Width / 2.4))
$banners = @()
foreach ($w in 600, 750, 900, 1050, 1200) {
  $b = Resize $src $crop $w ([int]($w / 2.4))
  $p = Join-Path $Build "banner-$w.png"
  Save-Png $b $p; $b.Dispose()
  $banners += $p
}
$src.Dispose()

# Icon and small wizard image from the logo (the head part of the logo artwork).
$logo = Join-Path $Root 'studio\assets\logo.png'
$IconFile = ''
$SmallImages = ''
if (Test-Path $logo) {
  $l = [System.Drawing.Image]::FromFile($logo)
  # The head mark above the STUDIO word; same crop as the studio's favicon (fractions of the image).
  $side = [int]($l.Height * 0.507)
  $head = New-Object System.Drawing.Rectangle([int]($l.Width * 0.3559), [int]($l.Height * 0.1575), $side, $side)
  # ICO entries: 32-bit bitmaps up to 128 px (readable by every Windows component), PNG at 256 px.
  $entries = @()
  foreach ($size in 16, 20, 24, 32, 40, 48, 64, 128, 256) {
    $b = Resize $l $head $size $size
    $ms = New-Object System.IO.MemoryStream
    if ($size -eq 256) {
      $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    } else {
      $w = New-Object System.IO.BinaryWriter($ms)
      $maskRow = [int][Math]::Ceiling($size / 32.0) * 4
      # BITMAPINFOHEADER (height doubled for the AND mask), then bottom-up BGRA rows, then the mask.
      $w.Write([uint32]40); $w.Write([int32]$size); $w.Write([int32]($size * 2)); $w.Write([uint16]1); $w.Write([uint16]32)
      $w.Write([uint32]0); $w.Write([uint32]($size * $size * 4 + $maskRow * $size)); $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)
      for ($y = $size - 1; $y -ge 0; $y--) {
        for ($x = 0; $x -lt $size; $x++) { $c = $b.GetPixel($x, $y); $w.Write([byte]$c.B); $w.Write([byte]$c.G); $w.Write([byte]$c.R); $w.Write([byte]$c.A) }
      }
      $w.Write((New-Object byte[] ($maskRow * $size)))
      $w.Flush()
    }
    $b.Dispose()
    $entries += , @($size, $ms.ToArray())
  }
  $IconFile = Join-Path $Build 'app.ico'
  $fs = [System.IO.File]::Create($IconFile)
  $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$entries.Count)
  $offset = 6 + 16 * $entries.Count
  foreach ($e in $entries) {
    $size = $e[0]; $data = $e[1]
    $bw.Write([byte]($size % 256)); $bw.Write([byte]($size % 256)); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$data.Length); $bw.Write([uint32]$offset)
    $offset += $data.Length
  }
  foreach ($e in $entries) { $bw.Write([byte[]]$e[1]) }
  $bw.Close()
  $small = @()
  foreach ($size in 55, 69, 83, 110) {
    $b = Resize $l $head $size $size
    $p = Join-Path $Build "small-$size.png"
    Save-Png $b $p; $b.Dispose()
    $small += $p
  }
  $SmallImages = $small -join ','
  $l.Dispose()
  Write-Host 'Icon: studio\assets\logo.png'
} else {
  Write-Host 'Icon: studio\assets\logo.png not found, using default icons' -ForegroundColor Yellow
}

# ------------------------------------------------------------------ app (native window)

# The WebView2 SDK files (Microsoft, BSD licence) live in installer\launcher\lib and ship next to the exe.
$lib = Join-Path $Here 'launcher\lib'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$exe = Join-Path $Build 'Studio.exe'
$cscArgs = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', "/out:$exe",
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
  "/r:$lib\Microsoft.Web.WebView2.Core.dll", "/r:$lib\Microsoft.Web.WebView2.WinForms.dll",
  "/win32manifest:$Here\launcher\app.manifest")
if ($IconFile) { $cscArgs += "/win32icon:$IconFile" }
$cscArgs += (Join-Path $Here 'launcher\Launcher.cs')
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw 'App build failed' }
Copy-Item (Join-Path $Here 'launcher\app.config') (Join-Path $Build 'Studio.exe.config') -Force
Copy-Item (Join-Path $lib '*') $Build -Force
Write-Host "App: $exe"

# ------------------------------------------------------------------ uv (installs the AI's Python and packages)

# Official release, checked against its published SHA-256.
$UvVersion = '0.12.17'
$uvDir = Join-Path $Build 'uv'
if (-not (Test-Path (Join-Path $uvDir 'uv.exe'))) {
  New-Item -ItemType Directory -Force -Path $uvDir | Out-Null
  $base = "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"
  $zip = Join-Path $uvDir 'uv.zip'
  & curl.exe -sSfL -o $zip $base
  $want = ((& curl.exe -sSfL "$base.sha256") -split '\s+')[0]
  if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $want.ToUpper()) { throw 'The uv download did not match its checksum' }
  Expand-Archive $zip $uvDir -Force
  Remove-Item $zip
  & curl.exe -sSfL -o (Join-Path $uvDir 'uv-LICENSE-MIT.txt') "https://raw.githubusercontent.com/astral-sh/uv/$UvVersion/LICENSE-MIT"
}
Write-Host "uv: $UvVersion"

# ------------------------------------------------------------------ installer

if (-not $Iscc) {
  $Iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Iscc) { throw 'Inno Setup 6 not found. Install it with: winget install JRSoftware.InnoSetup' }
$defines = @("/DAppVersion=$Version", "/DBannerImages=$($banners -join ',')", "/DSmallImages=$SmallImages", "/DIconFile=$IconFile")
& $Iscc /Qp @defines (Join-Path $Here 'Studio.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed' }
$out = Join-Path $Root "dist\Studio-Setup-$Version.exe"
Write-Host ("Installer: {0} ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB)) -ForegroundColor Green
