# Remove or comment out debug console.log statements
# WARNING: This script will modify source code files, backup or commit first

Write-Host "Scanning for debug code..." -ForegroundColor Cyan
Write-Host ""

$filesToProcess = @()
$totalLines = 0

# Find files containing console.log (excluding node_modules)
Write-Host "1. Scanning files..." -ForegroundColor Yellow
$tsxFiles = Get-ChildItem -Path "apps/web" -Recurse -Include "*.tsx", "*.ts" -File -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch "node_modules" -and
    $_.FullName -notmatch "\.next" -and
    $_.FullName -notmatch "dist"
}

$tsFiles = Get-ChildItem -Path "apps/api/src" -Recurse -Include "*.ts" -File -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch "node_modules" -and
    $_.FullName -notmatch "dist"
}

$allFiles = $tsxFiles + $tsFiles

foreach ($file in $allFiles) {
    try {
        $content = Get-Content $file.FullName -ErrorAction SilentlyContinue | Out-String
    } catch {
        $content = $null
    }
    if ($content -and ($content -match "console\.(log|debug|info|group|groupEnd|table)")) {
        $lines = Get-Content $file.FullName -ErrorAction SilentlyContinue
        $consoleLines = $lines | Select-String -Pattern "console\.(log|debug|info|group|groupEnd|table)" | Measure-Object
        if ($consoleLines.Count -gt 0) {
            $filesToProcess += @{
                Path = $file.FullName
                Count = $consoleLines.Count
            }
            $totalLines += $consoleLines.Count
        }
    }
}

Write-Host "   Found $($filesToProcess.Count) files with console statements, total $totalLines lines" -ForegroundColor Cyan
Write-Host ""

if ($filesToProcess.Count -eq 0) {
    Write-Host "[OK] No debug code found to clean" -ForegroundColor Green
    exit 0
}

# Display file list
Write-Host "2. Files containing debug code:" -ForegroundColor Yellow
foreach ($file in $filesToProcess) {
    Write-Host "   - $($file.Path) ($($file.Count) occurrences)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[WARNING] This will modify source code files" -ForegroundColor Red
Write-Host ""
Write-Host "Auto-confirming to proceed..." -ForegroundColor Yellow
$confirm = "y"

Write-Host ""
Write-Host "3. Processing files..." -ForegroundColor Yellow

$processed = 0
$modified = 0

foreach ($fileInfo in $filesToProcess) {
    $filePath = $fileInfo.Path
    $lines = Get-Content $filePath -ErrorAction SilentlyContinue
    
    if ($lines) {
        $modifiedLines = @()
        $fileModified = $false
        
        foreach ($line in $lines) {
            $originalLine = $line
            $trimmedLine = $line.TrimStart()
            
            # Comment out console.log, console.debug, console.info, console.group, console.groupEnd, console.table
            # But keep console.error and console.warn
            if ($trimmedLine -match "^console\.(log|debug|info|group|groupEnd|table)\(") {
                # Find the indentation
                $indent = $line -replace "^(.*?)\S.*", '$1'
                # Comment out the line
                $line = $indent + "// " + $trimmedLine
                $fileModified = $true
            }
            
            $modifiedLines += $line
        }
        
        if ($fileModified) {
            try {
                $modifiedLines | Set-Content -Path $filePath -Encoding UTF8
                $modified++
                Write-Host "   [OK] Processed: $filePath" -ForegroundColor Green
            } catch {
                Write-Host "   [ERROR] Failed: $filePath - $($_.Exception.Message)" -ForegroundColor Red
            }
        }
        $processed++
    }
}

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Processing Complete!" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Processed: $processed files" -ForegroundColor Green
Write-Host "Modified: $modified files" -ForegroundColor Green
Write-Host ""
Write-Host "[TIP] Notes:" -ForegroundColor Yellow
Write-Host "  - console.error and console.warn are preserved (for error handling)" -ForegroundColor Gray
Write-Host "  - console.log, console.debug, console.info are commented out" -ForegroundColor Gray
Write-Host "  - Review changes before committing" -ForegroundColor Gray
Write-Host ""
