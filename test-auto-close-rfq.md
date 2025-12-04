# 自动截单功能说明和调试方法

## 自动截单机制

系统有两种自动截单机制：

### 1. 延迟任务（BullMQ）
- **触发时机**：发布询价单时（`publishRfq`）
- **工作原理**：在 Redis/BullMQ 中添加一个延迟任务，在截止时间到达时自动执行
- **优点**：精确到秒，性能好

### 2. 定时任务（Cron - 备用机制）
- **触发时机**：每分钟检查一次（`@Cron(CronExpression.EVERY_MINUTE)`）
- **工作原理**：查找所有 `status = 'PUBLISHED'` 且 `deadline <= NOW()` 的询价单
- **优点**：即使延迟任务失败，定时任务也能作为备用机制

## 当前 RFQ 状态

RFQ-1764848283116：
- **截止时间**：2025/12/22 20:37:00
- **当前时间**：2025-12-04（假设）
- **状态**：还未到截止时间，不应该被关闭

## 调试步骤

### 1. 检查 RFQ 状态
```bash
mysql -u root -p caigou < check-rfq-auto-close.sql
```

### 2. 检查 PM2 日志
```bash
# 查看 API 日志
pm2 logs caigou-api --lines 100 | grep -i "cron\|close\|deadline"

# 或者查看错误日志
pm2 logs caigou-api --err --lines 100
```

### 3. 检查定时任务是否运行
在日志中查找：
- `[Cron] 发现 X 个已过期的询价单，开始关闭...`
- `[Cron] 已关闭过期询价单: RFQ-XXXXX`

### 4. 检查 Redis/BullMQ 队列
```bash
# 连接到 Redis
redis-cli

# 查看队列中的任务
KEYS bull:auction:*
```

### 5. 手动测试（如果需要）
如果 RFQ 已经过期但未关闭，可以手动触发：

```sql
-- 注意：这只是测试，不要在生产环境随意执行
-- 将 RFQ 的截止时间设置为过去的时间（仅用于测试）
UPDATE rfqs 
SET deadline = DATE_SUB(NOW(), INTERVAL 1 MINUTE)
WHERE rfqNo = 'RFQ-1764848283116' COLLATE utf8mb4_unicode_ci;
```

然后等待 1-2 分钟，定时任务应该会自动关闭它。

## 常见问题

### Q: 为什么询价单到了截止时间还没关闭？
A: 可能的原因：
1. 定时任务未运行（检查 PM2 日志）
2. Redis/BullMQ 服务未运行（检查 Redis 连接）
3. 延迟任务添加失败（检查发布时的日志）
4. 时区问题（检查服务器时区设置）

### Q: 如何验证定时任务是否正常工作？
A: 查看 PM2 日志，应该每分钟都有定时任务的执行记录（即使没有过期的询价单）。

### Q: 如何手动触发关闭？
A: 可以通过 API 手动关闭：
```bash
curl -X PATCH http://your-api/rfqs/{rfqId}/close \
  -H "Authorization: Bearer {token}"
```

## 注意事项

1. **时区问题**：确保服务器时区设置正确（应该是 Asia/Shanghai）
2. **Redis 连接**：确保 Redis 服务正常运行
3. **PM2 状态**：确保 PM2 进程正常运行
4. **日志级别**：确保日志级别允许输出定时任务的日志

