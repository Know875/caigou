#!/bin/bash

# 询价单系统部署脚本
# 用于在服务器上快速部署最新代码

set -e  # 遇到错误立即退出

echo "🚀 开始部署询价单系统..."
echo ""

# 1. 查找项目目录
PROJECT_DIR=""
if [ -d "/root/caigou/caigou" ]; then
    PROJECT_DIR="/root/caigou/caigou"
elif [ -d "/root/caigou" ]; then
    PROJECT_DIR="/root/caigou"
elif [ -d "/home/caigou" ]; then
    PROJECT_DIR="/home/caigou"
else
    echo "❌ 未找到项目目录，请手动指定项目路径"
    echo "请执行: cd /path/to/caigou && bash deploy.sh"
    exit 1
fi

echo "📁 项目目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

# 2. 检查是否是 git 仓库
if [ ! -d ".git" ]; then
    echo "❌ 当前目录不是 git 仓库"
    echo "请确认项目目录是否正确，或者手动克隆仓库"
    exit 1
fi

# 3. 获取最新代码
echo ""
echo "📥 拉取最新代码..."
git pull origin main || git pull origin master
if [ $? -ne 0 ]; then
    echo "⚠️ Git pull 失败，请检查网络连接或权限"
    exit 1
fi
echo "✓ 代码拉取完成"
echo ""

# 4. 安装依赖（如果需要）
echo "📦 检查依赖..."
if [ -f "package.json" ]; then
    echo "安装根目录依赖..."
    npm install
fi

# 5. 重新生成 Prisma Client
echo ""
echo "🔧 重新生成 Prisma Client..."
if [ -d "apps/api" ]; then
    cd apps/api
    if [ -f "package.json" ]; then
        npx prisma generate
        if [ $? -ne 0 ]; then
            echo "⚠️ Prisma generate 失败，请检查 Prisma 配置"
            exit 1
        fi
        echo "✓ Prisma Client 生成完成"
    fi
    cd "$PROJECT_DIR"
fi

# 6. 构建项目
echo ""
echo "🔨 构建项目..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 项目构建失败"
    exit 1
fi
echo "✓ 项目构建完成"
echo ""

# 7. 重启 PM2 应用
echo ""
echo "🔄 重启 PM2 应用..."
if command -v pm2 &> /dev/null; then
    pm2 restart caigou-api caigou-web
    if [ $? -eq 0 ]; then
        echo "✓ PM2 应用已重启"
        echo ""
        echo "📊 服务状态:"
        pm2 status
    else
        echo "⚠️ PM2 重启失败，请手动检查"
        pm2 status
    fi
else
    echo "⚠️ PM2 未安装，请手动重启应用"
fi

echo ""
echo "✅ 部署完成！"
echo ""
echo "下一步："
echo "1. 检查应用状态: pm2 status"
echo "2. 查看日志: pm2 logs"
echo "3. 检查前端页面是否正常显示"

