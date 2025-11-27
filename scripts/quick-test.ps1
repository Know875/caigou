# Quick Functional Test Script
# Verify key API endpoints are working

Write-Host "Starting quick functional test..." -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:8081/api"
$errors = @()
$warnings = @()

# Test health check endpoint
Write-Host "1. Testing health check endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -TimeoutSec 5
    if ($response.status -eq "ok") {
        Write-Host "   [OK] Health check passed" -ForegroundColor Green
    } else {
        $warnings += "Health check returned unusual status: $($response.status)"
        Write-Host "   [WARN] Health check returned unusual status" -ForegroundColor Yellow
    }
} catch {
    $errors += "Health check failed: $($_.Exception.Message)"
    Write-Host "   [ERROR] Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test API docs endpoint
Write-Host "2. Testing API docs endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/docs" -Method Get -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "   [OK] API docs accessible" -ForegroundColor Green
    } else {
        $warnings += "API docs returned status code: $($response.StatusCode)"
        Write-Host "   [WARN] API docs returned unusual status code" -ForegroundColor Yellow
    }
} catch {
    $warnings += "API docs access failed (may be disabled): $($_.Exception.Message)"
    Write-Host "   [INFO] API docs access failed (may be disabled)" -ForegroundColor Gray
}

Write-Host ""

# Test frontend page
Write-Host "3. Testing frontend page..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080" -Method Get -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "   [OK] Frontend page accessible" -ForegroundColor Green
    } else {
        $warnings += "Frontend page returned status code: $($response.StatusCode)"
        Write-Host "   [WARN] Frontend page returned unusual status code" -ForegroundColor Yellow
    }
} catch {
    $errors += "Frontend page access failed: $($_.Exception.Message)"
    Write-Host "   [ERROR] Frontend page access failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test login page
Write-Host "4. Testing login page..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/login" -Method Get -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "   [OK] Login page accessible" -ForegroundColor Green
    } else {
        $warnings += "Login page returned status code: $($response.StatusCode)"
        Write-Host "   [WARN] Login page returned unusual status code" -ForegroundColor Yellow
    }
} catch {
    $errors += "Login page access failed: $($_.Exception.Message)"
    Write-Host "   [ERROR] Login page access failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Summary
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Quick Test Summary" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan

if ($errors.Count -eq 0) {
    Write-Host "[SUCCESS] All basic checks passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Ready to start functional testing!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Open browser: http://localhost:8080" -ForegroundColor White
    Write-Host "2. Login with admin: admin@example.com / admin123" -ForegroundColor White
    Write-Host "3. Follow FUNCTIONAL_TEST_CHECKLIST.md for testing" -ForegroundColor White
    Write-Host "4. Focus on features marked with checkmark" -ForegroundColor White
} else {
    Write-Host "[ERROR] Found $($errors.Count) error(s):" -ForegroundColor Red
    foreach ($error in $errors) {
        Write-Host "   - $error" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Please fix the above issues before functional testing" -ForegroundColor Yellow
}

if ($warnings.Count -gt 0) {
    Write-Host "[WARN] Found $($warnings.Count) warning(s):" -ForegroundColor Yellow
    foreach ($warning in $warnings) {
        Write-Host "   - $warning" -ForegroundColor Yellow
    }
}

Write-Host ""
