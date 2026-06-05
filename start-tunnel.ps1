# start-tunnel.ps1 - Starts a Cloudflare quick tunnel pointing to the local API
# and updates WEBHOOK_BASE_URL in apps/api/.env automatically.
#
# Usage: .\start-tunnel.ps1
# Stop:  Ctrl+C

$CloudflaredExe = Join-Path $PSScriptRoot "cloudflared.exe"
$EnvFile = Join-Path $PSScriptRoot "apps\api\.env"
$ApiPort = 3001

if (-not (Test-Path $CloudflaredExe)) {
    Write-Host "[INFO] cloudflared.exe not found. Downloading..." -ForegroundColor Yellow
    Invoke-WebRequest `
        -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
        -OutFile $CloudflaredExe `
        -UseBasicParsing
    Write-Host "[OK] Downloaded cloudflared.exe" -ForegroundColor Green
}

Write-Host ""
Write-Host "[INFO] Starting Cloudflare Quick Tunnel -> http://localhost:$ApiPort ..." -ForegroundColor Cyan

# Start cloudflared, capturing stderr where the tunnel URL is printed
$tempLog = [System.IO.Path]::GetTempFileName()

$proc = Start-Process `
    -FilePath $CloudflaredExe `
    -ArgumentList "tunnel", "--url", "http://localhost:$ApiPort" `
    -NoNewWindow -PassThru -RedirectStandardError $tempLog

Write-Host "[INFO] Waiting for tunnel URL (up to 30s)..." -ForegroundColor Gray

$tunnelUrl = $null
$waited = 0
while ($waited -lt 30) {
    Start-Sleep -Seconds 1
    $waited++
    if (Test-Path $tempLog) {
        $content = Get-Content $tempLog -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
            $tunnelUrl = $Matches[0]
            break
        }
    }
}

if (-not $tunnelUrl) {
    Write-Host "[ERROR] Could not detect tunnel URL after 30s." -ForegroundColor Red
    Write-Host "        Check cloudflared output manually." -ForegroundColor Red
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    exit 1
}

Write-Host ""
Write-Host "[OK] Tunnel URL  : $tunnelUrl" -ForegroundColor Green
Write-Host "[OK] Webhook URL : $tunnelUrl/billing/webhooks/mongike" -ForegroundColor Green

# Update .env file
if (Test-Path $EnvFile) {
    $envContent = Get-Content $EnvFile -Raw

    if ($envContent -match 'WEBHOOK_BASE_URL=') {
        $envContent = $envContent -replace 'WEBHOOK_BASE_URL=[^\r\n]*', "WEBHOOK_BASE_URL=$tunnelUrl"
    } else {
        $envContent = $envContent.TrimEnd() + "`r`nWEBHOOK_BASE_URL=$tunnelUrl`r`n"
    }

    Set-Content -Path $EnvFile -Value $envContent -NoNewline
    Write-Host "[OK] Updated WEBHOOK_BASE_URL in apps/api/.env" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[!]  Restart the API server for the change to take effect:" -ForegroundColor Yellow
    Write-Host "     pnpm --filter @webtoapp/api dev" -ForegroundColor White
} else {
    Write-Host "[WARN] .env not found at: $EnvFile" -ForegroundColor Yellow
    Write-Host "       Manually set: WEBHOOK_BASE_URL=$tunnelUrl" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[INFO] Tunnel is running. Press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host ""

# Keep the script alive while the tunnel process runs
try {
    Wait-Process -Id $proc.Id -ErrorAction SilentlyContinue
} catch {
    # Ctrl+C or process exited
}

# Cleanup: remove WEBHOOK_BASE_URL from .env when tunnel stops
if (Test-Path $EnvFile) {
    $envContent = Get-Content $EnvFile -Raw
    $envContent = $envContent -replace 'WEBHOOK_BASE_URL=[^\r\n]*[\r\n]*', ''
    Set-Content -Path $EnvFile -Value $envContent -NoNewline
    Write-Host ""
    Write-Host "[INFO] Removed WEBHOOK_BASE_URL from .env (tunnel stopped)." -ForegroundColor Gray
}
