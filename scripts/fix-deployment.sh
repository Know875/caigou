#!/bin/bash
# 快速修复部署问题脚本
# 用于解决地址电话不显示等问题

set -e  # 遇到错误立即退出

echo "🔧 开始修复部署问题..."
echo ""

# 获取项目根目录
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "📁 项目目录: $PROJECT_DIR"
echo ""

# 1. 检查 Node.js 和 npm
echo "🔍 检查环境..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    exit 1
fi
if ! command -v npm &> /dev/null; then
    echo "❌ npm 未安装"
    exit 1
fi
echo "✓ Node.js: $(node --version)"
echo "✓ npm: $(npm --version)"
echo ""

# 2. 重新生成 Prisma Client
echo "📦 重新生成 Prisma Client..."
cd apps/api
npx prisma generate
if [ $? -ne 0 ]; then
    echo "❌ Prisma Client 生成失败"
    exit 1
fi
echo "✓ Prisma Client 生成完成"
echo ""

# 3. 返回项目根目录并重新构建
cd "$PROJECT_DIR"
echo "🔨 重新构建项目..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 项目构建失败"
    exit 1
fi
echo "✓ 项目构建完成"
echo ""

# 4. 检查 PM2
if command -v pm2 &> /dev/null; then
    echo "🔄 重启 PM2 应用..."
    pm2 restart all
    if [ $? -ne 0 ]; then
        echo "⚠️  PM2 重启失败，尝试启动..."
        if [ -f ecosystem.config.js ]; then
            pm2 start ecosystem.config.js
        fi
    fi
    echo "✓ PM2 应用已重启"
    echo ""
    
    # 等待服务启动
    echo "⏳ 等待服务启动..."
    sleep 5
    
    # 显示状态
    echo "📊 PM2 服务状态:"
    pm2 status
    echo ""
    
    echo "📋 最近日志（最后 20 行）:"
    pm2 logs --lines 20 --nostream
else
    echo "⚠️  PM2 未安装，请手动重启应用"
    echo "   停止: pkill -f 'node.*main.js'"
    echo "   启动: cd apps/api && node dist/main.js"
fi

echo ""
echo "✅ 修复完成！"
echo ""
echo "📝 下一步："
echo "1. 检查日志: pm2 logs (或查看日志文件)"
echo "2. 测试接口: curl http://localhost:8081/api/rfqs/shipment-overview"
echo "3. 检查前端页面是否正常显示地址和电话"
echo ""

