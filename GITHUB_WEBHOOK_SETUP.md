# GitHub Webhook 自动部署配置指南

## 功能说明

`webhook.js` 是一个 GitHub webhook 服务，可以：
- 监听 GitHub push 事件
- 自动拉取最新代码
- 自动安装依赖
- 自动重新构建前端
- 自动重启 PM2 服务

## 配置步骤

### 1. 设置环境变量

在服务器上设置环境变量（可以添加到 `~/.bashrc` 或 PM2 配置中）：

```bash
# Webhook 服务端口（默认 9000）
export WEBHOOK_PORT=9000

# GitHub webhook secret（在 GitHub 仓库设置中配置）
export GITHUB_WEBHOOK_SECRET=your_secret_here

# 项目目录
export PROJECT_DIR=/root/caigou/caigou

# GitHub 分支（默认 main）
export GITHUB_BRANCH=main
```

### 2. 使用 PM2 启动 webhook 服务

```bash
cd /root/caigou/caigou

# 使用 PM2 启动 webhook 服务
pm2 start webhook.js --name webhook --env production

# 保存配置
pm2 save
```

### 3. 配置 GitHub Webhook

1. 打开 GitHub 仓库
2. 进入 **Settings** > **Webhooks** > **Add webhook**
3. 配置：
   - **Payload URL**: `http://你的服务器IP:9000/webhook`
   - **Content type**: `application/json`
   - **Secret**: 设置一个密钥（与 `GITHUB_WEBHOOK_SECRET` 一致）
   - **Events**: 选择 "Just the push event"
4. 点击 **Add webhook**

### 4. 测试 Webhook

在 GitHub 上推送代码后，webhook 服务会自动：
1. 拉取最新代码
2. 安装依赖
3. 重新生成 Prisma Client
4. 重新构建前端
5. 重启 PM2 服务

查看日志：
```bash
pm2 logs webhook
```

## 安全建议

1. **使用 HTTPS**：如果可能，使用 Nginx 反向代理并配置 SSL
2. **设置 Secret**：务必设置 `GITHUB_WEBHOOK_SECRET` 并验证签名
3. **限制访问**：使用防火墙限制 webhook 端口的访问
4. **监控日志**：定期检查 webhook 日志

## 故障排查

### Webhook 服务无法启动

```bash
# 检查端口是否被占用
netstat -tuln | grep 9000

# 检查日志
pm2 logs webhook --err
```

### Webhook 收到请求但不执行

```bash
# 检查环境变量
pm2 env webhook

# 检查项目目录权限
ls -la /root/caigou/caigou
```

### 自动部署失败

查看详细日志：
```bash
pm2 logs webhook --lines 100
```

## 手动触发部署

如果需要手动触发部署（不使用 webhook）：

```bash
cd /root/caigou/caigou
bash deploy.sh
```

