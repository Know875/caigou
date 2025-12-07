# 报价功能优化部署指南

## 部署内容

本次更新包含以下功能：
1. **显示最低价**：供应商可以看到每个商品的最低报价（不显示报价者）
2. **一口价成交提示**：一口价成交的商品显示"一口价已成交"
3. **禁止重复报价**：一口价已成交的商品，其他供应商无法继续报价

## 服务器部署步骤

### 1. 登录服务器并进入项目目录

```bash
cd /root/caigou/caigou
```

### 2. 拉取最新代码

```bash
git pull origin main
```

### 3. 安装新依赖（如果需要）

```bash
cd apps/api
npm install
cd ../..
```

### 4. 重新构建 API

```bash
cd apps/api
npm run build
cd ../..
```

### 5. 重新构建 Web（如果需要）

```bash
cd apps/web
npm run build
cd ../..
```

### 6. 重启服务

#### 方式1：使用 PM2（推荐）

```bash
# 重启所有服务
pm2 restart all

# 或者分别重启
pm2 restart caigou-api
pm2 restart caigou-web
```

#### 方式2：使用快速启动脚本

```bash
bash quick-start.sh
```

#### 方式3：手动重启（如果 PM2 有问题）

```bash
# 停止现有服务
pkill -9 -f "node.*main.js"
pkill -9 -f "next-server"

# 等待几秒
sleep 3

# 启动 API
cd apps/api
NODE_OPTIONS="--max-old-space-size=128" \
NODE_ENV=production \
nohup node dist/main.js > ../../logs/api-out.log 2> ../../logs/api-error.log &
API_PID=$!
echo "API PID: $API_PID"
cd ../..

# 启动 Worker
cd apps/api
NODE_OPTIONS="--max-old-space-size=128" \
NODE_ENV=production \
nohup node dist/worker.js > ../../logs/worker-out.log 2> ../../logs/worker-error.log &
WORKER_PID=$!
echo "Worker PID: $WORKER_PID"
cd ../..

# 启动 Web
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

# 验证服务是否启动成功
echo "检查服务状态..."
if ps -p $API_PID > /dev/null; then
  echo "✓ API 服务运行中 (PID: $API_PID)"
else
  echo "✗ API 服务启动失败"
  tail -n 30 logs/api-error.log
fi

if ps -p $WORKER_PID > /dev/null; then
  echo "✓ Worker 服务运行中 (PID: $WORKER_PID)"
else
  echo "✗ Worker 服务启动失败"
  tail -n 30 logs/worker-error.log
fi

if ps -p $WEB_PID > /dev/null; then
  echo "✓ Web 服务运行中 (PID: $WEB_PID)"
else
  echo "✗ Web 服务启动失败"
  tail -n 30 logs/web-error.log
fi
```

### 7. 验证部署

```bash
# 检查 API 健康状态
curl http://localhost:8081/api/health

# 检查服务进程
ps aux | grep -E "node.*main.js|next-server" | grep -v grep

# 检查端口监听
netstat -tlnp | grep -E "8081|3000"
```

### 8. 测试功能

1. **测试最低价显示**：
   - 供应商A提交报价
   - 供应商B查看询价单详情
   - 应该看到"目前最低价=¥XX.XX"

2. **测试一口价成交**：
   - 供应商A为一口价商品提交报价（价格 <= 一口价）
   - 供应商B查看询价单详情
   - 应该看到"一口价已成交"
   - 该商品的复选框应该被禁用

3. **测试禁止报价**：
   - 供应商B尝试为一口价已成交的商品提交报价
   - 应该收到错误提示："商品 'XXX' 已有一口价成交，无法继续报价"

## 回滚方案

如果部署后出现问题，可以回滚到之前的版本：

```bash
cd /root/caigou/caigou
git log --oneline -10  # 查看提交历史
git checkout <previous_commit_hash>  # 回滚到之前的提交
cd apps/api
npm run build
cd ../..
pm2 restart all
```

## 注意事项

1. **数据库连接**：确保数据库连接正常
2. **环境变量**：确保 `.env` 文件配置正确
3. **内存限制**：如果服务器内存有限，使用 `NODE_OPTIONS="--max-old-space-size=128"`
4. **日志监控**：部署后监控日志，确保没有错误

## 常见问题

### 1. 构建失败
- 检查 Node.js 版本
- 清理 node_modules 重新安装：`rm -rf node_modules && npm install`

### 2. 服务启动失败
- 检查端口是否被占用：`netstat -tlnp | grep 8081`
- 查看错误日志：`tail -n 50 logs/api-error.log`

### 3. 功能不生效
- 清除浏览器缓存
- 检查前端是否重新构建
- 查看浏览器控制台是否有错误

