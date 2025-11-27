# Project Size Optimization Script
# Remove unnecessary files to reduce project size

Write-Host "Starting project size optimization..." -ForegroundColor Cyan
Write-Host ""

$totalFreed = 0
$removed = @()

# 1. Remove build artifact directories
Write-Host "1. Removing build artifact directories..." -ForegroundColor Yellow
$buildDirs = @(
    "apps/api/dist",
    "apps/web/.next",
    "apps/web/out",
    ".turbo"
)

foreach ($dir in $buildDirs) {
    $fullPath = Join-Path (Get-Location) $dir
    if (Test-Path $fullPath) {
        try {
            $size = (Get-ChildItem $fullPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
            Remove-Item -Path $fullPath -Recurse -Force -ErrorAction Stop
            $totalFreed += $size
            $sizeMB = [math]::Round($size, 2)
            $removed += "$dir - $sizeMB MB"
            Write-Host "   [OK] Removed: $dir - $sizeMB MB" -ForegroundColor Green
        } catch {
            Write-Host "   [ERROR] Failed to remove: $dir - $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "   [SKIP] Not found: $dir" -ForegroundColor Gray
    }
}

Write-Host ""

# 2. Remove Source Map files (.map)
Write-Host "2. Removing Source Map files..." -ForegroundColor Yellow
$mapFiles = Get-ChildItem -Recurse -Filter "*.map" -File -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch "node_modules"
}

$mapCount = 0
$mapSize = 0
foreach ($file in $mapFiles) {
    try {
        $mapSize += $file.Length / 1MB
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $mapCount++
    } catch {
        Write-Host "   [ERROR] Failed to delete: $($file.Name)" -ForegroundColor Red
    }
}

if ($mapCount -gt 0) {
    $totalFreed += $mapSize
    $mapSizeMB = [math]::Round($mapSize, 2)
    $removed += "Source Map files - $mapCount files, $mapSizeMB MB"
    Write-Host "   [OK] Removed $mapCount .map files - $mapSizeMB MB" -ForegroundColor Green
} else {
    Write-Host "   [SKIP] No .map files found" -ForegroundColor Gray
}

Write-Host ""

# 3. Remove TypeScript build info files
Write-Host "3. Removing TypeScript build info files..." -ForegroundColor Yellow
$tsbuildinfoFiles = Get-ChildItem -Recurse -Filter "*.tsbuildinfo" -File -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch "node_modules"
}

$tsbuildinfoCount = 0
$tsbuildinfoSize = 0
foreach ($file in $tsbuildinfoFiles) {
    try {
        $tsbuildinfoSize += $file.Length / 1MB
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $tsbuildinfoCount++
    } catch {
        Write-Host "   [ERROR] Failed to delete: $($file.Name)" -ForegroundColor Red
    }
}

if ($tsbuildinfoCount -gt 0) {
    $totalFreed += $tsbuildinfoSize
    $tsbuildinfoSizeMB = [math]::Round($tsbuildinfoSize, 2)
    $removed += "TypeScript build info - $tsbuildinfoCount files, $tsbuildinfoSizeMB MB"
    Write-Host "   [OK] Removed $tsbuildinfoCount .tsbuildinfo files - $tsbuildinfoSizeMB MB" -ForegroundColor Green
} else {
    Write-Host "   [SKIP] No .tsbuildinfo files found" -ForegroundColor Gray
}

Write-Host ""

# 4. Remove temporary and log files
Write-Host "4. Removing temporary and log files..." -ForegroundColor Yellow
$tempFiles = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    ($_.Extension -match '\.(old|tmp|bak|log)$' -or $_.Name -match '\.(old|tmp|bak|log)$') -and
    $_.FullName -notmatch "node_modules"
}

$tempCount = 0
$tempSize = 0
foreach ($file in $tempFiles) {
    try {
        $tempSize += $file.Length / 1MB
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $tempCount++
    } catch {
        Write-Host "   [ERROR] Failed to delete: $($file.Name)" -ForegroundColor Red
    }
}

if ($tempCount -gt 0) {
    $totalFreed += $tempSize
    $tempSizeMB = [math]::Round($tempSize, 2)
    $removed += "Temporary files - $tempCount files, $tempSizeMB MB"
    Write-Host "   [OK] Removed $tempCount temporary files - $tempSizeMB MB" -ForegroundColor Green
} else {
    Write-Host "   [SKIP] No temporary files found" -ForegroundColor Gray
}

Write-Host ""

# 5. Remove test Excel files
Write-Host "5. Checking for test files..." -ForegroundColor Yellow
$testFiles = Get-ChildItem -Recurse -Filter "*.xlsx" -File -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -match "test" -or $_.Name -match "temp" -or $_.Name -match "2025" -or $_.Name -match "sample") -and
    $_.FullName -notmatch "node_modules"
}

$testCount = 0
$testSize = 0
foreach ($file in $testFiles) {
    try {
        $testSize += $file.Length / 1MB
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $testCount++
        Write-Host "   [OK] Deleted test file: $($file.Name)" -ForegroundColor Green
    } catch {
        Write-Host "   [ERROR] Failed to delete: $($file.Name)" -ForegroundColor Red
    }
}

if ($testCount -gt 0) {
    $totalFreed += $testSize
    $testSizeMB = [math]::Round($testSize, 2)
    $removed += "Test files - $testCount files, $testSizeMB MB"
} else {
    Write-Host "   [SKIP] No test files found" -ForegroundColor Gray
}

Write-Host ""

# Summary
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Optimization Complete!" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

if ($removed.Count -gt 0) {
    Write-Host "Removed items:" -ForegroundColor Green
    foreach ($item in $removed) {
        Write-Host "  - $item" -ForegroundColor Gray
    }
    Write-Host ""
    $totalFreedMB = [math]::Round($totalFreed, 2)
    Write-Host "Total space freed: $totalFreedMB MB" -ForegroundColor Green
} else {
    Write-Host "No files found to remove (project is already clean)" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "[TIP] Notes:" -ForegroundColor Yellow
Write-Host "  - These files will be regenerated on next build" -ForegroundColor Gray
Write-Host "  - For further optimization, consider:" -ForegroundColor Gray
Write-Host "    * Remove node_modules and reinstall (if offline dev not needed)" -ForegroundColor Gray
Write-Host "    * Clean debug console.log statements in code" -ForegroundColor Gray
Write-Host "    * Check for large files accidentally committed to version control" -ForegroundColor Gray
Write-Host ""
