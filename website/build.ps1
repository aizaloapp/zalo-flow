# Build Script for Zalo-Flow Website (Cloudflare Pages)
[CmdletBinding()]
param(
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir = Join-Path $scriptDir "src"
$distDir = Join-Path $scriptDir "dist"

Write-Host "Starting build for Zalo-Flow Website (Cloudflare Pages)..." -ForegroundColor Cyan

# Ensure dist directories exist
New-Item -ItemType Directory -Force -Path $distDir, (Join-Path $distDir "blog"), (Join-Path $distDir "assets"), (Join-Path $distDir ".well-known") | Out-Null

# Copy HTML, CSS & JS
Copy-Item -Path (Join-Path $srcDir "index.html") -Destination (Join-Path $distDir "index.html") -Force
Copy-Item -Path (Join-Path $srcDir "404.html") -Destination (Join-Path $distDir "404.html") -Force
Copy-Item -Path (Join-Path $srcDir "style.css") -Destination (Join-Path $distDir "style.css") -Force
if (Test-Path (Join-Path $srcDir "*.js")) {
    Copy-Item -Path (Join-Path $srcDir "*.js") -Destination $distDir -Force
}

# Copy Blog files
Copy-Item -Path (Join-Path $srcDir "blog\*") -Destination (Join-Path $distDir "blog\") -Recurse -Force

# Copy Assets
Copy-Item -Path (Join-Path $srcDir "assets\*") -Destination (Join-Path $distDir "assets\") -Recurse -Force

# Copy Favicons at Root
if (Test-Path (Join-Path $srcDir "favicon*.*")) {
    Copy-Item -Path (Join-Path $srcDir "favicon*.*") -Destination $distDir -Force
}

# Copy GEO / AI Crawler & Agent Readiness files
if (Test-Path (Join-Path $srcDir "llms*.txt")) {
    Copy-Item -Path (Join-Path $srcDir "llms*.txt") -Destination $distDir -Force
}
if (Test-Path (Join-Path $srcDir "_headers")) {
    Copy-Item -Path (Join-Path $srcDir "_headers") -Destination $distDir -Force
}
if (Test-Path (Join-Path $srcDir "_redirects")) {
    Copy-Item -Path (Join-Path $srcDir "_redirects") -Destination $distDir -Force
}
if (Test-Path (Join-Path $srcDir "_worker.js")) {
    Copy-Item -Path (Join-Path $srcDir "_worker.js") -Destination $distDir -Force
}
if (Test-Path (Join-Path $srcDir "robots.txt")) {
    Copy-Item -Path (Join-Path $srcDir "robots.txt") -Destination $distDir -Force
}
if (Test-Path (Join-Path $srcDir "sitemap.xml")) {
    Copy-Item -Path (Join-Path $srcDir "sitemap.xml") -Destination $distDir -Force
}
if (Test-Path (Join-Path $srcDir "*.md")) {
    Copy-Item -Path (Join-Path $srcDir "*.md") -Destination $distDir -Force
}
if (Test-Path (Join-Path $srcDir "openapi.json")) {
    Copy-Item -Path (Join-Path $srcDir "openapi.json") -Destination $distDir -Force
}
if (Test-Path (Join-Path $srcDir ".well-known")) {
    Copy-Item -Path (Join-Path $srcDir ".well-known\*") -Destination (Join-Path $distDir ".well-known\") -Recurse -Force
}

$distFiles = Get-ChildItem -Path $distDir -Recurse -File
Write-Host "Build completed successfully! Total $($distFiles.Count) files in dist/" -ForegroundColor Green

if ($DryRun) {
    Write-Host "[DRY-RUN] Manifest of built files in dist/:" -ForegroundColor Magenta
    $distFiles | ForEach-Object { Write-Host "  - $($_.FullName.Replace($distDir, 'dist'))" }
} else {
    Write-Host "Ready for deployment: npx wrangler pages deploy website/dist --project-name aizalo-portal" -ForegroundColor Yellow
}
