#!/bin/bash

# 启动所有服务

set -e

echo "=========================================="
echo "启动服务"
echo "=========================================="
echo ""

cd /root/caigou/caigou

# 1. 检查构建文件
echo "📊 1. 检查构建文件"
echo "----------------------------------------"
if [ ! -f "apps/api/dist/main.js" ]; then
    echo "⚠️ API 构建文件不存在，需要先构建"
    echo "执行: npm run build"
    exit 1
fi

if [ ! -f "apps/api/dist/worker.js" ]; then
    echo "⚠️ Worker 构建文件不存在，需要先构建"
    echo "执行: npm run build"
    exit 1
fi

echo "✓ 构建文件存在"
echo ""

# 2. 检查 PM2
echo "📊 2. 检查 PM2"
echo "----------------------------------------"
if ! command -v pm2 &> /dev/null; then
    echo "⚠️ PM2 未安装，使用 nohup 方式启动"
    USE_PM2=false
else
    echo "✓ PM2 已安装"
    USE_PM2=true
fi
echo ""

# 3. 清理旧进程
echo "📊 3. 清理旧进程"
echo "----------------------------------------"
if [ "$USE_PM2" = true ]; then
    pm2 delete all 2>/dev/null || true
    pm2 kill 2>/dev/null || true
    sleep 2
fi

# 清理 nohup 进程
pkill -9 -f "node.*main.js" 2>/dev/null || true
pkill -9 -f "node.*worker.js" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "next start" 2>/dev/null || true
sleep 2
echo "✓ 旧进程已清理"
echo ""

# 4. 创建日志目录
mkdir -p logs

# 5. 启动服务
if [ "$USE_PM2" = true ]; then
    echo "📊 4. 使用 PM2 启动服务"
    echo "----------------------------------------"
    
    # 检查 ecosystem.config.js
    if [ -f "ecosystem.config.js" ]; then
        echo "使用 ecosystem.config.js 启动..."
        pm2 start ecosystem.config.js
    else
        echo "ecosystem.config.js 不存在，手动启动..."
        
        # 启动 API
        pm2 start apps/api/dist/main.js \
            --name caigou-api \
            --instances 2 \
            --exec-mode cluster \
            --env NODE_ENV=production \
            --error-file ./logs/api-error.log \
            --out-file ./logs/api-out.log \
            --max-memory-restart 1G
        
        # 启动 Worker
        pm2 start apps/api/dist/worker.js \
            --name caigou-worker \
            --instances 1 \
            --exec-mode fork \
            --env NODE_ENV=production \
            --error-file ./logs/worker-error.log \
            --out-file ./logs/worker-out.log \
            --max-memory-restart 1G
        
        # 启动 Web
        cd apps/web
        pm2 start "node_modules/.bin/next" \
            --name caigou-web \
            --instances 2 \
            --exec-mode cluster \
            --args "start -p 3000" \
            --env NODE_ENV=production,PORT=3000 \
            --error-file ../logs/web-error.log \
            --out-file ../logs/web-out.log \
            --max-memory-restart 1G
        cd ../..
    fi
    
    sleep 5
    
    echo "服务状态:"
    pm2 status
    
    echo ""
    echo "保存 PM2 配置:"
    pm2 save
    
    echo ""
    echo "设置开机自启:"
    pm2 startup || echo "需要手动执行: pm2 startup"
    
else
    echo "📊 4. 使用 nohup 启动服务"
    echo "----------------------------------------"
    
    # 启动 API
    echo "启动 API..."
    NODE_OPTIONS="--max-old-space-size=128" \
    NODE_ENV=production \
    nohup node apps/api/dist/main.js > logs/api-out.log 2> logs/api-error.log &
    API_PID=$!
    echo "API PID: $API_PID"
    sleep 5
    
    # 启动 Worker
    echo "启动 Worker..."
    NODE_OPTIONS="--max-old-space-size=128" \
    NODE_ENV=production \
    nohup node apps/api/dist/worker.js > logs/worker-out.log 2> logs/worker-error.log &
    WORKER_PID=$!
    echo "Worker PID: $WORKER_PID"
    sleep 5
    
    # 启动 Web
    echo "启动 Web..."
    cd apps/web
    if [ -f ".next/standalone/server.js" ]; then
        cd .next/standalone
        NODE_OPTIONS="--max-old-space-size=128" \
        PORT=3000 \
        NODE_ENV=production \
        nohup node server.js > ../../../logs/web-out.log 2> ../../../logs/web-error.log &
        WEB_PID=$!
        cd ../../..
    else
        NODE_OPTIONS="--max-old-space-size=128" \
        PORT=3000 \
        NODE_ENV=production \
        nohup npm run start > ../logs/web-out.log 2> ../logs/web-error.log &
        WEB_PID=$!
        cd ../..
    fi
    echo "Web PID: $WEB_PID"
    sleep 5
    
    # 保存 PID
    cat > .service-pids << EOF
API_PID=$API_PID
WORKER_PID=$WORKER_PID
WEB_PID=$WEB_PID
EOF
    
    echo ""
    echo "进程状态:"
    ps aux | grep -E "node.*main.js|node.*worker.js|next-server|next start" | grep -v grep
fi

echo ""
echo "=========================================="
echo "启动完成"
echo "=========================================="
echo ""
echo "检查服务:"
echo "  API: curl http://localhost:8081/api/health"
echo "  Web: curl http://localhost:3000"
echo ""
if [ "$USE_PM2" = true ]; then
    echo "PM2 命令:"
    echo "  查看状态: pm2 status"
    echo "  查看日志: pm2 logs"
    echo "  重启: pm2 restart all"
    echo "  停止: pm2 stop all"
else
    echo "查看日志:"
    echo "  tail -f logs/api-out.log"
    echo "  tail -f logs/worker-out.log"
    echo "  tail -f logs/web-out.log"
fi
echo ""

