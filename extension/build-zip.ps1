$extensionDir = $PSScriptRoot
$zipOutput = Join-Path $extensionDir "aizalo-flow-companion.zip"

if (Test-Path $zipOutput) {
    Remove-Item $zipOutput -Force
}

$tempDir = Join-Path $env:TEMP ("aizalo_ext_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # Copy essential files
    Copy-Item (Join-Path $extensionDir "manifest.json") $tempDir
    Copy-Item (Join-Path $extensionDir "background") $tempDir -Recurse
    Copy-Item (Join-Path $extensionDir "content") $tempDir -Recurse
    Copy-Item (Join-Path $extensionDir "popup") $tempDir -Recurse
    Copy-Item (Join-Path $extensionDir "assets") $tempDir -Recurse

    # Create ZIP archive
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipOutput -CompressionLevel Optimal

    $zipSize = (Get-Item $zipOutput).Length
    $zipSizeKB = [math]::Round($zipSize / 1024, 2)
    Write-Host "✅ Extension packaged successfully: $zipOutput ($zipSizeKB KB)"
} finally {
    if (Test-Path $tempDir) {
        Remove-Item $tempDir -Recurse -Force
    }
}
