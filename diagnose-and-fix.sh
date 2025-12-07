#!/bin/bash

echo "=========================================="
echo "诊断并修复系统问题"
echo "=========================================="
echo ""

# 1. 检查系统负载和进程
echo "📊 1. 检查系统负载和进程"
echo "----------------------------------------"
uptime
echo ""
echo "CPU 使用率最高的进程："
ps aux --sort=-%cpu | head -n 15
echo ""
echo "内存使用率最高的进程："
ps aux --sort=-%mem | head -n 15

# 2. 检查是否有异常进程
echo ""
echo "📊 2. 检查异常进程"
echo "----------------------------------------"
ps aux | grep -E "fghgf|health.sh|rondo|unk.sh|corn" | grep -v grep || echo "✓ 未发现已知恶意进程"

# 3. 检查系统资源限制
echo ""
echo "📊 3. 检查系统资源限制"
echo "----------------------------------------"
ulimit -a

# 4. 检查内存和交换空间
echo ""
echo "📊 4. 检查内存和交换空间"
echo "----------------------------------------"
free -h

# 5. 尝试使用更小的内存限制启动
echo ""
echo "📊 5. 尝试使用更小的内存限制启动 API"
echo "----------------------------------------"
cd /root/caigou/caigou

# 终止所有 Node.js 进程
pkill -9 node 2>/dev/null || true
sleep 3

# 使用更小的内存限制（256MB）
echo "启动 API（内存限制 256MB）..."
NODE_OPTIONS="--max-old-space-size=256" \
nohup node apps/api/dist/main.js > logs/api-out.log 2> logs/api-error.log &
API_PID=$!
echo "API PID: $API_PID"
sleep 5

if ps -p $API_PID > /dev/null; then
    echo "✓ API 启动成功！"
    sleep 3
    curl -s http://localhost:8081/api/health && echo "" || echo "⚠️  API 尚未就绪"
else
    echo "✗ API 启动失败"
    echo "查看错误日志："
    tail -n 20 logs/api-error.log
fi

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="

