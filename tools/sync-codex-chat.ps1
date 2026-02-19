# Define source and destination paths
$sourceFolder = Join-Path $env:USERPROFILE ".codex"
$folderCopy = "./tools/.codex-copy"
$destinationZip = "./tools/.codex.zip"

Copy-Item -Recurse -Force $sourceFolder $folderCopy

# Check if source folder exists
if (-Not (Test-Path $sourceFolder)) {
    Write-Error "Source folder not found: $sourceFolder"
    exit 1
}

# Remove existing zip if it exists
if (Test-Path $destinationZip) {
    Remove-Item $destinationZip -Force
}

# Create zip file
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($folderCopy, $destinationZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Remove-Item -Recurse $folderCopy

Write-Host "Successfully created: $destinationZip"

