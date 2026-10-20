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
New-Item -ItemType Directory -Force -Path $distDir, (Join-Path $distDir "blog"), (Join-Path $distDir "en"), (Join-Path $distDir "en\blog"), (Join-Path $distDir "assets"), (Join-Path $distDir ".well-known") | Out-Null

# Copy HTML, CSS & JS
if (Test-Path (Join-Path $srcDir "*.html")) {
    Copy-Item -Path (Join-Path $srcDir "*.html") -Destination $distDir -Force
}
Copy-Item -Path (Join-Path $srcDir "style.css") -Destination (Join-Path $distDir "style.css") -Force
if (Test-Path (Join-Path $srcDir "*.js")) {
    Copy-Item -Path (Join-Path $srcDir "*.js") -Destination $distDir -Force
}

# Copy Widget files
if (Test-Path (Join-Path $srcDir "widget")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $distDir "widget") | Out-Null
    Copy-Item -Path (Join-Path $srcDir "widget\*") -Destination (Join-Path $distDir "widget\") -Recurse -Force
}

# Copy English (EN) files
if (Test-Path (Join-Path $srcDir "en")) {
    Copy-Item -Path (Join-Path $srcDir "en\*") -Destination (Join-Path $distDir "en\") -Recurse -Force
}

# Copy Blog files
Copy-Item -Path (Join-Path $srcDir "blog\*") -Destination (Join-Path $distDir "blog\") -Recurse -Force

# Copy Assets
Copy-Item -Path (Join-Path $srcDir "assets\*") -Destination (Join-Path $distDir "assets\") -Recurse -Force

# Copy Favicons at Root
if (Test-Path (Join-Path $srcDir "favicon*.*")) {
    Copy-Item -Path (Join-Path $srcDir "favicon*.*") -Destination $distDir -Force
}

# Copy OG Images at Root
if (Test-Path (Join-Path $srcDir "og-image*.*")) {
    Copy-Item -Path (Join-Path $srcDir "og-image*.*") -Destination $distDir -Force
}

# Copy GEO / AI Crawler, Agent Readiness & IndexNow Key text files
if (Test-Path (Join-Path $srcDir "*.txt")) {
    Copy-Item -Path (Join-Path $srcDir "*.txt") -Destination $distDir -Force
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
    if (Test-Path (Join-Path $srcDir ".well-known")) {
        Copy-Item -Path (Join-Path $srcDir "openapi.json") -Destination (Join-Path $srcDir ".well-known\openapi.json") -Force
    }
}
if (Test-Path (Join-Path $srcDir ".well-known")) {
    # Normalize SKILL.md files to LF and auto-compute SHA-256 digests for Agent Skills Discovery 0.2.0
    $skillsMeta = @(
        @{
            name = "zalo-chat-automation"
            type = "skill-md"
            description = "Automated conversational replies on personal Zalo accounts using connected AI models (Google Gemini, DeepSeek, OpenAI, Ollama) via Zalo-Flow Local-First Runtime."
            relPath = ".well-known/agent-skills/zalo-chat-automation/SKILL.md"
        },
        @{
            name = "zalo-crm-remarketing"
            type = "skill-md"
            description = "Customer segmentation, colored tag management, bidirectional Chatwoot CRM sync, and scheduled 1-to-1 or broadcast remarketing campaigns with Spintax templates."
            relPath = ".well-known/agent-skills/zalo-crm-remarketing/SKILL.md"
        },
        @{
            name = "anti-ban-delivery"
            type = "skill-md"
            description = "Three-layer anti-ban protection for personal Zalo automation including Token Bucket rate limiting, Self-Echo Shield, and Inbound Flood Detection."
            relPath = ".well-known/agent-skills/anti-ban-delivery/SKILL.md"
        }
    )
    $skillEntries = @()
    foreach ($sm in $skillsMeta) {
        $skillFile = Join-Path $srcDir ($sm.relPath -replace '/', '\')
        if (Test-Path $skillFile) {
            $rawText = [System.IO.File]::ReadAllText($skillFile, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"
            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($skillFile, $rawText, $utf8NoBom)
            $bytes = [System.IO.File]::ReadAllBytes($skillFile)
            $sha256 = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
            $skillEntries += [ordered]@{
                name = $sm.name
                type = $sm.type
                description = $sm.description
                url = "https://aizalo.com/$($sm.relPath)"
                digest = "sha256:$sha256"
            }
        }
    }
    $indexObj = [ordered]@{
        '$schema' = "https://schemas.agentskills.io/discovery/0.2.0/schema.json"
        skills = $skillEntries
    }
    $indexJson = ($indexObj | ConvertTo-Json -Depth 5) -replace "`r`n", "`n"
    $indexFile = Join-Path $srcDir ".well-known\agent-skills\index.json"
    [System.IO.File]::WriteAllText($indexFile, $indexJson + "`n", (New-Object System.Text.UTF8Encoding($false)))

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
