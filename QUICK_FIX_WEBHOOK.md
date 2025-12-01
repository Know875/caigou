# 快速修复 Webhook 服务错误

## 问题原因

错误信息显示：
```
Error: Cannot find module '/root/caigou/caigou/webhook.js'
```

webhook 服务配置指向了一个不存在的文件，导致服务无法启动。

## 解决方案：删除 webhook 服务

由于文件不存在，最简单的解决方案是删除这个服务：

```bash
# 删除 webhook 服务
pm2 delete webhook

# 保存 PM2 配置
pm2 save

# 验证删除成功
pm2 status
```

删除后，应该只看到 `caigou-api` 和 `caigou-web` 服务在运行。

## 如果将来需要 webhook 服务

如果需要重新添加 webhook 服务，需要：

1. 创建 `webhook.js` 文件
2. 或者修改 PM2 配置指向正确的文件
3. 使用 `pm2 start` 重新启动

但目前这个服务不是必需的，删除它不会影响主要功能。

