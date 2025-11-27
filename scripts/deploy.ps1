# 快速部署脚本 (PowerShell)
# 使用方法: powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1

$ErrorActionPreference = "Stop"

Write-Host "🚀 开始部署..." -ForegroundColor Cyan
Write-Host ""

# 项目目录
$PROJECT_DIR = if ($PSScriptRoot) { 
    Split-Path (Split-Path $PSScriptRoot -Parent) -Parent 
} else { 
    $PWD 
}

Set-Location $PROJECT_DIR
Write-Host "📁 当前目录: $PROJECT_DIR" -ForegroundColor Green
Write-Host ""

# 1. 检查环境变量文件
Write-Host "📋 检查环境变量..." -ForegroundColor Yellow
$envFile = Join-Path $PROJECT_DIR "apps\api\.env"
if (-not (Test-Path $envFile)) {
    Write-Host "⚠️  环境变量文件不存在: apps\api\.env" -ForegroundColor Red
    Write-Host "请先创建环境变量文件，参考 env.local.example" -ForegroundColor Yellow
    exit 1
}
Write-Host "✓ 环境变量文件存在" -ForegroundColor Green
Write-Host ""

# 2. 生成 Prisma 客户端
Write-Host "📦 生成 Prisma 客户端..." -ForegroundColor Yellow
npm run db:generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Prisma 客户端生成失败" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Prisma 客户端生成完成" -ForegroundColor Green
Write-Host ""

# 3. 运行数据库迁移
Write-Host "🗄️  运行数据库迁移..." -ForegroundColor Yellow
npm run db:migrate
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 数据库迁移失败" -ForegroundColor Red
    exit 1
}
Write-Host "✓ 数据库迁移完成" -ForegroundColor Green
Write-Host ""

# 4. 构建项目
Write-Host "🔨 构建项目..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 项目构建失败" -ForegroundColor Red
    exit 1
}
Write-Host "✓ 项目构建完成" -ForegroundColor Green
Write-Host ""

# 5. 检查 PM2
Write-Host "🔄 检查 PM2..." -ForegroundColor Yellow
$pm2Installed = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2Installed) {
    Write-Host "✓ PM2 已安装" -ForegroundColor Green
    
    # 检查 ecosystem.config.js
    $ecosystemFile = Join-Path $PROJECT_DIR "ecosystem.config.js"
    if (Test-Path $ecosystemFile) {
        Write-Host "🔄 重启 PM2 应用..." -ForegroundColor Yellow
        pm2 restart ecosystem.config.js 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            pm2 start ecosystem.config.js 2>&1 | Out-Null
        }
        pm2 save 2>&1 | Out-Null
        Write-Host "✓ PM2 应用已重启" -ForegroundColor Green
        Write-Host ""
        Write-Host "📊 服务状态:" -ForegroundColor Cyan
        pm2 status
    } else {
        Write-Host "⚠️  ecosystem.config.js 不存在，跳过 PM2 重启" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  PM2 未安装，请手动启动应用" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ 部署完成！" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "1. 检查应用状态: pm2 status" -ForegroundColor White
Write-Host "2. 查看日志: pm2 logs" -ForegroundColor White
Write-Host "3. 检查端口占用: netstat -ano | findstr :8081" -ForegroundColor White

