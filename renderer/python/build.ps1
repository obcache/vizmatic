Param(
  [string]$Name = "vizmatic-renderer",
  [switch]$OneFile = $true
)

$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "[render-build] $m" -ForegroundColor Cyan }

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
  Write-Warning "pyinstaller not found on PATH. Install with: pip install pyinstaller"
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$entry = Join-Path $root 'main.py'
$distDir = Join-Path $root 'dist'

Info "Entry: $entry"
Info "Output: $distDir"

$args = @('--noconfirm', '--name', $Name, '--distpath', $distDir, '--workpath', (Join-Path $root 'build'), '--specpath', $root)
if ($OneFile) { $args += '--onefile' }

# Optionally bundle ffmpeg/ffprobe if env vars point to local binaries
if ($env:FFMPEG_BIN) { $args += @('--add-binary', "$($env:FFMPEG_BIN);.") }
if ($env:FFPROBE_BIN) { $args += @('--add-binary', "$($env:FFPROBE_BIN);.") }

$args += $entry

Info "pyinstaller $($args -join ' ')"
Push-Location $root
try {
  pyinstaller @args
} finally {
  Pop-Location
}

Info "Done. Artifacts in $distDir"
