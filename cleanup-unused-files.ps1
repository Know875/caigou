# 清理无用文件脚本
# 删除临时诊断脚本、过时文档等

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "清理无用文件" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 要删除的文件列表
$filesToDelete = @(
    # 临时诊断/修复脚本
    "block-malware-completely.sh",
    "build-step-by-step.sh",
    "check-and-fix-pm2.sh",
    "check-cpu-usage.sh",
    "check-minio-status.sh",
    "check-system-memory.sh",
    "cleanup-and-start.sh",
    "cleanup-suspicious-and-start.sh",
    "cleanup-temp-files.sh",
    "complete-malware-removal.sh",
    "create-swap.sh",
    "diagnose-and-fix.sh",
    "diagnose-image-proxy.sh",
    "execute-fix.sh",
    "final-cleanup-malware.sh",
    "fix-pm2-killed.sh",
    "fix-ufw-and-block.sh",
    "restart-pm2-safe.sh",
    "start-services-direct.sh",
    "start-services-fixed.sh",
    "start-with-swap.sh",
    "stop-services-direct.sh",
    "test-performance.sh",
    "ultimate-cleanup.sh",
    "verify-minio-config.sh",
    "deploy-quote-optimization.sh",
    
    # 过时的文档
    "DEPLOY_QUOTE_OPTIMIZATION.md",
    "FIX_PM2_KILLED.md",
    "OPTIMIZATION_SUMMARY.md",
    "PAGE_OPTIMIZATION_PLAN.md",
    "PERFORMANCE_OPTIMIZATION_PLAN.md",
    "PERFORMANCE_TEST_GUIDE.md",
    
    # 未跟踪的临时脚本
    "quick-check-minio.sh",
    "test-minio-and-proxy.sh",
    
    # Windows 快捷方式
    "apps/本地磁盘 (H).lnk"
)

$deletedCount = 0
$notFoundCount = 0

foreach ($file in $filesToDelete) {
    $filePath = Join-Path $PSScriptRoot $file
    if (Test-Path $filePath) {
        try {
            Remove-Item $filePath -Force
            Write-Host "✓ 已删除: $file" -ForegroundColor Green
            $deletedCount++
        } catch {
            Write-Host "✗ 删除失败: $file - $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "- 未找到: $file" -ForegroundColor Gray
        $notFoundCount++
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "清理完成" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "已删除: $deletedCount 个文件" -ForegroundColor Green
Write-Host "未找到: $notFoundCount 个文件" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: Run 'git status' to see changes, then commit the deletions" -ForegroundColor Yellow

