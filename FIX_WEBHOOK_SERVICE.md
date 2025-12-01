# 修复 Webhook 服务错误

## 问题说明

PM2 状态显示 `webhook` 服务处于 `errored` 状态：
- PID: 0（未运行）
- 重启次数: 46（多次尝试启动失败）
- 状态: errored

## 解决方案

### 方法1：查看错误日志（推荐）

首先查看 webhook 服务的错误日志，了解失败原因：

```bash
# 查看 webhook 服务的错误日志
pm2 logs webhook --err --lines 50

# 或查看所有日志
pm2 logs webhook --lines 100
```

### 方法2：检查 PM2 配置

查看 webhook 服务的配置：

```bash
# 查看 webhook 服务的详细信息
pm2 info webhook

# 查看所有 PM2 应用的配置
pm2 list
```

### 方法3：删除不需要的 webhook 服务

如果 webhook 服务不是必需的，可以删除它：

```bash
# 删除 webhook 服务
pm2 delete webhook

# 保存 PM2 配置
pm2 save
```

### 方法4：重启 webhook 服务

如果 webhook 服务是必需的，尝试重启：

```bash
# 停止 webhook 服务
pm2 stop webhook

# 删除并重新启动（如果配置存在）
pm2 delete webhook
# 然后根据实际配置重新启动
```

### 方法5：检查服务脚本是否存在

```bash
# 检查是否有 webhook 相关的脚本文件
find /root/caigou/caigou -name "*webhook*" -type f

# 检查 PM2 配置文件
find /root/caigou/caigou -name "ecosystem.config.js" -o -name "pm2.config.js"
```

## 常见原因

1. **脚本文件不存在**：webhook 服务的启动脚本可能已被删除
2. **环境变量缺失**：webhook 服务需要特定的环境变量
3. **端口冲突**：webhook 服务使用的端口可能被占用
4. **依赖未安装**：webhook 服务需要的依赖包未安装

## 建议

如果 webhook 服务不是核心功能（如钉钉通知等），可以安全地删除它：

```bash
pm2 delete webhook
pm2 save
```

这样不会影响主要的 API 和 Web 服务。

## 验证

删除后，检查 PM2 状态：

```bash
pm2 status
```

应该只看到 `caigou-api` 和 `caigou-web` 服务在运行。

