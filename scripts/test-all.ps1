# Comprehensive Test Script
# For pre-deployment verification

Write-Host "Starting comprehensive tests..." -ForegroundColor Cyan
Write-Host ""

$errors = @()
$warnings = @()

# 1. Environment Check
Write-Host "1. Checking environment configuration..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if ($nodeVersion) {
    Write-Host "   [OK] Node.js version: $nodeVersion" -ForegroundColor Green
} else {
    $errors += "Node.js not installed or not in PATH"
    Write-Host "   [ERROR] Node.js not found" -ForegroundColor Red
}

# Check .env files
if (Test-Path "apps/api/.env") {
    Write-Host "   [OK] API .env file exists" -ForegroundColor Green
} else {
    $warnings += "apps/api/.env file does not exist, ensure environment variables are configured"
    Write-Host "   [WARN] API .env file does not exist" -ForegroundColor Yellow
}

if (Test-Path "apps/web/.env.local") {
    Write-Host "   [OK] Web .env.local file exists" -ForegroundColor Green
} else {
    Write-Host "   [INFO] Web .env.local file does not exist (optional)" -ForegroundColor Gray
}

Write-Host ""

# 2. Dependencies Check
Write-Host "2. Checking dependencies..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    $nodeModulesSize = (Get-ChildItem "node_modules" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "   [OK] Root node_modules exists ($([math]::Round($nodeModulesSize, 2)) MB)" -ForegroundColor Green
} else {
    $errors += "node_modules does not exist, please run npm install"
    Write-Host "   [ERROR] node_modules does not exist" -ForegroundColor Red
}

if (Test-Path "apps/api/node_modules") {
    Write-Host "   [OK] API node_modules exists" -ForegroundColor Green
} else {
    Write-Host "   [INFO] API node_modules does not exist (may use workspace)" -ForegroundColor Gray
}

if (Test-Path "apps/web/node_modules") {
    Write-Host "   [OK] Web node_modules exists" -ForegroundColor Green
} else {
    Write-Host "   [INFO] Web node_modules does not exist (may use workspace)" -ForegroundColor Gray
}

Write-Host ""

# 3. Database Check
Write-Host "3. Checking database configuration..." -ForegroundColor Yellow
if (Test-Path "apps/api/prisma/schema.prisma") {
    Write-Host "   [OK] Prisma schema file exists" -ForegroundColor Green
} else {
    $errors += "Prisma schema file does not exist"
    Write-Host "   [ERROR] Prisma schema file does not exist" -ForegroundColor Red
}

if (Test-Path "apps/api/prisma/migrations") {
    $migrationCount = (Get-ChildItem "apps/api/prisma/migrations" -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "   [OK] Database migration files exist ($migrationCount migrations)" -ForegroundColor Green
} else {
    $warnings += "Database migration directory does not exist, please run npm run db:migrate"
    Write-Host "   [WARN] Database migration directory does not exist" -ForegroundColor Yellow
}

Write-Host ""

# 4. Build Configuration Check
Write-Host "4. Checking build configuration..." -ForegroundColor Yellow
if (Test-Path "apps/api/tsconfig.json") {
    Write-Host "   [OK] API TypeScript config exists" -ForegroundColor Green
} else {
    $errors += "API tsconfig.json does not exist"
    Write-Host "   [ERROR] API tsconfig.json does not exist" -ForegroundColor Red
}

if (Test-Path "apps/web/tsconfig.json") {
    Write-Host "   [OK] Web TypeScript config exists" -ForegroundColor Green
} else {
    $errors += "Web tsconfig.json does not exist"
    Write-Host "   [ERROR] Web tsconfig.json does not exist" -ForegroundColor Red
}

if (Test-Path "apps/web/next.config.js") {
    Write-Host "   [OK] Next.js config exists" -ForegroundColor Green
} else {
    $warnings += "Next.js config file does not exist"
    Write-Host "   [WARN] Next.js config file does not exist" -ForegroundColor Yellow
}

Write-Host ""

# 5. Critical Files Check
Write-Host "5. Checking critical files..." -ForegroundColor Yellow
$criticalFiles = @(
    "apps/api/src/main.ts",
    "apps/web/app/layout.tsx",
    "apps/web/lib/api.ts",
    "apps/api/src/modules/prisma/prisma.service.ts"
)

foreach ($file in $criticalFiles) {
    if (Test-Path $file) {
        Write-Host "   [OK] $file" -ForegroundColor Green
    } else {
        $errors += "Critical file does not exist: $file"
        Write-Host "   [ERROR] $file" -ForegroundColor Red
    }
}

Write-Host ""

# 6. Port Check
Write-Host "6. Checking port availability..." -ForegroundColor Yellow
$apiPort = 8081
$webPort = 8080

$apiPortInUse = Get-NetTCPConnection -LocalPort $apiPort -ErrorAction SilentlyContinue
if ($apiPortInUse) {
    Write-Host "   [WARN] API port $apiPort is in use" -ForegroundColor Yellow
    $warnings += "API port $apiPort is in use, may need to stop existing service"
} else {
    Write-Host "   [OK] API port $apiPort is available" -ForegroundColor Green
}

$webPortInUse = Get-NetTCPConnection -LocalPort $webPort -ErrorAction SilentlyContinue
if ($webPortInUse) {
    Write-Host "   [WARN] Web port $webPort is in use" -ForegroundColor Yellow
    $warnings += "Web port $webPort is in use, may need to stop existing service"
} else {
    Write-Host "   [OK] Web port $webPort is available" -ForegroundColor Green
}

Write-Host ""

# 7. Code Quality Suggestions
Write-Host "7. Code quality check suggestions..." -ForegroundColor Yellow
Write-Host "   Recommended commands:" -ForegroundColor Gray
Write-Host "   - npm run typecheck  (TypeScript type checking)" -ForegroundColor Gray
Write-Host "   - npm run lint       (Code style checking)" -ForegroundColor Gray
Write-Host "   - npm run build      (Build test)" -ForegroundColor Gray

Write-Host ""

# 8. Summary
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan

if ($errors.Count -eq 0) {
    Write-Host "[SUCCESS] No critical errors found" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Found $($errors.Count) critical error(s):" -ForegroundColor Red
    foreach ($error in $errors) {
        Write-Host "   - $error" -ForegroundColor Red
    }
}

if ($warnings.Count -gt 0) {
    Write-Host "[WARN] Found $($warnings.Count) warning(s):" -ForegroundColor Yellow
    foreach ($warning in $warnings) {
        Write-Host "   - $warning" -ForegroundColor Yellow
    }
}

Write-Host ""

if ($errors.Count -eq 0) {
    Write-Host "[SUCCESS] Basic checks passed! Ready for functional testing." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Run 'npm run build' for build test" -ForegroundColor White
    Write-Host "2. Run 'npm run db:migrate' to ensure database is up to date" -ForegroundColor White
    Write-Host "3. Start services and follow DEPLOYMENT_TEST_PLAN.md for functional testing" -ForegroundColor White
} else {
    Write-Host "[ERROR] Please fix the above errors before deployment" -ForegroundColor Red
}

Write-Host ""
