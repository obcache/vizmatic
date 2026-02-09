Param(
  [string]$RendererPath,
  [string]$RendererName = "vizmatic-renderer"
)

$ErrorActionPreference = 'Stop'
function Ok($m){ Write-Host "[ok] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[warn] $m" -ForegroundColor Yellow }
function Err($m){ Write-Host "[err] $m" -ForegroundColor Red }

$thisDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# repo root is two levels up from installer\windows
$repoRoot = (Resolve-Path (Join-Path $thisDir '..\..')).Path

$paths = @{
  ElectronOut = Join-Path $repoRoot 'dist\electron'
  RedistFfmpeg = Join-Path $repoRoot 'vendor\windows\redist\ffmpeg.exe'
  RedistFfprobe = Join-Path $repoRoot 'vendor\windows\redist\ffprobe.exe'
  RedistDir = Join-Path $repoRoot 'vendor\windows\redist'
}

# Resolve renderer exe path with robust fallbacks
$rendererDist = Join-Path $repoRoot 'renderer\python\dist'
$rendererExe = $null
if ($RendererPath) {
  $rp = Resolve-Path -ErrorAction SilentlyContinue $RendererPath
  if ($rp) { $rendererExe = $rp.Path }
} else {
  $candidates = @(
    (Join-Path $rendererDist ("{0}.exe" -f $RendererName)),
    (Join-Path (Join-Path $rendererDist $RendererName) ("{0}.exe" -f $RendererName)),
    (Join-Path $repoRoot (Join-Path 'dist' ("{0}.exe" -f $RendererName))),
    (Join-Path $repoRoot (Join-Path 'dist' (Join-Path $RendererName ("{0}.exe" -f $RendererName))))
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $rendererExe = (Resolve-Path $c).Path; break }
  }
  if (-not $rendererExe -and (Test-Path $rendererDist)) {
    # Last resort: first *.exe in dist matching name fragment
    $probe = Get-ChildItem -Path $rendererDist -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like "*$RendererName*.exe" } |
      Select-Object -First 1
    if ($probe) { $rendererExe = $probe.FullName }
  }
}

$failed = $false

Write-Host "vizmatic Windows installer preflight" -ForegroundColor Cyan
Write-Host "Repo root: $repoRoot"
Write-Host ("Renderer exe: {0}" -f ($(if ($rendererExe) { $rendererExe } else { '(not found yet)' })))
Write-Host "Electron output expected: $($paths.ElectronOut)"
Write-Host "Redist dir: $($paths.RedistDir)"

if ($rendererExe -and (Test-Path $rendererExe)) { Ok "Renderer exe found: $rendererExe" } else { Err "Missing renderer exe. Build with: pip install pyinstaller; powershell -File renderer\python\build.ps1 (or pass -RendererPath)"; $failed=$true }
if (Test-Path $paths.ElectronOut) { Ok "Electron output found: $($paths.ElectronOut)" } else { Warn "Electron output not found: $($paths.ElectronOut). Build with: npm run build" }

if (Test-Path $paths.RedistFfmpeg) { Ok "ffmpeg.exe present" } else { Err "Missing ffmpeg.exe in vendor\\windows\\redist"; $failed=$true }
if (Test-Path $paths.RedistFfprobe) { Ok "ffprobe.exe present" } else { Err "Missing ffprobe.exe in vendor\\windows\\redist"; $failed=$true }

$licenseTxt = Get-ChildItem -Path $paths.RedistDir -Filter *.txt -ErrorAction SilentlyContinue
$licenseMd = Get-ChildItem -Path $paths.RedistDir -Filter *.md -ErrorAction SilentlyContinue
if ($licenseTxt -or $licenseMd) {
  Ok "Found ffmpeg license/readme file(s): $((@($licenseTxt + $licenseMd) | Select-Object -ExpandProperty Name) -join ', ')"
} else {
  Warn "No license/readme files found in vendor\\windows\\redist. Include FFmpeg's LICENSE / COPYING files; installer copies them to {app}\\redist\\licenses."
}

$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($iscc) {
  Ok "Inno Setup compiler (ISCC.exe) found: $($iscc.Source)"
} else {
  Warn "ISCC.exe (Inno Setup) not found on PATH. Install Inno Setup 6 and ensure ISCC.exe is available, or build via the GUI."
}

if ($failed) { exit 1 } else { Ok "Preflight checks passed"; exit 0 }
