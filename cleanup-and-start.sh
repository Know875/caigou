#!/bin/bash

echo "=========================================="
echo "彻底清理并启动服务"
echo "=========================================="
echo ""

# 1. 终止所有相关进程
echo "📊 1. 终止所有相关进程"
echo "----------------------------------------"

# 终止所有 Node.js 进程
pkill -9 node
sleep 2

# 终止 PM2
pm2 kill 2>/dev/null || true
pkill -9 pm2 2>/dev/null || true
sleep 2

# 终止 next-server
pkill -9 next-server 2>/dev/null || true
pkill -9 -f "next" 2>/dev/null || true
sleep 2

# 强制终止所有相关进程
ps aux | grep -E "node|pm2|next" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 3

# 验证
REMAINING=$(ps aux | grep -E "node|pm2|next" | grep -v grep | wc -l)
if [ "$REMAINING" -gt 0 ]; then
    echo "⚠️  仍有 $REMAINING 个相关进程，再次强制终止..."
    ps aux | grep -E "node|pm2|next" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
    sleep 2
fi

echo "✓ 所有相关进程已终止"

# 2. 清理 PM2 和临时文件
echo ""
echo "📊 2. 清理 PM2 和临时文件"
echo "----------------------------------------"
rm -rf /tmp/.pm2
rm -rf /root/.pm2
rm -rf /root/caigou/caigou/.service-pids
echo "✓ 清理完成"

# 3. 检查内存和系统负载
echo ""
echo "📊 3. 检查系统状态"
echo "----------------------------------------"
free -h
echo ""
uptime

# 4. 等待系统稳定
echo ""
echo "📊 4. 等待系统稳定（10秒）..."
sleep 10

# 5. 只启动必要的服务（API 和 Worker，暂时不启动 Web）
echo ""
echo "📊 5. 启动服务（只启动 API 和 Worker）"
echo "----------------------------------------"
cd /root/caigou/caigou

# 创建日志目录
mkdir -p logs

# 启动 API（使用 ulimit 限制内存）
echo "启动 API 服务..."
ulimit -v 600000  # 限制虚拟内存为 600MB
nohup node apps/api/dist/main.js > logs/api-out.log 2> logs/api-error.log &
API_PID=$!
echo "API PID: $API_PID"
sleep 5

# 检查 API 是否启动成功
if ps -p $API_PID > /dev/null; then
    echo "✓ API 服务启动成功 (PID: $API_PID)"
    # 测试 API
    sleep 3
    curl -s http://localhost:8081/api/health && echo "" || echo "⚠️  API 尚未就绪"
else
    echo "✗ API 服务启动失败，查看日志："
    tail -n 20 logs/api-error.log
fi

# 启动 Worker
echo ""
echo "启动 Worker 服务..."
ulimit -v 600000
nohup node apps/api/dist/worker.js > logs/worker-out.log 2> logs/worker-error.log &
WORKER_PID=$!
echo "Worker PID: $WORKER_PID"
sleep 5

# 检查 Worker 是否启动成功
if ps -p $WORKER_PID > /dev/null; then
    echo "✓ Worker 服务启动成功 (PID: $WORKER_PID)"
else
    echo "✗ Worker 服务启动失败，查看日志："
    tail -n 20 logs/worker-error.log
fi

# 6. 保存进程信息
echo ""
echo "📊 6. 保存进程信息"
echo "----------------------------------------"
cat > /root/caigou/caigou/.service-pids << EOF
API_PID=$API_PID
WORKER_PID=$WORKER_PID
EOF
echo "✓ 进程信息已保存"

# 7. 显示运行状态
echo ""
echo "📊 7. 服务运行状态"
echo "----------------------------------------"
ps aux | grep -E "node.*main.js|node.*worker.js" | grep -v grep

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
echo "💡 注意：Web 服务暂时未启动，等系统稳定后再启动"
echo ""
echo "💡 管理命令："
echo "1. 查看 API 日志: tail -f logs/api-out.log"
echo "2. 查看 Worker 日志: tail -f logs/worker-out.log"
echo "3. 测试 API: curl http://localhost:8081/api/health"
echo "4. 停止服务: pkill -f 'node.*main.js' && pkill -f 'node.*worker.js'"
echo ""
echo "💡 等系统稳定后，可以手动启动 Web 服务："
echo "   cd /root/caigou/caigou/apps/web"
echo "   nohup npm run start > ../logs/web-out.log 2> ../logs/web-error.log &"

