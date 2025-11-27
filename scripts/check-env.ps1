# 环境检查脚本
Write-Host ""
Write-Host "=== 环境检查 ===" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
Write-Host "1. 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] Node.js: $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "   [FAIL] 未安装 Node.js" -ForegroundColor Red
        Write-Host "      请访问 https://nodejs.org/ 下载安装" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "   [FAIL] 未安装 Node.js" -ForegroundColor Red
    Write-Host "      请访问 https://nodejs.org/ 下载安装" -ForegroundColor Yellow
    exit 1
}

# 检查 PostgreSQL
Write-Host ""
Write-Host "2. 检查 PostgreSQL..." -ForegroundColor Yellow
$pgServices = Get-Service -Name postgresql* -ErrorAction SilentlyContinue
if ($pgServices) {
    $running = $pgServices | Where-Object { $_.Status -eq 'Running' }
    if ($running) {
        Write-Host "   [OK] PostgreSQL 服务正在运行" -ForegroundColor Green
    } else {
        Write-Host "   [WARN] PostgreSQL 已安装但未运行" -ForegroundColor Yellow
        Write-Host "      请启动服务: Start-Service postgresql-x64-15" -ForegroundColor Cyan
    }
} else {
    Write-Host "   [WARN] 未检测到 PostgreSQL" -ForegroundColor Yellow
    Write-Host "      安装方法:" -ForegroundColor Cyan
    Write-Host "      - 使用 Chocolatey: choco install postgresql15" -ForegroundColor Cyan
    Write-Host "      - 或访问: https://www.postgresql.org/download/windows/" -ForegroundColor Cyan
}

# 检查 Redis
Write-Host ""
Write-Host "3. 检查 Redis..." -ForegroundColor Yellow
$redisProcess = Get-Process -Name redis-server -ErrorAction SilentlyContinue
if ($redisProcess) {
    Write-Host "   [OK] Redis 正在运行" -ForegroundColor Green
} else {
    Write-Host "   [WARN] Redis 未运行" -ForegroundColor Yellow
    Write-Host "      安装方法:" -ForegroundColor Cyan
    Write-Host "      - 使用 Chocolatey: choco install redis-64" -ForegroundColor Cyan
    Write-Host "      - 启动: redis-server" -ForegroundColor Cyan
}

# 检查数据库连接
Write-Host ""
Write-Host "4. 检查数据库连接..." -ForegroundColor Yellow
$pgPath = Get-Command psql -ErrorAction SilentlyContinue
if ($pgPath) {
    $env:PGPASSWORD = "postgres"
    $result = psql -U postgres -d egg_purchase -c "SELECT 1;" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] 数据库连接成功" -ForegroundColor Green
    } else {
        Write-Host "   [WARN] 数据库连接失败，可能需要创建数据库" -ForegroundColor Yellow
        Write-Host "      创建数据库: psql -U postgres -c 'CREATE DATABASE egg_purchase;'" -ForegroundColor Cyan
    }
} else {
    Write-Host "   [WARN] 无法测试数据库连接（psql 命令不可用）" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 检查完成 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host "1. 确保 PostgreSQL 和 Redis 已启动" -ForegroundColor Cyan
Write-Host "2. 创建数据库: psql -U postgres -c 'CREATE DATABASE egg_purchase;'" -ForegroundColor Cyan
Write-Host "3. 运行: npm install" -ForegroundColor Cyan
Write-Host "4. 运行: npm run db:generate && npm run db:migrate" -ForegroundColor Cyan
Write-Host "5. 启动服务: npm run local:start:win" -ForegroundColor Cyan
Write-Host ""
