# Define source and destination paths
$destinationFolder = Join-Path $env:USERPROFILE ".codex"
$sourceZip = "./tools/.codex.zip"


# Check if source folder exists
if (-Not (Test-Path $sourceZip)) {
    Write-Error "Source zip file not found: $sourceZip"
    exit 1
}


# Create zip file
Expand-Archive -Path $sourceZip -DestinationPath $destinationFolder -Force

Write-Host "Successfully extracted: $sourceZip to $destinationFolder"

