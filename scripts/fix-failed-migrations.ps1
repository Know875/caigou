# Fix Failed Migrations Script
# This script helps resolve failed Prisma migrations

Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Fix Failed Migrations" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get database configuration
$dbPassword = Read-Host "Please enter PostgreSQL password (default: postgres)"
if ([string]::IsNullOrWhiteSpace($dbPassword)) {
    $dbPassword = "postgres"
}

# URL encode password
$encodedPassword = $dbPassword -replace '@', '%40' -replace '#', '%23' -replace '%', '%25' -replace '&', '%26' -replace '\+', '%2B' -replace '=', '%3D' -replace '\?', '%3F' -replace '/', '%2F' -replace ':', '%3A'

$databaseUrl = "postgresql://postgres:${encodedPassword}@localhost:5432/egg_purchase?schema=public"
$env:DATABASE_URL = $databaseUrl

# Switch to API directory
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot
$appsDir = Join-Path $projectRoot "apps"
$apiDir = Join-Path $appsDir "api"
$apiDir = [System.IO.Path]::GetFullPath($apiDir)

if (-not (Test-Path $apiDir)) {
    Write-Host "[ERROR] Cannot find apps/api directory" -ForegroundColor Red
    exit 1
}

Push-Location $apiDir

try {
    $prismaDir = Join-Path (Get-Location) "prisma"
    $schemaPath = Join-Path $prismaDir "schema.prisma"
    
    Write-Host "Checking migration status..." -ForegroundColor Yellow
    $status = npx prisma migrate status --schema="$schemaPath" 2>&1
    Write-Host $status
    
    Write-Host ""
    Write-Host "Options to fix failed migrations:" -ForegroundColor Yellow
    Write-Host "1. Reset database (WILL DELETE ALL DATA) - Recommended for new setup" -ForegroundColor Cyan
    Write-Host "2. Mark failed migration as rolled back" -ForegroundColor Cyan
    Write-Host "3. Exit" -ForegroundColor Cyan
    Write-Host ""
    
    $choice = Read-Host "Choose option (1/2/3)"
    
    if ($choice -eq "1") {
        Write-Host ""
        Write-Host "Resetting database..." -ForegroundColor Yellow
        Write-Host "WARNING: This will delete all data in the database!" -ForegroundColor Red
        $confirm = Read-Host "Type 'yes' to confirm"
        
        if ($confirm -eq "yes") {
            npx prisma migrate reset --force --schema="$schemaPath" 2>&1 | ForEach-Object {
                Write-Host $_ -ForegroundColor White
            }
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host ""
                Write-Host "[OK] Database reset completed!" -ForegroundColor Green
                Write-Host "All migrations have been reapplied successfully." -ForegroundColor Green
            } else {
                Write-Host ""
                Write-Host "[ERROR] Database reset failed" -ForegroundColor Red
            }
        } else {
            Write-Host "Reset cancelled" -ForegroundColor Yellow
        }
    } elseif ($choice -eq "2") {
        Write-Host ""
        $migrationName = Read-Host "Enter the failed migration name (e.g., 20250113000000_add_store_to_after_sales)"
        
        if (-not [string]::IsNullOrWhiteSpace($migrationName)) {
            Write-Host "Marking migration '$migrationName' as rolled back..." -ForegroundColor Cyan
            npx prisma migrate resolve --rolled-back "$migrationName" --schema="$schemaPath" 2>&1 | ForEach-Object {
                Write-Host $_ -ForegroundColor White
            }
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host ""
                Write-Host "[OK] Migration marked as rolled back" -ForegroundColor Green
                Write-Host "You can now run migrations again" -ForegroundColor Yellow
            } else {
                Write-Host ""
                Write-Host "[ERROR] Failed to mark migration as rolled back" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "Exiting..." -ForegroundColor Yellow
    }
    
} finally {
    Pop-Location
}

Write-Host ""

