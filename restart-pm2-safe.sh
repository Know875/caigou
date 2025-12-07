#!/bin/bash

echo "=========================================="
echo "安全重启 PM2 服务"
echo "=========================================="
echo ""

# 1. 彻底终止所有 Node.js 进程
echo "📊 1. 终止所有 Node.js 进程"
echo "----------------------------------------"
pkill -9 node
sleep 3

# 再次检查并强制终止
ps aux | grep node | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 2

# 验证是否还有进程
REMAINING=$(ps aux | grep node | grep -v grep | wc -l)
if [ "$REMAINING" -gt 0 ]; then
    echo "⚠️  仍有 $REMAINING 个 Node.js 进程，强制终止..."
    ps aux | grep node | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
    sleep 2
fi

echo "✓ 所有 Node.js 进程已终止"

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
sleep 5

# 5. 使用最保守的方式启动（单个实例，不使用 cluster 模式）
echo ""
echo "📊 5. 启动服务（单个实例，保守模式）"
echo "----------------------------------------"
cd /root/caigou/caigou

# 先启动 API（单个实例，不使用 cluster）
echo "启动 API 服务..."
pm2 start apps/api/dist/main.js \
  --name caigou-api \
  --instances 1 \
  --exec-mode fork \
  --max-memory-restart 600M \
  --error-file ./logs/api-error.log \
  --out-file ./logs/api-out.log \
  --log-date-format "YYYY-MM-DD HH:mm:ss Z" \
  --merge-logs \
  --autorestart \
  --env NODE_ENV=production

sleep 2

# 启动 Worker
echo "启动 Worker 服务..."
pm2 start apps/api/dist/worker.js \
  --name caigou-worker \
  --max-memory-restart 600M \
  --error-file ./logs/worker-error.log \
  --out-file ./logs/worker-out.log \
  --log-date-format "YYYY-MM-DD HH:mm:ss Z" \
  --merge-logs \
  --autorestart \
  --env NODE_ENV=production

sleep 2

# 启动 Web（检查是否有构建好的文件）
echo "启动 Web 服务..."
if [ -d "apps/web/.next/standalone" ]; then
    pm2 start apps/web/.next/standalone/server.js \
      --name caigou-web \
      --instances 1 \
      --exec-mode fork \
      --max-memory-restart 600M \
      --error-file ./logs/web-error.log \
      --out-file ./logs/web-out.log \
      --log-date-format "YYYY-MM-DD HH:mm:ss Z" \
      --merge-logs \
      --autorestart \
      --env NODE_ENV=production \
      --env PORT=3000
else
    echo "⚠️  Next.js standalone 不存在，使用标准方式启动"
    cd apps/web
    pm2 start "npm run start" \
      --name caigou-web \
      --max-memory-restart 600M \
      --error-file ../logs/web-error.log \
      --out-file ../logs/web-out.log \
      --log-date-format "YYYY-MM-DD HH:mm:ss Z" \
      --merge-logs \
      --autorestart \
      --env NODE_ENV=production \
      --env PORT=3000
    cd ../..
fi

# 6. 保存配置
echo ""
echo "📊 6. 保存配置"
echo "----------------------------------------"
pm2 save

# 7. 显示状态
echo ""
echo "📊 7. PM2 进程状态"
echo "----------------------------------------"
pm2 list

# 8. 显示内存使用
echo ""
echo "📊 8. 当前内存使用"
echo "----------------------------------------"
free -h

echo ""
echo "=========================================="
echo "启动完成"
echo "=========================================="
echo ""
echo "💡 如果服务启动成功，可以："
echo "1. 查看日志: pm2 logs"
echo "2. 监控状态: pm2 monit"
echo "3. 检查服务: curl http://localhost:8081/api/health"

