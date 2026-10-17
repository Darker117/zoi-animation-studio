# Cuts the brand marks out of studio\assets\logo.png (white artwork on black) as transparent PNGs:
#   studio\assets\logo-mark.png  the wireframe head (square)
#   studio\assets\wordmark.png   the STUDIO word
# Run again after replacing the logo:  powershell -ExecutionPolicy Bypass -File tools\brand_assets.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$Assets = Join-Path (Split-Path -Parent $PSScriptRoot) 'studio\assets'
$src = New-Object System.Drawing.Bitmap((Join-Path $Assets 'logo.png'))

function Get-Pixels([System.Drawing.Bitmap]$b) {
  $r = New-Object System.Drawing.Rectangle(0, 0, $b.Width, $b.Height)
  $d = $b.LockBits($r, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($d.Stride * $b.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $bytes, 0, $bytes.Length)
  $b.UnlockBits($d)
  return @{ Bytes = $bytes; Stride = $d.Stride }
}

$px = Get-Pixels $src
$W = $src.Width; $H = $src.Height

# Bounding box of the bright artwork inside a band of rows.
function Find-Box([int]$y0, [int]$y1) {
  $minX = $W; $maxX = -1; $minY = $H; $maxY = -1
  for ($y = $y0; $y -lt $y1; $y++) {
    $row = $y * $px.Stride
    for ($x = 0; $x -lt $W; $x++) {
      $i = $row + $x * 4
      if ($px.Bytes[$i + 2] -gt 150) { if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }; if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y } }
    }
  }
  return New-Object System.Drawing.Rectangle($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))
}

# The word sits under the bust; the first fully dark row band between them splits the two.
$head = Find-Box 0 ([int]($H * 0.655))
$word = Find-Box ([int]($H * 0.655)) $H
Write-Host "head $head`nword $word"

# White artwork with alpha from brightness (so it sits cleanly on any dark background).
function Save-Mark([System.Drawing.Rectangle]$box, [int]$pad, [int]$outW, [int]$outH, [string]$name, [bool]$square) {
  if ($square) {
    $side = [Math]::Max($box.Width, $box.Height) + 2 * $pad
    $box = New-Object System.Drawing.Rectangle(($box.X + $box.Width / 2 - $side / 2), ($box.Y + $box.Height / 2 - $side / 2), $side, $side)
  } else {
    $box = New-Object System.Drawing.Rectangle(($box.X - $pad), ($box.Y - $pad), ($box.Width + 2 * $pad), ($box.Height + 2 * $pad))
  }
  $crop = New-Object System.Drawing.Bitmap($box.Width, $box.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $box.Height; $y++) {
    for ($x = 0; $x -lt $box.Width; $x++) {
      $sx = $box.X + $x; $sy = $box.Y + $y
      $l = 0
      if ($sx -ge 0 -and $sy -ge 0 -and $sx -lt $W -and $sy -lt $H) { $l = $px.Bytes[$sy * $px.Stride + $sx * 4 + 2] }
      $a = [Math]::Max(0, [Math]::Min(255, [int](($l - 45) * 255 / 190)))
      $crop.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($a, 255, 255, 255))
    }
  }
  $out = New-Object System.Drawing.Bitmap($outW, $outH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.DrawImage($crop, 0, 0, $outW, $outH)
  $g.Dispose(); $crop.Dispose()
  $out.Save((Join-Path $Assets $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Host "$name ${outW}x$outH"
}

Save-Mark $head 12 160 160 'logo-mark.png' $true
$ratio = ($word.Width + 8) / ($word.Height + 8)
Save-Mark $word 4 ([int](64 * $ratio)) 64 'wordmark.png' $false
$src.Dispose()
