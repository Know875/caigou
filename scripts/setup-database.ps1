# Database Setup Script
# For setting up database on a new computer

Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Database Setup Script" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check PostgreSQL installation
Write-Host "1. Checking PostgreSQL..." -ForegroundColor Yellow
$pgService = Get-Service -Name postgresql* -ErrorAction SilentlyContinue
$psqlCmd = Get-Command psql -ErrorAction SilentlyContinue

# If psql is not in PATH, try to find it in common installation locations
$psqlPath = $null
if ($psqlCmd) {
    $psqlPath = $psqlCmd.Source
    Write-Host "   [OK] Found psql in PATH: $psqlPath" -ForegroundColor Green
} else {
    Write-Host "   [WARN] psql not found in PATH, searching common locations..." -ForegroundColor Yellow
    
    # Common PostgreSQL installation paths
    $commonPaths = @(
        "C:\Program Files\PostgreSQL\*\bin\psql.exe",
        "C:\Program Files (x86)\PostgreSQL\*\bin\psql.exe",
        "$env:ProgramFiles\PostgreSQL\*\bin\psql.exe",
        "$env:ProgramFiles(x86)\PostgreSQL\*\bin\psql.exe"
    )
    
    foreach ($pattern in $commonPaths) {
        $found = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $psqlPath = $found.FullName
            Write-Host "   [OK] Found psql: $psqlPath" -ForegroundColor Green
            break
        }
    }
    
    if (-not $psqlPath) {
        Write-Host "   [ERROR] PostgreSQL command-line tools not found!" -ForegroundColor Red
        Write-Host ""
        Write-Host "   Please choose one of the following:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "   Option 1: Install PostgreSQL (includes psql):" -ForegroundColor Cyan
        Write-Host "     1. Using Chocolatey (Recommended):" -ForegroundColor White
        Write-Host "        choco install postgresql" -ForegroundColor Gray
        Write-Host ""
        Write-Host "     2. Manual download:" -ForegroundColor White
        Write-Host "        https://www.postgresql.org/download/windows/" -ForegroundColor Gray
        Write-Host "        Make sure to add PostgreSQL bin directory to PATH during installation" -ForegroundColor Gray
        Write-Host ""
        Write-Host "   Option 2: Use Docker (no local installation needed):" -ForegroundColor Cyan
        Write-Host "     docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name postgres postgres" -ForegroundColor Gray
        Write-Host "     Then use Prisma commands directly (skip psql checks)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "   Option 3: Add PostgreSQL to PATH manually:" -ForegroundColor Cyan
        Write-Host "     Find your PostgreSQL installation (usually in Program Files)" -ForegroundColor White
        Write-Host "     Add the 'bin' folder to your PATH environment variable" -ForegroundColor White
        Write-Host ""
        
        $useDocker = Read-Host "   Do you want to skip psql checks and use Prisma directly? (y/N)"
        if ($useDocker -ne "y" -and $useDocker -ne "Y") {
            exit 1
        }
    }
}

if ($pgService) {
    $running = $pgService | Where-Object { $_.Status -eq 'Running' }
    if ($running) {
        Write-Host "   [OK] PostgreSQL service is running" -ForegroundColor Green
    } else {
        Write-Host "   [WARN] PostgreSQL service is not running, attempting to start..." -ForegroundColor Yellow
        try {
            Start-Service -Name ($pgService[0].Name) -ErrorAction Stop
            Start-Sleep -Seconds 2
            Write-Host "   [OK] PostgreSQL started" -ForegroundColor Green
        } catch {
            Write-Host "   [ERROR] Cannot start PostgreSQL service" -ForegroundColor Red
            Write-Host "   Please start PostgreSQL service manually" -ForegroundColor Yellow
            exit 1
        }
    }
} else {
    Write-Host "   [WARN] Cannot detect PostgreSQL service, but psql command is available" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "2. Checking database connection..." -ForegroundColor Yellow

# Read database configuration
$dbName = "egg_purchase"
$dbUser = "postgres"
$dbHost = "localhost"
$dbPort = "5432"

Write-Host "   Database configuration:" -ForegroundColor Cyan
Write-Host "   Host: $dbHost" -ForegroundColor White
Write-Host "   Port: $dbPort" -ForegroundColor White
Write-Host "   Database: $dbName" -ForegroundColor White
Write-Host "   User: $dbUser" -ForegroundColor White

$dbPassword = Read-Host "   Please enter PostgreSQL password (default: postgres)"
if ([string]::IsNullOrWhiteSpace($dbPassword)) {
    $dbPassword = "postgres"
}

# URL encode special characters in password
$encodedPassword = $dbPassword -replace '@', '%40' -replace '#', '%23' -replace '%', '%25' -replace '&', '%26' -replace '\+', '%2B' -replace '=', '%3D' -replace '\?', '%3F' -replace '/', '%2F' -replace ':', '%3A'

$databaseUrl = "postgresql://${dbUser}:${encodedPassword}@${dbHost}:${dbPort}/${dbName}?schema=public"

# Set environment variables
$env:PGPASSWORD = $dbPassword
$env:DATABASE_URL = $databaseUrl

Write-Host "   Connection string: postgresql://${dbUser}:***@${dbHost}:${dbPort}/${dbName}?schema=public" -ForegroundColor Gray

# Test connection (skip if psql not available)
if ($psqlPath) {
    Write-Host "   Testing database connection..." -ForegroundColor Cyan
    $testResult = & $psqlPath -h localhost -U $dbUser -d postgres -c "SELECT 1;" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   [ERROR] Cannot connect to PostgreSQL" -ForegroundColor Red
        Write-Host "   Please check:" -ForegroundColor Yellow
        Write-Host "   1. Is PostgreSQL service running?" -ForegroundColor White
        Write-Host "   2. Is the password correct?" -ForegroundColor White
        Write-Host "   3. Is the port 5432?" -ForegroundColor White
        exit 1
    }
    Write-Host "   [OK] Database connection successful" -ForegroundColor Green
} else {
    Write-Host "   [SKIP] Skipping psql connection test (psql not found)" -ForegroundColor Yellow
    Write-Host "   Will test connection using Prisma instead" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "3. Creating database..." -ForegroundColor Yellow

# Check if database exists and create it
if ($psqlPath) {
    # Use psql if available
    $dbExistsResult = & $psqlPath -h localhost -U $dbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName';" 2>&1
    $dbExists = $dbExistsResult -match '^\s*1\s*$'

    if ($dbExists) {
        Write-Host "   [INFO] Database '$dbName' already exists" -ForegroundColor Yellow
        $overwrite = Read-Host "   Do you want to drop and recreate it? (y/N)"
        if ($overwrite -eq "y" -or $overwrite -eq "Y") {
            Write-Host "   Dropping existing database..." -ForegroundColor Cyan
            & $psqlPath -h localhost -U $dbUser -d postgres -c "DROP DATABASE IF EXISTS $dbName;" 2>&1 | Out-Null
            Write-Host "   [OK] Database dropped" -ForegroundColor Green
            $dbExists = $false
        } else {
            Write-Host "   Skipping database creation, using existing database" -ForegroundColor Yellow
        }
    }

    # Create database (if not exists)
    if (-not $dbExists) {
        Write-Host "   Creating database '$dbName'..." -ForegroundColor Cyan
        $createResult = & $psqlPath -h localhost -U $dbUser -d postgres -c "CREATE DATABASE $dbName;" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   [OK] Database created successfully" -ForegroundColor Green
        } else {
            Write-Host "   [ERROR] Database creation failed" -ForegroundColor Red
            Write-Host $createResult -ForegroundColor Red
            Write-Host "   Will try to create using Prisma instead..." -ForegroundColor Yellow
        }
    }
} else {
    # If psql not available, use Prisma to create database
    Write-Host "   [INFO] psql not available, will create database using Prisma" -ForegroundColor Yellow
    Write-Host "   Note: Database will be created during migration if it doesn't exist" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "4. Running database migrations..." -ForegroundColor Yellow

# Switch to API directory
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot
$appsDir = Join-Path $projectRoot "apps"
$apiDir = Join-Path $appsDir "api"
$apiDir = [System.IO.Path]::GetFullPath($apiDir)

if (-not (Test-Path $apiDir)) {
    Write-Host "   [ERROR] Cannot find apps/api directory" -ForegroundColor Red
    Write-Host "   Script root: $scriptRoot" -ForegroundColor Yellow
    Write-Host "   Project root: $projectRoot" -ForegroundColor Yellow
    Write-Host "   Expected path: $apiDir" -ForegroundColor Yellow
    Write-Host "   Please make sure you're running this script from the project root" -ForegroundColor Yellow
    exit 1
}

Push-Location $apiDir

try {
    # Set environment variable
    $env:DATABASE_URL = $databaseUrl
    
    # Verify we're in the right directory
    $currentDir = Get-Location
    Write-Host "   Current directory: $currentDir" -ForegroundColor Gray
    $prismaDir = Join-Path $currentDir "prisma"
    $schemaPath = Join-Path $prismaDir "schema.prisma"
    if (-not (Test-Path $schemaPath)) {
        Write-Host "   [ERROR] Cannot find prisma/schema.prisma" -ForegroundColor Red
        Write-Host "   Expected at: $schemaPath" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "   Found schema at: $schemaPath" -ForegroundColor Gray
    
    # First, try to connect to PostgreSQL to verify credentials
    # Try connecting to 'postgres' database first (it always exists)
    Write-Host "   Testing database connection with Prisma..." -ForegroundColor Cyan
    $postgresUrl = "postgresql://${dbUser}:${encodedPassword}@${dbHost}:${dbPort}/postgres?schema=public"
    $originalUrl = $env:DATABASE_URL
    $env:DATABASE_URL = $postgresUrl
    
    # Test connection using migrate status (doesn't require database to exist)
    $testConnection = npx prisma migrate status --schema="$schemaPath" 2>&1
    $connectionOk = $true
    
    if ($LASTEXITCODE -ne 0) {
        $errorOutput = $testConnection -join "`n"
        if ($errorOutput -match "authentication|credentials|password|P1000|P1001|P1009") {
            Write-Host "   [ERROR] Database authentication failed!" -ForegroundColor Red
            Write-Host ""
            Write-Host "   Error details:" -ForegroundColor Yellow
            Write-Host $errorOutput -ForegroundColor Red
            Write-Host ""
            Write-Host "   Possible issues:" -ForegroundColor Yellow
            Write-Host "   1. Wrong password - Please verify your PostgreSQL password" -ForegroundColor White
            Write-Host "   2. User doesn't exist - PostgreSQL user '$dbUser' may not exist" -ForegroundColor White
            Write-Host "   3. Database server not accessible - Check if PostgreSQL is running" -ForegroundColor White
            Write-Host ""
            Write-Host "   To fix:" -ForegroundColor Yellow
            Write-Host "   1. Verify password: Try connecting with pgAdmin or another tool" -ForegroundColor Cyan
            Write-Host "   2. Check PostgreSQL service: Get-Service -Name postgresql*" -ForegroundColor Cyan
            Write-Host "   3. Reset password if needed (requires admin access)" -ForegroundColor Cyan
            Write-Host ""
            $connectionOk = $false
        }
    }
    
    # Restore original database URL
    $env:DATABASE_URL = $originalUrl
    
    if ($connectionOk) {
        Write-Host "   [OK] Database connection successful" -ForegroundColor Green
        Write-Host "   Will create '$dbName' database if it doesn't exist" -ForegroundColor Gray
    } else {
        Write-Host "   [ERROR] Cannot connect to PostgreSQL" -ForegroundColor Red
        Write-Host "   Please fix the connection issue and try again" -ForegroundColor Yellow
        exit 1
    }
    Write-Host ""
    
    Write-Host "   Checking migration status..." -ForegroundColor Cyan
    $migrateStatus = npx prisma migrate status --schema="$schemaPath" 2>&1
    $hasFailedMigrations = $migrateStatus -match "failed migrations|failed migration"
    
    if ($hasFailedMigrations) {
        Write-Host "   [WARN] Found failed migrations in database" -ForegroundColor Yellow
        Write-Host "   Attempting to resolve failed migrations..." -ForegroundColor Cyan
        Write-Host ""
        Write-Host "   Options:" -ForegroundColor Yellow
        Write-Host "   1. Mark failed migrations as rolled back (if you've manually fixed them)" -ForegroundColor White
        Write-Host "   2. Reset database and reapply all migrations (WILL DELETE ALL DATA)" -ForegroundColor White
        Write-Host ""
        
        $resolveOption = Read-Host "   Choose option (1=mark as rolled back, 2=reset database, 3=skip):"
        
        if ($resolveOption -eq "2") {
            Write-Host "   Resetting database (this will delete all data)..." -ForegroundColor Yellow
            $confirm = Read-Host "   Type 'yes' to confirm database reset"
            if ($confirm -eq "yes") {
                npx prisma migrate reset --force --schema="$schemaPath" 2>&1 | ForEach-Object {
                    Write-Host "   $_" -ForegroundColor White
                }
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "   [OK] Database reset completed" -ForegroundColor Green
                } else {
                    Write-Host "   [ERROR] Database reset failed" -ForegroundColor Red
                    exit 1
                }
            } else {
                Write-Host "   Database reset cancelled" -ForegroundColor Yellow
                exit 1
            }
        } elseif ($resolveOption -eq "1") {
            # Extract failed migration name from status output
            $failedMigrationMatch = $migrateStatus | Select-String -Pattern "`([0-9]+_[^`)]+`)" | Select-Object -First 1
            if ($failedMigrationMatch) {
                $failedMigration = $failedMigrationMatch.Matches[0].Groups[1].Value
                Write-Host "   Marking migration '$failedMigration' as rolled back..." -ForegroundColor Cyan
                npx prisma migrate resolve --rolled-back "$failedMigration" --schema="$schemaPath" 2>&1 | ForEach-Object {
                    Write-Host "   $_" -ForegroundColor White
                }
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "   [OK] Failed migration marked as rolled back" -ForegroundColor Green
                } else {
                    Write-Host "   [ERROR] Failed to mark migration as rolled back" -ForegroundColor Red
                    Write-Host "   You may need to manually resolve this" -ForegroundColor Yellow
                }
            } else {
                Write-Host "   [WARN] Could not identify failed migration name" -ForegroundColor Yellow
                Write-Host "   Please resolve manually using:" -ForegroundColor Cyan
                Write-Host "   npx prisma migrate resolve --rolled-back <migration_name>" -ForegroundColor Gray
            }
        } else {
            Write-Host "   Skipping migration resolution" -ForegroundColor Yellow
            Write-Host "   You can resolve manually later" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "   Applying database migrations..." -ForegroundColor Cyan
    npx prisma migrate deploy --schema="$schemaPath" 2>&1 | ForEach-Object {
        if ($_ -match "error|Error|ERROR|失败|authentication|credentials|P3009") {
            Write-Host "   $_" -ForegroundColor Red
        } else {
            Write-Host "   $_" -ForegroundColor White
        }
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] Database migrations completed" -ForegroundColor Green
    } else {
        Write-Host "   [ERROR] Migrations failed!" -ForegroundColor Red
        Write-Host "   Please check the error messages above" -ForegroundColor Yellow
        
        # Check if it's a failed migration issue
        $migrateOutput = npx prisma migrate status --schema="$schemaPath" 2>&1
        if ($migrateOutput -match "failed migrations|failed migration|P3009") {
            Write-Host ""
            Write-Host "   To resolve failed migrations:" -ForegroundColor Yellow
            Write-Host "   1. Check migration status: npx prisma migrate status" -ForegroundColor Cyan
            Write-Host "   2. Mark as rolled back: npx prisma migrate resolve --rolled-back <migration_name>" -ForegroundColor Cyan
            Write-Host "   3. Or reset database: npx prisma migrate reset (WILL DELETE ALL DATA)" -ForegroundColor Cyan
        }
        exit 1
    }
    
    Write-Host ""
    Write-Host "5. Generating Prisma Client..." -ForegroundColor Yellow
    $generateOutput = npx prisma generate --schema="$schemaPath" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] Prisma Client generated successfully" -ForegroundColor Green
    } else {
        Write-Host "   [ERROR] Prisma Client generation failed" -ForegroundColor Red
        Write-Host $generateOutput -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "6. Initialize data (optional)..." -ForegroundColor Yellow
    $seed = Read-Host "   Do you want to run seed script to initialize test data? (y/N)"
    if ($seed -eq "y" -or $seed -eq "Y") {
        Write-Host "   Running seed script..." -ForegroundColor Cyan
        npx prisma db seed --schema="$schemaPath" 2>&1 | ForEach-Object {
            Write-Host "   $_" -ForegroundColor White
        }
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   [OK] Data initialization completed" -ForegroundColor Green
        }
    }
    
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Database setup completed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Database Information:" -ForegroundColor Cyan
Write-Host "  Database Name: $dbName" -ForegroundColor White
Write-Host "  Username: $dbUser" -ForegroundColor White
Write-Host "  Connection String: $databaseUrl" -ForegroundColor White
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Make sure DATABASE_URL in .env file is configured correctly" -ForegroundColor Cyan
Write-Host "  2. Start API service: .\start-all.ps1" -ForegroundColor Cyan
Write-Host ""
