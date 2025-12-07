#!/bin/bash

echo "=========================================="
echo "停止所有服务"
echo "=========================================="
echo ""

# 读取 PID 文件
if [ -f "/root/caigou/caigou/.service-pids" ]; then
    source /root/caigou/caigou/.service-pids
    echo "从 .service-pids 读取进程信息"
    [ -n "$API_PID" ] && kill $API_PID 2>/dev/null && echo "✓ 已停止 API (PID: $API_PID)" || echo "API 进程不存在"
    [ -n "$WORKER_PID" ] && kill $WORKER_PID 2>/dev/null && echo "✓ 已停止 Worker (PID: $WORKER_PID)" || echo "Worker 进程不存在"
    [ -n "$WEB_PID" ] && kill $WEB_PID 2>/dev/null && echo "✓ 已停止 Web (PID: $WEB_PID)" || echo "Web 进程不存在"
fi

# 强制终止所有相关进程
echo ""
echo "强制终止所有 Node.js 进程..."
pkill -9 -f "node.*main.js"
pkill -9 -f "node.*worker.js"
pkill -9 -f "node.*server.js"
pkill -9 -f "npm.*start"
sleep 2

echo ""
echo "=========================================="
echo "所有服务已停止"
echo "=========================================="

