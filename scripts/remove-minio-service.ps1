# Force Remove MinIO Service Script
# Removes MinIO service even if marked for deletion (Error 1072)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/remove-minio-service.ps1
# Requires: Administrator privileges

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Force Remove MinIO Service" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Error: This script requires administrator privileges" -ForegroundColor Red
    Write-Host "Please right-click PowerShell and select 'Run as administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Administrator privileges obtained" -ForegroundColor Green
Write-Host ""

# 1. Stop the service if running
Write-Host "1. Stopping MinIO service..." -ForegroundColor Yellow
try {
    $service = Get-Service -Name "MinIO" -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -eq 'Running' -or $service.Status -eq 'Paused') {
            Stop-Service -Name "MinIO" -Force -ErrorAction Stop
            Start-Sleep -Seconds 2
            Write-Host "   Service stopped" -ForegroundColor Green
        } else {
            Write-Host "   Service is already stopped" -ForegroundColor Gray
        }
    } else {
        Write-Host "   Service not found (may already be deleted)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   Warning: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ""

# 2. Try to delete the service
Write-Host "2. Deleting MinIO service..." -ForegroundColor Yellow
$deleteResult = sc.exe delete MinIO 2>&1
$deleteOutput = $deleteResult -join " "

if ($LASTEXITCODE -eq 0) {
    Write-Host "   Service deleted successfully" -ForegroundColor Green
} elseif ($deleteOutput -match "1072" -or $deleteOutput -match "marked for deletion") {
    Write-Host "   Service is marked for deletion (Error 1072)" -ForegroundColor Yellow
    Write-Host "   Attempting to restart Service Control Manager..." -ForegroundColor Cyan
    
    # Try to restart Service Control Manager by restarting EventLog service
    try {
        Restart-Service -Name EventLog -Force -ErrorAction Stop
        Start-Sleep -Seconds 3
        Write-Host "   Service Control Manager restarted" -ForegroundColor Green
        
        # Try deleting again
        Write-Host "   Retrying service deletion..." -ForegroundColor Cyan
        $retryResult = sc.exe delete MinIO 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   Service deleted successfully" -ForegroundColor Green
        } else {
            Write-Host "   Service will be removed after system restart" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "   Could not restart Service Control Manager: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "   Service will be removed after system restart" -ForegroundColor Yellow
    }
} else {
    Write-Host "   Error: $deleteOutput" -ForegroundColor Red
}
Write-Host ""

# 3. Verify service is gone
Write-Host "3. Verifying service removal..." -ForegroundColor Yellow
$service = Get-Service -Name "MinIO" -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "   Warning: Service still exists (may need system restart)" -ForegroundColor Yellow
    Write-Host "   Service status: $($service.Status)" -ForegroundColor Gray
} else {
    Write-Host "   Service successfully removed" -ForegroundColor Green
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. If service still exists, restart your computer" -ForegroundColor White
Write-Host "2. Start MinIO using: .\start-minio.ps1" -ForegroundColor White
Write-Host ""

