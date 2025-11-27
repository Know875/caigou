# Cleanup Unused Modules and Files
# Remove unused files, build artifacts, and temporary files

Write-Host "🧹 Starting cleanup of unused modules and files..." -ForegroundColor Cyan
Write-Host ""

$removed = @()
$errors = @()

# 1. Remove build artifacts
Write-Host "1. Removing build artifacts..." -ForegroundColor Yellow
$buildArtifacts = @(
    "apps/api/dist",
    "apps/web/.next",
    "apps/web/out",
    "apps/web/tsconfig.tsbuildinfo",
    "apps/api/dist/tsconfig.tsbuildinfo"
)

foreach ($path in $buildArtifacts) {
    $fullPath = Join-Path (Get-Location) $path
    if (Test-Path $fullPath) {
        try {
            Remove-Item -Path $fullPath -Recurse -Force -ErrorAction Stop
            $removed += $path
            Write-Host "   [OK] Removed: $path" -ForegroundColor Green
        } catch {
            $errors += "Failed to remove $path : $($_.Exception.Message)"
            Write-Host "   [ERROR] Failed to remove: $path" -ForegroundColor Red
        }
    } else {
        Write-Host "   [SKIP] Not found: $path" -ForegroundColor Gray
    }
}

Write-Host ""

# 2. Remove temporary files
Write-Host "2. Removing temporary files..." -ForegroundColor Yellow
$tempFiles = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Where-Object { 
    $_.Extension -match '\.(old|tmp|bak|log)$' -or 
    $_.Name -match '\.(old|tmp|bak|log)$'
}

foreach ($file in $tempFiles) {
    try {
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $removed += $file.FullName
        Write-Host "   [OK] Removed: $($file.Name)" -ForegroundColor Green
    } catch {
        $errors += "Failed to remove $($file.FullName) : $($_.Exception.Message)"
        Write-Host "   [ERROR] Failed to remove: $($file.Name)" -ForegroundColor Red
    }
}

Write-Host ""

# 3. Remove empty directories
Write-Host "3. Removing empty directories..." -ForegroundColor Yellow
$emptyDirs = @(
    "apps/web/app/import"
)

foreach ($dir in $emptyDirs) {
    $fullPath = Join-Path (Get-Location) $dir
    if (Test-Path $fullPath) {
        $items = Get-ChildItem -Path $fullPath -Recurse -ErrorAction SilentlyContinue
        if ($items.Count -eq 0) {
            try {
                Remove-Item -Path $fullPath -Recurse -Force -ErrorAction Stop
                $removed += $dir
                Write-Host "   [OK] Removed empty directory: $dir" -ForegroundColor Green
            } catch {
                $errors += "Failed to remove $dir : $($_.Exception.Message)"
                Write-Host "   [ERROR] Failed to remove: $dir" -ForegroundColor Red
            }
        } else {
            Write-Host "   [SKIP] Directory not empty: $dir ($($items.Count) items)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   [SKIP] Not found: $dir" -ForegroundColor Gray
    }
}

Write-Host ""

# 4. Remove duplicate/redundant documentation files (keep only essential ones)
Write-Host "4. Checking documentation files..." -ForegroundColor Yellow
$keepDocs = @(
    "README.md",
    "PROJECT.md",
    "FUNCTIONAL_TEST_CHECKLIST.md",
    "DEPLOYMENT_TEST_PLAN.md",
    "START_TESTING.md"
)

$docFiles = Get-ChildItem -Path (Get-Location) -Filter "*.md" -File | Where-Object { 
    $_.Name -notin $keepDocs -and 
    $_.Name -notmatch "^node_modules"
}

if ($docFiles.Count -gt 0) {
    Write-Host "   Found $($docFiles.Count) documentation files that may be redundant:" -ForegroundColor Yellow
    foreach ($doc in $docFiles) {
        Write-Host "   - $($doc.Name)" -ForegroundColor Gray
    }
    Write-Host "   [INFO] These are kept for reference. You can manually review and remove if needed." -ForegroundColor Cyan
} else {
    Write-Host "   [OK] No redundant documentation files found" -ForegroundColor Green
}

Write-Host ""

# 5. Remove test Excel file (if exists)
Write-Host "5. Checking for test files..." -ForegroundColor Yellow
$testFiles = Get-ChildItem -Path (Get-Location) -Filter "*.xlsx" -File | Where-Object {
    $_.Name -match "test|temp|2025"
}

foreach ($file in $testFiles) {
    try {
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $removed += $file.Name
        Write-Host "   [OK] Removed test file: $($file.Name)" -ForegroundColor Green
    } catch {
        $errors += "Failed to remove $($file.FullName) : $($_.Exception.Message)"
        Write-Host "   [ERROR] Failed to remove: $($file.Name)" -ForegroundColor Red
    }
}

Write-Host ""

# Summary
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Cleanup Summary" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan

if ($removed.Count -gt 0) {
    Write-Host "[SUCCESS] Removed $($removed.Count) item(s):" -ForegroundColor Green
    foreach ($item in $removed) {
        Write-Host "   - $item" -ForegroundColor Gray
    }
} else {
    Write-Host "[INFO] No items removed (already clean)" -ForegroundColor Cyan
}

if ($errors.Count -gt 0) {
    Write-Host "[ERROR] $($errors.Count) error(s) occurred:" -ForegroundColor Red
    foreach ($error in $errors) {
        Write-Host "   - $error" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✨ Cleanup completed!" -ForegroundColor Green
Write-Host ""


