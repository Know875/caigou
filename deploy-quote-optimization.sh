#!/bin/bash

# 报价功能优化部署脚本

set -e

echo "========================================="
echo "开始部署报价功能优化"
echo "========================================="

# 1. 进入项目目录
cd /root/caigou/caigou || {
  echo "错误：无法进入项目目录"
  exit 1
}

# 2. 拉取最新代码
echo ""
echo "📥 拉取最新代码..."
git pull origin main

# 3. 安装依赖（如果需要）
echo ""
echo "📦 检查依赖..."
cd apps/api
if [ -f "package.json" ]; then
  npm install
fi
cd ../..

# 4. 重新构建 API
echo ""
echo "🔨 构建 API..."
cd apps/api
npm run build
if [ $? -ne 0 ]; then
  echo "❌ API 构建失败"
  exit 1
fi
echo "✓ API 构建成功"
cd ../..

# 5. 重新构建 Web
echo ""
echo "🔨 构建 Web..."
cd apps/web
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Web 构建失败"
  exit 1
fi
echo "✓ Web 构建成功"
cd ../..

# 6. 重启服务
echo ""
echo "🔄 重启服务..."

# 检查是否使用 PM2
if command -v pm2 &> /dev/null; then
  echo "使用 PM2 重启服务..."
  pm2 restart all
  sleep 5
  pm2 status
else
  echo "PM2 未安装，使用手动方式重启..."
  
  # 停止现有服务
  echo "停止现有服务..."
  pkill -9 -f "node.*main.js" || true
  pkill -9 -f "next-server" || true
  sleep 3
  
  # 启动 API
  echo "启动 API 服务..."
  cd apps/api
  NODE_OPTIONS="--max-old-space-size=128" \
  NODE_ENV=production \
  nohup node dist/main.js > ../../logs/api-out.log 2> ../../logs/api-error.log &
  API_PID=$!
  echo "API PID: $API_PID"
  cd ../..
  
  # 启动 Worker
  echo "启动 Worker 服务..."
  cd apps/api
  NODE_OPTIONS="--max-old-space-size=128" \
  NODE_ENV=production \
  nohup node dist/worker.js > ../../logs/worker-out.log 2> ../../logs/worker-error.log &
  WORKER_PID=$!
  echo "Worker PID: $WORKER_PID"
  cd ../..
  
  # 启动 Web
  echo "启动 Web 服务..."
  cd apps/web
  if [ -f ".next/standalone/server.js" ]; then
    NODE_ENV=production \
    nohup node .next/standalone/server.js > ../../logs/web-out.log 2> ../../logs/web-error.log &
  else
    NODE_ENV=production \
    nohup npm run start > ../../logs/web-out.log 2> ../../logs/web-error.log &
  fi
  WEB_PID=$!
  echo "Web PID: $WEB_PID"
  cd ../..
  
  # 等待服务启动
  sleep 10
  
  # 验证服务
  echo ""
  echo "验证服务状态..."
  if ps -p $API_PID > /dev/null 2>&1; then
    echo "✓ API 服务运行中 (PID: $API_PID)"
  else
    echo "✗ API 服务启动失败"
    tail -n 20 logs/api-error.log
  fi
  
  if ps -p $WORKER_PID > /dev/null 2>&1; then
    echo "✓ Worker 服务运行中 (PID: $WORKER_PID)"
  else
    echo "✗ Worker 服务启动失败"
    tail -n 20 logs/worker-error.log
  fi
  
  if ps -p $WEB_PID > /dev/null 2>&1; then
    echo "✓ Web 服务运行中 (PID: $WEB_PID)"
  else
    echo "✗ Web 服务启动失败"
    tail -n 20 logs/web-error.log
  fi
fi

# 7. 验证部署
echo ""
echo "🔍 验证部署..."
sleep 5

# 检查 API 健康状态
if curl -s http://localhost:8081/api/health > /dev/null; then
  echo "✓ API 健康检查通过"
else
  echo "✗ API 健康检查失败"
fi

# 检查端口监听
if netstat -tlnp 2>/dev/null | grep -q ":8081.*LISTEN"; then
  echo "✓ API 端口 8081 正在监听"
else
  echo "✗ API 端口 8081 未监听"
fi

echo ""
echo "========================================="
echo "部署完成！"
echo "========================================="
echo ""
echo "📋 测试步骤："
echo "1. 供应商A提交报价"
echo "2. 供应商B查看询价单详情，应该看到最低价"
echo "3. 一口价成交的商品应该显示'一口价已成交'"
echo "4. 一口价已成交的商品无法继续报价"
echo ""

