# 清理 Next.js 构建缓存
Write-Host "清理 Next.js 构建缓存..." -ForegroundColor Yellow

# 删除 .next 目录
if (Test-Path .next) {
    Remove-Item -Recurse -Force .next
    Write-Host "✓ 已删除 .next 目录" -ForegroundColor Green
} else {
    Write-Host "  .next 目录不存在" -ForegroundColor Gray
}

# 删除 node_modules/.cache 目录（如果存在）
if (Test-Path node_modules\.cache) {
    Remove-Item -Recurse -Force node_modules\.cache
    Write-Host "✓ 已删除 node_modules/.cache 目录" -ForegroundColor Green
}

Write-Host ""
Write-Host "清理完成！现在可以重新运行构建命令。" -ForegroundColor Green
Write-Host "运行: npm run build" -ForegroundColor Cyan

