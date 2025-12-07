#!/bin/bash

echo "=========================================="
echo "修复 PM2 Killed 问题"
echo "=========================================="
echo ""

# 1. 终止所有 Node.js 进程（除了当前脚本）
echo "📊 1. 终止所有 Node.js 进程"
echo "----------------------------------------"
pkill -9 node
sleep 2
echo "✓ 已终止所有 Node.js 进程"

# 2. 清理 PM2
echo ""
echo "📊 2. 清理 PM2"
echo "----------------------------------------"
pm2 kill 2>/dev/null || true
rm -rf /tmp/.pm2
sleep 2
echo "✓ PM2 已清理"

# 3. 检查内存
echo ""
echo "📊 3. 检查内存状态"
echo "----------------------------------------"
free -h

# 4. 等待内存释放
echo ""
echo "📊 4. 等待内存释放..."
sleep 3

# 5. 重新启动 PM2（使用单个实例，减少内存占用）
echo ""
echo "📊 5. 重新启动 PM2（使用单个实例）"
echo "----------------------------------------"
cd /root/caigou/caigou

# 检查 ecosystem.config.js 是否存在
if [ -f "ecosystem.config.js" ]; then
    # 临时修改为单个实例（减少内存占用）
    pm2 start ecosystem.config.js --update-env || {
        echo "⚠️  使用 ecosystem.config.js 启动失败，尝试手动启动"
        # 手动启动单个实例
        pm2 start apps/api/dist/main.js --name caigou-api -i 1
        pm2 start apps/web/.next/standalone/server.js --name caigou-web -i 1 2>/dev/null || {
            echo "⚠️  Next.js standalone 不存在，使用标准方式启动"
            cd apps/web
            pm2 start "npm run start" --name caigou-web
            cd ../..
        }
        pm2 start apps/api/dist/worker.js --name caigou-worker
    }
else
    echo "⚠️  ecosystem.config.js 不存在，手动启动服务"
    pm2 start apps/api/dist/main.js --name caigou-api -i 1
    pm2 start apps/web/.next/standalone/server.js --name caigou-web -i 1 2>/dev/null || {
        cd apps/web
        pm2 start "npm run start" --name caigou-web
        cd ../..
    }
    pm2 start apps/api/dist/worker.js --name caigou-worker
fi

# 6. 保存配置
pm2 save

# 7. 显示状态
echo ""
echo "📊 6. PM2 进程状态"
echo "----------------------------------------"
pm2 list

echo ""
echo "=========================================="
echo "修复完成"
echo "=========================================="
echo ""
echo "💡 如果仍然失败，可能需要："
echo "1. 减少 PM2 实例数（从 2 改为 1）"
echo "2. 增加交换空间"
echo "3. 检查是否有其他进程占用内存"

