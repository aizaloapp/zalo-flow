# build-local.ps1 - Build Zalo-Flow Windows Installer locally
$ErrorActionPreference = 'Stop'
Write-Host "[Builder] Starting Zalo-Flow Desktop Edition build process..." -ForegroundColor Cyan

$scriptDir = $PSScriptRoot
$toolsDir = Join-Path $scriptDir "tools"
$nodeExe = Join-Path $toolsDir "node.exe"

# 1. Ensure node.exe exists
if (!(Test-Path $nodeExe)) {
    Write-Host "[Builder] Downloading Node.js 22.14.0 LTS Portable..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.14.0/win-x64/node.exe" -OutFile $nodeExe
}

# 2. Locate ISCC.exe
$cmd = Get-Command iscc -ErrorAction SilentlyContinue
$iscc = if ($cmd) { $cmd.Source } else { $null }

if (!$iscc) {
    $potentialPaths = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )
    foreach ($p in $potentialPaths) {
        if (Test-Path $p) { $iscc = $p; break }
    }
}

if (!$iscc) {
    Write-Error "[Builder] Inno Setup Compiler (ISCC.exe) not found. Please install Inno Setup 6."
}

# 3. Compile installer
Write-Host "[Builder] Compiling installer with Inno Setup ($iscc)..." -ForegroundColor Cyan
$issFile = Join-Path $scriptDir "setup.iss"
& $iscc $issFile

$outputExe = Join-Path $scriptDir "output\ZaloFlow-Setup-v1.0.0.exe"
if (Test-Path $outputExe) {
    $sizeMb = [math]::Round(((Get-Item $outputExe).Length / 1MB), 2)
    Write-Host "[Builder] Build successful! Output: $outputExe ($sizeMb MB)" -ForegroundColor Green
} else {
    Write-Error "[Builder] Output installer not found."
}
