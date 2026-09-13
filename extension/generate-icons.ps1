Add-Type -AssemblyName System.Drawing

$iconDir = Join-Path $PSScriptRoot "assets\icons"
if (-not (Test-Path $iconDir)) {
    New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
}

$srcPath = Resolve-Path (Join-Path $PSScriptRoot "..\public\favicon.png")
$src = [System.Drawing.Image]::FromFile($srcPath)

$sizes = @(16, 32, 48, 128)
foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $sz, $sz
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $sz, $sz)
    $outPath = Join-Path $iconDir "icon-$sz.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Created $outPath"
}

$src.Dispose()
Write-Host "✅ Icons generated successfully!"
