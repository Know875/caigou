# 修复 Webhook 端口占用问题

## 问题
端口 9000 已被占用，导致 webhook 服务无法启动。

## 解决方案

### 方法1：查找并停止占用端口的进程

```bash
# 查找占用 9000 端口的进程
lsof -i :9000
# 或
netstat -tuln | grep 9000
# 或
ss -tuln | grep 9000

# 如果找到进程，停止它
# 假设 PID 是 12345
kill 12345

# 或者强制停止
kill -9 12345
```

### 方法2：停止所有 webhook 进程并重新启动

```bash
# 停止 webhook 服务
pm2 stop webhook
pm2 delete webhook

# 检查是否还有其他进程占用 9000 端口
lsof -i :9000

# 如果有，停止它们
# 然后重新启动
pm2 start webhook.js --name webhook
pm2 save
```

### 方法3：使用不同的端口

如果 9000 端口被其他服务使用，可以修改 webhook 使用其他端口：

```bash
# 设置环境变量使用其他端口（如 9001）
export WEBHOOK_PORT=9001

# 启动服务
pm2 start webhook.js --name webhook --update-env
pm2 save
```

然后在 GitHub webhook 配置中更新 URL 为 `http://你的服务器IP:9001/webhook`

