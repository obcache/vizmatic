# Define source and destination paths
$projectPath = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$destinationFolder = Join-Path $env:USERPROFILE ".codex"
$sourceZip = Join-Path $projectPath "/tools/project-mgmt/.codex.zip"

# Check if source folder exists
if (-Not (Test-Path $sourceZip)) {
    Write-Error "Source zip file not found: $sourceZip"
    exit 1
}


# Create zip file
Expand-Archive -Path $sourceZip -DestinationPath $destinationFolder -Force
Remove-Item -Path $sourceZip -Force
Write-Host "Successfully extracted: $sourceZip to $destinationFolder"

