# MinIO Windows Service Fix Script
# Fix "Windows cannot start MinIO service" issue
# Usage: powershell -ExecutionPolicy Bypass -File scripts/fix-minio-windows-service.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MinIO Windows Service Fix Script" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Warning: This script requires administrator privileges" -ForegroundColor Yellow
    Write-Host "Please right-click PowerShell and select 'Run as administrator'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or, use the recommended way to start MinIO (no admin required):" -ForegroundColor Cyan
    Write-Host "  .\start-minio.ps1" -ForegroundColor White
    exit 1
}

Write-Host "Administrator privileges obtained" -ForegroundColor Green
Write-Host ""

# 1. Check if MinIO service exists
Write-Host "1. Checking MinIO service status..." -ForegroundColor Yellow
$minioService = Get-Service -Name "MinIO" -ErrorAction SilentlyContinue

if ($minioService) {
    Write-Host "   Found MinIO Windows service" -ForegroundColor Yellow
    Write-Host "   Service status: $($minioService.Status)" -ForegroundColor Gray
    
    # Stop service
    if ($minioService.Status -eq 'Running') {
        Write-Host "   Stopping service..." -ForegroundColor Cyan
        Stop-Service -Name "MinIO" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    
    # Uninstall service
    Write-Host "   Uninstalling service..." -ForegroundColor Cyan
    $serviceResult = sc.exe delete MinIO 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   MinIO service uninstalled" -ForegroundColor Green
    } else {
        $errorOutput = $serviceResult -join " "
        if ($errorOutput -match "1072" -or $errorOutput -match "marked for deletion") {
            Write-Host "   Service is marked for deletion (Error 1072)" -ForegroundColor Yellow
            Write-Host "   This is normal - the service will be removed after system restart" -ForegroundColor Gray
            Write-Host "   Or you can restart the Service Control Manager to remove it immediately" -ForegroundColor Gray
            Write-Host ""
            Write-Host "   To remove immediately, restart the Service Control Manager:" -ForegroundColor Cyan
            Write-Host "   Restart-Service -Name EventLog -Force" -ForegroundColor White
            Write-Host "   (This will restart the Service Control Manager)" -ForegroundColor Gray
        } else {
            Write-Host "   Error uninstalling service: $errorOutput" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "   No MinIO Windows service found" -ForegroundColor Green
}
Write-Host ""

# 2. Check if MinIO process is running
Write-Host "2. Checking MinIO processes..." -ForegroundColor Yellow
$minioProcess = Get-Process -Name "minio" -ErrorAction SilentlyContinue

if ($minioProcess) {
    Write-Host "   Found MinIO process running" -ForegroundColor Yellow
    Write-Host "   PID: $($minioProcess.Id)" -ForegroundColor Gray
    Write-Host "   Process path: $($minioProcess.Path)" -ForegroundColor Gray
    
    $response = Read-Host "   Stop these processes? (Y/N)"
    if ($response -eq 'Y' -or $response -eq 'y') {
        Stop-Process -Name "minio" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Write-Host "   MinIO processes stopped" -ForegroundColor Green
    }
} else {
    Write-Host "   No MinIO process found" -ForegroundColor Green
}
Write-Host ""

# 3. Check port usage
Write-Host "3. Checking port usage..." -ForegroundColor Yellow
$port9000 = Get-NetTCPConnection -LocalPort 9000 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
$port9001 = Get-NetTCPConnection -LocalPort 9001 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }

if ($port9000) {
    Write-Host "   Port 9000 is in use" -ForegroundColor Yellow
    $proc = Get-Process -Id $port9000.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "   Process: $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor Gray
    }
} else {
    Write-Host "   Port 9000 is available" -ForegroundColor Green
}

if ($port9001) {
    Write-Host "   Port 9001 is in use" -ForegroundColor Yellow
    $proc = Get-Process -Id $port9001.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "   Process: $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor Gray
    }
} else {
    Write-Host "   Port 9001 is available" -ForegroundColor Green
}
Write-Host ""

# 4. Provide startup recommendations
Write-Host "4. Startup recommendations" -ForegroundColor Yellow
Write-Host "   Recommended: Run MinIO directly (not as service)" -ForegroundColor Green
Write-Host ""
Write-Host "   Method 1: Use startup script (recommended)" -ForegroundColor Cyan
Write-Host "   .\start-minio.ps1" -ForegroundColor White
Write-Host ""
Write-Host "   Method 2: Manual startup" -ForegroundColor Cyan
Write-Host "   `$env:MINIO_ROOT_USER='minioadmin'" -ForegroundColor White
Write-Host "   `$env:MINIO_ROOT_PASSWORD='minioadmin'" -ForegroundColor White
Write-Host "   minio server `$env:USERPROFILE\minio-data --address '0.0.0.0:9000' --console-address '0.0.0.0:9001'" -ForegroundColor White
Write-Host ""
Write-Host "   Method 3: Run in background (no window)" -ForegroundColor Cyan
Write-Host "   Start-Process powershell -ArgumentList `"-NoExit`", `"-Command`", `"`$env:MINIO_ROOT_USER='minioadmin'; `$env:MINIO_ROOT_PASSWORD='minioadmin'; minio server `$env:USERPROFILE\minio-data --address '0.0.0.0:9000' --console-address '0.0.0.0:9001'`" -WindowStyle Minimized" -ForegroundColor White
Write-Host ""

# 5. Check MinIO executable
Write-Host "5. Checking MinIO executable..." -ForegroundColor Yellow
$minioExe = $null
$minioPath = Get-Command minio -ErrorAction SilentlyContinue
if ($minioPath) {
    $minioExe = "minio"
    Write-Host "   Found MinIO (in PATH)" -ForegroundColor Green
} else {
    $commonPaths = @(
        "$env:USERPROFILE\Downloads\minio.exe",
        "$env:USERPROFILE\Desktop\minio.exe",
        "C:\minio.exe",
        "$PSScriptRoot\minio.exe"
    )
    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            $minioExe = $path
            Write-Host "   Found MinIO: $path" -ForegroundColor Green
            break
        }
    }
}

if (-not $minioExe) {
    Write-Host "   MinIO executable not found" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   Download options:" -ForegroundColor Cyan
    Write-Host "   1. Use download script (recommended):" -ForegroundColor White
    Write-Host "      .\scripts\download-minio.ps1" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   2. Manual download:" -ForegroundColor White
    Write-Host "      https://dl.min.io/server/minio/release/windows-amd64/minio.exe" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   3. Use Chocolatey (if installed):" -ForegroundColor White
    Write-Host "      choco install minio" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "Fix completed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Start MinIO using recommended method: .\start-minio.ps1" -ForegroundColor White
    Write-Host "2. Or start manually (see Method 2 above)" -ForegroundColor White
    Write-Host "3. Access MinIO console: http://localhost:9001" -ForegroundColor White
    Write-Host "   Username: minioadmin" -ForegroundColor White
    Write-Host "   Password: minioadmin" -ForegroundColor White
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
