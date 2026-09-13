Add-Type -AssemblyName System.Drawing

$storeAssetsDir = Join-Path $PSScriptRoot "store-assets"
if (-not (Test-Path $storeAssetsDir)) {
    New-Item -ItemType Directory -Path $storeAssetsDir -Force | Out-Null
}

# Source image from user upload (showing the Zalo chat interface with AIzalo Companion)
$userUploads = "C:\Users\PC\.gemini\antigravity\brain\21899bda-46cf-4b55-959d-f59fcb292335\.user_uploaded"
$srcFile = Join-Path $userUploads "media_1789261344044.png"

if (-not (Test-Path $srcFile)) {
    # Fallback to the other chat image
    $srcFile = Join-Path $userUploads "media_1789261147495.png"
}

Write-Host "Reading source image: $srcFile"
$srcImg = [System.Drawing.Image]::FromFile($srcFile)

# Target exact size required by Chrome Web Store: 1280x800
$targetW = 1280
$targetH = 800

# Create 24-bit RGB bitmap (PixelFormat: Format24bppRgb, as required: no alpha)
$bmp = New-Object System.Drawing.Bitmap($targetW, $targetH, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Clear with white background
$g.Clear([System.Drawing.Color]::White)

# Scale maintaining aspect ratio or fill canvas
$srcAspect = $srcImg.Width / $srcImg.Height
$targetAspect = $targetW / $targetH

$drawW = $targetW
$drawH = $targetH
$destX = 0
$destY = 0

if ($srcAspect -gt $targetAspect) {
    # Source is wider than target
    $drawH = [int]($targetW / $srcAspect)
    $destY = [int](($targetH - $drawH) / 2)
} else {
    # Source is taller than target
    $drawW = [int]($targetH * $srcAspect)
    $destX = [int](($targetW - $drawW) / 2)
}

$g.DrawImage($srcImg, $destX, $destY, $drawW, $drawH)

$outPath = Join-Path $storeAssetsDir "screenshot-1280x800.png"
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$srcImg.Dispose()

Write-Host "✅ Created 1280x800 Store Screenshot: $outPath"
