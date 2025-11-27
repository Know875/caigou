# Download MinIO Script
# Downloads MinIO executable for Windows
# Usage: powershell -ExecutionPolicy Bypass -File scripts/download-minio.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Download MinIO" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Determine download directory
$downloadDir = "$env:USERPROFILE\Downloads"
if (-not (Test-Path $downloadDir)) {
    Write-Host "Creating Downloads directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
}

$minioUrl = "https://dl.min.io/server/minio/release/windows-amd64/minio.exe"
$minioPath = Join-Path $downloadDir "minio.exe"

Write-Host "Download directory: $downloadDir" -ForegroundColor Cyan
Write-Host "Download URL: $minioUrl" -ForegroundColor Cyan
Write-Host "Target file: $minioPath" -ForegroundColor Cyan
Write-Host ""

# Check if file already exists
if (Test-Path $minioPath) {
    $response = Read-Host "MinIO already exists. Overwrite? (Y/N)"
    if ($response -ne 'Y' -and $response -ne 'y') {
        Write-Host "Download cancelled" -ForegroundColor Yellow
        exit 0
    }
    Remove-Item $minioPath -Force
}

Write-Host "Downloading MinIO..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray
Write-Host ""

try {
    # Download with progress
    $ProgressPreference = 'Continue'
    Invoke-WebRequest -Uri $minioUrl -OutFile $minioPath -UseBasicParsing
    
    if (Test-Path $minioPath) {
        $fileSize = (Get-Item $minioPath).Length / 1MB
        Write-Host ""
        Write-Host "Download completed successfully!" -ForegroundColor Green
        Write-Host "File size: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Gray
        Write-Host "Location: $minioPath" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Cyan
        Write-Host "1. Start MinIO: .\start-minio.ps1" -ForegroundColor White
        Write-Host "2. Or add to PATH for global access" -ForegroundColor White
    } else {
        Write-Host "Error: Download failed - file not found" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "Error downloading MinIO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternative download methods:" -ForegroundColor Yellow
    Write-Host "1. Download manually:" -ForegroundColor Cyan
    Write-Host "   $minioUrl" -ForegroundColor White
    Write-Host "   Save to: $minioPath" -ForegroundColor White
    Write-Host ""
    Write-Host "2. Use Chocolatey (if installed):" -ForegroundColor Cyan
    Write-Host "   choco install minio" -ForegroundColor White
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

