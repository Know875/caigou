# 修复长时间运行的查询问题

## 🚨 严重问题发现

从检查结果看，有**多个数据库连接运行了 537 秒（约 9 分钟）**，这是导致系统卡顿的主要原因！

```
| 11263 | caigou_user | 537 | NULL |
| 11264 | caigou_user | 537 | NULL |
| 11260 | caigou_user | 537 | NULL |
...
```

**这些长时间运行的连接会：**
- 占用数据库连接池
- 阻塞其他查询
- 导致新请求排队等待
- 造成系统卡顿

---

## 🔍 立即诊断

### 步骤 1：查看这些连接的详细信息

```bash
# 查看这些长时间运行的连接的详细信息
mysql -u root -p -e "
SELECT 
    id,
    user,
    host,
    db,
    command,
    time,
    state,
    info
FROM information_schema.processlist
WHERE time > 100
ORDER BY time DESC;
"
```

### 步骤 2：检查是否有死锁

```bash
mysql -u root -p -e "
SHOW ENGINE INNODB STATUS\G
" | grep -A 20 "LATEST DETECTED DEADLOCK"
```

### 步骤 3：检查是否有长时间事务

```bash
mysql -u root -p -e "
SELECT 
    trx_id,
    trx_state,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) as duration_seconds,
    trx_mysql_thread_id,
    trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
"
```

---

## 🛠️ 立即修复

### 方案 1：终止长时间运行的连接（紧急）

**⚠️ 警告**：终止连接可能导致正在处理的事务回滚，请谨慎操作。

```bash
# 终止所有运行超过 300 秒（5 分钟）的连接
mysql -u root -p << EOF
SELECT CONCAT('KILL ', id, ';') as kill_command
FROM information_schema.processlist
WHERE user = 'caigou_user' 
  AND time > 300
  AND id != CONNECTION_ID();
EOF

# 查看生成的 KILL 命令，确认后执行
# 或者直接执行（谨慎！）
mysql -u root -p -e "
SELECT CONCAT('KILL ', id, ';') as kill_command
FROM information_schema.processlist
WHERE user = 'caigou_user' 
  AND time > 300
  AND id != CONNECTION_ID();
" | grep KILL | mysql -u root -p
```

### 方案 2：检查并优化代码中的长时间事务

长时间运行的查询通常是由：
- 长时间事务（没有提交或回滚）
- 死锁
- 慢查询
- 代码中的阻塞操作

**检查代码中是否有长时间事务：**

```bash
# 在服务器上搜索可能有问题的代码
cd /root/caigou/caigou/apps/api
grep -r "\$transaction" src/ | head -20
```

---

## 🔧 预防措施

### 1. 添加查询超时

在 Prisma 查询中添加超时：

```typescript
// 为长时间运行的查询添加超时
await this.prisma.$transaction(async (tx) => {
  // ...
}, {
  timeout: 30000, // 30秒超时
  maxWait: 10000, // 最多等待10秒获取连接
});
```

### 2. 优化 PM2 配置（使用 Cluster 模式）

当前使用的是 fork 模式，只有 1 个实例。应该使用 cluster 模式，多个实例。

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [
    {
      name: 'caigou-api',
      script: 'apps/api/dist/main.js',
      cwd: '/root/caigou/caigou',
      instances: 2, // 2 个实例
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
    },
  ],
};
```

然后：
```bash
pm2 delete caigou-api
pm2 start ecosystem.config.js
pm2 save
```

---

## 📊 当前问题分析

**发现的问题：**
1. ✅ 连接池已配置（50 个连接）
2. ❌ **严重**：多个连接运行了 537 秒
3. ❌ 服务频繁重启（caigou-api 重启了 168 次）
4. ❌ 没有使用 cluster 模式（只有 1 个实例）

**这些长时间运行的连接可能是：**
- 长时间事务未提交
- 死锁
- 慢查询
- 代码中的阻塞操作

---

## 🚨 紧急处理

### 立即终止长时间运行的连接

```bash
# 查看要终止的连接 ID
mysql -u root -p -e "
SELECT 
    id,
    user,
    time,
    state,
    LEFT(info, 50) as query
FROM information_schema.processlist
WHERE user = 'caigou_user' 
  AND time > 300
ORDER BY time DESC;
"

# 如果确认要终止，执行（替换 <id> 为实际的连接 ID）
# mysql -u root -p -e "KILL <id>;"
```

---

## 📝 后续优化

1. **添加查询超时**：防止查询无限运行
2. **优化 PM2 配置**：使用 cluster 模式，多个实例
3. **监控慢查询**：启用慢查询日志
4. **优化代码**：检查是否有长时间事务

---

**最后更新**: 2025-12-07

