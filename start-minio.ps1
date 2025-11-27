# MinIO Startup Script
# Set execution policy if needed
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force -ErrorAction SilentlyContinue

Write-Host "Starting MinIO..." -ForegroundColor Yellow

# Find MinIO executable
$minioExe = $null

# 1. Check if in PATH
$minioPath = Get-Command minio -ErrorAction SilentlyContinue
if ($minioPath) {
    $minioExe = "minio"
    Write-Host "Found MinIO (in PATH)" -ForegroundColor Green
} else {
    # 2. Check common locations
    $commonPaths = @(
        "$env:USERPROFILE\Downloads\minio.exe",
        "$env:USERPROFILE\Desktop\minio.exe",
        "C:\minio.exe",
        "$PSScriptRoot\minio.exe",
        "$PSScriptRoot\..\minio.exe"
    )
    
    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            $minioExe = $path
            Write-Host "Found MinIO: $path" -ForegroundColor Green
            break
        }
    }
}

if (-not $minioExe) {
    Write-Host "MinIO executable not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please choose one of the following:" -ForegroundColor Yellow
    Write-Host "1. Place minio.exe in one of these locations:" -ForegroundColor Cyan
    Write-Host "   - $env:USERPROFILE\Downloads\minio.exe" -ForegroundColor White
    Write-Host "   - $PSScriptRoot\minio.exe" -ForegroundColor White
    Write-Host "   - Or add to PATH environment variable" -ForegroundColor White
    Write-Host ""
    Write-Host "2. Install with Chocolatey: choco install minio" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "3. Use Docker:" -ForegroundColor Cyan
    Write-Host "   docker run -d -p 9000:9000 -p 9001:9001 --name minio -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data --console-address ':9001'" -ForegroundColor White
    Write-Host ""
    Write-Host "4. Download MinIO: https://min.io/download" -ForegroundColor Cyan
    Write-Host "   Or use: .\scripts\download-minio.ps1" -ForegroundColor Cyan
    exit 1
}

# Create data directory
$dataDir = "$env:USERPROFILE\minio-data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host "Created data directory: $dataDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "MinIO Configuration:" -ForegroundColor Cyan
Write-Host "  Data directory: $dataDir" -ForegroundColor White
Write-Host "  API address: http://localhost:9000" -ForegroundColor White
Write-Host "  Console: http://localhost:9001" -ForegroundColor White
Write-Host "  Username: minioadmin" -ForegroundColor White
Write-Host "  Password: minioadmin" -ForegroundColor White
Write-Host ""

# Start MinIO
Write-Host "Starting MinIO..." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop MinIO" -ForegroundColor Gray
Write-Host ""

# Set environment variables
$env:MINIO_ROOT_USER = "minioadmin"
$env:MINIO_ROOT_PASSWORD = "minioadmin"

# Get local IP address for display
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*" -or $_.IPAddress -like "26.*" } | Select-Object -First 1).IPAddress
if (-not $ipAddress) {
    $ipAddress = "localhost"
}

Write-Host ""
Write-Host "Network Access:" -ForegroundColor Cyan
Write-Host "  Local: http://localhost:9000" -ForegroundColor White
Write-Host "  LAN: http://${ipAddress}:9000" -ForegroundColor White
Write-Host ""

if ($minioExe -eq "minio") {
    # If in PATH, run directly
    # Use 0.0.0.0 to listen on all interfaces
    & minio server $dataDir --address "0.0.0.0:9000" --console-address "0.0.0.0:9001"
} else {
    # If specific path, switch to executable directory and run
    $minioDir = Split-Path -Parent $minioExe
    $minioFileName = Split-Path -Leaf $minioExe
    
    Write-Host "Switching to MinIO directory: $minioDir" -ForegroundColor Gray
    Push-Location $minioDir
    try {
        # Use relative path to avoid path resolution issues
        # Use 0.0.0.0 to listen on all interfaces
        & ".\$minioFileName" server $dataDir --address "0.0.0.0:9000" --console-address "0.0.0.0:9001"
    } catch {
        Write-Host ""
        Write-Host "Startup failed: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "If you encounter license errors, try:" -ForegroundColor Yellow
        Write-Host "1. Download open source MinIO: https://dl.min.io/server/minio/release/windows-amd64/minio.exe" -ForegroundColor Cyan
        Write-Host "2. Or use Docker to start MinIO" -ForegroundColor Cyan
        throw
    } finally {
        Pop-Location
    }
}
