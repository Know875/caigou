#!/bin/bash

echo "=========================================="
echo "直接启动服务（不使用 PM2）"
echo "=========================================="
echo ""

# 1. 终止所有 Node.js 进程
echo "📊 1. 终止所有 Node.js 进程"
echo "----------------------------------------"
pkill -9 node
sleep 3
echo "✓ 所有 Node.js 进程已终止"

# 2. 检查内存
echo ""
echo "📊 2. 检查内存状态"
echo "----------------------------------------"
free -h

# 3. 等待内存释放
echo ""
echo "📊 3. 等待内存释放..."
sleep 5

# 4. 直接启动服务（使用 nohup，不使用 PM2）
echo ""
echo "📊 4. 启动服务（直接启动，不使用 PM2）"
echo "----------------------------------------"
cd /root/caigou/caigou

# 创建日志目录
mkdir -p logs

# 启动 API（使用 nohup）
echo "启动 API 服务..."
nohup node apps/api/dist/main.js > logs/api-out.log 2> logs/api-error.log &
API_PID=$!
echo "API PID: $API_PID"
sleep 3

# 检查 API 是否启动成功
if ps -p $API_PID > /dev/null; then
    echo "✓ API 服务启动成功 (PID: $API_PID)"
else
    echo "✗ API 服务启动失败"
fi

# 启动 Worker
echo "启动 Worker 服务..."
nohup node apps/api/dist/worker.js > logs/worker-out.log 2> logs/worker-error.log &
WORKER_PID=$!
echo "Worker PID: $WORKER_PID"
sleep 3

# 检查 Worker 是否启动成功
if ps -p $WORKER_PID > /dev/null; then
    echo "✓ Worker 服务启动成功 (PID: $WORKER_PID)"
else
    echo "✗ Worker 服务启动失败"
fi

# 启动 Web（检查是否有构建好的文件）
echo "启动 Web 服务..."
if [ -d "apps/web/.next/standalone" ]; then
    cd apps/web/.next/standalone
    PORT=3000 NODE_ENV=production nohup node server.js > ../../../logs/web-out.log 2> ../../../logs/web-error.log &
    WEB_PID=$!
    cd ../../..
else
    cd apps/web
    PORT=3000 NODE_ENV=production nohup npm run start > ../logs/web-out.log 2> ../logs/web-error.log &
    WEB_PID=$!
    cd ../..
fi
echo "Web PID: $WEB_PID"
sleep 3

# 检查 Web 是否启动成功
if ps -p $WEB_PID > /dev/null; then
    echo "✓ Web 服务启动成功 (PID: $WEB_PID)"
else
    echo "✗ Web 服务启动失败"
fi

# 5. 保存 PID 到文件（方便后续管理）
echo ""
echo "📊 5. 保存进程信息"
echo "----------------------------------------"
cat > /root/caigou/caigou/.service-pids << EOF
API_PID=$API_PID
WORKER_PID=$WORKER_PID
WEB_PID=$WEB_PID
EOF
echo "✓ 进程信息已保存到 .service-pids"

# 6. 显示运行状态
echo ""
echo "📊 6. 服务运行状态"
echo "----------------------------------------"
ps aux | grep -E "node.*main.js|node.*worker.js|node.*server.js|npm.*start" | grep -v grep

# 7. 测试服务
echo ""
echo "📊 7. 测试服务"
echo "----------------------------------------"
sleep 2
curl -s http://localhost:8081/api/health || echo "⚠️  API 服务未响应"

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
echo "💡 管理命令："
echo "1. 查看日志: tail -f logs/api-out.log"
echo "2. 停止服务: pkill -f 'node.*main.js' && pkill -f 'node.*worker.js'"
echo "3. 检查服务: curl http://localhost:8081/api/health"
echo "4. 查看进程: ps aux | grep node | grep -v grep"

