#!/bin/bash

# 分步构建脚本，避免内存不足

set -e

echo "=========================================="
echo "分步构建项目"
echo "=========================================="
echo ""

cd /root/caigou/caigou

# 1. 检查内存
echo "📊 1. 检查内存"
echo "----------------------------------------"
free -h
echo ""

# 2. 停止运行中的服务（释放内存）
echo "📊 2. 停止运行中的服务"
echo "----------------------------------------"
if command -v pm2 &> /dev/null || [ -f "/usr/lib/node_modules/pm2/bin/pm2" ]; then
    PM2_CMD=$(command -v pm2 || echo "/usr/lib/node_modules/pm2/bin/pm2")
    $PM2_CMD stop all 2>/dev/null || true
    echo "✓ PM2 服务已停止"
fi

# 停止其他 Node 进程
pkill -9 -f "node.*main.js" 2>/dev/null || true
pkill -9 -f "node.*worker.js" 2>/dev/null || true
pkill -9 -f "next" 2>/dev/null || true
sleep 3
echo "✓ 其他 Node 进程已停止"
echo ""

# 3. 清理构建缓存
echo "📊 3. 清理构建缓存"
echo "----------------------------------------"
rm -rf apps/api/dist
rm -rf apps/web/.next
rm -rf apps/web/standalone
rm -rf node_modules/.cache
echo "✓ 构建缓存已清理"
echo ""

# 4. 等待内存释放
echo "📊 4. 等待内存释放"
echo "----------------------------------------"
sleep 5
free -h
echo ""

# 5. 只构建 Web 应用（因为只修改了 Web 代码）
echo "📊 5. 构建 Web 应用"
echo "----------------------------------------"
cd apps/web

# 设置内存限制
export NODE_OPTIONS="--max-old-space-size=512"

echo "开始构建 Web 应用..."
npm run build

if [ $? -eq 0 ]; then
    echo "✓ Web 应用构建成功"
else
    echo "✗ Web 应用构建失败"
    exit 1
fi

cd ../..
echo ""

# 6. 检查是否需要构建 API（如果 dist 不存在）
echo "📊 6. 检查 API 构建"
echo "----------------------------------------"
if [ ! -f "apps/api/dist/main.js" ]; then
    echo "API 构建文件不存在，需要构建..."
    cd apps/api
    
    export NODE_OPTIONS="--max-old-space-size=512"
    npm run build
    
    if [ $? -eq 0 ]; then
        echo "✓ API 构建成功"
    else
        echo "✗ API 构建失败"
        exit 1
    fi
    
    cd ../..
else
    echo "✓ API 构建文件已存在，跳过构建"
fi
echo ""

# 7. 验证构建结果
echo "📊 7. 验证构建结果"
echo "----------------------------------------"
if [ -f "apps/api/dist/main.js" ]; then
    echo "✓ API 构建文件存在"
else
    echo "✗ API 构建文件不存在"
fi

if [ -d "apps/web/.next" ]; then
    echo "✓ Web 构建文件存在"
else
    echo "✗ Web 构建文件不存在"
fi
echo ""

echo "=========================================="
echo "构建完成"
echo "=========================================="
echo ""
echo "下一步："
echo "1. 重启服务: bash start-services.sh"
echo "2. 或使用 PM2: pm2 restart all"
echo ""

