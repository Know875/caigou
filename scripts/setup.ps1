# PowerShell 设置脚本

Write-Host "🚀 开始设置项目..." -ForegroundColor Green

# 检查 Node.js 版本
Write-Host "📦 检查 Node.js 版本..." -ForegroundColor Yellow
$nodeVersion = node -v
Write-Host "✅ Node.js 版本: $nodeVersion" -ForegroundColor Green

# 安装依赖
Write-Host "📦 安装依赖..." -ForegroundColor Yellow
npm install

# 检查 Docker
Write-Host "🐳 检查 Docker..." -ForegroundColor Yellow
if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host "✅ Docker 已安装" -ForegroundColor Green
} else {
    Write-Host "⚠️  Docker 未安装，请先安装 Docker" -ForegroundColor Yellow
}

# 检查 Docker Compose
if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    Write-Host "✅ Docker Compose 已安装" -ForegroundColor Green
} else {
    Write-Host "⚠️  Docker Compose 未安装，请先安装 Docker Compose" -ForegroundColor Yellow
}

# 创建 .env 文件
if (-not (Test-Path .env)) {
    Write-Host "📝 创建 .env 文件..." -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "✅ .env 文件已创建，请编辑配置" -ForegroundColor Green
} else {
    Write-Host "✅ .env 文件已存在" -ForegroundColor Green
}

# 启动基础设施
Write-Host "🐳 启动基础设施（PostgreSQL, Redis, MinIO）..." -ForegroundColor Yellow
docker-compose up -d postgres redis minio

# 等待服务启动
Write-Host "⏳ 等待服务启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 生成 Prisma Client
Write-Host "📦 生成 Prisma Client..." -ForegroundColor Yellow
Set-Location apps/api
npm run db:generate

# 运行数据库迁移
Write-Host "🗄️  运行数据库迁移..." -ForegroundColor Yellow
npm run db:migrate

# 运行种子数据
Write-Host "🌱 运行种子数据..." -ForegroundColor Yellow
npm run db:seed

Set-Location ../..

Write-Host "✅ 设置完成！" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：" -ForegroundColor Yellow
Write-Host "1. 编辑 .env 文件配置环境变量"
Write-Host "2. 运行 'npm run dev' 启动开发服务器"
Write-Host "3. 访问 http://localhost:8080 查看前端"
Write-Host "4. 访问 http://localhost:8081/api/docs 查看 API 文档"

