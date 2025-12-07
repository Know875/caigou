#!/bin/bash

echo "=========================================="
echo "清理可疑进程并启动服务"
echo "=========================================="
echo ""

# 1. 终止可疑进程
echo "📊 1. 终止可疑进程"
echo "----------------------------------------"
pkill -9 -f "/tmp/runnv/alive.sh" 2>/dev/null || true
pkill -9 -f "runnv" 2>/dev/null || true
sleep 2

# 检查是否还有可疑进程
if ps aux | grep -E "runnv|alive.sh" | grep -v grep; then
    echo "⚠️  仍有可疑进程，强制终止..."
    ps aux | grep -E "runnv|alive.sh" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
    sleep 2
fi
echo "✓ 可疑进程已清理"

# 2. 终止所有 Node.js 进程
echo ""
echo "📊 2. 终止所有 Node.js 进程"
echo "----------------------------------------"
pkill -9 node 2>/dev/null || true
pkill -9 pm2 2>/dev/null || true
pkill -9 -f "next" 2>/dev/null || true
sleep 3
echo "✓ 所有 Node.js 进程已终止"

# 3. 清理临时文件
echo ""
echo "📊 3. 清理临时文件"
echo "----------------------------------------"
rm -rf /tmp/.pm2
rm -rf /root/.pm2
rm -rf /root/caigou/caigou/.service-pids
echo "✓ 清理完成"

# 4. 检查系统状态
echo ""
echo "📊 4. 检查系统状态"
echo "----------------------------------------"
uptime
free -h

# 5. 等待系统稳定
echo ""
echo "📊 5. 等待系统稳定（15秒）..."
sleep 15

# 6. 尝试使用最小配置启动（只启动 API，不启动 Worker）
echo ""
echo "📊 6. 启动 API 服务（最小配置）"
echo "----------------------------------------"
cd /root/caigou/caigou

# 创建日志目录
mkdir -p logs

# 使用最小内存限制和优化参数
echo "启动 API（内存限制 128MB，优化参数）..."
NODE_OPTIONS="--max-old-space-size=128 --max-semi-space-size=16 --optimize-for-size" \
NODE_ENV=production \
nohup node apps/api/dist/main.js > logs/api-out.log 2> logs/api-error.log &
API_PID=$!
echo "API PID: $API_PID"
sleep 10

# 检查 API 是否启动成功
if ps -p $API_PID > /dev/null; then
    echo "✓ API 服务启动成功 (PID: $API_PID)"
    # 测试 API
    sleep 5
    curl -s http://localhost:8081/api/health && echo "" || echo "⚠️  API 尚未就绪"
    
    # 如果 API 启动成功，再启动 Worker
    echo ""
    echo "📊 7. 启动 Worker 服务"
    echo "----------------------------------------"
    NODE_OPTIONS="--max-old-space-size=128 --max-semi-space-size=16 --optimize-for-size" \
    NODE_ENV=production \
    nohup node apps/api/dist/worker.js > logs/worker-out.log 2> logs/worker-error.log &
    WORKER_PID=$!
    echo "Worker PID: $WORKER_PID"
    sleep 10
    
    if ps -p $WORKER_PID > /dev/null; then
        echo "✓ Worker 服务启动成功 (PID: $WORKER_PID)"
    else
        echo "✗ Worker 服务启动失败"
        tail -n 20 logs/worker-error.log
    fi
else
    echo "✗ API 服务启动失败"
    echo "查看错误日志："
    tail -n 30 logs/api-error.log
    echo ""
    echo "查看系统日志："
    dmesg | tail -n 10
fi

# 8. 保存进程信息
echo ""
echo "📊 8. 保存进程信息"
echo "----------------------------------------"
cat > /root/caigou/caigou/.service-pids << EOF
API_PID=$API_PID
WORKER_PID=$WORKER_PID
EOF
echo "✓ 进程信息已保存"

# 9. 显示运行状态
echo ""
echo "📊 9. 服务运行状态"
echo "----------------------------------------"
ps aux | grep -E "node.*main.js|node.*worker.js" | grep -v grep

# 10. 显示系统状态
echo ""
echo "📊 10. 当前系统状态"
echo "----------------------------------------"
uptime
free -h

echo ""
echo "=========================================="
echo "启动完成"
echo "=========================================="

