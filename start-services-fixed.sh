#!/bin/bash

echo "=========================================="
echo "启动服务（修复版）"
echo "=========================================="
echo ""

cd /root/caigou/caigou

# 创建日志目录
mkdir -p logs

# 终止现有服务
echo "📊 1. 终止现有服务"
echo "----------------------------------------"
pkill -9 -f "node.*main.js" 2>/dev/null || true
pkill -9 -f "node.*worker.js" 2>/dev/null || true
sleep 2
echo "✓ 现有服务已终止"

# 启动 API
echo ""
echo "📊 2. 启动 API 服务"
echo "----------------------------------------"
NODE_OPTIONS="--max-old-space-size=128" \
NODE_ENV=production \
nohup node apps/api/dist/main.js > logs/api-out.log 2> logs/api-error.log &
API_PID=$!
echo "API PID: $API_PID"
sleep 10

# 检查 API 是否启动成功
if ps -p $API_PID > /dev/null; then
    echo "✓ API 服务启动成功 (PID: $API_PID)"
    sleep 5
    echo "检查 API 健康状态..."
    curl -s http://localhost:8081/api/health && echo "" || echo "⚠️  API 尚未就绪"
    
    # 启动 Worker
    echo ""
    echo "📊 3. 启动 Worker 服务"
    echo "----------------------------------------"
    NODE_OPTIONS="--max-old-space-size=128" \
    NODE_ENV=production \
    nohup node apps/api/dist/worker.js > logs/worker-out.log 2> logs/worker-error.log &
    WORKER_PID=$!
    echo "Worker PID: $WORKER_PID"
    sleep 10
    
    if ps -p $WORKER_PID > /dev/null; then
        echo "✓ Worker 服务启动成功 (PID: $WORKER_PID)"
    else
        echo "✗ Worker 服务启动失败"
        echo "错误日志："
        tail -n 20 logs/worker-error.log
    fi
else
    echo "✗ API 服务启动失败"
    echo "错误日志："
    tail -n 30 logs/api-error.log
    exit 1
fi

# 保存进程信息
cat > /root/caigou/caigou/.service-pids << EOF
API_PID=$API_PID
WORKER_PID=$WORKER_PID
EOF

# 显示运行状态
echo ""
echo "📊 4. 服务运行状态"
echo "----------------------------------------"
ps aux | grep -E "node.*main.js|node.*worker.js" | grep -v grep

echo ""
echo "=========================================="
echo "启动完成"
echo "=========================================="

