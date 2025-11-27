# 清理脚本：清理构建产物、缓存和临时文件
# 可以安全删除这些文件，它们会在下次构建时重新生成

Write-Host "🧹 开始清理项目..." -ForegroundColor Cyan

$totalFreed = 0

# 1. 清理 Next.js 构建产物
if (Test-Path "apps/web/.next") {
    $size = (Get-ChildItem "apps/web/.next" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Remove-Item "apps/web/.next" -Recurse -Force -ErrorAction SilentlyContinue
    $totalFreed += $size
    Write-Host "✅ 清理 Next.js 构建产物 (.next): $([math]::Round($size, 2)) MB" -ForegroundColor Green
}

# 2. 清理 NestJS 构建产物
if (Test-Path "apps/api/dist") {
    $size = (Get-ChildItem "apps/api/dist" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Remove-Item "apps/api/dist" -Recurse -Force -ErrorAction SilentlyContinue
    $totalFreed += $size
    Write-Host "✅ 清理 NestJS 构建产物 (dist): $([math]::Round($size, 2)) MB" -ForegroundColor Green
}

# 3. 清理 TypeScript 构建信息
Get-ChildItem -Recurse -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue | ForEach-Object {
    $size = $_.Length / 1MB
    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    $totalFreed += $size
}
Write-Host "✅ 清理 TypeScript 构建信息文件" -ForegroundColor Green

# 4. 清理 Turbo 缓存
if (Test-Path ".turbo") {
    $size = (Get-ChildItem ".turbo" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Remove-Item ".turbo" -Recurse -Force -ErrorAction SilentlyContinue
    $totalFreed += $size
    Write-Host "✅ 清理 Turbo 缓存 (.turbo): $([math]::Round($size, 2)) MB" -ForegroundColor Green
}

# 5. 清理 Prisma 引擎缓存（可选，会重新下载）
if (Test-Path "apps/api/node_modules/.cache") {
    $size = (Get-ChildItem "apps/api/node_modules/.cache" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Remove-Item "apps/api/node_modules/.cache" -Recurse -Force -ErrorAction SilentlyContinue
    $totalFreed += $size
    Write-Host "✅ 清理 Prisma 引擎缓存: $([math]::Round($size, 2)) MB" -ForegroundColor Green
}

# 6. 清理日志文件
Get-ChildItem -Recurse -Filter "*.log" -ErrorAction SilentlyContinue | ForEach-Object {
    $size = $_.Length / 1MB
    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    $totalFreed += $size
}
Write-Host "✅ 清理日志文件" -ForegroundColor Green

# 7. 清理临时文件
Get-ChildItem -Recurse -Filter "*.pid" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Filter "*.seed" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "✨ 清理完成！共释放空间: $([math]::Round($totalFreed, 2)) MB" -ForegroundColor Green
Write-Host ""
Write-Host "💡 提示：" -ForegroundColor Yellow
Write-Host "   - node_modules 占用约 1.3GB，这是正常的依赖包大小" -ForegroundColor Yellow
Write-Host "   - 如果需要进一步减小体积，可以考虑：" -ForegroundColor Yellow
Write-Host "     1. 使用 pnpm 或 yarn 的 workspace 功能（已在使用）" -ForegroundColor Yellow
Write-Host "     2. 使用 Docker 多阶段构建，只保留运行时依赖" -ForegroundColor Yellow
Write-Host "     3. 使用 .dockerignore 排除 node_modules" -ForegroundColor Yellow

