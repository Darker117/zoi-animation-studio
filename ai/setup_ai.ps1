# Sets up Studio's text-to-motion AI (MSFlow) in this folder:
#   runtime\python   private Python 3.12 (installed by uv, nothing touches the system Python)
#   runtime\venv     PyTorch (NVIDIA GPU build when the PC has a supported card, otherwise CPU) and packages
#   models\          MSFlow weights and the DistilBERT text encoder, pinned and checked by SHA-256
# then runs a short self-test generation. Safe to run again: finished steps are skipped and
# interrupted downloads resume.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ai\setup_ai.ps1 [-Device auto|cuda|cpu]
#
# Progress lines for the installer look like "@@ <percent> <message>"; the same progress is written
# to runtime\setup_status.json for the studio.
param(
  [string]$AiDir = $PSScriptRoot,
  [ValidateSet('auto', 'cuda', 'cpu')][string]$Device = 'auto'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Runtime = Join-Path $AiDir 'runtime'
$Models = Join-Path $AiDir 'models'
$Venv = Join-Path $Runtime 'venv'
$Python = Join-Path $Venv 'Scripts\python.exe'
$Cache = Join-Path $Runtime 'uv-cache'
$StatusFile = Join-Path $Runtime 'setup_status.json'
$Log = Join-Path $Runtime 'setup.log'
$TorchVersion = '2.7.1'
New-Item -ItemType Directory -Force -Path $Runtime, $Models | Out-Null
"Studio AI setup $(Get-Date -Format s)" | Set-Content -Encoding UTF8 $Log

function Write-Status([string]$state, [int]$percent, [string]$message) {
  $json = @{ state = $state; percent = $percent; message = $message; time = (Get-Date -Format s) } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($StatusFile, $json, (New-Object Text.UTF8Encoding($false)))
}
function Report([int]$percent, [string]$message) {
  [Console]::Out.WriteLine("@@ $percent $message")
  [Console]::Out.Flush()
  Add-Content -Encoding UTF8 $Log "[$percent%] $message"
  Write-Status 'running' $percent $message
}
function Fail([string]$message) {
  [Console]::Out.WriteLine("@@ERROR $message")
  [Console]::Out.Flush()
  Add-Content -Encoding UTF8 $Log "ERROR $message"
  Write-Status 'error' 0 $message
  exit 1
}
function Get-FolderBytes([string]$dir) {
  if (-not (Test-Path $dir)) { return 0 }
  $sum = 0
  foreach ($f in [IO.Directory]::EnumerateFiles($dir, '*', [IO.SearchOption]::AllDirectories)) { try { $sum += (New-Object IO.FileInfo $f).Length } catch { } }
  return $sum
}

# Runs a program hidden, reporting progress from a callback while it works. Returns the exit code.
function Invoke-Step([string]$exe, [string[]]$arguments, [scriptblock]$onTick) {
  $out = Join-Path $Runtime 'step.out'; $err = Join-Path $Runtime 'step.err'
  $quoted = $arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }
  $p = Start-Process -FilePath $exe -ArgumentList ($quoted -join ' ') -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $p.Handle   # without this, PowerShell loses the exit code of processes started this way
  while (-not $p.HasExited) { if ($onTick) { & $onTick }; Start-Sleep -Milliseconds 1500 }
  $p.WaitForExit()
  foreach ($logFile in $out, $err) { if (Test-Path $logFile) { Get-Content $logFile | Add-Content -Encoding UTF8 $Log } }
  return [int]$p.ExitCode
}

try {
  # ---------------------------------------------------------------- tools and hardware
  Report 1 'Checking this PC'
  $uv = Join-Path $AiDir 'bin\uv.exe'
  if (-not (Test-Path $uv)) { $cmd = Get-Command uv -ErrorAction SilentlyContinue; if ($cmd) { $uv = $cmd.Source } else { Fail 'The uv tool is missing (ai\bin\uv.exe). Please reinstall Studio.' } }
  $curl = Join-Path $env:WINDIR 'System32\curl.exe'
  if (-not (Test-Path $curl)) { Fail 'curl.exe is missing (it ships with Windows 10 1803 and later).' }

  $index = 'cpu'; $gpuName = $null
  if ($Device -ne 'cpu') {
    $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'NVIDIA' })
    if ($gpus.Count) {
      $gpuName = ($gpus | Select-Object -First 1).Name
      $driver = 0.0
      $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
      if ($smi) { try { $driver = [double](& $smi.Source --query-gpu=driver_version --format=csv,noheader | Select-Object -First 1).Trim() } catch { } }
      $blackwell = [bool]($gpus | Where-Object { $_.Name -match 'RTX 50|RTX PRO|B100|B200' })
      # CUDA 12.8 builds cover every card from RTX 20 to RTX 50 (Blackwell needs them); older drivers get older builds.
      if ($driver -ge 570 -or ($blackwell -and $driver -eq 0)) { $index = 'cu128' }
      elseif ($driver -ge 560) { $index = 'cu126' }
      elseif ($driver -ge 525) { $index = 'cu118' }
      elseif ($driver -eq 0) { $index = 'cu126' }
      if ($Device -eq 'cuda' -and $index -eq 'cpu') { $index = 'cu126' }
    }
  }
  $needGB = if ($index -eq 'cpu') { 3 } else { 8 }
  $drive = (Get-Item $AiDir).PSDrive
  if ($drive -and $drive.Free -and ($drive.Free / 1GB) -lt $needGB) { Fail ("Not enough disk space: the AI needs about $needGB GB free on drive " + $drive.Name + ':.') }
  Add-Content -Encoding UTF8 $Log "GPU: $gpuName; PyTorch build: $index"
  $env:UV_PYTHON_INSTALL_DIR = Join-Path $Runtime 'python'
  $env:UV_CACHE_DIR = $Cache
  $env:UV_PYTHON_PREFERENCE = 'only-managed'
  $env:UV_NO_PROGRESS = '1'

  # ---------------------------------------------------------------- Python
  if (-not (Test-Path $Python)) {
    Report 3 'Installing Python 3.12'
    if ((Invoke-Step $uv @('venv', $Venv, '--python', '3.12')) -ne 0) { Fail 'Could not install Python (see ai\runtime\setup.log).' }
  }

  # ---------------------------------------------------------------- PyTorch (the big one)
  $haveTorch = $false
  try { $v = & $Python -c "import torch; print(torch.__version__)" 2>$null; $haveTorch = ($LASTEXITCODE -eq 0 -and "$v".StartsWith($TorchVersion) -and ("$v".Contains($index) -or ($index -eq 'cpu' -and -not "$v".Contains('+cu')))) } catch { }
  if (-not $haveTorch) {
    $label = if ($index -eq 'cpu') { 'PyTorch (CPU)' } else { "PyTorch for $gpuName" }
    # Unpacked sizes in uv's cache (what we can measure while it downloads and unpacks).
    $expect = @{ cpu = 0.8GB; cu118 = 4.2GB; cu126 = 4.6GB; cu128 = 5.5GB }[$index]
    $start = Get-FolderBytes $Cache
    Report 5 "Downloading $label"
    $tick = { $got = (Get-FolderBytes $Cache) - $start; $pct = 5 + [int](45 * [Math]::Min(1.0, $got / $expect)); Report $pct ("Downloading and unpacking $label ({0:N0}%)" -f (100 * [Math]::Min(1.0, $got / $expect))) }
    $code = Invoke-Step $uv @('pip', 'install', '--python', $Python, "torch==$TorchVersion", '--index-url', "https://download.pytorch.org/whl/$index", '--reinstall-package', 'torch') $tick
    if ($code -ne 0) { Fail 'Downloading PyTorch failed. Check your internet connection and try again (details in ai\runtime\setup.log).' }
  }

  # ---------------------------------------------------------------- other packages
  Report 52 'Installing the AI packages'
  $code = Invoke-Step $uv @('pip', 'install', '--python', $Python, '-r', (Join-Path $AiDir 'requirements.txt'))
  if ($code -ne 0) { Fail 'Installing the AI packages failed (details in ai\runtime\setup.log).' }

  # ---------------------------------------------------------------- model files
  $manifest = Get-Content (Join-Path $AiDir 'models.json') -Raw | ConvertFrom-Json
  $total = ($manifest.files | Measure-Object -Property size -Sum).Sum
  $done = 0
  foreach ($f in $manifest.files) {
    $dest = Join-Path $Models ($f.path -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    $ok = (Test-Path $dest) -and ((Get-Item $dest).Length -eq [long]$f.size) -and ((Get-FileHash -Algorithm SHA256 $dest).Hash -eq $f.sha256.ToUpper())
    if (-not $ok) {
      $part = "$dest.part"
      $name = Split-Path $f.path -Leaf
      $tick = { $got = if (Test-Path $part) { (Get-Item $part).Length } else { 0 }; $pct = 60 + [int](35 * ($done + $got) / $total); $size = if ($f.size -ge 1MB) { " ({0:N0} of {1:N0} MB)" -f ($got / 1MB), ($f.size / 1MB) } else { '' }; Report $pct ("Downloading the AI model: $name" + $size) }
      & $tick
      $code = Invoke-Step $curl @('-L', '--fail', '--retry', '5', '--retry-delay', '3', '-C', '-', '-o', $part, $f.url) $tick
      if ($code -ne 0 -and $code -ne 33) { Fail "Downloading $name failed. Check your internet connection and try again." }
      if ((Get-FileHash -Algorithm SHA256 $part).Hash -ne $f.sha256.ToUpper()) { Remove-Item $part -Force; Fail "$name did not match its checksum and was deleted. Please try again." }
      Move-Item -Force $part $dest
    }
    $done += [long]$f.size
  }

  # ---------------------------------------------------------------- self-test
  Report 96 'Testing the AI (first run takes a moment)'
  $test = & $Python (Join-Path $AiDir 'server.py') --selftest 2>> $Log
  $result = $null
  foreach ($line in @($test)) { if ("$line".StartsWith('{')) { try { $result = $line | ConvertFrom-Json } catch { } } }
  if (-not $result -or -not $result.ok) { Fail ('The AI self-test failed: ' + $(if ($result) { $result.message } else { 'no result' }) + ' (details in ai\runtime\setup.log).') }

  @{ ok = $true; torch = $TorchVersion; build = $index; device = $result.device; gpu = $gpuName; date = (Get-Date -Format s) } | ConvertTo-Json |
    Set-Content -Encoding UTF8 (Join-Path $Runtime 'ready.json')
  # The package cache is only needed while installing.
  try { & $uv cache clean 2>&1 | Out-Null } catch { }
  if (Test-Path $Cache) { Remove-Item -Recurse -Force $Cache -ErrorAction SilentlyContinue }
  Report 100 ('The AI is ready (' + $result.device + ')')
  Write-Status 'done' 100 ('The AI is ready (' + $result.device + ')')
  exit 0
} catch {
  Fail ("Setup stopped: " + $_.Exception.Message)
}
