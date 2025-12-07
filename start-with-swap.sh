#!/bin/bash

echo "=========================================="
echo "启动服务（使用交换空间）"
echo "=========================================="
echo ""

# 1. 检查交换空间
echo "📊 1. 检查交换空间"
echo "----------------------------------------"
if swapon --show | grep -q .; then
    echo "✓ 交换空间已启用："
    swapon --show
    free -h
else
    echo "⚠️  交换空间未启用，正在创建..."
    bash create-swap.sh
    if [ $? -ne 0 ]; then
        echo "✗ 交换空间创建失败，继续尝试启动..."
    fi
fi

# 2. 终止所有相关进程
echo ""
echo "📊 2. 终止所有相关进程"
echo "----------------------------------------"
pkill -9 node 2>/dev/null || true
pkill -9 pm2 2>/dev/null || true
pkill -9 -f "next" 2>/dev/null || true
sleep 3
echo "✓ 所有相关进程已终止"

# 3. 清理
echo ""
echo "📊 3. 清理临时文件"
echo "----------------------------------------"
rm -rf /tmp/.pm2
rm -rf /root/.pm2
rm -rf /root/caigou/caigou/.service-pids
echo "✓ 清理完成"

# 4. 等待系统稳定
echo ""
echo "📊 4. 等待系统稳定（5秒）..."
sleep 5

# 5. 使用 Node.js 优化参数启动
echo ""
echo "📊 5. 启动服务（使用优化参数）"
echo "----------------------------------------"
cd /root/caigou/caigou

# 创建日志目录
mkdir -p logs

# 启动 API（使用 Node.js 优化参数，减少内存占用）
echo "启动 API 服务..."
NODE_OPTIONS="--max-old-space-size=512 --max-semi-space-size=64" \
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
    tail -n 30 logs/api-error.log
fi

# 启动 Worker
echo ""
echo "启动 Worker 服务..."
NODE_OPTIONS="--max-old-space-size=512 --max-semi-space-size=64" \
nohup node apps/api/dist/worker.js > logs/worker-out.log 2> logs/worker-error.log &
WORKER_PID=$!
echo "Worker PID: $WORKER_PID"
sleep 5

# 检查 Worker 是否启动成功
if ps -p $WORKER_PID > /dev/null; then
    echo "✓ Worker 服务启动成功 (PID: $WORKER_PID)"
else
    echo "✗ Worker 服务启动失败，查看日志："
    tail -n 30 logs/worker-error.log
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

# 8. 显示内存和交换空间使用
echo ""
echo "📊 8. 当前内存和交换空间使用"
echo "----------------------------------------"
free -h

echo ""
echo "=========================================="
echo "启动完成"
echo "=========================================="
echo ""
echo "💡 管理命令："
echo "1. 查看 API 日志: tail -f logs/api-out.log"
echo "2. 查看 Worker 日志: tail -f logs/worker-out.log"
echo "3. 测试 API: curl http://localhost:8081/api/health"
echo "4. 停止服务: pkill -f 'node.*main.js' && pkill -f 'node.*worker.js'"

